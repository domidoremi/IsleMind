import type { ProcessTrace } from '@/types'
import type { ChatRequest, TraceCallback } from '@/services/ai/base'
import type { ProviderRuntimePipelineResult } from '@/services/ai/providerRuntimePipeline'
import { runtimeLogOptions } from '@/services/ai/providerRuntimeDiagnostics'
import { createProviderTrace } from '@/services/ai/providerTraceUtils'
import { buildStructuredOutputGatewayPlan, type ToolCallingGatewayStructuredOutput } from '@/services/toolCallingGateway'
import { emitRuntimeEvent } from '@/services/runtimeEvents'
import { redactSensitiveText } from '@/utils/traceSafety'

export const PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA = 'islemind.provider-runtime-gateway-outcome.v1'

export type ProviderRuntimeGatewayOutcomeStatus = 'ready' | 'blocked'

export interface ProviderRuntimeGatewayOutcome {
  schema: typeof PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA
  status: ProviderRuntimeGatewayOutcomeStatus
  conversationId?: string
  sessionId?: string
  providerId: string
  providerType: ChatRequest['provider']['type']
  credentialGroupId?: string
  requestedModel: string
  upstreamModel: string
  stage: string
  routeSnapshotId?: string
  endpointFamily?: string
  transport?: string
  accessAllowed?: boolean
  payloadBlocked?: boolean
  proxyMode?: string
  healthStatus?: string
  sessionAffinityReason?: string
  stream?: boolean
  usesResponsesApi?: boolean
  structuredOutput: ToolCallingGatewayStructuredOutput
  error?: {
    message: string
  }
  redaction: {
    applied: true
    strategy: 'runtime-log-redaction-v1'
  }
}

export function buildProviderRuntimeGatewayOutcome(result: ProviderRuntimePipelineResult): ProviderRuntimeGatewayOutcome {
  const req = result.effectiveReq
  if (result.status === 'blocked') {
    return {
      schema: PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA,
      status: 'blocked',
      conversationId: req.conversationId,
      sessionId: req.sessionId,
      providerId: req.provider.id,
      providerType: req.provider.type,
      credentialGroupId: result.credentialGroupId,
      requestedModel: result.requestedModel,
      upstreamModel: result.upstreamModel,
      stage: result.stage,
      structuredOutput: buildStructuredOutputGatewayPlan({ request: req.structuredOutput }),
      error: {
        message: sanitizeGatewayText(result.error.message),
      },
      redaction: {
        applied: true,
        strategy: 'runtime-log-redaction-v1',
      },
    }
  }

  const snapshot = result.routeDecisionSnapshot
  return {
    schema: PROVIDER_RUNTIME_GATEWAY_OUTCOME_SCHEMA,
    status: 'ready',
    conversationId: req.conversationId,
    sessionId: req.sessionId,
    providerId: req.provider.id,
    providerType: req.provider.type,
    credentialGroupId: result.credentialGroupId,
    requestedModel: result.requestedModel,
    upstreamModel: result.upstreamModel,
    stage: 'ready',
    routeSnapshotId: snapshot.id,
    endpointFamily: snapshot.endpointFamily,
    transport: result.transportSelection.transport,
    accessAllowed: result.access.allowed,
    payloadBlocked: result.payloadPolicy.blocked,
    proxyMode: result.proxyPolicy.mode,
    healthStatus: snapshot.health.status,
    sessionAffinityReason: snapshot.sessionAffinity.reason,
    stream: result.stream,
    usesResponsesApi: result.usesResponsesApi,
    structuredOutput: buildStructuredOutputGatewayPlan({
      request: req.structuredOutput,
      routePlan: result.routeResult.decision.structuredOutputPlan,
    }),
    redaction: {
      applied: true,
      strategy: 'runtime-log-redaction-v1',
    },
  }
}

export function emitProviderRuntimeGatewayOutcome(input: {
  result: ProviderRuntimePipelineResult
  onTrace?: TraceCallback
}): ProviderRuntimeGatewayOutcome {
  const outcome = buildProviderRuntimeGatewayOutcome(input.result)
  const req = input.result.effectiveReq
  void emitRuntimeEvent({
    event: 'provider.gateway.outcome',
    conversationId: outcome.conversationId,
    providerId: outcome.providerId,
    credentialGroupId: outcome.credentialGroupId,
    model: outcome.upstreamModel,
    data: { ...outcome },
    legacyData: {
      conversationId: outcome.conversationId,
      providerId: outcome.providerId,
      model: outcome.upstreamModel,
      requestedModel: outcome.requestedModel,
      credentialGroupId: outcome.credentialGroupId,
      status: outcome.status,
      stage: outcome.stage,
      routeSnapshotId: outcome.routeSnapshotId,
      transport: outcome.transport,
      structuredOutputRequested: outcome.structuredOutput.requested,
      structuredOutputSupported: outcome.structuredOutput.supported,
      structuredOutputRequestShape: outcome.structuredOutput.requestShape,
      structuredOutputBlocked: outcome.structuredOutput.blocked,
      error: outcome.error?.message,
    },
    options: runtimeLogOptions(req),
  })
  if (outcome.status === 'blocked') {
    input.onTrace?.(buildProviderRuntimeGatewayTrace(outcome))
  }
  return outcome
}

function buildProviderRuntimeGatewayTrace(outcome: ProviderRuntimeGatewayOutcome): ProcessTrace {
  return createProviderTrace(
    'system',
    outcome.providerType,
    'Provider gateway',
    [
      `Gateway ${outcome.status} at ${outcome.stage}.`,
      outcome.error?.message ? `Reason: ${outcome.error.message}` : '',
    ].filter(Boolean).join('\n'),
    outcome.status === 'ready' ? 'done' : 'error',
    `provider-gateway-${outcome.status}-${outcome.providerId}-${outcome.requestedModel}`,
    {
      schema: outcome.schema,
      status: outcome.status,
      stage: outcome.stage,
      requestedModel: outcome.requestedModel,
      upstreamModel: outcome.upstreamModel,
      credentialGroupId: outcome.credentialGroupId,
      routeSnapshotId: outcome.routeSnapshotId,
      transport: outcome.transport,
      structuredOutputRequested: outcome.structuredOutput.requested,
      structuredOutputSupported: outcome.structuredOutput.supported,
      structuredOutputRequestShape: outcome.structuredOutput.requestShape,
      structuredOutputBlocked: outcome.structuredOutput.blocked,
      error: outcome.error?.message,
    }
  )
}

function sanitizeGatewayText(value: string): string {
  const text = redactSensitiveText(value.trim())
  return text.length > 420 ? `${text.slice(0, 420)}...` : text
}
