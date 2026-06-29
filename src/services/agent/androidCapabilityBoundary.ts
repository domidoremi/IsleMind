import type { AgentToolPermission, AgentWorkflowDefinition } from '@/services/agent/agentToolTypes'
import {
  ANDROID_ALARM_WORKFLOW_ID,
  ANDROID_APK_INSTALL_WORKFLOW_ID,
  ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID,
  ANDROID_CALENDAR_TODO_WORKFLOW_ID,
  ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID,
  ANDROID_FILE_COPY_RENAME_WORKFLOW_ID,
  ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID,
} from '@/services/agent/agentAndroidWorkflows'

export const ANDROID_CAPABILITY_BOUNDARY_SCHEMA = 'islemind.android.capability-boundary.v1'
export const ANDROID_OPERATION_AUDIT_EVENT = 'android.operation.audit'

export type AndroidCapabilitySurface =
  | 'skill-template'
  | 'agent-workflow'
  | 'android-tool-registry'
  | 'mcp-orchestrated-tool-request'
  | 'system-intent-request'
  | 'system-intent-handoff'
  | 'qa-cli-evidence'

export interface AndroidToolBoundary {
  toolId: string
  toolName: string
  permission: AgentToolPermission
  operationKind: string
  auditScope: string
  writeGate: 'not-required' | 'visible-user-action' | 'external-system-confirmation' | 'system-intent-request' | 'policy-mediated'
  allowedScopes: string[]
  rejectedCapabilities: string[]
}

export interface AndroidCapabilityTaskBoundary {
  id: string
  title: string
  examplePrompts: string[]
  workflowId: string
  expectedOutput: NonNullable<AgentWorkflowDefinition['expectedOutput']>
  permissionCeiling: AgentToolPermission
  entrySurfaces: AndroidCapabilitySurface[]
  toolIds: string[]
  requiredUserGates: string[]
  externalConfirmations: string[]
  allowedScopes: string[]
  rejectedCapabilities: string[]
  auditOperationKinds: string[]
  deviceEvidenceTaskIds: string[]
  evidenceCommands: string[]
}

export interface AndroidCapabilityBoundaryContract {
  schema: typeof ANDROID_CAPABILITY_BOUNDARY_SCHEMA
  runtime: {
    primaryExecutor: 'islemind-android-app-runtime'
    cliRole: 'qa-and-evidence-only'
    mcpRole: 'orchestrated-tool-request-only'
    skillRole: 'user-approved-workflow-template'
    systemIntentRole: 'system intent request with visible fallback'
  }
  permissions: {
    allowedDeclaredPermissions: string[]
    blockedSharedStoragePermissions: string[]
    forbiddenDeclaredPermissions: string[]
    forbiddenRuntimeCapabilities: string[]
  }
  audit: {
    eventName: typeof ANDROID_OPERATION_AUDIT_EVENT
    requiredRecordFields: string[]
  }
  tools: AndroidToolBoundary[]
  auxiliaryToolIds: string[]
  tasks: AndroidCapabilityTaskBoundary[]
}

export const ANDROID_ALLOWED_DECLARED_PERMISSIONS = [
  'android.permission.REQUEST_INSTALL_PACKAGES',
  'android.permission.POST_NOTIFICATIONS',
  'com.android.alarm.permission.SET_ALARM',
] as const

export const ANDROID_BLOCKED_SHARED_STORAGE_PERMISSIONS = [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.ACCESS_MEDIA_LOCATION',
] as const

export const ANDROID_FORBIDDEN_DECLARED_PERMISSIONS = [
  'android.permission.MANAGE_EXTERNAL_STORAGE',
  'android.permission.MANAGE_MEDIA',
  'android.permission.INSTALL_PACKAGES',
  'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION',
  'android.permission.DELETE_PACKAGES',
  'android.permission.REQUEST_DELETE_PACKAGES',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.READ_CALENDAR',
  'android.permission.WRITE_CALENDAR',
] as const

