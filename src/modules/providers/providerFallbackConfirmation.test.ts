import { bindProviderFallbackConfirmation, requestProviderFallbackConfirmation } from './providerFallbackConfirmation'

describe('request-local cross-provider confirmation', () => {
  const candidate = { providerId: 'other', model: 'model' }
  const request = (signal = new AbortController().signal) => ({ conversationId: 'pending-chat',
    preferred: { providerId: 'preferred', model: 'original' }, candidate, signal })

  it('requires a mounted handler and does not persist an earlier approval', async () => {
    expect(await requestProviderFallbackConfirmation(request())).toBe(false)
    let calls = 0
    const unbind = bindProviderFallbackConfirmation('pending-chat', async () => ++calls === 1)
    try {
      expect(await requestProviderFallbackConfirmation(request())).toBe(true)
      expect(await requestProviderFallbackConfirmation(request())).toBe(false)
      expect(calls).toBe(2)
    } finally { unbind() }
  })

  it('settles a pending confirmation on unmount and aborts the presentation request', async () => {
    let signal: AbortSignal | undefined
    const unbind = bindProviderFallbackConfirmation('pending-chat', (input) => {
      signal = input.signal
      return new Promise(() => {})
    })
    const pending = requestProviderFallbackConfirmation(request())
    await Promise.resolve()
    unbind()
    expect(await pending).toBe(false)
    expect(signal?.aborted).toBe(true)
  })

  it('cancels replaced handlers, parent cancellation, and late approvals', async () => {
    let accept: (value: boolean) => void = () => {}
    const old = bindProviderFallbackConfirmation('pending-chat', () => new Promise((resolve) => { accept = resolve }))
    const pending = requestProviderFallbackConfirmation(request())
    await Promise.resolve()
    const current = bindProviderFallbackConfirmation('pending-chat', async () => true)
    old()
    accept(true)
    expect(await pending).toBe(false)
    expect(await requestProviderFallbackConfirmation(request())).toBe(true)
    current()
    const controller = new AbortController()
    const cleanup = bindProviderFallbackConfirmation('pending-chat', () => new Promise(() => {}))
    const cancelled = requestProviderFallbackConfirmation(request(controller.signal))
    controller.abort()
    expect(await cancelled).toBe(false)
    cleanup()
  })
})
