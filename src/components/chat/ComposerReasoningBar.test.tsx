import { act, fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { Animated } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useSettingsStore } from '@/store/settingsStore'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import { ComposerReasoningBar } from './ComposerReasoningBar'
import { resolveReasoningEffortEffect } from './composerReasoningEffects'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'reduced') }))
jest.mock('@/components/ui/isle', () => ({ ISLE_MIN_TOUCH_TARGET: 44 }))
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(() => Promise.resolve()) }))
jest.mock('@/store/settingsStore', () => ({
  useSettingsStore: jest.fn((selector: (state: { settings: { hapticsEnabled: boolean } }) => unknown) =>
    selector({ settings: { hapticsEnabled: true } })),
}))

const touch = (x: number) => ({ nativeEvent: { pageX: x + 100, locationX: x } })
const trackLayout = { nativeEvent: { layout: { width: 220, height: 44, x: 0, y: 0 } } }
const onExpand = jest.fn()
const setTheme = (themeId: CanonicalThemeId, dark = false) => {
  jest.mocked(useAppTheme).mockReturnValue({
    colors: getColors(dark ? 'dark' : 'light', themeId), isDark: dark, canonicalThemeId: themeId,
  } as ReturnType<typeof useAppTheme>)
}
beforeEach(() => {
  jest.clearAllMocks()
  setTheme('minimal')
})

it('expands the compact control on a tap without changing the current level', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['max', 'low', 'high']} value="low" compact onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(110))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(110))
  expect(onExpand).toHaveBeenCalledTimes(1)
  expect(onChange).not.toHaveBeenCalled()
  expect(view.getByTestId('chat-reasoning-compact')).toBeTruthy()
  expect(view.queryByTestId('chat-reasoning-track')).toBeNull()
  expect(view.queryAllByRole('button')).toHaveLength(0)
  expect(view.queryAllByRole('radio')).toHaveLength(0)

  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="max" compact onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(110))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(110))
  expect(onExpand).toHaveBeenCalledTimes(2)
  expect(onChange).not.toHaveBeenCalled()
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="max" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', { nativeEvent: { layout: { width: 340, height: 44, x: 0, y: 0 } } })
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(170))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(170))
  expect(onChange).toHaveBeenLastCalledWith('high')
  await view.unmount()
})

it('uses relative swipes in the compact control and commits only when the finger is released', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="low" compact onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(100))
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe('chat.reasoningEffort.low')
  await fireEvent(view.getByRole('adjustable'), 'responderMove', { nativeEvent: { pageX: 290, locationX: -999 } })
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe('chat.reasoningEffort.high')
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(190))
  expect(onChange).toHaveBeenLastCalledWith('high')
  expect(view.queryByTestId('chat-reasoning-track')).toBeNull()
  await view.unmount()
})

it('selects supported levels and model default directly on the enlarged inline track', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['max', 'low', 'high']} value="low" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(12))
  await fireEvent(view.getByRole('adjustable'), 'responderMove', { nativeEvent: { pageX: 230, locationX: -999 } })
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe('chat.reasoningEffort.high')
  expect(view.getByRole('adjustable').props.accessibilityValue.now).toBe(2)
  expect(view.queryByText('chat.reasoningEffort.medium')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(130))
  expect(onChange).toHaveBeenLastCalledWith('high')

  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="high" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(12))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(12))
  expect(onChange).toHaveBeenLastCalledWith(undefined)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(12))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(500))
  expect(onChange).toHaveBeenLastCalledWith('max')
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(-50))
  expect(onChange).toHaveBeenLastCalledWith(undefined)
  await view.unmount()
})

it('shows the supported level in the moving handle only while adjusting the enlarged control', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="low" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  expect(view.queryByTestId('chat-reasoning-feedback')).toBeNull()
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(130))
  expect(view.getByTestId('chat-reasoning-feedback-label').props.children).toBe('chat.reasoningEffort.high')
  expect(view.getByRole('adjustable').props.accessibilityValue.now).toBe(2)
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent(view.getByRole('adjustable'), 'responderMove', touch(145))
  expect(view.getByTestId('chat-reasoning-feedback-label').props.children).toBe('chat.reasoningEffort.high')
  expect(view.getByRole('adjustable').props.accessibilityValue.now).toBe(2)
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(145))
  expect(onChange).toHaveBeenLastCalledWith('high')
  expect(view.queryByTestId('chat-reasoning-feedback')).toBeNull()

  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(12))
  expect(view.getByTestId('chat-reasoning-feedback-label').props.children).toBe('chat.reasoningEffort.default')
  await fireEvent(view.getByRole('adjustable'), 'touchCancel')
  expect(view.queryByTestId('chat-reasoning-feedback')).toBeNull()
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe('chat.reasoningEffort.low')
  await view.unmount()
})