export const ANDROID_TOOL_BOUNDARIES: AndroidToolBoundary[] = [
  {
    toolId: 'android:files.request_directory_access',
    toolName: 'android.files.request_directory_access',
    permission: 'read-write',
    operationKind: 'directory-access',
    auditScope: 'user-selected-saf-tree',
    writeGate: 'external-system-confirmation',
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['raw filesystem path access', 'background directory grant'],
  },
  {
    toolId: 'android:files.scan',
    toolName: 'android.files.scan',
    permission: 'read-only',
    operationKind: 'file-scan',
    auditScope: 'user-selected-saf-tree',
    writeGate: 'not-required',
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['raw filesystem path access'],
  },
  {
    toolId: 'android:files.propose_structure',
    toolName: 'android.files.propose_structure',
    permission: 'read-only',
    operationKind: 'file-structure-proposal',
    auditScope: 'user-selected-saf-tree',
    writeGate: 'not-required',
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['file mutation', 'delete operation'],
  },
  {
    toolId: 'android:files.preview_operations',
    toolName: 'android.files.preview_operations',
    permission: 'read-only',
    operationKind: 'file-preview',
    auditScope: 'user-selected-saf-tree',
    writeGate: 'not-required',
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['file mutation', 'delete operation'],
  },
  {
    toolId: 'android:files.apply_operations',
    toolName: 'android.files.apply_operations',
    permission: 'read-write',
    operationKind: 'file-apply',
    auditScope: 'user-selected-saf-tree',
    writeGate: 'visible-user-action',
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['delete operation', 'permanent delete', 'raw filesystem path access'],
  },
  {
    toolId: 'android:files.undo_operations',
    toolName: 'android.files.undo_operations',
    permission: 'read-write',
    operationKind: 'file-undo',
    auditScope: 'user-selected-saf-tree',
    writeGate: 'visible-user-action',
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['delete rollback', 'permanent delete'],
  },
  {
    toolId: 'android:apk.inspect',
    toolName: 'android.apk.inspect',
    permission: 'read-only',
    operationKind: 'apk-inspect',
    auditScope: 'system-package-installer',
    writeGate: 'not-required',
    allowedScopes: ['file:// or content:// APK URI'],
    rejectedCapabilities: ['remote APK URL', 'install package'],
  },
  {
    toolId: 'android:apk.open_installer',
    toolName: 'android.apk.open_installer',
    permission: 'read-write',
    operationKind: 'apk-installer',
    auditScope: 'system-package-installer',
    writeGate: 'external-system-confirmation',
    allowedScopes: ['file:// or content:// APK URI'],
    rejectedCapabilities: ['silent install', 'package update without user action'],
  },
  {
    toolId: 'android:storage.audit',
    toolName: 'android.storage.audit',
    permission: 'read-only',
    operationKind: 'storage-audit',
    auditScope: 'storage-summary',
    writeGate: 'not-required',
    allowedScopes: ['storage summary', 'IsleMind app cache metadata'],
    rejectedCapabilities: ['full phone cleaner', 'shared storage delete'],
  },
  {
    toolId: 'android:storage.propose_cleanup',
    toolName: 'android.storage.propose_cleanup',
    permission: 'read-only',
    operationKind: 'storage-cleanup-proposal',
    auditScope: 'cleanup-proposal',
    writeGate: 'not-required',
    allowedScopes: ['IsleMind app cache', 'user-authorized directory preview'],
    rejectedCapabilities: ['full phone cleaner', 'user file delete'],
  },
  {
    toolId: 'android:storage.clear_app_cache',
    toolName: 'android.storage.clear_app_cache',
    permission: 'read-write',
    operationKind: 'storage-clear-app-cache',
    auditScope: 'app-cache',
    writeGate: 'visible-user-action',
    allowedScopes: ['IsleMind app cache'],
    rejectedCapabilities: ['full phone cleaner', 'user file delete', 'shared storage delete'],
  },
  {
    toolId: 'android:alarm.open_create_intent',
    toolName: 'android.alarm.open_create_intent',
    permission: 'read-write',
    operationKind: 'alarm-intent',
    auditScope: 'system-clock',
    writeGate: 'system-intent-request',
    allowedScopes: ['Android Clock alarm creation request', 'Android Clock create-alarm UI fallback'],
    rejectedCapabilities: ['exact alarm permission', 'private alarm store writes'],
  },
  {
    toolId: 'android:calendar.open_create_event',
    toolName: 'android.calendar.open_create_event',
    permission: 'read-write',
    operationKind: 'calendar-event-intent',
    auditScope: 'system-calendar',
    writeGate: 'external-system-confirmation',
    allowedScopes: ['Android Calendar insert UI'],
    rejectedCapabilities: ['calendar read permission', 'calendar write permission', 'background calendar write'],
  },
  {
    toolId: 'android:reminder.open_create_todo',
    toolName: 'android.reminder.open_create_todo',
    permission: 'read-write',
    operationKind: 'calendar-todo-intent',
    auditScope: 'system-calendar',
    writeGate: 'external-system-confirmation',
    allowedScopes: ['Android Calendar insert UI'],
    rejectedCapabilities: ['calendar read permission', 'calendar write permission', 'background todo creation'],
  },
  {
    toolId: 'android:notifications.open_settings',
    toolName: 'android.notifications.open_settings',
    permission: 'read-write',
    operationKind: 'notification-settings-intent',
    auditScope: 'system-notification-settings',
    writeGate: 'external-system-confirmation',
    allowedScopes: ['IsleMind app notification settings', 'Android promoted notification settings'],
    rejectedCapabilities: ['background notification grant', 'reliable background reply claim'],
  },
]

