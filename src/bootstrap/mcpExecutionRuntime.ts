import {
  APPLICATION_BUILT_IN_APP_INFO_TEXT,
  BUILT_IN_CAPABILITY_SERVER_ID,
  BUILT_IN_CAPABILITY_TOOL_NAMES,
  listAppActionToolDescriptors,
  type BuiltInCapabilityExecutionResult,
  parseToolArguments,
  normalizeMcpToolContent,
  normalizeMcpToolExecutionResult,
  createMcpExecutionApplicationPolicy,
  type ExternalToolExecutionResult,
  type ExternalToolObservationErrorCode,
  type McpToolObservationSource,
} from '@/modules/integrations'
import type { McpServerConfig, McpToolManifest } from '@/types/mcpContracts'
import { composeUserFacingError, extractUserFacingErrorDetail, type ProcessTrace, type TaskId, type ToolContentBlock } from '@/core'
import type { SettingsActionName } from '@/modules/settings'
import { createTaskRuntime } from '@/bootstrap/taskRuntime'
import { st } from '@/i18n/service'
import { isAllowedMcpServerUrl } from '@/modules/integrations'
import { logMcpOperation } from '@/services/runtimeHealthLog'
import {
  mcpClient,
  resolveBuiltInCapabilityAdapter,
} from '@/bootstrap/mcpCatalog'

const BUILTIN_SERVER_ID = BUILT_IN_CAPABILITY_SERVER_ID

const applicationActionTaskLookup = createTaskRuntime({
  async evaluate() {
    return { outcome: 'denied', reasonCode: 'application_action_lookup_only' }
  },
})

export type McpCallResult = ExternalToolExecutionResult

export interface McpApprovalRequest {
  server: McpServerConfig
  tool: McpToolManifest
  arguments: Record<string, unknown>
}

export interface McpCallOptions {
  signal?: AbortSignal
  skipApproval?: boolean
  taskId?: string
}

interface ApplicationBuiltInCallResult {
  ok: boolean
  content: ToolContentBlock[]
  trace: ProcessTrace
  error?: string
}

const mcpExecution = createMcpExecutionApplicationPolicy<
  McpToolManifest,
  McpServerConfig,
  ExternalToolExecutionResult
>({
  builtinServerId: BUILTIN_SERVER_ID,
  isAllowedServerUrl: isAllowedMcpServerUrl,
  callBuiltin: async (input) => {
    const targetAdapter = resolveBuiltInCapabilityAdapter(
      `builtin:${BUILTIN_SERVER_ID}:${input.tool.name}`,
    )
    const isTargetCapability = (BUILT_IN_CAPABILITY_TOOL_NAMES as readonly string[]).includes(input.tool.name)
    if (isTargetCapability && !targetAdapter) {
      return unavailableBuiltinTargetResult(input.server, input.tool, input.startedAt)
    }
    if (targetAdapter) {
      if (!input.taskId) {
        return unavailableBuiltinTargetResult(input.server, input.tool, input.startedAt)
      }
      try {
        const result = await targetAdapter.execute({
          taskId: input.taskId as TaskId,
          tool: targetAdapter.definition,
          arguments: parseToolArguments(input.arguments),
        }, { signal: input.signal ?? new AbortController().signal })
        return result as BuiltInCapabilityExecutionResult
      } catch (error) {
        return unavailableBuiltinTargetResult(
          input.server,
          input.tool,
          input.startedAt,
          error instanceof Error ? error.message : undefined,
        )
      }
    }
    throwIfApplicationBuiltInCancelled(input.signal)
    if (input.tool.name === 'app_info') {
      return normalizeApplicationBuiltInMcpResult(
        input.server,
        input.tool,
        input.startedAt,
        createApplicationInfoResult(input.startedAt),
      )
    }
    const taskAdmission = await admitApplicationBuiltInTask({
      taskId: input.taskId,
      tool: input.tool,
      signal: input.signal,
    })
    if (!taskAdmission.ok) {
      return failedMcpResult(
        input.server,
        input.tool.name,
        input.tool,
        taskAdmission.reason,
        input.startedAt,
        taskAdmission.errorCode,
        'skipped',
      )
    }
    const appAction = listAppActionToolDescriptors().find((tool) => tool.name === input.tool.name)
    if (!appAction) {
      return failedMcpResult(
        input.server,
        input.tool.name,
        input.tool,
        st('mcpRuntime.unknownBuiltinTool'),
        input.startedAt,
        'tool_unavailable',
        'skipped',
      )
    }
    const { executeSettingsAction } = await import('@/presentation/features/settings/settingsActionCommand')
    return normalizeApplicationBuiltInMcpResult(
      input.server,
      input.tool,
      input.startedAt,
      await executeSettingsAction(
        {
          name: appAction.name as SettingsActionName,
          arguments: input.arguments,
          source: 'builtin-tool',
        },
        { signal: input.signal },
      ),
    )
  },
  callRemote: (input) => mcpClient.executeTool(input),
  invalidateRemote: (server) => mcpClient.invalidate(server),
})

