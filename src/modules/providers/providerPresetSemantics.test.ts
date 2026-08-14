import {
  getProviderCompatibilityEvidence,
} from './providerCompatibilityCatalog'
import {
  createProviderConfigPolicy,
} from './providerConfigPolicy'
import {
  createProviderRegistry,
  PROVIDER_PRESETS,
  PROVIDER_VENDOR_PRESETS,
} from './providerRegistry'

describe('provider preset semantics', () => {
  it('contains supplier identities only', () => {
    const presetIds = PROVIDER_PRESETS.map((preset) => preset.id)
    expect(PROVIDER_VENDOR_PRESETS).toEqual(PROVIDER_PRESETS)
    expect(presetIds).toContain('custom-endpoint')
    expect(PROVIDER_PRESETS).toHaveLength(new Set(presetIds).size)
    expect(getProviderCompatibilityEvidence('custom-endpoint')).toMatchObject({
      officialDocs: [],
      endpointFamilies: [],
      behaviorDocs: [],
    })
  })

  it('selects a wire protocol separately for custom endpoints', () => {
    const policy = createProviderConfigPolicy({
      resolvePreset: (presetId) => PROVIDER_PRESETS.find((preset) => preset.id === presetId)!,
    })

    expect(policy.resolveProviderConfigDraft({ provider: {}, presetId: 'custom-endpoint' })).toMatchObject({
      presetId: 'custom-endpoint',
      isProtocolSelectable: true,
      baseUrl: '',
      wireProtocol: 'openai-compatible',
    })
    expect(policy.resolveProviderConfigDraft({ provider: {}, presetId: 'openai' }).isProtocolSelectable).toBe(false)
  })

  it('applies both protocols through the custom supplier identity', () => {
    const registry = createProviderRegistry({
      translate: (key) => key,
      configurationIssue: () => null,
      resolveModelAccess: () => ({ allowed: true }),
      fetch,
    })
    expect(registry.applyProviderPreset({
      id: 'custom-anthropic-endpoint',
      baseUrl: 'https://gateway.example/messages',
      wireProtocol: 'anthropic-compatible',
      models: [],
    }, 'custom-endpoint')).toMatchObject({
      presetId: 'custom-endpoint',
      detectedPresetId: 'custom-endpoint',
      wireProtocol: 'anthropic-compatible',
      type: 'openai-compatible',
    })
  })

  it('detects an unknown supplier separately from its wire protocol', () => {
    const registry = createProviderRegistry({
      translate: (key) => key,
      configurationIssue: () => null,
      resolveModelAccess: () => ({ allowed: true }),
      fetch,
    })

    expect(registry.detectProviderPreset({ baseUrl: 'https://gateway.example/v1' })).toMatchObject({
      presetId: 'custom-endpoint',
      wireProtocol: 'openai-compatible',
    })
    expect(registry.detectProviderPreset({ baseUrl: 'https://gateway.example/anthropic' })).toMatchObject({
      presetId: 'custom-endpoint',
      wireProtocol: 'anthropic-compatible',
    })
  })
})
