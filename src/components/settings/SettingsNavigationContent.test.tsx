import { act, fireEvent, render } from '@testing-library/react-native'
import { router } from 'expo-router'
import { useSettingsStore } from '@/store/settingsStore'
import { SettingsNavigationContent } from './SettingsNavigationContent'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { useWindowDimensions } from 'react-native'
import { createSettingsSearchPersistence, SETTINGS_SEARCH_SCHEMA } from '@/modules/settings'
import {
  bindSettingsStorePersistence,
  releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'

const mockTranslate = (key: string) => key
let mockState: any
let mockTheme: CanonicalThemeId = 'minimal'
let searchPersistence: SettingsStorePersistence
let savedQuery: unknown
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: jest.fn(select => select(mockState)) }))
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en' } }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', mockTheme), canonicalThemeId: mockTheme }) }))
jest.mock('@/components/ui/isle/GlassSurface', () => ({ GlassSurface: require('react-native').View }))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: jest.fn(() => ({ width: 390, height: 844, fontScale: 1, scale: 1 })) }))
jest.mock('@/components/navigation/AnimatedNavigationTrigger', () => ({ AnimatedNavigationTrigger: () => null }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/ui/isle', () => ({
  IslePressable: require('react-native').Pressable,
  IsleSearchField: require('react-native').TextInput,
  IsleButton: ({ label, onPress }: any) => {
    const React = require('react')
    const { Pressable, Text } = require('react-native')
    return React.createElement(Pressable, { accessibilityRole: 'button', onPress }, React.createElement(Text, null, label))
  },
}))

