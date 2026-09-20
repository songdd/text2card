import { useCallback, useEffect, useState } from 'react'
import {
  deletePlaylist,
  listPlaylists,
  makeId,
  putPlaylist,
  type Playlist,
} from './snapshots'

/**
 * 命名歌单的读写。
 *
 * 放在 App 层持有（而不是各处各调一次 hook）：歌单要同时被「队列面板的存为歌单」
 * 和「管理页的歌单菜单」用到，两处各持一份 state 一定会不同步——存完看不到、
 * 删完还在列表里，这类 bug 很难查。
 */
export interface PlaylistsState {
  items: Playlist[]
  loading: boolean
  /** 新建或覆盖（同 id 即覆盖）；返回写好的那条 */
  save: (input: { id?: string; name: string; cardIds: string[] }) => Promise<Playlist | null>
  remove: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function usePlaylists({
  onNotify,
}: {
  onNotify?: (kind: 'ok' | 'err', message: string) => void
} = {}): PlaylistsState {
  const [items, setItems] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      setItems(await listPlaylists())
    } catch (err) {
      onNotify?.('err', `读取歌单失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [onNotify])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(
    async (input: { id?: string; name: string; cardIds: string[] }) => {
      const name = input.name.trim()
      if (!name) {
        onNotify?.('err', '歌单名称不能为空')
        return null
      }
      if (!input.cardIds.length) {
        onNotify?.('err', '这个队列里没有可保存的卡片')
        return null
      }
      try {
        const existing = input.id ? items.find((p) => p.id === input.id) : undefined
        const now = Date.now()
        const record: Playlist = {
          id: input.id ?? makeId(),
          name,
          cardIds: input.cardIds,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }
        await putPlaylist(record)
        setItems(await listPlaylists())
        onNotify?.('ok', existing ? `已更新歌单「${name}」` : `已存为歌单「${name}」（${input.cardIds.length} 首）`)
        return record
      } catch (err) {
        onNotify?.('err', `保存歌单失败：${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    },
    [items, onNotify],
  )

  const remove = useCallback(
    async (id: string) => {
      try {
        const target = items.find((p) => p.id === id)
        await deletePlaylist(id)
        setItems(await listPlaylists())
        onNotify?.('ok', `已删除歌单「${target?.name ?? ''}」`)
      } catch (err) {
        onNotify?.('err', `删除歌单失败：${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [items, onNotify],
  )

  return { items, loading, save, remove, refresh }
}
