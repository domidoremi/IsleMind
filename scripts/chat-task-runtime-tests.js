const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  CONVERSATION_TASK_ACTIVITY_ACTIVE_STALE_MS,
  CONVERSATION_TASK_ACTIVITY_EVENT_SCHEMA,
  CONVERSATION_TASK_ACTIVITY_HISTORY_LIMIT,
  bindConversationTaskActivityCancellation,
  clearConversationTaskActivitiesForTest,
  finishConversationTaskActivity,
  finishConversationTaskActivityForMessage,
  listConversationTaskActivities,
  projectConversationTaskStatus,
  requestConversationTaskActivityCancellation,
  startConversationTaskActivity,
  subscribeConversationTaskActivities,
  sweepStaleConversationTaskActivities,
} = require('../src/modules/tasks/index.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isConversationTaskActivityRuntimeHook) return

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
  hook.isConversationTaskActivityRuntimeHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const conversationTaskCardKeys = [
  'taskCardTitle',
  'taskCardAccessibilityLabel',
  'taskCardRunning',
  'taskCardQueued',
  'taskCardProgress',
  'taskCardCount',
  'taskCardCancel',
  'taskCardCancelHint',
  'taskCardEvidence',
  'taskCardChecks',
  'taskCardArtifactReady',
  'taskCardActionPending',
  'taskCardEvidenceNeeded',
  'taskCardRepairEvidence',
  'taskCardRepairEvidenceHint',
  'taskCardConfirmAction',
  'taskCardConfirmActionHint',
]

async function run() {
  runConversationTaskStatusProjectionTests()
  clearConversationTaskActivitiesForTest()

  const events = []
  const unsubscribeThrowing = subscribeConversationTaskActivities(() => {
    throw new Error('observational subscriber failure')
  })
  const unsubscribe = subscribeConversationTaskActivities((event) => events.push(event))

  const chatTurn = startConversationTaskActivity({
    conversationId: 'chat-conv',
    messageId: 'chat-msg',
  }, 1000)
  const workflow = startConversationTaskActivity({
    kind: 'chat-workflow',
    conversationId: 'workflow-conv',
    messageId: 'workflow-msg',
    progress: 1.5,
    metadata: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`key-${index}`, index])),
  }, 1100)
  const queued = startConversationTaskActivity({
    status: 'queued',
    conversationId: 'queued-conv',
    messageId: 'queued-msg',
    progress: -1,
  }, 1200)

  assert.equal(chatTurn.kind, 'chat-turn', 'Chat activity defaults to chat-turn')
  assert.equal(workflow.kind, 'chat-workflow', 'structured work uses the only other Chat activity kind')
  assert.equal('mode' in chatTurn, false, 'Chat activity records carry no historical product mode')
  assert.equal('queue' in chatTurn, false, 'Chat activity records do not claim scheduling authority')
  assert.equal('lowDisruption' in chatTurn, false, 'Chat activity records carry no Tavern presentation policy')
  assert.equal(workflow.progress, 1, 'activity progress is clamped at the upper bound')
  assert.equal(queued.progress, 0, 'activity progress is clamped at the lower bound')
  assert.equal(Object.keys(workflow.metadata).length, 24, 'activity metadata is bounded')
  assert.deepEqual(
    listConversationTaskActivities(1200).map((activity) => activity.id),
    [queued.id, workflow.id, chatTurn.id],
    'activity reads preserve newest-updated-first ordering',
  )

  let durableCancellationCalls = 0
  const cancellationBindingInput = {
    conversationId: workflow.conversationId,
    messageId: workflow.messageId,
    assistantRunId: 'assistant-run-workflow-fixture',
    async requestCancellation() {
      durableCancellationCalls += 1
      return 'cancelled'
    },
  }
  const cancellationBindingInputBefore = JSON.stringify(cancellationBindingInput)
  const releaseCancellation = bindConversationTaskActivityCancellation(cancellationBindingInput)
  const cancellationRequest = Object.freeze({
    activityId: workflow.id,
    conversationId: workflow.conversationId,
    messageId: workflow.messageId,
  })
  const [firstCancellation, repeatedCancellation] = await Promise.all([
    requestConversationTaskActivityCancellation(cancellationRequest),
    requestConversationTaskActivityCancellation(cancellationRequest),
  ])
  assert.equal(firstCancellation.status, 'cancelled', 'bound Chat activity cancellation reaches durable run authority')
  assert.equal(firstCancellation.assistantRunId, 'assistant-run-workflow-fixture', 'cancellation result preserves exact durable Chat run identity')
  assert.equal(firstCancellation, repeatedCancellation, 'concurrent task-card cancellation shares one authoritative request')
  assert.equal(durableCancellationCalls, 1, 'concurrent task-card cancellation invokes durable authority once')
  assert.equal(Object.isFrozen(firstCancellation), true, 'task cancellation result is immutable')
  assert.equal(JSON.stringify(cancellationBindingInput), cancellationBindingInputBefore, 'cancellation binding does not mutate caller-owned input')
  assert.equal(Object.isFrozen(cancellationBindingInput), false, 'cancellation binding does not freeze the caller-owned wrapper')
  const mismatchedCancellation = await requestConversationTaskActivityCancellation({
    activityId: workflow.id,
    conversationId: 'another-conversation',
    messageId: workflow.messageId,
  })
  assert.equal(mismatchedCancellation.status, 'unavailable', 'cancellation identity drift fails before durable authority')
  assert.equal(durableCancellationCalls, 1, 'identity drift performs no durable cancellation work')
  releaseCancellation()

  const done = finishConversationTaskActivityForMessage(
    'chat-conv',
    'chat-msg',
    'done',
    { metadata: { source: 'test' } },
    1300,
  )
  const failed = finishConversationTaskActivity(workflow.id, 'failed', { error: 'workflow failed' }, 1400)
  finishConversationTaskActivity(queued.id, 'cancelled', { metadata: { reason: 'user_stopped' } }, 1500)

  assert.equal(done?.progress, 1, 'successful activity completion reports full progress')
  assert.equal(failed?.error, 'workflow failed', 'failed activity records its bounded error')
  assert.equal(
    finishConversationTaskActivity(workflow.id, 'done', {}, 1600),
    failed,
    'terminal activity completion is idempotent and preserves the first terminal record',
  )
  assert.ok(events.every((event) => event.schema === CONVERSATION_TASK_ACTIVITY_EVENT_SCHEMA), 'task bus emits versioned Chat activity events')
  assert.deepEqual(events.map((event) => event.type), ['started', 'started', 'started', 'finished', 'finished', 'finished'], 'task bus emits lifecycle events')

  unsubscribeThrowing()
  unsubscribe()

  clearConversationTaskActivitiesForTest()
  const staleEvents = []
  const unsubscribeStale = subscribeConversationTaskActivities((event) => staleEvents.push(event))
  const stale = startConversationTaskActivity({ conversationId: 'stale-conv', messageId: 'stale-msg' }, 2000)
  const expiredCount = sweepStaleConversationTaskActivities(2000 + CONVERSATION_TASK_ACTIVITY_ACTIVE_STALE_MS + 1)
  assert.equal(expiredCount, 1, 'stale active tasks are expired to bound runtime memory')
  const staleRecord = listConversationTaskActivities(2000 + CONVERSATION_TASK_ACTIVITY_ACTIVE_STALE_MS + 1).find((task) => task.id === stale.id)
  assert.equal(staleRecord?.status, 'failed', 'stale active task is moved to terminal state')
  assert.equal(staleRecord?.metadata?.reason, 'stale_task_expired', 'stale task records cleanup reason')
  assert.deepEqual(staleEvents.map((event) => event.type), ['started', 'finished'], 'stale cleanup emits a finished event')
  unsubscribeStale()

  clearConversationTaskActivitiesForTest()
  startConversationTaskActivity({ conversationId: 'idle-conv', messageId: 'idle-msg' }, 4000)
  const idleActivities = listConversationTaskActivities(4000 + CONVERSATION_TASK_ACTIVITY_ACTIVE_STALE_MS + 1)
  assert.equal(idleActivities[0].status, 'failed', 'activity reads sweep stale active work without a new start')
  assert.equal(idleActivities[0].metadata?.reason, 'stale_task_expired', 'activity reads preserve stale cleanup evidence')

  clearConversationTaskActivitiesForTest()
  for (let index = 0; index < CONVERSATION_TASK_ACTIVITY_HISTORY_LIMIT + 5; index += 1) {
    const activity = startConversationTaskActivity({
      conversationId: `history-conv-${index}`,
      messageId: `history-msg-${index}`,
    }, 5000 + index * 2)
    finishConversationTaskActivity(activity.id, 'done', {}, 5001 + index * 2)
  }
  assert.equal(
    listConversationTaskActivities(6000).length,
    CONVERSATION_TASK_ACTIVITY_HISTORY_LIMIT,
    'terminal activity history is bounded without evicting active work',
  )

  const legacyChatRunnerPath = path.join(root, 'src/services/chatRunner.ts')
  const conversationAssistantReplySessionSource = read('src/bootstrap/conversationAssistantReplySessionRuntime.ts')
  const conversationAssistantProjectionSource = read('src/bootstrap/conversationAssistantMessageProjection.ts')
  const conversationWorkflowReplySource = read('src/modules/conversations/application/conversationChatWorkflowReplyStart.ts')
  const conversationControlSource = read('src/presentation/features/conversations/conversationControlCommand.ts')
  assert.ok(conversationAssistantReplySessionSource.includes('startConversationTaskActivity'), 'bootstrap-composed reply sessions start Chat activity lifecycle records')
  assert.ok(conversationAssistantProjectionSource.includes('finishConversationTaskActivityForMessage'), 'bootstrap-composed terminal projection finishes Chat activity by assistant message')
  assert.equal(fs.existsSync(legacyChatRunnerPath), false, 'the deleted Chat facade cannot restore task-activity startup or terminal projection')
  assert.ok(conversationControlSource.includes('finishConversationTaskActivityForMessage'), 'conversation control owns linked Chat activity cancellation')
  assert.ok(conversationControlSource.includes('metadata: { reason }'), 'conversation control records the exact stop or recovery reason')
  assert.ok(conversationWorkflowReplySource.includes("reason: 'delegated_to_chat_reply'"), 'workflow-to-ordinary-Chat delegation does not leak active tasks')
  assert.ok(conversationWorkflowReplySource.includes('startConversationTaskActivity'), 'structured Chat workflow starts the same activity contract')
  assert.ok(conversationWorkflowReplySource.includes('bindConversationTaskCancellation'), 'structured Chat workflow binds task-card cancellation to the exact durable Chat run')
  assert.ok(conversationWorkflowReplySource.includes('runtime.cancel(handle.runId)'), 'structured Chat workflow cancellation calls the same live durable runtime')
  assert.ok(conversationWorkflowReplySource.includes('finishConversationTaskActivity'), 'structured Chat workflow terminalizes the same activity contract')
  assert.equal(/\b(?:start|finish)ModeTask\b/.test(conversationWorkflowReplySource), false, 'Conversations does not retain mode-task dependency names')

  const mainPagerSource = read('src/components/main/MainPagerShell.tsx')
  assert.equal(mainPagerSource.includes('subscribeProductModeTasks'), false, 'Chat shell does not restore a cross-mode task switcher')
  assert.equal(mainPagerSource.includes('getProductModeTaskSnapshot'), false, 'Chat shell does not query a cross-mode task badge')
  assert.equal(mainPagerSource.includes('topBarModeTaskBadge'), false, 'Chat shell keeps task status inside the conversation surface')

  const activeStatusLayerSource = read('src/components/chat/ChatActiveStatusLayer.tsx')
  const activeControllersSource = read('src/components/chat/chatActiveWorkspaceControllers.ts')
  const conversationTaskStateSource = read('src/components/chat/conversationTaskState.ts')
  const taskActivityRuntimeSource = read('src/modules/tasks/application/conversationTaskActivityRuntime.ts')
  const tasksPublicApiSource = read('src/modules/tasks/index.ts')
  assert.ok(taskActivityRuntimeSource.includes("kind: input.kind ?? 'chat-turn'"), 'omitted activity kind is Chat-owned')
  assert.equal(/ProductInteractionMode|ProductModeTask|getProductModeRuntimePolicy|lowDisruption|taskQueue/.test(taskActivityRuntimeSource), false, 'Tasks activity runtime has no ProductMode policy dependency')
  assert.ok(tasksPublicApiSource.includes("export * from './application/conversationTaskActivityRuntime'"), 'Tasks publicly exports the Chat activity runtime')
  assert.equal(fs.existsSync(path.join(root, 'src/product/modeTaskRuntime.ts')), false, 'the cross-layer ProductMode task registry stays deleted')
  assert.ok(activeStatusLayerSource.includes('ConversationTaskStatusCard'), 'the active status layer renders the Chat conversation task card surface')
  assert.ok(activeControllersSource.includes("from './conversationTaskState'"), 'the active workspace controller delegates conversation task state to the extracted helper')
  assert.ok(conversationTaskStateSource.includes('subscribeConversationTaskActivities'), 'Chat task card subscribes to target activity updates')
  assert.ok(conversationTaskStateSource.includes('listConversationTaskActivities()'), 'Chat task card observes all realm-local Chat activity records')
  assert.ok(conversationTaskStateSource.includes('projectConversationTaskStatus'), 'Chat task card delegates conversation-bound active-work selection to Tasks')
  assert.ok(conversationTaskStateSource.includes('conversationId: conversation.id'), 'Chat task card selects task records by exact conversation identity')
  assert.ok(conversationTaskStateSource.includes("activeConversationTasks.find((task) => task.kind === 'chat-workflow')"), 'ordinary Chat replies stay in the message stream instead of opening a duplicate floating task card')
  assert.equal(conversationTaskStateSource.includes('ProductInteractionMode'), false, 'Chat task state does not depend on a legacy product-mode input')
  assert.ok(activeControllersSource.includes('useConversationTaskStatus({ conversation: activeConversation })'), 'Chat active workspace selects tasks by conversation only')
  assert.equal(conversationTaskStateSource.includes("productMode === 'agent' ? activeConversationTasks[0] : undefined"), false, 'Chat task card is not restricted to a removed Agent-only surface')
  assert.ok(conversationTaskStateSource.includes('finishConversationTaskActivity'), 'Chat task card can terminalize non-streaming observational activity records')
  assert.ok(conversationTaskStateSource.includes('requestConversationTaskActivityCancellation'), 'Chat task card queries target cancellation authority before terminalizing non-streaming work')
  assert.ok(conversationTaskStateSource.includes("metadata: { reason: 'user_stopped' }"), 'Chat task card records user-driven cancellation')
  assert.ok(conversationTaskStateSource.includes('stopStreaming(conversation.id)'), 'Chat task card stops linked streaming messages')
  assert.equal(fs.existsSync(path.join(root, 'src/components/chat/productModeTaskState.ts')), false, 'the legacy ProductMode task-state helper stays deleted')
  const taskCardSource = read('src/components/chat/ConversationTaskStatusCard.tsx')
  const messageActionSelectorsSource = read('src/presentation/features/conversations/workflowMessageActionSelectors.ts')
  const messageActionPolicySource = read('src/modules/tasks/application/workflowMessageActionPolicy.ts')
  const legacyMessageAdapterPath = path.join(root, 'src/services/agent/agentMessageAdapter.ts')
  const workflowTaskEvidenceSource = read('src/components/chat/workflowTaskEvidence.ts')
  assert.ok(taskCardSource.includes('collectVisibleProcessTraces'), 'Agent task card reads visible trace evidence')
  assert.ok(taskCardSource.includes('getActiveTraceTitle'), 'Agent task card surfaces active trace titles')
  assert.ok(taskCardSource.includes('getActiveTraceStageLabel'), 'Agent task card surfaces active trace stage labels')
  assert.ok(taskCardSource.includes('summarizeWorkflowTaskEvidence'), 'Chat task card summarizes trace evidence into visible chips')
  assert.ok(workflowTaskEvidenceSource.includes('readTraceNonNegativeNumber'), 'workflow evidence summary reads bounded numeric trace metadata')
  assert.ok(taskCardSource.includes('evidenceCount'), 'Chat task card reads evidence counts from traces')
  assert.ok(workflowTaskEvidenceSource.includes('sourceEvidenceCount'), 'Chat task card reads source evidence counts from work artifacts')
  assert.ok(taskCardSource.includes('acceptanceCheckCount'), 'Chat task card reads acceptance check counts from workflow plans')
  assert.ok(workflowTaskEvidenceSource.includes('workArtifactOutput'), 'Chat task card detects work artifact readiness')
  assert.ok(taskCardSource.includes('WorkflowTaskEvidenceChip'), 'Chat task card renders evidence/check/artifact chips')
  assert.ok(taskCardSource.includes('showEvidenceRow'), 'Chat task card renders its evidence row only when real evidence or an action is available')
  for (const removedPlaceholderKey of ['taskCardTracePending', 'taskCardEvidencePending', 'taskCardChecksPending', 'taskCardArtifactPending']) {
    assert.equal(taskCardSource.includes(removedPlaceholderKey), false, `Chat task card does not restore speculative ${removedPlaceholderKey} copy`)
  }
  assert.ok(taskCardSource.includes('getWorkflowPendingActionFromMessage'), 'Chat task card detects pending workflow actions')
  assert.ok(taskCardSource.includes('getWorkflowEvidenceRepairActionFromMessage'), 'Chat task card detects workflow evidence repair needs')
  assert.ok(taskCardSource.includes("from '@/presentation/features/conversations/workflowMessageActionSelectors'"), 'Chat task card consumes the presentation-owned workflow action-selector binding')
  assert.ok(messageActionSelectorsSource.includes('createWorkflowMessageActionPolicy'), 'presentation binds the Tasks-owned workflow message-action policy')
  assert.ok(messageActionSelectorsSource.includes('redactSensitiveText'), 'presentation retains the existing visible trace redactor')
  assert.ok(messageActionPolicySource.includes('getWorkflowPendingActionFromMessage(message'), 'Tasks owns pending-action selection')
  assert.ok(messageActionPolicySource.includes('getWorkflowEvidenceRepairActionFromMessage(message'), 'Tasks owns evidence-repair selection')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/tasks/application/agentMessageActionPolicy.ts')), false, 'retired Agent message-action policy stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/presentation/features/conversations/agentMessageActionSelectors.ts')), false, 'retired Agent message-action selector stays deleted')
  assert.equal(fs.existsSync(legacyMessageAdapterPath), false, 'retired Agent message adapter stays deleted')
  assert.ok(taskCardSource.includes('taskCardActionPending'), 'Agent task card labels pending permission/action state')
  assert.ok(taskCardSource.includes('taskCardEvidenceNeeded'), 'Agent task card labels evidence repair state')
  assert.ok(taskCardSource.includes('danger'), 'Agent action/evidence chips use warning emphasis')
  assert.ok(activeStatusLayerSource.includes('repairAgentEvidenceFromMessage'), 'Agent task card reuses the safe evidence repair draft handler')
  assert.ok(activeStatusLayerSource.includes('confirmActionFromMessage'), 'task card reuses the shared confirmation gate')
  assert.ok(taskCardSource.includes('pendingWorkflowAction?.confirmable'), 'Chat task card only confirms confirmable pending workflow actions')
  assert.ok(taskCardSource.includes('pendingWorkflowAction.resumeToolRequest'), 'Chat task card requires a resumable workflow tool request before confirming')
  assert.ok(taskCardSource.includes('onRepairAgentEvidence?.(message)'), 'Agent task card warning chip can insert the repair prompt')
  assert.ok(taskCardSource.includes('onConfirmAction?.(message)'), 'Agent task card warning chip can confirm via the shared handler')
  for (const key of conversationTaskCardKeys) {
    assert.ok(taskCardSource.includes(`chat.${key}`), `Chat task card renders localized ${key}`)
  }

  for (const locale of ['en', 'zh-CN', 'ja']) {
    const resource = JSON.parse(read(`src/i18n/resources/${locale}.json`))
    for (const key of conversationTaskCardKeys) {
      assert.equal(typeof resource.chat[key], 'string', `${locale} localizes Chat task card ${key}`)
    }
    assert.ok(resource.chat.taskCardProgress.includes('{{percent}}'), `${locale} Chat progress copy keeps percent interpolation`)
    assert.ok(resource.chat.taskCardCount.includes('{{count}}'), `${locale} Chat count copy keeps count interpolation`)
    assert.ok(resource.chat.taskCardEvidence.includes('{{count}}'), `${locale} Chat evidence copy keeps count interpolation`)
    assert.ok(resource.chat.taskCardChecks.includes('{{count}}'), `${locale} Chat checks copy keeps count interpolation`)
  }

  console.log('Conversation task activity runtime tests passed')
}

