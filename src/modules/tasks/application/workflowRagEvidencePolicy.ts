import type { WorkflowContinuationMetadata } from './workflowContinuationPolicy'
import type {
  WorkflowFailureTraceMetadata,
  WorkflowObservedStep,
  WorkflowStepAttribution,
  WorkflowStepObservationProjection,
} from './workflowObservationPolicy'

const RAG_EVIDENCE_MIN_CONFIDENCE = 0.5
const RAG_EVIDENCE_TEXT_LIMIT = 900

export interface WorkflowRagEvidenceStep extends WorkflowObservedStep {
  observation?: WorkflowStepObservationProjection & {
    output: string
  }
}

export interface WorkflowRagEvidenceRun {
  id: string
  goal: string
  intent?: string
  steps: readonly WorkflowRagEvidenceStep[]
}

interface WorkflowRagEvidenceQualityIssue {
  sourceCount?: unknown
  citationCount?: unknown
  confidence?: unknown
  missingEvidence?: unknown
  profile?: unknown
  profileSource?: unknown
  profileReason?: unknown
  warnings?: unknown
  reasons: string[]
  rawOutput?: string
  stepAttribution?: WorkflowStepAttribution
}

export interface WorkflowRagEvidencePendingAction extends WorkflowContinuationMetadata, WorkflowStepAttribution {
  id: string
  reason: 'evidence_insufficient'
  title: 'RAG evidence repair required'
  summary: string
  toolName: 'rag.context_pack'
  toolId: 'rag:context_pack'
  source: 'rag'
  permission: 'read-only'
  confirmable: false
  blockedReason: string
  repairStrategy: string
  suggestedUserPrompt?: string
  createdAt: number
}

export interface WorkflowRagEvidencePauseResult {
  status: 'waiting'
  failureCode: 'evidence_insufficient'
  finalOutput: string
  pendingAction: WorkflowRagEvidencePendingAction
  failureMetadata: WorkflowFailureTraceMetadata
  transitionReason: 'evidence-insufficient'
}

export interface ResolveWorkflowRagEvidencePauseInput {
  run: WorkflowRagEvidenceRun
  rawOutput: string
  outputCharLimit?: number
  workflowMetadata?: WorkflowContinuationMetadata
}

export interface WorkflowRagEvidencePolicyDependencies {
  clock: {
    now(): number
  }
  redactText(value: string): string
  clampText(value: string, limit: number): string
  projectStepAttribution(step: WorkflowObservedStep): WorkflowStepAttribution
  appendPendingActionPromptContext(
    prompt: string | undefined,
    stepAttribution: WorkflowStepAttribution,
    workflowMetadata?: WorkflowContinuationMetadata,
  ): string | undefined
}

export interface WorkflowRagEvidencePolicy {
  resolvePause(input: ResolveWorkflowRagEvidencePauseInput): WorkflowRagEvidencePauseResult | undefined
}

export function createWorkflowRagEvidencePolicy(dependencies: WorkflowRagEvidencePolicyDependencies): WorkflowRagEvidencePolicy {
  return {
    resolvePause(input) {
      const issue = findRagEvidenceQualityIssue(input.run, dependencies.projectStepAttribution)
      if (!issue) return undefined

      const pendingAction = buildRagEvidencePendingAction(
        input.run.id,
        input.run.goal,
        issue,
        input.workflowMetadata,
        dependencies,
      )
      return {
        status: 'waiting',
        failureCode: 'evidence_insufficient',
        finalOutput: formatRagEvidenceRepairOutput(
          pendingAction,
          issue,
          input.rawOutput,
          input.outputCharLimit,
          dependencies,
        ),
        pendingAction,
        failureMetadata: {
          ...(issue.stepAttribution ?? {}),
          repairNextStep: pendingAction.blockedReason,
        },
        transitionReason: 'evidence-insufficient',
      }
    },
  }
}

function findRagEvidenceQualityIssue(
  run: WorkflowRagEvidenceRun,
  projectStepAttribution: WorkflowRagEvidencePolicyDependencies['projectStepAttribution'],
): WorkflowRagEvidenceQualityIssue | undefined {
  if (run.intent !== 'rag_evidence') return undefined
  const ragStep = run.steps.find(isRagEvidenceStep)
  if (!ragStep) return undefined

  const outputMetrics = parseRagEvidenceQualityMetrics(ragStep.observation?.output)
  const traceMetadata = ragStep.observation?.diagnostic.metadata ?? {}
  const issue: WorkflowRagEvidenceQualityIssue = {
    sourceCount: outputMetrics.sourceCount ?? traceMetadata.sourceCount,
    citationCount: outputMetrics.citationCount ?? traceMetadata.citationCount,
    confidence: outputMetrics.confidence ?? traceMetadata.confidence,
    missingEvidence: outputMetrics.missingEvidence ?? traceMetadata.missingEvidence,
    profile: outputMetrics.profile ?? traceMetadata.profile,
    profileSource: outputMetrics.profileSource ?? traceMetadata.profileSource,
    profileReason: outputMetrics.profileReason ?? traceMetadata.profileReason,
    warnings: outputMetrics.warnings ?? traceMetadata.warnings,
    reasons: [],
    rawOutput: ragStep.observation?.output,
    stepAttribution: projectStepAttribution(ragStep),
  }

  if (!isNonNegativeInteger(issue.sourceCount)) {
    issue.reasons.push('sourceCount missing')
  } else if (issue.sourceCount < 1) {
    issue.reasons.push('no sources')
  }
  if (!isNonNegativeInteger(issue.citationCount)) {
    issue.reasons.push('citationCount missing')
  } else if (issue.citationCount < 1) {
    issue.reasons.push('no citations')
  }
  if (!isUnitConfidence(issue.confidence)) {
    issue.reasons.push('confidence missing')
  } else if (issue.confidence < RAG_EVIDENCE_MIN_CONFIDENCE) {
    issue.reasons.push('low confidence')
  }
  if (issue.missingEvidence !== false) {
    issue.reasons.push('missing evidence')
  }

  return issue.reasons.length ? issue : undefined
}

