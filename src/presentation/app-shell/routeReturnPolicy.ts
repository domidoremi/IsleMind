export type RouteReturnIntent = 'chat' | 'history' | 'settings'

export type RouteReturnPath = '/' | '/conversations' | '/settings'

export type RouteReturnAction =
  | { kind: 'back' }
  | { kind: 'replace'; pathname: RouteReturnPath }

const ROUTE_RETURN_PATH_BY_INTENT: Readonly<Record<RouteReturnIntent, RouteReturnPath>> = {
  chat: '/',
  history: '/conversations',
  settings: '/settings',
}

export function resolveRouteReturnIntent(value: string | readonly string[] | undefined): RouteReturnIntent | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate === 'chat' || candidate === 'history' || candidate === 'settings') return candidate
  return undefined
}

export function resolveConversationReturnAction(
  value: string | readonly string[] | undefined,
  canGoBack: boolean,
): RouteReturnAction {
  return resolveReturnAction(value, canGoBack, 'history')
}

export function resolveSettingsChildReturnAction(
  value: string | readonly string[] | undefined,
  canGoBack: boolean,
): RouteReturnAction {
  return resolveReturnAction(value, canGoBack, 'settings')
}

function resolveReturnAction(
  value: string | readonly string[] | undefined,
  canGoBack: boolean,
  fallbackIntent: RouteReturnIntent,
): RouteReturnAction {
  const intent = resolveRouteReturnIntent(value)
  if (intent && canGoBack) return { kind: 'back' }
  return {
    kind: 'replace',
    pathname: ROUTE_RETURN_PATH_BY_INTENT[intent ?? fallbackIntent],
  }
}
