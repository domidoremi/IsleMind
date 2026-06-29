import {
  getRuntimeEventHistory,
  type RuntimeControlPlaneEvent,
  type RuntimeEventEnvelope,
} from '@/services/runtimeEvents'

export const RUNTIME_TIMELINE_SCHEMA = 'islemind.runtime-timeline.v1'
export const RUNTIME_TIMELINE_DEFAULT_LIMIT = 40
export const RUNTIME_TIMELINE_MAX_LIMIT = 80

export type RuntimeTimelineStage = 'context' | 'provider' | 'tool' | 'session' | 'compact' | 'plugin' | 'token' | 'other'
export type RuntimeTimelineStatus = 'done' | 'blocked' | 'error' | 'skipped' | 'running' | 'info'
export type RuntimeTimelineIssueSeverity = 'critical' | 'warning' | 'info'
export type RuntimeTimelineIssueCode =
  | 'provider_blocked'
  | 'provider_error'
  | 'tool_blocked'
  | 'context_unbounded_blocked'
  | 'context_manifest_budget_overrun'
  | 'context_manifest_source_churn'
  | 'session_failover'
  | 'compact_skipped'
  | 'plugin_manifest_invalid'
  | 'plugin_hook_executable'
  | 'mcp_transport_unsupported'
  | 'mcp_manifest_invalid'
  | 'mcp_permission_required'
  | 'agent_prompt_injection_blocked'
  | 'agent_tool_replay_blocked'
  | 'agent_workflow_tampering_blocked'
  | 'agent_security_eval_failed'
export type RuntimeTimelineNextActionCode =
  | 'check_provider_credentials'
  | 'review_provider_policy'
  | 'retry_or_switch_provider'
  | 'fix_tool_schema'
  | 'cap_context_source'
  | 'stabilize_context_sources'
  | 'review_session_affinity'
  | 'enable_compact_or_reduce_history'
  | 'review_plugin_manifest'
  | 'review_mcp_transport'
  | 'review_mcp_manifest'
  | 'confirm_mcp_tool_permission'
  | 'review_agent_security_policy'
  | 'review_agent_workflow'
export type RuntimeTimelineActionTargetKind =
  | 'provider-settings'
  | 'tool-settings'
  | 'context-settings'
  | 'session-affinity-settings'
  | 'compact-settings'
  | 'plugin-settings'
  | 'agent-settings'
  | 'retry-chat'

export interface RuntimeTimelineActionTarget {
  kind: RuntimeTimelineActionTargetKind
  reason: RuntimeTimelineNextActionCode
  event: RuntimeControlPlaneEvent
  conversationId?: string
  providerId?: string
  credentialGroupId?: string
  model?: string
}
export type RuntimeTimelineRepairPlanStatus = 'clear' | 'ready'

export interface RuntimeTimelineRepairTask {
  id: string
  severity: RuntimeTimelineIssueSeverity
  action: RuntimeTimelineNextActionCode
  target: RuntimeTimelineActionTarget
  issueCodes: RuntimeTimelineIssueCode[]
  sourceEventIds: string[]
  latestEventId?: string
  issueCount: number
  eventCount: number
  firstTs: string
  lastTs: string
  summary: string
}

export interface RuntimeTimelineRepairPlan {
  status: RuntimeTimelineRepairPlanStatus
  taskCount: number
  bySeverity: Record<RuntimeTimelineIssueSeverity, number>
  tasks: RuntimeTimelineRepairTask[]
}

export interface RuntimeTimelineFilters {
  conversationId?: string
  providerId?: string
  credentialGroupId?: string
  model?: string
  stage?: RuntimeTimelineStage
  status?: RuntimeTimelineStatus
}

export interface RuntimeTimelineOptions extends RuntimeTimelineFilters {
  limit?: number
  newestFirst?: boolean
}

export interface RuntimeTimelineEntry {
  id: string
  ts: string
  event: RuntimeControlPlaneEvent
  stage: RuntimeTimelineStage
  status: RuntimeTimelineStatus
  conversationId?: string
  providerId?: string
  credentialGroupId?: string
  model?: string
  summary: string
  data: Record<string, unknown>
}

export interface RuntimeTimelineCounts {
  total: number
  byStage: Record<RuntimeTimelineStage, number>
  byStatus: Record<RuntimeTimelineStatus, number>
}

export interface RuntimeTimelineIssue {
  code: RuntimeTimelineIssueCode
  severity: RuntimeTimelineIssueSeverity
  count: number
  firstTs: string
  lastTs: string
  stage: RuntimeTimelineStage
  status: RuntimeTimelineStatus
  providerId?: string
  credentialGroupId?: string
  model?: string
  event: RuntimeControlPlaneEvent
  sourceEventIds: string[]
  latestEventId: string
  summary: string
  nextAction: RuntimeTimelineNextActionCode
  actionTarget: RuntimeTimelineActionTarget
}

