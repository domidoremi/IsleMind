const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function main() {
  const commandModule = await import('../src/presentation/features/conversations/conversationMessageController.ts')
  const messageActionModule = await import('../src/presentation/features/conversations/conversationMessageActionController.ts')
  const actionConfirmationModule = await import('../src/presentation/features/conversations/conversationActionConfirmationController.ts')
  const workflowSaveModule = await import('../src/presentation/features/conversations/conversationWorkflowSkillSaveController.ts')
  const controlModule = await import('../src/presentation/features/conversations/conversationControlController.ts')
  const runtimeBindingModule = await import('../src/presentation/features/conversations/conversationMessageRuntimeBinding.ts')
  const workspaceReviewCommandModule = await import('../src/presentation/features/conversations/chatWorkspaceReviewCommand.ts')
  const replyDispatchModule = await import('../src/presentation/features/conversations/conversationReplyDispatchController.ts')
  const workflowReplyStartModule = await import('../src/modules/conversations/application/conversationChatWorkflowReplyStart.ts')
  const assistantProjectionModule = await import('../src/modules/conversations/application/conversationAssistantMessageProjection.ts')
  const conversationTaskStateModule = await import('../src/components/chat/conversationTaskState.ts')
  const coreModule = await import('../src/core/index.ts')
  const assistantRuntimeModule = await import('../src/modules/assistant-runtime/index.ts')
  const runStoreModule = await import('../src/modules/assistant-runtime/testing/inMemoryRunStore.ts')
  const providerModule = await import('../src/modules/providers/index.ts')
  const tasksModule = await import('../src/modules/tasks/index.ts')

  testConversationAssistantMessageProjection(assistantProjectionModule)
  testChatWorkspaceReviewRuntimeBinding(workspaceReviewCommandModule)
  await testConversationMessageRuntimeBinding(runtimeBindingModule)
  await testConversationReplyDispatchController(replyDispatchModule)
  await testConversationChatWorkflowReplyStarter(workflowReplyStartModule)
  await testConversationChatWorkflowTaskCardCancellation({
    assistantRuntimeModule,
    conversationTaskStateModule,
    coreModule,
    providerModule,
    runStoreModule,
    tasksModule,
    workflowReplyStartModule,
  })
  await testTypedMessagesUseModelPath(commandModule)
  await testSettingsLikeTextUsesModelPath(commandModule)
  await testLegacyDelegation(commandModule)
  await testUserMessageDurabilityPrecedesDispatch(commandModule)
  await testRuntimeDelegationAwaitsAndPropagates(commandModule)
  await testProjectedConversationFailClosed(commandModule)
  await testAttachmentAndEmptyInputBoundaries(commandModule)
  await testFinalMessageClipboardAction(messageActionModule)
  await testConversationActionConfirmation(actionConfirmationModule)
  await testWorkflowSkillSaveAction(workflowSaveModule)
  testProductionMessageRuntimeBoundary()
  testStopFlushesBeforeTerminalProjectionAndKeepsConversationScope(controlModule)
  await testStaleRecoveryCommitsBuffersAndIsIdempotent(controlModule)
  await testRetryStopsBeforeTrimAndAwaitsReplyStart(controlModule)
  await testRegenerateStopsBeforeExactRemovalAndAwaitsReplyStart(controlModule)
  await testControlReplyStartFailuresPropagate(controlModule)

  console.log('vNext conversation message-command tests passed')
}

function testConversationAssistantMessageProjection(module) {
  assert.equal(fs.existsSync(path.join(root, 'src/services/chatRunner.ts')), false, 'legacy terminal projection cannot return through the deleted Chat facade')
  const estimationInputs = []
  const policy = module.createConversationAssistantMessageProjectionPolicy({
    buildEstimatedUsage(messages, outputText) {
      estimationInputs.push({ messages, outputText })
      return { inputTokens: messages.length * 10, outputTokens: outputText.length, totalTokens: messages.length * 10 + outputText.length, source: 'estimated' }
    },
    estimateTextTokens: (text) => text.length,
  })
  const citation = Object.freeze({ id: 'citation-1', type: 'web', title: 'Evidence' })
  const user = Object.freeze({ id: 'user', role: 'user', productMode: 'companion', content: 'hello', timestamp: 1, status: 'done' })
  const failed = Object.freeze({ id: 'failed', role: 'assistant', content: 'ignore', timestamp: 2, status: 'error' })
  const assistant = Object.freeze({ id: 'assistant', role: 'assistant', content: 'streamed', citations: Object.freeze([citation]), timestamp: 3, status: 'streaming', startedAt: 80 })
  const conversation = Object.freeze({ productMode: 'agent', messages: Object.freeze([user, failed, assistant]) })
  const before = JSON.stringify({ conversation, assistant })

  const providerPlan = policy.buildSuccessPlan({
    conversation,
    message: assistant,
    outputText: 'complete',
    citations: [],
    providerUsage: Object.freeze({ inputTokens: 7, outputTokens: 3, cachedInputTokens: 2, source: 'provider' }),
    providerId: 'provider',
    model: 'model',
    completedAt: 100,
  })
  assert.equal(providerPlan.kind, 'project')
  assert.deepEqual(providerPlan.messagePatch.usage, { inputTokens: 7, outputTokens: 3, cachedInputTokens: 2, source: 'provider', totalTokens: 10 })
  assert.deepEqual(providerPlan.messagePatch, {
    status: 'done', content: 'complete', responseText: 'complete', citations: [citation], completedAt: 100,
    durationMs: 20, usage: providerPlan.messagePatch.usage, estimatedTokens: false, tokenCount: 3,
  })
  assert.deepEqual(providerPlan.taskCompletion, { status: 'done', metadata: { providerId: 'provider', model: 'model', outputTokens: 3, totalTokens: 10 } })
  assert.equal(estimationInputs.length, 0, 'provider usage is retained without estimation')

  const estimatedPlan = policy.buildSuccessPlan({ conversation, message: assistant, outputText: 'answer', citations: [citation], providerId: 'provider', model: 'model', completedAt: 101 })
  assert.equal(estimatedPlan.kind, 'project')
  assert.deepEqual(estimationInputs[0].messages, [{ role: 'user', content: 'hello', attachments: undefined }], 'response and failed messages are excluded from estimation')
  assert.equal(estimatedPlan.messagePatch.estimatedTokens, true)
  assert.equal(estimatedPlan.messagePatch.tokenCount, 6)
  assert.notEqual(estimatedPlan.messagePatch.citations, estimatedPlan === null ? undefined : citation, 'projection owns a copied citation array')

  const failurePlan = policy.buildFailurePlan({
    conversation, message: assistant, content: 'explicit failure', errorCode: 'rate_limited', providerId: 'provider-error', completedAt: 110,
  })
  assert.equal(failurePlan.kind, 'project')
  assert.equal(failurePlan.messagePatch.content, 'explicit failure', 'explicit failure content wins over streamed content')
  assert.equal(failurePlan.messagePatch.responseText, 'explicit failure')
  assert.equal(failurePlan.messagePatch.errorCode, 'rate_limited')
  assert.equal(failurePlan.messagePatch.errorProviderId, 'provider-error')
  assert.equal(failurePlan.messagePatch.durationMs, 30)
  assert.deepEqual(failurePlan.taskCompletion, { status: 'failed', error: 'explicit failure', metadata: { errorCode: 'rate_limited', providerId: 'provider-error' } })
  assert.equal(failurePlan.error, 'explicit failure', 'terminal projection exposes one Chat error value')

  const streamedFallback = policy.buildFailurePlan({ conversation, message: assistant, content: '', errorCode: 'unknown', productMode: 'agent', completedAt: 111 })
  assert.equal(streamedFallback.kind, 'project')
  assert.equal(streamedFallback.messagePatch.content, 'streamed')
  assert.equal(streamedFallback.error, '', 'explicit historical mode cannot create a separate terminal error channel')
  assert.deepEqual(policy.buildSuccessPlan({ conversation, outputText: '', citations: [], providerId: 'p', model: 'm', completedAt: 1 }), { kind: 'skip', reason: 'message_missing' })
  assert.deepEqual(policy.buildSuccessPlan({ conversation, message: { ...assistant, status: 'cancelled' }, outputText: '', citations: [], providerId: 'p', model: 'm', completedAt: 1 }), { kind: 'skip', reason: 'message_cancelled' })
  assert.deepEqual(policy.buildSuccessPlan({ conversation, message: { ...assistant, status: 'done' }, outputText: '', citations: [], providerId: 'p', model: 'm', completedAt: 1 }), { kind: 'skip', reason: 'message_not_streaming' })
  const cancelledFailure = policy.buildFailurePlan({ conversation, message: { ...assistant, status: 'cancelled' }, content: '', errorCode: 'unknown', completedAt: 1 })
  assert.equal(cancelledFailure.kind, 'project', 'failure projection preserves the legacy terminal error path regardless of current message status')

  const executorEvents = []
  const executor = module.createConversationAssistantProjectionExecutor({
    flushActiveStream() { executorEvents.push('flush') },
    commitStreamingText() { executorEvents.push('commit-text') },
    commitStreamingTraces() { executorEvents.push('commit-traces') },
    updateMessage(patch) { executorEvents.push(`update:${patch.status}`) },
    clearStreaming() { executorEvents.push('clear') },
    finishTask(completion) { executorEvents.push(`finish:${completion.status}`) },
    reportError(error) { executorEvents.push(`error:${error}`) },
  })
  executor.commitSuccess(providerPlan)
  assert.deepEqual(executorEvents.splice(0), ['update:done', 'finish:done'], 'success updates the terminal message before finishing its task')
  const projectedFailure = executor.projectFailure(() => {
    executorEvents.push('build-plan')
    return failurePlan
  })
  assert.equal(projectedFailure, failurePlan, 'failure execution returns the exact immutable projection plan')
  assert.deepEqual(executorEvents, [
    'flush',
    'commit-text',
    'commit-traces',
    'build-plan',
    'update:error',
    'clear',
    'finish:failed',
    'error:explicit failure',
  ], 'failure settles streaming state before planning and applies terminal effects in compatibility order')
  assert.equal(JSON.stringify({ conversation, assistant }), before, 'success and failure planning do not mutate frozen inputs')
}

