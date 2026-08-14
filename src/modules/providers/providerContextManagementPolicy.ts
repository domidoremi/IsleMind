import type { AIProvider } from '@/types/providerContracts'
import type { RemoteCompactMode } from '@/types/settingsContracts'
import {
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  providerNativeRemoteCompactEvidenceMatchesProvider,
} from './providerCompatibilityCatalog'

/**
 * Protocol-aware context management strategy.
 * Native strategies map to vendor-documented request fields.
 * application-model-summary remains a compatibility literal, but is not
 * selected without an explicit unavailable/failed admission and privacy gate.
 */
export type ProviderContextManagementStrategy =
  | 'native-openai-responses'
  | 'native-anthropic-messages'
  | 'application-model-summary'
  | 'local-structured-v2'
  | 'none'

export type ProviderContextManagementCapabilityKind =
  | 'native-compaction'
  | 'caching'
  | 'unknown'
  | 'unsupported'

export type ProviderRemoteCompactClassification =
  | 'remote-available'
  | 'remote-unavailable'
  | 'remote-failed'

export type ProviderLocalCompressionAdmissionReason =
  | 'privacy-allowed'
  | 'privacy-blocked'
  | 'remote-not-classified'

export interface ProviderLocalCompressionPrivacySettings {
  /** Canonical provider-owned privacy switch. Explicit false always wins. */
  localCompressionAllowed?: boolean
  /** Backward-compatible alias for callers that already expose this spelling. */
  allowLocalCompression?: boolean
  /** Optional stricter policy spelling for future settings composition. */
  localContextCompressionAllowed?: boolean
  privacyMode?: string
  contextCompressionPrivacyMode?: string
  privacy?: {
    localCompressionAllowed?: boolean
    allowLocalCompression?: boolean
    mode?: string
  }
}

export interface ProviderLocalCompressionAdmission {
  allowed: boolean
  privacyAllowed: boolean
  reason: ProviderLocalCompressionAdmissionReason
}

export interface ProviderContextManagementResolution {
  strategy: ProviderContextManagementStrategy
  nativeSupported: boolean
  applicationSupported: boolean
  capabilityKind: ProviderContextManagementCapabilityKind
  remoteClassification: Exclude<ProviderRemoteCompactClassification, 'remote-failed'>
  reason:
    | 'disabled'
    | 'native_openai_responses'
    | 'native_anthropic_messages'
    | 'application_model_summary'
    | 'local_only'
    | 'provider_capability_missing'
    | 'caching'
    | 'unknown'
    | 'unsupported'
}

export interface ResolveProviderContextManagementInput {
  provider: AIProvider
  settings?: {
    remoteCompactMode?: RemoteCompactMode
  } & ProviderLocalCompressionPrivacySettings
  /**
   * Explicit route evidence for this request/model. Native OpenAI compaction is
   * admitted only when this is true; false or undefined fail closed.
   */
  usesOpenAIResponses?: boolean
}

export function resolveProviderContextManagement(
  input: ResolveProviderContextManagementInput,
): ProviderContextManagementResolution {
  const mode = input.settings?.remoteCompactMode ?? 'auto'
  const capabilityKind = resolveProviderContextManagementCapabilityKind(input.provider)
  if (mode === 'off') {
    return {
      strategy: 'none',
      nativeSupported: false,
      applicationSupported: false,
      capabilityKind,
      remoteClassification: 'remote-unavailable',
      reason: 'disabled',
    }
  }

  const native = resolveNativeContextManagement(input)
  if (native) return native

  // A chat-capable provider is not automatically a compaction provider. Local
  // packing is admitted later, only after this explicit unavailable result and
  // only when the provider-owned privacy policy allows it.
  return {
    strategy: 'local-structured-v2',
    nativeSupported: false,
    applicationSupported: false,
    capabilityKind,
    remoteClassification: 'remote-unavailable',
    reason: capabilityKind === 'caching'
      ? 'caching'
      : capabilityKind === 'unknown'
        ? 'unknown'
        : 'unsupported',
  }
}

export function resolveProviderContextManagementCapabilityKind(
  provider: Pick<AIProvider, 'id' | 'type' | 'presetId' | 'detectedPresetId' | 'wireProtocol'>,
): ProviderContextManagementCapabilityKind {
  if (providerNativeRemoteCompactEvidenceMatchesProvider(provider)) return 'native-compaction'
  const evidenceId = getProviderCompatibilityEvidenceForProvider(provider).id
  if (provider.type === 'google' || evidenceId === 'google') return 'caching'
  if (evidenceId === 'openrouter' || evidenceId === 'xai') return 'unknown'
  return 'unsupported'
}

