export interface AssistantConversationKnowledgeSourceLike {
  readonly type: string
  readonly title: string
  readonly content: string
  readonly excerpt?: string
}

export interface AssistantConversationKnowledgeRagTraceLike {
  readonly id: string
  readonly stage: string
  readonly title: string
  readonly content?: string
  readonly status: AssistantConversationKnowledgeTraceStatus
  readonly startedAt: number
  readonly completedAt?: number
  readonly durationMs?: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface AssistantConversationKnowledgeContextLike<
  TSource extends AssistantConversationKnowledgeSourceLike = AssistantConversationKnowledgeSourceLike,
  TRagTrace extends AssistantConversationKnowledgeRagTraceLike = AssistantConversationKnowledgeRagTraceLike,
  TPlan = unknown,
  TQuality = unknown,
> {
  readonly sources: readonly TSource[]
  readonly prompt: string
  readonly plan?: TPlan
  readonly trace?: readonly TRagTrace[]
  readonly quality?: TQuality
}

export interface AssistantConversationKnowledgeSettingsEvidence {
  readonly memoryEnabled?: boolean
  readonly knowledgeEnabled?: boolean
  readonly ragMode?: unknown
}

export type AssistantConversationKnowledgeTraceType = 'retrieval' | 'memory' | 'knowledge'
export type AssistantConversationKnowledgeTraceStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'
  | 'cancelled'

export interface AssistantConversationKnowledgeTraceInput {
  readonly id: string
  readonly type: AssistantConversationKnowledgeTraceType
  readonly title: string
  readonly content?: string
  readonly status: AssistantConversationKnowledgeTraceStatus
  readonly startedAt: number
  readonly completedAt?: number
  readonly durationMs?: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type AssistantConversationKnowledgeTextKey =
  | 'chatRunner.trace.contextTitle'
  | 'chatRunner.trace.contextHits'
  | 'chatRunner.trace.contextNoHits'
  | 'chatRunner.trace.memoryHitTitle'
  | 'chatRunner.trace.knowledgeHitTitle'
  | 'chatRunner.trace.contextFailed'
  | 'chatRunner.trace.contextNoUserMessage'

export interface AssistantConversationKnowledgeContextRuntimeDependencies<
  TConversation,
  TUserMessage,
  TContext extends AssistantConversationKnowledgeContextLike,
  TTrace,
> {
  retrieve(
    conversation: TConversation,
    userMessage: TUserMessage,
    signal: AbortSignal,
  ): Promise<TContext>
  createEmptyContext(): TContext
  isCancellation(error: unknown, signal: AbortSignal): boolean
  now(): number
  traceId(prefix: string): string
  buildTrace(input: AssistantConversationKnowledgeTraceInput): TTrace
  completeTrace(trace: TTrace): TTrace
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
  translate(
    key: AssistantConversationKnowledgeTextKey,
    parameters?: Readonly<Record<string, unknown>>,
  ): string
}

export interface AssistantConversationKnowledgeContextRuntimeInput<
  TConversation,
  TUserMessage,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly conversation: TConversation
  readonly userMessage?: TUserMessage
  readonly settings: AssistantConversationKnowledgeSettingsEvidence
  readonly signal: AbortSignal
}

export interface AssistantConversationKnowledgeContextCounts {
  readonly memoryCount: number
  readonly knowledgeCount: number
  readonly sourceCount: number
}

export interface AssistantConversationKnowledgeContextReady<TContext> {
  readonly kind: 'ready'
  readonly context: TContext
  readonly counts: AssistantConversationKnowledgeContextCounts
}

export interface AssistantConversationKnowledgeContextSkipped<TContext> {
  readonly kind: 'skipped'
  readonly reason: 'no_user_message'
  readonly context: TContext
}

export interface AssistantConversationKnowledgeContextFailed<TContext> {
  readonly kind: 'failed'
  readonly reason: 'retrieval_failed'
  readonly context: TContext
}

export interface AssistantConversationKnowledgeContextCancelled {
  readonly kind: 'cancelled'
}

export type AssistantConversationKnowledgeContextOutcome<TContext> =
  | AssistantConversationKnowledgeContextReady<TContext>
  | AssistantConversationKnowledgeContextSkipped<TContext>
  | AssistantConversationKnowledgeContextFailed<TContext>
  | AssistantConversationKnowledgeContextCancelled

/**
 * Owns the initial ordinary-conversation knowledge retrieval lifecycle while
 * concrete retrieval, localization, and trace projection remain composed at bootstrap.
 */
export function createAssistantConversationKnowledgeContextRuntime<
  TConversation,
  TUserMessage,
  TContext extends AssistantConversationKnowledgeContextLike,
  TTrace,
>(
  dependencies: AssistantConversationKnowledgeContextRuntimeDependencies<
    TConversation,
    TUserMessage,
    TContext,
    TTrace
  >,
) {
  async function resolveContext(
    input: AssistantConversationKnowledgeContextRuntimeInput<TConversation, TUserMessage>,
  ): Promise<AssistantConversationKnowledgeContextOutcome<TContext>> {
    if (input.signal.aborted) return { kind: 'cancelled' }

    const contextTraceId = dependencies.traceId('context')
    const startedAt = dependencies.now()
    record(dependencies.buildTrace({
      id: contextTraceId,
      type: 'retrieval',
      title: dependencies.translate('chatRunner.trace.contextTitle'),
      status: 'running',
      startedAt,
      metadata: {
        memoryEnabled: input.settings.memoryEnabled,
        knowledgeEnabled: input.settings.knowledgeEnabled,
        ragMode: input.settings.ragMode,
      },
    }))

    if (input.signal.aborted) return { kind: 'cancelled' }

    if (input.userMessage === undefined) {
      recordCompleted({
        id: contextTraceId,
        type: 'retrieval',
        title: dependencies.translate('chatRunner.trace.contextTitle'),
        content: dependencies.translate('chatRunner.trace.contextNoUserMessage'),
        status: 'skipped',
        startedAt,
      })
      return {
        kind: 'skipped',
        reason: 'no_user_message',
        context: dependencies.createEmptyContext(),
      }
    }

    let context: TContext
    try {
      context = await dependencies.retrieve(
        input.conversation,
        input.userMessage,
        input.signal,
      )
    } catch (error) {
      if (input.signal.aborted || dependencies.isCancellation(error, input.signal)) {
        return { kind: 'cancelled' }
      }

      recordCompleted({
        id: contextTraceId,
        type: 'retrieval',
        title: dependencies.translate('chatRunner.trace.contextTitle'),
        content: error instanceof Error
          ? error.message
          : dependencies.translate('chatRunner.trace.contextFailed'),
        status: 'error',
        startedAt,
      })
      return {
        kind: 'failed',
        reason: 'retrieval_failed',
        context: dependencies.createEmptyContext(),
      }
    }

    if (input.signal.aborted) return { kind: 'cancelled' }

    const memorySources = context.sources.filter((source) => source.type === 'memory')
    const knowledgeSources = context.sources.filter((source) => source.type === 'knowledge')
    const counts: AssistantConversationKnowledgeContextCounts = {
      memoryCount: memorySources.length,
      knowledgeCount: knowledgeSources.length,
      sourceCount: context.sources.length,
    }

    recordCompleted({
      id: contextTraceId,
      type: 'retrieval',
      title: dependencies.translate('chatRunner.trace.contextTitle'),
      content: counts.sourceCount
        ? dependencies.translate('chatRunner.trace.contextHits', {
            total: counts.sourceCount,
            memories: counts.memoryCount,
            knowledge: counts.knowledgeCount,
          })
        : dependencies.translate('chatRunner.trace.contextNoHits'),
      status: 'done',
      startedAt,
      metadata: {
        memoryCount: counts.memoryCount,
        knowledgeCount: counts.knowledgeCount,
        sourceCount: counts.sourceCount,
        ragPlan: context.plan,
        ragQuality: context.quality,
      },
    })

    for (const ragTrace of context.trace ?? []) {
      recordCompleted({
        id: ragTrace.id,
        type: 'retrieval',
        title: ragTrace.title,
        content: ragTrace.content,
        status: ragTrace.status,
        startedAt: ragTrace.startedAt,
        completedAt: ragTrace.completedAt,
        durationMs: ragTrace.durationMs,
        metadata: {
          stage: ragTrace.stage,
          ...(ragTrace.metadata ?? {}),
        },
      })
    }

    if (counts.memoryCount) {
      recordCompleted({
        id: dependencies.traceId('memory'),
        type: 'memory',
        title: dependencies.translate('chatRunner.trace.memoryHitTitle'),
        content: memorySources
          .map((source) => source.title || source.excerpt || source.content.slice(0, 80))
          .join('\n'),
        status: 'done',
        startedAt,
        metadata: { count: counts.memoryCount },
      })
    }

    if (counts.knowledgeCount) {
      recordCompleted({
        id: dependencies.traceId('knowledge'),
        type: 'knowledge',
        title: dependencies.translate('chatRunner.trace.knowledgeHitTitle'),
        content: knowledgeSources.map((source) => source.title).join('\n'),
        status: 'done',
        startedAt,
        metadata: { count: counts.knowledgeCount },
      })
    }

    return { kind: 'ready', context, counts }

    function record(trace: TTrace): void {
      dependencies.recordTrace({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        trace,
      })
    }

    function recordCompleted(trace: AssistantConversationKnowledgeTraceInput): void {
      record(dependencies.completeTrace(dependencies.buildTrace(trace)))
    }
  }

  return { resolveContext }
}
