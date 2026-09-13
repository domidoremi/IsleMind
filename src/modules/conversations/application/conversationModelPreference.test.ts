import { applyConversationModelPreference, hasConversationModelPreference } from './conversationModelPreference'
import { parseConversationSnapshot } from '../domain/conversationSnapshot'
import type { Conversation } from '@/types/chatContracts'

describe('Conversation preference authority', () => {
  const conversation: Conversation = {
    id: 'c', title: '', providerId: 'old', model: 'old-model', providerModelMode: 'inherited',
    systemPrompt: '', temperature: 0, maxTokens: 10, createdAt: 1, updatedAt: 1,
    messages: [{ id: 'm', role: 'assistant', content: 'Historical output', status: 'done', timestamp: 1 }],
  }

  it('explicit selection sets only the existing fields and preserves historical messages', () => {
    const selected = applyConversationModelPreference(conversation, { providerId: 'new', model: 'alias' }, 2)
    expect(selected).toMatchObject({ providerId: 'new', model: 'alias', providerModelMode: 'manual', updatedAt: 2 })
    expect(selected.messages).toBe(conversation.messages)
    expect(conversation.providerId).toBe('old')
    expect(() => applyConversationModelPreference(conversation, { providerId: '', model: 'a' }, 2)).toThrow()
  })

  it.each([undefined, null, '', '   '])('reads legacy unbound values (%s) without assigning a provider', (providerId) => {
    const snapshot = parseConversationSnapshot({ ...conversation, providerId })!
    expect(snapshot).toBeDefined()
    expect(hasConversationModelPreference(snapshot)).toBe(false)
    expect(snapshot.providerId).toBe(providerId ?? null)
    expect(snapshot.model).toBe('old-model')
  })

  it('backward-decodes v1, v2 and unversioned records; rejects unknown schema', () => {
    for (const schema of [undefined, 'islemind.conversation-snapshot.v1', 'islemind.conversation-snapshot.v2', 'islemind.conversation-snapshot.v3']) {
      const snapshot = parseConversationSnapshot({ ...conversation, ...(schema ? { schema } : {}) })!
      expect(snapshot.schema).toBe('islemind.conversation-snapshot.v3')
      expect(hasConversationModelPreference(snapshot)).toBe(true)
      expect(snapshot.messages[0].text).toBe('Historical output')
    }
    expect(parseConversationSnapshot({ ...conversation, schema: 'islemind.conversation-snapshot.v99' })).toBeUndefined()
    expect(parseConversationSnapshot({ ...conversation, model: 42 })).toBeUndefined()
  })
})
