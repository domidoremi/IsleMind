import { snapshotPlainData } from '@/core'

export interface AssistantConversationProviderToolAdmissionProviderLike {
  readonly id: string
  readonly wireProtocol?: string
}

export interface AssistantConversationProviderToolAdmissionModelLike {
  readonly preferredEndpoint?: string
}

export interface AssistantConversationProviderToolAdmissionSettingsLike {
  readonly mcpEnabled?: boolean
  readonly runtimeLogEnabled?: boolean
  readonly runtimeLogMaxBytes?: number
}

export interface AssistantConversationProviderToolSupportLike {
  readonly supported: boolean
  readonly reason?: string
}

export interface AssistantConversationProviderToolMcpContextLike<TMcpTool> {
  readonly prompt: string
  readonly tools: readonly TMcpTool[]
}

export interface AssistantConversationProviderToolAdmissionInput<
  TProvider,
  TModel,
  TSettings,
  TMcpContext,
> {
  readonly conversationId: string
  readonly assistantMessageId: string
  readonly provider: TProvider
  readonly modelConfig: TModel
  readonly upstreamModel: string
  readonly requestedModel: string
  readonly settings: TSettings
  readonly mcpContext: TMcpContext
  readonly signal?: AbortSignal
}

export interface AssistantConversationProviderToolAdmissionRuntimeDependencies<
  TProvider extends AssistantConversationProviderToolAdmissionProviderLike,
  TModel extends AssistantConversationProviderToolAdmissionModelLike,
  TSettings extends AssistantConversationProviderToolAdmissionSettingsLike,
  TMcpTool,
  TMcpContext extends AssistantConversationProviderToolMcpContextLike<TMcpTool>,
  TSupport extends AssistantConversationProviderToolSupportLike,
  TProviderToolContext extends object,
  TGatewayOutcome,
  TTrace,
> {
  resolveSupport(provider: TProvider, modelConfig: TModel): TSupport
  admitProviderTools(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly provider: TProvider
    readonly modelPreferredEndpoint?: TModel['preferredEndpoint']
    readonly settings: TSettings
    readonly nativeToolSupported: boolean
    readonly wireProtocol?: TProvider['wireProtocol']
    readonly signal?: AbortSignal
  }): Promise<TProviderToolContext | undefined>
  buildManifestTrace(context: TProviderToolContext): TTrace
  buildSkippedTrace(support: TSupport): TTrace
  appendUnclaimedCompatibilityLog(input: {
    readonly conversationId: string
    readonly provider: TProvider
    readonly model: string
    readonly requestedModel: string
    readonly settings: TSettings
    readonly support: TSupport
  }): Promise<unknown>
  emitGatewayOutcome(input: {
    readonly conversationId: string
    readonly provider: TProvider
    readonly model: string
    readonly mcpEnabled: boolean
    readonly mcpPrompt: TMcpContext['prompt']
    readonly mcpToolCount: number
    readonly nativeToolSupport: TSupport
    readonly providerToolContext?: TProviderToolContext
    readonly runtimeLog: {
      readonly enabled?: boolean
      readonly maxBytes?: number
    }
  }): TGatewayOutcome
  buildGatewayTrace(outcome: TGatewayOutcome): TTrace
  recordTrace(input: {
    readonly conversationId: string
    readonly assistantMessageId: string
    readonly trace: TTrace
  }): void
}

export interface AssistantConversationProviderToolAdmissionOutcome<
  TSupport,
  TProviderToolContext extends object,
  TGatewayOutcome,
> {
  readonly kind: 'ready'
  readonly support: TSupport
  readonly providerToolContext?: TProviderToolContext
  readonly gatewayOutcome: TGatewayOutcome
}

export interface AssistantConversationProviderToolAdmissionCancelled {
  readonly kind: 'cancelled'
}

/**
 * Owns ordinary-conversation provider-tool admission and gateway projection.
 * Concrete capability, declaration, diagnostic, and trace effects remain
 * composition-root concerns.
 */
