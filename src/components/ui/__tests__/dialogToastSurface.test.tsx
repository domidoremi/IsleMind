import { act, fireEvent, render } from '@testing-library/react-native'
import { Pressable, StyleSheet, Text } from 'react-native'

import { getColors } from '@/theme/colors'
import { IsleDialogProvider, useIsleDialog } from '../isle/Dialog'

let mockMotion = 'none'
let mockTheme = 'minimal'

jest.mock('@/hooks/useAppTheme', () => ({
  useAppTheme: () => {
    const colors = require('@/theme/colors').getColors('light', mockTheme)
    return { colors, design: colors.design, canonicalThemeId: mockTheme, isLiquidGlass: mockTheme === 'liquid-glass' }
  },
}))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => mockMotion }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => false }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: {} }))

beforeEach(() => { mockMotion = 'none'; mockTheme = 'minimal' })

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

it('dismisses only the cancelled pending confirmation and settles it false', async () => {
  const controller = new AbortController()
  let outcome: Promise<boolean> | undefined
  function ConfirmTrigger() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityRole="button" accessibilityLabel="Ask fallback" onPress={() => {
      outcome = dialog.confirm({ title: 'Use another provider?', signal: controller.signal })
    }}><Text>Ask</Text></Pressable>
  }
  const view = await render(<IsleDialogProvider><ConfirmTrigger /></IsleDialogProvider>)
  await fireEvent.press(view.getByRole('button', { name: 'Ask fallback' }))
  expect(view.getByText('Use another provider?')).toBeTruthy()
  await act(async () => controller.abort())
  expect(await outcome).toBe(false)
  expect(view.queryByText('Use another provider?')).toBeNull()
  await view.unmount()
})

it.each(['minimal', 'monet', 'material', 'liquid-glass'])('%s confirmation remains readable and settles without waiting for its animation', async (theme) => {
  mockTheme = theme
  mockMotion = 'full'
  let outcome: Promise<boolean> | undefined
  function TriggerConfirm() {
    const dialog = useIsleDialog()
    return <Pressable accessibilityLabel="Ask" onPress={() => { outcome = dialog.confirm({ title: 'Continue?' }) }} />
  }
  const screen = await render(<IsleDialogProvider><TriggerConfirm /></IsleDialogProvider>)
  // Hidden Web Modal portals otherwise precede, and sit behind, later editor sheets.
  expect(screen.container.queryAll(node => node.props.animationType === 'none' && node.props.transparent === true)).toHaveLength(0)
  await fireEvent.press(screen.getByLabelText('Ask'))
  expect(screen.getByText('Continue?')).toBeTruthy()
  const entrance = screen.container.queryAll(node => node.props.from?.opacity === 0.65 && node.props.transition?.duration > 1)
  expect(entrance.length).toBeGreaterThan(0)
  await fireEvent.press(screen.getByText('common.confirm'))
  expect(await outcome).toBe(true)
  expect(screen.queryByText('Continue?')).toBeNull()
  expect(screen.container.queryAll(node => node.props.animationType === 'none' && node.props.transparent === true)).toHaveLength(0)
})
