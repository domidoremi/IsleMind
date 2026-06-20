import type { Message, ProcessTrace } from '@/types'
import { st } from '@/i18n/service'
import { clampAgentOutput, redactSensitiveText } from '@/services/agent/agentTrace'
import { WORK_ARTIFACT_WORKFLOW_CONTRACT } from '@/services/agent/workArtifactWorkflow'

const TRACE_COPY_CONTENT_LIMIT = 2400
const TRACE_DISPLAY_TITLE_LIMIT = 160
const TRACE_DISPLAY_CONTENT_LIMIT = 1200
const TRACE_METADATA_SUMMARY_GROUP_LIMIT = 4
const TRACE_METADATA_WORKFLOW_GROUP_LIMIT = 6
const TRACE_METADATA_OUTPUT_EVIDENCE_GROUP_LIMIT = 6

export interface TraceSummary {
  total: number
  done: number
  errors: number
  skipped: number
  cancelled: number
  running: number
  label: string
}

export function collectMessageTraces(message: Message): ProcessTrace[] {
  return [
    ...(message.retrievalTrace ?? []),
    ...(message.reasoning ?? []),
    ...(message.toolCalls ?? []),
  ]
    .map((trace, index) => ({ trace, index, order: resolveTraceDisplayOrder(trace, index) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.trace)
}

export function collectVisibleProcessTraces(message: Message): ProcessTrace[] {
  return collectMessageTraces(message).filter((trace) => !trace.metadata?.hiddenSignature &&
    (
      Boolean(trace.title || trace.content) ||
      trace.status === 'running' ||
      trace.status === 'pending'
    )
  )
}

function resolveTraceDisplayOrder(trace: ProcessTrace, fallback: number): number {
  const timestamp = trace.completedAt ?? trace.startedAt
  return typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : fallback
}

export function normalizeTraceStatuses(traces: ProcessTrace[], messageStatus: Message['status']): ProcessTrace[] {
  const messageSettled = messageStatus !== 'streaming'
  return traces.map((trace) => {
    if ((trace.status === 'running' || trace.status === 'pending') && trace.completedAt) {
      return { ...trace, status: 'done' as const }
    }
    if (messageSettled && (trace.status === 'running' || trace.status === 'pending')) {
      const nextStatus = trace.content ? 'done' : 'skipped'
      return { ...trace, status: nextStatus }
    }
    return trace
  })
}

export function summarizeTraces(traces: ProcessTrace[], messageStatus: Message['status']): TraceSummary {
  const normalized = normalizeTraceStatuses(traces, messageStatus)
  const done = normalized.filter((trace) => trace.status === 'done').length
  const errors = normalized.filter((trace) => trace.status === 'error').length
  const skipped = normalized.filter((trace) => trace.status === 'skipped').length
  const cancelled = normalized.filter((trace) => trace.status === 'cancelled').length
  const running = normalized.filter((trace) => trace.status === 'running' || trace.status === 'pending').length
  const label = [
    running ? st('trace.summary.running', { count: running }) : '',
    done ? st('trace.summary.done', { count: done }) : '',
    errors ? st('trace.summary.errors', { count: errors }) : '',
    cancelled ? st('trace.summary.cancelled', { count: cancelled }) : '',
    skipped ? st('trace.summary.skipped', { count: skipped }) : '',
  ].filter(Boolean).join(' · ') || st('trace.noProcess')
  return { total: normalized.length, done, errors, skipped, cancelled, running, label }
}

export function getActiveTraceTitle(traces: ProcessTrace[], messageStatus: Message['status']): string {
  const normalized = normalizeTraceStatuses(traces, messageStatus)
  const activeTrace = selectActiveProcessTrace(normalized, messageStatus)
  if (activeTrace) return safeProcessTraceTitle(activeTrace)
  const errorTrace = normalized.find((trace) => trace.status === 'error')
  if (errorTrace) return safeProcessTraceTitle(errorTrace)
  return settledWorkflowActivityLabel(normalized) ?? ''
}

export function getActiveTraceStageLabel(traces: ProcessTrace[], messageStatus: Message['status']): string {
  const activeTrace = selectActiveProcessTrace(traces, messageStatus)
  if (activeTrace) return traceActivityStageLabel(activeTrace)
  return messageStatus === 'streaming' || messageStatus === 'sending' ? st('trace.stage.reasoning') : ''
}

export function selectActiveProcessTrace(traces: ProcessTrace[], messageStatus: Message['status']): ProcessTrace | undefined {
  const normalized = normalizeTraceStatuses(traces, messageStatus)
  const activeTraces = normalized.filter((trace) => trace.status === 'running' || trace.status === 'pending')
  if (!activeTraces.length) return undefined
  return [...activeTraces].reverse().find((trace) => !isGenericModelActivityTrace(trace)) ?? activeTraces[activeTraces.length - 1]
}

export function traceActivityStageLabel(trace: ProcessTrace): string {
  return isGenericModelActivityTrace(trace) || trace.type === 'system'
    ? st('trace.stage.reasoning')
    : traceStageLabel(trace)
}

function isGenericModelActivityTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  return trace.type === 'system' &&
    (
      trace.id.startsWith('model-') ||
      (
        typeof metadata.providerId === 'string' &&
        typeof metadata.model === 'string'
      )
    )
}

function settledWorkflowActivityLabel(traces: ProcessTrace[]): string | undefined {
  for (const trace of [...traces].reverse()) {
    if (trace.metadata?.hiddenSignature) continue
    if (trace.status !== 'done' && trace.status !== 'skipped' && trace.status !== 'cancelled') continue
    if (isSettledWorkflowRecoveryTrace(trace)) {
      const summary = metadataSummary(trace.metadata)
      if (summary) return summary
    }
  }
  return undefined
}

function isSettledWorkflowRecoveryTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  if (isCompletedWorkArtifactFollowUpTrace(trace)) return true
  if (!isWorkflowRecoveryEnvelope(trace)) return false
  return metadata.reason === 'workflow-review-required' ||
    metadata.reason === 'workflow-disabled' ||
    metadata.reason === 'workflow-invalid' ||
    metadata.reason === 'workflow-selection-ambiguous' ||
    (
      trace.status === 'cancelled' ||
      metadata.status === 'cancelled' ||
      metadata.failureCode === 'cancelled' ||
      metadata.errorCode === 'cancelled' ||
      typeof metadata.cancelledContinuationPrompt === 'string'
    ) ||
    metadata.failureCode === 'evidence_insufficient' ||
    typeof metadata.repairNextStep === 'string'
}

