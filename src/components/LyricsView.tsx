import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  GripHorizontal,
  LayoutList,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  Settings2,
  X,
} from 'lucide-react'
import { isPlayingId, seek, togglePlay, useAudioPlayer, useMediaTime } from '../lib/audioPlayer'
import { activeLineIndex, resolveLyrics, type LyricLine } from '../lib/lyrics'
import {
  LYRIC_FONT_FACTOR,
  LYRIC_FONT_LABEL,
  LYRIC_PANEL_HINT,
  LYRIC_PANEL_LABEL,
  LYRIC_STYLE_HINT,
  LYRIC_STYLE_LABEL,
  MINI_OPACITY_MIN,
  setLyricPrefs,
  useLyricPrefs,
  type LyricFontScale,
  type LyricPanel,
  type LyricStyle,
  type MiniPos,
} from '../lib/lyricPrefs'
import { formatDuration } from '../lib/format'
import { poetryThemes } from '../themes/poetryThemes'
import type { Snapshot } from '../lib/snapshots'

/**
 * 全屏歌词页（四种显示方式 + 可拖动小窗）。
 *
 * 为什么提供多种而不是只留一种：同一份歌词，**看的目的不同**——
 * 听读要居中大字，长诗要一屏多看几行，跟读/投屏要一句怼满屏，
 * 而竖排是这套卡片本身的样子（横排歌词配竖排卡片，气质是断的）。
 * 所以样式做成可切换并记忆，默认仍是居中卡拉OK（不改变既有习惯）。
 *
 * 滚动一律用 `transform` 平移，不用 `scrollTop`：后者在长列表里会抖，
 * 而且没法做成"当前句精确停在某个位置"。
 */

/** 小窗离屏幕边缘的最小留白（也是拖动时的夹取边界） */
const MINI_MARGIN = 4

/** 把坐标夹进视口内：小窗**整体**留在屏内，标题栏永远够得着（否则拖飞了就再也拿不回来） */
function clampMiniPos(pos: MiniPos, width: number, height: number): MiniPos {
  const maxX = Math.max(MINI_MARGIN, window.innerWidth - width - MINI_MARGIN)
  const maxY = Math.max(MINI_MARGIN, window.innerHeight - height - MINI_MARGIN)
  // 取整：DOM 里量出来的 rect 带亚像素（295.25 这种），存进偏好里不好看也没必要
  return {
    x: Math.round(Math.min(Math.max(MINI_MARGIN, pos.x), maxX)),
    y: Math.round(Math.min(Math.max(MINI_MARGIN, pos.y), maxY)),
  }
}

/** 每种样式的基础字号（会再乘字号档位） */
const BASE = {
  center: { active: 24, idle: 18, line: 56 },
  compact: { active: 17, idle: 15, line: 36 },
  single: { active: 40, idle: 40, line: 80 },
  vertical: { active: 20, idle: 20, col: 32 },
}