/** Concrete MCP tool-call composition over admission, target observation, dispatch, and runtime-health adapters. */
export async function callMcpTool(
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown> = {},
  approve?: (request: McpApprovalRequest) => Promise<boolean>,
  options: McpCallOptions = {}
): Promise<McpCallResult> {
  const startedAt = Date.now()
  const admission = await mcpExecution.admit({
    server,
    toolName,
    arguments: args,
    approve,
    skipApproval: options.skipApproval,
    signal: options.signal,
  })
  const tool = admission.tool
  if (!admission.ok && admission.failure === 'cancelled') {
    if (admission.cancellationStage !== 'initial') {
      return cancelledMcpResult(server, toolName, tool, startedAt)
    }
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'cancelled',
      method: 'tools/call',
      reason: 'cancelled',
      detail: 'signal_already_aborted',
    })
    return cancelledMcpResult(server, toolName, tool, startedAt)
  }
  if (!admission.ok && admission.failure === 'server_disabled') {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool: tool && tool.enabled ? tool : undefined,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'server_disabled',
      method: 'tools/call',
    })
    return failedMcpResult(server, toolName, tool, st('mcpRuntime.disconnected'), startedAt, 'tool_unavailable', 'skipped')
  }
  if (!admission.ok && admission.failure === 'tool_disabled') {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'tool_disabled',
      method: 'tools/call',
    })
    return failedMcpResult(server, toolName, tool, st('mcpRuntime.toolNotEnabled'), startedAt, 'tool_unavailable', 'skipped')
  }
  if (!admission.ok && admission.failure === 'server_url_denied') {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'skipped',
      reason: 'tool_unavailable',
      detail: 'non_http_server_url',
      method: 'tools/call',
      error: new Error(st('mcpRuntime.explicitHttpOnly')),
    })
    return failedMcpResult(server, toolName, tool, st('mcpRuntime.explicitHttpOnly'), startedAt, 'tool_unavailable', 'skipped')
  }
  if (!admission.ok && admission.failure === 'approval_denied') {
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'skipped',
      reason: 'permission_required',
      detail: 'approval_denied',
      method: 'tools/call',
    })
    return failedMcpResult(server, toolName, tool, st('mcpRuntime.notApproved'), startedAt, 'permission_required', 'skipped')
  }
  if (!admission.ok) return cancelledMcpResult(server, toolName, tool, startedAt)
  try {
    const dispatch = await mcpExecution.dispatch({
      server,
      tool: admission.tool,
      arguments: args,
      startedAt,
      signal: options.signal,
      ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
    })
    if (dispatch.kind === 'cancelled') return cancelledMcpResult(server, toolName, tool, startedAt)
    if (dispatch.kind === 'builtin') {
      const result = dispatch.result
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: result.observation.ok ? 'done' : 'error',
        method: 'tools/call',
        resultCount: result.observation.blocks.length,
        reason: result.observation.ok ? undefined : 'execution_failed',
        detail: result.observation.ok ? undefined : result.observation.output,
      })
      return dispatch.cancelledAfter
        ? cancelledMcpResult(server, toolName, tool, startedAt)
        : result
    }
    if (dispatch.kind === 'unavailable') {
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: 'skipped',
        reason: 'tool_unavailable',
        detail: 'server_unavailable',
        method: 'tools/call',
      })
      return failedMcpResult(server, toolName, tool, st('mcpRuntime.disconnected'), startedAt, 'tool_unavailable', 'skipped')
    }
    const result = dispatch.result
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: result.observation.ok ? 'done' : 'error',
      method: 'tools/call',
      resultCount: result.observation.blocks.length,
      reason: result.observation.ok ? undefined : 'execution_failed',
      detail: result.observation.ok ? undefined : result.observation.output,
    })
    return result
  } catch (error) {
    mcpExecution.invalidate(server)
    if (options.signal?.aborted || isAbortError(error)) {
      await logMcpOperation({
        phase: 'tool_call',
        server,
        tool,
        status: 'cancelled',
        method: 'tools/call',
        reason: 'cancelled',
        error,
      })
      return cancelledMcpResult(server, toolName, tool, startedAt)
    }
    await logMcpOperation({
      phase: 'tool_call',
      server,
      tool,
      status: 'error',
      method: 'tools/call',
      reason: 'execution_failed',
      error,
    })
    return failedMcpResult(
      server,
      toolName,
      tool,
      composeUserFacingError(st('mcpRuntime.callFailed'), extractUserFacingErrorDetail(error)),
      startedAt,
      'execution_failed',
      'error',
    )
  }
}

