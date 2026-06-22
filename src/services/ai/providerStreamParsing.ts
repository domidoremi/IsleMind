import { st } from '@/i18n/service'
import { extractAnthropicReplayContentBlocks, mergeAnthropicReplayContentBlocks, sanitizeAnthropicReplayContentBlocks } from '@/services/ai/providerAnthropicReplay'
import { asRecord, stringValue, stringifyReasoningDetails } from '@/services/ai/providerJsonUtils'
import { extractOpenAIReasoningContent, extractOpenAIResponseReplayItems, mergeOpenAIResponseReplayItems } from '@/services/ai/providerOpenAIReplay'
import { extractGoogleText, extractOpenAIContentReasoning, extractOpenAIText, extractResponseId } from '@/services/ai/providerResponseText'
import { dedupeTraces } from '@/services/ai/providerStreamUtils'
import { createProviderTrace, isDoneEvent, isReasoningEventType, isToolEventType, stableTraceId, summarizeToolEvent } from '@/services/ai/providerTraceUtils'
import { extractProviderToolCalls, mergeProviderToolCallParts, type ProviderToolCall } from '@/services/ai/providerToolCalls'
import { extractUsage } from '@/services/ai/providerUsage'
import type { MessageUsage, ProcessTrace, ProviderType } from '@/types'

export interface ParsedStreamChunk {
  text: string
  traces: ProcessTrace[]
  usage?: MessageUsage
  responseId?: string
  providerToolCalls?: ProviderToolCall[]
  reasoningContent?: string
  responseItems?: Record<string, unknown>[]
  providerContentBlocks?: Record<string, unknown>[]
}

export interface ProviderStreamParseOptions {
  includeReasoning?: boolean
}

export function extractProviderStreamContent(chunk: string, providerType: ProviderType): string {
  return parseProviderStreamChunk(chunk, providerType).text
}

export function parseProviderStreamChunk(chunk: string, providerType: ProviderType, options: ProviderStreamParseOptions = {}): ParsedStreamChunk {
  const traces: ProcessTrace[] = []
  let providerToolCalls: ProviderToolCall[] = []
  let text = ''
  let usage: MessageUsage | undefined
  let responseId: string | undefined
  let reasoningContent = ''
  let responseItems: Record<string, unknown>[] = []
  let providerContentBlocks: Record<string, unknown>[] = []
  let sawDataLine = false
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    sawDataLine = true
    try {
      const json = JSON.parse(line.slice(6))
      const parsed = parseProviderStreamEvent(json, providerType, options)
      text += parsed.text
      traces.push(...parsed.traces)
      providerToolCalls = mergeProviderToolCallParts([...providerToolCalls, ...(parsed.providerToolCalls ?? [])])
      usage = parsed.usage ?? usage
      responseId = parsed.responseId ?? responseId
      reasoningContent += parsed.reasoningContent ?? ''
      responseItems = mergeOpenAIResponseReplayItems([...responseItems, ...(parsed.responseItems ?? [])])
      providerContentBlocks = mergeAnthropicReplayContentBlocks([...providerContentBlocks, ...(parsed.providerContentBlocks ?? [])])
    } catch {}
  }
  const trimmed = chunk.trim()
  if (!sawDataLine && trimmed.startsWith('{')) {
    try {
      const parsed = parseProviderStreamEvent(JSON.parse(trimmed), providerType, options)
      return {
        text: parsed.text,
        traces: dedupeTraces(parsed.traces),
        usage: parsed.usage,
        responseId: parsed.responseId,
        providerToolCalls: mergeProviderToolCallParts(parsed.providerToolCalls ?? []),
        reasoningContent: parsed.reasoningContent,
        responseItems: parsed.responseItems,
        providerContentBlocks: parsed.providerContentBlocks,
      }
    } catch {}
  }
  return {
    text,
    traces: dedupeTraces(traces),
    usage,
    responseId,
    providerToolCalls,
    ...(reasoningContent ? { reasoningContent } : {}),
    ...(responseItems.length ? { responseItems } : {}),
    ...(providerContentBlocks.length ? { providerContentBlocks: sanitizeAnthropicReplayContentBlocks(providerContentBlocks) } : {}),
  }
}

