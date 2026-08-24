const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Database } = require('bun:sqlite')

async function main() {
  const core = await import('../src/core/index.ts')
  const integrationsModule = await import('../src/modules/integrations/index.ts')
  const tasksModule = await import('../src/modules/tasks/index.ts')
  const database = new Database(':memory:')
  try {
    const storage = createBunSqliteStorage(database)
    let now = 80_000
    const ids = { next: (prefix) => `${prefix}-${++now}` }
    const persistence = tasksModule.createSqliteTaskPersistence(storage)
    const runtime = tasksModule.createTaskRuntime({
      clock: { now: () => ++now },
      ids,
      persistence,
      policyEvaluator: {
        async evaluate(input) {
          if (input.toolId === 'requires-confirmation') {
            return { outcome: 'requires-confirmation', reasonCode: 'user_confirmation_required' }
          }
          if (input.toolId === 'denied-tool') {
            return { outcome: 'denied', reasonCode: 'policy_denied' }
          }
          return { outcome: 'allowed', reasonCode: 'allowed_by_fixture' }
        },
      },
    })

    await testConfirmationAndExecution(core, integrationsModule, runtime, persistence)
    testModelOperationProtocol(integrationsModule)
    testToolArgumentBoundary(integrationsModule)
    await testMcpToolAdapter(core, integrationsModule)
    await testMcpHttpClient(integrationsModule)
    await testLocalToolAdapter(core, integrationsModule)
    testToolManifestPolicy(integrationsModule)
    testToolInputSchemaPolicy(integrationsModule)
    await testPolicyDenial(runtime)
    await testCancellation(runtime, persistence)
    await testQueuedCancellation(runtime, persistence)
    await testRestartRecovery(core, tasksModule, persistence, ids, now)
    await testAtomicPersistence(core, persistence, storage)
    await testCheckpointRecoveryCoordinator(core, tasksModule)
    await testCheckpointV1ToV2Migration(core, tasksModule)
    await testCheckpointJournalRetention(core, tasksModule, database)
  } finally {
    database.close()
  }

  console.log('Task-runtime integration tests passed')
}

