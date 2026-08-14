export const PROVIDER_STATE_ISOLATION_COMPATIBILITY_EVAL_SCHEMA = 'islemind.provider-state-isolation-compatibility-eval.v1'
export const PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS = [
  'session-affinity-key-provider-model-conversation',
  'credential-group-binding-ttl',
  'responses-previous-response-provider-scope',
  'compact-state-provider-model-scope',
  'provider-tool-replay-same-provider',
  'session-lease-provider-model-session-scope',
  'fallback-same-provider-state-policy',
  'diagnostics-redacted-state-events',
  'blocked-cross-provider-response-id-replay',
  'blocked-cross-model-cache-continuation',
  'blocked-stale-session-affinity-binding',
  'blocked-tool-replay-id-mismatch',
  'blocked-raw-state-export',
  'blocked-unbounded-session-state',
] as const

export type ProviderStateIsolationFixtureId = typeof PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS[number]
export type ProviderStateIsolationSurface =
  | 'session-affinity'
  | 'responses-state'
  | 'compact-state'
  | 'tool-replay'
  | 'session-lease'
  | 'fallback'
  | 'diagnostics'
  | 'blocked'
export type ProviderStateIsolationReadiness = 'ready' | 'degraded' | 'blocked'
export type ProviderStateIsolationFailureCode =
  | 'missing-docs'
  | 'missing-provider-scope'
  | 'missing-model-scope'
  | 'missing-conversation-scope'
  | 'missing-session-scope'
  | 'missing-credential-group-scope'
  | 'missing-ttl'
  | 'missing-expiry-prune'
  | 'missing-health-invalidation'
  | 'missing-same-provider-policy'
  | 'cross-provider-state-replay'
  | 'cross-model-state-replay'
  | 'stale-session-binding'
  | 'tool-replay-id-mismatch'
  | 'raw-state-export'
  | 'unbounded-session-state'
  | 'missing-redaction'
  | 'missing-audit-event'
  | 'control-plane-network-call'

export interface ProviderStateIsolationPolicy {
  docsMapped: boolean
  providerScoped: boolean
  modelScoped: boolean
  conversationScoped: boolean
  sessionScoped: boolean
  credentialGroupScoped: boolean
  ttlMs: number
  expiryPruned: boolean
  maxBindings: number
  healthInvalidation: boolean
  sameProviderReplayOnly: boolean
  crossProviderReplayBlocked: boolean
  crossModelReplayBlocked: boolean
  previousResponseIdProviderMatch: boolean
  compactStateProviderModelMatch: boolean
  providerToolReplayIdMatch: boolean
  fallbackPreservesProviderStatePolicy: boolean
  rawStateExported: boolean
  redactionApplied: boolean
  auditEvent: boolean
  networkCallsAllowed: boolean
}

export interface ProviderStateIsolationFixture {
  id: ProviderStateIsolationFixtureId | string
  surface: ProviderStateIsolationSurface
  expectedReadiness: ProviderStateIsolationReadiness
  description: string
  policy: ProviderStateIsolationPolicy
}

export interface ProviderStateIsolationDiagnostic {
  fixtureId: string
  surface: ProviderStateIsolationSurface
  description: string
  readiness: ProviderStateIsolationReadiness
  policy: ProviderStateIsolationPolicy
  failureCodes: ProviderStateIsolationFailureCode[]
}

export interface ProviderStateIsolationCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: ProviderStateIsolationSurface[]
}

export interface ProviderStateIsolationCompatibilityEvaluationRun {
  schema: typeof PROVIDER_STATE_ISOLATION_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ProviderStateIsolationDiagnostic[]
  qualityGate: ProviderStateIsolationCompatibilityQualityGate
}

export interface ProviderStateIsolationCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ProviderStateIsolationFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_PROVIDER_STATE_POLICY: ProviderStateIsolationPolicy = {
  docsMapped: true,
  providerScoped: true,
  modelScoped: true,
  conversationScoped: true,
  sessionScoped: true,
  credentialGroupScoped: true,
  ttlMs: 30 * 60 * 1000,
  expiryPruned: true,
  maxBindings: 200,
  healthInvalidation: true,
  sameProviderReplayOnly: true,
  crossProviderReplayBlocked: true,
  crossModelReplayBlocked: true,
  previousResponseIdProviderMatch: true,
  compactStateProviderModelMatch: true,
  providerToolReplayIdMatch: true,
  fallbackPreservesProviderStatePolicy: true,
  rawStateExported: false,
  redactionApplied: true,
  auditEvent: true,
  networkCallsAllowed: false,
}

