import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, GripVertical, Play, RotateCcw, Trash2, X } from 'lucide-react'
import {
  isPlayingId,
  moveInQueue,
  PLAY_MODE_HINT,
  PLAY_MODE_LABEL,
  playTrackById,
  removeFromQueue,
  setQueue,
  setQueueName,
  togglePlay,
  useAudioPlayer,
  usePlayerPrefs,
} from '../lib/audioPlayer'
import { formatDuration } from '../lib/format'
import type { Snapshot } from '../lib/snapshots'

/**
 * 播放队列面板。
 *
 * 它和「随机播放」是一对：随机播到某一首想回头找，没有列表就只能干瞪眼。
 * 同时也是「自定义队列」的落地处——拖动排序 / 移除单首 / 一键回到筛选顺序。
 *
 * 队列里只会有**关联了音频**的卡片（在管理页构建时就过滤掉了），所以这里的每一项
 * 都是点得响的。
 */
export function QueuePanel({
  snapshots,
  onClose,
  onError,
  onRebuild,
  filteredCount,
  playlists,
  onSavePlaylist,
}: {
  /** 用来把队列里的 id 变成标题/时长 */
  snapshots: Snapshot[]
  onClose: () => void
  onError: (msg: string) => void
  /** 按当前筛选结果重建队列（true = 同时从第一首开始播放） */
  onRebuild: (play: boolean) => void
  /** 当前筛选下有音频的卡片数，用于提示"筛选已变化" */
  filteredCount: number
  /** 已有歌单（用来提示重名） */
  playlists: { id: string; name: string }[]
  /** 存为歌单（同名则覆盖） */
  onSavePlaylist: (name: string, cardIds: string[]) => Promise<unknown>
}) {
  const player = useAudioPlayer()
  const prefs = usePlayerPrefs()
  /**
   * 被拖的那一项用 **ref** 记，而不是 state。
   *
   * 拖放是一串事件（dragstart → 若干 dragover → drop），如果在 dragstart 里 setState，
   * drop 的处理器闭包可能还拿着旧值——取决于中间是否恰好发生了一次重渲染。真实拖拽
   * 有几百毫秒间隔通常没事，但"能不能排序取决于渲染时机"是不能接受的：
   * 用 ref 记录，drop 时读的一定是最新值。state 只留给"高亮哪一项"这种视觉状态。
   */
  const dragFromRef = useRef<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [dragActive, setDragActive] = useState(false)
  /** 「存为歌单」的行内输入开关 */
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const byId = new Map(snapshots.map((s) => [s.id, s]))
  const stale = prefs.queue.length !== filteredCount

  async function submitSave() {
    if (!name.trim()) return
    setBusy(true)
    try {
      // 同名视为"更新同一份歌单"，避免攒出一堆「一年级晨读」「一年级晨读(2)」
      const existing = playlists.find((p) => p.name === name.trim())
      await onSavePlaylist(name.trim(), prefs.queue)
      // 存下来之后这份队列就有名字了：播放条上悬浮立刻能看出放的是哪一份
      setQueueName(name.trim())
      if (!existing) setSaving(false)
      setName('')
      setSaving(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="播放队列"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="font-medium text-ink-800">播放队列</span>
            {/* 队列的名字（歌单名 / 选中的 3 首 / 当前筛选）：与播放条上的悬浮提示同一份 */}
            {prefs.queueName && (
              <span className="max-w-[10rem] truncate text-[11px] text-ink-500">「{prefs.queueName}」</span>
            )}
            <span className="text-[11px] text-ink-400">
              {prefs.queue.length} 首 · {PLAY_MODE_LABEL[prefs.mode]}
            </span>
            {prefs.custom && (
              <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">自定义</span>
            )}
          </span>
          <button
            onClick={onClose}
            aria-label="关闭队列"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {stale && (
          <p className="shrink-0 bg-amber-50 px-4 py-2 text-[11px] leading-relaxed text-amber-700">
            当前筛选下有 {filteredCount} 首带音频的卡片，与队列的 {prefs.queue.length} 首不一致。
            队列**不会自动跟着筛选变**（避免听着听着被换掉），需要时点下面的「按当前筛选重建」。
          </p>
        )}

        <ol className="min-h-0 flex-1 overflow-y-auto p-2">
          {prefs.queue.length === 0 ? (
            <li className="px-3 py-8 text-center text-xs text-ink-400">队列是空的</li>
          ) : (
            prefs.queue.map((id, index) => {
              const snap = byId.get(id)
              const active = player.currentId === id
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={() => {
                    dragFromRef.current = index
                    setDragActive(true)
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setOverIndex(index)
                  }}
                  onDragEnd={() => {
                    dragFromRef.current = null
                    setDragActive(false)
                    setOverIndex(null)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    const from = dragFromRef.current
                    if (from !== null) moveInQueue(from, index)
                    dragFromRef.current = null
                    setDragActive(false)
                    setOverIndex(null)
                  }}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${
                    active ? 'bg-ink-800 text-white' : 'hover:bg-ink-50'
                  } ${overIndex === index && dragActive && dragFromRef.current !== index ? 'ring-1 ring-ink-400' : ''}`}
                >
                  <span
                    className={`shrink-0 cursor-grab ${active ? 'text-white/50' : 'text-ink-300'}`}
                    title="拖动排序"
                    aria-hidden
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </span>
                  <span
                    className={`w-5 shrink-0 text-right text-[11px] tabular-nums ${
                      active ? 'text-white/60' : 'text-ink-400'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <button
                    onClick={() => {
                      if (active && player.playing) {
                        void togglePlay(id, onError)
                        return
                      }
                      void playTrackById(id, onError)
                    }}
                    aria-label={active && player.playing ? '暂停' : `播放 ${snap?.label ?? ''}`}
                    className={`flex min-w-0 flex-1 items-center gap-2 text-left text-xs ${
                      active ? 'text-white' : 'text-ink-700'
                    }`}
                  >
                    {active && player.playing ? (
                      <span className="text-[10px]" aria-hidden>
                        ▶
                      </span>
                    ) : null}
                    <span className="truncate">{snap?.label ?? '（已删除的卡片）'}</span>
                    <span className={`shrink-0 text-[11px] ${active ? 'text-white/60' : 'text-ink-400'}`}>
                      {snap?.state.author ? `- ${snap.state.author}` : ''}
                    </span>
                  </button>
                  <span className={`shrink-0 text-[11px] tabular-nums ${active ? 'text-white/60' : 'text-ink-400'}`}>
                    {snap?.audio?.duration ? formatDuration(snap.audio.duration) : '--:--'}
                  </span>
                  <button
                    onClick={() => removeFromQueue(id)}
                    aria-label={`从队列移除 ${snap?.label ?? ''}`}
                    title="从队列移除（不影响卡片本身）"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition ${
                      active ? 'text-white/60 hover:text-white' : 'text-ink-300 hover:text-red-600'
                    }`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              )
            })
          )}
        </ol>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-ink-100 px-4 py-3">
          {saving ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <input
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitSave()
                    if (e.key === 'Escape') setSaving(false)
                  }}
                  placeholder="歌单名称，例如「一年级晨读」"
                  className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
                />
                <button
                  onClick={() => void submitSave()}
                  disabled={busy || !name.trim()}
                  className="shrink-0 rounded-md bg-ink-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink-900 disabled:opacity-40"
                >
                  保存
                </button>
                <button
                  onClick={() => setSaving(false)}
                  className="shrink-0 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-ink-400"
                >
                  取消
                </button>
              </div>
              {/* 同名就是覆盖，提前说清楚，别让用户以为会多出一条 */}
              {playlists.some((p) => p.name === name.trim() && name.trim()) && (
                <p className="text-[11px] text-amber-600">
                  已有同名歌单，保存会**覆盖**它（不会新增一条）
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-ink-400">
                {PLAY_MODE_LABEL[prefs.mode]}：{PLAY_MODE_HINT[prefs.mode]}
              </span>
              <span className="flex shrink-0 gap-2">
                <button
                  onClick={() => {
                    setName('')
                    setSaving(true)
                  }}
                  disabled={prefs.queue.length === 0}
                  title="把当前队列（含顺序）存成命名歌单，以后一键播放"
                  className="flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  存为歌单
                </button>
                <button
                  onClick={() => onRebuild(false)}
                  title="按当前筛选结果重建队列，但不改变正在播放的内容"
                  className="flex items-center gap-1.5 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-ink-400 hover:text-ink-900"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  按当前筛选重建
                </button>
                <button
                  onClick={() => onRebuild(true)}
                  title="按当前筛选重建队列，并从第一首开始播放"
                  className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-ink-900"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  从头播放
                </button>
              </span>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
