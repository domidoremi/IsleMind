import { snapshotPlainData } from '@/core'

export interface ConversationMemoryExtractionInput<
  TMessage,
  TProvider,
  TSettings = unknown,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly messages: readonly TMessage[]
  readonly provider: TProvider
  readonly settings?: TSettings
  readonly model: string
  readonly memoryEnabled: boolean
  readonly signal?: AbortSignal
}

export type ConversationMemoryExtractionSkipReason =
  | 'memory_disabled'

export interface ConversationMemoryExtractionSkippedTransition {
  readonly status: 'skipped'
  readonly reason: ConversationMemoryExtractionSkipReason
}

export interface ConversationMemoryExtractionRunningTransition {
  readonly status: 'running'
}

export interface ConversationMemoryExtractionCompletedTransition {
  readonly status: 'completed'
  readonly addedCount: number
  readonly items: readonly string[]
}

export interface ConversationMemoryExtractionCancelledTransition {
  readonly status: 'cancelled'
  readonly message: string
}

export interface ConversationMemoryExtractionFailedTransition {
  readonly status: 'failed'
  readonly message: string
}

export type ConversationMemoryExtractionTransition =
  | ConversationMemoryExtractionSkippedTransition
  | ConversationMemoryExtractionRunningTransition
  | ConversationMemoryExtractionCompletedTransition
  | ConversationMemoryExtractionCancelledTransition
  | ConversationMemoryExtractionFailedTransition

export type ConversationMemoryExtractionTerminalTransition = Exclude<
  ConversationMemoryExtractionTransition,
  ConversationMemoryExtractionRunningTransition
>

export interface ConversationMemoryExtractionProjection {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly transition: ConversationMemoryExtractionTransition
}

export interface ConversationMemoryExtractor<TMessage, TProvider, TSettings = unknown> {
  extract(
    conversationId: string,
    messages: readonly TMessage[],
    provider: TProvider,
    model: string,
    signal?: AbortSignal,
    configuration?: { readonly settings?: TSettings },
  ): Promise<readonly string[]>
}

export interface ConversationMemoryExtractionRuntimeDependencies<TMessage, TProvider, TSettings = unknown> {
  readonly extractor: ConversationMemoryExtractor<TMessage, TProvider, TSettings>
  readonly projectTransition: (projection: ConversationMemoryExtractionProjection) => void
  readonly nonErrorFailureMessage: string
  readonly cancellationMessage?: string
}

export function createConversationMemoryExtractionRuntime<
  TMessage,
  TProvider,
  TSettings = unknown,
>(dependencies: ConversationMemoryExtractionRuntimeDependencies<TMessage, TProvider, TSettings>) {
  function project(
    input: ConversationMemoryExtractionInput<TMessage, TProvider, TSettings>,
    transition: ConversationMemoryExtractionTransition,
  ): void {
    try {
      dependencies.projectTransition({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        transition,
      })
    } catch {
      // Projection is an observational side effect; extraction lifecycle results
      // remain authoritative when a view writer is unavailable or rejects.
    }
  }

  return {
    async run(
      input: ConversationMemoryExtractionInput<TMessage, TProvider, TSettings>,
    ): Promise<ConversationMemoryExtractionTerminalTransition> {
      input = {
        ...input,
        messages: snapshotPlainData(input.messages),
        provider: snapshotPlainData(input.provider),
        settings: snapshotPlainData(input.settings),
      }
      if (input.signal?.aborted) return cancelled()
      if (!input.memoryEnabled) {
        const transition: ConversationMemoryExtractionSkippedTransition = {
          status: 'skipped',
          reason: 'memory_disabled',
        }
        project(input, transition)
        return transition
      }

      project(input, { status: 'running' })
      if (input.signal?.aborted) return cancelled()
      try {
        const added = await dependencies.extractor.extract(
          input.conversationId,
          input.messages,
          input.provider,
          input.model,
          input.signal,
          ...(input.settings === undefined ? [] : [{ settings: input.settings }]),
        )
        if (input.signal?.aborted) return cancelled()
        const transition: ConversationMemoryExtractionCompletedTransition = {
          status: 'completed',
          addedCount: added.length,
          items: added.slice(0, 3),
        }
        project(input, transition)
        return transition
      } catch (error) {
        if (input.signal?.aborted) return cancelled()
        const message = error instanceof Error
          ? error.message
          : dependencies.nonErrorFailureMessage
        const transition: ConversationMemoryExtractionCancelledTransition | ConversationMemoryExtractionFailedTransition =
          error instanceof Error && error.name === 'AbortError'
            ? { status: 'cancelled', message }
            : { status: 'failed', message }
        project(input, transition)
        return transition
      }

      function cancelled(): ConversationMemoryExtractionCancelledTransition {
        const transition: ConversationMemoryExtractionCancelledTransition = {
          status: 'cancelled',
          message: dependencies.cancellationMessage
            ?? 'Memory extraction was cancelled; already-admitted changes may remain.',
        }
        project(input, transition)
        return transition
      }
    },
  }
}
