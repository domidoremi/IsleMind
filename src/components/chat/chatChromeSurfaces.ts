import type { useAppTheme } from '@/hooks/useAppTheme'

type ChatThemeColors = ReturnType<typeof useAppTheme>['colors']

export function resolveChatChromeSurface(
  colors: ChatThemeColors,
  isLiquidGlass: boolean,
  variant: 'default' | 'muted' | 'toolbar' = 'default'
) {
  // Inner chrome inside an existing glass lens must stay translucent; solid
  // chrome tints stacked on the outer lens read as white rectangles. Only the
  // outer shell (header/composer) uses the chrome material directly.
  if (variant === 'toolbar') {
    return isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.monet ? colors.ui.semantic.surface.muted : colors.ui.semantic.chrome.toolbar
  }
  if (variant === 'muted') {
    return isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  }
  const design = (colors as { design?: { semantic?: { surface?: { chrome?: { background?: string } } } } }).design
  return isLiquidGlass ? design?.semantic?.surface?.chrome?.background ?? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base
}

export function resolveChatChromeBorder(colors: ChatThemeColors, isLiquidGlass: boolean) {
  return colors.ui.monet ? colors.material.stroke : isLiquidGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
}

export function resolveChatControlSurface(
  colors: ChatThemeColors,
  isLiquidGlass: boolean,
  active: boolean,
  inactiveVariant: 'default' | 'muted' | 'activeAccent' = 'default'
) {
  if (active) return colors.ui.control.primaryBackground
  if (inactiveVariant === 'activeAccent') {
    return isLiquidGlass ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.muted
  }
  if (inactiveVariant === 'muted') {
    return isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.semantic.surface.muted
  }
  return isLiquidGlass ? colors.ui.actionBar.itemBackground : colors.ui.monet ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted
}

export function resolveChatControlBorder(colors: ChatThemeColors, isLiquidGlass: boolean, active: boolean) {
  if (active) return colors.ui.control.primaryBorder
  return resolveChatChromeBorder(colors, isLiquidGlass)
}
