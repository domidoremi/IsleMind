import {
  classifyProviderHealthCheckError,
  isProviderHealthCheckFailoverEligible,
  isProviderHealthCheckRetryable,
  projectProviderHealthStatus,
} from './providerHealthCheckPolicy'

describe('provider health-check policy', () => {
  it('classifies transport and authentication failures with conservative retry semantics', () => {
    expect(classifyProviderHealthCheckError({ errorCode: 'ENOTFOUND' })).toMatchObject({
      kind: 'dns_error',
      retryable: true,
      failoverEligible: true,
    })
    expect(classifyProviderHealthCheckError({ status: 401, errorMessage: 'invalid api key' })).toMatchObject({
      kind: 'auth_error',
      retryable: false,
      failoverEligible: false,
    })
    expect(classifyProviderHealthCheckError({ status: 404, errorMessage: 'model not found' })).toMatchObject({
      kind: 'model_not_found',
      retryable: false,
      failoverEligible: false,
    })
    expect(classifyProviderHealthCheckError({ status: 503 })).toMatchObject({
      kind: 'provider_unavailable',
      retryable: true,
      failoverEligible: true,
    })
    expect(classifyProviderHealthCheckError({ status: 401 }).retryable).toBe(false)
    expect(classifyProviderHealthCheckError({ status: 404 }).retryable).toBe(false)
    expect(classifyProviderHealthCheckError({ status: 409 }).retryable).toBe(false)
    expect(classifyProviderHealthCheckError({ status: 425 }).retryable).toBe(false)
    expect(classifyProviderHealthCheckError({ status: 500 }).retryable).toBe(true)
    expect(isProviderHealthCheckRetryable({ status: 429 })).toBe(true)
    expect(isProviderHealthCheckFailoverEligible({ status: 400 })).toBe(false)
  })

  it('projects unavailable and recovering states without changing persisted health records', () => {
    expect(projectProviderHealthStatus({
      record: { status: 'circuit-open', consecutiveFailures: 3, circuitOpenUntilMs: 10_000 },
      nowMs: 1_000,
    })).toBe('unavailable')
    expect(projectProviderHealthStatus({
      record: {
        status: 'circuit-open',
        consecutiveFailures: 1,
        circuitOpenUntilMs: 10_000,
        lastFailureAtMs: 500,
        lastSuccessAtMs: 800,
      },
      nowMs: 1_000,
    })).toBe('recovering')
    expect(projectProviderHealthStatus({
      record: { status: 'healthy', consecutiveFailures: 0 },
      nowMs: 1_000,
    })).toBe('healthy')
  })
})
