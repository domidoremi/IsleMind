const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
registerTypeScriptSupport()
const tasksPublicEntryPath = path.join(root, 'src', 'modules', 'tasks', 'index.ts')
const tasksPublicEntrySource = fs.readFileSync(tasksPublicEntryPath, 'utf8')
const {
  ANDROID_ALARM_WORKFLOW_ID,
  ANDROID_APK_INSTALL_WORKFLOW_ID,
  ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID,
  ANDROID_CALENDAR_TODO_WORKFLOW_ID,
  ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID,
  ANDROID_FILE_COPY_RENAME_WORKFLOW_ID,
  ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID,
  createAndroidWorkflowCatalog,
  createWorkflowDefinitionPolicy,
  createWorkflowIntentClassifier,
  createWorkflowPlanner,
} = require('../src/modules/tasks/index.ts')
const workflowSourcePath = path.join(root, 'src', 'modules', 'tasks', 'application', 'androidWorkflowCatalog.ts')
const retiredWorkflowSourcePath = path.join(root, 'src', 'modules', 'tasks', 'application', 'agentAndroidWorkflowCatalog.ts')
const legacyWorkflowSourcePath = path.join(root, 'src', 'services', 'agent', 'agentAndroidWorkflows.ts')
const workflowSourceText = fs.readFileSync(workflowSourcePath, 'utf8')
const classifierSourcePath = path.join(root, 'src', 'modules', 'tasks', 'application', 'workflowIntentClassifier.ts')
const classifierSourceText = fs.readFileSync(classifierSourcePath, 'utf8')

const requiredWorkflowIds = [
  ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID,
  ANDROID_FILE_COPY_RENAME_WORKFLOW_ID,
  ANDROID_APK_INSTALL_WORKFLOW_ID,
  ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID,
  ANDROID_ALARM_WORKFLOW_ID,
  ANDROID_CALENDAR_TODO_WORKFLOW_ID,
  ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID,
]

const requiredWorkflowChecks = new Map([
  [ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID, {
    expectedOutput: 'reply',
    snippets: [
      'uses Android SAF directory access',
      'applies only visible confirmed operations',
      'refuses delete operations',
    ],
  }],
  [ANDROID_FILE_COPY_RENAME_WORKFLOW_ID, {
    expectedOutput: 'reply',
    snippets: [
      'previews copy or rename operation before write',
      'delete operations remain unsupported',
      'records Android operation audit',
    ],
  }],
  [ANDROID_APK_INSTALL_WORKFLOW_ID, {
    expectedOutput: 'handoff',
    snippets: [
      'opens Android system package installer',
      'requires system installer confirmation',
      'silent install remains unsupported',
    ],
  }],
  [ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID, {
    expectedOutput: 'reply',
    snippets: [
      'limits deletion to IsleMind app cache',
      'does not delete user files',
      'records Android operation audit',
    ],
  }],
  [ANDROID_ALARM_WORKFLOW_ID, {
    expectedOutput: 'reply',
    snippets: [
      'requests Android system clock alarm creation',
      'uses visible system clock confirmation only when direct creation is unsupported',
      'does not request exact alarm permission',
    ],
  }],
  [ANDROID_CALENDAR_TODO_WORKFLOW_ID, {
    expectedOutput: 'handoff',
    snippets: [
      'opens Android system calendar UI',
      'requires system calendar confirmation',
      'does not request calendar write permission',
    ],
  }],
  [ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID, {
    expectedOutput: 'handoff',
    snippets: [
      'opens Android app notification settings',
      'can target promoted notification settings when supported',
      'does not claim reliable background reply delivery',
    ],
  }],
])

const DEFAULT_ANDROID_WORKFLOW_CONTRACT_SHA256 = '44decf37554484a3b6422b1ff45114d1f94d697d84c5992a08f979e4aed63a6a'

