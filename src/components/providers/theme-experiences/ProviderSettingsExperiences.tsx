import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

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
          numberOfLines={1}
          style={{
            color: ticket ? colors.ui.control.primaryForeground : colors.textSecondary,
            fontSize: document ? 10.5 : 11.5,
            lineHeight: 15,
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
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '700', includeFontPadding: false }}>
            {title}
          </Text>
          {!compact ? (
            <Text numberOfLines={1} style={{ marginTop: 1, color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '500', includeFontPadding: false }}>
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
        <Text style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '700' }}>{enabledSummary}</Text>
        <View style={{ width: 1, height: 13, backgroundColor: colors.ui.section.divider }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 11, lineHeight: 15, fontWeight: '600' }}>{visibleSummary}</Text>
      </View>
      {attention ? <View style={{ paddingTop: 10 }}>{attention}</View> : null}
      {activation ? <View style={{ paddingTop: 10 }}>{activation}</View> : null}
      {tools ? <View style={{ paddingTop: 10 }}>{tools}</View> : null}
      <View style={{ paddingTop: 10 }}>{children}</View>
    </View>
  )
}

export function LimeRoadProviderSettingsExperience({
  title,
  subtitle,
  backLabel,
  addLabel,
  importLabel,
  enabledSummary,
  visibleSummary,
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
    <View testID="provider-settings-experience-lime-road" style={{ width: '100%', maxWidth: 980, alignSelf: 'center' }}>
      <View style={{ minHeight: 60, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: 1, borderBottomColor: colors.material.stroke }}>
        <ProviderBack label={backLabel} onPress={onBack} variant="route" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.text, fontSize: 19, lineHeight: 24, fontWeight: '900', includeFontPadding: false }}>{title}</Text>
          {!compact ? <Text numberOfLines={1} style={{ marginTop: 1, color: colors.textSecondary, fontSize: 10.5, lineHeight: 14, fontWeight: '600', includeFontPadding: false }}>{subtitle}</Text> : null}
        </View>
        <ProviderCommand label={addLabel} icon="add" onPress={onAdd} variant="quiet" />
        <ProviderCommand label={importLabel} icon="import" onPress={onImport} variant="quiet" />
      </View>
      <View style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1, borderBottomColor: colors.material.stroke }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '800' }}>{enabledSummary}</Text>
        <View style={{ width: 1, height: 13, backgroundColor: colors.material.stroke }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '700' }}>{visibleSummary}</Text>
      </View>
      <View testID="provider-lime-road-itinerary" style={{ paddingTop: 10, paddingLeft: compact ? 10 : 12, borderLeftWidth: 3, borderLeftColor: colors.ui.control.link }}>
        {attention ? <View style={{ marginBottom: 10 }}>{attention}</View> : null}
        {activation ? <View style={{ marginBottom: 10 }}>{activation}</View> : null}
        {tools ? <View style={{ marginBottom: 10 }}>{tools}</View> : null}
        {children}
      </View>
    </View>
  )
}