function isRagEvidenceStep(step: WorkflowRagEvidenceStep): boolean {
  return (
    step.toolRequest?.toolId === 'rag:context_pack' ||
    step.toolRequest?.name === 'rag.context_pack' ||
    step.observation?.diagnostic.metadata?.source === 'rag'
  )
}

function buildRagEvidencePendingAction(
  runId: string,
  goal: string,
  issue: WorkflowRagEvidenceQualityIssue,
  workflowMetadata: WorkflowContinuationMetadata | undefined,
  dependencies: WorkflowRagEvidencePolicyDependencies,
): WorkflowRagEvidencePendingAction {
  const repairStrategy = buildRagEvidenceRepairStrategy(issue)
  const summary = [
    `Goal: ${goal}`,
    `Evidence issue: ${issue.reasons.join(', ')}`,
    `Sources: ${formatMetric(issue.sourceCount)}`,
    `Citations: ${formatMetric(issue.citationCount)}`,
    `Confidence: ${formatMetric(issue.confidence)}`,
    `Missing evidence: ${formatMetric(issue.missingEvidence)}`,
    `RAG profile: ${formatMetric(issue.profile)}`,
    `RAG profile source: ${formatMetric(issue.profileSource)}`,
    `RAG profile reason: ${formatMetric(issue.profileReason)}`,
    `Repair guidance: ${ragEvidenceRepairGuidance(issue)}`,
    formatWarnings(issue.warnings),
  ]
    .filter(Boolean)
    .join('\n')
  const projectedWorkflowMetadata = sanitizeWorkflowMetadata(workflowMetadata, dependencies)
  return {
    id: `agent-pending-rag-evidence-${stableHash(`${runId}:${summary}`)}`,
    reason: 'evidence_insufficient',
    title: 'RAG evidence repair required',
    summary: dependencies.clampText(dependencies.redactText(summary), RAG_EVIDENCE_TEXT_LIMIT),
    toolName: 'rag.context_pack',
    toolId: 'rag:context_pack',
    source: 'rag',
    permission: 'read-only',
    confirmable: false,
    blockedReason: ragEvidenceRepairBlockedReason(issue),
    repairStrategy,
    suggestedUserPrompt: dependencies.appendPendingActionPromptContext(
      buildRagEvidenceSuggestedPrompt(goal, issue, dependencies),
      issue.stepAttribution ?? {},
      projectedWorkflowMetadata,
    ),
    ...projectedWorkflowMetadata,
    ...issue.stepAttribution,
    createdAt: dependencies.clock.now(),
  }
}

function buildRagEvidenceSuggestedPrompt(
  goal: string,
  issue: WorkflowRagEvidenceQualityIssue,
  dependencies: Pick<WorkflowRagEvidencePolicyDependencies, 'redactText' | 'clampText'>,
): string {
  return dependencies.clampText(
    dependencies.redactText(
      [
        'Repair the paused RAG evidence workflow.',
        `Original goal: ${goal}`,
        `Evidence issue: ${issue.reasons.join(', ') || 'insufficient evidence'}.`,
        `Current sources: ${formatMetric(issue.sourceCount)}.`,
        `Current citations: ${formatMetric(issue.citationCount)}.`,
        `Current confidence: ${formatMetric(issue.confidence)}.`,
        `Current RAG profile: ${formatMetric(issue.profile)} (${formatMetric(issue.profileSource)}).`,
        `Profile reason: ${formatMetric(issue.profileReason)}.`,
        ragEvidenceRepairGuidance(issue),
        'Produce citation-backed evidence and stop with visible trace if evidence remains insufficient.',
      ].join('\n'),
    ),
    RAG_EVIDENCE_TEXT_LIMIT,
  )
}

