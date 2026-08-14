import type {
  AssistantModelOperationSession,
  AssistantRun,
  AssistantRuntime,
  RunJournalEntry,
} from '@/modules/assistant-runtime'
import type { AssistantRunId, Clock, IdGenerator, Result } from '@/core'
import type { ContextCitation, ContextSnapshotAssembler } from '@/modules/knowledge'
import type { ProviderGatewayOptions } from '@/modules/providers'
import type { ConversationSnapshot } from './domain/conversationSnapshot'
import type { Conversation } from '@/types/chatContracts'

export interface ConversationRepository {
  get(conversationId: string): Promise<ConversationSnapshot | undefined>
  loadAll(): Promise<Conversation[]>
  loadReplacementSnapshot(): Promise<readonly Conversation[]>
  save(conversation: Conversation): Promise<void>
  replaceAll(conversations: readonly Conversation[]): Promise<void>
  clear(): Promise<void>
}

export interface ConversationRunProjectionEvent {
  conversationId: string
  run: AssistantRun
  journalEntry?: RunJournalEntry
  contextCitations?: readonly ContextCitation[]
}

export type ConversationRunProjection = (event: ConversationRunProjectionEvent) => void | Promise<void>

export interface StartConversationRunInput {
  conversationId: string
  runId?: AssistantRunId
  responseMessageId?: string
  cancellationSignal?: AbortSignal
  projection?: ConversationRunProjection
}

export interface ResumeConversationModelOperationInput {
  runId: AssistantRunId
  approved: boolean
  cancellationSignal?: AbortSignal
  projection?: ConversationRunProjection
}

export type ConversationRunErrorCode =
  | 'conversation_not_found'
  | 'conversation_load_failed'
  | 'cancelled'
  | 'interrupted'
  | 'output_limit_exceeded'
  | 'provider_failed'
  | 'activity_failed'
  | 'run_already_exists'
  | 'run_not_active'
  | 'run_not_found'
  | 'context_assembly_failed'
  | 'persistence_failed'

export interface ConversationRunHandle {
  runId: AssistantRunId
  completion: Promise<Result<AssistantRun, ConversationRunErrorCode>>
}

export interface ConversationRunUseCaseDependencies {
  clock: Clock
  ids: IdGenerator
  conversations: ConversationRepository
  assistantRuntime: AssistantRuntime
  contextSnapshotAssembler?: ContextSnapshotAssembler
  providerGatewayOptions?: Omit<ProviderGatewayOptions, 'signal'>
  createModelOperationSession?: () => Promise<AssistantModelOperationSession | undefined>
}

export interface ConversationRunUseCase {
  start(input: StartConversationRunInput): ConversationRunHandle
  cancel(runId: AssistantRunId): Promise<Result<AssistantRun, ConversationRunErrorCode>>
  resumeModelOperation(input: ResumeConversationModelOperationInput): Promise<Result<AssistantRun, ConversationRunErrorCode>>
  recoverInterruptedRuns(projection?: ConversationRunProjection): Promise<Result<readonly AssistantRun[], 'persistence_failed'>>
}
