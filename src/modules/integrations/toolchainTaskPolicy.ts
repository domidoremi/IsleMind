import { resolveToolchainCliCommandSpecForManifest } from './cliCommandCatalog'
import { createTaskPayloadKeys, sanitizePayload } from './endpointPayloadPolicy'
import {
  sanitizeExactStableIdToken,
  sanitizeTaskStatusReason,
  sanitizeToolchainMetadataToken,
} from './runtimePairingPolicy'
import {
  createTaskItemId,
  sanitizeExternalTaskItemToken,
  sanitizeTaskArtifactChecksum,
  sanitizeTaskArtifactKind,
  sanitizeTaskArtifactLabel,
  sanitizeTaskArtifactMediaType,
  sanitizeTaskLogLevel,
  sanitizeTaskLogMessage,
  sanitizeTaskLogSource,
  type RuntimeTaskArtifactKind,
  type RuntimeTaskLogLevel,
} from './runtimeTaskTextPolicy'
import {
  expireStaleToolchainTaskRecord,
  transitionToolchainTaskRecord,
  type ToolchainTaskLifecycleStatus,
  type ToolchainTaskLifecycleTransitionErrorCode,
} from './taskLifecyclePolicy'
import { isUnsafeRuntimePairingText } from './textSafety'
import {
  validateToolchainManifest,
  type AdmittedRuntimeKind,
  type AdmittedToolManifest,
  type AdmittedToolPermission,
} from './toolchainManifestAdmission'

export interface ToolchainTaskPolicySchemas {
  intentPreview: string
  runtimeProtocol: string
  taskRecord: string
}

export interface ToolchainTaskPolicyDependencies<
  TSchemas extends ToolchainTaskPolicySchemas,
> {
  schemas: TSchemas
  permissions: readonly AdmittedToolPermission[]
  limits: {
    logs: number
    artifacts: number
  }
  untrustedRuntimeKind: AdmittedRuntimeKind
  isTrustedRuntimeSnapshot(input: unknown): boolean
}

export interface ToolchainTaskPolicyRuntime {
  id: string
  kind: AdmittedRuntimeKind
}

export type ToolchainTaskPolicyResolutionStatus =
  | 'ready'
  | 'needs_permission'
  | 'waiting_for_user'
  | 'unsupported'
  | 'invalid'

export interface ToolchainTaskPolicyExecutionResolution {
  status: ToolchainTaskPolicyResolutionStatus
  runtimeId?: string
  runtimeKind?: AdmittedRuntimeKind
  requiresUserConfirmation: boolean
}

export type ToolchainTaskPolicyIntentImpactKind =
  | 'file-write'
  | 'mcp-approval'
  | 'secret-use'
  | 'git-change'
  | 'release-change'

export interface ToolchainTaskPolicyIntentPreview {
  status: 'waiting_for_user' | 'not_required' | 'not_available'
  toolId: string
  runtimeId?: string
  confirmationToken?: string
  permissions: AdmittedToolPermission[]
  impacts: Array<{ kind: ToolchainTaskPolicyIntentImpactKind }>
}

export interface ToolchainTaskPolicyRequest<
  TSchemas extends ToolchainTaskPolicySchemas = ToolchainTaskPolicySchemas,
> {
  schema: TSchemas['runtimeProtocol']
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: AdmittedRuntimeKind
  status: 'queued'
  permissions: AdmittedToolPermission[]
  payload: Record<string, unknown>
  createdAt: number
  projectId?: string
  confirmedIntent?: {
    schema: TSchemas['intentPreview']
    confirmedAt: number
    confirmationToken: string
    permissions: AdmittedToolPermission[]
    impactKinds: ToolchainTaskPolicyIntentImpactKind[]
  }
}

export type ToolchainTaskPolicyRequestErrorCode =
  | 'invalid_manifest'
  | 'runtime_unavailable'
  | 'permission_required'
  | 'intent_preview_required'
  | 'confirmation_mismatch'
  | 'operation_mismatch'

export interface ToolchainTaskPolicyRequestCreation<
  TSchemas extends ToolchainTaskPolicySchemas = ToolchainTaskPolicySchemas,
> {
  ok: boolean
  task?: ToolchainTaskPolicyRequest<TSchemas>
  errorCode?: ToolchainTaskPolicyRequestErrorCode
  message?: string
  requiredPreview?: boolean
}

