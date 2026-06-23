import type { AIModel, Attachment, AIProvider, ChatErrorCode, MessageCitation, MessageUsage, ProcessTrace, ProviderOperationCode, ProviderType, ReasoningEffort, RetrievalSource, WebSearchMode } from '@/types'
import { getModelConfig, getProviderConfigIssue } from '@/types'
import { st } from '@/i18n/service'
import { getSecureApiKey } from './secureKey'
import { chooseCredentialForModel, findCredentialGroupIdForKey, runCredentialGroupModelSync, updateCredentialGroupHealth } from './providerCredentials'
import { modelDisallowsAnthropicSampling } from '@/utils/modelReasoning'
import { evaluatePayloadRules } from '@/services/ai/policy/payloadRules'
import { resolveProxyPolicy } from '@/services/ai/policy/proxyPolicy'
import { mergeRuntimeAliasAccessPolicy, resolveProviderModelAccess, resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'
import { ProviderHttpError, classifyHttpStatus, failure, formatProviderHttpError, providerFetchFailure, success, type ProviderOperationResult } from '@/services/ai/providerOperationResult'
import { selectUpstreamTransport } from '@/services/ai/transport/transportSelector'
import { acquireSessionLease } from '@/services/ai/transport/sessionLeasePool'
import { runResponsesWebSocketTransport } from '@/services/ai/transport/responsesWebSocketTransport'
import { appendRuntimeLog } from '@/services/runtimeLog'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import type { ProviderConformanceResult, ProviderStructuredOutputRequest } from '@/services/ai/providerConformance'
import { resolveProviderCapabilityManifest, resolveProviderRequestConformance, supportsNativeProviderTools } from '@/services/ai/providerConformance'
import type { ProviderRouteContext } from '@/services/ai/providerRouter'
import { resolveProviderRoute } from '@/services/ai/providerRouter'
import { buildProviderFallbackCandidates } from '@/services/ai/providerFallbackCandidates'

export type { ProviderOperationResult } from '@/services/ai/providerOperationResult'
import type { ProviderFailoverDecision, ProviderFailoverInput, ProviderFailoverRoute } from '@/services/ai/providerFailover'
import { classifyProviderFailure, resolveFailoverDecision } from '@/services/ai/providerFailover'
import { indexProviderHealthRecords, providerHealthKey, recordProviderFailure, recordProviderSuccess } from '@/services/ai/providerHealth'
import { loadProviderHealthSnapshot, mergeProviderHealthRecords } from '@/services/ai/providerHealthStore'
import {
  assembleProviderRoute,
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
import { dedupeCitations, extractCitationsFromText, extractProviderCitationsFromSse, type ProviderCitationSource } from '@/services/ai/providerCitations'
import { normalizeAnthropicThinking } from '@/services/ai/providerAnthropicThinking'
import { anthropicAttachmentPart, anthropicNativeWebSearchTool } from '@/services/ai/providerAnthropicRequest'
import { mergeAnthropicReplayContentBlocks, sanitizeAnthropicReplayContentBlocks } from '@/services/ai/providerAnthropicReplay'
import { rectifyAnthropicRequestBody } from '@/services/ai/providerAnthropicRectification'
import { optimizeRequestBody as optimizeProviderRequestBody } from '@/services/ai/providerRequestOptimization'
import { fallbackProvidersForRequest, providerForRuntimeFallback, requiredFallbackCapabilities, retryAfterMsFromFailure, routeForRuntimeFallback } from '@/services/ai/providerRuntimeFallback'
import { logRuntimeFallbackDecision, recordRuntimeFallbackFailure, recordRuntimeFallbackSuccess } from '@/services/ai/providerRuntimeFallbackLogging'
import { providerRuntimeError, runStreamTask, withCredentialGroup, type ProviderRuntimeError } from '@/services/ai/providerRuntimeResult'
import { dedupeTraces, splitSseBuffer } from '@/services/ai/providerStreamUtils'
import { fetchChatStreamWithTimeout, fetchWithTimeout, safeResponseText } from '@/services/ai/providerHttp'
import { stringValue } from '@/services/ai/providerJsonUtils'
import { parseProviderBufferedStreamResponse, parseProviderNonStreamingResponse, parseProviderNonStreamingText, providerReasoningResponseCanBeParsed, withProviderTextToolCallFallback } from '@/services/ai/providerResponseParsing'
import { mergeOpenAIResponseReplayItems } from '@/services/ai/providerOpenAIReplay'
import { extractAnthropicText, extractGoogleText } from '@/services/ai/providerResponseText'
import { mergeProviderToolDeclarations } from '@/services/ai/providerToolDeclarations'
import { cloneOpenAIResponsesInputItems, hasOpenAIResponsesFunctionCallItem, toOpenAIChatToolCall, toOpenAIResponsesFunctionCallInput } from '@/services/ai/providerToolReplay'
import { createProviderTrace } from '@/services/ai/providerTraceUtils'
import { createProviderTextToolCallStreamFilter, executableProviderToolCalls, mergeProviderToolCallParts, type ProviderToolCall } from '@/services/ai/providerToolCalls'
import { filterProviderStructuredOutputToolCalls, providerStructuredOutputToolCallText, providerStructuredOutputToolName, providerStructuredOutputToolSchema } from '@/services/ai/providerStructuredOutput'
import { parseProviderStreamChunk, parseProviderStreamEvent, type ParsedStreamChunk } from '@/services/ai/providerStreamParsing'
import { getModelTestMaxTokens, getModelTestReasoningEffort, reduceModelTestBody } from '@/services/ai/providerModelTest'
import { createRuntimeFallbackTrace, createStreamModeTrace, emitRuntimeGovernanceTrace, logPayloadPolicy, logProviderCompatibility, logProviderConformance, logProviderRouteDecision, logProxyPolicy, logUpstreamRequest, runtimeLogOptions } from '@/services/ai/providerRuntimeDiagnostics'
import { assertProviderCircuitClosed, delayProviderRetry, logProviderRetryAttempt, providerCircuitKey, providerRetryDelayMs, recordProviderCircuitFailure, recordProviderCircuitSuccess, resolveProviderMaxRetries, resolveProviderRequestTimeoutMs } from '@/services/ai/providerRuntimeRetry'
import { isMiniMaxProvider, isPerplexityProvider } from '@/services/ai/providerIdentity'
import { endpointHost, resolveNonStreamingProviderEndpoint, toWebSocketUrl } from '@/services/ai/providerEndpointUtils'
import { fallbackModel, pickEmbeddingModel } from '@/services/ai/providerDefaultModels'
import { arrayBufferToBase64 } from '@/services/ai/providerBinaryUtils'
import { clamp01 } from '@/services/ai/providerNumberUtils'
import { getHeaders } from '@/services/ai/providerHeaders'
import { getHostedProviderSupportIssue } from '@/services/ai/providerHostedBoundary'
import { isBedrockRuntimeProvider, prepareBedrockRuntimeInvokeModelRequest } from '@/services/ai/providerAwsBedrockRouting'
import { getWireProviderType, isAnthropicWireRequest } from '@/services/ai/providerWireProtocol'
import { clampMaxTokens, isXiaomiMimoThinkingActive, normalizeTemperature, normalizeXiaomiMimoThinking, supportsSamplingControls } from '@/services/ai/providerRequestParameters'
import { isKimiSamplingLocked, normalizeDashScopeThinking, normalizeDeepSeekThinking, normalizeKimiPreservedThinking, normalizeKimiThinking, normalizeMiniMaxThinking, normalizeSiliconFlowThinking, shouldRequestMiniMaxReasoningSplit } from '@/services/ai/providerOpenAICompatibleThinking'
import { normalizeGoogleThinkingConfig } from '@/services/ai/providerGoogleThinking'
import { googleAttachmentPart, googleNativeWebSearchTool } from '@/services/ai/providerGoogleRequest'
import { buildOpenAIResponsesReasoning, getOpenAIChatMaxTokensField, normalizeOpenAIReasoningEffort, openAICompatibleAttachmentPart, openAICompatibleReasoningReplayField, openAIResponsesAttachmentPart, openAIResponsesNativeWebSearchTool, shouldIncludeOpenAIResponsesEncryptedReasoning, usesOpenAIResponses, xiaomiMimoNativeWebSearchTool } from '@/services/ai/providerOpenAIRequest'
import { providerCompatibilityCapabilityCanBeSentForProvider } from '@/services/ai/providerCompatibilityContract'
import { providerSupportsNativeSearch } from '@/services/chatProviderNativeToolUtils'
import { filterSendableAttachments } from '@/services/attachmentContract'

export type StreamCallback = (chunk: string) => void
export type DoneCallback = (result: ChatCompletionResult) => void
export type CitationCallback = (citations: MessageCitation[]) => void
export type TraceCallback = (trace: ProcessTrace) => void
export type ErrorCallback = (error: Error) => void
export type { ProviderToolCall } from '@/services/ai/providerToolCalls'

export type { ProviderRuntimeError } from '@/services/ai/providerRuntimeResult'

function providerOperationCodeToChatErrorCode(code: ProviderOperationCode): ChatErrorCode {
  switch (code) {
    case 'missing_key':
    case 'credential_mismatch':
    case 'bad_auth':
    case 'bad_base_url':
    case 'model_unavailable':
    case 'network_error':
    case 'timeout':
    case 'rate_limited':
    case 'max_tokens_exceeded':
      return code
    case 'models_endpoint_unavailable':
      return 'model_unavailable'
    case 'ok':
    case 'empty_models':
    case 'unknown':
      return 'unknown'
  }
}

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
  const samplingControlsSupported = supportsSamplingControls(req) && !compatibleReasoningEnabled
  const temperature = samplingControlsSupported ? normalizeTemperature(req) : undefined
  if (temperature !== undefined) {
    body.temperature = temperature
  }
  if (req.topP !== undefined && samplingControlsSupported) body.top_p = clamp01(req.topP)
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

  const maxTokensKey = getOpenAIChatMaxTokensField(req)
  body[maxTokensKey] = clampMaxTokens(req)

  return body
}

function buildOpenAICompatibleStructuredOutputFormat(req: ChatRequest): Record<string, unknown> | undefined {
  const structuredOutput = req.structuredOutput
  if (!structuredOutput) return undefined
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
    if (attachment.type === 'image') return manifest.modalities.input.image
    return manifest.modalities.input.file
  })
}

