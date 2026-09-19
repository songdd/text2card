export type Style = 'code' | 'quote' | 'prose' | 'poetry'

const CODE_LINE_HINTS = [
  /^\s*(function|const|let|var|class|interface|type|export|import|return)\b/,
  /^\s*(def|class|import|from|if|elif|else|for|while|try|with)\b/,
  /^\s*(#include|using namespace|template|struct|public:|private:)\b/,
  /^\s*(package|func|var|const|type|import)\b/,
  /^\s*<\/?[a-zA-Z][\w-]*[^>]*>\s*$/,
  /[{};]\s*$/,
]

const MD_RE = /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.*\|)/

const QUOTE_WRAPS = [
  /^["“「『][^]+["”」』]$/,
  /^['‘][^]+['’]$/,
]

const POETRY_LINE = /^[\s　]*[一-鿿]{4,9}[，。；？！,;?!]?[\s　]*$/
const POETRY_TITLE = /《[^》]+》/
/** 切句：中文标点、半角标点、冒号与所有空白（含换行）*/
const CLAUSE_SPLIT = /[，。；！？、,.!?;：:\s]+/
const CJK_CLAUSE = /^[一-鿿]{4,9}$/
/** 古典诗词的常见句长。限定这几个值能把「句子长度整齐的现代文案」挡在外面 */
const POEM_CLAUSE_LEN = new Set([4, 5, 7])

export function classify(input: string): Style {
  const text = input.trim()
  if (!text) return 'quote'

  // 1) code fences or many code-like lines
  if (/```/.test(text)) return 'code'
  const lines = text.split('\n')
  const codeLineCount = lines
    .slice(0, 10)
    .filter((l) => CODE_LINE_HINTS.some((re) => re.test(l))).length
  if (codeLineCount >= 3) return 'code'
  if (codeLineCount >= 2 && lines.length <= 6) return 'code'

  // 2) 古典诗词
  //
  // 判据是「短句多 + 句长整齐」，而不是「每行恰好一句」。
  // 旧实现只看行，于是单行粘贴的绝句、每行一联的律诗、诗经体全被判成金句——
  // 而诗词卡是 AI 背景功能唯一的宿主，判错就等于那个功能凭空消失。
  //
  // 为什么不能只数「4-9 字的短句」：现代短句同样满足这一点。
  // 真正的区别是**句长整齐且是古典常见句长**——四言全 4、五言全 5、七言全 7。
  // 三个条件同时成立才判诗词：
  //   1. 4-9 字的短句至少 4 句
  //   2. 这些短句的汉字数占全文汉字的 70% 以上（即正文就是这些短句，
  //      而不是长文里恰好夹了几句整齐的话）
  //   3. 句长**完全一致**，且属于 {4,5,7}
  // 用「汉字占比」而不是「短句数 / 切句数」，是因为落款会多切出几句：
  // 「—— 柳宗元」会贡献「——」和「柳宗元」两个片段，按句数算会把
  // 一首合格的绝句压到阈值以下，而按字数算不受影响。
  // 反例据此被挡住：
  //   「愿你慢慢长大，愿你有好运气，如果没有，愿你在不幸中学会慈悲」→ 句长 6/6/4/11 不一致
  //   「今天天气真好，我们出去走走。看看花开花落，听听风声雨声」→ 一致但全是 6 字
  //   「这是一段很长的正文。」×30 → 一致但全是 9 字
  const clauses = text
    .split(CLAUSE_SPLIT)
    .map((s) => s.trim())
    .filter(Boolean)
  const shortClauses = clauses.filter((c) => CJK_CLAUSE.test(c))
  const cjkChars = (text.match(/[一-鿿]/g) ?? []).length
  const shortChars = shortClauses.reduce((sum, c) => sum + c.length, 0)
  if (shortClauses.length >= 4 && cjkChars > 0 && shortChars >= cjkChars * 0.7) {
    const lens = new Set(shortClauses.map((c) => c.length))
    if (lens.size === 1 && POEM_CLAUSE_LEN.has([...lens][0])) return 'poetry'
  }

  // 2b) 兜底：短诗（如仅两行的对句）切句后不足 4 句，退回按行判断
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0)
  if (nonEmptyLines.length >= 2 && nonEmptyLines.length <= 12) {
    const matched = nonEmptyLines.filter((l) => POETRY_LINE.test(l)).length
    if (matched >= Math.max(2, Math.floor(nonEmptyLines.length * 0.6))) {
      return 'poetry'
    }
  }
  if (POETRY_TITLE.test(text) && nonEmptyLines.length <= 14) return 'poetry'

  // 3) markdown structure or long prose
  if (MD_RE.test(text)) return 'prose'
  if (text.length > 300) return 'prose'

  // 4) quote: short, wrapped, or simply not long
  if (QUOTE_WRAPS.some((re) => re.test(text))) return 'quote'
  if (text.length <= 140 && lines.length <= 4) return 'quote'

  return 'prose'
}
