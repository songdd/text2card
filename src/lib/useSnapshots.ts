import { useCallback, useEffect, useRef, useState } from 'react'
import type { Style } from './classifier'
import {
  RECENT_LIMIT,
  addSnapshotTags,
  clearSnapshots,
  deleteSnapshot,
  labelOf,
  listSnapshots,
  makeId,
  saveSnapshot,
  setAudioMeta,
  setSnapshotTags,
  type AudioMeta,
  type Snapshot,
  type SnapshotState,
} from './snapshots'
import { makeThumb } from './thumb'

export interface SnapshotsState {
  items: Snapshot[]
  /** 首次读取中 */
  loading: boolean
  saving: boolean
  refresh: () => Promise<void>
  save: (state: SnapshotState, style: Style) => Promise<void>
  remove: (id: string) => Promise<void>
  removeMany: (ids: string[]) => Promise<void>
  clear: () => Promise<void>
  /** 就地改写一张卡片的标签（管理页快速加标签），返回写回后的记录 */
  setTags: (id: string, tags: string[]) => Promise<Snapshot | null>
  /** 给多张卡片**追加**标签，返回真正被改动的记录 */
  addTagsToMany: (ids: string[], add: string[]) => Promise<Snapshot[]>
  /** 就地改写音频元信息（歌词时间轴、偏移等） */
  setAudioMeta: (id: string, patch: Partial<AudioMeta>) => Promise<Snapshot | null>
}

interface Options {
  onNotify?: (kind: 'ok' | 'err', message: string) => void
}

export function useSnapshots({ onNotify }: Options = {}): SnapshotsState {
  const [items, setItems] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 用 ref 而不是 state 做重入保护：setState 是异步的，连点两下「保存」
  // 两次调用都会读到 saving=false，于是存下两条一模一样的快照。
  const savingRef = useRef(false)

  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify
  const notify = useCallback((kind: 'ok' | 'err', message: string) => {
    notifyRef.current?.(kind, message)
  }, [])

  const refresh = useCallback(async () => {
    try {
      setItems(await listSnapshots())
    } catch (err) {
      notify('err', `读取本地保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [notify])

  // 挂载时读一次。StrictMode 下会执行两次，但只是读，幂等。
  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (state: SnapshotState, style: Style) => {
      if (savingRef.current) return
      savingRef.current = true
      setSaving(true)
      try {
        // 缩略图在保存时生成一次：网格用它，避免把几 MB 的原图挂进列表
        const thumb = state.background?.dataUrl ? await makeThumb(state.background.dataUrl) : undefined
        const snapshot: Snapshot = {
          id: makeId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          label: labelOf(state),
          style,
          thumb,
          state,
        }

        const { kept, updated } = await saveSnapshot(snapshot)
        setItems(kept)
        notify('ok', updated ? `标题与作者相同，已更新「${snapshot.label}」` : '已保存到「最近」')
      } catch (err) {
        notify('err', `保存失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        savingRef.current = false
        setSaving(false)
      }
    },
    [notify],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteSnapshot(id)
        setItems(await listSnapshots())
      } catch (err) {
        notify('err', `删除失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [notify],
  )

  /** 批量删除：逐条删完只刷新一次列表，避免 N 次全量读取 */
  const removeMany = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return
      try {
        for (const id of ids) await deleteSnapshot(id)
        setItems(await listSnapshots())
        notify('ok', `已删除 ${ids.length} 张`)
      } catch (err) {
        notify('err', `删除失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [notify],
  )

  const clear = useCallback(async () => {
    try {
      await clearSnapshots()
      setItems([])
      notify('ok', '已清空全部保存')
    } catch (err) {
      notify('err', `清空失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [notify])

  /**
   * 标签就地改写。
   *
   * 只 patch 列表里那一条，不 `refresh()` 全量重读：连续打标签时每改一次就把
   * 几十条记录（含缩略图 data URL）重新读一遍，纯属浪费，而且会让列表在
   * 用户手底下闪。顺序也不会变——写回时刻意没刷新 updatedAt。
   */
  const setTags = useCallback(
    async (id: string, tags: string[]) => {
      try {
        const updated = await setSnapshotTags(id, tags)
        if (updated) setItems((prev) => prev.map((s) => (s.id === id ? updated : s)))
        return updated
      } catch (err) {
        notify('err', `保存标签失败：${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
    [notify],
  )

  const addTagsToMany = useCallback(
    async (ids: string[], add: string[]) => {
      try {
        const changed = await addSnapshotTags(ids, add)
        if (changed.length) {
          const patch = new Map(changed.map((s) => [s.id, s]))
          setItems((prev) => prev.map((s) => patch.get(s.id) ?? s))
        }
        return changed
      } catch (err) {
        notify('err', `批量加标签失败：${err instanceof Error ? err.message : String(err)}`)
        return []
      }
    },
    [notify],
  )

  /** 音频元信息就地改写（歌词时间轴、偏移）。同样只 patch 那一条。 */
  const setAudioMetaOf = useCallback(
    async (id: string, patch: Partial<AudioMeta>) => {
      try {
        const updated = await setAudioMeta(id, patch)
        if (updated) setItems((prev) => prev.map((s) => (s.id === id ? updated : s)))
        return updated
      } catch (err) {
        notify('err', `保存音频信息失败：${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
    [notify],
  )

  return {
    items,
    loading,
    saving,
    refresh,
    save,
    remove,
    removeMany,
    clear,
    setTags,
    addTagsToMany,
    setAudioMeta: setAudioMetaOf,
  }
}

export { RECENT_LIMIT }
