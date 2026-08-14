import {
  createProviderRoutePolicy,
  type ProviderRouteInput,
  type ProviderRouteResult,
} from '@/modules/providers'
import {
  resolveAndHardenProviderRequest,
} from '@/bootstrap/providerConformance'
import type {
  ProviderConformanceRequest,
  ProviderConformanceResult,
} from '@/modules/providers'

type BoundProviderRouteRequest = ProviderConformanceRequest & { requestedModel?: string }

const providerRoutePolicy = createProviderRoutePolicy<BoundProviderRouteRequest, ProviderConformanceResult>({
  hardenRequest: resolveAndHardenProviderRequest,
})

export function resolveProviderRoute(
  input: ProviderRouteInput<BoundProviderRouteRequest>,
): ProviderRouteResult<ProviderConformanceResult> {
  return providerRoutePolicy.resolve(input)
}
