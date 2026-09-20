/**
 * 诗词库的数据层。
 *
 * 数据住在 **本机的 SQLite 文件**（`data/library.sqlite`）与 `data/audio/` 里的真实
 * 音频文件，由 Node 侧的本地服务提供。为什么不再用 IndexedDB：浏览器把站点数据当
 * **可回收资源**，磁盘紧张时可能自动清理、清浏览数据也会一起没；文件放在项目目录里
 * 之后这些都不影响它，而且整个库就是一个能拷走的 sqlite 文件 + 一个 audio 文件夹。
 *
 * 代价（界面上会明确提示）：**必须跑着本地服务**才能读到数据。
 *
 * 这一层刻意保留了原有的函数签名与数据形状——界面、歌词、歌单、备份那些代码
 * 一行都不用改。真正"换存储"的只有下面这些实现。
 */

import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, apiPut, apiUpload } from './libraryApi'
import type { SizeMode } from '../components/CardFrame'
import type { FontKey } from './fonts'
import type { Style } from './classifier'
import { parsePoem } from './parsePoem'
import { normalizeTags } from './tags'
import type { CardBackground, SceneFields } from '../../shared/scene'

/**
 * 「最近」弹层显示几条。
 * 注意这不是保存上限——保存不设条数上限，这个数字只用来限制弹层列表的长度。
 */
export const RECENT_LIMIT = 20

/**
 * 单个音频文件上限。服务端也会再拦一道。
 * 200MB：普通 mp3 远远够用，同时拦得住"一个 1GB 无损把磁盘吃满"这种更糟的结局。
 */
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024

/** 卡片上关联的音频的元信息（音频本体是 data/audio/ 下的文件） */
export interface AudioMeta {
  /** 原始文件名，界面上显示它 */
  name: string
  /** MIME，浏览器给的，可能为空串 */
  type: string
  size: number
  /** 最后一次关联/更换的时间 */
  updatedAt: number
  /** 时长（秒）。浏览器解不出该格式时为 undefined，界面就不显示时长 */
  duration?: number
  /** 歌词时间轴原文（SRT / LRC 文本） */
  lyricText?: string
  /** 识别出的时间轴格式 */
  lyricFormat?: 'srt' | 'lrc'
  /** 歌词文本取自哪里 */
  lyricMode?: 'subtitle' | 'poem'
  /** 时间轴整体偏移（秒） */
  offset?: number
  /** 时间轴建立时的正文句数 */
  lyricClauses?: number
}

/** 一次快照要恢复的全部界面状态 */
export interface SnapshotState {
  text: string
  styleChoice: Style | 'auto'
  size: SizeMode
  themeIndex: number
  title: string
  author: string
  eyebrow: string
  vertical: boolean
  compact: boolean
  fontKey: FontKey
  fontScale: number
  showSeal: boolean
  showPunct: boolean
  /** 墨色覆盖（hex）。undefined = 跟随主题 */
  inkText?: string
  inkAccent?: string
  /** 标签 */
  tags?: string[]
  scene: SceneFields
  background: CardBackground | null
}

export interface Snapshot {
  id: string
  createdAt: number
  updatedAt?: number
  label: string
  style: Style
  thumb?: string
  /** 关联的音频元信息（不是音频本体） */
  audio?: AudioMeta
  state: SnapshotState
}

/** 组合标签预设 */
export interface TagPreset {
  id: string
  name: string
  combos: string[][]
  createdAt: number
  updatedAt: number
}

/** 命名歌单 */
export interface Playlist {
  id: string
  name: string
  cardIds: string[]
  createdAt: number
  updatedAt: number
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function labelOf(state: Pick<SnapshotState, 'title' | 'text'>): string {
  const title = state.title?.trim()
  if (title) return title.slice(0, 30)
  const parsed = parsePoem(state.text)
  if (parsed.title) return parsed.title.slice(0, 30)
  const line =
    state.text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? ''
  return line.slice(0, 30) || '未命名'
}

/**
 * 保存的键：**标题 + 作者**。标题为空时退回 `labelOf`，避免所有没填标题的内容挤在一格。
 */
export function snapshotKeyOf(state: Pick<SnapshotState, 'title' | 'author' | 'text'>): string {
  return `${labelOf(state)}\u0000${(state.author ?? '').trim()}`
}

/** 磁盘写满等错误统一成一句人话（服务端会把 OS 的错误信息带回来） */
export function isQuotaError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /QuotaExceeded|ENOSPC|no space|磁盘|空间不足/i.test(text)
}