export function createAssistantConversationProviderToolAdmissionRuntime<
  TProvider extends AssistantConversationProviderToolAdmissionProviderLike,
  TModel extends AssistantConversationProviderToolAdmissionModelLike,
  TSettings extends AssistantConversationProviderToolAdmissionSettingsLike,
  TMcpTool,
  TMcpContext extends AssistantConversationProviderToolMcpContextLike<TMcpTool>,
  TSupport extends AssistantConversationProviderToolSupportLike,
  TProviderToolContext extends object,
  TGatewayOutcome,
  TTrace,
>(
  dependencies: AssistantConversationProviderToolAdmissionRuntimeDependencies<
    TProvider,
    TModel,
    TSettings,
    TMcpTool,
    TMcpContext,
    TSupport,
    TProviderToolContext,
    TGatewayOutcome,
    TTrace
  >,
) {
  async function admit(
    input: AssistantConversationProviderToolAdmissionInput<
      TProvider,
      TModel,
      TSettings,
      TMcpContext
    >,
  ): Promise<AssistantConversationProviderToolAdmissionOutcome<
    TSupport,
    TProviderToolContext,
    TGatewayOutcome
  > | AssistantConversationProviderToolAdmissionCancelled> {
    if (input.signal?.aborted) return { kind: 'cancelled' }
    input = { ...input, provider: snapshotPlainData(input.provider), modelConfig: snapshotPlainData(input.modelConfig),
      settings: snapshotPlainData(input.settings), mcpContext: snapshotPlainData(input.mcpContext) }
    const support = snapshotPlainData(dependencies.resolveSupport(
      input.provider,
      input.modelConfig,
    ))
    if (input.signal?.aborted) return { kind: 'cancelled' }
    let admitted: TProviderToolContext | undefined
    try {
      admitted = await dependencies.admitProviderTools({
        conversationId: input.conversationId,
        assistantMessageId: input.assistantMessageId,
        provider: input.provider,
        modelPreferredEndpoint: input.modelConfig.preferredEndpoint,
        settings: input.settings,
        nativeToolSupported: support.supported,
        wireProtocol: input.provider.wireProtocol,
        ...(input.signal ? { signal: input.signal } : {}),
      })
    } catch (error) {
      if (input.signal?.aborted) return { kind: 'cancelled' }
      throw error
    }
    if (input.signal?.aborted) return { kind: 'cancelled' }
    const providerToolContext = snapshotPlainData(admitted)

    if (providerToolContext !== undefined) {
      record(input, dependencies.buildManifestTrace(providerToolContext))
    } else if (support.reason === 'blocked_contract_tools_unclaimed') {
      record(input, dependencies.buildSkippedTrace(support))
      if (!input.signal?.aborted) void dependencies.appendUnclaimedCompatibilityLog({
        conversationId: input.conversationId,
        provider: input.provider,
        model: input.upstreamModel,
        requestedModel: input.requestedModel,
        settings: input.settings,
        support,
      })
    }

    if (input.signal?.aborted) return { kind: 'cancelled' }
    const gatewayOutcome = snapshotPlainData(dependencies.emitGatewayOutcome({
      conversationId: input.conversationId,
      provider: input.provider,
      model: input.upstreamModel,
      mcpEnabled: input.settings.mcpEnabled !== false,
      mcpPrompt: input.mcpContext.prompt,
      mcpToolCount: input.mcpContext.tools.length,
      nativeToolSupport: support,
      providerToolContext,
      runtimeLog: {
        enabled: input.settings.runtimeLogEnabled,
        maxBytes: input.settings.runtimeLogMaxBytes,
      },
    }))
    if (input.signal?.aborted) return { kind: 'cancelled' }
    record(input, dependencies.buildGatewayTrace(gatewayOutcome))

    if (input.signal?.aborted) return { kind: 'cancelled' }
    return snapshotPlainData({
      kind: 'ready',
      support,
      providerToolContext,
      gatewayOutcome,
    })
  }

  function record(
    input: { readonly conversationId: string; readonly assistantMessageId: string; readonly signal?: AbortSignal },
    trace: TTrace,
  ): void {
    if (input.signal?.aborted) return
    dependencies.recordTrace({
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      trace,
    })
  }

  return { admit }
}
