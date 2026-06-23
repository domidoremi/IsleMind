import { st } from '@/i18n/service'
import type { PayloadRuleResult } from '@/services/ai/policy/payloadRules'
import type { ProxyPolicyDecision } from '@/services/ai/policy/proxyPolicy'
import type { AccessPolicyDecision } from '@/services/ai/policy/providerModelAccess'
import type { ProviderFailoverDecision, ProviderFailureClassification } from '@/services/ai/providerFailover'
import type { ProviderConformanceResult } from '@/services/ai/providerConformance'
import {
  CANONICAL_PROVIDER_COMPATIBILITY_BEHAVIORS,
  buildProviderCompatibilityBehaviorStatusMap,
  getProviderCompatibilityEvidenceForProvider,
  getProviderCompatibilityLiveSmokeGates,
  providerCompatibilityCapabilityExplicitlyDeclaredByProvider,
  resolveProviderCompatibilityCapabilitySendPolicy,
  type ProviderCompatibilityEvidenceProviderLike,
  type ProviderCompatibilityBehavior,
} from '@/services/ai/providerCompatibilityContract'
import type { ProviderRouteDecision } from '@/services/ai/providerRouter'
import type { TransportSelection } from '@/services/ai/transport/transportSelector'
import { appendRuntimeLog } from '@/services/runtimeLog'
import type { ProcessTrace, ProviderCapabilities } from '@/types'

export interface ProviderRuntimeLogRequestLike {
  settings?: {
    runtimeLogEnabled?: boolean
    runtimeLogMaxBytes?: number
  }
}

export interface ProviderRuntimeTraceRequestLike extends ProviderRuntimeLogRequestLike {
  provider: { id: string, capabilities?: Partial<ProviderCapabilities> } & ProviderCompatibilityEvidenceProviderLike
  model?: string
  requestedModel?: string
}

export interface ProviderRuntimeRequestLogLike extends ProviderRuntimeTraceRequestLike {
  conversationId?: string
  model: string
}

export interface ProviderRuntimeGovernanceTraceInput {
  req: ProviderRuntimeTraceRequestLike
  requestedModel: string
  upstreamModel: string
  access: AccessPolicyDecision
  route?: ProviderRouteDecision
  transport?: TransportSelection
  payload?: PayloadRuleResult
  proxy?: ProxyPolicyDecision
  status: ProcessTrace['status']
}

export interface ProviderRuntimeGovernanceTraceEmitInput extends ProviderRuntimeGovernanceTraceInput {
  onTrace?: (trace: ProcessTrace) => void
}

export interface ProviderRuntimeFallbackTracePlanLike {
  classification: ProviderFailureClassification
  decision: ProviderFailoverDecision
}

export function summarizeRouteDecision(route: ProviderRouteDecision | undefined): string {
  if (!route) return 'not_evaluated'
  if (route.blocked) return `blocked:${joinTraceCodes(route.blockReasons)}`
  if (route.warnings.length) return `warnings:${joinTraceCodes(route.warnings)}`
  return `${route.protocol}:ok`
}

export function summarizeTransportSelection(transport: TransportSelection | undefined): string {
  if (!transport) return 'not_selected'
  return transport.fallbackReason ? `${transport.transport}:${transport.fallbackReason}` : transport.transport
}

export function summarizePayloadPolicy(payload: PayloadRuleResult | undefined): string {
  if (!payload) return 'not_evaluated'
  const findings = payload.findings.map((item) => item.id)
  if (payload.blocked) return `blocked:${joinTraceCodes(findings)}`
  if (findings.length) return `${payload.mode}:${joinTraceCodes(findings)}`
  return `${payload.mode}:ok`
}

export function summarizeProxyPolicy(proxy: ProxyPolicyDecision | undefined): string {
  if (!proxy) return 'not_evaluated'
  return `${proxy.mode}:${proxy.applied ? 'applied' : 'not_applied'}:${proxy.reason}`
}

export function describeRuntimeAccessPolicy(access: AccessPolicyDecision): string {
  return access.allowed
    ? st('providerTrace.runtimeAccessAllowed')
    : st('providerTrace.runtimeAccessBlocked')
}