async function testConversationChatWorkflowReplyStarter(workflowReplyStartModule) {
  const createFixture = (resolution, config = {}) => {
    const events = []
    const messages = []
    const activeStreams = new Map()
    const finishedTasks = []
    const startedTasks = []
    const ordinaryStarts = []
    const cancelledRuns = []
    const cancellationBindings = []
    let cancellationReleases = 0
    const runtime = Object.freeze({
      workflowCheckpoints: Object.freeze({ id: 'checkpoint-store' }),
      async cancel(runId) {
        cancelledRuns.push(runId)
        return { ok: false, error: { code: 'run_not_active', message: 'already terminal' } }
      },
    })
    const controller = new AbortController()
    let runInput
    let resolutionInput
    let executionResult
    const conversation = Object.freeze({
      id: 'conversation-agent-reply',
      title: 'Agent reply',
      providerId: 'provider',
      model: 'model',
      createdAt: 1,
      updatedAt: 1,
      messages: Object.freeze([
        Object.freeze({ id: 'user-before', role: 'user', content: 'Earlier', timestamp: 1, status: 'sent' }),
        Object.freeze({ id: 'user-latest', role: 'user', content: 'Run it', timestamp: 2, status: 'sent' }),
      ]),
    })
    const dependencies = {
      clock: { now: () => 100 },
      createMessageId: () => 'assistant-agent',
      createTraceId: () => 'trace-agent',
      createAbortController: () => controller,
      stopConversation(conversationId) { events.push(`stop:${conversationId}`) },
      addMessage(_conversationId, message) { messages.push(message); events.push('add-message') },
      getConversation() { return { ...conversation, messages: [...conversation.messages, ...messages] } },
      getMessage(_conversationId, messageId) { return messages.find((message) => message.id === messageId) },
      updateMessage(_conversationId, messageId, updates) {
        Object.assign(messages.find((message) => message.id === messageId), updates)
        events.push(`update:${updates.status}`)
      },
      removeMessage(_conversationId, messageId) {
        const index = messages.findIndex((message) => message.id === messageId)
        if (index >= 0) messages.splice(index, 1)
        events.push('remove-message')
      },
      startConversationTaskActivity(input, now) {
        startedTasks.push(input)
        events.push(`task-start:${input.kind}:${input.metadata.requestedOutput}:${now}`)
      },
      bindConversationTaskCancellation(input) {
        cancellationBindings.push(input)
        events.push(`task-cancel-bind:${input.assistantRunId}`)
        return () => {
          cancellationReleases += 1
          events.push('task-cancel-release')
        }
      },
      finishConversationTaskActivity(_conversationId, _messageId, status, updates) {
        finishedTasks.push({ status, updates })
        events.push(`task-finish:${status}`)
      },
      getActiveStream: (conversationId) => activeStreams.get(conversationId),
      setActiveStream(conversationId, stream) { activeStreams.set(conversationId, stream); events.push(`stream-set:${Boolean(stream.done)}`) },
      clearActiveStream(conversationId) { activeStreams.delete(conversationId); events.push('stream-clear') },
      commitStreamingText() { events.push('commit-text') },
      commitStreamingTraces() { events.push('commit-traces') },
      clearStreaming() { events.push('streaming-clear') },
      readSettings: () => Object.freeze({}),
      resolveRunLimits: () => ({ maxSteps: 3 }),
      retrieveContext: async () => ({ text: 'context' }),
      createChatWorkflowRuntime: () => runtime,
      startChatWorkflowRun(input) {
        runInput = input
        events.push('chat-workflow-start')
        if (config.completionFailure) {
          return {
            runId: 'assistant-run-1',
            completion: Promise.resolve({ ok: false, error: { message: config.completionFailure } }),
          }
        }
        const completion = input.executor.execute({
          run: { id: 'assistant-run-1', kind: 'chat' },
          signal: input.controller.signal,
        }).then((result) => {
          executionResult = result
          return { ok: true, value: { id: 'assistant-run-1' } }
        })
        return { runId: 'assistant-run-1', completion }
      },
      async resolveChatWorkflowReply(input) { resolutionInput = input; events.push('resolve-workflow'); return resolution },
      async startOrdinaryReply(...args) {
        ordinaryStarts.push(args)
        events.push('ordinary-start')
        if (config.ordinaryFailure) throw new Error(config.ordinaryFailure)
      },
      classifyChatError: () => 'unknown',
      toUserFacingError: (message) => `visible:${message}`,
      sendFailedFallback: () => 'send failed',
      reportError(message) { events.push(`error:${message}`) },
      buildEstimatedUsage: () => ({ source: 'estimated' }),
      estimateTextTokens: () => 1,
    }
    return {
      activeStreams,
      cancellationBindings,
      cancelledRuns,
      controller,
      conversation,
      dependencies,
      events,
      finishedTasks,
      getCancellationReleases: () => cancellationReleases,
      getExecutionResult: () => executionResult,
      getResolutionInput: () => resolutionInput,
      getRunInput: () => runInput,
      messages,
      ordinaryStarts,
      runtime,
      startedTasks,
    }
  }

  const patch = Object.freeze({
    content: 'Agent completed.',
    responseText: 'Agent completed.',
    status: 'sent',
    completedAt: 120,
    durationMs: 20,
    reasoning: Object.freeze([]),
    retrievalTrace: Object.freeze([]),
    toolCalls: Object.freeze([]),
    usage: Object.freeze({ source: 'estimated' }),
    tokenCount: 3,
  })
  const success = createFixture(Object.freeze({
    handled: true,
    reply: Object.freeze({ content: 'Agent completed.', status: 'done', traces: Object.freeze([]), run: Object.freeze({ steps: Object.freeze([Object.freeze({ id: 'step-1' })]) }) }),
    patch,
  }))
  const options = Object.freeze({
    requestedOutput: 'work-artifact',
    manifests: Object.freeze([Object.freeze({ id: 'tool-1' })]),
    enabledWorkflowIds: Object.freeze(['workflow-1']),
    blockedWorkflowStates: Object.freeze([]),
    limits: Object.freeze({ maxSteps: 2 }),
  })
  const before = JSON.stringify({ conversation: success.conversation, options })
  const start = workflowReplyStartModule.createConversationChatWorkflowReplyStarter(success.dependencies)
  await start(success.conversation, 'Run it', options)
  assert.equal(success.getRunInput().runtime, success.runtime, 'workflow reply startup preserves the composed durable Chat runtime identity')
  assert.equal(success.getRunInput().controller, success.controller, 'workflow reply startup preserves the cancellation controller identity')
  assert.equal(success.getRunInput().requestMessageId, 'user-latest', 'workflow reply startup binds the latest projected user message')
  assert.equal(success.getResolutionInput().assistantRunId, 'assistant-run-1', 'the exact Chat run ID reaches workflow resolution')
  assert.equal(success.getResolutionInput().signal, success.controller.signal, 'the exact durable Chat-run cancellation signal reaches workflow resolution')
  assert.equal(success.getResolutionInput().workflowCheckpointStore, success.runtime.workflowCheckpoints, 'the exact workflow checkpoint store reaches Agent resolution')
  assert.equal(success.getResolutionInput().limits, options.limits, 'explicit run limits retain identity')
  assert.equal(success.messages[0].content, patch.content)
  assert.equal(success.messages[0].status, 'sent')
  assert.equal(success.startedTasks[0].kind, 'chat-workflow', 'new explicit Chat workflows use the Chat-neutral observational task kind')
  assert.equal('mode' in success.startedTasks[0], false, 'new Chat workflow activities carry no historical product-mode authority')
  assert.equal(success.cancellationBindings[0].conversationId, success.conversation.id, 'workflow task cancellation binds the exact conversation identity')
  assert.equal(success.cancellationBindings[0].messageId, 'assistant-agent', 'workflow task cancellation binds the exact assistant message identity')
  assert.equal(success.cancellationBindings[0].assistantRunId, 'assistant-run-1', 'workflow task cancellation binds the exact durable Chat run identity')
  assert.equal(success.getCancellationReleases(), 1, 'workflow task cancellation authority is released after durable completion')
  assert.equal(success.finishedTasks[0].status, 'done')
  assert.deepEqual(success.getExecutionResult(), { outputText: 'Agent completed.', eventCount: 1 })
  assert.equal(success.activeStreams.size, 0, 'the matching active stream is cleared after durable completion')
  assert.equal(JSON.stringify({ conversation: success.conversation, options }), before, 'Chat workflow reply startup does not mutate frozen caller inputs')
  assert.deepEqual(success.events.slice(0, 4), [
    'stop:conversation-agent-reply',
    'add-message',
    'task-start:chat-workflow:work-artifact:100',
    'stream-set:false',
  ])

  const handledFailure = createFixture(Object.freeze({
    handled: true,
    reply: Object.freeze({ content: 'Agent failed.', status: 'error', failureCode: 'tool_failed', traces: Object.freeze([]), run: Object.freeze({ steps: Object.freeze([]) }) }),
    patch: Object.freeze({ ...patch, content: 'Agent failed.', responseText: 'Agent failed.', status: 'error' }),
  }))
  await workflowReplyStartModule.createConversationChatWorkflowReplyStarter(handledFailure.dependencies)(handledFailure.conversation, 'Fail visibly')
  assert.equal(handledFailure.finishedTasks[0].status, 'failed')
  assert.equal(handledFailure.finishedTasks[0].updates.error, 'Agent failed.')
  assert.deepEqual(handledFailure.getExecutionResult(), {
    outputText: 'Agent failed.',
    eventCount: 0,
    outcome: 'failed',
    failureMessage: 'Chat workflow failed: tool_failed.',
  })

  const durableFailure = createFixture(undefined, { completionFailure: 'durable runtime failed' })
  await workflowReplyStartModule.createConversationChatWorkflowReplyStarter(durableFailure.dependencies)(durableFailure.conversation, 'Fail durably')
  assert.equal(durableFailure.messages[0].status, 'error')
  assert.equal(durableFailure.messages[0].content, 'visible:durable runtime failed')
  assert.equal(durableFailure.finishedTasks[0].status, 'failed')
  assert.ok(durableFailure.events.indexOf('commit-text') < durableFailure.events.indexOf('commit-traces'))
  assert.ok(durableFailure.events.includes('error:visible:durable runtime failed'))

  const fallback = createFixture(Object.freeze({
    handled: false,
    reply: Object.freeze({ content: '', status: 'skipped', traces: Object.freeze([]) }),
  }), { ordinaryFailure: 'ordinary fallback failed' })
  await workflowReplyStartModule.createConversationChatWorkflowReplyStarter(fallback.dependencies)(fallback.conversation, 'Continue')
  await Promise.resolve()
  assert.equal(fallback.messages.length, 0, 'ordinary-Chat fallback removes the provisional workflow message')
  assert.equal(fallback.finishedTasks[0].status, 'cancelled')
  assert.equal(fallback.finishedTasks[0].updates.metadata.reason, 'delegated_to_chat_reply')
  assert.deepEqual(fallback.ordinaryStarts, [[fallback.conversation.id]], 'structured fallback starts ordinary Chat with conversation identity only')
  assert.deepEqual(fallback.getExecutionResult(), { outputText: '', eventCount: 0 })
  assert.ok(fallback.events.indexOf('stream-clear') < fallback.events.indexOf('task-finish:cancelled'))
  assert.ok(fallback.events.indexOf('task-finish:cancelled') < fallback.events.indexOf('remove-message'))
  assert.ok(fallback.events.indexOf('remove-message') < fallback.events.indexOf('ordinary-start'))
  assert.ok(fallback.events.includes('error:ordinary fallback failed'))
}

async function testConversationChatWorkflowTaskCardCancellation(input) {
  input.tasksModule.clearConversationTaskActivitiesForTest()
  let now = Date.now()
  let idSequence = 0
  const clock = { now: () => ++now }
  const ids = { next: (prefix) => `${prefix}-task-card-${++idSequence}` }
  const runStore = input.runStoreModule.createInMemoryRunStore()
  const assistantRuntime = input.assistantRuntimeModule.createAssistantRuntime({
    clock,
    ids,
    providerGateway: input.providerModule.createProviderGateway([]),
    persistence: runStore,
  })
  const durableRuntime = input.assistantRuntimeModule.createAssistantChatWorkflowRunRuntime({
    ids,
    assistantRuntime,
    contextAssembly: {
      async assemble(contextInput) {
        return input.coreModule.ok({
          snapshot: {
            schema: 'islemind.context-snapshot.v1',
            id: input.coreModule.asContextSnapshotId('context-task-card-cancellation'),
            createdAt: clock.now(),
            conversationMessageIds: [...contextInput.conversationMessageIds],
            memoryIds: [],
            knowledgeSourceIds: [],
            attachmentIds: [],
            approvedToolContextIds: [],
          },
        })
      },
    },
  })

  const cancellationRunIds = []
  const workflowRuntime = {
    workflowCheckpoints: Object.freeze({ id: 'task-card-checkpoint-store' }),
    start: (startInput) => durableRuntime.start(startInput),
    async cancel(runId) {
      cancellationRunIds.push(runId)
      return durableRuntime.cancel(runId)
    },
  }
  const requestController = new AbortController()
  const activeStreams = new Map()
  const messages = []
  let cancellationReleaseCount = 0
  let handle
  let observedExecutorSignal
  let resolveBindingReady
  let resolveExecutorStarted
  const bindingReady = new Promise((resolve) => { resolveBindingReady = resolve })
  const executorStarted = new Promise((resolve) => { resolveExecutorStarted = resolve })
  const conversation = Object.freeze({
    id: 'conversation-task-card-cancellation',
    title: 'Task card cancellation',
    providerId: 'provider',
    model: 'model',
    createdAt: 1,
    updatedAt: 1,
    messages: Object.freeze([
      Object.freeze({
        id: 'user-task-card-cancellation',
        role: 'user',
        content: 'Run until cancelled.',
        timestamp: 1,
        status: 'sent',
      }),
    ]),
  })
  const dependencies = {
    clock,
    createMessageId: () => 'assistant-task-card-cancellation',
    createTraceId: () => 'trace-task-card-cancellation',
    createAbortController: () => requestController,
    stopConversation() {},
    addMessage(_conversationId, message) { messages.push(message) },
    getConversation() {
      return { ...conversation, messages: [...conversation.messages, ...messages] }
    },
    getMessage(_conversationId, messageId) {
      return messages.find((message) => message.id === messageId)
    },
    updateMessage(_conversationId, messageId, updates) {
      Object.assign(messages.find((message) => message.id === messageId), updates)
    },
    removeMessage(_conversationId, messageId) {
      const index = messages.findIndex((message) => message.id === messageId)
      if (index >= 0) messages.splice(index, 1)
    },
    startConversationTaskActivity(activityInput, startedAt) {
      input.tasksModule.startConversationTaskActivity(activityInput, startedAt)
    },
    bindConversationTaskCancellation(bindingInput) {
      const release = input.tasksModule.bindConversationTaskActivityCancellation(bindingInput)
      resolveBindingReady()
      return () => {
        cancellationReleaseCount += 1
        release()
      }
    },
    finishConversationTaskActivity(conversationId, messageId, status, updates) {
      input.tasksModule.finishConversationTaskActivityForMessage(
        conversationId,
        messageId,
        status,
        updates,
        clock.now(),
      )
    },
    getActiveStream: (conversationId) => activeStreams.get(conversationId),
    setActiveStream(conversationId, stream) { activeStreams.set(conversationId, stream) },
    clearActiveStream(conversationId) { activeStreams.delete(conversationId) },
    commitStreamingText() {},
    commitStreamingTraces() {},
    clearStreaming() {},
    readSettings: () => Object.freeze({}),
    resolveRunLimits: () => ({ maxSteps: 3 }),
    retrieveContext: async () => ({ text: 'context' }),
    createChatWorkflowRuntime: () => workflowRuntime,
    startChatWorkflowRun({ runtime, controller, ...startInput }) {
      handle = runtime.start({
        ...startInput,
        cancellationSignal: controller.signal,
      })
      return handle
    },
    async resolveChatWorkflowReply(resolutionInput) {
      observedExecutorSignal = resolutionInput.signal
      resolveExecutorStarted()
      await new Promise((resolve) => {
        if (resolutionInput.signal.aborted) {
          resolve()
          return
        }
        resolutionInput.signal.addEventListener('abort', resolve, { once: true })
      })
      return {
        handled: true,
        reply: {
          content: '',
          status: 'cancelled',
          traces: [],
          run: { steps: [] },
        },
        patch: {
          content: '',
          responseText: '',
          status: 'cancelled',
          completedAt: clock.now(),
          durationMs: 0,
          reasoning: [],
          retrievalTrace: [],
          toolCalls: [],
          usage: { source: 'estimated' },
          tokenCount: 0,
        },
      }
    },
    async startOrdinaryReply() {
      throw new Error('Cancellation must not delegate to an ordinary reply.')
    },
    classifyChatError: () => 'unknown',
    toUserFacingError: (message) => message,
    sendFailedFallback: () => 'send failed',
    reportError(message) { throw new Error(`Unexpected workflow error: ${message}`) },
    buildEstimatedUsage: () => ({ source: 'estimated' }),
    estimateTextTokens: () => 0,
  }

  try {
    const start = input.workflowReplyStartModule.createConversationChatWorkflowReplyStarter(dependencies)
    const started = start(conversation, 'Run until cancelled.')
    await withTimeout(
      Promise.all([bindingReady, executorStarted]),
      2_000,
      'The live workflow did not reach task cancellation binding and executor admission.',
    )

    const activity = input.tasksModule.listConversationTaskActivities().find(
      (candidate) => candidate.messageId === 'assistant-task-card-cancellation',
    )
    assert.ok(activity, 'the live workflow publishes one exact task-card activity')
    assert.ok(handle, 'the live workflow exposes its durable AssistantRun handle')

    const mismatched = await input.tasksModule.requestConversationTaskActivityCancellation({
      activityId: activity.id,
      conversationId: 'another-conversation',
      messageId: activity.messageId,
    })
    assert.equal(mismatched.status, 'unavailable', 'a mismatched conversation cannot reach durable cancellation authority')
    assert.deepEqual(cancellationRunIds, [], 'identity rejection happens before AssistantRuntime cancellation')

    const nonStreamingConversation = {
      ...conversation,
      messages: [
        ...conversation.messages,
        { ...messages[0], status: 'sent' },
      ],
    }
    let streamStopCalls = 0
    const cancellation = await withTimeout(
      input.conversationTaskStateModule.cancelConversationTask({
        conversation: nonStreamingConversation,
        stopStreaming() { streamStopCalls += 1 },
        task: activity,
      }),
      2_000,
      'Task-card cancellation did not reach a durable terminal result.',
    )
    const [completion] = await withTimeout(
      Promise.all([handle.completion, started]),
      2_000,
      'The cancelled workflow did not finish and release its task binding.',
    )

    assert.equal(cancellation, 'durable-cancelled', 'a non-streaming task card reports durable cancellation')
    assert.equal(streamStopCalls, 0, 'the non-streaming path does not use the stream-only stop shortcut')
    assert.deepEqual(cancellationRunIds, [handle.runId], 'the exact bound AssistantRun is cancelled once')
    assert.equal(requestController.signal.aborted, true, 'durable cancellation aborts the reply request controller')
    assert.equal(observedExecutorSignal.aborted, true, 'AssistantRuntime aborts the exact workflow executor signal')
    assert.equal(completion.ok, false, 'the workflow handle settles through the durable terminal path')
    if (completion.ok) throw new Error('Expected the workflow handle to settle as cancelled.')
    assert.equal(completion.error.code, 'cancelled')

    const durableRun = await runStore.get(handle.runId)
    assert.equal(durableRun?.status, 'cancelled', 'the exact AssistantRun persists a cancelled terminal state')
    assert.equal(durableRun?.conversationId, conversation.id)
    assert.equal(durableRun?.responseMessageId, activity.messageId)
    assert.deepEqual(
      (await runStore.list(handle.runId)).map((entry) => entry.type),
      ['run.created', 'run.started', 'run.cancellation-requested', 'run.cancelled'],
      'durable cancellation records request and terminal completion in order',
    )

    const terminalActivity = input.tasksModule.listConversationTaskActivities().find(
      (candidate) => candidate.id === activity.id,
    )
    assert.equal(terminalActivity?.status, 'cancelled', 'the task-card activity terminalizes after durable cancellation')
    assert.equal(typeof terminalActivity?.completedAt, 'number', 'the terminal activity retains a completion timestamp')
    assert.equal(cancellationReleaseCount, 1, 'the starter releases the exact run binding after terminal completion')
    const afterRelease = await input.tasksModule.requestConversationTaskActivityCancellation({
      activityId: activity.id,
      conversationId: activity.conversationId,
      messageId: activity.messageId,
    })
    assert.equal(afterRelease.status, 'unavailable', 'released terminal activity cannot retain cancellation authority')
  } finally {
    input.tasksModule.clearConversationTaskActivitiesForTest()
  }
}