function formatRagEvidenceRepairOutput(
  pendingAction: WorkflowRagEvidencePendingAction,
  issue: WorkflowRagEvidenceQualityIssue,
  rawOutput: string,
  outputCharLimit: number | undefined,
  dependencies: Pick<WorkflowRagEvidencePolicyDependencies, 'redactText' | 'clampText'>,
): string {
  const output = dependencies.redactText([
    'Agentic workflow paused for evidence repair.',
    'Reason: evidence_insufficient',
    `Evidence issue: ${issue.reasons.join(', ')}`,
    `Sources: ${formatMetric(issue.sourceCount)}`,
    `Citations: ${formatMetric(issue.citationCount)}`,
    `Confidence: ${formatMetric(issue.confidence)}`,
    `Missing evidence: ${formatMetric(issue.missingEvidence)}`,
    `RAG profile: ${formatMetric(issue.profile)}`,
    `RAG profile source: ${formatMetric(issue.profileSource)}`,
    `RAG profile reason: ${formatMetric(issue.profileReason)}`,
    `Repair guidance: ${ragEvidenceRepairGuidance(issue)}`,
    formatWarnings(issue.warnings),
    `Continuation unavailable: ${pendingAction.blockedReason}`,
    '',
    pendingAction.summary,
    rawOutput ? ['', 'Raw evidence output:', rawOutput].join('\n') : '',
  ]
    .filter(Boolean)
    .join('\n'))
  const limit =
    typeof outputCharLimit === 'number' && Number.isFinite(outputCharLimit) && outputCharLimit > 0
      ? Math.floor(outputCharLimit)
      : RAG_EVIDENCE_TEXT_LIMIT
  return dependencies.clampText(output, limit)
}

function parseRagEvidenceQualityMetrics(
  output: string | undefined,
): Omit<WorkflowRagEvidenceQualityIssue, 'reasons' | 'rawOutput'> {
  if (!output?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(output)
    if (!isRecord(parsed)) return {}
    return {
      sourceCount: parsed.sourceCount,
      citationCount: parsed.citationCount,
      confidence: parsed.confidence,
      missingEvidence: parsed.missingEvidence,
      profile: parsed.profile,
      profileSource: parsed.profileSource,
      profileReason: parsed.profileReason,
      warnings: parsed.warnings,
    }
  } catch {
    return {}
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isUnitConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function formatMetric(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return 'missing'
}

function formatWarnings(value: unknown): string {
  if (!Array.isArray(value) || !value.length) return ''
  return `Warnings: ${value.map(safeString).join(', ')}`
}

function sanitizeWorkflowMetadata(
  value: WorkflowContinuationMetadata | undefined,
  dependencies: Pick<WorkflowRagEvidencePolicyDependencies, 'redactText' | 'clampText'>,
): WorkflowContinuationMetadata {
  if (!value) return {}
  const workflowId = sanitizeWorkflowText(value.workflowId, dependencies)
  const workflowName = sanitizeWorkflowText(value.workflowName, dependencies)
  const workflowExpectedOutput = sanitizeWorkflowText(value.workflowExpectedOutput, dependencies)
  return {
    ...(workflowId ? { workflowId } : {}),
    ...(workflowName ? { workflowName } : {}),
    ...(workflowExpectedOutput ? { workflowExpectedOutput } : {}),
  }
}

function sanitizeWorkflowText(
  value: string | undefined,
  dependencies: Pick<WorkflowRagEvidencePolicyDependencies, 'redactText' | 'clampText'>,
): string | undefined {
  if (!value?.trim()) return undefined
  return dependencies
    .clampText(dependencies.redactText(value.trim()), 160)
    .replace(/\n\[output truncated\]$/, '')
}

function safeString(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[unavailable]'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ragEvidenceRepairBlockedReason(issue: WorkflowRagEvidenceQualityIssue): string {
  return isRagModeOffIssue(issue)
    ? 'RAG mode is off; enable RAG mode or add cited local evidence before rerunning the evidence workflow.'
    : 'Add stronger sources or widen the RAG profile, then run the evidence workflow again.'
}

function ragEvidenceRepairGuidance(issue: WorkflowRagEvidenceQualityIssue): string {
  if (isRagModeOffIssue(issue)) {
    return 'RAG mode is off; do not override it with a wider profile request. Enable RAG mode or import citation-ready local evidence before retrying.'
  }
  const profile = readTextMetric(issue.profile)
  const target = profile === 'fast' ? 'balanced' : profile === 'balanced' || !profile ? 'deep' : undefined
  return target
    ? `Widen retrieval profile to ${target} for the repair run, then cite the stronger evidence.`
    : 'Keep the deep profile and strengthen retrieval inputs, source coverage, or citations before rerunning.'
}

function buildRagEvidenceRepairStrategy(issue: WorkflowRagEvidenceQualityIssue): string {
  if (isRagModeOffIssue(issue)) return 'enable-rag-or-add-cited-local-evidence'
  const profile = readTextMetric(issue.profile)
  if (profile === 'fast') return 'widen-rag-profile-balanced'
  if (profile === 'balanced' || !profile) return 'widen-rag-profile-deep'
  return 'strengthen-deep-rag-evidence'
}

function isRagModeOffIssue(issue: WorkflowRagEvidenceQualityIssue): boolean {
  return (
    readTextMetric(issue.profile) === 'offline' ||
    readTextMetric(issue.profileSource) === 'rag-mode' ||
    readTextMetric(issue.profileReason) === 'ragMode=off'
  )
}

function readTextMetric(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash | 0)
}
