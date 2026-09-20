import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SnapshotCard } from '../components/SnapshotCard'
import { renderPngCanvas } from './exporter'
import { buildZip, safeZipName, type ZipEntry } from './zip'
import { withLoadedBackground, type Snapshot, type SnapshotState } from './snapshots'

/**
 * 离屏渲染任意一条快照，并导出为 PNG。
 *
 * 为什么不在管理页里「先载入到编辑页再导出」：那样每导一张都要切页、覆盖当前
 * 正在编辑的内容，批量导出根本没法做。这里把卡片挂到一个屏幕外的容器里渲染，
 * 走的是和编辑页**同一个** `SnapshotCard` 与同一条栅格化管线，所以出图一致。
 */

/**
 * 把卡片挂到屏幕外渲染，交给回调处理，最后清理。
 *
 * 注意**不能用 `display:none` 或 `visibility:hidden`**：html-to-image 会把
 * 计算样式一起克隆进 SVG，被隐藏的节点会导出一张空白图。所以只能靠
 * 定位到屏幕外来「看不见」，元素本身必须是正常渲染的。
 */
async function withMountedCard<T>(
  state: SnapshotState,
  fn: (node: HTMLElement) => Promise<T>,
): Promise<T> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;z-index:-1'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(SnapshotCard, { state }))
  try {
    // 等两帧：第一帧完成布局，第二帧确保背景图已经开始绘制
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    const node = host.firstElementChild as HTMLElement | null
    if (!node) throw new Error('卡片节点未挂载')
    return await fn(node)
  } finally {
    root.unmount()
    host.remove()
  }
}

export async function snapshotToBlob(state: SnapshotState): Promise<Blob> {
  const canvas = await withMountedCard(state, (node) => renderPngCanvas(node))
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 返回空'))), 'image/png')
  })
}

/** 触发浏览器下载一个 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立刻 revoke 在部分浏览器上会打断下载，延迟释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 文件名：标题/作者优先，退回 label，再去掉非法字符 */
export function pngFilename(snapshot: Snapshot): string {
  const used = new Set<string>()
  const base = snapshot.label || '奕霖古诗词'
  return safeZipName(`${base}.png`, used)
}

/** 导出单张 PNG。列表里的快照不带配图，先按需取回再渲染 */
export async function exportSnapshotPng(snapshot: Snapshot): Promise<void> {
  const full = await withLoadedBackground(snapshot)
  const blob = await snapshotToBlob(full.state)
  downloadBlob(blob, pngFilename(snapshot))
}

/** 导出该条快照的原始 AI 背景图（素材复用）；没有背景图时抛错 */
export async function exportSnapshotBackground(snapshot: Snapshot): Promise<void> {
  if (!snapshot.state.background) throw new Error('这条卡片没有 AI 背景图')
  const full = await withLoadedBackground(snapshot)
  const dataUrl = full.state.background?.dataUrl
  if (!dataUrl) throw new Error('配图读取失败')
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'
  const used = new Set<string>()
  downloadBlob(blob, safeZipName(`${snapshot.label || '背景'}-背景.${ext}`, used))
}

export interface BatchProgress {
  done: number
  total: number
  /** 当前正在导出的标题，用于进度条下方的说明 */
  current: string
  /** 已产出的累计字节数 */
  bytes: number
}

/** 实测：pixelRatio 3 下一张 1080×1440 的卡片约 10MB（噪点层让 PNG 几乎压不动） */
export const APPROX_PNG_BYTES = 10 * 1024 * 1024
/** 单张导出实测约 1.5–2 秒 */
export const APPROX_SECONDS_PER_CARD = 2

/** 批量导出前的规模估算，用来在开跑之前给用户一个「要不要继续」的判断依据 */
export function estimateBatch(count: number): { bytes: number; seconds: number } {
  return { bytes: count * APPROX_PNG_BYTES, seconds: count * APPROX_SECONDS_PER_CARD }
}

export interface BatchOptions {
  onProgress?: (p: BatchProgress) => void
  signal?: AbortSignal
}

/**
 * 批量导出为 ZIP。
 *
 * 单张导出实测 1.5–2 秒（栅格化管线要等 SVG 内嵌字体解码稳定），而且一张
 * 就有约 10MB——所以 20 张就是半分钟以上、200MB 上下。必须给进度、累计体积
 * 和取消，否则界面看起来像卡死，用户也不知道自己在等一个多大的东西。
 */
export async function exportSnapshotsZip(
  snapshots: Snapshot[],
  { onProgress, signal }: BatchOptions = {},
): Promise<Blob> {
  const entries: ZipEntry[] = []
  const used = new Set<string>()
  let done = 0
  let bytes = 0

  for (const snapshot of snapshots) {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
    onProgress?.({ done, total: snapshots.length, current: snapshot.label, bytes })
    // 列表里的快照不带配图，逐张按需取回——不取的话导出的就是没有背景的卡片
    const full = await withLoadedBackground(snapshot)
    const blob = await snapshotToBlob(full.state)
    const buf = new Uint8Array(await blob.arrayBuffer())
    bytes += buf.length
    entries.push({ name: safeZipName(`${snapshot.label || '奕霖古诗词'}.png`, used), data: buf })
    done++
    onProgress?.({ done, total: snapshots.length, current: snapshot.label, bytes })
  }

  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  return buildZip(entries)
}
