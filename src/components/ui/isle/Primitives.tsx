import type { ReactNode } from 'react'
import { Text, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
import { typography } from '@/theme/typography'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslePanel, type IsleMaterial } from './Panel'
import { IsleButton, IsleInput, IsleSwitch as IsleStyledSwitch } from './IsleKit'

export type IsleTone = 'default' | 'mint' | 'amber' | 'danger' | 'sky' | 'ink'
export type IsleSize = 'sm' | 'md' | 'lg'

export function IsleIconButton({
  label,
  children,
  onPress,
  tone = 'default',
  disabled = false,
  size = 'md',
  style,
}: {
  label: string
  children: ReactNode
  onPress?: () => void
  tone?: IsleTone
  disabled?: boolean
  size?: IsleSize
  style?: StyleProp<ViewStyle>
}) {
  const dimension = size === 'sm' ? 36 : size === 'lg' ? 50 : 42
  return (
    <IsleButton
      type={tone === 'ink' || tone === 'mint' || tone === 'amber' ? 'primary' : 'default'}
      danger={tone === 'danger'}
      disabled={disabled}
      onPress={onPress}
      label={label}
      icon={children}
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          minHeight: dimension,
          paddingHorizontal: 0,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
      textStyle={{ display: 'none' }}
    />
  )
}

export function IsleSection({
  title,
  subtitle,
  children,
  action,
  material = 'paper',
  elevated = false,
  style,
  contentStyle,
}: {
  title?: string
  subtitle?: string
  children: ReactNode
  action?: ReactNode
  material?: IsleMaterial
  elevated?: boolean
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  return (
    <IslePanel material={material} elevated={elevated} radius={28} style={style} contentStyle={[{ padding: 14 }, contentStyle]}>
      {title || subtitle || action ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: children ? 12 : 0 }}>
          <View style={{ flex: 1 }}>
            {title ? <Text style={{ color: colors.text, fontSize: 16, fontWeight: '900' }}>{title}</Text> : null}
            {subtitle ? (
              <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: title ? 3 : 0 }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      ) : null}
      {children}
    </IslePanel>
  )
}

export function IsleField({
  label,
  note,
  inputProps,
  style,
}: {
  label: string
  note?: string
  inputProps: TextInputProps
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  return (
    <View style={style}>
      <IsleInput
        label={label}
        {...inputProps}
        size="middle"
        inputStyle={inputProps.style}
      />
      {note ? <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>{note}</Text> : null}
    </View>
  )
}

export function IsleToggle({
  title,
  description,
  active,
  icon,
  onPress,
}: {
  title: string
  description?: string
  active: boolean
  icon?: ReactNode
  onPress: () => void
}) {
  const { colors } = useAppTheme()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      style={{
        minHeight: 68,
        borderRadius: 26,
        padding: 12,
        backgroundColor: colors.material.paper,
        borderWidth: 2,
        borderColor: active ? colors.primary : colors.border,
        shadowColor: active ? colors.primary : colors.shadowTint,
        shadowOpacity: active ? 0.24 : 0.14,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 4 },
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {icon ? (
          <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? colors.mintSoft : colors.islandRaised }}>
            {icon}
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '900' }}>{title}</Text>
          {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 }}>{description}</Text> : null}
        </View>
        <IsleSwitch active={active} onChange={onPress} />
      </View>
    </PressableScale>
  )
}

export function IsleSwitch({ active, onChange }: { active: boolean; onChange?: () => void }) {
  return <IsleStyledSwitch checked={active} onChange={onChange ? () => onChange() : undefined} />
}

