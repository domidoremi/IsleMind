import { createProviderRuntimeHealth } from '@/modules/providers'
import { providerHealthRepository } from '@/bootstrap/providerHealthRepository'
import type { ProviderFailoverRoute } from '@/modules/providers'
import { createProviderDispatchReadFence } from './providerDispatchReadFence'

const health = createProviderRuntimeHealth(providerHealthRepository)
const healthFence = createProviderDispatchReadFence(500, 'Provider health changed during dispatch admission')

export const providerRuntimeHealthRoute = health.providerRuntimeHealthRoute
export const resolveProviderRuntimeHealthView = health.resolveProviderRuntimeHealthView

export function captureProviderRuntimeHealthDispatch(providerId: string): () => void {
  return healthFence.capture(providerId)
}

async function observeHealthWrite<Value>(providerId: string, write: () => Promise<Value>): Promise<Value> {
  return healthFence.observe([providerId], write)
}

export function recordProviderRuntimeSuccess(input: Parameters<typeof health.recordProviderRuntimeSuccess>[0]) {
  return observeHealthWrite(input.req.provider.id, () => health.recordProviderRuntimeSuccess(input))
}

export function recordProviderRuntimeFailure(input: Parameters<typeof health.recordProviderRuntimeFailure>[0]) {
  return observeHealthWrite(input.req.provider.id, () => health.recordProviderRuntimeFailure(input))
}

export function recordProviderRuntimeRouteSuccess(route: ProviderFailoverRoute, input?: Parameters<typeof health.recordProviderRuntimeRouteSuccess>[1]) {
  return observeHealthWrite(route.providerId, () => health.recordProviderRuntimeRouteSuccess(route, input))
}

export function recordProviderRuntimeRouteFailure(route: ProviderFailoverRoute, input: Parameters<typeof health.recordProviderRuntimeRouteFailure>[1]) {
  return observeHealthWrite(route.providerId, () => health.recordProviderRuntimeRouteFailure(route, input))
}
