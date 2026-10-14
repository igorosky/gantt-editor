import { useCallback, useEffect, useState } from 'react'

export type PortfolioTab = 'overview' | 'roadmap' | 'workload' | 'people'

export const PORTFOLIO_TABS: PortfolioTab[] = ['overview', 'roadmap', 'workload', 'people']

export type Route =
  | { view: 'board' }
  | { view: 'portfolio'; tab: PortfolioTab }

// #/ board, #/portfolio/<tab>. Hash based so a view can be bookmarked and
// survives reload without any server routing.
export function parseHash(hash: string): Route {
  const m = /^#\/portfolio(?:\/(\w+))?/.exec(hash)
  if (!m) return { view: 'board' }
  const tab = PORTFOLIO_TABS.includes(m[1] as PortfolioTab) ? (m[1] as PortfolioTab) : 'overview'
  return { view: 'portfolio', tab }
}

export function routeHash(r: Route): string {
  return r.view === 'board' ? '#/' : `#/portfolio/${r.tab}`
}

export function useHashRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((r: Route) => {
    window.location.hash = routeHash(r)
  }, [])

  return [route, navigate]
}
