const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

async function main() {
  const core = await import('../src/core/index.ts')
  const runtimeModule = await import('../src/modules/assistant-runtime/index.ts')
  const runStoreModule = await import('../src/modules/assistant-runtime/testing/inMemoryRunStore.ts')
  const providerModule = await import('../src/modules/providers/index.ts')
  const knowledgeModule = await import('../src/modules/knowledge/index.ts')
  const taskModule = await import('../src/modules/tasks/index.ts')
  const taskStoreModule = await import('../src/modules/tasks/testing/inMemoryTaskStore.ts')

  await testChatWorkflowRunCreatesDurableChatParentAndLinkedTask({
    core,
    runtimeModule,
    runStoreModule,
    providerModule,
    knowledgeModule,
    taskModule,
    taskStoreModule,
  })
  await testChatWorkflowRunCancellation({
    runtimeModule,
    runStoreModule,
    providerModule,
    knowledgeModule,
    taskModule,
  })
  await testChatWorkflowContextFailureDoesNotStartActivity({
    core,
    runtimeModule,
  })
  await testHistoricalAgentRunRejectedBeforeMutation({
    core,
    runStoreModule,
  })
  testUnifiedRecoveryContractHasNoKindSelector()
  await testWorkflowCheckpointLifecycle({ core, taskModule })
  testWorkflowCheckpointMetadataBoundary({ core, taskModule })
  testWorkflowRuntimePolicy(taskModule)
  testWorkflowContinuationPolicy(taskModule)
  testWorkflowIntentClassifier(taskModule)
  testWorkflowPlanner(taskModule)
  await testWorkflowStepExecutor(taskModule)
  await testWorkflowCheckpointProjection({ core, taskModule })
  await testWorkflowCheckpointPersistenceFailure({ core, taskModule })
  await testCheckpointFailureFailsParentChatWorkflowRun({
    core,
    runtimeModule,
    runStoreModule,
    providerModule,
    knowledgeModule,
    taskModule,
  })

  console.log('Workflow-run integration tests passed')
}