async function testConversationReplyDispatchController(replyDispatchModule) {
  const conversation = {
    id: 'conversation-dispatch',
    title: 'Dispatch',
    providerId: 'provider',
    model: 'model',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }
  const settings = { agent: { maxSteps: 7 } }
  const manifests = [{ id: 'tool.read' }]
  const enabledWorkflowIds = ['workflow-1']
  const blockedWorkflowStates = [{ workflowId: 'workflow-2', reason: 'workflow-disabled' }]
  const limits = { maxSteps: 7 }
  const events = []
  const assistantStarts = []
  const agentStarts = []
  const errors = []
  let normalizeCalls = 0
  let releaseAgentStart
  const pendingAgentStart = new Promise((resolve) => { releaseAgentStart = resolve })

  const controller = replyDispatchModule.createConversationReplyDispatchController({
    normalizeContent(content) {
      normalizeCalls += 1
      events.push('normalize')
      return content.trim()
    },
    readSettings() {
      throw new Error('plain typed text must not read Settings before the model')
    },
    async resolveDecisionContext() {
      throw new Error('plain typed text must not resolve Agent workflows before the model')
    },
    resolveWorkflowRunLimits() {
      throw new Error('plain typed text must not resolve workflow limits before the model')
    },
    async startWorkflowReply() {
      throw new Error('plain typed text must not start Agent before the model')
    },
    async startAssistantReply(...args) {
      events.push('assistant:start')
      assistantStarts.push(args)
    },
    reportError(message) {
      errors.push(message)
    },
    sendFailedFallback() {
      return 'fallback'
    },
  })

  await controller.dispatch({
    conversation,
    content: '  rag  ',
    productMode: 'companion',
  })

  assert.equal(normalizeCalls, 1, 'post-user dispatch normalizes content exactly once')
  assert.deepEqual(events, ['normalize', 'assistant:start'], 'plain typed text starts Assistant Runtime without local routing')
  assert.deepEqual(assistantStarts, [[conversation.id]], 'a forged historical mode does not reach ordinary reply startup')
  assert.deepEqual(agentStarts, [], 'plain typed text does not start Agent')
  assert.deepEqual(errors, [], 'plain model-first startup does not report an error')

  const structuredController = replyDispatchModule.createConversationReplyDispatchController({
    normalizeContent: (content) => content.trim(),
    readSettings: () => settings,
    async resolveDecisionContext(...args) {
      const [receivedConversation, receivedSettings] = args
      assert.equal(receivedConversation, conversation)
      assert.equal(receivedSettings, settings)
      assert.equal(args.length, 2, 'workflow decision context receives no historical mode discriminator')
      return { manifests, enabledWorkflowIds, blockedWorkflowStates }
    },
    resolveWorkflowRunLimits: () => limits,
    startWorkflowReply(receivedConversation, content, options) {
      agentStarts.push({ conversation: receivedConversation, content, options })
      return pendingAgentStart
    },
    async startAssistantReply() {
      throw new Error('explicit structured work must not start an ordinary reply')
    },
    reportError(message) { errors.push(message) },
    sendFailedFallback: () => 'fallback',
  })
  await structuredController.dispatch({
    conversation,
    content: '  inspect context  ',
    workflowId: '  workflow-1  ',
    requestedOutput: 'work-artifact',
    productMode: 'companion',
  })

  assert.equal(agentStarts[0].conversation, conversation, 'Agent startup preserves conversation identity')
  assert.equal(agentStarts[0].content, 'inspect context', 'Agent startup receives normalized content')
  assert.deepEqual(agentStarts[0].options, {
    workflowId: 'workflow-1',
    requestedOutput: 'work-artifact',
    manifests,
    enabledWorkflowIds,
    blockedWorkflowStates,
    limits,
  }, 'structured startup preserves workflow context without a historical mode discriminator')
  assert.deepEqual(errors, [], 'a pending Agent start is fire-and-forget and does not report a premature error')
  releaseAgentStart()
  await pendingAgentStart

  const blankEvents = []
  const blankController = replyDispatchModule.createConversationReplyDispatchController({
    normalizeContent(content) { blankEvents.push('normalize'); return content.trim() },
    readSettings() { blankEvents.push('settings'); return settings },
    async resolveDecisionContext() { blankEvents.push('context'); return {} },
    resolveWorkflowRunLimits() { blankEvents.push('limits'); return limits },
    async startWorkflowReply() { blankEvents.push('workflow') },
    async startAssistantReply() { blankEvents.push('assistant') },
    reportError() { blankEvents.push('error') },
    sendFailedFallback() { blankEvents.push('fallback'); return 'fallback' },
  })
  await blankController.dispatch({ conversation, content: '   ' })
  assert.deepEqual(blankEvents, ['normalize'], 'blank post-user dispatch without attachments is a no-op after normalization')

  const ordinaryErrors = []
  let fallbackCalls = 0
  const ordinaryController = replyDispatchModule.createConversationReplyDispatchController({
    normalizeContent: (content) => content,
    readSettings: () => settings,
    async resolveDecisionContext() { return {} },
    resolveWorkflowRunLimits: () => limits,
    async startWorkflowReply() { throw new Error('Workflow must not start') },
    async startAssistantReply(...args) {
      assert.deepEqual(args, [conversation.id], 'ordinary startup carries only conversation identity')
      throw { rejected: true }
    },
    reportError(message) { ordinaryErrors.push(message) },
    sendFailedFallback() { fallbackCalls += 1; return 'localized fallback' },
  })
  await ordinaryController.dispatch({ conversation, content: 'hello' })
  await Promise.resolve()
  assert.deepEqual(ordinaryErrors, ['localized fallback'], 'ordinary startup reports unknown rejection through the single Chat error channel')
  assert.equal(fallbackCalls, 1, 'unknown startup rejection resolves the localized fallback lazily once')

  const agentErrors = []
  const agentFailure = new Error('agent startup failed')
  const failingAgentController = replyDispatchModule.createConversationReplyDispatchController({
    normalizeContent: (content) => content,
    readSettings: () => settings,
    async resolveDecisionContext() { return {} },
    resolveWorkflowRunLimits: () => limits,
    async startWorkflowReply() { throw agentFailure },
    async startAssistantReply() { throw new Error('Assistant must not start') },
    reportError(message) { agentErrors.push(message) },
    sendFailedFallback() { throw new Error('Error.message must bypass fallback') },
  })
  await failingAgentController.dispatch({ conversation, content: 'agent', workflowId: 'workflow-1', productMode: 'agent' })
  await Promise.resolve()
  assert.deepEqual(agentErrors, [agentFailure.message], 'structured startup reports the exact Error message through Chat')
}

async function testConversationActionConfirmation(actionConfirmationModule) {
  const makePendingAction = () => ({
    id: 'pending-confirm',
    reason: 'permission_required',
    title: 'Confirm tool',
    summary: 'Confirm exact tool invocation.',
    toolName: 'device_status',
    toolId: 'android.device_status',
    serverId: 'android',
    source: 'android',
    permission: 'read',
    confirmable: true,
    resumeToolRequest: {
      toolId: 'android.device_status',
      name: 'device_status',
      serverId: 'android',
      source: 'android',
      arguments: { serial: 'device-1', nested: { enabled: true } },
    },
    createdAt: 100,
  })
  const makeConversation = () => ({
    id: 'conversation-confirm',
    title: 'Confirmation',
    providerId: 'provider',
    model: 'model',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: 'user-confirm',
        role: 'user',
        content: 'Inspect my Android device.',
        productMode: 'companion',
        status: 'done',
        timestamp: 1,
      },
      {
        id: 'assistant-confirm',
        role: 'assistant',
        content: 'Confirmation required.',
        status: 'done',
        timestamp: 2,
        pendingAction: makePendingAction(),
      },
      {
        id: 'cancelled-tail',
        role: 'assistant',
        content: '',
        status: 'cancelled',
        timestamp: 3,
      },
    ],
  })

  function createConfirmationFixture(initialConversation, options = {}) {
    let conversation = initialConversation
    let manifestRelease
    let restartRelease
    const events = []
    const manifestCalls = []
    const resolvedActions = []
    const starts = []
    const manifestPromise = options.deferManifests
      ? new Promise((resolve) => { manifestRelease = resolve })
      : Promise.resolve([{ id: 'android.device_status' }])
    const restartPromise = options.deferRestart
      ? new Promise((resolve) => { restartRelease = resolve })
      : Promise.resolve()
    let conversationReadCount = 0

    const controller = actionConfirmationModule.createConversationActionConfirmationController({
      getConversation(conversationId) {
        conversationReadCount += 1
        events.push(`get:${conversationReadCount}`)
        return conversation?.id === conversationId ? conversation : undefined
      },
      getPendingAction(message) {
        return message.pendingAction
      },
      async listToolManifests(...args) {
        manifestCalls.push(args)
        events.push('list')
        return manifestPromise
      },
      resolveConfirmedTool({ pendingAction, manifests }) {
        events.push('resolve')
        resolvedActions.push({ pendingAction, manifests })
        return options.toolUnavailable ? undefined : manifests[0]
      },
      getRunLimits() {
        events.push('limits')
        return { maxSteps: 7 }
      },
      stopConversation(conversationId) {
        events.push(`stop:${conversationId}`)
      },
      removeMessage(conversationId, messageId) {
        events.push(`remove:${conversationId}:${messageId}`)
        if (options.removeConversation) {
          conversation = undefined
          return
        }
        if (conversation?.id === conversationId) {
          conversation = {
            ...conversation,
            messages: conversation.messages.filter((message) => message.id !== messageId),
          }
        }
      },
      async startWorkflowReply(nextConversation, content, restartOptions) {
        events.push('start')
        starts.push({ conversation: nextConversation, content, options: restartOptions })
        if (options.restartFailure) throw options.restartFailure
        await restartPromise
      },
    })

    return {
      controller,
      events,
      manifestCalls,
      resolvedActions,
      starts,
      getConversation: () => conversation,
      setConversation(next) {
        conversation = next
      },
      releaseManifests(manifests = [{ id: 'android.device_status' }]) {
        manifestRelease?.(manifests)
      },
      releaseRestart() {
        restartRelease?.()
      },
    }
  }

  const invalidCases = [
    ['missing conversation', undefined],
    ['missing message', { ...makeConversation(), messages: makeConversation().messages.filter((message) => message.id !== 'assistant-confirm') }],
    ['non-assistant', { ...makeConversation(), messages: makeConversation().messages.map((message) => message.id === 'assistant-confirm' ? { ...message, role: 'user' } : message) }],
    ['later non-cancelled message', { ...makeConversation(), messages: [...makeConversation().messages, { id: 'later', role: 'user', content: 'newer', status: 'done' }] }],
    ['non-confirmable action', { ...makeConversation(), messages: makeConversation().messages.map((message) => message.id === 'assistant-confirm' ? { ...message, pendingAction: { ...message.pendingAction, confirmable: false } } : message) }],
    ['missing request', { ...makeConversation(), messages: makeConversation().messages.map((message) => message.id === 'assistant-confirm' ? { ...message, pendingAction: { ...message.pendingAction, resumeToolRequest: undefined } } : message) }],
    ['missing previous user', { ...makeConversation(), messages: makeConversation().messages.filter((message) => message.role !== 'user') }],
  ]
  for (const [label, conversation] of invalidCases) {
    const fixture = createConfirmationFixture(conversation)
    assert.equal(await fixture.controller.confirm('conversation-confirm', 'assistant-confirm'), false, `${label} fails closed`)
    assert.equal(fixture.events.some((event) => event.startsWith('stop:') || event.startsWith('remove:') || event === 'start'), false, `${label} performs no destructive transition`)
    assert.equal(fixture.events.includes('list'), false, `${label} does not resolve tool manifests`)
  }

  const unavailableFixture = createConfirmationFixture(makeConversation(), { toolUnavailable: true })
  assert.equal(await unavailableFixture.controller.confirm('conversation-confirm', 'assistant-confirm'), false)
  assert.deepEqual(
    unavailableFixture.events,
    ['get:1', 'list', 'get:2', 'resolve'],
    'an unavailable current-registry tool fails before stop or removal',
  )
  assert.deepEqual(unavailableFixture.manifestCalls, [[]], 'confirmation discovers the current catalog once without a mode discriminator')

  const driftCases = [
    ['pending-action identity', (conversation) => { conversation.messages[1].pendingAction.id = 'replacement-action' }],
    ['tool identity', (conversation) => { conversation.messages[1].pendingAction.toolId = 'android.other' }],
    ['tool name', (conversation) => { conversation.messages[1].pendingAction.toolName = 'other_tool' }],
    ['tool source', (conversation) => { conversation.messages[1].pendingAction.source = 'builtin' }],
    ['tool permission', (conversation) => { conversation.messages[1].pendingAction.permission = 'write' }],
    ['confirmation eligibility', (conversation) => { conversation.messages[1].pendingAction.confirmable = false }],
    ['resume request identity', (conversation) => { conversation.messages[1].pendingAction.resumeToolRequest.name = 'other_tool' }],
    ['resume request arguments', (conversation) => { conversation.messages[1].pendingAction.resumeToolRequest.arguments.nested.enabled = false }],
    ['previous-user content', (conversation) => { conversation.messages[0].content = 'Changed request.' }],
    ['latest-message position', (conversation) => { conversation.messages.push({ id: 'new-latest', role: 'user', content: 'new turn', status: 'done' }) }],
  ]
  for (const [label, mutate] of driftCases) {
    const fixture = createConfirmationFixture(makeConversation(), { deferManifests: true })
    const pending = fixture.controller.confirm('conversation-confirm', 'assistant-confirm')
    const drifted = structuredClone(fixture.getConversation())
    mutate(drifted)
    fixture.setConversation(drifted)
    fixture.releaseManifests()
    assert.equal(await pending, false, `${label} drift during manifest discovery fails closed`)
    assert.deepEqual(fixture.manifestCalls, [[]], `${label} checks one mode-free catalog snapshot`)
    assert.equal(fixture.events.some((event) => event.startsWith('stop:') || event.startsWith('remove:') || event === 'start'), false, `${label} drift performs no destructive transition`)
  }

  const successFixture = createConfirmationFixture(makeConversation(), { deferRestart: true })
  let successSettled = false
  const successfulConfirmation = successFixture.controller
    .confirm('conversation-confirm', 'assistant-confirm')
    .then((result) => {
      successSettled = true
      return result
    })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(successSettled, false, 'confirmation does not report success before the durable Chat workflow restart settles')
  assert.deepEqual(
    successFixture.events,
    [
      'get:1',
      'list',
      'get:2',
      'resolve',
      'stop:conversation-confirm',
      'remove:conversation-confirm:assistant-confirm',
      'get:3',
      'limits',
      'start',
    ],
    'confirmation preserves re-read, stop, exact removal, next-conversation read, and restart order',
  )
  assert.equal(successFixture.resolvedActions.length, 1, 'the current action is validated once against the resolved manifest snapshot')
  assert.deepEqual(successFixture.manifestCalls, [[]], 'successful confirmation discovers one mode-free catalog snapshot')
  assert.equal(successFixture.starts.length, 1)
  assert.equal(successFixture.starts[0].content, 'Inspect my Android device.', 'the prior user content is preserved exactly')
  assert.deepEqual(successFixture.starts[0].options, {
    explicitToolRequest: makePendingAction().resumeToolRequest,
    limits: { maxSteps: 7 },
    userConfirmed: true,
  }, 'restart receives only the validated request, current limits, and explicit confirmation')
  successFixture.releaseRestart()
  assert.equal(await successfulConfirmation, true)

  const missingModeConversation = structuredClone(makeConversation())
  delete missingModeConversation.messages[0].productMode
  const missingModeFixture = createConfirmationFixture(missingModeConversation)
  assert.equal(await missingModeFixture.controller.confirm('conversation-confirm', 'assistant-confirm'), true)
  assert.deepEqual(missingModeFixture.manifestCalls, [[]], 'missing historical mode still uses parameterless catalog discovery')
  assert.equal(Object.hasOwn(missingModeFixture.starts[0].options, 'productMode'), false, 'missing historical mode cannot enter the confirmed restart contract')

  const disappearedFixture = createConfirmationFixture(makeConversation(), { removeConversation: true })
  assert.equal(await disappearedFixture.controller.confirm('conversation-confirm', 'assistant-confirm'), false, 'a conversation removed at the exact message-removal boundary cannot restart')
  assert.equal(disappearedFixture.starts.length, 0)

  const restartFailure = new Error('durable Chat workflow restart failed')
  const failingFixture = createConfirmationFixture(makeConversation(), { restartFailure })
  await assert.rejects(
    failingFixture.controller.confirm('conversation-confirm', 'assistant-confirm'),
    (error) => error === restartFailure,
    'durable Chat workflow restart rejection identity propagates to the existing UI error handler',
  )
}

