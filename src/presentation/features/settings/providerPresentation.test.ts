import type { AIProvider } from '@/types/providerContracts'

import {
  hasGenericProviderName,
  resolveProviderDisplayName,
  resolveProviderEndpointHost,
  resolveProviderSupplierDisclosure,
} from './providerPresentation'

function provider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'custom-provider',
    type: 'openai-compatible',
    name: 'OpenAI Compatible',
    apiKey: '',
    baseUrl: 'https://x666.me/v1',
    models: [],
    enabled: true,
    ...overrides,
  }
}

describe('provider presentation', () => {
  it('uses the endpoint host instead of presenting a protocol as the supplier name', () => {
    expect(resolveProviderDisplayName(provider(), 'Custom provider')).toBe('x666.me')
    expect(resolveProviderDisplayName(provider({ name: 'Anthropic Compatible', baseUrl: 'gateway.example.com/anthropic' }), 'Custom provider')).toBe('gateway.example.com')
  })

  it('preserves a user-defined supplier name', () => {
    expect(resolveProviderDisplayName(provider({ name: 'Team Gateway' }), 'Custom provider')).toBe('Team Gateway')
  })

  it('uses a localized fallback when no endpoint identity is available', () => {
    expect(resolveProviderDisplayName(provider({ baseUrl: undefined }), 'Custom provider')).toBe('Custom provider')
  })

  it('recognizes the generic custom endpoint identity without changing runtime data', () => {
    expect(hasGenericProviderName(provider({ name: 'custom-endpoint', presetId: 'custom-endpoint' }))).toBe(true)
    expect(resolveProviderEndpointHost('http://localhost:11434/v1')).toBe('localhost:11434')
  })

  it('keeps one supplier card visible until duplicate configurations are explicitly expanded', () => {
    expect(resolveProviderSupplierDisclosure(2, false, false)).toEqual({
      expandable: true,
      showConfigurations: false,
    })
    expect(resolveProviderSupplierDisclosure(2, true, false).showConfigurations).toBe(true)
    expect(resolveProviderSupplierDisclosure(1, true, false)).toEqual({
      expandable: false,
      showConfigurations: false,
    })
    expect(resolveProviderSupplierDisclosure(1, false, true).showConfigurations).toBe(true)
  })
})
