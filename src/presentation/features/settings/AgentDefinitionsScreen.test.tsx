import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { createAgentDefinition } from '@/modules/assistant-runtime'
import { AgentDefinitionConflictError } from '@/modules/assistant-runtime'
import { AgentDefinitionsScreen } from './AgentDefinitionsScreen'
import type { AIProvider } from '@/types/providerContracts'

const mockTranslate = (key: string, values?: Record<string, unknown>) => values?.name ? `${key}:${values.name}` : key
const mockConfirm = jest.fn().mockResolvedValue(true)
const mockDispatch = jest.fn()
const mockPreventRemove = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }))
const mockProvider: AIProvider = { id: 'provider', name: 'Provider', type: 'openai-compatible', apiKey: '', enabled: true, baseUrl: '', models: ['model'] }
const mockState = { providers: [mockProvider], settings: { hapticsEnabled: false } }
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select(mockState) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors('light', 'minimal')
  return { colors, design: colors.design, canonicalThemeId: 'minimal', isLiquidGlass: false }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))
jest.mock('@/components/ui/isle', () => ({ ...jest.requireActual('@/components/ui/isle'), useIsleDialog: () => ({ confirm: mockConfirm }) }))

function fixture() {
  const original = createAgentDefinition({ id: 'agent', name: 'Research', providerId: 'provider', modelId: 'model' })
  const management = {
    list: jest.fn().mockResolvedValue([original]), get: jest.fn().mockResolvedValue(original),
    save: jest.fn().mockImplementation(async (definition, revision) => ({ ...definition, revision: revision ? revision + 1 : 1 })),
    remove: jest.fn().mockResolvedValue(undefined), clear: jest.fn(), newDraft: jest.fn((input) => createAgentDefinition({ ...input, id: 'new-agent' })),
    importDraft: jest.fn().mockResolvedValue({ ...original, id: 'imported-agent', allowedToolIds: ['search'] }),
    exportSaved: jest.fn().mockResolvedValue(undefined),
  }
  return { original, management }
}
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(true); mockState.providers = [mockProvider] })

it('starts with a selectable discovered group model rather than an internal placeholder ID', async () => {
  mockState.providers = [{ ...mockProvider, models: [], credentialGroups: [
    { id: 'g', label: 'Saved key', apiKey: '', enabled: true, lastModelSyncStatus: 'ok', availableModels: ['group-model'] },
  ] }]
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.create' }))
  await waitFor(() => expect(management.newDraft).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'group-model' })))
  expect(view.getByRole('button', { name: 'group-model' })).toBeTruthy()
  expect(view.queryByLabelText('agents.fields.modelId')).toBeNull()
})

it('renders saved definitions and management-only disclosure; explicit Save uses the expected revision', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
  expect(view.getByText('agents.managementOnly')).toBeTruthy()
  expect(management.list).toHaveBeenCalledWith({ afterId: '', limit: 20 })
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await waitFor(() => expect(view.getByLabelText('agents.fields.name')).toBeTruthy())
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Updated')
  expect(management.save).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(management.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated' }), 1, expect.anything()))
  await view.unmount()
})

it('imports a preview without saving and disables declared tools for text-only models', async () => {
  const { management } = fixture()
  const loadReferences = jest.fn().mockResolvedValue({ tools: [], knowledge: [], skills: [], agents: [] })
  const view = await render(<AgentDefinitionsScreen management={management} loadReferences={loadReferences} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.import' }))
  await waitFor(() => expect(view.getByText('agents.importPreview')).toBeTruthy())
  expect(view.getByText('agents.textOnlyWarning')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  expect(view.getByRole('button', { name: 'settingsReferences.manual agents.fields.allowedToolIds' })).toBeDisabled()
  await waitFor(() => expect(view.getByText('search · agents.unresolved')).toBeTruthy())
  expect(management.save).not.toHaveBeenCalled()
  await view.unmount()
})

it('rejects invalid draft budgets locally and preserves a conflicted edit instead of overwriting', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await waitFor(() => expect(view.getByLabelText('agents.fields.tokens')).toBeTruthy())
  await fireEvent.changeText(view.getByLabelText('agents.fields.tokens'), '-1')
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(view.getByText('agents.invalid')).toBeTruthy())
  expect(view.getByRole('alert')).toHaveTextContent('agents.invalid')
  expect(management.save).not.toHaveBeenCalled()
  await fireEvent.changeText(view.getByLabelText('agents.fields.tokens'), '1000')
  management.save.mockRejectedValueOnce(new AgentDefinitionConflictError())
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(view.getByText('agents.conflict')).toBeTruthy())
  expect(view.getByRole('alert')).toHaveTextContent('agents.conflict')
  expect(view.getByLabelText('agents.fields.tokens').props.value).toBe('1000')
  await view.unmount()
})

