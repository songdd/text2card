import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  Download,
  FolderInput,
  ImageDown,
  Loader2,
  Pause,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import { ScaledCard } from './ScaledCard'
import { SIZE_OPTIONS } from './CardFrame'
import { poetryThemes } from '../themes/poetryThemes'
import { SCENE_FIELD_META, filledCount } from '../../shared/scene'
import { fontLabelOf, isFontKey } from '../lib/fonts'
import { normalizeTags } from '../lib/tags'
import { formatBytes, formatDuration, timeAgo } from '../lib/format'
import { useCardBackground } from '../lib/useBackground'
import { isPlayingId, togglePlay, useAudioPlayer } from '../lib/audioPlayer'
import { backgroundBytesOf, type Snapshot } from '../lib/snapshots'

/**
 * 详情灯箱。
 *
 * 呈现方式是**屏幕中央浮出**，不是右侧抽屉——点卡片就是为了看大图，
 * 大图居中才够大；右侧面板会把图挤窄，还挡住网格。
 *
 * 大图用真实的卡片渲染（`ScaledCard` → `SnapshotCard`），和导出同一条路径，
 * 所以「看到的就是导出的」。元信息默认收起：进来第一眼应该是图，不是参数表。
 */
export function SnapshotDetail({
  snapshot,
  onClose,
  onLoad,
  onExportPng,
  onExportBackground,
  onDelete,
  busy,
  onNotify,
}: {
  snapshot: Snapshot
  onClose: () => void
  onLoad: () => void
  onExportPng: () => void
  onExportBackground: () => void
  onDelete: () => void
  busy: string | null
  /** 音频播放出错时的提示出口 */
  onNotify?: (kind: 'ok' | 'err', message: string) => void
}) {
  // 配图按需取回：列表里只有缩略图，详情要的是完整画质。
  // 取回之前先用缩略图顶着（放大会有点软，读作"正在对焦"），所以这里不会白一下。
  const { background, placeholder, loading: bgLoading } = useCardBackground(snapshot)
  const bg = background ?? placeholder
  const s: Snapshot['state'] = { ...snapshot.state, background: bg ?? null }
  const holderRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [showMeta, setShowMeta] = useState(false)

  // 按可用宽度等比缩放（与编辑页预览同一套做法）
  useEffect(() => {
    function compute() {
      const holder = holderRef.current
      if (!holder) return
      const avail = holder.clientWidth
      if (avail > 0) setWidth(avail)
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (holderRef.current) ro.observe(holderRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const theme = poetryThemes[Math.min(Math.max(s.themeIndex, 0), poetryThemes.length - 1)]
  const sizeLabel = SIZE_OPTIONS.find((o) => o.value === s.size)?.label ?? s.size
  const bgBytes = backgroundBytesOf(s)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-3 backdrop-blur-sm md:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${snapshot.label} 详情`}
    >
      <div
        className="flex max-h-full w-full max-w-[min(46rem,100%)] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-medium text-ink-800">{snapshot.label}</span>
            {s.author && <span className="shrink-0 text-xs text-ink-400">{s.author}</span>}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* 大图：这里是「灯箱」的主角，占满可用宽度 */}
        <div ref={holderRef} className="canvas-bg min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
          {width > 0 && (
            <ScaledCard state={s} width={width - 24} className="mx-auto" shadow />
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-ink-100 px-4 py-3">
          <button
            onClick={onLoad}
            className="flex items-center justify-center gap-2 rounded-md bg-ink-800 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900"
          >
            <FolderInput className="h-4 w-4" />
            载入到编辑页
          </button>
          <div className="flex gap-2">
            {snapshot.audio && <AudioAction id={snapshot.id} onError={(m) => onNotify?.('err', m)} />}
            <SecondaryAction onClick={onExportPng} busy={busy === 'png'}>
              <Download className="h-3.5 w-3.5" />
              导出 PNG
            </SecondaryAction>
            <SecondaryAction onClick={onExportBackground} busy={busy === 'bg'} disabled={!s.background}>
              <ImageDown className="h-3.5 w-3.5" />
              导出背景
            </SecondaryAction>
            <SecondaryAction onClick={onDelete} danger>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </SecondaryAction>
          </div>

          {/* 元信息默认收起：第一眼应该是图，不是参数表 */}
          <button
            onClick={() => setShowMeta((v) => !v)}
            aria-expanded={showMeta}
            className="flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition ${showMeta ? 'rotate-180' : ''}`} />
            {showMeta ? '收起详细信息' : '详细信息'}
          </button>

          {showMeta && (
            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 rounded-md bg-ink-50 px-3 py-3 text-xs">
              <Row label="尺寸">
                {sizeLabel}
                {s.size === 'landscape'
                  ? ' · 1920×1080'
                  : s.size === 'portrait'
                    ? ' · 1080×1440'
                    : ' · 宽 1080'}
              </Row>
              <Row label="主题">{theme?.name ?? '—'}</Row>
              <Row label="字体">
                {fontLabelOf(isFontKey(s.fontKey) ? s.fontKey : 'default')} · 字号{' '}
                {Math.round((s.fontScale ?? 1) * 100)}%
              </Row>
              <Row label="墨色">
                {s.inkText || s.inkAccent ? (
                  <>
                    <InkChip label="正文" value={s.inkText} fallback={theme?.text} />
                    <span className="text-ink-300"> · </span>
                    <InkChip label="标题" value={s.inkAccent} fallback={theme?.accent} />
                  </>
                ) : (
                  '跟随主题'
                )}
              </Row>
              <Row label="排版">
                {s.vertical ? '竖排' : '横排'} · 印章{s.showSeal ? '开' : '关'} · 标点
                {s.showPunct ? '开' : '关'}
                {s.size === 'auto' ? ` · 留白${s.compact ? '紧凑' : '标准'}` : ''}
              </Row>
              <Row label="背景">
                {s.background
                  ? `AI 配图 · 蒙层 ${Math.round(s.background.scrim * 100)}% · 约 ${formatBytes(bgBytes)}${
                      bgLoading ? '（正在读取原图…）' : ''
                    }`
                  : '无（主题渐变）'}
              </Row>
              <Row label="标签">
                {normalizeTags(s.tags).length ? (
                  <span className="flex flex-wrap gap-1">
                    {normalizeTags(s.tags).map((t) => (
                      <span key={t} className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : (
                  '无'
                )}
              </Row>
              <Row label="音频">
                {snapshot.audio ? (
                  <>
                    <span className="break-all">{snapshot.audio.name}</span>
                    <span className="text-ink-400">
                      {' '}
                      · {formatBytes(snapshot.audio.size)}
                      {formatDuration(snapshot.audio.duration) &&
                        ` · ${formatDuration(snapshot.audio.duration)}`}
                    </span>
                  </>
                ) : (
                  '未关联'
                )}
              </Row>
              <Row label="五字段">
                已填 {filledCount(s.scene)}/5
                <ul className="mt-1 flex flex-col gap-0.5">
                  {SCENE_FIELD_META.map((meta) => (
                    <li key={meta.key} className="leading-relaxed text-ink-500">
                      <span className="text-ink-400">{meta.label}：</span>
                      {s.scene[meta.key] || '—'}
                    </li>
                  ))}
                </ul>
              </Row>
              <Row label="时间">
                创建 {timeAgo(snapshot.createdAt)}
                {snapshot.updatedAt ? ` · 更新 ${timeAgo(snapshot.updatedAt)}` : ''}
              </Row>
            </dl>
          )}
        </footer>
      </div>
    </div>
  )
}

/** 详情里的播放键。与卡片上的播放键共用同一个全局单例，所以两边状态天然一致 */
function AudioAction({ id, onError }: { id: string; onError: (msg: string) => void }) {
  const player = useAudioPlayer()
  const playing = isPlayingId(player, id)
  return (
    <SecondaryAction onClick={() => void togglePlay(id, onError)} busy={player.loadingId === id}>
      {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
      {playing ? '暂停' : '播放音频'}
    </SecondaryAction>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 text-ink-700">{children}</dd>
    </>
  )
}

/** 墨色：一个小色点 + 十六进制值。没设过覆盖时显示的是该主题的墨色 */
function InkChip({ label, value, fallback }: { label: string; value?: string; fallback?: string }) {
  const color = value ?? fallback
  return (
    <span className="whitespace-nowrap">
      {label}{' '}
      <span
        className="mx-0.5 inline-block h-2.5 w-2.5 rounded-full border border-ink-300 align-middle"
        style={{ background: color }}
      />
      <span className="tabular-nums">{color ?? '—'}</span>
    </span>
  )
}

function SecondaryAction({
  onClick,
  children,
  busy,
  danger,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  busy?: boolean
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-2 text-xs font-medium transition disabled:opacity-40 ${
        danger
          ? 'border-ink-200 text-ink-600 hover:border-red-300 hover:text-red-600'
          : 'border-ink-200 text-ink-700 hover:border-ink-300 hover:text-ink-900'
      }`}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : children}
    </button>
  )
}
