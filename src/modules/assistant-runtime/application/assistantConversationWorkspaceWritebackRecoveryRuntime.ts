import type { AssistantRun } from '../contracts'
import type { AssistantConversationWorkspaceWritebackOutcomeProjection } from './assistantConversationFinalizationRuntime'

export interface AssistantConversationWorkspaceWritebackReceiptLookupInput {
  readonly assistantRunId: AssistantRun['id']
  readonly conversationId: string
  readonly assistantMessageId: string
}

export interface AssistantConversationWorkspaceWritebackRecoveryDependencies {
  lookupReceipt(
    input: AssistantConversationWorkspaceWritebackReceiptLookupInput,
    options: { readonly signal: AbortSignal },
  ): Promise<unknown>
  projectWorkspaceWritebackOutcome(
    projection: AssistantConversationWorkspaceWritebackOutcomeProjection,
  ): void | Promise<void>
}

export interface AssistantConversationWorkspaceWritebackRecoveryReport {
  readonly status: 'completed' | 'cancelled'
  readonly checkedRunCount: number
  readonly projectedReceiptCount: number
  readonly noReceiptCount: number
  readonly ambiguousReceiptCount: number
  readonly failedReceiptCount: number
  readonly skippedRunCount: number
}

interface CommittedReceipt {
  readonly assistantRunId: AssistantRun['id']
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly workspaceId: string
  readonly expectedAuthorityRevision: number
  readonly idempotencyKey: string
  readonly outcomeStatus: 'applied' | 'no_changes'
  readonly authorityRevision: number
  readonly createdAt: number
}

type ParsedLookupOutcome =
  | { readonly status: 'none' | 'ambiguous' | 'cancelled' | 'failed' }
  | { readonly status: 'committed'; readonly receipt: CommittedReceipt }
  | { readonly status: 'invalid' }

/**
 * Reconciles only durable committed receipts for runs terminalized as interrupted.
 * The dependency surface deliberately cannot resolve or execute a writeback.
 */
export function createAssistantConversationWorkspaceWritebackRecoveryRuntime(
  dependencies: AssistantConversationWorkspaceWritebackRecoveryDependencies,
) {
  return {
    async reconcile(
      recoveredRuns: readonly AssistantRun[],
      options: { readonly signal: AbortSignal },
    ): Promise<AssistantConversationWorkspaceWritebackRecoveryReport> {
      const counts = {
        checkedRunCount: 0,
        projectedReceiptCount: 0,
        noReceiptCount: 0,
        ambiguousReceiptCount: 0,
        failedReceiptCount: 0,
        skippedRunCount: 0,
      }
      const checkedIdentities = new Set<string>()

      for (const run of recoveredRuns) {
        if (options.signal.aborted) return report('cancelled', counts)
        if (
          run.status !== 'failed'
          || run.failure?.code !== 'interrupted'
          || !isIdentity(run.responseMessageId)
        ) {
          counts.skippedRunCount += 1
          continue
        }

        const identity = `${run.id}\u0000${run.conversationId}\u0000${run.responseMessageId}`
        if (checkedIdentities.has(identity)) {
          counts.skippedRunCount += 1
          continue
        }
        checkedIdentities.add(identity)
        counts.checkedRunCount += 1

        const lookupInput = Object.freeze({
          assistantRunId: run.id,
          conversationId: run.conversationId,
          assistantMessageId: run.responseMessageId,
        })
        let candidate: unknown
        try {
          candidate = await dependencies.lookupReceipt(lookupInput, options)
        } catch {
          if (options.signal.aborted) return report('cancelled', counts)
          counts.failedReceiptCount += 1
          continue
        }
        if (options.signal.aborted) return report('cancelled', counts)

        const outcome = parseLookupOutcome(candidate, lookupInput)
        switch (outcome.status) {
          case 'none':
            counts.noReceiptCount += 1
            continue
          case 'ambiguous':
            counts.ambiguousReceiptCount += 1
            continue
          case 'cancelled':
            return report('cancelled', counts)
          case 'failed':
          case 'invalid':
            counts.failedReceiptCount += 1
            continue
          case 'committed':
            break
        }

        const receipt = outcome.receipt
        const projection = Object.freeze({
          assistantRunId: receipt.assistantRunId,
          conversationId: receipt.conversationId,
          assistantMessageId: receipt.assistantMessageId,
          workspaceId: receipt.workspaceId,
          repositoryAuthorityRevision: receipt.expectedAuthorityRevision,
          idempotencyKey: receipt.idempotencyKey,
          status: receipt.outcomeStatus,
          origin: 'recovered' as const,
          authorityRevision: receipt.authorityRevision,
          occurredAt: receipt.createdAt,
        })
        try {
          await dependencies.projectWorkspaceWritebackOutcome(projection)
          counts.projectedReceiptCount += 1
        } catch {
          counts.failedReceiptCount += 1
        }
      }

      return report('completed', counts)
    },
  }
}

function parseLookupOutcome(
  candidate: unknown,
  expected: AssistantConversationWorkspaceWritebackReceiptLookupInput,
): ParsedLookupOutcome {
  const value = readRecord(candidate)
  if (!value) return { status: 'invalid' }
  switch (value.status) {
    case 'none':
    case 'ambiguous':
    case 'cancelled':
    case 'failed':
      return { status: value.status }
    case 'committed': {
      const receipt = readCommittedReceipt(value.receipt, expected)
      return receipt ? { status: 'committed', receipt } : { status: 'invalid' }
    }
    default:
      return { status: 'invalid' }
  }
}

function readCommittedReceipt(
  candidate: unknown,
  expected: AssistantConversationWorkspaceWritebackReceiptLookupInput,
): CommittedReceipt | undefined {
  const value = readRecord(candidate)
  if (!value) return undefined
  if (
    value.assistantRunId !== expected.assistantRunId
    || value.conversationId !== expected.conversationId
    || value.assistantMessageId !== expected.assistantMessageId
    || !isIdentity(value.workspaceId)
    || !isIdentity(value.idempotencyKey)
    || !isNonNegativeSafeInteger(value.expectedAuthorityRevision)
    || (value.outcomeStatus !== 'applied' && value.outcomeStatus !== 'no_changes')
    || !isNonNegativeSafeInteger(value.authorityRevision)
    || !isNonNegativeSafeInteger(value.createdAt)
    || (value.outcomeStatus === 'applied'
      && value.authorityRevision <= value.expectedAuthorityRevision)
    || (value.outcomeStatus === 'no_changes'
      && value.authorityRevision !== value.expectedAuthorityRevision)
  ) {
    return undefined
  }
  return Object.freeze({
    assistantRunId: expected.assistantRunId,
    conversationId: expected.conversationId,
    assistantMessageId: expected.assistantMessageId,
    workspaceId: value.workspaceId,
    expectedAuthorityRevision: value.expectedAuthorityRevision,
    idempotencyKey: value.idempotencyKey,
    outcomeStatus: value.outcomeStatus,
    authorityRevision: value.authorityRevision,
    createdAt: value.createdAt,
  })
}

function report(
  status: AssistantConversationWorkspaceWritebackRecoveryReport['status'],
  counts: Omit<AssistantConversationWorkspaceWritebackRecoveryReport, 'status'>,
): AssistantConversationWorkspaceWritebackRecoveryReport {
  return Object.freeze({ status, ...counts })
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  try {
    return value as Readonly<Record<string, unknown>>
  } catch {
    return undefined
  }
}

function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
