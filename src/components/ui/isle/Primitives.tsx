import type { ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
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
  material,
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
  const resolvedMaterial = material ?? (colors.ui.minimal ? 'transparent' : colors.ui.glass ? 'chrome' : 'paper')
  const sectionPadding = colors.ui.cartoon ? 14 : 12
  return (
    <IslePanel material={resolvedMaterial} elevated={elevated} radius={colors.ui.radius.panel} style={style} contentStyle={[{ padding: sectionPadding }, contentStyle]}>
      {title || subtitle || action ? (
        <View style={{ flexDirection: 'row', alignItems: subtitle ? 'flex-start' : 'center', gap: 10, marginBottom: children ? (colors.ui.cartoon ? 12 : 10) : 0 }}>
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
  const playful = colors.ui.cartoon
  const toggleSurface = active
    ? colors.ui.glass
      ? colors.ui.semantic.chrome.background
      : colors.ui.semantic.surface.base
    : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.semantic.surface.muted
  const toggleBorder = active
    ? colors.ui.control.primaryBorder
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
    : playful
      ? colors.material.stroke
      : colors.ui.semantic.chrome.border
  const toggleShadowOpacity = active
    ? playful
      ? colors.ui.card.shadowOpacity
      : 0
    : 0
  const iconBackground = active
    ? colors.ui.control.primaryBackground
    : colors.ui.glass
      ? colors.ui.actionBar.itemActiveBackground
      : colors.ui.icon.accentBackground
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
          backgroundColor: toggleSurface,
          borderColor: toggleBorder,
          scale: active ? (colors.ui.glass ? 1.002 : 1.003) : 1,
          translateY: active && playful ? -0.5 : 0,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.settle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: 64,
          borderRadius: colors.ui.radius.panel,
          padding: 11,
          justifyContent: 'center',
          borderWidth: playful ? 1 : StyleSheet.hairlineWidth,
          shadowColor: active ? colors.ui.control.shadow : colors.shadowTint,
          shadowOpacity: toggleShadowOpacity,
          shadowRadius: playful ? colors.ui.card.shadowRadius : 0,
          shadowOffset: { width: 0, height: playful ? colors.ui.card.shadowOffset : 0 },
          elevation: playful && colors.ui.card.shadowOpacity > 0 ? 1 : 0,
        }}
      >
        <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {icon ? (
            <MotiView
              animate={{ backgroundColor: iconBackground, scale: active ? 1.03 : 1, rotate: active || !playful ? '0deg' : '-1deg' }}
              transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
              style={{ width: 36, height: 36, borderRadius: colors.ui.radius.controlLarge, alignItems: 'center', justifyContent: 'center' }}
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
  const borderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
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
          borderWidth: StyleSheet.hairlineWidth,
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
  const borderWidth = colors.ui.cartoon ? 1 : StyleSheet.hairlineWidth
  const itemBackground = danger
    ? colors.ui.tone.danger.background
    : colors.ui.cartoon
      ? colors.ui.semantic.surface.base
      : colors.ui.glass
        ? colors.ui.actionBar.itemBackground
        : colors.ui.semantic.surface.muted
  const itemBorderColor = danger
    ? colors.ui.tone.danger.border
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const itemShadowOpacity = colors.ui.cartoon ? Math.min(colors.ui.card.shadowOpacity, 0.04) : 0
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
            minHeight: 56,
            borderRadius: colors.ui.radius.card,
            padding: 11,
            justifyContent: 'center',
            backgroundColor: itemBackground,
            borderWidth,
            borderColor: itemBorderColor,
            shadowColor: danger ? colors.ui.tone.danger.foreground : colors.shadowTint,
            shadowOpacity: itemShadowOpacity,
            shadowRadius: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowRadius - 6) : 0,
            shadowOffset: { width: 0, height: colors.ui.cartoon ? Math.max(1, colors.ui.card.shadowOffset - 3) : 0 },
            elevation: colors.ui.cartoon && itemShadowOpacity > 0 ? 1 : 0,
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
          minHeight: 56,
          borderRadius: colors.ui.radius.card,
          padding: 11,
          justifyContent: 'center',
          backgroundColor: itemBackground,
          borderWidth,
          borderColor: itemBorderColor,
          shadowColor: danger ? colors.ui.tone.danger.foreground : colors.shadowTint,
          shadowOpacity: itemShadowOpacity,
          shadowRadius: colors.ui.cartoon ? colors.ui.card.shadowRadius : 0,
          shadowOffset: { width: 0, height: colors.ui.cartoon ? colors.ui.card.shadowOffset : 0 },
          elevation: colors.ui.cartoon && itemShadowOpacity > 0 ? 1 : 0,
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
  const playful = colors.ui.cartoon
  const collapsedBackground = danger
    ? colors.ui.tone.danger.background
    : colors.ui.glass
      ? colors.ui.actionBar.itemBackground
      : colors.ui.semantic.surface.muted
  const expandedBackground = danger
    ? colors.ui.tone.danger.background
    : colors.ui.glass
      ? colors.ui.semantic.chrome.background
      : colors.ui.semantic.surface.base
  const collapsedBorderColor = danger
    ? colors.ui.tone.danger.border
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const disclosureGlyphBackground = danger
    ? colors.ui.tone.danger.foreground
    : expanded
      ? colors.ui.control.primaryBackground
      : colors.ui.glass
        ? colors.ui.actionBar.itemActiveBackground
        : colors.ui.icon.accentBackground
  const disclosureGlyphColor = danger
    ? colors.ui.control.dangerForeground
    : expanded
      ? colors.ui.control.primaryForeground
      : colors.textSecondary
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
          backgroundColor: expanded ? expandedBackground : collapsedBackground,
          borderColor: danger ? colors.ui.tone.danger.border : expanded ? colors.ui.control.primaryBorder : collapsedBorderColor,
          scale: expanded ? (colors.ui.glass ? 1.001 : 1.002) : 1,
        }}
        transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
        style={{
          minHeight: 54,
          borderRadius: colors.ui.radius.panel,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderWidth: playful ? 1 : StyleSheet.hairlineWidth,
          borderStyle: danger || !playful ? 'solid' : 'dashed',
        }}
      >
      <View style={{ minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <MotiView
          animate={{ backgroundColor: disclosureGlyphBackground, scale: expanded ? 1.03 : 1 }}
          transition={motion === 'full' ? { type: 'spring', ...motionTokens.spring.gentle } : { type: 'timing', duration: 1 }}
          style={{ width: 28, height: 28, borderRadius: colors.ui.radius.controlSmall, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: disclosureGlyphColor, fontSize: 17, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{expanded ? '-' : '+'}</Text>
        </MotiView>
        <View style={{ flex: 1, minWidth: 0, minHeight: summary && !expanded ? 32 : 28, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 15, lineHeight: 21, fontWeight: '900', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
          {summary && !expanded ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '800', includeFontPadding: false, textAlignVertical: 'center' }}>{summary}</Text> : null}
        </View>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg', scale: expanded ? 1.08 : 1 }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <AppIcon name="collapse" color={danger ? colors.ui.tone.danger.foreground : colors.textTertiary} size={19} />
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
