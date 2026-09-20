import { useEffect, useRef, useState } from 'react'
import { cachedCardBackground, loadCardBackground, type Snapshot } from './snapshots'
import type { CardBackground } from '../../shared/scene'

/**
 * 取一张卡片的配图。
 *
 * 列表接口不下发配图（一张 1–3MB，整库一起返回就是十几到上百 MB），所以凡是要
 * **完整画质**的地方——详情大图、歌词页背景——都得走这里按需取一次。取回来之前
 * 先用 240px 缩略图顶着：不占位的话点开详情会先白一下；缩略图放大会有点软，
 * 正好读作"正在对焦"，而不是"图糊了"。
 *
 * 缓存与请求去重都在 `snapshots.ts` 里，这个 hook 只负责把结果接到组件上。
 */
export function useCardBackground(snapshot: Snapshot | null | undefined): {
  /** 完整配图（取回前为 null） */
  background: CardBackground | null
  /** 取回前拿来顶着的缩略图版本 */
  placeholder: CardBackground | null
  loading: boolean
} {
  const ref = useRef(snapshot)
  ref.current = snapshot
  const id = snapshot?.id ?? null
  const version = snapshot?.updatedAt ?? 0

  const [background, setBackground] = useState<CardBackground | null>(
    snapshot ? cachedCardBackground(snapshot) : null,
  )
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const current = ref.current
    if (!current) {
      setBackground(null)
      setLoading(false)
      return
    }
    const cached = cachedCardBackground(current)
    if (cached) {
      setBackground(cached)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void loadCardBackground(current)
      .then((next) => {
        if (!alive) return
        setBackground(next)
        setLoading(false)
      })
      .catch(() => {
        // 取不到就退回缩略图/主题底，不把整页拖垮
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // 依赖用 id + 版本号：列表每次刷新对象引用都变，直接依赖对象会反复重取
  }, [id, version])

  const direct = snapshot?.state.background
  const placeholder: CardBackground | null =
    direct && snapshot?.thumb
      ? // 把服务端给的体积一并带上，这样"读取中"时也能显示正确的大小
        { dataUrl: snapshot.thumb, scrim: direct.scrim, bytes: direct.bytes }
      : null

  return { background, placeholder, loading }
}
