import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleApi, type ApiRoute } from './shared/handler'
import type { ArkEnv } from './shared/arkServer'

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
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let raw = ''
  for await (const chunk of req) {
    raw += decoder.decode(typeof chunk === 'string' ? encoder.encode(chunk) : chunk, { stream: true })
  }
  raw += decoder.decode()
  if (!raw.trim()) return {}
  return JSON.parse(raw)
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
  plugins: [react(), arkApi()],
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
  },
})
