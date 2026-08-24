/**
 * Tagged MCP tool turns live here so the legacy chat runner only supplies
 * concrete parsing, task, trace, localization, and provider adapters.
 */

import type { ProcessTrace, StreamEvent, ToolContentBlock } from '@/core'

export type AssistantMcpToolPermission = 'read-only' | 'read-write' | 'destructive'

export interface AssistantMcpToolRequest {
  serverId?: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface AssistantMcpServerLike {
  id: string
  name: string
  enabled: boolean
  status: string
}

export interface AssistantMcpToolLike {
  name: string
  description?: string
  permission: AssistantMcpToolPermission
  inputSchema?: Record<string, unknown>
  enabled: boolean
}

export type AssistantTaggedToolSource = 'mcp' | 'builtin' | 'app-action' | 'android'

export interface AssistantTaggedToolManifestLike {
  id: string
  source: AssistantTaggedToolSource
  name: string
  description: string
  permission: AssistantMcpToolPermission
  inputSchema?: Record<string, unknown>
  enabled: boolean
  serverId?: string
  serverName?: string
  requiresConfirmation?: boolean
}

export interface AssistantMcpResolvedTool<
  TServer extends AssistantMcpServerLike = AssistantMcpServerLike,
  TTool extends AssistantMcpToolLike = AssistantMcpToolLike,
> {
  server: TServer
  tool: TTool
  manifest?: AssistantTaggedToolManifestLike
}

export interface AssistantMcpConversationLike {
  id: string
  model: string
  reasoningEffort?: unknown
}

export interface AssistantMcpToolLimits {
  outputCharLimit?: number
  allowReadOnlyTools?: boolean
  allowReadWriteTools?: boolean | 'visible'
  allowDestructiveTools?: boolean | 'confirm'
}

export interface AssistantMcpToolObservation {
  ok: boolean
  status: string
  output?: string
  blocks: readonly ToolContentBlock[]
  diagnostic: ProcessTrace
  errorCode?: string
  metadata?: Readonly<Record<string, unknown>>
}

export interface AssistantMcpPendingActionProjection {
  pendingAction: Readonly<object>
  output: string
}

export type AssistantMcpPendingActionErrorCode =
  | 'permission_required'
  | 'evidence_insufficient'

export interface AssistantMcpPendingActionProjectionInput {
  runId: string
  goal: string
  step: {
    id: string
    title: string
    toolRequest: {
      toolId: string
      name: string
      source: AssistantTaggedToolSource
      serverId?: string
      arguments: Record<string, unknown>
    }
    observation: {
      output: string
      errorCode: AssistantMcpPendingActionErrorCode
      diagnostic: {
        metadata?: Readonly<Record<string, unknown>>
      }
    }
  }
}

export interface AssistantMcpToolTurnInput<
  TProvider = unknown,
  TResolved extends AssistantMcpResolvedTool = AssistantMcpResolvedTool,
> {
  conversationId: string
  assistantMessageId: string
  provider: TProvider
  conversation: AssistantMcpConversationLike
  systemPrompt: string
  messages: readonly unknown[]
  baseContextPrompt: string
  firstOutput: string
  tools: readonly TResolved[]
  manifests?: readonly AssistantTaggedToolManifestLike[]
  signal: AbortSignal
  onStreamEvent?: (event: StreamEvent) => void
}

export interface AssistantMcpToolTurnRuntimeDependencies<
  TProvider = unknown,
  TSettings = unknown,
  TUsage = unknown,
  TResolved extends AssistantMcpResolvedTool = AssistantMcpResolvedTool,
> {
  parseRequest(output: string): AssistantMcpToolRequest | null
  findTool(
    tools: readonly TResolved[],
    request: AssistantMcpToolRequest,
    manifests: readonly AssistantTaggedToolManifestLike[],
  ): TResolved | undefined
  getSettings(): TSettings
  resolveLimits(settings: TSettings): AssistantMcpToolLimits
  buildRuntimeLogOptions(settings: TSettings): unknown
  executeTask(input: {
    stepId: string
    request: Record<string, unknown>
    options: Record<string, unknown>
  }): Promise<{ observation: AssistantMcpToolObservation }>
  buildPendingActionProjection?(
    input: AssistantMcpPendingActionProjectionInput,
  ): AssistantMcpPendingActionProjection | undefined
  truncateBlocks(blocks: ToolContentBlock[]): readonly ToolContentBlock[]
  formatBlocks(blocks: readonly ToolContentBlock[]): string
  buildRevisionSystemPrompt(systemPrompt: string): string
  buildRevisionMessages(input: {
    provider: TProvider
    conversation: AssistantMcpConversationLike
    systemPrompt: string
    messages: readonly unknown[]
    baseContextPrompt: string
    firstOutput: string
    request: AssistantMcpToolRequest
    tool: TResolved
    toolOutput: string
    ok: boolean
    signal: AbortSignal
  }): readonly unknown[]
  resolveGenerationParameters(input: {
    provider: TProvider
    conversation: AssistantMcpConversationLike
    settings: TSettings
    model: string
    temperatureCap: number
  }): { temperature?: number; topP?: number; topK?: number; maxTokens?: number }
  synthesize(input: Record<string, unknown>): Promise<{ text: string; usage?: TUsage }>
  sanitizeAnswer(output: string): string
  translate(key: string, parameters?: Record<string, unknown>): string
  buildTraceMetadata(input: Record<string, unknown>): Record<string, unknown>
  completeTrace(trace: ProcessTrace): ProcessTrace
  recordTrace(trace: ProcessTrace): void
  traceId(prefix: string): string
  now(): number
}

export function createAssistantMcpToolTurnRuntime<
  TProvider = unknown,
  TSettings = unknown,
  TUsage = unknown,
  TResolved extends AssistantMcpResolvedTool = AssistantMcpResolvedTool,
>(
  dependencies: AssistantMcpToolTurnRuntimeDependencies<TProvider, TSettings, TUsage, TResolved>,
) {
  async function execute(
    input: AssistantMcpToolTurnInput<TProvider, TResolved>,
  ): Promise<{ text: string; usage?: TUsage } | null> {
    const request = dependencies.parseRequest(input.firstOutput)
    if (!request) return null

    const resolved = dependencies.findTool(input.tools, request, input.manifests ?? [])
    if (!resolved) {
      dependencies.recordTrace(dependencies.completeTrace({
        id: dependencies.traceId('mcp-unmatched'),
        type: 'tool',
        title: dependencies.translate('chatRunner.trace.mcpToolRequestTitle'),
        content: dependencies.translate('chatRunner.trace.mcpToolUnavailable', { tool: request.toolName }),
        status: 'error',
        startedAt: dependencies.now(),
        metadata: {
          requestedTool: request.toolName,
          ...dependencies.buildTraceMetadata({
            mode: 'tagged-json-fallback',
            source: 'mcp',
            serverId: request.serverId,
            toolName: request.toolName,
            status: 'error',
            errorCode: 'tool_unavailable',
          }),
        },
      }))
      return { text: dependencies.translate('mcpRuntime.toolUnavailable', { tool: request.toolName }) }
    }

    const manifest = toTaggedMcpAgentToolManifest(resolved)
    const startedAt = dependencies.now()
    dependencies.recordTrace({
      id: dependencies.traceId('mcp-call-start'),
      type: 'tool',
      title: dependencies.translate('chatRunner.trace.mcpToolRequestTitle'),
      content: dependencies.translate('chatRunner.trace.mcpToolRequested', {
        server: resolved.server.name,
        tool: resolved.tool.name,
      }),
      status: 'running',
      startedAt,
      metadata: {
        tool: resolved.tool.name,
        ...dependencies.buildTraceMetadata({
          mode: 'tagged-json-fallback',
          source: manifest.source,
          serverId: manifest.serverId,
          toolName: manifest.name,
          permission: manifest.permission,
          status: 'running',
        }),
      },
    })

    const settings = dependencies.getSettings()
    const limits = dependencies.resolveLimits(settings)
    const stepId = buildTaggedMcpTaskStepId(input, request, resolved)
    let observation: AssistantMcpToolObservation
    try {
      observation = (await dependencies.executeTask({
        stepId,
        request: {
          toolId: manifest.id,
          name: manifest.name,
          source: manifest.source,
          serverId: manifest.serverId,
          arguments: request.arguments,
        },
        options: {
          manifests: [manifest],
          limits,
          intentVisible: true,
          userConfirmed: false,
          evidenceSources: [`runtime:tagged-${manifest.source}-request`],
          evidenceSummary: 'A selected tool was requested through the visible chat turn.',
          stepIndex: 0,
          toolCallIndex: 0,
          signal: input.signal,
          runtimeLog: dependencies.buildRuntimeLogOptions(settings),
        },
      })).observation
    } catch (error) {
      dependencies.recordTrace(dependencies.completeTrace({
        id: dependencies.traceId('mcp-task-adapter-error'),
        type: 'tool',
        title: dependencies.translate('chatRunner.trace.mcpToolResultTitle'),
        content: error instanceof Error
          ? error.message
          : dependencies.translate('mcpRuntime.callFailed'),
        status: 'error',
        startedAt: dependencies.now(),
        metadata: {
          ...dependencies.buildTraceMetadata({
            mode: 'tagged-json-fallback',
            source: manifest.source,
            serverId: manifest.serverId,
            toolName: manifest.name,
            permission: manifest.permission,
            status: 'error',
            errorCode: 'execution_failed',
          }),
          taskAdapter: 'task-runtime',
        },
      }))
      return { text: dependencies.translate('mcpRuntime.callFailed') }
    }

    dependencies.recordTrace(observation.diagnostic)
    if (input.signal.aborted) return null

    const pendingActionProjection = buildPendingActionProjection({
      dependencies,
      input,
      manifest,
      observation,
      request,
      stepId,
    })
    if (pendingActionProjection) {
      dependencies.recordTrace(dependencies.completeTrace({
        id: dependencies.traceId('mcp-confirmation-required'),
        type: 'system',
        title: 'Agent workflow',
        content: pendingActionProjection.output,
        status: 'skipped',
        startedAt,
        metadata: {
          status: 'waiting',
          failureCode: observation.errorCode,
          errorCode: observation.errorCode,
          stepCount: 1,
          toolId: manifest.id,
          source: manifest.source,
          serverId: manifest.serverId,
          toolName: manifest.name,
          permission: manifest.permission,
          pendingAction: pendingActionProjection.pendingAction,
        },
      }))
      return { text: pendingActionProjection.output }
    }

    const copiedBlocks = observation.blocks.map((block) => ({ ...block }))
    const toolOutput = dependencies.formatBlocks(dependencies.truncateBlocks(copiedBlocks))
    if (!toolOutput.trim()) {
      return { text: observation.output || dependencies.translate('mcpRuntime.emptyOutput') }
    }

    try {
      const currentSettings = dependencies.getSettings()
      const parameters = dependencies.resolveGenerationParameters({
        provider: input.provider,
        conversation: input.conversation,
        settings: currentSettings,
        model: input.conversation.model,
        temperatureCap: 0.4,
      })
      const generationParameterSources = {
        ...(parameters.temperature === undefined ? {} : { temperature: 'internal-policy' }),
        ...(parameters.topP === undefined ? {} : { topP: 'internal-policy' }),
        ...(parameters.topK === undefined ? {} : { topK: 'internal-policy' }),
        ...(parameters.maxTokens === undefined ? {} : { maxTokens: 'internal-policy' }),
      }
      const revision = await dependencies.synthesize({
        provider: input.provider,
        model: input.conversation.model,
        systemPrompt: dependencies.buildRevisionSystemPrompt(input.systemPrompt),
        messages: dependencies.buildRevisionMessages({
          ...input,
          request,
          tool: resolved,
          toolOutput,
          ok: observation.ok,
        }),
        contextPrompt: input.baseContextPrompt,
        ...parameters,
        temperature: parameters.temperature === undefined
          ? undefined
          : Math.min(parameters.temperature, 0.4),
        generationParameterSources,
        reasoningEffort: input.conversation.reasoningEffort,
        stream: false,
        signal: input.signal,
        conversationId: input.conversation.id,
        sessionId: input.conversation.id,
        settings: currentSettings,
        remoteCompactEligible: false,
        onStreamEvent: input.onStreamEvent,
      })
      const revisionText = dependencies.sanitizeAnswer(revision.text)
      if (revisionText.trim()) return { text: revisionText, usage: revision.usage }
    } catch (error) {
      dependencies.recordTrace(dependencies.completeTrace({
        id: dependencies.traceId('mcp-revise-error'),
        type: 'tool',
        title: dependencies.translate('chatRunner.trace.mcpToolResultTitle'),
        content: error instanceof Error
          ? error.message
          : dependencies.translate('mcpRuntime.callFailed'),
        status: 'error',
        startedAt: dependencies.now(),
        metadata: {
          tool: resolved.tool.name,
          ...dependencies.buildTraceMetadata({
            mode: 'tagged-json-fallback',
            source: manifest.source,
            serverId: manifest.serverId,
            toolName: manifest.name,
            permission: manifest.permission,
            status: 'error',
            errorCode: 'execution_failed',
          }),
        },
      }))
    }

    return {
      text: [
        dependencies.translate('chatRunner.trace.mcpToolResultTitle'),
        '',
        toolOutput,
      ].join('\n'),
    }
  }

  return { execute }
}

function buildPendingActionProjection<
  TProvider,
  TSettings,
  TUsage,
  TResolved extends AssistantMcpResolvedTool,
>(input: {
  dependencies: AssistantMcpToolTurnRuntimeDependencies<TProvider, TSettings, TUsage, TResolved>
  input: AssistantMcpToolTurnInput<TProvider, TResolved>
  manifest: AssistantTaggedToolManifestLike
  observation: AssistantMcpToolObservation
  request: AssistantMcpToolRequest
  stepId: string
}): AssistantMcpPendingActionProjection | undefined {
  if (!input.dependencies.buildPendingActionProjection) return undefined
  if (input.observation.errorCode !== 'permission_required'
    && input.observation.errorCode !== 'evidence_insufficient') return undefined

  return input.dependencies.buildPendingActionProjection({
    runId: input.stepId,
    goal: `Run ${input.manifest.name}`,
    step: {
      id: input.stepId,
      title: input.manifest.name,
      toolRequest: {
        toolId: input.manifest.id,
        name: input.manifest.name,
        source: input.manifest.source,
        ...(input.manifest.serverId ? { serverId: input.manifest.serverId } : {}),
        arguments: input.request.arguments,
      },
      observation: {
        output: input.observation.output ?? '',
        errorCode: input.observation.errorCode,
        diagnostic: {
          metadata: {
            ...(input.observation.diagnostic.metadata ?? {}),
            ...(input.observation.metadata ?? {}),
            toolId: input.manifest.id,
            source: input.manifest.source,
            serverId: input.manifest.serverId,
            permission: input.manifest.permission,
          },
        },
      },
    },
  })
}

function buildTaggedMcpTaskStepId<
  TProvider,
  TResolved extends AssistantMcpResolvedTool,
>(
  input: Pick<AssistantMcpToolTurnInput<TProvider, TResolved>, 'conversationId' | 'assistantMessageId'>,
  request: AssistantMcpToolRequest,
  resolved: TResolved,
): string {
  return [
    'tagged-mcp',
    input.conversationId,
    input.assistantMessageId,
    resolved.server.id,
    resolved.tool.name,
    request.serverId,
    request.toolName,
  ].join(':')
}

function toTaggedMcpAgentToolManifest<TResolved extends AssistantMcpResolvedTool>(
  resolved: TResolved,
): AssistantTaggedToolManifestLike {
  if (resolved.manifest) {
    return {
      ...resolved.manifest,
      inputSchema: resolved.manifest.inputSchema
        ? { ...resolved.manifest.inputSchema }
        : undefined,
    }
  }
  return {
    id: `mcp:${resolved.server.id}:${resolved.tool.name}`,
    source: 'mcp',
    name: resolved.tool.name,
    description: resolved.tool.description ?? resolved.tool.name,
    permission: resolved.tool.permission,
    inputSchema: resolved.tool.inputSchema,
    enabled: resolved.server.enabled
      && resolved.tool.enabled
      && resolved.server.status === 'connected',
    serverId: resolved.server.id,
    serverName: resolved.server.name,
    requiresConfirmation: resolved.tool.permission === 'destructive',
  }
}
