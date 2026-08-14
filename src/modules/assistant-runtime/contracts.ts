import type {
  AssistantRunId,
  ChatRequest,
  Clock,
  ContextSnapshotId,
  IdGenerator,
  JsonRecord,
  Result,
} from '@/core'
import type { ProviderGateway, ProviderGatewayOptions } from '@/modules/providers'
import type { AssistantConversationWorkspaceWritebackHandoff } from './workspaceWritebackContracts'

export const CONTEXT_SNAPSHOT_SCHEMA = 'islemind.context-snapshot.v1'
export const RUN_JOURNAL_ENTRY_SCHEMA = 'islemind.assistant-run-journal-entry.v1'
export const PENDING_MODEL_OPERATION_SCHEMA = 'islemind.pending-model-operation.v1'

export type AssistantRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting-confirmation'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface ContextSnapshot {
  schema: typeof CONTEXT_SNAPSHOT_SCHEMA
  id: ContextSnapshotId
  createdAt: number
  conversationMessageIds: readonly string[]
  memoryIds: readonly string[]
  knowledgeSourceIds: readonly string[]
  attachmentIds: readonly string[]
  approvedToolContextIds: readonly string[]
}

export interface AssistantRunCheckpoint {
  outputText: string
  streamEventCount: number
}

export interface AssistantRunFailure {
  code: Exclude<AssistantRuntimeErrorCode, 'run_not_found' | 'run_not_active' | 'run_already_exists' | 'persistence_failed'>
  message: string
}

export interface AssistantRunResult {
  outputText: string
  streamEventCount: number
}

export interface PendingModelOperation {
  readonly schema: typeof PENDING_MODEL_OPERATION_SCHEMA
  readonly runId: AssistantRunId
  readonly callId: string
  readonly operationId: string
  readonly catalogRevision: string
  readonly argumentDigest: string
  readonly idempotencyKey: string
  readonly continuationToken: string
  readonly stepIndex: number
  readonly maxSteps: number
  readonly requestedAt: number
  readonly continuationRequest: ChatRequest
  readonly continuationMode: 'native' | 'structured'
  readonly continuationOutputText: string
  readonly continuationState: JsonRecord
  readonly continuationDigest: string
}

export interface AssistantRun {
  id: AssistantRunId
  /** The persisted invocation owner; unsupported kinds fail closed. */
  kind: 'chat'
  conversationId: string
  responseMessageId?: string
  workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
  providerId: string
  model: string
  contextSnapshotId: ContextSnapshotId
  status: AssistantRunStatus
  createdAt: number
  startedAt?: number
  cancellationRequestedAt?: number
  completedAt?: number
  journalSequence: number
  checkpoint?: AssistantRunCheckpoint
  pendingModelOperation?: PendingModelOperation
  result?: AssistantRunResult
  failure?: AssistantRunFailure
}

export type RunJournalEventType =
  | 'run.created'
  | 'run.started'
  | 'provider.route-selected'
  | 'stream.event'
  | 'model-operation.selected'
  | 'run.awaiting-confirmation'
  | 'run.confirmation-resolved'
  | 'run.cancellation-requested'
  | 'run.succeeded'
  | 'run.failed'
  | 'run.cancelled'

export interface RunJournalEntry {
  schema: typeof RUN_JOURNAL_ENTRY_SCHEMA
  runId: AssistantRunId
  sequence: number
  type: RunJournalEventType
  occurredAt: number
  data?: JsonRecord
}

export interface AssistantRunRepository {
  get(runId: AssistantRunId): Promise<AssistantRun | undefined>
  listRecoverable(): Promise<readonly AssistantRun[]>
  save(run: AssistantRun): Promise<void>
}

export interface RunJournal {
  append(entry: RunJournalEntry): Promise<void>
  list(runId: AssistantRunId): Promise<readonly RunJournalEntry[]>
}

export interface AssistantRunPersistence extends AssistantRunRepository, RunJournal {
  appendAndSave(entry: RunJournalEntry, run: AssistantRun): Promise<void>
}

export interface AssistantRunProjectionEvent {
  run: AssistantRun
  journalEntry: RunJournalEntry
}

export type AssistantRunProjection = (event: AssistantRunProjectionEvent) => void | Promise<void>

