import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ScenePlansScreen } from './ScenePlansScreen'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import type { ScenePlan } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ScenePlanCatalog, ScenePlanWorkspacePort } from './scenePlanWorkspacePort'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from './settingsStorePersistenceCommand'

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const state = jest.requireActual('@/store/settingsStore').useSettingsStore((state: typeof initialSettings) => state.settings)
  return { colors: jest.requireActual('@/theme/colors').getColors(state.theme === 'dark' ? 'dark' : 'light', state.themeId), canonicalThemeId: state.themeId }
} }))
jest.mock('@/hooks/useThemeMotion', () => ({ useThemeMotion: () => ({ intensity: 'none', from: {}, animate: {}, transition: { duration: 0 } }) }))
jest.mock('moti', () => ({ MotiView: jest.requireActual('react-native').View }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('@/components/settings/SettingsEditBoundary', () => ({
  useSettingsDraft: () => undefined, useSettingsLeave: () => async (action: () => void) => action(),
  useSettingsLifetime: () => {
    const React = jest.requireActual<typeof import('react')>('react')
    const lifetime = React.useRef<AbortController | undefined>(undefined)
    React.useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
    return lifetime
  },
}))
jest.mock('@/components/settings/SettingsTaskWorkspace', () => ({ SettingsTaskWorkspace: ({ tasks, value, onTaskChange, overview }: any) => {
  const { Pressable, View, Text } = jest.requireActual('react-native')
  const current = tasks.find((task: any) => task.id === value)
  return <View>{current ? <><Pressable testID="workspace-back" onPress={() => onTaskChange(undefined)}><Text>Back</Text></Pressable>{current.content}</>
    : <>{tasks.map((task: any) => <Pressable key={task.id} testID={`settings-task-${task.id}`} onPress={() => onTaskChange(task.id)}><Text>{task.title}</Text></Pressable>)}{overview}</>}</View>
} }))
jest.mock('@/presentation/layout/WorkspaceSurface', () => ({ WorkspaceSurface: ({ children, role, ...props }: any) => {
  const { View } = jest.requireActual('react-native')
  return <View {...props}>{children}</View>
} }))
jest.mock('@/components/ui/isle', () => {
  const React = jest.requireActual('react')
  const { Pressable, Text, TextInput, View } = jest.requireActual('react-native')
  return { IslePressable: Pressable, useIsleDialog: () => ({ confirm: async () => true }),
    IsleButton: ({ label, onPress, disabled, busy, testID, accessibilityLabel }: any) =>
      <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} testID={testID}><Text>{label}</Text></Pressable>,
    IsleInput: ({ label, inputStyle, ...props }: any) => <TextInput {...props} style={inputStyle} />,
    IsleSelect: ({ options, value, onChange, testID, accessibilityLabel, disabled }: any) => {
      const [open, setOpen] = React.useState(false)
      return <View testID={testID}><Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? 'Select'} disabled={disabled} onPress={() => setOpen(!open)}>
        <Text>{options.find((option: any) => option.value === value)?.label ?? 'Select'}</Text></Pressable>
        {open ? options.map((option: any) => <Pressable key={option.value} testID={`${testID}-option-${option.value}`} disabled={disabled} onPress={() => { onChange(option.value); setOpen(false) }}><Text>{option.label}</Text></Pressable>) : null}</View>
    },
  }
})
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({ providerModelAvailabilityRuntime: {}, withProviderModelAvailabilityChanges: async (_ids: string[], work: () => Promise<unknown>) => work() }))

const initialSettings = useSettingsStore.getState()
const initialChat = useChatStore.getState()
const provider: AIProvider = { id: 'a', name: 'Connection A', type: 'openai', apiKey: '', enabled: true, models: ['gpt-4o-mini'], manualModels: ['gpt-4o-mini'] }
const conversation: Conversation = { id: 'c', title: 'Current work', providerId: 'a', model: 'gpt-4o-mini', systemPrompt: 'Original',
  temperature: 0.6, maxTokens: 1024, messages: [], createdAt: 1, updatedAt: 1 }
