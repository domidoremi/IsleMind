import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AnimatedNavigationIcon, type NavigationGlyph } from '@/components/navigation/AnimatedNavigationIcon'
import { useNavigationTrigger } from '@/components/navigation/AnimatedNavigationTrigger'
import { AppIcon } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { CanonicalThemeId } from '@/types/settingsContracts'

import { renderCompressionMessage, type CompressionSummary } from './compressionSummary'
import type { ConversationHealth } from './conversationHealth'
import { resolveChatChromeBorder, resolveChatChromeSurface, resolveChatControlSurface } from './chatChromeSurfaces'

export function ConversationHealthBanner({
  health,
  onConfigure,
  onSwitch,
  compact = false,
}: {
  health: ConversationHealth
  onConfigure: () => void
  onSwitch: () => void
  compact?: boolean
}) {
  const { colors, isGlass, canonicalThemeId } = useAppTheme()
  const { t } = useTranslation()
  const healthTone = health.inheritedExpired || health.code === 'provider_missing' ? colors.ui.tone.danger : colors.ui.tone.warning
  const borderColor = healthTone.border
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  if (compact) {
    const shouldSwitchProvider = health.code === 'provider_missing' || health.code === 'model_unavailable'
    const primaryAction = shouldSwitchProvider ? onSwitch : onConfigure
    const primaryGlyph: NavigationGlyph = shouldSwitchProvider ? 'settings-sliders' : 'provider-key'
    const primaryLabel = shouldSwitchProvider
      ? t('chat.switchModel')
      : t('chat.configure')
    const compactProps: CompactHealthBannerProps = {
      health,
      primaryAction,
      primaryGlyph,
      primaryLabel,
    }
    if (canonicalThemeId === 'monet' || canonicalThemeId === 'material' || canonicalThemeId === 'liquid-glass') return <CanonicalCompactHealthBanner {...compactProps} family={canonicalThemeId} />
    if (colors.ui.family === 'lime-road') return <LimeRoadCompactHealthBanner {...compactProps} />
    if (colors.ui.family === 'markdown') return <MarkdownCompactHealthBanner {...compactProps} />
    return <MinimalCompactHealthBanner {...compactProps} />
  }
  if (canonicalThemeId !== 'minimal') return <CanonicalHealthBanner health={health} onConfigure={onConfigure} onSwitch={onSwitch} compact={compact} family={canonicalThemeId} />
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: colors.ui.radius.card,
        padding: 13,
        backgroundColor: resolveChatChromeSurface(colors, isGlass),
        borderWidth: subtleBorderWidth,
        borderColor,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: colors.ui.radius.controlMiddle, alignItems: 'center', justifyContent: 'center', backgroundColor: healthTone.background }}>
          <AppIcon name="warning" color={healthTone.foreground} size={18} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: '800' }}>{health.title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 }}>{health.description}</Text>
          {health.inheritedExpired ? (
            <Text style={{ color: healthTone.foreground, fontSize: 11, lineHeight: 16, marginTop: 5 }}>
              {t('chat.chooseAvailableModel')}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <BannerAction label={t('chat.configure')} glyph="provider-key" onPress={onConfigure} />
        <BannerAction label={t('chat.switchModel')} onPress={onSwitch} />
      </View>
    </View>
  )
}

interface CompactHealthBannerProps {
  health: ConversationHealth
  primaryAction: () => void
  primaryGlyph: NavigationGlyph
  primaryLabel: string
}

