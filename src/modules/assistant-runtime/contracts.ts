import type {
  AssistantRunId,
  ChatRequest,
  ChatReasoningReplayPart,
  ChatToolCallProviderMetadata,
  Clock,
  ContextSnapshotId,
  IdGenerator,
  JsonRecord,
  Result,
  StreamEvent,
} from '@/core'
import type { ProviderGateway, ProviderGatewayOptions } from '@/modules/providers'
import type { AssistantConversationWorkspaceWritebackHandoff } from './workspaceWritebackContracts'

export const CONTEXT_SNAPSHOT_SCHEMA = 'islemind.context-snapshot.v1'
export const RUN_JOURNAL_ENTRY_SCHEMA = 'islemind.assistant-run-journal-entry.v1'
export const PENDING_MODEL_OPERATION_SCHEMA = 'islemind.pending-model-operation.v1'
export const ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA = 'islemind.assistant-run-request-snapshot.v1'
export const ASSISTANT_ACTIVITY_REQUEST_EVIDENCE_SCHEMA = 'islemind.assistant-activity-request-evidence.v1'
export const ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA = 'islemind.assistant-run-activity-request-snapshot.v1'
export const ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA = 'islemind.assistant-context-plan-receipt.v1'
export const ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA = 'islemind.assistant-activity-continuation-identity.v1'

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

/**
 * Bounded evidence that a Rich provider turn was open when the process stopped.
 * It identifies the interrupted turn but is deliberately not a replay token.
 */
export interface AssistantActivityContinuationIdentity {
  readonly schema: typeof ASSISTANT_ACTIVITY_CONTINUATION_IDENTITY_SCHEMA
  readonly id: string
  readonly phase: 'provider-turn'
  readonly providerId: string
  readonly model: string
  readonly requestHash: string
  readonly stepIndex: number
  readonly mode: 'native' | 'structured'
  readonly resume: 'new-turn-only'
}

