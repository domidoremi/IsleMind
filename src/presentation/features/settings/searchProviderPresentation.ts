import type { WebSearchProviderId } from '@/modules/integrations'
import { st } from '@/i18n/service'

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

export const SEARCH_PROVIDER_CREDENTIAL_FIELDS: readonly SearchProviderCredentialField[] = Object.freeze([
  { id: 'tavilyApiKey', label: 'Tavily Key', placeholder: 'tvly-...', secureTextEntry: true },
  { id: 'googleSearchApiKey', label: 'Google Search Key', placeholder: 'Google API Key', secureTextEntry: true },
  { id: 'googleSearchCx', label: 'Google CX', placeholder: 'Programmable Search Engine cx' },
  { id: 'bingSearchApiKey', label: 'Bing / Azure Key', placeholder: st('contextPanel.bingKeyPlaceholder'), secureTextEntry: true },
])

export interface SearchProviderCredentialPresentation {
  fields: readonly SearchProviderCredentialField[]
  showEndpoint: boolean
  showBearerKey: boolean
}

export function searchProviderCredentialPresentation(provider: WebSearchProviderId): SearchProviderCredentialPresentation {
  const fieldIds: readonly SearchProviderCredentialFieldId[] = provider === 'tavily'
    ? ['tavilyApiKey']
    : provider === 'google'
      ? ['googleSearchApiKey', 'googleSearchCx']
      : provider === 'bing'
        ? ['bingSearchApiKey']
        : []
  return {
    fields: SEARCH_PROVIDER_CREDENTIAL_FIELDS.filter((field) => fieldIds.includes(field.id)),
    showEndpoint: provider === 'bing' || provider === 'custom',
    showBearerKey: provider === 'custom',
  }
}

export function searchProviderLabel(provider: WebSearchProviderId): string {
  switch (provider) {
    case 'islemind':
      return st('searchPolicy.islemind')
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
