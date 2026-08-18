export const OBSERVABILITY_SINK_EXPORT_SCHEMA = 'islemind.observability-sink-export.v1'
export const OBSERVABILITY_SINK_PREVIEW_SCHEMA = 'islemind.observability-sink-preview.v1'
export const OBSERVABILITY_SINK_POLICY_SCHEMA = 'islemind.observability-sink-policy.v1'
export const OBSERVABILITY_SINK_TARGETS = ['opentelemetry', 'langfuse', 'phoenix'] as const
export const OBSERVABILITY_SINK_PREVIEW_EVENT_LIMIT = 40
export const OBSERVABILITY_SINK_ATTRIBUTE_LIMIT = 48
export const OBSERVABILITY_SINK_ATTRIBUTE_STRING_LIMIT = 160
export const OBSERVABILITY_SINK_MAX_ATTRIBUTE_LIMIT = 64
export const OBSERVABILITY_SINK_MAX_ATTRIBUTE_STRING_LIMIT = 512
const LEGACY_OBSERVABILITY_EVENT_PROJECTION_SCHEMA = 'islemind.observability-compatibility-eval.v1'

export type ObservabilitySinkTarget = typeof OBSERVABILITY_SINK_TARGETS[number]
export type ObservabilitySinkMode = 'off' | 'local-only' | 'external'
export type ObservabilitySinkEndpointKind = 'none' | 'https' | 'local-http' | 'unsafe-http' | 'invalid'
export type ObservabilitySinkHighFrequencyExportMode = 'drop' | 'coalesced' | 'per-event'
export type ObservabilitySinkExportPreviewStatus = 'ready' | 'blocked' | 'empty' | 'failed'
export type ObservabilitySinkPolicyBlockReason =
  | 'external-export-disabled'
  | 'local-only'
  | 'missing-target'
  | 'unsupported-target'
  | 'missing-endpoint'
  | 'invalid-endpoint'
  | 'insecure-remote-endpoint'
  | 'missing-api-key'
  | 'missing-user-opt-in'
  | 'missing-workspace-consent'
  | 'raw-payload-export-blocked'
  | 'invalid-export-schema'
  | 'invalid-redaction-strategy'
  | 'per-event-high-frequency-blocked'
  | 'attribute-limit-too-high'
  | 'attribute-string-limit-too-high'
export type ObservabilitySinkPolicyWarning =
  | 'local-http-development-only'
  | 'attribute-limit-defaulted'
  | 'attribute-string-limit-defaulted'
export type ObservabilityRuntimeEventName =
  | 'provider.gateway.outcome'
  | 'provider.access.decided'
  | 'provider.route.decided'
  | 'provider.route.snapshot.created'
  | 'provider.conformance.checked'
  | 'provider.proxy.decided'
  | 'provider.request.started'
  | 'provider.response.completed'
  | 'provider.error'
  | 'provider.retry.scheduled'
  | 'provider.fallback.decided'
  | 'provider.circuit.changed'
  | 'tool.gateway.outcome'
  | 'tool.mcp.compatibility.checked'
  | 'agent.security.evaluation.checked'
  | 'session.lease.acquired'
  | 'session.lease.rejected'
  | 'session.affinity.resolved'
  | 'session.affinity.bound'
  | 'session.affinity.invalidated'
  | 'session.affinity.rotated'
  | 'context.planned'
  | 'context.fragment.included'
  | 'context.fragment.excluded'
  | 'context.compact.decided'
  | 'context.compact.completed'
  | 'plugin.catalog.snapshot.created'
  | 'runtime.repair.replay.submitted'
  | 'runtime.repair.replay.applied'
  | 'runtime.repair.replay.dismissed'
  | 'token_usage.updated'
export type ObservabilitySpanKind = 'provider' | 'tool' | 'retrieval' | 'agent_eval' | 'context' | 'usage' | 'repair' | 'privacy' | 'session' | 'plugin'
export type ObservabilitySpanStatus = 'ok' | 'error' | 'blocked' | 'skipped'

