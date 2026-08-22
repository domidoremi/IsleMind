export interface AssistantConversationContextAcquisitionProviderLike {
  readonly id: string
}

export interface AssistantConversationContextAcquisitionSettingsLike {
  readonly mcpEnabled?: boolean
}

export type AssistantConversationKnowledgeAcquisitionOutcomeLike<TContext> =
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'ready' | 'skipped' | 'failed'
      readonly context: TContext
    }

export interface AssistantConversationMcpAcquisitionReadyLike<TTool, TTrace> {
  readonly kind: 'disabled' | 'empty' | 'connected' | 'offline'
  readonly prompt: string
  readonly tools: readonly TTool[]
  readonly traces: readonly TTrace[]
}

export interface AssistantConversationMcpAcquisitionFailedLike<TErrorCode> {
  readonly kind: 'failed'
  readonly code: TErrorCode
}

export interface AssistantConversationMcpAcquisitionCancelled {
  readonly kind: 'cancelled'
}

export type AssistantConversationMcpAcquisitionOutcome<
  TTool,
  TTrace,
  TErrorCode,
> =
  | AssistantConversationMcpAcquisitionReadyLike<TTool, TTrace>
  | AssistantConversationMcpAcquisitionFailedLike<TErrorCode>
  | AssistantConversationMcpAcquisitionCancelled

export interface AssistantConversationContextAcquisitionRuntimeDependencies<
  TProvider extends AssistantConversationContextAcquisitionProviderLike,
  TFallbackProviders extends readonly TProvider[],
  TConversation,
  TUserMessage,
  TKnowledgeSettings,
  TKnowledgeContext,
  TSettings extends AssistantConversationContextAcquisitionSettingsLike,
  TSearchMode,
  TWebSources,
  TMcpTool,
  TTrace,
  TErrorCode,
> {
  listFallbackProviders(): Promise<TFallbackProviders>
  getKnowledgeSettings(): TKnowledgeSettings
  resolveKnowledgeContext(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly conversation: TConversation
    readonly userMessage?: TUserMessage
    readonly settings: TKnowledgeSettings
    readonly signal: AbortSignal
  }): Promise<AssistantConversationKnowledgeAcquisitionOutcomeLike<TKnowledgeContext>>
  isReplyCancelled(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly signal: AbortSignal
  }): boolean
  resolveSearchMode(settings: TSettings): TSearchMode
  createEmptyWebSources(): TWebSources
  resolveMcpContext(input: {
    readonly conversation: TConversation
    readonly mcpEnabled: boolean
    readonly signal: AbortSignal
  }): Promise<AssistantConversationMcpAcquisitionOutcome<TMcpTool, TTrace, TErrorCode>>
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
  mcpFailureContent(): string
  projectTerminalFailure(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly content: string
    readonly errorCode: TErrorCode
    readonly providerId: string
  }): void
}

export interface AssistantConversationContextAcquisitionInput<
  TProvider,
  TConversation,
  TUserMessage,
  TWorkspaceContext,
  TSettings,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly provider: TProvider
  readonly runtimeConversation: TConversation
  readonly lastUserMessage?: TUserMessage
  readonly workspaceContext?: TWorkspaceContext
  readonly settings: TSettings
  readonly signal: AbortSignal
}

export type AssistantConversationContextAcquisitionStage =
  | 'knowledge'
  | 'after_knowledge'
  | 'mcp'

export type AssistantConversationContextAcquisitionOutcome<
  TFallbackProviders,
  TKnowledgeContext,
  TWorkspaceContext,
  TSearchMode,
  TWebSources,
  TMcpContext,
> =
  | {
      readonly kind: 'cancelled'
      readonly stage: AssistantConversationContextAcquisitionStage
    }
  | {
      readonly kind: 'failed'
      readonly stage: 'mcp'
      readonly reason: 'mcp_context_failed'
    }
  | {
      readonly kind: 'ready'
      readonly fallbackProviders: TFallbackProviders
      readonly context: TKnowledgeContext
      readonly workspaceContext?: TWorkspaceContext
      readonly searchMode: TSearchMode
      readonly webSources: TWebSources
      readonly mcpContext: TMcpContext
    }

