import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Download,
  Eye,
  FolderOpen,
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
import { PlayerBar } from './components/PlayerBar'
import { LyricsView } from './components/LyricsView'
import { QueuePanel } from './components/QueuePanel'
import { BootScreen, ServerDownScreen, useLibraryServer } from './components/ServerGate'
import { MigrateDialog } from './components/MigrateDialog'
import { migrationDone, peekLegacyData, serverCardCount, type LegacyPreview } from './lib/migrate'
import { resumeLastSession, setQueue, startPlayback, useAudioPlayer } from './lib/audioPlayer'
import { requestPersist } from './lib/storage'
import { usePlaylists } from './lib/usePlaylists'
import type { Playlist } from './lib/snapshots'
import { LibraryPage } from './components/LibraryPage'
import { SnapshotCard } from './components/SnapshotCard'
import { type Style } from './lib/classifier'
import { canCopyImage, copyPng, exportPng } from './lib/exporter'
import { useScene } from './lib/useScene'
import { useSnapshots } from './lib/useSnapshots'
import { useHashRoute } from './lib/useHashRoute'
import type { Snapshot, SnapshotState } from './lib/snapshots'
import { loadCardBackground, snapshotKeyOf } from './lib/snapshots'
import {
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  fontFamilyOf,
  ensureFontLoaded,
  isFontKey,
  type FontKey,
} from './lib/fonts'
import { normalizeScene, type Aspect, type CardBackground, type SceneFields } from '../shared/scene'
import { normalizeInk } from './lib/ink'
import { collectTags, normalizeTags } from './lib/tags'
import { SIZE_OPTIONS, type SizeMode } from './components/CardFrame'

// 首页默认内容：既然这个项目是诗词专用的，默认就给一首诗，而不是现代短句
const DEFAULT_TEXT = '空山新雨后，天气晚来秋。\n明月松间照，清泉石上流。'
const DEFAULT_TITLE = '山居秋暝'
const DEFAULT_AUTHOR = '王维'

// 自动保存：编辑状态持久化到 localStorage，刷新/标签页被浏览器回收后不丢内容
const STORAGE_KEY = 'text2card.state.v1'

interface PersistedState {
  text: string
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
  /** 墨色覆盖（hex）。缺省 = 跟随主题，老数据读出来就是 undefined */
  inkText?: string
  inkAccent?: string
  /** 标签（1年级 / 人教 / 唐诗…） */
  tags?: string[]
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

/**
 * 项目已收敛为**诗词专用**，所以生效风格是一个常量而不是可切换的状态。
 *
 * 顶栏那排「自动 / 代码 / 金句 / 长文 / 诗词」chips 因此被移除。
 * 多风格的机制（renderCard 的 switch、各卡片组件、主题表、classifier）都还在，
 * 只是不再有入口——以后想恢复，把这里改回 state 并加回 chips 即可。
 */
const FIXED_STYLE: Style = 'poetry'

export default function App() {
  /**
   * 本地数据库服务是**唯一数据源**，所以先探一次：没起来就挡在门口，
   * 而不是让下面那些数据 hook 挂在半路、界面显示成一个空库。
   * 这也是把它拆成 门 + Workspace 两层的原因——hook 只在服务可用时才挂载。
   */
  const server = useLibraryServer()

  if (server.phase === 'checking') {
    return (
      <div className="app-shell flex flex-col bg-[var(--canvas-bg)]">
        <BootScreen />
      </div>
    )
  }
  if (server.phase === 'down') {
    return (
      <div className="app-shell flex flex-col bg-[var(--canvas-bg)]">
        <ServerDownScreen error={server.error} onRetry={server.retry} />
      </div>
    )
  }
  return <Workspace />
}

function Workspace() {
  const [persisted] = useState(loadPersisted)
  const [text, setText] = useState(persisted.text ?? DEFAULT_TEXT)
  const [size, setSize] = useState<SizeMode>(() => getInitialSize(persisted))
  const [themeIndex, setThemeIndex] = useState(
    typeof persisted.themeIndex === 'number' && persisted.themeIndex >= 0 ? persisted.themeIndex : 0,
  )
  const [title, setTitle] = useState(persisted.title ?? DEFAULT_TITLE)
  const [author, setAuthor] = useState(persisted.author ?? DEFAULT_AUTHOR)
  const [eyebrow, setEyebrow] = useState(persisted.eyebrow ?? '')
  const [vertical, setVertical] = useState(persisted.vertical ?? true)
  const [compact, setCompact] = useState(persisted.compact ?? false)
  const [fontKey, setFontKey] = useState<FontKey>(() =>
    isFontKey(persisted.fontKey) ? persisted.fontKey : 'default',
  )
  // 两个显示开关都默认关：老的持久化数据里没有这两个字段，?? false 正好兼容
  const [showSeal, setShowSeal] = useState(persisted.showSeal ?? false)
  const [showPunct, setShowPunct] = useState(persisted.showPunct ?? false)
  // 墨色覆盖，undefined = 跟随主题。过一遍 normalizeInk：持久化数据可能被改坏，
  // 而这两个值会直接进 style.color。
  const [inkText, setInkText] = useState<string | undefined>(() => normalizeInk(persisted.inkText))
  const [inkAccent, setInkAccent] = useState<string | undefined>(() => normalizeInk(persisted.inkAccent))
  // 标签：归一化（去重、去空白、全角折半角），防止手工改坏的数据进列表
  const [tags, setTags] = useState<string[]>(() => normalizeTags(persisted.tags))
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
  /** 页面级路由：编辑（新增/更新）/ 管理（查看/删除/导出） */
  const [page, go] = useHashRoute()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  function showToast(kind: 'ok' | 'err', msg: string) {
    clearTimeout(toastTimer.current)
    setToast({ kind, msg })
    toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 4000 : 2200)
  }