async function admitApplicationBuiltInTask(input: {
  taskId?: string
  tool: McpToolManifest
  signal?: AbortSignal
}): Promise<
  | { ok: true }
  | { ok: false; reason: string; errorCode: 'cancelled' | 'permission_required' | 'tool_unavailable' }
> {
  if (input.signal?.aborted) {
    return { ok: false, reason: 'The application operation was cancelled.', errorCode: 'cancelled' }
  }
  if (!input.taskId) {
    return {
      ok: false,
      reason: 'Application operations require a durable task identity.',
      errorCode: 'permission_required',
    }
  }
  let task
  try {
    task = await applicationActionTaskLookup.getTask(input.taskId as TaskId)
  } catch {
    return {
      ok: false,
      reason: 'The durable task admission record is unavailable.',
      errorCode: 'tool_unavailable',
    }
  }
  if (input.signal?.aborted) {
    return { ok: false, reason: 'The application operation was cancelled.', errorCode: 'cancelled' }
  }
  const expectedToolId = `builtin:${BUILTIN_SERVER_ID}:${input.tool.name}`
  if (!task || task.id !== input.taskId || task.toolId !== expectedToolId) {
    return {
      ok: false,
      reason: 'The durable task is bound to a different application operation.',
      errorCode: 'permission_required',
    }
  }
  if (task.status !== 'running' || task.policy.outcome !== 'allowed' || !task.idempotencyKey.trim()) {
    return {
      ok: false,
      reason: 'The durable task is not actively admitted for application mutation.',
      errorCode: 'permission_required',
    }
  }
  if (input.tool.permission === 'destructive' && !Number.isFinite(task.confirmationConfirmedAt)) {
    return {
      ok: false,
      reason: 'The destructive application operation requires durable confirmation.',
      errorCode: 'permission_required',
    }
  }
  return { ok: true }
}

export function truncateToolBlocks(blocks: ToolContentBlock[], tokenBudget = 1200): ToolContentBlock[] {
  const safeBlocks = normalizeMcpToolContent(blocks)
  const charBudget = Math.max(200, tokenBudget * 4)
  let used = 0
  return safeBlocks.map((block) => {
    if (block.type !== 'text' || !block.text) return block
    const remaining = Math.max(0, charBudget - used)
    used += Math.min(block.text.length, remaining)
    return {
      ...block,
      text: block.text.length > remaining
        ? `${block.text.slice(0, remaining)}\n${st('mcpRuntime.outputTruncated')}`
        : block.text,
    }
  })
}