export interface ToolchainTaskPolicyLogEntry {
  id: string
  ts: number
  level: RuntimeTaskLogLevel
  source: string
  message: string
  redacted: boolean
}

export interface ToolchainTaskPolicyArtifact {
  artifactId: string
  label: string
  kind: RuntimeTaskArtifactKind
  createdAt: number
  sizeBytes?: number
  mediaType?: string
  checksum?: string
}

export interface ToolchainTaskPolicyRecord<
  TSchemas extends ToolchainTaskPolicySchemas = ToolchainTaskPolicySchemas,
> {
  schema: TSchemas['taskRecord']
  protocolSchema: TSchemas['runtimeProtocol']
  taskId: string
  toolId: string
  runtimeId: string
  runtimeKind: AdmittedRuntimeKind
  status: ToolchainTaskLifecycleStatus
  permissions: AdmittedToolPermission[]
  payloadKeys: string[]
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  expiresAt?: number
  projectId?: string
  statusReason?: string
  confirmedIntent?: ToolchainTaskPolicyRequest<TSchemas>['confirmedIntent']
  logs: ToolchainTaskPolicyLogEntry[]
  artifacts: ToolchainTaskPolicyArtifact[]
}

export interface ToolchainTaskPolicyTransitionResult<
  TSchemas extends ToolchainTaskPolicySchemas = ToolchainTaskPolicySchemas,
> {
  ok: boolean
  changed: boolean
  task: ToolchainTaskPolicyRecord<TSchemas>
  errorCode?: ToolchainTaskLifecycleTransitionErrorCode
  message?: string
}

const TASK_REQUEST_INPUT_KEYS = ['manifest', 'runtime', 'taskId', 'projectId', 'payload', 'now'] as const
const CONFIRMED_TASK_REQUEST_INPUT_KEYS = [
  'manifest',
  'runtime',
  'resolution',
  'intentPreview',
  'confirmationToken',
  'taskId',
  'projectId',
  'payload',
  'now',
] as const
const TASK_RECORD_INPUT_KEYS = ['task', 'now', 'expiresAt', 'ttlMs'] as const
const TASK_LOG_INPUT_KEYS = ['level', 'source', 'message', 'redacted', 'now'] as const
const TASK_ARTIFACT_INPUT_KEYS = ['artifactId', 'label', 'kind', 'sizeBytes', 'mediaType', 'checksum', 'now'] as const
const TASK_TRANSITION_INPUT_KEYS = ['now', 'reason'] as const
const TASK_EXPIRY_INPUT_KEYS = ['now', 'ttlMs', 'reason'] as const

export function createToolchainTaskPolicy<
  const TSchemas extends ToolchainTaskPolicySchemas,
