const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const inMemorySkillStore = []

installAgentWorkflowSkillStoreStub()
registerTypeScriptSupport()

const taskPublicApi = require('../src/modules/tasks/index.ts')
const conversationPublicApi = require('../src/modules/conversations/index.ts')
const {
  DEFAULT_WORKFLOW_RUN_LIMITS,
  MAX_PROVIDER_MODEL_OPERATION_DECLARATIONS,
  createWorkflowMessageActionPolicy,
  createWorkflowSearchToolAdmissionPolicy,
  createWorkflowToolPermissionPolicy,
  createWorkflowSkillFormattingPolicy,
  createWorkflowSkillPolicy,
  resolveWorkflowRunLimits,
  resolveWorkflowRunLimitsFromSettings,
} = taskPublicApi
const {
  createConversationChatWorkflowAssistantMessageResolver,
} = conversationPublicApi
const {
  decideToolPermission,
  formatToolRequestIdentity,
  resolveManifestExecutionPolicy,
  resolveUniqueToolManifest,
  resolveToolPermissionEvidence,
  validateToolInputSchema,
} = require('../src/modules/integrations/index.ts')
const { clampTraceText, redactSensitiveText } = require('../src/core/index.ts')
const { workflowDefinitionPolicy } = require('../src/bootstrap/workflowDefinitions.ts')
const {
  getWorkflowSkillSuggestionFromMessage,
} = require('../src/presentation/features/conversations/workflowSkillSuggestionSelector.ts')
const workflowSkillApi = process.versions.bun
  ? createWorkflowSkillPolicy({
      workflowDefinitionPolicy,
      persistence: {
        listSkills: listInMemorySkills,
        upsertSkill: upsertInMemorySkill,
      },
      now: Date.now,
      redactSensitiveText,
      clampWorkflowOutput: clampTraceText,
      formatToolRequestIdentity,
      resolveUniqueManifest: resolveUniqueToolManifest,
    })
  : require('../src/bootstrap/workflowSkills.ts')