function isWorkflowRecoveryEnvelope(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeTrace(trace)
}

function isCompletedWorkArtifactFollowUpTrace(trace: ProcessTrace): boolean {
  const metadata = trace.metadata ?? {}
  return trace.type === 'tool' &&
    trace.status === 'done' &&
    metadata.source === 'work-artifact' &&
    metadata.contract === WORK_ARTIFACT_WORKFLOW_CONTRACT &&
    typeof metadata.followUpPrompt === 'string' &&
    Boolean(metadata.followUpPrompt.trim())
}

export function isAgentIntentTrace(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' && trace.title === 'Agent intent'
}

export function isAgentPlanTrace(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' && trace.title === 'Agent plan'
}

export function isAgentSynthesisTrace(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' && trace.title === 'Agent synthesis'
}

export function isAgentWorkflowCompletionTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeType(trace) && trace.title === 'Agent workflow'
}

export function isAgentWorkflowSkillTrace(trace: ProcessTrace): boolean {
  return isAgentWorkflowEnvelopeType(trace) && trace.title === 'Agent workflow skill'
}

export function isAgentWorkflowEnvelopeTrace(trace: ProcessTrace): boolean {
  return isAgentSynthesisTrace(trace) ||
    isAgentWorkflowCompletionTrace(trace) ||
    isAgentWorkflowSkillTrace(trace)
}

function isAgentWorkflowEnvelopeType(trace: ProcessTrace): boolean {
  return trace.type === 'reasoning' || trace.type === 'system'
}

export function metadataSummary(metadata?: Record<string, unknown>): string {
  if (!metadata) return ''
  const groups = [
    statusMetaSummary(metadata),
    toolMetaSummary(metadata),
    workflowTraceMetaSummary(metadata),
    outputEvidenceTraceMetaSummary(metadata),
    limitMetaSummary(metadata),
  ].filter(Boolean)
  return groups.slice(0, TRACE_METADATA_SUMMARY_GROUP_LIMIT).join(' · ')
}

export function metadataSummaryForTrace(trace: ProcessTrace): string {
  const metadata = trace.metadata
  if (!metadata) return ''
  return metadataSummary(isTrustedWorkflowMetadataTrace(trace) ? metadata : omitWorkflowTraceMetadata(metadata))
}

function isTrustedWorkflowMetadataTrace(trace: ProcessTrace): boolean {
  return isAgentPlanTrace(trace) || isWorkflowRecoveryMetadataTrace(trace)
}

function isWorkflowRecoveryMetadataTrace(trace: ProcessTrace): boolean {
  return isWorkflowRecoveryEnvelope(trace) || isCompletedWorkArtifactFollowUpTrace(trace)
}

function omitWorkflowTraceMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...metadata }
  delete safe.pendingAction
  delete safe.repairNextStep
  delete safe.repairStrategy
  delete safe.failureNextStep
  delete safe.cancelledContinuationPrompt
  delete safe.cancelledAtStepTitle
  delete safe.cancelledAtStepNumber
  delete safe.nextStepTitle
  delete safe.nextStepNumber
  delete safe.remainingStepCount
  delete safe.workflowId
  delete safe.workflowName
  delete safe.workflowExpectedOutput
  delete safe.workflowCount
  delete safe.workflowRagProfileRequirementCount
  delete safe.workflowRagProfileRequirements
  delete safe.workflowAcceptanceChecks
  delete safe.acceptanceCheckCount
  delete safe.workflowPermissionCeiling
  delete safe.workflowRequiredToolCount
  delete safe.workflowRequiredTools
  delete safe.runtimeArgumentBindingCount
  delete safe.runtimeArgumentBindings
  delete safe.failedStepTitle
  delete safe.failedStepNumber
  delete safe.failedPlanStepCount
  delete safe.failedToolName
  delete safe.failedToolId
  delete safe.failedToolSource
  delete safe.failedToolErrorCode
  if (
    safe.reason === 'workflow-review-required' ||
    safe.reason === 'workflow-disabled' ||
    safe.reason === 'workflow-invalid' ||
    safe.reason === 'workflow-selection-ambiguous'
  ) {
    delete safe.reason
  }
  if (
    safe.failureCode === 'evidence_insufficient' ||
    safe.failureCode === 'step_limit_reached' ||
    safe.failureCode === 'cancelled'
  ) {
    delete safe.failureCode
  }
  if (safe.status === 'cancelled') delete safe.status
  return safe
}

function statusMetaSummary(metadata: Record<string, unknown>): string {
  return joinTraceMetaParts([
    workflowStateMetaSummary(metadata),
    pendingActionRepairStrategyMetaSummary(metadata),
    ...cancellationProgressMetaSummary(metadata),
    failedStepMetaSummary(metadata),
    failedToolMetaSummary(metadata),
    stepResultCountsMetaSummary(metadata),
    pendingActionWorkflowMetaSummary(metadata),
    pendingActionStepMetaSummary(metadata),
    currentStepMetaSummary(metadata),
    toolCallProgressMetaSummary(metadata),
    ...androidOperationAuditMetaSummary(metadata),
    ...androidUndoMetaSummary(metadata),
  ])
}

