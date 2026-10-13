import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { AgentTasksScreen } from './AgentTasksScreen'
import { AgentRunScreen } from './AgentRunScreen'
import { createAgentDefinition, type AssistantRun, type AssistantRunProjection, type RunJournalEntry, type OperationActivityPage } from '@/modules/assistant-runtime'
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
  const projections = new Set<AssistantRunProjection>()
  const unsubscribe = jest.fn()
  const runtime = { definitions: { list: jest.fn(async () => [definition]) }, listRuns: jest.fn(async () => [run]),
    get: jest.fn(async () => run), budget: jest.fn(async () => createRunBudget('run-1')),
    sources: jest.fn(async () => [{ type: 'citation' as const, citationId: 'source-1', title: 'Official source', url: 'https://example.com/' }]),
    activities: jest.fn(async (): Promise<OperationActivityPage> => ({ entries: [] })),
    effects: { list: jest.fn(async () => ({ entries: [] })), subscribe: jest.fn(() => () => {}) },
    subscribe: jest.fn((listener: AssistantRunProjection) => { projections.add(listener); return () => { projections.delete(listener); unsubscribe() } }),
    backgroundEnabled: jest.fn(() => false), setBackground: jest.fn(async () => {}),
    start: jest.fn(async () => run), resume: jest.fn(async () => run), approve: jest.fn(async () => run),
    pause: jest.fn(async () => ({ ok: true, value: run })), cancel: jest.fn(async () => ({ ok: true, value: run })),
    steer: jest.fn(async () => ({ ok: true, value: run })), saveDocument: jest.fn(async () => ({})),
  }
  return { runtime: runtime as unknown as AgentTaskPort, mocks: runtime, run, unsubscribe,
    emit: async (value: AssistantRun, entry: Partial<RunJournalEntry> = { type: 'run.paused' }) => {
      for (const projection of projections) await projection({ run: value, journalEntry: entry } as Parameters<AssistantRunProjection>[0])
    } }
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

it('shows a sanitized launch refusal without losing the draft or retrying', async () => {
  const fx = fixture(); const open = jest.fn()
  fx.mocks.start.mockRejectedValue(new Error('Agent provider is unavailable. Authorization: Bearer sk-synthetic-secret'))
  const view = await render(<AgentTasksScreen runtime={fx.runtime} conversationId="chat" onOpenRun={open} onManageAgents={() => {}} />)
  await waitFor(() => expect(view.getByLabelText('agentTasks.request')).toBeTruthy())
  await fireEvent.changeText(view.getByLabelText('agentTasks.request'), 'Keep this task')
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.start' }))
  await waitFor(() => expect(view.getByText(/Agent provider is unavailable/)).toBeTruthy())
  expect(JSON.stringify(view.toJSON())).not.toContain('sk-synthetic-secret')
  expect(view.getByLabelText('agentTasks.request').props.value).toBe('Keep this task')
  expect(open).not.toHaveBeenCalled()
  expect(fx.mocks.start).toHaveBeenCalledTimes(1)
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.refresh' }))
  await waitFor(() => expect(view.queryByText(/Agent provider is unavailable/)).toBeNull())
  expect(fx.mocks.start).toHaveBeenCalledTimes(1)
  await view.unmount()
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
    runId: asAssistantRunId('run-1'), callId: 'call-1', idempotencyKey: 'effect-1', requestedAt: Date.now(), stepIndex: 0, maxSteps: 24,
    continuationMode: 'native', continuationOutputText: '', continuationRequest: { schema: CHAT_REQUEST_SCHEMA,
      conversationId: 'chat', providerId: 'provider', model: 'model', messages: [], generationParameterSources: {} },
    operationId: 'write', catalogRevision: 'catalog-1', argumentDigest: 'args-1',
    continuationToken: 'token-1', continuationDigest: 'digest-1', continuationState: { call: { operationId: 'write', arguments: { destination: 'draft', password: 'private-value' },
      providerMetadata: { thoughtSignature: 'private-signature' } } } }
  const fx = fixture({ status: 'awaiting-confirmation', pendingModelOperation: pending })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByRole('button', { name: 'agentTasks.approve' })).toBeTruthy())
  expect(fx.mocks.approve).not.toHaveBeenCalled()
  expect(JSON.stringify(view.toJSON())).not.toMatch(/private-signature|private-value|token-1|digest-1/)
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.approve' }))
  expect(fx.mocks.approve).toHaveBeenCalledWith('run-1', true, { continuationToken: 'token-1', continuationDigest: 'digest-1' })
  await act(async () => fx.emit({ ...fx.run, journalSequence: 3, pendingModelOperation: { ...fx.run.pendingModelOperation!, continuationState: { call: { data: 'x'.repeat(20_000) } } } }))
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.approve' }))
  expect(fx.mocks.approve).toHaveBeenCalledTimes(1)
  expect(view.getByText('agentTasks.unavailablePreview')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.decline' }))
  expect(fx.mocks.approve).toHaveBeenLastCalledWith('run-1', false, { continuationToken: 'token-1', continuationDigest: 'digest-1' })
  await view.unmount()
})

