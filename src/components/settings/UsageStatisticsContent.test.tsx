import { act, fireEvent, render } from '@testing-library/react-native'
import { UsageStatisticsContent, type UsageStatisticsContentProps } from './UsageStatisticsContent'
import { SettingsEditBoundary } from './SettingsEditBoundary'

const mockConfirm = jest.fn()
let mockRemove: (event: { data: { action: unknown } }) => void
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: (_: boolean, callback: typeof mockRemove) => { mockRemove = callback } }))
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: require('@/theme/colors').getColors('light', 'minimal') }) }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('@shopify/flash-list', () => ({ FlashList: ({ data, renderItem, keyExtractor, ListEmptyComponent, ...props }: any) => {
  const View = require('react-native').View
  return <View {...props}>{data.length ? data.map((item: any, index: number) => <View key={keyExtractor(item)}>{renderItem({ item, index })}</View>) : ListEmptyComponent}</View>
} }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable: MockPressable, Text, View } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: MockPressable, IsleChip: Text, IsleToggle: View,
    IsleButton: ({ label, onPress, ...props }: any) => <MockPressable accessibilityRole="button" accessibilityLabel={label} {...props} onPress={() => { onPress?.() }}><Text>{label}</Text></MockPressable>,
    useIsleDialog: () => ({ confirm: mockConfirm }),
  }
})

function props(): UsageStatisticsContentProps {
  return {
    summary: { requests: '0', inputTokens: '0', outputTokens: '0', averageLatency: '-', errorRate: '-' }, trends: [],
    filters: { dateRange: '30d', provider: 'all', model: 'all', status: 'all', requestSource: 'all', includeEstimates: false },
    filterOptions: { dateRanges: [], providers: [], models: [], statuses: [], requestSources: [] },
    onFiltersChange: jest.fn(), activeTab: 'requests', onTabChange: jest.fn(), requests: [], providers: [], models: [], onRequestPress: jest.fn(), onCloseRequestDetail: jest.fn(),
    pricingOverrides: [], pricingProviderOptions: [{ value: 'p', label: 'Provider' }], pricingModelOptions: [{ providerId: 'p', value: 'm', label: 'Model' }],
    onSavePricingOverride: jest.fn().mockResolvedValue(undefined), onDeletePricingOverride: jest.fn(), onExport: jest.fn(), onClear: jest.fn(),
  }
}
const inputLabel = 'Input price, per 1M tokens'
const outputLabel = 'Output price, per 1M tokens'
const page = (value: UsageStatisticsContentProps) => <SettingsEditBoundary><UsageStatisticsContent {...value} /></SettingsEditBoundary>
beforeEach(() => { jest.clearAllMocks(); mockConfirm.mockResolvedValue(false) })
afterEach(() => jest.restoreAllMocks())

it('exposes expanded state on filters and secondary statistics without changing requests or firing other actions', async () => {
  const value = props(), screen = await render(page(value))
  expect(screen.getByTestId('usage-filters-toggle').props.accessibilityState.expanded).toBe(false)
  expect(screen.getByTestId('usage-details-toggle').props.accessibilityState.expanded).toBe(false)
  await fireEvent.press(screen.getByTestId('usage-filters-toggle'))
  await fireEvent.press(screen.getByTestId('usage-details-toggle'))
  expect(screen.getByTestId('usage-filters-toggle').props.accessibilityState.expanded).toBe(true)
  expect(screen.getByTestId('usage-details-toggle').props.accessibilityState.expanded).toBe(true)
  expect(value.onFiltersChange).not.toHaveBeenCalled()
  expect(value.onRequestPress).not.toHaveBeenCalled()
})

