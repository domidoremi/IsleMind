import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import {
  normalizeExternalToolExecutionResult,
  type ConversationToolCatalogManifest as ConversationToolManifest,
  type ExternalToolExecutionResult,
  type ExternalToolObservationErrorCode,
  type ExternalToolObservationStatus,
} from '@/modules/integrations'
import { clampTraceText, redactSensitiveText } from '@/core'
import { appendRuntimeLog, type RuntimeLogOptions } from '@/platform/native/runtimeLog'
import { createAndroidFileOperationsPort, type AndroidFileOperationReceipt, type AndroidNativeFileAction } from '@/platform/native/androidFileOperations'
import { isAllowedAndroidApkUri } from '@/platform/native/androidUriPolicy'
import type { TaskEffectRecorder } from '@/modules/tasks'
import type {
  AndroidStatusNotificationSettingsResult,
  AndroidStatusNotificationSettingsTarget,
} from '@/platform/native/androidStatusNotification'
import { st } from '@/i18n/service'
export type AndroidFileOperationAction = 'mkdir' | 'move' | 'copy' | 'rename'
export type AndroidFileConflictPolicy = 'skip' | 'rename'

export interface AndroidFileEntry {
  uri: string
  parentUri: string
  name: string
  mimeType?: string | null
  isDirectory: boolean
  depth: number
  size?: number
  lastModified?: number
}

export interface AndroidFileOperationManifest {
  id: string
  action: AndroidFileOperationAction
  sourceUri?: string
  sourceParentUri?: string
  sourceName?: string
  targetParentUri?: string
  targetDirectoryName?: string
  targetName?: string
  mimeType?: string
  conflictPolicy?: AndroidFileConflictPolicy
  requiresUserConfirmation: true
  createdAt: number
  reason?: string
}

interface NativeDocumentResult {
  ok: boolean
  status: 'created' | 'existing' | 'skipped' | string
  uri: string
  name?: string
  mimeType?: string
}

interface NativeOperationResult {
  ok: boolean
  action: AndroidFileOperationAction
  status: 'done' | 'skipped' | string
  reason?: string
  sourceUri?: string
  targetUri?: string | null
}

interface AndroidToolExecution {
  output: string
  status?: ExternalToolObservationStatus
  errorCode?: ExternalToolObservationErrorCode
  metadata?: Record<string, unknown>
}

export interface AndroidDeviceToolOptions {
  signal?: AbortSignal
  runtimeLog?: RuntimeLogOptions
  effects?: TaskEffectRecorder
  /** Host-owned wait scope, never taken from tool arguments or remote metadata. */
  withSystemPicker?: <T>(open: () => Promise<T>) => Promise<T>
  openStatusNotificationSettings?: (
    target: AndroidStatusNotificationSettingsTarget,
  ) => Promise<AndroidStatusNotificationSettingsResult>
}

interface AndroidOperationAudit {
  auditId: string
  toolId: string
  toolName: string
  source: ConversationToolManifest['source']
  permission: ConversationToolManifest['permission']
  operationKind: string
  status: ExternalToolObservationStatus
  ok: boolean
  startedAt: number
  completedAt: number
  durationMs: number
  scope: string
  confirmationState: string
  visibleActionRequired: boolean
  externalConfirmationRequired: boolean
  undoAvailable: boolean
  deleteSupported: boolean
  permanentDeleteSupported: boolean
  silentInstallSupported?: boolean
  fullPhoneCleanerSupported?: boolean
  userFilesDeleted?: boolean
  operationCount?: number
  appliedCount?: number
  skippedCount?: number
  deletedEntryCount?: number
  undoOperationCount?: number
  failureCount?: number
  partialFailure?: boolean
  failedOperationId?: string
  errorCode?: ExternalToolObservationErrorCode
  failureReason?: string
}

const fileOperations = createAndroidFileOperationsPort()
const APK_MIME_TYPE = 'application/vnd.android.package-archive'
const ANDROID_GRANT_READ_URI_PERMISSION = 1
const DEFAULT_SCAN_DEPTH = 1
const DEFAULT_SCAN_ENTRY_LIMIT = 300
// At most two native receipts per manifest (destination mkdir + operation).
// Keep the complete receipt list below the integration metadata node/array limits.
const MAX_OPERATION_COUNT = 32
const ANDROID_FILE_TOOL_METADATA = {
  androidOnly: true,
  allowedUriSchemes: ['content'],
  allowedUriScope: 'user-selected SAF tree',
  deleteSupported: false,
  permanentDeleteSupported: false,
  maxOperationsPerApply: MAX_OPERATION_COUNT,
}

export function listAndroidDeviceToolManifests(): ConversationToolManifest[] {
  const operationSchema = objectSchema({
    id: { type: 'string', minLength: 1, maxLength: 160 },
    action: { type: 'string', enum: ['mkdir', 'copy', 'move', 'rename'] },
    sourceUri: { type: 'string' },
    sourceParentUri: { type: 'string' },
    sourceName: { type: 'string' },
    targetParentUri: { type: 'string' },
    targetDirectoryName: { type: 'string' },
    targetName: { type: 'string' },
    mimeType: { type: 'string' },
    conflictPolicy: { type: 'string', enum: ['skip', 'rename'] },
    requiresUserConfirmation: { type: 'boolean', enum: [true] },
    createdAt: { type: 'number' },
    reason: { type: 'string' },
  }, ['id', 'action'])
  const manifests: ConversationToolManifest[] = [
    {
      id: 'android:files.request_directory_access',
      source: 'android',
      name: 'android.files.request_directory_access',
      description: 'Open the Android directory picker so the user can grant access to a specific folder such as Download.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        initialDirectory: { type: 'string', enum: ['downloads', 'root'] },
        initialUri: { type: 'string' },
      }),
      metadata: {
        ...ANDROID_FILE_TOOL_METADATA,
        requiresExternalConfirmation: true,
        opensSystemPicker: true,
      },
    },
    {
      id: 'android:files.scan',
      source: 'android',
      name: 'android.files.scan',
      description: 'List files and directories inside a user-authorized Android SAF directory.',
      permission: 'read-only',
      enabled: true,
      inputSchema: objectSchema({
        directoryUri: { type: 'string' },
        maxDepth: { type: 'integer', minimum: 0, maximum: 6 },
        maxEntries: { type: 'integer', minimum: 1, maximum: 1000 },
      }, ['directoryUri']),
      metadata: ANDROID_FILE_TOOL_METADATA,
    },
    {
      id: 'android:files.propose_structure',
      source: 'android',
      name: 'android.files.propose_structure',
      description: 'Create a read-only proposed folder structure for files in a user-authorized Android directory.',
      permission: 'read-only',
      enabled: true,
      inputSchema: objectSchema({
        directoryUri: { type: 'string' },
        maxEntries: { type: 'integer', minimum: 1, maximum: 1000 },
      }, ['directoryUri']),
      metadata: ANDROID_FILE_TOOL_METADATA,
    },
    {
      id: 'android:files.preview_operations',
      source: 'android',
      name: 'android.files.preview_operations',
      description: 'Generate a user-reviewable file operation manifest before Android directory changes are applied.',
      permission: 'read-only',
      enabled: true,
      inputSchema: objectSchema({
        mode: { type: 'string', enum: ['organize', 'copy', 'move', 'rename'] },
        directoryUri: { type: 'string' },
        sourceUri: { type: 'string' },
        sourceParentUri: { type: 'string' },
        sourceName: { type: 'string' },
        targetParentUri: { type: 'string' },
        targetDirectoryName: { type: 'string' },
        targetName: { type: 'string' },
        conflictPolicy: { type: 'string', enum: ['skip', 'rename'] },
        maxEntries: { type: 'integer', minimum: 1, maximum: 1000 },
      }),
      metadata: ANDROID_FILE_TOOL_METADATA,
    },
    {
      id: 'android:files.apply_operations',
      source: 'android',
      name: 'android.files.apply_operations',
      description: 'Apply confirmed Android SAF file operations. Pass full manifest objects returned by preview_operations, not operation IDs. Delete operations are refused.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        operations: { type: 'array', items: operationSchema, maxItems: MAX_OPERATION_COUNT },
      }, ['operations']),
      metadata: {
        ...ANDROID_FILE_TOOL_METADATA,
        requiresVisibleUserAction: true,
        refusesRawPaths: true,
      },
    },
    {
      id: 'android:files.undo_operations',
      source: 'android',
      name: 'android.files.undo_operations',
      description: 'Apply a confirmed undo manifest for reversible Android SAF move operations. Pass full undoOperations objects from the receipt, not operation IDs.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        undoOperations: { type: 'array', items: operationSchema, maxItems: MAX_OPERATION_COUNT },
      }, ['undoOperations']),
      metadata: {
        ...ANDROID_FILE_TOOL_METADATA,
        requiresVisibleUserAction: true,
        deleteSupported: false,
      },
    },
    {
      id: 'android:apk.inspect',
      source: 'android',
      name: 'android.apk.inspect',
      description: 'Inspect an APK URI before handing it to the Android package installer.',
      permission: 'read-only',
      enabled: true,
      inputSchema: objectSchema({ apkUri: { type: 'string' } }, ['apkUri']),
      metadata: { androidOnly: true, silentInstallSupported: false },
    },
    {
      id: 'android:apk.open_installer',
      source: 'android',
      name: 'android.apk.open_installer',
      description: 'Open the Android system package installer for an APK. The app cannot silently install packages.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({ apkUri: { type: 'string' } }, ['apkUri']),
      metadata: {
        androidOnly: true,
        requiresVisibleUserAction: true,
        requiresExternalConfirmation: true,
        silentInstallSupported: false,
      },
    },
    {
      id: 'android:storage.audit',
      source: 'android',
      name: 'android.storage.audit',
      description: 'Read Android disk and IsleMind app-cache storage signals without deleting files.',
      permission: 'read-only',
      enabled: true,
      metadata: { androidOnly: true, fullPhoneCleanerSupported: false },
    },
    {
      id: 'android:storage.propose_cleanup',
      source: 'android',
      name: 'android.storage.propose_cleanup',
      description: 'Suggest safe cleanup actions limited to IsleMind app cache and user-authorized directories.',
      permission: 'read-only',
      enabled: true,
      metadata: { androidOnly: true, fullPhoneCleanerSupported: false },
    },
    {
      id: 'android:storage.clear_app_cache',
      source: 'android',
      name: 'android.storage.clear_app_cache',
      description: 'Clear IsleMind app-owned cache files only. User files and shared storage are never deleted.',
      permission: 'read-write',
      enabled: true,
      metadata: {
        androidOnly: true,
        scope: 'app-cache-only',
        requiresVisibleUserAction: true,
        fullPhoneCleanerSupported: false,
      },
    },
    {
      id: 'android:alarm.open_create_intent',
      source: 'android',
      name: 'android.alarm.open_create_intent',
      description: 'Ask Android Clock to create an alarm directly when supported, falling back to the system editor when confirmation is required.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        minutes: { type: 'integer', minimum: 0, maximum: 59 },
        message: { type: 'string' },
      }, ['hour', 'minutes']),
      metadata: { androidOnly: true, directSystemIntentRequest: true, externalConfirmationMayBeRequired: true, exactAlarmPermissionRequired: false },
    },
    {
      id: 'android:calendar.open_create_event',
      source: 'android',
      name: 'android.calendar.open_create_event',
      description: 'Open the Android calendar UI to create an event or reminder entry.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        title: { type: 'string' },
        description: { type: 'string' },
        beginTimeMs: { type: 'number' },
        endTimeMs: { type: 'number' },
        beginTimeIso: { type: 'string' },
        endTimeIso: { type: 'string' },
      }, ['title']),
      metadata: { androidOnly: true, requiresExternalConfirmation: true, calendarPermissionRequired: false },
    },
    {
      id: 'android:reminder.open_create_todo',
      source: 'android',
      name: 'android.reminder.open_create_todo',
      description: 'Open a system calendar reminder entry for a to-do item.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        title: { type: 'string' },
        dueTimeMs: { type: 'number' },
        dueTimeIso: { type: 'string' },
        description: { type: 'string' },
      }, ['title']),
      metadata: { androidOnly: true, requiresExternalConfirmation: true, localReminderStoreAvailable: false },
    },
    {
      id: 'android:notifications.open_settings',
      source: 'android',
      name: 'android.notifications.open_settings',
      description: 'Open IsleMind notification-related Android system settings such as app notifications or promoted notification settings.',
      permission: 'read-write',
      enabled: true,
      inputSchema: objectSchema({
        target: { type: 'string', enum: ['notifications', 'promoted'] },
      }),
      metadata: { androidOnly: true, requiresExternalConfirmation: true, backgroundReliable: false },
    },
  ]
  const runtimeAvailable = Platform.OS === 'android'
  return manifests.map((manifest) => ({
    ...manifest,
    enabled: runtimeAvailable && manifest.enabled && (!requiresFileRuntime(manifest.name) || fileOperations.isAvailable()),
    metadata: {
      ...(manifest.metadata ?? {}),
      runtimeAvailable: runtimeAvailable && (!requiresFileRuntime(manifest.name) || fileOperations.isAvailable()),
    },
  }))
}

