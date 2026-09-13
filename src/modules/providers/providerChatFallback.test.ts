import { resolveLocalProviderRoute } from './providerLocalRouter'
import { createProviderFallbackCandidateBuilder } from './providerFallbackCandidates'
import type { AIProvider } from '@/types/providerContracts'
import { providerRequestHasRouteBoundContinuation } from './providerRuntimeFallback'

describe('Chat fallback consent and admission', () => {
  const original = { providerId: 'preferred', model: 'a', region: 'us', costTier: 'medium' as const }
  const candidate = { providerId: 'other', model: 'b', region: 'us', costTier: 'low' as const, capabilities: ['text'] }
  const policy = { mode: 'ask-before-cross-provider' as const, maxCandidates: 8, maxFailovers: 1 }

  it('accepts only the exact confirmed candidate and still runs every policy', () => {
    const input = { original, candidates: [candidate], trigger: 'timeout' as const, policy, requiredCapabilities: ['text'] }
    expect(resolveLocalProviderRoute(input).decision.requiresUserConfirmation).toBe(true)
    expect(resolveLocalProviderRoute({ ...input, confirmedRoute: candidate }).decision.selected).toMatchObject(candidate)
    expect(resolveLocalProviderRoute({ ...input, confirmedRoute: { ...candidate, model: 'changed' } }).decision.selected).toBeUndefined()
    for (const change of [
      { streamStarted: true },
      { policy: { ...policy, explicitModelLock: true } },
      { policy: { ...policy, allowedRegions: ['eu'] } },
      { policy: { ...policy, maxCostTier: 'low' as const }, candidates: [{ ...candidate, costTier: 'high' as const }] },
      { candidates: [{ ...candidate, healthy: false }] },
      { requiredCapabilities: ['image'] },
      { attemptedRoutes: [candidate] },
    ]) expect(resolveLocalProviderRoute({ ...input, confirmedRoute: candidate, ...change }).decision.selected).toBeUndefined()
  })

  it('does not ask for consent that could not authorize the request', () => {
    for (const blocked of [
      { policy: { ...policy, explicitModelLock: true } },
      { streamStarted: true },
      { trigger: 'credential_unhealthy' as const },
    ]) {
      const result = resolveLocalProviderRoute({ original, candidates: [candidate], trigger: 'timeout', policy, ...blocked })
      expect(result.decision.requiresUserConfirmation).toBe(false)
      expect(result.decision.selected).toBeUndefined()
    }
  })

  it('never lets a missing real group key masquerade as the primary key', () => {
    const provider: AIProvider = { id: 'other', type: 'openai', name: 'Other', enabled: true,
      apiKey: 'test-primary', apiKeySource: { kind: 'primary' }, models: ['b'],
      credentialGroups: [{ id: 'default', label: 'Real default group', enabled: true, apiKey: '' }],
    }
    const build = createProviderFallbackCandidateBuilder({ projectModel: () => ({ deprecated: false, upstreamModel: 'b', capabilities: ['text'] }) })
    const result = build({ providers: [provider], original })
    expect(result.candidates).toHaveLength(0)
    expect(result.rejectedCandidates).toContainEqual({ providerId: 'other', model: 'b', credentialGroupId: 'default', reason: 'credential_missing' })
  })

  it('requires independent planner context before allowing compact continuation fallback', () => {
    const request = { provider: { id: 'a' } as AIProvider, model: 'model', previousResponseId: 'bound-response' }
    expect(providerRequestHasRouteBoundContinuation(request)).toBe(true)
    expect(providerRequestHasRouteBoundContinuation({ ...request, remoteCompactEligible: true })).toBe(true)
    expect(providerRequestHasRouteBoundContinuation({ ...request, remoteCompactEligible: true,
      remoteCompactFallback: { messages: [{ role: 'user', content: 'bounded transcript' }], contextPrompt: '' } })).toBe(false)
    expect(providerRequestHasRouteBoundContinuation({ ...request, previousResponseId: undefined,
      messages: [{ toolCallId: 'bound-tool' }] })).toBe(true)
  })
})