it('fills the request sheet reading plane while preserving the existing field insets and redacted values', async () => {
  const value = props()
  value.requestDetail = { status: 'ready', detail: {
    requestId: 'request', title: 'Request detail', status: 'failed', statusLabel: 'Failed',
    fields: [
      { id: 'model', label: 'Model', value: 'Local writing model' },
      { id: 'total', label: 'Total tokens', value: '3,840' },
    ],
  } }
  const screen = await render(page(value))
  expect(screen.getByTestId('usage-detail-reading-plane')).toHaveStyle({
    backgroundColor: require('@/theme/colors').getColors('light', 'minimal').material.sheet.body,
    paddingHorizontal: 12, paddingTop: 8, paddingBottom: 24,
    marginHorizontal: -12, marginTop: -8, marginBottom: -24,
  })
  expect(screen.getByTestId('usage-detail-value-model')).toHaveTextContent('Local writing model')
  expect(screen.getByTestId('usage-detail-value-total')).toHaveTextContent('3,840')
  expect(value.onRequestPress).not.toHaveBeenCalled()
  expect(value.onCloseRequestDetail).not.toHaveBeenCalled()
})

it('uses the measured reading column at large font scale and keeps every request metric and the detail action', async () => {
  jest.spyOn(require('react-native'), 'useWindowDimensions').mockReturnValue({ width: 1200, height: 844, scale: 1, fontScale: 2 })
  const value = props()
  value.requests = [{
    id: 'request', timestampLabel: '11:24', providerLabel: 'Reference connection', modelLabel: 'A long reference model name',
    sourceLabel: 'Knowledge', measurementLabel: 'Provider supplied', status: 'failed', statusLabel: 'Failed',
    tokensLabel: '3,840 tokens', inputTokensLabel: '3,200 input', outputTokensLabel: '640 output',
    cacheTokensLabel: '120 cached', latencyLabel: '1.6s', firstTokenLabel: 'First token 0.38s', estimatedCostLabel: '$0.014',
  }]
  const screen = await render(page(value))
  await fireEvent(screen.getByTestId('usage-content'), 'layout', { nativeEvent: { layout: { width: 760, height: 900 } } })
  const row = screen.getByTestId('usage-request-request')
  expect(row).toHaveStyle({ flexDirection: 'column', alignItems: 'stretch' })
  expect(screen.getByTestId('usage-context-request')).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' })
  expect(screen.getByText('Reference connection')).toBeTruthy()
  expect(screen.getByText('· Knowledge')).toBeTruthy()
  for (const label of ['3,840 tokens', '3,200 input / 640 output', '120 cached', '1.6s', 'First token 0.38s']) expect(screen.getByText(label)).toBeTruthy()
  expect(screen.queryByText('$0.014')).toBeNull()
  await fireEvent.press(row)
  expect(value.onRequestPress).toHaveBeenCalledWith('request')
  await screen.rerender(page({ ...value, filters: { ...value.filters, includeEstimates: true } }))
  expect(screen.getByTestId('usage-request-request')).toBe(row)
  expect(screen.getByText('$0.014')).toBeTruthy()
})

it('labels grouped values and secondary rates instead of leaving a column of unexplained numbers', async () => {
  const value = props()
  value.activeTab = 'providers'
  value.providers = [{
    id: 'provider', label: 'Research and reference connection', requestCountLabel: '3', tokensLabel: '8K',
    successRateLabel: '67%', averageLatencyLabel: '1.6s', cacheHitRateLabel: '25%', estimatedCostLabel: '$0.03', share: 0.4,
  }]
  const screen = await render(page(value))
  const row = screen.getByTestId('usage-breakdown-provider')
  expect(row.props.accessibilityLabel).toContain('Requests 3')
  expect(row.props.accessibilityLabel).toContain('Total tokens 8K')
  expect(screen.getByText('usage.successRate 67%')).toBeTruthy()
  expect(screen.getByText('Average latency 1.6s')).toBeTruthy()
  expect(screen.queryByText('Estimated cost $0.03')).toBeNull()
  await screen.rerender(page({ ...value, filters: { ...value.filters, includeEstimates: true } }))
  expect(screen.getByTestId('usage-breakdown-provider')).toBe(row)
  expect(screen.getByText('Estimated cost $0.03')).toBeTruthy()
})

