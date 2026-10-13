import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createModelOperationAuthorizationPolicy, createTaskRuntime, type Task, type TaskJournalEntry, type TaskPersistence } from '@/modules/tasks'
import { createModelOperationCatalogSnapshot, formatTaggedModelOperationPrompt, type ConversationToolCatalogManifest, type ExternalToolExecutionResult } from '@/modules/integrations'
import { createAgentDefinition, createAssistantRuntime, MODEL_OPERATION_CONFIRMATION_TTL_MS, type AssistantRun } from '@/modules/assistant-runtime'
import { NativeModules, Platform } from 'react-native'
import { createInMemoryRunStore } from '../modules/assistant-runtime/testing/inMemoryRunStore'
import { executeAndroidDeviceTool, listAndroidDeviceToolManifests } from '@/services/androidDeviceTools'
import { createConversationModelOperationSession, type ConversationModelOperationRuntimeInput, type ConversationModelOperationSessionDependencies } from './conversationModelOperationRuntime'
import { resolveAgentModelBinding } from './agentModelBinding'
import { createTaskBoundToolRuntime, type ExecuteTaskBoundToolInput } from './taskBoundToolRuntime'

jest.mock('@/bootstrap/taskRuntime', () => ({ createTaskRuntime: () => { throw new Error('unbound task runtime') } }))
jest.mock('@/bootstrap/executionResources', () => ({ executionResources: {}, assertExecutionResourcesAvailable: () => {} }))
jest.mock('./assistantExecutionHostRuntime', () => ({ assistantExecutionHost: {} }))
jest.mock('@/bootstrap/workArtifactWorkflow', () => ({ buildWorkArtifactWorkflowOutput: () => { throw new Error('unexpected artifact') } }))
jest.mock('@/platform/native/runtimeLog', () => ({ appendRuntimeLog: jest.fn(async () => undefined) }))
jest.mock('@/i18n/service', () => ({ st: (_key: string, _args: unknown, fallback: string) => fallback }))

const tool: ConversationToolCatalogManifest = { id: 'android:effect-fixture', name: 'android.files.apply_operations', source: 'android',
  description: 'Fixture file operation', permission: 'read-write', enabled: true, requiresConfirmation: true,
  inputSchema: { type: 'object', properties: {} } }
const intent = { id: 'saf-1', kind: 'file' as const, action: 'copy' as const,
  sourceUri: 'content://p/tree/root/document/source', targetParentUri: 'content://p/tree/root', targetName: 'copy.txt' }
const receipt = { id: 'saf-1', status: 'succeeded' as const, effect: 'applied' as const, bytesCopied: 12 }
const result = (): ExternalToolExecutionResult => ({ summary: 'adapter claimed success', observation: { ok: true, status: 'done',
  output: 'adapter claimed success', blocks: [{ type: 'text', text: 'adapter claimed success' }],
  diagnostic: { id: 'diag', type: 'tool', title: 'copy', status: 'done' } } })

function createStore(): TaskPersistence {
  const tasks = new Map<string, Task>(); const entries: TaskJournalEntry[] = []
  return {
    async get(id) { return tasks.get(id) },
    async findByIdempotencyKey(key) { return [...tasks.values()].find(task => task.idempotencyKey === key) },
    async listRecoverable() { return [...tasks.values()].filter(task => ['queued', 'running', 'awaiting-confirmation'].includes(task.status)) },
    async save(task) { tasks.set(task.id, task) },
    async append(entry) { entries.push(entry) },
    async list(id) { return entries.filter(entry => entry.taskId === id) },
    async appendAndSave(entry, task) {
      if (entry.sequence !== (tasks.get(task.id)?.journalSequence ?? 0) + 1) throw new Error('sequence conflict')
      entries.push(entry); tasks.set(task.id, task)
    },
  }
}

