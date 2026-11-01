import { act, renderHook } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'
import { useActionFeedback } from './useActionFeedback'

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks() })

it.each(['success', 'false', 'reject', 'throw'] as const)('reports only a verified %s result', async result => {
  const hook = await renderHook(() => useActionFeedback('source'))
  await act(async () => {
    const success = await hook.result.current.run(() => {
      if (result === 'throw') throw new Error('clipboard')
      return result === 'reject' ? Promise.reject(new Error('clipboard')) : Promise.resolve(result !== 'false')
    })
    expect(success).toBe(result === 'success')
  })
  expect(hook.result.current.phase).toBe(result === 'success' ? 'success' : 'error')
})

it('ignores an old result after content identity changes and allows the new action', async () => {
  let finish: (value: boolean) => void = () => undefined
  const first = new Promise<boolean>(resolve => { finish = resolve })
  const hook = await renderHook<ReturnType<typeof useActionFeedback>, { id: string }>(({ id }) => useActionFeedback(id), { initialProps: { id: 'first' } })
  let action: Promise<boolean> = Promise.resolve(false)
  await act(() => { action = hook.result.current.run(() => first) })
  expect(hook.result.current.phase).toBe('pending')
  await hook.rerender({ id: 'second' })
  await act(() => hook.result.current.run(async () => true))
  await act(async () => { finish(false); await action })
  expect(hook.result.current.phase).toBe('success')
})

it('locks duplicate presses but preserves an in-flight action on ordinary rerenders', async () => {
  let finish: (value: boolean) => void = () => undefined
  const promise = new Promise<boolean>(resolve => { finish = resolve })
  const operation = jest.fn(() => promise)
  const hook = await renderHook(() => useActionFeedback('same-source'))
  let action: Promise<boolean> = Promise.resolve(false)
  await act(() => { action = hook.result.current.run(operation) })
  await hook.rerender(undefined)
  await act(() => hook.result.current.run(operation))
  expect(operation).toHaveBeenCalledTimes(1)
  await act(async () => { finish(true); await action })
  expect(hook.result.current.phase).toBe('success')
})

it('honors the accessible timeout and does not time out errors', async () => {
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis').mockResolvedValue(6000)
  const hook = await renderHook(() => useActionFeedback('source', 2600))
  await act(() => hook.result.current.run(async () => true))
  await act(() => jest.advanceTimersByTime(3000))
  expect(hook.result.current.phase).toBe('success')
  await act(() => jest.advanceTimersByTime(3000))
  expect(hook.result.current.phase).toBe('idle')
  await act(() => hook.result.current.run(async () => false))
  await act(() => jest.advanceTimersByTime(12000))
  expect(hook.result.current.phase).toBe('error')
})

it('does not let a previous asynchronous timeout clear a newer receipt', async () => {
  let timeout: (value: number) => void = () => undefined
  jest.spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis')
    .mockImplementationOnce(() => new Promise(resolve => { timeout = resolve }))
    .mockResolvedValue(2600)
  const hook = await renderHook(() => useActionFeedback('source'))
  await act(() => hook.result.current.run(async () => true))
  await act(() => hook.result.current.run(async () => false))
  await act(() => { timeout(1) })
  await act(() => jest.runOnlyPendingTimers())
  expect(hook.result.current.phase).toBe('error')
  await hook.unmount()
})
