import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native'
import { SkillSettingsContent } from '@/components/settings/SkillSettingsContent'
import { SettingsEditBoundary } from '@/components/settings/SettingsEditBoundary'
import { IsleDialogProvider } from '@/components/ui/isle'
import { IsleThemeProvider } from '@/components/ui/isle/IsleThemeProvider'
import { useSettingsStore } from '@/store/settingsStore'
import {
  bindConversationSkillApplication,
  releaseConversationSkillApplication,
} from '@/presentation/features/conversations/conversationSkillCommand'
import { createConversationSkillRepository } from '@/modules/conversations'
import type { SkillDefinition } from '@/types/skillContracts'
import type { AIProvider } from '@/types/providerContracts'
import type { ConversationToolCatalogManifest } from '@/modules/integrations'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { MAX_IMPORT_TEXT_FILE_BYTES } from '@/platform/native/boundedImportFile'
import {
  APPLICATION_DATA_STORAGE_KEYS,
  readApplicationDataRecord,
  writeApplicationDataRecord,
} from './applicationDataRecords'
import { conversationSkillApplication } from './conversationSkills'
import { loadSettingsReferenceCatalog } from './settingsReferenceCatalog'
import { workflowDefinitionPolicy } from './workflowDefinitions'
import {
  createWorkflowSkillSuggestion,
  getWorkflowSkillState,
  isWorkflowSkillEnabled,
  isWorkflowSkillReviewRequired,
} from './workflowSkills'

const mockToolCatalog = jest.fn<Promise<ConversationToolCatalogManifest[]>, []>()
const mockDocuments = jest.fn<Promise<{ id: string; title: string }[]>, []>()
const mockExecute = jest.fn((..._args: unknown[]) => { throw new Error('Live execution is forbidden in this host fixture') })
const mockNavigationDispatch = jest.fn()
const mockPreventRemove = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockNavigationDispatch }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(), setStringAsync: jest.fn() }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///owned-skill-cache/', documentDirectory: 'file:///owned-documents/',
  EncodingType: { UTF8: 'utf8' }, getInfoAsync: jest.fn(), readAsStringAsync: jest.fn(),
  writeAsStringAsync: jest.fn(), deleteAsync: jest.fn(),
}))
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }))
jest.mock('./conversationToolCatalog', () => ({
  listConversationToolManifests: () => mockToolCatalog(),
  listStaticConversationToolManifests: () => [],
}))
jest.mock('./knowledgeRepository', () => ({
  knowledgeRepository: { listDocuments: () => mockDocuments() },
}))
jest.mock('./agentDefinitionRepository', () => ({
  agentDefinitionRepository: { list: jest.fn(async () => []) },
}))
jest.mock('./androidWorkflowCatalog', () => ({ androidWorkflowCatalog: { list: () => [] } }))
jest.mock('./toolchainControlPlane', () => ({
  buildPersistedToolchainCatalogSnapshot: jest.fn(async () => ({
    androidControlPlane: { registeredToolCards: [] },
  })),
  createPortableSkillToolchainManifest: (skill: SkillDefinition) => ({ id: `skill:${skill.id}` }),
  createControlPlaneActionRequest: (...args: unknown[]) => mockExecute(...args),
  applyAndPersistToolchainControlPlaneAction: (...args: unknown[]) => mockExecute(...args),
}))
jest.mock('./pluginManifest', () => ({
  createPluginManifestFromWorkflowSkill: () => ({
    skills: [], permissions: [], requiredCapabilities: [], review: { state: 'unreviewed' },
  }),
  validatePluginManifest: () => ({ ok: true, errors: [], warnings: [] }),
}))
jest.mock('./providerModelAvailabilityRuntime', () => ({
  providerModelAvailabilityRuntime: { invalidateAll: jest.fn(async () => undefined) },
}))
jest.mock('@/services/runtimeHealthLog', () => ({
  logStorageOperationFailure: jest.fn(async () => undefined),
}))
jest.mock('@/platform/native/runtimeLog', () => ({
  readStoredRuntimeLogOptions: async () => ({ enabled: false }),
  appendRuntimeLog: jest.fn(async () => undefined),
}))

