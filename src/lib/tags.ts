/**
 * 标签与「组合标签预设」。
 *
 * 标签是**记录层**的元信息（和音频关联同类），不是渲染态——卡片画面上除了管理页
 * 的标签小片，诗词卡片本身不画标签。
 *
 * 预设的设计（对应「预置：人教小学版本 = 人教1年级、人教2年级…」）：
 *   一个预设 = 若干**组合**，每个组合是一组标签。
 *   **组合内是 AND（都要满足），组合之间是 OR（任一满足）**。
 * 这样「人教小学版本」写成三行就是「人教+1年级 或 人教+2年级 或 人教+3年级」，
 * 一键筛出人教版小学的全部诗词；而单独一行「人教 1年级」就是精确到年级的筛选。
 *
 * 存储里是 `string[][]`，界面上就是一个多行文本框、一行一个组合、行内用空格分隔
 * 标签——不做两层嵌套的编辑器，用户直接"写出来"最快。
 */

/** 单张卡片最多几个标签 */
export const MAX_TAGS = 20
/** 单个标签最长多少字 */
export const MAX_TAG_LENGTH = 24

/**
 * 归一化一个标签。
 *
 * 用 NFKC 折叠全角/半角：用户把「１年级」和「1年级」当成同一个标签，
 * 但字符串不同——不折叠就会分裂成两个标签，筛选时漏掉一半。
 * 顺带把连续空白压成一个空格、去掉首尾空白。
 */
export function normalizeTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const t = value.normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.slice(0, MAX_TAG_LENGTH)
}

/** 归一化一组标签：去重（忽略大小写）、限量 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of value) {
    const tag = normalizeTag(raw)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

/** 标签比较用的键（大小写不敏感） */
export function tagKey(tag: string): string {
  return normalizeTag(tag)?.toLowerCase() ?? ''
}

/** 一组标签是否全部命中（组合语义：AND） */
function hasAll(tags: Set<string>, combo: string[]): boolean {
  return combo.length > 0 && combo.every((c) => tags.has(c))
}

/** 是否命中预设：任一组合满足即可（组合之间 OR） */
export function matchesCombos(tags: string[], combos: string[][]): boolean {
  if (!combos.length) return true
  const set = new Set(tags.map(tagKey))
  return combos.some((combo) => hasAll(set, combo.map(tagKey).filter(Boolean)))
}

/** 多行文本 → 组合数组：一行一个组合，行内空格/逗号分隔标签 */
export function parseCombos(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => normalizeTags(line.split(/[\s,，、;；]+/)))
    .filter((combo) => combo.length > 0)
}

/** 组合数组 → 多行文本（编辑时回填） */
export function formatCombos(combos: string[][]): string {
  return combos.map((combo) => combo.join(' ')).join('\n')
}

/** 统计所有卡片用过的标签及次数，按次数倒序（用于输入建议与快捷添加） */
export function collectTags(snapshots: { state: { tags?: string[] } }[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>()
  for (const s of snapshots) {
    for (const tag of normalizeTags(s.state?.tags)) {
      const key = tagKey(tag)
      const hit = counts.get(key)
      if (hit) hit.count++
      else counts.set(key, { tag, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
}
