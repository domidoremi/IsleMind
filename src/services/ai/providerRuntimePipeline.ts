import type { AIProvider } from '@/types'
import { getModelConfig, getProviderConfigIssue } from '@/types'
import { chooseCredentialForModel, updateCredentialGroupHealth } from '@/services/ai/providerCredentials'
import {
  buildSessionAffinityBinding,
  deriveSessionAffinityKey,
  readSessionAffinityBinding,
  resolveSessionAffinityBinding,
  storeSessionAffinityBinding,
  type SessionAffinityBinding,
  type SessionAffinityResolution,
  type SessionAffinityResolutionReason,
} from '@/services/ai/providerSessionAffinity'
import { evaluatePayloadRules, type PayloadRuleResult } from '@/services/ai/policy/payloadRules'
import { resolveProxyPolicy, type ProxyPolicyDecision } from '@/services/ai/policy/proxyPolicy'
import { mergeRuntimeAliasAccessPolicy, resolveProviderModelAccess, type AccessPolicyDecision } from '@/services/ai/policy/providerModelAccess'
import type { ProviderFailoverInput } from '@/services/ai/providerFailover'
import { getProviderCompatibilityEvidenceForProvider } from '@/services/ai/providerCompatibilityContract'
import type { ProviderRouteContext, ProviderRouteResult } from '@/services/ai/providerRouter'
import type { ProviderRouteAssembly } from '@/services/ai/providerRouteAssembly'
import { assembleProviderRoute } from '@/services/ai/providerRouteAssembly'
import type { TransportSelection } from '@/services/ai/transport/transportSelector'
import { emitRuntimeEvent } from '@/services/runtimeEvents'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { usesOpenAIResponses } from '@/services/ai/providerOpenAIRequest'
import { getHeaders } from '@/services/ai/providerHeaders'
import { getHostedProviderSupportIssue } from '@/services/ai/providerHostedBoundary'
import { isBedrockRuntimeProvider, prepareBedrockRuntimeInvokeModelRequest } from '@/services/ai/providerAwsBedrockRouting'
import { clampMaxTokens } from '@/services/ai/providerRequestParameters'
import { optimizeRequestBody as optimizeProviderRequestBody } from '@/services/ai/providerRequestOptimization'
import { emitRuntimeGovernanceTrace, logPayloadPolicy, logProviderCompatibility, logProviderConformance, logProviderRouteDecision, logProxyPolicy, logUpstreamRequest, runtimeLogOptions } from '@/services/ai/providerRuntimeDiagnostics'
import { providerRuntimeError, type ProviderRuntimeError } from '@/services/ai/providerRuntimeResult'
import { providerRuntimeHealthRoute, resolveProviderRuntimeHealthView, type ProviderRuntimeHealthView } from '@/services/ai/providerRuntimeHealth'
import type { ChatRequest, TraceCallback } from '@/services/ai/base'

export const PROVIDER_ROUTE_DECISION_SNAPSHOT_SCHEMA = 'islemind.provider-route-decision-snapshot.v1'

export type ProviderRuntimePipelineStage =
  | 'access'
  | 'credential'
  | 'route'
  | 'conformance'
  | 'payload-policy'
  | 'proxy'