beforeEach(() => {
  mockTheme = 'minimal'
  mockState = { providers: [], settings: { language: 'en' } }
  savedQuery = null
  searchPersistence = {
    settings: { load: async () => null, save: jest.fn() },
    providers: { load: async () => [], save: jest.fn() },
    search: createSettingsSearchPersistence({ read: async () => savedQuery, write: async record => { savedQuery = record } }),
  }
  bindSettingsStorePersistence(searchPersistence)
})
afterEach(() => {
  releaseSettingsStorePersistence(searchPersistence)
  jest.restoreAllMocks()
  jest.useRealTimers()
  jest.clearAllMocks()
})
it('opens actual settings directly instead of category detours', async () => {
  const screen = await render(<SettingsNavigationContent />)
  for (const id of ['providers', 'appearance', 'preferences', 'governance', 'mcp', 'data']) expect(screen.getByTestId(`settings-entry-${id}`)).toBeTruthy()
  await fireEvent.press(screen.getByTestId('settings-entry-preferences'))
  expect(router.push).toHaveBeenCalledWith({ pathname: '/settings/preferences', params: { returnTo: 'settings' } })
  await fireEvent.press(screen.getByTestId('settings-entry-providers'))
  expect(router.push).toHaveBeenCalledWith({ pathname: '/settings/providers', params: { setup: 'add', returnTo: 'settings' } })
  expect(screen.queryByTestId('settings-quick-start')).toBeNull()
  expect(screen.queryByTestId('settings-category-models')).toBeNull()
  await fireEvent.press(screen.getAllByLabelText('settingsWorkspace.manual')[0])
  expect(router.push).toHaveBeenCalledWith({ pathname: '/help', params: { returnTo: 'settings' } })
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

it('shows only the default connection and a model explicitly selected for that provider', async () => {
  mockState = { providers: [{ id: 'one', name: 'Local test connection', enabled: true }], settings: {
    language: 'en', defaultProvider: 'one', lastPreferredModel: { providerId: 'other', model: 'unrelated-model' },
  } }
  const screen = await render(<SettingsNavigationContent />)
  expect(screen.getByText('Local test connection')).toBeTruthy()
  expect(screen.queryByText('unrelated-model')).toBeNull()
  await fireEvent.press(screen.getByTestId('settings-entry-providers'))
  expect(router.push).toHaveBeenCalledWith({ pathname: '/settings/providers', params: { returnTo: 'settings' } })
  mockState.settings.lastPreferredModel = { providerId: 'one', model: 'selected-model' }
  await screen.rerender(<SettingsNavigationContent shellNavigation />)
  expect(screen.getAllByText('selected-model').length).toBeGreaterThan(0)
})

it('does not label a disabled default connection as active', async () => {
  mockState = { providers: [{ id: 'one', name: 'Disabled connection', enabled: false }], settings: { language: 'en', defaultProvider: 'one' } }
  const screen = await render(<SettingsNavigationContent />)
  expect(screen.queryByText('Disabled connection')).toBeNull()
  await fireEvent.press(screen.getByTestId('settings-entry-providers'))
  expect(router.push).toHaveBeenCalledWith({ pathname: '/settings/providers', params: { returnTo: 'settings' } })
})

it('manages existing connections without forcing import when no default is selected', async () => {
  mockState = { providers: [{ id: 'one', name: 'Existing connection', enabled: true }], settings: { language: 'en' } }
  const screen = await render(<SettingsNavigationContent />)
  expect(screen.queryByText('settingsUx.addConnection')).toBeNull()
  expect(screen.queryByText('settingsUx.design.currentConnection')).toBeNull()
  expect(screen.getByText('settingsUx.design.manageConnections')).toBeTruthy()
  await fireEvent.press(screen.getByTestId('settings-entry-providers'))
  expect(router.push).toHaveBeenCalledWith({ pathname: '/settings/providers', params: { returnTo: 'settings' } })
  await screen.rerender(<SettingsNavigationContent category="models" />)
  await fireEvent.press(screen.getByTestId('settings-entry-providers'))
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/settings/providers', params: { returnTo: 'settings' } })
})

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)('%s changes structure, not destinations or connection setup semantics', async family => {
  mockTheme = family
  const screen = await render(<SettingsNavigationContent />)
  expect(screen.getAllByTestId(/^settings-entry-/)).toHaveLength(18)
  expect(screen.getByTestId('settings-group-everyday')).toHaveStyle({ flexDirection: family === 'material' ? 'row' : 'column' })
  expect(screen.getByTestId('settings-entry-appearance')).toHaveStyle({ flexDirection: family === 'material' ? 'column' : 'row' })
  if (family === 'minimal' || family === 'monet') {
    expect(screen.getByTestId('settings-group-everyday')).toHaveStyle({ backgroundColor: 'transparent', borderRadius: 0 })
  }
  await fireEvent.press(screen.getByTestId('settings-entry-providers'))
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/settings/providers', params: { setup: 'add', returnTo: 'settings' } })
  await fireEvent.press(screen.getByTestId('settings-entry-appearance'))
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/settings/system/appearance', params: { returnTo: 'settings' } })
})

it('reflows Material shortcuts into one column at large font scale', async () => {
  mockTheme = 'material'
  jest.mocked(useWindowDimensions).mockReturnValueOnce({ width: 390, height: 844, fontScale: 1.6, scale: 1 })
  const screen = await render(<SettingsNavigationContent />)
  expect(screen.getByTestId('settings-group-everyday')).toHaveStyle({ flexDirection: 'column' })
  expect(screen.getByTestId('settings-entry-appearance')).toHaveStyle({ flexDirection: 'row', width: undefined })
})

it('retains exact search across remount, legacy category navigation and a fresh persistence instance', async () => {
  jest.useFakeTimers()
  const screen = await render(<SettingsNavigationContent />)
  await fireEvent.changeText(screen.getByLabelText('settings.search'), 'temperature')
  await act(() => jest.advanceTimersByTime(120))
  await fireEvent.press(screen.getByTestId('settings-result-temperature'))
  await screen.unmount()
  const category = await render(<SettingsNavigationContent category="privacy" />)
  expect(category.getByLabelText('settings.search').props.value).toBe('temperature')
  expect(category.getByTestId('settings-result-temperature')).toBeTruthy()
  await category.unmount()
  releaseSettingsStorePersistence(searchPersistence)
  searchPersistence = { ...searchPersistence, search: createSettingsSearchPersistence({
    read: async () => savedQuery,
    write: async record => { savedQuery = record },
  }) }
  bindSettingsStorePersistence(searchPersistence)
  const restored = await render(<SettingsNavigationContent />)
  await act(() => jest.advanceTimersByTime(120))
  expect(restored.getByLabelText('settings.search').props.value).toBe('temperature')
  expect(savedQuery).toEqual({ schema: SETTINGS_SEARCH_SCHEMA, query: 'temperature' })
  expect(searchPersistence.settings.save).not.toHaveBeenCalled()
  expect(searchPersistence.providers.save).not.toHaveBeenCalled()
})

it('shows persistence failure with retry while retaining the query and existing selections', async () => {
  releaseSettingsStorePersistence(searchPersistence)
  const write = jest.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined)
  searchPersistence = { ...searchPersistence, search: createSettingsSearchPersistence({ read: async () => null, write }) }
  bindSettingsStorePersistence(searchPersistence)
  const screen = await render(<SettingsNavigationContent />)
  await fireEvent.changeText(screen.getByLabelText('settings.search'), 'skills')
  expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed')
  expect(screen.getByLabelText('settings.search').props.value).toBe('skills')
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(write).toHaveBeenLastCalledWith({ schema: SETTINGS_SEARCH_SCHEMA, query: 'skills' })
  expect(searchPersistence.settings.save).not.toHaveBeenCalled()
  expect(searchPersistence.providers.save).not.toHaveBeenCalled()
})