export function LyricsView({
  snapshot,
  onClose,
  onOffset,
}: {
  snapshot: Snapshot
  onClose: () => void
  /** 微调时间轴整体偏移（秒），落库到音频元信息 */
  onOffset: (delta: number) => void
}) {
  const player = useAudioPlayer()
  const prefs = useLyricPrefs()
  const { time, duration } = useMediaTime()
  const [styleOpen, setStyleOpen] = useState(false)
  /**
   * 拖动中的实时坐标：只放 state、**不立刻落盘**。
   * 理由：移动事件一秒能来上百次，每次都写 localStorage 是白费力气（而且同步写会卡手），
   * 松手时才写一次。渲染用 dragPos ?? prefs.miniPos，所以拖动本身是跟手的。
   */
  const [dragPos, setDragPos] = useState<MiniPos | null>(null)
  const [dragging, setDragging] = useState(false)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const appearanceRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** 拖动状态放 ref：两次 pointer 事件之间不能指望有一次 React 重渲染 */
  const dragRef = useRef<{ dx: number; dy: number; w: number; h: number; pos: MiniPos | null } | null>(null)
  const mini = prefs.panel === 'mini'
  const miniPos = dragPos ?? prefs.miniPos

  const resolved = useMemo(
    () => resolveLyrics(snapshot.state.text, snapshot.audio),
    [snapshot.state.text, snapshot.audio],
  )
  const lines = resolved.lines
  const index = activeLineIndex(lines, time)
  const playing = isPlayingId(player, snapshot.id)
  const offset = snapshot.audio?.offset ?? 0
  const factor = LYRIC_FONT_FACTOR[prefs.fontScale]

  // 句数变了说明正文改过，字幕时间轴可能对不上了——如实提示，不假装没事
  const clauseMismatch =
    snapshot.audio?.lyricClauses !== undefined &&
    lines.length > 0 &&
    resolved.source !== 'proportional' &&
    snapshot.audio.lyricClauses !== lines.length

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // 由内到外逐层收：先收浮层，再收整页——不然调着透明度一按 Esc 整页都没了
        if (appearanceOpen) setAppearanceOpen(false)
        else if (styleOpen) setStyleOpen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, styleOpen, appearanceOpen])

  // 窗口被缩小/换成竖屏后，原来的坐标可能已经在屏外了——夹回来，不然小窗就"丢"了
  useEffect(() => {
    if (!mini || !prefs.miniPos) return
    function reclamp() {
      const saved = prefs.miniPos
      const el = panelRef.current
      if (!saved || !el) return
      const next = clampMiniPos(saved, el.offsetWidth, el.offsetHeight)
      if (next.x !== saved.x || next.y !== saved.y) setLyricPrefs({ miniPos: next })
    }
    reclamp()
    window.addEventListener('resize', reclamp)
    return () => window.removeEventListener('resize', reclamp)
  }, [mini, prefs.miniPos])

  /** 标题栏按下即开始拖（按钮除外——点"整屏/关闭"不能被拖动吞掉） */
  function onDragStart(e: React.PointerEvent<HTMLElement>) {
    if (!mini) return
    if ((e.target as HTMLElement).closest('button')) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragRef.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
      pos: null,
    }
    setDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // 个别输入设备给不了捕获：退化成普通移动事件，拖拽体验差一点但不影响使用
    }
  }

  function onDragMove(e: React.PointerEvent<HTMLElement>) {
    const d = dragRef.current
    if (!d) return
    const pos = clampMiniPos({ x: e.clientX - d.dx, y: e.clientY - d.dy }, d.w, d.h)
    d.pos = pos
    setDragPos(pos)
  }

  function onDragEnd() {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    setDragPos(null)
    if (d?.pos) setLyricPrefs({ miniPos: d.pos })
  }

  /** 双击标题栏回到默认位置（拖到不喜欢的地方时不用在屏幕上找角度） */
  function onDragReset(e: React.MouseEvent<HTMLElement>) {
    if (!mini) return
    if ((e.target as HTMLElement).closest('button')) return
    setLyricPrefs({ miniPos: null })
  }

  return (
    <div
      ref={panelRef}
      // 小窗：底色透明度可调、默认不描边——它只是浮在内容上的一层歌词，不该像一扇窗
      // 文字本身**不跟着变淡**（否则 30% 透明度下就完全没法读了），加一层淡淡的白描边保证压在花背景上也看得清
      style={
        mini
          ? {
              backgroundColor: `rgba(255, 255, 255, ${prefs.miniOpacity})`,
              textShadow: '0 0 5px rgba(255, 255, 255, 0.75)',
              ...(miniPos ? { left: miniPos.x, top: miniPos.y, right: 'auto', bottom: 'auto' } : {}),
            }
          : undefined
      }
      className={
        prefs.panel === 'mini'
          ? // 小窗：默认右下角悬浮，**点外面不关**（不然一边干活一边看歌词根本用不了）
            // 拖过之后位置改由 style 决定，md: 的兜底位置会被 style 覆盖
            `fixed bottom-[4.5rem] right-3 z-50 w-[21rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl shadow-lg backdrop-blur md:bottom-[3.75rem] md:right-4 ${
              prefs.miniBorder ? 'border border-ink-200' : ''
            }`
          : 'fixed inset-0 z-50 isolate flex flex-col'
      }
      role="dialog"
      aria-modal={prefs.panel !== 'mini'}
      aria-label="歌词"
    >
      {prefs.panel !== 'mini' && <LyricBackdrop snapshot={snapshot} show={prefs.showBackground} />}

      <header
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onDoubleClick={onDragReset}
        title={mini ? '按住标题栏拖到任意位置 · 双击回到右下角' : undefined}
        className={
          prefs.panel === 'mini'
            ? `relative flex items-center justify-between gap-2 px-3 py-2 select-none touch-none ${
                prefs.miniBorder ? 'border-b border-ink-100' : ''
              } ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`
            : 'relative flex shrink-0 items-center justify-between gap-3 border-b border-ink-200/60 bg-white/60 px-4 py-3 backdrop-blur'
        }
      >
        <div className="flex min-w-0 items-center gap-1">
          {/* 抓手：告诉人"这里能拖"（整条标题栏都能拖，图标只是提示） */}
          {prefs.panel === 'mini' && (
            <GripHorizontal className={`h-4 w-4 shrink-0 ${dragging ? 'text-ink-600' : 'text-ink-300'}`} aria-hidden />
          )}
          {/* 诗词一律「诗名 - 作者」：这里是标题，不是歌词来源的说明牌 */}
          <span
            className={`truncate font-serif font-semibold text-ink-800 ${
              prefs.panel === 'mini' ? 'text-sm' : 'text-lg'
            }`}
          >
            {snapshot.label}
            {snapshot.state.author && <span className="font-normal text-ink-500"> - {snapshot.state.author}</span>}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* 小窗外观（透明度/边框/字号）：小窗很窄，只有图标 */}
          {prefs.panel === 'mini' && (
            <button
              ref={appearanceRef}
              onClick={() => setAppearanceOpen((v) => !v)}
              aria-label="小窗外观"
              aria-expanded={appearanceOpen}
              title="小窗透明度、边框、字号"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
          {/* 形态切换：小窗 ↔ 整屏，就在标题栏上，一眼能找到 */}
          <button
            onClick={() => setLyricPrefs({ panel: prefs.panel === 'mini' ? 'full' : 'mini' })}
            aria-label={prefs.panel === 'mini' ? '切换到整屏歌词' : '切换到小窗歌词'}
            title={prefs.panel === 'mini' ? '切换到整屏' : '切换到小窗（不挡手上的活）'}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
          >
            {prefs.panel === 'mini' ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            {prefs.panel === 'mini' ? '整屏' : '小窗'}
          </button>
          <button
            onClick={onClose}
            aria-label="关闭歌词"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className={`relative flex-1 overflow-hidden ${prefs.panel === 'mini' ? '' : 'min-h-0'}`}>
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-ink-500">
              {duration <= 0 ? '读不出这段音频的时长，无法滚动歌词' : '正文是空的，没有歌词可显示'}
            </p>
            <p className="text-xs text-ink-400">
              {duration <= 0
                ? '换一个格式更规范的音频（mp3 / m4a）通常能读出时长'
                : '在编辑页补上诗词正文即可'}
            </p>
          </div>
        ) : prefs.panel === 'mini' ? (
          <MiniStage lines={lines} index={index} factor={factor} />
        ) : (
          <LyricStage lines={lines} index={index} style={prefs.style} factor={factor} />
        )}
      </div>

      {/*
        整屏才有底部控制条：小窗**只放歌词**。
        播放/进度/时间在底部播放条上常驻，小窗再放一份就是重复占地方。
      */}
      {prefs.panel === 'full' && (
        <footer className="relative flex shrink-0 flex-col gap-2 border-t border-ink-200/60 bg-white/70 px-4 py-3 backdrop-blur">
          {clauseMismatch && (
            <p className="text-[11px] leading-relaxed text-amber-600">
              正文句数（{lines.length}）与建立时间轴时（{snapshot.audio?.lyricClauses}）不一致，
              时间轴可能已经错位，建议重新导入字幕。
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void togglePlay(snapshot.id)}
              aria-label={playing ? '暂停' : '播放'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-800 text-white transition hover:bg-ink-900"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </button>
            <input
              type="range"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.1}
              value={Math.min(time, duration || 1)}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="播放进度"
              disabled={duration <= 0}
              style={{ ['--pct' as string]: `${duration > 0 ? Math.min(100, (time / duration) * 100) : 0}%` }}
              className="player-range min-w-0 flex-1"
            />
            <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
              {formatDuration(time) || '0:00'} / {duration > 0 ? formatDuration(duration) : '--:--'}
            </span>
            <span className="flex shrink-0 items-center gap-1" title="整体微调时间轴">
              <button
                onClick={() => onOffset(-0.2)}
                aria-label="时间轴提前 0.2 秒"
                className="flex h-6 w-6 items-center justify-center rounded border border-ink-200 text-ink-500 transition hover:border-ink-400 hover:text-ink-800"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-10 text-center text-[11px] tabular-nums text-ink-500">
                {offset > 0 ? '+' : ''}
                {offset.toFixed(1)}s
              </span>
              <button
                onClick={() => onOffset(0.2)}
                aria-label="时间轴延后 0.2 秒"
                className="flex h-6 w-6 items-center justify-center rounded border border-ink-200 text-ink-500 transition hover:border-ink-400 hover:text-ink-800"
              >
                <Plus className="h-3 w-3" />
              </button>
            </span>
            <span className="relative shrink-0">
              <button
                onClick={() => setStyleOpen((v) => !v)}
                aria-label="显示方式"
                aria-expanded={styleOpen}
                className="flex items-center gap-1 rounded-full border border-ink-200 px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-ink-400 hover:text-ink-900"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {LYRIC_STYLE_LABEL[prefs.style]}
              </button>
              {styleOpen && <StylePanel onClose={() => setStyleOpen(false)} />}
            </span>
          </div>
        </footer>
      )}

      {/* 小窗外观面板走 portal：小窗自己有 overflow-hidden 和圆角，浮层挂在里面会被裁掉 */}
      {mini &&
        appearanceOpen &&
        createPortal(
          <MiniAppearance anchorRef={appearanceRef} onClose={() => setAppearanceOpen(false)} />,
          document.body,
        )}
    </div>
  )
}

