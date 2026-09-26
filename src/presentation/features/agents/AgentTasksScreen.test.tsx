import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { AgentTasksScreen } from './AgentTasksScreen'
import { AgentRunScreen } from './AgentRunScreen'
import { createAgentDefinition, type AssistantRun, type AssistantRunProjection } from '@/modules/assistant-runtime'
import { createRunBudget } from '@/modules/assistant-runtime'
import type { AgentTaskPort } from './agentTaskPort'
import { asAssistantRunId, CHAT_REQUEST_SCHEMA } from '@/core'

jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors('light', 'minimal')
  return { colors, design: colors.design, canonicalThemeId: 'minimal', isLiquidGlass: false }
} }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: { hapticsEnabled: false } }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

function fixture(patch: Partial<AssistantRun> = {}) {
  const definition = createAgentDefinition({ id: 'agent', name: 'Research', providerId: 'provider', modelId: 'model' })
  const run = { id: 'run-1', rootRunId: 'run-1', engineVersion: 'islemind.harness.v1', kind: 'chat', conversationId: 'chat',
    providerId: 'provider', model: 'model', createdAt: 1, journalSequence: 2, status: 'paused', agentDefinition: definition,
    lifecycleCheckpoint: { recovery: 'resumable', effectCertainty: 'none', waitingReason: 'process_restart' }, ...patch } as AssistantRun
  let projection: AssistantRunProjection | undefined
  const unsubscribe = jest.fn()
  const runtime = { definitions: { list: jest.fn(async () => [definition]) }, listRuns: jest.fn(async () => [run]),
    get: jest.fn(async () => run), budget: jest.fn(async () => createRunBudget('run-1')),
    sources: jest.fn(async () => [{ type: 'citation' as const, citationId: 'source-1', title: 'Official source', url: 'https://example.com/' }]),
    subscribe: jest.fn((listener: AssistantRunProjection) => { projection = listener; return unsubscribe }),
    backgroundEnabled: jest.fn(() => false), setBackground: jest.fn(async () => {}),
    start: jest.fn(async () => run), resume: jest.fn(async () => run), approve: jest.fn(async () => run),
    pause: jest.fn(async () => ({ ok: true, value: run })), cancel: jest.fn(async () => ({ ok: true, value: run })),
    steer: jest.fn(async () => ({ ok: true, value: run })), saveDocument: jest.fn(async () => ({})),
  }
  return { runtime: runtime as unknown as AgentTaskPort, mocks: runtime, run, unsubscribe,
    emit: async (value: AssistantRun) => { await projection?.({ run: value, journalEntry: { type: 'run.paused' } } as Parameters<AssistantRunProjection>[0]) } }
}

it('launches only after a user command, defaults to no background permission, and suppresses double start', async () => {
  const fx = fixture(); const open = jest.fn()
  let finish!: (run: AssistantRun) => void
  fx.mocks.start.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const view = await render(<AgentTasksScreen runtime={fx.runtime} conversationId="chat" onOpenRun={open} onManageAgents={() => {}} />)
  await waitFor(() => expect(view.getByLabelText('agentTasks.request')).toBeTruthy())
  expect(fx.mocks.start).not.toHaveBeenCalled()
  await fireEvent.changeText(view.getByLabelText('agentTasks.request'), 'Find sources')
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.start' }))
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.start' }))
  expect(fx.mocks.start).toHaveBeenCalledTimes(1)
  expect(fx.mocks.start).toHaveBeenCalledWith({ conversationId: 'chat', agentId: 'agent', text: 'Find sources', background: false, taskKind: 'chat' })
  await act(async () => finish(fx.run))
  expect(open).toHaveBeenCalledWith('run-1')
  await view.unmount(); expect(fx.unsubscribe).toHaveBeenCalled()
})

it('notification landing reads only; explicit resume calls the facade once', async () => {
  const fx = fixture()
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('agentTasks.reason.process_restart')).toBeTruthy())
  expect(view.getByText('[source-1] Official source\nhttps://example.com/')).toBeTruthy()
  expect(fx.mocks.resume).not.toHaveBeenCalled(); expect(fx.mocks.approve).not.toHaveBeenCalled(); expect(fx.mocks.setBackground).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.resume' }))
  expect(fx.mocks.resume).toHaveBeenCalledWith('run-1')
  await view.unmount()
})

it('approves the exact rendered identity and refuses approval when parameters cannot be previewed', async () => {
  const pending: NonNullable<AssistantRun['pendingModelOperation']> = { schema: 'islemind.pending-model-operation.v1',
    runId: asAssistantRunId('run-1'), callId: 'call-1', idempotencyKey: 'effect-1', requestedAt: 1, stepIndex: 0, maxSteps: 24,
    continuationMode: 'native', continuationOutputText: '', continuationRequest: { schema: CHAT_REQUEST_SCHEMA,
      conversationId: 'chat', providerId: 'provider', model: 'model', messages: [], generationParameterSources: {} },
    operationId: 'write', catalogRevision: 'catalog-1', argumentDigest: 'args-1',
    continuationToken: 'token-1', continuationDigest: 'digest-1', continuationState: { call: { operationId: 'write', arguments: { destination: 'draft' } } } }
  const fx = fixture({ status: 'awaiting-confirmation', pendingModelOperation: pending })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByRole('button', { name: 'agentTasks.approve' })).toBeTruthy())
  expect(fx.mocks.approve).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.approve' }))
  expect(fx.mocks.approve).toHaveBeenCalledWith('run-1', true, { continuationToken: 'token-1', continuationDigest: 'digest-1' })
  await act(async () => fx.emit({ ...fx.run, journalSequence: 3, pendingModelOperation: { ...fx.run.pendingModelOperation!, continuationState: { call: { data: 'x'.repeat(20_000) } } } }))
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.approve' }))
  expect(fx.mocks.approve).toHaveBeenCalledTimes(1)
  expect(view.getByText('agentTasks.unavailablePreview')).toBeTruthy()
  await view.unmount()
})

it('legacy and uncertain runs never offer resume; completed output saves only after explicit action', async () => {
  const fx = fixture({ engineVersion: undefined, status: 'succeeded', result: { outputText: 'A sourced draft [1]', streamEventCount: 1 } })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('agentTasks.legacy')).toBeTruthy())
  expect(view.queryByRole('button', { name: 'agentTasks.resume' })).toBeNull()
  expect(fx.mocks.saveDocument).not.toHaveBeenCalled()
  await fireEvent.changeText(view.getByLabelText('agentTasks.documentTitle'), 'Reviewed result')
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.saveDocument' }))
  expect(fx.mocks.saveDocument).toHaveBeenCalledWith('run-1', 'Reviewed result')
  await view.unmount()
  const uncertain = fixture({ lifecycleCheckpoint: { recovery: 'reconciliation-required', effectCertainty: 'uncertain' } as AssistantRun['lifecycleCheckpoint'] })
  const other = await render(<AgentRunScreen runtime={uncertain.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(other.getByText('agentTasks.uncertain')).toBeTruthy())
  expect(other.queryByRole('button', { name: 'agentTasks.resume' })).toBeNull()
  await other.unmount()
})
