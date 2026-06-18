import type { AgentWorkflowDefinition } from '@/services/agent/agentToolTypes'
import { createAgentWorkflowDefinition } from '@/services/agent/agentWorkflowDefinitions'
import { sanitizeAndroidApkUri } from '@/services/androidUriPolicy'

export const ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID = 'agent-workflow-android-download-organize'
export const ANDROID_FILE_COPY_RENAME_WORKFLOW_ID = 'agent-workflow-android-file-copy-rename'
export const ANDROID_APK_INSTALL_WORKFLOW_ID = 'agent-workflow-android-apk-install'
export const ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID = 'agent-workflow-android-app-cache-cleanup'
export const ANDROID_ALARM_WORKFLOW_ID = 'agent-workflow-android-alarm'
export const ANDROID_CALENDAR_TODO_WORKFLOW_ID = 'agent-workflow-android-calendar-todo'
export const ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID = 'agent-workflow-android-notification-settings'

export interface CreateAndroidBuiltInWorkflowInput {
  directoryUri?: string
  apkUri?: string
  sourceName?: string
  targetDirectoryName?: string
  targetName?: string
  enabled?: boolean
  now?: number
}

export function createAndroidDownloadOrganizeWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  const directoryUri = sanitizeDirectoryUri(input.directoryUri)
  return createAgentWorkflowDefinition({
    id: ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID,
    name: 'Android Download organize workflow',
    description: [
      'Requests scoped Android SAF access to Download, scans directory entries, proposes a categorized structure,',
      'previews a reversible file organization plan,',
      'and applies only a visible user-confirmed operation manifest.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'download',
      'downloads',
      'download directory',
      'organize files',
      'file cleanup',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'reply',
    acceptanceChecks: [
      'uses Android SAF directory access',
      'scans directory entries before organization proposal',
      'proposes categorized structure before write',
      'previews file operations before write',
      'applies only visible confirmed operations',
      'refuses delete operations',
      'records Android operation audit',
      'returns undo operations when moves are applied',
    ],
    steps: [
      {
        id: 'request-download-access',
        title: 'Open Android Download directory picker',
        toolRequest: {
          toolId: 'android:files.request_directory_access',
          name: 'android.files.request_directory_access',
          source: 'android',
          arguments: { initialDirectory: 'downloads' },
        },
        acceptance: [
          'opens Android system directory picker',
          'limits access to the selected SAF tree',
        ],
      },
      {
        id: 'scan-download-directory',
        title: 'Scan Android Download directory entries',
        toolRequest: {
          toolId: 'android:files.scan',
          name: 'android.files.scan',
          source: 'android',
          arguments: directoryUri
            ? { directoryUri, maxDepth: 1 }
            : { maxDepth: 1 },
        },
        acceptance: [
          'lists files and directories inside the selected SAF tree',
          'does not mutate files while scanning',
        ],
      },
      {
        id: 'propose-download-structure',
        title: 'Propose categorized Android Download structure',
        toolRequest: {
          toolId: 'android:files.propose_structure',
          name: 'android.files.propose_structure',
          source: 'android',
          arguments: directoryUri
            ? { directoryUri }
            : {},
        },
        acceptance: [
          'groups files into user-reviewable categories',
          'does not mutate files while proposing structure',
        ],
      },
      {
        id: 'preview-organization',
        title: 'Preview Android Download organization operations',
        toolRequest: {
          toolId: 'android:files.preview_operations',
          name: 'android.files.preview_operations',
          source: 'android',
          arguments: directoryUri
            ? { mode: 'organize', directoryUri }
            : { mode: 'organize' },
        },
        acceptance: [
          'returns operation manifest before changes',
          'requires directoryUri from SAF grant or runtime binding',
        ],
      },
      {
        id: 'apply-confirmed-operations',
        title: 'Apply confirmed Android Download file operations',
        toolRequest: {
          toolId: 'android:files.apply_operations',
          name: 'android.files.apply_operations',
          source: 'android',
          arguments: { operations: [] },
        },
        acceptance: [
          'requires visible user confirmation',
          'applies only generated SAF operations',
          'delete operations remain unsupported',
        ],
      },
    ],
    now: input.now,
  })
}

export function createAndroidFileCopyRenameWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  const previewArguments = buildFileCopyRenamePreviewArguments(input)
  return createAgentWorkflowDefinition({
    id: ANDROID_FILE_COPY_RENAME_WORKFLOW_ID,
    name: 'Android SAF file copy and rename workflow',
    description: [
      'Requests scoped Android SAF access, previews a single copy or rename manifest from user-provided names,',
      'and applies it only after a visible confirmation. Delete-based undo remains unsupported.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'copy file',
      'rename file',
      'copy and rename',
      '复制',
      '重命名',
      '目录',
      '文件',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'reply',
    acceptanceChecks: [
      'uses Android SAF directory access',
      'requires source file name and target file name',
      'previews copy or rename operation before write',
      'applies only visible confirmed operations',
      'refuses raw filesystem paths',
      'delete operations remain unsupported',
      'records Android operation audit',
    ],
    steps: [
      {
        id: 'request-file-access',
        title: 'Open Android SAF directory picker',
        toolRequest: {
          toolId: 'android:files.request_directory_access',
          name: 'android.files.request_directory_access',
          source: 'android',
          arguments: { initialDirectory: 'downloads' },
        },
        acceptance: [
          'opens Android system directory picker',
          'limits access to the selected SAF tree',
        ],
      },
      {
        id: 'preview-copy-rename',
        title: 'Preview Android SAF copy and rename operation',
        toolRequest: {
          toolId: 'android:files.preview_operations',
          name: 'android.files.preview_operations',
          source: 'android',
          arguments: previewArguments,
        },
        acceptance: [
          'finds the source by name only inside the selected SAF tree',
          'returns an operation manifest before changes',
          'does not delete original files',
        ],
      },
      {
        id: 'apply-copy-rename',
        title: 'Apply confirmed Android SAF copy and rename operation',
        toolRequest: {
          toolId: 'android:files.apply_operations',
          name: 'android.files.apply_operations',
          source: 'android',
          arguments: { operations: [] },
        },
        acceptance: [
          'requires visible user confirmation',
          'applies only the previewed SAF operation manifest',
          'delete operations remain unsupported',
        ],
      },
    ],
    now: input.now,
  })
}

export function createAndroidApkInstallWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  const apkUri = sanitizeAndroidUri(input.apkUri)
  const apkArguments = apkUri ? { apkUri } : undefined
  return createAgentWorkflowDefinition({
    id: ANDROID_APK_INSTALL_WORKFLOW_ID,
    name: 'Android APK installer workflow',
    description: [
      'Inspects an APK URI and opens the Android system package installer.',
      'The package installer remains the authority for user confirmation.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'apk',
      'install apk',
      'package installer',
      'system installer',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'handoff',
    acceptanceChecks: [
      'requires an APK URI from user input or runtime binding',
      'opens Android system package installer',
      'requires system installer confirmation',
      'silent install remains unsupported',
      'records Android operation audit',
    ],
    steps: [
      {
        id: 'inspect-apk',
        title: 'Inspect Android APK URI',
        toolRequest: {
          toolId: 'android:apk.inspect',
          name: 'android.apk.inspect',
          source: 'android',
          arguments: apkArguments,
        },
        acceptance: [
          'verifies APK existence when the URI is readable',
          'does not install during inspection',
        ],
      },
      {
        id: 'open-system-installer',
        title: 'Open Android system package installer',
        toolRequest: {
          toolId: 'android:apk.open_installer',
          name: 'android.apk.open_installer',
          source: 'android',
          arguments: apkArguments,
        },
        acceptance: [
          'uses Android system installer UI',
          'requires user confirmation outside IsleMind',
        ],
      },
    ],
    now: input.now,
  })
}

export function createAndroidAppCacheCleanupWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  return createAgentWorkflowDefinition({
    id: ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID,
    name: 'Android app-cache cleanup workflow',
    description: [
      'Reviews storage cleanup suggestions and clears only IsleMind app-owned cache after visible confirmation.',
      'User files and shared storage cleanup remain unsupported.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'cleanup',
      'cache',
      'storage',
      'app cache',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'reply',
    acceptanceChecks: [
      'audits storage before cleanup',
      'limits deletion to IsleMind app cache',
      'requires visible user confirmation',
      'does not delete user files',
      'records Android operation audit',
    ],
    steps: [
      {
        id: 'propose-cleanup',
        title: 'Review Android storage cleanup proposal',
        toolRequest: {
          toolId: 'android:storage.propose_cleanup',
          name: 'android.storage.propose_cleanup',
          source: 'android',
        },
        acceptance: [
          'returns app-cache-only cleanup options',
          'reports full-phone cleaner as unsupported',
        ],
      },
      {
        id: 'clear-app-cache',
        title: 'Clear IsleMind Android app cache',
        toolRequest: {
          toolId: 'android:storage.clear_app_cache',
          name: 'android.storage.clear_app_cache',
          source: 'android',
        },
        acceptance: [
          'requires visible user confirmation',
          'deletes only app-owned cache entries',
        ],
      },
    ],
    now: input.now,
  })
}