/**
 * 歌词页的背景：**照搬卡片的画法**——主题纸底 → 照片 → 同一层主题蒙层。
 *
 * 为什么不是简单铺一张图：卡片上文字之所以在照片上还能读，靠的是那层"用主题渐变
 * 当蒙层"（浓淡由背景明暗自动给出初值、用户可再调）。歌词页如果只用照片，深墨字
 * 压在暗部就糊了；照搬这套，歌词页就是"卡片 + 滚动歌词"，观感连续、对比度也一致。
 * 蒙层浓淡沿用卡片自己的设置，所以两处不会打架。
 */
function LyricBackdrop({ snapshot, show }: { snapshot: Snapshot; show: boolean }) {
  const theme = poetryThemes[Math.min(Math.max(snapshot.state.themeIndex, 0), poetryThemes.length - 1)]
  // 背景在 state 上（渲染态），不在记录顶层——和卡片用的是同一份
  const bg = snapshot.state.background
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* 底层永远是主题纸底：没有配图时它就是背景本身 */}
      <div className="absolute inset-0" style={{ background: theme.background }} />
      {show && bg?.dataUrl && (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${bg.dataUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div className="absolute inset-0" style={{ background: theme.background, opacity: bg.scrim }} />
        </>
      )}
      <div className="noise-overlay" style={{ opacity: 0.08 }} />
    </div>
  )
}