function MinimalCompactHealthBanner({ health, primaryAction, primaryGlyph, primaryLabel }: CompactHealthBannerProps) {
  const { colors, isGlass } = useAppTheme()
  const tone = health.inheritedExpired || health.code === 'provider_missing' ? colors.ui.tone.danger : colors.ui.tone.warning
  return (
    <View
      testID="chat-health-experience-minimal"
      style={{ alignSelf: 'stretch' }}
    >
      <IslePressable
        haptic
        onPress={primaryAction}
        accessibilityRole="button"
        accessibilityLabel={health.title}
        accessibilityHint={health.description}
        style={{
          minHeight: 52,
          paddingHorizontal: 12,
          paddingVertical: 9,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderLeftWidth: 3,
          borderLeftColor: tone.foreground,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: tone.border,
          backgroundColor: isGlass ? colors.ui.semantic.surface.overlay : colors.ui.semantic.surface.base,
        }}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.foreground }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: '900', includeFontPadding: false }}>{health.title}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '700', includeFontPadding: false }}>{health.description}</Text>
        </View>
        <View style={{ minHeight: 32, maxWidth: 112, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: tone.border, backgroundColor: tone.background }}>
          <AnimatedNavigationIcon glyph={primaryGlyph} active={false} color={tone.foreground} size={12} />
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 9.5, lineHeight: 12, fontWeight: '900', includeFontPadding: false }}>{primaryLabel}</Text>
        </View>
      </IslePressable>
    </View>
  )
}

function LimeRoadCompactHealthBanner({ health, primaryAction, primaryGlyph, primaryLabel }: CompactHealthBannerProps) {
  const { colors } = useAppTheme()
  const tone = health.inheritedExpired || health.code === 'provider_missing' ? colors.ui.tone.danger : colors.ui.tone.warning
  return (
    <View
      testID="chat-health-experience-lime-road"
      style={{ alignSelf: 'stretch' }}
    >
      <IslePressable
        haptic
        onPress={primaryAction}
        accessibilityRole="button"
        accessibilityLabel={health.title}
        accessibilityHint={health.description}
        style={{
          minHeight: 58,
          paddingHorizontal: 11,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderLeftWidth: 3,
          borderLeftColor: tone.foreground,
          borderBottomWidth: 1,
          borderBottomColor: colors.material.stroke,
          backgroundColor: colors.ui.semantic.surface.base,
        }}
      >
        <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: tone.foreground, backgroundColor: colors.paper }} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, lineHeight: 16, fontWeight: '900' }}>{health.title}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '700' }}>{health.description}</Text>
        </View>
        <View style={{ maxWidth: 106, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AnimatedNavigationIcon glyph={primaryGlyph} active={false} color={tone.foreground} size={12} />
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 9, lineHeight: 11, fontWeight: '900' }}>{primaryLabel}</Text>
        </View>
      </IslePressable>
    </View>
  )
}

function MarkdownCompactHealthBanner({ health, primaryAction, primaryGlyph, primaryLabel }: CompactHealthBannerProps) {
  const { colors } = useAppTheme()
  const tone = health.inheritedExpired || health.code === 'provider_missing' ? colors.ui.tone.danger : colors.ui.tone.warning
  return (
    <View
      testID="chat-health-experience-markdown"
      style={{ alignSelf: 'stretch' }}
    >
      <IslePressable
        haptic
        onPress={primaryAction}
        accessibilityRole="button"
        accessibilityLabel={health.title}
        accessibilityHint={health.description}
        style={{
          minHeight: 58,
          paddingHorizontal: 11,
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          borderLeftWidth: 2,
          borderLeftColor: tone.foreground,
          borderBottomWidth: 1,
          borderBottomColor: colors.material.stroke,
          backgroundColor: colors.ui.semantic.surface.base,
        }}
      >
        <AppIcon name="warning" color={tone.foreground} size={13} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, lineHeight: 15, fontWeight: '800' }}>{health.title}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: 9.5, lineHeight: 12, fontWeight: '600' }}>{health.description}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <AnimatedNavigationIcon glyph={primaryGlyph} active={false} color={tone.foreground} size={11} />
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: 9, lineHeight: 11, fontWeight: '900' }}>{primaryLabel}</Text>
        </View>
      </IslePressable>
    </View>
  )
}

