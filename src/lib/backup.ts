import {
  clearSnapshots,
  deletePlaylist,
  deleteTagPreset,
  getAudioBlob,
  listPlaylists,
  listSnapshots,
  listTagPresets,
  putPlaylist,
  putSnapshot,
  putTagPreset,
  restoreAudio,
  snapshotKeyOf,
  type Playlist,
  type Snapshot,
  type TagPreset,
} from './snapshots'
import { buildZip, readZip, type ZipEntry } from './zip'
import { makeThumb } from './thumb'

/**
 * 完整备份 / 恢复。
 *
 * 为什么需要它：卡片、音频、字幕时间轴全都存在浏览器的 IndexedDB 里（`localhost:5173`
 * 这个源），而浏览器把站点数据当**可回收资源**——磁盘紧张时可能自动清理，用户"清除
 * 浏览数据"也会一起没。`persist()` 只能降低概率，拦不住手动清。所以真正的保险是
 * **在浏览器之外留一份**，而这个 ZIP 就是那一份。
 *
 * 包内结构（尽量做成"人也能看懂"的存档，而不是一坨序列化数据）：
 *
 *     backup.json                     卡片/歌单/预设 + 音频与字幕的元信息
 *     audio/<卡片id>.<ext>            音频原始字节（可直接播）
 *     images/<卡片id>.<ext>           AI 配图（可直接看）
 *     lyrics/<卡片id>.srt|.lrc        字幕/歌词原文（可拿到别的工具里用）
 *
 * 缩略图（240px）**不导出**：它可以从配图重新生成，存进去只是白占体积。
 */

export const BACKUP_FORMAT = 'yilin-gushici-backup@1'
const MANIFEST = 'backup.json'

/** 清单里的一张卡片：去掉缩略图，配图的 dataUrl 换成"另存为文件"的引用 */
interface BackupCard {
  record: Snapshot
  /** 配图在包内的路径（没有配图则不填） */
  image?: string
  /** 音频在包内的路径 */
  audio?: string
  /** 字幕在包内的路径 */
  lyric?: string
}