function testModelOperationProtocol(integrationsModule) {
  const descriptor = (id, overrides = {}) => ({
    id,
    name: id.replaceAll(':', '_'),
    description: `Fixture operation ${id}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      properties: { value: { type: 'string', minLength: 1 } },
    },
    permission: 'read-only',
    requiresConfirmation: false,
    capabilityScopes: ['fixture:read'],
    executor: { kind: 'builtin', id },
    availability: { status: 'available' },
    ...overrides,
  })
  const created = integrationsModule.createModelOperationCatalogSnapshot([
    descriptor('builtin:fixture:read'),
  ])
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error(created.message)
  assert.equal(Object.isFrozen(created.snapshot), true, 'model-operation catalog snapshots are immutable')
  assert.equal(Object.isFrozen(created.snapshot.operations), true)

  const duplicate = integrationsModule.createModelOperationCatalogSnapshot([
    descriptor('builtin:fixture:duplicate'),
    descriptor('builtin:fixture:duplicate'),
  ])
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.code, 'duplicate_operation_id')
  const overflow = integrationsModule.createModelOperationCatalogSnapshot(
    Array.from({ length: 65 }, (_, index) => descriptor(`builtin:fixture:operation-${index}`)),
  )
  assert.equal(overflow.ok, false)
  assert.equal(overflow.code, 'operation_limit_exceeded')
  assert.equal(overflow.receivedCount, 65, 'catalog overflow fails visibly without a partial catalog')

  const proposal = {
    schema: 'islemind.model-tool-call.v1',
    catalogRevision: created.snapshot.revision,
    operationId: 'builtin:fixture:read',
    arguments: { value: 'ok' },
  }
  const envelope = `<islemind_tool_call>${JSON.stringify(proposal)}</islemind_tool_call>`
  const parsed = integrationsModule.parseModelOperationProposal(envelope)
  assert.equal(parsed.ok, true, 'the strict whole-output envelope is admitted')
  assert.deepEqual(parsed.proposal.arguments, { value: 'ok' })
  const malformedCases = [
    ['leading prose', `I will call it.\n${envelope}`, 'invalid_envelope'],
    ['malformed JSON', '<islemind_tool_call>{</islemind_tool_call>', 'malformed_json'],
    ['multiple envelopes', `${envelope}${envelope}`, 'multiple_envelopes'],
    ['unknown key', `<islemind_tool_call>${JSON.stringify({ ...proposal, extra: true })}</islemind_tool_call>`, 'unknown_proposal_key'],
    ['oversized output', 'x'.repeat(integrationsModule.MODEL_OPERATION_PROTOCOL_LIMITS.outputChars + 1), 'output_limit_exceeded'],
    ['oversized payload', `<islemind_tool_call>${' '.repeat(integrationsModule.MODEL_OPERATION_PROTOCOL_LIMITS.payloadChars + 1)}</islemind_tool_call>`, 'payload_limit_exceeded'],
  ]
  for (const [label, output, code] of malformedCases) {
    const result = integrationsModule.parseModelOperationProposal(output)
    assert.equal(result.ok, false, `${label} is rejected before execution`)
    assert.equal(result.code, code)
  }

  const admitted = integrationsModule.admitModelOperationCall(created.snapshot, parsed.proposal)
  assert.equal(admitted.ok, true)
  const stale = integrationsModule.admitModelOperationCall(created.snapshot, {
    ...parsed.proposal,
    catalogRevision: 'islemind.model.operation.catalog.v1:stale',
  })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'stale_catalog_revision')
  const invalidArguments = integrationsModule.admitModelOperationCall(created.snapshot, {
    ...parsed.proposal,
    arguments: { value: '' },
  })
  assert.equal(invalidArguments.ok, false)
  assert.equal(invalidArguments.code, 'invalid_arguments')

  const unavailableCatalog = integrationsModule.createModelOperationCatalogSnapshot([
    descriptor('builtin:fixture:unavailable', {
      availability: {
        status: 'unavailable',
        reason: 'adapter_unbound',
        message: 'The fixture adapter is unavailable.',
      },
    }),
  ])
  assert.equal(unavailableCatalog.ok, true)
  if (!unavailableCatalog.ok) throw new Error(unavailableCatalog.message)
  const unavailable = integrationsModule.admitModelOperationCall(unavailableCatalog.snapshot, {
    ...proposal,
    catalogRevision: unavailableCatalog.snapshot.revision,
    operationId: 'builtin:fixture:unavailable',
  })
  assert.equal(unavailable.ok, false)
  assert.equal(unavailable.code, 'operation_unavailable')

  const tagged = integrationsModule.formatTaggedModelOperationPrompt(created.snapshot)
  assert.equal(tagged.ok, true)
  assert.equal(tagged.prompt.includes(created.snapshot.revision), true)
  assert.equal(tagged.prompt.includes('the entire model output must be exactly one tool-call envelope'), true)
}

function testToolInputSchemaPolicy(integrationsModule) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['target'],
    properties: {
      target: { type: 'string', minLength: 2 },
      operations: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: { action: { type: 'string', enum: ['copy', 'move'] } },
        },
      },
    },
  }
  assert.deepEqual(integrationsModule.validateToolInputSchema(schema, {
    target: 'ok',
    operations: [{ action: 'copy' }],
  }), { ok: true, errors: [] })
  const invalid = integrationsModule.validateToolInputSchema(schema, {
    target: 'x',
    operations: [{ action: 'delete', extra: true }],
    unknown: true,
  })
  assert.equal(invalid.ok, false)
  assert.ok(invalid.errors.includes('unknown is not allowed.'))
  assert.ok(invalid.errors.includes('operations[0].action must be one of copy, move.'))
  assert.ok(invalid.errors.includes('operations[0].extra is not allowed.'))
}

function testToolManifestPolicy(integrationsModule) {
  const [connected] = integrationsModule.createServerToolManifests({
    source: 'mcp',
    serverId: 'fixture-server',
    serverName: 'Fixture',
    transport: 'streamable-http',
    status: 'connected',
    enabled: true,
    tools: [{ name: 'read', permission: 'read-only', enabled: true }],
  })
  assert.equal(connected.id, 'mcp:fixture-server:read')
  assert.equal(connected.enabled, true)
  const [disconnected] = integrationsModule.createServerToolManifests({
    source: 'mcp',
    serverId: 'fixture-server',
    serverName: 'Fixture',
    status: 'disconnected',
    enabled: true,
    tools: [{ name: 'read', permission: 'read-only', enabled: true }],
  })
  assert.equal(disconnected.enabled, false, 'disconnected remote tools are not admitted')
  assert.deepEqual(integrationsModule.createAppActionToolManifest({
    name: 'get_settings',
    description: 'Read settings',
    permission: 'read-only',
  }), {
    id: 'app-action:get_settings',
    source: 'app-action',
    name: 'get_settings',
    description: 'Read settings',
    permission: 'read-only',
    enabled: true,
  })
}

async function testLocalToolAdapter(core, integrationsModule) {
  const cancellation = new AbortController()
  const requests = []
  const adapter = integrationsModule.createLocalToolAdapter({
    id: 'android:fixture.write',
    source: 'android',
    capabilityScope: ['tool:android:fixture.write', 'permission:read-write'],
    requiresConfirmation: true,
    enabled: true,
  }, async (request, options) => {
    requests.push({ request, signal: options.signal })
    return { summary: 'Android fixture completed.' }
  })
  const result = await adapter.execute({
    taskId: core.asTaskId('task-local-adapter'),
    tool: adapter.definition,
    arguments: { target: 'fixture' },
  }, { signal: cancellation.signal })
  assert.equal(requests[0].signal, cancellation.signal)
  assert.equal(requests[0].request.tool.source, 'android')
  assert.equal(result.summary, 'Android fixture completed.')
  assert.throws(() => integrationsModule.createLocalToolAdapter({
    id: 'builtin:disabled',
    source: 'builtin',
    capabilityScope: ['tool:builtin:disabled'],
    requiresConfirmation: false,
    enabled: false,
  }, async () => ({})), /disabled/)
}

async function testMcpHttpClient(integrationsModule) {
  const requests = []
  const responses = [
    rpcResponse({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {} },
      _meta: {
        'io.modelcontextprotocol/serverInfo': { name: 'target-server', version: '2026.7.28' },
      },
    }),
    rpcResponse({ content: [{ type: 'text', text: 'ready' }] }),
  ]
  const client = integrationsModule.createMcpHttpClient({
    id: 'target-server',
    url: 'https://example.test/mcp',
    transport: 'streamable-http',
  }, {
    requestId: () => 'request-fixture',
    fetch: async (_url, init) => {
      requests.push({ body: JSON.parse(init.body), headers: init.headers, signal: init.signal })
      return responses.shift()
    },
  })
  const cancellation = new AbortController()
  const result = await client.request('tools/call', { name: 'inspect', arguments: {} }, { signal: cancellation.signal })
  assert.deepEqual(requests.map((request) => request.body.method), [
    'server/discover',
    'tools/call',
  ], 'target MCP HTTP client negotiates the latest protocol before dispatch')
  assert.equal(requests[0].headers['MCP-Protocol-Version'], '2026-07-28')
  assert.equal(requests[1].headers['MCP-Protocol-Version'], '2026-07-28')
  assert.equal(requests[1].headers['Mcp-Method'], 'tools/call')
  assert.equal(requests[1].headers['Mcp-Name'], 'inspect')
  assert.equal(requests[1].headers['Mcp-Session-Id'], undefined, 'latest target dispatch remains stateless')
  assert.equal(requests[1].signal, cancellation.signal, 'target MCP transport propagates cancellation')
  assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28')
  assert.deepEqual(result.result.content, [{ type: 'text', text: 'ready' }])
  assert.equal(integrationsModule.sanitizeMcpSessionId('unsafe\r\nheader'), undefined)
}

function rpcResponse(result, sessionId, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'mcp-session-id' ? sessionId ?? null : null },
    text: async () => result === undefined ? '' : JSON.stringify({ jsonrpc: '2.0', id: 'response', result }),
  }
}

function testToolArgumentBoundary(integrationsModule) {
  const source = { nested: { values: [1, 'two', true, null] } }
  const parsed = integrationsModule.parseToolArguments(source)
  assert.deepEqual(parsed, source)
  assert.notEqual(parsed, source)
  assert.notEqual(parsed.nested, source.nested, 'tool input is copied at the integration boundary')

  source.nested.values[0] = 99
  assert.equal(parsed.nested.values[0], 1, 'later provider mutations cannot change task arguments')
  assert.throws(() => integrationsModule.parseToolArguments({ invalid: Number.NaN }),
    integrationsModule.InvalidToolArgumentsError)
  assert.throws(() => integrationsModule.parseToolArguments({ invalid: () => undefined }),
    integrationsModule.InvalidToolArgumentsError)
  const circular = {}
  circular.self = circular
  assert.throws(() => integrationsModule.parseToolArguments(circular),
    integrationsModule.InvalidToolArgumentsError)

  const diagnosticMetadata = { errorCode: 'cancelled' }
  diagnosticMetadata.self = diagnosticMetadata
  const wideMetadata = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key-${index}`, 'x'.repeat(5_000)]))
  wideMetadata.toolId = 'spoofed-tool'
  wideMetadata.source = 'spoofed-source'
  const normalized = integrationsModule.normalizeExternalToolExecutionResult({
    toolId: 'mcp:fixture:cancel',
    source: 'mcp',
    name: 'fixture.cancel',
    ok: false,
    metadata: wideMetadata,
    blocks: [
      { type: 'text', text: 'Cancelled.' },
      { type: 'image', data: 'fixture-image', mimeType: 'image/png' },
      { type: 'resource', uri: 'file:///fixture.txt', name: 'fixture.txt' },
    ],
    diagnostic: {
      id: 'fixture-cancelled',
      type: 'tool',
      title: 'Fixture cancelled',
      status: 'cancelled',
      metadata: diagnosticMetadata,
    },
  })
  assert.equal(normalized.observation.errorCode, 'cancelled')
  assert.equal(normalized.observation.status, 'skipped')
  assert.deepEqual(normalized.observation.blocks.map((block) => block.type), ['text', 'image', 'resource'])
  assert.equal(normalized.observation.diagnostic.metadata.self.self, '[circular]', 'diagnostic metadata is copied into bounded JSON')
  assert.equal(normalized.observation.metadata.toolId, 'mcp:fixture:cancel', 'target tool identity cannot be spoofed by source metadata')
  assert.equal(normalized.observation.metadata.source, 'mcp', 'target source identity cannot be spoofed by source metadata')
  assert.ok(Object.keys(normalized.observation.metadata).length <= 128, 'observation metadata has a global key bound')
  assert.ok(Object.values(normalized.observation.metadata)
    .filter((value) => typeof value === 'string')
    .reduce((total, value) => total + value.length, 0) <= 65_536,
  'observation metadata has a global string-value budget')
}

