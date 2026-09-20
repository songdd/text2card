/**
 * 歌词时间轴：解析字幕/歌词文件，并把「诗句」与「时间」对应起来。
 *
 * 三条时间轴来源，优先级从高到低：
 *   1. **字幕/歌词文件**（.srt / .lrc，用户自己打轴）—— 时间戳是人给的，精确；
 *   2. **静音检测自动对齐**（后续阶段）；
 *   3. **按句长比例推算** —— 零成本，任何卡片立刻能用，节奏均匀时够用。
 *
 * 为什么把显示文本也一起管：字幕文件里有的是**音频真正在念的内容**，与正文可能
 * 不完全一致（多出标题行、朗诵者行、译文行）。所以默认用字幕自己的文本显示，
 * 正文只用来校验并给出提示——硬把字幕的时间戳套到诗句上，错位比不显示更糟。
 */

export interface LyricCue {
  /** 起始秒 */
  start: number
  /** 结束秒（SRT 有；LRC 用下一条的时间推出来）。有了它才能做句内推进 */
  end?: number
  text: string
}

export interface ParsedLyrics {
  format: 'srt' | 'lrc'
  /** 时间轴条目（字幕里的一条可能被拆成多句，见下） */
  cues: LyricCue[]
  /** 原始条数（SRT 的字幕块数 / LRC 的时间戳行数），用于如实地告诉用户"拆成了几句" */
  blocks: number
}

export interface LyricLine {
  text: string
  start: number
  end?: number
}

export type LyricSource = 'srt' | 'lrc' | 'proportional' | 'none'

/** 中文 srt/lrc 常见 GBK/GB18030：先按 UTF-8 严格解，失败再退回 gb18030 */
export function decodeLyricsBuffer(buf: ArrayBuffer): string {
  const strip = (s: string) => s.replace(/^\uFEFF/, '')
  try {
    return strip(new TextDecoder('utf-8', { fatal: true }).decode(buf))
  } catch {
    try {
      return strip(new TextDecoder('gb18030').decode(buf))
    } catch {
      return strip(new TextDecoder().decode(buf))
    }
  }
}

/** `hh:mm:ss,mmm` / `mm:ss.mmm` / `mm:ss` → 秒 */
function parseClock(raw: string): number | undefined {
  const m = raw.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/)
  if (!m) return undefined
  const [, h, mm, ss, frac] = m
  const fracSec = frac ? Number(`0.${frac}`) : 0
  return (h ? Number(h) * 3600 : 0) + Number(mm) * 60 + Number(ss) + fracSec
}

const SRT_TIME_RE = /(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[.,]\d{1,3})|(\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}[.,]\d{1,3})/
const LRC_STAMP_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const LRC_META_RE = /^\[(ti|ar|al|by|re|ve|length|offset):/i

/**
 * 按**内容**识别格式（不看扩展名）：
 * 文件被改名成 .txt 也要能认出来。
 */
export function parseLyrics(raw: string): ParsedLyrics | null {
  if (!raw.trim()) return null
  const hasArrow = /-->/.test(raw)
  const hasLrcStamp = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(raw)
  if (hasArrow) return parseSrt(raw)
  if (hasLrcStamp) return parseLrc(raw)
  return null
}

/**
 * 把一条字幕的时间窗按各句字数加权分给它的每一句。
 *
 * 为什么需要它：**古诗字幕里一条字幕常常装着一整联**（`蜀国曾闻子规鸟，宣城还见杜鹃花`
 * 或换行成两行）。早先的实现只取第一行、把其余当"译文"丢掉——对古诗来说这是直接
 * 丢了半首诗，而且行数一少滚动就跟着错。现在把每一句都当成独立的歌词行，
 * 时间窗按字数摊开：长句占得多，短句占得少，滚动粒度也从"联"变成"句"。
 */
function distribute(
  start: number,
  end: number | undefined,
  clauses: string[],
  fallbackGap = 1.2,
): LyricCue[] {
  const weights = clauses.map((c) => Math.max(1, normalizeForMatch(c).length))
  const total = weights.reduce((a, b) => a + b, 0)
  const span = end !== undefined && end > start ? end - start : clauses.length * fallbackGap
  let cursor = start
  return clauses.map((text, i) => {
    const dur = (weights[i] / total) * span
    const cue: LyricCue = { start: cursor, end: cursor + dur, text }
    cursor += dur
    return cue
  })
}

/** 一行字幕文本 → 若干句（按句读标点切；切不动就原样一行） */
function toClauses(text: string): string[] {
  const clauses = splitClauses(text)
  return clauses.length ? clauses : [text]
}

function parseSrt(raw: string): ParsedLyrics | null {
  const blocks = raw.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: LyricCue[] = []
  let blockCount = 0
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const timeIdx = lines.findIndex((l) => SRT_TIME_RE.test(l))
    if (timeIdx < 0) continue
    const m = lines[timeIdx].match(SRT_TIME_RE)
    if (!m) continue
    const start = parseClock(m[1] ?? m[3] ?? '')
    const end = parseClock(m[2] ?? m[4] ?? '')
    if (start === undefined) continue
    const texts = lines
      .slice(timeIdx + 1)
      .map((t) => t.replace(/<[^>]+>/g, '').trim())
      .filter(Boolean)
    if (!texts.length) continue
    blockCount++
    // 块内每个换行都是一句，每句再按句读细分；整块共享同一个时间窗
    const clauses = texts.flatMap(toClauses)
    cues.push(...distribute(start, end, clauses))
  }
  if (!cues.length) return null
  cues.sort((a, b) => a.start - b.start)
  return { format: 'srt', cues, blocks: blockCount }
}

