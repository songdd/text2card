/**
 * 火山方舟（Volcengine Ark）服务端调用：诗词拆解 + 背景图生成。
 *
 * 只在服务端运行（Vite dev 中间件 / Cloudflare Pages Functions），
 * ARK_API_KEY 永远不进前端 bundle。
 *
 * 只用全局 fetch / btoa，不碰 Node 专有 API，因此 Node 18+ 与 workerd 通用。
 */

import { SCENE_FIELD_META, normalizeScene, type SceneFields } from './scene'

export interface ArkEnv {
  ARK_API_KEY?: string
  ARK_BASE_URL?: string
  /** 文本模型，用于把诗词拆成五个字段 */
  ARK_TEXT_MODEL?: string
  /** 图像模型，用于生成背景图 */
  ARK_IMAGE_MODEL?: string
  /** 出图尺寸，如 '2K' / '4K' / '864x1152'。不同模型版本支持的值不同 */
  ARK_IMAGE_SIZE?: string
  /** 'b64_json'（默认，少一次外网回源）或 'url' */
  ARK_IMAGE_RESPONSE_FORMAT?: string
}

/**
 * 默认值可用环境变量覆盖。
 *
 * 这两个 ID 是「实测该 API Key 返回 200」后选定的，但**模型可用性随账号与
 * 开通状态而变**：方舟要求先在控制台开通模型，且同一模型在不同账号下可能
 * 返回 InvalidEndpointOrModel.NotFound 或 ModelNotOpen。
 * 报这两类错时，用 ARK_TEXT_MODEL / ARK_IMAGE_MODEL 换成你账号可用的 ID，
 * 不需要动代码。可用 ID 列表：GET {ARK_BASE_URL}/models
 */
const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const DEFAULT_TEXT_MODEL = 'doubao-seed-2-1-pro-260915'
const DEFAULT_IMAGE_MODEL = 'doubao-seedream-4-0-250828'

export class ArkError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'ArkError'
    this.status = status
  }
}

