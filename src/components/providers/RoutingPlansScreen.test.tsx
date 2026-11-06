import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { RoutingPlansContent } from './RoutingPlansScreen'
import { useSettingsStore } from '@/store/settingsStore'
import type { AIProvider } from '@/types/providerContracts'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ router: { canGoBack: () => false, replace: jest.fn() } }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/presentation/app-shell/ThemeDetailFrame', () => ({ ThemeDetailFrame: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/components/settings/SettingsEditBoundary', () => ({ useSettingsDraft: () => undefined, SettingsEditBoundary: ({ children }: { children: React.ReactNode }) => children }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/PageFeedback', () => ({ PageFeedbackBoundary: ({ children }: any) => children }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text, TextInput } = jest.requireActual('react-native')
  return { IslePressable: MockPressable, IsleButton: ({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) =>
    <MockPressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} testID={testID}><Text>{label}</Text></MockPressable>,
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
  save = jest.fn(async () => undefined)
  persistence = { settings: { load: async () => null, save }, providers: { load: async () => [], save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initial, providers, settings: { ...initial.settings, modelRoutingPlans: [] } }, true)
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initial, true)
})
async function fill(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByTestId('routing-add'))
  await fireEvent.changeText(view.getByTestId('routing-name'), 'Research')
  await fireEvent.press(view.getByTestId('routing-choose-primary'))
  await fireEvent.press(view.getByTestId('routing-target-a-gpt-4o-mini'))
  await fireEvent.press(view.getByTestId('routing-choose-backup'))
  await fireEvent.press(view.getByTestId('routing-target-b-gpt-4o-mini'))
}

it('opens an exact referenced template once and retains a changed draft after unrelated settings updates', async () => {
  await useSettingsStore.getState().saveRoutingPlan({ schema: 'islemind.model-routing-plan.v1', id: 'reference-target',
    name: 'Exact route', mode: 'fixed', primary: { providerId: 'a', model: 'gpt-4o-mini' }, crossProvider: 'ask' })
  const view = await render(<RoutingPlansContent planId="reference-target" />)
  expect(view.getByTestId('routing-name').props.value).toBe('Exact route')
  await fireEvent.changeText(view.getByTestId('routing-name'), 'Unsaved changes')
  await act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, theme: 'dark' } })))
  expect(view.getByTestId('routing-name').props.value).toBe('Unsaved changes')
})

it('reports a deleted reference without creating an unrelated new template', async () => {
  const view = await render(<RoutingPlansContent planId="already-deleted" />)
  expect(view.getByText('connectionReferences.missing')).toBeTruthy()
  expect(view.queryByTestId('routing-editor')).toBeNull()
  expect(save).not.toHaveBeenCalled()
})

it('saves an explicit primary and backup, reloads it for editing, and defaults to asking across connections', async () => {
  const view = await render(<RoutingPlansContent />)
  await fill(view)
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  const plan = useSettingsStore.getState().settings.modelRoutingPlans![0]
  expect(plan).toMatchObject({ name: 'Research', mode: 'fallback', primary: { providerId: 'a', model: 'gpt-4o-mini' }, backup: { providerId: 'b', model: 'gpt-4o-mini' }, crossProvider: 'ask' })
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ modelRoutingPlans: [plan] }))
  await fireEvent.press(view.getByLabelText('common.edit'))
  expect(view.getByTestId('routing-name').props.value).toBe('Research')
  await fireEvent.press(view.getByText('routing.fixed'))
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  expect(useSettingsStore.getState().settings.modelRoutingPlans![0].backup).toBeUndefined()
})

it('keeps a failed save editable and permits a durable retry', async () => {
  const view = await render(<RoutingPlansContent />)
  await fill(view)
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await act(async () => { fireEvent.press(view.getByTestId('routing-save')) })
  await waitFor(() => expect(view.getByText('routing.saveFailed')).toBeTruthy())
  expect(view.getByTestId('routing-name').props.value).toBe('Research')
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toHaveLength(1)
})

it('blocks duplicate targets, preserves unsaved edits on cancel and retries deletion failure', async () => {
  const view = await render(<RoutingPlansContent />)
  await fill(view)
  await fireEvent.press(view.getByTestId('routing-choose-backup'))
  await fireEvent.press(view.getByTestId('routing-target-a-gpt-4o-mini'))
  await fireEvent.press(view.getByTestId('routing-save'))
  expect(save).not.toHaveBeenCalled()
  expect(view.getByText('routing.duplicateTarget')).toBeTruthy()
  await fireEvent.press(view.getByLabelText('common.cancel'))
  expect(view.getByText('routing.unsaved')).toBeTruthy()
  await fireEvent.press(view.getByText('routing.keepEditing'))
  expect(view.getByTestId('routing-name').props.value).toBe('Research')
  await fireEvent.press(view.getByText('routing.fixed'))
  await fireEvent.press(view.getByTestId('routing-save'))
  await waitFor(() => expect(view.queryByTestId('routing-editor')).toBeNull())
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByLabelText('common.delete'))
  await waitFor(() => expect(view.getByText('routing.saveFailed')).toBeTruthy())
  await fireEvent.press(view.getByLabelText('common.retry'))
  await waitFor(() => expect(view.queryByText('routing.saveFailed')).toBeNull())
  expect(useSettingsStore.getState().settings.modelRoutingPlans).toEqual([])
})