it('streams output without per-token metadata reads and ignores an older snapshot', async () => {
  const fx = fixture({ status: 'running' })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(fx.mocks.activities).toHaveBeenCalled())
  expect(view.queryByText('agentTasks.noActivities')).toBeNull()
  expect(view.queryByTestId('agent-activities-toggle')).toBeNull()
  expect(view.queryByTestId('agent-effects-toggle')).toBeNull()
  const before = fx.mocks.budget.mock.calls.length
  const reads = fx.mocks.activities.mock.calls.length
  await act(async () => fx.emit({ ...fx.run, journalSequence: 10, checkpoint: { outputText: 'Live output', streamEventCount: 1 } },
    { type: 'stream.event', data: { eventType: 'text-delta' } }))
  expect(view.getByText('Live output')).toBeTruthy()
  expect(fx.mocks.budget).toHaveBeenCalledTimes(before)
  expect(fx.mocks.activities).toHaveBeenCalledTimes(reads)
  await act(async () => fx.emit({ ...fx.run, journalSequence: 5, checkpoint: { outputText: 'Stale output', streamEventCount: 1 } },
    { type: 'stream.event', data: { eventType: 'text-delta' } }))
  expect(view.queryByText('Stale output')).toBeNull()
  await view.unmount()
})

it('keeps each receipt independent of overall success and updates only the matching activity', async () => {
  const fx = fixture({ status: 'running', lifecycleCheckpoint: undefined })
  const entries: OperationActivityPage['entries'] = ['done', 'error', 'cancelled', 'pending', 'skipped', 'running'].map((status, index) => ({
    sequence: index + 1, firstSequence: index + 1,
    trace: { id: `op-${index}`, type: 'tool', title: `tool-${index}`, status: status as 'done', content: `result-${index}` },
  }))
  fx.mocks.activities.mockResolvedValue({ entries })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByTestId('agent-activities-toggle')).toBeTruthy())
  expect(view.queryByText('tool-0')).toBeNull()
  await fireEvent.press(view.getByTestId('agent-activities-toggle'))
  expect(view.getByText('tool-5')).toBeTruthy()
  fx.mocks.activities.mockResolvedValue({ entries: entries.map((entry, index) => index !== 5 ? entry
    : { ...entry, trace: { ...entry.trace, status: 'error', content: 'Device refused write' } }) })
  await act(async () => fx.emit({ ...fx.run, status: 'succeeded', journalSequence: 20 }, { type: 'model-operation.selected' }))
  await waitFor(() => expect(view.getByText('Device refused write')).toBeTruthy())
  expect(view.getAllByText('agentTasks.activityState.done')).toHaveLength(1)
  expect(view.getAllByText('agentTasks.activityState.error')).toHaveLength(2)
  expect(view.getByText('agentTasks.activityState.notExecuted')).toBeTruthy()
  expect(view.getByText('agentTasks.activityState.cancelled')).toBeTruthy()
  expect(view.getByText('agentTasks.activityState.skipped')).toBeTruthy()
  expect(view.queryByText('result-5')).toBeNull()
  await view.unmount()
})