it('gives one selection haptic per level crossing and respects the haptics preference', async () => {
  jest.mocked(Haptics.selectionAsync).mockClear()
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="low" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(130))
  await fireEvent(view.getByRole('adjustable'), 'responderMove', touch(140))
  await fireEvent(view.getByRole('adjustable'), 'responderMove', touch(145))
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1)
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(145))
  expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1)
  expect(onChange).toHaveBeenLastCalledWith('high')
  await view.unmount()

  jest.mocked(useSettingsStore).mockImplementation(selector => selector({ settings: { hapticsEnabled: false } } as never))
  try {
    const disabledHaptics = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="low" compact onChange={onChange} />)
    await fireEvent(disabledHaptics.getByRole('adjustable'), 'layout', trackLayout)
    await fireEvent(disabledHaptics.getByRole('adjustable'), 'responderGrant', touch(110))
    await fireEvent(disabledHaptics.getByRole('adjustable'), 'responderRelease', touch(110))
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1)
    expect(onExpand).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('high')
    await disabledHaptics.unmount()
  } finally {
    jest.mocked(useSettingsStore).mockImplementation(selector => selector({ settings: { hapticsEnabled: true } } as never))
  }
})

it('keeps the same control and height as the composer grows and shrinks', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="high" compact onChange={onChange} />)
  const control = view.getByRole('adjustable')
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="high" compact={false} onChange={onChange} />)
  expect(view.getByRole('adjustable')).toBe(control)
  expect(StyleSheet.flatten(control.props.style).height).toBe(44)
  expect(view.getByTestId('chat-reasoning-track')).toBeTruthy()
  expect(control.props.accessibilityValue.text).toBe('chat.reasoningEffort.high')
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high', 'max']} value="high" compact onChange={onChange} />)
  expect(view.getByRole('adjustable')).toBe(control)
  expect(StyleSheet.flatten(control.props.style).height).toBe(44)
  expect(view.queryByTestId('chat-reasoning-track')).toBeNull()
  expect(control.props.accessibilityState.expanded).toBeUndefined()
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})

it('discards interrupted gestures and stale gestures after sending, model changes, or resizing', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high']} value="low" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  await fireEvent(view.getByRole('adjustable'), 'responderTerminate')
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe('chat.reasoningEffort.low')
  expect(onChange).not.toHaveBeenCalled()

  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  const release = view.getByRole('adjustable').props.onResponderRelease
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high']} value="low" disabled compact={false} onChange={onChange} />)
  await act(() => release(touch(208)))
  expect(view.getByRole('adjustable').props.onStartShouldSetResponder()).toBe(false)
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
  expect(onChange).not.toHaveBeenCalled()

  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high']} value="low" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  await view.rerender(<ComposerReasoningBar modelKey="p:other" onExpand={onExpand} options={['ultra']} value={undefined} compact={false} onChange={onChange} />)
  await act(() => release(touch(208)))
  expect(onChange).not.toHaveBeenCalled()

  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  await view.rerender(<ComposerReasoningBar modelKey="p:other" onExpand={onExpand} options={['ultra']} value={undefined} compact onChange={onChange} />)
  await act(() => release(touch(208)))
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})

it('keeps default distinct from none and supports accessibility and a single supported level', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['none', 'low', 'max', 'ultra']} value="low" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
  expect(onChange).toHaveBeenLastCalledWith('max')
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } })
  expect(onChange).toHaveBeenLastCalledWith('none')
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['none', 'low', 'max', 'ultra']} value="none" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } })
  expect(onChange).toHaveBeenLastCalledWith(undefined)

  await view.rerender(<ComposerReasoningBar modelKey="p:single" onExpand={onExpand} options={['ultra']} value={undefined} compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  await fireEvent(view.getByRole('adjustable'), 'responderRelease', touch(208))
  expect(onChange).toHaveBeenLastCalledWith('ultra')
  await view.rerender(<ComposerReasoningBar modelKey="p:single" onExpand={onExpand} options={['ultra']} value="ultra" compact={false} onChange={onChange} />)
  onChange.mockClear()
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } })
  expect(onChange).toHaveBeenLastCalledWith(undefined)
  await view.unmount()
})