export type AssistantRuntimeErrorCode =
  | 'cancelled'
  | 'interrupted'
  | 'output_limit_exceeded'
  | 'provider_failed'
  | 'activity_failed'
  | 'run_already_exists'
  | 'run_not_active'
  | 'run_not_found'
  | 'persistence_failed'

export interface StartAssistantRunInput {
  runId?: AssistantRunId
  request: ChatRequest
  context: ContextSnapshot
  responseMessageId?: string
  cancellationSignal?: AbortSignal
  providerGatewayOptions?: Omit<ProviderGatewayOptions, 'signal'>
  modelOperationSession?: AssistantModelOperationSession
  onPersisted?: AssistantRunProjection
}

export interface AssistantModelOperationProviderCall {
  readonly callId: string
  readonly name: string
  readonly arguments: JsonRecord
  readonly providerMetadata?: JsonRecord
}

export interface AssistantModelOperationTurnInput {
  readonly run: AssistantRun
  readonly request: ChatRequest
  readonly outputText: string
  readonly calls: readonly AssistantModelOperationProviderCall[]
  readonly stepIndex: number
  readonly signal: AbortSignal
}

export type AssistantModelOperationTurnOutcome =
  | Readonly<{ kind: 'no-operation' }>
  | Readonly<{
    kind: 'continue'
    request: ChatRequest
    receipt: JsonRecord
  }>
  | Readonly<{
    kind: 'awaiting-confirmation'
    pending: PendingModelOperation
    receipt: JsonRecord
  }>
  | Readonly<{ kind: 'cancelled'; receipt: JsonRecord }>

export interface AssistantModelOperationSession {
  prepareRequest(request: ChatRequest): ChatRequest
  evaluateTurn(input: AssistantModelOperationTurnInput): Promise<AssistantModelOperationTurnOutcome>
  validatePending(input: {
    readonly run: AssistantRun
    readonly pending: PendingModelOperation
  }): boolean
  resume(input: {
    readonly run: AssistantRun
    readonly pending: PendingModelOperation
    readonly approved: boolean
    readonly signal: AbortSignal
  }): Promise<AssistantModelOperationTurnOutcome>
}

export interface ResumePendingModelOperationInput {
  readonly runId: AssistantRunId
  readonly approved: boolean
  readonly session: AssistantModelOperationSession
  readonly cancellationSignal?: AbortSignal
  readonly providerGatewayOptions?: Omit<ProviderGatewayOptions, 'signal'>
  readonly onPersisted?: AssistantRunProjection
}

export interface AssistantActivityExecutionResult {
  /** Visible output retained as the durable final run result. */
  outputText?: string
  /** Activity implementations may report a bounded unit count; defaults to zero. */
  eventCount?: number
  /** A completed activity can report a durable failure without throwing. */
  outcome?: 'succeeded' | 'failed'
  failureMessage?: string
}

export interface AssistantActivityExecutor {
  execute(
    input: { run: AssistantRun; signal: AbortSignal },
  ): Promise<AssistantActivityExecutionResult>
}

export interface StartAssistantActivityRunInput {
  runId?: AssistantRunId
  /** Activities are Chat-owned; unsupported kinds are rejected before persistence. */
  kind: 'chat'
  conversationId: string
  /**
   * Chat-owned compatibility activities retain the concrete provider route.
   * Non-provider activities omit these fields and use the internal envelope.
   */
  providerId?: string
  model?: string
  context: ContextSnapshot
  responseMessageId?: string
  workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
  cancellationSignal?: AbortSignal
  executor: AssistantActivityExecutor
  onPersisted?: AssistantRunProjection
}

export interface AssistantRuntimeOptions {
  maxOutputChars?: number
}

export interface AssistantRuntimeDependencies {
  clock: Clock
  ids: IdGenerator
  providerGateway: ProviderGateway
  persistence: AssistantRunPersistence
  options?: AssistantRuntimeOptions
}

export interface AssistantRuntime {
  execute(input: StartAssistantRunInput): Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
  executeActivity(input: StartAssistantActivityRunInput): Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
  resumeModelOperation(input: ResumePendingModelOperationInput): Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
  cancel(runId: AssistantRunId): Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
  getRun(runId: AssistantRunId): Promise<AssistantRun | undefined>
  recoverInterruptedRuns(): Promise<Result<readonly AssistantRun[], 'persistence_failed'>>
}
