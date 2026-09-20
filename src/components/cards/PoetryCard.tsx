import { forwardRef } from 'react'
import { CardFrame, type SizeMode } from '../CardFrame'
import type { PoetryTheme } from '../../themes/poetryThemes'
import type { CardBackground } from '../../../shared/scene'

interface Props {
  text: string
  theme: PoetryTheme
  size: SizeMode
  title?: string
  author?: string
  vertical?: boolean
  compact?: boolean
  /** AI 生成的背景照片；为空时退回主题渐变 + 水墨晕染 */
  background?: CardBackground | null
  /** 正文与标题的自定义字体；undefined 表示沿用设计默认（正文宋体 / 标题楷书） */
  font?: string
  /** 显示右下角印章。默认关 */
  showSeal?: boolean
  /** 显示标点符号。默认关——古典诗词竖排本就不加标点 */
  showPunct?: boolean
  /** 正文与标题的字号倍率，默认 1 */
  fontScale?: number
  /** 正文墨色（hex）。不填 = 跟随主题的 text */
  inkText?: string
  /** 标题与作者墨色（hex）。不填 = 跟随主题的 accent */
  inkAccent?: string
}

/**
 * 卡片上要隐去的标点。
 *
 * 只去掉句读类标点，不动书名号《》与引号——它们在正文里是内容的一部分
 * （比如诗句中点到的篇名），去掉会改变语义。
 */
const PUNCT_RE = /[，。、；：！？,.!?;:…—﹑]/g