function toolMetaSummary(metadata: Record<string, unknown>): string {
  return joinTraceMetaParts([
    nativeProviderToolMetaSummary(metadata),
    typeof metadata.failureNextStep === 'string' && metadata.failureNextStep.trim()
      ? st('trace.meta.failureNextStep', { value: safeTraceMetadataText(metadata.failureNextStep) })
      : '',
    typeof metadata.repairNextStep === 'string' && metadata.repairNextStep.trim()
      ? st('trace.meta.repairNextStep', { value: safeTraceMetadataText(metadata.repairNextStep) })
      : '',
    typeof metadata.inputSummary === 'string' && metadata.inputSummary.trim()
      ? st('trace.meta.inputSummary', { value: safeTraceMetadataText(metadata.inputSummary) })
      : '',
    permissionMetaSummary(metadata),
    allowReasonMetaSummary(metadata),
    stepTitleMetaSummary(metadata),
  ])
}

function workflowTraceMetaSummary(metadata: Record<string, unknown>): string {
  const suppressDuplicatedWorkflowContext = hasDuplicatedPendingActionWorkflowContext(metadata)
  return joinTraceMetaParts([
    suppressDuplicatedWorkflowContext ? '' : workflowIdentityMetaSummary(metadata),
    requestedOutputMetaSummary(metadata),
    suppressDuplicatedWorkflowContext ? '' : workflowExpectedOutputMetaSummary(metadata),
    ragProfileMetaSummary(metadata),
    workflowRagProfileRequirementsMetaSummary(metadata),
    runtimeArgumentBindingsMetaSummary(metadata),
    workflowAcceptanceChecksMetaSummary(metadata),
    workflowPermissionCeilingMetaSummary(metadata),
    workflowRequiredToolsMetaSummary(metadata),
  ], TRACE_METADATA_WORKFLOW_GROUP_LIMIT)
}

function workflowIdentityMetaSummary(metadata: Record<string, unknown>): string {
  const workflowName = typeof metadata.workflowName === 'string' && metadata.workflowName.trim()
    ? st('trace.meta.workflowName', { value: safeTraceMetadataText(metadata.workflowName, 80) })
    : ''
  const workflowId = typeof metadata.workflowId === 'string' && metadata.workflowId.trim()
    ? st('trace.meta.workflowId', { value: safeTraceMetadataText(metadata.workflowId, 64) })
    : ''
  return joinTraceMetaParts([workflowName, workflowId], 2)
}

function workflowExpectedOutputMetaSummary(metadata: Record<string, unknown>): string {
  return typeof metadata.workflowExpectedOutput === 'string' && metadata.workflowExpectedOutput.trim()
    ? st('trace.meta.workflowOutput', { value: safeTraceMetadataText(metadata.workflowExpectedOutput) })
    : ''
}

function hasDuplicatedPendingActionWorkflowContext(metadata: Record<string, unknown>): boolean {
  const pendingAction = asTraceRecord(metadata.pendingAction)
  if (!pendingAction) return false
  const workflowKeys = ['workflowId', 'workflowName', 'workflowExpectedOutput'] as const
  return workflowKeys.some((key) => hasTraceMetadataText(metadata[key])) &&
    workflowKeys.every((key) => traceMetadataTextMatchesWhenPresent(metadata[key], pendingAction[key]))
}

function hasTraceMetadataText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function traceMetadataTextMatchesWhenPresent(left: unknown, right: unknown): boolean {
  if (!hasTraceMetadataText(left)) return true
  return hasTraceMetadataText(right) && left.trim() === right.trim()
}

function outputEvidenceTraceMetaSummary(metadata: Record<string, unknown>): string {
  return joinTraceMetaParts([
    typeof metadata.qualityAuditOk === 'boolean' ? st(metadata.qualityAuditOk ? 'trace.meta.qualityAuditPassed' : 'trace.meta.qualityAuditFailed') : '',
    typeof metadata.evidenceCount === 'number' ? st('trace.meta.evidence', { count: metadata.evidenceCount }) : '',
    typeof metadata.primaryNextStep === 'string' && metadata.primaryNextStep.trim()
      ? st('trace.meta.primaryNextStep', { value: safeTraceMetadataText(metadata.primaryNextStep) })
      : '',
    typeof metadata.qualitySummary === 'string' && metadata.qualitySummary.trim()
      ? st('trace.meta.qualitySummary', { value: safeTraceMetadataText(metadata.qualitySummary) })
      : '',
    typeof metadata.followUpPrompt === 'string' && metadata.followUpPrompt.trim()
      ? st('trace.meta.followUpPrompt', { value: safeTraceMetadataText(metadata.followUpPrompt) })
      : '',
    workArtifactQualityGapsMetaSummary(metadata),
    workArtifactMissingKindsMetaSummary(metadata),
    typeof metadata.sourceCount === 'number' ? st('trace.meta.sources', { count: metadata.sourceCount }) : '',
    typeof metadata.citationCount === 'number' ? st('trace.meta.citations', { count: metadata.citationCount }) : '',
    typeof metadata.memoryCount === 'number' ? st('trace.meta.memories', { count: metadata.memoryCount }) : '',
    typeof metadata.knowledgeCount === 'number' ? st('trace.meta.knowledge', { count: metadata.knowledgeCount }) : '',
    typeof metadata.confidence === 'number' ? st('trace.meta.confidence', { value: Math.round(metadata.confidence * 100) }) : '',
    contextCompressionMetaSummary(metadata),
    ragEvidenceQualityMetaSummary(metadata),
    typeof metadata.providerCitationCount === 'number' ? st('trace.meta.web', { count: metadata.providerCitationCount }) : '',
  ], TRACE_METADATA_OUTPUT_EVIDENCE_GROUP_LIMIT)
}