function resolveBase(env: ArkEnv): string {
  return (env.ARK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function requireKey(env: ArkEnv): string {
  const key = env.ARK_API_KEY?.trim()
  if (!key) {
    throw new ArkError(
      '未配置 ARK_API_KEY：本地请复制 .env.example 为 .env 并填入密钥；线上请在 Cloudflare Pages 的环境变量里配置。',
      500,
    )
  }
  return key
}

/** 把方舟返回的错误体压成一句人话，保留原始信息便于排查（403/404 多是模型 ID 或权限问题） */
function describeError(status: number, body: string): string {
  let detail = body.slice(0, 500)
  try {
    const parsed = JSON.parse(body)
    const err = parsed?.error ?? parsed
    if (typeof err === 'string') detail = err
    else if (err && typeof err === 'object') {
      detail = [err.message, err.code, err.type].filter((v) => typeof v === 'string' && v).join(' / ') || detail
    }
  } catch {
    // 非 JSON（网关 HTML 等），保留原文片段
  }
  return `方舟接口返回 ${status}：${detail}`
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

async function postJson(url: string, key: string, payload: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(payload),
  })
}

// ---------------------------------------------------------------- 诗词拆解

function buildDissectMessages(poem: string, title?: string, author?: string) {
  const schema = SCENE_FIELD_META.map((m) => `  "${m.key}": "${m.describe}"`).join(',\n')
  return [
    {
      role: 'system',
      content: [
        '你是中国古典诗词的图像化专家。你的任务是把一首诗词转译成一组用于 AI 绘画的结构化字段。',
        '要求：',
        '1. 只抽取诗中真实出现的意象与意境，不要添加诗中不存在的情节、人物或现代物件。',
        '2. 五个字段各自独立，职责不重叠：主体只写一个核心实体；环境写时空与陪衬景物；风格写绘画媒介与流派；光影写光源与色调；构图写取景与留白。',
        '3. 每个字段用简洁的中文短语表达，不要写成完整句子，不要出现"这首诗描写了"之类的说明性文字。',
        '4. 风格字段优先选择中国传统绘画语言（水墨写意 / 青绿山水 / 宋代院体工笔 / 淡彩没骨 等），除非原诗明显更适合别的画风。',
        '5. 因为图片会作为竖版文字卡片的底图，构图字段要主动包含留白与主体避让画面正中。',
        '只输出 JSON，不要输出任何解释、前后缀或 Markdown 代码块。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        title ? `题目：《${title}》` : '',
        author ? `作者：${author}` : '',
        '诗词正文：',
        poem,
        '',
        '请输出如下结构的 JSON（键名固定，值为中文字符串）：',
        `{\n${schema}\n}`,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}

/** 模型有时仍会套 Markdown 围栏或加前后缀，这里做一次容错剥离 */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

export async function dissectPoem(
  env: ArkEnv,
  input: { text: string; title?: string; author?: string },
): Promise<SceneFields> {
  const key = requireKey(env)
  const poem = input.text?.trim()
  if (!poem) throw new ArkError('正文为空，无法拆解', 400)

  const res = await postJson(`${resolveBase(env)}/chat/completions`, key, {
    model: env.ARK_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL,
    messages: buildDissectMessages(poem, input.title, input.author),
    // 拆字段是抽取任务，不需要创造性；json_object 让输出稳定可解析
    temperature: 0.3,
    response_format: { type: 'json_object' },
  })

  const body = await res.text()
  if (!res.ok) throw new ArkError(describeError(res.status, body), res.status === 401 ? 401 : 502)

  let content = ''
  try {
    const json = JSON.parse(body)
    content = json?.choices?.[0]?.message?.content ?? ''
  } catch {
    throw new ArkError('方舟返回的不是合法 JSON', 502)
  }
  if (!content) throw new ArkError('模型没有返回内容', 502)

  const parsed = parseJsonLoose(content)
  if (!parsed) throw new ArkError('模型输出无法解析为 JSON，可重试一次', 502)

  const scene = normalizeScene(parsed)
  if (!scene.subject && !scene.environment) {
    throw new ArkError('模型没有抽出有效的画面字段，可重试或手动填写', 502)
  }
  return scene
}

// ---------------------------------------------------------------- 背景图生成

export interface GeneratedImage {
  dataUrl: string
  model: string
  /** 模型实际采用的尺寸（部分模型会回传） */
  size?: string
}

/**
 * 按魔数判断真实图片类型。
 *
 * 实测方舟 b64_json 回的是 JPEG 字节（ff d8 ff e0 … JFIF），并不是 PNG。
 * 声明成 image/png 虽然浏览器会自行嗅探、照样能画进 canvas，但类型是错的：
 * 右键另存会得到扩展名与内容不符的文件，某些工具也会拒绝。故按字节判定。
 */
function sniffMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'image/webp'
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  return 'image/png'
}

/** 只解出 base64 开头的一小段用于嗅探；切片取 4 的整数倍，避免 padding 报错 */
function base64Head(b64: string, bytes: number): Uint8Array {
  const bin = atob(b64.slice(0, Math.ceil(bytes / 3) * 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function imageDataUrlFrom(json: any): { b64: string } | { remoteUrl: string } | null {
  const item = json?.data?.[0]
  if (!item) return null
  if (typeof item.b64_json === 'string' && item.b64_json) return { b64: item.b64_json }
  if (typeof item.url === 'string' && item.url) return { remoteUrl: item.url }
  return null
}

export async function generateImage(
  env: ArkEnv,
  input: { prompt: string; size?: string },
): Promise<GeneratedImage> {
  const key = requireKey(env)
  const prompt = input.prompt?.trim()
  if (!prompt) throw new ArkError('提示词为空', 400)

  const model = env.ARK_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL
  const size = input.size?.trim() || env.ARK_IMAGE_SIZE?.trim() || '2K'
  const responseFormat = env.ARK_IMAGE_RESPONSE_FORMAT?.trim() || 'b64_json'

  // 最小可用载荷。刻意保留 watermark: false——方舟默认会加「AI 生成」水印，
  // 那会直接烧进卡片背景，所以这里宁可让请求失败也不省略它。
  const basePayload: Record<string, unknown> = { model, prompt, size, watermark: false }

  // 这几个参数不同模型版本支持程度不一，属于可以舍弃的
  const fullPayload: Record<string, unknown> = {
    ...basePayload,
    // 只要单张图；显式关闭组图序列
    sequential_image_generation: 'disabled',
    stream: false,
    response_format: responseFormat,
  }

  const url = `${resolveBase(env)}/images/generations`
  let res = await postJson(url, key, fullPayload)

  // 400 时摘掉上面那几个可选参数重试一次。
  // 触发条件只认参数名本身：方舟对所有参数错误都返回 InvalidParameter 这个 code，
  // 若用 /invalid/i 去匹配，会把「prompt 太长」这类真实错误也误判成可重试，
  // 白白多打一次请求还掩盖真正的原因。
  if (res.status === 400) {
    const firstError = await res.text()
    if (/response_format|sequential_image_generation|\bstream\b/i.test(firstError)) {
      res = await postJson(url, key, basePayload)
      if (!res.ok) {
        throw new ArkError(describeError(res.status, await res.text()), 502)
      }
    } else {
      throw new ArkError(describeError(400, firstError), 502)
    }
  }

  const body = await res.text()
  if (!res.ok) throw new ArkError(describeError(res.status, body), res.status === 401 ? 401 : 502)

  let json: any
  try {
    json = JSON.parse(body)
  } catch {
    throw new ArkError('方舟返回的不是合法 JSON', 502)
  }

  const found = imageDataUrlFrom(json)
  if (!found) throw new ArkError('方舟响应里没有图片数据', 502)

  if ('b64' in found) {
    const mime = sniffMime(base64Head(found.b64, 16))
    return { dataUrl: `data:${mime};base64,${found.b64}`, model, size: json?.data?.[0]?.size }
  }

  // 回退路径：模型只给了 CDN 链接。这里在服务端回源取字节并转 data URL——
  // 既绕开浏览器 CORS，也避免远程图片污染导出用的 canvas。
  const imgRes = await fetch(found.remoteUrl)
  if (!imgRes.ok) throw new ArkError(`下载生成的图片失败：HTTP ${imgRes.status}`, 502)
  const buf = new Uint8Array(await imgRes.arrayBuffer())
  // 同样以字节为准，不轻信 CDN 的 content-type
  const mime = sniffMime(buf)
  return { dataUrl: `data:${mime};base64,${toBase64(buf)}`, model, size: json?.data?.[0]?.size }
}