async function testMcpToolAdapter(core, integrationsModule) {
  const cancellation = new AbortController()
  const calls = []
  const adapter = integrationsModule.createMcpToolAdapter({
    name: 'delete_note',
    permission: 'destructive',
    serverId: 'notes-server',
    enabled: true,
  }, {
    async callTool(input, options) {
      calls.push({ input, signal: options.signal })
      const circular = { type: 'unexpected' }
      circular.self = circular
      return [
        { type: 'text', text: 'Deleted.' },
        { type: 'resource', uri: 'file:///notes/deleted.txt', text: 'Deleted note' },
        circular,
      ]
    },
  })
  assert.deepEqual(adapter.definition, {
    id: 'mcp:notes-server:delete_note',
    source: 'mcp',
    capabilityScope: ['server:notes-server', 'tool:delete_note', 'permission:destructive'],
    requiresConfirmation: true,
  })
  const result = await adapter.execute({
    taskId: core.asTaskId('task-mcp-adapter'),
    tool: adapter.definition,
    arguments: { noteId: 'note-1' },
  }, { signal: cancellation.signal })
  assert.equal(calls[0].signal, cancellation.signal, 'MCP target adapters propagate task cancellation')
  assert.deepEqual(calls[0].input, {
    serverId: 'notes-server',
    toolName: 'delete_note',
    arguments: { noteId: 'note-1' },
  })
  assert.deepEqual(result.observation.blocks, [
    { type: 'text', text: 'Deleted.' },
    { type: 'resource', uri: 'file:///notes/deleted.txt', text: 'Deleted note' },
    { type: 'text', text: '[invalid MCP content]' },
  ], 'untrusted MCP results normalize without throwing on circular unexpected blocks')
  assert.equal(result.summary, 'Deleted.\nDeleted note\n[invalid MCP content]')
  assert.equal(Object.hasOwn(result, 'content'), false, 'MCP adapters do not expose the legacy content alias')
  assert.equal(Object.hasOwn(result, 'ok'), false, 'MCP adapters do not expose the legacy ok alias')
  assert.equal(Object.hasOwn(result, 'trace'), false, 'MCP adapters do not expose the legacy trace alias')
  const boundedAdapter = integrationsModule.createMcpToolAdapter({
    name: 'list_notes',
    permission: 'read-only',
    serverId: 'notes-server',
    enabled: true,
  }, {
    async callTool() {
      return Array.from({ length: 200 }, (_, index) => ({
        type: 'unexpected',
        index,
        nested: Array.from({ length: 200 }, () => 'x'.repeat(100)),
      }))
    },
  })
  const bounded = await boundedAdapter.execute({
    taskId: core.asTaskId('task-mcp-bounded-adapter'),
    tool: boundedAdapter.definition,
    arguments: {},
  }, { signal: cancellation.signal })
  assert.equal(bounded.observation.blocks.length, 64, 'MCP adapters bound untrusted content at the target observation boundary')
  assert.throws(() => integrationsModule.createMcpToolAdapter({
    name: 'disabled',
    permission: 'read-only',
    serverId: 'notes-server',
    enabled: false,
  }, { async callTool() { return [] } }), /disabled/)
  assert.throws(() => integrationsModule.createMcpToolAdapter({
    name: 'spaced_tool',
    permission: 'read-only',
    serverId: ' notes-server ',
    enabled: true,
  }, { async callTool() { return [] } }), /canonical server and tool identities/)
  assert.throws(() => integrationsModule.createMcpToolAdapter({
    name: ' spaced_tool ',
    permission: 'read-only',
    serverId: 'notes-server',
    enabled: true,
  }, { async callTool() { return [] } }), /canonical server and tool identities/)
  assert.throws(() => integrationsModule.createMcpToolAdapter({
    name: 'spaced:tool',
    permission: 'read-only',
    serverId: 'notes-server',
    enabled: true,
  }, { async callTool() { return [] } }), /canonical server and tool identities/)
  assert.throws(() => integrationsModule.createMcpToolAdapter({
    name: 'spaced\ntool',
    permission: 'read-only',
    serverId: 'notes-server',
    enabled: true,
  }, { async callTool() { return [] } }), /canonical server and tool identities/)
}

async function testConfirmationAndExecution(core, integrationsModule, runtime, persistence) {
  const created = await runtime.create({
    runId: core.asAssistantRunId('run-task-confirmation'),
    toolId: 'requires-confirmation',
    idempotencyKey: 'fixture-confirmation-task',
  })
  assert.equal(created.ok, true, 'task creation persists a policy decision')
  if (!created.ok) throw new Error(created.error.message)
  assert.equal(created.value.status, 'awaiting-confirmation')
  assert.equal(created.value.policy.outcome, 'requires-confirmation')

  const blocked = await runtime.execute(created.value.id, { async execute() { return {} } })
  assert.equal(blocked.ok, false)
  if (blocked.ok) throw new Error('Expected confirmation gate.')
  assert.equal(blocked.error.code, 'confirmation_required')

  const confirmed = await runtime.confirm(created.value.id, { confirmationId: 'visible-confirmation-1' })
  assert.equal(confirmed.ok, true, 'visible confirmation queues the task')
  if (!confirmed.ok) throw new Error(confirmed.error.message)
  assert.equal(confirmed.value.status, 'queued')

  const completed = await runtime.execute(confirmed.value.id, integrationsModule.createToolTaskExecutor({
    definition: {
      id: 'requires-confirmation',
      source: 'mcp',
      capabilityScope: ['files.export'],
      requiresConfirmation: true,
    },
    async execute(request) {
      assert.equal(request.taskId, confirmed.value.id, 'integration adapters receive the durable task identity')
      assert.equal(request.arguments.destination, 'archive')
      return {
        summary: 'Created the requested export.',
        artifacts: [{
          id: 'artifact-export-1',
          label: 'Export archive',
          uri: 'file:///exports/archive.zip',
          mediaType: 'application/zip',
          sizeBytes: 512,
          checksum: 'sha256:test',
          createdAt: 0,
        }],
      }
    },
  }, { arguments: { destination: 'archive' } }))
  assert.equal(completed.ok, true, 'confirmed task completes through the shared runtime')
  if (!completed.ok) throw new Error(completed.error.message)
  assert.equal(completed.value.status, 'succeeded')
  assert.equal(completed.value.result.summary, 'Created the requested export.')
  assert.deepEqual(completed.value.result.artifactIds, ['artifact-export-1'])
  assert.deepEqual(
    (await persistence.list(completed.value.id)).map((entry) => entry.type),
    ['task.created', 'task.confirmed', 'task.started', 'task.artifact-recorded', 'task.succeeded'],
  )

  const duplicate = await runtime.create({
    toolId: 'requires-confirmation',
    idempotencyKey: 'fixture-confirmation-task',
  })
  assert.equal(duplicate.ok, true, 'idempotency resolves to the original durable task')
  if (!duplicate.ok) throw new Error(duplicate.error.message)
  assert.equal(duplicate.value.id, completed.value.id)
}

async function testPolicyDenial(runtime) {
  const denied = await runtime.create({
    toolId: 'denied-tool',
    idempotencyKey: 'fixture-denied-task',
  })
  assert.equal(denied.ok, true, 'policy denials remain durable and attributable')
  if (!denied.ok) throw new Error(denied.error.message)
  assert.equal(denied.value.status, 'failed')
  assert.equal(denied.value.failure.code, 'policy_denied')

  const execution = await runtime.execute(denied.value.id, { async execute() { throw new Error('must not execute') } })
  assert.equal(execution.ok, false)
  if (execution.ok) throw new Error('Expected denied task to remain blocked.')
  assert.equal(execution.error.code, 'policy_denied')
}

