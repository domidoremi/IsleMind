import type { ReasoningEffort } from '@/core'
import type { MessageCitation } from './contextContracts'
import type { ChatErrorCode } from './providerContracts'
import type { ProcessTrace } from '@/core'
import type { SkillSnapshot } from './skillContracts'

export interface Attachment {
  id: string
  type: AttachmentType
  uri: string
  name: string
  mimeType: string
  size: number
  base64?: string
}

export interface CommandReference {
  id: string
  type: 'skill' | 'provider' | 'model' | 'knowledge' | 'memory'
  label: string
  value: string
  metadata?: Record<string, unknown>
}

/**
 * The user-visible lifecycle of one assistant response. This is deliberately
 * separate from MessageStatus: the latter remains the compact persistence and
 * action-state discriminator, while this field records the observable work
 * phases between sending and completion.
 */
export type ResponseLifecycleStage =
  | 'preparing'
  | 'sending'
  | 'waiting'
  | 'thinking'
  | 'working'
  | 'tool_calling'
  | 'tool_result'
  | 'generating'
  | 'completed'
  | 'error'
  | 'cancelled'

export interface MessageResponseLifecycleEntry {
  stage: ResponseLifecycleStage
  startedAt: number
  completedAt?: number
  /** A short, safe, high-level description; never raw chain-of-thought. */
  summary?: string
  traceId?: string
}

export interface MessageResponseLifecycle {
  stage: ResponseLifecycleStage
  startedAt: number
  stageStartedAt: number
  completedAt?: number
  history: MessageResponseLifecycleEntry[]
}

export interface Message {
  id: string
  role: MessageRole
  /** Provider/model captured for this assistant turn; absent on legacy rows. */
  providerId?: string
  model?: string
  content: string
  responseText?: string
  reasoning?: ProcessTrace[]
  toolCalls?: ProcessTrace[]
  retrievalTrace?: ProcessTrace[]
  attachments?: Attachment[]
  citations?: MessageCitation[]
  timestamp: number
  status: MessageStatus
  tokenCount?: number
  usage?: MessageUsage
  durationMs?: number
  startedAt?: number
  completedAt?: number
  estimatedTokens?: boolean
  errorCode?: ChatErrorCode
  errorProviderId?: string
  responseLifecycle?: MessageResponseLifecycle
}

export interface MessageUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  source: 'provider' | 'estimated'
}

export type ConversationGenerationParameterKey = 'temperature' | 'topP' | 'topK' | 'maxTokens'
export type ConversationGenerationParameterOverrides = Partial<Record<ConversationGenerationParameterKey, boolean>>

export interface Conversation {
  id: string
  title: string
  providerId: string
  model: string
  providerModelMode?: ConversationProviderModelMode
  skillIds?: string[]
  skillSnapshot?: SkillSnapshot
  enabledTools?: string[]
  knowledgeSources?: string[]
  commandRefs?: CommandReference[]
  systemPrompt: string
  temperature: number
  topP?: number
  topK?: number
  reasoningEffort?: ReasoningEffort
  maxTokens: number
  generationParameterOverrides?: ConversationGenerationParameterOverrides
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'cancelled'
export type ConversationProviderModelMode = 'inherited' | 'manual'
export type AttachmentType = 'image' | 'pdf' | 'text' | 'document'
