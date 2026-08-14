import type { ReactNode } from 'react'
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native'

import type { useAppTheme } from '@/hooks/useAppTheme'
import type { ThemeId } from '@/types/settingsContracts'

type ThemeColors = ReturnType<typeof useAppTheme>['colors']

interface ThemeSurfaceProps {
  themeId: ThemeId
  colors: ThemeColors
  children: ReactNode
}

export function ChatComposerThemeSurface({
  themeId,
  colors,
  horizontalPadding,
  children,
}: ThemeSurfaceProps & { horizontalPadding: number }) {
  switch (themeId) {
    case 'lime-road':
      return <LimeRoadComposerSurface colors={colors}>{children}</LimeRoadComposerSurface>
    case 'markdown':
      return <MarkdownComposerSurface colors={colors}>{children}</MarkdownComposerSurface>
    case 'minimal':
    default:
      return (
        <MinimalComposerSurface colors={colors} horizontalPadding={horizontalPadding}>
          {children}
        </MinimalComposerSurface>
      )
  }
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
  switch (themeId) {
    case 'lime-road':
      return (
        <LimeRoadChromeSurface colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
          {children}
        </LimeRoadChromeSurface>
      )
    case 'markdown':
      return (
        <MarkdownChromeSurface colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
          {children}
        </MarkdownChromeSurface>
      )
    case 'minimal':
    default:
      return (
        <MinimalChromeSurface colors={colors} alertBorder={alertBorder} onLayout={onLayout}>
          {children}
        </MinimalChromeSurface>
      )
  }
}

export function ChatControlPanelThemeSurface({ themeId, colors, children }: ThemeSurfaceProps) {
  switch (themeId) {
    case 'lime-road':
      return <LimeRoadControlPanelSurface colors={colors}>{children}</LimeRoadControlPanelSurface>
    case 'markdown':
      return <MarkdownControlPanelSurface colors={colors}>{children}</MarkdownControlPanelSurface>
    case 'minimal':
    default:
      return <MinimalControlPanelSurface colors={colors}>{children}</MinimalControlPanelSurface>
  }
}

export function ChatControlTriggerThemeSurface({
  themeId,
  colors,
  open,
  children,
}: ThemeSurfaceProps & { open: boolean }) {
  switch (themeId) {
    case 'lime-road':
      return <LimeRoadControlTriggerSurface colors={colors} open={open}>{children}</LimeRoadControlTriggerSurface>
    case 'markdown':
      return <MarkdownControlTriggerSurface colors={colors} open={open}>{children}</MarkdownControlTriggerSurface>
    case 'minimal':
    default:
      return <MinimalControlTriggerSurface colors={colors} open={open}>{children}</MinimalControlTriggerSurface>
  }
}

export function MessageBubbleThemeSurface({
  themeId,
  colors,
  isUser,
  selected,
  children,
}: ThemeSurfaceProps & { isUser: boolean; selected: boolean }) {
  switch (themeId) {
    case 'lime-road':
      return (
        <LimeRoadMessageSurface colors={colors} isUser={isUser} selected={selected}>
          {children}
        </LimeRoadMessageSurface>
      )
    case 'markdown':
      return (
        <MarkdownMessageSurface colors={colors} isUser={isUser} selected={selected}>
          {children}
        </MarkdownMessageSurface>
      )
    case 'minimal':
    default:
      return (
        <MinimalMessageSurface colors={colors} isUser={isUser} selected={selected}>
          {children}
        </MinimalMessageSurface>
      )
  }
}

export function MessageContentThemeSurface({
  themeId,
  colors,
  isUser,
  children,
}: ThemeSurfaceProps & { isUser: boolean }) {
  switch (themeId) {
    case 'lime-road':
      return <LimeRoadMessageContentSurface colors={colors} isUser={isUser}>{children}</LimeRoadMessageContentSurface>
    case 'markdown':
      return <MarkdownMessageContentSurface colors={colors} isUser={isUser}>{children}</MarkdownMessageContentSurface>
    case 'minimal':
    default:
      return <MinimalMessageContentSurface>{children}</MinimalMessageContentSurface>
  }
}