it('requires confirmation for local export and deletion, and does not act after cancelling', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
  mockConfirm.mockResolvedValue(false)
  await fireEvent.press(view.getByRole('button', { name: 'agents.export' }))
  await act(async () => { await Promise.resolve() })
  expect(management.exportSaved).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'common.delete' }))
  await act(async () => { await Promise.resolve() })
  expect(management.remove).not.toHaveBeenCalled()
  mockConfirm.mockResolvedValue(true)
  await fireEvent.press(view.getByRole('button', { name: 'common.delete' }))
  await waitFor(() => expect(management.remove).toHaveBeenCalledWith('agent', 1, expect.anything()))
  await view.unmount()
})

it('keeps storage errors distinct from an empty catalog', async () => {
  const { management } = fixture()
  management.list.mockRejectedValue(new Error('storage failure'))
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('agents.readFailed')).toBeTruthy())
  expect(view.queryByText('agents.empty')).toBeNull()
  await view.unmount()
})

it('guards route Back and preserves a draft when discard is declined', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Unsaved')
  const [blocked, remove] = mockPreventRemove.mock.calls.at(-1)!
  expect(blocked).toBe(true)
  const action = { type: 'GO_BACK' }
  mockConfirm.mockResolvedValueOnce(false)
  await act(async () => { remove({ data: { action } }); await Promise.resolve() })
  expect(mockDispatch).not.toHaveBeenCalled()
  expect(view.getByLabelText('agents.fields.name').props.value).toBe('Unsaved')
  await act(async () => { remove({ data: { action } }); await Promise.resolve() })
  expect(mockDispatch).toHaveBeenCalledWith(action)
  await view.unmount()
})

it('loads references on demand, retries local read failure and saves selected IDs without authorizing tools', async () => {
  const { management } = fixture()
  const loadReferences = jest.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValue({
    tools: [{ value: 'builtin:info', label: 'App information' }], knowledge: [{ value: 'doc-1', label: 'Project notes' }], skills: [], agents: [],
  })
  const view = await render(<AgentDefinitionsScreen management={management} loadReferences={loadReferences} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.create' }))
  expect(loadReferences).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await waitFor(() => expect(view.getByText('settingsSubsystem.loadFailed')).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  await waitFor(() => expect(loadReferences).toHaveBeenCalledTimes(2))
  const selectors = view.getAllByRole('button', { name: 'settingsReferences.choose' })
  expect(selectors[0]).toBeDisabled()
  await fireEvent.press(selectors[1])
  await fireEvent.press(view.getByLabelText('Project notes'))
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(management.save).toHaveBeenCalledWith(expect.objectContaining({ knowledgeIds: ['doc-1'], allowedToolIds: [] }), undefined, expect.anything()))
  await view.unmount()
})

it('blocks cached Agent reference choices while catalog reload is pending or failed and restores them only after retry', async () => {
  const { management } = fixture()
  const catalog = { tools: [], knowledge: [{ value: 'doc', label: 'Previously loaded notes' }], skills: [], agents: [] }
  let reject!: (error: Error) => void
  const pending = new Promise((_resolve, no) => { reject = no })
  const loadReferences = jest.fn().mockResolvedValueOnce(catalog).mockReturnValueOnce(pending).mockResolvedValueOnce(catalog)
  const view = await render(<AgentDefinitionsScreen management={management} loadReferences={loadReferences} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.create' }))
  const advanced = () => view.getByRole('button', { name: 'settingsWorkspace.advanced' })
  await fireEvent.press(advanced())
  await waitFor(() => expect(loadReferences).toHaveBeenCalledTimes(1))
  const chooseNotes = () => view.getAllByRole('button', { name: 'settingsReferences.choose' })[1]
  expect(chooseNotes()).toBeEnabled()
  await fireEvent.press(advanced())
  await fireEvent.press(advanced())
  expect(loadReferences).toHaveBeenCalledTimes(2)
  expect(chooseNotes()).toBeDisabled()
  expect(view.getByText('common.loading')).toBeTruthy()
  await act(async () => { reject(new Error('read unavailable')); await pending.catch(() => undefined) })
  expect(view.getByText('settingsSubsystem.loadFailed')).toBeTruthy()
  expect(chooseNotes()).toBeDisabled()
  expect(management.save).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'common.retry' }))
  expect(chooseNotes()).toBeEnabled()
  await fireEvent.press(chooseNotes())
  await fireEvent.press(view.getByLabelText('Previously loaded notes'))
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  expect(management.save).toHaveBeenCalledWith(expect.objectContaining({ knowledgeIds: ['doc'], allowedToolIds: [] }), undefined, expect.anything())
  await view.unmount()
})