export interface BackupManifest {
  format: string
  exportedAt: number
  counts: { cards: number; audio: number; images: number; lyrics: number; playlists: number; presets: number }
  cards: BackupCard[]
  playlists: Playlist[]
  presets: TagPreset[]
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

function extOfName(name: string, fallback: string): string {
  const m = name.match(/\.([a-z0-9]{1,5})$/i)
  return m ? m[1].toLowerCase() : fallback
}

/** data URL → 字节（备份里配图存原始字节，比 base64 省 1/3 体积，也能直接查看） */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
  if (!m) return null
  const mime = m[1] || 'application/octet-stream'
  if (!m[2]) {
    // 非 base64（例如 utf8 的 svg）：按文本编码
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[3])), mime }
  }
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(bin)}`
}

function mimeOfExt(path: string): string {
  const ext = extOfName(path, 'jpg')
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

export interface ExportProgress {
  done: number
  total: number
  current: string
}

/** 打包一份完整备份 */
export async function exportBackup(onProgress?: (p: ExportProgress) => void): Promise<Blob> {
  const cards = await listSnapshots()
  const playlists = await listPlaylists()
  const presets = await listTagPresets()
  const entries: ZipEntry[] = []
  const backupCards: BackupCard[] = []
  const counts = { cards: cards.length, audio: 0, images: 0, lyrics: 0, playlists: playlists.length, presets: presets.length }
  let done = 0

  for (const card of cards) {
    const record: Snapshot = {
      ...card,
      // 缩略图不导出：能从配图重新生成
      thumb: undefined,
      state: { ...card.state },
    }
    const item: BackupCard = { record }

    // 配图
    const dataUrl = card.state.background?.dataUrl
    if (dataUrl) {
      const decoded = dataUrlToBytes(dataUrl)
      if (decoded) {
        const ext = MIME_EXT[decoded.mime] ?? 'jpg'
        const path = `images/${card.id}.${ext}`
        entries.push({ name: path, data: decoded.bytes })
        // 记录里把图掏空，避免同一张图在 JSON 里再 base64 一遍
        record.state = { ...record.state, background: { ...card.state.background!, dataUrl: '' } }
        item.image = path
        counts.images++
      } else {
        // 解不出来就原样留在 JSON 里，宁可包大一点也不能丢数据
        record.state = { ...record.state, background: card.state.background }
      }
    }

    // 音频
    if (card.audio) {
      const blob = await getAudioBlob(card.id)
      if (blob) {
        const ext = extOfName(card.audio.name, 'bin')
        const path = `audio/${card.id}.${ext}`
        entries.push({ name: path, data: new Uint8Array(await blob.arrayBuffer()) })
        item.audio = path
        counts.audio++
      }
    }

    // 字幕/歌词原文
    if (card.audio?.lyricText) {
      const ext = card.audio.lyricFormat === 'lrc' ? 'lrc' : 'srt'
      const path = `lyrics/${card.id}.${ext}`
      entries.push({ name: path, data: new TextEncoder().encode(card.audio.lyricText) })
      item.lyric = path
      counts.lyrics++
    }

    backupCards.push(item)
    onProgress?.({ done: ++done, total: cards.length, current: card.label })
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    exportedAt: Date.now(),
    counts,
    cards: backupCards,
    playlists,
    presets,
  }
  entries.unshift({
    name: MANIFEST,
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  })

  return buildZip(entries)
}

export function backupFileName(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `奕霖古诗词-备份-${stamp}.zip`
}

export interface ImportResult {
  cards: number
  updated: number
  created: number
  audio: number
  images: number
  lyrics: number
  playlists: number
  presets: number
  skipped: string[]
}

export interface ImportOptions {
  /** merge：同标题+作者则更新，其余新增（默认）；replace：先清空再恢复 */
  mode: 'merge' | 'replace'
  onProgress?: (p: ExportProgress) => void
}

/**
 * 从备份 ZIP 恢复。
 *
 * 合并语义沿用应用本身那条规则（标题 + 作者 相同即同一条），所以"恢复备份"不会
 * 攒出一堆重复卡片；命中的那条保留**原来的 id**，音频也写到那个 id 上。
 */
export async function importBackup(file: File, { mode, onProgress }: ImportOptions): Promise<ImportResult> {
  const zip = await readZip(file)
  const manifestBytes = zip.get(MANIFEST)
  if (!manifestBytes) throw new Error('备份里缺少 backup.json，可能不是本应用导出的包')

  let manifest: BackupManifest
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BackupManifest
  } catch {
    throw new Error('backup.json 解析失败（文件可能损坏）')
  }
  if (manifest.format !== BACKUP_FORMAT) {
    throw new Error(`备份格式不匹配：包里是 ${manifest.format || '未知'}，当前支持 ${BACKUP_FORMAT}`)
  }

  const result: ImportResult = {
    cards: 0,
    updated: 0,
    created: 0,
    audio: 0,
    images: 0,
    lyrics: 0,
    playlists: 0,
    presets: 0,
    skipped: [],
  }

  if (mode === 'replace') {
    await clearSnapshots()
    for (const p of await listPlaylists()) await deletePlaylist(p.id)
    for (const p of await listTagPresets()) await deleteTagPreset(p.id)
  }

  const existing = mode === 'merge' ? await listSnapshots() : []
  const byKey = new Map(existing.map((s) => [snapshotKeyOf(s.state), s]))

  let done = 0
  for (const item of manifest.cards) {
    const source = item.record
    const key = snapshotKeyOf(source.state)
    const hit = byKey.get(key)

    // 配图：从包里读回来，重新生成缩略图
    let background = source.state.background
    if (item.image) {
      const bytes = zip.get(item.image)
      if (bytes) {
        const dataUrl = bytesToDataUrl(bytes, mimeOfExt(item.image))
        background = {
          ...(background ?? { scrim: 0.5, aspect: 'portrait', createdAt: Date.now() }),
          dataUrl,
        } as typeof background
        result.images++
      } else {
        result.skipped.push(`${source.label}：配图丢失`)
      }
    }

    const record: Snapshot = {
      ...source,
      id: hit?.id ?? source.id,
      // 同一条时保留原始创建时间，更新时刷新 updatedAt（与"保存"一致）
      createdAt: hit?.createdAt ?? source.createdAt,
      updatedAt: Date.now(),
      state: { ...source.state, background },
      thumb: undefined,
    }

    if (background?.dataUrl) {
      try {
        record.thumb = await makeThumb(background.dataUrl)
      } catch {
        // 缩略图失败不影响数据本身，列表回落到主题渐变
      }
    }

    await putSnapshot(record)
    if (item.audio) {
      const bytes = zip.get(item.audio)
      const meta = source.audio
      if (bytes && meta) {
        await restoreAudio(record.id, new Blob([bytes as unknown as BlobPart], { type: meta.type || 'audio/mpeg' }), meta)
        result.audio++
      } else if (meta) {
        result.skipped.push(`${source.label}：音频丢失`)
      }
    }
    result.cards++
    if (hit) result.updated++
    else result.created++
    onProgress?.({ done: ++done, total: manifest.cards.length, current: source.label })
  }

  // 歌单与标签预设：同名视为同一条，不重复添加
  const existingPlaylists = await listPlaylists()
  const playlistNames = new Set(existingPlaylists.map((p) => p.name))
  for (const p of manifest.playlists ?? []) {
    if (playlistNames.has(p.name)) continue
    await putPlaylist(p)
    result.playlists++
  }
  const existingPresets = await listTagPresets()
  const presetNames = new Set(existingPresets.map((p) => p.name))
  for (const p of manifest.presets ?? []) {
    if (presetNames.has(p.name)) continue
    await putTagPreset(p)
    result.presets++
  }

  // 歌词原文已经在 record.audio.lyricText 里还原了，这里只是记数（文件是给人看的）
  result.lyrics = manifest.cards.filter((c) => c.lyric).length
  return result
}
