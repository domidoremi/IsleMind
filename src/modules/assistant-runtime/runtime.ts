import {
  createAssistantRunId,
  err,
  ok,
  type AssistantRunId,
  type JsonRecord,
  type StreamEvent,
} from '@/core'
import type {
  AssistantRun,
  AssistantRunProjection,
  AssistantActivityExecutionResult,
  AssistantRuntime,
  AssistantRuntimeDependencies,
  AssistantRuntimeErrorCode,
  RunJournalEntry,
  RunJournalEventType,
  AssistantModelOperationTurnOutcome,
  AssistantModelOperationSession,
  StartAssistantActivityRunInput,
  StartAssistantRunInput,
} from './contracts'

const DEFAULT_MAX_OUTPUT_CHARS = 100_000
const JOURNAL_TEXT_LIMIT = 4_096
const JOURNAL_LABEL_LIMIT = 512

class PersistenceFailure extends Error {
  constructor() {
    super('Assistant run persistence failed.')
    this.name = 'PersistenceFailure'
  }
}

interface ActiveRun {
  controller: AbortController
  now: () => number
  run: AssistantRun
  outputText: string
  streamEventCount: number
  cancellationRequested: boolean
  failure?: {
    code: Extract<AssistantRuntimeErrorCode, 'output_limit_exceeded'>
    message: string
  }
  onPersisted?: AssistantRunProjection
  detachExternalCancellation?: () => void
  writeTail: Promise<void>
}