const {
  buildWorkflowSkillReviewRequiredEdit,
  buildWorkflowSkillSavePreview,
  createWorkflowSkillSuggestion,
  extractWorkflowIdFromSkill,
  getWorkflowSkillState,
  isSkillSelectableWithWorkflowSkillState,
  isWorkflowSkillEnabled,
  isWorkflowSkillReviewRequired,
  listBlockedWorkflowStatesForSkillSnapshot,
  listEnabledWorkflowIdsForSkillSnapshot,
  listWorkflowSkills,
  mergeWorkflowSkillEditTags,
  saveApprovedWorkflowSkillState,
  saveApprovedWorkflowSkillSuggestion,
  selectWorkflowDefinitionFromSkillSnapshot,
} = workflowSkillApi
const requiredAgentToolPolicyCases = [
  'quickOutput',
  'confirmAgentAction()',
  'reusableToolRequestsJson',
  'runtimeArgumentRunSkillSuggestion',
  'deletedSkillRuntimePatch',
  'listEnabledWorkflowIdsForSkillSnapshot',
  'output truncated',
  'running state must stay in trace while message content stays empty',
  'isAgentWorkflowWaitingTrace',
  'nonWorkflowRecoveryActivityTitle',
  'ChatRunner first provider request declares native provider tools',
  'native provider tool per-step limit test',
  'assert.equal(nativeProviderLimitTrace.metadata?.toolCallIndex, 1)',
  'metadataSummary(nativeProviderLimitTrace.metadata) tool call 2',
  'synthesis request must not recursively expose native provider tools',
  'conversation-chat-runner-agent-permission-drift',
  'conversation-chat-runner-agent-identity-drift',
  'conversation-chat-runner-agent-source-drift',
  'conversation-chat-runner-agent-disabled-manifest',
  'mismatchedServerVisibleResumePendingAction',
  'mismatchedDeclaredToolIdResumePendingAction',
  'Forged suggestion swaps the reviewed workflow skill payload',
  'buildWorkflowSkillReviewRequiredEdit',
  'Workflow edit requires local review',
  'hiddenPendingAction',
  'nonWorkflowTracePendingAction',
  'nonWorkflowTraceEvidenceRepairAction',
  'hiddenWorkflowRecoveryAction',
  'nonWorkflowTraceRecoveryAction',
  'hiddenWorkflowContinuationAction',
  'work-artifact-follow-up',
  'hiddenWorkflowSkillSuggestion',
  'missingRagEvidenceTraceAudit',
  'lowConfidenceRagEvidenceTraceAudit',
  'missingEvidenceRagTraceAudit',
  'lowConfidenceRagWorkflow',
  'offlineLowEvidenceRagWorkflow',
  'missingRagRepairStrategyTraceAudit',
  'mismatchedRagRepairStrategyTraceAudit',
  'mismatchedPendingActionResumeAudit',
  'mismatchedCompletionPendingActionToolIdentityAudit',
  'repair-strategy-tail',
  'rag-fallback-tail',
  'missing evidence|缺少证据|根拠不足',
  'quality-gap-tail|missing-kind-tail',
  'agent-workflow-copy-source-visible',
  'workflowCopySourceTraceText',
  'assert.equal((workflowCopySourceTraceText.match(/Copied workflow/g) ?? []).length, 1)',
  'saveApprovedWorkflowSkillSuggestion requires visible approval before persistence',
  'approved workflow skill becomes selectable through listEnabledWorkflowIdsForSkillSnapshot',
  'buildWorkflowSkillReviewRequiredEdit disables edited workflow skills for review',
  'const contextCompressionSummary = metadataSummary({})',
  'const sensitiveContextCompressionSummary = metadataSummary({})',
  'single-message-truncation',
  'const defaultWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings(testSettings)',
  'assert.equal(defaultWorkflowRunLimits.maxSteps, 3)',
  "assert.equal(defaultWorkflowRunLimits.allowReadWriteTools, 'visible')",
  "assert.equal(defaultWorkflowRunLimits.allowDestructiveTools, 'confirm')",
  'assert.equal(defaultWorkflowRunLimits.allowBackgroundContinuation, false)',
  'assert.equal(defaultWorkflowRunLimits.requireTrace, true)',
  'assert.equal(defaultWorkflowRunLimits.outputCharLimit, 4800)',
  'const boundedWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings({})',
  'assert.equal(boundedWorkflowRunLimits.maxSteps, 8)',
  'assert.equal(boundedWorkflowRunLimits.maxToolCallsPerStep, 1)',
  'assert.equal(boundedWorkflowRunLimits.outputCharLimit, 512)',
  'const importedUnsafeWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings({})',
  "assert.equal(importedUnsafeWorkflowRunLimits.allowReadWriteTools, 'visible')",
  "assert.equal(importedUnsafeWorkflowRunLimits.allowDestructiveTools, 'confirm')",
  'const directInvalidWorkflowRunLimits = resolveWorkflowRunLimits({})',
  'const directOversizedWorkflowRunLimits = resolveWorkflowRunLimits({})',
  'const directUnsafeWorkflowRunLimits = resolveWorkflowRunLimits({})',
  'assert.equal(directUnsafeWorkflowRunLimits.allowBackgroundContinuation, false)',
  'assert.equal(directUnsafeWorkflowRunLimits.requireTrace, true)',
  "assert.equal(destructiveConfirmedTrace.metadata?.allowReason, 'user-confirmed')",
  'assert.equal(destructiveConfirmedTrace.metadata?.userConfirmed, true)',
  'Android undo button must require workflow follow-up trace metadata',
  'Android undo prompt must ignore arbitrary message body JSON',
  'Android undo operations must require Android apply-operation tool trace',
]

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAgentToolPolicyHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isAgentToolPolicyHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function installAgentWorkflowSkillStoreStub() {
  Module._load = function loadWithAgentWorkflowSkillStoreStub(request, parent, isMain) {
    if (request === '@/bootstrap/conversationSkills') {
      return {
        listSkills: listInMemorySkills,
        upsertSkill: upsertInMemorySkill,
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}

async function listInMemorySkills() {
  return inMemorySkillStore.map(cloneJson)
}

async function upsertInMemorySkill(skill) {
  const saved = cloneJson(skill)
  const index = inMemorySkillStore.findIndex((item) => item.id === saved.id)
  if (index >= 0) inMemorySkillStore.splice(index, 1, saved)
  else inMemorySkillStore.unshift(saved)
  return cloneJson(saved)
}

function resetAgentWorkflowSkillStore() {
  inMemorySkillStore.splice(0, inMemorySkillStore.length)
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function runWorkflowRunLimitPolicyChecks() {
  assert.equal(typeof resolveWorkflowRunLimits, 'function', 'Tasks public API exposes direct workflow run-limit resolution')
  assert.equal(typeof resolveWorkflowRunLimitsFromSettings, 'function', 'Tasks public API exposes settings workflow run-limit resolution')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentPolicy.ts')), false, 'covered legacy Agent policy facade is deleted')
  assert.deepEqual(DEFAULT_WORKFLOW_RUN_LIMITS, {
    maxSteps: 3,
    maxToolCallsPerStep: 1,
    allowReadOnlyTools: true,
    allowReadWriteTools: 'visible',
    allowDestructiveTools: 'confirm',
    allowBackgroundContinuation: false,
    requireTrace: true,
    outputCharLimit: 4800,
  }, 'Tasks preserves the workflow run-limit defaults')

  const testSettings = {}
  const defaultWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings(testSettings)
  assert.equal(defaultWorkflowRunLimits.maxSteps, 3)
  assert.equal(defaultWorkflowRunLimits.allowReadWriteTools, 'visible')
  assert.equal(defaultWorkflowRunLimits.allowDestructiveTools, 'confirm')
  assert.equal(defaultWorkflowRunLimits.allowBackgroundContinuation, false)
  assert.equal(defaultWorkflowRunLimits.requireTrace, true)
  assert.equal(defaultWorkflowRunLimits.outputCharLimit, 4800)
  assert.deepEqual(testSettings, {}, 'settings projection does not mutate its input')

  const boundedSettings = {
    agentWorkflowMaxSteps: 99.8,
    agentWorkflowMaxToolCallsPerStep: -5,
    agentWorkflowOutputCharLimit: 1,
  }
  const boundedWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings(boundedSettings)
  assert.equal(boundedWorkflowRunLimits.maxSteps, 8)
  assert.equal(boundedWorkflowRunLimits.maxToolCallsPerStep, 1)
  assert.equal(boundedWorkflowRunLimits.outputCharLimit, 512)
  assert.deepEqual(boundedSettings, {
    agentWorkflowMaxSteps: 99.8,
    agentWorkflowMaxToolCallsPerStep: -5,
    agentWorkflowOutputCharLimit: 1,
  }, 'bounded settings resolution does not mutate its input')

  const importedUnsafeWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings({
    agentWorkflowAllowReadOnlyTools: 'yes',
    agentWorkflowAllowReadWriteTools: 'always',
    agentWorkflowAllowDestructiveTools: 'always',
  })
  assert.equal(importedUnsafeWorkflowRunLimits.allowReadOnlyTools, true)
  assert.equal(importedUnsafeWorkflowRunLimits.allowReadWriteTools, 'visible')
  assert.equal(importedUnsafeWorkflowRunLimits.allowDestructiveTools, 'confirm')

  const deniedWorkflowRunLimits = resolveWorkflowRunLimitsFromSettings({
    agentWorkflowAllowReadOnlyTools: false,
    agentWorkflowAllowReadWriteTools: false,
    agentWorkflowAllowDestructiveTools: false,
  })
  assert.equal(deniedWorkflowRunLimits.allowReadOnlyTools, false)
  assert.equal(deniedWorkflowRunLimits.allowReadWriteTools, false)
  assert.equal(deniedWorkflowRunLimits.allowDestructiveTools, false)

  const directInput = {
    maxSteps: 4.9,
    maxToolCallsPerStep: 2.9,
    outputCharLimit: 1000.9,
    allowReadOnlyTools: false,
    allowReadWriteTools: true,
    allowDestructiveTools: true,
    allowBackgroundContinuation: true,
    requireTrace: false,
  }
  const directWorkflowRunLimits = resolveWorkflowRunLimits(directInput)
  assert.equal(directWorkflowRunLimits.maxSteps, 4)
  assert.equal(directWorkflowRunLimits.maxToolCallsPerStep, 2)
  assert.equal(directWorkflowRunLimits.outputCharLimit, 1000)
  assert.equal(directWorkflowRunLimits.allowReadOnlyTools, false)
  assert.equal(directWorkflowRunLimits.allowReadWriteTools, true)
  assert.equal(directWorkflowRunLimits.allowDestructiveTools, true)
  assert.equal(directWorkflowRunLimits.allowBackgroundContinuation, false)
  assert.equal(directWorkflowRunLimits.requireTrace, true)
  assert.equal(directInput.allowBackgroundContinuation, true, 'direct resolution does not mutate its input')
  assert.equal(directInput.requireTrace, false, 'direct resolution preserves the caller object')

  const directInvalidWorkflowRunLimits = resolveWorkflowRunLimits({
    maxSteps: 0,
    maxToolCallsPerStep: Number.NaN,
    outputCharLimit: Number.NEGATIVE_INFINITY,
  })
  assert.equal(directInvalidWorkflowRunLimits.maxSteps, 3)
  assert.equal(directInvalidWorkflowRunLimits.maxToolCallsPerStep, 1)
  assert.equal(directInvalidWorkflowRunLimits.outputCharLimit, 4800)

  const directOversizedWorkflowRunLimits = resolveWorkflowRunLimits({
    maxSteps: 99,
    maxToolCallsPerStep: 99,
    outputCharLimit: 99999,
  })
  assert.equal(directOversizedWorkflowRunLimits.maxSteps, 8)
  assert.equal(directOversizedWorkflowRunLimits.maxToolCallsPerStep, 3)
  assert.equal(directOversizedWorkflowRunLimits.outputCharLimit, 12000)

  const directUnsafeWorkflowRunLimits = resolveWorkflowRunLimits({
    allowBackgroundContinuation: true,
    requireTrace: false,
  })
  assert.equal(directUnsafeWorkflowRunLimits.allowBackgroundContinuation, false)
  assert.equal(directUnsafeWorkflowRunLimits.requireTrace, true)
}

function runWorkflowSearchToolAdmissionChecks() {
  assert.equal(typeof createWorkflowSearchToolAdmissionPolicy, 'function', 'Tasks public API exposes the workflow search-tool admission factory')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/tasks/application/workflowSearchToolAdmissionPolicy.ts')), true, 'workflow search-tool admission uses the neutral Tasks path')
  assert.equal(fs.existsSync(path.join(root, 'src/modules/tasks/application/agentSearchToolAdmissionPolicy.ts')), false, 'retired Agent-named Tasks search-tool policy stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/workflowSearchToolAdmission.ts')), true, 'workflow search-tool admission uses the neutral bootstrap path')
  assert.equal(fs.existsSync(path.join(root, 'src/bootstrap/agentSearchToolAdmission.ts')), false, 'retired Agent-named search-tool bootstrap stays deleted')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentSearchToolPolicy.ts')), false, 'covered Agent search-tool service stays deleted')

  const {
    filterLocalSearchToolManifests,
    filterProviderNativeChatToolManifests,
    isBuiltinSearchToolRequest,
    resolveModelOperationPermissionCeiling,
    shouldExposeLocalSearchTool,
  } = createWorkflowSearchToolAdmissionPolicy({
    resolveSearchProvider(settings) {
      return settings.webSearchEnabled ? settings.searchProvider : 'off'
    },
    builtinSearchTool: {
      toolId: 'builtin:islemind-builtins:search_web',
      source: 'builtin',
      serverId: 'islemind-builtins',
      name: 'search_web',
    },
  })

  const searchManifest = {
    id: 'builtin:islemind-builtins:search_web',
    source: 'builtin',
    serverId: 'islemind-builtins',
    name: 'search_web',
    enabled: true,
    permission: 'read-only',
  }
  const manifests = [
    searchManifest,
    { id: 'builtin:islemind-builtins:settings_get', source: 'builtin', serverId: 'islemind-builtins', name: 'settings_get' },
    { id: 'mcp:remote:search_web', source: 'mcp', serverId: 'remote', name: 'search_web' },
  ]
  const localSettings = { webSearchEnabled: true, searchProvider: 'tavily' }
  const nativeSettings = { webSearchEnabled: true, searchProvider: 'native' }
  const offSettings = { webSearchEnabled: true, searchProvider: 'off' }
  const disabledSettings = { webSearchEnabled: false, searchProvider: 'tavily' }

  assert.equal(shouldExposeLocalSearchTool(localSettings), true, 'enabled non-native search exposes the local built-in')
  assert.equal(shouldExposeLocalSearchTool(nativeSettings), false, 'provider-native search suppresses local execution')
  assert.equal(shouldExposeLocalSearchTool(offSettings), false, 'explicitly off search suppresses local execution')
  assert.equal(shouldExposeLocalSearchTool(disabledSettings), false, 'disabled search suppresses local execution')
  assert.equal(filterLocalSearchToolManifests(manifests, localSettings), manifests, 'unchanged local admission preserves the caller array')
  assert.deepEqual(
    filterLocalSearchToolManifests(manifests, nativeSettings),
    manifests.slice(1),
    'native search removes only the exact built-in search manifest',
  )
  assert.deepEqual(
    filterLocalSearchToolManifests(manifests, offSettings),
    manifests.slice(1),
    'off search removes only the exact built-in search manifest',
  )
  assert.deepEqual(
    filterProviderNativeChatToolManifests(manifests, localSettings),
    [searchManifest],
    'provider-native declarations select only the admitted built-in search manifest',
  )
  assert.deepEqual(
    filterProviderNativeChatToolManifests(manifests, nativeSettings),
    [],
    'provider-native search mode does not redeclare the local built-in search manifest',
  )
  assert.equal(isBuiltinSearchToolRequest({ toolId: searchManifest.id }), true, 'canonical tool id matches the built-in search request')
  assert.equal(
    isBuiltinSearchToolRequest({ toolId: searchManifest.id, source: 'mcp', serverId: 'wrong', name: 'wrong' }),
    true,
    'canonical tool id retains legacy precedence over optional fallback identity fields',
  )
  assert.equal(
    isBuiltinSearchToolRequest({ toolId: 'builtin:islemind-builtins:other', source: 'builtin', serverId: 'islemind-builtins', name: 'search_web' }),
    false,
    'a wrong explicit tool id cannot fall back to otherwise matching identity fields',
  )
  assert.equal(isBuiltinSearchToolRequest({ name: 'search_web' }), true, 'legacy name-only fallback remains accepted')
  assert.equal(isBuiltinSearchToolRequest({ source: 'builtin', serverId: 'islemind-builtins', name: 'search_web' }), true, 'matching fallback identity is admitted')
  assert.equal(isBuiltinSearchToolRequest({ source: 'mcp', serverId: 'islemind-builtins', name: 'search_web' }), false, 'wrong source is rejected')
  assert.equal(isBuiltinSearchToolRequest({ source: 'builtin', serverId: 'other', name: 'search_web' }), false, 'wrong server is rejected')
  assert.equal(isBuiltinSearchToolRequest({ source: 'builtin', serverId: 'islemind-builtins', name: 'other' }), false, 'wrong name is rejected')
  assert.deepEqual(manifests[0], searchManifest, 'search admission does not mutate manifests')

  const frozenManifests = Object.freeze(manifests.map((manifest) => Object.freeze({ ...manifest })))
  assert.equal(
    filterLocalSearchToolManifests(frozenManifests, Object.freeze(localSettings)),
    frozenManifests,
    'unchanged admission preserves a frozen caller array by identity',
  )
  assert.deepEqual(
    filterLocalSearchToolManifests(frozenManifests, Object.freeze(nativeSettings)),
    frozenManifests.slice(1),
    'suppression accepts frozen inputs without changing order or elements',
  )

  const permissionManifests = Object.freeze([
    Object.freeze({ id: 'app-action:read', source: 'app-action', name: 'read', enabled: true, permission: 'read-only' }),
    Object.freeze({ id: 'app-action:write', source: 'app-action', name: 'write', enabled: true, permission: 'read-write' }),
    Object.freeze({ id: 'app-action:delete', source: 'app-action', name: 'delete', enabled: true, permission: 'destructive' }),
  ])
  const readOnlySettings = Object.freeze({ ...localSettings, agentWorkflowAllowReadOnlyTools: true, agentWorkflowAllowReadWriteTools: false, agentWorkflowAllowDestructiveTools: false })
  const readWriteSettings = Object.freeze({ ...readOnlySettings, agentWorkflowAllowReadWriteTools: true })
  const destructiveSettings = Object.freeze({ ...readWriteSettings, agentWorkflowAllowDestructiveTools: 'confirm' })
  assert.equal(resolveModelOperationPermissionCeiling(readOnlySettings), 'read-only')
  assert.equal(resolveModelOperationPermissionCeiling(readWriteSettings), 'read-write')
  assert.equal(resolveModelOperationPermissionCeiling(destructiveSettings), 'destructive')
  assert.deepEqual(
    filterProviderNativeChatToolManifests(permissionManifests, readOnlySettings).map((manifest) => manifest.id),
    ['app-action:read'],
    'read-only admission excludes state-changing operations',
  )
  assert.deepEqual(
    filterProviderNativeChatToolManifests(permissionManifests, readWriteSettings).map((manifest) => manifest.id),
    ['app-action:read', 'app-action:write'],
    'read-write admission preserves ordered operations within its ceiling',
  )
  assert.deepEqual(
    filterProviderNativeChatToolManifests(permissionManifests, destructiveSettings).map((manifest) => manifest.id),
    ['app-action:read', 'app-action:write', 'app-action:delete'],
    'confirmed-destructive settings admit the complete ordered permission range',
  )

  const boundedManifests = Object.freeze(Array.from(
    { length: MAX_PROVIDER_MODEL_OPERATION_DECLARATIONS },
    (_, index) => Object.freeze({
      id: `app-action:bounded-${index}`,
      source: 'app-action',
      name: `bounded-${index}`,
      enabled: true,
      permission: 'read-only',
    }),
  ))
  assert.equal(
    filterProviderNativeChatToolManifests(boundedManifests, readOnlySettings).length,
    MAX_PROVIDER_MODEL_OPERATION_DECLARATIONS,
    'the provider catalog admits exactly the post-filter declaration limit',
  )
  const overflowManifests = Object.freeze([
    ...boundedManifests,
    Object.freeze({ id: 'app-action:overflow', source: 'app-action', name: 'overflow', enabled: true, permission: 'read-only' }),
  ])
  assert.deepEqual(
    filterProviderNativeChatToolManifests(overflowManifests, readOnlySettings),
    [],
    'the provider catalog fails closed when admitted declarations exceed the limit',
  )
  assert.equal(overflowManifests.length, MAX_PROVIDER_MODEL_OPERATION_DECLARATIONS + 1, 'catalog admission does not mutate frozen overflow input')
}

function runWorkflowToolPermissionProjectionChecks() {
  assert.equal(typeof createWorkflowToolPermissionPolicy, 'function', 'Tasks public API exposes the Chat-neutral workflow tool-permission policy factory')

  const projectedTraces = []
  const policy = createWorkflowToolPermissionPolicy({
    now: () => 1920000000000,
    projectTrace: (trace) => {
      projectedTraces.push(cloneJson(trace))
      return {
        ...trace,
        title: trace.title.replace(/sk-test-secret/g, '[redacted]'),
        completedAt: trace.startedAt,
        durationMs: 0,
      }
    },
    decidePermission: decideToolPermission,
    resolveEvidence: resolveToolPermissionEvidence,
    resolveExecutionPolicy: resolveManifestExecutionPolicy,
    validateInput: validateToolInputSchema,
  })
  assert.equal(typeof policy.validateWorkflowToolInput, 'function', 'Tasks policy exposes injected workflow tool schema validation')
  const unavailable = policy.decideWorkflowToolPermission({
    id: 'test:disabled',
    source: 'app-action',
    name: 'sk-test-secret',
    permission: 'read-write',
    enabled: false,
  }, {
    mode: 'agent',
    intentVisible: true,
    userConfirmed: true,
    evidenceSources: ['test:disabled-tool'],
    evidenceSummary: 'Disabled tool evidence.',
    stepIndex: 7,
    toolCallIndex: 2,
    limits: {
      maxSteps: 8,
      maxToolCallsPerStep: 3,
      allowReadWriteTools: true,
      allowDestructiveTools: true,
    },
  })
  assert.equal(projectedTraces.length, 1, 'target policy projects each permission trace exactly once')
  assert.equal(projectedTraces[0].title, 'Agent policy sk-test-secret', 'trace projector receives the unsanitized structural trace')
  assert.equal(unavailable.trace.title, 'Agent policy [redacted]', 'injected trace projection owns sanitization')
  assert.equal(unavailable.trace.id, 'agent-policy-test:disabled-1920000000000', 'injected clock produces stable permission trace identity')
  assert.equal(unavailable.trace.status, 'skipped', 'unavailable tools preserve the legacy skipped trace status')
  assert.equal(unavailable.trace.metadata?.mode, undefined, 'unavailable tool traces omit mutable mode context')
  assert.equal(unavailable.trace.metadata?.intentVisible, false, 'unavailable tool traces omit mutable visibility context')
  assert.equal(unavailable.trace.metadata?.stepIndex, undefined, 'unavailable tool traces omit mutable step context')
  assert.equal(unavailable.trace.metadata?.maxStepCount, DEFAULT_WORKFLOW_RUN_LIMITS.maxSteps, 'unavailable tool traces use default step limits')
  assert.equal(unavailable.trace.metadata?.maxToolCallsPerStep, DEFAULT_WORKFLOW_RUN_LIMITS.maxToolCallsPerStep, 'unavailable tool traces use default tool-call limits')
  assert.deepEqual(unavailable.trace.metadata?.evidenceSources, ['test:disabled-tool'], 'unavailable tool traces retain normalized evidence attribution')
  assert.equal(unavailable.trace.metadata?.evidenceReady, true, 'unavailable tool traces retain evidence reliability metadata')

  const schemaResult = policy.validateWorkflowToolInput({
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['read'] },
      options: {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 3 } },
        required: ['limit'],
        additionalProperties: false,
      },
    },
    required: ['operation', 'options'],
    additionalProperties: false,
  }, {
    operation: 'write',
    options: { limit: 4, hidden: true },
    extra: true,
  })
  assert.deepEqual(schemaResult, {
    ok: false,
    errors: [
      'extra is not allowed.',
      'operation must be one of read.',
      'options.hidden is not allowed.',
      'options.limit must be <= 3.',
    ],
  }, 'Tasks delegates exact integrations schema-validation ordering and messages')
}

