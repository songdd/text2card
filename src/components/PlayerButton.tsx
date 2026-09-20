import { Loader2, Pause, Play } from 'lucide-react'
import { isPlayingId, togglePlay, useAudioPlayer } from '../lib/audioPlayer'

/**
 * 卡片上的播放/暂停按钮。
 *
 * 状态来自全局播放器单例：每张卡都订阅，按自己的 id 判断该显示什么。
 * 所以「另一首开始播了」会立刻让这张卡自己变回「播放」态——不需要谁去通知谁。
 */
export function PlayerButton({
  id,
  onError,
  onToggle,
  size = 'md',
  className = '',
}: {
  /** 卡片（快照）id，音频就是按它关联的 */
  id: string
  /** 播放出错时的提示出口（接 toast） */
  onError?: (msg: string) => void
  /**
   * 覆盖默认行为。管理页用它做「以这张卡为起点重建播放队列」——
   * 这样点卡片 ▶ 之后 ⏭ 才有下一首可走。
   */
  onToggle?: () => void
  size?: 'sm' | 'md'
  className?: string
}) {
  const player = useAudioPlayer()
  const playing = isPlayingId(player, id)
  const loading = player.loadingId === id
  const box = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'
  const icon = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <button
      type="button"
      onClick={(e) => {
        // 卡片本身是可点的（点开大图），播放按钮不能把它一起触发
        e.stopPropagation()
        e.preventDefault()
        if (onToggle) onToggle()
        else void togglePlay(id, onError)
      }}
      aria-label={playing ? '暂停' : '播放'}
      aria-pressed={playing}
      title={playing ? '暂停' : '播放这首诗的音频'}
      className={`flex ${box} shrink-0 items-center justify-center rounded-full border transition ${
        playing
          ? 'border-ink-800 bg-ink-800 text-white'
          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400 hover:text-ink-900'
      } ${className}`}
    >
      {loading ? (
        <Loader2 className={`${icon} animate-spin`} />
      ) : playing ? (
        <Pause className={icon} />
      ) : (
        <Play className={`${icon} fill-current`} />
      )}
    </button>
  )
}