function contractProviderToolDeclarations(req: ChatRequest): readonly unknown[] | undefined {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return supportsNativeProviderTools(req.provider, modelConfig) ? req.providerToolDeclarations : undefined
}

function buildAnthropicBody(req: ChatRequest) {
  const system = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n') || undefined
  const messages: Record<string, unknown>[] = []
  const sendableAttachments = contractSendableAttachments(req)
  const thinkingConfig = normalizeAnthropicThinking(req)
  const miniMaxThinking = normalizeMiniMaxThinking(req)
  const mimoThinking = normalizeXiaomiMimoThinking(req)
  const samplingDisallowed = !supportsSamplingControls(req) || Boolean(thinkingConfig) || isXiaomiMimoThinkingActive(req) || modelDisallowsAnthropicSampling(req.model)
  const temperature = samplingDisallowed ? undefined : isMiniMaxProvider(req.provider) ? normalizeTemperature(req) : req.temperature ?? 0.7
  const topP = samplingDisallowed ? undefined : req.topP ?? 1

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
    max_tokens: clampMaxTokens(req),
    stream: req.stream ?? true,
    ...(tools ? { tools } : {}),
  }
  if (structuredOutputTool) body.tool_choice = { type: 'tool', name: structuredOutputTool.name }
  if (temperature !== undefined) body.temperature = temperature
  if (topP !== undefined) body.top_p = topP
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

  const generationConfig: Record<string, unknown> = {
    temperature: req.temperature ?? 0.7,
    topP: req.topP ?? 1,
    maxOutputTokens: clampMaxTokens(req),
  }
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
  const responsesNativeWebSearchTool = req.webSearchMode === 'native'
    ? openAIResponsesNativeWebSearchTool(req.provider)
    : undefined
  const tools = mergeProviderToolDeclarations(
    contractProviderToolDeclarations(req),
    responsesNativeWebSearchTool ? [responsesNativeWebSearchTool] : []
  )
  const samplingControlsSupported = supportsSamplingControls(req)
  const textConfig = buildOpenAIResponsesTextConfig(req)
  const responseFormat = buildOpenAIResponsesResponseFormat(req)
  return {
    model: req.model,
    input,
    ...(samplingControlsSupported && normalizeTemperature(req) !== undefined ? { temperature: normalizeTemperature(req) } : {}),
    ...(samplingControlsSupported && req.topP !== undefined ? { top_p: clamp01(req.topP) } : {}),
    ...(textConfig ? { text: textConfig } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
    ...(responsesReasoning ? { reasoning: responsesReasoning } : {}),
    ...(includeEncryptedReasoning ? { include: ['reasoning.encrypted_content'] } : {}),
    max_output_tokens: clampMaxTokens(req),
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
  let body: Record<string, unknown>
  switch (req.provider.type) {
    case 'openai':
      body = usesOpenAIResponses(req) ? buildOpenAIResponsesBody(req) : buildOpenAIBody(req)
      break
    case 'anthropic':
      body = buildAnthropicBody(req)
      break
    case 'google':
      body = buildGoogleBody(req)
      break
    case 'openai-compatible':
      body = req.provider.wireProtocol === 'anthropic-compatible'
        ? buildAnthropicBody(req)
        : usesOpenAIResponses(req) ? buildOpenAIResponsesBody(req) : buildOpenAIBody(req)
      break
    case 'xiaomi-mimo':
      body = req.provider.wireProtocol === 'anthropic-compatible' ? buildXiaomiMimoAnthropicBody(req) : buildOpenAIBody(req)
      break
  }
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

function prepareHttpJsonRequest(input: {
  provider: AIProvider
  model: string
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}) {
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

export async function streamChat(
  req: ChatRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onCitations?: CitationCallback,
  onTrace?: TraceCallback
): Promise<StreamHandle> {
  const controller = new AbortController()
  const requestedModel = req.requestedModel ?? req.model
  const upstreamModel = resolveProviderModelAlias(req.provider, requestedModel)
  const effectiveReq = upstreamModel === req.model && requestedModel === req.model ? req : { ...req, requestedModel, model: upstreamModel }
  const credential = chooseCredentialForModel(req.provider, requestedModel)
  const requestedAccess = resolveProviderModelAccess({ provider: req.provider, model: requestedModel, settings: req.settings })
  const upstreamAccess = requestedModel === upstreamModel
    ? requestedAccess
    : resolveProviderModelAccess({ provider: req.provider, model: upstreamModel, settings: req.settings })
  const access = mergeRuntimeAliasAccessPolicy(requestedAccess, upstreamAccess)
  void appendRuntimeLog('access.policy', {
    conversationId: effectiveReq.conversationId,
    providerId: effectiveReq.provider.id,
    model: upstreamModel,
    requestedModel,
    upstreamModel,
    allowed: access.allowed,
    matchedRules: access.matchedRules,
    reason: access.allowed ? undefined : access.reason,
  }, runtimeLogOptions(effectiveReq))
  if (!access.allowed) {
    emitRuntimeGovernanceTrace({
      onTrace,
      req: effectiveReq,
      requestedModel,
      upstreamModel,
      access,
      status: 'error',
    })
    const done = Promise.resolve().then(() => onError(providerRuntimeError(`access_policy_${access.reason}`, credential.credentialGroupId)))
    return { controller, done }
  }
  const runtimeReq = {
    ...effectiveReq,
    provider: {
      ...effectiveReq.provider,
      apiKey: credential.apiKey || effectiveReq.provider.apiKey,
    },
  }
  const issue = getProviderConfigIssue(runtimeReq.provider, runtimeReq.provider.apiKey)
  if (issue) {
    effectiveReq.provider = updateCredentialGroupHealth(effectiveReq.provider, credential.credentialGroupId, false)
    const error = providerRuntimeError(`${issue.code}: ${issue.message}`, credential.credentialGroupId)
    const done = Promise.resolve().then(() => onError(error))
    return { controller, done }
  }
  const hostedIssue = getHostedProviderSupportIssue(runtimeReq.provider, 'chat')
  if (hostedIssue) {
    effectiveReq.provider = updateCredentialGroupHealth(effectiveReq.provider, credential.credentialGroupId, false)
    const error = providerRuntimeError(hostedIssue.message, credential.credentialGroupId)
    const done = Promise.resolve().then(() => onError(error))
    return { controller, done }
  }
  if (effectiveReq.signal) {
    effectiveReq.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const runtimeModelConfig = getModelConfig(runtimeReq.model, runtimeReq.provider.type, runtimeReq.provider.modelConfigs)
  const stream = runtimeModelConfig.supportsStreaming === false ? false : (effectiveReq.stream ?? true)
  if (!runtimeReq.provider.apiKey.trim()) {
    effectiveReq.provider = updateCredentialGroupHealth(effectiveReq.provider, credential.credentialGroupId, false)
    const done = Promise.resolve().then(() => onError(providerRuntimeError('missing_key', credential.credentialGroupId)))
    return { controller, done }
  }
  const usesResponsesApi = usesOpenAIResponses(runtimeReq)
  const routeAssembly = assembleProviderRoute({
    provider: runtimeReq.provider,
    model: runtimeReq.model,
    stream,
    usesResponsesApi,
    settings: effectiveReq.settings,
    hasWebSocketRuntime: typeof WebSocket !== 'undefined',
  })
  const url = routeAssembly.endpoint
  const transportSelection = routeAssembly.transportSelection
  const headers = getHeaders(runtimeReq.provider)
  const routeResult = getBodyWithRoute({ ...runtimeReq, stream }, {
    endpoint: url,
    transport: transportSelection.transport,
    requestedTransportMode: transportSelection.requestedMode,
    transportFallbackReason: transportSelection.fallbackReason,
  })
  const rawBody = optimizeRequestBody(routeResult.body, runtimeReq)
  void logProviderRouteDecision(effectiveReq, routeResult.decision)
  void logProviderCompatibility(effectiveReq)
  void logProviderConformance(effectiveReq, routeResult.conformance)
  const conformanceBlockers = routeResult.conformance.issues.filter((issue) => issue.severity === 'block')
  if (conformanceBlockers.length) {
    emitRuntimeGovernanceTrace({
      onTrace,
      req: effectiveReq,
      requestedModel,
      upstreamModel,
      access,
      route: routeResult.decision,
      transport: transportSelection,
      status: 'error',
    })
    const done = Promise.resolve().then(() => onError(providerRuntimeError(`provider_conformance_blocked:${conformanceBlockers.map((issue) => issue.code).join(',')}`, credential.credentialGroupId)))
    return { controller, done }
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
      onTrace,
      req: effectiveReq,
      requestedModel,
      upstreamModel,
      access,
      route: routeResult.decision,
      transport: transportSelection,
      payload: payloadPolicy,
      status: 'error',
    })
    const done = Promise.resolve().then(() => onError(providerRuntimeError(`payload_policy_blocked:${payloadPolicy.findings.map((item) => item.id).join(',')}`, credential.credentialGroupId)))
    return { controller, done }
  }
  const proxyPolicy = resolveProxyPolicy({ provider: runtimeReq.provider, url, settings: effectiveReq.settings })
  void logProxyPolicy(effectiveReq, proxyPolicy)
  void logUpstreamRequest(effectiveReq, transportSelection, payloadPolicy, proxyPolicy)
  emitRuntimeGovernanceTrace({
    onTrace,
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
  const preparedHttpRequest = prepareHttpJsonRequest({
    provider: runtimeReq.provider,
    model: runtimeReq.model,
    url: proxyPolicy.effectiveUrl,
    headers,
    body: rawBody,
  })
  let lease: Awaited<ReturnType<typeof acquireSessionLease>> | null = null
  if (transportSelection.transport === 'responses_websocket') {
    try {
      lease = await acquireSessionLease({
        key: `${runtimeReq.provider.id}:${runtimeReq.model}:${effectiveReq.conversationId ?? 'global'}:${effectiveReq.sessionId ?? 'default'}`,
        limit: effectiveReq.settings?.sessionConcurrencyLimit,
        timeoutMs: effectiveReq.settings?.sessionQueueTimeoutMs,
      })
      void appendRuntimeLog('session.lease', {
        conversationId: effectiveReq.conversationId,
        providerId: runtimeReq.provider.id,
        model: runtimeReq.model,
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        status: 'acquired',
        key: lease.key,
      }, runtimeLogOptions(effectiveReq))
    } catch {
      const done = Promise.resolve().then(() => onError(providerRuntimeError('session_queue_timeout', credential.credentialGroupId)))
      void appendRuntimeLog('session.lease', {
        conversationId: effectiveReq.conversationId,
        providerId: runtimeReq.provider.id,
        model: runtimeReq.model,
        requestedModel: runtimeReq.requestedModel,
        upstreamModel: runtimeReq.model,
        status: 'timeout',
      }, runtimeLogOptions(effectiveReq))
      return { controller, done }
    }
  }
  if (transportSelection.transport === 'responses_websocket') {
    const done = runStreamTask(async () => {
      let emittedText = false
      try {
        await runResponsesWebSocketTransport({
          req: runtimeReq,
          url: toWebSocketUrl(proxyPolicy.effectiveUrl),
          headers,
          body: rawBody as Record<string, unknown>,
          signal: controller.signal,
          parseEvent: parseProviderStreamEvent,
          wireProviderType: getWireProviderType(runtimeReq.provider),
          extractCitations: extractCitationsFromText,
          onChunk: (chunk) => {
            emittedText = emittedText || !!chunk
            onChunk(chunk)
          },
          onDone: (result) => {
            void appendRuntimeLog('upstream.response', {
              conversationId: runtimeReq.conversationId,
              providerId: runtimeReq.provider.id,
              model: runtimeReq.model,
              requestedModel: runtimeReq.requestedModel,
              upstreamModel: runtimeReq.model,
              transport: 'responses_websocket',
              usage: result.usage,
              textLength: result.text.length,
              responseId: result.responseId,
            }, runtimeLogOptions(runtimeReq))
            onDone(withCredentialGroup(result, credential.credentialGroupId))
          },
          onError,
          onCitations,
          onTrace,
        })
      } catch (error) {
        if ((effectiveReq.settings?.transportMode ?? 'auto') === 'websocket' || emittedText) throw error
        onTrace?.(createStreamModeTrace('fallback', 'Responses WebSocket handshake failed; HTTP/SSE fallback is running.'))
        void appendRuntimeLog('transport.fallback', {
          conversationId: effectiveReq.conversationId,
          providerId: runtimeReq.provider.id,
          model: runtimeReq.model,
          requestedModel: runtimeReq.requestedModel,
          upstreamModel: runtimeReq.model,
          from: 'responses_websocket',
          to: 'http_sse',
          reason: error instanceof Error ? error.message : 'websocket_transport_error',
        }, runtimeLogOptions(effectiveReq))
        await executeHttpSseChat({
          req: runtimeReq,
          url: preparedHttpRequest.url,
          headers: preparedHttpRequest.headers,
          body: preparedHttpRequest.body,
          stream,
          controller,
          credentialGroupId: credential.credentialGroupId,
          onChunk,
          onDone,
          onError,
          onCitations,
          onTrace,
        })
      } finally {
        lease?.release()
      }
    }, onError, credential.credentialGroupId)
    return { controller, done }
  }
  const done = runStreamTask(() => executeHttpSseChat({
    req: runtimeReq,
    url: preparedHttpRequest.url,
    headers: preparedHttpRequest.headers,
    body: preparedHttpRequest.body,
    stream,
    controller,
    credentialGroupId: credential.credentialGroupId,
    onChunk,
    onDone,
    onError,
    onCitations,
    onTrace,
  }), onError, credential.credentialGroupId)
  return { controller, done }
}

async function executeHttpSseChat(input: {
  req: ChatRequest
  url: string
  headers: Record<string, string>
  body: string
  stream: boolean
  controller: AbortController
  credentialGroupId?: string
  onChunk: StreamCallback
  onDone: DoneCallback
  onError: ErrorCallback
  onCitations?: CitationCallback
  onTrace?: TraceCallback
}): Promise<void> {
  const response = await fetchChatStreamWithRetry(input)

  if (!response.ok) {
    const errorText = await safeResponseText(response)
    const recovered = await tryRuntimeFallback({
      req: input.req,
      status: response.status,
      responseText: errorText,
      credentialGroupId: input.credentialGroupId,
      onChunk: input.onChunk,
      onDone: input.onDone,
      onCitations: input.onCitations,
      onTrace: input.onTrace,
    })
    if (recovered) return
    input.req.provider = updateCredentialGroupHealth(input.req.provider, input.credentialGroupId, false)
    void appendRuntimeLog('upstream.error', {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      upstreamModel: input.req.model,
      status: response.status,
      endpointHost: endpointHost(input.url),
    }, runtimeLogOptions(input.req))
    const errorCode = classifyHttpStatus(response.status, errorText, input.req.model, input.req.provider)
    input.onError(providerRuntimeError(
      formatProviderHttpError(response.status, errorText, input.req.provider, input.req.model),
      input.credentialGroupId,
      providerOperationCodeToChatErrorCode(errorCode)
    ))
    return
  }

  if (!input.stream) {
    const result = await parseProviderNonStreamingResponse(response, input.req)
    if (result.text) input.onChunk(result.text)
    if (result.citations?.length) input.onCitations?.(result.citations)
    result.traces?.forEach(input.onTrace ?? (() => undefined))
    void appendRuntimeLog('upstream.response', {
      conversationId: input.req.conversationId,
      providerId: input.req.provider.id,
      model: input.req.model,
      requestedModel: input.req.requestedModel,
      upstreamModel: input.req.model,
      transport: 'http_sse',
      usage: result.usage,
      textLength: result.text.length,
    }, runtimeLogOptions(input.req))
    input.onDone(withCredentialGroup(result, input.credentialGroupId))
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    input.onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackNoReader')))
    const raw = await safeResponseText(response)
    const result = parseProviderBufferedStreamResponse(raw, input.req, getWireProviderType(input.req.provider))
    if (result.text || result.providerToolCalls?.length) {
      input.onChunk(result.text)
      if (result.citations?.length) input.onCitations?.(result.citations)
      result.traces?.forEach(input.onTrace ?? (() => undefined))
      input.onDone(withCredentialGroup(result, input.credentialGroupId))
    } else {
      input.onTrace?.(createStreamModeTrace('buffered', st('providerTrace.streamBufferedFallback')))
      await retryWithoutStreaming(input.req, input.onChunk, input.onDone, input.onError, input.onCitations, input.onTrace, input.credentialGroupId)
    }
    return
  }

  input.onTrace?.(createStreamModeTrace('reader', st('providerTrace.streamReader')))

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  let providerCitations: MessageCitation[] = []
  let providerTraces: ProcessTrace[] = []
  let providerToolCalls: ProviderToolCall[] = []
  let providerUsage: MessageUsage | undefined
  let providerReasoningContent = ''
  let providerResponseItems: Record<string, unknown>[] = []
  let providerContentBlocks: Record<string, unknown>[] = []
  const textToolCallFilter = createProviderTextToolCallStreamFilter()
  const wireProviderType = getWireProviderType(input.req.provider)
  const streamParseOptions = { includeReasoning: providerReasoningResponseCanBeParsed(input.req) }
  const providerCitationSource = resolveStreamProviderCitationSource(input.req.provider, wireProviderType)

  async function readStream() {
    while (true) {
      const { done, value } = await reader!.read()
      if (done) {
        const finalParsed = parseProviderStreamChunk(buffer, wireProviderType, streamParseOptions)
        if (finalParsed.text) {
          fullText += finalParsed.text
          const visibleText = textToolCallFilter.push(finalParsed.text)
          if (visibleText) input.onChunk(visibleText)
        }
        const filterRemainder = textToolCallFilter.finish()
        if (filterRemainder) input.onChunk(filterRemainder)
        providerTraces = dedupeTraces([...providerTraces, ...finalParsed.traces])
        providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(finalParsed.providerToolCalls ?? [])])
        providerReasoningContent += finalParsed.reasoningContent ?? ''
        providerResponseItems = mergeOpenAIResponseReplayItems([...providerResponseItems, ...(finalParsed.responseItems ?? [])])
        providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(finalParsed.providerContentBlocks ?? [])])
        finalParsed.traces.forEach(input.onTrace ?? (() => undefined))
        providerUsage = finalParsed.usage ?? providerUsage
        const structuredOutputText = providerStructuredOutputToolCallText(providerToolCalls, input.req.structuredOutput)
        const finalText = structuredOutputText ?? fullText
        const finalResult = withProviderTextToolCallFallback({
          text: finalText,
          citations: dedupeCitations([...extractCitationsFromText(finalText, input.req.retrievalSources), ...providerCitations]),
          traces: providerTraces,
          usage: providerUsage,
          providerToolCalls: executableProviderToolCalls(filterProviderStructuredOutputToolCalls(providerToolCalls, input.req.structuredOutput)),
          ...(providerReasoningContent ? { reasoningContent: providerReasoningContent } : {}),
          ...(providerResponseItems.length ? { responseItems: providerResponseItems } : {}),
          ...(providerContentBlocks.length ? { providerContentBlocks: sanitizeAnthropicReplayContentBlocks(providerContentBlocks) } : {}),
        }, finalText)
        const citations = finalResult.citations ?? []
        if (citations.length) input.onCitations?.(citations)
        void appendRuntimeLog('upstream.response', {
          conversationId: input.req.conversationId,
          providerId: input.req.provider.id,
          model: input.req.model,
          requestedModel: input.req.requestedModel,
          upstreamModel: input.req.model,
          transport: 'http_sse',
          usage: providerUsage,
          textLength: fullText.length,
        }, runtimeLogOptions(input.req))
        input.onDone(withCredentialGroup(finalResult, input.credentialGroupId))
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const { events, remainder } = splitSseBuffer(buffer)
      buffer = remainder
      for (const event of events) {
        const parsed = parseProviderStreamChunk(event, wireProviderType, streamParseOptions)
        if (parsed.text) {
          fullText += parsed.text
          const visibleText = textToolCallFilter.push(parsed.text)
          if (visibleText) input.onChunk(visibleText)
        }
        providerTraces = dedupeTraces([...providerTraces, ...parsed.traces])
        providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(parsed.providerToolCalls ?? [])])
        providerReasoningContent += parsed.reasoningContent ?? ''
        providerResponseItems = mergeOpenAIResponseReplayItems([...providerResponseItems, ...(parsed.responseItems ?? [])])
        providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(parsed.providerContentBlocks ?? [])])
        parsed.traces.forEach(input.onTrace ?? (() => undefined))
        providerUsage = parsed.usage ?? providerUsage
        if (providerCitationSource) {
          providerCitations = dedupeCitations([...providerCitations, ...extractProviderCitationsFromSse(event, providerCitationSource)])
        }
      }
    }
  }

  await readStream()
}