function runWorkflowMessageActionPolicyChecks() {
  assert.equal(typeof createWorkflowMessageActionPolicy, 'function', 'Tasks public API exposes the Chat-neutral workflow message-action policy factory')
  assert.equal(taskPublicApi.createAgentMessageActionPolicy, undefined, 'Tasks public API does not expose the retired Agent message-action policy factory')
  const redactText = (value) => value.replace(/sk-test-secret/g, '[redacted]')
  const projectText = (value, limit) => {
    const input = redactText(value).trim()
    if (input.length <= limit) return input
    return `${input.slice(0, Math.max(0, limit - 32)).trimEnd()}\n[output truncated]`.trim()
  }
  const policy = createWorkflowMessageActionPolicy({
    projectText,
    redactText,
    workArtifactWorkflowContract: 'islemind.agent.work-artifact-workflow.v1',
  })
  const trace = (input) => ({
    type: 'reasoning',
    title: 'Agent workflow',
    status: 'done',
    ...input,
  })
  const validPendingAction = {
    id: 'pending-visible',
    reason: 'permission_required',
    title: 'Approve visible tool sk-test-secret',
    summary: 'Review sk-test-secret before continuing.',
    toolName: 'files.write',
    toolId: 'builtin:files.write',
    serverId: 'local-files',
    source: 'builtin',
    permission: 'read-write',
    argumentsPreview: '{"path":"visible.txt"}',
    confirmable: true,
    resumeToolRequest: {
      toolId: 'builtin:files.write',
      name: 'files.write',
      source: 'builtin',
      serverId: 'local-files',
      arguments: { path: 'visible.txt' },
    },
    suggestedUserPrompt: 'Continue the visible workflow.',
    workflowId: 'workflow-visible',
    workflowName: 'Visible workflow',
    workflowExpectedOutput: 'work-artifact',
    stepTitle: 'Write visible file',
    stepNumber: 2,
    planStepCount: 3,
    createdAt: 1940000000000,
  }
  const message = {
    reasoning: [trace({ completedAt: 100, metadata: { pendingAction: { ...validPendingAction, id: 'pending-old' } } })],
    retrievalTrace: [
      trace({ completedAt: 300, metadata: { pendingAction: validPendingAction } }),
      trace({ completedAt: 500, metadata: { hiddenSignature: true, pendingAction: { ...validPendingAction, id: 'pending-hidden' } } }),
    ],
    toolCalls: [trace({ completedAt: 400, metadata: { unrelated: true } })],
  }
  const originalMessage = cloneJson(message)
  const pending = policy.getWorkflowPendingActionFromMessage(message)
  assert.equal(pending?.id, 'pending-visible', 'merged trace timestamps select the newest visible valid pending action')
  assert.equal(pending?.confirmable, true, 'exact visible tool identity, source, server, and elevated permission preserve confirmation')
  assert.deepEqual(pending?.resumeToolRequest?.arguments, { path: 'visible.txt' }, 'safe resume arguments survive as a cloned payload')
  assert.equal(pending?.title.includes('[redacted]'), true, 'the injected text projection redacts visible pending-action text')
  assert.ok(pending?.suggestedUserPrompt.includes('Workflow: Visible workflow'), 'pending prompt retains workflow attribution')
  assert.ok(pending?.suggestedUserPrompt.includes('Step: 2/3'), 'pending prompt retains step attribution')
  assert.deepEqual(message, originalMessage, 'message-action selection does not mutate traces or nested resume arguments')
  assert.notEqual(pending?.resumeToolRequest?.arguments, validPendingAction.resumeToolRequest.arguments, 'resume arguments are detached from untrusted trace metadata')

  for (const [label, patch] of [
    ['source mismatch', { source: 'mcp' }],
    ['server mismatch', { serverId: 'other-server' }],
    ['tool-name mismatch', { name: 'files.delete' }],
    ['tool-id mismatch', { toolId: 'builtin:files.delete' }],
  ]) {
    const unsafe = policy.getWorkflowPendingActionFromMessage({
      reasoning: [trace({ metadata: { pendingAction: {
        ...validPendingAction,
        resumeToolRequest: { ...validPendingAction.resumeToolRequest, ...patch },
      } } })],
    })
    assert.equal(unsafe?.confirmable, false, `pending action fails closed on ${label}`)
    assert.equal(unsafe?.resumeToolRequest, undefined, `pending action hides the resume payload on ${label}`)
  }
  const readOnlyPending = policy.getWorkflowPendingActionFromMessage({
    reasoning: [trace({ metadata: { pendingAction: { ...validPendingAction, permission: 'read-only' } } })],
  })
  assert.equal(readOnlyPending?.confirmable, false, 'read-only visible actions cannot restore an elevated confirmation payload')
  const sensitivePending = policy.getWorkflowPendingActionFromMessage({
    reasoning: [trace({ metadata: { pendingAction: {
      ...validPendingAction,
      resumeToolRequest: { ...validPendingAction.resumeToolRequest, arguments: { apiKey: 'sk-private-value' } },
    } } })],
  })
  assert.equal(sensitivePending?.confirmable, false, 'sensitive resume arguments are rejected')
  assert.equal(sensitivePending?.resumeToolRequest, undefined, 'sensitive resume payload is not projected')
  const oversizedPending = policy.getWorkflowPendingActionFromMessage({
    reasoning: [trace({ metadata: { pendingAction: {
      ...validPendingAction,
      resumeToolRequest: { ...validPendingAction.resumeToolRequest, arguments: { body: 'x'.repeat(1300) } },
    } } })],
  })
  assert.equal(oversizedPending?.confirmable, false, 'oversized resume arguments are rejected')

  const evidence = policy.getWorkflowEvidenceRepairActionFromMessage({
    reasoning: [trace({ completedAt: 10, metadata: {
      pendingAction: {
        ...validPendingAction,
        id: 'repair-evidence',
        reason: 'evidence_insufficient',
        confirmable: false,
        resumeToolRequest: undefined,
        suggestedUserPrompt: undefined,
        blockedReason: 'Collect one independent source.',
        repairStrategy: 'broaden-query',
      },
      workflowId: 'workflow-visible',
      workflowName: 'Visible workflow',
      workflowExpectedOutput: 'rag-evidence',
      stepTitle: 'Verify citations',
      stepNumber: 3,
      planStepCount: 4,
    } })],
  })
  assert.equal(evidence?.repairNextStep, 'Collect one independent source.', 'evidence repair falls back to the pending blocked reason')
  assert.equal(evidence?.repairStrategy, 'broaden-query', 'evidence repair retains strategy metadata')
  assert.equal(evidence?.stepTitle, 'Write visible file', 'pending-action step attribution takes precedence over trace fallback metadata')
  assert.ok(evidence?.suggestedUserPrompt.includes('Repair the paused RAG evidence workflow.'), 'evidence metadata fallback builds a visible repair prompt')

  const recovery = policy.getWorkflowRecoveryActionFromMessage({
    reasoning: [trace({ metadata: {
      reason: 'workflow-review-required',
      failureNextStep: 'Review sk-test-secret workflow settings.',
      workflowId: 'workflow-review',
      workflowName: 'Review workflow',
      workflowExpectedOutput: 'reply',
    } })],
  })
  assert.equal(recovery?.reason, 'workflow-review-required', 'workflow recovery preserves the stable recovery reason')
  assert.equal(recovery?.failureNextStep.includes('[redacted]'), true, 'workflow recovery text uses the injected redactor')
  assert.equal(recovery?.workflowId, 'workflow-review', 'workflow recovery retains workflow attribution')

  const ambiguous = policy.getWorkflowContinuationActionFromMessage({
    reasoning: [trace({ metadata: {
      reason: 'workflow-selection-ambiguous',
      failureNextStep: 'Select one visible workflow.',
      workflowName: 'Candidate workflows',
    } })],
  })
  assert.deepEqual(ambiguous, {
    reason: 'workflow-selection-ambiguous',
    suggestedUserPrompt: 'Select one visible workflow.',
    workflowName: 'Candidate workflows',
  }, 'ambiguous workflow continuation preserves the visible choice prompt')

  const cancelled = policy.getWorkflowContinuationActionFromMessage({
    reasoning: [trace({ status: 'cancelled', metadata: {
      cancelledContinuationPrompt: 'Resume after cancellation.',
      workflowId: 'workflow-cancelled',
      workflowName: 'Cancelled workflow',
      workflowExpectedOutput: 'reply',
      nextStepTitle: 'Resume retrieval',
      nextStepNumber: 2,
      planStepCount: 5,
    } })],
  })
  assert.equal(cancelled?.reason, 'cancelled', 'cancelled traces produce the cancellation continuation')
  assert.ok(cancelled?.suggestedUserPrompt.includes('Step: 2/5'), 'cancelled continuation retains next-step attribution')

  const failed = policy.getWorkflowContinuationActionFromMessage({
    reasoning: [trace({ status: 'error', metadata: {
      failureNextStep: 'Retry the failed workflow. '.repeat(60),
      workflowId: 'workflow-failed',
      workflowName: 'Failed workflow',
      workflowExpectedOutput: 'diagnostic',
      failedStepTitle: 'Inspect source',
      failedStepNumber: 4,
      failedPlanStepCount: 6,
      failedToolName: 'files.read',
      failedToolId: 'builtin:files.read',
      failedToolSource: 'builtin',
      failedToolErrorCode: 'execution_failed',
    } })],
  })
  assert.equal(failed?.reason, 'failed', 'failed traces produce the failure continuation')
  assert.equal(failed?.suggestedUserPrompt.length, 900, 'failure continuation preserves the exact prompt limit after attribution')
  assert.ok(failed?.suggestedUserPrompt.endsWith('Error: execution_failed'), 'failure continuation keeps tool attribution at the bounded prompt tail')
  assert.ok(failed?.suggestedUserPrompt.includes('[output truncated]'), 'failure continuation marks exact truncation')

  const artifact = policy.getWorkflowContinuationActionFromMessage({
    reasoning: [trace({ completedAt: 20, metadata: {
      workflowId: 'workflow-artifact',
      workflowName: 'Artifact workflow',
      workflowExpectedOutput: 'work-artifact',
    } })],
    toolCalls: [{
      type: 'tool',
      title: 'Write artifact',
      status: 'done',
      completedAt: 30,
      metadata: {
        source: 'work-artifact',
        contract: 'islemind.agent.work-artifact-workflow.v1',
        followUpPrompt: 'Continue with the artifact.',
        stepTitle: 'Review artifact',
        stepNumber: 3,
        planStepCount: 3,
      },
    }],
  })
  assert.equal(artifact?.reason, 'work-artifact-follow-up', 'completed work artifacts expose their follow-up action')
  assert.equal(artifact?.workflowId, 'workflow-artifact', 'work-artifact follow-up inherits the latest workflow attribution')
  assert.ok(artifact?.suggestedUserPrompt.includes('Step: 3/3'), 'work-artifact follow-up retains tool-step attribution')

  assert.equal(policy.getWorkflowContinuationActionFromMessage({
    reasoning: [trace({ title: 'Unrelated activity', status: 'error', metadata: { failureNextStep: 'Do not expose.' } })],
  }), undefined, 'non-workflow traces cannot synthesize visible continuation actions')

  const targetPath = path.join(root, 'src/modules/tasks/application/workflowMessageActionPolicy.ts')
  const retiredTargetPath = path.join(root, 'src/modules/tasks/application/agentMessageActionPolicy.ts')
  const targetSource = fs.readFileSync(targetPath, 'utf8')
  for (const forbiddenImport of ['@/services', '@/bootstrap', '@/presentation', "from 'react", "from 'expo", "from 'zustand"]) {
    assert.equal(targetSource.includes(forbiddenImport), false, `Tasks message-action policy excludes ${forbiddenImport}`)
  }
  assert.equal(fs.existsSync(retiredTargetPath), false, 'retired Agent message-action policy path stays deleted')
  assert.doesNotMatch(targetSource, /\bAgent(?:MessageAction|PendingAction|EvidenceRepairAction|WorkflowRecovery|WorkflowContinuation|ToolSource|ToolRequest)\w*\b|createAgentMessageActionPolicy|getAgent(?:PendingAction|EvidenceRepairAction|WorkflowRecoveryAction|WorkflowContinuationAction)FromMessage/)
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentMessageAdapter.ts')), false, 'retired Agent message adapter stays deleted')
}

