import React, { useEffect, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import HomeRoute from '../../app/index'
import SettingsRoute from '../../app/settings/index'
import SettingsCategoryRoute from '../../app/settings/category/[category]'
import PreferencesRoute from '../../app/settings/preferences'
import SystemSettingsRoute from '../../app/settings/system/[panel]'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import {
  bindSettingsStorePersistence,
  flushPersistedSettings,
  releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from '@/presentation/features/settings/settingsStorePersistenceCommand'
import { CANONICAL_THEME_IDS, type Settings } from '@/types/settingsContracts'
import type { AIProvider } from '@/types/providerContracts'
import { APPLICATION_DATA_STORAGE_KEYS } from './applicationDataRecords'
import { settingsStorePersistence } from './settingsStorePersistence'

type FixtureRoute = { pathname: string; params: Record<string, string>; key: number }
type FixtureHref = string | { pathname: string; params?: Record<string, string> }
type FixtureAction = { type: string; source?: string; target?: string }
type RemovalGuard = { blocked: boolean; handler: (event: { data: { action: FixtureAction } }) => void }
type StorageEvent = { kind: 'read' | 'write'; key: string; value?: string }

let mockRoute: FixtureRoute
let mockRouteChange: ((operation: 'push' | 'replace' | 'back', destination?: FixtureHref) => void) | undefined
let mockStackLength = 1
const mockPush = jest.fn((destination: FixtureHref) => mockRouteChange?.('push', destination))
const mockReplace = jest.fn((destination: FixtureHref) => mockRouteChange?.('replace', destination))
const mockBack = jest.fn(() => mockRouteChange?.('back'))
const mockDispatch = jest.fn((action: FixtureAction) => {
  if (action.type === 'GO_BACK') mockRouteChange?.('back')
})
const mockRemovalGuards = new Map<string, RemovalGuard>()
const mockNavigationEvents = new Map<string, Set<() => void>>()
const mockNavigation = {
  dispatch: mockDispatch,
  getState: () => ({ index: mockStackLength - 1 }),
  addListener(name: string, listener: () => void) {
    const listeners = mockNavigationEvents.get(name) ?? new Set<() => void>()
    listeners.add(listener)
    mockNavigationEvents.set(name, listeners)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) mockNavigationEvents.delete(name)
    }
  },
}
const mockDeniedEffect = jest.fn((..._args: unknown[]) => {
  throw new Error('Execution, supplier requests, native file transfer and publication are forbidden in this fixture')
})
function mockTranslate(key: string, values?: Record<string, unknown>) {
  const suffix = values?.title ?? values?.name ?? values?.count
  return suffix === undefined ? key : `${key}:${suffix}`
}
jest.mock('expo-router', () => ({
  usePathname: () => mockRoute.pathname,
  useLocalSearchParams: () => mockRoute.params,
  useNavigation: () => mockNavigation,
  router: {
    push: (destination: FixtureHref) => mockPush(destination),
    replace: (destination: FixtureHref) => mockReplace(destination),
    back: () => mockBack(),
    canGoBack: () => mockStackLength > 1,
  },
}))
jest.mock('expo-router/react-navigation', () => ({
  NavigationContext: require('react').createContext(null),
  useIsFocused: () => true,
  usePreventRemove: (blocked: boolean, handler: RemovalGuard['handler']) => {
    const ReactRuntime = require('react') as typeof React
    const id = ReactRuntime.useId()
    ReactRuntime.useEffect(() => {
      mockRemovalGuards.set(id, { blocked, handler })
      return () => { mockRemovalGuards.delete(id) }
    }, [id, blocked, handler])
  },
}))
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate, i18n: { language: 'en' } }),
}))
jest.mock('@/i18n/service', () => ({
  ...jest.requireActual('@/i18n/service'), st: mockTranslate,
}))
jest.mock('@/i18n', () => ({ changeAppLanguage: (...args: unknown[]) => mockDeniedEffect(...args) }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  SafeAreaView: require('react-native').View,
}))
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 360, height: 640, fontScale: 1.6, scale: 1 }),
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('moti', () => ({
  MotiView: require('react-native').View, AnimatePresence: require('react').Fragment,
}))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/settings/SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationIcon', () => ({ AnimatedNavigationIcon: () => null }))
jest.mock('@/platform/native/restoreAccessibilityFocus', () => ({
  restoreAccessibilityFocus: jest.fn(() => () => undefined),
}))
jest.mock('@/components/chat/ChatWorkspace', () => ({
  ChatWorkspace: ({ onSettings }: { onSettings?: () => void }) => {
    const ReactRuntime = require('react') as typeof React
    const { View, Pressable, Text } = require('react-native') as typeof import('react-native')
    return ReactRuntime.createElement(View, { testID: 'fixture-home-chat-port' },
      ReactRuntime.createElement(Pressable, {
        accessibilityRole: 'button', accessibilityLabel: 'Fixture open settings', onPress: onSettings,
      }, ReactRuntime.createElement(Text, null, 'Fixture open settings')))
  },
}))
jest.mock('@/components/main/ConversationsScreenContent', () => ({
  ConversationsScreenContent: () => null,
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(async () => undefined) },
}))
jest.mock('./providerRuntime', () => ({
  generateProviderText: (...args: unknown[]) => mockDeniedEffect(...args),
  embedProviderText: (...args: unknown[]) => mockDeniedEffect(...args),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
  getRuntimeLogPath: () => 'file:///fixture-owned-route-evidence/runtime.log',
}))
jest.mock('@/platform/native/appDistribution', () => ({
  isGooglePlayDistribution: () => false,
  openGooglePlayListing: (...args: unknown[]) => mockDeniedEffect(...args),
}))
jest.mock('@/presentation/features/settings/portableDataCommand', () => ({
  clearPortableApplicationData: (...args: unknown[]) => mockDeniedEffect(...args),
  exportPortableDataToJsonFile: (...args: unknown[]) => mockDeniedEffect(...args),
  importPortableDataFromJsonFile: (...args: unknown[]) => mockDeniedEffect(...args),
}))

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const initial = useSettingsStore.getState()
const originalOS = Object.getOwnPropertyDescriptor(Platform, 'OS')!
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
const records = new Map<string, string>()
const storageEvents: StorageEvent[] = []
const hooks: {
  read?: (key: string) => Promise<string | null | undefined>
  beforeWrite?: (key: string, value: string) => Promise<void>
} = {}
const provider: AIProvider = {
  id: 'saved-provider', name: 'Saved provider', type: 'openai-compatible',
  enabled: false, apiKey: '', presetId: 'custom-endpoint',
  baseUrl: 'https://route-fixture.invalid/v1', wireProtocol: 'openai-compatible',
  models: ['saved-model'], manualModels: ['saved-model'],
  modelAliases: [{ alias: 'saved-alias', model: 'saved-model' }],
}
let activePersistence: SettingsStorePersistence
let originalSettings: Settings
let originalSettingsRecord: string
let originalProvidersRecord: string
let originalProvidersSnapshot: string
let routeSequence = 0
const browser = new EventTarget()
const browserNavigation = Object.assign(new EventTarget(), {
  traverseTo: jest.fn(() => ({ finished: Promise.resolve() })),
})
Object.defineProperty(browser, 'navigation', { configurable: true, value: browserNavigation })
const mockBlur = jest.fn()