export function describeRuntimeRouteDecision(route: ProviderRouteDecision | undefined): string {
  if (!route) return st('providerTrace.runtimeRoutePending')
  if (route.blocked) return st('providerTrace.runtimeRouteBlocked')
  const protocol = runtimeProtocolLabel(route.protocol)
  return route.warnings.length
    ? st('providerTrace.runtimeRouteSelectedWithWarnings', { protocol })
    : st('providerTrace.runtimeRouteSelected', { protocol })
}

export function describeRuntimeTransportSelection(transport: TransportSelection | undefined): string {
  if (!transport) return st('providerTrace.runtimeTransportPending')
  const transportLabel = runtimeTransportLabel(transport.transport)
  if (!transport.fallbackReason) {
    return st('providerTrace.runtimeTransportSelected', { transport: transportLabel })
  }
  switch (transport.fallbackReason) {
    case 'http_forced':
      return st('providerTrace.runtimeTransportHttpForced', { transport: transportLabel })
    case 'streaming_disabled':
      return st('providerTrace.runtimeTransportStreamingDisabled', { transport: transportLabel })
    case 'non_responses_request':
      return st('providerTrace.runtimeTransportCompatibleHttp', { transport: transportLabel })
    case 'provider_capability_missing':
      return st('providerTrace.runtimeTransportProviderFallback', { transport: transportLabel })
    case 'websocket_runtime_missing':
      return st('providerTrace.runtimeTransportRuntimeFallback', { transport: transportLabel })
  }
  return st('providerTrace.runtimeTransportSelected', { transport: transportLabel })
}

export function describeRuntimePayloadPolicy(payload: PayloadRuleResult | undefined): string {
  if (!payload) return st('providerTrace.runtimePayloadPending')
  if (payload.blocked) return st('providerTrace.runtimePayloadBlocked')
  return payload.findings.length
    ? st('providerTrace.runtimePayloadAdjusted')
    : st('providerTrace.runtimePayloadReady')
}

export function describeRuntimeProxyPolicy(proxy: ProxyPolicyDecision | undefined): string {
  if (!proxy) return st('providerTrace.runtimeProxyPending')
  if (proxy.applied) {
    return proxy.mode === 'system-detected'
      ? st('providerTrace.runtimeProxySystem')
      : st('providerTrace.runtimeProxyCustom')
  }
  if (proxy.reason === 'invalid_custom_base_url') return st('providerTrace.runtimeProxyInvalid')
  return st('providerTrace.runtimeProxyOff')
}

export function describeRequestRectification(kind: string): string {
  switch (kind) {
    case 'thinking_signature':
      return st('providerTrace.requestRectifiedThinkingSignature')
    case 'thinking_budget':
      return st('providerTrace.requestRectifiedThinkingBudget')
    case 'xiaomi_mimo_thinking_disabled':
      return st('providerTrace.requestRectifiedMimoThinkingDisabled')
    case 'xiaomi_mimo_web_search_removed':
      return st('providerTrace.requestRectifiedMimoWebSearchRemoved')
    default:
      return st('providerTrace.requestRectifiedGeneric')
  }
}

export function runtimeLogOptions(req: ProviderRuntimeLogRequestLike) {
  return {
    enabled: req.settings?.runtimeLogEnabled,
    maxBytes: req.settings?.runtimeLogMaxBytes,
  }
}

export function buildPayloadPolicyLogData(req: ProviderRuntimeRequestLogLike, result: PayloadRuleResult): Record<string, unknown> {
  return {
    ...runtimeLogRequestFields(req),
    mode: result.mode,
    blocked: result.blocked,
    findings: result.findings,
    bodyKeys: result.bodyKeys,
    messageCount: result.messageCount,
    attachmentCount: result.attachmentCount,
  }
}

export async function logPayloadPolicy(req: ProviderRuntimeRequestLogLike, result: PayloadRuleResult): Promise<void> {
  if (!result.findings.length && !req.settings?.runtimeLogEnabled) return
  await appendRuntimeLog('payload.rule', buildPayloadPolicyLogData(req, result), runtimeLogOptions(req))
}