export function MarkdownProviderSettingsExperience({
  title,
  subtitle,
  backLabel,
  addLabel,
  importLabel,
  enabledSummary,
  visibleSummary,
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
    <View testID="provider-settings-experience-markdown" style={{ width: '100%', maxWidth: 1040, alignSelf: 'center' }}>
      <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
        <ProviderBack label={backLabel} onPress={onBack} variant="document" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.text, fontSize: 18, lineHeight: 23, fontWeight: '800' }}>{title}</Text>
          {!compact ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600' }}>{subtitle}</Text> : null}
        </View>
        <ProviderCommand label={addLabel} icon="add" onPress={onAdd} variant="document" />
        {!compact ? <ProviderCommand label={importLabel} icon="import" onPress={onImport} variant="document" /> : null}
      </View>
      {compact ? (
        <View style={{ paddingTop: 8, alignItems: 'flex-start' }}>
          <ProviderCommand label={importLabel} icon="import" onPress={onImport} variant="document" />
        </View>
      ) : null}
      <View style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.section.divider }}>
        <Text style={{ color: colors.textSecondary, fontSize: 11.5, lineHeight: 16, fontWeight: '700' }}>{enabledSummary}</Text>
        <View style={{ width: 1, height: 13, backgroundColor: colors.ui.section.divider }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: 10.5, lineHeight: 14, fontWeight: '600' }}>{visibleSummary}</Text>
      </View>
      <View testID="provider-markdown-outline" style={{ paddingTop: 12, paddingLeft: compact ? 10 : 12, borderLeftWidth: 2, borderLeftColor: colors.ui.section.divider }}>
          {attention ? <View style={{ marginBottom: 10 }}>{attention}</View> : null}
          {activation ? <View style={{ marginBottom: 10 }}>{activation}</View> : null}
          {tools ? <View style={{ marginBottom: 10 }}>{tools}</View> : null}
          {children}
      </View>
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
      <View style={{ minHeight: material ? 72 : 64, padding: glass ? 12 : 8, borderRadius: glass ? design.semantic.radius.extraLarge : material ? design.semantic.radius.extraLarge : 0, backgroundColor: glass ? colors.ui.semantic.chrome.background : material ? colors.ui.semantic.surface.muted : colors.ui.semantic.surface.base, borderWidth: glass || material ? 1 : 0, borderBottomWidth: glass || material ? 1 : StyleSheet.hairlineWidth, borderColor: colors.ui.semantic.chrome.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <ProviderBack label={props.backLabel} onPress={props.onBack} variant={glass || material ? 'route' : 'quiet'} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: colors.text, fontSize: design.semantic.typography.headline.fontSize, lineHeight: design.semantic.typography.headline.lineHeight, fontWeight: design.semantic.typography.headline.fontWeight }}>{props.title}</Text>
          {!props.compact ? <Text numberOfLines={1} style={{ marginTop: 2, color: colors.textSecondary, fontSize: design.semantic.typography.caption.fontSize, lineHeight: design.semantic.typography.caption.lineHeight }}>{props.subtitle}</Text> : null}
        </View>
        <ProviderCommand label={props.addLabel} icon="add" onPress={props.onAdd} variant={glass ? 'ticket' : material ? 'ticket' : 'quiet'} />
        {!props.compact ? <ProviderCommand label={props.importLabel} icon="import" onPress={props.onImport} variant={glass ? 'ticket' : material ? 'ticket' : 'quiet'} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: material ? 14 : 4, minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ui.semantic.chrome.border }}>
        <Text style={{ color: colors.textSecondary, fontSize: design.semantic.typography.label.fontSize, fontWeight: '700' }}>{props.enabledSummary}</Text>
        <View style={{ width: 1, height: 14, backgroundColor: colors.ui.semantic.chrome.border }} />
        <Text style={{ flex: 1, minWidth: 0, color: colors.textTertiary, fontSize: design.semantic.typography.caption.fontSize }}>{props.visibleSummary}</Text>
      </View>
      {props.attention ? <View>{props.attention}</View> : null}
      {props.activation ? <View>{props.activation}</View> : null}
      {props.tools ? <View>{props.tools}</View> : null}
      <View style={{ padding: glass ? 12 : material ? 8 : 0, borderRadius: glass ? design.semantic.radius.extraLarge : material ? design.semantic.radius.extraLarge : 0, backgroundColor: glass ? colors.ui.semantic.chrome.background : material ? colors.ui.semantic.surface.muted : 'transparent', borderWidth: glass || material ? 1 : 0, borderColor: colors.ui.semantic.chrome.border, shadowColor: glass ? design.semantic.elevation.shadowColor : undefined, shadowOpacity: glass ? design.semantic.elevation.shadowOpacity : 0, shadowRadius: glass ? design.semantic.elevation.shadowBlur : 0, shadowOffset: glass ? { width: 0, height: design.semantic.elevation.shadowOffsetY } : undefined, elevation: glass ? design.semantic.elevation.level2 : 0 }}>
        {props.children}
      </View>
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
