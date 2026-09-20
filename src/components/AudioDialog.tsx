import { useEffect, useMemo, useRef, useState } from 'react'
import { FileAudio, FileText, Loader2, Trash2, Upload, X } from 'lucide-react'
import {
  MAX_AUDIO_BYTES,
  associateAudio,
  removeAudioAssociation,
  type AudioMeta,
  type Snapshot,
} from '../lib/snapshots'
import { formatBytes, formatDuration } from '../lib/format'
import {
  decodeLyricsBuffer,
  matchLyrics,
  parseLyrics,
  resolveLyrics,
  splitClauses,
  toLrc,
} from '../lib/lyrics'

/**
 * 关联本地音频文件的对话框。
 *
 * 「关联」而不是「上传」：文件不出这台设备，直接以 Blob 存进 IndexedDB 的
 * audio 仓库，没有后端、没有账号、没有网络请求。所以文案里必须说清楚——
 * 用户会默认"关联"等于"传到服务器"，而这里的音频**换台设备就没了**。
 *
 * 二次关联 = 覆盖（audio 仓库以快照 id 为主键），所以这里不叫「重新上传」，
 * 而是明确写「更换」并提示"不会产生第二条"。
 */

/**
 * 扩展名/MIME 的宽名单。**只在解码探测超时时当兜底**用（见 probeMedia 的注释），
 * 所以它宁宽勿严：误杀一个能播的文件远比多试一次代价大。
 */
const AUDIO_EXT =
  /\.(mp3|mp2|m4a|m4b|m4r|aac|wav|wave|flac|alac|ogg|oga|opus|weba|webm|wma|asf|amr|awb|aiff?|aifc|ac3|dts|mka|mkv|mp4|m4v|mov|3gp|3g2|caf|ape|wv|tta|dsf|dff|sln|silk|aud)$/i

/** 字幕/歌词文件：优先按扩展名分类，识别不了的再去嗅内容 */
const SUB_EXT = /\.(srt|lrc|vtt|txt|sbv|ass|ssa)$/i

function looksLikeAudio(file: File): boolean {
  return file.type.startsWith('audio/') || file.type.startsWith('video/') || AUDIO_EXT.test(file.name)
}

function looksLikeSubtitle(file: File): boolean {
  return SUB_EXT.test(file.name)
}

/**
 * 让浏览器自己去判断「这个文件到底能不能播」。
 *
 * 这是**主判据**，不是「按扩展名白名单」：真实世界的音频文件扩展名很杂
 * （.m4b / .mka / .weba / .3gp / 甚至 .mp4 里只有音轨），白名单一定会误杀，
 * 而误杀的提示还是「看起来不是音频文件」——用户手里的明明是能播的音频。
 * 交给浏览器解码则没有这个盲区：能读出时长就是能播。
 *
 * 三种结果分开表达，因为处理方式不同：
 *   decodable      → 收下
 *   error          → 浏览器明确说播不了（格式不受支持/解码失败），拒掉并说明原因
 *   timedOut       → 没报错也没读出元信息（大文件慢、或容器怪）：若扩展名/MIME
 *                    像音频就照收（宁愿放宽，也不要再误杀一次）
 */
interface ProbeResult {
  decodable: boolean
  duration?: number
  reason?: string
  timedOut?: boolean
}

const MEDIA_ERROR_TEXT: Record<number, string> = {
  1: '加载被中止',
  2: '读取失败',
  3: '解码失败',
  4: '格式不受支持',
}

function probeMedia(file: Blob): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const probe = document.createElement('audio')
    probe.preload = 'metadata'
    let settled = false
    const finish = (r: ProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(r)
    }
    const timer = setTimeout(
      () => finish({ decodable: false, timedOut: true, reason: '8 秒内没读出媒体信息' }),
      8000,
    )
    probe.addEventListener('loadedmetadata', () => {
      const d = probe.duration
      finish({ decodable: true, duration: Number.isFinite(d) && d > 0 ? d : undefined })
    })
    probe.addEventListener('error', () => {
      const code = probe.error?.code ?? 0
      finish({
        decodable: false,
        reason: MEDIA_ERROR_TEXT[code] ?? `格式不受支持（media error ${code || '未知'}）`,
      })
    })
    probe.src = url
  })
}

