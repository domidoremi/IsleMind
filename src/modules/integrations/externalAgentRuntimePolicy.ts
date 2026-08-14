import {
  EXTERNAL_AGENT_RUNTIME_DESCRIPTOR_SCHEMA,
  EXTERNAL_AGENT_RUNTIME_LIMITS,
  EXTERNAL_AGENT_RUNTIME_PRODUCTS,
  EXTERNAL_AGENT_RUNTIME_PROTOCOLS,
  EXTERNAL_AGENT_RUNTIME_REQUIRED_CAPABILITIES,
  EXTERNAL_AGENT_RUNTIME_SESSION_IDENTITY_KINDS,
  EXTERNAL_AGENT_RUNTIME_SESSION_OUTCOME_SCHEMA,
  EXTERNAL_AGENT_RUNTIME_SESSION_REQUEST_SCHEMA,
  EXTERNAL_AGENT_RUNTIME_TASK_TOOL_IDS,
  type ExternalAgentRuntimeDescriptor,
  type ExternalAgentRuntimeOpenSessionRequest,
  type ExternalAgentRuntimeProduct,
  type ExternalAgentRuntimeProtocol,
  type ExternalAgentRuntimeResumeSessionRequest,
  type ExternalAgentRuntimeSessionIdentityKind,
  type ExternalAgentRuntimeSessionOutcome,
  type ExternalAgentRuntimeSessionPort,
  type ExternalAgentRuntimeSessionRequest,
  type ExternalAgentRuntimeVendorSessionIdentity,
} from './externalAgentRuntimeContracts'
import { isTaskStatus } from './taskLifecyclePolicy'
import { isUnsafeRuntimePairingText } from './textSafety'
import { stableIdentityHash } from './toolchainIdentity'
import { sanitizeExactStableIdToken } from './runtimePairingPolicy'
import type { ToolchainTaskRecord } from './toolchainRuntimeContracts'
import {
  TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA,
  TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY,
  type ToolchainRuntimeSnapshot,
} from './toolchainRuntimeTrust'

const PRODUCT_PROTOCOL_COMPATIBILITY = Object.freeze({
  'codex-cli': Object.freeze({
    protocol: 'codex-app-server',
    sessionIdentityKind: 'codex-thread',
  }),
  'codex-desktop': Object.freeze({
    protocol: 'codex-app-server',
    sessionIdentityKind: 'codex-thread',
  }),
  'claude-code': Object.freeze({
    protocol: 'claude-code-stream-json',
    sessionIdentityKind: 'claude-session',
  }),
  'grok-cli': Object.freeze({
    protocol: 'grok-acp',
    sessionIdentityKind: 'acp-session',
  }),
} as const satisfies Readonly<Record<ExternalAgentRuntimeProduct, Readonly<{
  protocol: ExternalAgentRuntimeProtocol
  sessionIdentityKind: ExternalAgentRuntimeSessionIdentityKind
}>>>)

const DESCRIPTOR_KEYS = Object.freeze([
  'id',
  'name',
  'product',
  'protocol',
  'requiredRuntimeCapabilities',
  'schema',
  'sessionIdentityKind',
  'supportsResume',
  'transport',
  'version',
])
const OPEN_REQUEST_INPUT_KEYS = Object.freeze(['descriptor', 'instruction', 'operation', 'runtime', 'task'])
const RESUME_REQUEST_INPUT_KEYS = Object.freeze([...OPEN_REQUEST_INPUT_KEYS, 'vendorSession'])
const OPEN_REQUEST_KEYS = Object.freeze([
  'createdAt',
  'descriptorId',
  'instruction',
  'operation',
  'protocol',
  'requestId',
  'runtimeId',
  'schema',
  'taskId',
])
const RESUME_REQUEST_KEYS = Object.freeze([...OPEN_REQUEST_KEYS, 'vendorSession'])
const VENDOR_SESSION_KEYS = Object.freeze(['id', 'kind'])
const COMPLETED_OUTCOME_KEYS = Object.freeze([
  'completedAt',
  'descriptorId',
  'operation',
  'output',
  'protocol',
  'requestId',
  'runtimeId',
  'schema',
  'status',
  'taskId',
  'vendorSession',
])
const FAILED_OUTCOME_KEYS = Object.freeze([
  'completedAt',
  'descriptorId',
  'error',
  'operation',
  'protocol',
  'requestId',
  'runtimeId',
  'schema',
  'status',
  'taskId',
])
const ERROR_KEYS = Object.freeze(['code', 'message'])
const EXECUTION_INPUT_KEYS = Object.freeze(['descriptor', 'port', 'request', 'runtime', 'signal', 'task'])
const UNSAFE_TEXT_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const CREDENTIAL_VALUE_PATTERN = /(?:api[-_ ]?key|access[-_ ]?token|authorization|credential|password|secret)\s*[:=]\s*[^\s,;]{8,}|(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}|(?:^|\s)bearer\s+[A-Za-z0-9._~+/-]{8,}/i

