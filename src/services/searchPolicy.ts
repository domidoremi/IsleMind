import type { SearchProviderId, Settings, WebSearchMode } from '@/types'

type SearchSettings = Pick<Settings, 'webSearchEnabled' | 'webSearchMode' | 'searchProvider' | 'customSearchEndpoint'>

export function resolveSearchProvider(settings: SearchSettings): SearchProviderId {
  if (!settings.webSearchEnabled) return 'off'
  return settings.searchProvider ?? searchProviderFromLegacyMode(settings.webSearchMode)
}

export function legacySearchModeForProvider(provider: SearchProviderId): WebSearchMode {
  if (provider === 'native') return 'native'
  if (provider === 'off') return 'off'
  return 'tavily'
}

export function searchProviderLabel(provider: SearchProviderId): string {
  switch (provider) {
    case 'native':
      return '原生'
    case 'tavily':
      return 'Tavily'
    case 'google':
      return 'Google'
    case 'bing':
      return 'Bing/Azure'
    case 'custom':
      return '自定义'
    case 'off':
      return '关闭'
  }
}

export function getBingCompatibleEndpoint(settings: SearchSettings): string | null {
  const endpoint = settings.customSearchEndpoint?.trim()
  return endpoint || null
}

function searchProviderFromLegacyMode(mode: WebSearchMode | undefined): SearchProviderId {
  switch (mode) {
    case 'native':
      return 'native'
    case 'tavily':
      return 'tavily'
    case 'off':
    default:
      return 'off'
  }
}
