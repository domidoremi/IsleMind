import { useEffect } from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { Text } from 'react-native'
import { WorkspaceIntro } from './WorkspaceIntro'
import { IsleEmptyState } from './isle/EmptyState'
import { IsleOverlayPressable } from './isle/Pressable'
import { CANONICAL_THEME_IDS, type CanonicalThemeId } from '@/types/settingsContracts'

let mockFamily: CanonicalThemeId = 'material'
let mockMode = 'dark'
jest.mock('@/hooks/useAppTheme', () => ({ useAppTheme: () => {
  const colors = require('@/theme/colors').getColors(mockMode, mockFamily)
  return { colors, design: colors.design, canonicalThemeId: mockFamily, isLiquidGlass: mockFamily === 'liquid-glass' }
} }))
jest.mock('@/hooks/useMotionPreference', () => ({ useMotionPreference: () => 'none' }))
jest.mock('@/hooks/useTransparencyPreference', () => ({ useTransparencyPreference: () => true }))
jest.mock('@/store/settingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ settings: { hapticsEnabled: false } }) }))
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
jest.mock('moti', () => ({ MotiView: require('react-native').View, AnimatePresence: require('react').Fragment }))
jest.mock('./AppIcon', () => {
  const { Text } = require('react-native')
  return { AppIcon: ({ name }: { name: string }) => <Text>{name}</Text>, appIconStroke: {} }
})
jest.mock('./isle/GlassSurface', () => {
  const { View } = require('react-native')
  return {
    GlassSurface: ({ children, colors, enabled, variant, intensity, shadow, borderRadius, ...props }: any) => <View {...props}>{children}</View>,
    GlassSurfaceActivity: ({ children }: any) => children,
  }
})

it.each(CANONICAL_THEME_IDS.flatMap(family => ['light', 'dark'].map(mode => [family, mode] as const)))('keeps contextual copy readable without a container stack in %s / %s', async (family, mode) => {
  mockFamily = family
  mockMode = mode
  const screen = await render(<WorkspaceIntro title="Local documents" description="Create or continue writing." eyebrow="Workspace" icon="source" />)
  expect(screen.getByRole('header', { name: 'Local documents' })).toBeTruthy()
  expect(screen.getByText('Create or continue writing.')).toHaveProp('selectable', true)
})

it('keeps the same interactive owner across all theme changes', async () => {
  const mounted = jest.fn()
  const press = jest.fn()
  function Content() {
    useEffect(() => { mounted() }, [])
    return <Text>Choose model</Text>
  }
  const tree = () => <IsleOverlayPressable testID="model" accessibilityRole="button" onPress={press}><Content /></IsleOverlayPressable>
  const screen = await render(tree())
  for (const family of CANONICAL_THEME_IDS) {
    mockFamily = family
    await screen.rerender(tree())
    await fireEvent.press(screen.getByTestId('model'))
  }
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(press).toHaveBeenCalledTimes(CANONICAL_THEME_IDS.length)
})

it('uses a contextual glyph and retains the action and disabled semantics of an empty state', async () => {
  mockFamily = 'material'
  const action = jest.fn()
  const screen = await render(<IsleEmptyState title="No runs" description="Start from a conversation." icon="workflow" actionLabel="Open tasks" onAction={action} actionDisabled />)
  expect(screen.getByText('workflow', { includeHiddenElements: true })).toBeTruthy()
  expect(screen.getByText('No runs')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open tasks' })).toBeDisabled()
  await fireEvent.press(screen.getByRole('button', { name: 'Open tasks' }))
  expect(action).not.toHaveBeenCalled()
})
