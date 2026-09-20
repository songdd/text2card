import { parseLyrics } from './lyrics'
import type { AudioMeta } from './snapshots'

/**
 * 卡片「音频完成度」的三态。
 *
 * 为什么不是简单的"有/没有音频"两态：这个库真正的推进过程是三段的——
 * 先有卡片，再配上朗读音频，最后把字幕时间轴对上（歌词才能精确滚动）。
 * 中间那一段最容易积压（音频有了、字幕还没空做），所以单独给一个**黄色**state，
 * 让"还差一步"的卡片一眼可见；两边都完成才是绿色。
 *
 * 颜色集中在这里定义，卡片、列表、按钮都从这里取——否则三处各写一套 class，
 * 迟早出现"卡片是绿的、按钮还是灰的"。
 */
export type AudioState = 'none' | 'audio' | 'ready'

export function audioStateOf(audio?: AudioMeta | null): AudioState {
  if (!audio) return 'none'
  if (!audio.lyricText) return 'audio'
  const parsed = parseLyrics(audio.lyricText)
  return parsed?.cues.length ? 'ready' : 'audio'
}

export const AUDIO_STATE_LABEL: Record<AudioState, string> = {
  none: '尚未关联音频',
  audio: '已关联音频，还没有歌词时间轴（歌词只能按句长比例滚动）',
  ready: '已关联音频和歌词时间轴（歌词精确同步）',
}

/** 卡片边框：绿=完整，黄=差时间轴，灰=还没有音频 */
export const AUDIO_STATE_BORDER: Record<AudioState, string> = {
  none: 'border-ink-200 hover:border-ink-400',
  audio: 'border-amber-300 hover:border-amber-400',
  ready: 'border-emerald-300 hover:border-emerald-400',
}

/** 状态圆点 */
export const AUDIO_STATE_DOT: Record<AudioState, string> = {
  none: '',
  audio: 'bg-amber-500',
  ready: 'bg-emerald-600',
}

/** 「关联音频」按钮：有音频之后明显变绿/变黄，一眼能认出哪些已经配过 */
export const AUDIO_STATE_BUTTON: Record<AudioState, string> = {
  none: 'border-white/40 bg-black/40 text-white hover:bg-black/60',
  audio: 'border-amber-200/80 bg-amber-500/90 text-white hover:bg-amber-500',
  ready: 'border-emerald-200/80 bg-emerald-600/90 text-white hover:bg-emerald-600',
}

/** 列表视图里的文字色（小标签/按钮用） */
export const AUDIO_STATE_TEXT: Record<AudioState, string> = {
  none: 'text-ink-400 hover:text-ink-700',
  audio: 'text-amber-600 hover:text-amber-700',
  ready: 'text-emerald-600 hover:text-emerald-700',
}
