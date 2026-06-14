import type { ReactNode } from 'react'
import { Text, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { ChevronDown } from 'lucide-react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { useAppTheme } from '@/hooks/useAppTheme'
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
  const dimension = size === 'lg' ? 50 : 44
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
    <IslePanel material={material} elevated={elevated} radius={colors.ui.radius.panel} style={style} contentStyle={[{ padding: 14 }, contentStyle]}>
      {title || subtitle || action ? (
        <View style={{ flexDirection: 'row', alignItems: subtitle ? 'flex-start' : 'center', gap: 10, marginBottom: children ? 12 : 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {title ? <Text style={{ color: colors.text, fontSize: 16, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text> : null}
            {subtitle ? (
              <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: title ? 3 : 0, includeFontPadding: false }}>
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
      {note ? <Text style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 6, includeFontPadding: false }}>{note}</Text> : null}
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
  const motion = useMotionPreference()
  return (
    <PressableScale
      haptic
      onPress={onPress}
      style={{
        borderRadius: colors.ui.radius.panel,
      }}
      >
      <MotiView
        animate={{
          backgroundColor: active ? colors.ui.card.defaultBackground : colors.ui.card.mutedBackground,
          borderColor: active ? colors.ui.control.primaryBorder : colors.material.stroke,
          scale: active ? 1.006 : 1,
          translateY: active ? -1 : 0,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: 68,
          borderRadius: colors.ui.radius.panel,
          padding: 12,
          justifyContent: 'center',
          borderWidth: colors.ui.minimal ? 1 : 2,
          shadowColor: active ? colors.ui.control.shadow : colors.shadowTint,
          shadowOpacity: active && colors.ui.minimal ? colors.shadow.mediumOpacity : colors.ui.card.shadowOpacity,
          shadowRadius: colors.ui.card.shadowRadius,
          shadowOffset: { width: 0, height: colors.ui.card.shadowOffset },
          elevation: colors.ui.card.shadowOpacity > 0 ? 1 : 0,
        }}
      >
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {icon ? (
            <MotiView
              animate={{ backgroundColor: active ? colors.ui.control.primaryBackground : colors.ui.icon.accentBackground, scale: active ? 1.04 : 1, rotate: active || colors.ui.minimal ? '0deg' : '-2deg' }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
              style={{ width: 38, height: 38, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center' }}
            >
              {icon}
            </MotiView>
          ) : null}
          <View style={{ flex: 1, minWidth: 0, minHeight: description ? 40 : 44, justifyContent: 'center' }}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
            {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3, includeFontPadding: false, textAlignVertical: 'center' }}>{description}</Text> : null}
          </View>
          <View accessible={false} pointerEvents="none" style={{ height: 44, justifyContent: 'center' }}>
            <IsleSwitch active={active} />
          </View>
        </View>
      </MotiView>
    </PressableScale>
  )
}

export function IsleSwitch({ active, onChange }: { active: boolean; onChange?: () => void }) {
  const { colors } = useAppTheme()
  const motion = useMotionPreference()
  const switchTokens = colors.ui.switch
  if (onChange) return <IsleStyledSwitch checked={active} onChange={() => onChange()} />
  const width = 52
  const height = 28
  const borderWidth = colors.ui.minimal ? 1 : 2
  const thumbInset = 3
  const knob = height - thumbInset * 2
  const thumbTravel = width - knob - thumbInset * 2
  return (
    <MotiView
      accessible={false}
      style={{
        width,
        height,
        borderRadius: height / 2,
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
    >
      <MotiView
        animate={{
          backgroundColor: active ? switchTokens.trackOn : switchTokens.trackOff,
          borderColor: active ? switchTokens.trackOnBorder : switchTokens.trackOffBorder,
        }}
        transition={motion === 'full' ? { type: 'timing', duration: motionTokens.duration.fast } : { type: 'timing', duration: 1 }}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: height / 2, borderWidth }}
      />
      <MotiView
        animate={{ translateX: active ? thumbTravel : 0, scale: 1 }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{
          position: 'absolute',
          top: thumbInset,
          left: thumbInset,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: switchTokens.thumb,
          borderWidth: 1,
          borderColor: active ? switchTokens.thumbOnBorder : switchTokens.thumbOffBorder,
          shadowColor: 'transparent',
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        }}
      />
    </MotiView>
  )
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
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {leading}
      <View style={{ flex: 1, minWidth: 0, minHeight: description ? 40 : 44, justifyContent: 'center' }}>
        <Text numberOfLines={1} style={{ color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
        {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3, includeFontPadding: false, textAlignVertical: 'center' }}>{description}</Text> : null}
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
            borderRadius: colors.ui.radius.card,
            padding: 12,
            justifyContent: 'center',
            backgroundColor: danger ? colors.ui.tone.danger.background : colors.ui.card.defaultBackground,
            borderWidth: 2,
            borderColor: danger ? colors.ui.tone.danger.border : colors.material.stroke,
            shadowColor: danger ? colors.ui.tone.danger.foreground : colors.shadowTint,
            shadowOpacity: colors.ui.card.shadowOpacity,
            shadowRadius: colors.ui.card.shadowRadius,
            shadowOffset: { width: 0, height: colors.ui.card.shadowOffset },
            elevation: colors.ui.card.shadowOpacity > 0 ? 1 : 0,
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
          borderRadius: colors.ui.radius.card,
          padding: 12,
          justifyContent: 'center',
          backgroundColor: danger ? colors.ui.tone.danger.background : colors.ui.card.defaultBackground,
          borderWidth: 2,
          borderColor: danger ? colors.ui.tone.danger.border : colors.material.stroke,
          shadowColor: danger ? colors.ui.tone.danger.foreground : colors.shadowTint,
          shadowOpacity: colors.ui.card.shadowOpacity,
          shadowRadius: colors.ui.card.shadowRadius,
          shadowOffset: { width: 0, height: colors.ui.card.shadowOffset },
          elevation: colors.ui.card.shadowOpacity > 0 ? 1 : 0,
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
  material = 'chrome',
  elevated = true,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  trailing?: ReactNode
  collapsed?: boolean
  material?: IsleMaterial
  elevated?: boolean
}) {
  const { colors } = useAppTheme()
  return (
    <IslePanel material={material} elevated={elevated} radius={colors.ui.radius.panel} contentStyle={{ padding: collapsed ? 6 : 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {leading}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: collapsed ? 14 : 17, lineHeight: collapsed ? 18 : 22, fontWeight: '900', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>
            {title}
          </Text>
          {subtitle ? <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 2, includeFontPadding: false }}>{subtitle}</Text> : null}
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
  const { colors } = useAppTheme()
  const sheetMaterial = colors.material.sheet
  return (
    <MotiView
      from={motion === 'full' ? { opacity: 0, translateY: motionTokens.distance.sheet, scale: 0.985 } : { opacity: 0 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: motionTokens.duration.fast }}
      style={style}
    >
      <IslePanel
        material="chrome"
        elevated
        radius={colors.ui.radius.panel}
        style={{ backgroundColor: sheetMaterial.surface, borderColor: sheetMaterial.border }}
        contentStyle={[{ padding: 12, backgroundColor: sheetMaterial.body }, contentStyle]}
      >
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
        borderRadius: colors.ui.radius.panel,
      }}
    >
      <MotiView
        animate={{
          backgroundColor: danger ? colors.ui.tone.danger.background : expanded ? colors.ui.card.defaultBackground : colors.ui.card.mutedBackground,
          borderColor: danger ? colors.ui.tone.danger.border : expanded ? colors.ui.control.primaryBorder : colors.material.stroke,
          scale: expanded ? 1.005 : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: 54,
          borderRadius: colors.ui.radius.panel,
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderWidth: 2,
          borderStyle: danger || colors.ui.minimal ? 'solid' : 'dashed',
        }}
      >
      <View style={{ minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MotiView
          animate={{ backgroundColor: danger ? colors.ui.tone.danger.foreground : colors.ui.control.primaryBackground, scale: expanded ? 1.04 : 1 }}
          transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
          style={{ width: 28, height: 28, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: danger ? colors.ui.control.dangerForeground : colors.ui.control.primaryForeground, fontSize: 17, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{expanded ? '-' : '+'}</Text>
        </MotiView>
        <View style={{ flex: 1, minWidth: 0, minHeight: summary && !expanded ? 32 : 28, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
          {summary && !expanded ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{summary}</Text> : null}
        </View>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg', scale: expanded ? 1.08 : 1 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <ChevronDown color={danger ? colors.ui.tone.danger.foreground : colors.textTertiary} size={19} />
        </MotiView>
      </View>
      <AnimatePresence>
        {expanded && summary ? (
          <MotiView
            key="isle-disclosure-summary"
            from={motion === 'full' ? { opacity: 0, translateY: 6, scale: 0.985 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4, scale: 0.985 } : { opacity: 0 }}
            transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
          >
            <Text style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 8, includeFontPadding: false, textAlignVertical: 'center' }}>{summary}</Text>
          </MotiView>
        ) : null}
      </AnimatePresence>
      </MotiView>
    </PressableScale>
  )
}

function toneBackground(tone: IsleTone, colors: ReturnType<typeof useAppTheme>['colors']) {
  switch (tone) {
    case 'mint':
      return colors.ui.tone.success.background
    case 'amber':
      return colors.ui.tone.warning.background
    case 'danger':
      return colors.ui.tone.danger.background
    case 'sky':
      return colors.ui.tone.info.background
    case 'ink':
      return colors.ui.tone.ink.background
    case 'default':
    default:
      return colors.ui.tone.neutral.background
  }
}
