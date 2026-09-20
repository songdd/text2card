import { useSyncExternalStore } from 'react'
import { getAudioBlob } from './snapshots'

/**
 * 全局唯一的媒体播放器。
 *
 * 为什么是模块级单例而不是每个卡片一个 `<audio>`：
 * 「不要有同时播放的混乱场景」是需求本身。让每张卡片各自持有一个 audio 元素，
 * 就得靠一堆 pause 调用去维持互斥，漏一处就两声齐鸣。这里物理上只有一个
 * `<audio>`、一条 `src`——**结构上不可能同时播放两首**，切换时旧的自然停。
 *
 * **两条独立的订阅**（这是性能关键）：
 *   - 粗状态（哪张卡在播、是否在播）→ 给所有卡片，用于显示 ▶/⏸。变化很少。
 *   - 细状态（当前秒数）→ 只给底部播放条和歌词页。播放时每秒变 10 次。
 * 如果把 currentTime 塞进粗状态里，几十张卡片会跟着每秒重渲染十几次——
 * 典型的"看起来能跑但很卡"。
 */

export interface PlayerState {
  /**
   * 当前装载的卡片 id。**暂停后依然保留**：否则一暂停播放条就消失，
   * 用户连"继续播"的入口都没有了。
   */
  currentId: string | null
  playing: boolean
  /** 正在从 IndexedDB 取音频/起播的卡片 id */
  loadingId: string | null
}

/** 时间状态：只给播放条与歌词页订阅 */
export interface MediaTime {
  time: number
  duration: number
}

let el: HTMLAudioElement | null = null
/** 当前 src 的 object URL，切换时必须 revoke，否则 blob 会一直占着内存 */
let objectUrl: string | null = null
let state: PlayerState = { currentId: null, playing: false, loadingId: null }
let timeState: MediaTime = { time: 0, duration: 0 }
/** 每次起播自增。异步取音频期间用户又点了别的卡片时，用它丢弃过期结果 */
let token = 0
/** 最近一次调用的报错出口（媒体元素自己报错时也能提示到） */
let errorSink: ((msg: string) => void) | null = null
const subscribers = new Set<() => void>()
const timeSubscribers = new Set<() => void>()
let rafId = 0

function setState(next: PlayerState) {
  state = next
  for (const fn of subscribers) fn()
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

function getState() {
  return state
}

/** 卡片组件用它订阅粗状态 */
export function useAudioPlayer(): PlayerState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** 某张卡片是否正在播放（粗状态的派生） */
export function isPlayingId(s: PlayerState, id: string): boolean {
  return s.playing && s.currentId === id
}

function emitTime() {
  for (const fn of timeSubscribers) fn()
}

function setTime(time: number, duration: number) {
  // 量化到 0.1 秒：进度条不至于卡顿，同时把重渲染压到每秒 10 次
  const t = Math.round(time * 10) / 10
  const d = Number.isFinite(duration) ? Math.round(duration * 10) / 10 : 0
  if (t === timeState.time && d === timeState.duration) return
  timeState = { time: t, duration: d }
  emitTime()
}

function subscribeTime(fn: () => void) {
  timeSubscribers.add(fn)
  return () => {
    timeSubscribers.delete(fn)
  }
}

function getTime() {
  return timeState
}

/** 播放条 / 歌词页订阅时间 */
export function useMediaTime(): MediaTime {
  return useSyncExternalStore(subscribeTime, getTime, getTime)
}

// ------------------------------------------------------------------ 播放偏好

export type PlayMode = 'sequential' | 'loop-all' | 'repeat-one' | 'shuffle'

export const PLAY_MODE_ORDER: PlayMode[] = ['sequential', 'loop-all', 'repeat-one', 'shuffle']

export const PLAY_MODE_LABEL: Record<PlayMode, string> = {
  sequential: '顺序播放',
  'loop-all': '列表循环',
  'repeat-one': '单曲循环',
  shuffle: '随机播放',
}

export const PLAY_MODE_HINT: Record<PlayMode, string> = {
  sequential: '播完下一首，到队尾停止',
  'loop-all': '播完下一首，到队尾回到第一首',
  'repeat-one': '一直重放这一首',
  shuffle: '打乱顺序播放，一轮内不重复',
}

export interface PlayerPrefs {
  mode: PlayMode
  /** 0–1 */
  volume: number
  muted: boolean
  /** 播放队列（卡片 id 顺序） */
  queue: string[]
  /** 队列是否被用户手动改过（改过就沿用，没改过则每次按当前筛选重建） */
  custom: boolean
}

const PREFS_KEY = 'text2card.player.v1'

function loadPrefs(): PlayerPrefs {
  const fallback: PlayerPrefs = { mode: 'sequential', volume: 1, muted: false, queue: [], custom: false }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return fallback
    const data = JSON.parse(raw) as Partial<PlayerPrefs>
    return {
      mode: PLAY_MODE_ORDER.includes(data.mode as PlayMode) ? (data.mode as PlayMode) : fallback.mode,
      volume:
        typeof data.volume === 'number' && data.volume >= 0 && data.volume <= 1 ? data.volume : fallback.volume,
      muted: Boolean(data.muted),
      queue: Array.isArray(data.queue) ? data.queue.filter((x): x is string => typeof x === 'string') : [],
      custom: Boolean(data.custom),
    }
  } catch {
    return fallback
  }
}

