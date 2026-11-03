import { recordMainPagerNavigationIntent } from '@/presentation/app-shell/mainPagerNavigationIntent'

export function redirectSystemPath({ path, initial }: { path?: string; initial?: boolean }) {
  const rawPath = typeof path === 'string' ? path.trim() : ''
  const withIntent = (target: string) => {
    if (initial === false) recordMainPagerNavigationIntent(target.split('?')[0])
    return target
  }
  if (!rawPath) return withIntent('/')

  try {
    const url = new URL(rawPath, 'https://islemind.local')
    const host = url.hostname.toLowerCase()
    const pathname = url.pathname || ''
    const search = url.search || ''
    const withSearch = (target: string) => withIntent(`${target}${search}`)

    if (url.protocol === 'islemind:' && !host && (!pathname || pathname === '/')) return withSearch('/')
    if (host === 'home' && (!pathname || pathname === '/')) return withSearch('/')
    if (host === 'chat' && (!pathname || pathname === '/')) return withSearch('/conversations')
    if (host === 'chat' && pathname && pathname !== '/') return withSearch(`/chat${pathname}`)
    if (host === 'agent' && (!pathname || pathname === '/')) return withSearch('/')
    if ((host === 'companion' || host === 'tavern') && (!pathname || pathname === '/')) return withSearch('/')
    if (host === 'islemind.local' && ['/agent', '/companion', '/tavern'].includes(pathname)) return withSearch('/')
    if (host === 'settings' && (!pathname || pathname === '/')) return withSearch('/settings')
    if (host === 'settings' && isSettingsChildPath(pathname)) return withSearch(`/settings${pathname}`)
    if (host === 'source' && (!pathname || pathname === '/')) return withSearch('/source')
  } catch {
    if (rawPath === 'chat') return withIntent('/conversations')
    if (rawPath === 'home') return withIntent('/')
    if (rawPath === 'agent') return withIntent('/')
    if (rawPath === 'companion' || rawPath === 'tavern') return withIntent('/')
    if (rawPath === 'settings') return withIntent('/settings')
  }

  return withIntent(rawPath)
}

function isSettingsChildPath(pathname: string) {
  return [
    '/context',
    '/memory',
    '/knowledge',
    '/preferences',
    '/skills',
    '/mcp',
    '/providers',
    '/usage',
  ].includes(pathname)
}
