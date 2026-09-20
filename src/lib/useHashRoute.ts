import { useCallback, useEffect, useState } from 'react'

export type Page = 'edit' | 'library'

function readHash(): Page {
  return window.location.hash.replace(/^#\/?/, '') === 'library' ? 'library' : 'edit'
}

/**
 * 极简 hash 路由。
 *
 * 只有两个平级页面，引入 react-router 不划算；而用纯 state 切换又会丢掉
 * 「刷新后还停在管理页」和「可分享链接」。hash 路由两个问题都解决，
 * 静态托管（Cloudflare Pages）也不会像 history 路由那样 404。
 */
export function useHashRoute(): [Page, (page: Page) => void] {
  const [page, setPage] = useState<Page>(() =>
    typeof window === 'undefined' ? 'edit' : readHash(),
  )

  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = useCallback((next: Page) => {
    const hash = next === 'library' ? '#/library' : '#/edit'
    if (window.location.hash !== hash) window.location.hash = hash
    else setPage(next)
  }, [])

  return [page, go]
}
