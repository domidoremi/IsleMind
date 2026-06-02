import { fetch as expoFetch } from 'expo/fetch'
import type { AIModel, Attachment, AIProvider, MessageCitation, MessageUsage, ProcessTrace, ProviderOperationCode, ProviderType, ReasoningEffort, RetrievalSource, WebSearchMode } from '@/types'
import { getModelConfig, getProviderConfigIssue, mergeModelConfig, sortModelConfigs } from '@/types'
import { st } from '@/i18n/service'
import { getSecureApiKey } from './secureKey'
import { chooseCredentialForModel, runCredentialGroupModelSync, updateCredentialGroupHealth } from './providerCredentials'
import { getReasoningEffortOptions, isClaudeThinkingModel, isDeepSeekThinkingModel, isGeminiThinkingModel, isOpenAIReasoningModel as isKnownOpenAIReasoningModel, isXiaomiMimoReasoningModel, providerSupportsReasoning } from '@/utils/modelReasoning'
import type { PayloadRuleResult } from '@/services/ai/policy/payloadRules'
import { evaluatePayloadRules } from '@/services/ai/policy/payloadRules'
import type { ProxyPolicyDecision } from '@/services/ai/policy/proxyPolicy'
import { resolveProxyPolicy } from '@/services/ai/policy/proxyPolicy'
import type { AccessPolicyDecision } from '@/services/ai/policy/providerModelAccess'
import { resolveProviderModelAccess, resolveProviderModelAliasAccess } from '@/services/ai/policy/providerModelAccess'
import type { TransportSelection } from '@/services/ai/transport/transportSelector'
import { selectUpstreamTransport } from '@/services/ai/transport/transportSelector'
import { acquireSessionLease } from '@/services/ai/transport/sessionLeasePool'
import { runResponsesWebSocketTransport } from '@/services/ai/transport/responsesWebSocketTransport'
import { appendRuntimeLog } from '@/services/runtimeLog'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import type { ProviderConformanceResult } from '@/services/ai/providerConformance'
import { resolveProviderRequestConformance } from '@/services/ai/providerConformance'
import type { ProviderRouteContext, ProviderRouteDecision } from '@/services/ai/providerRouter'
import { resolveProviderRoute } from '@/services/ai/providerRouter'
import { buildProviderFallbackCandidates } from '@/services/ai/providerFallbackCandidates'
import type { ProviderFailoverDecision, ProviderFailoverInput, ProviderFailoverRoute } from '@/services/ai/providerFailover'
import { classifyProviderFailure, resolveFailoverDecision } from '@/services/ai/providerFailover'
import { indexProviderHealthRecords, providerHealthKey, recordProviderFailure, recordProviderSuccess } from '@/services/ai/providerHealth'
import { loadProviderHealthSnapshot, mergeProviderHealthRecords } from '@/services/ai/providerHealthStore'
import {
  assembleProviderRoute,
  defaultOpenAICompatibleBaseUrl,
  getProviderApiEndpoint,
  isOpenAICompatibleProvider,
  normalizeProviderBaseUrl,
  resolveProviderEndpoint,
} from '@/services/ai/providerRouteAssembly'

export type StreamCallback = (chunk: string) => void
export type DoneCallback = (result: ChatCompletionResult) => void
export type CitationCallback = (citations: MessageCitation[]) => void
export type TraceCallback = (trace: ProcessTrace) => void
export type ErrorCallback = (error: Error) => void

export interface ProviderRuntimeError extends Error {
  credentialGroupId?: string
}

export interface ChatCompletionResult {
  text: string
  usage?: MessageUsage
  citations?: MessageCitation[]
  traces?: ProcessTrace[]
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

export interface ProviderOperationResult<T = undefined> {
  ok: boolean
  code: ProviderOperationCode
  message: string
  data?: T
  credentialGroupId?: string
}

export interface ChatRequest {
  provider: AIProvider
  model: string
  messages: {
    role: 'user' | 'assistant'
    content: string | ContentPart[]
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
  type: 'text'
  text: string
}

export interface ImageContentPart {
  type: 'image_url'
  image_url: {
    url: string
    detail?: 'auto' | 'high' | 'low'
  }
}

export { getSecureApiKey }

type OpenAIModelListItem = {
  id?: string
  object?: string
  name?: string
  display_name?: string
  context_length?: number
  contextWindow?: number
  context_window?: number
  max_context_length?: number
  max_output_length?: number
  max_completion_tokens?: number
  max_tokens?: number
  maxOutputTokens?: number
  architecture?: {
    input_modalities?: string[]
    modality?: string
  }
  metadata?: Record<string, unknown>
}

type OpenAIModelListResponse = {
  data?: OpenAIModelListItem[]
}

type AnthropicModelListItem = {
  id?: string
  display_name?: string
  type?: string
  max_input_tokens?: number
  max_tokens?: number
  capabilities?: string[] | Record<string, unknown>
}

type AnthropicModelListResponse = {
  data?: AnthropicModelListItem[]
}

type GoogleModelListResponse = {
  models?: {
    name?: string
    displayName?: string
    inputTokenLimit?: number
    outputTokenLimit?: number
    supportedGenerationMethods?: string[]
  }[]
}

interface ParsedStreamChunk {
  text: string
  traces: ProcessTrace[]
  usage?: MessageUsage
  responseId?: string
}

const PROVIDER_REQUEST_TIMEOUT_MS = 18000
const MODEL_TEST_TIMEOUT_MS = 22000
const CHAT_REQUEST_TIMEOUT_MS = 60000
const CIRCUIT_STATES = new Map<string, { failures: number; openedUntil?: number }>()

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
  return parseStreamChunk(chunk, providerType)
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
  return mergeAliasAccessPolicy(requested, upstream)
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
    msgs.push({ role: msg.role, content: msg.content })
  }

  if (req.attachments?.length) {
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
        ...req.attachments
          .filter((a) => a.base64)
          .map(openAICompatibleAttachmentPart),
      ]
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages: msgs,
    stream: req.stream ?? true,
  }

  const deepSeekThinking = normalizeDeepSeekThinking(req)
  const temperature = deepSeekThinking?.type === 'enabled' ? undefined : normalizeTemperature(req)
  if (temperature !== undefined) {
    body.temperature = temperature
  }
  if (req.topP !== undefined && deepSeekThinking?.type !== 'enabled') body.top_p = clamp01(req.topP)
  if (deepSeekThinking) {
    body.thinking = { type: deepSeekThinking.type }
    if (deepSeekThinking.effort) body.reasoning_effort = deepSeekThinking.effort
  } else {
    const openAIEffort = normalizeOpenAIReasoningEffort(req)
    if (openAIEffort) body.reasoning_effort = openAIEffort
    const mimoReasoning = normalizeXiaomiMimoReasoning(req)
    if (mimoReasoning) body.reasoning = mimoReasoning
  }

  const maxTokensKey = getOpenAIChatMaxTokensField(req)
  body[maxTokensKey] = clampMaxTokens(req)

  return body
}

function getOpenAIChatMaxTokensField(req: ChatRequest): 'max_completion_tokens' | 'max_tokens' {
  if (req.provider.type === 'openai') return 'max_completion_tokens'
  if (req.provider.type === 'xiaomi-mimo') return 'max_completion_tokens'
  return 'max_tokens'
}

