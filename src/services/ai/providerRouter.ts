import type { ProviderConformanceRequest, ProviderConformanceResult } from '@/services/ai/providerConformance'
import { resolveAndHardenProviderRequest } from '@/services/ai/providerConformance'
import type { ProviderFailoverDecision, ProviderFailoverInput } from '@/services/ai/providerFailover'
import { resolveFailoverDecision } from '@/services/ai/providerFailover'

export interface ProviderRouteContext {
  endpoint?: string
  transport?: string
  requestedTransportMode?: string
  transportFallbackReason?: string
}

export interface ProviderContextPlan {
  windowTokens: number
  maxOutputTokens: number
  maxTokensField: string
  strategy: 'within-limit' | 'clamped' | 'unknown'
}

export interface ProviderModalityPlan {
  requested: string[]
  supported: string[]
  blocked: string[]
}

export interface ProviderReasoningPlan {
  requested?: string
  enabled: boolean
  effective?: string
  providerValue?: string | number | boolean
  requestShape: string
  downgradeReason?: string
}

export interface ProviderStructuredOutputPlan {
  requested: boolean
  supported: boolean
  requestShape: string
  jsonObjectMode: boolean
  strictJsonSchema: boolean
  blocked: boolean
}

export interface ProviderPayloadPlan {
  bodyKeys: string[]
  removedParams: string[]
  adjustedParams: Record<string, unknown>
}

export interface ProviderTransportPlan {
  streaming: boolean
  preferredEndpoint?: ProviderConformanceResult['manifest']['transport']['preferredEndpoint']
}

export type ProviderFallbackPlan = ProviderFailoverDecision

export interface ProviderRouteDecision {
  requestedProviderId: string
  requestedModel: string
  selectedProviderId: string
  selectedModel: string
  protocol: string
  endpoint?: string
  transport?: string
  requestedTransportMode?: string
  transportFallbackReason?: string
  manifestId: string
  capabilitySource: ProviderConformanceResult['manifest']['source']
  contextPlan: ProviderContextPlan
  modalityPlan: ProviderModalityPlan
  reasoningPlan: ProviderReasoningPlan
  structuredOutputPlan: ProviderStructuredOutputPlan
  payloadPlan: ProviderPayloadPlan
  transportPlan: ProviderTransportPlan
  fallbackPlan: ProviderFallbackPlan
  blocked: boolean
  blockReasons: string[]
  warnings: string[]
  evidence: {
    conformanceIssueCount: number
    sourceUrl?: string
    verifiedAt?: string
  }
}

export interface ProviderRouteInput {
  request: ProviderConformanceRequest & {
    requestedModel?: string
  }
  body: Record<string, unknown>
  context?: ProviderRouteContext
  failover?: ProviderFailoverInput
}

export interface ProviderRouteResult {
  body: Record<string, unknown>
  conformance: ProviderConformanceResult
  decision: ProviderRouteDecision
}

export function resolveProviderRoute(input: ProviderRouteInput): ProviderRouteResult {
  const hardened = resolveAndHardenProviderRequest(input.request, input.body)
  const decision = buildRouteDecision(input, hardened.conformance)
  return {
    body: hardened.body,
    conformance: hardened.conformance,
    decision,
  }
}

function buildRouteDecision(input: ProviderRouteInput, conformance: ProviderConformanceResult): ProviderRouteDecision {
  const manifest = conformance.manifest
  const blockers = conformance.issues.filter((issue) => issue.severity === 'block')
  const warnings = conformance.issues
    .filter((issue) => issue.severity !== 'block')
    .map((issue) => issue.code)
  const blockedModalities = conformance.issues
    .filter((issue) => issue.code === 'unsupported_modality' && typeof issue.field === 'string')
    .map((issue) => issue.field!)
  const structuredOutputBlocked = conformance.issues.some((issue) => issue.code === 'unsupported_structured_output')

  return {
    requestedProviderId: input.request.provider.id,
    requestedModel: input.request.requestedModel ?? input.request.model,
    selectedProviderId: input.request.provider.id,
    selectedModel: input.request.model,
    protocol: manifest.protocol,
    endpoint: input.context?.endpoint,
    transport: input.context?.transport,
    requestedTransportMode: input.context?.requestedTransportMode,
    transportFallbackReason: input.context?.transportFallbackReason,
    manifestId: manifest.id,
    capabilitySource: manifest.source,
    contextPlan: {
      windowTokens: manifest.context.windowTokens,
      maxOutputTokens: manifest.context.maxOutputTokens,
      maxTokensField: manifest.payload.maxTokensField,
      strategy: Object.keys(conformance.adjustedParams).some((key) => /max.*tokens/i.test(key)) ? 'clamped' : 'within-limit',
    },
    modalityPlan: {
      requested: conformance.requestedModalities,
      supported: conformance.requestedModalities.filter((modality) => !blockedModalities.includes(modality)),
      blocked: blockedModalities,
    },
    reasoningPlan: {
      requested: conformance.reasoning.requested,
      enabled: conformance.reasoning.enabled,
      effective: conformance.reasoning.effective,
      providerValue: conformance.reasoning.providerValue,
      requestShape: conformance.reasoning.requestShape,
      downgradeReason: conformance.reasoning.downgradeReason,
    },
    structuredOutputPlan: {
      requested: Boolean(input.request.structuredOutput),
      supported: manifest.structuredOutput.appRequestControl,
      requestShape: manifest.structuredOutput.documentedRequestShape,
      jsonObjectMode: manifest.structuredOutput.jsonObjectMode,
      strictJsonSchema: manifest.structuredOutput.strictJsonSchema,
      blocked: structuredOutputBlocked,
    },
    payloadPlan: {
      bodyKeys: conformance.bodyKeys,
      removedParams: conformance.removedParams,
      adjustedParams: conformance.adjustedParams,
    },
    transportPlan: {
      streaming: manifest.transport.streaming,
      preferredEndpoint: manifest.transport.preferredEndpoint,
    },
    fallbackPlan: resolveFailoverDecision(input.failover ?? defaultFailoverInput(input)),
    blocked: blockers.length > 0,
    blockReasons: blockers.map((issue) => issue.code),
    warnings,
    evidence: {
      conformanceIssueCount: conformance.issues.length,
      sourceUrl: manifest.source.url,
      verifiedAt: manifest.source.verifiedAt,
    },
  }
}

function defaultFailoverInput(input: ProviderRouteInput): ProviderFailoverInput {
  return {
    policy: { mode: 'off' },
    trigger: 'unknown',
    original: {
      providerId: input.request.provider.id,
      model: input.request.model,
    },
    candidates: [],
  }
}
