import type { AIProvider } from '@/types/providerContracts'
import { resolveMessageProviderIdentity } from './messageProviderIdentity'

const provider = (id: string): AIProvider => ({ id, name: id } as AIProvider)

describe('message provider identity', () => {
  it('prefers the identity captured by an assistant message over the current conversation model', () => {
    const historicalProvider = provider('provider-history')
    const currentProvider = provider('provider-current')

    expect(resolveMessageProviderIdentity({
      message: { providerId: historicalProvider.id, model: 'history-model' },
      conversationProvider: currentProvider,
      conversationModel: 'current-model',
      providers: [historicalProvider, currentProvider],
    })).toEqual({ provider: historicalProvider, model: 'history-model' })
  })

  it('keeps missing historical attribution unknown instead of substituting the current preference', () => {
    const currentProvider = provider('provider-current')

    expect(resolveMessageProviderIdentity({
      message: {},
      conversationProvider: currentProvider,
      conversationModel: 'current-model',
      providers: [currentProvider],
    })).toEqual({ provider: undefined, model: '' })
  })
})
