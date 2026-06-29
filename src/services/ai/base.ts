import type { AIModel, Attachment, AIProvider, MessageCitation, MessageUsage, ProcessTrace, ProviderModelTestCapabilityCheck, ProviderType, ReasoningEffort, RetrievalSource, WebSearchMode } from '@/types'
import { getModelConfig, getProviderConfigIssue } from '@/types'
import { st } from '@/i18n/service'
import { getSecureApiKey } from './secureKey'
import { chooseCredentialForModel, findCredentialGroupIdForKey, runCredentialGroupModelSync } from './providerCredentials'
import { modelDisallowsAnthropicSampling } from '@/utils/modelReasoning'
import { evaluatePayloadRules } from '@/services/ai/policy/payloadRules'
import { resolveProxyPolicy } from '@/services/ai/policy/proxyPolicy'
import { mergeRuntimeAliasAccessPolicy, resolveProviderModelAccess, resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'
import { ProviderHttpError, classifyHttpStatus, failure, formatProviderHttpError, providerFetchFailure, success, type ProviderOperationResult } from '@/services/ai/providerOperationResult'
import { selectUpstreamTransport } from '@/services/ai/transport/transportSelector'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import type { ProviderConformanceResult, ProviderStructuredOutputRequest } from '@/services/ai/providerConformance'
import { resolveProviderCapabilityManifest, resolveProviderRequestConformance, supportsNativeProviderTools } from '@/services/ai/providerConformance'
import type { ProviderRouteContext } from '@/services/ai/providerRouter'
import { resolveProviderRoute } from '@/services/ai/providerRouter'

export type { ProviderOperationResult } from '@/services/ai/providerOperationResult'
import type { ProviderFailoverInput } from '@/services/ai/providerFailover'
import {
  defaultOpenAICompatibleBaseUrl,
  getProviderApiEndpoint,
  normalizeProviderBaseUrl,
  resolveProviderEndpoint,
} from '@/services/ai/providerRouteAssembly'
import {
  fetchProviderModelConfigsFromRemote,
  getXiaomiMimoModelDiscoveryProvider,
  mapAnthropicModels,
  type AnthropicModelListItem,
} from '@/services/ai/providerModelDiscovery'
import { toAnthropicContentBlocks, toGoogleContentParts, toTextContent } from '@/services/ai/providerContentParts'
import { normalizeAnthropicThinking } from '@/services/ai/providerAnthropicThinking'
import { anthropicAttachmentPart, anthropicNativeWebSearchTool } from '@/services/ai/providerAnthropicRequest'
import { sanitizeAnthropicReplayContentBlocks } from '@/services/ai/providerAnthropicReplay'
import { rectifyAnthropicRequestBody } from '@/services/ai/providerAnthropicRectification'
import { optimizeRequestBody as optimizeProviderRequestBody } from '@/services/ai/providerRequestOptimization'
import type { ProviderRuntimeError } from '@/services/ai/providerRuntimeResult'
import { fetchChatStreamWithTimeout, fetchWithTimeout, safeResponseText } from '@/services/ai/providerHttp'
import { stringValue } from '@/services/ai/providerJsonUtils'
import { parseProviderNonStreamingText } from '@/services/ai/providerResponseParsing'
import { extractAnthropicText, extractGoogleText } from '@/services/ai/providerResponseText'
import { mergeProviderToolDeclarations } from '@/services/ai/providerToolDeclarations'
import { cloneOpenAIResponsesInputItems, hasOpenAIResponsesFunctionCallItem, toOpenAIChatToolCall, toOpenAIResponsesFunctionCallInput } from '@/services/ai/providerToolReplay'
import type { ProviderToolCall } from '@/services/ai/providerToolCalls'
import { providerStructuredOutputToolName, providerStructuredOutputToolSchema } from '@/services/ai/providerStructuredOutput'
import { parseProviderStreamChunk, parseProviderStreamEvent, type ParsedStreamChunk } from '@/services/ai/providerStreamParsing'
import { getModelTestMaxTokens, getModelTestReasoningEffort, reduceModelTestBody } from '@/services/ai/providerModelTest'
import { buildProviderProtocolBody, resolveProviderProtocolAdapter } from '@/services/ai/providerProtocolAdapter'
import { prepareProviderRuntimePipeline, prepareHttpJsonRequest } from '@/services/ai/providerRuntimePipeline'
import { emitProviderRuntimeGatewayOutcome } from '@/services/ai/providerRuntimeGateway'
import { executeProviderRuntimeChat, fetchChatStreamWithRetry, rectifyOpenAICompatibleRequestBody, rectifyXiaomiMimoThinkingRequestBody, rectifyXiaomiMimoWebSearchRequestBody, resolveRuntimeFallbackPlan, type RuntimeFallbackPlanInput } from '@/services/ai/providerRuntimeExecutor'
import { fallbackModel, pickEmbeddingModel } from '@/services/ai/providerDefaultModels'
import { arrayBufferToBase64 } from '@/services/ai/providerBinaryUtils'
import { getHeaders } from '@/services/ai/providerHeaders'
import { getHostedProviderSupportIssue } from '@/services/ai/providerHostedBoundary'
import { getWireProviderType } from '@/services/ai/providerWireProtocol'
import { clampMaxTokens, isXiaomiMimoThinkingActive, normalizeXiaomiMimoThinking, resolveProviderRequestParameters } from '@/services/ai/providerRequestParameters'
import { isKimiSamplingLocked, normalizeDashScopeThinking, normalizeDeepSeekThinking, normalizeKimiPreservedThinking, normalizeKimiThinking, normalizeMiniMaxThinking, normalizeSiliconFlowThinking, shouldRequestMiniMaxReasoningSplit } from '@/services/ai/providerOpenAICompatibleThinking'
import { normalizeGoogleThinkingConfig } from '@/services/ai/providerGoogleThinking'
import { googleAttachmentPart, googleNativeWebSearchTool } from '@/services/ai/providerGoogleRequest'
import { buildOpenAIResponsesReasoning, getOpenAIChatMaxTokensField, normalizeOpenAIReasoningEffort, openAICompatibleAttachmentPart, openAICompatibleReasoningReplayField, openAIResponsesAttachmentPart, openAIResponsesNativeWebSearchTool, shouldIncludeOpenAIResponsesEncryptedReasoning, usesOpenAIResponses, xiaomiMimoNativeWebSearchTool } from '@/services/ai/providerOpenAIRequest'
import { getProviderModelCapabilityStatus, providerModelCapabilityCanBeSent, type ProviderModelCapabilityKey } from '@/services/ai/providerCapabilityMatrix'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'
import { providerSupportsNativeSearch } from '@/services/chatProviderNativeToolUtils'
import { filterSendableAttachments } from '@/services/attachmentContract'

export type StreamCallback = (chunk: string) => void
export type DoneCallback = (result: ChatCompletionResult) => void
export type CitationCallback = (citations: MessageCitation[]) => void
export type TraceCallback = (trace: ProcessTrace) => void
export type ErrorCallback = (error: Error) => void
export type { ProviderToolCall } from '@/services/ai/providerToolCalls'

export interface ProviderModelTestResult {
  requestedModel: string
  upstreamModel: string
  usesResponsesApi: boolean
  checkParameters: boolean
  capabilityChecks: ProviderModelTestCapabilityCheck[]
}

export type { ProviderRuntimeError } from '@/services/ai/providerRuntimeResult'

export interface ChatCompletionResult {
  text: string
  usage?: MessageUsage
  citations?: MessageCitation[]
  traces?: ProcessTrace[]
  providerToolCalls?: ProviderToolCall[]
  reasoningContent?: string
  responseItems?: Record<string, unknown>[]
  providerContentBlocks?: Record<string, unknown>[]
  credentialGroupId?: string
  responseId?: string
  remoteCompactFallbackUsed?: boolean
  remoteCompactFallbackReason?: string
}

export interface StreamHandle {
  controller: AbortController
  done: Promise<void>
}

export interface EmbeddingResult {
  embedding: number[]
  source: 'provider'
  model: string
}

export interface ChatRequest {
  provider: AIProvider
  model: string
  messages: {
    role: 'user' | 'assistant' | 'tool'
    content: string | ContentPart[]
    reasoningContent?: string
    responseItems?: Record<string, unknown>[]
    providerContentBlocks?: Record<string, unknown>[]
    toolCallId?: string
    name?: string
    toolCalls?: ProviderToolCall[]
  }[]
  systemPrompt?: string
  temperature?: number
  topP?: number
  topK?: number
  reasoningEffort?: ReasoningEffort
  maxTokens?: number
  attachments?: Attachment[]
  contextPrompt?: string
  retrievalSources?: RetrievalSource[]
  webSearchMode?: WebSearchMode
  stream?: boolean
  signal?: AbortSignal
  conversationId?: string
  sessionId?: string
    settings?: {
    transportMode?: 'auto' | 'http' | 'websocket'
    payloadPolicyMode?: 'off' | 'warn' | 'block'
    proxyMode?: 'off' | 'custom-base-url' | 'system-detected'
    proxyBaseUrl?: string
    providerAllowlist?: string[]
    providerBlocklist?: string[]
    modelAllowlist?: string[]
    modelBlocklist?: string[]
    runtimeLogEnabled?: boolean
    runtimeLogMaxBytes?: number
    sessionConcurrencyLimit?: number
    sessionQueueTimeoutMs?: number
    sessionAffinityEnabled?: boolean
    sessionAffinityTtlMs?: number
      remoteCompactMode?: 'off' | 'auto' | 'required'
      remoteCompactThreshold?: number
      remoteCompactThresholdTokens?: number
      upstreamRequestTimeoutMs?: number
    upstreamMaxRetries?: number
    upstreamCircuitBreakerEnabled?: boolean
    upstreamCircuitBreakerFailureThreshold?: number
    upstreamCircuitBreakerCooldownMs?: number
    requestRectificationEnabled?: boolean
    anthropicThinkingSignatureRectificationEnabled?: boolean
    anthropicThinkingBudgetRectificationEnabled?: boolean
    bedrockRequestOptimizerEnabled?: boolean
    thinkingOptimizerEnabled?: boolean
    cacheInjectionEnabled?: boolean
    cacheTtl?: 'default' | '5m' | '1h'
    modelTestModel?: string
    modelTestCheckParameters?: boolean
  }
  remoteCompactEligible?: boolean
  remoteCompactFallback?: {
    messages: { role: 'user' | 'assistant'; content: string }[]
    contextPrompt: string
    trace?: Record<string, unknown>
  }
  previousResponseId?: string
  requestedModel?: string
  fallbackProviders?: AIProvider[]
  providerToolDeclarations?: readonly unknown[]
  structuredOutput?: ProviderStructuredOutputRequest
}

export interface ProviderAudioTranscriptionRequest {
  provider: AIProvider
  audioBase64: string
  mimeType: string
  fileName?: string
  model?: string
}

export interface ProviderSpeechRequest {
  provider: AIProvider
  text: string
  model?: string
  voice?: string
}

export interface ContentPart {
  type: 'text' | 'function_call' | 'function_response' | 'tool_use' | 'tool_result'
  text: string
  functionCall?: Record<string, unknown>
  functionResponse?: Record<string, unknown>
  toolUse?: Record<string, unknown>
  toolResult?: Record<string, unknown>
  thoughtSignature?: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: {
    url: string
    detail?: 'auto' | 'high' | 'low'
  }
}

export { getSecureApiKey }

const PROVIDER_REQUEST_TIMEOUT_MS = 18000
const MODEL_TEST_TIMEOUT_MS = 22000
const CHAT_REQUEST_TIMEOUT_MS = 60000

export function buildOpenAIBodyForTest(req: ChatRequest) {
  return buildOpenAIBody(req)
}

export function buildGoogleBodyForTest(req: ChatRequest) {
  return buildGoogleBody(req)
}

export function buildAnthropicBodyForTest(req: ChatRequest) {
  return buildAnthropicBody(req)
}

export function buildOpenAIResponsesBodyForTest(req: ChatRequest) {
  return buildOpenAIResponsesBody(req)
}

export function getAPIEndpointForTest(provider: AIProvider) {
  return getProviderApiEndpoint(provider)
}

export function getXiaomiMimoModelDiscoveryEndpointForTest(provider: AIProvider) {
  return `${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(getXiaomiMimoModelDiscoveryProvider(provider)))}/models`
}

export function parseProviderStreamChunkForTest(chunk: string, providerType: ProviderType) {
  return parseProviderStreamChunk(chunk, providerType)
}

export function parseProviderStreamEventForTest(event: unknown, providerType: ProviderType) {
  return parseProviderStreamEvent(event, providerType)
}

export function evaluatePayloadRulesForTest(input: Parameters<typeof evaluatePayloadRules>[0]) {
  return evaluatePayloadRules(input)
}

export function selectUpstreamTransportForTest(input: Parameters<typeof selectUpstreamTransport>[0]) {
  return selectUpstreamTransport(input)
}

export function resolveProviderModelAccessForTest(input: Parameters<typeof resolveProviderModelAccess>[0]) {
  return resolveProviderModelAccess(input)
}

export function resolveProviderModelAliasAccessForTest(input: Parameters<typeof resolveProviderModelAliasAccess>[0]) {
  return resolveProviderModelAliasAccess(input)
}

export function mergeAliasAccessPolicyForTest(
  requested: ReturnType<typeof resolveProviderModelAccess>,
  upstream: ReturnType<typeof resolveProviderModelAccess>
) {
  return mergeRuntimeAliasAccessPolicy(requested, upstream)
}

export function resolveProxyPolicyForTest(input: Parameters<typeof resolveProxyPolicy>[0]) {
  return resolveProxyPolicy(input)
}

export function resolveProviderProtocolAdapterForTest(req: ChatRequest) {
  return resolveProviderProtocolAdapter(req)
}

export function optimizeRequestBodyForTest(body: Record<string, unknown>, req: ChatRequest) {
  return optimizeRequestBody(body, req)
}

export function fetchChatStreamWithRetryForTest(input: Parameters<typeof fetchChatStreamWithRetry>[0]) {
  return fetchChatStreamWithRetry(input)
}

export function rectifyAnthropicRequestBodyForTest(input: Parameters<typeof rectifyAnthropicRequestBody>[0]) {
  return rectifyAnthropicRequestBody(input)
}

export function rectifyXiaomiMimoThinkingRequestBodyForTest(input: Parameters<typeof rectifyXiaomiMimoThinkingRequestBody>[0]) {
  return rectifyXiaomiMimoThinkingRequestBody(input)
}

export function rectifyXiaomiMimoWebSearchRequestBodyForTest(input: Parameters<typeof rectifyXiaomiMimoWebSearchRequestBody>[0]) {
  return rectifyXiaomiMimoWebSearchRequestBody(input)
}

export function rectifyOpenAICompatibleRequestBodyForTest(input: Parameters<typeof rectifyOpenAICompatibleRequestBody>[0]) {
  return rectifyOpenAICompatibleRequestBody(input)
}

export function getBodyForTest(req: ChatRequest) {
  return getBody(req)
}

export function resolveProviderRequestConformanceForTest(req: ChatRequest, body: Record<string, unknown>) {
  return resolveProviderRequestConformance(req, body)
}

export function resolveProviderRouteForTest(req: ChatRequest, body: Record<string, unknown>, context?: ProviderRouteContext) {
  return resolveProviderRoute({ request: req, body, context })
}

export function resolveRuntimeFallbackPlanForTest(input: RuntimeFallbackPlanInput) {
  return resolveRuntimeFallbackPlan(input)
}

export function parseAnthropicModelsForTest(models: AnthropicModelListItem[]): AIModel[] {
  return mapAnthropicModels({ data: models })
}

export function formatProviderHttpErrorForTest(status: number, responseText = '', provider?: AIProvider, model = ''): string {
  return formatProviderHttpError(status, responseText, provider, model)
}

function buildOpenAIBody(req: ChatRequest) {
  const msgs: Record<string, unknown>[] = []

  const systemPrompt = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n')
  if (systemPrompt) {
    msgs.push({ role: 'system', content: systemPrompt })
  }

  for (const msg of req.messages) {
    const content = toTextContent(msg.content)
    if (msg.role === 'tool') {
      msgs.push({
        role: 'tool',
        tool_call_id: msg.toolCallId,
        ...(msg.name ? { name: msg.name } : {}),
        content,
      })
      continue
    }
    const reasoningReplayField = msg.role === 'assistant' && msg.reasoningContent
      ? openAICompatibleReasoningReplayField(req, msg)
      : undefined
    msgs.push({
      role: msg.role,
      content,
      ...(reasoningReplayField ? { [reasoningReplayField]: msg.reasoningContent } : {}),
      ...(msg.toolCalls?.length ? { tool_calls: msg.toolCalls.map(toOpenAIChatToolCall) } : {}),
    })
  }

  const sendableAttachments = contractSendableAttachments(req)
  if (sendableAttachments.length) {
    const lastMsg = msgs[msgs.length - 1]
    if (lastMsg && lastMsg.role === 'user') {
      const content = lastMsg.content
      const textContent =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content.map((p: ContentPart) => p.text).join('\n')
            : ''
      lastMsg.content = [
        { type: 'text', text: textContent },
        ...sendableAttachments.map((attachment) => openAICompatibleAttachmentPart(attachment, req.provider)),
      ]
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages: msgs,
    stream: req.stream ?? true,
  }
  const mimoNativeWebSearchTool = req.provider.type === 'xiaomi-mimo' && req.webSearchMode === 'native' && providerSupportsNativeSearch(req.provider)
    ? xiaomiMimoNativeWebSearchTool(req.model)
    : undefined
  const declaredProviderTools = contractProviderToolDeclarations(req)
  const providerTools = mergeProviderToolDeclarations(
    declaredProviderTools,
    mimoNativeWebSearchTool ? [mimoNativeWebSearchTool] : []
  )
  if (providerTools) body.tools = providerTools
  if (mimoNativeWebSearchTool) body.tool_choice = 'auto'
  const chatManifest = resolveProviderCapabilityManifest(req)
  if ((req.stream ?? true) !== false && chatManifest.payload.streamUsageField === 'stream_options.include_usage') {
    body.stream_options = { include_usage: true }
  }
  const responseFormat = buildOpenAICompatibleStructuredOutputFormat(req)
  if (responseFormat) body.response_format = responseFormat

  const deepSeekThinking = normalizeDeepSeekThinking(req)
  const dashScopeThinking = normalizeDashScopeThinking(req)
  const siliconFlowThinking = normalizeSiliconFlowThinking(req)
  const kimiThinking = normalizeKimiThinking(req)
  const miniMaxThinking = normalizeMiniMaxThinking(req)
  const mimoThinking = normalizeXiaomiMimoThinking(req)
  const kimiSamplingLocked = isKimiSamplingLocked(req)
  const compatibleReasoningEnabled =
    deepSeekThinking?.type === 'enabled' ||
    dashScopeThinking?.enabled === true ||
    siliconFlowThinking !== undefined ||
    kimiThinking?.type === 'enabled' ||
    kimiSamplingLocked ||
    isXiaomiMimoThinkingActive(req)
  const maxTokensKey = getOpenAIChatMaxTokensField(req)
  const requestParameters = resolveProviderRequestParameters(req, {
    omitSampling: compatibleReasoningEnabled,
    maxTokenParameterNames: [maxTokensKey],
  })
  if (requestParameters.temperature !== undefined) {
    body.temperature = requestParameters.temperature
  }
  if (requestParameters.topP !== undefined) body.top_p = requestParameters.topP
  if (requestParameters.topK !== undefined) body.top_k = requestParameters.topK
  if (deepSeekThinking) {
    body.thinking = { type: deepSeekThinking.type }
    if (deepSeekThinking.effort) body.reasoning_effort = deepSeekThinking.effort
  } else {
    if (dashScopeThinking) {
      body.enable_thinking = dashScopeThinking.enabled
      if (dashScopeThinking.budget !== undefined) body.thinking_budget = dashScopeThinking.budget
    }
    if (siliconFlowThinking) body.thinking_budget = siliconFlowThinking.budget
    const kimiPreservedThinking = normalizeKimiPreservedThinking(req, kimiThinking)
    if (kimiPreservedThinking) body.thinking = kimiPreservedThinking
    else if (kimiThinking) body.thinking = kimiThinking
    if (miniMaxThinking) body.thinking = miniMaxThinking
    if (shouldRequestMiniMaxReasoningSplit(req, miniMaxThinking)) body.reasoning_split = true
    const openAIEffort = normalizeOpenAIReasoningEffort(req)
    if (openAIEffort) body.reasoning_effort = openAIEffort
    if (mimoThinking) body.thinking = mimoThinking
  }

  if (requestParameters.maxTokens !== undefined) body[maxTokensKey] = requestParameters.maxTokens

  return body
}

function buildOpenAICompatibleStructuredOutputFormat(req: ChatRequest): Record<string, unknown> | undefined {
  const structuredOutput = req.structuredOutput
  if (!structuredOutput) return undefined
  if (!requestModelCapabilityCanBeSent(req, 'responseFormat')) return undefined
  const manifest = resolveProviderCapabilityManifest(req)
  if (!manifest.structuredOutput.appRequestControl) return undefined
  if (
    manifest.structuredOutput.documentedRequestShape !== 'openai-response-format' &&
    manifest.structuredOutput.documentedRequestShape !== 'openai-json-object-response-format' &&
    manifest.structuredOutput.documentedRequestShape !== 'openrouter-response-format' &&
    manifest.structuredOutput.documentedRequestShape !== 'xai-response-format'
  ) return undefined
  if (manifest.structuredOutput.documentedRequestShape === 'xai-response-format') {
    return buildXAIResponseFormat(structuredOutput)
  }
  if (structuredOutput.type === 'json_object') return { type: 'json_object' }
  if (manifest.structuredOutput.documentedRequestShape === 'openai-json-object-response-format') return undefined
  if (!structuredOutput.schema) return undefined
  const jsonSchema: Record<string, unknown> = {
    name: structuredOutput.name?.trim() || 'islemind_response',
    schema: structuredOutput.schema,
  }
  if (structuredOutput.strict === true && manifest.structuredOutput.strictJsonSchema) {
    jsonSchema.strict = true
  }
  return {
    type: 'json_schema',
    json_schema: jsonSchema,
  }
}

function buildOpenAIResponsesTextConfig(req: ChatRequest): Record<string, unknown> | undefined {
  const structuredOutput = req.structuredOutput
  if (!structuredOutput) return undefined
  if (!requestModelCapabilityCanBeSent(req, 'responseFormat')) return undefined
  if (req.provider.type === 'openai-compatible' && !modelDeclaresResponsesTextFormat(req)) return undefined
  const manifest = resolveProviderCapabilityManifest(req)
  if (!manifest.structuredOutput.appRequestControl) return undefined
  if (manifest.family === 'ollama') return undefined
  if (
    manifest.structuredOutput.documentedRequestShape !== 'openai-response-format' &&
    manifest.structuredOutput.documentedRequestShape !== 'openai-json-object-response-format'
  ) return undefined
  if (structuredOutput.type === 'json_object') return { format: { type: 'json_object' } }
  if (manifest.structuredOutput.documentedRequestShape === 'openai-json-object-response-format') return undefined
  if (!structuredOutput.schema) return undefined
  const format: Record<string, unknown> = {
    type: 'json_schema',
    name: structuredOutput.name?.trim() || 'islemind_response',
    schema: structuredOutput.schema,
  }
  if (structuredOutput.strict === true && manifest.structuredOutput.strictJsonSchema) {
    format.strict = true
  }
  return { format }
}

function modelDeclaresResponsesTextFormat(req: ChatRequest): boolean {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return modelConfig.supportedParameters?.some((item) => item.toLowerCase() === 'text.format') === true
}

function buildXAIResponseFormat(structuredOutput: ProviderStructuredOutputRequest): Record<string, unknown> | undefined {
  if (structuredOutput.type === 'json_object') return { type: 'json_object' }
  if (!structuredOutput.schema) return undefined
  return {
    type: 'json_schema',
    json_schema: {
      name: structuredOutput.name?.trim() || 'islemind_response',
      schema: structuredOutput.schema,
    },
  }
}

function buildOpenAIResponsesResponseFormat(req: ChatRequest): Record<string, unknown> | undefined {
  const structuredOutput = req.structuredOutput
  if (!structuredOutput) return undefined
  if (!requestModelCapabilityCanBeSent(req, 'responseFormat')) return undefined
  const manifest = resolveProviderCapabilityManifest(req)
  if (!manifest.structuredOutput.appRequestControl) return undefined
  if (manifest.structuredOutput.documentedRequestShape === 'xai-response-format') return buildXAIResponseFormat(structuredOutput)
  if (manifest.structuredOutput.documentedRequestShape === 'openrouter-response-format') return buildOpenAICompatibleStructuredOutputFormat(req)
  return undefined
}

function buildXiaomiMimoAnthropicBody(req: ChatRequest) {
  return buildAnthropicBody({ ...req, stream: req.stream ?? true })
}

function contractSendableAttachments(req: ChatRequest): Attachment[] {
  const manifest = resolveProviderCapabilityManifest(req)
  return filterSendableAttachments(req.attachments).filter((attachment) => {
    if (attachment.type === 'image') {
      return manifest.modalities.input.image && requestModelCapabilityCanBeSent(req, 'vision')
    }
    return manifest.modalities.input.file && requestModelCapabilityCanBeSent(req, 'files')
  })
}

function contractProviderToolDeclarations(req: ChatRequest): readonly unknown[] | undefined {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return supportsNativeProviderTools(req.provider, modelConfig) && requestModelCapabilityCanBeSent(req, 'tools')
    ? req.providerToolDeclarations
    : undefined
}

function requestModelCapabilityCanBeSent(req: ChatRequest, capability: ProviderModelCapabilityKey): boolean {
  if (req.provider.type !== 'openai-compatible') return true
  if (req.provider.wireProtocol === 'anthropic-compatible') return true
  return providerModelCapabilityCanBeSent(req.provider, req.model, capability)
}

const PROVIDER_MODEL_TEST_CAPABILITIES: ProviderModelCapabilityKey[] = [
  'chat',
  'streaming',
  'tools',
  'vision',
  'files',
  'reasoning',
  'responseFormat',
  'responsesApi',
  'nativeSearch',
]

function buildProviderModelTestResult(input: {
  req: ChatRequest
  payload: Record<string, unknown>
  requestedModel: string
  upstreamModel: string
  usesResponsesApi: boolean
  checkParameters: boolean
}): ProviderModelTestResult {
  return {
    requestedModel: input.requestedModel,
    upstreamModel: input.upstreamModel,
    usesResponsesApi: input.usesResponsesApi,
    checkParameters: input.checkParameters,
    capabilityChecks: PROVIDER_MODEL_TEST_CAPABILITIES.map((capability) => {
      const sent = providerModelTestCapabilityWasSent(capability, input.payload, input.usesResponsesApi)
      const canSend = providerModelCapabilityCanBeSent(input.req.provider, input.req.model, capability)
      const evidence = getProviderModelCapabilityStatus(input.req.provider, input.req.model, capability)
      return {
        capability,
        status: sent ? 'sent' : canSend ? 'available' : 'blocked',
        sent,
        canSend,
        ...(evidence ? { evidence: { status: evidence.status, source: evidence.source, reason: evidence.reason } } : {}),
      }
    }),
  }
}

function providerModelTestCapabilityWasSent(
  capability: ProviderModelCapabilityKey,
  payload: Record<string, unknown>,
  usesResponsesApi: boolean
): boolean {
  switch (capability) {
    case 'chat':
      return payloadHasAnyKey(payload, ['messages', 'input', 'contents'])
    case 'streaming':
      return payload.stream === true
    case 'tools':
      return payloadHasAnyKey(payload, ['tools', 'functions'])
    case 'vision':
      return payloadHasAnyKey(payload, ['image_url', 'input_image', 'inline_data'])
    case 'files':
      return payloadHasAnyKey(payload, ['file_data', 'input_file', 'file_id', 'document'])
    case 'reasoning':
      return payloadHasAnyKey(payload, ['reasoning', 'reasoning_effort', 'thinking', 'thinkingConfig', 'thinkingBudget', 'thinkingLevel', 'includeThoughts'])
    case 'responseFormat':
      return payloadHasResponseFormat(payload)
    case 'responsesApi':
      return usesResponsesApi
    case 'nativeSearch':
      return payloadHasNativeSearchTool(payload)
  }
}

function payloadHasResponseFormat(payload: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(payload, 'response_format')) return true
  const text = payload.text
  return isPlainRecord(text) && Object.prototype.hasOwnProperty.call(text, 'format')
}

function payloadHasNativeSearchTool(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(payloadHasNativeSearchTool)
  if (!isPlainRecord(value)) return false
  if (Object.prototype.hasOwnProperty.call(value, 'google_search')) return true
  if (Object.prototype.hasOwnProperty.call(value, 'web_search_options')) return true
  const type = typeof value.type === 'string' ? value.type.toLowerCase() : ''
  if (['web_search', 'web_search_preview'].includes(type)) return true
  return Object.values(value).some(payloadHasNativeSearchTool)
}

function payloadHasAnyKey(value: unknown, keys: string[]): boolean {
  if (Array.isArray(value)) return value.some((item) => payloadHasAnyKey(item, keys))
  if (!isPlainRecord(value)) return false
  if (keys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) return true
  return Object.values(value).some((item) => payloadHasAnyKey(item, keys))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function buildAnthropicBody(req: ChatRequest) {
  const system = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n') || undefined
  const messages: Record<string, unknown>[] = []
  const sendableAttachments = contractSendableAttachments(req)
  const thinkingConfig = normalizeAnthropicThinking(req)
  const miniMaxThinking = normalizeMiniMaxThinking(req)
  const mimoThinking = normalizeXiaomiMimoThinking(req)
  const samplingDisallowed = Boolean(thinkingConfig) || isXiaomiMimoThinkingActive(req) || modelDisallowsAnthropicSampling(req.model)
  const requestParameters = resolveProviderRequestParameters(req, {
    omitSampling: samplingDisallowed,
    includeDefaultTopP: true,
    maxTokenParameterNames: ['max_tokens'],
  })

  for (const msg of req.messages) {
    if (msg.role === 'user') {
      const content = toAnthropicContentBlocks(msg.content)

      if (sendableAttachments.length && msg === req.messages[req.messages.length - 1]) {
        for (const att of sendableAttachments) {
          const part = anthropicAttachmentPart(att)
          if (part) content.push(part)
        }
      }

      messages.push({ role: 'user', content })
    } else if (msg.role === 'assistant') {
      const content = [
        ...sanitizeAnthropicReplayContentBlocks(msg.providerContentBlocks ?? []),
        ...toAnthropicContentBlocks(msg.content),
      ]
      messages.push({
        role: 'assistant',
        content: !msg.providerContentBlocks?.length && content.length === 1 && content[0].type === 'text'
          ? stringValue(content[0].text)
          : content,
      })
    }
  }

  const declaredProviderTools = contractProviderToolDeclarations(req)
  const nativeWebSearchTools = req.webSearchMode === 'native' && req.provider.type !== 'xiaomi-mimo' && providerSupportsNativeSearch(req.provider)
    ? [anthropicNativeWebSearchTool(req.model)]
    : []
  const structuredOutputTool = buildAnthropicStructuredOutputTool(req)
  const builtInTools = [
    ...nativeWebSearchTools,
    ...(structuredOutputTool ? [structuredOutputTool] : []),
  ]
  const tools = mergeProviderToolDeclarations(
    declaredProviderTools,
    builtInTools
  )
  const body: Record<string, unknown> = {
    model: req.model,
    system,
    messages,
    stream: req.stream ?? true,
    ...(tools ? { tools } : {}),
  }
  if (requestParameters.maxTokens !== undefined) body.max_tokens = requestParameters.maxTokens
  if (structuredOutputTool) body.tool_choice = { type: 'tool', name: structuredOutputTool.name }
  if (requestParameters.temperature !== undefined) body.temperature = requestParameters.temperature
  if (requestParameters.topP !== undefined) body.top_p = requestParameters.topP
  if (requestParameters.topK !== undefined) body.top_k = requestParameters.topK
  if (thinkingConfig?.thinking) body.thinking = thinkingConfig.thinking
  if (thinkingConfig?.outputConfig) body.output_config = thinkingConfig.outputConfig
  if (miniMaxThinking) body.thinking = miniMaxThinking
  if (mimoThinking) body.thinking = mimoThinking
  return body
}

function buildAnthropicStructuredOutputTool(req: ChatRequest): Record<string, unknown> | undefined {
  const inputSchema = providerStructuredOutputToolSchema(req.structuredOutput)
  if (!inputSchema) return undefined
  const manifest = resolveProviderCapabilityManifest(req)
  if (!manifest.structuredOutput.appRequestControl || manifest.structuredOutput.documentedRequestShape !== 'anthropic-tool-schema') return undefined
  return {
    name: providerStructuredOutputToolName(req.structuredOutput),
    description: 'Return the final answer as structured JSON that matches this input schema.',
    input_schema: inputSchema,
  }
}

function buildGoogleBody(req: ChatRequest) {
  const contents: Record<string, unknown>[] = []
  const sendableAttachments = contractSendableAttachments(req)
  const systemPrompt = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n')
  const systemInstruction = systemPrompt
    ? { parts: [{ text: systemPrompt }] }
    : undefined

  for (const msg of req.messages) {
    const parts = toGoogleContentParts(msg.content)

    if (msg.role === 'user' && msg === req.messages[req.messages.length - 1] && sendableAttachments.length) {
      for (const att of sendableAttachments) {
        const part = googleAttachmentPart(att)
        if (part) parts.push(part)
      }
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    })
  }

  const requestParameters = resolveProviderRequestParameters(req, {
    includeDefaultTopP: true,
    maxTokenParameterNames: ['maxOutputTokens', 'generationConfig.maxOutputTokens'],
  })
  const generationConfig: Record<string, unknown> = {}
  if (requestParameters.maxTokens !== undefined) generationConfig.maxOutputTokens = requestParameters.maxTokens
  if (requestParameters.temperature !== undefined) generationConfig.temperature = requestParameters.temperature
  if (requestParameters.topP !== undefined) generationConfig.topP = requestParameters.topP
  if (requestParameters.topK !== undefined) generationConfig.topK = requestParameters.topK
  const thinkingConfig = normalizeGoogleThinkingConfig(req)
  if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig
  const structuredOutputConfig = buildGoogleStructuredOutputConfig(req)
  if (structuredOutputConfig) Object.assign(generationConfig, structuredOutputConfig)

  const tools = mergeProviderToolDeclarations(
    contractProviderToolDeclarations(req),
    req.webSearchMode === 'native' && providerSupportsNativeSearch(req.provider) ? [googleNativeWebSearchTool()] : []
  )
  return {
    contents,
    systemInstruction,
    generationConfig,
    ...(tools ? { tools } : {}),
  }
}

function buildGoogleStructuredOutputConfig(req: ChatRequest): Record<string, unknown> | undefined {
  const structuredOutput = req.structuredOutput
  if (!structuredOutput) return undefined
  const manifest = resolveProviderCapabilityManifest(req)
  if (!manifest.structuredOutput.appRequestControl || manifest.structuredOutput.documentedRequestShape !== 'google-response-schema') return undefined
  if (structuredOutput.type === 'json_object') return { responseMimeType: 'application/json' }
  if (!structuredOutput.schema) return undefined
  return {
    responseMimeType: 'application/json',
    responseSchema: structuredOutput.schema,
  }
}

function buildOpenAIResponsesBody(req: ChatRequest) {
  const input: Record<string, unknown>[] = []
  const sendableAttachments = contractSendableAttachments(req)
  const systemPrompt = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n')
  if (systemPrompt) {
    input.push({ role: 'system', content: systemPrompt })
  }
  for (const [index, message] of req.messages.entries()) {
    const text = typeof message.content === 'string' ? message.content : message.content.map((part) => part.text).join('\n')
    const isLast = index === req.messages.length - 1
    if (message.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: text,
      })
      continue
    }
    if (message.role === 'assistant' && (message.responseItems?.length || message.toolCalls?.length)) {
      if (text) input.push({ role: 'assistant', content: text })
      const responseItems = cloneOpenAIResponsesInputItems(message.responseItems ?? [])
      for (const [toolIndex, call] of (message.toolCalls ?? []).entries()) {
        if (!hasOpenAIResponsesFunctionCallItem(responseItems, call)) {
          responseItems.push(toOpenAIResponsesFunctionCallInput(call, toolIndex))
        }
      }
      input.push(...responseItems)
      continue
    }
    if (message.role === 'user' && isLast && sendableAttachments.length) {
      input.push({
        role: 'user',
        content: [
          { type: 'input_text', text },
          ...sendableAttachments.map(openAIResponsesAttachmentPart),
        ],
      })
    } else {
      input.push({ role: message.role, content: text })
    }
  }
  const openAIEffort = normalizeOpenAIReasoningEffort(req)
  const responsesReasoning = buildOpenAIResponsesReasoning(openAIEffort, req.provider)
  const includeEncryptedReasoning = shouldIncludeOpenAIResponsesEncryptedReasoning(req, openAIEffort)
  const responsesNativeWebSearchTool = req.webSearchMode === 'native' && requestModelCapabilityCanBeSent(req, 'nativeSearch')
    ? openAIResponsesNativeWebSearchTool(req.provider, req.model)
    : undefined
  const tools = mergeProviderToolDeclarations(
    contractProviderToolDeclarations(req),
    responsesNativeWebSearchTool ? [responsesNativeWebSearchTool] : []
  )
  const requestParameters = resolveProviderRequestParameters(req, {
    maxTokenParameterNames: ['max_output_tokens', 'maxOutputTokens'],
  })
  const textConfig = buildOpenAIResponsesTextConfig(req)
  const responseFormat = buildOpenAIResponsesResponseFormat(req)
  return {
    model: req.model,
    input,
    ...(requestParameters.temperature !== undefined ? { temperature: requestParameters.temperature } : {}),
    ...(requestParameters.topP !== undefined ? { top_p: requestParameters.topP } : {}),
    ...(textConfig ? { text: textConfig } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(responsesReasoning ? { reasoning: responsesReasoning } : {}),
    ...(includeEncryptedReasoning ? { include: ['reasoning.encrypted_content'] } : {}),
    ...(requestParameters.maxTokens !== undefined ? { max_output_tokens: requestParameters.maxTokens } : {}),
    stream: req.stream ?? true,
    ...(req.previousResponseId ? { previous_response_id: req.previousResponseId } : {}),
    ...(req.remoteCompactEligible
      ? {
        context_management: [{
          type: 'compaction',
          compact_threshold: req.settings?.remoteCompactThresholdTokens ?? 200000,
        }],
      }
      : {}),
    ...(tools ? { tools } : {}),
  }
}