function contextCompressionMetaSummary(metadata: Record<string, unknown>): string {
  const strategy = typeof metadata.compressionStrategy === 'string' && metadata.compressionStrategy.trim() && metadata.compressionStrategy !== 'none'
    ? st('trace.meta.contextCompressionStrategy', { value: safeTraceMetadataText(metadata.compressionStrategy, 40) })
    : ''
  const savedTokens = finitePositiveNumber(metadata.compressionEstimatedSavedTokens)
  const savings = savedTokens
    ? st('trace.meta.contextCompressionSavings', { value: formatNumber(Math.round(savedTokens)) })
    : ''
  const ratio = finitePositiveNumber(metadata.compressionRatio)
  const ratioSummary = ratio
    ? st('trace.meta.contextCompressionRatio', { value: Math.round(ratio * 100) })
    : ''
  const schemaVersion = finitePositiveNumber(metadata.compressionSchemaVersion)
  const schema = schemaVersion
    ? st('trace.meta.contextCompressionSchema', { value: Math.round(schemaVersion) })
    : ''
  const sourceCount = finiteNonNegativeNumber(metadata.summarySourceMessageCount)
  const keptCount = finiteNonNegativeNumber(metadata.summaryKeptMessageCount)
  const coverage = sourceCount !== undefined && keptCount !== undefined
    ? st('trace.meta.contextCompressionCoverage', { source: Math.round(sourceCount), kept: Math.round(keptCount) })
    : ''
  return joinTraceMetaParts([
    schema,
    strategy,
    savings,
    ratioSummary,
    coverage,
    contextCompressionSectionsMetaSummary(metadata),
  ], 6)
}

function contextCompressionSectionsMetaSummary(metadata: Record<string, unknown>): string {
  if (Array.isArray(metadata.summarySections)) {
    const sections = metadata.summarySections
      .map((value) => {
        const section = asTraceRecord(value)
        if (!section) return ''
        const rawTitle = typeof section.title === 'string' && section.title.trim()
          ? section.title
          : typeof section.id === 'string' ? section.id : ''
        if (!rawTitle.trim()) return ''
        const itemCount = finiteNonNegativeNumber(section.itemCount)
        return itemCount === undefined
          ? safeTraceMetadataText(rawTitle, 48)
          : `${safeTraceMetadataText(rawTitle, 40)} ${formatNumber(Math.round(itemCount))}`
      })
      .filter(Boolean)
      .slice(0, 4)
    if (sections.length) {
      return st('trace.meta.contextCompressionSections', { value: sections.join(', ') })
    }
  }
  const sectionCount = finitePositiveNumber(metadata.summarySectionCount)
  if (!sectionCount) return ''
  const itemCount = finiteNonNegativeNumber(metadata.summaryItemCount)
  const value = itemCount === undefined
    ? formatNumber(Math.round(sectionCount))
    : `${formatNumber(Math.round(sectionCount))}/${formatNumber(Math.round(itemCount))}`
  return st('trace.meta.contextCompressionSections', { value })
}

function workArtifactQualityGapsMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.qualityGapCodes)) return ''
  const codes = safeTraceStringList(metadata.qualityGapCodes, 3, 56)
  return codes.length
    ? st('trace.meta.qualityGaps', { value: codes.join(', ') })
    : ''
}

function workArtifactMissingKindsMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.missingKinds)) return ''
  const kinds = safeTraceStringList(metadata.missingKinds, 4, 40)
  return kinds.length
    ? st('trace.meta.missingKinds', { value: kinds.join(', ') })
    : ''
}

function limitMetaSummary(metadata: Record<string, unknown>): string {
  return joinTraceMetaParts([
    typeof metadata.stepCount === 'number' ? st('trace.meta.steps', { count: metadata.stepCount }) : '',
    typeof metadata.acceptanceCheckCount === 'number' ? st('trace.meta.acceptanceChecks', { count: metadata.acceptanceCheckCount }) : '',
    typeof metadata.maxStepCount === 'number' ? st('trace.meta.maxSteps', { count: metadata.maxStepCount }) : '',
    typeof metadata.maxToolCallsPerStep === 'number' ? st('trace.meta.maxToolCallsPerStep', { count: metadata.maxToolCallsPerStep }) : '',
    typeof metadata.outputCharLimit === 'number' ? st('trace.meta.outputLimit', { count: metadata.outputCharLimit }) : '',
    typeof metadata.workflowCount === 'number' ? st('trace.meta.workflows', { count: metadata.workflowCount }) : '',
    typeof metadata.count === 'number' ? st('trace.meta.count', { count: metadata.count }) : '',
  ])
}

function joinTraceMetaParts(parts: string[], limit?: number): string {
  const values = parts.filter(Boolean)
  return (limit ? values.slice(0, limit) : values).join(' · ')
}

function requestedOutputMetaSummary(metadata: Record<string, unknown>): string {
  if (typeof metadata.requestedOutput !== 'string') return ''
  const requestedOutput = metadata.requestedOutput.trim()
  if (!requestedOutput || requestedOutput === 'auto') return ''
  return st('trace.meta.requestedOutput', { value: safeTraceMetadataText(requestedOutput) })
}

function ragProfileMetaSummary(metadata: Record<string, unknown>): string {
  const profile = typeof metadata.profile === 'string' && metadata.profile.trim()
    ? st('trace.meta.ragProfile', { value: safeTraceMetadataText(metadata.profile, 40) })
    : ''
  const profileSource = typeof metadata.profileSource === 'string' && metadata.profileSource.trim()
    ? st('trace.meta.ragProfileSource', { value: safeTraceMetadataText(metadata.profileSource, 40) })
    : ''
  const profileReason = typeof metadata.profileReason === 'string' && metadata.profileReason.trim()
    ? st('trace.meta.ragProfileReason', { value: safeTraceMetadataText(metadata.profileReason) })
    : ''
  return [profile, profileSource, profileReason].filter(Boolean).join(' · ')
}

function workflowRagProfileRequirementsMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.workflowRagProfileRequirements)) return ''
  const requirements = metadata.workflowRagProfileRequirements
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => safeTraceMetadataText(value, 96))
    .filter(Boolean)
    .slice(0, 2)
  return requirements.length
    ? st('trace.meta.ragProfileRequirements', { value: requirements.join('; ') })
    : ''
}

function runtimeArgumentBindingsMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.runtimeArgumentBindings)) return ''
  const bindings = metadata.runtimeArgumentBindings
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => safeTraceMetadataText(value, 96))
    .filter(Boolean)
    .slice(0, 3)
  return bindings.length
    ? st('trace.meta.runtimeArgumentBindings', { value: bindings.join('; ') })
    : ''
}

function workflowAcceptanceChecksMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.workflowAcceptanceChecks)) return ''
  const checks = metadata.workflowAcceptanceChecks
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => safeTraceMetadataText(value, 96))
    .filter(Boolean)
    .slice(0, 2)
  return checks.length
    ? st('trace.meta.workflowAcceptanceChecks', { value: checks.join('; ') })
    : ''
}

function workflowPermissionCeilingMetaSummary(metadata: Record<string, unknown>): string {
  return typeof metadata.workflowPermissionCeiling === 'string' && metadata.workflowPermissionCeiling.trim()
    ? st('trace.meta.workflowPermissionCeiling', { value: safeTraceMetadataText(metadata.workflowPermissionCeiling, 40) })
    : ''
}

function workflowRequiredToolsMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.workflowRequiredTools)) return ''
  const tools = metadata.workflowRequiredTools
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => safeTraceMetadataText(value, 96))
    .filter(Boolean)
    .slice(0, 3)
  return tools.length
    ? st('trace.meta.workflowRequiredTools', { value: tools.join(', ') })
    : ''
}

function safeTraceStringList(values: unknown[], maxItems: number, itemLimit: number): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => safeTraceMetadataText(value, itemLimit))
    .filter(Boolean)
    .slice(0, maxItems)
}

function ragEvidenceQualityMetaSummary(metadata: Record<string, unknown>): string {
  const parts = [
    metadata.missingEvidence === true ? st('trace.meta.missingEvidence') : '',
    ragFallbackReasonsMetaSummary(metadata),
  ].filter(Boolean)
  return parts.join(' · ')
}

function ragFallbackReasonsMetaSummary(metadata: Record<string, unknown>): string {
  if (!Array.isArray(metadata.fallbackReasons)) return ''
  const reasons = metadata.fallbackReasons
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => safeTraceMetadataText(value, 72))
    .filter(Boolean)
    .slice(0, 3)
  return reasons.length
    ? st('trace.meta.ragFallbackReasons', { value: reasons.join(', ') })
    : ''
}

export function traceStageLabel(trace: ProcessTrace): string {
  const metadata = trace.metadata ?? {}
  if (isAgentIntentTrace(trace)) return st('trace.stage.intent')
  if (isAgentPlanTrace(trace)) return st('trace.stage.plan')
  if (isAgentSynthesisTrace(trace)) return st('trace.stage.synthesis')
  if (isAgentWorkflowCompletionTrace(trace)) return st('trace.stage.completion')
  if (metadata.toolCallMode === 'native-provider') {
    return isRawProviderNativeToolTrace(metadata)
      ? st('trace.stage.providerToolRequest')
      : st('trace.stage.controlledTool')
  }
  if (metadata.decision || metadata.permission || metadata.code === 'permission_required') {
    return st('trace.stage.permission')
  }
  if (typeof metadata.inputSummary === 'string' && metadata.inputSummary.trim()) {
    return st('trace.stage.toolInput')
  }
  if (trace.type === 'tool') return st('trace.stage.observation')
  if (trace.type === 'retrieval' || trace.type === 'memory' || trace.type === 'knowledge') {
    return st('trace.stage.retrieval')
  }
  if (trace.type === 'search') return st('trace.stage.search')
  if (trace.type === 'system') return st('trace.stage.system')
  return st('trace.stage.reasoning')
}

export function formatProcessTraceForCopy(trace: ProcessTrace): string {
  const details = [
    traceStatusLabel(trace.status),
    trace.durationMs ? formatDuration(trace.durationMs) : '',
    metadataSummaryForTrace(trace),
  ].filter(Boolean).join(' · ')
  const safeDetails = redactSensitiveText(details)
  const header = `${traceStageLabel(trace)} · ${safeProcessTraceTitle(trace)}`
  const content = trace.content?.trim()
  return [
    safeDetails ? `${header} [${safeDetails}]` : header,
    content ? clampAgentOutput(redactSensitiveText(content), TRACE_COPY_CONTENT_LIMIT) : '',
  ].filter(Boolean).join('\n')
}

export function safeProcessTraceTitle(trace: ProcessTrace): string {
  return clampAgentOutput(redactSensitiveText(trace.title), TRACE_DISPLAY_TITLE_LIMIT).replace(/\n\[output truncated\]$/, '')
}

export function safeProcessTraceContent(trace: ProcessTrace, limit = TRACE_DISPLAY_CONTENT_LIMIT): string {
  const content = trace.content?.trim()
  return content ? clampAgentOutput(redactSensitiveText(content), limit) : ''
}

export function formatProcessTraceForDisplay(trace: ProcessTrace, contentLimit = TRACE_DISPLAY_CONTENT_LIMIT): { title: string; content: string } {
  return {
    title: safeProcessTraceTitle(trace),
    content: safeProcessTraceContent(trace, contentLimit),
  }
}

function workflowStateMetaSummary(metadata: Record<string, unknown>): string {
  const pendingAction = metadata.pendingAction
  const pendingReason = pendingAction && typeof pendingAction === 'object'
    ? (pendingAction as Record<string, unknown>).reason
    : undefined
  if (pendingReason === 'evidence_insufficient' || metadata.failureCode === 'evidence_insufficient') {
    return st('trace.meta.evidenceInsufficient')
  }
  if (
    pendingReason === 'step_limit_reached' ||
    metadata.failureCode === 'step_limit_reached' ||
    metadata.errorCode === 'step_limit_reached' ||
    metadata.code === 'step_limit_reached'
  ) {
    return st('trace.meta.stepLimitReached')
  }
  if (
    pendingReason === 'permission_required' ||
    metadata.failureCode === 'permission_required' ||
    metadata.errorCode === 'permission_required' ||
    metadata.code === 'permission_required'
  ) {
    return st('trace.meta.permissionRequired')
  }
  if (
    metadata.status === 'cancelled' ||
    metadata.failureCode === 'cancelled' ||
    metadata.errorCode === 'cancelled' ||
    typeof metadata.cancelledContinuationPrompt === 'string'
  ) {
    return st('trace.meta.cancelled')
  }
  if (metadata.reason === 'workflow-review-required') {
    return st('trace.meta.workflowReviewRequired')
  }
  if (metadata.reason === 'workflow-disabled') {
    return st('trace.meta.workflowDisabled')
  }
  if (metadata.reason === 'workflow-invalid') {
    return st('trace.meta.workflowInvalid')
  }
  if (metadata.reason === 'workflow-selection-ambiguous') {
    return st('trace.meta.workflowSelectionAmbiguous')
  }
  return typeof metadata.failureCode === 'string' && metadata.failureCode.trim()
    ? st('trace.meta.failureCode', { value: safeTraceMetadataText(metadata.failureCode) })
    : ''
}

