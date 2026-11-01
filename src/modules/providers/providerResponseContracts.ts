import type { MessageUsage } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import type { ChatErrorCode } from '@/types/providerContracts'
import type { ProviderCitation } from './providerCitations'
import type { ProviderToolCall } from './providerToolCalls'

// Shared data contracts must not depend on parsing or lifecycle implementations.
export type ProviderStreamProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'google'

export interface ProviderStreamOutcome {
  status: 'completed' | 'failed' | 'incomplete' | 'interrupted'
  protocol: ProviderStreamProtocol
  reason: string
  message?: string
  code?: ChatErrorCode
  httpStatus?: number
}

export interface ProviderResponseParsingResult {
  text: string
  usage?: MessageUsage
  citations?: ProviderCitation[]
  traces?: ProcessTrace[]
  providerToolCalls?: ProviderToolCall[]
  reasoningContent?: string
  responseItems?: Record<string, unknown>[]
  providerContentBlocks?: Record<string, unknown>[]
  googleContentParts?: Record<string, unknown>[]
  credentialGroupId?: string
  responseId?: string
  remoteCompactFallbackUsed?: boolean
  remoteCompactFallbackReason?: string
  streamOutcome?: ProviderStreamOutcome
}
