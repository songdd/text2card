/**
 * 墨色：正文 / 标题与作者的字色。
 *
 * 设计取舍：默认**跟随主题**。三套主题（宣纸 / 青绿山水 / 墨竹）各自的
 * `text` 与 `accent` 是配过对比度的，不动它最好看。这里做的是「覆盖」而不是
 * 「替代」——只有用户显式点过颜色才写进 state，其余一律回落主题。因此
 * 老快照（没有这两个字段）读出来仍是原来的长相，不需要迁移。
 *
 * 另一个动机来自 AI 背景：三套主题都是浅纸底、深墨字，一旦配上一张暗调照片，
 * 深墨字就糊在照片里了。以前只能靠蒙层硬压，现在可以直接换成浅色墨。
 */

export interface InkPreset {
  name: string
  /** 3 位或 6 位 hex，小写 */
  value: string
}

/**
 * 预设墨色。
 *
 * 前几个是纸上的深色（浅底主题、或者蒙层压得重时用），后两个是浅色
 * （专门给暗调 AI 背景用）。刻意不提供灰阶中间色：在照片上它们最容易
 * 两头不靠，用户要的话右侧有取色器。
 */
export const INK_PRESETS: InkPreset[] = [
  { name: '墨黑', value: '#241f19' },
  { name: '浓墨', value: '#000000' },
  { name: '朱砂', value: '#9e2b25' },
  { name: '赭石', value: '#7a4a24' },
  { name: '靛青', value: '#1f3a5f' },
  { name: '石绿', value: '#2f5d50' },
  { name: '鎏金', value: '#b8912f' },
  { name: '月白', value: '#f2ecdc' },
]

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * 把外部来的值收敛成合法 hex；任何不合法输入一律返回 `undefined`（= 跟随主题）。
 *
 * 为什么必须校：这两个值来自 localStorage / IndexedDB，也可能被手工改过，
 * 而它们会被直接塞进 `style.color`，并随 DOM 一起进入导出时的克隆与栅格化流程。
 * 只放行 hex，等于把「任意字符串进 style」这条路径整个关掉。
 */
export function normalizeInk(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  return HEX_RE.test(v) ? v.toLowerCase() : undefined
}
