import { forwardRef } from 'react'
import { PoetryCard } from './cards/PoetryCard'
import { poetryThemes } from '../themes/poetryThemes'
import { fontFamilyOf, isFontKey } from '../lib/fonts'
import type { SnapshotState } from '../lib/snapshots'

/**
 * 从一份 `SnapshotState` 渲染诗词卡。
 *
 * 这是全项目**唯一**的卡片渲染入口，四处共用：
 *   1. 编辑页预览（用实时状态拼出来的 state）
 *   2. 管理页的详情大图
 *   3. 批量导出时的离屏渲染
 *   4. 将来若要恢复多风格，也只在这里加分支
 *
 * 之所以要求「吃一整份 state」而不是散装 props：管理页和批量导出手里只有
 * 存下来的 state，散装 props 会让每一处都重新拼一遍主题/字体/尺寸，
 * 卡片长相就有了分叉的可能。
 */
export const SnapshotCard = forwardRef<HTMLDivElement, { state: SnapshotState }>(
  function SnapshotCard({ state }, ref) {
    const idx = Math.min(Math.max(state.themeIndex, 0), poetryThemes.length - 1)
    const theme = poetryThemes[idx] ?? poetryThemes[0]
    const font = isFontKey(state.fontKey) ? fontFamilyOf(state.fontKey) : undefined

    return (
      <PoetryCard
        ref={ref}
        text={state.text}
        theme={theme}
        size={state.size}
        title={state.title || undefined}
        author={state.author || undefined}
        vertical={state.vertical}
        compact={state.compact}
        background={state.background}
        font={font}
        fontScale={state.fontScale}
        showSeal={state.showSeal}
        showPunct={state.showPunct}
        inkText={state.inkText}
        inkAccent={state.inkAccent}
      />
    )
  },
)
