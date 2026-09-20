import { restoreAudio } from './snapshots'
import { apiPost, apiPut, apiGet } from './libraryApi'
import type { Playlist, Snapshot, SnapshotState, TagPreset } from './snapshots'
import type { AudioMeta } from './snapshots'

/**
 * 把浏览器 IndexedDB 里的旧数据搬进本地 SQLite 库。
 *
 * 设计要点：
 *  - **只读浏览器的库，不删**。迁移完之后旧数据仍原封不动地留在浏览器里当后备，
 *    确认没问题再由用户决定清理。迁移是"复制"，不是"移动"。
 *  - **幂等**：全部用 PUT（按 id 覆盖），重复跑一次不会产生重复数据。
 *  - 这一步是唯一还需要认识 IndexedDB 的地方（新的数据层已经不碰它了），所以
 *    读取逻辑就写在这里，而不是散回去。
 */

const LEGACY_DB = 'text2card'
const STORES = {
  snapshots: 'snapshots',
  draft: 'draft',
  audio: 'audio',
  tagPresets: 'tagPresets',
  playlists: 'playlists',
} as const

/** 迁移完成的标记（存在 localStorage；只影响"要不要提示"，不影响数据） */
const DONE_KEY = 'text2card.migrated-to-sqlite.v1'

export function migrationDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return false
  }
}

export function markMigrationDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    // 隐私模式写不了就每次提示一遍，无伤大雅
  }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('读取浏览器旧数据失败'))
  })
}

/**
 * 打开浏览器里的旧库。
 *
 * 两个刻意的选择，都是踩过坑之后改的：
 *
 *  1. **不带版本号打开**。带上固定版本号（比如 6）时，只要用户的库是别的版本
 *     （哪怕更高），打开就会以 VersionError 失败——旧数据明明在那儿，却读不到。
 *     不带版本号 = 按库里现有的版本打开，不触发升级、不会版本冲突。
 *  2. **不先用 `indexedDB.databases()` 判断"库在不在"**。那个枚举接口在页面还没
 *     碰过 IndexedDB 时可能返回空列表（Chrome 的实际行为），结果就是把"有旧数据"
 *     误判成"没有"，静默跳过搬家提示。现在改成直接打开：库不存在时会被创建一个
 *     空的（没有任何表），后面靠"有没有 snapshots 表"来判定——宁可多建一个空库，
 *     也不能把用户的数据看漏。
 */
function openLegacy(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(LEGACY_DB)
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('打不开浏览器旧数据库'))
    open.onblocked = () => reject(new Error('浏览器旧数据库被其他标签页占用，请关掉其他页面重试'))
  })
}

export interface LegacyPreview {
  available: boolean
  cards: number
  audio: number
  images: number
  lyrics: number
  playlists: number
  presets: number
  /** 探测过程出的问题（读不到旧库时写在这里，界面上如实显示，别静默） */
  note?: string
}

const EMPTY_PREVIEW: LegacyPreview = {
  available: false,
  cards: 0,
  audio: 0,
  images: 0,
  lyrics: 0,
  playlists: 0,
  presets: 0,
}

/** 看看浏览器里还剩多少旧数据（只读，不改动任何东西） */
export async function peekLegacyData(): Promise<LegacyPreview> {
  if (typeof indexedDB === 'undefined') return { ...EMPTY_PREVIEW, note: '这个浏览器没有 IndexedDB' }
  let db: IDBDatabase
  try {
    db = await openLegacy()
  } catch (err) {
    return { ...EMPTY_PREVIEW, note: err instanceof Error ? err.message : String(err) }
  }
  try {
    if (!db.objectStoreNames.contains(STORES.snapshots)) {
      // 库不存在时会被打开动作创建一个空的：这里就是"本来没有旧数据"的正常情况
      return { ...EMPTY_PREVIEW, note: `浏览器里没有旧数据（建了一个空库 v${db.version}）` }
    }
    const readAll = async <T>(store: string): Promise<T[]> =>
      db.objectStoreNames.contains(store)
        ? await req(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>)
        : []
    const snapshots = await readAll<Snapshot>(STORES.snapshots)
    const audio = await readAll<{ id: string }>(STORES.audio)
    return {
      available: true,
      cards: snapshots.length,
      audio: audio.length,
      images: snapshots.filter((s) => s.state?.background?.dataUrl).length,
      lyrics: snapshots.filter((s) => s.audio?.lyricText).length,
      playlists: (await readAll<Playlist>(STORES.playlists)).length,
      presets: (await readAll<TagPreset>(STORES.tagPresets)).length,
      note: `浏览器旧库 v${db.version}，${snapshots.length} 张卡片`,
    }
  } catch (err) {
    return { ...EMPTY_PREVIEW, note: `读取旧库失败：${err instanceof Error ? err.message : String(err)}` }
  } finally {
    db.close()
  }
}