function CanonicalCompactHealthBanner({ health, primaryAction, primaryGlyph, primaryLabel, family }: CompactHealthBannerProps & { family: Exclude<CanonicalThemeId, 'minimal'> }) {
  const { colors, design } = useAppTheme()
  const tone = health.inheritedExpired || health.code === 'provider_missing' ? colors.ui.tone.danger : colors.ui.tone.warning
  const glass = family === 'liquid-glass'
  const material = family === 'material'
  return (
    <View testID={`chat-health-experience-${family}`} style={{ alignSelf: 'stretch', paddingHorizontal: glass ? 8 : 0 }}>
      <IslePressable haptic onPress={primaryAction} accessibilityRole="button" accessibilityLabel={health.title} accessibilityHint={health.description} style={{ minHeight: material ? 62 : 58, padding: material ? 12 : 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: glass ? design.semantic.radius.extraLarge : material ? design.semantic.radius.extraLarge : design.semantic.radius.large, backgroundColor: glass ? colors.ui.semantic.chrome.background : material ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: glass || material ? 1 : 0, borderBottomWidth: glass || material ? 1 : StyleSheet.hairlineWidth, borderColor: tone.border, shadowColor: glass ? design.semantic.elevation.shadowColor : undefined, shadowOpacity: glass ? design.semantic.elevation.shadowOpacity : 0, shadowRadius: glass ? design.semantic.elevation.shadowBlur : 0, shadowOffset: glass ? { width: 0, height: design.semantic.elevation.shadowOffsetY } : undefined, elevation: glass ? design.semantic.elevation.level2 : 0 }}>
        <View style={{ width: material ? 32 : 11, height: material ? 32 : 11, borderRadius: material ? design.semantic.radius.medium : 6, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background }}>
          <AppIcon name="warning" color={tone.foreground} size={material ? 16 : 9} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: design.semantic.typography.label.fontSize, lineHeight: design.semantic.typography.label.lineHeight, fontWeight: '700' }}>{health.title}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: design.semantic.typography.caption.fontSize, lineHeight: design.semantic.typography.caption.lineHeight }}>{health.description}</Text>
        </View>
        <View style={{ minHeight: 32, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: design.semantic.radius.pill, backgroundColor: tone.background }}>
          <AnimatedNavigationIcon glyph={primaryGlyph} active={false} color={tone.foreground} size={12} />
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: design.semantic.typography.caption.fontSize, fontWeight: '700' }}>{primaryLabel}</Text>
        </View>
      </IslePressable>
    </View>
  )
}

function CanonicalHealthBanner({ health, onConfigure, onSwitch, family }: { health: ConversationHealth; onConfigure: () => void; onSwitch: () => void; compact: boolean; family: Exclude<CanonicalThemeId, 'minimal'> }) {
  const { colors, design } = useAppTheme()
  const { t } = useTranslation()
  const tone = health.inheritedExpired || health.code === 'provider_missing' ? colors.ui.tone.danger : colors.ui.tone.warning
  const glass = family === 'liquid-glass'
  return (
    <View testID={`chat-health-experience-${family}`} style={{ marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: glass ? design.semantic.radius.extraLarge : design.semantic.radius.large, backgroundColor: glass ? colors.ui.semantic.chrome.background : family === 'material' ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: 1, borderColor: tone.border, shadowColor: glass ? design.semantic.elevation.shadowColor : undefined, shadowOpacity: glass ? design.semantic.elevation.shadowOpacity : 0, shadowRadius: glass ? design.semantic.elevation.shadowBlur : 0, shadowOffset: glass ? { width: 0, height: design.semantic.elevation.shadowOffsetY } : undefined, elevation: glass ? design.semantic.elevation.level2 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: family === 'material' ? design.semantic.radius.medium : design.semantic.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background }}><AppIcon name="warning" color={tone.foreground} size={18} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.text, fontSize: design.semantic.typography.title.fontSize, lineHeight: design.semantic.typography.title.lineHeight, fontWeight: design.semantic.typography.title.fontWeight }}>{health.title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: design.semantic.typography.body.fontSize, lineHeight: design.semantic.typography.body.lineHeight, marginTop: 3 }}>{health.description}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <BannerAction label={t('chat.configure')} glyph="provider-key" onPress={onConfigure} />
        <BannerAction label={t('chat.switchModel')} onPress={onSwitch} />
      </View>
    </View>
  )
}

