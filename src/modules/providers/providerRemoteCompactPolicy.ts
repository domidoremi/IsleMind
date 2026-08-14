import type { AIProvider } from '@/types/providerContracts'
import type { RemoteCompactMode } from '@/types/settingsContracts'
import {
  admitProviderLocalCompression,
  resolveProviderContextManagement,
  resolveProviderLocalCompressionPrivacy,
  type ProviderContextManagementCapabilityKind,
  type ProviderContextManagementStrategy,
  type ProviderLocalCompressionAdmissionReason,
  type ProviderLocalCompressionPrivacySettings,
  type ProviderRemoteCompactClassification,
} from './providerContextManagementPolicy'

export interface RemoteCompactDecisionInput {
  provider: AIProvider
  model: string
  contextPrompt?: string
  messages: { role: string; content: unknown }[]
  budgetTokens?: number
  estimatedInputTokens?: number
  settings?: {
    remoteCompactMode?: RemoteCompactMode
    remoteCompactThreshold?: number
  } & ProviderLocalCompressionPrivacySettings
  /** Explicit route evidence; undefined fails closed for native OpenAI compaction. */
  usesOpenAIResponses?: boolean
}

export interface RemoteCompactDecision {
  mode: RemoteCompactMode
  enabled: boolean
  required: boolean
  supported: boolean
  /** How context will be managed when enabled (or local when not). */
  strategy: ProviderContextManagementStrategy
  /**
   * Native vendor compact sends full history and lets the server compact.
   * Application/local strategies must pre-shrink client-side.
   */
  nativeServerCompact: boolean
  /** Evidence classification for the remote provider capability itself. */
  capabilityKind: ProviderContextManagementCapabilityKind
  /** Local fallback is never admitted while a native remote request is merely available. */
  remoteClassification: ProviderRemoteCompactClassification
  /** True only after remote-unavailable/remote-failed and a privacy allow decision. */
  localFallbackAllowed: boolean
  /** Whether privacy policy would permit local compression after a remote failure. */
  privacyAllowsLocalCompression: boolean
  localFallbackReason: ProviderLocalCompressionAdmissionReason
  reason:
    | 'disabled'
    | 'supported'
    | 'below_threshold'
    | 'provider_capability_missing'
    | 'application_model_summary'
    | 'native_openai_responses'
    | 'native_anthropic_messages'
  pressureRatio: number
}

export interface ProviderRemoteCompactPolicyDependencies {
  estimateTextTokens(text: string): number
}

export interface ProviderRemoteCompactPolicy {
  decideRemoteCompact(input: RemoteCompactDecisionInput): RemoteCompactDecision
}

