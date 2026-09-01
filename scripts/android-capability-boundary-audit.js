const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const appJsonPath = path.join(root, 'app.json')
const nativeTemplatePath = path.join(root, 'plugins', 'android-device-tools', 'AndroidDeviceToolsModule.kt')
const nativeGeneratedPath = path.join(root, 'android', 'app', 'src', 'main', 'java', 'com', 'islemind', 'app', 'AndroidDeviceToolsModule.kt')
const statusEvidenceScriptPath = path.join(root, 'scripts', 'collect-android-status-notification-evidence.js')
const runtimeAuditEntries = []
let capabilitySources

const CANONICAL_ANDROID_WORKFLOW_IDS = [
  'agent-workflow-android-download-organize',
  'agent-workflow-android-file-copy-rename',
  'agent-workflow-android-apk-install',
  'agent-workflow-android-app-cache-cleanup',
  'agent-workflow-android-alarm',
  'agent-workflow-android-calendar-todo',
  'agent-workflow-android-notification-settings',
]

function collectAndroidCapabilitySources() {
  if (capabilitySources) return capabilitySources
  registerTypeScriptSupport()

  const tasks = require('../src/modules/tasks/index.ts')
  const integrations = require('../src/modules/integrations/index.ts')
  const androidTools = require('../src/services/androidDeviceTools.ts')
  const definitionPolicy = tasks.createWorkflowDefinitionPolicy({
    clock: { now: () => 0 },
    generateIdSuffix: () => 'audit',
    redactSensitiveText: (value) => value,
    resolveUniqueManifest: () => undefined,
  })
  const workflowCatalog = tasks.createAndroidWorkflowCatalog({
    definitionPolicy,
    sanitizeApkUri: () => undefined,
  })
  const workflows = workflowCatalog.list({ now: 0 })
  const toolManifests = androidTools.listAndroidDeviceToolManifests()
  const integratedManifests = integrations.listStaticConversationToolCatalog({
    builtinServerId: 'builtin',
    listMcpServers: async () => [],
    getBuiltinServer: () => ({ id: 'builtin', name: 'Built-in', status: 'connected', enabled: true, tools: [] }),
    listBuiltinTools: () => [],
    listAppActionTools: () => [],
    listAndroidTools: () => toolManifests,
  })

  capabilitySources = {
    tasks,
    androidTools,
    workflows,
    toolManifests,
    integratedManifests,
  }
  return capabilitySources
}

async function assertAndroidCapabilityBoundary() {
  const sources = collectAndroidCapabilitySources()
  assertCatalogAlignment(sources)
  assertPermissionAndConfirmationGates(sources)
  assertNativePluginBoundary()
  await assertRuntimeAuditBoundary(sources)
  assertDeviceEvidenceMapping(sources)
  return sources
}

function assertCatalogAlignment({ tasks, workflows, toolManifests, integratedManifests }) {
  const workflowIds = workflows.map((workflow) => workflow.id)
  assert.deepEqual(
    workflowIds,
    CANONICAL_ANDROID_WORKFLOW_IDS,
    'Tasks workflow catalog must retain the seven canonical public Android workflow IDs.',
  )
  assert.equal(
    new Set(workflowIds).size,
    CANONICAL_ANDROID_WORKFLOW_IDS.length,
    'Tasks workflow catalog must retain seven unique canonical Android workflow IDs.',
  )
  assert.deepEqual(
    [...tasks.ANDROID_BUILT_IN_WORKFLOW_IDS],
    CANONICAL_ANDROID_WORKFLOW_IDS,
    'Tasks public workflow ID export must retain the canonical Android catalog.',
  )
  assert.deepEqual(
    integratedManifests.map((tool) => tool.id),
    toolManifests.map((tool) => tool.id),
    'Integrations public catalog must preserve every Android tool manifest.',
  )

  const toolsById = new Map(toolManifests.map((tool) => [tool.id, tool]))
  assert.equal(toolsById.size, toolManifests.length, 'Android tool IDs must stay unique.')
  assert.ok(toolManifests.every((tool) => tool.source === 'android' && tool.enabled === true))
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      const request = step.toolRequest
      if (!request) continue
      const tool = toolsById.get(request.toolId)
      assert.ok(tool, `Workflow ${workflow.id} references registered Android tool ${request.toolId}.`)
      assert.equal(request.name, tool.name, `Workflow ${workflow.id} keeps ${request.toolId} tool-name identity aligned.`)
      assert.equal(request.source, 'android', `Workflow ${workflow.id} keeps Android tool ownership explicit.`)
      assert.ok(
        permissionRank(tool.permission) <= permissionRank(workflow.permissionCeiling),
        `Workflow ${workflow.id} permission ceiling covers ${tool.id}.`,
      )
    }
  }
}