function run() {
  const { catalog } = createTestAndroidWorkflowCatalog()
  const workflows = catalog.list({ now: 0 })
  assertAndroidWorkflowCatalogOwnership(workflows)

  for (const workflow of workflows) {
    const workflowId = workflow.id
    const expected = requiredWorkflowChecks.get(workflowId)
    assert.ok(expected, `Missing workflow audit expectations for ${workflowId}.`)
    assert.equal(workflow.expectedOutput, expected.expectedOutput, `Workflow ${workflowId} must keep expectedOutput=${expected.expectedOutput}.`)
    assert.equal(workflow.permissionCeiling, 'read-write', `Workflow ${workflowId} must keep permissionCeiling=read-write.`)
    for (const snippet of expected.snippets) {
      assert.ok(workflow.acceptanceChecks.includes(snippet), `Workflow ${workflowId} acceptanceChecks must include ${snippet}.`)
    }
  }

  assertAndroidWorkflowCatalogInjectionAndSanitization()

  runArchitectureContractSmoke({
    label: 'Android workflow template audit',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })

  assertAndroidWorkflowRuntimeSelection()
  assertReminderTitleRuntimeBindings()

  console.log(`Android workflow template audit passed (${requiredWorkflowIds.length} workflows).`)
}

if (require.main === module) run()

module.exports = {
  requiredWorkflowChecks,
  requiredWorkflowIds,
  run,
}

function assertReminderTitleRuntimeBindings() {
  assert.match(
    tasksPublicEntrySource,
    /export \* from '\.\/application\/workflowPlanner'/,
    'the Android planner fixture is published through the Tasks public entry',
  )
  let inferredTitle = 'Project sync'
  const planner = createWorkflowPlanner({
    clock: { now: () => 100 },
    classifyIntent() {
      throw new Error('The Android template fixture supplies an explicit classification.')
    },
    projectTrace: (trace) => trace,
    redactText: (value) => value.replaceAll('private-value', '[redacted]'),
    formatToolIdentity: (request) => request?.toolId ?? request?.name ?? '',
    collectRagProfileRequirements: () => [],
    inferClockTime: () => undefined,
    inferReminderDateTimeIso: () => '2026-09-04T10:30:00.000Z',
    inferReminderTitle: () => inferredTitle,
    sanitizeApkUri: () => undefined,
  })
  const workflow = {
    id: ANDROID_CALENDAR_TODO_WORKFLOW_ID,
    name: 'Calendar reminder fixture',
    permissionCeiling: 'read-write',
    expectedOutput: 'handoff',
    acceptanceChecks: [],
    steps: [{
      id: 'create-reminder',
      title: 'Create reminder',
      toolRequest: { toolId: 'android:reminder.open_create_todo', source: 'android', arguments: {} },
    }],
  }
  const classification = {
    intent: 'tool_task',
    shouldRunWorkflow: true,
    confidence: 1,
    reasons: ['android-template-fixture'],
    trace: { id: 'classification', type: 'reasoning', title: 'Classify', status: 'done', startedAt: 100 },
  }
  const titled = planner({
    goal: 'Create the project reminder.',
    content: 'Create a reminder titled Project sync.',
    workflowDefinition: workflow,
    classification,
    now: 100,
  })
  assert.deepEqual(titled.steps[0].toolRequest.arguments, {
    title: 'Project sync',
    dueTimeIso: '2026-09-04T10:30:00.000Z',
  }, 'Android reminder planning binds the inferred title and due time')
  assert.deepEqual(workflow.steps[0].toolRequest.arguments, {}, 'runtime binding does not mutate the workflow template')

  inferredTitle = undefined
  const fallback = planner({
    goal: 'private-value follow up next week',
    workflowDefinition: workflow,
    classification,
    now: 101,
  })
  assert.equal(
    fallback.steps[0].toolRequest.arguments.title,
    '[redacted] follow up next week',
    'Android reminder planning uses the redacted runtime goal when no title is inferred',
  )
  const { catalog } = createTestAndroidWorkflowCatalog()
  const calendarTodoWorkflow = catalog.list({ now: 0 })
    .find((item) => item.id === ANDROID_CALENDAR_TODO_WORKFLOW_ID)
  assert.ok(
    calendarTodoWorkflow?.steps.some((step) => (
      step.acceptance?.includes('sets title from user input or runtime goal fallback')
    )),
    'Android calendar workflow template must document the no-title fallback.',
  )
  for (const snippet of ['titled', 'called', 'named', 'with\\s+(?:the\\s+)?title']) {
    assert.ok(classifierSourceText.includes(snippet), `Reminder title inference must handle English "${snippet}" prompts.`)
  }
}