const plan: ScenePlan = { schema: 'islemind.scene-plan.v1', id: 'research', name: 'Research', revision: 1,
  configuration: { model: { target: { providerId: 'a', model: 'gpt-4o-mini' } }, systemPrompt: 'Scene instructions' } }
const catalog: ScenePlanCatalog = { tools: [], knowledge: [], skills: [], skillVariables: {} }
let persistence: SettingsStorePersistence
let save: jest.Mock
let port: ScenePlanWorkspacePort
beforeEach(() => {
  save = jest.fn(async () => undefined)
  persistence = { settings: { load: async () => null, save }, providers: { load: async () => [], save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initialSettings, providers: [provider], settings: { ...initialSettings.settings, scenePlans: [], theme: 'light', themeId: 'minimal' } }, true)
  useChatStore.setState({ ...initialChat, conversations: [conversation], currentId: 'c' }, true)
  port = { loadCatalog: jest.fn(async () => catalog), capture: jest.fn(async () => plan.configuration),
    preview: jest.fn(async (_id, target) => ({ plan, target, before: conversation, after: { ...conversation, systemPrompt: 'Scene instructions' },
      changes: [{ field: 'systemPrompt' as const, before: 'Original', after: 'Scene instructions', changed: true }], catalog, issues: [], warnings: [], previewedAt: 2 })),
    apply: jest.fn(async () => ({ conversation: { ...conversation, systemPrompt: 'Scene instructions' }, persisted: true })) }
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initialSettings, true)
  useChatStore.setState(initialChat, true)
})
async function create(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByTestId('settings-task-edit'))
  await fireEvent.changeText(view.getByTestId('scene-name'), 'Writing')
  await fireEvent.press(view.getByTestId('scene-choose-model'))
  await fireEvent.press(view.getByTestId('scene-model-a-gpt-4o-mini'))
}
function seedPlan() {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, scenePlans: [plan] } }))
}

test('opens the exact referenced scene for editing without applying it or discarding later input', async () => {
  seedPlan()
  const view = await render(<ScenePlansScreen planId={plan.id} port={port} onOpenConversation={() => undefined} />)
  expect(view.getByTestId('scene-name').props.value).toBe('Research')
  await fireEvent.changeText(view.getByTestId('scene-name'), 'Unpublished edits')
  await act(() => useSettingsStore.setState(state => ({ settings: { ...state.settings, theme: 'dark' } })))
  expect(view.getByTestId('scene-name').props.value).toBe('Unpublished edits')
  expect(port.apply).not.toHaveBeenCalled()
  expect(port.preview).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
})

test('reports a removed scene reference without opening or applying another scene', async () => {
  const view = await render(<ScenePlansScreen planId="removed" port={port} onOpenConversation={() => undefined} />)
  expect(view.getByText('connectionReferences.missing')).toBeTruthy()
  expect(view.queryByTestId('scene-editor')).toBeNull()
  expect(port.apply).not.toHaveBeenCalled()
})

