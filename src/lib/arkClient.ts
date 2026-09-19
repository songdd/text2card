/**
 * 前端访问 /api/* 的薄封装。
 *
 * 只请求同源接口，密钥与真实的服务商地址都在服务端（dev 中间件 / Pages Functions），
 * 前端拿到的图片已经是 data URL，天然免疫 CORS 与 canvas 污染。
 */

import type { SceneFields } from '../../shared/scene'

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  // 先用 text 再解析：网关/代理出错时返回的是 HTML，直接 res.json() 会抛出无意义的
  // 解析错误，把真正的原因（401、502 之类）盖掉
  const raw = await res.text()
  let json: any = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    const message = json?.error || (raw ? raw.slice(0, 300) : `${res.status} ${res.statusText}`)
    throw new Error(message)
  }
  if (!json) throw new Error('服务端返回了非 JSON 响应')
  return json as T
}

export async function dissectPoem(input: {
  text: string
  title?: string
  author?: string
}): Promise<SceneFields> {
  const { scene } = await postJson<{ scene: SceneFields }>('/api/dissect', input)
  return scene
}

export interface GeneratedBackground {
  dataUrl: string
  model: string
  size?: string
}

export async function generateBackgroundImage(
  prompt: string,
  size?: string,
): Promise<GeneratedBackground> {
  return postJson<GeneratedBackground>('/api/generate-image', { prompt, size })
}