export interface RuntimeTimelineSnapshot {
  schema: typeof RUNTIME_TIMELINE_SCHEMA
  generatedAt: string
  limit: number
  filters: RuntimeTimelineFilters
  entries: RuntimeTimelineEntry[]
  counts: RuntimeTimelineCounts
  issues: RuntimeTimelineIssue[]
  repairPlan: RuntimeTimelineRepairPlan
}

const RUNTIME_TIMELINE_STAGES: RuntimeTimelineStage[] = ['context', 'provider', 'tool', 'session', 'compact', 'plugin', 'token', 'other']
const RUNTIME_TIMELINE_STATUSES: RuntimeTimelineStatus[] = ['done', 'blocked', 'error', 'skipped', 'running', 'info']

export function loadRuntimeTimelineSnapshot(options: RuntimeTimelineOptions = {}): RuntimeTimelineSnapshot {
  return buildRuntimeTimelineSnapshot(getRuntimeEventHistory(), options)
}

export function buildRuntimeTimelineSnapshot(
  events: RuntimeEventEnvelope[],
  options: RuntimeTimelineOptions = {},
): RuntimeTimelineSnapshot {
  const limit = normalizeRuntimeTimelineLimit(options.limit)
  const filters = normalizeRuntimeTimelineFilters(options)
  const entries = events
    .map(runtimeEventToTimelineEntry)
    .filter((entry) => runtimeTimelineEntryMatchesFilters(entry, filters))
  const limitedEntries = entries.slice(-limit)
  const orderedEntries = options.newestFirst === true ? [...limitedEntries].reverse() : limitedEntries
  const issues = summarizeRuntimeTimelineIssues(limitedEntries)

  return {
    schema: RUNTIME_TIMELINE_SCHEMA,
    generatedAt: new Date().toISOString(),
    limit,
    filters,
    entries: orderedEntries,
    counts: summarizeRuntimeTimelineCounts(orderedEntries),
    issues,
    repairPlan: buildRuntimeTimelineRepairPlan(issues),
  }
}

export function buildRuntimeTimelineRepairPlan(issues: RuntimeTimelineIssue[]): RuntimeTimelineRepairPlan {
  const tasks = new Map<string, RuntimeTimelineRepairTask>()
  for (const issue of issues) {
    const key = runtimeTimelineRepairTaskKey(issue)
    const existing = tasks.get(key)
    if (existing) {
      existing.issueCount += 1
      existing.eventCount += issue.count
      existing.firstTs = earlierTimestamp(existing.firstTs, issue.firstTs)
      existing.lastTs = laterTimestamp(existing.lastTs, issue.lastTs)
      existing.summary = issue.summary
      if (!existing.issueCodes.includes(issue.code)) existing.issueCodes.push(issue.code)
      appendRuntimeTimelineSourceEventIds(existing.sourceEventIds, issue.sourceEventIds)
      existing.latestEventId = issue.latestEventId
      if (runtimeTimelineSeverityRank(issue.severity) < runtimeTimelineSeverityRank(existing.severity)) {
        existing.severity = issue.severity
      }
      continue
    }
    tasks.set(key, {
      id: `runtime-repair-${tasks.size + 1}`,
      severity: issue.severity,
      action: issue.nextAction,
      target: { ...issue.actionTarget },
      issueCodes: [issue.code],
      sourceEventIds: [...issue.sourceEventIds],
      latestEventId: issue.latestEventId,
      issueCount: 1,
      eventCount: issue.count,
      firstTs: issue.firstTs,
      lastTs: issue.lastTs,
      summary: issue.summary,
    })
  }
  const orderedTasks = [...tasks.values()].sort((a, b) => runtimeTimelineRepairTaskRank(a) - runtimeTimelineRepairTaskRank(b))
  orderedTasks.forEach((task, index) => {
    task.id = `runtime-repair-${index + 1}`
  })
  return {
    status: orderedTasks.length ? 'ready' : 'clear',
    taskCount: orderedTasks.length,
    bySeverity: summarizeRuntimeTimelineRepairTaskSeverities(orderedTasks),
    tasks: orderedTasks,
  }
}

function runtimeEventToTimelineEntry(envelope: RuntimeEventEnvelope): RuntimeTimelineEntry {
  const data = runtimeObject(envelope.data) ?? {}
  const stage = runtimeTimelineStageForEvent(envelope.event)
  const status = runtimeTimelineStatusForEvent(envelope.event, data)
  return {
    id: envelope.id,
    ts: envelope.ts,
    event: envelope.event,
    stage,
    status,
    conversationId: envelope.conversationId ?? runtimeString(data.conversationId),
    providerId: envelope.providerId ?? runtimeString(data.providerId),
    credentialGroupId: envelope.credentialGroupId ?? runtimeString(data.credentialGroupId),
    model: envelope.model ?? runtimeString(data.upstreamModel) ?? runtimeString(data.model) ?? runtimeString(data.requestedModel),
    summary: summarizeRuntimeTimelineEntry(envelope.event, stage, status, data),
    data: pickRuntimeTimelineData(envelope.event, data),
  }
}

