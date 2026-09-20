import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import {
  deleteTagPreset,
  listTagPresets,
  makeId,
  putTagPreset,
  type TagPreset,
} from '../lib/snapshots'
import { formatCombos, matchesCombos, parseCombos } from '../lib/tags'

/**
 * 「组合标签预设」的管理弹窗。
 *
 * 一个预设 = 若干**组合**，组合就是文本框里的一行：
 *
 *     人教 1年级
 *     人教 2年级
 *
 * 语义是「组内 AND、组间 OR」——上面这个预设一键筛出「人教 且 1年级，或
 * 人教 且 2年级」。之所以用多行文本而不是两层嵌套的标签选择器：用户心里想的
 * 就是几行文字，让他直接写出来最快，也不需要我先教他界面怎么用。
 *
 * 这个弹窗同时承担 增（新建）、删、改（名字与组合），列表在左侧。
 */

interface Draft {
  id: string
  name: string
  combosText: string
  createdAt: number
}

function toDraft(preset: TagPreset): Draft {
  return {
    id: preset.id,
    name: preset.name,
    combosText: formatCombos(preset.combos),
    createdAt: preset.createdAt,
  }
}

/** 新建用的空白草稿 */
function newDraft(): Draft {
  return { id: makeId(), name: '', combosText: '', createdAt: Date.now() }
}

export function TagPresetDialog({
  onClose,
  onNotify,
  onChanged,
  /** 用「示例卡片」的标签实时预览这个预设能筛出什么（命中数） */
  sampleTags,
  totalCards,
}: {
  onClose: () => void
  onNotify: (kind: 'ok' | 'err', message: string) => void
  onChanged: () => void
  /** 所有卡片的标签集合，用来算命中数 */
  sampleTags: string[][]
  totalCards: number
}) {
  const [presets, setPresets] = useState<TagPreset[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void listTagPresets()
      .then((list) => {
        if (!alive) return
        setPresets(list)
        // 一个预设都没有时，直接给一张空白草稿：省掉"再点一次新建"这一步
        setDraft(list[0] ? toDraft(list[0]) : newDraft())
      })
      .catch((err) => onNotify('err', `读取预设失败：${err instanceof Error ? err.message : String(err)}`))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [onNotify])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** 实时算这个预设会筛出多少张卡片——写错了能立刻看出来 */
  const hitCount = useMemo(() => {
    if (!draft) return 0
    const combos = parseCombos(draft.combosText)
    if (!combos.length) return totalCards
    return sampleTags.filter((tags) => matchesCombos(tags, combos)).length
  }, [draft, sampleTags, totalCards])

  async function save() {
    if (!draft) return
    const combos = parseCombos(draft.combosText)
    if (!draft.name.trim()) {
      onNotify('err', '预设名称不能为空')
      return
    }
    if (!combos.length) {
      onNotify('err', '至少要写一行组合标签，例如「人教 1年级」')
      return
    }
    setBusy(true)
    try {
      const now = Date.now()
      const record: TagPreset = {
        id: draft.id,
        name: draft.name.trim(),
        combos,
        createdAt: draft.createdAt || now,
        updatedAt: now,
      }
      await putTagPreset(record)
      setPresets(await listTagPresets())
      setDraft(toDraft(record))
      onChanged()
      onNotify('ok', `已保存预设「${record.name}」`)
    } catch (err) {
      onNotify('err', `保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`删除预设「${name}」？卡片和标签都不受影响。`)) return
    setBusy(true)
    try {
      await deleteTagPreset(id)
      const rest = await listTagPresets()
      setPresets(rest)
      setDraft(rest[0] ? toDraft(rest[0]) : newDraft())
      onChanged()
      onNotify('ok', `已删除预设「${name}」`)
    } catch (err) {
      onNotify('err', `删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <span className="font-medium text-ink-800">组合标签预设</span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* 左：预设列表 + 新建 */}
          <div className="flex w-44 shrink-0 flex-col border-r border-ink-100">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {loading ? (
                <p className="px-2 py-3 text-[11px] text-ink-400">读取中…</p>
              ) : presets.length === 0 ? (
                <p className="px-2 py-3 text-[11px] leading-relaxed text-ink-400">
                  还没有预设。点下面的「新建」建一个，比如「人教小学版本」。
                </p>
              ) : (
                presets.map((p) => (
                  <div
                    key={p.id}
                    className={`group flex items-center gap-1 rounded-md px-2 py-1.5 transition ${
                      draft?.id === p.id ? 'bg-ink-800 text-white' : 'text-ink-600 hover:bg-ink-50'
                    }`}
                  >
                    <button
                      onClick={() => setDraft(toDraft(p))}
                      className="min-w-0 flex-1 truncate text-left text-xs"
                      title={p.name}
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => void remove(p.id, p.name)}
                      aria-label={`删除预设 ${p.name}`}
                      className={`shrink-0 rounded p-0.5 transition ${
                        draft?.id === p.id
                          ? 'text-white/60 hover:text-white'
                          : 'text-ink-300 opacity-0 hover:text-red-600 group-hover:opacity-100'
                      }`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <button
              onClick={() => setDraft(newDraft())}
              className="m-2 flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-ink-200 py-1.5 text-xs text-ink-600 transition hover:border-ink-400 hover:text-ink-800"
            >
              <Plus className="h-3.5 w-3.5" />
              新建预设
            </button>
          </div>

          {/* 右：编辑区 */}
          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {!draft ? (
              <p className="text-xs text-ink-400">左边选一个预设，或点「新建预设」。</p>
            ) : (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-400">预设名称</span>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="人教小学版本"
                    className="w-full rounded-md border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-ink-400">
                    组合标签 · 一行一个组合，行内用空格分隔标签
                  </span>
                  <textarea
                    value={draft.combosText}
                    onChange={(e) => setDraft({ ...draft, combosText: e.target.value })}
                    rows={7}
                    spellCheck={false}
                    placeholder={'人教 1年级\n人教 2年级\n人教 3年级'}
                    className="font-mono w-full resize-y rounded-md border border-ink-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
                  />
                </label>

                <p className="rounded-md bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-500">
                  <span className="font-medium text-ink-700">同一行 = 都要满足（且）</span>
                  ，<span className="font-medium text-ink-700">不同行 = 满足任一即可（或）</span>。
                  上面这组的意思是「人教 且 1年级，或 人教 且 2年级…」。
                  当前会筛出 <span className="font-medium tabular-nums text-ink-800">{hitCount}</span> / {totalCards} 张。
                </p>

                <div className="flex gap-2">
                  <button
                    onClick={() => void save()}
                    disabled={busy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md bg-ink-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    保存预设
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
