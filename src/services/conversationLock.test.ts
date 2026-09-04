import {
  assertConversationUnlocked,
  isConversationLocked,
  lockConversation,
  resetConversationLocksForTests,
  subscribeConversationLocks,
} from './conversationLock'

describe('conversation lock', () => {
  beforeEach(() => {
    resetConversationLocksForTests()
  })

  it('supports nested owners and idempotent release', () => {
    const firstRelease = lockConversation('conversation-1')
    const secondRelease = lockConversation('conversation-1')

    expect(isConversationLocked('conversation-1')).toBe(true)
    expect(() => assertConversationUnlocked('conversation-1')).toThrow('conversation_locked_during_context_compression')

    firstRelease()
    firstRelease()
    expect(isConversationLocked('conversation-1')).toBe(true)

    secondRelease()
    expect(isConversationLocked('conversation-1')).toBe(false)
    expect(() => assertConversationUnlocked('conversation-1')).not.toThrow()
  })

  it('notifies subscribers when lock state changes', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeConversationLocks(listener)

    const release = lockConversation('conversation-2')
    release()
    unsubscribe()
    lockConversation('conversation-2')()

    expect(listener).toHaveBeenCalledTimes(2)
  })
})
