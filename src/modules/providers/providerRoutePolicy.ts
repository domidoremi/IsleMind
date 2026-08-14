import type { ProviderFailoverDecision, ProviderFailoverInput } from './providerFailoverPolicy'
import { resolveFailoverDecision } from './providerFailoverPolicy'
import type { ProviderGenerationParameterDiagnostics } from './providerConformancePolicy'

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
  resolutionSchema: string
  requested?: string
  enabled: boolean
  effective?: string
  providerValue?: string | number | boolean
  requestShape: string
  downgradeReason?: string
  sourceConfidence: 'source-backed' | 'inferred'
  failureCodes: string[]
  removedParams: string[]
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
  generationParameters?: ProviderGenerationParameterDiagnostics
}

export interface ProviderTransportPlan {
  streaming: boolean
  preferredEndpoint?: 'chat-completions' | 'responses'
}

export type ProviderFallbackPlan = ProviderFailoverDecision

export interface ProviderRouteCapabilitySource {
  url?: string
  verifiedAt?: string
  confidence: 'source-backed' | 'inferred'
}

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
  capabilitySource: ProviderRouteCapabilitySource
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

export interface ProviderRouteRequest {
  provider: { id: string }
  model: string
  requestedModel?: string
  structuredOutput?: unknown
}

export interface ProviderRouteConformance {
  manifest: {
    id: string
    protocol: string
    source: ProviderRouteCapabilitySource
    context: {
      windowTokens: number
      maxOutputTokens: number
    }
    payload: {
      maxTokensField: string
    }
    structuredOutput: {
      appRequestControl: boolean
      documentedRequestShape: string
      jsonObjectMode: boolean
      strictJsonSchema: boolean
    }
    transport: {
      streaming: boolean
      preferredEndpoint?: 'chat-completions' | 'responses'
    }
  }
  reasoning: {
    requested?: string
    enabled: boolean
    effective?: string
    providerValue?: string | number | boolean
    requestShape: string
    downgradeReason?: string
  }
  reasoningResolution: {
    schema: string
    sourceConfidence: 'source-backed' | 'inferred'
    failureCodes: string[]
    removedParams: string[]
  }
  requestedModalities: string[]
  issues: Array<{
    code: string
    severity: 'info' | 'warn' | 'block'
    field?: string
  }>
  removedParams: string[]
  adjustedParams: Record<string, unknown>
  bodyKeys: string[]
  parameterDiagnostics?: ProviderGenerationParameterDiagnostics
}

export interface ProviderHardenedRouteRequest<Conformance extends ProviderRouteConformance> {
  body: Record<string, unknown>
  conformance: Conformance
}

export interface ProviderRouteHardeningPort<
  Request extends ProviderRouteRequest,
  Conformance extends ProviderRouteConformance,
> {
  hardenRequest(request: Request, body: Record<string, unknown>): ProviderHardenedRouteRequest<Conformance>
}

export interface ProviderRouteInput<Request extends ProviderRouteRequest> {
  request: Request
  body: Record<string, unknown>
  context?: ProviderRouteContext
  failover?: ProviderFailoverInput
}

export interface ProviderRouteResult<Conformance extends ProviderRouteConformance = ProviderRouteConformance> {
  body: Record<string, unknown>
  conformance: Conformance
  decision: ProviderRouteDecision
}

export interface ProviderRoutePolicy<
  Request extends ProviderRouteRequest,
  Conformance extends ProviderRouteConformance,
> {
  resolve(input: ProviderRouteInput<Request>): ProviderRouteResult<Conformance>
}

export function createProviderRoutePolicy<
  Request extends ProviderRouteRequest,
  Conformance extends ProviderRouteConformance,
>(
  dependencies: ProviderRouteHardeningPort<Request, Conformance>,
): ProviderRoutePolicy<Request, Conformance> {
  return {
    resolve(input) {
      const hardened = dependencies.hardenRequest(input.request, input.body)
      const decision = buildRouteDecision(input, hardened.conformance)
      return {
        body: hardened.body,
        conformance: hardened.conformance,
        decision,
      }
    },
  }
}

function buildRouteDecision<
  Request extends ProviderRouteRequest,
  Conformance extends ProviderRouteConformance,
>(
  input: ProviderRouteInput<Request>,
  conformance: Conformance,
): ProviderRouteDecision {
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
      resolutionSchema: conformance.reasoningResolution.schema,
      requested: conformance.reasoning.requested,
      enabled: conformance.reasoning.enabled,
      effective: conformance.reasoning.effective,
      providerValue: conformance.reasoning.providerValue,
      requestShape: conformance.reasoning.requestShape,
      downgradeReason: conformance.reasoning.downgradeReason,
      sourceConfidence: conformance.reasoningResolution.sourceConfidence,
      failureCodes: [...conformance.reasoningResolution.failureCodes],
      removedParams: [...conformance.reasoningResolution.removedParams],
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
      ...(conformance.parameterDiagnostics ? { generationParameters: conformance.parameterDiagnostics } : {}),
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

function defaultFailoverInput<Request extends ProviderRouteRequest>(
  input: ProviderRouteInput<Request>,
): ProviderFailoverInput {
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