export function resolveProviderLocalCompressionPrivacy(
  settings: ProviderLocalCompressionPrivacySettings | undefined,
): { allowed: boolean; reason: 'privacy-allowed' | 'privacy-blocked' } {
  const explicit = firstDefinedBoolean([
    settings?.localCompressionAllowed,
    settings?.allowLocalCompression,
    settings?.localContextCompressionAllowed,
    settings?.privacy?.localCompressionAllowed,
    settings?.privacy?.allowLocalCompression,
  ])
  const mode = [
    settings?.contextCompressionPrivacyMode,
    settings?.privacyMode,
    settings?.privacy?.mode,
  ].find((value): value is string => typeof value === 'string')?.trim().toLowerCase()
  const modeBlocksLocal = mode === 'remote-only' || mode === 'strict-remote' || mode === 'strict'
  const allowed = explicit !== false && !modeBlocksLocal
  return {
    allowed,
    reason: allowed ? 'privacy-allowed' : 'privacy-blocked',
  }
}

export function admitProviderLocalCompression(input: {
  classification: ProviderRemoteCompactClassification
  settings?: ProviderLocalCompressionPrivacySettings
}): ProviderLocalCompressionAdmission {
  const privacy = resolveProviderLocalCompressionPrivacy(input.settings)
  if (input.classification === 'remote-available') {
    return {
      allowed: false,
      privacyAllowed: privacy.allowed,
      reason: 'remote-not-classified',
    }
  }
  return {
    allowed: privacy.allowed,
    privacyAllowed: privacy.allowed,
    reason: privacy.reason,
  }
}

function resolveNativeContextManagement(
  input: ResolveProviderContextManagementInput,
): ProviderContextManagementResolution | null {
  const provider = input.provider
  const remoteDeclared = provider.capabilities?.remoteCompact === true
  const remoteAllowed = providerCompatibilityCapabilityCanBeSentForProvider(
    provider,
    'remoteCompact',
    remoteDeclared,
  )

  if (provider.type === 'anthropic' && provider.wireProtocol === undefined) {
    if (remoteDeclared && remoteAllowed) {
      return {
        strategy: 'native-anthropic-messages',
        nativeSupported: true,
        applicationSupported: false,
        capabilityKind: 'native-compaction',
        remoteClassification: 'remote-available',
        reason: 'native_anthropic_messages',
      }
    }
    return null
  }

  const responsesDeclared = provider.capabilities?.responsesApi === true
  const responsesAllowed = providerCompatibilityCapabilityCanBeSentForProvider(
    provider,
    'responsesApi',
    responsesDeclared,
  )
  const usesResponses = input.usesOpenAIResponses === true

  if (
    provider.type === 'openai' &&
    provider.wireProtocol === undefined &&
    usesResponses &&
    responsesDeclared &&
    responsesAllowed &&
    remoteDeclared &&
    remoteAllowed
  ) {
    return {
      strategy: 'native-openai-responses',
      nativeSupported: true,
      applicationSupported: false,
      capabilityKind: 'native-compaction',
      remoteClassification: 'remote-available',
      reason: 'native_openai_responses',
    }
  }

  return null
}

function firstDefinedBoolean(values: readonly (boolean | undefined)[]): boolean | undefined {
  if (values.some((value) => value === false)) return false
  if (values.some((value) => value === true)) return true
  return undefined
}

/** Anthropic Messages server-side compaction (beta compact-2026-01-12). */
export const ANTHROPIC_COMPACTION_BETA = 'compact-2026-01-12'
export const ANTHROPIC_COMPACTION_EDIT_TYPE = 'compact_20260112'

export function buildAnthropicNativeContextManagement(input: {
  thresholdTokens?: number
  instructions?: string
}): Record<string, unknown> {
  const threshold = Math.max(1_000, Math.floor(input.thresholdTokens ?? 150_000))
  const edit: Record<string, unknown> = {
    type: ANTHROPIC_COMPACTION_EDIT_TYPE,
    trigger: { type: 'input_tokens', value: threshold },
  }
  if (input.instructions?.trim()) edit.instructions = input.instructions.trim()
  return { edits: [edit] }
}

/** OpenAI Responses server-side compaction field (documented context_management). */
export function buildOpenAIResponsesNativeContextManagement(input: {
  thresholdTokens?: number
}): Record<string, unknown>[] {
  return [
    {
      type: 'compaction',
      compact_threshold: Math.max(1_000, Math.floor(input.thresholdTokens ?? 200_000)),
    },
  ]
}