function runtimeTimelineStageForEvent(event: RuntimeControlPlaneEvent): RuntimeTimelineStage {
  if (event.startsWith('context.compact.')) return 'compact'
  if (event.startsWith('context.')) return 'context'
  if (event.startsWith('provider.')) return 'provider'
  if (event.startsWith('tool.')) return 'tool'
  if (event.startsWith('agent.')) return 'tool'
  if (event.startsWith('session.')) return 'session'
  if (event.startsWith('plugin.')) return 'plugin'
  if (event === 'token_usage.updated') return 'token'
  return 'other'
}

function runtimeTimelineStatusForEvent(
  event: RuntimeControlPlaneEvent,
  data: Record<string, unknown>,
): RuntimeTimelineStatus {
  const explicitStatus = normalizeRuntimeTimelineStatus(runtimeString(data.status) ?? runtimeString(data.outcome))
  if (explicitStatus) return explicitStatus
  if (event.endsWith('.error')) return 'error'
  if (event === 'provider.request.started') return 'running'
  if (event === 'plugin.catalog.snapshot.created') return 'done'
  if (event === 'provider.response.completed' || event === 'context.compact.completed') return 'done'
  if (event === 'context.fragment.excluded') return 'skipped'
  if (runtimeBoolean(data.blocked) === true || runtimeBoolean(data.payloadBlocked) === true) return 'blocked'
  if (event === 'context.compact.decided' && runtimeBoolean(data.enabled) === false) return 'skipped'
  return 'info'
}

function normalizeRuntimeTimelineStatus(value?: string): RuntimeTimelineStatus | undefined {
  if (!value) return undefined
  if (value === 'done' || value === 'completed' || value === 'ready' || value === 'success' || value === 'ok') return 'done'
  if (value === 'blocked' || value === 'rejected') return 'blocked'
  if (value === 'error' || value === 'failed' || value === 'failure') return 'error'
  if (value === 'skipped' || value === 'disabled') return 'skipped'
  if (value === 'running' || value === 'started' || value === 'pending') return 'running'
  if (value === 'info') return 'info'
  return undefined
}

