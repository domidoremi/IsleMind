export const MODERNIZATION_COMPLETION_COMPATIBILITY_EVAL_SCHEMA = 'islemind.modernization-completion-compatibility-eval.v1'
export const MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS = [
  'architecture-boundary-modernized',
  'provider-capability-platform',
  'context-retrieval-governance',
  'agent-tool-workflow-bounds',
  'security-privacy-credential-retention',
  'product-experience-recovery',
  'observability-runtime-traces',
  'release-readiness-delivery',
  'qa-evidence-registry',
  'blocked-ungated-capability-expansion',
  'blocked-silent-or-raw-user-facing-failure',
  'blocked-delivery-without-evidence',
] as const

export type ModernizationCompletionFixtureId = typeof MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS[number]
export type ModernizationCompletionLayer =
  | 'architecture'
  | 'provider'
  | 'context'
  | 'agent'
  | 'security'
  | 'product'
  | 'observability'
  | 'release'
  | 'quality'
export type ModernizationCompletionState = 'ready' | 'blocked'
export type ModernizationCompletionFailureCode =
  | 'missing-versioned-schema'
  | 'missing-package-script'
  | 'missing-source-boundary'
  | 'missing-doc-gate'
  | 'missing-deterministic-fixtures'
  | 'missing-quality-gate'
  | 'missing-runtime-trace'
  | 'missing-redaction'
  | 'missing-capability-metadata'
  | 'missing-user-recovery'
  | 'missing-release-evidence'
  | 'missing-qa-evidence'
  | 'missing-blocked-path'
  | 'control-plane-network-call'
  | 'public-behavior-risk'

export interface ModernizationCompletionPolicy {
  versionedSchema: boolean
  packageScript: boolean
  sourceBoundary: boolean
  docGate: boolean
  deterministicFixtures: boolean
  qualityGate: boolean
  runtimeTrace: boolean
  privacyRedaction: boolean
  capabilityMetadata: boolean
  userRecovery: boolean
  releaseEvidence: boolean
  qaEvidence: boolean
  blockedPathFixtures: boolean
  networkIndependent: boolean
  preservesPublicBehavior: boolean
}

export interface ModernizationCompletionFixture {
  id: ModernizationCompletionFixtureId | string
  layer: ModernizationCompletionLayer
  description: string
  policy: ModernizationCompletionPolicy
}

export interface ModernizationCompletionDiagnostic {
  fixtureId: string
  layer: ModernizationCompletionLayer
  description: string
  readiness: ModernizationCompletionState
  policy: ModernizationCompletionPolicy
  failureCodes: ModernizationCompletionFailureCode[]
}

export interface ModernizationCompletionCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredLayers: ModernizationCompletionLayer[]
}

export interface ModernizationCompletionCompatibilityEvaluationRun {
  schema: typeof MODERNIZATION_COMPLETION_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ModernizationCompletionDiagnostic[]
  qualityGate: ModernizationCompletionCompatibilityQualityGate
}

export interface ModernizationCompletionCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ModernizationCompletionFixture[]
  requiredFixtureIds?: string[]
}

const BASE_MODERNIZATION_COMPLETION_POLICY: ModernizationCompletionPolicy = {
  versionedSchema: true,
  packageScript: true,
  sourceBoundary: true,
  docGate: true,
  deterministicFixtures: true,
  qualityGate: true,
  runtimeTrace: true,
  privacyRedaction: true,
  capabilityMetadata: true,
  userRecovery: true,
  releaseEvidence: true,
  qaEvidence: true,
  blockedPathFixtures: true,
  networkIndependent: true,
  preservesPublicBehavior: true,
}

