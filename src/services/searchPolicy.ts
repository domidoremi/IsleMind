import type { SearchProviderId, Settings, WebSearchMode } from '@/types'
import { st } from '@/i18n/service'
import { safeHttpUrl } from '@/utils/networkUrlSafety'

type SearchSettings = Pick<Settings, 'webSearchEnabled' | 'webSearchMode' | 'searchProvider' | 'customSearchEndpoint'>

export type SearchProviderCredentialFieldId =
  | 'tavilyApiKey'
  | 'googleSearchApiKey'
  | 'googleSearchCx'
  | 'bingSearchApiKey'

export interface SearchProviderCredentialField {
  id: SearchProviderCredentialFieldId
  label: string
  placeholder: string
  secureTextEntry?: boolean
}

export const SEARCH_PROVIDER_OPTIONS: SearchProviderId[] = ['native', 'tavily', 'google', 'bing', 'custom', 'off']
export const SEARCH_DIAGNOSTIC_QUERY = 'streaming response text delta'
export const SEARCH_PROVIDER_CREDENTIAL_FIELDS: SearchProviderCredentialField[] = [
  { id: 'tavilyApiKey', label: 'Tavily Key', placeholder: 'tvly-...', secureTextEntry: true },
  { id: 'googleSearchApiKey', label: 'Google Search Key', placeholder: 'Google API Key', secureTextEntry: true },
  { id: 'googleSearchCx', label: 'Google CX', placeholder: 'Programmable Search Engine cx' },
  { id: 'bingSearchApiKey', label: 'Bing / Azure Key', placeholder: st('contextPanel.bingKeyPlaceholder'), secureTextEntry: true },
]

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
      return st('searchPolicy.native')
    case 'tavily':
      return 'Tavily'
    case 'google':
      return 'Google'
    case 'bing':
      return 'Bing/Azure'
    case 'custom':
      return st('searchPolicy.custom')
    case 'off':
      return st('searchPolicy.off')
  }
}

export function getBingCompatibleEndpoint(settings: SearchSettings): string | null {
  return safeCustomSearchEndpoint(settings.customSearchEndpoint)
}

export function buildCustomSearchUrl(endpoint: string | undefined, query: string, limit: number): string | null {
  const safeEndpoint = safeCustomSearchEndpoint(endpoint)
  if (!safeEndpoint) return null
  const url = safeEndpoint
    .replace(/\{query\}/g, encodeURIComponent(query))
    .replace(/\{limit\}/g, String(limit))
  return isHttpEndpoint(url) ? url : null
}

export function safeCustomSearchEndpoint(endpoint: string | undefined): string | null {
  return safeHttpUrl(endpoint)
}

function isHttpEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
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