export function buildProviderConformanceLogData(req: ProviderRuntimeRequestLogLike, result: ProviderConformanceResult): Record<string, unknown> {
  return {
    ...runtimeLogRequestFields(req),
    family: result.manifest.family,
    protocol: result.manifest.protocol,
    source: result.manifest.source,
    reasoning: result.reasoning,
    requestedModalities: result.requestedModalities,
    removedParams: result.removedParams,
    adjustedParams: result.adjustedParams,
    issues: result.issues,
    bodyKeys: result.bodyKeys,
  }
}

export async function logProviderConformance(req: ProviderRuntimeRequestLogLike, result: ProviderConformanceResult): Promise<void> {
  if (!result.issues.length && !req.settings?.runtimeLogEnabled) return
  await appendRuntimeLog('provider.conformance', buildProviderConformanceLogData(req, result), runtimeLogOptions(req))
}

export function buildProviderCompatibilityLogData(req: ProviderRuntimeRequestLogLike): Record<string, unknown> {
  const evidence = getProviderCompatibilityEvidenceForProvider(req.provider)
  const gates = getProviderCompatibilityLiveSmokeGates(evidence.id)
  const capabilityStatuses = buildProviderCompatibilityBehaviorStatusMap(evidence.id)
  const capabilitySendPolicies = buildProviderCompatibilitySendPolicyMap(req.provider)
  return {
    ...runtimeLogRequestFields(req),
    compatibilityId: evidence.id,
    auditState: evidence.auditState,
    protocol: evidence.protocol,
    behaviorDocs: [...evidence.behaviorDocs],
    capabilityStatuses,
    capabilitySendPolicies,
    endpointFamilies: [...evidence.endpointFamilies],
    officialDocsCount: evidence.officialDocs.length,
    liveSmokeGateCount: gates.length,
    liveSmokeGateIds: gates.map((gate) => gate.id),
    liveSmokeRequiredEnv: [...new Set(gates.flatMap((gate) => gate.requiredEnv))].sort(),
  }
}

export async function logProviderCompatibility(req: ProviderRuntimeRequestLogLike): Promise<void> {
  await appendRuntimeLog('provider.compatibility', buildProviderCompatibilityLogData(req), runtimeLogOptions(req))
}

export function createProviderCompatibilityTrace(req: ProviderRuntimeRequestLogLike): ProcessTrace {
  const evidence = getProviderCompatibilityEvidenceForProvider(req.provider)
  const gates = getProviderCompatibilityLiveSmokeGates(evidence.id)
  const liveSmokeRequiredEnv = [...new Set(gates.flatMap((gate) => gate.requiredEnv))].sort()
  const capabilityStatuses = buildProviderCompatibilityBehaviorStatusMap(evidence.id)
  const capabilitySendPolicies = buildProviderCompatibilitySendPolicyMap(req.provider)
  const now = Date.now()
  return {
    id: `provider-compatibility-${now}`,
    type: 'system',
    title: st('providerTrace.providerCompatibilityTitle'),
    content: st('providerTrace.providerCompatibilityContent', {
      auditState: evidence.auditState,
      protocol: evidence.protocol,
      docs: String(evidence.officialDocs.length),
      gates: String(gates.length),
    }),
    status: evidence.auditState === 'conformance-ready' ? 'done' : 'skipped',
    startedAt: now,
    completedAt: now,
    metadata: {
      source: 'provider-compatibility-contract',
      providerId: req.provider.id,
      model: req.model,
      requestedModel: req.requestedModel,
      compatibilityId: evidence.id,
      auditState: evidence.auditState,
      protocol: evidence.protocol,
      behaviorDocs: [...evidence.behaviorDocs],
      capabilityStatuses,
      capabilitySendPolicies,
      endpointFamilies: [...evidence.endpointFamilies],
      officialDocsCount: evidence.officialDocs.length,
      liveSmokeGateCount: gates.length,
      liveSmokeGateIds: gates.map((gate) => gate.id),
      liveSmokeRequiredEnv,
    },
  }
}

