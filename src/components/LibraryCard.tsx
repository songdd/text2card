import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FolderInput, Music, Plus, Trash2 } from 'lucide-react'
import { ScaledCard } from './ScaledCard'
import { PlayerButton } from './PlayerButton'
import { CardTagPopover, TagChip } from './TagPicker'
import { normalizeTags } from '../lib/tags'
import { isPlayingId, useAudioPlayer } from '../lib/audioPlayer'
import { AUDIO_STATE_BORDER, AUDIO_STATE_BUTTON, AUDIO_STATE_DOT, AUDIO_STATE_LABEL, audioStateOf } from '../lib/audioState'
import type { Snapshot, SnapshotState } from '../lib/snapshots'

/**
 * 网格 / 列表里的一张卡片。
 *
 * **缩略图 = 真实卡片的等比缩小版**（用同一份 `SnapshotCard`），不是"背景图回声"。
 * 早先的版本直接把背景图当缩略图，结果是：存过 AI 配图的卡片是一张照片、
 * 没配图的是一块纯色渐变，两者观感天差地别，看起来像"第一张和其余不一样"。
 * 换成迷你卡片之后，每张都忠实显示"自己的诗词 + 自己的底色"。
 *
 * 背景仍用保存时生成的 **240px 缩略图**，而不是原图：原图一张 1–5MB，
 * 几十张同时挂进 DOM 会吃光内存。
 *
 * 卡片下方刻意只有「诗名 + 作者」两行——尺寸、主题、字体、时间、是否有 AI 背景
 * 都不在这里展示，它们是选卡时的干扰。完整元信息在点开的详情里。
 */