  const effective: Style = FIXED_STYLE

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
  const playlists = usePlaylists({ onNotify: showToast })
  const font = fontFamilyOf(fontKey)

  /**
   * 浏览器里还有旧数据时提示一次搬家。
   * 库里已经有卡片（或已经搬过）就不再打扰；「稍后」也只是本次会话不再弹，
   * 之后还能从「备份」对话框里导入。
   */
  const [legacy, setLegacy] = useState<LegacyPreview | null>(null)
  const [migrateOpen, setMigrateOpen] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const peek = await peekLegacyData()
        // 不管结果如何都记下来：备份对话框里会显示检测结果，
        // 这样"为什么没弹搬家提示"永远有据可查，不会又变成一次盲猜
        setLegacy(peek)
        if (!peek.available || peek.cards === 0) return
        const existing = await serverCardCount().catch(() => 0)
        if (existing === 0 && !migrationDone()) setMigrateOpen(true)
      } catch (err) {
        setLegacy({ available: false, cards: 0, audio: 0, images: 0, lyrics: 0, playlists: 0, presets: 0, note: String(err) })
      }
    })()
  }, [])

  /**
   * 静默申请一次持久化存储。
   *
   * 界面上那条"未持久化"的提示已经去掉了（用户明确不要），但**能力不能跟着一起丢**：
   * IndexedDB 默认是 best-effort，磁盘紧张时浏览器可以不经询问直接清掉本站数据，
   * 而这里存的是用户的诗词卡片、音频、字幕时间轴。所以改成启动时悄悄申请一次，
   * 结果不展示、不打扰——拿到更好，拿不到也和以前一样。
   */
  useEffect(() => {
    void requestPersist()
  }, [])

  /**
   * 刷新后接着播。
   *
   * 页面一刷新，`<audio>` 和内存态全没了——不接回来的话，正在听的音乐会静悄悄地断掉，
   * 连播放条都消失（用户只会觉得"刷新了一下就不播了"）。播放器里存了一条续播书签
   * （哪一首 + 第几秒 + 当时是否在播），这里在界面挂载后接上。
   *
   * 两种情况会只摆回播放条、不自动响：本来处于暂停状态，或离开超过两小时——
   * 隔夜回来突然出声是会被吓到的。浏览器拦自动播放时也会给一句提示。
   */
  useEffect(() => {
    void resumeLastSession((msg) => showToast('err', msg))
  }, [])
  // 已用过的标签（含使用次数），喂给编辑页做输入建议与一键添加
  const tagSuggestions = useMemo(() => collectTags(snapshots.items), [snapshots.items])

  /** 正在播放/暂停的那张卡片：播放条与歌词页都靠它。可能在管理页、也可能在编辑页 */
  const player = useAudioPlayer()
  const playingSnapshot = useMemo(
    () => (player.currentId ? (snapshots.items.find((s) => s.id === player.currentId) ?? null) : null),
    [player.currentId, snapshots.items],
  )
  const [lyricsOpen, setLyricsOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  /** 管理页报上来的"当前可播清单"，队列面板用它做「按当前筛选重建」 */
  const [queueSource, setQueueSource] = useState<string[]>([])
  const handleQueueSource = useCallback((ids: string[]) => {
    // 比较内容而不是引用：否则每次筛选渲染都会 setState，白白多一轮渲染
    setQueueSource((prev) => (prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids))
  }, [])

  // 停止播放（播放条被关掉）时把歌词页一起收掉，别留一个空壳浮在上面
  useEffect(() => {
    if (!player.currentId) {
      setLyricsOpen(false)
      setQueueOpen(false)
    }
  }, [player.currentId])

  /** 播放队列面板：重建队列（true = 同时从头播） */
  function rebuildQueue(play: boolean) {
    const ids = queueSource.length ? queueSource : snapshots.items.filter((s) => s.audio).map((s) => s.id)
    if (play && ids.length) {
      // 「从头播放」= 明确要求回到第一首的开头（队列由 startPlayback 一并写入）
      // 名字用「当前筛选」：这个按钮的字面意思就是"按当前筛选重建"
      void startPlayback(ids, ids[0], (m) => showToast('err', m), { restart: true, name: '当前筛选' })
      setQueueOpen(false)
    } else {
      setQueue(ids, false, '当前筛选')
    }
    // 「按当前筛选重建」**不关面板**：用户重建后通常想继续看这份新队列
  }

  /**
   * 按歌单播放：只取仍然存在且**还有音频**的卡片，顺序沿用歌单自己的顺序
   * （不是管理页的排序）——歌单的意义就在于顺序是你定的。
   *
   * `custom: true`：这份队列是用户明确点出来的，别被"当前筛选"悄悄替换掉。
   * `name`：队列跟着歌单的名字，播放条上悬浮就能看到现在放的是哪一份。
   */
  function playPlaylist(playlist: Playlist) {
    const byId = new Map(snapshots.items.map((s) => [s.id, s]))
    const alive = playlist.cardIds.map((id) => byId.get(id)).filter((s): s is Snapshot => Boolean(s?.audio))
    const dead = playlist.cardIds.length - alive.length
    if (!alive.length) {
      showToast('err', `「${playlist.name}」里的卡片都已删除或没有音频`)
      return
    }
    const ids = alive.map((s) => s.id)
    void startPlayback(ids, ids[0], (m) => showToast('err', m), { custom: true, name: playlist.name })
    showToast('ok', dead ? `播放「${playlist.name}」，已跳过 ${dead} 首失效卡片` : `播放「${playlist.name}」`)
  }

  /** 歌词页里微调时间轴偏移（落库，立刻生效） */
  async function handleLyricOffset(id: string, delta: number) {
    const current = snapshots.items.find((s) => s.id === id)
    const next = Math.round(((current?.audio?.offset ?? 0) + delta) * 10) / 10
    await snapshots.setAudioMeta(id, { offset: next })
  }

  // 可选字体的 CSS 按需加载。持久化恢复、载入快照、手动切换都会走到这里，
  // 所以只依赖 fontKey 就够。加载完成前文字先用回退字体渲染（font-display: swap）。
  useEffect(() => {
    void ensureFontLoaded(fontKey)
  }, [fontKey])

  const cardRef = useRef<HTMLDivElement>(null)

  // 编辑状态自动保存（轻微防抖，避免每个按键都写 localStorage）。
  // 注意：生成的背景图（data URL，动辄数 MB）不走这里——localStorage 配额只有
  // 5MB 左右，写进去会直接撑爆整个自动保存。背景图单独存 IndexedDB（见 useScene）。
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const state: PersistedState = {
          text,
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
          inkText,
          inkAccent,
          tags,
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
    inkText,
    inkAccent,
    tags,
    sceneFields,
  ])

  /** 把当前全部界面状态（含 AI 背景图）存成一条快照 */
  async function handleSave() {
    const state: SnapshotState = {
      text,
      styleChoice: FIXED_STYLE,
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
      inkText,
      inkAccent,
      tags,
      scene: sceneFields,
      background: scene.background,
    }
    await snapshots.save(state, effective)
  }

  /**
   * 载入一条快照。
   *
   * 这里不再需要处理「风格变化 → 主题索引被重置」的竞态：风格已固定为诗词，
   * 不会因载入而变化，所以 themeIndex 恢复多少就是多少。
   *
   * 配图是**异步补上**的：列表接口不下发配图（一张 1–3MB），载入瞬间先把文字、
   * 排版、主题全部落位，图取回来再补一层。这样点「载入」是零等待，
   * 也不会出现"编辑页里配图不见了"的错觉；服务端写入时同样不会用空图覆盖已有配图。
   */
  function handleRestore(snapshot: Snapshot) {
    const s = snapshot.state

    setText(s.text)
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
    setInkText(normalizeInk(s.inkText))
    setInkAccent(normalizeInk(s.inkAccent))
    setTags(normalizeTags(s.tags))
    scene.applyFields(s.scene)
    scene.setBackground(s.background ?? null)
    showToast('ok', `已载入「${snapshot.label}」`)

    // 配图后到：取回来再补上，取不到就保持主题底（不打断已经载入好的内容）
    if (s.background && !s.background.dataUrl && s.background.bytes) {
      void loadCardBackground(snapshot)
        .then((bg) => {
          if (bg) scene.setBackground(bg)
        })
        .catch(() => {
          showToast('err', '配图读取失败，先按主题底显示；重新载入一次可再试')
        })
    }
  }

  async function handleExport() {
    if (!cardRef.current || exporting) return
    try {
      setExporting(true)
      const name = `奕霖古诗词-${Date.now()}.png`
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

  /**
   * 当前编辑状态的快照形态。
   * 编辑页、管理页详情、批量导出全都经由 `<SnapshotCard>` 渲染同一份结构，
   * 卡片长相不可能出现分叉。
   */
  const liveState: SnapshotState = useMemo(
    () => ({
      text,
      styleChoice: FIXED_STYLE,
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
      inkText,
      inkAccent,
      tags,
      scene: sceneFields,
      background: scene.background,
    }),
    [
      text,
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
      inkText,
      inkAccent,
      tags,
      sceneFields,
      scene.background,
    ],
  )

  const card = <SnapshotCard ref={cardRef} state={liveState} />

  const MOBILE_TABS = [
    { value: 'edit', label: '编辑', icon: Pencil },
    { value: 'preview', label: '预览', icon: Eye },
    { value: 'style', label: '调整', icon: SlidersHorizontal },
  ] as const

  const copySupported = canCopyImage()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const exportHint = isMac ? '⌘S' : 'Ctrl+S'

  /** 从管理页载入一条：套用状态并切回编辑页 */
  function loadFromLibrary(snapshot: Snapshot) {
    handleRestore(snapshot)
    go('edit')
  }

  /**
   * 管理页就地改过标签后同步回编辑页。
   *
   * 场景：载入「江雪」到编辑页 → 在管理页给「江雪」补了「唐诗」→ 回编辑页点保存。
   * 标签存在 state.tags 里、随保存整体写回，若不同步，编辑器里的旧值会把刚打的
   * 标签**覆盖掉**（而且没有任何提示）。所以这里按「标题 + 作者」这个保存键判断
   * 被改的是不是编辑页当前这张卡，是就同步过来。
   */
  function handleLibraryTagsEdited(records: Snapshot[]) {
    const liveKey = snapshotKeyOf({ title, author, text })
    const hit = records.find((r) => snapshotKeyOf(r.state) === liveKey)
    if (hit) setTags(normalizeTags(hit.state.tags))
  }

  return (
    <div className="app-shell flex flex-col bg-[var(--canvas-bg)]">
      <header className="flex items-center justify-between gap-3 border-b border-ink-200/60 bg-white/70 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-3">
          <Sparkles className="h-5 w-5 text-ink-700" />
          <span className="font-serif text-xl font-semibold text-ink-800">奕霖古诗词</span>
          <span className="hidden text-xs text-ink-400 md:inline">诗词卡片</span>

          {/* 两个平级页面：编辑（新增/更新）/ 管理（查看/删除/导出） */}
          <nav className="ml-1 flex items-center gap-0.5 rounded-full border border-ink-200 bg-white p-0.5 text-sm">
            <PageTab active={page === 'edit'} onClick={() => go('edit')} icon={Pencil}>
              编辑
            </PageTab>
            <PageTab active={page === 'library'} onClick={() => go('library')} icon={FolderOpen}>
              管理
            </PageTab>
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {page === 'edit' && (
            <>
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
                title="最近保存的若干条（完整列表在「管理」页）"
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
            </>
          )}
        </div>
      </header>

      {page === 'library' ? (
        <LibraryPage
          snapshots={snapshots}
          onLoadIntoEditor={loadFromLibrary}
          onNotify={showToast}
          onTagsEdited={handleLibraryTagsEdited}
          onQueueSource={handleQueueSource}
          playlists={playlists.items}
          onPlayPlaylist={playPlaylist}
          onDeletePlaylist={(id) => void playlists.remove(id)}
          legacy={legacy}
          onImportLegacy={() => setMigrateOpen(true)}
        />
      ) : (
        <>
          <div className="flex flex-1 overflow-hidden">
        <Editor
          value={text}
          onChange={setText}
          style={effective}
          title={title}
          onTitle={setTitle}
          author={author}
          onAuthor={setAuthor}
          tags={tags}
          onTags={setTags}
          tagSuggestions={tagSuggestions}
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
          inkText={inkText}
          onInkText={setInkText}
          inkAccent={inkAccent}
          onInkAccent={setInkAccent}
        />
      </div>

      {/* 移动端底部 Tab：编辑 / 预览 / 调整。
          `order-last` 让播放条排在它上面（播放条是壳层的直接子节点，
          而 Tab 栏在页面内容里；靠 order 才能把两者顺序理顺）。 */}
      <nav className="order-last flex border-t border-ink-200/60 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
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
        </>
      )}

      <RecentPanel
        open={recentOpen}
        onClose={() => setRecentOpen(false)}
        snapshots={snapshots}
        onRestore={handleRestore}
        onOpenLibrary={() => go('library')}
      />

      {/* 浏览器旧数据搬家（只在检测到旧数据、且库里还没有卡片时自动弹出） */}
      {migrateOpen && legacy && (
        <MigrateDialog
          preview={legacy}
          onClose={() => setMigrateOpen(false)}
          onDone={() => {
            void snapshots.refresh()
            setLegacy(null)
          }}
          onNotify={showToast}
        />
      )}

      {/*
        全局播放条：只要有一张卡在播就常驻（暂停也保留），
        否则关掉歌词页/滚动到别处后就没有任何暂停入口了。
      */}      <PlayerBar
        snapshot={playingSnapshot}
        onOpenLyrics={() => setLyricsOpen(true)}
        onOpenQueue={() => setQueueOpen(true)}
        lyricsOpen={lyricsOpen}
        onError={(m) => showToast('err', m)}
      />

      {queueOpen && (
        <QueuePanel
          snapshots={snapshots.items}
          filteredCount={queueSource.length}
          playlists={playlists.items}
          onSavePlaylist={(name, cardIds) => {
            // 同名即覆盖：让「存为歌单」变成可反复更新的动作，而不是攒一堆重名
            const same = playlists.items.find((p) => p.name === name)
            return playlists.save({ id: same?.id, name, cardIds })
          }}
          onRebuild={rebuildQueue}
          onError={(m) => showToast('err', m)}
          onClose={() => setQueueOpen(false)}
        />
      )}

      {lyricsOpen && playingSnapshot && (
        <LyricsView
          snapshot={playingSnapshot}
          onClose={() => setLyricsOpen(false)}
          onOffset={(delta) => void handleLyricOffset(playingSnapshot.id, delta)}
        />
      )}

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

function PageTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof Pencil
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 transition ${
        active ? 'bg-ink-800 text-white' : 'text-ink-600 hover:text-ink-900'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  )
}