export interface PreparedProviderHttpRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface ProviderRouteDecisionSnapshot {
  schema: typeof PROVIDER_ROUTE_DECISION_SNAPSHOT_SCHEMA
  id: string
  ts: string
  conversationId?: string
  sessionId?: string
  providerId: string
  providerType: AIProvider['type']
  credentialGroupId?: string
  requestedModel: string
  upstreamModel: string
  endpointFamily: string
  access: {
    allowed: boolean
    reason?: string
    matchedRules: string[]
  }
  route: {
    protocol: string
    transport?: string
    requestedTransportMode?: string
    transportFallbackReason?: string
    manifestId: string
    capabilitySource: ProviderRouteResult['decision']['capabilitySource']
    blocked: boolean
    blockReasons: string[]
    warnings: string[]
  }
  compatibility: {
    id: string
    auditState: string
  }
  conformance: {
    manifestId: string
    family: string
    protocol: string
    source: ProviderRouteResult['conformance']['manifest']['source']
    issueCount: number
    blockerCodes: string[]
    warningCodes: string[]
    removedParams: string[]
    adjustedParamKeys: string[]
    requestFieldKeys: string[]
    reasoningResolution: {
      schema: ProviderRouteResult['conformance']['reasoningResolution']['schema']
      requested?: string
      enabled: boolean
      effective?: string
      requestShape: string
      sourceConfidence: ProviderRouteResult['conformance']['reasoningResolution']['sourceConfidence']
      failureCodes: string[]
      removedParams: string[]
    }
  }
  requestPolicy: {
    mode: PayloadRuleResult['mode']
    blocked: boolean
    findingIds: string[]
    requestFieldKeys: string[]
    messageCount: number
    attachmentCount: number
  }
  proxy: {
    mode: ProxyPolicyDecision['mode']
    applied: boolean
    reason: ProxyPolicyDecision['reason']
    endpointHost?: string
    routeProviderId: string
    routeModel?: string
    credentialGroupId?: string
  }
  fallback: {
    mode: ProviderRouteResult['decision']['fallbackPlan']['mode']
    trigger: ProviderRouteResult['decision']['fallbackPlan']['trigger']
    eligible: boolean
    selected?: ProviderRouteResult['decision']['fallbackPlan']['selected']
    acceptedCandidateCount: number
    rejectedCandidateCount: number
    blockedReasons: string[]
    requiresUserConfirmation: boolean
    reason: ProviderRouteResult['decision']['fallbackPlan']['reason']
  }
  health: {
    status: ProviderRuntimeHealthView['status'] | 'unknown'
    successes?: number
    failures?: number
    consecutiveFailures?: number
    cooldownUntilMs?: number
    circuitOpenUntilMs?: number
    lastSuccessAtMs?: number
    lastFailureAtMs?: number
  }
  sessionAffinity: {
    enabled: boolean
    reusable: boolean
    reason: SessionAffinityResolutionReason
    sessionKeyAvailable: boolean
    credentialGroupId?: string
    bindingExpiresAt?: number
    failoverCount?: number
    bound: boolean
  }
  runtime: {
    stream: boolean
    usesResponsesApi: boolean
  }
  redaction: {
    applied: true
    strategy: 'runtime-log-redaction-v1'
  }
}

export interface ProviderRuntimeRouteResolver {
  (req: ChatRequest, context?: ProviderRouteContext, failover?: ProviderFailoverInput): ProviderRouteResult
}

export interface ProviderRuntimePipelineInput {
  req: ChatRequest
  controller: AbortController
  resolveRoute: ProviderRuntimeRouteResolver
  onTrace?: TraceCallback
  hasWebSocketRuntime?: boolean
}

export interface ProviderRuntimePipelineReady {
  status: 'ready'
  requestedModel: string
  upstreamModel: string
  effectiveReq: ChatRequest
  runtimeReq: ChatRequest
  credentialGroupId?: string
  access: AccessPolicyDecision
  stream: boolean
  usesResponsesApi: boolean
  routeAssembly: ProviderRouteAssembly
  url: string
  transportSelection: TransportSelection
  headers: Record<string, string>
  routeResult: ProviderRouteResult
  rawBody: Record<string, unknown>
  payloadPolicy: PayloadRuleResult
  proxyPolicy: ProxyPolicyDecision
  routeDecisionSnapshot: ProviderRouteDecisionSnapshot
  preparedHttpRequest: PreparedProviderHttpRequest
}

export interface ProviderRuntimePipelineBlocked {
  status: 'blocked'
  stage: ProviderRuntimePipelineStage
  requestedModel: string
  upstreamModel: string
  effectiveReq: ChatRequest
  credentialGroupId?: string
  error: ProviderRuntimeError
}

export type ProviderRuntimePipelineResult = ProviderRuntimePipelineReady | ProviderRuntimePipelineBlocked

