import { createConversationRunUseCase } from './conversationRunUseCase'
import type { ConversationSnapshot } from '../domain/conversationSnapshot'
import type { ConversationRunUseCaseDependencies } from '../contracts'
import { asAssistantRunId, err } from '@/core'
import type { AssistantModelOperationSession } from '@/modules/assistant-runtime'

const conversation: ConversationSnapshot = {
  schema: 'islemind.conversation-snapshot.v3',
  id: 'conversation-1',
  providerId: 'provider-1',
  model: 'model-1',
  messages: [{ id: 'message-1', role: 'user', text: 'Hello' }],
}

it('forwards the exact reviewed continuation to the shared Harness', async () => {
  const { dependencies } = createDependencies(async () => { throw new Error('unused') })
  const resume = jest.fn(async () => err('run_not_active' as const, 'fixture'))
  const useCase = createConversationRunUseCase({ ...dependencies,
    createModelOperationSession: async () => ({} as AssistantModelOperationSession),
    assistantRuntime: { ...dependencies.assistantRuntime, resumeModelOperation: resume },
  })
  await useCase.resumeModelOperation({ runId: asAssistantRunId('run'), approved: true,
    continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' })
  expect(resume).toHaveBeenCalledWith(expect.objectContaining({ continuationToken: 'reviewed-token', continuationDigest: 'reviewed-digest' }))
})

it('resumes only the selected checkpoint with a fresh session, without preparing or starting a new request', async () => {
  const { dependencies, getExecuteCalls } = createDependencies(async () => { throw new Error('must not reassemble context') })
  const resume = jest.fn(async () => err('run_not_active' as const, 'changed pause'))
  const projection = jest.fn()
  const onSettled = jest.fn()
  const session = {} as AssistantModelOperationSession
  const createSession = jest.fn(async () => session)
  const useCase = createConversationRunUseCase({
    ...dependencies, createModelOperationSession: createSession,
    assistantRuntime: { ...dependencies.assistantRuntime, resume },
  })
  const signal = new AbortController().signal
  await useCase.resumePausedRun({ runId: asAssistantRunId('selected-run'), expectedJournalSequence: 9,
    cancellationSignal: signal, projection, onSettled })
  expect(createSession).toHaveBeenCalledTimes(1)
  expect(resume).toHaveBeenCalledWith(expect.objectContaining({
    runId: 'selected-run', expectedJournalSequence: 9, modelOperationSession: session,
    cancellationSignal: signal, onSettled,
  }))
  expect(getExecuteCalls()).toBe(0)
  expect(projection).not.toHaveBeenCalled()
})

it('keeps cancellation authoritative while the fresh operation session is being restored', async () => {
  const { dependencies } = createDependencies(async () => { throw new Error('unused') })
  let finish!: (value: AssistantModelOperationSession) => void
  const resume = jest.fn()
  const useCase = createConversationRunUseCase({
    ...dependencies, createModelOperationSession: () => new Promise(resolve => { finish = resolve }),
    assistantRuntime: { ...dependencies.assistantRuntime, resume },
  })
  const controller = new AbortController()
  const continuation = useCase.resumePausedRun({ runId: asAssistantRunId('run'), expectedJournalSequence: 9, cancellationSignal: controller.signal })
  controller.abort()
  finish({} as AssistantModelOperationSession)
  expect((await continuation).ok).toBe(false)
  expect(resume).not.toHaveBeenCalled()
})

it('leaves the durable pause intact when its operation catalog cannot be restored', async () => {
  const { dependencies } = createDependencies(async () => { throw new Error('unused') })
  const resume = jest.fn()
  const useCase = createConversationRunUseCase({
    ...dependencies, createModelOperationSession: async () => { throw new Error('catalog unavailable') },
    assistantRuntime: { ...dependencies.assistantRuntime, resume },
  })
  const result = await useCase.resumePausedRun({ runId: asAssistantRunId('run'), expectedJournalSequence: 9 })
  expect(result.ok ? undefined : result.error.code).toBe('provider_failed')
  expect(resume).not.toHaveBeenCalled()
})

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
      start: async () => { throw new Error('unused') },
      steer: async () => { throw new Error('unused') },
      pause: async () => { throw new Error('unused') },
      resume: async () => { throw new Error('unused') },
      approve: async () => { throw new Error('unused') },
      subscribe: () => () => undefined,
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
  it('keeps an unbound archive readable but does not start context or provider work', async () => {
    const assemble = jest.fn()
    const { dependencies, getExecuteCalls } = createDependencies(assemble)
    const useCase = createConversationRunUseCase({ ...dependencies, conversations: {
      ...dependencies.conversations, get: async () => ({ ...conversation, providerId: null, model: null }),
    } })
    await expect(useCase.start({ conversationId: conversation.id }).completion).resolves.toMatchObject({ ok: false, error: { code: 'provider_failed' } })
    expect(assemble).not.toHaveBeenCalled()
    expect(getExecuteCalls()).toBe(0)
  })
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
