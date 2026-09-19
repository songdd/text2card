/**
 * Cloudflare Pages Functions：/api/generate-image
 * 按拼好的提示词生成背景图，直接回 base64 data URL。
 */

import { handleApi } from '../../shared/handler'
import type { ArkEnv } from '../../shared/arkServer'

interface Ctx {
  request: Request
  env: ArkEnv
}

/** 用 new Response 而不是 Response.json()：后者不在 lib.dom 的类型里 */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  let body: unknown
  try {
    body = await ctx.request.json()
  } catch {
    return json({ error: '请求体必须是合法 JSON' }, 400)
  }
  const result = await handleApi(ctx.env, 'generate-image', body)
  return json(result.json, result.status)
}

export async function onRequest(): Promise<Response> {
  return json({ error: '只支持 POST' }, 405)
}
