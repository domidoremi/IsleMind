import type { Conversation } from '@/types/chatContracts'
import type { Settings } from '@/types/settingsContracts'
import { ProviderConfigurationConflictError } from './providerConfigurationMutation'
import { createProviderConversationAdmissionRuntime } from './providerConversationAdmissionRuntime'

function fixture() {
  let rejectExecution!: (error: unknown) => void
  const pendingExecution = new Promise<never>((_resolve, reject) => { rejectExecution = reject })
  const controller = new AbortController()
  const resolveExecution = jest.fn(() => pendingExecution)
  const hydrateProviderKey = jest.fn(async () => null)
  const resolveGenerationRequest = jest.fn(() => ({ temperature: 0, maxTokens: 8 }))
  const runtime = createProviderConversationAdmissionRuntime({
    resolveExecution,
    providerHasModel: () => true,
    hydrateProviderKey,
    getProviderConfigIssue: () => null,
    resolveProviderModelAlias: (_provider, model) => model,
    getModelConfig: () => ({}),
    resolveGenerationRequest,
  })
  const input = {
    conversation: { id: 'owned-conflict-conversation', providerId: 'owned-preferred', model: 'same-model',
      title: 'Owned conflict', systemPrompt: '', temperature: 0, maxTokens: 8,
      messages: [], createdAt: 1, updatedAt: 1 } as Conversation,
    providers: [],
    settings: {} as Settings,
    signal: controller.signal,
  }
  return { runtime, input, controller, rejectExecution, resolveExecution, hydrateProviderKey, resolveGenerationRequest }
}

it('settles a configuration conflict during execution selection as a changed candidate', async () => {
  const f = fixture()
  const result = f.runtime.admitConversation(f.input)
  f.rejectExecution(new ProviderConfigurationConflictError())
  await expect(result).resolves.toMatchObject({
    kind: 'rejected', reason: 'candidate_changed', code: 'unknown', providerId: 'owned-preferred',
  })
  expect(f.resolveExecution).toHaveBeenCalledTimes(1)
  expect(f.hydrateProviderKey).not.toHaveBeenCalled()
  expect(f.resolveGenerationRequest).not.toHaveBeenCalled()
})

it('keeps the captured preference and cancellation owner when the caller changes its input', async () => {
  const f = fixture()
  const result = f.runtime.admitConversation(f.input)
  const replacement = new AbortController()
  f.input.signal = replacement.signal
  f.input.conversation.providerId = 'owned-later-preference'
  replacement.abort()
  f.rejectExecution(new ProviderConfigurationConflictError())
  await expect(result).resolves.toMatchObject({
    kind: 'rejected', reason: 'candidate_changed', providerId: 'owned-preferred',
  })
  expect(f.controller.signal.aborted).toBe(false)
})

it('preserves original cancellation when a configuration read later conflicts', async () => {
  const f = fixture()
  const result = f.runtime.admitConversation(f.input)
  f.controller.abort()
  f.rejectExecution(new ProviderConfigurationConflictError())
  await expect(result).resolves.toEqual({ kind: 'cancelled' })
  expect(f.hydrateProviderKey).not.toHaveBeenCalled()
  expect(f.resolveGenerationRequest).not.toHaveBeenCalled()
})

it.each([
  new Error('owned-unrelated-read-failure'),
  Object.assign(new Error('owned-same-name'), { name: 'ProviderConfigurationConflictError' }),
])('propagates unrelated execution selection failures: %s', async error => {
  const f = fixture()
  const result = f.runtime.admitConversation(f.input)
  f.rejectExecution(error)
  await expect(result).rejects.toBe(error)
  expect(f.hydrateProviderKey).not.toHaveBeenCalled()
  expect(f.resolveGenerationRequest).not.toHaveBeenCalled()
})