function getBody(req: ChatRequest) {
  return getBodyWithRoute(req).body
}

function getBodyWithRoute(req: ChatRequest, context?: ProviderRouteContext, failover?: ProviderFailoverInput) {
  const { body } = buildProviderProtocolBody(req, {
    openAIChat: buildOpenAIBody,
    openAIResponses: buildOpenAIResponsesBody,
    anthropic: buildAnthropicBody,
    google: buildGoogleBody,
    xiaomiMimoAnthropic: buildXiaomiMimoAnthropicBody,
  })
  return resolveProviderRoute({ request: req, body, context, failover })
}

function optimizeRequestBody(body: Record<string, unknown>, req: ChatRequest): Record<string, unknown> {
  return optimizeProviderRequestBody(body, {
    provider: req.provider,
    model: req.model,
    reasoningEffort: req.reasoningEffort,
    settings: req.settings,
    fallbackMaxTokens: clampMaxTokens(req),
  })
}

export async function streamChat(
  req: ChatRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onCitations?: CitationCallback,
  onTrace?: TraceCallback
): Promise<StreamHandle> {
  const controller = new AbortController()
  const pipeline = await prepareProviderRuntimePipeline({
    req,
    controller,
    resolveRoute: getBodyWithRoute,
    onTrace,
    hasWebSocketRuntime: typeof WebSocket !== 'undefined',
  })
  emitProviderRuntimeGatewayOutcome({ result: pipeline, onTrace })
  if (pipeline.status === 'blocked') {
    const done = Promise.resolve().then(() => onError(pipeline.error))
    return { controller, done }
  }
  const done = executeProviderRuntimeChat({
    pipeline,
    controller,
    resolveRoute: getBodyWithRoute,
    onChunk,
    onDone,
    onError,
    onCitations,
    onTrace,
  })
  return { controller, done }
}

