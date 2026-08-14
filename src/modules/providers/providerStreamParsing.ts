import type { MessageUsage } from '@/types/chatContracts'
import type { ProviderType } from '@/types/providerContracts'
import type { ProcessTrace } from '@/core'

import { asRecord, stringValue, stringifyReasoningDetails } from './providerJsonPolicy'
import {
  extractAnthropicReplayContentBlocks,
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

export interface ParsedProviderStreamChunk {
  text: string
  traces: ProcessTrace[]
  terminal?: boolean
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
    let sawDataLine = false
    let terminal = false
    const dataPayloads: string[] = []

    for (const line of chunk.replace(/\r\n|\r/g, '\n').split('\n')) {
      if (line.startsWith(':')) continue
      const match = /^data:(.*)$/.exec(line)
      if (!match) continue
      sawDataLine = true
      const payload = match[1].startsWith(' ') ? match[1].slice(1) : match[1]
      if (payload.trim() === '[DONE]') {
        terminal = true
      } else {
        dataPayloads.push(payload)
      }
    }

    function appendPayload(payload: string): boolean {
      try {
        const json = JSON.parse(payload)
        const parsed = parseProviderStreamEvent(json, providerType, options)
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
        return true
      } catch {
        return false
      }
    }

    if (dataPayloads.length) {
      const joinedPayload = dataPayloads.join('\n')
      if (!appendPayload(joinedPayload) && dataPayloads.length > 1) {
        for (const payload of dataPayloads) appendPayload(payload)
      }
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
          terminal: false,
        }
      } catch {}
    }
    return {
      text,
      traces: dedupeTraces(traces),
      terminal,
      usage,
      responseId,
      providerToolCalls,
      ...(reasoningContent ? { reasoningContent } : {}),
      ...(responseItems.length ? { responseItems } : {}),
      ...(providerContentBlocks.length
        ? {
            providerContentBlocks: sanitizeAnthropicReplayContentBlocks(
              providerContentBlocks,
            ),
          }
        : {}),
    }
  }

  function parseProviderStreamEvent(
    json: any,
    providerType: ProviderType,
    options: ProviderStreamParseOptions = {},
  ): ParsedProviderStreamChunk {
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
            ),
          )
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