export interface MigrateResult {
  cards: number
  audio: number
  playlists: number
  presets: number
  draft: boolean
  skipped: string[]
}

export interface MigrateProgress {
  done: number
  total: number
  current: string
}

/**
 * 真正搬数据：卡片 → 音频 → 歌单/预设/背景草稿。
 * 顺序不能反：音频要挂在已存在的卡片上。
 */
export async function migrateLegacyToServer(
  onProgress?: (p: MigrateProgress) => void,
): Promise<MigrateResult> {
  const db = await openLegacy()
  const result: MigrateResult = { cards: 0, audio: 0, playlists: 0, presets: 0, draft: false, skipped: [] }
  try {
    const readAll = async <T>(store: string): Promise<T[]> =>
      db.objectStoreNames.contains(store)
        ? await req(db.transaction(store, 'readonly').objectStore(store).getAll() as IDBRequest<T[]>)
        : []

    const snapshots = await readAll<Snapshot>(STORES.snapshots)
    const audioRecords = await readAll<{ id: string; blob: Blob; meta: AudioMeta }>(STORES.audio)
    const audioById = new Map(audioRecords.map((a) => [a.id, a]))

    let done = 0
    for (const card of snapshots) {
      try {
        // 卡片先落库（含音频元信息、歌词时间轴、配图 dataUrl）
        await apiPut(`/cards/${encodeURIComponent(card.id)}`, card)
        result.cards++
      } catch (err) {
        result.skipped.push(`${card.label}：${err instanceof Error ? err.message : String(err)}`)
        done++
        continue
      }
      // 音频本体单独上传，元信息照抄
      const rec = audioById.get(card.id)
      if (rec?.blob && card.audio) {
        try {
          await restoreAudio(card.id, rec.blob, card.audio)
          result.audio++
        } catch (err) {
          result.skipped.push(`${card.label} 的音频：${err instanceof Error ? err.message : String(err)}`)
        }
      }
      onProgress?.({ done: ++done, total: snapshots.length, current: card.label })
    }

    for (const p of await readAll<Playlist>(STORES.playlists)) {
      await apiPut(`/kv/playlists/${encodeURIComponent(p.id)}`, p)
      result.playlists++
    }
    for (const p of await readAll<TagPreset>(STORES.tagPresets)) {
      await apiPut(`/kv/tagPresets/${encodeURIComponent(p.id)}`, p)
      result.presets++
    }
    const drafts = await readAll<{ id: string; value: unknown }>(STORES.draft)
    const bg = drafts.find((d) => d.id === 'background')
    if (bg) {
      await apiPut('/kv/draft/background', bg)
      result.draft = true
    }

    // 清掉旧的"当前背景" localStorage 草稿？不动：那是界面状态，迁移不碰它。
    markMigrationDone()
    return result
  } finally {
    db.close()
  }
}

/** 服务端库里现在有多少卡片（决定要不要提示迁移） */
export async function serverCardCount(): Promise<number> {
  const { cards } = await apiGet<{ cards: Snapshot[] }>('/cards')
  return cards.length
}

/** 供"彻底重来"用：清空服务端库（卡片 + 音频） */
export async function clearServerLibrary(): Promise<void> {
  await apiPost('/cards/clear', {})
}

export type { Snapshot, SnapshotState }