function buildProviderCompatibilitySendPolicyMap(
  provider: ProviderRuntimeTraceRequestLike['provider'],
): Record<ProviderCompatibilityBehavior, ReturnType<typeof resolveProviderCompatibilityCapabilitySendPolicy>> {
  return Object.fromEntries(
    CANONICAL_PROVIDER_COMPATIBILITY_BEHAVIORS.map((behavior) => [
      behavior,
      resolveProviderCompatibilityCapabilitySendPolicy(
        provider,
        behavior,
        providerCompatibilityCapabilityExplicitlyDeclaredByProvider(provider, behavior),
      ),
    ]),
  ) as Record<ProviderCompatibilityBehavior, ReturnType<typeof resolveProviderCompatibilityCapabilitySendPolicy>>
}

export function buildProviderRouteDecisionLogData(req: ProviderRuntimeRequestLogLike, result: ProviderRouteDecision): Record<string, unknown> {
  return {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    route: result,
  }
}

export async function logProviderRouteDecision(req: ProviderRuntimeRequestLogLike, result: ProviderRouteDecision): Promise<void> {
  if (!result.blocked && !result.warnings.length && !req.settings?.runtimeLogEnabled) return
  await appendRuntimeLog('route.decision', buildProviderRouteDecisionLogData(req, result), runtimeLogOptions(req))
}

export function buildProxyPolicyLogData(req: ProviderRuntimeRequestLogLike, result: ProxyPolicyDecision): Record<string, unknown> {
  return {
    ...runtimeLogRequestFields(req),
    mode: result.mode,
    applied: result.applied,
    reason: result.reason,
    endpointHost: result.endpointHost,
  }
}

export async function logProxyPolicy(req: ProviderRuntimeRequestLogLike, result: ProxyPolicyDecision): Promise<void> {
  await appendRuntimeLog('proxy.policy', buildProxyPolicyLogData(req, result), runtimeLogOptions(req))
}

export function buildUpstreamRequestLogData(
  req: ProviderRuntimeRequestLogLike,
  transport: TransportSelection,
  payload: PayloadRuleResult,
  proxy: ProxyPolicyDecision
): Record<string, unknown> {
  return {
    ...runtimeLogRequestFields(req),
    transport: transport.transport,
    requestedTransportMode: transport.requestedMode,
    fallbackReason: transport.fallbackReason,
    policy: payload.mode,
    endpointHost: proxy.endpointHost,
    bodyKeys: payload.bodyKeys,
    messageCount: payload.messageCount,
    attachmentCount: payload.attachmentCount,
  }
}

export async function logUpstreamRequest(
  req: ProviderRuntimeRequestLogLike,
  transport: TransportSelection,
  payload: PayloadRuleResult,
  proxy: ProxyPolicyDecision
): Promise<void> {
  await appendRuntimeLog('upstream.request', buildUpstreamRequestLogData(req, transport, payload, proxy), runtimeLogOptions(req))
}

export function createStreamModeTrace(streamMode: 'reader' | 'buffered' | 'fallback', content: string): ProcessTrace {
  const now = Date.now()
  return {
    id: `stream-mode-${streamMode}`,
    type: 'system',
    title: st('providerTrace.streamMode'),
    content,
    status: streamMode === 'reader' ? 'done' : 'skipped',
    startedAt: now,
    completedAt: now,
    metadata: { streamMode },
  }
}

