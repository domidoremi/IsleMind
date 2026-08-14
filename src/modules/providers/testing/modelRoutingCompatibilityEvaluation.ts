export const MODEL_ROUTING_COMPATIBILITY_EVAL_SCHEMA = 'islemind.model-routing-compatibility-eval.v1'
export const MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS = [
  'cheap-intent-classifier-small-model',
  'privacy-local-embedding-route',
  'reasoning-upgrade-route',
  'vision-capability-route',
  'structured-output-model-gated-route',
  'tool-capable-agent-route',
  'fallback-with-visible-downgrade',
  'blocked-unsupported-capability-downgrade',
  'blocked-private-data-cloud-route',
  'blocked-budget-overrun-route',
  'blocked-cross-provider-state-replay',
] as const

export type ModelRoutingFixtureId = typeof MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS[number]
export type ModelRoutingProviderClass = 'local' | 'cheap' | 'strong' | 'vision' | 'tool' | 'fallback' | 'blocked'
export type ModelRoutingReadiness = 'ready' | 'degraded' | 'blocked'
export type ModelRoutingCapability =
  | 'text'
  | 'intent-classification'
  | 'embedding'
  | 'reasoning'
  | 'vision'
  | 'structured-output'
  | 'tools'
  | 'cache-continuation'
  | 'provider-tool-replay'
  | 'local-only'
export type ModelRoutingDecisionReason =
  | 'cost'
  | 'latency'
  | 'privacy'
  | 'capability'
  | 'reasoning'
  | 'multimodal'
  | 'structured-output'
  | 'tools'
  | 'fallback'
export type ModelRoutingFailureCode =
  | 'missing-capability-evidence'
  | 'stale-model-metadata'
  | 'unsupported-capability-downgrade'
  | 'privacy-cloud-route-blocked'
  | 'cost-budget-exceeded'
  | 'latency-budget-exceeded'
  | 'fallback-not-visible'
  | 'unsafe-state-replay'
  | 'cache-continuation-mismatch'
  | 'tool-replay-mismatch'
  | 'missing-redaction'
  | 'missing-audit-event'

export interface ModelRoutingPolicy {
  requiredCapabilities: ModelRoutingCapability[]
  selectedCapabilities: ModelRoutingCapability[]
  decisionReasons: ModelRoutingDecisionReason[]
  modelMetadataFresh: boolean
  capabilityEvidence: boolean
  privacyMode: 'local-only' | 'redacted-cloud' | 'cloud-allowed'
  containsPrivateData: boolean
  redactionApplied: boolean
  maxCostUsd: number
  estimatedCostUsd: number
  maxLatencyMs: number
  estimatedLatencyMs: number
  fallbackVisible: boolean
  fallbackMayDowngradeCapabilities: boolean
  providerStateReplay: 'none' | 'same-provider' | 'cross-provider'
  cacheContinuationProviderMatch: boolean
  providerToolReplayIdMatch: boolean
  auditEvent: boolean
}

export interface ModelRoutingFixture {
  id: ModelRoutingFixtureId | string
  providerClass: ModelRoutingProviderClass
  description: string
  selectedProvider: string
  selectedModel: string
  fallbackProvider?: string
  fallbackModel?: string
  policy: ModelRoutingPolicy
}

export interface ModelRoutingDiagnostic {
  fixtureId: string
  providerClass: ModelRoutingProviderClass
  description: string
  selectedProvider: string
  selectedModel: string
  fallbackProvider?: string
  fallbackModel?: string
  readiness: ModelRoutingReadiness
  policy: ModelRoutingPolicy
  missingCapabilities: ModelRoutingCapability[]
  failureCodes: ModelRoutingFailureCode[]
}

export interface ModelRoutingCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredDecisionReasons: ModelRoutingDecisionReason[]
}

export interface ModelRoutingCompatibilityEvaluationRun {
  schema: typeof MODEL_ROUTING_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ModelRoutingDiagnostic[]
  qualityGate: ModelRoutingCompatibilityQualityGate
}

export interface ModelRoutingCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ModelRoutingFixture[]
  requiredFixtureIds?: string[]
}

const BASE_READY_POLICY: ModelRoutingPolicy = {
  requiredCapabilities: ['text'],
  selectedCapabilities: ['text'],
  decisionReasons: ['capability'],
  modelMetadataFresh: true,
  capabilityEvidence: true,
  privacyMode: 'cloud-allowed',
  containsPrivateData: false,
  redactionApplied: true,
  maxCostUsd: 0.1,
  estimatedCostUsd: 0.01,
  maxLatencyMs: 60000,
  estimatedLatencyMs: 3000,
  fallbackVisible: true,
  fallbackMayDowngradeCapabilities: false,
  providerStateReplay: 'none',
  cacheContinuationProviderMatch: true,
  providerToolReplayIdMatch: true,
  auditEvent: true,
}