/** 小窗里的歌词：前后各一句 + 当前句，做成"滚动三行" */
function MiniStage({ lines, index, factor }: { lines: LyricLine[]; index: number; factor: number }) {
  const from = Math.min(Math.max(index - 1, 0), Math.max(0, lines.length - 3))
  const window3 = lines.slice(from, from + 3)
  return (
    <div className="flex flex-col py-1.5">
      {window3.map((line, i) => {
        const globalIndex = from + i
        const active = globalIndex === index
        return (
          <button
            key={`${globalIndex}-${line.start}`}
            onClick={() => seek(line.start)}
            title="跳到这一句"
            className={`truncate px-3 py-1 text-left font-serif transition-all ${
              active ? 'font-medium text-ink-900' : 'text-ink-400 opacity-70 hover:opacity-100'
            }`}
            style={{ fontSize: (active ? 17 : 14) * factor }}
          >
            {line.text}
          </button>
        )
      })}
    </div>
  )
}

/** 上下（或左右）渐隐：用**模糊**而不是"画一条画布色的渐变"——
    有照片时涂灰会像贴了一条胶带，模糊则只是把背景推远，文字照样聚焦。 */
function FadeMask({ side }: { side: 'top' | 'bottom' | 'left' | 'right' }) {
  const gradient =
    side === 'top'
      ? 'linear-gradient(to bottom, black, transparent)'
      : side === 'bottom'
        ? 'linear-gradient(to top, black, transparent)'
        : side === 'left'
          ? 'linear-gradient(to right, black, transparent)'
          : 'linear-gradient(to left, black, transparent)'
  return (
    <div
      className={`pointer-events-none absolute ${
        side === 'top'
          ? 'inset-x-0 top-0 h-1/4'
          : side === 'bottom'
            ? 'inset-x-0 bottom-0 h-1/4'
            : side === 'left'
              ? 'inset-y-0 left-0 w-1/4'
              : 'inset-y-0 right-0 w-1/4'
      }`}
      style={{
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        maskImage: gradient,
        WebkitMaskImage: gradient,
      }}
    />
  )
}

