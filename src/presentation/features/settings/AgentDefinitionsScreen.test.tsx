import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { createAgentDefinition } from '@/modules/assistant-runtime/agentDefinition'
import { AgentDefinitionConflictError } from '@/modules/assistant-runtime/agentDefinitionRepository'
import { AgentDefinitionsScreen } from './AgentDefinitionsScreen'

const mockTranslate = (key: string, values?: Record<string, unknown>) => values?.name ? `${key}:${values.name}` : key
const mockConfirm = jest.fn().mockResolvedValue(true)
const mockDispatch = jest.fn()
const mockPreventRemove = jest.fn()
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: mockDispatch }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }))
const mockProvider = { id: 'provider', name: 'Provider', baseUrl: '', models: ['model'] }
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
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(true) })

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
  await waitFor(() => expect(management.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated' }), 1))
  await view.unmount()
})

it('imports a preview without saving and disables declared tools for text-only models', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await fireEvent.press(view.getByRole('button', { name: 'agents.import' }))
  await waitFor(() => expect(view.getByText('agents.importPreview')).toBeTruthy())
  expect(view.getByText('agents.textOnlyWarning')).toBeTruthy()
  expect(view.getByLabelText('agents.fields.allowedToolIds').props.editable).toBe(false)
  expect(view.getByLabelText('agents.fields.allowedToolIds').props.value).toBe('search')
  expect(management.save).not.toHaveBeenCalled()
  await view.unmount()
})

it('rejects invalid draft budgets locally and preserves a conflicted edit instead of overwriting', async () => {
  const { management } = fixture()
  const view = await render(<AgentDefinitionsScreen management={management} />)
  await waitFor(() => expect(view.getByText('Research')).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'agents.editNamed:Research' }))
  await waitFor(() => expect(view.getByLabelText('agents.fields.tokens')).toBeTruthy())
  await fireEvent.changeText(view.getByLabelText('agents.fields.tokens'), '-1')
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(view.getByText('agents.invalid')).toBeTruthy())
  expect(management.save).not.toHaveBeenCalled()
  await fireEvent.changeText(view.getByLabelText('agents.fields.tokens'), '1000')
  management.save.mockRejectedValueOnce(new AgentDefinitionConflictError())
  await fireEvent.press(view.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(view.getByText('agents.conflict')).toBeTruthy())
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
  await waitFor(() => expect(management.remove).toHaveBeenCalledWith('agent', 1))
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
