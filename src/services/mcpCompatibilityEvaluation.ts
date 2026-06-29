import type { RuntimeLogOptions } from '@/services/runtimeLog'
import type { RuntimeEventEnvelope } from '@/services/runtimeEvents'
import type { McpConnectionStatus, McpPromptManifest, McpResourceManifest, McpToolManifest, McpToolPermission, ToolContentBlock } from '@/types'

export const MCP_COMPATIBILITY_EVAL_SCHEMA = 'islemind.mcp-compatibility-eval.v1'
export const MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA = 'islemind.mcp-compatibility-runtime-summary.v1'
export const MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT = 12
export const MCP_COMPATIBILITY_FIXTURE_IDS = [
  'github-mcp',
  'playwright-mcp',
  'context7-resources',
  'malformed-schema-response',
  'websocket-transport-failure',
  'destructive-permission-refusal',
] as const
export const MCP_COMPATIBILITY_METHODS = ['initialize', 'tools/list', 'resources/list', 'prompts/list', 'tools/call'] as const

export type McpCompatibilityFixtureId = typeof MCP_COMPATIBILITY_FIXTURE_IDS[number]
export type McpCompatibilityMethod = typeof MCP_COMPATIBILITY_METHODS[number]
export type McpCompatibilityRefreshResult = 'connected' | 'connected-with-warnings' | 'error'
export type McpCompatibilityFailureCode = 'malformed_schema' | 'unsupported_transport' | 'permission_required' | 'tool_unavailable' | 'execution_failed'

export interface McpCompatibilityMethodCount {
  attempted: number
  itemCount: number
}

export type McpCompatibilityMethodCounts = Record<McpCompatibilityMethod, McpCompatibilityMethodCount>

export interface McpCompatibilityToolCallFixture {
  toolName: string
  arguments: Record<string, unknown>
  approved?: boolean
  response?: unknown
}

export interface McpCompatibilityToolCallDiagnostic {
  toolName: string
  attempted: boolean
  approved: boolean
  refused: boolean
  networkAttempted: boolean
  status: 'done' | 'skipped' | 'error'
  failureCode?: McpCompatibilityFailureCode
  contentBlockCount: number
}

export interface McpCompatibilityFixture {
  id: McpCompatibilityFixtureId | string
  serverId: string
  serverName: string
  serverSource: string
  url: string
  transport: 'sse' | 'websocket'
  enabled?: boolean
  enabledToolNames?: string[]
  responses?: Partial<Record<Exclude<McpCompatibilityMethod, 'tools/call'>, unknown>>
  toolCall?: McpCompatibilityToolCallFixture
}

export interface McpCompatibilityDiagnostic {
  fixtureId: string
  serverId: string
  serverName: string
  serverSource: string
  transport: 'sse' | 'websocket'
  status: McpConnectionStatus
  refreshResult: McpCompatibilityRefreshResult
  version?: string
  methodCounts: McpCompatibilityMethodCounts
  lastRefreshAt: number
  toolCount: number
  resourceCount: number
  promptCount: number
  invalidManifestItemCount: number
  permissionCounts: Record<McpToolPermission, number>
  failureCode?: McpCompatibilityFailureCode
  tools: McpToolManifest[]
  resources: McpResourceManifest[]
  prompts: McpPromptManifest[]
  toolCall?: McpCompatibilityToolCallDiagnostic
}

export interface McpCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredMethodCoverage: McpCompatibilityMethod[]
}

export interface McpCompatibilityEvaluationRun {
  schema: typeof MCP_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: McpCompatibilityDiagnostic[]
  qualityGate: McpCompatibilityQualityGate
}

export interface McpCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: McpCompatibilityFixture[]
  requiredFixtureIds?: string[]
}

export interface McpCompatibilityRuntimeServerSummary {
  fixtureId: string
  serverId: string
  serverSource: string
  transport: McpCompatibilityFixture['transport']
  status: McpConnectionStatus
  refreshResult: McpCompatibilityRefreshResult
  toolCount: number
  resourceCount: number
  promptCount: number
  invalidManifestItemCount: number
  failureCode?: McpCompatibilityFailureCode
  permissionCounts: Record<McpToolPermission, number>
  toolCall?: {
    status: McpCompatibilityToolCallDiagnostic['status']
    refused: boolean
    approved: boolean
    networkAttempted: boolean
    failureCode?: McpCompatibilityFailureCode
    contentBlockCount: number
  }
}

