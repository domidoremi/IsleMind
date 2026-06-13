import type { McpServerConfig, McpToolManifest, ProcessTrace, ToolContentBlock } from '@/types'
import type {
  AgentPermissionContext,
  AgentPermissionDecision,
  AgentFailureCode,
  AgentRagRuntime,
  AgentRuntimeLogOptions,
  AgentToolManifest,
  AgentToolRequest,
  AgentToolResult,
  AgentToolSource,
} from '@/services/agent/agentToolTypes'
import { executeAppAction, type AppActionName } from '@/services/appActionPolicy'
import { executeAndroidDeviceTool, listAndroidDeviceToolManifests } from '@/services/androidDeviceTools'
import { BUILTIN_SERVER_ID, listBuiltinToolManifests } from '@/services/builtinToolRegistry'
import { builtinMcpServer, callMcpTool, listMcpServers } from '@/services/mcp'
import { decideAgentToolPermission, resolveAgentRunLimits, validateAgentToolInput } from '@/services/agent/agentPolicy'
import { clampAgentOutput, createAgentTrace, normalizeToolBlocks, redactSensitiveText, summarizeToolBlocks } from '@/services/agent/agentTrace'
import {
  WORK_ARTIFACT_WORKFLOW_CONTRACT,
  buildWorkArtifactWorkflowOutput,
  type WorkArtifactCitationReference,
} from '@/services/agent/workArtifactWorkflow'
import type { RagProfile } from '@/types'

export interface ListAgentToolManifestOptions {
  includeMcp?: boolean
  includeBuiltins?: boolean
  includeAppActions?: boolean
  includeInternalTools?: boolean
  includeAndroidTools?: boolean
}

export interface ExecuteAgentToolOptions extends AgentPermissionContext {
  manifests?: AgentToolManifest[]
  ragRuntime?: AgentRagRuntime
  runtimeLog?: AgentRuntimeLogOptions
  signal?: AbortSignal
}

interface AgentAppActionManifest {
  name: AppActionName
  description: string
  permission: AgentToolManifest['permission']
  inputSchema?: Record<string, unknown>
}

const APP_ACTIONS: AgentAppActionManifest[] = [
  {
    name: 'get_settings',
    description: 'Read current IsleMind app settings that are safe to show in chat.',
    permission: 'read-only',
  },
  {
    name: 'set_theme_mode',
    description: 'Set theme mode to light, dark, or system.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: { mode: { type: 'string', enum: ['light', 'dark', 'system'] } },
      required: ['mode'],
    },
  },
  {
    name: 'set_theme_family',
    description: 'Set theme family to island or minimal.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: { themeId: { type: 'string', enum: ['island', 'minimal'] } },
      required: ['themeId'],
    },
  },
  {
    name: 'set_language',
    description: 'Set app language to zh-CN, en, or ja.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: { language: { type: 'string', enum: ['zh-CN', 'en', 'ja'] } },
      required: ['language'],
    },
  },
  {
    name: 'set_feature_flag',
    description: 'Enable or disable a safe reversible app feature flag.',
    permission: 'read-write',
    inputSchema: {
      type: 'object',
      properties: {
        flag: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['flag', 'enabled'],
    },
  },
]

const INTERNAL_TOOLS: AgentToolManifest[] = [
  {
    id: 'rag:context_pack',
    source: 'rag',
    name: 'rag.context_pack',
    description: 'Plan, retrieve, rerank, pack, and evaluate local RAG context with citations.',
    permission: 'read-only',
    enabled: true,
    requiresRuntimeContext: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        profile: { type: 'string', enum: ['fast', 'balanced', 'deep', 'offline'] },
        profileReason: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    id: 'work-artifact:summarize',
    source: 'work-artifact',
    name: 'work_artifact.summarize',
    description: 'Summarize and quality-check a structured work artifact.',
    permission: 'read-only',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        sourceMessageId: { type: 'string' },
        citations: { type: 'array' },
      },
      required: ['content'],
    },
  },
]

