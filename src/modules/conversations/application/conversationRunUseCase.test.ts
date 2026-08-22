import { createConversationRunUseCase } from './conversationRunUseCase'
import type { ConversationSnapshot } from '../domain/conversationSnapshot'
import type { ConversationRunUseCaseDependencies } from '../contracts'

const conversation: ConversationSnapshot = {
  schema: 'islemind.conversation-snapshot.v2',
  id: 'conversation-1',
  providerId: 'provider-1',
  model: 'model-1',
  messages: [{ id: 'message-1', role: 'user', text: 'Hello' }],
}

function createDependencies(
  assemble: NonNullable<ConversationRunUseCaseDependencies['contextSnapshotAssembler']>['assemble'],
) {
  let executeCalls = 0
  const dependencies = {
    clock: { now: () => 1 },
    ids: { next: (prefix: string) => `${prefix}-1` },
    conversations: {
      get: async () => conversation,
      loadRecord: async () => undefined,
      loadAll: async () => [],
      loadPage: async () => ({ conversations: [], hasMore: false }),
      loadReplacementSnapshot: async () => [],
      save: async () => undefined,
      replaceAll: async () => undefined,
      clear: async () => undefined,
    },
    assistantRuntime: {
      execute: async () => {
        executeCalls += 1
        throw new Error('assistant runtime must not start')
      },
      executeActivity: async () => { throw new Error('unused') },
      resumeModelOperation: async () => { throw new Error('unused') },
      cancel: async () => { throw new Error('unused') },
      getRun: async () => undefined,
      recoverInterruptedRuns: async () => ({ ok: true as const, value: [] }),
    },
    contextSnapshotAssembler: { assemble },
  } satisfies ConversationRunUseCaseDependencies
  return { dependencies, getExecuteCalls: () => executeCalls }
}

describe('conversation run context assembly boundary', () => {
  it('converts thrown context failures into a typed completion result', async () => {
    const { dependencies, getExecuteCalls } = createDependencies(async () => {
      throw new Error('SQLite context read failed')
    })
    const handle = createConversationRunUseCase(dependencies).start({ conversationId: conversation.id })

    await expect(handle.completion).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'context_assembly_failed',
        message: 'SQLite context read failed',
        retryable: true,
      },
    })
    expect(getExecuteCalls()).toBe(0)
  })

  it('converts an aborted context assembler into cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const { dependencies, getExecuteCalls } = createDependencies(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    const handle = createConversationRunUseCase(dependencies).start({
      conversationId: conversation.id,
      cancellationSignal: controller.signal,
    })

    await expect(handle.completion).resolves.toMatchObject({
      ok: false,
      error: { code: 'cancelled', retryable: true },
    })
    expect(getExecuteCalls()).toBe(0)
  })
})
