import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 本地诗词库：SQLite（元信息）+ 真实文件（音频）。
 *
 * 为什么这么分：
 *   - **元信息进 SQLite**：卡片、标签、墨色、歌单、标签预设都是结构化数据，用 SQL 存
 *     查询和统计都方便，而且整个库就是一个能拷走的 `library.sqlite` 文件；
 *   - **音频放真实文件**（`data/audio/<id>.<ext>`）：一条音频几 MB 到几十 MB，塞进
 *     SQLite 的 BLOB 会让每次读写都变重，也失去了"能用别的播放器直接打开、能单独拷走"
 *     的好处。数据库里只存文件名与元信息。
 *
 * 这个模块只在 Node 侧运行（Vite 开发中间件用它）。`node:sqlite` 是 Node 内置的，
 * 不需要任何依赖——代价是它目前标记为 experimental（启动会有一行警告）。
 */

export interface SnapshotRecord {
  id: string
  createdAt: number
  updatedAt?: number
  label: string
  style: string
  thumb?: string
  /** 卡片渲染态（含 background.dataUrl），原样 JSON 存 */
  state: Record<string, unknown>
  /** 音频元信息（含歌词时间轴）；音频本体在 data/audio/ 下 */
  audio?: Record<string, unknown> | null
}

export interface LibraryHandle {
  db: DatabaseSync
  root: string
  dbFile: string
  audioDir: string
}

interface CardRow {
  id: string
  key: string
  label: string
  style: string
  created_at: number
  updated_at: number | null
  thumb: string | null
  state: string
  audio: string | null
}

/** 保存键（标题 + 作者），与前端 `snapshotKeyOf` 同一套语义 */
export function cardKeyOf(record: SnapshotRecord): string {
  const label = String(record.label ?? '').trim() || '未命名'
  const author = String((record.state as { author?: string })?.author ?? '').trim()
  return `${label}\u0000${author}`
}

export function openLibrary(root: string): LibraryHandle {
  const audioDir = join(root, 'audio')
  mkdirSync(audioDir, { recursive: true })
  const dbFile = join(root, 'library.sqlite')
  const db = new DatabaseSync(dbFile)
  // WAL：读写并发更顺，且崩溃后更容易恢复
  db.exec('pragma journal_mode = wal')
  db.exec('pragma foreign_keys = on')
  db.exec(`
    create table if not exists cards (
      id text primary key,
      key text not null,
      label text not null,
      style text not null,
      created_at integer not null,
      updated_at integer,
      thumb text,
      state text not null,
      audio text
    );
    create index if not exists cards_key_idx on cards(key);
    create index if not exists cards_updated_idx on cards(updated_at desc, created_at desc);
    create table if not exists kv (
      store text not null,
      id text not null,
      data text not null,
      primary key (store, id)
    );
  `)
  return { db, root, dbFile, audioDir }
}

function rowToRecord(row: CardRow): SnapshotRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    label: row.label,
    style: row.style,
    thumb: row.thumb ?? undefined,
    state: JSON.parse(row.state) as Record<string, unknown>,
    audio: row.audio ? (JSON.parse(row.audio) as Record<string, unknown>) : undefined,
  }
}

export function listCards(lib: LibraryHandle): SnapshotRecord[] {
  const rows = lib.db
    .prepare('select * from cards order by coalesce(updated_at, created_at) desc')
    .all() as unknown as CardRow[]
  return rows.map(rowToRecord)
}

export function getCard(lib: LibraryHandle, id: string): SnapshotRecord | null {
  const row = lib.db.prepare('select * from cards where id = ?').get(id) as unknown as CardRow | undefined
  return row ? rowToRecord(row) : null
}

export function putCard(lib: LibraryHandle, record: SnapshotRecord): SnapshotRecord {
  lib.db
    .prepare(
      `insert into cards (id, key, label, style, created_at, updated_at, thumb, state, audio)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         key = excluded.key, label = excluded.label, style = excluded.style,
         created_at = excluded.created_at, updated_at = excluded.updated_at,
         thumb = excluded.thumb, state = excluded.state, audio = excluded.audio`,
    )
    .run(
      record.id,
      cardKeyOf(record),
      record.label,
      record.style,
      record.createdAt,
      record.updatedAt ?? null,
      record.thumb ?? null,
      JSON.stringify(record.state),
      record.audio ? JSON.stringify(record.audio) : null,
    )
  return record
}