export async function listAgentToolManifests(options: ListAgentToolManifestOptions = {}): Promise<AgentToolManifest[]> {
  const includeMcp = options.includeMcp ?? true
  const includeBuiltins = options.includeBuiltins ?? true
  const includeAppActions = options.includeAppActions ?? true
  const includeInternalTools = options.includeInternalTools ?? true
  const includeAndroidTools = options.includeAndroidTools ?? true
  const manifests: AgentToolManifest[] = []

  if (includeMcp) {
    const servers = await listMcpServers()
    for (const server of servers) {
      if (server.id === BUILTIN_SERVER_ID) continue
      manifests.push(...server.tools.map((tool) => fromMcpTool(server, tool, 'mcp')))
    }
  }

  if (includeBuiltins) {
    const server = builtinMcpServer()
    manifests.push(...listBuiltinToolManifests().map((tool) => fromMcpTool(server, tool, 'builtin')))
  }

  if (includeAppActions) {
    manifests.push(...APP_ACTIONS.map(fromAppAction))
  }

  if (includeInternalTools) {
    manifests.push(...INTERNAL_TOOLS.map((tool) => ({ ...tool })))
  }

  if (includeAndroidTools) {
    manifests.push(...listAndroidDeviceToolManifests())
  }

  return manifests
}

export function listStaticAgentToolManifests(): AgentToolManifest[] {
  return [
    ...listBuiltinToolManifests().map((tool) => fromMcpTool(builtinMcpServer(), tool, 'builtin')),
    ...APP_ACTIONS.map(fromAppAction),
    ...INTERNAL_TOOLS.map((tool) => ({ ...tool })),
    ...listAndroidDeviceToolManifests(),
  ]
}

export async function executeAgentTool(request: AgentToolRequest, options: ExecuteAgentToolOptions = {}): Promise<AgentToolResult> {
  if (options.signal?.aborted) {
    return cancelledToolResult(request.name ?? request.toolId ?? 'unknown')
  }
  const manifests = options.manifests ?? await listAgentToolManifests()
  const tool = resolveAgentTool(request, manifests)
  if (!tool) return skippedToolResult(request.name ?? request.toolId ?? 'unknown', 'tool_unavailable', 'Tool is unavailable.')
  return executeResolvedAgentTool(tool, request.arguments ?? {}, options)
}

export async function executeResolvedAgentTool(
  tool: AgentToolManifest,
  args: Record<string, unknown> = {},
  options: ExecuteAgentToolOptions = {}
): Promise<AgentToolResult> {
  if (options.signal?.aborted) {
    return cancelledToolResult(tool.name, tool)
  }

  const permission = decideAgentToolPermission(tool, options)
  if (permission.decision !== 'allow') {
    return {
      ok: false,
      status: 'skipped',
      output: permission.reason,
      blocks: [{ type: 'text', text: permission.reason }],
      trace: permission.trace,
      errorCode: permission.code ?? 'permission_required',
      metadata: { decision: permission.decision },
    }
  }

  const schema = validateAgentToolInput(tool.inputSchema, args)
  if (!schema.ok) {
    return skippedToolResult(tool.name, 'schema_invalid', schema.errors.join('\n'), tool)
  }

  if (options.signal?.aborted) {
    return cancelledToolResult(tool.name, tool)
  }

  if (tool.source === 'builtin') {
    return attachPermissionTraceMetadata(await executeMcpBackedTool(tool, args, builtinMcpServer(), options), permission)
  }

  if (tool.source === 'mcp') {
    const server = (await listMcpServers()).find((item) => item.id === tool.serverId)
    if (!server) return skippedToolResult(tool.name, 'tool_unavailable', 'MCP server is unavailable.', tool)
    return attachPermissionTraceMetadata(await executeMcpBackedTool(tool, args, server, options), permission)
  }

  if (tool.source === 'app-action') {
    return attachPermissionTraceMetadata(await executeAppActionTool(tool, args, options), permission)
  }

  if (tool.source === 'work-artifact') {
    return attachPermissionTraceMetadata(executeWorkArtifactTool(tool, args, options), permission)
  }

  if (tool.source === 'rag') {
    return attachPermissionTraceMetadata(await executeRagTool(tool, args, options), permission)
  }

  if (tool.source === 'android') {
    return attachPermissionTraceMetadata(await executeAndroidDeviceTool(tool, args, { signal: options.signal, runtimeLog: options.runtimeLog }), permission)
  }

  return skippedToolResult(tool.name, 'tool_unavailable', `${tool.name} requires runtime context.`, tool)
}

