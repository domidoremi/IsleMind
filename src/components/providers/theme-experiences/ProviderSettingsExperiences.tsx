import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'

export interface ProviderSettingsExperienceProps {
  title: string
  subtitle: string
  backLabel: string
  addLabel: string
  importLabel: string
  enabledSummary: string
  visibleSummary: string
  enabledCount: number
  totalCount: number
  visibleCount: number
  compact: boolean
  onBack: () => void
  onAdd: () => void
  onImport: () => void
  attention?: ReactNode
  activation?: ReactNode
  tools?: ReactNode
  children: ReactNode
}

function ProviderCommand({
  label,
  icon,
  onPress,
  variant,
}: {
  label: string
  icon: 'add' | 'import'
  onPress: () => void
  variant: 'quiet' | 'ticket' | 'document'
}) {
  const { colors } = useAppTheme()
  const ticket = variant === 'ticket'
  const document = variant === 'document'
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: 44,
        minWidth: ticket ? 88 : 44,
        paddingHorizontal: ticket || document ? 11 : 9,
        borderRadius: ticket ? Math.min(colors.ui.radius.controlMiddle, 8) : document ? 0 : Math.min(colors.ui.radius.controlSmall, 8),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        backgroundColor: ticket ? colors.ui.control.primaryBackground : document ? 'transparent' : colors.ui.semantic.surface.muted,
        borderWidth: document ? 0 : ticket ? 1 : StyleSheet.hairlineWidth,
        borderColor: ticket ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
        borderBottomWidth: document ? 2 : undefined,
        borderBottomColor: document ? colors.ui.section.divider : undefined,
      }}
    >
      <AppIcon
        name={icon}
        color={ticket ? colors.ui.control.primaryForeground : colors.textSecondary}
        size={ticket ? 16 : 15}
        strokeWidth={appIconStroke.bold}
      />
      {ticket || document ? (
        <Text
          style={{
            color: ticket ? colors.ui.control.primaryForeground : colors.textSecondary,
            fontSize: 14,
            lineHeight: 20,
            flexShrink: 1,
            fontWeight: '900',
            letterSpacing: document ? 0.35 : 0,
          }}
        >
          {document ? label.toUpperCase() : label}
        </Text>
      ) : null}
    </IslePressable>
  )
}

function ProviderBack({ label, onPress, variant }: { label: string; onPress: () => void; variant: 'quiet' | 'route' | 'document' }) {
  const { colors } = useAppTheme()
  return (
    <IslePressable
      haptic
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: variant === 'route' ? 22 : variant === 'document' ? 0 : Math.min(colors.ui.radius.controlSmall, 8),
        backgroundColor: variant === 'route' ? colors.ui.semantic.surface.muted : 'transparent',
        borderWidth: variant === 'route' ? 1 : 0,
        borderColor: colors.material.stroke,
      }}
    >
      <AppIcon name="back-previous" color={colors.text} size={18} strokeWidth={appIconStroke.strong} />
    </IslePressable>
  )
}

export function MinimalProviderSettingsExperience({
  title,
  subtitle,
  backLabel,
  addLabel,
  importLabel,
  enabledSummary,
  visibleSummary,
  enabledCount,
  totalCount,
  visibleCount,
  compact,
  onBack,
  onAdd,
  onImport,
  attention,
  activation,
  tools,
  children,
}: ProviderSettingsExperienceProps) {
  const { colors } = useAppTheme()
  return (
    <View testID="provider-settings-experience-minimal" style={{ width: '100%', maxWidth: 860, alignSelf: 'center' }}>
      <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <ProviderBack label={backLabel} onPress={onBack} variant="quiet" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', includeFontPadding: false }}>
            {title}
          </Text>
          {!compact ? (
            <Text style={{ marginTop: 1, color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '500', includeFontPadding: false }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ProviderCommand label={addLabel} icon="add" onPress={onAdd} variant="quiet" />
          <ProviderCommand label={importLabel} icon="import" onPress={onImport} variant="quiet" />
        </View>
      </View>
      <View style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
        <Text style={{ flexShrink: 1, color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{enabledSummary}</Text>
        <View style={{ width: 1, height: 13, backgroundColor: colors.ui.section.divider }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 14, lineHeight: 20, fontWeight: '600' }}>{visibleSummary}</Text>
      </View>
      {attention ? <View style={{ paddingTop: 10 }}>{attention}</View> : null}
      {activation ? <View style={{ paddingTop: 10 }}>{activation}</View> : null}
      {tools ? <View style={{ paddingTop: 10 }}>{tools}</View> : null}
      <View style={{ paddingTop: 10 }}>{children}</View>
    </View>
  )
}

function CanonicalProviderSettingsExperience({
  family,
  props,
}: {
  family: 'monet' | 'material' | 'liquid-glass'
  props: ProviderSettingsExperienceProps
}) {
  const { colors, design } = useAppTheme()
  const glass = family === 'liquid-glass'
  const material = family === 'material'
  return (
    <View testID={`provider-settings-experience-${family}`} style={{ width: '100%', maxWidth: family === 'monet' ? 980 : 920, alignSelf: 'center', gap: design.semantic.spacing.md }}>
      <GlassSurface colors={colors} enabled={glass} style={{ minHeight: material ? 72 : 64, padding: glass ? 12 : 8, borderRadius: glass ? design.semantic.radius.extraLarge : material ? design.semantic.radius.extraLarge : 0, backgroundColor: material ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: material ? 1 : 0, borderBottomWidth: glass ? 0 : material ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.semantic.chrome.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ProviderBack label={props.backLabel} onPress={props.onBack} variant={glass || material ? 'route' : 'quiet'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: design.semantic.typography.headline.fontSize, lineHeight: design.semantic.typography.headline.lineHeight, fontWeight: design.semantic.typography.headline.fontWeight }}>{props.title}</Text>
          {!props.compact ? <Text style={{ marginTop: 2, color: colors.textSecondary, fontSize: 14, lineHeight: 20 }}>{props.subtitle}</Text> : null}
        </View>
        <ProviderCommand label={props.addLabel} icon="add" onPress={props.onAdd} variant={props.compact ? 'quiet' : glass || material ? 'ticket' : 'quiet'} />
        <ProviderCommand label={props.importLabel} icon="import" onPress={props.onImport} variant={props.compact ? 'quiet' : glass || material ? 'ticket' : 'quiet'} />
      </GlassSurface>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: material ? 14 : 4, minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ flexShrink: 1, color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700' }}>{props.enabledSummary}</Text>
        <View style={{ width: 1, height: 14, backgroundColor: colors.ui.semantic.chrome.border }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 14, lineHeight: 20 }}>{props.visibleSummary}</Text>
      </View>
      {props.attention ? <View>{props.attention}</View> : null}
      {props.activation ? <View>{props.activation}</View> : null}
      {props.tools ? <View>{props.tools}</View> : null}
      <GlassSurface colors={colors} enabled={glass} style={{ padding: glass ? 12 : material ? 8 : 0, borderRadius: glass ? design.semantic.radius.extraLarge : material ? design.semantic.radius.extraLarge : 0, backgroundColor: material ? colors.ui.semantic.surface.muted : 'transparent', borderWidth: material ? 1 : 0, borderColor: colors.ui.semantic.chrome.border }}>
        {props.children}
      </GlassSurface>
    </View>
  )
}

export function MonetProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <CanonicalProviderSettingsExperience family="monet" props={props} />
}

export function MaterialProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <CanonicalProviderSettingsExperience family="material" props={props} />
}

export function LiquidGlassProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <CanonicalProviderSettingsExperience family="liquid-glass" props={props} />
}