export const PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURES: ProviderStateIsolationFixture[] = [
  {
    id: 'session-affinity-key-provider-model-conversation',
    surface: 'session-affinity',
    expectedReadiness: 'ready',
    description: 'Session affinity keys include provider, requested model, conversation, and session identity before reuse.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'credential-group-binding-ttl',
    surface: 'session-affinity',
    expectedReadiness: 'ready',
    description: 'Credential-group bindings carry TTL, expiry pruning, health invalidation, and bounded in-memory storage.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'responses-previous-response-provider-scope',
    surface: 'responses-state',
    expectedReadiness: 'ready',
    description: 'Responses previous_response_id state is recorded only with provider, model, conversation, and response identity.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'compact-state-provider-model-scope',
    surface: 'compact-state',
    expectedReadiness: 'ready',
    description: 'Remote compact state lookup is scoped by conversation, provider, and model before reuse.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'provider-tool-replay-same-provider',
    surface: 'tool-replay',
    expectedReadiness: 'ready',
    description: 'Provider-native tool replay ids remain same-provider state and cannot be reused after provider fallback.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'session-lease-provider-model-session-scope',
    surface: 'session-lease',
    expectedReadiness: 'ready',
    description: 'Session concurrency leases are keyed by provider, model, conversation, and session id.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'fallback-same-provider-state-policy',
    surface: 'fallback',
    expectedReadiness: 'degraded',
    description: 'Fallback may continue only under same-provider state policy or with visible state reset.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'diagnostics-redacted-state-events',
    surface: 'diagnostics',
    expectedReadiness: 'ready',
    description: 'Route snapshots and session-affinity events record scoped state without raw provider state payloads.',
    policy: SAFE_PROVIDER_STATE_POLICY,
  },
  {
    id: 'blocked-cross-provider-response-id-replay',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Responses response ids are blocked when replay would cross provider identity.',
    policy: {
      ...SAFE_PROVIDER_STATE_POLICY,
      providerScoped: false,
      sameProviderReplayOnly: false,
      crossProviderReplayBlocked: false,
      previousResponseIdProviderMatch: false,
    },
  },
  {
    id: 'blocked-cross-model-cache-continuation',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Cache or compact continuation is blocked when requested model or upstream model scope changes.',
    policy: {
      ...SAFE_PROVIDER_STATE_POLICY,
      modelScoped: false,
      crossModelReplayBlocked: false,
      compactStateProviderModelMatch: false,
    },
  },
  {
    id: 'blocked-stale-session-affinity-binding',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Expired, disabled, missing, cooling-down, or model-ineligible session-affinity bindings are blocked.',
    policy: {
      ...SAFE_PROVIDER_STATE_POLICY,
      ttlMs: 0,
      expiryPruned: false,
      healthInvalidation: false,
    },
  },
  {
    id: 'blocked-tool-replay-id-mismatch',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Provider-native tool replay is blocked when replay ids do not match the current provider state scope.',
    policy: {
      ...SAFE_PROVIDER_STATE_POLICY,
      providerToolReplayIdMatch: false,
      sameProviderReplayOnly: false,
    },
  },
  {
    id: 'blocked-raw-state-export',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Raw provider state, response ids, cache items, or tool replay payloads are blocked from portable export and diagnostics.',
    policy: {
      ...SAFE_PROVIDER_STATE_POLICY,
      rawStateExported: true,
      redactionApplied: false,
    },
  },
  {
    id: 'blocked-unbounded-session-state',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Session state is blocked when affinity binding count or TTL is unbounded.',
    policy: {
      ...SAFE_PROVIDER_STATE_POLICY,
      ttlMs: Number.POSITIVE_INFINITY,
      maxBindings: 0,
      expiryPruned: false,
    },
  },
]

