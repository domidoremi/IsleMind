import { router } from 'expo-router'

export type ChatSettingsRoutePath = '/settings/providers' | '/settings/knowledge' | '/settings/skills' | '/settings/memory'

export function pushChatSettingsRoute(pathname: ChatSettingsRoutePath, params?: Record<string, string>) {
  const defer = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback: (timestamp: number) => void) => setTimeout(() => callback(Date.now()), 0)
  defer(() => {
    router.push(params ? { pathname, params } : { pathname })
  })
}
