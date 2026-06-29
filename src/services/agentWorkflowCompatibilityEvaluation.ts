export const AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA = 'islemind.agent-workflow-compatibility-eval.v1'
export const AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS = [
  'runtime-state-machine-boundary',
  'direct-chat-controlled-bypass',
  'permission-pending-action-confirmation',
  'step-limit-human-resume',
  'cancellation-progress-recovery',
  'rag-evidence-repair-pause',
  'work-artifact-quality-audit',
  'handoff-diagnostic-visible-output',
  'runtime-trace-observability',
  'blocked-unbounded-autonomous-loop',
  'blocked-hidden-tool-action',
  'blocked-background-continuation',
  'blocked-unsafe-resume-payload',
] as const

export type AgentWorkflowCompatibilityFixtureId = typeof AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS[number]
export type AgentWorkflowRunKind =
  | 'direct-chat'
  | 'tool-workflow'
  | 'saved-workflow'
  | 'rag-evidence'
  | 'work-artifact'
  | 'handoff'
  | 'diagnostic'
  | 'blocked'
export type AgentWorkflowControlPattern =
  | 'state-machine'
  | 'permission-gate'
  | 'step-limit'
  | 'cancellation'
  | 'evidence-repair'
  | 'quality-audit'
  | 'handoff'
  | 'trace-observability'
  | 'resume'
export type AgentWorkflowReadiness = 'ready' | 'paused' | 'blocked'
export type AgentWorkflowFailureCode =
  | 'missing-runtime-schema'
  | 'missing-state-machine'
  | 'missing-step-limit'
  | 'step-limit-overrun'
  | 'missing-tool-call-limit'
  | 'tool-call-limit-overrun'
  | 'missing-visible-trace'
  | 'missing-audit-event'
  | 'missing-permission-check'
  | 'hidden-tool-action'
  | 'missing-user-confirmation'
  | 'missing-pending-action'
  | 'missing-cancellation'
  | 'missing-recovery-prompt'
  | 'missing-output-budget'
  | 'output-budget-overrun'
  | 'missing-quality-audit'
  | 'missing-evidence-repair'
  | 'unsafe-resume-payload'
  | 'background-continuation-enabled'
  | 'missing-human-review'
  | 'missing-redaction'
  | 'missing-step-attribution'
  | 'raw-command-enabled'

export interface AgentWorkflowCompatibilityPolicy {
  runtimeSchema: boolean
  stateMachine: boolean
  maxSteps: number
  maxToolCallsPerStep: number
  visibleTrace: boolean
  auditEvent: boolean
  permissionChecked: boolean
  toolActionVisible: boolean
  userConfirmationRequired: boolean
  userConfirmationAvailable: boolean
  pendingActionRecorded: boolean
  cancellationSupported: boolean
  recoveryPrompt: boolean
  outputCharLimit: number
  qualityAudit: boolean
  evidenceRepair: boolean
  resumePayloadSafe: boolean
  backgroundContinuationAllowed: boolean
  humanReviewRequired: boolean
  redaction: boolean
  stepAttribution: boolean
  rawCommandAllowed: boolean
}

export interface AgentWorkflowCompatibilityFixture {
  id: AgentWorkflowCompatibilityFixtureId | string
  runKind: AgentWorkflowRunKind
  controlPattern: AgentWorkflowControlPattern
  expectedReadiness: AgentWorkflowReadiness
  description: string
  policy: AgentWorkflowCompatibilityPolicy
}

export interface AgentWorkflowCompatibilityDiagnostic {
  fixtureId: string
  runKind: AgentWorkflowRunKind
  controlPattern: AgentWorkflowControlPattern
  description: string
  readiness: AgentWorkflowReadiness
  policy: AgentWorkflowCompatibilityPolicy
  failureCodes: AgentWorkflowFailureCode[]
}

export interface AgentWorkflowCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredRunKinds: AgentWorkflowRunKind[]
  requiredControlPatterns: AgentWorkflowControlPattern[]
}

