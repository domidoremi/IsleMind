import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ScenePlansScreen } from '@/presentation/features/settings/ScenePlansScreen'
import { useSettingsStore } from '@/store/settingsStore'
import { useChatStore } from '@/store/chatStore'
import type { ScenePlan } from '@/core'
import type { Conversation } from '@/types/chatContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ScenePlanCatalog, ScenePlanWorkspacePort } from '@/presentation/features/settings/scenePlanWorkspacePort'
import { bindSettingsStorePersistence, flushPersistedSettings, releaseSettingsStorePersistence, type SettingsStorePersistence } from '@/presentation/features/settings/settingsStorePersistenceCommand'

jest.mock('expo-router', () => ({ router: { push: jest.fn(), dismissTo: jest.fn() }, useNavigationContainerRef: () => ({ getRootState: () => undefined }) }))
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
const conversation: Conversation = { id: 'owned-conversation', title: 'Current work', providerId: 'owned-provider', model: 'owned-model',
  systemPrompt: 'Original', temperature: 0.6, maxTokens: 1024, messages: [], createdAt: 1, updatedAt: 1 }
const plans: ScenePlan[] = [
  { schema: 'islemind.scene-plan.v1', id: 'owned-first', name: 'Research', revision: 1, configuration: { systemPrompt: 'First instructions' } },
  { schema: 'islemind.scene-plan.v1', id: 'owned-second', name: 'Research', revision: 1, configuration: { systemPrompt: 'Second instructions' } },
]
const catalog: ScenePlanCatalog = { tools: [], knowledge: [], skills: [], skillVariables: {} }
let persistence: SettingsStorePersistence
let save: jest.Mock
let port: ScenePlanWorkspacePort
beforeEach(() => {
  save = jest.fn(async () => undefined)
  persistence = { settings: { load: async () => null, save }, providers: { load: async () => [], save: async () => undefined } }
  bindSettingsStorePersistence(persistence)
  useSettingsStore.setState({ ...initialSettings, providers: [], settings: { ...initialSettings.settings, scenePlans: plans,
    theme: 'light', themeId: 'minimal' } }, true)
  useChatStore.setState({ ...initialChat, conversations: [conversation], currentId: conversation.id }, true)
  port = { loadCatalog: jest.fn(async () => catalog), capture: jest.fn(async () => ({})),
    preview: jest.fn(async (id, target) => {
      const plan = useSettingsStore.getState().settings.scenePlans!.find(plan => plan.id === id)!
      const systemPrompt = plan.configuration.systemPrompt ?? conversation.systemPrompt
      return { plan, target, before: conversation, after: { ...conversation, systemPrompt },
        changes: [{ field: 'systemPrompt' as const, before: conversation.systemPrompt, after: systemPrompt, changed: true }],
        catalog, issues: [], warnings: [], previewedAt: 2 }
    }),
    apply: jest.fn(async () => ({ conversation, persisted: true })) }
})
afterEach(async () => {
  await flushPersistedSettings().catch(() => undefined)
  releaseSettingsStorePersistence(persistence)
  useSettingsStore.setState(initialSettings, true)
  useChatStore.setState(initialChat, true)
})
const cases = [
  ['zh-CN', '编辑场景 1：Research', '编辑场景 2：Research', '预览场景 1：Research', '预览场景 2：Research', '编辑场景 2：Changed second'],
  ['en', 'Edit scene 1: Research', 'Edit scene 2: Research', 'Preview scene 1: Research', 'Preview scene 2: Research', 'Edit scene 2: Changed second'],
  ['ja', 'シーン1「Research」を編集', 'シーン2「Research」を編集', 'シーン1「Research」をプレビュー', 'シーン2「Research」をプレビュー', 'シーン2「Changed second」を編集'],
] as const

it.each(cases)('keeps duplicate scene preview, edit, save and delete assigned to the named item in %s',
  async (language, firstEdit, secondEdit, firstPreview, secondPreview, renamedSecondEdit) => {
    mockLanguage = language
    const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
    expect(view.getByLabelText(firstEdit)).toBeTruthy()
    expect(view.getByLabelText(secondEdit)).toBeTruthy()
    expect(view.getByLabelText(firstPreview)).toBeTruthy()
    expect(view.getByLabelText(secondPreview)).toBeTruthy()
    await fireEvent.press(view.getByLabelText(secondPreview))
    await fireEvent.press(view.getByTestId('scene-preview'))
    await waitFor(() => expect(view.getByTestId('scene-application-preview')).toBeTruthy())
    expect(port.preview).toHaveBeenCalledWith(plans[1].id, { kind: 'conversation', conversationId: conversation.id })
    expect(port.apply).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
    expect(useChatStore.getState().conversations).toEqual([conversation])
    await fireEvent.press(view.getByTestId('workspace-back'))
    await fireEvent.press(view.getByLabelText(secondEdit))
    expect(view.getByTestId('scene-name').props.value).toBe('Research')
    expect(view.getByTestId('scene-system-prompt').props.value).toBe('Second instructions')
    await fireEvent.changeText(view.getByTestId('scene-name'), 'Changed second')
    await fireEvent.press(view.getByTestId('scene-save'))
    await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
    const saved = useSettingsStore.getState().settings.scenePlans!
    expect(saved[0]).toEqual(plans[0])
    expect(saved[1]).toMatchObject({ id: plans[1].id, name: 'Changed second', revision: 2, configuration: plans[1].configuration })
    expect(view.getByLabelText(firstEdit)).toBeTruthy()
    await fireEvent.press(view.getByLabelText(renamedSecondEdit))
    await fireEvent.press(view.getByTestId('scene-delete'))
    await waitFor(() => expect(view.queryByTestId('scene-editor')).toBeNull())
    expect(useSettingsStore.getState().settings.scenePlans).toEqual([plans[0]])
    expect(view.getByLabelText(firstEdit)).toBeTruthy()
    expect(view.getByLabelText(firstPreview)).toBeTruthy()
    expect(view.queryByTestId('scene-edit-owned-second')).toBeNull()
    expect(useChatStore.getState().conversations).toEqual([conversation])
    expect(port.apply).not.toHaveBeenCalled()
  })

it.each(cases)('updates scene operation numbers after reordering without changing the selected plan in %s',
  async (language, firstEdit, secondEdit, firstPreview, secondPreview) => {
    mockLanguage = language
    const view = await render(<ScenePlansScreen port={port} onOpenConversation={() => undefined} />)
    await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, scenePlans: [plans[1], plans[0]] } })))
    expect(view.getByTestId('scene-edit-owned-second').props.accessibilityLabel).toBe(firstEdit)
    expect(view.getByTestId('scene-edit-owned-first').props.accessibilityLabel).toBe(secondEdit)
    expect(view.getByTestId('scene-saved-owned-second').props.accessibilityLabel).toBe(firstPreview)
    expect(view.getByTestId('scene-saved-owned-first').props.accessibilityLabel).toBe(secondPreview)
    await fireEvent.press(view.getByLabelText(firstEdit))
    expect(view.getByTestId('scene-system-prompt').props.value).toBe('Second instructions')
    await act(async () => useSettingsStore.setState(state => ({ settings: { ...state.settings, scenePlans: plans } })))
    expect(view.getByTestId('scene-system-prompt').props.value).toBe('Second instructions')
    expect(save).not.toHaveBeenCalled()
  })