function freshSearchPersistence() {
  // Re-evaluate the unchanged bootstrap factory without replacing React or its hooks.
  const filename = require('node:path').join(__dirname, 'settingsSearchPersistence.ts')
  const { transformTypeScriptModule } = require('../../scripts/node-ts-support')
  const output = { exports: {} as typeof import('./settingsSearchPersistence') }
  new Function('require', 'module', 'exports', transformTypeScriptModule(
    require('node:fs').readFileSync(filename, 'utf8'), filename,
  ))(require, output, output.exports)
  if (activePersistence) releaseSettingsStorePersistence(activePersistence)
  activePersistence = { ...settingsStorePersistence, search: output.exports.settingsSearchPersistence }
  bindSettingsStorePersistence(activePersistence)
}
function route(destination: FixtureHref): FixtureRoute {
  return typeof destination === 'string'
    ? { pathname: destination, params: {}, key: ++routeSequence }
    : { pathname: destination.pathname, params: destination.params ?? {}, key: ++routeSequence }
}
function FixtureRouteHost({ initialRoute }: { initialRoute: FixtureHref }) {
  const [stack, setStack] = useState(() => [route(initialRoute)])
  mockRoute = stack[stack.length - 1]
  mockStackLength = stack.length
  useEffect(() => {
    const change = (operation: 'push' | 'replace' | 'back', destination?: FixtureHref) => {
      setStack(current => operation === 'back' ? current.slice(0, Math.max(1, current.length - 1))
        : operation === 'replace' ? [...current.slice(0, -1), route(destination!)]
          : [...current, route(destination!)])
    }
    mockRouteChange = change
    return () => { if (mockRouteChange === change) mockRouteChange = undefined }
  }, [])
  const current = mockRoute
  if (current.pathname === '/') return <HomeRoute key={current.key} />
  if (current.pathname === '/settings') return <SettingsRoute key={current.key} />
  if (current.pathname.startsWith('/settings/category/')) return <SettingsCategoryRoute key={current.key} />
  if (current.pathname === '/settings/preferences') return <PreferencesRoute key={current.key} />
  if (current.pathname.startsWith('/settings/system/')) return <SystemSettingsRoute key={current.key} />
  throw new Error(`Unexpected route admission: ${current.pathname}`)
}
type Screen = Awaited<ReturnType<typeof screen>>
function screen(initialRoute: FixtureHref = '/settings') {
  return render(<IsleThemeProvider><IsleDialogProvider>
    <FixtureRouteHost initialRoute={initialRoute} />
  </IsleDialogProvider></IsleThemeProvider>)
}
async function appeared(view: Screen) {
  await act(() => { for (const listener of mockNavigationEvents.get('transitionEnd') ?? []) listener() })
  return view
}
async function rootReady(view: Screen) {
  await waitFor(() => expect(view.getByLabelText('settings.search')).toBeTruthy())
  await waitFor(() => expect(activePersistence.search!.getSnapshot().hydrated).toBe(true))
}
async function searchFor(view: Screen, query: string, result = 'temperature') {
  await fireEvent.changeText(view.getByLabelText('settings.search'), query)
  await waitFor(() => expect(view.getByTestId(`settings-result-${result}`)).toBeTruthy())
}
async function preferences(view: Screen) {
  await rootReady(view)
  await searchFor(view, 'temperature')
  await fireEvent.press(view.getByTestId('settings-result-temperature'))
  await waitFor(() => expect(view.getByTestId('preference-generation-fields')).toBeTruthy())
  await appeared(view)
  expect(mockRoute.pathname).toBe('/settings/preferences')
  expect(mockRoute.params.section).toBe('generation-temperature')
}
function temperatureInput(view: Screen) {
  const inputs = view.getAllByLabelText('chat.temperature')
    .filter(node => typeof node.props.onChangeText === 'function')
  expect(inputs).toHaveLength(1)
  return inputs[0]
}
function dialog(view: Screen) {
  return within(view.getByTestId(/^(?:dialog-experience-|animal-island-dialog-panel$)/))
}
async function backButton(view: Screen) {
  await fireEvent.press(view.getByRole('button', { name: 'common.back' }))
}
async function removeRoute(action: FixtureAction = { type: 'GO_BACK', source: 'fixture-child' }) {
  await act(() => {
    const blocked = [...mockRemovalGuards.values()].filter(guard => guard.blocked)
    if (blocked.length) blocked[blocked.length - 1].handler({ data: { action } })
    else mockDispatch(action)
  })
}
function writes(key: string) {
  return storageEvents.filter(event => event.kind === 'write' && event.key === key)
}
function savedSearch() {
  const raw = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)
  return raw === undefined ? undefined : JSON.parse(raw)
}
function assertChoicesRetained() {
  expect(useSettingsStore.getState().settings).toMatchObject({
    defaultProvider: provider.id,
    lastPreferredModel: { providerId: provider.id, model: 'saved-alias' },
    memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false, skillsEnabled: false, webSearchEnabled: false,
  })
  expect(useSettingsStore.getState().providers).toMatchObject([provider])
  expect(JSON.stringify(useSettingsStore.getState().providers)).toBe(originalProvidersSnapshot)
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(originalProvidersRecord)
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled()
  expect(mockDeniedEffect).not.toHaveBeenCalled()
}
function assertNoExecutionSettingsWrites() {
  assertChoicesRetained()
  expect(useSettingsStore.getState().settings).toBe(originalSettings)
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(originalSettingsRecord)
  expect(writes(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toEqual([])
  expect(writes(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toEqual([])
}
beforeEach(async () => {
  jest.clearAllMocks()
  records.clear()
  storageEvents.length = 0
  delete hooks.read
  delete hooks.beforeWrite
  mockRouteChange = undefined
  mockRoute = route('/settings')
  mockStackLength = 1
  mockRemovalGuards.clear()
  mockNavigationEvents.clear()
  Object.defineProperty(Platform, 'OS', { configurable: true, value: originalOS.value })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { body: {}, activeElement: { blur: mockBlur } },
  })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: mockDeniedEffect })
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => {
    storageEvents.push({ kind: 'read', key })
    const overridden = await hooks.read?.(key)
    return overridden === undefined ? records.get(key) ?? null : overridden
  })
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    await hooks.beforeWrite?.(key, value)
    storageEvents.push({ kind: 'write', key, value })
    records.set(key, value)
  })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null)
  originalSettingsRecord = JSON.stringify({
    ...initial.settings, themeId: 'minimal', theme: 'light', language: 'en', hapticsEnabled: false,
    defaultProvider: provider.id, providerAllowlist: ['legacy-*'],
    lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: provider.id, model: 'saved-alias' },
    memoryEnabled: false, knowledgeEnabled: false, mcpEnabled: false, skillsEnabled: false, webSearchEnabled: false,
    defaultTemperature: 0.4,
  })
  originalProvidersRecord = JSON.stringify([provider])
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, originalSettingsRecord)
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, originalProvidersRecord)
  records.set('@islemind/language-source', 'user')
  freshSearchPersistence()
  await useSettingsStore.getState().load()
  await flushPersistedSettings()
  await useSettingsStore.getState().flushProviderPersistence()
  originalSettings = useSettingsStore.getState().settings
  originalSettingsRecord = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!
  originalProvidersRecord = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)!
  originalProvidersSnapshot = JSON.stringify(useSettingsStore.getState().providers)
  storageEvents.length = 0
})
afterEach(async () => {
  delete hooks.read
  delete hooks.beforeWrite
  await flushPersistedSettings().catch(() => undefined)
  await useSettingsStore.getState().flushProviderPersistence()
  assertChoicesRetained()
  expect(AsyncStorage.clear).not.toHaveBeenCalled()
  expect(AsyncStorage.multiRemove).not.toHaveBeenCalled()
  releaseSettingsStorePersistence(activePersistence)
  useSettingsStore.setState(initial, true)
  Object.defineProperty(Platform, 'OS', originalOS)
  for (const [name, descriptor] of [
    ['window', originalWindow], ['document', originalDocument], ['fetch', originalFetch],
  ] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
  jest.restoreAllMocks()
})

it('mounts the actual settings entry route, pager and lazy navigation without replacing a saved disabled provider or model alias', async () => {
  const view = await screen()
  await rootReady(view)
  expect(view.getByTestId('settings-entry-providers')).toBeTruthy()
  expect(view.getByTestId('settings-entry-agents')).toBeTruthy()
  expect(view.getByTestId('settings-entry-knowledge')).toBeTruthy()
  expect(view.queryByText(provider.name)).toBeNull()
  expect(view.queryByText('saved-alias')).toBeNull()
  assertNoExecutionSettingsWrites()
})

it('reaches actual lazy settings from the root pager and retains its exact search across internal home and settings traversal', async () => {
  const view = await screen('/')
  await fireEvent.press(view.getByRole('button', { name: 'Fixture open settings' }))
  await rootReady(view)
  await searchFor(view, '  temperature  ')
  expect(savedSearch()).toEqual({ schema: 'islemind.settings-search.v1', query: '  temperature  ' })
  await fireEvent.press(view.getByRole('button', { name: 'common.backToChat' }))
  await fireEvent.press(view.getByRole('button', { name: 'Fixture open settings' }))
  expect(view.getByLabelText('settings.search').props.value).toBe('  temperature  ')
  expect(view.getByTestId('settings-result-temperature')).toBeTruthy()
  expect(mockPush).not.toHaveBeenCalled()
  expect(mockReplace).not.toHaveBeenCalled()
  assertNoExecutionSettingsWrites()
})

it('opens the actual lazy preference child from root search with its exact field and return intent without writing settings', async () => {
  const view = await screen()
  await preferences(view)
  expect(view.getByTestId('settings-section-generation-temperature')).toBeTruthy()
  expect(temperatureInput(view).props.value).toBe('0.4')
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: '/settings/preferences',
    params: { section: 'generation-temperature', locate: expect.any(String), returnTo: 'settings' },
  })
  assertNoExecutionSettingsWrites()
})

