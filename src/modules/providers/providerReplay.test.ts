import {
  extractAnthropicReplayContentBlocks,
  mergeAnthropicReplayContentBlocks,
  sanitizeAnthropicReplayContentBlocks,
} from './providerReplay'
import { createProviderStreamParsingPolicy } from './providerStreamParsing'
import { cloneOpenAIResponsesInputItems, hasOpenAIResponsesFunctionCallItem } from './providerToolReplay'
import { extractProviderToolCalls, mergeProviderToolCallParts } from './providerToolCalls'

const parser = createProviderStreamParsingPolicy({
  translate: (key) => key,
  createTrace: (type, _provider, title, content, status, id) => ({ type, title, content, status, id }),
  summarizeToolEvent: () => '',
})
const blocks = [
  { type: 'thinking', thinking: 'first', signature: 'signature-a' },
  { type: 'thinking', thinking: '', signature: 'signature-b' },
  { type: 'thinking', thinking: '', signature: 'signature-c' },
  { type: 'redacted_thinking', data: 'redacted-a' },
  { type: 'redacted_thinking', data: 'redacted-b' },
]
const events = blocks.flatMap<Record<string, unknown>>((block, index) => block.type === 'thinking' ? [
  { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
  { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } },
  { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: '' } },
  { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'signature-' } },
  { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature!.slice(-1) } },
  { type: 'content_block_stop', index },
] : [{ type: 'content_block_start', index, content_block: block }])
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

describe('provider replay identity', () => {
  it('preserves adjacent complete Anthropic blocks, including omitted and redacted thinking', () => {
    expect(extractAnthropicReplayContentBlocks({ content: blocks })).toEqual(blocks)
    expect(mergeAnthropicReplayContentBlocks(blocks)).toEqual(blocks)
  })

  it('assembles independent Anthropic signatures within a buffered SSE response', () => {
    expect(parser.parseProviderStreamChunk(events.map(sse).join(''), 'anthropic').providerContentBlocks).toEqual(blocks)
  })

  it('retains block indexes across network chunks until the completion boundary', () => {
    const parts = events.flatMap((event) => parser.parseProviderStreamChunk(sse(event), 'anthropic', {
      preserveReplayIndexes: true,
    }).providerContentBlocks ?? [])
    expect(sanitizeAnthropicReplayContentBlocks(mergeAnthropicReplayContentBlocks(parts))).toEqual(blocks)
    expect(extractAnthropicReplayContentBlocks(events[3])).toEqual([{ type: 'thinking', signature: 'signature-' }])
  })

  const calls = [
    { id: 'fc-a', callId: 'call-a', name: 'lookup', arguments: { city: 'Taipei' } },
    { id: 'fc-b', callId: 'call-b', name: 'lookup', arguments: { city: 'Tokyo' } },
  ]

  it('does not confuse Responses parallel same-name calls or recover the wrong arguments', () => {
    const items = [{ type: 'function_call', id: 'fc-b', call_id: 'call-b', name: 'lookup' }]
    expect(hasOpenAIResponsesFunctionCallItem(items, calls[0])).toBe(false)
    expect(cloneOpenAIResponsesInputItems(items, calls)).toEqual([
      { ...items[0], arguments: '{"city":"Tokyo"}' },
    ])
    expect(items[0]).not.toHaveProperty('arguments')
  })

  it('repairs legacy ID-less items only when the matching call is unambiguous', () => {
    const item = { type: 'function_call', name: 'lookup' }
    expect(cloneOpenAIResponsesInputItems([item], calls)).toEqual([item])
    expect(cloneOpenAIResponsesInputItems([item], [calls[0]])).toEqual([
      { ...item, id: 'fc-a', call_id: 'call-a', arguments: '{"city":"Taipei"}' },
    ])
  })

  it.each([{ id: 'fc-b' }, { call_id: 'call-b' }])('recovers partial Responses call fields using the remaining ID: %j', (identity) => {
    expect(cloneOpenAIResponsesInputItems([{ type: 'function_call', ...identity }], calls)).toEqual([
      { type: 'function_call', id: 'fc-b', call_id: 'call-b', name: 'lookup', arguments: '{"city":"Tokyo"}' },
    ])
  })

  it('does not repair contradictory Responses IDs by falling back to a matching name', () => {
    const item = { type: 'function_call', id: 'fc-a', call_id: 'call-b', name: 'lookup' }
    expect(cloneOpenAIResponsesInputItems([item], calls)).toEqual([item])
    expect(calls.some((call) => hasOpenAIResponsesFunctionCallItem([item], call))).toBe(false)
  })

  it('preserves Gemini server call IDs and never merges distinct calls with the same part index', () => {
    const parse = (id: string, city: string, signature?: string) => extractProviderToolCalls({
      candidates: [{ content: { parts: [{ functionCall: { id, name: 'lookup', args: { city } }, ...(signature ? { thoughtSignature: signature } : {}) }] } }],
    }, 'google')!
    const parsed = mergeProviderToolCallParts([...parse('server-a', 'Taipei', 'opaque-signature'), ...parse('server-b', 'Tokyo')])
    expect(parsed).toMatchObject([
      { id: 'server-a', index: 0, arguments: { city: 'Taipei' }, thoughtSignature: 'opaque-signature' },
      { id: 'server-b', index: 0, arguments: { city: 'Tokyo' } },
    ])
    expect(parsed[1].thoughtSignature).toBeUndefined()
  })
})