test.each(['read-only', 'read-write'] as const)('a %s tool requiring confirmation never dispatches on truthy non-boolean approval', async permission => {
  for (const userConfirmed of [1, 'true', 'false', [], {}]) {
    const store = createStore(); let now = 1
    const manifest = { ...tool, permission, requiresConfirmation: true }
    const executeAndroidTool = jest.fn(async () => result())
    const unavailable = async () => { throw new Error('unexpected transport') }
    const runtime = createTaskBoundToolRuntime({
      createTaskRuntime: policyEvaluator => createTaskRuntime({ persistence: store, policyEvaluator,
        clock: { now: () => ++now }, ids: { next: () => 'malformed-confirmation' } }),
      listToolManifests: async () => [manifest], executeAndroidTool,
      executeBuiltinTool: unavailable, executeMcpTool: unavailable, executeAppActionTool: unavailable,
    })
    const outcome = await runtime.executeExternal({ stepId: 'invalid-confirmation',
      request: { toolId: manifest.id, arguments: {} }, options: { userConfirmed: userConfirmed as unknown as boolean } })
    expect(outcome.observation.ok).toBe(false)
    expect(outcome.observation.errorCode).toBe('permission_required')
    expect(outcome.observation.metadata?.userConfirmed).toBe(false)
    expect(executeAndroidTool).not.toHaveBeenCalled()
    expect((await store.get('malformed-confirmation' as never))?.status).toBe('awaiting-confirmation')
  }
})

test.each(['confirmation', 'policy', 'step-limit', 'during-admission'] as const)(
  'queued tasks cannot reuse prior permission after %s changes', async change => {
    const store = createStore(); let now = 1
    const executeAndroidTool = jest.fn(async () => result())
    const unavailable = async () => { throw new Error('unexpected transport') }
    const beforeTaskExecution = jest.fn(async (input: ExecuteTaskBoundToolInput) => {
      if (beforeTaskExecution.mock.calls.length === 1) throw new Error('admission unavailable')
      if (change === 'during-admission') input.options.userConfirmed = false
    })
    const runtime = createTaskBoundToolRuntime({
      createTaskRuntime: policyEvaluator => createTaskRuntime({ persistence: store, policyEvaluator,
        clock: { now: () => ++now }, ids: { next: () => 'queued-permission' } }),
      listToolManifests: async () => [tool], executeAndroidTool, beforeTaskExecution,
      executeBuiltinTool: unavailable, executeMcpTool: unavailable, executeAppActionTool: unavailable,
    })
    const input: ExecuteTaskBoundToolInput = { stepId: 'queued-permission',
      request: { toolId: tool.id, arguments: {} }, options: { userConfirmed: true } }
    await expect(runtime.executeExternal(input)).rejects.toThrow('admission unavailable')
    expect((await store.get('queued-permission' as never))?.status).toBe('queued')
    expect(executeAndroidTool).not.toHaveBeenCalled()
    const options = change === 'confirmation' ? { userConfirmed: false }
      : change === 'policy' ? { userConfirmed: true, limits: { allowReadWriteTools: false } }
        : change === 'step-limit' ? { userConfirmed: true, stepIndex: 3 } : { userConfirmed: true }
    const outcome = await runtime.executeExternal({ ...input, options })
    expect(outcome.observation.ok).toBe(false)
    expect(outcome.observation.errorCode).toBe(change === 'step-limit' ? 'step_limit_reached' : 'permission_required')
    if (change === 'policy') expect(outcome.observation.metadata?.decision).toBe('deny')
    expect(executeAndroidTool).not.toHaveBeenCalled()
    expect((await store.get('queued-permission' as never))?.status).toBe('queued')
    expect((await store.list('queued-permission' as never)).some(entry => entry.type === 'task.started')).toBe(false)
    beforeTaskExecution.mockImplementation(async () => undefined)
    expect((await runtime.executeExternal({ ...input, options: { userConfirmed: true } })).observation.ok).toBe(true)
    expect(executeAndroidTool).toHaveBeenCalledTimes(1)
  },
)

test('permission revoked while task.started is being persisted prevents adapter dispatch', async () => {
  const store = createStore(); let now = 1
  const input: ExecuteTaskBoundToolInput = { stepId: 'revoked-at-start',
    request: { toolId: tool.id, arguments: {} }, options: { userConfirmed: true } }
  const write = store.appendAndSave.bind(store)
  store.appendAndSave = async (entry, task) => {
    await write(entry, task)
    if (entry.type === 'task.started') input.options.userConfirmed = false
  }
  const executeAndroidTool = jest.fn(async () => result())
  const unavailable = async () => { throw new Error('unexpected transport') }
  const runtime = createTaskBoundToolRuntime({
    createTaskRuntime: policyEvaluator => createTaskRuntime({ persistence: store, policyEvaluator,
      clock: { now: () => ++now }, ids: { next: () => 'revoked-at-start' } }),
    listToolManifests: async () => [tool], executeAndroidTool,
    executeBuiltinTool: unavailable, executeMcpTool: unavailable, executeAppActionTool: unavailable,
  })
  const outcome = await runtime.executeExternal(input)
  expect(outcome.observation.ok).toBe(false)
  expect(executeAndroidTool).not.toHaveBeenCalled()
  expect((await store.get('revoked-at-start' as never))?.status).toBe('failed')
  expect((await store.list('revoked-at-start' as never)).some(entry => entry.type === 'task.effect-started')).toBe(false)
})

