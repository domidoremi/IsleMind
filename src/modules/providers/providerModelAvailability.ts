/** Model access evidence is independent of route health, credentials and network state. */
export type ProviderModelAvailability = 'unknown' | 'available' | 'unavailable' | 'retired'
export type ProviderModelAdvertisement = 'unknown' | 'present' | 'not-advertised'

export interface ProviderModelAvailabilityState {
  availability: ProviderModelAvailability
  advertisement: ProviderModelAdvertisement
}

/** Classified evidence only. Adapters must not classify generic HTTP errors as lifecycle events. */
export type ProviderModelAvailabilityEvidence =
  | { kind: 'discovery_present'; accessAuthoritative: boolean }
  | { kind: 'discovery_absent'; complete: boolean; accessAuthoritative: boolean }
  | { kind: 'probe_success' | 'generation_success' | 'model_invalidated' | 'model_retired' | 'model_reinstated' }
  | { kind: 'operational'; reason: 'offline' | 'timeout' | 'dns_tls' | 'unauthorized' | 'rate_limited' | 'server_error' | 'generic_not_found' | 'cancelled' | 'unsupported' | 'partial' | 'policy_blocked' }

export interface ProviderModelAvailabilityTransition extends ProviderModelAvailabilityState {
  effect: 'applied' | 'preserved'
}

/** This is one admission input, never a replacement for capability/access/routing policy. */
export function providerFailureAvailabilityEvidence(code: string): ProviderModelAvailabilityEvidence {
  if (code === 'model_unavailable') return { kind: 'model_invalidated' }
  return { kind: 'operational', reason:
    code === 'bad_auth' || code === 'missing_key' || code === 'credential_mismatch' ? 'unauthorized'
      : code === 'access_denied' || code === 'client_restricted' || code === 'provider_conformance_blocked' ? 'policy_blocked'
        : code === 'rate_limited' ? 'rate_limited'
          : code === 'timeout' ? 'timeout'
            : code === 'network_error' ? 'dns_tls'
              : code === 'upstream_error' ? 'server_error'
                : code === 'endpoint_unavailable' || code === 'models_endpoint_unavailable' || code === 'bad_base_url' ? 'generic_not_found'
                  : code === 'invalid_request' ? 'unsupported' : 'partial' }
}

export function isProviderModelAvailabilityBlocked(availability: ProviderModelAvailability): boolean {
  return availability === 'unavailable' || availability === 'retired'
}

export function applyProviderModelAvailabilityEvidence(
  current: ProviderModelAvailabilityState | undefined,
  evidence: ProviderModelAvailabilityEvidence,
): ProviderModelAvailabilityTransition {
  const previous = current ?? { availability: 'unknown', advertisement: 'unknown' }
  let { availability, advertisement } = previous
  switch (evidence.kind) {
    case 'generation_success':
    case 'model_reinstated':
      availability = 'available'
      break
    case 'probe_success':
      if (availability !== 'retired') availability = 'available'
      break
    case 'model_retired':
      availability = 'retired'
      break
    case 'model_invalidated':
      if (availability !== 'retired') availability = 'unavailable'
      break
    case 'discovery_present':
      advertisement = 'present'
      if (evidence.accessAuthoritative && availability !== 'retired') availability = 'available'
      break
    case 'discovery_absent':
      if (evidence.complete) {
        advertisement = 'not-advertised'
        if (evidence.accessAuthoritative && availability !== 'retired') availability = 'unavailable'
      }
      break
    case 'operational':
      return { ...previous, effect: 'preserved' }
  }
  return {
    availability, advertisement,
    effect: availability !== previous.availability || advertisement !== previous.advertisement ? 'applied' : 'preserved',
  }
}
