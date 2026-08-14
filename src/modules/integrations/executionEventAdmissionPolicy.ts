type UnknownRecord = Record<string, any>

export type ExecutionEventAdmissionPolicyDependencies = {
  schemas: {
    runtimeProtocol: string
    runtimeHandoff: string
    manifest: string
    taskRecord: string
  }
  permissions: readonly string[]
  runtimeCapabilities: readonly string[]
  hasOnlyAllowedKeys(input: unknown, keys: readonly string[]): boolean
  stableIdentityString(input: unknown): string
  sanitizeStableId(input: unknown): string | undefined
  sanitizeMetadata(input: unknown): string | undefined
  sanitizeCommandRef(input: unknown): string | undefined
  sanitizeMcpToolRef(input: unknown): string | undefined
  sanitizeEndpointRef(input: unknown): string | undefined
  isTrustedTaskId(input: unknown): boolean
  isRuntimeKind(input: unknown): boolean
  isToolKind(input: unknown): boolean
  isTransport(input: unknown): boolean
  isHandoffDeliveryKind(input: unknown): boolean
  isTrustedConfirmedIntent(input: unknown, createdAt: number, permissions: readonly string[]): boolean
  isTrustedTaskPayloadKeyList(input: unknown, limit: number): boolean
  sanitizeTaskPayloadKeyList(input: unknown): string[]
  createTaskPayloadKeys(input: UnknownRecord): string[]
  uniqueAllowedList(input: readonly string[], allowed: readonly string[]): string[]
  findOfficialManifest(toolId: string): UnknownRecord | undefined
  inferRequiredCapabilities(manifest: UnknownRecord): string[]
  createRuntimeHandoffEntryRef(manifest: UnknownRecord): UnknownRecord
}

const asRecord = (input: unknown): UnknownRecord | undefined =>
  input && typeof input === 'object' && !Array.isArray(input) ? input as UnknownRecord : undefined

const HANDOFF_KEYS = [
  'schema', 'manifestSchema', 'protocolSchema', 'taskRecordSchema', 'createdAt', 'taskId', 'toolId',
  'toolVersion', 'toolKind', 'runtimeId', 'runtimeKind', 'projectId', 'delivery', 'entryRef',
  'permissions', 'requiredCapabilities', 'payload', 'payloadKeys', 'confirmedIntent', 'expiresAt', 'dispatch',
] as const

const HANDOFF_ENTRY_KEYS = ['type', 'executor', 'commandRef', 'action', 'mcpToolName', 'transport', 'endpoint'] as const

