import {
  finishProviderStream, mergeProviderStreamOutcome, observeProviderStreamLifecycle,
  ProviderStreamLifecycleError, type ProviderStreamProtocol,
} from './providerStreamLifecycle'
import { createProviderStreamParsingPolicy } from './providerStreamParsing'

it.each([
  ['openai-responses', { type: 'response.failed', response: { error: { code: 'server_error', message: 'Failed' } } }, 'failed', 'upstream_error'],
  ['openai-responses', { type: 'error', code: 'rate_limit_error', message: 'Limited' }, 'failed', 'rate_limited'],
  ['openai-responses', { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }, 'incomplete', 'max_tokens_exceeded'],
  ['anthropic', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'failed', 'upstream_error'],
  ['google', { error: { code: 503, status: 'UNAVAILABLE', message: 'Unavailable' } }, 'failed', 'upstream_error'],
  ['google', { candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'incomplete', 'max_tokens_exceeded'],
  ['google', { candidates: [{ finishReason: 'SAFETY' }] }, 'incomplete', 'upstream_error'],
  ['openai-chat', { choices: [{ finish_reason: 'length' }] }, 'incomplete', 'max_tokens_exceeded'],
  ['openai-chat', { choices: [{ finish_reason: 'content_filter' }] }, 'incomplete', 'upstream_error'],
] as const)('keeps %s failure and incomplete outcomes explicit', (protocol, event, status, code) => {
  const parsed = observeProviderStreamLifecycle(event, protocol)
  const outcome = finishProviderStream(protocol, parsed.streamOutcome, parsed.terminal === true)
  expect(outcome.status).toBe(status)
  const error = new ProviderStreamLifecycleError(outcome, { text: 'Partial', usage: { source: 'provider', outputTokens: 4 } })
  expect(error.chatErrorCode).toBe(code)
  expect(error.partialResult).toMatchObject({ text: 'Partial', usage: { outputTokens: 4 } })
})

it.each([
  ['openai-responses', { type: 'response.completed', response: { status: 'completed' } }],
  ['anthropic', { type: 'message_stop' }],
  ['google', { candidates: [{ finishReason: 'STOP' }] }],
] as const)('recognizes the %s semantic terminal without transport EOF', (protocol, event) => {
  const parsed = observeProviderStreamLifecycle(event, protocol)
  expect(parsed.terminal).toBe(true)
  expect(finishProviderStream(protocol, parsed.streamOutcome, true).status).toBe('completed')
})

it.each(['openai-responses', 'anthropic', 'google'] as ProviderStreamProtocol[])(
  'does not let [DONE] or empty EOF replace %s native completion', protocol => {
    expect(finishProviderStream(protocol, undefined, true).status).toBe('interrupted')
    expect(finishProviderStream(protocol, undefined, false).status).toBe('interrupted')
  },
)

it('waits for the Chat usage trailer, while permitting EOF after a real finish_reason', () => {
  const parsed = observeProviderStreamLifecycle({ choices: [{ finish_reason: 'tool_calls' }] }, 'openai-chat')
  expect(parsed.terminal).toBe(false)
  expect(finishProviderStream('openai-chat', parsed.streamOutcome, false).status).toBe('completed')
  expect(finishProviderStream('openai-chat', undefined, true).status).toBe('completed')
  expect(finishProviderStream('openai-chat', undefined, false).status).toBe('interrupted')
})

it('does not overwrite a Claude token cap or provider error with a subsequent terminal', () => {
  const partial = observeProviderStreamLifecycle({ delta: { stop_reason: 'max_tokens' } }, 'anthropic')
  const stopped = observeProviderStreamLifecycle({ type: 'message_stop' }, 'anthropic')
  expect(mergeProviderStreamOutcome(partial.streamOutcome, stopped.streamOutcome)?.status).toBe('incomplete')
  const failed = observeProviderStreamLifecycle({ type: 'error', error: { type: 'api_error' } }, 'anthropic')
  expect(mergeProviderStreamOutcome(failed.streamOutcome, stopped.streamOutcome)?.status).toBe('failed')
})

const parsing = createProviderStreamParsingPolicy({
  translate: key => key, summarizeToolEvent: () => '',
  createTrace: () => { throw new Error('This fixture has no reasoning or tool trace') },
})

it('keeps malformed data separate from unknown legal events and heartbeats', () => {
  expect(parsing.parseProviderStreamChunk('data: {bad}\n\n', 'openai').malformedData).toBe(true)
  expect(parsing.parseProviderStreamChunk(': ping\n\ndata: {"type":"response.future"}\n\n', 'openai')).toMatchObject({
    text: '', terminal: false, malformedData: false,
  })
})

it('does not read answer data after [DONE] or native completion', () => {
  const delta = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'
  const trailer = 'data: {"choices":[{"delta":{"content":"Must not appear"}}]}\n\n'
  expect(parsing.parseProviderStreamChunk(`${delta}data: [DONE]\n\n${trailer}`, 'openai').text).toBe('Hello')
  expect(parsing.parseProviderStreamChunk(
    'data: {"type":"response.completed","response":{"status":"completed"}}\n\n' + trailer, 'openai',
  ).text).toBe('')
})
