export interface ConversationMemoryExtractionInput<
  TMessage,
  TProvider,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly messages: readonly TMessage[]
  readonly provider: TProvider
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

export interface ConversationMemoryExtractor<TMessage, TProvider> {
  extract(
    conversationId: string,
    messages: readonly TMessage[],
    provider: TProvider,
    model: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]>
}

export interface ConversationMemoryExtractionRuntimeDependencies<TMessage, TProvider> {
  readonly extractor: ConversationMemoryExtractor<TMessage, TProvider>
  readonly projectTransition: (projection: ConversationMemoryExtractionProjection) => void
  readonly nonErrorFailureMessage: string
}

export function createConversationMemoryExtractionRuntime<
  TMessage,
  TProvider,
>(dependencies: ConversationMemoryExtractionRuntimeDependencies<TMessage, TProvider>) {
  function project(
    input: ConversationMemoryExtractionInput<TMessage, TProvider>,
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
      input: ConversationMemoryExtractionInput<TMessage, TProvider>,
    ): Promise<ConversationMemoryExtractionTerminalTransition> {
      if (!input.memoryEnabled) {
        const transition: ConversationMemoryExtractionSkippedTransition = {
          status: 'skipped',
          reason: 'memory_disabled',
        }
        project(input, transition)
        return transition
      }

      project(input, { status: 'running' })
      try {
        const added = await dependencies.extractor.extract(
          input.conversationId,
          input.messages,
          input.provider,
          input.model,
          input.signal,
        )
        const transition: ConversationMemoryExtractionCompletedTransition = {
          status: 'completed',
          addedCount: added.length,
          items: added.slice(0, 3),
        }
        project(input, transition)
        return transition
      } catch (error) {
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
    },
  }
}