function summarizeRuntimeTimelineEntry(
  event: RuntimeControlPlaneEvent,
  stage: RuntimeTimelineStage,
  status: RuntimeTimelineStatus,
  data: Record<string, unknown>,
): string {
  switch (event) {
    case 'provider.gateway.outcome':
      return `Provider gateway ${status} at ${runtimeString(data.stage) ?? 'runtime'}`
    case 'provider.route.snapshot.created':
      return `Route snapshot ${runtimeString(runtimeObject(data.snapshot)?.id) ?? runtimeString(data.routeSnapshotId) ?? 'created'}`
    case 'provider.access.decided':
      return `Provider access ${runtimeBoolean(data.allowed) === false ? 'blocked' : 'decided'}`
    case 'provider.route.decided':
      return `Provider route ${runtimeBoolean(data.blocked) ? 'blocked' : 'decided'}`
    case 'provider.conformance.checked':
      return `Provider conformance ${runtimeNumber(data.blockerCount) ? 'blocked' : 'checked'}`
    case 'provider.proxy.decided':
      return `Proxy ${runtimeString(data.reason) ?? runtimeString(data.mode) ?? 'decided'}`
    case 'provider.request.started':
      return 'Provider request started'
    case 'provider.response.completed':
      return 'Provider response completed'
    case 'provider.error':
      return `Provider error ${runtimeString(data.code) ?? runtimeString(data.errorCode) ?? runtimeNumber(data.status) ?? ''}`.trim()
    case 'provider.retry.scheduled':
      return `Provider retry scheduled${runtimeNumber(data.delayMs) ? ` in ${runtimeNumber(data.delayMs)}ms` : ''}`
    case 'provider.fallback.decided':
      return `Provider fallback ${runtimeString(data.reason) ?? runtimeString(data.trigger) ?? 'decided'}`
    case 'provider.circuit.changed':
      return `Provider circuit ${runtimeString(data.status) ?? 'changed'}`
    case 'tool.gateway.outcome':
      return `Tool gateway ${status}`
    case 'tool.mcp.compatibility.checked':
      return `MCP compatibility ${runtimeNumber(data.serverCount) ?? 0} servers, ${runtimeNumber(data.errorCount) ?? 0} errors, ${runtimeNumber(data.warningCount) ?? 0} warnings`
    case 'agent.security.evaluation.checked':
      return `Agent security eval ${runtimeNumber(data.caseCount) ?? 0} cases, ${runtimeNumber(data.blockedCaseCount) ?? 0} blocked, ${runtimeNumber(data.failedCaseCount) ?? 0} failed`
    case 'plugin.catalog.snapshot.created':
      return `Plugin catalog ${runtimeNumber(runtimeObject(data.counts)?.total) ?? runtimeNumber(data.entryCount) ?? 0} manifests, ${runtimeNumber(runtimeObject(data.counts)?.invalid) ?? 0} invalid`
    case 'session.lease.acquired':
      return 'Session lease acquired'
    case 'session.lease.rejected':
      return 'Session lease rejected'
    case 'session.affinity.resolved':
      return `Session affinity ${runtimeString(data.status) ?? 'resolved'}`
    case 'session.affinity.bound':
      return 'Session affinity bound'
    case 'session.affinity.invalidated':
      return `Session affinity invalidated${runtimeString(data.trigger) ? `: ${runtimeString(data.trigger)}` : ''}`
    case 'session.affinity.rotated':
      return 'Session affinity rotated'
    case 'context.planned': {
      const contextManifest = runtimeObject(data.contextManifest)
      const manifestFailureCodes = uniqueRuntimeTimelineStrings([
        ...runtimeStringArray(data.contextManifestFailureCodes),
        ...runtimeStringArray(contextManifest?.failureCodes),
      ])
      return `Context planned ${runtimeNumber(data.fragmentCount) ?? 0} fragments${manifestFailureCodes.length ? `, ${manifestFailureCodes.length} manifest issue(s)` : ''}`
    }
    case 'context.fragment.included':
      return `Context fragment included${runtimeNumber(data.count) ? ` x${runtimeNumber(data.count)}` : ''}`
    case 'context.fragment.excluded':
      return `Context fragment excluded${runtimeString(data.reason) ? `: ${runtimeString(data.reason)}` : ''}`
    case 'context.compact.decided':
      return `Compact ${runtimeBoolean(data.enabled) === true ? 'enabled' : 'skipped'}${runtimeString(data.reason) ? `: ${runtimeString(data.reason)}` : ''}`
    case 'context.compact.completed':
      return 'Compact completed'
    case 'token_usage.updated':
      return `Token usage updated${runtimeNumber(data.totalTokens) ? `: ${runtimeNumber(data.totalTokens)} total` : ''}`
    default:
      return `${stage} ${status}`
  }
}