function MinimalComposerSurface({
  colors,
  horizontalPadding,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { horizontalPadding: number }) {
  return (
    <View
      testID="chat-composer-surface-minimal"
      style={{
        marginHorizontal: -horizontalPadding,
        paddingHorizontal: horizontalPadding,
        paddingTop: 3,
        backgroundColor: colors.ui.semantic.surface.base,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.ui.semantic.chrome.border,
      }}
    >
      {children}
    </View>
  )
}

function LimeRoadComposerSurface({ colors, children }: Omit<ThemeSurfaceProps, 'themeId'>) {
  return (
    <View
      testID="chat-composer-surface-lime-road"
      style={{
        padding: 6,
        borderRadius: colors.ui.radius.panel + 2,
        backgroundColor: colors.ui.composer.shellBackground,
        borderWidth: 1,
        borderColor: colors.material.stroke,
        overflow: 'hidden',
        shadowColor: colors.shadowTint,
        shadowOpacity: Math.min(colors.ui.card.shadowOpacity, 0.08),
        shadowRadius: Math.max(4, colors.ui.card.shadowRadius - 4),
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      <RouteRail colors={colors} />
      <View style={{ paddingTop: 6 }}>{children}</View>
    </View>
  )
}

function MarkdownComposerSurface({ colors, children }: Omit<ThemeSurfaceProps, 'themeId'>) {
  return (
    <View
      testID="chat-composer-surface-markdown"
      style={{
        borderRadius: colors.ui.radius.controlSmall,
        backgroundColor: colors.ui.semantic.surface.base,
        borderWidth: 1,
        borderColor: colors.ui.semantic.chrome.border,
        overflow: 'hidden',
      }}
    >
      <DocumentCommandRail colors={colors} />
      <View style={{ padding: 6 }}>{children}</View>
    </View>
  )
}

function MinimalChromeSurface({
  colors,
  alertBorder,
  onLayout,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { alertBorder?: string; onLayout?: (event: LayoutChangeEvent) => void }) {
  return (
    <View
      testID="chat-chrome-surface-minimal"
      onLayout={onLayout}
      style={{
        minHeight: 48,
        marginHorizontal: -8,
        justifyContent: 'center',
        backgroundColor: colors.ui.semantic.surface.base,
        borderBottomWidth: alertBorder ? 1 : StyleSheet.hairlineWidth,
        borderBottomColor: alertBorder ?? colors.ui.semantic.chrome.border,
      }}
    >
      {children}
    </View>
  )
}

function LimeRoadChromeSurface({
  colors,
  alertBorder,
  onLayout,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { alertBorder?: string; onLayout?: (event: LayoutChangeEvent) => void }) {
  return (
    <View
      testID="chat-chrome-surface-lime-road"
      onLayout={onLayout}
      style={{
        minHeight: 48,
        marginHorizontal: -8,
        justifyContent: 'center',
        backgroundColor: colors.ui.composer.shellBackground,
        borderBottomWidth: alertBorder ? 2 : 3,
        borderBottomColor: alertBorder ?? colors.ui.control.primaryBackground,
        overflow: 'hidden',
        shadowOpacity: 0,
        elevation: 0,
      }}
    >
      {children}
    </View>
  )
}

function MarkdownChromeSurface({
  colors,
  alertBorder,
  onLayout,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { alertBorder?: string; onLayout?: (event: LayoutChangeEvent) => void }) {
  return (
    <View
      testID="chat-chrome-surface-markdown"
      onLayout={onLayout}
      style={{
        minHeight: 48,
        marginHorizontal: -8,
        justifyContent: 'center',
        backgroundColor: colors.ui.semantic.chrome.background,
        borderBottomWidth: alertBorder ? 2 : 1,
        borderBottomColor: alertBorder ?? colors.material.strokeStrong,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  )
}

function MinimalControlPanelSurface({ colors, children }: Omit<ThemeSurfaceProps, 'themeId'>) {
  return (
    <View
      testID="chat-control-panel-surface-minimal"
      style={{
        flex: 1,
        padding: 6,
        backgroundColor: colors.ui.semantic.surface.base,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderLeftWidth: StyleSheet.hairlineWidth,
        borderColor: colors.ui.semantic.chrome.border,
      }}
    >
      {children}
    </View>
  )
}

function LimeRoadControlPanelSurface({ colors, children }: Omit<ThemeSurfaceProps, 'themeId'>) {
  return (
    <View
      testID="chat-control-panel-surface-lime-road"
      style={{
        flex: 1,
        padding: 6,
        paddingLeft: 10,
        backgroundColor: colors.ui.composer.shellBackground,
        borderRadius: colors.ui.radius.panel + 4,
        borderWidth: 1,
        borderColor: colors.material.stroke,
        overflow: 'hidden',
      }}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 4, top: 10, bottom: 10, width: 2, borderRadius: 1, backgroundColor: colors.ui.icon.accentForeground }} />
      {children}
    </View>
  )
}

function MarkdownControlPanelSurface({ colors, children }: Omit<ThemeSurfaceProps, 'themeId'>) {
  return (
    <View
      testID="chat-control-panel-surface-markdown"
      style={{
        flex: 1,
        padding: 6,
        paddingLeft: 12,
        backgroundColor: colors.ui.semantic.chrome.background,
        borderRadius: colors.ui.radius.controlSmall,
        borderWidth: 1,
        borderColor: colors.ui.semantic.chrome.border,
        overflow: 'hidden',
      }}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 4, top: 6, bottom: 6, width: 3, backgroundColor: colors.ui.semantic.chrome.toolbar }} />
      {children}
    </View>
  )
}

function MinimalControlTriggerSurface({ colors, open, children }: Omit<ThemeSurfaceProps, 'themeId'> & { open: boolean }) {
  return (
    <View
      testID="chat-control-trigger-surface-minimal"
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: colors.ui.radius.controlSmall,
        backgroundColor: open ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: open ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
      }}
    >
      {children}
    </View>
  )
}

function LimeRoadControlTriggerSurface({ colors, open, children }: Omit<ThemeSurfaceProps, 'themeId'> & { open: boolean }) {
  return (
    <View
      testID="chat-control-trigger-surface-lime-road"
      style={{
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 24,
        backgroundColor: open ? colors.ui.control.primaryBackground : colors.ui.composer.statusBackground,
        borderWidth: 2,
        borderColor: open ? colors.ui.control.primaryBorder : colors.material.strokeStrong,
        shadowColor: colors.shadowTint,
        shadowOpacity: Math.min(colors.ui.card.shadowOpacity, 0.08),
        shadowRadius: 7,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      }}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.ui.icon.accentForeground }} />
      {children}
    </View>
  )
}