/**
 * 小窗外观：透明度、边框、字号。
 *
 * 为什么用 portal + 固定定位：小窗自己带 `overflow-hidden` 和圆角，浮层挂在里面会被裁掉；
 * 而小窗常被拖到屏幕底部，所以浮层还要能翻到按钮**上方**去。
 */
function MiniAppearance({
  anchorRef,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement>
  onClose: () => void
}) {
  const prefs = useLyricPrefs()
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos] = useState(() => {
    const box = { width: 258, height: 170 }
    const r = anchorRef.current?.getBoundingClientRect()
    if (!r) return { top: 80, right: 16, ...box }
    const below = r.bottom + 6
    const above = r.top - 6 - box.height
    return {
      top: Math.round(below + box.height > window.innerHeight - 8 ? Math.max(8, above) : below),
      right: Math.round(Math.max(8, window.innerWidth - r.right - 8)),
      ...box,
    }
  })

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement
      if (boxRef.current?.contains(t)) return
      // 点触发按钮本身不关（它自己 toggle）
      if (anchorRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [anchorRef, onClose])

  const pct = Math.round(prefs.miniOpacity * 100)
  const lo = Math.round(MINI_OPACITY_MIN * 100)

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="小窗外观"
      style={{ top: pos.top, right: pos.right, width: pos.width }}
      className="fixed z-[60] rounded-xl border border-ink-200 bg-white p-3 shadow-2xl"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-ink-700">小窗透明度</span>
        <span className="text-[11px] tabular-nums text-ink-500">{pct}%</span>
      </div>
      <input
        type="range"
        min={lo}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => setLyricPrefs({ miniOpacity: Number(e.target.value) / 100 })}
        aria-label="小窗透明度"
        style={{ ['--pct' as string]: `${((pct - lo) / (100 - lo)) * 100}%` }}
        className="player-range w-full"
      />
      <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
        只调底色：字不跟着变淡，压到花背景上也还读得清
      </p>

      <label className="mt-2.5 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={prefs.miniBorder}
          onChange={(e) => setLyricPrefs({ miniBorder: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink-800"
        />
        <span className="min-w-0">
          <span className="block text-xs text-ink-700">显示边框</span>
          <span className="block text-[11px] text-ink-400">关掉就是浮在内容上的一层歌词</span>
        </span>
      </label>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-ink-700">字号</span>
        <span className="flex rounded-full border border-ink-200 bg-white p-0.5">
          {(Object.keys(LYRIC_FONT_LABEL) as LyricFontScale[]).map((f) => (
            <button
              key={f}
              onClick={() => setLyricPrefs({ fontScale: f })}
              aria-pressed={prefs.fontScale === f}
              className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                prefs.fontScale === f ? 'bg-ink-800 text-white' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {LYRIC_FONT_LABEL[f]}
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}

/** 显示方式面板 */function StylePanel({ onClose }: { onClose: () => void }) {
  const prefs = useLyricPrefs()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current?.contains(e.target as Node)) return
      // 点触发按钮本身不关（它在面板外面，由按钮自己 toggle）
      if ((e.target as HTMLElement)?.closest?.('[aria-label="显示方式"]')) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="歌词显示方式"
      className="absolute bottom-full right-0 z-40 mb-2 w-72 rounded-xl border border-ink-200 bg-white p-3 shadow-2xl"
    >
      <div className="mb-1.5 text-[11px] font-medium text-ink-700">面板</div>
      <div className="mb-2.5 flex gap-1">
        {(Object.keys(LYRIC_PANEL_LABEL) as LyricPanel[]).map((p) => (
          <button
            key={p}
            onClick={() => setLyricPrefs({ panel: p })}
            aria-pressed={prefs.panel === p}
            title={LYRIC_PANEL_HINT[p]}
            className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
              prefs.panel === p
                ? 'border-ink-800 bg-ink-800 text-white'
                : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400'
            }`}
          >
            {LYRIC_PANEL_LABEL[p]}
          </button>
        ))}
      </div>

      <p className="mb-2.5 text-[11px] leading-relaxed text-ink-400">
        小窗不挡屏幕：按住它的标题栏可拖到任意位置；透明度和边框在小窗标题栏的「外观」里调。
      </p>

      <div className="mb-1.5 text-[11px] font-medium text-ink-700">显示方式</div>
      <div className="flex flex-col gap-1">
        {(Object.keys(LYRIC_STYLE_LABEL) as LyricStyle[]).map((s) => (
          <button
            key={s}
            onClick={() => setLyricPrefs({ style: s })}
            aria-pressed={prefs.style === s}
            className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-left transition ${
              prefs.style === s
                ? 'border-ink-800 bg-ink-800 text-white'
                : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400'
            }`}
          >
            <LayoutList
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${prefs.style === s ? 'text-white/70' : 'text-ink-400'}`}
            />
            <span className="min-w-0">
              <span className="block text-xs">{LYRIC_STYLE_LABEL[s]}</span>
              <span className={`block text-[11px] ${prefs.style === s ? 'text-white/70' : 'text-ink-400'}`}>
                {LYRIC_STYLE_HINT[s]}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-ink-700">字号</span>
        <span className="flex rounded-full border border-ink-200 bg-white p-0.5">
          {(Object.keys(LYRIC_FONT_LABEL) as LyricFontScale[]).map((f) => (
            <button
              key={f}
              onClick={() => setLyricPrefs({ fontScale: f })}
              aria-pressed={prefs.fontScale === f}
              className={`rounded-full px-2 py-0.5 text-[11px] transition ${
                prefs.fontScale === f ? 'bg-ink-800 text-white' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {LYRIC_FONT_LABEL[f]}
            </button>
          ))}
        </span>
      </div>

      <label className="mt-2.5 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={prefs.showBackground}
          onChange={(e) => setLyricPrefs({ showBackground: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink-800"
        />
        <span className="min-w-0">
          <span className="block text-xs text-ink-700">铺上这张卡的背景</span>
          <span className="block text-[11px] text-ink-400">
            用卡片自己的 AI 配图与蒙层；关掉则是干净纸底
          </span>
        </span>
      </label>

      <label className="mt-2.5 flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={prefs.showBarLine}
          onChange={(e) => setLyricPrefs({ showBarLine: e.target.checked })}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink-800"
        />
        <span className="min-w-0">
          <span className="block text-xs text-ink-700">播放条显示当前句</span>
          <span className="block text-[11px] text-ink-400">不用打开歌词页也能看到唱到哪</span>
        </span>
      </label>
    </div>
  )
}

/** 四种样式共用的舞台 */
function LyricStage({
  lines,
  index,
  style,
  factor,
}: {
  lines: LyricLine[]
  index: number
  style: LyricStyle
  factor: number
}) {
  if (style === 'vertical') return <VerticalStage lines={lines} index={index} factor={factor} />
  if (style === 'single') return <SingleStage lines={lines} index={index} factor={factor} />
  const compact = style === 'compact'
  const base = compact ? BASE.compact : BASE.center
  const lineH = base.line * factor

  return (
    <>
      <div
        className="absolute inset-x-0 transition-transform duration-300 ease-out"
        style={{
          // 居中样式让当前句停在正中；紧凑列表停在偏上 1/3，这样下面能露出更多行
          top: compact ? '33%' : '50%',
          transform: `translateY(${-(index + 1) * lineH}px)`,
        }}
      >
        {lines.map((line, i) => {
          const active = i === index
          const played = i < index
          return (
            <button
              key={`${i}-${line.start}`}
              onClick={() => seek(line.start)}
              title="跳到这一句"
              style={{
                height: lineH,
                fontSize: (active ? base.active : base.idle) * factor,
              }}
              className={`mx-auto flex w-full max-w-2xl items-center px-6 font-serif transition-all duration-300 ${
                compact ? 'justify-start gap-2' : 'justify-center text-center'
              } ${
                active
                  ? compact
                    ? 'font-medium text-ink-900'
                    : 'font-medium text-ink-900'
                  : played
                    ? 'text-ink-400 opacity-70'
                    : 'text-ink-400 opacity-50 hover:opacity-100'
              }`}
            >
              {compact && (
                <span
                  className={`w-0.5 shrink-0 self-stretch my-1 rounded-full transition ${
                    active ? 'bg-ink-800' : 'bg-transparent'
                  }`}
                  aria-hidden
                />
              )}
              <span className="truncate">{line.text}</span>
            </button>
          )
        })}
      </div>
      {/* 上下渐隐：让"当前句"更聚焦 */}
      <FadeMask side="top" />
      <FadeMask side="bottom" />
    </>
  )
}

/** 单句大字：一屏只有当前句 */
function SingleStage({ lines, index, factor }: { lines: LyricLine[]; index: number; factor: number }) {
  const line = lines[Math.max(0, index)]
  return (
    <div className="flex h-full items-center justify-center px-8">
      <button
        onClick={() => seek(line.start)}
        title="跳到这一句"
        style={{ fontSize: BASE.single.active * factor }}
        className="font-serif font-medium leading-snug text-ink-900 transition-all duration-300 hover:opacity-80"
      >
        {line.text}
      </button>
    </div>
  )
}

/** 竖排：一列一句，从右往左推进（和卡片一个气质） */
function VerticalStage({
  lines,
  index,
  factor,
}: {
  lines: LyricLine[]
  index: number
  factor: number
}) {
  const colW = BASE.vertical.col * factor
  return (
    <>
      <div
        className="absolute inset-y-0 right-0 flex w-full flex-row-reverse items-center transition-transform duration-300 ease-out"
        style={{
          // 让当前列停在正中：当前列本身在右边第 index 列，
          // 百分比 translateX 相对自身宽度（=容器宽度），所以 50% 就是半屏
          transform: `translateX(calc(${index * colW}px + ${colW / 2}px - 50%))`,
        }}
      >
        {lines.map((line, i) => {
          const active = i === index
          return (
            <button
              key={`${i}-${line.start}`}
              onClick={() => seek(line.start)}
              title="跳到这一句"
              style={{
                width: colW,
                fontSize: BASE.vertical.active * factor,
                writingMode: 'vertical-rl',
                textOrientation: 'upright',
                letterSpacing: '0.18em',
              }}
              className={`flex h-full shrink-0 items-center justify-center font-serif transition-colors duration-300 ${
                active ? 'font-medium text-ink-900' : 'text-ink-400 opacity-60 hover:opacity-100'
              }`}
            >
              <span className="max-h-[70%] overflow-hidden">{line.text}</span>
            </button>
          )
        })}
      </div>
      {/* 左右渐隐：竖排没有"上下"的边界，改成左右 */}
      <FadeMask side="left" />
      <FadeMask side="right" />
      <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-ink-400">
        ← 推进方向
      </div>
    </>
  )
}