const initial = useSettingsStore.getState()
const records = new Map<string, string>()
const readFailures = new Map<string, Error>()
const writeFailures = new Map<string, Error>()
const skillKey = APPLICATION_DATA_STORAGE_KEYS.SKILLS
let originalSettingsRecord: string
let originalProvidersRecord: string
const savedSkill: SkillDefinition = {
  schema: 'islemind.skill.v1', id: 'saved-skill', name: 'Saved research skill',
  version: '1.0.0', layer: 'base', description: 'Retained local instructions',
  systemPrompt: 'Use the saved research instructions.', tags: ['saved'], priority: 0,
  providerId: 'saved-provider', model: 'saved-alias',
  enabledTools: ['missing-tool'], knowledgeSources: ['missing-document'],
  variables: [{ name: 'topic', type: 'text', defaultValue: 'local topic' }],
  stackPolicy: 'append', createdAt: 10, updatedAt: 20,
}
const provider: AIProvider = {
  id: 'saved-provider', name: 'Saved provider', type: 'openai-compatible',
  apiKey: '', baseUrl: 'https://saved-skill-fixture.invalid/v1', enabled: false, models: [],
  modelAliases: [{ alias: 'saved-alias', model: 'group-model' }],
  credentialGroups: [{
    id: 'saved-group', label: 'Saved group', apiKey: '', enabled: true,
    lastModelSyncStatus: 'ok', availableModels: ['group-model'],
  }],
}
const tool: ConversationToolCatalogManifest = {
  id: 'builtin:app-info', name: 'app_info', source: 'builtin', description: 'App information',
  permission: 'read-only', enabled: false, serverName: 'Fixture',
}
const textEncoderDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder')
beforeAll(() => {
  if (!textEncoderDescriptor) Object.defineProperty(globalThis, 'TextEncoder', {
    configurable: true, value: require('node:util').TextEncoder,
  })
  bindConversationSkillApplication(conversationSkillApplication)
})
afterAll(() => {
  releaseConversationSkillApplication(conversationSkillApplication)
  if (!textEncoderDescriptor) Reflect.deleteProperty(globalThis, 'TextEncoder')
})
beforeEach(() => {
  jest.clearAllMocks()
  records.clear(); readFailures.clear(); writeFailures.clear()
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => {
    if (readFailures.has(key)) throw readFailures.get(key)
    return records.get(key) ?? null
  })
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (writeFailures.has(key)) throw writeFailures.get(key)
    records.set(key, value)
  })
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => { records.delete(key) })
  jest.mocked(Clipboard.getStringAsync).mockResolvedValue('')
  jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true)
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null })
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({ exists: false, isDirectory: false, uri: '' })
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValue(new Error('Unselected native read forbidden'))
  jest.mocked(FileSystem.writeAsStringAsync).mockResolvedValue(undefined)
  jest.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined)
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false)
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined)
  mockToolCatalog.mockReset().mockResolvedValue([tool])
  mockDocuments.mockReset().mockResolvedValue([{ id: 'doc-1', title: 'Project notes' }])
  useSettingsStore.setState(initial, true)
  useSettingsStore.setState({
    settings: {
      ...initial.settings, language: 'en', themeId: 'minimal', theme: 'light',
      skillsEnabled: false, mcpEnabled: false, memoryEnabled: false, knowledgeEnabled: false,
      webSearchEnabled: false, searchProvider: 'off', hapticsEnabled: false,
      defaultProvider: provider.id,
      lastPreferredModel: { schema: 'islemind.global-model-preference.v1', providerId: provider.id, model: 'saved-alias' },
    },
    providers: [provider],
  })
  records.set(APPLICATION_DATA_STORAGE_KEYS.SETTINGS, JSON.stringify(useSettingsStore.getState().settings))
  records.set(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS, JSON.stringify([provider]))
  records.set(skillKey, JSON.stringify([savedSkill]))
  originalSettingsRecord = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)!
  originalProvidersRecord = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)!
})
afterEach(() => {
  expect(mockExecute).not.toHaveBeenCalled()
  expect(jest.mocked(AsyncStorage.setItem).mock.calls.every(([key]) => key === skillKey)).toBe(true)
  expect(AsyncStorage.removeItem).not.toHaveBeenCalled()
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(originalSettingsRecord)
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(originalProvidersRecord)
  expect(useSettingsStore.getState().settings).toMatchObject({
    skillsEnabled: false, mcpEnabled: false, memoryEnabled: false, knowledgeEnabled: false,
    webSearchEnabled: false, searchProvider: 'off', defaultProvider: provider.id,
    lastPreferredModel: { providerId: provider.id, model: 'saved-alias' },
  })
  expect(useSettingsStore.getState().providers).toEqual([provider])
  useSettingsStore.setState(initial, true)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail })
  return { promise, resolve, reject }
}
const storedSkills = (): SkillDefinition[] => JSON.parse(records.get(skillKey)!)
const skillWrites = () => jest.mocked(AsyncStorage.setItem).mock.calls.filter(([key]) => key === skillKey)
const freshRepository = () => createConversationSkillRepository({
  records: {
    read: () => readApplicationDataRecord('SKILLS'),
    write: skills => writeApplicationDataRecord('SKILLS', skills),
  },
  normalizeSkill: conversationSkillApplication.normalizeSkill,
})
function managementScreen() {
  return render(<IsleThemeProvider><IsleDialogProvider><SettingsEditBoundary>
    <SkillSettingsContent />
  </SettingsEditBoundary></IsleDialogProvider></IsleThemeProvider>)
}
type ManagementScreen = Awaited<ReturnType<typeof managementScreen>>
const dialogPanel = (screen: ManagementScreen) => within(screen.getByTestId(/^(?:dialog-experience-|animal-island-dialog-panel$)/))
async function creationEditor(screen: ManagementScreen) {
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  await fireEvent.changeText(screen.getByLabelText('skills.name'), 'New research skill')
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Use these new research instructions.')
}
async function savedPage(screen: ManagementScreen) {
  await fireEvent.press(screen.getByTestId('settings-task-saved'))
  await waitFor(() => expect(screen.getByText(savedSkill.name)).toBeTruthy())
}
async function importPage(screen: ManagementScreen) {
  await fireEvent.press(screen.getByTestId('settings-task-import'))
}
async function savedEditor(screen: ManagementScreen) {
  await savedPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
  await waitFor(() => expect(screen.getByLabelText('skills.name').props.value).toBe(savedSkill.name))
}
async function advancedEditor(screen: ManagementScreen) {
  await fireEvent.press(screen.getByRole('button', { name: /^settingsWorkspace\.advanced\./ }))
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^settingsReferences\.manual / })).toHaveLength(4))
}
async function chooseReference(screen: ManagementScreen, index: number, label: string) {
  await fireEvent.press(screen.getAllByRole('button', { name: 'settingsReferences.choose' })[index])
  await fireEvent.press(screen.getByLabelText(label))
}
function selectedSkillFile(raw: string, options: {
  uri?: string; name?: string; size?: number; fileSize?: number; mimeType?: string
  text?: () => Promise<string>
} = {}) {
  const uri = options.uri ?? 'file:///owned-skill-cache/selected-SKILL.md'
  const text = jest.fn(options.text ?? (async () => raw))
  const asset: DocumentPicker.DocumentPickerAsset = {
    uri, name: options.name ?? 'SKILL.md', mimeType: options.mimeType ?? 'text/markdown',
    size: options.size ?? raw.length, lastModified: 1,
    file: { size: options.fileSize ?? raw.length, text } as unknown as File,
  }
  const result: DocumentPicker.DocumentPickerResult = { canceled: false, assets: [asset] }
  return { uri, text, asset, result }
}
function browserSkillExportFixture() {
  const platform = jest.replaceProperty(Platform, 'OS', 'web')
  const cache = jest.replaceProperty(FileSystem, 'cacheDirectory', null)
  const documents = jest.replaceProperty(FileSystem, 'documentDirectory', null)
  const link = { href: '', download: '', click: jest.fn(), remove: jest.fn() }
  const createObjectURL = jest.fn((_blob: Blob) => 'blob:owned-skill-export')
  const revokeObjectURL = jest.fn()
  const descriptors = [
    [globalThis, 'window', Object.getOwnPropertyDescriptor(globalThis, 'window')],
    [globalThis, 'document', Object.getOwnPropertyDescriptor(globalThis, 'document')],
    [globalThis, 'Blob', Object.getOwnPropertyDescriptor(globalThis, 'Blob')],
    [URL, 'createObjectURL', Object.getOwnPropertyDescriptor(URL, 'createObjectURL')],
    [URL, 'revokeObjectURL', Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')],
  ] as const
  // This exercises the Web dispatch with owned DOM ports, not an actual browser.
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: jest.fn(), removeEventListener: jest.fn(),
  } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => link, body: { appendChild: jest.fn() },
  } })
  Object.defineProperty(globalThis, 'Blob', { configurable: true, value: require('node:buffer').Blob })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  jest.mocked(Clipboard.setStringAsync).mockRejectedValue(new Error('Physical clipboard is forbidden in this Web fixture'))
  jest.mocked(FileSystem.writeAsStringAsync).mockRejectedValue(new Error('Native file writes are forbidden in this Web fixture'))
  jest.mocked(Sharing.isAvailableAsync).mockRejectedValue(new Error('Native sharing is forbidden in this Web fixture'))
  return {
    link, createObjectURL, revokeObjectURL,
    restore() {
      platform.restore(); cache.restore(); documents.restore()
      for (const [target, key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(target, key, descriptor)
        else Reflect.deleteProperty(target, key)
      }
    },
  }
}
function reviewedWorkflowSkill(): SkillDefinition {
  const workflow = workflowDefinitionPolicy.create({
    id: 'local-workflow', name: 'Local reviewed workflow', enabled: true,
    triggerHints: ['local-review'], permissionCeiling: 'read-only', expectedOutput: 'reply',
    steps: [{ id: 'review', title: 'Review the supplied local notes', acceptance: ['local explanation present'] }],
    acceptanceChecks: ['local explanation present'], now: 100,
  })
  const suggestion = createWorkflowSkillSuggestion({ workflow, manifests: [], now: 100 })
  if (!suggestion.ok || !suggestion.skill) throw new Error('Invalid local workflow fixture')
  return {
    ...suggestion.skill,
    tags: [...suggestion.skill.tags, 'approval:user-visible', 'approved-by:prior-local', 'approved-at:101'],
  }
}
async function workflowsPage(screen: ManagementScreen, skill: SkillDefinition) {
  if (!screen.queryByTestId('settings-task-editor-workflows') && screen.queryByRole('button', { name: 'common.back' })) {
    await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  }
  if (screen.queryByTestId('settings-task-workflows')) {
    await fireEvent.press(screen.getByTestId('settings-task-workflows'))
  }
  await waitFor(() => expect(screen.getByText(skill.name)).toBeTruthy())
}

