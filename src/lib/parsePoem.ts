/**
 * 从「原始粘贴内容」里拆出 题目 / 作者 / 正文。
 *
 * 刻意用本地规则而不是调大模型：粘贴后要立刻看到结果，规则匹配是即时的、
 * 免费的、可离线的，而且格式是有限的。语义层面的理解（画面五字段）另有
 * 方舟拆解负责，两者分工不重叠。
 *
 * 原则是**宁可少认，不可错认**：把诗的第一句当成题目，比没解析出题目更糟，
 * 因为用户不会逐字核对。所以每条规则都带明确的排除条件。
 */

export interface ParsedPoem {
  title: string
  author: string
  body: string
  /** 命中的规则说明，用于界面反馈 */
  notes: string[]
  /** 是否解析出题目或作者；为 false 时调用方不应改动任何内容 */
  changed: boolean
}

/**
 * —— 柳宗元 / –– 王维 / -- 李白
 *
 * 刻意**不接受单个 ASCII 连字符**：`- 第一点` 是 Markdown 列表项，
 * 放宽到单连字符会把每个列表的第一条当成作者署名。中文里作署名用的是
 * 破折号（——），单个半角减号基本只出现在列表里。
 */
const RE_DASH_AUTHOR = /^(?:—{1,3}|-{2,}|–{1,3}|─{1,3})\s*(.+)$/
/** 作者：柳宗元 / by Li Bai */
const RE_LABELED_AUTHOR = /^(?:作者|作者简介|by)\s*[:：]\s*(.+)$/i
/** 整行只有括号包裹的内容，如 （唐）王维 */
const RE_PAREN_ONLY = /^[（(][^）)]{1,20}[）)]$/
/** 题目：江雪 / 标题：静夜思 */
const RE_LABELED_TITLE = /^(?:题目|标题|诗题)\s*[:：]\s*(.+)$/
/** Markdown 标题 */
const RE_MD_HEADING = /^#{1,6}\s+(.+?)\s*#*$/
/** 《江雪》 */
const RE_BRACKET_TITLE = /^《(.+?)》$/
/** 江雪 · 柳宗元 / 静夜思|李白 */
const RE_TITLE_AUTHOR = /^(.{1,20}?)\s*[·・|｜]\s*(.{1,20})$/
/** 句读标点——用来判断一行是不是「诗句」而不是「题目/署名」 */
const RE_PUNCT = /[，。！？、；：,.!?;:]/
/** 纯空白行 */
const isBlank = (s: string) => s.trim() === ''

function firstNonBlank(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) if (!isBlank(lines[i])) return i
  return -1
}

function nextNonBlank(lines: string[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) if (!isBlank(lines[i])) return i
  return -1
}

/**
 * 判断第 idx 行是「题头」（题目或作者）而不是正文的一部分。
 *
 * 判据：把它拿掉后，剩下的行要**明显更长**（严格大于该行长度）。
 * 这一条同时挡住两种最容易犯的错：
 *   - 四句五言那种「每行都是 5 字」，首行长度等于其余行平均值，
 *     于是「千山鸟飞绝」不会被当成题目；
 *   - 「静夜思 / 床前明月光 / 疑是地上霜 / …」里，题目下面那行
 *     长度与后续诗句相同，于是不会被当成作者。
 *
 * 代价是长题目（如「宣州谢朓楼饯别校书叔云」+ 七言）认不出来，
 * 但这类题目通常本来就写作《…》，由《》规则覆盖。
 */
function restIsLonger(lines: string[], idx: number, minRest: number): boolean {
  const rest = lines
    .slice(idx + 1)
    .map((s) => s.trim())
    .filter(Boolean)
  if (rest.length < minRest) return false
  const avg = rest.reduce((sum, s) => sum + s.length, 0) / rest.length
  return avg > lines[idx].trim().length
}

export function parsePoem(raw: string): ParsedPoem {
  const notes: string[] = []
  const lines = raw.split(/\r?\n/)
  const drop = new Set<number>()

  let title = ''
  let author = ''

  // ---------------- 题目 ----------------
  const first = firstNonBlank(lines)
  if (first >= 0) {
    const line = lines[first].trim()

    const bracket = line.match(RE_BRACKET_TITLE)
    const labeled = line.match(RE_LABELED_TITLE)
    const heading = line.match(RE_MD_HEADING)
    const titleAuthor = line.match(RE_TITLE_AUTHOR)

    if (bracket) {
      title = bracket[1].trim()
      drop.add(first)
      notes.push('题目取自《》')
    } else if (labeled) {
      title = labeled[1].trim()
      drop.add(first)
      notes.push('题目取自「题目：」')
    } else if (heading) {
      title = heading[1].trim()
      drop.add(first)
      notes.push('题目取自 Markdown 标题')
    } else if (titleAuthor && !RE_PUNCT.test(line)) {
      // 「江雪 · 柳宗元」一行同时给出题目和作者
      title = titleAuthor[1].trim()
      author = titleAuthor[2].trim()
      drop.add(first)
      notes.push('题目与作者取自「题目 · 作者」一行')
    } else if (!RE_PUNCT.test(line) && line.length <= 10 && restIsLonger(lines, first, 1)) {
      title = line
      drop.add(first)
      notes.push('题目取自首行（首行短、正文更长）')
    }
  }

  // ---------------- 作者 ----------------
  // 先找明确带标记的（——、作者：），这类不会误判
  if (!author) {
    for (let i = 0; i < lines.length; i++) {
      if (isBlank(lines[i]) || drop.has(i)) continue
      const line = lines[i].trim()
      const dash = line.match(RE_DASH_AUTHOR)
      const labeledAuthor = line.match(RE_LABELED_AUTHOR)
      if (dash) {
        author = dash[1].trim()
        drop.add(i)
        notes.push('作者取自「——」落款')
        break
      }
      if (labeledAuthor) {
        author = labeledAuthor[1].trim()
        drop.add(i)
        notes.push('作者取自「作者：」')
        break
      }
    }
  }

  // 再看题目下面那行：短、无标点、且后续诗句明显更长 → 视为作者
  if (!author && title && drop.has(first)) {
    const next = nextNonBlank(lines, first)
    if (next >= 0) {
      const line = lines[next].trim()
      if (!RE_PUNCT.test(line) && line.length <= 12 && restIsLonger(lines, next, 2)) {
        author = line
        drop.add(next)
        notes.push('作者取自题目下一行')
      }
    }
  }

  // 最后看末行是否为纯括号署名（与卡片原有的处理保持一致）
  if (!author) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (isBlank(lines[i]) || drop.has(i)) continue
      const line = lines[i].trim()
      if (RE_PAREN_ONLY.test(line)) {
        author = line
        drop.add(i)
        notes.push('作者取自末行括号署名')
      }
      break
    }
  }

  const body = lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/^[\s\n]+/, '')
    .replace(/[\s\n]+$/, '')

  return { title, author, body, notes, changed: Boolean(title || author) }
}