export interface ObservabilityRuntimeEvent {
  schema: string
  expectedSchema: string
  id: string
  ts: string
  event: ObservabilityRuntimeEventName
  conversationId?: string
  turnId?: string
  messageId?: string
  providerId?: string
  credentialGroupId?: string
  model?: string
  data: Record<string, unknown>
  redaction: {
    applied: boolean
    strategy: string
  }
  persistence: {
    persisted: boolean
    notifiesSubscribers: boolean
  }
}

export interface ObservabilitySpan {
  id: string
  parentId?: string
  sourceEventIds: string[]
  kind: ObservabilitySpanKind
  name: string
  status: ObservabilitySpanStatus
  durationMs?: number
  failureCode?: string
  metrics?: Record<string, number>
  attributes: Record<string, unknown>
  content?: string
  persisted?: boolean
  notifiesSubscribers?: boolean
  evalOutcome?: 'passed' | 'failed' | 'blocked'
}

export interface ObservabilitySinkPrivacyDiagnostic {
  redactionApplied: boolean
  rawPromptLeaked: boolean
  rawContextLeaked: boolean
  rawToolArgumentsLeaked: boolean
  secretLeaked: boolean
}

export interface ObservabilitySinkExportOptions {
  target: ObservabilitySinkTarget
  traceId?: string
  now?: () => number
  attributeLimit?: number
  attributeStringLimit?: number
  rawPrompt?: string
  rawContext?: string
  rawToolArguments?: string
  secret?: string
}

export interface ObservabilitySinkPolicyInput {
  mode?: ObservabilitySinkMode
  target?: ObservabilitySinkTarget | string
  endpointUrl?: string
  apiKeyConfigured?: boolean
  userOptIn?: boolean
  workspaceConsent?: boolean
  developmentOnly?: boolean
  allowRawPayloads?: boolean
  exportSchema?: string
  redactionStrategy?: string
  attributeLimit?: number
  attributeStringLimit?: number
  highFrequencyExportMode?: ObservabilitySinkHighFrequencyExportMode
}

export interface ObservabilitySinkPolicyDecision {
  schema: typeof OBSERVABILITY_SINK_POLICY_SCHEMA
  mode: ObservabilitySinkMode
  target?: ObservabilitySinkTarget
  networkExportAllowed: boolean
  localDiagnosticsAllowed: boolean
  endpointKind: ObservabilitySinkEndpointKind
  endpointUrl?: string
  effectiveAttributeLimit: number
  effectiveAttributeStringLimit: number
  highFrequencyExportMode: ObservabilitySinkHighFrequencyExportMode
  blockReasons: ObservabilitySinkPolicyBlockReason[]
  warnings: ObservabilitySinkPolicyWarning[]
}

export interface ObservabilitySinkExportSpan {
  schema: typeof OBSERVABILITY_SINK_EXPORT_SCHEMA
  target: ObservabilitySinkTarget
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: ObservabilitySpanKind
  status: ObservabilitySpanStatus
  statusCode: 'OK' | 'ERROR' | 'UNSET'
  startedAtMs: number
  endedAtMs: number
  durationMs: number
  attributes: Record<string, string | number | boolean>
  metrics: Record<string, number>
  sourceEventIds: string[]
  highFrequencyPolicy: {
    persisted: boolean
    notifiesSubscribers: boolean
  }
  redaction: {
    applied: true
    strategy: 'observability-sink-redaction-v1'
    attributeLimitApplied: boolean
  }
}

export interface ObservabilitySinkExportDiagnostic {
  target: ObservabilitySinkTarget
  spanCount: number
  traceId: string
  attributeLimitAppliedCount: number
  sourceEventIdCount: number
  highFrequencySuppressionCount: number
  privacy: ObservabilitySinkPrivacyDiagnostic
  failureCodes: string[]
}

export interface ObservabilitySinkExportBatch {
  schema: typeof OBSERVABILITY_SINK_EXPORT_SCHEMA
  target: ObservabilitySinkTarget
  traceId: string
  generatedAtMs: number
  spanCount: number
  spans: ObservabilitySinkExportSpan[]
  diagnostic: ObservabilitySinkExportDiagnostic
}

