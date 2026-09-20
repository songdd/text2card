import { useState, type ChangeEvent } from 'react'
import { Sparkles, Wand2, X } from 'lucide-react'
import type { Style } from '../lib/classifier'
import { parsePoem } from '../lib/parsePoem'
import { MAX_TAGS, normalizeTags, tagKey } from '../lib/tags'

interface Props {
  value: string
  onChange: (v: string) => void
  className?: string
  /** 生效风格，决定标题/作者这两个输入框的标签与是否显示解析按钮 */
  style: Style
  title: string
  onTitle: (v: string) => void
  author: string
  onAuthor: (v: string) => void
  /** 标签（1年级 / 人教 / 唐诗…） */
  tags: string[]
  /** 用函数式更新：一次要加/删多个标签时，读旧值回写会互相覆盖 */
  onTags: React.Dispatch<React.SetStateAction<string[]>>
  /** 已用过标签的统计，用于输入建议与一键添加 */
  tagSuggestions: { tag: string; count: number }[]
}

// 首次引导提示是否已被关闭（localStorage 记住，永久不再弹）
const HINT_KEY = 'text2card.hint.dismissed.v1'

const SAMPLES: { label: string; text: string }[] = [
  {
    label: '五言',
    text: '《山居秋暝》\n王维\n空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。',
  },
  {
    label: '七言',
    text: '《早发白帝城》\n李白\n朝辞白帝彩云间，千里江陵一日还。\n两岸猿声啼不住，轻舟已过万重山。',
  },
  {
    label: '宋词',
    text: '《如梦令》\n李清照\n昨夜雨疏风骤，浓睡不消残酒。\n试问卷帘人，却道海棠依旧。',
  },
]

interface FieldSpec {
  key: 'title' | 'author'
  label: string
  placeholder: string
}

/** 标题/作者在各风格下的叫法不同；代码卡的「标题」其实是文件名 */
function fieldsOf(style: Style): FieldSpec[] {
  switch (style) {
    case 'code':
      return [{ key: 'title', label: '文件名', placeholder: 'snippet.ts' }]
    case 'quote':
      return [{ key: 'author', label: '署名', placeholder: '—— 作者（可空）' }]
    case 'prose':
      return [
        { key: 'title', label: '标题', placeholder: '一段标题' },
        { key: 'author', label: '署名', placeholder: 'via @you' },
      ]
    case 'poetry':
      return [
        { key: 'title', label: '标题', placeholder: '题目' },
        { key: 'author', label: '作者', placeholder: '作者朝代' },
      ]
  }
}

interface UndoState {
  text: string
  title: string
  author: string
}

