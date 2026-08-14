export const CONTEXT_ENGINEERING_COMPATIBILITY_EVAL_SCHEMA = 'islemind.context-engineering-compatibility-eval.v1'
export const CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS = [
  'long-context-budgeted-assembly',
  'retrieval-provenance-citation',
  'memory-review-boundary',
  'tool-output-permissioned-context',
  'remote-compact-local-fallback',
  'context-cache-reuse-hash',
  'runtime-manifest-observability',
  'blocked-unbounded-context-source',
  'blocked-raw-context-manifest',
  'blocked-cross-authority-memory-leak',
] as const

export type ContextEngineeringFixtureId = typeof CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS[number]
export type ContextEngineeringSourceKind =
  | 'system'
  | 'conversation'
  | 'retrieval'
  | 'memory'
  | 'tool-output'
  | 'attachment'
  | 'remote-compact-state'
export type ContextEngineeringAuthority =
  | 'system'
  | 'conversation'
  | 'user-private'
  | 'external-public'
  | 'permissioned-tool'
  | 'local-state'
export type ContextEngineeringReadiness = 'ready' | 'degraded' | 'blocked'
export type ContextEngineeringCompactMode = 'none' | 'local' | 'remote' | 'fallback'
export type ContextEngineeringFailureCode =
  | 'missing-token-budget'
  | 'context-budget-overrun'
  | 'missing-source-hash'
  | 'missing-provenance'
  | 'missing-citation'
  | 'missing-permission-check'
  | 'memory-review-missing'
  | 'raw-context-serialized'
  | 'unbounded-context-source'
  | 'missing-redaction'
  | 'authority-leak'
  | 'compact-fallback-missing'
  | 'cache-reuse-missing'
  | 'observability-missing'
  | 'visible-decision-missing'
  | 'control-plane-network-call'
  | 'ranking-missing'
  | 'source-reliability-missing'

export interface ContextEngineeringPolicy {
  tokenBudget: number
  estimatedTokens: number
  sourceHash: boolean
  provenance: boolean
  citationTrace: boolean
  permissionChecked: boolean
  userReviewed: boolean
  rawTextSerialized: boolean
  redaction: boolean
  rankingScore: boolean
  sourceReliability: boolean
  compactMode: ContextEngineeringCompactMode
  compactFallback: boolean
  cacheReuse: boolean
  runtimeEvents: boolean
  visibleDecision: boolean
  networkCallsAllowed: boolean
  crossAuthorityLeak: boolean
}

export interface ContextEngineeringFixture {
  id: ContextEngineeringFixtureId | string
  sourceKind: ContextEngineeringSourceKind
  authority: ContextEngineeringAuthority
  description: string
  policy: ContextEngineeringPolicy
}

export interface ContextEngineeringDiagnostic {
  fixtureId: string
  sourceKind: ContextEngineeringSourceKind
  authority: ContextEngineeringAuthority
  description: string
  readiness: ContextEngineeringReadiness
  policy: ContextEngineeringPolicy
  failureCodes: ContextEngineeringFailureCode[]
}

export interface ContextEngineeringCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSourceKinds: ContextEngineeringSourceKind[]
  requiredAuthorities: ContextEngineeringAuthority[]
}

export interface ContextEngineeringCompatibilityEvaluationRun {
  schema: typeof CONTEXT_ENGINEERING_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ContextEngineeringDiagnostic[]
  qualityGate: ContextEngineeringCompatibilityQualityGate
}

export interface ContextEngineeringCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ContextEngineeringFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_CONTEXT_POLICY: ContextEngineeringPolicy = {
  tokenBudget: 16000,
  estimatedTokens: 8000,
  sourceHash: true,
  provenance: true,
  citationTrace: false,
  permissionChecked: true,
  userReviewed: true,
  rawTextSerialized: false,
  redaction: true,
  rankingScore: true,
  sourceReliability: true,
  compactMode: 'none',
  compactFallback: false,
  cacheReuse: true,
  runtimeEvents: true,
  visibleDecision: true,
  networkCallsAllowed: false,
  crossAuthorityLeak: false,
}

