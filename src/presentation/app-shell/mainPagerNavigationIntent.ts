type MainPagerPath = '/' | '/conversations' | '/settings'

interface MainPagerNavigationIntent {
  readonly sequence: number
  readonly pathname?: MainPagerPath
}

const initialIntent: MainPagerNavigationIntent = { sequence: 0 }
let currentIntent = initialIntent
const listeners = new Set<() => void>()

export function recordMainPagerNavigationIntent(pathname: string): void {
  if (pathname !== '/' && pathname !== '/conversations' && pathname !== '/settings') return
  currentIntent = { sequence: currentIntent.sequence + 1, pathname }
  for (const listener of listeners) listener()
}

export function subscribeMainPagerNavigationIntent(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getMainPagerNavigationIntent(): MainPagerNavigationIntent {
  return currentIntent
}

export function getInitialMainPagerNavigationIntent(): MainPagerNavigationIntent {
  return initialIntent
}