test.each(['success', 'cancelled', 'commit-failed'] as const)('durable %s effects reach feedback and an idempotent lookup never replays them', async scenario => {
  const store = createStore(); let now = 1
  const controller = new AbortController()
  if (scenario === 'commit-failed') {
    const write = store.appendAndSave.bind(store)
    store.appendAndSave = async (entry, task) => { if (entry.type === 'task.effect-settled') throw new Error('disk full'); return write(entry, task) }
  }
  const executeAndroidTool = jest.fn(async (_tool, _arguments, options) => {
    await options.effects.begin(intent)
    if (scenario === 'cancelled') controller.abort()
    // Malicious/buggy adapter swallows the write error. Tasks must still fence it.
    try { await options.effects.settle(receipt) } catch { /* Simulated adapter bug. */ }
    return result()
  })
  const unavailable = async () => { throw new Error('unexpected transport') }
  const runtime = createTaskBoundToolRuntime({
    createTaskRuntime: policyEvaluator => createTaskRuntime({ persistence: store, policyEvaluator,
      clock: { now: () => ++now }, ids: { next: () => 'task-effects' } }),
    listToolManifests: async () => [tool], executeAndroidTool,
    executeBuiltinTool: unavailable, executeMcpTool: unavailable, executeAppActionTool: unavailable,
  })
  const input: ExecuteTaskBoundToolInput = { stepId: 'step-1', assistantRunId: asAssistantRunId('run-1'),
    request: { toolId: tool.id, arguments: {} }, options: { userConfirmed: true, signal: controller.signal } }
  const first = await runtime.executeExternal(input)
  expect(executeAndroidTool).toHaveBeenCalledTimes(1)
  expect(first.observation.output).toContain('Durable local effects')
  expect(first.observation.output).toContain(scenario === 'commit-failed' ? '"missing":1' : '"applied":1')
  expect(first.observation.ok).toBe(scenario === 'success')
  if (scenario === 'cancelled') expect(first.observation.errorCode).toBe('cancelled')
  if (scenario === 'commit-failed') expect(first.observation.errorCode).toBe('evidence_insufficient')
  const again = await runtime.executeExternal({ ...input, options: { userConfirmed: true } })
  expect(executeAndroidTool).toHaveBeenCalledTimes(1)
  expect(again.observation.output).toContain('Durable local effects')
  expect(again.observation.ok).toBe(scenario === 'success')
})

