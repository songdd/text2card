import {
  clearCards,
  clearKv,
  deleteAudioFile,
  deleteCard,
  deleteKv,
  getCard,
  inlineBackground,
  listCards,
  listKv,
  putCard,
  putKv,
  readAudio,
  readDraftBackground,
  stats,
  writeAudio,
  writeDraftBackground,
  type LibraryHandle,
  type SnapshotRecord,
} from './libraryDb'
import { dataUrlBytes } from '../shared/scene'

/**
 * 本地诗词库的 HTTP 接口。
 *
 * 这一层刻意做成**薄且纯**：输入一个请求描述，返回一个响应描述，不碰 Node 的
 * req/res——这样它既能挂在 Vite 开发中间件上，也方便日后放到别的宿主里，
 * 还能用普通函数调用来做测试。
 *
 * 路由一览：
 *   GET    /status                     库状态（路径、卡片数、音频文件数与体积）
 *   GET    /cards                      全部卡片（**配图只给体积，不给图**，见 slimCard）
 *   GET    /cards/:id                  单张（含完整配图，按需取图就走它）
 *   PUT    /cards/:id                  写入/覆盖（body 是完整卡片）
 *   PATCH  /cards/:id                  局部更新（tags / audio / thumb；audio 里传 null = 删除该键）
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

/**
 * 列表用的是**瘦身版**卡片：配图本身（一张 1–3MB）**存在 data/images/ 的文件里**，
 * 行里只有 `{ scrim, bytes, ext }`，列表也只下发这个体积数字。
 *
 * 为什么：列表页只画 240px 的缩略图（`thumb`），把整库配图一起返回的话，8 张卡片
 * 一次就是 13MB 打底、几十张就上百 MB——每开一次管理页都要搬一遍、解析一遍。
 * 要看大图／导出／备份时再按需 `GET /cards/:id` 取整张（那时服务端才去读文件）。
 *
 * 空 `dataUrl` + 有 `bytes` = 这张卡有配图，图在文件里。前端据此判断"有配图"，
 * 所以这个形状是接口契约的一部分，不要改成把 `background` 直接抹掉。
 */
function slimCard(card: SnapshotRecord): SnapshotRecord {
  const bg = card.state?.background as { dataUrl?: string; scrim?: number; bytes?: number; ext?: string } | null | undefined
  if (!bg) return card
  // 正常情况库里本来就没有内联图；这里只是兜一道：万一有（迁移失败的行），
  // 也不能让它随列表发出去
  if (!bg.dataUrl) return card
  return {
    ...card,
    state: { ...card.state, background: { scrim: bg.scrim, dataUrl: '', bytes: dataUrlBytes(bg.dataUrl) } },
  }
}

/**
 * 写入时保住已有配图。
 *
 * 列表接口不下发配图，所以"从列表载入编辑页、这期间图还没取回来"是正常中间态——
 * 此时 state 里的 dataUrl 是空的，直接存下去会把配图悄悄抹掉。空串一律当作
 * "图没取回来"（文件还在 data/images/ 里），沿用原来那份元信息；真要删图是
 * `background: null`，那条路照常生效（会连文件一起删）。
 */