export interface ExternalAgentRuntimePolicyDependencies {
  isTrustedRuntimeSnapshot(input: unknown): input is ToolchainRuntimeSnapshot
  isTrustedTaskRecord(input: unknown): input is ToolchainTaskRecord
  now(): number
}

export type ExternalAgentRuntimeDescriptorAdmissionErrorCode =
  | 'invalid_descriptor'
  | 'schema_mismatch'
  | 'protocol_mismatch'

export type ExternalAgentRuntimeDescriptorAdmissionResult =
  | Readonly<{ ok: true; descriptor: ExternalAgentRuntimeDescriptor }>
  | Readonly<{
    ok: false
    code: ExternalAgentRuntimeDescriptorAdmissionErrorCode
    message: string
  }>

export type ExternalAgentRuntimeSessionRequestErrorCode =
  | ExternalAgentRuntimeDescriptorAdmissionErrorCode
  | 'operation_mismatch'
  | 'runtime_unavailable'
  | 'runtime_mismatch'
  | 'task_untrusted'
  | 'task_tool_mismatch'
  | 'task_not_running'
  | 'task_expired'
  | 'capability_missing'
  | 'invalid_instruction'
  | 'resume_unsupported'
  | 'resume_identity_required'
  | 'invalid_timestamp'

export type ExternalAgentRuntimeSessionRequestCreationResult =
  | Readonly<{ ok: true; request: ExternalAgentRuntimeSessionRequest }>
  | Readonly<{
    ok: false
    code: ExternalAgentRuntimeSessionRequestErrorCode
    message: string
  }>

export type ExternalAgentRuntimeSessionOutcomeErrorCode =
  | 'invalid_request'
  | 'invalid_outcome'
  | 'schema_mismatch'
  | 'request_mismatch'
  | 'session_mismatch'
  | 'outcome_limit_exceeded'

export type ExternalAgentRuntimeSessionOutcomeAdmissionResult =
  | Readonly<{ ok: true; outcome: ExternalAgentRuntimeSessionOutcome }>
  | Readonly<{
    ok: false
    code: ExternalAgentRuntimeSessionOutcomeErrorCode
    message: string
  }>

export type ExternalAgentRuntimeSessionExecutionErrorCode =
  | ExternalAgentRuntimeSessionRequestErrorCode
  | ExternalAgentRuntimeSessionOutcomeErrorCode
  | 'cancelled'
  | 'port_unavailable'
  | 'port_failure'

export type ExternalAgentRuntimeSessionExecutionResult =
  | Readonly<{ ok: true; outcome: ExternalAgentRuntimeSessionOutcome }>
  | Readonly<{
    ok: false
    code: ExternalAgentRuntimeSessionExecutionErrorCode
    message: string
  }>

/**
 * Defines the trust boundary around a vendor-owned runtime protocol. Concrete
 * process discovery and transport adapters remain bootstrap responsibilities.
 */