test.each(['tool', 'arguments', 'run', 'confirmation', 'permission', 'changed-during-admission', 'matching'] as const)(
  'binds authentic authorization to the actual execution request: %s', async mismatch => {
    const store = createStore()
    const manifest = { ...tool, inputSchema: undefined }
    const policy = createModelOperationAuthorizationPolicy({
      resolveOperation: id => ({ id, permission: mismatch === 'permission' ? 'read-only' : 'read-write', available: true }),
      digestArguments: value => JSON.stringify(value),
      buildIdempotencyKey: value => JSON.stringify(value),
    })
    const expected = { runId: 'run-1', callId: 'call-1', operationId: manifest.id, catalogRevision: 'catalog-1',
      arguments: { targetName: 'approved.txt' }, permissionCeiling: mismatch === 'permission' ? 'read-only' as const : 'read-write' as const,
      confirmationStatus: mismatch === 'confirmation' ? 'pending' as const : 'confirmed' as const }
    const attested = policy.attest(expected, { ...expected, arguments: expected.arguments })
    if (!attested.ok) throw new Error('Fixture attestation failed')
    const executeAndroidTool = jest.fn(async () => result())
    const unavailable = async () => { throw new Error('unexpected transport') }
    const runtime = createTaskBoundToolRuntime({
      createTaskRuntime: policyEvaluator => createTaskRuntime({ persistence: store, policyEvaluator,
        clock: { now: () => 1 }, ids: { next: () => 'task-auth' } }),
      listToolManifests: async () => [mismatch === 'tool' ? { ...manifest, id: 'android:another-tool' } : manifest],
      beforeTaskExecution: async () => { if (mismatch === 'changed-during-admission') manifest.permission = 'destructive' },
      executeAndroidTool, executeBuiltinTool: unavailable, executeMcpTool: unavailable, executeAppActionTool: unavailable,
    })
    const outcome = await runtime.executeExternal({ stepId: 'step-1',
      assistantRunId: asAssistantRunId(mismatch === 'run' ? 'another-run' : 'run-1'),
      modelOperationAuthorization: { policy, attestation: attested.value, expected },
      request: { toolId: mismatch === 'tool' ? 'android:another-tool' : manifest.id,
        arguments: { targetName: mismatch === 'arguments' ? 'unapproved.txt' : 'approved.txt' } },
      options: { userConfirmed: true },
    })
    if (mismatch === 'matching') {
      expect(outcome.observation.ok).toBe(true)
      expect(executeAndroidTool).toHaveBeenCalledTimes(1)
      return
    }
    expect(outcome.observation.ok).toBe(false)
    expect(outcome.observation.errorCode).toBe('policy_denied')
    expect(executeAndroidTool).not.toHaveBeenCalled()
    if (mismatch !== 'changed-during-admission') expect(await store.listRecoverable()).toHaveLength(0)
  },
)

