import type { MessageUsage } from '@/types/chatContracts'
import type { ProcessTrace } from '@/core'
import type { AIProvider, ProviderType } from '@/types/providerContracts'

import {
  dedupeCitations,
  extractCitationsFromText,
  extractProviderCitations,
  extractProviderCitationsFromSse,
  type ProviderCitation,
  type ProviderCitationSource,
  type ProviderRetrievalSource,
} from './providerCitations'
import { getWireProviderType } from './providerConfigPolicy'
import {
  extractAnthropicText,
  extractGoogleText,
  extractOpenAIText,
  extractResponseId,
} from './providerResponseText'
import {
  extractAnthropicReplayContentBlocks,
  extractOpenAIReasoningContent,
  extractOpenAIResponseReplayItems,
} from './providerReplay'
import {
  filterProviderStructuredOutputToolCalls,
  providerStructuredOutputToolCallText,
  type ProviderStructuredOutputRequest,
} from './providerStructuredOutput'
import {
  executableProviderToolCalls,
  extractProviderTextToolCalls,
  extractProviderToolCalls,
  stripProviderTextToolCallBlocks,
  type ProviderToolCall,
} from './providerToolCalls'
import { extractUsage } from './providerUsage'

export interface ProviderResponseBody {
  text: string
  json: any | null
}

export interface ProviderResponseParsingRequest {
  provider: AIProvider
  model: string
  retrievalSources?: ProviderRetrievalSource[]
  structuredOutput?: ProviderStructuredOutputRequest
}