export async function prepareProviderRuntimePipeline(input: ProviderRuntimePipelineInput): Promise<ProviderRuntimePipelineResult> {
  const requestedModel = input.req.requestedModel ?? input.req.model
  const upstreamModel = resolveProviderModelAlias(input.req.provider, requestedModel)
  const effectiveReq = upstreamModel === input.req.model && requestedModel === input.req.model
    ? input.req
    : { ...input.req, requestedModel, model: upstreamModel }
  const sessionAffinityEnabled = effectiveReq.settings?.sessionAffinityEnabled === true
  const sessionAffinityKey = sessionAffinityEnabled
    ? deriveSessionAffinityKey({
        conversationId: effectiveReq.conversationId,
        sessionId: effectiveReq.sessionId,
        providerId: effectiveReq.provider.id,
        model: requestedModel,
      })
    : undefined
  const storedSessionAffinityBinding = sessionAffinityEnabled ? readSessionAffinityBinding(sessionAffinityKey) : undefined
  const sessionAffinityCoolingDownCredentialGroupIds: string[] = []
  if (sessionAffinityEnabled && storedSessionAffinityBinding) {
    const affinityHealth = await resolveProviderRuntimeHealthView(providerRuntimeHealthRoute({ ...effectiveReq, model: upstreamModel }, storedSessionAffinityBinding.credentialGroupId))
    if (affinityHealth?.status === 'cooldown' || affinityHealth?.status === 'circuit-open') {
      sessionAffinityCoolingDownCredentialGroupIds.push(storedSessionAffinityBinding.credentialGroupId)
    }
  }
  const sessionAffinity = resolveSessionAffinityBinding({
    enabled: sessionAffinityEnabled,
    provider: input.req.provider,
    model: requestedModel,
    upstreamModel,
    conversationId: effectiveReq.conversationId,
    sessionId: effectiveReq.sessionId,
    binding: storedSessionAffinityBinding,
    coolingDownCredentialGroupIds: sessionAffinityCoolingDownCredentialGroupIds,
  })
  if (sessionAffinity.enabled) {
    void emitRuntimeEvent({
      event: 'session.affinity.resolved',
      conversationId: effectiveReq.conversationId,
      providerId: effectiveReq.provider.id,
      credentialGroupId: sessionAffinity.credentialGroupId ?? sessionAffinity.binding?.credentialGroupId,
      model: upstreamModel,
      data: {
        enabled: sessionAffinity.enabled,
        reusable: sessionAffinity.reusable,
        reason: sessionAffinity.reason,
        sessionKeyAvailable: Boolean(sessionAffinity.sessionKey),
        credentialGroupId: sessionAffinity.credentialGroupId ?? sessionAffinity.binding?.credentialGroupId,
        bindingExpiresAt: sessionAffinity.binding?.expiresAt,
        failoverCount: sessionAffinity.binding?.failoverCount,
      },
      legacyData: {
        conversationId: effectiveReq.conversationId,
        providerId: effectiveReq.provider.id,
        model: upstreamModel,
        requestedModel,
        credentialGroupId: sessionAffinity.credentialGroupId ?? sessionAffinity.binding?.credentialGroupId,
        status: sessionAffinity.reusable ? 'reused' : 'skipped',
        reason: sessionAffinity.reason,
      },
      options: runtimeLogOptions(effectiveReq),
    })
  }
  const credential = chooseCredentialForModel(input.req.provider, requestedModel, {
    preferredCredentialGroupId: sessionAffinity.reusable ? sessionAffinity.credentialGroupId : undefined,
    excludedCredentialGroupIds: sessionAffinityCoolingDownCredentialGroupIds,
  })
  const requestedAccess = resolveProviderModelAccess({ provider: input.req.provider, model: requestedModel, settings: input.req.settings })
  const upstreamAccess = requestedModel === upstreamModel
    ? requestedAccess
    : resolveProviderModelAccess({ provider: input.req.provider, model: upstreamModel, settings: input.req.settings })
  const access = mergeRuntimeAliasAccessPolicy(requestedAccess, upstreamAccess)
  const accessPolicyLogData = {
    conversationId: effectiveReq.conversationId,
    providerId: effectiveReq.provider.id,
    model: upstreamModel,
    requestedModel,
    upstreamModel,
    allowed: access.allowed,
    matchedRules: access.matchedRules,
    reason: access.allowed ? undefined : access.reason,
  }
  void emitRuntimeEvent({
    event: 'provider.access.decided',
    conversationId: effectiveReq.conversationId,
    providerId: effectiveReq.provider.id,
    model: upstreamModel,
    data: accessPolicyLogData,
    legacyEvent: 'access.policy',
    legacyData: accessPolicyLogData,
    options: runtimeLogOptions(effectiveReq),
  })

  if (!access.allowed) {
    emitRuntimeGovernanceTrace({
      onTrace: input.onTrace,
      req: effectiveReq,
      requestedModel,
      upstreamModel,
      access,
      status: 'error',
    })
    return blocked('access', requestedModel, upstreamModel, effectiveReq, credential.credentialGroupId, providerRuntimeError(`access_policy_${access.reason}`, credential.credentialGroupId))
  }

  const runtimeReq: ChatRequest = {
    ...effectiveReq,
    provider: {
      ...effectiveReq.provider,
      apiKey: credential.apiKey || effectiveReq.provider.apiKey,
    },
  }
  const issue = getProviderConfigIssue(runtimeReq.provider, runtimeReq.provider.apiKey)
  if (issue) {
    effectiveReq.provider = updateCredentialGroupHealth(effectiveReq.provider, credential.credentialGroupId, false)
    return blocked('credential', requestedModel, upstreamModel, effectiveReq, credential.credentialGroupId, providerRuntimeError(`${issue.code}: ${issue.message}`, credential.credentialGroupId))
  }
  const hostedIssue = getHostedProviderSupportIssue(runtimeReq.provider, 'chat')
  if (hostedIssue) {
    effectiveReq.provider = updateCredentialGroupHealth(effectiveReq.provider, credential.credentialGroupId, false)
    return blocked('credential', requestedModel, upstreamModel, effectiveReq, credential.credentialGroupId, providerRuntimeError(hostedIssue.message, credential.credentialGroupId))
  }
  if (effectiveReq.signal) {
    effectiveReq.signal.addEventListener('abort', () => input.controller.abort(), { once: true })
  }
  const runtimeModelConfig = getModelConfig(runtimeReq.model, runtimeReq.provider.type, runtimeReq.provider.modelConfigs)
  const stream = runtimeModelConfig.supportsStreaming === false ? false : (effectiveReq.stream ?? true)
  if (!runtimeReq.provider.apiKey.trim()) {
    effectiveReq.provider = updateCredentialGroupHealth(effectiveReq.provider, credential.credentialGroupId, false)
    return blocked('credential', requestedModel, upstreamModel, effectiveReq, credential.credentialGroupId, providerRuntimeError('missing_key', credential.credentialGroupId))
  }

  const usesResponsesApi = usesOpenAIResponses(runtimeReq)
  const routeAssembly = assembleProviderRoute({
    provider: runtimeReq.provider,
    model: runtimeReq.model,
    stream,
    usesResponsesApi,
    settings: effectiveReq.settings,
    hasWebSocketRuntime: input.hasWebSocketRuntime,
  })
  const url = routeAssembly.endpoint
  const transportSelection = routeAssembly.transportSelection
  const headers = getHeaders(runtimeReq.provider)
  const routeResult = input.resolveRoute({ ...runtimeReq, stream }, {
    endpoint: url,
    transport: transportSelection.transport,
    requestedTransportMode: transportSelection.requestedMode,
    transportFallbackReason: transportSelection.fallbackReason,
  })
  const rawBody = optimizeProviderRequestBody(routeResult.body, {
    provider: runtimeReq.provider,
    model: runtimeReq.model,
    reasoningEffort: runtimeReq.reasoningEffort,
    settings: runtimeReq.settings,
    fallbackMaxTokens: clampMaxTokens(runtimeReq),
  })
  void logProviderRouteDecision(effectiveReq, routeResult.decision)
  void logProviderCompatibility(effectiveReq)
  void logProviderConformance(effectiveReq, routeResult.conformance)

  const conformanceBlockers = routeResult.conformance.issues.filter((issue) => issue.severity === 'block')
  if (conformanceBlockers.length) {
    emitRuntimeGovernanceTrace({
      onTrace: input.onTrace,
      req: effectiveReq,
      requestedModel,
      upstreamModel,
      access,
      route: routeResult.decision,
      transport: transportSelection,
      status: 'error',
    })
    return blocked(
      'conformance',
      requestedModel,
      upstreamModel,
      effectiveReq,
      credential.credentialGroupId,
      providerRuntimeError(`provider_conformance_blocked:${conformanceBlockers.map((issue) => issue.code).join(',')}`, credential.credentialGroupId),
    )
  }

  const payloadPolicy = evaluatePayloadRules({
    body: rawBody,
    messages: runtimeReq.messages,
    attachments: runtimeReq.attachments,
    mode: effectiveReq.settings?.payloadPolicyMode,
  })
  void logPayloadPolicy(effectiveReq, payloadPolicy)
  if (payloadPolicy.blocked) {
    emitRuntimeGovernanceTrace({
      onTrace: input.onTrace,
      req: effectiveReq,
      requestedModel,
      upstreamModel,
      access,
      route: routeResult.decision,
      transport: transportSelection,
      payload: payloadPolicy,
      status: 'error',
    })
    return blocked(
      'payload-policy',
      requestedModel,
      upstreamModel,
      effectiveReq,
      credential.credentialGroupId,
      providerRuntimeError(`payload_policy_blocked:${payloadPolicy.findings.map((item) => item.id).join(',')}`, credential.credentialGroupId),
    )
  }

  const health = await resolveProviderRuntimeHealthView(providerRuntimeHealthRoute(runtimeReq, credential.credentialGroupId))
  const proxyPolicy = resolveProxyPolicy({
    provider: runtimeReq.provider,
    model: runtimeReq.model,
    credentialGroupId: credential.credentialGroupId,
    url,
    settings: effectiveReq.settings,
    failoverDecision: routeResult.decision.fallbackPlan,
    health,
  })
  const sessionAffinityBinding = bindPreparedSessionAffinity({
    req: effectiveReq,
    requestedModel,
    upstreamModel,
    credentialGroupId: credential.credentialGroupId,
    sessionAffinity,
  })
  const routeDecisionSnapshot = buildProviderRouteDecisionSnapshot({
    req: effectiveReq,
    requestedModel,
    upstreamModel,
    credentialGroupId: credential.credentialGroupId,
    access,
    routeResult,
    transportSelection,
    payloadPolicy,
    proxyPolicy,
    health,
    sessionAffinity,
    sessionAffinityBinding,
    stream,
    usesResponsesApi,
  })
  void emitRuntimeEvent({
    event: 'provider.route.snapshot.created',
    conversationId: effectiveReq.conversationId,
    providerId: effectiveReq.provider.id,
    credentialGroupId: credential.credentialGroupId,
    model: upstreamModel,
    data: { snapshot: routeDecisionSnapshot },
    legacyData: {
      conversationId: effectiveReq.conversationId,
      providerId: effectiveReq.provider.id,
      model: upstreamModel,
      requestedModel,
      credentialGroupId: credential.credentialGroupId,
      routeDecisionSnapshot,
    },
    options: runtimeLogOptions(effectiveReq),
  })
  void logProxyPolicy(effectiveReq, proxyPolicy)
  void logUpstreamRequest(effectiveReq, transportSelection, payloadPolicy, proxyPolicy)
  emitRuntimeGovernanceTrace({
    onTrace: input.onTrace,
    req: effectiveReq,
    requestedModel,
    upstreamModel,
    access,
    route: routeResult.decision,
    transport: transportSelection,
    payload: payloadPolicy,
    proxy: proxyPolicy,
    status: 'done',
  })

  return {
    status: 'ready',
    requestedModel,
    upstreamModel,
    effectiveReq,
    runtimeReq,
    credentialGroupId: credential.credentialGroupId,
    access,
    stream,
    usesResponsesApi,
    routeAssembly,
    url,
    transportSelection,
    headers,
    routeResult,
    rawBody,
    payloadPolicy,
    proxyPolicy,
    routeDecisionSnapshot,
    preparedHttpRequest: prepareHttpJsonRequest({
      provider: runtimeReq.provider,
      model: runtimeReq.model,
      url: proxyPolicy.effectiveUrl,
      headers,
      body: rawBody,
    }),
  }
}

