import { Palette } from 'lucide-react'
import type { Style } from '../lib/classifier'
import type { SceneState } from '../lib/useScene'
import { FONT_SCALE_MAX, FONT_SCALE_MIN, type FontKey } from '../lib/fonts'
import { INK_PRESETS, normalizeInk } from '../lib/ink'
import { FontPicker } from './FontPicker'
import { ScenePanel } from './ScenePanel'
import { SIZE_OPTIONS, type SizeMode } from './CardFrame'
import { codeThemes } from '../themes/codeThemes'
import { quoteThemes } from '../themes/quoteThemes'
import { proseThemes } from '../themes/proseThemes'
import { poetryThemes } from '../themes/poetryThemes'

interface Props {
  className?: string
  style: Style
  size: SizeMode
  onSize: (s: SizeMode) => void
  compact: boolean
  onCompact: (v: boolean) => void
  themeIndex: number
  onThemeIndex: (n: number) => void
  eyebrow: string
  onEyebrow: (s: string) => void
  vertical: boolean
  onVertical: (v: boolean) => void
  /** 诗词卡的 AI 背景状态（五字段 + 生成/拆解动作） */
  scene: SceneState
  fontKey: FontKey
  onFontKey: (k: FontKey) => void
  /** 正文与标题的字号倍率 */
  fontScale: number
  onFontScale: (v: number) => void
  /** 诗词卡：显示印章 / 显示标点符号，都默认关 */
  showSeal: boolean
  onShowSeal: (v: boolean) => void
  showPunct: boolean
  onShowPunct: (v: boolean) => void
  /** 墨色覆盖（hex）。undefined = 跟随主题。只作用于诗词卡的正文与标题作者 */
  inkText?: string
  onInkText: (v: string | undefined) => void
  inkAccent?: string
  onInkAccent: (v: string | undefined) => void
}

