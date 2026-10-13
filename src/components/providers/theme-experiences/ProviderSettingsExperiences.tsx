import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'

export interface ProviderSettingsExperienceProps {
  title: string
  subtitle: string
  backLabel: string
  addLabel: string
  compact: boolean
  onBack: () => void
  onAdd: () => void
  attention?: ReactNode
  activation?: ReactNode
  tools?: ReactNode
  children: ReactNode
}

function ProviderSettingsExperience({ family, props }: { family: string; props: ProviderSettingsExperienceProps }) {
  const { colors } = useAppTheme()
  const glass = family === 'liquid-glass'
  const radius = colors.design?.semantic.radius.extraLarge ?? colors.ui.radius.panel
  return <View testID={`provider-settings-experience-${family}`} style={{ width: '100%', maxWidth: 860, alignSelf: 'center', gap: 18 }}>
    <GlassSurface colors={colors} enabled={glass} style={{ borderRadius: glass ? radius : 0, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 78, paddingVertical: 12 }}>
      <IslePressable accessibilityRole="button" accessibilityLabel={props.backLabel} onPress={props.onBack}
        style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, borderRadius: 14, backgroundColor: colors.ui.semantic.surface.muted, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name="back-previous" color={colors.text} size={20} />
      </IslePressable>
      <Text accessibilityRole="header" style={{ flex: 1, minWidth: 0, color: colors.text, fontSize: 22, lineHeight: 30, fontWeight: '700' }}>{props.title}</Text>
      <IslePressable testID="provider-add" accessibilityRole="button" accessibilityLabel={props.addLabel} onPress={props.onAdd}
        style={{ minWidth: ISLE_MIN_TOUCH_TARGET, minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.ui.control.primaryBackground, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <AppIcon name="add" color={colors.ui.control.primaryForeground} size={20} />
        {!props.compact ? <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '600' }}>{props.addLabel}</Text> : null}
      </IslePressable>
    </GlassSurface>
    {!props.compact && props.subtitle ? <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{props.subtitle}</Text> : null}
    {props.attention}
    {props.activation}
    {props.tools}
    <GlassSurface colors={colors} enabled={glass} style={{ borderRadius: glass ? radius : 18, padding: 4, backgroundColor: colors.ui.semantic.surface.raised }}>{props.children}</GlassSurface>
  </View>
}

export function MinimalProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <ProviderSettingsExperience family="minimal" props={props} />
}
export function MonetProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <ProviderSettingsExperience family="monet" props={props} />
}
export function MaterialProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <ProviderSettingsExperience family="material" props={props} />
}
export function LiquidGlassProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  return <ProviderSettingsExperience family="liquid-glass" props={props} />
}