export function resolveAgentTool(request: AgentToolRequest, manifests: AgentToolManifest[]): AgentToolManifest | null {
  if (request.toolId) return manifests.find((tool) => tool.id === request.toolId) ?? null
  if (!request.name) return null
  const matches = manifests.filter((tool) => {
    if (tool.name !== request.name) return false
    if (request.source && tool.source !== request.source) return false
    if (request.serverId && tool.serverId !== request.serverId) return false
    return true
  })
  return matches[0] ?? null
}

export function normalizeAgentToolResult(input: {
  ok: boolean
  blocks?: ToolContentBlock[]
  trace: ProcessTrace
  error?: string
  status?: AgentToolResult['status']
  errorCode?: AgentToolResult['errorCode']
  outputCharLimit?: number
}): AgentToolResult {
  const limit = resolveAgentRunLimits({ outputCharLimit: input.outputCharLimit }).outputCharLimit
  const blocks = normalizeToolBlocks(input.blocks, limit)
  const output = summarizeToolBlocks(blocks, limit) || input.error || ''
  return {
    ok: input.ok,
    status: input.status ?? (input.ok ? 'done' : 'error'),
    output,
    blocks,
    trace: createAgentTrace(input.trace),
    errorCode: input.errorCode,
  }
}

function attachPermissionTraceMetadata(result: AgentToolResult, permission: AgentPermissionDecision): AgentToolResult {
  if (permission.decision !== 'allow') return result
  return {
    ...result,
    trace: createAgentTrace({
      ...result.trace,
      metadata: {
        ...(result.trace.metadata ?? {}),
        ...(permission.trace.metadata ?? {}),
      },
    }),
  }
}

function fromMcpTool(server: McpServerConfig, tool: McpToolManifest, source: Extract<AgentToolSource, 'mcp' | 'builtin'>): AgentToolManifest {
  return {
    id: `${source}:${server.id}:${tool.name}`,
    source,
    name: tool.name,
    description: tool.description ?? tool.name,
    permission: tool.permission,
    inputSchema: tool.inputSchema,
    enabled: server.enabled && tool.enabled && (source === 'builtin' || server.status === 'connected'),
    serverId: server.id,
    serverName: server.name,
    metadata: {
      transport: server.transport,
      status: server.status,
    },
  }
}

function fromAppAction(action: AgentAppActionManifest): AgentToolManifest {
  return {
    id: `app-action:${action.name}`,
    source: 'app-action',
    name: action.name,
    description: action.description,
    permission: action.permission,
    inputSchema: action.inputSchema,
    enabled: true,
  }
}

async function executeMcpBackedTool(
  tool: AgentToolManifest,
  args: Record<string, unknown>,
  server: McpServerConfig,
  options: ExecuteAgentToolOptions
): Promise<AgentToolResult> {
  const result = await callMcpTool(server, tool.name, args, async () => Boolean(options.userConfirmed), { signal: options.signal })
  const errorCode = resolveMcpAgentErrorCode(result)
  return normalizeAgentToolResult({
    ok: result.ok,
    blocks: result.content,
    trace: result.trace,
    error: result.error,
    status: result.ok ? 'done' : result.trace.status === 'skipped' ? 'skipped' : 'error',
    errorCode,
    outputCharLimit: options.limits?.outputCharLimit,
  })
}

function resolveMcpAgentErrorCode(result: Awaited<ReturnType<typeof callMcpTool>>): AgentFailureCode | undefined {
  if (result.ok) return undefined
  const metadataCode = result.trace.metadata?.errorCode
  if (isAgentFailureCode(metadataCode)) return metadataCode
  return result.trace.status === 'skipped' ? 'tool_unavailable' : 'execution_failed'
}

function isAgentFailureCode(value: unknown): value is AgentFailureCode {
  return (
    value === 'provider_unavailable' ||
    value === 'tool_unavailable' ||
    value === 'permission_required' ||
    value === 'schema_invalid' ||
    value === 'rag_unavailable' ||
    value === 'evidence_insufficient' ||
    value === 'cancelled' ||
    value === 'step_limit_reached' ||
    value === 'policy_denied' ||
    value === 'execution_failed'
  )
}

