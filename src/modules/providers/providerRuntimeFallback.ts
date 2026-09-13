import type { ReasoningEffort } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import type { WebSearchMode } from '@/types/settingsContracts'
import { selectProviderRequestAttachments, type ProviderSelectableAttachment } from './providerAttachments'
import type { ProviderCredentialSource } from './providerCredentials'

export interface ProviderRuntimeFallbackRoute {
  providerId: string
  model: string
  credentialGroupId?: string
  credentialSource?: ProviderCredentialSource
  region?: string
  capabilities?: string[]
}

export interface ProviderRuntimeFallbackRequest<Attachment extends ProviderSelectableAttachment = ProviderSelectableAttachment> {
  provider: AIProvider
  model: string
  fallbackProviders?: AIProvider[]
  allowFallback?: boolean
  attachments?: readonly Attachment[]
  reasoningEffort?: ReasoningEffort
  webSearchMode?: WebSearchMode
  providerToolDeclarations?: readonly unknown[]
  structuredOutput?: unknown
  previousResponseId?: string
  remoteCompactEligible?: boolean
  remoteCompactFallback?: { messages: { role: 'user' | 'assistant'; content: string }[]; contextPrompt: string }
  messages?: readonly { toolCallId?: string; toolCalls?: readonly unknown[]; responseItems?: readonly unknown[]; providerContentBlocks?: readonly unknown[]; reasoningContent?: string }[]
}

export function routeForRuntimeFallback(
  request: ProviderRuntimeFallbackRequest,
  credentialGroupId?: string,
): ProviderRuntimeFallbackRoute {
  return {
    providerId: request.provider.id,
    model: request.model,
    credentialGroupId,
    ...(request.provider.apiKeySource ? { credentialSource: request.provider.apiKeySource } : {}),
    region: request.provider.tokenPlanRegion,
    capabilities: requiredFallbackCapabilities(request),
  }
}

export function fallbackProvidersForRequest(request: ProviderRuntimeFallbackRequest): AIProvider[] {
  if (request.allowFallback === false) return []
  const providers = request.fallbackProviders?.length ? request.fallbackProviders : [request.provider]
  const currentProvider = providers.some((provider) => provider.id === request.provider.id) ? [] : [request.provider]
  return [...currentProvider, ...providers]
}

/** Provider-owned replay state may not be sent to a different execution route. */
export function providerRequestHasRouteBoundContinuation(request: ProviderRuntimeFallbackRequest): boolean {
  // The existing compaction planner may supply an independent, bounded text
  // transcript. The executor must substitute it and clear continuation identity
  // on every route change, even if the new route also supports compaction.
  if (request.remoteCompactEligible && request.remoteCompactFallback) return false
  return Boolean(request.previousResponseId || request.messages?.some((message) => message.toolCallId
    || message.toolCalls?.length || message.responseItems?.length || message.providerContentBlocks?.length || message.reasoningContent))
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
  route: Pick<ProviderRuntimeFallbackRoute, 'providerId' | 'model' | 'credentialGroupId' | 'credentialSource'>,
): AIProvider {
  const source = fallbackProvidersForRequest(request).find((provider) => provider.id === route.providerId)
  if (!source) throw new Error('Requested fallback provider is not available')
  const credentialSource = route.credentialSource ?? (route.credentialGroupId
    ? source.credentialGroups?.find((group) => group.id === route.credentialGroupId)?.source
      ?? { kind: 'group', groupId: route.credentialGroupId }
    : source.apiKeySource ?? { kind: 'primary' })
  if (credentialSource.kind === 'group') {
    const group = source.credentialGroups?.find((item) => item.id === credentialSource.groupId && item.source?.kind !== 'primary')
    if (!group?.enabled || !group.apiKey?.trim()) throw new Error('Requested credential group is not available')
    return { ...source, apiKey: group.apiKey, apiKeySource: credentialSource }
  }
  if (credentialSource.kind !== 'primary' || !source.apiKey.trim() || (source.apiKeySource && source.apiKeySource.kind !== 'primary')) {
    throw new Error('Requested primary credential is not available')
  }
  return { ...source, apiKeySource: credentialSource }
}
