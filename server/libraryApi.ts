import {
  clearCards,
  clearKv,
  deleteAudioFile,
  deleteCard,
  deleteKv,
  getCard,
  listCards,
  listKv,
  putCard,
  putKv,
  readAudio,
  stats,
  writeAudio,
  type LibraryHandle,
  type SnapshotRecord,
} from './libraryDb'

/**
 * 本地诗词库的 HTTP 接口。
 *
 * 这一层刻意做成**薄且纯**：输入一个请求描述，返回一个响应描述，不碰 Node 的
 * req/res——这样它既能挂在 Vite 开发中间件上，也方便日后放到别的宿主里，
 * 还能用普通函数调用来做测试。
 *
 * 路由一览：
 *   GET    /status                     库状态（路径、卡片数、音频文件数与体积）
 *   GET    /cards                      全部卡片
 *   GET    /cards/:id                  单张
 *   PUT    /cards/:id                  写入/覆盖（body 是完整卡片）
 *   PATCH  /cards/:id                  局部更新（tags / audio；audio 里传 null = 删除该键）
 *   DELETE /cards/:id                  删除（连带音频文件）
 *   POST   /cards/clear                清空全部
 *   POST   /cards/add-tags             批量加标签 { ids, add }
 *   GET    /audio/:id                  音频二进制
 *   PUT    /audio/:id?name=xx.mp3      上传音频二进制
 *   DELETE /audio/:id                  删除音频文件
 *   GET    /kv/:store                  列表（draft / playlists / tagPresets）
 *   PUT    /kv/:store/:id              写入一条
 *   DELETE /kv/:store/:id              删除一条
 *   POST   /kv/:store/clear            清空某个小仓库
 */

export interface ApiRequest {
  method: string
  /** `/api/library` 之后的路径，例如 `/cards/abc` */
  path: string
  query: URLSearchParams
  /** 原始请求体 */
  body: Buffer
  /** 请求体的 content-type，用于区分 JSON 与二进制 */
  contentType: string
}

export interface ApiResponse {
  status: number
  json?: unknown
  bytes?: Buffer
  contentType?: string
}

const json = (status: number, value: unknown): ApiResponse => ({ status, json: value })
const ok = (value: unknown = { ok: true }): ApiResponse => json(200, value)

/** 与服务端一致的上限（客户端也有一份，见 src/lib/snapshots.ts） */
const MAX_AUDIO_BYTES = 200 * 1024 * 1024

function parseJsonBody<T>(req: ApiRequest): T {
  const text = req.body.toString('utf8')
  if (!text.trim()) throw new Error('请求体为空')
  return JSON.parse(text) as T
}

/** null 表示"删掉这个键"，其余按值合并——前端用 undefined 表达删除，JSON 里只能传 null */
function mergeAudio(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (patch === null) return undefined
  const next: Record<string, unknown> = { ...(current ?? {}), ...patch }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
  }
  if (next.lyricText === undefined) delete next.lyricText
  return next
}

/** 把形如 `/cards/abc` 的路径拆成段（已去掉前缀与查询串） */
function segments(path: string): string[] {
  return path.split('/').filter(Boolean).map(decodeURIComponent)
}

