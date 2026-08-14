import type { AIProvider } from '@/types/providerContracts'
import {
  MEDIA_GENERATION_ADAPTER_GATE_IDS,
  type MediaGenerationAdapterGateId,
} from '@/core/mediaGenerationContracts'
import { getChatWorkspaceRuntimePolicy } from '@/modules/workspaces'
import {
  providerCompatibilityCapabilityCanBeSentForProvider,
  type ProviderCapabilityManifest,
} from '@/modules/providers'
import { resolveProviderDisplayName } from '@/presentation/features/settings/providerPresentation'
export const CHAT_MULTIMODAL_ENTRIES = ['image', 'camera', 'file', 'voice'] as const
export const CHAT_MEDIA_GENERATION_ENTRIES = ['image-generation', 'video-generation'] as const
export const CHAT_MEDIA_GENERATION_ADAPTER_GATES = [
  { id: 'provider-capability-evidence', source: 'provider-capability-manifest', labelKey: 'chatPresentation.generationGateLabels.providerCapabilityEvidence', readiness: 'required-before-default', blocksDefaultEnablement: true },
  { id: 'generation-adapter', source: 'adapter-required', labelKey: 'chatPresentation.generationGateLabels.generationAdapter', readiness: 'required-before-default', blocksDefaultEnablement: true },
  { id: 'artifact-manifest', source: 'artifact-required', labelKey: 'chatPresentation.generationGateLabels.artifactManifest', readiness: 'required-before-default', blocksDefaultEnablement: true },
  { id: 'retention-cleanup', source: 'privacy-retention', labelKey: 'chatPresentation.generationGateLabels.retentionCleanup', readiness: 'required-before-default', blocksDefaultEnablement: true },
  { id: 'cancellation-semantics', source: 'runtime-control', labelKey: 'chatPresentation.generationGateLabels.cancellationSemantics', readiness: 'required-before-default', blocksDefaultEnablement: true },
  { id: 'native-mobile-proof', source: 'native-evidence', labelKey: 'chatPresentation.generationGateLabels.nativeMobileProof', readiness: 'required-before-default', blocksDefaultEnablement: true },
] as const

export type ChatMultimodalEntry = typeof CHAT_MULTIMODAL_ENTRIES[number]
export type ChatMediaGenerationEntry = typeof CHAT_MEDIA_GENERATION_ENTRIES[number]
export type ChatMediaGenerationAdapterGateId = MediaGenerationAdapterGateId
export type ChatMediaGenerationGateReadiness = typeof CHAT_MEDIA_GENERATION_ADAPTER_GATES[number]['readiness'] | 'satisfied'
export type ChatMultimodalRequirement = 'image-input' | 'file-input' | 'audio-transcription' | 'media-generation-adapter'
export type ChatMultimodalSource = 'provider-capability-manifest' | 'provider-missing' | 'adapter-required'

export const CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS: ChatMediaGenerationAdapterGateId[] = [
  ...MEDIA_GENERATION_ADAPTER_GATE_IDS,
]

export function getChatMediaGenerationGateMetadata(gateId: ChatMediaGenerationAdapterGateId): typeof CHAT_MEDIA_GENERATION_ADAPTER_GATES[number] {
  return CHAT_MEDIA_GENERATION_ADAPTER_GATES.find((gate) => gate.id === gateId) ?? CHAT_MEDIA_GENERATION_ADAPTER_GATES[0]
}

export interface ChatMediaGenerationGateReadinessSummary {
  ready: number
  total: number
  blockedGateIds: readonly ChatMediaGenerationAdapterGateId[]
}

export function summarizeChatMediaGenerationGateReadiness(
  gateIds: readonly ChatMediaGenerationAdapterGateId[] = CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS,
): ChatMediaGenerationGateReadinessSummary {
  const blockedGateIds = gateIds.filter((gateId) => {
    const gate = getChatMediaGenerationGateMetadata(gateId)
    const readiness = gate.readiness as ChatMediaGenerationGateReadiness
    return gate.blocksDefaultEnablement && readiness !== 'satisfied'
  })
  return {
    ready: Math.max(0, gateIds.length - blockedGateIds.length),
    total: gateIds.length,
    blockedGateIds,
  }
}

export interface ChatMultimodalEntryPolicy<Entry extends ChatMultimodalEntry | ChatMediaGenerationEntry = ChatMultimodalEntry> {
  entry: Entry
  available: boolean
  requirement: ChatMultimodalRequirement
  source: ChatMultimodalSource
  adapterGateIds?: readonly ChatMediaGenerationAdapterGateId[]
  reasonKey?: string
  reasonParams?: Record<string, string>
}

export interface ChatMultimodalPolicy {
  memoryScope: ReturnType<typeof getChatWorkspaceRuntimePolicy>['memoryScope']
  providerId?: string
  providerName?: string
  model?: string
  entries: Record<ChatMultimodalEntry, ChatMultimodalEntryPolicy>
  generationEntries: Record<ChatMediaGenerationEntry, ChatMultimodalEntryPolicy<ChatMediaGenerationEntry>>
  generationGateIds: readonly ChatMediaGenerationAdapterGateId[]
  generationGateReadinessSummary: ChatMediaGenerationGateReadinessSummary
  unavailableCount: number
  generationUnavailableCount: number
}

