import type { AIProvider, ProviderCredentialGroup } from '@/types'
import { getModelConfig } from '@/types'
import { resolveProviderCapabilityManifest } from '@/services/ai/providerConformance'
import type { ProviderFailoverCandidate, ProviderFailoverRoute } from '@/services/ai/providerFailover'
import type { ProviderHealthRecord } from '@/services/ai/providerHealth'
import { annotateFailoverCandidatesWithHealth } from '@/services/ai/providerHealth'
import {
  providerCompatibilityCapabilityCanBeSentForProvider,
  type ProviderCompatibilityBehavior,
} from '@/services/ai/providerCompatibilityContract'
import { resolveProviderModelAlias } from '@/utils/providerModels'

export const PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA = 'islemind.provider-fallback-candidate-build.v1'

export type ProviderFallbackCandidateRejectionReason =
  | 'provider_disabled'
  | 'no_candidate_models'
  | 'model_deprecated'
  | 'no_enabled_credentials'
  | 'credential_disabled'
  | 'credential_missing'
  | 'model_not_available_for_credential'
  | 'capability_mismatch'

export interface ProviderFallbackCandidateRejection {
  providerId: string
  model?: string
  credentialGroupId?: string
  reason: ProviderFallbackCandidateRejectionReason
}

export interface ProviderFallbackCandidateBuildInput {
  providers: AIProvider[]
  original: ProviderFailoverRoute
  requiredCapabilities?: string[]
  healthRecords?: Record<string, ProviderHealthRecord>
  nowMs?: number
  includeDisabledProviders?: boolean
  includeDisabledCredentials?: boolean
  maxModelsPerProvider?: number
}

export interface ProviderFallbackCandidateBuildResult {
  schema: typeof PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA
  candidates: ProviderFailoverCandidate[]
  rejectedCandidates: ProviderFallbackCandidateRejection[]
  evidence: {
    providerCount: number
    modelCount: number
    credentialGroupCount: number
    requiredCapabilities: string[]
  }
}

export function buildProviderFallbackCandidates(input: ProviderFallbackCandidateBuildInput): ProviderFallbackCandidateBuildResult {
  const rejectedCandidates: ProviderFallbackCandidateRejection[] = []
  const candidates: ProviderFailoverCandidate[] = []
  const requiredCapabilities = input.requiredCapabilities ?? []
  let modelCount = 0
  let credentialGroupCount = 0

  for (const provider of input.providers) {
    if (!provider.enabled && input.includeDisabledProviders !== true) {
      rejectedCandidates.push({ providerId: provider.id, reason: 'provider_disabled' })
      continue
    }

    const models = candidateModelIds(provider).slice(0, input.maxModelsPerProvider ?? 20)
    modelCount += models.length
    if (!models.length) {
      rejectedCandidates.push({ providerId: provider.id, reason: 'no_candidate_models' })
      continue
    }

    const credentialGroups = candidateCredentialGroups(provider)
    credentialGroupCount += credentialGroups.length
    if (!credentialGroups.some((group) => group.enabled || input.includeDisabledCredentials === true)) {
      rejectedCandidates.push({ providerId: provider.id, reason: 'no_enabled_credentials' })
      continue
    }

    for (const model of models) {
      const config = getModelConfig(model, provider.type, provider.modelConfigs)
      if (config.deprecated === true) {
        rejectedCandidates.push({ providerId: provider.id, model, reason: 'model_deprecated' })
        continue
      }

      const manifest = resolveProviderCapabilityManifest({ provider, model })
      const capabilities = capabilityList(provider, manifest)
      if (!capabilitiesSatisfied(requiredCapabilities, capabilities)) {
        rejectedCandidates.push({ providerId: provider.id, model, reason: 'capability_mismatch' })
        continue
      }

      for (const group of credentialGroups) {
        const credentialReason = rejectCredential(provider, model, group, input.includeDisabledCredentials === true)
        if (credentialReason) {
          rejectedCandidates.push({ providerId: provider.id, model, credentialGroupId: group.id, reason: credentialReason })
          continue
        }
        candidates.push({
          providerId: provider.id,
          model,
          credentialGroupId: group.id,
          family: manifest.family,
          region: provider.tokenPlanRegion,
          costTier: inferCostTier(model, config.source),
          capabilities,
        })
      }
    }
  }

  const annotatedCandidates = input.healthRecords
    ? annotateFailoverCandidatesWithHealth(candidates, input.healthRecords, input.nowMs ?? Date.now())
    : candidates

  return {
    schema: PROVIDER_FALLBACK_CANDIDATE_BUILD_SCHEMA,
    candidates: dedupeCandidates(annotatedCandidates),
    rejectedCandidates,
    evidence: {
      providerCount: input.providers.length,
      modelCount,
      credentialGroupCount,
      requiredCapabilities,
    },
  }
}

