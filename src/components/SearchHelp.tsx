import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

/**
 * 搜索用法帮助面板。
 *
 * 为什么做成"示例可点"而不是纯说明文字：搜索语法这种东西，看十行说明不如点一下
 * 看到结果。所以每条示例都是一个按钮，点了直接填进搜索框并关面板——用户立刻看到
 * 「原来是这样」，而不是"读完了还得自己敲一遍"。
 *
 * **为什么用 portal 挂到 body 而不是就地绝对定位**：工具条上有 `backdrop-blur`，
 * 而 `backdrop-filter` 会创建**层叠上下文**。面板若留在工具条内部，它的 z-index
 * 只在工具条这一层里有效；工具条本身是 static、按 z-index:0 那层绘制，而卡片在
 * DOM 里排在它后面 —— 结果就是面板被卡片盖住（真实踩过：面板上半截正常、
 * 下半截点不动，因为点在卡片上了）。portal 到 body + position: fixed 之后，
 * 面板处在根层叠上下文里，z-index 才真正生效。
 */

interface Example {
  q: string
  note: string
}

const GROUPS: { title: string; hint?: string; items: Example[] }[] = [
  {
    title: '一次搜多个',
    hint: '空格、逗号、顿号、分号都算分隔符；粘一列题目也能搜。默认「任一」命中。',
    items: [{ q: '静夜思 江雪 鹿柴', note: '这批里已经存过哪些' }],
  },
  {
    title: '精确到字段',
    hint: '字段名 + 冒号，半角全角都认；冒号后多打空格也没关系。',
    items: [
      { q: '作者：李白', note: '只搜作者，不会命中标题里提到李白的诗' },
      { q: '标题：静夜思', note: '只搜标题（题目）' },
      { q: '正文：明月', note: '只搜诗词正文' },
      { q: '标签：1年级', note: '只搜标签' },
    ],
  },
  {
    title: '组合条件',
    hint: '默认「任一」命中；点提示行上的「全部」就变成同时满足。',
    items: [{ q: '作者：杜甫 标签：人教', note: '姓杜的、且带「人教」标签的' }],
  },
]

export function SearchHelp({
  anchorRef,
  onPick,
  onClose,
}: {
  /** 搜索框容器：面板贴着它展开，并且点它不算"点外面" */
  anchorRef: RefObject<HTMLElement | null>
  onPick: (q: string) => void
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)

  // 贴着搜索框定位；窗口大小变化或任何容器滚动都重新算一次
  useLayoutEffect(() => {
    function place() {
      const r = anchorRef.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(416, window.innerWidth - r.left - 12)
      const top = r.bottom + 6
      setPos({ left: r.left, top, width, maxHeight: Math.max(200, window.innerHeight - top - 16) })
    }
    place()
    window.addEventListener('resize', place)
    // capture：任何滚动容器（列表区）滚动时也要跟着走
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorRef])

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node
      // 面板内部点不管；点那个「?」按钮也不算外面——否则"再点一次关闭"会变成
      // mousedown 关掉、紧接着 click 又打开，看起来就是关不掉
      if (boxRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  if (!pos) return null

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label="搜索用法"
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}
      className="z-40 overflow-y-auto rounded-xl border border-ink-200 bg-white p-3 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-400">搜索用法</span>
        <button
          onClick={onClose}
          aria-label="关闭搜索用法"
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="mb-1 text-[11px] font-medium text-ink-700">{g.title}</div>
            {g.hint && <p className="mb-1.5 text-[11px] leading-relaxed text-ink-400">{g.hint}</p>}
            <div className="flex flex-col gap-1">
              {g.items.map((ex) => (
                <button
                  key={ex.q}
                  onClick={() => {
                    onPick(ex.q)
                    onClose()
                  }}
                  title="点击填入搜索框"
                  className="flex items-baseline gap-2 rounded-md border border-ink-100 bg-ink-50/60 px-2 py-1.5 text-left transition hover:border-ink-300 hover:bg-white"
                >
                  <code className="shrink-0 rounded bg-white px-1.5 py-0.5 font-mono text-[11px] text-ink-800">
                    {ex.q}
                  </code>
                  <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-ink-500">{ex.note}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-md bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-500">
          <div className="font-medium text-ink-700">字段名可以写的写法</div>
          <div className="mt-0.5">
            标题 / 题目 / 题 / 诗名 / title　·　作者 / 诗人 / 署名 / author / by　·　正文 / 内容 / 全文 / 诗句 / text　·　标签 / tag / tags
          </div>
          <div className="mt-1.5 font-medium text-ink-700">其他</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
            <li>写错的字段名会明确提示（例如「朝代」），不会悄悄按全文搜。</li>
            <li>命中张数、没找到的关键词都会列在搜索框下面。</li>
            <li>搜索与「预设」同时生效时取交集。</li>
          </ul>
        </section>
      </div>
    </div>,
    document.body,
  )
}