it('does not queue duplicate route discard prompts for the same dirty editor', async () => {
  const { management } = fixture()
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Unsaved')
  const [, remove] = mockPreventRemove.mock.calls.at(-1)!
  const action = { type: 'GO_BACK' }
  await act(async () => { remove({ data: { action } }); remove({ data: { action } }) })
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  await act(async () => { resolve(false); await Promise.resolve() })
  expect(mockDispatch).not.toHaveBeenCalled()
  expect(view.getByLabelText('agents.fields.name').props.value).toBe('Unsaved')
  await view.unmount()
})

it.each([
  ['agents.export', 'exportSaved'],
  ['common.delete', 'remove'],
] as const)('does not start %s after a pending confirmation loses its screen lifetime', async (label, method) => {
  const { management } = fixture()
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: label }))
  const options = mockConfirm.mock.calls[0][0]
  await view.unmount()
  expect(options.signal.aborted).toBe(true)
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(management[method]).not.toHaveBeenCalled()
})

it('keeps a dirty Agent draft when the route prompt fails and allows a fresh prompt', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Unsaved')
  const [, remove] = mockPreventRemove.mock.calls.at(-1)!
  const action = { type: 'GO_BACK' }
  mockConfirm.mockRejectedValueOnce(new Error('prompt unavailable'))
  await act(async () => { remove({ data: { action } }); await Promise.resolve() })
  expect(mockDispatch).not.toHaveBeenCalled()
  expect(view.getByLabelText('agents.fields.name').props.value).toBe('Unsaved')
  mockConfirm.mockResolvedValueOnce(true)
  await act(async () => { remove({ data: { action } }); await Promise.resolve() })
  expect(mockDispatch).toHaveBeenCalledWith(action)
  await view.unmount()
})

it('rejects route consent after the Agent draft changes and returns to the same text', async () => {
  const { management } = fixture()
  let resolve!: (approved: boolean) => void
  mockConfirm.mockImplementationOnce(() => new Promise<boolean>(settle => { resolve = settle }))
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Reviewed')
  const [, remove] = mockPreventRemove.mock.calls.at(-1)!
  const action = { type: 'GO_BACK' }
  await act(async () => { remove({ data: { action } }) })
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Changed')
  await fireEvent.changeText(view.getByLabelText('agents.fields.name'), 'Reviewed')
  await act(async () => { resolve(true); await Promise.resolve() })
  expect(mockDispatch).not.toHaveBeenCalled()
  expect(view.getByLabelText('agents.fields.name').props.value).toBe('Reviewed')
  mockConfirm.mockResolvedValueOnce(true)
  const [, freshRemove] = mockPreventRemove.mock.calls.at(-1)!
  await act(async () => { freshRemove({ data: { action } }); await Promise.resolve() })
  expect(mockDispatch).toHaveBeenCalledWith(action)
  await view.unmount()
})
