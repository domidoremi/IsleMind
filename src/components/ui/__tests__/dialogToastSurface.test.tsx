import { fireEvent, render } from '@testing-library/react-native'
import { Pressable, StyleSheet, Text } from 'react-native'

import { getColors } from '@/theme/colors'
import { IsleDialogProvider, useIsleDialog } from '../isle/Dialog'

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors('light', 'minimal')
    return { colors, design: colors.design, canonicalThemeId: 'minimal', isLiquidGlass: false }
  },
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

function Trigger() {
  const dialog = useIsleDialog()
  return <Pressable accessibilityRole="button" accessibilityLabel="Report export failure" onPress={() => dialog.toast({ title: 'Export failed', message: 'Clipboard unavailable', tone: 'amber' })}><Text>Report</Text></Pressable>
}

it('keeps the minimal toast’s actual panel surface opaque over underlying Chat content', async () => {
  const view = await render(<IsleDialogProvider><Trigger /></IsleDialogProvider>)
  await fireEvent.press(view.getByRole('button', { name: 'Report export failure' }))
  const panel = view.getByTestId('theme-toast-minimal').parent
  expect(StyleSheet.flatten(panel?.props.style).backgroundColor).toBe(getColors('light', 'minimal').ui.semantic.surface.base)
  await view.unmount()
})
