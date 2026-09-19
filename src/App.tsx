import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Eye,
  Github,
  History,
  Pencil,
  Save,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { Controls } from './components/Controls'
import { RecentPanel } from './components/RecentPanel'
import { CodeCard } from './components/cards/CodeCard'
import { QuoteCard } from './components/cards/QuoteCard'
import { ProseCard } from './components/cards/ProseCard'
import { PoetryCard } from './components/cards/PoetryCard'
import { classify, type Style } from './lib/classifier'
import { canCopyImage, copyPng, exportPng } from './lib/exporter'
import { useScene } from './lib/useScene'
import { useSnapshots } from './lib/useSnapshots'
import type { Snapshot, SnapshotState } from './lib/snapshots'
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  fontFamilyOf,
  ensureFontLoaded,
  isFontKey,
  type FontKey,
} from './lib/fonts'
import { normalizeScene, type Aspect, type CardBackground, type SceneFields } from '../shared/scene'
import { SIZE_OPTIONS, type SizeMode } from './components/CardFrame'
import { codeThemes } from './themes/codeThemes'
import { quoteThemes } from './themes/quoteThemes'
import { proseThemes } from './themes/proseThemes'
import { poetryThemes } from './themes/poetryThemes'

const DEFAULT_TEXT = '愿你慢慢长大，愿你有好运气，如果没有，愿你在不幸中学会慈悲。'

// 自动保存：编辑状态持久化到 localStorage，刷新/标签页被浏览器回收后不丢内容
const STORAGE_KEY = 'text2card.state.v1'

interface PersistedState {
  text: string
  styleChoice: Style | 'auto'
  size: SizeMode
  themeIndex: number
  title: string
  author: string
  eyebrow: string
  vertical: boolean
  compact: boolean
  fontKey: FontKey
  /** 正文与标题的字号倍率，1 = 标准 */
  fontScale: number
  /** 诗词卡的显示开关，默认关 */
  showSeal: boolean
  showPunct: boolean
  /** 诗词卡拆解出的五个画面字段（只有文本，体积小，适合进 localStorage） */
  scene?: SceneFields
}

// 首屏尺寸：已有持久化值则用它；否则手机默认 3:4 竖图（更适合竖屏分享），
// 桌面默认自适应。卡片渲染与设备无关，仅是默认值差异，不影响导出一致性。
function getInitialSize(persisted: Partial<PersistedState>): SizeMode {
  if (SIZE_OPTIONS.some((o) => o.value === persisted.size)) return persisted.size!
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 'portrait' : 'auto'
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const data = JSON.parse(raw) as Partial<PersistedState>
    return typeof data === 'object' && data !== null ? data : {}
  } catch {
    return {}
  }
}

const STYLE_OPTIONS: { value: Style | 'auto'; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'code', label: '代码' },
  { value: 'quote', label: '金句' },
  { value: 'prose', label: '长文' },
  { value: 'poetry', label: '诗词' },
]