export interface ProviderRouteDecisionSnapshotInput {
  req: ChatRequest
  requestedModel: string
  upstreamModel: string
  credentialGroupId?: string
  access: AccessPolicyDecision
  routeResult: ProviderRouteResult
  transportSelection: TransportSelection
  payloadPolicy: PayloadRuleResult
  proxyPolicy: ProxyPolicyDecision
  health?: ProviderRuntimeHealthView
  sessionAffinity: SessionAffinityResolution
  sessionAffinityBinding?: SessionAffinityBinding
  stream: boolean
  usesResponsesApi: boolean
}

export function buildProviderRouteDecisionSnapshot(
  input: ProviderRouteDecisionSnapshotInput,
  now = new Date()
): ProviderRouteDecisionSnapshot {
  const conformance = input.routeResult.conformance
  const route = input.routeResult.decision
  const compatibility = getProviderCompatibilityEvidenceForProvider(input.req.provider)
  const blockerCodes = conformance.issues
    .filter((issue) => issue.severity === 'block')
    .map((issue) => issue.code)
  const warningCodes = conformance.issues
    .filter((issue) => issue.severity !== 'block')
    .map((issue) => issue.code)

  return {
    schema: PROVIDER_ROUTE_DECISION_SNAPSHOT_SCHEMA,
    id: createProviderRouteDecisionSnapshotId(now),
    ts: now.toISOString(),
    conversationId: input.req.conversationId,
    sessionId: input.req.sessionId,
    providerId: input.req.provider.id,
    providerType: input.req.provider.type,
    credentialGroupId: input.credentialGroupId,
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    endpointFamily: conformance.manifest.protocol,
    access: {
      allowed: input.access.allowed,
      reason: input.access.allowed ? undefined : input.access.reason,
      matchedRules: [...input.access.matchedRules],
    },
    route: {
      protocol: route.protocol,
      transport: route.transport,
      requestedTransportMode: route.requestedTransportMode,
      transportFallbackReason: route.transportFallbackReason,
      manifestId: route.manifestId,
      capabilitySource: route.capabilitySource,
      blocked: route.blocked,
      blockReasons: [...route.blockReasons],
      warnings: [...route.warnings],
    },
    compatibility: {
      id: compatibility.id,
      auditState: compatibility.auditState,
    },
    conformance: {
      manifestId: conformance.manifest.id,
      family: conformance.manifest.family,
      protocol: conformance.manifest.protocol,
      source: conformance.manifest.source,
      issueCount: conformance.issues.length,
      blockerCodes,
      warningCodes,
      removedParams: [...conformance.removedParams],
      adjustedParamKeys: Object.keys(conformance.adjustedParams).sort(),
      requestFieldKeys: [...conformance.bodyKeys],
      reasoningResolution: {
        schema: conformance.reasoningResolution.schema,
        requested: conformance.reasoningResolution.requested,
        enabled: conformance.reasoningResolution.enabled,
        effective: conformance.reasoningResolution.effective,
        requestShape: conformance.reasoningResolution.requestShape,
        sourceConfidence: conformance.reasoningResolution.sourceConfidence,
        failureCodes: [...conformance.reasoningResolution.failureCodes],
        removedParams: [...conformance.reasoningResolution.removedParams],
      },
    },
    requestPolicy: {
      mode: input.payloadPolicy.mode,
      blocked: input.payloadPolicy.blocked,
      findingIds: input.payloadPolicy.findings.map((item) => item.id),
      requestFieldKeys: [...input.payloadPolicy.bodyKeys],
      messageCount: input.payloadPolicy.messageCount,
      attachmentCount: input.payloadPolicy.attachmentCount,
    },
    proxy: {
      mode: input.proxyPolicy.mode,
      applied: input.proxyPolicy.applied,
      reason: input.proxyPolicy.reason,
      endpointHost: input.proxyPolicy.endpointHost,
      routeProviderId: input.proxyPolicy.route.providerId,
      routeModel: input.proxyPolicy.route.model,
      credentialGroupId: input.proxyPolicy.route.credentialGroupId,
    },
    fallback: {
      mode: route.fallbackPlan.mode,
      trigger: route.fallbackPlan.trigger,
      eligible: route.fallbackPlan.eligible,
      selected: route.fallbackPlan.selected,
      acceptedCandidateCount: route.fallbackPlan.acceptedCandidates.length,
      rejectedCandidateCount: route.fallbackPlan.rejectedCandidates.length,
      blockedReasons: [...route.fallbackPlan.blockedReasons],
      requiresUserConfirmation: route.fallbackPlan.requiresUserConfirmation,
      reason: route.fallbackPlan.reason,
    },
    health: summarizeSnapshotHealth(input.health),
    sessionAffinity: summarizeSessionAffinity(input.sessionAffinity, input.sessionAffinityBinding),
    runtime: {
      stream: input.stream,
      usesResponsesApi: input.usesResponsesApi,
    },
    redaction: {
      applied: true,
      strategy: 'runtime-log-redaction-v1',
    },
  }
}

