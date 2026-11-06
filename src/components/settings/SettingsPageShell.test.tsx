import { useContext, useEffect } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { Keyboard, Platform, Pressable as MockPressable, TextInput } from 'react-native'
import { SettingsPageShell } from './SettingsPageShell'
import { SettingsSectionContext, useSettingsUndoAction } from './SettingsSection'

let mockParams = { section: 'target', locate: '1' }
let mockFocused = true
let mockMotion = 'full'
let mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 }
let mockContentHeight = 2344
let mockStackIndex = 1
let mockFamily: 'minimal' | 'monet' = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
const mockEvents = new Map<string, () => void>()
const mockScroll = jest.fn()
let mockUndoHandler = () => undefined
const mockMeasurements: Array<(x: number, y: number, width: number, height: number) => void> = []
const mockNode = { measureLayout: (_parent: unknown, done: (x: number, y: number, width: number, height: number) => void) => mockMeasurements.push(done) }
const mockNavigation = { getState: () => ({ index: mockStackIndex }), addListener: (event: string, handler: () => void) => { mockEvents.set(event, handler); return () => mockEvents.delete(event) } }
jest.mock('expo-router', () => ({ usePathname: () => '/settings/preferences', useNavigation: () => mockNavigation, useLocalSearchParams: () => mockParams, router: {} }))
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors(mockMode, mockFamily), canonicalThemeId: mockFamily, mode: mockMode }) }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsEditBoundary', () => ({ SettingsEditBoundary: ({ children }: any) => children, useSettingsLeave: () => (action: () => void) => action() }))
jest.mock('./theme-experiences/SettingsPageExperiences', () => {
  const Experience = ({ trailing }: any) => trailing
  return { MinimalSettingsPageExperience: Experience, MonetSettingsPageExperience: Experience,
    MaterialSettingsPageExperience: Experience, LiquidGlassSettingsPageExperience: Experience }
})
jest.mock('react-native', () => {
  const original = jest.requireActual('react-native')
  const React = require('react')
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(original),
    useWindowDimensions: { value: () => mockDimensions },
    View: { value: React.forwardRef((props: any, ref: any) => { React.useImperativeHandle(ref, () => ({ measure: (done: (...args: number[]) => void) => done(0, 0, 390, mockContentHeight, 0, 0) })); return <original.View {...props} /> }) },
    ScrollView: { value: React.forwardRef((props: any, ref: any) => { React.useImperativeHandle(ref, () => ({ scrollTo: mockScroll })); return <original.View {...props} testID="scroll" /> }) },
  })
})
jest.mock('@/components/ui/isle', () => ({
  IsleScreen: ({ children }: any) => children,
  IslePressable: (props: any) => {
    if (props.testID === 'settings-undo') mockUndoHandler = props.onPress
    const MockPressable = require('react-native').Pressable
    return <MockPressable {...props} />
  },
}))
function Target() {
  const { target, register } = useContext(SettingsSectionContext)
  useEffect(() => { if (target) register(target, mockNode as any); return () => { if (target) register(target, null) } }, [target, register])
  return null
}
function UndoContent({ available, busy = false, onUndo }: { available: boolean; busy?: boolean; onUndo: () => void }) {
  useSettingsUndoAction(available, onUndo, busy)
  return <TextInput testID="undo-draft" defaultValue="retain this input" />
}
function flushMeasurements() { const pending = mockMeasurements.splice(0); pending.forEach(done => done(0, 120, 100, 44)) }
async function layoutScroll(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent(screen.getByTestId('scroll'), 'layout', { nativeEvent: { layout: { width: 390, height: 844 } } })
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
}
function TaskScrollControls() {
  const { resetScroll } = useContext(SettingsSectionContext)
  return <>
    <MockPressable testID="open-task" onPress={() => resetScroll?.(false)} />
    <MockPressable testID="return-to-tasks" onPress={() => resetScroll?.(true)} />
    <TextInput testID="task-scroll-owner" defaultValue="Keep this owner" />
  </>
}
const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!
function nativeKeyboard() {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  const events = new Map<string, (event?: any) => void>()
  const frames = new Map<number, FrameRequestCallback>()
  const measurements: Array<(x: number, y: number, width: number, height: number) => void> = []
  const input = { measureInWindow: (done: typeof measurements[number]) => measurements.push(done) }
  let focusedInput: typeof input | undefined = input
  let nextFrame = 0
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, handler) => {
    events.set(name, handler)
    return { remove: () => { events.delete(name) } } as ReturnType<typeof Keyboard.addListener>
  })
  jest.spyOn(TextInput.State, 'currentlyFocusedInput').mockImplementation(() => focusedInput as any)
  jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => {
    const id = ++nextFrame
    frames.set(id, callback)
    return id
  })
  jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => { if (id != null) frames.delete(id) })
  return {
    measurements,
    show: () => events.get('keyboardDidShow')?.({ endCoordinates: { screenY: 544, height: 300 } }),
    hide: () => events.get('keyboardDidHide')?.(),
    blur: () => { focusedInput = undefined },
    focus: () => { focusedInput = input },
    frames: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(done => done(0)) },
  }
}
beforeEach(() => { mockParams = { section: 'target', locate: '1' }; mockFocused = true; mockMotion = 'full'; mockStackIndex = 1; mockFamily = 'minimal'; mockMode = 'light'; mockContentHeight = 2344; mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 }; mockScroll.mockClear(); mockMeasurements.length = 0 })
afterEach(() => { Object.defineProperty(Platform, 'OS', platformDescriptor); jest.restoreAllMocks(); jest.useRealTimers() })