function openAICompatibleAttachmentPart(attachment: Attachment): Record<string, unknown> {
  if (attachment.type === 'image') {
    return {
      type: 'image_url',
      image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}`, detail: 'auto' },
    }
  }
  return {
    type: 'file',
    file: {
      filename: attachment.name,
      file_data: `data:${attachment.mimeType};base64,${attachment.base64}`,
    },
  }
}

function buildXiaomiMimoAnthropicBody(req: ChatRequest) {
  return buildAnthropicBody({ ...req, stream: req.stream ?? true })
}

function buildAnthropicBody(req: ChatRequest) {
  const system = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n') || undefined
  const messages: Record<string, unknown>[] = []
  const thinkingConfig = normalizeAnthropicThinking(req)
  const temperature = thinkingConfig ? undefined : req.temperature ?? 0.7
  const topP = thinkingConfig ? undefined : req.topP ?? 1

  for (const msg of req.messages) {
    if (msg.role === 'user') {
      const content: Record<string, unknown>[] = []
      const textContent = typeof msg.content === 'string' ? msg.content : msg.content.map((p: ContentPart) => p.text).join('\n')

      content.push({ type: 'text', text: textContent })

      if (req.attachments?.length && msg === req.messages[req.messages.length - 1]) {
        for (const att of req.attachments) {
          if (att.base64) {
            if (att.type === 'image') {
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: att.mimeType,
                  data: att.base64,
                },
              })
            } else if (att.type === 'pdf' || att.type === 'text') {
              content.push({
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: att.mimeType,
                  data: att.base64,
                },
              })
            }
          }
        }
      }

      messages.push({ role: 'user', content })
    } else {
      messages.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
      })
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    system,
    messages,
    max_tokens: clampMaxTokens(req),
    stream: req.stream ?? true,
    ...(req.webSearchMode === 'native' ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}),
  }
  if (temperature !== undefined) body.temperature = temperature
  if (topP !== undefined) body.top_p = topP
  if (thinkingConfig?.thinking) body.thinking = thinkingConfig.thinking
  if (thinkingConfig?.outputConfig) body.output_config = thinkingConfig.outputConfig
  const mimoReasoning = normalizeXiaomiMimoReasoning(req)
  if (mimoReasoning) body.reasoning = mimoReasoning
  return body
}

function buildGoogleBody(req: ChatRequest) {
  const contents: Record<string, unknown>[] = []
  const systemPrompt = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n')
  const systemInstruction = systemPrompt
    ? { parts: [{ text: systemPrompt }] }
    : undefined

  for (const msg of req.messages) {
    const parts: Record<string, unknown>[] = []
    const textContent = typeof msg.content === 'string' ? msg.content : msg.content.map((p: ContentPart) => p.text).join('\n')

    parts.push({ text: textContent })

    if (msg.role === 'user' && msg === req.messages[req.messages.length - 1] && req.attachments?.length) {
      for (const att of req.attachments) {
        if (att.base64) {
          parts.push({
            inline_data: {
              mime_type: att.mimeType,
              data: att.base64,
            },
          })
        }
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

  return {
    contents,
    systemInstruction,
    generationConfig,
    ...(req.webSearchMode === 'native' ? { tools: [{ google_search: {} }] } : {}),
  }
}

function buildOpenAIResponsesBody(req: ChatRequest) {
  const input: Record<string, unknown>[] = []
  const systemPrompt = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n')
  if (systemPrompt) {
    input.push({ role: 'system', content: systemPrompt })
  }
  for (const [index, message] of req.messages.entries()) {
    const text = typeof message.content === 'string' ? message.content : message.content.map((part) => part.text).join('\n')
    const isLast = index === req.messages.length - 1
    if (message.role === 'user' && isLast && req.attachments?.length) {
      input.push({
        role: 'user',
        content: [
          { type: 'input_text', text },
          ...req.attachments.map((attachment) => {
            if (attachment.type === 'image') {
              return {
                type: 'input_image',
                image_url: `data:${attachment.mimeType};base64,${attachment.base64}`,
              }
            }
            return {
              type: 'input_file',
              filename: attachment.name,
              file_data: `data:${attachment.mimeType};base64,${attachment.base64}`,
            }
          }),
        ],
      })
    } else {
      input.push({ role: message.role, content: text })
    }
  }
  const openAIEffort = normalizeOpenAIReasoningEffort(req)
  return {
    model: req.model,
    input,
    ...(normalizeTemperature(req) === undefined ? {} : { temperature: normalizeTemperature(req) }),
    ...(req.topP === undefined ? {} : { top_p: clamp01(req.topP) }),
    ...(openAIEffort ? { reasoning: { effort: openAIEffort } } : {}),
    max_output_tokens: clampMaxTokens(req),
    stream: req.stream ?? true,
    ...(req.previousResponseId ? { previous_response_id: req.previousResponseId } : {}),
    ...(req.remoteCompactEligible
      ? { context_management: [{ type: 'compaction', compact_threshold: req.settings?.remoteCompactThreshold ?? 0.8 }] }
      : {}),
    ...(req.webSearchMode === 'native' ? { tools: [{ type: 'web_search_preview' }] } : {}),
  }
}

function usesOpenAIResponses(req: ChatRequest): boolean {
  if (req.provider.type !== 'openai') return false
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return modelConfig.preferredEndpoint === 'responses' || req.webSearchMode === 'native' || !!req.attachments?.some((attachment) => attachment.type !== 'image')
}

function isOpenAIReasoningModel(modelId: string): boolean {
  return isKnownOpenAIReasoningModel({
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    models: [],
    enabled: true,
  }, modelId)
}

function normalizeOpenAIReasoningEffort(req: ChatRequest): ReasoningEffort | undefined {
  if (!req.reasoningEffort || !supportsReasoningEffort(req)) return undefined
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (req.provider.type !== 'openai' && modelConfig.reasoningMode !== 'openai-effort') return undefined
  const supported = getReasoningEffortOptions(req.provider, req.model)
  if (!supported.length) return undefined
  const effort = req.reasoningEffort
  if (supported.includes(effort)) return effort
  if (effort === 'minimal' && supported.includes('low')) return 'low'
  if (effort === 'xhigh' && supported.includes('high')) return 'high'
  if (effort === 'none' && supported.includes('low')) return 'low'
  return supported.includes('medium') ? 'medium' : supported[0]
}

function normalizeDeepSeekThinking(req: ChatRequest): { type: 'enabled' | 'disabled'; effort?: 'high' | 'max' } | undefined {
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (modelConfig.reasoningMode !== 'deepseek-thinking' && !isDeepSeekThinkingModel(req.provider, req.model)) return undefined
  const effort = req.reasoningEffort ?? 'medium'
  if (effort === 'none' || effort === 'minimal') return { type: 'disabled' }
  return { type: 'enabled', effort: effort === 'xhigh' ? 'max' : 'high' }
}

function normalizeXiaomiMimoReasoning(req: ChatRequest): { effort: 'low' | 'medium' | 'high' } | undefined {
  if (!req.reasoningEffort || req.reasoningEffort === 'none') return undefined
  if (!isXiaomiMimoReasoningModel(req.provider, req.model)) return undefined
  if (req.reasoningEffort === 'minimal' || req.reasoningEffort === 'low') return { effort: 'low' }
  if (req.reasoningEffort === 'high' || req.reasoningEffort === 'xhigh') return { effort: 'high' }
  return { effort: 'medium' }
}

function normalizeAnthropicThinking(req: ChatRequest): { thinking: Record<string, unknown>; outputConfig?: Record<string, unknown> } | undefined {
  if (!req.reasoningEffort || req.reasoningEffort === 'none' || req.reasoningEffort === 'minimal') return undefined
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  if (config.reasoningMode !== 'anthropic-thinking' && !isClaudeThinkingModel(req.provider, req.model)) return undefined
  if (supportsAnthropicAdaptiveThinking(req.model)) {
    return {
      thinking: { type: 'adaptive', display: 'summarized' },
      outputConfig: { effort: normalizeAnthropicEffort(req.model, req.reasoningEffort) },
    }
  }
  const maxTokens = clampMaxTokens(req)
  const floor = Math.min(1024, Math.max(128, maxTokens - 1))
  const preferred = (() => {
    switch (req.reasoningEffort) {
      case 'low':
        return 1024
      case 'high':
        return 4096
      case 'xhigh':
        return 8192
      case 'medium':
      default:
        return 2048
    }
  })()
  const budget = Math.min(Math.max(floor, preferred), Math.max(1, maxTokens - 1))
  return budget > 0 ? { thinking: { type: 'enabled', budget_tokens: budget } } : undefined
}

function supportsAnthropicAdaptiveThinking(modelId: string): boolean {
  const normalized = modelId.toLowerCase()
  return /claude-(mythos|opus-4-7|opus-4-6|sonnet-4-6)/.test(normalized)
}

function normalizeAnthropicEffort(modelId: string, effort: ReasoningEffort): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  if (effort === 'low') return 'low'
  if (effort === 'medium') return 'medium'
  if (effort === 'xhigh') return /claude-opus-4-7/i.test(modelId) ? 'xhigh' : 'max'
  return 'high'
}

function normalizeGoogleThinkingConfig(req: ChatRequest): Record<string, unknown> | undefined {
  if (!req.reasoningEffort) return undefined
  const config = getModelConfig(req.model, 'google', req.provider.modelConfigs)
  if (config.reasoningMode === 'gemini-thinking-level' || /^gemini-3/i.test(req.model)) {
    const level = normalizeGeminiThinkingLevel(req.reasoningEffort, config)
    return level ? { thinkingLevel: level } : undefined
  }
  if (config.reasoningMode === 'gemini-thinking-budget' || isGeminiThinkingModel(req.provider, req.model)) {
    return { thinkingBudget: normalizeGeminiThinkingBudget(req.model, req.reasoningEffort) }
  }
  return undefined
}

function normalizeGeminiThinkingLevel(effort: ReasoningEffort, config: AIModel): 'minimal' | 'low' | 'medium' | 'high' | undefined {
  const requested = effort === 'none' ? 'minimal' : effort === 'xhigh' ? 'high' : effort
  const allowed = config.reasoningEfforts ?? ['minimal', 'low', 'medium', 'high']
  if (requested === 'minimal' && !allowed.includes('minimal')) return 'low'
  if (['minimal', 'low', 'medium', 'high'].includes(requested) && allowed.includes(requested as ReasoningEffort)) {
    return requested as 'minimal' | 'low' | 'medium' | 'high'
  }
  return allowed.includes('medium') ? 'medium' : 'high'
}

function normalizeGeminiThinkingBudget(modelId: string, effort: ReasoningEffort): number {
  const normalized = modelId.toLowerCase()
  const max = normalized.includes('flash') ? 24576 : 32768
  const canDisable = normalized.includes('flash') && !normalized.includes('flash-lite')
  switch (effort) {
    case 'none':
    case 'minimal':
      return canDisable ? 0 : normalized.includes('flash-lite') ? 512 : 128
    case 'low':
      return normalized.includes('flash') ? 1024 : 2048
    case 'high':
      return Math.min(max, 8192)
    case 'xhigh':
      return max
    case 'medium':
    default:
      return -1
  }
}

function normalizeTemperature(req: ChatRequest): number | undefined {
  const modelId = req.model.toLowerCase()
  if (req.provider.type === 'xiaomi-mimo') {
    const isThinkingDefault = ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-pro', 'mimo-v2-omni'].includes(modelId)
    if (isThinkingDefault) return undefined
    return Math.max(0, Math.min(1.5, req.temperature ?? 0.7))
  }
  return req.temperature ?? 0.7
}

function clampMaxTokens(req: ChatRequest): number {
  const config = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  const requested = req.maxTokens ?? config.defaultMaxTokens
  return Math.max(1, Math.min(config.maxOutputTokens, requested))
}

function getHeaders(provider: AIProvider): Record<string, string> {
  switch (provider.type) {
    case 'openai':
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      }
    case 'anthropic':
      return {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01',
      }
    case 'google':
      return { 'Content-Type': 'application/json' }
    case 'openai-compatible':
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      }
    case 'xiaomi-mimo':
      if (provider.wireProtocol === 'anthropic-compatible') {
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          'anthropic-version': '2023-06-01',
        }
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      }
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
      body = buildOpenAIBody(req)
      break
    case 'xiaomi-mimo':
      body = req.provider.wireProtocol === 'anthropic-compatible' ? buildXiaomiMimoAnthropicBody(req) : buildOpenAIBody(req)
      break
  }
  return resolveProviderRoute({ request: req, body, context, failover })
}

function getWireProviderType(provider: AIProvider): ProviderType {
  return provider.type === 'xiaomi-mimo' && provider.wireProtocol === 'anthropic-compatible'
    ? 'anthropic'
    : provider.type
}

function optimizeRequestBody(body: Record<string, unknown>, req: ChatRequest): Record<string, unknown> {
  if (!isBedrockProvider(req.provider) || req.settings?.bedrockRequestOptimizerEnabled !== true) return body
  let next = { ...body }
  if (req.settings.thinkingOptimizerEnabled === true) {
    next = optimizeBedrockThinking(next, req)
  }
  if (req.settings.cacheInjectionEnabled === true) {
    next = injectBedrockCache(next, req.settings.cacheTtl ?? 'default')
  }
  return next
}

function optimizeBedrockThinking(body: Record<string, unknown>, req: ChatRequest): Record<string, unknown> {
  if (!isAnthropicWireRequest(req)) return body
  if (supportsAnthropicAdaptiveThinking(req.model)) {
    return {
      ...body,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { ...(body.output_config as Record<string, unknown> | undefined), effort: normalizeAnthropicEffort(req.model, req.reasoningEffort ?? 'medium') },
    }
  }
  if (body.thinking) return body
  const maxTokens = numberValue(body.max_tokens) ?? clampMaxTokens(req)
  return {
    ...body,
    thinking: { type: 'enabled', budget_tokens: Math.min(32000, Math.max(1024, maxTokens - 1)) },
    max_tokens: Math.max(maxTokens, 4096),
  }
}

function injectBedrockCache(body: Record<string, unknown>, ttl: 'default' | '5m' | '1h'): Record<string, unknown> {
  const cacheControl = ttl === 'default'
    ? { type: 'ephemeral' }
    : { type: 'ephemeral', ttl }
  const next = { ...body }
  if (typeof next.system === 'string' && next.system.trim()) {
    next.system = [{ type: 'text', text: next.system, cache_control: cacheControl }]
  }
  if (Array.isArray(next.messages)) {
    next.messages = next.messages.map((message, index) => {
      if (!message || typeof message !== 'object') return message
      const record = message as Record<string, unknown>
      if (!Array.isArray(record.content) || index !== 0 && index !== (next.messages as unknown[]).length - 1) return record
      return { ...record, content: addCacheControlToLastTextPart(record.content, cacheControl) }
    })
  }
  return next
}

function addCacheControlToLastTextPart(content: unknown[], cacheControl: Record<string, unknown>): unknown[] {
  const next = [...content]
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const part = next[index]
    if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
      next[index] = { ...(part as Record<string, unknown>), cache_control: cacheControl }
      break
    }
  }
  return next
}

function isAnthropicWireRequest(req: ChatRequest): boolean {
  return getWireProviderType(req.provider) === 'anthropic'
}

function isBedrockProvider(provider: AIProvider): boolean {
  const text = [provider.id, provider.name, provider.baseUrl, provider.presetId, provider.detectedPresetId].filter(Boolean).join(' ').toLowerCase()
  return /\bbedrock\b|bedrock-runtime|bedrock\.[a-z0-9-]+\.amazonaws\.com/.test(text)
}

function extractContent(chunk: string, providerType: ProviderType): string {
  return parseStreamChunk(chunk, providerType).text
}

function parseStreamChunk(chunk: string, providerType: ProviderType): ParsedStreamChunk {
  const traces: ProcessTrace[] = []
  let text = ''
  let usage: MessageUsage | undefined
  let responseId: string | undefined
  let sawDataLine = false
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    sawDataLine = true
    try {
      const json = JSON.parse(line.slice(6))
      const parsed = parseProviderStreamEvent(json, providerType)
      text += parsed.text
      traces.push(...parsed.traces)
      usage = parsed.usage ?? usage
      responseId = parsed.responseId ?? responseId
    } catch {}
  }
  const trimmed = chunk.trim()
  if (!sawDataLine && trimmed.startsWith('{')) {
    try {
      const parsed = parseProviderStreamEvent(JSON.parse(trimmed), providerType)
      return { text: parsed.text, traces: dedupeTraces(parsed.traces), usage: parsed.usage, responseId: parsed.responseId }
    } catch {}
  }
  return { text, traces: dedupeTraces(traces), usage, responseId }
}

function parseProviderStreamEvent(json: any, providerType: ProviderType): ParsedStreamChunk {
  switch (providerType) {
    case 'openai':
    case 'openai-compatible':
    case 'xiaomi-mimo': {
      let text = isDoneEvent(json.type) ? '' : extractOpenAIText(json)
      const traces: ProcessTrace[] = []
      const delta = json.choices?.[0]?.delta
      if (json.type === 'response.output_text.delta' || json.type === 'response.refusal.delta') {
        text += stringValue(json.delta)
      }
      const reasoning = [
        delta?.reasoning_content,
        json.choices?.[0]?.message?.reasoning_content,
        json.delta?.reasoning_content,
        json.reasoning_content,
        json.summary?.text,
        json.part?.text,
        json.text && isReasoningEventType(json.type) ? json.text : undefined,
        json.delta && isReasoningEventType(json.type) ? json.delta : undefined,
      ].map(stringValue).filter(Boolean).join('')
      if (reasoning) {
        traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), reasoning, 'running', stableTraceId(json, 'reasoning')))
      }
      if (isToolEventType(json.type) || delta?.tool_calls || json.tool_call || json.function_call || json.item?.type?.includes?.('tool')) {
        traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCall'), summarizeToolEvent(json), isDoneEvent(json.type) ? 'done' : 'running', stableTraceId(json, 'tool')))
      }
      return { text, traces, usage: extractUsage(json, providerType === 'openai' ? 'openai' : 'openai-compatible'), responseId: extractResponseId(json) }
    }
    case 'anthropic': {
      let text = ''
      const traces: ProcessTrace[] = []
      if (json.type === 'content_block_delta') {
        text += stringValue(json.delta?.text)
        const thinking = stringValue(json.delta?.thinking)
        if (thinking) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), thinking, 'running', stableTraceId(json, 'thinking')))
        const signature = stringValue(json.delta?.signature)
        if (signature) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.thoughtSignature'), st('providerTrace.signatureSaved'), 'done', stableTraceId(json, 'signature'), { hiddenSignature: true }))
      }
      if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
        traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCallNamed', { name: json.content_block?.name ?? 'tool' }), summarizeToolEvent(json.content_block), 'running', stableTraceId(json, 'tool')))
      }
      if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
        traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolArguments'), stringValue(json.delta?.partial_json), 'running', stableTraceId(json, 'tool-input')))
      }
      return { text, traces, usage: extractUsage(json, 'anthropic') }
    }
    case 'google': {
      let text = ''
      const traces: ProcessTrace[] = []
      const parts = json.candidates?.[0]?.content?.parts
      if (parts) {
        for (const part of parts) {
          const partText = stringValue(part.text)
          if (part.thought) {
            if (partText) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), partText, 'running', stableTraceId(part, 'thought')))
            if (part.thoughtSignature) {
              traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.thoughtSignature'), st('providerTrace.thoughtSignatureSaved'), 'done', stableTraceId(part, 'thought-signature'), { hiddenSignature: true }))
            }
          } else if (part.functionCall) {
            traces.push(createProviderTrace('tool', providerType, st('providerTrace.functionCallNamed', { name: part.functionCall.name ?? 'function' }), summarizeToolEvent(part.functionCall), 'running', stableTraceId(part.functionCall, 'function')))
          } else {
            text += partText
          }
        }
      }
      return { text, traces, usage: extractUsage(json, 'google') }
    }
    default:
      return { text: '', traces: [] }
  }
}

function extractCitationsFromText(text: string, sources: RetrievalSource[] = []): MessageCitation[] {
  return sources.map((source) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    excerpt: source.excerpt || source.content.slice(0, 180),
    url: source.url,
    documentId: source.documentId,
    chunkId: source.chunkId,
    score: source.score,
    ftsScore: source.ftsScore,
    vectorScore: source.vectorScore,
    chunkIndex: source.chunkIndex,
    similarityScore: source.similarityScore,
    sourceUri: source.sourceUri,
    retrievalMode: source.retrievalMode,
  }))
}

function extractProviderCitations(json: unknown, providerType: ProviderType): MessageCitation[] {
  const citations: MessageCitation[] = []
  if (!json || typeof json !== 'object') return citations
  const value = json as Record<string, unknown>
  if (providerType === 'anthropic') {
    const content = Array.isArray(value.content) ? value.content : []
    for (const part of content) {
      const item = part as Record<string, unknown>
      if (item.type === 'web_search_result') {
        const url = typeof item.url === 'string' ? item.url : undefined
        const title = typeof item.title === 'string' ? item.title : url || 'Web Search'
        citations.push({
          id: url || title,
          type: 'web',
          title,
          url,
          excerpt: typeof item.encrypted_content === 'string' ? undefined : typeof item.page_age === 'string' ? item.page_age : undefined,
        })
      }
    }
  }
  if (providerType === 'google') {
    const candidates = Array.isArray(value.candidates) ? value.candidates : []
    for (const candidate of candidates) {
      const metadata = (candidate as Record<string, unknown>).groundingMetadata as Record<string, unknown> | undefined
      const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : []
      for (const chunk of chunks) {
        const web = (chunk as Record<string, unknown>).web as Record<string, unknown> | undefined
        if (web?.uri || web?.title) {
          citations.push({
            id: String(web.uri || web.title),
            type: 'web',
            title: String(web.title || web.uri || 'Google Search'),
            url: web.uri ? String(web.uri) : undefined,
          })
        }
      }
    }
  }
  return citations
}

function extractProviderCitationsFromSse(event: string, providerType: ProviderType): MessageCitation[] {
  const citations: MessageCitation[] = []
  for (const line of event.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    try {
      citations.push(...extractProviderCitations(JSON.parse(line.slice(6)), providerType))
    } catch {}
  }
  return dedupeCitations(citations)
}

function dedupeCitations(citations: MessageCitation[]): MessageCitation[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    const key = `${citation.type}:${citation.url || citation.id || citation.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function dedupeTraces(traces: ProcessTrace[]): ProcessTrace[] {
  const seen = new Set<string>()
  return traces.filter((trace) => {
    const key = trace.id || `${trace.type}:${trace.title}:${trace.content ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function createProviderTrace(
  type: ProcessTrace['type'],
  providerType: ProviderType,
  title: string,
  content: string,
  status: ProcessTrace['status'],
  id: string,
  metadata?: Record<string, unknown>
): ProcessTrace {
  const now = Date.now()
  return {
    id,
    type,
    title,
    content: sanitizeTraceContent(content),
    status,
    startedAt: now,
    completedAt: status === 'done' || status === 'error' || status === 'skipped' ? now : undefined,
    metadata: {
      providerType,
      source: 'provider',
      ...metadata,
    },
  }
}

function sanitizeTraceContent(content: string): string | undefined {
  const trimmed = content.trim()
  if (!trimmed) return undefined
  return trimmed.length > 760 ? `${trimmed.slice(0, 760)}...` : trimmed
}

function stableTraceId(json: any, fallback: string): string {
  const raw = [
    fallback,
    json?.id,
    json?.item_id,
    json?.output_index,
    json?.content_block?.id,
    json?.content_block?.name,
    json?.index,
    json?.type,
  ].filter((part) => part !== undefined && part !== null).join('-')
  return raw || `${fallback}-${Date.now()}`
}

function isReasoningEventType(type: unknown): boolean {
  if (typeof type !== 'string') return false
  return type.includes('reasoning') || type.includes('thinking') || type.includes('summary')
}

function isToolEventType(type: unknown): boolean {
  if (typeof type !== 'string') return false
  return type.includes('tool') || type.includes('function_call') || type.includes('web_search')
}

function isDoneEvent(type: unknown): boolean {
  return typeof type === 'string' && (type.endsWith('.done') || type.endsWith('_stop') || type.endsWith('.completed'))
}

function summarizeToolEvent(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const item = value as Record<string, unknown>
  const name =
    stringValue(item.name) ||
    stringValue((item.function as Record<string, unknown> | undefined)?.name) ||
    stringValue((item.tool_call as Record<string, unknown> | undefined)?.name) ||
    stringValue((item.item as Record<string, unknown> | undefined)?.name)
  const input = item.input ?? item.arguments ?? item.args ?? (item.function as Record<string, unknown> | undefined)?.arguments ?? item.delta ?? item
  const inputText = typeof input === 'string' ? input : safeJsonPreview(input)
  return [name ? st('providerTrace.toolNameLine', { name }) : '', inputText ? st('providerTrace.toolArgsLine', { input: inputText }) : ''].filter(Boolean).join('\n')
}

function safeJsonPreview(value: unknown): string {
  try {
    const raw = JSON.stringify(value)
    return raw.length > 360 ? `${raw.slice(0, 360)}...` : raw
  } catch {
    return ''
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function extractOpenAIText(json: any): string {
  return [
    stringValue(json?.output_text),
    stringValue(json?.choices?.[0]?.delta?.content),
    stringValue(json?.choices?.[0]?.message?.content),
    extractOpenAIOutputText(json?.output),
  ].filter(Boolean).join('')
}

function extractResponseId(json: any): string | undefined {
  return stringValue(json?.response?.id) || stringValue(json?.id) || stringValue(json?.response_id)
}

function extractOpenAIOutputText(output: unknown): string {
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const value = item as Record<string, unknown>
    parts.push(stringValue(value.text))
    const content = value.content
    if (typeof content === 'string') {
      parts.push(content)
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (!part || typeof part !== 'object') continue
        const contentPart = part as Record<string, unknown>
        parts.push(stringValue(contentPart.text))
      }
    }
  }
  return parts.filter(Boolean).join('')
}

function splitSseBuffer(buffer: string): { events: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  return { events: parts, remainder }
}

async function parseNonStreamingText(response: Response, providerType: ProviderType): Promise<string> {
  const body = await readResponseBody(response)
  const json = body.json
  if (!json) return body.text.trim()
  switch (providerType) {
    case 'openai':
    case 'openai-compatible':
    case 'xiaomi-mimo':
      return json.output_text ?? json.choices?.[0]?.message?.content ?? ''
    case 'anthropic':
      return extractAnthropicText(json)
    case 'google':
      return extractGoogleText(json)
  }
}

async function parseNonStreamingResponse(response: Response, req: ChatRequest): Promise<ChatCompletionResult> {
  const body = await readResponseBody(response)
  if (!body.json) {
    return {
      text: body.text.trim(),
      citations: body.text.trim() ? extractCitationsFromText(body.text, req.retrievalSources) : [],
    }
  }
  return parseChatCompletionJson(body.json, req)
}

async function readResponseBody(response: Response): Promise<{ text: string; json: any | null }> {
  const text = await safeResponseText(response)
  const trimmed = text.trim()
  if (!trimmed) return { text, json: null }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { text, json: null }
  }
  try {
    return { text, json: JSON.parse(trimmed) }
  } catch {
    return { text, json: null }
  }
}

function parseChatCompletionJson(json: any, req: ChatRequest): ChatCompletionResult {
  const providerType = getWireProviderType(req.provider)
  switch (providerType) {
    case 'openai':
      const openAIText = extractOpenAIText(json)
      return {
        text: openAIText,
        usage: extractUsage(json, providerType),
        citations: extractCitationsFromText(openAIText, req.retrievalSources),
        traces: extractTracesFromJson(json, providerType),
        responseId: extractResponseId(json),
      }
    case 'anthropic':
      return {
        text: extractAnthropicText(json),
        usage: extractUsage(json, 'anthropic'),
        citations: [...extractCitationsFromText('', req.retrievalSources), ...extractProviderCitations(json, 'anthropic')],
        traces: extractTracesFromJson(json, 'anthropic'),
      }
    case 'google':
      return {
        text: extractGoogleText(json),
        usage: extractUsage(json, 'google'),
        citations: [...extractCitationsFromText('', req.retrievalSources), ...extractProviderCitations(json, 'google')],
        traces: extractTracesFromJson(json, 'google'),
      }
    case 'openai-compatible':
    case 'xiaomi-mimo':
      const compatibleText = extractOpenAIText(json)
      return {
        text: compatibleText,
        usage: extractUsage(json, 'openai-compatible'),
        citations: extractCitationsFromText(compatibleText, req.retrievalSources),
        traces: extractTracesFromJson(json, providerType),
        responseId: extractResponseId(json),
      }
  }
}

function parseBufferedStreamResponse(raw: string, req: ChatRequest, providerType: ProviderType): ChatCompletionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '' }

  if (trimmed.startsWith('{')) {
    try {
      return parseChatCompletionJson(JSON.parse(trimmed), req)
    } catch {
      // Fall through to SSE parsing; some polyfills return concatenated chunks.
    }
  }

  const parsed = parseStreamChunk(raw, providerType)
  const text = parsed.text
  const citations = dedupeCitations([
    ...extractCitationsFromText(text, req.retrievalSources),
    ...extractProviderCitationsFromSse(raw, providerType),
  ])
  return { text, citations, traces: parsed.traces, usage: parsed.usage, responseId: parsed.responseId }
}

function extractTracesFromJson(json: any, providerType: ProviderType): ProcessTrace[] {
  const traces: ProcessTrace[] = []
  if (providerType === 'openai' || providerType === 'openai-compatible' || providerType === 'xiaomi-mimo') {
    const reasoning = [
      json.choices?.[0]?.message?.reasoning_content,
      json.reasoning?.summary?.map?.((item: { text?: string }) => item.text ?? '').join('\n'),
      Array.isArray(json.output)
        ? json.output
            .filter((item: Record<string, unknown>) => stringValue(item.type).includes('reasoning'))
            .map((item: Record<string, unknown>) => stringifyOpenAIReasoningItem(item))
            .filter(Boolean)
            .join('\n')
        : '',
    ].map(stringValue).filter(Boolean).join('\n')
    if (reasoning) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), reasoning, 'done', stableTraceId(json, 'reasoning-json')))
    if (Array.isArray(json.output)) {
      for (const item of json.output) {
        const record = item as Record<string, unknown>
        if (isToolEventType(record.type)) {
          traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCall'), summarizeToolEvent(record), 'done', stableTraceId(record, 'tool-json')))
        }
      }
    }
  }
  if (providerType === 'anthropic' && Array.isArray(json.content)) {
    for (const part of json.content) {
      const item = part as Record<string, unknown>
      if (item.type === 'thinking') traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), stringValue(item.thinking), 'done', stableTraceId(item, 'thinking-json')))
      if (item.type === 'tool_use') traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCallNamed', { name: stringValue(item.name) || 'tool' }), summarizeToolEvent(item), 'done', stableTraceId(item, 'tool-json')))
    }
  }
  if (providerType === 'google') {
    const parts = json.candidates?.[0]?.content?.parts
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.thought && part.text) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), stringValue(part.text), 'done', stableTraceId(part, 'thought-json')))
        if (part.functionCall) traces.push(createProviderTrace('tool', providerType, st('providerTrace.functionCallNamed', { name: part.functionCall.name ?? 'function' }), summarizeToolEvent(part.functionCall), 'done', stableTraceId(part.functionCall, 'function-json')))
        if (part.thoughtSignature) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.thoughtSignature'), st('providerTrace.thoughtSignatureSaved'), 'done', stableTraceId(part, 'thought-signature-json'), { hiddenSignature: true }))
      }
    }
  }
  return dedupeTraces(traces)
}

function extractAnthropicText(json: any): string {
  const content = Array.isArray(json.content) ? json.content : []
  return content.map((part: { type?: string; text?: string }) => part.type === 'text' || part.text ? part.text ?? '' : '').join('')
}

function extractGoogleText(json: any): string {
  const parts = json.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.map((part: { text?: string; thought?: boolean; functionCall?: unknown }) => part.thought || part.functionCall ? '' : part.text ?? '').join('')
}

function stringifyOpenAIReasoningItem(item: Record<string, unknown>): string {
  const summary = item.summary
  if (Array.isArray(summary)) {
    return summary.map((part) => typeof part === 'string' ? part : stringValue((part as Record<string, unknown>)?.text)).filter(Boolean).join('\n')
  }
  return stringValue(item.text) || stringValue(item.content)
}

function extractUsage(json: Record<string, unknown>, providerType: ProviderType): MessageUsage | undefined {
  if (providerType === 'anthropic') {
    const usage = json.usage as Record<string, unknown> | undefined
    const inputTokens = numberValue(usage?.input_tokens)
    const outputTokens = numberValue(usage?.output_tokens)
    if (!inputTokens && !outputTokens) return undefined
    return {
      inputTokens,
      outputTokens,
      totalTokens: sumOptional(inputTokens, outputTokens),
      source: 'provider',
    }
  }

  if (providerType === 'google') {
    const usage = json.usageMetadata as Record<string, unknown> | undefined
    const inputTokens = numberValue(usage?.promptTokenCount)
    const outputTokens = numberValue(usage?.candidatesTokenCount)
    const reasoningTokens = numberValue(usage?.thoughtsTokenCount)
    const totalTokens = numberValue(usage?.totalTokenCount) ?? sumOptional(inputTokens, outputTokens, reasoningTokens)
    if (!inputTokens && !outputTokens && !totalTokens) return undefined
    return { inputTokens, outputTokens, totalTokens, reasoningTokens, source: 'provider' }
  }

  const usage = json.usage as Record<string, unknown> | undefined
  const inputTokens = numberValue(usage?.input_tokens) ?? numberValue(usage?.prompt_tokens)
  const outputTokens = numberValue(usage?.output_tokens) ?? numberValue(usage?.completion_tokens)
  const totalTokens = numberValue(usage?.total_tokens) ?? sumOptional(inputTokens, outputTokens)
  const outputDetails = usage?.output_tokens_details as Record<string, unknown> | undefined
  const completionDetails = usage?.completion_tokens_details as Record<string, unknown> | undefined
  const reasoningTokens = numberValue(outputDetails?.reasoning_tokens) ?? numberValue(completionDetails?.reasoning_tokens)
  if (!inputTokens && !outputTokens && !totalTokens) return undefined
  return { inputTokens, outputTokens, totalTokens, reasoningTokens, source: 'provider' }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sumOptional(...values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return known.length ? known.reduce((sum, value) => sum + value, 0) : undefined
}

function withCredentialGroup(result: ChatCompletionResult, credentialGroupId: string | undefined): ChatCompletionResult {
  return credentialGroupId ? { ...result, credentialGroupId } : result
}

function providerRuntimeError(message: string, credentialGroupId?: string): ProviderRuntimeError {
  const error = new Error(message) as ProviderRuntimeError
  error.credentialGroupId = credentialGroupId
  return error
}

function mergeAliasAccessPolicy(requested: ReturnType<typeof resolveProviderModelAccess>, upstream: ReturnType<typeof resolveProviderModelAccess>): ReturnType<typeof resolveProviderModelAccess> {
  if (!requested.allowed && requested.reason !== 'model_not_allowed') return requested
  if (!upstream.allowed && upstream.reason !== 'model_not_allowed') return upstream
  if (requested.allowed || upstream.allowed) {
    return {
      allowed: true,
      providerId: requested.providerId,
      model: requested.model,
      matchedRules: [...requested.matchedRules, ...upstream.matchedRules],
    }
  }
  return upstream
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
  const access = mergeAliasAccessPolicy(requestedAccess, upstreamAccess)
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
  if (effectiveReq.signal) {
    effectiveReq.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const stream = effectiveReq.stream ?? true
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
  const body = JSON.stringify(rawBody)
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
          url: proxyPolicy.effectiveUrl,
          headers,
          body,
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
    url: proxyPolicy.effectiveUrl,
    headers,
    body,
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
    input.onError(providerRuntimeError(formatProviderHttpError(response.status, errorText, input.req.provider, input.req.model), input.credentialGroupId))
    return
  }

  if (!input.stream) {
    const result = await parseNonStreamingResponse(response, input.req)
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
    const result = parseBufferedStreamResponse(raw, input.req, getWireProviderType(input.req.provider))
    if (result.text) {
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
  let providerUsage: MessageUsage | undefined
  const wireProviderType = getWireProviderType(input.req.provider)

  async function readStream() {
    while (true) {
      const { done, value } = await reader!.read()
      if (done) {
        const finalParsed = parseStreamChunk(buffer, wireProviderType)
        if (finalParsed.text) {
          fullText += finalParsed.text
          input.onChunk(finalParsed.text)
        }
        providerTraces = dedupeTraces([...providerTraces, ...finalParsed.traces])
        finalParsed.traces.forEach(input.onTrace ?? (() => undefined))
        providerUsage = finalParsed.usage ?? providerUsage
        const citations = dedupeCitations([...extractCitationsFromText(fullText, input.req.retrievalSources), ...providerCitations])
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
        input.onDone(withCredentialGroup({ text: fullText, citations, traces: providerTraces, usage: providerUsage }, input.credentialGroupId))
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const { events, remainder } = splitSseBuffer(buffer)
      buffer = remainder
      for (const event of events) {
        const parsed = parseStreamChunk(event, wireProviderType)
        if (parsed.text) {
          fullText += parsed.text
          input.onChunk(parsed.text)
        }
        providerTraces = dedupeTraces([...providerTraces, ...parsed.traces])
        parsed.traces.forEach(input.onTrace ?? (() => undefined))
        providerUsage = parsed.usage ?? providerUsage
        providerCitations = dedupeCitations([...providerCitations, ...extractProviderCitationsFromSse(event, wireProviderType)])
      }
    }
  }

  await readStream()
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
  const timeoutMs = clampInteger(input.req.settings?.upstreamRequestTimeoutMs, CHAT_REQUEST_TIMEOUT_MS, 5000, 300000)
  const maxRetries = clampInteger(input.req.settings?.upstreamMaxRetries, 1, 0, 5)
  const circuitKey = `${input.req.provider.id}:${input.req.model}`
  assertCircuitClosed(input.req, circuitKey)
  let body = input.body
  let rectifiedRequest = false
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
        recordCircuitSuccess(circuitKey)
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
          logRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
          retryCount += 1
          await delay(retryDelayMs(retryCount - 1))
          continue
        }
        recordCircuitFailure(input.req, circuitKey)
        return new Response(errorText, { status: response.status, statusText: response.statusText, headers: response.headers })
      }

      if (!canRetryStatus || retryCount >= maxRetries) {
        recordCircuitFailure(input.req, circuitKey)
        return response
      }
      logRetryAttempt(input.req, retryCount + 1, maxRetries, { status: response.status })
      retryCount += 1
      await delay(retryDelayMs(retryCount - 1))
    } catch (error) {
      if (retryCount >= maxRetries || input.controller.signal.aborted) {
        recordCircuitFailure(input.req, circuitKey)
        throw error
      }
      logRetryAttempt(input.req, retryCount + 1, maxRetries, { error: error instanceof Error ? error.message : 'request_failed' })
      retryCount += 1
      await delay(retryDelayMs(retryCount - 1))
    }
  }
}

function rectifyAnthropicRequestBody(input: {
  req: ChatRequest
  body: string
  errorText: string
  rectified?: boolean
  rectifiedSignature?: boolean
  rectifiedBudget?: boolean
}): { kind: 'thinking_signature' | 'thinking_budget'; body: Record<string, unknown> } | undefined {
  if (input.req.settings?.requestRectificationEnabled !== true) return undefined
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(input.body) as Record<string, unknown>
  } catch {
    return undefined
  }
  const text = input.errorText.toLowerCase()
  const signatureEnabled = input.req.settings?.anthropicThinkingSignatureRectificationEnabled === true
  const budgetEnabled = input.req.settings?.anthropicThinkingBudgetRectificationEnabled === true
  const alreadyRectified = input.rectified === true
  if (signatureEnabled && !alreadyRectified && !input.rectifiedSignature && /thinking|signature|tool_use|invalid_request|invalid request/.test(text) && /signature|thinking/.test(text)) {
    return { kind: 'thinking_signature', body: stripThinkingBlocks(parsed) }
  }
  if (budgetEnabled && !alreadyRectified && !input.rectifiedBudget && /budget_tokens|thinking budget|at least 1024|minimum.*1024|1024/.test(text)) {
    return { kind: 'thinking_budget', body: normalizeAnthropicThinkingBudgetBody(parsed) }
  }
  return undefined
}

function stripThinkingBlocks(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body }
  delete next.thinking
  delete next.output_config
  next.messages = Array.isArray(next.messages)
    ? next.messages.map((message) => {
        if (!message || typeof message !== 'object') return message
        const record = message as Record<string, unknown>
        if (!Array.isArray(record.content)) return record
        return {
          ...record,
          content: record.content.filter((part) => !isThinkingContentPart(part)),
        }
      })
    : next.messages
  return next
}

function normalizeAnthropicThinkingBudgetBody(body: Record<string, unknown>): Record<string, unknown> {
  return {
    ...body,
    thinking: { type: 'enabled', budget_tokens: 32000 },
    max_tokens: Math.max(numberValue(body.max_tokens) ?? 0, 64000),
  }
}

function isThinkingContentPart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false
  const type = stringValue((part as Record<string, unknown>).type).toLowerCase()
  return type.includes('thinking') || type.includes('signature')
}

function assertCircuitClosed(req: ChatRequest, key: string): void {
  if (req.settings?.upstreamCircuitBreakerEnabled === false) return
  const state = CIRCUIT_STATES.get(key)
  if (!state?.openedUntil) return
  if (Date.now() >= state.openedUntil) {
    CIRCUIT_STATES.delete(key)
    return
  }
  void appendRuntimeLog('circuit.breaker', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    status: 'open',
    retryAfterMs: Math.max(0, state.openedUntil - Date.now()),
  }, runtimeLogOptions(req))
  throw providerRuntimeError('circuit_breaker_open')
}

function recordCircuitSuccess(key: string): void {
  CIRCUIT_STATES.delete(key)
}

function recordCircuitFailure(req: ChatRequest, key: string): void {
  if (req.settings?.upstreamCircuitBreakerEnabled === false) return
  const threshold = clampInteger(req.settings?.upstreamCircuitBreakerFailureThreshold, 3, 1, 20)
  const cooldownMs = clampInteger(req.settings?.upstreamCircuitBreakerCooldownMs, 60000, 1000, 3600000)
  const current = CIRCUIT_STATES.get(key) ?? { failures: 0 }
  const failures = current.failures + 1
  const openedUntil = failures >= threshold ? Date.now() + cooldownMs : undefined
  CIRCUIT_STATES.set(key, { failures, openedUntil })
  void appendRuntimeLog('circuit.breaker', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    status: openedUntil ? 'opened' : 'failure',
    failures,
    threshold,
    cooldownMs: openedUntil ? cooldownMs : undefined,
  }, runtimeLogOptions(req))
}

function retryDelayMs(attempt: number): number {
  return Math.min(2000, 250 * 2 ** attempt)
}

function logRetryAttempt(req: ChatRequest, attempt: number, maxRetries: number, detail: { status?: number; error?: string }): void {
  void appendRuntimeLog('upstream.retry', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    attempt,
    maxRetries,
    status: detail.status,
    error: detail.error,
  }, runtimeLogOptions(req))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runStreamTask(task: () => Promise<void>, onError: ErrorCallback, credentialGroupId?: string): Promise<void> {
  return task().catch((error: unknown) => {
    const err = error instanceof Error ? error as ProviderRuntimeError : providerRuntimeError(st('providerOperation.requestFailed'))
    err.credentialGroupId = err.credentialGroupId ?? credentialGroupId
    if (err.name !== 'AbortError') {
      onError(err)
    }
  })
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

async function recordRuntimeFallbackSuccess(route: ProviderFailoverRoute): Promise<void> {
  await mergeProviderHealthRecords([
    recordProviderSuccess(undefined, {
      key: route,
      nowMs: Date.now(),
    }),
  ])
}

async function recordRuntimeFallbackFailure(route: ProviderFailoverRoute, status: number, responseText: string): Promise<void> {
  const classification = classifyProviderFailure({ status, errorMessage: responseText })
  await mergeProviderHealthRecords([
    recordProviderFailure(undefined, {
      key: route,
      trigger: classification.trigger,
      nowMs: Date.now(),
      retryAfterMs: retryAfterMsFromFailure(status),
    }),
  ])
}

async function logRuntimeFallbackDecision(req: ChatRequest, plan: RuntimeFallbackPlan): Promise<void> {
  await appendRuntimeLog('fallback.decision', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    classification: plan.classification,
    decision: plan.decision,
    candidateEvidence: plan.candidates.evidence,
    rejectedCandidates: plan.candidates.rejectedCandidates,
  }, runtimeLogOptions(req))
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
  await logProviderConformance(selectedReq, selectedRouteResult.conformance)
  if (selectedRouteResult.decision.blocked) {
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', 'route_blocked'))
    return false
  }
  const selectedResponse = await fetchWithTimeout(
    selectedAssembly.endpoint,
    {
      method: 'POST',
      headers: getHeaders(selectedReq.provider),
      body: JSON.stringify(selectedRouteResult.body),
    },
    CHAT_REQUEST_TIMEOUT_MS
  )
  if (!selectedResponse.ok) {
    await recordRuntimeFallbackFailure(selectedRoute, selectedResponse.status, await safeResponseText(selectedResponse))
    input.onTrace?.(createRuntimeFallbackTrace(input.req, plan, 'error', `upstream_${selectedResponse.status}`))
    return false
  }

  await recordRuntimeFallbackSuccess(selectedRoute)
  const selectedResult = await parseNonStreamingResponse(selectedResponse, selectedReq)
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

function routeForRuntimeFallback(req: ChatRequest, credentialGroupId?: string): ProviderFailoverRoute {
  return {
    providerId: req.provider.id,
    model: req.model,
    credentialGroupId,
    region: req.provider.tokenPlanRegion,
    capabilities: requiredFallbackCapabilities(req),
  }
}

function fallbackProvidersForRequest(req: ChatRequest): AIProvider[] {
  const providers = req.fallbackProviders?.length ? req.fallbackProviders : [req.provider]
  const currentProvider = providers.some((provider) => provider.id === req.provider.id) ? [] : [req.provider]
  return [...currentProvider, ...providers]
}

function requiredFallbackCapabilities(req: ChatRequest): string[] {
  const capabilities = ['text']
  if (req.reasoningEffort && !['none', 'minimal'].includes(req.reasoningEffort)) capabilities.push('reasoning')
  for (const attachment of req.attachments ?? []) {
    if (attachment.type === 'image') capabilities.push('image')
    if (attachment.type === 'pdf' || attachment.type === 'text' || attachment.type === 'document') capabilities.push('file')
  }
  return Array.from(new Set(capabilities))
}

function retryAfterMsFromFailure(status?: number): number | undefined {
  if (status === 429) return 60_000
  if (status && status >= 500) return 20_000
  return undefined
}

function providerForRuntimeFallback(req: ChatRequest, route: ProviderFailoverRoute): AIProvider {
  const source = fallbackProvidersForRequest(req).find((provider) => provider.id === route.providerId) ?? req.provider
  const groupKey = route.credentialGroupId
    ? source.credentialGroups?.find((group) => group.id === route.credentialGroupId)?.apiKey
    : undefined
  return {
    ...source,
    apiKey: groupKey?.trim() || source.apiKey || req.provider.apiKey,
  }
}

function getNonStreamingEndpoint(req: ChatRequest): string {
  return resolveProviderEndpoint({
    provider: req.provider,
    model: req.model,
    stream: false,
    usesResponsesApi: usesOpenAIResponses(req),
  })
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
    const url = getNonStreamingEndpoint(fallbackReq)
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: getHeaders(fallbackReq.provider),
        body: JSON.stringify(getBody(fallbackReq)),
      },
      CHAT_REQUEST_TIMEOUT_MS
    )
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      const recovered = await tryRuntimeFallback({ req: fallbackReq, status: response.status, responseText: errorText, credentialGroupId, onChunk, onDone, onCitations, onTrace })
      if (recovered) return
      onError(providerRuntimeError(formatProviderHttpError(response.status, errorText, fallbackReq.provider, fallbackReq.model), credentialGroupId))
      return
    }
  const result = await parseNonStreamingResponse(response, fallbackReq)
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

function createStreamModeTrace(streamMode: 'reader' | 'buffered' | 'fallback', content: string): ProcessTrace {
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

function emitRuntimeGovernanceTrace(input: {
  onTrace?: TraceCallback
  req: ChatRequest
  requestedModel: string
  upstreamModel: string
  access: AccessPolicyDecision
  route?: ProviderRouteDecision
  transport?: TransportSelection
  payload?: PayloadRuleResult
  proxy?: ProxyPolicyDecision
  status: ProcessTrace['status']
}): void {
  if (!input.onTrace) return
  input.onTrace(createRuntimeGovernanceTrace(input))
}

function createRuntimeGovernanceTrace(input: {
  req: ChatRequest
  requestedModel: string
  upstreamModel: string
  access: AccessPolicyDecision
  route?: ProviderRouteDecision
  transport?: TransportSelection
  payload?: PayloadRuleResult
  proxy?: ProxyPolicyDecision
  status: ProcessTrace['status']
}): ProcessTrace {
  const now = Date.now()
  const accessReason = input.access.allowed ? undefined : input.access.reason
  const payloadFindings = input.payload?.findings.map((item) => item.id) ?? []
  return {
    id: `runtime-governance-${now}`,
    type: 'system',
    title: st('providerTrace.runtimeGovernanceTitle'),
    content: st('providerTrace.runtimeGovernanceContent', {
      access: input.access.allowed ? 'allowed' : `blocked:${accessReason ?? 'unknown'}`,
      route: summarizeRouteDecision(input.route),
      transport: summarizeTransportSelection(input.transport),
      payload: summarizePayloadPolicy(input.payload),
      proxy: summarizeProxyPolicy(input.proxy),
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

function createRuntimeFallbackTrace(req: ChatRequest, plan: RuntimeFallbackPlan, status: ProcessTrace['status'], failureReason?: string): ProcessTrace {
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

function summarizeRouteDecision(route: ProviderRouteDecision | undefined): string {
  if (!route) return 'not_evaluated'
  if (route.blocked) return `blocked:${joinTraceCodes(route.blockReasons)}`
  if (route.warnings.length) return `warnings:${joinTraceCodes(route.warnings)}`
  return `${route.protocol}:ok`
}

function summarizeTransportSelection(transport: TransportSelection | undefined): string {
  if (!transport) return 'not_selected'
  return transport.fallbackReason ? `${transport.transport}:${transport.fallbackReason}` : transport.transport
}

function summarizePayloadPolicy(payload: PayloadRuleResult | undefined): string {
  if (!payload) return 'not_evaluated'
  const findings = payload.findings.map((item) => item.id)
  if (payload.blocked) return `blocked:${joinTraceCodes(findings)}`
  if (findings.length) return `${payload.mode}:${joinTraceCodes(findings)}`
  return `${payload.mode}:ok`
}

function summarizeProxyPolicy(proxy: ProxyPolicyDecision | undefined): string {
  if (!proxy) return 'not_evaluated'
  return `${proxy.mode}:${proxy.applied ? 'applied' : 'not_applied'}:${proxy.reason}`
}

function joinTraceCodes(codes: string[]): string {
  return codes.filter(Boolean).join(',') || 'none'
}

function runtimeLogOptions(req: ChatRequest) {
  return {
    enabled: req.settings?.runtimeLogEnabled,
    maxBytes: req.settings?.runtimeLogMaxBytes,
  }
}

async function logPayloadPolicy(req: ChatRequest, result: PayloadRuleResult): Promise<void> {
  if (!result.findings.length && !req.settings?.runtimeLogEnabled) return
  await appendRuntimeLog('payload.rule', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    mode: result.mode,
    blocked: result.blocked,
    findings: result.findings,
    bodyKeys: result.bodyKeys,
    messageCount: result.messageCount,
    attachmentCount: result.attachmentCount,
  }, runtimeLogOptions(req))
}

async function logProviderConformance(req: ChatRequest, result: ProviderConformanceResult): Promise<void> {
  if (!result.issues.length && !req.settings?.runtimeLogEnabled) return
  await appendRuntimeLog('provider.conformance', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    family: result.manifest.family,
    protocol: result.manifest.protocol,
    source: result.manifest.source,
    reasoning: result.reasoning,
    requestedModalities: result.requestedModalities,
    removedParams: result.removedParams,
    adjustedParams: result.adjustedParams,
    issues: result.issues,
    bodyKeys: result.bodyKeys,
  }, runtimeLogOptions(req))
}

async function logProviderRouteDecision(req: ChatRequest, result: ProviderRouteDecision): Promise<void> {
  if (!result.blocked && !result.warnings.length && !req.settings?.runtimeLogEnabled) return
  await appendRuntimeLog('route.decision', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    route: result,
  }, runtimeLogOptions(req))
}

async function logProxyPolicy(req: ChatRequest, result: ProxyPolicyDecision): Promise<void> {
  await appendRuntimeLog('proxy.policy', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    mode: result.mode,
    applied: result.applied,
    reason: result.reason,
    endpointHost: result.endpointHost,
  }, runtimeLogOptions(req))
}

async function logUpstreamRequest(req: ChatRequest, transport: TransportSelection, payload: PayloadRuleResult, proxy: ProxyPolicyDecision): Promise<void> {
  await appendRuntimeLog('upstream.request', {
    conversationId: req.conversationId,
    providerId: req.provider.id,
    model: req.model,
    requestedModel: req.requestedModel,
    upstreamModel: req.model,
    transport: transport.transport,
    requestedTransportMode: transport.requestedMode,
    fallbackReason: transport.fallbackReason,
    policy: payload.mode,
    endpointHost: proxy.endpointHost,
    bodyKeys: payload.bodyKeys,
    messageCount: payload.messageCount,
    attachmentCount: payload.attachmentCount,
  }, runtimeLogOptions(req))
}

function endpointHost(url: string): string | undefined {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

function toWebSocketUrl(url: string): string {
  const parsed = new URL(url)
  parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:'
  return parsed.toString()
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
    return failure('credential_mismatch', st(issue.messageKey ?? issue.message, undefined, issue.message))
  }
  if (!upstreamModel.trim()) {
    return failure('model_unavailable', st('providerOperation.chooseModelFirst'))
  }

  try {
    const modelTestReq = {
      provider: p,
      model: upstreamModel,
      requestedModel: model,
      messages: [{ role: 'user' as const, content: '请只回复 OK' }],
      maxTokens: getModelTestMaxTokens(p, upstreamModel),
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
    const body = JSON.stringify(options.checkParameters === false ? reduceModelTestBody(rawBody) : rawBody)

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body }, MODEL_TEST_TIMEOUT_MS)
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      return failure(classifyHttpStatus(response.status, errorText, upstreamModel), formatProviderHttpError(response.status, errorText, provider, model), undefined, selectedGroupId)
    }
    const text = await parseNonStreamingText(response, getWireProviderType(p))
    if (!text.trim()) {
      return failure('unknown', st('providerOperation.emptyModelResponse'), undefined, selectedGroupId)
    }
    return success(st('providerOperation.modelTestPassed'), undefined, selectedGroupId)
  } catch (error) {
    return providerFetchFailure(error, selectedGroupId)
  }
}

function getModelTestMaxTokens(provider: AIProvider, model: string): number {
  const config = getModelConfig(model, provider.type, provider.modelConfigs)
  const normalized = model.toLowerCase().split('/').at(-1) ?? model.toLowerCase()
  const needsReasoningRoom =
    provider.type === 'xiaomi-mimo' ||
    isOpenAIReasoningModel(model) ||
    normalized.includes('reasoner') ||
    normalized.includes('thinking')
  const target = needsReasoningRoom ? 128 : 32
  return Math.max(1, Math.min(config.maxOutputTokens, target))
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
    return failure('credential_mismatch', st(issue.messageKey ?? issue.message, undefined, issue.message))
  }
  try {
    let models: AIModel[] = []
    if (p.type === 'xiaomi-mimo') {
      models = await fetchXiaomiMimoModels(p)
    } else if (p.type === 'google') {
      models = await fetchGoogleModels(p)
    } else if (p.type === 'anthropic') {
      models = await fetchAnthropicModels(p)
    } else if (p.type === 'openai' || isOpenAICompatibleProvider(p)) {
      models = await fetchOpenAICompatibleModels(p)
    }
    if (!models.length) {
      return failure<AIModel[]>('empty_models', st('providerOperation.emptyModels'), undefined, findCredentialGroupIdForKey(provider, apiKey))
    }
    return success(st('providerOperation.modelsFetched', { count: models.length }), models, findCredentialGroupIdForKey(provider, apiKey))
  } catch (error) {
    return providerFetchFailure(error, findCredentialGroupIdForKey(provider, apiKey))
  }
  return failure('models_endpoint_unavailable', st('providerOperation.modelsEndpointUnavailable'))
}

function supportsReasoningEffort(req: ChatRequest): boolean {
  return providerSupportsReasoning(req.provider, req.model)
}

function reduceModelTestBody(body: Record<string, unknown>): Record<string, unknown> {
  const next = { ...body }
  delete next.temperature
  delete next.top_p
  delete next.topP
  delete next.reasoning
  delete next.reasoning_effort
  delete next.thinking
  delete next.output_config
  const generationConfig = next.generationConfig as Record<string, unknown> | undefined
  if (generationConfig) {
    const reduced = { ...generationConfig }
    delete reduced.temperature
    delete reduced.topP
    delete reduced.thinkingConfig
    next.generationConfig = reduced
  }
  return next
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.isFinite(value) ? Math.trunc(value!) : fallback
  return Math.max(min, Math.min(max, parsed))
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

async function fetchOpenAICompatibleModels(provider: AIProvider): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models`, {
    method: 'GET',
    headers: getHeaders(provider),
  }, PROVIDER_REQUEST_TIMEOUT_MS)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = parseProviderJson<OpenAIModelListResponse>(await safeResponseText(response), response, provider, '模型列表')
  const items = json.data?.filter((item) => isString(item.id)) ?? []
  return sortModelConfigs(
    dedupeModelIds(items.map((item) => normalizeRemoteModelId(item.id!, provider.type))).map((id) => {
      const remote = items.find((item) => normalizeRemoteModelId(item.id!, provider.type) === id)
      return mergeModelConfig(id, provider.type, {
        name: remote?.display_name || remote?.name,
        contextWindow: firstNumber(
          remote?.context_length,
          remote?.contextWindow,
          remote?.context_window,
          remote?.max_context_length,
          getNumber(remote?.metadata, 'context_length'),
          getNumber(remote?.metadata, 'contextWindow'),
          getNumber(remote?.metadata, 'context_window'),
          getNumber(remote?.metadata, 'max_context_length')
        ),
        maxOutputTokens: firstNumber(
          remote?.max_output_length,
          remote?.maxOutputTokens,
          remote?.max_completion_tokens,
          getNumber(remote?.metadata, 'max_output_length'),
          getNumber(remote?.metadata, 'maxOutputTokens'),
          getNumber(remote?.metadata, 'max_completion_tokens'),
          getNumber(remote?.metadata, 'output_token_limit')
        ),
        supportsVision: supportsVisionFromOpenAIModel(remote),
        source: 'remote',
      })
    }),
    provider.type
  )
}

async function fetchXiaomiMimoModels(provider: AIProvider): Promise<AIModel[]> {
  return fetchOpenAICompatibleModels(getXiaomiMimoModelDiscoveryProvider(provider))
}

function getXiaomiMimoModelDiscoveryProvider(provider: AIProvider): AIProvider {
  if (provider.wireProtocol !== 'anthropic-compatible') return provider
  const nextBaseUrl = provider.baseUrl?.replace(/\/anthropic(?:\/v1)?\/?$/i, '/v1')
  return {
    ...provider,
    wireProtocol: 'openai-compatible',
    baseUrl: nextBaseUrl,
  }
}

async function fetchAnthropicModels(provider: AIProvider): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models`, {
    method: 'GET',
    headers: getHeaders(provider),
  }, PROVIDER_REQUEST_TIMEOUT_MS)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = (await response.json()) as AnthropicModelListResponse
  return mapAnthropicModels(json)
}

function mapAnthropicModels(json: AnthropicModelListResponse): AIModel[] {
  return sortModelConfigs(
    dedupeModelIds(json.data?.map((item) => item.id).filter(isString) ?? []).map((id) => {
      const remote = json.data?.find((item) => item.id === id)
      return mergeModelConfig(id, 'anthropic', {
        name: remote?.display_name,
        contextWindow: remote?.max_input_tokens,
        maxOutputTokens: remote?.max_tokens,
        defaultMaxTokens: remote?.max_tokens ? Math.min(8192, remote.max_tokens) : undefined,
        reasoningMode: anthropicCapabilitiesIncludeThinking(remote?.capabilities) ? 'anthropic-thinking' : undefined,
        source: 'remote',
      })
    }),
    'anthropic'
  )
}

function anthropicCapabilitiesIncludeThinking(capabilities: AnthropicModelListItem['capabilities']): boolean {
  if (Array.isArray(capabilities)) return capabilities.some((item) => /thinking|reasoning/i.test(item))
  if (capabilities && typeof capabilities === 'object') {
    return Object.entries(capabilities).some(([key, value]) => /thinking|reasoning/i.test(key) && value !== false)
  }
  return false
}

async function fetchGoogleModels(provider: AIProvider): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeProviderBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models?key=${encodeURIComponent(provider.apiKey)}`, undefined, PROVIDER_REQUEST_TIMEOUT_MS)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = (await response.json()) as GoogleModelListResponse
  const remoteModels: { id: string; name?: string; contextWindow?: number; maxOutputTokens?: number }[] = []
  for (const model of json.models ?? []) {
    if (!model.supportedGenerationMethods?.some((method) => method.includes('generateContent'))) continue
    const id = model.name?.replace(/^models\//, '')
    if (!isString(id)) continue
    remoteModels.push({
      id,
      name: model.displayName,
      contextWindow: model.inputTokenLimit,
      maxOutputTokens: model.outputTokenLimit,
    })
  }
  return sortModelConfigs(
    dedupeModelIds(remoteModels.map((model) => model.id)).map((id) => {
      const remote = remoteModels.find((model) => model.id === id)
      return mergeModelConfig(id, 'google', {
        name: remote?.name,
        contextWindow: remote?.contextWindow,
        maxOutputTokens: remote?.maxOutputTokens,
        defaultMaxTokens: remote?.maxOutputTokens ? Math.min(8192, remote.maxOutputTokens) : undefined,
        supportsVision: true,
        supportsFiles: true,
        source: 'remote',
      })
    }),
    'google'
  )
}

function dedupeModelIds(models: string[]): string[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    const id = model.trim()
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function normalizeRemoteModelId(modelId: string, providerType: ProviderType): string {
  const trimmed = modelId.trim()
  if (providerType === 'xiaomi-mimo' && trimmed.startsWith('xiaomi/')) {
    return trimmed.split('/').at(-1) ?? trimmed
  }
  return trimmed
}

function supportsVisionFromOpenAIModel(model?: OpenAIModelListItem): boolean | undefined {
  const modalities = model?.architecture?.input_modalities ?? []
  if (modalities.length) {
    return modalities.some((modality) => ['image', 'vision', 'video'].includes(modality.toLowerCase()))
  }
  const id = model?.id?.toLowerCase() ?? ''
  if (!id) return undefined
  if (id.includes('mimo-v2.5') && !id.includes('tts')) return true
  if (id.includes('mimo-v2-omni')) return true
  return undefined
}

function firstNumber(...values: (number | undefined)[]): number | undefined {
  return values.find((value) => Number.isFinite(value))
}

function getNumber(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key]
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = bytes[index + 1]
    const c = bytes[index + 2]
    output += chars[a >> 2]
    output += chars[((a & 3) << 4) | ((b ?? 0) >> 4)]
    output += index + 1 < bytes.length ? chars[((b & 15) << 2) | ((c ?? 0) >> 6)] : '='
    output += index + 2 < bytes.length ? chars[(c ?? 0) & 63] : '='
  }
  return output
}

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseText: string
  ) {
    super(`Provider HTTP ${status}: ${responseText}`)
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (init?.signal?.aborted) controller.abort()
  init?.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', forwardAbort)
  }
}