let prefs: PlayerPrefs = loadPrefs()
/** 随机模式下的播放顺序：队列变化或切到随机时重排一次，保证"一轮内不重复" */
let shuffled: string[] = []
const prefsSubscribers = new Set<() => void>()

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // localStorage 不可用（隐私模式）时忽略，本次会话内仍然生效
  }
}

function setPrefs(next: Partial<PlayerPrefs>) {
  prefs = { ...prefs, ...next }
  savePrefs()
  for (const fn of prefsSubscribers) fn()
}

function subscribePrefs(fn: () => void) {
  prefsSubscribers.add(fn)
  return () => {
    prefsSubscribers.delete(fn)
  }
}

function getPrefs() {
  return prefs
}

/**
 * 播放偏好单独一条订阅：拖音量滑杆时每秒变几十次，
 * 不能让所有卡片跟着重渲染（它们只关心"哪张在播"）。
 */
export function usePlayerPrefs(): PlayerPrefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
}

export function getPlayerPrefs(): PlayerPrefs {
  return prefs
}

function reshuffle() {
  const list = [...prefs.queue]
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  shuffled = list
}

/** 当前生效的播放顺序：随机模式用打乱后的顺序，其他用队列本身 */
function activeOrder(): string[] {
  if (prefs.mode !== 'shuffle') return prefs.queue
  if (!shuffled.length || shuffled.length !== prefs.queue.length) reshuffle()
  return shuffled
}

export function setMode(mode: PlayMode) {
  if (mode === 'shuffle') reshuffle()
  setPrefs({ mode })
}

export function cycleMode(): PlayMode {
  const next = PLAY_MODE_ORDER[(PLAY_MODE_ORDER.indexOf(prefs.mode) + 1) % PLAY_MODE_ORDER.length]
  setMode(next)
  return next
}

export function setVolume(v: number) {
  const volume = Math.min(1, Math.max(0, v))
  setPrefs({ volume, muted: volume === 0 ? prefs.muted : false })
  if (el) {
    el.volume = volume
    if (volume > 0) el.muted = false
  }
}

export function toggleMute() {
  const muted = !prefs.muted
  setPrefs({ muted })
  if (el) el.muted = muted
}

/** 设置队列。`custom` 表示这是用户手动挑/改过的（刷新后沿用） */
export function setQueue(ids: string[], custom = false) {
  setPrefs({ queue: ids, custom })
  reshuffle()
}

export function removeFromQueue(id: string) {
  setQueue(
    prefs.queue.filter((x) => x !== id),
    true,
  )
}

