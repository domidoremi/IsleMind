import {
  createProviderFallbackCandidateBuilder,
  type ProviderFallbackModelProjection,
} from '@/modules/providers'
import { resolveProviderCapabilityManifest } from '@/bootstrap/providerConformance'
import {
  providerCompatibilityCapabilityCanBeSentForProvider,
  type ProviderCompatibilityBehavior,
} from '@/modules/providers'
import { getModelConfig } from '@/types/modelCatalog'
import type { AIProvider } from '@/types/providerContracts'
import { resolveProviderModelAlias } from '@/utils/providerModels'

export const buildProviderFallbackCandidates = createProviderFallbackCandidateBuilder({
  projectModel(provider, model) {
    const config = getModelConfig(model, provider.type, provider.modelConfigs)
    if (config.deprecated === true) {
      return {
        deprecated: true,
        source: config.source,
        upstreamModel: model,
        capabilities: [],
      }
    }
    const manifest = resolveProviderCapabilityManifest({ provider, model })
    return {
      deprecated: false,
      source: config.source,
      upstreamModel: resolveProviderModelAlias(provider, model),
      family: manifest.family,
      capabilities: fallbackCapabilities(provider, manifest),
    }
  },
})

function fallbackCapabilities(
  provider: AIProvider,
  manifest: ReturnType<typeof resolveProviderCapabilityManifest>,
): ProviderFallbackModelProjection['capabilities'] {
  const capabilities = ['text']
  if (manifest.modalities.input.image && contractAllows(provider, 'vision', provider.capabilities?.vision === true)) capabilities.push('image')
  if (manifest.modalities.input.file && contractAllows(provider, 'files', provider.capabilities?.files === true)) capabilities.push('file')
  if (manifest.modalities.input.audio && contractAllows(provider, 'audio', provider.capabilities?.audioInput === true)) capabilities.push('audio')
  if (manifest.modalities.input.video) capabilities.push('video')
  if (manifest.reasoning.supported && contractAllows(provider, 'reasoning', provider.capabilities?.reasoningEffort === true)) capabilities.push('reasoning')
  if (manifest.transport.streaming && contractAllows(provider, 'streaming', provider.capabilities?.streaming === true)) capabilities.push('streaming')
  if (manifest.tools.supported && contractAllows(provider, 'tools', provider.capabilities?.nativeTools === true)) capabilities.push('tools')
  if (manifest.structuredOutput.appRequestControl) capabilities.push('structured_output')
  if (providerCompatibilityCapabilityCanBeSentForProvider(provider, 'nativeSearch', provider.capabilities?.nativeSearch === true)) capabilities.push('native_search')
  return capabilities
}

function contractAllows(
  provider: AIProvider,
  behavior: ProviderCompatibilityBehavior,
  explicitDeclaration: boolean,
): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, behavior, explicitDeclaration)
}