export interface McpCompatibilityRuntimeSummary {
  schema: typeof MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA
  evaluationSchema: typeof MCP_COMPATIBILITY_EVAL_SCHEMA
  evaluationId: string
  status: 'done'
  ranAt: number
  serverCount: number
  serverLimit: number
  serverLimitApplied: boolean
  connectedCount: number
  warningCount: number
  errorCount: number
  toolCount: number
  resourceCount: number
  promptCount: number
  invalidManifestItemCount: number
  destructivePermissionCount: number
  refusedToolCallCount: number
  networkAttemptedToolCallCount: number
  failureCodes: McpCompatibilityFailureCode[]
  failureCounts: Record<McpCompatibilityFailureCode, number>
  methodCoverage: McpCompatibilityMethodCounts
  qualityGate: {
    passed: boolean
    failureCount: number
    requiredFixtureCount: number
    requiredMethodCoverage: McpCompatibilityMethod[]
  }
  qualityGatePassed: boolean
  servers: McpCompatibilityRuntimeServerSummary[]
}

export const MCP_COMPATIBILITY_FIXTURES: McpCompatibilityFixture[] = [
  {
    id: 'github-mcp',
    serverId: 'github',
    serverName: 'GitHub MCP',
    serverSource: 'github/github-mcp-server',
    url: 'https://mcp.github.example.test',
    transport: 'sse',
    enabledToolNames: ['search_repositories', 'create_issue', 'delete_repository'],
    responses: {
      initialize: {
        serverInfo: { name: 'github-mcp-server', version: '0.9.0' },
      },
      'tools/list': {
        tools: [
          {
            name: 'search_repositories',
            description: 'Search GitHub repositories, issues, and pull requests.',
            inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          },
          {
            name: 'create_issue',
            description: 'Create a GitHub issue in a repository.',
            inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' } } },
          },
          {
            name: 'delete_repository',
            description: 'Delete a repository after explicit approval.',
            inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } } },
          },
        ],
      },
      'resources/list': {
        resources: [
          { uri: 'github://repos/islemind/islemind', name: 'Repository', mimeType: 'application/json' },
          { uri: 'github://issues/islemind/islemind/42', name: 'Issue 42', mimeType: 'application/json' },
        ],
      },
      'prompts/list': {
        prompts: [
          { name: 'triage_issue', description: 'Summarize and triage a GitHub issue.', arguments: [{ name: 'issueUrl', required: true }] },
        ],
      },
    },
  },
  {
    id: 'playwright-mcp',
    serverId: 'playwright',
    serverName: 'Playwright MCP',
    serverSource: 'microsoft/playwright-mcp',
    url: 'https://mcp.playwright.example.test',
    transport: 'sse',
    enabledToolNames: ['browser_navigate', 'browser_click', 'browser_take_screenshot'],
    responses: {
      initialize: {
        serverInfo: { name: 'playwright-mcp', version: '0.0.32' },
      },
      'tools/list': {
        tools: [
          {
            name: 'browser_navigate',
            description: 'Navigate the controlled browser page to a URL.',
            inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
          },
          {
            name: 'browser_click',
            description: 'Click an element on the controlled browser page.',
            inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
          },
          {
            name: 'browser_take_screenshot',
            description: 'Read the current browser page as a screenshot artifact.',
            inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' } } },
          },
        ],
      },
      'resources/list': {
        resources: [
          { uri: 'playwright://page/current', name: 'Current page state', mimeType: 'application/json' },
        ],
      },
      'prompts/list': {
        prompts: [
          { name: 'inspect_page', description: 'Inspect the current browser page before acting.' },
        ],
      },
    },
  },
  {
    id: 'context7-resources',
    serverId: 'context7',
    serverName: 'context7',
    serverSource: 'upstash/context7',
    url: 'https://mcp.context7.example.test',
    transport: 'sse',
    enabledToolNames: ['resolve-library-id', 'get-library-docs'],
    responses: {
      initialize: {
        serverInfo: { name: 'context7', version: '1.2.0' },
      },
      'tools/list': {
        tools: [
          {
            name: 'resolve-library-id',
            description: 'Resolve a package or framework name into a context7 library id.',
            inputSchema: { type: 'object', properties: { libraryName: { type: 'string' } }, required: ['libraryName'] },
          },
          {
            name: 'get-library-docs',
            description: 'Read documentation snippets for a resolved library id.',
            inputSchema: { type: 'object', properties: { context7CompatibleLibraryID: { type: 'string' }, topic: { type: 'string' } } },
          },
        ],
      },
      'resources/list': {
        resources: [
          { uri: 'context7://libraries/react', name: 'React documentation', mimeType: 'text/markdown' },
          { uri: 'context7://libraries/expo', name: 'Expo documentation', mimeType: 'text/markdown' },
        ],
      },
      'prompts/list': {
        prompts: [
          { name: 'library_docs_query', description: 'Ask for version-scoped library docs.', arguments: [{ name: 'topic' }] },
        ],
      },
    },
  },
  {
    id: 'malformed-schema-response',
    serverId: 'malformed',
    serverName: 'Malformed MCP',
    serverSource: 'fixture/malformed-schema',
    url: 'https://mcp.malformed.example.test',
    transport: 'sse',
    enabledToolNames: ['valid_read'],
    responses: {
      initialize: {
        serverInfo: { name: 'malformed-schema-fixture', version: 'broken' },
      },
      'tools/list': {
        tools: [
          { name: 'valid_read', description: 'Read a valid fixture entry.', inputSchema: { type: 'object' } },
          { description: 'Missing name should be dropped.' },
          { name: 42, description: 'Non-string name should be dropped.' },
        ],
      },
      'resources/list': {
        resources: [
          { uri: 'fixture://valid-resource', name: 'Valid resource' },
          { name: 'Missing URI should be dropped.' },
        ],
      },
      'prompts/list': {
        prompts: [
          { name: 'valid_prompt', description: 'A valid prompt entry.' },
          { title: 'Missing prompt name should be dropped.' },
        ],
      },
    },
  },
  {
    id: 'websocket-transport-failure',
    serverId: 'websocket-only',
    serverName: 'WebSocket MCP',
    serverSource: 'fixture/unsupported-websocket-transport',
    url: 'wss://mcp.websocket.example.test',
    transport: 'websocket',
    responses: {
      initialize: {
        serverInfo: { name: 'websocket-fixture', version: '1.0.0' },
      },
    },
  },
  {
    id: 'destructive-permission-refusal',
    serverId: 'danger-zone',
    serverName: 'Permission Refusal MCP',
    serverSource: 'fixture/destructive-tool-policy',
    url: 'https://mcp.permission.example.test',
    transport: 'sse',
    enabledToolNames: ['delete_workspace'],
    responses: {
      initialize: {
        serverInfo: { name: 'permission-fixture', version: '1.0.0' },
      },
      'tools/list': {
        tools: [
          {
            name: 'delete_workspace',
            description: 'Delete the entire remote workspace.',
            inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } }, required: ['workspaceId'] },
          },
        ],
      },
      'resources/list': { resources: [] },
      'prompts/list': { prompts: [] },
    },
    toolCall: {
      toolName: 'delete_workspace',
      arguments: { workspaceId: 'workspace-123' },
      approved: false,
    },
  },
]