export const PoetryCard = forwardRef<HTMLDivElement, Props>(function PoetryCard(
  {
    text,
    theme,
    size,
    title,
    author,
    vertical = true,
    compact,
    background,
    font,
    showSeal = false,
    showPunct = false,
    fontScale = 1,
    inkText,
    inkAccent,
  },
  ref,
) {
  const padOuter = size === 'landscape' ? 100 : 120
  const allLines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  let extractedTitle = ''
  let extractedAuthor = ''
  let bodyLines = allLines
  if (allLines[0]) {
    const m = allLines[0].match(/^《([^》]+)》$/)
    if (m) {
      extractedTitle = m[1]
      bodyLines = allLines.slice(1)
    }
  }
  if (bodyLines.length) {
    const last = bodyLines[bodyLines.length - 1]
    if (/^[—\-]+\s*\S/.test(last) || /^[（(].+[）)]$/.test(last)) {
      extractedAuthor = last.replace(/^[—\-]+\s*/, '')
      bodyLines = bodyLines.slice(0, -1)
    }
  }
  // 标点是在这里、而非编辑区里去掉的：原文必须保持用户敲进去的样子，
  // 否则「显示标点」一勾就找不回来了。
  const rawLines = bodyLines.length ? bodyLines : ['空山新雨后', '天气晚来秋']
  const displayLines = showPunct ? rawLines : rawLines.map((l) => l.replace(PUNCT_RE, ''))
  const t = title || extractedTitle
  const a = author || extractedAuthor
  const isLong = displayLines.join('').length > 60
  // 墨色：默认跟随主题，只有用户显式选过颜色才覆盖。印章不参与——
  // 朱印是版式符号，跟着主题走才不会和正文字色互相打架。
  const textColor = inkText ?? theme.text
  const accentColor = inkAccent ?? theme.accent

  return (
    <CardFrame ref={ref} size={size} background={theme.background} compact={compact && !vertical}>
      {background ? (
        <>
          {/* 照片层：cover 铺满、居中裁切，比例不符时自动裁掉多余部分 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("${background.dataUrl}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          {/* 蒙层：刻意复用主题自己的渐变而不是黑色遮罩——照片退成一层「淡底画」，
              文字颜色照旧由主题的 text 决定，对比度不依赖对图片的明暗分析。
              浓淡由背景图明暗/细节自动给出初值，用户可再调。 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: theme.background,
              opacity: background.scrim,
            }}
          />
        </>
      ) : (
        <InkWash color={theme.wash} />
      )}
      <div className="noise-overlay" style={{ opacity: 0.08 }} />

      <div
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          padding: padOuter,
          display: 'flex',
          flexDirection: 'column',
          color: textColor,
        }}
      >
        {vertical ? (
          <VerticalLayout
            lines={displayLines}
            title={t}
            author={a}
            accent={accentColor}
            isLong={isLong}
            font={font}
            fontScale={fontScale}
          />
        ) : (
          <HorizontalLayout
            lines={displayLines}
            title={t}
            author={a}
            accent={accentColor}
            isLong={isLong}
            font={font}
            fontScale={fontScale}
          />
        )}

        {showSeal && <Seal color={theme.seal} />}
      </div>
    </CardFrame>
  )
})

function VerticalLayout({
  lines,
  title,
  author,
  accent,
  isLong,
  font,
  fontScale = 1,
}: {
  lines: string[]
  title: string
  author?: string
  accent: string
  isLong: boolean
  font?: string
  fontScale?: number
}) {
  const verseSize = Math.round((isLong ? 44 : 56) * fontScale)
  return (
    <div
      style={{
        // basis 用 auto（auto 模式下卡片随内容长高），minHeight: 0 让固定
        // 尺寸下容器能被压回可用高度，竖排文字按真实可用高度换行，
        // 否则按 min-content 撑开、文字越过卡片下边缘（假性溢出提示）
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'row-reverse',
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
        gap: 56,
      }}
    >
      {title && (
        <div
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'upright',
            fontFamily: font ?? '"Ma Shan Zheng", "Noto Serif SC Variable", serif',
            fontSize: Math.round(64 * fontScale),
            letterSpacing: '0.4em',
            color: accent,
            marginTop: 20,
          }}
        >
          {title}
        </div>
      )}

      {lines.map((line, idx) => (
        <div
          key={idx}
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'upright',
            fontFamily: font ?? '"Noto Serif SC Variable", serif',
            fontSize: verseSize,
            letterSpacing: '0.32em',
            lineHeight: 1.2,
            fontWeight: 500,
          }}
        >
          {line}
        </div>
      ))}

      {author && (
        <div
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'upright',
            fontFamily: '"Noto Serif SC Variable", serif',
            fontSize: 22,
            letterSpacing: '0.3em',
            color: accent,
            marginTop: 80,
          }}
        >
          —— {author}
        </div>
      )}
    </div>
  )
}

function HorizontalLayout({
  lines,
  title,
  author,
  accent,
  isLong,
  font,
  fontScale = 1,
}: {
  lines: string[]
  title: string
  author?: string
  accent: string
  isLong: boolean
  font?: string
  fontScale?: number
}) {
  return (
    <div
      style={{
        // 同竖排：固定尺寸下允许收缩，超出时居中对称裁切而不是单边下坠
        flex: '1 1 auto',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {title && (
        <div
          style={{
            fontFamily: font ?? '"Ma Shan Zheng", serif',
            fontSize: Math.round(56 * fontScale),
            color: accent,
            marginBottom: 40,
            letterSpacing: '0.2em',
          }}
        >
          {title}
        </div>
      )}
      {lines.map((line, idx) => (
        <div
          key={idx}
          style={{
            fontFamily: font ?? '"Noto Serif SC Variable", serif',
            fontSize: Math.round((isLong ? 36 : 48) * fontScale),
            letterSpacing: '0.3em',
            lineHeight: 1.8,
          }}
        >
          {line}
        </div>
      ))}
      {author && (
        <div
          style={{
            marginTop: 40,
            fontFamily: '"Noto Serif SC Variable", serif',
            fontSize: 22,
            color: accent,
            letterSpacing: '0.2em',
          }}
        >
          —— {author}
        </div>
      )}
    </div>
  )
}

function InkWash({ color }: { color: string }) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 1080 1440"
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, opacity: 0.9 }}
      aria-hidden
    >
      <defs>
        <radialGradient id="wash1" cx="20%" cy="15%" r="55%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="wash2" cx="85%" cy="92%" r="50%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#wash1)" />
      <rect width="100%" height="100%" fill="url(#wash2)" />
    </svg>
  )
}

/** 右下角那枚方章。默认不显示，由右侧「显示印章」开关控制 */
function Seal({ color }: { color: string }) {
  return (
    <svg
      width="90"
      height="90"
      viewBox="0 0 90 90"
      style={{ position: 'absolute', right: 80, bottom: 80 }}
      aria-hidden
    >
      <rect
        x="3"
        y="3"
        width="84"
        height="84"
        rx="6"
        fill="none"
        stroke={color}
        strokeWidth="3"
      />
      <text
        x="50%"
        y="56%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontFamily='"Ma Shan Zheng", "Noto Serif SC Variable", serif'
        fontSize="52"
        letterSpacing="0"
      >
        閒
      </text>
    </svg>
  )
}
