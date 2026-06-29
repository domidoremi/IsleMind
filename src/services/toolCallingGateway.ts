import type { AIProvider, ProcessTrace } from '@/types'
import type { AgentProviderToolAdapterResult } from '@/services/agent/agentProviderToolAdapter'
import type { ProviderStructuredOutputRequest } from '@/services/ai/providerConformance'
import type { ProviderStructuredOutputPlan } from '@/services/ai/providerRouter'
import type { ProviderNativeToolSupportDecision } from '@/services/chatProviderNativeToolUtils'
import { emitRuntimeEvent } from '@/services/runtimeEvents'

export const TOOL_CALLING_GATEWAY_OUTCOME_SCHEMA = 'islemind.tool-calling-gateway-outcome.v1'

export type ToolCallingGatewayOutcomeStatus = 'ready' | 'skipped'

export interface ToolCallingGatewayStructuredOutput {
  requested: boolean
  requestType?: ProviderStructuredOutputRequest['type']
  name?: string
  schemaProvided: boolean
  strictRequested?: boolean
  supported?: boolean
  requestShape?: ProviderStructuredOutputPlan['requestShape']
  jsonObjectMode?: boolean
  strictJsonSchema?: boolean
  blocked?: boolean
}

export interface ToolCallingGatewayOutcome {
  schema: typeof TOOL_CALLING_GATEWAY_OUTCOME_SCHEMA
  status: ToolCallingGatewayOutcomeStatus
  conversationId?: string
  providerId: string
  providerType: AIProvider['type']
  model: string
  mcp: {
    enabled: boolean
    connectedToolCount: number
    promptChars: number
  }
  providerNative: {
    supported: boolean
    reason?: ProviderNativeToolSupportDecision['reason']
    target?: AgentProviderToolAdapterResult['target']
    declaredToolCount: number
    skippedToolCount: number
    maxToolCallsPerStep?: number
    compatibilityId?: string
    auditState?: string
  }
  structuredOutput: ToolCallingGatewayStructuredOutput
  redaction: {
    applied: true
    strategy: 'runtime-log-redaction-v1'
  }
}

export interface BuildToolCallingGatewayOutcomeInput {
  conversationId?: string
  provider: Pick<AIProvider, 'id' | 'type'>
  model: string
  mcpEnabled: boolean
  mcpToolCount: number
  mcpPrompt?: string
  nativeToolSupport: ProviderNativeToolSupportDecision
  providerToolContext?: {
    adapter: Pick<AgentProviderToolAdapterResult, 'target' | 'tools' | 'skipped'>
    limits: { maxToolCallsPerStep: number }
  }
  structuredOutput?: ProviderStructuredOutputRequest
  structuredOutputPlan?: ProviderStructuredOutputPlan
  structuredOutputRequested?: boolean
  runtimeLog?: {
    enabled?: boolean
    maxBytes?: number
  }
}

export function buildToolCallingGatewayOutcome(input: BuildToolCallingGatewayOutcomeInput): ToolCallingGatewayOutcome {
  const declaredToolCount = input.providerToolContext?.adapter.tools.length ?? 0
  const mcpToolCount = Math.max(0, input.mcpToolCount)
  const structuredOutput = buildStructuredOutputGatewayPlan({
    request: input.structuredOutput,
    routePlan: input.structuredOutputPlan,
    requested: input.structuredOutputRequested,
  })
  return {
    schema: TOOL_CALLING_GATEWAY_OUTCOME_SCHEMA,
    status: declaredToolCount > 0 || mcpToolCount > 0 || structuredOutput.requested ? 'ready' : 'skipped',
    conversationId: input.conversationId,
    providerId: input.provider.id,
    providerType: input.provider.type,
    model: input.model,
    mcp: {
      enabled: input.mcpEnabled,
      connectedToolCount: mcpToolCount,
      promptChars: input.mcpPrompt?.length ?? 0,
    },
    providerNative: {
      supported: input.nativeToolSupport.supported,
      reason: input.nativeToolSupport.reason,
      target: input.providerToolContext?.adapter.target,
      declaredToolCount,
      skippedToolCount: input.providerToolContext?.adapter.skipped.length ?? 0,
      maxToolCallsPerStep: input.providerToolContext?.limits.maxToolCallsPerStep,
      compatibilityId: input.nativeToolSupport.compatibilityId,
      auditState: input.nativeToolSupport.auditState,
    },
    structuredOutput,
    redaction: {
      applied: true,
      strategy: 'runtime-log-redaction-v1',
    },
  }
}

