const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const mcpCatalogPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/mcpCatalogPolicy.ts'), 'utf8')
const mcpClientAdapterSource = fs.readFileSync(path.join(root, 'src/modules/integrations/mcpClientAdapter.ts'), 'utf8')
const mcpExecutionPolicySource = fs.readFileSync(path.join(root, 'src/modules/integrations/mcpExecutionApplicationPolicy.ts'), 'utf8')
const mcpCatalogBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/mcpCatalog.ts'), 'utf8')
const mcpExecutionBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/mcpExecutionRuntime.ts'), 'utf8')
const builtInWorkspaceFileBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/builtInWorkspaceFileRuntime.ts'), 'utf8')
const androidTrustedWebFetchBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/androidTrustedWebFetch.ts'), 'utf8')
const androidTrustedWebFetchNativeSource = fs.readFileSync(path.join(root, 'plugins/android-trusted-web-fetch/AndroidTrustedWebFetchModule.kt'), 'utf8')
const appConfigSource = fs.readFileSync(path.join(root, 'app.json'), 'utf8')
let conversationMcpBootstrapFakes = null
let conversationMcpContextBootstrapFakes = null

registerTypeScriptSupport()

Module._load = function loadWithMcpCatalogFakes(request, parent, isMain) {
  if (request === 'expo-crypto') {
    return {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      CryptoEncoding: { HEX: 'hex' },
      digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value).digest('hex'),
    }
  }
  if (request === 'expo-sqlite') {
    return {
      openDatabaseAsync: async () => {
        throw new Error('expo-sqlite is unavailable in the Node MCP compatibility harness')
      },
    }
  }
  if (conversationMcpContextBootstrapFakes && request === '@/bootstrap/mcpCatalog') {
    return { listMcpServers: conversationMcpContextBootstrapFakes.listMcpServers }
  }
  if (conversationMcpBootstrapFakes) {
    const fakes = conversationMcpBootstrapFakes
    if (request === '@/modules/assistant-runtime') return {
      createAssistantMcpToolTurnRuntime,
      createAssistantConversationProviderStreamingRuntime: () => ({
        async start() {
          throw new Error('Primary provider streaming is outside the MCP compatibility harness.')
        },
      }),
      createAssistantStreamProjectionPolicy: (dependencies) => ({
        start(identity) {
          return {
            pushText(text) {
              if (text) dependencies.appendContent({ ...identity, text })
            },
            pushTrace(trace) {
              dependencies.upsertTrace({ ...identity, trace })
            },
            flush() {},
          }
        },
      }),
    }
    if (request === '@/bootstrap/workflowToolCallTrace') return { buildWorkflowToolCallTraceMetadata: (input) => input }
    if (request === '@/bootstrap/workflowSearchToolAdmission') return { shouldExposeLocalSearchTool: () => true }
    if (request === '@/bootstrap/taskBoundToolRuntime') return {
      executeExternalTaskBoundTool: (...args) => fakes.executeTask(...args),
    }
    if (request === '@/bootstrap/workflowPendingAction') return {
      buildPendingAction: (...args) => fakes.buildPendingAction(...args),
      formatPendingActionOutput: (...args) => fakes.formatPendingActionOutput(...args),
    }
    if (request === '@/bootstrap/mcpExecutionRuntime') return { truncateToolBlocks: (blocks) => blocks }
    if (request === '@/bootstrap/providerConversationGeneration') return { resolveConversationGenerationParameterRequest: fakes.resolveGenerationParameters }
    if (request === '@/bootstrap/providerRuntime') return { streamProviderChat: fakes.streamProviderChat }
    if (request === '@/modules/tasks') return { resolveWorkflowRunLimitsFromSettings: () => fakes.limits }
    if (request === '@/services/chatMcpRevisionUtils') return {
      buildMcpToolRevisionMessages: (input) => [{ role: 'assistant', content: input.toolOutput }],
      buildMcpToolRevisionSystemPrompt: (systemPrompt) => `${systemPrompt}\nMCP revision`,
    }
    if (request === '@/services/chatTraceUtils') return {
      completeTrace: (trace) => ({ ...trace, completedAt: 2000 }),
      sanitizeTrace: fakes.sanitizeTrace,
    }
    if (request === '@/services/chatToolResultUtils') return {
      findMcpTool: (tools) => tools[0],
      formatToolBlocks: (blocks) => blocks.map((block) => block.text ?? '').join('\n'),
      sanitizeToolRevisionAnswerText: (text) => text.trim(),
    }
    if (request === '@/store/chatStore') return { useChatStore: { getState: () => fakes.chatStore } }
    if (request === '@/store/chatStreamingStore') return { useChatStreamingStore: { getState: () => fakes.streamingStore } }
    if (request === '@/store/settingsStore') return { useSettingsStore: { getState: () => ({ settings: fakes.settings }) } }
    if (request === '@/utils/providerModels') return { resolveProviderModelAlias: (_provider, model) => model }
  }
  if (request === '@/i18n/service') return { st: (key) => key }
  if (request === '@/services/runtimeHealthLog') return { logMcpOperation: async () => {} }
  return originalLoad.call(this, request, parent, isMain)
}

const {
  MCP_COMPATIBILITY_EVAL_SCHEMA,
  MCP_COMPATIBILITY_FIXTURE_IDS,
  MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT,
  MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA,
  buildMcpCompatibilityRuntimeSummary,
  runMcpCompatibilityEvaluation,
} = require('../src/modules/integrations/testing/mcpCompatibilityEvaluation.ts')
const {
  BUILT_IN_CAPABILITY_SERVER_ID,
  BUILT_IN_CAPABILITY_TOOL_NAMES,
  MCP_TOOL_CALL_TAG,
  MCP_TOOL_REQUEST_LIMITS,
  buildMcpConversationContextPrompt,
  collectMcpConversationTools,
  createBuiltInCapabilityToolManifests,
  createMcpConversationContextPolicy,
  createMcpCatalogPolicy,
  createMcpExecutionApplicationPolicy,
  mergeBuiltInCapabilityToolDescriptors,
  getBuiltInCapabilityToolPolicy,
  inferMcpToolPermission,
  listApplicationBuiltInToolDescriptors,
  listRunnableBuiltInCapabilityToolNames,
  normalizeWorkspaceRelativePath,
  parseMcpToolRequest,
  resolveMcpConversationToolIdentity,
} = require('../src/modules/integrations/index.ts')
const {
  createBuiltInCapabilityRuntimeBinding,
  createBuiltInCapabilityTaskAdmissionPort,
} = require('../src/bootstrap/builtInCapabilityRuntime.ts')
const { createKnowledgeWorkspaceFileReadPort } = require('../src/bootstrap/knowledgeWorkspaceFileReadPort.ts')
const {
  createAssistantMcpToolTurnRuntime,
} = require('../src/modules/assistant-runtime/application/assistantMcpToolTurnRuntime.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isMcpCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isMcpCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertMethodEnvelope(item) {
  for (const method of ['initialize', 'tools/list', 'resources/list', 'prompts/list', 'tools/call']) {
    assert.equal(typeof item.methodCounts[method]?.attempted, 'number', `${item.fixtureId} records attempted count for ${method}`)
    assert.equal(typeof item.methodCounts[method]?.itemCount, 'number', `${item.fixtureId} records item count for ${method}`)
  }
  assert.ok(item.lastRefreshAt > 0, `${item.fixtureId} records last refresh time`)
}

function withMcpCatalogPolicyPorts(dependencies) {
  return {
    normalizeServerUrl: (server) => server.url,
    isAllowedServerUrl: (server) => server.id === 'builtin' || /^https?:\/\//.test(server.url),
    explicitHttpOnlyErrorText: () => 'Only explicit HTTP MCP endpoints are allowed.',
    logOperation: async () => {},
    ...dependencies,
  }
}

function createMcpContextServers() {
  return [
    {
      id: 'github',
      name: 'GitHub',
      enabled: true,
      status: 'connected',
      tools: [
        {
          name: 'search',
          enabled: true,
          permission: 'read-only',
          description: 'Search issues',
          inputSchema: { type: 'object', description: 'x'.repeat(700) },
        },
        { name: 'disabled', enabled: false, permission: 'read-only' },
      ],
    },
    {
      id: 'playwright',
      name: 'Playwright',
      enabled: true,
      status: 'disconnected',
      tools: [{ name: 'browser.goto', enabled: true, permission: 'read-write', description: 'Open page' }],
    },
    {
      id: 'gitlab',
      name: 'GitLab',
      enabled: true,
      status: 'connected',
      tools: [{ name: 'search', enabled: true, permission: 'read-only', description: 'Search merge requests' }],
    },
  ]
}

async function runMcpConversationContextPolicyTests() {
  const servers = createMcpContextServers()
  const before = JSON.stringify(servers)
  const selected = collectMcpConversationTools(servers, ['github:search', 'playwright/browser.goto'])
  assert.deepEqual(
    selected.map((item) => `${item.server.id}:${item.tool.name}`),
    ['github:search', 'playwright:browser.goto'],
    'target MCP context selection preserves qualified enabled-tool order',
  )
  assert.deepEqual(
    collectMcpConversationTools(servers, ['search']),
    [],
    'target MCP context selection rejects ambiguous bare tool names',
  )
  assert.equal(
    resolveMcpConversationToolIdentity(selected, { serverId: 'GitHub', toolName: 'search' }),
    selected[0],
    'target MCP request identity preserves explicit server-name resolution',
  )
  assert.equal(
    resolveMcpConversationToolIdentity(selected, { toolName: 'browser.goto' }),
    selected[1],
    'target MCP request identity preserves unique bare resolution',
  )
  assert.equal(JSON.stringify(servers), before, 'target MCP context identity policies do not mutate server inputs')

  const prompt = buildMcpConversationContextPrompt([selected[0]], MCP_TOOL_CALL_TAG)
  assert.ok(prompt.includes('<islemind_mcp_call>JSON</islemind_mcp_call>'), 'target MCP context prompt preserves the tagged request contract')
  assert.equal(
    prompt.match(/inputSchema: ([\s\S]*)$/)?.[1].length,
    600,
    'target MCP context prompt preserves the 600-character schema projection limit',
  )

  const controller = new AbortController()
  const observedSignals = []
  const policy = createMcpConversationContextPolicy({
    async listServers(options) {
      observedSignals.push(options.signal)
      return servers
    },
    now: () => 123,
  })
  const connected = await policy.resolve({
    mcpEnabled: true,
    enabledTools: ['github:search', 'playwright:browser.goto'],
    skillSnapshot: { enabledTools: ['gitlab:search'] },
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: controller.signal,
  })
  assert.equal(connected.kind, 'connected', 'target MCP context admits connected selected tools')
  assert.equal(observedSignals[0], controller.signal, 'target MCP context forwards the exact listing signal')
  assert.deepEqual(connected.tools.map((item) => item.server.id), ['github'], 'only connected tools become executable')
  assert.deepEqual(connected.selectedTools.map((item) => item.server.id), ['github', 'playwright'], 'conversation enabled tools take precedence over the skill snapshot')
  assert.deepEqual(connected.tracePlan, {
    kind: 'manifest',
    idPrefix: 'mcp-manifest',
    type: 'tool',
    status: 'done',
    startedAt: 123,
    connectedCount: 1,
    offlineCount: 1,
    connectedToolLabels: ['GitHub/search'],
    offlineToolLabels: ['Playwright/browser.goto'],
  }, 'target MCP context preserves stable connected/offline trace-plan evidence')

  let disabledListCount = 0
  const disabledPolicy = createMcpConversationContextPolicy({
    async listServers() { disabledListCount += 1; return servers },
    now: () => 124,
  })
  assert.equal((await disabledPolicy.resolve({
    mcpEnabled: false,
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: controller.signal,
  })).kind, 'disabled', 'disabled MCP context skips server listing')
  assert.equal(disabledListCount, 0, 'disabled MCP context has no catalog effect')

  const preCancelled = new AbortController()
  preCancelled.abort(new Error('cancel before MCP listing'))
  assert.equal((await policy.resolve({
    mcpEnabled: true,
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: preCancelled.signal,
  })).kind, 'cancelled', 'pre-listing cancellation wins without catalog work')
  assert.equal(observedSignals.length, 1, 'pre-listing cancellation does not call the catalog')

  const deferredController = new AbortController()
  let releaseServers
  const deferredPolicy = createMcpConversationContextPolicy({
    listServers(options) {
      assert.equal(options.signal, deferredController.signal, 'deferred MCP listing receives the exact signal')
      return new Promise((resolve) => { releaseServers = resolve })
    },
    now: () => 125,
  })
  const deferredOutcome = deferredPolicy.resolve({
    mcpEnabled: true,
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: deferredController.signal,
  })
  deferredController.abort(new Error('cancel during MCP listing'))
  releaseServers(servers)
  assert.deepEqual(
    await deferredOutcome,
    { kind: 'cancelled', stage: 'after_server_listing', prompt: '', tools: [], selectedTools: [], tracePlan: null },
    'post-listing cancellation suppresses context and trace effects',
  )

  const failed = await createMcpConversationContextPolicy({
    async listServers() { throw new Error('secret catalog failure') },
    now: () => 126,
  }).resolve({
    mcpEnabled: true,
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: controller.signal,
  })
  assert.deepEqual(
    failed,
    { kind: 'failed', reason: 'server_listing_failed', code: 'unknown', prompt: '', tools: [], selectedTools: [], tracePlan: null },
    'MCP catalog rejection becomes a typed failure without raw error leakage',
  )
}