it('keeps a native input above the keyboard after theme reflow and reserves scroll space', async () => {
  const keyboard = nativeKeyboard()
  mockParams = { section: '', locate: '1' }
  const page = () => <SettingsPageShell title="Settings"><TextInput testID="keyboard-owner" defaultValue="65" /></SettingsPageShell>
  const screen = await render(page())
  const owner = screen.getByTestId('keyboard-owner')
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 600 } } })
  await act(keyboard.show)
  expect(screen.getByTestId('scroll')).toHaveProp('contentContainerStyle', expect.objectContaining({ paddingBottom: 348 }))
  await act(keyboard.frames)
  await act(() => keyboard.measurements.shift()?.(0, 620, 100, 48))
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 748, animated: true })
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 748 } } })
  mockFamily = 'monet'; mockMode = 'dark'; mockMotion = 'none'
  await screen.rerender(page())
  await act(keyboard.frames)
  await act(() => keyboard.measurements.shift()?.(0, 600, 100, 48))
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 876, animated: false })
  expect(screen.getByTestId('keyboard-owner')).toBe(owner)
  await act(keyboard.hide)
  expect(screen.getByTestId('scroll')).toHaveProp('contentContainerStyle', expect.objectContaining({ paddingBottom: 48 }))
})

it('rejects a pending keyboard measurement after dragging, losing focus or unmounting', async () => {
  const keyboard = nativeKeyboard()
  mockParams = { section: '', locate: '1' }
  const screen = await render(<SettingsPageShell title="Settings"><TextInput /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  await act(keyboard.show)
  await act(keyboard.frames)
  const dragged = keyboard.measurements.shift()
  await fireEvent(screen.getByTestId('scroll'), 'scrollBeginDrag')
  await act(() => dragged?.(0, 620, 100, 48))
  expect(mockScroll).not.toHaveBeenCalled()
  await act(keyboard.show)
  await act(keyboard.frames)
  keyboard.blur()
  await act(() => keyboard.measurements.shift()?.(0, 620, 100, 48))
  expect(mockScroll).not.toHaveBeenCalled()
  keyboard.focus()
  await act(keyboard.show)
  await act(keyboard.frames)
  const unmounted = keyboard.measurements.shift()
  await screen.unmount()
  await act(() => unmounted?.(0, 620, 100, 48))
  expect(mockScroll).not.toHaveBeenCalled()
})

it('restores the task list offset after its native content height is available', async () => {
  mockParams = { section: '', locate: '1' }
  const screen = await render(<SettingsPageShell title="Settings"><TaskScrollControls /></SettingsPageShell>)
  await layoutScroll(screen)
  const owner = screen.getByTestId('task-scroll-owner')
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 600 } } })
  await fireEvent.press(screen.getByTestId('open-task'))
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 0, animated: false })
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 0 } } })
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 500)
  await fireEvent.press(screen.getByTestId('return-to-tasks'))
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 0 } } })
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 600, animated: false })
  expect(screen.getByTestId('task-scroll-owner')).toBe(owner)
})