it('composes nonempty Skill create, strict JSON save and fresh repository/page reload while preserving configured defaults and unresolved references', async () => {
  const beforeSettings = records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)
  const beforeProviders = records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
  expect(storedSkills()).toHaveLength(2)
  const created = storedSkills().find(skill => skill.id !== savedSkill.id)!
  expect(created).toMatchObject({
    name: 'New research skill', systemPrompt: 'Use these new research instructions.',
    schema: 'islemind.skill.v1', layer: 'base',
  })
  expect(created).not.toHaveProperty('enabledTools')
  expect(created).not.toHaveProperty('knowledgeSources')
  expect(storedSkills().find(skill => skill.id === savedSkill.id)).toEqual(savedSkill)
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.SETTINGS)).toBe(beforeSettings)
  expect(records.get(APPLICATION_DATA_STORAGE_KEYS.PROVIDERS)).toBe(beforeProviders)
  await expect(freshRepository().listSkills()).resolves.toEqual(expect.arrayContaining([
    expect.objectContaining(created), expect.objectContaining(savedSkill),
  ]))
  await screen.unmount()
  const fresh = await managementScreen()
  await savedPage(fresh)
  expect(fresh.getByText(created.name)).toBeTruthy()
  await fresh.unmount()
})

it.each(['absent', 'json-null', 'empty-array'])('retains %s Skill storage compatibility without enabling the subsystem', async kind => {
  if (kind === 'absent') records.delete(skillKey)
  else records.set(skillKey, kind === 'json-null' ? 'null' : '[]')
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
  expect(storedSkills()).toEqual([expect.objectContaining({ name: 'New research skill' })])
  await screen.unmount()
})

it.each([
  ['future envelope', JSON.stringify({ schema: 'islemind.skill.future.v2', skills: [savedSkill] })],
  ['string', JSON.stringify('synthetic-private-skill-marker')],
  ['boolean', 'false'],
  ['number', '7'],
] as const)('refuses %s saved Skill data through the actual form and repository without replacing bytes or draft', async (_kind, raw) => {
  records.set(skillKey, raw)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.saveFailed').length).toBeGreaterThan(0))
  expect(records.get(skillKey)).toBe(raw)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.getByLabelText('skills.name').props.value).toBe('New research skill')
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('Use these new research instructions.')
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  await expect(freshRepository().listSkills()).rejects.toMatchObject({ name: 'ConversationSkillRecordDataError' })
  await screen.unmount()
})

it.each(['read', 'parse'])('keeps an actual Skill %s failure visible and retries the retained draft after supported data returns', async failure => {
  const before = records.get(skillKey)!
  if (failure === 'read') readFailures.set(skillKey, new Error('synthetic-private-read-error'))
  else records.set(skillKey, '{synthetic-private-invalid-json')
  const failedBytes = records.get(skillKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryAllByText('settingsWorkspace.saveFailed').length).toBeGreaterThan(0))
  expect(records.get(skillKey)).toBe(failedBytes)
  expect(skillWrites()).toHaveLength(0)
  readFailures.clear(); records.set(skillKey, before)
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
  expect(storedSkills()).toHaveLength(2)
  expect(storedSkills().find(skill => skill.id === savedSkill.id)).toEqual(savedSkill)
  await screen.unmount()
})

it('retries a real failed Skill write with the same creation ID and preserves a later unrelated saved skill', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  writeFailures.set(skillKey, new Error('synthetic-private-write-error'))
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.saveFailed')).toBeTruthy())
  expect(records.get(skillKey)).toBe(before)
  const failedAttempt = JSON.parse(skillWrites()[0][1]) as SkillDefinition[]
  const attemptedId = failedAttempt.find(skill => skill.id !== savedSkill.id)!.id
  const unrelated = { ...savedSkill, id: 'unrelated-skill', name: 'Later unrelated skill' }
  records.set(skillKey, JSON.stringify([savedSkill, unrelated]))
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
  expect(storedSkills().map(skill => skill.id).sort()).toEqual([savedSkill.id, unrelated.id, attemptedId].sort())
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  await screen.unmount()
})

it('keeps actual Skill save single-flight and leave debt while the first serialized write is pending', async () => {
  const screen = await managementScreen()
  await creationEditor(screen)
  const gate = deferred<void>()
  const started = deferred<void>()
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === skillKey) { started.resolve(); await gate.promise }
    records.set(key, value)
  })
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
    await act(async () => { await started.promise })
    expect(screen.getByRole('button', { name: 'settingsWorkspace.saving' })).toBeDisabled()
    await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.saving' }))
    expect(skillWrites()).toHaveLength(1)
    await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
    expect(screen.getByLabelText('skills.systemPrompt')).toBeTruthy()
    expect(screen.queryByTestId('dialog-experience-minimal')).toBeNull()
    await act(async () => { gate.resolve() })
    await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
    expect(storedSkills()).toHaveLength(2)
    expect(skillWrites()).toHaveLength(1)
  } finally {
    await act(async () => { gate.resolve() })
    await screen.unmount()
  }
})

it('preserves a Skill write already admitted before unmount without claiming cancellation rollback', async () => {
  const screen = await managementScreen()
  await creationEditor(screen)
  const gate = deferred<void>()
  const started = deferred<void>()
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key === skillKey) { started.resolve(); await gate.promise }
    records.set(key, value)
  })
  try {
    await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
    await act(async () => { await started.promise })
    await screen.unmount()
    await act(async () => { gate.resolve() })
    await waitFor(() => expect(storedSkills()).toHaveLength(2))
    await expect(freshRepository().listSkills()).resolves.toHaveLength(2)
    expect(skillWrites()).toHaveLength(1)
  } finally {
    await act(async () => { gate.resolve() })
    await screen.unmount()
  }
})

it('imports an instruction-only SKILL.md through the actual picker, bounded UTF8 reader, parser and JSON repository', async () => {
  const raw = '---\nname: local-research\ndescription: Read local notes carefully.\n---\nKeep {{example}} literal and use local evidence.'
  const text = jest.fn(async () => raw)
  const uri = 'file:///owned-skill-cache/picked-SKILL.md'
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false, assets: [{
      uri, name: 'SKILL.md', mimeType: 'text/markdown', size: raw.length, lastModified: 1,
      file: { size: raw.length, text } as unknown as File,
    }],
  })
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(storedSkills()).toHaveLength(2))
  const imported = storedSkills().find(skill => skill.id !== savedSkill.id)!
  expect(imported).toMatchObject({
    name: 'local-research', tags: ['format:agentskills'],
    systemPrompt: 'Keep {{example}} literal and use local evidence.',
  })
  expect(imported).not.toHaveProperty('providerId')
  expect(imported).not.toHaveProperty('model')
  expect(text).toHaveBeenCalledTimes(1)
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  await waitFor(() => expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true }))
  await expect(freshRepository().listSkills()).resolves.toEqual(expect.arrayContaining([expect.objectContaining(imported)]))
  await screen.unmount()
})

