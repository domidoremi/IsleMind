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
jest.mock('@shopify/flash-list', () => ({ FlashList: () => null }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@/components/ui/isle', () => {
  const { Pressable, Text, View } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleChip: Text, IsleToggle: View,
    IsleButton: ({ label, onPress, ...props }: any) => <Pressable accessibilityRole="button" accessibilityLabel={label} {...props} onPress={() => { onPress?.() }}><Text>{label}</Text></Pressable>,
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
