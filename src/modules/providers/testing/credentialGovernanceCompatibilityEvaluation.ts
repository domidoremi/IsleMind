export const CREDENTIAL_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA = 'islemind.credential-governance-compatibility-eval.v1'
export const CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS = [
  'native-secure-provider-key-storage',
  'credential-group-secure-storage',
  'model-scoped-credential-selection',
  'credential-health-routing',
  'imported-credential-secure-restore',
  'hosted-auth-scope',
  'observability-sink-secure-opt-in',
  'proxy-url-credential-sanitization',
  'runtime-diagnostics-redaction',
  'portable-export-secret-elision',
  'destructive-reset-secret-cleanup',
  'blocked-plaintext-provider-key',
  'blocked-credential-in-url',
  'blocked-runtime-diagnostics-secret-leak',
  'blocked-cross-provider-credential-replay',
  'blocked-observability-export-without-consent',
] as const

export type CredentialGovernanceFixtureId = typeof CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS[number]
export type CredentialGovernanceSurface =
  | 'provider-key'
  | 'credential-group'
  | 'provider-routing'
  | 'hosted-auth'
  | 'observability'
  | 'proxy'
  | 'runtime-diagnostics'
  | 'export-restore'
  | 'data-reset'
  | 'blocked'
export type CredentialGovernanceReadiness = 'ready' | 'degraded' | 'blocked'
export type CredentialGovernanceStorageBackend = 'native-secure-store' | 'web-prefixed-secure-fallback' | 'plaintext-storage' | 'unknown'
export type CredentialGovernanceFailureCode =
  | 'missing-docs'
  | 'insecure-storage'
  | 'plaintext-persisted-key'
  | 'missing-provider-scope'
  | 'missing-credential-group-scope'
  | 'missing-model-scoped-selection'
  | 'missing-health-routing'
  | 'missing-hosted-auth-scope'
  | 'missing-region-resource-scope'
  | 'missing-observability-opt-in'
  | 'missing-observability-consent'
  | 'missing-observability-secure-key'
  | 'unsafe-proxy-url'
  | 'credential-in-url'
  | 'missing-runtime-redaction'
  | 'export-leaks-secret'
  | 'import-does-not-secure-secrets'
  | 'reset-retains-secret'
  | 'cross-provider-credential-replay'
  | 'control-plane-network-call'

export interface CredentialGovernancePolicy {
  docsMapped: boolean
  storageBackend: CredentialGovernanceStorageBackend
  plaintextPersisted: boolean
  providerScoped: boolean
  credentialGroupScoped: boolean
  modelScopedSelection: boolean
  healthScopedRouting: boolean
  cooldownOrCircuitBreaker: boolean
  importedSecretsStoredSecurely: boolean
  portableExportIncludesSecrets: boolean
  hostedAuthScoped: boolean
  regionResourceDeploymentScoped: boolean
  observabilityApiKeySecure: boolean
  observabilityOptIn: boolean
  observabilityWorkspaceConsent: boolean
  proxyUrlSanitized: boolean
  urlUserInfoBlocked: boolean
  queryCredentialBlocked: boolean
  runtimeLogRedaction: boolean
  runtimeEventRedaction: boolean
  destructiveResetClearsKnownKeys: boolean
  crossProviderCredentialReplayBlocked: boolean
  networkCallsAllowed: boolean
}

export interface CredentialGovernanceFixture {
  id: CredentialGovernanceFixtureId | string
  surface: CredentialGovernanceSurface
  expectedReadiness: CredentialGovernanceReadiness
  description: string
  policy: CredentialGovernancePolicy
}

export interface CredentialGovernanceDiagnostic {
  fixtureId: string
  surface: CredentialGovernanceSurface
  description: string
  readiness: CredentialGovernanceReadiness
  policy: CredentialGovernancePolicy
  failureCodes: CredentialGovernanceFailureCode[]
}

export interface CredentialGovernanceCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: CredentialGovernanceSurface[]
}

export interface CredentialGovernanceCompatibilityEvaluationRun {
  schema: typeof CREDENTIAL_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: CredentialGovernanceDiagnostic[]
  qualityGate: CredentialGovernanceCompatibilityQualityGate
}

export interface CredentialGovernanceCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: CredentialGovernanceFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_CREDENTIAL_GOVERNANCE_POLICY: CredentialGovernancePolicy = {
  docsMapped: true,
  storageBackend: 'native-secure-store',
  plaintextPersisted: false,
  providerScoped: true,
  credentialGroupScoped: true,
  modelScopedSelection: true,
  healthScopedRouting: true,
  cooldownOrCircuitBreaker: true,
  importedSecretsStoredSecurely: true,
  portableExportIncludesSecrets: false,
  hostedAuthScoped: true,
  regionResourceDeploymentScoped: true,
  observabilityApiKeySecure: true,
  observabilityOptIn: true,
  observabilityWorkspaceConsent: true,
  proxyUrlSanitized: true,
  urlUserInfoBlocked: true,
  queryCredentialBlocked: true,
  runtimeLogRedaction: true,
  runtimeEventRedaction: true,
  destructiveResetClearsKnownKeys: true,
  crossProviderCredentialReplayBlocked: true,
  networkCallsAllowed: false,
}

