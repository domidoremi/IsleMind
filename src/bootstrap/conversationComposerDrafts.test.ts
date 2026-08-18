const mockPersistenceClear = jest.fn<Promise<void>, []>()
const mockNotifyConversationComposerDraftReset = jest.fn()

jest.mock('@/modules/conversations', () => ({
  createConversationComposerDraftPersistence: () => ({
    clear: () => mockPersistenceClear(),
  }),
}))

jest.mock('@/presentation/features/conversations/conversationComposerDraftCommand', () => ({
  bindConversationComposerDraftPersistence: jest.fn(),
  notifyConversationComposerDraftReset: () => mockNotifyConversationComposerDraftReset(),
  releaseConversationComposerDraftPersistence: jest.fn(),
}))

jest.mock('./applicationDataRecords', () => ({
  readApplicationDataRecord: jest.fn(),
  removeApplicationDataRecord: jest.fn(),
  writeApplicationDataRecord: jest.fn(),
}))

const {
  clearConversationComposerDraftPersistence,
} = require('./conversationComposerDrafts') as typeof import('./conversationComposerDrafts')

describe('conversationComposerDrafts reset orchestration', () => {
  beforeEach(() => {
    mockPersistenceClear.mockReset()
    mockNotifyConversationComposerDraftReset.mockReset()
  })

  it('invalidates mounted Composer state before waiting for durable removal', async () => {
    let resolveClear!: () => void
    const clearPending = new Promise<void>((resolve) => {
      resolveClear = resolve
    })
    mockPersistenceClear.mockReturnValue(clearPending)

    const reset = clearConversationComposerDraftPersistence()

    expect(mockNotifyConversationComposerDraftReset).toHaveBeenCalledTimes(1)
    expect(mockPersistenceClear).toHaveBeenCalledTimes(1)
    expect(mockNotifyConversationComposerDraftReset.mock.invocationCallOrder[0]).toBeLessThan(
      mockPersistenceClear.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )

    resolveClear()
    await reset
  })
})