export function Controls({
  className = '',
  style,
  size,
  onSize,
  compact,
  onCompact,
  themeIndex,
  onThemeIndex,
  eyebrow,
  onEyebrow,
  vertical,
  onVertical,
  scene,
  fontKey,
  onFontKey,
  fontScale,
  onFontScale,
  showSeal,
  onShowSeal,
  showPunct,
  onShowPunct,
  inkText,
  onInkText,
  inkAccent,
  onInkAccent,
}: Props) {
  const themes = pickThemes(style)
  // 墨色要显示「跟随主题」时那格的实际颜色，所以取当前诗词主题本身
  const poetryTheme = poetryThemes[Math.min(Math.max(themeIndex, 0), poetryThemes.length - 1)] ?? poetryThemes[0]

  return (
    <aside className={`h-full w-full shrink-0 flex-col gap-6 overflow-y-auto border-l border-ink-200/60 bg-white/60 p-5 backdrop-blur md:w-[320px] ${className}`}>
      <Section title="尺寸">
        <div className="flex rounded-md border border-ink-200 p-0.5 text-sm">
          {SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onSize(opt.value)}
              className={`flex-1 rounded px-2 py-1.5 transition ${
                size === opt.value ? 'bg-ink-800 text-white' : 'text-ink-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Section>

      {size === 'auto' && !(style === 'poetry' && vertical) && (
        <Section title="留白">
          <div className="flex rounded-md border border-ink-200 p-0.5 text-sm">
            <button
              onClick={() => onCompact(false)}
              className={`flex-1 rounded px-2 py-1.5 transition ${
                !compact ? 'bg-ink-800 text-white' : 'text-ink-600'
              }`}
            >
              标准
            </button>
            <button
              onClick={() => onCompact(true)}
              className={`flex-1 rounded px-2 py-1.5 transition ${
                compact ? 'bg-ink-800 text-white' : 'text-ink-600'
              }`}
            >
              紧凑
            </button>
          </div>
        </Section>
      )}

      <Section title="主题">
        <div className="grid grid-cols-2 gap-2">
          {themes.map((t, i) => (
            <button
              key={t.name + i}
              onClick={() => onThemeIndex(i)}
              className={`group relative overflow-hidden rounded-lg border text-left transition ${
                i === themeIndex
                  ? 'border-ink-800 shadow-sm'
                  : 'border-ink-200 hover:border-ink-400'
              }`}
            >
              <div className="h-12 w-full" style={{ background: t.background }}>
                {t.code && (
                  // 代码主题：用主题自身颜色画迷你「代码行」，比纯底色更能预判配色
                  <div className="flex h-full flex-col justify-center gap-[3px] px-2.5">
                    <span className="h-[3px] rounded-full" style={{ width: '38%', background: t.code.accent }} />
                    <span className="h-[3px] rounded-full" style={{ width: '72%', background: t.code.text, opacity: 0.85 }} />
                    <span className="h-[3px] rounded-full" style={{ width: '54%', background: t.code.subtle }} />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 text-xs text-ink-700">{t.name}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* 标题 / 作者 / 文件名已经移到左侧编辑栏（紧贴正文，且可从正文解析），
          这里只保留各自风格独有的项 */}
      {style === 'prose' && (
        <Section title="眉头标签">
          <Input value={eyebrow} onChange={onEyebrow} placeholder="NOTES · 2026" />
        </Section>
      )}

      {style === 'poetry' && (
        <>
          <Section title="排版">
            <div className="flex rounded-md border border-ink-200 p-0.5 text-sm">
              <button
                onClick={() => onVertical(true)}
                className={`flex-1 rounded px-2 py-1.5 transition ${
                  vertical ? 'bg-ink-800 text-white' : 'text-ink-600'
                }`}
              >
                竖排
              </button>
              <button
                onClick={() => onVertical(false)}
                className={`flex-1 rounded px-2 py-1.5 transition ${
                  !vertical ? 'bg-ink-800 text-white' : 'text-ink-600'
                }`}
              >
                横排
              </button>
            </div>
          </Section>

          <Section title="显示">
            <div className="flex flex-col gap-1.5">
              <Check
                checked={showSeal}
                onChange={onShowSeal}
                label="显示印章"
                hint="右下角那枚方章"
              />
              <Check
                checked={showPunct}
                onChange={onShowPunct}
                label="显示标点符号"
                hint="关掉即按古典竖排惯例隐去句读；编辑区原文不受影响"
              />
            </div>
          </Section>

          <ScenePanel scene={scene} />
        </>
      )}

      <Section title="字号">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={FONT_SCALE_MIN}
            max={FONT_SCALE_MAX}
            step={0.05}
            value={fontScale}
            onChange={(e) => onFontScale(Number(e.target.value))}
            className="min-w-0 flex-1 accent-ink-800"
            aria-label="正文字号倍率"
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink-600">
            {Math.round(fontScale * 100)}%
          </span>
        </div>
        <div className="mt-1 flex items-start justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-ink-400">
            正文与标题的字号倍率。固定尺寸下放太大会被裁，预览顶部会提示。
          </p>
          {fontScale !== 1 && (
            <button
              onClick={() => onFontScale(1)}
              className="shrink-0 rounded border border-ink-200 bg-white px-1.5 py-0.5 text-[11px] text-ink-600 transition hover:border-ink-300 hover:text-ink-800"
            >
              复位
            </button>
          )}
        </div>
      </Section>

      {/*
        墨色插在「字号」和「字体」之间——三者都是文字外观，放一起才找得到。
        这里插入只会把「字体」往下推，而字体本来就是最后一项，评论区那条
        「新块往末尾追加」的约束（别把 AI 背景挤出首屏）在这里不受影响。
      */}
      {style === 'poetry' && (
        <Section title="墨色">
          <div className="flex flex-col gap-2.5">
            <InkRow
              label="正文"
              value={inkText}
              themeColor={poetryTheme.text}
              onChange={onInkText}
            />
            <InkRow
              label="标题·作者"
              value={inkAccent}
              themeColor={poetryTheme.accent}
              onChange={onInkAccent}
            />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
            默认跟随主题墨色，改了就以你的选择为准。AI 背景偏暗时选「月白」或「鎏金」这类浅色更清楚；
            印章颜色固定跟随主题。
          </p>
        </Section>
      )}

      {/*
        字体放在最末，是刻意的：右栏是 overflow-y-auto 的窄栏，任何插在中间的新区块
        都会把它下面所有内容往下推。这个区块一度放在「主题」后面，直接把「AI 背景」
        挤出首屏，看起来就像功能消失了。新增区块请往末尾追加。
      */}
      <Section title="字体">
        <FontPicker fontKey={fontKey} onFontKey={onFontKey} />
      </Section>
    </aside>
  )
}

/**
 * 一行墨色选择器：主题 / 预设色块 / 自定义取色器。
 *
 * 「主题」不是某个具体颜色，而是「把覆盖清掉」——它显示的是当前主题的
 * text 或 accent，点了就回到 undefined。用一个文字按钮而不是色块来画它，
 * 是为了和右边的预设色块区分开：它们点下去的行为不一样。
 */
function InkRow({
  label,
  value,
  themeColor,
  onChange,
}: {
  label: string
  value?: string
  themeColor: string
  onChange: (v: string | undefined) => void
}) {
  const isPreset = INK_PRESETS.some((p) => p.value === value)
  return (
    <div className="flex items-start gap-2">
      <span className="w-[4.5rem] shrink-0 pt-0.5 text-xs text-ink-700">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <button
          onClick={() => onChange(undefined)}
          title={`跟随主题墨色（${themeColor}）`}
          aria-pressed={!value}
          className={`rounded border px-1.5 py-0.5 text-[11px] transition ${
            !value
              ? 'border-ink-800 bg-ink-800 text-white'
              : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400'
          }`}
        >
          主题
        </button>

        {INK_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            title={`${p.name}（${p.value}）`}
            aria-label={p.name}
            aria-pressed={value === p.value}
            style={{ background: p.value }}
            className={`h-5 w-5 rounded-full border border-ink-300 transition ${
              value === p.value ? 'ring-2 ring-ink-800 ring-offset-1' : 'hover:scale-110'
            }`}
          />
        ))}

        {/* 原生取色器：覆盖在调色板图标上，点哪都能唤起 */}
        <label
          title="自定义颜色"
          className={`relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border bg-white transition ${
            value && !isPreset ? 'border-ink-800 ring-2 ring-ink-800 ring-offset-1' : 'border-ink-300 hover:border-ink-500'
          }`}
        >
          <Palette className="pointer-events-none h-3 w-3 text-ink-500" />
          <input
            type="color"
            value={value ?? themeColor}
            onChange={(e) => onChange(normalizeInk(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-400">
        {title}
      </div>
      {children}
    </section>
  )
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink-800"
      />
      <span className="min-w-0">
        <span className="text-xs text-ink-700">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-400">{hint}</span>}
      </span>
    </label>
  )
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
    />
  )
}

interface ThemeSwatch {
  name: string
  background: string
  code?: { text: string; subtle: string; accent: string }
}

function pickThemes(style: Style): ThemeSwatch[] {
  switch (style) {
    case 'code':
      return codeThemes.map((t) => ({
        name: t.name,
        background: t.background,
        code: { text: t.textColor, subtle: t.subtleColor, accent: t.accent },
      }))
    case 'quote':
      return quoteThemes.map((t) => ({ name: t.name, background: t.background }))
    case 'prose':
      return proseThemes.map((t) => ({ name: t.name, background: t.background }))
    case 'poetry':
      return poetryThemes.map((t) => ({ name: t.name, background: t.background }))
  }
}
