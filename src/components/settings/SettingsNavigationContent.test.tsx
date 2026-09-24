import { act, fireEvent, render } from '@testing-library/react-native'
import { router } from 'expo-router'
import { useSettingsStore } from '@/store/settingsStore'
import { SettingsNavigationContent } from './SettingsNavigationContent'

const mockTranslate = (key: string) => key
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: jest.fn(select => select({ providers: [], settings: { language: 'en' } })) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal'), canonicalThemeId: 'minimal' }) }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({ IslePressable: require('react-native').Pressable, IsleSearchField: require('react-native').TextInput }))

afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); jest.clearAllMocks() })
it('opens six task categories without mounting configuration screens', async () => {
  const screen = await render(<SettingsNavigationContent />)
  for (const category of ['models', 'knowledge', 'tools', 'personalization', 'privacy', 'maintenance']) expect(screen.getByTestId(`settings-category-${category}`)).toBeTruthy()
  await fireEvent.press(screen.getByTestId('settings-category-privacy'))
  expect(router.push).toHaveBeenCalledWith('/settings/category/privacy')
  expect(screen.queryByTestId('settings-appearance-foldout')).toBeNull()
})
it('updates input immediately but isolates debounced search from store subscribers', async () => {
  jest.useFakeTimers()
  const schedule = jest.spyOn(global, 'setTimeout')
  const cancel = jest.spyOn(global, 'clearTimeout')
  const screen = await render(<SettingsNavigationContent />)
  const reads = jest.mocked(useSettingsStore).mock.calls.length
  await fireEvent.changeText(screen.getByLabelText('settings.search'), 'temperature')
  expect(screen.getByLabelText('settings.search').props.value).toBe('temperature')
  expect(screen.queryByTestId('settings-result-temperature')).toBeNull()
  await act(() => jest.advanceTimersByTime(120))
  expect(jest.mocked(useSettingsStore).mock.calls.length).toBe(reads)
  await fireEvent.press(screen.getByTestId('settings-result-temperature'))
  expect(router.push).toHaveBeenCalledWith({ pathname: '/settings/preferences', params: { section: 'generation-temperature', locate: expect.any(String), returnTo: 'settings' } })
  const scheduled = schedule.mock.calls.findLastIndex(([, delay]) => delay === 120)
  const debounce = schedule.mock.results[scheduled].value
  await screen.unmount()
  expect(cancel).toHaveBeenCalledWith(debounce)
})
it('keeps field-level matches out of category lists', async () => {
  const screen = await render(<SettingsNavigationContent category="privacy" />)
  expect(screen.getByTestId('settings-entry-governance')).toBeTruthy()
  expect(screen.queryByTestId('settings-entry-governance.proxyBaseUrl')).toBeNull()
})