export const MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURES: ModernizationCompletionFixture[] = [
  {
    id: 'architecture-boundary-modernized',
    layer: 'architecture',
    description: 'Core modernization preserves service boundaries, public APIs, behavior parity, and architecture audits.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'provider-capability-platform',
    layer: 'provider',
    description: 'Provider/model compatibility is capability-led across protocol, request shaping, lifecycle, runtime, health, failover, fallback, state, and operation results.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'context-retrieval-governance',
    layer: 'context',
    description: 'Context, retrieval, RAG, document ingestion, memory, local inference, and budget gates are deterministic and source-backed.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'agent-tool-workflow-bounds',
    layer: 'agent',
    description: 'Agent workflows, MCP, plugins, typed tools, execution surfaces, reasoning, multimodal, realtime, and model routing remain bounded.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'security-privacy-credential-retention',
    layer: 'security',
    description: 'Security, credential, provider state isolation, runtime privacy, retention, and redaction gates block unsafe expansion.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'product-experience-recovery',
    layer: 'product',
    description: 'Product surfaces expose visible entry points, diagnostics, recovery, deduplicated errors, confirmations, offline fallback, accessibility, and localization.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'observability-runtime-traces',
    layer: 'observability',
    description: 'Runtime events, trace spans, eval telemetry, repair provenance, sink export, consent, attribute budgets, and redaction are gated.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'release-readiness-delivery',
    layer: 'release',
    description: 'Release delivery verifies source stability, APK freshness, URL safety, integrity, staged cleanup, install handoff, smoke, 16 KB validation, and QA evidence.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'qa-evidence-registry',
    layer: 'quality',
    description: 'Modernization coverage is tied to package scripts, local fixtures, docs, QA evidence, and blocked-path tests.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
    },
  },
  {
    id: 'blocked-ungated-capability-expansion',
    layer: 'provider',
    description: 'New capabilities must not ship without source boundaries, schemas, package scripts, fixtures, docs, quality gates, and blocked paths.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
      versionedSchema: false,
      packageScript: false,
      sourceBoundary: false,
      docGate: false,
      deterministicFixtures: false,
      qualityGate: false,
      capabilityMetadata: false,
      blockedPathFixtures: false,
    },
  },
  {
    id: 'blocked-silent-or-raw-user-facing-failure',
    layer: 'product',
    description: 'Modernized flows must not regress into silent failures, raw technical errors, missing traces, missing recovery, or missing privacy redaction.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
      runtimeTrace: false,
      privacyRedaction: false,
      userRecovery: false,
      blockedPathFixtures: false,
    },
  },
  {
    id: 'blocked-delivery-without-evidence',
    layer: 'release',
    description: 'Delivery changes must not bypass release evidence, QA evidence, package scripts, and local quality gates.',
    policy: {
      ...BASE_MODERNIZATION_COMPLETION_POLICY,
      packageScript: false,
      qualityGate: false,
      releaseEvidence: false,
      qaEvidence: false,
      blockedPathFixtures: false,
    },
  },
]

