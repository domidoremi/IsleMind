import {
  applyProviderModelAvailabilityEvidence,
  isProviderModelAvailabilityBlocked,
  type ProviderModelAvailability,
} from './providerModelAvailability'
import { resolveFailoverDecision } from './providerFailoverPolicy'

describe('model availability evidence', () => {
  it('admits unknown availability without granting missing capabilities', () => {
    expect(isProviderModelAvailabilityBlocked('unknown')).toBe(false)
    const decision = resolveFailoverDecision({
      policy: { mode: 'same-provider' }, trigger: 'model_unavailable',
      original: { providerId: 'p', model: 'preferred' },
      candidates: [{ providerId: 'p', model: 'unknown-model', capabilities: ['text'] }],
      requiredCapabilities: ['tools'],
    })
    expect(decision.eligible).toBe(false)
    expect(decision.rejectedCandidates[0].reason).toBe('capability_mismatch')
  })

  it.each(['unknown', 'available', 'unavailable', 'retired'] as ProviderModelAvailability[])(
    'preserves %s during operational failures', (availability) => {
      for (const reason of ['offline', 'timeout', 'dns_tls', 'unauthorized', 'rate_limited', 'server_error', 'generic_not_found', 'cancelled'] as const) {
        expect(applyProviderModelAvailabilityEvidence({ availability, advertisement: 'present' }, {
          kind: 'operational', reason,
        })).toEqual({ availability, advertisement: 'present', effect: 'preserved' })
      }
    },
  )

  it('distinguishes unavailable from explicitly retired and requires recovery evidence', () => {
    expect(applyProviderModelAvailabilityEvidence(undefined, { kind: 'model_invalidated' }).availability).toBe('unavailable')
    const retired = applyProviderModelAvailabilityEvidence(undefined, { kind: 'model_retired' })
    expect(retired.availability).toBe('retired')
    expect(applyProviderModelAvailabilityEvidence(retired, { kind: 'discovery_present', accessAuthoritative: true }).availability).toBe('retired')
    expect(applyProviderModelAvailabilityEvidence(retired, { kind: 'probe_success' }).availability).toBe('retired')
    expect(applyProviderModelAvailabilityEvidence(retired, { kind: 'generation_success' }).availability).toBe('available')
    expect(applyProviderModelAvailabilityEvidence(retired, { kind: 'model_reinstated' }).availability).toBe('available')
  })

  it('does not confuse a catalog entry or catalog absence with access evidence', () => {
    expect(applyProviderModelAvailabilityEvidence(undefined, { kind: 'discovery_present', accessAuthoritative: false }))
      .toMatchObject({ availability: 'unknown', advertisement: 'present' })
    expect(applyProviderModelAvailabilityEvidence({ availability: 'available', advertisement: 'present' }, {
      kind: 'discovery_absent', complete: true, accessAuthoritative: false,
    })).toMatchObject({ availability: 'available', advertisement: 'not-advertised' })
    expect(applyProviderModelAvailabilityEvidence({ availability: 'available', advertisement: 'present' }, {
      kind: 'discovery_absent', complete: false, accessAuthoritative: true,
    })).toMatchObject({ availability: 'available', advertisement: 'present', effect: 'preserved' })
    expect(applyProviderModelAvailabilityEvidence(undefined, {
      kind: 'discovery_absent', complete: true, accessAuthoritative: true,
    }).availability).toBe('unavailable')
  })
})