export async function executeAndroidDeviceTool(
  tool: ConversationToolManifest,
  args: Record<string, unknown> = {},
  options: AndroidDeviceToolOptions = {}
): Promise<ExternalToolExecutionResult> {
  const startedAt = Date.now()
  let result: ExternalToolExecutionResult
  try {
    throwIfAndroidToolCancelled(options.signal)
    const execution = await runAndroidTool(tool.name, args, options)
    throwIfAndroidToolCancelled(options.signal, execution.metadata)
    const status = execution.status ?? 'done'
    result = buildToolResult(tool, status === 'done', status, execution.output, startedAt, execution.metadata, execution.errorCode)
  } catch (error) {
    const failure = normalizeAndroidToolError(error)
    result = buildToolResult(tool, false, failure.status, failure.message, startedAt, failure.metadata, failure.errorCode)
  }
  recordAndroidOperationAudit(result, options.runtimeLog)
  return result
}

async function runAndroidTool(toolName: string, args: Record<string, unknown>, options: AndroidDeviceToolOptions = {}): Promise<AndroidToolExecution> {
  throwIfAndroidToolCancelled(options.signal)
  let execution: Promise<AndroidToolExecution>
  switch (toolName) {
    case 'android.files.request_directory_access':
      execution = requestDirectoryAccess(args, options)
      break
    case 'android.files.scan':
      execution = scanDirectoryTool(args, options)
      break
    case 'android.files.propose_structure':
      execution = proposeStructureTool(args, options)
      break
    case 'android.files.preview_operations':
      execution = previewOperationsTool(args, options)
      break
    case 'android.files.apply_operations':
      execution = applyOperationsTool(readOperationArray(args.operations, 'operations'), false, options)
      break
    case 'android.files.undo_operations':
      execution = applyOperationsTool(readOperationArray(args.undoOperations, 'undoOperations'), true, options)
      break
    case 'android.apk.inspect':
      execution = inspectApkTool(args)
      break
    case 'android.apk.open_installer':
      execution = openApkInstallerTool(args)
      break
    case 'android.storage.audit':
      execution = auditStorageTool()
      break
    case 'android.storage.propose_cleanup':
      execution = proposeCleanupTool()
      break
    case 'android.storage.clear_app_cache':
      execution = clearAppCacheTool(options)
      break
    case 'android.alarm.open_create_intent':
      execution = openAlarmTool(args)
      break
    case 'android.calendar.open_create_event':
      execution = openCalendarEventTool(args)
      break
    case 'android.reminder.open_create_todo':
      execution = openReminderTool(args)
      break
    case 'android.notifications.open_settings':
      execution = openNotificationSettingsTool(args, options.openStatusNotificationSettings)
      break
    default:
      throw androidToolError('tool_unavailable', `${toolName} is not an Android device tool.`, 'skipped')
  }
  const result = await execution
  throwIfAndroidToolCancelled(options.signal, result.metadata)
  return result
}

async function requestDirectoryAccess(args: Record<string, unknown>, options: AndroidDeviceToolOptions): Promise<AndroidToolExecution> {
  assertAndroid()
  const initialUri = typeof args.initialUri === 'string' && args.initialUri.trim()
    ? args.initialUri.trim()
    : args.initialDirectory === 'downloads'
      ? FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download')
      : undefined
  const open = () => FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri)
  const permission = await (options.withSystemPicker ? options.withSystemPicker(open) : open())
  if (!permission.granted) {
    throw androidToolError('permission_required', 'Directory access was not granted by the user.', 'skipped', {
      granted: false,
      requiresExternalConfirmation: true,
    })
  }
  return jsonExecution({
    granted: true,
    directoryUri: permission.directoryUri,
    scope: 'user-selected SAF directory',
  })
}

async function scanDirectoryTool(args: Record<string, unknown>, options: AndroidDeviceToolOptions): Promise<AndroidToolExecution> {
  assertAndroid()
  const directoryUri = requireSafUri(args.directoryUri, 'directoryUri')
  const scan = await scanAndroidDirectory(
    directoryUri,
    readInteger(args.maxDepth, DEFAULT_SCAN_DEPTH, 0, 6),
    readInteger(args.maxEntries, DEFAULT_SCAN_ENTRY_LIMIT, 1, 1000),
    options.signal
  )
  return jsonExecution(scan, {
    directoryUri,
    entryCount: scan.entries.length,
    truncated: scan.truncated,
  })
}

async function proposeStructureTool(args: Record<string, unknown>, options: AndroidDeviceToolOptions): Promise<AndroidToolExecution> {
  assertAndroid()
  const directoryUri = requireSafUri(args.directoryUri, 'directoryUri')
  const scan = await scanAndroidDirectory(directoryUri, 0, readInteger(args.maxEntries, DEFAULT_SCAN_ENTRY_LIMIT, 1, 1000), options.signal)
  const proposal = buildStructureProposal(directoryUri, scan.entries)
  return jsonExecution({
    directoryUri,
    directories: proposal.directories,
    fileCount: proposal.fileCount,
    skippedDirectoryCount: proposal.skippedDirectoryCount,
    operationPreview: proposal.operations,
  }, {
    directoryUri,
    proposedDirectoryCount: proposal.directories.length,
    proposedOperationCount: proposal.operations.length,
  })
}

