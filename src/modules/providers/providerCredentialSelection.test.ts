import type { AIProvider } from '@/types/providerContracts'
import { chooseCredentialForModel } from './providerCredentialGroups'
import { parseProviderCredentialSelection, selectProviderCredential, selectProviderProbeCredential, updateProviderCredentialHealth } from './providerCredentials'

const provider = (): AIProvider => ({
  id: 'selection', name: 'Selection', type: 'openai-compatible', apiKey: 'legacy-key', enabled: true, models: ['model'],
  credentialGroups: [
    { id: 'a', label: 'A', enabled: true, apiKey: 'key-a', availableModels: ['model'], lastUsedAt: 10, failureCount: 1 },
    { id: 'b', label: 'B', enabled: true, apiKey: 'key-b', availableModels: ['model'], lastUsedAt: 20 },
    { id: 'other-model', label: 'Other', enabled: true, apiKey: 'key-c', availableModels: ['other'] },
  ],
})

describe('saved credential selection', () => {
  it('keeps the existing health-first default for older configurations', () => {
    expect(chooseCredentialForModel(provider(), 'model').credentialGroupId).toBe('b')
    expect(parseProviderCredentialSelection(undefined)).toBeUndefined()
  })

  it('uses the saved preferred key and keeps explicit targeting and session affinity authoritative', () => {
    const p = { ...provider(), credentialSelection: { strategy: 'balanced' as const, preferredGroupId: 'a' } }
    expect(chooseCredentialForModel(p, 'model').credentialGroupId).toBe('a')
    expect(chooseCredentialForModel(p, 'model', { targetCredentialGroupId: 'b' }).credentialGroupId).toBe('b')
    expect(chooseCredentialForModel(p, 'model', { preferredCredentialGroupId: 'b' }).credentialGroupId).toBe('b')
    expect(chooseCredentialForModel(p, 'model', { preferredCredentialGroupId: 'removed' }).credentialGroupId).toBe('a')
  })

  it.each(['disabled', 'excluded', 'missing', 'other-model', 'empty'])('skips an unavailable saved preference: %s', condition => {
    const p = provider()
    p.credentialSelection = { strategy: 'balanced', preferredGroupId: condition === 'missing' || condition === 'other-model' ? condition : 'a' }
    if (condition === 'disabled') p.credentialGroups![0].enabled = false
    if (condition === 'empty') p.credentialGroups![0].apiKey = ' '
    expect(chooseCredentialForModel(p, 'model', condition === 'excluded' ? { excludedCredentialGroupIds: ['a'] } : {}).credentialGroupId).toBe('b')
  })

  it('rotates by least recent completed use, while preserving model and exclusion scope', () => {
    const p = { ...provider(), credentialSelection: { strategy: 'least-recently-used' as const } }
    expect(chooseCredentialForModel(p, 'model').credentialGroupId).toBe('a')
    p.credentialGroups = updateProviderCredentialHealth(p.credentialGroups!, 'a', true, 30)
    expect(chooseCredentialForModel(p, 'model').credentialGroupId).toBe('b')
    expect(chooseCredentialForModel(p, 'model', { excludedCredentialGroupIds: ['b'] }).credentialGroupId).toBe('a')
  })

  it('never revives the legacy primary when every explicit group is disabled or missing its key', () => {
    for (const groups of [provider().credentialGroups!.map(g => ({ ...g, enabled: false })), [{ id: 'empty', enabled: true, apiKey: '' }]]) {
      expect(selectProviderCredential({ providerApiKey: 'legacy-key', credentials: groups, modelId: 'model', includeSource: true })).toEqual({ credentialId: undefined, apiKey: '', source: { kind: 'none' } })
    }
    expect(selectProviderCredential({ providerApiKey: 'legacy-key', credentials: [], modelId: 'model' }).apiKey).toBe('legacy-key')
  })

  it.each([null, [], {}, { strategy: 'random' }, { strategy: 'balanced', preferredGroupId: '' },
    { strategy: 'balanced', preferredGroupId: ' bad ' }, { strategy: 'balanced', preferredGroupId: 'bad\n' },
    { strategy: 'balanced', preferredGroupId: 'a'.repeat(241) }, { strategy: 'balanced', apiKey: 'unexpected' },
  ])('rejects invalid persisted selection metadata %#', input => {
    expect(() => parseProviderCredentialSelection(input)).toThrow('Invalid credential selection policy')
  })

  it('returns a separate reference-only policy', () => {
    const policy = { strategy: 'balanced' as const, preferredGroupId: 'a' }
    const parsed = parseProviderCredentialSelection(policy)
    expect(parsed).toEqual(policy)
    expect(parsed).not.toBe(policy)
  })
})


describe('interface probe credential selection', () => {
  it('uses the preferred enabled key independently of empty or other-model catalogs', () => {
    const p = provider()
    expect(selectProviderProbeCredential({ providerApiKey: p.apiKey, credentials: p.credentialGroups!,
      selectionPolicy: { strategy: 'balanced', preferredGroupId: 'other-model' } })).toEqual({ credentialId: 'other-model', apiKey: 'key-c' })
    p.credentialGroups![2].availableModels = []
    p.credentialGroups![2].modelCatalogKnown = true
    expect(selectProviderProbeCredential({ providerApiKey: p.apiKey, credentials: p.credentialGroups!,
      selectionPolicy: { strategy: 'balanced', preferredGroupId: 'other-model' } }).credentialId).toBe('other-model')
  })

  it('skips disabled and blank keys, respects strategy, and never falls back around an explicit group', () => {
    const groups = provider().credentialGroups!.slice(0, 2)
    expect(selectProviderProbeCredential({ providerApiKey: 'legacy', credentials: groups }).credentialId).toBe('b')
    expect(selectProviderProbeCredential({ providerApiKey: 'legacy', credentials: groups,
      selectionPolicy: { strategy: 'least-recently-used' } }).credentialId).toBe('a')
    groups[0].enabled = false
    expect(selectProviderProbeCredential({ providerApiKey: 'legacy', credentials: groups,
      selectionPolicy: { strategy: 'balanced', preferredGroupId: 'a' } }).credentialId).toBe('b')
    groups[1].apiKey = ' '
    expect(selectProviderProbeCredential({ providerApiKey: 'legacy', credentials: groups }).apiKey).toBe('')
    expect(selectProviderProbeCredential({ providerApiKey: 'legacy', credentials: [] }).apiKey).toBe('legacy')
  })
})