export function createRuntimeGovernanceTrace(input: ProviderRuntimeGovernanceTraceInput): ProcessTrace {
  const now = Date.now()
  const accessReason = input.access.allowed ? undefined : input.access.reason
  const payloadFindings = input.payload?.findings.map((item) => item.id) ?? []
  return {
    id: `runtime-governance-${now}`,
    type: 'system',
    title: st('providerTrace.runtimeGovernanceTitle'),
    content: st('providerTrace.runtimeGovernanceContent', {
      access: describeRuntimeAccessPolicy(input.access),
      route: describeRuntimeRouteDecision(input.route),
      transport: describeRuntimeTransportSelection(input.transport),
      payload: describeRuntimePayloadPolicy(input.payload),
      proxy: describeRuntimeProxyPolicy(input.proxy),
    }),
    status: input.status,
    startedAt: now,
    completedAt: now,
    metadata: {
      source: 'runtime-policy',
      providerId: input.req.provider.id,
      requestedModel: input.requestedModel,
      upstreamModel: input.upstreamModel,
      accessAllowed: input.access.allowed,
      accessReason,
      accessMatchedRules: input.access.matchedRules,
      routeBlocked: input.route?.blocked,
      routeBlockReasons: input.route?.blockReasons,
      routeWarnings: input.route?.warnings,
      routeProtocol: input.route?.protocol,
      routeManifestId: input.route?.manifestId,
      routeCapabilityConfidence: input.route?.capabilitySource.confidence,
      transport: input.transport?.transport,
      requestedTransportMode: input.transport?.requestedMode,
      transportFallbackReason: input.transport?.fallbackReason,
      payloadPolicyMode: input.payload?.mode,
      payloadBlocked: input.payload?.blocked,
      payloadFindings,
      payloadBodyKeys: input.payload?.bodyKeys,
      messageCount: input.payload?.messageCount,
      attachmentCount: input.payload?.attachmentCount,
      proxyMode: input.proxy?.mode,
      proxyApplied: input.proxy?.applied,
      proxyReason: input.proxy?.reason,
      endpointHost: input.proxy?.endpointHost,
    },
  }
}

export function emitRuntimeGovernanceTrace(input: ProviderRuntimeGovernanceTraceEmitInput): void {
  if (!input.onTrace) return
  input.onTrace(createRuntimeGovernanceTrace(input))
}

export function createRuntimeFallbackTrace(
  req: ProviderRuntimeTraceRequestLike,
  plan: ProviderRuntimeFallbackTracePlanLike,
  status: ProcessTrace['status'],
  failureReason?: string
): ProcessTrace {
  const now = Date.now()
  const selected = plan.decision.selected
  return {
    id: `runtime-fallback-${now}`,
    type: 'system',
    title: st('providerTrace.runtimeFallbackTitle'),
    content: st('providerTrace.runtimeFallbackContent', {
      trigger: plan.classification.trigger,
      decision: failureReason ?? plan.decision.reason,
      selected: selected ? `${selected.providerId}/${selected.model}` : 'none',
    }),
    status,
    startedAt: now,
    completedAt: now,
    metadata: {
      source: 'runtime-fallback',
      providerId: req.provider.id,
      model: req.model,
      requestedModel: req.requestedModel,
      trigger: plan.classification.trigger,
      retryable: plan.classification.retryable,
      eligible: plan.decision.eligible,
      decisionReason: plan.decision.reason,
      blockedReasons: plan.decision.blockedReasons,
      selectedProviderId: selected?.providerId,
      selectedModel: selected?.model,
      rejectedCandidateCount: plan.decision.rejectedCandidates.length,
      acceptedCandidateCount: plan.decision.acceptedCandidates.length,
      failureReason,
    },
  }
}

function joinTraceCodes(codes: string[]): string {
  return codes.filter(Boolean).join(',') || 'none'
}

function runtimeProtocolLabel(protocol: string): string {
  switch (protocol) {
    case 'openai-responses':
      return 'OpenAI Responses'
    case 'openai-compatible':
      return st('providerTrace.protocolOpenAICompatible')
    case 'anthropic':
    case 'anthropic-compatible':
      return 'Anthropic'
    case 'google':
    case 'google-gemini':
      return 'Google Gemini'
    case 'xai':
      return 'xAI'
    default:
      return protocol
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ') || st('providerTrace.protocolFallback')
  }
}

function runtimeTransportLabel(transport: TransportSelection['transport']): string {
  switch (transport) {
    case 'http_sse':
      return st('providerTrace.transportHttpSse')
    case 'responses_websocket':
      return st('providerTrace.transportResponsesWebSocket')
  }
}

function runtimeLogRequestFields(req: ProviderRuntimeRequestLogLike): Record<string, unknown> {
  return {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
  }
}
