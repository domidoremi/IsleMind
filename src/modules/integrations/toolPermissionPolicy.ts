const EVIDENCE_SOURCE_LIMIT = 6
const EVIDENCE_SOURCE_CHAR_LIMIT = 160
const EVIDENCE_SUMMARY_CHAR_LIMIT = 320
const RELIABLE_EVIDENCE_PREFIXES = [
  'source',
  'doc',
  'official-docs',
  'provider-contract',
  'runtime',
  'log',
  'test',
  'benchmark',
  'screenshot',
  'file',
  'rag',
  'web',
  'workflow',
  'workflow-acceptance',
  'prior-observations',
] as const

export type ManifestRiskLevel = 'low' | 'sensitive-read' | 'state-changing' | 'destructive'
export type ManifestOutputBoundary = 'mode-session' | 'agent-trace' | 'external-system' | 'local-state'

export interface ManifestExecutionPolicyInput {
  source: string
  permission: string
  riskLevel?: ManifestRiskLevel
  requiresConfirmation?: boolean
  outputBoundary?: ManifestOutputBoundary
  metadata?: Readonly<Record<string, unknown>>
}

export interface ManifestExecutionPolicy {
  riskLevel: ManifestRiskLevel
  requiresConfirmation: boolean
  outputBoundary: ManifestOutputBoundary
  policyReason: string
}

export type AnnotatedManifest<T extends ManifestExecutionPolicyInput> = Omit<T, 'supportedModes'> & {
  riskLevel: ManifestRiskLevel
  requiresConfirmation: boolean
  outputBoundary: ManifestOutputBoundary
  metadata: Record<string, unknown>
}

export function resolveManifestExecutionPolicy(
  tool: ManifestExecutionPolicyInput,
): ManifestExecutionPolicy {
  const riskLevel = resolveManifestRiskLevel(tool)
  return {
    riskLevel,
    requiresConfirmation: tool.requiresConfirmation ?? inferManifestRequiresConfirmation(tool, riskLevel),
    outputBoundary: tool.outputBoundary ?? inferManifestOutputBoundary(tool, riskLevel),
    policyReason: buildManifestExecutionPolicyReason(tool, riskLevel),
  }
}

export function annotateManifestExecutionPolicy<T extends ManifestExecutionPolicyInput>(
  tool: T,
): AnnotatedManifest<T> {
  const policy = resolveManifestExecutionPolicy(tool)
  const manifest = { ...tool } as T & { supportedModes?: unknown }
  delete manifest.supportedModes
  const metadata = { ...(tool.metadata ?? {}) }
  delete metadata.modePolicyReason
  return {
    ...manifest,
    riskLevel: policy.riskLevel,
    requiresConfirmation: policy.requiresConfirmation,
    outputBoundary: policy.outputBoundary,
    metadata: {
      ...metadata,
      executionPolicyReason: policy.policyReason,
    },
  }
}

export interface ToolPermissionPolicyManifest extends ManifestExecutionPolicyInput {
  id: string
  name: string
  enabled: boolean
  permission: 'read-only' | 'read-write' | 'destructive'
}

export interface ToolPermissionPolicyLimits {
  maxSteps: number
  maxToolCallsPerStep: number
  allowReadOnlyTools: boolean
  allowReadWriteTools: boolean | 'visible'
  allowDestructiveTools: boolean | 'confirm'
}

export const DEFAULT_TOOL_PERMISSION_POLICY_LIMITS: ToolPermissionPolicyLimits = {
  maxSteps: 3,
  maxToolCallsPerStep: 1,
  allowReadOnlyTools: true,
  allowReadWriteTools: 'visible',
  allowDestructiveTools: 'confirm',
}

export function resolveToolPermissionPolicyLimits(
  input: Partial<ToolPermissionPolicyLimits> = {},
): ToolPermissionPolicyLimits {
  return {
    maxSteps: normalizeIntegerLimit(input.maxSteps, DEFAULT_TOOL_PERMISSION_POLICY_LIMITS.maxSteps, 1, 8),
    maxToolCallsPerStep: normalizeIntegerLimit(
      input.maxToolCallsPerStep,
      DEFAULT_TOOL_PERMISSION_POLICY_LIMITS.maxToolCallsPerStep,
      1,
      3,
    ),
    allowReadOnlyTools: typeof input.allowReadOnlyTools === 'boolean'
      ? input.allowReadOnlyTools
      : DEFAULT_TOOL_PERMISSION_POLICY_LIMITS.allowReadOnlyTools,
    allowReadWriteTools: input.allowReadWriteTools === true || input.allowReadWriteTools === false || input.allowReadWriteTools === 'visible'
      ? input.allowReadWriteTools
      : DEFAULT_TOOL_PERMISSION_POLICY_LIMITS.allowReadWriteTools,
    allowDestructiveTools: input.allowDestructiveTools === true || input.allowDestructiveTools === false || input.allowDestructiveTools === 'confirm'
      ? input.allowDestructiveTools
      : DEFAULT_TOOL_PERMISSION_POLICY_LIMITS.allowDestructiveTools,
  }
}

