const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runArchitectureContractSmoke } = require('./architecture-contract-smoke')

const root = path.resolve(__dirname, '..')
const workflowSourcePath = path.join(root, 'src', 'services', 'agent', 'agentAndroidWorkflows.ts')
const workflowSourceText = fs.readFileSync(workflowSourcePath, 'utf8')
const classifierSourcePath = path.join(root, 'src', 'services', 'agent', 'agentIntentClassifier.ts')
const classifierSourceText = fs.readFileSync(classifierSourcePath, 'utf8')

const ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID = 'agent-workflow-android-download-organize'
const ANDROID_FILE_COPY_RENAME_WORKFLOW_ID = 'agent-workflow-android-file-copy-rename'
const ANDROID_APK_INSTALL_WORKFLOW_ID = 'agent-workflow-android-apk-install'
const ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID = 'agent-workflow-android-app-cache-cleanup'
const ANDROID_ALARM_WORKFLOW_ID = 'agent-workflow-android-alarm'
const ANDROID_CALENDAR_TODO_WORKFLOW_ID = 'agent-workflow-android-calendar-todo'
const ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID = 'agent-workflow-android-notification-settings'

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
    expectedOutput: 'handoff',
    snippets: [
      'opens Android system clock UI',
      'requires system clock confirmation',
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

function run() {
  for (const workflowId of requiredWorkflowIds) {
    assert.ok(workflowSourceText.includes(workflowId), `Missing Android workflow template ${workflowId}.`)
    const expected = requiredWorkflowChecks.get(workflowId)
    assert.ok(expected, `Missing workflow audit expectations for ${workflowId}.`)
    const workflowBlock = extractWorkflowBlock(workflowSourceText, workflowId)
    assert.ok(workflowBlock, `Workflow source must contain a definition block for ${workflowId}.`)
    assert.ok(workflowBlock.includes(`expectedOutput: '${expected.expectedOutput}'`), `Workflow ${workflowId} must keep expectedOutput=${expected.expectedOutput}.`)
    assert.ok(workflowBlock.includes(`permissionCeiling: 'read-write'`), `Workflow ${workflowId} must keep permissionCeiling=read-write.`)
    for (const snippet of expected.snippets) {
      assert.ok(workflowBlock.includes(snippet), `Workflow ${workflowId} acceptanceChecks must include ${snippet}.`)
    }
  }

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

function extractWorkflowBlock(sourceText, workflowId) {
  const anchor = `id: ${constantNameForWorkflowId(workflowId)}`
  const start = sourceText.indexOf(anchor)
  if (start < 0) return ''
  const nextExport = sourceText.indexOf('\nexport function ', start + anchor.length)
  return sourceText.slice(start, nextExport > start ? nextExport : sourceText.length)
}

function constantNameForWorkflowId(workflowId) {
  switch (workflowId) {
    case ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID:
      return 'ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID'
    case ANDROID_FILE_COPY_RENAME_WORKFLOW_ID:
      return 'ANDROID_FILE_COPY_RENAME_WORKFLOW_ID'
    case ANDROID_APK_INSTALL_WORKFLOW_ID:
      return 'ANDROID_APK_INSTALL_WORKFLOW_ID'
    case ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID:
      return 'ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID'
    case ANDROID_ALARM_WORKFLOW_ID:
      return 'ANDROID_ALARM_WORKFLOW_ID'
    case ANDROID_CALENDAR_TODO_WORKFLOW_ID:
      return 'ANDROID_CALENDAR_TODO_WORKFLOW_ID'
    case ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID:
      return 'ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID'
    default:
      return `'${workflowId}'`
  }
}

function assertReminderTitleRuntimeBindings() {
  const plannerSourcePath = path.join(root, 'src', 'services', 'agent', 'agentPlanner.ts')
  const plannerSourceText = fs.readFileSync(plannerSourcePath, 'utf8')
  assert.ok(
    plannerSourceText.includes('isAndroidReminderRef(ref)') &&
      plannerSourceText.includes('inferReminderTitle(content)') &&
      plannerSourceText.includes('args.title = title'),
    'Android calendar workflow planning must bind title from the runtime prompt.',
  )
  for (const snippet of ['titled', 'called', 'named', 'with\\s+(?:the\\s+)?title']) {
    assert.ok(classifierSourceText.includes(snippet), `Reminder title inference must handle English "${snippet}" prompts.`)
  }
}

function assertAndroidWorkflowRuntimeSelection() {
  assert.ok(
    /if\s*\(\s*looksLikeAndroidApkInstallTask\(goal\)\s*\)\s*return\s+ANDROID_APK_INSTALL_WORKFLOW_ID/.test(classifierSourceText),
    'Android APK install prompts must select the APK workflow even before a file:// or content:// APK URI is bound.',
  )
  assert.ok(
    classifierSourceText.includes('return apkUri') &&
      classifierSourceText.includes('android.apk.open_installer') &&
      classifierSourceText.includes('android.files.request_directory_access'),
    'Android APK direct tool inference must still hand an APK URI to the installer or ask for Download SAF access when no URI is present.',
  )
}
