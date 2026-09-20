/**
 * 本地诗词库的 HTTP 客户端。
 *
 * 数据现在住在 `data/library.sqlite` + `data/audio/`，由本机的 Node 服务（Vite 中间件）
 * 提供。这个模块只负责"怎么调接口"和"怎么判断服务没起来"——业务语义留在
 * `lib/snapshots.ts` 里，那一层的函数签名与数据形状都保持原样，上面所有界面代码不用改。
 *
 * **服务没起来是必须单独识别的情况**：这时若把它当成"没有数据"，用户会看到空库，
 * 以为卡片丢了。所以这里把"没响应/不是 JSON"归为 `offline`，由界面给出明确提示。
 */

const BASE = '/api/library'

export class LibraryApiError extends Error {
  status: number
  /** true = 本地服务没起来（而不是接口返回了错误） */
  offline: boolean
  constructor(message: string, status = 0, offline = false) {
    super(message)
    this.name = 'LibraryApiError'
    this.status = status
    this.offline = offline
  }
}

export interface LibraryStatus {
  ok: boolean
  dbFile: string
  audioDir: string
  cards: number
  audioFiles: number
  audioBytes: number
  dbBytes: number
}

async function request<T>(method: string, path: string, init?: { json?: unknown; blob?: Blob }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: init?.json !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.json !== undefined ? JSON.stringify(init.json) : init?.blob,
    })
  } catch {
    // fetch 抛异常 = 连不上（服务没跑）。这是最常见的情况，必须和"接口报错"分开
    throw new LibraryApiError('连不上本地数据库服务（npm run dev 没有在运行？）', 0, true)
  }
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    // 静态托管时会返回 index.html：同样是"这里没有本地服务"
    throw new LibraryApiError('这个地址没有本地数据库服务（页面可能来自静态部署）', res.status, true)
  }
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new LibraryApiError(data?.error || `接口 ${method} ${path} 失败`, res.status)
  return data
}

export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPut = <T>(path: string, json: unknown) => request<T>('PUT', path, { json })
export const apiPatch = <T>(path: string, json: unknown) => request<T>('PATCH', path, { json })
export const apiPost = <T>(path: string, json: unknown) => request<T>('POST', path, { json })
export const apiDelete = <T>(path: string) => request<T>('DELETE', path)
export const apiUpload = <T>(path: string, blob: Blob) => request<T>('PUT', path, { blob })

/** 音频下载要的是二进制，不能过 JSON 那条路 */
export async function apiDownload(path: string): Promise<Blob | null> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`)
  } catch {
    throw new LibraryApiError('连不上本地数据库服务（npm run dev 没有在运行？）', 0, true)
  }
  if (res.status === 404) return null
  if (!res.ok) throw new LibraryApiError(`下载失败（HTTP ${res.status}）`, res.status)
  return await res.blob()
}

/** 启动时探一次：服务在不在、库里有多少东西 */
export async function fetchLibraryStatus(): Promise<LibraryStatus> {
  return await apiGet<LibraryStatus>('/status')
}

/** 只想知道"通不通"，不想因异常中断启动流程 */
export async function probeLibraryServer(): Promise<{ ok: boolean; status?: LibraryStatus; error?: string; offline: boolean }> {
  try {
    return { ok: true, status: await fetchLibraryStatus(), offline: false }
  } catch (err) {
    const offline = err instanceof LibraryApiError ? err.offline : false
    return { ok: false, error: err instanceof Error ? err.message : String(err), offline }
  }
}
