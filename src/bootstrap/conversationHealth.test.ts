import { resolveConversationHealth } from '@/components/chat/conversationHealth'
import type { AIProvider } from '@/types/providerContracts'
import type { Conversation } from '@/types/chatContracts'
import type { TFunction } from 'i18next'

jest.mock('@/types/providerBaseUrls', () => ({ getProviderConfigIssue: () => null }))
jest.mock('@/bootstrap/providerModelAccess', () => ({ resolveProviderModelAliasAccess: () => ({ allowed: true }) }))
jest.mock('@/components/chat/chatModelSelection', () => ({ providerHasSpecificPolicyModel: () => true }))

const provider: AIProvider = { id: 'p', type: 'openai', name: 'Test', enabled: true, apiKey: 'synthetic',
  models: ['gpt-4o-mini', 'gpt-5.2'], lastTestStatus: 'bad', lastTestModel: 'gpt-5.2', lastTestCode: 'model_unavailable' }
const conversation = { id: 'c', providerId: 'p', model: 'gpt-4o-mini', providerModelMode: 'manual' } as Conversation
const t = ((key: string) => key) as TFunction

it('does not project another model’s failed test onto the selected model', async () => {
  await expect(resolveConversationHealth(conversation, [provider], async () => provider, t)).resolves.toMatchObject({ code: null })
})
it('preserves a failure for the selected model, including aliases', async () => {
  const selected: AIProvider = { ...provider, modelAliases: [{ alias: 'small', model: 'gpt-4o-mini' }], lastTestModel: 'small' }
  await expect(resolveConversationHealth(conversation, [selected], async () => selected, t)).resolves.toMatchObject({ code: 'model_unavailable' })
})
it('does not fabricate model-unavailable evidence from an unclassified failed test', async () => {
  const selected = { ...provider, lastTestModel: undefined, lastTestCode: undefined }
  await expect(resolveConversationHealth(conversation, [selected], async () => selected, t)).resolves.toMatchObject({ code: 'unknown' })
})