export function runProviderStateIsolationCompatibilityEvaluation(
  options: ProviderStateIsolationCompatibilityEvaluationOptions = {},
): ProviderStateIsolationCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateProviderStateIsolationFixture)
  return {
    schema: PROVIDER_STATE_ISOLATION_COMPATIBILITY_EVAL_SCHEMA,
    id: `provider-state-isolation-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateProviderStateIsolationCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateProviderStateIsolationFixture(
  fixture: ProviderStateIsolationFixture,
): ProviderStateIsolationDiagnostic {
  const failureCodes = collectProviderStateIsolationFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    description: fixture.description,
    readiness: resolveProviderStateIsolationReadiness(fixture, failureCodes),
    policy: fixture.policy,
    failureCodes,
  }
}

export function evaluateProviderStateIsolationCompatibilityQualityGate(
  diagnostics: ProviderStateIsolationDiagnostic[],
  requiredFixtureIds: string[] = [...PROVIDER_STATE_ISOLATION_COMPATIBILITY_FIXTURE_IDS],
): ProviderStateIsolationCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: ProviderStateIsolationSurface[] = [
    'session-affinity',
    'responses-state',
    'compact-state',
    'tool-replay',
    'session-lease',
    'fallback',
    'diagnostics',
    'blocked',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }

  requireReady(byId.get('session-affinity-key-provider-model-conversation'), failures)
  requireReady(byId.get('credential-group-binding-ttl'), failures)
  requireReady(byId.get('responses-previous-response-provider-scope'), failures, { requireResponsesState: true })
  requireReady(byId.get('compact-state-provider-model-scope'), failures, { requireCompactState: true })
  requireReady(byId.get('provider-tool-replay-same-provider'), failures, { requireToolReplay: true })
  requireReady(byId.get('session-lease-provider-model-session-scope'), failures)
  requireReady(byId.get('diagnostics-redacted-state-events'), failures, { requireDiagnostics: true })
  requireDegraded(byId.get('fallback-same-provider-state-policy'), failures, 'fallback-same-provider-state-policy')

  requireBlocked(byId.get('blocked-cross-provider-response-id-replay'), failures, 'blocked-cross-provider-response-id-replay', [
    'missing-provider-scope',
    'missing-same-provider-policy',
    'cross-provider-state-replay',
  ])
  requireBlocked(byId.get('blocked-cross-model-cache-continuation'), failures, 'blocked-cross-model-cache-continuation', [
    'missing-model-scope',
    'cross-model-state-replay',
  ])
  requireBlocked(byId.get('blocked-stale-session-affinity-binding'), failures, 'blocked-stale-session-affinity-binding', [
    'missing-ttl',
    'missing-expiry-prune',
    'missing-health-invalidation',
    'stale-session-binding',
  ])
  requireBlocked(byId.get('blocked-tool-replay-id-mismatch'), failures, 'blocked-tool-replay-id-mismatch', [
    'missing-same-provider-policy',
    'tool-replay-id-mismatch',
  ])
  requireBlocked(byId.get('blocked-raw-state-export'), failures, 'blocked-raw-state-export', [
    'raw-state-export',
    'missing-redaction',
  ])
  requireBlocked(byId.get('blocked-unbounded-session-state'), failures, 'blocked-unbounded-session-state', [
    'missing-ttl',
    'missing-expiry-prune',
    'unbounded-session-state',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
  }
}

function requireReady(
  item: ProviderStateIsolationDiagnostic | undefined,
  failures: string[],
  options: { requireResponsesState?: boolean; requireCompactState?: boolean; requireToolReplay?: boolean; requireDiagnostics?: boolean } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselineProviderStatePolicy(item, failures)
  if (options.requireResponsesState && !item.policy.previousResponseIdProviderMatch) failures.push(`${item.fixtureId}:previous-response-provider-mismatch`)
  if (options.requireCompactState && !item.policy.compactStateProviderModelMatch) failures.push(`${item.fixtureId}:compact-state-scope-mismatch`)
  if (options.requireToolReplay && !item.policy.providerToolReplayIdMatch) failures.push(`${item.fixtureId}:tool-replay-id-mismatch`)
  if (options.requireDiagnostics && (!item.policy.redactionApplied || !item.policy.auditEvent)) failures.push(`${item.fixtureId}:missing-diagnostics-policy`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: ProviderStateIsolationDiagnostic | undefined,
  failures: string[],
  id: string,
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselineProviderStatePolicy(item, failures)
  if (!item.policy.fallbackPreservesProviderStatePolicy) failures.push(`${id}:missing-fallback-state-policy`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselineProviderStatePolicy(item: ProviderStateIsolationDiagnostic, failures: string[]): void {
  const policy = item.policy
  if (!policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (!policy.providerScoped) failures.push(`${item.fixtureId}:missing-provider-scope`)
  if (!policy.modelScoped) failures.push(`${item.fixtureId}:missing-model-scope`)
  if (!policy.conversationScoped) failures.push(`${item.fixtureId}:missing-conversation-scope`)
  if (!policy.sessionScoped) failures.push(`${item.fixtureId}:missing-session-scope`)
  if (!policy.credentialGroupScoped) failures.push(`${item.fixtureId}:missing-credential-group-scope`)
  if (!Number.isFinite(policy.ttlMs) || policy.ttlMs <= 0) failures.push(`${item.fixtureId}:missing-ttl`)
  if (!policy.expiryPruned) failures.push(`${item.fixtureId}:missing-expiry-prune`)
  if (policy.maxBindings <= 0) failures.push(`${item.fixtureId}:unbounded-session-state`)
  if (!policy.healthInvalidation) failures.push(`${item.fixtureId}:missing-health-invalidation`)
  if (!policy.sameProviderReplayOnly) failures.push(`${item.fixtureId}:missing-same-provider-policy`)
  if (!policy.crossProviderReplayBlocked) failures.push(`${item.fixtureId}:cross-provider-state-replay`)
  if (!policy.crossModelReplayBlocked) failures.push(`${item.fixtureId}:cross-model-state-replay`)
  if (policy.rawStateExported) failures.push(`${item.fixtureId}:raw-state-export`)
  if (!policy.redactionApplied) failures.push(`${item.fixtureId}:missing-redaction`)
  if (!policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit-event`)
  if (policy.networkCallsAllowed) failures.push(`${item.fixtureId}:control-plane-network-call`)
}