export function createAssistantRuntime(dependencies: AssistantRuntimeDependencies): AssistantRuntime {
  const activeRuns = new Map<AssistantRunId, ActiveRun>()
  const resumingRuns = new Set<AssistantRunId>()
  const maxOutputChars = normalizeMaxOutputChars(dependencies.options?.maxOutputChars)

  return {
    async execute(input) {
      const runId = input.runId ?? createAssistantRunId(dependencies.ids)
      if (activeRuns.has(runId)) {
        return err('run_already_exists', 'An assistant run with this ID already exists.', {
          retryable: false,
          details: { runId },
        })
      }
      try {
        if (await dependencies.persistence.get(runId)) {
          return err('run_already_exists', 'An assistant run with this ID already exists.', {
            retryable: false,
            details: { runId },
          })
        }
      } catch {
        return err('persistence_failed', 'The assistant run could not be loaded.', { retryable: true })
      }

      const active: ActiveRun = {
        controller: new AbortController(),
        now: dependencies.clock.now,
        run: createQueuedRun(runId, input, dependencies.clock.now()),
        outputText: '',
        streamEventCount: 0,
        cancellationRequested: false,
        ...(input.onPersisted ? { onPersisted: input.onPersisted } : {}),
        writeTail: Promise.resolve(),
      }
      try {
        await record(active, 'run.created', {
          conversationId: input.request.conversationId,
          contextSnapshotId: input.context.id,
          providerId: input.request.providerId,
          ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
        })
        activeRuns.set(runId, active)
        attachExternalCancellation(active, input.cancellationSignal)
        if (active.cancellationRequested || active.controller.signal.aborted) {
          const cancelled = await finishCancelled(active)
          return err('cancelled', 'The assistant run was cancelled.', {
            retryable: true,
            details: { runId: cancelled.id },
          })
        }
        await record(active, 'run.started', {}, {
          status: 'running',
          startedAt: dependencies.clock.now(),
        })

        return await runProviderTurns(
          active,
          input.request,
          input.providerGatewayOptions,
          input.modelOperationSession,
          0,
          true,
        )
      } catch (error) {
        if (error instanceof PersistenceFailure) {
          return err('persistence_failed', 'The assistant run could not be checkpointed.', { retryable: true })
        }

        if (active.cancellationRequested || active.controller.signal.aborted) {
          try {
            const cancelled = await finishCancelled(active)
            return err('cancelled', 'The assistant run was cancelled.', {
              retryable: true,
              details: { runId: cancelled.id },
            })
          } catch {
            return err('persistence_failed', 'The cancelled assistant run could not be recorded.', { retryable: true })
          }
        }

        try {
          const failed = await finishFailed(active, 'provider_failed', 'The provider stream ended unexpectedly.')
          return err('provider_failed', 'The provider stream ended unexpectedly.', {
            retryable: true,
            details: { runId: failed.id },
          })
        } catch {
          return err('persistence_failed', 'The failed assistant run could not be recorded.', { retryable: true })
        }
      } finally {
        active.detachExternalCancellation?.()
        activeRuns.delete(runId)
      }
    },

    async executeActivity(input) {
      const runId = input.runId ?? createAssistantRunId(dependencies.ids)
      if (input.kind !== 'chat') {
        return err('activity_failed', 'New assistant activities must be owned by Chat.', {
          retryable: false,
          details: { runId },
        })
      }
      if (activeRuns.has(runId)) {
        return err('run_already_exists', 'An assistant run with this ID already exists.', {
          retryable: false,
          details: { runId },
        })
      }
      try {
        if (await dependencies.persistence.get(runId)) {
          return err('run_already_exists', 'An assistant run with this ID already exists.', {
            retryable: false,
            details: { runId },
          })
        }
      } catch {
        return err('persistence_failed', 'The assistant run could not be loaded.', { retryable: true })
      }

      const active: ActiveRun = {
        controller: new AbortController(),
        now: dependencies.clock.now,
        run: createQueuedActivityRun(runId, input, dependencies.clock.now()),
        outputText: '',
        streamEventCount: 0,
        cancellationRequested: false,
        ...(input.onPersisted ? { onPersisted: input.onPersisted } : {}),
        writeTail: Promise.resolve(),
      }
      try {
        await record(active, 'run.created', {
          conversationId: input.conversationId,
          contextSnapshotId: input.context.id,
          executionKind: input.kind,
          ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
        })
        activeRuns.set(runId, active)
        attachExternalCancellation(active, input.cancellationSignal)
        if (active.cancellationRequested || active.controller.signal.aborted) {
          const cancelled = await finishCancelled(active)
          return err('cancelled', 'The assistant run was cancelled.', {
            retryable: true,
            details: { runId: cancelled.id },
          })
        }
        await record(active, 'run.started', {}, {
          status: 'running',
          startedAt: dependencies.clock.now(),
        })

        let execution: AssistantActivityExecutionResult
        try {
          execution = await input.executor.execute({ run: active.run, signal: active.controller.signal })
        } catch {
          if (active.cancellationRequested || active.controller.signal.aborted) {
            const cancelled = await finishCancelled(active)
            return err('cancelled', 'The assistant run was cancelled.', {
              retryable: true,
              details: { runId: cancelled.id },
            })
          }
          const failed = await finishFailed(active, 'activity_failed', 'The assistant activity ended unexpectedly.')
          return err('activity_failed', failed.failure?.message ?? 'The assistant activity ended unexpectedly.', {
            retryable: true,
            details: { runId: failed.id },
          })
        }

        if (active.cancellationRequested || active.controller.signal.aborted) {
          const cancelled = await finishCancelled(active)
          return err('cancelled', 'The assistant run was cancelled.', {
            retryable: true,
            details: { runId: cancelled.id },
          })
        }

        const normalized = normalizeActivityExecution(execution)
        if (!normalized) {
          const failed = await finishFailed(active, 'activity_failed', 'The assistant activity returned an invalid result.')
          return err('activity_failed', failed.failure?.message ?? 'The assistant activity returned an invalid result.', {
            retryable: false,
            details: { runId: failed.id },
          })
        }
        active.outputText = normalized.outputText
        active.streamEventCount = normalized.eventCount
        if (active.outputText.length > maxOutputChars) {
          const failed = await finishFailed(active, 'output_limit_exceeded', 'The assistant activity output exceeded the configured run limit.')
          return err('output_limit_exceeded', failed.failure?.message ?? 'The assistant activity output exceeded the configured run limit.', {
            retryable: false,
            details: { runId: failed.id },
          })
        }
        if (normalized.outcome === 'failed') {
          const failed = await finishFailed(active, 'activity_failed', normalized.failureMessage ?? 'The assistant activity reported a failure.')
          return err('activity_failed', failed.failure?.message ?? 'The assistant activity reported a failure.', {
            retryable: true,
            details: { runId: failed.id },
          })
        }

        return ok(await finishSucceeded(active))
      } catch (error) {
        if (error instanceof PersistenceFailure) {
          return err('persistence_failed', 'The assistant run could not be checkpointed.', { retryable: true })
        }
        if (active.cancellationRequested || active.controller.signal.aborted) {
          try {
            const cancelled = await finishCancelled(active)
            return err('cancelled', 'The assistant run was cancelled.', {
              retryable: true,
              details: { runId: cancelled.id },
            })
          } catch {
            return err('persistence_failed', 'The cancelled assistant run could not be recorded.', { retryable: true })
          }
        }
        try {
          const failed = await finishFailed(active, 'activity_failed', 'The assistant activity ended unexpectedly.')
          return err('activity_failed', 'The assistant activity ended unexpectedly.', {
            retryable: true,
            details: { runId: failed.id },
          })
        } catch {
          return err('persistence_failed', 'The failed assistant run could not be recorded.', { retryable: true })
        }
      } finally {
        active.detachExternalCancellation?.()
        activeRuns.delete(runId)
      }
    },

    async resumeModelOperation(input) {
      if (activeRuns.has(input.runId) || resumingRuns.has(input.runId)) {
        return err('run_already_exists', 'The assistant run is already active.', {
          retryable: false,
          details: { runId: input.runId },
        })
      }
      resumingRuns.add(input.runId)
      let saved: AssistantRun | undefined
      try {
        saved = await dependencies.persistence.get(input.runId)
      } catch {
        resumingRuns.delete(input.runId)
        return err('persistence_failed', 'The assistant run could not be loaded.', { retryable: true })
      }
      if (!saved) {
        resumingRuns.delete(input.runId)
        return err('run_not_found', 'The assistant run does not exist.', { retryable: false })
      }
      if (saved.status !== 'awaiting-confirmation' || !saved.pendingModelOperation) {
        resumingRuns.delete(input.runId)
        return err('run_not_active', 'The assistant run is not awaiting model-operation confirmation.', {
          retryable: false,
        })
      }

      const active: ActiveRun = {
        controller: new AbortController(),
        now: dependencies.clock.now,
        run: saved,
        outputText: saved.checkpoint?.outputText ?? '',
        streamEventCount: saved.checkpoint?.streamEventCount ?? 0,
        cancellationRequested: false,
        ...(input.onPersisted ? { onPersisted: input.onPersisted } : {}),
        writeTail: Promise.resolve(),
      }
      activeRuns.set(saved.id, active)
      attachExternalCancellation(active, input.cancellationSignal)
      try {
        if (active.cancellationRequested || active.controller.signal.aborted) {
          const cancelled = await finishCancelled(active)
          return err('cancelled', 'The assistant run was cancelled.', {
            retryable: true,
            details: { runId: cancelled.id },
          })
        }
        const pending = saved.pendingModelOperation
        if (pending.runId !== saved.id || !input.session.validatePending({ run: saved, pending })) {
          return err('run_not_active', 'The pending model-operation confirmation is invalid.', {
            retryable: false,
            details: { runId: saved.id },
          })
        }
        await record(active, 'run.confirmation-resolved', {
          approved: input.approved,
          callId: pending.callId,
          operationId: pending.operationId,
        }, {
          status: 'running',
          pendingModelOperation: undefined,
        })
        const resumed = await input.session.resume({
          run: active.run,
          pending,
          approved: input.approved,
          signal: active.controller.signal,
        })
        if (resumed.kind === 'cancelled') {
          const cancelled = await finishCancelled(active)
          return err('cancelled', 'The assistant run was cancelled.', {
            retryable: true,
            details: { runId: cancelled.id },
          })
        }
        if (resumed.kind === 'awaiting-confirmation') {
          const failed = await finishFailed(
            active,
            'provider_failed',
            'A resumed model operation requested confirmation more than once.',
          )
          return err('provider_failed', failed.failure?.message ?? 'The model operation could not resume.', {
            retryable: false,
            details: { runId: failed.id },
          })
        }
        if (resumed.kind !== 'continue') {
          const failed = await finishFailed(active, 'provider_failed', 'The model operation continuation is unavailable.')
          return err('provider_failed', failed.failure?.message ?? 'The model operation continuation is unavailable.', {
            retryable: false,
            details: { runId: failed.id },
          })
        }
        await recordModelOperationSelection(active, resumed)
        return await runProviderTurns(
          active,
          resumed.request,
          input.providerGatewayOptions,
          input.session,
          pending.stepIndex + 1,
          false,
        )
      } catch (error) {
        if (error instanceof PersistenceFailure) {
          return err('persistence_failed', 'The assistant run could not be checkpointed.', { retryable: true })
        }
        if (active.cancellationRequested || active.controller.signal.aborted) {
          try {
            const cancelled = await finishCancelled(active)
            return err('cancelled', 'The assistant run was cancelled.', {
              retryable: true,
              details: { runId: cancelled.id },
            })
          } catch {
            return err('persistence_failed', 'The cancelled assistant run could not be recorded.', { retryable: true })
          }
        }
        try {
          const failed = await finishFailed(active, 'provider_failed', 'The model operation continuation failed.')
          return err('provider_failed', failed.failure?.message ?? 'The model operation continuation failed.', {
            retryable: true,
            details: { runId: failed.id },
          })
        } catch {
          return err('persistence_failed', 'The failed assistant run could not be recorded.', { retryable: true })
        }
      } finally {
        active.detachExternalCancellation?.()
        activeRuns.delete(saved.id)
        resumingRuns.delete(input.runId)
      }
    },

    async cancel(runId) {
      const active = activeRuns.get(runId)
      if (!active) {
        let saved: AssistantRun | undefined
        try {
          saved = await dependencies.persistence.get(runId)
        } catch {
          return err('persistence_failed', 'The assistant run could not be loaded.', { retryable: true })
        }
        if (!saved) {
          return err('run_not_found', 'The assistant run does not exist.', { retryable: false })
        }
        return err('run_not_active', 'The assistant run is no longer active.', { retryable: false })
      }

      try {
        return ok(await requestCancellation(active, 'caller_requested'))
      } catch {
        return err('persistence_failed', 'The cancellation request could not be recorded.', { retryable: true })
      }
    },

    getRun(runId) {
      return dependencies.persistence.get(runId)
    },

    async recoverInterruptedRuns() {
      let recoverableRuns: readonly AssistantRun[]
      try {
        recoverableRuns = await dependencies.persistence.listRecoverable()
      } catch {
        return err('persistence_failed', 'Interrupted assistant runs could not be loaded for recovery.', { retryable: true })
      }

      const recovered: AssistantRun[] = []
      for (const run of recoverableRuns) {
        if (activeRuns.has(run.id)) continue
        const active: ActiveRun = {
          controller: new AbortController(),
          now: dependencies.clock.now,
          run,
          outputText: run.checkpoint?.outputText ?? '',
          streamEventCount: run.checkpoint?.streamEventCount ?? 0,
          cancellationRequested: false,
          writeTail: Promise.resolve(),
        }
        try {
          recovered.push(await record(active, 'run.failed', {
            recovery: 'interrupted_after_restart',
            outputLength: active.outputText.length,
            streamEventCount: active.streamEventCount,
          }, {
            status: 'failed',
            completedAt: dependencies.clock.now(),
            pendingModelOperation: undefined,
            failure: {
              code: 'interrupted',
              message: 'The assistant run was interrupted before completion and was safely recovered.',
            },
          }))
        } catch {
          return err('persistence_failed', 'An interrupted assistant run could not be safely recovered.', { retryable: true })
        }
      }
      return ok(recovered)
    },
  }

  async function runProviderTurns(
    active: ActiveRun,
    initialRequest: StartAssistantRunInput['request'],
    providerGatewayOptions: StartAssistantRunInput['providerGatewayOptions'],
    modelOperationSession: AssistantModelOperationSession | undefined,
    initialStepIndex: number,
    prepareInitialRequest: boolean,
  ): Promise<ReturnType<AssistantRuntime['execute']> extends Promise<infer TResult> ? TResult : never> {
    let request = prepareInitialRequest && modelOperationSession
      ? modelOperationSession.prepareRequest(initialRequest)
      : initialRequest
    let stepIndex = initialStepIndex

    while (true) {
      const outputStart = active.outputText.length
      const calls: Array<{
        callId: string
        name: string
        arguments: JsonRecord
        providerMetadata?: JsonRecord
      }> = []
      for await (const event of dependencies.providerGateway.stream(request, {
        signal: active.controller.signal,
        ...(providerGatewayOptions ?? {}),
        onRouteSelected: async (route) => {
          await providerGatewayOptions?.onRouteSelected?.(route)
          await record(active, 'provider.route-selected', {
            providerId: route.providerId,
            model: route.model,
          }, {
            providerId: route.providerId,
            model: route.model,
          })
        },
      })) {
        if (active.controller.signal.aborted) break
        if (event.type === 'tool-call') {
          calls.push({
            callId: event.toolCallId,
            name: event.toolName,
            arguments: event.arguments ?? {},
            ...(event.providerMetadata ? { providerMetadata: event.providerMetadata } : {}),
          })
        }
        applyStreamEvent(active, event, maxOutputChars)
        await record(active, 'stream.event', journalDataForStreamEvent(event), {
          checkpoint: {
            outputText: active.outputText,
            streamEventCount: active.streamEventCount,
          },
        })
        if (active.failure) break
      }

      if (active.failure) {
        const failed = await finishFailed(active, active.failure.code, active.failure.message)
        return err(active.failure.code, active.failure.message, {
          retryable: false,
          details: { runId: failed.id },
        })
      }
      if (active.cancellationRequested || active.controller.signal.aborted) {
        const cancelled = await finishCancelled(active)
        return err('cancelled', 'The assistant run was cancelled.', {
          retryable: true,
          details: { runId: cancelled.id },
        })
      }
      if (!modelOperationSession) return ok(await finishSucceeded(active))

      const outcome = await modelOperationSession.evaluateTurn({
        run: active.run,
        request,
        outputText: active.outputText.slice(outputStart),
        calls: Object.freeze(calls),
        stepIndex,
        signal: active.controller.signal,
      })
      if (outcome.kind === 'no-operation') return ok(await finishSucceeded(active))

      active.outputText = active.outputText.slice(0, outputStart)
      if (outcome.kind === 'cancelled') {
        await recordModelOperationSelection(active, outcome)
        const cancelled = await finishCancelled(active)
        return err('cancelled', 'The assistant run was cancelled.', {
          retryable: true,
          details: { runId: cancelled.id },
        })
      }
      if (outcome.kind === 'awaiting-confirmation') {
        await recordModelOperationSelection(active, outcome)
        return ok(await record(active, 'run.awaiting-confirmation', {
          callId: outcome.pending.callId,
          operationId: outcome.pending.operationId,
          catalogRevision: outcome.pending.catalogRevision,
        }, {
          status: 'awaiting-confirmation',
          pendingModelOperation: outcome.pending,
          checkpoint: {
            outputText: active.outputText,
            streamEventCount: active.streamEventCount,
          },
        }))
      }

      await recordModelOperationSelection(active, outcome)
      request = outcome.request
      stepIndex += 1
    }
  }

  async function recordModelOperationSelection(
    active: ActiveRun,
    outcome: Exclude<AssistantModelOperationTurnOutcome, { kind: 'no-operation' }>,
  ): Promise<void> {
    await record(active, 'model-operation.selected', {
      outcome: outcome.kind,
      receipt: outcome.receipt,
    }, {
      checkpoint: {
        outputText: active.outputText,
        streamEventCount: active.streamEventCount,
      },
    })
  }

  async function record(
    active: ActiveRun,
    type: RunJournalEventType,
    data: JsonRecord,
    patch: Partial<AssistantRun> = {},
  ): Promise<AssistantRun> {
    return enqueue(active, async () => {
      const entry: RunJournalEntry = {
        schema: 'islemind.assistant-run-journal-entry.v1',
        runId: active.run.id,
        sequence: active.run.journalSequence + 1,
        type,
        occurredAt: dependencies.clock.now(),
        ...(Object.keys(data).length ? { data } : {}),
      }
      try {
        const next = {
          ...active.run,
          ...patch,
          journalSequence: entry.sequence,
        }
        await dependencies.persistence.appendAndSave(entry, next)
        active.run = next
        await projectPersistedRun(active, next, entry)
        return next
      } catch {
        throw new PersistenceFailure()
      }
    })
  }

  async function finishSucceeded(active: ActiveRun): Promise<AssistantRun> {
    return recordTerminal(active, 'run.succeeded', {
      status: 'succeeded',
      completedAt: dependencies.clock.now(),
      result: {
        outputText: active.outputText,
        streamEventCount: active.streamEventCount,
      },
      checkpoint: {
        outputText: active.outputText,
        streamEventCount: active.streamEventCount,
      },
    })
  }

  async function finishFailed(
    active: ActiveRun,
    code: Extract<AssistantRuntimeErrorCode, 'output_limit_exceeded' | 'provider_failed' | 'activity_failed'>,
    message: string,
  ): Promise<AssistantRun> {
    return recordTerminal(active, 'run.failed', {
      status: 'failed',
      completedAt: dependencies.clock.now(),
      failure: { code, message },
      checkpoint: {
        outputText: active.outputText,
        streamEventCount: active.streamEventCount,
      },
    }, { code, message })
  }

  async function finishCancelled(active: ActiveRun): Promise<AssistantRun> {
    return recordTerminal(active, 'run.cancelled', {
      status: 'cancelled',
      completedAt: dependencies.clock.now(),
      checkpoint: {
        outputText: active.outputText,
        streamEventCount: active.streamEventCount,
      },
    })
  }

  async function recordTerminal(
    active: ActiveRun,
    type: Extract<RunJournalEventType, 'run.succeeded' | 'run.failed' | 'run.cancelled'>,
    patch: Partial<AssistantRun>,
    data: JsonRecord = {},
  ): Promise<AssistantRun> {
    return record(active, type, {
      outputLength: active.outputText.length,
      streamEventCount: active.streamEventCount,
      ...data,
    }, {
      ...patch,
      pendingModelOperation: undefined,
    })
  }

  function attachExternalCancellation(active: ActiveRun, signal: AbortSignal | undefined): void {
    if (!signal) return
    const cancel = () => {
      void requestCancellation(active, 'external_signal').catch(() => undefined)
    }
    signal.addEventListener('abort', cancel, { once: true })
    active.detachExternalCancellation = () => signal.removeEventListener('abort', cancel)
    if (signal.aborted) cancel()
  }

  async function requestCancellation(active: ActiveRun, reason: 'caller_requested' | 'external_signal'): Promise<AssistantRun> {
    if (active.cancellationRequested) return active.run
    active.cancellationRequested = true
    active.controller.abort()
    return record(active, 'run.cancellation-requested', { reason }, {
      cancellationRequestedAt: active.now(),
    })
  }
}

