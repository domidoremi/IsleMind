import { act, renderHook, waitFor } from '@testing-library/react-native'
import type { TFunction } from 'i18next'

import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import { resolveConversationHealth, type ConversationHealth } from './conversationHealth'
import { useChatWorkspaceProviderHealthState } from './chatWorkspaceProviderHealthState'

jest.mock('./conversationHealth', () => ({ resolveConversationHealth: jest.fn() }))
jest.mock('./chatModelSelection', () => ({ MODEL_QUICK_OPTION_PROVIDER_LIMIT: 24, getPolicyAllowedProviderModels: () => ['shared'] }))

const resolveHealth = jest.mocked(resolveConversationHealth)
const good: ConversationHealth = { code: null, title: '', description: '', inheritedExpired: false, providerId: 'a' }
const bad: ConversationHealth = { ...good, code: 'disabled_provider', providerId: 'b' }
const providers: AIProvider[] = [
  { id: 'b', type: 'openai', name: 'B', enabled: false, apiKey: '', models: ['shared'] },
  { id: 'a', type: 'openai', name: 'A', enabled: true, apiKey: '', models: ['shared'] },
]
const conversation = { id: 'owned-hook-chat', providerId: 'b', model: 'shared', providerModelMode: 'manual',
  routingPlan: { schema: 'islemind.model-routing-plan.v1', id: 'owned-hook-plan', name: 'Owned hook plan',
    mode: 'fallback', primary: { providerId: 'b', model: 'shared' }, crossProvider: 'ask',
    backup: { providerId: 'a', model: 'shared' } },
} as Conversation
const options = { active: true, conversationId: conversation.id, runtimeConversation: conversation,
  providers, provider: providers[0], hydrateProviderKey: async () => null, modelAccessSettings: {}, t: ((key: string) => key) as TFunction }

beforeEach(() => { resolveHealth.mockReset() })

it('refreshes health when the conversation routing plan changes without changing the selected provider or model', async () => {
  resolveHealth.mockResolvedValueOnce(good).mockResolvedValueOnce(bad)
  const { result, rerender } = await renderHook((props: Parameters<typeof useChatWorkspaceProviderHealthState>[0]) => useChatWorkspaceProviderHealthState(props), { initialProps: options })
  await waitFor(() => expect(result.current.providerHealth).toEqual(good))
  await rerender({ ...options, runtimeConversation: { ...conversation,
    routingPlan: { ...conversation.routingPlan!, mode: 'fixed', backup: undefined } } })
  await waitFor(() => expect(result.current.providerHealth).toEqual(bad))
  expect(resolveHealth).toHaveBeenCalledTimes(2)
})

it('ignores a delayed result from a replaced routing plan', async () => {
  let completeOld!: (value: ConversationHealth) => void
  resolveHealth.mockImplementationOnce(() => new Promise(resolve => { completeOld = resolve })).mockResolvedValueOnce(bad)
  const { result, rerender } = await renderHook((props: Parameters<typeof useChatWorkspaceProviderHealthState>[0]) => useChatWorkspaceProviderHealthState(props), { initialProps: options })
  await rerender({ ...options, runtimeConversation: { ...conversation, routingPlan: { ...conversation.routingPlan!, mode: 'fixed', backup: undefined } } })
  await waitFor(() => expect(result.current.providerHealth).toEqual(bad))
  await act(async () => { completeOld(good) })
  expect(result.current.providerHealth).toEqual(bad)
})

it('rechecks when another provider is disabled', async () => {
  resolveHealth.mockResolvedValueOnce(good).mockResolvedValueOnce(bad)
  const { result, rerender } = await renderHook((props: Parameters<typeof useChatWorkspaceProviderHealthState>[0]) => useChatWorkspaceProviderHealthState(props), { initialProps: options })
  await waitFor(() => expect(result.current.providerHealth).toEqual(good))
  await rerender({ ...options, providers: [providers[0], { ...providers[1], enabled: false }] })
  await waitFor(() => expect(result.current.providerHealth).toEqual(bad))
})