function pickRuntimeTimelineData(
  event: RuntimeControlPlaneEvent,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const key of [
    'status',
    'stage',
    'reason',
    'trigger',
    'transport',
    'routeSnapshotId',
    'endpointFamily',
    'healthStatus',
    'sessionAffinityReason',
    'accessAllowed',
    'payloadBlocked',
    'usesResponsesApi',
    'enabled',
    'mode',
    'fragmentCount',
    'cappedFragmentCount',
    'cacheDiagnosticCount',
    'contextManifestSchema',
    'contextManifestId',
    'pressureRatio',
    'tokensUntilCompaction',
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'delayMs',
    'upstreamStatus',
    'failoverCount',
    'catalogSchema',
    'entryCount',
    'entryLimitApplied',
    'evaluationId',
    'serverCount',
    'serverLimit',
    'serverLimitApplied',
    'connectedCount',
    'warningCount',
    'errorCount',
    'toolCount',
    'resourceCount',
    'promptCount',
    'invalidManifestItemCount',
    'destructivePermissionCount',
    'refusedToolCallCount',
    'networkAttemptedToolCallCount',
    'qualityGatePassed',
    'caseCount',
    'passedCaseCount',
    'failedCaseCount',
    'blockedCaseCount',
    'blockedPromptInjectionCount',
    'blockedToolReplayCount',
    'blockedWorkflowTamperingCount',
    'unexpectedCaseCount',
  ]) {
    copyTimelineField(picked, data, key)
  }
  if (event === 'plugin.catalog.snapshot.created') {
    const counts = runtimeObject(data.counts)
    const reviewStates = runtimeObject(data.reviewStates)
    const permissions = runtimeObject(data.permissions)
    const sourceKinds = runtimeObject(data.sourceKinds)
    picked.totalManifests = runtimeNumber(counts?.total)
    picked.validManifests = runtimeNumber(counts?.valid)
    picked.invalidManifests = runtimeNumber(counts?.invalid)
    picked.executableHookCount = runtimeNumber(counts?.executableHooks)
    picked.noopHookCount = runtimeNumber(counts?.noopHooks)
    picked.hookCount = runtimeNumber(counts?.hooks)
    picked.unreviewedManifests = runtimeNumber(reviewStates?.unreviewed)
    picked.approvedManifests = runtimeNumber(reviewStates?.approved)
    picked.destructivePermissionCount = runtimeNumber(permissions?.destructive)
    picked.workflowSkillSources = runtimeNumber(sourceKinds?.['workflow-skill'])
    picked.mcpServerSources = runtimeNumber(sourceKinds?.['mcp-server'])
  }
  if (event === 'tool.gateway.outcome') {
    const mcp = runtimeObject(data.mcp)
    const providerNative = runtimeObject(data.providerNative)
    const structuredOutput = runtimeObject(data.structuredOutput)
    picked.mcpToolCount = runtimeNumber(mcp?.connectedToolCount)
    picked.providerDeclaredToolCount = runtimeNumber(providerNative?.declaredToolCount)
    picked.providerNativeSupported = runtimeBoolean(providerNative?.supported)
    picked.structuredOutputRequested = runtimeBoolean(structuredOutput?.requested)
    picked.structuredOutputRequestShape = runtimeString(structuredOutput?.requestShape)
    picked.structuredOutputBlocked = runtimeBoolean(structuredOutput?.blocked)
  }
  if (event === 'tool.mcp.compatibility.checked') {
    const failureCounts = runtimeObject(data.failureCounts)
    picked.mcpCompatibilitySchema = runtimeString(data.schema)
    picked.evaluationSchema = runtimeString(data.evaluationSchema)
    picked.failureCodes = runtimeStringArray(data.failureCodes)
    picked.unsupportedTransportCount = runtimeNumber(failureCounts?.unsupported_transport)
    picked.malformedSchemaCount = runtimeNumber(failureCounts?.malformed_schema)
    picked.permissionRequiredCount = runtimeNumber(failureCounts?.permission_required)
    picked.toolUnavailableCount = runtimeNumber(failureCounts?.tool_unavailable)
    picked.executionFailedCount = runtimeNumber(failureCounts?.execution_failed)
  }
  if (event === 'agent.security.evaluation.checked') {
    picked.agentSecuritySchema = runtimeString(data.schema)
    picked.evaluationSchema = runtimeString(data.evaluationSchema)
    picked.categories = runtimeStringArray(data.categories)
    picked.blockingConditions = runtimeStringArray(data.blockingConditions)
    picked.actualBehaviors = runtimeStringArray(data.actualBehaviors)
  }
  if (event === 'context.planned') {
    const cacheDiagnostics = runtimeArray(data.cacheDiagnostics)
      .map((diagnostic) => runtimeObject(diagnostic))
      .filter((diagnostic): diagnostic is Record<string, unknown> => Boolean(diagnostic))
    const contextManifest = runtimeObject(data.contextManifest)
    const contextManifestFailureCodes = uniqueRuntimeTimelineStrings([
      ...runtimeStringArray(data.contextManifestFailureCodes),
      ...runtimeStringArray(contextManifest?.failureCodes),
    ])
    picked.unboundedBlocked = cacheDiagnostics.filter((diagnostic) => runtimeString(diagnostic.kind) === 'unbounded_fragment_blocked').length
    picked.fullRewriteDetected = cacheDiagnostics.filter((diagnostic) => runtimeString(diagnostic.kind) === 'full_context_rewrite_detected').length
    if (contextManifestFailureCodes.length) picked.contextManifestFailureCodes = contextManifestFailureCodes
    picked.contextManifestIssueCount = contextManifestFailureCodes.length
    picked.contextManifestBudgetOverrun = contextManifestFailureCodes.includes('context_budget_overrun')
    picked.contextManifestSourceChurnCount = contextManifestFailureCodes.filter((code) => (
      code === 'context_source_hash_changed' ||
      code === 'context_fragment_id_churn' ||
      code === 'context_full_rewrite_detected'
    )).length
    if (!picked.contextManifestSchema) picked.contextManifestSchema = runtimeString(contextManifest?.schema)
    if (!picked.contextManifestId) picked.contextManifestId = runtimeString(contextManifest?.id)
  }
  if (event === 'provider.gateway.outcome') {
    const structuredOutput = runtimeObject(data.structuredOutput)
    picked.structuredOutputRequested = runtimeBoolean(structuredOutput?.requested)
    picked.structuredOutputRequestShape = runtimeString(structuredOutput?.requestShape)
    picked.structuredOutputBlocked = runtimeBoolean(structuredOutput?.blocked)
  }
  return Object.fromEntries(Object.entries(picked).filter(([, value]) => value !== undefined))
}