export function Editor({
  value,
  onChange,
  className = '',
  style,
  title,
  onTitle,
  author,
  onAuthor,
  tags,
  onTags,
  tagSuggestions,
}: Props) {
  const [showHint, setShowHint] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== '1'
    } catch {
      return false
    }
  })
  const [result, setResult] = useState<string | null>(null)
  // 解析会改写正文，属于破坏性操作，所以留一次撤销
  const [undoState, setUndoState] = useState<UndoState | null>(null)

  function dismissHint() {
    setShowHint(false)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // localStorage 不可用时忽略，本次会话内已关闭
    }
  }

  // 仅当用户输入了自己的内容（非空且不等于任一示例/默认文本）时才二次确认，
  // 避免手滑点示例覆盖掉正在编辑的文字
  function applySample(sampleText: string) {
    const dirty = value.trim() !== '' && !SAMPLES.some((s) => s.text === value)
    if (dirty && !window.confirm('用示例替换当前内容？正在编辑的文字会被覆盖。')) return
    onChange(sampleText)
    setResult(null)
    setUndoState(null)
  }

  function handleText(next: string) {
    onChange(next)
    // 手动改动正文后，原先的解析结果与撤销点都不再对应，一并清掉
    if (result) setResult(null)
    if (undoState) setUndoState(null)
  }

  function analyze() {
    const parsed = parsePoem(value)
    if (!parsed.changed) {
      setResult('没找出题目或作者，正文未改动。可手动填写，或把题目写成《…》。')
      setUndoState(null)
      return
    }
    setUndoState({ text: value, title, author })
    onChange(parsed.body)
    if (parsed.title) onTitle(parsed.title)
    if (parsed.author) onAuthor(parsed.author)

    const parts: string[] = []
    if (parsed.title) parts.push(`题目「${parsed.title}」`)
    if (parsed.author) parts.push(`作者「${parsed.author}」`)
    const bodyLen = parsed.body.replace(/\s/g, '').length
    setResult(`已解析：${parts.join(' · ')}，正文 ${bodyLen} 字（${parsed.notes.join('；')}）`)
  }

  function undo() {
    if (!undoState) return
    onChange(undoState.text)
    onTitle(undoState.title)
    onAuthor(undoState.author)
    setUndoState(null)
    setResult('已撤销解析')
  }

  const fields = fieldsOf(style)
  // 代码卡的「标题」是文件名，从代码里解析文件名没有意义
  const canParse = style !== 'code'

  return (
    <aside className={`h-full w-full shrink-0 flex-col border-r border-ink-200/60 bg-white/60 backdrop-blur md:w-[360px] ${className}`}>
      <div className="flex items-center justify-between border-b border-ink-200/60 px-5 py-4">
        <h2 className="font-serif text-lg font-semibold text-ink-800">编辑</h2>
        <div className="flex items-center gap-1.5">
          <span className="mr-0.5 text-xs text-ink-400">示例</span>
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              onClick={() => applySample(s.text)}
              className="rounded-full border border-ink-200 px-2.5 py-1 text-xs text-ink-600 transition hover:border-ink-400 hover:text-ink-800"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {showHint && (
        <div className="flex items-start gap-2 border-b border-amber-200/70 bg-amber-50/80 px-5 py-2.5 text-xs leading-relaxed text-ink-600">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1">
            粘贴或输入诗词，左侧底部可一键拆出题目与作者；上方按钮可载入示例。
          </span>
          <button
            onClick={dismissHint}
            title="不再提示"
            className="shrink-0 rounded p-0.5 text-ink-400 transition hover:text-ink-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <textarea
        value={value}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleText(e.target.value)}
        placeholder="在这里粘贴诗词……（题目与作者可在下方填写，或点「解析题目 / 作者」自动拆出）"
        className="font-mono flex-1 resize-none bg-transparent p-5 text-[14px] leading-relaxed text-ink-800 outline-none placeholder:text-ink-300"
        spellCheck={false}
      />

      {/* 标题/作者紧贴内容：它们本来就是从正文里拆出来的，放在这里才好对照 */}
      <div className="border-t border-ink-200/60 px-5 py-3.5">
        <div className="flex items-end gap-2">
          {fields.map((f) => (
            <label key={f.key} className="min-w-0 flex-1">
              <span className="mb-1 block text-[11px] text-ink-400">{f.label}</span>
              <input
                type="text"
                value={f.key === 'title' ? title : author}
                onChange={(e) => (f.key === 'title' ? onTitle : onAuthor)(e.target.value)}
                placeholder={f.placeholder}
                spellCheck={false}
                className="w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
              />
            </label>
          ))}
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-2">
          {canParse ? (
            <button
              onClick={analyze}
              disabled={!value.trim()}
              title="从上面的原文里拆出题目与作者，并把它们从正文中移出"
              className="flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-40"
            >
              <Wand2 className="h-3.5 w-3.5" />
              解析题目 / 作者
            </button>
          ) : (
            <span />
          )}
          <span className="text-xs tabular-nums text-ink-400">{value.length} 字</span>
        </div>

        {result && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-ink-100 bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600">
            <span className="flex-1">{result}</span>
            {undoState && (
              <button
                onClick={undo}
                className="shrink-0 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[11px] text-ink-600 transition hover:border-ink-300 hover:text-ink-800"
              >
                撤销
              </button>
            )}
          </div>
        )}
      </div>

      <TagEditor tags={tags} onTags={onTags} suggestions={tagSuggestions} />
    </aside>
  )
}