export interface AssistantRunFailure {
  code: Exclude<AssistantRuntimeErrorCode, 'run_not_found' | 'run_not_active' | 'run_already_exists' | 'persistence_failed'>
  message: string
  continuation?: AssistantActivityContinuationIdentity
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
  | 'provider-continuation.started'
  | 'provider-continuation.completed'
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

/**
 * Exact provider-neutral request frozen before the first provider dispatch.
 * It is durable diagnostic evidence only and does not authorize replay.
 */
export interface AssistantRunRequestSnapshot {
  schema: typeof ASSISTANT_RUN_REQUEST_SNAPSHOT_SCHEMA
  runId: AssistantRunId
  capturedAt: number
  request: ChatRequest
  /** Versioned capability identity used when the request was planned. */
  capabilityRevision?: string
  /** Stable diagnostic identity of the exact provider-neutral request. */
  requestHash?: string
  /** Bounded context diagnostics; raw prompt/context text is deliberately excluded. */
  contextReceipt?: AssistantContextPlanReceipt
}

/**
 * Redacted, provider-neutral request evidence for a Chat compatibility
 * activity. Credentials, cancellation objects, and large binary bodies are
 * intentionally replaced before persistence, so this evidence never grants
 * replay authority.
 */
export interface AssistantActivityRequestEvidence {
  schema: typeof ASSISTANT_ACTIVITY_REQUEST_EVIDENCE_SCHEMA
  conversationId: string
  providerId: string
  model: string
  payload: JsonRecord
  redactedFields: readonly string[]
  /** Bounded context diagnostics; raw prompt/context text is deliberately excluded. */
  contextReceipt?: AssistantContextPlanReceipt
}

export interface AssistantContextPlanReceiptSource {
  readonly fragmentId: string
  readonly type: string
  readonly priority: string
  readonly sourceId: string
  readonly decision: 'included' | 'capped' | 'excluded'
  readonly tokenCap: number
  readonly estimatedTokens: number
  readonly originalEstimatedTokens: number
  readonly authority?: string
  readonly reliability?: string
  readonly budgetShare?: number
  readonly sourceCount?: number
  readonly reason?: string
}

export interface AssistantContextPlanReceipt {
  readonly schema: typeof ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA
  readonly providerId: string
  readonly model: string
  readonly manifestId?: string
  readonly budget: {
    readonly modelContextWindow: number
    readonly requestBudgetTokens: number
    readonly contextPromptTokens: number
    readonly estimatedInputTokens: number
    readonly fixedTokens: number
    readonly messageTokens: number
    readonly includedFragmentTokens: number
    readonly originalFragmentTokens: number
    readonly totalTokenCap: number
    readonly activeContextTokens: number
    readonly tokensUntilCompaction: number
  }
  readonly compression: {
    readonly triggered: boolean
    readonly strategy: string
    readonly triggerReason: string
    readonly sourceMessageCount: number
    readonly keptMessageCount: number
    readonly sourceTokens: number
    readonly compressedTokens: number
    readonly estimatedSavedTokens: number
    readonly compressionRatio: number
    readonly summaryTokens: number
    readonly summarySectionCount: number
  }
  readonly sourceManifest: readonly AssistantContextPlanReceiptSource[]
  readonly failureCodes: readonly string[]
}

/**
 * Runtime/persistence boundary validation for the diagnostic-only context
 * receipt. Keeping this here avoids adapters importing application policy.
 */
export function isAssistantContextPlanReceipt(
  value: unknown,
): value is AssistantContextPlanReceipt {
  if (!isRecord(value) || !hasReceiptKeys(value, [
    'schema',
    'providerId',
    'model',
    'budget',
    'compression',
    'sourceManifest',
    'failureCodes',
  ], ['manifestId']) || value.schema !== ASSISTANT_CONTEXT_PLAN_RECEIPT_SCHEMA) return false
  if (!isBoundedReceiptString(value.providerId, 320) || !isBoundedReceiptString(value.model, 320)) return false
  if (value.manifestId !== undefined && !isBoundedReceiptString(value.manifestId, 512)) return false
  if (!isReceiptBudget(value.budget) || !isReceiptCompression(value.compression)) return false
  if (!Array.isArray(value.sourceManifest) || value.sourceManifest.length > 256 ||
    !value.sourceManifest.every(isReceiptSource)) return false
  if (!Array.isArray(value.failureCodes) || value.failureCodes.length > 64 ||
    !value.failureCodes.every((code) => isBoundedReceiptString(code, 160))) return false
  try {
    return JSON.stringify(value).length <= 512 * 1024
  } catch {
    return false
  }
}

export function cloneAssistantContextPlanReceipt(
  value: AssistantContextPlanReceipt,
): AssistantContextPlanReceipt {
  const cloned = JSON.parse(JSON.stringify(value)) as unknown
  if (!isAssistantContextPlanReceipt(cloned)) {
    throw new Error('The assistant context plan receipt is invalid.')
  }
  return cloned
}

export interface AssistantRunActivityRequestSnapshot {
  schema: typeof ASSISTANT_RUN_ACTIVITY_REQUEST_SNAPSHOT_SCHEMA
  runId: AssistantRunId
  capturedAt: number
  request: AssistantActivityRequestEvidence
  /** Versioned capability identity used when the activity was planned. */
  capabilityRevision?: string
  /** Stable diagnostic identity of the redacted provider-neutral evidence. */
  requestHash?: string
}

export type AssistantRunCapturedRequestSnapshot =
  | AssistantRunRequestSnapshot
  | AssistantRunActivityRequestSnapshot

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
  getRequestSnapshot(runId: AssistantRunId): Promise<AssistantRunCapturedRequestSnapshot | undefined>
  clear(): Promise<void>
  appendAndSave(
    entry: RunJournalEntry,
    run: AssistantRun,
    requestSnapshot?: AssistantRunCapturedRequestSnapshot,
  ): Promise<void>
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
  /** Diagnostic-only receipt for the exact context plan used to prepare request. */
  contextReceipt?: AssistantContextPlanReceipt
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
  readonly providerMetadata?: ChatToolCallProviderMetadata
}

