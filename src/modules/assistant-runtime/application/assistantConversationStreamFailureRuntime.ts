export interface AssistantConversationStreamFailureMessageLike {
  readonly content?: string
  readonly startedAt?: number
}

export interface AssistantConversationStreamFailureErrorLike<TErrorCode>
  extends Error {
  readonly chatErrorCode?: TErrorCode
}

export interface AssistantConversationStreamFailureTrace<TErrorCode> {
  readonly id: string
  readonly type: 'system'
  readonly title: string
  readonly content: string
  readonly status: 'error'
  readonly startedAt: number
  readonly completedAt: number
  readonly durationMs?: number
  readonly metadata?: {
    readonly errorCode: TErrorCode
  }
}

export interface AssistantConversationStreamFailureRuntimeDependencies<
  TMessage extends AssistantConversationStreamFailureMessageLike,
  TErrorCode,
> {
  getMessage(
    conversationId: string,
    assistantMessageId: string,
  ): TMessage | null | undefined
  now(): number
  generateTraceId(prefix: 'finalize-error'): string
  modelRequestTitle(): string
  fallbackFailureMessage(): string
  classifyError(message: string): TErrorCode
  toUserFacingError(message: string, errorCode: TErrorCode): string
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: AssistantConversationStreamFailureTrace<TErrorCode>
  }): void
  projectTerminalFailure(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly content: string
    readonly errorCode: TErrorCode
    readonly providerId?: string
  }): void
}

export interface AssistantConversationStreamFailureInput {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly error: unknown
  readonly providerId?: string
}

export interface AssistantConversationStreamStartFailureInput
  extends AssistantConversationStreamFailureInput {
  readonly modelTraceId: string
}

export interface AssistantConversationStreamFailureOutcome<TErrorCode> {
  readonly kind: 'projected_failure'
  readonly source: 'stream_start' | 'completion'
  readonly message: string
  readonly errorCode: TErrorCode
}

/**
 * Projects provider-start and asynchronous finalization rejections into the
 * same terminal trace/message contract. Stream cleanup remains owned by the
 * provider streaming runtime and concrete stores remain bootstrap concerns.
 */
export function createAssistantConversationStreamFailureRuntime<
  TMessage extends AssistantConversationStreamFailureMessageLike,
  TErrorCode,
>(
  dependencies: AssistantConversationStreamFailureRuntimeDependencies<
    TMessage,
    TErrorCode
  >,
) {
  function projectStartFailure(
    input: AssistantConversationStreamStartFailureInput,
  ): AssistantConversationStreamFailureOutcome<TErrorCode> {
    const message = failureMessage(input.error)
    const errorCode = failureCode(input.error, message)
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: completedTrace({
        id: input.modelTraceId,
        resolveContent: () => dependencies.toUserFacingError(message, errorCode),
        resolveStartedAt: () => dependencies.getMessage(
          input.conversationId,
          input.assistantMessageId,
        )?.startedAt,
      }),
    })
    dependencies.projectTerminalFailure({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      content: dependencies.toUserFacingError(message, errorCode),
      errorCode,
      providerId: input.providerId,
    })
    return {
      kind: 'projected_failure',
      source: 'stream_start',
      message,
      errorCode,
    }
  }

  function projectCompletionFailure(
    input: AssistantConversationStreamFailureInput,
  ): AssistantConversationStreamFailureOutcome<TErrorCode> {
    const message = failureMessage(input.error)
    const current = dependencies.getMessage(
      input.conversationId,
      input.assistantMessageId,
    )
    const errorCode = failureCode(input.error, message)
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace: completedTrace({
        id: dependencies.generateTraceId('finalize-error'),
        resolveContent: () => dependencies.toUserFacingError(message, errorCode),
        resolveStartedAt: () => current?.startedAt,
        includeErrorCode: true,
        errorCode,
      }),
    })
    dependencies.projectTerminalFailure({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      content: current?.content?.trim()
        || dependencies.toUserFacingError(message, errorCode),
      errorCode,
      providerId: input.providerId,
    })
    return {
      kind: 'projected_failure',
      source: 'completion',
      message,
      errorCode,
    }
  }

  function completedTrace(input: {
    readonly id: string
    readonly resolveContent: () => string
    readonly resolveStartedAt: () => number | undefined
  } & (
    | {
        readonly includeErrorCode: true
        readonly errorCode: TErrorCode
      }
    | {
        readonly includeErrorCode?: false
        readonly errorCode?: never
      }
  )): AssistantConversationStreamFailureTrace<TErrorCode> {
    const title = dependencies.modelRequestTitle()
    const content = input.resolveContent()
    const startedAt = input.resolveStartedAt() ?? dependencies.now()
    const completedAt = dependencies.now()
    return {
      id: input.id,
      type: 'system',
      title,
      content,
      status: 'error',
      startedAt,
      completedAt,
      durationMs: startedAt ? completedAt - startedAt : undefined,
      ...(input.includeErrorCode
        ? { metadata: { errorCode: input.errorCode } }
        : {}),
    }
  }

  function failureMessage(error: unknown): string {
    return error instanceof Error
      ? error.message
      : dependencies.fallbackFailureMessage()
  }

  function failureCode(error: unknown, message: string): TErrorCode {
    const runtimeCode = error instanceof Error
      ? (error as AssistantConversationStreamFailureErrorLike<TErrorCode>)
          .chatErrorCode
      : undefined
    return runtimeCode ?? dependencies.classifyError(message)
  }

  return { projectStartFailure, projectCompletionFailure }
}