function BannerAction({ label, glyph, compact = false, disabled = false, onPress }: { label: string; glyph?: NavigationGlyph; compact?: boolean; disabled?: boolean; onPress: () => void }) {
  const { colors, isGlass } = useAppTheme()
  const navigation = useNavigationTrigger(onPress)
  const press = glyph ? navigation.trigger : onPress
  const surface = compact ? resolveChatControlSurface(colors, isGlass, false) : resolveChatChromeSurface(colors, isGlass)
  const borderColor = resolveChatChromeBorder(colors, isGlass)
  const subtleBorderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const foreground = compact && isGlass ? colors.textSecondary : colors.text
  return (
    <IslePressable
      haptic
      disabled={disabled}
      onPress={press}
      style={{
        minHeight: compact ? 34 : 44,
        borderRadius: colors.ui.radius.controlLarge,
        paddingHorizontal: compact ? 9 : 14,
        flexDirection: 'row',
        gap: glyph ? (compact ? 5 : 6) : 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: surface,
        borderWidth: subtleBorderWidth,
        borderColor,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {glyph ? <AnimatedNavigationIcon glyph={glyph} active={navigation.active} color={foreground} size={compact ? 14 : 16} /> : null}
      <Text style={{ color: foreground, fontSize: compact ? 9 : 12, fontWeight: '800' }}>{label}</Text>
    </IslePressable>
  )
}

export function CompressionBanner({
  compression,
  onOpenDetails,
  compact = false,
}: {
  compression: CompressionSummary
  onOpenDetails: () => void
  compact?: boolean
}) {
  const { colors, canonicalThemeId } = useAppTheme()
  if (canonicalThemeId !== 'minimal') return <CanonicalCompressionBanner compression={compression} onOpenDetails={onOpenDetails} compact={compact} family={canonicalThemeId} />
  if (colors.ui.family === 'lime-road') return <LimeRoadCompressionBanner compression={compression} onOpenDetails={onOpenDetails} compact={compact} />
  if (colors.ui.family === 'markdown') return <MarkdownCompressionBanner compression={compression} onOpenDetails={onOpenDetails} compact={compact} />
  return <MinimalCompressionBanner compression={compression} onOpenDetails={onOpenDetails} compact={compact} />
}

function MinimalCompressionBanner({ compression, onOpenDetails, compact }: { compression: CompressionSummary; onOpenDetails: () => void; compact: boolean }) {
  const { colors, isGlass } = useAppTheme()
  const { t } = useTranslation()
  const tone = compression.mode === 'remote' ? colors.ui.tone.success : colors.ui.tone.warning
  const ratio = Math.round(compression.ratio * 100)
  const savedTokens = Math.max(0, Math.round(compression.savedTokens))
  return (
    <View
      testID="chat-compression-experience-minimal"
      style={{ alignSelf: 'stretch' }}
    >
      <IslePressable
        haptic
        onPress={onOpenDetails}
        accessibilityRole="button"
        accessibilityLabel={t(compression.titleKey)}
        accessibilityHint={renderCompressionMessage(compression, t)}
        style={{
          minHeight: compact ? 34 : 42,
          borderRadius: colors.ui.radius.card,
          paddingHorizontal: compact ? 10 : 12,
          paddingVertical: compact ? 7 : 8,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: isGlass ? colors.ui.semantic.chrome.background : colors.ui.semantic.surface.base,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: tone.border,
        }}
      >
        <View style={{ width: compact ? 20 : 24, height: compact ? 20 : 24, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background }}>
          <AppIcon name={compression.mode === 'remote' ? 'skills-sparkles' : 'memory-brain'} color={tone.foreground} size={compact ? 11 : 13} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: compact ? 10 : 12.5, lineHeight: compact ? 12 : 15, fontWeight: '800', includeFontPadding: false }}>
            {t(compression.titleKey)}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: compact ? 8.5 : 10.5, lineHeight: compact ? 10 : 13, fontWeight: '700', includeFontPadding: false }}>
            {renderCompressionMessage(compression, t)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', minWidth: compact ? 52 : 66 }}>
          <Text numberOfLines={1} style={{ color: tone.foreground, fontSize: compact ? 9 : 11, lineHeight: compact ? 10 : 13, fontWeight: '800', includeFontPadding: false }}>
            {t('chat.compressionRatio', { ratio })}
          </Text>
          <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: compact ? 8 : 9.5, lineHeight: compact ? 9 : 11, fontWeight: '700', includeFontPadding: false }}>
            {t('chat.compressionSavedTokens', { count: savedTokens })}
          </Text>
        </View>
      </IslePressable>
    </View>
  )
}

