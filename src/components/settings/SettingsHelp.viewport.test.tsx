import { act, fireEvent, render } from '@testing-library/react-native'
import { Keyboard, Platform, StyleSheet, type KeyboardEvent } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { GuideReader } from './SettingsHelp'

let mockDimensions = { width: 872, height: 390, scale: 1, fontScale: 1 }
let mockGuideFrame = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => callback(0, 32, 872, 358) }
jest.mock('react-native', () => {
  const original = jest.requireActual('react-native')
  const React = require('react')
  const MeasuredView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => mockGuideFrame)
    return <original.View {...props} />
  })
  const View = React.forwardRef((props: any, ref: any) => props.testID === 'guide-frame'
    ? <MeasuredView {...props} ref={ref} /> : <original.View {...props} ref={ref} />)
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(original), View: { value: View }, useWindowDimensions: { value: () => mockDimensions } })
})
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, TextInput, View } = require('react-native')
  return {
    IsleScreen: View, IslePressable: Pressable, IsleSearchField: TextInput,
    IsleButton: ({ label, onPress }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>,
  }
})
jest.mock('react-native-markdown-display', () => ({
  __esModule: true,
  MarkdownIt: jest.requireActual('react-native-markdown-display').MarkdownIt,
  default: ({ children }: any) => <>{children}</>,
}))

beforeEach(() => { mockDimensions = { width: 872, height: 390, scale: 1, fontScale: 1 } })

it.each(CANONICAL_THEME_IDS.flatMap(theme => (['light', 'dark'] as const).map(mode => ({ theme, mode }))))(
  'keeps $theme $mode manual search and close reachable as the keyboard reduces height',
  async ({ theme, mode }) => {
    const colors = getColors(mode, theme)
    jest.mocked(useAppTheme).mockReturnValue({ colors, canonicalThemeId: theme, design: colors.design } as ReturnType<typeof useAppTheme>)
    const close = jest.fn()
    const screen = await render(<GuideReader onClose={close} />)
    const field = screen.getByLabelText('settingsWorkspace.searchManual')
    let parent = field.parent
    const ancestorIds: string[] = []
    while (parent) { if (parent.props.testID) ancestorIds.push(parent.props.testID); parent = parent.parent }
    expect(ancestorIds).not.toContain('guide-scroll')
    await fireEvent.changeText(field, 'setup-flow.svg')
    expect(screen.getByText('settingsWorkspace.notFound')).toBeTruthy()
    await fireEvent(screen.getByTestId('guide-viewport'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 872, height: 120 } } })
    expect(screen.queryByRole('header', { name: 'settingsWorkspace.manual' })).toBeNull()
    expect(screen.getByLabelText('settingsWorkspace.searchManual')).toBe(field)
    expect(field.props.value).toBe('setup-flow.svg')
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.closeManual' }))
    expect(close).toHaveBeenCalledTimes(1)
    await fireEvent(screen.getByTestId('guide-viewport'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 872, height: 390 } } })
    expect(screen.getAllByRole('header', { name: 'settingsWorkspace.manual' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('settingsWorkspace.searchManual')).toBe(field)
    expect(field.props.value).toBe('setup-flow.svg')
    await screen.unmount()
  },
)


afterEach(() => { jest.restoreAllMocks() })

it.each(CANONICAL_THEME_IDS.flatMap(theme => (['light', 'dark'] as const).map(mode => ({ theme, mode }))))(
  'keeps $theme $mode manual controls and results above an overlay keyboard without a window resize',
  async ({ theme, mode }) => {
    jest.replaceProperty(Platform, 'OS', 'android')
    const listeners = new Map<string, (event: KeyboardEvent) => void>()
    const frames = new Map<number, FrameRequestCallback>()
    const removals: jest.Mock[] = []
    let frameId = 0
    jest.spyOn(Keyboard, 'metrics').mockReturnValue(undefined)
    jest.spyOn(Keyboard, 'addListener').mockImplementation((name, callback) => {
      listeners.set(name, callback)
      const remove = jest.fn(() => { listeners.delete(name) }); removals.push(remove)
      return { remove } as unknown as ReturnType<typeof Keyboard.addListener>
    })
    jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
    jest.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(id => { if (typeof id === 'number') frames.delete(id) })
    const flush = async () => { await act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)) }) }
    const colors = getColors(mode, theme)
    jest.mocked(useAppTheme).mockReturnValue({ colors, canonicalThemeId: theme, design: colors.design } as ReturnType<typeof useAppTheme>)
    const close = jest.fn()
    const screen = await render(<GuideReader onClose={close} />)
    await flush()
    const field = screen.getByLabelText('settingsWorkspace.searchManual')
    await fireEvent.changeText(field, 'setup-flow.svg')
    const event: KeyboardEvent = { duration: 0, easing: 'keyboard', endCoordinates: { screenX: 0, screenY: 135, width: 872, height: 255 } }
    await act(() => { listeners.get('keyboardDidShow')?.(event) }); await flush()
    expect(mockDimensions.height).toBe(390)
    expect(screen.queryByRole('header', { name: 'settingsWorkspace.manual' })).toBeNull()
    expect(StyleSheet.flatten(screen.getByTestId('guide-viewport').props.style).marginBottom).toBe(255)
    expect(screen.getByText('settingsWorkspace.notFound')).toBeTruthy()
    expect(screen.getByLabelText('settingsWorkspace.searchManual')).toBe(field)
    expect(field.props.value).toBe('setup-flow.svg')
    await fireEvent(screen.getByTestId('guide-frame'), 'layout', { nativeEvent: { layout: { x: 0, y: 32, width: 872, height: 358 } } }); await flush()
    expect(StyleSheet.flatten(screen.getByTestId('guide-viewport').props.style).marginBottom).toBe(255)
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.closeManual' }))
    expect(close).toHaveBeenCalledTimes(1)
    await act(() => { listeners.get('keyboardDidHide')?.(event) }); await flush()
    expect(StyleSheet.flatten(screen.getByTestId('guide-viewport').props.style).marginBottom).toBe(0)
    expect(screen.getAllByRole('header', { name: 'settingsWorkspace.manual' }).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('settingsWorkspace.searchManual')).toBe(field)
    expect(field.props.value).toBe('setup-flow.svg')
    await screen.unmount()
    expect(removals.every(remove => remove.mock.calls.length === 1)).toBe(true)
    expect(listeners.size).toBe(0); expect(frames.size).toBe(0)
  },
)