export function createExternalAgentRuntimePolicy(
  dependencies: ExternalAgentRuntimePolicyDependencies,
) {
  function admitExternalAgentRuntimeDescriptor(
    input: unknown,
  ): ExternalAgentRuntimeDescriptorAdmissionResult {
    const descriptor = asPlainRecord(input)
    if (!descriptor || !hasExactDataKeys(descriptor, DESCRIPTOR_KEYS)) {
      return failure('invalid_descriptor', 'External runtime descriptor fields are invalid.')
    }
    if (descriptor.schema !== EXTERNAL_AGENT_RUNTIME_DESCRIPTOR_SCHEMA) {
      return failure('schema_mismatch', 'External runtime descriptor schema is incompatible.')
    }
    if (
      sanitizeExactStableIdToken(descriptor.id) !== descriptor.id ||
      !isCanonicalPublicText(descriptor.name, EXTERNAL_AGENT_RUNTIME_LIMITS.descriptorNameChars) ||
      isUnsafeRuntimePairingText(descriptor.name) ||
      !isCanonicalVersion(descriptor.version) ||
      !EXTERNAL_AGENT_RUNTIME_PRODUCTS.includes(descriptor.product as ExternalAgentRuntimeProduct) ||
      !EXTERNAL_AGENT_RUNTIME_PROTOCOLS.includes(descriptor.protocol as ExternalAgentRuntimeProtocol) ||
      descriptor.transport !== 'stdio' ||
      !EXTERNAL_AGENT_RUNTIME_SESSION_IDENTITY_KINDS.includes(
        descriptor.sessionIdentityKind as ExternalAgentRuntimeSessionIdentityKind,
      ) ||
      typeof descriptor.supportsResume !== 'boolean' ||
      !hasCanonicalRequiredCapabilities(descriptor.requiredRuntimeCapabilities)
    ) {
      return failure('invalid_descriptor', 'External runtime descriptor values are invalid.')
    }

    const product = descriptor.product as ExternalAgentRuntimeProduct
    const compatibility = PRODUCT_PROTOCOL_COMPATIBILITY[product]
    if (
      descriptor.protocol !== compatibility.protocol ||
      descriptor.sessionIdentityKind !== compatibility.sessionIdentityKind
    ) {
      return failure('protocol_mismatch', 'External runtime product and protocol identity are incompatible.')
    }

    return Object.freeze({
      ok: true,
      descriptor: Object.freeze({
        schema: EXTERNAL_AGENT_RUNTIME_DESCRIPTOR_SCHEMA,
        id: descriptor.id as string,
        product,
        name: descriptor.name as string,
        version: descriptor.version as string,
        protocol: compatibility.protocol,
        transport: 'stdio',
        sessionIdentityKind: compatibility.sessionIdentityKind,
        supportsResume: descriptor.supportsResume,
        requiredRuntimeCapabilities: EXTERNAL_AGENT_RUNTIME_REQUIRED_CAPABILITIES,
      }),
    })
  }

  function createExternalAgentRuntimeSessionRequest(
    input: unknown,
  ): ExternalAgentRuntimeSessionRequestCreationResult {
    const record = asPlainRecord(input)
    const operation = record?.operation
    if (operation !== 'open' && operation !== 'resume') {
      return failure('operation_mismatch', 'External runtime session request input is invalid.')
    }
    const expectedKeys = operation === 'open'
      ? OPEN_REQUEST_INPUT_KEYS
      : RESUME_REQUEST_INPUT_KEYS
    if (!record || !hasExactDataKeys(record, expectedKeys)) {
      return failure('operation_mismatch', 'External runtime session request input is invalid.')
    }

    const descriptorAdmission = admitExternalAgentRuntimeDescriptor(record.descriptor)
    if (!descriptorAdmission.ok) return descriptorAdmission
    const now = dependencies.now()
    if (!isFiniteTimestamp(now)) {
      return failure('invalid_timestamp', 'External runtime request time is invalid.')
    }
    const authority = admitAuthority(
      descriptorAdmission.descriptor,
      record.runtime,
      record.task,
      now,
    )
    if (!authority.ok) return authority
    if (!isCanonicalInstruction(record.instruction)) {
      return failure('invalid_instruction', 'External runtime instruction is invalid or contains credential material.')
    }

    let vendorSession: ExternalAgentRuntimeVendorSessionIdentity | undefined
    if (operation === 'resume') {
      if (!descriptorAdmission.descriptor.supportsResume) {
        return failure('resume_unsupported', 'External runtime descriptor does not advertise resume support.')
      }
      vendorSession = normalizeVendorSession(
        record.vendorSession,
        descriptorAdmission.descriptor.sessionIdentityKind,
      )
      if (!vendorSession) {
        return failure('resume_identity_required', 'Resume requires an exact caller-supplied vendor session correlation identity.')
      }
    }

    const requestId = createSessionRequestId({
      descriptorId: descriptorAdmission.descriptor.id,
      runtimeId: authority.runtime.id,
      taskId: authority.task.taskId,
      protocol: descriptorAdmission.descriptor.protocol,
      operation,
      instruction: record.instruction,
      vendorSessionId: vendorSession?.id,
      createdAt: now,
    })
    const common = {
      schema: EXTERNAL_AGENT_RUNTIME_SESSION_REQUEST_SCHEMA,
      requestId,
      descriptorId: descriptorAdmission.descriptor.id,
      runtimeId: authority.runtime.id,
      taskId: authority.task.taskId,
      protocol: descriptorAdmission.descriptor.protocol,
      instruction: record.instruction as string,
      createdAt: now,
    } as const

    const request: ExternalAgentRuntimeSessionRequest = operation === 'open'
      ? Object.freeze({ ...common, operation: 'open' })
      : Object.freeze({ ...common, operation: 'resume', vendorSession: vendorSession as ExternalAgentRuntimeVendorSessionIdentity })
    return Object.freeze({ ok: true, request })
  }

  function admitExternalAgentRuntimeSessionOutcome(
    requestInput: unknown,
    outcomeInput: unknown,
  ): ExternalAgentRuntimeSessionOutcomeAdmissionResult {
    const request = normalizeSessionRequest(requestInput)
    if (!request) return failure('invalid_request', 'External runtime session request is not trusted.')
    const outcome = asPlainRecord(outcomeInput)
    const status = outcome?.status
    const expectedKeys = status === 'completed'
      ? COMPLETED_OUTCOME_KEYS
      : status === 'failed' || status === 'cancelled'
        ? FAILED_OUTCOME_KEYS
        : undefined
    if (!outcome || !expectedKeys || !hasExactDataKeys(outcome, expectedKeys)) {
      return failure('invalid_outcome', 'External runtime session outcome fields are invalid.')
    }
    if (outcome.schema !== EXTERNAL_AGENT_RUNTIME_SESSION_OUTCOME_SCHEMA) {
      return failure('schema_mismatch', 'External runtime session outcome schema is incompatible.')
    }
    if (!outcomeMatchesRequest(outcome, request)) {
      return failure('request_mismatch', 'External runtime session outcome does not match the exact request identity.')
    }
    if (!isFiniteTimestamp(outcome.completedAt) || outcome.completedAt < request.createdAt) {
      return failure('invalid_outcome', 'External runtime session completion time is invalid.')
    }

    if (status === 'completed') {
      const expectedIdentityKind = sessionIdentityKindForProtocol(request.protocol)
      const vendorSession = expectedIdentityKind
        ? normalizeVendorSession(outcome.vendorSession, expectedIdentityKind)
        : undefined
      if (!vendorSession) {
        return failure('session_mismatch', 'External runtime outcome has an invalid vendor session identity.')
      }
      if (
        request.operation === 'resume' &&
        (request.vendorSession.kind !== vendorSession.kind || request.vendorSession.id !== vendorSession.id)
      ) {
        return failure('session_mismatch', 'Resumed runtime outcome changed the caller-supplied vendor session correlation identity.')
      }
      if (!isCanonicalOutput(outcome.output)) {
        return failure(
          typeof outcome.output === 'string' && outcome.output.length > EXTERNAL_AGENT_RUNTIME_LIMITS.outputChars
            ? 'outcome_limit_exceeded'
            : 'invalid_outcome',
          'External runtime output is invalid, oversized, or contains credential material.',
        )
      }
      return Object.freeze({
        ok: true,
        outcome: Object.freeze({
          ...copyOutcomeIdentity(outcome, request),
          status: 'completed',
          vendorSession,
          output: outcome.output,
          completedAt: outcome.completedAt,
        }),
      })
    }

    const error = normalizeOutcomeError(outcome.error)
    if (!error) {
      return failure('invalid_outcome', 'External runtime failure outcome contains invalid error details.')
    }
    if (status !== 'failed' && status !== 'cancelled') {
      return failure('invalid_outcome', 'External runtime session outcome status is invalid.')
    }
    return Object.freeze({
      ok: true,
      outcome: Object.freeze({
        ...copyOutcomeIdentity(outcome, request),
        status,
        error,
        completedAt: outcome.completedAt,
      }),
    })
  }

  async function executeExternalAgentRuntimeSession(
    input: unknown,
  ): Promise<ExternalAgentRuntimeSessionExecutionResult> {
    const record = asPlainRecord(input)
    if (!record || !hasExactDataKeys(record, EXECUTION_INPUT_KEYS)) {
      return failure('operation_mismatch', 'External runtime session execution input is invalid.')
    }
    const descriptorAdmission = admitExternalAgentRuntimeDescriptor(record.descriptor)
    if (!descriptorAdmission.ok) return descriptorAdmission
    const now = dependencies.now()
    if (!isFiniteTimestamp(now)) {
      return failure('invalid_timestamp', 'External runtime execution time is invalid.')
    }
    const authority = admitAuthority(descriptorAdmission.descriptor, record.runtime, record.task, now)
    if (!authority.ok) return authority
    const request = normalizeSessionRequest(record.request)
    if (!request || !requestMatchesAuthority(
      request,
      descriptorAdmission.descriptor,
      authority.runtime,
      authority.task,
      now,
    )) {
      return failure('invalid_request', 'External runtime request does not match the current trusted authority.')
    }
    if (request.operation === 'resume' && !descriptorAdmission.descriptor.supportsResume) {
      return failure('resume_unsupported', 'External runtime descriptor does not advertise resume support.')
    }
    if (!isAbortSignal(record.signal)) {
      return failure('operation_mismatch', 'External runtime execution requires a caller-supplied AbortSignal.')
    }
    const port = normalizeSessionPort(record.port)
    if (!port) return failure('port_unavailable', 'External runtime session port is unavailable.')
    if (record.signal.aborted) return failure('cancelled', 'External runtime session was cancelled before dispatch.')

    try {
      const rawOutcome = request.operation === 'open'
        ? await port.open(request, record.signal)
        : await port.resume(request, record.signal)
      if (record.signal.aborted) {
        return failure('cancelled', 'External runtime session was cancelled before outcome admission.')
      }
      return admitExternalAgentRuntimeSessionOutcome(request, rawOutcome)
    } catch {
      return record.signal.aborted
        ? failure('cancelled', 'External runtime session was cancelled during dispatch.')
        : failure('port_failure', 'External runtime session port failed without an admitted outcome.')
    }
  }

  return Object.freeze({
    admitExternalAgentRuntimeDescriptor,
    createExternalAgentRuntimeSessionRequest,
    admitExternalAgentRuntimeSessionOutcome,
    executeExternalAgentRuntimeSession,
  })

  function admitAuthority(
    descriptor: ExternalAgentRuntimeDescriptor,
    runtimeInput: unknown,
    taskInput: unknown,
    now: number,
  ): Readonly<{ ok: true; runtime: ToolchainRuntimeSnapshot; task: ToolchainTaskRecord }> | Readonly<{
    ok: false
    code: ExternalAgentRuntimeSessionRequestErrorCode
    message: string
  }> {
    if (
      !TOOLCHAIN_RUNTIME_SNAPSHOT_POLICY.isTrustedRuntimeSnapshot(runtimeInput) ||
      !dependencies.isTrustedRuntimeSnapshot(runtimeInput)
    ) {
      return failure('runtime_unavailable', 'External runtime snapshot is not trusted.')
    }
    const runtime = runtimeInput
    if (
      !runtime.online ||
      (runtime.kind !== 'desktop' && runtime.kind !== 'remote') ||
      runtime.protocolSchema !== TOOLCHAIN_RUNTIME_PROTOCOL_SCHEMA ||
      !runtime.transports.includes('stdio')
    ) {
      return failure('runtime_unavailable', 'External runtime must be online, desktop or remote, and stdio-capable.')
    }
    if (descriptor.product === 'codex-desktop' && runtime.kind !== 'desktop') {
      return failure('runtime_mismatch', 'Codex Desktop sessions require a trusted desktop runtime.')
    }
    if (!descriptor.requiredRuntimeCapabilities.every((capability) => runtime.capabilities.includes(capability))) {
      return failure('capability_missing', 'External runtime lacks a required session capability.')
    }
    if (!dependencies.isTrustedTaskRecord(taskInput)) {
      return failure('task_untrusted', 'External runtime session task record is not trusted.')
    }
    const task = taskInput
    if (task.toolId !== EXTERNAL_AGENT_RUNTIME_TASK_TOOL_IDS[descriptor.product]) {
      return failure('task_tool_mismatch', 'External runtime product does not match the durable task capability.')
    }
    if (!isTaskStatus(task.status) || task.status !== 'running') {
      return failure('task_not_running', 'External runtime sessions require a running durable task.')
    }
    if (now < task.createdAt || now < task.updatedAt) {
      return failure('invalid_timestamp', 'External runtime operation time predates the trusted task state.')
    }
    if (task.expiresAt !== undefined && now >= task.expiresAt) {
      return failure('task_expired', 'External runtime task authority has expired.')
    }
    if (task.runtimeId !== runtime.id || task.runtimeKind !== runtime.kind) {
      return failure('runtime_mismatch', 'External runtime identity must match the exact task runtime.')
    }
    if (!task.permissions.includes('task.run')) {
      return failure('capability_missing', 'External runtime task does not carry task.run permission.')
    }
    return Object.freeze({ ok: true, runtime, task })
  }
}

