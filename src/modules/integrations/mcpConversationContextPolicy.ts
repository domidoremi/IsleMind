export const MCP_CONVERSATION_CONTEXT_SCHEMA_CHAR_LIMIT = 600

export interface McpConversationContextTool {
  readonly name: string
  readonly enabled: boolean
  readonly permission: string
  readonly description?: string
  readonly inputSchema?: Record<string, unknown>
}

export interface McpConversationContextServer<
  TTool extends McpConversationContextTool = McpConversationContextTool,
> {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly status: string
  readonly tools: readonly TTool[]
}

export interface McpConversationToolIdentityLike {
  readonly server: {
    readonly id: string
    readonly name: string
  }
  readonly tool: {
    readonly name: string
  }
}

export interface ResolvedMcpConversationTool<
  TServer extends McpConversationContextServer = McpConversationContextServer,
> {
  readonly server: TServer
  readonly tool: TServer['tools'][number]
}

export interface McpConversationContextDisabledTracePlan {
  readonly kind: 'disabled'
  readonly idPrefix: 'mcp-disabled'
  readonly type: 'tool'
  readonly status: 'skipped'
  readonly startedAt: number
}

export interface McpConversationContextEmptyTracePlan {
  readonly kind: 'empty'
  readonly idPrefix: 'mcp-empty'
  readonly type: 'tool'
  readonly status: 'skipped'
  readonly startedAt: number
}

export interface McpConversationContextManifestTracePlan {
  readonly kind: 'manifest'
  readonly idPrefix: 'mcp-manifest'
  readonly type: 'tool'
  readonly status: 'done' | 'skipped'
  readonly startedAt: number
  readonly connectedCount: number
  readonly offlineCount: number
  readonly connectedToolLabels: readonly string[]
  readonly offlineToolLabels: readonly string[]
}

export type McpConversationContextTracePlan =
  | McpConversationContextDisabledTracePlan
  | McpConversationContextEmptyTracePlan
  | McpConversationContextManifestTracePlan

interface McpConversationContextOutcomeBase<
  TServer extends McpConversationContextServer,
> {
  readonly prompt: string
  readonly tools: readonly ResolvedMcpConversationTool<TServer>[]
  readonly selectedTools: readonly ResolvedMcpConversationTool<TServer>[]
}

export interface McpConversationContextDisabled<
  TServer extends McpConversationContextServer,
> extends McpConversationContextOutcomeBase<TServer> {
  readonly kind: 'disabled'
  readonly tracePlan: McpConversationContextDisabledTracePlan
}

export interface McpConversationContextEmpty<
  TServer extends McpConversationContextServer,
> extends McpConversationContextOutcomeBase<TServer> {
  readonly kind: 'empty'
  readonly tracePlan: McpConversationContextEmptyTracePlan
}

export interface McpConversationContextConnected<
  TServer extends McpConversationContextServer,
> extends McpConversationContextOutcomeBase<TServer> {
  readonly kind: 'connected'
  readonly offlineTools: readonly ResolvedMcpConversationTool<TServer>[]
  readonly tracePlan: McpConversationContextManifestTracePlan
}

export interface McpConversationContextOffline<
  TServer extends McpConversationContextServer,
> extends McpConversationContextOutcomeBase<TServer> {
  readonly kind: 'offline'
  readonly offlineTools: readonly ResolvedMcpConversationTool<TServer>[]
  readonly tracePlan: McpConversationContextManifestTracePlan
}

export interface McpConversationContextCancelled<
  TServer extends McpConversationContextServer,
> extends McpConversationContextOutcomeBase<TServer> {
  readonly kind: 'cancelled'
  readonly stage: 'before_server_listing' | 'after_server_listing'
  readonly tracePlan: null
}

export interface McpConversationContextFailed<
  TServer extends McpConversationContextServer,
> extends McpConversationContextOutcomeBase<TServer> {
  readonly kind: 'failed'
  readonly reason: 'server_listing_failed'
  readonly code: 'unknown'
  readonly tracePlan: null
}

export type McpConversationContextOutcome<
  TServer extends McpConversationContextServer,
