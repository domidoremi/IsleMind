import { safeResponseText } from '@/services/ai/providerHttp'
import { extractAnthropicReplayContentBlocks } from '@/services/ai/providerAnthropicReplay'
import { dedupeCitations, extractCitationsFromText, extractProviderCitations, extractProviderCitationsFromSse } from '@/services/ai/providerCitations'
import { getWireProviderType } from '@/services/ai/providerWireProtocol'
import { extractOpenAIReasoningContent, extractOpenAIResponseReplayItems } from '@/services/ai/providerOpenAIReplay'
import { extractAnthropicText, extractGoogleText, extractOpenAIText, extractResponseId } from '@/services/ai/providerResponseText'
import { parseProviderStreamChunk } from '@/services/ai/providerStreamParsing'
import { extractTracesFromJson } from '@/services/ai/providerTraceUtils'
import { executableProviderToolCalls, extractProviderToolCalls } from '@/services/ai/providerToolCalls'
import { extractUsage } from '@/services/ai/providerUsage'
import type { ChatCompletionResult, ChatRequest } from '@/services/ai/base'
import type { ProviderType } from '@/types'

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
    return {
      text: body.text.trim(),
      citations: body.text.trim() ? extractCitationsFromText(body.text, req.retrievalSources) : [],
    }
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

  const parsed = parseProviderStreamChunk(raw, providerType)
  const text = parsed.text
  const citations = dedupeCitations([
    ...extractCitationsFromText(text, req.retrievalSources),
    ...extractProviderCitationsFromSse(raw, providerType),
  ])
  return {
    text,
    citations,
    traces: parsed.traces,
    usage: parsed.usage,
    responseId: parsed.responseId,
    providerToolCalls: executableProviderToolCalls(parsed.providerToolCalls),
    reasoningContent: parsed.reasoningContent,
    responseItems: parsed.responseItems,
    providerContentBlocks: parsed.providerContentBlocks,
  }
}

export function parseProviderChatCompletionJson(json: any, req: ChatRequest): ChatCompletionResult {
  const providerType = getWireProviderType(req.provider)
  switch (providerType) {
    case 'openai': {
      const openAIText = extractOpenAIText(json)
      return {
        text: openAIText,
        usage: extractUsage(json, providerType),
        citations: extractCitationsFromText(openAIText, req.retrievalSources),
        traces: extractTracesFromJson(json, providerType),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, providerType)),
        reasoningContent: extractOpenAIReasoningContent(json),
        responseItems: extractOpenAIResponseReplayItems(json),
        responseId: extractResponseId(json),
      }
    }
    case 'anthropic':
      return {
        text: extractAnthropicText(json),
        usage: extractUsage(json, 'anthropic'),
        citations: [...extractCitationsFromText('', req.retrievalSources), ...extractProviderCitations(json, 'anthropic')],
        traces: extractTracesFromJson(json, 'anthropic'),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, 'anthropic')),
        providerContentBlocks: extractAnthropicReplayContentBlocks(json),
      }
    case 'google':
      return {
        text: extractGoogleText(json),
        usage: extractUsage(json, 'google'),
        citations: [...extractCitationsFromText('', req.retrievalSources), ...extractProviderCitations(json, 'google')],
        traces: extractTracesFromJson(json, 'google'),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, 'google')),
      }
    case 'openai-compatible':
    case 'xiaomi-mimo': {
      const compatibleText = extractOpenAIText(json)
      return {
        text: compatibleText,
        usage: extractUsage(json, 'openai-compatible'),
        citations: extractCitationsFromText(compatibleText, req.retrievalSources),
        traces: extractTracesFromJson(json, providerType),
        providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, providerType)),
        reasoningContent: extractOpenAIReasoningContent(json),
        responseItems: extractOpenAIResponseReplayItems(json),
        responseId: extractResponseId(json),
      }
    }
  }
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