async function runConversationChatWorkflowAssistantMessageResolutionChecks() {
  const controller = new AbortController()
  const input = {
    content: 'Run the bounded workflow.',
    signal: controller.signal,
    startedAt: 1500,
    nested: { keep: true },
  }
  const inputBefore = {
    ...input,
    nested: { ...input.nested },
  }
  const reply = {
    handled: true,
    content: 'Completed.',
    status: 'done',
    traces: [],
  }
  let invocationCount = 0
  let receivedInput
  const resolver = createConversationChatWorkflowAssistantMessageResolver({
    async runWorkflow(received) {
      invocationCount += 1
      receivedInput = received
      return reply
    },
  })
  const originalNow = Date.now
  Date.now = () => 2000
  try {
    const resolution = await resolver(input)
    assert.equal(invocationCount, 1, 'Chat workflow assistant resolution invokes the injected workflow exactly once')
    assert.equal(receivedInput, input, 'Chat workflow assistant resolution passes the original input identity to the workflow')
    assert.equal(receivedInput.signal, controller.signal, 'Chat workflow assistant resolution preserves the exact cancellation signal')
    assert.equal(resolution.reply, reply, 'Chat workflow assistant resolution preserves the workflow reply identity')
    assert.equal(resolution.handled, true, 'Chat workflow assistant resolution preserves handled replies')
    assert.equal(resolution.patch?.content, 'Completed.', 'handled Chat workflow replies project an assistant-message patch')
    assert.equal(resolution.patch?.durationMs, 500, 'Chat workflow assistant projection preserves startedAt timing')
    assert.equal(resolution.patch?.completedAt, 2000, 'Chat workflow assistant projection records the completion time')
    assert.deepEqual(input, inputBefore, 'Chat workflow assistant resolution does not mutate caller input')

    const skippedReply = {
      handled: false,
      content: 'Direct chat path selected.',
      status: 'skipped',
      traces: [],
    }
    const skipped = await createConversationChatWorkflowAssistantMessageResolver({
      async runWorkflow(received) {
        assert.equal(received, input, 'unhandled Chat workflow resolution preserves input identity')
        return skippedReply
      },
    })(input)
    assert.equal(skipped.reply, skippedReply, 'unhandled Chat workflow resolution preserves the reply identity')
    assert.equal(skipped.handled, false, 'Chat workflow assistant resolution preserves unhandled replies')
    assert.equal(skipped.patch, undefined, 'unhandled Chat workflow replies do not project a patch')

    const failure = new Error('workflow failed')
    await assert.rejects(
      createConversationChatWorkflowAssistantMessageResolver({ async runWorkflow() { throw failure } })(input),
      (error) => error === failure,
      'Chat workflow assistant resolution preserves the injected workflow failure identity',
    )
  } finally {
    Date.now = originalNow
  }

  const targetSource = fs.readFileSync(path.join(root, 'src/modules/conversations/application/conversationChatWorkflowAssistantMessageResolution.ts'), 'utf8')
  for (const forbiddenImport of ['@/services', '@/bootstrap', '@/presentation', "from 'react", "from 'expo", "from 'zustand"]) {
    assert.equal(targetSource.includes(forbiddenImport), false, `Conversations assistant-message resolution excludes ${forbiddenImport}`)
  }
}