// ------------------------------------------------------------------ 卡片

export async function listSnapshots(): Promise<Snapshot[]> {
  const { cards } = await apiGet<{ cards: Snapshot[] }>('/cards')
  return cards
}

export async function putSnapshot(snapshot: Snapshot): Promise<void> {
  await apiPut(`/cards/${encodeURIComponent(snapshot.id)}`, snapshot)
}

export async function deleteSnapshot(id: string): Promise<void> {
  await apiDelete(`/cards/${encodeURIComponent(id)}`)
}

export async function clearSnapshots(): Promise<void> {
  await apiPost('/cards/clear', {})
}

async function getSnapshot(id: string): Promise<Snapshot | null> {
  try {
    const { card } = await apiGet<{ card: Snapshot }>(`/cards/${encodeURIComponent(id)}`)
    return card
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null
    throw err
  }
}

export interface SaveResult {
  kept: Snapshot[]
  /** true 表示这次是覆盖了已有条目（标题 + 作者 相同），而不是新增 */
  updated: boolean
}

/**
 * 写入一条快照。
 *
 * 键（标题 + 作者）已存在时是**更新**而不是新增：内容整体替换、`updatedAt` 刷新、
 * 条目数不变、沿用原来的 id。**不设条数上限，也不淘汰旧数据。**
 */
export async function saveSnapshot(snapshot: Snapshot): Promise<SaveResult> {
  const key = snapshotKeyOf(snapshot.state)
  const existing = (await listSnapshots()).find((s) => snapshotKeyOf(s.state) === key)

  const now = Date.now()
  const record: Snapshot = existing
    ? {
        ...snapshot,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
        // 关联的音频挂在记录上，而编辑页的 state 里没有 audio 字段——
        // 不显式继承的话，改一个字再保存就会把音频关联弄丢
        audio: snapshot.audio ?? existing.audio,
      }
    : { ...snapshot, createdAt: now, updatedAt: now }

  try {
    await putSnapshot(record)
  } catch (err) {
    if (isQuotaError(err)) {
      throw new Error('本地磁盘空间不足，保存失败。请清理磁盘，或到「管理」页删掉一些卡片。')
    }
    throw err
  }

  return { kept: await listSnapshots(), updated: Boolean(existing) }
}

// ---------------------------------------------------------------- 标签就地编辑

export async function setSnapshotTags(id: string, tags: string[]): Promise<Snapshot | null> {
  try {
    const { card } = await apiPatch<{ card: Snapshot }>(`/cards/${encodeURIComponent(id)}`, { tags })
    return card
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null
    throw err
  }
}

export async function addSnapshotTags(ids: string[], add: string[]): Promise<Snapshot[]> {
  if (!ids.length || !add.length) return []
  const { changed } = await apiPost<{ changed: Snapshot[] }>('/cards/add-tags', { ids, add })
  return changed
}

// ---------------------------------------------------------------- 音频

/**
 * 给某张卡片关联（或更换）音频。
 *
 * 三次调用：读卡片 → 传音频文件 → 把元信息写回卡片。**不是原子的**（HTTP 没有跨资源的
 * 事务）：万一第三步失败，会剩下一个没有元信息的音频文件——重新关联一次就会覆盖它。
 * 这一点比"假装原子"更诚实，清理也简单。
 */
export async function associateAudio(
  snapshotId: string,
  file: Blob,
  info: { name: string; duration?: number },
): Promise<AudioMeta> {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error(
      `音频 ${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB 上限。建议先压成 mp3。`,
    )
  }
  const card = await getSnapshot(snapshotId)
  if (!card) throw new Error('卡片不存在，可能已被删除')

  const meta: AudioMeta = {
    name: info.name,
    type: file.type || '',
    size: file.size,
    updatedAt: Date.now(),
    duration: info.duration,
  }
  await apiUpload(`/audio/${encodeURIComponent(snapshotId)}?name=${encodeURIComponent(info.name)}`, file)
  await apiPatch(`/cards/${encodeURIComponent(snapshotId)}`, { audio: meta })
  return meta
}

