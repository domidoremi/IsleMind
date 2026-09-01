import { resolveUsageRouteAttribution } from './usageAttribution'

describe('usage route attribution', () => {
  it('keeps ordinary retries on the original route and counts retries separately', () => {
    expect(resolveUsageRouteAttribution({
      actualProviderId: 'openai',
      actualModel: 'gpt-5',
      attempt: 2,
      attemptReason: 'retry',
      retryCount: 2,
    })).toMatchObject({
      originalProviderId: 'openai',
      originalModel: 'gpt-5',
      actualProviderId: 'openai',
      actualModel: 'gpt-5',
      retryCount: 2,
      failoverCount: 0,
      routeChanged: false,
    })
  })

  it('records a provider/model switch as one bounded failover', () => {
    const result = resolveUsageRouteAttribution({
      originalProviderId: 'primary',
      originalModel: 'model-a',
      actualProviderId: 'secondary',
      actualModel: 'model-b',
      attemptReason: 'fallback',
      attemptIdentity: 'attempt-1',
    })
    expect(result).toEqual({
      originalProviderId: 'primary',
      originalModel: 'model-a',
      actualProviderId: 'secondary',
      actualModel: 'model-b',
      retryCount: 0,
      failoverCount: 1,
      attemptIdentity: 'attempt-1',
      routeChanged: true,
    })
  })

  it('clamps malformed counters and creates a deterministic identity', () => {
    const result = resolveUsageRouteAttribution({
      actualProviderId: ' provider ',
      actualModel: ' model ',
      attempt: Number.POSITIVE_INFINITY,
      attemptReason: 'initial',
      retryCount: 999,
      failoverCount: 999,
    })
    expect(result.retryCount).toBe(128)
    expect(result.failoverCount).toBe(32)
    expect(result.attemptIdentity).toContain('provider')
  })
})