export interface ObservabilitySinkExportPreviewOptions extends ObservabilitySinkPolicyInput {
  eventLimit?: number
  traceId?: string
  now?: () => number
  rawPrompt?: string
  rawContext?: string
  rawToolArguments?: string
  secret?: string
}

export interface ObservabilitySinkExportPreview {
  schema: typeof OBSERVABILITY_SINK_PREVIEW_SCHEMA
  exportSchema: typeof OBSERVABILITY_SINK_EXPORT_SCHEMA
  policy: ObservabilitySinkPolicyDecision
  status: ObservabilitySinkExportPreviewStatus
  target?: ObservabilitySinkTarget
  exportable: boolean
  eventCount: number
  eventLimit: number
  eventLimitApplied: boolean
  spanCount: number
  traceId?: string
  batch?: ObservabilitySinkExportBatch
  diagnostic?: ObservabilitySinkExportDiagnostic
  failureCodes: string[]
  blockReasons: ObservabilitySinkPolicyBlockReason[]
  warnings: ObservabilitySinkPolicyWarning[]
}

export function runtimeEventToObservabilitySpan(event: ObservabilityRuntimeEvent): ObservabilitySpan {
  const data = runtimeObject(event.data) ?? {}
  const status = runtimeEventToObservabilitySpanStatus(event.event, data)
  const failureCode = status === 'error' || status === 'blocked'
    ? runtimeEventFailureCode(data) ?? runtimeEventDefaultFailureCode(event.event, status)
    : undefined
  return {
    id: `observability-span:${event.id}`,
    sourceEventIds: [event.id],
    kind: runtimeEventToObservabilitySpanKind(event.event),
    name: event.event,
    status,
    durationMs: runtimeNumber(data.durationMs) ?? runtimeNumber(data.elapsedMs) ?? runtimeNumber(data.latencyMs) ?? 0,
    failureCode,
    metrics: {
      sourceEventCount: 1,
      dataFieldCount: Object.keys(data).length,
      ...runtimeEventNumericMetrics(data),
    },
    attributes: {
      runtimeEventSchema: event.schema,
      runtimeEvent: event.event,
      runtimeEventTs: event.ts,
      redactionApplied: event.redaction.applied,
      redactionStrategy: event.redaction.strategy,
      conversationId: event.conversationId,
      turnId: event.turnId,
      messageId: event.messageId,
      providerId: event.providerId,
      credentialGroupId: event.credentialGroupId,
      model: event.model,
      data,
      runtimeEventSchemaExpected: event.expectedSchema,
    },
    persisted: event.persistence.persisted,
    notifiesSubscribers: event.persistence.notifiesSubscribers,
    evalOutcome: runtimeEventEvalOutcome(data),
  }
}

export function runtimeEventToObservabilitySpanKind(event: ObservabilityRuntimeEventName): ObservabilitySpanKind {
  if (event.startsWith('provider.')) return 'provider'
  if (event.startsWith('tool.')) return 'tool'
  if (event === 'context.fragment.included' || event === 'context.fragment.excluded') return 'retrieval'
  if (event.startsWith('context.')) return 'context'
  if (event.startsWith('session.')) return 'session'
  if (event.startsWith('plugin.')) return 'plugin'
  if (event.startsWith('runtime.repair.')) return 'repair'
  if (event === 'token_usage.updated') return 'usage'
  return 'context'
}

export function buildObservabilitySinkExportBatch(
  spans: ObservabilitySpan[],
  options: ObservabilitySinkExportOptions,
): ObservabilitySinkExportBatch {
  const generatedAtMs = normalizeTimestampMs(options.now?.() ?? Date.now())
  const traceId = normalizeSinkTraceId(options.traceId) ?? createSinkTraceId(spans)
  const attributeLimit = normalizePositiveInteger(options.attributeLimit, OBSERVABILITY_SINK_ATTRIBUTE_LIMIT)
  const attributeStringLimit = normalizePositiveInteger(options.attributeStringLimit, OBSERVABILITY_SINK_ATTRIBUTE_STRING_LIMIT)
  const exportSpans = spans.map((spanItem) => buildObservabilitySinkExportSpan(
    spanItem,
    options.target,
    traceId,
    generatedAtMs,
    attributeLimit,
    attributeStringLimit,
  ))
  const batch: Omit<ObservabilitySinkExportBatch, 'diagnostic'> = {
    schema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    target: options.target,
    traceId,
    generatedAtMs,
    spanCount: exportSpans.length,
    spans: exportSpans,
  }
  return {
    ...batch,
    diagnostic: evaluateObservabilitySinkExportBatch(batch, options),
  }
}

