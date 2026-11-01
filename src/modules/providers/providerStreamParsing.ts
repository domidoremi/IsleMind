import type { MessageUsage } from '@/types/chatContracts'
import type { ProviderType } from '@/types/providerContracts'
import type { ProcessTrace } from '@/core'

import { asRecord, stringValue, stringifyReasoningDetails } from './providerJsonPolicy'
import {
  extractAnthropicReplayContentBlocks,
  extractGoogleReplayContentParts,
  extractOpenAIReasoningContent,
  extractOpenAIResponseReplayItems,
  mergeAnthropicReplayContentBlocks,
  mergeOpenAIResponseReplayItems,
  sanitizeAnthropicReplayContentBlocks,
} from './providerReplay'
import { extractOpenAIContentReasoning, extractOpenAIText, extractResponseId } from './providerResponseText'
import {
  extractProviderToolCalls,
  mergeProviderToolCallParts,
  type ProviderToolCall,
} from './providerToolCalls'
import { isDoneEvent, isReasoningEventType, isToolEventType, stableTraceId } from './providerTracePolicy'
import { extractUsage } from './providerUsage'
import { visitProviderSseData } from './providerSseData'
import { assertProviderResponseContextCapacity } from './providerContextCapacity'
import { mergeProviderStreamOutcome, observeProviderStreamLifecycle, type ProviderStreamOutcome, type ProviderStreamProtocol } from './providerStreamLifecycle'

export interface ParsedProviderStreamChunk {
  text: string
  traces: ProcessTrace[]
  terminal?: boolean
  malformedData?: boolean
  streamProtocol?: ProviderStreamProtocol
  streamOutcome?: ProviderStreamOutcome
  usage?: MessageUsage
  responseId?: string
  providerToolCalls?: ProviderToolCall[]
  reasoningContent?: string
  responseItems?: Record<string, unknown>[]
  providerContentBlocks?: Record<string, unknown>[]
  googleContentParts?: Record<string, unknown>[]
}

export interface ProviderStreamParseOptions {
  includeReasoning?: boolean
  /** Internal stream assembly only; remove indexes at the completion boundary. */
  preserveReplayIndexes?: boolean
  protocol?: ProviderStreamProtocol
}

export interface ProviderStreamParsingPolicyDependencies {
  translate(
    key: string,
    values?: Record<string, string | number | boolean | null | undefined>,
  ): string
  createTrace(
    type: ProcessTrace['type'],
    providerType: ProviderType,
    title: string,
    content: string,
    status: ProcessTrace['status'],
    id: string,
    metadata?: Record<string, unknown>,
  ): ProcessTrace
  summarizeToolEvent(value: unknown): string
}

export interface ProviderStreamParsingPolicy {
  parseProviderStreamChunk(
    chunk: string,
    providerType: ProviderType,
    options?: ProviderStreamParseOptions,
  ): ParsedProviderStreamChunk
  parseProviderStreamEvent(
    json: any,
    providerType: ProviderType,
    options?: ProviderStreamParseOptions,
  ): ParsedProviderStreamChunk
  splitSseBuffer(buffer: string): { events: string[]; remainder: string }
  dedupeTraces(traces: ProcessTrace[]): ProcessTrace[]
}

