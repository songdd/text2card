/**
 * 两个 API 路由的共同实现。
 *
 * Vite dev 中间件与 Cloudflare Pages Functions 只是薄适配层，
 * 都调用这里——校验、错误映射、响应形状只写一份，避免 dev 与线上行为不一致。
 */

import { dissectPoem, generateImage, ArkError, type ArkEnv } from './arkServer'
import type { SceneFields } from './scene'

export type ApiRoute = 'dissect' | 'generate-image'

export interface ApiResult {
  status: number
  json: unknown
}

const MAX_POEM_LEN = 6000
const MAX_PROMPT_LEN = 4000

function bad(message: string): ApiResult {
  return { status: 400, json: { error: message } }
}

function toResult(err: unknown): ApiResult {
  if (err instanceof ArkError) return { status: err.status, json: { error: err.message } }
  const message = err instanceof Error ? err.message : String(err)
  return { status: 500, json: { error: `服务端异常：${message}` } }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export async function handleApi(env: ArkEnv, route: ApiRoute, body: unknown): Promise<ApiResult> {
  if (!body || typeof body !== 'object') return bad('请求体必须是 JSON 对象')
  const payload = body as Record<string, unknown>

  try {
    if (route === 'dissect') {
      const text = str(payload.text).trim()
      if (!text) return bad('缺少 text（诗词正文）')
      if (text.length > MAX_POEM_LEN) return bad(`正文过长（上限 ${MAX_POEM_LEN} 字）`)

      const scene: SceneFields = await dissectPoem(env, {
        text,
        title: str(payload.title).trim() || undefined,
        author: str(payload.author).trim() || undefined,
      })
      return { status: 200, json: { scene } }
    }

    if (route === 'generate-image') {
      const prompt = str(payload.prompt).trim()
      if (!prompt) return bad('缺少 prompt')
      if (prompt.length > MAX_PROMPT_LEN) return bad(`提示词过长（上限 ${MAX_PROMPT_LEN} 字）`)

      const image = await generateImage(env, {
        prompt,
        size: str(payload.size).trim() || undefined,
      })
      return { status: 200, json: image }
    }

    return { status: 404, json: { error: `未知接口：${route}` } }
  } catch (err) {
    return toResult(err)
  }
}
