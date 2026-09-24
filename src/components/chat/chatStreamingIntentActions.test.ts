import type { Conversation } from '@/types/chatContracts'
import { CONVERSATION_LOCK_REASON, lockConversation } from '@/services/conversationLock'

import { sendActiveChatMessage } from './chatStreamingIntentActions'

const conversation: Conversation = {
  id: 'send-boundary', title: 'Draft recovery', providerId: 'unused', model: 'unused',
  systemPrompt: '', temperature: 0.7, maxTokens: 1024, messages: [], createdAt: 0, updatedAt: 0,
}

function createSendInput() {
  return {
    conversation,
    content: 'Keep this unsent draft',
    attachments: [],
    requestedOutput: 'reply' as const,
    scrollToLatestMessage: jest.fn(),
    sendMessage: jest.fn(async () => undefined),
  }
}

describe('active chat send acceptance', () => {
  it('rejects a newly locked conversation instead of reporting a successful send', async () => {
    const input = createSendInput()
    const unlock = lockConversation(conversation.id)
    try {
      // Composer clears the persisted draft only when this promise resolves.
      // A lock acquired after its last render must enter the recovery path.
      await expect(sendActiveChatMessage(input)).rejects.toThrow(CONVERSATION_LOCK_REASON)
      expect(input.sendMessage).not.toHaveBeenCalled()
      expect(input.scrollToLatestMessage).not.toHaveBeenCalled()
    } finally {
      unlock()
    }
    await expect(sendActiveChatMessage(input)).resolves.toBeUndefined()
    expect(input.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('forwards the accepted payload and scrolls only when sending is allowed', async () => {
    const input = createSendInput()
    await sendActiveChatMessage(input)
    expect(input.scrollToLatestMessage).toHaveBeenCalledWith(false, 0, { force: true, replacePending: true })
    expect(input.sendMessage).toHaveBeenCalledWith({
      conversation, content: input.content, attachments: input.attachments, requestedOutput: 'reply',
    })
  })

  it('preserves a dispatch rejection for composer draft recovery', async () => {
    const input = createSendInput()
    const failure = new Error('storage unavailable')
    input.sendMessage.mockRejectedValue(failure)
    await expect(sendActiveChatMessage(input)).rejects.toBe(failure)
  })
})