function assertAndroidWorkflowCatalogOwnership(workflows) {
  assert.match(
    tasksPublicEntrySource,
    /export \* from '\.\/application\/androidWorkflowCatalog'/,
    'the Android workflow catalog is published through the Tasks public entry',
  )
  assert.doesNotMatch(
    tasksPublicEntrySource,
    /agentAndroidWorkflowCatalog|AgentAndroidWorkflowCatalog|createAgentAndroidWorkflowCatalog/,
    'the Tasks public entry must not restore the Agent-named Android workflow catalog API',
  )
  assert.ok(fs.existsSync(workflowSourcePath), 'Tasks must own the Android workflow catalog implementation.')
  assert.equal(
    fs.existsSync(retiredWorkflowSourcePath),
    false,
    'the Agent-named Tasks Android workflow catalog path must stay deleted',
  )
  assert.equal(fs.existsSync(legacyWorkflowSourcePath), false, 'the legacy Agent Android workflow service must stay deleted')
  assert.doesNotMatch(
    workflowSourceText,
    /AgentAndroidWorkflowCatalog|createAgentAndroidWorkflowCatalog|agentAndroidWorkflowCatalog/,
    'the Tasks-owned Android workflow catalog must expose only neutral source symbols',
  )
  assert.doesNotMatch(
    workflowSourceText,
    /@\/services\//,
    'the Tasks-owned Android workflow catalog must not depend on legacy services',
  )
  assert.deepEqual(
    workflows.map((workflow) => workflow.id),
    requiredWorkflowIds,
    'the Tasks-owned catalog preserves all seven Android workflow IDs and their order',
  )
  assert.ok(
    workflows.every((workflow) => workflow.schema === 'islemind.workflow.v2'),
    'all seven Tasks-owned Android workflow templates write the current v2 schema',
  )
  const contractSnapshot = workflows.map(({ createdAt, updatedAt, ...workflow }) => workflow)
  assert.equal(
    createHash('sha256').update(JSON.stringify(contractSnapshot)).digest('hex'),
    DEFAULT_ANDROID_WORKFLOW_CONTRACT_SHA256,
    'Android workflow names, descriptions, hints, steps, default arguments, permissions, and acceptance checks stay exact',
  )
}

function assertAndroidWorkflowCatalogInjectionAndSanitization() {
  const fixture = createTestAndroidWorkflowCatalog({ now: 500 })
  const defaultWorkflows = fixture.catalog.list()
  assert.ok(
    defaultWorkflows.every((workflow) => workflow.createdAt === 500 && workflow.updatedAt === 500),
    'the catalog uses its injected workflow-definition clock when no timestamp is supplied',
  )
  assert.equal(fixture.getGeneratedIdCount(), 0, 'fixed Android workflow IDs never consume the injected ID suffix')
  assert.ok(
    requiredWorkflowIds.every((workflowId) => fixture.catalog.isBuiltInWorkflowId(workflowId)),
    'the catalog recognizes every built-in Android workflow ID',
  )
  assert.equal(fixture.catalog.isBuiltInWorkflowId('agent-workflow-other'), false)

  const input = {
    directoryUri: '  content://downloads/root  ',
    apkUri: '  content://downloads/releases/islemind.apk  ',
    sourceName: '  source.txt  ',
    targetDirectoryName: '../outside',
    targetName: '  renamed.txt  ',
    enabled: false,
    now: 777,
  }
  const inputSnapshot = JSON.parse(JSON.stringify(input))
  const customized = fixture.catalog.list(input)
  assert.deepEqual(input, inputSnapshot, 'catalog creation must not mutate caller input')
  assert.ok(customized.every((workflow) => workflow.enabled === false))
  assert.ok(customized.every((workflow) => workflow.createdAt === 777 && workflow.updatedAt === 777))

  const download = customized.find((workflow) => workflow.id === ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID)
  assert.deepEqual(download.steps[1].toolRequest.arguments, {
    directoryUri: 'content://downloads/root',
    maxDepth: 1,
  }, 'scoped content directory URIs are trimmed and bound')

  const fileCopy = customized.find((workflow) => workflow.id === ANDROID_FILE_COPY_RENAME_WORKFLOW_ID)
  assert.deepEqual(fileCopy.steps[1].toolRequest.arguments, {
    mode: 'copy',
    conflictPolicy: 'rename',
    directoryUri: 'content://downloads/root',
    sourceName: 'source.txt',
    targetName: 'renamed.txt',
  }, 'safe display names are trimmed while traversal-like names fail closed')

  const apkInstall = customized.find((workflow) => workflow.id === ANDROID_APK_INSTALL_WORKFLOW_ID)
  assert.deepEqual(apkInstall.steps.map((step) => step.toolRequest.arguments), [
    { apkUri: 'content://downloads/releases/islemind.apk' },
    { apkUri: 'content://downloads/releases/islemind.apk' },
  ], 'the injected APK URI sanitizer controls both installer steps')

  const rejected = fixture.catalog.list({
    directoryUri: 'file:///storage/emulated/0/Download',
    apkUri: 'https://example.com/islemind.apk',
    sourceName: '../secret.txt',
    targetDirectoryName: 'bad/name',
    targetName: 'bad\\name',
    now: 778,
  })
  const rejectedDownload = rejected.find((workflow) => workflow.id === ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID)
  assert.deepEqual(rejectedDownload.steps[1].toolRequest.arguments, { maxDepth: 1 })
  const rejectedFileCopy = rejected.find((workflow) => workflow.id === ANDROID_FILE_COPY_RENAME_WORKFLOW_ID)
  assert.deepEqual(rejectedFileCopy.steps[1].toolRequest.arguments, {
    mode: 'copy',
    conflictPolicy: 'rename',
  })
  const rejectedApk = rejected.find((workflow) => workflow.id === ANDROID_APK_INSTALL_WORKFLOW_ID)
  assert.ok(rejectedApk.steps.every((step) => step.toolRequest.arguments === undefined))

  const redacted = createTestAndroidWorkflowCatalog({
    redactText: (value) => value.replaceAll('download', '[redacted]'),
  }).catalog.list({ now: 779 })
  assert.ok(
    redacted[0].triggerHints.includes('[redacted]'),
    'the injected workflow-definition redaction policy remains active for catalog content',
  )
}