async function projectPersistedRun(
  active: ActiveRun,
  run: AssistantRun,
  journalEntry: RunJournalEntry,
): Promise<void> {
  try {
    await active.onPersisted?.({ run, journalEntry })
  } catch {
    // Projection is a disposable view concern; durable execution remains authoritative.
  }
}

function createQueuedRun(runId: AssistantRunId, input: StartAssistantRunInput, createdAt: number): AssistantRun {
  return {
    id: runId,
    kind: 'chat',
    conversationId: input.request.conversationId,
    ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
    providerId: input.request.providerId,
    model: input.request.model,
    contextSnapshotId: input.context.id,
    status: 'queued',
    createdAt,
    journalSequence: 0,
  }
}

function createQueuedActivityRun(
  runId: AssistantRunId,
  input: StartAssistantActivityRunInput,
  createdAt: number,
): AssistantRun {
  return {
    id: runId,
    kind: 'chat',
    conversationId: input.conversationId,
    ...(input.responseMessageId ? { responseMessageId: input.responseMessageId } : {}),
    ...(input.workspaceWritebackHandoff
      ? { workspaceWritebackHandoff: input.workspaceWritebackHandoff }
      : {}),
    // Non-provider activities retain the historical internal envelope. Rich
    // Chat compatibility activities supply the concrete provider route.
    providerId: input.providerId ?? 'islemind-activity',
    model: input.model ?? 'chat',
    contextSnapshotId: input.context.id,
    status: 'queued',
    createdAt,
    journalSequence: 0,
  }
}