async function previewOperationsTool(args: Record<string, unknown>, options: AndroidDeviceToolOptions): Promise<AndroidToolExecution> {
  assertAndroid()
  const mode = typeof args.mode === 'string' ? args.mode : 'organize'
  let operations: AndroidFileOperationManifest[]

  if (mode === 'organize') {
    const directoryUri = requireSafUri(args.directoryUri, 'directoryUri')
    const scan = await scanAndroidDirectory(directoryUri, 0, readInteger(args.maxEntries, DEFAULT_SCAN_ENTRY_LIMIT, 1, 1000), options.signal)
    operations = buildStructureProposal(directoryUri, scan.entries).operations
  } else if (mode === 'copy') {
    operations = [await buildDirectOperation('copy', args, options.signal)]
  } else if (mode === 'move') {
    operations = [await buildDirectOperation('move', args, options.signal)]
  } else if (mode === 'rename') {
    operations = [await buildDirectOperation('rename', args, options.signal)]
  } else {
    throw androidToolError('schema_invalid', `Unsupported preview mode: ${mode}.`)
  }

  return jsonExecution({
    mode,
    operationCount: operations.length,
    operations,
    confirmationRequired: operations.length > 0,
    maxOperationsPerApply: MAX_OPERATION_COUNT,
    deleteSupported: false,
  }, {
    mode,
    operationCount: operations.length,
    deleteSupported: false,
  })
}

async function applyOperationsTool(
  operations: AndroidFileOperationManifest[],
  undo = false,
  options: AndroidDeviceToolOptions = {}
): Promise<AndroidToolExecution> {
  assertAndroid()
  throwIfAndroidToolCancelled(options.signal)
  if (!operations.length) {
    return jsonExecution({ applied: 0, results: [], undoOperations: [] }, { applied: 0 })
  }
  if (!options.effects) throw androidToolError('evidence_insufficient', 'File writes require a Tasks-owned durable effect recorder.')
  const results: Array<NativeOperationResult & { operationId: string }> = []
  const undoOperations: AndroidFileOperationManifest[] = []
  const directoryCache = new Map<string, string>()
  const receipts: Array<AndroidFileOperationReceipt & { operationId: string }> = []
  const progress = () => ({
    replaySafe: receipts.every((receipt) => receipt.effect === 'none'),
    fileOperationReceipts: receipts.map(({ data: _data, ...receipt }) => receipt),
    ...buildApplyCancellationMetadata(undo, results, operations, undoOperations),
  })

  for (const operation of operations) {
    throwIfAndroidToolCancelled(options.signal, progress())
    const recordReceipt = async (receipt: AndroidFileOperationReceipt, admitted: boolean) => {
      receipts.push({ ...receipt, operationId: operation.id })
      if (admitted) await options.effects!.settle({ id: receipt.requestId,
        status: receipt.status === 'succeeded' && receipt.data?.status === 'skipped' ? 'skipped' : receipt.status, effect: receipt.effect,
        bytesCopied: receipt.bytesCopied, ...(receipt.targetUri ? { targetUri: receipt.targetUri } : {}),
        ...(receipt.completedSteps ? { completedSteps: receipt.completedSteps } : {}), ...(receipt.reason ? { reason: receipt.reason } : {}) })
      // Retain the just-completed effect, but do not dispatch more I/O when receipts grow large.
      if (JSON.stringify(progress().fileOperationReceipts).length > 24_000) {
        throw androidToolError('step_limit_reached', 'File receipt budget reached. Review recorded effects before continuing.')
      }
    }
    try {
      validateOperation(operation)
      if (operation.action === 'mkdir') {
        const parentUri = requireSafUri(operation.targetParentUri, 'targetParentUri')
        const directoryName = requireSafeDisplayName(operation.targetDirectoryName ?? operation.targetName, 'targetDirectoryName')
        const target = await ensureAndroidDirectory(parentUri, directoryName, directoryCache, options.signal, recordReceipt, options.effects)
        results.push({
          operationId: operation.id,
          ok: true,
          action: 'mkdir',
          status: target.status === 'existing' ? 'skipped' : 'done',
          reason: target.status,
          sourceUri: parentUri,
          targetUri: target.uri,
        })
        throwIfAndroidToolCancelled(options.signal, progress())
        continue
      }

      if (operation.action === 'copy') {
        const targetParentUri = await resolveOperationTargetParent(operation, directoryCache, options.signal, recordReceipt, options.effects)
        const result = await executeFileOperation('copy', {
          sourceUri: requireSafUri(operation.sourceUri, 'sourceUri'),
          targetParentUri,
          targetName: requireSafeDisplayName(operation.targetName, 'targetName'),
          mimeType: operation.mimeType ?? inferMimeType(operation.targetName ?? operation.sourceName ?? ''),
          conflictPolicy: normalizeConflictPolicy(operation.conflictPolicy),
        }, options.signal, recordReceipt, options.effects) as unknown as NativeOperationResult
        results.push({ ...result, operationId: operation.id })
        if (!result.ok) throw androidToolError('policy_denied', 'File operation was skipped; dependent operations were not dispatched.', 'skipped')
        throwIfAndroidToolCancelled(options.signal, progress())
        continue
      }

      if (operation.action === 'move') {
        const sourceUri = requireSafUri(operation.sourceUri, 'sourceUri')
        const sourceParentUri = requireSafUri(operation.sourceParentUri, 'sourceParentUri')
        const targetParentUri = await resolveOperationTargetParent(operation, directoryCache, options.signal, recordReceipt, options.effects)
        const targetName = requireSafeDisplayName(operation.targetName ?? operation.sourceName, 'targetName')
        const result = await executeFileOperation('move', {
          sourceUri,
          sourceParentUri,
          targetParentUri,
          targetName,
          conflictPolicy: normalizeConflictPolicy(operation.conflictPolicy),
        }, options.signal, recordReceipt, options.effects) as unknown as NativeOperationResult
        results.push({ ...result, operationId: operation.id })
        if (!result.ok) throw androidToolError('policy_denied', 'File operation was skipped; dependent operations were not dispatched.', 'skipped')
        if (result.ok && result.targetUri) {
          undoOperations.push({
            id: `undo-${operation.id}`,
            action: 'move',
            sourceUri: result.targetUri,
            sourceParentUri: targetParentUri,
            sourceName: targetName,
            targetParentUri: sourceParentUri,
            targetName: requireSafeDisplayName(operation.sourceName ?? targetName, 'sourceName'),
            conflictPolicy: 'rename',
            requiresUserConfirmation: true,
            createdAt: Date.now(),
            reason: `Undo move from ${operation.id}.`,
          })
        }
        throwIfAndroidToolCancelled(options.signal, progress())
        continue
      }

      if (operation.action === 'rename') {
        const result = await executeFileOperation('rename', {
          sourceUri: requireSafUri(operation.sourceUri, 'sourceUri'),
          targetName: requireSafeDisplayName(operation.targetName, 'targetName'),
        }, options.signal, recordReceipt, options.effects) as unknown as NativeOperationResult
        results.push({ ...result, operationId: operation.id })
        if (!result.ok) throw androidToolError('policy_denied', 'File operation was skipped; dependent operations were not dispatched.', 'skipped')
        throwIfAndroidToolCancelled(options.signal, progress())
        continue
      }
    } catch (error) {
      const failure = normalizeAndroidToolError(error)
      // Even the first call can create a partial file or a directory before failing.
      const metadata = { ...failure.metadata, ...progress(), failedOperationId: operation.id,
        partialFailure: receipts.some((receipt) => receipt.effect !== 'none'), failureCount: 1 }
      throw androidToolError(failure.errorCode, failure.message, failure.status, metadata)
    }
  }

  const applied = results.filter((result) => result.status === 'done').length
  const execution = jsonExecution({
    mode: undo ? 'undo' : 'apply',
    applied,
    skipped: results.filter((result) => result.status !== 'done').length,
    results,
    undoOperations,
    deleteSupported: false,
  }, {
    ...progress(),
    mode: undo ? 'undo' : 'apply',
    applied,
    skipped: results.filter((result) => result.status !== 'done').length,
    undoOperationCount: undoOperations.length,
    deleteSupported: false,
  })
  if (results.some((result) => !result.ok)) {
    execution.status = 'skipped'
    execution.errorCode = 'policy_denied'
  }
  return execution
}

async function inspectApkTool(args: Record<string, unknown>): Promise<AndroidToolExecution> {
  const apkUri = requireAndroidUri(args.apkUri, 'apkUri')
  if (!looksLikeApkUri(apkUri)) {
    throw androidToolError('schema_invalid', 'apkUri must point to an .apk file or Android content URI.')
  }
  const info = await FileSystem.getInfoAsync(apkUri)
  return jsonExecution({
    apkUri,
    exists: info.exists,
    size: info.exists ? info.size : undefined,
    canOpenInstaller: Platform.OS === 'android' && info.exists,
    silentInstallSupported: false,
  }, {
    apkUri,
    exists: info.exists,
    size: info.exists ? info.size : undefined,
    silentInstallSupported: false,
  })
}

