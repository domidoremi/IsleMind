export const REASONING_RUNTIME_COMPATIBILITY_EVAL_SCHEMA = 'islemind.reasoning-runtime-compatibility-eval.v1'
export const REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS = [
  'openai-responses-reasoning-effort',
  'anthropic-thinking-budget',
  'google-thinking-budget',
  'provider-response-reasoning-trace',
  'bounded-verification-loop',
  'tool-result-self-check-loop',
  'unsupported-provider-effort-blocked',
  'budget-escalation-blocked',
  'hidden-reasoning-export-blocked',
  'prompt-only-cot-blocked',
] as const

export type ReasoningRuntimeFixtureId = typeof REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS[number]
export type ReasoningRuntimeProviderFamily = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'generic' | 'app-workflow'
export type ReasoningRuntimeSurface = 'provider-request' | 'provider-response-trace' | 'app-loop' | 'blocked'
export type ReasoningRuntimeRequestShape =
  | 'openai-responses-reasoning'
  | 'anthropic-thinking-budget'
  | 'google-thinking-budget'
  | 'response-reasoning-trace-only'
  | 'bounded-verifier-loop'
  | 'tool-result-self-check'
  | 'none'
export type ReasoningRuntimeReadiness = 'ready' | 'trace-only' | 'blocked'
export type ReasoningRuntimeEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high'
export type ReasoningRuntimeFailureCode =
  | 'missing-provider-docs'
  | 'missing-model-metadata'
  | 'unsupported-request-control'
  | 'unsupported-request-shape'
  | 'prompt-only-cot-blocked'
  | 'hidden-reasoning-leak'
  | 'token-budget-missing'
  | 'cost-budget-missing'
  | 'max-steps-missing'
  | 'timeout-missing'
  | 'cancellation-missing'
  | 'eval-outcome-missing'
  | 'tool-evidence-missing'
  | 'fallback-escalates-reasoning'
  | 'retry-unbounded'

export interface ReasoningRuntimePolicy {
  maxSteps: number
  retryLimit: number
  timeoutMs: number
  inputTokenBudget: number
  outputTokenBudget: number
  estimatedCostUsd: number
  userVisibleSummary: boolean
  storesHiddenChain: boolean
  cancellation: boolean
  verifierRequired: boolean
  evalOutcomeRequired: boolean
  toolEvidenceRequired: boolean
  fallbackMayIncreaseEffort: boolean
}

export interface ReasoningRuntimeTraceSample {
  reasoningSummary: boolean
  hiddenChainOfThought: boolean
  evalOutcome: boolean
  toolEvidence: boolean
  failureCode?: ReasoningRuntimeFailureCode
}

export interface ReasoningRuntimeFixture {
  id: ReasoningRuntimeFixtureId | string
  providerFamily: ReasoningRuntimeProviderFamily
  surface: ReasoningRuntimeSurface
  docs: string[]
  description: string
  requestShape: ReasoningRuntimeRequestShape
  supportedEfforts: ReasoningRuntimeEffort[]
  requestedEffort: ReasoningRuntimeEffort
  effectiveEffort: ReasoningRuntimeEffort
  modelMetadataSupportsReasoning: boolean
  appRequestControl: boolean
  policy: ReasoningRuntimePolicy
  trace: ReasoningRuntimeTraceSample
}

export interface ReasoningRuntimeDiagnostic {
  fixtureId: string
  providerFamily: ReasoningRuntimeProviderFamily
  surface: ReasoningRuntimeSurface
  docs: string[]
  description: string
  requestShape: ReasoningRuntimeRequestShape
  readiness: ReasoningRuntimeReadiness
  supportedEfforts: ReasoningRuntimeEffort[]
  requestedEffort: ReasoningRuntimeEffort
  effectiveEffort: ReasoningRuntimeEffort
  modelMetadataSupportsReasoning: boolean
  appRequestControl: boolean
  policy: ReasoningRuntimePolicy
  trace: ReasoningRuntimeTraceSample
  failureCodes: ReasoningRuntimeFailureCode[]
}

export interface ReasoningRuntimeCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredRequestShapes: ReasoningRuntimeRequestShape[]
}