function runWorkflowDefinitionCodecChecks() {
  const createInput = {
    id: 'workflow-definition-codec',
    name: 'Workflow definition codec',
    description: 'Exercise strict versioned workflow admission.',
    enabled: false,
    triggerHints: ['codec workflow'],
    steps: [{
      id: 'collect-evidence',
      title: 'Collect evidence',
      toolRequest: {
        toolId: 'rag:context_pack',
        name: 'rag.context_pack',
        source: 'rag',
        arguments: { profile: 'balanced', nested: { query: 'codec' } },
      },
      acceptance: ['citation evidence present'],
    }],
    permissionCeiling: 'read-only',
    expectedOutput: 'rag-evidence',
    acceptanceChecks: ['visible review'],
    now: 1935000000000,
  }
  const current = workflowDefinitionPolicy.create(createInput)
  assert.equal(current.schema, 'islemind.workflow.v2', 'new workflow definitions use the current neutral schema')
  assert.equal(Object.isFrozen(current), true, 'created workflow definitions are frozen')
  assert.equal(Object.isFrozen(current.steps), true, 'created workflow step collections are frozen')
  assert.equal(Object.isFrozen(current.steps[0].toolRequest.arguments.nested), true, 'created workflow arguments are deeply frozen')
  createInput.steps[0].toolRequest.arguments.nested.query = 'mutated after create'
  assert.equal(current.steps[0].toolRequest.arguments.nested.query, 'codec', 'workflow creation detaches nested caller arguments')

  const legacy = structuredClone(current)
  legacy.schema = 'islemind.agent.workflow.v1'
  const legacyBefore = JSON.stringify(legacy)
  const decodedLegacy = workflowDefinitionPolicy.decode(legacy)
  assert.equal(decodedLegacy.ok, true, 'exact legacy workflow definitions remain readable')
  assert.equal(decodedLegacy.sourceSchema, 'islemind.agent.workflow.v1', 'legacy decode reports its source schema')
  assert.equal(decodedLegacy.requiresRewrite, true, 'legacy decode reports that a v2 rewrite is required')
  assert.equal(decodedLegacy.definition.schema, 'islemind.workflow.v2', 'legacy workflow definitions normalize to canonical v2')
  assert.equal(decodedLegacy.definition.enabled, false, 'legacy decode preserves exact false booleans')
  assert.equal(JSON.stringify(legacy), legacyBefore, 'legacy workflow decoding does not mutate input')
  assert.equal(Object.isFrozen(decodedLegacy.definition.steps[0].toolRequest.arguments), true, 'decoded workflow arguments are deeply frozen')

  const decodedCurrent = workflowDefinitionPolicy.decode(current)
  assert.equal(decodedCurrent.ok, true, 'current workflow definitions decode successfully')
  assert.equal(decodedCurrent.sourceSchema, 'islemind.workflow.v2', 'current decode reports the v2 source schema')
  assert.equal(decodedCurrent.requiresRewrite, false, 'current workflow definitions do not require a schema rewrite')
  assert.ok(workflowDefinitionPolicy.serialize(decodedLegacy.definition).includes('"schema": "islemind.workflow.v2"'), 'workflow serialization writes v2 after a legacy read')

  const malformedInputs = [
    { label: 'unknown schema', value: { ...structuredClone(current), schema: 'islemind.workflow.v999' } },
    { label: 'truthy string enabled', value: { ...structuredClone(current), enabled: 'false' } },
    { label: 'numeric enabled', value: { ...structuredClone(current), enabled: 0 } },
    { label: 'missing enabled', value: (() => { const value = structuredClone(current); delete value.enabled; return value })() },
    { label: 'non-array trigger hints', value: { ...structuredClone(current), triggerHints: 'codec' } },
    { label: 'non-array steps', value: { ...structuredClone(current), steps: {} } },
    { label: 'non-array acceptance checks', value: { ...structuredClone(current), acceptanceChecks: null } },
    { label: 'invalid permission enum', value: { ...structuredClone(current), permissionCeiling: 'owner' } },
    { label: 'invalid output enum', value: { ...structuredClone(current), expectedOutput: 'binary' } },
    { label: 'negative timestamp', value: { ...structuredClone(current), updatedAt: -1 } },
  ]
  const malformedAcceptance = structuredClone(current)
  malformedAcceptance.steps[0].acceptance = 'accepted'
  malformedInputs.push({ label: 'non-array step acceptance', value: malformedAcceptance })
  const malformedSource = structuredClone(current)
  malformedSource.steps[0].toolRequest.source = 'terminal'
  malformedInputs.push({ label: 'invalid tool source enum', value: malformedSource })
  const unsupportedArgument = structuredClone(current)
  unsupportedArgument.steps[0].toolRequest.arguments.callback = () => undefined
  malformedInputs.push({ label: 'non-JSON argument value', value: unsupportedArgument })
  const dangerousArgument = structuredClone(current)
  dangerousArgument.steps[0].toolRequest.arguments = JSON.parse('{"__proto__":{"polluted":"yes"}}')
  malformedInputs.push({ label: 'prototype argument key', value: dangerousArgument })
  const cyclicArgument = structuredClone(current)
  cyclicArgument.steps[0].toolRequest.arguments = {}
  cyclicArgument.steps[0].toolRequest.arguments.self = cyclicArgument.steps[0].toolRequest.arguments
  malformedInputs.push({ label: 'cyclic arguments', value: cyclicArgument })

  for (const fixture of malformedInputs) {
    let decoded
    assert.doesNotThrow(() => { decoded = workflowDefinitionPolicy.decode(fixture.value) }, `${fixture.label} decode never throws`)
    assert.equal(decoded.ok, false, `${fixture.label} fails closed`)
  }

  const hostileGetter = { ...structuredClone(current) }
  Object.defineProperty(hostileGetter, 'id', {
    enumerable: true,
    get() {
      throw new Error('hostile id getter')
    },
  })
  assert.doesNotThrow(() => workflowDefinitionPolicy.decode(hostileGetter), 'hostile workflow accessors never escape the decoder')
  assert.equal(workflowDefinitionPolicy.decode(hostileGetter).ok, false, 'hostile workflow accessors fail closed')

  const hostileProxy = structuredClone(current)
  hostileProxy.steps[0].toolRequest.arguments = new Proxy({}, {
    ownKeys() {
      throw new Error('hostile arguments proxy')
    },
  })
  assert.doesNotThrow(() => workflowDefinitionPolicy.decode(hostileProxy), 'hostile argument proxies never escape the decoder')
  assert.equal(workflowDefinitionPolicy.decode(hostileProxy).ok, false, 'hostile argument proxies fail closed')

  const unknownValidation = workflowDefinitionPolicy.validate(
    { ...structuredClone(current), schema: 'islemind.workflow.unknown' },
    [],
  )
  assert.equal(unknownValidation.ok, false, 'validation rejects unknown schemas before normalization')
}