async function openApkInstallerTool(args: Record<string, unknown>): Promise<AndroidToolExecution> {
  assertAndroid()
  const apkUri = requireAndroidUri(args.apkUri, 'apkUri')
  if (!looksLikeApkUri(apkUri)) {
    throw androidToolError('schema_invalid', 'apkUri must point to an .apk file or Android content URI.')
  }
  const contentUri = apkUri.startsWith('file://') ? await FileSystem.getContentUriAsync(apkUri) : apkUri
  const launchMetadata = await launchAndroidIntentWithFallback([
    {
      action: 'android.intent.action.INSTALL_PACKAGE',
      params: {
        data: contentUri,
        type: APK_MIME_TYPE,
        flags: ANDROID_GRANT_READ_URI_PERMISSION,
      },
      label: 'install-package',
    },
    {
      action: 'android.intent.action.VIEW',
      params: {
        data: contentUri,
        type: APK_MIME_TYPE,
        flags: ANDROID_GRANT_READ_URI_PERMISSION,
      },
      label: 'view-package-archive',
    },
  ], 'Android package installer could not be opened for this APK URI.')
  return jsonExecution({
    installerOpened: true,
    apkUri,
    contentUri,
    silentInstallSupported: false,
    confirmation: 'Android package installer requires user confirmation.',
    launchAttempt: launchMetadata.attempt,
  }, {
    installerOpened: true,
    requiresExternalConfirmation: true,
    silentInstallSupported: false,
    launchAttempt: launchMetadata.attempt,
  })
}

async function auditStorageTool(): Promise<AndroidToolExecution> {
  assertAndroid()
  const [freeBytes, totalBytes, cacheEntries] = await Promise.all([
    safeNumber(() => FileSystem.getFreeDiskStorageAsync()),
    safeNumber(() => FileSystem.getTotalDiskCapacityAsync()),
    listAppCacheEntries(),
  ])
  return jsonExecution({
    freeBytes,
    totalBytes,
    freeText: formatBytes(freeBytes),
    totalText: formatBytes(totalBytes),
    cacheDirectory: FileSystem.cacheDirectory,
    appCacheEntryCount: cacheEntries.length,
    fullPhoneCleanerSupported: false,
    allowedCleanupScopes: ['app-cache', 'user-authorized-directory-preview'],
  }, {
    freeBytes,
    totalBytes,
    appCacheEntryCount: cacheEntries.length,
    fullPhoneCleanerSupported: false,
  })
}

async function proposeCleanupTool(): Promise<AndroidToolExecution> {
  assertAndroid()
  const cacheEntries = await listAppCacheEntries()
  return jsonExecution({
    candidates: [
      {
        id: 'app-cache',
        scope: 'app-cache',
        title: 'Clear IsleMind app cache',
        entryCount: cacheEntries.length,
        requiresConfirmation: true,
        deletesUserFiles: false,
      },
    ],
    unsupportedScopes: ['full-phone-cleaner', 'arbitrary-shared-storage-delete'],
    fullPhoneCleanerSupported: false,
  }, {
    candidateCount: 1,
    fullPhoneCleanerSupported: false,
  })
}

async function clearAppCacheTool(options: AndroidDeviceToolOptions = {}): Promise<AndroidToolExecution> {
  assertAndroid()
  throwIfAndroidToolCancelled(options.signal, { scope: 'app-cache', userFilesDeleted: false })
  const cacheDirectory = FileSystem.cacheDirectory
  if (!cacheDirectory) {
    throw androidToolError('tool_unavailable', 'IsleMind app cache directory is unavailable.', 'skipped')
  }
  const entries = await listAppCacheEntries()
  let deleted = 0
  const failures: string[] = []
  for (const name of entries) {
    throwIfAndroidToolCancelled(options.signal, {
      scope: 'app-cache',
      deletedEntryCount: deleted,
      failureCount: failures.length,
      userFilesDeleted: false,
    })
    try {
      const entryUri = appCacheEntryUri(cacheDirectory, name)
      if (!entryUri) {
        failures.push(`${name}: refused non-child cache entry`)
        continue
      }
      await FileSystem.deleteAsync(entryUri, { idempotent: true })
      deleted += 1
    } catch (error) {
      failures.push(`${name}: ${errorMessageFrom(error)}`)
    }
    throwIfAndroidToolCancelled(options.signal, {
      scope: 'app-cache',
      deletedEntryCount: deleted,
      failureCount: failures.length,
      userFilesDeleted: false,
    })
  }
  return jsonExecution({
    scope: 'app-cache',
    deletedEntryCount: deleted,
    failureCount: failures.length,
    failures,
    userFilesDeleted: false,
  }, {
    scope: 'app-cache',
    deletedEntryCount: deleted,
    failureCount: failures.length,
    userFilesDeleted: false,
  })
}

async function openAlarmTool(args: Record<string, unknown>): Promise<AndroidToolExecution> {
  assertAndroid()
  const hour = readInteger(args.hour, -1, 0, 23)
  const minutes = readInteger(args.minutes, -1, 0, 59)
  if (hour < 0 || minutes < 0) throw androidToolError('schema_invalid', 'hour and minutes are required.')
  const alarmMessage = typeof args.message === 'string' && args.message.trim() ? args.message.trim() : undefined
  const alarmBaseExtras = {
    'android.intent.extra.alarm.HOUR': hour,
    'android.intent.extra.alarm.MINUTES': minutes,
    'android.intent.extra.alarm.MESSAGE': alarmMessage ?? '',
  }
  const directAlarmExtras = {
    ...alarmBaseExtras,
    'android.intent.extra.alarm.SKIP_UI': true,
  }
  const editorAlarmExtras = {
    ...alarmBaseExtras,
    'android.intent.extra.alarm.SKIP_UI': false,
  }
  const launchMetadata = await launchAndroidIntentWithFallback([
    {
      action: 'android.intent.action.SET_ALARM',
      params: {
        packageName: 'com.android.deskclock',
        extra: directAlarmExtras,
      },
      label: 'set-alarm-direct-deskclock',
    },
    {
      action: 'android.intent.action.SET_ALARM',
      params: {
        packageName: 'com.google.android.deskclock',
        extra: directAlarmExtras,
      },
      label: 'set-alarm-direct-google-clock',
    },
    {
      action: 'android.intent.action.SET_ALARM',
      params: {
        extra: directAlarmExtras,
      },
      label: 'set-alarm-direct',
    },
    {
      action: 'android.intent.action.SET_ALARM',
      params: {
        packageName: 'com.android.deskclock',
        extra: editorAlarmExtras,
      },
      label: 'set-alarm-editor-deskclock',
    },
    {
      action: 'android.intent.action.SET_ALARM',
      params: {
        packageName: 'com.google.android.deskclock',
        extra: editorAlarmExtras,
      },
      label: 'set-alarm-editor-google-clock',
    },
    {
      action: 'android.intent.action.SET_ALARM',
      params: {
        extra: editorAlarmExtras,
      },
      label: 'set-alarm-editor',
    },
    {
      action: 'android.intent.action.SHOW_ALARMS',
      label: 'show-alarms',
    },
    {
      action: 'android.intent.action.MAIN',
      params: {
        category: 'android.intent.category.APP_ALARM',
      },
      label: 'app-alarm',
    },
    {
      action: 'android.intent.action.MAIN',
      params: {
        category: 'android.intent.category.LAUNCHER',
        packageName: 'com.android.deskclock',
      },
      label: 'deskclock-launcher',
    },
  ], 'Android Clock could not be opened for alarm creation.')
  const directRequest = launchMetadata.attempt.startsWith('set-alarm-direct')
  const requiresExternalConfirmation = !directRequest
  const payload = {
    requestSent: true,
    opened: requiresExternalConfirmation,
    target: 'alarm',
    hour,
    minutes,
    message: alarmMessage,
    skipUiRequested: directRequest,
    directSystemIntentRequest: directRequest,
    externalConfirmationMayBeRequired: directRequest,
    requiresExternalConfirmation,
    exactAlarmPermissionRequired: false,
    launchAttempt: launchMetadata.attempt,
  }
  return visibleAndroidIntentExecution(
    directRequest
      ? formatAlarmCreationRequestedOutput(hour, minutes, alarmMessage)
      : formatAlarmIntentOpenedOutput(hour, minutes, alarmMessage),
    payload,
    {
      target: 'alarm',
      requiresExternalConfirmation,
      externalConfirmationMayBeRequired: directRequest,
      skipUiRequested: directRequest,
      launchAttempt: launchMetadata.attempt,
    }
  )
}