/** 拖动排序：把 from 位置的项移到 to 位置 */
export function moveInQueue(from: number, to: number) {
  const list = [...prefs.queue]
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return
  const [item] = list.splice(from, 1)
  list.splice(to, 0, item)
  setQueue(list, true)
}

/** 队列里当前这首排第几（1 起）；不在队列里返回 0 */
export function queuePosition(): number {
  const list = activeOrder()
  const i = state.currentId ? list.indexOf(state.currentId) : -1
  return i < 0 ? 0 : i + 1
}

// ------------------------------------------------------------------ 时间与播放

/** 命令式读取当前时间（歌词跳转等一次性用途） */
export function currentTime(): number {
  return el?.currentTime ?? 0
}

function pump() {
  rafId = 0
  const media = el
  if (!media || media.paused) return
  setTime(media.currentTime, media.duration)
  rafId = requestAnimationFrame(pump)
}

function startPump() {
  if (!rafId) rafId = requestAnimationFrame(pump)
}

function stopPump() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  const media = el
  if (media) setTime(media.currentTime, media.duration)
}

function releaseUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

function reset() {
  setState({ currentId: null, playing: false, loadingId: null })
}

/**
 * 惰性创建唯一的媒体元素，并挂到 body 上。
 * 挂上去是为了让元素可被调试工具看到、媒体事件能被文档层监听；
 * `hidden` 保证它不参与布局。
 */
function element(): HTMLAudioElement {
  if (el) return el
  const a = document.createElement('audio')
  a.hidden = true
  a.preload = 'metadata'
  a.volume = prefs.volume
  a.muted = prefs.muted
  a.addEventListener('timeupdate', () => setTime(a.currentTime, a.duration))
  a.addEventListener('loadedmetadata', () => setTime(a.currentTime, a.duration))
  a.addEventListener('durationchange', () => setTime(a.currentTime, a.duration))
  a.addEventListener('seeked', () => setTime(a.currentTime, a.duration))
  a.addEventListener('play', () => {
    setState({ ...state, playing: true })
    startPump()
  })
  a.addEventListener('pause', () => {
    setState({ ...state, playing: false })
    stopPump()
  })
  a.addEventListener('ended', () => {
    stopPump()
    const onlyOne = prefs.queue.length <= 1
    // 单曲循环 / 队列只有一首且要求循环 → 原地重放
    if (state.currentId && (prefs.mode === 'repeat-one' || (onlyOne && prefs.mode !== 'sequential'))) {
      a.currentTime = 0
      void a.play()
      return
    }
    // 否则按模式续播下一首
    if (!onlyOne) {
      void playNext(true, errorSink ?? undefined)
      return
    }
    // 顺序播放且只有一首：停在开头，播放条留在原位
    a.currentTime = 0
    setState({ ...state, playing: false })
  })
  a.addEventListener('error', () => {
    const failed = state.currentId
    releaseUrl()
    reset()
    if (failed) errorSink?.('音频播放失败：文件可能损坏或格式不被浏览器支持')
  })
  document.body.appendChild(a)
  el = a
  return a
}

/** 装载并播放某一首（不含"同一首暂停/继续"的判断，那由 togglePlay 负责） */
async function playTrack(id: string, onError?: (msg: string) => void): Promise<void> {
  const a = element()
  // 先掐掉上一首。这一步是「同时播放」的唯一防线，且必须在 await 之前做，
  // 否则取音频的这段时间里旧的还在响。
  a.pause()
  releaseUrl()
  a.removeAttribute('src')
  setTime(0, 0)

  const mine = ++token
  setState({ currentId: id, playing: false, loadingId: id })

  try {
    const blob = await getAudioBlob(id)
    if (!blob) throw new Error('这条卡片没有音频数据（可能已被清理），请重新关联')
    // 取数据期间用户又点了别的卡片：这次作废，别去抢播放权
    if (mine !== token) return

    objectUrl = URL.createObjectURL(blob)
    a.src = objectUrl
    a.volume = prefs.volume
    a.muted = prefs.muted
    await a.play()
    if (mine !== token) {
      a.pause()
      return
    }
    setState({ currentId: id, playing: true, loadingId: null })
    setTime(a.currentTime, a.duration)
  } catch (err) {
    if (mine === token) reset()
    onError?.(err instanceof Error ? err.message : String(err))
  }
}

