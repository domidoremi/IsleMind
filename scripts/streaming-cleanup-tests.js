const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load

const persistedSnapshots = []
const committedContent = []
const committedTraces = []
const flushedMessages = []

registerTypeScriptSupport()

const {
  abortAllStreams,
  abortStream,
  listStreamCleanupTasks,
  registerStreamCleanupTask,
  registerStreamAborter,
  setActiveStream,
} = require('../src/services/chatStreamLifecycle.ts')
const {
  MEDIA_GENERATION_STREAM_CLEANUP_SCOPE,
  buildMediaGenerationCancellationCleanupContract,
} = require('../src/services/mediaGenerationContract.ts')
const { useChatStreamingStore } = require('../src/store/chatStreamingStore.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isStreamingCleanupHook) return

  Module._load = function loadWithRuntimeStubs(request, parent, isMain) {
    if (request === 'zustand') {
      return {
        create: (initializer) => {
          let state
          const set = (updater) => {
            const patch = typeof updater === 'function' ? updater(state) : updater
            state = patch === state ? state : { ...state, ...patch }
          }
          const get = () => state
          state = initializer(set, get)
          const store = (selector) => selector(state)
          store.getState = get
          store.setState = (patch) => set(patch)
          return store
        },
      }
    }
    if (request === './chatStore' && parent?.filename?.endsWith(path.join('src', 'store', 'chatStreamingStore.ts'))) {
      return {
        useChatStore: {
          getState: () => ({
            conversations: [],
            persistStreamingContentSnapshot: (convId, msgId, text) => persistedSnapshots.push({ convId, msgId, text }),
            commitStreamingContent: (convId, msgId, text) => committedContent.push({ convId, msgId, text }),
            commitStreamingTraceSnapshot: (convId, msgId, traces) => committedTraces.push({ convId, msgId, traces }),
            flushStreamingMessage: async (convId, msgId) => flushedMessages.push({ convId, msgId }),
          }),
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }

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
  hook.isStreamingCleanupHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function trace(id) {
  return {
    id,
    type: 'tool',
    title: id,
    content: id,
    status: 'running',
    startedAt: 1,
  }
}

function key(convId, msgId) {
  return `${convId}:${msgId}`
}

function run() {
  const store = useChatStreamingStore.getState()
  const chatController = new AbortController()
  const agentController = new AbortController()
  store.setStreaming('chat-conv', 'chat-msg')
  store.appendContent('chat-conv', 'chat-msg', 'chat text')
  store.upsertTrace('chat-conv', 'chat-msg', trace('chat-trace'))
  setActiveStream('chat-conv', { controller: chatController, messageId: 'chat-msg' })
  store.setStreaming('agent-conv', 'agent-msg')
  store.appendContent('agent-conv', 'agent-msg', 'agent text')
  store.upsertTrace('agent-conv', 'agent-msg', trace('agent-trace'))
  setActiveStream('agent-conv', { controller: agentController, messageId: 'agent-msg' })

  const mediaGenerationCancellationContract = buildMediaGenerationCancellationCleanupContract()
  const mediaGenerationCancelled = []
  const mediaGenerationPartialArtifactsCleaned = []
  assert.throws(
    () => registerStreamCleanupTask({
      id: 'unsafe-media-generation-request',
      conversationId: 'agent-conv',
      messageId: 'agent-msg',
      scope: MEDIA_GENERATION_STREAM_CLEANUP_SCOPE,
      abortControllerLinked: false,
      cancel: () => mediaGenerationCancelled.push('unsafe-media-generation-request'),
      cleanupPartialArtifact: () => mediaGenerationPartialArtifactsCleaned.push('unsafe-media-generation-request'),
    }),
    /media_generation_cleanup_requires_abort_controller/,
    'future generated media cleanup task requires AbortController linkage',
  )
  registerStreamCleanupTask({
    id: 'future-media-generation-request',
    conversationId: 'agent-conv',
    messageId: 'agent-msg',
    scope: MEDIA_GENERATION_STREAM_CLEANUP_SCOPE,
    abortControllerLinked: mediaGenerationCancellationContract.abortControllerRequired,
    cancel: () => mediaGenerationCancelled.push('future-media-generation-request'),
    cleanupPartialArtifact: () => mediaGenerationPartialArtifactsCleaned.push('future-media-generation-request'),
  })

  assert.equal(useChatStreamingStore.getState().activeStreams.size, 2, 'test starts with two independent mode streams')
  assert.equal(useChatStreamingStore.getState().persistTimers.size, 2, 'streaming snapshots have pending timers')
  assert.equal(listStreamCleanupTasks(MEDIA_GENERATION_STREAM_CLEANUP_SCOPE).length, 1, 'future generated media cleanup task is registered under the media-generation scope')

  const aborted = []
  registerStreamAborter((conversationId) => aborted.push(conversationId))
  abortStream('chat-conv')

  const afterAbort = useChatStreamingStore.getState()
  assert.deepEqual(aborted, ['chat-conv'], 'abort callback is still invoked')
  assert.equal(chatController.signal.aborted, true, 'aborted conversation controller is aborted')
  assert.equal(agentController.signal.aborted, false, 'parallel Agent controller is preserved')
  assert.equal(afterAbort.activeStreams.has(key('chat-conv', 'chat-msg')), false, 'aborted conversation active state is removed')
  assert.equal(afterAbort.streamingText.has(key('chat-conv', 'chat-msg')), false, 'aborted conversation streaming text is removed')
  assert.equal(afterAbort.streamingTraces.has(key('chat-conv', 'chat-msg')), false, 'aborted conversation trace state is removed')
  assert.equal(afterAbort.persistTimers.has(key('chat-conv', 'chat-msg')), false, 'aborted conversation persist timer is removed')
  assert.equal(afterAbort.activeStreams.has(key('agent-conv', 'agent-msg')), true, 'parallel Agent stream is preserved')
  assert.equal(afterAbort.streamingText.get(key('agent-conv', 'agent-msg')), 'agent text', 'parallel Agent text is preserved')
  assert.deepEqual(mediaGenerationCancelled, [], 'unrelated chat abort does not cancel future generated media task')
  assert.deepEqual(mediaGenerationPartialArtifactsCleaned, [], 'unrelated chat abort does not clean future generated media partial artifacts')

  abortAllStreams()
  const afterClearAll = useChatStreamingStore.getState()
  assert.deepEqual(aborted, ['chat-conv', 'agent-conv'], 'abortAll only aborts the remaining active stream conversation')
  assert.equal(agentController.signal.aborted, true, 'abortAll aborts the remaining Agent controller')
  assert.equal(afterClearAll.activeStreams.size, 0, 'abortAll removes active streams')
  assert.equal(afterClearAll.streamingText.size, 0, 'abortAll removes streaming text')
  assert.equal(afterClearAll.streamingTraces.size, 0, 'abortAll removes traces')
  assert.equal(afterClearAll.persistTimers.size, 0, 'abortAll removes timers')
  assert.equal(persistedSnapshots.length, 0, 'cleared timers do not persist stale snapshots synchronously')
  assert.deepEqual(committedContent, [], 'cleanup does not commit stale text')
  assert.deepEqual(committedTraces, [], 'cleanup does not commit stale traces')
  assert.deepEqual(flushedMessages, [], 'cleanup does not flush deleted messages')
  assert.deepEqual(mediaGenerationCancelled, ['future-media-generation-request'], 'clearAll cancels future generated media task through the stream cleanup contract')
  assert.deepEqual(mediaGenerationPartialArtifactsCleaned, ['future-media-generation-request'], 'clearAll cleans partial generated media artifacts')
  assert.equal(listStreamCleanupTasks(MEDIA_GENERATION_STREAM_CLEANUP_SCOPE).length, 0, 'clearAll removes generated media cleanup tasks')

  const lifecycleSource = fs.readFileSync(path.join(root, 'src/services/chatStreamLifecycle.ts'), 'utf8')
  assert.ok(lifecycleSource.includes('registerStreamStateCleaner'), 'stream lifecycle has a registered streaming-state cleaner')
  assert.ok(lifecycleSource.includes('registerStreamCleanupTask'), 'stream lifecycle can register scoped task cleanup callbacks')
  assert.ok(lifecycleSource.includes('media_generation_cleanup_requires_abort_controller'), 'stream lifecycle blocks generated media cleanup without AbortController linkage')
  assert.ok(lifecycleSource.includes('cleanupPartialArtifact'), 'stream lifecycle can clean partial task artifacts on cancellation')
  assert.ok(lifecycleSource.includes('abortActiveController'), 'stream lifecycle aborts active controllers before clearing state')
  assert.ok(lifecycleSource.includes('clearStreamState(conversationId)'), 'abortStream clears conversation streaming state')
  assert.ok(lifecycleSource.includes('clearStreamCleanupTasks(conversationId)'), 'abortStream clears scoped task cleanup state')
  assert.ok(lifecycleSource.includes('clearAllStreamState()'), 'abortAllStreams clears all streaming state')
  assert.ok(lifecycleSource.includes('clearAllStreamCleanupTasks()'), 'abortAllStreams clears all scoped task cleanup state')

  const mediaGenerationSource = fs.readFileSync(path.join(root, 'src/services/mediaGenerationContract.ts'), 'utf8')
  const mediaGenerationCoreSource = fs.readFileSync(path.join(root, 'src/core/mediaGenerationContracts.ts'), 'utf8')
  assert.ok(mediaGenerationCoreSource.includes('MEDIA_GENERATION_CANCELLATION_CLEANUP_CONTRACT_SCHEMA'), 'media generation cancellation cleanup contract is schema-versioned')
  assert.ok(mediaGenerationCoreSource.includes('MEDIA_GENERATION_STREAM_CLEANUP_SCOPE'), 'core owns the media generation stream cleanup scope')
  assert.ok(mediaGenerationCoreSource.includes('cancellationGateId'), 'media generation cleanup contract links to the cancellation-semantics gate')
  assert.ok(mediaGenerationCoreSource.includes('executionDisabled: !MEDIA_GENERATION_ADAPTER_IMPLEMENTED'), 'media generation cleanup contract keeps execution disabled while the adapter flag is false')
  assert.ok(mediaGenerationSource.includes('buildMediaGenerationCancellationCleanupContract'), 'the service compatibility surface re-exports the cleanup contract')

  const chatStoreSource = fs.readFileSync(path.join(root, 'src/store/chatStore.ts'), 'utf8')
  assert.ok(
    /importData:\s*\(conversations:\s*Conversation\[\]\)\s*=>\s*\{\s*cancelAllConversationAssistantDetachedWork\(\)\s*abortAllStreams\(\)/.test(chatStoreSource),
    'data import cancels detached assistant work and stale streams before replacing conversations',
  )
  const streamingStoreSource = fs.readFileSync(path.join(root, 'src/store/chatStreamingStore.ts'), 'utf8')
  assert.ok(streamingStoreSource.includes('areStreamingTraceMetadataEquivalent'), 'streaming trace equality avoids JSON stringify on every trace update')
  assert.equal(streamingStoreSource.includes('JSON.stringify(current.metadata'), false, 'streaming trace equality does not stringify metadata during hot-path updates')

  const chatRunnerPath = path.join(root, 'src/services/chatRunner.ts')
  const assistantReplyStartRuntimeSource = fs.readFileSync(
    path.join(root, 'src/modules/assistant-runtime/application/assistantConversationReplyStartRuntime.ts'),
    'utf8',
  )
  const assistantFinalizationRuntimeSource = fs.readFileSync(
    path.join(root, 'src/modules/assistant-runtime/application/assistantConversationFinalizationRuntime.ts'),
    'utf8',
  )
  const assistantStreamLifecycleRuntimeSource = fs.readFileSync(
    path.join(root, 'src/modules/assistant-runtime/application/assistantConversationStreamLifecycleRuntime.ts'),
    'utf8',
  )
  assert.match(
    assistantStreamLifecycleRuntimeSource,
    /async complete\(result, lifecycle\) \{[\s\S]*?await dependencies\.finalize\(\{[\s\S]*?requestController: lifecycle\.requestController,[\s\S]*?chunkFlush: lifecycle\.flush,/,
    'Assistant Runtime forwards the exact provider-stream controller and flush lifecycle to finalization',
  )
  assert.match(assistantReplyStartRuntimeSource, /dependencies\.streamLifecycleRuntime\.build\(\{/, 'Assistant Runtime owns provider stream lifecycle construction in the reply-start sequence')
  assert.match(
    assistantFinalizationRuntimeSource,
    /function clearMatchingActiveStream\(conversationId: string, assistantMessageId: string\): void \{[\s\S]*?dependencies\.getActiveStream\(conversationId\)\?\.messageId === assistantMessageId[\s\S]*?dependencies\.clearActiveStream\(conversationId\)/,
    'assistant finalization clears only the still-matching active message stream',
  )
  const conversationReplyStartSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationReplyStart.ts'), 'utf8')
  assert.match(
    conversationReplyStartSource,
    /initializeConversationReplyStart\(\): void \{[^}]*?registerStreamAborter\(stopConversationMessage\)[^}]*?bindChatWorkspaceReviewRuntime\(chatWorkspaceReviewRuntimeResolver\)[^}]*?bindConversationMessageRuntime\(conversationMessageRuntime\)/,
    'bootstrap explicitly installs the presentation-owned stop command before reply bindings',
  )
  assert.match(
    conversationReplyStartSource,
    /const conversationMessageRuntime: ConversationMessageRuntime = \{\s*dispatchAfterUserProjection: conversationReplyDispatchController\.dispatch,\s*startAfterHistoryProjection: startConversationAssistantReplyAfterHistoryProjection,\s*startConfirmedWorkflowReply: startConversationChatWorkflowReply,[\s\S]*?async resumePendingModelOperation\(conversationId, assistantMessageId, runId, approved\)[\s\S]*?resumeVNextConversationModelOperation\(\{[\s\S]*?runId,[\s\S]*?approved,[\s\S]*?projection: createVNextPlainChatProjection\([\s\S]*?listConversationToolManifests,\s*resolveConversationTool,\s*saveApprovedWorkflowSkillSuggestion,\s*\}[\s\S]*?bindConversationMessageRuntime\(conversationMessageRuntime\)/,
    'bootstrap alone installs the combined dispatch, target reply-start, confirmed workflow, model-operation resume, catalog, and workflow-skill runtime',
  )
  assert.equal(fs.existsSync(chatRunnerPath), false, 'the fully migrated Chat facade cannot be restored')

  const conversationControlCommandSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationControlCommand.ts'), 'utf8')
  const textCommitIndex = conversationControlCommandSource.indexOf('streamingStore.commitStreamingText')
  const traceCommitIndex = conversationControlCommandSource.indexOf('streamingStore.commitStreamingTraces')
  assert.ok(textCommitIndex >= 0 && traceCommitIndex > textCommitIndex, 'conversation stop/recovery production wiring commits text before traces')

  console.log('Streaming cleanup tests passed')
}

if (require.main === module) run()

module.exports = { run }