export default function App() {
  const [persisted] = useState(loadPersisted)
  const [text, setText] = useState(persisted.text ?? DEFAULT_TEXT)
  const [styleChoice, setStyleChoice] = useState<Style | 'auto'>(
    STYLE_OPTIONS.some((o) => o.value === persisted.styleChoice) ? persisted.styleChoice! : 'auto',
  )
  const [size, setSize] = useState<SizeMode>(() => getInitialSize(persisted))
  const [themeIndex, setThemeIndex] = useState(
    typeof persisted.themeIndex === 'number' && persisted.themeIndex >= 0 ? persisted.themeIndex : 0,
  )
  const [title, setTitle] = useState(persisted.title ?? '')
  const [author, setAuthor] = useState(persisted.author ?? '')
  const [eyebrow, setEyebrow] = useState(persisted.eyebrow ?? '')
  const [vertical, setVertical] = useState(persisted.vertical ?? true)
  const [compact, setCompact] = useState(persisted.compact ?? false)
  const [fontKey, setFontKey] = useState<FontKey>(() =>
    isFontKey(persisted.fontKey) ? persisted.fontKey : 'default',
  )
  // 两个显示开关都默认关：老的持久化数据里没有这两个字段，?? false 正好兼容
  const [showSeal, setShowSeal] = useState(persisted.showSeal ?? false)
  const [showPunct, setShowPunct] = useState(persisted.showPunct ?? false)
  // 字号倍率。老数据没有这个字段 → 回落到 1；同时防止手工改坏成 NaN/越界
  const [fontScale, setFontScale] = useState(() => {
    const v = persisted.fontScale
    return typeof v === 'number' && Number.isFinite(v) && v >= FONT_SCALE_MIN && v <= FONT_SCALE_MAX
      ? v
      : 1
  })
  const [recentOpen, setRecentOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview' | 'style'>('edit')
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  function showToast(kind: 'ok' | 'err', msg: string) {
    clearTimeout(toastTimer.current)
    setToast({ kind, msg })
    toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 4000 : 2200)
  }

  const detected = useMemo(() => classify(text), [text])
  const effective: Style = styleChoice === 'auto' ? detected : styleChoice

  // 画幅只用于拼提示词里的画幅描述与留白要求；auto 是 1080 宽、高度自适应，
  // 更接近竖图，所以归到 portrait。
  const aspect: Aspect = size === 'landscape' ? 'landscape' : 'portrait'
  const [initialScene] = useState(() => normalizeScene(persisted.scene))
  const scene = useScene({
    text,
    title,
    author,
    aspect,
    initial: initialScene,
    onNotify: showToast,
  })
  const sceneFields = scene.fields

  const snapshots = useSnapshots({ onNotify: showToast })
  const font = fontFamilyOf(fontKey)

  // 可选字体的 CSS 按需加载。持久化恢复、载入快照、手动切换都会走到这里，
  // 所以只依赖 fontKey 就够。加载完成前文字先用回退字体渲染（font-display: swap）。
  useEffect(() => {
    void ensureFontLoaded(fontKey)
  }, [fontKey])

  const cardRef = useRef<HTMLDivElement>(null)

  // 生效风格变化（含 auto 检测切换）时重置主题索引，避免停留在上个风格的主题位。
  // 用前值比较而不是「跳过首次」：StrictMode 下挂载效果会执行两次，
  // 布尔守卫第二次就会误触发，把刚从 localStorage 恢复的主题索引清零。
  const prevEffective = useRef(effective)
  useEffect(() => {
    if (prevEffective.current !== effective) {
      prevEffective.current = effective
      setThemeIndex(0)
    }
  }, [effective])

  // 编辑状态自动保存（轻微防抖，避免每个按键都写 localStorage）。
  // 注意：生成的背景图（data URL，动辄数 MB）刻意不落盘——localStorage 配额只有
  // 5MB 左右，写进去会直接撑爆整个自动保存。字段文本才是需要留住的部分。
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const state: PersistedState = {
          text,
          styleChoice,
          size,
          themeIndex,
          title,
          author,
          eyebrow,
          vertical,
          compact,
          fontKey,
          fontScale,
          showSeal,
          showPunct,
          scene: sceneFields,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      } catch {
        // localStorage 不可用（隐私模式/配额满）时静默放弃自动保存
      }
    }, 300)
    return () => clearTimeout(id)
  }, [
    text,
    styleChoice,
    size,
    themeIndex,
    title,
    author,
    eyebrow,
    vertical,
    compact,
    fontKey,
    fontScale,
    showSeal,
    showPunct,
    sceneFields,
  ])

  /** 把当前全部界面状态（含 AI 背景图）存成一条快照 */
  async function handleSave() {
    const state: SnapshotState = {
      text,
      styleChoice,
      size,
      themeIndex,
      title,
      author,
      eyebrow,
      vertical,
      compact,
      fontKey,
      fontScale,
      showSeal,
      showPunct,
      scene: sceneFields,
      background: scene.background,
    }
    await snapshots.save(state, effective)
  }

  /**
   * 载入一条快照。
   *
   * 关键点：必须提前把 prevEffective 对齐到「恢复后的生效风格」。否则下面
   * setStyleChoice 引起 effective 变化，那个「风格变了就重置主题索引」的
   * useEffect 会在本次渲染后触发，把刚恢复的 themeIndex 清成 0——
   * 表现就是「载入后主题总是回到第一个」。
   */
  function handleRestore(snapshot: Snapshot) {
    const s = snapshot.state
    const nextEffective: Style = s.styleChoice === 'auto' ? classify(s.text) : s.styleChoice
    prevEffective.current = nextEffective

    setText(s.text)
    setStyleChoice(s.styleChoice)
    setSize(s.size)
    setThemeIndex(s.themeIndex)
    setTitle(s.title)
    setAuthor(s.author)
    setEyebrow(s.eyebrow)
    setVertical(s.vertical)
    setCompact(s.compact)
    setFontKey(isFontKey(s.fontKey) ? s.fontKey : 'default')
    setFontScale(
      typeof s.fontScale === 'number' && Number.isFinite(s.fontScale) && s.fontScale >= FONT_SCALE_MIN && s.fontScale <= FONT_SCALE_MAX
        ? s.fontScale
        : 1,
    )
    setShowSeal(s.showSeal ?? false)
    setShowPunct(s.showPunct ?? false)
    scene.applyFields(s.scene)
    scene.setBackground(s.background ?? null)
    showToast('ok', `已载入「${snapshot.label}」`)
  }

  function handleStyleChange(next: Style | 'auto') {
    setStyleChoice(next)
  }

  async function handleExport() {
    if (!cardRef.current || exporting) return
    try {
      setExporting(true)
      const name = `text2card-${effective}-${Date.now()}.png`
      await exportPng(cardRef.current, name)
      showToast('ok', '已导出 PNG')
    } catch (err) {
      console.error('export failed:', err)
      showToast('err', `导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  async function handleCopy() {
    if (!cardRef.current || copying) return
    try {
      setCopying(true)
      await copyPng(cardRef.current)
      showToast('ok', '已复制到剪贴板，可直接粘贴')
    } catch (err) {
      console.error('copy failed:', err)
      showToast('err', `复制失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCopying(false)
    }
  }

  // ⌘/Ctrl+S 导出。用 ref 持有最新 handler，监听只绑一次。
  // 不抢占 ⌘/Ctrl+C（会破坏正常的「复制选中文字」），故不设复制快捷键。
  const exportRef = useRef(handleExport)
  exportRef.current = handleExport
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        exportRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const card = renderCard({
    style: effective,
    text,
    themeIndex,
    size,
    title,
    author,
    eyebrow,
    vertical,
    compact,
    cardRef,
    background: scene.background,
    font,
    fontScale,
    showSeal,
    showPunct,
  })

  const stylePill = (
    <div className="flex items-center gap-1 rounded-full border border-ink-200 bg-white p-1 text-sm">
      {STYLE_OPTIONS.map((opt) => {
        const isActive = styleChoice === opt.value
        const isAutoSuggesting = opt.value === 'auto' && styleChoice === 'auto'
        return (
          <button
            key={opt.value}
            onClick={() => handleStyleChange(opt.value)}
            className={`relative whitespace-nowrap rounded-full px-3 py-1.5 transition ${
              isActive ? 'bg-ink-800 text-white' : 'text-ink-600 hover:text-ink-800'
            }`}
          >
            {opt.label}
            {isAutoSuggesting && (
              <span className="ml-1 text-xs opacity-75">· {labelOf(detected)}</span>
            )}
          </button>
        )
      })}
    </div>
  )

  const MOBILE_TABS = [
    { value: 'edit', label: '编辑', icon: Pencil },
    { value: 'preview', label: '预览', icon: Eye },
    { value: 'style', label: '调整', icon: SlidersHorizontal },
  ] as const

  const copySupported = canCopyImage()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const exportHint = isMac ? '⌘S' : 'Ctrl+S'

  return (
    <div className="app-shell flex flex-col bg-[var(--canvas-bg)]">
      <header className="flex items-center justify-between gap-3 border-b border-ink-200/60 bg-white/70 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-ink-700" />
          <span className="font-serif text-xl font-semibold text-ink-800">text2card</span>
          <span className="hidden text-xs text-ink-400 md:inline">文案卡片美化</span>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <div className="hidden items-center gap-3 md:flex">{stylePill}</div>

          <button
            onClick={() => void handleSave()}
            disabled={snapshots.saving}
            title="把当前诗词、背景、AI 背景图和预览设置存进「最近」"
            className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-2.5 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50 md:px-3"
          >
            <Save className="h-4 w-4" />
            <span className="hidden whitespace-nowrap md:inline">{snapshots.saving ? '保存中…' : '保存'}</span>
          </button>

          <button
            onClick={() => setRecentOpen(true)}
            title={`最近保存（${snapshots.items.length}/20）`}
            className="relative flex items-center gap-2 rounded-full border border-ink-200 bg-white px-2.5 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900 md:px-3"
          >
            <History className="h-4 w-4" />
            <span className="hidden whitespace-nowrap md:inline">最近</span>
            {snapshots.items.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ink-800 px-1 text-[10px] font-semibold leading-none text-white">
                {snapshots.items.length}
              </span>
            )}
          </button>

          {copySupported && (
            <button
              onClick={handleCopy}
              disabled={copying}
              title="复制图片到剪贴板"
              className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition hover:border-ink-300 hover:text-ink-900 disabled:opacity-50"
            >
              <Copy className="h-4 w-4" />
              <span className="hidden whitespace-nowrap md:inline">{copying ? '复制中…' : '复制图片'}</span>
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={exporting}
            title={`导出 PNG (${exportHint})`}
            className="flex items-center gap-2 rounded-full bg-ink-800 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-ink-900 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span className="whitespace-nowrap">{exporting ? '导出中…' : '导出 PNG'}</span>
          </button>

          <a
            href="https://github.com/zxw1992/text2card"
            target="_blank"
            rel="noreferrer"
            title="在 GitHub 上查看源码"
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-200 text-ink-500 transition hover:border-ink-300 hover:text-ink-800 sm:flex"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* 移动端：风格切换条（横向可滚动）；桌面端风格在 header 内，此条隐藏 */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-ink-200/60 bg-white/50 px-4 py-2 md:hidden">
        {stylePill}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Editor
          value={text}
          onChange={setText}
          style={effective}
          title={title}
          onTitle={setTitle}
          author={author}
          onAuthor={setAuthor}
          className={`${mobileTab === 'edit' ? 'flex' : 'hidden'} md:flex`}
        />
        <Preview
          size={size}
          onFitContent={() => setSize('auto')}
          className={`${mobileTab === 'preview' ? 'flex' : 'hidden'} md:flex`}
        >
          {card}
        </Preview>
        <Controls
          className={`${mobileTab === 'style' ? 'flex' : 'hidden'} md:flex`}
          style={effective}
          size={size}
          onSize={setSize}
          compact={compact}
          onCompact={setCompact}
          themeIndex={themeIndex}
          onThemeIndex={setThemeIndex}
          eyebrow={eyebrow}
          onEyebrow={setEyebrow}
          vertical={vertical}
          onVertical={setVertical}
          scene={scene}
          fontKey={fontKey}
          onFontKey={setFontKey}
          fontScale={fontScale}
          onFontScale={setFontScale}
          showSeal={showSeal}
          onShowSeal={setShowSeal}
          showPunct={showPunct}
          onShowPunct={setShowPunct}
        />
      </div>

      {/* 移动端底部 Tab：编辑 / 预览 / 调整 */}
      <nav className="flex border-t border-ink-200/60 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {MOBILE_TABS.map((t) => {
          const Icon = t.icon
          const active = mobileTab === t.value
          return (
            <button
              key={t.value}
              onClick={() => setMobileTab(t.value)}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition ${
                active ? 'text-ink-900' : 'text-ink-400'
              }`}
            >
              <Icon className="h-5 w-5" />
              {t.label}
            </button>
          )
        })}
      </nav>

      <RecentPanel
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        snapshots={snapshots}
        onRestore={handleRestore}
      />

      {toast && (
        <div
          className={`pointer-events-none fixed left-1/2 top-20 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${
            toast.kind === 'ok' ? 'bg-ink-800' : 'bg-red-600'
          }`}
          role="status"
        >
          {toast.kind === 'ok' ? <Check className="h-4 w-4" /> : null}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function labelOf(s: Style): string {
  return { code: '代码', quote: '金句', prose: '长文', poetry: '诗词' }[s]
}

function renderCard({
  style,
  text,
  themeIndex,
  size,
  title,
  author,
  eyebrow,
  vertical,
  compact,
  cardRef,
  background,
  font,
  fontScale,
  showSeal,
  showPunct,
}: {
  style: Style
  text: string
  themeIndex: number
  size: SizeMode
  title: string
  author: string
  eyebrow: string
  vertical: boolean
  compact: boolean
  cardRef: React.RefObject<HTMLDivElement>
  background: CardBackground | null
  font?: string
  fontScale: number
  showSeal: boolean
  showPunct: boolean
}) {
  const safeIdx = (arr: any[]) => arr[Math.min(themeIndex, arr.length - 1)]
  switch (style) {
    case 'code':
      return (
        <CodeCard
          ref={cardRef}
          text={text}
          theme={safeIdx(codeThemes)}
          size={size}
          compact={compact}
          filename={title || undefined}
          font={font}
          fontScale={fontScale}
        />
      )
    case 'quote':
      return (
        <QuoteCard
          ref={cardRef}
          text={text}
          theme={safeIdx(quoteThemes)}
          size={size}
          compact={compact}
          author={author || undefined}
          font={font}
          fontScale={fontScale}
        />
      )
    case 'prose':
      return (
        <ProseCard
          ref={cardRef}
          text={text}
          theme={safeIdx(proseThemes)}
          size={size}
          compact={compact}
          title={title || undefined}
          eyebrow={eyebrow || undefined}
          signature={author || undefined}
          font={font}
          fontScale={fontScale}
        />
      )
    case 'poetry':
      return (
        <PoetryCard
          ref={cardRef}
          text={text}
          theme={safeIdx(poetryThemes)}
          size={size}
          compact={compact}
          title={title || undefined}
          author={author || undefined}
          vertical={vertical}
          background={background}
          font={font}
          fontScale={fontScale}
          showSeal={showSeal}
          showPunct={showPunct}
        />
      )
  }
}
