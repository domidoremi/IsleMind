/**
 * Provider-native tool turns are deliberately composed here instead of in the
 * legacy chat runner.  Every side effect is supplied by the composition root;
 * this file only coordinates admission, one task observation, and synthesis.
 */

export interface ProviderToolCallLike {
  name: string
  arguments: Record<string, unknown>
  id?: string
  callId?: string
  index?: number
  rawArguments?: unknown
  argumentsComplete?: boolean
}

export interface ProviderToolLimits {
  maxToolCallsPerStep: number
  outputCharLimit?: number
  allowReadOnlyTools?: boolean
  allowReadWriteTools?: boolean | 'visible'
  allowDestructiveTools?: boolean | 'confirm'
}

export interface ProviderToolRuntimeContext<TManifest = unknown, TTool = unknown, TAdapter = unknown> {
  adapter: TAdapter & { toolNameMap: readonly TTool[]; target?: string; tools?: readonly unknown[] }
  manifests: readonly TManifest[]
  catalogRevision: string
  limits: ProviderToolLimits
}

export interface ProviderToolObservation {
  ok: boolean
  status: string
  output?: string
  blocks: readonly unknown[]
  errorCode?: string
  diagnostic: {
    id: string
    type: string
    title: string
    content?: string
    status: string
    startedAt?: number
    completedAt?: number
    metadata?: Record<string, unknown>
  }
  metadata?: Record<string, unknown>
}

export interface ProviderToolConversationLike {
  id: string
  model: string
  reasoningEffort?: unknown
}

export interface ProviderToolTurnRuntimeDependencies<TProvider = unknown, TManifest = unknown, TTool = unknown, TUsage = unknown> {
  resolveDeclarationTarget(provider: TProvider, input: { preferredEndpoint?: string; assumeOpenAICompatibleTools: boolean; wireProtocol?: string }): string | undefined
  resolveLimits(settings: unknown): ProviderToolLimits
  listManifests(): Promise<readonly TManifest[]>
  filterManifests(manifests: readonly TManifest[], settings: unknown): readonly TManifest[]
  resolveCatalogRevision(manifests: readonly TManifest[]): string
  digestArguments(argumentsValue: Record<string, unknown>): string
  buildDeclarations(input: { manifests: readonly TManifest[]; target: string; permissionCeiling: 'read-only' | 'read-write' | 'destructive'; maxTools: number }): {
    tools: readonly unknown[]
    skipped: readonly unknown[]
    toolNameMap: readonly TTool[]
    target: string
  }
  resolveTool(map: readonly TTool[], providerName: string): TTool | undefined
  manifestValue<T = unknown>(manifest: TTool, key: string): T
  safeText(value: unknown, fallback?: string, limit?: number): string
  formatBlocks(blocks: readonly unknown[]): string
  sanitizeAnswer(value: string): string
  stripCallBlocks(value: string): string
  isInternalOutput(value: unknown): boolean
  synthesisFailureMessage(): string
  nativeSearchNoSourcesText(): string
  isNativeSearchPlaceholder(input: { result: ProviderToolObservation; tool: TTool; toolOutput: string }): boolean
  buildTraceMetadata(input: Record<string, unknown>): Record<string, unknown>
  projectObservationMetadata(observation: ProviderToolObservation): Record<string, unknown>
  recordTrace(trace: Record<string, unknown>): void
  traceId(prefix: string): string
  now(): number
  executeTask(input: {
    stepId: string
    request: Record<string, unknown>
    options: Record<string, unknown>
  }): Promise<{ observation: ProviderToolObservation }>
  createRagRuntime(input: Record<string, unknown>): unknown
  buildRuntimeLogOptions(settings: unknown): unknown
  buildRevisionMessages(input: Record<string, unknown>, assistantContent: string): readonly unknown[]
  buildContextPrompt(input: { baseContextPrompt: string }): string
  resolveGenerationParameters(input: Record<string, unknown>): { temperature?: number; topP?: number; topK?: number; maxTokens?: number }
  synthesize(input: Record<string, unknown>): Promise<{ text: string; usage?: TUsage }>
}

export interface ProviderToolAdmissionInput<TProvider> {
  provider: TProvider
  modelPreferredEndpoint?: string
  settings: unknown
  nativeToolSupported: boolean
  wireProtocol?: string
}