async function fetchChatStreamWithTimeout(input: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort()
  if (init?.signal?.aborted) controller.abort()
  init?.signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const body = init?.body ?? undefined
    return await expoFetch(input, { ...init, signal: controller.signal, body })
  } finally {
    clearTimeout(timeout)
    init?.signal?.removeEventListener('abort', forwardAbort)
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function parseProviderJson<T>(text: string, response: Response, provider: AIProvider, label: string): T {
  const trimmed = text.trim()
  const contentType = response.headers.get('content-type') ?? ''
  if (!trimmed) {
    throw new ProviderHttpError(response.status || 200, st('providerOperation.jsonEmpty', { label }))
  }
  if (/^</.test(trimmed) || /text\/html/i.test(contentType)) {
    throw new ProviderHttpError(
      response.status || 200,
      st('providerOperation.htmlInsteadJson', { provider: provider.name })
    )
  }
  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new ProviderHttpError(
      response.status || 200,
      st('providerOperation.invalidJson', { label, contentType: contentType || st('updates.unknown'), snippet: trimmed.slice(0, 180) })
    )
  }
}

function success<T>(message: string, data?: T, credentialGroupId?: string): ProviderOperationResult<T> {
  return { ok: true, code: 'ok', message, data, credentialGroupId }
}

