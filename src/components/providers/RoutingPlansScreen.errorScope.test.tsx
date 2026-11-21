import { fireEvent, render, waitFor } from '@testing-library/react-native'
import { router } from 'expo-router'
import { RoutingPlansContent } from './RoutingPlansScreen'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
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
async function fill(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByTestId('routing-add'))
  await fireEvent.changeText(view.getByTestId('routing-name'), 'Research')
  await fireEvent.press(view.getByTestId('routing-choose-primary'))
  await fireEvent.press(view.getByTestId('routing-target-a-gpt-4o-mini'))
  await fireEvent.press(view.getByTestId('routing-choose-backup'))
  await fireEvent.press(view.getByTestId('routing-target-b-gpt-4o-mini'))
}

jest.mock('@/components/settings/SettingsEditBoundary', () => ({
  SettingsEditBoundary: ({ children }: any) => children,
  useSettingsDraft: (dirty: boolean, busy: boolean, discard: () => void) => async (action: () => void) => {
    if (!busy && (!dirty || await mockConfirm())) { discard(); action() }
  },
}))


it('dismisses a failed draft error only after discard approval while retaining the saved collection', async () => {
  const view = await render(<RoutingPlansContent />)
  await fill(view)
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.getByText('routing.saveFailed')).toBeTruthy())
  const draftInput = view.getByTestId('routing-name')
  await fireEvent.press(view.getByLabelText('common.cancel'))
  if (view.queryByText('routing.keepEditing')) await fireEvent.press(view.getByText('routing.keepEditing'))
  expect(view.getByTestId('routing-name')).toBe(draftInput)
  expect(draftInput.props.value).toBe('Research')
  expect(view.getByText('routing.saveFailed')).toBeTruthy()
  mockConfirm.mockResolvedValueOnce(true)
  await fireEvent.press(view.getByLabelText('common.cancel'))
  if (view.queryByText('routing.discard')) await fireEvent.press(view.getByText('routing.discard'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  expect(view.queryByText('routing.saveFailed')).toBeNull()
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([])
  expect(router.replace).not.toHaveBeenCalled()
})

it('closes an unchanged failed edit without showing its error on the saved list and preserves deletion retry', async () => {
  const view = await render(<RoutingPlansContent />)
  await fill(view)
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  const saved = useSettingsStore.getState().settings.modelRoutingPlans
  await fireEvent.press(view.getByLabelText('routing.editPlan'))
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.getByText('routing.saveFailed')).toBeTruthy())
  await fireEvent.press(view.getByLabelText('common.cancel'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(view.queryByText('routing.saveFailed')).toBeNull()
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual(saved)
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByLabelText('routing.deletePlan'))
  await waitFor(() => expect(view.getByText('routing.saveFailed')).toBeTruthy())
  expect(view.getByLabelText('common.retry')).toBeTruthy()
  await fireEvent.press(view.getByLabelText('common.retry'))
  await waitFor(() => expect(view.queryByText('routing.saveFailed')).toBeNull())
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([])
})