export function emitToolCallingGatewayOutcome(input: BuildToolCallingGatewayOutcomeInput): ToolCallingGatewayOutcome {
  const outcome = buildToolCallingGatewayOutcome(input)
  void emitRuntimeEvent({
    event: 'tool.gateway.outcome',
    conversationId: outcome.conversationId,
    providerId: outcome.providerId,
    model: outcome.model,
    data: { ...outcome },
    legacyData: {
      conversationId: outcome.conversationId,
      providerId: outcome.providerId,
      model: outcome.model,
      status: outcome.status,
      mcpToolCount: outcome.mcp.connectedToolCount,
      providerNativeSupported: outcome.providerNative.supported,
      providerNativeReason: outcome.providerNative.reason,
      providerDeclaredToolCount: outcome.providerNative.declaredToolCount,
      structuredOutputRequested: outcome.structuredOutput.requested,
      structuredOutputSupported: outcome.structuredOutput.supported,
      structuredOutputRequestShape: outcome.structuredOutput.requestShape,
      structuredOutputBlocked: outcome.structuredOutput.blocked,
    },
    options: input.runtimeLog,
  })
  return outcome
}

export function buildToolCallingGatewayTrace(outcome: ToolCallingGatewayOutcome): ProcessTrace {
  const now = Date.now()
  return {
    id: `tool-gateway-${outcome.providerId}-${outcome.model}`,
    type: 'tool',
    title: 'Tool calling gateway',
    content: [
      `MCP prompt tools: ${outcome.mcp.connectedToolCount}.`,
      `Provider-native declarations: ${outcome.providerNative.declaredToolCount}.`,
      outcome.providerNative.supported ? '' : `Provider-native reason: ${outcome.providerNative.reason ?? 'not_supported'}.`,
      outcome.structuredOutput.requested
        ? `Structured output: ${outcome.structuredOutput.requestShape ?? 'requested'}${outcome.structuredOutput.blocked ? ' blocked' : ''}.`
        : '',
    ].filter(Boolean).join('\n'),
    status: outcome.status === 'ready' ? 'done' : 'skipped',
    startedAt: now,
    completedAt: now,
    metadata: {
      schema: outcome.schema,
      status: outcome.status,
      providerId: outcome.providerId,
      providerType: outcome.providerType,
      model: outcome.model,
      mcpEnabled: outcome.mcp.enabled,
      mcpToolCount: outcome.mcp.connectedToolCount,
      mcpPromptChars: outcome.mcp.promptChars,
      providerNativeSupported: outcome.providerNative.supported,
      providerNativeReason: outcome.providerNative.reason,
      providerNativeTarget: outcome.providerNative.target,
      providerDeclaredToolCount: outcome.providerNative.declaredToolCount,
      providerSkippedToolCount: outcome.providerNative.skippedToolCount,
      maxToolCallsPerStep: outcome.providerNative.maxToolCallsPerStep,
      compatibilityId: outcome.providerNative.compatibilityId,
      auditState: outcome.providerNative.auditState,
      structuredOutputRequested: outcome.structuredOutput.requested,
      structuredOutputType: outcome.structuredOutput.requestType,
      structuredOutputName: outcome.structuredOutput.name,
      structuredOutputSchemaProvided: outcome.structuredOutput.schemaProvided,
      structuredOutputStrictRequested: outcome.structuredOutput.strictRequested,
      structuredOutputSupported: outcome.structuredOutput.supported,
      structuredOutputRequestShape: outcome.structuredOutput.requestShape,
      structuredOutputJsonObjectMode: outcome.structuredOutput.jsonObjectMode,
      structuredOutputStrictJsonSchema: outcome.structuredOutput.strictJsonSchema,
      structuredOutputBlocked: outcome.structuredOutput.blocked,
    },
  }
}

export function buildStructuredOutputGatewayPlan(input: {
  request?: ProviderStructuredOutputRequest
  routePlan?: ProviderStructuredOutputPlan
  requested?: boolean
}): ToolCallingGatewayStructuredOutput {
  const requested = Boolean(input.request ?? input.routePlan?.requested ?? input.requested)
  const schemaProvided = Boolean(input.request?.schema && typeof input.request.schema === 'object')
  return {
    requested,
    requestType: input.request?.type,
    name: input.request?.name?.trim() || undefined,
    schemaProvided,
    strictRequested: input.request?.strict,
    supported: input.routePlan?.supported,
    requestShape: input.routePlan?.requestShape,
    jsonObjectMode: input.routePlan?.jsonObjectMode,
    strictJsonSchema: input.routePlan?.strictJsonSchema,
    blocked: input.routePlan?.blocked,
  }
}