function normalizeSessionRequest(input: unknown): ExternalAgentRuntimeSessionRequest | undefined {
  const request = asPlainRecord(input)
  const expectedKeys = request?.operation === 'open'
    ? OPEN_REQUEST_KEYS
    : request?.operation === 'resume'
      ? RESUME_REQUEST_KEYS
      : undefined
  if (
    !request ||
    !expectedKeys ||
    !hasExactDataKeys(request, expectedKeys) ||
    request.schema !== EXTERNAL_AGENT_RUNTIME_SESSION_REQUEST_SCHEMA ||
    sanitizeExactStableIdToken(request.requestId) !== request.requestId ||
    sanitizeExactStableIdToken(request.descriptorId) !== request.descriptorId ||
    sanitizeExactStableIdToken(request.runtimeId) !== request.runtimeId ||
    sanitizeExactStableIdToken(request.taskId) !== request.taskId ||
    !EXTERNAL_AGENT_RUNTIME_PROTOCOLS.includes(request.protocol as ExternalAgentRuntimeProtocol) ||
    !isCanonicalInstruction(request.instruction) ||
    !isFiniteTimestamp(request.createdAt)
  ) return undefined

  const common = {
    schema: EXTERNAL_AGENT_RUNTIME_SESSION_REQUEST_SCHEMA,
    requestId: request.requestId as string,
    descriptorId: request.descriptorId as string,
    runtimeId: request.runtimeId as string,
    taskId: request.taskId as string,
    protocol: request.protocol as ExternalAgentRuntimeProtocol,
    instruction: request.instruction as string,
    createdAt: request.createdAt,
  } as const
  if (request.operation === 'open') return Object.freeze({ ...common, operation: 'open' })

  const expectedIdentityKind = sessionIdentityKindForProtocol(common.protocol)
  const vendorSession = expectedIdentityKind
    ? normalizeVendorSession(request.vendorSession, expectedIdentityKind)
    : undefined
  return vendorSession
    ? Object.freeze({ ...common, operation: 'resume', vendorSession })
    : undefined
}