export interface ResolveChatMultimodalPolicyInput {
  provider?: AIProvider | null
  model?: string | null
  resolveProviderCapabilityManifest(input: {
    provider: AIProvider
    model: string
  }): Pick<ProviderCapabilityManifest, 'modalities'>
}

export function resolveChatMultimodalPolicy(input: ResolveChatMultimodalPolicyInput): ChatMultimodalPolicy {
  const runtimePolicy = getChatWorkspaceRuntimePolicy()
  const provider = input.provider ?? null
  const model = input.model?.trim() || provider?.models[0] || ''
  const manifest = provider && model
    ? input.resolveProviderCapabilityManifest({ provider, model })
    : null
  const providerDisplayName = provider
    ? resolveProviderDisplayName(provider, provider.name)
    : undefined

  const entries = CHAT_MULTIMODAL_ENTRIES.reduce((result, entry) => {
    result[entry] = resolveEntryPolicy(entry, provider, model, manifest, providerDisplayName)
    return result
  }, {} as Record<ChatMultimodalEntry, ChatMultimodalEntryPolicy>)
  const generationEntries = CHAT_MEDIA_GENERATION_ENTRIES.reduce((result, entry) => {
    result[entry] = resolveMediaGenerationPolicy(entry, provider, model, providerDisplayName)
    return result
  }, {} as ChatMultimodalPolicy['generationEntries'])
  const generationGateReadinessSummary = summarizeChatMediaGenerationGateReadiness(CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS)

  return {
    memoryScope: runtimePolicy.memoryScope,
    providerId: provider?.id,
    providerName: providerDisplayName,
    model: model || undefined,
    entries,
    generationEntries,
    generationGateIds: CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS,
    generationGateReadinessSummary,
    unavailableCount: CHAT_MULTIMODAL_ENTRIES.filter((entry) => !entries[entry].available).length,
    generationUnavailableCount: CHAT_MEDIA_GENERATION_ENTRIES.filter((entry) => !generationEntries[entry].available).length,
  }
}

function resolveEntryPolicy(
  entry: ChatMultimodalEntry,
  provider: AIProvider | null,
  model: string,
  manifest: Pick<ProviderCapabilityManifest, 'modalities'> | null,
  providerDisplayName?: string,
): ChatMultimodalEntryPolicy {
  const requirement = requirementForEntry(entry)
  const reasonParams = provider ? { provider: providerDisplayName ?? provider.name, model } : undefined

  if (!provider || !manifest) {
    return unavailable(entry, requirement, 'provider-missing', 'chat.multimodalUnavailableNoProvider', reasonParams)
  }

  if ((entry === 'image' || entry === 'camera') && !manifest.modalities.input.image) {
    return unavailable(entry, requirement, 'provider-capability-manifest', 'chat.multimodalUnavailableImage', reasonParams)
  }

  if (entry === 'file' && !manifest.modalities.input.file) {
    return unavailable(entry, requirement, 'provider-capability-manifest', 'chat.multimodalUnavailableFile', reasonParams)
  }

  if (entry === 'voice' && !providerSupportsAudioTranscription(provider)) {
    return unavailable(entry, requirement, 'provider-capability-manifest', 'chat.multimodalUnavailableVoice', reasonParams)
  }

  return {
    entry,
    available: true,
    requirement,
    source: 'provider-capability-manifest',
  }
}

function resolveMediaGenerationPolicy(
  entry: ChatMediaGenerationEntry,
  provider: AIProvider | null,
  model: string,
  providerDisplayName?: string,
): ChatMultimodalEntryPolicy<ChatMediaGenerationEntry> {
  return {
    ...unavailable(
      entry,
      'media-generation-adapter',
      'adapter-required',
      'chat.multimodalGenerationAdapterRequired',
      provider ? { provider: providerDisplayName ?? provider.name, model } : undefined,
    ),
    adapterGateIds: CHAT_MEDIA_GENERATION_ADAPTER_GATE_IDS,
  }
}

function requirementForEntry(entry: ChatMultimodalEntry): ChatMultimodalRequirement {
  if (entry === 'file') return 'file-input'
  if (entry === 'voice') return 'audio-transcription'
  return 'image-input'
}

function unavailable<Entry extends ChatMultimodalEntry | ChatMediaGenerationEntry>(
  entry: Entry,
  requirement: ChatMultimodalRequirement,
  source: ChatMultimodalSource,
  reasonKey: string,
  reasonParams?: Record<string, string>
): ChatMultimodalEntryPolicy<Entry> {
  return {
    entry,
    available: false,
    requirement,
    source,
    reasonKey,
    reasonParams,
  }
}

function providerSupportsAudioTranscription(provider: AIProvider): boolean {
  const declared = provider.capabilities?.audioTranscription === true ||
    (provider.type === 'google' && provider.capabilities?.audioInput === true)
  return declared && providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)
}