function currentStepMetaSummary(metadata: Record<string, unknown>): string {
  if (typeof metadata.failedStepTitle === 'string' || typeof metadata.failedStepNumber === 'number') return ''
  return stepProgressMetaSummary(metadata)
}

function pendingActionStepMetaSummary(metadata: Record<string, unknown>): string {
  const pendingAction = metadata.pendingAction
  if (!pendingAction || typeof pendingAction !== 'object') return ''
  const record = pendingAction as Record<string, unknown>
  return stepProgressMetaSummary(record)
}

function pendingActionWorkflowMetaSummary(metadata: Record<string, unknown>): string {
  const pendingAction = metadata.pendingAction
  if (!pendingAction || typeof pendingAction !== 'object') return ''
  const record = pendingAction as Record<string, unknown>
  const workflowName = typeof record.workflowName === 'string' && record.workflowName.trim()
    ? st('trace.meta.workflowName', { value: safeTraceMetadataText(record.workflowName, 80) })
    : ''
  const workflowId = typeof record.workflowId === 'string' && record.workflowId.trim()
    ? st('trace.meta.workflowId', { value: safeTraceMetadataText(record.workflowId, 64) })
    : ''
  const expectedOutput = typeof record.workflowExpectedOutput === 'string' && record.workflowExpectedOutput.trim()
    ? st('trace.meta.workflowOutput', { value: safeTraceMetadataText(record.workflowExpectedOutput, 40) })
    : ''
  return joinTraceMetaParts([workflowName, workflowId, expectedOutput])
}

function pendingActionRepairStrategyMetaSummary(metadata: Record<string, unknown>): string {
  const pendingAction = metadata.pendingAction
  if (!pendingAction || typeof pendingAction !== 'object') return ''
  const repairStrategy = (pendingAction as Record<string, unknown>).repairStrategy
  return typeof repairStrategy === 'string' && repairStrategy.trim()
    ? st('trace.meta.repairStrategy', { value: safeTraceMetadataText(repairStrategy, 80) })
    : ''
}

function stepTitleMetaSummary(metadata: Record<string, unknown>): string {
  if (
    typeof metadata.stepNumber === 'number' ||
    (typeof metadata.stepIndex === 'number' && Number.isInteger(metadata.stepIndex) && metadata.stepIndex >= 0)
  ) {
    return ''
  }
  return typeof metadata.stepTitle === 'string' && metadata.stepTitle.trim()
    ? st('trace.meta.stepTitle', { value: safeTraceMetadataText(metadata.stepTitle, 80) })
    : ''
}

function stepProgressMetaSummary(metadata: Record<string, unknown>): string {
  const stepNumber = typeof metadata.stepNumber === 'number' && Number.isInteger(metadata.stepNumber) && metadata.stepNumber > 0
    ? metadata.stepNumber
    : typeof metadata.stepIndex === 'number' && Number.isInteger(metadata.stepIndex) && metadata.stepIndex >= 0
      ? metadata.stepIndex + 1
      : undefined
  if (!stepNumber) return ''
  const progress = typeof metadata.planStepCount === 'number' && Number.isInteger(metadata.planStepCount) && metadata.planStepCount >= stepNumber
    ? st('trace.meta.currentStep', { current: stepNumber, total: metadata.planStepCount })
    : st('trace.meta.currentStepUnknownTotal', { current: stepNumber })
  const stepTitle = typeof metadata.stepTitle === 'string' && metadata.stepTitle.trim()
    ? st('trace.meta.stepTitle', { value: safeTraceMetadataText(metadata.stepTitle, 80) })
    : ''
  return [progress, stepTitle].filter(Boolean).join(' · ')
}

function toolCallProgressMetaSummary(metadata: Record<string, unknown>): string {
  const toolCallNumber = typeof metadata.toolCallNumber === 'number' && Number.isInteger(metadata.toolCallNumber) && metadata.toolCallNumber > 0
    ? metadata.toolCallNumber
    : typeof metadata.toolCallIndex === 'number' && Number.isInteger(metadata.toolCallIndex) && metadata.toolCallIndex >= 0
      ? metadata.toolCallIndex + 1
      : undefined
  if (!toolCallNumber) return ''
  const maxToolCallsPerStep = typeof metadata.maxToolCallsPerStep === 'number' &&
    Number.isInteger(metadata.maxToolCallsPerStep) &&
    metadata.maxToolCallsPerStep >= 1
    ? metadata.maxToolCallsPerStep
    : undefined
  return maxToolCallsPerStep
    ? st('trace.meta.currentToolCall', { current: toolCallNumber, total: maxToolCallsPerStep })
    : st('trace.meta.currentToolCallUnknownTotal', { current: toolCallNumber })
}

function failedStepMetaSummary(metadata: Record<string, unknown>): string {
  const title = typeof metadata.failedStepTitle === 'string' && metadata.failedStepTitle.trim()
    ? metadata.failedStepTitle
    : ''
  const stepNumber = typeof metadata.failedStepNumber === 'number' && Number.isInteger(metadata.failedStepNumber) && metadata.failedStepNumber > 0
    ? metadata.failedStepNumber
    : undefined
  if (!title && !stepNumber) return ''
  const planStepCount = typeof metadata.failedPlanStepCount === 'number' &&
    Number.isInteger(metadata.failedPlanStepCount) &&
    stepNumber !== undefined &&
    metadata.failedPlanStepCount >= stepNumber
    ? metadata.failedPlanStepCount
    : undefined
  return st('trace.meta.failedStep', { value: failureStepLabel(title, stepNumber, planStepCount) })
}