export interface ToolPermissionPolicyContext {
  intentVisible?: boolean
  userConfirmed?: boolean
  evidenceSources?: readonly string[]
  evidenceSummary?: string
  stepIndex?: number
  toolCallIndex?: number
}

export interface ToolPermissionEvidence {
  ready: boolean
  reliable: boolean
  sources: string[]
  reliableSources: string[]
  kinds: string[]
  summary?: string
}

export type ToolPermissionPolicyCode =
  | 'tool_unavailable'
  | 'permission_required'
  | 'evidence_insufficient'
  | 'step_limit_reached'
  | 'policy_denied'

export interface ToolPermissionPolicyDecision {
  decision: 'allow' | 'confirm' | 'deny'
  code?: ToolPermissionPolicyCode
  reason: string
  allowReason?: string
  evidence: ToolPermissionEvidence
}

export function decideToolPermission(
  tool: ToolPermissionPolicyManifest,
  context: ToolPermissionPolicyContext,
  limits: ToolPermissionPolicyLimits,
): ToolPermissionPolicyDecision {
  const evidence = resolveToolPermissionEvidence(context)

  if (!tool.enabled) {
    return decision('deny', 'tool_unavailable', `${tool.name} is disabled.`, evidence)
  }

  if ((context.stepIndex ?? 0) >= limits.maxSteps) {
    return decision('deny', 'step_limit_reached', 'The workflow step limit was reached.', evidence)
  }

  if ((context.toolCallIndex ?? 0) >= limits.maxToolCallsPerStep) {
    return decision('deny', 'step_limit_reached', 'The tool call limit for this step was reached.', evidence)
  }

  if (tool.permission === 'read-only') {
    return limits.allowReadOnlyTools
      ? decision('allow', undefined, 'Read-only tool execution is allowed.', evidence, 'read-only-allowed')
      : decision('deny', 'permission_required', 'Read-only tool execution is disabled by policy.', evidence)
  }

  if (tool.permission === 'read-write') {
    if (limits.allowReadWriteTools === false) {
      return decision('deny', 'permission_required', 'Read-write tool execution is disabled by policy.', evidence)
    }
    if (limits.allowReadWriteTools === true) {
      return decision('allow', undefined, 'Read-write tool execution is allowed by the configured permission ceiling.', evidence, context.userConfirmed ? 'user-confirmed' : 'configured-read-write')
    }
    if (limits.allowReadWriteTools === 'visible') {
      if (context.userConfirmed) {
        return decision('allow', undefined, 'Read-write tool execution was explicitly confirmed.', evidence, 'user-confirmed')
      }
      if (!evidence.reliable) {
        return decision('confirm', 'evidence_insufficient', 'Read-write tool execution requires reliable evidence for the planned action.', evidence)
      }
      if (context.intentVisible) {
        return decision('allow', undefined, 'Read-write tool execution is visible and backed by reliable evidence.', evidence, 'evidence-backed-visible-action')
      }
    }
    return decision('confirm', 'permission_required', 'Read-write tool execution requires a visible planned action.', evidence)
  }

  if (limits.allowDestructiveTools === false) {
    return decision('deny', 'permission_required', 'Destructive tool execution is disabled by policy.', evidence)
  }
  if (limits.allowDestructiveTools === true) {
    return evidence.reliable
      ? decision('allow', undefined, 'Destructive tool execution is allowed by the configured evidence-backed permission ceiling.', evidence, 'evidence-backed-configured-destructive')
      : decision('confirm', 'evidence_insufficient', 'Destructive tool execution requires reliable evidence under the configured permission ceiling.', evidence)
  }
  if (!context.userConfirmed) {
    return decision('confirm', 'permission_required', 'Destructive tool execution requires explicit confirmation.', evidence)
  }
  return decision(
    'allow',
    undefined,
    'Destructive tool execution was explicitly confirmed.',
    evidence,
    'user-confirmed',
  )
}

