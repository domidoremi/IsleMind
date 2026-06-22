import { safeResponseText } from '@/services/ai/providerHttp'
import { extractAnthropicReplayContentBlocks } from '@/services/ai/providerAnthropicReplay'
import { dedupeCitations, extractCitationsFromText, extractProviderCitations, extractProviderCitationsFromSse, type ProviderCitationSource } from '@/services/ai/providerCitations'
import { getWireProviderType } from '@/services/ai/providerWireProtocol'
import { isPerplexityProvider } from '@/services/ai/providerIdentity'
import { extractOpenAIReasoningContent, extractOpenAIResponseReplayItems } from '@/services/ai/providerOpenAIReplay'
import { extractAnthropicText, extractGoogleText, extractOpenAIText, extractResponseId } from '@/services/ai/providerResponseText'
import { parseProviderStreamChunk } from '@/services/ai/providerStreamParsing'
import { filterProviderStructuredOutputToolCalls, providerStructuredOutputToolCallText } from '@/services/ai/providerStructuredOutput'
import { extractTracesFromJson } from '@/services/ai/providerTraceUtils'
import { executableProviderToolCalls, extractProviderTextToolCalls, extractProviderToolCalls, stripProviderTextToolCallBlocks } from '@/services/ai/providerToolCalls'
import { extractUsage } from '@/services/ai/providerUsage'
import { getProviderCompatibilityEvidenceForProvider, providerCompatibilityCapabilityCanBeSentForProvider, providerCompatibilityEvidenceHasBehavior, providerCompatibilityReasoningExplicitlyDeclaredForModel } from '@/services/ai/providerCompatibilityContract'
import type { ChatCompletionResult, ChatRequest } from '@/services/ai/base'
import { getModelConfig, type ProviderType } from '@/types'

export interface ProviderResponseBody {
  text: string
  json: any | null
}

export async function readProviderResponseBody(response: Response): Promise<ProviderResponseBody> {
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

export async function parseProviderNonStreamingText(response: Response, providerType: ProviderType): Promise<string> {
  const body = await readProviderResponseBody(response)
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

export async function parseProviderNonStreamingResponse(response: Response, req: ChatRequest): Promise<ChatCompletionResult> {
  const body = await readProviderResponseBody(response)
  if (!body.json) {
    return withProviderTextToolCallFallback({
      text: body.text.trim(),
      citations: body.text.trim() ? extractCitationsFromText(body.text, req.retrievalSources) : [],
    })
  }
  return parseProviderChatCompletionJson(body.json, req)
}

export function parseProviderBufferedStreamResponse(raw: string, req: ChatRequest, providerType: ProviderType): ChatCompletionResult {
  const trimmed = raw.trim()
  if (!trimmed) return { text: '' }

  if (trimmed.startsWith('{')) {
    const parsedJson = parseProviderBufferedStreamJson(trimmed, req)
    if (parsedJson) return parsedJson
    // Fall through to SSE parsing; some polyfills return concatenated chunks.
  }

  const parsed = parseProviderStreamChunk(raw, providerType, {
    includeReasoning: providerReasoningResponseCanBeParsed(req),
  })
  const text = stripProviderTextToolCallBlocks(parsed.text)
  const source = providerCitationSource(req, providerType)
  const citations = dedupeCitations([
    ...extractCitationsFromText(text, req.retrievalSources),
    ...(source ? extractProviderCitationsFromSse(raw, source) : []),
  ])
  return withProviderTextToolCallFallback({
    text,
    citations,
    traces: parsed.traces,
    usage: parsed.usage,
    responseId: parsed.responseId,
    providerToolCalls: executableProviderToolCalls(parsed.providerToolCalls),
    reasoningContent: parsed.reasoningContent,
    responseItems: parsed.responseItems,
    providerContentBlocks: parsed.providerContentBlocks,
  }, parsed.text)
}

export function parseProviderChatCompletionJson(json: any, req: ChatRequest): ChatCompletionResult {
  const providerType = getWireProviderType(req.provider)
  const includeReasoning = providerReasoningResponseCanBeParsed(req)
  switch (providerType) {
    case 'openai': {
      const openAIText = extractOpenAIText(json)
      return withProviderTextToolCallFallback({
        text: openAIText,
        usage: extractUsage(json, providerType, { includeReasoning }),
        citations: extractCitationsFromText(openAIText, req.retrievalSources),
        traces: extractTracesFromJson(json, providerType, { includeReasoning }),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, providerType)),
        reasoningContent: includeReasoning ? extractOpenAIReasoningContent(json) : undefined,
        responseItems: extractOpenAIResponseReplayItems(json),
        responseId: extractResponseId(json),
      })
    }
    case 'anthropic': {
      const anthropicToolCalls = extractProviderToolCalls(json, 'anthropic')
      const structuredOutputText = providerStructuredOutputToolCallText(anthropicToolCalls, req.structuredOutput)
      const source = providerCitationSource(req, providerType)
      return withProviderTextToolCallFallback({
        text: structuredOutputText ?? extractAnthropicText(json),
        usage: extractUsage(json, 'anthropic', { includeReasoning }),
        citations: [...extractCitationsFromText('', req.retrievalSources), ...(source ? extractProviderCitations(json, source) : [])],
        traces: extractTracesFromJson(json, 'anthropic', { includeReasoning }),
        providerToolCalls: executableProviderToolCalls(filterProviderStructuredOutputToolCalls(anthropicToolCalls, req.structuredOutput)),
        providerContentBlocks: extractAnthropicReplayContentBlocks(json),
      })
    }
    case 'google': {
      const source = providerCitationSource(req, providerType)
      return withProviderTextToolCallFallback({
        text: extractGoogleText(json),
        usage: extractUsage(json, 'google', { includeReasoning }),
        citations: [...extractCitationsFromText('', req.retrievalSources), ...(source ? extractProviderCitations(json, source) : [])],
        traces: extractTracesFromJson(json, 'google', { includeReasoning }),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, 'google')),
      })
    }
    case 'openai-compatible':
    case 'xiaomi-mimo': {
      const compatibleText = extractOpenAIText(json)
      const source = providerCitationSource(req, providerType)
      const citations = source
        ? dedupeCitations([...extractCitationsFromText(compatibleText, req.retrievalSources), ...extractProviderCitations(json, source)])
        : extractCitationsFromText(compatibleText, req.retrievalSources)
      return withProviderTextToolCallFallback({
        text: compatibleText,
        usage: extractUsage(json, 'openai-compatible', { includeReasoning }),
        citations,
        traces: extractTracesFromJson(json, providerType, { includeReasoning }),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, providerType)),
        reasoningContent: includeReasoning ? extractOpenAIReasoningContent(json) : undefined,
        responseItems: extractOpenAIResponseReplayItems(json),
        responseId: extractResponseId(json),
      })
    }
  }
}

