import type { AIProvider } from '@/types/providerContracts'

export type ProviderStreamingPolicyReason =
  | 'enabled'
  | 'request-disabled'
  | 'provider-disabled'
  | 'model-disabled'

export interface ProviderStreamingPolicy {
  stream: boolean
  reason: ProviderStreamingPolicyReason
}

/**
 * Resolves the effective streaming mode before route and payload assembly.
 * Provider and model opt-outs always win over the caller's default request.
 */
export function resolveProviderStreamingPolicy(input: {
  provider: Pick<AIProvider, 'capabilities'>
  requested?: boolean
  modelSupportsStreaming?: boolean
}): ProviderStreamingPolicy {
  if (input.requested === false) return { stream: false, reason: 'request-disabled' }
  if (input.provider.capabilities?.streaming === false) return { stream: false, reason: 'provider-disabled' }
  if (input.modelSupportsStreaming === false) return { stream: false, reason: 'model-disabled' }
  return { stream: true, reason: 'enabled' }
}