function resolveStreamProviderCitationSource(provider: AIProvider, providerType: ProviderType): ProviderCitationSource | undefined {
  if (!providerCompatibilityCapabilityCanBeSentForProvider(provider, 'citations')) return undefined
  if (providerType === 'openai-compatible' && isPerplexityProvider(provider)) return 'perplexity'
  if (providerType === 'anthropic' || providerType === 'google' || providerType === 'xiaomi-mimo') return providerType
  return undefined
}

async function fetchChatStreamWithRetry(input: {
  req: ChatRequest
  url: string
  headers: Record<string, string>
  body: string
  stream: boolean
  controller: AbortController
  credentialGroupId?: string
  onTrace?: TraceCallback
}): Promise<Response> {
  const timeoutMs = resolveProviderRequestTimeoutMs(input.req, CHAT_REQUEST_TIMEOUT_MS)
  const maxRetries = resolveProviderMaxRetries(input.req)
  const circuitKey = providerCircuitKey(input.req)
  assertProviderCircuitClosed(input.req, circuitKey)
  let body = input.body
  let rectifiedRequest = false
  let mimoThinkingRectified = false
  let mimoWebSearchRectified = false
  let retryCount = 0

  while (true) {
    try {
      const response = await fetchChatStreamWithTimeout(input.url, {
        method: 'POST',
        headers: input.headers,
        body,
        signal: input.controller.signal,
      }, timeoutMs)

      if (response.ok) {
        recordProviderCircuitSuccess(circuitKey)
        return response
      }

      const canRetryStatus = response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500
      if (isAnthropicWireRequest(input.req)) {
        const errorText = await safeResponseText(response)
        const rectified = rectifyAnthropicRequestBody({ req: input.req, body, errorText, rectified: rectifiedRequest })
        if (rectified) {
          body = JSON.stringify(rectified.body)
          rectifiedRequest = true
          input.onTrace?.(createProviderTrace('system', getWireProviderType(input.req.provider), st('providerTrace.requestRectified'), rectified.kind, 'done', `rectify-${rectified.kind}`))
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: rectified.kind,
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
          continue
        }
        if (canRetryStatus && retryCount < maxRetries) {
          logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
          retryCount += 1
          await delayProviderRetry(providerRetryDelayMs(retryCount - 1))
          continue
        }
        recordProviderCircuitFailure(input.req, circuitKey)
        return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
      }

      if (input.req.provider.type === 'xiaomi-mimo' && input.req.provider.wireProtocol !== 'anthropic-compatible' && response.status === 400) {
        const errorText = await safeResponseText(response)
        const rectified = rectifyXiaomiMimoThinkingRequestBody({
          req: input.req,
          body,
          status: response.status,
          errorText,
          rectified: mimoThinkingRectified,
        }) ?? rectifyXiaomiMimoWebSearchRequestBody({
          req: input.req,
          body,
          status: response.status,
          errorText,
          rectified: mimoWebSearchRectified,
        })
        if (rectified) {
          body = JSON.stringify(rectified.body)
          if (rectified.kind === 'xiaomi_mimo_thinking_disabled') mimoThinkingRectified = true
          if (rectified.kind === 'xiaomi_mimo_web_search_removed') mimoWebSearchRectified = true
          input.onTrace?.(createProviderTrace('system', getWireProviderType(input.req.provider), st('providerTrace.requestRectified'), rectified.kind, 'done', `rectify-${rectified.kind}`))
          void appendRuntimeLog('request.rectification', {
            conversationId: input.req.conversationId,
            providerId: input.req.provider.id,
            model: input.req.model,
            kind: rectified.kind,
            attempt: retryCount,
          }, runtimeLogOptions(input.req))
          continue
        }
        if (!canRetryStatus || retryCount >= maxRetries) {
          recordProviderCircuitFailure(input.req, circuitKey)
          return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
        }
      }

      if (!canRetryStatus || retryCount >= maxRetries) {
        recordProviderCircuitFailure(input.req, circuitKey)
        return response
      }
      logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
      retryCount += 1
      await delayProviderRetry(providerRetryDelayMs(retryCount - 1))
    } catch (error) {
      if (retryCount >= maxRetries || input.controller.signal.aborted) {
        recordProviderCircuitFailure(input.req, circuitKey)
        throw error
      }
      logProviderRetryAttempt(input.req, retryCount + 1, maxRetries, { error: error instanceof Error ? error.message : 'request_failed' })
      retryCount += 1
      await delayProviderRetry(providerRetryDelayMs(retryCount - 1))
    }
  }
}

