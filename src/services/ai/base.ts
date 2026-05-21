import { fetch as expoFetch } from 'expo/fetch'
import type { AIModel, Attachment, AIProvider, MessageCitation, MessageUsage, ProcessTrace, ProviderOperationCode, ProviderType, RetrievalSource, WebSearchMode } from '@/types'
import { getModelConfig, getProviderConfigIssue, getProviderEffectiveBaseUrl, mergeModelConfig, sortModelConfigs } from '@/types'
import { st } from '@/i18n/service'
import { getSecureApiKey } from './secureKey'
import { chooseCredentialForModel, runCredentialGroupModelSync, updateCredentialGroupHealth } from './providerCredentials'

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
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
  maxTokens?: number
  attachments?: Attachment[]
  contextPrompt?: string
  retrievalSources?: RetrievalSource[]
  webSearchMode?: WebSearchMode
  stream?: boolean
  signal?: AbortSignal
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
  max_output_length?: number
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

type AnthropicModelListResponse = {
  data?: { id?: string; display_name?: string; type?: string }[]
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
}

const PROVIDER_REQUEST_TIMEOUT_MS = 18000
const MODEL_TEST_TIMEOUT_MS = 22000
const CHAT_REQUEST_TIMEOUT_MS = 60000

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
          .filter((a) => a.type === 'image')
          .map((a) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${a.mimeType};base64,${a.base64}`, detail: 'auto' as const },
          })),
      ]
    }
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages: msgs,
    stream: req.stream ?? true,
  }

  const temperature = normalizeTemperature(req)
  if (temperature !== undefined) {
    body.temperature = temperature
  }
  if (req.topP !== undefined) body.top_p = clamp01(req.topP)
  if (req.reasoningEffort && supportsReasoningEffort(req)) {
    body.reasoning_effort = req.reasoningEffort
  }

  const maxTokensKey = req.provider.type === 'xiaomi-mimo' || isOpenAIReasoningModel(req.model) ? 'max_completion_tokens' : 'max_tokens'
  body[maxTokensKey] = clampMaxTokens(req)

  return body
}

function buildXiaomiMimoAnthropicBody(req: ChatRequest) {
  return buildAnthropicBody({ ...req, stream: req.stream ?? true })
}

function buildAnthropicBody(req: ChatRequest) {
  const system = [req.systemPrompt, req.contextPrompt].filter(Boolean).join('\n\n') || undefined
  const messages: Record<string, unknown>[] = []

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

  return {
    model: req.model,
    system,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    top_p: req.topP ?? 1,
    stream: req.stream ?? true,
    ...(req.webSearchMode === 'native' ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] } : {}),
  }
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

  return {
    contents,
    systemInstruction,
    generationConfig: {
      temperature: req.temperature ?? 0.7,
      topP: req.topP ?? 1,
      maxOutputTokens: req.maxTokens ?? 4096,
    },
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
  return {
    model: req.model,
    input,
    ...(normalizeTemperature(req) === undefined ? {} : { temperature: normalizeTemperature(req) }),
    ...(req.topP === undefined ? {} : { top_p: clamp01(req.topP) }),
    ...(req.reasoningEffort && supportsReasoningEffort(req) ? { reasoning: { effort: req.reasoningEffort } } : {}),
    max_output_tokens: clampMaxTokens(req),
    stream: req.stream ?? true,
    ...(req.webSearchMode === 'native' ? { tools: [{ type: 'web_search_preview' }] } : {}),
  }
}

function usesOpenAIResponses(req: ChatRequest): boolean {
  if (req.provider.type !== 'openai') return false
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return modelConfig.preferredEndpoint === 'responses' || req.webSearchMode === 'native' || !!req.attachments?.some((attachment) => attachment.type !== 'image')
}

function isOpenAIReasoningModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase().split('/').at(-1) ?? modelId.toLowerCase()
  return /^(o[1-9]|gpt-5)/.test(normalized)
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

function isOpenAICompatibleProvider(provider: AIProvider): boolean {
  return provider.type === 'openai-compatible' || provider.type === 'xiaomi-mimo'
}

function getAPIEndpoint(provider: AIProvider): string {
  switch (provider.type) {
    case 'openai':
      return `${normalizeBaseUrl(getProviderEffectiveBaseUrl(provider))}/chat/completions`
    case 'anthropic':
      return `${normalizeBaseUrl(getProviderEffectiveBaseUrl(provider))}/messages`
    case 'google':
      return getGoogleEndpoint(provider, provider.models[0] || 'gemini-2.5-flash', true)
    case 'openai-compatible':
      return `${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/chat/completions`
    case 'xiaomi-mimo':
      return provider.wireProtocol === 'anthropic-compatible'
        ? `${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/messages`
        : `${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/chat/completions`
    default:
      return ''
  }
}

function getOpenAIResponsesEndpoint(provider: AIProvider): string {
  return `${normalizeBaseUrl(getProviderEffectiveBaseUrl(provider))}/responses`
}

function defaultOpenAICompatibleBaseUrl(provider: AIProvider): string {
  const baseUrl = getProviderEffectiveBaseUrl(provider)
  if (provider.type !== 'openai-compatible' && provider.type !== 'xiaomi-mimo') return baseUrl
  try {
    const parsed = new URL(baseUrl)
    const path = parsed.pathname.replace(/\/+$/, '')
    if (!path) {
      parsed.pathname = '/v1'
      return parsed.toString().replace(/\/+$/, '')
    }
  } catch {
    // Fall back to the user-entered value; the caller will surface the network error.
  }
  return baseUrl
}

function getGoogleEndpoint(provider: AIProvider, model: string, stream: boolean): string {
  const method = stream ? 'streamGenerateContent?alt=sse' : 'generateContent'
  const separator = method.includes('?') ? '&' : '?'
  return `${normalizeBaseUrl(getProviderEffectiveBaseUrl(provider))}/models/${model}:${method}${separator}key=${encodeURIComponent(provider.apiKey)}`
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '')
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
  switch (req.provider.type) {
    case 'openai':
      return usesOpenAIResponses(req) ? buildOpenAIResponsesBody(req) : buildOpenAIBody(req)
    case 'anthropic':
      return buildAnthropicBody(req)
    case 'google':
      return buildGoogleBody(req)
    case 'openai-compatible':
      return buildOpenAIBody(req)
    case 'xiaomi-mimo':
      return req.provider.wireProtocol === 'anthropic-compatible' ? buildXiaomiMimoAnthropicBody(req) : buildOpenAIBody(req)
  }
}

function getWireProviderType(provider: AIProvider): ProviderType {
  return provider.type === 'xiaomi-mimo' && provider.wireProtocol === 'anthropic-compatible'
    ? 'anthropic'
    : provider.type
}

function extractContent(chunk: string, providerType: ProviderType): string {
  return parseStreamChunk(chunk, providerType).text
}

function parseStreamChunk(chunk: string, providerType: ProviderType): ParsedStreamChunk {
  const traces: ProcessTrace[] = []
  let text = ''
  let usage: MessageUsage | undefined
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    try {
      const json = JSON.parse(line.slice(6))
      const parsed = parseProviderStreamEvent(json, providerType)
      text += parsed.text
      traces.push(...parsed.traces)
      usage = parsed.usage ?? usage
    } catch {}
  }
  return { text, traces: dedupeTraces(traces), usage }
}

function parseProviderStreamEvent(json: any, providerType: ProviderType): ParsedStreamChunk {
  switch (providerType) {
    case 'openai':
    case 'openai-compatible':
    case 'xiaomi-mimo': {
      let text = ''
      const traces: ProcessTrace[] = []
      const delta = json.choices?.[0]?.delta
      text += stringValue(delta?.content)
      text += stringValue(json.choices?.[0]?.message?.content)
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
      return { text, traces, usage: extractUsage(json, providerType === 'openai' ? 'openai' : 'openai-compatible') }
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
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed
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
  const name = stringValue(item.name) || stringValue((item.function as Record<string, unknown> | undefined)?.name)
  const input = item.input ?? item.arguments ?? item.args ?? (item.function as Record<string, unknown> | undefined)?.arguments ?? item.delta ?? item
  const inputText = typeof input === 'string' ? input : safeJsonPreview(input)
  return [name ? st('providerTrace.toolNameLine', { name }) : '', inputText ? st('providerTrace.toolArgsLine', { input: inputText }) : ''].filter(Boolean).join('\n')
}

function safeJsonPreview(value: unknown): string {
  try {
    const raw = JSON.stringify(value)
    return raw.length > 800 ? `${raw.slice(0, 800)}...` : raw
  } catch {
    return ''
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
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
      return {
        text: json.output_text ?? json.choices?.[0]?.message?.content ?? '',
        usage: extractUsage(json, providerType),
        citations: extractCitationsFromText(json.output_text ?? '', req.retrievalSources),
        traces: extractTracesFromJson(json, providerType),
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
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage: extractUsage(json, 'openai-compatible'),
        citations: extractCitationsFromText('', req.retrievalSources),
        traces: extractTracesFromJson(json, providerType),
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
  return { text, citations, traces: parsed.traces, usage: parsed.usage }
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

export async function streamChat(
  req: ChatRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onCitations?: CitationCallback,
  onTrace?: TraceCallback
): Promise<StreamHandle> {
  const controller = new AbortController()
  const credential = chooseCredentialForModel(req.provider, req.model)
  const runtimeReq = {
    ...req,
    provider: {
      ...req.provider,
      apiKey: credential.apiKey || req.provider.apiKey,
    },
  }
  const issue = getProviderConfigIssue(runtimeReq.provider, runtimeReq.provider.apiKey)
  if (issue) {
    req.provider = updateCredentialGroupHealth(req.provider, credential.credentialGroupId, false)
    const error = providerRuntimeError(`${issue.code}: ${issue.message}`, credential.credentialGroupId)
    const done = Promise.resolve().then(() => onError(error))
    return { controller, done }
  }
  if (req.signal) {
    req.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  const stream = req.stream ?? true
  if (!runtimeReq.provider.apiKey.trim()) {
    req.provider = updateCredentialGroupHealth(req.provider, credential.credentialGroupId, false)
    const done = Promise.resolve().then(() => onError(providerRuntimeError('missing_key', credential.credentialGroupId)))
    return { controller, done }
  }
  const url =
    runtimeReq.provider.type === 'google'
      ? getGoogleEndpoint(runtimeReq.provider, runtimeReq.model, stream)
      : usesOpenAIResponses(runtimeReq)
        ? getOpenAIResponsesEndpoint(runtimeReq.provider)
      : getAPIEndpoint(runtimeReq.provider)
  const headers = getHeaders(runtimeReq.provider)
  const body = JSON.stringify(getBody({ ...runtimeReq, stream }))

  const response = await fetchChatStreamWithTimeout(url, {
    method: 'POST',
    headers,
    body,
    signal: controller.signal,
  }, CHAT_REQUEST_TIMEOUT_MS)

  if (!response.ok) {
    const errorText = await safeResponseText(response)
    req.provider = updateCredentialGroupHealth(req.provider, credential.credentialGroupId, false)
    const done = Promise.resolve().then(() => onError(providerRuntimeError(`API Error ${response.status}: ${errorText}`, credential.credentialGroupId)))
    return { controller, done }
  }

  if (!stream) {
    const done = runStreamTask(async () => {
      const result = await parseNonStreamingResponse(response, runtimeReq)
      if (result.text) onChunk(result.text)
      if (result.citations?.length) onCitations?.(result.citations)
      result.traces?.forEach(onTrace ?? (() => undefined))
      onDone(withCredentialGroup(result, credential.credentialGroupId))
    }, onError, credential.credentialGroupId)
    return { controller, done }
  }

  const reader = response.body?.getReader()
  if (!reader) {
    const done = runStreamTask(async () => {
      onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackNoReader')))
      const raw = await safeResponseText(response)
      const result = parseBufferedStreamResponse(raw, runtimeReq, getWireProviderType(runtimeReq.provider))
      if (result.text) {
        onChunk(result.text)
        if (result.citations?.length) onCitations?.(result.citations)
        result.traces?.forEach(onTrace ?? (() => undefined))
        onDone(withCredentialGroup(result, credential.credentialGroupId))
      } else {
        onTrace?.(createStreamModeTrace('buffered', st('providerTrace.streamBufferedFallback')))
        await retryWithoutStreaming(runtimeReq, onChunk, onDone, onError, onCitations, onTrace, credential.credentialGroupId)
      }
    }, onError, credential.credentialGroupId)
    return { controller, done }
  }

  onTrace?.(createStreamModeTrace('reader', st('providerTrace.streamReader')))

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''
  let providerCitations: MessageCitation[] = []
  let providerTraces: ProcessTrace[] = []
  let providerUsage: MessageUsage | undefined
  const wireProviderType = getWireProviderType(runtimeReq.provider)

  async function readStream() {
    while (true) {
      const { done, value } = await reader!.read()
      if (done) {
        const finalParsed = parseStreamChunk(buffer, wireProviderType)
        if (finalParsed.text) {
          fullText += finalParsed.text
          onChunk(finalParsed.text)
        }
        providerTraces = dedupeTraces([...providerTraces, ...finalParsed.traces])
        finalParsed.traces.forEach(onTrace ?? (() => undefined))
        providerUsage = finalParsed.usage ?? providerUsage
        const citations = dedupeCitations([...extractCitationsFromText(fullText, runtimeReq.retrievalSources), ...providerCitations])
        if (citations.length) onCitations?.(citations)
        onDone(withCredentialGroup({ text: fullText, citations, traces: providerTraces, usage: providerUsage }, credential.credentialGroupId))
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const { events, remainder } = splitSseBuffer(buffer)
      buffer = remainder
      for (const event of events) {
        const parsed = parseStreamChunk(event, wireProviderType)
        if (parsed.text) {
          fullText += parsed.text
          onChunk(parsed.text)
        }
        providerTraces = dedupeTraces([...providerTraces, ...parsed.traces])
        parsed.traces.forEach(onTrace ?? (() => undefined))
        providerUsage = parsed.usage ?? providerUsage
        providerCitations = dedupeCitations([...providerCitations, ...extractProviderCitationsFromSse(event, wireProviderType)])
      }
    }
  }

  return { controller, done: runStreamTask(readStream, onError, credential.credentialGroupId) }
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
    const url =
      fallbackReq.provider.type === 'google'
        ? getGoogleEndpoint(fallbackReq.provider, fallbackReq.model, false)
        : usesOpenAIResponses(fallbackReq)
          ? getOpenAIResponsesEndpoint(fallbackReq.provider)
          : getAPIEndpoint(fallbackReq.provider)
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
      onError(providerRuntimeError(`API Error ${response.status}: ${await safeResponseText(response)}`, credentialGroupId))
      return
    }
    const result = await parseNonStreamingResponse(response, fallbackReq)
    onTrace?.(createStreamModeTrace('fallback', st('providerTrace.streamFallbackCompleted')))
    if (result.text) onChunk(result.text)
    if (result.citations?.length) onCitations?.(result.citations)
    result.traces?.forEach(onTrace ?? (() => undefined))
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

export async function testProviderModelDetailed(provider: AIProvider, model: string, apiKey: string): Promise<ProviderOperationResult> {
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
  if (!model.trim()) {
    return failure('model_unavailable', st('providerOperation.chooseModelFirst'))
  }

  try {
    const url = provider.type === 'google' ? getGoogleEndpoint(p, model, false) : getAPIEndpoint(p)
    const headers = getHeaders(p)
    const body = JSON.stringify(
      getBody({
        provider: p,
        model,
        messages: [{ role: 'user', content: '请只回复 OK' }],
        maxTokens: getModelTestMaxTokens(p, model),
        stream: false,
      })
    )

    const response = await fetchWithTimeout(url, { method: 'POST', headers, body }, MODEL_TEST_TIMEOUT_MS)
    if (!response.ok) {
      const errorText = await safeResponseText(response)
      return failure(classifyHttpStatus(response.status, errorText, model), formatProviderHttpError(response.status, errorText, provider, model), undefined, selectedGroupId)
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
  return !!req.provider.capabilities?.reasoningEffort || isOpenAIReasoningModel(req.model) || /reasoner|thinking|grok|glm/i.test(req.model)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export async function syncProviderCredentialGroupsDetailed(provider: AIProvider): Promise<ProviderOperationResult<AIProvider>> {
  const groups = provider.credentialGroups?.filter((group) => group.enabled && group.apiKey?.trim()) ?? []
  if (!groups.length && !provider.apiKey.trim()) {
    return failure('missing_key', st('providerOperation.saveTokenGroupFirst'))
  }
  const sourceGroups = groups.length
    ? provider.credentialGroups
    : [{ id: 'default', label: st('providerOperation.defaultToken'), enabled: true, apiKey: provider.apiKey, availableModels: provider.models }]
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
  const response = await fetchWithTimeout(`${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/embeddings`, {
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
    const response = await fetchWithTimeout(`${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/audio/transcriptions`, {
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
  const response = await fetchWithTimeout(`${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/audio/speech`, {
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
  const response = await fetchWithTimeout(`${normalizeBaseUrl(defaultOpenAICompatibleBaseUrl(provider))}/models`, {
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
        contextWindow: firstNumber(remote?.context_length, remote?.contextWindow, getNumber(remote?.metadata, 'context_length')),
        maxOutputTokens: firstNumber(remote?.max_output_length, remote?.maxOutputTokens, getNumber(remote?.metadata, 'max_output_length')),
        supportsVision: supportsVisionFromOpenAIModel(remote),
        source: 'remote',
      })
    }),
    provider.type
  )
}

async function fetchXiaomiMimoModels(provider: AIProvider): Promise<AIModel[]> {
  try {
    const models = await fetchOpenAICompatibleModels(getXiaomiMimoModelDiscoveryProvider(provider))
    if (models.length) return models
  } catch {
    // MiMo documents the chat models in the API schema; some accounts or clusters
    // may not expose /models. In that case we keep an official built-in list.
  }
  return sortModelConfigs(provider.models.map((id) => getModelConfig(id, 'xiaomi-mimo', provider.modelConfigs)), 'xiaomi-mimo')
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
  const response = await fetchWithTimeout(`${normalizeBaseUrl(getProviderEffectiveBaseUrl(provider))}/models`, {
    method: 'GET',
    headers: getHeaders(provider),
  }, PROVIDER_REQUEST_TIMEOUT_MS)
  if (!response.ok) throw new ProviderHttpError(response.status, await safeResponseText(response))
  const json = (await response.json()) as AnthropicModelListResponse
  return sortModelConfigs(
    dedupeModelIds(json.data?.map((item) => item.id).filter(isString) ?? []).map((id) => {
      const remote = json.data?.find((item) => item.id === id)
      return mergeModelConfig(id, 'anthropic', {
        name: remote?.display_name,
        source: 'remote',
      })
    }),
    'anthropic'
  )
}

async function fetchGoogleModels(provider: AIProvider): Promise<AIModel[]> {
  const response = await fetchWithTimeout(`${normalizeBaseUrl(getProviderEffectiveBaseUrl(provider))}/models?key=${encodeURIComponent(provider.apiKey)}`, undefined, PROVIDER_REQUEST_TIMEOUT_MS)
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
  return typeof value === 'number' ? value : undefined
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
      return st('providerOperation.http.network', { provider: providerName })
    default:
      return responseText ? st('providerOperation.http.errorWithText', { provider: providerName, status, text: responseText.slice(0, 240) }) : st('providerOperation.http.error', { provider: providerName, status })
  }
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
