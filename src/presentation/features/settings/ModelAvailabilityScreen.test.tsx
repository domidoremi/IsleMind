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

const screenProps = { pageSize: 100, getProviderTestModel: () => 'm', availability: {
  queryHistory: mockQuery, listCurrentModels: mockCurrent, refresh: mockRefresh, retest: mockRetest,
} }
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select(mockState) }))
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
  return { ...actual, IsleSelect: (props: unknown) => { mockSelectRender(); return actual.IsleSelect(props) } }
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
  mockCurrent.mockResolvedValue([])
  mockNetwork.isConnected = true
  mockQuery.mockImplementation(({ filter, cursor: after }) => Promise.resolve(filter.outcome === 'failure'
    ? { counts, items: [], highWaterId: 2 } : after ? page(1) : page(2, true)))
})

it('does not rerender the filter controls when the first data page settles', async () => {
  let finishPage!: (value: ProviderModelHistoryPage) => void
  const pending = new Promise<ProviderModelHistoryPage>(resolve => { finishPage = resolve })
  mockQuery.mockReturnValue(pending)
  const view = await render(<ModelAvailabilityScreen {...screenProps} />)
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
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'exact-model')
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.applyFilters' }))
  await waitFor(() => expect(mockQuery).toHaveBeenCalledWith({ filter: { providerId: 'p', modelId: 'exact-model' }, limit: 100, cursor: undefined }))
  expect(mockCurrent).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'p', modelId: 'exact-model', limit: 100 }))
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
  await fireEvent.changeText(view.getByLabelText('modelAvailability.modelFilter'), 'new-filter')
  await fireEvent.press(view.getByRole('button', { name: 'modelAvailability.applyFilters' }))
  await waitFor(() => expect(view.getByText('model-1')).toBeTruthy())
  await act(async () => { finishOldPage(page(2)); await Promise.resolve() })
  expect(view.queryByText('model-2')).toBeNull()
  expect(view.getByText('model-1')).toBeTruthy()
  await view.unmount()
})