export function runModernizationCompletionCompatibilityEvaluation(
  options: ModernizationCompletionCompatibilityEvaluationOptions = {},
): ModernizationCompletionCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateModernizationCompletionFixture)
  return {
    schema: MODERNIZATION_COMPLETION_COMPATIBILITY_EVAL_SCHEMA,
    id: `modernization-completion-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateModernizationCompletionCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateModernizationCompletionFixture(
  fixture: ModernizationCompletionFixture,
): ModernizationCompletionDiagnostic {
  const failureCodes = collectModernizationCompletionFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    layer: fixture.layer,
    description: fixture.description,
    readiness: failureCodes.some((code) => BLOCKING_MODERNIZATION_COMPLETION_FAILURES.has(code)) ? 'blocked' : 'ready',
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateModernizationCompletionCompatibilityQualityGate(
  diagnostics: ModernizationCompletionDiagnostic[],
  requiredFixtureIds: string[] = [...MODERNIZATION_COMPLETION_COMPATIBILITY_FIXTURE_IDS],
): ModernizationCompletionCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredLayers: ModernizationCompletionLayer[] = [
    'architecture',
    'provider',
    'context',
    'agent',
    'security',
    'product',
    'observability',
    'release',
    'quality',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const layer of requiredLayers) {
    if (!diagnostics.some((item) => item.layer === layer)) failures.push(`${layer}:missing-layer`)
  }
  for (const id of READY_MODERNIZATION_COMPLETION_FIXTURE_IDS) {
    requireReady(byId.get(id), failures)
  }
  requireBlocked(byId.get('blocked-ungated-capability-expansion'), failures, 'blocked-ungated-capability-expansion', [
    'missing-versioned-schema',
    'missing-package-script',
    'missing-source-boundary',
    'missing-doc-gate',
    'missing-deterministic-fixtures',
    'missing-quality-gate',
    'missing-capability-metadata',
    'missing-blocked-path',
  ])
  requireBlocked(byId.get('blocked-silent-or-raw-user-facing-failure'), failures, 'blocked-silent-or-raw-user-facing-failure', [
    'missing-runtime-trace',
    'missing-redaction',
    'missing-user-recovery',
    'missing-blocked-path',
  ])
  requireBlocked(byId.get('blocked-delivery-without-evidence'), failures, 'blocked-delivery-without-evidence', [
    'missing-package-script',
    'missing-quality-gate',
    'missing-release-evidence',
    'missing-qa-evidence',
    'missing-blocked-path',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredLayers,
  }
}

function requireReady(item: ModernizationCompletionDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
  if (!item.policy.networkIndependent) failures.push(`${item.fixtureId}:control-plane-network-call`)
  if (!item.policy.preservesPublicBehavior) failures.push(`${item.fixtureId}:public-behavior-risk`)
}

function requireBlocked(
  item: ModernizationCompletionDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ModernizationCompletionFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectModernizationCompletionFailureCodes(
  fixture: ModernizationCompletionFixture,
): ModernizationCompletionFailureCode[] {
  const policy = fixture.policy
  const failures: ModernizationCompletionFailureCode[] = []
  if (!policy.versionedSchema) failures.push('missing-versioned-schema')
  if (!policy.packageScript) failures.push('missing-package-script')
  if (!policy.sourceBoundary) failures.push('missing-source-boundary')
  if (!policy.docGate) failures.push('missing-doc-gate')
  if (!policy.deterministicFixtures) failures.push('missing-deterministic-fixtures')
  if (!policy.qualityGate) failures.push('missing-quality-gate')
  if (!policy.runtimeTrace) failures.push('missing-runtime-trace')
  if (!policy.privacyRedaction) failures.push('missing-redaction')
  if (!policy.capabilityMetadata) failures.push('missing-capability-metadata')
  if (!policy.userRecovery) failures.push('missing-user-recovery')
  if (!policy.releaseEvidence) failures.push('missing-release-evidence')
  if (!policy.qaEvidence) failures.push('missing-qa-evidence')
  if (!policy.blockedPathFixtures) failures.push('missing-blocked-path')
  if (!policy.networkIndependent) failures.push('control-plane-network-call')
  if (!policy.preservesPublicBehavior) failures.push('public-behavior-risk')
  return unique(failures)
}

const READY_MODERNIZATION_COMPLETION_FIXTURE_IDS: ModernizationCompletionFixtureId[] = [
  'architecture-boundary-modernized',
  'provider-capability-platform',
  'context-retrieval-governance',
  'agent-tool-workflow-bounds',
  'security-privacy-credential-retention',
  'product-experience-recovery',
  'observability-runtime-traces',
  'release-readiness-delivery',
  'qa-evidence-registry',
]

const BLOCKING_MODERNIZATION_COMPLETION_FAILURES = new Set<ModernizationCompletionFailureCode>([
  'missing-versioned-schema',
  'missing-package-script',
  'missing-source-boundary',
  'missing-doc-gate',
  'missing-deterministic-fixtures',
  'missing-quality-gate',
  'missing-runtime-trace',
  'missing-redaction',
  'missing-capability-metadata',
  'missing-user-recovery',
  'missing-release-evidence',
  'missing-qa-evidence',
  'missing-blocked-path',
  'control-plane-network-call',
  'public-behavior-risk',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