async function openCalendarEventTool(args: Record<string, unknown>): Promise<AndroidToolExecution> {
  assertAndroid()
  const title = requireNonEmptyString(args.title, 'title')
  const beginTimeMs = readTimestamp(args.beginTimeMs, args.beginTimeIso, Date.now())
  const endTimeMs = readTimestamp(args.endTimeMs, args.endTimeIso, beginTimeMs + 30 * 60 * 1000)
  const normalizedEndTimeMs = Math.max(beginTimeMs, endTimeMs)
  const launchMetadata = await launchAndroidIntentWithFallback([
    {
      action: 'android.intent.action.INSERT',
      params: {
        data: 'content://com.android.calendar/events',
        type: 'vnd.android.cursor.item/event',
        extra: {
          title,
          description: typeof args.description === 'string' ? args.description : '',
          beginTime: beginTimeMs,
          endTime: normalizedEndTimeMs,
        },
      },
      label: 'calendar-insert',
    },
    {
      action: 'android.intent.action.EDIT',
      params: {
        data: 'content://com.android.calendar/events',
        type: 'vnd.android.cursor.item/event',
        extra: {
          title,
          description: typeof args.description === 'string' ? args.description : '',
          beginTime: beginTimeMs,
          endTime: normalizedEndTimeMs,
        },
      },
      label: 'calendar-edit',
    },
  ], 'Android Calendar could not be opened for event creation.')
  const payload = {
    opened: true,
    target: 'calendar-event',
    title,
    beginTimeMs,
    endTimeMs: normalizedEndTimeMs,
    calendarPermissionRequired: false,
    launchAttempt: launchMetadata.attempt,
  }
  return visibleAndroidIntentExecution(formatCalendarEventIntentOpenedOutput(title, beginTimeMs, args.beginTimeIso), payload, {
    target: 'calendar-event',
    requiresExternalConfirmation: true,
    launchAttempt: launchMetadata.attempt,
  })
}

async function openReminderTool(args: Record<string, unknown>): Promise<AndroidToolExecution> {
  assertAndroid()
  const title = requireNonEmptyString(args.title, 'title')
  const dueTimeMs = readTimestamp(args.dueTimeMs, args.dueTimeIso, Date.now())
  const endTimeMs = dueTimeMs + 15 * 60 * 1000
  const launchMetadata = await launchAndroidIntentWithFallback([
    {
      action: 'android.intent.action.INSERT',
      params: {
        data: 'content://com.android.calendar/events',
        type: 'vnd.android.cursor.item/event',
        extra: {
          title,
          description: typeof args.description === 'string' ? args.description : '',
          beginTime: dueTimeMs,
          endTime: endTimeMs,
        },
      },
      label: 'calendar-todo-insert',
    },
    {
      action: 'android.intent.action.EDIT',
      params: {
        data: 'content://com.android.calendar/events',
        type: 'vnd.android.cursor.item/event',
        extra: {
          title,
          description: typeof args.description === 'string' ? args.description : '',
          beginTime: dueTimeMs,
          endTime: endTimeMs,
        },
      },
      label: 'calendar-todo-edit',
    },
  ], 'Android Calendar could not be opened for to-do creation.')
  const payload = {
    opened: true,
    target: 'calendar-todo',
    title,
    dueTimeMs,
    endTimeMs,
    calendarPermissionRequired: false,
    localReminderStoreAvailable: false,
    launchAttempt: launchMetadata.attempt,
  }
  return visibleAndroidIntentExecution(formatReminderIntentOpenedOutput(title, dueTimeMs, args.dueTimeIso), payload, {
    target: 'calendar-todo',
    requiresExternalConfirmation: true,
    calendarPermissionRequired: false,
    localReminderStoreAvailable: false,
    launchAttempt: launchMetadata.attempt,
  })
}

async function openNotificationSettingsTool(
  args: Record<string, unknown>,
  openSettings: AndroidDeviceToolOptions['openStatusNotificationSettings'],
): Promise<AndroidToolExecution> {
  assertAndroid()
  const target: AndroidStatusNotificationSettingsTarget = args.target === 'promoted' ? 'promoted' : 'notifications'
  if (!openSettings) {
    throw androidToolError(
      'tool_unavailable',
      'Android notification settings are not bound to the task runtime.',
      'skipped',
      { target, requiresExternalConfirmation: true, backgroundReliable: false },
    )
  }
  const result = await openSettings(target)
  if (!result.opened) {
    const message = target === 'promoted' && result.reason === 'unsupported_api'
      ? 'Promoted notification settings are unavailable on this Android version.'
      : result.errorMessage || `Android notification settings could not be opened (${result.reason}).`
    throw androidToolError(result.reason === 'failed' ? 'execution_failed' : 'tool_unavailable', message, 'skipped', {
      target,
      requiresExternalConfirmation: true,
      backgroundReliable: false,
      settingsReason: result.reason,
    })
  }
  return jsonExecution({
    opened: true,
    target,
    backgroundReliable: false,
    reason: result.reason,
  }, {
    target,
    requiresExternalConfirmation: true,
    backgroundReliable: false,
    settingsReason: result.reason,
  })
}

interface AndroidIntentLaunchAttempt {
  action: string
  params?: IntentLauncher.IntentLauncherParams
  label: string
}

async function launchAndroidIntentWithFallback(
  attempts: AndroidIntentLaunchAttempt[],
  failureMessage: string
): Promise<{ attempt: string }> {
  const errors: string[] = []
  for (const attempt of attempts) {
    try {
      await IntentLauncher.startActivityAsync(attempt.action, attempt.params)
      return { attempt: attempt.label }
    } catch (error) {
      errors.push(`${attempt.label}: ${errorMessageFrom(error)}`)
    }
  }
  throw androidToolError('tool_unavailable', `${failureMessage} ${errors.join(' | ')}`.trim(), 'skipped', {
    intentAttempts: attempts.map((attempt) => attempt.label),
    intentErrors: errors,
  })
}

function requiresFileRuntime(name: string): boolean {
  return name.startsWith('android.files.') && name !== 'android.files.request_directory_access'
}

async function executeFileOperation(
  action: AndroidNativeFileAction, input: Record<string, unknown>, signal?: AbortSignal,
  recordReceipt?: (receipt: AndroidFileOperationReceipt, admitted: boolean) => void | Promise<void>, effects?: TaskEffectRecorder,
): Promise<Record<string, unknown>> {
  let admitted = false
  const beforeDispatch = action === 'scan' ? undefined : async (id: string) => {
    if (!effects) throw new Error('File effect recorder is unavailable')
    await effects.begin({ id, kind: 'file', action,
      ...(typeof input.sourceUri === 'string' ? { sourceUri: input.sourceUri } : {}),
      ...(typeof input.sourceParentUri === 'string' ? { sourceParentUri: input.sourceParentUri } : {}),
      ...(typeof (input.targetParentUri ?? input.parentUri) === 'string' ? { targetParentUri: (input.targetParentUri ?? input.parentUri) as string } : {}),
      ...(typeof (input.targetName ?? input.directoryName) === 'string' ? { targetName: (input.targetName ?? input.directoryName) as string } : {}),
    })
    admitted = true
  }
  const receipt = beforeDispatch ? await fileOperations.execute(action, input, signal, beforeDispatch) : await fileOperations.execute(action, input, signal)
  await recordReceipt?.(receipt, admitted)
  if (receipt.status !== 'succeeded') {
    const code = receipt.status === 'cancelled' ? 'cancelled'
      : receipt.reason === 'permission_required' ? 'permission_required'
        : receipt.reason === 'unavailable' ? 'tool_unavailable' : 'execution_failed'
    throw androidToolError(code, 'Android file operation ' + receipt.status + ': ' + receipt.reason
      + (receipt.effect !== 'none' ? '. Changes may already exist; inspect the receipt before retrying.' : ''),
    receipt.status === 'cancelled' || receipt.reason === 'unavailable' ? 'skipped' : 'error', {
      fileOperationReceipts: [receipt], status: receipt.status, replaySafe: receipt.effect === 'none',
    })
  }
  return receipt.data!
}

async function scanAndroidDirectory(directoryUri: string, maxDepth: number, maxEntries: number, signal?: AbortSignal): Promise<{
  directoryUri: string
  entries: AndroidFileEntry[]
  truncated: boolean
}> {
  const result = await executeFileOperation('scan', { directoryUri, maxDepth, maxEntries }, signal)
  return { directoryUri: result.directoryUri as string,
    entries: normalizeEntries(result.entries as AndroidFileEntry[], directoryUri), truncated: Boolean(result.truncated) }
}

async function ensureAndroidDirectory(
  parentUri: string, directoryName: string, cache: Map<string, string>, signal?: AbortSignal,
  recordReceipt?: (receipt: AndroidFileOperationReceipt, admitted: boolean) => void | Promise<void>, effects?: TaskEffectRecorder,
): Promise<NativeDocumentResult> {
  throwIfAndroidToolCancelled(signal)
  const key = parentUri + '\n' + directoryName
  const cached = cache.get(key)
  if (cached) return { ok: true, status: 'existing', uri: cached, name: directoryName }
  const result = await executeFileOperation('mkdir', { parentUri, directoryName }, signal, recordReceipt, effects) as unknown as NativeDocumentResult
  cache.set(key, result.uri)
  return result
}