function failureStepLabel(title: string, stepNumber: number | undefined, planStepCount: number | undefined): string {
  const safeTitle = title ? safeTraceMetadataText(title, 72) : ''
  const progress = stepNumber
    ? planStepCount
      ? `${stepNumber}/${planStepCount}`
      : `${stepNumber}`
    : ''
  if (progress && safeTitle) return safeTraceMetadataText(`${progress}. ${safeTitle}`, 88)
  return safeTitle || progress
}

function failedToolMetaSummary(metadata: Record<string, unknown>): string {
  const name = typeof metadata.failedToolName === 'string' && metadata.failedToolName.trim()
    ? metadata.failedToolName
    : ''
  const id = typeof metadata.failedToolId === 'string' && metadata.failedToolId.trim()
    ? metadata.failedToolId
    : ''
  const source = typeof metadata.failedToolSource === 'string' && metadata.failedToolSource.trim()
    ? metadata.failedToolSource
    : ''
  const errorCode = typeof metadata.failedToolErrorCode === 'string' && metadata.failedToolErrorCode.trim()
    ? metadata.failedToolErrorCode
    : ''
  if (!name && !id && !source && !errorCode) return ''
  return st('trace.meta.failedTool', { value: failureToolLabel(name, id, source, errorCode) })
}

function failureToolLabel(name: string, id: string, source: string, errorCode: string): string {
  const safeName = name ? safeTraceMetadataText(name, 56) : ''
  const safeId = id && id !== name ? safeTraceMetadataText(id, 56) : ''
  const primary = safeName && safeId
    ? `${safeName} (${safeId})`
    : safeName || safeId
  return [
    primary ? safeTraceMetadataText(primary, 96) : '',
    source ? safeTraceMetadataText(source, 32) : '',
    errorCode ? safeTraceMetadataText(errorCode, 48) : '',
  ].filter(Boolean).join(' · ')
}

function stepResultCountsMetaSummary(metadata: Record<string, unknown>): string {
  const parts = [
    typeof metadata.pendingStepCount === 'number' && metadata.pendingStepCount > 0 ? st('trace.meta.pendingSteps', { count: metadata.pendingStepCount }) : '',
    typeof metadata.runningStepCount === 'number' && metadata.runningStepCount > 0 ? st('trace.meta.runningSteps', { count: metadata.runningStepCount }) : '',
    typeof metadata.doneStepCount === 'number' && metadata.doneStepCount > 0 ? st('trace.meta.doneSteps', { count: metadata.doneStepCount }) : '',
    typeof metadata.errorStepCount === 'number' && metadata.errorStepCount > 0 ? st('trace.meta.errorSteps', { count: metadata.errorStepCount }) : '',
    typeof metadata.cancelledStepCount === 'number' && metadata.cancelledStepCount > 0 ? st('trace.meta.cancelledSteps', { count: metadata.cancelledStepCount }) : '',
    typeof metadata.skippedStepCount === 'number' && metadata.skippedStepCount > 0 ? st('trace.meta.skippedSteps', { count: metadata.skippedStepCount }) : '',
  ].filter(Boolean)
  return parts.length ? st('trace.meta.stepResults', { value: parts.join(', ') }) : ''
}

function cancellationProgressMetaSummary(metadata: Record<string, unknown>): string[] {
  const cancelled =
    metadata.status === 'cancelled' ||
    metadata.failureCode === 'cancelled' ||
    metadata.errorCode === 'cancelled' ||
    typeof metadata.cancelledContinuationPrompt === 'string'
  const parts: string[] = []
  if (cancelled && typeof metadata.cancelledContinuationPrompt === 'string' && metadata.cancelledContinuationPrompt.trim()) {
    parts.push(st('trace.meta.cancelledContinuation', {
      value: safeTraceMetadataText(metadata.cancelledContinuationPrompt),
    }))
  }
  if (
    cancelled &&
    typeof metadata.completedStepCount === 'number' &&
    typeof metadata.planStepCount === 'number'
  ) {
    parts.push(st('trace.meta.cancelledProgress', {
      completed: metadata.completedStepCount,
      total: metadata.planStepCount,
    }))
  }
  if (cancelled && typeof metadata.remainingStepCount === 'number') {
    parts.push(st('trace.meta.remainingSteps', { count: metadata.remainingStepCount }))
  }
  if (cancelled && typeof metadata.cancelledAtStepTitle === 'string' && metadata.cancelledAtStepTitle.trim()) {
    parts.push(st('trace.meta.cancelledAtStep', {
      value: cancellationStepLabel(metadata.cancelledAtStepTitle, metadata.cancelledAtStepNumber),
    }))
  }
  if (cancelled && typeof metadata.nextStepTitle === 'string' && metadata.nextStepTitle.trim()) {
    parts.push(st('trace.meta.nextStep', {
      value: cancellationStepLabel(metadata.nextStepTitle, metadata.nextStepNumber),
    }))
  }
  return parts
}

function cancellationStepLabel(title: string, stepNumber: unknown): string {
  const safeTitle = safeTraceMetadataText(title, 72)
  return typeof stepNumber === 'number' && Number.isInteger(stepNumber) && stepNumber > 0
    ? safeTraceMetadataText(`${stepNumber}. ${safeTitle}`, 88)
    : safeTitle
}

function permissionMetaSummary(metadata: Record<string, unknown>): string {
  return typeof metadata.permission === 'string' && metadata.permission.trim()
    ? st('trace.meta.permission', { value: safeTraceMetadataText(metadata.permission) })
    : ''
}

