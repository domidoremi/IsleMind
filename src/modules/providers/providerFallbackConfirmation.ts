import type { ProviderFailoverRoute } from './providerFailoverPolicy'

export interface ProviderFallbackConfirmationRequest {
  conversationId: string
  preferred: { providerId: string; model: string }
  candidate: ProviderFailoverRoute
  signal: AbortSignal
}

type ConfirmationHandler = (request: ProviderFallbackConfirmationRequest) => Promise<boolean>
interface ConfirmationBinding {
  handler: ConfirmationHandler
  cancelPending: Set<() => void>
}
const handlers = new Map<string, ConfirmationBinding>()

/** Presentation binding only; neither approvals nor candidates survive a pending request. */
export function bindProviderFallbackConfirmation(conversationId: string, handler: ConfirmationHandler): () => void {
  const previous = handlers.get(conversationId)
  const binding = { handler, cancelPending: new Set<() => void>() }
  handlers.set(conversationId, binding)
  previous?.cancelPending.forEach((cancel) => cancel())
  return () => {
    if (handlers.get(conversationId) === binding) handlers.delete(conversationId)
    binding.cancelPending.forEach((cancel) => cancel())
  }
}

export async function requestProviderFallbackConfirmation(request: ProviderFallbackConfirmationRequest): Promise<boolean> {
  const binding = handlers.get(request.conversationId)
  if (!binding || request.signal.aborted) return false
  return new Promise<boolean>((resolve) => {
    const controller = new AbortController()
    const abort = () => finish(false)
    let settled = false
    const finish = (accepted: boolean) => {
      if (settled) return
      settled = true
      request.signal.removeEventListener('abort', abort)
      binding.cancelPending.delete(abort)
      controller.abort()
      resolve(accepted && !request.signal.aborted && handlers.get(request.conversationId) === binding)
    }
    binding.cancelPending.add(abort)
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) finish(false)
    else void Promise.resolve().then(() => settled ? false : binding.handler({ ...request, signal: controller.signal }))
      .then(finish, () => finish(false))
  })
}
