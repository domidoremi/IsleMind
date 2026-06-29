export const TOOL_CALLING_COMPATIBILITY_EVAL_SCHEMA = 'islemind.tool-calling-compatibility-eval.v1'
export const TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS = [
  'mcp-manifest-tool-contract',
  'provider-native-function-call',
  'structured-output-separated-from-tools',
  'android-native-tool-confirmation',
  'rag-tool-citation-output',
  'tool-result-output-budget-redaction',
  'tool-call-replay-id-reconciliation',
  'blocked-ambiguous-tool-name',
  'blocked-malformed-tool-arguments',
  'blocked-destructive-tool-without-confirmation',
  'blocked-model-composed-command-tool',
] as const

export type ToolCallingFixtureId = typeof TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS[number]
export type ToolCallingSource =
  | 'mcp'
  | 'provider-native'
  | 'structured-output'
  | 'android-native'
  | 'rag'
  | 'gateway'
  | 'blocked'
export type ToolCallingRequestShape =
  | 'mcp-tools-list-schema'
  | 'provider-function-call'
  | 'structured-output-non-tool'
  | 'android-native-action'
  | 'rag-tool'
  | 'tool-result-envelope'
  | 'provider-tool-replay'
  | 'none'
export type ToolCallingReadiness = 'ready' | 'blocked'
export type ToolCallingPermission = 'none' | 'read' | 'write' | 'destructive'
export type ToolCallingFailureCode =
  | 'missing-tool-contract'
  | 'missing-schema-validation'
  | 'ambiguous-tool-identity'
  | 'malformed-arguments'
  | 'missing-permission-check'
  | 'missing-user-confirmation'
  | 'missing-output-budget'
  | 'missing-redaction'
  | 'missing-audit-event'
  | 'missing-replay-id'
  | 'provider-replay-mismatch'
  | 'structured-output-tool-confusion'
  | 'model-composed-command-blocked'
  | 'destructive-tool-blocked'

export interface ToolCallingPolicy {
  typedContract: boolean
  schemaValidation: boolean
  uniqueToolIdentity: boolean
  argumentValid: boolean
  permissionChecked: boolean
  permission: ToolCallingPermission
  userConfirmation: boolean
  outputByteLimit: number
  redaction: boolean
  auditEvent: boolean
  replayIdStable: boolean
  providerReplayIdMatch: boolean
  structuredOutputSeparate: boolean
  modelMayComposeCommand: boolean
}

export interface ToolCallingFixture {
  id: ToolCallingFixtureId | string
  source: ToolCallingSource
  requestShape: ToolCallingRequestShape
  description: string
  toolName: string
  policy: ToolCallingPolicy
}

export interface ToolCallingDiagnostic {
  fixtureId: string
  source: ToolCallingSource
  requestShape: ToolCallingRequestShape
  description: string
  toolName: string
  readiness: ToolCallingReadiness
  policy: ToolCallingPolicy
  failureCodes: ToolCallingFailureCode[]
}

export interface ToolCallingCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredRequestShapes: ToolCallingRequestShape[]
}

export interface ToolCallingCompatibilityEvaluationRun {
  schema: typeof TOOL_CALLING_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: ToolCallingDiagnostic[]
  qualityGate: ToolCallingCompatibilityQualityGate
}

export interface ToolCallingCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: ToolCallingFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_TOOL_POLICY: ToolCallingPolicy = {
  typedContract: true,
  schemaValidation: true,
  uniqueToolIdentity: true,
  argumentValid: true,
  permissionChecked: true,
  permission: 'read',
  userConfirmation: false,
  outputByteLimit: 32768,
  redaction: true,
  auditEvent: true,
  replayIdStable: true,
  providerReplayIdMatch: true,
  structuredOutputSeparate: true,
  modelMayComposeCommand: false,
}

