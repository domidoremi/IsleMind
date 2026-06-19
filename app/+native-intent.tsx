export function redirectSystemPath({ path, initial }: { path?: string; initial?: boolean }) {
  void initial
  const rawPath = typeof path === 'string' ? path.trim() : ''
  if (!rawPath) return '/'

  try {
    const url = new URL(rawPath, 'https://islemind.local')
    const host = url.hostname.toLowerCase()
    const pathname = url.pathname || ''

    if (url.protocol === 'islemind:' && !host && (!pathname || pathname === '/')) return '/'
    if (host === 'chat' && (!pathname || pathname === '/')) return '/conversations'
    if (host === 'chat' && pathname && pathname !== '/') return `/chat${pathname}`
    if (host === 'settings' && (!pathname || pathname === '/')) return '/settings'
    if (host === 'settings' && pathname === '/providers') return '/settings/providers'
  } catch {
    if (rawPath === 'chat') return '/conversations'
    if (rawPath === 'settings') return '/settings'
  }

  return rawPath
}