export interface ReasoningRuntimeCompatibilityEvaluationRun {
  schema: typeof REASONING_RUNTIME_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ReasoningRuntimeDiagnostic[]
  qualityGate: ReasoningRuntimeCompatibilityQualityGate
}

export interface ReasoningRuntimeCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ReasoningRuntimeFixture[]
  requiredFixtureIds?: string[]
}

const PROVIDER_REASONING_POLICY: ReasoningRuntimePolicy = {
  maxSteps: 1,
  retryLimit: 0,
  timeoutMs: 120000,
  inputTokenBudget: 24000,
  outputTokenBudget: 12000,
  estimatedCostUsd: 0.25,
  userVisibleSummary: true,
  storesHiddenChain: false,
  cancellation: true,
  verifierRequired: false,
  evalOutcomeRequired: false,
  toolEvidenceRequired: false,
  fallbackMayIncreaseEffort: false,
}

const APP_LOOP_POLICY: ReasoningRuntimePolicy = {
  maxSteps: 3,
  retryLimit: 1,
  timeoutMs: 180000,
  inputTokenBudget: 32000,
  outputTokenBudget: 16000,
  estimatedCostUsd: 0.5,
  userVisibleSummary: true,
  storesHiddenChain: false,
  cancellation: true,
  verifierRequired: true,
  evalOutcomeRequired: true,
  toolEvidenceRequired: false,
  fallbackMayIncreaseEffort: false,
}

