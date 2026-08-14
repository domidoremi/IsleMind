import type { AssistantRunId } from '@/core'

import type {
  WorkflowCheckpointErrorCode,
  WorkflowCheckpointStatus,
  WorkflowRecoveryDisposition,
  WorkflowCheckpointStore,
} from './workflowCheckpoint'

export type WorkflowCheckpointRecoveryObservationOutcome =
  | 'recovered'
  | 'not_found'
  | 'failed'
  | 'skipped_duplicate'
  | 'cancelled'

export type WorkflowCheckpointRecoveryFailureCode =
  | Exclude<WorkflowCheckpointErrorCode, 'not_found' | 'cancelled'>
  | 'invalid_recovery_result'
  | 'store_threw'

interface WorkflowCheckpointRecoveryObservationBase {
  readonly runId: AssistantRunId
  readonly checkpointStatus: WorkflowCheckpointStatus | null
  readonly recoveryDisposition: WorkflowRecoveryDisposition | null
  readonly source: 'current' | 'journal' | null
  readonly replaySideEffects: false
}

export interface RecoveredWorkflowCheckpointObservation
  extends WorkflowCheckpointRecoveryObservationBase {
  readonly outcome: 'recovered'
  readonly checkpointStatus: WorkflowCheckpointStatus
  readonly recoveryDisposition: WorkflowRecoveryDisposition
  readonly source: 'current' | 'journal'
  readonly lastSafeStepId?: string
  readonly failureCode?: string
}

export interface MissingWorkflowCheckpointObservation
  extends WorkflowCheckpointRecoveryObservationBase {
  readonly outcome: 'not_found'
  readonly checkpointStatus: null
  readonly recoveryDisposition: null
  readonly source: null
  readonly failureCode: 'not_found'
}

export interface FailedWorkflowCheckpointObservation
  extends WorkflowCheckpointRecoveryObservationBase {
  readonly outcome: 'failed'
  readonly checkpointStatus: null
  readonly recoveryDisposition: null
  readonly source: null
  readonly failureCode: WorkflowCheckpointRecoveryFailureCode
}

export interface SkippedDuplicateWorkflowCheckpointObservation
  extends WorkflowCheckpointRecoveryObservationBase {
  readonly outcome: 'skipped_duplicate'
  readonly checkpointStatus: null
  readonly recoveryDisposition: null
  readonly source: null
}

export interface CancelledWorkflowCheckpointRecoveryObservation
  extends WorkflowCheckpointRecoveryObservationBase {
  readonly outcome: 'cancelled'
  readonly checkpointStatus: null
  readonly recoveryDisposition: null
  readonly source: null
  readonly failureCode: 'cancelled'
}

export type WorkflowCheckpointRecoveryObservation =
  | RecoveredWorkflowCheckpointObservation
  | MissingWorkflowCheckpointObservation
  | FailedWorkflowCheckpointObservation
  | SkippedDuplicateWorkflowCheckpointObservation
  | CancelledWorkflowCheckpointRecoveryObservation

export interface WorkflowCheckpointRecoveryReport {
  readonly completion: 'completed' | 'cancelled'
  readonly requestedCount: number
  readonly processedCount: number
  readonly remainingCount: number
  readonly storeCallCount: number
  readonly recoveredCount: number
  readonly notFoundCount: number
  readonly failedCount: number
  readonly skippedDuplicateCount: number
  readonly cancelledCount: number
  readonly observations: readonly WorkflowCheckpointRecoveryObservation[]
}

export interface WorkflowCheckpointRecoveryCoordinator {
  recover(
    recoveredRunIds: readonly AssistantRunId[],
    signal: AbortSignal,
  ): Promise<WorkflowCheckpointRecoveryReport>
}

