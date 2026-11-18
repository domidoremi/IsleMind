import { act, renderHook } from '@testing-library/react-native'
import { Platform, type View } from 'react-native'
import { useModelMenuWebViewport } from './modelMenuWebViewport'

const rect = (x: number, y: number, width: number, height: number) =>
  ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height })

it('measures the current modal and button on open and follows a resized or panned visual viewport', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'web')
  const visual = Object.assign(new EventTarget(), { width: 900, height: 420, offsetLeft: 0, offsetTop: 0, scale: 1 })
  const browser = new EventTarget()
  const properties = {
    visualViewport: visual, addEventListener: browser.addEventListener.bind(browser), removeEventListener: browser.removeEventListener.bind(browser),
  }
  const originals = Object.getOwnPropertyDescriptors(window)
  for (const [name, value] of Object.entries(properties)) Object.defineProperty(window, name, { configurable: true, value })
  let host = rect(0, 0, 900, 420), trigger = rect(192, 342, 44, 44)
  const root = { current: { getBoundingClientRect: jest.fn(() => host) } }
  const button = { current: { getBoundingClientRect: () => trigger } }
  const stale = { x: 40, y: 450, width: 44, height: 44 }
  try {
    const hook = await renderHook(({ visible }: { visible: boolean }) => useModelMenuWebViewport(visible,
      root as unknown as { current: View }, button as unknown as { current: View }, stale),
    { initialProps: { visible: false } })
    expect(root.current.getBoundingClientRect).not.toHaveBeenCalled()
    await hook.rerender({ visible: true })
    expect(hook.result.current).toMatchObject({ width: 900, height: 420, anchor: { x: 192, y: 342 } })
    Object.assign(visual, { width: 450, height: 210, scale: 2, offsetLeft: 90, offsetTop: 30 })
    await act(() => visual.dispatchEvent(new Event('resize')))
    expect(hook.result.current).toMatchObject({ visibleHeight: 210, obscured: { left: 90, right: 360, top: 30, bottom: 180 } })
    visual.offsetTop = 90
    await act(() => visual.dispatchEvent(new Event('scroll')))
    expect(hook.result.current?.obscured).toMatchObject({ top: 90, bottom: 120 })
    visual.height = 160
    const reads = root.current.getBoundingClientRect.mock.calls.length
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 550)))
    expect(hook.result.current?.obscured.bottom).toBe(170)
    expect(root.current.getBoundingClientRect.mock.calls.length).toBe(reads + 1)
    await hook.rerender({ visible: false })
    root.current.getBoundingClientRect.mockClear()
    await act(() => browser.dispatchEvent(new Event('resize')))
    expect(root.current.getBoundingClientRect).not.toHaveBeenCalled()
    host = rect(10, 5, 600, 300)
    trigger = rect(200, 202, 44, 44)
    await hook.rerender({ visible: true })
    expect(hook.result.current).toMatchObject({ width: 600, height: 300, anchor: { x: 190, y: 197 } })
    await hook.unmount()
  } finally {
    for (const name of Object.keys(properties)) {
      const descriptor = originals[name]
      if (descriptor) Object.defineProperty(window, name, descriptor)
      else Reflect.deleteProperty(window, name)
    }
    platform.restore()
  }
})