it('requires actual cancelable duplicate confirmation before replacing an imported saved Skill ID', async () => {
  const before = records.get(skillKey)
  const imported = { ...savedSkill, name: 'Imported replacement', systemPrompt: 'Imported instructions' }
  jest.mocked(Clipboard.getStringAsync).mockResolvedValue(conversationSkillApplication.exportSkill(imported))
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
  await waitFor(() => expect(screen.getByText('skills.replaceImportTitle')).toBeTruthy())
  expect(records.get(skillKey)).toBe(before)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
  await waitFor(() => expect(screen.queryByText('skills.replaceImportTitle')).toBeNull())
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
  await waitFor(() => expect(screen.getByText('skills.replaceImportTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'skills.replaceImport' }))
  await waitFor(() => expect(storedSkills()[0].name).toBe('Imported replacement'))
  expect(storedSkills()).toHaveLength(1)
  expect(storedSkills()[0]).not.toHaveProperty('providerId')
  expect(storedSkills()[0]).not.toHaveProperty('model')
  await screen.unmount()
})

it('refuses a same-ID competing Skill change made while the real replacement confirmation is open', async () => {
  jest.mocked(Clipboard.getStringAsync).mockResolvedValue(conversationSkillApplication.exportSkill({
    ...savedSkill, name: 'Imported replacement',
  }))
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
  await waitFor(() => expect(screen.getByText('skills.replaceImportTitle')).toBeTruthy())
  const competing = { ...savedSkill, name: 'Competing same-timestamp edit' }
  records.set(skillKey, JSON.stringify([competing]))
  const before = records.get(skillKey)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'skills.replaceImport' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict'))
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'skills.importClipboard' })).toBeEnabled()
  await screen.unmount()
})

it('exports the actual saved Skill envelope with provider bindings omitted and cleans its owned temporary file', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await savedPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.share' }))
  await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledTimes(1))
  const raw = jest.mocked(Clipboard.setStringAsync).mock.calls[0][0]
  const envelope = JSON.parse(raw)
  expect(envelope).toMatchObject({
    schema: 'islemind.skill.portable.v2',
    manifest: { skillId: savedSkill.id, providerBindingOmitted: true, modelBindingOmitted: true },
    skill: { id: savedSkill.id, systemPrompt: savedSkill.systemPrompt, enabledTools: ['missing-tool'] },
  })
  expect(envelope.skill).not.toHaveProperty('providerId')
  expect(envelope.skill).not.toHaveProperty('model')
  await waitFor(() => expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1))
  const [uri, contents] = jest.mocked(FileSystem.writeAsStringAsync).mock.calls[0]
  expect(uri).toMatch(/^file:\/\/\/owned-skill-cache\/[^/]+\.isleskill$/)
  expect(contents).toBe(raw)
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
  expect(Sharing.shareAsync).not.toHaveBeenCalled()
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await screen.unmount()
})

it('downloads the actual saved Skill envelope through the Web branch without clipboard, native files or sharing', async () => {
  const before = records.get(skillKey)
  const browser = browserSkillExportFixture()
  let screen: ManagementScreen | undefined
  try {
    screen = await managementScreen()
    await savedPage(screen)
    jest.useFakeTimers()
    await fireEvent.press(screen.getByRole('button', { name: 'skills.exportFile' }))
    expect(browser.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = browser.createObjectURL.mock.calls[0][0]
    expect(blob.type).toBe('application/json')
    const raw = await blob.text()
    const envelope = JSON.parse(raw)
    expect(envelope).toMatchObject({
      schema: 'islemind.skill.portable.v2',
      manifest: { skillId: savedSkill.id, providerBindingOmitted: true, modelBindingOmitted: true },
      skill: { id: savedSkill.id, systemPrompt: savedSkill.systemPrompt, enabledTools: ['missing-tool'] },
    })
    expect(envelope.skill).not.toHaveProperty('providerId')
    expect(envelope.skill).not.toHaveProperty('model')
    expect(browser.link.download).toBe('Saved-research-skill.isleskill')
    expect(browser.link.href).toBe('blob:owned-skill-export')
    expect(browser.link.click).toHaveBeenCalledTimes(1)
    expect(browser.link.remove).toHaveBeenCalledTimes(1)
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
    expect(Sharing.isAvailableAsync).not.toHaveBeenCalled()
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
    expect(screen.getByText('skills.exportDownloadPrepared')).toBeTruthy()
    expect(screen.queryByText('skills.exported')).toBeNull()
    jest.advanceTimersByTime(30_000)
    expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:owned-skill-export')
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
    const imported = conversationSkillApplication.importSkill(raw).skill!
    expect(imported).toMatchObject({ id: savedSkill.id, systemPrompt: savedSkill.systemPrompt })
    expect(imported.providerId).toBeUndefined()
    expect(imported.model).toBeUndefined()
    await expect(freshRepository().listSkills()).resolves.toEqual([savedSkill])
  } finally {
    await screen?.unmount()
    jest.useRealTimers()
    browser.restore()
  }
})

it.each(['blob', 'download'] as const)('keeps saved Skills intact and retryable after a Web %s failure without falling back to native effects', async stage => {
  const before = records.get(skillKey)
  const browser = browserSkillExportFixture()
  if (stage === 'blob') browser.createObjectURL.mockImplementation(() => { throw new Error('synthetic-private-blob-error') })
  else browser.link.click.mockImplementation(() => { throw new Error('synthetic-private-download-error') })
  let screen: ManagementScreen | undefined
  try {
    screen = await managementScreen()
    await savedPage(screen)
    jest.useFakeTimers()
    await fireEvent.press(screen.getByRole('button', { name: 'skills.exportFile' }))
    await waitFor(() => expect(screen!.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
    expect(browser.createObjectURL).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'skills.exportFile' })).toBeEnabled()
    expect(screen.queryByText(/synthetic-private/)).toBeNull()
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled()
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
    expect(Sharing.isAvailableAsync).not.toHaveBeenCalled()
    expect(Sharing.shareAsync).not.toHaveBeenCalled()
    if (stage === 'download') {
      expect(browser.link.remove).toHaveBeenCalledTimes(1)
      jest.advanceTimersByTime(30_000)
      expect(browser.revokeObjectURL).toHaveBeenCalledWith('blob:owned-skill-export')
    } else expect(browser.revokeObjectURL).not.toHaveBeenCalled()
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
    await expect(freshRepository().listSkills()).resolves.toEqual([savedSkill])
  } finally {
    await screen?.unmount()
    jest.useRealTimers()
    browser.restore()
  }
})