export const CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURES: CredentialGovernanceFixture[] = [
  {
    id: 'native-secure-provider-key-storage',
    surface: 'provider-key',
    expectedReadiness: 'ready',
    description: 'Provider API keys persist through native secure storage and leave only configured state in settings.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'credential-group-secure-storage',
    surface: 'credential-group',
    expectedReadiness: 'ready',
    description: 'Credential groups persist secrets under provider and group scoped secure keys.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'model-scoped-credential-selection',
    surface: 'provider-routing',
    expectedReadiness: 'ready',
    description: 'Model routing chooses enabled credentials scoped to model availability and excludes failed groups.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'credential-health-routing',
    surface: 'provider-routing',
    expectedReadiness: 'ready',
    description: 'Credential health, failure counts, cooldown, and circuit state stay scoped to provider routing decisions.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'imported-credential-secure-restore',
    surface: 'export-restore',
    expectedReadiness: 'ready',
    description: 'Full restore imports provider and credential-group secrets into secure storage before sanitized provider records are persisted.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'hosted-auth-scope',
    surface: 'hosted-auth',
    expectedReadiness: 'degraded',
    description: 'Hosted providers remain explicit about auth, region, resource, and deployment identity until each route is fully implemented.',
    policy: {
      ...SAFE_CREDENTIAL_GOVERNANCE_POLICY,
      storageBackend: 'web-prefixed-secure-fallback',
    },
  },
  {
    id: 'observability-sink-secure-opt-in',
    surface: 'observability',
    expectedReadiness: 'ready',
    description: 'Observability sink API keys use secure storage and external export requires user opt-in and workspace consent.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'proxy-url-credential-sanitization',
    surface: 'proxy',
    expectedReadiness: 'ready',
    description: 'Proxy URLs block userinfo credentials and runtime logs redact credential query parameters.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'runtime-diagnostics-redaction',
    surface: 'runtime-diagnostics',
    expectedReadiness: 'ready',
    description: 'Runtime logs and event persistence redact authorization headers, API keys, credential assignments, query secrets, and payload summaries.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'portable-export-secret-elision',
    surface: 'export-restore',
    expectedReadiness: 'ready',
    description: 'Portable export serializes sanitized providers and settings without provider keys, credential-group keys, or observability sink keys.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'destructive-reset-secret-cleanup',
    surface: 'data-reset',
    expectedReadiness: 'ready',
    description: 'Destructive local reset clears known provider, credential-group, search-provider, and observability secure keys.',
    policy: SAFE_CREDENTIAL_GOVERNANCE_POLICY,
  },
  {
    id: 'blocked-plaintext-provider-key',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Plaintext provider keys in persisted settings or provider records are blocked.',
    policy: {
      ...SAFE_CREDENTIAL_GOVERNANCE_POLICY,
      storageBackend: 'plaintext-storage',
      plaintextPersisted: true,
    },
  },
  {
    id: 'blocked-credential-in-url',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Credentials in proxy URLs, endpoint userinfo, or query parameters are blocked before diagnostics or request execution.',
    policy: {
      ...SAFE_CREDENTIAL_GOVERNANCE_POLICY,
      proxyUrlSanitized: false,
      urlUserInfoBlocked: false,
      queryCredentialBlocked: false,
    },
  },
  {
    id: 'blocked-runtime-diagnostics-secret-leak',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Runtime diagnostics that would persist secrets or raw credential payloads are blocked.',
    policy: {
      ...SAFE_CREDENTIAL_GOVERNANCE_POLICY,
      runtimeLogRedaction: false,
      runtimeEventRedaction: false,
    },
  },
  {
    id: 'blocked-cross-provider-credential-replay',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Credential reuse across provider ids, hosted routes, or credential groups is blocked.',
    policy: {
      ...SAFE_CREDENTIAL_GOVERNANCE_POLICY,
      providerScoped: false,
      credentialGroupScoped: false,
      hostedAuthScoped: false,
      crossProviderCredentialReplayBlocked: false,
    },
  },
  {
    id: 'blocked-observability-export-without-consent',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'External observability export is blocked when API key storage, user opt-in, or workspace consent is missing.',
    policy: {
      ...SAFE_CREDENTIAL_GOVERNANCE_POLICY,
      observabilityApiKeySecure: false,
      observabilityOptIn: false,
      observabilityWorkspaceConsent: false,
    },
  },
]

