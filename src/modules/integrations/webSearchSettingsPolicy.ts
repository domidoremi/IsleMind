import {
  WEB_SEARCH_PROVIDER_IDS,
  type WebSearchProviderId,
} from './webSearchProviderAdapter'

export type LegacyWebSearchMode = 'native' | 'tavily' | 'off'

export interface WebSearchSettingsPolicyInput {
  webSearchEnabled?: boolean
  webSearchMode?: LegacyWebSearchMode
  searchProvider?: WebSearchProviderId
  customSearchEndpoint?: string
}

export const SEARCH_PROVIDER_OPTIONS: readonly WebSearchProviderId[] = Object.freeze([
  ...WEB_SEARCH_PROVIDER_IDS.filter((provider) => provider !== 'off'),
  'off',
])

export const SEARCH_DIAGNOSTIC_QUERY = 'streaming response text delta'

export function resolveSearchProvider(
  settings: WebSearchSettingsPolicyInput,
): WebSearchProviderId {
  if (!settings.webSearchEnabled) return 'off'
  return settings.searchProvider ?? searchProviderFromLegacyMode(settings.webSearchMode)
}

export function legacySearchModeForProvider(
  provider: WebSearchProviderId,
): LegacyWebSearchMode {
  if (provider === 'native') return 'native'
  if (provider === 'off') return 'off'
  return 'tavily'
}

export function getBingCompatibleEndpoint(
  settings: Pick<WebSearchSettingsPolicyInput, 'customSearchEndpoint'>,
): string | null {
  return safeCustomSearchEndpoint(settings.customSearchEndpoint)
}

export function buildCustomSearchUrl(
  endpoint: string | undefined,
  query: string,
  limit: number,
): string | null {
  const safeEndpoint = safeCustomSearchEndpoint(endpoint)
  if (!safeEndpoint) return null
  const url = safeEndpoint
    .replace(/\{query\}/g, encodeURIComponent(query))
    .replace(/\{limit\}/g, String(limit))
  return isHttpEndpoint(url) ? url : null
}

export function safeCustomSearchEndpoint(endpoint: string | undefined): string | null {
  const trimmed = endpoint?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return trimmed
  } catch {
    return null
  }
}

function isHttpEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function searchProviderFromLegacyMode(
  mode: LegacyWebSearchMode | undefined,
): WebSearchProviderId {
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