function rectifyXiaomiMimoThinkingRequestBody(input: {
  req: ChatRequest
  body: string
  status: number
  errorText: string
  rectified: boolean
}): { kind: 'xiaomi_mimo_thinking_disabled'; body: Record<string, unknown> } | undefined {
  if (input.rectified) return undefined
  if (input.req.provider.type !== 'xiaomi-mimo' || input.req.provider.wireProtocol === 'anthropic-compatible') return undefined
  if (input.status !== 400) return undefined
  if (!/\bparam\s+incorrect\b|invalid\s+(?:request\s+)?format|invalid_request/i.test(input.errorText)) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body)
  } catch {
    return undefined
  }
  const thinking = parsed.thinking
  if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking)) return undefined
  if ((thinking as Record<string, unknown>).type !== 'enabled') return undefined
  return {
    kind: 'xiaomi_mimo_thinking_disabled',
    body: {
      ...parsed,
      thinking: { type: 'disabled' },
    },
  }
}

function rectifyXiaomiMimoWebSearchRequestBody(input: {
  req: ChatRequest
  body: string
  status: number
  errorText: string
  rectified: boolean
}): { kind: 'xiaomi_mimo_web_search_removed'; body: Record<string, unknown> } | undefined {
  if (input.rectified) return undefined
  if (input.req.provider.type !== 'xiaomi-mimo' || input.req.provider.wireProtocol === 'anthropic-compatible') return undefined
  if (input.status !== 400) return undefined
  if (!/\bparam\s+incorrect\b|invalid\s+(?:request\s+)?format|unsupported\s+web[_ -]?search|web[_ -]?search/i.test(input.errorText)) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed.tools)) return undefined
  const tools = parsed.tools.filter((tool) => !(tool && typeof tool === 'object' && !Array.isArray(tool) && (tool as Record<string, unknown>).type === 'web_search'))
  if (tools.length === parsed.tools.length) return undefined
  const next: Record<string, unknown> = { ...parsed }
  if (tools.length) next.tools = tools
  else delete next.tools
  if (!tools.length && next.tool_choice === 'auto') delete next.tool_choice
  return {
    kind: 'xiaomi_mimo_web_search_removed',
    body: next,
  }
}