function bindPreparedSessionAffinity(input: {
  req: ChatRequest
  requestedModel: string
  upstreamModel: string
  credentialGroupId?: string
  sessionAffinity: SessionAffinityResolution
}): SessionAffinityBinding | undefined {
  if (!input.sessionAffinity.enabled || !input.sessionAffinity.sessionKey || !input.credentialGroupId) {
    return input.sessionAffinity.reusable ? input.sessionAffinity.binding : undefined
  }
  if (input.sessionAffinity.reusable) return input.sessionAffinity.binding
  const reason = input.sessionAffinity.reason === 'credential_group_cooling_down' ? 'failover' : 'initial_bind'
  const binding = storeSessionAffinityBinding(buildSessionAffinityBinding({
    sessionKey: input.sessionAffinity.sessionKey,
    providerId: input.req.provider.id,
    model: input.requestedModel,
    credentialGroupId: input.credentialGroupId,
    ttlMs: input.req.settings?.sessionAffinityTtlMs,
    reason,
    previousBinding: input.sessionAffinity.binding,
  }))
  if (!binding) return undefined
  void emitRuntimeEvent({
    event: 'session.affinity.bound',
    conversationId: input.req.conversationId,
    providerId: input.req.provider.id,
    credentialGroupId: binding.credentialGroupId,
    model: input.upstreamModel,
    data: {
      reason: binding.reason,
      credentialGroupId: binding.credentialGroupId,
      sessionKeyAvailable: true,
      bindingExpiresAt: binding.expiresAt,
      failoverCount: binding.failoverCount,
    },
    legacyData: {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.upstreamModel,
      requestedModel: input.requestedModel,
      credentialGroupId: binding.credentialGroupId,
      status: 'bound',
      reason: binding.reason,
      expiresAt: binding.expiresAt,
      failoverCount: binding.failoverCount,
    },
    options: runtimeLogOptions(input.req),
  })
  return binding
}

