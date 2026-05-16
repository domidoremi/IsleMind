import type { ReactNode } from 'react'
import { Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { MotiView } from 'moti'
import { useAppTheme } from '@/hooks/useAppTheme'
import { typography } from '@/theme/typography'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { PressableScale } from '@/components/ui/PressableScale'
import { IslandPanel, type IslandMaterial } from '@/components/ui/IslandPanel'

export type IslandTone = 'default' | 'mint' | 'amber' | 'danger' | 'sky' | 'ink'
export type IslandSize = 'sm' | 'md' | 'lg'

export function IslandIconButton({
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
  tone?: IslandTone
  disabled?: boolean
  size?: IslandSize
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  const dimension = size === 'sm' ? 36 : size === 'lg' ? 50 : 42
  return (
    <PressableScale
      haptic
      disabled={disabled}
      onPress={onPress}
      accessibilityLabel={label}
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: toneBackground(tone, colors),
          borderWidth: tone === 'ink' ? 0 : 1,
          borderColor: colors.border,
          opacity: disabled ? 0.48 : 1,
        },
        style,
      ]}
    >
      {children}
    </PressableScale>
  )
}

export function IslandSection({
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
  material?: IslandMaterial
  elevated?: boolean
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  return (
    <IslandPanel material={material} elevated={elevated} radius={28} style={style} contentStyle={[{ padding: 14 }, contentStyle]}>
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
    </IslandPanel>
  )
}

export function IslandField({
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
      <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '900', marginBottom: 6 }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textTertiary}
        {...inputProps}
        style={[
          {
            minHeight: inputProps.multiline ? 84 : 46,
            maxHeight: inputProps.multiline ? 180 : undefined,
            borderRadius: 18,
            paddingHorizontal: 14,
            paddingVertical: inputProps.multiline ? 12 : 0,
            color: colors.text,
            backgroundColor: colors.material.field,
            borderWidth: 1,
            borderColor: colors.border,
            fontSize: 14,
            lineHeight: inputProps.multiline ? 20 : undefined,
            fontWeight: '700',
            textAlignVertical: inputProps.multiline ? 'top' : 'center',
          },
          inputProps.style,
        ]}
      />
      {note ? <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6 }}>{note}</Text> : null}
    </View>
  )
}

export function IslandToggle({
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
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
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
        <IslandSwitch active={active} />
      </View>
    </PressableScale>
  )
}

export function IslandSwitch({ active }: { active: boolean }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  return (
    <View
      style={{
        width: 46,
        height: 28,
        borderRadius: 14,
        padding: 3,
        backgroundColor: active ? colors.primary : colors.islandRaised,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <MotiView
        animate={{ translateX: active ? 18 : 0 }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: active ? colors.primaryForeground : colors.textTertiary }}
      />
    </View>
  )
}

export function IslandListItem({
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
            borderWidth: 1,
            borderColor: danger ? colors.error : colors.border,
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
          borderWidth: 1,
          borderColor: danger ? colors.error : colors.border,
        },
        style,
      ]}
    >
      {content}
    </View>
  )
}

export function IslandHeader({
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
    <IslandPanel material="chrome" elevated radius={30} contentStyle={{ padding: collapsed ? 6 : 8 }}>
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
    </IslandPanel>
  )
}

export function IslandSheet({
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
      <IslandPanel material="chrome" elevated radius={28} contentStyle={[{ padding: 12 }, contentStyle]}>
        {children}
      </IslandPanel>
    </MotiView>
  )
}

export function IslandDisclosure({
  title,
  summary,
  expanded,
  onPress,
  danger = false,
}: {
  title: string
  summary: string
  expanded: boolean
  onPress: () => void
  danger?: boolean
}) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel={`${expanded ? '折叠' : '展开'}${title}`}
      style={{
        minHeight: 54,
        borderRadius: 24,
        paddingHorizontal: 13,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: danger ? colors.coralWash : colors.material.paper,
        borderWidth: 1,
        borderColor: danger ? colors.error : colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? colors.error : colors.text, fontSize: 15, fontWeight: '900' }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2, fontWeight: '800' }}>{summary}</Text>
      </View>
      <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
        <ChevronDown color={danger ? colors.error : colors.textTertiary} size={19} />
      </MotiView>
    </PressableScale>
  )
}

function toneBackground(tone: IslandTone, colors: ReturnType<typeof useAppTheme>['colors']) {
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
