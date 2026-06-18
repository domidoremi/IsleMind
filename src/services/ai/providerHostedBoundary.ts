import type { AIProvider } from '@/types'
import { getProviderEffectiveBaseUrl } from '@/types'
import { st } from '@/i18n/service'
import { getBedrockRuntimeSupportIssue, isAwsBedrockProvider, isBedrockMantleProvider } from '@/services/ai/providerAwsBedrockRouting'
import { isAzureOpenAIProvider, isAzureOpenAIV1Provider } from '@/services/ai/providerHostedRouting'

export type HostedProviderKind = 'azure-openai' | 'aws-bedrock' | 'vertex-ai'

export interface HostedProviderSupportIssue {
  kind: HostedProviderKind
  operation: 'chat' | 'modelList' | 'remoteCompact' | 'tools'
  message: string
}

export function getHostedProviderKind(provider: AIProvider): HostedProviderKind | undefined {
  if (isAzureOpenAIProvider(provider)) return 'azure-openai'
  if (isAwsBedrockHostedProvider(provider)) return 'aws-bedrock'
  if (isVertexAIProvider(provider)) return 'vertex-ai'
  return undefined
}

export function getHostedProviderSupportIssue(provider: AIProvider, operation: HostedProviderSupportIssue['operation']): HostedProviderSupportIssue | null {
  const kind = getHostedProviderKind(provider)
  if (!kind) return null
  if (kind === 'azure-openai') {
    if (isAzureOpenAIV1Provider(provider)) return null
    return {
      kind,
      operation,
      message: st('providerOperation.hosted.azureOpenAIUnsupported'),
    }
  }
  if (kind === 'vertex-ai' && isVertexAIOpenAICompatibleProvider(provider)) {
    return null
  }
  if (kind === 'aws-bedrock') {
    if (isBedrockMantleProvider(provider)) return null
    if (!getBedrockRuntimeSupportIssue(provider) && operation === 'chat') return null
    return {
      kind,
      operation,
      message: st('providerOperation.hosted.awsBedrockUnsupported'),
    }
  }
  return {
    kind,
    operation,
    message: st('providerOperation.hosted.vertexAIUnsupported'),
  }
}

export function isHostedProviderGap(provider: AIProvider): boolean {
  return getHostedProviderSupportIssue(provider, 'chat') !== null
}

export function isAwsBedrockHostedProvider(provider: AIProvider): boolean {
  if (isAwsBedrockProvider(provider)) return true
  return /\bbedrock\b|bedrock-runtime|bedrock\.[a-z0-9-]+\.amazonaws\.com/i.test(providerIdentityText(provider))
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
  return [
    provider.id,
    provider.name,
    provider.baseUrl,
    provider.models?.join(' '),
    provider.presetId,
    provider.detectedPresetId,
  ].filter(Boolean).join(' ')
}