function failure<T>(code: ProviderOperationCode, message: string, data?: T, credentialGroupId?: string): ProviderOperationResult<T> {
  return { ok: false, code, message, data, credentialGroupId }
}

function providerFetchFailure<T>(error: unknown, credentialGroupId?: string): ProviderOperationResult<T> {
  if (error instanceof ProviderHttpError) {
    return failure<T>(classifyHttpStatus(error.status, error.responseText), formatProviderHttpError(error.status, error.responseText), undefined, credentialGroupId)
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return failure<T>('timeout', st('providerOperation.timeout'), undefined, credentialGroupId)
  }
  const message = error instanceof Error ? error.message : ''
  if (/failed to fetch|network|network request failed/i.test(message)) {
    return failure<T>('network_error', st('providerOperation.networkError'), undefined, credentialGroupId)
  }
  return failure<T>('unknown', message || st('providerOperation.requestFailed'), undefined, credentialGroupId)
}

function findCredentialGroupIdForKey(provider: AIProvider, apiKey: string): string | undefined {
  const key = apiKey.trim()
  if (!key) return undefined
  return provider.credentialGroups?.find((group) => group.apiKey?.trim() === key)?.id
}

function classifyHttpStatus(status: number, responseText = '', model = ''): ProviderOperationCode {
  const text = responseText.toLowerCase()
  if (status === 401 || status === 403 || text.includes('invalid api key') || text.includes('unauthorized') || text.includes('permission')) return 'bad_auth'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 429 || text.includes('rate limit') || text.includes('too many requests') || text.includes('quota')) return 'rate_limited'
  if (text.includes('max_tokens') || text.includes('max_completion_tokens') || text.includes('maximum context') || text.includes('context length') || text.includes('too many tokens')) return 'max_tokens_exceeded'
  if (status === 404 && (model || text.includes('model'))) return 'model_unavailable'
  if (status === 404) return 'models_endpoint_unavailable'
  if (status === 400 && (text.includes('model') || text.includes('not found') || text.includes('not exist'))) return 'model_unavailable'
  if (status === 400) return 'bad_base_url'
  if (status >= 500) return 'network_error'
  return 'unknown'
}