export function IsleListItem({
  title,
  description,
  leading,
  trailing,
  onPress,
  danger = false,
  style,
}: {
  title: string
  description?: string
  leading?: ReactNode
  trailing?: ReactNode
  onPress?: () => void
  danger?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {leading}
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: danger ? colors.error : colors.text, fontSize: 15, fontWeight: '900' }}>{title}</Text>
        {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 }}>{description}</Text> : null}
      </View>
      {trailing}
    </View>
  )

  if (onPress) {
    return (
      <PressableScale
        haptic
        onPress={onPress}
        style={[
          {
            minHeight: 58,
            borderRadius: 22,
            padding: 12,
            backgroundColor: danger ? colors.coralWash : colors.material.paperRaised,
            borderWidth: 2,
            borderColor: danger ? colors.error : colors.border,
            shadowColor: danger ? colors.error : colors.shadowTint,
            shadowOpacity: 0.16,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 3 },
            elevation: 2,
          },
          style,
        ]}
      >
        {content}
      </PressableScale>
    )
  }

  return (
    <View
      style={[
        {
          minHeight: 58,
          borderRadius: 22,
          padding: 12,
          backgroundColor: danger ? colors.coralWash : colors.material.paperRaised,
          borderWidth: 2,
          borderColor: danger ? colors.error : colors.border,
          shadowColor: danger ? colors.error : colors.shadowTint,
          shadowOpacity: 0.12,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 3 },
          elevation: 2,
        },
        style,
      ]}
    >
      {content}
    </View>
  )
}

export function IsleHeader({
  title,
  subtitle,
  leading,
  trailing,
  collapsed = false,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  trailing?: ReactNode
  collapsed?: boolean
}) {
  const { colors } = useAppTheme()
  return (
    <IslePanel material="chrome" elevated radius={30} contentStyle={{ padding: collapsed ? 6 : 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {leading}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: collapsed ? 14 : 17, fontWeight: '900', letterSpacing: typography.tracking.tight }}>
            {title}
          </Text>
          {subtitle ? <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '800', marginTop: 2 }}>{subtitle}</Text> : null}
        </View>
        {trailing}
      </View>
    </IslePanel>
  )
}

export function IsleSheet({
  children,
  style,
  contentStyle,
}: {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}) {
  const motion = useMotionPreference()
  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: motionTokens.distance.sheet, scale: 0.985 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
      style={style}
    >
      <IslePanel material="chrome" elevated radius={28} contentStyle={[{ padding: 12 }, contentStyle]}>
        {children}
      </IslePanel>
    </MotiView>
  )
}

export function IsleDisclosure({
  title,
  summary,
  expanded,
  onPress,
  danger = false,
}: {
  title: string
  summary?: string
  expanded: boolean
  onPress: () => void
  danger?: boolean
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const { t } = useTranslation()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel={`${expanded ? t('common.collapse') : t('common.expand')}${title}`}
      style={{
        minHeight: 54,
        borderRadius: 24,
        paddingHorizontal: 13,
        paddingVertical: 10,
        backgroundColor: danger ? colors.coralWash : colors.material.paper,
        borderWidth: 2,
        borderStyle: danger ? 'solid' : 'dashed',
        borderColor: danger ? colors.error : colors.border,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? colors.error : colors.primary }}>
          <Text style={{ color: colors.primaryForeground, fontSize: 17, fontWeight: '900' }}>{expanded ? '-' : '+'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: danger ? colors.error : colors.text, fontSize: 15, fontWeight: '900' }}>{title}</Text>
          {summary && !expanded ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2, fontWeight: '800' }}>{summary}</Text> : null}
        </View>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <ChevronDown color={danger ? colors.error : colors.textTertiary} size={19} />
        </MotiView>
      </View>
      {expanded && summary ? (
        <MotiView
          from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        >
          <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 8 }}>{summary}</Text>
        </MotiView>
      ) : null}
    </PressableScale>
  )
}

function toneBackground(tone: IsleTone, colors: ReturnType<typeof useAppTheme>['colors']) {
  switch (tone) {
    case 'mint':
      return colors.mintSoft
    case 'amber':
      return colors.amberSoft
    case 'danger':
      return colors.coralWash
    case 'sky':
      return colors.skySoft
    case 'ink':
      return colors.text
    case 'default':
    default:
      return colors.islandRaised
  }
}