async function executeAppActionTool(
  tool: AgentToolManifest,
  args: Record<string, unknown>,
  options: ExecuteAgentToolOptions
): Promise<AgentToolResult> {
  const result = await executeAppAction({ name: tool.name as AppActionName, arguments: args, source: 'builtin-tool' }, { signal: options.signal })
  const errorCode = resolveAppActionAgentErrorCode(result)
  return normalizeAgentToolResult({
    ok: result.ok,
    blocks: result.content,
    trace: result.trace,
    error: result.error,
    status: result.ok ? 'done' : result.trace.status === 'skipped' ? 'skipped' : 'error',
    errorCode,
    outputCharLimit: options.limits?.outputCharLimit,
  })
}

function resolveAppActionAgentErrorCode(result: Awaited<ReturnType<typeof executeAppAction>>): AgentFailureCode | undefined {
  if (result.ok) return undefined
  const metadataCode = result.trace.metadata?.errorCode
  if (isAgentFailureCode(metadataCode)) return metadataCode
  return 'execution_failed'
}

function executeWorkArtifactTool(tool: AgentToolManifest, args: Record<string, unknown>, options: ExecuteAgentToolOptions): AgentToolResult {
  const startedAt = Date.now()
  const content = typeof args.content === 'string' ? args.content : ''
  const workflowOutput = buildWorkArtifactWorkflowOutput(content, {
    sourceMessageId: typeof args.sourceMessageId === 'string' ? args.sourceMessageId : undefined,
    citations: normalizeWorkArtifactCitationArgs(args.citations),
  })
  const output = sanitizeInternalToolOutput(JSON.stringify(buildCompactWorkArtifactToolOutput(workflowOutput)), options)
  const block = { type: 'text' as const, text: output }
  return {
    ok: true,
    status: 'done',
    output,
    blocks: [block],
    trace: createAgentTrace({
      id: `agent-tool-${tool.id}-${startedAt}`,
      type: 'tool',
      title: `Agent ${tool.name}`,
      content: `contract=${WORK_ARTIFACT_WORKFLOW_CONTRACT} · quality=${workflowOutput.quality} · evidence=${workflowOutput.evidenceCount} · gaps=${workflowOutput.qualityGaps.length} · next=${workflowOutput.primaryNextStep ? 'present' : 'missing'}`,
      status: 'done',
      startedAt,
      metadata: {
        contract: WORK_ARTIFACT_WORKFLOW_CONTRACT,
        source: tool.source,
        quality: workflowOutput.quality,
        qualityAuditOk: workflowOutput.qualityAudit.ok,
        evidenceCount: workflowOutput.evidenceCount,
        sourceEvidenceCount: workflowOutput.sourceEvidence.length,
        qualityGapCount: workflowOutput.qualityGaps.length,
        qualityGapCodes: workflowOutput.qualityGaps.map((gap) => gap.code),
        missingKinds: workflowOutput.missingKinds,
        primaryNextStep: workflowOutput.primaryNextStep,
        qualitySummary: workflowOutput.qualitySummary,
        followUpPrompt: workflowOutput.followUpPrompt,
      },
    }),
    }
  }

