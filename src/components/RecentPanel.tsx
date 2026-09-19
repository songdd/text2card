import { useEffect } from 'react'
import { Clock, RotateCcw, Trash2, X } from 'lucide-react'
import type { Style } from '../lib/classifier'
import type { SnapshotsState } from '../lib/useSnapshots'
import type { Snapshot } from '../lib/snapshots'
import { MAX_SNAPSHOTS } from '../lib/snapshots'
import { fontLabelOf } from '../lib/fonts'
import { SIZE_OPTIONS } from './CardFrame'
import { codeThemes } from '../themes/codeThemes'
import { quoteThemes } from '../themes/quoteThemes'
import { proseThemes } from '../themes/proseThemes'
import { poetryThemes } from '../themes/poetryThemes'

const STYLE_LABEL: Record<Style, string> = { code: '代码', quote: '金句', prose: '长文', poetry: '诗词' }

interface Props {
  open: boolean
  onClose: () => void
  snapshots: SnapshotsState
  onRestore: (snapshot: Snapshot) => void
}

export function RecentPanel({ open, onClose, snapshots, onRestore }: Props) {
  const { items, loading, clear, remove } = snapshots

  // Esc 关闭。依赖 open：关闭状态下不占用键盘事件。
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-4 py-10 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="最近保存"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <Clock className="h-4 w-4 self-center text-ink-500" />
            <span className="font-medium text-ink-800">最近保存</span>
            <span className="text-xs tabular-nums text-ink-400">
              {items.length}/{MAX_SNAPSHOTS}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <button
                onClick={() => void clear()}
                className="rounded-md px-2 py-1 text-xs text-ink-400 transition hover:text-seal"
              >
                清空
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="关闭"
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {loading ? (
          <p className="px-4 py-10 text-center text-sm text-ink-400">读取中…</p>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm text-ink-500">还没有保存过</p>
            <p className="mt-1 text-xs text-ink-400">
              点顶栏的「保存」把当前诗词、背景、AI 背景图和预览设置一起存下来
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {items.map((s) => (
              <li key={s.id} className="group flex items-center gap-3 px-4 py-3 transition hover:bg-ink-50">
                <button
                  onClick={() => {
                    onRestore(s)
                    onClose()
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  title="载入到主界面"
                >
                  <span
                    className="h-12 w-12 shrink-0 overflow-hidden rounded-md border border-ink-200 bg-cover bg-center"
                    style={{
                      backgroundImage: s.state.background
                        ? `url("${s.state.background.dataUrl}")`
                        : themeBackgroundOf(s.style, s.state.themeIndex),
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink-800">{s.label}</span>
                      {s.state.background && (
                        <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">
                          AI 背景
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-400">
                      <span>{STYLE_LABEL[s.style]}</span>
                      <span>·</span>
                      <span>{themeNameOf(s.style, s.state.themeIndex)}</span>
                      <span>·</span>
                      <span>{sizeLabelOf(s.state.size)}</span>
                      <span>·</span>
                      <span>{fontLabelOf(s.state.fontKey)}</span>
                      <span>·</span>
                      <span>{timeAgo(s.createdAt)}</span>
                    </span>
                  </span>
                </button>

                <span className="flex shrink-0 items-center gap-1">
                  <RotateCcw className="h-3.5 w-3.5 text-ink-300 transition group-hover:text-ink-500" />
                  <button
                    onClick={() => void remove(s.id)}
                    title="删除这条"
                    aria-label="删除"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-ink-300 transition hover:bg-white hover:text-seal"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function themeListOf(style: Style) {
  switch (style) {
    case 'code':
      return codeThemes
    case 'quote':
      return quoteThemes
    case 'prose':
      return proseThemes
    case 'poetry':
      return poetryThemes
  }
}

/** 没有 AI 背景图时，列表缩略图退回该条当时用的主题渐变 */
function themeBackgroundOf(style: Style, themeIndex: number): string {
  const list = themeListOf(style)
  return list[Math.min(themeIndex, list.length - 1)]?.background ?? '#e9e6dd'
}

function themeNameOf(style: Style, themeIndex: number): string {
  const list = themeListOf(style)
  return list[Math.min(themeIndex, list.length - 1)]?.name ?? '—'
}

function sizeLabelOf(size: string): string {
  return SIZE_OPTIONS.find((o) => o.value === size)?.label ?? size
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString()
}