export function createWorkflowCheckpointRecoveryCoordinator(
  store: WorkflowCheckpointStore,
): WorkflowCheckpointRecoveryCoordinator {
  return Object.freeze({
    async recover(recoveredRunIds: readonly AssistantRunId[], signal: AbortSignal) {
      const orderedRunIds = [...recoveredRunIds]
      const observations: WorkflowCheckpointRecoveryObservation[] = []
      const seenRunIds = new Set<AssistantRunId>()
      let storeCallCount = 0
      let completion: WorkflowCheckpointRecoveryReport['completion'] = signal.aborted
        ? 'cancelled'
        : 'completed'

      for (const runId of orderedRunIds) {
        if (signal.aborted) {
          observations.push(cancelledObservation(runId))
          completion = 'cancelled'
          break
        }

        if (seenRunIds.has(runId)) {
          observations.push(skippedDuplicateObservation(runId))
          continue
        }
        seenRunIds.add(runId)

        storeCallCount += 1
        let projected: ProjectedStoreRecovery
        try {
          projected = projectStoreRecovery(runId, await store.recover(runId, signal))
        } catch {
          projected = signal.aborted
            ? { observation: cancelledObservation(runId), cancelled: true }
            : { observation: failedObservation(runId, 'store_threw'), cancelled: false }
        }
        observations.push(projected.observation)
        if (projected.cancelled) {
          completion = 'cancelled'
          break
        }
      }

      return createReport(orderedRunIds.length, storeCallCount, completion, observations)
    },
  })
}

interface ProjectedStoreRecovery {
  readonly observation: WorkflowCheckpointRecoveryObservation
  readonly cancelled: boolean
}

function projectStoreRecovery(runId: AssistantRunId, result: unknown): ProjectedStoreRecovery {
  try {
    if (!isRecord(result) || (result.ok !== true && result.ok !== false)) {
      return failedProjection(runId, 'invalid_recovery_result')
    }
    if (result.ok === false) {
      if (!isRecord(result.error) || typeof result.error.code !== 'string') {
        return failedProjection(runId, 'invalid_recovery_result')
      }
      if (result.error.code === 'not_found') {
        return { observation: missingObservation(runId), cancelled: false }
      }
      if (result.error.code === 'cancelled') {
        return { observation: cancelledObservation(runId), cancelled: true }
      }
      return failedProjection(
        runId,
        isCheckpointFailureCode(result.error.code)
          ? result.error.code
          : 'invalid_recovery_result',
      )
    }

    const recovery = result.value
    if (!isRecord(recovery) || recovery.replaySideEffects !== false ||
      (recovery.source !== 'current' && recovery.source !== 'journal') ||
      !isRecoveryDisposition(recovery.disposition) || !isRecord(recovery.checkpoint)) {
      return failedProjection(runId, 'invalid_recovery_result')
    }

    const checkpoint = recovery.checkpoint
    if (checkpoint.runId !== runId || !isCheckpointStatus(checkpoint.status)) {
      return failedProjection(runId, 'invalid_recovery_result')
    }

    const expectedDisposition = dispositionFor(checkpoint.status)
    if (recovery.disposition !== expectedDisposition) {
      return failedProjection(runId, 'invalid_recovery_result')
    }

    const checkpointFailure = checkpoint.failureEvidence
    const recoveryFailure = recovery.failureEvidence
    if (checkpoint.status === 'failed') {
      if (!isRecord(checkpointFailure) || !isRecord(recoveryFailure) ||
        !isBoundedText(checkpointFailure.code, 160) ||
        recoveryFailure.code !== checkpointFailure.code) {
        return failedProjection(runId, 'invalid_recovery_result')
      }
    } else if (checkpointFailure !== undefined || recoveryFailure !== undefined) {
      return failedProjection(runId, 'invalid_recovery_result')
    }

    const checkpointLastStep = checkpoint.lastCompletedStep
    const expectedLastSafeStepId = checkpointLastStep === undefined
      ? undefined
      : isRecord(checkpointLastStep) && isBoundedText(checkpointLastStep.id, 256)
        ? checkpointLastStep.id
        : null
    if (expectedLastSafeStepId === null || recovery.lastSafeStepId !== expectedLastSafeStepId) {
      return failedProjection(runId, 'invalid_recovery_result')
    }

    return {
      observation: Object.freeze({
        outcome: 'recovered',
        runId,
        checkpointStatus: checkpoint.status,
        recoveryDisposition: recovery.disposition,
        source: recovery.source,
        replaySideEffects: false,
        ...(expectedLastSafeStepId ? { lastSafeStepId: expectedLastSafeStepId } : {}),
        ...(checkpoint.status === 'failed'
          ? { failureCode: (checkpointFailure as { code: string }).code }
          : {}),
      }),
      cancelled: false,
    }
  } catch {
    return failedProjection(runId, 'invalid_recovery_result')
  }
}