function buildCompactWorkArtifactToolOutput(workflowOutput: ReturnType<typeof buildWorkArtifactWorkflowOutput>): Record<string, unknown> {
  return {
    contract: workflowOutput.contract,
    artifact: {
      hasWorkArtifact: workflowOutput.artifact.hasWorkArtifact,
      language: workflowOutput.artifact.language,
      quality: workflowOutput.artifact.quality,
      summary: compactWorkArtifactItems(workflowOutput.artifact.summary),
      actionItems: compactWorkArtifactItems(workflowOutput.artifact.actionItems),
      decisions: compactWorkArtifactItems(workflowOutput.artifact.decisions),
      risks: compactWorkArtifactItems(workflowOutput.artifact.risks),
      openQuestions: compactWorkArtifactItems(workflowOutput.artifact.openQuestions),
      sourceEvidence: compactWorkArtifactItems(workflowOutput.artifact.sourceEvidence),
      handoffText: clampAgentOutput(workflowOutput.artifact.handoffText, 720),
      primaryNextStep: workflowOutput.artifact.primaryNextStep,
      qualitySummary: workflowOutput.artifact.qualitySummary,
      followUpPrompt: clampAgentOutput(workflowOutput.artifact.followUpPrompt, 480),
    },
    qualityAudit: workflowOutput.qualityAudit,
    qualityGaps: workflowOutput.qualityGaps,
    sourceEvidence: compactWorkArtifactItems(workflowOutput.sourceEvidence),
    sourceMessageId: workflowOutput.sourceMessageId,
    citations: workflowOutput.citations,
    hasWorkArtifact: workflowOutput.hasWorkArtifact,
    quality: workflowOutput.quality,
    actionItemCount: workflowOutput.actionItemCount,
    decisionCount: workflowOutput.decisionCount,
    riskCount: workflowOutput.riskCount,
    openQuestionCount: workflowOutput.openQuestionCount,
    evidenceCount: workflowOutput.evidenceCount,
    missingKinds: workflowOutput.missingKinds,
    primaryNextStep: workflowOutput.primaryNextStep,
    qualitySummary: workflowOutput.qualitySummary,
    followUpPrompt: clampAgentOutput(workflowOutput.followUpPrompt, 480),
    handoffText: clampAgentOutput(workflowOutput.handoffText, 720),
  }
}

function compactWorkArtifactItems<T extends { text?: string }>(items: T[]): T[] {
  return items.slice(0, 12).map((item) => ({
    ...item,
    ...(typeof item.text === 'string' ? { text: clampAgentOutput(item.text, 280) } : {}),
  }))
}

function normalizeWorkArtifactCitationArgs(value: unknown): WorkArtifactCitationReference[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const label = item.trim()
        return label ? { label } : undefined
      }
      if (!item || typeof item !== 'object') return undefined
      const record = item as Record<string, unknown>
      return {
        ...(typeof record.id === 'string' ? { id: record.id } : {}),
        ...(typeof record.label === 'string' ? { label: record.label } : {}),
        ...(typeof record.title === 'string' ? { title: record.title } : {}),
        ...(typeof record.url === 'string' ? { url: record.url } : {}),
        ...(typeof record.excerpt === 'string' ? { excerpt: record.excerpt } : {}),
      }
    })
    .filter((item): item is WorkArtifactCitationReference => Boolean(item && Object.keys(item).length))
}