interface RuntimeFallbackPlanInput {
  req: ChatRequest
  status?: number
  error?: unknown
  responseText?: string
  credentialGroupId?: string
  streamStarted?: boolean
}

interface RuntimeFallbackPlan {
  classification: ReturnType<typeof classifyProviderFailure>
  decision: ProviderFailoverDecision
  candidates: ReturnType<typeof buildProviderFallbackCandidates>
}

interface RuntimeFallbackExecutionInput {
  req: ChatRequest
  status: number
  responseText: string
  credentialGroupId?: string
  onChunk: StreamCallback
  onDone: DoneCallback
  onCitations?: CitationCallback
  onTrace?: TraceCallback
}

async function resolveRuntimeFallbackPlan(input: RuntimeFallbackPlanInput): Promise<RuntimeFallbackPlan> {
  const nowMs = Date.now()
  const original = routeForRuntimeFallback(input.req, input.credentialGroupId)
  const classification = classifyProviderFailure({
    status: input.status,
    errorName: input.error instanceof Error ? input.error.name : undefined,
    errorMessage: input.error instanceof Error ? input.error.message : input.responseText,
    streamStarted: input.streamStarted,
  })
  const snapshot = await loadProviderHealthSnapshot({ nowMs })
  const existing = snapshot.records.find((record) => providerHealthKey(record) === providerHealthKey(original))
  const failureRecord = recordProviderFailure(existing, {
    key: original,
    trigger: classification.trigger,
    nowMs,
    retryAfterMs: retryAfterMsFromFailure(input.status),
  })
  const updatedSnapshot = await mergeProviderHealthRecords([failureRecord], { nowMs })
  const healthRecords = indexProviderHealthRecords(updatedSnapshot.records)
  const requiredCapabilities = requiredFallbackCapabilities(input.req)
  const candidates = buildProviderFallbackCandidates({
    providers: fallbackProvidersForRequest(input.req),
    original,
    requiredCapabilities,
    healthRecords,
    nowMs,
  })
  const decision = resolveFailoverDecision({
    policy: { mode: 'same-provider' },
    trigger: classification.trigger,
    original,
    candidates: candidates.candidates,
    requiredCapabilities,
    streamStarted: input.streamStarted,
  })
  return { classification, decision, candidates }
}