/** 解除关联：删掉音频文件与卡片上的元信息 */
export async function removeAudioAssociation(snapshotId: string): Promise<void> {
  await apiPatch(`/cards/${encodeURIComponent(snapshotId)}`, { audio: null })
}

/** 取出音频本体（播放时才调用；列表页永远不会走到这里） */
export async function getAudioBlob(id: string): Promise<Blob | null> {
  return await apiDownload(`/audio/${encodeURIComponent(id)}`)
}

/** 从备份恢复音频：文件 + 元信息照抄 */
export async function restoreAudio(id: string, blob: Blob, meta: AudioMeta): Promise<void> {
  await apiUpload(`/audio/${encodeURIComponent(id)}?name=${encodeURIComponent(meta.name)}`, blob)
  await apiPatch(`/cards/${encodeURIComponent(id)}`, { audio: meta })
}

/**
 * 就地改写音频元信息（歌词时间轴、偏移等）。传 undefined 表示清掉该字段
 * （JSON 里没有 undefined，所以映射成 null，服务端遇到 null 就删键）。
 */
export async function setAudioMeta(
  snapshotId: string,
  patch: Partial<Omit<AudioMeta, 'updatedAt'>>,
): Promise<Snapshot | null> {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) payload[key] = value === undefined ? null : value
  try {
    const { card } = await apiPatch<{ card: Snapshot }>(`/cards/${encodeURIComponent(snapshotId)}`, {
      audio: payload,
    })
    return card
  } catch (err) {
    if ((err as { status?: number })?.status === 404) return null
    throw err
  }
}

// ------------------------------------------------------- 组合标签预设

function sanitizePreset(raw: TagPreset): TagPreset {
  return {
    id: raw.id,
    name: String(raw.name ?? '').trim().slice(0, 40) || '未命名预设',
    combos: Array.isArray(raw.combos)
      ? raw.combos.map((c) => (Array.isArray(c) ? c.map(String).filter(Boolean) : [])).filter((c) => c.length)
      : [],
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? Date.now(),
  }
}

export async function listTagPresets(): Promise<TagPreset[]> {
  const { items } = await apiGet<{ items: TagPreset[] }>('/kv/tagPresets')
  return items.map(sanitizePreset).sort((a, b) => a.createdAt - b.createdAt)
}

export async function putTagPreset(preset: TagPreset): Promise<void> {
  await apiPut(`/kv/tagPresets/${encodeURIComponent(preset.id)}`, sanitizePreset(preset))
}

export async function deleteTagPreset(id: string): Promise<void> {
  await apiDelete(`/kv/tagPresets/${encodeURIComponent(id)}`)
}

// ------------------------------------------------------------ 命名歌单

function sanitizePlaylist(raw: Playlist): Playlist {
  return {
    id: raw.id,
    name: String(raw.name ?? '').trim().slice(0, 40) || '未命名歌单',
    cardIds: Array.isArray(raw.cardIds) ? raw.cardIds.filter((x): x is string => typeof x === 'string') : [],
    createdAt: raw.createdAt ?? Date.now(),
    updatedAt: raw.updatedAt ?? raw.createdAt ?? Date.now(),
  }
}

export async function listPlaylists(): Promise<Playlist[]> {
  const { items } = await apiGet<{ items: Playlist[] }>('/kv/playlists')
  return items.map(sanitizePlaylist).sort((a, b) => a.createdAt - b.createdAt)
}

export async function putPlaylist(playlist: Playlist): Promise<void> {
  await apiPut(`/kv/playlists/${encodeURIComponent(playlist.id)}`, sanitizePlaylist(playlist))
}

export async function deletePlaylist(id: string): Promise<void> {
  await apiDelete(`/kv/playlists/${encodeURIComponent(id)}`)
}

// ---------------------------------------------------------------- 当前背景草稿

export async function loadDraftBackground(): Promise<CardBackground | null> {
  const { items } = await apiGet<{ items: { id: string; value: CardBackground | null }[] }>('/kv/draft')
  return items.find((i) => i.id === 'background')?.value ?? null
}

export async function saveDraftBackground(value: CardBackground | null): Promise<void> {
  await apiPut('/kv/draft/background', { id: 'background', value })
}

export { normalizeTags }
