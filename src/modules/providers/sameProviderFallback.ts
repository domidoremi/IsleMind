import type { ChatRequest } from '@/core'
import type {
  ProviderCapability,
  ProviderFallbackRoute,
  SameProviderFallbackDescriptor,
} from './contracts'

/**
 * Active target policy for ordered model fallback within one provider. It
 * rejects disabled/deprecated/uncredentialed routes without exposing provider
 * secrets or silently authorizing cross-provider failover.
 */
export function createSameProviderFallbackResolver(
  descriptors: readonly SameProviderFallbackDescriptor[],
): (request: ChatRequest) => readonly ProviderFallbackRoute[] {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.providerId, descriptor]))
  return (request) => {
    const descriptor = byId.get(request.providerId)
    if (!descriptor?.enabled) return []
    const required = new Set(request.requestedCapabilities ?? [])
    const seen = new Set<string>()
    const routes: ProviderFallbackRoute[] = []
    for (const model of descriptor.models) {
      const modelId = model.id.trim()
      if (!modelId || model.deprecated || seen.has(modelId)) continue
      if (!supportsCapabilities(model.capabilities, required)) continue
      if (!descriptor.credentials.some((credential) => credentialAllowsModel(credential, modelId))) continue
      seen.add(modelId)
      routes.push({ providerId: descriptor.providerId, model: modelId })
    }
    return routes
  }
}

function supportsCapabilities(
  capabilities: readonly ProviderCapability[] | undefined,
  required: ReadonlySet<string>,
): boolean {
  if (!required.size) return true
  const available = new Set<ProviderCapability>(capabilities?.length ? capabilities : ['chat'])
  for (const capability of required) {
    if (!available.has(capability as ProviderCapability)) return false
  }
  return true
}

function credentialAllowsModel(
  credential: SameProviderFallbackDescriptor['credentials'][number],
  model: string,
): boolean {
  if (!credential.enabled || !credential.hasCredential) return false
  return !credential.availableModels?.length || credential.availableModels.includes(model)
}