function formatProviderHttpError(status: number, responseText = '', provider?: AIProvider, model = ''): string {
  const code = classifyHttpStatus(status, responseText, model)
  const providerName = provider?.name ?? st('providerOperation.provider')
  const detail = extractProviderErrorDetail(responseText)
  switch (code) {
    case 'bad_auth':
      return st('providerOperation.http.badAuth', { provider: providerName })
    case 'model_unavailable':
      return st('providerOperation.http.modelUnavailable', { model: model || st('providerOperation.currentModel') })
    case 'models_endpoint_unavailable':
      return st('providerOperation.http.modelsEndpointUnavailable', { provider: providerName })
    case 'rate_limited':
      return st('providerOperation.http.rateLimited', { provider: providerName })
    case 'max_tokens_exceeded':
      return st('providerOperation.http.maxTokensExceeded', { provider: providerName })
    case 'timeout':
      return st('providerOperation.http.timeout', { provider: providerName })
    case 'bad_base_url':
      return st('providerOperation.http.badBaseUrl', { provider: providerName })
    case 'network_error':
      return detail ? st('providerOperation.http.errorWithSummary', { provider: providerName, status, detail }) : st('providerOperation.http.network', { provider: providerName })
    default:
      return detail ? st('providerOperation.http.errorWithSummary', { provider: providerName, status, detail }) : st('providerOperation.http.error', { provider: providerName, status })
  }
}