function assertPermissionAndConfirmationGates({ toolManifests }) {
  const toolsById = new Map(toolManifests.map((tool) => [tool.id, tool]))
  for (const tool of toolManifests) {
    if (tool.permission === 'read-only') continue
    const metadata = tool.metadata ?? {}
    assert.ok(
      metadata.requiresVisibleUserAction === true ||
        metadata.requiresExternalConfirmation === true ||
        metadata.directSystemIntentRequest === true,
      `Write-capable Android tool ${tool.id} must retain a visible, external, or system-intent gate.`,
    )
  }

  for (const tool of toolManifests.filter((item) => item.id.startsWith('android:files.'))) {
    assert.deepEqual(tool.metadata?.allowedUriSchemes, ['content'], `${tool.id} stays restricted to content URIs.`)
    assert.equal(tool.metadata?.deleteSupported, false, `${tool.id} must not enable deletion.`)
    assert.equal(tool.metadata?.permanentDeleteSupported, false, `${tool.id} must not enable permanent deletion.`)
  }
  assertToolMetadata(toolsById, 'android:files.apply_operations', 'requiresVisibleUserAction', true)
  assertToolMetadata(toolsById, 'android:files.undo_operations', 'requiresVisibleUserAction', true)
  assertToolMetadata(toolsById, 'android:apk.open_installer', 'requiresExternalConfirmation', true)
  assertToolMetadata(toolsById, 'android:apk.open_installer', 'silentInstallSupported', false)
  assertToolMetadata(toolsById, 'android:storage.clear_app_cache', 'scope', 'app-cache-only')
  assertToolMetadata(toolsById, 'android:storage.clear_app_cache', 'fullPhoneCleanerSupported', false)
  assertToolMetadata(toolsById, 'android:alarm.open_create_intent', 'directSystemIntentRequest', true)
  assertToolMetadata(toolsById, 'android:alarm.open_create_intent', 'exactAlarmPermissionRequired', false)
  assertToolMetadata(toolsById, 'android:calendar.open_create_event', 'calendarPermissionRequired', false)
  assertToolMetadata(toolsById, 'android:reminder.open_create_todo', 'requiresExternalConfirmation', true)
  assertToolMetadata(toolsById, 'android:reminder.open_create_todo', 'localReminderStoreAvailable', false)
  assertToolMetadata(toolsById, 'android:notifications.open_settings', 'requiresExternalConfirmation', true)
  assertToolMetadata(toolsById, 'android:notifications.open_settings', 'backgroundReliable', false)
}

async function assertRuntimeAuditBoundary({ androidTools, toolManifests }) {
  runtimeAuditEntries.length = 0
  const scanTool = toolManifests.find((tool) => tool.id === 'android:files.scan')
  assert.ok(scanTool, 'Android file scan manifest is required for the non-intrusive audit probe.')
  const result = await androidTools.executeAndroidDeviceTool(scanTool, {}, { runtimeLog: { enabled: true } })
  const audit = result.observation.metadata?.androidOperationAudit
  assert.ok(audit && typeof audit === 'object' && !Array.isArray(audit), 'Every Android execution result carries an operation audit.')
  for (const field of [
    'auditId',
    'toolId',
    'toolName',
    'source',
    'permission',
    'operationKind',
    'status',
    'ok',
    'scope',
    'confirmationState',
    'visibleActionRequired',
    'externalConfirmationRequired',
    'deleteSupported',
    'permanentDeleteSupported',
  ]) {
    assert.ok(Object.hasOwn(audit, field), `Android operation audit must retain ${field}.`)
  }
  assert.equal(audit.toolId, scanTool.id)
  assert.equal(audit.operationKind, 'file-scan')
  assert.equal(audit.deleteSupported, false)
  assert.equal(audit.permanentDeleteSupported, false)
  assert.equal(runtimeAuditEntries.length, 1, 'Android execution must append exactly one runtime audit record.')
  assert.equal(runtimeAuditEntries[0].event, 'android.operation.audit')
  assert.equal(runtimeAuditEntries[0].data.toolId, scanTool.id)

  const notificationTool = toolManifests.find((tool) => tool.id === 'android:notifications.open_settings')
  assert.ok(notificationTool, 'Android notification settings manifest is required for the injected-port probe.')
  let openedTarget = null
  const notificationResult = await androidTools.executeAndroidDeviceTool(notificationTool, { target: 'promoted' }, {
    runtimeLog: { enabled: true },
    openStatusNotificationSettings: async (target) => {
      openedTarget = target
      return { opened: true, target, reason: 'opened' }
    },
  })
  assert.equal(notificationResult.observation.ok, true, 'The task runtime can inject the admitted notification settings port.')
  assert.equal(openedTarget, 'promoted', 'The injected notification settings port receives the normalized target.')
  assert.equal(notificationResult.observation.metadata?.androidOperationAudit?.operationKind, 'notification-settings-intent')
  assert.equal(runtimeAuditEntries.length, 2, 'The injected notification settings execution appends one audit record.')
}

