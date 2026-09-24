import { act, fireEvent, render } from '@testing-library/react-native'
import { PanResponder } from 'react-native'
import { SettingsValueSlider } from './SettingsValueSlider'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
afterEach(() => jest.restoreAllMocks())
it('previews many movements locally and commits exactly once on release', async () => {
  const capture = jest.spyOn(PanResponder, 'create')
  const commit = jest.fn()
  const screen = await render(<SettingsValueSlider label="Temperature" value={1} min={0} max={2} step={0.1} onCommit={commit} />)
  const callbacks = capture.mock.calls[0][0]
  await fireEvent(screen.getByLabelText('Temperature'), 'layout', { nativeEvent: { layout: { width: 200 } } })
  await act(() => {
    callbacks.onPanResponderGrant?.({ nativeEvent: { pageX: 100, locationX: 100 } } as any, {} as any)
    for (let pageX = 105; pageX <= 150; pageX += 5) callbacks.onPanResponderMove?.({ nativeEvent: { pageX } } as any, {} as any)
  })
  expect(commit).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Temperature').props.accessibilityValue.now).toBe(1.5)
  await act(() => callbacks.onPanResponderRelease?.({} as any, {} as any))
  expect(commit).toHaveBeenCalledTimes(1)
  expect(commit).toHaveBeenCalledWith(1.5)
})
it('cancels an interrupted gesture and supports accessible adjustment', async () => {
  const capture = jest.spyOn(PanResponder, 'create')
  const commit = jest.fn()
  const screen = await render(<SettingsValueSlider label="Temperature" value={1} min={0} max={2} step={0.1} onCommit={commit} />)
  const callbacks = capture.mock.calls[0][0]
  await act(() => {
    callbacks.onPanResponderGrant?.({ nativeEvent: { pageX: 0, locationX: 0 } } as any, {} as any)
    callbacks.onPanResponderTerminate?.({} as any, {} as any)
  })
  expect(commit).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Temperature').props.accessibilityValue.now).toBe(1)
  await fireEvent(screen.getByLabelText('Temperature'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
  expect(commit).toHaveBeenCalledWith(1.1)
})