function requestMatchesAuthority(
  request: ExternalAgentRuntimeSessionRequest,
  descriptor: ExternalAgentRuntimeDescriptor,
  runtime: ToolchainRuntimeSnapshot,
  task: ToolchainTaskRecord,
  now: number,
): boolean {
  return request.descriptorId === descriptor.id &&
    request.runtimeId === runtime.id &&
    request.taskId === task.taskId &&
    request.protocol === descriptor.protocol &&
    request.createdAt >= task.createdAt &&
    request.createdAt <= now &&
    (request.operation === 'open' || request.vendorSession.kind === descriptor.sessionIdentityKind)
}

function outcomeMatchesRequest(
  outcome: Record<string, unknown>,
  request: ExternalAgentRuntimeSessionRequest,
): boolean {
  return outcome.requestId === request.requestId &&
    outcome.descriptorId === request.descriptorId &&
    outcome.runtimeId === request.runtimeId &&
    outcome.taskId === request.taskId &&
    outcome.protocol === request.protocol &&
    outcome.operation === request.operation
}

function copyOutcomeIdentity(
  _outcome: Record<string, unknown>,
  request: ExternalAgentRuntimeSessionRequest,
) {
  return {
    schema: EXTERNAL_AGENT_RUNTIME_SESSION_OUTCOME_SCHEMA,
    requestId: request.requestId,
    descriptorId: request.descriptorId,
    runtimeId: request.runtimeId,
    taskId: request.taskId,
    protocol: request.protocol,
    operation: request.operation,
  } as const
}

