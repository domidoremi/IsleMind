export function redirectSystemPath({ path, initial }: { path?: string; initial?: boolean }) {
  void initial
  const rawPath = typeof path === 'string' ? path.trim() : ''
  if (!rawPath) return '/'

  try {
    const url = new URL(rawPath, 'https://islemind.local')
    const host = url.hostname.toLowerCase()
    const pathname = url.pathname || ''
    const search = url.search || ''
    const withSearch = (target: string) => `${target}${search}`

    if (url.protocol === 'islemind:' && !host && (!pathname || pathname === '/')) return withSearch('/')
    if (host === 'chat' && (!pathname || pathname === '/')) return withSearch('/conversations')
    if (host === 'chat' && pathname && pathname !== '/') return withSearch(`/chat${pathname}`)
    if (host === 'settings' && (!pathname || pathname === '/')) return withSearch('/settings')
    if (host === 'settings' && isSettingsChildPath(pathname)) return withSearch(`/settings${pathname}`)
    if (host === 'source' && (!pathname || pathname === '/')) return withSearch('/source')
  } catch {
    if (rawPath === 'chat') return '/conversations'
    if (rawPath === 'settings') return '/settings'
  }

  return rawPath
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
  ].includes(pathname)
}
