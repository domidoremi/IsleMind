import type { ReasoningEffort } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import type { WebSearchMode } from '@/types/settingsContracts'
import { selectProviderRequestAttachments, type ProviderSelectableAttachment } from './providerAttachments'

export interface ProviderRuntimeFallbackRoute {
  providerId: string
  model: string
  credentialGroupId?: string
  region?: string
  capabilities?: string[]
}

export interface ProviderRuntimeFallbackRequest<Attachment extends ProviderSelectableAttachment = ProviderSelectableAttachment> {
  provider: AIProvider
  model: string
  fallbackProviders?: AIProvider[]
  attachments?: readonly Attachment[]
  reasoningEffort?: ReasoningEffort
  webSearchMode?: WebSearchMode
  providerToolDeclarations?: readonly unknown[]
  structuredOutput?: unknown
}

export function routeForRuntimeFallback(
  request: ProviderRuntimeFallbackRequest,
  credentialGroupId?: string,
): ProviderRuntimeFallbackRoute {
  return {
    providerId: request.provider.id,
    model: request.model,
    credentialGroupId,
    region: request.provider.tokenPlanRegion,
    capabilities: requiredFallbackCapabilities(request),
  }
}

export function fallbackProvidersForRequest(request: ProviderRuntimeFallbackRequest): AIProvider[] {
  const providers = request.fallbackProviders?.length ? request.fallbackProviders : [request.provider]
  const currentProvider = providers.some((provider) => provider.id === request.provider.id) ? [] : [request.provider]
  return [...currentProvider, ...providers]
}

export function requiredFallbackCapabilities(request: ProviderRuntimeFallbackRequest): string[] {
  const capabilities = ['text']
  if (request.reasoningEffort && !['none', 'minimal'].includes(request.reasoningEffort)) capabilities.push('reasoning')
  if (request.providerToolDeclarations?.length) capabilities.push('tools')
  if (request.structuredOutput) capabilities.push('structured_output')
  if (request.webSearchMode === 'native') capabilities.push('native_search')

  const sendableAttachments = selectProviderRequestAttachments({
    attachments: request.attachments,
    imageInputSupported: true,
    fileInputSupported: true,
    visionCapabilityAllowed: true,
    filesCapabilityAllowed: true,
  })
  for (const attachment of sendableAttachments) {
    capabilities.push(attachment.type === 'image' ? 'image' : 'file')
  }
  return Array.from(new Set(capabilities))
}

export function retryAfterMsFromFailure(status?: number): number | undefined {
  if (status === 429) return 60_000
  if (status && status >= 500) return 20_000
  return undefined
}

export function providerForRuntimeFallback(
  request: ProviderRuntimeFallbackRequest,
  route: Pick<ProviderRuntimeFallbackRoute, 'providerId' | 'model' | 'credentialGroupId'>,
): AIProvider {
  const source = fallbackProvidersForRequest(request).find((provider) => provider.id === route.providerId) ?? request.provider
  const groupKey = route.credentialGroupId
    ? source.credentialGroups?.find((group) => group.id === route.credentialGroupId)?.apiKey
    : undefined
  return {
    ...source,
    apiKey: groupKey?.trim() || source.apiKey || request.provider.apiKey,
  }
}
