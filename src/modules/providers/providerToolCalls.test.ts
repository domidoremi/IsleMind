import { executableProviderToolCalls, extractProviderToolCalls, mergeProviderToolCallParts } from './providerToolCalls'
import { createProviderStreamParsingPolicy } from './providerStreamParsing'

const name = 'islemind_builtin_islemind_builtins_set_theme_mode_opztj0'
const parser = createProviderStreamParsingPolicy({ translate: key => key,
  createTrace: (type, _provider, title, content, status, id) => ({ type, title, content, status, id }), summarizeToolEvent: () => '' })
const delta = (args: string, toolName = '', id?: string) => ({ choices: [{ delta: { tool_calls: [{ index: 0, ...(id ? { id } : {}), function: { name: toolName, arguments: args } }] } }] })

it('retains complete arguments after empty OpenAI argument deltas', () => {
  const calls = mergeProviderToolCallParts([delta('{"mode":', name, 'call-1'), delta('"light"}'), delta('')]
    .flatMap(event => extractProviderToolCalls(event, 'openai') ?? []))
  expect(executableProviderToolCalls(calls)).toEqual([expect.objectContaining({ name, arguments: { mode: 'light' } })])
})

it('assembles fragmented names and JSON independent of SSE network chunk boundaries', () => {
  const events = [delta('', name.slice(0, 21), 'call-1'), delta('{', name.slice(21)),
    ...'"mode":"light"}'.split('').map(char => delta(char)), delta('')]
  const all = events.map(event => `data: ${JSON.stringify(event)}\n\n`)
  const buffered = parser.parseProviderStreamChunk(all.join(''), 'openai').providerToolCalls
  const fragmented = mergeProviderToolCallParts(all.flatMap(text => parser.parseProviderStreamChunk(text, 'openai').providerToolCalls ?? []))
  for (const calls of [buffered, fragmented]) expect(executableProviderToolCalls(calls)).toEqual([
    expect.objectContaining({ name, arguments: { mode: 'light' } }),
  ])
})

it('never executes incomplete JSON, even after an empty terminal delta', () => {
  const calls = mergeProviderToolCallParts([delta('{"mode":"light"', name, 'call-1'), delta('')]
    .flatMap(event => extractProviderToolCalls(event, 'openai') ?? []))
  expect(executableProviderToolCalls(calls)).toBeUndefined()
})

it('does not mistake Responses reasoning or hosted search items for malformed client calls', () => {
  const events = [
    { type: 'response.output_item.added', item: { id: 'r-1', type: 'reasoning', summary: [] } },
    { type: 'response.output_item.done', item: { id: 'w-1', type: 'web_search_call', status: 'completed' } },
    { output: [{ id: 'w-1', type: 'web_search_call', status: 'completed' }] },
  ]
  expect(executableProviderToolCalls(events.flatMap(event => extractProviderToolCalls(event, 'openai') ?? []), true)).toBeUndefined()
})


it('rejects an entire terminal batch when any arguments are incomplete', () => {
  const calls = extractProviderToolCalls(delta('{"mode":"light"', name, 'broken'), 'openai')
  expect(() => executableProviderToolCalls(calls, true)).toThrow('incomplete tool call')
})

it('does not interpret a valid nested JSON fragment as a replacement snapshot', () => {
  const calls = [delta('{"options":', name, 'nested'), delta('{}'), delta('}')]
    .flatMap(event => extractProviderToolCalls(event, 'openai') ?? [])
  expect(executableProviderToolCalls(calls, true)?.[0].arguments).toEqual({ options: {} })
})

it('reconciles Responses deltas and final snapshots without duplicating arguments', () => {
  const events = [
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', name, arguments: '' } },
    { type: 'response.function_call_arguments.delta', item_id: 'fc-1', output_index: 0, delta: '{"mode":' },
    { type: 'response.function_call_arguments.delta', item_id: 'fc-1', output_index: 0, delta: '"light"}' },
    { type: 'response.function_call_arguments.done', item_id: 'fc-1', output_index: 0, arguments: '{"mode":"light"}' },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc-1', call_id: 'call-1', name, arguments: '{"mode":"light"}' } },
  ]
  expect(executableProviderToolCalls(events.flatMap(event => extractProviderToolCalls(event, 'openai') ?? []), true))
    .toEqual([expect.objectContaining({ name, callId: 'call-1', arguments: { mode: 'light' } })])
})

it('replaces Anthropic initial empty input and keeps interleaved calls separate', () => {
  const events = [0, 1].map(index => ({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: `call-${index}`, name, input: {} } }))
  const chunks = [
    ...events,
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"mode":"dark"}' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"mode":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"light"}' } },
  ]
  expect(executableProviderToolCalls(chunks.flatMap(event => extractProviderToolCalls(event, 'anthropic') ?? []), true)?.map(call => call.arguments))
    .toEqual([{ mode: 'light' }, { mode: 'dark' }])
})

it('preserves Google call identity, arguments and thought signatures', () => {
  const calls = extractProviderToolCalls({ candidates: [{ content: { parts: [
    { functionCall: { id: 'g-1', name, args: { mode: 'light' } }, thoughtSignature: 'opaque-signature' },
    { functionCall: { id: 'g-2', name, args: { mode: 'dark' } } },
  ] } }] }, 'google')
  expect(executableProviderToolCalls(calls, true)).toEqual([
    expect.objectContaining({ id: 'g-1', name, arguments: { mode: 'light' }, thoughtSignature: 'opaque-signature' }),
    expect.objectContaining({ id: 'g-2', name, arguments: { mode: 'dark' } }),
  ])
})
