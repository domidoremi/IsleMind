import type { ExternalToolExecutionResult } from './contracts'

export type McpExecutionAdmissionFailure =
  | 'cancelled'
  | 'server_disabled'
  | 'tool_disabled'
  | 'server_url_denied'
  | 'approval_denied'

export interface McpExecutionTool {
  name: string
  permission: 'read-only' | 'read-write' | 'destructive'
  enabled: boolean
}

export interface McpExecutionServer<TTool extends McpExecutionTool = McpExecutionTool> {
  id: string
  transport: 'sse' | 'streamable-http' | 'websocket'
  enabled: boolean
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  tools: readonly TTool[]
}

export type McpExecutionAdmission<TTool extends McpExecutionTool = McpExecutionTool> =
  | { ok: true; tool: TTool }
  | {
    ok: false
    failure: McpExecutionAdmissionFailure
    tool?: TTool
    cancellationStage?: 'initial' | 'approval'
  }

export type McpExecutionDispatchResult<TResult extends ExternalToolExecutionResult = ExternalToolExecutionResult> =
  | { kind: 'builtin'; result: TResult; cancelledAfter: boolean }
  | { kind: 'remote'; result: TResult }
  | { kind: 'unavailable' }
  | { kind: 'cancelled' }

export interface McpExecutionApplicationPolicy<
  TServer extends McpExecutionServer<TTool>,
  TTool extends McpExecutionTool,
  TResult extends ExternalToolExecutionResult = ExternalToolExecutionResult,
> {
  admit(input: {
    server: TServer
    toolName: string
    arguments: Record<string, unknown>
    approve?: (request: {
      server: TServer
      tool: TTool
      arguments: Record<string, unknown>
    }) => Promise<boolean>
    skipApproval?: boolean
    signal?: AbortSignal
  }): Promise<McpExecutionAdmission<TTool>>
  dispatch(input: {
    server: TServer
    tool: TTool
    arguments: Record<string, unknown>
    taskId?: string
    startedAt: number
    signal?: AbortSignal
  }): Promise<McpExecutionDispatchResult<TResult>>
  invalidate(server: TServer): void
}

export interface McpExecutionApplicationDependencies<
  TServer extends McpExecutionServer<TTool>,
  TTool extends McpExecutionTool,
  TResult extends ExternalToolExecutionResult = ExternalToolExecutionResult,
> {
  builtinServerId: string
  isAllowedServerUrl(server: TServer): boolean
  callBuiltin(input: {
    server: TServer
    tool: TTool
    arguments: Record<string, unknown>
    taskId?: string
    startedAt: number
    signal?: AbortSignal
  }): Promise<TResult>
  callRemote(input: {
    server: TServer
    tool: TTool
    arguments: Record<string, unknown>
    signal: AbortSignal
    taskId: string
    startedAt: number
  }): Promise<TResult>
  invalidateRemote(server: TServer): void
}

/** Owns MCP admission and the mutually exclusive built-in or remote dispatch decision. */
export function createMcpExecutionApplicationPolicy<
  TTool extends McpExecutionTool,
  TServer extends McpExecutionServer<TTool>,
  TResult extends ExternalToolExecutionResult = ExternalToolExecutionResult,
>(
  dependencies: McpExecutionApplicationDependencies<TServer, TTool, TResult>,
): McpExecutionApplicationPolicy<TServer, TTool, TResult> {
  const policy: McpExecutionApplicationPolicy<TServer, TTool, TResult> = {
    async admit(input) {
      const tool = input.server.tools.find((item) => item.name === input.toolName)
      if (input.signal?.aborted) {
        return { ok: false, failure: 'cancelled', tool, cancellationStage: 'initial' }
      }
      if (!input.server.enabled) return { ok: false, failure: 'server_disabled', tool }
      if (!tool?.enabled) return { ok: false, failure: 'tool_disabled', tool }
      if (!dependencies.isAllowedServerUrl(input.server)) {
        return { ok: false, failure: 'server_url_denied', tool }
      }
      if (tool.permission === 'destructive' && !input.skipApproval) {
        if (input.signal?.aborted) {
          return { ok: false, failure: 'cancelled', tool, cancellationStage: 'approval' }
        }
        const confirmed = await input.approve?.({
          server: input.server,
          tool,
          arguments: input.arguments,
        })
        if (input.signal?.aborted) {
          return { ok: false, failure: 'cancelled', tool, cancellationStage: 'approval' }
        }
        if (!confirmed) return { ok: false, failure: 'approval_denied', tool }
      }
      return { ok: true, tool }
    },

    async dispatch(input) {
      if (input.signal?.aborted) return { kind: 'cancelled' }
      if (input.server.id === dependencies.builtinServerId) {
        const result = await dependencies.callBuiltin({
          server: input.server,
          tool: input.tool,
          arguments: input.arguments,
          taskId: input.taskId,
          startedAt: input.startedAt,
          signal: input.signal,
        })
        return {
          kind: 'builtin',
          result,
          cancelledAfter: Boolean(input.signal?.aborted),
        }
      }
      if (input.server.status === 'disconnected' || input.server.status === 'error') {
        return { kind: 'unavailable' }
      }
      const result = await dependencies.callRemote({
        server: input.server,
        tool: input.tool,
        arguments: input.arguments,
        signal: input.signal ?? new AbortController().signal,
        taskId: input.taskId ?? `mcp-${input.server.id}-${input.tool.name}-${input.startedAt}`,
        startedAt: input.startedAt,
      })
      return input.signal?.aborted
        ? { kind: 'cancelled' }
        : { kind: 'remote', result }
    },

    invalidate(server) {
      if (server.transport === 'streamable-http') dependencies.invalidateRemote(server)
    },
  }
  return Object.freeze(policy)
}
