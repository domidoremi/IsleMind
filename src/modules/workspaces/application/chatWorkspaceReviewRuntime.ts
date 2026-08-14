import {
  approveTavernPendingWriteback,
  clearTavernPrivateRelationshipMemory,
  dismissTavernPendingWriteback,
} from '../domain/tavernReviewPolicy'
import type {
  TavernPendingWriteback,
  TavernSnapshot,
} from '../domain/tavernContracts'
import {
  parseCanonicalTavernSnapshot,
  TAVERN_SNAPSHOT_LIST_LIMIT,
} from '../domain/tavernSnapshotPolicy'
import type { TavernWorkspaceApplication } from './tavernWorkspaceApplication'
import { normalizeTavernWorkspaceScopeId } from './tavernWorkspaceRepository'

export const CHAT_WORKSPACE_REVIEW_SCHEMA = 'islemind.chat-workspace-review.v1' as const
export const CHAT_WORKSPACE_REVIEW_PENDING_LIMIT = TAVERN_SNAPSHOT_LIST_LIMIT

type ChatWorkspaceReviewApplication = Pick<
  TavernWorkspaceApplication,
  'resolveTavernActiveScopeId'
>

export interface ChatWorkspaceReviewRuntimeDependencies {
  readonly application: ChatWorkspaceReviewApplication
  readonly scopePort: ChatWorkspaceReviewScopePort
  readonly now?: () => number
}

