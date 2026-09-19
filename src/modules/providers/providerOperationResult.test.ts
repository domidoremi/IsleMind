import { classifyHttpStatus } from './providerOperationResult'
import { providerFailureAvailabilityEvidence } from './providerModelAvailability'

it.each([
  [429, 'model temporarily unavailable: rate limit', 'rate_limited'],
  [504, 'model temporarily unavailable', 'timeout'],
  [503, 'no available channel', 'upstream_error'],
  [503, 'model temporarily unavailable', 'upstream_error'],
  [400, 'missing required client parameter', 'invalid_request'],
  [400, JSON.stringify({ error: { type: 'invalid_request_error', message: 'Missing model parameter' } }), 'invalid_request'],
  [422, JSON.stringify({ error: { message: 'Missing model field' } }), 'invalid_request'],
  [403, 'Only Codex CLI clients are allowed', 'client_restricted'],
  [404, JSON.stringify({ error: { code: 'model_not_found', message: 'Missing model' } }), 'model_unavailable'],
  [404, 'missing model', 'endpoint_unavailable'],
  [503, 'model_not_found: no available channel', 'model_unavailable'],
  [400, JSON.stringify({ error: { message: 'unsupported parameter' }, request: { model: 'model_not_found' } }), 'invalid_request'],
  [502, '<html>Authentication error in upstream proxy</html>', 'upstream_error'],
])('classifies HTTP %s without confusing operational failures with model evidence', (status, body, expected) => {
  const code = classifyHttpStatus(Number(status), String(body), 'test-model')
  expect(code).toBe(expected)
  expect(providerFailureAvailabilityEvidence(code).kind).toBe(expected === 'model_unavailable' ? 'model_invalidated' : 'operational')
})
