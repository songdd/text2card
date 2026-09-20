import { useSyncExternalStore } from 'react'

/**
 * 歌词**显示**偏好。
 *
 * 它和"卡片数据"无关，纯粹是"我想怎么看"：有人要一屏多看几行，有人要一句话怼在
 * 屏幕中间，还有人要竖排（本产品卡片就是竖排的，看着才是一套）。所以：
 *   - 存 localStorage、**全局共用一套**（不按卡片各记一份）；
 *   - 改完立刻生效，不放进"设置页"——调字号换样式是边看边调的事。
 */

export type LyricStyle = 'center' | 'compact' | 'single' | 'vertical'
export type LyricFontScale = 'sm' | 'md' | 'lg'
/** 歌词面板形态：整屏 / 右下角小窗 */
export type LyricPanel = 'full' | 'mini'

export const LYRIC_PANEL_LABEL: Record<LyricPanel, string> = {
  full: '整屏',
  mini: '小窗',
}

export const LYRIC_PANEL_HINT: Record<LyricPanel, string> = {
  full: '铺满整个屏幕，适合专心听读',
  mini: '小窗不挡手上的活：按住标题栏可拖到任意位置，双击回到右下角',
}

/** 小窗位置（视口坐标，左上角）。null = 默认右下角 */
export interface MiniPos {
  x: number
  y: number
}

/** 小窗透明度下限：再低字就浮在内容上看不清了 */
export const MINI_OPACITY_MIN = 0.2
/** 小窗默认透明度：比纯白纸轻，又还压得住底下的内容 */
export const MINI_OPACITY_DEFAULT = 0.9

export const LYRIC_STYLE_LABEL: Record<LyricStyle, string> = {
  center: '居中卡拉OK',
  compact: '紧凑列表',
  single: '单句大字',
  vertical: '竖排',
}

export const LYRIC_STYLE_HINT: Record<LyricStyle, string> = {
  center: '当前句居中放大，上下渐隐',
  compact: '一屏多看几行，长诗/宋词更好用',
  single: '一屏只有当前句，适合跟读与投屏',
  vertical: '竖排从右往左推进，和卡片一套',
}

export const LYRIC_FONT_LABEL: Record<LyricFontScale, string> = {
  sm: '小',
  md: '中',
  lg: '大',
}

export const LYRIC_FONT_FACTOR: Record<LyricFontScale, number> = {
  sm: 0.85,
  md: 1,
  lg: 1.25,
}

export interface LyricPrefs {
  style: LyricStyle
  fontScale: LyricFontScale
  /** 面板形态：整屏还是右下角小窗 */
  panel: LyricPanel
  /** 小窗被拖到哪儿了（null = 默认右下角；视口缩小后会重新夹回屏内） */
  miniPos: MiniPos | null
  /** 小窗底色透明度：越低越像"浮在内容上的字幕"，越高越像一块纸 */
  miniOpacity: number
  /** 小窗是否描边（默认不描边：它只是浮在内容上的一层歌词，不该像一扇窗） */
  miniBorder: boolean
  /** 播放条里是否滚动显示当前句（不打断手上的活就能看到唱到哪） */
  showBarLine: boolean
  /** 歌词页是否铺上这张卡片自己的背景（AI 配图 / 主题纸底） */
  showBackground: boolean
}

const KEY = 'text2card.lyrics.v1'
const STYLES: LyricStyle[] = ['center', 'compact', 'single', 'vertical']
const PANELS: LyricPanel[] = ['full', 'mini']

/** 存下来的坐标要**验一遍**：写坏的值（NaN / 字符串）会让小窗整个飞出屏幕 */
function readPos(raw: unknown): MiniPos | null {
  if (!raw || typeof raw !== 'object') return null
  const { x, y } = raw as Partial<MiniPos>
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** 透明度同样要验：写坏的值会让小窗直接看不见（0）或完全遮住内容（>1） */
function readOpacity(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MINI_OPACITY_DEFAULT
  const clamped = Math.min(1, Math.max(MINI_OPACITY_MIN, raw))
  return Math.round(clamped * 100) / 100
}

function load(): LyricPrefs {
  const fallback: LyricPrefs = {
    style: 'center',
    fontScale: 'md',
    panel: 'full',
    miniPos: null,
    miniOpacity: MINI_OPACITY_DEFAULT,
    miniBorder: false,
    showBarLine: true,
    showBackground: true,
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return fallback
    const data = JSON.parse(raw) as Partial<LyricPrefs>
    return {
      style: STYLES.includes(data.style as LyricStyle) ? (data.style as LyricStyle) : fallback.style,
      fontScale:
        data.fontScale && data.fontScale in LYRIC_FONT_FACTOR ? data.fontScale : fallback.fontScale,
      panel: PANELS.includes(data.panel as LyricPanel) ? (data.panel as LyricPanel) : fallback.panel,
      miniPos: readPos(data.miniPos),
      miniOpacity: readOpacity(data.miniOpacity),
      miniBorder: data.miniBorder === true,
      showBarLine: data.showBarLine !== false,
      showBackground: data.showBackground !== false,
    }
  } catch {
    return fallback
  }
}

let prefs: LyricPrefs = load()
const subscribers = new Set<() => void>()

export function setLyricPrefs(next: Partial<LyricPrefs>) {
  prefs = { ...prefs, ...next }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // 隐私模式下写不了，本次会话仍然生效
  }
  for (const fn of subscribers) fn()
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

function get() {
  return prefs
}

export function useLyricPrefs(): LyricPrefs {
  return useSyncExternalStore(subscribe, get, get)
}

export function getLyricPrefs(): LyricPrefs {
  return prefs
}