export function runMcpCompatibilityEvaluation(options: McpCompatibilityEvaluationOptions = {}): McpCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? MCP_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map((fixture) => evaluateMcpCompatibilityFixture(fixture, ranAt))
  return {
    schema: MCP_COMPATIBILITY_EVAL_SCHEMA,
    id: `mcp-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateMcpCompatibilityQualityGate(diagnostics, options.requiredFixtureIds ?? [...MCP_COMPATIBILITY_FIXTURE_IDS]),
  }
}

export function buildMcpCompatibilityRuntimeSummary(run: McpCompatibilityEvaluationRun): McpCompatibilityRuntimeSummary {
  const failureCounts = emptyFailureCounts()
  const methodCoverage = createMethodCounts()
  const totals = {
    connectedCount: 0,
    warningCount: 0,
    errorCount: 0,
    toolCount: 0,
    resourceCount: 0,
    promptCount: 0,
    invalidManifestItemCount: 0,
    destructivePermissionCount: 0,
    refusedToolCallCount: 0,
    networkAttemptedToolCallCount: 0,
  }

  for (const diagnostic of run.diagnostics) {
    if (diagnostic.refreshResult === 'error' || diagnostic.status === 'error') totals.errorCount += 1
    else if (diagnostic.refreshResult === 'connected-with-warnings' || diagnostic.failureCode) totals.warningCount += 1
    if (diagnostic.status === 'connected') totals.connectedCount += 1
    totals.toolCount += diagnostic.toolCount
    totals.resourceCount += diagnostic.resourceCount
    totals.promptCount += diagnostic.promptCount
    totals.invalidManifestItemCount += diagnostic.invalidManifestItemCount
    totals.destructivePermissionCount += diagnostic.permissionCounts.destructive
    if (diagnostic.toolCall?.refused === true) totals.refusedToolCallCount += 1
    if (diagnostic.toolCall?.networkAttempted === true) totals.networkAttemptedToolCallCount += 1
    if (diagnostic.failureCode) failureCounts[diagnostic.failureCode] += 1
    for (const method of MCP_COMPATIBILITY_METHODS) {
      methodCoverage[method].attempted += diagnostic.methodCounts[method].attempted
      methodCoverage[method].itemCount += diagnostic.methodCounts[method].itemCount
    }
  }

  return {
    schema: MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA,
    evaluationSchema: run.schema,
    evaluationId: run.id,
    status: 'done',
    ranAt: run.ranAt,
    serverCount: run.diagnostics.length,
    serverLimit: MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT,
    serverLimitApplied: run.diagnostics.length > MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT,
    ...totals,
    failureCodes: Object.entries(failureCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code]) => code as McpCompatibilityFailureCode),
    failureCounts,
    methodCoverage,
    qualityGate: {
      passed: run.qualityGate.passed,
      failureCount: run.qualityGate.failures.length,
      requiredFixtureCount: run.qualityGate.requiredFixtureIds.length,
      requiredMethodCoverage: [...run.qualityGate.requiredMethodCoverage],
    },
    qualityGatePassed: run.qualityGate.passed,
    servers: run.diagnostics.slice(0, MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT).map((diagnostic) => ({
      fixtureId: diagnostic.fixtureId,
      serverId: diagnostic.serverId,
      serverSource: diagnostic.serverSource,
      transport: diagnostic.transport,
      status: diagnostic.status,
      refreshResult: diagnostic.refreshResult,
      toolCount: diagnostic.toolCount,
      resourceCount: diagnostic.resourceCount,
      promptCount: diagnostic.promptCount,
      invalidManifestItemCount: diagnostic.invalidManifestItemCount,
      failureCode: diagnostic.failureCode,
      permissionCounts: { ...diagnostic.permissionCounts },
      toolCall: diagnostic.toolCall ? {
        status: diagnostic.toolCall.status,
        refused: diagnostic.toolCall.refused,
        approved: diagnostic.toolCall.approved,
        networkAttempted: diagnostic.toolCall.networkAttempted,
        failureCode: diagnostic.toolCall.failureCode,
        contentBlockCount: diagnostic.toolCall.contentBlockCount,
      } : undefined,
    })),
  }
}

export async function emitMcpCompatibilityRuntimeSummaryEvent(
  run: McpCompatibilityEvaluationRun,
  trigger = 'diagnostics-refresh',
  options?: RuntimeLogOptions
): Promise<RuntimeEventEnvelope> {
  const summary = buildMcpCompatibilityRuntimeSummary(run)
  const { emitRuntimeEvent } = await import('@/services/runtimeEvents')
  return emitRuntimeEvent({
    event: 'tool.mcp.compatibility.checked',
    data: {
      trigger,
      ...summary,
    },
    legacyData: {
      trigger,
      schema: summary.schema,
      evaluationId: summary.evaluationId,
      serverCount: summary.serverCount,
      connectedCount: summary.connectedCount,
      warningCount: summary.warningCount,
      errorCount: summary.errorCount,
      failureCodes: summary.failureCodes,
      qualityGatePassed: summary.qualityGatePassed,
    },
    options,
  })
}

export function evaluateMcpCompatibilityFixture(fixture: McpCompatibilityFixture, now = Date.now()): McpCompatibilityDiagnostic {
  const methodCounts = createMethodCounts()
  const base = {
    fixtureId: fixture.id,
    serverId: fixture.serverId,
    serverName: fixture.serverName,
    serverSource: fixture.serverSource,
    transport: fixture.transport,
    methodCounts,
    lastRefreshAt: now,
  }

  if (fixture.transport !== 'sse') {
    return {
      ...base,
      status: 'error',
      refreshResult: 'error',
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      invalidManifestItemCount: 0,
      permissionCounts: emptyPermissionCounts(),
      failureCode: 'unsupported_transport',
      tools: [],
      resources: [],
      prompts: [],
    }
  }

  const toolList = readListResponse(fixture.responses?.['tools/list'], 'tools')
  const resourceList = readListResponse(fixture.responses?.['resources/list'], 'resources')
  const promptList = readListResponse(fixture.responses?.['prompts/list'], 'prompts')
  const version = readServerVersion(fixture.responses?.initialize)
  methodCounts['tools/list'] = { attempted: 1, itemCount: toolList.items.length }
  methodCounts['resources/list'] = { attempted: 1, itemCount: resourceList.items.length }
  methodCounts['prompts/list'] = { attempted: 1, itemCount: promptList.items.length }
  methodCounts.initialize = { attempted: 1, itemCount: version ? 1 : 0 }

  const enabledToolNames = new Set(fixture.enabledToolNames ?? [])
  const tools = normalizeTools(toolList.items, fixture.serverId, enabledToolNames)
  const resources = normalizeResources(resourceList.items, fixture.serverId)
  const prompts = normalizePrompts(promptList.items, fixture.serverId)
  const invalidManifestItemCount = [
    toolList.invalidContainerCount,
    resourceList.invalidContainerCount,
    promptList.invalidContainerCount,
    tools.invalidCount,
    resources.invalidCount,
    prompts.invalidCount,
  ].reduce((sum, value) => sum + value, 0)
  const toolCall = fixture.toolCall ? simulateToolCall(fixture.toolCall, tools.items, methodCounts) : undefined
  const failureCode = toolCall?.failureCode ?? (invalidManifestItemCount > 0 ? 'malformed_schema' : undefined)

  return {
    ...base,
    status: 'connected',
    refreshResult: invalidManifestItemCount > 0 ? 'connected-with-warnings' : 'connected',
    version,
    toolCount: tools.items.length,
    resourceCount: resources.items.length,
    promptCount: prompts.items.length,
    invalidManifestItemCount,
    permissionCounts: countPermissions(tools.items),
    failureCode,
    tools: tools.items,
    resources: resources.items,
    prompts: prompts.items,
    toolCall,
  }
}

export function evaluateMcpCompatibilityQualityGate(
  diagnostics: McpCompatibilityDiagnostic[],
  requiredFixtureIds: string[] = [...MCP_COMPATIBILITY_FIXTURE_IDS]
): McpCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }

  const requiredMethodCoverage: McpCompatibilityMethod[] = [...MCP_COMPATIBILITY_METHODS]
  for (const item of diagnostics) {
    if (!item.lastRefreshAt) failures.push(`${item.fixtureId}:missing-last-refresh`)
    for (const method of requiredMethodCoverage) {
      if (!item.methodCounts[method]) failures.push(`${item.fixtureId}:missing-method-count:${method}`)
    }
  }

  requireConnected(byId.get('github-mcp'), failures, { minTools: 3, minResources: 2, minPrompts: 1 })
  if ((byId.get('github-mcp')?.permissionCounts.destructive ?? 0) < 1) failures.push('github-mcp:missing-destructive-permission')
  requireConnected(byId.get('playwright-mcp'), failures, { minTools: 3, minResources: 1, minPrompts: 1 })
  requireConnected(byId.get('context7-resources'), failures, { minTools: 2, minResources: 2, minPrompts: 1 })

  const malformed = byId.get('malformed-schema-response')
  if (malformed?.failureCode !== 'malformed_schema') failures.push('malformed-schema-response:missing-malformed-schema-code')
  if ((malformed?.invalidManifestItemCount ?? 0) < 3) failures.push('malformed-schema-response:invalid-items-not-counted')
  if ((malformed?.tools.some((tool) => !tool.name) ?? false) || (malformed?.resources.some((resource) => !resource.uri) ?? false)) {
    failures.push('malformed-schema-response:invalid-items-leaked')
  }

  const transportFailure = byId.get('websocket-transport-failure')
  if (transportFailure?.refreshResult !== 'error') failures.push('websocket-transport-failure:refresh-not-error')
  if (transportFailure?.failureCode !== 'unsupported_transport') failures.push('websocket-transport-failure:missing-unsupported-transport-code')

  const refusal = byId.get('destructive-permission-refusal')
  if (refusal?.toolCall?.refused !== true) failures.push('destructive-permission-refusal:not-refused')
  if (refusal?.toolCall?.networkAttempted !== false) failures.push('destructive-permission-refusal:network-attempted')
  if (refusal?.toolCall?.failureCode !== 'permission_required') failures.push('destructive-permission-refusal:missing-permission-code')
  if ((refusal?.methodCounts['tools/call'].attempted ?? 0) < 1) failures.push('destructive-permission-refusal:missing-tool-call-method-count')

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredMethodCoverage,
  }
}

function requireConnected(
  diagnostic: McpCompatibilityDiagnostic | undefined,
  failures: string[],
  required: { minTools: number; minResources: number; minPrompts: number }
): void {
  if (!diagnostic) return
  if (diagnostic.refreshResult === 'error') failures.push(`${diagnostic.fixtureId}:refresh-error`)
  if (diagnostic.toolCount < required.minTools) failures.push(`${diagnostic.fixtureId}:tool-count`)
  if (diagnostic.resourceCount < required.minResources) failures.push(`${diagnostic.fixtureId}:resource-count`)
  if (diagnostic.promptCount < required.minPrompts) failures.push(`${diagnostic.fixtureId}:prompt-count`)
  for (const method of ['initialize', 'tools/list', 'resources/list', 'prompts/list'] as const) {
    if (diagnostic.methodCounts[method].attempted < 1) failures.push(`${diagnostic.fixtureId}:method-not-attempted:${method}`)
  }
}

function createMethodCounts(): McpCompatibilityMethodCounts {
  return {
    initialize: { attempted: 0, itemCount: 0 },
    'tools/list': { attempted: 0, itemCount: 0 },
    'resources/list': { attempted: 0, itemCount: 0 },
    'prompts/list': { attempted: 0, itemCount: 0 },
    'tools/call': { attempted: 0, itemCount: 0 },
  }
}

function emptyFailureCounts(): Record<McpCompatibilityFailureCode, number> {
  return {
    malformed_schema: 0,
    unsupported_transport: 0,
    permission_required: 0,
    tool_unavailable: 0,
    execution_failed: 0,
  }
}

function emptyPermissionCounts(): Record<McpToolPermission, number> {
  return { 'read-only': 0, 'read-write': 0, destructive: 0 }
}

function countPermissions(tools: McpToolManifest[]): Record<McpToolPermission, number> {
  return tools.reduce((counts, tool) => {
    counts[tool.permission] += 1
    return counts
  }, emptyPermissionCounts())
}

function readListResponse(response: unknown, key: 'tools' | 'resources' | 'prompts'): { items: unknown[]; invalidContainerCount: number } {
  if (!response || typeof response !== 'object') return { items: [], invalidContainerCount: 0 }
  const items = (response as Record<string, unknown>)[key]
  return Array.isArray(items) ? { items, invalidContainerCount: 0 } : { items: [], invalidContainerCount: 1 }
}

function readServerVersion(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined
  const serverInfo = (response as Record<string, unknown>).serverInfo
  if (!serverInfo || typeof serverInfo !== 'object') return undefined
  const version = (serverInfo as Record<string, unknown>).version
  return typeof version === 'string' ? version : undefined
}

function normalizeTools(items: unknown[], serverId: string, enabledToolNames: Set<string>): { items: McpToolManifest[]; invalidCount: number } {
  let invalidCount = 0
  const tools = items.map((item): McpToolManifest | null => {
    if (!item || typeof item !== 'object') {
      invalidCount += 1
      return null
    }
    const value = item as Record<string, unknown>
    if (typeof value.name !== 'string') {
      invalidCount += 1
      return null
    }
    return {
      name: value.name,
      description: typeof value.description === 'string' ? value.description : undefined,
      inputSchema: value.inputSchema && typeof value.inputSchema === 'object' ? value.inputSchema as Record<string, unknown> : undefined,
      permission: inferPermission(value.name, value.description),
      serverId,
      enabled: enabledToolNames.has(value.name),
    }
  }).filter((item): item is McpToolManifest => !!item)
  return { items: tools, invalidCount }
}

function normalizeResources(items: unknown[], serverId: string): { items: McpResourceManifest[]; invalidCount: number } {
  let invalidCount = 0
  const resources = items.map((item): McpResourceManifest | null => {
    if (!item || typeof item !== 'object') {
      invalidCount += 1
      return null
    }
    const value = item as Record<string, unknown>
    if (typeof value.uri !== 'string') {
      invalidCount += 1
      return null
    }
    return {
      uri: value.uri,
      name: typeof value.name === 'string' ? value.name : undefined,
      description: typeof value.description === 'string' ? value.description : undefined,
      mimeType: typeof value.mimeType === 'string' ? value.mimeType : undefined,
      serverId,
    }
  }).filter((item): item is McpResourceManifest => !!item)
  return { items: resources, invalidCount }
}

function normalizePrompts(items: unknown[], serverId: string): { items: McpPromptManifest[]; invalidCount: number } {
  let invalidCount = 0
  const prompts = items.map((item): McpPromptManifest | null => {
    if (!item || typeof item !== 'object') {
      invalidCount += 1
      return null
    }
    const value = item as Record<string, unknown>
    if (typeof value.name !== 'string') {
      invalidCount += 1
      return null
    }
    return {
      name: value.name,
      description: typeof value.description === 'string' ? value.description : undefined,
      arguments: Array.isArray(value.arguments) ? value.arguments as Record<string, unknown>[] : undefined,
      serverId,
    }
  }).filter((item): item is McpPromptManifest => !!item)
  return { items: prompts, invalidCount }
}

function simulateToolCall(
  fixture: McpCompatibilityToolCallFixture,
  tools: McpToolManifest[],
  methodCounts: McpCompatibilityMethodCounts
): McpCompatibilityToolCallDiagnostic {
  methodCounts['tools/call'].attempted = 1
  const tool = tools.find((item) => item.name === fixture.toolName)
  if (!tool || !tool.enabled) {
    return {
      toolName: fixture.toolName,
      attempted: true,
      approved: false,
      refused: true,
      networkAttempted: false,
      status: 'skipped',
      failureCode: 'tool_unavailable',
      contentBlockCount: 0,
    }
  }
  if (tool.permission === 'destructive' && fixture.approved !== true) {
    return {
      toolName: fixture.toolName,
      attempted: true,
      approved: false,
      refused: true,
      networkAttempted: false,
      status: 'skipped',
      failureCode: 'permission_required',
      contentBlockCount: 0,
    }
  }
  const blocks = normalizeContentBlocks(fixture.response ?? [{ type: 'text', text: 'ok' }])
  methodCounts['tools/call'].itemCount = blocks.length
  return {
    toolName: fixture.toolName,
    attempted: true,
    approved: fixture.approved === true,
    refused: false,
    networkAttempted: true,
    status: 'done',
    contentBlockCount: blocks.length,
  }
}

function normalizeContentBlocks(value: unknown): ToolContentBlock[] {
  if (!Array.isArray(value)) return typeof value === 'string' ? [{ type: 'text', text: value }] : []
  return value.map((item): ToolContentBlock | null => {
    if (typeof item === 'string') return { type: 'text', text: item }
    if (!item || typeof item !== 'object') return null
    const block = item as Record<string, unknown>
    if (block.type === 'image') return { type: 'image', data: String(block.data ?? ''), mimeType: typeof block.mimeType === 'string' ? block.mimeType : undefined }
    if (block.type === 'resource') return { type: 'resource', uri: typeof block.uri === 'string' ? block.uri : undefined, text: typeof block.text === 'string' ? block.text : undefined, mimeType: typeof block.mimeType === 'string' ? block.mimeType : undefined }
    return { type: 'text', text: typeof block.text === 'string' ? block.text : JSON.stringify(block) }
  }).filter((item): item is ToolContentBlock => !!item)
}

function inferPermission(name: unknown, description: unknown): McpToolPermission {
  const text = `${String(name ?? '')} ${String(description ?? '')}`.toLowerCase()
  if (/(delete|remove|shell|exec|write_file|rm|drop|destroy|destructive)/.test(text)) return 'destructive'
  if (/(write|create|update|edit|post|upload|save|click|fill|navigate|press|select|type)/.test(text)) return 'read-write'
  return 'read-only'
}