function summarizeRuntimeTimelineIssues(entries: RuntimeTimelineEntry[]): RuntimeTimelineIssue[] {
  const issues = new Map<string, RuntimeTimelineIssue>()
  for (const entry of entries) {
    for (const issue of runtimeTimelineIssuesForEntry(entry)) {
      const key = [
        issue.code,
        issue.providerId ?? '',
        issue.credentialGroupId ?? '',
        issue.model ?? '',
        issue.event,
        issue.nextAction,
      ].join('|')
      const existing = issues.get(key)
      if (existing) {
        existing.count += issue.count
        existing.lastTs = issue.lastTs
        existing.summary = issue.summary
        appendRuntimeTimelineSourceEventIds(existing.sourceEventIds, issue.sourceEventIds)
        existing.latestEventId = issue.latestEventId
      } else {
        issues.set(key, issue)
      }
    }
  }
  return [...issues.values()].sort((a, b) => runtimeTimelineIssueRank(a) - runtimeTimelineIssueRank(b))
}

function runtimeTimelineIssuesForEntry(entry: RuntimeTimelineEntry): RuntimeTimelineIssue[] {
  const issues: RuntimeTimelineIssue[] = []
  if (entry.stage === 'provider' && entry.status === 'error') {
    issues.push(buildRuntimeTimelineIssue(entry, 'provider_error', 'critical'))
  }
  if (entry.stage === 'provider' && entry.status === 'blocked') {
    issues.push(buildRuntimeTimelineIssue(entry, 'provider_blocked', 'warning'))
  }
  if (entry.stage === 'tool' && (entry.status === 'blocked' || runtimeBoolean(entry.data.structuredOutputBlocked) === true)) {
    issues.push(buildRuntimeTimelineIssue(entry, 'tool_blocked', 'warning'))
  }
  if (entry.event === 'tool.mcp.compatibility.checked') {
    const unsupportedTransportCount = runtimeNumber(entry.data.unsupportedTransportCount) ?? 0
    const malformedSchemaCount = runtimeNumber(entry.data.malformedSchemaCount) ?? 0
    const permissionRequiredCount = runtimeNumber(entry.data.permissionRequiredCount) ?? 0
    if (unsupportedTransportCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'mcp_transport_unsupported', 'warning', unsupportedTransportCount))
    }
    if (malformedSchemaCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'mcp_manifest_invalid', 'warning', malformedSchemaCount))
    }
    if (permissionRequiredCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'mcp_permission_required', 'warning', permissionRequiredCount))
    }
  }
  if (entry.event === 'agent.security.evaluation.checked') {
    const failedCaseCount = runtimeNumber(entry.data.failedCaseCount) ?? 0
    const promptInjectionCount = runtimeNumber(entry.data.blockedPromptInjectionCount) ?? 0
    const toolReplayCount = runtimeNumber(entry.data.blockedToolReplayCount) ?? 0
    const workflowTamperingCount = runtimeNumber(entry.data.blockedWorkflowTamperingCount) ?? 0
    if (failedCaseCount > 0 || runtimeBoolean(entry.data.qualityGatePassed) === false) {
      issues.push(buildRuntimeTimelineIssue(entry, 'agent_security_eval_failed', 'critical', Math.max(1, failedCaseCount)))
    }
    if (promptInjectionCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'agent_prompt_injection_blocked', 'warning', promptInjectionCount))
    }
    if (toolReplayCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'agent_tool_replay_blocked', 'warning', toolReplayCount))
    }
    if (workflowTamperingCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'agent_workflow_tampering_blocked', 'warning', workflowTamperingCount))
    }
  }
  if (entry.event === 'context.planned') {
    const manifestFailureCodes = runtimeStringArray(entry.data.contextManifestFailureCodes)
    const manifestUnbounded = manifestFailureCodes.includes('context_source_unbounded') ? 1 : 0
    const unboundedCount = Math.max(runtimeNumber(entry.data.unboundedBlocked) ?? 0, manifestUnbounded)
    if (unboundedCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'context_unbounded_blocked', 'warning', unboundedCount))
    }
    if (runtimeBoolean(entry.data.contextManifestBudgetOverrun) === true || manifestFailureCodes.includes('context_budget_overrun')) {
      issues.push(buildRuntimeTimelineIssue(entry, 'context_manifest_budget_overrun', 'warning'))
    }
    const sourceChurnCount = runtimeNumber(entry.data.contextManifestSourceChurnCount) ?? manifestFailureCodes.filter((code) => (
      code === 'context_source_hash_changed' ||
      code === 'context_fragment_id_churn' ||
      code === 'context_full_rewrite_detected'
    )).length
    if (sourceChurnCount > 0) {
      issues.push(buildRuntimeTimelineIssue(entry, 'context_manifest_source_churn', 'info', sourceChurnCount))
    }
  }
  if (entry.event === 'session.affinity.invalidated' || entry.event === 'session.affinity.rotated') {
    issues.push(buildRuntimeTimelineIssue(entry, 'session_failover', 'warning'))
  }
  if (entry.event === 'context.compact.decided' && entry.status === 'skipped') {
    const severity: RuntimeTimelineIssueSeverity = runtimeString(entry.data.reason) === 'provider_capability_missing' ? 'warning' : 'info'
    issues.push(buildRuntimeTimelineIssue(entry, 'compact_skipped', severity))
  }
  if (entry.event === 'plugin.catalog.snapshot.created' && (runtimeNumber(entry.data.executableHookCount) ?? 0) > 0) {
    issues.push(buildRuntimeTimelineIssue(entry, 'plugin_hook_executable', 'critical', runtimeNumber(entry.data.executableHookCount) ?? 1))
  }
  if (entry.event === 'plugin.catalog.snapshot.created' && (runtimeNumber(entry.data.invalidManifests) ?? 0) > 0) {
    issues.push(buildRuntimeTimelineIssue(entry, 'plugin_manifest_invalid', 'warning', runtimeNumber(entry.data.invalidManifests) ?? 1))
  }
  return issues
}

