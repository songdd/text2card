import { useRef, useState } from 'react'
import { AlertTriangle, Archive, Database, HardDriveDownload, Loader2, Upload, X } from 'lucide-react'
import { backupFileName, exportBackup, importBackup, type ExportProgress } from '../lib/backup'
import { downloadBlob } from '../lib/exportSnapshot'
import { formatBytes } from '../lib/format'
import type { LegacyPreview } from '../lib/migrate'
import type { Snapshot } from '../lib/snapshots'

/**
 * 备份 / 恢复对话框。
 *
 * 存在的理由要写在界面上——用户不会凭空相信"备份有用"，所以这里直接说清数据在哪、
 * 什么情况下会没、这个 ZIP 里有什么。**话不说清，功能就只是个按钮。**
 */
export function BackupDialog({
  snapshots,
  onClose,
  onNotify,
  onDone,
  legacy,
  onImportLegacy,
}: {
  snapshots: Snapshot[]
  onClose: () => void
  onNotify: (kind: 'ok' | 'err', message: string) => void
  /** 恢复完成后刷新列表 */
  onDone: () => void
  /** 浏览器里还留着的旧数据（有就显示入口） */
  legacy?: LegacyPreview | null
  onImportLegacy?: () => void
}) {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const fileRef = useRef<HTMLInputElement>(null)

  const audioCount = snapshots.filter((s) => s.audio).length
  const imageCount = snapshots.filter((s) => s.state.background?.dataUrl).length
  const lyricCount = snapshots.filter((s) => s.audio?.lyricText).length

  async function handleExport() {
    setBusy('export')
    setProgress(null)
    try {
      const blob = await exportBackup(setProgress)
      downloadBlob(blob, backupFileName())
      onNotify('ok', `已导出备份（${formatBytes(blob.size)}）`)
    } catch (err) {
      onNotify('err', `导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  async function handleImport(file: File) {
    if (mode === 'replace' && !window.confirm('先用备份里的内容清空现有数据，再恢复？现有卡片、音频都会没。')) {
      return
    }
    setBusy('import')
    setProgress(null)
    try {
      const result = await importBackup(file, { mode, onProgress: setProgress })
      const bits = [
        `${result.created} 张新增`,
        result.updated ? `${result.updated} 张更新` : '',
        result.audio ? `${result.audio} 个音频` : '',
        result.images ? `${result.images} 张配图` : '',
        result.playlists ? `${result.playlists} 个歌单` : '',
        result.presets ? `${result.presets} 个预设` : '',
      ].filter(Boolean)
      onNotify('ok', `恢复完成：${bits.join('、')}`)
      if (result.skipped.length) {
        console.warn('[backup] 导入时跳过：', result.skipped)
        onNotify('err', `有 ${result.skipped.length} 项丢失（详见控制台）`)
      }
      onDone()
    } catch (err) {
      onNotify('err', `恢复失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
      role="dialog"
      aria-modal
      aria-label="备份与恢复"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <span className="flex items-center gap-2 font-medium text-ink-800">
            <Archive className="h-4 w-4 text-ink-500" />
            备份与恢复
          </span>
          <button
            onClick={onClose}
            disabled={busy !== null}
            aria-label="关闭"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-4 py-4">
          {/* 说清为什么需要它：数据在浏览器里，浏览器会清 */}
          <p className="flex items-start gap-2 rounded-md border border-amber-200/70 bg-amber-50/70 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>
              卡片、音频、字幕都存在<span className="font-medium text-ink-700">这台电脑的这个浏览器</span>
              里（IndexedDB）。磁盘紧张时浏览器可能自动清理，你「清除浏览数据」也会一起没，
              换浏览器 / 换网址都读不到。
              <span className="font-medium text-ink-800">备份 ZIP 是浏览器之外的那一份保险。</span>
            </span>
          </p>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-700">导出完整备份</span>
              <span className="flex items-center gap-1 text-[11px] text-ink-400">
                <Database className="h-3 w-3" />
                {snapshots.length} 张 · 音频 {audioCount} · 配图 {imageCount} · 字幕 {lyricCount}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-400">
              ZIP 里是：卡片数据（含标签、墨色、主题、字体、时间轴）+ 音频原文件 + 字幕文件 + AI 配图。
              可以直接用解压工具打开翻看，也能在别的机器上恢复。
            </p>
            <button
              onClick={() => void handleExport()}
              disabled={busy !== null || snapshots.length === 0}
              className="flex items-center justify-center gap-2 rounded-md bg-ink-800 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-40"
            >
              {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
              {busy === 'export' ? '打包中…' : '导出备份 ZIP'}
            </button>
          </section>

          <section className="flex flex-col gap-2 border-t border-ink-100 pt-3">
            <span className="text-xs font-medium text-ink-700">从备份恢复</span>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  ['merge', '合并到现有数据', '同「标题 + 作者」的卡片会被更新，其余新增'],
                  ['replace', '清空现有数据后恢复', '完全还原成备份时的样子（现有数据会没）'],
                ] as const
              ).map(([value, label, hint]) => (
                <label key={value} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name="backup-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink-800"
                  />
                  <span className="min-w-0">
                    <span className="block text-xs text-ink-700">{label}</span>
                    <span className="block text-[11px] text-ink-400">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className="flex items-center justify-center gap-2 rounded-md border border-ink-200 px-3 py-2.5 text-sm text-ink-700 transition hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
            >
              {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {busy === 'import' ? '恢复中…' : '选择备份 ZIP'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleImport(file)
              }}
            />
          </section>

          {progress && (
            <p className="text-[11px] tabular-nums text-ink-500">
              {progress.done}/{progress.total} · {progress.current}
            </p>
          )}

          {/* 浏览器旧数据的入口（"稍后"之后还能从这里进来）。
              无论检测到还是没检测到都显示一行——不然"没弹搬家提示"这种情况没办法查。 */}
          {onImportLegacy && (
            <section className="flex flex-col gap-1.5 border-t border-ink-100 pt-3">
              <span className="text-xs font-medium text-ink-700">浏览器里的旧数据</span>
              {legacy && legacy.cards > 0 ? (
                <>
                  <p className="text-[11px] leading-relaxed text-ink-400">
                    这台浏览器里还留着以前存的 {legacy.cards} 张卡片（音频 {legacy.audio} 个）。
                    数据已经改存在本地 SQLite 库里，需要的话可以把它们搬过来——是复制，不会删掉浏览器里那份。
                  </p>
                  <button
                    onClick={onImportLegacy}
                    disabled={busy !== null}
                    className="flex items-center justify-center gap-2 rounded-md border border-ink-200 px-3 py-2 text-sm text-ink-700 transition hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
                  >
                    <HardDriveDownload className="h-4 w-4" />
                    导入浏览器旧数据
                  </button>
                </>
              ) : (
                <p className="text-[11px] leading-relaxed text-ink-400">
                  没检测到旧数据{legacy?.note ? `（${legacy.note}）` : ''}。
                  如果你以前用的是别的地址打开（比如 127.0.0.1 与 localhost 是两个不同的源），
                  请用<span className="font-medium text-ink-600">原来那个地址</span>打开，才能读到当时的数据。
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
