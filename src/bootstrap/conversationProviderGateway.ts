import { createProviderGateway } from '@/modules/providers'
import { streamProviderChat } from '@/bootstrap/providerRuntime'

export const conversationProviderGateway = createProviderGateway([], {
  start(request, callbacks) {
    return streamProviderChat(
      request,
      callbacks.onChunk,
      callbacks.onDone,
      callbacks.onError,
      callbacks.onCitations,
      callbacks.onTrace,
    )
  },
})