function keepExistingBackground(existing: SnapshotRecord | null, next: SnapshotRecord): SnapshotRecord {
  const after = next.state?.background as
    | { dataUrl?: string; scrim?: number; bytes?: number; ext?: string }
    | null
    | undefined
  if (!after) return next // 明确删图
  if (after.dataUrl) return next // 带了图，putCard 会把它落成文件
  const before = existing?.state?.background as { scrim?: number; bytes?: number; ext?: string } | null | undefined
  if (!before?.bytes) return next // 本来就没图
  return {
    ...next,
    state: {
      ...next.state,
      background: {
        dataUrl: '',
        scrim: after.scrim ?? before.scrim,
        bytes: before.bytes,
        ext: before.ext,
      },
    },
  }
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
      if (method === 'GET') return json(200, { cards: listCards(lib).map(slimCard) })
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
        // 只有这一条路会把配图读出来内联成 data URL（详情/导出/备份走它）
        return card ? json(200, { card: inlineBackground(lib, card) }) : json(404, { error: '卡片不存在' })
      }
      if (method === 'PUT') {
        const record = parseJsonBody<SnapshotRecord>(req)
        if (!record?.id) return json(400, { error: '缺少 id' })
        if (record.id !== id) return json(400, { error: 'id 与路径不一致' })
        const stored = keepExistingBackground(getCard(lib, id), record)
        putCard(lib, stored)
        return ok({ card: stored })
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
      const meta = getCard(lib, id)?.audio as { type?: string; name?: string } | undefined
      // 按元信息里的文件名直接定位，不再靠"扫目录里第一个匹配"——
      // 否则刚写完新文件、旧文件还没删掉的那一瞬间可能读到旧的那条
      const found = readAudio(lib, id, meta?.name)
      if (!found) return json(404, { error: '这条卡片没有音频文件' })
      return { status: 200, bytes: found.bytes, contentType: meta?.type || 'application/octet-stream' }
    }
    /**
     * 上传音频**并同时落库**（一次请求完成关联）。
     *
     * 以前前端要打三次：读卡片 → 传文件 → 写元信息。HTTP 没有跨资源事务，第三步
     * 一失败就留下一个"没有元信息的音频文件"——界面上看不见、只有扫目录才发现。
     * 现在顺序是"先写新文件（不动旧文件）→ 再落库 → 最后删旧文件"：
     * 中间任何一步失败都能退回去，不会丢用户已有的音频。
     */
    if (method === 'PUT') {
      if (!req.body.length) return json(400, { error: '请求体为空' })
      // 客户端会先拦一道，这里再拦一道：服务端不能假设调用方守规矩
      if (req.body.length > MAX_AUDIO_BYTES) {
        return json(413, { error: `音频超过 ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)}MB 上限` })
      }
      const card = getCard(lib, id)
      if (!card) return json(404, { error: '卡片不存在，音频没有归属' })
      const name = req.query.get('name') || `${id}.bin`
      const durationRaw = req.query.get('duration')
      const duration = durationRaw !== null && durationRaw !== '' ? Number(durationRaw) : undefined
      const previous = (card.audio ?? null) as Record<string, unknown> | null
      const previousFile = typeof previous?.name === 'string' ? previous.name : null

      const written = writeAudio(lib, id, name, req.body)
      const meta: Record<string, unknown> = {
        // 合并旧元信息：歌词时间轴、偏移这些不属于文件本身，换文件时不该丢
        ...(previous ?? {}),
        name,
        type: req.contentType && req.contentType !== 'application/octet-stream' ? req.contentType : (previous?.type ?? ''),
        size: written.size,
        updatedAt: Date.now(),
      }
      if (duration !== undefined && Number.isFinite(duration)) meta.duration = duration
      else delete meta.duration // 换了文件，旧时长不再作数

      try {
        const next = putCard(lib, { ...card, audio: meta })
        // 落库成功之后才清理旧文件：只保留这次写进去的那个文件名
        deleteAudioFile(lib, id, [name])
        return ok({ card: next, file: name, size: written.size })
      } catch (err) {
        // 落库失败：把刚写的新文件删掉，旧文件原封不动 —— 用户手上的音频不受影响
        deleteAudioFile(lib, id, previousFile ? [previousFile] : [])
        return json(500, {
          error: `音频已上传但元信息写入失败（原音频未受影响）：${err instanceof Error ? err.message : String(err)}`,
        })
      }
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
      if (method === 'GET') {
        // 草稿配图存在文件里，读的时候才补成 data URL（编辑器打开时要还原上一次那张图）
        const items = listKv<{ id?: string }>(lib, store).map((item) =>
          store === 'draft' && item?.id === 'background' ? (readDraftBackground(lib) as { id?: string }) : item,
        )
        return json(200, { items })
      }
      return json(405, { error: '请用 PUT /kv/:store/:id' })
    }
    if (parts[2] === 'clear' && parts.length === 3 && method === 'POST') {
      clearKv(lib, store)
      return ok({ cleared: store })
    }
    const id = parts[2]
    if (method === 'PUT') {
      const body = parseJsonBody<unknown>(req)
      if (store === 'draft' && id === 'background') {
        writeDraftBackground(lib, body)
        return ok({ id })
      }
      putKv(lib, store, id, body)
      return ok({ id })
    }
    if (method === 'DELETE') {
      deleteKv(lib, store, id)
      return ok({ deleted: id })
    }
  }

  return json(404, { error: `没有这个接口：${method} ${req.path}` })
}
