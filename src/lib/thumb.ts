/**
 * 缩略图生成。
 *
 * 管理页的网格不会用原图当缩略图：一张 AI 配图 1–5MB，几十张同时挂进 DOM
 * 会直接吃光内存。所以保存时从原图缩一份 240px 宽的 JPEG 存进快照记录，
 * 网格只读这个小图；要看大图/导出时才读完整 state。
 *
 * 生成失败不影响保存——没有 thumb 时列表回落到主题渐变。
 */

export const THUMB_WIDTH = 240

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

/** 把 data URL 缩成一张小 JPEG；任何一步失败都返回 undefined */
export async function makeThumb(dataUrl: string, width = THUMB_WIDTH): Promise<string | undefined> {
  if (!dataUrl || typeof document === 'undefined') return undefined
  try {
    const img = await loadImage(dataUrl)
    const ratio = img.naturalHeight / img.naturalWidth
    const h = Math.max(1, Math.round(width * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1)))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(img, 0, 0, width, h)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}

/** 粗略估算一条 data URL 的字节数（base64 解出来约 3/4）。服务端也要用，放在 shared 里 */
export { dataUrlBytes } from '../../shared/scene'