/**
 * 播放/暂停某张卡片的音频。
 *
 * - 点正在播的那张 → 暂停（保留 currentId，播放条留在原位）
 * - 点另一张 → **先停掉当前这首**，再起新的（同一个元素，不存在交叠）
 * - 同一张暂停后再点 → 直接 resume，不重新读 blob
 */
export async function togglePlay(id: string, onError?: (msg: string) => void): Promise<void> {
  errorSink = onError ?? null
  const a = element()

  if (state.currentId === id) {
    if (state.playing) {
      a.pause()
      return
    }
    if (a.getAttribute('src')) {
      try {
        await a.play()
        return
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err))
        return
      }
    }
  }
  await playTrack(id, onError)
}

/** 直接播放某一首（队列面板里点某一项用；不走"同曲暂停"判断） */
export async function playTrackById(id: string, onError?: (msg: string) => void): Promise<void> {
  errorSink = onError ?? null
  await playTrack(id, onError)
}

/** 从队列的某一首开始播放（点全局播放键 / 点卡片 ▶ 都走这里） */
export async function startPlayback(
  ids: string[],
  startId: string,
  onError?: (msg: string) => void,
): Promise<void> {
  setQueue(ids, false)
  if (state.currentId === startId && state.playing) return
  await togglePlay(startId, onError)
}

/** 下一首。`auto` = 播完自动续播（到队尾按模式决定停止或回到开头） */
export async function playNext(auto = false, onError?: (msg: string) => void): Promise<void> {
  const list = activeOrder()
  if (!list.length) return
  const i = state.currentId ? list.indexOf(state.currentId) : -1
  let nextId: string | null = null
  if (i < 0) nextId = list[0]
  else if (i + 1 < list.length) nextId = list[i + 1]
  else if (!auto) nextId = list[0] // 手动「下一首」到队尾：回到开头
  else if (prefs.mode === 'loop-all' || prefs.mode === 'shuffle') {
    if (prefs.mode === 'shuffle') reshuffle()
    nextId = activeOrder()[0] ?? null
  } else {
    return // 顺序播放：到队尾就停
  }
  if (nextId && nextId !== state.currentId) await playTrack(nextId, onError)
}

/** 上一首。到队首时回到队尾（手动操作总是有反馈） */
export async function playPrev(onError?: (msg: string) => void): Promise<void> {
  const list = activeOrder()
  if (!list.length) return
  const i = state.currentId ? list.indexOf(state.currentId) : -1
  const prevId = i <= 0 ? list[list.length - 1] : list[i - 1]
  if (prevId) await playTrack(prevId, onError)
}

/** 跳转到某个秒数（进度条拖动、点歌词行） */
export function seek(seconds: number) {
  const a = el
  if (!a || !a.getAttribute('src')) return
  const max = Number.isFinite(a.duration) ? a.duration : 0
  a.currentTime = Math.min(Math.max(seconds, 0), max > 0 ? max - 0.05 : seconds)
  setTime(a.currentTime, a.duration)
}

/** 卡片被删/音频被解除关联时调用：正在放它就停掉，别放一个已经不存在的东西 */
export function stopIfPlaying(id: string) {
  if (state.currentId !== id && state.loadingId !== id) return
  token++
  el?.pause()
  releaseUrl()
  if (el) el.removeAttribute('src')
  setTime(0, 0)
  reset()
}

/** 清空全部数据、或用户点播放条的 ✕ 时用 */
export function stopAll() {
  token++
  el?.pause()
  releaseUrl()
  if (el) el.removeAttribute('src')
  setTime(0, 0)
  reset()
}