/** 按保存键找同一条（供"标题+作者相同即更新"的 upsert 语义用） */
export function findCardByKey(lib: LibraryHandle, key: string): SnapshotRecord | null {
  const row = lib.db.prepare('select * from cards where key = ? limit 1').get(key) as unknown as CardRow | undefined
  return row ? rowToRecord(row) : null
}

export function deleteCard(lib: LibraryHandle, id: string): void {
  lib.db.prepare('delete from cards where id = ?').run(id)
  deleteAudioFile(lib, id)
}

export function clearCards(lib: LibraryHandle): void {
  lib.db.exec('delete from cards')
  for (const f of readdirSync(lib.audioDir)) {
    try {
      unlinkSync(join(lib.audioDir, f))
    } catch {
      // 单个文件删不掉不该让整次清空失败
    }
  }
}

// ------------------------------------------------------------------ 音频文件

function extOf(name: string, fallback = 'bin'): string {
  const m = name.match(/\.([a-zA-Z0-9]{1,5})$/)
  return m ? m[1].toLowerCase() : fallback
}

export function audioFilePath(lib: LibraryHandle, id: string, name: string): string {
  return join(lib.audioDir, `${id}.${extOf(name)}`)
}

export function writeAudio(lib: LibraryHandle, id: string, name: string, bytes: Buffer): { file: string; size: number } {
  // 同一张卡片换音频时先删掉旧文件，避免留下孤儿（扩展名可能不同）
  deleteAudioFile(lib, id)
  const file = audioFilePath(lib, id, name)
  writeFileSync(file, bytes)
  return { file, size: bytes.length }
}

export function readAudio(lib: LibraryHandle, id: string): { bytes: Buffer; file: string } | null {
  if (!existsSync(lib.audioDir)) return null
  const hit = readdirSync(lib.audioDir).find((f) => f.startsWith(`${id}.`))
  if (!hit) return null
  const file = join(lib.audioDir, hit)
  return { bytes: readFileSync(file), file }
}

export function deleteAudioFile(lib: LibraryHandle, id: string): void {
  if (!existsSync(lib.audioDir)) return
  for (const f of readdirSync(lib.audioDir)) {
    if (f.startsWith(`${id}.`)) {
      try {
        unlinkSync(join(lib.audioDir, f))
      } catch {
        // 忽略：文件可能已被外部删除
      }
    }
  }
}

// --------------------------------------------------------------- 键值小仓库

export function listKv<T>(lib: LibraryHandle, store: string): T[] {
  const rows = lib.db.prepare('select id, data from kv where store = ?').all(store) as unknown as {
    id: string
    data: string
  }[]
  return rows.map((r) => JSON.parse(r.data) as T)
}

export function putKv(lib: LibraryHandle, store: string, id: string, data: unknown): void {
  lib.db
    .prepare(
      `insert into kv (store, id, data) values (?, ?, ?)
       on conflict(store, id) do update set data = excluded.data`,
    )
    .run(store, id, JSON.stringify(data))
}

export function deleteKv(lib: LibraryHandle, store: string, id: string): void {
  lib.db.prepare('delete from kv where store = ? and id = ?').run(store, id)
}

export function clearKv(lib: LibraryHandle, store: string): void {
  lib.db.prepare('delete from kv where store = ?').run(store)
}

export interface LibraryStats {
  cards: number
  audioFiles: number
  audioBytes: number
  dbBytes: number
}

export function stats(lib: LibraryHandle): LibraryStats {
  const cards = (lib.db.prepare('select count(*) as n from cards').get() as { n: number }).n
  let audioFiles = 0
  let audioBytes = 0
  if (existsSync(lib.audioDir)) {
    for (const f of readdirSync(lib.audioDir)) {
      try {
        audioBytes += statSync(join(lib.audioDir, f)).size
        audioFiles++
      } catch {
        // 忽略读不到的文件
      }
    }
  }
  let dbBytes = 0
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${lib.dbFile}${suffix}`
    if (existsSync(p)) {
      try {
        dbBytes += statSync(p).size
      } catch {
        // 忽略
      }
    }
  }
  return { cards, audioFiles, audioBytes, dbBytes }
}

/** 供测试或"彻底重建"用：把整个 data 目录删掉 */
export function destroyLibrary(lib: LibraryHandle): void {
  lib.db.close()
  rmSync(lib.root, { recursive: true, force: true })
}