function requireBlocked(
  item: ProviderStateIsolationDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ProviderStateIsolationFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectProviderStateIsolationFailureCodes(
  fixture: ProviderStateIsolationFixture,
): ProviderStateIsolationFailureCode[] {
  const policy = fixture.policy
  const failures: ProviderStateIsolationFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (!policy.providerScoped) failures.push('missing-provider-scope')
  if (!policy.modelScoped) failures.push('missing-model-scope')
  if (!policy.conversationScoped) failures.push('missing-conversation-scope')
  if (!policy.sessionScoped) failures.push('missing-session-scope')
  if (!policy.credentialGroupScoped) failures.push('missing-credential-group-scope')
  if (!Number.isFinite(policy.ttlMs) || policy.ttlMs <= 0) failures.push('missing-ttl')
  if (!policy.expiryPruned) failures.push('missing-expiry-prune')
  if (policy.maxBindings <= 0) failures.push('unbounded-session-state')
  if (!policy.healthInvalidation) failures.push('missing-health-invalidation')
  if (!policy.sameProviderReplayOnly) failures.push('missing-same-provider-policy')
  if (!policy.crossProviderReplayBlocked || !policy.previousResponseIdProviderMatch) failures.push('cross-provider-state-replay')
  if (!policy.crossModelReplayBlocked || !policy.compactStateProviderModelMatch) failures.push('cross-model-state-replay')
  if (!policy.providerToolReplayIdMatch) failures.push('tool-replay-id-mismatch')
  if ((!Number.isFinite(policy.ttlMs) || policy.ttlMs <= 0 || !policy.expiryPruned || !policy.healthInvalidation) && fixture.surface === 'blocked') failures.push('stale-session-binding')
  if (policy.rawStateExported) failures.push('raw-state-export')
  if (!policy.redactionApplied) failures.push('missing-redaction')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveProviderStateIsolationReadiness(
  fixture: ProviderStateIsolationFixture,
  failureCodes: ProviderStateIsolationFailureCode[],
): ProviderStateIsolationReadiness {
  if (failureCodes.length > 0 || fixture.expectedReadiness === 'blocked') return 'blocked'
  if (fixture.expectedReadiness === 'degraded') return 'degraded'
  return 'ready'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