/**
 * Acquires ordinary-conversation context in the observable legacy order while
 * concrete Knowledge, web, MCP, store, and projection effects remain
 * composition-root concerns.
 */
export function createAssistantConversationContextAcquisitionRuntime<
  TProvider extends AssistantConversationContextAcquisitionProviderLike,
  TFallbackProviders extends readonly TProvider[],
  TConversation,
  TUserMessage extends { readonly content?: string },
  TKnowledgeSettings,
  TKnowledgeContext,
  TWorkspaceContext,
  TSettings extends AssistantConversationContextAcquisitionSettingsLike,
  TSearchMode,
  TWebSources,
  TMcpTool,
  TTrace,
  TErrorCode,
>(
  dependencies: AssistantConversationContextAcquisitionRuntimeDependencies<
    TProvider,
    TFallbackProviders,
    TConversation,
    TUserMessage,
    TKnowledgeSettings,
    TKnowledgeContext,
    TSettings,
    TSearchMode,
    TWebSources,
    TMcpTool,
    TTrace,
    TErrorCode
  >,
) {
  async function acquire(
    input: AssistantConversationContextAcquisitionInput<
      TProvider,
      TConversation,
      TUserMessage,
      TWorkspaceContext,
      TSettings
    >,
  ): Promise<AssistantConversationContextAcquisitionOutcome<
    TFallbackProviders,
    TKnowledgeContext,
    TWorkspaceContext,
    TSearchMode,
    TWebSources,
    AssistantConversationMcpAcquisitionReadyLike<TMcpTool, TTrace>
  >> {
    let fallbackProviders: TFallbackProviders
    try {
      fallbackProviders = await dependencies.listFallbackProviders()
    } catch {
      fallbackProviders = [input.provider] as unknown as TFallbackProviders
    }

    const knowledgeOutcome = await dependencies.resolveKnowledgeContext({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      conversation: input.runtimeConversation,
      userMessage: input.lastUserMessage,
      settings: dependencies.getKnowledgeSettings(),
      signal: input.signal,
    })
    if (knowledgeOutcome.kind === 'cancelled') {
      return { kind: 'cancelled', stage: 'knowledge' }
    }
    if (isCancelled(input)) {
      return { kind: 'cancelled', stage: 'after_knowledge' }
    }
    const context = knowledgeOutcome.context

    const searchMode = dependencies.resolveSearchMode(input.settings)
    // External search is model-directed through the admitted search_web tool.
    // Ordinary context acquisition must not perform a hidden pre-search.
    const webSources = dependencies.createEmptyWebSources()
    const mcpOutcome = await dependencies.resolveMcpContext({
      conversation: input.runtimeConversation,
      mcpEnabled: input.settings.mcpEnabled !== false,
      signal: input.signal,
    })
    if (mcpOutcome.kind === 'cancelled') {
      return { kind: 'cancelled', stage: 'mcp' }
    }
    if (isCancelled(input)) {
      return { kind: 'cancelled', stage: 'mcp' }
    }
    if (mcpOutcome.kind === 'failed') {
      dependencies.projectTerminalFailure({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        content: dependencies.mcpFailureContent(),
        errorCode: mcpOutcome.code,
        providerId: input.provider.id,
      })
      return {
        kind: 'failed',
        stage: 'mcp',
        reason: 'mcp_context_failed',
      }
    }
    for (const trace of mcpOutcome.traces) {
      dependencies.recordTrace({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        trace,
      })
    }

    return {
      kind: 'ready',
      fallbackProviders,
      context,
      workspaceContext: input.workspaceContext,
      searchMode,
      webSources,
      mcpContext: mcpOutcome,
    }

    function isCancelled(
      cancellationInput: AssistantConversationContextAcquisitionInput<
        TProvider,
        TConversation,
        TUserMessage,
        TWorkspaceContext,
        TSettings
      >,
    ): boolean {
      return cancellationInput.signal.aborted || dependencies.isReplyCancelled({
        conversationId: cancellationInput.conversationId,
        assistantMessageId: cancellationInput.assistantMessageId,
        signal: cancellationInput.signal,
      })
    }
  }

  return { acquire }
}
