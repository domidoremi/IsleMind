import type { AIProvider } from '@/types/providerContracts'

export function isLocalAIChatReplayContract(provider: AIProvider): boolean {
  return provider.type === 'openai-compatible' &&
    provider.presetId === 'localai' &&
    provider.wireProtocol !== 'anthropic-compatible'
}

export function hasLocalAIChatReasoningReplay(provider: AIProvider, message: {
  role: string
  reasoningContent?: string
  toolCalls?: readonly unknown[]
}): boolean {
  return isLocalAIChatReplayContract(provider) &&
    message.role === 'assistant' &&
    typeof message.reasoningContent === 'string' && message.reasoningContent.length > 0 &&
    Boolean(message.toolCalls?.length)
}