export function providerReasoningResponseCanBeParsed(req: ChatRequest): boolean {
  const evidence = getProviderCompatibilityEvidenceForProvider(req.provider)
  if (providerCompatibilityEvidenceHasBehavior(evidence.id, 'reasoning')) return true
  const modelConfig = getModelConfig(req.model, req.provider.type, req.provider.modelConfigs)
  return providerCompatibilityReasoningExplicitlyDeclaredForModel(req.provider, modelConfig)
}

function providerCitationSource(req: ChatRequest, providerType: ProviderType): ProviderCitationSource | undefined {
  if (!providerCompatibilityCapabilityCanBeSentForProvider(req.provider, 'citations')) return undefined
  if (providerType === 'openai-compatible' && isPerplexityProvider(req.provider)) return 'perplexity'
  if (providerType === 'anthropic' || providerType === 'google' || providerType === 'xiaomi-mimo') return providerType
  return undefined
}

export function parseProviderBufferedStreamJson(raw: string, req: ChatRequest): ChatCompletionResult | undefined {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    return parseProviderChatCompletionJson(JSON.parse(trimmed), req)
  } catch {
    return undefined
  }
}

export function withProviderTextToolCallFallback(result: ChatCompletionResult, rawText = result.text): ChatCompletionResult {
  const fallbackCalls = result.providerToolCalls?.length ? undefined : extractProviderTextToolCalls(rawText)
  const strippedText = stripProviderTextToolCallBlocks(result.text)
  const removedTextToolCall = strippedText !== result.text || stripProviderTextToolCallBlocks(rawText) !== rawText
  const text = removedTextToolCall ? strippedText.trim() : strippedText
  const providerToolCalls = executableProviderToolCalls([
    ...(result.providerToolCalls ?? []),
    ...(fallbackCalls ?? []),
  ])
  return {
    ...result,
    text,
    ...(providerToolCalls ? { providerToolCalls } : {}),
  }
}