it('saves an actual searched numeric draft through strict JSON persistence and reopens the same field after fresh search and settings hydration', async () => {
  const view = await screen()
  await preferences(view)
  await fireEvent.changeText(temperatureInput(view), '0.7')
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(originalSettingsRecord)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(view.getByText('settingsWorkspace.saved')).toBeTruthy())
  expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)).toMatchObject({ defaultTemperature: 0.7 })
  await backButton(view)
  await rootReady(view)
  expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
  await view.unmount()
  freshSearchPersistence()
  useSettingsStore.setState({ settings: initial.settings, providers: [] })
  await useSettingsStore.getState().load()
  const reloaded = await screen()
  await preferences(reloaded)
  expect(temperatureInput(reloaded).props.value).toBe('0.7')
  expect(reloaded.queryByRole('button', { name: 'settingsWorkspace.save' })).toBeNull()
  assertChoicesRetained()
})

it('keeps and then explicitly discards the actual child draft through page back without changing its saved value or root query', async () => {
  const view = await screen()
  await preferences(view)
  await fireEvent.changeText(temperatureInput(view), '0.8')
  await backButton(view)
  await waitFor(() => expect(view.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialog(view).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
  expect(mockRoute.pathname).toBe('/settings/preferences')
  expect(temperatureInput(view).props.value).toBe('0.8')
  expect(mockBack).not.toHaveBeenCalled()
  await backButton(view)
  await fireEvent.press(dialog(view).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await rootReady(view)
  expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
  assertNoExecutionSettingsWrites()
})

it('invalidates an actual searched-child discard approval after its draft changes and is restored during the shared dialog', async () => {
  const view = await screen()
  await preferences(view)
  await fireEvent.changeText(temperatureInput(view), '0.8')
  await backButton(view)
  await waitFor(() => expect(view.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.changeText(temperatureInput(view), '0.9')
  await fireEvent.changeText(temperatureInput(view), '0.8')
  await fireEvent.press(dialog(view).getByRole('button', { name: 'settingsWorkspace.discard' }))
  expect(mockRoute.pathname).toBe('/settings/preferences')
  expect(temperatureInput(view).props.value).toBe('0.8')
  expect(mockBack).not.toHaveBeenCalled()
  assertNoExecutionSettingsWrites()
})

it('replays only the actual reviewed route-removal action after explicit child draft discard', async () => {
  const view = await screen()
  await preferences(view)
  await fireEvent.changeText(temperatureInput(view), '0.6')
  const action = { type: 'GO_BACK', source: 'fixture-searched-child', target: 'fixture-settings-stack' }
  await removeRoute(action)
  await waitFor(() => expect(view.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  expect(mockDispatch).not.toHaveBeenCalled()
  await fireEvent.press(dialog(view).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await rootReady(view)
  expect(mockDispatch).toHaveBeenCalledTimes(1)
  expect(mockDispatch).toHaveBeenCalledWith(action)
  expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
  assertNoExecutionSettingsWrites()
})

it('retains an actual failed child save as a retryable draft without falsely changing the durable searched field', async () => {
  const view = await screen()
  await preferences(view)
  let fail = true
  hooks.beforeWrite = async key => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS && fail) { fail = false; throw new Error('Owned settings write unavailable') }
  }
  await fireEvent.changeText(temperatureInput(view), '0.6')
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  const field = within(view.getByTestId('settings-section-generation-temperature'))
  await waitFor(() => expect(field.getByText('settingsWorkspace.saveFailed')).toBeTruthy())
  expect(temperatureInput(view).props.value).toBe('0.6')
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(originalSettingsRecord)
  expect(view.queryByText('settingsWorkspace.saved')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
  await waitFor(() => expect(field.queryByText('settingsWorkspace.saveFailed')).toBeNull())
  await waitFor(() => expect(view.queryByRole('button', { name: 'settingsWorkspace.save' })).toBeNull())
  expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)).toMatchObject({ defaultTemperature: 0.6 })
  await backButton(view)
  await rootReady(view)
  assertChoicesRetained()
})

it('blocks actual child back and route removal until its admitted strict settings write naturally settles', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const view = await screen()
  await preferences(view)
  hooks.beforeWrite = async key => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS) { entered.resolve(); await release.promise }
  }
  try {
    await fireEvent.changeText(temperatureInput(view), '0.6')
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
    await entered.promise
    expect(view.getByRole('button', { name: 'settingsWorkspace.saving' })).toBeDisabled()
    await backButton(view)
    await removeRoute()
    expect(mockBack).not.toHaveBeenCalled()
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(view.queryByText('settingsWorkspace.discardTitle')).toBeNull()
    expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(originalSettingsRecord)
    release.resolve()
    await waitFor(() => expect(view.queryByRole('button', { name: 'settingsWorkspace.saving' })).toBeNull())
    await backButton(view)
    await rootReady(view)
    expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)).toMatchObject({ defaultTemperature: 0.6 })
  } finally { release.resolve(); await flushPersistedSettings().catch(() => undefined) }
})