function parseLrc(raw: string): ParsedLyrics | null {
  // 先收集原始行（时间戳 + 文本），再用"下一条的起点"补出结束时间
  const rawRows: { start: number; text: string }[] = []
  let offsetMs = 0
  for (const line of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const offMatch = trimmed.match(/^\[offset:\s*([+-]?\d+)\s*\]/i)
    if (offMatch) {
      offsetMs = Number(offMatch[1])
      continue
    }
    if (LRC_META_RE.test(trimmed)) continue
    const stamps = [...trimmed.matchAll(LRC_STAMP_RE)]
    if (!stamps.length) continue
    const text = trimmed.replace(LRC_STAMP_RE, '').trim()
    if (!text) continue
    for (const st of stamps) {
      const mm = Number(st[1])
      const ss = Number(st[2])
      const frac = st[3] ? Number(`0.${st[3]}`) : 0
      rawRows.push({ start: mm * 60 + ss + frac, text })
    }
  }
  if (!rawRows.length) return null
  rawRows.sort((a, b) => a.start - b.start)
  // LRC 的 [offset:] 是毫秒；正值表示歌词应提前显示 → 时间轴整体前移
  const shift = offsetMs / 1000
  const rows = shift ? rawRows.map((r) => ({ ...r, start: Math.max(0, r.start - shift) })) : rawRows

  const cues: LyricCue[] = []
  for (let i = 0; i < rows.length; i++) {
    const next = rows[i + 1]
    const own = toClauses(rows[i].text)
    cues.push(...distribute(rows[i].start, next?.start, own))
  }
  const deduped: LyricCue[] = []
  for (const c of cues) {
    const prev = deduped[deduped.length - 1]
    if (prev && Math.abs(prev.start - c.start) < 0.01 && prev.text === c.text) continue
    deduped.push(c)
  }
  return { format: 'lrc', cues: deduped, blocks: rows.length }
}

/**
 * 把正文切成**句**。
 *
 * 为什么按句而不是按行：卡片排版一行一联（竖排需要），但朗读是按句停顿的。
 * 按句切让对齐粒度翻倍，比例推算立刻准一截。标点保留在句尾（歌词带标点很自然）。
 */