export interface AgentWorkflowCompatibilityEvaluationRun {
  schema: typeof AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: AgentWorkflowCompatibilityDiagnostic[]
  qualityGate: AgentWorkflowCompatibilityQualityGate
}

export interface AgentWorkflowCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: AgentWorkflowCompatibilityFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_WORKFLOW_POLICY: AgentWorkflowCompatibilityPolicy = {
  runtimeSchema: true,
  stateMachine: true,
  maxSteps: 3,
  maxToolCallsPerStep: 1,
  visibleTrace: true,
  auditEvent: true,
  permissionChecked: true,
  toolActionVisible: true,
  userConfirmationRequired: false,
  userConfirmationAvailable: false,
  pendingActionRecorded: false,
  cancellationSupported: true,
  recoveryPrompt: true,
  outputCharLimit: 4800,
  qualityAudit: false,
  evidenceRepair: false,
  resumePayloadSafe: true,
  backgroundContinuationAllowed: false,
  humanReviewRequired: true,
  redaction: true,
  stepAttribution: true,
  rawCommandAllowed: false,
}

export const AGENT_WORKFLOW_COMPATIBILITY_FIXTURES: AgentWorkflowCompatibilityFixture[] = [
  {
    id: 'runtime-state-machine-boundary',
    runKind: 'saved-workflow',
    controlPattern: 'state-machine',
    expectedReadiness: 'ready',
    description: 'Agent workflows use a finite runtime schema, bounded status transitions, step limits, and trace evidence.',
    policy: SAFE_WORKFLOW_POLICY,
  },
  {
    id: 'direct-chat-controlled-bypass',
    runKind: 'direct-chat',
    controlPattern: 'state-machine',
    expectedReadiness: 'ready',
    description: 'Direct chat may bypass tools, but still records bounded runtime metadata and visible synthesis traces.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      permissionChecked: false,
      humanReviewRequired: false,
      stepAttribution: false,
    },
  },
  {
    id: 'permission-pending-action-confirmation',
    runKind: 'tool-workflow',
    controlPattern: 'permission-gate',
    expectedReadiness: 'paused',
    description: 'Permissioned app, Android, and MCP actions pause with a visible pending action instead of executing invisibly.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      userConfirmationRequired: true,
      userConfirmationAvailable: true,
      pendingActionRecorded: true,
    },
  },
  {
    id: 'step-limit-human-resume',
    runKind: 'saved-workflow',
    controlPattern: 'step-limit',
    expectedReadiness: 'paused',
    description: 'Workflow step limits pause with completed/remaining counts and a human-readable resume prompt.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      pendingActionRecorded: true,
    },
  },
  {
    id: 'cancellation-progress-recovery',
    runKind: 'saved-workflow',
    controlPattern: 'cancellation',
    expectedReadiness: 'ready',
    description: 'Cancellation records visible progress, remaining steps, and a safe continuation prompt without retaining pending actions.',
    policy: SAFE_WORKFLOW_POLICY,
  },
  {
    id: 'rag-evidence-repair-pause',
    runKind: 'rag-evidence',
    controlPattern: 'evidence-repair',
    expectedReadiness: 'paused',
    description: 'RAG evidence gaps pause the workflow with repair strategy, source attribution, and next-step guidance.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      pendingActionRecorded: true,
      evidenceRepair: true,
    },
  },
  {
    id: 'work-artifact-quality-audit',
    runKind: 'work-artifact',
    controlPattern: 'quality-audit',
    expectedReadiness: 'ready',
    description: 'Work artifact workflows require source evidence, quality audit metadata, and bounded final output before done.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      qualityAudit: true,
      evidenceRepair: true,
    },
  },
  {
    id: 'handoff-diagnostic-visible-output',
    runKind: 'handoff',
    controlPattern: 'handoff',
    expectedReadiness: 'ready',
    description: 'Handoff and diagnostic workflows expose quality gaps, source evidence, follow-up prompts, and visible trace output.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      qualityAudit: true,
      evidenceRepair: true,
    },
  },
  {
    id: 'runtime-trace-observability',
    runKind: 'diagnostic',
    controlPattern: 'trace-observability',
    expectedReadiness: 'ready',
    description: 'Runtime traces expose schema id, run id, goal hash, status counts, transition reasons, and failure codes.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      qualityAudit: true,
    },
  },
  {
    id: 'blocked-unbounded-autonomous-loop',
    runKind: 'blocked',
    controlPattern: 'step-limit',
    expectedReadiness: 'blocked',
    description: 'Unbounded autonomous loops or excessive step/tool-call limits are blocked before execution.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      maxSteps: 99,
      maxToolCallsPerStep: 8,
      pendingActionRecorded: false,
      backgroundContinuationAllowed: true,
    },
  },
  {
    id: 'blocked-hidden-tool-action',
    runKind: 'blocked',
    controlPattern: 'permission-gate',
    expectedReadiness: 'blocked',
    description: 'Hidden tool actions without permission checks, confirmation, trace, audit, or visible action details fail closed.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      visibleTrace: false,
      auditEvent: false,
      permissionChecked: false,
      toolActionVisible: false,
      userConfirmationRequired: true,
      userConfirmationAvailable: false,
      pendingActionRecorded: false,
    },
  },
  {
    id: 'blocked-background-continuation',
    runKind: 'blocked',
    controlPattern: 'resume',
    expectedReadiness: 'blocked',
    description: 'Background continuation without explicit human review is blocked for mobile agent workflows.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      backgroundContinuationAllowed: true,
      humanReviewRequired: false,
      pendingActionRecorded: false,
    },
  },
  {
    id: 'blocked-unsafe-resume-payload',
    runKind: 'blocked',
    controlPattern: 'resume',
    expectedReadiness: 'blocked',
    description: 'Pending actions cannot persist unsafe resume payloads, raw commands, or unredacted sensitive data.',
    policy: {
      ...SAFE_WORKFLOW_POLICY,
      userConfirmationRequired: true,
      userConfirmationAvailable: true,
      pendingActionRecorded: true,
      resumePayloadSafe: false,
      redaction: false,
      rawCommandAllowed: true,
    },
  },
]