export function buildObservabilitySinkExportPreview(
  events: ObservabilityRuntimeEvent[] = [],
  options: ObservabilitySinkExportPreviewOptions = {},
): ObservabilitySinkExportPreview {
  const eventLimit = normalizePreviewEventLimit(options.eventLimit)
  const boundedEvents = eventLimit === 0 ? [] : events.slice(-eventLimit)
  const eventLimitApplied = events.length > boundedEvents.length
  const policy = evaluateObservabilitySinkPolicy({
    mode: options.mode,
    target: options.target,
    endpointUrl: options.endpointUrl,
    apiKeyConfigured: options.apiKeyConfigured,
    userOptIn: options.userOptIn,
    workspaceConsent: options.workspaceConsent,
    developmentOnly: options.developmentOnly,
    allowRawPayloads: options.allowRawPayloads,
    exportSchema: options.exportSchema ?? OBSERVABILITY_SINK_EXPORT_SCHEMA,
    redactionStrategy: options.redactionStrategy ?? 'observability-sink-redaction-v1',
    attributeLimit: options.attributeLimit,
    attributeStringLimit: options.attributeStringLimit,
    highFrequencyExportMode: options.highFrequencyExportMode,
  })
  const target = policy.target ?? normalizeObservabilitySinkTarget(options.target)
  const canBuildExternalPreview = policy.networkExportAllowed
  const canBuildLocalPreview = policy.mode === 'local-only' && policy.localDiagnosticsAllowed
  const base: Omit<ObservabilitySinkExportPreview, 'status'> = {
    schema: OBSERVABILITY_SINK_PREVIEW_SCHEMA,
    exportSchema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    policy,
    ...(target ? { target } : {}),
    exportable: false,
    eventCount: boundedEvents.length,
    eventLimit,
    eventLimitApplied,
    spanCount: 0,
    failureCodes: [],
    blockReasons: policy.blockReasons,
    warnings: policy.warnings,
  }

  if (!canBuildExternalPreview && !canBuildLocalPreview) {
    return { ...base, status: 'blocked' }
  }
  if (!target) {
    return {
      ...base,
      status: 'blocked',
      failureCodes: ['missing-target'],
      blockReasons: unique([...policy.blockReasons, 'missing-target']),
    }
  }
  if (!boundedEvents.length) {
    return { ...base, target, status: 'empty' }
  }

  const spans = boundedEvents.map(runtimeEventToObservabilitySpan)
  const batch = buildObservabilitySinkExportBatch(spans, {
    target,
    traceId: options.traceId,
    now: options.now,
    attributeLimit: policy.effectiveAttributeLimit,
    attributeStringLimit: policy.effectiveAttributeStringLimit,
    rawPrompt: options.rawPrompt,
    rawContext: options.rawContext,
    rawToolArguments: options.rawToolArguments,
    secret: options.secret,
  })
  const failureCodes = batch.diagnostic.failureCodes
  const status: ObservabilitySinkExportPreviewStatus = failureCodes.length ? 'failed' : 'ready'
  return {
    ...base,
    target,
    status,
    exportable: canBuildExternalPreview && status === 'ready',
    spanCount: batch.spanCount,
    traceId: batch.traceId,
    batch,
    diagnostic: batch.diagnostic,
    failureCodes,
  }
}

