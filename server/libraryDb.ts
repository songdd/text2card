import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 本地诗词库：SQLite（元信息）+ 真实文件（音频、配图）。
 *
 * 为什么这么分：
 *   - **元信息进 SQLite**：卡片、标签、墨色、歌单、标签预设都是结构化数据，用 SQL 存
 *     查询和统计都方便，而且整个库就是一个能拷走的 `library.sqlite` 文件；
 *   - **音频放真实文件**（`data/audio/<id>.<ext>`）：一条音频几 MB 到几十 MB，塞进
 *     SQLite 的 BLOB 会让每次读写都变重，也失去了"能用别的播放器直接打开、能单独拷走"
 *     的好处。数据库里只存文件名与元信息。
 *   - **配图也放真实文件**（`data/images/<id>.<ext>`，草稿配图是 `draft.<ext>`）：
 *     一张 AI 配图 1–3MB，内联成 base64 还会再胖 1/3。8 张卡片内联时整个库 15.4MB，
 *     而每次读一张卡片都要解析 2MB 的 JSON、改一个字保存也要重写整行。落成文件之后，
 *     库里只留 `{ scrim, bytes, ext }`，库本身缩到几百 KB。
 *
 * 这个模块只在 Node 侧运行（Vite 开发中间件用它）。`node:sqlite` 是 Node 内置的，
 * 不需要任何依赖——代价是它目前标记为 experimental（启动会有一行警告，见 `--disable-warning`）。
 */

export interface SnapshotRecord {
  id: string
  createdAt: number
  updatedAt?: number
  label: string
  style: string
  thumb?: string
  /** 卡片渲染态。配图只留 {scrim, bytes, ext}，图片本体在 data/images/ 下 */
  state: Record<string, unknown>
  /** 音频元信息（含歌词时间轴）；音频本体在 data/audio/ 下 */
  audio?: Record<string, unknown> | null
}

export interface LibraryHandle {
  db: DatabaseSync
  root: string
  dbFile: string
  audioDir: string
  imageDir: string
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
  const imageDir = join(root, 'images')
  mkdirSync(audioDir, { recursive: true })
  mkdirSync(imageDir, { recursive: true })
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
  const lib: LibraryHandle = { db, root, dbFile, audioDir, imageDir }
  // 老数据里配图是内联在 JSON 里的，这里一次性搬成文件（幂等，搬完就没事可做）
  const moved = migrateInlineImages(lib)
  if (moved > 0) {
    console.log(`[library] 已把 ${moved} 张内联配图搬到 data/images/（库文件因此变小，建议跑一次整理）`)
  }
  return lib
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
  // 配图先落成文件（行里只留 {scrim, bytes, ext}），再写数据库
  const next = normalizeBackground(lib, record)
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
      next.id,
      cardKeyOf(next),
      next.label,
      next.style,
      next.createdAt,
      next.updatedAt ?? null,
      next.thumb ?? null,
      JSON.stringify(next.state),
      next.audio ? JSON.stringify(next.audio) : null,
    )
  return next
}

/** 按保存键找同一条（供"标题+作者相同即更新"的 upsert 语义用） */
export function findCardByKey(lib: LibraryHandle, key: string): SnapshotRecord | null {
  const row = lib.db.prepare('select * from cards where key = ? limit 1').get(key) as unknown as CardRow | undefined
  return row ? rowToRecord(row) : null
}

export function deleteCard(lib: LibraryHandle, id: string): void {
  lib.db.prepare('delete from cards where id = ?').run(id)
  deleteAudioFile(lib, id)
  deleteCardImage(lib, id)
}

