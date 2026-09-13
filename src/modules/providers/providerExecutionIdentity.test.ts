import { selectProviderCredential } from './providerCredentials'
import { chooseCredentialForModel, normalizeProviderCredentialGroups } from './providerCredentialGroups'
import { providerExecutionIdentityKey } from './providerExecutionTarget'
import { resolveLocalProviderRoute } from './providerLocalRouter'

describe('actual credential and route identity', () => {
  const credentials = [
    { id: 'default', enabled: true, apiKey: 'test-group', availableModels: ['a'] },
    { id: 'disabled', enabled: false, apiKey: 'test-disabled' },
    { id: 'other', enabled: true, apiKey: 'test-other' },
  ]

  it('distinguishes primary from a real group named default without comparing secrets', () => {
    expect(selectProviderCredential({ providerApiKey: 'test-primary', credentials: [], modelId: 'a', includeSource: true }).source)
      .toEqual({ kind: 'primary' })
    expect(selectProviderCredential({ providerApiKey: 'test-primary', credentials, modelId: 'a', includeSource: true }).source)
      .toEqual({ kind: 'group', groupId: 'default' })
    expect(selectProviderCredential({ providerApiKey: '', credentials: [], modelId: 'a', includeSource: true }).source)
      .toEqual({ kind: 'none' })
  })

  it('fails strict group targeting instead of selecting another group or primary', () => {
    for (const targetCredentialId of ['absent', 'disabled']) {
      expect(() => selectProviderCredential({ providerApiKey: 'test-primary', credentials, modelId: 'a', targetCredentialId, includeSource: true }))
        .toThrow('Requested credential group is not available')
    }
    expect(() => selectProviderCredential({ providerApiKey: 'test-primary', credentials: [{ id: 'empty', enabled: true }], modelId: 'a', targetCredentialId: 'empty', includeSource: true }))
      .toThrow('Requested credential group is not available')
    expect(selectProviderCredential({ providerApiKey: 'test-primary', credentials, modelId: 'a', preferredCredentialId: 'absent', includeSource: true }).credentialId)
      .toBe('default')
  })

  it('retains synthetic-primary origin through repeated normalization', () => {
    const provider = { id: 'p', type: 'openai' as const, name: 'P', apiKey: 'test-primary', models: ['a'], enabled: true }
    const normalized = normalizeProviderCredentialGroups(normalizeProviderCredentialGroups(provider))
    expect(chooseCredentialForModel(normalized, 'a').source).toEqual({ kind: 'primary' })
    expect(() => chooseCredentialForModel(normalized, 'a', { targetCredentialGroupId: 'default' })).toThrow('Requested credential group is not available')
  })

  it('compares credential, adapter and endpoint identity, not only provider/model', () => {
    const route = { providerId: 'p', model: 'a', credentialSource: { kind: 'primary' as const }, protocolAdapterId: 'openai-chat' as const, endpointVariant: 'native' }
    expect(providerExecutionIdentityKey(route)).toBe(providerExecutionIdentityKey({ ...route }))
    for (const other of [
      { ...route, credentialSource: { kind: 'group' as const, groupId: 'default' } },
      { ...route, protocolAdapterId: 'openai-responses' as const },
      { ...route, endpointVariant: 'deployment-b' },
      { ...route, model: 'upstream-b' },
    ]) expect(providerExecutionIdentityKey(route)).not.toBe(providerExecutionIdentityKey(other))
    expect(providerExecutionIdentityKey({ ...route, providerId: 'a|b', model: 'c' }))
      .not.toBe(providerExecutionIdentityKey({ ...route, providerId: 'a', model: 'b|c' }))
    expect(resolveLocalProviderRoute({ original: route, trigger: 'timeout', candidates: [{ ...route, credentialSource: { kind: 'group', groupId: 'default' } }] }).decision.eligible).toBe(true)
  })

  it('ranks using existing policy before truncation with deterministic ties', () => {
    const original = { providerId: 'p', model: 'a' }
    const candidates = [
      { providerId: 'other', model: 'a', healthy: true },
      { providerId: 'p', model: 'c', healthy: true },
      { providerId: 'p', model: 'b', healthy: true },
    ]
    for (const input of [candidates, [...candidates].reverse()]) {
      expect(resolveLocalProviderRoute({ original, trigger: 'timeout', candidates: input, policy: { maxCandidates: 1 } }).decision.selected?.model).toBe('b')
    }
  })

  it('requires cross-provider consent without ignoring other blocks', () => {
    const result = resolveLocalProviderRoute({
      original: { providerId: 'p', model: 'a' }, candidates: [{ providerId: 'other', model: 'b' }],
      trigger: 'timeout', policy: { mode: 'ask-before-cross-provider', maxFailovers: 1 },
    })
    expect(result.decision.requiresUserConfirmation).toBe(true)
    expect(result.decision.selected).toBeUndefined()
    expect(result.decision.acceptedCandidates[0].providerId).toBe('other')
  })
})
