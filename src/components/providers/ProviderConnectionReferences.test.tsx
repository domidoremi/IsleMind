import { act, fireEvent, render, waitFor } from '@testing-library/react-native'
import { ProviderConnectionReferences } from './ProviderConnectionReferences'
import { useSettingsStore } from '@/store/settingsStore'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'
import type { ProviderConnectionReferences as Report } from '@/core'
import type { ProviderConnectionReferencePort } from '@/presentation/features/settings/providerConnectionReferencePort'

let mockTheme: CanonicalThemeId = 'minimal'
let mockMode: 'light' | 'dark' = 'light'
const mockPush = jest.fn()
const mockLeave = jest.fn(async (action: () => void) => action())
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { count?: number }) => options?.count === undefined ? key : `${key} ${options.count}` }) }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: jest.requireActual('@/theme/colors').getColors(mockMode, mockTheme) }) }))
jest.mock('@/components/settings/SettingsEditBoundary', () => ({ useSettingsLeave: () => mockLeave }))
jest.mock('@/bootstrap/providerModelAvailabilityRuntime', () => ({ providerModelAvailabilityRuntime: {}, withProviderModelAvailabilityChanges: async (_ids: string[], work: () => Promise<unknown>) => work() }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text } = jest.requireActual('react-native')
  return { IslePressable: MockPressable, IsleButton: ({ label, busy, disabled, ...props }: any) =>
    <MockPressable {...props} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label}><Text>{label}</Text></MockPressable> }
})
const initial = useSettingsStore.getState()
const report: Report = {
  providerIds: ['A'], capturedAt: 123,
  groups: [{ kind: 'routing', total: 1, truncated: false, items: [{ kind: 'routing', id: 'route', label: 'Route work',
    targets: [{ providerId: 'A', model: 'Alias', role: 'primary' }] }] }],
  conversations: { savedInspected: 80, savedRemaining: 0, unreadable: 0, localDrafts: 1 },
}
let port: ProviderConnectionReferencePort
beforeEach(() => {
  jest.clearAllMocks()
  mockMode = 'light'; mockTheme = 'minimal'
  mockLeave.mockImplementation(async action => action())
  port = { load: jest.fn(async () => report) }
  useSettingsStore.setState({ ...initial, providers: [{ id: 'A', name: 'Exact connection', type: 'openai', enabled: false, apiKey: '', models: [] }] }, true)
})
afterEach(() => useSettingsStore.setState(initial, true))

it.each(CANONICAL_THEME_IDS)('loads %s references only on demand and retains expansion when light changes to dark', async theme => {
  mockTheme = theme
  const tree = () => <ProviderConnectionReferences providerId="A" port={port} />
  const view = await render(tree())
  expect(port.load).not.toHaveBeenCalled()
  await fireEvent.press(view.getByTestId('provider-references-toggle'))
  await waitFor(() => expect(view.getByText('Route work')).toBeTruthy())
  mockMode = 'dark'
  await view.rerender(tree())
  expect(view.getByText('Route work')).toBeTruthy()
  expect(view.getByTestId('provider-references-toggle').props.accessibilityState.expanded).toBe(true)
  expect(port.load).toHaveBeenCalledTimes(1)
  expect(useSettingsStore.getState().providers[0].enabled).toBe(false)
  expect(mockPush).not.toHaveBeenCalled()
})

it('uses the existing settings leave guard before opening the exact referenced template', async () => {
  const view = await render(<ProviderConnectionReferences providerId="A" port={port} />)
  await fireEvent.press(view.getByTestId('provider-references-toggle'))
  await waitFor(() => expect(view.getByText('Route work')).toBeTruthy())
  mockLeave.mockImplementationOnce(async () => undefined)
  await fireEvent.press(view.getByTestId('provider-reference-routing-route'))
  expect(mockPush).not.toHaveBeenCalled()
  await fireEvent.press(view.getByTestId('provider-reference-routing-route'))
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/settings/routing', params: { planId: 'route' } })
})

it('does not replace a failed initial read with a no-reference claim and permits retry', async () => {
  ;(port.load as jest.Mock).mockRejectedValueOnce(Error('read failed'))
  const view = await render(<ProviderConnectionReferences providerId="A" port={port} />)
  await fireEvent.press(view.getByTestId('provider-references-toggle'))
  await waitFor(() => expect(view.getByText('connectionReferences.loadFailed')).toBeTruthy())
  expect(view.queryByText('connectionReferences.none')).toBeNull()
  await fireEvent.press(view.getByTestId('provider-references-refresh'))
  await waitFor(() => expect(view.getByText('Route work')).toBeTruthy())
  expect(view.queryByText('connectionReferences.loadFailed')).toBeNull()
})

it('labels incomplete empty results as unknown, with the remaining and unreadable counts', async () => {
  ;(port.load as jest.Mock).mockResolvedValueOnce({ ...report, groups: [], conversations: { ...report.conversations, savedRemaining: 2, unreadable: 3 } })
  const view = await render(<ProviderConnectionReferences providerId="A" port={port} />)
  await fireEvent.press(view.getByTestId('provider-references-toggle'))
  await waitFor(() => expect(view.getByText('connectionReferences.noKnownReferences')).toBeTruthy())
  expect(view.getByText('connectionReferences.remaining 2')).toBeTruthy()
  expect(view.getByText('connectionReferences.unreadable 3')).toBeTruthy()
  expect(view.queryByText('connectionReferences.none')).toBeNull()
})

it('discards a late result from the old connection and aborts its read', async () => {
  let resolve!: (value: Report) => void
  ;(port.load as jest.Mock).mockReturnValueOnce(new Promise<Report>(yes => { resolve = yes }))
    .mockResolvedValueOnce({ ...report, providerIds: ['B'], groups: [] })
  const view = await render(<ProviderConnectionReferences providerId="A" port={port} />)
  await fireEvent.press(view.getByTestId('provider-references-toggle'))
  const signal = (port.load as jest.Mock).mock.calls[0][1] as AbortSignal
  await view.rerender(<ProviderConnectionReferences providerId="B" port={port} />)
  await act(() => resolve(report))
  expect(signal.aborted).toBe(true)
  expect(view.queryByText('Route work')).toBeNull()
  await waitFor(() => expect(view.getByText('connectionReferences.none')).toBeTruthy())
})