it('pages bounded activities and reports read failure instead of an empty success state', async () => {
  const fx = fixture()
  fx.mocks.activities.mockResolvedValueOnce({ entries: [], before: 30 }).mockRejectedValueOnce(new Error('read failed'))
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByTestId('agent-activities-toggle')).toBeTruthy())
  await fireEvent.press(view.getByTestId('agent-activities-toggle'))
  await waitFor(() => expect(view.getByRole('button', { name: 'agentTasks.olderActivities' })).toBeTruthy())
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.olderActivities' }))
  await waitFor(() => expect(view.getByText('agentTasks.activityLoadFailed')).toBeTruthy())
  expect(fx.mocks.activities).toHaveBeenLastCalledWith('run-1', 30)
  expect(view.queryByText('agentTasks.noActivities')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.latestActivities' }))
  await waitFor(() => expect(view.queryByTestId('agent-activities-toggle')).toBeNull())
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

it('an expired confirmation offers only non-executing actions and surfaces the facade refusal', async () => {
  const pending = { schema: 'islemind.pending-model-operation.v1', runId: asAssistantRunId('run-1'), callId: 'call-1', idempotencyKey: 'effect-1',
    requestedAt: Date.now() - 16 * 60_000, stepIndex: 0, maxSteps: 24, continuationMode: 'native', continuationOutputText: '',
    continuationRequest: { schema: CHAT_REQUEST_SCHEMA, conversationId: 'chat', providerId: 'provider', model: 'model', messages: [], generationParameterSources: {} },
    operationId: 'write', catalogRevision: 'catalog-1', argumentDigest: 'args-1', continuationToken: 'token-1', continuationDigest: 'digest-1',
    continuationState: { call: { operationId: 'write', arguments: { destination: 'draft' } } } } as NonNullable<AssistantRun['pendingModelOperation']>
  const fx = fixture({ status: 'awaiting-confirmation', pendingModelOperation: pending })
  fx.mocks.approve.mockRejectedValueOnce(new Error('The pending model-operation confirmation is invalid.'))
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('agentTasks.confirmationExpired')).toBeTruthy())
  expect(view.getByText('agentTasks.confirmationExpiredHint')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'agentTasks.approve' })).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.returnExpired' }))
  // The Harness, not the view, turns this into a not-executed receipt.
  expect(fx.mocks.approve).toHaveBeenCalledWith('run-1', true, { continuationToken: 'token-1', continuationDigest: 'digest-1' })
  await waitFor(() => expect(view.getByText('agentTasks.commandRefused')).toBeTruthy())
  expect(view.getByText('The pending model-operation confirmation is invalid.')).toBeTruthy()
  await view.unmount()
})

it.each(['reconciliation-required', 'resumable'] as const)('an uncertain pause (%s) cannot offer resume and still allows stopping', async recovery => {
  const fx = fixture({ lifecycleCheckpoint: { recovery, effectCertainty: 'uncertain', waitingReason: 'process_restart' } as AssistantRun['lifecycleCheckpoint'] })
  fx.mocks.cancel.mockResolvedValueOnce({ ok: false, error: { code: 'run_not_active', message: 'Already stopped elsewhere' } } as never)
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('agentTasks.recoveryTitle')).toBeTruthy())
  expect(view.getByText('agentTasks.recoveryReconcile')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'agentTasks.resume' })).toBeNull()
  expect(view.queryByText('agentTasks.reason.process_restart')).toBeNull()
  expect(view.queryByLabelText('agentTasks.steer')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.cancel' }))
  expect(fx.mocks.cancel).toHaveBeenCalledWith('run-1')
  await waitFor(() => expect(view.getByText('Already stopped elsewhere')).toBeTruthy())
  await view.unmount()
})

it.each(['succeeded', 'failed', 'cancelled'] as const)('terminal %s runs do not invite continuation after a process restart', async status => {
  const fx = fixture({ status })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText(`agentTasks.status.${status}`)).toBeTruthy())
  expect(view.queryByText('agentTasks.reason.process_restart')).toBeNull()
  expect(view.queryByRole('button', { name: 'agentTasks.resume' })).toBeNull()
  expect(fx.mocks.resume).not.toHaveBeenCalled()
  await view.unmount()
})