test('saves explicit model, empty scopes and policies, then opens the saved template', async () => {
  const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
  await create(view)
  await fireEvent.press(view.getByTestId('scene-editor-sections-resources'))
  await fireEvent.press(view.getByTestId('scene-enabledTools-mode-none'))
  await fireEvent.press(view.getByTestId('scene-knowledgeSources-mode-none'))
  await fireEvent.press(view.getByTestId('scene-editor-sections-context'))
  await fireEvent.press(view.getByTestId('scene-context-mode-custom'))
  await fireEvent.changeText(view.getByTestId('scene-threshold'), '65')
  await fireEvent.press(view.getByTestId('scene-declaration-mode-auto'))
  await fireEvent.press(view.getByTestId('scene-save'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  const saved = useSettingsStore.getState().settings.scenePlans![0]
  expect(saved.configuration).toMatchObject({ model: { target: { providerId: 'a', model: 'gpt-4o-mini' } },
    enabledTools: [], knowledgeSources: [], contextPolicy: { remoteCompactThreshold: 0.65 }, toolDeclarationMode: 'auto' })
  await fireEvent.press(view.getByTestId(`scene-edit-${saved.id}`))
  expect(view.getByTestId('scene-name').props.value).toBe('Writing')
})

test('failed template writes retain the local editor and retry with the original revision', async () => {
  const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
  await create(view)
  save.mockRejectedValueOnce(Error('disk unavailable'))
  await fireEvent.press(view.getByTestId('scene-save'))
  await waitFor(() => expect(view.getByTestId('scene-feedback')).toHaveTextContent('scenes.saveFailed'))
  expect(view.getByTestId('scene-name').props.value).toBe('Writing')
  expect(useSettingsStore.getState().settings.scenePlans).toEqual([])
  await fireEvent.press(view.getByTestId('scene-save'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(useSettingsStore.getState().settings.scenePlans![0].revision).toBe(1)
})

test('a concurrent edit keeps the draft and permits saving a separate plan without overwriting the winner', async () => {
  seedPlan()
  const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
  await fireEvent.press(view.getByTestId('scene-edit-research'))
  await fireEvent.changeText(view.getByTestId('scene-name'), 'Local')
  await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, scenePlans: [{ ...plan, name: 'Remote', revision: 2 }] } })))
  expect(view.getByTestId('scene-name').props.value).toBe('Local')
  expect(view.getByTestId('scene-save')).toBeDisabled()
  await fireEvent.press(view.getByTestId('scene-save-as-new'))
  await fireEvent.press(view.getByTestId('scene-save'))
  await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
  expect(useSettingsStore.getState().settings.scenePlans?.map(item => item.name)).toEqual(['Remote', 'Local'])
})

test('preview is read-only, application rejects duplicate clicks and opens the actual resulting conversation', async () => {
  seedPlan()
  let finish!: (value: { conversation: Conversation; persisted: boolean }) => void
  ;(port.apply as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const open = jest.fn()
  const view = await render(<ScenePlansScreen port={port} onOpenConversation={open} />)
  await fireEvent.press(view.getByTestId('scene-saved-research'))
  await fireEvent.press(view.getByTestId('scene-preview'))
  await waitFor(() => expect(view.getByTestId('scene-application-preview')).toBeTruthy())
  expect(port.apply).not.toHaveBeenCalled()
  expect(save).not.toHaveBeenCalled()
  await fireEvent.press(view.getByTestId('scene-apply'))
  await fireEvent.press(view.getByTestId('scene-apply'))
  expect(port.apply).toHaveBeenCalledTimes(1)
  await act(async () => finish({ conversation, persisted: true }))
  await waitFor(() => expect(view.getByTestId('scene-applied')).toBeTruthy())
  await fireEvent.press(view.getByTestId('scene-open-conversation'))
  expect(open).toHaveBeenCalledWith('c')
})

test('changing the selected target clears the old preview; a changed template disables an existing preview', async () => {
  seedPlan()
  const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
  await fireEvent.press(view.getByTestId('scene-saved-research'))
  await fireEvent.press(view.getByTestId('scene-preview'))
  await waitFor(() => expect(view.getByTestId('scene-apply')).toBeTruthy())
  await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, scenePlans: [{ ...plan, revision: 2 }] } })))
  expect(view.getByTestId('scene-apply')).toBeDisabled()
  expect(view.getByTestId('scene-preview-stale')).toBeTruthy()
  await fireEvent.press(view.getByLabelText('scenes.target'))
  await fireEvent.press(view.getByTestId('scene-target-option-new'))
  expect(view.queryByTestId('scene-application-preview')).toBeNull()
  expect(view.getByTestId('scene-preview')).toBeTruthy()
  expect(port.apply).not.toHaveBeenCalled()
})

test('all theme families retain text and policies while editing', async () => {
  const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
  await create(view)
  await fireEvent.press(view.getByTestId('scene-editor-sections-context'))
  await fireEvent.press(view.getByTestId('scene-context-mode-custom'))
  await fireEvent.changeText(view.getByTestId('scene-threshold'), '65')
  for (const themeId of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const) {
    await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, themeId, theme: 'dark' } })))
    expect(view.getByTestId('scene-name').props.value).toBe('Writing')
    expect(view.getByTestId('scene-threshold').props.value).toBe('65')
  }
})
