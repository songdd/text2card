import { useLayoutEffect, useRef, useState } from 'react'
import { SnapshotCard } from './SnapshotCard'
import type { SnapshotState } from '../lib/snapshots'

/** 卡片的设计宽度：编辑页预览、导出一致按这个宽度渲染 */
function baseWidthOf(state: SnapshotState): number {
  return state.size === 'landscape' ? 1920 : 1080
}

/** 未测量前的兜底高度，避免首帧塌成 0 造成跳动 */
function roughHeightOf(state: SnapshotState, scale: number): number {
  const base = state.size === 'landscape' ? 1080 : state.size === 'portrait' ? 1440 : 900
  return base * scale
}

/**
 * 把真实卡片按目标宽度等比缩放着显示。
 *
 * 与 `Preview.tsx` 同一套做法（绝对定位 + `transform: scale` + 量高占位），
 * 但这里额外承担两个用途：
 *   - 管理页网格里的**迷你卡片**（背景传进来的是 240px 缩略图，不是原图）
 *   - 详情灯箱里的大图预览
 *
 * 之所以不各写一套小卡片样式：卡片长相必须只有一处定义，否则网格预览和导出
 * 迟早长得不一样。
 */
export function ScaledCard({
  state,
  width,
  className = '',
  shadow,
}: {
  state: SnapshotState
  width: number
  className?: string
  shadow?: boolean
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const scale = width > 0 ? width / baseWidthOf(state) : 0
  const [height, setHeight] = useState(() => roughHeightOf(state, scale))

  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el || !scale) return
    const update = () => setHeight(el.offsetHeight * scale)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scale, state])

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ width: width || undefined, height: height || undefined }}
    >
      <div
        ref={innerRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          boxShadow: shadow ? '0 18px 40px -20px rgba(0,0,0,0.35)' : undefined,
        }}
      >
        <SnapshotCard state={state} />
      </div>
    </div>
  )
}
