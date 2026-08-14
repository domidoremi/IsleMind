import type { AIProvider } from '@/types/providerContracts'
import { getProviderEffectiveBaseUrl } from '@/types/providerBaseUrls'
import { isAzureOpenAIProvider, isAzureOpenAIV1Provider } from './providerAzureRouting'

export type HostedProviderKind = 'azure-openai' | 'aws-bedrock' | 'vertex-ai'
export type HostedProviderOperation = 'chat' | 'modelList' | 'remoteCompact' | 'tools'
export type HostedProviderSupportMessageKey =
  | 'providerOperation.hosted.azureOpenAIUnsupported'
  | 'providerOperation.hosted.vertexAIModelListUnsupported'
  | 'providerOperation.hosted.awsBedrockUnsupported'
  | 'providerOperation.hosted.vertexAIUnsupported'

export interface HostedProviderSupportIssue {
  kind: HostedProviderKind
  operation: HostedProviderOperation
  message: string
}

export interface ProviderHostedBoundaryDependencies {
  translate: (key: HostedProviderSupportMessageKey) => string
  isAwsBedrockProvider: (provider: AIProvider) => boolean
  isBedrockMantleProvider: (provider: AIProvider) => boolean
  getBedrockRuntimeSupportIssue: (provider: AIProvider) => string | null
}

export interface ProviderHostedBoundaryPolicy {
  getHostedProviderKind: (provider: AIProvider) => HostedProviderKind | undefined
  getHostedProviderSupportIssue: (provider: AIProvider, operation: HostedProviderOperation) => HostedProviderSupportIssue | null
  isHostedProviderGap: (provider: AIProvider) => boolean
  isAwsBedrockHostedProvider: (provider: AIProvider) => boolean
}

/** Owns hosted admission while localization and the Bedrock adapter stay at composition. */
export function createProviderHostedBoundaryPolicy(
  dependencies: ProviderHostedBoundaryDependencies,
): ProviderHostedBoundaryPolicy {
  function isAwsBedrockHostedProvider(provider: AIProvider): boolean {
    if (dependencies.isAwsBedrockProvider(provider)) return true
    return /\bbedrock\b|bedrock-runtime|bedrock\.[a-z0-9-]+\.amazonaws\.com/i.test(providerIdentityText(provider))
  }

  function getHostedProviderKind(provider: AIProvider): HostedProviderKind | undefined {
    if (isAzureOpenAIProvider(provider)) return 'azure-openai'
    if (isAwsBedrockHostedProvider(provider)) return 'aws-bedrock'
    if (isVertexAIProvider(provider)) return 'vertex-ai'
    return undefined
  }

  function getHostedProviderSupportIssue(
    provider: AIProvider,
    operation: HostedProviderOperation,
  ): HostedProviderSupportIssue | null {
    const kind = getHostedProviderKind(provider)
    if (!kind) return null
    if (kind === 'azure-openai') {
      if (isAzureOpenAIV1Provider(provider)) return null
      return issue(kind, operation, 'providerOperation.hosted.azureOpenAIUnsupported')
    }
    if (kind === 'vertex-ai' && isVertexAIOpenAICompatibleProvider(provider)) {
      if (operation === 'modelList') {
        return issue(kind, operation, 'providerOperation.hosted.vertexAIModelListUnsupported')
      }
      return null
    }
    if (kind === 'aws-bedrock') {
      if (dependencies.isBedrockMantleProvider(provider)) return null
      if (!dependencies.getBedrockRuntimeSupportIssue(provider) && operation === 'chat') return null
      return issue(kind, operation, 'providerOperation.hosted.awsBedrockUnsupported')
    }
    return issue(kind, operation, 'providerOperation.hosted.vertexAIUnsupported')
  }

  function issue(
    kind: HostedProviderKind,
    operation: HostedProviderOperation,
    messageKey: HostedProviderSupportMessageKey,
  ): HostedProviderSupportIssue {
    return { kind, operation, message: dependencies.translate(messageKey) }
  }

  return {
    getHostedProviderKind,
    getHostedProviderSupportIssue,
    isHostedProviderGap: (provider) => getHostedProviderSupportIssue(provider, 'chat') !== null,
    isAwsBedrockHostedProvider,
  }
}

export function isVertexAIProvider(provider: AIProvider): boolean {
  if (provider.presetId === 'vertex-ai' || provider.detectedPresetId === 'vertex-ai') return true
  const text = providerIdentityText(provider)
  if (/vertex[-_ ]?ai|google cloud vertex|aiplatform/i.test(text)) return true
  try {
    const url = new URL(getProviderEffectiveBaseUrl(provider))
    return /aiplatform\.googleapis\.com$/i.test(url.hostname)
  } catch {
    return /aiplatform\.googleapis\.com/i.test(getProviderEffectiveBaseUrl(provider))
  }
}

export function isVertexAIOpenAICompatibleProvider(provider: AIProvider): boolean {
  if (!isVertexAIProvider(provider)) return false
  try {
    const url = new URL(getProviderEffectiveBaseUrl(provider))
    return /aiplatform\.googleapis\.com$/i.test(url.hostname) && /\/v1\/projects\/[^/]+\/locations\/[^/]+\/endpoints\/openapi(?:\/|$)/i.test(url.pathname)
  } catch {
    return /aiplatform\.googleapis\.com\/v1\/projects\/[^/]+\/locations\/[^/]+\/endpoints\/openapi/i.test(getProviderEffectiveBaseUrl(provider))
  }
}

function providerIdentityText(provider: AIProvider): string {
  return [provider.id, provider.name, provider.baseUrl, provider.presetId, provider.detectedPresetId]
    .filter(Boolean)
    .join(' ')
}