export function createExecutionEventAdmissionPolicy(dependencies: ExecutionEventAdmissionPolicyDependencies) {
  const same = (left: unknown, right: unknown) =>
    dependencies.stableIdentityString(left) === dependencies.stableIdentityString(right)

  const runtimeHandoffEntryRefMatches = (actual: UnknownRecord, expected: UnknownRecord) =>
    actual.type === expected.type && actual.executor === expected.executor &&
    actual.commandRef === expected.commandRef && actual.action === expected.action &&
    actual.mcpToolName === expected.mcpToolName && actual.transport === expected.transport &&
    actual.endpoint === expected.endpoint

  const expectedRuntimeHandoffDelivery = (manifest: UnknownRecord, runtimeKind: unknown): string => {
    const entry = asRecord(manifest.entry) ?? {}
    if (runtimeKind === 'android-app' && entry.type === 'app-action') return 'android-app-action'
    if (runtimeKind === 'remote') return 'remote-http'
    if (entry.transport === 'streamable-http' || entry.transport === 'http') return 'companion-http'
    return 'runtime-local'
  }

  const runtimeHandoffDispatchMatches = (dispatch: UnknownRecord, delivery: unknown, entryTransport: unknown) =>
    dispatch.androidCanExecute === (delivery === 'android-app-action') &&
    dispatch.requiresPairedRuntime === (delivery !== 'android-app-action') &&
    dispatch.usesNetworkTransport === (delivery === 'companion-http' || delivery === 'remote-http') &&
    dispatch.usesStreamableHttp === (entryTransport === 'streamable-http')

  function isTrustedRuntimeHandoff(input: unknown): boolean {
    const handoff = asRecord(input)
    const entryRef = asRecord(handoff?.entryRef)
    const dispatch = asRecord(handoff?.dispatch)
    if (!handoff || !dependencies.hasOnlyAllowedKeys(handoff, HANDOFF_KEYS) ||
      handoff.schema !== dependencies.schemas.runtimeHandoff || handoff.manifestSchema !== dependencies.schemas.manifest ||
      handoff.protocolSchema !== dependencies.schemas.runtimeProtocol || handoff.taskRecordSchema !== dependencies.schemas.taskRecord ||
      typeof handoff.createdAt !== 'number' || !Number.isFinite(handoff.createdAt) || !dependencies.isTrustedTaskId(handoff.taskId) ||
      dependencies.sanitizeStableId(handoff.toolId) !== handoff.toolId || dependencies.sanitizeStableId(handoff.runtimeId) !== handoff.runtimeId ||
      !dependencies.isToolKind(handoff.toolKind) || !dependencies.isRuntimeKind(handoff.runtimeKind) ||
      !dependencies.isHandoffDeliveryKind(handoff.delivery) || !entryRef ||
      !dependencies.hasOnlyAllowedKeys(entryRef, HANDOFF_ENTRY_KEYS) || !dependencies.isToolKind(entryRef.type) ||
      (entryRef.transport !== undefined && !dependencies.isTransport(entryRef.transport)) || !dispatch ||
      !dependencies.hasOnlyAllowedKeys(dispatch, ['androidCanExecute', 'requiresPairedRuntime', 'usesNetworkTransport', 'usesStreamableHttp'])) return false
    if (handoff.projectId !== undefined && dependencies.sanitizeMetadata(handoff.projectId) !== handoff.projectId) return false
    if (entryRef.commandRef !== undefined && dependencies.sanitizeCommandRef(entryRef.commandRef) !== entryRef.commandRef) return false
    if (entryRef.mcpToolName !== undefined && dependencies.sanitizeMcpToolRef(entryRef.mcpToolName) !== entryRef.mcpToolName) return false
    if ((entryRef.executor === 'cli' || entryRef.type === 'cli') && !entryRef.commandRef) return false
    if (entryRef.executor === 'mcp' && entryRef.type === 'mcp' && !entryRef.mcpToolName) return false
    if (entryRef.type === 'app-action' && entryRef.commandRef !== undefined) return false
    if (entryRef.endpoint !== undefined && dependencies.sanitizeEndpointRef(entryRef.endpoint) !== entryRef.endpoint) return false
    if (!Array.isArray(handoff.permissions) || !Array.isArray(handoff.requiredCapabilities)) return false
    const permissions = dependencies.uniqueAllowedList(handoff.permissions, dependencies.permissions)
    const capabilities = dependencies.uniqueAllowedList(handoff.requiredCapabilities, dependencies.runtimeCapabilities)
    if (permissions.length !== handoff.permissions.length || capabilities.length !== handoff.requiredCapabilities.length) return false
    const payload = asRecord(handoff.payload)
    if (!payload || Object.keys(payload).length > 40 || !dependencies.isTrustedTaskPayloadKeyList(Object.keys(payload), 40)) return false
    if (!Array.isArray(handoff.payloadKeys)) return false
    const payloadKeys = dependencies.sanitizeTaskPayloadKeyList(handoff.payloadKeys)
    if (payloadKeys.length !== handoff.payloadKeys.length || !same([...payloadKeys].sort(), [...dependencies.createTaskPayloadKeys(payload)].sort())) return false
    const manifest = dependencies.findOfficialManifest(handoff.toolId)
    if (manifest) {
      if (handoff.toolVersion !== manifest.version || handoff.toolKind !== manifest.kind ||
        !same([...permissions].sort(), [...(manifest.permissions ?? [])].sort()) ||
        !same([...capabilities].sort(), [...dependencies.inferRequiredCapabilities(manifest)].sort())) return false
      const expectedEntryRef = dependencies.createRuntimeHandoffEntryRef(manifest)
      if (!runtimeHandoffEntryRefMatches(entryRef, expectedEntryRef)) return false
      const delivery = expectedRuntimeHandoffDelivery(manifest, handoff.runtimeKind)
      if (handoff.delivery !== delivery || !runtimeHandoffDispatchMatches(dispatch, delivery, asRecord(manifest.entry)?.transport)) return false
    } else if (!runtimeHandoffDispatchMatches(dispatch, handoff.delivery, entryRef.transport)) return false
    return dependencies.isTrustedConfirmedIntent(handoff.confirmedIntent, handoff.createdAt, permissions)
  }

  return { isTrustedRuntimeHandoff }
}
