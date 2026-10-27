import { createConversationRagFinalizationRuntime } from './conversationRagFinalizationRuntime'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}

function fixture() {
  const controller = new AbortController()
  const barrier = deferred<{
    sources: { id: string; chunkId: string }[]; prompt: string
    trace: { id: string; stage: string; title: string; status: 'done'; startedAt: number }[]
  }>()
  const retrieveSupplementalEvidence = jest.fn(() => barrier.promise)
  const recordTrace = jest.fn()
  const input = {
    conversationId: 'conversation', assistantMessageId: 'response',
    conversation: { id: 'conversation', messages: [{ role: 'user', content: 'original request' }] },
    plan: { query: 'original query', enabledTechniques: ['flare'] },
    contextSources: [{ id: 'initial', chunkId: 'initial-chunk' }],
    citations: [{ id: 'initial', chunkId: 'initial-chunk' }],
    verification: { confidence: 0.2, factualClaimCount: 2, citedClaimCount: 0,
      unsupportedClaimCount: 2, needsFlare: true, reasons: ['original reason'], followupQuery: 'follow-up' },
    settings: { knowledgeEnabled: true, knowledgeSources: ['original-scope'] },
    signal: controller.signal,
  }
  const runtime = createConversationRagFinalizationRuntime({
    retrieveSupplementalEvidence, recordTrace, verifyGeneration: jest.fn(),
    logEvaluation: jest.fn(async () => undefined), now: () => 1,
    traceId: (prefix: string) => prefix, buildTrace: (value: unknown) => value,
    completeTrace: (value: unknown) => value, translate: (key: string) => key,
  })
  const result = { sources: [{ id: 'supplemental', chunkId: 'new-chunk' }], prompt: 'evidence',
    trace: [{ id: 'retrieved', stage: 'flare', title: 'Retrieved', status: 'done' as const, startedAt: 1 }] }
  return { controller, barrier, retrieveSupplementalEvidence, recordTrace, input, runtime, result }
}

it('forwards detached admitted settings, scope, exclusions and the original signal to FLARE', async () => {
  const f = fixture()
  const run = f.runtime.resolveSupplementalEvidence(f.input)
  f.input.settings.knowledgeSources.push('later-scope')
  f.input.contextSources[0].chunkId = 'later-chunk'
  f.input.conversation.messages[0].content = 'later request'
  f.input.verification.reasons.push('later reason')
  f.input.citations[0].id = 'later-citation'
  f.barrier.resolve(f.result)
  const outcome = await run
  expect(f.retrieveSupplementalEvidence).toHaveBeenCalledWith({
    conversation: { id: 'conversation', messages: [{ role: 'user', content: 'original request' }] },
    query: 'original query', followupQuery: 'follow-up', excludeChunkIds: ['initial-chunk'],
    limit: 4, signal: f.controller.signal,
    settings: { knowledgeEnabled: true, knowledgeSources: ['original-scope'] },
  })
  expect(outcome).toMatchObject({ status: 'completed', evidenceAttached: true,
    citations: [{ id: 'initial', chunkId: 'initial-chunk' }, { id: 'supplemental', chunkId: 'new-chunk' }] })
  expect(f.recordTrace.mock.calls.at(-1)?.[0]).toMatchObject({
    trace: { metadata: { reasons: ['original reason'], revisionSkipped: true } },
  })
})

it.each(['success', 'rejection'] as const)('settles admitted FLARE %s without attaching or projecting late evidence after cancellation', async mode => {
  const f = fixture()
  let settled = false
  const run = f.runtime.resolveSupplementalEvidence(f.input).finally(() => { settled = true })
  f.input.signal = new AbortController().signal
  f.controller.abort()
  await Promise.resolve()
  expect(settled).toBe(false)
  if (mode === 'success') f.barrier.resolve(f.result)
  else f.barrier.reject(new Error('late failure'))
  await expect(run).resolves.toEqual({ status: 'skipped', reason: 'request_aborted', sources: [],
    citations: [{ id: 'initial', chunkId: 'initial-chunk' }] })
  expect(f.recordTrace).not.toHaveBeenCalled()
})

it('treats an adapter AbortError as cancellation instead of a failed evidence request', async () => {
  const f = fixture()
  const run = f.runtime.resolveSupplementalEvidence(f.input)
  f.barrier.reject(Object.assign(new Error('stopped'), { name: 'AbortError' }))
  await expect(run).resolves.toMatchObject({ status: 'skipped', reason: 'request_aborted' })
  expect(f.recordTrace).not.toHaveBeenCalled()
})

it('does not attach evidence if an observed retrieval trace cancels the original request', async () => {
  const f = fixture()
  f.recordTrace.mockImplementationOnce(() => f.controller.abort())
  const pending = f.runtime.resolveSupplementalEvidence(f.input)
  f.barrier.resolve(f.result)
  await expect(pending).resolves.toMatchObject({ status: 'skipped', reason: 'request_aborted', sources: [] })
  expect(f.recordTrace).toHaveBeenCalledTimes(1)
  expect(f.recordTrace.mock.calls[0][0]).toMatchObject({ trace: { id: 'retrieved' } })
})

it('does not return attached evidence if the final evidence projection cancels the original request', async () => {
  const f = fixture()
  f.result.trace = []
  f.recordTrace.mockImplementationOnce(() => f.controller.abort())
  const pending = f.runtime.resolveSupplementalEvidence(f.input)
  f.barrier.resolve(f.result)
  await expect(pending).resolves.toEqual({
    status: 'skipped', reason: 'request_aborted', sources: [],
    citations: [{ id: 'initial', chunkId: 'initial-chunk' }],
  })
  expect(f.recordTrace).toHaveBeenCalledTimes(1)
  expect(f.recordTrace.mock.calls[0][0]).toMatchObject({ trace: { id: 'flare-evidence' } })
})

it('retains an ordinary evidence failure and does not admit pre-aborted retrieval', async () => {
  const f = fixture()
  const run = f.runtime.resolveSupplementalEvidence(f.input)
  const error = new Error('retrieval failed')
  f.barrier.reject(error)
  await expect(run).resolves.toMatchObject({ status: 'failed', error })
  expect(f.recordTrace).toHaveBeenCalledWith(expect.objectContaining({
    trace: expect.objectContaining({ status: 'error' }),
  }))
  const aborted = fixture()
  aborted.controller.abort()
  await expect(aborted.runtime.resolveSupplementalEvidence(aborted.input)).resolves.toMatchObject({
    status: 'skipped', reason: 'request_aborted',
  })
  expect(aborted.retrieveSupplementalEvidence).not.toHaveBeenCalled()
})