it('does not force a pending task restoration after the user starts dragging', async () => {
  mockParams = { section: '', locate: '1' }
  const screen = await render(<SettingsPageShell title="Settings"><TaskScrollControls /></SettingsPageShell>)
  await layoutScroll(screen)
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 600 } } })
  await fireEvent.press(screen.getByTestId('open-task'))
  await fireEvent.press(screen.getByTestId('return-to-tasks'))
  await fireEvent(screen.getByTestId('scroll'), 'scrollBeginDrag')
  mockScroll.mockClear()
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
  expect(mockScroll).not.toHaveBeenCalled()
})
it('keeps undo in the fixed header slot without replacing content, and blocks stale or busy actions', async () => {
  const undo = jest.fn()
  const latestUndo = jest.fn()
  const page = (available: boolean, busy = false, onUndo = undo) => <SettingsPageShell title="Settings">
    <UndoContent available={available} busy={busy} onUndo={onUndo} />
  </SettingsPageShell>
  const screen = await render(page(false))
  const input = screen.getByTestId('undo-draft')
  const slot = screen.getByTestId('page-feedback-indicator')
  expect(slot).toHaveStyle({ width: 44, height: 44 })
  expect(screen.queryByTestId('settings-undo')).toBeNull()
  await screen.rerender(page(true))
  const action = mockUndoHandler
  expect(screen.getByTestId('page-feedback-indicator')).toBe(slot)
  expect(screen.getByTestId('undo-draft')).toBe(input)
  expect(screen.getByTestId('settings-undo')).toHaveStyle({ width: 44, height: 44 })
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.undo' }))
  expect(undo).toHaveBeenCalledTimes(1)
  await screen.rerender(page(true, true, latestUndo))
  expect(screen.getByTestId('settings-undo')).toBeDisabled()
  await act(() => action())
  expect(latestUndo).not.toHaveBeenCalled()
  await screen.rerender(page(true, false, latestUndo))
  await act(() => action())
  expect(latestUndo).toHaveBeenCalledTimes(1)
  await screen.rerender(page(false))
  expect(screen.getByTestId('undo-draft')).toBe(input)
  expect(screen.queryByTestId('settings-undo')).toBeNull()
  await act(() => action())
  await screen.rerender(page(true, false, latestUndo))
  await screen.unmount()
  await act(() => action())
  expect(latestUndo).toHaveBeenCalledTimes(1)
})
it('waits for native appearance on an initial deep link at stack index zero', async () => {
  mockStackIndex = 0
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await layoutScroll(screen)
  await act(flushMeasurements)
  expect(mockMeasurements).toHaveLength(0)
  expect(mockScroll).not.toHaveBeenCalled()
  await act(() => mockEvents.get('transitionEnd')?.())
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(1)
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 108, animated: true })
})
it('waits for focus, transition and measurement, then scrolls only once', async () => {
  jest.useFakeTimers()
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  expect(mockMeasurements).toHaveLength(0)
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  expect(mockMeasurements.length).toBeGreaterThan(0)
  expect(mockScroll).not.toHaveBeenCalled()
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(1)
  expect(mockScroll).toHaveBeenCalledWith({ y: 108, animated: true })
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(1)
  await screen.unmount()
  expect(mockEvents.size).toBe(0)
})
it('cancels stale layout callbacks on a newer request, dragging and unmount', async () => {
  jest.useFakeTimers()
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  const old = mockMeasurements.splice(0)
  mockParams = { section: 'another', locate: '2' }
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => old.forEach(done => done(0, 800, 100, 44)))
  expect(mockScroll).not.toHaveBeenCalled()
  await fireEvent(screen.getByTestId('scroll'), 'scrollBeginDrag')
  await act(flushMeasurements)
  expect(mockScroll).not.toHaveBeenCalled()
  mockParams = { section: 'another', locate: '3' }
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await screen.unmount()
  await act(flushMeasurements)
  expect(mockScroll).not.toHaveBeenCalled()
})
it('uses a fresh identity for the same field and honors reduced motion without restarting an old request', async () => {
  jest.useFakeTimers()
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  await act(flushMeasurements)
  mockMotion = 'none'
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(1)
  mockParams = { section: 'target', locate: '2' }
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(2)
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 108, animated: false })
})