it('saves actual provider alias, tool and knowledge selections and reloads the references without selecting global defaults', async () => {
  let screen = await managementScreen()
  try {
    await creationEditor(screen)
    await advancedEditor(screen)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'settingsReferences.choose' })[2]).toBeEnabled())
    await chooseReference(screen, 0, provider.name)
    await chooseReference(screen, 1, 'saved-alias')
    await chooseReference(screen, 2, 'Fixture / app_info')
    await chooseReference(screen, 3, 'Project notes')
    expect(skillWrites()).toHaveLength(0)
    await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
    await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
    const created = storedSkills().find(skill => skill.id !== savedSkill.id)!
    expect(created).toMatchObject({
      providerId: provider.id, model: 'saved-alias',
      enabledTools: [tool.id], knowledgeSources: ['doc-1'],
    })
    await expect(loadSettingsReferenceCatalog()).resolves.toMatchObject({
      tools: [{ value: tool.id, label: 'Fixture / app_info' }],
      knowledge: [{ value: 'doc-1', label: 'Project notes' }],
      skills: expect.arrayContaining([{ value: created.id, label: created.name }]),
    })
    await expect(freshRepository().listSkills()).resolves.toEqual(expect.arrayContaining([expect.objectContaining(created)]))
    await screen.unmount()
    screen = await managementScreen()
    await savedPage(screen)
    await fireEvent.press(screen.getAllByRole('button', { name: 'common.edit' })[0])
    expect(screen.getByLabelText('skills.name').props.value).toBe(created.name)
    await advancedEditor(screen)
    await waitFor(() => expect(screen.getByText('Fixture / app_info')).toBeTruthy())
    expect(screen.getByText(provider.name)).toBeTruthy()
    expect(screen.getByText('saved-alias')).toBeTruthy()
    expect(screen.getByText('Project notes')).toBeTruthy()
    expect(skillWrites()).toHaveLength(1)
  } finally { await screen.unmount() }
})

it('retains unresolved Skill reference IDs while adding a real reference and after a fresh reload', async () => {
  let screen = await managementScreen()
  try {
    await savedEditor(screen)
    await advancedEditor(screen)
    await waitFor(() => expect(screen.getByText('missing-tool · agents.unresolved')).toBeTruthy())
    expect(screen.getByText('missing-document · agents.unresolved')).toBeTruthy()
    await chooseReference(screen, 2, 'Fixture / app_info')
    await chooseReference(screen, 3, 'Project notes')
    await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
    await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
    expect(storedSkills()[0]).toMatchObject({
      id: savedSkill.id, providerId: savedSkill.providerId, model: savedSkill.model,
      enabledTools: ['missing-tool', tool.id], knowledgeSources: ['missing-document', 'doc-1'],
      variables: savedSkill.variables,
    })
    await screen.unmount()
    screen = await managementScreen()
    await savedEditor(screen)
    await advancedEditor(screen)
    await waitFor(() => expect(screen.getByText('missing-tool · agents.unresolved')).toBeTruthy())
    expect(screen.getByText('missing-document · agents.unresolved')).toBeTruthy()
    expect(screen.getByText('Fixture / app_info')).toBeTruthy()
    expect(screen.getByText('Project notes')).toBeTruthy()
  } finally { await screen.unmount() }
})

it('keeps the real reference catalog fail-closed and retryable without erasing saved unresolved IDs', async () => {
  const before = records.get(skillKey)
  mockToolCatalog.mockRejectedValueOnce(new Error('synthetic-private-catalog-error'))
  const screen = await managementScreen()
  await savedEditor(screen)
  await advancedEditor(screen)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsSubsystem.loadFailed'))
  expect(screen.getAllByRole('button', { name: 'settingsReferences.choose' })[2]).toBeDisabled()
  expect(screen.getByText('missing-tool')).toBeTruthy()
  await fireEvent.press(screen.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(screen.getByText('missing-tool · agents.unresolved')).toBeTruthy())
  expect(screen.getAllByRole('button', { name: 'settingsReferences.choose' })[2]).toBeEnabled()
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  await screen.unmount()
})

it('retries an actual saved Skill edit after write failure without changing identity or dropping unrelated data', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await savedEditor(screen)
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Reviewed saved instructions')
  writeFailures.set(skillKey, new Error('synthetic-private-edit-write-error'))
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
  expect(records.get(skillKey)).toBe(before)
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('Reviewed saved instructions')
  const unrelated = { ...savedSkill, id: 'later-skill', name: 'Later saved skill' }
  records.set(skillKey, JSON.stringify([savedSkill, unrelated]))
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
  expect(storedSkills()).toEqual(expect.arrayContaining([
    expect.objectContaining({ ...savedSkill, systemPrompt: 'Reviewed saved instructions', updatedAt: expect.any(Number) }),
    unrelated,
  ]))
  expect(storedSkills()).toHaveLength(2)
  expect(skillWrites()).toHaveLength(2)
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  await screen.unmount()
})

it('refuses a same-timestamp competing edit on actual saved Skill retry and retains the local unsaved draft', async () => {
  const screen = await managementScreen()
  await savedEditor(screen)
  await fireEvent.changeText(screen.getByLabelText('skills.systemPrompt'), 'Unsaved local instructions')
  writeFailures.set(skillKey, new Error('local write failure'))
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
  const competing = { ...savedSkill, systemPrompt: 'Competing saved instructions' }
  records.set(skillKey, JSON.stringify([competing]))
  const competingBytes = records.get(skillKey)
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict'))
  expect(records.get(skillKey)).toBe(competingBytes)
  expect(skillWrites()).toHaveLength(1)
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('Unsaved local instructions')
  expect(screen.getByRole('button', { name: 'skills.saveSkill' })).toBeEnabled()
  await screen.unmount()
})

it('requires actual delete cancel and fresh confirmation before deleting the shown Skill and reloading an empty repository', async () => {
  const before = records.get(skillKey)
  let screen = await managementScreen()
  try {
    await savedPage(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(screen.getByText('skills.deleteTitle')).toBeTruthy())
    expect(dialogPanel(screen).getByText(savedSkill.name)).toBeTruthy()
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByText('skills.deleteTitle')).toBeNull())
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
    await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(screen.getByText('skills.deleteTitle')).toBeTruthy())
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(within(screen.getByTestId('settings-task-editor-saved')).queryByText(savedSkill.name)).toBeNull())
    expect(storedSkills()).toEqual([])
    expect(skillWrites()).toHaveLength(1)
    await expect(freshRepository().listSkills()).resolves.toEqual([])
    await screen.unmount()
    screen = await managementScreen()
    await fireEvent.press(screen.getByTestId('settings-task-saved'))
    await waitFor(() => expect(screen.getByText('skills.empty')).toBeTruthy())
    expect(screen.queryByText(savedSkill.name)).toBeNull()
  } finally { await screen.unmount() }
})

it('rejects actual Skill deletion when the saved item changes during its dangerous confirmation', async () => {
  const screen = await managementScreen()
  await savedPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(screen.getByText('skills.deleteTitle')).toBeTruthy())
  const competing = { ...savedSkill, enabledTools: ['other-tool'] }
  records.set(skillKey, JSON.stringify([competing]))
  const before = records.get(skillKey)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict'))
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'common.delete' })).toBeEnabled()
  await screen.unmount()
})