>(dependencies: ToolchainTaskPolicyDependencies<TSchemas>) {
  type TaskRequest = ToolchainTaskPolicyRequest<TSchemas>
  type TaskRecord = ToolchainTaskPolicyRecord<TSchemas>
  type TaskTransitionResult = ToolchainTaskPolicyTransitionResult<TSchemas>

  function createToolchainTaskRequest(input: {
    manifest: AdmittedToolManifest
    runtime: ToolchainTaskPolicyRuntime
    taskId?: string
    projectId?: string
    payload?: Record<string, unknown>
    now?: number
  }): TaskRequest {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TASK_REQUEST_INPUT_KEYS)) {
      const now = sanitizeOptionalTimestamp(inputRecord?.now) ?? Date.now()
      return {
        schema: dependencies.schemas.runtimeProtocol,
        taskId: sanitizeTaskRequestId(undefined, 'tool-untrusted', now),
        toolId: 'tool-untrusted',
        runtimeId: 'runtime-untrusted',
        runtimeKind: dependencies.untrustedRuntimeKind,
        status: 'queued',
        permissions: [],
        payload: {},
        createdAt: now,
      }
    }
    const now = sanitizeOptionalTimestamp(input.now) ?? Date.now()
    const manifestRef = createTaskManifestReference(input.manifest)
    const runtimeRef = createTaskRuntimeReference(input.runtime)
    return {
      schema: dependencies.schemas.runtimeProtocol,
      taskId: sanitizeTaskRequestId(input.taskId, manifestRef.toolId, now),
      toolId: manifestRef.toolId,
      runtimeId: runtimeRef.runtimeId,
      runtimeKind: runtimeRef.runtimeKind,
      status: 'queued',
      permissions: manifestRef.permissions,
      payload: sanitizePayload(input.payload),
      createdAt: now,
      projectId: sanitizeToolchainMetadataToken(input.projectId),
    }
  }

  function createToolchainConfirmedTaskRequest(input: {
    manifest: AdmittedToolManifest
    runtime: ToolchainTaskPolicyRuntime
    resolution: ToolchainTaskPolicyExecutionResolution
    intentPreview?: ToolchainTaskPolicyIntentPreview
    confirmationToken?: string
    taskId?: string
    projectId?: string
    payload?: Record<string, unknown>
    now?: number
  }): ToolchainTaskPolicyRequestCreation<TSchemas> {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, CONFIRMED_TASK_REQUEST_INPUT_KEYS)) {
      return {
        ok: false,
        errorCode: 'operation_mismatch',
        message: 'Confirmed task request input contains unsupported metadata.',
      }
    }
    const validation = validateToolchainManifest(input.manifest)
    if (!validation.ok || input.resolution.status === 'invalid') {
      return {
        ok: false,
        errorCode: 'invalid_manifest',
        message: 'Tool manifest must be valid before a task request can be created.',
      }
    }
    if (
      (validation.sanitized.entry.executor === 'cli' || validation.sanitized.entry.type === 'cli') &&
      !resolveToolchainCliCommandSpecForManifest(validation.sanitized)
    ) {
      return {
        ok: false,
        errorCode: 'invalid_manifest',
        message: 'CLI command reference must resolve in the runtime adapter catalog before this task can be queued.',
      }
    }
    if (
      !dependencies.isTrustedRuntimeSnapshot(input.runtime) ||
      input.resolution.runtimeId !== input.runtime.id ||
      input.resolution.runtimeKind !== input.runtime.kind
    ) {
      return {
        ok: false,
        errorCode: 'runtime_unavailable',
        message: 'Runtime identity must match a trusted ready resolution before this task can be queued.',
      }
    }
    if (input.resolution.status === 'needs_permission') {
      return {
        ok: false,
        errorCode: 'permission_required',
        message: 'Permission grants are required before this task can be queued.',
      }
    }
    if (input.resolution.status !== 'ready' && input.resolution.status !== 'waiting_for_user') {
      return {
        ok: false,
        errorCode: 'runtime_unavailable',
        message: 'A compatible runtime is required before this task can be queued.',
      }
    }
    const now = sanitizeOptionalTimestamp(input.now) ?? Date.now()
    if (input.resolution.requiresUserConfirmation) {
      const preview = input.intentPreview
      if (!preview || preview.status !== 'waiting_for_user' || !preview.confirmationToken) {
        return {
          ok: false,
          errorCode: 'intent_preview_required',
          message: 'A waiting intent preview is required before this high-risk task can be queued.',
          requiredPreview: true,
        }
      }
      if (
        preview.toolId !== validation.sanitized.id ||
        preview.runtimeId !== input.runtime.id ||
        preview.confirmationToken !== input.confirmationToken
      ) {
        return {
          ok: false,
          errorCode: 'confirmation_mismatch',
          message: 'The confirmation token does not match the current tool and runtime preview.',
          requiredPreview: true,
        }
      }
      return {
        ok: true,
        task: {
          ...createToolchainTaskRequest({
            manifest: input.manifest,
            runtime: input.runtime,
            taskId: input.taskId,
            projectId: sanitizeToolchainMetadataToken(input.projectId),
            payload: input.payload,
            now,
          }),
          confirmedIntent: {
            schema: dependencies.schemas.intentPreview,
            confirmedAt: now,
            confirmationToken: preview.confirmationToken,
            permissions: preview.permissions,
            impactKinds: preview.impacts.map((impact) => impact.kind),
          },
        },
      }
    }
    return {
      ok: true,
      task: createToolchainTaskRequest({
        manifest: input.manifest,
        runtime: input.runtime,
        taskId: input.taskId,
        projectId: sanitizeToolchainMetadataToken(input.projectId),
        payload: input.payload,
        now,
      }),
    }
  }

  function createToolchainTaskRecord(input: {
    task: TaskRequest
    now?: number
    expiresAt?: number
    ttlMs?: number
  }): TaskRecord {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TASK_RECORD_INPUT_KEYS)) {
      const now = sanitizeOptionalTimestamp(inputRecord?.now) ?? Date.now()
      return {
        schema: dependencies.schemas.taskRecord,
        protocolSchema: dependencies.schemas.runtimeProtocol,
        taskId: 'task-record-untrusted',
        toolId: 'tool-untrusted',
        runtimeId: 'runtime-untrusted',
        runtimeKind: dependencies.untrustedRuntimeKind,
        status: 'queued',
        permissions: [],
        payloadKeys: [],
        createdAt: now,
        updatedAt: now,
        logs: [],
        artifacts: [],
      }
    }
    const now = sanitizeOptionalTimestamp(input.now) ?? sanitizeOptionalTimestamp(input.task.createdAt) ?? Date.now()
    const ttlExpiresAt = typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs)
      ? input.task.createdAt + Math.max(0, input.ttlMs)
      : undefined
    return {
      schema: dependencies.schemas.taskRecord,
      protocolSchema: dependencies.schemas.runtimeProtocol,
      taskId: input.task.taskId,
      toolId: input.task.toolId,
      runtimeId: input.task.runtimeId,
      runtimeKind: input.task.runtimeKind,
      status: input.task.status,
      permissions: uniqueAllowedValues(input.task.permissions, dependencies.permissions),
      payloadKeys: createTaskPayloadKeys(input.task.payload),
      createdAt: input.task.createdAt,
      updatedAt: now,
      expiresAt: sanitizeOptionalTimestamp(input.expiresAt) ?? ttlExpiresAt,
      projectId: sanitizeToolchainMetadataToken(input.task.projectId),
      confirmedIntent: input.task.confirmedIntent,
      logs: [],
      artifacts: [],
    }
  }

  function appendToolchainTaskLog(
    record: TaskRecord,
    input: {
      level?: RuntimeTaskLogLevel
      source?: string
      message: unknown
      redacted?: boolean
      now?: number
    },
  ): TaskRecord {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TASK_LOG_INPUT_KEYS)) return record
    const now = sanitizeOptionalTimestamp(input.now) ?? Date.now()
    const sanitized = sanitizeTaskLogMessage(input.message)
    const source = sanitizeTaskLogSource(input.source, record.runtimeKind)
    const entry: ToolchainTaskPolicyLogEntry = {
      id: createTaskItemId('log', record.taskId, now, record.logs.length + 1),
      ts: now,
      level: sanitizeTaskLogLevel(input.level),
      source: source.source,
      message: sanitized.message,
      redacted: input.redacted === true || sanitized.redacted || source.redacted,
    }
    return {
      ...record,
      updatedAt: now,
      logs: [...record.logs, entry].slice(-dependencies.limits.logs),
    }
  }

  function attachToolchainTaskArtifact(
    record: TaskRecord,
    input: {
      artifactId?: string
      label: string
      kind?: RuntimeTaskArtifactKind
      sizeBytes?: number
      mediaType?: string
      checksum?: string
      now?: number
    },
  ): TaskRecord {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TASK_ARTIFACT_INPUT_KEYS)) return record
    const now = sanitizeOptionalTimestamp(input.now) ?? Date.now()
    const artifact: ToolchainTaskPolicyArtifact = {
      artifactId: sanitizeExternalTaskItemToken(input.artifactId) || createTaskItemId('artifact', record.taskId, now, record.artifacts.length + 1),
      label: sanitizeTaskArtifactLabel(input.label),
      kind: sanitizeTaskArtifactKind(input.kind),
      createdAt: now,
      sizeBytes: sanitizeOptionalNonNegativeNumber(input.sizeBytes),
      mediaType: sanitizeTaskArtifactMediaType(input.mediaType),
      checksum: sanitizeTaskArtifactChecksum(input.checksum),
    }
    return {
      ...record,
      updatedAt: now,
      artifacts: [...record.artifacts, artifact].slice(-dependencies.limits.artifacts),
    }
  }

  function transitionToolchainTask(
    record: TaskRecord,
    nextStatus: ToolchainTaskLifecycleStatus,
    input: {
      now?: number
      reason?: string
    } = {},
  ): TaskTransitionResult {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TASK_TRANSITION_INPUT_KEYS)) {
      return {
        ok: false,
        changed: false,
        task: record,
        errorCode: 'invalid_transition',
        message: 'Task transition input contains unsupported metadata.',
      }
    }
    return transitionToolchainTaskRecord(record, nextStatus, {
      now: sanitizeOptionalTimestamp(input.now),
      reason: input.reason,
    }, sanitizeTaskStatusReason)
  }

  function expireStaleToolchainTask(
    record: TaskRecord,
    input: {
      now?: number
      ttlMs?: number
      reason?: string
    } = {},
  ): TaskTransitionResult {
    const inputRecord = asRecord(input)
    if (!inputRecord || !hasOnlyAllowedKeys(inputRecord, TASK_EXPIRY_INPUT_KEYS)) {
      return {
        ok: false,
        changed: false,
        task: record,
        errorCode: 'invalid_transition',
        message: 'Task expiry input contains unsupported metadata.',
      }
    }
    return expireStaleToolchainTaskRecord(record, {
      now: sanitizeOptionalTimestamp(input.now),
      ttlMs: sanitizeOptionalNonNegativeNumber(input.ttlMs),
      reason: input.reason,
    }, sanitizeTaskStatusReason)
  }

  function createTaskManifestReference(manifest: AdmittedToolManifest): {
    toolId: string
    permissions: AdmittedToolPermission[]
  } {
    const validation = validateToolchainManifest(manifest)
    if (validation.ok) {
      if (
        (validation.sanitized.entry.executor === 'cli' || validation.sanitized.entry.type === 'cli') &&
        !resolveToolchainCliCommandSpecForManifest(validation.sanitized)
      ) {
        return { toolId: 'tool-untrusted', permissions: [] }
      }
      return {
        toolId: validation.sanitized.id,
        permissions: [...validation.sanitized.permissions],
      }
    }
    return { toolId: 'tool-untrusted', permissions: [] }
  }

  function createTaskRuntimeReference(runtime: ToolchainTaskPolicyRuntime): {
    runtimeId: string
    runtimeKind: AdmittedRuntimeKind
  } {
    if (dependencies.isTrustedRuntimeSnapshot(runtime)) {
      return {
        runtimeId: runtime.id,
        runtimeKind: runtime.kind,
      }
    }
    return {
      runtimeId: 'runtime-untrusted',
      runtimeKind: dependencies.untrustedRuntimeKind,
    }
  }

  return Object.freeze({
    createToolchainTaskRequest,
    createToolchainConfirmedTaskRequest,
    createToolchainTaskRecord,
    appendToolchainTaskLog,
    attachToolchainTaskArtifact,
    transitionToolchainTask,
    expireStaleToolchainTask,
  })
}