export const TOOL_CALLING_COMPATIBILITY_FIXTURES: ToolCallingFixture[] = [
  {
    id: 'mcp-manifest-tool-contract',
    source: 'mcp',
    requestShape: 'mcp-tools-list-schema',
    description: 'MCP tools are admitted through manifest schemas, stable server-qualified identity, permission, and audit.',
    toolName: 'github.search_issues',
    policy: SAFE_TOOL_POLICY,
  },
  {
    id: 'provider-native-function-call',
    source: 'provider-native',
    requestShape: 'provider-function-call',
    description: 'Provider-native tool calls use typed declarations, schema validation, and bounded replay state.',
    toolName: 'read_context',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'read',
    },
  },
  {
    id: 'structured-output-separated-from-tools',
    source: 'structured-output',
    requestShape: 'structured-output-non-tool',
    description: 'Structured output is validated as typed output and does not masquerade as an executable tool.',
    toolName: 'emit_structured_answer',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'none',
      replayIdStable: false,
      providerReplayIdMatch: true,
      structuredOutputSeparate: true,
    },
  },
  {
    id: 'android-native-tool-confirmation',
    source: 'android-native',
    requestShape: 'android-native-action',
    description: 'Android native actions use explicit permissions and confirmation before write or destructive changes.',
    toolName: 'android.files.apply_operations',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'destructive',
      userConfirmation: true,
      outputByteLimit: 65536,
    },
  },
  {
    id: 'rag-tool-citation-output',
    source: 'rag',
    requestShape: 'rag-tool',
    description: 'RAG tools return bounded, redacted context plus citation metadata instead of raw unbounded retrieval dumps.',
    toolName: 'rag.build_context_pack',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'read',
      outputByteLimit: 49152,
    },
  },
  {
    id: 'tool-result-output-budget-redaction',
    source: 'gateway',
    requestShape: 'tool-result-envelope',
    description: 'Tool result envelopes enforce output budgets, redaction, and audit before entering traces or context.',
    toolName: 'tool.gateway.outcome',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'none',
      replayIdStable: false,
    },
  },
  {
    id: 'tool-call-replay-id-reconciliation',
    source: 'provider-native',
    requestShape: 'provider-tool-replay',
    description: 'Provider-native tool replay requires stable call ids and same-provider reconciliation.',
    toolName: 'provider.replay_tool_result',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'read',
      replayIdStable: true,
      providerReplayIdMatch: true,
    },
  },
  {
    id: 'blocked-ambiguous-tool-name',
    source: 'blocked',
    requestShape: 'none',
    description: 'Bare duplicate tool names are blocked instead of binding by manifest order.',
    toolName: 'search',
    policy: {
      ...SAFE_TOOL_POLICY,
      uniqueToolIdentity: false,
    },
  },
  {
    id: 'blocked-malformed-tool-arguments',
    source: 'blocked',
    requestShape: 'provider-function-call',
    description: 'Malformed or incomplete tool arguments fail schema validation before execution.',
    toolName: 'read_context',
    policy: {
      ...SAFE_TOOL_POLICY,
      argumentValid: false,
    },
  },
  {
    id: 'blocked-destructive-tool-without-confirmation',
    source: 'blocked',
    requestShape: 'android-native-action',
    description: 'Destructive or write tools are blocked unless user confirmation is visible and current.',
    toolName: 'android.files.apply_operations',
    policy: {
      ...SAFE_TOOL_POLICY,
      permission: 'destructive',
      userConfirmation: false,
    },
  },
  {
    id: 'blocked-model-composed-command-tool',
    source: 'blocked',
    requestShape: 'none',
    description: 'The model can request typed tools but must never compose raw commands as a tool payload.',
    toolName: 'shell.exec',
    policy: {
      ...SAFE_TOOL_POLICY,
      typedContract: false,
      schemaValidation: false,
      permission: 'destructive',
      userConfirmation: false,
      modelMayComposeCommand: true,
    },
  },
]

