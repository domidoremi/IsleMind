import { createProviderFallbackCandidateBuilder } from '@/modules/providers'
import { resolveProviderModelExecutionProfile } from './providerModelExecutionProfile'

export const buildProviderFallbackCandidates = createProviderFallbackCandidateBuilder({
  projectModel(provider, model) {
    const profile = resolveProviderModelExecutionProfile({ provider, model })
    return {
      deprecated: profile.modelConfig.deprecated === true,
      source: profile.modelConfig.source,
      upstreamModel: profile.upstreamModel,
      family: profile.manifest.family,
      capabilities: profile.modelConfig.deprecated ? [] : profile.capabilities,
    }
  },
})