async function tryRuntimeFallback(input: RuntimeFallbackExecutionInput): Promise<boolean> {
  const plan = await resolveRuntimeFallbackPlan({
    req: input.req,
    status: input.status,
    responseText: input.responseText,
    credentialGroupId: input.credentialGroupId,
  })
  await logRuntimeFallbackDecision(input.req, plan)
  if (!plan.decision.eligible || !plan.decision.selected) {
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'skipped'))
    return false
  }

  const selectedRoute = plan.decision.selected
  const selectedProvider = providerForRuntimeFallback(input.req, selectedRoute)
  const selectedReq = {
    ...input.req,
    provider: selectedProvider,
    model: selectedRoute.model,
    requestedModel: selectedRoute.model,
    stream: false,
  }
  const selectedAssembly = assembleProviderRoute({
    provider: selectedReq.provider,
    model: selectedReq.model,
    stream: false,
    usesResponsesApi: usesOpenAIResponses(selectedReq),
    settings: selectedReq.settings,
    hasWebSocketRuntime: typeof WebSocket !== 'undefined',
  })
  const selectedRouteResult = getBodyWithRoute(selectedReq, {
    endpoint: selectedAssembly.endpoint,
    transport: selectedAssembly.transportSelection.transport,
    requestedTransportMode: selectedAssembly.transportSelection.requestedMode,
    transportFallbackReason: selectedAssembly.transportSelection.fallbackReason,
  }, {
    policy: { mode: 'same-provider' },
    trigger: plan.classification.trigger,
    original: routeForRuntimeFallback(input.req, input.credentialGroupId),
    candidates: plan.candidates.candidates,
    requiredCapabilities: requiredFallbackCapabilities(input.req),
  })
  await logProviderRouteDecision(selectedReq, selectedRouteResult.decision)
  await logProviderCompatibility(selectedReq)
  await logProviderConformance(selectedReq, selectedRouteResult.conformance)
  if (selectedRouteResult.decision.blocked) {
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', 'route_blocked'))
    return false
  }
  const selectedPreparedRequest = prepareHttpJsonRequest({
    provider: selectedReq.provider,
    model: selectedReq.model,
    url: selectedAssembly.endpoint,
    headers: getHeaders(selectedReq.provider),
    body: selectedRouteResult.body,
  })
  const selectedResponse = await fetchWithTimeout(
    selectedPreparedRequest.url,
    {
      method: 'POST',
      headers: selectedPreparedRequest.headers,
      body: selectedPreparedRequest.body,
    },
    CHAT_REQUEST_TIMEOUT_MS
  )
  if (!selectedResponse.ok) {
    await recordRuntimeFallbackFailure(selectedRoute, selectedResponse.status, await safeResponseText(selectedResponse))
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', `upstream_${selectedResponse.status}`))
    return false
  }

  await recordRuntimeFallbackSuccess(selectedRoute)
  const selectedResult = await parseProviderNonStreamingResponse(selectedResponse, selectedReq)
  input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'done'))
  input.onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
  if (selectedResult.text) input.onChunk(selectedResult.text)
  if (selectedResult.citations?.length) input.onCitations?.(selectedResult.citations)
  selectedResult.traces?.forEach(input.onTrace ?? (() => undefined))
  void appendRuntimeLog('upstream.response', {
    conversationId: input.req.conversationId,
    providerId: selectedReq.provider.id,
    model: selectedReq.model,
    requestedModel: selectedReq.requestedModel,
    upstreamModel: selectedReq.model,
    transport: 'http_sse',
    fallback: true,
    usage: selectedResult.usage,
    textLength: selectedResult.text.length,
  }, runtimeLogOptions(input.req))
  input.onDone(withCredentialGroup(selectedResult, selectedRoute.credentialGroupId))
  return true
}

