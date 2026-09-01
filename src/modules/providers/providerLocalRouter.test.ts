import {
  DEFAULT_PROVIDER_LOCAL_ROUTER_POLICY,
  providerRouteKey,
  resolveLocalProviderRoute,
} from './providerLocalRouter'

function route(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'primary',
    model: 'model-a',
    credentialGroupId: 'group-a',
    family: 'openai',
    region: 'us',
    costTier: 'medium' as const,
    capabilities: ['text', 'tools'],
    healthy: true,
    ...overrides,
  }
}

describe('local provider router', () => {
  it('selects a capability-compatible healthy route and emits bounded trace evidence', () => {
    const result = resolveLocalProviderRoute({
      original: route(),
      trigger: 'timeout',
      requiredCapabilities: ['text', 'tools'],
      candidates: [
        route(),
        route({ model: 'model-b', credentialGroupId: 'group-b', healthScore: 80 }),
        route({ providerId: 'secondary', model: 'model-c', credentialGroupId: 'secondary', costTier: 'low', healthScore: 100 }),
        route({ providerId: 'incompatible', model: 'model-d', capabilities: ['text'] }),
      ],
    })

    expect(result.schema).toBe('islemind.provider-local-router.v1')
    expect(result.decision.eligible).toBe(true)
    expect(result.decision.selected).toMatchObject({ model: 'model-b' })
    expect(result.trace.failoverCount).toBe(1)
    expect(result.trace.rejectedBeforePolicy).toBe(1)
  })

  it('prevents repeated route attempts and bounds candidates/failovers', () => {
    const original = route()
    const result = resolveLocalProviderRoute({
      original,
      trigger: 'server_error',
      attemptedRoutes: [route({ model: 'model-b', credentialGroupId: 'group-b' })],
      policy: { maxCandidates: 1, maxFailovers: 0 },
      candidates: [
        route({ model: 'model-b', credentialGroupId: 'group-b' }),
        route({ model: 'model-c', credentialGroupId: 'group-c' }),
      ],
    })

    expect(result.policy.maxCandidates).toBe(1)
    expect(result.trace.candidateCount).toBe(1)
    expect(result.decision.selected).toBeUndefined()
    expect(result.trace.attemptedRoutes.map(providerRouteKey)).toContain('primary|model-b|group-b')
    expect(DEFAULT_PROVIDER_LOCAL_ROUTER_POLICY.allowCredentialFailover).toBe(false)
  })

  it('selects a compatible cross-provider route when no same-provider alternative exists', () => {
    const result = resolveLocalProviderRoute({
      original: route(),
      trigger: 'server_error',
      requiredCapabilities: ['text', 'tools'],
      candidates: [
        route({
          providerId: 'secondary',
          model: 'model-c',
          credentialGroupId: 'secondary',
          costTier: 'low',
          healthScore: 100,
        }),
      ],
    })

    expect(result.policy.mode).toBe('capability-equivalent')
    expect(result.decision.selected).toMatchObject({
      providerId: 'secondary',
      model: 'model-c',
    })
  })

  it('does not route authentication failures unless explicitly enabled', () => {
    const result = resolveLocalProviderRoute({
      original: route(),
      trigger: 'credential_unhealthy',
      candidates: [route({ model: 'model-b', credentialGroupId: 'group-b' })],
    })
    expect(result.decision.eligible).toBe(false)
    expect(result.decision.blockedReasons).toContain('trigger_not_allowed')
  })

  it('counts prior route attempts toward the cumulative failover limit', () => {
    const original = route()
    const attempted = [
      route({ model: 'model-b', credentialGroupId: 'group-b' }),
      route({ model: 'model-c', credentialGroupId: 'group-c' }),
    ]
    const result = resolveLocalProviderRoute({
      original,
      attemptedRoutes: attempted,
      trigger: 'server_error',
      policy: { maxFailovers: 2 },
      candidates: [route({ model: 'model-d', credentialGroupId: 'group-d' })],
    })

    expect(result.trace.failoverCount).toBe(2)
    expect(result.decision.selected).toBeUndefined()
    expect(result.decision.blockedReasons).toContain('failover_limit_reached')
  })

  it('explains when the candidate bound hid otherwise-unseen candidates', () => {
    const result = resolveLocalProviderRoute({
      original: route(),
      trigger: 'server_error',
      requiredCapabilities: ['text', 'tools'],
      policy: { maxCandidates: 1 },
      candidates: [
        route({ model: 'model-b', credentialGroupId: 'group-b', capabilities: ['text'] }),
        route({ model: 'model-c', credentialGroupId: 'group-c' }),
      ],
    })

    expect(result.decision.selected).toBeUndefined()
    expect(result.decision.blockedReasons).toContain('candidate_limit_reached')
  })
})
