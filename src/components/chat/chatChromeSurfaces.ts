import type { useAppTheme } from '@/hooks/useAppTheme'

type ChatThemeColors = ReturnType<typeof useAppTheme>['colors']

export function resolveChatChromeSurface(
  colors: ChatThemeColors,
  isGlass: boolean,
  variant: 'default' | 'muted' | 'toolbar' = 'default'
) {
  if (variant === 'toolbar') {
    return isGlass ? colors.ui.semantic.chrome.toolbar : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.chrome.toolbar
  }
  if (variant === 'muted') {
    return isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  }
  return isGlass ? colors.ui.semantic.chrome.background : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.base
}

export function resolveChatChromeBorder(colors: ChatThemeColors, isGlass: boolean) {
  return colors.ui.limeRoad ? colors.material.stroke : isGlass ? colors.ui.actionBar.itemBorder : colors.ui.semantic.chrome.border
}

export function resolveChatControlSurface(
  colors: ChatThemeColors,
  isGlass: boolean,
  active: boolean,
  inactiveVariant: 'default' | 'muted' | 'activeAccent' = 'default'
) {
  if (active) return colors.ui.control.primaryBackground
  if (inactiveVariant === 'activeAccent') {
    return isGlass ? colors.ui.actionBar.itemActiveBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  }
  if (inactiveVariant === 'muted') {
    return isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.muted
  }
  return isGlass ? colors.ui.actionBar.itemBackground : colors.ui.limeRoad ? colors.ui.semantic.surface.base : colors.ui.semantic.surface.muted
}

export function resolveChatControlBorder(colors: ChatThemeColors, isGlass: boolean, active: boolean) {
  if (active) return colors.ui.control.primaryBorder
  return resolveChatChromeBorder(colors, isGlass)
}