async function retryWithoutStreaming(
  req: ChatRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onCitations?: CitationCallback,
  onTrace?: TraceCallback,
  credentialGroupId?: string
): Promise<void> {
  try {
    const fallbackReq = { ...req, stream: false }
    const url = resolveNonStreamingProviderEndpoint(fallbackReq)
    const fallbackPreparedRequest = prepareHttpJsonRequest({
      provider: fallbackReq.provider,
      model: fallbackReq.model,
      url,
      headers: getHeaders(fallbackReq.provider),
      body: getBody(fallbackReq),
    })
    const response = await fetchWithTimeout(
      fallbackPreparedRequest.url,
      {
        method: 'POST',
        headers: fallbackPreparedRequest.headers,
        body: fallbackPreparedRequest.body,
      },
      CHAT_REQUEST_TIMEOUT_MS
    )
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      const recovered = await tryRuntimeFallback({ req: fallbackReq, status: response.status, responseText: errorText, credentialGroupId, onChunk, onDone, onCitations, onTrace })
      if (recovered) return
      const errorCode = classifyHttpStatus(response.status, errorText, fallbackReq.model, fallbackReq.provider)
      onError(providerRuntimeError(
        formatProviderHttpError(response.status, errorText, fallbackReq.provider, fallbackReq.model),
        credentialGroupId,
        providerOperationCodeToChatErrorCode(errorCode)
      ))
      return
    }
  const result = await parseProviderNonStreamingResponse(response, fallbackReq)
  onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
  if (result.text) onChunk(result.text)
  if (result.citations?.length) onCitations?.(result.citations)
  result.traces?.forEach(onTrace ?? (() => undefined))
  void appendRuntimeLog('upstream.response', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    transport: 'http_sse',
    fallback: true,
    usage: result.usage,
    textLength: result.text.length,
  }, runtimeLogOptions(req))
  onDone(withCredentialGroup(result, credentialGroupId))
  } catch (error) {
    const runtimeError = error instanceof Error ? error as ProviderRuntimeError : providerRuntimeError(st('providerOperation.requestFailed'))
    runtimeError.credentialGroupId = runtimeError.credentialGroupId ?? credentialGroupId
    onError(runtimeError)
  }
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

