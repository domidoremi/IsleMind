import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ModelAvailabilityScreen } from './ModelAvailabilityScreen'
import type { ProviderModelHistoryPage } from '@/modules/providers'

const mockNetwork = { isConnected: true, isInternetReachable: true }
const mockQuery = jest.fn()
const mockCurrent = jest.fn().mockResolvedValue([])
const mockRefresh = jest.fn().mockResolvedValue(undefined)
const mockRetest = jest.fn().mockResolvedValue(undefined)
const mockProvider = { id: 'p', name: 'Provider', type: 'openai', enabled: true, apiKey: '', models: ['m'], credentialGroups: [{ id: 'default', label: 'Real default', enabled: true }] }
const mockState = { providers: [mockProvider], settings: {} }
const mockTranslate = (key: string) => key
const mockSelectRender = jest.fn()
let mockButtonPresses: Record<string, () => void> = {}

const screenProps = { pageSize: 100, getProviderTestModel: () => 'm', availability: {
  queryHistory: mockQuery, listCurrentModels: mockCurrent, refresh: mockRefresh, retest: mockRetest,
} }
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: Object.assign(
  (select: (state: unknown) => unknown) => select(mockState), { getState: () => mockState },
) }))
jest.mock('expo-network', () => ({ useNetworkState: () => mockNetwork }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors('light', 'minimal')
  return { colors, design: colors.design, canonicalThemeId: 'minimal', isLiquidGlass: false }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }))
jest.mock('@/components/ui/isle', () => {
  const actual = jest.requireActual('@/components/ui/isle')
  return { ...actual, IsleSelect: (props: unknown) => { mockSelectRender(); return actual.IsleSelect(props) },
    IsleButton: (props: any) => { mockButtonPresses[props.label] = props.onPress; return actual.IsleButton(props) },
  }
})
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

const counts = { total: 2, success: 2, failure: 0, applied: 2, preserved: 0, superseded: 0, invalidated: 0 }
const cursor = { schema: 'islemind.model-history-cursor.v1', filterKey: 'filter', highWaterId: 2, observedAt: 20, id: 2 } as const
function page(id: number, more = false): ProviderModelHistoryPage {
  return { counts, highWaterId: 2, ...(more ? { nextCursor: cursor } : {}), items: [{
    id, providerId: 'p', credentialSource: { kind: 'primary' }, protocolAdapterId: 'openai-chat', endpointVariant: 'direct',
    eventKey: `event-${id}`, modelId: `model-${id}`, scopeId: 'scope', epoch: 'epoch', operationId: 'operation', orderToken: 1,
    observedAt: id * 10, source: 'probe', outcome: 'success', classification: 'probe_success', effect: 'applied', availabilityAfter: 'available',
  }] }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockButtonPresses = {}
  mockCurrent.mockResolvedValue([])
  mockRefresh.mockReset().mockResolvedValue(undefined)
  mockRetest.mockReset().mockResolvedValue(undefined)
  mockProvider.enabled = true
  mockNetwork.isConnected = true
  mockNetwork.isInternetReachable = true
  mockQuery.mockImplementation(({ filter, cursor: after }) => Promise.resolve(filter.outcome === 'failure'
    ? { counts, items: [], highWaterId: 2 } : after ? page(1) : page(2, true)))
})

it('does not rerender the filter controls when the first data page settles', async () => {
  let finishPage!: (value: ProviderModelHistoryPage) => void
  const pending = new Promise<ProviderModelHistoryPage>(resolve => { finishPage = resolve })
  mockQuery.mockReturnValue(pending)
  const view = await render(<ModelAvailabilityScreen {...screenProps} />)
  expect(mockSelectRender).not.toHaveBeenCalled()
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  const initialFilterRenders = mockSelectRender.mock.calls.length
  expect(initialFilterRenders).toBe(4)
  await act(async () => { finishPage(page(2)); await pending })
  await waitFor(() => expect(view.getByText('model-2')).toBeTruthy())
  expect(mockSelectRender).toHaveBeenCalledTimes(initialFilterRenders)
  await view.unmount()
})

it('virtualizes current summaries with history instead of mounting a whole current page in the header', async () => {
  mockCurrent.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({
    ...page(1).items[0], modelId: `current-${index}`, availability: 'available', advertisement: 'present',
    lastAppliedOrder: 1, updatedAt: 1, invalidated: false,
  })))
  const view = await render(<ModelAvailabilityScreen {...screenProps} />)
  await waitFor(() => expect(view.getByText('Provider · current-0')).toBeTruthy())
  expect(mockCurrent).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }))
  expect(view.queryByText('Provider · current-99')).toBeNull()
  await view.unmount()
})