function normalizeVendorSession(
  input: unknown,
  expectedKind: ExternalAgentRuntimeSessionIdentityKind,
): ExternalAgentRuntimeVendorSessionIdentity | undefined {
  const identity = asPlainRecord(input)
  if (
    !identity ||
    !hasExactDataKeys(identity, VENDOR_SESSION_KEYS) ||
    identity.kind !== expectedKind ||
    sanitizeExactStableIdToken(identity.id) !== identity.id
  ) return undefined
  return Object.freeze({ kind: expectedKind, id: identity.id as string })
}

function normalizeOutcomeError(input: unknown): Readonly<{ code: string; message: string }> | undefined {
  const error = asPlainRecord(input)
  if (
    !error ||
    !hasExactDataKeys(error, ERROR_KEYS) ||
    sanitizeExactStableIdToken(error.code) !== error.code ||
    !isCanonicalPublicText(error.message, EXTERNAL_AGENT_RUNTIME_LIMITS.errorMessageChars) ||
    containsCredentialValue(error.message)
  ) return undefined
  return Object.freeze({ code: error.code as string, message: error.message as string })
}

function sessionIdentityKindForProtocol(
  protocol: ExternalAgentRuntimeProtocol,
): ExternalAgentRuntimeSessionIdentityKind | undefined {
  if (protocol === 'codex-app-server') return 'codex-thread'
  if (protocol === 'claude-code-stream-json') return 'claude-session'
  if (protocol === 'grok-acp') return 'acp-session'
  return undefined
}