> =
  | McpConversationContextDisabled<TServer>
  | McpConversationContextEmpty<TServer>
  | McpConversationContextConnected<TServer>
  | McpConversationContextOffline<TServer>
  | McpConversationContextCancelled<TServer>
  | McpConversationContextFailed<TServer>

export interface McpConversationContextInput {
  readonly mcpEnabled: boolean
  readonly enabledTools?: readonly string[]
  readonly skillSnapshot?: {
    readonly enabledTools?: readonly string[]
  }
  readonly toolCallTag: string
  readonly signal: AbortSignal
}

export interface McpConversationContextDependencies<
  TServer extends McpConversationContextServer,
> {
  listServers(options: { readonly signal: AbortSignal }): Promise<readonly TServer[]>
  now(): number
}

export interface McpConversationContextPolicy<
  TServer extends McpConversationContextServer,
> {
  resolve(input: McpConversationContextInput): Promise<McpConversationContextOutcome<TServer>>
}

/** Selects enabled server tools while keeping qualified and unique-bare identity semantics. */
export function collectMcpConversationTools<
  TServer extends McpConversationContextServer,
>(
  servers: readonly TServer[],
  enabledRefs: readonly string[],
): ResolvedMcpConversationTool<TServer>[] {
  const tools: ResolvedMcpConversationTool<TServer>[] = []
  for (const server of servers) {
    if (!server.enabled) continue
    for (const tool of server.tools) {
      if (tool.enabled) tools.push({ server, tool })
    }
  }
  return selectEnabledMcpConversationTools(tools, enabledRefs)
}

export function selectEnabledMcpConversationTools<
  TTool extends McpConversationToolIdentityLike,
>(tools: readonly TTool[], enabledRefs: readonly string[]): TTool[] {
  if (!enabledRefs.length) return [...tools]
  const nameCounts = countMcpConversationToolNames(tools)
  return tools.filter((item) => {
    if (enabledRefs.some((ref) => matchesExplicitMcpConversationToolRef(item, ref))) {
      return true
    }
    return enabledRefs.includes(item.tool.name)
      && (nameCounts.get(item.tool.name) ?? 0) === 1
  })
}

export function resolveMcpConversationToolIdentity<
  TTool extends McpConversationToolIdentityLike,
>(
  tools: readonly TTool[],
  request: { readonly serverId?: string; readonly toolName: string },
): TTool | undefined {
  const explicit = tools.find((item) => matchesRequestedMcpConversationToolRef(item, request))
  if (explicit) return explicit
  if (request.serverId) return undefined
  const matches = tools.filter((item) => item.tool.name === request.toolName)
  return matches.length === 1 ? matches[0] : undefined
}

/** Preserves the existing provider-facing MCP prompt byte-for-byte. */
export function buildMcpConversationContextPrompt<
  TTool extends McpConversationToolIdentityLike & {
    readonly tool: McpConversationToolIdentityLike['tool'] & {
      readonly permission: string
      readonly description?: string
      readonly inputSchema?: Record<string, unknown>
    }
  },
>(connected: readonly TTool[], toolCallTag: string): string {
  if (!connected.length) return ''
  return [
    '当前可用 MCP 工具清单。普通回答不需要调用工具时请直接回答。',
    `如果必须调用工具，请只输出一个 <${toolCallTag}>JSON</${toolCallTag}> 块，不要输出其它正文。`,
    'JSON 格式：{"serverId":"server-id","tool":"tool-name","arguments":{}}。',
    '工具执行后，系统会把工具结果交给你生成最终回复。',
    ...connected.map(({ server, tool }) => (
      `- ${server.id}/${tool.name} (${server.name}) [${tool.permission}]: ${tool.description ?? 'No description'}`
      + (tool.inputSchema
        ? `\n  inputSchema: ${JSON.stringify(tool.inputSchema).slice(0, MCP_CONVERSATION_CONTEXT_SCHEMA_CHAR_LIMIT)}`
        : '')
    )),
  ].join('\n')
}

/** Owns cancellable MCP context admission without localization or trace side effects. */
export function createMcpConversationContextPolicy<
  TServer extends McpConversationContextServer,
