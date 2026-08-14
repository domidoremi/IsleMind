import type { AIProvider, ProviderCredentialGroup } from '@/types/providerContracts'
import type { ProviderFailoverCandidate, ProviderFailoverRoute } from './providerFailoverPolicy'
import { annotateFailoverCandidatesWithHealth, type ProviderHealthRecord } from './providerHealth'

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

export interface ProviderFallbackCandidateBuildRejection {
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
  rejectedCandidates: ProviderFallbackCandidateBuildRejection[]
  evidence: {
    providerCount: number
    modelCount: number
    credentialGroupCount: number
    requiredCapabilities: string[]
  }
}

export interface ProviderFallbackModelProjection {
  deprecated: boolean
  source?: string
  upstreamModel: string
  family?: string
  capabilities: string[]
}

export interface ProviderFallbackCandidateBuilderDependencies {
  projectModel(provider: AIProvider, model: string): ProviderFallbackModelProjection
}

export type ProviderFallbackCandidateBuilder = (
  input: ProviderFallbackCandidateBuildInput,
) => ProviderFallbackCandidateBuildResult

export function createProviderFallbackCandidateBuilder(
  dependencies: ProviderFallbackCandidateBuilderDependencies,
): ProviderFallbackCandidateBuilder {
  return (input) => {
    const rejectedCandidates: ProviderFallbackCandidateBuildRejection[] = []
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
        const projection = dependencies.projectModel(provider, model)
        if (projection.deprecated) {
          rejectedCandidates.push({ providerId: provider.id, model, reason: 'model_deprecated' })
          continue
        }

        if (!capabilitiesSatisfied(requiredCapabilities, projection.capabilities)) {
          rejectedCandidates.push({ providerId: provider.id, model, reason: 'capability_mismatch' })
          continue
        }

        for (const group of credentialGroups) {
          const credentialReason = rejectCredential(
            provider,
            model,
            projection.upstreamModel,
            group,
            input.includeDisabledCredentials === true,
          )
          if (credentialReason) {
            rejectedCandidates.push({ providerId: provider.id, model, credentialGroupId: group.id, reason: credentialReason })
            continue
          }
          candidates.push({
            providerId: provider.id,
            model,
            credentialGroupId: group.id,
            family: projection.family,
            region: provider.tokenPlanRegion,
            costTier: inferCostTier(model, projection.source),
            capabilities: projection.capabilities,
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
  upstreamModel: string,
  group: ProviderCredentialGroup,
  includeDisabledCredentials: boolean,
): ProviderFallbackCandidateRejectionReason | undefined {
  if (!group.enabled && !includeDisabledCredentials) return 'credential_disabled'
  if (!group.apiKey?.trim() && !provider.apiKey?.trim()) return 'credential_missing'
  if (!credentialCanUseModel(model, upstreamModel, group)) return 'model_not_available_for_credential'
  return undefined
}

function credentialCanUseModel(
  model: string,
  upstreamModel: string,
  group: ProviderCredentialGroup,
): boolean {
  if (!group.availableModels?.length) return true
  return group.availableModels.includes(model) || group.availableModels.includes(upstreamModel)
}

function capabilitiesSatisfied(required: string[], available: string[]): boolean {
  if (!required.length) return true
  const availableSet = new Set(available)
  return required.every((capability) => availableSet.has(capability))
}

function inferCostTier(model: string, source?: string): ProviderFailoverCandidate['costTier'] {
  const normalized = model.toLowerCase()
  if (/nano|mini|lite|flash|haiku/.test(normalized)) return 'low'
  if (/opus|pro|max/.test(normalized)) return 'high'
  if (source === 'inferred') return 'unknown'
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