it('renders one bounded page and passes the SQL high-water cursor without accumulating history', async () => {
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await waitFor(() => expect(view.getByText('model-2')).toBeTruthy())
  expect(mockQuery).toHaveBeenCalledWith({ filter: { providerId: 'p' }, limit: 100, cursor: undefined })
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.older' }))
  await waitFor(() => expect(view.getByText('model-1')).toBeTruthy())
  expect(view.queryByText('model-2')).toBeNull()
  expect(mockQuery).toHaveBeenCalledWith({ filter: { providerId: 'p' }, limit: 100, cursor })
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'exact-model')
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.applyFilters' }))
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith({ filter: { providerId: 'p', modelId: 'exact-model' }, limit: 100, cursor: undefined }))
  expect(mockCurrent).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'p', modelId: 'exact-model', limit: 100 }))
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.allSources' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.source.probe' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.applyFilters' }))
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith({ filter: { providerId: 'p', modelId: 'exact-model', source: 'probe' }, limit: 100, cursor: undefined }))
  await view.unmount()
})

it('keeps offline state separate, never dispatches a probe offline, and aborts an in-flight probe on unmount', async () => {
  mockNetwork.isConnected = false
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await waitFor(() => expect(view.getByText('model-2')).toBeTruthy())
  expect(view.getByText(/modelAvailability.offlineHint/)).toBeTruthy()
  expect(view.getByText('modelAvailability.historyHint')).toHaveStyle({ fontSize: 14, lineHeight: 20 })
  expect(view.getByText('modelAvailability.historyHint').props.numberOfLines).toBeUndefined()
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(mockRetest).not.toHaveBeenCalled()
  mockNetwork.isConnected = true
  let signal: AbortSignal | undefined
  mockRetest.mockImplementationOnce((input) => new Promise<void>((resolve) => {
    signal = input.signal; signal!.addEventListener('abort', () => resolve(), { once: true })
  }))
  await view.rerender(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(mockRetest).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'p', model: 'm' }))
  await act(async () => { await view.unmount() })
  expect(signal?.aborted).toBe(true)
})

it('surfaces storage failure without displaying an unavailable or retired model', async () => {
  mockQuery.mockRejectedValue(new Error('storage unavailable'))
  const view = await render(<ModelAvailabilityScreen {...screenProps} />)
  await waitFor(() => expect(view.getByText('modelAvailability.readFailed')).toBeTruthy())
  expect(view.queryByText('modelAvailability.retired')).toBeNull()
  expect(view.queryByText('modelAvailability.unavailable')).toBeNull()
  await view.unmount()
})

it('ignores a late history read after the user applies a different model filter', async () => {
  let finishOldPage!: (value: ProviderModelHistoryPage) => void
  mockQuery.mockImplementation(({ filter }) => filter.outcome === 'failure'
    ? Promise.resolve({ counts, items: [], highWaterId: 2 })
    : filter.modelId ? Promise.resolve(page(1))
      : new Promise<ProviderModelHistoryPage>((resolve) => { finishOldPage = resolve }))
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await waitFor(() => expect(mockQuery).toHaveBeenCalled())
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'new-filter')
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.applyFilters' }))
  await waitFor(() => expect(view.getByText('model-1')).toBeTruthy())
  await act(async () => { finishOldPage(page(2)); await Promise.resolve() })
  expect(view.queryByText('model-2')).toBeNull()
  expect(view.getByText('model-1')).toBeTruthy()
  await view.unmount()
})

