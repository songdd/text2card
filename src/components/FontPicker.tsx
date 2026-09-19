import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  FONT_GROUP_ORDER,
  FONT_OPTIONS,
  LATIN_ONLY_KEYS,
  fontHintOf,
  type FontGroup,
  type FontKey,
} from '../lib/fonts'

/**
 * 字体选择器。
 *
 * 分组可折叠：档位已经 24 个（中文 12 / 日文 2 / 西文 10），平铺会把右栏拉得
 * 很长。初始只展开「当前选中项所在的那一组」，其余收起——折叠时组标题右侧会
 * 显示当前选中的是哪一档，免得收起来就看不见选了什么。
 */
export function FontPicker({
  fontKey,
  onFontKey,
}: {
  fontKey: FontKey
  onFontKey: (k: FontKey) => void
}) {
  const [open, setOpen] = useState<Record<FontGroup, boolean>>(() => {
    const selectedGroup = FONT_OPTIONS.find((o) => o.key === fontKey)?.group ?? '中文'
    return {
      中文: selectedGroup === '中文',
      西文: selectedGroup === '西文',
    }
  })

  return (
    <div>
      {FONT_GROUP_ORDER.map((group) => {
        const options = FONT_OPTIONS.filter((o) => o.group === group)
        const selected = options.find((o) => o.key === fontKey)
        const expanded = open[group]
        const Chevron = expanded ? ChevronDown : ChevronRight
        return (
          <div key={group} className="mt-1.5 first:mt-0">
            <button
              onClick={() => setOpen((prev) => ({ ...prev, [group]: !prev[group] }))}
              aria-expanded={expanded}
              className="flex w-full items-center gap-1 rounded px-0.5 py-0.5 text-left transition hover:text-ink-700"
            >
              <Chevron className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <span className="text-[11px] font-medium text-ink-500">{group}</span>
              <span className="truncate text-[11px] text-ink-400">
                {selected ? `· ${selected.label}` : `· ${options.length} 档`}
              </span>
            </button>
            {expanded && (
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                {options.map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => onFontKey(opt.key)}
                    title={opt.hint}
                    style={opt.family ? { fontFamily: opt.family } : undefined}
                    className={`truncate rounded-md border px-1 py-1.5 text-xs transition ${
                      fontKey === opt.key
                        ? 'border-ink-800 bg-ink-800 text-white'
                        : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
        作用范围：<span className="font-medium text-ink-500">正文与标题</span>。作者、署名、
        眉头标签、文件名栏这些装饰文字保持原设计。
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
        {fontHintOf(fontKey)}
        {LATIN_ONLY_KEYS.includes(fontKey) && '。这类字体没有中文字形，正文是中文时看不出变化'}
      </p>
    </div>
  )
}
