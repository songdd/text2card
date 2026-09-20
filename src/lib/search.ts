import type { Snapshot } from './snapshots'

/**
 * 管理页的搜索解析：关键词 + **字段限定**。
 *
 * 为什么需要字段限定：全文子串匹配有个躲不开的误伤——搜「李白」会把正文里
 * 提到李白的诗也捞出来（比如《春日忆李白》），而用户此时想要的是"作者是李白"。
 * 加上 `作者：李白` 这种写法，用户就能精确表达意图。
 *
 * 设计取舍：
 *  - 语法用**中文全角/半角冒号** `字段：值`，不引入引号、括号这类要记的符号；
 *  - 字段名收得宽（标题/题目/诗名、作者/诗人/署名、正文/内容/全文、标签），
 *    因为"用户会怎么写"无从预料，认出来比认不出来强；
 *  - **不认识的字段会明确提示**，而不是悄悄按全文搜——否则用户写错一个字，
 *    得到的是"搜到了但结果不对"，比搜不到更难查。
 */

export type FieldKey = 'title' | 'author' | 'text' | 'tag'

export const FIELD_LABEL: Record<FieldKey, string> = {
  title: '标题',
  author: '作者',
  text: '正文',
  tag: '标签',
}

const FIELD_ALIAS: Record<string, FieldKey> = {
  // 标题
  标题: 'title',
  题目: 'title',
  题: 'title',
  诗名: 'title',
  名: 'title',
  title: 'title',
  // 作者
  作者: 'author',
  诗人: 'author',
  署名: 'author',
  author: 'author',
  by: 'author',
  // 正文
  正文: 'text',
  内容: 'text',
  全文: 'text',
  诗句: 'text',
  text: 'text',
  content: 'text',
  body: 'text',
  // 标签
  标签: 'tag',
  tag: 'tag',
  tags: 'tag',
}

export interface SearchTerm {
  /** 限定字段；null = 全文 */
  field: FieldKey | null
  /** 归一化后的值（小写、去空白） */
  value: string
  /** 界面上回显用的原文，例如「作者：李白」 */
  raw: string
}

export interface ParsedQuery {
  terms: SearchTerm[]
  /** 写了「xx：yy」但 xx 不认识——提示用户，不要默默按全文搜 */
  unknownFields: string[]
}

/** 分隔符：空白（含全角空格）、, ， 、 ; ； */
const SEPARATOR = /[\s\u3000,，、;；]+/
/** 字段写法：前缀 + 冒号（半角/全角） */
const FIELD_RE = /^([^\s:：]{1,6})[:：](.*)$/

/** 拆成原始 token（分隔符很宽，因为粘进来的东西无从预料） */
export function splitKeywords(query: string): string[] {
  const out: string[] = []
  for (const raw of query.split(SEPARATOR)) {
    const t = raw.trim()
    if (t) out.push(t)
  }
  return out
}

/**
 * 解析整条查询。
 *
 * 两个细节：`作者： 李白` 这种**冒号后带空格**的写法会先被分隔符切开，
 * 所以这里把「以冒号结尾的 token」和下一个 token 合并——不然用户多打一个空格
 * 就静默退化成全文搜索。
 */
export function parseQuery(query: string): ParsedQuery {
  const raw = splitKeywords(query)
  const merged: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i]
    if (/[:：]$/.test(cur) && i + 1 < raw.length) {
      merged.push(cur + raw[i + 1])
      i++
    } else {
      merged.push(cur)
    }
  }

  const terms: SearchTerm[] = []
  const unknownFields: string[] = []
  const seen = new Set<string>()

  for (const token of merged) {
    const m = token.match(FIELD_RE)
    if (m) {
      const key = m[1].toLowerCase()
      const value = m[2].trim()
      const field = FIELD_ALIAS[key] ?? FIELD_ALIAS[m[1]]
      if (!field) {
        // 前缀像字段名（字母/汉字），但不在名单里 → 提示
        if (/^[\p{L}]+$/u.test(m[1])) unknownFields.push(m[1])
        // 仍然按全文搜，用户至少能看到点结果
        const dedupe = `全文\u0000${token.toLowerCase()}`
        if (!seen.has(dedupe)) {
          seen.add(dedupe)
          terms.push({ field: null, value: token.toLowerCase(), raw: token })
        }
        continue
      }
      if (!value) continue // 「作者：」还没写完，先不当条件
      const dedupe = `${field}\u0000${value.toLowerCase()}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      terms.push({ field, value: value.toLowerCase(), raw: `${FIELD_LABEL[field]}：${value}` })
      continue
    }
    const dedupe = `全文\u0000${token.toLowerCase()}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    terms.push({ field: null, value: token.toLowerCase(), raw: token })
  }

  return { terms, unknownFields }
}

export interface FieldTexts {
  title: string
  author: string
  text: string
  tag: string
  /** 全部字段拼起来，给不限定字段的关键词用 */
  all: string
}

/** 一张卡片的各字段文本（小写）。算一次给所有关键词复用 */
export function fieldsOf(snapshot: Snapshot): FieldTexts {
  const title = [snapshot.label, snapshot.state.title].filter(Boolean).join('\u0000').toLowerCase()
  const author = (snapshot.state.author ?? '').toLowerCase()
  const text = (snapshot.state.text ?? '').toLowerCase()
  const tag = (snapshot.state.tags ?? []).join('\u0000').toLowerCase()
  return { title, author, text, tag, all: [title, author, text, tag].filter(Boolean).join('\u0000') }
}

/** 单个条件是否命中（限定字段就在该字段里找，否则全文找） */
export function termHits(fields: FieldTexts, term: SearchTerm): boolean {
  if (!term.value) return true
  return fields[term.field ?? 'all'].includes(term.value)
}

/**
 * 命中规则。默认 **任一命中（OR）**：批量搜索的诉求是「这批里哪些有」。
 * 切成「全部」时每个条件都要满足——配合字段限定就是精确查询：
 * `作者：李白 标签：1年级` = 李白的、且带 1年级 标签的。
 */
export function matchesTerms(
  fields: FieldTexts,
  terms: SearchTerm[],
  mode: 'any' | 'all' = 'any',
): boolean {
  if (!terms.length) return true
  return mode === 'all' ? terms.every((t) => termHits(fields, t)) : terms.some((t) => termHits(fields, t))
}