function normalizeActivityExecution(
  value: AssistantActivityExecutionResult,
): { outputText: string; eventCount: number; outcome: 'succeeded' | 'failed'; failureMessage?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (value.outputText !== undefined && typeof value.outputText !== 'string') return undefined
  if (value.eventCount !== undefined && (!Number.isSafeInteger(value.eventCount) || value.eventCount < 0)) return undefined
  if (value.outcome !== undefined && value.outcome !== 'succeeded' && value.outcome !== 'failed') return undefined
  if (value.failureMessage !== undefined && (typeof value.failureMessage !== 'string' || value.failureMessage.length > 2_000)) return undefined
  return {
    outputText: value.outputText ?? '',
    eventCount: value.eventCount ?? 0,
    outcome: value.outcome ?? 'succeeded',
    ...(value.failureMessage?.trim() ? { failureMessage: value.failureMessage.trim() } : {}),
  }
}

function enqueue<Value>(active: ActiveRun, work: () => Promise<Value>): Promise<Value> {
  const next = active.writeTail.then(work, work)
  active.writeTail = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function applyStreamEvent(active: ActiveRun, event: StreamEvent, maxOutputChars: number): void {
  active.streamEventCount += 1
  if (event.type !== 'text-delta') return

  const remaining = maxOutputChars - active.outputText.length
  if (remaining <= 0) {
    active.failure = {
      code: 'output_limit_exceeded',
      message: 'The provider output exceeded the configured run limit.',
    }
    active.controller.abort()
    return
  }

  active.outputText += event.text.slice(0, remaining)
  if (event.text.length > remaining) {
    active.failure = {
      code: 'output_limit_exceeded',
      message: 'The provider output exceeded the configured run limit.',
    }
    active.controller.abort()
  }
}

function journalDataForStreamEvent(event: StreamEvent): JsonRecord {
  if (event.type === 'text-delta') {
    return { eventType: event.type, text: truncate(event.text, JOURNAL_TEXT_LIMIT) }
  }
  if (event.type === 'citation') {
    return {
      eventType: event.type,
      citationId: truncate(event.citationId, JOURNAL_LABEL_LIMIT),
      ...(event.title ? { title: truncate(event.title, JOURNAL_LABEL_LIMIT) } : {}),
      ...(event.url ? { url: truncate(event.url, JOURNAL_LABEL_LIMIT) } : {}),
    }
  }
  if (event.type === 'tool-call') {
    return {
      eventType: event.type,
      toolCallId: truncate(event.toolCallId, JOURNAL_LABEL_LIMIT),
      toolName: truncate(event.toolName, JOURNAL_LABEL_LIMIT),
    }
  }
  if (event.type === 'usage') {
    return {
      eventType: event.type,
      ...(typeof event.inputTokens === 'number' ? { inputTokens: event.inputTokens } : {}),
      ...(typeof event.outputTokens === 'number' ? { outputTokens: event.outputTokens } : {}),
      ...(typeof event.totalTokens === 'number' ? { totalTokens: event.totalTokens } : {}),
      ...(typeof event.cacheCreationInputTokens === 'number' ? { cacheCreationInputTokens: event.cacheCreationInputTokens } : {}),
      ...(typeof event.cacheReadInputTokens === 'number' ? { cacheReadInputTokens: event.cacheReadInputTokens } : {}),
      ...(typeof event.cachedInputTokens === 'number' ? { cachedInputTokens: event.cachedInputTokens } : {}),
      ...(typeof event.reasoningTokens === 'number' ? { reasoningTokens: event.reasoningTokens } : {}),
    }
  }
  return {
    eventType: event.type,
    code: truncate(event.code, JOURNAL_LABEL_LIMIT),
  }
}

function normalizeMaxOutputChars(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value < 1) return DEFAULT_MAX_OUTPUT_CHARS
  return Math.floor(value)
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}
