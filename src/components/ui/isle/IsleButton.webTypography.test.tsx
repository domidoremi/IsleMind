import { fireEvent, render } from '@testing-library/react-native'
import { Platform, StyleSheet } from 'react-native'
import { useAppTheme } from '@/hooks/useAppTheme'
import { getColors } from '@/theme/colors'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { IsleButton } from './IsleKit'
import { IsleThemeProvider } from './IsleThemeProvider'
import { IsleButton as AppButton } from './Controls'

jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: jest.fn() }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: jest.fn(() => 'none') }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('@/components/ui/AppIcon', () => ({ AppIcon: () => null, appIconStroke: { fine: 1.5, regular: 1.75, strong: 2 } }))
jest.mock('@/components/ui/HighFrameSpinner', () => ({ HighFrameSpinner: () => null }))

function setTheme(id: CanonicalThemeId) {
  const colors = getColors('light', id)
  jest.mocked(useAppTheme).mockReturnValue({
    colors, design: colors.design!, canonicalThemeId: id, mode: 'light', themeMode: 'light',
    isDark: false, isMinimal: id === 'minimal', isMonet: id === 'monet',
    isMaterial: id === 'material', isLiquidGlass: id === 'liquid-glass', isAnimalIsland: id === 'animal-island-ui',
  } as ReturnType<typeof useAppTheme>)
}

async function onPlatform(os: 'web' | 'ios', operation: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS')!
  Object.defineProperty(Platform, 'OS', { configurable: true, value: os })
  try { await operation() }
  finally { Object.defineProperty(Platform, 'OS', descriptor) }
}

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)(
  'keeps %s button text font-relative on web, including the actual fork', async family => {
    await onPlatform('web', async () => {
      setTheme(family)
      const screen = await render(<IsleThemeProvider><IsleButton label="Font-aware action" /></IsleThemeProvider>)
      const lineHeight = StyleSheet.flatten(screen.getByText('Font-aware action').props.style).lineHeight
      expect(typeof lineHeight).toBe('string')
      expect(String(lineHeight)).toMatch(/^\d+(?:\.\d+)?$/)
      expect(parseFloat(String(lineHeight))).toBeGreaterThanOrEqual(1.5)
    })
  },
)

it('keeps actual fork numeric text metrics on native', async () => {
  await onPlatform('ios', async () => {
    setTheme('animal-island-ui')
    const screen = await render(<IsleThemeProvider>
      <IsleButton label="Native action" textStyle={{ fontSize: 20, lineHeight: 36 }} />
    </IsleThemeProvider>)
    expect(StyleSheet.flatten(screen.getByText('Native action').props.style).lineHeight).toBe(36)
  })
})

it('derives actual fork web metrics after explicit font and line-height overrides', async () => {
  await onPlatform('web', async () => {
    setTheme('animal-island-ui')
    const screen = await render(<IsleThemeProvider>
      <IsleButton label="Code action" textStyle={{ fontFamily: 'monospace', fontSize: 20, lineHeight: 36 }} />
    </IsleThemeProvider>)
    const style = StyleSheet.flatten(screen.getByText('Code action').props.style)
    expect(style.fontFamily).toBe('monospace')
    expect(style.lineHeight).toBe('1.8')
  })
})

it('preserves actual fork busy and press semantics while changing only web text metrics', async () => {
  await onPlatform('web', async () => {
    setTheme('animal-island-ui')
    const onPress = jest.fn()
    const tree = (loading: boolean) => <IsleThemeProvider>
      <IsleButton label="Guarded action" testID="guarded-action" loading={loading} onPress={onPress} />
    </IsleThemeProvider>
    const screen = await render(tree(true))
    await fireEvent.press(screen.getByTestId('guarded-action'))
    expect(onPress).not.toHaveBeenCalled()
    expect(screen.getByTestId('guarded-action').props.accessibilityState.busy).toBe(true)
    await screen.rerender(tree(false))
    await fireEvent.press(screen.getByTestId('guarded-action'))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(String(StyleSheet.flatten(screen.getByText('Guarded action').props.style).lineHeight)).toMatch(/^\d+(?:\.\d+)?$/)
  })
})

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)(
  'keeps ordinary %s button labels single-line by default', async family => {
    setTheme(family)
    const screen = await render(<IsleThemeProvider><AppButton label="Ordinary action" /></IsleThemeProvider>)
    expect(screen.getByText('Ordinary action').props.numberOfLines).toBe(1)
  },
)

it.each((['web', 'ios'] as const).flatMap(os =>
  (['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const).map(family => [os, family] as const),
))('allows full %s / %s action labels to wrap without a fixed height', async (os, family) => {
  await onPlatform(os, async () => {
    setTheme(family)
    const screen = await render(<IsleThemeProvider>
      <AppButton label="Confirm 123 filtered pending memories" multiline testID="wrapped-action" style={{ width: 160 }} />
    </IsleThemeProvider>)
    const label = screen.getByText('Confirm 123 filtered pending memories')
    expect(label.props.numberOfLines ?? 0).toBe(0)
    expect(label).toHaveStyle({ minWidth: 0, flexShrink: 1, textAlign: 'center' })
    const style = StyleSheet.flatten(screen.getByTestId('wrapped-action').props.style)
    expect(style.height).toBeUndefined()
    expect(style.minHeight).toBeGreaterThanOrEqual(44)
    expect(style.paddingVertical).toBeGreaterThan(0)
    if (os === 'web') expect(String(StyleSheet.flatten(label.props.style).lineHeight)).toMatch(/^\d+(?:\.\d+)?$/)
  })
})

it.each(['minimal', 'monet', 'material', 'liquid-glass'] as const)(
  'bounds the %s expression body inside narrow buttons rather than clipping the middle of its label', async family => {
    setTheme(family)
    const screen = await render(<AppButton label="Long expression action" multiline style={{ width: 160 }} />)
    expect(screen.getByTestId(`theme-button-body-${family}`)).toHaveStyle({ minWidth: 0, maxWidth: '100%', flexShrink: 1 })
  },
)

it.each(['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'] as const)(
  'preserves %s busy and disabled press guards for wrapped actions', async family => {
    setTheme(family)
    const onPress = jest.fn()
    const tree = (busy: boolean, disabled = false) => <IsleThemeProvider>
      <AppButton label="Confirm filtered pending memories" multiline testID="wrapped-guard" busy={busy} disabled={disabled} onPress={onPress} />
    </IsleThemeProvider>
    const screen = await render(tree(true))
    await fireEvent.press(screen.getByTestId('wrapped-guard'))
    expect(onPress).not.toHaveBeenCalled()
    expect(screen.getByTestId('wrapped-guard').props.accessibilityState.busy).toBe(true)
    await screen.rerender(tree(false, true))
    await fireEvent.press(screen.getByTestId('wrapped-guard'))
    expect(onPress).not.toHaveBeenCalled()
    await screen.rerender(tree(false))
    await fireEvent.press(screen.getByTestId('wrapped-guard'))
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Confirm filtered pending memories').props.numberOfLines ?? 0).toBe(0)
  },
)