export function evaluateObservabilitySinkPolicy(input: ObservabilitySinkPolicyInput = {}): ObservabilitySinkPolicyDecision {
  const mode = input.mode ?? 'off'
  const target = normalizeObservabilitySinkTarget(input.target)
  const endpoint = classifyObservabilitySinkEndpoint(input.endpointUrl)
  const effectiveAttributeLimit = normalizePositiveInteger(input.attributeLimit, OBSERVABILITY_SINK_ATTRIBUTE_LIMIT)
  const effectiveAttributeStringLimit = normalizePositiveInteger(input.attributeStringLimit, OBSERVABILITY_SINK_ATTRIBUTE_STRING_LIMIT)
  const highFrequencyExportMode = input.highFrequencyExportMode ?? 'coalesced'
  const blockReasons: ObservabilitySinkPolicyBlockReason[] = []
  const warnings: ObservabilitySinkPolicyWarning[] = []

  if (mode === 'off') blockReasons.push('external-export-disabled')
  if (mode === 'local-only') blockReasons.push('local-only')
  if (mode === 'external') {
    if (!input.target) blockReasons.push('missing-target')
    else if (!target) blockReasons.push('unsupported-target')
    if (!input.endpointUrl) blockReasons.push('missing-endpoint')
    else if (endpoint.kind === 'invalid') blockReasons.push('invalid-endpoint')
    else if (endpoint.kind === 'unsafe-http') blockReasons.push('insecure-remote-endpoint')
    else if (endpoint.kind === 'local-http' && input.developmentOnly !== true) blockReasons.push('insecure-remote-endpoint')
    else if (endpoint.kind === 'local-http') warnings.push('local-http-development-only')
    if (endpoint.kind === 'https' && input.apiKeyConfigured !== true) blockReasons.push('missing-api-key')
    if (input.userOptIn !== true) blockReasons.push('missing-user-opt-in')
    if (input.workspaceConsent !== true) blockReasons.push('missing-workspace-consent')
    if (input.allowRawPayloads === true) blockReasons.push('raw-payload-export-blocked')
    if (input.exportSchema !== OBSERVABILITY_SINK_EXPORT_SCHEMA) blockReasons.push('invalid-export-schema')
    if (input.redactionStrategy !== 'observability-sink-redaction-v1') blockReasons.push('invalid-redaction-strategy')
    if (highFrequencyExportMode === 'per-event') blockReasons.push('per-event-high-frequency-blocked')
    if (effectiveAttributeLimit > OBSERVABILITY_SINK_MAX_ATTRIBUTE_LIMIT) blockReasons.push('attribute-limit-too-high')
    if (effectiveAttributeStringLimit > OBSERVABILITY_SINK_MAX_ATTRIBUTE_STRING_LIMIT) blockReasons.push('attribute-string-limit-too-high')
  }

  if (input.attributeLimit === undefined) warnings.push('attribute-limit-defaulted')
  if (input.attributeStringLimit === undefined) warnings.push('attribute-string-limit-defaulted')

  return {
    schema: OBSERVABILITY_SINK_POLICY_SCHEMA,
    mode,
    ...(target ? { target } : {}),
    networkExportAllowed: mode === 'external' && blockReasons.length === 0,
    localDiagnosticsAllowed: mode !== 'off',
    endpointKind: endpoint.kind,
    ...(endpoint.url ? { endpointUrl: endpoint.url } : {}),
    effectiveAttributeLimit,
    effectiveAttributeStringLimit,
    highFrequencyExportMode,
    blockReasons: unique(blockReasons),
    warnings: unique(warnings),
  }
}

