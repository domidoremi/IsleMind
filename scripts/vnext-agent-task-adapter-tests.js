const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const bridgeSource = fs.readFileSync(path.join(__dirname, '../src/bootstrap/taskBoundToolRuntime.ts'), 'utf8')
  const retiredBridgePath = path.join(__dirname, '../src/bootstrap/agentToolTaskRuntime.ts')
  const stepExecutorPath = path.join(__dirname, '../src/modules/tasks/application/workflowStepExecutor.ts')
  const retiredStepExecutorPath = path.join(__dirname, '../src/modules/tasks/application/agentWorkflowStepExecutor.ts')
  const legacyAgentExecutorPath = path.join(__dirname, '../src/services/agent/agentExecutor.ts')
  const stepExecutorSource = fs.readFileSync(stepExecutorPath, 'utf8')
  const agentServiceIndexPath = path.join(__dirname, '../src/services/agent/index.ts')
  const legacyOrchestratorPath = path.join(__dirname, '../src/services/agent/agentOrchestrator.ts')
  const orchestratorTargetSource = fs.readFileSync(path.join(__dirname, '../src/modules/tasks/application/workflowOrchestrator.ts'), 'utf8')
  const orchestratorCompositionSource = fs.readFileSync(path.join(__dirname, '../src/bootstrap/workflowOrchestrator.ts'), 'utf8')
  const assistantReplyStartSource = fs.readFileSync(path.join(__dirname, '../src/modules/assistant-runtime/application/assistantConversationReplyStartRuntime.ts'), 'utf8')
  const legacyChatRunnerPath = path.join(__dirname, '../src/services/chatRunner.ts')
  const legacyRegistryPath = path.join(__dirname, '../src/services/agent/agentToolRegistry.ts')
  const catalogBindingSource = fs.readFileSync(path.join(__dirname, '../src/bootstrap/conversationToolCatalog.ts'), 'utf8')
  const androidDeviceToolsSource = fs.readFileSync(path.join(__dirname, '../src/services/androidDeviceTools.ts'), 'utf8')
  for (const symbol of [
    'TaskBoundToolRuntimeOptions',
    'ExecuteTaskBoundToolInput',
    'TaskBoundExternalToolExecutionOptions',
    'TaskBoundToolRuntimeDependencies',
    'TaskBoundToolRuntime',
    'createTaskBoundToolRuntime',
    'executeTaskBoundTool',
    'executeExternalTaskBoundTool',
  ]) {
    assert.match(bridgeSource, new RegExp(`export (?:interface|(?:async )?function) ${symbol}\\b`),
      `the task-bound runtime publicly exports ${symbol}`)
  }
  assert.doesNotMatch(bridgeSource,
    /\b(?:AgentToolTaskRuntimeOptions|ExecuteAgentToolThroughTaskInput|ExternalAgentToolExecutionOptions|AgentToolTaskRuntimeDependencies|AgentToolTaskRuntime|createAgentToolTaskRuntime|executeAgentToolThroughTask|executeExternalAgentToolThroughTask)\b/,
    'the task-bound runtime does not retain Agent-named public aliases')
  assert.equal(fs.existsSync(retiredBridgePath), false,
    'the retired Agent-named task/tool runtime path stays deleted')
  assert.doesNotMatch(bridgeSource, /agentToolRegistry|agentPolicy|executeResolvedTool/,
    'the target external-tool bridge must not re-enter legacy registry or permission execution')
  assert.doesNotMatch(bridgeSource, /projectExternalObservation|AgentToolResult/,
    'the Agent task bridge returns target observations directly without the legacy result projector')
  assert.match(bridgeSource, /interface TaskBoundExternalToolExecutionOptions[\s\S]{0,120}taskId: string/,
    'external tool execution requires the owning durable task identity')
  assert.match(bridgeSource, /taskId:\s*task\.id/,
    'the durable task runtime constructs external execution options from the persisted task identity')
  assert.equal((bridgeSource.match(/taskId:\s*options\.taskId/g) ?? []).length, 3,
    'default MCP, target built-in, and legacy app/settings ports all forward the durable task identity')
  assert.match(bridgeSource, /resolveBuiltInCapabilityAdapter\(tool\.id\)/,
    'default built-in execution resolves the target adapter before the legacy app/settings callback')
  assert.match(bridgeSource, /if \(outcome\.kind === 'external'\) return outcome\.result\.observation/,
    'Agent execution consumes the target external observation contract directly')
  assert.equal(fs.existsSync(legacyRegistryPath), false,
    'the covered Agent tool registry facade stays deleted')
  assert.match(catalogBindingSource, /KNOWLEDGE_RAG_CONTEXT_PACK_MANIFEST/,
    'bootstrap composes the target-owned RAG manifest')
  assert.equal(fs.existsSync(legacyAgentExecutorPath), false,
    'the covered Agent service step executor stays deleted')
  assert.equal(fs.existsSync(retiredStepExecutorPath), false,
    'the retired Agent-named Tasks step executor stays deleted')
  assert.equal(fs.existsSync(agentServiceIndexPath), false,
    'the obsolete Agent service barrel stays deleted')
  assert.equal(fs.existsSync(legacyOrchestratorPath), false,
    'the covered Agent orchestrator service stays deleted')
  assert.doesNotMatch(stepExecutorSource, /@\/services\/|@\/bootstrap\//,
    'the tasks-owned step executor remains service-free and infrastructure-free')
  assert.doesNotMatch(orchestratorTargetSource, /@\/(?:services|bootstrap|platform|presentation)\//,
    'the Tasks-owned orchestrator remains independent of composition and infrastructure')
  assert.match(orchestratorCompositionSource, /createWorkflowStepExecutor<[\s\S]{0,160}TaskBoundToolRuntimeOptions\s*>/,
    'bootstrap composes the Chat-neutral Tasks step executor')
  assert.match(orchestratorCompositionSource, /executeTaskBoundTool/,
    'bootstrap injects the Chat-neutral durable task-tool closure')
  assert.doesNotMatch(stepExecutorSource, /startsWith\('rag:'\)/,
    'Agent execution cannot reintroduce a RAG registry fallback')
  assert.doesNotMatch(stepExecutorSource, /\bexecuteAgentTool\(/,
    'Agent execution cannot re-enter the legacy registry for search or any other tool')
  assert.equal(fs.existsSync(legacyChatRunnerPath), false,
    'the deleted Chat reply-start facade cannot restore a direct tool registry fallback')
  assert.doesNotMatch(assistantReplyStartSource, /\bexecuteAgentTool\(|isExplicitLegacySearchProviderTool/,
    'target ordinary reply startup cannot route built-in search through a registry fallback')
  assert.doesNotMatch(catalogBindingSource, /export async function executeAgentTool|executeResolvedAgentTool|callMcpTool/,
    'the bootstrap Agent catalog cannot execute tools')
  assert.match(androidDeviceToolsSource, /normalizeExternalToolExecutionResult\(\{/,
    'Android execution produces the target external observation at its source boundary')
  assert.doesNotMatch(androidDeviceToolsSource, /AndroidDeviceToolResult|androidToolTrace|trace:\s*ProcessTrace/,
    'Android execution no longer exposes a local Agent trace-shaped result')
  assert.match(bridgeSource, /return await android\.executeAndroidDeviceTool\(/,
    'the default Android port returns the target result directly')
  assert.doesNotMatch(bridgeSource, /async executeAndroidTool[\s\S]{0,600}normalizeExternalBoundaryResult/,
    'the default Android port no longer re-normalizes a flat trace result')
  const adapterModule = await import('../src/bootstrap/taskBoundToolRuntime.ts')
  const builtInRuntimeModule = await import('../src/bootstrap/builtInCapabilityRuntime.ts')
  const integrationsModule = await import('../src/modules/integrations/index.ts')
  const knowledgeModule = await import('../src/modules/knowledge/index.ts')
  const taskModule = await import('../src/modules/tasks/index.ts')
  const storeModule = await import('../src/modules/tasks/testing/inMemoryTaskStore.ts')

  const ragReplaySnapshot = knowledgeModule.createKnowledgeRagReplaySnapshot({
    createdAt: 119_999,
    query: 'durable replay fixture',
    profile: 'balanced',
    profileSource: 'settings',
    sourceCount: 1,
    citationCount: 1,
    confidence: 0.75,
    missingEvidence: false,
    ragTraceCount: 1,
    outputCharLimit: 4_800,
    visibleOutput: '{"durable":true}',
    warnings: [],
    fallbackReasons: ['local-statistical'],
    contextPrompt: 'Complete context that exceeds the task summary boundary in production.',
    citations: [{ id: 'source-1', label: '[1]', type: 'knowledge', title: 'Fixture source' }],
  })
  assert.ok(ragReplaySnapshot, 'knowledge creates a validated durable RAG replay snapshot')
  assert.equal(
    JSON.parse(knowledgeModule.formatKnowledgeRagReplayOutput(ragReplaySnapshot)).contextPrompt,
    ragReplaySnapshot.contextPrompt,
    'durable RAG replay reconstructs the full legacy observation instead of the bounded task summary'
  )
  assert.equal(
    knowledgeModule.parseKnowledgeRagReplaySnapshot({ ...ragReplaySnapshot, forged: true }),
    undefined,
    'persisted RAG replay rejects unsupported metadata'
  )
  assert.equal(
    knowledgeModule.parseKnowledgeRagReplaySnapshot({
      ...ragReplaySnapshot,
      citations: [{ ...ragReplaySnapshot.citations[0], secret: 'not-admitted' }],
    }),
    undefined,
    'persisted RAG replay rejects unsupported citation metadata'
  )

  const persistence = storeModule.createInMemoryTaskStore()
  let now = 120_000
  const ids = { next: (prefix) => `${prefix}-${++now}` }
  let executions = 0
  let directMcpExecutions = 0
  const directMcpTaskIds = []
  let builtinSearchExecutions = 0
  const builtinSearchTaskIds = []
  let builtinSearchSignal
  let builtinEditExecutions = 0
  let builtinEditInput
  let cancellingSearchExecutorStarted
  const cancellingSearchExecutorStartedPromise = new Promise((resolve) => {
    cancellingSearchExecutorStarted = resolve
  })
  let cancellationExecutorStarted
  const cancellationExecutorStartedPromise = new Promise((resolve) => {
    cancellationExecutorStarted = resolve
  })
  let throwingCancellationExecutorStarted
  const throwingCancellationExecutorStartedPromise = new Promise((resolve) => {
    throwingCancellationExecutorStarted = resolve
  })
  const manifest = {
    id: 'android:fixture:write',
    source: 'android',
    name: 'android.fixture.write',
    description: 'Fixture Android write action',
    permission: 'read-write',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target'],
      additionalProperties: false,
    },
  }
  const mcpManifest = {
    id: 'mcp:fixture-server:fixture.read',
    source: 'mcp',
    name: 'fixture.read',
    description: 'Fixture MCP read action',
    permission: 'read-only',
    enabled: true,
    serverId: 'fixture-server',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  }
  const searchManifest = {
    id: 'builtin:islemind-builtins:search_web',
    source: 'builtin',
    name: 'search_web',
    description: 'Search the web through the configured IsleMind search provider.',
    permission: 'read-only',
    enabled: true,
    serverId: 'islemind-builtins',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  }
  const malformedBuiltinManifest = {
    id: 'builtin:fixture:malformed',
    source: 'builtin',
    name: 'fixture.malformed',
    description: 'Malformed result fixture',
    permission: 'read-only',
    enabled: true,
  }
  const ragManifest = {
    id: 'rag:context_pack',
    source: 'rag',
    name: 'rag.context_pack',
    description: 'Fixture task-owned RAG context pack.',
    permission: 'read-only',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  }
  const ragSnapshots = new Map()
  const ragReplaySnapshotRepository = {
    async save(taskId, snapshot) {
      const parsed = knowledgeModule.parseKnowledgeRagReplaySnapshot(snapshot)
      assert.ok(parsed)
      ragSnapshots.set(taskId, JSON.parse(JSON.stringify(parsed)))
    },
    async get(taskId) {
      const snapshot = ragSnapshots.get(taskId)
      return snapshot ? knowledgeModule.parseKnowledgeRagReplaySnapshot(JSON.parse(JSON.stringify(snapshot))) : undefined
    },
    async delete(taskId) {
      ragSnapshots.delete(taskId)
    },
  }
  const durableBuiltInAdmission = builtInRuntimeModule.createBuiltInCapabilityTaskAdmissionPort(
    (taskId) => persistence.get(taskId),
  )
  const targetBuiltInBinding = builtInRuntimeModule.createBuiltInCapabilityRuntimeBinding({
    admission: {
      async admit(request, options) {
        builtinSearchTaskIds.push(request.taskId)
        return durableBuiltInAdmission.admit(request, options)
      },
    },
    webSearch: {
      async search(input, options) {
        builtinSearchExecutions += 1
        builtinSearchSignal = options.signal
        assert.ok(options.signal instanceof AbortSignal)
        if (input.query === 'cancel in-flight search') {
          cancellingSearchExecutorStarted()
          await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
          const error = new Error('search fetch aborted')
          error.name = 'AbortError'
          throw error
        }
        assert.deepEqual(input, { query: 'IsleMind vNext', limit: 6 })
        return [
          { title: 'Architecture plan', url: 'https://example.test/architecture', snippet: 'vNext migration evidence' },
          { title: 'Migration status', url: 'https://example.test/status', snippet: 'Current runnable slices' },
        ]
      },
    },
    workspaceFiles: {
      workspaceScopeId: 'fixture-workspace',
      async inspect(relativePath, options) {
        assert.equal(relativePath, 'workspace/qa-tool-check.txt')
        assert.ok(options.signal instanceof AbortSignal)
        return undefined
      },
      async readText() {
        throw new Error('Unexpected workspace read.')
      },
      async editTextAtomic(input, options) {
        builtinEditExecutions += 1
        builtinEditInput = input
        assert.ok(options.signal instanceof AbortSignal)
        return {
          status: 'applied',
          relativePath: input.relativePath,
          previousRevision: input.expectedRevision,
          revision: 'sha256:fixture-edit-revision',
          byteLength: new TextEncoder().encode(input.text).byteLength,
          mimeType: input.mimeType,
        }
      },
    },
    now: () => ++now,
  }, { enabledToolNames: ['search_web', 'edit_file'] })
  const rawEditManifest = targetBuiltInBinding.manifests.find((candidate) => candidate.name === 'edit_file')
  assert.ok(rawEditManifest, 'the target built-in binding exposes edit_file when a durable workspace port is bound')
  const editManifest = {
    ...rawEditManifest,
    riskLevel: 'state-changing',
    requiresConfirmation: true,
    outputBoundary: 'local-state',
  }
  const adapter = adapterModule.createTaskBoundToolRuntime({
    createTaskRuntime: (policyEvaluator) => taskModule.createTaskRuntime({
      clock: { now: () => ++now },
      ids,
      persistence,
      policyEvaluator,
    }),
    ragReplaySnapshotRepository,
    async listToolManifests() {
      return [manifest, mcpManifest, searchManifest, editManifest, malformedBuiltinManifest, ragManifest]
    },
    async executeMcpTool(tool, argumentsValue, options) {
      directMcpExecutions += 1
      directMcpTaskIds.push(options.taskId)
      assert.equal(tool.serverId, 'fixture-server')
      assert.equal(tool.name, 'fixture.read')
      assert.ok(argumentsValue.query === 'fixture' || argumentsValue.query === 'fail')
      assert.ok(options.signal instanceof AbortSignal)
      if (argumentsValue.query === 'fail') {
        return externalResult({
          ok: false,
          status: 'error',
          output: 'MCP read failed.',
          errorCode: 'execution_failed',
        })
      }
      return externalResult({
        ok: true,
        status: 'done',
        output: 'MCP read completed.',
        blocks: [
          { type: 'text', text: 'MCP read completed.' },
          { type: 'image', data: 'fixture-image', mimeType: 'image/png' },
          { type: 'resource', uri: 'file:///fixture.txt', text: 'Fixture resource', name: 'fixture.txt', mimeType: 'text/plain' },
        ],
      })
    },
    async executeAndroidTool(tool, argumentsValue, options) {
      executions += 1
      assert.equal(tool.id, manifest.id)
      if (argumentsValue.target === 'throw-cancel') {
        throwingCancellationExecutorStarted()
        await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
        const error = new Error('aborted source')
        error.name = 'AbortError'
        throw error
      }
      if (argumentsValue.target === 'cancel') {
        cancellationExecutorStarted()
        await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }))
        return externalResult({ ok: false, status: 'skipped', output: 'Agent workflow execution was cancelled.', errorCode: 'cancelled' })
      }
      assert.deepEqual(argumentsValue, { target: 'fixture' })
      return externalResult({ ok: true, status: 'done', output: 'Android write completed.' })
    },
    async executeBuiltinTool(tool, argumentsValue, options) {
      const targetAdapter = targetBuiltInBinding.resolveAdapter(tool.id)
      if (targetAdapter) {
        return targetAdapter.execute({
          taskId: options.taskId,
          tool: targetAdapter.definition,
          arguments: argumentsValue,
        }, { signal: options.signal })
      }
      assert.equal(tool.id, malformedBuiltinManifest.id)
      return {
        summary: 'malformed',
        observation: {
          ok: false,
          status: 'done',
          output: 'x'.repeat(13_000),
          blocks: Array.from({ length: 70 }, () => ({ type: 'text', text: 'z'.repeat(13_000) })),
          diagnostic: {
            id: 'spoofed-system-result',
            type: 'system',
            title: 'Spoofed system result',
            content: 'x'.repeat(13_000),
            status: 'done',
            metadata: { oversized: 'y'.repeat(5_000) },
          },
          metadata: { toolId: 'spoofed-tool', source: 'spoofed-source' },
        },
      }
    },
    async executeAppActionTool() { throw new Error('Unexpected app-action execution.') },
  })

  const ragRequest = { toolId: ragManifest.id, arguments: { query: 'durable fixture' } }
  let ragExecutions = 0
  const ragRuntime = {
    async buildContextPack(request, options) {
      ragExecutions += 1
      assert.equal(request.query, 'durable fixture')
      assert.ok(options.signal instanceof AbortSignal)
      return {
        plan: { query: request.query, profile: 'balanced', profileSource: 'settings', profileReason: 'fixture' },
        sources: [{ id: 'source-1' }],
        citations: [{ id: 'source-1', label: '[1]', type: 'knowledge', title: 'Fixture source' }],
        quality: { confidence: 0.75, missingEvidence: false, warnings: [], fallbackReasons: ['local-statistical'] },
        contextPrompt: 'Complete durable RAG context.',
        trace: [{ id: 'rag-trace-1' }],
      }
    },
  }
  const ragResult = await adapter.execute({
    stepId: 'agent-step-rag-replay',
    request: ragRequest,
    options: { manifests: [ragManifest], ragRuntime, limits: { outputCharLimit: 800 } },
  })
  assert.equal(ragResult.ok, true)
  assert.equal(ragExecutions, 1)
  assert.equal(JSON.parse(ragResult.output).contextPrompt, 'Complete durable RAG context.')
  const ragTask = await persistence.findByIdempotencyKey(taskKey(undefined, 'agent-step-rag-replay', ragManifest.id, ragRequest.arguments))
  assert.equal(ragTask.status, 'succeeded')
  assert.equal(ragTask.artifacts.length, 1)
  assert.match(ragTask.artifacts[0].checksum, /^fnv1a32:[0-9a-f]{8}$/)
  assert.ok(ragSnapshots.has(ragTask.id), 'successful RAG tasks persist the full replay snapshot')

  const replayedRagResult = await adapter.execute({
    stepId: 'agent-step-rag-replay',
    request: ragRequest,
    options: {
      manifests: [ragManifest],
      limits: { outputCharLimit: 12_000 },
      ragRuntime: { async buildContextPack() { throw new Error('RAG retrieval must not repeat during replay.') } },
    },
  })
  assert.equal(replayedRagResult.ok, true)
  assert.equal(replayedRagResult.output, ragResult.output, 'RAG replay preserves the original bounded visible output')
  assert.equal(replayedRagResult.metadata.replayed, true)
  assert.equal(ragExecutions, 1, 'idempotent RAG replay does not repeat retrieval')

  const originalRagSnapshot = ragSnapshots.get(ragTask.id)
  ragSnapshots.set(ragTask.id, { ...originalRagSnapshot, visibleOutput: '{"tampered":true}' })
  const tamperedRagReplay = await adapter.execute({
    stepId: 'agent-step-rag-replay',
    request: ragRequest,
    options: { manifests: [ragManifest], ragRuntime },
  })
  assert.equal(tamperedRagReplay.ok, false)
  assert.equal(tamperedRagReplay.errorCode, 'execution_failed', 'RAG replay fails closed when persisted evidence does not match the task artifact checksum')
  ragSnapshots.set(ragTask.id, originalRagSnapshot)

  const legacyRagFallback = await adapter.execute({
    stepId: 'agent-step-rag-fallback',
    request: ragRequest,
    options: { manifests: [ragManifest] },
  })
  assert.equal(legacyRagFallback.status, 'skipped')
  assert.equal(legacyRagFallback.errorCode, 'rag_unavailable', 'target RAG reports the legacy-compatible missing-runtime result without registry fallback')

  const failedRagResult = await adapter.execute({
    stepId: 'agent-step-rag-failure',
    request: ragRequest,
    options: {
      manifests: [ragManifest],
      ragRuntime: { async buildContextPack() { throw new Error('fixture retrieval failed') } },
    },
  })
  assert.equal(failedRagResult.status, 'error')
  assert.equal(failedRagResult.errorCode, 'rag_unavailable')
  assert.equal(failedRagResult.output, 'fixture retrieval failed')

  const request = { toolId: manifest.id, arguments: { target: 'fixture' } }
  const invalidConfirmationRequest = { toolId: manifest.id, arguments: { extra: true } }
  const invalidConfirmation = await adapter.execute({
    stepId: 'agent-step-invalid-confirmation',
    request: invalidConfirmationRequest,
    options: { manifests: [manifest], userConfirmed: false },
  })
  assert.equal(invalidConfirmation.errorCode, 'schema_invalid')
  assert.equal(executions, 0)
  assert.equal(await persistence.findByIdempotencyKey(taskKey(undefined, 'agent-step-invalid-confirmation', manifest.id, invalidConfirmationRequest.arguments)), undefined,
    'schema-invalid confirmation requests fail before creating a pending task')
  const pending = await adapter.execute({
    stepId: 'agent-step-confirm',
    assistantRunId: 'run-owner-1',
    request,
    options: { manifests: [manifest], userConfirmed: false },
  })
  assert.equal(pending.ok, false)
  assert.equal(pending.errorCode, 'evidence_insufficient')
  assert.equal(executions, 0, 'external tools do not execute before the durable confirmation task is confirmed')

  const confirmed = await adapter.execute({
    stepId: 'agent-step-confirm',
    assistantRunId: 'run-owner-1',
    request,
    options: { manifests: [manifest], intentVisible: true, userConfirmed: true },
  })
  assert.equal(confirmed.ok, true)
  assert.equal(executions, 1)
  assert.equal(confirmed.metadata.vnextTaskStatus, 'succeeded')
  assert.equal(confirmed.metadata.vnextAssistantRunId, 'run-owner-1')
  assert.equal(confirmed.diagnostic.metadata.permission, 'read-write')
  assert.equal(confirmed.diagnostic.metadata.decision, 'allow')
  assert.equal(confirmed.diagnostic.metadata.allowReason, 'user-confirmed')
  assert.equal(confirmed.diagnostic.metadata.userConfirmed, true)
  assert.equal(confirmed.diagnostic.metadata.intentVisible, true)
  assert.equal(confirmed.diagnostic.metadata.maxStepCount, 3)
  assert.equal(confirmed.diagnostic.metadata.maxToolCallsPerStep, 1)
  assert.equal(confirmed.diagnostic.metadata.readWriteToolPolicy, 'visible')
  const confirmedTask = await persistence.findByIdempotencyKey(taskKey('run-owner-1', 'agent-step-confirm', manifest.id, request.arguments))
  assert.equal(confirmedTask.status, 'succeeded')
  assert.equal(confirmedTask.runId, 'run-owner-1')
  const confirmedEntries = await persistence.list(confirmedTask.id)
  assert.deepEqual(confirmedEntries.map((entry) => entry.type), [
    'task.created',
    'task.confirmed',
    'task.started',
    'task.succeeded',
  ])
  assert.equal(confirmedEntries[0].data.runId, 'run-owner-1')

  const isolatedRun = await adapter.execute({
    stepId: 'agent-step-confirm',
    assistantRunId: 'run-owner-2',
    request,
    options: { manifests: [manifest], intentVisible: true, userConfirmed: true },
  })
  assert.equal(isolatedRun.ok, true)
  assert.equal(executions, 2, 'distinct Agent runs execute their own task even when step, tool, and arguments match')
  const isolatedTask = await persistence.findByIdempotencyKey(taskKey('run-owner-2', 'agent-step-confirm', manifest.id, request.arguments))
  assert.notEqual(isolatedTask.id, confirmedTask.id)
  assert.equal(isolatedTask.runId, 'run-owner-2')

  const mcpRequest = { toolId: mcpManifest.id, arguments: { query: 'fixture' } }
  const targetMcpExecution = await adapter.executeExternal({
    stepId: 'chat-mcp-read',
    request: mcpRequest,
    options: { manifests: [mcpManifest], userConfirmed: false },
  })
  assert.deepEqual(Object.keys(targetMcpExecution).sort(), ['observation', 'summary'], 'external task execution returns only the target result contract')
  const targetMcp = targetMcpExecution.observation
  assert.equal(targetMcp.ok, true, 'read-only MCP calls are routed through the target durable task API')
  assert.equal(directMcpExecutions, 1, 'MCP target adapters bypass the legacy agent registry executor')
  assert.deepEqual(targetMcp.blocks, [
    { type: 'text', text: 'MCP read completed.' },
    { type: 'image', data: 'fixture-image', mimeType: 'image/png' },
    { type: 'resource', uri: 'file:///fixture.txt', text: 'Fixture resource', name: 'fixture.txt', mimeType: 'text/plain' },
  ], 'MCP text, image, and resource observations remain live without legacy projection')
  assert.equal(targetMcp.metadata.vnextTaskStatus, 'succeeded')
  assert.equal(targetMcp.diagnostic.metadata.vnextTaskStatus, 'succeeded')
  const mcpTask = await persistence.findByIdempotencyKey(taskKey(undefined, 'chat-mcp-read', mcpManifest.id, mcpRequest.arguments))
  assert.equal(mcpTask.status, 'succeeded')
  assert.equal(directMcpTaskIds[0], mcpTask.id, 'MCP execution receives the exact persisted durable task identity')
  assert.equal(mcpTask.result.summary, 'MCP read completed.', 'durable tasks retain a bounded visible summary')
  assert.deepEqual((await persistence.list(mcpTask.id)).map((entry) => entry.type), [
    'task.created',
    'task.started',
    'task.succeeded',
  ])

  const replayedTargetMcp = (await adapter.executeExternal({
    stepId: 'chat-mcp-read',
    request: mcpRequest,
    options: { manifests: [mcpManifest], userConfirmed: false },
  })).observation
  assert.equal(replayedTargetMcp.ok, true, 'idempotent target replay preserves the visible success outcome')
  assert.equal(replayedTargetMcp.output, 'MCP read completed.')
  assert.equal(replayedTargetMcp.metadata.replayed, true)
  assert.equal(replayedTargetMcp.metadata.vnextTaskStatus, 'succeeded')
  assert.equal(directMcpExecutions, 1, 'successful replay never repeats the external side effect')

  const replayedMcp = await adapter.execute({
    stepId: 'chat-mcp-read',
    request: mcpRequest,
    options: { manifests: [mcpManifest], userConfirmed: false },
  })
  assert.equal(replayedMcp.ok, replayedTargetMcp.ok, 'Agent execution preserves target replay success')
  assert.equal(replayedMcp.output, replayedTargetMcp.output)
  assert.deepEqual(replayedMcp.blocks, replayedTargetMcp.blocks)
  assert.equal(replayedMcp.diagnostic.id, replayedTargetMcp.diagnostic.id)
  assert.equal(replayedMcp.diagnostic.status, replayedTargetMcp.diagnostic.status)
  assert.deepEqual(replayedMcp.diagnostic.metadata, replayedTargetMcp.diagnostic.metadata)
  assert.equal(directMcpExecutions, 1, 'Agent observation reuse never repeats target replay execution')

  const searchCaller = new AbortController()
  const searchRequest = {
    toolId: searchManifest.id,
    source: 'builtin',
    arguments: { query: 'IsleMind vNext', limit: 2 },
  }
  const search = await adapter.execute({
    stepId: 'agent-builtin-search',
    assistantRunId: 'run-search-1',
    request: searchRequest,
    options: { manifests: [searchManifest], signal: searchCaller.signal },
  })
  assert.equal(search.ok, true, 'built-in search executes through the durable target task path')
  assert.equal(builtinSearchExecutions, 1)
  assert.ok(builtinSearchSignal instanceof AbortSignal)
  assert.equal(builtinSearchSignal.aborted, false)
  assert.deepEqual(search.blocks, [
    {
      type: 'resource',
      name: 'Architecture plan',
      uri: 'https://example.test/architecture',
      text: 'vNext migration evidence',
      mimeType: 'text/html',
    },
    {
      type: 'resource',
      name: 'Migration status',
      uri: 'https://example.test/status',
      text: 'Current runnable slices',
      mimeType: 'text/html',
    },
  ], 'the first durable target search execution preserves bounded public source blocks')
  assert.equal(search.metadata.vnextTaskStatus, 'succeeded')
  assert.equal(search.metadata.vnextAssistantRunId, 'run-search-1')
  const searchTask = await persistence.findByIdempotencyKey(taskKey(
    'run-search-1',
    'agent-builtin-search',
    searchManifest.id,
    searchRequest.arguments,
  ))
  assert.equal(builtinSearchTaskIds[0], searchTask.id, 'target built-in adapter rereads the exact running durable task identity')
  assert.equal(searchTask.status, 'succeeded')

  const replayedSearch = await adapter.execute({
    stepId: 'agent-builtin-search',
    assistantRunId: 'run-search-1',
    request: searchRequest,
    options: { manifests: [searchManifest] },
  })
  assert.equal(replayedSearch.ok, true)
  assert.equal(replayedSearch.metadata.replayed, true)
  assert.equal(replayedSearch.output, search.output)
  assert.equal(builtinSearchExecutions, 1, 'durable search replay never repeats the network-backed built-in executor')

  const editRequest = {
    toolId: editManifest.id,
    source: 'builtin',
    arguments: {
      path: 'workspace/qa-tool-check.txt',
      text: 'ISLEMIND_TOOL_OK',
      expectedRevision: integrationsModule.BUILT_IN_WORKSPACE_ABSENT_REVISION,
    },
  }
  const invalidEditRequest = {
    ...editRequest,
    arguments: {
      ...editRequest.arguments,
      path: 'qa-tool-check.txt',
      expectedRevision: 'absent_file',
    },
  }
  const invalidEdit = await adapter.execute({
    stepId: 'agent-builtin-edit-invalid-contract',
    assistantRunId: 'run-edit-invalid-contract',
    request: invalidEditRequest,
    options: { manifests: [editManifest], intentVisible: true, userConfirmed: true },
  })
  assert.equal(invalidEdit.errorCode, 'schema_invalid')
  assert.match(invalidEdit.output, /path must match pattern/)
  assert.match(invalidEdit.output, /expectedRevision must match pattern/)
  assert.equal(builtinEditExecutions, 0)
  assert.equal(await persistence.findByIdempotencyKey(taskKey(
    'run-edit-invalid-contract',
    'agent-builtin-edit-invalid-contract',
    editManifest.id,
    invalidEditRequest.arguments,
  )), undefined, 'invalid writable namespace and revision tokens fail before durable task creation')
  const pendingEdit = await adapter.execute({
    stepId: 'agent-builtin-edit-pending',
    assistantRunId: 'run-edit-pending',
    request: editRequest,
    options: {
      manifests: [editManifest],
      intentVisible: true,
      userConfirmed: false,
      evidenceSources: ['source:visible-agent-request'],
    },
  })
  assert.equal(pendingEdit.ok, false)
  assert.equal(pendingEdit.errorCode, 'permission_required')
  assert.equal(pendingEdit.metadata.vnextTaskStatus, 'awaiting-confirmation')
  assert.equal(builtinEditExecutions, 0, 'a visible plan alone cannot satisfy a manifest-required durable confirmation')
  const pendingEditTask = await persistence.findByIdempotencyKey(taskKey(
    'run-edit-pending',
    'agent-builtin-edit-pending',
    editManifest.id,
    editRequest.arguments,
  ))
  assert.equal(pendingEditTask.policy.outcome, 'requires-confirmation')
  assert.deepEqual((await persistence.list(pendingEditTask.id)).map((entry) => entry.type), ['task.created'])

  const confirmedEdit = await adapter.execute({
    stepId: 'agent-builtin-edit-confirmed',
    assistantRunId: 'run-edit-confirmed',
    request: editRequest,
    options: {
      manifests: [editManifest],
      intentVisible: true,
      userConfirmed: true,
      evidenceSources: ['source:visible-agent-request'],
    },
  })
  assert.equal(confirmedEdit.ok, true, 'a confirmation carried into a new AssistantRun durably confirms and executes edit_file')
  assert.equal(confirmedEdit.metadata.capabilityOutcome, 'completed')
  assert.equal(builtinEditExecutions, 1)
  const confirmedEditTask = await persistence.findByIdempotencyKey(taskKey(
    'run-edit-confirmed',
    'agent-builtin-edit-confirmed',
    editManifest.id,
    editRequest.arguments,
  ))
  assert.equal(confirmedEditTask.status, 'succeeded')
  assert.equal(confirmedEditTask.policy.outcome, 'requires-confirmation')
  assert.ok(Number.isFinite(confirmedEditTask.confirmationConfirmedAt))
  assert.equal(builtinEditInput.idempotencyKey, confirmedEditTask.idempotencyKey)
  assert.deepEqual((await persistence.list(confirmedEditTask.id)).map((entry) => entry.type), [
    'task.created',
    'task.confirmed',
    'task.started',
    'task.succeeded',
  ])

  const cancellingSearchController = new AbortController()
  const cancellingSearchRequest = {
    toolId: searchManifest.id,
    source: 'builtin',
    arguments: { query: 'cancel in-flight search', limit: 2 },
  }
  const cancellingSearchExecution = adapter.executeExternal({
    stepId: 'agent-builtin-search-cancelled',
    assistantRunId: 'run-search-cancelled',
    request: cancellingSearchRequest,
    options: { manifests: [searchManifest], signal: cancellingSearchController.signal },
  })
  await cancellingSearchExecutorStartedPromise
  cancellingSearchController.abort()
  const cancelledSearch = (await cancellingSearchExecution).observation
  assert.equal(cancelledSearch.ok, false)
  assert.equal(cancelledSearch.status, 'skipped')
  assert.equal(cancelledSearch.errorCode, 'cancelled', 'in-flight built-in search cancellation remains visible as cancellation')
  assert.equal(cancelledSearch.diagnostic.status, 'cancelled')
  assert.equal(cancelledSearch.metadata.vnextTaskStatus, 'cancelled')
  const cancelledSearchTask = await persistence.findByIdempotencyKey(taskKey(
    'run-search-cancelled',
    'agent-builtin-search-cancelled',
    searchManifest.id,
    cancellingSearchRequest.arguments,
  ))
  assert.equal(cancelledSearchTask.status, 'cancelled', 'in-flight built-in search cancellation is persisted durably')
  const cancelledSearchExecutionCount = builtinSearchExecutions
  const replayedCancelledSearch = (await adapter.executeExternal({
    stepId: 'agent-builtin-search-cancelled',
    assistantRunId: 'run-search-cancelled',
    request: cancellingSearchRequest,
    options: { manifests: [searchManifest] },
  })).observation
  assert.equal(replayedCancelledSearch.errorCode, 'cancelled', 'cancelled built-in search replay preserves cancellation')
  assert.equal(replayedCancelledSearch.diagnostic.status, 'cancelled')
  assert.equal(replayedCancelledSearch.metadata.vnextTaskStatus, 'cancelled')
  assert.equal(builtinSearchExecutions, cancelledSearchExecutionCount, 'cancelled built-in search replay never repeats the network-backed executor')
  const legacyCancelledSearch = await adapter.execute({
    stepId: 'agent-builtin-search-cancelled',
    assistantRunId: 'run-search-cancelled',
    request: cancellingSearchRequest,
    options: { manifests: [searchManifest] },
  })
  assert.equal(legacyCancelledSearch.errorCode, replayedCancelledSearch.errorCode, 'Agent execution preserves target cancellation replay')
  assert.equal(legacyCancelledSearch.diagnostic.status, replayedCancelledSearch.diagnostic.status)
  assert.equal(builtinSearchExecutions, cancelledSearchExecutionCount)

  const overLimit = await adapter.execute({
    stepId: 'agent-builtin-search-over-limit',
    request: searchRequest,
    options: {
      manifests: [searchManifest],
      stepIndex: 0,
      toolCallIndex: 1,
      limits: { maxSteps: 3, maxToolCallsPerStep: 1 },
    },
  })
  assert.equal(overLimit.errorCode, 'step_limit_reached')
  assert.equal(overLimit.diagnostic.metadata?.stepIndex, 0)
  assert.equal(overLimit.diagnostic.metadata?.toolCallIndex, 1)
  assert.equal(overLimit.diagnostic.metadata?.maxToolCallsPerStep, 1)
  assert.equal(overLimit.diagnostic.metadata?.maxStepCount, 3)
  assert.equal(builtinSearchExecutions, cancelledSearchExecutionCount, 'over-limit search never reaches the built-in executor')

  const schemaInvalidMcp = await adapter.execute({
    stepId: 'chat-mcp-schema-invalid',
    request: { toolId: mcpManifest.id, arguments: { extra: true } },
    options: { manifests: [mcpManifest], userConfirmed: false },
  })
  assert.equal(schemaInvalidMcp.errorCode, 'schema_invalid')
  assert.match(schemaInvalidMcp.output, /query is required/)
  assert.match(schemaInvalidMcp.output, /extra is not allowed/)
  assert.equal(directMcpExecutions, 1, 'schema-invalid requests never reach an external executor')
  assert.equal(await persistence.findByIdempotencyKey(taskKey(undefined, 'chat-mcp-schema-invalid', mcpManifest.id, { extra: true })), undefined,
    'schema-invalid requests fail before durable task creation')
  const malformedSchemaManifest = {
    ...mcpManifest,
    inputSchema: { type: 'object', properties: { query: null } },
  }
  const malformedSchemaMcp = await adapter.execute({
    stepId: 'chat-mcp-malformed-schema',
    request: mcpRequest,
    options: { manifests: [malformedSchemaManifest], userConfirmed: false },
  })
  assert.equal(malformedSchemaMcp.errorCode, 'schema_invalid')
  assert.equal(directMcpExecutions, 1, 'malformed untrusted schemas fail closed before external execution')

  const failedMcpRequest = { toolId: mcpManifest.id, arguments: { query: 'fail' } }
  const failedMcp = await adapter.execute({
    stepId: 'chat-mcp-failure',
    request: failedMcpRequest,
    options: { manifests: [mcpManifest], userConfirmed: false },
  })
  assert.equal(failedMcp.ok, false)
  assert.equal(failedMcp.errorCode, 'execution_failed')
  assert.equal(failedMcp.metadata.vnextTaskStatus, 'failed')
  assert.equal(directMcpExecutions, 2, 'MCP source failures execute once and never re-enter a generic executor')
  const failedMcpTask = await persistence.findByIdempotencyKey(taskKey(undefined, 'chat-mcp-failure', mcpManifest.id, failedMcpRequest.arguments))
  assert.equal(failedMcpTask.status, 'failed')

  const modeInvariantMcpResults = []
  for (const [label, mode] of [
    ['omitted', undefined],
    ['chat', 'chat'],
    ['agent', 'agent'],
    ['companion', 'companion'],
  ]) {
    const execution = await adapter.executeExternal({
      stepId: `mode-invariant-${label}-mcp-read`,
      request: mcpRequest,
      options: {
        manifests: [mcpManifest],
        ...(mode ? { mode } : {}),
        userConfirmed: false,
      },
    })
    modeInvariantMcpResults.push(execution.observation)
  }
  assert.ok(modeInvariantMcpResults.every((result) => result.ok), 'historical mode input cannot change external-tool authorization')
  assert.ok(modeInvariantMcpResults.every((result) => !('mode' in result.metadata)), 'target observations emit no product-mode authority')
  assert.ok(modeInvariantMcpResults.every((result) => !('mode' in result.diagnostic.metadata)), 'target diagnostics emit no product-mode authority')
  assert.equal(directMcpExecutions, 6, 'each authorization-invariant request reaches the external adapter exactly once')

  const malformedResult = await adapter.execute({
    stepId: 'malformed-source-result',
    request: { toolId: malformedBuiltinManifest.id, arguments: {} },
    options: { manifests: [malformedBuiltinManifest], userConfirmed: false },
  })
  assert.equal(malformedResult.ok, false)
  assert.equal(malformedResult.status, 'error', 'incoherent failed success statuses normalize to error')
  assert.equal(malformedResult.errorCode, 'execution_failed')
  assert.equal(malformedResult.diagnostic.status, 'error')
  assert.ok(malformedResult.output.length <= 12_000)
  assert.equal(malformedResult.blocks.length, 64)
  assert.ok(malformedResult.diagnostic.metadata.oversized.length <= 4_096)
  assert.equal(malformedResult.metadata.toolId, malformedBuiltinManifest.id, 'target tool identity overrides spoofed source metadata')
  assert.equal(malformedResult.metadata.source, 'builtin', 'target source identity overrides spoofed source metadata')
  assert.equal(malformedResult.diagnostic.id, `external-tool-${malformedBuiltinManifest.id}`)
  assert.equal(malformedResult.diagnostic.type, 'tool', 'external diagnostics cannot claim system attribution')
  assert.equal(malformedResult.diagnostic.title, `External tool ${malformedBuiltinManifest.name}`)
  assert.equal(malformedResult.diagnostic.metadata.toolId, malformedBuiltinManifest.id)
  assert.equal(malformedResult.diagnostic.metadata.source, 'builtin')
  assert.equal(malformedResult.metadata.vnextTaskStatus, 'failed')

  const appActionManifest = {
    id: 'app-action:get_settings',
    source: 'app-action',
    name: 'get_settings',
    description: 'Read settings',
    permission: 'read-only',
    enabled: true,
  }
  const fallbackAdapter = adapterModule.createTaskBoundToolRuntime({
    createTaskRuntime: (policyEvaluator) => taskModule.createTaskRuntime({ clock: { now: () => ++now }, ids, persistence, policyEvaluator }),
    async listToolManifests() { return [appActionManifest] },
    async executeAppActionTool(tool) {
      assert.equal(tool.source, 'app-action')
      return externalResult({ ok: true, status: 'done', output: 'Settings read completed.' })
    },
    async executeMcpTool() { throw new Error('Unexpected MCP execution.') },
    async executeBuiltinTool() { throw new Error('Unexpected builtin execution.') },
    async executeAndroidTool() { throw new Error('Unexpected Android execution.') },
  })
  const appAction = await fallbackAdapter.execute({
    stepId: 'app-action-target-binding',
    request: { toolId: appActionManifest.id, arguments: {} },
    options: { manifests: [appActionManifest], userConfirmed: false },
  })
  assert.equal(appAction.ok, true, 'app actions execute through the target settings command binding')
  assert.equal(appAction.metadata.vnextTaskStatus, 'succeeded')

  const workArtifactManifest = integrationsModule.WORK_ARTIFACT_TOOL_MANIFEST
  const workArtifactRequest = {
    toolId: workArtifactManifest.id,
    arguments: {
      content: [
        'Summary',
        '- Migrated the task-bound work artifact path.',
        'Actions',
        '- Owner: Agent. Next: run focused validation.',
        'Decisions',
        '- Keep deterministic replay pure.',
        'Risks',
        '- Existing task results only persist bounded summaries.',
        'Open questions',
        '- None.',
        'Evidence',
        '- bun run test:vnext-agent-task-adapter',
      ].join('\n'),
      sourceMessageId: 'message-work-artifact-1',
      citations: [{ id: 'gate-1', label: 'focused gate' }],
    },
  }
  const workArtifact = await adapter.execute({
    stepId: 'work-artifact-target-adapter',
    assistantRunId: 'run-work-artifact-1',
    request: workArtifactRequest,
    options: { manifests: [workArtifactManifest], userConfirmed: false },
  })
  assert.equal(workArtifact.ok, true, 'work artifacts execute through the target durable task path')
  assert.equal(workArtifact.metadata.vnextTaskStatus, 'succeeded')
  assert.equal(workArtifact.metadata.vnextAssistantRunId, 'run-work-artifact-1')
  assert.equal(typeof workArtifact.diagnostic.metadata.qualityAuditOk, 'boolean')
  assert.equal(workArtifact.diagnostic.metadata.source, 'work-artifact')
  assert.equal(workArtifact.diagnostic.metadata.workArtifactOutput.sourceMessageId, 'message-work-artifact-1')
  assert.deepEqual(workArtifact.diagnostic.metadata.workArtifactOutput.citations, [{ id: 'gate-1', label: 'focused gate' }])
  const workArtifactTask = await persistence.findByIdempotencyKey(taskKey(
    'run-work-artifact-1',
    'work-artifact-target-adapter',
    workArtifactManifest.id,
    workArtifactRequest.arguments,
  ))
  assert.equal(workArtifactTask.status, 'succeeded')
  assert.deepEqual((await persistence.list(workArtifactTask.id)).map((entry) => entry.type), [
    'task.created',
    'task.started',
    'task.succeeded',
  ])

  const replayedWorkArtifact = await adapter.execute({
    stepId: 'work-artifact-target-adapter',
    assistantRunId: 'run-work-artifact-1',
    request: workArtifactRequest,
    options: { manifests: [workArtifactManifest], userConfirmed: false },
  })
  assert.equal(replayedWorkArtifact.ok, true)
  assert.equal(replayedWorkArtifact.metadata.replayed, true)
  assert.equal(replayedWorkArtifact.output, workArtifact.output, 'pure replay restores the exact visible output')
  assert.equal(replayedWorkArtifact.diagnostic.id, workArtifact.diagnostic.id, 'pure replay retains the persisted task start identity')
  assert.deepEqual(
    replayedWorkArtifact.diagnostic.metadata.workArtifactOutput,
    workArtifact.diagnostic.metadata.workArtifactOutput,
    'pure replay deterministically rebuilds exact quality, evidence, gap, and handoff metadata',
  )
  assert.deepEqual((await persistence.list(workArtifactTask.id)).map((entry) => entry.type), [
    'task.created',
    'task.started',
    'task.succeeded',
  ], 'successful work-artifact replay does not append duplicate task events')

  const chatConfirmed = await adapter.execute({
    stepId: 'chat-step-confirmed',
    request,
    options: { manifests: [manifest], intentVisible: true, userConfirmed: true },
  })
  assert.equal(chatConfirmed.ok, true, 'Chat executes the same confirmed durable tool request')
  assert.equal(chatConfirmed.metadata.vnextTaskStatus, 'succeeded')
  assert.equal('mode' in chatConfirmed.metadata, false, 'successful task metadata emits no product-mode authority')
  assert.equal('mode' in chatConfirmed.diagnostic.metadata, false, 'successful task diagnostics emit no product-mode authority')
  assert.equal(executions, 3, 'confirmed Chat execution reaches the source adapter exactly once')
  const chatConfirmedTask = await persistence.findByIdempotencyKey(taskKey(undefined, 'chat-step-confirmed', manifest.id, request.arguments))
  assert.equal(chatConfirmedTask.status, 'succeeded')
  assert.equal(chatConfirmedTask.failure, undefined)

  const missingExternal = await adapter.execute({
    stepId: 'missing-external-tool',
    request: { toolId: 'mcp:missing-server:missing.read', source: 'mcp', arguments: {} },
    options: { manifests: [], userConfirmed: false },
  })
  assert.equal(missingExternal.ok, false)
  assert.equal(missingExternal.errorCode, 'tool_unavailable')
  assert.equal(executions, 3, 'unresolved external tools fail closed instead of reaching the legacy executor')
  const sourceLessMissing = await adapter.execute({
    stepId: 'missing-source-less-tool',
    request: { name: 'missing.read', arguments: {} },
    options: { manifests: [], userConfirmed: false },
  })
  assert.equal(sourceLessMissing.errorCode, 'tool_unavailable', 'unresolved source-less requests fail closed')
  const malformedMcpManifest = { ...mcpManifest, id: 'mcp:missing-identity:fixture.read' }
  delete malformedMcpManifest.serverId
  const malformedMcp = await adapter.execute({
    stepId: 'malformed-mcp-identity',
    request: { toolId: malformedMcpManifest.id, source: 'mcp', arguments: {} },
    options: { manifests: [malformedMcpManifest], userConfirmed: false },
  })
  assert.equal(malformedMcp.errorCode, 'tool_unavailable')
  assert.equal(await persistence.findByIdempotencyKey(taskKey(undefined, 'malformed-mcp-identity', malformedMcpManifest.id, {})), undefined,
    'invalid MCP identity fails before creating a durable queued task')
  const mismatchedMcpManifest = { ...mcpManifest, id: 'mcp:other-server:fixture.read' }
  const mismatchedMcp = await adapter.execute({
    stepId: 'mismatched-mcp-identity',
    request: { toolId: mismatchedMcpManifest.id, source: 'mcp', arguments: { query: 'fixture' } },
    options: { manifests: [mismatchedMcpManifest], userConfirmed: false },
  })
  assert.equal(mismatchedMcp.errorCode, 'tool_unavailable')
  assert.equal(await persistence.findByIdempotencyKey(taskKey(undefined, 'mismatched-mcp-identity', mismatchedMcpManifest.id, { query: 'fixture' })), undefined)
  const whitespaceMcpManifest = { ...mcpManifest, serverId: ' fixture-server ' }
  const whitespaceMcp = await adapter.execute({
    stepId: 'whitespace-mcp-identity',
    request: { toolId: whitespaceMcpManifest.id, source: 'mcp', arguments: { query: 'fixture' } },
    options: { manifests: [whitespaceMcpManifest], userConfirmed: false },
  })
  assert.equal(whitespaceMcp.errorCode, 'tool_unavailable')

  let releaseManifestLookup
  let manifestLookupStarted
  const manifestLookupGate = new Promise((resolve) => { releaseManifestLookup = resolve })
  const manifestLookupStartedPromise = new Promise((resolve) => { manifestLookupStarted = resolve })
  const delayedLookupAdapter = adapterModule.createTaskBoundToolRuntime({
    createTaskRuntime: (policyEvaluator) => taskModule.createTaskRuntime({ clock: { now: () => ++now }, ids, persistence, policyEvaluator }),
    async listToolManifests() {
      manifestLookupStarted()
      await manifestLookupGate
      return [manifest]
    },
    async executeMcpTool() { throw new Error('Unexpected MCP execution.') },
    async executeBuiltinTool() { throw new Error('Unexpected builtin execution.') },
    async executeAppActionTool() { throw new Error('Unexpected app-action execution.') },
    async executeAndroidTool() { throw new Error('Unexpected Android execution.') },
  })
  const lookupCancellation = new AbortController()
  const cancelledDuringLookupExecution = delayedLookupAdapter.execute({
    stepId: 'cancelled-during-manifest-lookup',
    request,
    options: { signal: lookupCancellation.signal },
  })
  await manifestLookupStartedPromise
  lookupCancellation.abort()
  releaseManifestLookup()
  const cancelledDuringLookup = await cancelledDuringLookupExecution
  assert.equal(cancelledDuringLookup.errorCode, 'cancelled')
  assert.equal(await persistence.findByIdempotencyKey(taskKey(undefined, 'cancelled-during-manifest-lookup', manifest.id, request.arguments)), undefined,
    'cancellation during manifest resolution fails before durable task creation')

  const postCreateCancellation = new AbortController()
  let postCreateExecutions = 0
  const failedCancellationAdapter = adapterModule.createTaskBoundToolRuntime({
    createTaskRuntime: (policyEvaluator) => {
      const runtime = taskModule.createTaskRuntime({ clock: { now: () => ++now }, ids, persistence, policyEvaluator })
      return {
        ...runtime,
        async create(input) {
          const created = await runtime.create(input)
          postCreateCancellation.abort()
          return created
        },
        async cancel() {
          return { ok: false, error: { code: 'persistence_failed', message: 'Fixture cancellation persistence failed.' } }
        },
      }
    },
    async listToolManifests() { return [manifest] },
    async executeMcpTool() { throw new Error('Unexpected MCP execution.') },
    async executeBuiltinTool() { throw new Error('Unexpected builtin execution.') },
    async executeAppActionTool() { throw new Error('Unexpected app-action execution.') },
    async executeAndroidTool() {
      postCreateExecutions += 1
      return externalResult({ ok: true, status: 'done', output: 'Unexpected execution.' })
    },
  })
  const failedCancellation = await failedCancellationAdapter.execute({
    stepId: 'post-create-cancellation-failure',
    request,
    options: {
      manifests: [manifest],
      intentVisible: true,
      userConfirmed: true,
      signal: postCreateCancellation.signal,
    },
  })
  assert.equal(failedCancellation.errorCode, 'execution_failed', 'failed durable cancellation does not claim cancellation')
  assert.equal(failedCancellation.metadata.vnextTaskStatus, 'queued')
  assert.equal(postCreateExecutions, 0)

  const preAbortedController = new AbortController()
  preAbortedController.abort()
  const preAbortedMcp = await adapter.execute({
    stepId: 'pre-aborted-mcp',
    request: mcpRequest,
    options: { manifests: [mcpManifest], signal: preAbortedController.signal },
  })
  assert.equal(preAbortedMcp.errorCode, 'cancelled')
  const preAbortedWrite = await adapter.execute({
    stepId: 'pre-aborted-write',
    request,
    options: { manifests: [manifest], signal: preAbortedController.signal },
  })
  assert.equal(preAbortedWrite.errorCode, 'cancelled')
  assert.equal(await persistence.findByIdempotencyKey(taskKey(undefined, 'pre-aborted-write', manifest.id, request.arguments)), undefined,
    'pre-aborted confirmation-gated requests do not create pending tasks')
  const internalFallback = await adapter.execute({
    stepId: 'internal-tool-fallback',
    request: { toolId: 'rag:context_pack', source: 'rag', arguments: {} },
    options: { manifests: [], userConfirmed: false },
  })
  assert.equal(internalFallback, undefined, 'only internal tools remain eligible for the temporary legacy path')

  const cancellationController = new AbortController()
  const cancelledRequest = { toolId: manifest.id, arguments: { target: 'cancel' } }
  const cancelledExecution = adapter.execute({
    stepId: 'agent-step-cancelled',
    request: cancelledRequest,
    options: { manifests: [manifest], intentVisible: true, userConfirmed: true, signal: cancellationController.signal },
  })
  await cancellationExecutorStartedPromise
  cancellationController.abort()
  const cancelled = await cancelledExecution
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.errorCode, 'cancelled')
  assert.equal(cancelled.metadata.vnextTaskStatus, 'cancelled')
  const cancelledTask = await persistence.findByIdempotencyKey(taskKey(undefined, 'agent-step-cancelled', manifest.id, cancelledRequest.arguments))
  assert.deepEqual((await persistence.list(cancelledTask.id)).map((entry) => entry.type), [
    'task.created',
    'task.started',
    'task.cancellation-requested',
    'task.cancelled',
  ])
  const cancelledReplayExecutionCount = executions
  const replayedCancellation = await adapter.execute({
    stepId: 'agent-step-cancelled',
    request: cancelledRequest,
    options: { manifests: [manifest], intentVisible: true, userConfirmed: true },
  })
  assert.equal(replayedCancellation.errorCode, 'cancelled', 'idempotent cancelled task replay preserves cancellation')
  assert.equal(replayedCancellation.metadata.vnextTaskStatus, 'cancelled')
  assert.equal(executions, cancelledReplayExecutionCount, 'cancelled replay never repeats the external side effect')

  const throwingCancellationController = new AbortController()
  const throwingCancelledRequest = { toolId: manifest.id, arguments: { target: 'throw-cancel' } }
  const throwingCancelledExecution = adapter.execute({
    stepId: 'agent-step-throw-cancelled',
    request: throwingCancelledRequest,
    options: { manifests: [manifest], intentVisible: true, userConfirmed: true, signal: throwingCancellationController.signal },
  })
  await throwingCancellationExecutorStartedPromise
  throwingCancellationController.abort()
  const throwingCancelled = await throwingCancelledExecution
  assert.equal(throwingCancelled.errorCode, 'cancelled')
  assert.equal(throwingCancelled.metadata.vnextTaskStatus, 'cancelled')
  const throwingCancelledTask = await persistence.findByIdempotencyKey(taskKey(undefined, 'agent-step-throw-cancelled', manifest.id, throwingCancelledRequest.arguments))
  assert.equal(throwingCancelledTask.status, 'cancelled', 'abort exceptions reconcile visible and durable cancellation')

  console.log('vNext agent task-adapter tests passed')
}

function externalResult(input) {
  const diagnostic = trace('external-result', 'tool', input.errorCode === 'cancelled' ? 'cancelled' : input.ok ? 'done' : 'error', input.output)
  return {
    summary: input.output,
    observation: {
      ...input,
      blocks: input.blocks ?? [{ type: 'text', text: input.output }],
      diagnostic,
    },
  }
}

function trace(id, type, status, content) {
  return { id, type, title: id, status, content, startedAt: 1 }
}

function taskKey(assistantRunId, stepId, toolId, argumentsValue) {
  return `agent:${hashText(assistantRunId ?? 'unowned')}:${hashText(stepId)}:${hashText(toolId)}:${hashText(stableSerialize(argumentsValue))}`
}

function stableSerialize(value, depth = 0) {
  if (depth > 8) return '[depth-limit]'
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 4096))
  if (Array.isArray(value)) return `[${value.slice(0, 64).map((item) => stableSerialize(item, depth + 1)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().slice(0, 64).map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], depth + 1)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