function hasOnlyAllowedKeys(input: unknown, allowedKeys: readonly string[]): boolean {
  const record = asRecord(input)
  if (!record) return false
  const allowed = new Set(allowedKeys)
  return Object.keys(record).every((key) => allowed.has(key))
}

function sanitizeTaskRequestId(input: unknown, toolId: string, now: number): string {
  const candidate = sanitizeExactStableIdToken(input)
  if (candidate && !isUnsafeTaskRequestId(candidate)) return candidate
  return `task-${toolId.replace(/[^a-z0-9]+/gi, '-')}-${now.toString(36)}`
}

function isUnsafeTaskRequestId(input: string): boolean {
  const value = cleanText(input)
  const withoutTaskPrefix = value.replace(/^task-/i, '')
  return isUnsafeRuntimePairingText(withoutTaskPrefix)
}

function cleanText(input: unknown): string {
  return typeof input === 'string' ? input.trim().slice(0, 420) : ''
}

function sanitizeOptionalTimestamp(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined
}

function sanitizeOptionalNonNegativeNumber(input: number | undefined): number | undefined {
  if (typeof input !== 'number' || !Number.isFinite(input)) return undefined
  return Math.max(0, Math.floor(input))
}

function uniqueAllowedValues<T extends string>(input: readonly T[], allowed: readonly T[]): T[] {
  return Array.from(new Set(input.filter((item) => allowed.includes(item))))
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined
}