async function resolveOperationTargetParent(
  operation: AndroidFileOperationManifest, cache: Map<string, string>, signal?: AbortSignal,
  recordReceipt?: (receipt: AndroidFileOperationReceipt, admitted: boolean) => void | Promise<void>, effects?: TaskEffectRecorder,
): Promise<string> {
  const parentUri = requireSafUri(operation.targetParentUri, 'targetParentUri')
  if (!operation.targetDirectoryName) return parentUri
  const directory = await ensureAndroidDirectory(parentUri, requireSafeDisplayName(operation.targetDirectoryName, 'targetDirectoryName'), cache, signal, recordReceipt, effects)
  return directory.uri
}

function buildStructureProposal(directoryUri: string, entries: AndroidFileEntry[]): {
  directories: Array<{ name: string; fileCount: number; reason: string }>
  operations: AndroidFileOperationManifest[]
  fileCount: number
  skippedDirectoryCount: number
} {
  const rootEntries = entries.filter((entry) => entry.parentUri === directoryUri || entry.depth === 0)
  const existingDirs = new Set(rootEntries.filter((entry) => entry.isDirectory).map((entry) => entry.name))
  const files = rootEntries.filter((entry) => !entry.isDirectory)
  const buckets = new Map<string, AndroidFileEntry[]>()
  for (const file of files) {
    const category = categoryForFile(file)
    if (!buckets.has(category)) buckets.set(category, [])
    buckets.get(category)?.push(file)
  }

  const now = Date.now()
  const operations: AndroidFileOperationManifest[] = []
  const directories = Array.from(buckets.entries()).map(([name, bucket]) => ({
    name,
    fileCount: bucket.length,
    reason: `Group ${bucket.length} ${bucket.length === 1 ? 'file' : 'files'} by type.`,
  }))
  for (const directory of directories) {
    if (!existingDirs.has(directory.name)) {
      operations.push({
        id: operationId('mkdir', directoryUri, directory.name, now),
        action: 'mkdir',
        targetParentUri: directoryUri,
        targetDirectoryName: directory.name,
        conflictPolicy: 'skip',
        requiresUserConfirmation: true,
        createdAt: now,
        reason: directory.reason,
      })
    }
  }
  for (const [directoryName, bucket] of buckets.entries()) {
    for (const file of bucket) {
      operations.push({
        id: operationId('move', file.uri, directoryName, now),
        action: 'move',
        sourceUri: file.uri,
        sourceParentUri: file.parentUri,
        sourceName: file.name,
        targetParentUri: directoryUri,
        targetDirectoryName: directoryName,
        targetName: file.name,
        mimeType: file.mimeType ?? inferMimeType(file.name),
        conflictPolicy: 'rename',
        requiresUserConfirmation: true,
        createdAt: now,
        reason: `Move ${file.name} to ${directoryName}.`,
      })
    }
  }
  return {
    directories,
    operations,
    fileCount: files.length,
    skippedDirectoryCount: rootEntries.length - files.length,
  }
}

async function buildDirectOperation(action: AndroidFileOperationAction, args: Record<string, unknown>, signal?: AbortSignal): Promise<AndroidFileOperationManifest> {
  const now = Date.now()
  const directoryUri = typeof args.directoryUri === 'string' && args.directoryUri.trim()
    ? requireSafUri(args.directoryUri, 'directoryUri')
    : undefined
  const requestedSourceName = typeof args.sourceName === 'string'
    ? requireSafeDisplayName(args.sourceName, 'sourceName')
    : undefined
  const sourceEntry = action !== 'mkdir' && typeof args.sourceUri !== 'string' && directoryUri && requestedSourceName
    ? await findFileEntryByName(directoryUri, requestedSourceName, readInteger(args.maxEntries, DEFAULT_SCAN_ENTRY_LIMIT, 1, 1000), signal)
    : undefined
  const sourceUri = action === 'mkdir'
    ? undefined
    : requireSafUri(typeof args.sourceUri === 'string' ? args.sourceUri : sourceEntry?.uri, 'sourceUri')
  return {
    id: operationId(action, sourceUri ?? String(args.targetParentUri ?? ''), String(args.targetName ?? args.targetDirectoryName ?? ''), now),
    action,
    sourceUri,
    sourceParentUri: typeof args.sourceParentUri === 'string'
      ? requireSafUri(args.sourceParentUri, 'sourceParentUri')
      : sourceEntry?.parentUri ?? (action === 'move' ? directoryUri : undefined),
    sourceName: requestedSourceName ?? sourceEntry?.name ?? (sourceUri ? displayNameFromSafUri(sourceUri) : undefined),
    targetParentUri: action === 'rename'
      ? undefined
      : requireSafUri(typeof args.targetParentUri === 'string' ? args.targetParentUri : directoryUri, 'targetParentUri'),
    targetDirectoryName: typeof args.targetDirectoryName === 'string' ? requireSafeDisplayName(args.targetDirectoryName, 'targetDirectoryName') : undefined,
    targetName: action === 'mkdir'
      ? requireSafeDisplayName(args.targetDirectoryName ?? args.targetName, 'targetDirectoryName')
      : requireSafeDisplayName(args.targetName, 'targetName'),
    mimeType: typeof args.mimeType === 'string' ? args.mimeType : undefined,
    conflictPolicy: normalizeConflictPolicy(args.conflictPolicy),
    requiresUserConfirmation: true,
    createdAt: now,
  }
}

async function findFileEntryByName(directoryUri: string, sourceName: string, maxEntries: number, signal?: AbortSignal): Promise<AndroidFileEntry> {
  const scan = await scanAndroidDirectory(directoryUri, 1, maxEntries, signal)
  const matches = scan.entries.filter((entry) => !entry.isDirectory && entry.name === sourceName)
  if (!matches.length) {
    throw androidToolError('schema_invalid', `sourceName ${sourceName} was not found in the selected SAF directory.`)
  }
  if (matches.length > 1) {
    throw androidToolError('schema_invalid', `sourceName ${sourceName} matched multiple files; provide sourceUri.`)
  }
  return matches[0]
}

function validateOperation(operation: AndroidFileOperationManifest): void {
  if (!operation || typeof operation !== 'object') throw androidToolError('schema_invalid', 'Each operation must be an object.')
  if (typeof operation.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(operation.id)) {
    throw androidToolError('schema_invalid', 'Each operation needs a bounded, stable operation id.')
  }
  if (!['mkdir', 'move', 'copy', 'rename'].includes(operation.action)) {
    throw androidToolError('policy_denied', `Operation ${String((operation as { action?: unknown }).action)} is not allowed.`)
  }
  if ((operation as { delete?: unknown }).delete || (operation as { destructive?: unknown }).destructive) {
    throw androidToolError('policy_denied', 'Delete and destructive file operations are not supported by Android device tools.')
  }
  if (operation.action !== 'mkdir') requireSafUri(operation.sourceUri, 'sourceUri')
  if (operation.action === 'mkdir') {
    requireSafUri(operation.targetParentUri, 'targetParentUri')
    requireSafeDisplayName(operation.targetDirectoryName ?? operation.targetName, 'targetDirectoryName')
  }
  if (operation.targetName) requireSafeDisplayName(operation.targetName, 'targetName')
  if (operation.targetDirectoryName) requireSafeDisplayName(operation.targetDirectoryName, 'targetDirectoryName')
  if (operation.sourceUri) requireSafUri(operation.sourceUri, 'sourceUri')
  if (operation.sourceParentUri) requireSafUri(operation.sourceParentUri, 'sourceParentUri')
  if (operation.targetParentUri) requireSafUri(operation.targetParentUri, 'targetParentUri')
  if (operation.action === 'move' && !operation.sourceParentUri) {
    throw androidToolError('schema_invalid', 'move operations require sourceParentUri.')
  }
  if ((operation.action === 'move' || operation.action === 'copy') && !operation.targetParentUri) {
    throw androidToolError('schema_invalid', `${operation.action} operations require targetParentUri.`)
  }
  if ((operation.action === 'move' || operation.action === 'copy' || operation.action === 'rename') && !operation.targetName) {
    throw androidToolError('schema_invalid', `${operation.action} operations require targetName.`)
  }
}

function readOperationArray(value: unknown, label: string): AndroidFileOperationManifest[] {
  if (!Array.isArray(value)) throw androidToolError('schema_invalid', `${label} must be an array.`)
  if (value.length > MAX_OPERATION_COUNT) throw androidToolError('policy_denied', `At most ${MAX_OPERATION_COUNT} operations can run at once.`)
  const ids = new Set<string>()
  return value.map((item) => {
    const operation = { ...item } as AndroidFileOperationManifest
    validateOperation(operation)
    if (ids.has(operation.id)) throw androidToolError('schema_invalid', 'Operation ids must be unique within a batch.')
    ids.add(operation.id)
    return operation
  })
}