export const CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURES: ContextEngineeringFixture[] = [
  {
    id: 'long-context-budgeted-assembly',
    sourceKind: 'conversation',
    authority: 'conversation',
    description: 'Long context is assembled through finite token budgets, priority, compression state, and visible decisions.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 64000,
      estimatedTokens: 48000,
      compactMode: 'local',
      citationTrace: false,
    },
  },
  {
    id: 'retrieval-provenance-citation',
    sourceKind: 'retrieval',
    authority: 'external-public',
    description: 'Retrieved context must carry source hash, provenance, ranking, source reliability, and citation trace.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 12000,
      estimatedTokens: 5000,
      citationTrace: true,
    },
  },
  {
    id: 'memory-review-boundary',
    sourceKind: 'memory',
    authority: 'user-private',
    description: 'Memory context is admitted only after source attribution, user review, redaction, and retrieval-boundary checks.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 4000,
      estimatedTokens: 1200,
      rankingScore: true,
      userReviewed: true,
    },
  },
  {
    id: 'tool-output-permissioned-context',
    sourceKind: 'tool-output',
    authority: 'permissioned-tool',
    description: 'Tool results enter context only through permissioned, capped, hashed, and audited envelopes.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 6000,
      estimatedTokens: 2500,
      permissionChecked: true,
      citationTrace: false,
    },
  },
  {
    id: 'remote-compact-local-fallback',
    sourceKind: 'remote-compact-state',
    authority: 'local-state',
    description: 'Remote compact decisions keep a local fallback plan and visible downgrade state.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 10000,
      estimatedTokens: 4500,
      compactMode: 'fallback',
      compactFallback: true,
      rankingScore: false,
      sourceReliability: true,
    },
  },
  {
    id: 'context-cache-reuse-hash',
    sourceKind: 'retrieval',
    authority: 'user-private',
    description: 'Context reuse is keyed by stable source hashes, fragment identity, and cache diagnostics.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 10000,
      estimatedTokens: 3800,
      citationTrace: true,
      cacheReuse: true,
    },
  },
  {
    id: 'runtime-manifest-observability',
    sourceKind: 'system',
    authority: 'system',
    description: 'Context manifests expose budgets, counts, failure codes, and runtime events without raw context text.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 2000,
      estimatedTokens: 800,
      rankingScore: false,
      citationTrace: false,
    },
  },
  {
    id: 'blocked-unbounded-context-source',
    sourceKind: 'retrieval',
    authority: 'user-private',
    description: 'Unbounded or uncapped context sources are blocked before model-visible prompt assembly.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 0,
      estimatedTokens: 90000,
      sourceHash: false,
      citationTrace: true,
    },
  },
  {
    id: 'blocked-raw-context-manifest',
    sourceKind: 'tool-output',
    authority: 'permissioned-tool',
    description: 'Raw context bodies must not be serialized into manifests, runtime logs, or control-plane artifacts.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 8000,
      estimatedTokens: 3000,
      rawTextSerialized: true,
      redaction: false,
      networkCallsAllowed: true,
    },
  },
  {
    id: 'blocked-cross-authority-memory-leak',
    sourceKind: 'memory',
    authority: 'external-public',
    description: 'Private memory cannot leak into public-source context lanes or bypass review/redaction.',
    policy: {
      ...SAFE_CONTEXT_POLICY,
      tokenBudget: 4000,
      estimatedTokens: 1400,
      userReviewed: false,
      redaction: false,
      crossAuthorityLeak: true,
      citationTrace: false,
    },
  },
]