export function parseProviderStreamEvent(json: any, providerType: ProviderType, options: ProviderStreamParseOptions = {}): ParsedStreamChunk {
  const includeReasoning = options.includeReasoning !== false
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
      const reasoning = includeReasoning ? [
        delta?.reasoning_content,
        delta?.reasoning,
        extractOpenAIContentReasoning(delta?.content),
        stringifyReasoningDetails(delta?.reasoning_details),
        json.choices?.[0]?.message?.reasoning_content,
        json.choices?.[0]?.message?.reasoning,
        extractOpenAIContentReasoning(json.choices?.[0]?.message?.content),
        stringifyReasoningDetails(json.choices?.[0]?.message?.reasoning_details),
        json.delta?.reasoning_content,
        json.delta?.reasoning,
        stringifyReasoningDetails(json.delta?.reasoning_details),
        json.reasoning_content,
        stringifyReasoningDetails(json.reasoning_details),
        json.summary?.text,
        json.part?.text,
        json.text && isReasoningEventType(json.type) ? json.text : undefined,
        json.delta && isReasoningEventType(json.type) ? json.delta : undefined,
      ].map(stringValue).filter(Boolean).join('') : ''
      if (reasoning) {
        traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), reasoning, 'running', stableTraceId(json, 'reasoning')))
      }
      if (isToolEventType(json.type) || delta?.tool_calls || json.tool_call || json.function_call || isToolEventType(json.item?.type)) {
        traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCall'), summarizeToolEvent(json), isDoneEvent(json.type) ? 'done' : 'running', stableTraceId(json, 'tool')))
      }
      return {
        text,
        traces,
        usage: extractUsage(json, providerType === 'openai' ? 'openai' : 'openai-compatible', { includeReasoning }),
        responseId: extractResponseId(json),
        providerToolCalls: extractProviderToolCalls(json, providerType),
        reasoningContent: includeReasoning ? extractOpenAIReasoningContent(json) : undefined,
        responseItems: extractOpenAIResponseReplayItems(json),
      }
    }
    case 'anthropic': {
      let text = ''
      const traces: ProcessTrace[] = []
      if (json.type === 'content_block_delta') {
        text += stringValue(json.delta?.text)
        const thinking = includeReasoning ? stringValue(json.delta?.thinking) : ''
        if (thinking) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), thinking, 'running', stableTraceId(json, 'thinking')))
        const signature = includeReasoning ? stringValue(json.delta?.signature) : ''
        if (signature) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.thoughtSignature'), st('providerTrace.signatureSaved'), 'done', stableTraceId(json, 'signature'), { hiddenSignature: true }))
      }
      if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
        traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolCallNamed', { name: json.content_block?.name ?? 'tool' }), summarizeToolEvent(json.content_block), 'running', stableTraceId(json, 'tool')))
      }
      if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
        traces.push(createProviderTrace('tool', providerType, st('providerTrace.toolArguments'), stringValue(json.delta?.partial_json), 'running', stableTraceId(json, 'tool-input')))
      }
      return {
        text,
        traces,
        usage: extractUsage(json, 'anthropic', { includeReasoning }),
        providerToolCalls: extractProviderToolCalls(json, 'anthropic'),
        providerContentBlocks: extractAnthropicReplayContentBlocks(json),
      }
    }
    case 'google': {
      let text = ''
      const traces: ProcessTrace[] = []
      const parts = json.candidates?.[0]?.content?.parts
      if (parts) {
        for (const part of parts) {
          const item = asRecord(part)
          if (!item) continue
          const partText = stringValue(item.text)
          if (item.thought) {
            if (includeReasoning && partText) traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.reasoningSummary'), partText, 'running', stableTraceId(item, 'thought')))
          } else if (item.functionCall) {
            const functionCall = asRecord(item.functionCall)
            traces.push(createProviderTrace('tool', providerType, st('providerTrace.functionCallNamed', { name: stringValue(functionCall?.name) || 'function' }), summarizeToolEvent(item.functionCall), 'running', stableTraceId(item.functionCall, 'function')))
          } else {
            text += partText
          }
          if (includeReasoning && item.thoughtSignature) {
            traces.push(createProviderTrace('reasoning', providerType, st('providerTrace.thoughtSignature'), st('providerTrace.thoughtSignatureSaved'), 'done', stableTraceId(item, 'thought-signature'), { hiddenSignature: true }))
          }
        }
      }
      return { text, traces, usage: extractUsage(json, 'google', { includeReasoning }), providerToolCalls: extractProviderToolCalls(json, 'google') }
    }
    default:
      return { text: '', traces: [] }
  }
}
