import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { Platform } from 'react-native'
import { ScenePlansScreen } from './ScenePlansScreen'
import { SettingsEditBoundary } from '@/components/settings/SettingsEditBoundary'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import type { ScenePlan } from '@/core'
import type { ScenePlanCatalog, ScenePlanWorkspacePort } from './scenePlanWorkspacePort'
import {
  bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence,
  type SettingsStorePersistence,
} from './settingsStorePersistenceCommand'

const mockConfirm = jest.fn(async () => true)
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), dismissTo: jest.fn() },
  useNavigation: () => ({ dispatch: jest.fn() }),
  useNavigationContainerRef: () => ({ getRootState: () => undefined }),
}))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => undefined }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const state = jest.requireActual('@/store/settingsStore').useSettingsStore((value: typeof initialSettings) => value.settings)
  return { colors: jest.requireActual('@/theme/colors').getColors(state.theme === 'dark' ? 'dark' : 'light', state.themeId),
    canonicalThemeId: state.themeId }
} }))
jest.mock('@/hooks/useThemeMotion', () => ({ useThemeMotion: () => ({
  intensity: 'none', from: {}, animate: {}, transition: { duration: 0 },
}) }))
jest.mock('moti', () => ({ MotiView: jest.requireActual('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/settings/SettingsTaskWorkspace', () => ({
  SettingsTaskWorkspace: ({ tasks, value, onTaskChange, overview }: any) => {
    const { Pressable, View, Text } = jest.requireActual('react-native')
    const leave = jest.requireActual('@/components/settings/SettingsEditBoundary').useSettingsLeave()
    const current = tasks.find((task: any) => task.id === value)
    return <View>{current ? <>
      <Pressable testID="workspace-back" onPress={() => void leave(() => onTaskChange(undefined))}><Text>Back</Text></Pressable>
      {current.content}
    </> : <>
      {tasks.map((task: any) => <Pressable key={task.id} testID={`settings-task-${task.id}`}
        onPress={() => onTaskChange(task.id)}><Text>{task.title}</Text></Pressable>)}
      {overview}
    </>}</View>
  },
}))
jest.mock('@/presentation/layout/WorkspaceSurface', () => ({ WorkspaceSurface: ({ children, role, ...props }: any) => {
  const { View } = jest.requireActual('react-native')
  return <View {...props}>{children}</View>
} }))
jest.mock('@/components/ui/isle', () => {
  const React = jest.requireActual('react')
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native')
  return {
    IslePressable: Pressable, useIsleDialog: () => ({ confirm: mockConfirm }),
    IsleButton: ({ label, onPress, disabled, busy, testID, accessibilityLabel }: any) =>
      <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label} testID={testID}><Text>{label}</Text></Pressable>,
    IsleInput: ({ label, inputStyle, ...props }: any) => <TextInput {...props} style={inputStyle} />,
    IsleSelect: ({ options, value, onChange, testID, accessibilityLabel, disabled }: any) => {
      const [open, setOpen] = React.useState(false)
      return <View testID={testID}><Pressable accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'Select'} disabled={disabled} onPress={() => setOpen(!open)}>
        <Text>{options.find((option: any) => option.value === value)?.label ?? 'Select'}</Text>
      </Pressable>{open ? options.map((option: any) => <Pressable key={option.value}
        testID={`${testID}-option-${option.value}`} disabled={disabled}
        onPress={() => { onChange(option.value); setOpen(false) }}><Text>{option.label}</Text></Pressable>) : null}</View>
    },
  }
})
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityRuntime: {},
  withProviderModelAvailabilityChanges: async (_ids: string[], work: () => Promise<unknown>) => work(),
}))

const initialSettings = useSettingsStore.getState()
const initialChat = useChatStore.getState()
const initialPlatform = Platform.OS
const original: ScenePlan = {
  schema: 'islemind.scene-plan.v1', id: 'original-scene', name: 'Research', revision: 1,
  description: 'Original purpose', configuration: { systemPrompt: 'Original instructions', enabledTools: [] },
}
const catalog: ScenePlanCatalog = { tools: [], knowledge: [], skills: [], skillVariables: {} }
let persistence: SettingsStorePersistence
let save: jest.Mock
let port: ScenePlanWorkspacePort
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' })
  mockConfirm.mockReset().mockResolvedValue(true)
  save = jest.fn(async () => undefined)
  persistence = {
    settings: { load: async () => null, save },
    providers: { load: async () => [], save: async () => undefined },
  }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initialSettings, providers: [], settings: {
    ...initialSettings.settings, scenePlans: [original], theme: 'light', themeId: 'minimal',
  } }, true)
  useChatStore.setState({ ...initialChat, conversations: [], currentId: null }, true)
  port = {
    loadCatalog: jest.fn(async () => catalog), capture: jest.fn(async () => original.configuration),
    preview: jest.fn(), apply: jest.fn(),
  }
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initialSettings, true)
  useChatStore.setState(initialChat, true)
  Object.defineProperty(Platform, 'OS', { configurable: true, value: initialPlatform })
})
const screen = (props: Partial<Parameters<typeof ScenePlansScreen>[0]> = {}) =>
  render(<SettingsEditBoundary><ScenePlansScreen port={port} onOpenConversation={() => undefined} {...props} /></SettingsEditBoundary>)
