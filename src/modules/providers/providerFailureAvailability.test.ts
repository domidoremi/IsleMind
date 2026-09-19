import { applyProviderModelAvailabilityEvidence, providerFailureAvailabilityEvidence } from './providerModelAvailability'

it('invalidates availability only for an explicit model-negative classification', () => {
  const evidence = providerFailureAvailabilityEvidence('model_unavailable')
  expect(evidence).toEqual({ kind: 'model_invalidated' })
  expect(applyProviderModelAvailabilityEvidence({ availability: 'available', advertisement: 'present' }, evidence).availability).toBe('unavailable')
})

it.each([
  ['endpoint_unavailable', 'generic_not_found'], ['upstream_error', 'server_error'],
  ['client_restricted', 'policy_blocked'], ['access_denied', 'policy_blocked'],
  ['bad_auth', 'unauthorized'], ['invalid_request', 'unsupported'], ['timeout', 'timeout'],
])('preserves historical availability with a specific %s operational overlay', (code, reason) => {
  const evidence = providerFailureAvailabilityEvidence(code)
  expect(evidence).toEqual({ kind: 'operational', reason })
  expect(applyProviderModelAvailabilityEvidence({ availability: 'available', advertisement: 'present' }, evidence)).toMatchObject({ availability: 'available', effect: 'preserved' })
})