it('opens the enlarged control through accessibility activation and ignores activation while unavailable', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high']} value="low" compact onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } })
  expect(onExpand).toHaveBeenCalledTimes(1)
  expect(onChange).not.toHaveBeenCalled()
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'high']} value="low" compact disabled onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } })
  expect(onExpand).toHaveBeenCalledTimes(1)
  await view.unmount()
})

it('retains every level identity for sparse model options and under reduced motion', async () => {
  const onChange = jest.fn()
  const options = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
  const view = await render(<ComposerReasoningBar modelKey="p:all" onExpand={onExpand} options={[...options]} value={undefined} compact={false} onChange={onChange} />)
  const tints = new Set<string>()
  for (const level of ['default', ...options]) {
    tints.add(StyleSheet.flatten(view.getByTestId(`chat-reasoning-stop-${level}`).props.style).backgroundColor)
  }
  expect(tints.size).toBe(9)
  for (const level of options) {
    await view.rerender(<ComposerReasoningBar modelKey="p:sparse" onExpand={onExpand} options={[level]} value={level} compact={false} onChange={onChange} />)
    expect(view.getByTestId(`chat-reasoning-effect-${level}-thumb`)).toBeTruthy()
    expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe(`chat.reasoningEffort.${level}`)
    expect(view.getByRole('adjustable').props.accessibilityValue.now).toBe(1)
    expect(view.queryByTestId('chat-reasoning-effect-default-thumb')).toBeNull()
  }
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})

it('stops bounded effect animations when motion is reduced or the control unmounts', async () => {
  jest.mocked(useMotionPreference).mockReturnValue('full')
  const stop = jest.fn()
  const timing = jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: jest.fn(), stop, reset: jest.fn(),
  }))
  try {
    const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'max']} value="max" compact={false} onChange={jest.fn()} />)
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      duration: resolveReasoningEffortEffect('max', getColors('light', 'minimal'), false).duration,
      useNativeDriver: true, isInteraction: false,
    }))
    setTheme('liquid-glass')
    await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'max']} value="max" compact={false} onChange={jest.fn()} />)
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      duration: resolveReasoningEffortEffect('max', getColors('light', 'liquid-glass'), false).duration,
      useNativeDriver: true, isInteraction: false,
    }))
    jest.mocked(useMotionPreference).mockReturnValue('reduced')
    await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'max']} value="max" compact={false} onChange={jest.fn()} />)
    expect(stop).toHaveBeenCalled()
    const calls = timing.mock.calls.length
    await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'max']} value="low" compact={false} onChange={jest.fn()} />)
    expect(timing).toHaveBeenCalledTimes(calls)
    await view.unmount()
  } finally {
    timing.mockRestore()
    jest.mocked(useMotionPreference).mockReturnValue('reduced')
  }
})

it('shows a disabled model default for unsupported models and clears an obsolete effort', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low']} value="max" compact onChange={onChange} />)
  expect(view.getByRole('adjustable').props.accessibilityValue.text).toBe('chat.reasoningEffort.default')
  await view.rerender(<ComposerReasoningBar modelKey="p:unsupported" onExpand={onExpand} options={[]} value="max" compact={false} onChange={onChange} />)
  const control = view.getByRole('adjustable')
  expect(control.props.accessibilityState.disabled).toBe(true)
  expect(control.props.accessibilityValue.text).toBe('chat.reasoningBar.fixed')
  expect(control.props.onStartShouldSetResponder()).toBe(false)
  expect(view.queryByTestId('chat-reasoning-track')).toBeNull()
  await fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } })
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})