function nativeProviderToolMetaSummary(metadata: Record<string, unknown>): string {
  if (metadata.toolCallMode !== 'native-provider') return ''
  const toolName = typeof metadata.toolName === 'string' && metadata.toolName.trim()
    ? safeTraceMetadataText(metadata.toolName, 72)
    : ''
  const providerToolName = typeof metadata.providerToolName === 'string' && metadata.providerToolName.trim()
    ? safeTraceMetadataText(metadata.providerToolName, 72)
    : ''
  const value = toolName || providerToolName || st('trace.meta.providerNativeToolFallback')
  return isRawProviderNativeToolTrace(metadata)
    ? st('trace.meta.providerNativeToolRequested', { value })
    : st('trace.meta.providerNativeToolControlled', { value })
}

function isRawProviderNativeToolTrace(metadata: Record<string, unknown>): boolean {
  return metadata.toolCallMode === 'native-provider' &&
    (metadata.toolCallSource === 'provider' || metadata.source === 'provider') &&
    typeof metadata.permission !== 'string'
}

function allowReasonMetaSummary(metadata: Record<string, unknown>): string {
  if (metadata.allowReason === 'visible-action' && metadata.intentVisible === true) {
    return st('trace.meta.allowVisibleAction')
  }
  if (metadata.allowReason === 'user-confirmed' && metadata.userConfirmed === true) {
    return st('trace.meta.allowUserConfirmed')
  }
  if (metadata.allowReason === 'policy-allow-read-write') {
    return st('trace.meta.allowPolicyReadWrite')
  }
  if (metadata.allowReason === 'policy-allow-destructive') {
    return st('trace.meta.allowPolicyDestructive')
  }
  if (metadata.allowReason === 'read-only-allowed') {
    return st('trace.meta.allowReadOnly')
  }
  return typeof metadata.allowReason === 'string' && metadata.allowReason.trim()
    ? st('trace.meta.allowReason', { value: safeTraceMetadataText(metadata.allowReason) })
    : ''
}

function safeTraceMetadataText(value: string, limit = 80): string {
  return clampAgentOutput(redactSensitiveText(value.trim()), limit)
}

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function finiteNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function androidOperationAuditMetaSummary(metadata: Record<string, unknown>): string[] {
  const audit = asTraceRecord(metadata.androidOperationAudit)
  if (!audit) return []
  const operationKind = safeTraceText(audit.operationKind, 'android-tool')
  const scope = safeTraceText(audit.scope, 'android-runtime')
  const confirmationState = safeTraceText(audit.confirmationState, 'not-recorded')
  const parts = [
    st('trace.meta.androidAuditSummary', { operationKind, scope, confirmationState }),
  ]
  const failureParts = [
    audit.partialFailure === true ? st('trace.meta.androidAuditPartialFailure') : '',
    typeof audit.failedOperationId === 'string' && audit.failedOperationId.trim()
      ? st('trace.meta.androidAuditFailedOperation', { value: safeTraceText(audit.failedOperationId, 'unknown') })
      : '',
  ].filter(Boolean)
  if (failureParts.length) {
    parts.push(failureParts.join(', '))
  }
  const countParts = [
    auditCountPart(audit.operationCount, 'trace.meta.androidAuditOperationCount'),
    auditCountPart(audit.appliedCount, 'trace.meta.androidAuditAppliedCount'),
    auditCountPart(audit.skippedCount, 'trace.meta.androidAuditSkippedCount'),
    auditCountPart(audit.deletedEntryCount, 'trace.meta.androidAuditDeletedEntryCount'),
    auditCountPart(audit.undoOperationCount, 'trace.meta.androidAuditUndoOperationCount'),
    auditCountPart(audit.failureCount, 'trace.meta.androidAuditFailureCount'),
  ].filter(Boolean)
  if (countParts.length) {
    parts.push(st('trace.meta.androidAuditCounts', { value: countParts.join(', ') }))
  }
  const boundaryParts = [
    audit.deleteSupported === false ? st('trace.meta.androidAuditNoDelete') : '',
    audit.permanentDeleteSupported === false ? st('trace.meta.androidAuditNoPermanentDelete') : '',
    audit.silentInstallSupported === false ? st('trace.meta.androidAuditNoSilentInstall') : '',
    audit.fullPhoneCleanerSupported === false ? st('trace.meta.androidAuditNoFullPhoneCleaner') : '',
    audit.userFilesDeleted === false ? st('trace.meta.androidAuditNoUserFilesDeleted') : '',
    audit.undoAvailable === true ? st('trace.meta.androidAuditUndoAvailable') : '',
    audit.externalConfirmationRequired === true ? st('trace.meta.androidAuditExternalConfirmation') : '',
    audit.visibleActionRequired === true ? st('trace.meta.androidAuditVisibleAction') : '',
  ].filter(Boolean)
  if (boundaryParts.length) {
    parts.push(st('trace.meta.androidAuditBoundaries', { value: boundaryParts.slice(0, 4).join(', ') }))
  }
  return parts
}

function androidUndoMetaSummary(metadata: Record<string, unknown>): string[] {
  if (typeof metadata.androidUndoOperationCount !== 'number') return []
  const parts = [
    st('trace.meta.androidUndoAvailable', { count: metadata.androidUndoOperationCount }),
  ]
  if (metadata.androidUndoRequiresVisibleConfirmation === true) {
    parts.push(st('trace.meta.androidUndoVisibleConfirmation'))
  }
  if (typeof metadata.androidUndoToolName === 'string' && metadata.androidUndoToolName.trim()) {
    parts.push(st('trace.meta.androidUndoTool', { value: safeTraceText(metadata.androidUndoToolName, 'android.files.undo_operations') }))
  }
  return parts
}

function asTraceRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function safeTraceText(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  return clampAgentOutput(redactSensitiveText(value), 64)
}

function auditCountPart(value: unknown, key: string): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? st(key, { count: value })
    : ''
}

export function traceStatusLabel(status: ProcessTrace['status']): string {
  switch (status) {
    case 'pending':
      return st('trace.status.pending')
    case 'running':
      return st('trace.status.running')
    case 'done':
      return st('trace.status.done')
    case 'error':
      return st('trace.status.error')
    case 'skipped':
      return st('trace.status.skipped')
    case 'cancelled':
      return st('trace.status.cancelled')
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`
  return `${Math.round(ms / 60000)}m`
}

export function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}