async function testFinalMessageClipboardAction(messageActionModule) {
  const writes = []
  const controller = messageActionModule.createConversationMessageActionController({
    async writeText(text) {
      writes.push(text)
    },
  })

  const responseMessage = Object.freeze({
    content: 'fallback content',
    responseText: '  final response  ',
    productMode: 'companion',
  })
  const responseSnapshot = { ...responseMessage }
  await controller.copyFinalText(responseMessage)
  assert.deepEqual(writes, ['  final response  '], 'responseText takes precedence and is written without trimming')
  assert.deepEqual(responseMessage, responseSnapshot, 'copying final text does not mutate the input message')

  await controller.copyFinalText({ content: '  content fallback  ', productMode: 'agent' })
  assert.deepEqual(
    writes,
    ['  final response  ', '  content fallback  '],
    'an absent responseText falls back to the original untrimmed content regardless of product mode',
  )

  await controller.copyFinalText({ content: 'forbidden fallback', responseText: '' })
  await controller.copyFinalText({ content: 'forbidden fallback', responseText: ' \n\t ' })
  await controller.copyFinalText({ content: ' \r\n ' })
  assert.equal(writes.length, 2, 'empty or whitespace-only selected text performs no clipboard write')

  const clipboardFailure = new Error('clipboard unavailable')
  const failingController = messageActionModule.createConversationMessageActionController({
    async writeText() {
      throw clipboardFailure
    },
  })
  await assert.rejects(
    failingController.copyFinalText({ content: 'copy me' }),
    (error) => error === clipboardFailure,
    'clipboard rejection identity propagates unchanged',
  )
}

async function testWorkflowSkillSaveAction(workflowSaveModule) {
  const savedSuggestion = {
    ok: true,
    skill: { name: 'Suggested saved skill' },
    outcome: 'saved',
  }
  const alreadySavedSuggestion = {
    ok: true,
    skill: { name: 'Suggested existing skill' },
    outcome: 'already_saved',
  }
  const blockedSuggestion = {
    ok: true,
    skill: { name: 'Suggested blocked skill' },
    outcome: 'blocked',
  }
  const rejectedSuggestion = {
    ok: true,
    skill: { name: 'Suggested rejected skill' },
    outcome: 'rejected',
  }
  let currentConversation
  let conversationReads = 0
  const suggestionReads = []
  const saveCalls = []
  const blockedReasons = []
  const translatedKeys = []
  const persistenceFailure = new Error('workflow persistence failed')
  const now = 1_725_000_123_456

  const controller = workflowSaveModule.createConversationWorkflowSkillSaveController({
    getConversation(conversationId) {
      conversationReads += 1
      return currentConversation?.id === conversationId ? currentConversation : undefined
    },
    getSuggestion(message) {
      suggestionReads.push(message.id)
      return message.suggestion
    },
    async saveApprovedSuggestion(input) {
      saveCalls.push(input)
      switch (input.suggestion.outcome) {
        case 'saved':
          return { ok: true, status: 'saved', skill: { name: 'Persisted saved skill' } }
        case 'already_saved':
          return { ok: true, status: 'already_saved', skill: { name: 'Persisted existing skill' } }
        case 'blocked':
          return { ok: false, status: 'blocked', reason: 'payload_too_large' }
        case 'rejected':
          throw persistenceFailure
        default:
          throw new Error('unexpected workflow-save fixture')
      }
    },
    now: () => now,
    translate(key) {
      translatedKeys.push(key)
      return `localized:${key}`
    },
    formatBlockedReason(reason) {
      blockedReasons.push(reason)
      return `localized-block:${reason ?? 'unknown'}`
    },
  })

  assert.deepEqual(
    await controller.saveFromMessage('conversation-save', 'assistant-save'),
    {
      ok: false,
      status: 'unavailable',
      reason: 'localized:chatRunner.workflowSave.messageUnavailable',
    },
    'a missing conversation returns the localized message-unavailable result',
  )

  currentConversation = {
    id: 'conversation-save',
    messages: [{ id: 'user-save', role: 'user', suggestion: savedSuggestion }],
  }
  assert.deepEqual(
    await controller.saveFromMessage('conversation-save', 'user-save'),
    {
      ok: false,
      status: 'unavailable',
      reason: 'localized:chatRunner.workflowSave.messageUnavailable',
    },
    'a non-assistant message returns the same localized unavailable result without reading a suggestion',
  )

  currentConversation = {
    id: 'conversation-save',
    messages: [
      { id: 'assistant-missing-suggestion', role: 'assistant' },
      { id: 'assistant-invalid-suggestion', role: 'assistant', suggestion: { ok: false, skill: { name: 'Invalid' } } },
      { id: 'assistant-missing-skill', role: 'assistant', suggestion: { ok: true } },
    ],
  }
  for (const messageId of [
    'assistant-missing-suggestion',
    'assistant-invalid-suggestion',
    'assistant-missing-skill',
  ]) {
    assert.deepEqual(
      await controller.saveFromMessage('conversation-save', messageId),
      {
        ok: false,
        status: 'unavailable',
        reason: 'localized:chatRunner.workflowSave.suggestionUnavailable',
      },
      `${messageId} fails closed with the localized suggestion-unavailable result`,
    )
  }
  assert.equal(saveCalls.length, 0, 'missing, non-assistant, and invalid suggestions never reach persistence')
  assert.deepEqual(suggestionReads, [
    'assistant-missing-suggestion',
    'assistant-invalid-suggestion',
    'assistant-missing-skill',
  ], 'only current assistant messages are inspected for workflow suggestions')

  currentConversation = {
    id: 'conversation-save',
    messages: [
      { id: 'assistant-save', role: 'assistant', suggestion: savedSuggestion },
      { id: 'assistant-existing', role: 'assistant', suggestion: alreadySavedSuggestion },
      { id: 'assistant-blocked', role: 'assistant', suggestion: blockedSuggestion },
      { id: 'assistant-rejected', role: 'assistant', suggestion: rejectedSuggestion },
    ],
  }
  const conversationSnapshot = structuredClone(currentConversation)
  const suggestionSnapshots = [savedSuggestion, alreadySavedSuggestion, blockedSuggestion, rejectedSuggestion]
    .map((suggestion) => structuredClone(suggestion))

  assert.deepEqual(
    await controller.saveFromMessage('conversation-save', 'assistant-save'),
    { ok: true, status: 'saved', skillName: 'Persisted saved skill' },
    'a newly saved suggestion returns the persisted skill name',
  )
  assert.deepEqual(
    await controller.saveFromMessage('conversation-save', 'assistant-existing'),
    { ok: true, status: 'already_saved', skillName: 'Persisted existing skill' },
    'an existing suggestion preserves the already-saved status and persisted skill name',
  )
  assert.deepEqual(
    await controller.saveFromMessage('conversation-save', 'assistant-blocked'),
    { ok: false, status: 'blocked', reason: 'localized-block:payload_too_large' },
    'a blocked persistence result is localized through the injected formatter',
  )
  assert.deepEqual(blockedReasons, ['payload_too_large'])

  const exactApproval = {
    approved: true,
    approvedBy: 'chat-message',
    approvedAt: now,
    visibleSummary: 'Saved from conversation conversation-save.',
  }
  assert.equal(saveCalls[0].suggestion, savedSuggestion, 'the current suggestion reaches persistence without replacement')
  assert.deepEqual(saveCalls[0].approval, exactApproval, 'save approval metadata and injected time remain exact')
  assert.deepEqual(saveCalls[1].approval, exactApproval)
  assert.deepEqual(saveCalls[2].approval, exactApproval)

  await assert.rejects(
    controller.saveFromMessage('conversation-save', 'assistant-rejected'),
    (error) => error === persistenceFailure,
    'workflow persistence rejection identity propagates unchanged',
  )
  assert.deepEqual(currentConversation, conversationSnapshot, 'workflow save does not mutate the current conversation or messages')
  assert.deepEqual(
    [savedSuggestion, alreadySavedSuggestion, blockedSuggestion, rejectedSuggestion],
    suggestionSnapshots,
    'workflow save does not mutate suggestion inputs',
  )
  assert.equal(conversationReads, 9, 'every invocation re-reads the current conversation instead of retaining a stale message')
  assert.deepEqual(translatedKeys, [
    'chatRunner.workflowSave.messageUnavailable',
    'chatRunner.workflowSave.messageUnavailable',
    'chatRunner.workflowSave.suggestionUnavailable',
    'chatRunner.workflowSave.suggestionUnavailable',
    'chatRunner.workflowSave.suggestionUnavailable',
  ])
}

function testStopFlushesBeforeTerminalProjectionAndKeepsConversationScope(controlModule) {
  const fixture = createControlFixture(controlModule, {
    conversations: [
      createControlConversation('conversation-a', [
        createControlMessage('user-a', 'user', 'done', { content: 'Plan it.', productMode: 'agent' }),
        createControlMessage('assistant-a', 'assistant', 'streaming', { content: 'persisted', startedAt: 10 }),
      ]),
      createControlConversation('conversation-b', [
        createControlMessage('user-b', 'user', 'done', { content: 'Keep running.' }),
        createControlMessage('assistant-b', 'assistant', 'streaming', { content: 'other', startedAt: 20 }),
      ]),
    ],
    activeStreams: {
      'conversation-a': { messageId: 'assistant-a', bufferedText: ' + partial' },
      'conversation-b': { messageId: 'assistant-b', bufferedText: ' untouched' },
    },
  })

  fixture.controller.stop('conversation-a')

  const events = fixture.events
  assert.deepEqual(events.filter((event) => event.includes('conversation-a')), [
    'runner-flush:conversation-a:assistant-a',
    'commit-text:conversation-a:assistant-a',
    'commit-traces:conversation-a:assistant-a',
    'abort:conversation-a:assistant-a',
    'clear-active:conversation-a',
    'update:conversation-a:assistant-a',
    'clear-streaming:conversation-a:assistant-a',
    'finish:conversation-a:assistant-a:user_stopped',
    'trace:conversation-a:assistant-a:stopped',
  ], 'stop preserves the complete flush-to-terminal ordering contract')

  const stopped = fixture.getMessage('conversation-a', 'assistant-a')
  assert.equal(stopped.content, 'persisted + partial', 'stop terminal accounting keeps the final buffered output')
  assert.equal(stopped.status, 'cancelled')
  assert.equal(stopped.usage.outputTokens, 'persisted + partial'.length)
  assert.equal(stopped.tokenCount, 'persisted + partial'.length)
  assert.equal(fixture.controllers['conversation-a'].signal.aborted, true, 'the exact active controller is aborted')
  assert.equal(fixture.controllers['conversation-b'].signal.aborted, false, 'a parallel conversation controller is untouched')
  assert.equal(fixture.getMessage('conversation-b', 'assistant-b').content, 'other', 'parallel output is untouched')
  assert.equal(events.some((event) => event.includes('conversation-b')), false, 'stopping A emits no mutation or cleanup for B')
  assert.deepEqual(fixture.finishedTasks, [{
    conversationId: 'conversation-a',
    messageId: 'assistant-a',
    reason: 'user_stopped',
  }], 'stop finishes the exact Agent message task with the established reason')
}

async function testStaleRecoveryCommitsBuffersAndIsIdempotent(controlModule) {
  const fixture = createControlFixture(controlModule, {
    conversations: [
      createControlConversation('conversation-tavern', [
        createControlMessage('user-tavern', 'user', 'done', { content: 'Continue.', productMode: 'companion' }),
        createControlMessage('assistant-tavern', 'assistant', 'sending', { content: 'saved', startedAt: 40 }),
      ]),
      createControlConversation('conversation-live', [
        createControlMessage('user-live', 'user', 'done', { content: 'Live.' }),
        createControlMessage('assistant-live', 'assistant', 'streaming', { content: 'live' }),
      ]),
    ],
    staleBuffers: {
      'conversation-tavern:assistant-tavern': ' + recovered',
      'conversation-live:assistant-live': ' + forbidden',
    },
    activeStreams: {
      'conversation-live': { messageId: 'assistant-live' },
    },
  })

  await fixture.controller.recoverStale('conversation-live')
  assert.equal(fixture.events.some((event) => event.includes('conversation-live:assistant-live')), false, 'live streams are protected from stale recovery')

  await fixture.controller.recoverStale('conversation-tavern')
  await fixture.controller.recoverStale('conversation-tavern')

  const recovered = fixture.getMessage('conversation-tavern', 'assistant-tavern')
  assert.equal(recovered.content, 'saved + recovered')
  assert.equal(recovered.responseText, 'saved + recovered')
  assert.equal(recovered.status, 'cancelled')
  assert.equal(recovered.usage.outputTokens, 'saved + recovered'.length)
  assert.ok(
    fixture.events.indexOf('commit-traces:conversation-tavern:assistant-tavern')
      < fixture.events.indexOf('update:conversation-tavern:assistant-tavern'),
    'stale recovery commits text and traces before terminal accounting',
  )
  assert.equal(
    fixture.events.filter((event) => event === 'update:conversation-tavern:assistant-tavern').length,
    1,
    'a second recovery call does not duplicate terminal mutation',
  )
  assert.equal(
    fixture.events.filter((event) => event === 'trace:conversation-tavern:assistant-tavern:recovered').length,
    1,
    'a second recovery call does not duplicate the recovered trace',
  )
  assert.equal(
    fixture.events.filter((event) => event === 'settle:conversation-tavern:assistant-tavern').length,
    1,
    'a second recovery call does not duplicate trace settlement',
  )
  assert.deepEqual(fixture.finishedTasks, [{
    conversationId: 'conversation-tavern',
    messageId: 'assistant-tavern',
    reason: 'stale_stream_recovered',
  }], 'stale recovery finishes the exact Tavern message task once')
  assert.equal(fixture.flushes.length, 1, 'stale buffers are flushed once')
}

async function testRetryStopsBeforeTrimAndAwaitsReplyStart(controlModule) {
  let releaseStart
  const startDone = new Promise((resolve) => {
    releaseStart = resolve
  })
  const fixture = createControlFixture(controlModule, {
    conversations: [createControlConversation('conversation-retry', [
      createControlMessage('user-old', 'user', 'done', { content: 'Old.' }),
      createControlMessage('assistant-old', 'assistant', 'done', { content: 'Old answer.' }),
      createControlMessage('user-agent', 'user', 'done', { content: 'Agent request.', productMode: 'agent' }),
      createControlMessage('assistant-retry', 'assistant', 'streaming', { content: 'partial' }),
      createControlMessage('assistant-after', 'assistant', 'done', { content: 'later' }),
    ])],
    activeStreams: {
      'conversation-retry': { messageId: 'assistant-retry', bufferedText: ' reply' },
    },
    startReply: () => startDone,
  })

  let settled = false
  const retry = fixture.controller.retry('conversation-retry', 'assistant-retry').then(() => {
    settled = true
  })
  await Promise.resolve()

  assert.equal(settled, false, 'retry remains pending until the mode-free reply starter settles')
  assert.ok(
    fixture.events.indexOf('clear-streaming:conversation-retry:assistant-retry')
      < fixture.events.indexOf('trim:conversation-retry:user-agent'),
    'retry stops and flushes before truncating history',
  )
  assert.ok(
    fixture.events.indexOf('trim:conversation-retry:user-agent')
      < fixture.events.indexOf('start:conversation-retry'),
    'retry starts only after truncating to the nearest preceding user',
  )
  assert.deepEqual(fixture.getConversation('conversation-retry').messages.map((message) => message.id), [
    'user-old',
    'assistant-old',
    'user-agent',
  ])

  releaseStart()
  await retry
  assert.equal(settled, true)
}