export function evaluateObservabilitySinkExportBatch(
  batch: Omit<ObservabilitySinkExportBatch, 'diagnostic'>,
  options: Pick<ObservabilitySinkExportOptions, 'rawPrompt' | 'rawContext' | 'rawToolArguments' | 'secret'> = {},
): ObservabilitySinkExportDiagnostic {
  const serialized = JSON.stringify(batch.spans)
  const privacy = {
    redactionApplied: serialized.includes('[redacted]') || serialized.includes('redacted:'),
    rawPromptLeaked: Boolean(options.rawPrompt && serialized.includes(options.rawPrompt)),
    rawContextLeaked: Boolean(options.rawContext && serialized.includes(options.rawContext)),
    rawToolArgumentsLeaked: Boolean(options.rawToolArguments && serialized.includes(options.rawToolArguments)),
    secretLeaked: Boolean(options.secret && serialized.includes(options.secret)),
  }
  const failureCodes: string[] = []
  if (!batch.traceId) failureCodes.push('missing-trace-id')
  for (const spanItem of batch.spans) {
    if (!spanItem.spanId) failureCodes.push('missing-span-id')
    if (!spanItem.sourceEventIds.length) failureCodes.push('missing-source-event-id')
    if (!spanItem.statusCode) failureCodes.push('missing-status-code')
    if (Object.keys(spanItem.attributes).length > OBSERVABILITY_SINK_ATTRIBUTE_LIMIT) failureCodes.push('attribute-budget-exceeded')
  }
  if (privacy.rawPromptLeaked) failureCodes.push('raw-prompt-leaked')
  if (privacy.rawContextLeaked) failureCodes.push('raw-context-leaked')
  if (privacy.rawToolArgumentsLeaked) failureCodes.push('tool-args-leaked')
  if (privacy.secretLeaked) failureCodes.push('secret-leaked')
  if ((options.rawPrompt || options.rawContext || options.rawToolArguments || options.secret) && !privacy.redactionApplied) failureCodes.push('missing-redaction-marker')

  return {
    target: batch.target,
    spanCount: batch.spanCount,
    traceId: batch.traceId,
    attributeLimitAppliedCount: batch.spans.filter((spanItem) => spanItem.redaction.attributeLimitApplied).length,
    sourceEventIdCount: unique(batch.spans.flatMap((spanItem) => spanItem.sourceEventIds)).length,
    highFrequencySuppressionCount: batch.spans.filter((spanItem) => !spanItem.highFrequencyPolicy.persisted || !spanItem.highFrequencyPolicy.notifiesSubscribers).length,
    privacy,
    failureCodes: unique(failureCodes),
  }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function runtimeEventToObservabilitySpanStatus(
  event: ObservabilityRuntimeEventName,
  data: Record<string, unknown>,
): ObservabilitySpanStatus {
  const explicit = normalizeObservabilityStatus(runtimeString(data.status) ?? runtimeString(data.outcome))
  if (explicit) return explicit
  if (event.endsWith('.error')) return 'error'
  if (event === 'context.fragment.excluded') return 'skipped'
  if (event === 'context.compact.decided' && runtimeBoolean(data.enabled) === false) return 'skipped'
  if (runtimeBoolean(data.blocked) === true || runtimeBoolean(data.payloadBlocked) === true) return 'blocked'
  return 'ok'
}

function normalizeObservabilityStatus(value?: string): ObservabilitySpanStatus | undefined {
  if (!value) return undefined
  if (value === 'ok' || value === 'done' || value === 'completed' || value === 'ready' || value === 'success' || value === 'passed') return 'ok'
  if (value === 'blocked' || value === 'rejected') return 'blocked'
  if (value === 'error' || value === 'failed' || value === 'failure') return 'error'
  if (value === 'skipped' || value === 'disabled') return 'skipped'
  return undefined
}

function runtimeEventFailureCode(data: Record<string, unknown>): string | undefined {
  return runtimeString(data.failureCode)
    ?? runtimeString(data.code)
    ?? runtimeString(data.errorCode)
    ?? runtimeString(data.reason)
    ?? runtimeString(data.blockerCode)
    ?? runtimeNumber(data.status)?.toString()
    ?? runtimeNumber(data.upstreamStatus)?.toString()
}

function runtimeEventDefaultFailureCode(event: ObservabilityRuntimeEventName, status: ObservabilitySpanStatus): string {
  if (status === 'error') return `${event}:error`
  return `${event}:blocked`
}

function runtimeEventEvalOutcome(data: Record<string, unknown>): ObservabilitySpan['evalOutcome'] {
  const value = runtimeString(data.evalOutcome) ?? runtimeString(data.outcome)
  return value === 'passed' || value === 'failed' || value === 'blocked' ? value : undefined
}

function runtimeEventNumericMetrics(data: Record<string, unknown>, prefix = ''): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const [key, value] of Object.entries(data)) {
    const metricKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'number' && Number.isFinite(value)) {
      metrics[metricKey] = value
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) metrics[`${metricKey}.${nestedKey}`] = nestedValue
      }
    }
  }
  return metrics
}

function runtimeObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
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