/** 一句人话把「为什么失败」说全，便于用户（和我）定位 */
function describeFile(file: File): string {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1) : '（无扩展名）'
  return `${file.name} · ${formatBytes(file.size)} · 扩展名 ${ext} · 浏览器识别为 ${file.type || '未知类型'}`
}

export function AudioDialog({
  snapshot,
  onClose,
  onNotify,
  onChanged,
  onAudioMeta,
}: {
  snapshot: Snapshot
  onClose: () => void
  onNotify: (kind: 'ok' | 'err', message: string) => void
  /** 关联发生变化后通知列表刷新 */
  onChanged: () => void
  /** 就地改写音频元信息（歌词时间轴、偏移） */
  onAudioMeta: (patch: Partial<AudioMeta>) => Promise<Snapshot | null>
}) {
  const [meta, setMeta] = useState<AudioMeta | undefined>(snapshot.audio)
  const [busy, setBusy] = useState(false)
  /** 失败原因**常驻**在对话框里：toast 4 秒就没了，用户想照着排查都来不及 */
  const [error, setError] = useState<{ message: string; detail: string } | null>(null)
  /** 粘贴字幕的输入区开关 */
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const subInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pasting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pasting])

  // 时间轴校验：字幕条数与正文句数是否对得上，如实告诉用户
  const lyricReport = useMemo(() => {
    if (!meta?.lyricText) return null
    const parsed = parseLyrics(meta.lyricText)
    if (!parsed?.cues.length) return null
    return { parsed, match: matchLyrics(parsed.cues, splitClauses(snapshot.state.text)) }
  }, [meta?.lyricText, snapshot.state.text])

  function fail(message: string, file: File) {
    const detail = describeFile(file)
    setError({ message, detail })
    // toast 给一眼可见，对话框里的常驻信息给可读可抄
    onNotify('err', `关联失败：${message}`)
    console.warn('[AudioDialog] 关联失败', { message, detail })
  }

  async function handleFile(file: File) {
    setError(null)
    if (file.size > MAX_AUDIO_BYTES) {
      fail(
        `文件 ${formatBytes(file.size)}，超过 ${formatBytes(MAX_AUDIO_BYTES)} 上限。先用音频软件压成 mp3 再关联。`,
        file,
      )
      return
    }

    setBusy(true)
    try {
      // 判据是「浏览器能不能解码」，不是扩展名白名单
      const probe = await probeMedia(file)
      const nameLooksAudio = looksLikeAudio(file)
      // 浏览器明确报错 → 拒；只是超时（比如大文件慢）而名字像音频 → 放行，
      // 宁可放宽也不要再误杀一次
      if (!probe.decodable && !(probe.timedOut && nameLooksAudio)) {
        fail(`浏览器播不了这个文件：${probe.reason ?? '格式不受支持'}`, file)
        return
      }

      const next = await associateAudio(snapshot.id, file, { name: file.name, duration: probe.duration })
      setMeta(next)
      setError(null)
      onChanged()
      // 用 meta（此刻还是改动前的值）判断说法，而不是 props 上的 snapshot.audio——
      // 列表刷新是异步的，props 可能还没跟上
      onNotify('ok', `${meta ? '已更换为' : '已关联'}「${file.name}」`)
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err), file)
    } finally {
      setBusy(false)
      // 清空 input，否则再选一次同一个文件不会触发 change
      if (inputRef.current) inputRef.current.value = ''
      if (subInputRef.current) subInputRef.current.value = ''
    }
  }

  /** 导入字幕/歌词：解析 → 校验 → 落库，并把校验结果如实回报 */
  async function applyLyrics(text: string, sourceName: string) {
    const parsed = parseLyrics(text)
    if (!parsed) {
      setError({
        message: '认不出这个文件的时间轴格式',
        detail: `${sourceName} · 支持 SRT（序号 + 00:00:00,000 --> …）与 LRC（[mm:ss.xx]）`,
      })
      onNotify('err', '认不出时间轴格式，请确认是 SRT 或 LRC')
      return
    }
    const match = matchLyrics(parsed.cues, splitClauses(snapshot.state.text))
    setBusy(true)
    try {
      const updated = await onAudioMeta({
        lyricText: text,
        lyricFormat: parsed.format,
        lyricClauses: match.clauseCount,
        // 句数一致时默认沿用字幕文本；不一致时也先按字幕文本走（更安全）
        lyricMode: 'subtitle',
      })
      if (updated?.audio) setMeta(updated.audio)
      setPasting(false)
      setPasteText('')
      setError(null)
      const bits = [`${parsed.format.toUpperCase()} · ${parsed.blocks} 条`]
      if (parsed.cues.length !== parsed.blocks) bits.push(`拆成 ${parsed.cues.length} 句`)
      if (match.aligned) bits.push(`与正文 ${match.clauseCount} 句一一对应`)
      else bits.push(`与正文对应 ${match.matched}/${match.clauseCount} 句`)
      if (match.extraIndexes.length) bits.push(`${match.extraIndexes.length} 句未对应（标题 / 朗诵者）`)
      onNotify('ok', `已导入时间轴：${bits.join('，')}`)
    } catch (err) {
      onNotify('err', `导入失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 读字幕文件（含编码兜底），再交给 applyLyrics */
  async function handleSubtitleFile(file: File) {
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      await applyLyrics(decodeLyricsBuffer(buf), file.name)
    } catch (err) {
      setError({ message: `读取失败：${err instanceof Error ? err.message : String(err)}`, detail: describeFile(file) })
    }
  }

  /**
   * 一次选/拖多个文件：音频归音频、字幕归字幕。
   * 网页读不到"音频同目录的兄弟文件"，所以必须让用户把两个文件一起交进来。
   */
  async function handleFiles(files: File[]) {
    const subtitle = files.find(looksLikeSubtitle)
    const audio = files.find((f) => !looksLikeSubtitle(f) && looksLikeAudio(f))
    if (audio) await handleFile(audio)
    if (subtitle) await handleSubtitleFile(subtitle)
    if (!audio && !subtitle) {
      setError({
        message: '没认出任何音频或字幕文件',
        detail: files.map((f) => describeFile(f)).join('；'),
      })
    }
  }

  async function clearLyrics() {
    setBusy(true)
    try {
      const updated = await onAudioMeta({
        lyricText: undefined,
        lyricFormat: undefined,
        lyricClauses: undefined,
        lyricMode: undefined,
      })
      if (updated?.audio) setMeta(updated.audio)
      onNotify('ok', '已清除歌词时间轴')
    } finally {
      setBusy(false)
    }
  }

  /** 导出 .lrc：对齐结果因此可复用、可备份、可分享 */
  function exportLrc() {
    const resolved = resolveLyrics(snapshot.state.text, meta)
    if (!resolved.lines.length) {
      onNotify('err', '当前没有可导出的时间轴（先导入字幕，或等能读出音频时长）')
      return
    }
    const base = (snapshot.audio?.name ?? snapshot.label).replace(/\.[^.]+$/, '')
    const text = toLrc(resolved.lines, { title: snapshot.label, artist: snapshot.state.author })
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}.lrc`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    onNotify('ok', `已导出 ${base}.lrc`)
  }

  async function handleRemove() {
    setBusy(true)
    setError(null)
    try {
      await removeAudioAssociation(snapshot.id)
      setMeta(undefined)
      onChanged()
      onNotify('ok', '已解除关联')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError({ message, detail: snapshot.label })
      onNotify('err', `解除关联失败：${message}`)
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
        className={`w-full max-w-md overflow-hidden rounded-xl border bg-white shadow-2xl transition ${
          dragging ? 'border-ink-800 ring-2 ring-ink-800/20' : 'border-ink-200'
        }`}
        onClick={(e) => e.stopPropagation()}
        /**
         * 拖拽进来：一次拖音频 + 字幕两个文件最省事（浏览器不给目录访问权限，
         * 只能靠用户把文件交过来）。拖拽期间用一次计数器判断进入/离开，
         * 因为 dragenter/dragleave 会在子元素之间反复触发。
         */
        onDragEnter={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const files = [...(e.dataTransfer?.files ?? [])]
          if (files.length) void handleFiles(files)
        }}
      >
        {dragging && (
          <p className="bg-ink-800 px-4 py-1.5 text-center text-[11px] text-white">
            松开即可导入（音频 + 字幕可以一起拖进来）
          </p>
        )}
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            <FileAudio className="h-4 w-4 shrink-0 text-ink-500" />
            <span className="truncate font-medium text-ink-800">关联音频</span>
          </span>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-ink-50 hover:text-ink-700"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="truncate text-xs text-ink-500">
            {snapshot.label}
            {snapshot.state.author ? ` · ${snapshot.state.author}` : ''}
          </p>

          <div className="rounded-lg border border-ink-200 bg-ink-50/60 px-3 py-2.5">
            {meta ? (
              <div className="flex items-start gap-2.5">
                <FileAudio className="mt-0.5 h-4 w-4 shrink-0 text-ink-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-800" title={meta.name}>
                    {meta.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    {formatBytes(meta.size)}
                    {formatDuration(meta.duration) && ` · ${formatDuration(meta.duration)}`}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-500">尚未关联音频</p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="flex flex-1 items-center justify-center gap-2 rounded-md bg-ink-800 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {meta ? '更换音频文件' : '选择本地音频文件'}
            </button>
            {meta && (
              <button
                onClick={() => void handleRemove()}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 rounded-md border border-ink-200 px-3 py-2.5 text-sm text-ink-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                解除关联
              </button>
            )}
          </div>

          {/* 失败原因常驻显示：toast 一闪而过，看不到就没法排查 */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2.5">
              <p className="text-xs font-medium text-red-700">关联失败：{error.message}</p>
              <p className="mt-1 break-all text-[11px] leading-relaxed text-ink-500">{error.detail}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                若文件确实能正常播放，请把上面这行信息发我，我按它定位。
              </p>
            </div>
          )}

          {/* 隐藏的原生文件选择器。accept 只是文件对话框的过滤器（用户可以切成
              "所有文件"），真正的判据在 handleFile 里：能不能解码。这里放上
              video/* 是因为「只有音轨的 mp4/mov」在现实里很常见，而它们能被
              <audio> 正常播放。multiple + 字幕扩展名：让用户**一次把音频和字幕
              一起选中**——网页读不到同目录的兄弟文件，这是唯一的自动配对方式。 */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="audio/*,video/*,.mp3,.m4a,.m4b,.aac,.wav,.flac,.ogg,.opus,.wma,.amr,.ape,.mka,.srt,.lrc,.txt"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              if (files.length) void handleFiles(files)
            }}
          />

          <p className="text-[11px] leading-relaxed text-ink-400">
            音频<span className="font-medium text-ink-500">只存在这台设备的浏览器里</span>
            （IndexedDB），不会上传到任何服务器，也不随 PNG / ZIP 导出。
            {meta ? '再选一次是直接替换，不会多出第二条关联。' : ''}
            选到视频文件（mp4/mov）时只取其中的声音。
          </p>

          {/* ---------------------------------------------------- 歌词时间轴 */}
          <div className="flex flex-col gap-2 rounded-lg border border-ink-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink-700">
                <FileText className="h-3.5 w-3.5 text-ink-400" />
                歌词时间轴
              </span>
              {lyricReport && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                  {lyricReport.parsed.format.toUpperCase()} · {lyricReport.parsed.cues.length} 句
                </span>
              )}
            </div>

            {lyricReport ? (
              <p className="text-[11px] leading-relaxed text-ink-500">
                {lyricReport.match.aligned ? (
                  <>与正文 {lyricReport.match.clauseCount} 句一一对应 ✓</>
                ) : (
                  <>
                    与正文对应 {lyricReport.match.matched}/{lyricReport.match.clauseCount} 句
                    {lyricReport.match.extraIndexes.length > 0 &&
                      ` · ${lyricReport.match.extraIndexes.length} 条未对应（标题 / 朗诵者 / 译文一类）`}
                    {lyricReport.match.missingIndexes.length > 0 &&
                      ` · 正文有 ${lyricReport.match.missingIndexes.length} 句没有时间`}
                  </>
                )}
                {lyricReport.parsed.cues.length !== lyricReport.parsed.blocks &&
                  ` · 一条字幕里的多句已拆开（${lyricReport.parsed.blocks} 条 → ${lyricReport.parsed.cues.length} 句）`}
              </p>
            ) : (
              <p className="text-[11px] leading-relaxed text-ink-400">
                {meta
                  ? '还没时间轴。有 SRT / LRC 就导入，歌词会精确跟着走；没有则按句长比例滚动（大致跟着走）。'
                  : '先关联音频，再导入字幕或歌词文件。'}
              </p>
            )}

            {pasting ? (
              <div className="flex flex-col gap-1.5">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={5}
                  spellCheck={false}
                  placeholder={'1\n00:00:12,340 --> 00:00:15,120\n孤舟蓑笠翁\n\n或\n[00:12.34]孤舟蓑笠翁'}
                  className="font-mono w-full resize-y rounded-md border border-ink-200 bg-ink-50/60 px-2 py-1.5 text-[11px] leading-relaxed text-ink-800 outline-none transition placeholder:text-ink-300 focus:border-ink-600"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => void applyLyrics(pasteText, '粘贴的字幕')}
                    disabled={busy || !pasteText.trim()}
                    className="flex-1 rounded-md bg-ink-800 px-2 py-1.5 text-xs font-medium text-white transition hover:bg-ink-900 disabled:opacity-40"
                  >
                    确认导入
                  </button>
                  <button
                    onClick={() => {
                      setPasting(false)
                      setPasteText('')
                    }}
                    className="rounded-md border border-ink-200 px-3 py-1.5 text-xs text-ink-600 transition hover:border-ink-400"
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => subInputRef.current?.click()}
                  disabled={busy || !meta}
                  className="rounded-md border border-ink-200 px-2 py-1 text-[11px] text-ink-600 transition hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
                >
                  导入字幕 / 歌词
                </button>
                <button
                  onClick={() => setPasting(true)}
                  disabled={busy || !meta}
                  className="rounded-md border border-ink-200 px-2 py-1 text-[11px] text-ink-600 transition hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
                >
                  粘贴字幕
                </button>
                <button
                  onClick={exportLrc}
                  disabled={busy || !meta}
                  className="rounded-md border border-ink-200 px-2 py-1 text-[11px] text-ink-600 transition hover:border-ink-400 hover:text-ink-900 disabled:opacity-40"
                >
                  导出 .lrc
                </button>
                {meta?.lyricText && (
                  <button
                    onClick={() => void clearLyrics()}
                    disabled={busy}
                    className="rounded-md border border-ink-200 px-2 py-1 text-[11px] text-ink-500 transition hover:border-red-300 hover:text-red-600 disabled:opacity-40"
                  >
                    清除时间轴
                  </button>
                )}
              </div>
            )}

            {/* 字幕单独选：只有字幕、不改音频时用 */}
            <input
              ref={subInputRef}
              type="file"
              accept=".srt,.lrc,.vtt,.txt,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleSubtitleFile(file)
                e.target.value = ''
              }}
            />

            <p className="text-[11px] leading-relaxed text-ink-400">
              <span className="font-medium text-ink-500">SRT 与 LRC 都支持</span>
              （按内容识别，不看扩展名；GBK/GB18030 编码也能读）。
              字幕文件在音频同目录也要<span className="font-medium text-ink-500">一起选中</span>
              ——网页没有权限自己去翻那个文件夹。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
