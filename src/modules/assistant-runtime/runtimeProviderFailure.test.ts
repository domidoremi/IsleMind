import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { ProviderHttpError, providerRuntimeError, type ProviderGateway } from '@/modules/providers'
import { createAssistantRuntime } from './runtime'
import { createInMemoryRunStore } from './testing/inMemoryRunStore'

const request: ChatRequest = {
  schema: CHAT_REQUEST_SCHEMA, conversationId: 'failure-chat', providerId: 'provider', model: 'model',
  messages: [{ id: 'user', role: 'user', text: 'Synthetic question' }], generationParameterSources: {},
}
const context = {
  schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('failure-context'), createdAt: 1,
  conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [],
}
const runId = asAssistantRunId('failure-run')
const privateBody = 'Synthetic private provider body: api_key=fixture-secret-do-not-persist'

it.each([401, 403, 429, 503])('persists HTTP %s without provider text or automatic redispatch', async status => {
  let attempts = 0
  const gateway: ProviderGateway = { describe: () => undefined, async *stream() {
    attempts++
    yield { type: 'text-delta', text: 'Keep the partial response 日本語' }
    throw new ProviderHttpError(status, privateBody)
  } }
  const persistence = createInMemoryRunStore()
  const runtime = createAssistantRuntime({ persistence, providerGateway: gateway, clock: { now: () => 1 }, ids: { next: () => 'unused' } })
  const result = await runtime.execute({ runId, request, context })
  expect(result.ok).toBe(false)
  const saved = await persistence.get(runId)
  const journal = await persistence.list(runId)
  expect(saved).toMatchObject({ status: 'failed', failure: { code: 'provider_failed', httpStatus: status },
    checkpoint: { outputText: 'Keep the partial response 日本語' } })
  expect(journal.at(-1)).toMatchObject({ type: 'run.failed', data: { httpStatus: status } })
  expect(JSON.stringify({ result, saved, journal })).not.toContain(privateBody)
  expect(attempts).toBe(1)
})

it.each([NaN, Infinity, 399, 600, 401.5])('omits invalid transport status %s from durable evidence', async status => {
  const persistence = createInMemoryRunStore()
  const runtime = createAssistantRuntime({ persistence, providerGateway: { describe: () => undefined,
    async *stream() { throw new ProviderHttpError(status, privateBody) } },
    clock: { now: () => 1 }, ids: { next: () => 'unused' } })
  await runtime.execute({ runId, request, context })
  expect((await persistence.get(runId))?.failure?.httpStatus).toBeUndefined()
})

it('honors authoritative cancellation even when the provider then throws HTTP 401', async () => {
  const cancellation = new AbortController()
  const persistence = createInMemoryRunStore()
  const runtime = createAssistantRuntime({ persistence, providerGateway: { describe: () => undefined,
    async *stream() { cancellation.abort(); throw new ProviderHttpError(401, privateBody) } },
    clock: { now: () => 1 }, ids: { next: () => 'unused' } })
  await runtime.execute({ runId, request, context, cancellationSignal: cancellation.signal })
  expect((await persistence.get(runId))?.status).toBe('cancelled')
  expect((await persistence.get(runId))?.failure).toBeUndefined()
})

it.each(['bad_auth', 'rate_limited', 'network_error'] as const)('preserves callback adapter classification %s without persisting its message', async code => {
  const persistence = createInMemoryRunStore()
  const runtime = createAssistantRuntime({ persistence, providerGateway: { describe: () => undefined,
    async *stream() { throw providerRuntimeError(privateBody, 'private-credential-scope', code) } },
    clock: { now: () => 1 }, ids: { next: () => 'unused' } })
  await runtime.execute({ runId, request, context })
  const saved = await persistence.get(runId)
  const journal = await persistence.list(runId)
  expect(saved?.failure?.providerErrorCode).toBe(code)
  expect(JSON.stringify({ saved, journal })).not.toContain(privateBody)
  expect(JSON.stringify({ saved, journal })).not.toContain('private-credential-scope')
})