function MarkdownControlTriggerSurface({ colors, open, children }: Omit<ThemeSurfaceProps, 'themeId'> & { open: boolean }) {
  return (
    <View
      testID="chat-control-trigger-surface-markdown"
      style={{
        width: 48,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: colors.ui.radius.controlSmall,
        backgroundColor: open ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.chrome.background,
        borderWidth: 1,
        borderColor: open ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
        overflow: 'hidden',
      }}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: colors.ui.semantic.chrome.toolbar }} />
      {children}
    </View>
  )
}

function MinimalMessageSurface({
  colors,
  isUser,
  selected,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { isUser: boolean; selected: boolean }) {
  return (
    <View
      testID="chat-message-surface-minimal"
      style={{
        position: 'relative',
        paddingHorizontal: isUser ? 12 : 2,
        paddingVertical: isUser ? 9 : 7,
        borderRadius: isUser ? colors.ui.radius.controlSmall : 0,
        backgroundColor: isUser ? colors.ui.message.userBackground : selected ? colors.ui.semantic.surface.muted : 'transparent',
        borderWidth: selected ? 2 : isUser ? StyleSheet.hairlineWidth : 0,
        borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.message.userBorder,
      }}
    >
      {children}
    </View>
  )
}

function LimeRoadMessageSurface({
  colors,
  isUser,
  selected,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { isUser: boolean; selected: boolean }) {
  return (
    <View
      testID="chat-message-surface-lime-road"
      style={{
        position: 'relative',
        paddingHorizontal: 13,
        paddingTop: 16,
        paddingBottom: 10,
        borderRadius: colors.ui.radius.panel,
        borderBottomRightRadius: isUser ? colors.ui.radius.controlSmall : colors.ui.radius.panel,
        borderTopLeftRadius: isUser ? colors.ui.radius.panel : colors.ui.radius.controlSmall,
        backgroundColor: isUser ? colors.ui.message.userBackground : colors.ui.semantic.surface.base,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.ui.control.primaryBorder : isUser ? colors.ui.message.userBorder : colors.material.stroke,
        overflow: 'hidden',
        shadowColor: colors.shadowTint,
        shadowOpacity: Math.min(colors.ui.card.shadowOpacity, 0.05),
        shadowRadius: Math.max(3, colors.ui.card.shadowRadius - 6),
        shadowOffset: { width: 0, height: 2 },
        elevation: colors.ui.card.shadowOpacity > 0 ? 1 : 0,
      }}
    >
      <RouteRail colors={colors} compact />
      {children}
    </View>
  )
}

function MarkdownMessageSurface({
  colors,
  isUser,
  selected,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { isUser: boolean; selected: boolean }) {
  return (
    <View
      testID="chat-message-surface-markdown"
      style={{
        position: 'relative',
        borderRadius: colors.ui.radius.controlSmall,
        backgroundColor: isUser ? colors.ui.message.userBackground : colors.ui.semantic.surface.base,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.ui.control.primaryBorder : isUser ? colors.ui.message.userBorder : colors.ui.semantic.chrome.border,
        overflow: 'hidden',
      }}
    >
      <DocumentCommandRail colors={colors} />
      <View style={{ paddingHorizontal: 12, paddingTop: 9, paddingBottom: 10 }}>{children}</View>
    </View>
  )
}

function MinimalMessageContentSurface({ children }: { children: ReactNode }) {
  return (
    <View testID="chat-message-content-surface-minimal" style={{ gap: 5, width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {children}
    </View>
  )
}

function LimeRoadMessageContentSurface({
  colors,
  isUser,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { isUser: boolean }) {
  return (
    <View testID="chat-message-content-surface-lime-road" style={{ width: '100%', maxWidth: '100%', overflow: 'hidden' }}>
      {!isUser ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.ui.icon.accentForeground }} />
          <View style={{ height: 1, flex: 1, backgroundColor: colors.material.stroke }} />
        </View>
      ) : null}
      <View style={{ gap: 7 }}>{children}</View>
    </View>
  )
}

function MarkdownMessageContentSurface({
  colors,
  isUser,
  children,
}: Omit<ThemeSurfaceProps, 'themeId'> & { isUser: boolean }) {
  return (
    <View testID="chat-message-content-surface-markdown" style={{ width: '100%', maxWidth: '100%', overflow: 'hidden', flexDirection: 'row', alignItems: 'stretch' }}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          width: 14,
          alignItems: 'center',
          paddingTop: 3,
          marginRight: 8,
          borderRightWidth: StyleSheet.hairlineWidth,
          borderRightColor: isUser ? colors.ui.message.userBorder : colors.ui.semantic.chrome.border,
        }}
      >
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isUser ? colors.ui.message.userForeground : colors.textTertiary }} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>{children}</View>
    </View>
  )
}