function normalizeEntries(entries: AndroidFileEntry[], fallbackParentUri: string): AndroidFileEntry[] {
  return Array.isArray(entries)
    ? entries.map((entry) => ({
        uri: String(entry.uri ?? ''),
        parentUri: String(entry.parentUri ?? fallbackParentUri),
        name: typeof entry.name === 'string' && entry.name ? entry.name : displayNameFromSafUri(String(entry.uri ?? '')),
        mimeType: typeof entry.mimeType === 'string' ? entry.mimeType : null,
        isDirectory: Boolean(entry.isDirectory),
        depth: Number.isInteger(entry.depth) ? entry.depth : 0,
        size: typeof entry.size === 'number' ? entry.size : undefined,
        lastModified: typeof entry.lastModified === 'number' ? entry.lastModified : undefined,
      }))
    : []
}

function categoryForFile(file: AndroidFileEntry): string {
  const name = file.name.toLowerCase()
  const mime = (file.mimeType ?? '').toLowerCase()
  if (name.endsWith('.apk') || mime.includes('package-archive')) return 'APKs'
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|heic)$/i.test(name)) return 'Images'
  if (mime.startsWith('video/') || /\.(mp4|mkv|webm|mov|avi)$/i.test(name)) return 'Videos'
  if (mime.startsWith('audio/') || /\.(mp3|wav|flac|m4a|ogg)$/i.test(name)) return 'Audio'
  if (/\.(zip|7z|rar|tar|gz|xz)$/i.test(name)) return 'Archives'
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|md|rtf|epub)$/i.test(name)) return 'Documents'
  if (/\.(js|ts|tsx|jsx|json|xml|html|css|kt|java|py|go|rs|c|cpp|h)$/i.test(name)) return 'Code'
  if (/\.(csv|db|sqlite|parquet|yaml|yml|toml)$/i.test(name)) return 'Data'
  return 'Other'
}

function inferMimeType(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.apk')) return APK_MIME_TYPE
  if (/\.(png)$/i.test(lower)) return 'image/png'
  if (/\.(jpe?g)$/i.test(lower)) return 'image/jpeg'
  return 'application/octet-stream'
}

function objectSchema(properties: Record<string, Record<string, unknown>>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required }
}

function assertAndroid(): void {
  if (Platform.OS !== 'android') {
    throw androidToolError('tool_unavailable', 'Android device tools are available only on Android.', 'skipped', { platform: Platform.OS })
  }
}

function requireSafUri(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw androidToolError('schema_invalid', `${label} is required.`)
  const uri = value.trim()
  if (uri.length > 4096 || !uri.startsWith('content://') || !uri.includes('/tree/')) {
    throw androidToolError('policy_denied', `${label} must be an Android SAF tree content URI, not a raw filesystem path.`)
  }
  return uri
}