function assertNativePluginBoundary() {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'))
  assert.ok(
    appJson.expo.plugins.includes('./plugins/android-device-tools/withAndroidDeviceTools'),
    'app.json must keep the Android device-tools native plugin enabled.',
  )
  const template = fs.readFileSync(nativeTemplatePath, 'utf8')
  const generated = fs.readFileSync(nativeGeneratedPath, 'utf8')
  assert.equal(normalizeGeneratedKotlin(generated), normalizeGeneratedKotlin(template), 'Generated Android native module must match its plugin template.')
  assert.deepEqual(extractReactMethods(template), [
    'scanDirectory',
    'ensureDirectory',
    'copyDocument',
    'moveDocument',
    'renameDocument',
    'publishPortableJsonFileToDownloads',
  ], 'The native bridge exposes only scoped SAF operations and the portable JSON Downloads publisher.')
  for (const forbidden of [/DocumentsContract\.deleteDocument/, /\bdeleteDocument\s*\(/, /Runtime\.getRuntime/, /ProcessBuilder\s*\(/]) {
    assert.doesNotMatch(template, forbidden, `Native Android bridge must not expose ${forbidden}.`)
  }
}

function assertDeviceEvidenceMapping({ workflows, toolManifests }) {
  const { taskTemplateOrder } = require('./collect-android-device-task-evidence')
  const workflowsById = new Map(workflows.map((workflow) => [workflow.id, workflow]))
  const toolIds = new Set(toolManifests.map((tool) => tool.id))
  assert.equal(taskTemplateOrder.length, 7, 'Device evidence keeps the seven non-intrusive task probes.')
  for (const task of taskTemplateOrder) {
    const workflow = workflowsById.get(task.workflowId)
    assert.ok(workflow, `Device evidence task ${task.id} maps to a Tasks-owned workflow.`)
    const workflowToolIds = new Set(workflow.steps.map((step) => step.toolRequest?.toolId).filter(Boolean))
    for (const toolId of task.requiredToolIds) {
      assert.ok(toolIds.has(toolId), `Device evidence task ${task.id} references registered tool ${toolId}.`)
      assert.ok(
        task.auxiliaryToolIds?.includes(toolId) || workflowToolIds.has(toolId),
        `Device evidence task ${task.id} aligns ${toolId} with its workflow or explicit auxiliary path.`,
      )
    }
  }
  const statusEvidenceText = fs.readFileSync(statusEvidenceScriptPath, 'utf8')
  assert.ok(statusEvidenceText.includes('android-status-notification-evidence.json'))
}

async function run() {
  await assertAndroidCapabilityBoundary()
  const result = runArchitectureContractSmoke({
    label: 'Android capability boundary',
    checkIds: ['agentic-workflow-engine-boundary', 'audit-evidence-boundary'],
  })
  assert.equal(result.summary.blockingIssues, 0)
  console.log('Android capability boundary audit passed')
}

function assertToolMetadata(toolsById, toolId, key, expected) {
  const tool = toolsById.get(toolId)
  assert.ok(tool, `Android tool registry must include ${toolId}.`)
  assert.deepEqual(tool.metadata?.[key], expected, `${toolId} must keep ${key}=${String(expected)}.`)
}

function permissionRank(permission) {
  return { 'read-only': 0, 'read-write': 1, destructive: 2 }[permission] ?? Number.POSITIVE_INFINITY
}

function extractReactMethods(text) {
  return [...String(text).matchAll(/@ReactMethod\s+fun\s+(\w+)\s*\(/g)].map((match) => match[1])
}

function normalizeGeneratedKotlin(text) {
  return String(text).replace(/^package .+$/m, 'package <app-package>').trim()
}

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isAndroidCapabilityAuditHook) return
  const originalResolve = Module._resolveFilename
  const originalLoad = Module._load
  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }
  Module._load = function loadAndroidAuditDependency(request, parent, isMain) {
    if (request === 'react-native') return { NativeModules: {}, Platform: { OS: 'android' } }
    if (request === 'expo-file-system/legacy') return { cacheDirectory: 'file:///cache/' }
    if (request === 'expo-intent-launcher') return { ActivityAction: {}, startActivityAsync: async () => undefined }
    if (request === '@/platform/native/runtimeLog') {
      return {
        appendRuntimeLog(event, data, options) {
          runtimeAuditEntries.push({ event, data, options })
          return Promise.resolve()
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isAndroidCapabilityAuditHook = true
  require.extensions['.ts'] = hook
}

module.exports = {
  assertAndroidCapabilityBoundary,
  collectAndroidCapabilitySources,
  extractReactMethods,
  run,
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
}