async function executeRagTool(
  tool: AgentToolManifest,
  args: Record<string, unknown>,
  options: ExecuteAgentToolOptions
): Promise<AgentToolResult> {
  if (!options.ragRuntime) {
    return skippedToolResult(tool.name, 'rag_unavailable', `${tool.name} requires a RAG runtime adapter.`, tool)
  }

  const startedAt = Date.now()
  try {
    const pack = await options.ragRuntime.buildContextPack({
      query: String(args.query ?? ''),
      conversationTitle: typeof args.conversationTitle === 'string' ? args.conversationTitle : undefined,
      systemPrompt: typeof args.systemPrompt === 'string' ? args.systemPrompt : undefined,
      profile: normalizeRagToolProfileArg(args.profile),
      profileReason: typeof args.profileReason === 'string' ? args.profileReason : undefined,
      tokenBudget: typeof args.tokenBudget === 'number' ? args.tokenBudget : undefined,
      maxContextItems: typeof args.maxContextItems === 'number' ? args.maxContextItems : undefined,
    }, { signal: options.signal })
    const output = sanitizeInternalToolOutput(JSON.stringify({
      query: pack.plan.query,
      profile: pack.plan.profile,
      profileSource: pack.plan.profileSource,
      profileReason: pack.plan.profileReason,
      sourceCount: pack.sources.length,
      citationCount: pack.citations.length,
      confidence: pack.quality.confidence,
      missingEvidence: pack.quality.missingEvidence,
      warnings: pack.quality.warnings,
      fallbackReasons: pack.quality.fallbackReasons ?? [],
      contextPrompt: pack.contextPrompt,
      citations: pack.citations.map((citation) => ({
        id: citation.id,
        label: citation.label,
        type: citation.type,
        title: citation.title,
        excerpt: citation.excerpt,
        url: citation.url,
        score: citation.score,
        rerankScore: citation.rerankScore,
      })),
    }, null, 2), options)
    const block = { type: 'text' as const, text: output }
    return {
      ok: true,
      status: 'done',
      output,
      blocks: [block],
      trace: createAgentTrace({
        id: `agent-tool-${tool.id}-${startedAt}`,
        type: 'retrieval',
        title: `Agent ${tool.name}`,
        content: `profile=${pack.plan.profile} · profileSource=${pack.plan.profileSource} · sources=${pack.sources.length} · citations=${pack.citations.length} · confidence=${pack.quality.confidence.toFixed(2)} · fallbackReasons=${pack.quality.fallbackReasons?.length ?? 0}`,
        status: 'done',
        startedAt,
        metadata: {
          source: tool.source,
          profile: pack.plan.profile,
          profileSource: pack.plan.profileSource,
          profileReason: pack.plan.profileReason,
          sourceCount: pack.sources.length,
          citationCount: pack.citations.length,
          confidence: pack.quality.confidence,
          missingEvidence: pack.quality.missingEvidence,
          warnings: pack.quality.warnings,
          fallbackReasons: pack.quality.fallbackReasons ?? [],
          ragTraceCount: pack.trace.length,
        },
      }),
    }
  } catch (error) {
    if (isAbortError(error)) return cancelledToolResult(tool.name, tool)
    const message = sanitizeInternalToolOutput(error instanceof Error ? error.message : `${tool.name} failed.`, options)
    return {
      ok: false,
      status: 'error',
      output: message,
      blocks: [{ type: 'text', text: message }],
      trace: createAgentTrace({
        id: `agent-tool-failed-${tool.id}-${startedAt}`,
        type: 'retrieval',
        title: `Agent ${tool.name}`,
        content: message,
        status: 'error',
        startedAt,
        metadata: { source: tool.source, errorCode: 'rag_unavailable' },
      }),
      errorCode: 'rag_unavailable',
    }
  }
}

function normalizeRagToolProfileArg(value: unknown): RagProfile | undefined {
  return value === 'fast' || value === 'balanced' || value === 'deep' || value === 'offline'
    ? value
    : undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function sanitizeInternalToolOutput(output: string, options: ExecuteAgentToolOptions): string {
  const limit = resolveAgentRunLimits(options.limits).outputCharLimit
  return clampAgentOutput(redactSensitiveText(output), limit)
}

function skippedToolResult(
  toolName: string,
  errorCode: AgentToolResult['errorCode'],
  message: string,
  tool?: AgentToolManifest
): AgentToolResult {
  const startedAt = Date.now()
  return {
    ok: false,
    status: 'skipped',
    output: message,
    blocks: [{ type: 'text', text: message }],
    trace: createAgentTrace({
      id: `agent-tool-skipped-${tool?.id ?? toolName}-${startedAt}`,
      type: 'tool',
      title: `Agent ${toolName}`,
      content: message,
      status: 'skipped',
      startedAt,
      metadata: tool ? { toolId: tool.id, source: tool.source, permission: tool.permission, errorCode } : { errorCode },
    }),
    errorCode,
  }
}

function cancelledToolResult(toolName: string, tool?: AgentToolManifest): AgentToolResult {
  const startedAt = Date.now()
  const output = 'Agent workflow execution was cancelled.'
  const metadata = tool
    ? { toolId: tool.id, source: tool.source, permission: tool.permission, errorCode: 'cancelled', status: 'cancelled', failureCode: 'cancelled' }
    : { errorCode: 'cancelled', status: 'cancelled', failureCode: 'cancelled' }
  return {
    ok: false,
    status: 'skipped',
    output,
    blocks: [{ type: 'text', text: output }],
    trace: createAgentTrace({
      id: `agent-tool-cancelled-${tool?.id ?? toolName}-${startedAt}`,
      type: 'system',
      title: 'Agent cancelled',
      content: output,
      status: 'skipped',
      startedAt,
      metadata,
    }),
    errorCode: 'cancelled',
    metadata,
  }
}