it.each(['unmount', 'disabled', 'offline'])('does not dispatch through a retained model-check callback after %s', async change => {
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  const start = mockButtonPresses['modelAvailability.retestProvider']
  if (change === 'unmount') await view.unmount()
  else {
    if (change === 'disabled') mockProvider.enabled = false
    else mockNetwork.isConnected = false
    await view.rerender(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  }
  await act(() => start())
  expect(mockRetest).not.toHaveBeenCalled()
  if (change !== 'unmount') await view.unmount()
})

it('aborts a check when its displayed target changes, suppresses old feedback, and holds single-flight until it settles', async () => {
  let settle!: () => void
  let signal!: AbortSignal
  mockRetest.mockImplementationOnce(input => new Promise<void>(resolve => { signal = input.signal; settle = resolve }))
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'other model')
  expect(signal.aborted).toBe(true)
  await act(() => mockButtonPresses['modelAvailability.retestProvider']())
  expect(mockRetest).toHaveBeenCalledTimes(1)
  await act(() => settle())
  expect(view.queryByText('modelAvailability.operation.recorded')).toBeNull()
  expect(view.queryByText('modelAvailability.operation.failed')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(mockRetest).toHaveBeenCalledTimes(2)
  await view.unmount()
})

it.each(['resolve', 'reject'])('cancels a check without claiming rollback and releases busy state only when it will %s', async outcome => {
  let settle!: () => void
  let fail!: (error: Error) => void
  let signal!: AbortSignal
  mockRetest.mockImplementationOnce(input => new Promise<void>((resolve, reject) => {
    signal = input.signal; settle = resolve; fail = reject
  }))
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.cancelCheck' }))
  expect(signal.aborted).toBe(true)
  expect(view.getByRole('button', { name: 'modelAvailability.cancellingCheck' })).toBeDisabled()
  await act(() => mockButtonPresses['modelAvailability.retestProvider']())
  expect(mockRetest).toHaveBeenCalledTimes(1)
  await act(() => { if (outcome === 'resolve') settle(); else fail(new Error('aborted')) })
  expect(view.queryByText('modelAvailability.operation.recorded')).toBeNull()
  expect(view.getByText('modelAvailability.operation.cancelled')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(mockRetest).toHaveBeenCalledTimes(2)
  await view.unmount()
})

it('does not let an earlier cancel callback stop a newer refresh operation', async () => {
  let finishFirst!: () => void
  let finishSecond!: () => void
  let secondSignal!: AbortSignal
  mockRefresh.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve }))
    .mockImplementationOnce(input => new Promise<void>(resolve => { secondSignal = input.signal; finishSecond = resolve }))
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.refreshModels' }))
  const oldCancel = mockButtonPresses['modelAvailability.cancelCheck']
  await act(() => finishFirst())
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.refreshModels' }))
  await act(() => oldCancel())
  expect(secondSignal.aborted).toBe(false)
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.cancelCheck' }))
  expect(secondSignal.aborted).toBe(true)
  await act(() => finishSecond())
  expect(view.getByText('modelAvailability.operation.cancelled')).toBeTruthy()
  await view.unmount()
})

it.each(['refresh', 'model'])('cancels the %s operation and retains its exact credential/model input', async kind => {
  let finish!: () => void
  const request = jest.fn(input => new Promise<void>(resolve => { finish = resolve }))
  if (kind === 'refresh') mockRefresh.mockImplementationOnce(request)
  else mockRetest.mockImplementationOnce(request)
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'exact-model')
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.allCredentials' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.primaryCredential' }))
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: kind === 'refresh' ? 'modelAvailability.refreshModels' : 'modelAvailability.retestModel' }))
  expect(request).toHaveBeenCalledWith({
    providerId: 'p', credentialSource: { kind: 'primary' }, signal: expect.any(AbortSignal),
    ...(kind === 'model' ? { model: 'exact-model' } : {}),
  })
  const signal = request.mock.calls[0][0].signal as AbortSignal
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.cancelCheck' }))
  expect(signal.aborted).toBe(true)
  await act(() => finish())
  expect(view.getByText('modelAvailability.operation.cancelled')).toBeTruthy()
  expect(view.queryByText('modelAvailability.operation.recorded')).toBeNull()
  await view.unmount()
})

it('does not reuse a result after the target changes and returns to the same filter text', async () => {
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(view.getByText('modelAvailability.operation.recorded')).toBeTruthy()
  await fireEvent.press(view.getByRole('button', { name: 'usage.filters' }))
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'other')
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), '')
  expect(view.queryByText('modelAvailability.operation.recorded')).toBeNull()
  await view.unmount()
})

it('keeps a genuine check failure distinct from cancellation and permits a fresh retry', async () => {
  mockRetest.mockRejectedValueOnce(new Error('provider failure'))
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(view.getByText('modelAvailability.operation.failed')).toBeTruthy()
  expect(view.queryByText('modelAvailability.operation.cancelled')).toBeNull()
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.retestProvider' }))
  expect(view.getByText('modelAvailability.operation.recorded')).toBeTruthy()
  expect(view.queryByText('modelAvailability.operation.failed')).toBeNull()
  await view.unmount()
})

it('does not reload availability or publish a late result after the check screen unmounts', async () => {
  let finish!: () => void
  let signal!: AbortSignal
  mockRefresh.mockImplementationOnce(input => new Promise<void>(resolve => { signal = input.signal; finish = resolve }))
  const view = await render(<ModelAvailabilityScreen {...screenProps} initialProviderId="p" />)
  await fireEvent.press(view.getByRole('button', { name: 'settingsWorkspace.advanced' }))
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.refreshModels' }))
  const cancel = mockButtonPresses['modelAvailability.cancelCheck']
  const reads = mockQuery.mock.calls.length
  await view.unmount()
  expect(signal.aborted).toBe(true)
  await act(() => { cancel(); finish() })
  expect(mockQuery).toHaveBeenCalledTimes(reads)
  expect(mockRefresh).toHaveBeenCalledTimes(1)
})
