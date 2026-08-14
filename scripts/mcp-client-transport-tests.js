const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const originalFetch = global.fetch
const savedValues = []
const UNSAFE_SESSION_MARKER = 'sk-mcp-session-header-must-not-leak'

registerTypeScriptSupport()

const {
  callMcpTool,
} = require('../src/bootstrap/mcpExecutionRuntime.ts')
const {
  refreshMcpManifest,
  saveMcpServers,
} = require('../src/bootstrap/mcpCatalog.ts')
const {
  createMcpClientAdapter,
  createMcpHttpClient,
  createMcpToolRequestHeaders,
} = require('../src/modules/integrations/index.ts')

function registerTypeScriptSupport() {
  if (!require.extensions['.ts']?.isMcpClientTransportHook) {
    Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
      if (request.startsWith('@/')) {
        return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
      }
      return originalResolve.call(this, request, parent, isMain, options)
    }

    const hook = function compileTypeScript(module, filename) {
      const source = fs.readFileSync(filename, 'utf8')
      const output = ts.transpileModule(source, {
        compilerOptions: {
          esModuleInterop: true,
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
          moduleResolution: ts.ModuleResolutionKind.NodeJs,
          target: ts.ScriptTarget.ES2021,
        },
        fileName: filename,
      })
      module._compile(output.outputText, filename)
    }
    hook.isMcpClientTransportHook = true
    require.extensions['.ts'] = hook
    require.extensions['.tsx'] = hook
  }

  Module._load = function loadWithMcpClientMocks(request, parent, isMain) {
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
          throw new Error('expo-sqlite is unavailable in the Node MCP client harness')
        },
      }
    }
    if (request === '@/bootstrap/applicationDataRecords') {
      return {
        readApplicationDataRecord: async () => [],
        writeApplicationDataRecord: async (key, value) => savedValues.push({ key, value }),
      }
    }
    if (request === '@/bootstrap/webSearchProviderRuntime') {
      return {
        builtInWebSearchPort: {
          search: async () => [],
        },
      }
    }
    if (request === '@/bootstrap/builtInWorkspaceFileRuntime') {
      return {
        builtInWorkspaceFileReadPort: {
          workspaceScopeId: 'mcp-client-read-only-workspace',
          inspect: async () => undefined,
          readText: async () => { throw new Error('workspace read is not used by the MCP client transport fixture') },
        },
        builtInWritableWorkspaceFilePort: undefined,
      }
    }
    if (request === '@/i18n/service') return { st: (key) => key }
    if (request === '@/services/runtimeHealthLog') return { logMcpOperation: async () => undefined }
    return originalLoad.call(this, request, parent, isMain)
  }
}

function streamableServer(id) {
  return {
    id,
    name: `Streamable ${id}`,
    url: `https://example.test/${id}`,
    transport: 'streamable-http',
    enabled: true,
    status: 'connected',
    manifestTtlMs: 60_000,
    tools: [],
    resources: [],
    prompts: [],
    approvedToolNames: [],
    createdAt: 2_000_000_000_000,
    updatedAt: 2_000_000_000_000,
  }
}

function sseServer(id) {
  return {
    ...streamableServer(id),
    transport: 'sse',
    version: 'legacy-sse',
  }
}

function inspectTool(serverId) {
  return {
    name: 'inspect',
    permission: 'read-only',
    serverId,
    enabled: true,
  }
}

function jsonResponse(result, { error, rawText, sessionId, status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? sessionId ?? null : null },
    text: async () => rawText !== undefined
      ? rawText
      : result === undefined && error === undefined
        ? ''
        : JSON.stringify({
            jsonrpc: '2.0',
            id: 'response',
            ...(error === undefined ? { result } : { error }),
          }),
  }
}

