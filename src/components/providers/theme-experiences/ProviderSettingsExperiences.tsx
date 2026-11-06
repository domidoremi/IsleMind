import type { ReactNode } from 'react'
import { View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { ISLE_MIN_TOUCH_TARGET, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { GlassSurface } from '@/components/ui/isle/GlassSurface'
import { PageFeedbackIndicator } from '@/components/ui/PageFeedback'
import { WorkspaceHeader } from '@/presentation/layout/WorkspaceHeader'

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
  const open = family === 'minimal' || family === 'monet' || family === 'material'
  const radius = colors.design?.semantic.radius.extraLarge ?? colors.ui.radius.panel
  return <View testID={`provider-settings-experience-${family}`} style={{ width: '100%', maxWidth: 860, alignSelf: 'center', gap: 18 }}>
    <WorkspaceHeader title={props.title} subtitle={props.subtitle} compact={props.compact} leading={
      <IslePressable accessibilityRole="button" accessibilityLabel={props.backLabel} onPress={props.onBack}
        style={{ width: ISLE_MIN_TOUCH_TARGET, height: ISLE_MIN_TOUCH_TARGET, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name="back-previous" color={colors.text} size={20} />
      </IslePressable>
    } trailing={<>
      <PageFeedbackIndicator />
      <IslePressable testID="provider-add" accessibilityRole="button" accessibilityLabel={props.addLabel} onPress={props.onAdd}
        style={{ minWidth: ISLE_MIN_TOUCH_TARGET, minHeight: ISLE_MIN_TOUCH_TARGET, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.ui.control.primaryBackground, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <AppIcon name="add" color={colors.ui.control.primaryForeground} size={20} />
        {!props.compact ? <Text style={{ color: colors.ui.control.primaryForeground, fontSize: 14, fontWeight: '600' }}>{props.addLabel}</Text> : null}
      </IslePressable>
    </>} />
    {props.attention}
    {props.activation}
    {props.tools}
    <GlassSurface colors={colors} enabled={false} style={{ borderRadius: open ? 0 : glass ? radius : 18, padding: open ? 0 : 4,
      borderTopWidth: open ? 1 : 0, borderTopColor: colors.ui.section.divider,
      backgroundColor: open ? 'transparent' : colors.ui.semantic.surface.raised }}>{props.children}</GlassSurface>
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

export function CanonicalProviderSettingsExperience(props: ProviderSettingsExperienceProps) {
  const { canonicalThemeId } = useAppTheme()
  return <ProviderSettingsExperience family={canonicalThemeId} props={props} />
}
