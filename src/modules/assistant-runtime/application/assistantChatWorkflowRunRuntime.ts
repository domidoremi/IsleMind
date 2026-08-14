import {
  createAssistantRunId,
  err,
  type AssistantRunId,
  type IdGenerator,
  type Result,
} from '@/core'

import type {
  AssistantActivityExecutionResult,
  AssistantRun,
  AssistantRuntime,
  AssistantRuntimeErrorCode,
  ContextSnapshot,
  RunJournalEntry,
} from '../contracts'

export interface AssistantChatWorkflowContextAssemblyInput {
  readonly conversationId: string
  readonly conversationMessageIds: readonly string[]
  readonly requestMessageId?: string
  readonly requestText: string
  readonly cancellationSignal?: AbortSignal
}

export interface AssistantChatWorkflowAssembledContext {
  readonly snapshot: ContextSnapshot
}

export type AssistantChatWorkflowContextAssemblyErrorCode =
  | 'cancelled'
  | 'invalid_input'
  | 'retrieval_failed'
  | 'retrieval_invalid'
  | 'persistence_failed'

/**
 * Structural boundary implemented by the current context owner. Keeping this
 * port local lets Assistant Runtime consume the assembled value without
 * importing another module's internal contracts.
 */
export interface AssistantChatWorkflowContextAssemblyPort<
  TContext extends AssistantChatWorkflowAssembledContext,
> {
  assemble(
    input: AssistantChatWorkflowContextAssemblyInput,
  ): Promise<Result<TContext, AssistantChatWorkflowContextAssemblyErrorCode>>
}

export interface AssistantChatWorkflowExecutorInput<
  TContext extends AssistantChatWorkflowAssembledContext,
> {
  readonly run: AssistantRun
  readonly context: TContext
  readonly signal: AbortSignal
}

export interface AssistantChatWorkflowExecutor<
  TContext extends AssistantChatWorkflowAssembledContext,
> {
  execute(
    input: AssistantChatWorkflowExecutorInput<TContext>,
  ): Promise<AssistantActivityExecutionResult>
}

export interface AssistantChatWorkflowRunProjectionEvent {
  readonly run: AssistantRun
  readonly journalEntry?: RunJournalEntry
}

export type AssistantChatWorkflowRunProjection = (
  event: AssistantChatWorkflowRunProjectionEvent,
) => void | Promise<void>

export interface StartAssistantChatWorkflowRunInput<
  TContext extends AssistantChatWorkflowAssembledContext,
> {
  readonly runId?: AssistantRunId
  readonly conversationId: string
  readonly conversationMessageIds: readonly string[]
  readonly requestMessageId?: string
  readonly requestText: string
  readonly responseMessageId?: string
  readonly cancellationSignal?: AbortSignal
  readonly executor: AssistantChatWorkflowExecutor<TContext>
  readonly projection?: AssistantChatWorkflowRunProjection
}

export type AssistantChatWorkflowRunErrorCode =
  | AssistantRuntimeErrorCode
  | 'context_assembly_failed'

export interface AssistantChatWorkflowRunHandle {
  readonly runId: AssistantRunId
  readonly completion: Promise<
    Result<AssistantRun, AssistantChatWorkflowRunErrorCode>
  >
}

export interface AssistantChatWorkflowRunRuntimeDependencies<
  TContext extends AssistantChatWorkflowAssembledContext,
> {
  readonly ids: IdGenerator
  readonly assistantRuntime: AssistantRuntime
  readonly contextAssembly: AssistantChatWorkflowContextAssemblyPort<TContext>
}

export interface AssistantChatWorkflowRunRuntime<
  TContext extends AssistantChatWorkflowAssembledContext,
> {
  start(
    input: StartAssistantChatWorkflowRunInput<TContext>,
  ): AssistantChatWorkflowRunHandle
  cancel(
    runId: AssistantRunId,
  ): Promise<Result<AssistantRun, AssistantChatWorkflowRunErrorCode>>
}

/**
 * Starts durable workflow work as a Chat-owned AssistantRun. Conversations
 * already recovers kind:'chat', so this runtime intentionally owns no second
 * recovery scan.
 */
export function createAssistantChatWorkflowRunRuntime<
  TContext extends AssistantChatWorkflowAssembledContext,
>(
  dependencies: AssistantChatWorkflowRunRuntimeDependencies<TContext>,
): AssistantChatWorkflowRunRuntime<TContext> {
  return {
    start(input) {
      const runId = input.runId ?? createAssistantRunId(dependencies.ids)
      return {
        runId,
        completion: runAssistantChatWorkflow(dependencies, {
          ...input,
          runId,
        }),
      }
    },

    cancel(runId) {
      return dependencies.assistantRuntime.cancel(runId)
    },
  }
}

async function runAssistantChatWorkflow<
  TContext extends AssistantChatWorkflowAssembledContext,
>(
  dependencies: AssistantChatWorkflowRunRuntimeDependencies<TContext>,
  input: StartAssistantChatWorkflowRunInput<TContext> & {
    readonly runId: AssistantRunId
  },
): Promise<Result<AssistantRun, AssistantChatWorkflowRunErrorCode>> {
  let assembled: Result<
    TContext,
    AssistantChatWorkflowContextAssemblyErrorCode
  >
  try {
    assembled = await dependencies.contextAssembly.assemble({
      conversationId: input.conversationId,
      conversationMessageIds: input.conversationMessageIds,
      ...(input.requestMessageId === undefined
        ? {}
        : { requestMessageId: input.requestMessageId }),
      requestText: input.requestText,
      ...(input.cancellationSignal
        ? { cancellationSignal: input.cancellationSignal }
        : {}),
    })
  } catch (error) {
    if (input.cancellationSignal?.aborted) {
      return err(
        'cancelled',
        'The Chat workflow context assembly was cancelled.',
        { retryable: true },
      )
    }
    return err(
      'context_assembly_failed',
      error instanceof Error
        ? error.message
        : 'The Chat workflow context could not be assembled.',
      { retryable: true },
    )
  }

  if (!assembled.ok) {
    const options = {
      retryable: assembled.error.retryable,
      ...(assembled.error.details ? { details: assembled.error.details } : {}),
    }
    if (assembled.error.code === 'cancelled') {
      return err('cancelled', assembled.error.message, options)
    }
    return err('context_assembly_failed', assembled.error.message, options)
  }

  const context = assembled.value
  return dependencies.assistantRuntime.executeActivity({
    runId: input.runId,
    kind: 'chat',
    conversationId: input.conversationId,
    context: context.snapshot,
    ...(input.responseMessageId === undefined
      ? {}
      : { responseMessageId: input.responseMessageId }),
    ...(input.cancellationSignal
      ? { cancellationSignal: input.cancellationSignal }
      : {}),
    executor: {
      execute: ({ run, signal }) =>
        input.executor.execute({ run, context, signal }),
    },
    ...(input.projection
      ? {
          onPersisted: ({ run, journalEntry }) =>
            input.projection?.({ run, journalEntry }),
        }
      : {}),
  })
}