async function run() {
  const requests = []
  const sessionsByServerId = new Map()
  const parallelListResolvers = new Map()
  let expiredLegacyToolCallCount = 0
  let cancelEstablishedSessionList = false
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body)
    const headers = init.headers ?? {}
    const sessionId = headers['Mcp-Session-Id']
    const serverId = String(url).split('/').at(-1)
    const request = {
      serverId,
      method: body.method,
      hasId: Object.hasOwn(body, 'id'),
      sessionId,
      signal: init.signal,
      arguments: body.params?.arguments,
      params: body.params,
      headers,
      protocolHeader: headers['MCP-Protocol-Version'],
      methodHeader: headers['Mcp-Method'],
      nameHeader: headers['Mcp-Name'],
    }
    requests.push(request)

    if (body.method === 'server/discover') {
      assert.equal(sessionId, undefined, 'latest discovery is stateless')
      if (serverId === 'context7') {
        return jsonResponse(undefined, {
          status: 400,
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        })
      }
      if (serverId === 'legacy-expired' || serverId === 'unsafe') {
        return jsonResponse(undefined, { status: 400, rawText: '' })
      }
      if (serverId === 'learn') {
        return jsonResponse(undefined, { error: { code: -32601, message: 'Method not found' } })
      }
      if (serverId === 'modern-error') {
        return jsonResponse(undefined, {
          status: 400,
          error: {
            code: -32022,
            message: 'Unsupported protocol version',
            data: { supported: ['2026-07-28'], requested: '1900-01-01' },
          },
        })
      }
      if (serverId === 'modern-method-error') {
        return jsonResponse(undefined, {
          status: 404,
          error: { code: -32601, message: 'Method not found' },
        })
      }
      if (serverId === 'missing-version') {
        return jsonResponse({
          resultType: 'complete',
          supportedVersions: [],
          capabilities: {},
          _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Incomplete', version: '1' } },
        })
      }
      if (
        serverId === 'cancel-latest'
        || (serverId === 'cancel-latest-shared'
          && requests.filter((item) => item.serverId === serverId && item.method === body.method).length === 1)
      ) {
        return new Promise((resolve, reject) => {
          const rejectCancelled = () => {
            const error = new Error('MCP latest discovery cancelled')
            error.name = 'AbortError'
            reject(error)
          }
          if (init.signal?.aborted) rejectCancelled()
          else init.signal?.addEventListener('abort', rejectCancelled, { once: true })
        })
      }
      return jsonResponse({
        resultType: 'complete',
        supportedVersions: ['2026-07-28'],
        capabilities: serverId === 'tools-only'
          ? { tools: {} }
          : { tools: {}, resources: {}, prompts: {} },
        _meta: {
          'io.modelcontextprotocol/serverInfo': {
            name: `latest-${serverId}`,
            version: '2026.7.28',
          },
        },
      })
    }

    if (body.method === 'initialize') {
      assert.equal(sessionId, undefined, 'legacy initialization starts without a session header')
      assert.equal(body.params.protocolVersion, '2025-03-26', 'legacy fallback requests the current legacy protocol')
      const nextSessionId = serverId === 'unsafe'
          ? `session-unsafe\r\nAuthorization: Bearer ${UNSAFE_SESSION_MARKER}`
          : `session-${serverId}`
      if (nextSessionId) sessionsByServerId.set(serverId, nextSessionId)
      return jsonResponse({
        protocolVersion: '2025-03-26',
        serverInfo: { name: `legacy-${serverId}`, version: '2025.3.26' },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      }, { sessionId: nextSessionId })
    }

    assert.equal(sessionId, sessionsByServerId.get(serverId), `${body.method} carries only a negotiated legacy session header`)
    if (body.method === 'notifications/initialized') {
      assert.equal(Object.hasOwn(body, 'id'), false, 'initialized acknowledgement is an MCP notification without a request id')
      return jsonResponse(undefined, { status: 202 })
    }
    if (serverId === 'parallel' && ['tools/list', 'resources/list', 'prompts/list'].includes(body.method)) {
      return await new Promise((resolve) => {
        parallelListResolvers.set(body.method, () => resolve(jsonResponse({ [body.method.split('/')[0]]: [] })))
      })
    }
    if (serverId === 'latest-session-cancel' && body.method === 'tools/list' && cancelEstablishedSessionList) {
      cancelEstablishedSessionList = false
      return new Promise((resolve, reject) => {
        const rejectCancelled = () => {
          const error = new Error('MCP established-session request cancelled')
          error.name = 'AbortError'
          reject(error)
        }
        if (init.signal?.aborted) rejectCancelled()
        else init.signal?.addEventListener('abort', rejectCancelled, { once: true })
      })
    }
    if (body.method === 'tools/list') {
      if (serverId === 'param-header') {
        return jsonResponse({
          tools: [{
            name: 'inspect',
            description: 'Inspect with latest parameter headers',
            inputSchema: {
              type: 'object',
              properties: {
                tenant: { type: 'string', 'x-mcp-header': 'Tenant' },
                attempt: { type: 'integer', 'x-mcp-header': 'Attempt' },
                padded: { type: 'string', 'x-mcp-header': 'Padded' },
                sentinel: { type: 'string', 'x-mcp-header': 'Sentinel' },
                context: {
                  type: 'object',
                  properties: {
                    region: { type: 'string', 'x-mcp-header': 'Region' },
                  },
                },
              },
            },
          }],
        })
      }
      if (serverId === 'invalid-header') {
        return jsonResponse({
          tools: [
            {
              name: 'inspect',
              inputSchema: { type: 'object' },
            },
            {
              name: 'invalid',
              inputSchema: {
                type: 'object',
                properties: {
                  tenant: { type: 'string', 'x-mcp-header': 'Bad Header' },
                },
              },
            },
          ],
        })
      }
      return jsonResponse({
        tools: [
          { name: 'inspect', description: 'Inspect safely', inputSchema: { type: 'object' } },
          { name: 'browser_navigate', description: 'Navigate the controlled browser page.', inputSchema: { type: 'object' } },
        ],
      })
    }
    if (body.method === 'resources/list') return jsonResponse({ resources: [{ uri: 'mcp://example/status', name: 'Status' }] })
    if (body.method === 'prompts/list') return jsonResponse({ prompts: [{ name: 'status_prompt' }] })
    if (body.method === 'resources/read') return jsonResponse({ contents: [] })
    if (body.method === 'tools/call') {
      if (serverId === 'legacy-expired' && expiredLegacyToolCallCount++ === 0) {
        return jsonResponse(undefined, { status: 404, rawText: '' })
      }
      if (serverId === 'input-required') {
        return jsonResponse({
          resultType: 'input_required',
          inputRequests: {
            approval: { method: 'elicitation/create', params: { message: 'Approve?' } },
          },
        })
      }
      if (serverId === 'sse-notifications') {
        return jsonResponse(undefined, {
          rawText: [
            'event: message',
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}',
            '',
            'event: message',
            'data: {"jsonrpc":"2.0","id":"response","result":{"resultType":"complete","content":[{"type":"text","text":"ready after progress"}]}}',
            '',
          ].join('\n'),
        })
      }
      return jsonResponse({ content: [{ type: 'text', text: 'ready' }] })
    }
    throw new Error(`Unexpected MCP method ${body.method}`)
  }

  try {
    const catalogDiscoveryController = new AbortController()
    const refreshed = await refreshMcpManifest(streamableServer('catalog'), { signal: catalogDiscoveryController.signal })
    assert.equal(refreshed.status, 'connected', 'Streamable HTTP manifest refresh succeeds after latest discovery')
    assert.equal(refreshed.version, '2026.7.28', 'manifest refresh retains the discovered server version')
    assert.equal(refreshed.tools.length, 2, 'manifest refresh fetches tool definitions after protocol negotiation')
    assert.deepEqual(
      refreshed.tools.find((tool) => tool.name === 'inspect'),
      {
        name: 'inspect',
        description: 'Inspect safely',
        inputSchema: { type: 'object' },
        permission: 'read-only',
        serverId: 'catalog',
        enabled: false,
      },
      'target discovery normalization preserves the legacy tool manifest shape',
    )
    assert.equal(
      refreshed.tools.find((tool) => tool.name === 'browser_navigate')?.permission,
      'read-write',
      'target MCP permission policy treats browser interaction tools as write-capable',
    )
    assert.equal(savedValues.length > 0, true, 'manifest refresh persists the normalized server record')

    const catalogMethods = requests.filter((request) => request.serverId === 'catalog').map((request) => request.method)
    assert.equal(catalogMethods[0], 'server/discover', 'manifest discovery attempts the latest stateless protocol first')
    assert.equal(catalogMethods.includes('initialize'), false, 'latest success never performs the legacy handshake')
    assert.equal(
      requests.filter((request) => request.serverId === 'catalog').every((request) => request.signal === catalogDiscoveryController.signal),
      true,
      'manifest discovery forwards the exact caller signal through latest negotiation and every list request',
    )

    const latestRequests = requests.filter((request) => request.serverId === 'catalog')
    for (const latestRequest of latestRequests) {
      assert.equal(latestRequest.protocolHeader, '2026-07-28', 'every latest request carries MCP-Protocol-Version')
      assert.equal(latestRequest.methodHeader, latestRequest.method, 'every latest request carries Mcp-Method')
      assert.equal(latestRequest.headers.Accept, 'application/json, text/event-stream', 'latest requests retain Streamable HTTP Accept')
      assert.equal(latestRequest.headers['Content-Type'], 'application/json', 'latest requests retain JSON content type')
      assert.equal(
        latestRequest.params._meta['io.modelcontextprotocol/protocolVersion'],
        '2026-07-28',
        'every latest request carries the namespaced protocol metadata',
      )
      assert.deepEqual(
        latestRequest.params._meta['io.modelcontextprotocol/clientInfo'],
        { name: 'IsleMind', version: '1' },
        'every latest request carries the namespaced client metadata',
      )
      assert.deepEqual(
        latestRequest.params._meta['io.modelcontextprotocol/clientCapabilities'],
        {},
        'every latest request carries the namespaced client capabilities',
      )
    }

    const callResult = await callMcpTool({ ...refreshed, tools: refreshed.tools.map((tool) => ({ ...tool, enabled: true })) }, 'inspect')
    assert.equal(callResult.observation.ok, true, 'tool calls reuse latest protocol negotiation created during discovery')
    assert.equal(callResult.observation.blocks[0]?.text, 'ready', 'tool-call content is preserved after session transport')
    assert.equal(requests.filter((request) => request.serverId === 'catalog' && request.method === 'server/discover').length, 1, 'tool calls do not repeat valid latest negotiation')
    assert.equal(
      requests.find((request) => request.serverId === 'catalog' && request.method === 'tools/call')?.nameHeader,
      'inspect',
      'latest tool calls carry Mcp-Name',
    )

    const targetClient = createMcpClientAdapter()
    const parallelController = new AbortController()
    const parallelDiscovery = targetClient.discover(streamableServer('parallel'), { signal: parallelController.signal })
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(
      [...parallelListResolvers.keys()].sort(),
      ['prompts/list', 'resources/list', 'tools/list'],
      'MCP discovery starts all manifest list requests concurrently after initialization',
    )
    for (const resolve of parallelListResolvers.values()) resolve()
    const parallelResult = await parallelDiscovery
    assert.equal(parallelResult.protocolVersion, '2026-07-28', 'target discovery exposes latest negotiated protocol')
    assert.equal(
      requests.filter((request) => request.serverId === 'parallel').every((request) => request.signal === parallelController.signal),
      true,
      'target MCP discovery preserves exact signal identity across the handshake and parallel list requests',
    )

    const context7Discovery = await targetClient.discover(streamableServer('context7'))
    assert.equal(context7Discovery.protocolVersion, '2025-03-26', 'Context7-style rejection exposes legacy negotiation')
    assert.equal(context7Discovery.version, '2025.3.26', 'legacy fallback preserves the initialized server version')
    const context7Requests = requests.filter((request) => request.serverId === 'context7')
    assert.deepEqual(
      context7Requests.slice(0, 3).map((request) => request.method),
      ['server/discover', 'initialize', 'notifications/initialized'],
      'legacy session-required HTTP 400 explicitly falls back through the legacy handshake',
    )
    assert.equal(context7Requests[0].sessionId, undefined, 'latest attempt never sends a session')
    assert.equal(context7Requests[1].sessionId, undefined, 'legacy initialize starts without a session')
    assert.equal(
      context7Requests.filter((request) => request.method.endsWith('/list')).every((request) => request.sessionId === 'session-context7'),
      true,
      'legacy list requests carry the negotiated Mcp-Session-Id',
    )

    const learnDiscovery = await targetClient.discover(streamableServer('learn'))
    assert.equal(learnDiscovery.protocolVersion, '2025-03-26', 'method-not-found latest response falls back for legacy servers')
    assert.equal(
      requests.filter((request) => request.serverId === 'learn').some((request) => request.method === 'initialize'),
      true,
      'HTTP 200 JSON-RPC method-not-found performs legacy initialization',
    )

    await assert.rejects(
      targetClient.discover(streamableServer('modern-error')),
      /Unsupported protocol version/,
      'recognized modern protocol errors fail closed instead of downgrading',
    )
    assert.equal(
      requests.some((request) => request.serverId === 'modern-error' && request.method === 'initialize'),
      false,
      'recognized modern protocol errors never start a legacy handshake',
    )

    await assert.rejects(
      targetClient.discover(streamableServer('modern-method-error')),
      /Method not found/,
      'a recognized modern HTTP 404 method error is not mistaken for a legacy server',
    )
    assert.equal(
      requests.some((request) => request.serverId === 'modern-method-error' && request.method === 'initialize'),
      false,
      'recognized modern HTTP 404 errors never start a legacy handshake',
    )

    await assert.rejects(
      targetClient.discover(streamableServer('missing-version')),
      /did not advertise 2026-07-28/,
      'modern discovery must explicitly advertise the selected protocol version',
    )

    const toolsOnlyDiscovery = await targetClient.discover(streamableServer('tools-only'))
    assert.equal(toolsOnlyDiscovery.tools.length, 2, 'advertised tool capability remains discoverable')
    assert.deepEqual(toolsOnlyDiscovery.resources, [], 'unadvertised resource capability is not probed')
    assert.deepEqual(toolsOnlyDiscovery.prompts, [], 'unadvertised prompt capability is not probed')
    assert.deepEqual(
      requests.filter((request) => request.serverId === 'tools-only').map((request) => request.method),
      ['server/discover', 'tools/list'],
      'discovery only calls methods declared by server capabilities',
    )

    const parameterServer = streamableServer('param-header')
    const parameterDiscovery = await targetClient.discover(parameterServer)
    const parameterTool = {
      ...parameterDiscovery.tools[0],
      permission: 'read-only',
      serverId: parameterServer.id,
      enabled: true,
    }
    const parameterResult = await targetClient.executeTool({
      server: parameterServer,
      tool: parameterTool,
      arguments: {
        tenant: 'cafe',
        attempt: 3,
        padded: ' padded ',
        sentinel: '=?base64?literal?=',
        context: { region: '台北' },
      },
      signal: new AbortController().signal,
      taskId: 'task-mcp-parameter-headers',
      startedAt: 2_000_000_000_000,
    })
    assert.equal(parameterResult.observation.ok, true, 'valid x-mcp-header tools remain executable')
    const parameterCall = requests.find((request) => request.serverId === 'param-header' && request.method === 'tools/call')
    assert.equal(parameterCall.headers['Mcp-Param-Tenant'], 'cafe', 'string parameter annotations emit Mcp-Param headers')
    assert.equal(parameterCall.headers['Mcp-Param-Attempt'], '3', 'integer parameter annotations emit string header values')
    assert.equal(
      parameterCall.headers['Mcp-Param-Region'],
      `=?base64?${Buffer.from('台北', 'utf8').toString('base64')}?=`,
      'non-ASCII parameter header values use the exact UTF-8 base64 envelope',
    )
    assert.equal(
      parameterCall.headers['Mcp-Param-Padded'],
      `=?base64?${Buffer.from(' padded ', 'utf8').toString('base64')}?=`,
      'leading and trailing whitespace is base64 encoded',
    )
    assert.equal(
      parameterCall.headers['Mcp-Param-Sentinel'],
      `=?base64?${Buffer.from('=?base64?literal?=', 'utf8').toString('base64')}?=`,
      'literal sentinel-shaped values are base64 encoded to avoid ambiguity',
    )

    const headerFilteredDiscovery = await targetClient.discover(streamableServer('invalid-header'))
    assert.deepEqual(
      headerFilteredDiscovery.tools.map((tool) => tool.name),
      ['inspect'],
      'an invalid annotated tool is excluded without hiding valid sibling tools',
    )
    assert.throws(
      () => createMcpToolRequestHeaders({
        type: 'object',
        properties: {
          first: { type: 'string', 'x-mcp-header': 'Tenant' },
          second: { type: 'string', 'x-mcp-header': 'tenant' },
        },
      }, {}),
      /case-insensitively unique/,
      'case-insensitive duplicate parameter headers fail closed',
    )
    assert.throws(
      () => createMcpToolRequestHeaders({
        type: 'object',
        properties: {
          values: { type: 'array', 'x-mcp-header': 'Values', items: { type: 'string' } },
        },
      }, {}),
      /primitive string, integer, or boolean/,
      'array-backed parameter header annotations fail closed',
    )
    assert.throws(
      () => createMcpToolRequestHeaders({
        type: 'object',
        if: {
          properties: {
            tenant: { type: 'string', 'x-mcp-header': 'Tenant' },
          },
        },
      }, {}),
      /statically reachable/,
      'annotations reached through conditional schemas fail closed',
    )
    assert.throws(
      () => createMcpToolRequestHeaders({
        type: 'object',
        properties: {
          attempt: { type: 'integer', 'x-mcp-header': 'Attempt' },
        },
      }, { attempt: Number.MAX_SAFE_INTEGER + 1 }),
      /does not match its primitive schema type/,
      'unsafe integer header values fail closed',
    )

    const namedResourceClient = createMcpHttpClient({
      id: 'named-resource',
      url: 'https://example.test/named-resource',
      transport: 'streamable-http',
    })
    await namedResourceClient.request('resources/read', { uri: 'mcp://example/狀態' })
    const namedResourceRequest = requests.find((request) => request.serverId === 'named-resource' && request.method === 'resources/read')
    assert.equal(
      namedResourceRequest.nameHeader,
      `=?base64?${Buffer.from('mcp://example/狀態', 'utf8').toString('base64')}?=`,
      'non-ASCII Mcp-Name uses the exact UTF-8 base64 envelope',
    )

    const sseController = new AbortController()
    const directSseResult = await targetClient.executeTool({
      server: sseServer('sse-direct'),
      tool: inspectTool('sse-direct'),
      arguments: { query: 'status' },
      signal: sseController.signal,
      taskId: 'task-mcp-sse-direct',
      startedAt: 2_000_000_000_000,
    })
    const directSseRequests = requests.filter((request) => request.serverId === 'sse-direct')
    assert.equal(directSseResult.observation.ok, true, 'SSE MCP execution remains available after target client ownership cutover')
    assert.deepEqual(directSseRequests.map((request) => request.method), ['tools/call'], 'SSE execution remains stateless and skips Streamable HTTP initialization')
    assert.equal(directSseRequests[0]?.signal, sseController.signal, 'SSE execution forwards the exact task cancellation signal')
    assert.equal(directSseRequests[0]?.sessionId, undefined, 'SSE execution never sends a Streamable HTTP session header')
    assert.deepEqual(directSseRequests[0]?.arguments, { query: 'status' }, 'SSE execution preserves canonical tool arguments')
    assert.equal(directSseRequests[0]?.protocolHeader, undefined, 'legacy SSE compatibility does not claim Streamable HTTP protocol negotiation')
    assert.equal(directSseRequests[0]?.params._meta, undefined, 'legacy SSE compatibility preserves the legacy JSON-RPC params')

    const streamedResult = await targetClient.executeTool({
      server: streamableServer('sse-notifications'),
      tool: inspectTool('sse-notifications'),
      arguments: {},
      signal: new AbortController().signal,
      taskId: 'task-mcp-streamed-response',
      startedAt: 2_000_000_000_000,
    })
    assert.equal(
      streamedResult.observation.blocks[0]?.text,
      'ready after progress',
      'request-scoped SSE notifications are skipped before the final JSON-RPC response',
    )

    await assert.rejects(
      targetClient.executeTool({
        server: streamableServer('input-required'),
        tool: inspectTool('input-required'),
        arguments: {},
        signal: new AbortController().signal,
        taskId: 'task-mcp-input-required',
        startedAt: 2_000_000_000_000,
      }),
      /interactive input/,
      'unsupported multi-round-trip tool results fail visibly instead of becoming empty success',
    )

    const queuedAbortController = new AbortController()
    const queuedAbortReason = { code: 'mcp-queued-cancellation' }
    const queuedAbortExecution = targetClient.executeTool({
      server: sseServer('sse-queued-abort'),
      tool: inspectTool('sse-queued-abort'),
      arguments: {},
      signal: queuedAbortController.signal,
      taskId: 'task-mcp-sse-queued-abort',
      startedAt: 2_000_000_000_001,
    })
    queueMicrotask(() => queuedAbortController.abort(queuedAbortReason))
    await assert.rejects(
      queuedAbortExecution,
      (error) => error === queuedAbortReason,
      'queued MCP cancellation preserves a non-Error reason by identity',
    )
    assert.equal(
      requests.some((request) => request.serverId === 'sse-queued-abort' && request.method === 'tools/call'),
      false,
      'queued MCP cancellation cannot start a remote tool request after the session await boundary',
    )

    const transportSwitchServer = streamableServer('transport-switch')
    await targetClient.discover(transportSwitchServer)
    targetClient.reconcile([{ ...transportSwitchServer, transport: 'sse' }])
    await targetClient.discover(transportSwitchServer)
    assert.equal(
      requests.filter((request) => request.serverId === 'transport-switch' && request.method === 'server/discover').length,
      2,
      'MCP reconciliation clears reusable negotiation when the configured transport changes',
    )

    const movedCatalogServer = {
      ...refreshed,
      url: 'https://example.test/catalog-moved',
      tools: refreshed.tools.map((tool) => ({ ...tool, enabled: true })),
    }
    await saveMcpServers([movedCatalogServer])
    const movedCatalogResult = await callMcpTool(movedCatalogServer, 'inspect')
    assert.equal(movedCatalogResult.observation.ok, true, 'catalog updates preserve tool dispatch after a server endpoint changes')
    assert.equal(
      requests.filter((request) => request.serverId === 'catalog-moved' && request.method === 'server/discover').length,
      1,
      'catalog reconciliation invalidates latest negotiation when its endpoint changes',
    )

    const directResult = await callMcpTool({
      ...streamableServer('direct'),
      tools: [{ name: 'inspect', permission: 'read-only', serverId: 'direct', enabled: true }],
    }, 'inspect')
    assert.equal(directResult.observation.ok, true, 'connected Streamable HTTP tool calls create an in-memory handshake when none exists')
    assert.deepEqual(
      requests.filter((request) => request.serverId === 'direct').map((request) => request.method),
      ['server/discover', 'tools/call'],
      'direct Streamable HTTP calls negotiate latest before dispatching tools'
    )

    const invalidatedServer = streamableServer('invalidated')
    await targetClient.discover(invalidatedServer)
    targetClient.invalidate(invalidatedServer)
    await targetClient.discover(invalidatedServer)
    assert.equal(
      requests.filter((request) => request.serverId === 'invalidated' && request.method === 'server/discover').length,
      2,
      'explicit invalidation clears latest negotiation before the next discovery',
    )

    await assert.rejects(
      targetClient.executeTool({
        server: streamableServer('unsafe'),
        tool: inspectTool('unsafe'),
        arguments: {},
        signal: new AbortController().signal,
        taskId: 'task-mcp-unsafe-session',
        startedAt: 2_000_000_000_000,
      }),
      /invalid session identifier/,
      'unsafe legacy session identifiers fail closed before tool dispatch',
    )
    assert.equal(
      requests.some((request) => request.serverId === 'unsafe' && request.method === 'tools/call'),
      false,
      'unsafe legacy session identifiers never reach tool dispatch',
    )

    const legacyExpiredServer = streamableServer('legacy-expired')
    const legacyExpiredInput = {
      server: legacyExpiredServer,
      tool: inspectTool('legacy-expired'),
      arguments: {},
      signal: new AbortController().signal,
      taskId: 'task-mcp-legacy-expired',
      startedAt: 2_000_000_000_000,
    }
    await assert.rejects(targetClient.executeTool(legacyExpiredInput), /HTTP 404/, 'expired legacy sessions surface failed dispatch')
    assert.equal((await targetClient.executeTool(legacyExpiredInput)).observation.ok, true, 'later calls reinitialize after legacy session clearing')
    assert.equal(
      requests.filter((request) => request.serverId === 'legacy-expired' && request.method === 'initialize').length,
      2,
      'failed legacy calls clear Mcp-Session-Id state before the next retry'
    )

    const initializationController = new AbortController()
    const cancelledInitialization = callMcpTool({
      ...streamableServer('cancel-latest'),
      tools: [{ name: 'inspect', permission: 'read-only', serverId: 'cancel-latest', enabled: true }],
    }, 'inspect', {}, undefined, { signal: initializationController.signal })
    await new Promise((resolve) => setImmediate(resolve))
    initializationController.abort()
    const cancelledInitializationResult = await cancelledInitialization
    assert.equal(cancelledInitializationResult.observation.ok, false, 'cancelling during Streamable HTTP initialization stops the MCP call')
    assert.equal(cancelledInitializationResult.observation.status, 'skipped', 'initialization cancellation is projected as a skipped observation')
    assert.equal(cancelledInitializationResult.observation.errorCode, 'cancelled', 'initialization cancellation keeps the target cancellation code')
    assert.equal(cancelledInitializationResult.observation.diagnostic.status, 'cancelled', 'initialization cancellation is projected as a cancelled diagnostic')
    assert.equal(
      requests.some((request) => request.serverId === 'cancel-latest' && request.method === 'tools/call'),
      false,
      'cancellation during latest discovery prevents remote tool dispatch',
    )

    const sharedInitializationClient = createMcpClientAdapter()
    const initializationOwnerController = new AbortController()
    const initializationWaiterController = new AbortController()
    const initializationOwnerReason = { code: 'mcp-initialization-owner-cancelled' }
    const initializationOwner = sharedInitializationClient.discover(
      streamableServer('cancel-latest-shared'),
      { signal: initializationOwnerController.signal },
    )
    await new Promise((resolve) => setImmediate(resolve))
    const initializationWaiter = sharedInitializationClient.discover(
      streamableServer('cancel-latest-shared'),
      { signal: initializationWaiterController.signal },
    )
    initializationOwnerController.abort(initializationOwnerReason)
    await assert.rejects(
      initializationOwner,
      (error) => error === initializationOwnerReason,
      'direct MCP discovery preserves the initialization owner cancellation reason by identity',
    )
    const recoveredSharedDiscovery = await initializationWaiter
    assert.equal(recoveredSharedDiscovery.version, '2026.7.28', 'a concurrent discovery retries after the negotiation owner cancels')
    assert.equal(
      requests.filter((request) => request.serverId === 'cancel-latest-shared' && request.method === 'server/discover').length,
      2,
      'an aborted shared negotiation does not poison a concurrent non-aborted caller',
    )

    const establishedSessionClient = createMcpClientAdapter()
    const establishedSessionServer = streamableServer('latest-session-cancel')
    await establishedSessionClient.discover(establishedSessionServer)
    cancelEstablishedSessionList = true
    const establishedSessionController = new AbortController()
    const establishedSessionReason = { code: 'mcp-established-session-cancelled' }
    const cancelledEstablishedDiscovery = establishedSessionClient.discover(
      establishedSessionServer,
      { signal: establishedSessionController.signal },
    )
    await new Promise((resolve) => setImmediate(resolve))
    establishedSessionController.abort(establishedSessionReason)
    await assert.rejects(
      cancelledEstablishedDiscovery,
      (error) => error === establishedSessionReason,
      'established-session cancellation preserves the exact caller reason',
    )
    await establishedSessionClient.discover(establishedSessionServer)
    assert.equal(
      requests.filter((request) => request.serverId === 'latest-session-cancel' && request.method === 'server/discover').length,
      1,
      'cancelled discovery retains already-established latest negotiation',
    )

    console.log('MCP client transport tests passed')
  } finally {
    global.fetch = originalFetch
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