async function testCancellation(runtime, persistence) {
  const created = await runtime.create({
    toolId: 'cancellable-tool',
    idempotencyKey: 'fixture-cancellable-task',
  })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error(created.error.message)

  let executorStarted
  const executorStartedPromise = new Promise((resolve) => {
    executorStarted = resolve
  })
  const execution = runtime.execute(created.value.id, {
    async execute(_task, options) {
      executorStarted()
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
      return { summary: 'This result must not be persisted after cancellation.' }
    },
  })
  await executorStartedPromise
  const cancellation = await runtime.cancel(created.value.id)
  assert.equal(cancellation.ok, true, 'active cancellation is journaled before the executor settles')
  const result = await execution
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected cancelled task result.')
  assert.equal(result.error.code, 'cancelled')
  assert.deepEqual(
    (await persistence.list(created.value.id)).map((entry) => entry.type),
    ['task.created', 'task.started', 'task.cancellation-requested', 'task.cancelled'],
  )
}

async function testQueuedCancellation(runtime, persistence) {
  const created = await runtime.create({
    toolId: 'queued-cancellation-tool',
    idempotencyKey: 'fixture-queued-cancellation-task',
  })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error(created.error.message)
  const cancelled = await runtime.cancel(created.value.id)
  assert.equal(cancelled.ok, true, 'queued tasks keep a cancellation-request audit record')
  if (!cancelled.ok) throw new Error(cancelled.error.message)
  assert.equal(cancelled.value.status, 'cancelled')
  assert.deepEqual(
    (await persistence.list(created.value.id)).map((entry) => entry.type),
    ['task.created', 'task.cancellation-requested', 'task.cancelled'],
  )
}

async function testRestartRecovery(core, tasksModule, persistence, ids, initialNow) {
  let now = initialNow + 1_000
  const runtime = tasksModule.createTaskRuntime({
    clock: { now: () => ++now },
    ids,
    persistence,
    policyEvaluator: { async evaluate() { return { outcome: 'allowed', reasonCode: 'allowed' } } },
  })
  const created = await runtime.create({ toolId: 'recovery-tool', idempotencyKey: 'fixture-recovery-task' })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error(created.error.message)
  const running = {
    ...created.value,
    status: 'running',
    startedAt: ++now,
    journalSequence: 2,
  }
  await persistence.appendAndSave({
    schema: 'islemind.task-journal-entry.v1',
    taskId: created.value.id,
    sequence: 2,
    type: 'task.started',
    occurredAt: running.startedAt,
  }, running)

  const recovered = await runtime.recoverInterruptedTasks()
  assert.equal(recovered.ok, true, 'restart recovery terminates unknown in-flight side effects safely')
  if (!recovered.ok) throw new Error(recovered.error.message)
  assert.equal(recovered.value.length, 1)
  assert.equal(recovered.value[0].status, 'failed')
  assert.equal(recovered.value[0].failure.code, 'interrupted')
}