it('guards sheet dismissal and navigation, but explicit cancel destroys the local draft', async () => {
  const value = props(), screen = await render(page(value))
  await fireEvent.press(screen.getByRole('button', { name: 'Add override' }))
  await fireEvent.changeText(screen.getByLabelText(inputLabel), '1.25')
  await fireEvent(screen.getByLabelText(inputLabel), 'blur')
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }))
  expect(mockConfirm).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText(inputLabel).props.value).toBe('1.25')
  expect(value.onSavePricingOverride).not.toHaveBeenCalled()
  mockConfirm.mockResolvedValueOnce(true)
  await act(async () => mockRemove({ data: { action: { type: 'GO_BACK' } } }))
  expect(screen.queryByLabelText(inputLabel)).toBeNull()
  await fireEvent.press(screen.getByRole('button', { name: 'Add override' }))
  expect(screen.getByLabelText(inputLabel).props.value).toBe('')
  await fireEvent.changeText(screen.getByLabelText(inputLabel), '4')
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }))
  await fireEvent.press(screen.getByRole('button', { name: 'Add override' }))
  expect(screen.getByLabelText(inputLabel).props.value).toBe('')
}, 15_000)

it('blocks repeat submits, editing and cancellation until the save settles; failures retain input for retry', async () => {
  let reject!: (error: Error) => void
  const value = props()
  value.onSavePricingOverride = jest.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail })).mockResolvedValue(undefined)
  const screen = await render(page(value))
  await fireEvent.press(screen.getByRole('button', { name: 'Add override' }))
  await fireEvent.changeText(screen.getByLabelText(inputLabel), '1.25')
  await fireEvent.changeText(screen.getByLabelText(outputLabel), '2.5')
  await fireEvent.press(screen.getByRole('button', { name: 'Save override' }))
  expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(screen.getByLabelText(inputLabel).props.editable).toBe(false)
  await fireEvent.press(screen.getByRole('button', { name: 'Saving' }))
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }))
  expect(mockConfirm).not.toHaveBeenCalled()
  expect(value.onSavePricingOverride).toHaveBeenCalledTimes(1)
  await act(async () => reject(new Error('disk unavailable')))
  expect(screen.getByRole('alert').props.children).toBe('settingsWorkspace.saveFailed')
  expect(screen.getByLabelText(inputLabel).props.value).toBe('1.25')
  await fireEvent.press(screen.getByRole('button', { name: 'Save override' }))
  expect(screen.queryByLabelText(inputLabel)).toBeNull()
  expect(value.onSavePricingOverride).toHaveBeenCalledTimes(2)
})

it('preserves dirty values after an external revision, blocks overwriting it and offers reload', async () => {
  const value = props()
  value.pricingOverrides = [{ id: 'price', providerId: 'p', providerLabel: 'Provider', modelId: 'm', modelLabel: 'Model', inputPricePerMillion: '1', outputPricePerMillion: '2', currencyLabel: 'USD', sourceRevision: 'v1' }]
  const screen = await render(page(value))
  await fireEvent.press(screen.getByRole('button', { name: 'Edit override' }))
  await fireEvent.changeText(screen.getByLabelText(inputLabel), '3')
  const latest = { ...value, pricingOverrides: [{ ...value.pricingOverrides[0], inputPricePerMillion: '4', sourceRevision: 'v2' }] }
  await screen.rerender(page(latest))
  expect(screen.getByLabelText(inputLabel).props.value).toBe('3')
  await fireEvent.press(screen.getByRole('button', { name: 'Save override' }))
  expect(value.onSavePricingOverride).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').props.children).toBe('settingsWorkspace.conflict')
  await fireEvent.press(screen.getByRole('button', { name: 'settingsWorkspace.reload' }))
  expect(screen.getByLabelText(inputLabel).props.value).toBe('4')
  await fireEvent.changeText(screen.getByLabelText(inputLabel), '5')
  await fireEvent.press(screen.getByRole('button', { name: 'Save override' }))
  expect(value.onSavePricingOverride).toHaveBeenCalledWith(expect.objectContaining({ id: 'price', inputPricePerMillion: '5' }), 'v2')
})