export interface ChatWorkspaceReviewScopePort {
  /** The load must coherently verify that the conversation still selects workspaceId. */
  loadLinkedScope(
    input: ChatWorkspaceReviewScopeLoadInput,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewScopeLoadResult>
  /**
   * One atomic attempt: revalidate the active link and repository revision,
   * then commit. A committed write must return applied even after cancellation.
   */
  compareAndSwap(
    input: ChatWorkspaceReviewScopeCompareAndSwapInput,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewScopeCompareAndSwapResult>
}

export interface ChatWorkspaceReviewScopeLoadInput {
  readonly conversationId: string
  readonly workspaceId: string
}

export interface ChatWorkspaceReviewScopeCompareAndSwapInput
  extends ChatWorkspaceReviewScopeLoadInput {
  readonly expectedRepositoryRevision: number
  readonly snapshot: unknown
  readonly updatedAt: number
}

export type ChatWorkspaceReviewScopeLoadResult =
  | {
      readonly status: 'ready'
      readonly conversationId: string
      readonly workspaceId: string
      readonly repositoryRevision: number
      readonly snapshot: unknown
    }
  | {
      readonly status: 'stale'
    }
  | ChatWorkspaceReviewScopeCancelledResult
  | ChatWorkspaceReviewScopeFailedResult

export type ChatWorkspaceReviewScopeCompareAndSwapResult =
  | {
      readonly status: 'applied'
      readonly conversationId: string
      readonly workspaceId: string
      readonly repositoryRevision: number
      readonly snapshot: unknown
    }
  | {
      readonly status: 'conflict' | 'not_found'
    }
  | ChatWorkspaceReviewScopeCancelledResult
  | ChatWorkspaceReviewScopeFailedResult

interface ChatWorkspaceReviewScopeCancelledResult {
  readonly status: 'cancelled'
}

interface ChatWorkspaceReviewScopeFailedResult {
  readonly status: 'failed'
}

export interface ChatWorkspaceReviewLoadInput {
  readonly conversationId: string
}

export interface ChatWorkspaceReviewCursor {
  readonly workspaceId: string
  readonly revision: number
}

export interface ChatWorkspacePrivateMemoryConfirmation {
  readonly revision: number
  readonly privateMemoryCount: number
}

export interface ChatWorkspacePendingReviewCounts {
  readonly reviewUnitCount: number
  readonly summaryCount: number
  readonly characterCount: number
  readonly lorebookCount: number
  readonly relationshipMemoryCandidateCount: number
  readonly privateRelationshipMemoryCandidateCount: number
  readonly persistablePrivateRelationshipMemoryCandidateCount: number
  readonly sceneCount: number
}

export interface ChatWorkspacePendingWritebackReview {
  readonly id: string
  readonly sourceAssistantMessageId?: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly counts: ChatWorkspacePendingReviewCounts
}

export interface ChatWorkspaceReviewCounts {
  readonly pendingWritebackCount: number
  readonly pendingReviewUnitCount: number
  readonly pendingSummaryCount: number
  readonly pendingCharacterCount: number
  readonly pendingLorebookCount: number
  readonly pendingRelationshipMemoryCandidateCount: number
  readonly pendingPrivateRelationshipMemoryCandidateCount: number
  readonly pendingPersistablePrivateRelationshipMemoryCandidateCount: number
  readonly pendingSceneCount: number
  readonly existingRelationshipMemoryCount: number
  readonly existingPrivateRelationshipMemoryCount: number
  readonly totalPrivateRelationshipMemoryCount: number
}

export interface ChatWorkspaceReviewProjection {
  readonly schema: typeof CHAT_WORKSPACE_REVIEW_SCHEMA
  readonly conversationId: string
  readonly workspaceId: string
  readonly revision: number
  readonly pendingWritebacks: readonly ChatWorkspacePendingWritebackReview[]
  readonly pendingWritebacksTruncated: boolean
  readonly counts: ChatWorkspaceReviewCounts
}

export interface ChatWorkspacePendingWritebackCommand extends ChatWorkspaceReviewLoadInput {
  readonly pendingWritebackId: string
  readonly expected: ChatWorkspaceReviewCursor
  readonly confirmation?: ChatWorkspacePrivateMemoryConfirmation
}

export interface ChatWorkspaceClearPrivateMemoryCommand extends ChatWorkspaceReviewLoadInput {
  readonly expected: ChatWorkspaceReviewCursor
  readonly confirmation?: ChatWorkspacePrivateMemoryConfirmation
}

export interface ChatWorkspaceReviewOperationOptions {
  readonly signal: AbortSignal
}

export type ChatWorkspaceReviewLoadOutcome =
  | {
      readonly status: 'ready'
      readonly projection: ChatWorkspaceReviewProjection
    }
  | ChatWorkspaceReviewCancelledOutcome
  | ChatWorkspaceReviewFailedOutcome

export type ChatWorkspaceReviewMutationOutcome =
  | {
      readonly status: 'updated'
      readonly operation: 'approved' | 'dismissed' | 'private_memory_cleared'
      readonly changed: boolean
      readonly projection: ChatWorkspaceReviewProjection
    }
  | {
      readonly status: 'confirmation_required'
      readonly operation: 'approve' | 'clear_private_memory'
      readonly confirmation: ChatWorkspacePrivateMemoryConfirmation
      readonly projection: ChatWorkspaceReviewProjection
    }
  | {
      readonly status: 'stale'
      readonly projection?: ChatWorkspaceReviewProjection
    }
  | {
      readonly status: 'not_found'
      readonly target: 'pending_writeback'
      readonly projection: ChatWorkspaceReviewProjection
    }
  | ChatWorkspaceReviewCancelledOutcome
  | ChatWorkspaceReviewFailedOutcome

interface ChatWorkspaceReviewCancelledOutcome {
  readonly status: 'cancelled'
}

interface ChatWorkspaceReviewFailedOutcome {
  readonly status: 'failed'
  readonly reason: string
}

export interface ChatWorkspaceReviewRuntime {
  loadReview(
    input: ChatWorkspaceReviewLoadInput,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewLoadOutcome>
  approvePendingWriteback(
    input: ChatWorkspacePendingWritebackCommand,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome>
  dismissPendingWriteback(
    input: ChatWorkspacePendingWritebackCommand,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome>
  clearPrivateMemory(
    input: ChatWorkspaceClearPrivateMemoryCommand,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome>
}

type FreshWorkspaceRead =
  | {
      readonly status: 'ready'
      readonly conversationId: string
      readonly workspaceId: string
      readonly snapshot: TavernSnapshot
      readonly projection: ChatWorkspaceReviewProjection
    }
  | ChatWorkspaceReviewCancelledOutcome
  | ChatWorkspaceReviewFailedOutcome

export function createChatWorkspaceReviewRuntime(
  dependencies: ChatWorkspaceReviewRuntimeDependencies,
): ChatWorkspaceReviewRuntime {
  assertApplication(dependencies.application)
  assertScopePort(dependencies.scopePort)
  const now = dependencies.now ?? (() => Date.now())
  if (typeof now !== 'function') {
    throw new TypeError('The Chat workspace review clock is invalid.')
  }

  async function loadFresh(
    input: ChatWorkspaceReviewLoadInput,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<FreshWorkspaceRead> {
    if (options.signal.aborted) return cancelled()
    const conversationId = normalizeExactScopeId(input.conversationId)
    if (!conversationId) return failed('The Chat workspace review conversation identity is invalid.')

    let linkedWorkspaceId: string | undefined
    try {
      linkedWorkspaceId = await dependencies.application.resolveTavernActiveScopeId(
        conversationId,
        { signal: options.signal },
      )
    } catch {
      return options.signal.aborted
        ? cancelled()
        : failed('The Chat workspace link could not be resolved.')
    }
    if (options.signal.aborted) return cancelled()

    const workspaceId = linkedWorkspaceId === undefined
      ? conversationId
      : normalizeExactScopeId(linkedWorkspaceId)
    if (!workspaceId) return failed('The linked Chat workspace identity is invalid.')

    let loaded: ChatWorkspaceReviewScopeLoadResult
    try {
      loaded = await dependencies.scopePort.loadLinkedScope(
        { conversationId, workspaceId },
        { signal: options.signal },
      )
    } catch {
      return options.signal.aborted
        ? cancelled()
        : failed('The Chat workspace review state could not be loaded.')
    }
    if (options.signal.aborted) return cancelled()
    if (!isScopeLoadResult(loaded)) {
      return failed('The Chat workspace review scope port returned an invalid result.')
    }
    if (loaded.status === 'cancelled') return cancelled()
    if (loaded.status === 'stale') return failed('The linked Chat workspace changed while it was being loaded.')
    if (loaded.status === 'failed') return failed('The Chat workspace review state could not be loaded.')
    if (
      loaded.conversationId !== conversationId
      || loaded.workspaceId !== workspaceId
      || !isNonNegativeSafeInteger(loaded.repositoryRevision)
    ) {
      return failed('The Chat workspace review scope identity is invalid.')
    }
    const snapshot = parseCanonicalTavernSnapshot(loaded.snapshot)
    if (!snapshot) return failed('The Chat workspace review state is invalid.')
    const projection = buildReviewProjection(
      conversationId,
      workspaceId,
      loaded.repositoryRevision,
      snapshot,
    )
    return { status: 'ready', conversationId, workspaceId, snapshot, projection }
  }

  async function saveMutation(
    current: Extract<FreshWorkspaceRead, { status: 'ready' }>,
    next: TavernSnapshot,
    operation: Extract<ChatWorkspaceReviewMutationOutcome, { status: 'updated' }>['operation'],
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome> {
    if (options.signal.aborted) return cancelled()
    const changed = JSON.stringify(next) !== JSON.stringify(current.snapshot)
    if (!changed) {
      return Object.freeze({
        status: 'updated',
        operation,
        changed: false,
        projection: current.projection,
      })
    }

    const operationTime = next.updatedAt
    let saved: ChatWorkspaceReviewScopeCompareAndSwapResult
    try {
      saved = await dependencies.scopePort.compareAndSwap(
        {
          conversationId: current.conversationId,
          workspaceId: current.workspaceId,
          expectedRepositoryRevision: current.projection.revision,
          snapshot: next,
          updatedAt: operationTime,
        },
        { signal: options.signal },
      )
    } catch {
      return options.signal.aborted
        ? cancelled()
        : failed('The Chat workspace review state could not be saved.')
    }
    if (!isScopeCompareAndSwapResult(saved)) {
      return failed('The Chat workspace review scope port returned an invalid mutation result.')
    }
    if (saved.status === 'cancelled') return cancelled()
    if (saved.status === 'failed') return failed('The Chat workspace review state could not be saved.')
    if (saved.status !== 'applied') return stale()
    if (
      saved.conversationId !== current.conversationId
      || saved.workspaceId !== current.workspaceId
      || !isNonNegativeSafeInteger(saved.repositoryRevision)
      || saved.repositoryRevision <= current.projection.revision
    ) {
      return failed('The saved Chat workspace review scope identity is invalid.')
    }
    const snapshot = parseCanonicalTavernSnapshot(saved.snapshot)
    if (!snapshot) return failed('The saved Chat workspace review state is invalid.')
    return Object.freeze({
      status: 'updated',
      operation,
      changed: true,
      projection: buildReviewProjection(
        current.conversationId,
        current.workspaceId,
        saved.repositoryRevision,
        snapshot,
      ),
    })
  }

  async function loadReview(
    input: ChatWorkspaceReviewLoadInput,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewLoadOutcome> {
    if (!isOperationInput(input, options)) {
      return failed('The Chat workspace review request is invalid.')
    }
    const current = await loadFresh(input, options)
    return current.status === 'ready'
      ? Object.freeze({ status: 'ready', projection: current.projection })
      : current
  }

  async function approvePendingWriteback(
    input: ChatWorkspacePendingWritebackCommand,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome> {
    if (!isPendingCommand(input, options)) {
      return failed('The Chat workspace approval request is invalid.')
    }
    const current = await loadFresh(input, options)
    if (current.status !== 'ready') return current
    if (!matchesCursor(input.expected, current.projection)) return stale(current.projection)

    const target = current.snapshot.pendingWritebacks.find(
      (pending) => pending.id === input.pendingWritebackId,
    )
    if (!target) return notFound(current.projection)
    const privateMemoryCount = countPrivatePersistableCandidates(target)
    if (
      privateMemoryCount > 0
      && !matchesConfirmation(input.confirmation, current.projection.revision, privateMemoryCount)
    ) {
      return confirmationRequired(
        'approve',
        current.projection,
        privateMemoryCount,
      )
    }

    const operationTime = readOperationTime(now)
    if (operationTime === undefined) {
      return failed('The Chat workspace review clock returned an invalid timestamp.')
    }
    if (options.signal.aborted) return cancelled()
    const next = approveTavernPendingWriteback(
      current.snapshot,
      input.pendingWritebackId,
      operationTime,
    )
    return saveMutation(current, next, 'approved', options)
  }

  async function dismissPendingWriteback(
    input: ChatWorkspacePendingWritebackCommand,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome> {
    if (!isPendingCommand(input, options)) {
      return failed('The Chat workspace dismissal request is invalid.')
    }
    const current = await loadFresh(input, options)
    if (current.status !== 'ready') return current
    if (!matchesCursor(input.expected, current.projection)) return stale(current.projection)
    if (!current.snapshot.pendingWritebacks.some((pending) => pending.id === input.pendingWritebackId)) {
      return notFound(current.projection)
    }

    const operationTime = readOperationTime(now)
    if (operationTime === undefined) {
      return failed('The Chat workspace review clock returned an invalid timestamp.')
    }
    if (options.signal.aborted) return cancelled()
    const next = dismissTavernPendingWriteback(
      current.snapshot,
      input.pendingWritebackId,
      operationTime,
    )
    return saveMutation(current, next, 'dismissed', options)
  }

  async function clearPrivateMemory(
    input: ChatWorkspaceClearPrivateMemoryCommand,
    options: ChatWorkspaceReviewOperationOptions,
  ): Promise<ChatWorkspaceReviewMutationOutcome> {
    if (!isClearPrivateCommand(input, options)) {
      return failed('The Chat workspace private-memory request is invalid.')
    }
    const current = await loadFresh(input, options)
    if (current.status !== 'ready') return current
    if (!matchesCursor(input.expected, current.projection)) return stale(current.projection)

    const privateMemoryCount = current.projection.counts.totalPrivateRelationshipMemoryCount
    if (
      privateMemoryCount > 0
      && !matchesConfirmation(input.confirmation, current.projection.revision, privateMemoryCount)
    ) {
      return confirmationRequired(
        'clear_private_memory',
        current.projection,
        privateMemoryCount,
      )
    }

    const operationTime = readOperationTime(now)
    if (operationTime === undefined) {
      return failed('The Chat workspace review clock returned an invalid timestamp.')
    }
    if (options.signal.aborted) return cancelled()
    const next = clearTavernPrivateRelationshipMemory(current.snapshot, operationTime)
    return saveMutation(current, next, 'private_memory_cleared', options)
  }

  return Object.freeze({
    loadReview,
    approvePendingWriteback,
    dismissPendingWriteback,
    clearPrivateMemory,
  })
}

function buildReviewProjection(
  conversationId: string,
  workspaceId: string,
  repositoryRevision: number,
  snapshot: TavernSnapshot,
): ChatWorkspaceReviewProjection {
  const pendingWritebacks = snapshot.pendingWritebacks
    .slice(0, CHAT_WORKSPACE_REVIEW_PENDING_LIMIT)
    .map((pending) => Object.freeze({
      id: pending.id,
      ...(pending.sourceAssistantMessageId
        ? { sourceAssistantMessageId: pending.sourceAssistantMessageId }
        : {}),
      createdAt: pending.createdAt,
      updatedAt: pending.updatedAt,
      counts: buildPendingCounts(pending),
    }))
  const pendingCounts = snapshot.pendingWritebacks.map(buildPendingCounts)
  const existingPrivateRelationshipMemoryCount = snapshot.relationshipMemories
    .filter((memory) => !memory.userVisible).length
  const pendingPrivateRelationshipMemoryCandidateCount = pendingCounts
    .reduce((count, current) => count + current.privateRelationshipMemoryCandidateCount, 0)
  const counts: ChatWorkspaceReviewCounts = Object.freeze({
    pendingWritebackCount: snapshot.pendingWritebacks.length,
    pendingReviewUnitCount: pendingCounts.reduce((count, current) => count + current.reviewUnitCount, 0),
    pendingSummaryCount: pendingCounts.reduce((count, current) => count + current.summaryCount, 0),
    pendingCharacterCount: pendingCounts.reduce((count, current) => count + current.characterCount, 0),
    pendingLorebookCount: pendingCounts.reduce((count, current) => count + current.lorebookCount, 0),
    pendingRelationshipMemoryCandidateCount: pendingCounts.reduce(
      (count, current) => count + current.relationshipMemoryCandidateCount,
      0,
    ),
    pendingPrivateRelationshipMemoryCandidateCount,
    pendingPersistablePrivateRelationshipMemoryCandidateCount: pendingCounts.reduce(
      (count, current) => count + current.persistablePrivateRelationshipMemoryCandidateCount,
      0,
    ),
    pendingSceneCount: pendingCounts.reduce((count, current) => count + current.sceneCount, 0),
    existingRelationshipMemoryCount: snapshot.relationshipMemories.length,
    existingPrivateRelationshipMemoryCount,
    totalPrivateRelationshipMemoryCount:
      existingPrivateRelationshipMemoryCount + pendingPrivateRelationshipMemoryCandidateCount,
  })
  return Object.freeze({
    schema: CHAT_WORKSPACE_REVIEW_SCHEMA,
    conversationId,
    workspaceId,
    revision: repositoryRevision,
    pendingWritebacks: Object.freeze(pendingWritebacks),
    pendingWritebacksTruncated: snapshot.pendingWritebacks.length > pendingWritebacks.length,
    counts,
  })
}

function buildPendingCounts(pending: TavernPendingWriteback): ChatWorkspacePendingReviewCounts {
  const relationshipMemoryCandidateCount = pending.relationshipMemoryCandidates.length
  const privateRelationshipMemoryCandidateCount = pending.relationshipMemoryCandidates
    .filter((candidate) => !candidate.suggestedUserVisible).length
  const persistablePrivateRelationshipMemoryCandidateCount = countPrivatePersistableCandidates(pending)
  const summaryCount = pending.summaryDraft ? 1 : 0
  const characterCount = pending.characterDraftProposal ? 1 : 0
  const lorebookCount = pending.lorebookDraftProposal ? 1 : 0
  const sceneCount = pending.sceneChangeProposal ? 1 : 0
  return Object.freeze({
    reviewUnitCount:
      summaryCount + characterCount + lorebookCount + relationshipMemoryCandidateCount + sceneCount,
    summaryCount,
    characterCount,
    lorebookCount,
    relationshipMemoryCandidateCount,
    privateRelationshipMemoryCandidateCount,
    persistablePrivateRelationshipMemoryCandidateCount,
    sceneCount,
  })
}

function countPrivatePersistableCandidates(pending: TavernPendingWriteback): number {
  return pending.relationshipMemoryCandidates.filter(
    (candidate) => candidate.reviewStatus === 'new' && !candidate.suggestedUserVisible,
  ).length
}

function matchesCursor(
  expected: ChatWorkspaceReviewCursor,
  projection: ChatWorkspaceReviewProjection,
): boolean {
  return expected.workspaceId === projection.workspaceId
    && expected.revision === projection.revision
}

function matchesConfirmation(
  confirmation: ChatWorkspacePrivateMemoryConfirmation | undefined,
  revision: number,
  privateMemoryCount: number,
): boolean {
  return confirmation?.revision === revision
    && confirmation.privateMemoryCount === privateMemoryCount
}

function isOperationInput(
  input: unknown,
  options: unknown,
): input is ChatWorkspaceReviewLoadInput {
  return isRecord(input)
    && normalizeExactScopeId(input.conversationId) !== undefined
    && isRecord(options)
    && isAbortSignal(options.signal)
}

function isPendingCommand(
  input: unknown,
  options: unknown,
): input is ChatWorkspacePendingWritebackCommand {
  return isRecord(input)
    && isOperationInput(input, options)
    && normalizeExactIdentity(input.pendingWritebackId) !== undefined
    && isReviewCursor(input.expected)
    && (input.confirmation === undefined || isPrivateMemoryConfirmation(input.confirmation))
}

function isClearPrivateCommand(
  input: unknown,
  options: unknown,
): input is ChatWorkspaceClearPrivateMemoryCommand {
  return isRecord(input)
    && isOperationInput(input, options)
    && isReviewCursor(input.expected)
    && (input.confirmation === undefined || isPrivateMemoryConfirmation(input.confirmation))
}

function isReviewCursor(value: unknown): value is ChatWorkspaceReviewCursor {
  return isRecord(value)
    && normalizeExactScopeId(value.workspaceId) !== undefined
    && isTimestamp(value.revision)
}

function isPrivateMemoryConfirmation(value: unknown): value is ChatWorkspacePrivateMemoryConfirmation {
  return isRecord(value)
    && isTimestamp(value.revision)
    && isNonNegativeSafeInteger(value.privateMemoryCount)
}

function normalizeExactScopeId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeTavernWorkspaceScopeId(value)
  return normalized === value ? normalized : undefined
}

function normalizeExactIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 256 || value.trim() !== value || !value) {
    return undefined
  }
  return value
}

function readOperationTime(now: () => number): number | undefined {
  try {
    const value = now()
    return isTimestamp(value) ? value : undefined
  } catch {
    return undefined
  }
}

function assertApplication(application: ChatWorkspaceReviewApplication): void {
  if (
    !application
    || typeof application.resolveTavernActiveScopeId !== 'function'
  ) {
    throw new TypeError('The Chat workspace review application is invalid.')
  }
}

function assertScopePort(scopePort: ChatWorkspaceReviewScopePort): void {
  if (
    !scopePort
    || typeof scopePort.loadLinkedScope !== 'function'
    || typeof scopePort.compareAndSwap !== 'function'
  ) {
    throw new TypeError('The Chat workspace review scope port is invalid.')
  }
}

function isScopeLoadResult(value: unknown): value is ChatWorkspaceReviewScopeLoadResult {
  return isRecord(value)
    && (
      value.status === 'ready'
      || value.status === 'stale'
      || value.status === 'cancelled'
      || value.status === 'failed'
    )
}

function isScopeCompareAndSwapResult(
  value: unknown,
): value is ChatWorkspaceReviewScopeCompareAndSwapResult {
  return isRecord(value)
    && (
      value.status === 'applied'
      || value.status === 'conflict'
      || value.status === 'not_found'
      || value.status === 'cancelled'
      || value.status === 'failed'
    )
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return isRecord(value)
    && typeof value.aborted === 'boolean'
    && typeof value.addEventListener === 'function'
}

function isTimestamp(value: unknown): value is number {
  return isNonNegativeSafeInteger(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function confirmationRequired(
  operation: 'approve' | 'clear_private_memory',
  projection: ChatWorkspaceReviewProjection,
  privateMemoryCount: number,
): Extract<ChatWorkspaceReviewMutationOutcome, { status: 'confirmation_required' }> {
  return Object.freeze({
    status: 'confirmation_required',
    operation,
    confirmation: Object.freeze({
      revision: projection.revision,
      privateMemoryCount,
    }),
    projection,
  })
}

function stale(
  projection?: ChatWorkspaceReviewProjection,
): Extract<ChatWorkspaceReviewMutationOutcome, { status: 'stale' }> {
  return projection
    ? Object.freeze({ status: 'stale', projection })
    : Object.freeze({ status: 'stale' })
}

function notFound(
  projection: ChatWorkspaceReviewProjection,
): Extract<ChatWorkspaceReviewMutationOutcome, { status: 'not_found' }> {
  return Object.freeze({ status: 'not_found', target: 'pending_writeback', projection })
}

function cancelled(): ChatWorkspaceReviewCancelledOutcome {
  return Object.freeze({ status: 'cancelled' })
}

function failed(reason: string): ChatWorkspaceReviewFailedOutcome {
  return Object.freeze({ status: 'failed', reason })
}