function buildRuntimeTimelineIssue(
  entry: RuntimeTimelineEntry,
  code: RuntimeTimelineIssueCode,
  severity: RuntimeTimelineIssueSeverity,
  count = 1,
): RuntimeTimelineIssue {
  const nextAction = runtimeTimelineNextActionForIssue(code, entry)
  return {
    code,
    severity,
    count,
    firstTs: entry.ts,
    lastTs: entry.ts,
    stage: entry.stage,
    status: entry.status,
    providerId: entry.providerId,
    credentialGroupId: entry.credentialGroupId,
    model: entry.model,
    event: entry.event,
    sourceEventIds: [entry.id],
    latestEventId: entry.id,
    summary: entry.summary,
    nextAction,
    actionTarget: runtimeTimelineActionTargetForIssue(code, nextAction, entry),
  }
}

function appendRuntimeTimelineSourceEventIds(target: string[], source: string[]) {
  for (const id of source) {
    if (target.length >= 8) return
    if (id && !target.includes(id)) target.push(id)
  }
}

function runtimeTimelineNextActionForIssue(
  code: RuntimeTimelineIssueCode,
  entry: RuntimeTimelineEntry,
): RuntimeTimelineNextActionCode {
  if (code === 'provider_error') {
    const status = runtimeNumber(entry.data.status) ?? runtimeNumber(entry.data.upstreamStatus)
    if (status === 401 || status === 403) return 'check_provider_credentials'
    return 'retry_or_switch_provider'
  }
  if (code === 'provider_blocked') {
    if (runtimeBoolean(entry.data.payloadBlocked) === true || runtimeString(entry.data.stage) === 'payload') return 'review_provider_policy'
    return 'retry_or_switch_provider'
  }
  if (code === 'tool_blocked') return 'fix_tool_schema'
  if (code === 'mcp_transport_unsupported') return 'review_mcp_transport'
  if (code === 'mcp_manifest_invalid') return 'review_mcp_manifest'
  if (code === 'mcp_permission_required') return 'confirm_mcp_tool_permission'
  if (code === 'agent_workflow_tampering_blocked') return 'review_agent_workflow'
  if (code === 'agent_prompt_injection_blocked' || code === 'agent_tool_replay_blocked' || code === 'agent_security_eval_failed') return 'review_agent_security_policy'
  if (code === 'context_unbounded_blocked' || code === 'context_manifest_budget_overrun') return 'cap_context_source'
  if (code === 'context_manifest_source_churn') return 'stabilize_context_sources'
  if (code === 'session_failover') return 'review_session_affinity'
  if (code === 'plugin_manifest_invalid' || code === 'plugin_hook_executable') return 'review_plugin_manifest'
  return 'enable_compact_or_reduce_history'
}

function runtimeTimelineActionTargetForIssue(
  code: RuntimeTimelineIssueCode,
  reason: RuntimeTimelineNextActionCode,
  entry: RuntimeTimelineEntry,
): RuntimeTimelineActionTarget {
  return {
    kind: runtimeTimelineActionTargetKindForIssue(code, reason),
    reason,
    event: entry.event,
    ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
    ...(entry.providerId ? { providerId: entry.providerId } : {}),
    ...(entry.credentialGroupId ? { credentialGroupId: entry.credentialGroupId } : {}),
    ...(entry.model ? { model: entry.model } : {}),
  }
}