export const MODEL_ROUTING_COMPATIBILITY_FIXTURES: ModelRoutingFixture[] = [
  {
    id: 'cheap-intent-classifier-small-model',
    providerClass: 'cheap',
    description: 'Cheap models can classify intent when the required capability is narrow and cost/latency budgets are tight.',
    selectedProvider: 'local-small',
    selectedModel: 'intent-classifier-mini',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'intent-classification'],
      selectedCapabilities: ['text', 'intent-classification'],
      decisionReasons: ['cost', 'latency', 'capability'],
      maxCostUsd: 0.005,
      estimatedCostUsd: 0.001,
      maxLatencyMs: 3000,
      estimatedLatencyMs: 400,
    },
  },
  {
    id: 'privacy-local-embedding-route',
    providerClass: 'local',
    description: 'Private embeddings route locally when the request contains private data and local capability is available.',
    selectedProvider: 'on-device',
    selectedModel: 'local-embedding-small',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['embedding', 'local-only'],
      selectedCapabilities: ['embedding', 'local-only'],
      decisionReasons: ['privacy', 'capability'],
      privacyMode: 'local-only',
      containsPrivateData: true,
      maxCostUsd: 0.001,
      estimatedCostUsd: 0,
      maxLatencyMs: 15000,
      estimatedLatencyMs: 900,
    },
  },
  {
    id: 'reasoning-upgrade-route',
    providerClass: 'strong',
    description: 'Complex reasoning requests upgrade to a reasoning-capable model with explicit budget and capability evidence.',
    selectedProvider: 'openai-main',
    selectedModel: 'reasoning-large',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'reasoning'],
      selectedCapabilities: ['text', 'reasoning'],
      decisionReasons: ['reasoning', 'capability'],
      maxCostUsd: 0.5,
      estimatedCostUsd: 0.18,
      maxLatencyMs: 180000,
      estimatedLatencyMs: 42000,
    },
  },
  {
    id: 'vision-capability-route',
    providerClass: 'vision',
    description: 'Image requests route only to a model with vision capability metadata.',
    selectedProvider: 'vision-provider',
    selectedModel: 'vision-chat',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'vision'],
      selectedCapabilities: ['text', 'vision'],
      decisionReasons: ['multimodal', 'capability'],
      maxCostUsd: 0.2,
      estimatedCostUsd: 0.04,
    },
  },
  {
    id: 'structured-output-model-gated-route',
    providerClass: 'strong',
    description: 'Typed workflow output routes to a model whose metadata allows strict structured output.',
    selectedProvider: 'structured-provider',
    selectedModel: 'schema-capable',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'structured-output'],
      selectedCapabilities: ['text', 'structured-output'],
      decisionReasons: ['structured-output', 'capability'],
      maxCostUsd: 0.25,
      estimatedCostUsd: 0.05,
    },
  },
  {
    id: 'tool-capable-agent-route',
    providerClass: 'tool',
    description: 'Agent tool workflows route to a model with tool support and stable provider-native replay identifiers.',
    selectedProvider: 'tool-provider',
    selectedModel: 'tool-chat',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'tools', 'provider-tool-replay'],
      selectedCapabilities: ['text', 'tools', 'provider-tool-replay'],
      decisionReasons: ['tools', 'capability'],
      providerStateReplay: 'same-provider',
      maxCostUsd: 0.3,
      estimatedCostUsd: 0.07,
    },
  },
  {
    id: 'fallback-with-visible-downgrade',
    providerClass: 'fallback',
    description: 'Fallback can degrade non-critical capability only when the downgrade is visible and audited.',
    selectedProvider: 'primary-provider',
    selectedModel: 'reasoning-large',
    fallbackProvider: 'backup-provider',
    fallbackModel: 'text-large',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text'],
      selectedCapabilities: ['text'],
      decisionReasons: ['fallback', 'capability'],
      fallbackVisible: true,
      fallbackMayDowngradeCapabilities: true,
      maxCostUsd: 0.4,
      estimatedCostUsd: 0.08,
    },
  },
  {
    id: 'blocked-unsupported-capability-downgrade',
    providerClass: 'blocked',
    description: 'Fallback cannot drop required reasoning, tool, vision, or schema capabilities when the workflow depends on them.',
    selectedProvider: 'primary-provider',
    selectedModel: 'tool-reasoning-model',
    fallbackProvider: 'text-only-provider',
    fallbackModel: 'text-only-model',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'tools', 'reasoning'],
      selectedCapabilities: ['text'],
      decisionReasons: ['fallback', 'tools', 'reasoning'],
      fallbackMayDowngradeCapabilities: true,
      maxCostUsd: 0.4,
      estimatedCostUsd: 0.06,
    },
  },
  {
    id: 'blocked-private-data-cloud-route',
    providerClass: 'blocked',
    description: 'Private local-only requests cannot route to cloud providers without redaction and explicit policy.',
    selectedProvider: 'cloud-provider',
    selectedModel: 'cloud-chat',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'local-only'],
      selectedCapabilities: ['text'],
      decisionReasons: ['privacy', 'capability'],
      privacyMode: 'local-only',
      containsPrivateData: true,
      redactionApplied: false,
    },
  },
  {
    id: 'blocked-budget-overrun-route',
    providerClass: 'blocked',
    description: 'Router blocks models whose predicted cost or latency exceeds the workflow budget.',
    selectedProvider: 'expensive-provider',
    selectedModel: 'slow-expensive-model',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'reasoning'],
      selectedCapabilities: ['text', 'reasoning'],
      decisionReasons: ['cost', 'latency', 'reasoning'],
      maxCostUsd: 0.05,
      estimatedCostUsd: 1.2,
      maxLatencyMs: 30000,
      estimatedLatencyMs: 220000,
    },
  },
  {
    id: 'blocked-cross-provider-state-replay',
    providerClass: 'blocked',
    description: 'Provider-native cache, response id, and tool replay state cannot be reused across providers.',
    selectedProvider: 'primary-provider',
    selectedModel: 'responses-model',
    fallbackProvider: 'other-provider',
    fallbackModel: 'compatible-chat',
    policy: {
      ...BASE_READY_POLICY,
      requiredCapabilities: ['text', 'cache-continuation', 'provider-tool-replay'],
      selectedCapabilities: ['text', 'cache-continuation', 'provider-tool-replay'],
      decisionReasons: ['fallback', 'capability'],
      providerStateReplay: 'cross-provider',
      cacheContinuationProviderMatch: false,
      providerToolReplayIdMatch: false,
    },
  },
]