it('does not delete a Skill when its actual confirmation loses screen lifetime', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await savedPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(screen.getByText('skills.deleteTitle')).toBeTruthy())
  await screen.unmount()
  await act(async () => { await Promise.resolve() })
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await expect(freshRepository().listSkills()).resolves.toEqual([expect.objectContaining(savedSkill)])
})

it('keeps an actual Skill delete failure retryable and requires a new confirmation for its retry', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await savedPage(screen)
  writeFailures.set(skillKey, new Error('synthetic-private-delete-error'))
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(screen.getByText('skills.deleteTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
  expect(records.get(skillKey)).toBe(before)
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(screen.getByText('skills.deleteTitle')).toBeTruthy())
  expect(records.get(skillKey)).toBe(before)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(storedSkills()).toEqual([]))
  expect(skillWrites()).toHaveLength(2)
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  await screen.unmount()
})

it('keeps or discards an actual unsaved Skill through the shared workspace dialog without implicit persistence', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
  await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
  expect(screen.getByLabelText('skills.name').props.value).toBe('New research skill')
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await waitFor(() => expect(screen.getByTestId('settings-task-list')).toBeTruthy())
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  expect(screen.getByLabelText('skills.name').props.value).toBe('')
  expect(screen.getByLabelText('skills.systemPrompt').props.value).toBe('')
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await screen.unmount()
})

it('invalidates an actual unsaved discard consent when the draft changes and is restored while the dialog is open', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.changeText(screen.getByLabelText('skills.name'), 'Changed during review')
  await fireEvent.changeText(screen.getByLabelText('skills.name'), 'New research skill')
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
  expect(screen.getByLabelText('skills.name').props.value).toBe('New research skill')
  await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await screen.unmount()
})

it('protects actual route removal with unsaved keep/discard consent and dispatches only the reviewed action', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await creationEditor(screen)
  const action = { type: 'GO_BACK', source: 'skill-host-route' }
  const requestRemoval = async () => {
    const last = mockPreventRemove.mock.calls[mockPreventRemove.mock.calls.length - 1]
    expect(last[0]).toBe(true)
    await act(async () => { last[1]({ data: { action } }) })
  }
  await requestRemoval()
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
  await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
  expect(mockNavigationDispatch).not.toHaveBeenCalled()
  await requestRemoval()
  await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.discard' }))
  await waitFor(() => expect(mockNavigationDispatch).toHaveBeenCalledWith(action))
  expect(mockNavigationDispatch).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText('skills.name')).toBeNull()
  await fireEvent.press(screen.getByTestId('settings-task-edit'))
  expect(screen.getByLabelText('skills.name').props.value).toBe('')
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await screen.unmount()
})

it('serializes actual clipboard acquisition and ignores its late payload after screen unmount', async () => {
  const before = records.get(skillKey)
  const gate = deferred<string>()
  jest.mocked(Clipboard.getStringAsync).mockReturnValue(gate.promise)
  const screen = await managementScreen()
  try {
    await importPage(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
    expect(screen.getByRole('button', { name: 'skills.importClipboard' })).toBeDisabled()
    await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
    expect(Clipboard.getStringAsync).toHaveBeenCalledTimes(1)
    await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
    expect(screen.getByRole('button', { name: 'skills.importClipboard' })).toBeTruthy()
    await screen.unmount()
    await act(async () => { gate.resolve(conversationSkillApplication.exportSkill({ ...savedSkill, id: 'late-skill' })) })
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
    expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
  } finally {
    await act(async () => { gate.resolve('') })
    await screen.unmount()
  }
})

it.each(['picker', 'reader'] as const)('ignores late actual file %s results after unmount and cleans only the selected owned copy', async phase => {
  const before = records.get(skillKey)
  const raw = '---\nname: late-local-file\ndescription: Local instructions.\n---\nUse local evidence.'
  const pickerGate = deferred<DocumentPicker.DocumentPickerResult>()
  const readerGate = deferred<string>()
  const file = selectedSkillFile(raw, {
    text: phase === 'reader' ? () => readerGate.promise : undefined,
  })
  if (phase === 'picker') jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValue(pickerGate.promise)
  else jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(file.result)
  const screen = await managementScreen()
  try {
    await importPage(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
    if (phase === 'reader') await waitFor(() => expect(file.text).toHaveBeenCalledTimes(1))
    await screen.unmount()
    await act(async () => {
      pickerGate.resolve(file.result)
      readerGate.resolve(raw)
    })
    await waitFor(() => expect(FileSystem.deleteAsync).toHaveBeenCalledWith(file.uri, { idempotent: true }))
    expect(file.text).toHaveBeenCalledTimes(phase === 'picker' ? 0 : 1)
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
    expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { pickerGate.resolve(file.result); readerGate.resolve(raw) })
    await screen.unmount()
  }
})

it('rejects an oversized selected Skill file at the real bounded-reader admission before reading text and cleans the copy', async () => {
  const before = records.get(skillKey)
  const file = selectedSkillFile('not read', { fileSize: MAX_IMPORT_TEXT_FILE_BYTES + 1 })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(file.result)
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByText('error.fileTooLarge')).toBeTruthy())
  expect(file.text).not.toHaveBeenCalled()
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(file.uri, { idempotent: true })
  expect(screen.getByRole('button', { name: 'settings.chooseFile' })).toBeEnabled()
  await screen.unmount()
})

it('rejects an unsupported selected Skill file without reading or persisting it and cleans the copy', async () => {
  const before = records.get(skillKey)
  const file = selectedSkillFile('not read', { name: 'local-image.png', mimeType: 'image/png' })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(file.result)
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByText('skills.unsupportedFile')).toBeTruthy())
  expect(file.text).not.toHaveBeenCalled()
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(file.uri, { idempotent: true })
  await screen.unmount()
})

it.each([
  ['malformed JSON', '{synthetic-private-invalid-json'],
  ['unsupported JSON shape', JSON.stringify({ schema: 'islemind.skill.future.v9', skills: [savedSkill] })],
  ['invalid SKILL.md', '---\nname: unsafe markdown fixture\n---\n'],
] as const)('refuses %s through actual clipboard parsing and a real failure notice without replacing saved Skill data', async (_kind, raw) => {
  const before = records.get(skillKey)
  jest.mocked(Clipboard.getStringAsync).mockResolvedValue(raw)
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
  await waitFor(() => expect(dialogPanel(screen).getByText('skills.importFailed')).toBeTruthy())
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  await screen.unmount()
})

it('keeps a canceled file selection side-effect free and ready for another import', async () => {
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'settings.chooseFile' })).toBeEnabled())
  expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(1)
  expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled()
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await screen.unmount()
})

it('surfaces a real selected native-file read failure, cleans its copy and retains the import retry entry', async () => {
  const before = records.get(skillKey)
  const uri = 'file:///owned-skill-cache/native-SKILL.md'
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
    canceled: false, assets: [{ uri, name: 'SKILL.md', size: 100, lastModified: 1 }],
  })
  jest.mocked(FileSystem.readAsStringAsync).mockRejectedValue(new Error('synthetic-private-native-read-error'))
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByText('skills.importFailed')).toBeTruthy())
  expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith(uri, { encoding: FileSystem.EncodingType.UTF8 })
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  expect(screen.getByRole('button', { name: 'settings.chooseFile' })).toBeEnabled()
  await screen.unmount()
})