export function runContextEngineeringCompatibilityEvaluation(
  options: ContextEngineeringCompatibilityEvaluationOptions = {},
): ContextEngineeringCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateContextEngineeringFixture)
  return {
    schema: CONTEXT_ENGINEERING_COMPATIBILITY_EVAL_SCHEMA,
    id: `context-engineering-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateContextEngineeringCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateContextEngineeringFixture(fixture: ContextEngineeringFixture): ContextEngineeringDiagnostic {
  const failureCodes = collectContextEngineeringFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    sourceKind: fixture.sourceKind,
    authority: fixture.authority,
    description: fixture.description,
    readiness: resolveContextEngineeringReadiness(fixture, failureCodes),
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateContextEngineeringCompatibilityQualityGate(
  diagnostics: ContextEngineeringDiagnostic[],
  requiredFixtureIds: string[] = [...CONTEXT_ENGINEERING_COMPATIBILITY_FIXTURE_IDS],
): ContextEngineeringCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSourceKinds: ContextEngineeringSourceKind[] = ['system', 'conversation', 'retrieval', 'memory', 'tool-output', 'remote-compact-state']
  const requiredAuthorities: ContextEngineeringAuthority[] = ['system', 'conversation', 'user-private', 'external-public', 'permissioned-tool', 'local-state']

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const sourceKind of requiredSourceKinds) {
    if (!diagnostics.some((item) => item.sourceKind === sourceKind)) failures.push(`${sourceKind}:missing-source-kind`)
  }
  for (const authority of requiredAuthorities) {
    if (!diagnostics.some((item) => item.authority === authority)) failures.push(`${authority}:missing-authority`)
  }

  requireReady(byId.get('long-context-budgeted-assembly'), failures)
  requireReady(byId.get('retrieval-provenance-citation'), failures)
  requireReady(byId.get('memory-review-boundary'), failures)
  requireReady(byId.get('tool-output-permissioned-context'), failures)
  requireReady(byId.get('context-cache-reuse-hash'), failures)
  requireReady(byId.get('runtime-manifest-observability'), failures)

  const compactFallback = byId.get('remote-compact-local-fallback')
  if (compactFallback?.readiness !== 'degraded') failures.push('remote-compact-local-fallback:not-degraded')
  if (compactFallback?.policy.compactFallback !== true) failures.push('remote-compact-local-fallback:missing-fallback')
  if (compactFallback?.policy.visibleDecision !== true) failures.push('remote-compact-local-fallback:missing-visible-decision')

  requireBlocked(byId.get('blocked-unbounded-context-source'), failures, 'blocked-unbounded-context-source', [
    'missing-token-budget',
    'context-budget-overrun',
    'missing-source-hash',
    'unbounded-context-source',
  ])
  requireBlocked(byId.get('blocked-raw-context-manifest'), failures, 'blocked-raw-context-manifest', [
    'raw-context-serialized',
    'missing-redaction',
    'control-plane-network-call',
  ])
  requireBlocked(byId.get('blocked-cross-authority-memory-leak'), failures, 'blocked-cross-authority-memory-leak', [
    'memory-review-missing',
    'missing-redaction',
    'authority-leak',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSourceKinds,
    requiredAuthorities,
  }
}

function requireReady(item: ContextEngineeringDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (item.policy.tokenBudget <= 0) failures.push(`${item.fixtureId}:missing-token-budget`)
  if (item.policy.estimatedTokens > item.policy.tokenBudget) failures.push(`${item.fixtureId}:budget-overrun`)
  if (!item.policy.sourceHash) failures.push(`${item.fixtureId}:missing-source-hash`)
  if (!item.policy.provenance) failures.push(`${item.fixtureId}:missing-provenance`)
  if (!item.policy.redaction) failures.push(`${item.fixtureId}:missing-redaction`)
  if (!item.policy.runtimeEvents) failures.push(`${item.fixtureId}:missing-runtime-events`)
  if (!item.policy.visibleDecision) failures.push(`${item.fixtureId}:missing-visible-decision`)
  if (item.policy.rawTextSerialized) failures.push(`${item.fixtureId}:raw-text-serialized`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireBlocked(
  item: ContextEngineeringDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ContextEngineeringFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectContextEngineeringFailureCodes(fixture: ContextEngineeringFixture): ContextEngineeringFailureCode[] {
  const policy = fixture.policy
  const failures: ContextEngineeringFailureCode[] = []
  if (policy.tokenBudget <= 0) failures.push('missing-token-budget')
  if (policy.estimatedTokens > policy.tokenBudget) failures.push('context-budget-overrun')
  if (!policy.sourceHash) failures.push('missing-source-hash')
  if (!policy.provenance) failures.push('missing-provenance')
  if (requiresCitation(fixture) && !policy.citationTrace) failures.push('missing-citation')
  if (fixture.sourceKind === 'tool-output' && !policy.permissionChecked) failures.push('missing-permission-check')
  if (fixture.sourceKind === 'memory' && !policy.userReviewed) failures.push('memory-review-missing')
  if (policy.rawTextSerialized) failures.push('raw-context-serialized')
  if (policy.tokenBudget <= 0) failures.push('unbounded-context-source')
  if (!policy.redaction) failures.push('missing-redaction')
  if (policy.crossAuthorityLeak || (fixture.sourceKind === 'memory' && fixture.authority === 'external-public')) failures.push('authority-leak')
  if ((policy.compactMode === 'remote' || policy.compactMode === 'fallback') && !policy.compactFallback) failures.push('compact-fallback-missing')
  if (!policy.cacheReuse) failures.push('cache-reuse-missing')
  if (!policy.runtimeEvents) failures.push('observability-missing')
  if (!policy.visibleDecision) failures.push('visible-decision-missing')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  if (requiresRanking(fixture) && !policy.rankingScore) failures.push('ranking-missing')
  if (!policy.sourceReliability) failures.push('source-reliability-missing')
  return unique(failures)
}

function resolveContextEngineeringReadiness(
  fixture: ContextEngineeringFixture,
  failureCodes: ContextEngineeringFailureCode[],
): ContextEngineeringReadiness {
  if (failureCodes.some((code) => BLOCKING_CONTEXT_FAILURES.has(code))) return 'blocked'
  if (fixture.policy.compactMode === 'fallback') return 'degraded'
  return 'ready'
}

function requiresCitation(fixture: ContextEngineeringFixture): boolean {
  return fixture.sourceKind === 'retrieval' || fixture.sourceKind === 'attachment'
}

function requiresRanking(fixture: ContextEngineeringFixture): boolean {
  return fixture.sourceKind === 'retrieval' || fixture.sourceKind === 'memory'
}

const BLOCKING_CONTEXT_FAILURES = new Set<ContextEngineeringFailureCode>([
  'missing-token-budget',
  'context-budget-overrun',
  'missing-source-hash',
  'missing-provenance',
  'missing-citation',
  'missing-permission-check',
  'memory-review-missing',
  'raw-context-serialized',
  'unbounded-context-source',
  'missing-redaction',
  'authority-leak',
  'compact-fallback-missing',
  'cache-reuse-missing',
  'observability-missing',
  'visible-decision-missing',
  'control-plane-network-call',
  'ranking-missing',
  'source-reliability-missing',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