it('updates theme shapes, rail geometry and tints in place without changing the selected effort', async () => {
  const onChange = jest.fn()
  const options = ['none', 'low', 'high', 'max'] as const
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={[...options]} value="high" compact onChange={onChange} />)
  const control = view.getByRole('adjustable')
  const radii = new Set<number>()
  const heights = new Set<number>()
  const tints = new Set<string>()
  for (const themeId of CANONICAL_THEME_IDS) {
    setTheme(themeId)
    await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={[...options]} value="high" compact onChange={onChange} />)
    expect(view.getByTestId(`chat-reasoning-glyph-${themeId}-compact`)).toBeTruthy()
    radii.add(view.getByTestId('chat-reasoning-surface').props.rx)
    await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={[...options]} value="high" compact={false} onChange={onChange} />)
    await fireEvent(control, 'layout', trackLayout)
    expect(view.getByTestId(`chat-reasoning-glyph-${themeId}-thumb`)).toBeTruthy()
    heights.add(StyleSheet.flatten(view.getByTestId('chat-reasoning-rail').props.style).height)
    const tint = StyleSheet.flatten(view.getByTestId('chat-reasoning-stop-high').props.style).backgroundColor
    tints.add(tint)
    setTheme(themeId, true)
    await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={[...options]} value="high" compact={false} onChange={onChange} />)
    expect(StyleSheet.flatten(view.getByTestId('chat-reasoning-stop-high').props.style).backgroundColor).not.toBe(tint)
    expect(view.getByRole('adjustable')).toBe(control)
    expect(control.props.accessibilityValue).toMatchObject({ now: 3, max: 4, text: 'chat.reasoningEffort.high' })
    expect(StyleSheet.flatten(control.props.style).height).toBe(44)
  }
  expect(radii.size).toBeGreaterThanOrEqual(4)
  expect(heights.size).toBe(5)
  expect(tints.size).toBe(5)
  expect(onChange).not.toHaveBeenCalled()
  expect(Haptics.selectionAsync).not.toHaveBeenCalled()
  await view.unmount()
})

it('removes unavailable levels and pending feedback when the same supplier refreshes model capabilities', async () => {
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['low', 'medium', 'high', 'max']} value="high" compact={false} onChange={onChange} />)
  await fireEvent(view.getByRole('adjustable'), 'layout', trackLayout)
  await fireEvent(view.getByRole('adjustable'), 'responderGrant', touch(208))
  const release = view.getByRole('adjustable').props.onResponderRelease
  expect(view.getByTestId('chat-reasoning-feedback-label').props.children).toBe('chat.reasoningEffort.max')
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={['none', 'low']} value={undefined} compact={false} onChange={onChange} />)
  const control = view.getByRole('adjustable')
  expect(control.props.accessibilityValue).toMatchObject({ now: 0, max: 2, text: 'chat.reasoningEffort.default' })
  expect(view.queryByTestId('chat-reasoning-stop-high')).toBeNull()
  expect(view.queryByTestId('chat-reasoning-stop-max')).toBeNull()
  expect(view.queryByTestId('chat-reasoning-feedback')).toBeNull()
  await act(() => release(touch(208)))
  expect(onChange).not.toHaveBeenCalled()
  await fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } })
  expect(onChange).toHaveBeenLastCalledWith('none')
  await view.rerender(<ComposerReasoningBar modelKey="p:m" onExpand={onExpand} options={[]} value={undefined} compact={false} onChange={onChange} />)
  expect(control.props.accessibilityState.disabled).toBe(true)
  expect(view.queryByTestId('chat-reasoning-track')).toBeNull()
  expect(view.queryByTestId('chat-reasoning-effect-default-compact')).toBeNull()
  await view.unmount()
})

it('preserves semantic effects when two suppliers expose different levels for the same model', async () => {
  setTheme('animal-island-ui', true)
  const onChange = jest.fn()
  const view = await render(<ComposerReasoningBar modelKey="first:shared" onExpand={onExpand} options={['none', 'low', 'high', 'max']} value="high" compact={false} onChange={onChange} />)
  const tint = StyleSheet.flatten(view.getByTestId('chat-reasoning-stop-high').props.style).backgroundColor
  await view.rerender(<ComposerReasoningBar modelKey="second:shared" onExpand={onExpand} options={['high', 'low', 'high']} value="high" compact={false} onChange={onChange} />)
  expect(view.getByRole('adjustable').props.accessibilityValue).toMatchObject({ now: 2, max: 2, text: 'chat.reasoningEffort.high' })
  expect(StyleSheet.flatten(view.getByTestId('chat-reasoning-stop-high').props.style).backgroundColor).toBe(tint)
  expect(view.getByTestId('chat-reasoning-glyph-animal-island-ui-thumb')).toBeTruthy()
  expect(view.queryByTestId('chat-reasoning-stop-none')).toBeNull()
  expect(view.queryByTestId('chat-reasoning-stop-max')).toBeNull()
  expect(onChange).not.toHaveBeenCalled()
  await view.unmount()
})