export function createProviderRemoteCompactPolicy(
  dependencies: ProviderRemoteCompactPolicyDependencies,
): ProviderRemoteCompactPolicy {
  function decideRemoteCompact(input: RemoteCompactDecisionInput): RemoteCompactDecision {
    const mode = input.settings?.remoteCompactMode ?? 'auto'
    const required = mode === 'required'
    const resolution = resolveProviderContextManagement({
      provider: input.provider,
      settings: input.settings,
      usesOpenAIResponses: input.usesOpenAIResponses === true,
    })
    const pressureRatio = estimatePressureRatio(input)
    const nativeServerCompact =
      resolution.strategy === 'native-openai-responses' ||
      resolution.strategy === 'native-anthropic-messages'
    const supported = resolution.nativeSupported
    const privacy = resolveProviderLocalCompressionPrivacy(input.settings)
    const localAdmission = admitProviderLocalCompression({
      classification: resolution.remoteClassification,
      settings: input.settings,
    })

    if (mode === 'off') {
      return {
        mode,
        enabled: false,
        required,
        supported: false,
        strategy: localAdmission.allowed ? 'local-structured-v2' : 'none',
        nativeServerCompact: false,
        capabilityKind: resolution.capabilityKind,
        remoteClassification: 'remote-unavailable',
        localFallbackAllowed: localAdmission.allowed,
        privacyAllowsLocalCompression: privacy.allowed,
        localFallbackReason: localAdmission.reason,
        reason: 'disabled',
        pressureRatio,
      }
    }

    // Required means native remote compaction, never local packing re-labeled as support.
    if (required) {
      if (resolution.nativeSupported) {
        return {
          mode,
          enabled: true,
          required,
          supported: true,
          strategy: resolution.strategy,
          nativeServerCompact,
          capabilityKind: resolution.capabilityKind,
          remoteClassification: 'remote-available',
          localFallbackAllowed: false,
          privacyAllowsLocalCompression: privacy.allowed,
          localFallbackReason: 'remote-not-classified',
          reason: mapResolutionReason(resolution.reason),
          pressureRatio,
        }
      }
      return {
        mode,
        enabled: false,
        required,
        supported: false,
        strategy: 'none',
        nativeServerCompact: false,
        capabilityKind: resolution.capabilityKind,
        remoteClassification: 'remote-unavailable',
        localFallbackAllowed: false,
        privacyAllowsLocalCompression: privacy.allowed,
        localFallbackReason: localAdmission.reason,
        reason: 'provider_capability_missing',
        pressureRatio,
      }
    }

    // Auto keeps remote-first ordering: do nothing below pressure, then use
    // native compaction when available, otherwise admit local packing only
    // after the explicit remote-unavailable classification above.
    const threshold = normalizeThreshold(input.settings?.remoteCompactThreshold)
    if (pressureRatio < threshold) {
      return {
        mode,
        enabled: false,
        required,
        supported,
        strategy: resolution.strategy,
        nativeServerCompact: false,
        capabilityKind: resolution.capabilityKind,
        remoteClassification: resolution.remoteClassification,
        localFallbackAllowed: false,
        privacyAllowsLocalCompression: privacy.allowed,
        localFallbackReason: resolution.remoteClassification === 'remote-available'
          ? 'remote-not-classified'
          : localAdmission.reason,
        reason: 'below_threshold',
        pressureRatio,
      }
    }

    if (resolution.nativeSupported) {
      return {
        mode,
        enabled: true,
        required,
        supported: true,
        strategy: resolution.strategy,
        nativeServerCompact,
        capabilityKind: resolution.capabilityKind,
        remoteClassification: 'remote-available',
        localFallbackAllowed: false,
        privacyAllowsLocalCompression: privacy.allowed,
        localFallbackReason: 'remote-not-classified',
        reason: mapResolutionReason(resolution.reason),
        pressureRatio,
      }
    }

    if (localAdmission.allowed) {
      return {
        mode,
        enabled: true,
        required,
        supported: false,
        strategy: 'local-structured-v2',
        nativeServerCompact: false,
        capabilityKind: resolution.capabilityKind,
        remoteClassification: 'remote-unavailable',
        localFallbackAllowed: true,
        privacyAllowsLocalCompression: true,
        localFallbackReason: localAdmission.reason,
        reason: 'provider_capability_missing',
        pressureRatio,
      }
    }

    return {
      mode,
      enabled: false,
      required,
      supported: false,
      strategy: 'none',
      nativeServerCompact: false,
      capabilityKind: resolution.capabilityKind,
      remoteClassification: 'remote-unavailable',
      localFallbackAllowed: false,
      privacyAllowsLocalCompression: false,
      localFallbackReason: 'privacy-blocked',
      reason: 'provider_capability_missing',
      pressureRatio,
    }
  }

  function estimatePressureRatio(input: RemoteCompactDecisionInput): number {
    const budget = Math.max(1, input.budgetTokens ?? 1)
    const estimatedInput = input.estimatedInputTokens ?? estimateMessages(input.messages, input.contextPrompt)
    return Math.max(0, Math.min(2, estimatedInput / budget))
  }

  function estimateMessages(messages: { content: unknown }[], contextPrompt?: string): number {
    const messageText = messages
      .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
      .join('\n')
    return dependencies.estimateTextTokens([contextPrompt, messageText].filter(Boolean).join('\n\n'))
  }

  return { decideRemoteCompact }
}

function mapResolutionReason(
  reason: ReturnType<typeof resolveProviderContextManagement>['reason'],
): RemoteCompactDecision['reason'] {
  switch (reason) {
    case 'native_openai_responses':
      return 'native_openai_responses'
    case 'native_anthropic_messages':
      return 'native_anthropic_messages'
    case 'application_model_summary':
      return 'provider_capability_missing'
    case 'disabled':
      return 'disabled'
    case 'local_only':
      return 'supported'
    default:
      return 'provider_capability_missing'
  }
}

export function classifyProviderRemoteCompactFailure(input: {
  attempted: boolean
  signal?: AbortSignal
}): Exclude<ProviderRemoteCompactClassification, 'remote-available'> | 'cancelled' {
  if (input.signal?.aborted) return 'cancelled'
  return input.attempted ? 'remote-failed' : 'remote-unavailable'
}

export function providerRemoteCompactClassificationAllowsLocalFallback(input: {
  classification: ProviderRemoteCompactClassification
  settings?: ProviderLocalCompressionPrivacySettings
}): boolean {
  return admitProviderLocalCompression(input).allowed
}

export function estimateRemoteCompactSavedTokens(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return undefined
  return Math.max(0, Math.floor(inputTokens! * 0.55 - outputTokens!))
}

function normalizeThreshold(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0.1, Math.min(2, value!)) : 0.8
}
