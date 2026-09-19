import { useCallback, useEffect, useRef, useState } from 'react'
import type { Style } from './classifier'
import {
  MAX_SNAPSHOTS,
  clearSnapshots,
  deleteSnapshot,
  labelOf,
  listSnapshots,
  makeId,
  saveSnapshotWithEviction,
  type Snapshot,
  type SnapshotState,
} from './snapshots'

export interface SnapshotsState {
  items: Snapshot[]
  /** 首次读取中 */
  loading: boolean
  saving: boolean
  refresh: () => Promise<void>
  save: (state: SnapshotState, style: Style) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

interface Options {
  onNotify?: (kind: 'ok' | 'err', message: string) => void
}

export function useSnapshots({ onNotify }: Options = {}): SnapshotsState {
  const [items, setItems] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // 用 ref 而不是 state 做重入保护：setState 是异步的，连点两下「保存」
  // 两次调用都会读到 saving=false，于是存下两条一模一样的快照、白白占掉 2/20。
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

  /**
   * 写入 + 淘汰。
   * 配额写满时不能直接报错放弃——淘汰最旧的一条再重试，用户才不会
   * 因为「存满 20 条」而彻底存不进新内容。
   */
  const save = useCallback(
    async (state: SnapshotState, style: Style) => {
      if (savingRef.current) return
      savingRef.current = true
      setSaving(true)
      try {
        const snapshot: Snapshot = {
          id: makeId(),
          createdAt: Date.now(),
          label: labelOf(state),
          style,
          state,
        }

        const { kept, removed, evictedForQuota } = await saveSnapshotWithEviction(snapshot)
        setItems(kept)

        if (evictedForQuota > 0) {
          notify('ok', `已保存（本地空间不足，额外淘汰了 ${evictedForQuota} 条旧记录）`)
        } else if (removed > 0) {
          notify('ok', `已保存（超出 ${MAX_SNAPSHOTS} 条，淘汰了最旧的 ${removed} 条）`)
        } else {
          notify('ok', '已保存到「最近」')
        }
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

  const clear = useCallback(async () => {
    try {
      await clearSnapshots()
      setItems([])
      notify('ok', '已清空全部保存')
    } catch (err) {
      notify('err', `清空失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [notify])

  return { items, loading, saving, refresh, save, remove, clear }
}