function testUnifiedRecoveryContractHasNoKindSelector() {
  const contractsSource = fs.readFileSync(
    path.join(root, 'src/modules/assistant-runtime/contracts.ts'),
    'utf8',
  )
  const runtimeSource = fs.readFileSync(
    path.join(root, 'src/modules/assistant-runtime/runtime.ts'),
    'utf8',
  )

  assert.match(
    contractsSource,
    /recoverInterruptedRuns\(\): Promise<Result<readonly AssistantRun\[\], 'persistence_failed'>>/,
    'Assistant Runtime exposes one parameterless recovery pass',
  )
  assert.doesNotMatch(
    contractsSource,
    /RecoverAssistantRunsOptions|recoverInterruptedRuns\(options/,
    'the public recovery contract cannot restore a run-kind selector',
  )
  assert.match(
    runtimeSource,
    /async recoverInterruptedRuns\(\) \{/,
    'the runtime implements one parameterless recovery pass',
  )
  assert.doesNotMatch(
    runtimeSource,
    /requestedKinds|options\.kinds|recoverInterruptedRuns\(options/,
    'runtime recovery cannot skip persisted work by historical run kind',
  )
}

function testWorkflowContinuationPolicy(taskModule) {
  let now = 710
  const redactText = (value) => String(value).replaceAll('private-value', '[redacted]')
  const policy = taskModule.createWorkflowContinuationPolicy({
    clock: { now: () => now },
    redactText,
  })
  const planSteps = [
    { id: 'step-1', title: 'First step' },
    { id: 'step-2', title: 'Second private-value step' },
    { id: 'step-3', title: 'Third step' },
    { id: 'step-4', title: 'Fourth step' },
  ]

  const beforePlanning = policy.cancel({
    goal: 'private-value pre-planning goal',
    planSteps: [],
    observedSteps: [],
    output: 'Cancelled private-value before planning.',
  })
  assert.equal(beforePlanning.status, 'cancelled')
  assert.equal(beforePlanning.failureCode, 'cancelled')
  assert.equal(Object.hasOwn(beforePlanning, 'pendingAction'), false, 'pre-planning cancellation creates no pending action')
  assert.deepEqual(
    {
      planStepCount: beforePlanning.progressMetadata.planStepCount,
      completedStepCount: beforePlanning.progressMetadata.completedStepCount,
      remainingStepCount: beforePlanning.progressMetadata.remainingStepCount,
    },
    { planStepCount: 0, completedStepCount: 0, remainingStepCount: 0 },
  )

  const betweenSteps = policy.cancel({
    goal: 'private-value cancellation goal',
    planSteps,
    observedSteps: [{ status: 'done' }],
    output: 'Cancelled between private-value steps.',
  })
  assert.equal(Object.hasOwn(betweenSteps, 'pendingAction'), false, 'between-step cancellation creates no pending action')
  assert.equal(betweenSteps.progressMetadata.completedStepCount, 1, 'cancellation counts only completed steps')
  assert.equal(betweenSteps.progressMetadata.remainingStepCount, 3)
  assert.equal(betweenSteps.progressMetadata.cancelledAtStepTitle, 'Second [redacted] step')
  assert.equal(betweenSteps.progressMetadata.cancelledAtStepNumber, 2)
  assert.equal(betweenSteps.progressMetadata.nextStepTitle, 'Second [redacted] step')
  assert.equal(betweenSteps.progressMetadata.nextStepNumber, 2)

  const cancelledStep = policy.cancel({
    goal: 'private-value cancellation goal',
    planSteps,
    observedSteps: [{ status: 'done' }, { status: 'cancelled' }, { status: 'skipped' }],
    output: `${'private-value '.repeat(180)}cancelled tool output`,
  })
  assert.equal(Object.hasOwn(cancelledStep, 'pendingAction'), false, 'tool-step cancellation creates no pending action')
  assert.equal(cancelledStep.progressMetadata.completedStepCount, 1, 'cancelled and skipped attempts are not completed')
  assert.equal(cancelledStep.progressMetadata.cancelledAtStepNumber, 2, 'cancelled step is the next unresolved step')
  for (const text of [
    beforePlanning.finalOutput,
    beforePlanning.progressMetadata.cancelledContinuationPrompt,
    betweenSteps.finalOutput,
    betweenSteps.progressMetadata.cancelledContinuationPrompt,
    cancelledStep.finalOutput,
    cancelledStep.progressMetadata.cancelledContinuationPrompt,
  ]) {
    assert.equal(text.includes('private-value'), false, 'cancellation copy is redacted')
    assert.equal(text.length <= 900, true, 'cancellation copy is bounded to 900 characters')
  }

  const pauseInput = {
    runId: 'agent-run-stable-step-limit',
    goal: `${'private-value '.repeat(180)}bounded goal`,
    planSteps,
    attemptedStepCount: 2,
    workflowMetadata: {
      workflowId: 'workflow-private-value',
      workflowName: 'Saved private-value workflow',
      workflowExpectedOutput: 'private-value report',
    },
  }
  const firstPause = policy.pauseAtStepLimit(pauseInput)
  now = 711
  const secondPause = policy.pauseAtStepLimit(pauseInput)
  const pending = firstPause.pendingAction
  assert.equal(firstPause.status, 'waiting')
  assert.equal(firstPause.failureCode, 'step_limit_reached')
  assert.equal(pending.id, secondPause.pendingAction.id, 'step-limit identity is stable across clock changes')
  assert.match(pending.id, /^agent-pending-step-limit-\d+$/)
  assert.equal(pending.reason, 'step_limit_reached')
  assert.equal(pending.title, 'Workflow step limit reached')
  assert.equal(pending.confirmable, false)
  assert.equal(Object.hasOwn(pending, 'resumeToolRequest'), false, 'step-limit pause cannot persist a resume request')
  assert.equal(pending.blockedReason, taskModule.WORKFLOW_STEP_LIMIT_BLOCKED_REASON)
  assert.equal(pending.blockedReason, 'Continuation requires a visible continue action before additional workflow steps can run.')
  assert.equal(pending.planStepCount, 4)
  assert.equal(pending.completedStepCount, 2, 'step-limit progress uses attempted step count')
  assert.equal(pending.remainingStepCount, 2)
  assert.equal(pending.stepId, 'step-3')
  assert.equal(pending.stepTitle, 'Third step')
  assert.equal(pending.stepNumber, 3)
  assert.equal(pending.createdAt, 710, 'step-limit creation time comes from the injected clock')
  assert.equal(pending.workflowId, 'workflow-[redacted]')
  assert.equal(pending.workflowName, 'Saved [redacted] workflow')
  assert.equal(pending.workflowExpectedOutput, '[redacted] report')
  assert.match(pending.suggestedUserPrompt, /Workflow: Saved \[redacted\] workflow/)
  assert.match(pending.suggestedUserPrompt, /Workflow id: workflow-\[redacted\]/)
  assert.match(pending.suggestedUserPrompt, /Expected output: \[redacted\] report/)
  assert.match(pending.suggestedUserPrompt, /Step: 3\/4/)
  assert.match(pending.suggestedUserPrompt, /Step title: Third step/)
  assert.match(firstPause.finalOutput, /^Agentic workflow paused at the configured step limit\./)
  assert.match(firstPause.finalOutput, /Continuation unavailable: Continuation requires a visible continue action/)
  for (const text of [pending.summary, pending.suggestedUserPrompt, firstPause.finalOutput]) {
    assert.equal(text.includes('private-value'), false, 'step-limit copy is redacted')
    assert.equal(text.length <= 900, true, 'step-limit copy is bounded to 900 characters')
  }
}

function testWorkflowRuntimePolicy(taskModule) {
  const goal = 'Private workflow goal that must not enter diagnostics.'
  let runtime = taskModule.createWorkflowRuntime({
    id: 'agent-runtime-policy',
    goal,
    status: 'planning',
    startedAt: 10,
  })
  assert.equal(runtime.schema, 'islemind.workflow-runtime.v2')
  assert.match(runtime.goalHash, /^fnv1a32-[0-9a-f]{8}$/)
  assert.equal(JSON.stringify(runtime).includes(goal), false, 'runtime evidence stores a hash instead of the raw goal')
  assert.equal(taskModule.applyAgentWorkflowRuntimeToRun, undefined, 'the public target policy exposes no legacy run mutator')

  const planning = runtime
  runtime = taskModule.advanceWorkflowRuntime(runtime, {
    status: 'running',
    reason: 'plan-ready',
    at: 11,
  })
  assert.equal(planning.status, 'planning', 'runtime transitions do not mutate the previous state')
  assert.equal(planning.transitions.length, 0)
  runtime = taskModule.observeWorkflowRuntimeStep(runtime, [
    { id: 'done', title: 'Done', status: 'done' },
    { id: 'failed', title: 'Failed', status: 'error' },
    { id: 'cancelled', title: 'Cancelled', status: 'cancelled' },
  ])
  for (let index = 0; index < 9; index += 1) {
    runtime = taskModule.advanceWorkflowRuntime(runtime, {
      status: 'running',
      reason: 'plan-ready',
      at: 12 + index,
    })
  }
  const metadata = taskModule.workflowRuntimeTraceMetadata(runtime)
  assert.deepEqual(Object.keys(metadata).sort(), [
    'workflowRuntimeCancelledStepCount',
    'workflowRuntimeCompletedStepCount',
    'workflowRuntimeFailedStepCount',
    'workflowRuntimeFailureCode',
    'workflowRuntimeGoalHash',
    'workflowRuntimeLastFrom',
    'workflowRuntimeLastReason',
    'workflowRuntimeLastTo',
    'workflowRuntimePendingActionReason',
    'workflowRuntimeRunId',
    'workflowRuntimeSchema',
    'workflowRuntimeStatus',
    'workflowRuntimeStepCount',
    'workflowRuntimeTransitionCount',
    'workflowRuntimeTransitions',
  ], 'new workflow diagnostics expose only the neutral v2 metadata contract')
  assert.equal(Object.keys(metadata).some((key) => key.startsWith('agentWorkflowRuntime')), false)
  assert.equal(metadata.workflowRuntimeSchema, 'islemind.workflow-runtime.v2')
  assert.equal(metadata.workflowRuntimeStepCount, 3)
  assert.equal(metadata.workflowRuntimeCompletedStepCount, 1)
  assert.equal(metadata.workflowRuntimeFailedStepCount, 1)
  assert.equal(metadata.workflowRuntimeCancelledStepCount, 1)
  assert.equal(metadata.workflowRuntimeTransitionCount, 10)
  assert.equal(metadata.workflowRuntimeTransitions.length, 8, 'diagnostic projection retains only the last eight transitions')
  assert.deepEqual(
    metadata.workflowRuntimeTransitions.map((transition) => transition.at),
    [13, 14, 15, 16, 17, 18, 19, 20],
    'diagnostic projection preserves the exact last-eight transition window',
  )

  const terminal = taskModule.advanceWorkflowRuntime(runtime, {
    status: 'done',
    reason: 'completed',
    at: 30,
  })
  assert.throws(
    () => taskModule.advanceWorkflowRuntime(terminal, {
      status: 'running',
      reason: 'plan-ready',
      at: 31,
    }),
    /Invalid workflow runtime transition: done -> running/,
  )
  const waiting = taskModule.advanceWorkflowRuntime(
    taskModule.createWorkflowRuntime({ id: 'waiting', goal: 'wait', status: 'planning', startedAt: 1 }),
    {
      status: 'waiting',
      reason: 'evidence-insufficient',
      at: 2,
      failureCode: 'evidence_insufficient',
      pendingAction: { reason: 'evidence_insufficient' },
      step: { id: 'evidence-step', title: 'Collect evidence', status: 'error' },
    },
  )
  assert.deepEqual(waiting.transitions.at(-1), {
    from: 'planning',
    to: 'waiting',
    reason: 'evidence-insufficient',
    at: 2,
    failureCode: 'evidence_insufficient',
    pendingActionReason: 'evidence_insufficient',
    stepId: 'evidence-step',
    stepTitle: 'Collect evidence',
    stepStatus: 'error',
  }, 'the target policy preserves transition reason and bounded failure/action/step evidence')
  assert.doesNotThrow(
    () => taskModule.advanceWorkflowRuntime(waiting, {
      status: 'waiting',
      reason: 'evidence-insufficient',
      at: 3,
    }),
    'same-state transitions remain allowed even for legacy terminal waiting state',
  )
  assert.throws(
    () => taskModule.advanceWorkflowRuntime(waiting, {
      status: 'running',
      reason: 'plan-ready',
      at: 4,
    }),
    /Invalid workflow runtime transition: waiting -> running/,
    'the migration preserves the legacy waiting-terminal matrix',
  )
}

function testWorkflowIntentClassifier(taskModule) {
  let clockCalls = 0
  let now = 610
  const projectedTraces = []
  const redactFixtureValue = (value) => {
    if (typeof value === 'string') return value.replaceAll('private-value', '[redacted]')
    if (Array.isArray(value)) return value.map(redactFixtureValue)
    return value
  }
  const classifier = taskModule.createWorkflowIntentClassifier({
    clock: {
      now() {
        clockCalls += 1
        return now
      },
    },
    projectTrace(trace) {
      const completedAt = trace.completedAt ?? trace.startedAt ?? 0
      const startedAt = trace.startedAt ?? completedAt
      const projected = {
        ...trace,
        title: trace.title.replaceAll('private-value', '[redacted]'),
        content: trace.content?.replaceAll('private-value', '[redacted]'),
        metadata: trace.metadata
          ? Object.fromEntries(Object.entries(trace.metadata).map(([key, value]) => [key, redactFixtureValue(value)]))
          : trace.metadata,
        completedAt,
        durationMs: trace.durationMs ?? Math.max(0, completedAt - startedAt),
      }
      projectedTraces.push(projected)
      return projected
    },
  })

  const plain = classifier.classify({ goal: 'Continue the conversation normally.' })
  assert.equal(clockCalls, 1, 'intent classification uses the injected clock only when now is omitted')
  assert.deepEqual(
    { intent: plain.intent, shouldRunWorkflow: plain.shouldRunWorkflow, confidence: plain.confidence, reasons: plain.reasons },
    { intent: 'plain_chat', shouldRunWorkflow: false, confidence: 0.62, reasons: ['model-tool-selection'] },
  )
  assert.equal(plain.trace.startedAt, 610)
  assert.equal(plain.trace.completedAt, 610)
  assert.equal(plain.trace.durationMs, 0, 'trace completion remains delegated to the injected projector')
  assert.equal(plain.trace.id, classifier.classify({ goal: 'Continue the conversation normally.', now: 610 }).trace.id)
  assert.equal(clockCalls, 1, 'an explicit classification time avoids the injected clock')

  const explicitToolRequest = Object.freeze({
    toolId: 'builtin:private-value.read',
    name: 'private-value.read',
    source: 'builtin',
    arguments: Object.freeze({ query: 'private-value' }),
  })
  const explicit = classifier.classify({
    goal: 'This goal also mentions settings and evidence.',
    explicitToolRequest,
    requestedOutput: 'work-artifact',
    now: 611,
  })
  assert.equal(explicit.suggestedToolRequest, explicitToolRequest, 'explicit tool request identity is preserved')
  assert.deepEqual(explicitToolRequest.arguments, { query: 'private-value' }, 'classification does not mutate explicit arguments')
  assert.deepEqual(
    { intent: explicit.intent, confidence: explicit.confidence, reasons: explicit.reasons },
    { intent: 'tool_task', confidence: 1, reasons: ['explicit-tool-request'] },
    'explicit requests retain first precedence',
  )
  assert.deepEqual({
    type: explicit.trace.type,
    title: explicit.trace.title,
    content: explicit.trace.content,
    status: explicit.trace.status,
    startedAt: explicit.trace.startedAt,
    completedAt: explicit.trace.completedAt,
    durationMs: explicit.trace.durationMs,
    metadata: explicit.trace.metadata,
  }, {
    type: 'reasoning',
    title: 'Agent intent',
    content: 'tool_task · confidence=1.00 · explicit-tool-request',
    status: 'done',
    startedAt: 611,
    completedAt: 611,
    durationMs: 0,
    metadata: {
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 1,
      reasons: ['explicit-tool-request'],
      requestedOutput: 'work-artifact',
      toolName: '[redacted].read',
      toolId: 'builtin:[redacted].read',
    },
  }, 'classification preserves the complete projected trace contract')

  const requestedArtifact = classifier.classify({
    goal: 'Install Android settings.',
    content: 'Visible source content.',
    requestedOutput: 'work-artifact',
    now: 612,
  })
  assert.deepEqual(
    { intent: requestedArtifact.intent, confidence: requestedArtifact.confidence, reasons: requestedArtifact.reasons },
    { intent: 'work_artifact', confidence: 0.98, reasons: ['requested-output-work-artifact'] },
  )
  assert.deepEqual(requestedArtifact.suggestedToolRequest, {
    toolId: 'work-artifact:summarize',
    arguments: { content: 'Visible source content.' },
  })
  const alarmGoal = '设置晚上十点三十分闹钟，标题“服药”'
  assert.deepEqual(classifier.inferClockTime(alarmGoal), { hour: 22, minutes: 30 })
  assert.equal(classifier.inferReminderTitle(alarmGoal), '服药')

  const reminderGoal = 'Create a reminder called Project sync for 2026-09-04 at 10:30.'
  assert.equal(classifier.inferReminderTitle(reminderGoal), 'Project sync')
  assert.equal(classifier.inferReminderDateTimeIso(reminderGoal), '2026-09-04T10:30:00+08:00')
  const fallbackReminderGoal = '创建待办 2026-09-04 10:30'
  assert.equal(classifier.inferReminderTitle(fallbackReminderGoal), undefined)

  const modelScheduledFixtures = [
    'Prepare action items, decisions, and risks.',
    'Android SAF undo. Undo operations JSON: [{"kind":"move","from":"a","to":"b"}]',
    'Install Android app.apk from file:///Download/fixture.apk',
    alarmGoal,
    reminderGoal,
    '请设置深色主题',
    '联网搜索最新资料',
    'verify this claim with evidence',
    'prepare a handoff for the next step',
    'diagnose the root cause',
  ]
  for (const goal of modelScheduledFixtures) {
    const result = classifier.classify({ goal, now: 621 })
    assert.deepEqual(
      {
        intent: result.intent,
        shouldRunWorkflow: result.shouldRunWorkflow,
        confidence: result.confidence,
        reasons: result.reasons,
        suggestedToolRequest: result.suggestedToolRequest,
      },
      {
        intent: 'plain_chat',
        shouldRunWorkflow: false,
        confidence: 0.62,
        reasons: ['model-tool-selection'],
        suggestedToolRequest: undefined,
      },
      `${goal} remains on the model-scheduled tool path`,
    )
  }
  assert.ok(projectedTraces.length >= 13, 'every classification delegates trace completion and redaction')
  assert.equal(JSON.stringify(explicit.trace.metadata).includes('private-value'), false, 'injected trace projection retains metadata redaction semantics')
}

function testWorkflowPlanner(taskModule) {
  const redactText = (value) => String(value).replaceAll('private-value', '[redacted]')
  const projectTrace = (trace) => {
    const completedAt = trace.completedAt ?? trace.startedAt ?? 0
    const startedAt = trace.startedAt ?? completedAt
    return {
      ...trace,
      title: redactText(trace.title),
      content: trace.content ? redactText(trace.content) : trace.content,
      completedAt,
      durationMs: trace.durationMs ?? Math.max(0, completedAt - startedAt),
    }
  }
  const classificationTrace = (id, startedAt) => projectTrace({
    id,
    type: 'reasoning',
    title: 'Agent intent',
    status: 'done',
    startedAt,
  })
  let clockCalls = 0
  let classifyInput
  const suggestedRequest = {
    toolId: 'builtin:suggested.read',
    name: 'suggested.read',
    source: 'builtin',
    arguments: { query: 'suggested' },
  }
  const planner = taskModule.createWorkflowPlanner({
    clock: {
      now() {
        clockCalls += 1
        return 700
      },
    },
    classifyIntent(input) {
      classifyInput = input
      return {
        intent: 'tool_task',
        shouldRunWorkflow: true,
        confidence: 0.9,
        reasons: ['fixture-classifier'],
        suggestedToolRequest: suggestedRequest,
        trace: classificationTrace('fixture-classification', input.now),
      }
    },
    projectTrace,
    redactText,
    formatToolIdentity(request) {
      return request
        ? [request.source, request.serverId, request.toolId ?? request.name].filter(Boolean).join(':')
        : ''
    },
    collectRagProfileRequirements() {
      return ['balanced profile', 'fallback evidence']
    },
    inferClockTime() {
      return { hour: 9, minutes: 45 }
    },
    inferReminderDateTimeIso() {
      return '2026-08-02T09:45:00.000Z'
    },
    inferReminderTitle() {
      return 'Fixture reminder'
    },
    sanitizeApkUri(value) {
      return value?.endsWith('.apk') ? value : undefined
    },
  })

  const explicitClassification = {
    intent: 'plain_chat',
    shouldRunWorkflow: false,
    confidence: 1,
    reasons: ['explicit-fixture'],
    trace: classificationTrace('explicit-classification', 10),
  }
  const direct = planner({
    goal: 'Stay on the direct chat path.',
    classification: explicitClassification,
    now: 10,
  })
  assert.equal(clockCalls, 0, 'an explicit time and classification avoid injected fallback work')
  assert.equal(classifyInput, undefined)
  assert.equal(direct.classification, explicitClassification)
  assert.equal(direct.shouldRunWorkflow, false)
  assert.deepEqual(direct.steps, [], 'direct chat planning creates no task step')
  assert.equal(direct.trace.id, direct.id)
  assert.equal(direct.trace.startedAt, 10)
  assert.equal(direct.trace.durationMs, 0)
  assert.equal(direct.trace.metadata.stepCount, 0)

  const explicitFallbackRequest = {
    toolId: 'builtin:fallback.read',
    name: 'fallback.read',
    source: 'builtin',
    arguments: { query: 'fallback' },
  }
  const suggested = planner({
    goal: 'Use the classified tool.',
    content: 'Visible classifier content.',
    toolRequest: explicitFallbackRequest,
    requestedOutput: 'auto',
  })
  assert.equal(clockCalls, 1)
  assert.equal(classifyInput.now, 700)
  assert.equal(classifyInput.explicitToolRequest, explicitFallbackRequest)
  assert.equal(classifyInput.requestedOutput, 'auto')
  assert.equal(suggested.steps.length, 1)
  assert.equal(suggested.steps[0].toolRequest, suggestedRequest, 'the classifier suggestion precedes the explicit fallback request')
  assert.equal(suggested.steps[0].id, `${suggested.id}-step-1`)
  assert.equal(suggested.trace.metadata.toolId, suggestedRequest.toolId)

  const workflow = {
    id: 'workflow-planner-bindings',
    name: 'Planner binding fixture',
    permissionCeiling: 'read-write',
    expectedOutput: 'handoff',
    acceptanceChecks: [
      `private-value ${'a'.repeat(220)}`,
      'second check',
      'third check',
      'fourth check must be omitted',
    ],
    steps: [
      { id: 'artifact', title: 'Build artifact', toolRequest: { toolId: 'work-artifact:summarize', source: 'work-artifact', arguments: {} } },
      { id: 'rag', title: 'Collect evidence', toolRequest: { toolId: 'rag:context_pack', source: 'rag', arguments: {} } },
      { id: 'files', title: 'Preview files', toolRequest: { toolId: 'android:files.preview_operations', source: 'android', arguments: { mode: 'copy' } } },
      { id: 'apk', title: 'Inspect APK', toolRequest: { toolId: 'android:apk.inspect', source: 'android', arguments: {} } },
      { id: 'alarm', title: 'Create alarm', toolRequest: { toolId: 'android:alarm.open_create_intent', source: 'android', arguments: {} } },
      { id: 'reminder', title: 'Create reminder', toolRequest: { toolId: 'android:reminder.open_create_todo', source: 'android', arguments: {} } },
    ],
  }
  const originalWorkflow = structuredClone(workflow)
  const runtimeContent = 'file:///Download/fixture.apk content://tree/downloads copy report.txt to Archive folder'
  const planned = planner({
    goal: 'Prepare the complete runtime binding fixture.',
    content: runtimeContent,
    workflowDefinition: workflow,
    classification: {
      intent: 'tool_task',
      shouldRunWorkflow: true,
      confidence: 1,
      reasons: ['selected-workflow'],
      trace: classificationTrace('workflow-classification', 800),
    },
    now: 800,
  })
  assert.deepEqual(workflow, originalWorkflow, 'planning does not mutate the selected workflow or its tool arguments')
  assert.deepEqual(planned.steps.map((step) => step.id), workflow.steps.map((step) => `${planned.id}-${step.id}`))
  assert.deepEqual(planned.steps.map((step) => step.title), workflow.steps.map((step) => step.title))
  assert.equal(planned.steps[0].toolRequest.arguments.content, runtimeContent)
  assert.equal(planned.steps[1].toolRequest.arguments.query, 'Prepare the complete runtime binding fixture.')
  assert.deepEqual(planned.steps[2].toolRequest.arguments, {
    mode: 'copy',
    directoryUri: 'content://tree/downloads',
    sourceName: 'report.txt',
    targetDirectoryName: 'Archive',
    targetName: 'report.txt',
  })
  assert.equal(planned.steps[3].toolRequest.arguments.apkUri, 'file:///Download/fixture.apk')
  assert.deepEqual(planned.steps[4].toolRequest.arguments, {
    hour: 9,
    minutes: 45,
    message: 'Fixture reminder',
  })
  assert.deepEqual(planned.steps[5].toolRequest.arguments, {
    title: 'Fixture reminder',
    dueTimeIso: '2026-08-02T09:45:00.000Z',
  })
  const metadata = planned.trace.metadata
  assert.equal(metadata.workflowRequiredToolCount, 6)
  assert.equal(metadata.workflowRequiredTools.length, 5)
  assert.ok(metadata.workflowRequiredTools.every((value) => value.length <= 120))
  assert.equal(metadata.acceptanceCheckCount, 4)
  assert.equal(metadata.workflowAcceptanceChecks.length, 3)
  assert.ok(metadata.workflowAcceptanceChecks.every((value) => value.length <= 160))
  assert.equal(JSON.stringify(metadata.workflowAcceptanceChecks).includes('private-value'), false)
  assert.deepEqual(metadata.workflowRagProfileRequirements, ['balanced profile', 'fallback evidence'])
  assert.equal(metadata.workflowRagProfileRequirementCount, 2)
  assert.equal(metadata.runtimeArgumentBindingCount, 6)
  assert.deepEqual(metadata.runtimeArgumentBindings.map((value) => value.split(':')[0]), workflow.steps.map((step) => step.id))
  assert.equal(planned.trace.startedAt, 800)
}

async function testWorkflowStepExecutor(taskModule) {
  const redactText = (value) => String(value).replaceAll('private-value', '[redacted]')
  const projectTrace = (trace) => {
    const completedAt = trace.completedAt ?? trace.startedAt ?? 0
    const startedAt = trace.startedAt ?? completedAt
    return {
      ...trace,
      title: redactText(trace.title),
      content: trace.content ? redactText(trace.content) : trace.content,
      completedAt,
      durationMs: trace.durationMs ?? Math.max(0, completedAt - startedAt),
    }
  }
  const clockFrom = (start) => {
    let now = start
    return { now: () => now++ }
  }

  let noToolExecutions = 0
  const executeNoToolStep = taskModule.createWorkflowStepExecutor({
    clock: clockFrom(100),
    async executeTool() {
      noToolExecutions += 1
      throw new Error('No-tool steps must not execute a tool.')
    },
    redactText,
    projectTrace,
  })
  const noToolStep = await executeNoToolStep({ id: 'step-no-tool', title: 'No tool' })
  assert.equal(noToolExecutions, 0)
  assert.equal(noToolStep.status, 'done')
  assert.equal(noToolStep.observation, undefined)
  assert.deepEqual(noToolStep.trace.map((trace) => trace.id), ['step-no-tool-start'])
  assert.equal(noToolStep.startedAt, 100)
  assert.equal(noToolStep.completedAt, 101)
  assert.equal(noToolStep.trace[0].durationMs, 0, 'trace duration stays delegated to the injected projector')

  const signal = new AbortController().signal
  let executed
  const executeErrorStep = taskModule.createWorkflowStepExecutor({
    clock: clockFrom(200),
    async executeTool(input) {
      executed = input
      return {
        ok: false,
        status: 'error',
        output: 'Fixture execution failed.',
        blocks: [{ type: 'text', text: 'Fixture execution failed.' }],
        diagnostic: {
          id: 'fixture-tool-diagnostic',
          type: 'tool',
          title: 'Fixture tool',
          content: 'Fixture execution failed.',
          status: 'error',
          startedAt: 205,
          metadata: { source: 'builtin', retained: true },
        },
        errorCode: 'execution_failed',
        metadata: { receipt: 'fixture-receipt' },
      }
    },
    redactText,
    projectTrace,
  })
  const longTitle = `Inspect private-value ${'x'.repeat(300)}`
  const request = {
    toolId: 'builtin:fixture.read',
    name: 'fixture.read',
    source: 'builtin',
    arguments: { query: `private-value ${'q'.repeat(500)}` },
  }
  const errorStep = await executeErrorStep({
    id: 'step-error',
    title: longTitle,
    assistantRunId: 'assistant-run-step-executor',
    toolRequest: request,
    mode: 'agent',
    intentVisible: true,
    userConfirmed: true,
    evidenceSources: ['agent-plan:fixture'],
    evidenceSummary: 'Visible fixture evidence.',
    stepIndex: 1,
    planStepCount: 3,
    toolCallIndex: 0,
    limits: { maxSteps: 3 },
    signal,
    options: {
      mode: 'chat',
      intentVisible: false,
      userConfirmed: false,
      evidenceSources: ['stale'],
      evidenceSummary: 'Stale evidence.',
      stepIndex: 0,
      toolCallIndex: 1,
      limits: { maxSteps: 1 },
      signal: new AbortController().signal,
      manifests: ['fixture-manifest'],
    },
  })
  assert.equal(executed.stepId, 'step-error')
  assert.equal(executed.assistantRunId, 'assistant-run-step-executor')
  assert.equal(executed.request, request)
  assert.equal(executed.options.signal, signal, 'the exact caller signal reaches the injected tool closure')
  assert.equal(Object.hasOwn(executed.options, 'mode'), false, 'top-level and nested legacy mode extras are stripped before tool execution')
  assert.equal(executed.options.intentVisible, true)
  assert.equal(executed.options.userConfirmed, true)
  assert.deepEqual(executed.options.evidenceSources, ['agent-plan:fixture'])
  assert.equal(executed.options.evidenceSummary, 'Visible fixture evidence.')
  assert.equal(executed.options.stepIndex, 1)
  assert.equal(executed.options.toolCallIndex, 0)
  assert.deepEqual(executed.options.limits, { maxSteps: 3 })
  assert.deepEqual(executed.options.manifests, ['fixture-manifest'], 'unowned runtime options pass through unchanged')
  assert.equal(errorStep.status, 'error')
  assert.equal(errorStep.observation.status, 'error')
  assert.equal(errorStep.observation.errorCode, 'execution_failed')
  assert.deepEqual(errorStep.observation.metadata, { receipt: 'fixture-receipt' })
  assert.equal(errorStep.observation.diagnostic.id, 'fixture-tool-diagnostic')
  assert.equal(errorStep.observation.diagnostic.durationMs, 0)
  assert.deepEqual(errorStep.trace.map((trace) => trace.id), ['step-error-start', 'fixture-tool-diagnostic'])
  assert.equal(errorStep.startedAt, 200)
  assert.equal(errorStep.completedAt, 201)
  const startMetadata = errorStep.trace[0].metadata
  assert.equal(startMetadata.stepIndex, 1)
  assert.equal(startMetadata.stepNumber, 2)
  assert.equal(startMetadata.planStepCount, 3)
  assert.equal(startMetadata.inputSummaryRedacted, true)
  assert.equal(startMetadata.inputSummary.includes('private-value'), false)
  assert.ok(startMetadata.inputSummary.length <= 360)
  const diagnosticMetadata = errorStep.observation.diagnostic.metadata
  assert.equal(diagnosticMetadata.source, 'builtin')
  assert.equal(diagnosticMetadata.retained, true)
  assert.equal(diagnosticMetadata.stepId, 'step-error')
  assert.equal(diagnosticMetadata.stepIndex, 1)
  assert.equal(diagnosticMetadata.stepNumber, 2)
  assert.equal(diagnosticMetadata.planStepCount, 3)
  assert.equal(diagnosticMetadata.stepTitle.includes('private-value'), false)
  assert.ok(diagnosticMetadata.stepTitle.length <= 160)

  const unavailable = await taskModule.createWorkflowStepExecutor({
    clock: clockFrom(300),
    async executeTool() { return undefined },
    redactText,
    projectTrace,
  })({
    id: 'step-unavailable',
    title: 'Unavailable fixture',
    toolRequest: { name: 'missing.read', source: 'builtin', arguments: {} },
  })
  assert.equal(unavailable.status, 'error')
  assert.equal(unavailable.observation.errorCode, 'tool_unavailable')
  assert.equal(unavailable.observation.output, 'Tool is unavailable.')
  assert.equal(unavailable.observation.diagnostic.id, 'agent-tool-unavailable-301')
  assert.equal(unavailable.observation.diagnostic.metadata.stepId, 'step-unavailable')
  assert.equal(unavailable.completedAt, 302)

  const preAbortedController = new AbortController()
  preAbortedController.abort()
  let preAbortedExecutions = 0
  const preAborted = await taskModule.createWorkflowStepExecutor({
    clock: clockFrom(400),
    async executeTool() {
      preAbortedExecutions += 1
      return undefined
    },
    redactText,
    projectTrace,
  })({
    id: 'step-pre-aborted',
    title: 'Pre-aborted fixture',
    toolRequest: { name: 'fixture.read', source: 'builtin', arguments: {} },
    signal: preAbortedController.signal,
  })
  assert.equal(preAbortedExecutions, 0, 'pre-aborted execution never reaches the injected tool closure')
  assert.equal(preAborted.status, 'cancelled')
  assert.equal(preAborted.observation.status, 'skipped')
  assert.equal(preAborted.observation.errorCode, 'cancelled')
  assert.equal(preAborted.observation.diagnostic.id, 'step-pre-aborted-cancelled')
  assert.deepEqual(preAborted.trace.map((trace) => trace.id), ['step-pre-aborted-start'])
  assert.equal(preAborted.startedAt, 400)
  assert.equal(preAborted.completedAt, 401)

  const postAbortedController = new AbortController()
  let postAbortSignal
  const postAborted = await taskModule.createWorkflowStepExecutor({
    clock: clockFrom(500),
    async executeTool(input) {
      postAbortSignal = input.options.signal
      postAbortedController.abort()
      return {
        ok: true,
        status: 'done',
        output: 'Late success.',
        diagnostic: {
          id: 'late-success-diagnostic',
          type: 'tool',
          title: 'Late success',
          status: 'done',
          startedAt: 505,
        },
      }
    },
    redactText,
    projectTrace,
  })({
    id: 'step-post-aborted',
    title: 'Post-aborted fixture',
    toolRequest: { name: 'fixture.write', source: 'builtin', arguments: {} },
    signal: postAbortedController.signal,
  })
  assert.equal(postAbortSignal, postAbortedController.signal)
  assert.equal(postAborted.status, 'cancelled', 'a post-execution abort suppresses a late success')
  assert.equal(postAborted.observation.errorCode, 'cancelled')
  assert.deepEqual(postAborted.trace.map((trace) => trace.id), [
    'step-post-aborted-start',
    'late-success-diagnostic',
    'step-post-aborted-cancelled',
  ])

  let accessorReads = 0
  const accessorArguments = {}
  Object.defineProperty(accessorArguments, 'secret', {
    enumerable: true,
    get() {
      accessorReads += 1
      throw new Error('tool argument accessors must not execute')
    },
  })
  const ownKeysArguments = new Proxy({}, {
    ownKeys() { throw new Error('ownKeys trap') },
  })
  const descriptorArguments = new Proxy({ query: 'fixture' }, {
    ownKeys() { return ['query'] },
    getOwnPropertyDescriptor() { throw new Error('descriptor trap') },
  })
  let stringifyProxyReads = 0
  const stringifyProxyArguments = new Proxy({ query: 'fixture' }, {
    get() {
      stringifyProxyReads += 1
      throw new Error('stringify get trap')
    },
  })
  let toJsonCalls = 0
  const toJsonArguments = {
    query: 'fixture',
    toJSON() {
      toJsonCalls += 1
      throw new Error('untrusted toJSON must not execute')
    },
  }
  const nestedAccessorArguments = { nested: {} }
  Object.defineProperty(nestedAccessorArguments.nested, 'secret', {
    enumerable: true,
    get() {
      accessorReads += 1
      throw new Error('nested tool argument accessors must not execute')
    },
  })
  const hostileTraces = []
  const executeHostileStep = taskModule.createWorkflowStepExecutor({
    clock: clockFrom(600),
    async executeTool(input) {
      return {
        ok: true,
        status: 'done',
        output: 'Hostile metadata contained.',
        diagnostic: {
          id: `${input.stepId}-diagnostic`,
          type: 'tool',
          title: 'Hostile metadata fixture',
          status: 'done',
          startedAt: 600,
        },
      }
    },
    redactText,
    projectTrace(trace) {
      const projected = projectTrace(trace)
      hostileTraces.push(projected)
      return projected
    },
  })
  for (const [id, argumentsValue, unsafe] of [
    ['accessor', accessorArguments, true],
    ['own-keys', ownKeysArguments, true],
    ['descriptor', descriptorArguments, true],
    ['stringify-proxy', stringifyProxyArguments, false],
    ['to-json', toJsonArguments, false],
    ['nested-accessor', nestedAccessorArguments, true],
  ]) {
    const result = await executeHostileStep({
      id: `step-${id}`,
      title: 'Hostile input fixture',
      toolRequest: { name: 'fixture.inspect', source: 'builtin', arguments: argumentsValue },
    })
    assert.equal(result.status, 'done')
    const metadata = result.trace[0].metadata ?? {}
    if (unsafe) {
      assert.equal(Object.hasOwn(metadata, 'inputSummary'), false, `${id} unsafe input metadata is omitted`)
      assert.equal(Object.hasOwn(metadata, 'inputSummaryRedacted'), false, `${id} unsafe redaction metadata is omitted`)
    }
  }
  assert.equal(accessorReads, 0, 'tool argument accessors are never executed')
  assert.equal(stringifyProxyReads, 0, 'safe descriptor projection avoids throwing JSON stringify proxy traps')
  assert.equal(toJsonCalls, 0, 'tool argument toJSON callbacks are never executed')
  assert.ok(hostileTraces.length > 0)
}

async function testWorkflowCheckpointLifecycle(input) {
  const { journal, observedSignals, store } = createCheckpointStoreFixture(input)
  const signal = new AbortController().signal
  const runId = input.core.asAssistantRunId('workflow-checkpoint-success')
  const recorder = input.taskModule.createWorkflowCheckpointRecorder({
    store,
    runId,
    goalHash: 'goal-hash-success',
    startedAt: 10,
  })

  assert.equal((await recorder.initialize(signal)).ok, true)
  assert.equal((await recorder.record({
    status: 'running',
    occurredAt: 11,
    traces: [{
      id: 'planning-trace',
      type: 'planning',
      status: 'done',
      title: 'Plan',
      startedAt: 10,
      completedAt: 11,
    }],
  }, signal)).ok, true)
  assert.equal((await recorder.record({
    status: 'running',
    occurredAt: 12,
    tasks: [{
      taskId: 'task-1',
      stepId: 'step-1',
      status: 'succeeded',
      recordedAt: 12,
      artifactIds: ['artifact-1'],
    }],
    evidence: [{
      id: 'evidence-1',
      kind: 'tool-result',
      summary: 'Tool completed.',
      recordedAt: 12,
      stepId: 'step-1',
      taskId: 'task-1',
    }],
    completedSteps: [{
      id: 'step-1',
      title: 'Execute tool',
      outcome: 'succeeded',
      completedAt: 12,
      taskIds: ['task-1'],
      evidenceIds: ['evidence-1'],
    }],
  }, signal)).ok, true)
  assert.equal((await recorder.record({ status: 'succeeded', occurredAt: 13 }, signal)).ok, true)

  const recovery = await recorder.recover(signal)
  assert.equal(recovery.ok, true)
  if (!recovery.ok) throw new Error(recovery.error.message)
  assert.equal(recovery.value.checkpoint.status, 'succeeded')
  assert.equal(recovery.value.disposition, 'terminal')
  assert.equal(recovery.value.replaySideEffects, false)
  assert.equal(recovery.value.checkpoint.lastCompletedStep.id, 'step-1')
  const contradictoryTerminal = input.taskModule.parseWorkflowCheckpoint({
    ...recovery.value.checkpoint,
    failureEvidence: {
      code: 'execution_failed',
      message: 'Contradictory retained failure.',
      recordedAt: 13,
      retryable: false,
      evidenceIds: [],
    },
  })
  assert.equal(contradictoryTerminal.ok, false, 'non-failed checkpoints reject retained failure evidence')
  assert.deepEqual(journal.get(runId).map((entry) => entry.type), [
    'checkpoint.created',
    'workflow.started',
    'workflow.progressed',
    'workflow.succeeded',
  ])
  assert.ok(observedSignals.length > 0)
  assert.ok(observedSignals.every((candidate) => candidate === signal), 'checkpoint persistence observes the exact caller signal')

  await assertCheckpointTerminalTransition(input, store, 'waiting', {
    pendingAction: {
      id: 'pending-1',
      reason: 'human_review',
      title: 'Review required',
      summary: 'Review before resuming.',
      createdAt: 22,
      resumePolicy: 'human-review-only',
      requiresUserConfirmation: true,
    },
  })
  await assertCheckpointTerminalTransition(input, store, 'failed', {
    failureEvidence: {
      code: 'execution_failed',
      message: 'The workflow failed.',
      recordedAt: 22,
      retryable: true,
      evidenceIds: [],
    },
  })
  await assertCheckpointTerminalTransition(input, store, 'cancelled')

  const interruptedRunId = input.core.asAssistantRunId('workflow-checkpoint-interrupted')
  const interrupted = input.taskModule.createWorkflowCheckpointRecorder({
    store,
    runId: interruptedRunId,
    goalHash: 'goal-hash-interrupted',
    startedAt: 30,
  })
  const interruptedController = new AbortController()
  assert.equal((await interrupted.initialize(interruptedController.signal)).ok, true)
  assert.equal((await interrupted.record({ status: 'running', occurredAt: 31 }, interruptedController.signal)).ok, true)
  interruptedController.abort()
  const cancelledWrite = await interrupted.record({ status: 'cancelled', occurredAt: 32 }, interruptedController.signal)
  assert.equal(cancelledWrite.ok, false, 'an already-aborted exact signal prevents a post-cancellation write')
  if (cancelledWrite.ok) throw new Error('Expected the cancelled checkpoint write to fail.')
  assert.equal(cancelledWrite.error.code, 'cancelled')
  const interruptedRecovery = await store.recover(interruptedRunId, new AbortController().signal)
  assert.equal(interruptedRecovery.ok, true)
  if (!interruptedRecovery.ok) throw new Error(interruptedRecovery.error.message)
  assert.equal(interruptedRecovery.value.checkpoint.status, 'running', 'recovery retains the last committed safe checkpoint')
  assert.equal(interruptedRecovery.value.disposition, 'reconcile-before-resume')
  assert.equal(interruptedRecovery.value.replaySideEffects, false)
}

function testWorkflowCheckpointMetadataBoundary(input) {
  let accessorCalls = 0
  const accessorMetadata = {}
  Object.defineProperty(accessorMetadata, 'nestedSecret', {
    enumerable: true,
    get() {
      accessorCalls += 1
      throw new Error('Nested metadata getter must not execute.')
    },
  })
  let accessorResult
  assert.doesNotThrow(() => {
    accessorResult = input.taskModule.parseWorkflowCheckpoint(
      checkpointWithTraceMetadata(input.core, 'checkpoint-accessor-metadata', accessorMetadata),
    )
  }, 'nested metadata accessors are contained by the validator')
  assert.equal(accessorResult.ok, false)
  assert.equal(accessorResult.error.code, 'invalid_record')
  assert.equal(accessorCalls, 0, 'nested metadata getters are rejected without invocation')

  const proxyMetadata = new Proxy({ safe: 'value' }, {
    ownKeys() {
      throw new Error('Nested metadata proxy inspection failed.')
    },
  })
  let proxyResult
  assert.doesNotThrow(() => {
    proxyResult = input.taskModule.parseWorkflowCheckpoint(
      checkpointWithTraceMetadata(input.core, 'checkpoint-proxy-metadata', proxyMetadata),
    )
  }, 'throwing nested metadata proxies do not escape the validator')
  assert.equal(proxyResult.ok, false)
  assert.equal(proxyResult.error.code, 'invalid_record')
}

function checkpointWithTraceMetadata(core, id, metadata) {
  return {
    schema: 'islemind.workflow-checkpoint.v2',
    runId: core.asAssistantRunId(id),
    revision: 1,
    journalSequence: 1,
    status: 'planning',
    goalHash: `goal-hash-${id}`,
    startedAt: 1,
    updatedAt: 1,
    completedSteps: [],
    tasks: [],
    evidence: [],
    traces: [{
      id: `trace-${id}`,
      type: 'planning',
      status: 'done',
      title: 'Fixture trace',
      startedAt: 1,
      completedAt: 1,
      metadata,
    }],
  }
}

async function testWorkflowCheckpointProjection(input) {
  const { journal, observedSignals, store } = createCheckpointStoreFixture(input)
  const { createWorkflowCheckpointProjectionSession, mapWorkflowCheckpointProjectionStatus } = input.taskModule
  assert.deepEqual(
    ['planning', 'running', 'waiting', 'done', 'error', 'cancelled']
      .map((status) => mapWorkflowCheckpointProjectionStatus(status)),
    ['planning', 'running', 'waiting', 'succeeded', 'failed', 'cancelled'],
    'the target projection maps every visible workflow status to the checkpoint contract',
  )

  const signal = new AbortController().signal
  const runId = input.core.asAssistantRunId('workflow-checkpoint-projection-success')
  const privateGoal = 'Read the fixture tool with token=private-goal-value.'
  const session = createWorkflowCheckpointProjectionSession({
    store,
    runId,
    goal: privateGoal,
    startedAt: 100,
    now: () => 999,
    redactText: redactFixtureText,
  })
  const trace = {
    id: 'legacy-step-trace',
    type: 'tool',
    title: 'Read fixture tool',
    status: 'done',
    startedAt: 102,
    completedAt: 103,
  }
  const noToolStep = {
    id: 'legacy-step-no-tool',
    title: 'Review the plan',
    status: 'done',
    trace: [{
      id: 'legacy-step-no-tool-trace',
      type: 'reasoning',
      title: 'Review the plan',
      status: 'done',
      startedAt: 101,
      completedAt: 102,
    }],
    startedAt: 101,
    completedAt: 102,
  }
  const internalObservationTrace = {
    id: 'legacy-step-internal-observation-trace',
    type: 'reasoning',
    title: 'Review internal state',
    status: 'done',
    startedAt: 102,
    completedAt: 103,
  }
  const internalObservationStep = {
    id: 'legacy-step-internal-observation',
    title: 'Review internal state',
    status: 'done',
    observation: {
      ok: true,
      status: 'done',
      output: 'Internal state reviewed.',
      diagnostic: internalObservationTrace,
      metadata: {},
    },
    trace: [internalObservationTrace],
    startedAt: 102,
    completedAt: 103,
  }
  const step = {
    id: 'legacy-step-1',
    title: 'Read fixture tool',
    status: 'done',
    toolRequest: {
      toolId: 'fixture.read',
      name: 'read',
      source: 'builtin',
    },
    observation: {
      ok: true,
      status: 'done',
      output: `Fixture tool completed with token=private-output-value. ${'x'.repeat(2_100)}`,
      diagnostic: trace,
      metadata: {
        vnextTaskId: 'task-1',
        vnextTaskStatus: 'succeeded',
        artifactIds: ['artifact-1', 'artifact-1', ...Array.from({ length: 40 }, (_, index) => `artifact-${index + 2}`)],
      },
    },
    trace: [trace],
    startedAt: 102,
    completedAt: 103,
  }

  await session.initialize(signal)
  await session.recordStarted(101, signal)
  await session.recordStep(noToolStep, signal)
  await session.recordStep(internalObservationStep, signal)
  await session.recordStep(step, signal)
  await session.recordTerminal({
    id: 'legacy-workflow-1',
    goal: 'Read the fixture tool.',
    status: 'done',
    steps: [noToolStep, internalObservationStep, step],
    traces: [trace],
    startedAt: 100,
    completedAt: 104,
    finalOutput: 'Fixture workflow completed.',
  }, signal)

  const recovery = await store.recover(runId, signal)
  assert.equal(recovery.ok, true)
  if (!recovery.ok) throw new Error(recovery.error.message)
  assert.equal(recovery.value.checkpoint.status, 'succeeded')
  assert.equal(recovery.value.checkpoint.revision, 6)
  assert.match(recovery.value.checkpoint.goalHash, /^workflow-goal-[a-z0-9]+$/, 'new v2 checkpoints use the Chat-neutral workflow goal-hash prefix')
  const legacyGoalHashCheckpoint = input.taskModule.parseWorkflowCheckpoint({
    ...recovery.value.checkpoint,
    goalHash: 'agent-goal-legacy-compatible',
  })
  assert.equal(legacyGoalHashCheckpoint.ok, true, 'historical Agent-prefixed goal hashes remain readable as opaque bounded checkpoint data')
  if (legacyGoalHashCheckpoint.ok) {
    assert.equal(legacyGoalHashCheckpoint.value.goalHash, 'agent-goal-legacy-compatible')
  }
  assert.equal(JSON.stringify(recovery.value.checkpoint).includes(privateGoal), false, 'durable checkpoints retain only the goal hash')
  assert.equal(recovery.value.checkpoint.lastCompletedStep?.id, step.id)
  assert.deepEqual(recovery.value.checkpoint.completedSteps.map((candidate) => candidate.id), [noToolStep.id, internalObservationStep.id, step.id])
  assert.deepEqual(recovery.value.checkpoint.completedSteps[0]?.evidenceIds, [], 'tool-less steps do not fabricate tool-result evidence')
  assert.deepEqual(recovery.value.checkpoint.lastCompletedStep?.taskIds, ['task-1'])
  assert.deepEqual(recovery.value.checkpoint.tasks.map((task) => task.taskId), ['task-1'])
  assert.equal(recovery.value.checkpoint.tasks[0].artifactIds.length, 32, 'task artifact references stay bounded')
  assert.equal(new Set(recovery.value.checkpoint.tasks[0].artifactIds).size, 32, 'task artifact references are deduplicated')
  assert.deepEqual(recovery.value.checkpoint.evidence.map((evidence) => evidence.stepId), [internalObservationStep.id, step.id])
  assert.deepEqual(recovery.value.checkpoint.evidence.map((evidence) => evidence.kind), ['diagnostic', 'tool-result'])
  assert.equal(recovery.value.checkpoint.evidence.at(-1).summary.includes('private-output-value'), false, 'evidence summaries are redacted')
  assert.ok(recovery.value.checkpoint.evidence.at(-1).summary.length <= 4_000, 'evidence summaries stay bounded')
  assert.ok(recovery.value.checkpoint.lastCompletedStep.summary.length <= 2_000, 'completed-step summaries stay bounded')
  assert.equal(recovery.value.disposition, 'terminal')
  assert.equal(recovery.value.replaySideEffects, false, 'legacy recovery never replays completed tool side effects')
  assert.deepEqual(journal.get(runId).map((entry) => entry.type), [
    'checkpoint.created',
    'workflow.started',
    'workflow.progressed',
    'workflow.progressed',
    'workflow.progressed',
    'workflow.succeeded',
  ])
  assert.ok(observedSignals.length > 0)
  assert.ok(
    observedSignals.every((candidate) => candidate === signal),
    'the target projection and recovery propagate the exact caller AbortSignal',
  )
}

async function testWorkflowCheckpointPersistenceFailure(input) {
  const signal = new AbortController().signal
  const { store } = createCheckpointStoreFixture(input, { failEventType: 'workflow.succeeded' })
  const runId = input.core.asAssistantRunId('workflow-checkpoint-terminal-failure')
  const session = input.taskModule.createWorkflowCheckpointProjectionSession({
    store,
    runId,
    goal: 'Fail the terminal checkpoint fixture.',
    startedAt: 200,
    now: () => 202,
    redactText: redactFixtureText,
  })

  await session.initialize(signal)
  await session.recordStarted(201, signal)
  await assert.rejects(
    session.recordTerminal({
      id: 'legacy-workflow-terminal-failure',
      goal: 'Fail the terminal checkpoint fixture.',
      status: 'done',
      steps: [],
      traces: [],
      startedAt: 200,
      completedAt: 202,
      finalOutput: 'This success must not be returned silently.',
    }, signal),
    (error) => {
      assert.ok(error instanceof input.taskModule.WorkflowCheckpointProjectionError)
      assert.equal(error.name, 'WorkflowCheckpointProjectionError')
      assert.equal(error.code, 'persistence_failed')
      assert.equal(error.phase, 'terminal')
      assert.equal(error.retryable, true)
      return true
    },
    'terminal persistence failure must fail the Chat workflow instead of returning silent success',
  )

  const recovery = await store.recover(runId, signal)
  assert.equal(recovery.ok, true)
  if (!recovery.ok) throw new Error(recovery.error.message)
  assert.equal(recovery.value.checkpoint.status, 'running', 'recovery retains the last committed checkpoint')
  assert.equal(recovery.value.disposition, 'reconcile-before-resume')
  assert.equal(recovery.value.replaySideEffects, false)
}

async function testCheckpointFailureFailsParentChatWorkflowRun(input) {
  const fixture = createFixture(input)
  const { store } = createCheckpointStoreFixture(input, { failEventType: 'workflow.succeeded' })
  const handle = fixture.chatWorkflows.start({
    conversationId: 'chat-checkpoint-failure-conversation',
    conversationMessageIds: ['chat-checkpoint-failure-message'],
    requestMessageId: 'chat-checkpoint-failure-message',
    requestText: 'Fail the terminal Chat workflow checkpoint.',
    responseMessageId: 'chat-checkpoint-failure-response',
    executor: {
      async execute({ run, signal }) {
        const session = input.taskModule.createWorkflowCheckpointProjectionSession({
          store,
          runId: run.id,
          goal: 'Fail the terminal Chat workflow checkpoint.',
          startedAt: fixture.clock.now(),
          now: () => fixture.clock.now(),
          redactText: redactFixtureText,
        })
        await session.initialize(signal)
        await session.recordStarted(fixture.clock.now(), signal)
        await session.recordTerminal({
          id: 'legacy-workflow-parent-failure',
          goal: 'Fail the terminal Chat workflow checkpoint.',
          status: 'done',
          steps: [],
          traces: [],
          startedAt: fixture.clock.now(),
          completedAt: fixture.clock.now(),
          finalOutput: 'This workflow must not complete successfully.',
        }, signal)
        return { outputText: 'unreachable success' }
      },
    },
  })

  const completion = await handle.completion
  assert.equal(completion.ok, false, 'checkpoint persistence failure fails the durable parent Chat workflow run')
  if (completion.ok) throw new Error('Expected the parent Chat workflow run to fail.')
  assert.equal(completion.error.code, 'activity_failed')
  const persisted = await fixture.runStore.get(handle.runId)
  assert.equal(persisted?.status, 'failed')
  assert.equal(persisted?.failure?.code, 'activity_failed')
}

function redactFixtureText(value) {
  return String(value).replace(/token=[^\s]+/gi, '[redacted]')
}

async function assertCheckpointTerminalTransition(input, store, status, extra = {}) {
  const signal = new AbortController().signal
  const runId = input.core.asAssistantRunId(`workflow-checkpoint-${status}`)
  const recorder = input.taskModule.createWorkflowCheckpointRecorder({
    store,
    runId,
    goalHash: `goal-hash-${status}`,
    startedAt: 20,
  })
  assert.equal((await recorder.initialize(signal)).ok, true)
  assert.equal((await recorder.record({ status: 'running', occurredAt: 21 }, signal)).ok, true)
  const terminal = await recorder.record({ status, occurredAt: 22, ...extra }, signal)
  assert.equal(terminal.ok, true, `${status} checkpoint transition persists`)
  if (!terminal.ok) throw new Error(terminal.error.message)
  assert.equal(terminal.value.status, status)
}

function createCheckpointStoreFixture(input, options = {}) {
  const records = new Map()
  const journal = new Map()
  const observedSignals = []
  const repository = {
    async load(runId, signal) {
      observedSignals.push(signal)
      return input.core.ok(records.get(runId))
    },
    async appendAndSave({ expectedRevision, checkpoint, entry, signal }) {
      observedSignals.push(signal)
      assert.equal(records.get(checkpoint.runId)?.revision ?? 0, expectedRevision)
      if (entry.type === options.failEventType) {
        return input.core.err('persistence_failed', 'Fixture checkpoint persistence failed.', { retryable: true })
      }
      records.set(checkpoint.runId, structuredClone(checkpoint))
      journal.set(checkpoint.runId, [...(journal.get(checkpoint.runId) ?? []), structuredClone(entry)])
      return input.core.ok(structuredClone(checkpoint))
    },
    async recover(runId, signal) {
      observedSignals.push(signal)
      const checkpoint = records.get(runId)
      return input.core.ok(checkpoint ? { checkpoint: structuredClone(checkpoint), source: 'current' } : undefined)
    },
  }
  return {
    records,
    journal,
    observedSignals,
    store: input.taskModule.createWorkflowCheckpointStore(repository),
  }
}

function createFixture(input) {
  let now = 80_000
  let sequence = 0
  const clock = { now: () => ++now }
  const ids = { next: (prefix) => `${prefix}-${++sequence}` }
  const runStore = input.runStoreModule.createInMemoryRunStore()
  const snapshots = createInMemoryContextSnapshotRepository()
  const assistantRuntime = input.runtimeModule.createAssistantRuntime({
    clock,
    ids,
    providerGateway: input.providerModule.createProviderGateway([]),
    persistence: runStore,
  })
  const chatWorkflows = input.runtimeModule.createAssistantChatWorkflowRunRuntime({
    ids,
    assistantRuntime,
    contextAssembly: input.knowledgeModule.createContextSnapshotAssembler({
      clock,
      ids,
      repository: snapshots.repository,
    }),
  })
  return { clock, ids, runStore, snapshots, assistantRuntime, chatWorkflows }
}

async function testChatWorkflowRunCreatesDurableChatParentAndLinkedTask(input) {
  const fixture = createFixture(input)
  const taskStore = input.taskStoreModule.createInMemoryTaskStore()
  const taskRuntime = input.taskModule.createTaskRuntime({
    clock: fixture.clock,
    ids: fixture.ids,
    persistence: taskStore,
    policyEvaluator: {
      async evaluate() {
        return { outcome: 'allowed', reasonCode: 'fixture_allowed' }
      },
    },
  })
  let observedContext
  let observedSignal
  const requestController = new AbortController()
  const handle = fixture.chatWorkflows.start({
    conversationId: 'chat-workflow-conversation',
    conversationMessageIds: ['chat-workflow-user'],
    requestMessageId: 'chat-workflow-user',
    requestText: 'Run the explicit workflow.',
    responseMessageId: 'chat-workflow-assistant',
    cancellationSignal: requestController.signal,
    executor: {
      async execute({ run, context, signal }) {
        assert.equal(run.id, handle.runId, 'workflow executor receives the exact durable Chat run ID')
        assert.equal(run.kind, 'chat', 'new explicit workflows execute as Chat activities')
        observedContext = context
        observedSignal = signal
        const created = await taskRuntime.create({
          runId: run.id,
          toolId: 'mcp:fixture:read',
          idempotencyKey: 'chat-workflow-parent-task',
        })
        assert.equal(created.ok, true)
        if (!created.ok) throw new Error(created.error.message)
        const executed = await taskRuntime.execute(created.value.id, {
          async execute(task) {
            assert.equal(task.runId, run.id)
            return { summary: 'Chat workflow task completed.' }
          },
        })
        assert.equal(executed.ok, true)
        return { outputText: 'Chat workflow completed.', eventCount: 1 }
      },
    },
  })

  const result = await handle.completion
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error.message)
  assert.equal(result.value.id, handle.runId)
  assert.equal(result.value.kind, 'chat')
  assert.equal(result.value.status, 'succeeded')
  assert.equal(result.value.result?.outputText, 'Chat workflow completed.')
  assert.notEqual(observedSignal, requestController.signal, 'Assistant Runtime owns the internal cancellation signal')
  assert.equal(observedContext.snapshot.id, result.value.contextSnapshotId)

  const snapshot = await fixture.snapshots.repository.get(result.value.contextSnapshotId)
  assert.equal(snapshot?.conversationId, 'chat-workflow-conversation')
  assert.deepEqual(snapshot?.snapshot.conversationMessageIds, ['chat-workflow-user'])
  const entries = await fixture.runStore.list(handle.runId)
  assert.deepEqual(entries.map((entry) => entry.type), ['run.created', 'run.started', 'run.succeeded'])
  assert.equal(entries[0].data?.executionKind, 'chat')
  const task = await taskStore.findByIdempotencyKey('chat-workflow-parent-task')
  assert.equal(task?.runId, handle.runId)
  assert.equal(task?.status, 'succeeded')
}

async function testChatWorkflowRunCancellation(input) {
  const fixture = createFixture(input)
  const controller = new AbortController()
  let executorStarted
  const started = new Promise((resolve) => { executorStarted = resolve })
  const handle = fixture.chatWorkflows.start({
    conversationId: 'chat-workflow-cancel-conversation',
    conversationMessageIds: ['chat-workflow-cancel-user'],
    requestText: 'Cancel this workflow.',
    cancellationSignal: controller.signal,
    executor: {
      async execute({ signal }) {
        executorStarted()
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        return { outputText: 'must not complete' }
      },
    },
  })
  await started
  controller.abort('user_stopped')
  const result = await handle.completion
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected Chat workflow cancellation.')
  assert.equal(result.error.code, 'cancelled')
  assert.equal((await fixture.runStore.get(handle.runId))?.kind, 'chat')
  assert.equal((await fixture.runStore.get(handle.runId))?.status, 'cancelled')
}

async function testChatWorkflowContextFailureDoesNotStartActivity(input) {
  let activityCalls = 0
  const runtime = input.runtimeModule.createAssistantChatWorkflowRunRuntime({
    ids: { next: () => 'chat-workflow-context-failure' },
    assistantRuntime: {
      async executeActivity() {
        activityCalls += 1
        throw new Error('must not execute')
      },
      async cancel() {
        throw new Error('must not cancel')
      },
    },
    contextAssembly: {
      async assemble() {
        return input.core.err('retrieval_failed', 'Context retrieval failed.', { retryable: true })
      },
    },
  })
  const result = await runtime.start({
    conversationId: 'chat-workflow-context-failure-conversation',
    conversationMessageIds: [],
    requestText: 'Fail before activity.',
    executor: { async execute() { throw new Error('must not execute') } },
  }).completion
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('Expected context assembly failure.')
  assert.equal(result.error.code, 'context_assembly_failed')
  assert.equal(activityCalls, 0, 'context failure creates no durable activity or side effect')
}

async function testHistoricalAgentRunRejectedBeforeMutation(input) {
  const runStore = input.runStoreModule.createInMemoryRunStore()
  const agentRunId = input.core.asAssistantRunId('recover-agent-run')
  const initial = {
    id: agentRunId,
    kind: 'agent',
    conversationId: 'agent-recovery-conversation',
    providerId: 'islemind-activity',
    model: 'agent',
    contextSnapshotId: input.core.asContextSnapshotId('agent-recovery-context'),
    status: 'queued',
    createdAt: 1,
    journalSequence: 1,
  }
  const entry = {
    schema: 'islemind.assistant-run-journal-entry.v1',
    runId: agentRunId,
    sequence: 1,
    type: 'run.created',
    occurredAt: 1,
  }
  await assert.rejects(
    () => runStore.appendAndSave(entry, initial),
    /must be owned by Chat/,
  )
  assert.equal(await runStore.get(agentRunId), undefined)
  assert.deepEqual(await runStore.list(agentRunId), [], 'rejected Agent input cannot append journal state')
}

function createInMemoryContextSnapshotRepository() {
  const records = new Map()
  return {
    repository: {
      async save(record) {
        if (records.has(record.snapshot.id)) throw new Error('Context snapshots are immutable.')
        records.set(record.snapshot.id, structuredClone(record))
      },
      async get(id) {
        const record = records.get(id)
        return record ? structuredClone(record) : undefined
      },
    },
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error)
  process.exitCode = 1
})
