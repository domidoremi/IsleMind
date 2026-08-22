import type { ReactNode } from 'react'
import {
  type LayoutChangeEvent,
} from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'
import { ThemeExpressionSurface } from '@/components/ui/isle/ThemeExpressionSurface'

type ThemeColors = ReturnType<typeof useAppTheme>['colors']

interface ThemeSurfaceProps {
  /** Surface dispatch is always keyed by canonical theme family. */
  themeId: CanonicalThemeId
  colors: ThemeColors
  children: ReactNode
}

// Keep stable test and accessibility hooks while the renderer moves behind the
// shared expression layer. The values are intentionally explicit so adding a
// family cannot silently fall back to a neighbouring visual grammar.
type ThemeSurfaceKind = 'composer' | 'chrome' | 'message' | 'message-content'

const CHAT_SURFACE_TEST_IDS = {
  composer: {
    minimal: 'chat-composer-surface-minimal',
    monet: 'chat-composer-surface-monet',
    material: 'chat-composer-surface-material',
    'liquid-glass': 'chat-composer-surface-liquid-glass',
  },
  chrome: {
    minimal: 'chat-chrome-surface-minimal',
    monet: 'chat-chrome-surface-monet',
    material: 'chat-chrome-surface-material',
    'liquid-glass': 'chat-chrome-surface-liquid-glass',
  },
  message: {
    minimal: 'chat-message-surface-minimal',
    monet: 'chat-message-surface-monet',
    material: 'chat-message-surface-material',
    'liquid-glass': 'chat-message-surface-liquid-glass',
  },
  'message-content': {
    minimal: 'chat-message-content-surface-minimal',
    monet: 'chat-message-content-surface-monet',
    material: 'chat-message-content-surface-material',
    'liquid-glass': 'chat-message-content-surface-liquid-glass',
  },
} as const satisfies Record<ThemeSurfaceKind, Record<CanonicalThemeId, string>>

export function ChatComposerThemeSurface({
  themeId,
  colors,
  horizontalPadding,
  children,
}: ThemeSurfaceProps & { horizontalPadding: number }) {
  return <ThemeExpressionSurface family={themeId} colors={colors} kind="composer" horizontalPadding={horizontalPadding} testID={CHAT_SURFACE_TEST_IDS.composer[themeId]}>{children}</ThemeExpressionSurface>
}

export function ChatChromeThemeSurface({
  themeId,
  colors,
  alertBorder,
  onLayout,
  children,
}: ThemeSurfaceProps & {
  alertBorder?: string
  onLayout?: (event: LayoutChangeEvent) => void
}) {
  return <ThemeExpressionSurface family={themeId} colors={colors} kind="chrome" alertBorder={alertBorder} onLayout={onLayout} testID={CHAT_SURFACE_TEST_IDS.chrome[themeId]}>{children}</ThemeExpressionSurface>
}

export function MessageBubbleThemeSurface({
  themeId,
  colors,
  isUser,
  selected,
  children,
}: ThemeSurfaceProps & { isUser: boolean; selected: boolean }) {
  return <ThemeExpressionSurface family={themeId} colors={colors} kind="message" isUser={isUser} selected={selected} testID={CHAT_SURFACE_TEST_IDS.message[themeId]}>{children}</ThemeExpressionSurface>
}

export function MessageContentThemeSurface({
  themeId,
  colors,
  isUser,
  children,
}: ThemeSurfaceProps & { isUser: boolean }) {
  return <ThemeExpressionSurface family={themeId} colors={colors} kind="message-content" isUser={isUser} testID={CHAT_SURFACE_TEST_IDS['message-content'][themeId]}>{children}</ThemeExpressionSurface>
}