export const REASONING_RUNTIME_COMPATIBILITY_FIXTURES: ReasoningRuntimeFixture[] = [
  {
    id: 'openai-responses-reasoning-effort',
    providerFamily: 'openai',
    surface: 'provider-request',
    docs: ['https://platform.openai.com/docs/guides/reasoning'],
    description: 'OpenAI Responses reasoning uses explicit effort controls and bounded summaries.',
    requestShape: 'openai-responses-reasoning',
    supportedEfforts: ['none', 'minimal', 'low', 'medium', 'high'],
    requestedEffort: 'high',
    effectiveEffort: 'high',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: PROVIDER_REASONING_POLICY,
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'anthropic-thinking-budget',
    providerFamily: 'anthropic',
    surface: 'provider-request',
    docs: ['https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking'],
    description: 'Anthropic thinking uses a provider-native budget and never prompt-only chain-of-thought capture.',
    requestShape: 'anthropic-thinking-budget',
    supportedEfforts: ['low', 'medium', 'high'],
    requestedEffort: 'medium',
    effectiveEffort: 'medium',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: { ...PROVIDER_REASONING_POLICY, outputTokenBudget: 16000, estimatedCostUsd: 0.35 },
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'google-thinking-budget',
    providerFamily: 'google',
    surface: 'provider-request',
    docs: ['https://ai.google.dev/gemini-api/docs/thinking'],
    description: 'Gemini thinking is represented as a provider-specific thinking budget, not a generic effort field.',
    requestShape: 'google-thinking-budget',
    supportedEfforts: ['none', 'low', 'medium', 'high'],
    requestedEffort: 'low',
    effectiveEffort: 'low',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: { ...PROVIDER_REASONING_POLICY, estimatedCostUsd: 0.18 },
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'provider-response-reasoning-trace',
    providerFamily: 'openai-compatible',
    surface: 'provider-response-trace',
    docs: ['docs/architecture/provider-runtime-context-control-plane-plan.md'],
    description: 'Some compatible providers expose response-side reasoning traces without safe request-side controls.',
    requestShape: 'response-reasoning-trace-only',
    supportedEfforts: [],
    requestedEffort: 'none',
    effectiveEffort: 'none',
    modelMetadataSupportsReasoning: false,
    appRequestControl: false,
    policy: { ...PROVIDER_REASONING_POLICY, inputTokenBudget: 12000, outputTokenBudget: 6000, estimatedCostUsd: 0.08 },
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'bounded-verification-loop',
    providerFamily: 'app-workflow',
    surface: 'app-loop',
    docs: ['docs/architecture/reasoning-runtime-compatibility-gates.md'],
    description: 'Test-time compute uses an explicit answer-and-verify loop with bounded steps and visible eval outcome.',
    requestShape: 'bounded-verifier-loop',
    supportedEfforts: ['low', 'medium', 'high'],
    requestedEffort: 'medium',
    effectiveEffort: 'medium',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: APP_LOOP_POLICY,
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: true, toolEvidence: false },
  },
  {
    id: 'tool-result-self-check-loop',
    providerFamily: 'app-workflow',
    surface: 'app-loop',
    docs: ['docs/architecture/reasoning-runtime-compatibility-gates.md'],
    description: 'Tool-using workflows perform a bounded self-check against tool evidence instead of trusting model text.',
    requestShape: 'tool-result-self-check',
    supportedEfforts: ['low', 'medium', 'high'],
    requestedEffort: 'medium',
    effectiveEffort: 'medium',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: { ...APP_LOOP_POLICY, toolEvidenceRequired: true },
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: true, toolEvidence: true },
  },
  {
    id: 'unsupported-provider-effort-blocked',
    providerFamily: 'generic',
    surface: 'provider-request',
    docs: ['docs/architecture/reasoning-runtime-compatibility-gates.md'],
    description: 'Generic providers must not receive reasoning effort fields without model metadata and compatibility evidence.',
    requestShape: 'none',
    supportedEfforts: [],
    requestedEffort: 'high',
    effectiveEffort: 'none',
    modelMetadataSupportsReasoning: false,
    appRequestControl: false,
    policy: PROVIDER_REASONING_POLICY,
    trace: { reasoningSummary: false, hiddenChainOfThought: false, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'budget-escalation-blocked',
    providerFamily: 'app-workflow',
    surface: 'app-loop',
    docs: ['docs/architecture/reasoning-runtime-compatibility-gates.md'],
    description: 'Verification loops cannot silently increase effort, retries, tokens, or cost when fallback occurs.',
    requestShape: 'bounded-verifier-loop',
    supportedEfforts: ['low', 'medium', 'high'],
    requestedEffort: 'high',
    effectiveEffort: 'high',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: {
      ...APP_LOOP_POLICY,
      retryLimit: 8,
      outputTokenBudget: 0,
      estimatedCostUsd: 0,
      fallbackMayIncreaseEffort: true,
    },
    trace: { reasoningSummary: true, hiddenChainOfThought: false, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'hidden-reasoning-export-blocked',
    providerFamily: 'openai',
    surface: 'provider-request',
    docs: ['https://platform.openai.com/docs/guides/reasoning'],
    description: 'Runtime diagnostics must store summaries and metrics, not hidden chain-of-thought or raw thinking payloads.',
    requestShape: 'openai-responses-reasoning',
    supportedEfforts: ['none', 'minimal', 'low', 'medium', 'high'],
    requestedEffort: 'medium',
    effectiveEffort: 'medium',
    modelMetadataSupportsReasoning: true,
    appRequestControl: true,
    policy: { ...PROVIDER_REASONING_POLICY, storesHiddenChain: true },
    trace: { reasoningSummary: true, hiddenChainOfThought: true, evalOutcome: false, toolEvidence: false },
  },
  {
    id: 'prompt-only-cot-blocked',
    providerFamily: 'generic',
    surface: 'blocked',
    docs: ['docs/architecture/reasoning-runtime-compatibility-gates.md'],
    description: 'Prompt-only chain-of-thought instructions are not accepted as a reasoning control plane.',
    requestShape: 'none',
    supportedEfforts: [],
    requestedEffort: 'high',
    effectiveEffort: 'none',
    modelMetadataSupportsReasoning: false,
    appRequestControl: false,
    policy: { ...PROVIDER_REASONING_POLICY, userVisibleSummary: false, cancellation: false },
    trace: { reasoningSummary: false, hiddenChainOfThought: true, evalOutcome: false, toolEvidence: false, failureCode: 'prompt-only-cot-blocked' },
  },
]

export function runReasoningRuntimeCompatibilityEvaluation(
  options: ReasoningRuntimeCompatibilityEvaluationOptions = {},
): ReasoningRuntimeCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? REASONING_RUNTIME_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateReasoningRuntimeFixture)
  return {
    schema: REASONING_RUNTIME_COMPATIBILITY_EVAL_SCHEMA,
    id: `reasoning-runtime-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateReasoningRuntimeCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateReasoningRuntimeFixture(fixture: ReasoningRuntimeFixture): ReasoningRuntimeDiagnostic {
  const failureCodes = collectReasoningRuntimeFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    providerFamily: fixture.providerFamily,
    surface: fixture.surface,
    docs: [...fixture.docs],
    description: fixture.description,
    requestShape: fixture.requestShape,
    readiness: resolveReasoningRuntimeReadiness(fixture, failureCodes),
    supportedEfforts: [...fixture.supportedEfforts],
    requestedEffort: fixture.requestedEffort,
    effectiveEffort: fixture.effectiveEffort,
    modelMetadataSupportsReasoning: fixture.modelMetadataSupportsReasoning,
    appRequestControl: fixture.appRequestControl,
    policy: { ...fixture.policy },
    trace: { ...fixture.trace },
    failureCodes,
  }
}

export function evaluateReasoningRuntimeCompatibilityQualityGate(
  diagnostics: ReasoningRuntimeDiagnostic[],
  requiredFixtureIds: string[] = [...REASONING_RUNTIME_COMPATIBILITY_FIXTURE_IDS],
): ReasoningRuntimeCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRequestShapes: ReasoningRuntimeRequestShape[] = [
    'openai-responses-reasoning',
    'anthropic-thinking-budget',
    'google-thinking-budget',
    'response-reasoning-trace-only',
    'bounded-verifier-loop',
    'tool-result-self-check',
    'none',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const shape of requiredRequestShapes) {
    if (!diagnostics.some((item) => item.requestShape === shape)) failures.push(`${shape}:missing-request-shape`)
  }
  for (const item of diagnostics) {
    if (!item.docs.length) failures.push(`${item.fixtureId}:missing-docs`)
    if (item.readiness !== 'blocked' && item.policy.storesHiddenChain) failures.push(`${item.fixtureId}:stores-hidden-chain`)
    if (item.readiness !== 'blocked' && item.policy.fallbackMayIncreaseEffort) failures.push(`${item.fixtureId}:fallback-escalates-effort`)
    if (item.readiness === 'ready') requireBoundedPolicy(item, failures)
  }

  requireReady(byId.get('openai-responses-reasoning-effort'), failures, 'openai-responses-reasoning')
  requireReady(byId.get('anthropic-thinking-budget'), failures, 'anthropic-thinking-budget')
  requireReady(byId.get('google-thinking-budget'), failures, 'google-thinking-budget')
  requireReady(byId.get('bounded-verification-loop'), failures, 'bounded-verifier-loop')
  requireReady(byId.get('tool-result-self-check-loop'), failures, 'tool-result-self-check')

  const traceOnly = byId.get('provider-response-reasoning-trace')
  if (traceOnly?.readiness !== 'trace-only') failures.push('provider-response-reasoning-trace:not-trace-only')
  if (traceOnly?.requestShape !== 'response-reasoning-trace-only') failures.push('provider-response-reasoning-trace:wrong-shape')
  if (traceOnly?.appRequestControl !== false) failures.push('provider-response-reasoning-trace:claims-request-control')

  requireBlocked(byId.get('unsupported-provider-effort-blocked'), failures, 'unsupported-provider-effort-blocked', ['missing-model-metadata', 'unsupported-request-control', 'unsupported-request-shape'])
  requireBlocked(byId.get('budget-escalation-blocked'), failures, 'budget-escalation-blocked', ['token-budget-missing', 'cost-budget-missing', 'fallback-escalates-reasoning', 'retry-unbounded', 'eval-outcome-missing'])
  requireBlocked(byId.get('hidden-reasoning-export-blocked'), failures, 'hidden-reasoning-export-blocked', ['hidden-reasoning-leak'])
  requireBlocked(byId.get('prompt-only-cot-blocked'), failures, 'prompt-only-cot-blocked', ['prompt-only-cot-blocked', 'hidden-reasoning-leak', 'cancellation-missing'])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredRequestShapes,
  }
}

function requireReady(item: ReasoningRuntimeDiagnostic | undefined, failures: string[], expectedShape: ReasoningRuntimeRequestShape): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (item.requestShape !== expectedShape) failures.push(`${item.fixtureId}:wrong-shape`)
  if (!item.appRequestControl) failures.push(`${item.fixtureId}:missing-app-request-control`)
  if (!item.modelMetadataSupportsReasoning) failures.push(`${item.fixtureId}:missing-model-metadata`)
  if (item.trace.hiddenChainOfThought) failures.push(`${item.fixtureId}:hidden-chain-leaked`)
}

function requireBoundedPolicy(item: ReasoningRuntimeDiagnostic, failures: string[]): void {
  if (item.policy.maxSteps <= 0) failures.push(`${item.fixtureId}:missing-max-steps`)
  if (item.policy.timeoutMs <= 0) failures.push(`${item.fixtureId}:missing-timeout`)
  if (item.policy.inputTokenBudget <= 0 || item.policy.outputTokenBudget <= 0) failures.push(`${item.fixtureId}:missing-token-budget`)
  if (item.policy.estimatedCostUsd <= 0) failures.push(`${item.fixtureId}:missing-cost-budget`)
  if (!item.policy.cancellation) failures.push(`${item.fixtureId}:missing-cancellation`)
  if (!item.policy.userVisibleSummary) failures.push(`${item.fixtureId}:missing-visible-summary`)
  if (item.policy.evalOutcomeRequired && !item.trace.evalOutcome) failures.push(`${item.fixtureId}:missing-eval-outcome`)
  if (item.policy.toolEvidenceRequired && !item.trace.toolEvidence) failures.push(`${item.fixtureId}:missing-tool-evidence`)
}

function requireBlocked(
  item: ReasoningRuntimeDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ReasoningRuntimeFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectReasoningRuntimeFailureCodes(fixture: ReasoningRuntimeFixture): ReasoningRuntimeFailureCode[] {
  const failures: ReasoningRuntimeFailureCode[] = []
  if (!fixture.docs.length) failures.push('missing-provider-docs')
  if (fixture.trace.failureCode) failures.push(fixture.trace.failureCode)
  if (fixture.surface === 'blocked') failures.push('prompt-only-cot-blocked')
  if (fixture.surface === 'provider-request' && !fixture.modelMetadataSupportsReasoning) failures.push('missing-model-metadata')
  if (fixture.surface === 'provider-request' && fixture.requestedEffort !== 'none' && !fixture.appRequestControl) failures.push('unsupported-request-control')
  if (fixture.surface === 'provider-request' && fixture.requestedEffort !== 'none' && fixture.requestShape === 'none') failures.push('unsupported-request-shape')
  if (fixture.policy.inputTokenBudget <= 0 || fixture.policy.outputTokenBudget <= 0) failures.push('token-budget-missing')
  if (fixture.policy.estimatedCostUsd <= 0) failures.push('cost-budget-missing')
  if (fixture.policy.maxSteps <= 0) failures.push('max-steps-missing')
  if (fixture.policy.timeoutMs <= 0) failures.push('timeout-missing')
  if (!fixture.policy.cancellation) failures.push('cancellation-missing')
  if (fixture.policy.storesHiddenChain || fixture.trace.hiddenChainOfThought) failures.push('hidden-reasoning-leak')
  if (fixture.policy.evalOutcomeRequired && !fixture.trace.evalOutcome) failures.push('eval-outcome-missing')
  if (fixture.policy.toolEvidenceRequired && !fixture.trace.toolEvidence) failures.push('tool-evidence-missing')
  if (fixture.policy.fallbackMayIncreaseEffort) failures.push('fallback-escalates-reasoning')
  if (fixture.policy.retryLimit > Math.max(1, fixture.policy.maxSteps)) failures.push('retry-unbounded')
  return unique(failures)
}

function resolveReasoningRuntimeReadiness(
  fixture: ReasoningRuntimeFixture,
  failureCodes: ReasoningRuntimeFailureCode[],
): ReasoningRuntimeReadiness {
  if (fixture.surface === 'blocked') return 'blocked'
  if (fixture.surface === 'provider-response-trace' && failureCodes.length === 0) return 'trace-only'
  if (failureCodes.length > 0) return 'blocked'
  return 'ready'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