export function splitClauses(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line) => line.split(/(?<=[，。！？；：、,.!?;:])/))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 用于比对文本的归一化：去掉标点、空白、大小写差异 */
function normalizeForMatch(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

export interface MatchReport {
  /** 字幕条数 */
  cueCount: number
  /** 正文句数 */
  clauseCount: number
  /** 按顺序能对上正文的条数 */
  matched: number
  /** 对不上的字幕下标（通常是标题行、朗诵者行） */
  extraIndexes: number[]
  /** 正文里没被任何字幕覆盖的下标 */
  missingIndexes: number[]
  /** 顺序匹配后，字幕与正文是否一一对应 */
  aligned: boolean
}

/** 把字幕和正文对一遍，给出可读的校验结果（界面要如实告诉用户对没对上） */
export function matchLyrics(cues: LyricCue[], clauses: string[]): MatchReport {
  const normClauses = clauses.map(normalizeForMatch)
  const extraIndexes: number[] = []
  const usedClauses = new Set<number>()
  let j = 0
  let matched = 0
  for (let i = 0; i < cues.length; i++) {
    const cue = normalizeForMatch(cues[i].text)
    let hitAt = -1
    for (let k = j; k < normClauses.length; k++) {
      const c = normClauses[k]
      if (!c) continue
      if (c === cue || c.includes(cue) || cue.includes(c)) {
        hitAt = k
        break
      }
    }
    if (hitAt >= 0) {
      matched++
      usedClauses.add(hitAt)
      j = hitAt + 1
    } else {
      extraIndexes.push(i)
    }
  }
  const missingIndexes = clauses.map((_, i) => i).filter((i) => !usedClauses.has(i))
  return {
    cueCount: cues.length,
    clauseCount: clauses.length,
    matched,
    extraIndexes,
    missingIndexes,
    aligned: cues.length === clauses.length && matched === clauses.length,
  }
}

/**
 * 比例推算：按**句长加权**把时长摊到每句上。
 *
 * 权重用去标点后的字数——长句读得久。留白/前奏用 offset 补偿（朗读与字幕常见的
 * "开头几秒没声音"）。这是没有时间轴数据时的兜底，不追求精确，只求"大致跟着走"。
 */
export function buildProportionalLines(
  clauses: string[],
  duration: number,
  offset = 0,
): LyricLine[] {
  if (!clauses.length || !Number.isFinite(duration) || duration <= 0) return []
  const weights = clauses.map((c) => Math.max(1, normalizeForMatch(c).length))
  const total = weights.reduce((a, b) => a + b, 0)
  const from = Math.min(Math.max(offset, 0), Math.max(0, duration - 0.5))
  const span = Math.max(0.5, duration - from)
  let cursor = from
  return clauses.map((text, i) => {
    const start = cursor
    cursor += (weights[i] / total) * span
    return { text, start }
  })
}

export interface ResolvedLyrics {
  lines: LyricLine[]
  source: LyricSource
  /** 给界面看的说明（用正文替换了字幕文本之类） */
  note?: string
}

/**
 * 决定这张卡片最终显示哪些歌词行、各自从第几秒开始。
 * `audio` 就是快照记录上的 audio 元信息。
 */
export function resolveLyrics(
  poemText: string,
  audio: {
    lyricText?: string
    lyricMode?: 'subtitle' | 'poem'
    offset?: number
    duration?: number
  } | null | undefined,
): ResolvedLyrics {
  const clauses = splitClauses(poemText)
  const offset = audio?.offset ?? 0

  if (audio?.lyricText) {
    const parsed = parseLyrics(audio.lyricText)
    if (parsed?.cues.length) {
      // 用正文文本替换字幕文本：只在「条数与句数完全一致」时才允许，
      // 否则会把诗句硬套到错位的时间戳上
      const usePoem = audio.lyricMode === 'poem' && parsed.cues.length === clauses.length
      return {
        source: parsed.format,
        note: usePoem ? '文本取自正文，时间取自字幕' : undefined,
        lines: parsed.cues.map((c, i) => ({
          text: usePoem ? clauses[i] : c.text,
          start: c.start + offset,
          end: c.end === undefined ? undefined : c.end + offset,
        })),
      }
    }
  }

  if (audio?.duration && clauses.length) {
    return { lines: buildProportionalLines(clauses, audio.duration, offset), source: 'proportional' }
  }
  return { lines: [], source: 'none' }
}

export const LYRIC_SOURCE_LABEL: Record<LyricSource, string> = {
  srt: '字幕文件（精确）',
  lrc: 'LRC 歌词（精确）',
  proportional: '按句长比例推算（不精确）',
  none: '无时间轴',
}

/** 当前时间对应的歌词行下标；没有匹配返回 -1 */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= time) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** 秒 → `[mm:ss.xx]` */
export function lrcStamp(seconds: number): string {
  const t = Math.max(0, seconds)
  const mm = Math.floor(t / 60)
  const ss = Math.floor(t % 60)
  const cs = Math.floor((t - Math.floor(t)) * 100)
  return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`
}

/** 时间轴导出成 .lrc：对齐结果因此变成可复用资产 */
export function toLrc(lines: LyricLine[], header?: { title?: string; artist?: string }): string {
  const head: string[] = []
  if (header?.title) head.push(`[ti:${header.title}]`)
  if (header?.artist) head.push(`[ar:${header.artist}]`)
  return [...head, ...lines.map((l) => `${lrcStamp(l.start)}${l.text}`)].join('\n') + '\n'
}
