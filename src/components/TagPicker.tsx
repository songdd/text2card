import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { MAX_TAGS, normalizeTag, normalizeTags, tagKey } from '../lib/tags'

/**
 * 快速打标签的两个界面，共用同一套「输入 + 常用标签」逻辑。
 *
 * 为什么是**贴卡片的小弹层**而不是全屏弹窗（单卡）：
 * 打标签是连续的活（一年级 30 首），全屏弹窗每张卡都要开关一次；小弹层点外面
 * 才关，于是可以「点 + → 点标签 → 点下一张的 +」一路打下去。
 * 批量则相反——一次性作用于几十张，值得一个明确的弹窗和一次「应用」确认。
 */

interface Suggestion {
  tag: string
  count: number
}

/**
 * 卡片上的一个标签片：**标签文本 + 悬停出现的 ×**。
 *
 * 两点刻意的设计：
 *  1. **点标签本身不做任何事**。早先的版本是"点标签 = 拿它去搜"，看起来方便，
 *     实际是个陷阱：卡片上一个小片点一下就改变整个列表的筛选口径（而它长得
 *     并不像个筛选控件），用户会莫名其妙地"东西怎么没了"。筛选只走搜索框和预设，
 *     这两个地方一看就知道自己在筛选。
 *  2. **× 的位置永远被预留**（pr-3.5），只切 opacity。如果让 × 撑开宽度，
 *     悬停瞬间标签行会重新折行、整张卡片跟着跳——比没有 × 更难受。
 */