function runAgentWorkflowSkillSuggestionSelectorChecks() {
  const manifests = [{
    id: 'rag:context_pack',
    source: 'rag',
    name: 'rag.context_pack',
    description: 'Build a cited context pack.',
    permission: 'read-only',
    enabled: true,
  }]
  const createSuggestion = (id, name, now) => {
    const workflow = workflowDefinitionPolicy.create({
      id,
      name,
      description: `${name} description`,
      enabled: true,
      triggerHints: [name.toLowerCase()],
      steps: [{
        id: `${id}-step`,
        title: 'Collect evidence',
        toolRequest: {
          toolId: 'rag:context_pack',
          name: 'rag.context_pack',
          source: 'rag',
          arguments: { profile: 'balanced' },
        },
        acceptance: ['cited evidence present'],
      }],
      permissionCeiling: 'read-only',
      expectedOutput: 'rag-evidence',
      acceptanceChecks: ['visible evidence'],
      now,
    })
    return createWorkflowSkillSuggestion({ workflow, manifests, now: now + 1 })
  }
  const olderSuggestion = createSuggestion('workflow-older', 'Older workflow', 1940000000000)
  const newerSuggestion = createSuggestion('workflow-newer', 'Newer workflow', 1940000001000)
  const hiddenSuggestion = createSuggestion('workflow-hidden', 'Hidden workflow', 1940000002000)
  const message = {
    reasoning: [{
      type: 'reasoning',
      title: 'Agent workflow',
      status: 'done',
      completedAt: 10,
      metadata: { workflowSkillSuggestion: olderSuggestion },
    }],
    retrievalTrace: [{
      type: 'system',
      title: 'Agent workflow skill',
      status: 'done',
      completedAt: 40,
      metadata: { hiddenSignature: true, workflowSkillSuggestion: hiddenSuggestion },
    }],
    toolCalls: [
      {
        type: 'system',
        title: 'Agent synthesis',
        status: 'done',
        completedAt: 30,
        metadata: { workflowSkillSuggestion: newerSuggestion },
      },
      {
        type: 'system',
        title: 'Unrelated activity',
        status: 'done',
        completedAt: 50,
        metadata: { workflowSkillSuggestion: hiddenSuggestion },
      },
    ],
  }
  const originalMessage = structuredClone(message)
  const selected = getWorkflowSkillSuggestionFromMessage(message)
  assert.equal(selected?.workflow.id, 'workflow-newer', 'workflow-suggestion selection merges trace buckets by timestamp and chooses the newest admitted trace')
  assert.equal(selected?.ok, true, 'a valid workflow suggestion remains actionable')
  assert.ok(selected?.skill, 'a valid workflow suggestion retains its reviewable skill payload')
  assert.deepEqual(message, originalMessage, 'workflow-suggestion selection does not mutate traces or nested suggestion payloads')
  assert.notEqual(selected?.workflow, newerSuggestion.workflow, 'workflow-suggestion selection detaches the visible workflow from trace metadata')
  const serializedMessage = JSON.parse(JSON.stringify(message))
  const selectedAfterRoundTrip = getWorkflowSkillSuggestionFromMessage(serializedMessage)
  assert.deepEqual(selectedAfterRoundTrip, selected, 'workflow-suggestion selection survives a persisted JSON round trip without changing the public contract')

  const legacySuggestion = structuredClone(newerSuggestion)
  legacySuggestion.workflow.schema = 'islemind.agent.workflow.v1'
  legacySuggestion.validation.definition.schema = 'islemind.agent.workflow.v1'
  legacySuggestion.skill.systemPrompt = legacySuggestion.skill.systemPrompt.replace(
    'islemind.workflow.v2',
    'islemind.agent.workflow.v1',
  )
  const selectedLegacy = getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'reasoning',
      title: 'Agent workflow',
      status: 'done',
      metadata: { workflowSkillSuggestion: legacySuggestion },
    }],
  })
  assert.equal(selectedLegacy?.ok, true, 'valid legacy workflow suggestions remain actionable after strict decoding')
  assert.equal(selectedLegacy?.workflow.schema, 'islemind.workflow.v2', 'legacy workflow suggestions project a canonical v2 workflow')
  assert.ok(selectedLegacy?.skill?.systemPrompt.includes('islemind.workflow.v2'), 'legacy workflow suggestions rebuild a v2-only skill prompt')
  assert.equal(selectedLegacy?.skill?.systemPrompt.includes('islemind.agent.workflow.v1'), false, 'legacy workflow suggestions do not re-emit the v1 schema')

  const rejectedSuggestionFixtures = [
    {
      label: 'unknown workflow schema',
      mutate(value) {
        value.workflow.schema = 'islemind.workflow.v999'
      },
    },
    {
      label: 'string workflow enabled value',
      mutate(value) {
        value.workflow.enabled = 'false'
      },
    },
    {
      label: 'malformed workflow trigger hints',
      mutate(value) {
        value.workflow.triggerHints = 'not-an-array'
      },
    },
    {
      label: 'malformed workflow step acceptance',
      mutate(value) {
        value.workflow.steps[0].acceptance = { accepted: true }
      },
    },
  ]
  for (const fixture of rejectedSuggestionFixtures) {
    const malformed = structuredClone(newerSuggestion)
    fixture.mutate(malformed)
    let projected
    assert.doesNotThrow(() => {
      projected = getWorkflowSkillSuggestionFromMessage({
        reasoning: [{
          type: 'reasoning',
          title: 'Agent workflow skill',
          status: 'done',
          metadata: { workflowSkillSuggestion: malformed },
        }],
      })
    }, `${fixture.label} never escapes the presentation decoder`)
    assert.equal(projected?.ok, false, `${fixture.label} is not actionable`)
    assert.equal(projected?.skill, undefined, `${fixture.label} cannot expose a saveable skill`)
  }

  const cyclicSuggestion = structuredClone(newerSuggestion)
  cyclicSuggestion.workflow.steps[0].toolRequest.arguments.self = cyclicSuggestion.workflow.steps[0].toolRequest.arguments
  let rejectedCyclic
  assert.doesNotThrow(() => {
    rejectedCyclic = getWorkflowSkillSuggestionFromMessage({
      reasoning: [{
        type: 'reasoning',
        title: 'Agent synthesis',
        status: 'done',
        metadata: { workflowSkillSuggestion: cyclicSuggestion },
      }],
    })
  }, 'cyclic workflow suggestion arguments never escape the presentation decoder')
  assert.equal(rejectedCyclic?.ok, false, 'cyclic workflow suggestion arguments fail closed')
  assert.equal(rejectedCyclic?.skill, undefined, 'cyclic workflow suggestion arguments cannot expose a saveable skill')

  assert.equal(getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'reasoning',
      title: 'Agent workflow',
      status: 'done',
      metadata: { hiddenSignature: true, workflowSkillSuggestion: newerSuggestion },
    }],
  }), undefined, 'hidden workflow-suggestion traces remain invisible')
  assert.equal(getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'reasoning',
      title: 'Unrelated activity',
      status: 'done',
      metadata: { workflowSkillSuggestion: newerSuggestion },
    }],
  }), undefined, 'non-workflow trace titles cannot expose suggestions')
  assert.equal(getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'reasoning',
      title: 'Agent workflow',
      status: 'done',
      metadata: { workflowSkillSuggestion: { ...newerSuggestion, requiresUserApproval: false } },
    }],
  }), undefined, 'workflow suggestions without explicit approval metadata fail strict admission')

  const mismatchedSkill = structuredClone(newerSuggestion)
  mismatchedSkill.skill.id = 'skill-forged'
  const rejectedMismatch = getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'reasoning',
      title: 'Agent workflow',
      status: 'done',
      metadata: { workflowSkillSuggestion: mismatchedSkill },
    }],
  })
  assert.equal(rejectedMismatch?.ok, false, 'workflow and skill identity mismatch fails closed')
  assert.equal(rejectedMismatch?.skill, undefined, 'identity-mismatched skill payload is not exposed')

  const unsafeSuggestion = structuredClone(newerSuggestion)
  unsafeSuggestion.workflow.steps[0].toolRequest.arguments = { command: 'powershell -Command Remove-Item -Recurse' }
  const rejectedUnsafe = getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'system',
      title: 'Agent workflow skill',
      status: 'done',
      metadata: { workflowSkillSuggestion: unsafeSuggestion },
    }],
  })
  assert.equal(rejectedUnsafe?.ok, false, 'arbitrary-execution workflow suggestions fail closed')
  assert.ok(rejectedUnsafe?.validation.errors.some((item) => item.includes('arbitrary execution risk')), 'unsafe workflow rejection remains reviewable')

  const boundedSuggestion = structuredClone(newerSuggestion)
  boundedSuggestion.workflow.description = `sk-test-secret ${'x'.repeat(6000)}`
  boundedSuggestion.workflow.steps = Array.from({ length: 25 }, (_, index) => ({
    ...structuredClone(newerSuggestion.workflow.steps[0]),
    id: `bounded-step-${index + 1}`,
    title: `Bounded step ${index + 1}`,
  }))
  const bounded = getWorkflowSkillSuggestionFromMessage({
    reasoning: [{
      type: 'reasoning',
      title: 'Agent synthesis',
      status: 'done',
      metadata: { workflowSkillSuggestion: boundedSuggestion },
    }],
  })
  assert.equal(bounded?.workflow.steps.length, 20, 'visible workflow suggestions enforce the step bound')
  assert.ok((bounded?.approvalSummary.length ?? 0) <= 2000, 'visible workflow approval summaries enforce the text bound')
  assert.equal(bounded?.approvalSummary.includes('sk-test-secret'), false, 'visible workflow approval summaries redact sensitive text')

  const selectorSource = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/workflowSkillSuggestionSelector.ts'), 'utf8')
  assert.equal(selectorSource.includes('@/bootstrap'), false, 'presentation workflow-suggestion selection does not import concrete bootstrap composition')
  assert.ok(selectorSource.includes('createWorkflowSkillFormattingPolicy'), 'presentation workflow-suggestion selection uses the pure Tasks formatter')
  assert.equal(selectorSource.includes('createWorkflowSkillPolicy'), false, 'presentation workflow-suggestion selection does not compose the persistence-capable workflow-skill policy')
  assert.equal(selectorSource.includes('listSkills:'), false, 'presentation workflow-suggestion selection does not install a fake skill repository')
  assert.equal(selectorSource.includes('upsertSkill:'), false, 'presentation workflow-suggestion selection does not install a fake skill writer')
  assert.equal(selectorSource.includes('resolveUniqueManifest:'), false, 'presentation workflow-suggestion selection does not install a fake manifest resolver')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentMessageAdapter.ts')), false, 'workflow-suggestion selection cannot restore the retired Agent message adapter')
  for (const relativePath of [
    'src/components/chat/workflowPresentation.ts',
    'src/components/chat/MessageBubble.tsx',
    'src/presentation/features/conversations/conversationMessageActionCommand.ts',
  ]) {
    const consumerSource = fs.readFileSync(path.join(root, relativePath), 'utf8')
    assert.ok(consumerSource.includes('@/presentation/features/conversations/workflowSkillSuggestionSelector'), `${relativePath} consumes the presentation workflow-suggestion selector`)
    assert.equal(consumerSource.includes("from '@/services/agent/agentMessageAdapter'"), false, `${relativePath} does not import the retired service selector`)
  }
}

