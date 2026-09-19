import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { SIZE_DIMENSIONS, type SizeMode } from './CardFrame'

interface Props {
  size: SizeMode
  children: ReactNode
  className?: string
  onFitContent?: () => void
}

/** 卡片内是否有元素被 overflow:hidden 截断（固定尺寸下内容放不下） */
function hasClippedContent(root: HTMLElement | null): boolean {
  if (!root) return false
  const nodes = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
  return nodes.some((el) => el.scrollHeight > el.clientHeight + 2)
}

export function Preview({ size, children, className = '', onFitContent }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [innerHeight, setInnerHeight] = useState(0)
  const [clipped, setClipped] = useState(false)

  useEffect(() => {
    function compute() {
      const wrap = wrapRef.current
      if (!wrap) return
      const dim = SIZE_DIMENSIONS[size]
      // 实测内边距，移动端 p-4 / 桌面 p-12 两套都准（曾写死 96 = p-12 两侧）
      const cs = getComputedStyle(wrap)
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const availW = wrap.clientWidth - padX
      const availH = wrap.clientHeight - padY
      const measuredH = innerRef.current?.offsetHeight ?? dim.height ?? dim.minHeight ?? 900
      const s = Math.min(availW / dim.width, availH / measuredH, 1)
      setScale(s)
      setInnerHeight(measuredH)
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (wrapRef.current) ro.observe(wrapRef.current)
    if (innerRef.current) ro.observe(innerRef.current)
    return () => ro.disconnect()
  }, [size])

  // 溢出检测：卡片内容（含 Shiki 异步高亮）变化时重新检查。
  // 固定尺寸下卡片外框尺寸不变，ResizeObserver 收不到通知，需用 MutationObserver。
  useEffect(() => {
    let raf = 0
    const check = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setClipped(hasClippedContent(innerRef.current)))
    }
    check()
    const mo = new MutationObserver(check)
    if (innerRef.current) {
      mo.observe(innerRef.current, { childList: true, subtree: true, characterData: true })
    }
    return () => {
      mo.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [size, children])

  const dim = SIZE_DIMENSIONS[size]
  const scaledH = (innerHeight || dim.height || dim.minHeight || 900) * scale

  return (
    <div
      ref={wrapRef}
      className={`preview-scroll canvas-bg relative h-full flex-1 items-center justify-center overflow-auto p-4 md:p-12 ${className}`}
    >
      {clipped && (
        <div className="absolute left-1/2 top-4 z-10 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-amber-600/95 py-1.5 pl-4 pr-1.5 text-xs font-medium text-white shadow-sm">
          <span>内容超出卡片，导出将被截断</span>
          {size !== 'auto' && onFitContent && (
            <button
              onClick={onFitContent}
              className="shrink-0 rounded-full bg-white/25 px-2.5 py-1 font-medium transition hover:bg-white/35"
            >
              切到自适应
            </button>
          )}
        </div>
      )}

      {/*
        预览缩放读数。
        自适应模式下卡片会随内容长高，而 Preview 会把整张卡等比缩放到适应视口，
        于是背景图、文字、印章「一起」变小——容易被误读成背景图自己变了大小。
        把真实尺寸与缩放比例显示出来，这件事就自解释了。
        注意它挂在预览容器上，不在 cardRef 里，所以不会被导出。
      */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-ink-800/70 px-2.5 py-1 text-[11px] tabular-nums text-white/90">
        {dim.width} × {Math.round(innerHeight || dim.height || dim.minHeight || 900)} · 预览{' '}
        {Math.round(scale * 100)}%
      </div>

      <div
        style={{
          width: dim.width * scale,
          height: scaledH,
          position: 'relative',
        }}
      >
        <div
          ref={innerRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            boxShadow: '0 30px 80px -30px rgba(0,0,0,0.35), 0 12px 24px -12px rgba(0,0,0,0.18)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