export function TagChip({
  tag,
  onRemove,
  removeLabel,
  className = '',
}: {
  tag: string
  onRemove?: (tag: string) => void
  /** 读屏用的名字前缀，默认「删除标签」 */
  removeLabel?: string
  className?: string
}) {
  return (
    <span
      className={`group/chip relative inline-flex max-w-[7rem] items-center rounded-full border border-ink-100 bg-ink-50 py-0.5 pl-1.5 pr-3.5 text-[10px] text-ink-500 transition hover:border-ink-300 hover:text-ink-800 ${className}`}
    >
      <span className="truncate">{tag}</span>
      {onRemove && (
        <button
          onClick={() => onRemove(tag)}
          title={`移除「${tag}」`}
          aria-label={`${removeLabel ?? '删除标签'} ${tag}`}
          className="absolute right-0.5 top-1/2 flex h-3.5 w-3.5 -translate-y-1/2 items-center justify-center rounded-full text-ink-400 opacity-0 transition hover:bg-white hover:text-red-600 focus:opacity-100 group-hover/chip:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}

/**
 * 输入区 + 常用标签列表。
 *
 * 「点一下直接加」是"快速"的核心：不输入、不确认、不关弹层。
 * 常用标签按使用次数排序，这也是防止「人教 / 人教版」写法分裂的第一道闸。
 */
function PickerBody({
  current,
  suggestions,
  onAdd,
  onRemove,
  disabled,
}: {
  current: string[]
  suggestions: Suggestion[]
  onAdd: (tags: string[]) => void
  /** 只有单卡模式给：批量是纯新增，移除交给别处 */
  onRemove?: (tag: string) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useMemo(() => `tag-suggest-${Math.random().toString(36).slice(2, 8)}`, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const used = new Set(current.map(tagKey))
  const unused = suggestions.filter((s) => !used.has(tagKey(s.tag)))
  const full = current.length >= MAX_TAGS

  function commit(text: string) {
    const parts = text.split(/[\s,，、;；]+/).map(normalizeTag).filter(Boolean) as string[]
    if (parts.length) onAdd(parts)
    setDraft('')
  }

  return (
    <>
      <div className="flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 py-1.5 focus-within:border-ink-600">
        <Plus className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        <input
          ref={inputRef}
          value={draft}
          list={listId}
          disabled={disabled || full}
          onChange={(e) => {
            const v = e.target.value
            // 逗号/顿号也算"收下"：粘一串标签不用一个个敲回车
            if (/[,，、;；]/.test(v)) {
              commit(v)
              return
            }
            setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (draft.trim()) commit(draft)
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit(draft)
          }}
          placeholder={full ? `已达上限 ${MAX_TAGS} 个` : '输入标签，回车确认'}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-xs text-ink-800 outline-none placeholder:text-ink-300"
        />
        <datalist id={listId}>
          {unused.slice(0, 50).map((s) => (
            <option key={s.tag} value={s.tag} />
          ))}
        </datalist>
      </div>

      {unused.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-400">常用（点一下直接加）</span>
          <div className="flex flex-wrap gap-1">
            {unused.slice(0, 14).map((s) => (
              <button
                key={s.tag}
                onClick={() => onAdd([s.tag])}
                disabled={disabled || full}
                title={`已被 ${s.count} 张卡片使用`}
                className="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-[11px] text-ink-600 transition hover:border-ink-400 hover:bg-ink-50 hover:text-ink-900 disabled:opacity-40"
              >
                + {s.tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {current.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-400">已加</span>
          <div className="flex flex-wrap gap-1">
            {current.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full bg-ink-100 py-0.5 pl-2 pr-1 text-[11px] text-ink-700"
              >
                {t}
                {onRemove && (
                  <button
                    onClick={() => onRemove(t)}
                    disabled={disabled}
                    aria-label={`移除标签 ${t}`}
                    className="rounded-full p-0.5 text-ink-400 transition hover:bg-white hover:text-red-600 disabled:opacity-40"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * 单卡：贴在卡片下方的小弹层。
 *
 * 点卡片外部或 Esc 关闭（点弹层内部不关）——判断用 `mousedown` 而不是 `click`：
 * 用 click 的话，在弹层里按下、拖到外面松开也会关掉，手感很怪。
 */
export function CardTagPopover({
  current,
  suggestions,
  busy,
  onAdd,
  onRemove,
  onClose,
}: {
  current: string[]
  suggestions: Suggestion[]
  busy?: boolean
  onAdd: (tags: string[]) => void
  onRemove: (tag: string) => void
  onClose: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current?.contains(e.target as Node)) return
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
  }, [onClose])

  return (
    <div
      ref={boxRef}
      role="dialog"
      aria-label="快速加标签"
      className="absolute left-1.5 right-1.5 top-full z-30 mt-1 flex flex-col gap-2 rounded-lg border border-ink-200 bg-white p-2.5 shadow-xl"
    >
      <PickerBody
        current={current}
        suggestions={suggestions}
        onAdd={onAdd}
        onRemove={onRemove}
        disabled={busy}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-300">
          {current.length}/{MAX_TAGS}
        </span>
        <button
          onClick={onClose}
          className="rounded border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500 transition hover:border-ink-400 hover:text-ink-800"
        >
          完成
        </button>
      </div>
    </div>
  )
}

/**
 * 批量：给选中的多张卡片**追加**标签。
 *
 * 先攒后应用：攒的过程中只是本地列表，点「应用」才写库。
 * 这样用户能先看清楚「到底要加什么」，而不是点一下就改了几十张。
 */
export function BatchTagDialog({
  count,
  suggestions,
  busy,
  onApply,
  onClose,
}: {
  count: number
  suggestions: Suggestion[]
  busy?: boolean
  onApply: (tags: string[]) => void
  onClose: () => void
}) {
  const [staged, setStaged] = useState<string[]>([])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <span className="truncate font-medium text-ink-800">给选中的 {count} 张加标签</span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-4 py-4">
          <PickerBody
            current={staged}
            suggestions={suggestions}
            onAdd={(tags) => setStaged((prev) => normalizeTags([...prev, ...tags]))}
            onRemove={(tag) => setStaged((prev) => prev.filter((t) => tagKey(t) !== tagKey(tag)))}
            disabled={busy}
          />

          <p className="rounded-md bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-500">
            只会<span className="font-medium text-ink-700">追加</span>
            ，不会清掉这些卡片原有的标签。当前已有 {count} 张被选中。
          </p>

          <button
            onClick={() => onApply(staged)}
            disabled={busy || staged.length === 0}
            className="flex items-center justify-center gap-2 rounded-md bg-ink-800 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {staged.length ? `给 ${count} 张加上「${staged.join('、')}」` : '先添加要打的标签'}
          </button>
        </div>
      </div>
    </div>
  )
}
