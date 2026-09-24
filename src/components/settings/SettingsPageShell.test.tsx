import { useContext, useEffect } from 'react'
import { act, fireEvent, render } from '@testing-library/react-native'
import { SettingsPageShell } from './SettingsPageShell'
import { SettingsSectionContext } from './SettingsSection'

let mockParams = { section: 'target', locate: '1' }
let mockFocused = true
let mockMotion = 'full'
const mockEvents = new Map<string, () => void>()
const mockScroll = jest.fn()
const mockMeasurements: Array<(x: number, y: number) => void> = []
const mockNode = { measureLayout: (_parent: unknown, done: (x: number, y: number) => void) => mockMeasurements.push(done) }
const mockNavigation = { getState: () => ({ index: 1 }), addListener: (event: string, handler: () => void) => { mockEvents.set(event, handler); return () => mockEvents.delete(event) } }
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
    View: { value: React.forwardRef((props: any, ref: any) => { React.useImperativeHandle(ref, () => ({})); return <original.View {...props} /> }) },
    ScrollView: { value: React.forwardRef((props: any, ref: any) => { React.useImperativeHandle(ref, () => ({ scrollTo: mockScroll })); return <original.View {...props} testID="scroll" /> }) },
  })
})
jest.mock('@/components/ui/isle', () => ({ IsleScreen: ({ children }: any) => children }))
function Target() {
  const { target, register } = useContext(SettingsSectionContext)
  useEffect(() => { if (target) register(target, mockNode as any); return () => { if (target) register(target, null) } }, [target, register])
  return null
}
function flushMeasurements() { const pending = mockMeasurements.splice(0); pending.forEach(done => done(0, 120)) }
beforeEach(() => { mockParams = { section: 'target', locate: '1' }; mockFocused = true; mockMotion = 'full'; mockScroll.mockClear(); mockMeasurements.length = 0 })
afterEach(() => jest.useRealTimers())
it('waits for focus, transition and measurement, then scrolls only once', async () => {
  jest.useFakeTimers()
  const screen = await render(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  expect(mockMeasurements).toHaveLength(0)
  await act(() => mockEvents.get('transitionEnd')?.())
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
  const old = mockMeasurements.splice(0)
  mockParams = { section: 'another', locate: '2' }
  await screen.rerender(<SettingsPageShell title="Settings"><Target /></SettingsPageShell>)
  await act(() => old.forEach(done => done(0, 800)))
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