async function testAtomicPersistence(core, persistence, storage) {
  const task = {
    schema: 'islemind.task.v1',
    id: core.asTaskId('task-atomic'),
    toolId: 'atomic-tool',
    idempotencyKey: 'fixture-atomic-task',
    status: 'queued',
    policy: { outcome: 'allowed', reasonCode: 'allowed' },
    createdAt: 1,
    journalSequence: 1,
    artifacts: [],
  }
  await persistence.appendAndSave({
    schema: 'islemind.task-journal-entry.v1',
    taskId: task.id,
    sequence: 1,
    type: 'task.created',
    occurredAt: 1,
  }, task)
  const started = { ...task, status: 'running', startedAt: 2, journalSequence: 2 }
  const entry = {
    schema: 'islemind.task-journal-entry.v1',
    taskId: task.id,
    sequence: 2,
    type: 'task.started',
    occurredAt: 2,
  }
  await persistence.appendAndSave(entry, started)
  await assert.rejects(
    persistence.appendAndSave(entry, { ...started, status: 'cancelled', completedAt: 3 }),
    'a duplicate task journal entry rolls back its paired task-state update',
  )
  const stored = await persistence.get(task.id)
  assert.equal(stored.status, 'running')
  assert.equal(stored.journalSequence, 2)

  const database = await storage.get()
  await database.run(
    `INSERT INTO assistant_tasks (
       id, runId, toolId, idempotencyKey, status, createdAt, startedAt,
       confirmationRequestedAt, confirmationConfirmedAt, cancellationRequestedAt, completedAt,
       journalSequence, policyJson, artifactsJson, resultJson, failureJson, schema
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'task-corrupt',
      null,
      'corrupt-tool',
      'fixture-corrupt-task',
      'queued',
      1,
      null,
      null,
      null,
      null,
      null,
      1,
      JSON.stringify({ outcome: 'allowed', reasonCode: 'allowed' }),
      JSON.stringify({ not: 'an artifact list' }),
      null,
      null,
      'islemind.task.v1',
    ],
  )
  await assert.rejects(
    persistence.get(core.asTaskId('task-corrupt')),
    /invalid/i,
    'invalid task envelopes are rejected at the SQLite boundary',
  )
}

async function testCheckpointV1ToV2Migration(core, tasksModule) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-checkpoint-v2-'))
  try {
    const freshPath = path.join(tempRoot, 'fresh.sqlite')
    const freshRunId = core.asAssistantRunId('checkpoint-v2-fresh')
    const freshSignal = new AbortController().signal
    let freshDatabase = new Database(freshPath)
    let freshSignals = []
    let freshStore = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(freshDatabase, freshSignals),
      ),
    )
    let fresh = await freshStore.recover(freshRunId, freshSignal)
    assert.equal(fresh.ok, false, 'fresh v2 storage contains no synthetic checkpoint')
    if (fresh.ok) throw new Error('Expected a fresh checkpoint store to be empty.')
    assert.equal(fresh.error.code, 'not_found')
    assert.deepEqual(checkpointTableNames(freshDatabase), targetCheckpointTables)
    assert.deepEqual(
      freshDatabase.query('SELECT id, schema, version FROM workflow_checkpoint_storage').get(),
      { id: 1, schema: 'islemind.workflow-checkpoint-storage.v2', version: 2 },
      'fresh initialization commits the exact v2 ready marker',
    )
    assert.ok(freshSignals.every((candidate) => candidate === freshSignal))
    freshDatabase.close()

    freshDatabase = new Database(freshPath)
    freshSignals = []
    freshStore = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(freshDatabase, freshSignals),
      ),
    )
    fresh = await freshStore.recover(freshRunId, freshSignal)
    assert.equal(fresh.ok, false, 'fresh v2 initialization is idempotent after close/reopen')
    if (fresh.ok) throw new Error('Expected the reopened fresh checkpoint store to remain empty.')
    assert.equal(fresh.error.code, 'not_found')
    assert.deepEqual(checkpointTableNames(freshDatabase), targetCheckpointTables)
    assert.deepEqual(
      freshDatabase.query('SELECT id, schema, version FROM workflow_checkpoint_storage').get(),
      { id: 1, schema: 'islemind.workflow-checkpoint-storage.v2', version: 2 },
    )
    assert.ok(freshSignals.every((candidate) => candidate === freshSignal))
    freshDatabase.close()

    const migratedPath = path.join(tempRoot, 'migrated.sqlite')
    const migratedRunId = core.asAssistantRunId('checkpoint-v1-migrated')
    let database = new Database(migratedPath)
    seedLegacyCheckpointDatabase(database, migratedRunId, { firstRevision: 3, lastRevision: 4 })
    database.close()

    database = new Database(migratedPath)
    let observedSignals = []
    let store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, observedSignals),
      ),
    )
    const signal = new AbortController().signal
    const migrated = await store.recover(migratedRunId, signal)
    assert.equal(migrated.ok, true, 'a disk-backed v1 checkpoint migrates on first v2 recovery')
    if (!migrated.ok) throw new Error(migrated.error.message)
    assert.equal(migrated.value.checkpoint.schema, tasksModule.WORKFLOW_CHECKPOINT_SCHEMA)
    assert.equal(migrated.value.checkpoint.revision, 4)
    assert.equal(migrated.value.checkpoint.goalHash, 'legacy-checkpoint-goal')
    assert.equal(migrated.value.checkpoint.evidence[0]?.id, 'legacy-checkpoint-evidence')
    assert.equal(migrated.value.replaySideEffects, false)
    assert.deepEqual(checkpointTableNames(database), targetCheckpointTables)
    assert.equal(
      database.query('SELECT schema FROM workflow_checkpoints WHERE runId = ?').get(migratedRunId).schema,
      'islemind.workflow-checkpoint-row.v2',
    )
    assert.deepEqual(
      database.query('SELECT sequence FROM workflow_checkpoint_journal WHERE runId = ? ORDER BY sequence').all(migratedRunId).map((row) => Number(row.sequence)),
      [3, 4],
      'migration preserves a pruned retained tail without synthesizing revision one',
    )
    assert.ok(observedSignals.every((candidate) => candidate === signal))
    database.close()

    database = new Database(migratedPath)
    observedSignals = []
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, observedSignals),
      ),
    )
    const reopened = await store.recover(migratedRunId, signal)
    assert.equal(reopened.ok, true, 'the neutral checkpoint survives a second disk close/reopen')
    if (!reopened.ok) throw new Error(reopened.error.message)
    assert.equal(reopened.value.checkpoint.revision, 4)
    assert.equal(reopened.value.replaySideEffects, false)

    const current = reopened.value.checkpoint
    const next = Object.freeze({
      ...current,
      revision: current.revision + 1,
      journalSequence: current.journalSequence + 1,
      updatedAt: current.updatedAt + 1,
    })
    const entry = Object.freeze({
      schema: tasksModule.WORKFLOW_CHECKPOINT_JOURNAL_SCHEMA,
      runId: migratedRunId,
      sequence: next.journalSequence,
      revision: next.revision,
      type: 'workflow.progressed',
      occurredAt: next.updatedAt,
      toStatus: 'running',
      fromStatus: 'running',
    })
    const appended = await store.persist({
      expectedRevision: current.revision,
      checkpoint: next,
      entry,
      signal,
    })
    assert.equal(appended.ok, true, 'new writes after migration use the v2 checkpoint contract')
    const stale = await store.persist({
      expectedRevision: current.revision,
      checkpoint: next,
      entry,
      signal,
    })
    assert.equal(stale.ok, false)
    if (stale.ok) throw new Error('Expected stale checkpoint append to fail.')
    assert.equal(stale.error.code, 'conflict', 'post-migration CAS rejects a competing stale append')
    assert.equal(
      Number(database.query('SELECT COUNT(*) AS count FROM workflow_checkpoint_journal WHERE runId = ?').get(migratedRunId).count),
      3,
      'a rejected CAS append adds no journal row',
    )
    database.close()

    const fallbackPath = path.join(tempRoot, 'fallback.sqlite')
    const fallbackRunId = core.asAssistantRunId('checkpoint-v1-fallback')
    database = new Database(fallbackPath)
    seedLegacyCheckpointDatabase(database, fallbackRunId, { firstRevision: 5, lastRevision: 6 })
    database.query('UPDATE agent_workflow_checkpoints SET checkpointJson = ? WHERE runId = ?')
      .run('{"invalid":"current"}', fallbackRunId)
    database.query('UPDATE agent_workflow_checkpoint_journal SET checkpointJson = ? WHERE runId = ? AND sequence = ?')
      .run('{"invalid":"suffix"}', fallbackRunId, 6)
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, []),
      ),
    )
    const fallback = await store.recover(fallbackRunId, signal)
    assert.equal(fallback.ok, true, 'v1 corruption after a safe retained anchor preserves the old recovery rule')
    if (!fallback.ok) throw new Error(fallback.error.message)
    assert.equal(fallback.value.checkpoint.revision, 5)
    assert.equal(fallback.value.replaySideEffects, false)
    assert.deepEqual(
      database.query('SELECT sequence FROM workflow_checkpoint_journal WHERE runId = ? ORDER BY sequence').all(fallbackRunId).map((row) => Number(row.sequence)),
      [5],
      'only the exact valid legacy prefix is migrated',
    )
    assert.deepEqual(checkpointTableNames(database), targetCheckpointTables)
    database.close()

    const corruptPath = path.join(tempRoot, 'corrupt.sqlite')
    const corruptRunId = core.asAssistantRunId('checkpoint-v1-corrupt-anchor')
    database = new Database(corruptPath)
    seedLegacyCheckpointDatabase(database, corruptRunId, { firstRevision: 5, lastRevision: 6 })
    database.query('UPDATE agent_workflow_checkpoint_journal SET checkpointJson = ? WHERE runId = ? AND sequence = ?')
      .run('{"invalid":"first-anchor"}', corruptRunId, 5)
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, []),
      ),
    )
    const corrupt = await store.recover(corruptRunId, signal)
    assert.equal(corrupt.ok, false)
    if (corrupt.ok) throw new Error('Expected corrupt first retained checkpoint anchor to fail.')
    assert.equal(corrupt.error.code, 'corruption')
    assert.deepEqual(checkpointTableNames(database), legacyCheckpointTables, 'failed migration rolls back target DDL and retains v1 source rows')
    database.close()

    const unknownPath = path.join(tempRoot, 'unknown.sqlite')
    const unknownRunId = core.asAssistantRunId('checkpoint-v1-unknown-version')
    database = new Database(unknownPath)
    seedLegacyCheckpointDatabase(database, unknownRunId, { firstRevision: 7, lastRevision: 7 })
    database.query('UPDATE agent_workflow_checkpoints SET schema = ? WHERE runId = ?')
      .run('islemind.workflow-checkpoint-row.unknown', unknownRunId)
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, []),
      ),
    )
    const unknown = await store.recover(unknownRunId, signal)
    assert.equal(unknown.ok, false)
    if (unknown.ok) throw new Error('Expected unknown checkpoint storage version to fail.')
    assert.equal(unknown.error.code, 'corruption')
    assert.deepEqual(checkpointTableNames(database), legacyCheckpointTables)
    database.close()

    const equivalentPath = path.join(tempRoot, 'dual-equivalent.sqlite')
    const equivalentRunId = core.asAssistantRunId('checkpoint-v1-v2-equivalent')
    database = new Database(equivalentPath)
    seedDualCheckpointDatabase(database, equivalentRunId, false)
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, []),
      ),
    )
    const equivalent = await store.recover(equivalentRunId, signal)
    assert.equal(equivalent.ok, true, 'equivalent unmarked v1/v2 copies converge idempotently')
    assert.deepEqual(checkpointTableNames(database), targetCheckpointTables)
    database.close()

    const divergentPath = path.join(tempRoot, 'dual-divergent.sqlite')
    const divergentRunId = core.asAssistantRunId('checkpoint-v1-v2-divergent')
    database = new Database(divergentPath)
    seedDualCheckpointDatabase(database, divergentRunId, true)
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, []),
      ),
    )
    const divergent = await store.recover(divergentRunId, signal)
    assert.equal(divergent.ok, false)
    if (divergent.ok) throw new Error('Expected divergent checkpoint families to fail.')
    assert.equal(divergent.error.code, 'corruption')
    assert.deepEqual(
      checkpointTableNames(database),
      [...legacyCheckpointTables, 'workflow_checkpoint_journal', 'workflow_checkpoints'].sort(),
      'divergent dual-family migration leaves both original families untouched',
    )
    database.close()

    const cancelledPath = path.join(tempRoot, 'cancelled.sqlite')
    const cancelledRunId = core.asAssistantRunId('checkpoint-v1-cancelled')
    database = new Database(cancelledPath)
    seedLegacyCheckpointDatabase(database, cancelledRunId, { firstRevision: 8, lastRevision: 8 })
    const cancellation = new AbortController()
    store = tasksModule.createWorkflowCheckpointStore(
      tasksModule.createSqliteWorkflowCheckpointRepository(
        createBunSqliteCheckpointProvider(database, [], {
          afterOperation({ source }) {
            if (!cancellation.signal.aborted && /INSERT INTO workflow_checkpoints/.test(source)) {
              cancellation.abort()
              const error = new Error('Injected checkpoint migration cancellation.')
              error.name = 'AbortError'
              throw error
            }
          },
        }),
      ),
    )
    const cancelled = await store.recover(cancelledRunId, cancellation.signal)
    assert.equal(cancelled.ok, false)
    if (cancelled.ok) throw new Error('Expected checkpoint migration cancellation.')
    assert.equal(cancelled.error.code, 'cancelled')
    assert.deepEqual(checkpointTableNames(database), legacyCheckpointTables, 'mid-migration cancellation rolls back every v2 effect')
    database.close()
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

const legacyCheckpointTables = [
  'agent_workflow_checkpoint_journal',
  'agent_workflow_checkpoints',
]
const targetCheckpointTables = [
  'workflow_checkpoint_journal',
  'workflow_checkpoint_storage',
  'workflow_checkpoints',
]

function seedLegacyCheckpointDatabase(database, runId, options) {
  createLegacyCheckpointTables(database)
  const snapshots = []
  for (let revision = options.firstRevision; revision <= options.lastRevision; revision += 1) {
    snapshots.push(createCheckpointFixture(runId, revision, 'legacy'))
  }
  insertCheckpointFamily(database, 'legacy', snapshots)
}

function seedDualCheckpointDatabase(database, runId, divergent) {
  createLegacyCheckpointTables(database)
  createTargetCheckpointTables(database)
  const legacySnapshots = [createCheckpointFixture(runId, 9, 'legacy')]
  const targetSnapshots = [createCheckpointFixture(
    runId,
    9,
    'target',
    divergent ? 'divergent-target-goal' : 'legacy-checkpoint-goal',
  )]
  insertCheckpointFamily(database, 'legacy', legacySnapshots)
  insertCheckpointFamily(database, 'target', targetSnapshots)
}

function createCheckpointFixture(runId, revision, format, goalHash = 'legacy-checkpoint-goal') {
  const checkpointSchema = format === 'legacy'
    ? 'islemind.agent-workflow-checkpoint.v1'
    : 'islemind.workflow-checkpoint.v2'
  const journalSchema = format === 'legacy'
    ? 'islemind.agent-workflow-checkpoint-journal.v1'
    : 'islemind.workflow-checkpoint-journal.v2'
  const updatedAt = 10_000 + revision
  const checkpoint = Object.freeze({
    schema: checkpointSchema,
    runId,
    revision,
    journalSequence: revision,
    status: 'running',
    goalHash,
    startedAt: 10_000,
    updatedAt,
    completedSteps: [],
    tasks: [],
    evidence: [{
      id: 'legacy-checkpoint-evidence',
      kind: 'diagnostic',
      summary: 'Persisted migration evidence.',
      recordedAt: 10_001,
    }],
    traces: [],
  })
  const entry = Object.freeze({
    schema: journalSchema,
    runId,
    sequence: revision,
    revision,
    type: 'workflow.progressed',
    occurredAt: updatedAt,
    toStatus: 'running',
    fromStatus: 'running',
  })
  return Object.freeze({ checkpoint, entry })
}

function insertCheckpointFamily(database, format, snapshots) {
  const latest = snapshots[snapshots.length - 1]
  if (!latest) throw new Error('Checkpoint fixture requires at least one snapshot.')
  const checkpointTable = format === 'legacy' ? 'agent_workflow_checkpoints' : 'workflow_checkpoints'
  const journalTable = format === 'legacy' ? 'agent_workflow_checkpoint_journal' : 'workflow_checkpoint_journal'
  const checkpointRowSchema = format === 'legacy'
    ? 'islemind.agent-workflow-checkpoint-row.v1'
    : 'islemind.workflow-checkpoint-row.v2'
  const journalRowSchema = format === 'legacy'
    ? 'islemind.agent-workflow-checkpoint-journal-row.v1'
    : 'islemind.workflow-checkpoint-journal-row.v2'
  database.query(`INSERT INTO ${checkpointTable} (
    runId, revision, journalSequence, updatedAt, checkpointJson, schema
  ) VALUES (?, ?, ?, ?, ?, ?)`).run(
    latest.checkpoint.runId,
    latest.checkpoint.revision,
    latest.checkpoint.journalSequence,
    latest.checkpoint.updatedAt,
    JSON.stringify(latest.checkpoint),
    checkpointRowSchema,
  )
  const statement = database.query(`INSERT INTO ${journalTable} (
    runId, sequence, revision, type, occurredAt, entryJson, checkpointJson, schema
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const snapshot of snapshots) {
    statement.run(
      snapshot.entry.runId,
      snapshot.entry.sequence,
      snapshot.entry.revision,
      snapshot.entry.type,
      snapshot.entry.occurredAt,
      JSON.stringify(snapshot.entry),
      JSON.stringify(snapshot.checkpoint),
      journalRowSchema,
    )
  }
}

function createLegacyCheckpointTables(database) {
  database.exec(`
    CREATE TABLE agent_workflow_checkpoints (
      runId TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL,
      journalSequence INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      checkpointJson TEXT NOT NULL,
      schema TEXT NOT NULL
    );
    CREATE TABLE agent_workflow_checkpoint_journal (
      runId TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      type TEXT NOT NULL,
      occurredAt INTEGER NOT NULL,
      entryJson TEXT NOT NULL,
      checkpointJson TEXT NOT NULL,
      schema TEXT NOT NULL,
      PRIMARY KEY (runId, sequence)
    );
  `)
}

function createTargetCheckpointTables(database) {
  database.exec(`
    CREATE TABLE workflow_checkpoints (
      runId TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL,
      journalSequence INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      checkpointJson TEXT NOT NULL,
      schema TEXT NOT NULL
    );
    CREATE TABLE workflow_checkpoint_journal (
      runId TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      type TEXT NOT NULL,
      occurredAt INTEGER NOT NULL,
      entryJson TEXT NOT NULL,
      checkpointJson TEXT NOT NULL,
      schema TEXT NOT NULL,
      PRIMARY KEY (runId, sequence)
    );
  `)
}

function checkpointTableNames(database) {
  return database.query(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'agent_workflow_checkpoints',
      'agent_workflow_checkpoint_journal',
      'workflow_checkpoints',
      'workflow_checkpoint_journal',
      'workflow_checkpoint_storage'
    )
    ORDER BY name
  `).all().map((row) => row.name)
}

async function testCheckpointJournalRetention(core, tasksModule, database) {
  const signal = new AbortController().signal
  const observedSignals = []
  const repository = tasksModule.createSqliteWorkflowCheckpointRepository(
    createBunSqliteCheckpointProvider(database, observedSignals),
  )
  const store = tasksModule.createWorkflowCheckpointStore(repository)
  const runId = core.asAssistantRunId('checkpoint-bounded-journal')
  const recorder = tasksModule.createWorkflowCheckpointRecorder({
    store,
    runId,
    goalHash: 'bounded-journal-goal-hash',
    startedAt: 1,
  })
  const journalLimit = tasksModule.WORKFLOW_CHECKPOINT_LIMITS.journalSnapshots
  const finalRevision = journalLimit + 5

  assert.equal((await recorder.initialize(signal)).ok, true)
  for (let revision = 2; revision <= finalRevision; revision += 1) {
    const recorded = await recorder.record({ status: 'running', occurredAt: revision }, signal)
    assert.equal(recorded.ok, true, `checkpoint revision ${revision} persists before retention pruning`)
  }

  const retained = database.query(`
    SELECT COUNT(*) AS count, MIN(sequence) AS minimumSequence, MAX(sequence) AS maximumSequence
    FROM workflow_checkpoint_journal WHERE runId = ?
  `).get(runId)
  assert.equal(Number(retained.count), journalLimit, 'checkpoint journal storage is bounded per run')
  assert.equal(Number(retained.minimumSequence), finalRevision - journalLimit + 1, 'pruning retains one recovery anchor plus a contiguous tail')
  assert.equal(Number(retained.maximumSequence), finalRevision)

  database.query(`
    UPDATE workflow_checkpoints SET checkpointJson = ? WHERE runId = ?
  `).run('{"invalid":"current-checkpoint"}', runId)
  const recoveredAfterPruning = await store.recover(runId, signal)
  assert.equal(recoveredAfterPruning.ok, true, 'a pruned journal remains a valid recovery chain')
  if (!recoveredAfterPruning.ok) throw new Error(recoveredAfterPruning.error.message)
  assert.equal(recoveredAfterPruning.value.checkpoint.revision, finalRevision)
  assert.equal(recoveredAfterPruning.value.source, 'journal')
  assert.equal(recoveredAfterPruning.value.disposition, 'reconcile-before-resume')
  assert.equal(recoveredAfterPruning.value.replaySideEffects, false)

  database.query(`
    UPDATE workflow_checkpoint_journal SET checkpointJson = ?
    WHERE runId = ? AND sequence = ?
  `).run('{"invalid":"latest-journal-snapshot"}', runId, finalRevision)
  const recoveredPrevious = await store.recover(runId, signal)
  assert.equal(recoveredPrevious.ok, true, 'recovery falls back to the last complete retained snapshot')
  if (!recoveredPrevious.ok) throw new Error(recoveredPrevious.error.message)
  assert.equal(recoveredPrevious.value.checkpoint.revision, finalRevision - 1)
  assert.equal(recoveredPrevious.value.source, 'journal')
  assert.equal(recoveredPrevious.value.replaySideEffects, false, 'journal fallback never replays side effects')
  assert.ok(observedSignals.length > 0)
  assert.ok(observedSignals.every((candidate) => candidate === signal), 'retention and recovery observe the exact caller signal')
}

async function testCheckpointRecoveryCoordinator(core, tasksModule) {
  const signal = new AbortController().signal
  const runIds = Object.freeze({
    planning: core.asAssistantRunId('checkpoint-recovery-planning'),
    running: core.asAssistantRunId('checkpoint-recovery-running'),
    waiting: core.asAssistantRunId('checkpoint-recovery-waiting'),
    succeeded: core.asAssistantRunId('checkpoint-recovery-succeeded'),
    failed: core.asAssistantRunId('checkpoint-recovery-failed'),
    cancelled: core.asAssistantRunId('checkpoint-recovery-terminal-cancelled'),
    missing: core.asAssistantRunId('checkpoint-recovery-missing'),
    mismatch: core.asAssistantRunId('checkpoint-recovery-mismatch'),
    invalidReplay: core.asAssistantRunId('checkpoint-recovery-invalid-replay'),
    dispositionDrift: core.asAssistantRunId('checkpoint-recovery-disposition-drift'),
    corruption: core.asAssistantRunId('checkpoint-recovery-corruption'),
    thrown: core.asAssistantRunId('checkpoint-recovery-thrown'),
    recoveryCancelled: core.asAssistantRunId('checkpoint-recovery-cancelled'),
    afterCancellation: core.asAssistantRunId('checkpoint-recovery-after-cancellation'),
  })
  const requestedRunIds = Object.freeze([
    runIds.planning,
    runIds.running,
    runIds.waiting,
    runIds.succeeded,
    runIds.failed,
    runIds.cancelled,
    runIds.missing,
    runIds.running,
    runIds.mismatch,
    runIds.invalidReplay,
    runIds.dispositionDrift,
    runIds.corruption,
    runIds.thrown,
    runIds.recoveryCancelled,
    runIds.afterCancellation,
  ])
  const originalInput = [...requestedRunIds]
  const calls = []
  const coordinator = tasksModule.createWorkflowCheckpointRecoveryCoordinator({
    async recover(runId, observedSignal) {
      calls.push({ runId, signal: observedSignal })
      if (runId === runIds.missing) return core.err('not_found', 'No workflow checkpoint exists.')
      if (runId === runIds.mismatch) {
        return checkpointRecovery(core, core.asAssistantRunId('checkpoint-recovery-foreign'), 'running')
      }
      if (runId === runIds.invalidReplay) {
        const result = checkpointRecovery(core, runId, 'running')
        return { ...result, value: { ...result.value, replaySideEffects: true } }
      }
      if (runId === runIds.dispositionDrift) {
        const result = checkpointRecovery(core, runId, 'running')
        return { ...result, value: { ...result.value, disposition: 'terminal' } }
      }
      if (runId === runIds.corruption) {
        return core.err('corruption', 'private corrupt checkpoint payload')
      }
      if (runId === runIds.thrown) throw new Error('private checkpoint repository failure')
      if (runId === runIds.recoveryCancelled) {
        return core.err('cancelled', 'Workflow checkpoint recovery was cancelled.')
      }
      const status = runId === runIds.planning
        ? 'planning'
        : runId === runIds.running
          ? 'running'
          : runId === runIds.waiting
            ? 'waiting'
            : runId === runIds.succeeded
              ? 'succeeded'
              : runId === runIds.failed
                ? 'failed'
                : 'cancelled'
      return checkpointRecovery(core, runId, status, {
        source: status === 'running' ? 'journal' : 'current',
        lastSafeStepId: status === 'running' ? 'step-safe-1' : undefined,
      })
    },
  })

  const report = await coordinator.recover(requestedRunIds, signal)
  assert.deepEqual(requestedRunIds, originalInput, 'checkpoint recovery does not mutate the recovered run list')
  assert.equal(report.completion, 'cancelled')
  assert.equal(report.requestedCount, requestedRunIds.length)
  assert.equal(report.processedCount, requestedRunIds.length - 1)
  assert.equal(report.remainingCount, 1, 'cancellation stops before later recovered runs are inspected')
  assert.equal(report.storeCallCount, 13)
  assert.equal(report.recoveredCount, 6)
  assert.equal(report.notFoundCount, 1, 'ordinary Chat runs without workflow checkpoints are not failures')
  assert.equal(report.failedCount, 5, 'identity, replay, disposition, corruption, and thrown results fail closed')
  assert.equal(report.skippedDuplicateCount, 1)
  assert.equal(report.cancelledCount, 1)
  assert.equal(calls.some((call) => call.runId === runIds.afterCancellation), false)
  assert.ok(calls.every((call) => call.signal === signal), 'every checkpoint lookup receives the exact caller signal')
  assert.equal(Object.isFrozen(report), true)
  assert.equal(Object.isFrozen(report.observations), true)
  assert.ok(report.observations.every(Object.isFrozen), 'all caller-visible checkpoint observations are immutable')

  const recoveredByRunId = new Map(
    report.observations
      .filter((observation) => observation.outcome === 'recovered')
      .map((observation) => [observation.runId, observation]),
  )
  assert.equal(recoveredByRunId.get(runIds.planning).recoveryDisposition, 'reconcile-before-resume')
  assert.equal(recoveredByRunId.get(runIds.running).source, 'journal')
  assert.equal(recoveredByRunId.get(runIds.running).lastSafeStepId, 'step-safe-1')
  assert.equal(recoveredByRunId.get(runIds.waiting).recoveryDisposition, 'awaiting-action')
  assert.equal(recoveredByRunId.get(runIds.succeeded).recoveryDisposition, 'terminal')
  assert.equal(recoveredByRunId.get(runIds.cancelled).recoveryDisposition, 'terminal')
  assert.equal(recoveredByRunId.get(runIds.failed).recoveryDisposition, 'failed-with-evidence')
  assert.equal(recoveredByRunId.get(runIds.failed).failureCode, 'fixture_failure')
  assert.ok(report.observations.every((observation) => observation.replaySideEffects === false))

  const failedByRunId = new Map(
    report.observations
      .filter((observation) => observation.outcome === 'failed')
      .map((observation) => [observation.runId, observation]),
  )
  assert.equal(failedByRunId.get(runIds.mismatch).failureCode, 'invalid_recovery_result')
  assert.equal(failedByRunId.get(runIds.invalidReplay).failureCode, 'invalid_recovery_result')
  assert.equal(failedByRunId.get(runIds.dispositionDrift).failureCode, 'invalid_recovery_result')
  assert.equal(failedByRunId.get(runIds.corruption).failureCode, 'corruption')
  assert.equal(failedByRunId.get(runIds.thrown).failureCode, 'store_threw')
  assert.equal(
    calls.some((call) => call.runId === runIds.thrown),
    true,
    'a corrupt checkpoint result does not stop the remaining passive scan',
  )
  assert.equal(
    JSON.stringify(report).includes('private checkpoint'),
    false,
    'checkpoint recovery reports do not expose raw repository failure or corruption text',
  )

  const preAborted = new AbortController()
  preAborted.abort()
  let preAbortedCalls = 0
  const preAbortedReport = await tasksModule.createWorkflowCheckpointRecoveryCoordinator({
    async recover() {
      preAbortedCalls += 1
      throw new Error('must not run')
    },
  }).recover([runIds.running], preAborted.signal)
  assert.equal(preAbortedCalls, 0, 'pre-aborted checkpoint recovery performs no persistence call')
  assert.equal(preAbortedReport.completion, 'cancelled')
  assert.equal(preAbortedReport.processedCount, 1)
  assert.equal(preAbortedReport.remainingCount, 0)
  assert.equal(preAbortedReport.cancelledCount, 1)

  const postReadAbort = new AbortController()
  const postReadReport = await tasksModule.createWorkflowCheckpointRecoveryCoordinator({
    async recover(runId, observedSignal) {
      assert.equal(observedSignal, postReadAbort.signal)
      postReadAbort.abort()
      return checkpointRecovery(core, runId, 'succeeded')
    },
  }).recover([runIds.succeeded], postReadAbort.signal)
  assert.equal(postReadReport.completion, 'completed', 'a completed read remains authoritative after return-time cancellation')
  assert.equal(postReadReport.recoveredCount, 1)
  assert.equal(postReadReport.cancelledCount, 0)

  const thrownAbort = new AbortController()
  const thrownAbortReport = await tasksModule.createWorkflowCheckpointRecoveryCoordinator({
    async recover() {
      thrownAbort.abort()
      throw new Error('abort boundary')
    },
  }).recover([runIds.running, runIds.afterCancellation], thrownAbort.signal)
  assert.equal(thrownAbortReport.completion, 'cancelled')
  assert.equal(thrownAbortReport.cancelledCount, 1)
  assert.equal(thrownAbortReport.failedCount, 0, 'an aborted thrown lookup is cancellation, not persistence failure')
  assert.equal(thrownAbortReport.remainingCount, 1)
}

function checkpointRecovery(core, runId, status, options = {}) {
  const failureEvidence = status === 'failed'
    ? Object.freeze({ code: 'fixture_failure' })
    : undefined
  const lastCompletedStep = options.lastSafeStepId
    ? Object.freeze({ id: options.lastSafeStepId })
    : undefined
  const disposition = status === 'failed'
    ? 'failed-with-evidence'
    : status === 'waiting'
      ? 'awaiting-action'
      : status === 'planning' || status === 'running'
        ? 'reconcile-before-resume'
        : 'terminal'
  const checkpoint = Object.freeze({
    runId,
    status,
    ...(failureEvidence ? { failureEvidence } : {}),
    ...(lastCompletedStep ? { lastCompletedStep } : {}),
  })
  return core.ok(Object.freeze({
    checkpoint,
    source: options.source ?? 'current',
    disposition,
    replaySideEffects: false,
    ...(options.lastSafeStepId ? { lastSafeStepId: options.lastSafeStepId } : {}),
    ...(failureEvidence ? { failureEvidence } : {}),
  }))
}

function createBunSqliteCheckpointProvider(database, observedSignals, hooks = {}) {
  function observe(signal) {
    observedSignals.push(signal)
    if (!signal.aborted) return
    const error = new Error('Checkpoint fixture database operation was cancelled.')
    error.name = 'AbortError'
    throw error
  }
  const executor = {
    async exec(source, signal) {
      observe(signal)
      database.exec(source)
      hooks.afterOperation?.({ kind: 'exec', source, signal })
    },
    async run(source, parameters = [], signal) {
      observe(signal)
      const result = database.query(source).run(...parameters)
      hooks.afterOperation?.({ kind: 'run', source, signal })
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst(source, parameters = [], signal) {
      observe(signal)
      const row = database.query(source).get(...parameters) ?? null
      hooks.afterOperation?.({ kind: 'getFirst', source, signal })
      return row
    },
    async getAll(source, parameters = [], signal) {
      observe(signal)
      const rows = database.query(source).all(...parameters)
      hooks.afterOperation?.({ kind: 'getAll', source, signal })
      return rows
    },
  }
  const checkpointDatabase = {
    ...executor,
    async transaction(signal, work) {
      observe(signal)
      database.exec('BEGIN IMMEDIATE')
      try {
        const result = await work(executor)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  return {
    async get(signal) {
      observe(signal)
      return checkpointDatabase
    },
  }
}

function createBunSqliteStorage(database) {
  database.exec('PRAGMA foreign_keys = ON')
  const executor = {
    async exec(source) {
      database.exec(source)
    },
    async run(source, parameters = []) {
      const result = database.query(source).run(...parameters)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst(source, parameters = []) {
      return database.query(source).get(...parameters) ?? null
    },
    async getAll(source, parameters = []) {
      return database.query(source).all(...parameters)
    },
  }
  const storage = {
    ...executor,
    async transaction(work) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const result = await work(executor)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { get: async () => storage }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
