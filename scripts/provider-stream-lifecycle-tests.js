const assert = require('node:assert/strict')
require('./offline-provider-test-guard')
const { executeHttpSseChatForTest } = require('./provider-intelligence-tests')
const { createProviderRuntimeResultPolicy } = require('../src/modules/providers/providerRuntimeResultPolicy.ts')
const { parseProviderBufferedStreamResponse } = require('../src/bootstrap/providerResponsePolicies.ts')

const resultPolicy = createProviderRuntimeResultPolicy({ nonErrorFallbackMessage: () => 'Stream failed' })
const sse = event => typeof event === 'string' ? event : `data: ${JSON.stringify(event)}\n\n`
const text = 'Partial answer. \u4e2d\u6587 \ud83d\ude42'
function delta(protocol) {
  if (protocol === 'anthropic') return { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }
  if (protocol === 'google') return { candidates: [{ content: { role: 'model', parts: [{ text }] } }] }
  if (protocol === 'openai-chat') return { choices: [{ delta: { content: text }, finish_reason: null }] }
  return { type: 'response.output_text.delta', delta: text, output_index: 0, content_index: 0 }
}
function provider(protocol) {
  const type = protocol === 'openai-responses' || protocol === 'openai-chat' ? 'openai' : protocol
  return { id: `lifecycle-${protocol}`, type, name: 'Offline lifecycle fixture', enabled: true,
    apiKey: 'synthetic-test-key', baseUrl: 'https://fixture.invalid/v1',
    models: [protocol === 'openai-responses' ? 'gpt-5-mini' : protocol === 'openai-chat' ? 'gpt-4o-mini'
      : protocol === 'anthropic' ? 'claude-sonnet-4-5' : 'gemini-2.5-flash'] }
}

async function exercise(name, protocol, events, expected, {
  open = false, byteChunks = false, noReader = false, cancelOnChunk = false,
  cancelPendingRead = false, readFailure = false, expectedText = text, compatibleAnthropic = false,
} = {}) {
  const completions = [], errors = [], chunks = []
  const controller = new AbortController()
  let cancelCount = 0, releaseCount = 0, requests = 0
  const data = new TextEncoder().encode(events.map(sse).join(''))
  const stream = new ReadableStream({
    start(output) {
      if (byteChunks) for (const byte of data) output.enqueue(Uint8Array.of(byte))
      else output.enqueue(data)
      if (!open && !readFailure) output.close()
    },
    pull(output) { if (readFailure) output.error(new DOMException('Synthetic transport abort', 'AbortError')) },
    cancel() { cancelCount++ },
  })
  const configuredProvider = provider(protocol)
  if (compatibleAnthropic) Object.assign(configuredProvider, { type: 'openai-compatible', wireProtocol: 'anthropic-compatible' })
  const req = { provider: configuredProvider, model: configuredProvider.models[0],
    messages: [{ role: 'user', content: 'Offline fixture only.' }], maxTokens: 128,
    generationParameterSources: { maxTokens: 'internal-policy' }, stream: true,
    settings: { upstreamMaxRetries: 0, upstreamCircuitBreakerEnabled: false } }
  let timeout
  const watchdog = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new Error(`${name}: executor did not settle before the test watchdog`))
    }, 1500)
  })
  try {
    await Promise.race([watchdog, resultPolicy.runStreamTask(() => executeHttpSseChatForTest({
      req, controller, stream: true, url: 'https://fixture.invalid/v1', headers: {}, body: JSON.stringify({ model: req.model }),
      resolveRoute: () => ({ url: 'https://fixture.invalid/v1', headers: {}, body: {} }),
      onChunk: chunk => {
        chunks.push(chunk)
        if (cancelOnChunk) controller.abort()
        if (cancelPendingRead) setTimeout(() => controller.abort(), 20)
      },
      onDone: result => completions.push(result), onError: error => errors.push(error),
      transport: {
        requestStream: async () => {
          requests++
          if (noReader) return { ok: true, status: 200, headers: new Headers(), text: async () => new TextDecoder().decode(data) }
          const response = new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
          const getReader = response.body.getReader.bind(response.body)
          response.body.getReader = (...args) => {
            const reader = getReader(...args)
            const release = reader.releaseLock.bind(reader)
            reader.releaseLock = () => { release(); releaseCount++ }
            return reader
          }
          return response
        },
        readResponseText: response => response.text(), endpointHost: () => 'fixture.invalid',
      },
      buildFallbackCandidates: () => ({ candidates: [], evidence: [], rejectedCandidates: [] }),
      fallbackEffects: { logDecision: async () => {}, recordRouteFailure: async () => {}, recordRouteSuccess: async () => {} },
    }), error => errors.push(error), undefined, controller.signal)])
    assert.equal(requests, 1, `${name}: no automatic retry or tool replay`)
    assert.equal(chunks.join(''), expectedText, `${name}: preserves already emitted UTF-8 output`)
    if (expected === 'cancelled') {
      assert.equal(controller.signal.aborted, true, name)
      assert.equal(completions.length + errors.length, 0, `${name}: caller cancellation is not reported as success or supplier failure`)
    } else {
      assert.equal(controller.signal.aborted, false, `${name}: semantic termination cannot depend on watchdog cancellation`)
      assert.equal(completions.length + errors.length, 1, `${name}: exactly one terminal callback`)
    }
    if (expected === 'completed') {
      assert.equal(errors.length, 0, name)
      assert.equal(completions[0].streamOutcome.status, expected, name)
    } else if (expected !== 'cancelled') {
      assert.equal(completions.length, 0, `${name}: no successful or tool-bearing completion`)
      assert.equal(errors[0].streamOutcome.status, expected, name)
      assert.equal(errors[0].partialResult.text, expectedText, name)
    }
    if (open && !noReader) {
      await new Promise(resolve => setTimeout(resolve, 75))
      assert.equal(cancelCount, 1, `${name}: cancels a transport left open after termination`)
    }
    if (!noReader) {
      await new Promise(resolve => setTimeout(resolve, 75))
      assert.equal(releaseCount, 1, `${name}: releases the reader lease exactly once`)
    }
    return { completions, errors, req }
  } finally {
    clearTimeout(timeout)
    if (!controller.signal.aborted) controller.abort()
  }
}

