import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  CheckSquare,
  Download,
  FileArchive,
  Grid2x2,
  List,
  Loader2,
  Music,
  Play,
  Search,
  Square,
  Tags,
  Trash2,
  X,
} from 'lucide-react'
import { BackupDialog } from './BackupDialog'
import { LibraryCard } from './LibraryCard'
import { SnapshotDetail } from './SnapshotDetail'
import { AudioDialog } from './AudioDialog'
import { PlayerButton } from './PlayerButton'
import { BatchTagDialog, TagChip } from './TagPicker'
import { SearchHelp } from './SearchHelp'
import { TagPresetDialog } from './TagPresetDialog'
import { SIZE_OPTIONS } from './CardFrame'
import { poetryThemes } from '../themes/poetryThemes'
import { fontLabelOf, isFontKey } from '../lib/fonts'
import { fieldsOf, matchesTerms, parseQuery, termHits } from '../lib/search'
import { matchesCombos, collectTags, normalizeTags, tagKey } from '../lib/tags'
import {
  AUDIO_STATE_BORDER,
  AUDIO_STATE_DOT,
  AUDIO_STATE_LABEL,
  AUDIO_STATE_TEXT,
  audioStateOf,
} from '../lib/audioState'
import { listTagPresets, type Playlist, type TagPreset } from '../lib/snapshots'
import type { LegacyPreview } from '../lib/migrate'
import { timeAgo } from '../lib/format'
import { stopAll, stopIfPlaying, isPlayingId, setQueue, startPlayback, togglePlay, useAudioPlayer } from '../lib/audioPlayer'
import {
  downloadBlob,
  estimateBatch,
  exportSnapshotBackground,
  exportSnapshotPng,
  exportSnapshotsZip,
  type BatchProgress,
} from '../lib/exportSnapshot'
import { formatBytes } from '../lib/format'
import type { Snapshot } from '../lib/snapshots'
import type { SnapshotsState } from '../lib/useSnapshots'

type SortKey = 'updated' | 'created' | 'title'

const SORT_LABEL: Record<SortKey, string> = {
  updated: '最近更新',
  created: '创建时间',
  title: '标题',
}

/**
 * 管理页：查看 / 删除 / 导出已保存的诗词卡片。
 *
 * 与编辑页的职责边界：这里**不就地改内容**——改内容回编辑页（避免两处编辑
 * 逻辑分叉）；「载入到编辑」是两页之间唯一的正向通道，配合「标题+作者」相同的
 * upsert 规则，正好形成「选一条 → 改 → 存回来更新同一条」的闭环。
 */