function extractProviderErrorDetail(responseText = ''): string {
  const trimmed = responseText.trim()
  if (!trimmed) return ''
  if (/^\s*</.test(trimmed)) return st('providerOperation.http.htmlResponse')
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const error = typeof parsed.error === 'object' && parsed.error ? parsed.error as Record<string, unknown> : parsed
    const type = stringFromUnknown(error.type) || stringFromUnknown(error.code) || stringFromUnknown(parsed.code)
    const message = stringFromUnknown(error.message) || stringFromUnknown(parsed.message)
    const requestId = stringFromUnknown(error.request_id) || stringFromUnknown(error.requestId) || stringFromUnknown(parsed.request_id) || stringFromUnknown(parsed.requestId) || findRequestId(trimmed)
    return [
      type ? st('providerOperation.http.errorType', { type }) : '',
      message ? st('providerOperation.http.errorMessage', { message: message.slice(0, 140) }) : '',
      requestId ? st('providerOperation.http.requestId', { requestId }) : '',
      st('providerOperation.http.suggestion'),
    ].filter(Boolean).join(' · ')
  } catch {
    const plain = trimmed.replace(/\s+/g, ' ').slice(0, 180)
    const requestId = findRequestId(trimmed)
    return [
      plain,
      requestId ? st('providerOperation.http.requestId', { requestId }) : '',
      st('providerOperation.http.suggestion'),
    ].filter(Boolean).join(' · ')
  }
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function findRequestId(text: string): string {
  return text.match(/(?:request[_ -]?id|req[_ -]?id)["':=\s]+([a-z0-9._:-]+)/i)?.[1] ?? ''
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function fallbackModel(providerType: ProviderType): string {
  switch (providerType) {
    case 'openai':
      return 'gpt-5.5'
    case 'anthropic':
      return 'claude-haiku-4-5-20251001'
    case 'google':
      return 'gemini-3-flash-preview'
    case 'openai-compatible':
      return 'gpt-4o-mini'
    case 'xiaomi-mimo':
      return 'mimo-v2.5-pro'
  }
}

function pickEmbeddingModel(provider: AIProvider): string {
  if (provider.type === 'openai') return 'text-embedding-3-small'
  const configured = provider.models.find((model) => /embed|embedding|text-embedding/i.test(model))
  if (configured) return configured
  if (provider.type === 'xiaomi-mimo') return 'text-embedding'
  return 'text-embedding-3-small'
}
