import { createProviderRuntimeHealth } from '@/modules/providers'
import { providerHealthRepository } from '@/bootstrap/providerHealthRepository'
import type { ProviderFailoverRoute, ProviderRuntimeHealthRequest } from '@/modules/providers'
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
  return observeHealthWrite(input.req.provider.id, async () => {
    await Promise.all([health.recordProviderRuntimeSuccess(input), recordCredentialHealth(input.req, input.credentialGroupId, true)])
  })
}

export function recordProviderRuntimeFailure(input: Parameters<typeof health.recordProviderRuntimeFailure>[0]) {
  return observeHealthWrite(input.req.provider.id, async () => {
    const [classification] = await Promise.all([
      health.recordProviderRuntimeFailure(input), recordCredentialHealth(input.req, input.credentialGroupId, false),
    ])
    return classification
  })
}

export function recordProviderRuntimeRouteSuccess(route: ProviderFailoverRoute,
  input?: Parameters<typeof health.recordProviderRuntimeRouteSuccess>[1] & { req?: ProviderRuntimeHealthRequest }) {
  return observeHealthWrite(route.providerId, async () => {
    await Promise.all([health.recordProviderRuntimeRouteSuccess(route, input),
      input?.req && recordCredentialHealth(input.req, route.credentialGroupId, true)])
  })
}

export function recordProviderRuntimeRouteFailure(route: ProviderFailoverRoute,
  input: Parameters<typeof health.recordProviderRuntimeRouteFailure>[1] & { req?: ProviderRuntimeHealthRequest }) {
  return observeHealthWrite(route.providerId, async () => {
    const [classification] = await Promise.all([health.recordProviderRuntimeRouteFailure(route, input),
      input.req && recordCredentialHealth(input.req, route.credentialGroupId, false)])
    return classification
  })
}

/** Plain, Rich and fallback requests share the actual dispatched credential. */
async function recordCredentialHealth(req: ProviderRuntimeHealthRequest, groupId: string | undefined, healthy: boolean) {
  if (!groupId || !req.provider.apiKey.trim()) return
  const source = req.provider.apiKeySource
  if (source && (source.kind !== 'group' || source.groupId !== groupId)) return
  const expectedCredential = { apiKey: req.provider.apiKey, type: req.provider.type, baseUrl: req.provider.baseUrl }
  try {
    const { useSettingsStore } = await import('@/store/settingsStore')
    await useSettingsStore.getState().updateProviderCredentialGroupHealth(req.provider.id, groupId, healthy, { expectedCredential })
  } catch {
    // Health storage cannot turn a delivered response into a request failure.
  }
}