/** Pure provider-event parsing policy. Runtime I/O and cancellation remain outside this boundary. */
export function createProviderStreamParsingPolicy(
  dependencies: ProviderStreamParsingPolicyDependencies,
): ProviderStreamParsingPolicy {
  function splitSseBuffer(buffer: string): { events: string[]; remainder: string } {
    // A chunk may end between CR and LF. Keep that trailing CR pending so the
    // next chunk cannot turn one CRLF line ending into a false blank line.
    const pendingCr = buffer.endsWith('\r') ? '\r' : ''
    const complete = pendingCr ? buffer.slice(0, -1) : buffer
    const normalized = complete.replace(/\r\n|\r/g, '\n')
    const parts = normalized.split('\n\n')
    const remainder = `${parts.pop() ?? ''}${pendingCr}`
    return { events: parts, remainder }
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

  function parseProviderStreamChunk(
    chunk: string,
    providerType: ProviderType,
    options: ProviderStreamParseOptions = {},
  ): ParsedProviderStreamChunk {
    const traces: ProcessTrace[] = []
    let providerToolCalls: ProviderToolCall[] = []
    let text = ''
    let usage: MessageUsage | undefined
    let responseId: string | undefined
    let reasoningContent = ''
    let responseItems: Record<string, unknown>[] = []
    let providerContentBlocks: Record<string, unknown>[] = []
    const googleContentParts: Record<string, unknown>[] = []
    let streamOutcome: ProviderStreamOutcome | undefined
    let streamProtocol = options.protocol ?? protocolForType(providerType)
    let nativeTerminal = false
    function appendPayload(payload: string): boolean {
      if (nativeTerminal || !payload.trim()) return true
      let json: unknown
      try { json = JSON.parse(payload) } catch { return false }
      const parsed = parseProviderStreamEvent(json, providerType, { ...options, preserveReplayIndexes: true })
      text += parsed.text
      traces.push(...parsed.traces)
      providerToolCalls = mergeProviderToolCallParts([
        ...providerToolCalls,
        ...(parsed.providerToolCalls ?? []),
      ])
      usage = parsed.usage ?? usage
      responseId = parsed.responseId ?? responseId
      reasoningContent += parsed.reasoningContent ?? ''
      responseItems = mergeOpenAIResponseReplayItems([
        ...responseItems,
        ...(parsed.responseItems ?? []),
      ])
      providerContentBlocks = mergeAnthropicReplayContentBlocks([
        ...providerContentBlocks,
        ...(parsed.providerContentBlocks ?? []),
      ])
      googleContentParts.push(...(parsed.googleContentParts ?? []))
      streamOutcome = mergeProviderStreamOutcome(streamOutcome, parsed.streamOutcome)
      streamProtocol = parsed.streamProtocol ?? streamProtocol
      nativeTerminal = parsed.terminal === true
      return true
    }

    const { sawDataLine, terminal, malformedData } = visitProviderSseData(chunk, appendPayload)
    const trimmed = chunk.trim()
    if (!sawDataLine && trimmed.startsWith('{')) {
      let json: unknown
      try { json = JSON.parse(trimmed) } catch {
        return { text: '', traces: [], malformedData: true, streamProtocol }
      }
      const parsed = parseProviderStreamEvent(json, providerType, options)
      return {
        text: parsed.text,
        traces: dedupeTraces(parsed.traces),
        usage: parsed.usage,
        responseId: parsed.responseId,
        providerToolCalls: mergeProviderToolCallParts(parsed.providerToolCalls ?? []),
        reasoningContent: parsed.reasoningContent,
        responseItems: parsed.responseItems,
        providerContentBlocks: parsed.providerContentBlocks,
        googleContentParts: parsed.googleContentParts,
        terminal: parsed.terminal === true,
        streamProtocol: parsed.streamProtocol ?? streamProtocol,
        streamOutcome: parsed.streamOutcome,
      }
    }
    return {
      text,
      traces: dedupeTraces(traces),
      terminal: terminal || nativeTerminal,
      malformedData,
      streamProtocol,
      streamOutcome,
      usage,
      responseId,
      providerToolCalls,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(responseItems.length ? { responseItems } : {}),
      ...(googleContentParts.length ? { googleContentParts } : {}),
      ...(providerContentBlocks.length
        ? {
            providerContentBlocks: options.preserveReplayIndexes
              ? providerContentBlocks
              : sanitizeAnthropicReplayContentBlocks(providerContentBlocks),
          }
        : {}),
    }
  }

  function parseProviderStreamEvent(
    json: any,
    providerType: ProviderType,
    options: ProviderStreamParseOptions = {},
  ): ParsedProviderStreamChunk {
    const parsed = parseProviderStreamEventContent(json, providerType, options)
    return { ...parsed, ...observeProviderStreamLifecycle(json, options.protocol ?? protocolForType(providerType)) }
  }

  function parseProviderStreamEventContent(
    json: any,
    providerType: ProviderType,
    options: ProviderStreamParseOptions = {},
  ): ParsedProviderStreamChunk {
    assertProviderResponseContextCapacity(json)
    const includeReasoning = options.includeReasoning !== false
    switch (providerType) {
      case 'openai':
      case 'openai-compatible':
      case 'xiaomi-mimo': {
        let text = isDoneEvent(json.type) ? '' : extractOpenAIText(json)
        const traces: ProcessTrace[] = []
        const delta = json.choices?.[0]?.delta
        if (
          json.type === 'response.output_text.delta' ||
          json.type === 'response.refusal.delta'
        ) {
          text += stringValue(json.delta)
        }
        const reasoning = includeReasoning
          ? [
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
            ]
              .map(stringValue)
              .filter(Boolean)
              .join('')
          : ''
        if (reasoning) {
          traces.push(
            dependencies.createTrace(
              'reasoning',
              providerType,
              dependencies.translate('providerTrace.reasoningSummary'),
              reasoning,
              'running',
              stableTraceId(json, 'reasoning'),
            ),
          )
        }
        if (
          isToolEventType(json.type) ||
          delta?.tool_calls ||
          json.tool_call ||
          json.function_call ||
          isToolEventType(json.item?.type)
        ) {
          traces.push(
            dependencies.createTrace(
              'tool',
              providerType,
              dependencies.translate('providerTrace.toolCall'),
              dependencies.summarizeToolEvent(json),
              isDoneEvent(json.type) ? 'done' : 'running',
              stableTraceId(json, 'tool'),
              { clientToolCall: Boolean(delta?.tool_calls || delta?.function_call || json.tool_call || json.function_call ||
                stringValue(json.type).includes('function_call') || json.item?.type === 'function_call') },
            ),
          )
        }
        return {
          text,
          traces,
          usage: extractUsage(
            json,
            providerType === 'openai' ? 'openai' : 'openai-compatible',
            { includeReasoning },
          ),
          responseId: extractResponseId(json),
          providerToolCalls: extractProviderToolCalls(json, providerType),
          reasoningContent: includeReasoning
            ? extractOpenAIReasoningContent(json)
            : undefined,
          responseItems: extractOpenAIResponseReplayItems(json),
        }
      }
      case 'anthropic': {
        let text = ''
        const traces: ProcessTrace[] = []
        if (json.type === 'content_block_delta') {
          text += stringValue(json.delta?.text)
          const thinking = includeReasoning ? stringValue(json.delta?.thinking) : ''
          if (thinking) {
            traces.push(
              dependencies.createTrace(
                'reasoning',
                providerType,
                dependencies.translate('providerTrace.reasoningSummary'),
                thinking,
                'running',
                stableTraceId(json, 'thinking'),
              ),
            )
          }
          const signature = includeReasoning ? stringValue(json.delta?.signature) : ''
          if (signature) {
            traces.push(
              dependencies.createTrace(
                'reasoning',
                providerType,
                dependencies.translate('providerTrace.thoughtSignature'),
                dependencies.translate('providerTrace.signatureSaved'),
                'done',
                stableTraceId(json, 'signature'),
                { hiddenSignature: true },
              ),
            )
          }
        }
        if (json.type === 'content_block_start' && json.content_block?.type === 'tool_use') {
          traces.push(
            dependencies.createTrace(
              'tool',
              providerType,
              dependencies.translate('providerTrace.toolCallNamed', {
                name: json.content_block?.name ?? 'tool',
              }),
              dependencies.summarizeToolEvent(json.content_block),
              'running',
              stableTraceId(json, 'tool'),
              { clientToolCall: true },
            ),
          )
        }
        if (json.type === 'content_block_delta' && json.delta?.type === 'input_json_delta') {
          traces.push(
            dependencies.createTrace(
              'tool',
              providerType,
              dependencies.translate('providerTrace.toolArguments'),
              stringValue(json.delta?.partial_json),
              'running',
              stableTraceId(json, 'tool-input'),
              { clientToolCall: true },
            ),
          )
        }
        return {
          text,
          traces,
          usage: extractUsage(json, 'anthropic', { includeReasoning }),
          providerToolCalls: extractProviderToolCalls(json, 'anthropic'),
          providerContentBlocks: extractAnthropicReplayContentBlocks(json, options),
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
              if (includeReasoning && partText) {
                traces.push(
                  dependencies.createTrace(
                    'reasoning',
                    providerType,
                    dependencies.translate('providerTrace.reasoningSummary'),
                    partText,
                    'running',
                    stableTraceId(item, 'thought'),
                  ),
                )
              }
            } else if (item.functionCall) {
              const functionCall = asRecord(item.functionCall)
              traces.push(
                dependencies.createTrace(
                  'tool',
                  providerType,
                  dependencies.translate('providerTrace.functionCallNamed', {
                    name: stringValue(functionCall?.name) || 'function',
                  }),
                  dependencies.summarizeToolEvent(item.functionCall),
                  'running',
                  stableTraceId(item.functionCall, 'function'),
                  { clientToolCall: true },
                ),
              )
            } else {
              text += partText
            }
            if (includeReasoning && item.thoughtSignature) {
              traces.push(
                dependencies.createTrace(
                  'reasoning',
                  providerType,
                  dependencies.translate('providerTrace.thoughtSignature'),
                  dependencies.translate('providerTrace.thoughtSignatureSaved'),
                  'done',
                  stableTraceId(item, 'thought-signature'),
                  { hiddenSignature: true },
                ),
              )
            }
          }
        }
        return {
          text,
          traces,
          usage: extractUsage(json, 'google', { includeReasoning }),
          providerToolCalls: extractProviderToolCalls(json, 'google'),
          googleContentParts: extractGoogleReplayContentParts(json),
        }
      }
      default:
        return { text: '', traces: [] }
    }
  }

  return {
    parseProviderStreamChunk,
    parseProviderStreamEvent,
    splitSseBuffer,
    dedupeTraces,
  }
}

function protocolForType(providerType: ProviderType): ProviderStreamProtocol {
  return providerType === 'anthropic' ? 'anthropic' : providerType === 'google' ? 'google' : 'openai-chat'
}