function buildObservabilitySinkExportSpan(
  spanItem: ObservabilitySpan,
  target: ObservabilitySinkTarget,
  traceId: string,
  generatedAtMs: number,
  attributeLimit: number,
  attributeStringLimit: number,
): ObservabilitySinkExportSpan {
  const durationMs = Number.isFinite(spanItem.durationMs) ? Math.max(0, Math.floor(spanItem.durationMs ?? 0)) : 0
  const attributes = buildObservabilitySinkAttributes(spanItem, target, attributeLimit, attributeStringLimit)
  return {
    schema: OBSERVABILITY_SINK_EXPORT_SCHEMA,
    target,
    traceId,
    spanId: `span-${hashString(spanItem.id)}`,
    ...(spanItem.parentId ? { parentSpanId: `span-${hashString(spanItem.parentId)}` } : {}),
    name: spanItem.name,
    kind: spanItem.kind,
    status: spanItem.status,
    statusCode: sinkStatusCode(spanItem.status),
    startedAtMs: Math.max(0, generatedAtMs - durationMs),
    endedAtMs: generatedAtMs,
    durationMs,
    attributes: attributes.attributes,
    metrics: spanItem.metrics ?? {},
    sourceEventIds: [...spanItem.sourceEventIds],
    highFrequencyPolicy: {
      persisted: spanItem.persisted !== false,
      notifiesSubscribers: spanItem.notifiesSubscribers !== false,
    },
    redaction: {
      applied: true,
      strategy: 'observability-sink-redaction-v1',
      attributeLimitApplied: attributes.limitApplied,
    },
  }
}

function buildObservabilitySinkAttributes(
  spanItem: ObservabilitySpan,
  target: ObservabilitySinkTarget,
  attributeLimit: number,
  attributeStringLimit: number,
): { attributes: Record<string, string | number | boolean>, limitApplied: boolean } {
  const entries: Array<[string, unknown]> = [
    ['islemind.schema', LEGACY_OBSERVABILITY_EVENT_PROJECTION_SCHEMA],
    ['islemind.sink.schema', OBSERVABILITY_SINK_EXPORT_SCHEMA],
    ['islemind.span.kind', spanItem.kind],
    ['islemind.span.status', spanItem.status],
    ['islemind.source_event_ids', spanItem.sourceEventIds.join(',')],
    ['islemind.redaction.applied', true],
    ['islemind.high_frequency.persisted', spanItem.persisted !== false],
    ['islemind.high_frequency.notifies_subscribers', spanItem.notifiesSubscribers !== false],
    ...observabilityTargetHintAttributes(target, spanItem),
    ...Object.entries(spanItem.attributes),
  ]
  if (spanItem.failureCode) entries.push(['islemind.failure_code', spanItem.failureCode])
  if (spanItem.evalOutcome) entries.push(['islemind.eval_outcome', spanItem.evalOutcome])

  const attributes: Record<string, string | number | boolean> = {}
  let limitApplied = false
  for (const [key, value] of entries) {
    if (Object.keys(attributes).length >= attributeLimit) {
      limitApplied = true
      break
    }
    const normalized = normalizeObservabilitySinkAttributeValue(key, value, attributeStringLimit)
    if (normalized === undefined) continue
    attributes[key] = normalized
  }
  return { attributes, limitApplied }
}

function observabilityTargetHintAttributes(
  target: ObservabilitySinkTarget,
  spanItem: ObservabilitySpan,
): Array<[string, unknown]> {
  if (target === 'opentelemetry') {
    return [
      ['otel.scope.name', 'islemind.runtime'],
      ['otel.status_code', sinkStatusCode(spanItem.status)],
    ]
  }
  if (target === 'langfuse') {
    return [
      ['langfuse.observation.type', spanItem.kind === 'provider' ? 'generation' : 'span'],
      ['langfuse.trace.input_policy', 'redacted-or-hashed'],
    ]
  }
  return [
    ['openinference.span.kind', openInferenceSpanKind(spanItem.kind)],
    ['phoenix.trace.input_policy', 'redacted-or-hashed'],
  ]
}

