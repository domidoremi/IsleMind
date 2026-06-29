export const RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA = 'islemind.runtime-budget-governance-compatibility-eval.v1'
export const RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS = [
  'token-budget-normalization',
  'cost-budget-ceiling',
  'latency-timeout-policy',
  'retry-and-circuit-breaker-policy',
  'streaming-idle-timeout',
  'cancellation-propagation',
  'visible-fallback-with-budget-preservation',
  'local-inference-resource-budget',
  'tool-loop-budget-boundary',
  'observability-budget-accounting',
  'blocked-unbounded-retries',
  'blocked-missing-timeout',
  'blocked-fallback-budget-escalation',
  'blocked-no-cancellation',
  'blocked-unmetered-tool-loop',
  'blocked-unbounded-local-resource-use',
] as const

export type RuntimeBudgetGovernanceFixtureId = typeof RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS[number]
export type RuntimeBudgetGovernanceSurface =
  | 'provider-request'
  | 'provider-stream'
  | 'retry'
  | 'fallback'
  | 'local-inference'
  | 'tool-loop'
  | 'observability'
  | 'blocked'
export type RuntimeBudgetGovernanceReadiness = 'ready' | 'degraded' | 'blocked'
export type RuntimeBudgetGovernanceBudgetKind =
  | 'input-tokens'
  | 'output-tokens'
  | 'cost'
  | 'latency'
  | 'timeout'
  | 'retry'
  | 'stream-idle'
  | 'tool-calls'
  | 'local-memory'
  | 'thermal'
export type RuntimeBudgetGovernanceFailureCode =
  | 'missing-docs'
  | 'missing-token-budget'
  | 'missing-cost-budget'
  | 'missing-latency-budget'
  | 'missing-timeout'
  | 'missing-retry-limit'
  | 'missing-circuit-breaker'
  | 'missing-stream-idle-timeout'
  | 'missing-cancellation'
  | 'missing-fallback-budget-policy'
  | 'fallback-budget-escalation'
  | 'missing-tool-loop-limit'
  | 'missing-local-memory-budget'
  | 'missing-thermal-policy'
  | 'budget-exceeded'
  | 'unbounded-retries'
  | 'unmetered-tool-loop'
  | 'unbounded-local-resource-use'
  | 'missing-visible-downgrade'
  | 'missing-budget-ledger'
  | 'missing-audit-event'
  | 'control-plane-network-call'

export interface RuntimeBudgetGovernancePolicy {
  docsMapped: boolean
  budgetKinds: RuntimeBudgetGovernanceBudgetKind[]
  inputTokenBudget: number
  outputTokenBudget: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  costBudgetUsd: number
  estimatedCostUsd: number
  latencyBudgetMs: number
  observedLatencyMs: number
  timeoutMs: number
  retryLimit: number
  circuitBreaker: boolean
  streamIdleTimeoutMs: number
  cancellationPropagated: boolean
  fallbackBudgetPolicy: 'preserve-or-reduce' | 'may-increase' | 'none'
  fallbackVisible: boolean
  maxToolCalls: number
  estimatedToolCalls: number
  localMemoryBudgetMb: number
  estimatedLocalMemoryMb: number
  thermalPolicy: boolean
  budgetLedger: boolean
  auditEvent: boolean
  networkCallsAllowed: boolean
}

export interface RuntimeBudgetGovernanceFixture {
  id: RuntimeBudgetGovernanceFixtureId | string
  surface: RuntimeBudgetGovernanceSurface
  expectedReadiness: RuntimeBudgetGovernanceReadiness
  description: string
  policy: RuntimeBudgetGovernancePolicy
}

export interface RuntimeBudgetGovernanceDiagnostic {
  fixtureId: string
  surface: RuntimeBudgetGovernanceSurface
  description: string
  readiness: RuntimeBudgetGovernanceReadiness
  policy: RuntimeBudgetGovernancePolicy
  failureCodes: RuntimeBudgetGovernanceFailureCode[]
}

export interface RuntimeBudgetGovernanceCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: RuntimeBudgetGovernanceSurface[]
  requiredBudgetKinds: RuntimeBudgetGovernanceBudgetKind[]
}

export interface RuntimeBudgetGovernanceCompatibilityEvaluationRun {
  schema: typeof RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: RuntimeBudgetGovernanceDiagnostic[]
  qualityGate: RuntimeBudgetGovernanceCompatibilityQualityGate
}

export interface RuntimeBudgetGovernanceCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: RuntimeBudgetGovernanceFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_RUNTIME_BUDGET_POLICY: RuntimeBudgetGovernancePolicy = {
  docsMapped: true,
  budgetKinds: ['input-tokens', 'output-tokens', 'cost', 'latency', 'timeout'],
  inputTokenBudget: 32000,
  outputTokenBudget: 8192,
  estimatedInputTokens: 12000,
  estimatedOutputTokens: 4096,
  costBudgetUsd: 0.25,
  estimatedCostUsd: 0.08,
  latencyBudgetMs: 60000,
  observedLatencyMs: 8000,
  timeoutMs: 120000,
  retryLimit: 1,
  circuitBreaker: true,
  streamIdleTimeoutMs: 15000,
  cancellationPropagated: true,
  fallbackBudgetPolicy: 'preserve-or-reduce',
  fallbackVisible: true,
  maxToolCalls: 8,
  estimatedToolCalls: 2,
  localMemoryBudgetMb: 512,
  estimatedLocalMemoryMb: 128,
  thermalPolicy: true,
  budgetLedger: true,
  auditEvent: true,
  networkCallsAllowed: false,
}

export const RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURES: RuntimeBudgetGovernanceFixture[] = [
  {
    id: 'token-budget-normalization',
    surface: 'provider-request',
    expectedReadiness: 'ready',
    description: 'Provider requests normalize input and output token budgets before request shaping and fallback.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['input-tokens', 'output-tokens', 'timeout'],
    },
  },
  {
    id: 'cost-budget-ceiling',
    surface: 'provider-request',
    expectedReadiness: 'ready',
    description: 'Cloud model calls carry a finite cost ceiling and estimated cost before execution.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['cost', 'input-tokens', 'output-tokens'],
      costBudgetUsd: 0.5,
      estimatedCostUsd: 0.18,
    },
  },
  {
    id: 'latency-timeout-policy',
    surface: 'provider-request',
    expectedReadiness: 'ready',
    description: 'Provider calls carry explicit latency budget and request timeout with diagnostics.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['latency', 'timeout'],
      latencyBudgetMs: 45000,
      observedLatencyMs: 12000,
      timeoutMs: 90000,
    },
  },
  {
    id: 'retry-and-circuit-breaker-policy',
    surface: 'retry',
    expectedReadiness: 'ready',
    description: 'Retries are bounded and tied to a circuit breaker to prevent runaway upstream calls.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['retry', 'timeout', 'cost'],
      retryLimit: 2,
      circuitBreaker: true,
    },
  },
  {
    id: 'streaming-idle-timeout',
    surface: 'provider-stream',
    expectedReadiness: 'ready',
    description: 'Streaming responses define an idle timeout and cancellation path before UI state is kept alive.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['stream-idle', 'latency', 'timeout'],
      streamIdleTimeoutMs: 10000,
    },
  },
  {
    id: 'cancellation-propagation',
    surface: 'provider-stream',
    expectedReadiness: 'ready',
    description: 'User cancellation propagates to provider request, stream reader, tool loop, and pending fallback.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['timeout', 'stream-idle'],
      cancellationPropagated: true,
    },
  },
  {
    id: 'visible-fallback-with-budget-preservation',
    surface: 'fallback',
    expectedReadiness: 'degraded',
    description: 'Fallback remains visible and can only preserve or reduce cost, latency, token, and capability budgets.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['cost', 'latency', 'input-tokens', 'output-tokens'],
      fallbackBudgetPolicy: 'preserve-or-reduce',
      fallbackVisible: true,
      estimatedCostUsd: 0.04,
    },
  },
  {
    id: 'local-inference-resource-budget',
    surface: 'local-inference',
    expectedReadiness: 'degraded',
    description: 'Local inference remains degraded until memory pressure, thermal policy, duration, and fallback are explicit.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['local-memory', 'thermal', 'latency'],
      localMemoryBudgetMb: 1024,
      estimatedLocalMemoryMb: 512,
      latencyBudgetMs: 30000,
      observedLatencyMs: 15000,
      costBudgetUsd: 0.01,
      estimatedCostUsd: 0,
    },
  },
  {
    id: 'tool-loop-budget-boundary',
    surface: 'tool-loop',
    expectedReadiness: 'ready',
    description: 'Agent and tool loops have finite tool-call, timeout, token, and cost budgets.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['tool-calls', 'timeout', 'input-tokens', 'output-tokens', 'cost'],
      maxToolCalls: 6,
      estimatedToolCalls: 3,
      timeoutMs: 180000,
    },
  },
  {
    id: 'observability-budget-accounting',
    surface: 'observability',
    expectedReadiness: 'ready',
    description: 'Runtime diagnostics record budget ledger fields without raw prompts, secrets, or tool payloads.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['input-tokens', 'output-tokens', 'cost', 'latency', 'retry', 'stream-idle'],
      budgetLedger: true,
      auditEvent: true,
    },
  },
  {
    id: 'blocked-unbounded-retries',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Unbounded retry loops are blocked before provider execution.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['retry'],
      retryLimit: -1,
      circuitBreaker: false,
    },
  },
  {
    id: 'blocked-missing-timeout',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Provider and stream work is blocked when timeout and latency budgets are missing.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['timeout', 'latency'],
      timeoutMs: 0,
      latencyBudgetMs: 0,
    },
  },
  {
    id: 'blocked-fallback-budget-escalation',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Fallback is blocked when it silently raises token, cost, latency, or reasoning budgets.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['cost', 'latency', 'input-tokens', 'output-tokens'],
      fallbackBudgetPolicy: 'may-increase',
      fallbackVisible: false,
      estimatedCostUsd: 0.6,
      costBudgetUsd: 0.2,
    },
  },
  {
    id: 'blocked-no-cancellation',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Long-running provider, stream, tool, or local inference work is blocked when cancellation is not propagated.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      cancellationPropagated: false,
    },
  },
  {
    id: 'blocked-unmetered-tool-loop',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Tool loops are blocked when max tool calls or tool budget accounting are missing.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['tool-calls'],
      maxToolCalls: 0,
      estimatedToolCalls: 9,
    },
  },
  {
    id: 'blocked-unbounded-local-resource-use',
    surface: 'blocked',
    expectedReadiness: 'blocked',
    description: 'Local inference is blocked when memory or thermal policy is missing or estimated memory exceeds budget.',
    policy: {
      ...SAFE_RUNTIME_BUDGET_POLICY,
      budgetKinds: ['local-memory', 'thermal'],
      localMemoryBudgetMb: 256,
      estimatedLocalMemoryMb: 1024,
      thermalPolicy: false,
    },
  },
]