async function main() {
  const cases = [
    ['responses-failed', 'openai-responses', [delta('openai-responses'), { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'Synthetic failure' }, usage: { input_tokens: 12, output_tokens: 4 } } }], 'failed', { open: true }],
    ['responses-incomplete', 'openai-responses', [delta('openai-responses'), { type: 'response.incomplete', response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: { input_tokens: 12, output_tokens: 4 } } }], 'incomplete'],
    ['responses-error', 'openai-responses', [delta('openai-responses'), { type: 'error', code: 'server_error', message: 'Synthetic failure' }], 'failed'],
    ['anthropic-overloaded', 'anthropic', [delta('anthropic'), { type: 'error', error: { type: 'overloaded_error', message: 'Synthetic overload' } }], 'failed', { open: true }],
    ['google-error', 'google', [delta('google'), { error: { code: 503, status: 'UNAVAILABLE', message: 'Synthetic failure' } }], 'failed'],
    ['google-token-cap', 'google', [{ candidates: [{ content: { parts: [{ text }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } }], 'incomplete'],
    ['responses-unmarked-eof', 'openai-responses', [delta('openai-responses')], 'interrupted'],
    ['anthropic-unmarked-eof', 'anthropic', [delta('anthropic')], 'interrupted'],
    ['google-unmarked-eof', 'google', [delta('google')], 'interrupted'],
    ['responses-open-terminal', 'openai-responses', [delta('openai-responses'), { type: 'response.completed', response: { status: 'completed', id: 'resp-fixture', output: [] } }], 'completed', { open: true }],
    ['anthropic-open-terminal', 'anthropic', [delta('anthropic'), { type: 'message_stop' }], 'completed', { open: true }],
    ['google-open-terminal', 'google', [{ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }], 'completed', { open: true }],
    ['chat-unmarked-eof', 'openai-chat', [delta('openai-chat')], 'interrupted'],
    ['chat-finish-with-usage', 'openai-chat', [delta('openai-chat'), { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } }, 'data: [DONE]\n\n'], 'completed'],
    ['chat-open-finish-with-usage', 'openai-chat', [delta('openai-chat'), { choices: [{ delta: {}, finish_reason: 'stop' }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } }], 'completed', { open: true }],
    ['chat-token-cap', 'openai-chat', [delta('openai-chat'), { choices: [{ delta: {}, finish_reason: 'length' }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } }, 'data: [DONE]\n\n'], 'incomplete'],
    ['claude-token-cap', 'anthropic', [delta('anthropic'), { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4 } }, { type: 'message_stop' }], 'incomplete'],
    ['claude-token-cap-missing-stop', 'anthropic', [delta('anthropic'), { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 4 } }], 'interrupted'],
    ['google-safety-stop', 'google', [{ candidates: [{ content: { parts: [{ text }] }, finishReason: 'SAFETY' }] }], 'incomplete'],
    ['malformed-event', 'openai-responses', [delta('openai-responses'), 'data: {malformed}\n\n'], 'interrupted'],
    ['fragmented-crlf-utf8', 'openai-responses', [sse(delta('openai-responses')).replace(/\n/g, '\r\n'), ': heartbeat\r\n\r\n', { type: 'response.future_event' }, { type: 'response.completed', response: { status: 'completed', output: [] } }], 'completed', { byteChunks: true }],
    ['multiline-json', 'openai-responses', [`data: {"type":"response.output_text.delta",\ndata: "delta":${JSON.stringify(text)}}\n\n`, { type: 'response.completed', response: { status: 'completed', output: [] } }], 'completed'],
    ['ignore-events-after-terminal', 'openai-responses', [delta('openai-responses'), { type: 'response.completed', response: { status: 'completed', output: [] } }, 'data: {malformed}\n\n'], 'completed'],
    ['buffered-failed-with-usage', 'openai-responses', [delta('openai-responses'), { type: 'response.failed', response: { error: { code: 'server_error' }, usage: { input_tokens: 12, output_tokens: 4 } } }], 'failed', { noReader: true }],
    ['buffered-empty-eof', 'openai-responses', [], 'interrupted', { noReader: true, expectedText: '' }],
    ['error-before-output', 'openai-responses', [{ type: 'error', code: 'rate_limit_error', message: 'Synthetic rate limit' }], 'failed', { expectedText: '' }],
    ['failed-after-tool-call', 'openai-responses', [delta('openai-responses'), { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', name: 'synthetic_tool', call_id: 'synthetic-call', arguments: '{}' } }, { type: 'response.failed', response: { error: { code: 'server_error' } } }], 'failed'],
    ['compatible-claude-terminal', 'anthropic', [delta('anthropic'), { type: 'message_stop' }], 'completed', { open: true, compatibleAnthropic: true }],
    ['transport-abort-is-not-caller-cancel', 'openai-responses', [delta('openai-responses')], 'interrupted', { readFailure: true }],
    ['cancel-on-output', 'openai-responses', [delta('openai-responses')], 'cancelled', { open: true, cancelOnChunk: true }],
    ['cancel-pending-read', 'openai-responses', [delta('openai-responses')], 'cancelled', { open: true, cancelPendingRead: true }],
  ]
  for (const args of cases) {
    const result = await exercise(...args)
    if (args[0] === 'chat-finish-with-usage' || args[0] === 'chat-open-finish-with-usage') assert.equal(result.completions[0].usage.outputTokens, 4)
    if (args[0] === 'responses-incomplete') assert.equal(result.errors[0].partialResult.usage.outputTokens, 4)
    if (args[0] === 'buffered-failed-with-usage') assert.equal(result.errors[0].partialResult.usage.outputTokens, 4)
    if (args[0] === 'error-before-output') assert.equal(result.errors[0].chatErrorCode, 'rate_limited')
    console.log(`PASS ${args[0]}`)
  }
  const req = { provider: provider('openai-responses'), model: 'gpt-5-mini' }
  assert.throws(() => parseProviderBufferedStreamResponse(sse(delta('openai-responses')), req, 'openai'),
    error => error.streamOutcome?.status === 'interrupted', 'buffered SSE must not bypass termination checks')
  assert.throws(() => parseProviderBufferedStreamResponse(
    sse(delta('openai-responses')) + sse({ type: 'response.failed', response: { error: { code: 'server_error' } } }), req, 'openai'),
  error => error.streamOutcome?.status === 'failed', 'buffered SSE must propagate in-band errors')
  assert.throws(() => parseProviderBufferedStreamResponse(
    sse(delta('openai-chat')) + 'data: [DONE]\n\n', req, 'openai'),
  error => error.streamOutcome?.status === 'interrupted', 'a buffered fallback cannot silently change the selected Responses protocol')
  console.log(`Provider stream lifecycle regressions passed: ${cases.length} executor cases and 3 buffered cases (offline).`)
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