export interface AssistantModelOperationTurnInput {
  readonly run: AssistantRun
  readonly request: ChatRequest
  readonly outputText: string
  readonly calls: readonly AssistantModelOperationProviderCall[]
  readonly reasoningReplay: readonly ChatReasoningReplayPart[]
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

export interface AssistantActivityProviderContinuationInput {
  readonly request: ChatRequest
  readonly session: AssistantModelOperationSession
  readonly calls: readonly AssistantModelOperationProviderCall[]
  readonly reasoningReplay: readonly ChatReasoningReplayPart[]
  readonly outputText: string
  readonly stream: ProviderGateway['stream']
  readonly onStreamEvent?: (event: StreamEvent) => void
}

export interface AssistantActivityProviderContinuationResult {
  readonly outputText: string
  readonly eventCount: number
}

export interface AssistantActivityExecutionInput {
  readonly run: AssistantRun
  readonly signal: AbortSignal
  /**
   * Persists one normalized, bounded provider event before terminal activity
   * completion. Trace events intentionally contain identifiers and lifecycle
   * state only, never raw content or metadata.
   */
  readonly checkpointStreamEvent?: (event: StreamEvent) => Promise<void>
  /**
   * Persist one visible text delta before the activity reports completion.
   * This remains a compatibility convenience for non-streaming Chat-owned
   * activities; new streaming activities should use checkpointStreamEvent.
   */
  readonly checkpointTextDelta?: (text: string) => Promise<void>
  /** Continues a completed Rich provider turn through the canonical operation loop. */
  readonly continueProviderTurns?: (
    input: AssistantActivityProviderContinuationInput,
  ) => Promise<AssistantActivityProviderContinuationResult>
}

export interface AssistantActivityExecutor {
  execute(
    input: AssistantActivityExecutionInput,
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
  requestEvidence?: AssistantActivityRequestEvidence
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

function isReceiptBudget(value: unknown): boolean {
  if (!isRecord(value) || !hasReceiptKeys(value, [
    'modelContextWindow',
    'requestBudgetTokens',
    'contextPromptTokens',
    'estimatedInputTokens',
    'fixedTokens',
    'messageTokens',
    'includedFragmentTokens',
    'originalFragmentTokens',
    'totalTokenCap',
    'activeContextTokens',
    'tokensUntilCompaction',
  ])) return false
  const keys = [
    'modelContextWindow',
    'requestBudgetTokens',
    'contextPromptTokens',
    'estimatedInputTokens',
    'fixedTokens',
    'messageTokens',
    'includedFragmentTokens',
    'originalFragmentTokens',
    'totalTokenCap',
    'activeContextTokens',
    'tokensUntilCompaction',
  ] as const
  return keys.every((key) => isBoundedReceiptNumber(value[key], 10_000_000))
}

function isReceiptCompression(value: unknown): boolean {
  if (!isRecord(value) || !hasReceiptKeys(value, [
    'triggered',
    'strategy',
    'triggerReason',
    'sourceMessageCount',
    'keptMessageCount',
    'sourceTokens',
    'compressedTokens',
    'estimatedSavedTokens',
    'compressionRatio',
    'summaryTokens',
    'summarySectionCount',
  ])) return false
  return typeof value.triggered === 'boolean'
    && isBoundedReceiptString(value.strategy, 160)
    && isBoundedReceiptString(value.triggerReason, 160)
    && isBoundedReceiptNumber(value.sourceMessageCount, 1_000_000)
    && isBoundedReceiptNumber(value.keptMessageCount, 1_000_000)
    && isBoundedReceiptNumber(value.sourceTokens, 10_000_000)
    && isBoundedReceiptNumber(value.compressedTokens, 10_000_000)
    && isBoundedReceiptNumber(value.estimatedSavedTokens, 10_000_000)
    && isBoundedReceiptFiniteNumber(value.compressionRatio, 10_000_000)
    && isBoundedReceiptNumber(value.summaryTokens, 10_000_000)
    && isBoundedReceiptNumber(value.summarySectionCount, 1_000_000)
}

function isReceiptSource(value: unknown): value is AssistantContextPlanReceiptSource {
  if (!isRecord(value)
    || !hasReceiptKeys(value, [
      'fragmentId',
      'type',
      'priority',
      'sourceId',
      'decision',
      'tokenCap',
      'estimatedTokens',
      'originalEstimatedTokens',
    ], ['authority', 'reliability', 'budgetShare', 'sourceCount', 'reason'])
    || !isBoundedReceiptString(value.fragmentId, 512)
    || !isBoundedReceiptString(value.type, 160)
    || !isBoundedReceiptString(value.priority, 80)
    || !isBoundedReceiptString(value.sourceId, 512)
    || (value.decision !== 'included' && value.decision !== 'capped' && value.decision !== 'excluded')
    || !isBoundedReceiptNumber(value.tokenCap, 10_000_000)
    || !isBoundedReceiptNumber(value.estimatedTokens, 10_000_000)
    || !isBoundedReceiptNumber(value.originalEstimatedTokens, 10_000_000)) {
    return false
  }
  return (value.authority === undefined || isBoundedReceiptString(value.authority, 160))
    && (value.reliability === undefined || isBoundedReceiptString(value.reliability, 160))
    && (value.budgetShare === undefined || isBoundedReceiptFiniteNumber(value.budgetShare, 10_000_000))
    && (value.sourceCount === undefined || isBoundedReceiptNumber(value.sourceCount, 1_000_000))
    && (value.reason === undefined || isBoundedReceiptString(value.reason, 160))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasReceiptKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key))
}

function isBoundedReceiptString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isBoundedReceiptNumber(value: unknown, maxValue: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= maxValue
}

function isBoundedReceiptFiniteNumber(value: unknown, maxValue: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= maxValue
}
