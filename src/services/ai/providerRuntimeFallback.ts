import type { AIProvider, Attachment, ReasoningEffort, WebSearchMode } from '@/types'
import { filterSendableAttachments } from '@/services/attachmentContract'
import type { ProviderFailoverRoute } from '@/services/ai/providerFailover'
import type { ProviderStructuredOutputRequest } from '@/services/ai/providerConformance'

export interface ProviderRuntimeFallbackRequest {
  provider: AIProvider
  model: string
  fallbackProviders?: AIProvider[]
  attachments?: Attachment[]
  reasoningEffort?: ReasoningEffort
  webSearchMode?: WebSearchMode
  providerToolDeclarations?: readonly unknown[]
  structuredOutput?: ProviderStructuredOutputRequest
}

export function routeForRuntimeFallback(req: ProviderRuntimeFallbackRequest, credentialGroupId?: string): ProviderFailoverRoute {
  return {
    providerId: req.provider.id,
    model: req.model,
    credentialGroupId,
    region: req.provider.tokenPlanRegion,
    capabilities: requiredFallbackCapabilities(req),
  }
}

export function fallbackProvidersForRequest(req: ProviderRuntimeFallbackRequest): AIProvider[] {
  const providers = req.fallbackProviders?.length ? req.fallbackProviders : [req.provider]
  const currentProvider = providers.some((provider) => provider.id === req.provider.id) ? [] : [req.provider]
  return [...currentProvider, ...providers]
}

export function requiredFallbackCapabilities(req: ProviderRuntimeFallbackRequest): string[] {
  const capabilities = ['text']
  if (req.reasoningEffort && !['none', 'minimal'].includes(req.reasoningEffort)) capabilities.push('reasoning')
  if (req.providerToolDeclarations?.length) capabilities.push('tools')
  if (req.structuredOutput) capabilities.push('structured_output')
  if (req.webSearchMode === 'native') capabilities.push('native_search')
  for (const attachment of filterSendableAttachments(req.attachments)) {
    if (attachment.type === 'image') capabilities.push('image')
    if (attachment.type !== 'image') capabilities.push('file')
  }
  return Array.from(new Set(capabilities))
}

export function retryAfterMsFromFailure(status?: number): number | undefined {
  if (status === 429) return 60_000
  if (status && status >= 500) return 20_000
  return undefined
}

export function providerForRuntimeFallback(req: ProviderRuntimeFallbackRequest, route: ProviderFailoverRoute): AIProvider {
  const source = fallbackProvidersForRequest(req).find((provider) => provider.id === route.providerId) ?? req.provider
  const groupKey = route.credentialGroupId
    ? source.credentialGroups?.find((group) => group.id === route.credentialGroupId)?.apiKey
    : undefined
  return {
    ...source,
    apiKey: groupKey?.trim() || source.apiKey || req.provider.apiKey,
  }
}
