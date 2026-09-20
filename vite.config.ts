import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { join } from 'node:path'
import { handleApi, type ApiRoute } from './shared/handler'
import type { ArkEnv } from './shared/arkServer'
import { openLibrary, type LibraryHandle } from './server/libraryDb'
import { handleLibrary } from './server/libraryApi'

/**
 * 本地开发用的方舟 API 中转。
 *
 * 前端只请求同源的 /api/*，密钥留在 Node 进程里（读 .env），
 * 因此既不会进 bundle，也不受方舟接口的 CORS 限制；
 * 生成的图片由服务端转成 data URL 回传，浏览器拿到的永远是同源数据。
 *
 * 线上对应实现是 functions/api/*.ts（Cloudflare Pages Functions），
 * 两边共用 shared/handler.ts，行为一致。
 */

/** 只声明用到的成员，省掉一个 @types/node 依赖 */
interface ReqLike {
  method?: string
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>
}

interface ResLike {
  statusCode: number
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

function sendJson(res: ResLike, status: number, json: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(json))
}

/** 用流式 decoder 逐块解码：中文是多字节，按块 decode 会在边界处截断成乱码 */
async function readJsonBody(req: ReqLike): Promise<unknown> {
  const raw = await readRawBody(req)
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

/** 读原始请求体（音频上传要二进制，不能当字符串处理） */
async function readBuffer(req: ReqLike): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function readRawBody(req: ReqLike): Promise<string> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let raw = ''
  for await (const chunk of req) {
    raw += decoder.decode(typeof chunk === 'string' ? encoder.encode(chunk) : chunk, { stream: true })
  }
  raw += decoder.decode()
  return raw
}

/**
 * 本地诗词库：SQLite + 真实音频文件，落在项目下的 `data/`。
 *
 * 为什么要有它：浏览器的 IndexedDB 是"浏览器代管的可回收存储"，磁盘紧张时可能被自动
 * 清理，用户清浏览数据也会一起没。数据放到项目目录里的真实文件之后，这些都不再影响它，
 * 而且整个库就是一个能拷走的 `library.sqlite` + 一个 `audio/` 文件夹。
 *
 * 代价（界面上要如实告诉用户）：**必须跑着这个本地服务**才能读到数据。所以
 * 线上静态部署时这条通道不存在，前端要能给出明确提示而不是静默空库。
 */
function libraryApi(): Plugin {
  return {
    name: 'yilin:library-api',
    configureServer(server) {
      const root = join(server.config.root, 'data')
      let lib: LibraryHandle | null = null
      const open = () => {
        if (!lib) lib = openLibrary(root)
        return lib
      }

      // 启动自检：说清数据在哪、用的是哪个数据库引擎。node:sqlite 是 Node 内置的，
      // 但从 23.4 起才不需要实验开关——版本不够时给出人话，而不是一句模块找不到。
      const [major, minor] = process.versions.node.split('.').map(Number)
      if (major < 23 || (major === 23 && minor < 4)) {
        server.config.logger.warn(
          `Node ${process.versions.node} 太旧：数据层用的 node:sqlite 需要 23.4+，请升级 Node`,
        )
      } else {
        server.config.logger.info(
          `  诗词库：data/library.sqlite（node:sqlite，Node ${process.versions.node} 内置）+ data/audio/ + data/images/`,
        )
      }

      server.middlewares.use('/api/library', (req, res, next) => {
        void (async () => {
          // 只接管 /api/library/*；根路径交给后面的中间件（Vite 自己）
          const url = new URL(req.url ?? '/', 'http://localhost')
          if (url.pathname === '/' || url.pathname === '') {
            next()
            return
          }
          const request = req as unknown as ReqLike & { method?: string; headers: Record<string, unknown> }
          try {
            const body =
              request.method === 'GET' || request.method === 'HEAD' ? Buffer.alloc(0) : await readBuffer(request)
            const response = handleLibrary(
              {
                method: request.method ?? 'GET',
                path: url.pathname,
                query: url.searchParams,
                body,
                contentType: String(request.headers['content-type'] ?? ''),
              },
              open(),
            )
            const out = res as unknown as ResLike & { setHeader(n: string, v: string): void; end(b?: unknown): void; statusCode: number }
            out.statusCode = response.status
            if (response.bytes) {
              out.setHeader('content-type', response.contentType ?? 'application/octet-stream')
              out.setHeader('cache-control', 'no-store')
              out.end(response.bytes)
            } else {
              out.setHeader('content-type', 'application/json; charset=utf-8')
              out.setHeader('cache-control', 'no-store')
              out.end(JSON.stringify(response.json ?? {}))
            }
          } catch (err) {
            sendJson(
              res as unknown as ResLike,
              500,
              { error: err instanceof Error ? err.message : String(err) },
            )
          }
        })()
      })

      // 退出时把 SQLite 关干净，避免留下 -wal 未合并
      server.httpServer?.on('close', () => {
        try {
          lib?.db.close()
        } catch {
          // 已经关了就算了
        }
      })
    },
  }
}

function arkApi(): Plugin {
  return {
    name: 'text2card:ark-api',
    configureServer(server) {
      // 第三个参数传 '' 表示读取所有变量（含无 VITE_ 前缀的 ARK_*）；
      // 真实环境变量优先于 .env 文件
      const env = { ...loadEnv(server.config.mode, server.config.root, ''), ...process.env } as ArkEnv

      const routes: ApiRoute[] = ['dissect', 'generate-image']
      for (const route of routes) {
        server.middlewares.use(`/api/${route}`, (req, res) => {
          void (async () => {
            const request = req as unknown as ReqLike
            const response = res as unknown as ResLike
            if (request.method !== 'POST') {
              sendJson(response, 405, { error: '只支持 POST' })
              return
            }
            let body: unknown
            try {
              body = await readJsonBody(request)
            } catch {
              sendJson(response, 400, { error: '请求体必须是合法 JSON' })
              return
            }
            const { status, json } = await handleApi(env, route, body)
            sendJson(response, status, json)
          })()
        })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), arkApi(), libraryApi()],
  server: {
    // Windows 上 node 把 localhost 解析为 ::1，只监听 IPv6 回环时
    // http://127.0.0.1:5173/ 会直接连不上；'::' 是双栈通配地址，
    // 同时覆盖 IPv4 / IPv6 回环。注意：这也会监听局域网网卡，
    // 首次启动可能出现 Windows 防火墙提示。
    host: '::',
    port: 5173,
    // 5173 被占用时直接报错退出，而不是静默改用 5174——
    // 否则浏览器打开 5173 只会看到连不上。
    strictPort: true,
    watch: {
      // 用轮询而不是原生文件事件。在这台机器上（D: 盘）原生 watcher 会漏事件：
      // 改完文件 HMR 不触发，dev server 继续吐**旧模块**——表现为「明明改了代码，
      // 浏览器里却没生效」，而且 curl 同一个模块拿到的还是旧内容，极难自查。
      // 轮询以一点 CPU 换「所见即所改」，开发期这笔买卖划算。
      usePolling: true,
      interval: 400,
    },
  },
})