function LimeRoadCompressionBanner({ compression, onOpenDetails, compact }: { compression: CompressionSummary; onOpenDetails: () => void; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tone = compression.mode === 'remote' ? colors.ui.tone.success : colors.ui.tone.warning
  const ratio = Math.round(compression.ratio * 100)
  const savedTokens = Math.max(0, Math.round(compression.savedTokens))
  return (
    <View
      testID="chat-compression-experience-lime-road"
      style={{ alignSelf: 'stretch' }}
    >
      <IslePressable
        haptic
        onPress={onOpenDetails}
        accessibilityRole="button"
        accessibilityLabel={t(compression.titleKey)}
        accessibilityHint={renderCompressionMessage(compression, t)}
        style={{
          minHeight: compact ? 52 : 60,
          flexDirection: 'row',
          alignItems: 'stretch',
          borderWidth: 1,
          borderColor: tone.border,
          backgroundColor: colors.ui.semantic.surface.base,
        }}
      >
        <View style={{ width: 34, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderRightColor: colors.material.stroke }}>
          <Text style={{ color: colors.textTertiary, fontSize: 8, lineHeight: 10, fontWeight: '900' }}>AI</Text>
          <View style={{ width: 11, height: 11, marginTop: 4, borderRadius: 6, borderWidth: 3, borderColor: tone.foreground, backgroundColor: colors.paper }} />
        </View>
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 9, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: compact ? 10.5 : 12, lineHeight: compact ? 13 : 15, fontWeight: '900' }}>{t(compression.titleKey)}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: compact ? 8.5 : 10, lineHeight: compact ? 11 : 13, fontWeight: '700' }}>{renderCompressionMessage(compression, t)}</Text>
        </View>
        <View style={{ minWidth: 67, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background }}>
          <Text style={{ color: tone.foreground, fontSize: 10, lineHeight: 12, fontWeight: '900' }}>{t('chat.compressionRatio', { ratio })}</Text>
          <Text style={{ marginTop: 2, color: tone.foreground, fontSize: 8.5, lineHeight: 10, fontWeight: '700' }}>{t('chat.compressionSavedTokens', { count: savedTokens })}</Text>
        </View>
      </IslePressable>
    </View>
  )
}

