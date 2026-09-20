import { useEffect } from 'react'
import { ArrowRight, Clock, RotateCcw, Trash2, X } from 'lucide-react'
import type { Style } from '../lib/classifier'
import type { SnapshotsState } from '../lib/useSnapshots'
import type { Snapshot } from '../lib/snapshots'
import { RECENT_LIMIT } from '../lib/snapshots'
import { fontLabelOf } from '../lib/fonts'
import { timeAgo } from '../lib/format'
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
  /** 跳到管理页看全部（弹层只显示最近若干条，不是保存上限） */
  onOpenLibrary: () => void
}

export function RecentPanel({ open, onClose, snapshots, onRestore, onOpenLibrary }: Props) {
  const { loading, clear, remove } = snapshots
  // 弹层是「快速切图器」，只显示最近的若干条；完整列表在管理页
  const items = snapshots.items.slice(0, RECENT_LIMIT)

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
              {items.length}
              {snapshots.items.length > items.length ? ` / 共 ${snapshots.items.length}` : ''}
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
          <>
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
                      // 48px 的预览用缩略图就够：列表不带配图，原图要单独请求，
                      // 为了一个小方块去拉 2MB 不划算
                      backgroundImage: s.thumb
                        ? `url("${s.thumb}")`
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
          </>
        )}

        {/* 弹层只是快速切图器；完整列表（检索、多选、批量导出）在管理页 */}
        <footer className="border-t border-ink-100 px-4 py-2.5">
          <button
            onClick={() => {
              onClose()
              onOpenLibrary()
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
          >
            在「管理」页查看全部
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </footer>
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