export function clearCards(lib: LibraryHandle): void {
  // 先把卡片配图删掉，再清库。草稿配图（draft.*）不属于卡片，留着——
  // "清空全部卡片"不该顺手把编辑器里正在用的背景也弄没
  if (existsSync(lib.imageDir)) {
    for (const f of readdirSync(lib.imageDir)) {
      if (f.startsWith(`${DRAFT_IMAGE_ID}.`)) continue
      try {
        unlinkSync(join(lib.imageDir, f))
      } catch {
        // 单个文件删不掉不该让整次清空失败
      }
    }
  }
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
  // 注意：这里**不删旧文件**。上传流程是"写新文件 → 元信息落库 → 再删旧文件"，
  // 中途失败要能退回"原来的音频还在"。清理旧文件由调用方在落库成功后做。
  const file = audioFilePath(lib, id, name)
  writeFileSync(file, bytes)
  return { file, size: bytes.length }
}

/** 读音频：元信息里给了文件名就按它读（确定性），没给才扫目录兜底 */
export function readAudio(lib: LibraryHandle, id: string, name?: string | null): { bytes: Buffer; file: string } | null {
  if (!existsSync(lib.audioDir)) return null
  if (name) {
    const exact = join(lib.audioDir, `${id}.${extOf(name)}`)
    if (existsSync(exact)) {
      try {
        return { bytes: readFileSync(exact), file: exact }
      } catch {
        return null
      }
    }
  }
  const hit = readdirSync(lib.audioDir).find((f) => f.startsWith(`${id}.`))
  if (!hit) return null
  const file = join(lib.audioDir, hit)
  return { bytes: readFileSync(file), file }
}

/** 删这张卡片的音频文件。`keep` 里的文件名（相对于 id 的扩展名）留着不动 */
export function deleteAudioFile(lib: LibraryHandle, id: string, keep: string[] = []): void {
  if (!existsSync(lib.audioDir)) return
  const keepSet = new Set(keep.map((n) => `${id}.${extOf(n)}`))
  for (const f of readdirSync(lib.audioDir)) {
    if (!f.startsWith(`${id}.`)) continue
    if (keepSet.has(f)) continue
    try {
      unlinkSync(join(lib.audioDir, f))
    } catch {
      // 忽略：文件可能已被外部删除
    }
  }
}

// ------------------------------------------------------------------ 配图文件

/** 编辑器"当前背景草稿"的图片文件名（跟卡片配图放同一个目录） */
export const DRAFT_IMAGE_ID = 'draft'