export function resolveToolPermissionEvidence(context: ToolPermissionPolicyContext): ToolPermissionEvidence {
  const sources = normalizeEvidenceSources(context.evidenceSources)
  const reliableSources = sources.filter(isReliableEvidenceSource)
  return {
    ready: reliableSources.length > 0,
    reliable: reliableSources.length > 0,
    sources,
    reliableSources,
    kinds: normalizeEvidenceKinds(sources),
    summary: normalizeEvidenceSummary(context.evidenceSummary),
  }
}

function normalizeEvidenceSources(sources: unknown): string[] {
  if (!Array.isArray(sources)) return []
  const normalized: string[] = []
  for (const source of sources) {
    if (typeof source !== 'string') continue
    const value = source.trim().replace(/\s+/g, ' ')
    if (!value) continue
    normalized.push(value.length > EVIDENCE_SOURCE_CHAR_LIMIT
      ? `${value.slice(0, EVIDENCE_SOURCE_CHAR_LIMIT - 1)}…`
      : value)
    if (normalized.length >= EVIDENCE_SOURCE_LIMIT) break
  }
  return [...new Set(normalized)]
}

function normalizeEvidenceSummary(summary: unknown): string | undefined {
  if (typeof summary !== 'string') return undefined
  const value = summary.trim().replace(/\s+/g, ' ')
  if (!value) return undefined
  return value.length > EVIDENCE_SUMMARY_CHAR_LIMIT
    ? `${value.slice(0, EVIDENCE_SUMMARY_CHAR_LIMIT - 1)}…`
    : value
}

function isReliableEvidenceSource(source: string): boolean {
  const prefix = source.split(':', 1)[0]?.trim().toLowerCase()
  return RELIABLE_EVIDENCE_PREFIXES.includes(prefix as typeof RELIABLE_EVIDENCE_PREFIXES[number])
}

function normalizeEvidenceKinds(sources: string[]): string[] {
  return [...new Set(sources
    .map((source) => source.split(':', 1)[0]?.trim().toLowerCase())
    .filter((kind): kind is string => Boolean(kind))
    .slice(0, EVIDENCE_SOURCE_LIMIT))]
}

function decision(
  result: ToolPermissionPolicyDecision['decision'],
  code: ToolPermissionPolicyCode | undefined,
  reason: string,
  evidence: ToolPermissionEvidence,
  allowReason?: string,
): ToolPermissionPolicyDecision {
  return { decision: result, code, reason, allowReason, evidence }
}

function normalizeIntegerLimit(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const integer = Math.trunc(value)
  if (integer < min) return fallback
  return Math.min(max, integer)
}

function resolveManifestRiskLevel(tool: ManifestExecutionPolicyInput): ManifestRiskLevel {
  if (tool.riskLevel) return tool.riskLevel
  if (tool.permission === 'destructive') return 'destructive'
  if (tool.permission === 'read-write') return 'state-changing'
  if (tool.source === 'android') return 'sensitive-read'
  return 'low'
}

function inferManifestRequiresConfirmation(
  tool: ManifestExecutionPolicyInput,
  riskLevel: ManifestRiskLevel,
): boolean {
  if (riskLevel === 'destructive' || riskLevel === 'state-changing') return true
  return Boolean(tool.metadata?.requiresExternalConfirmation || tool.metadata?.requiresVisibleUserAction)
}

function inferManifestOutputBoundary(
  tool: ManifestExecutionPolicyInput,
  riskLevel: ManifestRiskLevel,
): ManifestOutputBoundary {
  if (tool.source === 'work-artifact') return 'agent-trace'
  if (tool.source === 'android' || tool.metadata?.requiresExternalConfirmation) return 'external-system'
  if (riskLevel === 'state-changing' || riskLevel === 'destructive') return 'local-state'
  return 'mode-session'
}

function buildManifestExecutionPolicyReason(
  tool: ManifestExecutionPolicyInput,
  riskLevel: ManifestRiskLevel,
): string {
  if (tool.source === 'android') {
    return 'Android device tool defaults reflect access to device state or user-selected storage.'
  }
  if (tool.source === 'work-artifact') {
    return 'Work artifact tool defaults preserve trace-compatible execution deliverables.'
  }
  if (riskLevel === 'low') {
    return 'Low-risk tool execution uses the current execution-session boundary by default.'
  }
  if (riskLevel === 'sensitive-read') {
    return 'Sensitive-read tool execution preserves declared confirmation and output-boundary safeguards.'
  }
  return 'State-changing and destructive tool execution preserves explicit confirmation and output-boundary safeguards.'
}
