import {
  createAssistantRunId,
  type AssistantRunId,
  type IdGenerator,
  type Result,
  type StreamEvent,
} from '@/core'

import type {
  AssistantActivityRequestEvidence,
  AssistantActivityExecutionResult,
  AssistantActivityExecutionInput,
  AssistantRun,
  AssistantRunProjection,
  AssistantRuntimeErrorCode,
  ContextSnapshot,
  StartAssistantActivityRunInput,
} from '../contracts'
import type { AssistantConversationWorkspaceWritebackHandoff } from '../workspaceWritebackContracts'

export type AssistantConversationDurableExecutionStartedPublication =
  | { readonly kind: 'published' }
  | {
      readonly kind: 'rejected'
      readonly reason:
        | 'already_published'
        | 'execution_settled'
        | 'terminal'
    }

export interface AssistantConversationDurableExecutionCallbackInput<TStarted> {
  readonly run: AssistantRun
  readonly signal: AbortSignal
  readonly checkpointStreamEvent?: (event: StreamEvent) => Promise<void>
  readonly checkpointTextDelta?: (text: string) => Promise<void>
  readonly continueProviderTurns?: AssistantActivityExecutionInput['continueProviderTurns']
  readonly started: (
    value: TStarted,
  ) => AssistantConversationDurableExecutionStartedPublication
}

export interface AssistantConversationDurableExecutionInput<TStarted> {
  readonly runId?: AssistantRunId
  readonly conversationId: string
  readonly responseMessageId: string
  readonly providerId: string
  readonly model: string
  readonly requestEvidence?: AssistantActivityRequestEvidence
  readonly context: ContextSnapshot
  readonly workspaceWritebackHandoff?: AssistantConversationWorkspaceWritebackHandoff
  readonly cancellationSignal?: AbortSignal
  readonly onPersisted?: AssistantRunProjection
  readonly execute: (
    input: AssistantConversationDurableExecutionCallbackInput<TStarted>,
  ) => Promise<AssistantActivityExecutionResult>
}

export type AssistantConversationDurableExecutionOutcome<TStarted> =
  | {
      readonly kind: 'started'
      readonly runId: AssistantRunId
      readonly value: TStarted
      readonly completion: Promise<
        Result<AssistantRun, AssistantRuntimeErrorCode>
      >
    }
  | {
      readonly kind: 'terminal'
      readonly result: Result<AssistantRun, AssistantRuntimeErrorCode>
    }

export interface AssistantConversationDurableExecutionActivityPort {
  executeActivity(
    input: StartAssistantActivityRunInput,
  ): Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
}

export interface AssistantConversationDurableExecutionRuntimeDependencies {
  readonly ids: IdGenerator
  readonly activityRuntime: AssistantConversationDurableExecutionActivityPort
}

type PublicationState = 'open' | 'published' | 'execution_settled' | 'terminal'

/**
 * Starts rich Chat work only after the durable activity executor has entered.
 * Assistant Runtime owns persistence ordering and invokes the executor after
 * both run.created and run.started have been recorded.
 */
export function createAssistantConversationDurableExecutionRuntime(
  dependencies: AssistantConversationDurableExecutionRuntimeDependencies,
) {
  async function start<TStarted>(
    input: AssistantConversationDurableExecutionInput<TStarted>,
  ): Promise<AssistantConversationDurableExecutionOutcome<TStarted>> {
    const runId = input.runId ?? createAssistantRunId(dependencies.ids)
    let publicationState: PublicationState = 'open'
    let publishStarted: (
      outcome: AssistantConversationDurableExecutionOutcome<TStarted>,
    ) => void = () => undefined
    let completion:
      | Promise<Result<AssistantRun, AssistantRuntimeErrorCode>>
      | undefined
    let pendingStarted: { readonly value: TStarted } | undefined

    const startedOutcome = new Promise<
      AssistantConversationDurableExecutionOutcome<TStarted>
    >((resolve) => {
      publishStarted = resolve
    })

    const activityInput: StartAssistantActivityRunInput = {
      runId,
      kind: 'chat',
      conversationId: input.conversationId,
      responseMessageId: input.responseMessageId,
      providerId: input.providerId,
      model: input.model,
      requestEvidence: input.requestEvidence,
      context: input.context,
      ...(input.workspaceWritebackHandoff
        ? { workspaceWritebackHandoff: input.workspaceWritebackHandoff }
        : {}),
      cancellationSignal: input.cancellationSignal,
      onPersisted: input.onPersisted,
      executor: {
        async execute({ run, signal, checkpointStreamEvent, checkpointTextDelta, continueProviderTurns }) {
          const started = (
            value: TStarted,
          ): AssistantConversationDurableExecutionStartedPublication => {
            if (publicationState === 'published') {
              return { kind: 'rejected', reason: 'already_published' }
            }
            if (publicationState === 'execution_settled') {
              return { kind: 'rejected', reason: 'execution_settled' }
            }
            if (publicationState === 'terminal') {
              return { kind: 'rejected', reason: 'terminal' }
            }

            publicationState = 'published'
            if (completion) {
              publishStarted({ kind: 'started', runId, value, completion })
            } else {
              pendingStarted = { value }
            }
            return { kind: 'published' }
          }

          try {
            return await input.execute({
              run,
              signal,
              started,
              checkpointStreamEvent,
              checkpointTextDelta,
              continueProviderTurns,
            })
          } finally {
            if (publicationState === 'open') {
              publicationState = 'execution_settled'
            }
          }
        },
      },
    }

    completion = dependencies.activityRuntime.executeActivity(activityInput)
    if (pendingStarted) {
      publishStarted({
        kind: 'started',
        runId,
        value: pendingStarted.value,
        completion,
      })
      pendingStarted = undefined
    }

    const terminalOutcome = completion.then((result) => {
      publicationState = 'terminal'
      return { kind: 'terminal', result } as const
    })

    return await Promise.race([startedOutcome, terminalOutcome])
  }

  return { start }
}