export const ANDROID_AUXILIARY_TOOL_IDS = [
  'android:files.undo_operations',
  'android:storage.audit',
  'android:calendar.open_create_event',
  'android:notifications.open_settings',
] as const

export const ANDROID_CAPABILITY_TASKS: AndroidCapabilityTaskBoundary[] = [
  {
    id: 'download-directory-organize',
    title: 'Organize Download directory through SAF manifests',
    examplePrompts: ['查询download目录下的目录以及文件，并将它们整理成合理的目录架构。'],
    workflowId: ANDROID_DOWNLOAD_ORGANIZE_WORKFLOW_ID,
    expectedOutput: 'reply',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'qa-cli-evidence'],
    toolIds: ['android:files.request_directory_access', 'android:files.scan', 'android:files.propose_structure', 'android:files.preview_operations', 'android:files.apply_operations'],
    requiredUserGates: ['SAF directory picker', 'visible operation manifest confirmation'],
    externalConfirmations: ['Android directory picker'],
    allowedScopes: ['user-selected Download SAF tree'],
    rejectedCapabilities: ['raw filesystem path access', 'delete operation', 'permanent delete'],
    auditOperationKinds: ['directory-access', 'file-scan', 'file-structure-proposal', 'file-preview', 'file-apply'],
    deviceEvidenceTaskIds: ['download-directory-access', 'saf-file-apply-undo'],
    evidenceCommands: ['bun run test:android-device-task:evidence -- --device <serial>'],
  },
  {
    id: 'file-copy-rename',
    title: 'Copy a selected SAF file into a target directory with a new name',
    examplePrompts: ['把A.md复制到B目录下，并重命名为C.txt'],
    workflowId: ANDROID_FILE_COPY_RENAME_WORKFLOW_ID,
    expectedOutput: 'reply',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'qa-cli-evidence'],
    toolIds: ['android:files.request_directory_access', 'android:files.preview_operations', 'android:files.apply_operations'],
    requiredUserGates: ['SAF directory picker', 'visible operation manifest confirmation'],
    externalConfirmations: ['Android directory picker'],
    allowedScopes: ['user-selected SAF tree'],
    rejectedCapabilities: ['raw filesystem path access', 'delete original during copy', 'permanent delete'],
    auditOperationKinds: ['directory-access', 'file-preview', 'file-apply'],
    deviceEvidenceTaskIds: ['saf-file-copy-rename'],
    evidenceCommands: ['bun run test:android-device-task:evidence -- --device <serial>'],
  },
  {
    id: 'apk-system-installer',
    title: 'Inspect an APK and open the Android system installer',
    examplePrompts: ['安装weixin.apk'],
    workflowId: ANDROID_APK_INSTALL_WORKFLOW_ID,
    expectedOutput: 'handoff',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'system-intent-handoff', 'qa-cli-evidence'],
    toolIds: ['android:apk.inspect', 'android:apk.open_installer'],
    requiredUserGates: ['APK URI review', 'system installer confirmation'],
    externalConfirmations: ['Android package installer'],
    allowedScopes: ['file:// or content:// APK URI'],
    rejectedCapabilities: ['silent install', 'INSTALL_PACKAGES privileged permission', 'remote APK URL'],
    auditOperationKinds: ['apk-inspect', 'apk-installer'],
    deviceEvidenceTaskIds: ['apk-installer-handoff'],
    evidenceCommands: ['bun run test:android-device-task:evidence -- --device <serial>'],
  },
  {
    id: 'app-cache-cleanup',
    title: 'Review cleanup suggestions and clear IsleMind app cache only',
    examplePrompts: ['清理手机，进行垃圾清理。'],
    workflowId: ANDROID_APP_CACHE_CLEANUP_WORKFLOW_ID,
    expectedOutput: 'reply',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'qa-cli-evidence'],
    toolIds: ['android:storage.propose_cleanup', 'android:storage.clear_app_cache'],
    requiredUserGates: ['visible app-cache cleanup confirmation'],
    externalConfirmations: [],
    allowedScopes: ['IsleMind app cache'],
    rejectedCapabilities: ['full phone cleaner', 'shared storage delete', 'user file delete'],
    auditOperationKinds: ['storage-cleanup-proposal', 'storage-clear-app-cache'],
    deviceEvidenceTaskIds: ['app-cache-cleanup'],
    evidenceCommands: ['bun run test:android-device-task:evidence -- --device <serial>'],
  },
  {
    id: 'alarm-system-clock',
    title: 'Request Android Clock alarm creation',
    examplePrompts: ['定一个八点的闹钟，写上：该休息了'],
    workflowId: ANDROID_ALARM_WORKFLOW_ID,
    expectedOutput: 'reply',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'system-intent-request', 'qa-cli-evidence'],
    toolIds: ['android:alarm.open_create_intent'],
    requiredUserGates: ['system clock confirmation when Android Clock ignores direct creation'],
    externalConfirmations: ['Android Clock when direct creation is unsupported'],
    allowedScopes: ['Android Clock alarm creation request', 'Android Clock create-alarm UI fallback'],
    rejectedCapabilities: ['exact alarm permission', 'private alarm store writes'],
    auditOperationKinds: ['alarm-intent'],
    deviceEvidenceTaskIds: ['alarm-intent-create-request'],
    evidenceCommands: ['bun run test:android-device-task:evidence -- --device <serial>'],
  },
  {
    id: 'calendar-todo-system-calendar',
    title: 'Open Android Calendar to-do creation UI',
    examplePrompts: ['定一个2026.6.7日晚上八点的待办事项，写上：该休息了'],
    workflowId: ANDROID_CALENDAR_TODO_WORKFLOW_ID,
    expectedOutput: 'handoff',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'system-intent-handoff', 'qa-cli-evidence'],
    toolIds: ['android:reminder.open_create_todo'],
    requiredUserGates: ['system calendar confirmation'],
    externalConfirmations: ['Android Calendar'],
    allowedScopes: ['Android Calendar insert UI'],
    rejectedCapabilities: ['calendar read permission', 'calendar write permission', 'background todo creation'],
    auditOperationKinds: ['calendar-todo-intent'],
    deviceEvidenceTaskIds: ['calendar-todo-handoff'],
    evidenceCommands: ['bun run test:android-device-task:evidence -- --device <serial>'],
  },
  {
    id: 'notification-settings-system-settings',
    title: 'Open Android app notification settings UI',
    examplePrompts: ['打开 IsleMind 的通知设置', '打开 Android 通知权限设置'],
    workflowId: ANDROID_NOTIFICATION_SETTINGS_WORKFLOW_ID,
    expectedOutput: 'handoff',
    permissionCeiling: 'read-write',
    entrySurfaces: ['skill-template', 'agent-workflow', 'android-tool-registry', 'mcp-orchestrated-tool-request', 'system-intent-handoff', 'qa-cli-evidence'],
    toolIds: ['android:notifications.open_settings'],
    requiredUserGates: ['Android system notification settings confirmation'],
    externalConfirmations: ['Android Settings'],
    allowedScopes: ['IsleMind app notification settings', 'Android promoted notification settings'],
    rejectedCapabilities: ['background notification grant', 'reliable background reply delivery'],
    auditOperationKinds: ['notification-settings-intent'],
    deviceEvidenceTaskIds: ['android-status-notification-evidence'],
    evidenceCommands: ['bun run test:android-status-notification:evidence -- --device <serial>'],
  },
]

