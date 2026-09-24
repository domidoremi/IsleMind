import { describe, expect, it } from '@jest/globals'
import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from '@/platform/storage'
import type { ProviderGateway } from '@/modules/providers'
import { createAssistantRuntime } from '../runtime'
import { createAgentDefinition } from '../agentDefinition'
import { createHarnessCheckpoint, projectRunSnapshot } from '../harnessCheckpoint'
import type { AssistantModelOperationSession, AssistantModelOperationTurnOutcome, AssistantRun, PendingModelOperation } from '../contracts'
import { createSqliteAssistantRunPersistence } from './sqliteAssistantRunStore'
import { DELEGATE_OPERATION } from '../agentCollaboration'
import { checkProviderContextCapacity, ProviderContextCapacityError } from '@/modules/providers/providerContextCapacity'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => { resolve = yes })
  return { promise, resolve }
}

function fixture() {
  const { Database } = require('bun:sqlite')
  const native = new Database(':memory:')
  native.exec('PRAGMA foreign_keys=ON')
  const executor: SqliteExecutor = {
    async exec(sql) { native.exec(sql) },
    async run(sql, values = []) { const result = native.query(sql).run(...values); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) } },
    async getFirst<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).get(...values) as Row | null },
    async getAll<Row extends object>(sql: string, values: readonly SqliteValue[] = []) { return native.query(sql).all(...values) as Row[] },
  }
  let tail = Promise.resolve()
  const database: SqliteDatabase = { ...executor, transaction(work) {
    const result = tail.then(async () => {
      native.exec('BEGIN IMMEDIATE')
      try { const value = await work(executor); native.exec('COMMIT'); return value }
      catch (error) { native.exec('ROLLBACK'); throw error }
    })
    tail = result.then(() => undefined, () => undefined)
    return result
  } }
  const provider = { get: async () => database }
  const persistence = createSqliteAssistantRunPersistence(provider)
  let now = 10
  const runtime = (gateway: ProviderGateway) => createAssistantRuntime({ persistence,
    providerGateway: gateway, clock: { now: () => now++ }, ids: { next: () => `run-${now++}` } })
  return { native, persistence, provider, runtime }
}

const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'conversation', providerId: 'provider', model: 'model',
  messages: [{ id: 'user', role: 'user', text: 'work' }], generationParameterSources: {} }