export function createAndroidAlarmWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  return createAgentWorkflowDefinition({
    id: ANDROID_ALARM_WORKFLOW_ID,
    name: 'Android alarm handoff workflow',
    description: [
      'Binds the requested alarm time and opens the Android Clock UI.',
      'The alarm is created only after the user confirms in the system app.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'alarm',
      'clock',
      '闹钟',
      'reminder',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'handoff',
    acceptanceChecks: [
      'requires alarm time from user input',
      'opens Android system clock UI',
      'requires system clock confirmation',
      'does not request exact alarm permission',
      'records Android operation audit',
    ],
    steps: [
      {
        id: 'open-alarm-editor',
        title: 'Open Android alarm editor',
        toolRequest: {
          toolId: 'android:alarm.open_create_intent',
          name: 'android.alarm.open_create_intent',
          source: 'android',
          arguments: {},
        },
        acceptance: [
          'sets hour and minutes from user input',
          'keeps Android clock confirmation visible',
        ],
      },
    ],
    now: input.now,
  })
}

export function createAndroidCalendarTodoWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  return createAgentWorkflowDefinition({
    id: ANDROID_CALENDAR_TODO_WORKFLOW_ID,
    name: 'Android calendar to-do handoff workflow',
    description: [
      'Binds the requested to-do title and due time, then opens the Android Calendar UI.',
      'The entry is created only after the user confirms in the system app.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'todo',
      'calendar',
      'reminder',
      '待办',
      '日历',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'handoff',
    acceptanceChecks: [
      'requires to-do title from user input',
      'opens Android system calendar UI',
      'requires system calendar confirmation',
      'does not request calendar write permission',
      'records Android operation audit',
    ],
    steps: [
      {
        id: 'open-calendar-todo-editor',
        title: 'Open Android calendar to-do editor',
        toolRequest: {
          toolId: 'android:reminder.open_create_todo',
          name: 'android.reminder.open_create_todo',
          source: 'android',
          arguments: {},
        },
        acceptance: [
          'sets title from user input',
          'sets due time when present',
          'keeps Android calendar confirmation visible',
        ],
      },
    ],
    now: input.now,
  })
}

export function createAndroidNotificationSettingsWorkflowDefinition(
  input: CreateAndroidBuiltInWorkflowInput = {}
): AgentWorkflowDefinition {
  return createAgentWorkflowDefinition({
    id: ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID,
    name: 'Android notification settings handoff workflow',
    description: [
      'Opens Android app notification settings or promoted notification settings for IsleMind.',
      'Any permission or promoted-notification change is finalized only in the Android system UI.',
    ].join(' '),
    enabled: input.enabled ?? true,
    triggerHints: [
      'android',
      'notification settings',
      'app notifications',
      'system notifications',
      'promoted notifications',
      '通知设置',
      '通知权限',
    ],
    permissionCeiling: 'read-write',
    expectedOutput: 'handoff',
    acceptanceChecks: [
      'opens Android app notification settings',
      'can target promoted notification settings when supported',
      'requires system UI confirmation for permission or promoted changes',
      'does not claim reliable background reply delivery',
      'records Android operation audit',
    ],
    steps: [
      {
        id: 'open-notification-settings',
        title: 'Open Android notification settings',
        toolRequest: {
          toolId: 'android:notifications.open_settings',
          name: 'android.notifications.open_settings',
          source: 'android',
          arguments: { target: 'notifications' },
        },
        acceptance: [
          'opens Android app notification settings',
          'keeps final permission and promoted changes inside Android system settings',
        ],
      },
    ],
    now: input.now,
  })
}

export function listAndroidBuiltInWorkflowDefinitions(input: CreateAndroidBuiltInWorkflowInput = {}): AgentWorkflowDefinition[] {
  return [
    createAndroidDownloadOrganizeWorkflowDefinition(input),
    createAndroidFileCopyRenameWorkflowDefinition(input),
    createAndroidApkInstallWorkflowDefinition(input),
    createAndroidAppCacheCleanupWorkflowDefinition(input),
    createAndroidAlarmWorkflowDefinition(input),
    createAndroidCalendarTodoWorkflowDefinition(input),
    createAndroidNotificationSettingsWorkflowDefinition(input),
  ]
}

function sanitizeDirectoryUri(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.startsWith('content://') ? trimmed : undefined
}

function sanitizeAndroidUri(value: string | undefined): string | undefined {
  return sanitizeAndroidApkUri(value)
}

function buildFileCopyRenamePreviewArguments(input: CreateAndroidBuiltInWorkflowInput): Record<string, unknown> {
  const directoryUri = sanitizeDirectoryUri(input.directoryUri)
  const sourceName = sanitizeDisplayName(input.sourceName)
  const targetDirectoryName = sanitizeDisplayName(input.targetDirectoryName)
  const targetName = sanitizeDisplayName(input.targetName)
  return {
    mode: 'copy',
    conflictPolicy: 'rename',
    ...(directoryUri ? { directoryUri } : {}),
    ...(sourceName ? { sourceName } : {}),
    ...(targetDirectoryName ? { targetDirectoryName } : {}),
    ...(targetName ? { targetName } : {}),
  }
}

function sanitizeDisplayName(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && !/[\\/:*?"<>|]/.test(trimmed) && !trimmed.includes('..') ? trimmed : undefined
}