function createTestAndroidWorkflowCatalog(options = {}) {
  let generatedIdCount = 0
  const definitionPolicy = createWorkflowDefinitionPolicy({
    clock: { now: () => options.now ?? 100 },
    generateIdSuffix() {
      generatedIdCount += 1
      return 'fixed'
    },
    redactSensitiveText: options.redactText ?? ((value) => value),
    resolveUniqueManifest: () => undefined,
  })
  const catalog = createAndroidWorkflowCatalog({
    definitionPolicy,
    sanitizeApkUri(value) {
      const uri = value?.trim()
      if (!uri || !/^(?:file|content):\/\//i.test(uri) || !/\.apk(?:$|[?#])/i.test(uri)) return undefined
      return uri
    },
  })
  return {
    catalog,
    getGeneratedIdCount: () => generatedIdCount,
  }
}

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAndroidWorkflowTemplateHook) return
  const originalResolve = Module._resolveFilename
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
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isAndroidWorkflowTemplateHook = true
  require.extensions['.ts'] = hook
}

function assertAndroidWorkflowRuntimeSelection() {
  assert.match(
    tasksPublicEntrySource,
    /export \* from '\.\/application\/workflowIntentClassifier'/,
    'Android intent classification is published through the Tasks public entry',
  )
  const classifier = createAndroidIntentClassifier()
  assert.deepEqual(
    classifier.classify({ goal: 'Install Android app.apk.', now: 200 }),
    {
      intent: 'plain_chat',
      shouldRunWorkflow: false,
      confidence: 0.62,
      reasons: ['model-tool-selection'],
      suggestedToolRequest: undefined,
      trace: {
        id: classifier.classify({ goal: 'Install Android app.apk.', now: 200 }).trace.id,
        type: 'reasoning',
        title: 'Agent intent',
        content: 'plain_chat · confidence=0.62 · model-tool-selection',
        status: 'done',
        startedAt: 200,
        completedAt: 200,
        durationMs: 0,
        metadata: {
          intent: 'plain_chat',
          shouldRunWorkflow: false,
          confidence: 0.62,
          reasons: ['model-tool-selection'],
          requestedOutput: undefined,
          toolName: undefined,
          toolId: undefined,
        },
      },
    },
    'Android text stays on the model-scheduled path until the model requests a registered tool or explicit workflow',
  )
  assert.doesNotMatch(classifierSourceText, /inferAndroidWorkflowId|android-device-task-keyword/, 'the classifier cannot restore local Android keyword dispatch')
}

function createAndroidIntentClassifier() {
  return createWorkflowIntentClassifier({
    clock: { now: () => 100 },
    projectTrace: (trace) => ({
      ...trace,
      completedAt: trace.completedAt ?? trace.startedAt,
      durationMs: trace.durationMs ?? 0,
    }),
  })
}
