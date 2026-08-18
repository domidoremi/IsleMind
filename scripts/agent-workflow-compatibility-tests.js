const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const agentServiceIndexPath = path.join(root, 'src/services/agent/index.ts')
const legacyAgentOrchestratorPath = path.join(root, 'src/services/agent/agentOrchestrator.ts')
const orchestratorTargetPath = path.join(root, 'src/modules/tasks/application/workflowOrchestrator.ts')
const orchestratorCompositionPath = path.join(root, 'src/bootstrap/workflowOrchestrator.ts')
const retiredOrchestratorTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowOrchestrator.ts')
const retiredOrchestratorCompositionPath = path.join(root, 'src/bootstrap/agentWorkflowOrchestrator.ts')

registerTypeScriptSupport()

const {
  AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA,
  AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS,
  runAgentWorkflowCompatibilityEvaluation,
} = require('../src/modules/tasks/testing/workflowCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentWorkflowCompatibilityHook) return

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
  hook.isAgentWorkflowCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.policy.runtimeSchema, true, `${item.fixtureId} records runtime schema`)
  assert.equal(item.policy.stateMachine, true, `${item.fixtureId} uses finite state machine`)
  assert.equal(item.policy.maxSteps > 0 && item.policy.maxSteps <= 8, true, `${item.fixtureId} has bounded steps`)
  assert.equal(item.policy.maxToolCallsPerStep > 0 && item.policy.maxToolCallsPerStep <= 3, true, `${item.fixtureId} has bounded tool calls`)
  assert.equal(item.policy.visibleTrace, true, `${item.fixtureId} exposes visible trace`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.toolActionVisible, true, `${item.fixtureId} keeps tool action visible`)
  assert.equal(item.policy.outputCharLimit >= 512 && item.policy.outputCharLimit <= 12000, true, `${item.fixtureId} has output budget`)
  assert.equal(item.policy.cancellationSupported, true, `${item.fixtureId} supports cancellation`)
  assert.equal(item.policy.recoveryPrompt, true, `${item.fixtureId} has recovery prompt`)
  assert.equal(item.policy.resumePayloadSafe, true, `${item.fixtureId} has safe resume payload`)
  assert.equal(item.policy.backgroundContinuationAllowed, false, `${item.fixtureId} blocks background continuation`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts outputs`)
  assert.equal(item.policy.rawCommandAllowed, false, `${item.fixtureId} blocks raw commands`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertPaused(item) {
  assert.equal(item.readiness, 'paused', `${item.fixtureId} is paused`)
  assertReadyWithoutReadiness(item)
  assert.equal(item.policy.pendingActionRecorded, true, `${item.fixtureId} records pending action`)
}

function assertReadyWithoutReadiness(item) {
  assert.equal(item.policy.runtimeSchema, true, `${item.fixtureId} records runtime schema`)
  assert.equal(item.policy.stateMachine, true, `${item.fixtureId} uses finite state machine`)
  assert.equal(item.policy.visibleTrace, true, `${item.fixtureId} exposes visible trace`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} emits audit event`)
  assert.equal(item.policy.permissionChecked, true, `${item.fixtureId} checks permission`)
  assert.equal(item.policy.toolActionVisible, true, `${item.fixtureId} keeps tool action visible`)
  assert.equal(item.policy.backgroundContinuationAllowed, false, `${item.fixtureId} blocks background continuation`)
  assert.equal(item.policy.redaction, true, `${item.fixtureId} redacts outputs`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

async function run() {
  assert.equal(AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA, 'islemind.agent-workflow-compatibility-eval.v1', 'agent workflow schema is versioned')
  assert.deepEqual(
    AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS,
    [
      'runtime-state-machine-boundary',
      'direct-chat-controlled-bypass',
      'permission-pending-action-confirmation',
      'step-limit-human-resume',
      'cancellation-progress-recovery',
      'rag-evidence-repair-pause',
      'work-artifact-quality-audit',
      'handoff-diagnostic-visible-output',
      'runtime-trace-observability',
      'blocked-unbounded-autonomous-loop',
      'blocked-hidden-tool-action',
      'blocked-background-continuation',
      'blocked-unsafe-resume-payload',
    ],
    'agent workflow fixtures cover state machine, permissions, step limits, cancellation, evidence repair, artifacts, handoff, observability, and blocked paths'
  )

  const evaluation = runAgentWorkflowCompatibilityEvaluation({ now: () => 2700000000000 })
  assert.equal(evaluation.schema, AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `agent workflow gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const runKind of ['direct-chat', 'tool-workflow', 'saved-workflow', 'rag-evidence', 'work-artifact', 'handoff', 'diagnostic', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredRunKinds.includes(runKind), `quality gate tracks ${runKind}`)
  }
  for (const controlPattern of ['state-machine', 'permission-gate', 'step-limit', 'cancellation', 'evidence-repair', 'quality-audit', 'handoff', 'trace-observability', 'resume']) {
    assert.ok(evaluation.qualityGate.requiredControlPatterns.includes(controlPattern), `quality gate tracks ${controlPattern}`)
  }

  assertReady(diagnostic(evaluation, 'runtime-state-machine-boundary'))

  const directChat = diagnostic(evaluation, 'direct-chat-controlled-bypass')
  assertReady(directChat)
  assert.equal(directChat.policy.permissionChecked, false, 'direct chat does not require tool permission checks')
  assert.equal(directChat.policy.stepAttribution, false, 'direct chat does not require step attribution')

  const permission = diagnostic(evaluation, 'permission-pending-action-confirmation')
  assertPaused(permission)
  assert.equal(permission.policy.userConfirmationRequired, true, 'permission fixture requires confirmation')
  assert.equal(permission.policy.userConfirmationAvailable, true, 'permission fixture has visible confirmation')

  const stepLimit = diagnostic(evaluation, 'step-limit-human-resume')
  assertPaused(stepLimit)
  assert.equal(stepLimit.policy.recoveryPrompt, true, 'step-limit fixture has recovery prompt')

  assertReady(diagnostic(evaluation, 'cancellation-progress-recovery'))

  const ragRepair = diagnostic(evaluation, 'rag-evidence-repair-pause')
  assertPaused(ragRepair)
  assert.equal(ragRepair.policy.evidenceRepair, true, 'RAG evidence fixture has repair strategy')

  const workArtifact = diagnostic(evaluation, 'work-artifact-quality-audit')
  assertReady(workArtifact)
  assert.equal(workArtifact.policy.qualityAudit, true, 'work artifact fixture has quality audit')
  assert.equal(workArtifact.policy.evidenceRepair, true, 'work artifact fixture has evidence repair metadata')

  const handoff = diagnostic(evaluation, 'handoff-diagnostic-visible-output')
  assertReady(handoff)
  assert.equal(handoff.policy.qualityAudit, true, 'handoff fixture has quality audit')

  const observability = diagnostic(evaluation, 'runtime-trace-observability')
  assertReady(observability)
  assert.equal(observability.policy.auditEvent, true, 'observability fixture emits audit events')

  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-autonomous-loop'), [
    'step-limit-overrun',
    'tool-call-limit-overrun',
    'background-continuation-enabled',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-hidden-tool-action'), [
    'missing-visible-trace',
    'missing-audit-event',
    'missing-permission-check',
    'hidden-tool-action',
    'missing-user-confirmation',
    'missing-pending-action',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-background-continuation'), [
    'background-continuation-enabled',
    'missing-human-review',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-unsafe-resume-payload'), [
    'unsafe-resume-payload',
    'missing-redaction',
    'raw-command-enabled',
  ])

  assertWorkflowRuntimeOwnership()
  assertAgentWorkflowContinuationOwnership()
  assertWorkflowStepOutcomePolicy()
  assertWorkflowObservationPolicy()
  assertWorkflowRagEvidencePolicy()
  assertWorkflowPendingActionPolicy()
  assertAndroidWorkflowRuntimeStatePolicy()
  assertWorkflowPermissionEvidencePolicy()
  assertWorkflowAndroidUndoFollowUpPolicy()
  assertWorkflowFailurePolicy()
  assertWorkflowCompletionPolicy()
  assertWorkflowIntentClassifierOwnership()
  assertWorkflowPlannerOwnership()
  assertWorkflowStepExecutorOwnership()
  assertWorkflowExecutionRunContractOwnership()
  assertWorkflowCheckpointProjectionOwnership()
  assertConversationChatWorkflowMessageProjection()
  assertConversationChatWorkflowEntryRouting()
  await assertConversationChatWorkflowEntryTargetPolicy()
  await assertConversationChatWorkflowRuntimeTargetPolicy()
  await assertLiveCheckpointSeam()
  await assertLiveContinuationSeam()
  await assertInvalidWorkflowDefinitionNoDispatch()

  console.log('Agent workflow compatibility tests passed')
}

function assertConversationChatWorkflowEntryRouting() {
  const originalLoad = Module._load
  const entryPath = path.join(root, 'src/bootstrap/conversationChatWorkflowEntry.ts')
  delete require.cache[entryPath]
  Module._load = function loadAgentIntentEntryDependency(request, parent, isMain) {
    if (request === '@/bootstrap/workflowIntent') {
      const taskModule = require('../src/modules/tasks/index.ts')
      return {
        workflowIntentClassifier: taskModule.createWorkflowIntentClassifier({
          clock: { now: () => 630 },
          projectTrace: (trace) => ({
            ...trace,
            completedAt: trace.completedAt ?? trace.startedAt,
            durationMs: trace.durationMs ?? 0,
          }),
        }),
      }
    }
    if (request === '@/bootstrap/workflowOrchestrator') return { runWorkflow: async () => ({}) }
    if (request === '@/bootstrap/workflowSkills') {
      return { createWorkflowSkillSuggestionFromRun: () => undefined }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const { decideConversationChatWorkflowEntry } = require(entryPath)
    const direct = decideConversationChatWorkflowEntry({ content: 'Continue the conversation normally.', now: 630 })
    assert.equal(direct.shouldHandle, false)
    assert.equal(direct.reason, 'direct-chat')

    const settings = decideConversationChatWorkflowEntry({ content: 'Please set the dark theme.', now: 631 })
    assert.equal(settings.shouldHandle, false)
    assert.equal(settings.reason, 'direct-chat')

    const missingRag = decideConversationChatWorkflowEntry({ content: 'Verify this claim with cited evidence.', now: 632 })
    assert.equal(missingRag.shouldHandle, false)
    assert.equal(missingRag.reason, 'direct-chat')

    const readyRag = decideConversationChatWorkflowEntry({
      content: 'Verify this claim with cited evidence.',
      ragRuntime: { buildContextPack: async () => ({}) },
      now: 633,
    })
    assert.equal(readyRag.shouldHandle, false)
    assert.equal(readyRag.reason, 'direct-chat')

    const malformedUndo = decideConversationChatWorkflowEntry({
      content: 'Android SAF undo. Undo operations JSON: [{"kind":]',
      now: 634,
    })
    assert.equal(malformedUndo.shouldHandle, false)
    assert.equal(malformedUndo.reason, 'direct-chat')
  } finally {
    Module._load = originalLoad
    delete require.cache[entryPath]
  }
}

async function assertConversationChatWorkflowEntryTargetPolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/conversationChatWorkflowEntryPolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentChatEntryPolicy.ts')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  assert.equal(typeof taskModule.createConversationChatWorkflowEntryPolicy, 'function', 'Tasks public API exposes the Chat workflow-entry policy factory')
  assert.equal(taskModule.createAgentChatEntryPolicy, undefined, 'Tasks public API does not retain the Agent Chat-entry factory')
  assert.equal(fs.existsSync(targetPath), true, 'the Chat workflow-entry policy exists')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the retired Agent Chat-entry policy stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentChatEntry.ts')), false, 'covered Agent Chat-entry service stays deleted')
  assert.equal(fs.existsSync(agentServiceIndexPath), false, 'the obsolete Agent service barrel stays deleted')
  assert.match(taskEntrySource, /export \* from '\.\/application\/conversationChatWorkflowEntryPolicy'/)
  assert.doesNotMatch(taskEntrySource, /export \* from '\.\/application\/agentChatEntryPolicy'/)

  const trace = Object.freeze({
    id: 'entry-classification',
    type: 'reasoning',
    title: 'Agent intent',
    status: 'done',
    startedAt: 1,
    metadata: Object.freeze({ retained: true }),
  })
  let runCalls = 0
  let receivedRunInput
  const completedTrace = Object.freeze({
    id: 'workflow-complete',
    type: 'reasoning',
    title: 'Agent workflow',
    status: 'done',
    startedAt: 2,
    metadata: Object.freeze({ status: 'done', retained: true }),
  })
  const trailingTrace = Object.freeze({
    id: 'workflow-trailing',
    type: 'system',
    title: 'Trailing',
    status: 'done',
    startedAt: 3,
  })
  const run = Object.freeze({
    status: 'done',
    finalOutput: '  Completed output.  ',
    traces: Object.freeze([completedTrace, trailingTrace]),
  })
  const policy = taskModule.createConversationChatWorkflowEntryPolicy({
    classifyConversationChatWorkflowIntent: (input) => ({
      intent: input.content === 'tool_task_ready' ? 'tool_task' : input.content,
      shouldRunWorkflow: input.content !== 'plain_chat',
      confidence: 1,
      reasons: ['fixture'],
      ...(input.content === 'tool_task_ready' ? { suggestedToolRequest: { name: 'fixture.tool' } } : {}),
      trace,
    }),
    runConversationChatWorkflow: async (input) => {
      runCalls += 1
      receivedRunInput = input
      return run
    },
    createWorkflowSkillSuggestionFromRun: ({ run: suggestionRun, manifests, now }) => ({
      ok: suggestionRun === run && manifests[0]?.id === 'manifest-1' && now === 99,
      skill: { id: 'skill-1' },
    }),
  })

  const direct = policy.decideConversationChatWorkflowEntry({ content: 'plain_chat' })
  assert.equal(direct.shouldHandle, false)
  assert.equal(direct.reason, 'direct-chat')
  assert.equal(direct.traces[0], trace, 'classification trace identity is preserved')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'settings_action' }).reason, 'settings-local-command-router')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'work_artifact' }).reason, 'work-artifact')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'rag_evidence' }).reason, 'rag-runtime-missing')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'rag_evidence', ragRuntime: {} }).reason, 'rag-runtime-ready')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'tool_task' }).reason, 'planner-tool-missing')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'tool_task_ready' }).reason, 'explicit-tool-request')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'plain_chat', explicitToolRequest: { name: 'fixture' } }).reason, 'explicit-tool-request', 'explicit tools take precedence over direct Chat classification')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'plain_chat', workflowDefinition: {} }).reason, 'selected-workflow-skill', 'selected workflows take precedence over classification')

  const aborted = new AbortController()
  aborted.abort('cancel-entry')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'plain_chat', explicitToolRequest: { name: 'fixture' }, signal: aborted.signal }).reason, 'cancelled')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'plain_chat', forceConversationChatWorkflowCancellation: true, signal: aborted.signal }).reason, 'cancelled')
  assert.equal(policy.decideConversationChatWorkflowEntry({ content: 'plain_chat', signal: aborted.signal }).reason, 'direct-chat', 'ordinary direct Chat does not claim unrelated cancellation')

  const skipped = await policy.runConversationChatWorkflow({ content: 'plain_chat' })
  assert.deepEqual(skipped, {
    handled: false,
    status: 'skipped',
    content: 'Direct chat path selected.',
    traces: [trace],
  })
  assert.equal(runCalls, 0, 'skipped Chat entry starts no workflow')

  const manifest = Object.freeze({ id: 'manifest-1' })
  const input = Object.freeze({
    content: 'work_artifact',
    assistantRunId: 'assistant-run-entry',
    workflowCheckpointStore: Object.freeze({}),
    explicitToolRequest: Object.freeze({ name: 'fixture.tool', arguments: Object.freeze({ value: 1 }) }),
    requestedOutput: 'work-artifact',
    mode: 'agent',
    workflowDefinition: Object.freeze({ id: 'workflow-1' }),
    manifests: Object.freeze([manifest]),
    ragRuntime: Object.freeze({}),
    runtimeLog: Object.freeze({ enabled: true, maxBytes: 2048 }),
    limits: Object.freeze({ maxSteps: 2 }),
    intentVisible: true,
    userConfirmed: true,
    signal: new AbortController().signal,
    now: 99,
  })
  const before = JSON.stringify(input)
  const reply = await policy.runConversationChatWorkflow(input)
  assert.equal(runCalls, 1)
  assert.equal(receivedRunInput.goal, input.content)
  assert.equal(receivedRunInput.toolRequest, input.explicitToolRequest)
  assert.equal(receivedRunInput.workflowCheckpointStore, input.workflowCheckpointStore)
  assert.equal(receivedRunInput.manifests, input.manifests)
  assert.equal(receivedRunInput.signal, input.signal, 'the exact cancellation signal reaches the workflow runner')
  assert.equal(Object.hasOwn(receivedRunInput, 'mode'), false, 'legacy mode extras never reach the workflow runner')
  assert.equal(reply.handled, true)
  assert.equal(reply.status, 'done')
  assert.equal(reply.content, 'Completed output.')
  assert.equal(reply.run, run)
  assert.equal(reply.traces[0].metadata.workflowSkillSuggestion.skill.id, 'skill-1', 'skill suggestion attaches to the matching completion trace')
  assert.equal(reply.traces[1], trailingTrace, 'non-target traces retain identity')
  assert.equal(completedTrace.metadata.workflowSkillSuggestion, undefined, 'trace suggestion attachment does not mutate the workflow run')
  assert.equal(JSON.stringify(input), before, 'Agent Chat entry does not mutate caller input')
  assert.equal(policy.formatConversationChatWorkflowReply({ status: 'waiting', traces: [], failureCode: 'permission_required' }), 'Agentic workflow paused: permission_required.')
  assert.equal(policy.formatConversationChatWorkflowReply({ status: 'cancelled', traces: [] }), 'Agentic workflow was cancelled.')
  assert.equal(policy.formatConversationChatWorkflowReply({ status: 'error', traces: [] }), 'Agentic workflow failed: execution_failed.')
}

async function assertConversationChatWorkflowRuntimeTargetPolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/conversationChatWorkflowRuntimePolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentChatRuntimePolicy.ts')
  const bindingPath = path.join(root, 'src/bootstrap/conversationChatWorkflowResolutionRuntime.ts')
  const legacyPath = path.join(root, 'src/services/agent/agentChatRuntime.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bindingSource = fs.readFileSync(bindingPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.createConversationChatWorkflowRuntimePolicy, 'function', 'Tasks public API exposes the Chat workflow runtime policy factory')
  assert.equal(taskModule.createAgentChatRuntimePolicy, undefined, 'Tasks public API does not retain the Agent Chat runtime factory')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the retired Agent Chat runtime policy stays deleted')
  assert.equal(fs.existsSync(legacyPath), false, 'the covered Agent Chat runtime facade stays deleted')
  assert.doesNotMatch(targetSource, /@\/services\//, 'the Tasks-owned Agent Chat runtime has no service dependency')
  assert.doesNotMatch(targetSource, /@\/bootstrap\//, 'the Tasks-owned Agent Chat runtime has no composition dependency')
  assert.doesNotMatch(targetSource, /@\/(?:platform|presentation)\//, 'the Tasks-owned Agent Chat runtime has no platform or presentation dependency')
  assert.doesNotMatch(targetSource, /\b(?:React|Expo|Zustand)\b/, 'the Tasks-owned Agent Chat runtime has no framework dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the Tasks-owned Agent Chat runtime uses its injected clock')
  assert.doesNotMatch(
    targetSource,
    /ConversationChatWorkflowEntryMode|CONVERSATION_CHAT_WORKFLOW_EXECUTION_MODE|\binput\.mode\b|\bmode\s*:\s*['"](?:chat|agent|companion)['"]/,
    'the Chat workflow runtime exposes or forwards no execution-mode discriminator',
  )
  assert.match(taskEntrySource, /export \* from '\.\/application\/conversationChatWorkflowRuntimePolicy'/)
  assert.doesNotMatch(taskEntrySource, /export \* from '\.\/application\/agentChatRuntimePolicy'/)
  assert.match(bindingSource, /createConversationChatWorkflowRuntimePolicy\(\{/)
  assert.match(bindingSource, /export const decideConversationChatWorkflowAssistantMessage/)
  assert.match(bindingSource, /export const resolveConversationChatWorkflowAssistantMessage/)
  assert.equal(fs.existsSync(agentServiceIndexPath), false, 'the obsolete Agent service barrel stays deleted')
  const replyStartSource = fs.readFileSync(path.join(root, 'src/bootstrap/conversationReplyStart.ts'), 'utf8')
  const replyDispatchSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/conversationReplyDispatchController.ts'), 'utf8')
  assert.doesNotMatch(replyDispatchSource, /agentChatRuntime|decideAgentRuntimeAssistantMessage/, 'typed Chat cannot consult Agent intent before Assistant Runtime')
  assert.doesNotMatch(replyStartSource, /decideAgentRuntimeAssistantMessage/, 'typed Chat has no local Agent routing authority')
  assert.doesNotMatch(replyStartSource, /@\/services\/agent\/agentChatRuntime/, 'typed Chat cannot restore the deleted runtime facade')

  assert.match(replyStartSource, /@\/bootstrap\/conversationChatWorkflowResolutionRuntime/, 'the explicit structured Chat workflow uses the single Tasks compatibility binding')
  assert.match(replyStartSource, /resolveChatWorkflowReply: resolveConversationChatWorkflowAssistantMessage/, 'the Chat workflow contract receives the compatibility Tasks resolver only through the Chat-neutral bootstrap seam')
  assert.doesNotMatch(replyStartSource, /@\/services\/agent\/agentChatRuntime/, 'the explicit structured Chat workflow cannot restore the deleted runtime facade')
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/conversationAgentReplyStart.ts')), false, 'the Agent-named reply-start bootstrap stays deleted')

  const trace = Object.freeze({
    id: 'runtime-classification',
    type: 'reasoning',
    title: 'Agent runtime fixture',
    status: 'done',
    startedAt: 41,
  })
  let resolvedInput
  const workflowReply = Object.freeze({
    handled: true,
    content: 'Agent runtime completed.',
    status: 'done',
    traces: Object.freeze([trace]),
    run: Object.freeze({ status: 'done', traces: Object.freeze([trace]), steps: Object.freeze([]) }),
  })
  const resolutionPatch = Object.freeze({
    content: 'Agent runtime completed.',
    responseText: 'Agent runtime completed.',
    status: 'sent',
    usage: Object.freeze({}),
    tokenCount: 0,
    completedAt: 42,
  })
  const dependencies = {
    clock: { now: () => 41 },
    chatEntry: {
      decideConversationChatWorkflowEntry: (input) => ({
        shouldHandle: Boolean(input.explicitToolRequest || input.workflowDefinition),
        reason: input.signal?.aborted
          ? 'cancelled'
          : input.workflowDefinition
            ? 'selected-workflow-skill'
            : input.explicitToolRequest
              ? 'explicit-tool-request'
              : 'direct-chat',
        classification: {
          intent: input.explicitToolRequest || input.workflowDefinition ? 'tool_task' : 'plain_chat',
          shouldRunWorkflow: Boolean(input.explicitToolRequest || input.workflowDefinition),
          confidence: 1,
          reasons: ['fixture'],
          suggestedToolRequest: input.explicitToolRequest,
          trace,
        },
        traces: [trace],
      }),
      resolveConversationChatWorkflowAssistantMessage: async (input) => {
        resolvedInput = input
        return {
          handled: true,
          reply: workflowReply,
          patch: resolutionPatch,
        }
      },
      buildConversationChatWorkflowAssistantMessagePatch: (reply) => ({
        content: reply.content,
        responseText: reply.content,
        status: 'sent',
        usage: {},
        tokenCount: 0,
        completedAt: 42,
      }),
    },
    workflows: {
      definitionPolicy: { validate: (workflow) => ({ ok: true, definition: workflow }) },
      skillPolicy: {
        extractWorkflowDefinitionsFromSkillSnapshot: () => [],
        hasWorkflowDefinitionCandidatesInSkillSnapshot: () => false,
        listBlockedWorkflowStatesForSkillSnapshot: async () => [],
        listEnabledWorkflowIdsForSkillSnapshot: async () => [],
      },
      androidCatalog: { list: () => [], isBuiltInWorkflowId: () => false },
    },
    search: taskModule.createWorkflowSearchToolAdmissionPolicy({
      resolveSearchProvider: (settings) => settings.searchProvider ?? 'off',
      builtinSearchTool: {
        toolId: 'builtin:islemind-builtins:search_web',
        source: 'builtin',
        serverId: 'islemind-builtins',
        name: 'search_web',
      },
    }),
    tools: {
      listConversationToolManifests: async () => [],
      listStaticConversationToolManifests: () => [],
    },
    rag: {
      createConversationRagRuntime: () => ({ buildContextPack: async () => ({}) }),
      createRagQueryPlan: () => ({}),
    },
    trace: {
      projectTrace: (value) => value,
      redactSensitiveText: (value) => value,
      clampWorkflowOutput: (value, limit) => value.slice(0, limit),
    },
  }
  const policy = taskModule.createConversationChatWorkflowRuntimePolicy(dependencies)

  const conversation = Object.freeze({
    id: 'conversation-runtime-fixture',
    title: 'Runtime fixture',
    messages: Object.freeze([]),
    skillSnapshot: Object.freeze([]),
  })
  const settings = Object.freeze({
    runtimeLogEnabled: true,
    runtimeLogMaxBytes: 2048,
    webSearchEnabled: true,
    searchProvider: 'native',
  })
  const baseInput = Object.freeze({ conversation, content: 'Continue normally.', settings })
  const before = JSON.stringify(baseInput)
  assert.deepEqual(policy.decideConversationChatWorkflowAssistantMessage(baseInput), {
    shouldHandle: false,
    reason: 'direct-chat',
    traces: [trace],
  })
  assert.equal(JSON.stringify(baseInput), before, 'Agent Chat runtime does not mutate frozen caller input')

  const attachmentDecision = policy.decideConversationChatWorkflowAssistantMessage({
    ...baseInput,
    attachments: [{ id: 'attachment-fixture' }],
  })
  assert.deepEqual(attachmentDecision, { shouldHandle: false, reason: 'attachments', traces: [] })

  const signal = new AbortController().signal
  const explicitToolRequest = Object.freeze({ toolId: 'fixture.tool', name: 'fixture_tool', source: 'builtin' })
  const resolution = await policy.resolveConversationChatWorkflowAssistantMessage({
    ...baseInput,
    explicitToolRequest,
    manifests: Object.freeze([]),
    signal,
    startedAt: 40,
  })
  assert.equal(resolution.handled, true)
  assert.equal(resolution.reply, workflowReply, 'the assistant workflow reply retains dependency identity')
  assert.equal(resolution.patch, resolutionPatch, 'the assistant patch retains dependency identity')
  assert.equal(resolvedInput.signal, signal, 'the exact task cancellation signal reaches the Agent Chat resolver')
  assert.equal(resolvedInput.explicitToolRequest, explicitToolRequest, 'the exact tool request reaches the Agent Chat resolver')

  const deferredSearch = policy.decideConversationChatWorkflowAssistantMessage({
    ...baseInput,
    explicitToolRequest: { name: 'search_web', source: 'builtin' },
  })
  assert.equal(deferredSearch.shouldHandle, false, 'provider-native search admission defers the local built-in search path')
  assert.equal(deferredSearch.reason, 'workflow-not-handled')
  const disabledSearch = policy.decideConversationChatWorkflowAssistantMessage({
    ...baseInput,
    settings: Object.freeze({ ...settings, searchProvider: 'off' }),
    explicitToolRequest: { name: 'search_web', source: 'builtin' },
  })
  assert.equal(disabledSearch.shouldHandle, false, 'off search admission defers the local built-in search path')
  assert.equal(disabledSearch.reason, 'workflow-not-handled')
  const localSearch = policy.decideConversationChatWorkflowAssistantMessage({
    ...baseInput,
    settings: Object.freeze({ ...settings, searchProvider: 'tavily' }),
    explicitToolRequest: { name: 'search_web', source: 'builtin' },
  })
  assert.equal(localSearch.shouldHandle, true, 'configured local search remains eligible for workflow execution')
  assert.equal(localSearch.reason, 'explicit-tool-request')

  const workflowManifest = Object.freeze({
    id: 'fixture.workflow.tool',
    source: 'builtin',
    name: 'fixture_workflow_tool',
    description: 'Fixture workflow tool',
    permission: 'read',
    enabled: true,
  })
  const workflow = Object.freeze({
    schema: 'islemind.agent-workflow.v1',
    id: 'fixture-workflow',
    name: 'Fixture Workflow',
    enabled: true,
    triggerHints: Object.freeze(['fixture workflow']),
    steps: Object.freeze([]),
    permissionCeiling: 'read',
    expectedOutput: 'reply',
    acceptanceChecks: Object.freeze([]),
    createdAt: 1,
    updatedAt: 1,
  })
  const createWorkflowPolicy = (workflows, dependencyOverrides = {}) =>
    taskModule.createConversationChatWorkflowRuntimePolicy({
      ...dependencies,
      ...dependencyOverrides,
      workflows: {
        ...dependencies.workflows,
        skillPolicy: {
          extractWorkflowDefinitionsFromSkillSnapshot: () => workflows,
          hasWorkflowDefinitionCandidatesInSkillSnapshot: () => workflows.length > 0,
          listBlockedWorkflowStatesForSkillSnapshot: async () => [],
          listEnabledWorkflowIdsForSkillSnapshot: async () => workflows.map((item) => item.id),
        },
        ...(dependencyOverrides.workflows ?? {}),
      },
    })

  const workflowPolicy = createWorkflowPolicy([workflow])
  const selectedInput = Object.freeze({
    ...baseInput,
    content: 'Run the fixture workflow.',
    manifests: Object.freeze([workflowManifest]),
    enabledWorkflowIds: Object.freeze([workflow.id]),
  })
  const selectedBefore = JSON.stringify(selectedInput)
  const selected = workflowPolicy.decideConversationChatWorkflowAssistantMessage(selectedInput)
  assert.equal(selected.shouldHandle, true)
  assert.equal(selected.reason, 'selected-workflow-skill')
  await workflowPolicy.resolveConversationChatWorkflowAssistantMessage(selectedInput)
  assert.equal(resolvedInput.workflowDefinition, workflow, 'selected workflow identity reaches the assistant resolver unchanged')
  assert.equal(JSON.stringify(selectedInput), selectedBefore, 'selected workflow routing does not mutate frozen nested inputs')

  for (const reason of ['workflow-disabled', 'workflow-review-required', 'workflow-invalid']) {
    const blockedInput = Object.freeze({
      ...selectedInput,
      blockedWorkflowStates: Object.freeze([Object.freeze({ workflowId: workflow.id, reason })]),
    })
    const blockedBefore = JSON.stringify(blockedInput)
    const blocked = workflowPolicy.decideConversationChatWorkflowAssistantMessage(blockedInput)
    assert.equal(blocked.shouldHandle, true)
    assert.equal(blocked.reason, reason)
    assert.equal(blocked.traces[0].metadata.reason, reason)
    assert.equal(blocked.traces[0].startedAt, 41, 'blocked workflow traces use the injected clock')
    const blockedResolution = await workflowPolicy.resolveConversationChatWorkflowAssistantMessage(blockedInput)
    assert.equal(blockedResolution.handled, true)
    assert.equal(blockedResolution.reason, reason)
    assert.equal(blockedResolution.patch.content, blockedResolution.reply.content)
    assert.equal(JSON.stringify(blockedInput), blockedBefore, 'blocked workflow routing leaves inputs stable')
  }

  const { workflowDefinitionPolicy } = require('../src/bootstrap/workflowDefinitions.ts')
  const catalogBoundWorkflow = workflowDefinitionPolicy.create({
    id: 'workflow-empty-catalog',
    name: 'Empty catalog workflow',
    triggerHints: ['empty catalog workflow'],
    steps: [{
      id: 'step-1',
      title: 'Read the runtime fixture',
      toolRequest: {
        toolId: 'builtin:fixture:read',
        name: 'fixture.read',
        source: 'builtin',
      },
    }],
    now: 43,
  })
  const catalogBoundSkill = Object.freeze({
    id: 'skill-workflow-empty-catalog',
    name: 'Empty catalog workflow',
    description: 'Exercises fail-closed workflow catalog admission.',
    systemPrompt: `Workflow definition:\n${workflowDefinitionPolicy.serialize(catalogBoundWorkflow)}`,
    tags: Object.freeze([
      'agent-workflow',
      `workflow:${catalogBoundWorkflow.id}`,
      'workflow-status:enabled',
      'approval:user-visible',
    ]),
  })
  const liveSkillPolicy = taskModule.createWorkflowSkillPolicy({
    workflowDefinitionPolicy,
    persistence: {
      listSkills: async () => [catalogBoundSkill],
      upsertSkill: async (skill) => skill,
    },
    now: () => 43,
    redactSensitiveText: (value) => value,
    clampWorkflowOutput: (value, limit) => value.slice(0, limit),
    formatToolRequestIdentity: (request) => request?.toolId ?? request?.name ?? '',
    resolveUniqueManifest: () => undefined,
  })
  let emptyCatalogEntryDecisionCalls = 0
  let emptyCatalogEntryResolutionCalls = 0
  const emptyCatalogPolicy = taskModule.createConversationChatWorkflowRuntimePolicy({
    ...dependencies,
    chatEntry: {
      ...dependencies.chatEntry,
      decideConversationChatWorkflowEntry: (input) => {
        emptyCatalogEntryDecisionCalls += 1
        return dependencies.chatEntry.decideConversationChatWorkflowEntry(input)
      },
      resolveConversationChatWorkflowAssistantMessage: async (input) => {
        emptyCatalogEntryResolutionCalls += 1
        return dependencies.chatEntry.resolveConversationChatWorkflowAssistantMessage(input)
      },
    },
    workflows: {
      ...dependencies.workflows,
      definitionPolicy: workflowDefinitionPolicy,
      skillPolicy: liveSkillPolicy,
    },
    tools: {
      ...dependencies.tools,
      listConversationToolManifests: async () => [],
    },
  })
  const emptyCatalogInput = Object.freeze({
    ...baseInput,
    content: 'Run the empty catalog workflow.',
    workflowId: catalogBoundWorkflow.id,
    conversation: Object.freeze({
      ...conversation,
      skillSnapshot: Object.freeze({
        skillIds: Object.freeze([catalogBoundSkill.id]),
        names: Object.freeze([catalogBoundSkill.name]),
        systemPrompt: catalogBoundSkill.systemPrompt,
        variables: Object.freeze({}),
      }),
    }),
    startedAt: 43,
  })
  const explicitEmptyCatalog = await emptyCatalogPolicy.resolveConversationChatWorkflowAssistantMessage({
    ...emptyCatalogInput,
    manifests: Object.freeze([]),
  })
  assert.equal(explicitEmptyCatalog.handled, true)
  assert.equal(explicitEmptyCatalog.reason, 'workflow-invalid', 'an explicit empty manifest catalog blocks the selected workflow')
  const dynamicEmptyCatalog = await emptyCatalogPolicy.resolveConversationChatWorkflowAssistantMessage(emptyCatalogInput)
  assert.equal(dynamicEmptyCatalog.handled, true)
  assert.equal(dynamicEmptyCatalog.reason, 'workflow-invalid', 'a dynamically resolved empty manifest catalog blocks the selected workflow')
  assert.equal(emptyCatalogEntryDecisionCalls, 0, 'empty-catalog workflow admission never invokes Chat workflow planning')
  assert.equal(emptyCatalogEntryResolutionCalls, 0, 'empty-catalog workflow admission never reaches workflow execution')

  const secondWorkflow = Object.freeze({
    ...workflow,
    id: 'fixture-workflow-two',
    name: 'Second Fixture Workflow',
    triggerHints: Object.freeze(['second workflow']),
  })
  const ambiguousPolicy = createWorkflowPolicy([workflow, secondWorkflow])
  const ambiguousInput = Object.freeze({
    ...baseInput,
    content: 'Run one of the selected workflows.',
    manifests: Object.freeze([workflowManifest]),
    enabledWorkflowIds: Object.freeze([workflow.id, secondWorkflow.id]),
  })
  const ambiguous = ambiguousPolicy.decideConversationChatWorkflowAssistantMessage(ambiguousInput)
  assert.equal(ambiguous.shouldHandle, true)
  assert.equal(ambiguous.reason, 'workflow-selection-ambiguous')
  assert.deepEqual(ambiguous.traces[0].metadata.workflowIds, [workflow.id, secondWorkflow.id])
  assert.equal((await ambiguousPolicy.resolveConversationChatWorkflowAssistantMessage(ambiguousInput)).reason, 'workflow-selection-ambiguous')

  const isolatedPolicy = createWorkflowPolicy([workflow], {
    clock: { now: () => 99 },
    trace: {
      ...dependencies.trace,
      redactSensitiveText: (value) => `isolated:${value}`,
    },
  })
  const isolatedBlocked = isolatedPolicy.decideConversationChatWorkflowAssistantMessage({
    ...selectedInput,
    blockedWorkflowStates: [{ workflowId: workflow.id, reason: 'workflow-disabled' }],
  })
  assert.equal(isolatedBlocked.traces[0].startedAt, 99, 'independent policy factories retain their own clocks')
  assert.equal(isolatedBlocked.traces[0].metadata.workflowName, 'isolated:Fixture Workflow')
  assert.equal(blockedTraceName(workflowPolicy, selectedInput), 'Fixture Workflow', 'policy factories retain independent redactors')

  let dynamicCatalogCalls = 0
  const decidedInputs = []
  let selectedBuiltInWorkflow
  const builtInWorkflow = Object.freeze({ ...workflow, id: 'fixture-built-in-workflow', name: 'Built-in Workflow' })
  const modePolicy = taskModule.createConversationChatWorkflowRuntimePolicy({
    ...dependencies,
    chatEntry: {
      ...dependencies.chatEntry,
      decideConversationChatWorkflowEntry: (input) => {
        decidedInputs.push(input)
        selectedBuiltInWorkflow = input.workflowDefinition
        return dependencies.chatEntry.decideConversationChatWorkflowEntry(input)
      },
    },
    workflows: {
      ...dependencies.workflows,
      androidCatalog: {
        list: () => [builtInWorkflow],
        isBuiltInWorkflowId: (id) => id === builtInWorkflow.id,
      },
    },
    tools: {
      listConversationToolManifests: async () => {
        dynamicCatalogCalls += 1
        return [workflowManifest]
      },
      listStaticConversationToolManifests: () => [workflowManifest],
    },
  })

  const omittedModeInput = Object.freeze({ ...baseInput, content: 'Run built-in.', workflowId: builtInWorkflow.id })
  assert.equal(modePolicy.decideConversationChatWorkflowAssistantMessage(omittedModeInput).reason, 'selected-workflow-skill')
  assert.equal(Object.hasOwn(decidedInputs.at(-1), 'mode'), false, 'workflow selection receives no execution-mode field')
  assert.equal(selectedBuiltInWorkflow, builtInWorkflow)
  await modePolicy.resolveConversationChatWorkflowAssistantMessage(omittedModeInput)
  assert.equal(dynamicCatalogCalls, 1, 'omitted mode lists through the intrinsically Chat-owned dynamic catalog')
  assert.equal(Object.hasOwn(decidedInputs.at(-1), 'mode'), false, 'workflow resolution receives no execution-mode field')
  assert.equal(Object.hasOwn(resolvedInput, 'mode'), false, 'assistant-message resolution receives no execution-mode field')

  const modeInput = Object.freeze({ ...baseInput, content: 'Run built-in.', workflowId: builtInWorkflow.id, mode: 'companion' })
  assert.equal(modePolicy.decideConversationChatWorkflowAssistantMessage(modeInput).reason, 'selected-workflow-skill')
  assert.equal(Object.hasOwn(decidedInputs.at(-1), 'mode'), false, 'workflow selection strips forged Companion mode data')
  assert.equal(selectedBuiltInWorkflow, builtInWorkflow)
  await modePolicy.resolveConversationChatWorkflowAssistantMessage(modeInput)
  assert.equal(dynamicCatalogCalls, 2, 'dynamic catalogs ignore historical Companion metadata')
  assert.equal(Object.hasOwn(resolvedInput, 'mode'), false, 'assistant-message resolution strips forged Companion mode data')
  assert.equal(modeInput.mode, 'companion', 'mode stripping does not mutate frozen caller input')

  const historicalAgentModeInput = Object.freeze({ ...baseInput, content: 'Run built-in.', workflowId: builtInWorkflow.id, mode: 'agent' })
  assert.equal(modePolicy.decideConversationChatWorkflowAssistantMessage(historicalAgentModeInput).reason, 'selected-workflow-skill')
  assert.equal(Object.hasOwn(decidedInputs.at(-1), 'mode'), false, 'workflow selection strips forged Agent mode data')
  await modePolicy.resolveConversationChatWorkflowAssistantMessage(historicalAgentModeInput)
  assert.equal(dynamicCatalogCalls, 3, 'dynamic catalogs ignore explicit historical Agent metadata')
  assert.equal(Object.hasOwn(resolvedInput, 'mode'), false, 'assistant-message resolution strips forged Agent mode data')
  assert.equal(historicalAgentModeInput.mode, 'agent', 'Agent-mode compatibility input remains inert caller data')

  let capturedRagRuntime
  let retrievedConversation
  let retrievedDraft
  let retrievedSignal
  let retrievalCalls = 0
  const ragPolicy = taskModule.createConversationChatWorkflowRuntimePolicy({
    ...dependencies,
    chatEntry: {
      ...dependencies.chatEntry,
      decideConversationChatWorkflowEntry: (input) => {
        capturedRagRuntime = input.ragRuntime
        return dependencies.chatEntry.decideConversationChatWorkflowEntry(input)
      },
    },
    rag: {
      ...dependencies.rag,
      createRagQueryPlan: (input) => ({
        query: input.query,
        rewrittenQueries: [input.query],
        contextItemBudget: input.maxContextItems ?? 3,
        tokenBudget: input.tokenBudget ?? 256,
      }),
    },
  })
  const retrieveContext = async (contextConversation, draftMessage, taskSignal) => {
    retrievalCalls += 1
    retrievedConversation = contextConversation
    retrievedDraft = draftMessage
    retrievedSignal = taskSignal
    return { sources: [], prompt: '' }
  }
  const ragInput = Object.freeze({ ...baseInput, retrieveContext })
  ragPolicy.decideConversationChatWorkflowAssistantMessage(ragInput)
  const ragSignal = new AbortController().signal
  const ragPack = await capturedRagRuntime.buildContextPack(
    Object.freeze({ query: 'fixture evidence', conversationTitle: 'Request title', maxContextItems: 2 }),
    { signal: ragSignal },
  )
  assert.equal(retrievedSignal, ragSignal, 'retrieveContext receives the exact RAG cancellation signal')
  assert.equal(retrievedConversation.title, 'Request title')
  assert.equal(retrievedDraft.content, 'fixture evidence')
  assert.equal(ragPack.plan.query, 'fixture evidence')
  assert.equal(ragPack.sources.length, 0)
  const preAborted = new AbortController()
  preAborted.abort('cancel-before-agent-rag')
  await assert.rejects(
    () => capturedRagRuntime.buildContextPack({ query: 'cancelled' }, { signal: preAborted.signal }),
    (error) => error?.name === 'AbortError' && error?.message === 'RAG retrieval was cancelled.',
  )
  assert.equal(retrievalCalls, 1, 'pre-aborted Agent RAG work performs no retrieval')

  let factoryInput
  let factorySignal
  let factoryRuntime
  const factoryRagPolicy = taskModule.createConversationChatWorkflowRuntimePolicy({
    ...dependencies,
    chatEntry: {
      ...dependencies.chatEntry,
      decideConversationChatWorkflowEntry: (input) => {
        factoryRuntime = input.ragRuntime
        return dependencies.chatEntry.decideConversationChatWorkflowEntry(input)
      },
    },
    rag: {
      ...dependencies.rag,
      createConversationRagRuntime: (input) => {
        factoryInput = input
        return {
          buildContextPack: async (request, options) => {
            factorySignal = options?.signal
            await input.retrieveKnowledge(request.query, 1, options)
            return { plan: { query: request.query }, sources: [], citations: [], contextPrompt: '', trace: [], quality: {}, retrievalStats: {} }
          },
        }
      },
    },
  })
  let knowledgeSignal
  const retrieveKnowledge = async (_query, _limit, options) => {
    knowledgeSignal = options?.signal
    return []
  }
  const retrieveAgentic = async () => []
  factoryRagPolicy.decideConversationChatWorkflowAssistantMessage({
    ...baseInput,
    retrieveKnowledge,
    retrieveAgentic,
  })
  assert.equal(factoryInput.retrieveKnowledge, retrieveKnowledge, 'Knowledge retrieval callback identity reaches the injected RAG factory')
  assert.equal(factoryInput.retrieveAgentic, retrieveAgentic, 'Agentic retrieval callback identity reaches the injected RAG factory')
  const factoryController = new AbortController()
  await factoryRuntime.buildContextPack({ query: 'factory signal' }, { signal: factoryController.signal })
  assert.equal(factorySignal, factoryController.signal)
  assert.equal(knowledgeSignal, factoryController.signal, 'the exact task signal can cross the typed Knowledge compatibility callback')

  const unhandledReply = Object.freeze({ handled: false, content: 'Skipped.', status: 'skipped', traces: Object.freeze([trace]) })
  const unhandledPolicy = taskModule.createConversationChatWorkflowRuntimePolicy({
    ...dependencies,
    chatEntry: {
      ...dependencies.chatEntry,
      resolveConversationChatWorkflowAssistantMessage: async () => ({ handled: false, reply: unhandledReply }),
    },
  })
  const unhandled = await unhandledPolicy.resolveConversationChatWorkflowAssistantMessage({
    ...baseInput,
    explicitToolRequest,
    manifests: [],
  })
  assert.equal(unhandled.handled, false)
  assert.equal(unhandled.reason, 'workflow-not-handled')
  assert.equal(unhandled.reply, unhandledReply, 'unhandled workflow reply identity is preserved')
  assert.equal(unhandled.patch, undefined)

  const resolverFailure = new Error('fixture Agent Chat resolver failure')
  const failingPolicy = taskModule.createConversationChatWorkflowRuntimePolicy({
    ...dependencies,
    chatEntry: {
      ...dependencies.chatEntry,
      resolveConversationChatWorkflowAssistantMessage: async () => {
        throw resolverFailure
      },
    },
  })
  await assert.rejects(
    () => failingPolicy.resolveConversationChatWorkflowAssistantMessage({ ...baseInput, explicitToolRequest, manifests: [] }),
    (error) => error === resolverFailure,
    'Agent Chat resolver failures propagate without being translated or suppressed',
  )

  function blockedTraceName(runtimePolicy, input) {
    return runtimePolicy.decideConversationChatWorkflowAssistantMessage({
      ...input,
      blockedWorkflowStates: [{ workflowId: workflow.id, reason: 'workflow-disabled' }],
    }).traces[0].metadata.workflowName
  }
}

function assertAgentWorkflowContinuationOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowContinuationPolicy.ts')
  const compositionPath = path.join(root, 'src/bootstrap/workflowContinuation.ts')
  const legacyPaths = [
    path.join(root, 'src/services/agent/agentContinuationPolicy.ts'),
    path.join(root, 'src/services/agent/agentWorkflowContinuationPolicy.ts'),
  ]
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const compositionSource = fs.readFileSync(compositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const orchestratorCompositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')

  assert.ok(legacyPaths.every((legacyPath) => !fs.existsSync(legacyPath)), 'no service continuation adapter exists')
  assert.match(targetSource, /export function createWorkflowContinuationPolicy/)
  assert.match(targetSource, /export const WORKFLOW_STEP_LIMIT_BLOCKED_REASON/)
  assert.doesNotMatch(targetSource, /@\/services\//, 'the tasks-owned continuation policy has no legacy service dependency')
  assert.doesNotMatch(targetSource, /@\/bootstrap\//, 'the tasks-owned continuation policy has no composition dependency')
  assert.doesNotMatch(targetSource, /@\/platform\//, 'the tasks-owned continuation policy has no platform dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the tasks-owned continuation policy receives its clock')
  assert.match(targetSource, /dependencies\.clock\.now\(\)/, 'step-limit timestamps use the injected clock')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowContinuationPolicy'/)
  assert.match(compositionSource, /createWorkflowContinuationPolicy\(/, 'bootstrap composes the target policy')
  assert.match(orchestratorCompositionSource, /from '\.\/workflowContinuation'/, 'orchestrator imports the bootstrap-owned target policy')
  assert.equal(
    (orchestratorSource.match(/dependencies\.continuationPolicy\.cancel\(\{/g) ?? []).length,
    2,
    'the two pre-step cancellation branches use the target policy directly',
  )
  assert.match(
    orchestratorCompositionSource,
    /cancel: workflowContinuationPolicy\.cancel/,
    'post-step cancellation is injected into the Tasks-owned outcome policy',
  )
  const cancellationCompletionBlocks = orchestratorSource.match(
    /dependencies\.completeRun\(\{\s*run,\s*runtime,\s*status: cancellation\.status,[\s\S]*?\}\)\.run/g,
  ) ?? []
  assert.equal(
    cancellationCompletionBlocks.length,
    2,
    'the two pre-step cancellation branches complete through the target policy',
  )
  assert.ok(
    cancellationCompletionBlocks.every((block) => !/\bpendingAction\s*:/.test(block)),
    'all three live cancellation branches remain terminal without pending actions',
  )
  assert.match(orchestratorSource, /attemptedStepCount: run\.steps\.length/, 'step-limit pause uses attempted step count')
  assert.match(orchestratorSource, /dependencies\.continuationPolicy\.pauseAtStepLimit\(\{/)
  for (const legacyHelper of [
    'AgentRunProgressTraceMetadata',
    'buildCancelledProgressMetadata',
    'buildCancelledContinuationPrompt',
    'formatCancelledOutput',
    'countCompletedSteps',
    'buildStepLimitPendingAction',
    'buildStepLimitSuggestedPrompt',
    'formatStepLimitOutput',
  ]) {
    assert.equal(orchestratorSource.includes(legacyHelper), false, `orchestrator no longer owns ${legacyHelper}`)
  }
}

function assertWorkflowStepOutcomePolicy() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowStepOutcomePolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowStepOutcomePolicy.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskModule = require('../src/modules/tasks/index.ts')

  assert.equal(typeof taskModule.createWorkflowStepOutcomePolicy, 'function', 'Tasks public API exposes the generic step-outcome policy factory')
  assert.equal(taskModule.createAgentWorkflowStepOutcomePolicy, undefined)
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the Agent-named step-outcome policy stays deleted')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowStepOutcomePolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowStepOutcomePolicy|createAgentWorkflowStepOutcomePolicy/)
  assert.doesNotMatch(targetSource, /@\/services\//, 'the Tasks-owned step-outcome policy has no legacy service dependency')
  assert.doesNotMatch(targetSource, /@\/bootstrap\//, 'the Tasks-owned step-outcome policy has no composition dependency')
  assert.doesNotMatch(targetSource, /@\/platform\//, 'the Tasks-owned step-outcome policy has no platform dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the step-outcome policy has no hidden clock read')
  assert.doesNotMatch(targetSource, /\bAgentWorkflow(?:StepOutcome|StepCancellation|TerminalStepOutcome|ContinuingStepOutcome)\w*\b|ResolveAgentWorkflowStepOutcomeInput|createAgentWorkflowStepOutcomePolicy/)
  assert.match(compositionSource, /createWorkflowStepOutcomePolicy</, 'bootstrap composes the target policy')
  assert.match(orchestratorSource, /dependencies\.resolveStepOutcome\(\{/, 'the live post-step branch delegates to the injected target policy')
  assert.doesNotMatch(compositionSource, /agentWorkflowStepOutcomePolicy|createAgentWorkflowStepOutcomePolicy|@\/modules\/tasks\/application\/workflowStepOutcomePolicy/, 'bootstrap uses only the generic Tasks public entry')
  assert.doesNotMatch(orchestratorSource, /if \(step\.status === 'cancelled'\)/, 'the orchestrator no longer owns cancelled-step precedence')
  assert.doesNotMatch(orchestratorSource, /if \(step\.observation\?\.errorCode/, 'the orchestrator no longer owns observation outcome branches')

  const calls = []
  const pendingAction = Object.freeze({
    reason: 'evidence_insufficient',
    blockedReason: 'repair evidence',
  })
  const policy = taskModule.createWorkflowStepOutcomePolicy({
    cancel: (input) => {
      calls.push(['cancel', input])
      return {
        status: 'cancelled',
        failureCode: 'cancelled',
        finalOutput: 'cancelled output',
        progressMetadata: Object.freeze({ completedStepCount: 0 }),
      }
    },
    buildPendingAction: (runId, goal, step) => {
      calls.push(['pending', runId, goal, step])
      return pendingAction
    },
    formatPendingActionOutput: (candidate, fallback) => {
      calls.push(['format-pending', candidate, fallback])
      return `waiting:${fallback}`
    },
    formatToolFailureDetails: (step) => {
      calls.push(['format-failure', step])
      return 'tool failed visibly'
    },
    projectFailureMetadata: (step) => {
      calls.push(['failure-metadata', step])
      return Object.freeze({ failedStepId: step.id })
    },
    extractRuntimeState: (observation) => {
      calls.push(['extract-state', observation])
      return Object.freeze({ directoryUri: 'content://fixture' })
    },
    mergeRuntimeState: (target, source) => {
      calls.push(['merge-state', target, source])
      return Object.freeze({ ...target, ...source })
    },
  })
  const planSteps = Object.freeze([Object.freeze({ id: 'plan-1', title: 'Fixture step' })])
  const baseInput = Object.freeze({
    runId: 'run-1',
    goal: 'fixture goal',
    planSteps,
    runtimeState: Object.freeze({ retained: true }),
  })
  const cancelledStep = Object.freeze({
    id: 'step-cancelled',
    title: 'Cancelled step',
    status: 'cancelled',
    observation: Object.freeze({
      ok: false,
      status: 'error',
      output: 'cancelled by tool',
      errorCode: 'permission_required',
      diagnostic: Object.freeze({ metadata: Object.freeze({ retained: true }) }),
    }),
  })
  const cancelled = policy.resolve({
    ...baseInput,
    observedSteps: Object.freeze([cancelledStep]),
    step: cancelledStep,
  })
  assert.equal(cancelled.kind, 'terminal')
  assert.equal(cancelled.completion.status, 'cancelled', 'cancelled step status wins over an observation error')
  assert.equal(cancelled.completion.transitionStep, cancelledStep, 'terminal projection preserves exact step identity')
  assert.equal(calls.filter(([kind]) => kind === 'pending').length, 0, 'cancelled precedence does not build a pending action')

  const evidenceStep = Object.freeze({
    id: 'step-evidence',
    title: 'Evidence step',
    status: 'error',
    observation: Object.freeze({
      ok: false,
      status: 'error',
      output: 'evidence missing',
      errorCode: 'evidence_insufficient',
      diagnostic: Object.freeze({ metadata: Object.freeze({ source: 'rag' }) }),
    }),
  })
  const evidence = policy.resolve({
    ...baseInput,
    observedSteps: Object.freeze([evidenceStep]),
    step: evidenceStep,
  })
  assert.equal(evidence.kind, 'terminal')
  assert.equal(evidence.completion.status, 'waiting')
  assert.equal(evidence.completion.pendingAction, pendingAction, 'waiting projection preserves pending-action identity')
  assert.deepEqual(evidence.completion.failureMetadata, {
    failedStepId: 'step-evidence',
    repairNextStep: 'repair evidence',
  })
  assert.equal(evidence.completion.finalOutput, 'waiting:evidence missing')

  const failedStep = Object.freeze({
    id: 'step-failed',
    title: 'Failed step',
    status: 'error',
    observation: Object.freeze({
      ok: false,
      status: 'error',
      output: 'raw failure',
      errorCode: 'execution_failed',
      diagnostic: Object.freeze({ metadata: Object.freeze({ source: 'builtin' }) }),
    }),
  })
  const failed = policy.resolve({
    ...baseInput,
    observedSteps: Object.freeze([failedStep]),
    step: failedStep,
  })
  assert.equal(failed.kind, 'terminal')
  assert.equal(failed.completion.status, 'error')
  assert.equal(failed.completion.finalOutput, 'tool failed visibly')
  assert.equal(failed.completion.transitionReason, 'tool-error')

  const completedStep = Object.freeze({
    id: 'step-done',
    title: 'Done step',
    status: 'done',
    observation: Object.freeze({
      ok: true,
      status: 'done',
      output: 'done',
      diagnostic: Object.freeze({ metadata: Object.freeze({ source: 'android' }) }),
    }),
  })
  const continued = policy.resolve({
    ...baseInput,
    observedSteps: Object.freeze([completedStep]),
    step: completedStep,
  })
  assert.equal(continued.kind, 'continue')
  assert.deepEqual(continued.runtimeState, { retained: true, directoryUri: 'content://fixture' })
  assert.deepEqual(baseInput.runtimeState, { retained: true }, 'successful state carry-forward does not mutate the prior state')
  assert.equal(calls.filter(([kind]) => kind === 'extract-state').length, 1)
  assert.equal(calls.filter(([kind]) => kind === 'merge-state').length, 1)
}

function assertWorkflowObservationPolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowObservationPolicy.ts')
  const bindingPath = path.join(root, 'src/bootstrap/workflowObservation.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowObservationPolicy.ts')
  const retiredBindingPath = path.join(root, 'src/bootstrap/agentWorkflowObservation.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bindingSource = fs.readFileSync(bindingPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.createWorkflowObservationPolicy, 'function')
  assert.equal(taskModule.createAgentWorkflowObservationPolicy, undefined)
  assert.equal(fs.existsSync(retiredTargetPath), false)
  assert.equal(fs.existsSync(retiredBindingPath), false)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowObservationPolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowObservationPolicy/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /\b(?:React|Expo|Zustand)\b/)
  assert.doesNotMatch(targetSource, /\bAgentWorkflowObservation\w*\b|\bAgentWorkflowObservedStep\b|\bAgentWorkflowStepAttribution\b|\bAgentWorkflowFailureTraceMetadata\b|\bAgentWorkflowStepObservationProjection\b/)
  assert.match(bindingSource, /createWorkflowObservationPolicy\(\{/)
  assert.match(compositionSource, /from '\.\/workflowObservation'/)
  assert.match(orchestratorSource, /dependencies\.projectWorkflowTraceMetadata\(run\.traces\)/)
  for (const helper of [
    'function buildWorkflowTraceMetadata',
    'function formatWorkflowTraceText',
    'function buildStepAttributionFromStep',
    'function buildFailureTraceMetadata',
    'function buildFailureToolAttributionFromStep',
    'function formatPendingActionStepTitle',
    'function formatFailureToolTraceText',
    'function buildPendingActionPromptWithStepContext',
    'function formatPendingActionWorkflowContext',
    'function formatPendingActionStepContext',
    'function readPositiveInteger',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  const policy = taskModule.createWorkflowObservationPolicy({
    redactText: (value) => value.replaceAll('secret', '[redacted]'),
    clampText: (value, limit) =>
      value.length <= limit
        ? value
        : `${value.slice(0, Math.max(0, limit - '\n[output truncated]'.length))}\n[output truncated]`,
  })
  const traces = Object.freeze([
    Object.freeze({ title: 'Other trace', metadata: Object.freeze({ workflowId: 'ignored' }) }),
    Object.freeze({
      title: 'Agent plan',
      metadata: Object.freeze({
        source: 'agent-workflow-skill',
        workflowId: 'secret-workflow-id',
        workflowName: 'Secret Workflow',
        workflowExpectedOutput: 'reply',
      }),
    }),
  ])
  const tracesBefore = JSON.stringify(traces)
  const workflowMetadata = policy.projectWorkflowTraceMetadata(traces)
  assert.deepEqual(workflowMetadata, {
    workflowId: '[redacted]-workflow-id',
    workflowName: 'Secret Workflow',
    workflowExpectedOutput: 'reply',
  })
  assert.equal(JSON.stringify(traces), tracesBefore, 'workflow observation projection does not mutate traces')

  const step = Object.freeze({
    id: 'step-secret',
    title: 'Inspect secret state',
    toolRequest: Object.freeze({ toolId: 'tool-secret-id', name: 'secret_tool', source: 'builtin' }),
    observation: Object.freeze({
      errorCode: 'tool_unavailable',
      diagnostic: Object.freeze({
        metadata: Object.freeze({
          stepNumber: 2,
          planStepCount: 3,
          toolName: 'metadata-tool',
          toolId: 'metadata-id',
          toolSource: 'mcp',
          errorCode: 'execution_failed',
        }),
      }),
    }),
  })
  const stepBefore = JSON.stringify(step)
  assert.deepEqual(policy.projectStepAttribution(step), {
    stepId: 'step-secret',
    stepTitle: 'Inspect [redacted] state',
    stepNumber: 2,
    planStepCount: 3,
  })
  assert.deepEqual(policy.projectFailureTraceMetadata(step), {
    stepId: 'step-secret',
    stepTitle: 'Inspect [redacted] state',
    stepNumber: 2,
    planStepCount: 3,
    failedStepId: 'step-secret',
    failedStepTitle: 'Inspect [redacted] state',
    failedStepNumber: 2,
    failedPlanStepCount: 3,
    failedToolName: '[redacted]_tool',
    failedToolId: 'tool-[redacted]-id',
    failedToolSource: 'builtin',
    failedToolErrorCode: 'tool_unavailable',
  })
  assert.equal(JSON.stringify(step), stepBefore, 'step observation projection does not mutate frozen inputs')

  const prompt = policy.appendPendingActionPromptContext(
    'Confirm the action.',
    policy.projectStepAttribution(step),
    workflowMetadata,
  )
  assert.match(
    prompt,
    /^Confirm the action\.\nWorkflow: Secret Workflow\nWorkflow id: \[redacted\]-workflow-id\nExpected output: reply\nStep: 2\/3\nStep title: Inspect \[redacted\] state$/,
  )
  assert.equal(
    policy.appendPendingActionPromptContext(prompt, policy.projectStepAttribution(step), workflowMetadata),
    prompt,
    'pending-action context is not duplicated',
  )
  const bounded = policy.appendPendingActionPromptContext('x'.repeat(1200), policy.projectStepAttribution(step), workflowMetadata)
  assert.ok(bounded.length <= 900, 'pending-action prompt remains within the exact bound')
  assert.match(bounded, /Workflow: Secret Workflow[\s\S]*Step title: Inspect \[redacted\] state$/)
  const rawPublicInput = {
    prompt: `secret ${'p'.repeat(1200)}`,
    stepAttribution: { stepTitle: `secret-${'s'.repeat(220)}`, stepNumber: 1, planStepCount: 2 },
    workflowMetadata: {
      workflowName: `secret-${'w'.repeat(220)}`,
      workflowId: `secret-${'i'.repeat(220)}`,
      workflowExpectedOutput: `secret-${'o'.repeat(220)}`,
    },
  }
  const safePublicPrompt = policy.appendPendingActionPromptContext(
    rawPublicInput.prompt,
    rawPublicInput.stepAttribution,
    rawPublicInput.workflowMetadata,
  )
  assert.ok(safePublicPrompt.length <= 900, 'raw public policy input is bounded')
  assert.doesNotMatch(safePublicPrompt, /secret/, 'raw public policy input is redacted in prompt and suffix text')
  for (const line of safePublicPrompt.split('\n').filter((value) => /^(?:Workflow|Workflow id|Expected output|Step title):/.test(value))) {
    assert.ok(line.length <= 177, 'raw public attribution text stays within its 160-character value bound')
  }
  assert.equal(
    policy.appendPendingActionPromptContext(
      rawPublicInput.prompt,
      rawPublicInput.stepAttribution,
      rawPublicInput.workflowMetadata,
    ),
    safePublicPrompt,
    'repeated public observation projection is deterministic',
  )
  assert.equal(policy.appendPendingActionPromptContext(undefined, {}, workflowMetadata), undefined)
  assert.deepEqual(policy.projectWorkflowTraceMetadata([]), {})
}

function assertWorkflowRagEvidencePolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowRagEvidencePolicy.ts')
  const bindingPath = path.join(root, 'src/bootstrap/workflowRagEvidence.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentRagEvidencePolicy.ts')
  const retiredBindingPath = path.join(root, 'src/bootstrap/agentRagEvidence.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bindingSource = fs.readFileSync(bindingPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.createWorkflowRagEvidencePolicy, 'function')
  assert.equal(taskModule.createAgentRagEvidencePolicy, undefined)
  assert.equal(fs.existsSync(retiredTargetPath), false)
  assert.equal(fs.existsSync(retiredBindingPath), false)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowRagEvidencePolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentRagEvidencePolicy/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /\b(?:React|Expo|Zustand)\b/)
  assert.doesNotMatch(targetSource, /Date\.now\(/)
  assert.doesNotMatch(targetSource, /\bAgentRagEvidence\w*\b|\bResolveAgentRagEvidencePauseInput\b|createAgentRagEvidencePolicy/)
  assert.match(bindingSource, /createWorkflowRagEvidencePolicy\(\{/)
  assert.match(compositionSource, /from '\.\/workflowRagEvidence'/)
  assert.match(
    orchestratorSource,
    /dependencies\.resolveRagEvidencePause\(\{\s*run,\s*rawOutput:\s*finalOutput,\s*outputCharLimit:\s*limits\.outputCharLimit,\s*\}\)/,
  )
  for (const helper of [
    'RAG_EVIDENCE_MIN_CONFIDENCE',
    'interface RagEvidenceQualityIssue',
    'function findRagEvidenceQualityIssue',
    'function isRagEvidenceStep',
    'function buildRagEvidencePendingAction',
    'function buildRagEvidenceSuggestedPrompt',
    'function formatRagEvidenceRepairOutput',
    'function parseRagEvidenceQualityMetrics',
    'function ragEvidenceRepairBlockedReason',
    'function ragEvidenceRepairGuidance',
    'function buildRagEvidenceRepairStrategy',
    'function isRagModeOffIssue',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  const observationPolicy = taskModule.createWorkflowObservationPolicy({
    redactText: (value) => value.replaceAll('secret', '[redacted]'),
    clampText: (value, limit) => value.slice(0, limit),
  })
  const policy = taskModule.createWorkflowRagEvidencePolicy({
    clock: { now: () => 73 },
    redactText: (value) => value.replaceAll('secret', '[redacted]'),
    clampText: (value, limit) => value.slice(0, limit),
    projectStepAttribution: observationPolicy.projectStepAttribution,
    appendPendingActionPromptContext: observationPolicy.appendPendingActionPromptContext,
  })
  const ragStep = Object.freeze({
    id: 'rag-step-1',
    title: 'Collect secret evidence',
    toolRequest: Object.freeze({ toolId: 'rag:context_pack', name: 'rag.context_pack', source: 'rag' }),
    observation: Object.freeze({
      output: JSON.stringify({
        sourceCount: 0,
        citationCount: 0,
        confidence: 0.499,
        missingEvidence: true,
        profile: 'fast',
        profileSource: 'settings',
        profileReason: 'fixture',
        warnings: ['weak-source'],
      }),
      diagnostic: Object.freeze({
        metadata: Object.freeze({
          source: 'rag',
          sourceCount: 9,
          citationCount: 9,
          confidence: 1,
          missingEvidence: false,
          stepNumber: 1,
          planStepCount: 1,
        }),
      }),
    }),
  })
  const run = Object.freeze({
    id: 'rag-run-1',
    goal: 'Verify secret claim',
    intent: 'rag_evidence',
    steps: Object.freeze([ragStep]),
  })
  const input = Object.freeze({
    run,
    rawOutput: ragStep.observation.output,
    workflowMetadata: Object.freeze({
      workflowId: `secret-${'i'.repeat(220)}`,
      workflowName: `secret-${'w'.repeat(220)}`,
    }),
  })
  const before = JSON.stringify(input)
  const pause = policy.resolvePause(input)
  assert.equal(pause.status, 'waiting')
  assert.equal(pause.failureCode, 'evidence_insufficient')
  assert.equal(pause.transitionReason, 'evidence-insufficient')
  assert.equal(pause.pendingAction.createdAt, 73)
  assert.equal(pause.pendingAction.confirmable, false)
  assert.equal(pause.pendingAction.repairStrategy, 'widen-rag-profile-balanced')
  assert.equal(pause.pendingAction.workflowId.length, 160)
  assert.doesNotMatch(pause.pendingAction.workflowId, /secret/)
  assert.equal(pause.pendingAction.workflowName.length, 160)
  assert.equal(pause.pendingAction.stepNumber, 1)
  assert.match(pause.pendingAction.summary, /Evidence issue: no sources, no citations, low confidence, missing evidence/)
  assert.match(pause.pendingAction.summary, /Sources: 0/)
  assert.match(pause.pendingAction.summary, /Warnings: weak-source/)
  assert.doesNotMatch(pause.pendingAction.summary, /secret/)
  assert.match(pause.pendingAction.suggestedUserPrompt, /Workflow: \[redacted\]-w+[\s\S]*Step: 1\/1/)
  assert.equal(pause.failureMetadata.repairNextStep, pause.pendingAction.blockedReason)
  assert.match(pause.finalOutput, /Agentic workflow paused for evidence repair/)
  assert.ok(pause.finalOutput.length <= 900, 'public RAG pause output uses its safe default bound')
  assert.doesNotMatch(pause.finalOutput, /secret/, 'public RAG pause output is redacted before downstream projection')
  assert.equal(JSON.stringify(input), before, 'RAG evidence pause projection does not mutate frozen inputs')
  assert.deepEqual(policy.resolvePause(input), pause, 'fixed-clock RAG evidence projection is deterministic')

  const healthyRun = Object.freeze({
    ...run,
    steps: Object.freeze([
      Object.freeze({
        ...ragStep,
        observation: Object.freeze({
          ...ragStep.observation,
          output: JSON.stringify({ sourceCount: 1, citationCount: 1, confidence: 0.5, missingEvidence: false }),
        }),
      }),
    ]),
  })
  assert.equal(policy.resolvePause({ run: healthyRun, rawOutput: '' }), undefined, 'confidence 0.5 is admitted')
  assert.equal(policy.resolvePause({ run: { ...healthyRun, intent: 'plain_chat' }, rawOutput: '' }), undefined)

  const malformedRun = Object.freeze({
    ...run,
    steps: Object.freeze([
      Object.freeze({
        ...ragStep,
        observation: Object.freeze({
          output: '{malformed',
          diagnostic: Object.freeze({
            metadata: Object.freeze({
              source: 'rag',
              sourceCount: 1,
              citationCount: 0,
              confidence: 0.8,
              missingEvidence: true,
              profile: 'offline',
              profileSource: 'rag-mode',
              profileReason: 'ragMode=off',
            }),
          }),
        }),
      }),
    ]),
  })
  const offline = policy.resolvePause({ run: malformedRun, rawOutput: '{malformed' })
  assert.equal(offline.pendingAction.repairStrategy, 'enable-rag-or-add-cited-local-evidence')
  assert.match(offline.pendingAction.blockedReason, /RAG mode is off/)
  assert.match(offline.pendingAction.summary, /Citations: 0/)

  const throwingWarning = Object.freeze({
    [Symbol.toPrimitive]() {
      throw new Error('warning coercion must fail closed')
    },
  })
  const nullMetricsRun = {
    ...run,
    steps: [
      {
        ...ragStep,
        observation: {
          output: 'null',
          diagnostic: {
            metadata: {
              source: 'rag',
              sourceCount: 0,
              citationCount: 0,
              confidence: 0.2,
              missingEvidence: true,
              warnings: [throwingWarning],
            },
          },
        },
      },
    ],
  }
  const nullMetrics = policy.resolvePause({ run: nullMetricsRun, rawOutput: 'secret raw output' })
  assert.match(nullMetrics.pendingAction.summary, /Warnings: \[unavailable\]/)
  assert.doesNotMatch(nullMetrics.finalOutput, /secret/)
  const configuredOutput = policy.resolvePause({
    run: nullMetricsRun,
    rawOutput: 'x'.repeat(1600),
    outputCharLimit: 1200,
  })
  assert.equal(configuredOutput.finalOutput.length, 1200, 'the live resolved output limit can preserve the downstream Agent bound')
}

function assertWorkflowPendingActionPolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowPendingActionPolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowPendingActionPolicy.ts')
  const bindingPath = path.join(root, 'src/bootstrap/workflowPendingAction.ts')
  const retiredBindingPath = path.join(root, 'src/bootstrap/agentWorkflowPendingAction.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const outcomeSource = fs.readFileSync(path.join(root, 'src/modules/tasks/application/workflowStepOutcomePolicy.ts'), 'utf8')
  const bindingSource = fs.readFileSync(bindingPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.createWorkflowPendingActionPolicy, 'function')
  assert.equal(taskModule.createAgentWorkflowPendingActionPolicy, undefined)
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the Agent-named pending-action policy stays deleted')
  assert.equal(fs.existsSync(retiredBindingPath), false, 'the Agent-named pending-action binding stays deleted')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowPendingActionPolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowPendingActionPolicy|createAgentWorkflowPendingActionPolicy/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /\b(?:React|Expo|Zustand)\b/)
  assert.doesNotMatch(targetSource, /Date\.now\(/)
  assert.match(targetSource, /Object\.getOwnPropertyDescriptor/)
  assert.match(targetSource, /Reflect\.ownKeys/)
  assert.match(bindingSource, /createWorkflowPendingActionPolicy\(\{/)
  assert.match(bindingSource, /clock:\s*systemClock/)
  assert.doesNotMatch(bindingSource, /agentWorkflowPendingActionPolicy|createAgentWorkflowPendingActionPolicy/)
  assert.match(compositionSource, /from '\.\/workflowPendingAction'/)
  assert.doesNotMatch(compositionSource, /from '\.\/agentWorkflowPendingAction'/)
  assert.match(compositionSource, /buildPendingAction,/)
  assert.match(outcomeSource, /repairNextStep:\s*pendingAction\.blockedReason/)
  for (const helper of [
    'function buildPendingAction(',
    'function buildEvidenceInsufficientSuggestedPrompt(',
    'function buildPermissionRequiredSuggestedPrompt(',
    'function buildAndroidPendingActionCopy(',
    'function formatPendingActionOutput(',
    'function summarizeAndroidArgumentsPreview(',
    'function canPersistResumeRequest(',
    'function sanitizeResumeToolRequest(',
    'function safeStringify(',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  const localizeCalls = []
  const localize = (key, values, fallback = key) => {
    localizeCalls.push(key)
    return fallback.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, name) => {
      const value = values?.[name]
      return value === undefined || value === null ? '' : String(value)
    })
  }
  const redactText = (value) => value.replace(/secret/gi, '[redacted]')
  const clampText = (value, limit) => value.length <= limit ? value : value.slice(0, limit)
  const observationPolicy = taskModule.createWorkflowObservationPolicy({
    redactText,
    clampText,
  })
  const policy = taskModule.createWorkflowPendingActionPolicy({
    clock: { now: () => 91 },
    redactText,
    clampText,
    localize,
    projectStepAttribution: observationPolicy.projectStepAttribution,
    appendPendingActionPromptContext: observationPolicy.appendPendingActionPromptContext,
  })

  const genericStep = Object.freeze({
    id: 'step-1',
    title: 'Write file',
    toolRequest: Object.freeze({
      toolId: 'builtin:files.write',
      name: 'files.write',
      source: 'builtin',
      arguments: Object.freeze({ path: 'notes.txt', content: 'safe' }),
    }),
    observation: Object.freeze({
      output: 'Write permission is required.',
      errorCode: 'permission_required',
      diagnostic: Object.freeze({
        metadata: Object.freeze({ permission: 'read-write', stepNumber: 1, planStepCount: 2 }),
      }),
    }),
  })
  const genericBefore = JSON.stringify(genericStep)
  const generic = policy.buildPendingAction('run-1', 'Write notes', genericStep)
  assert.equal(generic.id, 'agent-pending-1749590478', 'pending IDs preserve the legacy FNV-1a vector')
  assert.equal(generic.createdAt, 91)
  assert.equal(generic.reason, 'permission_required')
  assert.equal(generic.permission, 'read-write')
  assert.equal(generic.confirmable, true)
  assert.equal(generic.blockedReason, undefined)
  assert.deepEqual(generic.resumeToolRequest, {
    ...genericStep.toolRequest,
    serverId: undefined,
  })
  assert.notEqual(generic.resumeToolRequest, genericStep.toolRequest)
  assert.notEqual(generic.resumeToolRequest.arguments, genericStep.toolRequest.arguments)
  assert.equal(generic.stepNumber, 1)
  assert.equal(generic.planStepCount, 2)
  assert.equal(JSON.stringify(genericStep), genericBefore, 'pending-action projection does not mutate frozen input')
  assert.deepEqual(policy.buildPendingAction('run-1', 'Write notes', genericStep), generic, 'fixed-clock pending actions are deterministic')
  assert.match(policy.formatPendingActionOutput(generic, 'fallback'), /Action needs confirmation\.[\s\S]*Use the visible confirmation action to continue\./)

  const waitingStep = Object.freeze({ ...genericStep, status: 'error' })
  const stepOutcomePolicy = taskModule.createWorkflowStepOutcomePolicy({
    cancel: () => { throw new Error('waiting projection must not cancel') },
    buildPendingAction: policy.buildPendingAction,
    formatPendingActionOutput: policy.formatPendingActionOutput,
    formatToolFailureDetails: () => { throw new Error('waiting projection must not format a terminal failure') },
    projectFailureMetadata: () => Object.freeze({}),
    extractRuntimeState: () => Object.freeze({}),
    mergeRuntimeState: () => Object.freeze({}),
  })
  const waitingOutcome = stepOutcomePolicy.resolve({
    runId: 'run-1',
    goal: 'Write notes',
    planSteps: Object.freeze([Object.freeze({ id: waitingStep.id, title: waitingStep.title })]),
    observedSteps: Object.freeze([waitingStep]),
    step: waitingStep,
    runtimeState: Object.freeze({}),
  })
  assert.equal(waitingOutcome.kind, 'terminal')
  assert.equal(waitingOutcome.completion.status, 'waiting')
  assert.equal(waitingOutcome.completion.pendingAction.id, 'agent-pending-1749590478')

  const waitingRun = Object.freeze({
    id: 'run-1',
    goal: 'Write notes',
    status: 'running',
    steps: Object.freeze([waitingStep]),
    traces: Object.freeze([]),
    startedAt: 90,
  })
  const completionPolicy = taskModule.createWorkflowCompletionPolicy({
    clock: { now: () => 92 },
    redactText,
    clampText,
    projectTrace: (trace) => ({ ...trace }),
    projectWorkflowTraceMetadata: () => Object.freeze({}),
    formatFailureOutput: () => { throw new Error('waiting projection must not format a terminal failure') },
    resolveFailureNextStep: () => '',
  })
  const waitingProjection = completionPolicy.complete({
    run: waitingRun,
    runtime: taskModule.createWorkflowRuntime(waitingRun),
    ...waitingOutcome.completion,
  })
  assert.equal(waitingProjection.run.status, 'waiting')
  assert.equal(waitingProjection.runtime.transitions.at(-1).reason, 'permission-required')
  assert.equal(
    waitingProjection.run.traces.at(-1).metadata.pendingAction,
    waitingOutcome.completion.pendingAction,
    'completion trace retains the exact renamed-policy pending action',
  )

  const detachedArguments = { operations: [{ sourceUri: 'a', destinationUri: 'b' }] }
  const detached = policy.buildPendingAction('run-detached', 'Apply files', {
    ...genericStep,
    id: 'detached-step',
    toolRequest: { name: 'android.files.apply_operations', source: 'android', arguments: detachedArguments },
  })
  detachedArguments.operations[0].sourceUri = 'mutated'
  detachedArguments.operations.push({ sourceUri: 'c', destinationUri: 'd' })
  assert.deepEqual(detached.resumeToolRequest.arguments.operations, [{ sourceUri: 'a', destinationUri: 'b' }], 'resume arguments are detached from later caller mutation')
  assert.match(detached.summary, /Applies 1 user-authorized SAF file operation/)

  const alarm = policy.buildPendingAction('run-android', 'Set alarm', {
    ...genericStep,
    id: 'alarm-step',
    title: 'Set alarm',
    toolRequest: {
      name: 'android.alarm.open_create_intent',
      source: 'android',
      arguments: { hour: 7, minutes: 5, message: 'Wake' },
    },
  })
  assert.equal(alarm.id, 'agent-pending-1970228016', 'localized Android actions preserve the legacy pending ID vector')
  assert.equal(alarm.title, 'Create Android alarm')
  assert.equal(alarm.argumentsPreview, 'Time 07:05 · label Wake')
  assert.ok(localizeCalls.includes('messageBubble.androidPendingAlarmDetailsWithLabel'))
  assert.ok(localizeCalls.includes('messageBubble.androidPendingApplyFilesSummary'))

  const undo = policy.buildPendingAction('run-undo', 'Undo files', {
    ...genericStep,
    id: 'undo-step',
    toolRequest: {
      name: 'android.files.undo_operations',
      source: 'android',
      arguments: { undoOperations: [{ sourceUri: 'b', destinationUri: 'a' }] },
    },
  })
  assert.equal(undo.confirmable, true)
  assert.match(undo.summary, /Applies 1 saved undo operation/)
  assert.deepEqual(undo.resumeToolRequest.arguments.undoOperations, [{ sourceUri: 'b', destinationUri: 'a' }])

  const evidence = policy.buildPendingAction('run-evidence', 'Verify then write', {
    ...genericStep,
    id: 'evidence-step',
    observation: {
      ...genericStep.observation,
      errorCode: 'evidence_insufficient',
      output: 'More source evidence is required.',
    },
  })
  assert.equal(evidence.reason, 'evidence_insufficient')
  assert.equal(evidence.confirmable, false, 'evidence repair cannot bypass evidence through one-tap confirmation')
  assert.equal(evidence.resumeToolRequest, undefined)
  assert.equal(evidence.blockedReason, evidence.repairStrategy)
  assert.match(policy.formatPendingActionOutput(evidence, 'fallback'), /Confirmation unavailable:/)

  const unsafeCases = []
  unsafeCases.push(['top-level array', []])
  const cycle = {}
  cycle.self = cycle
  unsafeCases.push(['cycle', cycle])
  const getter = {}
  Object.defineProperty(getter, 'value', { enumerable: true, get() { throw new Error('getter must not run') } })
  unsafeCases.push(['throwing getter', getter])
  unsafeCases.push(['throwing ownKeys proxy', new Proxy({}, { ownKeys() { throw new Error('ownKeys trap') } })])
  unsafeCases.push(['throwing descriptor proxy', new Proxy({ value: 1 }, { getOwnPropertyDescriptor() { throw new Error('descriptor trap') } })])
  unsafeCases.push(['unsupported exotic object', { value: new Date(0) }])
  unsafeCases.push(['unsupported JSON primitive', { value: undefined }])
  for (const [label, unsafeArguments] of unsafeCases) {
    const action = policy.buildPendingAction(`run-${label}`, label, {
      ...genericStep,
      id: `step-${label}`,
      toolRequest: { name: 'files.write', source: 'builtin', arguments: unsafeArguments },
    })
    assert.equal(action.confirmable, false, `${label} fails closed`)
    assert.equal(action.resumeToolRequest, undefined, `${label} is never persisted for resume`)
    assert.equal(action.blockedReason, 'Tool arguments are not safe to persist for one-tap confirmation.')
  }

  for (const [label, argumentsValue] of [
    ['secret-bearing payload', { authorization: 'Bearer token-value' }],
    ['over-1200 payload', { value: 'x'.repeat(1300) }],
    ['embedded truncation marker', { value: 'unsafe [output truncated] state' }],
  ]) {
    const action = policy.buildPendingAction(`run-${label}`, label, {
      ...genericStep,
      id: `step-${label}`,
      toolRequest: { name: 'files.write', source: 'builtin', arguments: argumentsValue },
    })
    assert.equal(action.confirmable, false, `${label} is visible but not confirmable`)
    assert.equal(action.resumeToolRequest, undefined)
  }
}

function assertAndroidWorkflowRuntimeStatePolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/androidWorkflowRuntimeStatePolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentAndroidWorkflowRuntimeStatePolicy.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.bindAndroidWorkflowRuntimeState, 'function')
  assert.equal(typeof taskModule.extractAndroidWorkflowRuntimeState, 'function')
  assert.equal(typeof taskModule.mergeAndroidWorkflowRuntimeState, 'function')
  assert.equal(taskModule.bindAgentAndroidWorkflowRuntimeState, undefined)
  assert.equal(taskModule.extractAgentAndroidWorkflowRuntimeState, undefined)
  assert.equal(taskModule.mergeAgentAndroidWorkflowRuntimeState, undefined)
  assert.equal(fs.existsSync(retiredTargetPath), false)
  assert.match(taskEntrySource, /export \* from '\.\/application\/androidWorkflowRuntimeStatePolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentAndroidWorkflowRuntimeStatePolicy|AgentAndroidWorkflowRuntime|AgentAndroidWorkflowRuntimeState/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /^import\s/m, 'the Android runtime-state policy is dependency-free')
  assert.doesNotMatch(targetSource, /\bAgentAndroidWorkflowRuntime\w*\b|\b(?:bind|extract|merge)AgentAndroidWorkflowRuntimeState\b/)
  assert.match(orchestratorSource, /bindAndroidWorkflowRuntimeState\(planned\.toolRequest, runtimeState\)/)
  assert.match(compositionSource, /extractRuntimeState: extractAndroidWorkflowRuntimeState/)
  assert.match(compositionSource, /mergeRuntimeState: mergeAndroidWorkflowRuntimeState/)
  assert.match(orchestratorSource, /runtimeState = stepOutcome\.runtimeState/)
  for (const helper of [
    'interface WorkflowRuntimeState',
    'function bindWorkflowRuntimeState(',
    'function extractWorkflowRuntimeState(',
    'function mergeWorkflowRuntimeState(',
    'function formatToolRequestRef(',
    'function isAndroidSafDirectoryRef(',
    'function isAndroidApplyOperationsRef(',
    'function isAndroidUndoOperationsRef(',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  const extracted = taskModule.extractAndroidWorkflowRuntimeState(Object.freeze({
    ok: true,
    output: JSON.stringify({
      directoryUri: '  content://tree/download  ',
      operations: [{ sourceUri: 'content://a', destinationUri: 'content://b' }],
      undoOperations: [{ sourceUri: 'content://b', destinationUri: 'content://a' }],
    }),
  }))
  assert.deepEqual(extracted, {
    directoryUri: 'content://tree/download',
    operations: [{ sourceUri: 'content://a', destinationUri: 'content://b' }],
    undoOperations: [{ sourceUri: 'content://b', destinationUri: 'content://a' }],
  })
  assert.deepEqual(
    taskModule.extractAndroidWorkflowRuntimeState({
      ok: true,
      output: JSON.stringify({ operationPreview: [{ sourceUri: 'preview' }] }),
    }),
    { operations: [{ sourceUri: 'preview' }] },
    'operationPreview remains the fallback operations source',
  )
  assert.deepEqual(
    taskModule.extractAndroidWorkflowRuntimeState({
      ok: true,
      output: JSON.stringify({ operations: [], operationPreview: [{ sourceUri: 'must-not-fall-through' }] }),
    }),
    {},
    'an explicit empty operations array does not fall through to operationPreview',
  )
  assert.deepEqual(taskModule.extractAndroidWorkflowRuntimeState({ ok: false, output: JSON.stringify({ directoryUri: 'ignored' }) }), {})
  assert.deepEqual(taskModule.extractAndroidWorkflowRuntimeState({ ok: true, output: '{malformed' }), {})
  assert.deepEqual(taskModule.extractAndroidWorkflowRuntimeState({ ok: true, output: '[]' }), {})

  const scanRequest = Object.freeze({
    name: 'android.files.scan',
    source: 'android',
    arguments: Object.freeze({ depth: 2 }),
  })
  const scanBefore = JSON.stringify(scanRequest)
  const scanBound = taskModule.bindAndroidWorkflowRuntimeState(scanRequest, extracted)
  assert.deepEqual(scanBound.toolRequest.arguments, { depth: 2, directoryUri: 'content://tree/download' })
  assert.notEqual(scanBound.toolRequest, scanRequest)
  assert.notEqual(scanBound.toolRequest.arguments, scanRequest.arguments)
  assert.equal(JSON.stringify(scanRequest), scanBefore, 'directory carry-forward does not mutate a frozen request')

  const applyRequest = Object.freeze({
    toolId: 'builtin:android:files.apply_operations',
    name: 'ignored-by-tool-id',
    arguments: Object.freeze({}),
  })
  const applyBound = taskModule.bindAndroidWorkflowRuntimeState(applyRequest, extracted)
  assert.deepEqual(applyBound.toolRequest.arguments.operations, extracted.operations)
  assert.notEqual(applyBound.toolRequest.arguments.operations, extracted.operations)
  assert.notEqual(applyBound.toolRequest.arguments.operations[0], extracted.operations[0])
  applyBound.toolRequest.arguments.operations[0].sourceUri = 'mutated-bound-request'
  assert.equal(extracted.operations[0].sourceUri, 'content://a', 'carried operations are detached from runtime state')

  const undoBound = taskModule.bindAndroidWorkflowRuntimeState({
    serverId: 'builtin:android',
    name: 'files.undo_operations',
    arguments: {},
  }, extracted)
  assert.deepEqual(undoBound.toolRequest.arguments.undoOperations, extracted.undoOperations, 'namespaced Android identities receive undo state')
  assert.notEqual(undoBound.toolRequest.arguments.undoOperations, extracted.undoOperations)

  const existingOperations = [{ sourceUri: 'existing' }]
  const existingRequest = { name: 'android.files.apply_operations', arguments: { operations: existingOperations } }
  const existingBound = taskModule.bindAndroidWorkflowRuntimeState(existingRequest, extracted)
  assert.equal(existingBound.toolRequest, existingRequest, 'non-empty explicit operations take precedence over carried state')
  assert.equal(existingRequest.arguments.operations, existingOperations)
  const wrongToolRequest = { name: 'files.write', arguments: {} }
  assert.equal(
    taskModule.bindAndroidWorkflowRuntimeState(wrongToolRequest, extracted).toolRequest,
    wrongToolRequest,
    'unrelated tools never receive Android runtime state',
  )
  const toolIdPrecedenceRequest = {
    toolId: 'builtin:files.write',
    serverId: 'builtin:android',
    name: 'files.apply_operations',
    arguments: {},
  }
  assert.equal(
    taskModule.bindAndroidWorkflowRuntimeState(toolIdPrecedenceRequest, extracted).toolRequest,
    toolIdPrecedenceRequest,
    'an explicit non-Android toolId takes precedence over matching server and name fields',
  )

  const targetState = Object.freeze({
    directoryUri: 'content://old',
    operations: Object.freeze([Object.freeze({ sourceUri: 'old' })]),
  })
  const sourceState = Object.freeze({
    directoryUri: 'content://new',
    undoOperations: Object.freeze([Object.freeze({ sourceUri: 'undo' })]),
  })
  const merged = taskModule.mergeAndroidWorkflowRuntimeState(targetState, sourceState)
  assert.deepEqual(merged, {
    directoryUri: 'content://new',
    operations: [{ sourceUri: 'old' }],
    undoOperations: [{ sourceUri: 'undo' }],
  })
  assert.notEqual(merged.operations, targetState.operations)
  assert.notEqual(merged.undoOperations, sourceState.undoOperations)
  assert.deepEqual(targetState, { directoryUri: 'content://old', operations: [{ sourceUri: 'old' }] })
  assert.deepEqual(sourceState, { directoryUri: 'content://new', undoOperations: [{ sourceUri: 'undo' }] })
}

function assertWorkflowPermissionEvidencePolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowPermissionEvidencePolicy.ts')
  const bindingPath = path.join(root, 'src/bootstrap/workflowPermissionEvidence.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowPermissionEvidencePolicy.ts')
  const retiredBindingPath = path.join(root, 'src/bootstrap/agentWorkflowPermissionEvidence.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bindingSource = fs.readFileSync(bindingPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.createWorkflowPermissionEvidencePolicy, 'function')
  assert.equal(taskModule.createAgentWorkflowPermissionEvidencePolicy, undefined)
  assert.equal(fs.existsSync(retiredTargetPath), false)
  assert.equal(fs.existsSync(retiredBindingPath), false)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowPermissionEvidencePolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowPermissionEvidencePolicy/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /\b(?:React|Expo|Zustand)\b/)
  assert.doesNotMatch(targetSource, /\bAgentWorkflowPermissionEvidence\w*\b/)
  assert.match(bindingSource, /createWorkflowPermissionEvidencePolicy\(\{/)
  assert.match(bindingSource, /formatToolIdentity:\s*formatToolRequestIdentity/)
  assert.match(orchestratorSource, /dependencies\.buildPermissionEvidence\(\{/)
  assert.match(compositionSource, /buildPermissionEvidence: buildWorkflowPermissionEvidence/)
  assert.doesNotMatch(orchestratorSource, /function buildStepPermissionEvidence\(/)

  const clampText = (value, limit) => value.length <= limit
    ? value
    : `${value.slice(0, Math.max(0, limit - '\n[output truncated]'.length))}\n[output truncated]`
  const policy = taskModule.createWorkflowPermissionEvidencePolicy({
    formatToolIdentity: (request) => request?.toolId ?? (request?.serverId && request?.name ? `${request.serverId}:${request.name}` : request?.name ?? ''),
    redactText: (value) => value.replace(/secret/gi, '[redacted]'),
    clampText,
  })
  const input = Object.freeze({
    planId: 'plan-1',
    planIntent: 'tool_task',
    planned: Object.freeze({
      toolRequest: Object.freeze({ toolId: 'builtin:files.write', name: 'files.write' }),
    }),
    workflowDefinition: Object.freeze({
      id: 'workflow-1',
      name: 'Secret file workflow',
      acceptanceChecks: Object.freeze(['written', 'visible']),
    }),
    previousStepCount: 3,
  })
  const before = JSON.stringify(input)
  const evidence = policy.build(input)
  assert.deepEqual(evidence.sources, [
    'agent-plan:plan-1',
    'intent:tool_task',
    'source:visible-agent-request',
    'tool:builtin:files.write',
    'workflow:workflow-1',
    'workflow-acceptance:2',
    'prior-observations:3',
  ])
  assert.equal(
    evidence.summary,
    'Permission basis: visible Agent plan, workflow [redacted] file workflow, tool builtin:files.write, 3 prior observation(s).',
  )
  assert.equal(JSON.stringify(input), before, 'permission-evidence projection does not mutate frozen plans or workflows')
  assert.deepEqual(policy.build(input), evidence, 'permission evidence is deterministic')

  const direct = policy.build({
    planId: 'plan-direct',
    planIntent: 'plain_chat',
    planned: {},
    previousStepCount: 0,
  })
  assert.deepEqual(direct.sources, [
    'agent-plan:plan-direct',
    'intent:plain_chat',
    'source:visible-agent-request',
  ])
  assert.equal(direct.summary, 'Permission basis: visible Agent plan, current user goal.')

  const bounded = policy.build({
    planId: 'plan-long',
    planIntent: 'tool_task',
    planned: { toolRequest: { name: `tool-${'x'.repeat(500)}` } },
    workflowDefinition: {
      id: 'workflow-long',
      name: `workflow-${'y'.repeat(500)}`,
      acceptanceChecks: ['accepted'],
    },
    previousStepCount: 1,
  })
  assert.ok(bounded.summary.length <= 320)
  assert.doesNotMatch(bounded.summary, /\[output truncated\]$/, 'permission evidence removes the clamping transport suffix')
}

function assertWorkflowAndroidUndoFollowUpPolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowAndroidUndoFollowUpPolicy.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const completionSource = fs.readFileSync(path.join(root, 'src/modules/tasks/application/workflowCompletionPolicy.ts'), 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.buildWorkflowAndroidUndoFollowUp, 'function')
  assert.equal(typeof taskModule.appendWorkflowAndroidUndoFollowUp, 'function')
  assert.equal(typeof taskModule.projectWorkflowAndroidUndoFollowUpMetadata, 'function')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowAndroidUndoFollowUpPolicy'/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /^import\s/m)
  assert.match(compositionSource, /from '\.\/workflowCompletion'/)
  assert.match(completionSource, /buildWorkflowAndroidUndoFollowUp\(input\.run\)/)
  assert.match(completionSource, /input\.status === 'done' \|\| input\.status === 'error'[\s\S]{0,120}buildWorkflowAndroidUndoFollowUp\(input\.run\)/)
  assert.match(completionSource, /appendWorkflowAndroidUndoFollowUp\(input\.finalOutput\?\.trim\(\), undoFollowUp\)/)
  assert.match(completionSource, /projectWorkflowAndroidUndoFollowUpMetadata\(undoFollowUp\)/)
  for (const helper of [
    'interface AndroidUndoFollowUp',
    'function buildAndroidUndoFollowUp(',
    'function appendAndroidUndoFollowUp(',
    'function androidUndoFollowUpMetadata(',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  const run = Object.freeze({
    steps: Object.freeze([
      Object.freeze({ observation: Object.freeze({ output: '{malformed' }) }),
      Object.freeze({ observation: Object.freeze({ output: JSON.stringify({ undoOperations: [] }) }) }),
      Object.freeze({ observation: Object.freeze({ output: JSON.stringify({ undoOperations: [{ id: 1 }, { id: 2 }] }) }) }),
      Object.freeze({ observation: Object.freeze({ output: JSON.stringify({ undoOperations: [{ id: 3 }, { id: 4 }, { id: 5 }] }) }) }),
    ]),
  })
  const before = JSON.stringify(run)
  const followUp = taskModule.buildWorkflowAndroidUndoFollowUp(run)
  assert.deepEqual(followUp, {
    count: 2,
    toolName: 'android.files.undo_operations',
    summary: 'Undo available for 2 reversible Android SAF move operation(s). Reversal must use android.files.undo_operations from a visible user confirmation; delete-based undo remains unsupported.',
  }, 'the first non-empty undo receipt controls the visible follow-up')
  const appended = taskModule.appendWorkflowAndroidUndoFollowUp('Completed moves.', followUp)
  assert.equal(appended, [
    'Completed moves.',
    'Android undo available.\nUndo operations: 2\nRequires visible confirmation through android.files.undo_operations.\nDelete-based undo remains unsupported.',
  ].join('\n\n'))
  assert.equal(
    taskModule.appendWorkflowAndroidUndoFollowUp(undefined, followUp),
    'Android undo available.\nUndo operations: 2\nRequires visible confirmation through android.files.undo_operations.\nDelete-based undo remains unsupported.',
  )
  assert.deepEqual(taskModule.projectWorkflowAndroidUndoFollowUpMetadata(followUp), {
    androidUndoOperationCount: 2,
    androidUndoToolName: 'android.files.undo_operations',
    androidUndoRequiresVisibleConfirmation: true,
    androidUndoSummary: followUp.summary,
  })
  assert.equal(JSON.stringify(run), before, 'undo follow-up projection does not mutate frozen workflow receipts')

  for (const output of [undefined, '', '[]', '{}', JSON.stringify({ undoOperations: 'invalid' })]) {
    assert.equal(
      taskModule.buildWorkflowAndroidUndoFollowUp({ steps: [{ observation: { output } }] }),
      undefined,
    )
  }
  const originalJsonParse = JSON.parse
  try {
    JSON.parse = () => new Proxy({}, {
      get(target, key, receiver) {
        if (key === 'undoOperations') throw new Error('unsafe parsed getter')
        return Reflect.get(target, key, receiver)
      },
    })
    assert.equal(
      taskModule.buildWorkflowAndroidUndoFollowUp({ steps: [{ observation: { output: '{proxy-fixture}' } }] }),
      undefined,
      'unsafe parsed proxy/getter values fail closed',
    )
  } finally {
    JSON.parse = originalJsonParse
  }
  assert.equal(taskModule.appendWorkflowAndroidUndoFollowUp('unchanged', undefined), 'unchanged')
  assert.deepEqual(taskModule.projectWorkflowAndroidUndoFollowUpMetadata(undefined), {})
}

function assertWorkflowFailurePolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowFailurePolicy.ts')
  const bootstrapPath = path.join(root, 'src/bootstrap/workflowFailure.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(typeof taskModule.createWorkflowFailurePolicy, 'function')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowFailurePolicy'/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /\bAgentWorkflowFailure\w*\b|createAgentWorkflowFailurePolicy/)
  assert.match(bootstrapSource, /createWorkflowFailurePolicy/)
  assert.match(bootstrapSource, /redactSensitiveText/)
  assert.match(bootstrapSource, /clampTraceText/)
  assert.match(compositionSource, /formatToolFailureDetails: formatWorkflowToolFailureDetails/)
  for (const helper of [
    'function parseJsonObject(',
    'function readString(',
    'function readNumber(',
    'function readArray(',
    'function formatFailureOutput(',
    'function formatToolFailureDetails(',
    'function resolveFailureNextStep(',
    'function extractVisibleNextStep(',
    'function formatAndroidPartialFailureRecovery(',
    'function buildFailureNextStep(',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  const clampText = (value, limit) => {
    const max = Math.max(0, limit)
    if (value.length <= max) return value
    return `${value.slice(0, Math.max(0, max - 32)).trimEnd()}\n[output truncated]`
  }
  const policy = taskModule.createWorkflowFailurePolicy({
    redactText: (value) => value.replace(/sk-secret[\w-]*/g, '[redacted]'),
    clampText,
  })
  const expectedNextSteps = {
    provider_unavailable: 'Configure an available provider, then retry the workflow.',
    tool_unavailable: 'Enable the tool or choose another available tool, then rerun the workflow.',
    schema_invalid: 'Fix the workflow definition or tool arguments, then rerun within the same permission limits.',
    rag_unavailable: 'Enable the RAG runtime or use a workflow that does not require retrieval.',
    policy_denied: 'Adjust the visible permission policy or choose a safer tool path.',
    execution_failed: 'Review the failed tool output, keep user state intact, and retry only the failed workflow path.',
  }
  for (const [failureCode, nextStep] of Object.entries(expectedNextSteps)) {
    assert.equal(policy.buildFailureNextStep(failureCode), nextStep)
    assert.equal(policy.resolveFailureNextStep(failureCode), nextStep)
  }
  assert.equal(
    policy.buildFailureNextStep('cancelled'),
    expectedNextSteps.execution_failed,
    'non-special failure codes preserve the legacy safe default',
  )

  const formatted = policy.formatFailureOutput('tool_unavailable', 'Tool failed with sk-secret-value.')
  assert.match(formatted, /^Agentic workflow failed\.\nReason: tool_unavailable\n/)
  assert.match(formatted, /Tool failed with \[redacted\]\./)
  assert.match(formatted, new RegExp(`Next step: ${escapeForTestRegExp(expectedNextSteps.tool_unavailable)}`))
  const explicitNextStep = 'Use the visible recovery action.'
  const withVisibleNextStep = policy.formatFailureOutput(
    'execution_failed',
    `Failure detail.\nNext step: ${explicitNextStep}`,
  )
  assert.equal((withVisibleNextStep.match(/Next step:/g) ?? []).length, 1)
  assert.equal(policy.resolveFailureNextStep('execution_failed', withVisibleNextStep), explicitNextStep)
  const preformatted = 'Agentic workflow failed.\nReason: execution_failed\nNext step: Retry visibly.'
  assert.equal(policy.formatFailureOutput('execution_failed', preformatted), preformatted)

  const partialDetail = JSON.stringify({
    partialFailure: true,
    applied: 2,
    skipped: 1,
    failureCount: 1,
    failedOperationId: 'operation-sk-secret-value',
    undoOperations: [{ id: 'undo-1' }, { id: 'undo-2' }],
    deleteSupported: false,
    nextStep: 'Confirm the undo action.',
  })
  const frozenStep = Object.freeze({
    status: 'error',
    toolRequest: Object.freeze({ name: 'android.files.apply_operations', source: 'android' }),
    observation: Object.freeze({
      output: partialDetail,
      diagnostic: Object.freeze({ metadata: Object.freeze({ toolId: 'android:apply' }) }),
    }),
  })
  const frozenBefore = JSON.stringify(frozenStep)
  const details = policy.formatToolFailureDetails(frozenStep)
  assert.match(details, /^Tool: android\.files\.apply_operations\nSource: android\nAndroid partial file operation failure\./)
  assert.match(details, /Applied before failure: 2/)
  assert.match(details, /Skipped operations: 1/)
  assert.match(details, /Undo operations available: 2/)
  assert.match(details, /Delete-based rollback remains unsupported\./)
  assert.match(details, /Failed operation: operation-\[redacted\]/)
  assert.match(details, /Next step: Confirm the undo action\./)
  assert.match(details, /Raw detail:/)
  assert.equal(JSON.stringify(frozenStep), frozenBefore, 'failure projection does not mutate frozen input')
  assert.deepEqual(policy.formatAndroidPartialFailureRecovery('{malformed'), [])
  assert.deepEqual(policy.formatAndroidPartialFailureRecovery('[]'), [])

  let getterCalls = 0
  const getterStep = {}
  Object.defineProperty(getterStep, 'toolRequest', {
    get() {
      getterCalls += 1
      throw new Error('unsafe getter')
    },
  })
  assert.equal(policy.formatToolFailureDetails(getterStep), 'Detail: Tool execution returned no detail.')
  assert.equal(getterCalls, 0, 'descriptor projection rejects getters without invoking them')
  const proxyStep = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('unsafe descriptor trap')
    },
  })
  assert.equal(policy.formatToolFailureDetails(proxyStep), 'Detail: Tool execution returned no detail.')

  const originalJsonParse = JSON.parse
  try {
    JSON.parse = () => new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error('unsafe parsed descriptor')
      },
    })
    assert.deepEqual(
      policy.formatAndroidPartialFailureRecovery('{proxy-fixture}'),
      [],
      'unsafe parsed proxy values fail closed',
    )
  } finally {
    JSON.parse = originalJsonParse
  }
}

function assertWorkflowCompletionPolicy() {
  const taskModule = require('../src/modules/tasks/index.ts')
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowCompletionPolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowCompletionPolicy.ts')
  const bootstrapPath = path.join(root, 'src/bootstrap/workflowCompletion.ts')
  const retiredBootstrapPath = path.join(root, 'src/bootstrap/agentWorkflowCompletion.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bootstrapSource = fs.readFileSync(bootstrapPath, 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')

  assert.equal(fs.existsSync(retiredTargetPath), false, 'the Agent-named completion policy stays deleted')
  assert.equal(fs.existsSync(retiredBootstrapPath), false, 'the Agent-named completion binding stays deleted')
  assert.equal(typeof taskModule.createWorkflowCompletionPolicy, 'function')
  assert.equal(taskModule.createAgentWorkflowCompletionPolicy, undefined)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowCompletionPolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowCompletionPolicy|createAgentWorkflowCompletionPolicy/)
  assert.doesNotMatch(targetSource, /@\/(?:services|bootstrap|platform|presentation)\//)
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the completion policy receives one injected clock')
  assert.match(bootstrapSource, /createWorkflowCompletionPolicy/)
  assert.match(bootstrapSource, /formatWorkflowFailureOutput/)
  assert.match(orchestratorSource, /dependencies\.completeRun\(\{/)
  assert.match(compositionSource, /completeRun: completeWorkflowRun/)
  for (const helper of [
    'function completeRun(',
    'function buildStepStatusMetadata(',
    'function finalizeAgentRunOutput(',
    'function extractAndroidUndoFollowUpSuffix(',
    'function clampAgentOutputWithExactLimit(',
    'function formatAgentSynthesisTraceContent(',
    'function escapeRegExp(',
    'function agentRunLimitMetadata(',
  ]) {
    assert.equal(orchestratorSource.includes(helper), false, `orchestrator no longer owns ${helper}`)
  }

  let clockCalls = 0
  const clampText = (value, limit) => {
    const max = Math.max(0, limit)
    if (value.length <= max) return value
    return `${value.slice(0, Math.max(0, max - 32)).trimEnd()}\n[output truncated]`
  }
  const failurePolicy = taskModule.createWorkflowFailurePolicy({
    redactText: (value) => value.replace(/sk-secret[\w-]*/g, '[redacted]'),
    clampText,
  })
  const policy = taskModule.createWorkflowCompletionPolicy({
    clock: { now: () => { clockCalls += 1; return 880 } },
    redactText: (value) => value.replace(/sk-secret[\w-]*/g, '[redacted]'),
    clampText,
    projectTrace: (trace) => ({ ...trace }),
    projectWorkflowTraceMetadata: (traces) => ({
      workflowId: traces.find((trace) => trace.title === 'Agent plan')?.metadata?.workflowId,
    }),
    formatFailureOutput: failurePolicy.formatFailureOutput,
    resolveFailureNextStep: failurePolicy.resolveFailureNextStep,
  })
  assert.deepEqual(policy.buildStepStatusMetadata([
    { id: 'p', title: 'p', status: 'pending' },
    { id: 'r', title: 'r', status: 'running' },
    { id: 'd', title: 'd', status: 'done' },
    { id: 'e', title: 'e', status: 'error' },
    { id: 'c', title: 'c', status: 'cancelled' },
    { id: 's', title: 's', status: 'skipped' },
  ]), {
    pendingStepCount: 1,
    runningStepCount: 1,
    doneStepCount: 1,
    errorStepCount: 1,
    cancelledStepCount: 1,
    skippedStepCount: 1,
  })

  const steps = Object.freeze([
    Object.freeze({
      id: 'step-done',
      title: 'Done step',
      status: 'done',
      observation: Object.freeze({ output: JSON.stringify({ undoOperations: [{ id: 1 }, { id: 2 }] }) }),
    }),
    Object.freeze({ id: 'step-skipped', title: 'Skipped step', status: 'skipped' }),
  ])
  const traces = Object.freeze([
    Object.freeze({
      id: 'run-plan',
      title: 'Agent plan',
      status: 'done',
      metadata: Object.freeze({
        workflowId: 'workflow-1',
        agentWorkflowRuntimeSchema: 'islemind.agent.workflow-runtime.v1',
        agentWorkflowRuntimeStatus: 'done',
      }),
    }),
  ])
  const run = Object.freeze({
    id: 'completion-run',
    assistantRunId: 'assistant-run-1',
    goal: 'Finish safely.',
    status: 'running',
    steps,
    traces,
    startedAt: 800,
  })
  const runtime = Object.freeze({
    ...taskModule.createWorkflowRuntime(run),
    transitions: Object.freeze([]),
  })
  const before = JSON.stringify({ run, runtime })
  const limits = Object.freeze({
    maxSteps: 3,
    maxToolCallsPerStep: 1,
    allowReadOnlyTools: true,
    allowReadWriteTools: 'visible',
    allowDestructiveTools: 'confirm',
    allowBackgroundContinuation: false,
    requireTrace: true,
    outputCharLimit: 300,
  })
  const completed = policy.complete({
    run,
    runtime,
    status: 'done',
    finalOutput: `Completed sk-secret-value ${'x'.repeat(420)}`,
    limits,
    progressMetadata: { completedStepCount: 1 },
    transitionReason: 'completed',
  })
  assert.equal(clockCalls, 1, 'completion reads the injected clock exactly once')
  assert.equal(JSON.stringify({ run, runtime }), before, 'completion does not mutate frozen run/runtime input')
  assert.equal(completed.run.status, 'done')
  assert.equal(completed.run.completedAt, 880)
  assert.ok(completed.run.finalOutput.length <= limits.outputCharLimit)
  assert.doesNotMatch(completed.run.finalOutput, /sk-secret/)
  assert.match(completed.run.finalOutput, /Android undo available\./)
  assert.match(completed.run.finalOutput, /Requires visible confirmation through android\.files\.undo_operations\./)
  assert.equal(completed.run.traces.at(-2).id, 'completion-run-synthesis')
  assert.equal(completed.run.traces.at(-1).id, 'completion-run-complete')
  assert.equal(completed.run.traces.at(-1).status, 'done')
  assert.equal(completed.run.traces.at(-1).metadata.doneStepCount, 1)
  assert.equal(completed.run.traces.at(-1).metadata.skippedStepCount, 1)
  assert.equal(completed.run.traces.at(-1).metadata.workflowId, 'workflow-1')
  assert.equal(completed.run.traces.at(-1).metadata.androidUndoOperationCount, 2)
  assert.equal(completed.run.traces.at(-1).metadata.completedStepCount, 1)
  assert.equal(completed.run.traces[0], traces[0], 'historical v1 trace metadata remains inert readable evidence')
  assert.equal(completed.run.traces[0].metadata.agentWorkflowRuntimeSchema, 'islemind.agent.workflow-runtime.v1')
  assert.equal(completed.run.traces.at(-1).metadata.workflowRuntimeSchema, 'islemind.workflow-runtime.v2')
  assert.equal(
    Object.keys(completed.run.traces.at(-1).metadata).some((key) => key.startsWith('agentWorkflowRuntime')),
    false,
    'new terminal traces do not restore Agent-named workflow-runtime authority',
  )
  assert.equal(completed.runtime.transitions.at(-1).reason, 'completed')

  const errorRuntime = taskModule.createWorkflowRuntime({ ...run, id: 'error-run' })
  const failed = policy.complete({
    run: { ...run, id: 'error-run' },
    runtime: errorRuntime,
    status: 'error',
    failureCode: 'tool_unavailable',
    finalOutput: `Tool failure ${'y'.repeat(420)}`,
    limits: { ...limits, outputCharLimit: 280 },
    failureMetadata: { failedStepId: 'step-done' },
    transitionReason: 'tool-error',
  })
  assert.equal(clockCalls, 2)
  assert.ok(failed.run.finalOutput.length <= 280)
  assert.match(failed.run.finalOutput, /Next step: Enable the tool or choose another available tool, then rerun the workflow\.$/)
  assert.doesNotMatch(failed.run.finalOutput, /Android undo available\./, 'error output preserves legacy undo-copy asymmetry')
  assert.equal(failed.run.traces.at(-1).metadata.androidUndoOperationCount, 2, 'error traces retain undo metadata')
  assert.equal(failed.run.traces.at(-1).metadata.failedStepId, 'step-done')

  const deduped = policy.finalizeOutput(
    `${'z'.repeat(180)}\nNext step: Retry visibly.`,
    120,
    'Retry visibly.',
  )
  assert.ok(deduped.length <= 120)
  assert.equal((deduped.match(/Next step: Retry visibly\./g) ?? []).length, 1)
  assert.equal(policy.finalizeOutput('  unbounded redacted body  ', Number.NaN), 'unbounded redacted body')
}

function escapeForTestRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function assertWorkflowRuntimeOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowRuntimePolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowRuntimePolicy.ts')
  const completionTargetPath = path.join(root, 'src/modules/tasks/application/workflowCompletionPolicy.ts')
  const legacyPath = path.join(root, 'src/services/agent/agentWorkflowRuntime.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const completionTargetSource = fs.readFileSync(completionTargetPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorTargetPath, 'utf8')
  const compositionSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')

  assert.equal(fs.existsSync(legacyAgentOrchestratorPath), false, 'the covered service orchestrator stays deleted')
  assert.equal(fs.existsSync(retiredOrchestratorTargetPath), false, 'the Agent-named Tasks orchestrator stays deleted')
  assert.equal(fs.existsSync(retiredOrchestratorCompositionPath), false, 'the Agent-named orchestrator bootstrap stays deleted')
  assert.equal(fs.existsSync(agentServiceIndexPath), false, 'the obsolete Agent service barrel stays deleted')
  assert.equal(fs.existsSync(legacyPath), false, 'the covered service runtime implementation stays deleted')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the Agent-named runtime policy stays deleted')
  assert.match(orchestratorSource, /export function createWorkflowOrchestrator/)
  assert.match(orchestratorSource, /id: `workflow-run-\$\{hashString\(`/)
  assert.doesNotMatch(orchestratorSource, /id: `agent-run-/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowOrchestrator'/)
  assert.equal(typeof require('../src/modules/tasks/index.ts').createWorkflowRuntime, 'function')
  assert.equal(require('../src/modules/tasks/index.ts').createAgentWorkflowRuntime, undefined)
  assert.match(targetSource, /export const WORKFLOW_RUNTIME_SCHEMA = 'islemind\.workflow-runtime\.v2'/)
  assert.match(targetSource, /workflowRuntimeSchema: runtime\.schema/)
  assert.match(targetSource, /workflowRuntimeTransitions: runtime\.transitions\.slice\(-8\)/)
  assert.match(targetSource, /Invalid workflow runtime transition/)
  assert.doesNotMatch(
    targetSource,
    /islemind\.agent\.workflow-runtime\.v1|\bagentWorkflowRuntime[A-Z]\w*|Invalid agent workflow runtime transition/,
    'new workflow runtime diagnostics remain neutral while historical trace objects stay readable',
  )
  assert.doesNotMatch(targetSource, /@\/services\//, 'the tasks-owned pure policy has no legacy service dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the pure policy receives transition time explicitly')
  assert.doesNotMatch(targetSource, /applyAgentWorkflowRuntimeToRun/, 'the target policy has no service-specific run mutator')
  assert.doesNotMatch(targetSource, /\bAgentWorkflowRuntime\w*\b|createAgentWorkflowRuntime|advanceAgentWorkflowRuntime|observeAgentWorkflowRuntimeStep|agentWorkflowRuntimeTraceMetadata/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowRuntimePolicy'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowRuntimePolicy|createAgentWorkflowRuntime/)
  assert.match(compositionSource, /from '@\/modules\/tasks'/, 'bootstrap consumes the Tasks public API')
  assert.equal(
    (compositionSource.match(/createWorkflowOrchestrator(?:<[^;]+?>)?\s*\(\{/gs) ?? []).length,
    1,
    'bootstrap creates one concrete workflow orchestrator',
  )
  assert.doesNotMatch(orchestratorSource, /@\/bootstrap\//, 'the Tasks-owned orchestrator has no composition dependency')
  assert.doesNotMatch(orchestratorSource, /@\/services\//, 'the Tasks-owned orchestrator has no legacy service dependency')
  assert.doesNotMatch(orchestratorSource, /@\/services\/agent\/agentWorkflowRuntime/)
  assert.doesNotMatch(orchestratorSource, /applyAgentWorkflowRuntimeToRun/)
  assert.match(orchestratorSource, /run\.status = runtime\.status/)
  assert.match(
    completionTargetSource,
    /status: completedRuntime\.status/,
    'the Tasks completion policy owns terminal runtime projection',
  )
  assert.match(
    compositionSource,
    /import \{ completeWorkflowRun \} from '\.\/workflowCompletion'/,
    'bootstrap injects the composed completion policy',
  )
  assert.doesNotMatch(
    orchestratorSource,
    /completedRuntime/,
    'the live orchestrator no longer owns terminal runtime projection',
  )
}

function assertWorkflowIntentClassifierOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowIntentClassifier.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowIntentClassifier.ts')
  const legacyPath = path.join(root, 'src/services/agent/agentIntentClassifier.ts')
  const bindingPath = path.join(root, 'src/bootstrap/workflowIntent.ts')
  const retiredBindingPath = path.join(root, 'src/bootstrap/agentWorkflowIntent.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const bindingSource = fs.readFileSync(bindingPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const runtimeCompositionPath = 'src/bootstrap/conversationChatWorkflowResolutionRuntime.ts'
  const runtimeCompositionSource = fs.readFileSync(path.join(root, runtimeCompositionPath), 'utf8')
  const consumerSources = [
    'src/bootstrap/conversationChatWorkflowEntry.ts',
    'src/bootstrap/workflowOrchestrator.ts',
  ].map((relativePath) => [relativePath, fs.readFileSync(path.join(root, relativePath), 'utf8')])

  assert.equal(fs.existsSync(legacyPath), false, 'the covered service intent classifier stays deleted')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the Agent-named Tasks intent classifier stays deleted')
  assert.equal(fs.existsSync(retiredBindingPath), false, 'the Agent-named intent bootstrap stays deleted')
  assert.match(targetSource, /export function createWorkflowIntentClassifier/)
  assert.match(targetSource, /dependencies\.clock\.now\(\)/, 'intent time uses the injected clock')
  assert.match(targetSource, /dependencies\.projectTrace\(\{/, 'intent traces use the injected projector')
  assert.match(targetSource, /model-tool-selection/, 'ordinary text delegates tool selection to the model operation path')
  assert.doesNotMatch(
    targetSource,
    /settings-keyword|web-search-keyword|android-device-task-keyword|evidence-or-verification-keyword|inferAndroidWorkflowId/,
    'the Tasks classifier contains no local keyword-to-tool routing',
  )
  assert.doesNotMatch(targetSource, /@\/services\//, 'the tasks-owned classifier has no legacy service dependency')
  assert.doesNotMatch(targetSource, /@\/bootstrap\//, 'the tasks-owned classifier has no composition dependency')
  assert.doesNotMatch(targetSource, /@\/platform\//, 'the tasks-owned classifier has no platform dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the tasks-owned classifier receives its clock')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowIntentClassifier'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowIntentClassifier/)
  assert.equal(fs.existsSync(agentServiceIndexPath), false, 'the obsolete Agent service barrel stays deleted')
  assert.equal(
    (bindingSource.match(/createWorkflowIntentClassifier\(\{/g) ?? []).length,
    1,
    'bootstrap creates one concrete workflow intent classifier',
  )
  assert.match(bindingSource, /export const workflowIntentClassifier/)
  assert.doesNotMatch(bindingSource, /agentWorkflowIntentClassifier|createAgentWorkflowIntentClassifier/)
  assert.doesNotMatch(
    runtimeCompositionSource,
    /(?:@\/bootstrap\/|\.\/)workflowIntent|workflowIntentClassifier/,
    `${runtimeCompositionPath} leaves ordinary text to the model-operation path`,
  )
  for (const [relativePath, source] of consumerSources) {
    assert.doesNotMatch(source, /@\/services\/agent\/agentIntentClassifier/, `${relativePath} has no legacy classifier import`)
    assert.match(source, /@\/modules\/tasks/, `${relativePath} consumes the Tasks public entry`)
    assert.match(source, /(?:@\/bootstrap\/|\.\/)workflowIntent/, `${relativePath} consumes the single bootstrap classifier binding`)
    assert.doesNotMatch(source, /createWorkflowIntentClassifier\(/, `${relativePath} does not duplicate classifier composition`)
    assert.doesNotMatch(source, /agentWorkflowIntentClassifier|AgentWorkflowIntentClassification/, `${relativePath} has no Agent-named classifier contract`)
  }
}

function assertWorkflowPlannerOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowPlanner.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowPlanner.ts')
  const legacyPath = path.join(root, 'src/services/agent/agentPlanner.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')

  assert.equal(fs.existsSync(legacyPath), false, 'the covered service planner stays deleted')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the retired Agent-named Tasks planner stays deleted')
  assert.match(targetSource, /export function createWorkflowPlanner/)
  assert.doesNotMatch(targetSource, /\b(?:AgentWorkflowPlannerIntent|AgentWorkflowPlannerRequestedOutput|AgentWorkflowPlannerToolSource|AgentWorkflowPlannerToolRequest|AgentWorkflowPlannerClassification|AgentWorkflowPlannerWorkflowDefinition|AgentWorkflowPlannerPlannedStep|AgentWorkflowPlannerPlan|CreateAgentWorkflowPlanInput|AgentWorkflowPlannerDependencies|AgentWorkflowPlanner|createAgentWorkflowPlanner)\b/)
  assert.doesNotMatch(targetSource, /@\/services\//, 'the tasks-owned planner has no legacy service dependency')
  assert.doesNotMatch(targetSource, /@\/platform\//, 'the tasks-owned planner has no platform dependency')
  assert.doesNotMatch(targetSource, /@\/bootstrap\//, 'the tasks-owned planner has no infrastructure dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the tasks-owned planner receives its clock')
  assert.match(targetSource, /dependencies\.classifyIntent/)
  assert.match(targetSource, /dependencies\.projectTrace/)
  assert.match(targetSource, /dependencies\.formatToolIdentity/)
  assert.match(targetSource, /dependencies\.collectRagProfileRequirements/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowPlanner'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowPlanner|createAgentWorkflowPlanner/)
  assert.equal(fs.existsSync(agentServiceIndexPath), false, 'the obsolete Agent service barrel stays deleted')
  assert.match(orchestratorSource, /createWorkflowPlanner<[\s\S]{0,240}WorkflowIntentClassification/)
  assert.doesNotMatch(orchestratorSource, /agentWorkflowPlanner|createAgentWorkflowPlanner|@\/services\/agent\/agentPlanner/)
}

function assertWorkflowStepExecutorOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowStepExecutor.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowStepExecutor.ts')
  const legacyPath = path.join(root, 'src/services/agent/agentExecutor.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')

  assert.equal(fs.existsSync(legacyPath), false, 'the covered service step executor stays deleted')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the retired Agent-named Tasks step executor stays deleted')
  assert.match(targetSource, /export function createWorkflowStepExecutor/)
  assert.doesNotMatch(targetSource, /\b(?:AgentWorkflowStepToolSource|AgentWorkflowStepFailureCode|AgentWorkflowStepStatus|AgentWorkflowStepObservationStatus|AgentWorkflowStepToolRequest|AgentWorkflowStepObservation|AgentWorkflowStep|AgentWorkflowStepRuntimeOptions|ExecuteAgentWorkflowStepInput|AgentWorkflowStepToolExecutionInput|AgentWorkflowStepExecutorDependencies|AgentWorkflowStepExecutor|createAgentWorkflowStepExecutor)\b/)
  assert.doesNotMatch(targetSource, /@\/services\//, 'the tasks-owned step executor has no legacy service dependency')
  assert.doesNotMatch(targetSource, /@\/bootstrap\//, 'the tasks-owned step executor has no infrastructure dependency')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the tasks-owned step executor receives its clock')
  assert.match(targetSource, /executeTool\(/, 'tool execution is injected through the application boundary')
  assert.match(targetSource, /projectTrace\(/, 'trace projection is injected through the application boundary')
  assert.match(targetSource, /Object\.getOwnPropertyDescriptor/, 'tool input summaries inspect descriptors instead of evaluating accessors')
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowStepExecutor'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowStepExecutor|createAgentWorkflowStepExecutor/)
  assert.equal(fs.existsSync(agentServiceIndexPath), false, 'the obsolete Agent service barrel stays deleted')
  assert.match(orchestratorSource, /createWorkflowStepExecutor<[\s\S]{0,160}TaskBoundToolRuntimeOptions\s*>/)
  assert.match(orchestratorSource, /executeTaskBoundTool/)
  assert.doesNotMatch(orchestratorSource, /agentWorkflowStepExecutor|createAgentWorkflowStepExecutor|@\/services\/agent\/agentExecutor/)
}

function assertWorkflowExecutionRunContractOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowExecutionRunContracts.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowRunContracts.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const consumerPaths = [
    'src/modules/tasks/application/workflowOrchestrator.ts',
    'src/modules/tasks/application/workflowSkillPolicy.ts',
    'src/bootstrap/workflowOrchestrator.ts',
    'src/bootstrap/conversationChatWorkflowEntry.ts',
  ]

  assert.equal(fs.existsSync(retiredTargetPath), false, 'the retired Agent-named execution-run contract stays deleted')
  assert.match(
    targetSource,
    /export interface WorkflowExecutionRuntimeLogOptions \{\s*enabled\?: boolean\s*maxBytes\?: number\s*\}/,
    'runtime-log options retain their complete optional field shape',
  )
  assert.match(
    targetSource,
    /export interface WorkflowExecutionRun \{\s*id: string\s*assistantRunId\?: AssistantRunId\s*goal: string\s*intent\?: ConversationChatWorkflowEntryIntent\s*status: WorkflowRuntimeStatus\s*steps: WorkflowStep\[\]\s*traces: ProcessTrace\[\]\s*startedAt: number\s*completedAt\?: number\s*failureCode\?: WorkflowRuntimeFailureCode\s*finalOutput\?: string\s*pendingAction\?: WorkflowMessagePendingAction\s*\}/,
    'execution-run projection retains its complete ordered field shape and mutability',
  )
  assert.doesNotMatch(targetSource, /AgentWorkflowExecutionRun|AgentWorkflowExecutionRuntimeLogOptions|agentWorkflowRunContracts/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowExecutionRunContracts'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowRunContracts|AgentWorkflowExecutionRun|AgentWorkflowExecutionRuntimeLogOptions/)

  for (const relativePath of consumerPaths) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert.match(source, /WorkflowExecutionRun/, `${relativePath} consumes the generic execution-run contract`)
    assert.doesNotMatch(source, /AgentWorkflowExecutionRun|AgentWorkflowExecutionRuntimeLogOptions|agentWorkflowRunContracts/, `${relativePath} has no retired execution-run contract`)
  }
}

function assertWorkflowCheckpointProjectionOwnership() {
  const targetPath = path.join(root, 'src/modules/tasks/application/workflowCheckpointProjectionSession.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentWorkflowCheckpointSession.ts')
  const recorderPath = path.join(root, 'src/modules/tasks/application/workflowCheckpointRecorder.ts')
  const retiredRecorderPath = path.join(root, 'src/modules/tasks/application/agentWorkflowCheckpointRecorder.ts')
  const storeContractPath = path.join(root, 'src/modules/tasks/application/workflowCheckpoint.ts')
  const retiredStoreContractPath = path.join(root, 'src/modules/tasks/application/agentWorkflowCheckpoint.ts')
  const repositoryAdapterPath = path.join(root, 'src/modules/tasks/adapters/sqliteWorkflowCheckpointRepository.ts')
  const retiredRepositoryAdapterPath = path.join(root, 'src/modules/tasks/adapters/sqliteAgentWorkflowCheckpointRepository.ts')
  const checkpointBootstrapPath = path.join(root, 'src/bootstrap/workflowCheckpoints.ts')
  const retiredCheckpointBootstrapPath = path.join(root, 'src/bootstrap/agentWorkflowCheckpoints.ts')
  const legacyPath = path.join(root, 'src/services/agent/agentWorkflowCheckpointAdapter.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  const recorderSource = fs.readFileSync(recorderPath, 'utf8')
  const storeContractSource = fs.readFileSync(storeContractPath, 'utf8')
  const repositoryAdapterSource = fs.readFileSync(repositoryAdapterPath, 'utf8')
  const taskEntrySource = fs.readFileSync(path.join(root, 'src/modules/tasks/index.ts'), 'utf8')
  const checkpointBootstrapSource = fs.readFileSync(checkpointBootstrapPath, 'utf8')
  const bootstrapEntrySource = fs.readFileSync(path.join(root, 'src/bootstrap/index.ts'), 'utf8')
  const chatWorkflowRuntimeSource = fs.readFileSync(path.join(root, 'src/bootstrap/vnextChatWorkflowRuntime.ts'), 'utf8')
  const orchestratorSource = fs.readFileSync(orchestratorCompositionPath, 'utf8')

  assert.equal(fs.existsSync(legacyPath), false, 'the covered checkpoint adapter stays deleted')
  assert.equal(fs.existsSync(retiredTargetPath), false, 'the Agent-named checkpoint projection session stays deleted')
  assert.equal(fs.existsSync(retiredRecorderPath), false, 'the Agent-named checkpoint recorder stays deleted')
  assert.equal(fs.existsSync(retiredStoreContractPath), false, 'the Agent-named checkpoint codec stays deleted')
  assert.equal(fs.existsSync(retiredRepositoryAdapterPath), false, 'the Agent-named SQLite checkpoint repository stays deleted')
  assert.equal(fs.existsSync(retiredCheckpointBootstrapPath), false, 'the Agent-named checkpoint bootstrap stays deleted')
  for (const symbol of [
    'WorkflowCheckpointProjectionStatus',
    'WorkflowCheckpointProjectionStepStatus',
    'WorkflowCheckpointProjectionStep',
    'WorkflowCheckpointProjectionRun',
    'WorkflowCheckpointProjectionSession',
    'WorkflowCheckpointProjectionPhase',
    'WorkflowCheckpointProjectionError',
    'createWorkflowCheckpointProjectionSession',
    'mapWorkflowCheckpointProjectionStatus',
  ]) {
    assert.match(targetSource, new RegExp(`export (?:type|interface|class|function) ${symbol}\\b`))
  }
  for (const symbol of [
    'WorkflowCheckpointRecorderDependencies',
    'WorkflowCheckpointProgress',
    'WorkflowCheckpointRecorder',
    'createWorkflowCheckpointRecorder',
  ]) {
    assert.match(recorderSource, new RegExp(`export (?:interface|function) ${symbol}\\b`))
  }
  for (const symbol of [
    'WorkflowCheckpointDatabaseValue',
    'WorkflowCheckpointDatabaseRunResult',
    'WorkflowCheckpointDatabaseExecutor',
    'WorkflowCheckpointDatabase',
    'WorkflowCheckpointDatabaseProvider',
    'createSqliteWorkflowCheckpointRepository',
  ]) {
    assert.match(repositoryAdapterSource, new RegExp(`export (?:type|interface|function) ${symbol}\\b`))
  }
  for (const symbol of [
    'WorkflowCheckpoint',
    'WorkflowCheckpointJournalEntry',
    'WorkflowCheckpointRepository',
    'WorkflowCheckpointRecovery',
    'WorkflowCheckpointStore',
  ]) {
    assert.match(storeContractSource, new RegExp(`export interface ${symbol}\\b`))
  }
  assert.match(storeContractSource, /export function createWorkflowCheckpointStore\b/)
  assert.match(storeContractSource, /export function parseWorkflowCheckpoint\b/)
  assert.match(storeContractSource, /export function parseWorkflowCheckpointJournalEntry\b/)
  assert.match(storeContractSource, /islemind\.workflow-checkpoint\.v2/)
  assert.match(storeContractSource, /islemind\.workflow-checkpoint-journal\.v2/)
  assert.match(storeContractSource, /replaySideEffects: false/)
  const tasksModule = require('../src/modules/tasks/index.ts')
  assert.equal(typeof tasksModule.createWorkflowCheckpointProjectionSession, 'function')
  assert.equal(tasksModule.createAgentWorkflowCheckpointProjectionSession, undefined)
  assert.equal(typeof tasksModule.createWorkflowCheckpointRecorder, 'function')
  assert.equal(tasksModule.createAgentWorkflowCheckpointRecorder, undefined)
  assert.equal(typeof tasksModule.createSqliteWorkflowCheckpointRepository, 'function')
  assert.equal(tasksModule.createSqliteAgentWorkflowCheckpointRepository, undefined)
  assert.equal(typeof tasksModule.createWorkflowCheckpointStore, 'function')
  assert.equal(tasksModule.createAgentWorkflowCheckpointStore, undefined)
  assert.equal(typeof tasksModule.parseWorkflowCheckpoint, 'function')
  assert.equal(tasksModule.parseAgentWorkflowCheckpoint, undefined)
  assert.doesNotMatch(targetSource, /@\/services\//, 'the tasks-owned projection has no legacy service dependency')
  assert.doesNotMatch(targetSource, /@\/utils\//, 'the projection receives redaction through its application boundary')
  assert.doesNotMatch(targetSource, /Date\.now\(/, 'the projection receives fallback time explicitly')
  assert.doesNotMatch(recorderSource, /agentWorkflowCheckpointRecorder|AgentWorkflowCheckpointRecorder|createAgentWorkflowCheckpointRecorder/)
  const retiredRepositoryAdapterNames = /sqliteAgentWorkflowCheckpointRepository|createSqliteAgentWorkflowCheckpointRepository|\bAgentWorkflowCheckpointDatabase(?:Value|RunResult|Executor|Provider)?\b/
  const retiredStoreNames = /\b(?:AgentWorkflowCheckpointStore|createAgentWorkflowCheckpointStore)\b/
  const retiredCheckpointContractNames = /\bAgentWorkflowCheckpoint\w*\b|\bAGENT_WORKFLOW_CHECKPOINT\w*\b|\b(?:parse|validate)AgentWorkflowCheckpoint\w*\b|agentWorkflowCheckpoint\.ts/
  assert.doesNotMatch(repositoryAdapterSource, retiredRepositoryAdapterNames)
  assert.doesNotMatch(storeContractSource, retiredStoreNames)
  assert.doesNotMatch(storeContractSource, retiredCheckpointContractNames)
  assert.match(targetSource, /from '\.\/workflowCheckpointRecorder'/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowCheckpointProjectionSession'/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowCheckpointRecorder'/)
  assert.match(taskEntrySource, /export \* from '\.\/application\/workflowCheckpoint'/)
  assert.match(taskEntrySource, /export \* from '\.\/adapters\/sqliteWorkflowCheckpointRepository'/)
  assert.doesNotMatch(taskEntrySource, /agentWorkflowCheckpoint(?:Session|Recorder)|AgentWorkflowCheckpointProjection|AgentWorkflowProjectionStatus|AgentWorkflowProjectionStepStatus|AgentWorkflowCheckpointRecorder|createAgentWorkflowCheckpointRecorder/)
  assert.doesNotMatch(taskEntrySource, retiredRepositoryAdapterNames)
  assert.doesNotMatch(taskEntrySource, retiredStoreNames)
  assert.doesNotMatch(taskEntrySource, retiredCheckpointContractNames)
  assert.match(checkpointBootstrapSource, /export function createWorkflowCheckpointRuntime\b/)
  assert.match(checkpointBootstrapSource, /createSqliteWorkflowCheckpointRepository\(/)
  assert.match(checkpointBootstrapSource, /createWorkflowCheckpointStore\(repository\)/)
  assert.doesNotMatch(checkpointBootstrapSource, retiredRepositoryAdapterNames)
  assert.doesNotMatch(checkpointBootstrapSource, /createAgentWorkflowCheckpointRuntime|agentWorkflowCheckpoints/)
  assert.match(bootstrapEntrySource, /export \* from '\.\/workflowCheckpoints'/)
  assert.doesNotMatch(bootstrapEntrySource, /agentWorkflowCheckpoints|createAgentWorkflowCheckpointRuntime/)
  assert.match(chatWorkflowRuntimeSource, /import \{ createWorkflowCheckpointRuntime \} from '\.\/workflowCheckpoints'/)
  assert.match(chatWorkflowRuntimeSource, /createWorkflowCheckpointRuntime\(databaseProvider\)/)
  assert.doesNotMatch(chatWorkflowRuntimeSource, /agentWorkflowCheckpoints|createAgentWorkflowCheckpointRuntime/)
  for (const relativePath of [
    'src/modules/tasks/application/workflowCheckpointRecorder.ts',
    'src/modules/tasks/application/workflowCheckpointProjectionSession.ts',
    'src/modules/tasks/application/conversationChatWorkflowRuntimePolicy.ts',
    'src/modules/tasks/application/conversationChatWorkflowEntryPolicy.ts',
    'src/modules/tasks/application/workflowOrchestrator.ts',
    'src/modules/conversations/application/conversationChatWorkflowReplyStart.ts',
    'src/bootstrap/workflowCheckpoints.ts',
    'src/bootstrap/vnextChatWorkflowRuntime.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert.match(source, /\bWorkflowCheckpointStore\b/, `${relativePath} consumes the generic checkpoint store`)
    assert.doesNotMatch(source, retiredStoreNames, `${relativePath} has no retired checkpoint store symbol`)
  }
  assert.match(orchestratorSource, /createWorkflowCheckpointProjectionSession/)
  assert.match(orchestratorSource, /redactText: redactSensitiveText/)
  assert.doesNotMatch(orchestratorSource, /agentWorkflowCheckpointAdapter/)
}

function assertConversationChatWorkflowMessageProjection() {
  const {
    conversationChatWorkflowFailureToChatError,
    buildConversationChatWorkflowAssistantMessagePatch,
    splitConversationChatWorkflowTracesForMessage,
  } = require('../src/modules/conversations/application/conversationChatWorkflowMessageProjection.ts')
  assert.deepEqual(
    readStringUnionMembers(
      'src/modules/conversations/application/conversationChatWorkflowMessageProjection.ts',
      'ConversationChatWorkflowMessageFailureCode',
    ),
    readStringUnionMembers('src/modules/tasks/application/workflowRuntimePolicy.ts', 'WorkflowRuntimeFailureCode'),
    'Chat workflow message projection failure codes stay exhaustive with the Tasks compatibility contract',
  )
  const traces = splitConversationChatWorkflowTracesForMessage([
    { id: 'reasoning', type: 'reasoning', title: 'Reasoning', status: 'running', content: 'Visible', startedAt: 1 },
    { id: 'retrieval', type: 'retrieval', title: 'Retrieval', status: 'pending', completedAt: 2 },
    { id: 'tool', type: 'tool', title: 'Tool', status: 'running', startedAt: 3 },
  ])
  assert.equal(traces.reasoning[0].status, 'done', 'Chat workflow message projection settles visible running reasoning')
  assert.equal(traces.retrievalTrace[0].status, 'done', 'Chat workflow message projection settles completed retrieval traces')
  assert.equal(traces.toolCalls[0].status, 'skipped', 'Chat workflow message projection settles empty running tool traces as skipped')
  const expectedChatErrors = {
    provider_unavailable: 'disabled_provider',
    tool_unavailable: 'unknown',
    permission_required: 'unknown',
    schema_invalid: 'unknown',
    rag_unavailable: 'unknown',
    evidence_insufficient: 'unknown',
    cancelled: 'unknown',
    step_limit_reached: 'unknown',
    policy_denied: 'unknown',
    execution_failed: 'unknown',
  }
  for (const [failureCode, expectedErrorCode] of Object.entries(expectedChatErrors)) {
    assert.equal(conversationChatWorkflowFailureToChatError(failureCode), expectedErrorCode, `Chat workflow ${failureCode} retains its chat error mapping`)
  }

  const patch = buildConversationChatWorkflowAssistantMessagePatch({
    handled: true,
    content: '  projected reply  ',
    status: 'error',
    traces: [
      { id: 'knowledge', type: 'knowledge', title: 'Knowledge', status: 'done', startedAt: 4, completedAt: 5 },
    ],
    failureCode: 'provider_unavailable',
  }, Date.now() - 10)
  assert.equal(patch.content, 'projected reply', 'Chat workflow message projection trims visible content')
  assert.equal(patch.responseText, 'projected reply', 'Chat workflow message projection keeps response text aligned')
  assert.equal(patch.status, 'error', 'Chat workflow message projection retains terminal error status')
  assert.equal(patch.errorCode, 'disabled_provider', 'Chat workflow message projection maps provider failure for the UI')
  assert.equal(patch.retrievalTrace.length, 1, 'Chat workflow message projection classifies knowledge traces as retrieval')
  assert.deepEqual(patch.usage, { inputTokens: 0, outputTokens: 4, totalTokens: 4, source: 'estimated' })
  assert.equal(patch.tokenCount, 4, 'Chat workflow message projection retains deterministic token estimation')
  assert.equal(patch.durationMs >= 0, true, 'Chat workflow message projection records non-negative duration')

  const cancelled = buildConversationChatWorkflowAssistantMessagePatch({ handled: true, content: '', status: 'cancelled', traces: [] })
  assert.equal(cancelled.status, 'cancelled', 'Chat workflow message projection preserves cancellation')
}

function readStringUnionMembers(relativePath, typeName) {
  const filename = path.join(root, relativePath)
  const sourceFile = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = sourceFile.statements.find((statement) => (
    ts.isTypeAliasDeclaration(statement) && statement.name.text === typeName
  ))
  assert.ok(declaration && ts.isUnionTypeNode(declaration.type), `${typeName} is a string union`)
  return declaration.type.types.map((member) => {
    assert.ok(
      ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal),
      `${typeName} contains only string literals`,
    )
    return member.literal.text
  }).sort()
}

async function assertLiveCheckpointSeam() {
  const calls = []
  const signal = new AbortController().signal
  const { runWorkflow } = loadOrchestratorWithCheckpointSession(() => ({
    async initialize(candidate) {
      calls.push(['initialize', candidate])
    },
    async recordStarted(_occurredAt, candidate) {
      calls.push(['started', candidate])
    },
    async recordStep(_step, candidate) {
      calls.push(['step', candidate])
    },
    async recordTerminal(_run, candidate) {
      calls.push(['terminal', candidate])
    },
  }))
  const run = await runWorkflow({
    goal: 'Execute the live checkpoint seam fixture.',
    assistantRunId: 'assistant-run-checkpoint-seam',
    workflowCheckpointStore: {},
    signal,
    now: 100,
  })
  assert.match(run.id, /^workflow-run-[a-z0-9]+$/, 'new workflow runs use the neutral forward-write identity prefix')
  assert.doesNotMatch(run.id, /^agent-run-/, 'new workflow runs do not recreate the historical Agent identity prefix')
  assert.equal(run.status, 'done', 'live checkpoint seam preserves successful Agent completion')
  assert.deepEqual(calls.map(([name]) => name), ['initialize', 'started', 'step', 'terminal'])
  assert.ok(calls.every(([, candidate]) => candidate === signal), 'live checkpoint seam awaits every phase with the exact caller signal')

  const terminalFailure = new Error('checkpoint terminal failed')
  const failing = loadOrchestratorWithCheckpointSession(() => ({
    async initialize() {},
    async recordStarted() {},
    async recordStep() {},
    async recordTerminal() {
      throw terminalFailure
    },
  })).runWorkflow
  await assert.rejects(
    failing({
      goal: 'Reject silent checkpoint success.',
      assistantRunId: 'assistant-run-checkpoint-failure',
      workflowCheckpointStore: {},
      signal,
      now: 200,
    }),
    (error) => error === terminalFailure,
    'the live orchestrator must not catch and suppress terminal checkpoint failure',
  )
}

async function assertLiveContinuationSeam() {
  const signal = new AbortController().signal
  const cancelled = loadOrchestratorWithCheckpointSession(() => undefined, {
    executeTool: async (input) => ({
      ok: false,
      status: 'cancelled',
      output: 'Fixture tool cancellation.',
      errorCode: 'cancelled',
      diagnostic: {
        id: `${input.stepId}-diagnostic`,
        type: 'tool',
        title: input.request.name ?? input.request.toolId,
        status: 'cancelled',
        startedAt: 101,
        completedAt: 102,
        metadata: {},
      },
      metadata: {},
    }),
  }).runWorkflow
  const cancelledRun = await cancelled({
    goal: 'Exercise the live cancellation continuation seam.',
    signal,
    now: 300,
  })
  assert.equal(cancelledRun.status, 'cancelled', 'live tool cancellation remains terminal')
  assert.equal(cancelledRun.failureCode, 'cancelled')
  assert.equal(cancelledRun.pendingAction, undefined, 'live cancellation creates no pending action')
  assert.equal(cancelledRun.traces.at(-1)?.metadata?.completedStepCount, 0, 'live cancellation counts only done steps')
  assert.equal(cancelledRun.traces.at(-1)?.metadata?.remainingStepCount, 1)
  assert.match(cancelledRun.traces.at(-1)?.metadata?.cancelledContinuationPrompt ?? '', /visible trace/)

  const stepLimited = loadOrchestratorWithCheckpointSession(() => undefined, {
    maxSteps: 1,
    workflowSteps: [
      { id: 'step-limit-1', title: 'First fixture step' },
      { id: 'step-limit-2', title: 'Second fixture step' },
    ],
  }).runWorkflow
  const stepLimitedRun = await stepLimited({
    goal: 'Exercise the live step-limit continuation seam.',
    signal,
    now: 400,
    limits: { maxSteps: 1 },
  })
  assert.equal(stepLimitedRun.status, 'waiting')
  assert.equal(stepLimitedRun.failureCode, 'step_limit_reached')
  assert.equal(stepLimitedRun.steps.length, 1, 'live step-limit branch accounts for attempted steps')
  assert.equal(stepLimitedRun.pendingAction?.completedStepCount, 1)
  assert.equal(stepLimitedRun.pendingAction?.remainingStepCount, 1)
  assert.equal(stepLimitedRun.pendingAction?.stepId, 'step-limit-2')
  assert.equal(stepLimitedRun.pendingAction?.confirmable, false)
  assert.equal(Object.hasOwn(stepLimitedRun.pendingAction ?? {}, 'resumeToolRequest'), false)
}

async function assertInvalidWorkflowDefinitionNoDispatch() {
  const { workflowDefinitionPolicy } = require('../src/bootstrap/workflowDefinitions.ts')
  const workflowDefinition = workflowDefinitionPolicy.create({
    id: 'workflow-missing-manifest',
    name: 'Missing manifest workflow',
    steps: [{
      id: 'step-1',
      title: 'Read the fixture',
      toolRequest: {
        toolId: 'builtin:fixture:read',
        name: 'fixture.read',
        source: 'builtin',
      },
    }],
    now: 500,
  })
  const validationCalls = []
  let plannerCalls = 0
  let executorCalls = 0
  const { runWorkflow } = loadOrchestratorWithCheckpointSession(() => undefined, {
    validateWorkflowDefinition: (definition, manifests) => {
      validationCalls.push({ definition, manifests })
      return workflowDefinitionPolicy.validate(definition, manifests)
    },
    onPlan: () => {
      plannerCalls += 1
    },
    executeTool: async () => {
      executorCalls += 1
      throw new Error('invalid workflow reached tool execution')
    },
  })

  const run = await runWorkflow({
    goal: 'Reject a workflow whose tool catalog is unavailable.',
    workflowDefinition,
    now: 500,
  })

  assert.equal(run.status, 'error', 'a supplied definition without its manifest list fails closed')
  assert.equal(run.failureCode, 'schema_invalid')
  assert.equal(run.steps.length, 0, 'invalid definition admission records no attempted steps')
  assert.equal(validationCalls.length, 1, 'the supplied definition is validated exactly once')
  assert.equal(validationCalls[0].definition, workflowDefinition, 'validation receives the exact supplied definition')
  assert.deepEqual(validationCalls[0].manifests, [], 'an absent manifest list validates as an empty catalog')
  assert.equal(plannerCalls, 0, 'invalid definition admission never invokes the planner')
  assert.equal(executorCalls, 0, 'invalid definition admission never invokes a tool executor')
}

function loadOrchestratorWithCheckpointSession(createSession, options = {}) {
  const originalLoad = Module._load
  const orchestratorPath = orchestratorCompositionPath
  const taskModule = require('../src/modules/tasks/index.ts')
  delete require.cache[orchestratorPath]
  Module._load = function loadCheckpointSeamDependency(request, parent, isMain) {
    if (request === './taskBoundToolRuntime' || request === '@/bootstrap/taskBoundToolRuntime') {
      return {
        executeTaskBoundTool: options.executeTool ?? (async (input) => {
          const diagnostic = {
            id: `${input.stepId}-diagnostic`,
            type: 'tool',
            title: input.request.name ?? input.request.toolId,
            status: 'done',
            startedAt: 101,
            completedAt: 102,
            metadata: {},
          }
          return {
            ok: true,
            status: 'done',
            output: 'Fixture tool completed.',
            diagnostic,
            metadata: {},
          }
        }),
      }
    }
    if (request === './workflowIntent' || request === '@/bootstrap/workflowIntent') {
      return {
        workflowIntentClassifier: {
          classify: (input) => ({
            intent: 'tool_task',
            shouldRunWorkflow: true,
            confidence: 1,
            reasons: ['checkpoint-seam'],
            suggestedToolRequest: { toolId: 'fixture.tool', name: 'fixture', source: 'builtin' },
            trace: { id: 'classification', type: 'reasoning', title: 'Classify', status: 'done', startedAt: input.now },
          }),
          inferClockTime: () => undefined,
          inferReminderDateTimeIso: () => undefined,
          inferReminderTitle: () => undefined,
        },
      }
    }
    if (request === './workflowSkills' || request === '@/bootstrap/workflowSkills') {
      return { collectWorkflowRagProfileRequirements: () => [] }
    }
    if (request === '@/platform/native/androidUriPolicy') return { sanitizeAndroidApkUri: (value) => value }
    if (request === './workflowDefinitions' || request === '@/bootstrap/workflowDefinitions') {
      return {
        workflowDefinitionPolicy: {
          validate: options.validateWorkflowDefinition
            ?? ((workflow) => ({ ok: true, definition: workflow })),
        },
      }
    }
    if (request === '@/modules/integrations') {
      return { formatToolRequestIdentity: (requestValue) => requestValue?.toolId ?? '' }
    }
    if (request === '@/i18n/service') return { st: (key) => key }
    if (request === '@/modules/tasks') {
      return {
        ...taskModule,
        resolveWorkflowRunLimits: () => ({
          maxSteps: options.maxSteps ?? 3,
          maxToolCallsPerStep: 1,
          allowReadOnlyTools: true,
          allowReadWriteTools: 'visible',
          allowDestructiveTools: 'confirm',
          allowBackgroundContinuation: false,
          requireTrace: true,
          outputCharLimit: 4800,
        }),
        createWorkflowCheckpointProjectionSession: createSession,
        createWorkflowPlanner: (dependencies) => {
          const planner = taskModule.createWorkflowPlanner(dependencies)
          const observedPlanner = (input) => {
            options.onPlan?.(input)
            return planner(input)
          }
          return options.workflowSteps
            ? (input) => {
                const plan = observedPlanner(input)
                return {
                  ...plan,
                  steps: options.workflowSteps.map((step) => ({
                    ...step,
                    toolRequest: {
                      toolId: 'fixture.tool',
                      name: 'fixture',
                      source: 'builtin',
                    },
                  })),
                }
              }
            : observedPlanner
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return require(orchestratorPath)
  } finally {
    Module._load = originalLoad
    delete require.cache[orchestratorPath]
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run }