export async function generateText(req: ChatRequest): Promise<string> {
  let text = ''
  let failure: Error | null = null
  const handle = await streamChat(
    { ...req, stream: false },
    (chunk) => {
      text += chunk
    },
    (result) => {
      text = result.text || text
    },
    (error) => {
      failure = error
    }
  )
  await handle.done
  if (failure) throw failure
  return text
}

export async function testConnection(provider: AIProvider, apiKey: string): Promise<boolean> {
  const model = provider.models[0] || fallbackModel(provider.type)
  return testProviderModel(provider, model, apiKey)
}

export async function testProviderModel(provider: AIProvider, model: string, apiKey: string): Promise<boolean> {
  return (await testProviderModelDetailed(provider, model, apiKey)).ok
}

export async function testProviderModelDetailed(provider: AIProvider, model: string, apiKey: string, options: { checkParameters?: boolean; timeoutMs?: number } = {}): Promise<ProviderOperationResult<ProviderModelTestResult>> {
  const upstreamModel = resolveProviderModelAlias(provider, model)
  if (!apiKey.trim()) {
    return failure('missing_key', st('providerOperation.saveApiKeyFirst'))
  }
  const selected = chooseCredentialForModel(provider, model)
  const selectedGroupId = selected.apiKey === apiKey ? selected.credentialGroupId : findCredentialGroupIdForKey(provider, apiKey)
  const p = { ...provider, apiKey: apiKey.trim() }
  const issue = getProviderConfigIssue(p, apiKey)
  if (issue) {
    return failure<ProviderModelTestResult>(issue.code === 'bad_base_url' ? 'bad_base_url' : 'credential_mismatch', st(issue.messageKey ?? issue.message, undefined, issue.message))
  }
  const hostedIssue = getHostedProviderSupportIssue(p, 'chat')
  if (hostedIssue) {
    return failure<ProviderModelTestResult>('models_endpoint_unavailable', hostedIssue.message, undefined, selectedGroupId)
  }
  if (!upstreamModel.trim()) {
    return failure<ProviderModelTestResult>('model_unavailable', st('providerOperation.chooseModelFirst'))
  }

  let testData: ProviderModelTestResult | undefined
  try {
    const modelTestReasoningEffort = options.checkParameters === false ? undefined : getModelTestReasoningEffort(p, upstreamModel)
    const modelTestReq = {
      provider: p,
      model: upstreamModel,
      requestedModel: model,
      messages: [{ role: 'user' as const, content: '请只回复 OK' }],
      ...(modelTestReasoningEffort ? { reasoningEffort: modelTestReasoningEffort } : {}),
      maxTokens: getModelTestMaxTokens(p, upstreamModel, modelTestReasoningEffort),
      stream: false,
    }
    const usesResponsesApi = usesOpenAIResponses(modelTestReq)
    const url = resolveProviderEndpoint({
      provider: p,
      model: upstreamModel,
      stream: false,
      usesResponsesApi,
    })
    const headers = getHeaders(p)
    const routeResult = getBodyWithRoute(modelTestReq, {
        endpoint: url,
        transport: 'http',
        requestedTransportMode: 'http',
      })
    const rawBody = routeResult.body
    const payload = options.checkParameters === false ? reduceModelTestBody(rawBody) : rawBody
    testData = buildProviderModelTestResult({
      req: modelTestReq,
      payload,
      requestedModel: model,
      upstreamModel,
      usesResponsesApi,
      checkParameters: options.checkParameters !== false,
    })
    const prepared = prepareHttpJsonRequest({ provider: p, model: upstreamModel, url, headers, body: payload })

    const response = await fetchWithTimeout(prepared.url, { method: 'POST', headers: prepared.headers, body: prepared.body }, options.timeoutMs ?? MODEL_TEST_TIMEOUT_MS)
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      return failure(classifyHttpStatus(response.status, errorText, upstreamModel, provider), formatProviderHttpError(response.status, errorText, provider, model), testData, selectedGroupId)
    }
    const text = await parseProviderNonStreamingText(response, getWireProviderType(p))
    if (!text.trim()) {
      return failure('unknown', st('providerOperation.emptyModelResponse'), testData, selectedGroupId)
    }
    return success(st('providerOperation.modelTestPassed'), testData, selectedGroupId)
  } catch (error) {
    const result = providerFetchFailure<ProviderModelTestResult>(error, selectedGroupId)
    return testData ? { ...result, data: testData } : result
  }
}

