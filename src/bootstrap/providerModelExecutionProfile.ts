import {
  createProviderProtocolAdapterPolicy,
  providerCompatibilityCapabilityCanBeSentForProvider as canSend,
  type ProviderFallbackModelProjection,
  type ProviderRuntimeChatRequest,
} from '@/modules/providers'
import { resolveProviderCapabilityManifest } from './providerConformance'
import { usesOpenAIResponses } from './providerRequestPolicies'
import { getModelConfig } from '@/types/modelCatalog'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { providerModelCapabilityCanBeSent } from './providerCapabilityMatrix'

// One selector for request serialization and request-local profile projection.
// Connection, credentials and persisted model preference stay provider-owned.
export const providerProtocolAdapterPolicy = createProviderProtocolAdapterPolicy<ProviderRuntimeChatRequest>({
  usesOpenAIResponses: request => usesOpenAIResponses({ ...request, model: resolveProviderModelAlias(request.provider, request.requestedModel ?? request.model) }),
})

type ProfileRequest = Pick<ProviderRuntimeChatRequest, 'provider' | 'model' | 'requestedModel' | 'reasoningEffort' | 'attachments' | 'webSearchMode'>

export function resolveProviderModelExecutionProfile(input: ProfileRequest) {
  const { provider } = input
  const requestedModel = input.requestedModel ?? input.model
  const model = resolveProviderModelAlias(provider, requestedModel)
  const request = { ...input, model, requestedModel }
  const modelConfig = getModelConfig(model, provider.type, provider.modelConfigs)
  const adapter = providerProtocolAdapterPolicy.resolve(request as ProviderRuntimeChatRequest)
  const raw = resolveProviderCapabilityManifest({ ...request, protocolAdapterId: adapter.id })
  const capabilities: ProviderFallbackModelProjection['capabilities'] = ['text']
  if (raw.modalities.input.image && canSend(provider, 'vision', provider.capabilities?.vision === true)) capabilities.push('image')
  if (raw.modalities.input.file && canSend(provider, 'files', provider.capabilities?.files === true)) capabilities.push('file')
  if (raw.modalities.input.audio && canSend(provider, 'audio', provider.capabilities?.audioInput === true)) capabilities.push('audio')
  if (raw.modalities.input.video) capabilities.push('video')
  if (raw.reasoning.supported && canSend(provider, 'reasoning', provider.capabilities?.reasoningEffort === true)) capabilities.push('reasoning')
  if (raw.transport.streaming && canSend(provider, 'streaming', provider.capabilities?.streaming === true)) capabilities.push('streaming')
  if (raw.tools.supported && canSend(provider, 'tools', provider.capabilities?.nativeTools === true)) capabilities.push('tools')
  if (raw.structuredOutput.appRequestControl) capabilities.push('structured_output')
  if (providerModelCapabilityCanBeSent(provider, model, 'nativeSearch')) capabilities.push('native_search')
  const manifest = {
    ...raw,
    modalities: { ...raw.modalities, input: { ...raw.modalities.input,
      image: capabilities.includes('image'), file: capabilities.includes('file'), audio: capabilities.includes('audio') } },
    reasoning: { ...raw.reasoning, supported: capabilities.includes('reasoning'),
      selectableEfforts: capabilities.includes('reasoning') ? raw.reasoning.selectableEfforts : [] },
    transport: { ...raw.transport, streaming: capabilities.includes('streaming') },
    tools: { ...raw.tools, supported: capabilities.includes('tools'),
      nativeWebSearchToolType: capabilities.includes('native_search') ? raw.tools.nativeWebSearchToolType : undefined },
  }
  return {
    providerId: provider.id,
    selectedModel: requestedModel,
    upstreamModel: model,
    modelConfig,
    adapter,
    manifest,
    capabilities,
  }
}

export function resolveEffectiveProviderCapabilityManifest(input: ProfileRequest) {
  return resolveProviderModelExecutionProfile(input).manifest
}