it('retries an actual file import after a JSON write failure and cleans each owned selection without duplicating the saved skill', async () => {
  const before = records.get(skillKey)
  const raw = conversationSkillApplication.exportSkill({ ...savedSkill, id: 'file-imported', name: 'File imported skill' })
  const first = selectedSkillFile(raw, { name: 'local.isleskill', uri: 'file:///owned-skill-cache/first.isleskill' })
  const second = selectedSkillFile(raw, { name: 'local.isleskill', uri: 'file:///owned-skill-cache/second.isleskill' })
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce(first.result).mockResolvedValueOnce(second.result)
  const screen = await managementScreen()
  await importPage(screen)
  writeFailures.set(skillKey, new Error('synthetic-private-import-write-error'))
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
  expect(records.get(skillKey)).toBe(before)
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(first.uri, { idempotent: true })
  writeFailures.clear()
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(storedSkills()).toHaveLength(2))
  const imported = storedSkills().find(skill => skill.id === 'file-imported')!
  expect(imported).toMatchObject({ name: 'File imported skill', enabledTools: savedSkill.enabledTools })
  expect(imported).not.toHaveProperty('providerId')
  expect(imported).not.toHaveProperty('model')
  expect(skillWrites()).toHaveLength(2)
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(second.uri, { idempotent: true })
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(2)
  expect(storedSkills().find(skill => skill.id === savedSkill.id)).toEqual(savedSkill)
  await expect(freshRepository().listSkills()).resolves.toHaveLength(2)
  await screen.unmount()
})

it('cleans the selected Skill copy after duplicate confirmation unmount without persisting the unapproved replacement', async () => {
  const before = records.get(skillKey)
  const file = selectedSkillFile(conversationSkillApplication.exportSkill({ ...savedSkill, name: 'Unapproved file replacement' }))
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue(file.result)
  const screen = await managementScreen()
  await importPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'settings.chooseFile' }))
  await waitFor(() => expect(screen.getByText('skills.replaceImportTitle')).toBeTruthy())
  expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
  await screen.unmount()
  await waitFor(() => expect(FileSystem.deleteAsync).toHaveBeenCalledWith(file.uri, { idempotent: true }))
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
})

it('shares only the actual saved Skill envelope and cleans the exact owned export after a sharing failure', async () => {
  const before = records.get(skillKey)
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true)
  jest.mocked(Sharing.shareAsync).mockRejectedValue(new Error('synthetic-private-sharing-error'))
  const screen = await managementScreen()
  await savedPage(screen)
  await fireEvent.press(screen.getByRole('button', { name: 'common.share' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.saveFailed'))
  const [uri, raw] = jest.mocked(FileSystem.writeAsStringAsync).mock.calls[0]
  expect(JSON.parse(raw).skill.id).toBe(savedSkill.id)
  expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, {
    mimeType: 'application/json', dialogTitle: `${savedSkill.name}.isleskill`, UTI: 'public.json',
  })
  expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true })
  expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'common.share' })).toBeEnabled()
  expect(screen.queryByText(/synthetic-private/)).toBeNull()
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  await screen.unmount()
})

it.each(['clipboard', 'write', 'availability', 'share'] as const)('fences export after unmount during %s and cleans exactly the owned temporary output when one exists', async phase => {
  const before = records.get(skillKey)
  const clipboardGate = deferred<boolean>()
  const writeGate = deferred<void>()
  const availabilityGate = deferred<boolean>()
  const shareGate = deferred<void>()
  if (phase === 'clipboard') jest.mocked(Clipboard.setStringAsync).mockReturnValue(clipboardGate.promise)
  if (phase === 'write') jest.mocked(FileSystem.writeAsStringAsync).mockReturnValue(writeGate.promise)
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true)
  if (phase === 'availability') jest.mocked(Sharing.isAvailableAsync).mockReturnValue(availabilityGate.promise)
  if (phase === 'share') jest.mocked(Sharing.shareAsync).mockReturnValue(shareGate.promise)
  const screen = await managementScreen()
  try {
    await savedPage(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'common.share' }))
    const pendingPort = phase === 'clipboard' ? Clipboard.setStringAsync
      : phase === 'write' ? FileSystem.writeAsStringAsync
        : phase === 'availability' ? Sharing.isAvailableAsync : Sharing.shareAsync
    await waitFor(() => expect(pendingPort).toHaveBeenCalledTimes(1))
    await screen.unmount()
    await act(async () => {
      clipboardGate.resolve(true); writeGate.resolve(); availabilityGate.resolve(true); shareGate.resolve()
    })
    if (phase === 'clipboard') {
      expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled()
      expect(FileSystem.deleteAsync).not.toHaveBeenCalled()
    } else {
      const [uri] = jest.mocked(FileSystem.writeAsStringAsync).mock.calls[0]
      await waitFor(() => expect(FileSystem.deleteAsync).toHaveBeenCalledWith(uri, { idempotent: true }))
      expect(FileSystem.deleteAsync).toHaveBeenCalledTimes(1)
    }
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(phase === 'share' ? 1 : 0)
    if (phase === 'clipboard' || phase === 'write') expect(Sharing.isAvailableAsync).not.toHaveBeenCalled()
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
  } finally {
    await act(async () => {
      clipboardGate.resolve(true); writeGate.resolve(); availabilityGate.resolve(true); shareGate.resolve()
    })
    await screen.unmount()
  }
})