export async function fetchProviderModelConfigs(provider: AIProvider, apiKey: string): Promise<AIModel[]> {
  const result = await fetchProviderModelConfigsDetailed(provider, apiKey)
  return result.ok ? result.data ?? [] : []
}

export async function fetchProviderModelConfigsDetailed(provider: AIProvider, apiKey: string, options: { timeoutMs?: number } = {}): Promise<ProviderOperationResult<AIModel[]>> {
  if (!apiKey.trim()) {
    return failure('missing_key', st('providerOperation.saveApiKeyFirst'))
  }
  const p = { ...provider, apiKey: apiKey.trim() }
  const issue = getProviderConfigIssue(p, apiKey)
  if (issue) {
    return failure(issue.code === 'bad_base_url' ? 'bad_base_url' : 'credential_mismatch', st(issue.messageKey ?? issue.message, undefined, issue.message))
  }
  const hostedIssue = getHostedProviderSupportIssue(p, 'modelList')
  if (hostedIssue) {
    return failure<AIModel[]>('models_endpoint_unavailable', hostedIssue.message, undefined, findCredentialGroupIdForKey(provider, apiKey))
  }
  try {
    const models = await fetchProviderModelConfigsFromRemote(p, options.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS)
    if (!models.length) {
      return failure<AIModel[]>('empty_models', st('providerOperation.emptyModels'), undefined, findCredentialGroupIdForKey(provider, apiKey))
    }
    return success(st('providerOperation.modelsFetched', { count: models.length }), models, findCredentialGroupIdForKey(provider, apiKey))
  } catch (error) {
    return providerFetchFailure(error, findCredentialGroupIdForKey(provider, apiKey))
  }
  return failure('models_endpoint_unavailable', st('providerOperation.modelsEndpointUnavailable'))
}

