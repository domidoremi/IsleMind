import { useContext, useEffect } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { SettingsPageShell } from './SettingsPageShell'
import { SettingsSectionContext } from './SettingsSection'

let mockParams = { section: 'target', locate: '1' }
let mockFocused = true
let mockMotion = 'full'
let mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 }
let mockContentHeight = 2344
let mockStackIndex = 1
const mockEvents = new Map<string, () => void>()
const mockScroll = jest.fn()
const mockMeasurements: Array<(x: number, y: number, width: number, height: number) => void> = []
const mockNode = { measureLayout: (_parent: unknown, done: (x: number, y: number, width: number, height: number) => void) => mockMeasurements.push(done) }
const mockNavigation = { getState: () => ({ index: mockStackIndex }), addListener: (event: string, handler: () => void) => { mockEvents.set(event, handler); return () => mockEvents.delete(event) } }
jest.mock('expo-router', () => ({ usePathname: () => '/settings/preferences', useNavigation: () => mockNavigation, useLocalSearchParams: () => mockParams, router: {} }))
jest.mock('expo-router/react-navigation', () => ({ useIsFocused: () => mockFocused }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('./SettingsEditBoundary', () => ({ SettingsEditBoundary: ({ children }: any) => children, useSettingsLeave: () => (action: () => void) => action() }))
jest.mock('./theme-experiences/SettingsPageExperiences', () => ({ MinimalSettingsPageExperience: () => null }))
jest.mock('react-native', () => {
  const original = jest.requireActual('react-native')
  const React = require('react')
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(original),
    useWindowDimensions: { value: () => mockDimensions },
    View: { value: React.forwardRef((props: any, ref: any) => { React.useImperativeHandle(ref, () => ({ measure: (done: (...args: number[]) => void) => done(0, 0, 390, mockContentHeight, 0, 0) })); return <original.View {...props} /> }) },
    ScrollView: { value: React.forwardRef((props: any, ref: any) => { React.useImperativeHandle(ref, () => ({ scrollTo: mockScroll })); return <original.View {...props} testID="scroll" /> }) },
  })
})
jest.mock('@/components/ui/isle', () => ({ IsleScreen: ({ children }: any) => children }))
function Target() {
  const { target, register } = useContext(SettingsSectionContext)
  useEffect(() => { if (target) register(target, mockNode as any); return () => { if (target) register(target, null) } }, [target, register])
  return null
}
function flushMeasurements() { const pending = mockMeasurements.splice(0); pending.forEach(done => done(0, 120, 100, 44)) }
async function layoutScroll(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent(screen.getByTestId('scroll'), 'layout', { nativeEvent: { layout: { width: 390, height: 844 } } })
  await fireEvent(screen.getByTestId('scroll'), 'contentSizeChange', 390, 2400)
}
beforeEach(() => { mockParams = { section: 'target', locate: '1' }; mockFocused = true; mockMotion = 'full'; mockStackIndex = 1; mockContentHeight = 2344; mockDimensions = { width: 390, height: 844, scale: 1, fontScale: 1 }; mockScroll.mockClear(); mockMeasurements.length = 0 })
afterEach(() => jest.useRealTimers())
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
