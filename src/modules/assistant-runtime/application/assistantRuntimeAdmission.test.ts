import { asAssistantRunId, asContextSnapshotId, CHAT_REQUEST_SCHEMA, type ChatRequest } from '@/core'
import { createAssistantRuntime } from '../runtime'
import { createInMemoryRunStore } from '../testing/inMemoryRunStore'
import { createAgentDefinition } from '../agentDefinition'

test('rollback closes new chat and Rich admission before persistence or dispatch', async () => {
  const persistence = createInMemoryRunStore()
  const append = jest.spyOn(persistence, 'appendAndSave')
  const executor = { execute: jest.fn(async () => ({ outputText: 'not admitted' })) }
  const stream = jest.fn(async function* () { yield { type: 'text-delta' as const, text: 'not admitted' } })
  const runtime = createAssistantRuntime({ persistence, options: { newRunsEnabled: false },
    clock: { now: () => 1 }, ids: { next: () => 'unused' }, providerGateway: { describe: () => undefined, stream } })
  const request: ChatRequest = { schema: CHAT_REQUEST_SCHEMA, conversationId: 'chat', providerId: 'provider', model: 'model',
    messages: [{ id: 'message', role: 'user', text: 'task' }], generationParameterSources: {} }
  const context = { schema: 'islemind.context-snapshot.v1' as const, id: asContextSnapshotId('context'), createdAt: 1,
    conversationMessageIds: [], memoryIds: [], knowledgeSourceIds: [], attachmentIds: [], approvedToolContextIds: [] }
  for (const result of [await runtime.start({ runId: asAssistantRunId('chat'), request, context,
    agentDefinition: createAgentDefinition({ id: 'agent', name: 'Agent', providerId: 'provider', modelId: 'model' }) }),
    await runtime.executeActivity({ kind: 'chat', conversationId: 'chat', request, context, executor })]) {
    expect(result).toMatchObject({ ok: false, error: { code: 'run_not_active', retryable: false } })
  }
  expect(append).not.toHaveBeenCalled(); expect(stream).not.toHaveBeenCalled(); expect(executor.execute).not.toHaveBeenCalled()
  expect(await runtime.getRun(asAssistantRunId('chat'))).toBeUndefined()
})