function runtimeTimelineActionTargetKindForIssue(
  code: RuntimeTimelineIssueCode,
  reason: RuntimeTimelineNextActionCode,
): RuntimeTimelineActionTargetKind {
  if (code === 'tool_blocked') return 'tool-settings'
  if (code === 'mcp_transport_unsupported' || code === 'mcp_manifest_invalid' || code === 'mcp_permission_required') return 'tool-settings'
  if (code === 'agent_prompt_injection_blocked' || code === 'agent_tool_replay_blocked' || code === 'agent_workflow_tampering_blocked' || code === 'agent_security_eval_failed') return 'agent-settings'
  if (code === 'context_unbounded_blocked' || code === 'context_manifest_budget_overrun' || code === 'context_manifest_source_churn') return 'context-settings'
  if (code === 'session_failover') return 'session-affinity-settings'
  if (code === 'compact_skipped') return 'compact-settings'
  if (code === 'plugin_manifest_invalid' || code === 'plugin_hook_executable') return 'plugin-settings'
  if (code === 'provider_error' && reason === 'retry_or_switch_provider') return 'retry-chat'
  return 'provider-settings'
}

function runtimeTimelineRepairTaskKey(issue: RuntimeTimelineIssue): string {
  const target = issue.actionTarget
  return [
    target.kind,
    target.reason,
    target.providerId ?? '',
    target.credentialGroupId ?? '',
    target.model ?? '',
    target.conversationId ?? '',
    target.event,
  ].join('|')
}

function runtimeTimelineRepairTaskRank(task: RuntimeTimelineRepairTask): number {
  return runtimeTimelineSeverityRank(task.severity) * 100000000000000 + (Number.MAX_SAFE_INTEGER - Date.parse(task.lastTs))
}

function summarizeRuntimeTimelineRepairTaskSeverities(
  tasks: RuntimeTimelineRepairTask[],
): Record<RuntimeTimelineIssueSeverity, number> {
  return tasks.reduce<Record<RuntimeTimelineIssueSeverity, number>>((counts, task) => {
    counts[task.severity] += 1
    return counts
  }, { critical: 0, warning: 0, info: 0 })
}

function runtimeTimelineIssueRank(issue: RuntimeTimelineIssue): number {
  return runtimeTimelineSeverityRank(issue.severity) * 100000000000000 + (Number.MAX_SAFE_INTEGER - Date.parse(issue.lastTs))
}

function runtimeTimelineSeverityRank(severity: RuntimeTimelineIssueSeverity): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2
}

function earlierTimestamp(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b
}

function laterTimestamp(a: string, b: string): string {
  return Date.parse(a) >= Date.parse(b) ? a : b
}

function copyTimelineField(target: Record<string, unknown>, source: Record<string, unknown>, key: string): void {
  const value = source[key]
  if (value === undefined || value === null) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') target[key] = value
}

function runtimeTimelineEntryMatchesFilters(
  entry: RuntimeTimelineEntry,
  filters: RuntimeTimelineFilters,
): boolean {
  if (filters.conversationId && entry.conversationId !== filters.conversationId) return false
  if (filters.providerId && entry.providerId !== filters.providerId) return false
  if (filters.credentialGroupId && entry.credentialGroupId !== filters.credentialGroupId) return false
  if (filters.model && entry.model !== filters.model) return false
  if (filters.stage && entry.stage !== filters.stage) return false
  if (filters.status && entry.status !== filters.status) return false
  return true
}

function summarizeRuntimeTimelineCounts(entries: RuntimeTimelineEntry[]): RuntimeTimelineCounts {
  const byStage = createRuntimeTimelineCountMap(RUNTIME_TIMELINE_STAGES)
  const byStatus = createRuntimeTimelineCountMap(RUNTIME_TIMELINE_STATUSES)
  for (const entry of entries) {
    byStage[entry.stage] += 1
    byStatus[entry.status] += 1
  }
  return {
    total: entries.length,
    byStage,
    byStatus,
  }
}

function createRuntimeTimelineCountMap<T extends string>(keys: T[]): Record<T, number> {
  return keys.reduce<Record<T, number>>((acc, key) => {
    acc[key] = 0
    return acc
  }, {} as Record<T, number>)
}

function normalizeRuntimeTimelineLimit(limit: unknown): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return RUNTIME_TIMELINE_DEFAULT_LIMIT
  return Math.min(RUNTIME_TIMELINE_MAX_LIMIT, Math.max(0, Math.floor(limit)))
}

function normalizeRuntimeTimelineFilters(options: RuntimeTimelineOptions): RuntimeTimelineFilters {
  return {
    conversationId: normalizeTimelineFilterString(options.conversationId),
    providerId: normalizeTimelineFilterString(options.providerId),
    credentialGroupId: normalizeTimelineFilterString(options.credentialGroupId),
    model: normalizeTimelineFilterString(options.model),
    stage: options.stage,
    status: options.status,
  }
}

function normalizeTimelineFilterString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function runtimeObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function runtimeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function runtimeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return uniqueRuntimeTimelineStrings(value.map((item) => runtimeString(item)).filter((item): item is string => Boolean(item)))
}

function uniqueRuntimeTimelineStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed.slice(0, 96))
    if (result.length >= 16) break
  }
  return result
}

function runtimeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function runtimeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function runtimeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