function normalizeObservabilitySinkAttributeValue(
  key: string,
  value: unknown,
  stringLimit: number,
): string | number | boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (isSensitiveSinkAttributeKey(key)) return summarizeSensitiveSinkValue(value, stringLimit)
  if (typeof value === 'string') return truncateSinkString(redactObservabilitySinkString(value), stringLimit)
  if (Array.isArray(value)) return truncateSinkString(`array:${value.length}`, stringLimit)
  if (typeof value === 'object') return truncateSinkString(`object:${Object.keys(value as Record<string, unknown>).sort().join(',')}`, stringLimit)
  return truncateSinkString(String(value), stringLimit)
}

function summarizeSensitiveSinkValue(value: unknown, stringLimit: number): string {
  if (Array.isArray(value)) return truncateSinkString(`[redacted:array:${value.length}]`, stringLimit)
  if (value && typeof value === 'object') return truncateSinkString(`[redacted:object:${Object.keys(value as Record<string, unknown>).sort().join(',')}]`, stringLimit)
  return '[redacted]'
}

function isSensitiveSinkAttributeKey(key: string): boolean {
  const normalized = key.toLowerCase()
  if (normalized.endsWith('hash')) return false
  if (normalized === 'runtimeeventschema' || normalized === 'runtimeevent' || normalized === 'runtimeeventts') return false
  return /authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password|credential|bearer|prompt|context|arguments|payload|body|content|message|response|base64|file_data|image_url|data/.test(normalized)
}

function redactObservabilitySinkString(value: string): string {
  return value
    .replace(/((?:^|[\s,;])(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|token|password|credential)\s*[:=]\s*)(["']?)([A-Za-z0-9._~+/=-]{8,})/gi, (_match, prefix: string, quote: string) => `${prefix}${quote}[redacted]${quote}`)
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}(?=$|[^A-Za-z0-9._~+/=-])/gi, '$1 [redacted]')
    .replace(/\b(Basic)\s+[A-Za-z0-9+/=-]{8,}(?=$|[^A-Za-z0-9+/=-])/gi, '$1 [redacted]')
    .replace(/\b(?:sk|tp)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '[redacted]')
}

function truncateSinkString(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value
}

function sinkStatusCode(status: ObservabilitySpanStatus): ObservabilitySinkExportSpan['statusCode'] {
  if (status === 'error' || status === 'blocked') return 'ERROR'
  if (status === 'skipped') return 'UNSET'
  return 'OK'
}

function openInferenceSpanKind(kind: ObservabilitySpanKind): string {
  if (kind === 'provider') return 'LLM'
  if (kind === 'tool') return 'TOOL'
  if (kind === 'retrieval') return 'RETRIEVER'
  if (kind === 'agent_eval') return 'EVALUATOR'
  return 'CHAIN'
}

function normalizeSinkTraceId(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function createSinkTraceId(spans: ObservabilitySpan[]): string {
  return `trace-${hashString(spans.flatMap((spanItem) => [spanItem.id, ...spanItem.sourceEventIds]).join('|'))}`
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function normalizeTimestampMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : Date.now()
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback
}

function normalizePreviewEventLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return OBSERVABILITY_SINK_PREVIEW_EVENT_LIMIT
  return Math.max(0, Math.floor(value!))
}

function normalizeObservabilitySinkTarget(value: string | undefined): ObservabilitySinkTarget | undefined {
  return OBSERVABILITY_SINK_TARGETS.includes(value as ObservabilitySinkTarget) ? value as ObservabilitySinkTarget : undefined
}

function classifyObservabilitySinkEndpoint(value: string | undefined): { kind: ObservabilitySinkEndpointKind, url?: string } {
  const safe = safeObservabilityHttpUrl(value)
  if (!value?.trim()) return { kind: 'none' }
  if (!safe) return { kind: 'invalid' }
  const parsed = new URL(safe)
  if (parsed.protocol === 'https:') return { kind: 'https', url: safe }
  return isLocalObservabilitySinkHost(parsed.hostname)
    ? { kind: 'local-http', url: safe }
    : { kind: 'unsafe-http', url: safe }
}

function isLocalObservabilitySinkHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

function safeObservabilityHttpUrl(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password) return null
    return trimmed
  } catch {
    return null
  }
}