const context = { schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('context'), createdAt: 1,
  conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
const definition = () => createAgentDefinition({ id: 'agent', name: 'Agent', providerId: 'provider', modelId: 'model' })
const finalGateway = (capture?: (request: ChatRequest) => void): ProviderGateway => ({ describe: () => undefined,
  async *stream(value) { capture?.(value); yield { type: 'text-delta', text: 'done' } } })
const session = (evaluateTurn: AssistantModelOperationSession['evaluateTurn']): AssistantModelOperationSession => ({
  prepareRequest: (value) => value, evaluateTurn, validatePending: () => true,
  async resume() { throw new Error('unexpected resume') },
})
const continuationRequest = (): ChatRequest => ({ ...request, messages: [...request.messages,
  { id: 'tool-call', role: 'assistant', text: '', toolCalls: [{ callId: 'call', name: 'write', arguments: {} }] },
  { id: 'receipt', role: 'tool', toolCallId: 'call', name: 'write', text: 'already completed' }] })

describe('Harness lifecycle (real SQLite)', () => {
  it('dynamically delegates two independent children through the same kernel and persists scope and links', async () => {
    const fx = fixture(); const entered = deferred(); const release = deferred(); let childCount = 0; let rootCalls = 0
    const root = definition(); root.modelBinding.actionCapability = 'native_tool_calling'; root.delegateAgentIds = ['child']
    root.allowedToolIds = ['read']; root.knowledgeIds = ['shared']
    const child = { ...definition(), id: 'child', modelBinding: root.modelBinding, allowedToolIds: ['read', 'write'], knowledgeIds: ['shared', 'secret'], delegateAgentIds: ['third'] }
    const seen: unknown[] = []
    const readSession: AssistantModelOperationSession = { ...session(async () => ({ kind: 'no-operation' })), async forAgent(agent: unknown, options: unknown) { seen.push({ agent, options }); return this },
      async forIndependentChild(agent, candidate) { return candidate?.forAgent?.(agent, { independentReadOnly: true }) } }
    const runtime = fx.runtime({ describe: () => undefined, async *stream(value) {
      rootCalls++
      if (rootCalls === 1) {
        expect(value.toolDefinitions?.some((tool) => tool.name === DELEGATE_OPERATION)).toBe(true)
        yield { type: 'tool-call', toolCallId: 'delegation', toolName: DELEGATE_OPERATION, arguments: { tasks: [{ agentId: 'child', task: 'fact one' }, { agentId: 'child', task: 'fact two' }] } }
      } else { expect(value.messages.at(-1)?.text).toContain('child evidence'); yield { type: 'text-delta', text: 'root synthesis' } }
    } })
    const execution = runtime.execute({ runId: asAssistantRunId('root-delegation'), request, context, agentDefinition: root, modelOperationSession: readSession,
      agentResolver: { resolve: async () => child, bind: async (agent, task) => {
        expect(agent.allowedToolIds).toEqual(['read']); expect(agent.knowledgeIds).toEqual(['shared']); expect(agent.delegateAgentIds).toEqual([])
        return { request: { ...request, messages: [{ id: 'task', role: 'user', text: task }] }, context, modelOperationSession: readSession,
          providerGateway: { describe: () => undefined, async *stream(value) {
            expect(value.toolDefinitions?.some((tool) => tool.name === DELEGATE_OPERATION)).not.toBe(true)
            if (++childCount === 2) entered.resolve(); await release.promise; yield { type: 'text-delta', text: 'child evidence' }
          } } }
      } } })
    try {
      await entered.promise
      const pending = await fx.persistence.get(asAssistantRunId('root-delegation'))
      expect(pending?.delegation?.children).toHaveLength(2)
      release.resolve(); const result = await execution
      expect(result.ok && result.value.result?.outputText).toBe('root synthesis')
      const fresh = createSqliteAssistantRunPersistence(fx.provider)
      const saved = await fresh.get(asAssistantRunId('root-delegation'))
      const childRun = await fresh.get(saved!.delegation!.children[0].runId)
      expect(childRun).toMatchObject({ rootRunId: 'root-delegation', parentRunId: 'root-delegation', status: 'succeeded' })
      expect(projectRunSnapshot(childRun!)).toMatchObject({ rootRunId: 'root-delegation', parentRunId: 'root-delegation' })
      expect((await fresh.listRuns!()).filter((run) => run.parentRunId === 'root-delegation')).toHaveLength(2)
      expect((await runtime.resume({ runId: childRun!.id })).ok).toBe(false)
      expect(seen).toContainEqual(expect.objectContaining({ options: { independentReadOnly: true } }))
    } finally { release.resolve(); await execution; fx.native.close() }
  })

  it('persists a six-child cap and never replays an unknown delegation after restart', async () => {
    const fx = fixture(); let children = 0
    const root = definition(); root.modelBinding.actionCapability = 'validated_structured_actions'; root.delegateAgentIds = ['child']
    const runtime = fx.runtime({ describe: () => undefined, async *stream() {
      yield { type: 'text-delta', text: '<islemind_delegate>{"tasks":[{"agentId":"child","task":"independent"},{"agentId":"child","task":"independent"}]}</islemind_delegate>' }
    } })
    try {
      await runtime.execute({ runId: asAssistantRunId('bounded'), request, context, agentDefinition: root,
        agentResolver: { resolve: async () => ({ ...definition(), id: 'child' }), bind: async () => {
          children++; return { request, context, providerGateway: finalGateway() }
        } } })
      expect(children).toBe(6)
      const saved = await fx.persistence.get(asAssistantRunId('bounded'))
      expect(saved?.delegation?.children).toHaveLength(6)
      const restarted = fx.runtime(finalGateway(() => { throw new Error('must not dispatch') }))
      await restarted.recoverInterruptedRuns()
      expect((await restarted.resume({ runId: asAssistantRunId('bounded') })).ok).toBe(false)
      expect((await fx.persistence.get(asAssistantRunId('bounded')))?.delegation?.children).toHaveLength(6)
    } finally { fx.native.close() }
  })

  it('root cancellation prevents late child output and cancels both child runs', async () => {
    const fx = fixture(); const entered = deferred(); const release = deferred(); let count = 0
    const root = definition(); root.modelBinding.actionCapability = 'native_tool_calling'; root.delegateAgentIds = ['child']
    const runtime = fx.runtime({ describe: () => undefined, async *stream() {
      yield { type: 'tool-call', toolCallId: 'delegate', toolName: DELEGATE_OPERATION, arguments: { tasks: [{ agentId: 'child', task: 'one' }, { agentId: 'child', task: 'two' }] } }
    } })
    const execution = runtime.execute({ runId: asAssistantRunId('cancel-parent'), request, context, agentDefinition: root,
      agentResolver: { resolve: async () => ({ ...definition(), id: 'child' }), bind: async () => ({ request, context,
        providerGateway: { describe: () => undefined, async *stream() { if (++count === 2) entered.resolve(); await release.promise; yield { type: 'text-delta', text: 'late' } } },
      }) } })
    try {
      await entered.promise; await runtime.cancel(asAssistantRunId('cancel-parent')); await execution
      const runs = await fx.persistence.listRuns!()
      expect(runs).toHaveLength(3); expect(runs.every((run) => run.status === 'cancelled')).toBe(true)
    } finally { release.resolve(); await execution; fx.native.close() }
  })

  it('independent review is opt-in for research/artifact only and bounded to two reworks', async () => {
    const fx = fixture(); let rootCalls = 0; let reviews = 0
    const root = definition(); root.reviewerPolicy = { mode: 'read_only', agentId: 'reviewer', maxReviews: 2 }
    const runtime = fx.runtime({ describe: () => undefined, async *stream() { rootCalls++; yield { type: 'text-delta', text: 'draft' } } })
    const resolver = { resolve: async () => ({ ...definition(), id: 'reviewer' }), bind: async (_agent: unknown, task: string) => {
      expect(task).toContain('Independently review'); expect(task).toContain('Draft:\ndraft')
      return { request: { ...request, messages: [{ id: 'review', role: 'user' as const, text: task }] }, context,
        providerGateway: { describe: () => undefined, async *stream() { reviews++; yield { type: 'text-delta' as const, text: '{"verdict":"rework","feedback":"cite the source"}' } } } }
    } }
    try {
      const chat = await runtime.execute({ request, context, agentDefinition: root, agentResolver: resolver })
      expect(chat.ok).toBe(true); expect(rootCalls).toBe(1); expect(reviews).toBe(0)
      const research = await runtime.execute({ request, context, agentDefinition: root, agentResolver: resolver, taskKind: 'research' })
      expect(research.ok && research.value.status).toBe('succeeded')
      expect(research.ok && research.value.delegation).toMatchObject({ reviewCount: 2, reworkCount: 2 })
      expect(rootCalls).toBe(4); expect(reviews).toBe(2)
      const fresh = createSqliteAssistantRunPersistence(fx.provider)
      expect(research.ok && (await fresh.get(research.value.id))?.delegation).toMatchObject({ reviewCount: 2, reworkCount: 2 })
    } finally { fx.native.close() }
  })

  it.each([
    { verdict: ['rework'], feedback: 'array must not pass' },
    { verdict: ['pass'], feedback: 'array must not pass' },
    { verdict: 'pass', feedback: 'extra fields must not pass', approved: true },
  ])('rejects a malformed independent review envelope: %j', async (verdict) => {
    const fx = fixture(); const root = definition(); root.reviewerPolicy = { mode: 'read_only', agentId: 'reviewer', maxReviews: 2 }
    try {
      const runtime = fx.runtime(finalGateway())
      const result = await runtime.execute({ runId: asAssistantRunId('invalid-review'), request, context, agentDefinition: root, taskKind: 'research',
        agentResolver: { resolve: async () => ({ ...definition(), id: 'reviewer' }), bind: async () => ({ request, context,
          providerGateway: { describe: () => undefined, async *stream() { yield { type: 'text-delta', text: JSON.stringify(verdict) } } },
        }) } })
      expect(result.ok).toBe(false)
      const saved = await fx.persistence.get(asAssistantRunId('invalid-review'))
      expect(saved?.status).toBe('failed'); expect(saved?.delegation).toMatchObject({ reviewCount: 1, reworkCount: 0 })
    } finally { fx.native.close() }
  })

  it('resumes a delegation-only root from its settled child receipt without a Tasks session or child replay', async () => {
    const fx = fixture(); let rootCalls = 0; let children = 0
    const root = definition(); root.modelBinding.actionCapability = 'validated_structured_actions'; root.delegateAgentIds = ['child']
    const runId = asAssistantRunId('receipt-pause')
    const runtime = fx.runtime({ describe: () => undefined, async *stream() {
      rootCalls++
      if (rootCalls === 1) yield { type: 'text-delta', text: '<islemind_delegate>{"tasks":[{"agentId":"child","task":"fact"}]}</islemind_delegate>' }
      else yield { type: 'text-delta', text: 'final synthesis' }
    } })
    const resolver = { resolve: async () => ({ ...definition(), id: 'child' }), bind: async () => {
      children++; return { request, context, providerGateway: finalGateway() }
    } }
    let pause: Promise<unknown> | undefined
    const unsubscribe = runtime.subscribe(({ run, journalEntry }) => {
      if (run.id === runId && journalEntry.type === 'model-operation.selected') pause = runtime.pause(runId)
    })
    try {
      const paused = await runtime.execute({ runId, request, context, agentDefinition: root, agentResolver: resolver })
      await pause; unsubscribe()
      expect(paused.ok && paused.value.status).toBe('paused')
      expect((await fx.persistence.get(runId))?.lifecycleCheckpoint).toMatchObject({ phase: 'ready', effectCertainty: 'settled', requiresOperationSession: false })
      const resumed = await runtime.resume({ runId, agentResolver: resolver })
      expect(resumed.ok).toBe(true)
      // Public resume returns after admission; await its terminal projection.
      for (let index = 0; index < 20 && (await fx.persistence.get(runId))?.status === 'running'; index++) await new Promise((resolve) => setTimeout(resolve, 0))
      expect((await fx.persistence.get(runId))?.status).toBe('succeeded')
      expect(children).toBe(1); expect(rootCalls).toBe(2)
    } finally { unsubscribe(); fx.native.close() }
  })
  it('admission refusal becomes a durable resumable pause rather than a provider failure', async () => {
    const fx = fixture(); const runId = asAssistantRunId('budget-pause')
    const runtime = createAssistantRuntime({ persistence: fx.persistence, clock: { now: () => 10 }, ids: { next: () => 'unused' },
      providerGateway: { describe: () => undefined, async *stream() { throw new Error('denied') } },
      governance: { created: async () => {}, lifecycle: async () => {}, beforeAttempt: async () => {},
        admissionPauseReason: (error) => error instanceof Error && error.message === 'denied' ? 'budget_exhausted' : undefined } })
    try {
      const result = await runtime.execute({ runId, request, context })
      expect(result.ok && result.value.status).toBe('paused')
      const saved = await fx.persistence.get(runId)
      expect(saved?.failure).toBeUndefined()
      expect(saved?.lifecycleCheckpoint?.waitingReason).toBe('budget_exhausted')
      expect(saved?.lifecycleCheckpoint?.recovery).toBe('resumable')
    } finally { fx.native.close() }
  })
  it('queued steering survives pause and external cancellation waits for an offline control', async () => {
    const fx = fixture(); const entered = deferred(); const release = deferred(); const parent = new AbortController()
    const runId = asAssistantRunId('control-queue'); const runtime = fx.runtime({ describe: () => undefined, async *stream() { entered.resolve(); await release.promise } })
    const append = fx.persistence.appendAndSave.bind(fx.persistence)
    let blocked = deferred(); let unblock = deferred()
    fx.persistence.appendAndSave = async (...args) => {
      if (args[0].type === 'run.steered') { blocked.resolve(); await unblock.promise }
      return append(...args)
    }
    try {
      const completion = runtime.execute({ runId, request, context, cancellationSignal: parent.signal }); await entered.promise
      const steering = runtime.steer(runId, 'keep this instruction'); await blocked.promise
      const pausing = runtime.pause(runId); unblock.resolve()
      await steering; await pausing; await completion
      expect((await runtime.getRun(runId))?.lifecycleCheckpoint?.steering[0].text).toBe('keep this instruction')
      blocked = deferred(); unblock = deferred()
      const moreSteering = runtime.steer(runId, 'another instruction'); await blocked.promise
      const cancelled = deferred(); runtime.subscribe(({ run }) => { if (run.status === 'cancelled') cancelled.resolve() })
      parent.abort(); unblock.resolve(); await moreSteering; await cancelled.promise
      expect((await runtime.getRun(runId))?.status).toBe('cancelled')
    } finally { unblock.resolve(); release.resolve(); fx.native.close() }
  })
  it('returns the durable pause and retains parent cancellation while waiting', async () => {
    const fx = fixture(); const entered = deferred(); const release = deferred()
    const parent = new AbortController(); const runId = asAssistantRunId('pause-parent')
    const runtime = fx.runtime({ describe: () => undefined, async *stream() { entered.resolve(); await release.promise } })
    try {
      const stopped = deferred()
      runtime.subscribe(({ run }) => { if (run.status === 'cancelled') stopped.resolve() })
      const completion = runtime.execute({ runId, request, context, cancellationSignal: parent.signal })
      await entered.promise
      expect((await runtime.pause(runId)).ok).toBe(true)
      const result = await completion
      expect(result.ok && result.value.status).toBe('paused')
      parent.abort(); await stopped.promise
      expect((await runtime.getRun(runId))?.status).toBe('cancelled')
    } finally { release.resolve(); fx.native.close() }
  })

  it('a normally settling Rich executor preserves pause and its initial safe request', async () => {
    const fx = fixture(); const entered = deferred(); const release = deferred()
    const runId = asAssistantRunId('rich-pause-settle'); const runtime = fx.runtime(finalGateway())
    try {
      const completion = runtime.executeActivity({ runId, request, context, kind: 'chat', conversationId: request.conversationId,
        providerId: request.providerId, model: request.model, executor: { async execute() { entered.resolve(); await release.promise; return { outputText: 'late' } } } })
      await entered.promise; await runtime.pause(runId); release.resolve()
      const result = await completion
      expect(result.ok && result.value.status).toBe('paused')
      expect((await runtime.getRun(runId))?.lifecycleCheckpoint?.request).toEqual(request)
      const finished = deferred(); runtime.subscribe(({ run }) => { if (run.status === 'succeeded') finished.resolve() })
      expect((await runtime.resume({ runId })).ok).toBe(true); await finished.promise
    } finally { release.resolve(); fx.native.close() }
  })

  it('accepted steering produces a bounded next turn even without tools', async () => {
    const fx = fixture(); const entered = deferred(); const release = deferred(); const requests: ChatRequest[] = []
    const runtime = fx.runtime({ describe: () => undefined, async *stream(value) {
      requests.push(value); if (requests.length === 1) { entered.resolve(); await release.promise }
      yield { type: 'text-delta', text: requests.length === 1 ? 'first answer' : 'revised answer' }
    } })
    const runId = asAssistantRunId('steer-text')
    try {
      const completion = runtime.execute({ runId, request, context }); await entered.promise
      expect((await runtime.steer(runId, 'shorter please')).ok).toBe(true); release.resolve()
      const result = await completion
      expect(requests).toHaveLength(2)
      expect(requests[1].messages.at(-1)?.text).toBe('shorter please')
      expect(result.ok && result.value.result?.outputText).toBe('revised answer')
      expect(result.ok && result.value.lifecycleCheckpoint?.steering).toHaveLength(0)
    } finally { release.resolve(); fx.native.close() }
  })

  it('a live pre-dispatch pause restores safety without clearing a crashed effect fence', async () => {
    const fx = fixture(); const runId = asAssistantRunId('before-operation'); const runtime = fx.runtime(finalGateway())
    let effects = 0
    const detach = runtime.subscribe(({ run, journalEntry }) => {
      if (journalEntry.type === 'run.checkpointed' && run.lifecycleCheckpoint?.phase === 'operation') void runtime.pause(runId)
    })
    try {
      const result = await runtime.execute({ runId, request, context, modelOperationSession: session(async () => { effects++; return { kind: 'no-operation' } }) })
      expect(effects).toBe(0)
      expect(result.ok && result.value.status).toBe('paused')
      expect(result.ok && result.value.lifecycleCheckpoint?.recovery).toBe('resumable')
    } finally { detach(); fx.native.close() }
  })
  it('public start freezes the Agent and returns before model completion; cancellation fences late output', async () => {
    const fx = fixture()
    const entered = deferred()
    const release = deferred()
    let signal: AbortSignal | undefined
    const agent = definition()
    agent.instructions = 'frozen instructions'
    let wire: ChatRequest | undefined
    const runtime = fx.runtime({ describe: () => undefined, async *stream(value, options) {
      wire = value; signal = options.signal; entered.resolve(); await release.promise
      yield { type: 'text-delta', text: 'too late' }
    } })
    try {
      const started = await runtime.start({ request, context, agentDefinition: agent })
      expect(started.ok).toBe(true)
      if (!started.ok) return
      agent.instructions = 'mutated settings'
      await entered.promise
      expect(wire?.systemPrompt).toBe('frozen instructions')
      expect((await runtime.getRun(started.value.id))?.agentDefinition?.instructions).toBe('frozen instructions')
      expect((await runtime.cancel(started.value.id)).ok).toBe(true)
      expect(signal?.aborted).toBe(true)
      release.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const saved = (await runtime.getRun(started.value.id))!
      expect(saved.status).toBe('cancelled')
      expect(saved.checkpoint?.outputText).not.toContain('too late')
      expect((await fx.persistence.list(saved.id)).at(-1)?.type).toBe('run.cancelled')
      expect(JSON.stringify(projectRunSnapshot(saved))).not.toContain('frozen instructions')
    } finally { release.resolve(); fx.native.close() }
  })

  it('pauses an uncooperative model; persists steering and explicitly resumes from the safe request', async () => {
    const fx = fixture()
    const entered = deferred()
    const release = deferred()
    const runId = asAssistantRunId('pause-model')
    let originalSignal: AbortSignal | undefined
    const runtime = fx.runtime({ describe: () => undefined, async *stream(_request, options) {
      originalSignal = options.signal; entered.resolve(); await release.promise
      yield { type: 'text-delta', text: 'stale' }
    } })
    try {
      const completion = runtime.execute({ runId, request, context })
      await entered.promise
      expect((await runtime.pause(runId)).ok).toBe(true)
      expect(originalSignal?.aborted).toBe(true)
      expect((await completion).ok).toBe(true)
      expect((await runtime.steer(runId, 'use a shorter answer')).ok).toBe(true)
      const reopened = createSqliteAssistantRunPersistence(fx.provider)
      expect((await reopened.get(runId))?.lifecycleCheckpoint?.steering[0].text).toBe('use a shorter answer')
      let resumedRequest: ChatRequest | undefined
      const resumedRuntime = fx.runtime(finalGateway((value) => { resumedRequest = value }))
      const finished = deferred()
      resumedRuntime.subscribe(({ run }) => { if (run.status === 'succeeded') finished.resolve() })
      expect((await resumedRuntime.resume({ runId })).ok).toBe(true)
      await finished.promise
      expect(resumedRequest?.messages.at(-1)?.text).toBe('use a shorter answer')
      expect((await reopened.get(runId))?.result?.outputText).toBe('done')
      expect((await reopened.get(runId))?.lifecycleCheckpoint?.steering).toHaveLength(0)
    } finally { release.resolve(); fx.native.close() }
  })

  it('requires a Tasks-scoped session for an action Agent instead of treating its definition as permission', async () => {
    const fx = fixture()
    let dispatched = 0
    try {
      const agent = definition()
      agent.modelBinding.actionCapability = 'native_tool_calling'
      agent.allowedToolIds = ['write']
      const runtime = fx.runtime(finalGateway(() => { dispatched++ }))
      const result = await runtime.start({ request, context, agentDefinition: agent, modelOperationSession: session(async () => ({ kind: 'no-operation' })) })
      expect(result.ok).toBe(false)
      expect(dispatched).toBe(0)
      expect(await fx.persistence.listRecoverable()).toHaveLength(0)
    } finally { fx.native.close() }
  })

  it('pause during a tool is uncertain; only a definitive receipt permits continuation without replay', async () => {
    const fx = fixture()
    const entered = deferred()
    const release = deferred<AssistantModelOperationTurnOutcome>()
    const runId = asAssistantRunId('pause-effect')
    let effects = 0
    const operations = session(async () => { effects++; entered.resolve(); return release.promise })
    const runtime = fx.runtime(finalGateway())
    try {
      const completion = runtime.execute({ runId, request, context, modelOperationSession: operations })
      await entered.promise
      await runtime.pause(runId)
      expect((await runtime.getRun(runId))?.lifecycleCheckpoint?.recovery).toBe('reconciliation-required')
      expect((await runtime.resume({ runId, modelOperationSession: operations })).ok).toBe(false)
      release.resolve({ kind: 'continue', request: continuationRequest(), receipt: { status: 'succeeded' } })
      await completion
      expect((await runtime.getRun(runId))?.lifecycleCheckpoint?.effectCertainty).toBe('settled')
      let seen: ChatRequest | undefined
      const completed = deferred()
      runtime.subscribe(({ run }) => { if (run.status === 'succeeded') completed.resolve() })
      await runtime.resume({ runId, modelOperationSession: session(async () => ({ kind: 'no-operation' })), providerGateway: finalGateway((value) => { seen = value }) })
      await completed.promise
      expect(effects).toBe(1)
      expect(seen?.messages.some((message) => message.role === 'tool' && message.text === 'already completed')).toBe(true)
    } finally { fx.native.close() }
  })

  it('restart never dispatches an uncertain effect or replays a legacy run', async () => {
    const fx = fixture()
    let dispatched = 0
    try {
      for (const [id, phase] of [['uncertain', 'operation'], ['safe', 'provider']] as const) {
        await fx.persistence.save({ id: asAssistantRunId(id), engineVersion: 'islemind.harness.v1', kind: 'chat',
          conversationId: request.conversationId, providerId: request.providerId, model: request.model, contextSnapshotId: context.id,
          status: 'running', createdAt: 1, startedAt: 1, journalSequence: 0,
          lifecycleCheckpoint: createHarnessCheckpoint({ request: phase === 'provider' ? continuationRequest() : request,
            stepIndex: 1, outputText: '', streamEventCount: 0, phase,
            effectCertainty: phase === 'operation' ? 'uncertain' : 'settled',
            recovery: phase === 'operation' ? 'reconciliation-required' : 'resumable', requiresOperationSession: false, steering: [] }),
        })
      }
      const legacy: AssistantRun = { id: asAssistantRunId('legacy'), kind: 'chat', conversationId: 'conversation', providerId: 'provider', model: 'model',
        contextSnapshotId: context.id, status: 'running', createdAt: 1, journalSequence: 0 }
      await fx.persistence.save(legacy)
      const runtime = fx.runtime(finalGateway(() => { dispatched++ }))
      expect((await runtime.recoverInterruptedRuns()).ok).toBe(true)
      expect(dispatched).toBe(0)
      expect((await runtime.getRun(asAssistantRunId('uncertain')))?.status).toBe('paused')
      expect((await runtime.resume({ runId: asAssistantRunId('uncertain') })).ok).toBe(false)
      expect((await runtime.pause(legacy.id)).ok).toBe(false)
      expect(await runtime.getRun(legacy.id)).toEqual(legacy)
      const finished = deferred()
      runtime.subscribe(({ run }) => { if (run.status === 'succeeded') finished.resolve() })
      expect((await runtime.resume({ runId: asAssistantRunId('safe') })).ok).toBe(true)
      await finished.promise
      expect(dispatched).toBe(1)
    } finally { fx.native.close() }
  })

  it('Rich confirmation persists, survives restart, rejects stale approval and executes once', async () => {
    const fx = fixture()
    const runId = asAssistantRunId('rich-hitl')
    let effects = 0
    const pending: PendingModelOperation = { schema: 'islemind.pending-model-operation.v1', runId, callId: 'call', operationId: 'write', catalogRevision: 'catalog',
      argumentDigest: 'arguments', idempotencyKey: 'key', continuationToken: 'token', continuationDigest: 'digest', stepIndex: 0, maxSteps: 5,
      requestedAt: 1, continuationRequest: request, continuationMode: 'native', continuationOutputText: '', continuationState: {} }
    const operations: AssistantModelOperationSession = { ...session(async () => ({ kind: 'awaiting-confirmation', pending, receipt: { status: 'pending_confirmation' } })),
      async resume({ signal }) { expect(signal.aborted).toBe(false); effects++; return { kind: 'continue', request: continuationRequest(), receipt: { status: 'succeeded' } } } }
    try {
      const runtime = fx.runtime(finalGateway())
      const result = await runtime.executeActivity({ runId, request, context, kind: 'chat', conversationId: request.conversationId,
        providerId: request.providerId, model: request.model, executor: { async execute(input) {
          return input.continueProviderTurns!({ request, session: operations, calls: [{ callId: 'call', name: 'write', arguments: {} }], reasoningReplay: [],
            outputText: 'narration', stream: finalGateway().stream })
        } } })
      expect(result.ok && result.value.status).toBe('awaiting-confirmation')
      const restarted = fx.runtime(finalGateway())
      await restarted.recoverInterruptedRuns()
      expect((await restarted.getRun(runId))?.status).toBe('awaiting-confirmation')
      expect((await restarted.approve({ runId, approved: true, session: operations, continuationToken: 'stale', continuationDigest: 'digest' })).ok).toBe(false)
      expect(effects).toBe(0)
      const finished = deferred()
      restarted.subscribe(({ run }) => { if (run.status === 'succeeded') finished.resolve() })
      const resumed = { ...operations, evaluateTurn: async () => ({ kind: 'no-operation' as const }) }
      expect((await restarted.approve({ runId, approved: true, session: resumed, continuationToken: 'token', continuationDigest: 'digest' })).ok).toBe(true)
      await finished.promise
      expect(effects).toBe(1)
      expect((await restarted.approve({ runId, approved: true, session: resumed, continuationToken: 'token', continuationDigest: 'digest' })).ok).toBe(false)
    } finally { fx.native.close() }
  })

  it('cancelling an active effect persists without its aborted signal and ignores its late receipt', async () => {
    const fx = fixture()
    const entered = deferred()
    const release = deferred<AssistantModelOperationTurnOutcome>()
    const runId = asAssistantRunId('cancel-effect')
    let operationSignal: AbortSignal | undefined
    const runtime = fx.runtime(finalGateway())
    try {
      const completion = runtime.execute({ runId, request, context, modelOperationSession: session(async ({ signal }) => {
        operationSignal = signal; entered.resolve(); return release.promise
      }) })
      await entered.promise
      expect((await runtime.cancel(runId)).ok).toBe(true)
      expect(operationSignal?.aborted).toBe(true)
      const before = await runtime.getRun(runId)
      release.resolve({ kind: 'continue', request: continuationRequest(), receipt: { status: 'succeeded' } })
      await completion
      expect(await runtime.getRun(runId)).toEqual(before)
      expect(before?.lifecycleCheckpoint?.effectCertainty).toBe('uncertain')
    } finally { fx.native.close() }
  })

  it('capacity admission persists the settled-tool continuation and resumes without executing the tool again', async () => {
    const fx = fixture()
    const runId = asAssistantRunId('capacity-after-tool')
    let effects = 0; let turns = 0
    const operations = session(async () => {
      effects++
      return { kind: 'continue', request: continuationRequest(), receipt: { status: 'succeeded' } }
    })
    const runtime = createAssistantRuntime({ persistence: fx.persistence, clock: { now: () => 100 }, ids: { next: () => 'capacity' },
      governance: { created: async () => undefined, lifecycle: async () => undefined, beforeAttempt: async () => undefined,
        admissionPauseReason: (error) => error instanceof ProviderContextCapacityError ? 'context_capacity' : undefined },
      providerGateway: { describe: () => undefined, async *stream(value) {
        if (++turns === 1) { yield { type: 'tool-call', toolCallId: 'call', toolName: 'write', arguments: {} }; return }
        checkProviderContextCapacity({ body: { messages: value.messages, tools: [{ description: 'oversized schema '.repeat(500) }] },
          contextWindow: 1000, defaultOutputTokens: 100 })
        throw new Error('Capacity should have blocked the wire dispatch')
      } },
    })
    try {
      const result = await runtime.execute({ runId, request, context, modelOperationSession: operations })
      expect(result.ok && result.value.status).toBe('paused')
      const checkpoint = (await fx.persistence.get(runId))!.lifecycleCheckpoint!
      expect(checkpoint.waitingReason).toBe('context_capacity')
      expect(checkpoint.effectCertainty).toBe('settled')
      expect(checkpoint.request.messages).toEqual(continuationRequest().messages)
      expect(effects).toBe(1)
      const restarted = fx.runtime(finalGateway((value) => { expect(value.messages).toEqual(continuationRequest().messages) }))
      await restarted.recoverInterruptedRuns()
      expect((await restarted.getRun(runId))!.lifecycleCheckpoint!.waitingReason).toBe('context_capacity')
      const finished = deferred()
      restarted.subscribe(({ run }) => { if (run.status === 'succeeded') finished.resolve() })
      const resume = await restarted.resume({ runId, modelOperationSession: session(async () => ({ kind: 'no-operation' })) })
      expect(resume.ok).toBe(true)
      await finished.promise
      expect(effects).toBe(1)
    } finally { fx.native.close() }
  })
})