export function handleLibrary(req: ApiRequest, lib: LibraryHandle): ApiResponse {
  const parts = segments(req.path)
  const method = req.method.toUpperCase()

  // ---- 状态 ----
  if (parts[0] === 'status' && method === 'GET') {
    return json(200, { ok: true, dbFile: lib.dbFile, audioDir: lib.audioDir, ...stats(lib) })
  }

  // ---- 卡片 ----
  if (parts[0] === 'cards') {
    // /cards
    if (parts.length === 1) {
      if (method === 'GET') return json(200, { cards: listCards(lib) })
      return json(405, { error: '请用 PUT /cards/:id 写入卡片' })
    }

    const second = parts[1]

    // /cards/clear
    if (second === 'clear' && parts.length === 2 && method === 'POST') {
      clearCards(lib)
      return ok({ cleared: true })
    }

    // /cards/add-tags
    if (second === 'add-tags' && parts.length === 2 && method === 'POST') {
      const body = parseJsonBody<{ ids?: string[]; add?: string[] }>(req)
      const ids = body.ids ?? []
      const add = (body.add ?? []).map((t) => String(t).trim()).filter(Boolean)
      const changed: SnapshotRecord[] = []
      for (const id of ids) {
        const card = getCard(lib, id)
        if (!card) continue
        const before: string[] = Array.isArray(card.state.tags) ? (card.state.tags as string[]) : []
        const merged: string[] = [...before]
        for (const tag of add) {
          if (!merged.some((t) => t.toLowerCase() === tag.toLowerCase())) merged.push(tag)
        }
        if (merged.length === before.length) continue
        const next: SnapshotRecord = { ...card, state: { ...card.state, tags: merged } }
        putCard(lib, next)
        changed.push(next)
      }
      return ok({ changed })
    }

    // /cards/:id
    if (parts.length === 2) {
      const id = second
      if (method === 'GET') {
        const card = getCard(lib, id)
        return card ? json(200, { card }) : json(404, { error: '卡片不存在' })
      }
      if (method === 'PUT') {
        const record = parseJsonBody<SnapshotRecord>(req)
        if (!record?.id) return json(400, { error: '缺少 id' })
        if (record.id !== id) return json(400, { error: 'id 与路径不一致' })
        putCard(lib, record)
        return ok({ card: record })
      }
      if (method === 'PATCH') {
        const card = getCard(lib, id)
        if (!card) return json(404, { error: '卡片不存在' })
        const body = parseJsonBody<{
          tags?: string[]
          audio?: Record<string, unknown> | null
          state?: Record<string, unknown>
          thumb?: string | null
        }>(req)
        let next: SnapshotRecord = { ...card }
        if (body.tags) next = { ...next, state: { ...next.state, tags: body.tags } }
        if (body.state) next = { ...next, state: { ...next.state, ...body.state } }
        if (body.thumb !== undefined) next = { ...next, thumb: body.thumb ?? undefined }
        if (body.audio !== undefined) {
          const merged = mergeAudio(card.audio as Record<string, unknown> | undefined, body.audio)
          next = { ...next, audio: merged }
          if (!merged) deleteAudioFile(lib, id)
        }
        putCard(lib, next)
        return ok({ card: next })
      }
      if (method === 'DELETE') {
        if (!getCard(lib, id)) return json(404, { error: '卡片不存在' })
        deleteCard(lib, id)
        return ok({ deleted: id })
      }
      return json(405, { error: `不支持的方法 ${method}` })
    }
  }

  // ---- 音频 ----
  if (parts[0] === 'audio' && parts.length === 2) {
    const id = parts[1]
    if (method === 'GET') {
      const found = readAudio(lib, id)
      if (!found) return json(404, { error: '这条卡片没有音频文件' })
      const meta = getCard(lib, id)?.audio as { type?: string } | undefined
      return { status: 200, bytes: found.bytes, contentType: meta?.type || 'application/octet-stream' }
    }
    if (method === 'PUT') {
      if (!req.body.length) return json(400, { error: '请求体为空' })
      // 客户端会先拦一道，这里再拦一道：服务端不能假设调用方守规矩
      if (req.body.length > MAX_AUDIO_BYTES) {
        return json(413, { error: `音频超过 ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB 上限` })
      }
      const name = req.query.get('name') || `${id}.bin`
      const { size } = writeAudio(lib, id, name, req.body)
      return ok({ file: name, size })
    }
    if (method === 'DELETE') {
      deleteAudioFile(lib, id)
      return ok({ deleted: id })
    }
  }

  // ---- 小仓库（draft / playlists / tagPresets）----
  if (parts[0] === 'kv' && parts.length >= 2) {
    const store = parts[1]
    if (!['draft', 'playlists', 'tagPresets'].includes(store)) {
      return json(400, { error: `未知的小仓库：${store}` })
    }
    if (parts.length === 2) {
      if (method === 'GET') return json(200, { items: listKv(lib, store) })
      return json(405, { error: '请用 PUT /kv/:store/:id' })
    }
    if (parts[2] === 'clear' && parts.length === 3 && method === 'POST') {
      clearKv(lib, store)
      return ok({ cleared: store })
    }
    const id = parts[2]
    if (method === 'PUT') {
      putKv(lib, store, id, parseJsonBody<unknown>(req))
      return ok({ id })
    }
    if (method === 'DELETE') {
      deleteKv(lib, store, id)
      return ok({ deleted: id })
    }
  }

  return json(404, { error: `没有这个接口：${method} ${req.path}` })
}