async function runApprovedWorkflowSkillVisibilityChecks() {
  resetAgentWorkflowSkillStore()
  const manifests = [{
    id: 'rag:context_pack',
    source: 'rag',
    name: 'rag.context_pack',
    description: 'Build a cited context pack for a visible agent workflow.',
    permission: 'read-only',
    enabled: true,
  }]
  const workflow = workflowDefinitionPolicy.create({
    id: 'agent-workflow-visible-approval',
    name: 'Visible approval workflow',
    description: 'Reusable workflow saved only after a visible local approval.',
    enabled: true,
    triggerHints: ['visible approval workflow'],
    steps: [{
      id: 'collect-evidence',
      title: 'Collect source evidence',
      toolRequest: {
        toolId: 'rag:context_pack',
        name: 'rag.context_pack',
        source: 'rag',
        arguments: {
          profile: 'balanced',
          profileReason: 'validate saved workflow evidence',
        },
      },
      acceptance: ['citation evidence present'],
    }],
    permissionCeiling: 'read-only',
    expectedOutput: 'rag-evidence',
    acceptanceChecks: ['visible user approval before saving'],
    now: 1930000000000,
  })
  const workflowSnapshot = JSON.stringify(workflow)
  const suggestion = createWorkflowSkillSuggestion({
    workflow,
    manifests,
    priority: 51,
    now: 1930000001000,
  })
  assert.equal(suggestion.ok, true, 'workflow skill suggestion validates before approval')
  assert.equal(JSON.stringify(workflow), workflowSnapshot, 'workflow skill suggestion does not mutate its workflow input')
  assert.equal(suggestion.requiresUserApproval, true, 'workflow skill suggestion always requires visible approval')
  assert.ok(suggestion.skill, 'workflow skill suggestion includes a reviewable skill payload')
  assert.equal(isWorkflowSkillReviewRequired(suggestion.skill), true, 'reviewable workflow skill is not locally approved yet')
  assert.equal(isWorkflowSkillEnabled(suggestion.skill), false, 'unapproved workflow skill is hidden from runtime selection')

  const preview = buildWorkflowSkillSavePreview(suggestion)
  assert.equal(preview.workflowId, workflow.id, 'approval preview identifies the reviewed workflow')
  assert.equal(preview.enabled, true, 'approval preview reports the requested enabled state')
  assert.equal(preview.permissionCeiling, 'read-only', 'approval preview reports the permission ceiling')
  assert.equal(preview.stepCount, 1, 'approval preview reports bounded steps')
  assert.ok(preview.requiredTools.includes('rag:context_pack'), 'approval preview exposes required tool identities')
  assert.ok(preview.ragProfileRequirements.some((item) => item.includes('balanced')), 'approval preview exposes RAG profile requirements')

  const blockedSave = await saveApprovedWorkflowSkillSuggestion({
    suggestion,
    now: 1930000002000,
  })
  assert.equal(blockedSave.ok, false, 'saveApprovedWorkflowSkillSuggestion requires visible approval before persistence')
  assert.equal(blockedSave.reason, 'approval_required', 'unapproved workflow saves fail closed')
  assert.equal(inMemorySkillStore.length, 0, 'unapproved workflow skill is not persisted')

  const saved = await saveApprovedWorkflowSkillSuggestion({
    suggestion,
    approval: {
      approved: true,
      approvedBy: 'settings-visible-test',
      approvedAt: 1930000003000,
      visibleSummary: preview.approvalSummary,
    },
    now: 1930000004000,
  })
  assert.equal(saved.ok, true, 'approved workflow skill can be saved')
  assert.equal(saved.status, 'saved', 'approved workflow skill save records a saved status')
  assert.ok(saved.skill.tags.includes('approval:user-visible'), 'approved workflow skill records visible approval')
  assert.ok(saved.skill.systemPrompt.includes('islemind.workflow.v2'), 'approved workflow skill writes the current workflow schema marker')
  assert.equal(saved.skill.expectedReplyFormat, 'agent-workflow-output:rag-evidence', 'approved workflow skill preserves the versioned output marker')
  assert.equal(getWorkflowSkillState(saved.skill), 'enabled', 'approved workflow skill preserves reviewed enabled state')
  assert.equal(isWorkflowSkillEnabled(saved.skill), true, 'approved workflow skill becomes runtime-selectable')
  assert.equal(isSkillSelectableWithWorkflowSkillState(saved.skill), true, 'approved workflow skill is selectable through the Chat-neutral state policy')
  assert.equal(isSkillSelectableWithWorkflowSkillState({ tags: ['ordinary-skill'] }), true, 'ordinary skills remain selectable')

  const nonWorkflowState = await saveApprovedWorkflowSkillState({
    skill: { ...saved.skill, tags: ['ordinary-skill'] },
    state: 'enabled',
    approval: { approved: true, approvedAt: 1930000004050 },
  })
  assert.equal(nonWorkflowState.ok, false, 'ordinary skills cannot enter the workflow lifecycle')
  assert.equal(nonWorkflowState.reason, 'not_agent_workflow', 'ordinary-skill lifecycle rejection preserves the stable compatibility reason')

  const savedSkillSnapshot = JSON.stringify(saved.skill)
  const blockedDisable = await saveApprovedWorkflowSkillState({
    skill: saved.skill,
    state: 'disabled',
    now: 1930000004100,
  })
  assert.equal(blockedDisable.ok, false, 'workflow state changes require visible approval')
  assert.equal(blockedDisable.reason, 'approval_required', 'unapproved workflow state changes fail closed')
  assert.equal(JSON.stringify(saved.skill), savedSkillSnapshot, 'blocked workflow state changes do not mutate their input')
  assert.equal(getWorkflowSkillState(inMemorySkillStore[0]), 'enabled', 'blocked workflow state changes do not persist')

  const disabled = await saveApprovedWorkflowSkillState({
    skill: saved.skill,
    state: 'disabled',
    manifests,
    approval: {
      approved: true,
      approvedBy: 'settings-visible-test',
      approvedAt: 1930000004200,
      visibleSummary: `disabled:${saved.skill.name}`,
    },
    now: 1930000004300,
  })
  assert.equal(disabled.ok, true, 'approved workflow skill can be disabled')
  assert.equal(JSON.stringify(saved.skill), savedSkillSnapshot, 'successful workflow disable does not mutate its input')
  assert.equal(getWorkflowSkillState(disabled.skill), 'disabled', 'approved disable persists the disabled state')
  assert.equal(isSkillSelectableWithWorkflowSkillState(disabled.skill), false, 'disabled workflow skill is excluded from selection')
  assert.ok(disabled.skill.tags.includes('agent-workflow'), 'state changes preserve the persisted workflow marker')
  assert.ok(disabled.skill.tags.includes(`workflow:${workflow.id}`), 'state changes preserve the persisted workflow identity')
  assert.ok(disabled.skill.tags.includes('approval:user-visible'), 'state changes preserve visible approval')
  assert.deepEqual(await listWorkflowSkills(), [], 'disabled workflow skills are omitted from the default lifecycle list')
  assert.equal((await listWorkflowSkills({ includeDisabled: true }))[0]?.id, saved.skill.id, 'disabled workflow skills remain available for visible lifecycle management')

  const disabledSkillSnapshot = JSON.stringify(disabled.skill)
  const invalidEnable = await saveApprovedWorkflowSkillState({
    skill: disabled.skill,
    state: 'enabled',
    manifests: [],
    approval: { approved: true, approvedAt: 1930000004400 },
    now: 1930000004500,
  })
  assert.equal(invalidEnable.ok, false, 'workflow enable fails closed when current tool manifests cannot validate it')
  assert.equal(invalidEnable.reason, 'invalid_workflow', 'invalid workflow enable reports the stable reason')
  assert.equal(JSON.stringify(disabled.skill), disabledSkillSnapshot, 'invalid workflow enable does not mutate its input')
  assert.equal(getWorkflowSkillState(inMemorySkillStore[0]), 'disabled', 'invalid workflow enable does not persist')

  const reenabled = await saveApprovedWorkflowSkillState({
    skill: disabled.skill,
    state: 'enabled',
    manifests,
    approval: {
      approved: true,
      approvedBy: 'settings-visible-test',
      approvedAt: 1930000004600,
      visibleSummary: `enabled:${saved.skill.name}`,
    },
    now: 1930000004700,
  })
  assert.equal(reenabled.ok, true, 'reviewed workflow skill can be re-enabled with valid manifests')
  assert.equal(JSON.stringify(disabled.skill), disabledSkillSnapshot, 'successful workflow re-enable does not mutate its input')
  assert.equal(getWorkflowSkillState(reenabled.skill), 'enabled', 'reviewed workflow enable persists the enabled state')
  assert.equal(isWorkflowSkillReviewRequired(reenabled.skill), false, 'reviewed workflow enable clears import review state')
  assert.equal(isWorkflowSkillEnabled(reenabled.skill), true, 'reviewed workflow enable restores runtime selection')

  for (const removedName of [
    'getAgentWorkflowSkillState',
    'isAgentWorkflowSkill',
    'isAgentWorkflowSkillEnabled',
    'isAgentWorkflowSkillReviewRequired',
    'saveApprovedAgentWorkflowSkillState',
  ]) {
    assert.equal(workflowSkillApi[removedName], undefined, `${removedName} remains deleted from the Tasks workflow-skill lifecycle API`)
  }
  assert.equal(
    workflowSkillApi.buildWorkflowSkillStateUpdate,
    undefined,
    'the workflow-skill state update helper remains private to the Tasks policy',
  )

  const repeatedSave = await saveApprovedWorkflowSkillSuggestion({
    suggestion,
    approval: {
      approved: true,
      approvedBy: 'settings-visible-test',
      approvedAt: 1930000003000,
      visibleSummary: preview.approvalSummary,
    },
    now: 1930000005000,
  })
  assert.equal(repeatedSave.ok, true, 'repeated approved workflow save remains successful')
  assert.equal(repeatedSave.status, 'already_saved', 'repeated approved workflow save is idempotent')
  assert.equal(inMemorySkillStore.length, 1, 'idempotent workflow save does not duplicate persistence')

  const enabledWorkflowIds = await listEnabledWorkflowIdsForSkillSnapshot({
    skillIds: [saved.skill.id],
    names: [saved.skill.name],
    systemPrompt: saved.skill.systemPrompt,
    variables: {},
  })
  assert.deepEqual(enabledWorkflowIds, [workflow.id], 'approved workflow skill becomes selectable through listEnabledWorkflowIdsForSkillSnapshot')
  assert.deepEqual(
    await listBlockedWorkflowStatesForSkillSnapshot({
      skillIds: [saved.skill.id],
      names: [saved.skill.name],
      systemPrompt: saved.skill.systemPrompt,
      variables: {},
    }, []),
    [{ workflowId: workflow.id, reason: 'workflow-invalid' }],
    'empty tool manifest catalog marks an enabled selected workflow invalid',
  )

  const selected = selectWorkflowDefinitionFromSkillSnapshot(
    {
      skillIds: [saved.skill.id],
      names: [saved.skill.name],
      systemPrompt: saved.skill.systemPrompt,
      variables: {},
    },
    'please run the visible approval workflow',
    manifests,
    { enabledWorkflowIds }
  )
  assert.equal(selected?.workflow.id, workflow.id, 'approved workflow skill can be selected by visible trigger text')
  assert.equal(selected?.reason, 'single-selected', 'single approved workflow selects without ambiguity')

  const legacySystemPrompt = saved.skill.systemPrompt.replace(
    'islemind.workflow.v2',
    'islemind.agent.workflow.v1',
  )
  const selectedLegacy = selectWorkflowDefinitionFromSkillSnapshot(
    {
      skillIds: [saved.skill.id],
      names: [saved.skill.name],
      systemPrompt: legacySystemPrompt,
      variables: {},
    },
    'please run the visible approval workflow',
    manifests,
    { enabledWorkflowIds },
  )
  assert.equal(selectedLegacy?.workflow.id, workflow.id, 'persisted legacy workflow skills remain readable')
  assert.equal(selectedLegacy?.workflow.schema, 'islemind.workflow.v2', 'persisted legacy workflow skills normalize to v2 before selection')

  const mergedTags = mergeWorkflowSkillEditTags(saved.skill, [
    'user-review-tag',
    'workflow:forged',
    'workflow-status:enabled',
    'approval:user-visible',
    'approved-by:attacker',
  ])
  assert.ok(mergedTags.includes('user-review-tag'), 'user-editable workflow skill tags are preserved')
  assert.ok(mergedTags.includes(`workflow:${workflow.id}`), 'workflow control tag remains bound to the reviewed workflow')
  assert.equal(mergedTags.includes('workflow:forged'), false, 'forged workflow control tags are ignored')
  assert.equal(mergedTags.includes('approved-by:attacker'), false, 'forged approval control tags are ignored')

  const edited = buildWorkflowSkillReviewRequiredEdit(saved.skill, {
    ...saved.skill,
    systemPrompt: `${saved.skill.systemPrompt}\nReview-local edit.`,
  })
  assert.equal(extractWorkflowIdFromSkill(edited), workflow.id, 'review-required edit preserves workflow identity')
  assert.equal(getWorkflowSkillState(edited), 'disabled', 'buildWorkflowSkillReviewRequiredEdit disables edited workflow skills for review')
  assert.equal(isWorkflowSkillReviewRequired(edited), true, 'edited workflow skill requires local review before reuse')
  assert.equal(isWorkflowSkillEnabled(edited), false, 'edited workflow skill is hidden until review approval')

  resetAgentWorkflowSkillStore()
  inMemorySkillStore.push({
    ...saved.skill,
    tags: ['ordinary-skill'],
  })
  const conflict = await saveApprovedWorkflowSkillSuggestion({
    suggestion,
    approval: { approved: true, approvedAt: 1930000006000 },
    now: 1930000007000,
  })
  assert.equal(conflict.ok, false, 'workflow save fails closed on an existing non-workflow skill id')
  assert.equal(conflict.reason, 'skill_id_conflict', 'workflow save reports the stable id-conflict reason')
}