it('retains a naturally committed actual child write after unmount without replaying stale removal or claiming rollback', async () => {
  const entered = deferred<void>()
  const release = deferred<void>()
  const view = await screen()
  await preferences(view)
  hooks.beforeWrite = async key => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS) { entered.resolve(); await release.promise }
  }
  try {
    await fireEvent.changeText(temperatureInput(view), '0.9')
    await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.save' }))
    await entered.promise
    await view.unmount()
    release.resolve()
    await flushPersistedSettings()
    expect(JSON.parse(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!)).toMatchObject({ defaultTemperature: 0.9 })
    expect(mockDispatch).not.toHaveBeenCalled()
    expect(mockBack).not.toHaveBeenCalled()
    expect(mockRemovalGuards.size).toBe(0)
  } finally { release.resolve(); await flushPersistedSettings().catch(() => undefined) }
})

it('mounts the actual legacy category route and page shell with a root query that still discovers a field outside that category', async () => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH, JSON.stringify({
    schema: 'islemind.settings-search.v1', query: 'temperature',
  }))
  const view = await screen({
    pathname: '/settings/category/privacy', params: { category: 'privacy', returnTo: 'settings' },
  })
  await rootReady(view)
  await appeared(view)
  expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
  await waitFor(() => expect(view.getByTestId('settings-result-temperature')).toBeTruthy())
  await fireEvent.press(view.getByTestId('settings-result-temperature'))
  await waitFor(() => expect(temperatureInput(view)).toBeTruthy())
  await appeared(view)
  expect(mockRoute.pathname).toBe('/settings/preferences')
  await backButton(view)
  await rootReady(view)
  expect(mockRoute.pathname).toBe('/settings/category/privacy')
  expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
  assertNoExecutionSettingsWrites()
})