function requireAndroidUri(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw androidToolError('schema_invalid', `${label} is required.`)
  const uri = value.trim()
  if (/^https?:\/\//i.test(uri)) throw androidToolError('policy_denied', `${label} cannot be a remote URL.`)
  if (!uri.startsWith('file://') && !uri.startsWith('content://')) {
    throw androidToolError('policy_denied', `${label} must be a file:// or content:// URI.`)
  }
  return uri
}

function requireSafeDisplayName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw androidToolError('schema_invalid', `${label} is required.`)
  const name = value.trim()
  if (/[/\\:*?"<>|\u0000-\u001F]/.test(name) || name === '.' || name === '..') {
    throw androidToolError('policy_denied', `${label} must be a single safe file or directory name.`)
  }
  return name.slice(0, 120)
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw androidToolError('schema_invalid', `${label} is required.`)
  return value.trim()
}

function normalizeConflictPolicy(value: unknown): AndroidFileConflictPolicy {
  return value === 'rename' ? 'rename' : 'skip'
}

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

function readTimestamp(numberValue: unknown, isoValue: unknown, fallback: number): number {
  if (typeof numberValue === 'number' && Number.isFinite(numberValue)) return numberValue
  if (typeof isoValue === 'string' && isoValue.trim()) {
    const parsed = Date.parse(isoValue)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function operationId(action: string, left: string, right: string, now: number): string {
  return `android-op-${action}-${Math.abs(hashString(`${left}:${right}:${now}`)).toString(36)}`
}

function displayNameFromSafUri(uri: string): string {
  try {
    const decoded = decodeURIComponent(uri)
    const document = decoded.split('/document/').pop() ?? decoded
    return document.split('/').pop()?.trim() || 'Untitled'
  } catch {
    return uri.split('/').pop() || 'Untitled'
  }
}

function looksLikeApkUri(uri: string): boolean {
  return isAllowedAndroidApkUri(uri)
}

async function listAppCacheEntries(): Promise<string[]> {
  const cacheDirectory = FileSystem.cacheDirectory
  if (!cacheDirectory) return []
  try {
    return await FileSystem.readDirectoryAsync(cacheDirectory)
  } catch {
    return []
  }
}

function appCacheEntryUri(cacheDirectory: string, entryName: string): string | null {
  const normalizedCacheDirectory = cacheDirectory.endsWith('/') ? cacheDirectory : `${cacheDirectory}/`
  const normalizedName = entryName
  if (!normalizedName || normalizedName === '.' || normalizedName === '..') return null
  if (normalizedName !== normalizedName.trim()) return null
  if (/[/\\\u0000-\u001F]/.test(normalizedName)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalizedName)) return null
  return `${normalizedCacheDirectory}${normalizedName}`
}

async function safeNumber(action: () => Promise<number>): Promise<number | null> {
  try {
    const value = await action()
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

function formatBytes(value: number | null): string {
  if (value == null) return 'unknown'
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function jsonExecution(payload: Record<string, unknown>, metadata: Record<string, unknown> = {}): AndroidToolExecution {
  return {
    output: JSON.stringify(payload, null, 2),
    metadata,
  }
}

function visibleAndroidIntentExecution(
  output: string,
  payload: Record<string, unknown>,
  metadata: Record<string, unknown> = {}
): AndroidToolExecution {
  return {
    output,
    metadata: {
      ...payload,
      ...metadata,
      structuredPayload: payload,
    },
  }
}

function formatAlarmIntentOpenedOutput(hour: number, minutes: number, message: string | undefined): string {
  const messageSuffix = message
    ? st('androidTool.alarmMessageSuffix', { message }, ' with label "{{message}}"')
    : ''
  return st(
    'androidTool.alarmIntentOpened',
    { time: formatClockTime(hour, minutes), messageSuffix },
    'Android Clock is open for {{time}}{{messageSuffix}}. Confirm it in the system Clock app to create the alarm.'
  )
}

function formatAlarmCreationRequestedOutput(hour: number, minutes: number, message: string | undefined): string {
  const messageSuffix = message
    ? st('androidTool.alarmMessageSuffix', { message }, ' with label "{{message}}"')
    : ''
  return st(
    'androidTool.alarmCreationRequested',
    { time: formatClockTime(hour, minutes), messageSuffix },
    'Android Clock alarm creation was requested for {{time}}{{messageSuffix}}. If the Clock app still shows an editor, confirm it there.'
  )
}

function formatCalendarEventIntentOpenedOutput(title: string, beginTimeMs: number, beginTimeIso: unknown): string {
  return st(
    'androidTool.calendarEventIntentOpened',
    { title, time: formatAndroidDateTime(beginTimeMs, beginTimeIso) },
    'Android Calendar is open for "{{title}}" at {{time}}. Confirm it in the system Calendar app to create the event.'
  )
}

function formatReminderIntentOpenedOutput(title: string, dueTimeMs: number, dueTimeIso: unknown): string {
  return st(
    'androidTool.reminderIntentOpened',
    { title, time: formatAndroidDateTime(dueTimeMs, dueTimeIso) },
    'Android Calendar is open for the reminder "{{title}}" due {{time}}. Confirm it in the system app to create it.'
  )
}

function formatClockTime(hour: number, minutes: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function formatAndroidDateTime(timestampMs: number, iso: unknown): string {
  if (typeof iso === 'string' && iso.trim()) return iso.trim()
  const date = new Date(timestampMs)
  if (!Number.isFinite(date.getTime())) return st('androidTool.unspecifiedTime', undefined, 'the requested time')
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
}

function throwIfAndroidToolCancelled(signal?: AbortSignal, metadata: Record<string, unknown> = {}): void {
  if (!signal?.aborted) return
  throw androidToolError('cancelled', 'Android device tool execution was cancelled.', 'skipped', {
    ...metadata,
    status: 'cancelled',
    failureCode: 'cancelled',
  })
}

function buildApplyCancellationMetadata(
  undo: boolean,
  results: Array<NativeOperationResult & { operationId: string }>,
  operations: AndroidFileOperationManifest[],
  undoOperations: AndroidFileOperationManifest[]
): Record<string, unknown> {
  return {
    mode: undo ? 'undo' : 'apply',
    applied: results.filter((result) => result.status === 'done').length,
    skipped: results.filter((result) => result.status !== 'done').length,
    operationCount: operations.length,
    undoOperationCount: undoOperations.length,
    results: [...results],
    undoOperations: [...undoOperations],
    deleteSupported: false,
  }
}

function buildToolResult(
  tool: ConversationToolManifest,
  ok: boolean,
  status: ExternalToolObservationStatus,
  output: string,
  startedAt: number,
  metadata: Record<string, unknown> = {},
  errorCode?: ExternalToolObservationErrorCode
): ExternalToolExecutionResult {
  const completedAt = Date.now()
  const safeOutput = clampTraceText(redactSensitiveText(output), 4800)
  const resultMetadata = {
    ...metadata,
    androidOperationAudit: buildAndroidOperationAudit(tool, ok, status, startedAt, completedAt, metadata, errorCode, safeOutput),
  }
  return normalizeExternalToolExecutionResult({
    toolId: tool.id,
    source: tool.source,
    name: tool.name,
    ok,
    status,
    output: safeOutput,
    blocks: [{ type: 'text', text: safeOutput }],
    diagnostic: {
      content: safeOutput,
      status: status === 'done' ? 'done' : status === 'skipped' ? 'skipped' : 'error',
      startedAt,
      completedAt,
      metadata: {
        toolId: tool.id,
        source: tool.source,
        permission: tool.permission,
        errorCode,
        ...resultMetadata,
      },
    },
    errorCode,
    metadata: resultMetadata,
  })
}

function recordAndroidOperationAudit(result: ExternalToolExecutionResult, options: RuntimeLogOptions | undefined): void {
  const audit = result.observation.metadata?.androidOperationAudit
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) return
  void appendRuntimeLog('android.operation.audit', compactAndroidOperationAuditLogRecord(audit as Record<string, unknown>), options)
}

function compactAndroidOperationAuditLogRecord(audit: Record<string, unknown>): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const key of [
    'auditId',
    'toolId',
    'toolName',
    'source',
    'permission',
    'operationKind',
    'status',
    'ok',
    'startedAt',
    'completedAt',
    'durationMs',
    'scope',
    'confirmationState',
    'visibleActionRequired',
    'externalConfirmationRequired',
    'undoAvailable',
    'deleteSupported',
    'permanentDeleteSupported',
    'silentInstallSupported',
    'fullPhoneCleanerSupported',
    'userFilesDeleted',
    'operationCount',
    'appliedCount',
    'skippedCount',
    'deletedEntryCount',
    'undoOperationCount',
    'failureCount',
    'partialFailure',
    'failedOperationId',
    'errorCode',
  ]) {
    if (audit[key] !== undefined) record[key] = audit[key]
  }
  return record
}

function buildAndroidOperationAudit(
  tool: ConversationToolManifest,
  ok: boolean,
  status: ExternalToolObservationStatus,
  startedAt: number,
  completedAt: number,
  metadata: Record<string, unknown>,
  errorCode: ExternalToolObservationErrorCode | undefined,
  safeOutput: string
): AndroidOperationAudit {
  const toolMetadata = tool.metadata ?? {}
  const visibleActionRequired = readAuditBoolean(toolMetadata.requiresVisibleUserAction) === true
  const externalConfirmationRequired = (
    readAuditBoolean(toolMetadata.requiresExternalConfirmation) ??
    readAuditBoolean(metadata.requiresExternalConfirmation) ??
    false
  )
  const undoOperationCount = readAuditNumber(metadata.undoOperationCount)
  const deletedEntryCount = readAuditNumber(metadata.deletedEntryCount)
  const operationCount = readAuditNumber(metadata.operationCount) ?? readAuditNumber(metadata.proposedOperationCount)
  const appliedCount = readAuditNumber(metadata.applied)
  const skippedCount = readAuditNumber(metadata.skipped)
  const failureCount = readAuditNumber(metadata.failureCount)
  const failedOperationId = typeof metadata.failedOperationId === 'string' && metadata.failedOperationId.trim()
    ? clampTraceText(redactSensitiveText(metadata.failedOperationId), 120)
    : undefined
  return {
    auditId: `android-audit-${Math.abs(hashString(`${tool.id}:${startedAt}:${status}`)).toString(36)}`,
    toolId: tool.id,
    toolName: tool.name,
    source: tool.source,
    permission: tool.permission,
    operationKind: androidOperationKind(tool.name),
    status,
    ok,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    scope: androidAuditScope(tool.name),
    confirmationState: androidConfirmationState(ok, tool.permission, visibleActionRequired, externalConfirmationRequired, errorCode),
    visibleActionRequired,
    externalConfirmationRequired,
    undoAvailable: (undoOperationCount ?? 0) > 0,
    deleteSupported: readAuditBoolean(metadata.deleteSupported) ?? readAuditBoolean(toolMetadata.deleteSupported) ?? false,
    permanentDeleteSupported: readAuditBoolean(metadata.permanentDeleteSupported) ?? readAuditBoolean(toolMetadata.permanentDeleteSupported) ?? false,
    silentInstallSupported: readAuditBoolean(metadata.silentInstallSupported) ?? readAuditBoolean(toolMetadata.silentInstallSupported),
    fullPhoneCleanerSupported: readAuditBoolean(metadata.fullPhoneCleanerSupported) ?? readAuditBoolean(toolMetadata.fullPhoneCleanerSupported),
    userFilesDeleted: readAuditBoolean(metadata.userFilesDeleted),
    operationCount,
    appliedCount,
    skippedCount,
    deletedEntryCount,
    undoOperationCount,
    failureCount,
    partialFailure: readAuditBoolean(metadata.partialFailure),
    failedOperationId,
    errorCode,
    failureReason: ok ? undefined : clampTraceText(safeOutput, 240),
  }
}

function androidOperationKind(toolName: string): string {
  switch (toolName) {
    case 'android.files.request_directory_access':
      return 'directory-access'
    case 'android.files.scan':
      return 'file-scan'
    case 'android.files.propose_structure':
      return 'file-structure-proposal'
    case 'android.files.preview_operations':
      return 'file-preview'
    case 'android.files.apply_operations':
      return 'file-apply'
    case 'android.files.undo_operations':
      return 'file-undo'
    case 'android.apk.inspect':
      return 'apk-inspect'
    case 'android.apk.open_installer':
      return 'apk-installer'
    case 'android.storage.audit':
      return 'storage-audit'
    case 'android.storage.propose_cleanup':
      return 'storage-cleanup-proposal'
    case 'android.storage.clear_app_cache':
      return 'storage-clear-app-cache'
    case 'android.alarm.open_create_intent':
      return 'alarm-intent'
    case 'android.calendar.open_create_event':
      return 'calendar-event-intent'
    case 'android.reminder.open_create_todo':
      return 'calendar-todo-intent'
    case 'android.notifications.open_settings':
      return 'notification-settings-intent'
    default:
      return 'android-tool'
  }
}

function androidAuditScope(toolName: string): string {
  if (toolName.startsWith('android.files.')) return 'user-selected-saf-tree'
  if (toolName.startsWith('android.apk.')) return 'system-package-installer'
  if (toolName === 'android.storage.clear_app_cache') return 'app-cache'
  if (toolName === 'android.storage.propose_cleanup') return 'cleanup-proposal'
  if (toolName === 'android.storage.audit') return 'storage-summary'
  if (toolName.startsWith('android.alarm.')) return 'system-clock'
  if (toolName.startsWith('android.calendar.') || toolName.startsWith('android.reminder.')) return 'system-calendar'
  if (toolName.startsWith('android.notifications.')) return 'system-notification-settings'
  return 'android-runtime'
}

function androidConfirmationState(
  ok: boolean,
  permission: ConversationToolManifest['permission'],
  visibleActionRequired: boolean,
  externalConfirmationRequired: boolean,
  errorCode: ExternalToolObservationErrorCode | undefined
): string {
  if (!ok && errorCode === 'cancelled') return 'cancelled'
  if (!ok && errorCode === 'permission_required') return 'blocked-permission-required'
  if (!ok && errorCode === 'policy_denied') return 'blocked-by-policy'
  if (!ok) return 'failed'
  if (externalConfirmationRequired) return 'system-confirmation-opened'
  if (visibleActionRequired) return 'visible-action-recorded'
  if (permission === 'read-only') return 'not-required'
  return 'policy-mediated'
}

function readAuditBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readAuditNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function androidToolError(
  errorCode: ExternalToolObservationErrorCode,
  message: string,
  status: ExternalToolObservationStatus = 'error',
  metadata: Record<string, unknown> = {}
): Error {
  const error = new Error(message) as Error & {
    androidToolStatus?: ExternalToolObservationStatus
    androidToolErrorCode?: ExternalToolObservationErrorCode
    androidToolMetadata?: Record<string, unknown>
  }
  error.androidToolStatus = status
  error.androidToolErrorCode = errorCode
  error.androidToolMetadata = metadata
  return error
}

function normalizeAndroidToolError(error: unknown): {
  message: string
  status: ExternalToolObservationStatus
  errorCode: ExternalToolObservationErrorCode
  metadata: Record<string, unknown>
} {
  const shaped = error as {
    androidToolStatus?: ExternalToolObservationStatus
    androidToolErrorCode?: ExternalToolObservationErrorCode
    androidToolMetadata?: Record<string, unknown>
  }
  return {
    message: errorMessageFrom(error),
    status: shaped.androidToolStatus ?? 'error',
    errorCode: shaped.androidToolErrorCode ?? 'execution_failed',
    metadata: shaped.androidToolMetadata ?? {},
  }
}

function errorMessageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
