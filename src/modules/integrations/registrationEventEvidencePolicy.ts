type UnknownRecord = Record<string, any>

export type RegistrationEventEvidencePolicyDependencies = {
  limits: { eventEntries: number; eventKeys: number; intentItems: number }
  permissions: readonly string[]
  runtimeCapabilities: readonly string[]
  registrationKinds: readonly string[]
  registeredCatalogStatuses: readonly string[]
  installActionKinds: readonly string[]
  sanitizeStableId(input: unknown): string | undefined
  sanitizeDependencyKeys(input: unknown): string[]
  sanitizePairingToolIds(input: unknown): string[]
  sanitizeCapabilities(input: unknown): string[]
  cleanPublicText(input: unknown): string
  isUnsafePublicText(input: unknown): boolean
  stableIdentityString(input: unknown): string
  isVersion(input: unknown): boolean
  isPermission(input: unknown): boolean
  isInstallActionKind(input: unknown): boolean
  isToolKind(input: unknown): boolean
  isRuntimeKind(input: unknown): boolean
  isAndroidDisposition(input: unknown): boolean
  isTrustedRuntimeCapabilityList(input: unknown): boolean
  isTrustedRuntimeTransportList(input: unknown): boolean
  permissionGrantScopeKinds(permission: string): readonly string[]
}

const asRecord = (input: unknown): UnknownRecord | undefined =>
  input && typeof input === 'object' && !Array.isArray(input) ? input as UnknownRecord : undefined

const hasOnlyAllowedKeys = (input: unknown, keys: readonly string[]): boolean => {
  const record = asRecord(input)
  if (!record) return false
  const allowed = new Set(keys)
  return Object.keys(record).every((key) => allowed.has(key))
}

const uniqueStrings = (input: readonly unknown[]): string[] =>
  Array.from(new Set(input.filter((item): item is string => typeof item === 'string' && Boolean(item))))