export function runModelRoutingCompatibilityEvaluation(
  options: ModelRoutingCompatibilityEvaluationOptions = {},
): ModelRoutingCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? MODEL_ROUTING_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateModelRoutingFixture)
  return {
    schema: MODEL_ROUTING_COMPATIBILITY_EVAL_SCHEMA,
    id: `model-routing-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateModelRoutingCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateModelRoutingFixture(fixture: ModelRoutingFixture): ModelRoutingDiagnostic {
  const missingCapabilities = fixture.policy.requiredCapabilities.filter((capability) => !fixture.policy.selectedCapabilities.includes(capability))
  const failureCodes = collectModelRoutingFailureCodes(fixture, missingCapabilities)
  return {
    fixtureId: fixture.id,
    providerClass: fixture.providerClass,
    description: fixture.description,
    selectedProvider: fixture.selectedProvider,
    selectedModel: fixture.selectedModel,
    fallbackProvider: fixture.fallbackProvider,
    fallbackModel: fixture.fallbackModel,
    readiness: resolveModelRoutingReadiness(fixture, failureCodes),
    policy: {
      ...fixture.policy,
      requiredCapabilities: [...fixture.policy.requiredCapabilities].sort(),
      selectedCapabilities: [...fixture.policy.selectedCapabilities].sort(),
      decisionReasons: [...fixture.policy.decisionReasons].sort(),
    },
    missingCapabilities,
    failureCodes,
  }
}

export function evaluateModelRoutingCompatibilityQualityGate(
  diagnostics: ModelRoutingDiagnostic[],
  requiredFixtureIds: string[] = [...MODEL_ROUTING_COMPATIBILITY_FIXTURE_IDS],
): ModelRoutingCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredDecisionReasons: ModelRoutingDecisionReason[] = [
    'cost',
    'latency',
    'privacy',
    'capability',
    'reasoning',
    'multimodal',
    'structured-output',
    'tools',
    'fallback',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const reason of requiredDecisionReasons) {
    if (!diagnostics.some((item) => item.policy.decisionReasons.includes(reason))) failures.push(`${reason}:missing-decision-reason`)
  }

  requireReady(byId.get('cheap-intent-classifier-small-model'), failures)
  requireReady(byId.get('privacy-local-embedding-route'), failures)
  requireReady(byId.get('reasoning-upgrade-route'), failures)
  requireReady(byId.get('vision-capability-route'), failures)
  requireReady(byId.get('structured-output-model-gated-route'), failures)
  requireReady(byId.get('tool-capable-agent-route'), failures)

  const fallback = byId.get('fallback-with-visible-downgrade')
  if (fallback?.readiness !== 'degraded') failures.push('fallback-with-visible-downgrade:not-degraded')
  if (fallback?.policy.fallbackVisible !== true) failures.push('fallback-with-visible-downgrade:not-visible')
  if (!fallback?.policy.auditEvent) failures.push('fallback-with-visible-downgrade:missing-audit')

  requireBlocked(byId.get('blocked-unsupported-capability-downgrade'), failures, 'blocked-unsupported-capability-downgrade', ['unsupported-capability-downgrade'])
  requireBlocked(byId.get('blocked-private-data-cloud-route'), failures, 'blocked-private-data-cloud-route', ['privacy-cloud-route-blocked', 'missing-redaction', 'unsupported-capability-downgrade'])
  requireBlocked(byId.get('blocked-budget-overrun-route'), failures, 'blocked-budget-overrun-route', ['cost-budget-exceeded', 'latency-budget-exceeded'])
  requireBlocked(byId.get('blocked-cross-provider-state-replay'), failures, 'blocked-cross-provider-state-replay', ['unsafe-state-replay', 'cache-continuation-mismatch', 'tool-replay-mismatch'])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredDecisionReasons,
  }
}

function requireReady(item: ModelRoutingDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (!item.policy.capabilityEvidence) failures.push(`${item.fixtureId}:missing-capability-evidence`)
  if (!item.policy.modelMetadataFresh) failures.push(`${item.fixtureId}:stale-model-metadata`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (item.missingCapabilities.length > 0) failures.push(`${item.fixtureId}:missing-required-capability`)
  if (item.policy.estimatedCostUsd > item.policy.maxCostUsd) failures.push(`${item.fixtureId}:cost-overrun`)
  if (item.policy.estimatedLatencyMs > item.policy.maxLatencyMs) failures.push(`${item.fixtureId}:latency-overrun`)
}

function requireBlocked(
  item: ModelRoutingDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ModelRoutingFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectModelRoutingFailureCodes(
  fixture: ModelRoutingFixture,
  missingCapabilities: ModelRoutingCapability[],
): ModelRoutingFailureCode[] {
  const failures: ModelRoutingFailureCode[] = []
  const policy = fixture.policy
  if (!policy.capabilityEvidence) failures.push('missing-capability-evidence')
  if (!policy.modelMetadataFresh) failures.push('stale-model-metadata')
  if (missingCapabilities.length > 0) failures.push('unsupported-capability-downgrade')
  if (policy.containsPrivateData && policy.privacyMode === 'local-only' && !policy.selectedCapabilities.includes('local-only')) failures.push('privacy-cloud-route-blocked')
  if (policy.containsPrivateData && !policy.redactionApplied && policy.privacyMode !== 'local-only') failures.push('missing-redaction')
  if (policy.containsPrivateData && policy.privacyMode === 'local-only' && !policy.redactionApplied) failures.push('missing-redaction')
  if (policy.estimatedCostUsd > policy.maxCostUsd) failures.push('cost-budget-exceeded')
  if (policy.estimatedLatencyMs > policy.maxLatencyMs) failures.push('latency-budget-exceeded')
  if (fixture.fallbackProvider && !policy.fallbackVisible) failures.push('fallback-not-visible')
  if (policy.providerStateReplay === 'cross-provider') failures.push('unsafe-state-replay')
  if (!policy.cacheContinuationProviderMatch) failures.push('cache-continuation-mismatch')
  if (!policy.providerToolReplayIdMatch) failures.push('tool-replay-mismatch')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  return unique(failures)
}

function resolveModelRoutingReadiness(
  fixture: ModelRoutingFixture,
  failureCodes: ModelRoutingFailureCode[],
): ModelRoutingReadiness {
  if (fixture.providerClass === 'blocked') return 'blocked'
  if (failureCodes.length > 0) return 'blocked'
  if (fixture.fallbackProvider && fixture.policy.fallbackMayDowngradeCapabilities) return 'degraded'
  return 'ready'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
