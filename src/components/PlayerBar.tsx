import { useMemo, useState } from 'react'
import { ListMusic, Music, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX, X } from 'lucide-react'
import {
  cycleMode,
  isPlayingId,
  PLAY_MODE_HINT,
  PLAY_MODE_LABEL,
  playNext,
  playPrev,
  seek,
  setVolume,
  stopAll,
  toggleMute,
  togglePlay,
  useAudioPlayer,
  useMediaTime,
  usePlayerPrefs,
} from '../lib/audioPlayer'
import { formatDuration } from '../lib/format'
import { activeLineIndex, resolveLyrics } from '../lib/lyrics'
import { useLyricPrefs } from '../lib/lyricPrefs'
import type { Snapshot } from '../lib/snapshots'

const MODE_ICON: Record<string, string> = {
  sequential: '→',
  'loop-all': '🔁',
  'repeat-one': '🔂',
  shuffle: '🔀',
}

/**
 * 底部播放条。
 *
 * 为什么要在播就常驻：之前只有一个卡片上的 ▶ 按钮，一旦滚动到别处就既看不到
 * "在放什么"，也没有全局暂停入口——这在加了歌词之后更明显（歌词页关掉就找不回来）。
 *
 * **暂停后依然显示**（播放器的 currentId 是暂停后保留的）：否则一暂停播放条就消失，
 * 用户连"继续播"都点不到。
 */
export function PlayerBar({
  snapshot,
  onOpenLyrics,
  onOpenQueue,
  lyricsOpen,
  onError,
}: {
  snapshot: Snapshot | null
  onOpenLyrics: () => void
  onOpenQueue: () => void
  lyricsOpen: boolean
  onError: (msg: string) => void
}) {
  const player = useAudioPlayer()
  const prefs = usePlayerPrefs()
  const lyricPrefs = useLyricPrefs()
  const { time, duration } = useMediaTime()
  const [volumeOpen, setVolumeOpen] = useState(false)
  /**
   * 播放条上的当前句：不打开歌词页也能看到唱到哪。
   * 第二行**替换掉作者**而不是再加一行——移动端播放条高度很紧张。
   */
  const currentLine = useMemo(() => {
    if (!snapshot || !lyricPrefs.showBarLine) return null
    const resolved = resolveLyrics(snapshot.state.text, snapshot.audio)
    if (!resolved.lines.length) return null
    const idx = activeLineIndex(resolved.lines, time)
    return resolved.lines[Math.max(0, idx)]?.text ?? null
  }, [snapshot, lyricPrefs.showBarLine, time])
  if (!snapshot) return null

  const playing = isPlayingId(player, snapshot.id)
  const loading = player.loadingId === snapshot.id
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  const VolumeIcon = prefs.muted || prefs.volume === 0 ? VolumeX : prefs.volume < 0.5 ? Volume1 : Volume2

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-ink-200/60 bg-white/85 px-3 py-2 backdrop-blur md:gap-3 md:px-4">
      <button
        onClick={() => void togglePlay(snapshot.id, onError)}
        aria-label={playing ? '暂停' : '播放'}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-800 text-white transition hover:bg-ink-900"
      >
        {loading ? (
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : playing ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          onClick={() => void playPrev(onError)}
          aria-label="上一首"
          title="上一首"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => void playNext(false, onError)}
          aria-label="下一首"
          title="下一首"
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex min-w-0 shrink-0 flex-col leading-tight">
        <span className="max-w-[7rem] truncate text-xs font-medium text-ink-800 md:max-w-[11rem]">
          {snapshot.label}
        </span>
        {currentLine ? (
          <button
            onClick={onOpenLyrics}
            title="当前句 · 点开歌词页"
            className="max-w-[9rem] truncate text-left text-[11px] text-ink-500 transition hover:text-ink-800 md:max-w-[14rem]"
          >
            {currentLine}
          </button>
        ) : (
          <span className="max-w-[7rem] truncate text-[11px] text-ink-400 md:max-w-[11rem]">
            {snapshot.state.author || '未填作者'}
          </span>
        )}
      </div>

      {/* 进度条：拖动即跳转 */}
      <input
        type="range"
        min={0}
        max={duration > 0 ? duration : 1}
        step={0.1}
        value={Math.min(time, duration || 1)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="播放进度"
        disabled={duration <= 0}
        style={{ ['--pct' as string]: `${pct}%` }}
        className="player-range min-w-0 flex-1"
      />
      <span className="hidden shrink-0 text-[11px] tabular-nums text-ink-500 sm:inline">
        {formatDuration(time) || '0:00'} / {duration > 0 ? formatDuration(duration) : '--:--'}
      </span>

      <button
        onClick={() => cycleMode()}
        aria-label={`播放模式：${PLAY_MODE_LABEL[prefs.mode]}`}
        title={`${PLAY_MODE_LABEL[prefs.mode]} · ${PLAY_MODE_HINT[prefs.mode]}（点击切换）`}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
      >
        <span aria-hidden>{MODE_ICON[prefs.mode]}</span>
        <span className="hidden lg:inline">{PLAY_MODE_LABEL[prefs.mode]}</span>
      </button>

      {/* 音量：点开才展开滑杆，不常驻占宽度 */}
      <div className="relative shrink-0">
        <button
          onClick={() => setVolumeOpen((v) => !v)}
          aria-label={prefs.muted ? '取消静音' : '音量'}
          aria-expanded={volumeOpen}
          title={`音量 ${Math.round(prefs.volume * 100)}%`}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-500 transition hover:bg-ink-50 hover:text-ink-800"
        >
          <VolumeIcon className="h-3.5 w-3.5" />
        </button>
        {volumeOpen && (
          <div className="absolute bottom-full right-0 z-40 mb-1 flex flex-col items-center gap-1 rounded-lg border border-ink-200 bg-white px-2 py-2 shadow-xl">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={prefs.muted ? 0 : prefs.volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="音量"
              className="player-range w-28"
              style={{ ['--pct' as string]: `${(prefs.muted ? 0 : prefs.volume) * 100}%` }}
            />
            <div className="flex w-full items-center justify-between">
              <span className="text-[11px] tabular-nums text-ink-500">
                {Math.round((prefs.muted ? 0 : prefs.volume) * 100)}%
              </span>
              <button
                onClick={() => toggleMute()}
                className="text-[11px] text-ink-500 transition hover:text-ink-800"
              >
                {prefs.muted ? '取消静音' : '静音'}
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onOpenQueue}
        aria-label="播放队列"
        title={`播放队列（${prefs.queue.length} 首）`}
        className="flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-600 transition hover:bg-ink-50 hover:text-ink-900"
      >
        <ListMusic className="h-3.5 w-3.5" />
        <span className="hidden tabular-nums md:inline">{prefs.queue.length}</span>
      </button>

      <button
        onClick={onOpenLyrics}
        aria-label="显示歌词"
        aria-pressed={lyricsOpen}
        title="显示滚动歌词"
        className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition ${
          lyricsOpen
            ? 'border-ink-800 bg-ink-800 text-white'
            : 'border-ink-200 text-ink-600 hover:border-ink-400 hover:text-ink-900'
        }`}
      >
        <Music className="h-3.5 w-3.5" />
        歌词
      </button>

      <button
        onClick={stopAll}
        aria-label="停止播放"
        title="停止并收起播放条"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