function candidateModelIds(provider: AIProvider): string[] {
  return uniqueStrings([
    ...provider.models,
    ...(provider.manualModels ?? []),
    ...(provider.modelConfigs ?? []).map((model) => model.id),
    ...(provider.modelAvailability ?? []).map((item) => item.modelId),
    ...(provider.modelAliases ?? []).map((item) => item.model),
  ])
}

function candidateCredentialGroups(provider: AIProvider): ProviderCredentialGroup[] {
  if (provider.credentialGroups?.length) return provider.credentialGroups
  if (!provider.apiKey?.trim()) return []
  return [{
    id: 'default',
    label: 'Default',
    apiKey: provider.apiKey,
    enabled: true,
    availableModels: [],
  }]
}

function rejectCredential(
  provider: AIProvider,
  model: string,
  group: ProviderCredentialGroup,
  includeDisabledCredentials: boolean,
): ProviderFallbackCandidateRejectionReason | undefined {
  if (!group.enabled && !includeDisabledCredentials) return 'credential_disabled'
  if (!group.apiKey?.trim() && !provider.apiKey?.trim()) return 'credential_missing'
  if (!credentialCanUseModel(provider, model, group)) return 'model_not_available_for_credential'
  return undefined
}

function credentialCanUseModel(provider: AIProvider, model: string, group: ProviderCredentialGroup): boolean {
  if (!group.availableModels?.length) return true
  const upstreamModel = resolveProviderModelAlias(provider, model)
  return group.availableModels.includes(model) || group.availableModels.includes(upstreamModel)
}

function capabilityList(provider: AIProvider, manifest: ReturnType<typeof resolveProviderCapabilityManifest>): string[] {
  const capabilities = ['text']
  if (manifest.modalities.input.image && providerFallbackContractAllows(provider, 'vision', provider.capabilities?.vision === true)) capabilities.push('image')
  if (manifest.modalities.input.file && providerFallbackContractAllows(provider, 'files', provider.capabilities?.files === true)) capabilities.push('file')
  if (manifest.modalities.input.audio && providerFallbackContractAllows(provider, 'audio', provider.capabilities?.audioInput === true)) capabilities.push('audio')
  if (manifest.modalities.input.video) capabilities.push('video')
  if (manifest.reasoning.supported && providerFallbackContractAllows(provider, 'reasoning', provider.capabilities?.reasoningEffort === true)) capabilities.push('reasoning')
  if (manifest.transport.streaming && providerFallbackContractAllows(provider, 'streaming', provider.capabilities?.streaming === true)) capabilities.push('streaming')
  if (manifest.tools.supported && providerFallbackContractAllows(provider, 'tools', provider.capabilities?.nativeTools === true)) capabilities.push('tools')
  if (manifest.structuredOutput.appRequestControl) capabilities.push('structured_output')
  if (providerCompatibilityCapabilityCanBeSentForProvider(provider, 'nativeSearch', provider.capabilities?.nativeSearch === true)) capabilities.push('native_search')
  return capabilities
}

function providerFallbackContractAllows(
  provider: AIProvider,
  behavior: ProviderCompatibilityBehavior,
  explicitDeclaration: boolean,
): boolean {
  return providerCompatibilityCapabilityCanBeSentForProvider(provider, behavior, explicitDeclaration)
}

function capabilitiesSatisfied(required: string[], available: string[]): boolean {
  if (!required.length) return true
  const availableSet = new Set(available)
  return required.every((capability) => availableSet.has(capability))
}

function inferCostTier(model: string, source?: string): ProviderFailoverCandidate['costTier'] {
  const normalized = model.toLowerCase()
  if (source === 'inferred') return 'unknown'
  if (/nano|mini|lite|flash|haiku/.test(normalized)) return 'low'
  if (/opus|pro|max/.test(normalized)) return 'high'
  return 'medium'
}

function dedupeCandidates(candidates: ProviderFailoverCandidate[]): ProviderFailoverCandidate[] {
  const seen = new Set<string>()
  const result: ProviderFailoverCandidate[] = []
  for (const candidate of candidates) {
    const key = [
      candidate.providerId,
      candidate.model,
      candidate.credentialGroupId ?? '*',
      candidate.region ?? '*',
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }
  return result
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}