async function openDraft(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByTestId('scene-edit-original-scene'))
  await fireEvent.changeText(view.getByTestId('scene-name'), 'Unpublished research')
  await fireEvent.changeText(view.getByTestId('scene-description'), 'Unpublished purpose')
}
async function failSave(view: Awaited<ReturnType<typeof render>>) {
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByTestId('scene-save'))
  await waitFor(() => expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.saveFailed'))
  expect(view.getByTestId('scene-save')).not.toBeDisabled()
}

it('keeps the failed draft and error when continuing, then retires both after confirmed cancel', async () => {
  const view = await screen()
  await openDraft(view)
  await failSave(view)
  mockConfirm.mockResolvedValueOnce(false)
  await fireEvent.press(view.getByText('common.cancel'))
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
  expect(view.getByTestId('scene-name').props.value).toBe('Unpublished research')
  expect(view.getByTestId('scene-description').props.value).toBe('Unpublished purpose')
  expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.saveFailed')
  await fireEvent.press(view.getByText('common.cancel'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(view.queryByTestId('scene-feedback')).toBeNull()
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([original])
})

it('retires the failed draft feedback after the workspace Back discard guard approves', async () => {
  const view = await screen()
  await openDraft(view)
  await failSave(view)
  mockConfirm.mockResolvedValueOnce(false)
  await fireEvent.press(view.getByTestId('workspace-back'))
  expect(view.getByTestId('scene-name').props.value).toBe('Unpublished research')
  expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.saveFailed')
  await fireEvent.press(view.getByTestId('workspace-back'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(view.queryByTestId('scene-feedback')).toBeNull()
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([original])
})

it('clears a failed unchanged editor when cancel closes it without a discard confirmation', async () => {
  const view = await screen()
  await fireEvent.press(view.getByTestId('scene-edit-original-scene'))
  await failSave(view)
  await fireEvent.press(view.getByText('common.cancel'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(view.queryByTestId('scene-feedback')).toBeNull()
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([original])
})

it('allows failed saves to retry and retains the resulting success notice after closing the draft', async () => {
  const view = await screen()
  await openDraft(view)
  await failSave(view)
  await fireEvent.press(view.getByTestId('scene-save'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.saved')
  expect(view.getByTestId('scene-feedback').props.accessibilityRole).not.toBe('alert')
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([{
    ...original, name: 'Unpublished research', description: 'Unpublished purpose', revision: 2,
  }])
})

it('retains failed deletion feedback for retry and keeps the successful deletion notice', async () => {
  const view = await screen()
  await fireEvent.press(view.getByTestId('scene-edit-original-scene'))
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByTestId('scene-delete'))
  await waitFor(() => expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.deleteFailed'))
  expect(view.getByTestId('scene-delete')).not.toBeDisabled()
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([original])
  await fireEvent.press(view.getByTestId('scene-delete'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.deleted')
  expect(view.getByTestId('scene-feedback').props.accessibilityRole).not.toBe('alert')
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([])
})

it('keeps a capture failure in the overview and exposes a working retry', async () => {
  ;(port.capture as jest.Mock).mockRejectedValueOnce(Error('capture unavailable'))
  const view = await screen({ conversationId: 'capture-source', captureOnOpen: true })
  await waitFor(() => expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.captureFailed'))
  expect(view.queryByTestId('scene-editor')).toBeNull()
  expect(view.getByText('common.retry')).toBeTruthy()
  await fireEvent.press(view.getByText('common.retry'))
  await waitFor(() => expect(view.getByTestId('scene-editor')).toBeTruthy())
  expect(view.queryByTestId('scene-feedback')).toBeNull()
  expect(port.capture).toHaveBeenCalledTimes(2)
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([original])
})

it('keeps a missing referenced plan error visible without requiring an editor', async () => {
  const view = await screen({ planId: 'missing-plan' })
  await waitFor(() => expect(view.getByTestId('scene-feedback')).toHaveTextContent('connectionReferences.missing'))
  expect(view.queryByTestId('scene-editor')).toBeNull()
  await act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, theme: 'dark' } })))
  expect(view.getByTestId('scene-feedback')).toHaveTextContent('connectionReferences.missing')
  expect(port.apply).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})