function runConversationTaskStatusProjectionTests() {
  const first = Object.freeze({
    id: 'task-chat-workflow',
    mode: 'chat',
    kind: 'chat-workflow',
    status: 'running',
    conversationId: 'conversation-chat',
    metadata: Object.freeze({ requestedOutput: 'reply' }),
  })
  const second = Object.freeze({
    id: 'task-chat-turn',
    mode: 'chat',
    kind: 'chat-turn',
    status: 'queued',
    conversationId: 'conversation-chat',
  })
  const awaitingConfirmation = Object.freeze({
    id: 'task-capability-confirmation',
    mode: 'chat',
    kind: 'built-in-capability',
    status: 'awaiting-confirmation',
    conversationId: 'conversation-chat',
  })
  const legacyTavern = Object.freeze({
    id: 'task-legacy-tavern-turn',
    mode: 'companion',
    kind: 'tavern-turn',
    status: 'running',
    conversationId: 'conversation-chat',
  })
  const tasks = Object.freeze([
    first,
    Object.freeze({
      id: 'task-other-conversation',
      mode: 'agent',
      kind: 'agent-run',
      status: 'running',
      conversationId: 'conversation-other',
    }),
    Object.freeze({
      id: 'task-unscoped',
      mode: 'agent',
      kind: 'agent-run',
      status: 'running',
    }),
    Object.freeze({
      id: 'task-terminal',
      mode: 'agent',
      kind: 'agent-run',
      status: 'done',
      conversationId: 'conversation-chat',
    }),
    second,
    awaitingConfirmation,
    legacyTavern,
  ])

  const projection = projectConversationTaskStatus({
    conversationId: 'conversation-chat',
    tasks,
  })
  assert.deepEqual(
    projection.activeTasks,
    [first, second, awaitingConfirmation, legacyTavern],
    'Chat selects every active conversation task regardless of kind or legacy mode metadata',
  )
  assert.equal(projection.primaryTask, first, 'Chat preserves task order and record identity for its primary active status')
  assert.equal(projection.primaryTask.mode, 'chat', 'Chat keeps task-owned mode metadata instead of rewriting it')
  assert.equal(tasks.length, 7, 'conversation task projection does not mutate the source task list')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