export async function syncProviderCredentialGroupsDetailed(provider: AIProvider, options: { timeoutMs?: number } = {}): Promise<ProviderOperationResult<AIProvider>> {
  const groups = provider.credentialGroups?.filter((group) => group.enabled && group.apiKey?.trim()) ?? []
  if (!groups.length && !provider.apiKey.trim()) {
    return failure('missing_key', st('providerOperation.saveTokenGroupFirst'))
  }
  const sourceGroups = groups.length
    ? provider.credentialGroups
    : [{ id: 'default', label: st('providerOperation.defaultToken'), enabled: true, apiKey: provider.apiKey, availableModels: [] }]
  const synced = await runCredentialGroupModelSync(
    { ...provider, credentialGroups: sourceGroups },
    {
      fetchModels: async (source, group) => {
        const result = await fetchProviderModelConfigsDetailed(source, group.apiKey ?? '', { timeoutMs: options.timeoutMs })
        if (!result.ok || !result.data?.length) {
          throw new Error(result.message)
        }
        return result.data
      },
    }
  )
  return success(st('providerOperation.credentialGroupsSynced'), synced)
}

export async function fetchProviderModels(provider: AIProvider, apiKey: string): Promise<string[]> {
  return (await fetchProviderModelConfigs(provider, apiKey)).map((model) => model.id)
}