function RouteRail({ colors, compact = false }: { colors: ThemeColors; compact?: boolean }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: 'absolute',
        top: compact ? 4 : 5,
        left: compact ? 8 : 10,
        right: compact ? 8 : 10,
        height: compact ? 5 : 7,
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 4 : 5,
      }}
    >
      <View style={{ width: compact ? 5 : 7, height: compact ? 5 : 7, borderRadius: 99, backgroundColor: colors.ui.icon.accentForeground }} />
      <View style={{ flex: 1, height: 1, backgroundColor: colors.material.strokeStrong }} />
      <View style={{ width: compact ? 12 : 18, height: compact ? 3 : 4, borderRadius: 2, backgroundColor: colors.primary }} />
      <View style={{ width: compact ? 8 : 12, height: compact ? 3 : 4, borderRadius: 2, backgroundColor: colors.accent }} />
    </View>
  )
}

function DocumentCommandRail({ colors, compact = false }: { colors: ThemeColors; compact?: boolean }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        height: compact ? 6 : 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: compact ? 5 : 7,
        backgroundColor: colors.ui.semantic.chrome.toolbar,
        borderBottomWidth: compact ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.ui.semantic.chrome.border,
      }}
    >
      <View style={{ width: compact ? 8 : 12, height: 2, backgroundColor: colors.textTertiary }} />
      <View style={{ width: compact ? 4 : 7, height: 2, backgroundColor: colors.ui.control.primaryBackground }} />
      <View style={{ flex: 1 }} />
      <View style={{ width: compact ? 10 : 16, height: 2, backgroundColor: colors.ui.semantic.chrome.border }} />
    </View>
  )
}