it('imports a portable approved workflow as disabled and review-required, then persists only explicitly confirmed enable and disable decisions', async () => {
  const source = reviewedWorkflowSkill()
  const raw = conversationSkillApplication.exportSkill(source)
  const envelope = JSON.parse(raw)
  expect(envelope.manifest.workflow).toMatchObject({
    state: 'disabled', importedReviewRequired: true, approvalInherited: false,
  })
  expect(envelope.skill.tags).toContain('workflow-status:disabled')
  expect(envelope.skill.tags.some((tag: string) => tag.startsWith('approval:') || tag.startsWith('approved-'))).toBe(false)
  jest.mocked(Clipboard.getStringAsync).mockResolvedValue(raw)
  let screen = await managementScreen()
  try {
    await importPage(screen)
    await fireEvent.press(screen.getByRole('button', { name: 'skills.importClipboard' }))
    await waitFor(() => expect(storedSkills()).toHaveLength(2))
    const imported = storedSkills().find(skill => skill.id === source.id)!
    expect(getWorkflowSkillState(imported)).toBe('disabled')
    expect(isWorkflowSkillReviewRequired(imported)).toBe(true)
    expect(isWorkflowSkillEnabled(imported)).toBe(false)
    await workflowsPage(screen, imported)
    await fireEvent.press(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
    await waitFor(() => expect(screen.getByText('skills.reviewAgentWorkflowTitle')).toBeTruthy())
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByText('skills.reviewAgentWorkflowTitle')).toBeNull())
    expect(skillWrites()).toHaveLength(1)
    await fireEvent.press(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
    await waitFor(() => expect(screen.getByText('skills.reviewAgentWorkflowTitle')).toBeTruthy())
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'skills.disableWorkflow' })).toBeTruthy())
    const enabled = storedSkills().find(skill => skill.id === source.id)!
    expect(isWorkflowSkillEnabled(enabled)).toBe(true)
    expect(isWorkflowSkillReviewRequired(enabled)).toBe(false)
    expect(enabled.tags).toEqual(expect.arrayContaining(['approval:user-visible', 'approved-by:settings', 'workflow-status:enabled']))
    await expect(freshRepository().listSkills()).resolves.toEqual(expect.arrayContaining([expect.objectContaining(enabled)]))
    await fireEvent.press(screen.getByRole('button', { name: 'skills.disableWorkflow' }))
    await waitFor(() => expect(screen.getByText('skills.disableAgentWorkflowTitle')).toBeTruthy())
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(screen.queryByText('skills.disableAgentWorkflowTitle')).toBeNull())
    expect(skillWrites()).toHaveLength(2)
    await fireEvent.press(screen.getByRole('button', { name: 'skills.disableWorkflow' }))
    await waitFor(() => expect(screen.getByText('skills.disableAgentWorkflowTitle')).toBeTruthy())
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'skills.disableWorkflow' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'skills.enableWorkflow' })).toBeTruthy())
    expect(getWorkflowSkillState(storedSkills().find(skill => skill.id === source.id)!)).toBe('disabled')
    expect(skillWrites()).toHaveLength(3)
    await screen.unmount()
    screen = await managementScreen()
    await workflowsPage(screen, imported)
    expect(screen.getByRole('button', { name: 'skills.enableWorkflow' })).toBeTruthy()
  } finally { await screen.unmount() }
})

it('marks an actual approved workflow definition edit disabled and review-required rather than inheriting saved approval', async () => {
  const original = reviewedWorkflowSkill()
  records.set(skillKey, JSON.stringify([original]))
  let screen = await managementScreen()
  try {
    await workflowsPage(screen, original)
    await fireEvent.press(screen.getByRole('button', { name: 'common.edit' }))
    await fireEvent.changeText(screen.getByLabelText('skills.name'), 'Locally edited workflow')
    await fireEvent.press(screen.getByRole('button', { name: 'skills.saveSkill' }))
    await waitFor(() => expect(screen.queryByLabelText('skills.systemPrompt')).toBeNull())
    const edited = storedSkills()[0]
    expect(edited).toMatchObject({ id: original.id, name: 'Locally edited workflow', createdAt: original.createdAt })
    expect(getWorkflowSkillState(edited)).toBe('disabled')
    expect(isWorkflowSkillReviewRequired(edited)).toBe(true)
    expect(edited.tags.some(tag => tag.startsWith('approval:') || tag.startsWith('approved-'))).toBe(false)
    await screen.unmount()
    screen = await managementScreen()
    await workflowsPage(screen, edited)
    expect(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' })).toBeTruthy()
    expect(skillWrites()).toHaveLength(1)
  } finally { await screen.unmount() }
})

it('refuses actual workflow approval when the shown saved definition changes during review', async () => {
  const imported = conversationSkillApplication.importSkill(conversationSkillApplication.exportSkill(reviewedWorkflowSkill())).skill!
  records.set(skillKey, JSON.stringify([imported]))
  const screen = await managementScreen()
  await workflowsPage(screen, imported)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
  await waitFor(() => expect(screen.getByText('skills.reviewAgentWorkflowTitle')).toBeTruthy())
  records.set(skillKey, JSON.stringify([{ ...imported, name: 'Competing workflow name' }]))
  const before = records.get(skillKey)
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('settingsWorkspace.conflict'))
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' })).toBeEnabled()
  await screen.unmount()
})

it('does not approve an actual workflow when its review dialog loses screen lifetime', async () => {
  const imported = conversationSkillApplication.importSkill(conversationSkillApplication.exportSkill(reviewedWorkflowSkill())).skill!
  records.set(skillKey, JSON.stringify([imported]))
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await workflowsPage(screen, imported)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
  await waitFor(() => expect(screen.getByText('skills.reviewAgentWorkflowTitle')).toBeTruthy())
  await screen.unmount()
  await act(async () => { await Promise.resolve() })
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(isWorkflowSkillEnabled(storedSkills()[0])).toBe(false)
})

it('blocks confirmed workflow enable at the real definition validator when the embedded definition is missing', async () => {
  const invalid = {
    ...reviewedWorkflowSkill(), systemPrompt: 'No workflow definition is present.',
    tags: ['agent-workflow', 'workflow:local-workflow', 'workflow-status:disabled', 'workflow-import:review-required'],
  }
  records.set(skillKey, JSON.stringify([invalid]))
  const before = records.get(skillKey)
  const screen = await managementScreen()
  await workflowsPage(screen, invalid)
  await fireEvent.press(screen.getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
  await waitFor(() => expect(screen.getByText('skills.reviewAgentWorkflowTitle')).toBeTruthy())
  await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'skills.reviewAndEnableWorkflow' }))
  await waitFor(() => expect(screen.getByText('skills.agentWorkflowStateBlocked')).toBeTruthy())
  expect(records.get(skillKey)).toBe(before)
  expect(skillWrites()).toHaveLength(0)
  expect(isWorkflowSkillEnabled(storedSkills()[0])).toBe(false)
  await screen.unmount()
})

describe.each(CANONICAL_THEME_IDS)('%s small-screen large-font reduced-motion host composition (not rendered acceptance)', themeId => {
  it.each(['light', 'dark'] as const)('keeps %s saved references, unsaved dialogs and pause semantics intact without persistence', async theme => {
    const before = records.get(skillKey)
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, themeId, theme } })
    const screen = await managementScreen()
    await savedEditor(screen)
    await advancedEditor(screen)
    await waitFor(() => expect(screen.getByText('missing-tool · agents.unresolved')).toBeTruthy())
    await fireEvent.changeText(screen.getByLabelText('skills.name'), 'Unsaved themed skill')
    await fireEvent.press(screen.getByRole('button', { name: 'common.back' }))
    await waitFor(() => expect(screen.getByText('settingsWorkspace.discardTitle')).toBeTruthy())
    expect(screen.getByTestId(themeId === 'animal-island-ui' ? 'animal-island-dialog-panel' : `dialog-experience-${themeId}`)).toBeTruthy()
    await fireEvent.press(dialogPanel(screen).getByRole('button', { name: 'settingsWorkspace.keepEditing' }))
    await waitFor(() => expect(screen.queryByText('settingsWorkspace.discardTitle')).toBeNull())
    expect(screen.getByLabelText('skills.name').props.value).toBe('Unsaved themed skill')
    expect(screen.getByText('settingsSubsystem.paused')).toBeTruthy()
    expect(useSettingsStore.getState().settings).toMatchObject({ themeId, theme, skillsEnabled: false })
    expect(records.get(skillKey)).toBe(before)
    expect(skillWrites()).toHaveLength(0)
    await screen.unmount()
  })
})
