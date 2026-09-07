import type { AIProvider } from '@/types/providerContracts'

export interface ProviderRemoteCompactThresholdSettings {
  readonly remoteCompactThresholdTokens?: number
  readonly anthropicRemoteCompactThresholdTokens?: number
  readonly openAIRemoteCompactThresholdTokens?: number
}

export type ProviderRemoteCompactThresholdKind = 'anthropic' | 'openai' | 'default'

export const DEFAULT_ANTHROPIC_REMOTE_COMPACT_THRESHOLD_TOKENS = 150_000
export const DEFAULT_OPENAI_REMOTE_COMPACT_THRESHOLD_TOKENS = 200_000
export const MIN_ANTHROPIC_REMOTE_COMPACT_THRESHOLD_TOKENS = 50_000

/**
 * Resolve the threshold for the actual wire provider rather than sharing one
 * legacy setting across vendors.  The legacy value remains an explicit
 * compatibility override for existing installations.
 */
export function resolveProviderRemoteCompactThresholdTokens(
  input: {
    readonly provider?: Pick<AIProvider, 'type'> | { readonly type?: unknown }
    readonly providerType?: unknown
    readonly settings?: ProviderRemoteCompactThresholdSettings
  },
): number {
  const type = input.provider?.type ?? input.providerType
  if (type === 'anthropic') {
    return Math.max(
      MIN_ANTHROPIC_REMOTE_COMPACT_THRESHOLD_TOKENS,
      finitePositive(input.settings?.anthropicRemoteCompactThresholdTokens)
      ?? finitePositive(input.settings?.remoteCompactThresholdTokens)
      ?? DEFAULT_ANTHROPIC_REMOTE_COMPACT_THRESHOLD_TOKENS,
    )
  }
  if (type === 'openai') {
    return finitePositive(input.settings?.openAIRemoteCompactThresholdTokens)
      ?? finitePositive(input.settings?.remoteCompactThresholdTokens)
      ?? DEFAULT_OPENAI_REMOTE_COMPACT_THRESHOLD_TOKENS
  }
  return finitePositive(input.settings?.remoteCompactThresholdTokens)
    ?? DEFAULT_OPENAI_REMOTE_COMPACT_THRESHOLD_TOKENS
}

export function providerRemoteCompactThresholdKind(
  providerType: unknown,
): ProviderRemoteCompactThresholdKind {
  if (providerType === 'anthropic') return 'anthropic'
  if (providerType === 'openai') return 'openai'
  return 'default'
}

function finitePositive(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== undefined && value > 0
    ? Math.floor(value)
    : undefined
}