it('falls back through the actual invalid legacy route without loading or rewriting saved search or execution settings', async () => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH, JSON.stringify({
    schema: 'islemind.settings-search.v1', query: 'Retained invalid-category query',
  }))
  const before = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)
  const view = await screen({ pathname: '/settings/category/invalid', params: { category: 'invalid' } })
  await appeared(view)
  expect(view.getByText('settings.controlSearchEmpty')).toBeTruthy()
  expect(view.queryByLabelText('settings.search')).toBeNull()
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)).toBe(before)
  expect(storageEvents.some(event => event.key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)).toBe(false)
  assertNoExecutionSettingsWrites()
})

it('clears actual root search durably and does not resurrect it in the real legacy route after fresh bootstrap reconstruction', async () => {
  const view = await screen()
  await rootReady(view)
  await searchFor(view, 'temperature')
  await fireEvent.press(view.getByLabelText('common.clearSearch'))
  await waitFor(() => expect(savedSearch()).toEqual({ schema: 'islemind.settings-search.v1', query: '' }))
  await view.unmount()
  freshSearchPersistence()
  const legacy = await screen({ pathname: '/settings/category/privacy', params: { category: 'privacy' } })
  await rootReady(legacy)
  expect(legacy.getByLabelText('settings.search').props.value).toBe('')
  expect(legacy.queryByTestId('settings-result-temperature')).toBeNull()
  assertNoExecutionSettingsWrites()
})

