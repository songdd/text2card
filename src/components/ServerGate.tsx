import { useEffect, useState } from 'react'
import { AlertTriangle, Database, Loader2, RefreshCw } from 'lucide-react'
import { probeLibraryServer, type LibraryStatus } from '../lib/libraryApi'

/**
 * 本地数据库服务的"门"。
 *
 * 为什么要有它：选 A 方案（SQLite 唯一数据源）之后，**没启动本地服务就读不到任何数据**。
 * 这时候如果照常渲染界面，用户看到的是一个空库——而空库和"数据丢了"在观感上完全一样，
 * 是最糟的失败方式。所以宁可挡在门口，把原因和解决办法直接写清楚。
 */
export interface ServerState {
  phase: 'checking' | 'ok' | 'down'
  status?: LibraryStatus
  error?: string
}

export function useLibraryServer(): ServerState & { retry: () => void } {
  const [state, setState] = useState<ServerState>({ phase: 'checking' })

  function check() {
    setState({ phase: 'checking' })
    void (async () => {
      const probe = await probeLibraryServer()
      setState(probe.ok ? { phase: 'ok', status: probe.status } : { phase: 'down', error: probe.error })
    })()
  }

  useEffect(() => {
    check()
  }, [])

  return { ...state, retry: check }
}

export function ServerDownScreen({
  error,
  onRetry,
}: {
  error?: string
  onRetry: () => void
}) {
  const [retrying, setRetrying] = useState(false)
  return (
    <div className="canvas-bg flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-amber-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0">
            <h2 className="font-serif text-lg font-semibold text-ink-800">本地数据库服务没有运行</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-600">
              诗词卡片、音频、字幕都存在你电脑上的真实文件里，由本机的 Node 服务提供：
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-ink-50 px-2.5 py-2 text-[11px] leading-relaxed text-ink-600">
              data/library.sqlite{'\n'}data/audio/…
            </pre>
            <p className="mt-2 text-xs leading-relaxed text-ink-600">
              所以打开页面时必须让它跑着。在项目目录执行：
            </p>
            <pre className="mt-1.5 rounded-md bg-ink-800 px-2.5 py-2 text-[11px] text-white">npm run dev</pre>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
              {error ? `探测结果：${error}` : ''}
              {error ? <br /> : null}
              如果你是从别的网址（静态部署）打开这个页面，那台服务器上没有本地数据库服务——
              数据不会在那里，请用本机地址打开。
            </p>
            <button
              onClick={() => {
                setRetrying(true)
                onRetry()
                // 服务刚起来时给它一点时间；按钮状态不必精确，重试本身是幂等的
                setTimeout(() => setRetrying(false), 1500)
              }}
              disabled={retrying}
              className="mt-3 flex items-center gap-2 rounded-md bg-ink-800 px-3 py-2 text-sm font-medium text-white transition hover:bg-ink-900 disabled:opacity-50"
            >
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              重试
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BootScreen() {
  return (
    <div className="canvas-bg flex min-h-0 flex-1 items-center justify-center gap-2 p-6 text-sm text-ink-500">
      <Database className="h-4 w-4 text-ink-400" />
      <Loader2 className="h-4 w-4 animate-spin text-ink-400" />
      正在连接本地数据库…
    </div>
  )
}
