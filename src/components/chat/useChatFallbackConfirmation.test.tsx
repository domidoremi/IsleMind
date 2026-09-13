import { act, render } from '@testing-library/react-native'
import { requestProviderFallbackConfirmation } from '@/modules/providers'
import { useChatFallbackConfirmation } from './useChatFallbackConfirmation'

jest.mock('@/modules/providers', () => jest.requireActual('@/modules/providers/providerFallbackConfirmation'))

it('binds only the visible conversation and cancels pending UI consent when it leaves', async () => {
  const confirm = jest.fn((input) => new Promise<boolean>((resolve) => input.signal.addEventListener('abort', () => resolve(false), { once: true })))
  const dialog = { confirm } as any
  const t = ((key: string) => key) as any
  function Harness({ active }: { active: boolean }) {
    useChatFallbackConfirmation({ active, conversationId: 'c', providers: [], dialog, t })
    return null
  }
  const view = await render(<Harness active />)
  const request = { conversationId: 'c', preferred: { providerId: 'a', model: 'A' }, candidate: { providerId: 'b', model: 'B' }, signal: new AbortController().signal }
  let result: Promise<boolean> | undefined
  await act(async () => { result = requestProviderFallbackConfirmation(request); await Promise.resolve() })
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'modelAvailability.confirmFallbackTitle' }))
  const uiSignal = confirm.mock.calls[0][0].signal as AbortSignal
  await view.rerender(<Harness active={false} />)
  expect(await result).toBe(false)
  expect(uiSignal.aborted).toBe(true)
  expect(await requestProviderFallbackConfirmation(request)).toBe(false)
  await view.unmount()
})
