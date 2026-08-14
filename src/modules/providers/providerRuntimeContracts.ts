import type { Attachment, MessageUsage } from '@/types/chatContracts'
import type { MessageCitation, RetrievalSource } from '@/types/contextContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { WebSearchMode } from '@/types/settingsContracts'
import type { GenerationParameterSources, ProcessTrace, ReasoningEffort } from '@/core'

import type { ProviderContentPart } from './providerContentParts'
import type { ProviderModelTestEvidenceResult } from './providerModelTestEvidence'
import type { ProviderAudioTranscriptionInput, ProviderSpeechInput } from './providerMediaAdapter'
import type { ProviderResponseParsingResult } from './providerResponseParsing'
import type { ProviderRequestParameterPlan } from './providerRequestParameterPolicy'
import type { ProviderStreamCallbacks, ProviderStreamHandle, ProviderStreamRuntime } from './providerStreamRuntime'
import type { ProviderStructuredOutputRequest } from './providerStructuredOutput'
import type { ProviderToolCall } from './providerToolCalls'

export interface ProviderRuntimeChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content: string | ProviderContentPart[]
  reasoningContent?: string
  responseItems?: Record<string, unknown>[]
  providerContentBlocks?: Record<string, unknown>[]
  toolCallId?: string
  name?: string
  toolCalls?: ProviderToolCall[]
}

export interface ProviderRuntimeChatSettings {
  transportMode?: 'auto' | 'http' | 'websocket'
  payloadPolicyMode?: 'off' | 'warn' | 'block'
  proxyMode?: 'off' | 'custom-base-url' | 'system-detected'
  proxyBaseUrl?: string
  providerAllowlist?: string[]
  providerBlocklist?: string[]
  modelAllowlist?: string[]
  modelBlocklist?: string[]
  runtimeLogEnabled?: boolean
  runtimeLogMaxBytes?: number
  sessionConcurrencyLimit?: number
  sessionQueueTimeoutMs?: number
  sessionAffinityEnabled?: boolean
  sessionAffinityTtlMs?: number
  remoteCompactMode?: 'off' | 'auto' | 'required'
  remoteCompactThreshold?: number
  remoteCompactThresholdTokens?: number
  upstreamRequestTimeoutMs?: number
  upstreamMaxRetries?: number
  upstreamCircuitBreakerEnabled?: boolean
  upstreamCircuitBreakerFailureThreshold?: number
  upstreamCircuitBreakerCooldownMs?: number
  requestRectificationEnabled?: boolean
  anthropicThinkingSignatureRectificationEnabled?: boolean
  anthropicThinkingBudgetRectificationEnabled?: boolean
  bedrockRequestOptimizerEnabled?: boolean
  thinkingOptimizerEnabled?: boolean
  cacheInjectionEnabled?: boolean
  cacheTtl?: 'default' | '5m' | '1h'
  modelTestModel?: string
  modelTestCheckParameters?: boolean
}

export type ProviderRuntimeUsageSource =
  | 'chat'
  | 'agent'
  | 'tavern'
  | 'tool-continuation'
  | 'memory'
  | 'context'
  | 'knowledge'
  | 'embedding'
  | 'transcription'
  | 'speech'
  | 'media'
  | 'other'

export interface ProviderRuntimeUsageContext {
  source: ProviderRuntimeUsageSource
  correlationId?: string
  runId?: string
}

export interface ProviderRuntimeChatRequest {
  provider: AIProvider
  model: string
  messages: ProviderRuntimeChatMessage[]
  systemPrompt?: string
  temperature?: number
  topP?: number
  topK?: number
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  generationParameterSources: GenerationParameterSources
  generationParameterPlan?: ProviderRequestParameterPlan
  attachments?: Attachment[]
  contextPrompt?: string
  retrievalSources?: RetrievalSource[]
  webSearchMode?: WebSearchMode
  stream?: boolean
  signal?: AbortSignal
  conversationId?: string
  sessionId?: string
  usageContext?: ProviderRuntimeUsageContext
  settings?: ProviderRuntimeChatSettings
  remoteCompactEligible?: boolean
  remoteCompactFallback?: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    contextPrompt: string
    trace?: Record<string, unknown>
  }
  previousResponseId?: string
  requestedModel?: string
  fallbackProviders?: AIProvider[]
  providerToolDeclarations?: readonly unknown[]
  structuredOutput?: ProviderStructuredOutputRequest
}

export type ProviderRuntimeCompletionResult = ProviderResponseParsingResult
export type ProviderRuntimeModelTestResult = ProviderModelTestEvidenceResult
export type ProviderRuntimeAudioTranscriptionInput = ProviderAudioTranscriptionInput
export type ProviderRuntimeSpeechInput = ProviderSpeechInput
export type ProviderRuntimeChunkCallback = (chunk: string) => void
export type ProviderRuntimeDoneCallback = (result: ProviderRuntimeCompletionResult) => void
export type ProviderRuntimeCitationCallback = (citations: MessageCitation[]) => void
export type ProviderRuntimeTraceCallback = (trace: ProcessTrace) => void
export type ProviderRuntimeErrorCallback = (error: Error) => void
export type ProviderRuntimeStreamHandle = ProviderStreamHandle
export type ProviderRuntimeChatCallbacks = ProviderStreamCallbacks<
  string,
  ProviderRuntimeCompletionResult,
  Error,
  MessageCitation[],
  ProcessTrace
>
export type ProviderRuntimeChatStreamRuntime = ProviderStreamRuntime<
  ProviderRuntimeChatRequest,
  string,
  ProviderRuntimeCompletionResult,
  Error,
  MessageCitation[],
  ProcessTrace
>