it('restores an anchor after font reflow without accepting measurements from the old layout', async () => {
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  await act(flushMeasurements)
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 150 } } })
  mockScroll.mockClear()
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
  const stale = mockMeasurements.splice(0)

  mockDimensions = { ...mockDimensions, fontScale: 2 }
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => stale.forEach(done => done(0, 120, 100, 44)))
  expect(mockScroll).not.toHaveBeenCalled()
  mockContentHeight = 4744
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 4800)
  await act(() => mockMeasurements.splice(0).forEach(done => done(0, 300, 100, 88)))
  expect(mockScroll).toHaveBeenCalledTimes(1)
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 330, animated: false })

  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 4800)
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(1)
})

it('waits for reflowed scroll content before restoring and cancels restoration on a user drag', async () => {
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  await layoutScroll(screen)
  await act(flushMeasurements)
  await fireEvent(screen.getByTestId('scroll'), 'scroll', { nativeEvent: { contentOffset: { y: 150 } } })
  mockScroll.mockClear()

  mockDimensions = { ...mockDimensions, fontScale: 2 }
  mockContentHeight = 4744
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
  await act(flushMeasurements)
  expect(mockScroll).not.toHaveBeenCalled()
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 4800)
  const stale = mockMeasurements.splice(0)
  mockContentHeight = 4944
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 5000)
  await act(() => stale.forEach(done => done(0, 300, 100, 88)))
  expect(mockScroll).not.toHaveBeenCalled()
  await fireEvent(screen.getByTestId('scroll'), 'scrollBeginDrag')
  await act(flushMeasurements)
  expect(mockScroll).not.toHaveBeenCalled()
})

it('waits for expanded content to fit the measured scroll container and rejects stale size callbacks', async () => {
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  await fireEvent(screen.getByTestId('scroll'), 'layout', { nativeEvent: { layout: { width: 390, height: 844 } } })
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 80)
  await act(flushMeasurements)
  expect(mockScroll).not.toHaveBeenCalled()
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
  const stale = mockMeasurements.splice(0)
  mockContentHeight = 2544
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2600)
  await act(() => stale.forEach(done => done(0, 600, 100, 44)))
  expect(mockScroll).not.toHaveBeenCalled()
  await act(flushMeasurements)
  expect(mockScroll).toHaveBeenCalledTimes(1)
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 108, animated: true })
})

it('does not consume a target that fits the old scroll height while the expanded page has a newer height', async () => {
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => mockEvents.get('transitionEnd')?.())
  mockContentHeight = 4054
  await fireEvent(screen.getByTestId('scroll'), 'layout', { nativeEvent: { layout: { width: 390, height: 777 } } })
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 1736)
  await act(() => mockMeasurements.splice(0).forEach(done => done(0, 1160, 100, 124)))
  expect(mockScroll).not.toHaveBeenCalled()
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 4110)
  await act(() => mockMeasurements.splice(0).forEach(done => done(0, 1160, 100, 124)))
  expect(mockScroll).toHaveBeenCalledTimes(1)
  expect(mockScroll).toHaveBeenLastCalledWith({ y: 1148, animated: true })
})
