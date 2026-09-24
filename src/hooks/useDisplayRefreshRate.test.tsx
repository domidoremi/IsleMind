import { render, act } from '@testing-library/react-native'
import { NativeModules, Platform } from 'react-native'
import { useDisplayRefreshRate } from './useDisplayRefreshRate'

const setHighRefreshRate = jest.fn()
function Animation({ active = true }: { active?: boolean }) {
  useDisplayRefreshRate(active)
  return null
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.replaceProperty(Platform, 'OS', 'android')
  NativeModules.AndroidDisplayRefresh = { setHighRefreshRate }
  setHighRefreshRate.mockClear()
})
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
  delete NativeModules.AndroidDisplayRefresh
})

it('requests once for overlapping animations and releases after the last owner', async () => {
  const first = await render(<Animation />)
  const second = await render(<Animation />)
  expect(setHighRefreshRate.mock.calls).toEqual([[true]])
  await first.unmount()
  await act(() => jest.advanceTimersByTime(200))
  expect(setHighRefreshRate.mock.calls).toEqual([[true]])
  await second.unmount()
  await act(() => jest.advanceTimersByTime(100))
  expect(setHighRefreshRate.mock.calls).toEqual([[true], [false]])
})

it('keeps the hint through a route handover but releases for static motion', async () => {
  const first = await render(<Animation />)
  await first.unmount()
  await act(() => jest.advanceTimersByTime(50))
  const next = await render(<Animation />)
  await act(() => jest.advanceTimersByTime(100))
  expect(setHighRefreshRate.mock.calls).toEqual([[true]])
  await next.rerender(<Animation active={false} />)
  await act(() => jest.advanceTimersByTime(100))
  expect(setHighRefreshRate.mock.calls).toEqual([[true], [false]])
  await next.unmount()
})

it('does not request a rate for still content or unavailable native modules', async () => {
  const still = await render(<Animation active={false} />)
  delete NativeModules.AndroidDisplayRefresh
  const oldBinary = await render(<Animation />)
  expect(setHighRefreshRate).not.toHaveBeenCalled()
  await still.unmount()
  await oldBinary.unmount()
})

it.each(['web', 'ios'] as const)('does not invoke Android on %s', async platform => {
  jest.replaceProperty(Platform, 'OS', platform)
  const screen = await render(<Animation />)
  expect(setHighRefreshRate).not.toHaveBeenCalled()
  await screen.unmount()
})
