/**
 * 「最近保存」的持久化层。
 *
 * 为什么用 IndexedDB 而不是 localStorage：一次快照里含 AI 背景图（data URL，
 * 一张 2K 图约 1.5MB），而 localStorage 配额通常只有 5MB 且是同步阻塞的，
 * 存两三次就会把整个站点写挂。IndexedDB 配额是几百 MB 级别，异步、不阻塞渲染。
 *
 * 只保留最近 MAX_SNAPSHOTS 条，超出按时间淘汰最旧的。
 */

import type { Style } from './classifier'
import type { SizeMode } from '../components/CardFrame'
import type { FontKey } from './fonts'
import { parsePoem } from './parsePoem'
import type { CardBackground, SceneFields } from '../../shared/scene'

export const MAX_SNAPSHOTS = 20

const DB_NAME = 'text2card'
const DB_VERSION = 1
const STORE = 'snapshots'

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
  /** 正文与标题的字号倍率 */
  fontScale: number
  /** 诗词卡：显示印章 / 显示标点符号 */
  showSeal: boolean
  showPunct: boolean
  scene: SceneFields
  background: CardBackground | null
}

export interface Snapshot {
  id: string
  createdAt: number
  /** 列表上显示的名字：优先标题，否则正文首行 */
  label: string
  /** 保存时生效的风格，用于列表上的小标签 */
  style: Style
  state: SnapshotState
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error('IndexedDB 请求失败'))
  })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB（隐私模式下可能被禁用）'))
      return
    }
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error ?? new Error('无法打开本地数据库'))
    open.onblocked = () => reject(new Error('本地数据库被其他标签页占用，请关掉其他页面重试'))
  })
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function labelOf(state: Pick<SnapshotState, 'title' | 'text'>): string {
  const title = state.title?.trim()
  if (title) return title.slice(0, 30)
  // 正文里常带《题目》这类标注行，交给解析器取一个干净的题目——
  // 否则列表上会显示成「《江雪》」这种带书名号的原文行
  const parsed = parsePoem(state.text)
  if (parsed.title) return parsed.title.slice(0, 30)
  const line =
    state.text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? ''
  return line.slice(0, 30) || '未命名'
}

/** 按时间倒序返回全部快照 */
export async function listSnapshots(): Promise<Snapshot[]> {
  const db = await openDb()
  try {
    const store = db.transaction(STORE, 'readonly').objectStore(STORE)
    const all = await req(store.getAll() as IDBRequest<Snapshot[]>)
    return all.sort((a, b) => b.createdAt - a.createdAt)
  } finally {
    db.close()
  }
}

export async function putSnapshot(snapshot: Snapshot): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(snapshot)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('写入本地数据库失败'))
      tx.onabort = () => reject(tx.error ?? new Error('写入被中止'))
    })
  } finally {
    db.close()
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('删除失败'))
      tx.onabort = () => reject(tx.error ?? new Error('删除被中止'))
    })
  } finally {
    db.close()
  }
}

export async function clearSnapshots(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('清空失败'))
      tx.onabort = () => reject(tx.error ?? new Error('清空被中止'))
    })
  } finally {
    db.close()
  }
}

/**
 * 淘汰超出上限的旧快照，返回保留后的列表。
 * 额外返回被删掉的条数，方便界面给出如实反馈。
 */
export async function pruneSnapshots(limit = MAX_SNAPSHOTS): Promise<{ kept: Snapshot[]; removed: number }> {
  const all = await listSnapshots()
  const excess = all.slice(limit)
  for (const s of excess) {
    await deleteSnapshot(s.id)
  }
  return { kept: all.slice(0, limit), removed: excess.length }
}

/** 配额写满这类错误需要区别对待：它可以通过淘汰旧数据重试来解决 */
export function isQuotaError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name ?? ''
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

export interface SaveResult {
  kept: Snapshot[]
  /** 因超出条数上限而淘汰的条数 */
  removed: number
  /** 因配额写满而额外淘汰的条数 */
  evictedForQuota: number
}

/**
 * 写入一条快照，并维持条数上限。
 *
 * 配额写满不能当成「保存失败」直接放弃：那意味着用户一旦存到某个体积就再也
 * 存不进新内容，且没有任何自救手段。这里淘汰最旧的一条再重试，
 * 最多重试 QUOTA_RETRIES 次。
 */
export async function saveSnapshotWithEviction(
  snapshot: Snapshot,
  limit = MAX_SNAPSHOTS,
): Promise<SaveResult> {
  const QUOTA_RETRIES = 3
  let evictedForQuota = 0

  for (;;) {
    try {
      await putSnapshot(snapshot)
      break
    } catch (err) {
      if (!isQuotaError(err) || evictedForQuota >= QUOTA_RETRIES) throw err
      const all = await listSnapshots()
      const oldest = all[all.length - 1]
      if (!oldest) throw err
      await deleteSnapshot(oldest.id)
      evictedForQuota++
    }
  }

  const { kept, removed } = await pruneSnapshots(limit)
  return { kept, removed, evictedForQuota }
}
