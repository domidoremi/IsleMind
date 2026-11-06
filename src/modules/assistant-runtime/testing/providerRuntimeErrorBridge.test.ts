import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA } from '@/core'
import type { AIProvider } from '@/types/providerContracts'
import { createProviderGateway, providerRuntimeError } from '@/modules/providers'
import { createAssistantRuntime } from '@/modules/assistant-runtime'
import { createProviderRuntimeAdapter } from '@/bootstrap/providerRuntime'
import { createInMemoryRunStore } from './inMemoryRunStore'

jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({ bindProviderModelAvailabilityOperations: jest.fn() }))
jest.mock('@/bootstrap/usageStatisticsRuntime', () => ({}))

it('retains authentication classification across the actual callback adapter, provider gateway and durable runtime', async () => {
  const provider: AIProvider = { id: 'safe-error-provider', type: 'openai-compatible', name: 'Synthetic provider',
    enabled: true, models: ['synthetic-model'], apiKey: 'test-only' }
  let attempts = 0
  const gateway = createProviderGateway([createProviderRuntimeAdapter({ provider, streamChat: async (_request, _chunk, _done, onError) => {
    attempts++
    const done = Promise.resolve().then(() => onError(providerRuntimeError('Private upstream body', 'private-credential-scope', 'bad_auth')))
    return { controller: new AbortController(), done }
  } })])
  const persistence = createInMemoryRunStore()
  const runtime = createAssistantRuntime({ persistence, providerGateway: gateway, clock: { now: () => 1 }, ids: { next: () => 'unused' } })
  const id = asAssistantRunId('callback-error-run')
  await runtime.execute({ runId: id,
    request: { schema: CHAT_REQUEST_SCHEMA, conversationId: 'safe-error-chat', providerId: provider.id, model: provider.models[0],
      messages: [{ id: 'user', role: 'user', text: 'Synthetic question' }], generationParameterSources: {} },
    context: { schema: 'islemind.context-snapshot.v1', id: asContextSnapshotId('safe-error-context'), createdAt: 1,
      conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] },
  })
  const run = await persistence.get(id)
  expect(run?.failure?.providerErrorCode).toBe('bad_auth')
  expect(JSON.stringify(run)).not.toContain('Private upstream body')
  expect(JSON.stringify(run)).not.toContain('private-credential-scope')
  expect(attempts).toBe(1)
})