function createReport(
  requestedCount: number,
  storeCallCount: number,
  completion: WorkflowCheckpointRecoveryReport['completion'],
  observations: readonly WorkflowCheckpointRecoveryObservation[],
): WorkflowCheckpointRecoveryReport {
  const frozenObservations = Object.freeze([...observations])
  return Object.freeze({
    completion,
    requestedCount,
    processedCount: frozenObservations.length,
    remainingCount: requestedCount - frozenObservations.length,
    storeCallCount,
    recoveredCount: countOutcome(frozenObservations, 'recovered'),
    notFoundCount: countOutcome(frozenObservations, 'not_found'),
    failedCount: countOutcome(frozenObservations, 'failed'),
    skippedDuplicateCount: countOutcome(frozenObservations, 'skipped_duplicate'),
    cancelledCount: countOutcome(frozenObservations, 'cancelled'),
    observations: frozenObservations,
  })
}

function countOutcome(
  observations: readonly WorkflowCheckpointRecoveryObservation[],
  outcome: WorkflowCheckpointRecoveryObservationOutcome,
): number {
  return observations.reduce((count, observation) => (
    observation.outcome === outcome ? count + 1 : count
  ), 0)
}

function failedProjection(
  runId: AssistantRunId,
  failureCode: WorkflowCheckpointRecoveryFailureCode,
): ProjectedStoreRecovery {
  return { observation: failedObservation(runId, failureCode), cancelled: false }
}

function emptyObservation(runId: AssistantRunId) {
  return {
    runId,
    checkpointStatus: null,
    recoveryDisposition: null,
    source: null,
    replaySideEffects: false as const,
  }
}

function missingObservation(runId: AssistantRunId): MissingWorkflowCheckpointObservation {
  return Object.freeze({
    outcome: 'not_found',
    ...emptyObservation(runId),
    failureCode: 'not_found',
  })
}

function failedObservation(
  runId: AssistantRunId,
  failureCode: WorkflowCheckpointRecoveryFailureCode,
): FailedWorkflowCheckpointObservation {
  return Object.freeze({
    outcome: 'failed',
    ...emptyObservation(runId),
    failureCode,
  })
}

function skippedDuplicateObservation(
  runId: AssistantRunId,
): SkippedDuplicateWorkflowCheckpointObservation {
  return Object.freeze({ outcome: 'skipped_duplicate', ...emptyObservation(runId) })
}

function cancelledObservation(
  runId: AssistantRunId,
): CancelledWorkflowCheckpointRecoveryObservation {
  return Object.freeze({
    outcome: 'cancelled',
    ...emptyObservation(runId),
    failureCode: 'cancelled',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength
}

function isCheckpointStatus(value: unknown): value is WorkflowCheckpointStatus {
  return value === 'planning' || value === 'running' || value === 'waiting' ||
    value === 'succeeded' || value === 'failed' || value === 'cancelled'
}

function isRecoveryDisposition(value: unknown): value is WorkflowRecoveryDisposition {
  return value === 'terminal' || value === 'awaiting-action' ||
    value === 'reconcile-before-resume' || value === 'failed-with-evidence'
}

function dispositionFor(status: WorkflowCheckpointStatus): WorkflowRecoveryDisposition {
  if (status === 'failed') return 'failed-with-evidence'
  if (status === 'waiting') return 'awaiting-action'
  if (status === 'planning' || status === 'running') return 'reconcile-before-resume'
  return 'terminal'
}

function isCheckpointFailureCode(
  value: string,
): value is Exclude<WorkflowCheckpointErrorCode, 'not_found' | 'cancelled'> {
  return value === 'invalid_transition' || value === 'conflict' ||
    value === 'invalid_record' || value === 'corruption' || value === 'persistence_failed'
}