export function LibraryCard({
  snapshot,
  selected,
  onOpen,
  onLoad,
  onExport,
  onDelete,
  onAssociate,
  onToggleSelect,
  selectMode,
  onNotify,
  tagOpen,
  tagBusy,
  tagSuggestions,
  onQuickTag,
  onCloseTag,
  onAddTags,
  onRemoveTag,
  onPlay,
}: {
  snapshot: Snapshot
  selected: boolean
  onOpen: () => void
  onLoad: () => void
  onExport: () => void
  onDelete: () => void
  /** 打开「关联音频」对话框 */
  onAssociate: () => void
  onToggleSelect: () => void
  selectMode: boolean
  onNotify: (kind: 'ok' | 'err', message: string) => void
  /** 快速加标签弹层是否打开（同时只允许开一个，状态在管理页） */
  tagOpen: boolean
  tagBusy?: boolean
  tagSuggestions: { tag: string; count: number }[]
  onQuickTag: () => void
  onCloseTag: () => void
  onAddTags: (tags: string[]) => void
  onRemoveTag: (tag: string) => void
  /** 点播放键：管理页会**以这张卡为起点**重建播放队列，这样 ⏭ 才有下一首 */
  onPlay: () => void
}) {
  const s = snapshot.state
  const tags = normalizeTags(s.tags)
  const audioState = audioStateOf(snapshot.audio)
  // 播放状态：正在播的那张套一圈流光，暂停但仍装载的那张套一圈不动的暖光
  const player = useAudioPlayer()
  const playing = isPlayingId(player, snapshot.id)
  const loaded = !playing && player.currentId === snapshot.id
  const boxRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // 网格列宽随视口变化，量出来再渲染缩略卡片
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /**
   * 缩略图状态：背景换成 240px 小图。
   * 老记录（在这个功能之前保存的）没有 thumb 但有原图——这里刻意**不**回落到原图，
   * 否则列表又会挂上几 MB 的图；宁可显示主题渐变，也不让网格变卡。
   */
  const thumbState: SnapshotState = useMemo(() => {
    if (!snapshot.thumb) return { ...s, background: null }
    return {
      ...s,
      background: { dataUrl: snapshot.thumb, scrim: s.background?.scrim ?? 0.5 },
    }
  }, [s, snapshot.thumb])

  return (
    <div
      /**
       * 光圈包在卡片外面（2px 的 padding 里填渐变）：正在播时是流动的彩色光，
       * 暂停但还装载着这张时是不动的暖光。padding 常驻，所以播放开始/结束**不会
       * 让卡片挪位置**（那会像页面在抖）。
       */
      className={`relative rounded-[10px] p-[2px] ${
        playing ? 'playing-frame' : loaded ? 'playing-frame-idle' : ''
      }`}
    >
    <div
      /**
       * 注意这里**没有** `overflow-hidden`：快速加标签的弹层要能溢出到卡片外面，
       * 否则会被裁掉。裁剪职责下移给了缩略图那一层（它本来就有 overflow-hidden），
       * 圆角也跟着下移（rounded-t-lg），视觉不变。
       */
      className={`group relative flex flex-col rounded-lg border bg-white transition ${
        selected
          ? 'border-ink-800 shadow-sm'
          : AUDIO_STATE_BORDER[audioState]
      }`}
    >
      <button onClick={onOpen} title="查看大图" className="relative block w-full text-left">
        <div ref={boxRef} className="relative w-full overflow-hidden rounded-t-lg">
          {width > 0 && <ScaledCard state={thumbState} width={width} />}
        </div>
      </button>

      {/* 勾选框：多选模式下常驻，否则悬停出现 */}
      <button
        onClick={onToggleSelect}
        aria-label={selected ? '取消选择' : '选择'}
        className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border transition ${
          selected
            ? 'border-ink-800 bg-ink-800 text-white'
            : selectMode
              ? 'border-white/80 bg-black/25 text-transparent'
              : 'border-white/80 bg-black/25 text-transparent opacity-0 group-hover:opacity-100'
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8.5l3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* 悬停操作：默认不占视觉 */}
      <div className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
        <IconAction title="载入到编辑页" onClick={onLoad}>
          <FolderInput className="h-3.5 w-3.5" />
        </IconAction>
        <IconAction title="导出 PNG" onClick={onExport}>
          <Download className="h-3.5 w-3.5" />
        </IconAction>
        <IconAction
          title={snapshot.audio ? '更换关联音频' : '关联音频'}
          label="关联音频"
          onClick={onAssociate}
          colorClass={AUDIO_STATE_BUTTON[audioState]}
        >
          <Music className="h-3.5 w-3.5" />
        </IconAction>
        <IconAction title="删除" danger onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconAction>
      </div>

      {/*
        卡片下方：诗名 + 作者两行（尺寸/主题/字体/时间仍然不展示），
        标签按你的要求展示在这里，最多 3 个、多的收成「+N」——
        标签一多卡片高度就会被撑乱，网格会变得参差不齐。
      */}
      <div className="flex items-center gap-2 px-2.5 pt-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5" title={AUDIO_STATE_LABEL[audioState]}>
            {/* 状态圆点：绿=音频+时间轴齐全，黄=还差时间轴，无=尚未关联 */}
            {audioState !== 'none' && (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${AUDIO_STATE_DOT[audioState]}`}
                aria-hidden
              />
            )}
            <span className="truncate text-sm font-medium text-ink-800">{snapshot.label}</span>
          </span>
          <span className="truncate text-[11px] text-ink-500">{s.author || '未填作者'}</span>
        </div>
        {snapshot.audio && (
          <PlayerButton
            id={snapshot.id}
            onError={(m) => onNotify('err', m)}
            onToggle={onPlay}
          />
        )}
      </div>

      {/*
        标签行：最多展示 3 个、多的收成「+N」（标签一多卡片高度会被撑乱，
        网格会变得参差不齐），末尾永远留一个「+」入口——
        **不做成只有悬停才出现**：悬停才出现的入口等于没有入口。
      */}
      <div className="flex flex-wrap items-center gap-1 px-2.5 pb-2 pt-1.5">
        {tags.slice(0, 3).map((t) => (
          <TagChip key={t} tag={t} onRemove={onRemoveTag} />
        ))}
        {tags.length > 3 && (
          <span className="text-[10px] text-ink-400" title={tags.join('、')}>
            +{tags.length - 3}
          </span>
        )}
        <button
          onClick={onQuickTag}
          title={tags.length ? '快速加标签' : '加标签'}
          aria-label="快速加标签"
          aria-expanded={tagOpen}
          className={`flex items-center gap-0.5 rounded-full border border-dashed px-1.5 py-0.5 text-[10px] transition ${
            tagOpen
              ? 'border-ink-800 bg-ink-800 text-white'
              : 'border-ink-200 text-ink-400 hover:border-ink-400 hover:text-ink-800'
          }`}
        >
          <Plus className="h-2.5 w-2.5" />
          {tags.length === 0 && '标签'}
        </button>
      </div>

      {/* 快速加标签：贴卡片的小弹层，点外面/Esc 关闭，方便连着打下一张 */}
      {tagOpen && (
        <CardTagPopover
          current={tags}
          suggestions={tagSuggestions}
          busy={tagBusy}
          onAdd={(add) => onAddTags(add)}
          onRemove={(tag) => onRemoveTag(tag)}
          onClose={onCloseTag}
        />
      )}
    </div>
    </div>
  )
}

function IconAction({
  title,
  label,
  onClick,
  children,
  danger,
  colorClass,
}: {
  title: string
  /** 固定不变的 aria-label。title 会随状态变（「关联音频」/「更换关联音频」），
      探针和读屏需要一个稳定的名字，所以两者分开 */
  label?: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  /** 覆盖默认配色（关联音频按钮按音频状态变绿/变黄） */
  colorClass?: string
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      aria-label={label ?? title}
      className={`flex h-6 w-6 items-center justify-center rounded border backdrop-blur-sm transition ${
        colorClass ??
        `border-white/40 bg-black/40 text-white hover:bg-black/60 ${
          danger ? 'hover:border-red-300 hover:text-red-200' : ''
        }`
      }`}
    >
      {children}
    </button>
  )
}