export function runCredentialGovernanceCompatibilityEvaluation(
  options: CredentialGovernanceCompatibilityEvaluationOptions = {},
): CredentialGovernanceCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateCredentialGovernanceFixture)
  return {
    schema: CREDENTIAL_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA,
    id: `credential-governance-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateCredentialGovernanceCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateCredentialGovernanceFixture(
  fixture: CredentialGovernanceFixture,
): CredentialGovernanceDiagnostic {
  const failureCodes = collectCredentialGovernanceFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    description: fixture.description,
    readiness: resolveCredentialGovernanceReadiness(fixture, failureCodes),
    policy: fixture.policy,
    failureCodes,
  }
}

export function evaluateCredentialGovernanceCompatibilityQualityGate(
  diagnostics: CredentialGovernanceDiagnostic[],
  requiredFixtureIds: string[] = [...CREDENTIAL_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS],
): CredentialGovernanceCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: CredentialGovernanceSurface[] = [
    'provider-key',
    'credential-group',
    'provider-routing',
    'hosted-auth',
    'observability',
    'proxy',
    'runtime-diagnostics',
    'export-restore',
    'data-reset',
    'blocked',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }

  requireReady(byId.get('native-secure-provider-key-storage'), failures, { allowUngrouped: true })
  requireReady(byId.get('credential-group-secure-storage'), failures)
  requireReady(byId.get('model-scoped-credential-selection'), failures, { requireModelScopedSelection: true })
  requireReady(byId.get('credential-health-routing'), failures, { requireHealthRouting: true })
  requireReady(byId.get('imported-credential-secure-restore'), failures, { requireImportRestore: true })
  requireReady(byId.get('observability-sink-secure-opt-in'), failures, { requireObservabilityConsent: true })
  requireReady(byId.get('proxy-url-credential-sanitization'), failures, { requireProxySanitization: true })
  requireReady(byId.get('runtime-diagnostics-redaction'), failures, { requireRuntimeRedaction: true })
  requireReady(byId.get('portable-export-secret-elision'), failures, { requireExportElision: true })
  requireReady(byId.get('destructive-reset-secret-cleanup'), failures, { requireResetCleanup: true })
  requireDegraded(byId.get('hosted-auth-scope'), failures, 'hosted-auth-scope')

  requireBlocked(byId.get('blocked-plaintext-provider-key'), failures, 'blocked-plaintext-provider-key', [
    'insecure-storage',
    'plaintext-persisted-key',
  ])
  requireBlocked(byId.get('blocked-credential-in-url'), failures, 'blocked-credential-in-url', [
    'unsafe-proxy-url',
    'credential-in-url',
  ])
  requireBlocked(byId.get('blocked-runtime-diagnostics-secret-leak'), failures, 'blocked-runtime-diagnostics-secret-leak', [
    'missing-runtime-redaction',
  ])
  requireBlocked(byId.get('blocked-cross-provider-credential-replay'), failures, 'blocked-cross-provider-credential-replay', [
    'missing-provider-scope',
    'missing-credential-group-scope',
    'missing-hosted-auth-scope',
    'cross-provider-credential-replay',
  ])
  requireBlocked(byId.get('blocked-observability-export-without-consent'), failures, 'blocked-observability-export-without-consent', [
    'missing-observability-secure-key',
    'missing-observability-opt-in',
    'missing-observability-consent',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
  }
}

function requireReady(
  item: CredentialGovernanceDiagnostic | undefined,
  failures: string[],
  options: {
    allowUngrouped?: boolean
    requireModelScopedSelection?: boolean
    requireHealthRouting?: boolean
    requireImportRestore?: boolean
    requireObservabilityConsent?: boolean
    requireProxySanitization?: boolean
    requireRuntimeRedaction?: boolean
    requireExportElision?: boolean
    requireResetCleanup?: boolean
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselineCredentialPolicy(item, failures, options)
  if (options.requireModelScopedSelection && !item.policy.modelScopedSelection) failures.push(`${item.fixtureId}:missing-model-scoped-selection`)
  if (options.requireHealthRouting && (!item.policy.healthScopedRouting || !item.policy.cooldownOrCircuitBreaker)) failures.push(`${item.fixtureId}:missing-health-routing`)
  if (options.requireImportRestore && !item.policy.importedSecretsStoredSecurely) failures.push(`${item.fixtureId}:import-does-not-secure-secrets`)
  if (options.requireObservabilityConsent && (!item.policy.observabilityApiKeySecure || !item.policy.observabilityOptIn || !item.policy.observabilityWorkspaceConsent)) {
    failures.push(`${item.fixtureId}:missing-observability-consent`)
  }
  if (options.requireProxySanitization && (!item.policy.proxyUrlSanitized || !item.policy.urlUserInfoBlocked || !item.policy.queryCredentialBlocked)) failures.push(`${item.fixtureId}:unsafe-proxy-url`)
  if (options.requireRuntimeRedaction && (!item.policy.runtimeLogRedaction || !item.policy.runtimeEventRedaction)) failures.push(`${item.fixtureId}:missing-runtime-redaction`)
  if (options.requireExportElision && item.policy.portableExportIncludesSecrets) failures.push(`${item.fixtureId}:export-leaks-secret`)
  if (options.requireResetCleanup && !item.policy.destructiveResetClearsKnownKeys) failures.push(`${item.fixtureId}:reset-retains-secret`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: CredentialGovernanceDiagnostic | undefined,
  failures: string[],
  id: string,
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselineCredentialPolicy(item, failures)
  if (!item.policy.hostedAuthScoped || !item.policy.regionResourceDeploymentScoped) failures.push(`${id}:missing-hosted-scope`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselineCredentialPolicy(
  item: CredentialGovernanceDiagnostic,
  failures: string[],
  options: { allowUngrouped?: boolean } = {},
): void {
  const policy = item.policy
  if (!policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (policy.storageBackend === 'plaintext-storage' || policy.storageBackend === 'unknown') failures.push(`${item.fixtureId}:insecure-storage`)
  if (policy.plaintextPersisted) failures.push(`${item.fixtureId}:plaintext-persisted-key`)
  if (!policy.providerScoped) failures.push(`${item.fixtureId}:missing-provider-scope`)
  if (!options.allowUngrouped && !policy.credentialGroupScoped) failures.push(`${item.fixtureId}:missing-credential-group-scope`)
  if (policy.portableExportIncludesSecrets) failures.push(`${item.fixtureId}:export-leaks-secret`)
  if (!policy.importedSecretsStoredSecurely) failures.push(`${item.fixtureId}:import-does-not-secure-secrets`)
  if (!policy.destructiveResetClearsKnownKeys) failures.push(`${item.fixtureId}:reset-retains-secret`)
  if (!policy.runtimeLogRedaction || !policy.runtimeEventRedaction) failures.push(`${item.fixtureId}:missing-runtime-redaction`)
  if (!policy.crossProviderCredentialReplayBlocked) failures.push(`${item.fixtureId}:cross-provider-credential-replay`)
  if (policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
}

function requireBlocked(
  item: CredentialGovernanceDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: CredentialGovernanceFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectCredentialGovernanceFailureCodes(fixture: CredentialGovernanceFixture): CredentialGovernanceFailureCode[] {
  const policy = fixture.policy
  const failures: CredentialGovernanceFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (policy.storageBackend === 'plaintext-storage' || policy.storageBackend === 'unknown') failures.push('insecure-storage')
  if (policy.plaintextPersisted) failures.push('plaintext-persisted-key')
  if (!policy.providerScoped) failures.push('missing-provider-scope')
  if (!policy.credentialGroupScoped) failures.push('missing-credential-group-scope')
  if (!policy.modelScopedSelection) failures.push('missing-model-scoped-selection')
  if (!policy.healthScopedRouting || !policy.cooldownOrCircuitBreaker) failures.push('missing-health-routing')
  if (!policy.hostedAuthScoped) failures.push('missing-hosted-auth-scope')
  if (!policy.regionResourceDeploymentScoped) failures.push('missing-region-resource-scope')
  if (!policy.observabilityApiKeySecure) failures.push('missing-observability-secure-key')
  if (!policy.observabilityOptIn) failures.push('missing-observability-opt-in')
  if (!policy.observabilityWorkspaceConsent) failures.push('missing-observability-consent')
  if (!policy.proxyUrlSanitized) failures.push('unsafe-proxy-url')
  if (!policy.urlUserInfoBlocked || !policy.queryCredentialBlocked) failures.push('credential-in-url')
  if (!policy.runtimeLogRedaction || !policy.runtimeEventRedaction) failures.push('missing-runtime-redaction')
  if (policy.portableExportIncludesSecrets) failures.push('export-leaks-secret')
  if (!policy.importedSecretsStoredSecurely) failures.push('import-does-not-secure-secrets')
  if (!policy.destructiveResetClearsKnownKeys) failures.push('reset-retains-secret')
  if (!policy.crossProviderCredentialReplayBlocked) failures.push('cross-provider-credential-replay')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveCredentialGovernanceReadiness(
  fixture: CredentialGovernanceFixture,
  failureCodes: CredentialGovernanceFailureCode[],
): CredentialGovernanceReadiness {
  if (failureCodes.length > 0 || fixture.expectedReadiness === 'blocked') return 'blocked'
  if (fixture.expectedReadiness === 'degraded') return 'degraded'
  return 'ready'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