export function LibraryPage({
  snapshots,
  onLoadIntoEditor,
  onNotify,
  onTagsEdited,
  onQueueSource,
  playlists = [],
  onPlayPlaylist,
  onDeletePlaylist,
  legacy,
  onImportLegacy,
}: {
  snapshots: SnapshotsState
  onLoadIntoEditor: (snapshot: Snapshot) => void
  onNotify: (kind: 'ok' | 'err', message: string) => void
  /**
   * 就地改过标签后通知上层。
   * 用途：如果被改的这张正好是编辑页当前那张卡，编辑页的标签状态要跟着更新，
   * 否则回编辑页一保存就把刚打的标签覆盖回去了。
   */
  onTagsEdited?: (records: Snapshot[]) => void
  /** 把"当前可播清单"报给上层，供播放队列面板使用 */
  onQueueSource?: (ids: string[]) => void
  /** 命名歌单 */
  playlists?: Playlist[]
  onPlayPlaylist?: (playlist: Playlist) => void
  onDeletePlaylist?: (id: string) => void
  /** 浏览器里还留着的旧数据（传给备份对话框做导入入口） */
  legacy?: LegacyPreview | null
  onImportLegacy?: () => void
}) {
  const { items, loading, remove, removeMany, clear, refresh, setTags, addTagsToMany } = snapshots
  const player = useAudioPlayer()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  /** 正在「关联音频」的卡片 id（存 id 而不是快照对象：刷新后拿到的一定是最新那条） */
  const [audioId, setAudioId] = useState<string | null>(null)
  /** 关键词匹配方式：任一（默认，批量核对用）/ 全部（筛标签用） */
  const [matchAll, setMatchAll] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  /** 搜索框容器，帮助面板据此定位（面板 portal 到 body，需要外部坐标） */
  const searchBoxRef = useRef<HTMLDivElement>(null)
  const [presetDialog, setPresetDialog] = useState(false)
  /** 当前打开「快速加标签」弹层的卡片 id（同时只开一个） */
  const [tagCardId, setTagCardId] = useState<string | null>(null)
  const [tagBusy, setTagBusy] = useState(false)
  const [batchTagOpen, setBatchTagOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [presets, setPresets] = useState<TagPreset[]>([])
  /** 当前生效的预设 id（一次一个，预设之间是互斥的筛选口径） */
  const [activePresetId, setActivePresetId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<BatchProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const parsed = useMemo(() => parseQuery(query), [query])
  const keywords = parsed.terms

  /** 每张卡片各字段的文本，算一次给所有条件复用 */
  const fieldTexts = useMemo(() => new Map(items.map((s) => [s.id, fieldsOf(s)])), [items])

  /** 每张卡片的标签集合（预设筛选用） */
  const tagsOf = useMemo(
    () => new Map(items.map((s) => [s.id, normalizeTags(s.state.tags)])),
    [items],
  )

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId],
  )

  const filtered = useMemo(() => {
    const filtering = keywords.length > 0 || Boolean(activePreset)
    const hit = filtering
      ? items.filter((s) => {
          // 关键词与预设是两个独立的筛选口径，同时生效时取交集
          const fields = fieldTexts.get(s.id)
          if (keywords.length && !(fields && matchesTerms(fields, keywords, matchAll ? 'all' : 'any'))) {
            return false
          }
          if (activePreset && !matchesCombos(tagsOf.get(s.id) ?? [], activePreset.combos)) return false
          return true
        })
      : items.slice()
    hit.sort((a, b) => {
      if (sort === 'title') return a.label.localeCompare(b.label, 'zh-Hans-CN')
      const ka = (sort === 'updated' ? a.updatedAt ?? a.createdAt : a.createdAt) ?? 0
      const kb = (sort === 'updated' ? b.updatedAt ?? b.createdAt : b.createdAt) ?? 0
      return kb - ka
    })
    return hit
  }, [items, keywords, matchAll, fieldTexts, tagsOf, activePreset, sort])

  /**
   * 批量搜索的反馈：哪些条件在库里**一个都没找到**。
   * 「哪些没找到」才是批量搜索真正想知道的答案（比如核对缺了哪几首），
   * 所以这里把它明确列出来，而不是只给一个总数。
   * 注意判断的是**单个条件**在库里有没有命中，与"任一/全部"口径无关。
   */
  const missedKeywords = useMemo(() => {
    if (!keywords.length) return []
    const all = [...fieldTexts.values()]
    return keywords.filter((term) => !all.some((f) => termHits(f, term))).map((term) => term.raw)
  }, [keywords, fieldTexts])

  // 预设列表：进页面读一次，弹窗里改完回调刷新
  const reloadPresets = useCallback(async () => {
    try {
      setPresets(await listTagPresets())
    } catch (err) {
      onNotify('err', `读取预设失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [onNotify])

  useEffect(() => {
    void reloadPresets()
  }, [reloadPresets])

  // 预设被删掉后，正在生效的那个要清掉，否则会一直筛着"一个不存在的口径"
  useEffect(() => {
    if (activePresetId && !presets.some((p) => p.id === activePresetId)) setActivePresetId(null)
  }, [presets, activePresetId])

  /** 全部卡片的标签集合，给预设弹窗算命中数 */
  const allTagsOfCards = useMemo(() => [...tagsOf.values()], [tagsOf])

  /**
   * 一键回到「显示全部」。
   *
   * 预设和搜索是两个独立的口径，回退时一起清掉——用户点「全部」的意思是
   * 「我要看全部卡片」，而不是「只取消预设、搜索还留着」。
   */
  const clearFilters = useCallback(() => {
    setQuery('')
    setActivePresetId(null)
    setMatchAll(false)
  }, [])

  /** 全库标签统计（按使用次数排序）——快速加标签的"常用"就靠它，也是防写法分裂的第一道闸 */
  const tagSuggestionList = useMemo(
    () => collectTags(items),
    [items],
  )

  /** 单卡：就地改标签并同步给编辑页（若正是当前那张） */
  const handleCardTags = useCallback(
    async (snapshotId: string, next: string[]) => {
      setTagBusy(true)
      try {
        const updated = await setTags(snapshotId, next)
        if (updated) {
          onTagsEdited?.([updated])
          const added = next.filter((t) => !normalizeTags(items.find((s) => s.id === snapshotId)?.state.tags).some((x) => tagKey(x) === tagKey(t)))
          if (added.length) onNotify('ok', `已添加「${added.join('、')}」`)
        }
      } finally {
        setTagBusy(false)
      }
    },
    [setTags, onTagsEdited, onNotify, items],
  )

  /** 批量：只追加，不清原有标签 */
  const handleBatchTags = useCallback(
    async (add: string[]) => {
      if (!selected.size || !add.length) return
      setTagBusy(true)
      try {
        const changed = await addTagsToMany([...selected], add)
        onTagsEdited?.(changed)
        setBatchTagOpen(false)
        onNotify(
          changed.length ? 'ok' : 'err',
          changed.length
            ? `已给 ${changed.length} 张加上「${add.join('、')}」`
            : '选中的卡片都已经有这些标签了',
        )
      } finally {
        setTagBusy(false)
      }
    },
    [selected, addTagsToMany, onTagsEdited, onNotify],
  )

  const detail = useMemo(() => items.find((s) => s.id === detailId) ?? null, [items, detailId])
  const audioTarget = useMemo(() => items.find((s) => s.id === audioId) ?? null, [items, audioId])

  // ------------------------------------------------------- 播放队列
  /** 能进队列的只有"关联了音频"的卡片——否则会跳到一首没声音的"歌"上 */
  const playable = useMemo(() => filtered.filter((s) => Boolean(s.audio)), [filtered])
  const playableCount = playable.length
  const selectedPlayable = useMemo(
    () => filtered.filter((s) => selected.has(s.id) && Boolean(s.audio)),
    [filtered, selected],
  )

  /**
   * 建立并播放队列。三级来源：勾选的 > 当前筛选里有音频的 > 全部有音频的。
   * 没音频的勾选项会被跳过，并如实告诉用户跳过了几首。
   */
  const buildQueue = useCallback(
    (play: boolean) => {
      const source = selectedPlayable.length
        ? selectedPlayable
        : playable.length
          ? playable
          : items.filter((s) => Boolean(s.audio))
      if (!source.length) {
        onNotify('err', '没有已关联音频的卡片')
        return []
      }
      const skipped = selected.size - selectedPlayable.length
      const ids = source.map((s) => s.id)
      setQueue(ids, false)
      if (skipped > 0) onNotify('ok', `已跳过 ${skipped} 首未关联音频的卡片`)
      if (play) void startPlayback(ids, ids[0], (m) => onNotify('err', m))
      return ids
    },
    [selectedPlayable, playable, items, selected.size, onNotify],
  )

  const handlePlayQueue = useCallback(() => {
    buildQueue(true)
  }, [buildQueue])

  /**
   * 卡片上的 ▶：**以它为起点重建同一个队列**（"后面那些接着放"）。
   * 但如果点的正是当前正在播的那张，那它就是暂停/继续，不能重建队列。
   */
  const handleCardPlay = useCallback(
    (cardId: string) => {
      if (isPlayingId(player, cardId)) {
        void togglePlay(cardId, (m) => onNotify('err', m))
        return
      }
      const source = selectedPlayable.length
        ? selectedPlayable
        : playable.length
          ? playable
          : items.filter((s) => Boolean(s.audio))
      const ids = source.map((s) => s.id)
      void startPlayback(ids, cardId, (m) => onNotify('err', m))
    },
    [player, selectedPlayable, playable, items, onNotify],
  )

  /** 把"当前可播清单"报给上层：播放队列面板要用它做「按当前筛选重建」 */
  const queueSourceIds = useMemo(
    () =>
      (selectedPlayable.length ? selectedPlayable : playable.length ? playable : items.filter((s) => Boolean(s.audio))).map(
        (s) => s.id,
      ),
    [selectedPlayable, playable, items],
  )
  useEffect(() => {
    onQueueSource?.(queueSourceIds)
  }, [onQueueSource, queueSourceIds])

  // 列表变化后清掉已经不存在的选中项（比如刚被删掉）
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev
      const alive = new Set(items.map((s) => s.id))
      const next = new Set([...prev].filter((id) => alive.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allSelected = filtered.length > 0 && filtered.every((s) => selected.has(s.id))
  const selectedSnapshots = useMemo(
    () => items.filter((s) => selected.has(s.id)),
    [items, selected],
  )

  async function handleExportPng(snapshot: Snapshot) {
    setBusy(`png:${snapshot.id}`)
    try {
      await exportSnapshotPng(snapshot)
      onNotify('ok', `已导出「${snapshot.label}」`)
    } catch (err) {
      onNotify('err', `导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleExportBackground(snapshot: Snapshot) {
    setBusy(`bg:${snapshot.id}`)
    try {
      await exportSnapshotBackground(snapshot)
      onNotify('ok', '已导出背景图')
    } catch (err) {
      onNotify('err', `导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(null)
    }
  }

  async function handleExportZip() {
    if (!selectedSnapshots.length) return
    // 实测一张 PNG 约 10MB、耗时约 2 秒，批量前先把规模讲清楚再动手
    const est = estimateBatch(selectedSnapshots.length)
    if (
      selectedSnapshots.length >= 8 &&
      !window.confirm(
        `导出 ${selectedSnapshots.length} 张：预计约 ${formatBytes(est.bytes)}，` +
          `耗时约 ${Math.ceil(est.seconds / 10) * 10} 秒。继续？`,
      )
    ) {
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ done: 0, total: selectedSnapshots.length, current: '', bytes: 0 })
    try {
      const blob = await exportSnapshotsZip(selectedSnapshots, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      const stamp = new Date().toISOString().slice(0, 10)
      downloadBlob(blob, `奕霖古诗词-${stamp}.zip`)
      onNotify('ok', `已导出 ${selectedSnapshots.length} 张为 ZIP`)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') onNotify('ok', '已取消导出')
      else onNotify('err', `批量导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  async function handleDelete(snapshot: Snapshot) {
    if (!window.confirm(`删除「${snapshot.label}」？该操作不可撤销。`)) return
    // 删掉正在播放的那张就停掉，别放一个已经不存在的东西
    stopIfPlaying(snapshot.id)
    await remove(snapshot.id)
    if (detailId === snapshot.id) setDetailId(null)
  }

  async function handleDeleteSelected() {
    if (!selected.size) return
    if (!window.confirm(`删除选中的 ${selected.size} 张卡片？该操作不可撤销。`)) return
    for (const id of selected) stopIfPlaying(id)
    await removeMany([...selected])
    setSelected(new Set())
  }

  async function handleClearAll() {
    if (!items.length) return
    if (!window.confirm(`清空全部 ${items.length} 张卡片？该操作不可撤销。`)) return
    stopAll()
    await clear()
    setSelected(new Set())
    setDetailId(null)
    setAudioId(null)
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 工具条 */}
        <div className="flex flex-col gap-3 border-b border-ink-200/60 bg-white/70 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            {/* 相对定位只是为了让「?」按钮挨着搜索框；面板本身走 portal 挂到 body，
                因为它必须逃离工具条的层叠上下文（backdrop-blur 会造成） */}
            <div ref={searchBoxRef} className="relative flex min-w-[12rem] flex-1 items-center gap-1.5">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                /**
                 * 换行必须自己接住。
                 *
                 * 单行 `<input>` 的值清洗规则是**直接删掉 CR/LF**，不是换成空格——
                 * 于是粘贴一列题目（鹿柴⏎静夜思）会粘成「鹿柴静夜思」一个词，搜不到
                 * 任何东西，而用户完全看不出哪里错了。批量搜索的主要用法就是粘一列，
                 * 所以这里把换行统一换成空格（换行本来就是合法分隔符）。
                 */
                onPaste={(e) => {
                  const raw = e.clipboardData?.getData('text/plain')
                  if (!raw || !/[\r\n]/.test(raw)) return
                  e.preventDefault()
                  const el = e.currentTarget
                  const inserted = raw.replace(/[\r\n]+/g, ' ')
                  const start = el.selectionStart ?? el.value.length
                  const end = el.selectionEnd ?? start
                  setQuery(el.value.slice(0, start) + inserted + el.value.slice(end))
                  requestAnimationFrame(() =>
                    el.setSelectionRange(start + inserted.length, start + inserted.length),
                  )
                }}
                placeholder="搜标题/作者/正文/标签，可多词；精确搜索：作者：李白"
                title={
                  '多个关键词用空格或逗号分隔（默认「任一」命中）。\n' +
                  '精确搜索：字段 + 冒号 + 值，例如「作者：李白」「标签：1年级」「标题：静夜思」。\n' +
                  '可用字段：标题 / 题目 / 诗名、作者 / 诗人 / 署名、正文 / 内容 / 全文、标签。\n' +
                  '多个精确条件配合「全部」即同时满足，例如「作者：李白 标签：1年级」。'
                }
                className="min-w-0 flex-1 bg-transparent text-sm text-ink-800 outline-none placeholder:text-ink-300"
              />
              {query && (
                <button onClick={() => setQuery('')} aria-label="清空搜索" className="shrink-0 text-ink-400 hover:text-ink-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>

              {/* 搜索用法：问号放在 label 外面（button 套在 label 里会被当成标签控件处理） */}
              <button
                onClick={() => setHelpOpen((v) => !v)}
                aria-label="搜索用法"
                aria-expanded={helpOpen}
                title="搜索用法与示例"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition ${
                  helpOpen
                    ? 'border-ink-800 bg-ink-800 text-white'
                    : 'border-ink-200 bg-white text-ink-500 hover:border-ink-400 hover:text-ink-800'
                }`}
              >
                ?
              </button>

              {helpOpen && (
                <SearchHelp
                  anchorRef={searchBoxRef}
                  onPick={setQuery}
                  onClose={() => setHelpOpen(false)}
                />
              )}
            </div>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 outline-none"
              aria-label="排序方式"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>

            <div className="flex rounded-full border border-ink-200 bg-white p-0.5">
              <button
                onClick={() => setView('grid')}
                aria-label="网格视图"
                className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                  view === 'grid' ? 'bg-ink-800 text-white' : 'text-ink-500'
                }`}
              >
                <Grid2x2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setView('list')}
                aria-label="列表视图"
                className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
                  view === 'list' ? 'bg-ink-800 text-white' : 'text-ink-500'
                }`}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/*
            这一行**不能整行藏起来**：清空数据后（或者换了台电脑、刚清过浏览器数据）
            恰恰是最需要「备份 → 从备份恢复」的时候。之前把「备份」按钮放在
            `items.length > 0` 里面，结果库一空按钮就没了——自己把自己锁在门外。
            所以只有"跟已选/已有数据有关"的按钮才受条件控制，刷新与备份常驻。
          */}
          <div className="flex flex-wrap items-center gap-2">
            {items.length > 0 && (
              <>
                <button
                  onClick={() =>
                    allSelected
                      ? setSelected(new Set())
                      : setSelected(new Set(filtered.map((s) => s.id)))
                  }
                  className="flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-ink-300 hover:text-ink-800"
                >
                  {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  {allSelected ? '取消全选' : '全选'}
                </button>

                {/*
                  全局播放键：常驻在「全选」右边（不是选中后才冒出来），位置稳定才被发现。
                  队列来源三级：勾选的 > 当前筛选里有音频的 > 全部有音频的。
                */}
                <button
                  onClick={() => void handlePlayQueue()}
                  disabled={playableCount === 0}
                  title={
                    playableCount === 0
                      ? '没有已关联音频的卡片'
                      : `播放队列：${selectedPlayable.length ? `勾选的 ${selectedPlayable.length} 首` : `当前筛选的 ${playableCount} 首`}`
                  }
                  className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-ink-900 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {selectedPlayable.length ? `播放选中的 ${selectedPlayable.length} 首` : `播放全部 ${playableCount} 首`}
              </button>

              {selected.size > 0 && (
                <>
                  <span className="text-xs text-ink-500">已选 {selected.size} 项</span>
                  <button
                    onClick={() => void handleExportZip()}
                    disabled={progress !== null}
                    className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-ink-900 disabled:opacity-40"
                  >
                    <FileArchive className="h-3.5 w-3.5" />
                    导出 ZIP
                  </button>
                  <button
                    onClick={() => void handleDeleteSelected()}
                    className="flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-red-300 hover:text-red-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                  {/* 批量打标签：给"一年级 30 首"打标签，一张张点太累 */}
                  <button
                    onClick={() => setBatchTagOpen(true)}
                    className="flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-ink-400 hover:text-ink-900"
                  >
                    <Tags className="h-3.5 w-3.5" />
                    加标签
                  </button>
                </>
              )}
            </>
            )}

            <button
              onClick={() => void refresh()}
              className="ml-auto rounded-md px-2 py-1.5 text-xs text-ink-400 transition hover:text-ink-700"
            >
              刷新
            </button>
            {/* 常驻：库空了更要能恢复 */}
            <button
              onClick={() => setBackupOpen(true)}
              title="把卡片、音频、字幕、配图打包成 ZIP，或从备份恢复"
              className="flex items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-ink-600 transition hover:border-ink-400 hover:text-ink-900"
            >
              <Archive className="h-3.5 w-3.5" />
              备份
            </button>
            {items.length > 0 && (
              <button
                onClick={() => void handleClearAll()}
                className="rounded-md px-2 py-1.5 text-xs text-ink-400 transition hover:text-red-600"
              >
                清空全部
              </button>
            )}
          </div>

          {/*
            预设筛选行：一键套用一组「组合标签」。
            「全部」放在最前面：选中预设之后必须有一个**看得见**的回退入口——
            只靠"再点一次同一个预设取消"是隐式操作，用户找不到就等于没有。
          */}
          {(presets.length > 0 || items.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-400">预设</span>
              <button
                onClick={clearFilters}
                title="清除预设与搜索，显示全部卡片"
                aria-label="显示全部"
                aria-pressed={!activePreset && keywords.length === 0}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  !activePreset && keywords.length === 0
                    ? 'border-ink-800 bg-ink-800 text-white'
                    : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400 hover:text-ink-900'
                }`}
              >
                全部 <span className="tabular-nums opacity-70">{items.length}</span>
              </button>
              {presets.map((p) => {
                const active = p.id === activePresetId
                const count = items.filter((s) => matchesCombos(tagsOf.get(s.id) ?? [], p.combos)).length
                const tip = `${p.name}（${p.combos.map((c) => c.join(' + ')).join(' 或 ')}）`
                // 选中态用「两个**并列**的 button」拼成一个胶囊，而不是在一个 button 里
                // 嵌一个可点的 span：嵌套可点元素既是无效 HTML，读屏软件也念不出来，
                // 而且图标按钮必须自己能获得焦点。视觉上仍是一个胶囊。
                return active ? (
                  <span
                    key={p.id}
                    className="flex items-center overflow-hidden rounded-full border border-ink-800 bg-ink-800 text-white"
                  >
                    <button
                      onClick={() => setActivePresetId(null)}
                      title={`${tip} · 再点一次取消`}
                      aria-label={`预设：${p.name}`}
                      aria-pressed
                      className="flex items-center gap-1 py-1 pl-2.5 pr-1 text-[11px]"
                    >
                      {p.name}
                      <span className="tabular-nums text-white/70">{count}</span>
                    </button>
                    <button
                      onClick={() => setActivePresetId(null)}
                      title="取消这个预设，显示全部"
                      aria-label="取消预设"
                      className="flex h-full items-center py-1 pl-0.5 pr-2 text-white/60 transition hover:text-white"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : (
                  <button
                    key={p.id}
                    onClick={() => setActivePresetId(p.id)}
                    title={tip}
                    aria-label={`预设：${p.name}`}
                    aria-pressed={false}
                    className="flex items-center gap-1 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] text-ink-600 transition hover:border-ink-400 hover:text-ink-900"
                  >
                    {p.name}
                    <span className="tabular-nums text-ink-400">{count}</span>
                  </button>
                )
              })}
              <button
                onClick={() => setPresetDialog(true)}
                className="rounded-full border border-dashed border-ink-200 px-2.5 py-1 text-[11px] text-ink-500 transition hover:border-ink-400 hover:text-ink-800"
              >
                {presets.length ? '管理预设' : '+ 新建预设'}
              </button>
            </div>
          )}

          {/*
            歌单菜单：命名保存过的队列，点一下按它自己的顺序播。
            失效卡片（已删/没音频）在播放时跳过并如实报数，而不是让播放卡住。
          */}
          {playlists.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-400">歌单</span>
              {playlists.map((p) => {
                const alive = p.cardIds.filter((id) => items.some((s) => s.id === id && s.audio)).length
                const dead = p.cardIds.length - alive
                return (
                  <span
                    key={p.id}
                    className="flex items-center overflow-hidden rounded-full border border-ink-200 bg-white"
                  >
                    <button
                      onClick={() => onPlayPlaylist?.(p)}
                      disabled={alive === 0}
                      title={
                        alive === 0
                          ? '这个歌单里的卡片都已经删掉或没有音频了'
                          : `播放「${p.name}」（${alive} 首${dead ? `，${dead} 首已失效` : ''}）`
                      }
                      aria-label={`歌单：${p.name}`}
                      className="flex items-center gap-1 py-1 pl-2.5 pr-1 text-[11px] text-ink-600 transition hover:text-ink-900 disabled:opacity-40"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      {p.name}
                      <span className="tabular-nums text-ink-400">
                        {alive}
                        {dead > 0 && <span className="text-amber-600">/{p.cardIds.length}</span>}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm(`删除歌单「${p.name}」？卡片不会被删除。`)) onDeletePlaylist?.(p.id)
                      }}
                      aria-label={`删除歌单 ${p.name}`}
                      className="flex h-full items-center py-1 pl-0.5 pr-2 text-ink-300 transition hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {/* 批量搜索的反馈。只在「多条件 / 有精确条件 / 有条件没找到」时出现——
              单个普通关键词时不该多出一行来挤压列表。 */}
          {(keywords.length > 1 ||
            missedKeywords.length > 0 ||
            activePreset ||
            parsed.unknownFields.length > 0 ||
            // 单个精确条件也要回显：用户得能确认「作者：李白」真的被当成字段限定解析了
            keywords.some((t) => t.field)) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-400">
              {keywords.length > 1 && (
                <span>
                  {keywords.length} 个条件（{matchAll ? '全部' : '任一'}命中） · 命中 {filtered.length} 张
                </span>
              )}
              {keywords.length <= 1 && <span>命中 {filtered.length} 张</span>}
              {/* 被识别成"字段限定"的条件单独回显：让用户确认自己写对了 */}
              {keywords
                .filter((t) => t.field)
                .map((t) => (
                  <span key={t.raw} className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-600">
                    {t.raw}
                  </span>
                ))}
              {keywords.length > 1 && (
                <span className="flex rounded-full border border-ink-200 bg-white p-0.5">
                  {([false, true] as const).map((all) => (
                    <button
                      key={String(all)}
                      onClick={() => setMatchAll(all)}
                      title={all ? '每个条件都要命中' : '任意一个条件命中即可'}
                      className={`rounded-full px-1.5 py-0.5 transition ${
                        matchAll === all ? 'bg-ink-800 text-white' : 'text-ink-500 hover:text-ink-800'
                      }`}
                    >
                      {all ? '全部' : '任一'}
                    </button>
                  ))}
                </span>
              )}
              {parsed.unknownFields.length > 0 && (
                <span className="text-amber-600">
                  未知字段「{parsed.unknownFields.join('、')}」，可用：标题 / 作者 / 正文 / 标签（已按全文搜索）
                </span>
              )}
              {activePreset && (
                <button
                  onClick={() => setActivePresetId(null)}
                  title="取消这个预设"
                  className="flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-ink-600 transition hover:bg-ink-200 hover:text-ink-900"
                >
                  预设「{activePreset.name}」生效中
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
              {missedKeywords.length > 0 && (
                <span className="text-amber-600">
                  未找到：
                  {missedKeywords.join('、')}
                </span>
              )}
              {(keywords.length > 0 || activePreset) && (
                <button
                  onClick={clearFilters}
                  className="rounded-full border border-ink-200 px-2 py-0.5 text-ink-500 transition hover:border-ink-400 hover:text-ink-800"
                >
                  清除筛选
                </button>
              )}
            </p>
          )}
        </div>

        {/* 列表 */}
        <div className="canvas-bg flex-1 overflow-y-auto p-4 md:p-6">
          {loading ? (
            <p className="py-16 text-center text-sm text-ink-400">读取中…</p>
          ) : items.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-sm text-ink-500">还没有保存过诗词卡片</p>
              <p className="mt-1 text-xs text-ink-400">
                到「编辑」页写好一首，点顶栏的「保存」就会出现在这里；
                如果之前导出过备份，也可以点上面的「备份」从 ZIP 恢复。
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink-400">
              {keywords.length > 1
                ? `这 ${keywords.length} 个条件一个都没匹配到`
                : `没有匹配「${query}」的卡片`}
              {keywords.some((t) => t.field) && (
                <span className="mt-1 block text-xs text-ink-400">
                  当前含精确条件（{keywords.filter((t) => t.field).map((t) => t.raw).join('、')}），可试试「任一」或去掉字段前缀。
                </span>
              )}
            </p>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((s) => (
                <LibraryCard
                  key={s.id}
                  snapshot={s}
                  selected={selected.has(s.id)}
                  selectMode={selected.size > 0}
                  onToggleSelect={() => toggleSelect(s.id)}
                  onOpen={() => setDetailId(s.id)}
                  onLoad={() => onLoadIntoEditor(s)}
                  onExport={() => void handleExportPng(s)}
                  onDelete={() => void handleDelete(s)}
                  onAssociate={() => setAudioId(s.id)}
                  onNotify={onNotify}
                  tagOpen={tagCardId === s.id}
                  tagBusy={tagBusy && tagCardId === s.id}
                  tagSuggestions={tagSuggestionList}
                  onQuickTag={() => setTagCardId((prev) => (prev === s.id ? null : s.id))}
                  onCloseTag={() => setTagCardId(null)}
                  onAddTags={(add) =>
                    void handleCardTags(s.id, normalizeTags([...(s.state.tags ?? []), ...add]))
                  }
                  onRemoveTag={(tag) =>
                    void handleCardTags(
                      s.id,
                      normalizeTags(s.state.tags).filter((t) => tagKey(t) !== tagKey(tag)),
                    )
                  }
                  onPlay={() => handleCardPlay(s.id)}
                />
              ))}
            </div>
          ) : (
            <ul className="mx-auto flex max-w-3xl flex-col gap-1.5">
              {filtered.map((s) => (
                <ListRow
                  key={s.id}
                  snapshot={s}
                  selected={selected.has(s.id)}
                  onToggleSelect={() => toggleSelect(s.id)}
                  onOpen={() => setDetailId(s.id)}
                  onLoad={() => onLoadIntoEditor(s)}
                  onExport={() => void handleExportPng(s)}
                  onDelete={() => void handleDelete(s)}
                  onAssociate={() => setAudioId(s.id)}
                  onNotify={onNotify}
                  onRemoveTag={(tag) =>
                    void handleCardTags(
                      s.id,
                      normalizeTags(s.state.tags).filter((x) => tagKey(x) !== tagKey(tag)),
                    )
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 备份与恢复 */}
      {backupOpen && (
        <BackupDialog
          snapshots={items}
          onClose={() => setBackupOpen(false)}
          onNotify={onNotify}
          onDone={() => void refresh()}
          legacy={legacy}
          onImportLegacy={onImportLegacy}
        />
      )}

      {/* 批量加标签 */}
      {batchTagOpen && (
        <BatchTagDialog
          count={selected.size}
          suggestions={tagSuggestionList}
          busy={tagBusy}
          onApply={(add) => void handleBatchTags(add)}
          onClose={() => setBatchTagOpen(false)}
        />
      )}

      {/* 组合标签预设的管理弹窗：增 / 删 / 改都在里面 */}
      {presetDialog && (
        <TagPresetDialog
          onClose={() => setPresetDialog(false)}
          onNotify={onNotify}
          onChanged={() => void reloadPresets()}
          sampleTags={allTagsOfCards}
          totalCards={items.length}
        />
      )}

      {/* 关联音频：弹层操作，不占列表空间。落库后 refresh 一次，卡片上的播放键立刻出现 */}
      {audioTarget && (
        <AudioDialog
          snapshot={audioTarget}
          onClose={() => setAudioId(null)}
          onNotify={onNotify}
          onChanged={() => {
            stopIfPlaying(audioTarget.id)
            void refresh()
          }}
          onAudioMeta={(patch) => snapshots.setAudioMeta(audioTarget.id, patch)}
        />
      )}

      {/* 详情：屏幕中央灯箱（不是右侧抽屉——点卡片就是为了看大图） */}
      {detail && (
        <SnapshotDetail
          snapshot={detail}
          busy={busy && busy.endsWith(detail.id) ? busy.split(':')[0] : null}
          onClose={() => setDetailId(null)}
          onLoad={() => onLoadIntoEditor(detail)}
          onExportPng={() => void handleExportPng(detail)}
          onExportBackground={() => void handleExportBackground(detail)}
          onDelete={() => void handleDelete(detail)}
          onNotify={onNotify}
        />
      )}

      {/* 批量导出进度 */}
      {progress && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(22rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-ink-200 bg-white p-3 shadow-xl">
          <div className="flex items-center gap-2 text-xs text-ink-700">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-500" />
            <span className="tabular-nums">
              正在导出 {progress.done} / {progress.total}
            </span>
            <span className="truncate text-ink-400">{progress.current}</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full bg-ink-800 transition-all"
              style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-ink-400">
            单张约 1.5–2 秒、约 10MB（要等字体解码稳定），
            已产出 {formatBytes(progress.bytes)}，请勿关闭页面
          </p>
          <button
            onClick={() => abortRef.current?.abort()}
            className="mt-2 w-full rounded-md border border-ink-200 py-1.5 text-xs text-ink-600 transition hover:border-red-300 hover:text-red-600"
          >
            取消
          </button>
        </div>
      )}
    </div>
  )
}

/** 列表视图的一行：信息密度更高，适合条目多时扫读 */
function ListRow({
  snapshot,
  selected,
  onToggleSelect,
  onOpen,
  onLoad,
  onExport,
  onDelete,
  onAssociate,
  onNotify,
  onRemoveTag,
}: {
  snapshot: Snapshot
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onLoad: () => void
  onExport: () => void
  onDelete: () => void
  onAssociate: () => void
  onNotify: (kind: 'ok' | 'err', message: string) => void
  /** 就地移除这张卡片上的某个标签 */
  onRemoveTag: (tag: string) => void
}) {
  const s = snapshot.state
  const tags = normalizeTags(s.tags)
  const audioState = audioStateOf(snapshot.audio)
  const theme = poetryThemes[Math.min(Math.max(s.themeIndex, 0), poetryThemes.length - 1)]
  const sizeLabel = SIZE_OPTIONS.find((o) => o.value === s.size)?.label ?? s.size
  return (
    <li
      className={`group flex items-center gap-3 rounded-lg border bg-white px-2.5 py-2 transition ${
        selected ? 'border-ink-800' : AUDIO_STATE_BORDER[audioState]
      }`}
    >
      <button onClick={onToggleSelect} aria-label="选择" className="shrink-0 text-ink-400 hover:text-ink-700">
        {selected ? <CheckSquare className="h-4 w-4 text-ink-800" /> : <Square className="h-4 w-4" />}
      </button>
      <span
        className="h-10 w-10 shrink-0 rounded border border-ink-200 bg-cover bg-center"
        style={{
          backgroundImage: snapshot.thumb
            ? `url("${snapshot.thumb}")`
            : (theme?.background ?? '#e9e6dd'),
        }}
      />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-baseline gap-2">
          {audioState !== 'none' && (
            <span
              className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${AUDIO_STATE_DOT[audioState]}`}
              title={AUDIO_STATE_LABEL[audioState]}
              aria-hidden
            />
          )}
          <span className="truncate text-sm text-ink-800">{snapshot.label}</span>
          <span className="shrink-0 text-[11px] text-ink-400">{s.author ? `- ${s.author}` : '未填作者'}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
          <span>{sizeLabel}</span>
          <span>·</span>
          <span>{theme?.name ?? '—'}</span>
          <span>·</span>
          <span>{fontLabelOf(isFontKey(s.fontKey) ? s.fontKey : 'default')}</span>
          <span>·</span>
          <span>{timeAgo(snapshot.updatedAt ?? snapshot.createdAt)}</span>
          {s.background && <span className="rounded bg-ink-100 px-1 text-ink-500">AI 背景</span>}
          {tags.map((t) => (
            <TagChip
              key={t}
              tag={t}
              className="text-[10px]"
              onRemove={onRemoveTag}
            />
          ))}          {snapshot.audio && (
            <span className="flex items-center gap-1 rounded bg-ink-100 px-1 text-ink-500">
              <Music className="h-2.5 w-2.5" />
              音频
            </span>
          )}
        </span>
      </button>
      {snapshot.audio && <PlayerButton id={snapshot.id} size="sm" onError={(m) => onNotify('err', m)} />}
      <span className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button onClick={onLoad} title="载入到编辑页" aria-label="载入" className="rounded p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700">
          <Download className="h-3.5 w-3.5" />
        </button>
        <button onClick={onExport} title="导出 PNG" aria-label="导出" className="rounded p-1.5 text-ink-400 hover:bg-ink-50 hover:text-ink-700">
          <FileArchive className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onAssociate}
          title={snapshot.audio ? '更换关联音频' : '关联音频'}
          aria-label="关联音频"
          className={`rounded p-1.5 transition hover:bg-ink-50 ${AUDIO_STATE_TEXT[audioState]}`}
        >
          <Music className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} title="删除" aria-label="删除" className="rounded p-1.5 text-ink-400 hover:bg-ink-50 hover:text-red-600">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </span>
    </li>
  )
}
