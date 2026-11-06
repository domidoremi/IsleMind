import type { Conversation } from '@/types/chatContracts'
import { normalizeConversationContextPolicy, conversationContextPolicyRevision } from '../domain/conversationContextPolicy'
import { createConversationContextPolicyCommand, resolveConversationContextSettings } from './conversationContextPolicy'
import { parseConversationSnapshot } from '../domain/conversationSnapshot'
import { createConversationBranchDraft } from './conversationBranch'
import { normalizeMessageUsageExecution, linkMessageUsageRequest } from './messageUsageExecution'

const conversation: Conversation = {
  id: 'conversation', title: 'Conversation', providerId: 'provider', model: 'model', systemPrompt: '',
  temperature: 1, maxTokens: 1000, createdAt: 1, updatedAt: 1,
  messages: [{ id: 'reply', role: 'assistant', content: 'Answer', timestamp: 1, status: 'done',
    usage: { source: 'provider', totalTokens: 12 },
    usageExecution: { schema: 'islemind.message-usage-reference.v1', responseExecutionId: 'response-a', requestIds: ['call-a'] } }],
}
const override = { schema: 'islemind.conversation-context-policy.v1' as const, remoteCompactThreshold: 0.65 }

it('applies only the conversation threshold and retains global network/summary opt-ins', () => {
  const settings = { remoteCompactThreshold: 0.8, remoteCompactMode: 'off', modelContextCompressionEnabled: false }
  expect(resolveConversationContextSettings(settings, undefined)).toBe(settings)
  expect(resolveConversationContextSettings(settings, { contextPolicyOverride: override }))
    .toEqual({ ...settings, remoteCompactThreshold: 0.65 })
  expect(settings.remoteCompactThreshold).toBe(0.8)
  expect(resolveConversationContextSettings(settings, { contextPolicyOverride: undefined })).toBe(settings)
})

it('waits for persistence before publishing, then restores inheritance with the same save boundary', async () => {
  let current = conversation
  let finish!: () => void
  let started!: () => void
  const persisted = new Promise<void>(resolve => { started = resolve })
  const publish = jest.fn((value: Conversation) => { current = value })
  const release = jest.fn()
  const persist = jest.fn().mockImplementationOnce(() => { started(); return new Promise<void>(resolve => { finish = resolve }) }).mockResolvedValue(undefined)
  const save = createConversationContextPolicyCommand({
    readConversation: () => current, isBusy: () => false, isDraft: () => false,
    acquireLock: () => release, persist, publish, now: () => 5,
  })
  const pending = save(current.id, override, conversationContextPolicyRevision(current))
  await persisted
  expect(publish).not.toHaveBeenCalled()
  expect(release).not.toHaveBeenCalled()
  finish()
  await expect(pending).resolves.toMatchObject({ persisted: true, conversation: { contextPolicyOverride: override } })
  expect(release).toHaveBeenCalledTimes(1)
  await save(current.id, undefined, conversationContextPolicyRevision(current))
  expect(current.contextPolicyOverride).toBeUndefined()
  expect(persist).toHaveBeenCalledTimes(2)
})

it('retains the saved conversation and releases its lock after a failed write', async () => {
  const publish = jest.fn()
  const release = jest.fn()
  const save = createConversationContextPolicyCommand({
    readConversation: () => conversation, isBusy: () => false, isDraft: () => false,
    acquireLock: () => release, persist: async () => { throw new Error('disk full') }, publish, now: () => 5,
  })
  await expect(save(conversation.id, override, conversationContextPolicyRevision(conversation))).rejects.toThrow('disk full')
  expect(publish).not.toHaveBeenCalled()
  expect(release).toHaveBeenCalledTimes(1)
  expect(conversation.contextPolicyOverride).toBeUndefined()
})

it('rejects a changed model or policy revision and an active conversation before writing', async () => {
  const persist = jest.fn()
  const read = jest.fn().mockReturnValue(conversation)
  const busy = jest.fn().mockReturnValue(false)
  const save = createConversationContextPolicyCommand({
    readConversation: read, isBusy: busy, isDraft: () => false,
    acquireLock: () => () => undefined, persist, publish: jest.fn(), now: () => 5,
  })
  await expect(save(conversation.id, override, 'older')).rejects.toThrow('conversation_context_policy_conflict')
  busy.mockReturnValueOnce(true)
  await expect(save(conversation.id, override, conversationContextPolicyRevision(conversation))).rejects.toThrow('conversation_context_policy_busy')
  read.mockReturnValueOnce(conversation).mockReturnValueOnce({ ...conversation, model: 'changed' })
  await expect(save(conversation.id, override, conversationContextPolicyRevision(conversation))).rejects.toThrow('conversation_context_policy_conflict')
  expect(persist).not.toHaveBeenCalled()
})

it('keeps an unsent draft local until its existing send barrier saves the conversation', async () => {
  const persist = jest.fn()
  const publish = jest.fn()
  const save = createConversationContextPolicyCommand({
    readConversation: () => conversation, isBusy: () => false, isDraft: () => true,
    acquireLock: () => () => undefined, persist, publish, now: () => 5,
  })
  await expect(save(conversation.id, override, conversationContextPolicyRevision(conversation))).resolves.toMatchObject({ persisted: false })
  expect(persist).not.toHaveBeenCalled()
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ contextPolicyOverride: override }))
})

it('preserves the versioned policy in conversation snapshots and rejects invalid imported policies', () => {
  expect(parseConversationSnapshot({ ...conversation, contextPolicyOverride: override })).toMatchObject({ contextPolicyOverride: override })
  for (const value of [
    { ...override, remoteCompactThreshold: NaN }, { ...override, remoteCompactThreshold: 0 },
    { ...override, remoteCompactThreshold: 2.1 }, { ...override, credentials: 'unexpected' },
  ]) {
    expect(normalizeConversationContextPolicy(value)).toBeUndefined()
    expect(parseConversationSnapshot({ ...conversation, contextPolicyOverride: value })).toBeUndefined()
  }
})

it('copies AI policy into a new branch without copying execution references or counting the old response again', () => {
  const branch = createConversationBranchDraft({ ...conversation, contextPolicyOverride: override }, 'reply', { id: 'branch', title: 'Branch', now: 2 })
  expect(branch?.contextPolicyOverride).toEqual(override)
  expect(branch?.contextPolicyOverride).not.toBe(override)
  expect(branch?.messages[0].usageExecution).toBeUndefined()
  expect(branch?.messages[0].usage).toBeUndefined()
  expect(conversation.messages[0].usageExecution?.responseExecutionId).toBe('response-a')
})

it('links bounded calls without guessing identities or reassigning a response', () => {
  const linked = linkMessageUsageRequest(conversation.messages[0].usageExecution, 'response-a', 'call-b')!
  expect(linked.requestIds).toEqual(['call-a', 'call-b'])
  expect(linkMessageUsageRequest(linked, 'response-a', 'call-b')?.requestIds).toEqual(['call-a', 'call-b'])
  expect(linkMessageUsageRequest(linked, 'other-response', 'call-c')).toBeUndefined()
  expect(normalizeMessageUsageExecution({ ...linked, requestIds: ['call-a', 'call-a'] })).toBeUndefined()
  expect(normalizeMessageUsageExecution({ ...linked, requestIds: ['secret\n'] })).toBeUndefined()
  expect(normalizeMessageUsageExecution({ ...linked, requestIds: Array.from({ length: 129 }, (_, index) => `call-${index}`) })).toBeUndefined()
})