export async function embedTextWithProvider(provider: AIProvider, text: string): Promise<EmbeddingResult> {
  if (!provider.apiKey.trim()) throw new Error('missing_key')
  if (!text.trim()) throw new Error('empty_text')
  if (!(provider.type === 'openai' || provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo')) {
    throw new Error('embeddings_endpoint_unavailable')
  }
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'embeddings', provider.capabilities?.embeddings === true)) {
    throw new Error('embeddings_unsupported_by_contract')
  }
  const issue = getProviderConfigIssue(provider, provider.apiKey)
  if (issue) throw new Error(`${issue.code}: ${st(issue.messageKey ?? issue.message, undefined, issue.message)}`)
  const model = pickEmbeddingModel(provider)
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/embeddings`, {
    method: 'POST',
    headers: getHeaders(provider),
    body: JSON.stringify({
      model,
      input: text.slice(0, 8000),
    }),
  }, PROVIDER_REQUEST_TIMEOUT_MS)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = await response.json()
  const embedding = json.data?.[0]?.embedding
  if (!Array.isArray(embedding)) throw new Error('empty_embedding')
  return {
    embedding: embedding.filter((value: unknown): value is number => typeof value === 'number'),
    source: 'provider',
    model,
  }
}

export async function transcribeAudioWithProvider(req: ProviderAudioTranscriptionRequest): Promise<string> {
  const model = req.model ?? 'whisper-1'
  const credential = chooseCredentialForModel(req.provider, model)
  const provider = { ...req.provider, apiKey: credential.apiKey || req.provider.apiKey }
  if (!provider.apiKey.trim()) throw new Error('missing_key')
  const issue = getProviderConfigIssue(provider, provider.apiKey)
  if (issue) throw new Error(`${issue.code}: ${st(issue.messageKey ?? issue.message, undefined, issue.message)}`)
  const providerDeclaresAudioTranscription = provider.capabilities?.audioTranscription === true || (provider.type === 'google' && provider.capabilities?.audioInput === true)
  if (!providerDeclaresAudioTranscription || !providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)) {
    throw new Error('audio_transcription_unavailable')
  }
  if (provider.type === 'openai' || provider.type === 'openai-compatible') {
    const form = new FormData()
    form.append('model', req.model ?? 'whisper-1')
    form.append('file', {
      uri: `data:${req.mimeType};base64,${req.audioBase64}`,
      name: req.fileName ?? 'audio.m4a',
      type: req.mimeType,
    } as unknown as Blob)
    const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: form,
    }, PROVIDER_REQUEST_TIMEOUT_MS)
    if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
    const json = await response.json()
    return typeof json.text === 'string' ? json.text : ''
  }
  if (provider.type === 'google') {
    return generateText({
      provider,
      model: req.model ?? provider.models[0] ?? 'gemini-2.5-flash',
      systemPrompt: '请把用户提供的音频转写为原始文字。只输出转写文本。',
      messages: [{ role: 'user', content: '请转写这段音频。' }],
      attachments: [{
        id: `audio-${Date.now()}`,
        type: 'document',
        uri: '',
        name: req.fileName ?? 'audio.m4a',
        mimeType: req.mimeType,
        size: Math.ceil(req.audioBase64.length * 0.75),
        base64: req.audioBase64,
      }],
      temperature: 0.1,
      maxTokens: 2048,
    })
  }
  throw new Error('audio_transcription_unavailable')
}

export async function synthesizeSpeechWithProvider(req: ProviderSpeechRequest): Promise<string> {
  const model = req.model ?? 'gpt-4o-mini-tts'
  const credential = chooseCredentialForModel(req.provider, model)
  const provider = { ...req.provider, apiKey: credential.apiKey || req.provider.apiKey }
  if (!provider.apiKey.trim()) throw new Error('missing_key')
  const issue = getProviderConfigIssue(provider, provider.apiKey)
  if (issue) throw new Error(`${issue.code}: ${st(issue.messageKey ?? issue.message, undefined, issue.message)}`)
  if (provider.capabilities?.speech !== true || !providerCompatibilityCapabilityCanBeSentForProvider(provider, 'audio', true)) {
    throw new Error('speech_unavailable')
  }
  if (!(provider.type === 'openai' || provider.type === 'openai-compatible')) {
    throw new Error('speech_unavailable')
  }
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/audio/speech`, {
    method: 'POST',
    headers: getHeaders(provider),
    body: JSON.stringify({
      model,
      voice: req.voice ?? 'alloy',
      input: req.text.slice(0, 4000),
      response_format: 'mp3',
    }),
  }, PROVIDER_REQUEST_TIMEOUT_MS)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const buffer = await response.arrayBuffer()
  return arrayBufferToBase64(buffer)
}