/** 配图在库里的样子：只有元信息，图本体在 data/images/ */
export interface BackgroundMeta {
  /** 恒为空串——图在文件里。保留这个键是为了让"有没有取回来"的判断保持一致 */
  dataUrl: string
  /** 主题渐变在照片之上的不透明度 */
  scrim: number
  /** 图片字节数（列表接口用它显示体积） */
  bytes?: number
  /** 文件扩展名（jpg/png/webp） */
  ext?: string
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

/** 拆 data URL：`data:image/jpeg;base64,xxxx` → 字节 + 扩展名 */
export function dataUrlToParts(dataUrl: string): { bytes: Buffer; ext: string; mime: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const mime = m[1] || 'image/jpeg'
  const isBase64 = Boolean(m[2])
  const body = m[3] ?? ''
  try {
    const bytes = isBase64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8')
    if (!bytes.length) return null
    return { bytes, ext: MIME_EXT[mime] ?? 'jpg', mime }
  } catch {
    return null
  }
}

export function bytesToDataUrl(bytes: Buffer, ext: string): string {
  const mime = EXT_MIME[ext] ?? 'image/jpeg'
  return `data:${mime};base64,${bytes.toString('base64')}`
}

export function imageFilePath(lib: LibraryHandle, id: string, ext: string): string {
  return join(lib.imageDir, `${id}.${ext}`)
}

/** 写配图文件（同一张卡片换图时先删旧文件，因为扩展名可能不同） */
export function writeCardImage(
  lib: LibraryHandle,
  id: string,
  dataUrl: string,
): { bytes: number; ext: string } | null {
  const parts = dataUrlToParts(dataUrl)
  if (!parts) return null
  deleteCardImage(lib, id)
  try {
    mkdirSync(lib.imageDir, { recursive: true })
    writeFileSync(imageFilePath(lib, id, parts.ext), parts.bytes)
  } catch {
    return null
  }
  return { bytes: parts.bytes.length, ext: parts.ext }
}

/** 读配图文件（按 id 找，扩展名不写死） */
export function readCardImage(lib: LibraryHandle, id: string): { bytes: Buffer; ext: string; file: string } | null {
  if (!existsSync(lib.imageDir)) return null
  const hit = readdirSync(lib.imageDir).find((f) => f.startsWith(`${id}.`))
  if (!hit) return null
  const file = join(lib.imageDir, hit)
  try {
    return { bytes: readFileSync(file), ext: hit.split('.').pop() ?? 'jpg', file }
  } catch {
    return null
  }
}

export function deleteCardImage(lib: LibraryHandle, id: string): void {
  if (!existsSync(lib.imageDir)) return
  for (const f of readdirSync(lib.imageDir)) {
    if (f.startsWith(`${id}.`)) {
      try {
        unlinkSync(join(lib.imageDir, f))
      } catch {
        // 忽略：文件可能已被外部删除
      }
    }
  }
}

function listImageFiles(lib: LibraryHandle): { files: number; bytes: number } {
  if (!existsSync(lib.imageDir)) return { files: 0, bytes: 0 }
  let files = 0
  let bytes = 0
  for (const f of readdirSync(lib.imageDir)) {
    try {
      bytes += statSync(join(lib.imageDir, f)).size
      files++
    } catch {
      // 忽略读不到的文件
    }
  }
  return { files, bytes }
}

/**
 * 把配图归一到"文件 + 元信息"。
 *
 * - 带 dataUrl（编辑器新生成/换图、或从备份恢复）→ 写文件，行里只留元信息
 * - 空 dataUrl（列表瘦身过的卡片又原样存回来）→ 沿用原来那份元信息，**不碰文件**
 * - 既没图也没体积信息 → 当成没有配图
 * - 写文件失败 → 原样保留内联，宁可库大一点也不能丢图
 */
function normalizeBackground(lib: LibraryHandle, record: SnapshotRecord): SnapshotRecord {
  const state = record.state ?? {}
  if (!('background' in state)) return record
  const bg = state.background as Partial<BackgroundMeta> | null | undefined
  if (!bg) {
    // 明确删图：文件也删掉
    deleteCardImage(lib, record.id)
    return record
  }
  const dataUrl = typeof bg.dataUrl === 'string' ? bg.dataUrl : ''
  const scrim = typeof bg.scrim === 'number' ? bg.scrim : 0.5
  if (dataUrl) {
    const written = writeCardImage(lib, record.id, dataUrl)
    if (!written) return record
    return {
      ...record,
      state: { ...state, background: { dataUrl: '', scrim, bytes: written.bytes, ext: written.ext } },
    }
  }
  if (!bg.bytes && !bg.ext) {
    // 没有图也没有体积：当作没有配图，别让界面显示"有配图"却取不到图
    return { ...record, state: { ...state, background: null } }
  }
  return {
    ...record,
    state: { ...state, background: { dataUrl: '', scrim, bytes: bg.bytes ?? 0, ext: bg.ext } },
  }
}

/** 把行里的配图补成完整 data URL（只有"要发给前端"的时候才做，内部一律用元信息） */
export function inlineBackground(lib: LibraryHandle, record: SnapshotRecord): SnapshotRecord {
  const state = record.state ?? {}
  const bg = state.background as BackgroundMeta | null | undefined
  if (!bg || !bg.bytes) return record
  if (bg.dataUrl) return record
  const file = readCardImage(lib, record.id)
  if (!file) return record
  return {
    ...record,
    state: {
      ...state,
      background: { dataUrl: bytesToDataUrl(file.bytes, file.ext), scrim: bg.scrim, bytes: file.bytes.length, ext: file.ext },
    },
  }
}

/**
 * 一次性迁移：把老数据里内联的配图搬成文件（卡片 + 编辑器草稿）。
 * 幂等——搬过的行里 dataUrl 已经是空的，下次启动什么都不做。
 */
export function migrateInlineImages(lib: LibraryHandle): number {
  let moved = 0
  for (const record of listCards(lib)) {
    const bg = (record.state?.background ?? null) as Partial<BackgroundMeta> | null
    if (!bg?.dataUrl) continue
    putCard(lib, record) // putCard → normalizeBackground：写文件 + 行里只留元信息
    moved++
  }
  const draft = readDraftBackgroundRaw(lib)
  const draftBg = (draft ?? null) as Partial<BackgroundMeta> | null
  if (draftBg?.dataUrl) {
    const written = writeCardImage(lib, DRAFT_IMAGE_ID, draftBg.dataUrl)
    if (written) {
      writeDraftBackgroundMeta(lib, { dataUrl: '', scrim: draftBg.scrim ?? 0.5, bytes: written.bytes, ext: written.ext })
      moved++
    }
  }
  return moved
}

// --------------------------------------------------- 编辑器草稿配图（kv/draft）

function readDraftBackgroundRaw(lib: LibraryHandle): unknown {
  const row = lib.db.prepare('select data from kv where store = ? and id = ?').get('draft', 'background') as
    | { data: string }
    | undefined
  if (!row) return null
  try {
    return JSON.parse(row.data)
  } catch {
    return null
  }
}

function writeDraftBackgroundMeta(lib: LibraryHandle, meta: BackgroundMeta): void {
  putKv(lib, 'draft', 'background', { id: 'background', value: meta })
}

/** 读草稿配图：需要时把文件补成 data URL（编辑器打开时要还原上一次那张图） */
export function readDraftBackground(lib: LibraryHandle): unknown {
  const raw = readDraftBackgroundRaw(lib) as { id?: string; value?: BackgroundMeta | null } | null
  if (!raw || !raw.value) return raw
  const bg = raw.value
  if (bg.dataUrl || !bg.bytes) return raw
  const file = readCardImage(lib, DRAFT_IMAGE_ID)
  if (!file) return raw
  return {
    ...raw,
    value: { dataUrl: bytesToDataUrl(file.bytes, file.ext), scrim: bg.scrim, bytes: file.bytes.length, ext: file.ext },
  }
}

/** 写草稿配图：带图就落文件，行里只留元信息 */
export function writeDraftBackground(lib: LibraryHandle, value: unknown): unknown {
  const item = (value ?? null) as { id?: string; value?: Partial<BackgroundMeta> | null } | null
  const bg = item?.value ?? null
  if (!bg) {
    deleteCardImage(lib, DRAFT_IMAGE_ID)
    writeDraftBackgroundMeta(lib, { dataUrl: '', scrim: 0.5, bytes: 0 })
    return { id: 'background', value: null }
  }
  const dataUrl = typeof bg.dataUrl === 'string' ? bg.dataUrl : ''
  if (dataUrl) {
    const written = writeCardImage(lib, DRAFT_IMAGE_ID, dataUrl)
    if (written) {
      writeDraftBackgroundMeta(lib, { dataUrl: '', scrim: bg.scrim ?? 0.5, bytes: written.bytes, ext: written.ext })
      return { id: 'background', value: { dataUrl: '', scrim: bg.scrim ?? 0.5, bytes: written.bytes, ext: written.ext } }
    }
    // 写文件失败：原样存（库大一点，但不丢图）
    return value
  }
  writeDraftBackgroundMeta(lib, { dataUrl: '', scrim: bg.scrim ?? 0.5, bytes: bg.bytes ?? 0, ext: bg.ext })
  return { id: 'background', value: { dataUrl: '', scrim: bg.scrim ?? 0.5, bytes: bg.bytes ?? 0, ext: bg.ext } }
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
  imageFiles: number
  imageBytes: number
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
  const images = listImageFiles(lib)
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
  return { cards, audioFiles, audioBytes, imageFiles: images.files, imageBytes: images.bytes, dbBytes }
}

/** 供测试或"彻底重建"用：把整个 data 目录删掉 */
export function destroyLibrary(lib: LibraryHandle): void {
  lib.db.close()
  rmSync(lib.root, { recursive: true, force: true })
}

