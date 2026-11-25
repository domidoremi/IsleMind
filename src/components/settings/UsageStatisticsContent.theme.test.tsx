import { render } from '@testing-library/react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { SettingsEditBoundary } from './SettingsEditBoundary'
import { UsageStatisticsContent, type UsageStatisticsContentProps } from './UsageStatisticsContent'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }) }))
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: () => {} }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null }))
jest.mock('moti', () => ({ MotiView: require('react-native').View }))
jest.mock('./SettingsHelp', () => ({ SettingsHelpButton: () => null }))
jest.mock('@shopify/flash-list', () => ({ FlashList: require('react-native').View }))
jest.mock('@/components/ui/isle', () => {
  const { View, Text, Pressable } = require('react-native')
  return { ISLE_MIN_TOUCH_TARGET: 44, IslePressable: Pressable, IsleChip: Text, IsleToggle: View,
    IsleButton: ({ label, ...props }: any) => <Pressable {...props}><Text>{label}</Text></Pressable>,
    useIsleDialog: () => ({ confirm: async () => false }),
  }
})

it.each(CANONICAL_THEME_IDS)('themes the request detail overlay in %s without replacing its contents', async family => {
  const value: UsageStatisticsContentProps = {
    summary: { requests: '0', inputTokens: '0', outputTokens: '0', averageLatency: '-', errorRate: '-' }, trends: [],
    filters: { dateRange: '30d', provider: 'all', model: 'all', status: 'all', requestSource: 'all', includeEstimates: false },
    filterOptions: { dateRanges: [], providers: [], models: [], statuses: [], requestSources: [] },
    onFiltersChange: jest.fn(), activeTab: 'requests', onTabChange: jest.fn(), requests: [], providers: [], models: [],
    onRequestPress: jest.fn(), onCloseRequestDetail: jest.fn(), pricingOverrides: [], pricingProviderOptions: [], pricingModelOptions: [],
    onSavePricingOverride: jest.fn(), onDeletePricingOverride: jest.fn(), onExport: jest.fn(), onClear: jest.fn(),
    requestDetail: { status: 'ready', detail: { requestId: 'kept', title: 'Kept request', status: 'succeeded', statusLabel: 'Success',
      fields: [{ id: 'model', label: 'Model', value: 'Kept model' }] } },
  }
  const tree = () => <SettingsEditBoundary><UsageStatisticsContent {...value} /></SettingsEditBoundary>
  jest.mocked(useAppTheme).mockReturnValue({ colors: getColors('light', family), canonicalThemeId: family } as ReturnType<typeof useAppTheme>)
  const screen = await render(tree())
  const retained = screen.getByTestId('usage-detail-value-model')
  for (const mode of ['dark', 'light'] as const) {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, canonicalThemeId: family, mode } as ReturnType<typeof useAppTheme>)
    await screen.rerender(tree())
    expect(screen.getByTestId('usage-sheet-backdrop')).toHaveStyle({ backgroundColor: colors.backdrop })
    expect(screen.getByTestId('usage-sheet-header')).toHaveStyle({ borderBottomColor: colors.ui.section.divider })
    expect(screen.getByTestId('usage-sheet')).toHaveStyle({ backgroundColor: colors.ui.semantic.chrome.sheet,
      borderTopLeftRadius: colors.ui.radius.panel, borderTopRightRadius: colors.ui.radius.panel })
    expect(screen.getByTestId('usage-detail-value-model')).toBe(retained)
    expect(retained).toHaveTextContent('Kept model')
  }
  expect(value.onCloseRequestDetail).not.toHaveBeenCalled()
  expect(value.onRequestPress).not.toHaveBeenCalled()
})
