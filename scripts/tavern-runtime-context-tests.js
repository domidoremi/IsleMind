const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  CONTEXT_RUNTIME_SCHEMA,
  buildChatContextRuntime,
} = require('../src/bootstrap/contextContributionRuntime.ts')
const {
  CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA,
  createChatWorkspaceWritebackRuntime,
} = require('../src/modules/workspaces/application/chatWorkspaceWritebackRuntime.ts')
const {
  createConversationWorkspaceSourceRuntime,
  isValidConversationWorkspaceContext,
} = require('../src/modules/workspaces/application/conversationWorkspaceSourceRuntime.ts')
const {
  createAssistantConversationWorkspaceWritebackHandoffRuntime,
} = require('../src/modules/assistant-runtime/application/assistantConversationWorkspaceWritebackHandoffRuntime.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isTavernRuntimeContextHook) return

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
  hook.isTavernRuntimeContextHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assertHas(source, needle, label) {
  assert.ok(source.includes(needle), label)
}

function assertNotHas(source, needle, label) {
  assert.equal(source.includes(needle), false, label)
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

async function testChatWorkspaceWritebackRuntime() {
  const intent = deepFreeze({
    assistantRunId: 'chat-workspace-run',
    conversationId: 'chat-workspace-conversation',
    assistantMessageId: 'chat-workspace-message',
    workspaceId: 'chat-workspace',
    expectedAuthorityRevision: 4,
    idempotencyKey: 'chat-workspace-run:chat-workspace-message:4',
    finalOutput: 'Durable workspace writeback output.',
  })
  const identity = {
    schema: CHAT_WORKSPACE_WRITEBACK_RECEIPT_SCHEMA,
    assistantRunId: intent.assistantRunId,
    conversationId: intent.conversationId,
    assistantMessageId: intent.assistantMessageId,
    workspaceId: intent.workspaceId,
    expectedAuthorityRevision: intent.expectedAuthorityRevision,
    idempotencyKey: intent.idempotencyKey,
  }
  const statuses = [
    { status: 'applied', authorityRevision: 5 },
    { status: 'replayed', authorityRevision: 5 },
    { status: 'no_changes', authorityRevision: 4 },
    { status: 'conflict', actualAuthorityRevision: 6 },
    { status: 'cancelled', code: 'port_cancelled' },
    { status: 'failed', reason: 'Workspace persistence failed.', code: 'port_failed' },
  ]

  for (const expected of statuses) {
    const controller = new AbortController()
    const calls = []
    const runtime = createChatWorkspaceWritebackRuntime({
      port: {
        async writeback(candidate, options) {
          calls.push({ candidate, options })
          const { code: _code, ...receipt } = expected
          return { ...identity, ...receipt }
        },
      },
    })
    const outcome = await runtime.writeback(intent, { signal: controller.signal })
    assert.equal(outcome.status, expected.status)
    assert.equal(outcome.intent, intent, `${expected.status} preserves the exact immutable intent`)
    assert.equal(calls[0].candidate, intent, `${expected.status} forwards the exact intent to the port`)
    assert.equal(calls[0].options.signal, controller.signal, `${expected.status} forwards the exact signal`)
    if (expected.code) assert.equal(outcome.code, expected.code)
  }

  let invalidReceiptCalls = 0
  const invalidReceiptRuntime = createChatWorkspaceWritebackRuntime({
    port: {
      async writeback() {
        invalidReceiptCalls += 1
        return { ...identity, assistantRunId: 'different-run', status: 'applied', authorityRevision: 5 }
      },
    },
  })
  assert.deepEqual(
    await invalidReceiptRuntime.writeback(intent, { signal: new AbortController().signal }),
    { status: 'failed', code: 'invalid_receipt', intent },
    'writeback fails closed when a receipt does not echo the exact Chat run identity',
  )
  assert.equal(invalidReceiptCalls, 1)

  const unavailableReceiptRuntime = createChatWorkspaceWritebackRuntime({
    port: {
      async writeback() {
        return { ...identity, status: 'unavailable', reason: 'No atomic writer.' }
      },
    },
  })
  assert.deepEqual(
    await unavailableReceiptRuntime.writeback(intent, { signal: new AbortController().signal }),
    { status: 'failed', code: 'invalid_receipt', intent },
    'an unavailable-shaped receipt fails closed instead of reopening historical mutation',
  )

  let cancelledIoCalls = 0
  const preAborted = new AbortController()
  preAborted.abort('user_stopped')
  const cancelledRuntime = createChatWorkspaceWritebackRuntime({
    port: {
      async writeback() {
        cancelledIoCalls += 1
        return { ...identity, status: 'no_changes', authorityRevision: 4 }
      },
    },
  })
  assert.deepEqual(
    await cancelledRuntime.writeback(intent, { signal: preAborted.signal }),
    { status: 'cancelled', code: 'cancelled_before_io', intent },
    'pre-aborted writeback performs no persistence I/O',
  )
  assert.equal(cancelledIoCalls, 0)

  const postAborted = new AbortController()
  const postAbortRuntime = createChatWorkspaceWritebackRuntime({
    port: {
      async writeback() {
        postAborted.abort('user_stopped')
        return { ...identity, status: 'applied', authorityRevision: 5 }
      },
    },
  })
  assert.deepEqual(
    await postAbortRuntime.writeback(intent, { signal: postAborted.signal }),
    {
      status: 'applied',
      intent,
      receipt: { ...identity, status: 'applied', authorityRevision: 5 },
    },
    'a validated committed receipt remains authoritative after post-I/O cancellation',
  )

  const postAbortConflict = new AbortController()
  const postAbortConflictRuntime = createChatWorkspaceWritebackRuntime({
    port: {
      async writeback() {
        postAbortConflict.abort('user_stopped')
        return { ...identity, status: 'conflict', actualAuthorityRevision: 6 }
      },
    },
  })
  assert.deepEqual(
    await postAbortConflictRuntime.writeback(intent, { signal: postAbortConflict.signal }),
    { status: 'cancelled', code: 'cancelled_after_io', intent },
    'post-I/O cancellation still wins when no durable success receipt exists',
  )
}

async function testConversationWorkspaceWritebackHandoffCapture() {
  const workspaceSnapshot = deepFreeze({
    schema: 'islemind.tavern-snapshot.v1',
    characters: [{
      id: 'character-one',
      name: 'Aria',
      persona: 'Keeper',
      speechStyle: 'Warm',
      background: 'Lantern Tavern',
      constraints: [],
      tags: [],
      createdAt: 1,
      updatedAt: 2,
    }],
    lorebook: [],
    relationshipMemories: [],
    scenes: [{
      id: 'scene-one',
      title: 'Counter',
      location: 'Lantern Tavern',
      activeCharacterIds: ['character-one'],
      speakingOrder: ['character-one'],
      createdAt: 1,
      updatedAt: 2,
    }],
    narrativeSummaries: [],
    pendingWritebacks: [],
    updatedAt: 2,
  })
  const emptyWorkspaceSnapshot = deepFreeze({
    schema: 'islemind.tavern-snapshot.v1',
    characters: [],
    lorebook: [],
    relationshipMemories: [],
    scenes: [],
    narrativeSummaries: [],
    pendingWritebacks: [],
    updatedAt: 2,
  })
  const scope = (scopeId, snapshot = workspaceSnapshot) => ({
    schema: 'islemind.tavern-workspace-scope.v1',
    scopeId,
    revision: 3,
    snapshot,
    updatedAt: 2,
  })
  const repository = ({
    scopes = [scope('workspace-one')],
    activeScopeLinks = { 'conversation-one': 'workspace-one' },
    revision = 7,
  } = {}) => deepFreeze({
    schema: 'islemind.tavern-workspace-repository.v1',
    revision,
    scopes,
    activeScopeLinks,
    updatedAt: 2,
  })
  const repositorySnapshot = repository()
  let repositoryReads = 0
  let clockReads = 0
  let observedSignal
  const sourceRuntime = createConversationWorkspaceSourceRuntime({
    repositorySnapshot: {
      async load(options) {
        repositoryReads += 1
        observedSignal = options.signal
        return { ok: true, value: repositorySnapshot }
      },
    },
    now() {
      clockReads += 1
      return 1700
    },
  })
  const captureInput = deepFreeze({
    conversationId: 'conversation-one',
    assistantMessageId: 'assistant-one',
    latestUserInput: 'Continue from the counter.',
  })
  const controller = new AbortController()
  const sourceOutcome = await sourceRuntime.capture(captureInput, {
    signal: controller.signal,
  })
  assert.equal(sourceOutcome.status, 'ready')
  assert.equal(repositoryReads, 1, 'workspace handoff capture uses one authoritative repository read')
  assert.equal(clockReads, 1, 'workspace handoff capture freezes one occurrence time')
  assert.equal(observedSignal, controller.signal, 'workspace source preserves exact repository signal identity')
  assert.equal(sourceOutcome.context.scopeId, 'workspace-one')
  assert.equal(sourceOutcome.context.scene.id, 'scene-one')
  assert.deepEqual(sourceOutcome.writebackSource.selection.orderedCharacterIds, ['character-one'])
  assert.equal(sourceOutcome.writebackSource.workspace.repositoryAuthorityRevision, 7)
  assert.equal(sourceOutcome.writebackSource.selection.repositoryAuthorityRevision, 7)
  assert.equal(Object.isFrozen(sourceOutcome.context), true)
  assert.equal(Object.isFrozen(sourceOutcome.writebackSource.selection.orderedCharacterIds), true)
  assert.deepEqual(captureInput, {
    conversationId: 'conversation-one',
    assistantMessageId: 'assistant-one',
    latestUserInput: 'Continue from the counter.',
  }, 'workspace source leaves its frozen caller input unchanged')

  const handoffRuntime = createAssistantConversationWorkspaceWritebackHandoffRuntime({
    isValidWorkspaceContext: isValidConversationWorkspaceContext,
    idempotencyDigest: {
      async digestCanonicalPayload(payload) {
        return `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`
      },
    },
  })
  const captured = handoffRuntime.admitResolvedSource(captureInput, sourceOutcome)
  assert.equal(captured.status, 'ready')
  assert.equal(captured.workspaceContext, sourceOutcome.context, 'handoff admission preserves exact workspace context identity')
  const bound = await handoffRuntime.bindRun({
    assistantRunId: 'assistant-run:workspace-one',
    capture: captured.capture,
  }, { signal: controller.signal })
  const rebound = await handoffRuntime.bindRun({
    assistantRunId: 'assistant-run:workspace-one',
    capture: captured.capture,
  }, { signal: controller.signal })
  assert.equal(bound.status, 'ready')
  assert.equal(rebound.status, 'ready')
  assert.equal(bound.handoff.assistantRunId, 'assistant-run:workspace-one')
  assert.equal(bound.handoff.workspaceId, 'workspace-one')
  assert.equal(bound.handoff.repositoryAuthorityRevision, 7)
  assert.equal(bound.handoff.idempotencyKey, rebound.handoff.idempotencyKey)
  assert.equal(Object.isFrozen(bound.handoff), true)

  assert.deepEqual(
    handoffRuntime.admitResolvedSource(captureInput, Object.freeze({ status: 'none' })),
    { status: 'none' },
    'authoritative absence is a normal handoff admission outcome',
  )
  assert.deepEqual(
    handoffRuntime.admitResolvedSource(captureInput, Object.freeze({ status: 'cancelled' })),
    { status: 'cancelled' },
    'source cancellation remains typed through pure handoff admission',
  )
  assert.deepEqual(
    handoffRuntime.admitResolvedSource(
      captureInput,
      Object.freeze({ status: 'failed', code: 'repository_read_failed' }),
    ),
    { status: 'failed', code: 'repository_read_failed' },
    'source failure codes remain stable through pure handoff admission',
  )
  assert.deepEqual(
    handoffRuntime.admitResolvedSource(
      captureInput,
      Object.freeze({ ...sourceOutcome, extra: true }),
    ),
    { status: 'failed', code: 'invalid_resolved_source' },
    'handoff admission rejects extra resolved-source fields',
  )
  assert.deepEqual(
    handoffRuntime.admitResolvedSource(
      captureInput,
      Object.freeze({
        status: 'ready',
        context: sourceOutcome.context,
        writebackSource: Object.freeze({ ...sourceOutcome.writebackSource, extra: true }),
      }),
    ),
    { status: 'failed', code: 'invalid_writeback_source' },
    'handoff admission rejects extra evidence fields',
  )

  const foreignCapture = { ...captured.capture }
  assert.deepEqual(
    await handoffRuntime.bindRun({
      assistantRunId: 'assistant-run:workspace-one',
      capture: foreignCapture,
    }, { signal: controller.signal }),
    { status: 'failed', code: 'capture_not_issued' },
    'run binding rejects structurally copied captures that this runtime did not issue',
  )

  async function captureWith({
    snapshot = repositorySnapshot,
    result = { ok: true, value: snapshot },
    input = captureInput,
    now = () => 1800,
    controller = new AbortController(),
    load,
  } = {}) {
    let reads = 0
    let clocks = 0
    const runtime = createConversationWorkspaceSourceRuntime({
      repositorySnapshot: {
        async load(options) {
          reads += 1
          return load ? load(options) : result
        },
      },
      now() {
        clocks += 1
        return now()
      },
    })
    const outcome = await runtime.capture(input, { signal: controller.signal })
    return { outcome, reads, clocks }
  }

  const direct = await captureWith({
    snapshot: repository({
      scopes: [scope('conversation-one')],
      activeScopeLinks: {},
    }),
  })
  assert.equal(direct.outcome.status, 'ready', 'same-ID workspace association resolves without an explicit link')
  assert.equal(direct.outcome.context.scopeId, 'conversation-one')
  assert.equal(direct.reads, 1)

  const absent = await captureWith({
    snapshot: repository({ scopes: [scope('workspace-other')], activeScopeLinks: {} }),
  })
  assert.deepEqual(absent.outcome, { status: 'none' }, 'valid repository absence preserves ordinary Chat')
  assert.equal(absent.reads, 1)
  assert.equal(absent.clocks, 0, 'authoritative absence does not read the occurrence clock')

  const empty = await captureWith({
    snapshot: repository({
      scopes: [scope('conversation-one', emptyWorkspaceSnapshot)],
      activeScopeLinks: {},
    }),
  })
  assert.equal(empty.outcome.status, 'ready', 'an existing empty workspace remains associated')
  assert.deepEqual(empty.outcome.context.promptSections, [])
  assert.equal(empty.clocks, 1)

  const dangling = await captureWith({
    snapshot: repository({
      scopes: [scope('workspace-other')],
      activeScopeLinks: { 'conversation-one': 'missing-workspace' },
    }),
  })
  assert.deepEqual(
    dangling.outcome,
    { status: 'failed', code: 'invalid_repository_snapshot' },
    'an explicit dangling link fails closed',
  )

  const duplicateScopes = await captureWith({
    snapshot: repository({ scopes: [scope('conversation-one'), scope('conversation-one')] }),
  })
  assert.deepEqual(duplicateScopes.outcome, { status: 'failed', code: 'invalid_repository_snapshot' })

  const corruptScope = scope('conversation-one', {
    ...workspaceSnapshot,
    characters: [{ ...workspaceSnapshot.characters[0], name: ' Aria ' }],
  })
  const corrupt = await captureWith({
    snapshot: repository({ scopes: [corruptScope], activeScopeLinks: {} }),
  })
  assert.deepEqual(corrupt.outcome, { status: 'failed', code: 'invalid_repository_snapshot' })
  assert.deepEqual(
    (await captureWith({ result: { ok: true, value: {} } })).outcome,
    { status: 'failed', code: 'invalid_repository_snapshot' },
  )
  assert.deepEqual(
    (await captureWith({ result: {} })).outcome,
    { status: 'failed', code: 'invalid_repository_result' },
  )
  assert.deepEqual(
    (await captureWith({ result: { ok: false, error: { code: 'persistence_failed' } } })).outcome,
    { status: 'failed', code: 'repository_read_failed' },
  )
  assert.deepEqual(
    (await captureWith({ load() { throw new Error('read failed') } })).outcome,
    { status: 'failed', code: 'repository_read_failed' },
  )
  assert.deepEqual(
    (await captureWith({ now: () => Number.NaN })).outcome,
    { status: 'failed', code: 'invalid_clock' },
  )

  const preAborted = new AbortController()
  preAborted.abort('user_stopped')
  const beforeReadCancellation = await captureWith({ controller: preAborted })
  assert.deepEqual(beforeReadCancellation.outcome, { status: 'cancelled' })
  assert.equal(beforeReadCancellation.reads, 0, 'pre-cancelled source performs no repository read')
  assert.equal(beforeReadCancellation.clocks, 0)

  const duringRead = new AbortController()
  const readCancellation = await captureWith({
    controller: duringRead,
    load(options) {
      assert.equal(options.signal, duringRead.signal)
      duringRead.abort('user_stopped')
      return { ok: true, value: repositorySnapshot }
    },
  })
  assert.deepEqual(readCancellation.outcome, { status: 'cancelled' })
  assert.equal(readCancellation.reads, 1)
  assert.equal(readCancellation.clocks, 0)

  const afterCapture = new AbortController()
  const postCaptureCancellation = await captureWith({
    controller: afterCapture,
    now() {
      afterCapture.abort('user_stopped')
      return 1900
    },
  })
  assert.deepEqual(postCaptureCancellation.outcome, { status: 'cancelled' })
  assert.equal(postCaptureCancellation.reads, 1)
  assert.equal(postCaptureCancellation.clocks, 1)
}

async function run() {
  assert.equal(CONTEXT_RUNTIME_SCHEMA, 'islemind.context-runtime.v1', 'context runtime schema is versioned')

  const tavernContext = {
    mode: 'companion',
    isolated: true,
    shareWithChat: false,
    shareWithAgent: false,
    scopeId: 'tavern-profile-one',
    scene: { id: 'scene-one', title: 'Counter', location: 'Lantern Tavern', activeCharacterIds: ['char-one'], speakingOrder: ['char-one'], createdAt: 1, updatedAt: 2 },
    characters: [{ id: 'char-one', name: 'Aria', persona: 'Keeper', speechStyle: 'Warm', background: 'Tavern', constraints: [], tags: [], createdAt: 1, updatedAt: 2 }],
    lorebook: [{ id: 'lore-one', title: 'Lanterns', content: 'Blue lanterns store promises.', keywords: ['lantern'], priority: 90, enabled: true, createdAt: 1, updatedAt: 2 }],
    relationshipMemories: [{ id: 'memory-one', characterId: 'char-one', kind: 'trust', content: 'Ask before changing scenes.', weight: 1, userVisible: true, createdAt: 1, updatedAt: 2 }],
    narrativeSummaries: [{ id: 'summary-one', sceneId: 'scene-one', summary: 'A promise remains unresolved.', unresolvedThreads: [], promises: [], importantChanges: [], createdAt: 1, updatedAt: 2 }],
    promptSections: [
      'Scene: Counter\nLocation: Lantern Tavern',
      'Character: Aria\nPersona: Keeper',
      'Lorebook: Lanterns: Blue lanterns store promises.',
      'Relationship memory: [trust] Ask before changing scenes.',
      'Narrative continuity: A promise remains unresolved.',
    ],
    evidence: ['scene:scene-one', 'character:char-one', 'lore:lore-one', 'memory:memory-one', 'summary:summary-one'],
  }

  const runtime = buildChatContextRuntime({
    retrievedContext: { sources: [], prompt: '' },
    tavernContext,
  })
  assert.equal(runtime.schema, CONTEXT_RUNTIME_SCHEMA, 'runtime carries schema')
  assert.equal(fs.existsSync(path.join(root, 'src/services/contextRuntime.ts')), false, 'legacy context runtime stays deleted')
  assertHas(readSource('src/modules/assistant-runtime/contextContributionPolicy.ts'), 'createContextContributionAssembler', 'assistant runtime owns generic context contribution assembly')
  assert.equal(runtime.counts.tavern, 1, 'runtime counts included Tavern context')
  assert.equal(runtime.trace.tavernContextIncluded, true, 'runtime trace records Tavern inclusion')
  assert.equal(runtime.trace.tavernEvidenceCount, 5, 'runtime trace records Tavern evidence count')
  assert.equal(runtime.trace.tavernScopeId, 'tavern-profile-one', 'runtime trace records active Tavern scope id')

  const tavernEnvelope = runtime.envelopes.find((envelope) => envelope.id === 'tavern-context')
  assert.ok(tavernEnvelope, 'Tavern envelope exists')
  assert.equal(tavernEnvelope.lane, 'tavern', 'Tavern envelope uses a dedicated lane')
  assert.equal(tavernEnvelope.authority, 'local-state', 'Tavern envelope authority is local state')
  assert.equal(tavernEnvelope.evidence.tavernCharacterCount, 1, 'Tavern envelope records character count')
  assert.equal(tavernEnvelope.evidence.tavernScopeId, 'tavern-profile-one', 'Tavern envelope records active scope id')
  assert.equal(tavernEnvelope.evidence.tavernEvidenceCount, 5, 'Tavern envelope records evidence count')
  assert.ok(tavernEnvelope.text.includes('Active Chat workspace context'), 'compatibility envelope identifies active Chat workspace context')
  assert.ok(tavernEnvelope.text.includes('only for the current conversation'), 'workspace prompt keeps local context conversation-scoped')
  assert.ok(tavernEnvelope.text.includes('parseable labels in the conversation language or English'), 'Tavern runtime envelope accepts localized review-ready labels')
  assert.ok(tavernEnvelope.text.includes('New scene/新场景/新場景/新しい場面'), 'Tavern runtime envelope includes review-ready new-scene labels')
  assert.ok(tavernEnvelope.text.includes('Branch from/分支自/分岐元'), 'Tavern runtime envelope includes review-ready branch source labels')
  assert.ok(tavernEnvelope.text.includes('Emotional tone/情绪基调/感情のトーン') || tavernEnvelope.text.includes('Emotional tone/情绪基调/感情のトーン/情緒基調') || tavernEnvelope.text.includes('Emotional tone/情绪基调/情緒基調/感情のトーン'), 'Tavern runtime envelope includes emotional-tone labels for stable character output')
  assert.ok(tavernEnvelope.text.includes('Phrases/措辞/言葉選び'), 'Tavern runtime envelope includes wording labels for stable character phrasing')
  assert.ok(tavernEnvelope.text.includes('关系信号'), 'Tavern runtime envelope includes Chinese relationship signal labels for reviewable memory')
  assert.ok(tavernEnvelope.text.includes('関係の手がかり'), 'Tavern runtime envelope includes Japanese relationship signal labels for reviewable memory')
  assert.ok(tavernEnvelope.text.includes('Relationship signal'), 'Tavern runtime envelope includes relationship signal labels for reviewable memory')

  const tavernPlannerSource = runtime.contextSources.find((source) => source.id === 'tavern-context')
  assert.ok(tavernPlannerSource, 'Tavern context is visible to the context planner')
  assert.equal(tavernPlannerSource.type, 'memory', 'Tavern context uses the local memory planner lane')
  assert.equal(tavernPlannerSource.trace.contextRuntime.authority, 'local-state', 'Tavern planner source carries local-state authority')
  assert.equal(tavernPlannerSource.trace.scopeId, 'tavern-profile-one', 'Tavern planner source carries active scope id')

  await testChatWorkspaceWritebackRuntime()
  await testConversationWorkspaceWritebackHandoffCapture()

  const assistantReplyStartSource = readSource('src/modules/assistant-runtime/application/assistantConversationReplyStartRuntime.ts')
  const legacyChatRunnerPath = path.join(root, 'src/services/chatRunner.ts')
  const contextAcquisitionSource = readSource('src/modules/assistant-runtime/application/assistantConversationContextAcquisitionRuntime.ts')
  const contextAcquisitionBootstrapSource = readSource('src/bootstrap/conversationAssistantContextAcquisitionRuntime.ts')
  const legacyWorkspaceSourcePath = path.join(root, 'src/modules/workspaces/application/tavernConversationWorkspaceSourceRuntime.ts')
  const tavernTurnRuntimePath = path.join(root, 'src/modules/workspaces/application/tavernConversationTurnRuntime.ts')
  const tavernTurnProjectionPath = path.join(root, 'src/modules/workspaces/application/tavernConversationTurnProjectionRuntime.ts')
  const tavernTurnBootstrapPath = path.join(root, 'src/bootstrap/tavernConversationTurnRuntime.ts')
  const finalizationSource = readSource('src/modules/assistant-runtime/application/assistantConversationFinalizationRuntime.ts')
  const streamLifecycleSource = readSource('src/modules/assistant-runtime/application/assistantConversationStreamLifecycleRuntime.ts')
  const finalizationBootstrapSource = readSource('src/bootstrap/conversationAssistantFinalizationRuntime.ts')
  const workspaceEntrySource = readSource('src/modules/workspaces/index.ts')
  const conversationReplyDispatchSource = readSource('src/presentation/features/conversations/conversationReplyDispatchController.ts')
  const conversationReplyStartSource = readSource('src/bootstrap/conversationReplyStart.ts')
  assert.match(contextAcquisitionBootstrapSource, /import type \{[^}]*TavernContextPack[^}]*\} from '@\/modules\/workspaces'/, 'context acquisition composition consumes Tavern context through the workspace public API')
  assertNotHas(contextAcquisitionBootstrapSource, "from '@/bootstrap/tavernConversationTurnRuntime'", 'context acquisition no longer composes a second Tavern repository read')
  assert.equal(fs.existsSync(legacyChatRunnerPath), false, 'the deleted Chat reply-start facade cannot return')
  assert.doesNotMatch(assistantReplyStartSource, /@\/services\/tavern/, 'target reply startup does not use the retired Tavern context facade')
  assertNotHas(conversationReplyDispatchSource, 'productMode', 'post-user reply dispatch carries no historical mode authority')
  assertNotHas(contextAcquisitionSource, "input.productMode === 'companion'", 'Assistant Runtime workspace context is independent of historical product mode')
  assertNotHas(contextAcquisitionSource, 'resolveTavernContext', 'Assistant Runtime consumes the already-admitted workspace context without another read')
  assertNotHas(contextAcquisitionBootstrapSource, 'tavernConversationTurnProjectionRuntime.resolveContext', 'bootstrap cannot restore the old double-read context path')
  assert.equal(fs.existsSync(legacyWorkspaceSourcePath), false, 'the Tavern-named conversation workspace source cannot return')
  assert.equal(fs.existsSync(tavernTurnRuntimePath), false, 'the historical raw Tavern turn runtime cannot return')
  assert.equal(fs.existsSync(tavernTurnProjectionPath), false, 'the historical Tavern turn projection cannot return')
  assert.equal(fs.existsSync(tavernTurnBootstrapPath), false, 'the historical Tavern turn bootstrap cannot return')
  assert.ok(
    assistantReplyStartSource.indexOf('dependencies.workspaceSourceRuntime.resolve')
      < assistantReplyStartSource.indexOf('dependencies.plainChatHandoffRuntime.handoff'),
    'workspace association resolves before the plain Chat fast path',
  )
  assertHas(assistantReplyStartSource, 'signal: requestController.signal', 'target reply startup forwards the exact request cancellation signal')
  assertNotHas(assistantReplyStartSource, 'completeTavernContextOutcome', 'target reply startup does not own Tavern context trace projection')
  assertNotHas(assistantReplyStartSource, 'buildTavernContextTraceMetadata', 'target reply startup does not own Tavern context metadata projection')
  assertNotHas(assistantReplyStartSource, 'projectTavernTurnWriteback', 'target reply startup does not own Tavern writeback projection')
  assertNotHas(assistantReplyStartSource, "resolveConversationProductMode(input.conversation) !== 'companion'", 'Tavern writeback is not blocked by stale conversation-level mode')
  assertHas(finalizationSource, 'handoff: input.workspaceWritebackHandoff', 'target finalization invokes generic writeback through the exact durable handoff')
  assertNotHas(finalizationSource, 'writeBackLegacyWorkspaceReply', 'target finalization cannot restore the historical no-handoff fallback')
  assertNotHas(finalizationSource, 'workspaceContext', 'target finalization does not retain planning-only workspace context')
  assertHas(finalizationBootstrapSource, 'finalizeTavernChatWorkspaceWriteback(input)', 'bootstrap binds only the generic atomic workspace finalizer')
  assertNotHas(finalizationBootstrapSource, 'tavernConversationTurnProjectionRuntime', 'bootstrap cannot restore the historical Tavern projection')
  assertHas(workspaceEntrySource, "export * from './application/chatWorkspaceWritebackRuntime'", 'Workspaces publicly exports the generic Chat writeback contract')
  assertHas(workspaceEntrySource, "export * from './application/conversationWorkspaceSourceRuntime'", 'Workspaces publicly exports coherent Chat workspace source capture')
  assertNotHas(workspaceEntrySource, "export * from './application/tavernConversationWorkspaceSourceRuntime'", 'the Tavern-named source export stays removed')
  assert.ok(
    finalizationSource.indexOf('dependencies.commitSuccess') < finalizationSource.indexOf('await dependencies.finalizeWorkspaceWriteback'),
    'target finalization commits terminal success before awaiting generic workspace writeback',
  )
  assertHas(assistantReplyStartSource, 'dependencies.streamLifecycleRuntime.build', 'target reply startup delegates lifecycle construction through its Assistant Runtime port')
  assertNotHas(streamLifecycleSource, 'workspaceContext', 'Assistant Runtime lifecycle does not retain planning-only workspace context')
  assertHas(streamLifecycleSource, 'workspaceWritebackHandoff: input.workspaceWritebackHandoff', 'Assistant Runtime preserves only the durable workspace handoff through finalization lifecycle construction')
  assertHas(assistantReplyStartSource, 'workspaceContext,', 'target reply startup passes Chat workspace context into request planning')
  assertHas(assistantReplyStartSource, 'workspaceWritebackHandoff,', 'target reply startup passes only the durable handoff into lifecycle and dispatch')
  assertNotHas(assistantReplyStartSource, 'productMode', 'target reply startup carries no historical or redundant fixed-Chat mode attribution')
  const requestPlanningCall = assistantReplyStartSource.slice(
    assistantReplyStartSource.indexOf('dependencies.requestPlanningRuntime.plan({'),
    assistantReplyStartSource.indexOf("if (requestPlanningOutcome.kind === 'failed')"),
  )
  assertNotHas(requestPlanningCall, 'productMode', 'workspace request planning receives no historical mode discriminator')
  assertHas(conversationReplyStartSource, 'listConversationToolManifests()', 'bootstrap-composed workflow decision context always lists tools through intrinsic Chat admission')
  for (const locale of ['en', 'zh-CN', 'ja']) {
    const localeSource = readSource(`src/i18n/resources/${locale}.json`)
    assertNotHas(localeSource, '"tavernContextTitle"', `${locale} removes the obsolete Tavern context trace title`)
    assertNotHas(localeSource, '"tavernContextReady"', `${locale} removes the obsolete Tavern context ready copy`)
    assertNotHas(localeSource, '"tavernContextEmpty"', `${locale} removes the obsolete Tavern context empty copy`)
    assertNotHas(localeSource, '"tavernContextCancelled"', `${locale} removes the obsolete Tavern context cancellation copy`)
    assertNotHas(localeSource, '"tavernContextFailed"', `${locale} removes the obsolete Tavern context failure copy`)
    assertNotHas(localeSource, '"tavernWritebackTitle"', `${locale} removes the obsolete historical writeback title`)
    assertNotHas(localeSource, '"tavernWritebackCommitted"', `${locale} removes the obsolete historical writeback success copy`)
    assertNotHas(localeSource, '"tavernWritebackSkipped"', `${locale} removes the obsolete historical writeback skip copy`)
    assertNotHas(localeSource, '"tavernWritebackCancelled"', `${locale} removes the obsolete historical writeback cancellation copy`)
    assertNotHas(localeSource, '"tavernWritebackFailed"', `${locale} removes the obsolete historical writeback failure copy`)
  }

  const promptEngineeringSource = readSource('src/services/promptEngineering.ts')
  assertNotHas(promptEngineeringSource, 'ProductInteractionMode', 'system prompt construction has no Workspaces mode contract')
  assertNotHas(promptEngineeringSource, 'productMode', 'system prompt construction accepts no historical mode input')
  assertNotHas(promptEngineeringSource, 'Agent mode preset:', 'system prompt construction cannot restore an Agent preset')
  assertNotHas(promptEngineeringSource, 'Tavern mode preset:', 'system prompt construction cannot restore a Tavern preset')
  assertHas(promptEngineeringSource, 'input.expectedReplyFormat?.trim()', 'mode removal preserves explicit reply-format prompting')

  const chatWorkspaceSource = readSource('src/components/chat/ChatWorkspace.tsx')
  assertHas(chatWorkspaceSource, 'useChatSetupWorkspaceState({', 'ChatWorkspace delegates setup sends to its focused setup-state hook')
  assertHas(chatWorkspaceSource, '<ChatActiveWorkspace', 'ChatWorkspace delegates active conversation sends to the active workspace boundary')

  const chatSetupWorkspaceStateSource = readSource('src/components/chat/chatSetupWorkspaceState.ts')
  assertHas(chatSetupWorkspaceStateSource, 'content, attachments, requestedOutput: composerOutputMode', 'setup-state sends preserve requested-output intent')
  assertNotHas(chatSetupWorkspaceStateSource, 'requestedOutput: composerOutputMode, productMode', 'setup-state sends no historical mode authority')

  const chatActiveComposerDockStateSource = readSource('src/components/chat/chatActiveComposerDockState.ts')
  const chatActiveComposerDockSource = readSource('src/components/chat/ChatActiveComposerDock.tsx')
  const chatActiveWorkspaceComposerDockPropsSource = readSource('src/components/chat/chatActiveWorkspaceComposerDockProps.ts')
  assertHas(chatActiveComposerDockStateSource, 'useChatStreamingSubmitActions({', 'active composer delegates streaming sends to the streaming-submit action hook')
  assertHas(chatActiveComposerDockStateSource, 'requestedOutput: composerOutputMode,', 'active composer preserves requested-output intent')
  assertNotHas(chatActiveComposerDockStateSource, 'productMode', 'active composer state accepts or forwards no historical mode')
  assertNotHas(chatActiveComposerDockSource, 'productMode', 'active composer component accepts or forwards no historical mode')
  assertNotHas(chatActiveWorkspaceComposerDockPropsSource, 'productMode', 'active composer prop builder accepts or forwards no historical mode')
  assertHas(chatActiveComposerDockStateSource, 'sendMessage,', 'active composer passes the runtime sender to streaming-submit actions')

  const chatWorkflowRuntimeSource = readSource('src/modules/tasks/application/conversationChatWorkflowRuntimePolicy.ts')
  assertNotHas(chatWorkflowRuntimeSource, 'CONVERSATION_CHAT_WORKFLOW_EXECUTION_MODE', 'Chat workflow runtime carries no redundant fixed execution mode')
  assertNotHas(chatWorkflowRuntimeSource, 'ConversationChatWorkflowEntryMode', 'Chat workflow runtime exposes no execution-mode type')
  assertHas(chatWorkflowRuntimeSource, 'listConversationToolManifests()', 'the Chat workflow runtime lists dynamic tools through intrinsic Chat admission')
  assertNotHas(chatWorkflowRuntimeSource, 'input.mode', 'historical workflow metadata cannot select runtime mode')

  const typesSource = readSource('src/types/index.ts')
  assertNotHas(typesSource, 'ProductInteractionMode', 'the types facade does not restore a historical conversation mode contract')
  assertHas(typesSource, "Message,", 'types facade still re-exports the message contract')

  console.log('Tavern runtime context tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
