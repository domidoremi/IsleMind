import { projectReplyFallback, type ReplyPreferenceSnapshot } from './chatReplyFallback'
import type { Conversation, Message } from '@/types/chatContracts'
import { PROVIDER_PROTOCOL_ADAPTER_IDS } from '@/types/providerContracts'

const snapshot: ReplyPreferenceSnapshot = { conversationId: 'c', responseMessageId: 'reply', userMessageId: 'user', providerId: 'a', model: 'A' }
const reply = { id: 'reply', role: 'assistant', status: 'streaming', providerId: 'b', model: 'B', generationProtocol: { schema: 'islemind.message-protocol.v1', adapterId: PROVIDER_PROTOCOL_ADAPTER_IDS[0] } } as Message
const conversation = { id: 'c', providerId: 'a', model: 'A', messages: [{ id: 'user', role: 'user' }, reply] } as Conversation

it('shows temporary fallback only for the captured turn and actual producing attribution', () => {
  expect(projectReplyFallback(snapshot, conversation, [])?.actual).toEqual({ providerId: 'b', model: 'B' })
  expect(projectReplyFallback(undefined, conversation, [])).toBeUndefined()
  expect(projectReplyFallback(snapshot, { ...conversation, messages: [{ ...reply, generationProtocol: undefined }] }, [])).toBeUndefined()
})

it('does not mislabel historical A → B → C selection changes or a new turn as fallback', () => {
  expect(projectReplyFallback(snapshot, { ...conversation, providerId: 'c', model: 'C' }, [])).toBeUndefined()
  expect(projectReplyFallback(snapshot, { ...conversation, messages: [...conversation.messages, { id: 'next', role: 'user' } as Message] }, [])).toBeUndefined()
})