async function testRegenerateStopsBeforeExactRemovalAndAwaitsReplyStart(controlModule) {
  let releaseStart
  const startDone = new Promise((resolve) => {
    releaseStart = resolve
  })
  const fixture = createControlFixture(controlModule, {
    conversations: [createControlConversation('conversation-regenerate', [
      createControlMessage('assistant-orphan', 'assistant', 'done', { content: 'Keep me.' }),
      createControlMessage('user-tavern', 'user', 'done', { content: 'Tavern turn.', productMode: 'companion' }),
      createControlMessage('assistant-final', 'assistant', 'streaming', { content: 'partial' }),
    ])],
    activeStreams: {
      'conversation-regenerate': { messageId: 'assistant-final', bufferedText: ' ending' },
    },
    startReply: () => startDone,
  })

  let settled = false
  const regenerate = fixture.controller.regenerateLastAssistant('conversation-regenerate').then(() => {
    settled = true
  })
  await Promise.resolve()

  assert.equal(settled, false, 'regenerate remains pending until the mode-free reply starter settles')
  assert.ok(
    fixture.events.indexOf('clear-streaming:conversation-regenerate:assistant-final')
      < fixture.events.indexOf('remove:conversation-regenerate:assistant-final'),
    'regenerate stops and flushes before removing history',
  )
  assert.ok(
    fixture.events.indexOf('remove:conversation-regenerate:assistant-final')
      < fixture.events.indexOf('start:conversation-regenerate'),
  )
  assert.deepEqual(fixture.getConversation('conversation-regenerate').messages.map((message) => message.id), [
    'assistant-orphan',
    'user-tavern',
  ], 'regenerate removes exactly the final assistant')

  releaseStart()
  await regenerate
  assert.equal(settled, true)

  const fallbackFixture = createControlFixture(controlModule, {
    conversations: [createControlConversation('conversation-fallback', [
      createControlMessage('assistant-only', 'assistant', 'done', { content: 'Only.' }),
    ])],
  })
  await fallbackFixture.controller.regenerateLastAssistant('conversation-fallback')
  assert.ok(fallbackFixture.events.includes('start:conversation-fallback'), 'regenerate starts the mode-free ordinary reply when no preceding user exists')
}

async function testControlReplyStartFailuresPropagate(controlModule) {
  const retryFixture = createControlFixture(controlModule, {
    conversations: [createControlConversation('conversation-retry-error', [
      createControlMessage('user-error', 'user', 'done', { productMode: 'agent' }),
      createControlMessage('assistant-error', 'assistant', 'done'),
    ])],
    startReply: async () => {
      throw new Error('retry start failed')
    },
  })
  await assert.rejects(
    retryFixture.controller.retry('conversation-retry-error', 'assistant-error'),
    /retry start failed/,
  )
  assert.ok(
    retryFixture.events.includes('error:retry:retry start failed'),
    'retry reports through the single Chat error channel before preserving rejection semantics',
  )

  const regenerateFixture = createControlFixture(controlModule, {
    conversations: [createControlConversation('conversation-regenerate-error', [
      createControlMessage('user-error', 'user', 'done', { productMode: 'companion' }),
      createControlMessage('assistant-error', 'assistant', 'done'),
    ])],
    startReply: async () => {
      throw new Error('regenerate start failed')
    },
  })
  await assert.rejects(
    regenerateFixture.controller.regenerateLastAssistant('conversation-regenerate-error'),
    /regenerate start failed/,
  )
  assert.ok(
    regenerateFixture.events.includes('error:regenerate:regenerate start failed'),
    'regenerate reports through the single Chat error channel before preserving rejection semantics',
  )
}

function createControlFixture(controlModule, options = {}) {
  const conversations = structuredClone(options.conversations ?? [])
  const events = []
  const finishedTasks = []
  const flushes = []
  const activeStreams = new Map()
  const controllers = {}
  const staleBuffers = new Map(Object.entries(options.staleBuffers ?? {}))

  for (const [conversationId, definition] of Object.entries(options.activeStreams ?? {})) {
    const controller = new AbortController()
    controller.signal.addEventListener('abort', () => {
      events.push(`abort:${conversationId}:${definition.messageId}`)
    })
    controllers[conversationId] = controller
    activeStreams.set(conversationId, {
      controller,
      messageId: definition.messageId,
      flush() {
        events.push(`runner-flush:${conversationId}:${definition.messageId}`)
        if (definition.bufferedText) {
          staleBuffers.set(`${conversationId}:${definition.messageId}`, definition.bufferedText)
        }
      },
    })
  }

  const findConversation = (conversationId) => conversations.find((conversation) => conversation.id === conversationId)
  const findMessage = (conversationId, messageId) => findConversation(conversationId)?.messages.find((message) => message.id === messageId)
  const controller = controlModule.createConversationControlController({
    buildEstimatedUsage(inputMessages, outputText) {
      return {
        inputTokens: inputMessages.reduce((total, message) => total + message.content.length, 0),
        outputTokens: outputText.length,
        totalTokens: inputMessages.reduce((total, message) => total + message.content.length, 0) + outputText.length,
        source: 'estimated',
      }
    },
    clearActiveStream(conversationId) {
      events.push(`clear-active:${conversationId}`)
      activeStreams.delete(conversationId)
    },
    clearStreaming(conversationId, messageId) {
      events.push(`clear-streaming:${conversationId}:${messageId}`)
      staleBuffers.delete(`${conversationId}:${messageId}`)
    },
    commitStreamingBuffers(conversationId, messageId) {
      events.push(`commit-text:${conversationId}:${messageId}`)
      const message = findMessage(conversationId, messageId)
      const bufferKey = `${conversationId}:${messageId}`
      const text = staleBuffers.get(bufferKey)
      if (message && text) message.content += text
      events.push(`commit-traces:${conversationId}:${messageId}`)
    },
    createRecoveredTrace(completedAt) {
      return createControlTrace('recovered', completedAt)
    },
    createStoppedTrace(completedAt) {
      return createControlTrace('stopped', completedAt)
    },
    estimateTextTokens(text) {
      return text.length
    },
    finishCancelledTask(conversationId, messageId, reason) {
      finishedTasks.push({ conversationId, messageId, reason })
      events.push(`finish:${conversationId}:${messageId}:${reason}`)
    },
    async flushStreamingMessage(conversationId, messageId) {
      flushes.push({ conversationId, messageId })
      events.push(`flush:${conversationId}:${messageId}`)
      await options.flushMessage?.(conversationId, messageId)
    },
    getActiveStream(conversationId) {
      return activeStreams.get(conversationId)
    },
    getConversation: findConversation,
    getMessage: findMessage,
    hasActiveStream(conversationId) {
      return activeStreams.has(conversationId)
    },
    now() {
      return 100
    },
    removeMessage(conversationId, messageId) {
      events.push(`remove:${conversationId}:${messageId}`)
      const conversation = findConversation(conversationId)
      if (conversation) conversation.messages = conversation.messages.filter((message) => message.id !== messageId)
    },
    reportReplyStartFailure(kind, error) {
      events.push(`error:${kind}:${error instanceof Error ? error.message : String(error)}`)
    },
    settleRunningTraces(conversationId, messageId) {
      events.push(`settle:${conversationId}:${messageId}`)
    },
    async startAssistantReplyAfterHistoryProjection(...args) {
      assert.equal(args.length, 1, 'retry and regenerate pass only conversation identity to reply startup')
      const [conversationId] = args
      events.push(`start:${conversationId}`)
      await options.startReply?.(conversationId)
    },
    traceText(key) {
      return key
    },
    trimAfterMessage(conversationId, messageId) {
      events.push(`trim:${conversationId}:${messageId}`)
      const conversation = findConversation(conversationId)
      const index = conversation?.messages.findIndex((message) => message.id === messageId) ?? -1
      if (conversation && index >= 0) conversation.messages = conversation.messages.slice(0, index + 1)
    },
    updateMessage(conversationId, messageId, updates) {
      events.push(`update:${conversationId}:${messageId}`)
      Object.assign(findMessage(conversationId, messageId), updates)
    },
    upsertTrace(conversationId, messageId, trace) {
      events.push(`trace:${conversationId}:${messageId}:${trace.id}`)
    },
  })

  return {
    controller,
    controllers,
    events,
    finishedTasks,
    flushes,
    getConversation: findConversation,
    getMessage: findMessage,
  }
}

function createControlConversation(id, messages) {
  return {
    ...createConversation(),
    id,
    messages,
  }
}

function createControlMessage(id, role, status, overrides = {}) {
  return {
    id,
    role,
    content: '',
    timestamp: 1,
    status,
    ...overrides,
  }
}

function createControlTrace(id, completedAt) {
  return {
    id,
    type: 'system',
    title: id,
    content: id,
    status: 'done',
    startedAt: completedAt,
    completedAt,
    durationMs: 0,
  }
}

async function testTypedMessagesUseModelPath(commandModule) {
  const cases = [
    ['  switch%20theme  ', 'switch theme'],
    ['rag', 'rag'],
    ['drag this into a new topic', 'drag this into a new topic'],
    ['change the topic to diagnostics', 'change the topic to diagnostics'],
    ['what are my settings?', 'what are my settings?'],
    ['show source code', 'show source code'],
    ['read my files', 'read my files'],
    ['run diagnostics', 'run diagnostics'],
    ['use the cleanup workflow', 'use the cleanup workflow'],
  ]

  for (const [content, expected] of cases) {
    const fixture = createFixture(commandModule)
    await fixture.command.send({
      conversation: createConversation(),
      content,
    })

    assert.deepEqual(fixture.errors, [null], `${expected}: the Chat error is cleared`)
    assert.equal(fixture.legacyInputs.length, 1, `${expected}: typed text reaches the provider runtime`)
    assert.equal(fixture.messages.length, 1, `${expected}: no synthetic assistant response is projected`)
    assert.equal(fixture.messages[0].message.content, expected, `${expected}: provider receives normalized text unchanged`)
    assert.equal(fixture.legacyInputs[0].content, expected, `${expected}: runtime input preserves the projected text`)
  }
}

async function testSettingsLikeTextUsesModelPath(commandModule) {
  const fixture = createFixture(commandModule)

  await fixture.command.send({
    conversation: createConversation(),
    content: 'set theme',
    productMode: 'companion',
  })

  assert.equal(fixture.messages.length, 1, 'the controller projects only the user turn')
  assert.equal(fixture.legacyInputs.length, 1, 'settings-like text reaches the model path')
  assert.equal(fixture.legacyInputs[0].content, 'set theme')
  assert.equal(Object.hasOwn(fixture.messages[0].message, 'productMode'), false, 'settings-like metadata cannot create product-mode message state')
  assert.equal('productMode' in fixture.legacyInputs[0], false, 'settings-like Companion metadata cannot reach runtime dispatch')
}

async function testLegacyDelegation(commandModule) {
  const fixture = createFixture(commandModule)
  const attachments = []
  const conversation = createConversation()

  await fixture.command.send({
    conversation,
    content: '  Ask%20the%20provider  ',
    attachments,
    requestedOutput: 'work-artifact',
    productMode: 'agent',
  })

  assert.equal(fixture.messages.length, 1, 'non-local turns project exactly one user message before runtime dispatch')
  assert.equal(fixture.legacyInputs.length, 1, 'non-local turns delegate through the temporary runtime boundary')
  const projectedUserMessage = fixture.messages[0].message
  assert.deepEqual(fixture.legacyInputs[0], {
    conversation: {
      ...conversation,
      messages: [projectedUserMessage],
    },
    content: 'Ask the provider',
    attachments,
    requestedOutput: 'work-artifact',
  })
  assert.equal(Object.hasOwn(projectedUserMessage, 'productMode'), false, 'historical metadata cannot create product-mode message state')
  assert.notEqual(fixture.legacyInputs[0].conversation, conversation, 'runtime receives the latest store snapshot rather than the stale caller snapshot')
  assert.equal(fixture.legacyInputs[0].conversation.messages.filter((message) => message === projectedUserMessage).length, 1, 'runtime receives the projected user message exactly once')
  assert.deepEqual(fixture.events, [
    'error:null',
    'add:message-1',
    'get:conversation-1',
    'dispatch',
  ], 'model-first dispatch preserves error-clear, projection, snapshot-read, and runtime order')
}

async function testUserMessageDurabilityPrecedesDispatch(commandModule) {
  let releaseDurability
  const durabilityGate = new Promise((resolve) => {
    releaseDurability = resolve
  })
  const fixture = createFixture(commandModule, {
    addMessageDurability: () => durabilityGate,
  })
  let settled = false
  const pending = fixture.command.send({
    conversation: createConversation(),
    content: 'Persist before dispatch.',
  }).then(() => {
    settled = true
  })

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(settled, false, 'send remains pending while the accepted user message is not durable')
  assert.equal(fixture.legacyInputs.length, 0, 'provider dispatch cannot begin before the exact user-message write settles')
  assert.deepEqual(fixture.events, [
    'error:null',
    'add:message-1',
    'get:conversation-1',
  ], 'projection is verified synchronously while durable persistence remains the effect barrier')

  releaseDurability()
  await pending
  assert.equal(settled, true)
  assert.equal(fixture.legacyInputs.length, 1, 'provider dispatch starts once user durability is established')
  assert.equal(fixture.events.at(-1), 'dispatch')

  const persistenceFailure = new Error('user-message persistence failed')
  const rejected = createFixture(commandModule, {
    addMessageDurability: () => Promise.reject(persistenceFailure),
  })
  await assert.rejects(
    rejected.command.send({
      conversation: createConversation(),
      content: 'Do not dispatch me.',
    }),
    (error) => error === persistenceFailure,
    'the exact persistence failure remains visible to the sender',
  )
  assert.equal(rejected.legacyInputs.length, 0, 'a failed user-message write permanently fences provider dispatch for that turn')
}

async function testAttachmentAndEmptyInputBoundaries(commandModule) {
  const attachment = {
    id: 'attachment-1',
    type: 'text',
    uri: 'file:///fixture.txt',
    name: 'fixture.txt',
    mimeType: 'text/plain',
    size: 4,
  }
  const attachmentFixture = createFixture(commandModule)

  await attachmentFixture.command.send({
    conversation: createConversation(),
    content: ' %20 ',
    attachments: [attachment],
  })

  assert.equal(attachmentFixture.messages.length, 1)
  assert.equal(attachmentFixture.messages[0].message.content, '')
  assert.equal(attachmentFixture.legacyInputs.length, 1)
  assert.deepEqual(attachmentFixture.legacyInputs[0].attachments, [attachment])

  const emptyFixture = createFixture(commandModule)
  await emptyFixture.command.send({ conversation: createConversation(), content: ' %20 ' })
  assert.deepEqual(emptyFixture.errors, [], 'empty input leaves the presentation projection untouched')
  assert.deepEqual(emptyFixture.messages, [])
  assert.deepEqual(emptyFixture.legacyInputs, [])
}

