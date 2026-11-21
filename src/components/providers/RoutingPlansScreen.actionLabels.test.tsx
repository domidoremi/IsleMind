import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import { RoutingPlansContent } from '@/components/providers/RoutingPlansScreen'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'

let mockLanguage = 'zh-CN'
jest.mock('react-i18next', () => ({ useTranslation: () => {
  const actual = jest.requireActual('i18next')
  const instance = (actual.default ?? actual).createInstance()
  void instance.init({ lng: mockLanguage, fallbackLng: false, initAsync: false, resources: {
    'zh-CN': { translation: require('@/i18n/resources/zh-CN.json') },
    en: { translation: require('@/i18n/resources/en.json') },
    ja: { translation: require('@/i18n/resources/ja.json') },
  } })
  return { t: instance.t.bind(instance) }
} }))
const mockConfirm = jest.fn(async () => false)
jest.mock('expo-router', () => ({
  router: { canGoBack: () => false, replace: jest.fn(), push: jest.fn(), dismissTo: jest.fn() },
  useNavigationContainerRef: () => ({ getRootState: () => undefined }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
}))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children, title, onBack }: any) => {
  const { View, Pressable, Text } = jest.requireActual('react-native')
  return <View><Text accessibilityRole="header">{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="common.back" onPress={onBack} />{children}</View>
} }))
jest.mock('@/hooks/useAppUpdateBlocker', () => ({ useAppUpdateBlocker: () => undefined }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/PageFeedback', () => ({ PageFeedbackBoundary: ({ children }: any) => children }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text, TextInput } = jest.requireActual('react-native')
  return { useIsleDialog: () => ({ confirm: mockConfirm }), IslePressable: MockPressable, IsleButton: ({ label, accessibilityLabel, onPress, disabled, testID }: { label: string; accessibilityLabel?: string; onPress: () => void; disabled?: boolean; testID?: string }) =>
    <MockPressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} testID={testID}><Text>{label}</Text></MockPressable>,
    IsleInput: ({ inputStyle, ...props }: any) => <TextInput {...props} style={inputStyle} /> }
})
jest.mock('@/presentation/layout/WorkspaceSurface', () => ({ WorkspaceSurface: ({ children, role, ...props }: any) => {
  const { View } = jest.requireActual('react-native')
  return <View {...props}>{children}</View>
} }))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({ providerModelAvailabilityRuntime: {}, withProviderModelAvailabilityChanges: async (_ids: string[], mutate: () => Promise<unknown>) => mutate() }))
const initial = useSettingsStore.getState()
const providers: AIProvider[] = ['a', 'b'].map(id => ({ id, name: id, type: 'openai', enabled: true, apiKey: '', models: ['gpt-4o-mini'], manualModels: ['gpt-4o-mini'] }))
let save: jest.Mock
let persistence: SettingsStorePersistence
beforeEach(() => {
  jest.clearAllMocks()
  mockConfirm.mockReset().mockResolvedValue(false)
  save = jest.fn(async () => undefined)
  persistence = { settings: { load: async () => null, save }, providers: { load: async () => [], save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initial, providers, settings: { ...initial.settings, modelRoutingPlans: [] } }, true)
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initial, true)
  jest.restoreAllMocks()
})

jest.mock('@/components/settings/SettingsEditBoundary', () => ({
  SettingsEditBoundary: ({ children }: any) => children,
  useSettingsDraft: (_dirty: boolean, _busy: boolean, discard: () => void) => async (action: () => void) => { discard(); action() },
}))

const actionCases = [
  ['zh-CN', '编辑方案 1：Research', '编辑方案 2：Research', '删除方案 2：Changed second'],
  ['en', 'Edit route 1: Research', 'Edit route 2: Research', 'Delete route 2: Changed second'],
  ['ja', 'ルート1「Research」を編集', 'ルート2「Research」を編集', 'ルート2「Changed second」を削除'],
] as const

it.each(actionCases)('identifies duplicate route names and keeps edit/delete ownership in %s', async (language, firstEdit, secondEdit, secondDelete) => {
  mockLanguage = language
  const plans = ['a', 'b'].map(id => ({ schema: 'islemind.model-routing-plan.v1' as const,
    id: 'route-' + id, name: 'Research', mode: 'fixed' as const,
    primary: { providerId: id, model: 'gpt-4o-mini' }, crossProvider: 'ask' as const }))
  useSettingsStore.setState({ settings: { ...initial.settings, modelRoutingPlans: plans } })
  const view = await render(<RoutingPlansContent />)
  expect(view.getByLabelText(firstEdit)).toBeTruthy()
  expect(view.getByLabelText(secondEdit)).toBeTruthy()
  expect(view.getByTestId('routing-edit-route-a')).toBeTruthy()
  expect(view.getByTestId('routing-edit-route-b')).toBeTruthy()
  await fireEvent.press(view.getByLabelText(secondEdit))
  await fireEvent.changeText(view.getByTestId('routing-name'), 'Changed second')
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  expect(useSettingsStore.getState().settings.modelRoutingPlans?.map(plan => plan.name)).toEqual(['Research', 'Changed second'])
  expect(view.getByLabelText(firstEdit)).toBeTruthy()
  expect(view.getByTestId('routing-delete-route-b')).toBeTruthy()
  await fireEvent.press(view.getByLabelText(secondDelete))
  await waitFor(() => expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([plans[0]]))
  expect(view.getByLabelText(firstEdit)).toBeTruthy()
  expect(view.queryByTestId('routing-saved-route-b')).toBeNull()
})