function MarkdownCompressionBanner({ compression, onOpenDetails, compact }: { compression: CompressionSummary; onOpenDetails: () => void; compact: boolean }) {
  const { colors } = useAppTheme()
  const { t } = useTranslation()
  const tone = compression.mode === 'remote' ? colors.ui.tone.success : colors.ui.tone.warning
  const ratio = Math.round(compression.ratio * 100)
  const savedTokens = Math.max(0, Math.round(compression.savedTokens))
  return (
    <View
      testID="chat-compression-experience-markdown"
      style={{ alignSelf: 'stretch' }}
    >
      <IslePressable
        haptic
        onPress={onOpenDetails}
        accessibilityRole="button"
        accessibilityLabel={t(compression.titleKey)}
        accessibilityHint={renderCompressionMessage(compression, t)}
        style={{
          minHeight: compact ? 48 : 56,
          paddingHorizontal: 11,
          paddingVertical: 8,
          borderLeftWidth: 3,
          borderLeftColor: tone.foreground,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderColor: colors.material.stroke,
          backgroundColor: colors.ui.semantic.surface.muted,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <AppIcon name={compression.mode === 'remote' ? 'skills-sparkles' : 'memory-brain'} color={tone.foreground} size={12} />
          <Text numberOfLines={1} style={{ flex: 1, color: colors.text, fontSize: compact ? 10 : 11.5, lineHeight: compact ? 13 : 15, fontWeight: '800' }}>{t(compression.titleKey)}</Text>
          <Text style={{ color: tone.foreground, fontSize: 9, lineHeight: 12, fontWeight: '900' }}>{t('chat.compressionRatio', { ratio })}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: colors.textSecondary, fontSize: compact ? 8.5 : 10, lineHeight: compact ? 11 : 13, fontWeight: '700' }}>{renderCompressionMessage(compression, t)}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: 8.5, lineHeight: 11, fontWeight: '700' }}>{t('chat.compressionSavedTokens', { count: savedTokens })}</Text>
        </View>
      </IslePressable>
    </View>
  )
}

function CanonicalCompressionBanner({ compression, onOpenDetails, compact, family }: { compression: CompressionSummary; onOpenDetails: () => void; compact: boolean; family: Exclude<CanonicalThemeId, 'minimal'> }) {
  const { colors, design } = useAppTheme()
  const { t } = useTranslation()
  const tone = compression.mode === 'remote' ? colors.ui.tone.success : colors.ui.tone.warning
  const ratio = Math.round(compression.ratio * 100)
  const savedTokens = Math.max(0, Math.round(compression.savedTokens))
  const glass = family === 'liquid-glass'
  return (
    <View testID={`chat-compression-experience-${family}`} style={{ alignSelf: 'stretch', paddingHorizontal: glass ? 8 : 0 }}>
      <IslePressable haptic onPress={onOpenDetails} accessibilityRole="button" accessibilityLabel={t(compression.titleKey)} accessibilityHint={renderCompressionMessage(compression, t)} style={{ minHeight: compact ? 48 : 60, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: glass ? design.semantic.radius.extraLarge : family === 'material' ? design.semantic.radius.extraLarge : design.semantic.radius.large, backgroundColor: glass ? colors.ui.semantic.chrome.background : family === 'material' ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: 1, borderColor: tone.border, shadowColor: glass ? design.semantic.elevation.shadowColor : undefined, shadowOpacity: glass ? design.semantic.elevation.shadowOpacity : 0, shadowRadius: glass ? design.semantic.elevation.shadowBlur : 0, shadowOffset: glass ? { width: 0, height: design.semantic.elevation.shadowOffsetY } : undefined, elevation: glass ? design.semantic.elevation.level2 : 0 }}>
        <View style={{ width: 32, height: 32, borderRadius: family === 'material' ? design.semantic.radius.medium : design.semantic.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.background }}><AppIcon name={compression.mode === 'remote' ? 'skills-sparkles' : 'memory-brain'} color={tone.foreground} size={15} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: design.semantic.typography.label.fontSize, lineHeight: design.semantic.typography.label.lineHeight, fontWeight: '700' }}>{t(compression.titleKey)}</Text>
          <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: design.semantic.typography.caption.fontSize, lineHeight: design.semantic.typography.caption.lineHeight }}>{renderCompressionMessage(compression, t)}</Text>
        </View>
        <View style={{ minWidth: 58, alignItems: 'flex-end' }}>
          <Text style={{ color: tone.foreground, fontSize: design.semantic.typography.label.fontSize, fontWeight: '800' }}>{t('chat.compressionRatio', { ratio })}</Text>
          <Text style={{ color: colors.textTertiary, fontSize: design.semantic.typography.caption.fontSize }}>{t('chat.compressionSavedTokens', { count: savedTokens })}</Text>
        </View>
      </IslePressable>
    </View>
  )
}