async function testRuntimeDelegationAwaitsAndPropagates(commandModule) {
  let releaseDispatch
  const dispatchDone = new Promise((resolve) => {
    releaseDispatch = resolve
  })
  const awaitFixture = createFixture(commandModule, {
    dispatchLegacyMessage: () => dispatchDone,
  })
  let settled = false
  const pending = awaitFixture.command.send({
    conversation: createConversation(),
    content: 'Await the runtime boundary.',
    productMode: 'companion',
  }).then(() => {
    settled = true
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(settled, false, 'presentation dispatch remains pending until the runtime adapter settles')
  assert.equal(awaitFixture.legacyInputs.length, 1, 'awaitable dispatch crosses the runtime boundary exactly once')
  assert.equal(Object.hasOwn(awaitFixture.legacyInputs[0], 'productMode'), false, 'awaitable dispatch strips forged historical mode input')
  assert.ok(awaitFixture.events.indexOf('get:conversation-1') < awaitFixture.events.indexOf('dispatch'), 'latest projection is read before the pending runtime starts')
  releaseDispatch()
  await pending
  assert.equal(settled, true)

  const runtimeFailure = new Error('runtime dispatch failed')
  const failureFixture = createFixture(commandModule, {
    dispatchLegacyMessage: async () => {
      throw runtimeFailure
    },
  })
  await assert.rejects(
    failureFixture.command.send({
      conversation: createConversation(),
      content: 'Preserve runtime failure.',
      productMode: 'agent',
    }),
    (error) => error === runtimeFailure,
    'presentation dispatch preserves the exact runtime rejection',
  )
}

async function testProjectedConversationFailClosed(commandModule) {
  const missingFixture = createFixture(commandModule, {
    getConversation: () => undefined,
  })
  await assert.rejects(
    missingFixture.command.send({ conversation: createConversation(), content: 'Missing projection.' }),
    /conversation_user_projection_missing/,
  )
  assert.equal(missingFixture.messages.length, 1, 'a missing snapshot does not duplicate the already projected user message')
  assert.equal(missingFixture.legacyInputs.length, 0, 'a missing projected snapshot never reaches the runtime')
  assert.deepEqual(missingFixture.events, [
    'error:null',
    'add:message-1',
    'get:conversation-1',
  ], 'missing projection fails after one projection and before runtime dispatch')

  const duplicateFixture = createFixture(commandModule, {
    getConversation({ conversationId, projectedMessages }) {
      return {
        ...createConversation(),
        id: conversationId,
        messages: [projectedMessages[0], projectedMessages[0]],
      }
    },
  })
  await assert.rejects(
    duplicateFixture.command.send({ conversation: createConversation(), content: 'Duplicate projection.' }),
    /conversation_user_projection_missing/,
  )
  assert.equal(duplicateFixture.legacyInputs.length, 0, 'duplicate projection fails closed before runtime dispatch')
}

async function testConversationMessageRuntimeBinding(runtimeBindingModule) {
  const input = {
    conversation: createConversation(),
    content: 'Normalized runtime input.',
    attachments: [],
    requestedOutput: 'work-artifact',
  }
  await assert.rejects(
    runtimeBindingModule.dispatchConversationMessageRuntime(input),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_UNINITIALIZED_ERROR,
    'a first send before explicit bootstrap composition fails closed with a stable error',
  )
  await assert.rejects(
    runtimeBindingModule.startConversationReplyAfterHistoryProjectionRuntime('conversation-reply'),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_REPLY_STARTER_UNINITIALIZED_ERROR,
    'retry or regenerate before explicit bootstrap composition fails closed with its established starter error',
  )
  const confirmedWorkflowConversation = createConversation()
  const confirmedWorkflowOptions = {
    explicitToolRequest: { name: 'android.device', arguments: { action: 'confirm' } },
    limits: { maxSteps: 3 },
    userConfirmed: true,
  }
  await assert.rejects(
    runtimeBindingModule.startConfirmedConversationWorkflowReplyRuntime(
      confirmedWorkflowConversation,
      'Confirmed request.',
      confirmedWorkflowOptions,
    ),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_WORKFLOW_REPLY_STARTER_UNINITIALIZED_ERROR,
    'workflow confirmation before explicit bootstrap composition fails closed',
  )
  await assert.rejects(
    runtimeBindingModule.listConversationToolManifestsRuntime(),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_TOOL_CATALOG_UNINITIALIZED_ERROR,
    'conversation confirmation tool listing before bootstrap composition fails closed',
  )
  assert.throws(
    () => runtimeBindingModule.resolveConversationToolRuntime({ name: 'fixture.tool' }, []),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_TOOL_CATALOG_UNINITIALIZED_ERROR,
    'conversation confirmation tool resolution before bootstrap composition fails closed',
  )
  await assert.rejects(
    runtimeBindingModule.saveApprovedConversationWorkflowSkillRuntime({ suggestion: {} }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_WORKFLOW_SKILL_UNINITIALIZED_ERROR,
    'workflow-skill saving before bootstrap composition fails closed',
  )
  assert.equal(
    runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_UNINITIALIZED_ERROR,
    'conversation_message_runtime_uninitialized',
    'the send-runtime failure remains stable for callers and diagnostics',
  )
  assert.equal(
    runtimeBindingModule.CONVERSATION_REPLY_STARTER_UNINITIALIZED_ERROR,
    'conversation_reply_starter_not_bound',
    'the existing reply-starter failure remains stable for callers and diagnostics',
  )
  assert.equal(
    runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'conversation_message_runtime_already_bound',
    'the competing-binding failure remains stable for callers and diagnostics',
  )
  assert.equal(
    runtimeBindingModule.CONVERSATION_WORKFLOW_REPLY_STARTER_UNINITIALIZED_ERROR,
    'conversation_workflow_reply_starter_not_bound',
    'the confirmed-workflow reply failure remains stable for callers and diagnostics',
  )
  assert.equal(
    runtimeBindingModule.CONVERSATION_TOOL_CATALOG_UNINITIALIZED_ERROR,
    'conversation_tool_catalog_not_bound',
    'the conversation tool-catalog failure remains stable for callers and diagnostics',
  )
  assert.equal(
    runtimeBindingModule.CONVERSATION_WORKFLOW_SKILL_UNINITIALIZED_ERROR,
    'conversation_workflow_skill_not_bound',
    'the workflow-skill failure remains stable for callers and diagnostics',
  )
  assert.notEqual(
    runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_UNINITIALIZED_ERROR,
    runtimeBindingModule.CONVERSATION_REPLY_STARTER_UNINITIALIZED_ERROR,
    'send and reply-start initialization failures remain distinguishable',
  )

  const receivedInputs = []
  const receivedReplyStarts = []
  const receivedConfirmedWorkflowStarts = []
  let runtimeImplementation = async (runtimeInput) => {
    receivedInputs.push(runtimeInput)
  }
  let replyStartImplementation = async (...args) => {
    receivedReplyStarts.push(args)
  }
  const boundDispatch = (runtimeInput) => runtimeImplementation(runtimeInput)
  const boundReplyStart = (conversationId) => replyStartImplementation(conversationId)
  let confirmedWorkflowStartImplementation = async (conversation, content, options) => {
    receivedConfirmedWorkflowStarts.push({ conversation, content, options })
  }
  const boundConfirmedWorkflowStart = (conversation, content, options) =>
    confirmedWorkflowStartImplementation(conversation, content, options)
  const catalogManifests = [{ id: 'fixture:tool', source: 'builtin', name: 'fixture.tool', description: 'Fixture', permission: 'read-only', enabled: true }]
  const catalogListInputs = []
  const boundListConversationToolManifests = async () => {
    catalogListInputs.push('listed')
    return catalogManifests
  }
  const catalogResolveInputs = []
  const boundResolveConversationTool = (request, manifests) => {
    catalogResolveInputs.push({ request, manifests })
    return manifests[0] ?? null
  }
  const workflowSkillSaveInputs = []
  const workflowSkillSaveResult = { ok: true, status: 'saved', requiresUserApproval: true }
  const boundSaveApprovedWorkflowSkillSuggestion = async (input) => {
    workflowSkillSaveInputs.push(input)
    return workflowSkillSaveResult
  }

  const boundRuntime = {
    dispatchAfterUserProjection: boundDispatch,
    startAfterHistoryProjection: boundReplyStart,
    startConfirmedWorkflowReply: boundConfirmedWorkflowStart,
    listConversationToolManifests: boundListConversationToolManifests,
    resolveConversationTool: boundResolveConversationTool,
    saveApprovedWorkflowSkillSuggestion: boundSaveApprovedWorkflowSkillSuggestion,
  }
  runtimeBindingModule.bindConversationMessageRuntime(boundRuntime)
  runtimeBindingModule.bindConversationMessageRuntime(boundRuntime)
  assert.throws(
    () => runtimeBindingModule.bindConversationMessageRuntime({
      dispatchAfterUserProjection: async () => {},
      startAfterHistoryProjection: boundReplyStart,
      startConfirmedWorkflowReply: boundConfirmedWorkflowStart,
      listConversationToolManifests: boundListConversationToolManifests,
      resolveConversationTool: boundResolveConversationTool,
      saveApprovedWorkflowSkillSuggestion: boundSaveApprovedWorkflowSkillSuggestion,
    }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'a different dispatch method cannot silently replace the composition-root binding',
  )
  assert.throws(
    () => runtimeBindingModule.bindConversationMessageRuntime({
      dispatchAfterUserProjection: boundDispatch,
      startAfterHistoryProjection: async () => {},
      startConfirmedWorkflowReply: boundConfirmedWorkflowStart,
      listConversationToolManifests: boundListConversationToolManifests,
      resolveConversationTool: boundResolveConversationTool,
      saveApprovedWorkflowSkillSuggestion: boundSaveApprovedWorkflowSkillSuggestion,
    }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'a different reply-start method cannot silently replace the composition-root binding',
  )
  assert.throws(
    () => runtimeBindingModule.bindConversationMessageRuntime({
      dispatchAfterUserProjection: boundDispatch,
      startAfterHistoryProjection: boundReplyStart,
      startConfirmedWorkflowReply: async () => {},
      listConversationToolManifests: boundListConversationToolManifests,
      resolveConversationTool: boundResolveConversationTool,
      saveApprovedWorkflowSkillSuggestion: boundSaveApprovedWorkflowSkillSuggestion,
    }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'a different confirmed-workflow starter cannot silently replace the composition-root binding',
  )
  assert.throws(
    () => runtimeBindingModule.bindConversationMessageRuntime({
      dispatchAfterUserProjection: boundDispatch,
      startAfterHistoryProjection: boundReplyStart,
      startConfirmedWorkflowReply: boundConfirmedWorkflowStart,
      listConversationToolManifests: async () => [],
      resolveConversationTool: boundResolveConversationTool,
      saveApprovedWorkflowSkillSuggestion: boundSaveApprovedWorkflowSkillSuggestion,
    }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'a different Agent tool-listing method cannot replace the composition-root binding',
  )
  assert.throws(
    () => runtimeBindingModule.bindConversationMessageRuntime({
      dispatchAfterUserProjection: boundDispatch,
      startAfterHistoryProjection: boundReplyStart,
      startConfirmedWorkflowReply: boundConfirmedWorkflowStart,
      listConversationToolManifests: boundListConversationToolManifests,
      resolveConversationTool: () => null,
      saveApprovedWorkflowSkillSuggestion: boundSaveApprovedWorkflowSkillSuggestion,
    }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'a different Agent tool-resolution method cannot replace the composition-root binding',
  )
  assert.throws(
    () => runtimeBindingModule.bindConversationMessageRuntime({
      dispatchAfterUserProjection: boundDispatch,
      startAfterHistoryProjection: boundReplyStart,
      startConfirmedWorkflowReply: boundConfirmedWorkflowStart,
      listConversationToolManifests: boundListConversationToolManifests,
      resolveConversationTool: boundResolveConversationTool,
      saveApprovedWorkflowSkillSuggestion: async () => workflowSkillSaveResult,
    }),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_ALREADY_BOUND_ERROR,
    'a different workflow-skill save method cannot replace the composition-root binding',
  )

  const listedManifests = await runtimeBindingModule.listConversationToolManifestsRuntime()
  assert.equal(catalogListInputs.length, 1, 'the presentation seam invokes the intrinsically Chat-owned catalog once')
  assert.equal(listedManifests, catalogManifests, 'the exact manifest snapshot returns through the presentation seam')
  const catalogRequest = { name: 'fixture.tool' }
  const resolvedManifest = runtimeBindingModule.resolveConversationToolRuntime(catalogRequest, listedManifests)
  assert.equal(catalogResolveInputs[0].request, catalogRequest, 'the exact tool request reaches bootstrap')
  assert.equal(catalogResolveInputs[0].manifests, listedManifests, 'resolution uses the exact listed snapshot')
  assert.equal(resolvedManifest, catalogManifests[0], 'the resolved manifest identity is preserved')
  const workflowSkillSaveInput = { suggestion: { workflow: { id: 'workflow-fixture' } } }
  const savedWorkflowSkill = await runtimeBindingModule.saveApprovedConversationWorkflowSkillRuntime(workflowSkillSaveInput)
  assert.equal(workflowSkillSaveInputs[0], workflowSkillSaveInput, 'the exact workflow-skill save input reaches bootstrap')
  assert.equal(savedWorkflowSkill, workflowSkillSaveResult, 'the exact workflow-skill save result returns through the presentation seam')

  let releaseRuntime
  runtimeImplementation = (runtimeInput) => {
    receivedInputs.push(runtimeInput)
    return new Promise((resolve) => {
      releaseRuntime = resolve
    })
  }
  let settled = false
  const pending = runtimeBindingModule.dispatchConversationMessageRuntime(input).then(() => {
    settled = true
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(settled, false, 'the presentation runtime seam remains pending until the bound runtime settles')
  assert.equal(receivedInputs.length, 1, 'one presentation send invokes the bound runtime exactly once')
  assert.equal(receivedInputs[0], input, 'the seam preserves the exact projected input object')
  releaseRuntime()
  await pending
  assert.equal(settled, true)

  let releaseReplyStart
  replyStartImplementation = (...args) => {
    receivedReplyStarts.push(args)
    return new Promise((resolve) => {
      releaseReplyStart = resolve
    })
  }
  let replySettled = false
  const pendingReply = runtimeBindingModule
    .startConversationReplyAfterHistoryProjectionRuntime('conversation-reply')
    .then(() => {
      replySettled = true
    })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(replySettled, false, 'retry and regenerate remain pending until the bound reply startup settles')
  assert.deepEqual(receivedReplyStarts, [['conversation-reply']], 'reply startup forwards only the exact conversation identity once')
  releaseReplyStart()
  await pendingReply
  assert.equal(replySettled, true)

  let releaseConfirmedWorkflowStart
  confirmedWorkflowStartImplementation = (conversation, content, options) => {
    receivedConfirmedWorkflowStarts.push({ conversation, content, options })
    return new Promise((resolve) => {
      releaseConfirmedWorkflowStart = resolve
    })
  }
  let confirmedWorkflowSettled = false
  const pendingConfirmedWorkflow = runtimeBindingModule
    .startConfirmedConversationWorkflowReplyRuntime(
      confirmedWorkflowConversation,
      'Confirmed request.',
      confirmedWorkflowOptions,
    )
    .then(() => {
      confirmedWorkflowSettled = true
    })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(confirmedWorkflowSettled, false, 'workflow confirmation awaits the bound durable restart')
  assert.equal(receivedConfirmedWorkflowStarts.length, 1, 'one confirmation starts the workflow runtime exactly once')
  assert.equal(receivedConfirmedWorkflowStarts[0].conversation, confirmedWorkflowConversation, 'confirmation preserves exact conversation identity')
  assert.equal(receivedConfirmedWorkflowStarts[0].content, 'Confirmed request.', 'confirmation preserves exact user content')
  assert.equal(receivedConfirmedWorkflowStarts[0].options, confirmedWorkflowOptions, 'confirmation preserves the exact mode-free restart options identity')
  releaseConfirmedWorkflowStart()
  await pendingConfirmedWorkflow
  assert.equal(confirmedWorkflowSettled, true)

  const runtimeFailure = new Error('bound runtime failed')
  runtimeImplementation = async () => {
    throw runtimeFailure
  }
  await assert.rejects(
    runtimeBindingModule.dispatchConversationMessageRuntime(input),
    (error) => error === runtimeFailure,
    'the presentation runtime seam preserves the exact runtime rejection',
  )

  const replyFailure = new Error('bound reply start failed')
  replyStartImplementation = async () => {
    throw replyFailure
  }
  await assert.rejects(
    runtimeBindingModule.startConversationReplyAfterHistoryProjectionRuntime('conversation-reply'),
    (error) => error === replyFailure,
    'the presentation reply-start seam preserves the exact runtime rejection',
  )

  const confirmedWorkflowFailure = new Error('bound confirmed workflow start failed')
  confirmedWorkflowStartImplementation = async () => {
    throw confirmedWorkflowFailure
  }
  await assert.rejects(
    runtimeBindingModule.startConfirmedConversationWorkflowReplyRuntime(
      confirmedWorkflowConversation,
      'Confirmed request.',
      confirmedWorkflowOptions,
    ),
    (error) => error === confirmedWorkflowFailure,
    'the confirmed-workflow seam preserves the exact runtime rejection',
  )

  runtimeBindingModule.releaseConversationMessageRuntime(boundRuntime)
  await assert.rejects(
    runtimeBindingModule.dispatchConversationMessageRuntime(input),
    (error) => error instanceof Error
      && error.message === runtimeBindingModule.CONVERSATION_MESSAGE_RUNTIME_UNINITIALIZED_ERROR,
    'owner-matched disposal releases the presentation runtime for a safe Fast Refresh rebind',
  )
}

function testChatWorkspaceReviewRuntimeBinding(workspaceReviewCommandModule) {
  const resolver = () => ({ id: 'review-runtime-a' })
  const competingResolver = () => ({ id: 'review-runtime-b' })

  workspaceReviewCommandModule.bindChatWorkspaceReviewRuntime(resolver)
  workspaceReviewCommandModule.bindChatWorkspaceReviewRuntime(resolver)
  workspaceReviewCommandModule.releaseChatWorkspaceReviewRuntime(competingResolver)
  assert.throws(
    () => workspaceReviewCommandModule.bindChatWorkspaceReviewRuntime(competingResolver),
    (error) => error instanceof Error
      && error.message === workspaceReviewCommandModule.CHAT_WORKSPACE_REVIEW_RUNTIME_ALREADY_BOUND_ERROR,
    'a non-owner release cannot remove the active workspace-review runtime binding',
  )

  workspaceReviewCommandModule.releaseChatWorkspaceReviewRuntime(resolver)
  workspaceReviewCommandModule.bindChatWorkspaceReviewRuntime(competingResolver)
  workspaceReviewCommandModule.releaseChatWorkspaceReviewRuntime(competingResolver)
}

function testProductionMessageRuntimeBoundary() {
  const commandSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationMessageCommand.ts'), 'utf8')
  const actionCommandSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationMessageActionCommand.ts'), 'utf8')
  const workflowActionPolicySource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/workflowActionPolicy.ts'), 'utf8')
  const actionControllerSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationMessageActionController.ts'), 'utf8')
  const actionConfirmationControllerSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationActionConfirmationController.ts'), 'utf8')
  assert.ok(actionConfirmationControllerSource.includes('dependencies.listToolManifests()'), 'confirmation discovers the current tool catalog without a mode discriminator')
  assert.doesNotMatch(actionConfirmationControllerSource, /listToolManifests\s*\(\s*(?:\w+\s*:\s*)?\{[^}]*\b(?:mode|productMode)\b/, 'confirmation cannot restore a catalog mode discriminator')
  assert.doesNotMatch(actionConfirmationControllerSource, /startWorkflowReply\([^]*?\{[^}]*\bproductMode\s*:/, 'confirmation restart carries no product-mode field')
  assert.equal(actionConfirmationControllerSource.includes('previousUser.productMode ??'), false, 'historical user mode cannot select confirmation execution')
  const workflowSaveControllerPath = path.join(root, 'src/presentation/features/conversations/conversationWorkflowSkillSaveController.ts')
  const retiredAgentWorkflowSaveControllerPath = path.join(root, 'src/presentation/features/conversations/conversationAgentWorkflowSaveController.ts')
  const workflowSaveControllerSource = fs.readFileSync(workflowSaveControllerPath, 'utf8')
  const controllerSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationMessageController.ts'), 'utf8')
  const controlCommandSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationControlCommand.ts'), 'utf8')
  const controlControllerSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationControlController.ts'), 'utf8')
  const bindingSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationMessageRuntimeBinding.ts'), 'utf8')
  const replyDispatchControllerSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationReplyDispatchController.ts'), 'utf8')
  const streamingIntentSource = fs.readFileSync(path.join(root, 'src/components/chat/chatStreamingIntentActions.ts'), 'utf8')
  const setupWorkspaceStateSource = fs.readFileSync(path.join(root, 'src/components/chat/chatSetupWorkspaceState.ts'), 'utf8')
  const chatPresentationSource = fs.readFileSync(path.join(root, 'src/presentation/features/chat/chatPresentationCatalog.ts'), 'utf8')
  const adapterSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationReplyStart.ts'), 'utf8')
  const workflowReplyStartSource = fs.readFileSync(path.join(root, 'src/modules/conversations/application/conversationChatWorkflowReplyStart.ts'), 'utf8')
  const vnextChatWorkflowRuntimeSource = fs.readFileSync(path.join(root, 'src/bootstrap/vnextChatWorkflowRuntime.ts'), 'utf8')
  const assistantRuntimeEntrySource = fs.readFileSync(path.join(root, 'src/modules/assistant-runtime/index.ts'), 'utf8')
  const assistantReplyBootstrapSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationAssistantReplyStartRuntime.ts'), 'utf8')
  const conversationsEntrySource = fs.readFileSync(path.join(root, 'src/modules/conversations/index.ts'), 'utf8')
  const bootstrapSource = fs.readFileSync(path.join(root, 'src/hooks/useBootstrap.ts'), 'utf8')
  const messageBubbleActionsSource = fs.readFileSync(path.join(root, 'src/components/chat/chatMessageBubbleActions.ts'), 'utf8')
  const chatRunnerPath = path.join(root, 'src/services/chatRunner.ts')

  assert.ok(actionCommandSource.includes("from 'expo-clipboard'"), 'the presentation command owns the Expo clipboard composition')
  assert.ok(actionCommandSource.includes('Clipboard.setStringAsync(text)'), 'the presentation command injects the platform clipboard write')
  assert.equal(actionControllerSource.includes("from 'expo-clipboard'"), false, 'the injected controller remains platform independent')
  assert.equal(actionControllerSource.includes('@/store/'), false, 'the final-message action does not access presentation stores')
  assert.equal(actionConfirmationControllerSource.includes('@/store/'), false, 'the injected action-confirmation controller does not access a concrete store')
  assert.equal(actionConfirmationControllerSource.includes('@/services/'), false, 'the injected action-confirmation controller does not depend on legacy services')
  assert.equal(actionConfirmationControllerSource.includes('@/bootstrap/'), false, 'the injected action-confirmation controller does not depend on bootstrap')
  assert.equal(workflowSaveControllerSource.includes('@/store/'), false, 'the injected workflow-save controller does not access a concrete store')
  assert.equal(workflowSaveControllerSource.includes('@/services/'), false, 'the injected workflow-save controller does not depend on legacy services')
  assert.equal(workflowSaveControllerSource.includes('Date.now'), false, 'workflow-save approval time stays injected')
  assert.doesNotMatch(
    workflowSaveControllerSource,
    /ConversationAgentWorkflowSave|SaveConversationAgentWorkflow|createConversationAgentWorkflowSaveController/,
    'the presentation controller exposes only Chat-neutral workflow-skill save names',
  )
  assert.doesNotMatch(
    bindingSource,
    /CONVERSATION_AGENT_WORKFLOW_SKILL_UNINITIALIZED_ERROR|saveApprovedConversationAgentWorkflowSkillRuntime|SaveAgentWorkflowSkillSuggestion/,
    'the presentation runtime binding exposes only Chat-neutral workflow-skill save names',
  )
  assert.ok(
    actionCommandSource.includes("from './conversationWorkflowSkillSaveController'"),
    'the production action command composes the presentation-owned workflow-save controller',
  )
  assert.ok(
    actionCommandSource.includes("from './conversationActionConfirmationController'"),
    'the production action command composes the presentation-owned action-confirmation controller',
  )
  assert.ok(
    actionCommandSource.includes('listToolManifests: listConversationToolManifestsRuntime'),
    'production confirmation validates against the current tool-registry source',
  )
  assert.ok(
    actionCommandSource.includes('listConversationToolManifestsRuntime') &&
      actionCommandSource.includes('resolveConversationToolRuntime'),
    'presentation confirmation reaches the neutral catalog only through its presentation-owned runtime seam',
  )
  assert.equal(actionCommandSource.includes("from '@/bootstrap/"), false, 'the presentation action command does not import bootstrap')
  assert.ok(
    actionCommandSource.includes('tool: resolveConversationToolRuntime(request, manifests)'),
    'production confirmation resolves the exact current registry tool instead of trusting manifest order',
  )
  assert.ok(
    actionCommandSource.includes('return resolveConfirmedPendingActionTool({'),
    'production confirmation re-applies pending-action identity and permission authorization to the resolved tool',
  )
  assert.ok(
    actionCommandSource.includes('return resolveWorkflowRunLimitsFromSettings(useSettingsStore.getState().settings)'),
    'production confirmation re-reads current workflow limits at restart time',
  )
  assert.ok(
    actionCommandSource.includes("from '@/modules/tasks'"),
    'production confirmation consumes the Tasks-owned workflow run-limit policy',
  )
  assert.equal(
    actionCommandSource.includes("from '@/services/agent/agentPolicy'"),
    false,
    'production confirmation does not restore the retired Agent policy facade',
  )
  assert.ok(
    actionCommandSource.includes('const result = await saveApprovedWorkflowSkillSuggestion(input)'),
    'the production action command awaits the workflow-skill persistence seam',
  )
  assert.ok(
    actionCommandSource.includes('saveApprovedConversationWorkflowSkillRuntime as saveApprovedWorkflowSkillSuggestion'),
    'presentation workflow-skill saving reaches concrete persistence only through its runtime seam',
  )
  assert.equal(actionCommandSource.includes("from '@/services/agent/agentWorkflowSkills'"), false, 'presentation cannot restore the retired workflow-skill facade')
  assert.ok(
    actionCommandSource.includes("result.status === 'saved' || result.status === 'already_saved'"),
    'the production composition maps only coherent successful persistence results into the presentation contract',
  )
  assert.ok(
    actionCommandSource.includes('return formatWorkflowSaveBlockedReason(reason, st)'),
    'blocked save results use the Chat-neutral localized formatter',
  )
  assert.ok(
    workflowActionPolicySource.includes('export function resolveConfirmedPendingActionTool') &&
      workflowActionPolicySource.includes('export function formatWorkflowSaveBlockedReason'),
    'workflow action authorization and save-reason formatting are presentation-owned',
  )
  assert.equal(
    fs.existsSync(path.join(root, 'src/services/chatAgentActionUtils.ts')),
    false,
    'the retired Agent-named action service stays deleted',
  )
  assert.ok(
    messageBubbleActionsSource.includes("from '@/presentation/features/conversations/conversationMessageActionCommand'"),
    'the message bubble imports the presentation-owned action command',
  )
  assert.ok(
    messageBubbleActionsSource.includes('copyConversationMessageFinalText(message)'),
    'the message bubble copies final text through the presentation command',
  )
  assert.ok(
    messageBubbleActionsSource.includes('saveConversationWorkflowSkillFromMessage(conversationId, message.id)'),
    'the message bubble saves workflow skills through the presentation command',
  )
  assert.ok(
    messageBubbleActionsSource.includes('confirmConversationAction(conversationId, message.id)'),
    'the message bubble confirms actions through the presentation command',
  )
  assert.equal(messageBubbleActionsSource.includes("from '@/services/chatRunner'"), false, 'message actions never import the legacy runner')
  assert.equal(actionCommandSource.includes("from '@/services/chatRunner'"), false, 'the presentation action command does not import the legacy runner')
  assert.ok(
    actionCommandSource.includes('startWorkflowReply: startConfirmedConversationWorkflowReplyRuntime'),
    'workflow confirmation restarts through the presentation-owned runtime seam',
  )
  assert.equal(
    messageBubbleActionsSource.includes('saveAgentWorkflowSkillFromMessage'),
    false,
    'the message bubble no longer imports or calls the legacy workflow-save action',
  )
  assert.doesNotMatch(
    messageBubbleActionsSource,
    /saveAgentWorkflowFromMessage|saveConversationAgentWorkflowSkillFromMessage|buildAgentWorkflowSaveConfirmOptions/,
    'the message bubble exposes only Chat-neutral workflow-skill save names',
  )
  assert.ok(
    messageBubbleActionsSource.includes("title: t('common.copyFailed'), message: t('chat.clipboardUnavailable'), tone: 'danger'"),
    'message copy rejection preserves the visible danger toast',
  )
  assert.ok(
    messageBubbleActionsSource.includes("title: t('messageBubble.confirmAgentActionFailed')"),
    'Agent confirmation rejection preserves its visible failure toast',
  )
  assert.ok(
    messageBubbleActionsSource.includes("title: t('messageBubble.saveAgentWorkflowFailed')"),
    'workflow-save rejection preserves its visible failure toast',
  )
  assert.equal(fs.existsSync(retiredAgentWorkflowSaveControllerPath), false, 'the Agent-named workflow-save controller cannot be restored')
  assert.equal(fs.existsSync(chatRunnerPath), false, 'the fully migrated chatRunner facade cannot be restored')

  assert.equal(commandSource.includes("from '@/bootstrap/"), false, 'presentation no longer imports the bootstrap composition root')
  assert.equal(commandSource.includes("from '@/services/chatRunner'"), false, 'the presentation command no longer imports the legacy runner')
  assert.equal(commandSource.includes('sendMessageAfterUserProjection'), false, 'the presentation command does not name the legacy runtime implementation')
  assert.ok(commandSource.includes("from './conversationMessageRuntimeBinding'"), 'the presentation command imports only its presentation-owned runtime seam')
  assert.ok(commandSource.includes('dispatchLegacyMessage: dispatchConversationMessageRuntime'), 'production controller wiring uses the awaitable presentation seam')
  assert.ok(commandSource.includes('getConversation(conversationId)'), 'production wiring reads the latest conversation after projection')
  assert.ok(controllerSource.includes('await dependencies.dispatchLegacyMessage({'), 'the controller awaits runtime dispatch without swallowing errors')
  assert.ok(controllerSource.includes("throw new Error('conversation_user_projection_missing')"), 'the controller fails closed when exact-once projection cannot be proven')
  assert.doesNotMatch(controllerSource, /AgentRequestedOutput|ProductInteractionMode/, 'the message controller consumes only the Tasks-owned requested-output contract')
  assert.doesNotMatch(
    controllerSource.slice(controllerSource.indexOf('await dependencies.dispatchLegacyMessage({')),
    /productMode/,
    'the projected Chat mode is persisted on the user message but never forwarded as reply authority',
  )
  assert.equal(bindingSource.includes("from '@/bootstrap/"), false, 'the presentation binding remains independent of bootstrap')
  assert.equal(bindingSource.includes("from '@/services/"), false, 'the presentation binding remains independent of legacy services')
  assert.doesNotMatch(bindingSource, /LegacyAssistantReplyStartInput|ProductInteractionMode|\bproductMode\b/, 'ordinary and confirmed presentation reply-start contracts remain mode-free')
  assert.match(bindingSource, /export type ConversationReplyRuntimeStart = \(conversationId: string\) => Promise<void>/, 'the ordinary presentation runtime accepts only conversation identity')
  assert.match(bindingSource, /await start\(conversationId\)/, 'the ordinary presentation seam forwards only conversation identity')
  assert.doesNotMatch(controlControllerSource, /LegacyAssistantReplyStartInput|ProductInteractionMode|\bproductMode\b/, 'retry and regenerate expose no historical mode input')
  assert.match(controlControllerSource, /startAssistantReplyAfterHistoryProjection\(conversationId\)[^]*?reportReplyStartFailure\('retry', error\)[^]*?startAssistantReplyAfterHistoryProjection\(conversationId\)[^]*?reportReplyStartFailure\('regenerate', error\)/, 'retry and regenerate preserve awaited one-argument startup and failure ordering')
  assert.equal(replyDispatchControllerSource.includes("from '@/bootstrap/"), false, 'the dispatch controller remains independent of bootstrap')
  assert.equal(replyDispatchControllerSource.includes("from '@/services/"), false, 'the dispatch controller remains independent of legacy services')
  assert.equal(replyDispatchControllerSource.includes("from '@/store/"), false, 'the dispatch controller remains independent of concrete stores')
  assert.doesNotMatch(replyDispatchControllerSource, /AgentRequestedOutput|ProductInteractionMode|productMode/, 'ordinary and structured reply dispatch expose no historical mode input')
  assert.equal(streamingIntentSource.includes('productMode'), false, 'active, queued, and interrupted send payloads expose no historical mode input')
  assert.doesNotMatch(setupWorkspaceStateSource, /await sendMessage\(\{[^}]*productMode/, 'setup send preserves presentation mode locally without forwarding it to reply dispatch')
  assert.match(chatPresentationSource, /ConversationChatWorkflowRuntimeRequestedOutput/, 'Chat presentation consumes the Tasks-owned requested-output contract')
  assert.doesNotMatch(adapterSource, /ProductInteractionMode|@\/modules\/workspaces|_mode|\bproductMode\b/, 'bootstrap decision-context composition is mode-free')
  assert.match(adapterSource, /import \{ startConversationAssistantReplyAfterHistoryProjection \} from ['"]@\/bootstrap\/conversationAssistantReplyStartRuntime['"]/, 'bootstrap uses the Assistant Runtime-owned ordinary reply starter')
  assert.match(conversationsEntrySource, /export \* from ['"]\.\/application\/conversationChatWorkflowReplyStart['"]/, 'the Conversations public API exports Chat workflow reply startup')
  assert.match(workflowReplyStartSource, /export function createConversationChatWorkflowReplyStarter/)
  assert.doesNotMatch(workflowReplyStartSource, /ProductInteractionMode|\bproductMode\b/, 'structured workflow startup and its ordinary fallback expose no caller-selected mode')
  assert.match(workflowReplyStartSource, /dependencies\s*\.startOrdinaryReply\(conversation\.id\)/, 'structured workflow fallback forwards only conversation identity')
  assert.doesNotMatch(workflowReplyStartSource, /@\/(?:services|bootstrap|platform|presentation|store)\//, 'the Conversations application policy has no concrete runtime dependency')
  assert.match(adapterSource, /createConversationChatWorkflowReplyStarter\(\{/)
  assert.match(adapterSource, /createChatWorkflowRuntime: createVNextChatWorkflowRuntime/, 'bootstrap starts new explicit workflows through the Chat-owned runtime')
  assert.match(adapterSource, /return runtime\.start\(\{[\s\S]*?cancellationSignal: controller\.signal/, 'bootstrap forwards the exact controller signal into the Chat workflow run')
  assert.equal(adapterSource.includes('startVNextAgentRun'), false, 'production workflow startup no longer enters the Agent parent-run controller')
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/conversationAgentReplyStart.ts')), false, 'the Agent-named workflow bootstrap facade is deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/conversations/application/conversationAgentReplyStart.ts')), false, 'the Agent-named Conversations starter is deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/presentation/features/conversations/conversationAgentActionConfirmationController.ts')), false, 'the Agent-named confirmation controller is deleted')
  assert.match(vnextChatWorkflowRuntimeSource, /export function createVNextChatWorkflowRuntime/)
  assert.match(vnextChatWorkflowRuntimeSource, /createAssistantChatWorkflowRunRuntime\(\{/)
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/vnextAgentRuntime.ts')), false, 'the Agent-named workflow bootstrap is deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/presentation/features/conversations/vnextAgentRunCommand.ts')), false, 'the Agent-only recovery command is deleted')
  assert.match(assistantRuntimeEntrySource, /export \* from ['"]\.\/application\/assistantChatWorkflowRunRuntime['"]/, 'Assistant Runtime publicly exports the Chat workflow use case')
  assert.match(adapterSource, /startOrdinaryReply: startConversationAssistantReplyAfterHistoryProjection/, 'workflow fallback uses the target ordinary reply starter')
  assert.match(assistantReplyBootstrapSource, /createAssistantConversationReplyStartRuntime\(\{[\s\S]*?conversationAssistantReplySessionRuntime[\s\S]*?conversationAssistantProviderAdmissionRuntime[\s\S]*?conversationAssistantDurableExecutionRuntime/, 'bootstrap composes reply startup through the durable Chat execution runtime')
  assert.doesNotMatch(assistantReplyBootstrapSource, /ProductInteractionMode|@\/modules\/workspaces|\bproductMode\b/, 'ordinary reply bootstrap accepts and forwards no caller-selected mode')
  assert.match(assistantReplyBootstrapSource, /startConversationAssistantReplyAfterHistoryProjection\(\s*conversationId: string,?\s*\)[^]*?\.start\(\{\s*conversationId,?\s*\}\)/, 'ordinary reply bootstrap forwards only conversation identity to Assistant Runtime')
  assert.ok(adapterSource.includes("from '@/presentation/features/conversations/conversationReplyDispatchController'"), 'bootstrap composes the presentation-owned post-user dispatch controller')
  assert.equal(
    (adapterSource.match(/bindConversationMessageRuntime\(conversationMessageRuntime\)/g) ?? []).length,
    1,
    'bootstrap installs one combined presentation runtime exactly once',
  )
  const initializerSource = adapterSource.slice(adapterSource.indexOf('export function initializeConversationReplyStart'))
  const initializerGuardIndex = initializerSource.indexOf('if (conversationReplyStartInitialized) return')
  const streamBindingIndex = initializerSource.indexOf('registerStreamAborter(stopConversationMessage)')
  const reviewBindingIndex = initializerSource.indexOf('bindChatWorkspaceReviewRuntime(chatWorkspaceReviewRuntimeResolver)')
  const messageBindingIndex = initializerSource.indexOf('bindConversationMessageRuntime(conversationMessageRuntime)')
  const initializationCompleteIndex = initializerSource.indexOf('conversationReplyStartInitialized = true')
  assert.ok(
    adapterSource.indexOf('let conversationReplyStartInitialized = false') < adapterSource.indexOf('export function initializeConversationReplyStart'),
    'bootstrap owns the initializer idempotency state outside the startup function',
  )
  assert.ok(
    initializerGuardIndex >= 0
      && initializerGuardIndex < streamBindingIndex
      && streamBindingIndex < reviewBindingIndex
      && reviewBindingIndex < messageBindingIndex
      && messageBindingIndex < initializationCompleteIndex,
    'repeated startup returns before stream, review, or message rebinding and marks completion only after every binding succeeds',
  )
  assert.ok(adapterSource.includes('dispatchAfterUserProjection: conversationReplyDispatchController.dispatch'), 'bootstrap composes post-user dispatch into the installed runtime')
  assert.ok(adapterSource.includes('startAfterHistoryProjection: startConversationAssistantReplyAfterHistoryProjection'), 'bootstrap composes the target reply starter into the installed runtime')
  assert.ok(adapterSource.includes('startConfirmedWorkflowReply: startConversationChatWorkflowReply'), 'bootstrap composes confirmed workflow startup into the installed runtime')
  assert.ok(adapterSource.includes('async resumePendingModelOperation(conversationId, assistantMessageId, runId, approved)'), 'bootstrap composes same-run model-operation resume into the installed runtime')
  assert.ok(adapterSource.includes('listConversationToolManifests,'), 'bootstrap composes the neutral tool catalog into the installed runtime')
  assert.ok(
    adapterSource.includes('saveApprovedWorkflowSkillSuggestion,'),
    'bootstrap imports the Chat-neutral Task-owned workflow persistence function directly',
  )
  assert.match(
    adapterSource,
    /\n\s{2}saveApprovedWorkflowSkillSuggestion,\r?\n/,
    'bootstrap composes only the Chat-neutral workflow persistence field into the installed runtime',
  )
  assert.match(
    adapterSource,
    /metroHotModule\?\.hot\?\.dispose\(\(\) => \{\s*releaseChatWorkspaceReviewRuntime\(chatWorkspaceReviewRuntimeResolver\)\s*releaseConversationMessageRuntime\(conversationMessageRuntime\)/,
    'Fast Refresh releases only the exact review and message runtime identities installed by the disposed bootstrap module',
  )
  assert.equal(adapterSource.includes('sendMessageAfterUserProjection'), false, 'bootstrap cannot restore the retired post-user service dispatcher')
  assert.equal(adapterSource.includes("@/services/chatRunner"), false, 'bootstrap never imports the deleted Chat facade')
  assert.equal(/bindConversationMessageRuntime\(sendMessage\)/.test(adapterSource), false, 'bootstrap never binds the deleted legacy sendMessage entry point')
  assert.ok(
    controlCommandSource.includes('startAssistantReplyAfterHistoryProjection: startConversationReplyAfterHistoryProjectionRuntime'),
    'retry and regenerate use the combined presentation runtime seam',
  )
  assert.equal(controlCommandSource.includes('bindConversationControlReplyStarter'), false, 'the duplicate control binding is deleted')
  assert.equal(controlCommandSource.includes('conversation_reply_starter_not_bound'), false, 'the combined binding is the sole owner of the stable uninitialized error')

  const runtimeInstallers = [
    ...listSourceFiles(path.join(root, 'src')),
    ...listSourceFiles(path.join(root, 'app')),
  ]
    .filter((file) => /\.(?:ts|tsx)$/.test(file))
    .filter((file) => !file.endsWith(path.join('conversations', 'conversationMessageRuntimeBinding.ts')))
    .flatMap((file) => {
      const matches = fs.readFileSync(file, 'utf8').match(/bindConversationMessageRuntime\s*\(/g) ?? []
      return matches.map(() => path.relative(root, file).replaceAll('\\', '/'))
    })
  assert.deepEqual(
    runtimeInstallers,
    ['src/bootstrap/conversationReplyStart.ts'],
    'bootstrap remains the sole production installer of the combined runtime',
  )

  const initializationIndex = bootstrapSource.indexOf('initializeConversationReplyStart()')
  const runRecoveryIndex = bootstrapSource.indexOf('await recoverVNextChatRuns')
  const checkpointRecoveryIndex = bootstrapSource.indexOf('await recoverVNextWorkflowCheckpoints')
  const workspaceReceiptRecoveryIndex = bootstrapSource.indexOf('await recoverConversationWorkspaceWritebackReceipts')
  const taskRecoveryIndex = bootstrapSource.indexOf('await recoverVNextInterruptedTasks')
  const readyIndex = bootstrapSource.indexOf('ready: true')
  const deferredRecoveryDispatchIndex = bootstrapSource.indexOf('void recoverDeferredRuntimeState()')
  assert.ok(initializationIndex >= 0, 'application startup explicitly initializes the conversation runtime binding')
  assert.ok(runRecoveryIndex < checkpointRecoveryIndex, 'Chat run recovery precedes exact-run workflow checkpoint reconciliation')
  assert.ok(checkpointRecoveryIndex < workspaceReceiptRecoveryIndex, 'workflow checkpoint dispositions are recovered before workspace receipt reconciliation')
  assert.ok(workspaceReceiptRecoveryIndex < taskRecoveryIndex, 'workspace receipt reconciliation precedes passive durable task recovery')
  assert.match(
    bootstrapSource,
    /recoverVNextWorkflowCheckpoints\(\s*recoveredRuns\.map\(\(run\) => run\.id\),\s*\{ signal: recoveryController\.signal \},\s*\)/,
    'startup forwards only the exact recovered Chat run identities and recovery signal to checkpoint reconciliation',
  )
  assert.ok(initializationIndex < readyIndex, 'runtime binding initializes before the app becomes ready')
  assert.ok(deferredRecoveryDispatchIndex > readyIndex, 'non-blocking runtime recovery is dispatched after the app becomes ready')
  assert.equal(bootstrapSource.includes('recoverVNextAgentRuns'), false, 'startup has no separate Agent recovery pass')

  const structuredGateIndex = replyDispatchControllerSource.indexOf('const startsStructuredWorkflow')
  const replyIndex = replyDispatchControllerSource.indexOf('void dependencies.startAssistantReply', structuredGateIndex)
  const workflowIndex = replyDispatchControllerSource.indexOf('void dependencies.startWorkflowReply', replyIndex)
  assert.ok(structuredGateIndex >= 0 && replyIndex > structuredGateIndex && workflowIndex > replyIndex, 'presentation dispatch sends typed text to Assistant Runtime before the explicit structured Chat workflow lane')
  assert.equal(replyDispatchControllerSource.includes('decideAgentReply'), false, 'presentation dispatch has no local Agent intent authority')
  assert.equal(fs.existsSync(chatRunnerPath), false, 'the deleted Chat facade stays absent after target bootstrap composition')
}

function listSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listSourceFiles(entryPath) : [entryPath]
  })
}

function createFixture(commandModule, options = {}) {
  const messages = []
  const errors = []
  const legacyInputs = []
  const events = []
  const ids = ['message-1', 'message-2', 'message-3']
  let now = 100
  const runtimeConversationBase = options.runtimeConversation ?? createConversation()

  const command = commandModule.createConversationMessageController({
    buildEstimatedUsage(inputMessages, outputText) {
      return {
        inputTokens: inputMessages.length * 2,
        outputTokens: outputText.length,
        totalTokens: inputMessages.length * 2 + outputText.length,
        source: 'estimated',
      }
    },
    createMessageId() {
      return ids.shift() ?? 'message-overflow'
    },
    async dispatchLegacyMessage(input) {
      events.push('dispatch')
      legacyInputs.push(input)
      await options.dispatchLegacyMessage?.(input)
    },
    estimateTextTokens(text) {
      return text.length
    },
    normalizeContent(content) {
      return content.replace(/%20/g, ' ').trim()
    },
    now() {
      return now++
    },
    store: {
      setError(error) {
        events.push(`error:${String(error)}`)
        errors.push(error)
      },
      addMessage(conversationId, message) {
        events.push(`add:${message.id}`)
        messages.push({ conversationId, message })
        return options.addMessageDurability?.({ conversationId, message })
      },
      getConversation(conversationId) {
        events.push(`get:${conversationId}`)
        const projectedMessages = messages
          .filter((entry) => entry.conversationId === conversationId)
          .map((entry) => entry.message)
        if (options.getConversation) {
          return options.getConversation({ conversationId, projectedMessages })
        }
        return {
          ...runtimeConversationBase,
          id: conversationId,
          messages: [...runtimeConversationBase.messages, ...projectedMessages],
        }
      },
    },
  })

  return {
    command,
    errors,
    events,
    legacyInputs,
    messages,
  }
}

function createConversation() {
  return {
    id: 'conversation-1',
    title: '',
    providerId: 'provider-1',
    model: 'model-1',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 1024,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeout
  const timedOut = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  return Promise.race([promise, timedOut]).finally(() => clearTimeout(timeout))
}

withTimeout(
  main(),
  30_000,
  'vNext conversation message-command tests did not settle.',
).catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
