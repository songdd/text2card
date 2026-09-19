import { useState, type ChangeEvent } from 'react'
import { Sparkles, Wand2, X } from 'lucide-react'
import type { Style } from '../lib/classifier'
import { parsePoem } from '../lib/parsePoem'

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
}

// 首次引导提示是否已被关闭（localStorage 记住，永久不再弹）
const HINT_KEY = 'text2card.hint.dismissed.v1'

const SAMPLES: { label: string; text: string }[] = [
  {
    label: '金句',
    text: '愿你慢慢长大，愿你有好运气，如果没有，愿你在不幸中学会慈悲。',
  },
  {
    label: '代码',
    text: `function greet(name: string) {\n  const message = \`Hello, \${name}!\`\n  console.log(message)\n  return message\n}\n\ngreet('world')`,
  },
  {
    label: '长文',
    text: `# 关于写作的笔记\n\n写作是一种思考方式。\n\n## 第一原则\n\n- 先把想法写下来，不要怕粗糙\n- 把动词改得更精确\n- 删掉每一个不必要的形容词\n\n> 写作的核心，是把模糊的想法变成清晰的句子。\n\n参考：\`https://example.com\``,
  },
  {
    label: '诗词',
    text: '《山居秋暝》\n空山新雨后\n天气晚来秋\n明月松间照\n清泉石上流',
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

export function Editor({ value, onChange, className = '', style, title, onTitle, author, onAuthor }: Props) {
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
            粘贴或输入任意文本，自动识别风格并生成卡片；上方按钮可载入示例。
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
        placeholder="在这里粘贴你想分享的文字、代码、Markdown 或诗词……"
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
    </aside>
  )
}