export function createRegistrationEventEvidencePolicy(dependencies: RegistrationEventEvidencePolicyDependencies) {
  const same = (left: unknown, right: unknown) =>
    dependencies.stableIdentityString(left) === dependencies.stableIdentityString(right)

  function isTrustedStableIdList(input: unknown, limit: number): input is string[] {
    if (!Array.isArray(input) || input.length > limit) return false
    const cleaned = uniqueStrings(input)
    return cleaned.length === input.length &&
      cleaned.every((item) => dependencies.sanitizeStableId(item) === item) &&
      same(cleaned, input)
  }

  function isTrustedDependencyKeyList(input: unknown, limit: number): input is string[] {
    if (!Array.isArray(input) || input.length > limit) return false
    const sanitized = dependencies.sanitizeDependencyKeys(input)
    return sanitized.length === input.length && same(sanitized, input)
  }

  function isTrustedPermissionList(input: unknown): input is string[] {
    return Array.isArray(input) && input.length <= dependencies.limits.eventKeys &&
      uniqueStrings(input.filter(dependencies.isPermission)).length === input.length
  }

  function isTrustedInstallActionKindList(input: unknown): input is string[] {
    return Array.isArray(input) && input.length <= dependencies.limits.eventKeys &&
      uniqueStrings(input.filter(dependencies.isInstallActionKind)).length === input.length
  }

  function isTrustedBlockedReasons(input: unknown): input is string[] {
    if (!Array.isArray(input) || input.length > dependencies.limits.intentItems) return false
    const cleaned = uniqueStrings(input)
    return cleaned.length === input.length && same(cleaned, input) &&
      cleaned.every((reason) => dependencies.cleanPublicText(reason) === reason && !dependencies.isUnsafePublicText(reason))
  }

  function isTrustedRegisteredCatalogEntry(input: unknown): boolean {
    const entry = asRecord(input)
    return Boolean(entry) && hasOnlyAllowedKeys(entry, [
      'registrationId', 'toolId', 'title', 'version', 'kind', 'registrationKind', 'status',
      'runtimeId', 'runtimeKind', 'androidDisposition', 'registeredAt', 'permissions',
      'requiredCapabilities', 'transports', 'blockedReasons',
    ]) &&
      dependencies.sanitizeStableId(entry!.registrationId) === entry!.registrationId &&
      dependencies.sanitizeStableId(entry!.toolId) === entry!.toolId &&
      dependencies.cleanPublicText(entry!.title) === entry!.title &&
      !dependencies.isUnsafePublicText(entry!.title) && dependencies.isVersion(entry!.version) &&
      dependencies.isToolKind(entry!.kind) && dependencies.registrationKinds.includes(entry!.registrationKind) &&
      dependencies.registeredCatalogStatuses.includes(entry!.status) &&
      (entry!.runtimeId === undefined || dependencies.sanitizeStableId(entry!.runtimeId) === entry!.runtimeId) &&
      (entry!.runtimeKind === undefined || dependencies.isRuntimeKind(entry!.runtimeKind)) &&
      dependencies.isAndroidDisposition(entry!.androidDisposition) && Number.isFinite(entry!.registeredAt) &&
      isTrustedPermissionList(entry!.permissions) &&
      dependencies.isTrustedRuntimeCapabilityList(entry!.requiredCapabilities) &&
      dependencies.isTrustedRuntimeTransportList(entry!.transports) &&
      isTrustedBlockedReasons(entry!.blockedReasons)
  }

  function isTrustedPermissionGrantProposal(input: unknown, applicationInput: unknown): boolean {
    const proposal = asRecord(input)
    const application = asRecord(applicationInput)
    if (!proposal || !application || !hasOnlyAllowedKeys(proposal, [
      'permission', 'runtimeId', 'projectId', 'toolIds', 'requiresScope', 'scopeKinds',
    ]) || !dependencies.isPermission(proposal.permission)) return false
    if (proposal.projectId !== undefined && proposal.projectId !== application.projectId) return false
    if (proposal.runtimeId !== undefined && (
      dependencies.sanitizeStableId(proposal.runtimeId) !== proposal.runtimeId ||
      !Array.isArray(application.runtimeIds) || !application.runtimeIds.includes(proposal.runtimeId)
    )) return false
    if (!isTrustedStableIdList(proposal.toolIds, dependencies.limits.eventEntries)) return false
    if (!Array.isArray(application.toolIds) || !proposal.toolIds.every((toolId: string) => application.toolIds.includes(toolId))) return false
    const expectedScopeKinds = dependencies.permissionGrantScopeKinds(proposal.permission)
    return proposal.requiresScope === (expectedScopeKinds.length > 0) &&
      Array.isArray(proposal.scopeKinds) && same(uniqueStrings(proposal.scopeKinds), expectedScopeKinds)
  }

  function isTrustedRuntimePairingRequestInput(input: unknown): boolean {
    const request = asRecord(input)
    if (!request || !hasOnlyAllowedKeys(request, [
      'requiresRuntimePairing', 'toolIds', 'runtimeIds', 'dependencyKeys', 'capabilityKeys',
    ])) return false
    const toolIds = dependencies.sanitizePairingToolIds(request.toolIds)
    const runtimeIds = dependencies.sanitizePairingToolIds(request.runtimeIds)
    const dependencyKeys = dependencies.sanitizeDependencyKeys(request.dependencyKeys)
    const capabilityKeys = uniqueStrings(dependencies.sanitizeCapabilities(request.capabilityKeys)).slice(0, dependencies.limits.eventKeys)
    return request.requiresRuntimePairing === true && Array.isArray(request.toolIds) && same(toolIds, request.toolIds) &&
      Array.isArray(request.runtimeIds) && same(runtimeIds, request.runtimeIds) &&
      Array.isArray(request.dependencyKeys) && same(dependencyKeys, request.dependencyKeys) &&
      Array.isArray(request.capabilityKeys) && same(capabilityKeys, request.capabilityKeys)
  }

  function isTrustedRuntimePairingRequest(input: unknown, applicationInput: unknown): boolean {
    const request = asRecord(input)
    const application = asRecord(applicationInput)
    return Boolean(request && application) && isTrustedRuntimePairingRequestInput(request) &&
      request!.toolIds.every((toolId: string) => application!.toolIds.includes(toolId)) &&
      request!.runtimeIds.every((runtimeId: string) => application!.runtimeIds.includes(runtimeId)) &&
      same(request!.dependencyKeys, application!.dependencies)
  }

  function isTrustedManifestReviewRequest(input: unknown, applicationInput: unknown): boolean {
    const request = asRecord(input)
    const application = asRecord(applicationInput)
    return Boolean(request && application) && hasOnlyAllowedKeys(request, ['toolIds', 'issueCount', 'blockedReasons']) &&
      isTrustedStableIdList(request!.toolIds, dependencies.limits.eventEntries) &&
      request!.toolIds.every((toolId: string) => application!.toolIds.includes(toolId)) &&
      Number.isInteger(request!.issueCount) && request!.issueCount >= 0 &&
      isTrustedBlockedReasons(request!.blockedReasons) && request!.issueCount === request!.blockedReasons.length
  }

  return {
    isTrustedRegisteredCatalogEntry,
    isTrustedStableIdList,
    isTrustedPermissionList,
    isTrustedDependencyKeyList,
    isTrustedInstallActionKindList,
    isTrustedPermissionGrantProposal,
    isTrustedRuntimePairingRequest,
    isTrustedRuntimePairingRequestInput,
    isTrustedManifestReviewRequest,
    isTrustedBlockedReasons,
  }
}