export interface ProviderToolTurnInput<TProvider, TManifest = unknown, TTool = unknown> {
  conversationId: string
  assistantMessageId: string
  provider: TProvider
  conversation: ProviderToolConversationLike
  systemPrompt: string
  messages: readonly unknown[]
  baseContextPrompt: string
  firstOutput: string
  firstReasoningContent?: string
  firstResponseItems?: readonly unknown[]
  firstProviderContentBlocks?: readonly unknown[]
  providerTools?: ProviderToolRuntimeContext<TManifest, TTool, any>
  calls: readonly ProviderToolCallLike[]
  context: unknown
  settings: unknown
  signal: AbortSignal
}

export function createAssistantProviderToolTurnRuntime<TProvider = unknown, TManifest = unknown, TTool = unknown, TUsage = unknown>(
  dependencies: ProviderToolTurnRuntimeDependencies<TProvider, TManifest, TTool, TUsage>,
) {
  async function admit(input: ProviderToolAdmissionInput<TProvider>): Promise<ProviderToolRuntimeContext<TManifest, TTool, ReturnType<typeof dependencies.buildDeclarations>> | undefined> {
    if (!input.nativeToolSupported) return undefined
    const target = dependencies.resolveDeclarationTarget(input.provider, {
      preferredEndpoint: input.modelPreferredEndpoint,
      assumeOpenAICompatibleTools: true,
      wireProtocol: input.wireProtocol,
    })
    if (!target) return undefined
    const limits = dependencies.resolveLimits(input.settings)
    if (limits.allowReadOnlyTools === false) return undefined
    const manifests = Object.freeze([
      ...dependencies.filterManifests(await dependencies.listManifests(), input.settings),
    ])
    if (manifests.length > 64) {
      throw new Error(`Model operation catalog contains ${manifests.length} operations; the limit is 64.`)
    }
    const permissionCeiling = resolvePermissionCeiling(limits)
    if (!permissionCeiling) return undefined
    const adapter = dependencies.buildDeclarations({ manifests, target, permissionCeiling, maxTools: 64 })
    if (!adapter.tools.length) return undefined
    return {
      adapter: { ...adapter, toolNameMap: adapter.toolNameMap },
      manifests,
      catalogRevision: dependencies.resolveCatalogRevision(manifests),
      limits: { ...limits, maxToolCallsPerStep: 1 },
    }
  }

  async function execute(input: ProviderToolTurnInput<TProvider, TManifest, TTool>): Promise<{ text: string; usage?: TUsage } | null> {
    const calls = input.calls.filter((call) => call.name.trim())
    if (!calls.length) return null
    const call = calls[0]
    const toolCallIndex = 0
    const maxToolCallsPerStep = input.providerTools?.limits.maxToolCallsPerStep ?? 1
    const safeCallName = dependencies.safeText(call.name, 'tool', 160)
    if (input.signal.aborted) return null
    if (calls.length > 1) {
      const text = dependencies.safeText(
        `Provider requested ${calls.length} tool calls in one model turn; IsleMind executed none because this runtime permits one operation per turn.`,
        'The provider requested too many tool calls; none were executed.',
        input.providerTools?.limits.outputCharLimit ?? 4800,
      )
      dependencies.recordTrace({ id: dependencies.traceId('provider-tool-limit'), type: 'tool', title: 'Provider native tool limit', content: text, status: 'skipped', startedAt: dependencies.now(), metadata: dependencies.buildTraceMetadata({ call, provider: input.provider, status: 'skipped', errorCode: 'step_limit_reached', target: input.providerTools?.adapter.target, stepIndex: 0, toolCallIndex: maxToolCallsPerStep, requestedToolCallCount: calls.length, maxToolCallsPerStep }) })
      return { text }
    }
    if (maxToolCallsPerStep < 1) {
      const text = 'The configured provider tool step limit was reached; no tool was executed.'
      dependencies.recordTrace({ id: dependencies.traceId('provider-tool-limit'), type: 'tool', title: 'Provider native tool limit', content: text, status: 'skipped', startedAt: dependencies.now(), metadata: dependencies.buildTraceMetadata({ call, provider: input.provider, status: 'skipped', errorCode: 'step_limit_reached', target: input.providerTools?.adapter.target, stepIndex: 0, toolCallIndex, requestedToolCallCount: calls.length, maxToolCallsPerStep }) })
      return { text }
    }
    if (!input.providerTools) {
      const text = `Provider requested ${safeCallName}, but IsleMind did not authorize native provider tools for this request.`
      dependencies.recordTrace({ id: dependencies.traceId('provider-tool-unavailable'), type: 'tool', title: 'Provider native tool', content: text, status: 'error', startedAt: dependencies.now(), metadata: dependencies.buildTraceMetadata({ call, provider: input.provider, status: 'error', errorCode: 'tool_unavailable' }) })
      return { text }
    }
    const tool = dependencies.resolveTool(input.providerTools.adapter.toolNameMap, call.name)
    if (!tool) {
      const text = `Provider requested unavailable tool ${safeCallName}.`
      dependencies.recordTrace({ id: dependencies.traceId('provider-tool-unavailable'), type: 'tool', title: 'Provider native tool', content: text, status: 'error', startedAt: dependencies.now(), metadata: dependencies.buildTraceMetadata({ call, provider: input.provider, status: 'error', errorCode: 'tool_unavailable', target: input.providerTools.adapter.target }) })
      return { text }
    }
    const toolName = dependencies.manifestValue<string>(tool, 'toolName') ?? dependencies.manifestValue<string>(tool, 'name') ?? safeCallName
    const startedAt = dependencies.now()
    const traceId = dependencies.traceId('provider-tool-call')
    dependencies.recordTrace({ id: traceId, type: 'tool', title: 'Provider native tool', content: `Provider requested ${dependencies.safeText(toolName, 'tool', 160)}; IsleMind is executing it through the durable task bridge.`, status: 'running', startedAt, metadata: dependencies.buildTraceMetadata({ call, provider: input.provider, tool, status: 'running', target: input.providerTools.adapter.target, stepIndex: 0, toolCallIndex, maxToolCallsPerStep: input.providerTools.limits.maxToolCallsPerStep }) })
    const normalizedCallId = call.callId || call.id || `${call.name}:${call.index ?? toolCallIndex}`
    const argumentDigest = dependencies.digestArguments(call.arguments)
    const observation = (await dependencies.executeTask({
      stepId: `provider-native:${input.conversationId}:${input.assistantMessageId}:${normalizedCallId}:${dependencies.manifestValue(tool, 'toolId')}:${input.providerTools.catalogRevision}:${argumentDigest}:${toolCallIndex}`,
      request: { toolId: dependencies.manifestValue(tool, 'toolId'), name: toolName, source: dependencies.manifestValue(tool, 'source'), serverId: dependencies.manifestValue(tool, 'serverId'), arguments: call.arguments },
      options: { manifests: input.providerTools.manifests, limits: input.providerTools.limits, intentVisible: true, userConfirmed: false, stepIndex: 0, toolCallIndex, signal: input.signal, runtimeLog: dependencies.buildRuntimeLogOptions(input.settings), ragRuntime: dependencies.createRagRuntime({ conversation: input.conversation, settings: input.settings, provider: input.provider, systemPrompt: input.systemPrompt, context: input.context, signal: input.signal }) },
    })).observation
    dependencies.recordTrace(observation.diagnostic)
    if (input.signal.aborted) return null
    const toolOutput = dependencies.safeText(dependencies.formatBlocks(observation.blocks), observation.output || `${toolName} returned no output.`, input.providerTools.limits.outputCharLimit ?? 4800)
    const nativeSearchPlaceholder = dependencies.isNativeSearchPlaceholder({ result: observation, tool, toolOutput })
    dependencies.recordTrace({ id: traceId, type: 'tool', title: 'Provider native tool', content: nativeSearchPlaceholder ? dependencies.nativeSearchNoSourcesText() : dependencies.safeText(toolOutput, `${toolName} returned no output.`, 1600), status: observation.status, startedAt, metadata: { ...dependencies.buildTraceMetadata({ call, provider: input.provider, tool, status: observation.status, errorCode: observation.errorCode, target: input.providerTools.adapter.target, stepIndex: 0, toolCallIndex, maxToolCallsPerStep: input.providerTools.limits.maxToolCallsPerStep }), ...dependencies.projectObservationMetadata(observation) } })
    if (nativeSearchPlaceholder) {
      const existing = dependencies.sanitizeAnswer(input.firstOutput)
      return { text: existing || dependencies.nativeSearchNoSourcesText() }
    }
    if (!toolOutput.trim()) return { text: dependencies.safeText(observation.output, `${toolName} returned no output.`) }
    if (input.signal.aborted) return null
    try {
      const parameters = dependencies.resolveGenerationParameters({ provider: input.provider, conversation: input.conversation, settings: input.settings, temperatureCap: 0.4 })
      const generationParameterSources = {
        ...(parameters.temperature === undefined ? {} : { temperature: 'internal-policy' }),
        ...(parameters.topP === undefined ? {} : { topP: 'internal-policy' }),
        ...(parameters.topK === undefined ? {} : { topK: 'internal-policy' }),
        ...(parameters.maxTokens === undefined ? {} : { maxTokens: 'internal-policy' }),
      }
      const revision = await dependencies.synthesize({ provider: input.provider, conversation: input.conversation, conversationId: input.conversationId, assistantMessageId: input.assistantMessageId, model: input.conversation.model, sessionId: input.conversation.id, settings: input.settings, reasoningEffort: input.conversation.reasoningEffort, systemPrompt: [input.systemPrompt, PROVIDER_TOOL_SYNTHESIS_INSTRUCTION].filter(Boolean).join('\n\n'), messages: dependencies.buildRevisionMessages({ provider: input.provider, messages: input.messages, firstOutput: input.firstOutput, firstReasoningContent: input.firstReasoningContent, firstResponseItems: input.firstResponseItems, firstProviderContentBlocks: input.firstProviderContentBlocks, call, tool, toolOutput, ok: observation.ok }, dependencies.stripCallBlocks(input.firstOutput) || `Provider requested IsleMind tool ${toolName}.`), contextPrompt: dependencies.buildContextPrompt({ baseContextPrompt: input.baseContextPrompt }), ...parameters, temperature: parameters.temperature === undefined ? undefined : Math.min(parameters.temperature, 0.4), generationParameterSources, signal: input.signal, stream: true, remoteCompactEligible: false })
      const revisionText = dependencies.sanitizeAnswer(revision.text)
      if (revisionText.trim()) return { text: revisionText, usage: revision.usage }
    } catch (error) {
      dependencies.recordTrace({ id: dependencies.traceId('provider-tool-revise-error'), type: 'tool', title: 'Provider tool synthesis', content: dependencies.safeText(error instanceof Error ? error.message : `${toolName} synthesis failed.`, `${toolName} synthesis failed.`, 1600), status: 'error', startedAt: dependencies.now(), metadata: dependencies.buildTraceMetadata({ call, provider: input.provider, tool, status: 'error', errorCode: 'execution_failed', target: input.providerTools.adapter.target, stepIndex: 0, toolCallIndex, maxToolCallsPerStep: input.providerTools.limits.maxToolCallsPerStep }) })
    }
    if (dependencies.isInternalOutput(toolOutput) || dependencies.isInternalOutput(observation.output) || dependencies.manifestValue(tool, 'source') === 'rag') return { text: dependencies.sanitizeAnswer(input.firstOutput) || dependencies.synthesisFailureMessage() }
    return { text: toolOutput || dependencies.safeText(observation.output, `${toolName} returned no output.`) }
  }
  return { admit, execute }
}

function resolvePermissionCeiling(
  limits: ProviderToolLimits,
): 'read-only' | 'read-write' | 'destructive' | undefined {
  if (limits.allowDestructiveTools === true || limits.allowDestructiveTools === 'confirm') return 'destructive'
  if (limits.allowReadWriteTools === true || limits.allowReadWriteTools === 'visible') return 'read-write'
  return limits.allowReadOnlyTools === false ? undefined : 'read-only'
}

const PROVIDER_TOOL_SYNTHESIS_INSTRUCTION = '你正在把 IsleMind 已取得的工具信息整理成最终回复。不要调用更多工具，不要暴露 provider tool call JSON，也不要把“工具输出”“受控工具”“native-provider”等内部格式复述给用户。工具成功时请像正常回答一样自然综合；涉及新闻、搜索、资料汇总时先给一句简短背景，再用清晰紧凑的条目组织，并保留必要来源指向。工具失败时才说明失败状态和可继续的下一步。'