export async function testProviderModelDetailed(provider: AIProvider, model: string, apiKey: string, options: { checkParameters?: boolean } = {}): Promise<ProviderOperationResult> {
  const upstreamModel = resolveProviderModelAlias(provider, model)
  if (!apiKey.trim()) {
    return failure('missing_key', st('providerOperation.saveApiKeyFirst'))
  }
  const selected = chooseCredentialForModel(provider, model)
  const selectedGroupId = selected.apiKey === apiKey ? selected.credentialGroupId : findCredentialGroupIdForKey(provider, apiKey)
  const p = { ...provider, apiKey: apiKey.trim() }
  const issue = getProviderConfigIssue(p, apiKey)
  if (issue) {
    return failure(issue.code === 'bad_base_url' ? 'bad_base_url' : 'credential_mismatch', st(issue.messageKey ?? issue.message, undefined, issue.message))
  }
  const hostedIssue = getHostedProviderSupportIssue(p, 'chat')
  if (hostedIssue) {
    return failure('models_endpoint_unavailable', hostedIssue.message, undefined, selectedGroupId)
  }
  if (!upstreamModel.trim()) {
    return failure('model_unavailable', st('providerOperation.chooseModelFirst'))
  }

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
    const url = resolveProviderEndpoint({
      provider: p,
      model: upstreamModel,
      stream: false,
      usesResponsesApi: usesOpenAIResponses(modelTestReq),
    })
    const headers = getHeaders(p)
    const routeResult = getBodyWithRoute(modelTestReq, {
        endpoint: url,
        transport: 'http',
        requestedTransportMode: 'http',
      })
    const rawBody = routeResult.body
    const payload = options.checkParameters === false ? reduceModelTestBody(rawBody) : rawBody
    const prepared = prepareHttpJsonRequest({ provider: p, model: upstreamModel, url, headers, body: payload })

    const response = await fetchWithTimeout(prepared.url, { method: 'POST', headers: prepared.headers, body: prepared.body }, MODEL_TEST_TIMEOUT_MS)
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      return failure(classifyHttpStatus(response.status, errorText, upstreamModel, provider), formatProviderHttpError(response.status, errorText, provider, model), undefined, selectedGroupId)
    }
    const text = await parseProviderNonStreamingText(response, getWireProviderType(p))
    if (!text.trim()) {
      return failure('unknown', st('providerOperation.emptyModelResponse'), undefined, selectedGroupId)
    }
    return success(st('providerOperation.modelTestPassed'), undefined, selectedGroupId)
  } catch (error) {
    return providerFetchFailure(error, selectedGroupId)
  }
}

export async function fetchProviderModelConfigs(provider: AIProvider, apiKey: string): Promise<AIModel[]> {
  const result = await fetchProviderModelConfigsDetailed(provider, apiKey)
  return result.ok ? result.data ?? [] : []
}

export async function fetchProviderModelConfigsDetailed(provider: AIProvider, apiKey: string): Promise<ProviderOperationResult<AIModel[]>> {
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
    const models = await fetchProviderModelConfigsFromRemote(p, PROVIDER_REQUEST_TIMEOUT_MS)
    if (!models.length) {
      return failure<AIModel[]>('empty_models', st('providerOperation.emptyModels'), undefined, findCredentialGroupIdForKey(provider, apiKey))
    }
    return success(st('providerOperation.modelsFetched', { count: models.length }), models, findCredentialGroupIdForKey(provider, apiKey))
  } catch (error) {
    return providerFetchFailure(error, findCredentialGroupIdForKey(provider, apiKey))
  }
  return failure('models_endpoint_unavailable', st('providerOperation.modelsEndpointUnavailable'))
}

export async function syncProviderCredentialGroupsDetailed(provider: AIProvider): Promise<ProviderOperationResult<AIProvider>> {
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
        const result = await fetchProviderModelConfigsDetailed(source, group.apiKey ?? '')
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
