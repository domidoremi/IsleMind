import { fireEvent, render } from '@testing-library/react-native'
import { StyleSheet } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import { CANONICAL_THEME_IDS } from '@/types/settingsContracts'
import { IsleEmptyState } from './EmptyState'
import { IsleThemeProvider } from './IsleThemeProvider'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))
jest.mock('@/components/navigation/AnimatedNavigationIcon', () => ({
  AnimatedNavigationIcon: ({ color }: { color: string }) => require('react').createElement(require('react-native').Text,
    { testID: 'empty-state-action-icon', style: { color } }, 'Create icon'),
}))

it.each(CANONICAL_THEME_IDS.flatMap(family => (['light', 'dark'] as const).map(mode => ({ family, mode }))))(
  'keeps $family $mode empty-state actions on their current foreground without activating disabled or busy controls',
  async ({ family, mode }) => {
    const colors = getColors(mode, family)
    jest.mocked(useAppTheme).mockReturnValue({ colors, design: colors.design!, canonicalThemeId: family,
      mode, isDark: mode === 'dark' } as ReturnType<typeof useAppTheme>)
    const action = jest.fn()
    const tree = (disabled = false, busy = false) => <IsleThemeProvider>
      <IsleEmptyState title="No conversations" description="Create your first conversation" actionLabel="Create"
        actionGlyph="new-chat" actionDisabled={disabled} actionBusy={busy} onAction={action} compact />
    </IsleThemeProvider>
    const screen = await render(tree())
    const enabledColor = StyleSheet.flatten(screen.getByText('Create').props.style).color
    expect(screen.getByTestId('empty-state-action-icon', { includeHiddenElements: true })).toHaveStyle({ color: enabledColor })
    await screen.rerender(tree(true))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(screen.getByTestId('empty-state-action-icon', { includeHiddenElements: true })).toHaveStyle({ color: colors.ui.control.disabledForeground })
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }))
    expect(action).not.toHaveBeenCalled()
    await screen.rerender(tree(false, true))
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }))
    expect(action).not.toHaveBeenCalled()
    await screen.rerender(tree())
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled()
    expect(screen.getByTestId('empty-state-action-icon', { includeHiddenElements: true })).toHaveStyle({ color: enabledColor })
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }))
    expect(action).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('No conversations. Create your first conversation')).toBeTruthy()
    await screen.unmount()
  },
)