// In-memory journals and scripted model/native ports. The real Harness,
// confirmations, Tasks, Android service and native-port parser run together;
// these are not ART/SAF, SQLite or production-app execution claims.
const nativeFiles = { fileOperationVersion: 1, executeFileOperation: jest.fn(), cancelFileOperation: jest.fn(async () => true) }
test.each(['success', 'declined', 'expired', 'failed', 'cancelled', 'pause-resume'] as const)(
  'Harness → authorization → Tasks → Android port → receipts: %s (host)', async scenario => {
    const previousOS = Platform.OS
    const previousNativeFiles = NativeModules.AndroidDeviceTools
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true })
    NativeModules.AndroidDeviceTools = nativeFiles
    nativeFiles.executeFileOperation.mockReset(); nativeFiles.cancelFileOperation.mockClear()
    const tasks = createStore(); const runs = createInMemoryRunStore()
    const taskIds = new Set<Task['id']>()
    let now = Date.now(); let taskSequence = 0; let modelTurns = 0
    const runId = asAssistantRunId(`integrated-${scenario}`)
    const root = 'content://fixture/tree/root'
    const manifest = listAndroidDeviceToolManifests().find(item => item.name === 'android.files.apply_operations')!
    let enter!: () => void; let release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    nativeFiles.executeFileOperation.mockImplementation(async (requestId, action, input) => {
      // No bridge dispatch may precede its matching durable intent.
      const journal = (await Promise.all([...taskIds].map(id => tasks.list(id)))).flat()
      expect(journal.some(entry => entry.type === 'task.effect-started'
        && (entry.data?.intent as { id?: string })?.id === requestId)).toBe(true)
      enter()
      if (scenario === 'cancelled') await released
      const failed = scenario === 'failed' || scenario === 'cancelled'
      const targetUri = `${root}/document/${input.targetName}`
      return { requestId, action, status: scenario === 'cancelled' ? 'cancelled' : failed ? 'failed' : 'succeeded',
        effect: failed ? 'partial' : 'applied', bytesCopied: 4096, targetUri,
        completedSteps: failed ? ['created'] : ['created', 'copied'],
        ...(failed ? { reason: scenario === 'cancelled' ? 'cancelled' : 'io_error' } : {}),
        data: failed ? undefined : { ok: true, status: 'done', targetUri } }
    })
    const unavailable = async () => { throw new Error('unexpected transport') }
    const boundTools = createTaskBoundToolRuntime({
      createTaskRuntime: policyEvaluator => createTaskRuntime({ persistence: tasks, policyEvaluator, clock: { now: () => ++now },
        ids: { next: () => `integrated-task-${++taskSequence}` }, onRecorded: (_entry, task) => { taskIds.add(task.id) } }),
      listToolManifests: async () => [manifest], executeAndroidTool: executeAndroidDeviceTool,
      executeBuiltinTool: unavailable, executeMcpTool: unavailable, executeAppActionTool: unavailable,
    })
    const catalog = createModelOperationCatalogSnapshot([{ id: manifest.id, name: manifest.name, description: manifest.description,
      inputSchema: manifest.inputSchema, permission: 'read-write', requiresConfirmation: true,
      capabilityScopes: ['source:android', 'permission:read-write'], executor: { kind: 'android', id: manifest.id }, availability: { status: 'available' } }])
    if (!catalog.ok) throw new Error(catalog.message)
    const prompt = formatTaggedModelOperationPrompt(catalog.snapshot)
    if (!prompt.ok) throw new Error(prompt.message)
    const sessionInput = { conversation: { id: 'integrated-chat', providerId: 'provider', model: 'gpt-4o', messages: [] },
      provider: { id: 'provider', enabled: true, type: 'openai', models: ['gpt-4o'], capabilities: { nativeTools: true } },
      settings: { agentWorkflowAllowReadWriteTools: true },
    } as unknown as ConversationModelOperationRuntimeInput
    const dependencies: ConversationModelOperationSessionDependencies = {
      createCatalog: async () => ({ ok: true, catalog: { snapshot: catalog.snapshot, taggedPrompt: prompt.prompt, manifests: [manifest] } }),
      executeExternal: boundTools.executeExternal, executeInternal: unavailable,
      declinePendingTask: async () => ({ ok: true }), createRagRuntime: async () => ({ buildContextPack: unavailable } as never), now: () => now,
    }
    const newSession = async () => (await createConversationModelOperationSession(sessionInput, dependencies))!
    const newRuntime = () => createAssistantRuntime({ persistence: runs, clock: { now: () => ++now }, ids: { next: () => runId },
      providerGateway: { describe: () => undefined, async *stream(request) {
        if (++modelTurns === 1) {
          for (let index = 0; index < 2; index++) yield { type: 'tool-call', toolCallId: `copy-${index}`,
            toolName: request.toolDefinitions![0].name, arguments: { operations: [{ id: `operation-${index}`, action: 'copy',
              sourceUri: `${root}/document/source`, targetParentUri: root, targetName: `copy-${index}.txt` }] } }
        } else {
          expect(request.messages.filter(message => message.role === 'tool')).toHaveLength(2)
          yield { type: 'text-delta', text: 'Inspect the recorded per-operation outcomes.' }
        }
      } } })
    let runtime = newRuntime(); let session = await newSession()
    const waitFor = async (predicate: (run: AssistantRun) => boolean) => {
      const value = await new Promise<AssistantRun>((resolve, reject) => {
        const inspect = (run: AssistantRun) => {
          if (predicate(run)) { unsubscribe(); resolve(run) }
          else if (['succeeded', 'failed', 'cancelled'].includes(run.status)) {
            unsubscribe(); void runs.list(runId).then(entries => reject(new Error(`Unexpected terminal run: ${JSON.stringify({ run, entries })}`)))
          }
        }
        const unsubscribe = runtime.subscribe(({ run }) => inspect(run))
        void runtime.getRun(runId).then(run => { if (run) inspect(run) })
      })
      // User commands arrive on a subsequent UI event, not from inside the
      // still-owned persistence projection that announced the waiting state.
      await new Promise(resolve => setTimeout(resolve, 0))
      return value
    }
    const definition = createAgentDefinition({ id: 'integrated-agent', name: 'File task', providerId: 'provider', modelId: 'gpt-4o' })
    definition.modelBinding = resolveAgentModelBinding(sessionInput.provider, 'gpt-4o')!
    definition.allowedToolIds = [manifest.id]
    const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'integrated-chat', providerId: 'provider', model: 'gpt-4o',
      messages: [{ id: 'user', role: 'user', text: 'Copy two fixture files' }], generationParameterSources: {} }
    try {
      const started = await runtime.start({ runId, agentDefinition: definition, request, modelOperationSession: session,
        context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('integrated-context'), createdAt: now,
          conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] } })
      if (!started.ok) throw new Error(JSON.stringify(started.error))
      const first = await waitFor(run => run.status === 'awaiting-confirmation')
      expect(nativeFiles.executeFileOperation).not.toHaveBeenCalled(); expect(taskIds.size).toBe(0)
      const identity = { continuationToken: first.pendingModelOperation!.continuationToken, continuationDigest: first.pendingModelOperation!.continuationDigest }
      if (scenario === 'expired') now += MODEL_OPERATION_CONFIRMATION_TTL_MS + 1
      let pause: Promise<unknown> | undefined
      const unsubscribe = runtime.subscribe(({ journalEntry }) => {
        if (scenario === 'pause-resume' && journalEntry.type === 'model-operation.selected' && !pause) pause = runtime.pause(runId)
      })
      const approving = runtime.approve({ runId, session, approved: scenario !== 'declined', ...identity })
      if (scenario === 'cancelled') { await entered; expect((await runtime.cancel(runId)).ok).toBe(true); release() }
      const approved = await approving; if (!approved.ok && scenario !== 'cancelled') throw new Error(JSON.stringify(approved.error))
      if (scenario === 'pause-resume') {
        await waitFor(run => run.status === 'paused'); await pause; unsubscribe()
        expect(nativeFiles.executeFileOperation).toHaveBeenCalledTimes(1)
        // Reconstruct owners from retained records. No retained opaque approval is reused.
        runtime = newRuntime(); session = await newSession()
        expect((await runtime.resume({ runId, modelOperationSession: session })).ok).toBe(true)
      } else unsubscribe()
      if (scenario === 'success' || scenario === 'pause-resume') {
        const second = await waitFor(run => run.status === 'awaiting-confirmation' && run.pendingModelOperation?.callId === 'copy-1')
        expect((await runtime.approve({ runId, session, approved: true, ...identity })).ok).toBe(false)
        expect(nativeFiles.executeFileOperation).toHaveBeenCalledTimes(1)
        await runtime.approve({ runId, session, approved: true, continuationToken: second.pendingModelOperation!.continuationToken,
          continuationDigest: second.pendingModelOperation!.continuationDigest })
      }
      const final = await waitFor(run => ['succeeded', 'failed', 'cancelled'].includes(run.status))
      expect(final.status).toBe(scenario === 'cancelled' ? 'cancelled' : 'succeeded')
      expect(modelTurns).toBe(scenario === 'cancelled' ? 1 : 2)
      const receipts = (await runs.list(runId)).filter(entry => entry.type === 'model-operation.selected').map(entry => entry.data?.receipt)
      const journals = (await Promise.all([...taskIds].map(id => tasks.list(id)))).flat()
      const effects = journals.filter(entry => entry.type === 'task.effect-settled').map(entry => entry.data?.receipt)
      if (scenario === 'declined' || scenario === 'expired') {
        expect(receipts).toEqual([expect.objectContaining({ status: 'rejected', code: `confirmation_${scenario}` }), expect.objectContaining({ code: 'batch_stopped' })])
        expect(effects).toHaveLength(0); expect(taskIds.size).toBe(0)
      } else if (scenario === 'failed' || scenario === 'cancelled') {
        expect(effects).toEqual([expect.objectContaining({ status: scenario, effect: 'partial', bytesCopied: 4096 })])
        expect(receipts[0]).toMatchObject({ status: scenario, output: expect.stringContaining('"partial":1') })
        expect(nativeFiles.executeFileOperation).toHaveBeenCalledTimes(1)
        if (scenario === 'failed') expect(receipts[1]).toMatchObject({ code: 'batch_stopped' })
        else {
          expect(nativeFiles.cancelFileOperation).toHaveBeenCalledTimes(1)
          expect((await runtime.resume({ runId, modelOperationSession: session })).ok).toBe(false)
        }
      } else {
        expect(receipts).toHaveLength(2); expect(effects).toHaveLength(2)
        expect(effects.every(value => (value as { effect: string }).effect === 'applied')).toBe(true)
        expect(nativeFiles.executeFileOperation).toHaveBeenCalledTimes(2)
      }
    } finally {
      release(); Object.defineProperty(Platform, 'OS', { value: previousOS, configurable: true })
      if (previousNativeFiles === undefined) delete NativeModules.AndroidDeviceTools
      else NativeModules.AndroidDeviceTools = previousNativeFiles
    }
  },
)