export function runAgentWorkflowCompatibilityEvaluation(
  options: AgentWorkflowCompatibilityEvaluationOptions = {},
): AgentWorkflowCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? AGENT_WORKFLOW_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateAgentWorkflowFixture)
  return {
    schema: AGENT_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA,
    id: `agent-workflow-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateAgentWorkflowCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateAgentWorkflowFixture(
  fixture: AgentWorkflowCompatibilityFixture,
): AgentWorkflowCompatibilityDiagnostic {
  const failureCodes = collectAgentWorkflowFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    runKind: fixture.runKind,
    controlPattern: fixture.controlPattern,
    description: fixture.description,
    readiness: resolveAgentWorkflowReadiness(fixture, failureCodes),
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateAgentWorkflowCompatibilityQualityGate(
  diagnostics: AgentWorkflowCompatibilityDiagnostic[],
  requiredFixtureIds: string[] = [...AGENT_WORKFLOW_COMPATIBILITY_FIXTURE_IDS],
): AgentWorkflowCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRunKinds: AgentWorkflowRunKind[] = [
    'direct-chat',
    'tool-workflow',
    'saved-workflow',
    'rag-evidence',
    'work-artifact',
    'handoff',
    'diagnostic',
    'blocked',
  ]
  const requiredControlPatterns: AgentWorkflowControlPattern[] = [
    'state-machine',
    'permission-gate',
    'step-limit',
    'cancellation',
    'evidence-repair',
    'quality-audit',
    'handoff',
    'trace-observability',
    'resume',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const runKind of requiredRunKinds) {
    if (!diagnostics.some((item) => item.runKind === runKind)) failures.push(`${runKind}:missing-run-kind`)
  }
  for (const controlPattern of requiredControlPatterns) {
    if (!diagnostics.some((item) => item.controlPattern === controlPattern)) failures.push(`${controlPattern}:missing-control-pattern`)
  }

  requireReady(byId.get('runtime-state-machine-boundary'), failures)
  requireReady(byId.get('direct-chat-controlled-bypass'), failures, { requirePermission: false, requireStepAttribution: false })
  requirePaused(byId.get('permission-pending-action-confirmation'), failures, 'permission-pending-action-confirmation', [
    'permission-gate',
    'pending-action',
    'confirmation',
  ])
  requirePaused(byId.get('step-limit-human-resume'), failures, 'step-limit-human-resume', [
    'step-limit',
    'pending-action',
    'recovery-prompt',
  ])
  requireReady(byId.get('cancellation-progress-recovery'), failures)
  requirePaused(byId.get('rag-evidence-repair-pause'), failures, 'rag-evidence-repair-pause', [
    'evidence-repair',
    'pending-action',
    'recovery-prompt',
  ])
  requireReady(byId.get('work-artifact-quality-audit'), failures, { requireQualityAudit: true, requireEvidenceRepair: true })
  requireReady(byId.get('handoff-diagnostic-visible-output'), failures, { requireQualityAudit: true, requireEvidenceRepair: true })
  requireReady(byId.get('runtime-trace-observability'), failures, { requireQualityAudit: true })

  requireBlocked(byId.get('blocked-unbounded-autonomous-loop'), failures, 'blocked-unbounded-autonomous-loop', [
    'step-limit-overrun',
    'tool-call-limit-overrun',
    'background-continuation-enabled',
  ])
  requireBlocked(byId.get('blocked-hidden-tool-action'), failures, 'blocked-hidden-tool-action', [
    'missing-visible-trace',
    'missing-audit-event',
    'missing-permission-check',
    'hidden-tool-action',
    'missing-user-confirmation',
    'missing-pending-action',
  ])
  requireBlocked(byId.get('blocked-background-continuation'), failures, 'blocked-background-continuation', [
    'background-continuation-enabled',
    'missing-human-review',
  ])
  requireBlocked(byId.get('blocked-unsafe-resume-payload'), failures, 'blocked-unsafe-resume-payload', [
    'unsafe-resume-payload',
    'missing-redaction',
    'raw-command-enabled',
  ])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredRunKinds,
    requiredControlPatterns,
  }
}

function requireReady(
  item: AgentWorkflowCompatibilityDiagnostic | undefined,
  failures: string[],
  options: {
    requirePermission?: boolean
    requireStepAttribution?: boolean
    requireQualityAudit?: boolean
    requireEvidenceRepair?: boolean
  } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselinePolicy(item, failures, options)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requirePaused(
  item: AgentWorkflowCompatibilityDiagnostic | undefined,
  failures: string[],
  id: string,
  expected: Array<'permission-gate' | 'pending-action' | 'confirmation' | 'step-limit' | 'recovery-prompt' | 'evidence-repair'>,
): void {
  if (!item) return
  if (item.readiness !== 'paused') failures.push(`${id}:not-paused`)
  requireBaselinePolicy(item, failures)
  if (expected.includes('permission-gate') && !item.policy.permissionChecked) failures.push(`${id}:missing-permission-check`)
  if (expected.includes('pending-action') && !item.policy.pendingActionRecorded) failures.push(`${id}:missing-pending-action`)
  if (expected.includes('confirmation') && !item.policy.userConfirmationAvailable) failures.push(`${id}:missing-confirmation`)
  if (expected.includes('step-limit') && item.policy.maxSteps < 1) failures.push(`${id}:missing-step-limit`)
  if (expected.includes('recovery-prompt') && !item.policy.recoveryPrompt) failures.push(`${id}:missing-recovery-prompt`)
  if (expected.includes('evidence-repair') && !item.policy.evidenceRepair) failures.push(`${id}:missing-evidence-repair`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireBaselinePolicy(
  item: AgentWorkflowCompatibilityDiagnostic,
  failures: string[],
  options: {
    requirePermission?: boolean
    requireStepAttribution?: boolean
    requireQualityAudit?: boolean
    requireEvidenceRepair?: boolean
  } = {},
): void {
  const requirePermission = options.requirePermission ?? true
  const requireStepAttribution = options.requireStepAttribution ?? true
  if (!item.policy.runtimeSchema) failures.push(`${item.fixtureId}:missing-runtime-schema`)
  if (!item.policy.stateMachine) failures.push(`${item.fixtureId}:missing-state-machine`)
  if (item.policy.maxSteps < 1 || item.policy.maxSteps > 8) failures.push(`${item.fixtureId}:invalid-step-limit`)
  if (item.policy.maxToolCallsPerStep < 1 || item.policy.maxToolCallsPerStep > 3) failures.push(`${item.fixtureId}:invalid-tool-call-limit`)
  if (!item.policy.visibleTrace) failures.push(`${item.fixtureId}:missing-visible-trace`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit-event`)
  if (requirePermission && !item.policy.permissionChecked) failures.push(`${item.fixtureId}:missing-permission-check`)
  if (!item.policy.toolActionVisible) failures.push(`${item.fixtureId}:hidden-tool-action`)
  if (item.policy.outputCharLimit < 512 || item.policy.outputCharLimit > 12000) failures.push(`${item.fixtureId}:invalid-output-budget`)
  if (!item.policy.cancellationSupported) failures.push(`${item.fixtureId}:missing-cancellation`)
  if (!item.policy.recoveryPrompt) failures.push(`${item.fixtureId}:missing-recovery-prompt`)
  if (options.requireQualityAudit && !item.policy.qualityAudit) failures.push(`${item.fixtureId}:missing-quality-audit`)
  if (options.requireEvidenceRepair && !item.policy.evidenceRepair) failures.push(`${item.fixtureId}:missing-evidence-repair`)
  if (!item.policy.resumePayloadSafe) failures.push(`${item.fixtureId}:unsafe-resume-payload`)
  if (item.policy.backgroundContinuationAllowed) failures.push(`${item.fixtureId}:background-continuation`)
  if (!item.policy.redaction) failures.push(`${item.fixtureId}:missing-redaction`)
  if (requireStepAttribution && !item.policy.stepAttribution) failures.push(`${item.fixtureId}:missing-step-attribution`)
  if (item.policy.rawCommandAllowed) failures.push(`${item.fixtureId}:raw-command`)
}