it('reports an actual root-search read failure and retries only its isolated JSON record without writing settings or providers', async () => {
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH, JSON.stringify({
    schema: 'islemind.settings-search.v1', query: 'temperature',
  }))
  let fail = true
  hooks.read = async key => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH && fail) { fail = false; throw new Error('Owned search read unavailable') }
    return undefined
  }
  const view = await screen()
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('settingsSubsystem.loadFailed'))
  expect(view.getByLabelText('settings.search').props.value).toBe('')
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  await rootReady(view)
  await waitFor(() => expect(view.getByTestId('settings-result-temperature')).toBeTruthy())
  expect(writes(APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH)).toEqual([])
  assertNoExecutionSettingsWrites()
})

it('shows actual legacy-search write failure and retries the same isolated query without recreating the route or its settings', async () => {
  let fail = true
  hooks.beforeWrite = async key => {
    if (key === APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH && fail) { fail = false; throw new Error('Owned search write unavailable') }
  }
  const view = await screen({ pathname: '/settings/category/privacy', params: { category: 'privacy' } })
  await rootReady(view)
  const key = mockRoute.key
  await searchFor(view, 'temperature')
  await waitFor(() => expect(view.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
  expect(savedSearch()).toBeUndefined()
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(view.queryByRole('alert')).toBeNull())
  expect(savedSearch()).toEqual({ schema: 'islemind.settings-search.v1', query: 'temperature' })
  expect(mockRoute.key).toBe(key)
  assertNoExecutionSettingsWrites()
})

it('never replaces actual root typing with a delayed older search hydration', async () => {
  const entered = deferred<void>()
  const release = deferred<string | null>()
  hooks.read = async key => {
    if (key !== APPLICATION_DATA_STORAGE_KEYS.SETTINGS_SEARCH) return undefined
    entered.resolve()
    return release.promise
  }
  const view = await screen()
  try {
    await entered.promise
    await searchFor(view, 'temperature')
    release.resolve(JSON.stringify({ schema: 'islemind.settings-search.v1', query: 'Older memory query' }))
    await activePersistence.search!.load()
    expect(view.getByLabelText('settings.search').props.value).toBe('temperature')
    expect(savedSearch()).toEqual({ schema: 'islemind.settings-search.v1', query: 'temperature' })
    assertNoExecutionSettingsWrites()
  } finally { release.resolve(null); await activePersistence.search!.load().catch(() => undefined) }
})

it('isolates actual search typing and hydration from store subscribers and the configured provider catalog', async () => {
  const subscriber = jest.fn()
  const release = useSettingsStore.subscribe(subscriber)
  try {
    const view = await screen()
    await rootReady(view)
    await searchFor(view, 'temperature')
    await fireEvent.changeText(view.getByLabelText('settings.search'), 'memory')
    await waitFor(() => expect(savedSearch()?.query).toBe('memory'))
    expect(subscriber).not.toHaveBeenCalled()
    assertNoExecutionSettingsWrites()
  } finally { release() }
})

it('issues fresh actual locate identities when reopening the same searched field after returning to root', async () => {
  const view = await screen()
  await preferences(view)
  const first = mockRoute.params.locate
  await backButton(view)
  await rootReady(view)
  await fireEvent.press(view.getByTestId('settings-result-temperature'))
  await waitFor(() => expect(temperatureInput(view)).toBeTruthy())
  await appeared(view)
  expect(mockRoute.params.section).toBe('generation-temperature')
  expect(mockRoute.params.locate).not.toBe(first)
  expect(mockRoute.params.returnTo).toBe('settings')
  assertNoExecutionSettingsWrites()
})

describe.each(CANONICAL_THEME_IDS)('actual %s root and legacy route host controls', family => {
  it.each(['light', 'dark'] as const)('preserves %s query, real lazy child draft and shared dialog at substituted small-screen large-font no-motion metrics', async theme => {
    useSettingsStore.setState({ settings: { ...originalSettings, themeId: family, theme } })
    originalSettings = useSettingsStore.getState().settings
    originalSettingsRecord = JSON.stringify(originalSettings)
    records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, originalSettingsRecord)
    const view = await screen()
    await preferences(view)
    await fireEvent.changeText(temperatureInput(view), '0.6')
    await backButton(view)
    await waitFor(() => expect(view.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
    await fireEvent.press(dialog(view).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
    expect(temperatureInput(view).props.value).toBe('0.6')
    await backButton(view)
    await fireEvent.press(dialog(view).getByRole('button', { name: 'settingsWorkspace.discard' }))
    await rootReady(view)
    await view.unmount()
    freshSearchPersistence()
    const legacy = await screen({ pathname: '/settings/category/privacy', params: { category: 'privacy' } })
    await rootReady(legacy)
    await waitFor(() => expect(legacy.getByTestId('settings-result-temperature')).toBeTruthy())
    expect(legacy.getByLabelText('settings.search').props.value).toBe('temperature')
    assertNoExecutionSettingsWrites()
  })
})