/**
 * 标签编辑区。
 *
 * 三件事必须一起做，否则标签功能会被用坏：
 *   1. **输入即建**：回车或逗号结束一个标签，不必先点「添加」；
 *   2. **已有标签一键加**：同一批卡片要打同一组标签（人教、1年级），
 *      逐个手打必然打出「人教版 / 人教 / 人教 版」三种写法，筛选就废了；
 *   3. **输入建议**（datalist）：拦一道拼写分裂。
 */
function TagEditor({
  tags,
  onTags,
  suggestions,
}: {
  tags: string[]
  onTags: React.Dispatch<React.SetStateAction<string[]>>
  suggestions: { tag: string; count: number }[]
}) {
  const [draft, setDraft] = useState('')
  const listId = 'text2card-tag-suggestions'

  /**
   * 一次加多个标签。
   *
   * 必须用**函数式更新**：粘贴「1年级,唐诗」会在同一次事件里连续加两个标签，
   * 若每次都从 props 上的 `tags` 读旧值再回写，后一次会把前一次的结果覆盖掉
   * ——实测就是「粘一串标签只剩最后一个」，而且界面上完全看不出报错。
   */
  function addMany(raws: string[]) {
    const cleaned = raws.filter((r) => r.trim())
    if (!cleaned.length) return
    onTags((prev) => {
      let next = prev
      for (const raw of cleaned) next = normalizeTags([...next, raw])
      return next
    })
    setDraft('')
  }

  function remove(tag: string) {
    const key = tagKey(tag)
    onTags((prev) => prev.filter((t) => tagKey(t) !== key))
  }

  const used = new Set(tags.map(tagKey))
  const unused = suggestions.filter((s) => !used.has(tagKey(s.tag)))

  return (
    <div className="border-t border-ink-200/60 px-5 py-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] text-ink-400">标签</span>
        <span className="text-[11px] tabular-nums text-ink-300">
          {tags.length}/{MAX_TAGS}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full border border-ink-200 bg-white py-0.5 pl-2 pr-1 text-[11px] text-ink-700"
          >
            {t}
            <button
              onClick={() => remove(t)}
              aria-label={`删除标签 ${t}`}
              className="rounded-full p-0.5 text-ink-300 transition hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}

        <input
          value={draft}
          list={listId}
          disabled={tags.length >= MAX_TAGS}
          onChange={(e) => {
            // 逗号/顿号也会触发"收下这个标签"：粘贴一串标签时不用一个个敲回车
            const v = e.target.value
            if (/[,，、;；]/.test(v)) {
              addMany(v.split(/[,，、;；]+/))
              return
            }
            setDraft(v)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (draft.trim()) addMany([draft])
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onTags((prev) => prev.slice(0, -1))
            }
          }}
          onBlur={() => {
            if (draft.trim()) addMany([draft])
          }}
          placeholder={tags.length ? '+ 继续添加' : '输入标签，回车确认（1年级 / 人教…）'}
          spellCheck={false}
          className="min-w-[6rem] flex-1 rounded-md border border-dashed border-ink-200 bg-white px-2 py-1 text-[11px] text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-500 disabled:opacity-40"
        />
        <datalist id={listId}>
          {unused.slice(0, 50).map((s) => (
            <option key={s.tag} value={s.tag} />
          ))}
        </datalist>
      </div>

      {unused.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-ink-300">用过：</span>
          {unused.slice(0, 10).map((s) => (
            <button
              key={s.tag}
              onClick={() => addMany([s.tag])}
              title={`已被 ${s.count} 张卡片使用`}
              className="rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500 transition hover:border-ink-300 hover:text-ink-800"
            >
              + {s.tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