async function runConversationMcpContextBootstrapTest() {
  const state = {
    listCalls: [],
    implementation: async () => createMcpContextServers(),
  }
  conversationMcpContextBootstrapFakes = {
    listMcpServers(options) {
      state.listCalls.push(options)
      return state.implementation(options)
    },
  }
  let bootstrapModule
  try {
    bootstrapModule = require('../src/bootstrap/conversationMcpContextRuntime.ts')
  } finally {
    conversationMcpContextBootstrapFakes = null
  }

  const controller = new AbortController()
  const connected = await bootstrapModule.resolveConversationMcpContext({
    conversation: { enabledTools: ['github:search', 'playwright:browser.goto'] },
    mcpEnabled: true,
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: controller.signal,
    traceId: (prefix) => `${prefix}-fixture`,
  })
  assert.equal(state.listCalls[0].signal, controller.signal, 'bootstrap MCP context preserves the exact catalog signal')
  assert.equal(connected.kind, 'connected', 'bootstrap MCP context preserves target admission identity')
  assert.equal(connected.tools.length, 1, 'bootstrap MCP context exposes only the connected selected tool')
  assert.equal(connected.traces.length, 1, 'bootstrap MCP context projects one manifest trace')
  assert.equal(connected.traces[0].id, 'mcp-manifest-fixture', 'bootstrap MCP context preserves the manifest trace prefix')
  assert.deepEqual(connected.traces[0].metadata, { connected: 1, offline: 1 }, 'bootstrap MCP context preserves connected/offline trace counts')

  state.implementation = async () => { throw new Error('private catalog failure') }
  const failed = await bootstrapModule.resolveConversationMcpContext({
    conversation: {},
    mcpEnabled: true,
    toolCallTag: MCP_TOOL_CALL_TAG,
    signal: controller.signal,
    traceId: (prefix) => `${prefix}-failed`,
  })
  assert.deepEqual(
    { kind: failed.kind, reason: failed.reason, code: failed.code, traces: failed.traces },
    { kind: 'failed', reason: 'server_listing_failed', code: 'unknown', traces: [] },
    'bootstrap MCP context keeps dependency failure typed and side-effect free',
  )

  const assistantReplyStartSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantConversationReplyStartRuntime.ts'), 'utf8')
  const legacyChatRunnerPath = path.join(root, 'src/services/chatRunner.ts')
  const contextAcquisitionSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantConversationContextAcquisitionRuntime.ts'), 'utf8')
  assert.match(contextAcquisitionSource, /await dependencies\.resolveMcpContext\(\{[\s\S]*?signal: input\.signal,[\s\S]*?if \(mcpOutcome\.kind === 'cancelled'\) \{[\s\S]*?if \(mcpOutcome\.kind === 'failed'\) \{[\s\S]*?dependencies\.projectTerminalFailure\(\{/, 'Assistant Runtime consumes typed MCP cancellation/failure before returning acquired context')
  assert.ok(
    assistantReplyStartSource.indexOf('dependencies.contextAcquisitionRuntime.acquire({') < assistantReplyStartSource.indexOf('dependencies.providerToolAdmissionRuntime.admit({'),
    'Chat and Companion acquire typed MCP context before provider tool admission',
  )
  assert.doesNotMatch(assistantReplyStartSource, /@\/services\/chatMcpContextUtils/, 'target reply startup does not import the MCP context service boundary')
  assert.equal(fs.existsSync(legacyChatRunnerPath), false, 'the deleted Chat reply-start facade cannot return')
}

function createAssistantMcpTurnHarness(overrides = {}) {
  const state = {
    traces: [],
    pendingActionProjectionInputs: [],
    tasks: [],
    synthesisRequests: [],
    generationRequests: [],
    revisionMessageRequests: [],
    settingsReads: 0,
  }
  const initialSettings = { id: 'initial', runtimeLogEnabled: true }
  const synthesisSettings = { id: 'synthesis', runtimeLogEnabled: false }
  const limits = {
    maxToolCallsPerStep: 3,
    outputCharLimit: 6400,
    allowReadOnlyTools: true,
    allowReadWriteTools: 'visible',
    allowDestructiveTools: 'confirm',
  }
  const resolved = {
    server: {
      id: 'selected-server',
      name: 'Selected server',
      enabled: true,
      status: 'connected',
    },
    tool: {
      name: 'selected-tool',
      description: 'Selected MCP tool',
      permission: 'read-write',
      inputSchema: { type: 'object' },
      enabled: true,
    },
  }
  const observation = {
    ok: true,
    status: 'done',
    output: 'raw observation',
    blocks: [{ type: 'text', text: 'visible tool output' }],
    diagnostic: { id: 'task-diagnostic', type: 'tool', title: 'Task', status: 'done' },
  }
  const dependencies = {
    parseRequest(output) {
      if (output === 'ordinary answer' || output === 'malformed tagged request') return null
      return {
        serverId: 'requested-server',
        toolName: 'requested-tool',
        arguments: { query: 'IsleMind' },
      }
    },
    findTool(tools) {
      return tools[0]
    },
    getSettings() {
      state.settingsReads += 1
      return state.settingsReads === 1 ? initialSettings : synthesisSettings
    },
    resolveLimits(settings) {
      assert.equal(settings, initialSettings, 'task limits resolve from the execution settings snapshot')
      return limits
    },
    buildRuntimeLogOptions(settings) {
      return { settingsId: settings.id }
    },
    async executeTask(task) {
      state.tasks.push(task)
      return { observation }
    },
    buildPendingActionProjection(input) {
      state.pendingActionProjectionInputs.push(input)
      return undefined
    },
    truncateBlocks(blocks) {
      return blocks
    },
    formatBlocks(blocks) {
      return blocks.map((block) => block.text ?? '').filter(Boolean).join('\n\n')
    },
    buildRevisionSystemPrompt(systemPrompt) {
      return `${systemPrompt}\nMCP revision`
    },
    buildRevisionMessages(input) {
      state.revisionMessageRequests.push(input)
      return [{ role: 'assistant', content: input.toolOutput }]
    },
    resolveGenerationParameters(request) {
      state.generationRequests.push(request)
      return { temperature: 0.9, topP: 0.8, maxTokens: 321 }
    },
    async synthesize(request) {
      state.synthesisRequests.push(request)
      return {
        text: ' synthesized answer ',
        usage: { inputTokens: 7, outputTokens: 9, totalTokens: 16 },
      }
    },
    sanitizeAnswer(output) {
      return output.trim()
    },
    translate(key, parameters) {
      if (key === 'mcpRuntime.toolUnavailable') return `Unavailable: ${parameters?.tool}`
      if (key === 'mcpRuntime.callFailed') return 'MCP call failed'
      if (key === 'mcpRuntime.emptyOutput') return 'MCP output was empty'
      if (key === 'chatRunner.trace.mcpToolResultTitle') return 'MCP result'
      if (key === 'chatRunner.trace.mcpToolUnavailable') return `Missing: ${parameters?.tool}`
      if (key === 'chatRunner.trace.mcpToolRequested') return `Requested: ${parameters?.server}/${parameters?.tool}`
      return key
    },
    buildTraceMetadata(input) {
      return { ...input }
    },
    completeTrace(trace) {
      return { ...trace, completedAt: 2000 }
    },
    recordTrace(trace) {
      state.traces.push(trace)
    },
    traceId(prefix) {
      return `${prefix}-${state.traces.length + 1}`
    },
    now() {
      return 1000
    },
    ...overrides,
  }
  return {
    state,
    limits,
    resolved,
    observation,
    initialSettings,
    synthesisSettings,
    runtime: createAssistantMcpToolTurnRuntime(dependencies),
    input: {
      conversationId: 'conversation-store',
      assistantMessageId: 'assistant-1',
      provider: { id: 'provider-1' },
      conversation: {
        id: 'conversation-session',
        model: 'model-1',
        reasoningEffort: 'high',
      },
      systemPrompt: 'System',
      messages: [{ role: 'user', content: 'Search' }],
      baseContextPrompt: 'Context',
      firstOutput: 'tagged request',
      tools: [resolved],
      signal: new AbortController().signal,
    },
  }
}

async function runAssistantMcpToolTurnRuntimeTests() {
  for (const firstOutput of ['ordinary answer', 'malformed tagged request']) {
    const harness = createAssistantMcpTurnHarness()
    const result = await harness.runtime.execute({ ...harness.input, firstOutput })
    assert.equal(result, null, `${firstOutput} does not start a tagged MCP turn`)
    assert.equal(harness.state.tasks.length, 0, `${firstOutput} does not execute a task`)
    assert.equal(harness.state.traces.length, 0, `${firstOutput} does not emit a trace`)
    assert.equal(harness.state.settingsReads, 0, `${firstOutput} does not read runtime settings`)
  }

  const unmatched = createAssistantMcpTurnHarness({ findTool: () => undefined })
  assert.deepEqual(
    await unmatched.runtime.execute(unmatched.input),
    { text: 'Unavailable: requested-tool' },
    'an unmatched tagged MCP request returns a localized visible fallback',
  )
  assert.equal(unmatched.state.tasks.length, 0, 'an unmatched request does not execute a task')
  assert.equal(unmatched.state.traces.length, 1, 'an unmatched request emits exactly one trace')
  assert.equal(unmatched.state.traces[0].status, 'error', 'the unmatched trace is an error')
  assert.equal(unmatched.state.traces[0].completedAt, 2000, 'the unmatched trace is completed')
  assert.equal(unmatched.state.traces[0].metadata.errorCode, 'tool_unavailable', 'the unmatched trace is diagnosable')

  const success = createAssistantMcpTurnHarness()
  const successResult = await success.runtime.execute(success.input)
  assert.deepEqual(
    successResult,
    { text: 'synthesized answer', usage: { inputTokens: 7, outputTokens: 9, totalTokens: 16 } },
    'successful MCP synthesis propagates sanitized text and provider usage',
  )
  assert.equal(success.state.tasks.length, 1, 'a tagged MCP request executes exactly one task')
  const task = success.state.tasks[0]
  assert.equal(
    task.stepId,
    'tagged-mcp:conversation-store:assistant-1:selected-server:selected-tool:requested-server:requested-tool',
    'tagged MCP task identity is stable across selected and requested identities',
  )
  assert.deepEqual(task.request, {
    toolId: 'mcp:selected-server:selected-tool',
    name: 'selected-tool',
    source: 'mcp',
    serverId: 'selected-server',
    arguments: { query: 'IsleMind' },
  }, 'the task receives the resolved MCP identity and requested arguments')
  assert.equal(task.options.manifests.length, 1, 'the task receives exactly one matching manifest')
  assert.deepEqual(task.options.manifests[0], {
    id: 'mcp:selected-server:selected-tool',
    source: 'mcp',
    name: 'selected-tool',
    description: 'Selected MCP tool',
    permission: 'read-write',
    inputSchema: { type: 'object' },
    enabled: true,
    serverId: 'selected-server',
    serverName: 'Selected server',
    requiresConfirmation: false,
  }, 'the one-call task manifest preserves the selected MCP capability')
  assert.equal(task.options.limits, success.limits, 'read-write and destructive task limits pass through unchanged')
  assert.equal(Object.hasOwn(task.options, 'mode'), false, 'tagged MCP task admission exposes no product-mode discriminator')
  assert.equal(task.options.signal, success.input.signal, 'the task receives the exact caller AbortSignal')
  assert.deepEqual(task.options.runtimeLog, { settingsId: 'initial' }, 'task runtime logging uses the execution settings snapshot')
  assert.equal(success.state.synthesisRequests.length, 1, 'a visible tool result triggers one synthesis request')
  const synthesis = success.state.synthesisRequests[0]
  assert.equal(synthesis.signal, success.input.signal, 'synthesis receives the exact caller AbortSignal')
  assert.equal(synthesis.settings, success.synthesisSettings, 'synthesis re-reads the injected settings')
  assert.equal(synthesis.temperature, 0.4, 'synthesis defensively enforces the shared temperature cap')
  assert.equal(synthesis.topP, 0.8, 'synthesis preserves shared top-p shaping')
  assert.equal(synthesis.maxTokens, 321, 'synthesis preserves shared token shaping')
  assert.deepEqual(
    synthesis.generationParameterSources,
    { temperature: 'internal-policy', topP: 'internal-policy', maxTokens: 'internal-policy' },
    'MCP synthesis marks every resolved generation value as internal policy',
  )
  assert.equal(synthesis.conversationId, 'conversation-session', 'synthesis uses the durable conversation identity')
  assert.equal(synthesis.sessionId, 'conversation-session', 'synthesis keeps session identity aligned with the conversation')
  assert.equal(synthesis.remoteCompactEligible, false, 'tagged MCP synthesis cannot expand into remote compaction')
  assert.equal(success.state.generationRequests[0].settings, success.synthesisSettings, 'generation shaping uses the refreshed settings')
  assert.equal(success.state.generationRequests[0].temperatureCap, 0.4, 'generation shaping receives the shared cap')
  assert.equal(success.state.generationRequests[0].conversation, success.input.conversation, 'generation shaping retains the exact conversation metadata object')
  assert.equal(success.state.revisionMessageRequests[0].conversation, success.input.conversation, 'revision-message projection retains the exact conversation metadata object')

  const pendingAction = {
    id: 'agent-pending-confirmation',
    reason: 'permission_required',
    title: 'Confirm edit_file',
    summary: 'A current durable confirmation is required.',
    toolName: 'selected-tool',
    toolId: 'mcp:selected-server:selected-tool',
    serverId: 'selected-server',
    source: 'mcp',
    permission: 'read-write',
    confirmable: true,
    resumeToolRequest: {
      toolId: 'mcp:selected-server:selected-tool',
      name: 'selected-tool',
      source: 'mcp',
      serverId: 'selected-server',
      arguments: { query: 'IsleMind' },
    },
    createdAt: 1000,
  }
  const confirmation = createAssistantMcpTurnHarness({
    async executeTask(taskInput) {
      confirmation.state.tasks.push(taskInput)
      return {
        observation: {
          ok: false,
          status: 'skipped',
          output: 'A current durable confirmation is required.',
          blocks: [{ type: 'text', text: 'A current durable confirmation is required.' }],
          diagnostic: {
            id: 'confirmation-diagnostic',
            type: 'tool',
            title: 'Task',
            status: 'skipped',
            metadata: { permission: 'read-write', decision: 'allow' },
          },
          errorCode: 'permission_required',
          metadata: { capabilityOutcome: 'confirmation_required' },
        },
      }
    },
    buildPendingActionProjection(input) {
      confirmation.state.pendingActionProjectionInputs.push(input)
      return {
        pendingAction,
        output: 'Action needs confirmation.\nConfirm edit_file',
      }
    },
  })
  assert.deepEqual(
    await confirmation.runtime.execute(confirmation.input),
    { text: 'Action needs confirmation.\nConfirm edit_file' },
    'a confirmation-required task returns the visible pending-action output without another model turn',
  )
  assert.equal(confirmation.state.synthesisRequests.length, 0, 'confirmation-required execution never asks the model to reinterpret confirmation')
  assert.equal(confirmation.state.pendingActionProjectionInputs.length, 1, 'confirmation-required execution builds one validated pending action')
  assert.deepEqual(confirmation.state.pendingActionProjectionInputs[0].step.toolRequest, {
    toolId: 'mcp:selected-server:selected-tool',
    name: 'selected-tool',
    source: 'mcp',
    serverId: 'selected-server',
    arguments: { query: 'IsleMind' },
  }, 'the pending action receives the selected tool identity and original arguments')
  assert.deepEqual(confirmation.state.pendingActionProjectionInputs[0].step.observation.diagnostic.metadata, {
    permission: 'read-write',
    decision: 'allow',
    capabilityOutcome: 'confirmation_required',
    toolId: 'mcp:selected-server:selected-tool',
    source: 'mcp',
    serverId: 'selected-server',
  }, 'pending-action policy input combines task evidence with the canonical selected identity')
  const confirmationTrace = confirmation.state.traces.at(-1)
  assert.equal(confirmationTrace.type, 'system', 'the pending action is projected on the workflow continuation trace surface')
  assert.equal(confirmationTrace.title, 'Agent workflow', 'the pending action uses the existing workflow action selector contract')
  assert.equal(confirmationTrace.status, 'skipped', 'the confirmation trace is terminal while the exact action waits')
  assert.equal(confirmationTrace.metadata.status, 'waiting', 'the confirmation trace retains the waiting workflow state')
  assert.equal(confirmationTrace.metadata.pendingAction, pendingAction, 'the exact validated pending action reaches the visible trace')

  const builtinManifest = {
    id: 'builtin:islemind-builtins:search_web',
    source: 'builtin',
    name: 'search_web',
    description: 'Search the public web.',
    permission: 'read-only',
    inputSchema: { type: 'object', required: ['query'] },
    enabled: true,
    serverId: 'islemind-builtins',
    serverName: 'IsleMind',
    requiresConfirmation: false,
  }
  const builtin = createAssistantMcpTurnHarness({
    findTool(tools, request, manifests) {
      assert.equal(tools.length, 0, 'built-in tagged fallback does not require an MCP-resolved tool')
      assert.equal(request.toolName, 'requested-tool', 'built-in tagged fallback receives the parsed request')
      assert.equal(manifests[0], builtinManifest, 'built-in tagged fallback receives the admitted manifest identity')
      return {
        server: { id: 'islemind-builtins', name: 'IsleMind', enabled: true, status: 'connected' },
        tool: { name: 'search_web', description: builtinManifest.description, permission: 'read-only', inputSchema: builtinManifest.inputSchema, enabled: true },
        manifest: builtinManifest,
      }
    },
  })
  await builtin.runtime.execute({
    ...builtin.input,
    tools: [],
    manifests: [builtinManifest],
  })
  assert.deepEqual(builtin.state.tasks[0].request, {
    toolId: 'builtin:islemind-builtins:search_web',
    name: 'search_web',
    source: 'builtin',
    serverId: 'islemind-builtins',
    arguments: { query: 'IsleMind' },
  }, 'tagged built-in execution preserves the canonical built-in task identity')
  assert.equal(builtin.state.tasks[0].options.manifests[0].source, 'builtin', 'tagged built-in execution keeps the built-in adapter source')
  assert.deepEqual(builtin.state.tasks[0].options.evidenceSources, ['runtime:tagged-builtin-request'], 'tagged built-in execution records source-aware visible intent')

  const rejection = createAssistantMcpTurnHarness({
    async executeTask() {
      throw new Error('task bridge rejected')
    },
  })
  assert.deepEqual(
    await rejection.runtime.execute(rejection.input),
    { text: 'MCP call failed' },
    'task bridge rejection remains a visible non-throwing MCP failure',
  )
  assert.equal(rejection.state.synthesisRequests.length, 0, 'task rejection does not synthesize')
  assert.equal(rejection.state.traces.at(-1).completedAt, 2000, 'task rejection emits a completed error trace')
  assert.equal(rejection.state.traces.at(-1).metadata.taskAdapter, 'task-runtime', 'task rejection identifies the canonical task runtime')

  const cancellationController = new AbortController()
  const cancellationEvents = []
  let cancellationSynthesisCount = 0
  const cancellation = createAssistantMcpTurnHarness({
    async executeTask() {
      cancellationController.abort(new Error('cancel after task observation'))
      return {
        observation: {
          ok: true,
          status: 'done',
          output: 'committed',
          blocks: [{ type: 'text', text: 'committed' }],
          diagnostic: { id: 'committed-diagnostic', status: 'done' },
        },
      }
    },
    recordTrace(trace) {
      cancellationEvents.push(trace.id)
    },
    async synthesize() {
      cancellationSynthesisCount += 1
      return { text: 'should not run' }
    },
  })
  const cancelled = await cancellation.runtime.execute({
    ...cancellation.input,
    signal: cancellationController.signal,
  })
  assert.equal(cancelled, null, 'post-task cancellation returns no visible revision')
  assert.deepEqual(
    cancellationEvents,
    ['mcp-call-start-1', 'committed-diagnostic'],
    'the committed task diagnostic is projected before post-task cancellation settles',
  )
  assert.equal(cancellationSynthesisCount, 0, 'post-task cancellation does not synthesize')

  const originalBlocks = [{ type: 'text', text: 'original block' }]
  let emptySynthesisCount = 0
  const empty = createAssistantMcpTurnHarness({
    async executeTask() {
      return {
        observation: {
          ok: true,
          status: 'done',
          output: 'raw empty fallback',
          blocks: originalBlocks,
          diagnostic: { id: 'empty-diagnostic', status: 'done' },
        },
      }
    },
    truncateBlocks(blocks) {
      blocks[0].text = ''
      return blocks
    },
    async synthesize() {
      emptySynthesisCount += 1
      return { text: ' synthesized from raw observation ' }
    },
  })
  assert.deepEqual(
    await empty.runtime.execute(empty.input),
    { text: 'synthesized from raw observation', usage: undefined },
    'empty formatted blocks synthesize an answer instead of projecting the raw task observation output',
  )
  assert.equal(originalBlocks[0].text, 'original block', 'block truncation cannot mutate the task observation input')
  assert.equal(emptySynthesisCount, 1, 'empty formatted output still reaches synthesis through the raw task observation output')
  assert.equal(
    empty.state.revisionMessageRequests.at(-1).toolOutput,
    'raw empty fallback',
    'the raw task observation output is synthesis input only',
  )

  const synthesisFailure = createAssistantMcpTurnHarness({
    async synthesize() {
      throw new Error('provider synthesis failed')
    },
  })
  const synthesisFailureRevision = await synthesisFailure.runtime.execute(synthesisFailure.input)
  assert.deepEqual(
    synthesisFailureRevision,
    { text: 'chatRunner.error.providerToolSynthesisFailed' },
    'synthesis failure reports a recoverable error instead of projecting the MCP tool output',
  )
  assert.ok(
    !synthesisFailureRevision.text.includes('visible tool output'),
    'synthesis failure never projects raw MCP tool output as chat content',
  )
  const synthesisFailureTrace = synthesisFailure.state.traces.at(-1)
  assert.equal(synthesisFailureTrace.status, 'error', 'synthesis failure emits an error trace')
  assert.equal(synthesisFailureTrace.completedAt, 2000, 'synthesis failure trace is completed')
  assert.equal(synthesisFailureTrace.content, 'provider synthesis failed', 'synthesis failure trace preserves the provider error')

  const metadataTasks = []
  for (const metadataValue of [undefined, 'opaque-a', 'opaque-b']) {
    const parity = createAssistantMcpTurnHarness({
      async executeTask(taskInput) {
        metadataTasks.push(taskInput)
        return {
          observation: {
            ok: true,
            status: 'done',
            output: 'mode output',
            blocks: [{ type: 'text', text: 'mode output' }],
            diagnostic: { id: `metadata-${metadataValue ?? 'absent'}`, status: 'done' },
          },
        }
      },
    })
    parity.resolved.tool.permission = 'destructive'
    const conversation = metadataValue === undefined
      ? { ...parity.input.conversation }
      : { ...parity.input.conversation, untrustedMetadata: metadataValue }
    const result = await parity.runtime.execute({
      ...parity.input,
      conversation,
      tools: [parity.resolved],
    })
    assert.deepEqual(
      result,
      { text: 'synthesized answer', usage: { inputTokens: 7, outputTokens: 9, totalTokens: 16 } },
      `${metadataValue ?? 'absent'} metadata keeps the tagged MCP post-observation synthesis behavior`,
    )
    assert.equal(parity.state.generationRequests[0].conversation, conversation, 'untrusted conversation metadata remains available only to generation shaping')
    assert.equal(parity.state.revisionMessageRequests[0].conversation, conversation, 'untrusted conversation metadata remains available only to revision projection')
    assert.equal(conversation.untrustedMetadata, metadataValue, 'untrusted conversation metadata is not mutated by task admission')
  }
  assert.equal(metadataTasks.every((item) => !Object.hasOwn(item.options, 'mode')), true, 'tagged MCP task options stay mode-free for arbitrary conversation metadata')
  for (const metadataTask of metadataTasks) {
    assert.equal(metadataTask.options.manifests[0].permission, 'destructive', 'destructive permission remains explicit for every metadata shape')
    assert.equal(metadataTask.options.manifests[0].requiresConfirmation, true, 'destructive manifests remain confirmation-gated')
    assert.deepEqual(metadataTask.options.evidenceSources, ['runtime:tagged-mcp-request'], 'visible tagged requests retain their evidence source')
    assert.equal(metadataTask.options.userConfirmed, false, 'visible intent does not forge destructive confirmation')
  }
  const runtimeSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantMcpToolTurnRuntime.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationMcpToolTurnRuntime.ts'), 'utf8')
  assert.doesNotMatch(runtimeSource, /\bTMode\b|AssistantMcpConversationLike<|interface AssistantMcpConversationLike[^}]*productMode/, 'the MCP turn contract exposes no historical-mode generic or field')
  assert.doesNotMatch(bootstrapSource, /ProductInteractionMode|@\/modules\/workspaces/, 'the MCP turn bootstrap has no Workspaces product-mode dependency')
}

async function runConversationMcpBootstrapIntegrationTest() {
  const tasks = []
  const providerRequests = []
  const projectedTraces = []
  const sanitizedTraceIds = []
  const key = 'conversation-store:assistant-1'
  const bootstrapFakes = {
    settings: { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 },
    limits: { allowReadWriteTools: 'visible', allowDestructiveTools: 'confirm' },
    buildPendingAction(runId, goal, step) {
      return {
        id: `pending:${runId}`,
        reason: 'permission_required',
        title: `Confirm ${step.toolRequest.name}`,
        summary: step.observation.output,
        toolName: step.toolRequest.name,
        toolId: step.toolRequest.toolId,
        serverId: step.toolRequest.serverId,
        source: step.toolRequest.source,
        permission: step.observation.diagnostic.metadata.permission,
        confirmable: true,
        resumeToolRequest: step.toolRequest,
        createdAt: 1000,
      }
    },
    formatPendingActionOutput(pending) {
      return `Confirm action: ${pending.toolName}`
    },
    async executeTask(input) {
      tasks.push(input)
      return {
        observation: {
          ok: true,
          status: 'done',
          output: 'raw output',
          blocks: [{ type: 'text', text: 'visible output' }],
          diagnostic: { id: 'task-diagnostic', type: 'tool', title: 'Task', status: 'done' },
        },
      }
    },
    resolveGenerationParameters() {
      return { temperature: 0.3, topK: 12, maxTokens: 256 }
    },
    async streamProviderChat(request, _onChunk, onResult) {
      providerRequests.push(request)
      onResult({ text: ' bootstrap synthesis ', usage: { source: 'provider', totalTokens: 9 } })
      return { controller: new AbortController(), done: Promise.resolve() }
    },
    sanitizeTrace(trace) {
      sanitizedTraceIds.push(trace.id)
      return { ...trace, metadata: { ...(trace.metadata ?? {}), sanitized: true } }
    },
    streamingStore: {
      activeStreams: new Map([[key, true]]),
      upsertTrace(_conversationId, _assistantMessageId, trace) {
        projectedTraces.push(trace)
      },
    },
    chatStore: {
      upsertMessageTrace(_conversationId, _assistantMessageId, trace) {
        projectedTraces.push(trace)
      },
    },
  }
  conversationMcpBootstrapFakes = bootstrapFakes
  let bootstrapModule
  try {
    bootstrapModule = require('../src/bootstrap/conversationMcpToolTurnRuntime.ts')
  } finally {
    conversationMcpBootstrapFakes = null
  }
  const controller = new AbortController()
  const resolved = {
    server: { id: 'selected-server', name: 'Selected server', enabled: true, status: 'connected' },
    tool: { name: 'selected-tool', permission: 'read-write', enabled: true },
  }
  const result = await bootstrapModule.createConversationMcpToolTurnRuntime({
    conversationId: 'conversation-store',
    assistantMessageId: 'assistant-1',
  }).execute({
    conversationId: 'conversation-store',
    assistantMessageId: 'assistant-1',
    provider: { id: 'provider-1' },
    conversation: { id: 'conversation-session', model: 'model-1', untrustedMetadata: 'opaque' },
    systemPrompt: 'system',
    messages: [{ role: 'user', content: 'request' }],
    baseContextPrompt: 'context',
    firstOutput: `<${MCP_TOOL_CALL_TAG}>${JSON.stringify({
      serverId: 'requested-server',
      tool: 'qualified-server/requested-tool',
      arguments: { query: 'IsleMind' },
    })}</${MCP_TOOL_CALL_TAG}>`,
    tools: [resolved],
    signal: controller.signal,
  })
  assert.deepEqual(result, { text: 'bootstrap synthesis', usage: { source: 'provider', totalTokens: 9 } }, 'bootstrap composition returns sanitized MCP synthesis and usage')
  assert.equal(tasks.length, 1, 'bootstrap composition executes one durable task')
  assert.equal(
    tasks[0].stepId,
    'tagged-mcp:conversation-store:assistant-1:selected-server:selected-tool:requested-server:requested-tool',
    'bootstrap composition keeps selected and explicitly requested MCP identities in the durable task identity',
  )
  assert.deepEqual(tasks[0].request, {
    toolId: 'mcp:selected-server:selected-tool',
    name: 'selected-tool',
    source: 'mcp',
    serverId: 'selected-server',
    arguments: { query: 'IsleMind' },
  }, 'bootstrap composition sends the selected identity and exact requested arguments to the durable task')
  assert.equal(tasks[0].options.signal, controller.signal, 'bootstrap composition preserves the exact task signal')
  assert.equal(Object.hasOwn(tasks[0].options, 'mode'), false, 'bootstrap composition cannot forward Companion conversation metadata into task execution')
  assert.equal(providerRequests.length, 1, 'bootstrap composition issues one provider synthesis request')
  assert.equal(providerRequests[0].signal, controller.signal, 'bootstrap composition preserves the exact synthesis signal')
  assert.equal(providerRequests[0].topK, 12, 'bootstrap composition forwards shaped generation parameters')
  assert.equal(providerRequests[0].remoteCompactEligible, false, 'bootstrap composition keeps MCP synthesis outside remote compaction')
  assert.equal(sanitizedTraceIds.length, 2, 'bootstrap composition sanitizes both running and task traces before projection')
  assert.match(sanitizedTraceIds[0], /^mcp-call-start-/, 'bootstrap composition sanitizes the running trace')
  assert.equal(sanitizedTraceIds[1], 'task-diagnostic', 'bootstrap composition sanitizes the task diagnostic')
  assert.equal(projectedTraces.every((trace) => trace.metadata?.sanitized === true), true, 'bootstrap composition projects only sanitized traces')

  bootstrapFakes.executeTask = async (input) => {
    tasks.push(input)
    return {
      observation: {
        ok: false,
        status: 'skipped',
        output: 'A current durable confirmation is required.',
        blocks: [{ type: 'text', text: 'A current durable confirmation is required.' }],
        diagnostic: {
          id: 'bootstrap-confirmation-diagnostic',
          type: 'tool',
          title: 'Task',
          status: 'skipped',
          metadata: { permission: 'read-write' },
        },
        errorCode: 'permission_required',
      },
    }
  }
  const confirmationResult = await bootstrapModule.createConversationMcpToolTurnRuntime({
    conversationId: 'conversation-store',
    assistantMessageId: 'assistant-confirmation',
  }).execute({
    conversationId: 'conversation-store',
    assistantMessageId: 'assistant-confirmation',
    provider: { id: 'provider-1' },
    conversation: { id: 'conversation-session', model: 'model-1' },
    systemPrompt: 'system',
    messages: [{ role: 'user', content: 'edit file' }],
    baseContextPrompt: 'context',
    firstOutput: `<${MCP_TOOL_CALL_TAG}>${JSON.stringify({
      serverId: 'selected-server',
      tool: 'selected-tool',
      arguments: { path: 'workspace/file.txt', text: 'content', expectedRevision: 'absent:v1' },
    })}</${MCP_TOOL_CALL_TAG}>`,
    tools: [resolved],
    signal: controller.signal,
  })
  assert.deepEqual(confirmationResult, { text: 'Confirm action: selected-tool' }, 'bootstrap returns the formatted pending-action output')
  assert.equal(providerRequests.length, 1, 'bootstrap confirmation projection does not start another provider synthesis')
  const bootstrapPendingTrace = projectedTraces.at(-1)
  assert.equal(bootstrapPendingTrace.title, 'Agent workflow', 'bootstrap projects confirmation onto the existing workflow action surface')
  assert.deepEqual(bootstrapPendingTrace.metadata.pendingAction.resumeToolRequest, {
    toolId: 'mcp:selected-server:selected-tool',
    name: 'selected-tool',
    source: 'mcp',
    serverId: 'selected-server',
    arguments: { path: 'workspace/file.txt', text: 'content', expectedRevision: 'absent:v1' },
  }, 'bootstrap pending action preserves exact canonical identity and original edit arguments')

  bootstrapFakes.executeTask = async (input) => {
    tasks.push(input)
    return {
      observation: {
        ok: true,
        status: 'done',
        output: 'raw output',
        blocks: [{ type: 'text', text: 'visible output' }],
        diagnostic: { id: 'task-diagnostic-restored', type: 'tool', title: 'Task', status: 'done' },
      },
    }
  }

  const taskCountBeforeBuiltIn = tasks.length
  const builtinResult = await bootstrapModule.createConversationMcpToolTurnRuntime({
    conversationId: 'conversation-store',
    assistantMessageId: 'assistant-2',
  }).execute({
    conversationId: 'conversation-store',
    assistantMessageId: 'assistant-2',
    provider: { id: 'provider-1' },
    conversation: { id: 'conversation-session', model: 'model-1' },
    systemPrompt: 'system',
    messages: [{ role: 'user', content: 'search' }],
    baseContextPrompt: 'context',
    firstOutput: `<${MCP_TOOL_CALL_TAG}>${JSON.stringify({
      serverId: 'islemind-builtins',
      tool: 'search_web',
      arguments: { query: 'current IsleMind status' },
    })}</${MCP_TOOL_CALL_TAG}>`,
    tools: [],
    manifests: [{
      id: 'builtin:islemind-builtins:search_web',
      source: 'builtin',
      name: 'search_web',
      description: 'Search the public web.',
      permission: 'read-only',
      inputSchema: { type: 'object', required: ['query'] },
      enabled: true,
      serverId: 'islemind-builtins',
      serverName: 'IsleMind',
      requiresConfirmation: false,
    }],
    signal: controller.signal,
  })
  assert.equal(builtinResult.text, 'bootstrap synthesis', 'bootstrap tagged fallback synthesizes an admitted built-in result')
  assert.equal(tasks.length, taskCountBeforeBuiltIn + 1, 'bootstrap tagged fallback executes one durable built-in task')
  const builtInTask = tasks[taskCountBeforeBuiltIn]
  assert.deepEqual(builtInTask.request, {
    toolId: 'builtin:islemind-builtins:search_web',
    name: 'search_web',
    source: 'builtin',
    serverId: 'islemind-builtins',
    arguments: { query: 'current IsleMind status' },
  }, 'bootstrap tagged fallback routes the canonical built-in identity through the durable task bridge')
  assert.equal(builtInTask.options.manifests[0].id, 'builtin:islemind-builtins:search_web', 'bootstrap tagged fallback keeps the admitted built-in manifest')

  const effectsAfterSuccess = {
    tasks: tasks.length,
    providerRequests: providerRequests.length,
    projectedTraces: projectedTraces.length,
  }
  const rejectedOutputs = [
    `<${MCP_TOOL_CALL_TAG}>{bad json}</${MCP_TOOL_CALL_TAG}>`,
    `<${MCP_TOOL_CALL_TAG}>${JSON.stringify({
      tool: 'requested-server/requested-tool',
      arguments: JSON.parse('{"__proto__":{"polluted":true}}'),
    })}</${MCP_TOOL_CALL_TAG}>`,
    `<${MCP_TOOL_CALL_TAG}>${JSON.stringify({
      tool: 'requested-server/requested-tool',
      arguments: { text: 'x'.repeat(MCP_TOOL_REQUEST_LIMITS.argumentStringChars + 1) },
    })}</${MCP_TOOL_CALL_TAG}>`,
  ]
  for (const firstOutput of rejectedOutputs) {
    assert.equal(
      await bootstrapModule.createConversationMcpToolTurnRuntime({
        conversationId: 'conversation-store',
        assistantMessageId: 'assistant-1',
      }).execute({
        conversationId: 'conversation-store',
        assistantMessageId: 'assistant-1',
        provider: { id: 'provider-1' },
        conversation: { id: 'conversation-session', model: 'model-1', untrustedMetadata: 'opaque' },
        systemPrompt: 'system',
        messages: [{ role: 'user', content: 'request' }],
        baseContextPrompt: 'context',
        firstOutput,
        tools: [resolved],
        signal: controller.signal,
      }),
      null,
      'malformed, unsafe, and over-limit tagged MCP requests fail closed',
    )
  }
  assert.deepEqual({
    tasks: tasks.length,
    providerRequests: providerRequests.length,
    projectedTraces: projectedTraces.length,
  }, effectsAfterSuccess, 'rejected tagged MCP requests create no task, synthesis, or trace effects')

  const finalizationSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantConversationFinalizationRuntime.ts'), 'utf8')
  const streamLifecycleSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantConversationStreamLifecycleRuntime.ts'), 'utf8')
  const streamLifecycleBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationAssistantStreamLifecycleRuntime.ts'), 'utf8')
  const assistantReplyStartSource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/application/assistantConversationReplyStartRuntime.ts'), 'utf8')
  const mcpTurnIndex = finalizationSource.indexOf('dependencies.reviseWithMcpTools')
  assert.ok(mcpTurnIndex >= 0, 'target finalization keeps MCP revision in the finalization runtime')
  assert.doesNotMatch(finalizationSource, /dependencies\.reviseWithProviderTools/, 'provider-native continuation no longer runs through finalization')
  const mcpIntegration = finalizationSource.slice(mcpTurnIndex, mcpTurnIndex + 1600)
  assert.ok(mcpIntegration.includes('firstOutput: finalOutput'), 'target finalization hands the canonical streamed output to the MCP runtime')
  assert.ok(mcpIntegration.includes('dependencies.mergeUsage(finalResult.usage, revision.usage)'), 'target finalization merges MCP synthesis usage into the selected result')
  assert.match(streamLifecycleSource, /return dependencies\.finalize\(\{/, 'Assistant Runtime lifecycle delegates completion to the target finalizer and preserves its receipt')
  assert.match(streamLifecycleBootstrapSource, /finalize: conversationAssistantFinalizationRuntime\.finalize/, 'bootstrap binds lifecycle completion to the target finalizer')
  assert.doesNotMatch(assistantReplyStartSource, /createConversationMcpToolTurnRuntime|reviseWithMcpTools/, 'target reply startup cannot restore direct MCP revision coordination')
}

async function run() {
  const context7Description = "Returns a Context7-compatible library ID in the format '/org/project'. Select libraries by relevance."
  assert.equal(inferMcpToolPermission('resolve-library-id', context7Description), 'read-only', 'MCP permission inference does not treat format or narrative selection as a destructive or mutating action')
  assert.equal(inferMcpToolPermission('query-docs', 'Retrieves and queries up-to-date documentation and code examples.'), 'read-only', 'MCP documentation queries remain read-only')
  assert.equal(inferMcpToolPermission('rm_workspace', 'Remove the selected workspace.'), 'destructive', 'MCP permission inference still recognizes a tokenized rm command')
  assert.equal(inferMcpToolPermission('browser_select_option', 'Choose an option.'), 'read-write', 'MCP permission inference recognizes mutating actions from tool-name tokens')
  assert.equal(inferMcpToolPermission('project', 'Save the current project state.'), 'read-write', 'MCP permission inference recognizes explicit write effects in descriptions')
  await runBuiltInCapabilityBoundaryTests()
  await runMcpExecutionTaskIdentityTests()
  runMcpToolRequestParserTests()
  await runMcpConversationContextPolicyTests()
  await runConversationMcpContextBootstrapTest()
  await runAssistantMcpToolTurnRuntimeTests()
  await runConversationMcpBootstrapIntegrationTest()
  assert.equal(MCP_COMPATIBILITY_EVAL_SCHEMA, 'islemind.mcp-compatibility-eval.v1', 'MCP compatibility schema is versioned')
  assert.deepEqual(
    MCP_COMPATIBILITY_FIXTURE_IDS,
    [
      'github-mcp',
      'playwright-mcp',
      'context7-resources',
      'streamable-http-gateway',
      'malformed-schema-response',
      'websocket-transport-failure',
      'destructive-permission-refusal',
    ],
    'MCP compatibility fixtures cover target server archetypes and failure paths'
  )

  const evaluation = runMcpCompatibilityEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, MCP_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, MCP_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `MCP compatibility gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  assert.ok(evaluation.qualityGate.requiredMethodCoverage.includes('tools/call'), 'quality gate requires tool-call visibility')
  const runtimeSummary = buildMcpCompatibilityRuntimeSummary(evaluation)
  assert.equal(runtimeSummary.schema, MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA, 'MCP compatibility runtime summary is versioned')
  assert.equal(MCP_COMPATIBILITY_RUNTIME_SUMMARY_SCHEMA, 'islemind.mcp-compatibility-runtime-summary.v1', 'MCP compatibility runtime summary schema is stable')
  assert.equal(runtimeSummary.evaluationSchema, MCP_COMPATIBILITY_EVAL_SCHEMA, 'runtime summary keeps the source evaluation schema')
  assert.equal(runtimeSummary.serverCount, MCP_COMPATIBILITY_FIXTURE_IDS.length, 'runtime summary counts evaluated servers')
  assert.equal(runtimeSummary.serverLimit, MCP_COMPATIBILITY_RUNTIME_SERVER_LIMIT, 'runtime summary exposes its server cap')
  assert.equal(runtimeSummary.serverLimitApplied, false, 'runtime summary does not truncate the default fixture set')
  assert.equal(runtimeSummary.connectedCount, 6, 'runtime summary counts connected SSE and Streamable HTTP fixtures')
  assert.equal(runtimeSummary.warningCount, 2, 'runtime summary counts warning fixtures')
  assert.equal(runtimeSummary.errorCount, 1, 'runtime summary counts transport errors')
  assert.equal(runtimeSummary.toolCount, 12, 'runtime summary counts normalized tools without serializing tool schemas')
  assert.equal(runtimeSummary.invalidManifestItemCount, 4, 'runtime summary counts invalid manifest items')
  assert.equal(runtimeSummary.destructivePermissionCount, 2, 'runtime summary counts destructive tool permissions')
  assert.equal(runtimeSummary.refusedToolCallCount, 1, 'runtime summary counts refused tool calls')
  assert.deepEqual(runtimeSummary.failureCodes, ['malformed_schema', 'permission_required', 'unsupported_transport'], 'runtime summary exposes bounded failure codes')
  assert.equal(runtimeSummary.failureCounts.permission_required, 1, 'runtime summary counts permission-required failures')
  assert.equal(runtimeSummary.methodCoverage['tools/call'].attempted, 1, 'runtime summary aggregates tools/call coverage')
  assert.equal(runtimeSummary.qualityGatePassed, true, 'runtime summary keeps the quality-gate verdict')
  assert.equal(runtimeSummary.servers[0].serverSource, 'github/github-mcp-server', 'runtime summary keeps bounded server source evidence')
  assert.equal(runtimeSummary.servers[0].tools, undefined, 'runtime summary omits raw tool schemas')
  assert.equal(runtimeSummary.servers[0].url, undefined, 'runtime summary omits server URLs')

  const github = diagnostic(evaluation, 'github-mcp')
  assertMethodEnvelope(github)
  assert.equal(github.serverSource, 'github/github-mcp-server', 'GitHub diagnostic records server source')
  assert.equal(github.refreshResult, 'connected', 'GitHub fixture connects')
  assert.equal(github.methodCounts['tools/list'].attempted, 1, 'GitHub fixture attempts tools/list')
  assert.ok(github.toolCount >= 3, 'GitHub fixture exposes tools')
  assert.ok(github.resourceCount >= 2, 'GitHub fixture exposes resources')
  assert.ok(github.promptCount >= 1, 'GitHub fixture exposes prompts')
  assert.ok(github.permissionCounts.destructive >= 1, 'GitHub fixture records destructive tool permission')

  const playwright = diagnostic(evaluation, 'playwright-mcp')
  assertMethodEnvelope(playwright)
  assert.equal(playwright.serverSource, 'microsoft/playwright-mcp', 'Playwright diagnostic records server source')
  assert.equal(playwright.refreshResult, 'connected', 'Playwright fixture connects')
  assert.ok(playwright.tools.some((tool) => tool.name === 'browser_take_screenshot'), 'Playwright fixture preserves screenshot tool')
  assert.ok(playwright.permissionCounts['read-write'] >= 2, 'Playwright browser actions are visible as write-capable tools')

  const context7 = diagnostic(evaluation, 'context7-resources')
  assertMethodEnvelope(context7)
  assert.equal(context7.serverSource, 'upstash/context7', 'context7 diagnostic records server source')
  assert.ok(context7.resources.some((resource) => resource.uri === 'context7://libraries/react'), 'context7 fixture preserves library resources')
  assert.ok(context7.prompts.some((prompt) => prompt.name === 'library_docs_query'), 'context7 fixture preserves prompt entries')

  const streamableHttp = diagnostic(evaluation, 'streamable-http-gateway')
  assertMethodEnvelope(streamableHttp)
  assert.equal(streamableHttp.transport, 'streamable-http', 'Streamable HTTP fixture records the transport')
  assert.equal(streamableHttp.refreshResult, 'connected', 'Streamable HTTP fixture connects')
  assert.equal(streamableHttp.methodCounts.initialize.attempted, 1, 'Streamable HTTP fixture attempts initialize')
  assert.ok(streamableHttp.tools.some((tool) => tool.name === 'session_initialize'), 'Streamable HTTP fixture preserves session tool')
  assert.ok(streamableHttp.resources.some((resource) => resource.uri === 'mcp://streamable-http/session'), 'Streamable HTTP fixture preserves session resource')

  const malformed = diagnostic(evaluation, 'malformed-schema-response')
  assertMethodEnvelope(malformed)
  assert.equal(malformed.refreshResult, 'connected-with-warnings', 'malformed schema fixture stays diagnosable')
  assert.equal(malformed.failureCode, 'malformed_schema', 'malformed schema fixture reports failure code')
  assert.ok(malformed.invalidManifestItemCount >= 3, 'malformed schema fixture counts invalid entries')
  assert.deepEqual(malformed.tools.map((tool) => tool.name), ['valid_read'], 'malformed schema fixture drops invalid tool entries')
  assert.deepEqual(malformed.resources.map((resource) => resource.uri), ['fixture://valid-resource'], 'malformed schema fixture drops invalid resource entries')
  assert.deepEqual(malformed.prompts.map((prompt) => prompt.name), ['valid_prompt'], 'malformed schema fixture drops invalid prompt entries')

  const transportFailure = diagnostic(evaluation, 'websocket-transport-failure')
  assertMethodEnvelope(transportFailure)
  assert.equal(transportFailure.refreshResult, 'error', 'unsupported transport fixture fails closed')
  assert.equal(transportFailure.failureCode, 'unsupported_transport', 'unsupported transport fixture reports failure code')
  assert.equal(transportFailure.methodCounts['tools/list'].attempted, 0, 'unsupported transport does not attempt manifest fetch')

  const refusal = diagnostic(evaluation, 'destructive-permission-refusal')
  assertMethodEnvelope(refusal)
  assert.equal(refusal.toolCall.toolName, 'delete_workspace', 'permission fixture records tool call target')
  assert.equal(refusal.toolCall.refused, true, 'destructive tool call is refused without approval')
  assert.equal(refusal.toolCall.networkAttempted, false, 'destructive refusal happens before network execution')
  assert.equal(refusal.toolCall.failureCode, 'permission_required', 'destructive refusal reports permission failure')
  assert.equal(refusal.methodCounts['tools/call'].attempted, 1, 'destructive refusal records tools/call method visibility')

  let persisted = [{
    id: 'remote', name: 'Remote', url: 'https://example.com/mcp', transport: 'streamable-http', enabled: true,
    status: 'connected', tools: [{ name: 'delete_workspace', permission: 'read-only', enabled: true, serverId: 'forged' }], resources: [], prompts: [], approvedToolNames: [], createdAt: 10, updatedAt: 10,
  }, {
    id: 'corrupt', name: 'Corrupt', url: 'https://example.com/corrupt', transport: 'sse', enabled: true,
    status: 'forged', tools: {}, resources: {}, prompts: null, approvedToolNames: ['read', 42], createdAt: 'old', updatedAt: null,
  }]
  const reconciled = []
  const observedSignals = []
  const builtin = {
    id: 'builtin', name: 'Builtin', url: 'islemind://builtin', transport: 'sse', enabled: true,
    status: 'connected', tools: [], resources: [], prompts: [], approvedToolNames: [], createdAt: 20, updatedAt: 20,
  }
  const recordReadFailure = new Error('injected MCP catalog record read failure')
  let writesAfterFailedRead = 0
  const readFailureCatalog = createMcpCatalogPolicy(withMcpCatalogPolicyPorts({
    builtinServerId: 'builtin',
    loadServers: async () => { throw recordReadFailure },
    saveServers: async () => { writesAfterFailedRead += 1 },
    builtinServer: () => ({ ...builtin }),
    discover: async () => ({ tools: [], resources: [], prompts: [] }),
    invalidateSession() {},
    reconcileSessions() {},
    now: () => 1000,
  }))
  await assert.rejects(
    () => readFailureCatalog.upsertServer({ ...persisted[0], id: 'must-not-write' }),
    (error) => error === recordReadFailure,
    'MCP mutation propagates a strict persisted-catalog read failure',
  )
  assert.equal(writesAfterFailedRead, 0, 'MCP mutation performs no write after a persisted-catalog read failure')
  const catalog = createMcpCatalogPolicy(withMcpCatalogPolicyPorts({
    builtinServerId: 'builtin',
    loadServers: async (options) => {
      observedSignals.push(options?.signal)
      return persisted
    },
    saveServers: async (servers, options) => {
      observedSignals.push(options?.signal)
      persisted = servers
    },
    builtinServer: () => ({ ...builtin }),
    discover: async () => ({ tools: [], resources: [], prompts: [] }),
    invalidateSession() {},
    reconcileSessions(servers) { reconciled.push(servers.map((server) => server.id)) },
    now: () => 1000,
  }))
  const listedCatalog = await catalog.listServers()
  assert.deepEqual(listedCatalog.map((server) => server.id), ['builtin', 'remote', 'corrupt'], 'MCP catalog prepends the built-in server to persisted entries')
  assert.equal(listedCatalog.find((server) => server.id === 'remote').tools[0].permission, 'destructive', 'MCP catalog reclassifies persisted tool permissions from trusted name/description evidence')
  const admittedCorrupt = listedCatalog.find((server) => server.id === 'corrupt')
  assert.deepEqual({ status: admittedCorrupt.status, tools: admittedCorrupt.tools, resources: admittedCorrupt.resources, prompts: admittedCorrupt.prompts, approvedToolNames: admittedCorrupt.approvedToolNames }, { status: 'disconnected', tools: [], resources: [], prompts: [], approvedToolNames: ['read'] }, 'MCP catalog bounds malformed persisted collections and status before consumers use them')
  await catalog.saveServers([builtin, { ...persisted[0], name: 'Updated' }])
  assert.deepEqual(persisted.map((server) => server.id), ['remote'], 'MCP catalog excludes the built-in server from persistence')
  assert.deepEqual(reconciled.at(-1), ['remote'], 'MCP catalog reconciles live sessions against normalized persisted servers')
  const inserted = await catalog.upsertServer({ ...persisted[0], id: 'second', name: 'Second', url: 'https://example.com/second' })
  assert.equal(inserted.id, 'second', 'MCP catalog returns the normalized upserted server')
  assert.deepEqual(persisted.map((server) => server.id), ['second', 'remote'], 'MCP catalog upsert preserves deterministic newest-first ordering')
  assert.equal(catalog.needsManifestRefresh({ ...inserted, manifestCachedAt: undefined }), true, 'MCP catalog refreshes entries without cache evidence')
  assert.equal(catalog.needsManifestRefresh({ ...inserted, manifestCachedAt: 999, manifestTtlMs: 10 }), false, 'MCP catalog honors an unexpired manifest TTL')
  assert.equal(catalog.needsManifestRefresh(builtin), false, 'MCP catalog never refreshes the built-in manifest')
  const operationSignal = new AbortController().signal
  await catalog.listServers({ signal: operationSignal })
  assert.equal(observedSignals.at(-1), operationSignal, 'MCP catalog forwards the exact caller signal to persistence reads')
  assert.equal(await catalog.removeServer('second', { signal: operationSignal }), true, 'MCP catalog removes persisted non-built-in servers directly')
  assert.equal(observedSignals.at(-1), operationSignal, 'MCP catalog forwards the exact caller signal to persisted removal writes')
  assert.deepEqual(persisted.map((server) => server.id), ['remote'], 'MCP catalog removal preserves unrelated servers')
  assert.equal(await catalog.removeServer('builtin', { signal: operationSignal }), false, 'MCP catalog never removes the built-in server')

  const commitController = new AbortController()
  const commitReason = new Error('cancel after committed MCP write')
  let committedServers = []
  let reconciledAfterCommit = []
  const commitAwareCatalog = createMcpCatalogPolicy(withMcpCatalogPolicyPorts({
    builtinServerId: 'builtin',
    loadServers: async () => [],
    saveServers: async (servers, options) => {
      assert.equal(options?.signal, commitController.signal, 'MCP committed write receives the exact caller signal')
      committedServers = servers
      commitController.abort(commitReason)
    },
    builtinServer: () => ({ ...builtin }),
    discover: async () => ({ tools: [], resources: [], prompts: [] }),
    invalidateSession() {},
    reconcileSessions(servers) { reconciledAfterCommit = servers.map((server) => server.id) },
    now: () => 1000,
  }))
  await assert.rejects(
    () => commitAwareCatalog.upsertServer({ ...persisted[0], id: 'committed', name: 'Committed' }, { signal: commitController.signal }),
    (error) => error === commitReason,
    'MCP catalog preserves the caller cancellation reason after a committed persistence write'
  )
  assert.deepEqual(committedServers.map((server) => server.id), ['committed'], 'post-commit cancellation does not roll back a completed MCP write')
  assert.deepEqual(reconciledAfterCommit, ['committed'], 'post-commit cancellation reconciles live sessions to committed MCP state')

  const refreshController = new AbortController()
  const refreshReason = new Error('cancel MCP discovery')
  let cancelledRefreshWrites = 0
  let cancelledRefreshInvalidations = 0
  const cancellableCatalog = createMcpCatalogPolicy(withMcpCatalogPolicyPorts({
    builtinServerId: 'builtin',
    loadServers: async () => [persisted[0]],
    saveServers: async () => { cancelledRefreshWrites += 1 },
    builtinServer: () => ({ ...builtin }),
    discover: async (_server, options) => {
      assert.equal(options?.signal, refreshController.signal, 'MCP discovery receives the exact catalog signal')
      refreshController.abort(refreshReason)
      throw refreshReason
    },
    invalidateSession() { cancelledRefreshInvalidations += 1 },
    reconcileSessions() {},
    now: () => 1000,
  }))
  await assert.rejects(
    () => cancellableCatalog.refreshManifest({ ...persisted[0], enabled: true }, { signal: refreshController.signal }),
    (error) => error === refreshReason,
    'cancelled MCP discovery preserves the exact caller cancellation reason'
  )
  assert.equal(cancelledRefreshWrites, 0, 'cancelled MCP refresh does not persist an error-state mutation')
  assert.equal(cancelledRefreshInvalidations, 0, 'cancelled MCP refresh does not invalidate a reusable session')

  const discoveryFailure = new Error('MCP manifest fixture failed')
  let failedRefreshServers = [{ ...persisted[0], enabled: true }]
  const failedRefreshInvalidations = []
  const failedRefreshLogs = []
  const failingCatalog = createMcpCatalogPolicy(withMcpCatalogPolicyPorts({
    builtinServerId: 'builtin',
    loadServers: async () => failedRefreshServers,
    saveServers: async (servers) => { failedRefreshServers = servers },
    builtinServer: () => ({ ...builtin }),
    discover: async () => { throw discoveryFailure },
    invalidateSession(server) { failedRefreshInvalidations.push(server.id) },
    reconcileSessions() {},
    logOperation: async (operation) => { failedRefreshLogs.push(operation) },
    now: () => 1000,
  }))
  const failedRefresh = await failingCatalog.refreshManifest(failedRefreshServers[0])
  assert.equal(failedRefresh.status, 'error', 'ordinary MCP discovery failure returns an error-state server')
  assert.equal(failedRefresh.lastError, discoveryFailure.message, 'ordinary MCP discovery failure preserves the discovery error message')
  assert.deepEqual(failedRefreshInvalidations, ['remote'], 'ordinary MCP discovery failure invalidates the failed server session')
  assert.equal(failedRefreshServers.find((server) => server.id === 'remote')?.status, 'error', 'ordinary MCP discovery failure persists the error-state server')
  assert.equal(failedRefreshServers.find((server) => server.id === 'remote')?.lastError, discoveryFailure.message, 'ordinary MCP discovery failure persists the failure detail')
  assert.equal(failedRefreshLogs.length, 1, 'ordinary MCP discovery failure emits one operation log')
  assert.equal(failedRefreshLogs[0]?.status, 'error', 'ordinary MCP discovery failure logs error status')
  assert.equal(failedRefreshLogs[0]?.error, discoveryFailure, 'ordinary MCP discovery failure logs the original error object')

  assert.match(mcpClientAdapterSource, /initialize\(\{ signal \}\)/, 'MCP discovery forwards cancellation to session initialization')
  assert.match(mcpClientAdapterSource, /list\(server, 'tools\/list', options\.signal\)/, 'MCP discovery forwards cancellation to tool listing')
  assert.match(mcpClientAdapterSource, /list\(server, 'resources\/list', options\.signal\)/, 'MCP discovery forwards cancellation to resource listing')
  assert.match(mcpClientAdapterSource, /list\(server, 'prompts\/list', options\.signal\)/, 'MCP discovery forwards cancellation to prompt listing')
  assert.doesNotMatch(mcpCatalogPolicySource, /@\/services\//, 'target MCP catalog policy does not depend on legacy services')
  assert.doesNotMatch(mcpClientAdapterSource, /@\/services\//, 'target MCP client adapter does not depend on legacy services')
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchain/mcpCatalogAdapter.ts')), false, 'legacy MCP catalog adapter stays deleted after target ownership migration')
  assert.equal(fs.existsSync(path.join(root, 'src/services/toolchain/mcpClientAdapter.ts')), false, 'legacy MCP client adapter stays deleted after target ownership migration')
  assert.match(mcpCatalogBootstrapSource, /export const removeMcpServer/, 'bootstrap exposes the cancellable direct MCP removal binding')

  console.log('MCP compatibility tests passed')
}

async function runMcpExecutionTaskIdentityTests() {
  const builtinCalls = []
  const remoteCalls = []
  const result = {
    summary: 'fixture result',
    observation: {
      ok: true,
      status: 'done',
      output: 'fixture result',
      blocks: [{ type: 'text', text: 'fixture result' }],
    },
  }
  const policy = createMcpExecutionApplicationPolicy({
    builtinServerId: 'builtin',
    isAllowedServerUrl: () => true,
    async callBuiltin(input) {
      builtinCalls.push(input)
      return result
    },
    async callRemote(input) {
      remoteCalls.push(input)
      return result
    },
    invalidateRemote() {},
  })
  const tool = {
    name: 'fixture.read',
    permission: 'read-only',
    enabled: true,
  }
  const builtinServer = {
    id: 'builtin',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    tools: [tool],
  }
  const remoteServer = {
    id: 'remote',
    transport: 'streamable-http',
    enabled: true,
    status: 'connected',
    tools: [tool],
  }
  const signal = new AbortController().signal
  const builtinDispatch = await policy.dispatch({
    server: builtinServer,
    tool,
    arguments: { query: 'builtin' },
    taskId: 'task-builtin-identity',
    startedAt: 101,
    signal,
  })
  assert.equal(builtinDispatch.kind, 'builtin', 'built-in execution retains its target dispatch branch')
  assert.equal(builtinCalls[0].taskId, 'task-builtin-identity', 'built-in dispatch receives the exact durable task identity')
  assert.equal(builtinCalls[0].signal, signal, 'built-in dispatch retains the exact task cancellation signal')

  const remoteDispatch = await policy.dispatch({
    server: remoteServer,
    tool,
    arguments: { query: 'remote' },
    taskId: 'task-remote-identity',
    startedAt: 202,
    signal,
  })
  assert.equal(remoteDispatch.kind, 'remote', 'remote execution retains its target dispatch branch')
  assert.equal(remoteCalls[0].taskId, 'task-remote-identity', 'remote dispatch receives the exact durable task identity')
  assert.equal(remoteCalls[0].signal, signal, 'remote dispatch retains the exact task cancellation signal')

  await policy.dispatch({
    server: remoteServer,
    tool,
    arguments: { query: 'compatibility' },
    startedAt: 303,
  })
  assert.equal(
    remoteCalls[1].taskId,
    'mcp-remote-fixture.read-303',
    'non-task-bound compatibility callers retain the synthesized MCP task identity',
  )
  assert.match(mcpExecutionPolicySource, /taskId:\s*input\.taskId\s*\?\?/, 'the target policy owns the compatibility fallback behind an optional task identity')
  assert.match(mcpExecutionBootstrapSource, /taskId:\s*options\.taskId/, 'bootstrap forwards caller-owned task identity into target dispatch')
}

async function runBuiltInCapabilityBoundaryTests() {
  const integrationsIndexSource = fs.readFileSync(path.join(root, 'src/modules/integrations/index.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/builtInCapabilityRuntime.ts'), 'utf8')
  const mcpExecutionSource = fs.readFileSync(path.join(root, 'src/bootstrap/mcpExecutionRuntime.ts'), 'utf8')
  const mcpCatalogSource = fs.readFileSync(path.join(root, 'src/bootstrap/mcpCatalog.ts'), 'utf8')
  const taskBoundRuntimeSource = fs.readFileSync(path.join(root, 'src/bootstrap/taskBoundToolRuntime.ts'), 'utf8')
  const legacyRegistryPath = path.join(root, 'src/services/builtinToolRegistry.ts')
  for (const targetExport of [
    'builtInCapabilityContracts',
    'builtInCapabilityPolicy',
    'builtInCapabilityAdapter',
    'adapters/sqliteBuiltInWorkspaceFilePort',
  ]) {
    assert.ok(integrationsIndexSource.includes(`export * from './${targetExport}'`), `Integrations public API exports ${targetExport}`)
  }
  assert.match(bootstrapSource, /from ['"]@\/modules\/integrations['"]/, 'bootstrap composes the built-in boundary through its public module API')
  assert.doesNotMatch(bootstrapSource, /@\/modules\/integrations\//, 'bootstrap does not deep-import built-in capability internals')
  assert.match(mcpExecutionSource, /resolveBuiltInCapabilityAdapter/, 'MCP dispatch resolves the target built-in adapter before application execution')
  assert.match(mcpExecutionSource, /!input\.taskId/, 'target built-in dispatch fails closed without durable task identity')
  assert.match(mcpCatalogSource, /createBuiltInCapabilityTaskAdmissionPort/, 'bootstrap catalog binds durable task reread admission')
  assert.match(mcpCatalogSource, /listApplicationBuiltInToolDescriptors/, 'bootstrap catalog consumes the target-owned application built-in descriptors')
  assert.match(mcpCatalogSource, /\.\.\.androidTrustedWebFetchPorts/, 'bootstrap catalog binds the complete native trust and bounded-fetch pair when available')
  assert.match(mcpCatalogSource, /remoteWebCrawl: createTavilyRemoteWebCrawlPort\(\)/, 'bootstrap catalog binds the documented remote crawl port')
  assert.match(mcpCatalogSource, /workspaceFileRead: builtInWorkspaceFileReadPort/, 'bootstrap catalog binds the composite durable workspace read port')
  assert.match(mcpCatalogSource, /workspaceFiles: builtInWritableWorkspaceFilePort/, 'bootstrap catalog enables edits only when the native durable workspace port exists')
  assert.match(builtInWorkspaceFileBootstrapSource, /from ['"]@\/modules\/integrations['"]/, 'workspace bootstrap imports the SQLite adapter through the Integrations public API')
  assert.doesNotMatch(builtInWorkspaceFileBootstrapSource, /@\/modules\/integrations\//, 'workspace bootstrap does not deep-import the SQLite adapter')
  assert.match(builtInWorkspaceFileBootstrapSource, /Platform\.OS === 'web'[\s\S]*?\? undefined[\s\S]*?: createSqliteBuiltInWorkspaceFilePort/, 'writable workspace files remain native-only while web SQLite is non-durable')
  assert.match(builtInWorkspaceFileBootstrapSource, /normalizedPath\.startsWith\('knowledge\/'\)/, 'workspace bootstrap retains the durable Knowledge virtual namespace')
  assert.match(builtInWorkspaceFileBootstrapSource, /normalizedPath\.startsWith\('workspace\/'\)/, 'workspace bootstrap routes only the contained writable namespace to SQLite')
  assert.match(mcpExecutionSource, /listAppActionToolDescriptors/, 'bootstrap execution resolves target-owned application actions')
  assert.doesNotMatch(mcpCatalogSource + mcpExecutionSource, /@\/services\/builtinToolRegistry/, 'bootstrap no longer imports the legacy registry')
  assert.match(taskBoundRuntimeSource, /resolveBuiltInCapabilityAdapter\(tool\.id\)/, 'durable task execution resolves the target built-in adapter before application built-ins')
  assert.match(appConfigSource, /android-trusted-web-fetch\/withAndroidTrustedWebFetch/, 'Android app configuration installs the trusted web-fetch native module')
  assert.match(androidTrustedWebFetchBootstrapSource, /Platform\?\.OS === 'android'/, 'trusted local Fetch is advertised only on its implemented Android runtime')
  assert.match(androidTrustedWebFetchNativeSource, /\.dns\(pinnedDns\)/, 'native Fetch pins the connection resolver to admitted addresses')
  assert.match(androidTrustedWebFetchNativeSource, /\.proxy\(Proxy\.NO_PROXY\)/, 'native Fetch cannot bypass address binding through a proxy')
  assert.match(androidTrustedWebFetchNativeSource, /\.followRedirects\(false\)/, 'native Fetch leaves every redirect for target-policy readmission')
  assert.match(androidTrustedWebFetchNativeSource, /readBoundedBody\(body\.source\(\), maxBytes\)/, 'native Fetch bounds the body while streaming')
  assert.equal(fs.existsSync(legacyRegistryPath), false, 'the covered legacy built-in registry is deleted')
  const builtInCapabilitySources = [
    'src/modules/integrations/builtInCapabilityContracts.ts',
    'src/modules/integrations/builtInCapabilityPolicy.ts',
    'src/modules/integrations/builtInCapabilityAdapter.ts',
  ].map((relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')).join('\n')
  assert.doesNotMatch(
    builtInCapabilitySources,
    /\b(?:view_media|edit_media|BuiltInMedia[A-Za-z]*|mediaView)\b/,
    'removed media tools and their unrealized production ports cannot return',
  )

  assert.deepEqual(
    BUILT_IN_CAPABILITY_TOOL_NAMES,
    ['search_web', 'crawl_web', 'read_file', 'edit_file'],
    'target built-in catalog exposes the bounded production capability set',
  )
  const searchPolicy = getBuiltInCapabilityToolPolicy('search_web')
  assert.deepEqual(searchPolicy, { permissions: ['network.remote'], requiresConfirmation: false }, 'target search exposes its canonical permission policy')
  searchPolicy.permissions.push('files.write')
  assert.deepEqual(
    getBuiltInCapabilityToolPolicy('search_web'),
    { permissions: ['network.remote'], requiresConfirmation: false },
    'callers cannot mutate the canonical built-in capability policy',
  )
  assert.deepEqual(
    listRunnableBuiltInCapabilityToolNames({ admission: { async admit() { return { status: 'unavailable' } } }, webSearch: { async search() { return [] } } }),
    ['search_web'],
    'target availability exposes only capabilities backed by concrete ports',
  )
  assert.deepEqual(
    listRunnableBuiltInCapabilityToolNames({
      admission: { async admit() { return { status: 'unavailable' } } },
      remoteWebCrawl: { async crawl() { return { pages: [] } } },
    }),
    ['crawl_web'],
    'remote-derived crawl is advertised only through its explicit port',
  )
  await runBuiltInCrawlRoutingTests()
  await runKnowledgeWorkspaceFileReadPortTests()
  const targetManifests = createBuiltInCapabilityToolManifests()
  assert.deepEqual(
    targetManifests.map((manifest) => manifest.id),
    BUILT_IN_CAPABILITY_TOOL_NAMES.map((name) => `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:${name}`),
    'target built-in manifests use canonical server-bound identities',
  )
  const applicationDescriptors = listApplicationBuiltInToolDescriptors()
  assert.deepEqual(
    applicationDescriptors.map((descriptor) => descriptor.name),
    ['app_info', 'get_settings', 'set_theme_mode', 'set_theme_family', 'set_theme_accent', 'set_language', 'set_feature_flag'],
    'target application built-in catalog preserves stable app/settings ordering',
  )
  applicationDescriptors.find((descriptor) => descriptor.name === 'set_theme_mode').inputSchema.properties.mode.enum.push('unsafe')
  assert.deepEqual(
    listApplicationBuiltInToolDescriptors().find((descriptor) => descriptor.name === 'set_theme_mode').inputSchema.properties.mode.enum,
    ['light', 'dark', 'system'],
    'callers cannot mutate target application built-in schemas',
  )
  const mergedDescriptors = mergeBuiltInCapabilityToolDescriptors([
    ...listApplicationBuiltInToolDescriptors(),
    { name: 'search_web', description: 'Legacy unbounded search.', permission: 'read-only', enabled: true },
  ])
  assert.equal(mergedDescriptors.filter((descriptor) => descriptor.name === 'search_web').length, 1, 'target catalog replaces the legacy search descriptor exactly once')
  assert.ok(mergedDescriptors.some((descriptor) => descriptor.name === 'app_info'), 'target catalog composes application and production capability built-ins')

  assert.equal(normalizeWorkspaceRelativePath('notes/readme.md'), 'notes/readme.md', 'workspace policy preserves a canonical relative path')
  for (const unsafePath of ['notes/readme.md:secret', 'aux.txt', 'notes/trailing.', 'notes/trailing ']) {
    assert.throws(
      () => normalizeWorkspaceRelativePath(unsafePath),
      (error) => error?.code === 'path_outside_workspace',
      `workspace policy rejects platform alias ${unsafePath}`,
    )
  }

  const durableTasks = new Map()
  const taskAdmission = createBuiltInCapabilityTaskAdmissionPort(async (taskId) => durableTasks.get(taskId))
  durableTasks.set('task-admission-001', {
    id: 'task-admission-001',
    toolId: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`,
    idempotencyKey: 'agent-idempotency-001',
    status: 'running',
    policy: { outcome: 'allowed' },
  })
  const admissionSignal = new AbortController().signal
  const admitted = await taskAdmission.admit({
    taskId: 'task-admission-001',
    toolId: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`,
    toolName: 'search_web',
    requiredPermissions: ['network.remote'],
    requiresConfirmation: false,
  }, { signal: admissionSignal })
  assert.equal(admitted.status, 'allowed', 'built-in admission rereads and accepts the exact running task')
  durableTasks.get('task-admission-001').status = 'queued'
  const staleAdmission = await taskAdmission.admit({
    taskId: 'task-admission-001',
    toolId: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`,
    toolName: 'search_web',
    requiredPermissions: ['network.remote'],
    requiresConfirmation: false,
  }, { signal: admissionSignal })
  assert.equal(staleAdmission.status, 'denied', 'built-in admission rejects a task that is no longer running')
  durableTasks.get('task-admission-001').status = 'running'
  const forgedPermissionAdmission = await taskAdmission.admit({
    taskId: 'task-admission-001',
    toolId: `builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`,
    toolName: 'search_web',
    requiredPermissions: ['files.write'],
    requiresConfirmation: false,
  }, { signal: admissionSignal })
  assert.equal(forgedPermissionAdmission.status, 'denied', 'built-in admission rejects permissions that differ from the canonical tool policy')

  const admissionRequests = []
  let searchResults = []
  let fileEditReceipt = {
    status: 'applied',
    relativePath: 'notes/edit.md',
    previousRevision: 'revision-edit-001',
    revision: 'revision-edit-002',
    byteLength: 7,
    mimeType: 'text/plain',
  }
  const binding = createBuiltInCapabilityRuntimeBinding({
    admission: {
      async admit(request, options) {
        assert.equal(options.signal.aborted, false, 'built-in admission receives a live cancellation signal')
        admissionRequests.push(request)
        return {
          status: 'allowed',
          taskId: request.taskId,
          toolId: request.toolId,
          grantedPermissions: [...request.requiredPermissions],
          confirmed: request.requiresConfirmation,
          ...(request.requiresConfirmation
            ? { confirmationTokenDigest: 'confirmation-digest-001', idempotencyKey: `idempotency-${request.taskId}` }
            : {}),
        }
      },
    },
    webSearch: {
      async search() {
        return searchResults
      },
    },
    workspaceFiles: {
      workspaceScopeId: 'workspace-scope-001',
      async inspect(relativePath) {
        if (relativePath === 'notes/readme.md') {
          return { relativePath, revision: 'revision-read-001', byteLength: 6, mimeType: 'text/plain' }
        }
        if (relativePath === 'notes/edit.md') {
          return { relativePath, revision: 'revision-edit-001', byteLength: 4, mimeType: 'text/plain' }
        }
        return undefined
      },
      async readText(relativePath) {
        return { relativePath, revision: 'revision-read-001', byteLength: 6, mimeType: 'text/plain', text: 'hello\n' }
      },
      async editTextAtomic() {
        return fileEditReceipt
      },
    },
    now: () => 1_000,
  })

  assert.equal(binding.serverId, BUILT_IN_CAPABILITY_SERVER_ID, 'bootstrap binding uses the canonical built-in server')
  assert.deepEqual(binding.manifests.map((manifest) => manifest.name), [...BUILT_IN_CAPABILITY_TOOL_NAMES], 'bootstrap binding publishes every target manifest once')
  const enabledManifests = binding.manifests.filter((manifest) => manifest.enabled)
  assert.deepEqual(
    binding.adapters.map((adapter) => adapter.definition.id),
    enabledManifests.map((manifest) => manifest.id),
    'bootstrap keeps runnable manifest and adapter identities aligned',
  )
  assert.deepEqual(
    enabledManifests.map((manifest) => manifest.name),
    ['search_web', 'read_file', 'edit_file'],
    'bootstrap advertises only capabilities with concrete ports',
  )
  for (const manifest of enabledManifests) {
    assert.equal(binding.resolveAdapter(manifest.id)?.definition.id, manifest.id, `bootstrap resolves adapter ${manifest.id}`)
  }
  for (const manifest of binding.manifests.filter((candidate) => !candidate.enabled)) {
    assert.equal(binding.resolveAdapter(manifest.id), undefined, `bootstrap fails closed for unavailable ${manifest.name}`)
  }
  assert.equal(binding.resolveAdapter('builtin:islemind-builtins:unknown'), undefined, 'bootstrap fails closed for an unknown built-in identity')

  const readAdapter = binding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:read_file`)
  assert.ok(readAdapter, 'bootstrap binds the workspace read adapter')
  const readResult = await readAdapter.execute({
    taskId: 'task-read-001',
    tool: readAdapter.definition,
    arguments: { path: 'notes/readme.md' },
  }, { signal: new AbortController().signal })
  assert.equal(readResult.capabilityOutcome.code, 'completed', 'workspace read completes through the target adapter')
  assert.equal(readResult.observation.blocks[0]?.text, 'hello\n', 'workspace read preserves bounded text output')

  const editAdapter = binding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:edit_file`)
  assert.ok(editAdapter, 'bootstrap binds the atomic workspace edit adapter')
  const editResult = await editAdapter.execute({
    taskId: 'task-edit-001',
    tool: editAdapter.definition,
    arguments: { path: 'notes/edit.md', text: 'updated', expectedRevision: 'revision-edit-001' },
  }, { signal: new AbortController().signal })
  assert.equal(editResult.capabilityOutcome.code, 'completed', 'confirmed idempotent file edit completes through the target adapter')
  assert.equal(editResult.observation.metadata?.idempotencyStatus, 'applied', 'file edit exposes only bounded durable receipt status')

  fileEditReceipt = { ...fileEditReceipt, status: 'replayed' }
  const replayedFileReceipt = await editAdapter.execute({
    taskId: 'task-edit-replayed',
    tool: editAdapter.definition,
    arguments: { path: 'notes/edit.md', text: 'updated', expectedRevision: 'revision-edit-001' },
  }, { signal: new AbortController().signal })
  assert.equal(replayedFileReceipt.capabilityOutcome.code, 'completed', 'replayed file edit receipts remain successful')
  assert.equal(replayedFileReceipt.observation.metadata?.idempotencyStatus, 'replayed', 'replayed file edits expose their bounded durable receipt status')

  fileEditReceipt = { status: 'conflict', relativePath: 'notes/edit.md', expectedRevision: 'revision-edit-001', actualRevision: 'revision-edit-003' }
  const conflictedFileReceipt = await editAdapter.execute({
    taskId: 'task-edit-conflict',
    tool: editAdapter.definition,
    arguments: { path: 'notes/edit.md', text: 'updated', expectedRevision: 'revision-edit-001' },
  }, { signal: new AbortController().signal })
  assert.equal(conflictedFileReceipt.capabilityOutcome.code, 'conflict', 'file edit conflict receipts remain explicit')

  for (const [status, expectedCode] of [
    ['idempotency_conflict', 'idempotency_conflict'],
    ['unavailable', 'capability_unavailable'],
  ]) {
    fileEditReceipt = { status, relativePath: 'notes/edit.md', reason: `${status} fixture` }
    const receipt = await editAdapter.execute({
      taskId: `task-edit-${status}`,
      tool: editAdapter.definition,
      arguments: { path: 'notes/edit.md', text: 'updated', expectedRevision: 'revision-edit-001' },
    }, { signal: new AbortController().signal })
    assert.equal(receipt.capabilityOutcome.code, expectedCode, `file edit ${status} receipts remain explicit`)
  }

  fileEditReceipt = { status: 'unsupported-receipt', relativePath: 'notes/edit.md' }
  const unsupportedFileReceipt = await editAdapter.execute({
    taskId: 'task-edit-unsupported',
    tool: editAdapter.definition,
    arguments: { path: 'notes/edit.md', text: 'updated', expectedRevision: 'revision-edit-001' },
  }, { signal: new AbortController().signal })
  assert.equal(unsupportedFileReceipt.capabilityOutcome.code, 'execution_failed', 'unexpected file edit receipts fail closed')

  const searchAdapter = binding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:search_web`)
  assert.ok(searchAdapter, 'bootstrap binds the trusted web-search adapter')
  const emptySearch = await searchAdapter.execute({
    taskId: 'task-search-empty',
    tool: searchAdapter.definition,
    arguments: { query: 'no trusted result' },
  }, { signal: new AbortController().signal })
  assert.equal(emptySearch.capabilityOutcome.code, 'execution_failed', 'zero trusted search results preserve legacy non-success behavior')
  assert.equal(emptySearch.capabilityOutcome.retryable, true, 'zero trusted search results remain retryable')

  searchResults = [{ title: 'Official result', url: 'https://example.com/docs', snippet: 'Bounded source.' }]
  const successfulSearch = await searchAdapter.execute({
    taskId: 'task-search-success',
    tool: searchAdapter.definition,
    arguments: { query: 'official documentation', limit: 1 },
  }, { signal: new AbortController().signal })
  assert.equal(successfulSearch.capabilityOutcome.code, 'completed', 'trusted public search result completes')
  assert.equal(successfulSearch.observation.blocks[0]?.uri, 'https://example.com/docs', 'trusted search keeps a public resource URL')

  const cancelledController = new AbortController()
  const admissionCountBeforeCancellation = admissionRequests.length
  cancelledController.abort(new Error('user cancelled built-in tool'))
  const cancelledRead = await readAdapter.execute({
    taskId: 'task-read-cancelled',
    tool: readAdapter.definition,
    arguments: { path: 'notes/readme.md' },
  }, { signal: cancelledController.signal })
  assert.equal(cancelledRead.capabilityOutcome.code, 'cancelled', 'pre-aborted built-in execution is terminally cancelled')
  assert.equal(admissionRequests.length, admissionCountBeforeCancellation, 'pre-aborted built-in execution performs no admission work')

}

async function runBuiltInCrawlRoutingTests() {
  const remoteCalls = []
  const trustCalls = []
  const fetchCalls = []
  const admission = {
    async admit(request) {
      return {
        status: 'allowed',
        taskId: request.taskId,
        toolId: request.toolId,
        grantedPermissions: [...request.requiredPermissions],
        confirmed: false,
      }
    },
  }
  const networkTrust = {
    async admitTarget(url) {
      trustCalls.push(url)
      return {
        status: 'allowed',
        canonicalUrl: url,
        permitToken: `permit-${trustCalls.length.toString().padStart(4, '0')}`,
        resolvedAddressDigest: `digest-${trustCalls.length.toString().padStart(4, '0')}`,
        classification: 'public',
      }
    },
  }
  const localBinding = createBuiltInCapabilityRuntimeBinding({
    admission,
    networkTrust,
    webFetch: {
      async fetch(input) {
        fetchCalls.push(input)
        if (input.url === 'https://example.com/') {
          return {
            requestedUrl: input.url,
            finalUrl: input.url,
            status: 302,
            byteLength: 0,
            redirectUrl: '/final',
          }
        }
        const body = '<html><head><title>Example Domain</title></head><body>Trusted local page.</body></html>'
        return {
          requestedUrl: input.url,
          finalUrl: input.url,
          status: 200,
          mimeType: 'text/html',
          byteLength: new TextEncoder().encode(body).byteLength,
          body,
        }
      },
    },
    remoteWebCrawl: {
      async crawl(input) {
        remoteCalls.push(input)
        throw new Error('unconfigured Tavily must not override the complete local trust/fetch pair')
      },
    },
    now: () => 2_000,
  })
  const localAdapter = localBinding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:crawl_web`)
  assert.ok(localAdapter, 'complete local trust/fetch ports advertise crawl_web')
  const localResult = await localAdapter.execute({
    taskId: 'task-crawl-local',
    tool: localAdapter.definition,
    arguments: { url: 'https://example.com', maxDepth: 0, maxPages: 1, maxBytes: 8_192 },
  }, { signal: new AbortController().signal })
  assert.equal(localResult.capabilityOutcome.code, 'completed', 'unconfigured remote crawl cannot block trusted local Fetch')
  assert.equal(localResult.observation.blocks[0]?.name, 'Example Domain', 'trusted local Fetch projects the exact fetched page title')
  assert.deepEqual(trustCalls, ['https://example.com/', 'https://example.com/final'], 'each manual redirect target receives fresh trust admission')
  assert.equal(fetchCalls.length, 2, 'trusted local Fetch follows one target-policy-approved manual redirect')
  assert.ok(fetchCalls.every((input) => input.redirect === 'manual'), 'local Fetch never delegates redirects to the transport')
  assert.equal(remoteCalls.length, 0, 'a structurally present but unconfigured Tavily port is not selected over local Fetch')

  let unsafeRemoteFallbackCalls = 0
  const boundedFailureBinding = createBuiltInCapabilityRuntimeBinding({
    admission,
    networkTrust,
    webFetch: {
      async fetch(input) {
        return {
          requestedUrl: input.url,
          finalUrl: input.url,
          status: 200,
          mimeType: 'text/html',
          byteLength: input.maxBytes + 1,
          body: '<html></html>',
        }
      },
    },
    remoteWebCrawl: {
      async crawl() {
        unsafeRemoteFallbackCalls += 1
        return { pages: [] }
      },
    },
  })
  const boundedFailureAdapter = boundedFailureBinding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:crawl_web`)
  const boundedFailure = await boundedFailureAdapter.execute({
    taskId: 'task-crawl-bounded-failure',
    tool: boundedFailureAdapter.definition,
    arguments: { url: 'https://example.com', maxDepth: 0, maxPages: 1, maxBytes: 1_024 },
  }, { signal: new AbortController().signal })
  assert.equal(boundedFailure.capabilityOutcome.code, 'size_limit_exceeded', 'local byte-limit failure remains explicit')
  assert.equal(unsafeRemoteFallbackCalls, 0, 'local trust or Fetch failure never silently falls through to a remote vendor')

  const remoteBody = 'Configured Tavily result.'
  const remoteBinding = createBuiltInCapabilityRuntimeBinding({
    admission,
    remoteWebCrawl: {
      async crawl() {
        return {
          pages: [{
            url: 'https://example.com/remote',
            title: 'Remote result',
            text: remoteBody,
            byteLength: new TextEncoder().encode(remoteBody).byteLength,
            depth: 0,
          }],
        }
      },
    },
    now: () => 3_000,
  })
  const remoteAdapter = remoteBinding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:crawl_web`)
  const remoteResult = await remoteAdapter.execute({
    taskId: 'task-crawl-remote',
    tool: remoteAdapter.definition,
    arguments: { url: 'https://example.com', maxDepth: 0, maxPages: 1, maxBytes: 8_192 },
  }, { signal: new AbortController().signal })
  assert.equal(remoteResult.capabilityOutcome.code, 'completed', 'configured remote crawl remains supported when the local pair is absent')
  assert.match(remoteResult.observation.output, /vendor-extracted/, 'remote crawl remains explicitly vendor-derived in its bounded receipt')
}

async function runKnowledgeWorkspaceFileReadPortTests() {
  const document = {
    id: 'knowledge-document-fixture',
    title: 'Fixture',
    mimeType: 'text/plain',
    size: 12,
    chunkCount: 2,
    status: 'ready',
    contentHash: 'a0c34f12',
    createdAt: 1,
    updatedAt: 1,
  }
  const chunks = [
    { id: 'chunk-two', documentId: document.id, title: document.title, content: 'second', ordinal: 1, createdAt: 1 },
    { id: 'chunk-one', documentId: document.id, title: document.title, content: 'first', ordinal: 0, createdAt: 1 },
  ]
  const observedSignals = []
  const workspaceFileRead = createKnowledgeWorkspaceFileReadPort({
    repository: {
      async listDocuments(options) {
        observedSignals.push(options.signal)
        return [document, { ...document, id: 'knowledge-document-pending', status: 'extracting' }]
      },
      async listChunks(documentId, options) {
        assert.equal(documentId, document.id, 'knowledge virtual read requests chunks only for the admitted document')
        observedSignals.push(options.signal)
        return chunks
      },
    },
  })
  const path = 'knowledge/knowledge-document-fixture.txt'
  const signal = new AbortController().signal
  const inspection = await workspaceFileRead.inspect(path, { signal })
  assert.deepEqual(
    inspection,
    { relativePath: path, revision: 'a0c34f12', byteLength: 13, mimeType: 'text/plain' },
    'knowledge workspace inspection exposes only a bounded virtual text file with its durable content revision',
  )
  const read = await workspaceFileRead.readText(path, { signal, maxBytes: 13 })
  assert.equal(read.text, 'first\n\nsecond', 'knowledge workspace read restores chunks in durable ordinal order')
  assert.equal(read.mimeType, 'text/plain', 'knowledge workspace projection never exposes the source document MIME type')
  assert.ok(observedSignals.every((candidate) => candidate === signal), 'knowledge workspace reads propagate the exact caller cancellation signal')
  await assert.rejects(
    () => workspaceFileRead.readText('knowledge/../outside.txt', { signal, maxBytes: 13 }),
    (error) => error?.code === 'path_outside_workspace',
    'knowledge workspace rejects a path outside its independently checked virtual root',
  )
  await assert.rejects(
    () => workspaceFileRead.readText(path, { signal, maxBytes: 12 }),
    (error) => error?.code === 'size_limit_exceeded',
    'knowledge workspace read enforces its caller byte bound before exposing document text',
  )
  const noReadyDocumentPort = createKnowledgeWorkspaceFileReadPort({
    repository: {
      async listDocuments() { return [{ ...document, status: 'extracting' }] },
      async listChunks() { throw new Error('non-ready documents do not load chunks') },
    },
  })
  assert.equal(await noReadyDocumentPort.inspect(path, { signal }), undefined, 'non-ready knowledge documents are never projected as workspace files')
  assert.deepEqual(
    listRunnableBuiltInCapabilityToolNames({
      admission: { async admit() { return { status: 'unavailable' } } },
      workspaceFileRead,
    }),
    ['read_file'],
    'a read-only workspace port enables read_file without enabling edit_file',
  )

  const durableTasks = new Map()
  const binding = createBuiltInCapabilityRuntimeBinding({
    admission: createBuiltInCapabilityTaskAdmissionPort(async (taskId) => durableTasks.get(taskId)),
    workspaceFileRead,
  })
  assert.deepEqual(
    binding.manifests.filter((manifest) => manifest.enabled).map((manifest) => manifest.name),
    ['read_file'],
    'the bootstrap binding advertises the knowledge workspace read port without an unsafe edit capability',
  )
  assert.equal(binding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:edit_file`), undefined, 'read-only knowledge workspace does not bind edit_file')
  const adapter = binding.resolveAdapter(`builtin:${BUILT_IN_CAPABILITY_SERVER_ID}:read_file`)
  assert.ok(adapter, 'read-only knowledge workspace binds read_file')
  durableTasks.set('knowledge-read-task', {
    id: 'knowledge-read-task',
    toolId: adapter.definition.id,
    idempotencyKey: 'knowledge-read-idempotency',
    status: 'running',
    policy: { outcome: 'allowed' },
  })
  const result = await adapter.execute({
    taskId: 'knowledge-read-task',
    tool: adapter.definition,
    arguments: { path, maxBytes: 13 },
  }, { signal })
  assert.equal(result.capabilityOutcome.code, 'completed', 'task-admitted knowledge workspace read completes through the target adapter')
  assert.equal(result.observation.blocks[0]?.text, 'first\n\nsecond', 'task-admitted knowledge workspace read returns bounded durable text')
}

function runMcpToolRequestParserTests() {
  assert.deepEqual(
    parseMcpToolRequest(`<${MCP_TOOL_CALL_TAG}>{"tool":"github/search","arguments":{"query":"islemind"}}</${MCP_TOOL_CALL_TAG}>`),
    { serverId: 'github', toolName: 'search', arguments: { query: 'islemind' } },
    'target parser admits tagged slash-qualified requests',
  )
  assert.deepEqual(
    parseMcpToolRequest('{"serverId":"explicit","name":"context7:resolve-library-id","input":{"library":"react"}}'),
    { serverId: 'explicit', toolName: 'resolve-library-id', arguments: { library: 'react' } },
    'target parser admits direct JSON aliases and explicit server precedence',
  )
  assert.deepEqual(
    parseMcpToolRequest('{"toolName":"playwright/browser.goto","args":["https://example.com"]}'),
    { serverId: 'playwright', toolName: 'browser.goto', arguments: {} },
    'target parser normalizes non-object arguments to an empty object',
  )
  const boundaryText = 'x'.repeat(MCP_TOOL_REQUEST_LIMITS.argumentStringChars)
  assert.equal(
    parseMcpToolRequest(JSON.stringify({ tool: 'server/tool', arguments: { text: boundaryText } })).arguments.text.length,
    MCP_TOOL_REQUEST_LIMITS.argumentStringChars,
    'target parser admits the documented argument-string boundary',
  )
  assert.equal(parseMcpToolRequest('{"tool":"server/tool","arguments":{"value":NaN}}'), null, 'target parser rejects malformed non-finite JSON')
  assert.equal(
    parseMcpToolRequest(JSON.stringify({ tool: `server/${'x'.repeat(MCP_TOOL_REQUEST_LIMITS.identityChars + 1)}`, arguments: {} })),
    null,
    'target parser rejects over-limit identities',
  )
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