it('failed runs show the durable error; receipts show confirmed fields and demand review for partial effects', async () => {
  const fx = fixture({ status: 'failed', failure: { code: 'activity_failed', message: 'Device storage unavailable' } })
  fx.mocks.effects.list.mockResolvedValue({ entries: [
    { taskId: 'task-1', toolId: 'android.files.apply_operations', startedAt: 1, state: 'cancelled',
      intent: { id: 'saf-1', kind: 'file', action: 'copy', sourceUri: 'content://p/tree/a/document/src', targetParentUri: 'content://p/tree/a', targetName: 'copy.txt' },
      receipt: { id: 'saf-1', status: 'cancelled', effect: 'partial', bytesCopied: 65536, targetUri: 'content://p/tree/a/document/copy', completedSteps: ['created'], reason: 'cancelled' } },
    { taskId: 'task-1', toolId: 'android.files.apply_operations', startedAt: 2, state: 'uncertain',
      intent: { id: 'saf-2', kind: 'file', action: 'mkdir', targetParentUri: 'content://p/tree/a', targetName: 'folder' } },
  ] } as never)
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('Device storage unavailable')).toBeTruthy())
  expect(view.getByText('agentTasks.runErrorHint')).toBeTruthy()
  await waitFor(() => expect(view.getByText('65536')).toBeTruthy())
  expect(view.getByText('agentTasks.fileEffect.partial')).toBeTruthy()
  expect(view.getByText('agentTasks.effectReview')).toBeTruthy()
  expect(view.getByText('created')).toBeTruthy()
  expect(view.getByText('agentTasks.effectMissing')).toBeTruthy()
  expect(view.getByText('agentTasks.effectState.uncertain')).toBeTruthy()
  expect(view.queryByText('agentTasks.fileEffect.applied')).toBeNull()
  expect(view.queryByRole('button', { name: 'agentTasks.resume' })).toBeNull()
  await view.unmount()
})

it('maps known receipt codes to not-executed wording and keeps unknown codes verbatim', async () => {
  const fx = fixture({ status: 'running', lifecycleCheckpoint: undefined })
  const trace = (id: string, status: 'error' | 'cancelled' | 'skipped', code: string) => ({ sequence: 1, firstSequence: 1,
    trace: { id, type: 'tool' as const, title: id, status, content: '', metadata: { code, errorCode: code } } })
  fx.mocks.activities.mockResolvedValue({ entries: [trace('expired', 'error', 'confirmation_expired'), trace('denied', 'error', 'authorization_denied'),
    trace('declined', 'cancelled', 'confirmation_declined'), trace('tail', 'skipped', 'batch_stopped'), trace('other', 'error', 'vendor_specific')] })
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('agentTasks.code.confirmation_expired')).toBeTruthy())
  expect(view.queryByText('agentTasks.code.batch_stopped')).toBeNull()
  await fireEvent.press(view.getByTestId('agent-activities-toggle'))
  for (const code of ['authorization_denied', 'confirmation_declined', 'batch_stopped']) expect(view.getByText(`agentTasks.code.${code}`)).toBeTruthy()
  expect(view.getByText('vendor_specific')).toBeTruthy()
  expect(view.queryByText('agentTasks.activityState.done')).toBeNull()
  await view.unmount()
})

it('updates local receipts after run cancellation and pages or fails reads without dispatching anything', async () => {
  const fx = fixture({ status: 'cancelled' })
  let notify!: (id: string) => void
  ;(fx.mocks.effects.subscribe as jest.Mock).mockImplementation(listener => { notify = listener; return () => {} })
  const before = { createdAt: 1, taskId: 'task-1', sequence: 3 }
  const entry = { taskId: 'task-1', toolId: 'android.files.apply_operations', startedAt: 1, state: 'uncertain',
    intent: { id: 'saf-live', kind: 'file', action: 'copy', targetName: 'retained.txt' } }
  fx.mocks.effects.list.mockResolvedValue({ entries: [entry], before } as never)
  const view = await render(<AgentRunScreen runtime={fx.runtime} runId="run-1" onFreshRun={() => {}} onOpenRun={() => {}} />)
  await waitFor(() => expect(view.getByText('agentTasks.effectState.uncertain')).toBeTruthy())
  await fireEvent.press(view.getByTestId('agent-effects-toggle'))
  fx.mocks.effects.list.mockResolvedValue({ entries: [{ ...entry, state: 'failed', receipt: {
    id: 'saf-live', status: 'failed', effect: 'partial', bytesCopied: 123, reason: 'byte_limit',
  } }], before } as never)
  await act(async () => notify('run-1'))
  await waitFor(() => expect(view.getByText('agentTasks.effectState.failed')).toBeTruthy())
  expect(view.getByText('123')).toBeTruthy()
  expect(view.queryByText('agentTasks.effectState.succeeded')).toBeNull()
  fx.mocks.effects.list.mockRejectedValueOnce(new Error('disk read'))
  await fireEvent.press(view.getByRole('button', { name: 'agentTasks.olderActivities' }))
  await waitFor(() => expect(view.getByText('agentTasks.effectLoadFailed')).toBeTruthy())
  expect(fx.mocks.effects.list).toHaveBeenLastCalledWith('run-1', before)
  expect(fx.mocks.resume).not.toHaveBeenCalled()
  expect(fx.mocks.approve).not.toHaveBeenCalled()
  await view.unmount()
})