function normalizeApplicationBuiltInMcpResult(
  server: McpServerConfig,
  tool: McpToolManifest,
  startedAt: number,
  result: ApplicationBuiltInCallResult,
): ExternalToolExecutionResult {
  const traceErrorCode = result.trace.metadata?.errorCode
  const errorCode = result.ok
    ? undefined
    : traceErrorCode === 'cancelled'
      ? 'cancelled'
      : traceErrorCode === 'permission_required' || traceErrorCode === 'tool_unavailable'
        ? traceErrorCode
        : 'execution_failed'
  return normalizeMcpToolExecutionResult({
    tool,
    source: 'builtin',
    connectionStatus: server.status,
    ok: result.ok,
    status: result.ok ? 'done' : result.trace.status === 'skipped' || result.trace.status === 'cancelled' ? 'skipped' : 'error',
    output: result.trace.content ?? result.error,
    blocks: result.content,
    diagnostic: result.trace,
    error: result.error,
    errorCode,
    startedAt,
    completedAt: result.trace.completedAt,
  })
}

function createApplicationInfoResult(startedAt: number): ApplicationBuiltInCallResult {
  const completedAt = Date.now()
  const content = [{ type: 'text' as const, text: APPLICATION_BUILT_IN_APP_INFO_TEXT }]
  return {
    ok: true,
    content,
    trace: {
      id: `mcp-builtin-app-info-${startedAt}`,
      type: 'tool',
      title: 'MCP app_info',
      content: APPLICATION_BUILT_IN_APP_INFO_TEXT,
      status: 'done',
      startedAt,
      completedAt,
      durationMs: completedAt - startedAt,
    },
  }
}

function throwIfApplicationBuiltInCancelled(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Built-in tool execution was cancelled.')
  error.name = 'AbortError'
  throw error
}

function unavailableBuiltinTargetResult(
  server: McpServerConfig,
  tool: McpToolManifest,
  startedAt: number,
  detail?: string,
): ExternalToolExecutionResult {
  return failedMcpResult(
    server,
    tool.name,
    tool,
    detail || 'The target built-in capability requires a durable task identity and a bound runtime.',
    startedAt,
    'tool_unavailable',
    'skipped',
  )
}

function cancelledMcpResult(
  server: McpServerConfig,
  toolName: string,
  tool: McpToolManifest | undefined,
  startedAt: number,
): ExternalToolExecutionResult {
  return failedMcpResult(
    server,
    toolName,
    tool,
    st('mcpRuntime.cancelled'),
    startedAt,
    'cancelled',
    'skipped',
  )
}

function failedMcpResult(
  server: McpServerConfig,
  toolName: string,
  tool: McpToolManifest | undefined,
  message: string,
  startedAt: number,
  errorCode: ExternalToolObservationErrorCode,
  status: 'error' | 'skipped',
): McpCallResult {
  return normalizeMcpToolExecutionResult({
    tool: {
      serverId: server.id,
      name: toolName,
      ...(tool?.permission ? { permission: tool.permission } : {}),
    },
    source: mcpObservationSource(server),
    connectionStatus: server.status,
    ok: false,
    status,
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: {
      id: `mcp-failed-${toolName}-${startedAt}`,
      type: 'tool',
      title: `MCP ${toolName}`,
      content: message,
      status: errorCode === 'cancelled' ? 'cancelled' : status,
      startedAt,
      completedAt: Date.now(),
    },
    error: message,
    errorCode,
    startedAt,
  })
}

function mcpObservationSource(server: Pick<McpServerConfig, 'id'>): McpToolObservationSource {
  return server.id === BUILTIN_SERVER_ID ? 'builtin' : 'mcp'
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