export interface ProviderResponseParsingResult {
  text: string
  usage?: MessageUsage
  citations?: ProviderCitation[]
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

export interface ProviderParsedStreamChunk {
  text: string
  traces: ProcessTrace[]
  usage?: MessageUsage
  responseId?: string
  providerToolCalls?: ProviderToolCall[]
  reasoningContent?: string
  responseItems?: Record<string, unknown>[]
  providerContentBlocks?: Record<string, unknown>[]
}

export interface ProviderResponseParsingPolicyDependencies {
  readResponseText(response: Response): Promise<string>
  parseStreamChunk(
    chunk: string,
    providerType: ProviderType,
    options?: { includeReasoning?: boolean },
  ): ProviderParsedStreamChunk
  extractTraces(
    json: any,
    providerType: ProviderType,
    options?: { includeReasoning?: boolean },
  ): ProcessTrace[]
  splitTaggedThinkingOutputText(value?: string): {
    visibleText: string
    thinkingText: string
  }
  reasoningBehaviorDocumented(provider: AIProvider): boolean
  reasoningExplicitlyDeclared(provider: AIProvider, model: string): boolean
  citationsAllowed(provider: AIProvider): boolean
  isPerplexityProvider(provider: AIProvider): boolean
  reasoningSummaryTitle(): string
}

export interface ProviderResponseParsingPolicy {
  readProviderResponseBody(response: Response): Promise<ProviderResponseBody>
  parseProviderNonStreamingText(response: Response, providerType: ProviderType): Promise<string>
  parseProviderNonStreamingResponse(
    response: Response,
    request: ProviderResponseParsingRequest,
  ): Promise<ProviderResponseParsingResult>
  parseProviderBufferedStreamResponse(
    raw: string,
    request: ProviderResponseParsingRequest,
    providerType: ProviderType,
  ): ProviderResponseParsingResult
  parseProviderChatCompletionJson(
    json: any,
    request: ProviderResponseParsingRequest,
  ): ProviderResponseParsingResult
  parseProviderBufferedStreamJson(
    raw: string,
    request: ProviderResponseParsingRequest,
  ): ProviderResponseParsingResult | undefined
  providerReasoningResponseCanBeParsed(request: ProviderResponseParsingRequest): boolean
  withProviderTextToolCallFallback(
    result: ProviderResponseParsingResult,
    rawText?: string,
  ): ProviderResponseParsingResult
}

export function createProviderResponseParsingPolicy(
  dependencies: ProviderResponseParsingPolicyDependencies,
): ProviderResponseParsingPolicy {
  async function readProviderResponseBody(response: Response): Promise<ProviderResponseBody> {
    const text = await dependencies.readResponseText(response)
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

  async function parseProviderNonStreamingText(
    response: Response,
    providerType: ProviderType,
  ): Promise<string> {
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

  async function parseProviderNonStreamingResponse(
    response: Response,
    request: ProviderResponseParsingRequest,
  ): Promise<ProviderResponseParsingResult> {
    const body = await readProviderResponseBody(response)
    if (!body.json) {
      if (providerResponseTextLooksLikeSse(body.text)) {
        const parsedSse = parseProviderBufferedStreamResponse(
          body.text,
          request,
          getWireProviderType(request.provider),
        )
        if (
          parsedSse.text ||
          parsedSse.providerToolCalls?.length ||
          parsedSse.traces?.length ||
          parsedSse.usage
        ) {
          return parsedSse
        }
      }
      return withProviderTextToolCallFallback({
        text: body.text.trim(),
        citations: body.text.trim()
          ? extractCitationsFromText(body.text, request.retrievalSources)
          : [],
      })
    }
    return parseProviderChatCompletionJson(body.json, request)
  }

  function parseProviderBufferedStreamResponse(
    raw: string,
    request: ProviderResponseParsingRequest,
    providerType: ProviderType,
  ): ProviderResponseParsingResult {
    const trimmed = raw.trim()
    if (!trimmed) return { text: '' }

    if (trimmed.startsWith('{')) {
      const parsedJson = parseProviderBufferedStreamJson(trimmed, request)
      if (parsedJson) return parsedJson
    }

    const parsed = dependencies.parseStreamChunk(raw, providerType, {
      includeReasoning: providerReasoningResponseCanBeParsed(request),
    })
    const text = stripProviderTextToolCallBlocks(parsed.text)
    const source = providerCitationSource(request, providerType)
    const citations = dedupeCitations([
      ...extractCitationsFromText(text, request.retrievalSources),
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

  function parseProviderChatCompletionJson(
    json: any,
    request: ProviderResponseParsingRequest,
  ): ProviderResponseParsingResult {
    const providerType = getWireProviderType(request.provider)
    const includeReasoning = providerReasoningResponseCanBeParsed(request)
    switch (providerType) {
      case 'openai': {
        const openAIText = extractOpenAIText(json)
        return withProviderTextToolCallFallback({
          text: openAIText,
          usage: extractUsage(json, providerType, { includeReasoning }),
          citations: extractCitationsFromText(openAIText, request.retrievalSources),
          traces: dependencies.extractTraces(json, providerType, { includeReasoning }),
          providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, providerType)),
          reasoningContent: includeReasoning ? extractOpenAIReasoningContent(json) : undefined,
          responseItems: extractOpenAIResponseReplayItems(json),
          responseId: extractResponseId(json),
        })
      }
      case 'anthropic': {
        const anthropicToolCalls = extractProviderToolCalls(json, 'anthropic')
        const structuredOutputText = providerStructuredOutputToolCallText(
          anthropicToolCalls,
          request.structuredOutput,
        )
        const source = providerCitationSource(request, providerType)
        return withProviderTextToolCallFallback({
          text: structuredOutputText ?? extractAnthropicText(json),
          usage: extractUsage(json, 'anthropic', { includeReasoning }),
          citations: [
            ...extractCitationsFromText('', request.retrievalSources),
            ...(source ? extractProviderCitations(json, source) : []),
          ],
          traces: dependencies.extractTraces(json, 'anthropic', { includeReasoning }),
          providerToolCalls: executableProviderToolCalls(
            filterProviderStructuredOutputToolCalls(
              anthropicToolCalls,
              request.structuredOutput,
            ),
          ),
          providerContentBlocks: extractAnthropicReplayContentBlocks(json),
        })
      }
      case 'google': {
        const source = providerCitationSource(request, providerType)
        return withProviderTextToolCallFallback({
          text: extractGoogleText(json),
          usage: extractUsage(json, 'google', { includeReasoning }),
          citations: [
            ...extractCitationsFromText('', request.retrievalSources),
            ...(source ? extractProviderCitations(json, source) : []),
          ],
          traces: dependencies.extractTraces(json, 'google', { includeReasoning }),
          providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, 'google')),
        })
      }
      case 'openai-compatible':
      case 'xiaomi-mimo': {
        const compatibleText = extractOpenAIText(json)
        const source = providerCitationSource(request, providerType)
        const citations = source
          ? dedupeCitations([
              ...extractCitationsFromText(compatibleText, request.retrievalSources),
              ...extractProviderCitations(json, source),
            ])
          : extractCitationsFromText(compatibleText, request.retrievalSources)
        return withProviderTextToolCallFallback({
          text: compatibleText,
          usage: extractUsage(json, 'openai-compatible', { includeReasoning }),
          citations,
          traces: dependencies.extractTraces(json, providerType, { includeReasoning }),
          providerToolCalls: executableProviderToolCalls(extractProviderToolCalls(json, providerType)),
          reasoningContent: includeReasoning ? extractOpenAIReasoningContent(json) : undefined,
          responseItems: extractOpenAIResponseReplayItems(json),
          responseId: extractResponseId(json),
        })
      }
    }
  }

  function providerReasoningResponseCanBeParsed(
    request: ProviderResponseParsingRequest,
  ): boolean {
    return dependencies.reasoningBehaviorDocumented(request.provider) ||
      dependencies.reasoningExplicitlyDeclared(request.provider, request.model)
  }

  function providerCitationSource(
    request: ProviderResponseParsingRequest,
    providerType: ProviderType,
  ): ProviderCitationSource | undefined {
    if (!dependencies.citationsAllowed(request.provider)) return undefined
    if (
      providerType === 'openai-compatible' &&
      dependencies.isPerplexityProvider(request.provider)
    ) {
      return 'perplexity'
    }
    if (
      providerType === 'anthropic' ||
      providerType === 'google' ||
      providerType === 'xiaomi-mimo'
    ) {
      return providerType
    }
    return undefined
  }

  function parseProviderBufferedStreamJson(
    raw: string,
    request: ProviderResponseParsingRequest,
  ): ProviderResponseParsingResult | undefined {
    const trimmed = raw.trim()
    if (!trimmed.startsWith('{')) return undefined
    try {
      return parseProviderChatCompletionJson(JSON.parse(trimmed), request)
    } catch {
      return undefined
    }
  }

  function withProviderTextToolCallFallback(
    result: ProviderResponseParsingResult,
    rawText = result.text,
  ): ProviderResponseParsingResult {
    const taggedText = dependencies.splitTaggedThinkingOutputText(result.text)
    const taggedRawText = dependencies.splitTaggedThinkingOutputText(rawText)
    const thinkingText = taggedText.thinkingText || taggedRawText.thinkingText
    const fallbackCalls = result.providerToolCalls?.length
      ? undefined
      : extractProviderTextToolCalls(taggedRawText.visibleText)
    const strippedText = stripProviderTextToolCallBlocks(taggedText.visibleText)
    const removedTextToolCall = strippedText !== taggedText.visibleText ||
      stripProviderTextToolCallBlocks(taggedRawText.visibleText) !== taggedRawText.visibleText
    const text = removedTextToolCall ? strippedText.trim() : strippedText
    const providerToolCalls = executableProviderToolCalls([
      ...(result.providerToolCalls ?? []),
      ...(fallbackCalls ?? []),
    ])
    const traces = thinkingText && !result.traces?.some(
      (trace) => trace.type === 'reasoning' &&
        trace.content?.includes(thinkingText.slice(0, 48)),
    )
      ? [
          ...(result.traces ?? []),
          {
            id: 'tagged-thinking-output',
            type: 'reasoning' as const,
            title: dependencies.reasoningSummaryTitle(),
            content: thinkingText,
            status: 'done' as const,
            startedAt: Date.now(),
            completedAt: Date.now(),
          },
        ]
      : result.traces
    return {
      ...result,
      text,
      ...(traces?.length ? { traces } : {}),
      ...(providerToolCalls ? { providerToolCalls } : {}),
      ...(thinkingText && !result.reasoningContent
        ? { reasoningContent: thinkingText }
        : {}),
    }
  }

  return {
    readProviderResponseBody,
    parseProviderNonStreamingText,
    parseProviderNonStreamingResponse,
    parseProviderBufferedStreamResponse,
    parseProviderChatCompletionJson,
    parseProviderBufferedStreamJson,
    providerReasoningResponseCanBeParsed,
    withProviderTextToolCallFallback,
  }
}

function providerResponseTextLooksLikeSse(text: string): boolean {
  return /^data:\s*/m.test(text)
}