async function run() {
  assert.equal(typeof createWorkflowSkillFormattingPolicy, 'function', 'Tasks public API exposes the pure workflow-skill formatting policy')
  assert.equal(typeof createWorkflowSkillPolicy, 'function', 'Tasks public API exposes the workflow-skill policy factory')
  assert.equal(fs.existsSync(path.join(root, 'src/services/agent/agentWorkflowSkills.ts')), false, 'retired workflow-skill service facade must stay deleted')
  assert.ok(requiredAgentToolPolicyCases.includes('native provider tool per-step limit test'), 'agent tool policy covers provider-native tool limits')
  assert.ok(requiredAgentToolPolicyCases.includes('Android undo prompt must ignore arbitrary message body JSON'), 'agent tool policy covers Android undo source safety')
  assert.ok(requiredAgentToolPolicyCases.includes('saveApprovedWorkflowSkillSuggestion requires visible approval before persistence'), 'agent tool policy covers visible workflow skill approval')
  assert.ok(requiredAgentToolPolicyCases.includes('approved workflow skill becomes selectable through listEnabledWorkflowIdsForSkillSnapshot'), 'agent tool policy covers workflow skill runtime visibility')
  assert.ok(requiredAgentToolPolicyCases.includes('buildWorkflowSkillReviewRequiredEdit disables edited workflow skills for review'), 'agent tool policy covers edited workflow review gating')
  runWorkflowRunLimitPolicyChecks()
  runWorkflowDefinitionCodecChecks()
  runWorkflowSearchToolAdmissionChecks()
  runWorkflowMessageActionPolicyChecks()
  await runConversationChatWorkflowAssistantMessageResolutionChecks()
  runAgentWorkflowSkillSuggestionSelectorChecks()
  runWorkflowToolPermissionProjectionChecks()
  await runApprovedWorkflowSkillVisibilityChecks()
  runArchitectureContractSmoke({
    label: 'Agent tool policy',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  console.log('Agent tool policy tests passed')
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { run, requiredAgentToolPolicyCases }