export function runRuntimeBudgetGovernanceCompatibilityEvaluation(
  options: RuntimeBudgetGovernanceCompatibilityEvaluationOptions = {},
): RuntimeBudgetGovernanceCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateRuntimeBudgetGovernanceFixture)
  return {
    schema: RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_EVAL_SCHEMA,
    id: `runtime-budget-governance-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateRuntimeBudgetGovernanceCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateRuntimeBudgetGovernanceFixture(
  fixture: RuntimeBudgetGovernanceFixture,
): RuntimeBudgetGovernanceDiagnostic {
  const failureCodes = collectRuntimeBudgetGovernanceFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    description: fixture.description,
    readiness: resolveRuntimeBudgetGovernanceReadiness(fixture, failureCodes),
    policy: {
      ...fixture.policy,
      budgetKinds: [...fixture.policy.budgetKinds].sort(),
    },
    failureCodes,
  }
}

export function evaluateRuntimeBudgetGovernanceCompatibilityQualityGate(
  diagnostics: RuntimeBudgetGovernanceDiagnostic[],
  requiredFixtureIds: string[] = [...RUNTIME_BUDGET_GOVERNANCE_COMPATIBILITY_FIXTURE_IDS],
): RuntimeBudgetGovernanceCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: RuntimeBudgetGovernanceSurface[] = [
    'provider-request',
    'provider-stream',
    'retry',
    'fallback',
    'local-inference',
    'tool-loop',
    'observability',
    'blocked',
  ]
  const requiredBudgetKinds: RuntimeBudgetGovernanceBudgetKind[] = [
    'input-tokens',
    'output-tokens',
    'cost',
    'latency',
    'timeout',
    'retry',
    'stream-idle',
    'tool-calls',
    'local-memory',
    'thermal',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }
  for (const kind of requiredBudgetKinds) {
    if (!diagnostics.some((item) => item.policy.budgetKinds.includes(kind))) failures.push(`${kind}:missing-budget-kind`)
  }

  requireReady(byId.get('token-budget-normalization'), failures)
  requireReady(byId.get('cost-budget-ceiling'), failures)
  requireReady(byId.get('latency-timeout-policy'), failures)
  requireReady(byId.get('retry-and-circuit-breaker-policy'), failures, { requireRetry: true })
  requireReady(byId.get('streaming-idle-timeout'), failures, { requireStreamIdle: true })
  requireReady(byId.get('cancellation-propagation'), failures)
  requireReady(byId.get('tool-loop-budget-boundary'), failures, { requireToolLimit: true })
  requireReady(byId.get('observability-budget-accounting'), failures, { requireLedger: true })
  requireDegraded(byId.get('visible-fallback-with-budget-preservation'), failures, 'visible-fallback-with-budget-preservation', { requireFallbackVisible: true })
  requireDegraded(byId.get('local-inference-resource-budget'), failures, 'local-inference-resource-budget', { requireLocalResourcePolicy: true })

  requireBlocked(byId.get('blocked-unbounded-retries'), failures, 'blocked-unbounded-retries', [
    'missing-retry-limit',
    'missing-circuit-breaker',
    'unbounded-retries',
  ])
  requireBlocked(byId.get('blocked-missing-timeout'), failures, 'blocked-missing-timeout', [
    'missing-latency-budget',
    'missing-timeout',
  ])
  requireBlocked(byId.get('blocked-fallback-budget-escalation'), failures, 'blocked-fallback-budget-escalation', [
    'fallback-budget-escalation',
    'missing-visible-downgrade',
    'budget-exceeded',
  ])
  requireBlocked(byId.get('blocked-no-cancellation'), failures, 'blocked-no-cancellation', ['missing-cancellation'])
  requireBlocked(byId.get('blocked-unmetered-tool-loop'), failures, 'blocked-unmetered-tool-loop', [
    'missing-tool-loop-limit',
    'unmetered-tool-loop',
  ])
  requireBlocked(byId.get('blocked-unbounded-local-resource-use'), failures, 'blocked-unbounded-local-resource-use', [
    'missing-thermal-policy',
    'budget-exceeded',
    'unbounded-local-resource-use',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
    requiredBudgetKinds,
  }
}

function requireReady(
  item: RuntimeBudgetGovernanceDiagnostic | undefined,
  failures: string[],
  options: { requireRetry?: boolean; requireStreamIdle?: boolean; requireToolLimit?: boolean; requireLedger?: boolean } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselineBudgetPolicy(item, failures)
  if (options.requireRetry && (item.policy.retryLimit < 0 || !item.policy.circuitBreaker)) failures.push(`${item.fixtureId}:missing-retry-guard`)
  if (options.requireStreamIdle && item.policy.streamIdleTimeoutMs <= 0) failures.push(`${item.fixtureId}:missing-stream-idle-timeout`)
  if (options.requireToolLimit && item.policy.maxToolCalls <= 0) failures.push(`${item.fixtureId}:missing-tool-limit`)
  if (options.requireLedger && !item.policy.budgetLedger) failures.push(`${item.fixtureId}:missing-budget-ledger`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: RuntimeBudgetGovernanceDiagnostic | undefined,
  failures: string[],
  id: string,
  options: { requireFallbackVisible?: boolean; requireLocalResourcePolicy?: boolean } = {},
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselineBudgetPolicy(item, failures)
  if (options.requireFallbackVisible && (!item.policy.fallbackVisible || item.policy.fallbackBudgetPolicy !== 'preserve-or-reduce')) failures.push(`${id}:missing-safe-fallback`)
  if (options.requireLocalResourcePolicy && (!item.policy.thermalPolicy || item.policy.localMemoryBudgetMb <= 0)) failures.push(`${id}:missing-local-resource-policy`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselineBudgetPolicy(item: RuntimeBudgetGovernanceDiagnostic, failures: string[]): void {
  if (!item.policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (item.policy.inputTokenBudget <= 0 || item.policy.outputTokenBudget <= 0) failures.push(`${item.fixtureId}:missing-token-budget`)
  if (item.policy.costBudgetUsd <= 0) failures.push(`${item.fixtureId}:missing-cost-budget`)
  if (item.policy.latencyBudgetMs <= 0) failures.push(`${item.fixtureId}:missing-latency-budget`)
  if (item.policy.timeoutMs <= 0) failures.push(`${item.fixtureId}:missing-timeout`)
  if (item.policy.retryLimit < 0) failures.push(`${item.fixtureId}:missing-retry-limit`)
  if (!item.policy.circuitBreaker) failures.push(`${item.fixtureId}:missing-circuit-breaker`)
  if (item.policy.streamIdleTimeoutMs <= 0) failures.push(`${item.fixtureId}:missing-stream-idle-timeout`)
  if (!item.policy.cancellationPropagated) failures.push(`${item.fixtureId}:missing-cancellation`)
  if (item.policy.fallbackBudgetPolicy === 'none') failures.push(`${item.fixtureId}:missing-fallback-budget-policy`)
  if (item.policy.fallbackBudgetPolicy === 'may-increase') failures.push(`${item.fixtureId}:fallback-budget-escalation`)
  if (!item.policy.fallbackVisible) failures.push(`${item.fixtureId}:missing-visible-downgrade`)
  if (item.policy.maxToolCalls <= 0) failures.push(`${item.fixtureId}:missing-tool-loop-limit`)
  if (item.policy.localMemoryBudgetMb <= 0) failures.push(`${item.fixtureId}:missing-local-memory-budget`)
  if (!item.policy.thermalPolicy) failures.push(`${item.fixtureId}:missing-thermal-policy`)
  if (budgetExceeded(item.policy)) failures.push(`${item.fixtureId}:budget-exceeded`)
  if (!item.policy.budgetLedger) failures.push(`${item.fixtureId}:missing-budget-ledger`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
}

function requireBlocked(
  item: RuntimeBudgetGovernanceDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: RuntimeBudgetGovernanceFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectRuntimeBudgetGovernanceFailureCodes(fixture: RuntimeBudgetGovernanceFixture): RuntimeBudgetGovernanceFailureCode[] {
  const policy = fixture.policy
  const failures: RuntimeBudgetGovernanceFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (policy.inputTokenBudget <= 0 || policy.outputTokenBudget <= 0) failures.push('missing-token-budget')
  if (policy.costBudgetUsd <= 0) failures.push('missing-cost-budget')
  if (policy.latencyBudgetMs <= 0) failures.push('missing-latency-budget')
  if (policy.timeoutMs <= 0) failures.push('missing-timeout')
  if (policy.retryLimit < 0) failures.push('missing-retry-limit')
  if (!policy.circuitBreaker) failures.push('missing-circuit-breaker')
  if (policy.streamIdleTimeoutMs <= 0) failures.push('missing-stream-idle-timeout')
  if (!policy.cancellationPropagated) failures.push('missing-cancellation')
  if (policy.fallbackBudgetPolicy === 'none') failures.push('missing-fallback-budget-policy')
  if (policy.fallbackBudgetPolicy === 'may-increase') failures.push('fallback-budget-escalation')
  if (!policy.fallbackVisible) failures.push('missing-visible-downgrade')
  if (policy.maxToolCalls <= 0) failures.push('missing-tool-loop-limit')
  if (policy.localMemoryBudgetMb <= 0) failures.push('missing-local-memory-budget')
  if (!policy.thermalPolicy) failures.push('missing-thermal-policy')
  if (budgetExceeded(policy)) failures.push('budget-exceeded')
  if (policy.retryLimit < 0 || (!policy.circuitBreaker && fixture.surface === 'retry')) failures.push('unbounded-retries')
  if (policy.maxToolCalls <= 0 || policy.estimatedToolCalls > policy.maxToolCalls) failures.push('unmetered-tool-loop')
  if (policy.localMemoryBudgetMb <= 0 || policy.estimatedLocalMemoryMb > policy.localMemoryBudgetMb || !policy.thermalPolicy) failures.push('unbounded-local-resource-use')
  if (!policy.budgetLedger) failures.push('missing-budget-ledger')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveRuntimeBudgetGovernanceReadiness(
  fixture: RuntimeBudgetGovernanceFixture,
  failureCodes: RuntimeBudgetGovernanceFailureCode[],
): RuntimeBudgetGovernanceReadiness {
  if (failureCodes.length > 0 || fixture.expectedReadiness === 'blocked') return 'blocked'
  if (fixture.expectedReadiness === 'degraded') return 'degraded'
  return 'ready'
}

function budgetExceeded(policy: RuntimeBudgetGovernancePolicy): boolean {
  return policy.estimatedInputTokens > policy.inputTokenBudget ||
    policy.estimatedOutputTokens > policy.outputTokenBudget ||
    policy.estimatedCostUsd > policy.costBudgetUsd ||
    policy.observedLatencyMs > policy.latencyBudgetMs ||
    policy.estimatedLocalMemoryMb > policy.localMemoryBudgetMb
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