function requireBlocked(
  item: AgentWorkflowCompatibilityDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: AgentWorkflowFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectAgentWorkflowFailureCodes(
  fixture: AgentWorkflowCompatibilityFixture,
): AgentWorkflowFailureCode[] {
  const policy = fixture.policy
  const failures: AgentWorkflowFailureCode[] = []
  if (!policy.runtimeSchema) failures.push('missing-runtime-schema')
  if (!policy.stateMachine) failures.push('missing-state-machine')
  if (policy.maxSteps < 1) failures.push('missing-step-limit')
  if (policy.maxSteps > 8) failures.push('step-limit-overrun')
  if (policy.maxToolCallsPerStep < 1) failures.push('missing-tool-call-limit')
  if (policy.maxToolCallsPerStep > 3) failures.push('tool-call-limit-overrun')
  if (!policy.visibleTrace) failures.push('missing-visible-trace')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (requiresPermissionCheck(fixture) && !policy.permissionChecked) failures.push('missing-permission-check')
  if (!policy.toolActionVisible) failures.push('hidden-tool-action')
  if (policy.userConfirmationRequired && !policy.userConfirmationAvailable) failures.push('missing-user-confirmation')
  if (requiresPendingAction(fixture) && !policy.pendingActionRecorded) failures.push('missing-pending-action')
  if (!policy.cancellationSupported) failures.push('missing-cancellation')
  if (requiresRecoveryPrompt(fixture) && !policy.recoveryPrompt) failures.push('missing-recovery-prompt')
  if (policy.outputCharLimit < 512) failures.push('missing-output-budget')
  if (policy.outputCharLimit > 12000) failures.push('output-budget-overrun')
  if (requiresQualityAudit(fixture) && !policy.qualityAudit) failures.push('missing-quality-audit')
  if (requiresEvidenceRepair(fixture) && !policy.evidenceRepair) failures.push('missing-evidence-repair')
  if (!policy.resumePayloadSafe) failures.push('unsafe-resume-payload')
  if (policy.backgroundContinuationAllowed) failures.push('background-continuation-enabled')
  if (requiresHumanReview(fixture) && !policy.humanReviewRequired) failures.push('missing-human-review')
  if (!policy.redaction) failures.push('missing-redaction')
  if (requiresStepAttribution(fixture) && !policy.stepAttribution) failures.push('missing-step-attribution')
  if (policy.rawCommandAllowed) failures.push('raw-command-enabled')
  return unique(failures)
}

function resolveAgentWorkflowReadiness(
  fixture: AgentWorkflowCompatibilityFixture,
  failureCodes: AgentWorkflowFailureCode[],
): AgentWorkflowReadiness {
  if (failureCodes.some((code) => BLOCKING_AGENT_WORKFLOW_FAILURES.has(code))) return 'blocked'
  if (fixture.expectedReadiness === 'blocked') return 'blocked'
  if (fixture.expectedReadiness === 'paused') return 'paused'
  return 'ready'
}

function requiresPermissionCheck(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.runKind !== 'direct-chat'
}

function requiresPendingAction(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.controlPattern === 'permission-gate' ||
    fixture.controlPattern === 'step-limit' ||
    fixture.controlPattern === 'evidence-repair'
}

function requiresRecoveryPrompt(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.controlPattern === 'step-limit' ||
    fixture.controlPattern === 'cancellation' ||
    fixture.controlPattern === 'evidence-repair' ||
    fixture.controlPattern === 'resume'
}

function requiresQualityAudit(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.runKind === 'work-artifact' ||
    fixture.runKind === 'handoff' ||
    fixture.runKind === 'diagnostic' ||
    fixture.controlPattern === 'quality-audit' ||
    fixture.controlPattern === 'handoff'
}

function requiresEvidenceRepair(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.runKind === 'rag-evidence' || fixture.controlPattern === 'evidence-repair'
}

function requiresHumanReview(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.controlPattern === 'permission-gate' ||
    fixture.controlPattern === 'step-limit' ||
    fixture.controlPattern === 'resume' ||
    fixture.runKind === 'handoff' ||
    fixture.runKind === 'diagnostic'
}

function requiresStepAttribution(fixture: AgentWorkflowCompatibilityFixture): boolean {
  return fixture.runKind !== 'direct-chat'
}

const BLOCKING_AGENT_WORKFLOW_FAILURES = new Set<AgentWorkflowFailureCode>([
  'missing-runtime-schema',
  'missing-state-machine',
  'missing-step-limit',
  'step-limit-overrun',
  'missing-tool-call-limit',
  'tool-call-limit-overrun',
  'missing-visible-trace',
  'missing-audit-event',
  'missing-permission-check',
  'hidden-tool-action',
  'missing-user-confirmation',
  'missing-pending-action',
  'missing-cancellation',
  'missing-recovery-prompt',
  'missing-output-budget',
  'output-budget-overrun',
  'missing-quality-audit',
  'missing-evidence-repair',
  'unsafe-resume-payload',
  'background-continuation-enabled',
  'missing-human-review',
  'missing-redaction',
  'missing-step-attribution',
  'raw-command-enabled',
])

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
