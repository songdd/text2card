import { useState } from 'react'
import { Database, HardDriveDownload, Loader2, X } from 'lucide-react'
import { migrateLegacyToServer, type LegacyPreview, type MigrateProgress } from '../lib/migrate'
import { formatBytes } from '../lib/format'

/**
 * 「把浏览器里的旧数据搬进本地数据库」的提示。
 *
 * 刻意做成**要用户点一下**而不是静默迁移：这是数据搬家，应该让人知道发生了什么。
 * 搬家是复制不是移动——浏览器里那份原样保留，确认没问题再谈清理。
 */
export function MigrateDialog({
  preview,
  onClose,
  onDone,
  onNotify,
}: {
  preview: LegacyPreview
  onClose: () => void
  onDone: () => void
  onNotify: (kind: 'ok' | 'err', message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<MigrateProgress | null>(null)

  async function run() {
    setBusy(true)
    try {
      const result = await migrateLegacyToServer(setProgress)
      const bits = [
        `${result.cards} 张卡片`,
        result.audio ? `${result.audio} 个音频` : '',
        result.playlists ? `${result.playlists} 个歌单` : '',
        result.presets ? `${result.presets} 个标签预设` : '',
        result.draft ? '当前背景' : '',
      ].filter(Boolean)
      onNotify('ok', `已导入：${bits.join('、')}`)
      if (result.skipped.length) {
        console.warn('[migrate] 跳过：', result.skipped)
        onNotify('err', `有 ${result.skipped.length} 项没导入成功（详见控制台）`)
      }
      onDone()
      onClose()
    } catch (err) {
      onNotify('err', `导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal
      aria-label="导入浏览器旧数据"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <span className="flex items-center gap-2 font-medium text-ink-800">
            <HardDriveDownload className="h-4 w-4 text-ink-500" />
            把浏览器里的旧数据搬到本地数据库
          </span>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-xs leading-relaxed text-ink-600">
            检测到这台浏览器里还有以前存的数据。现在数据改存在你电脑的文件里
            （<span className="font-medium text-ink-800">本地 SQLite 库</span>），需要搬一次。
          </p>
          <ul className="flex flex-col gap-1 rounded-md bg-ink-50 px-3 py-2.5 text-[11px] leading-relaxed text-ink-600">
            <li>卡片 {preview.cards} 张 · 音频 {preview.audio} 个 · 配图 {preview.images} 张 · 字幕 {preview.lyrics} 份</li>
            <li>歌单 {preview.playlists} 个 · 标签预设 {preview.presets} 个</li>
          </ul>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-500">
            <Database className="mt-0.5 h-3 w-3 shrink-0 text-ink-400" />
            <span>
              <span className="font-medium text-ink-700">这是复制，不是移动</span>
              ：浏览器里那份原样保留，搬完确认没问题再清理它也不迟。重复搬不会产生重复数据。
            </span>
          </p>
          {progress && (
            <p className="text-[11px] tabular-nums text-ink-500">
              {progress.done}/{progress.total} · {progress.current}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void run()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-ink-800 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
              {busy ? '导入中…' : '现在导入'}
            </button>
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-ink-200 px-3 py-2.5 text-sm text-ink-600 transition hover:border-ink-400 disabled:opacity-40"
            >
              稍后
            </button>
          </div>
          <p className="text-[11px] text-ink-400">
            稍后也可以从「管理」页的「备份」对话框里导入（那里也会显示这项）。
          </p>
        </div>
      </div>
    </div>
  )
}