export const ANDROID_CAPABILITY_BOUNDARY_CONTRACT: AndroidCapabilityBoundaryContract = {
  schema: ANDROID_CAPABILITY_BOUNDARY_SCHEMA,
  runtime: {
    primaryExecutor: 'islemind-android-app-runtime',
    cliRole: 'qa-and-evidence-only',
    mcpRole: 'orchestrated-tool-request-only',
    skillRole: 'user-approved-workflow-template',
    systemIntentRole: 'system intent request with visible fallback',
  },
  permissions: {
    allowedDeclaredPermissions: [...ANDROID_ALLOWED_DECLARED_PERMISSIONS],
    blockedSharedStoragePermissions: [...ANDROID_BLOCKED_SHARED_STORAGE_PERMISSIONS],
    forbiddenDeclaredPermissions: [...ANDROID_FORBIDDEN_DECLARED_PERMISSIONS],
    forbiddenRuntimeCapabilities: [
      'MANAGE_EXTERNAL_STORAGE',
      'silent APK install',
      'privileged package install or delete',
      'full phone cleaner',
      'arbitrary shared-storage delete',
      'exact alarm permission',
      'calendar read/write permission',
      'raw shell or filesystem path mutation',
    ],
  },
  audit: {
    eventName: ANDROID_OPERATION_AUDIT_EVENT,
    requiredRecordFields: [
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
    ],
  },
  tools: ANDROID_TOOL_BOUNDARIES,
  auxiliaryToolIds: [...ANDROID_AUXILIARY_TOOL_IDS],
  tasks: ANDROID_CAPABILITY_TASKS,
}