export function prepareHttpJsonRequest(input: {
  provider: AIProvider
  model: string
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}): PreparedProviderHttpRequest {
  if (isBedrockRuntimeProvider(input.provider)) {
    return prepareBedrockRuntimeInvokeModelRequest({
      provider: input.provider,
      model: input.model,
      body: input.body,
    })
  }
  return {
    url: input.url,
    headers: input.headers,
    body: JSON.stringify(input.body),
  }
}

function blocked(
  stage: ProviderRuntimePipelineStage,
  requestedModel: string,
  upstreamModel: string,
  effectiveReq: ChatRequest,
  credentialGroupId: string | undefined,
  error: ProviderRuntimeError
): ProviderRuntimePipelineBlocked {
  return {
    status: 'blocked',
    stage,
    requestedModel,
    upstreamModel,
    effectiveReq,
    credentialGroupId,
    error,
  }
}

function summarizeSnapshotHealth(health: ProviderRuntimeHealthView | undefined): ProviderRouteDecisionSnapshot['health'] {
  if (!health) return { status: 'unknown' }
  return {
    status: health.status,
    successes: health.successes,
    failures: health.failures,
    consecutiveFailures: health.consecutiveFailures,
    cooldownUntilMs: health.cooldownUntilMs,
    circuitOpenUntilMs: health.circuitOpenUntilMs,
    lastSuccessAtMs: health.lastSuccessAtMs,
    lastFailureAtMs: health.lastFailureAtMs,
  }
}

function summarizeSessionAffinity(
  resolution: SessionAffinityResolution,
  binding: SessionAffinityBinding | undefined
): ProviderRouteDecisionSnapshot['sessionAffinity'] {
  return {
    enabled: resolution.enabled,
    reusable: resolution.reusable,
    reason: resolution.reason,
    sessionKeyAvailable: Boolean(resolution.sessionKey),
    credentialGroupId: resolution.credentialGroupId ?? binding?.credentialGroupId ?? resolution.binding?.credentialGroupId,
    bindingExpiresAt: binding?.expiresAt ?? resolution.binding?.expiresAt,
    failoverCount: binding?.failoverCount ?? resolution.binding?.failoverCount,
    bound: Boolean(binding),
  }
}

function createProviderRouteDecisionSnapshotId(now: Date): string {
  return `route-snapshot-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