>(
  dependencies: McpConversationContextDependencies<TServer>,
): McpConversationContextPolicy<TServer> {
  return Object.freeze({
    async resolve(
      input: McpConversationContextInput,
    ): Promise<McpConversationContextOutcome<TServer>> {
      const startedAt = dependencies.now()
      const emptyTools: readonly ResolvedMcpConversationTool<TServer>[] = []

      if (!input.mcpEnabled) {
        return {
          kind: 'disabled',
          prompt: '',
          tools: emptyTools,
          selectedTools: emptyTools,
          tracePlan: {
            kind: 'disabled',
            idPrefix: 'mcp-disabled',
            type: 'tool',
            status: 'skipped',
            startedAt,
          },
        }
      }
      if (input.signal.aborted) {
        return cancelledContextOutcome(emptyTools, 'before_server_listing')
      }

      let servers: readonly TServer[]
      try {
        servers = await dependencies.listServers({ signal: input.signal })
      } catch {
        if (input.signal.aborted) {
          return cancelledContextOutcome(emptyTools, 'after_server_listing')
        }
        return {
          kind: 'failed',
          reason: 'server_listing_failed',
          code: 'unknown',
          prompt: '',
          tools: emptyTools,
          selectedTools: emptyTools,
          tracePlan: null,
        }
      }
      if (input.signal.aborted) {
        return cancelledContextOutcome(emptyTools, 'after_server_listing')
      }

      const enabledTools = input.enabledTools ?? input.skillSnapshot?.enabledTools ?? []
      const selectedTools = collectMcpConversationTools(servers, enabledTools)
      if (!selectedTools.length) {
        return {
          kind: 'empty',
          prompt: '',
          tools: emptyTools,
          selectedTools,
          tracePlan: {
            kind: 'empty',
            idPrefix: 'mcp-empty',
            type: 'tool',
            status: 'skipped',
            startedAt,
          },
        }
      }

      const connectedTools = selectedTools.filter(({ server }) => server.status === 'connected')
      const offlineTools = selectedTools.filter(({ server }) => server.status !== 'connected')
      const tracePlan: McpConversationContextManifestTracePlan = {
        kind: 'manifest',
        idPrefix: 'mcp-manifest',
        type: 'tool',
        status: connectedTools.length ? 'done' : 'skipped',
        startedAt,
        connectedCount: connectedTools.length,
        offlineCount: offlineTools.length,
        connectedToolLabels: connectedTools.map(({ server, tool }) => `${server.name}/${tool.name}`),
        offlineToolLabels: offlineTools.map(({ server, tool }) => `${server.name}/${tool.name}`),
      }

      if (connectedTools.length) {
        return {
          kind: 'connected',
          prompt: buildMcpConversationContextPrompt(connectedTools, input.toolCallTag),
          tools: connectedTools,
          selectedTools,
          offlineTools,
          tracePlan,
        }
      }
      return {
        kind: 'offline',
        prompt: '',
        tools: connectedTools,
        selectedTools,
        offlineTools,
        tracePlan,
      }
    },
  })
}

function cancelledContextOutcome<
  TServer extends McpConversationContextServer,
>(
  emptyTools: readonly ResolvedMcpConversationTool<TServer>[],
  stage: McpConversationContextCancelled<TServer>['stage'],
): McpConversationContextCancelled<TServer> {
  return {
    kind: 'cancelled',
    stage,
    prompt: '',
    tools: emptyTools,
    selectedTools: emptyTools,
    tracePlan: null,
  }
}

function matchesRequestedMcpConversationToolRef<
  TTool extends McpConversationToolIdentityLike,
>(
  item: TTool,
  request: { readonly serverId?: string; readonly toolName: string },
): boolean {
  if (request.serverId) {
    return (item.server.id === request.serverId || item.server.name === request.serverId)
      && item.tool.name === request.toolName
  }
  return matchesExplicitMcpConversationToolRef(item, request.toolName)
}

function matchesExplicitMcpConversationToolRef<
  TTool extends McpConversationToolIdentityLike,
>(item: TTool, ref: string): boolean {
  return ref === `${item.server.id}:${item.tool.name}`
    || ref === `${item.server.id}/${item.tool.name}`
}

function countMcpConversationToolNames<
  TTool extends McpConversationToolIdentityLike,
>(tools: readonly TTool[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of tools) {
    counts.set(item.tool.name, (counts.get(item.tool.name) ?? 0) + 1)
  }
  return counts
}
