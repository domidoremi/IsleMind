import { act, renderHook } from '@testing-library/react-native'
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import { useSourceReaderPosition, useSourceReadingSession } from './useSourceReadingSession'

const layout = (height = 400) => ({ nativeEvent: { layout: { width: 320, height, x: 0, y: 0 } } }) as LayoutChangeEvent
const event = (y: number) => ({ nativeEvent: {
  contentOffset: { x: 0, y }, contentSize: { width: 320, height: 2000 }, layoutMeasurement: { width: 320, height: 400 },
} }) as NativeSyntheticEvent<NativeScrollEvent>
type Props = { identity: string; revision: string; ready: boolean }

it('keeps independent source positions, rejects late scrolls, and restores only after a read is ready', async () => {
  const move = jest.fn()
  const view = await renderHook(({ identity, revision, ready }: Props) => {
    const { session, chrome } = useSourceReadingSession(identity)
    return { chrome, ...useSourceReaderPosition(session, revision, ready, move) }
  }, { initialProps: { identity: 'source-a', revision: 'saved-1', ready: true } })
  const measure = async () => act(() => {
    view.result.current.onLayout(layout())
    view.result.current.onContentSizeChange(320, 2000)
  })
  await measure()
  await act(() => view.result.current.onScroll(event(600)))
  expect(view.result.current.chrome.progress).toBe(0.38)
  const oldScroll = view.result.current.onScroll
  move.mockClear()
  await view.rerender({ identity: 'source-b', revision: 'saved-1', ready: false })
  await act(() => {
    view.result.current.onLayout(layout())
    view.result.current.onContentSizeChange(320, 120)
  })
  await act(() => oldScroll(event(1000)))
  expect(move).not.toHaveBeenCalled()
  expect(view.result.current.chrome.progress).toBe(0)
  await view.rerender({ identity: 'source-b', revision: 'saved-1', ready: true })
  await measure()
  expect(move).toHaveBeenLastCalledWith(0)
  await act(() => view.result.current.onScroll(event(120)))
  await view.rerender({ identity: 'source-a', revision: 'saved-1', ready: true })
  await measure()
  expect(move).toHaveBeenLastCalledWith(600)
  expect(view.result.current.chrome.progress).toBe(0.38)
  await view.rerender({ identity: 'source-b', revision: 'saved-1', ready: true })
  await measure()
  expect(move).toHaveBeenLastCalledWith(120)
})

it('starts a changed saved revision at the beginning and keeps the prior revision position separate', async () => {
  const move = jest.fn()
  const view = await renderHook(({ revision }: { revision: string }) => {
    const { session } = useSourceReadingSession('citation')
    return useSourceReaderPosition(session, revision, true, move)
  }, { initialProps: { revision: 'v1-cited' } })
  const measure = async (content = 2000) => act(() => {
    view.result.current.onLayout(layout())
    view.result.current.onContentSizeChange(320, content)
  })
  await measure()
  await act(() => view.result.current.onScroll(event(900)))
  await view.rerender({ revision: 'v2-cited' })
  await measure()
  expect(move).toHaveBeenLastCalledWith(0)
  await view.rerender({ revision: 'v1-cited' })
  await measure()
  expect(move).toHaveBeenLastCalledWith(900)
  // A narrower reading area or fewer visible sections cannot scroll beyond the content.
  await view.rerender({ revision: 'v2-cited' })
  await measure()
  await view.rerender({ revision: 'v1-cited' })
  await measure(650)
  expect(move).toHaveBeenLastCalledWith(250)
})

it('ignores zero viewport scroll events from a hidden stack route', async () => {
  const move = jest.fn()
  const view = await renderHook(({ revision }: { revision: string }) => {
    const { session } = useSourceReadingSession('citation')
    return useSourceReaderPosition(session, revision, true, move)
  }, { initialProps: { revision: 'saved' } })
  await act(() => {
    view.result.current.onLayout(layout())
    view.result.current.onContentSizeChange(320, 2000)
    view.result.current.onScroll(event(600))
  })
  const hidden = event(0)
  hidden.nativeEvent.layoutMeasurement.height = 0
  await act(() => view.result.current.onScroll(hidden))
  await view.rerender({ revision: 'another' })
  await view.rerender({ revision: 'saved' })
  await act(() => {
    view.result.current.onLayout(layout())
    view.result.current.onContentSizeChange(320, 2000)
  })
  expect(move).toHaveBeenLastCalledWith(600)
})