function hasCanonicalRequiredCapabilities(input: unknown): boolean {
  return Array.isArray(input) &&
    input.length === EXTERNAL_AGENT_RUNTIME_REQUIRED_CAPABILITIES.length &&
    input.every((value, index) => value === EXTERNAL_AGENT_RUNTIME_REQUIRED_CAPABILITIES[index])
}

function isCanonicalInstruction(input: unknown): input is string {
  return isCanonicalPublicText(input, EXTERNAL_AGENT_RUNTIME_LIMITS.instructionChars) &&
    !containsCredentialValue(input)
}

function isCanonicalOutput(input: unknown): input is string {
  return typeof input === 'string' &&
    input.length <= EXTERNAL_AGENT_RUNTIME_LIMITS.outputChars &&
    !UNSAFE_TEXT_CHARACTER_PATTERN.test(input) &&
    !containsCredentialValue(input)
}

function isCanonicalPublicText(input: unknown, limit: number): input is string {
  return typeof input === 'string' &&
    input.length > 0 &&
    input.length <= limit &&
    input === input.trim() &&
    !UNSAFE_TEXT_CHARACTER_PATTERN.test(input)
}

function isCanonicalVersion(input: unknown): input is string {
  return typeof input === 'string' &&
    input.length <= EXTERNAL_AGENT_RUNTIME_LIMITS.descriptorVersionChars &&
    /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(input) &&
    !containsCredentialValue(input)
}

function containsCredentialValue(input: string): boolean {
  return CREDENTIAL_VALUE_PATTERN.test(input)
}

function createSessionRequestId(input: {
  descriptorId: string
  runtimeId: string
  taskId: string
  protocol: ExternalAgentRuntimeProtocol
  operation: 'open' | 'resume'
  instruction: unknown
  vendorSessionId?: string
  createdAt: number
}): string {
  return `external-agent-session-${stableIdentityHash(input)}`
}

function isFiniteTimestamp(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input) && input >= 0
}

function normalizeSessionPort(input: unknown): ExternalAgentRuntimeSessionPort | undefined {
  if (!input || (typeof input !== 'object' && typeof input !== 'function')) return undefined
  const port = input as Partial<ExternalAgentRuntimeSessionPort>
  return typeof port.open === 'function' && typeof port.resume === 'function'
    ? port as ExternalAgentRuntimeSessionPort
    : undefined
}

function isAbortSignal(input: unknown): input is AbortSignal {
  if (!input || typeof input !== 'object') return false
  const signal = input as Partial<AbortSignal>
  return typeof signal.aborted === 'boolean' &&
    typeof signal.addEventListener === 'function' &&
    typeof signal.removeEventListener === 'function'
}

function hasExactDataKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const actualKeys = Object.keys(record).sort()
  const expected = [...expectedKeys].sort()
  if (actualKeys.length !== expected.length || !actualKeys.every((key, index) => key === expected[index])) {
    return false
  }
  return actualKeys.every((key) => {
    const property = Object.getOwnPropertyDescriptor(record, key)
    return Boolean(property && 'value' in property)
  })
}

function asPlainRecord(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
    ? input as Record<string, unknown>
    : undefined
}

function failure<TCode extends string>(
  code: TCode,
  message: string,
): Readonly<{ ok: false; code: TCode; message: string }> {
  return Object.freeze({ ok: false, code, message })
}