export function runToolCallingCompatibilityEvaluation(
  options: ToolCallingCompatibilityEvaluationOptions = {},
): ToolCallingCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? TOOL_CALLING_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateToolCallingFixture)
  return {
    schema: TOOL_CALLING_COMPATIBILITY_EVAL_SCHEMA,
    id: `tool-calling-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateToolCallingCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateToolCallingFixture(fixture: ToolCallingFixture): ToolCallingDiagnostic {
  const failureCodes = collectToolCallingFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    source: fixture.source,
    requestShape: fixture.requestShape,
    description: fixture.description,
    toolName: fixture.toolName,
    readiness: resolveToolCallingReadiness(fixture, failureCodes),
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateToolCallingCompatibilityQualityGate(
  diagnostics: ToolCallingDiagnostic[],
  requiredFixtureIds: string[] = [...TOOL_CALLING_COMPATIBILITY_FIXTURE_IDS],
): ToolCallingCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRequestShapes: ToolCallingRequestShape[] = [
    'mcp-tools-list-schema',
    'provider-function-call',
    'structured-output-non-tool',
    'android-native-action',
    'rag-tool',
    'tool-result-envelope',
    'provider-tool-replay',
    'none',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const shape of requiredRequestShapes) {
    if (!diagnostics.some((item) => item.requestShape === shape)) failures.push(`${shape}:missing-request-shape`)
  }

  requireReady(byId.get('mcp-manifest-tool-contract'), failures)
  requireReady(byId.get('provider-native-function-call'), failures)
  requireReady(byId.get('structured-output-separated-from-tools'), failures)
  requireReady(byId.get('android-native-tool-confirmation'), failures)
  requireReady(byId.get('rag-tool-citation-output'), failures)
  requireReady(byId.get('tool-result-output-budget-redaction'), failures)
  requireReady(byId.get('tool-call-replay-id-reconciliation'), failures)

  const structured = byId.get('structured-output-separated-from-tools')
  if (structured?.policy.structuredOutputSeparate !== true) failures.push('structured-output-separated-from-tools:not-separated')
  if (structured?.requestShape !== 'structured-output-non-tool') failures.push('structured-output-separated-from-tools:wrong-shape')

  const android = byId.get('android-native-tool-confirmation')
  if (android?.policy.permission !== 'destructive') failures.push('android-native-tool-confirmation:not-destructive')
  if (android?.policy.userConfirmation !== true) failures.push('android-native-tool-confirmation:missing-confirmation')

  const replay = byId.get('tool-call-replay-id-reconciliation')
  if (replay?.policy.replayIdStable !== true) failures.push('tool-call-replay-id-reconciliation:missing-replay-id')
  if (replay?.policy.providerReplayIdMatch !== true) failures.push('tool-call-replay-id-reconciliation:mismatched-replay-id')

  requireBlocked(byId.get('blocked-ambiguous-tool-name'), failures, 'blocked-ambiguous-tool-name', ['ambiguous-tool-identity'])
  requireBlocked(byId.get('blocked-malformed-tool-arguments'), failures, 'blocked-malformed-tool-arguments', ['malformed-arguments'])
  requireBlocked(byId.get('blocked-destructive-tool-without-confirmation'), failures, 'blocked-destructive-tool-without-confirmation', ['missing-user-confirmation', 'destructive-tool-blocked'])
  requireBlocked(byId.get('blocked-model-composed-command-tool'), failures, 'blocked-model-composed-command-tool', ['missing-tool-contract', 'missing-schema-validation', 'model-composed-command-blocked', 'missing-user-confirmation'])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredRequestShapes,
  }
}

function requireReady(item: ToolCallingDiagnostic | undefined, failures: string[]): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (!item.policy.typedContract) failures.push(`${item.fixtureId}:missing-contract`)
  if (!item.policy.schemaValidation) failures.push(`${item.fixtureId}:missing-schema-validation`)
  if (!item.policy.uniqueToolIdentity) failures.push(`${item.fixtureId}:ambiguous-identity`)
  if (!item.policy.permissionChecked) failures.push(`${item.fixtureId}:missing-permission-check`)
  if (item.policy.permission === 'destructive' && !item.policy.userConfirmation) failures.push(`${item.fixtureId}:missing-confirmation`)
  if (item.policy.outputByteLimit <= 0) failures.push(`${item.fixtureId}:missing-output-budget`)
  if (!item.policy.redaction) failures.push(`${item.fixtureId}:missing-redaction`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (!item.policy.structuredOutputSeparate) failures.push(`${item.fixtureId}:structured-output-confused`)
  if (item.policy.modelMayComposeCommand) failures.push(`${item.fixtureId}:model-command`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireBlocked(
  item: ToolCallingDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: ToolCallingFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectToolCallingFailureCodes(fixture: ToolCallingFixture): ToolCallingFailureCode[] {
  const policy = fixture.policy
  const failures: ToolCallingFailureCode[] = []
  if (!policy.typedContract) failures.push('missing-tool-contract')
  if (!policy.schemaValidation) failures.push('missing-schema-validation')
  if (!policy.uniqueToolIdentity) failures.push('ambiguous-tool-identity')
  if (!policy.argumentValid) failures.push('malformed-arguments')
  if (!policy.permissionChecked) failures.push('missing-permission-check')
  if ((policy.permission === 'write' || policy.permission === 'destructive') && !policy.userConfirmation) failures.push('missing-user-confirmation')
  if (policy.outputByteLimit <= 0) failures.push('missing-output-budget')
  if (!policy.redaction) failures.push('missing-redaction')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (fixture.requestShape === 'provider-tool-replay' && !policy.replayIdStable) failures.push('missing-replay-id')
  if (fixture.requestShape === 'provider-tool-replay' && !policy.providerReplayIdMatch) failures.push('provider-replay-mismatch')
  if (!policy.structuredOutputSeparate) failures.push('structured-output-tool-confusion')
  if (policy.modelMayComposeCommand) failures.push('model-composed-command-blocked')
  if (policy.permission === 'destructive' && !policy.userConfirmation) failures.push('destructive-tool-blocked')
  return unique(failures)
}

function resolveToolCallingReadiness(
  fixture: ToolCallingFixture,
  failureCodes: ToolCallingFailureCode[],
): ToolCallingReadiness {
  if (fixture.source === 'blocked') return 'blocked'
  return failureCodes.length > 0 ? 'blocked' : 'ready'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
