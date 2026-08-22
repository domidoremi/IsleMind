import type { ReactNode } from 'react'
import { Platform, StyleSheet, Text, View, useWindowDimensions, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { AnimatePresence, MotiView } from 'moti'
import { useTranslation } from 'react-i18next'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useMotionPreference } from '@/hooks/useMotionPreference'
import { motionTokens } from '@/theme/animation'
import { resolveThemeComponentExpression, resolveThemeExpression } from '@/theme/themeExpression'
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
  const { colors, canonicalThemeId } = useAppTheme()
  const iconButtonExpression = resolveThemeComponentExpression(canonicalThemeId, 'iconButton')
  const dimension = size === 'lg' ? 50 : 44
  const radius = iconButtonExpression.shape === 'angular'
    ? 2
    : iconButtonExpression.shape === 'soft'
      ? Math.round(dimension * 0.38)
      : dimension / 2
  const defaultSurface = iconButtonExpression.surface === 'boundary'
    ? 'transparent'
    : iconButtonExpression.surface === 'atmosphere'
      ? colors.ui.semantic.surface.base
      : iconButtonExpression.surface === 'tonal'
        ? colors.ui.semantic.surface.muted
        : colors.ui.semantic.chrome.background
  const defaultBorder = iconButtonExpression.surface === 'atmosphere'
    ? colors.ui.control.focus
    : iconButtonExpression.surface === 'lens'
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const borderWidth = iconButtonExpression.border === 'none'
    ? 0
    : iconButtonExpression.border === 'outline' || iconButtonExpression.border === 'edge-highlight'
      ? 1
      : StyleSheet.hairlineWidth
  const elevated = iconButtonExpression.elevation !== 'none'
  const webLensStyle = tone === 'default' && iconButtonExpression.surface === 'lens' && Platform.OS === 'web'
    ? ({ backdropFilter: 'blur(12px) saturate(1.08)', WebkitBackdropFilter: 'blur(12px) saturate(1.08)' } as unknown as ViewStyle)
    : undefined
  return (
    <IsleButton
      type={tone === 'ink' || tone === 'mint' || tone === 'amber' ? 'primary' : 'default'}
      danger={tone === 'danger'}
      disabled={disabled}
      onPress={onPress}
      label={label}
      icon={children}
      testID={`theme-icon-button-${canonicalThemeId}-${size}`}
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: radius,
          minHeight: dimension,
          paddingHorizontal: 0,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: tone === 'default'
            ? disabled
              ? colors.ui.control.disabledBackground
              : defaultSurface
            : undefined,
          borderWidth: tone === 'default' ? borderWidth : undefined,
          borderColor: tone === 'default'
            ? disabled
              ? colors.ui.control.disabledBorder
              : defaultBorder
            : undefined,
          shadowColor: colors.shadowTint,
          shadowOpacity: tone === 'default' && elevated ? (iconButtonExpression.elevation === 'layered' ? 0.14 : 0.07) : 0,
          shadowRadius: iconButtonExpression.elevation === 'layered' ? 12 : elevated ? 7 : 0,
          shadowOffset: { width: 0, height: elevated ? 3 : 0 },
          elevation: tone === 'default' && elevated ? (iconButtonExpression.elevation === 'layered' ? 2 : 1) : 0,
        },
        webLensStyle,
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
  const resolvedMaterial = material ?? 'transparent'
  const sectionPadding = resolvedMaterial === 'transparent' ? 0 : 10
  return (
    <IslePanel material={resolvedMaterial} elevated={elevated} radius={Math.min(colors.ui.radius.panel, 8)} style={style} contentStyle={[{ padding: sectionPadding }, contentStyle]}>
      {title || subtitle || action ? (
        <View style={{ flexDirection: 'row', alignItems: subtitle ? 'flex-start' : 'center', gap: 10, marginBottom: children ? 10 : 0 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {title ? <Text style={{ color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text> : null}
            {subtitle ? (
              <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: title ? 3 : 0, fontWeight: '500', includeFontPadding: false }}>
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
  const playful = colors.ui.limeRoad && colors.ui.ornamented
  const toggleSurface = active
    ? colors.ui.glass
      ? colors.ui.semantic.chrome.background
      : colors.ui.semantic.surface.muted
    : colors.ui.glass || playful
      ? colors.ui.actionBar.itemBackground
      : 'transparent'
  const toggleBorder = active
    ? colors.ui.control.primaryBorder
    : colors.ui.glass || playful
      ? colors.ui.actionBar.itemBorder
      : 'transparent'
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
      accessibilityRole="switch"
      accessibilityLabel={description ? `${title}. ${description}` : title}
      accessibilityState={{ checked: active }}
      style={{
        borderRadius: Math.min(colors.ui.radius.panel, 8),
      }}
      >
      <MotiView
        animate={{
          backgroundColor: toggleSurface,
          borderColor: toggleBorder,
          translateY: 0,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          minHeight: 56,
          borderRadius: Math.min(colors.ui.radius.panel, 8),
          paddingHorizontal: 10,
          paddingVertical: 8,
          justifyContent: 'center',
          borderWidth: playful ? 1 : StyleSheet.hairlineWidth,
          shadowColor: active ? colors.ui.control.shadow : colors.shadowTint,
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        }}
      >
        <View style={{ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {icon ? (
            <MotiView
              animate={{ backgroundColor: iconBackground, rotate: '0deg' }}
              transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
              style={{ width: 32, height: 32, borderRadius: Math.min(colors.ui.radius.controlLarge, 8), alignItems: 'center', justifyContent: 'center' }}
            >
              {icon}
            </MotiView>
          ) : null}
          <View style={{ flex: 1, minWidth: 0, minHeight: description ? 38 : 40, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
            {description ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3, fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' }}>{description}</Text> : null}
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
  const borderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
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
        animate={{ translateX: active ? thumbTravel : 0 }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
  const { width } = useWindowDimensions()
  const compact = width < 430
  const stackTrailing = compact && !!trailing
  const borderWidth = colors.ui.limeRoad ? 1 : StyleSheet.hairlineWidth
  const itemBackground = danger
    ? colors.ui.tone.danger.background
    : colors.ui.limeRoad
      ? colors.ui.semantic.surface.base
      : colors.ui.glass
        ? colors.ui.actionBar.itemBackground
        : colors.ui.semantic.surface.base
  const itemBorderColor = danger
    ? colors.ui.tone.danger.border
    : colors.ui.glass
      ? colors.ui.actionBar.itemBorder
      : colors.ui.semantic.chrome.border
  const itemShadowOpacity = 0
  const content = (
    <View style={{ minHeight: 44, flexDirection: stackTrailing ? 'column' : 'row', alignItems: stackTrailing ? 'stretch' : 'center', gap: stackTrailing ? 10 : 12 }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, flex: stackTrailing ? undefined : 1, minWidth: 0 }}>
        {leading ? <View style={{ flexShrink: 0, maxWidth: compact ? '42%' : undefined }}>{leading}</View> : null}
        <View style={{ flex: 1, minWidth: 0, minHeight: description ? 40 : 44, justifyContent: 'center' }}>
        <Text numberOfLines={1} style={{ color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
          {description ? <Text numberOfLines={compact ? 3 : 2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3, fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' }}>{description}</Text> : null}
        </View>
      </View>
      {trailing ? (
        <View style={stackTrailing ? { alignSelf: 'stretch', minWidth: 0 } : { flexShrink: 0 }}>
          {trailing}
        </View>
      ) : null}
    </View>
  )

  if (onPress) {
    return (
      <PressableScale
        haptic
        onPress={onPress}
        accessibilityLabel={description ? `${title}. ${description}` : title}
        style={[
          {
            minHeight: 52,
            borderRadius: Math.min(colors.ui.radius.card, 8),
            padding: 10,
            justifyContent: 'center',
            backgroundColor: itemBackground,
            borderWidth,
            borderColor: itemBorderColor,
            shadowColor: danger ? colors.ui.tone.danger.foreground : colors.shadowTint,
            shadowOpacity: itemShadowOpacity,
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 0 },
            elevation: 0,
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
          minHeight: 52,
          borderRadius: Math.min(colors.ui.radius.card, 8),
          padding: 10,
          justifyContent: 'center',
          backgroundColor: itemBackground,
          borderWidth,
          borderColor: itemBorderColor,
          shadowColor: danger ? colors.ui.tone.danger.foreground : colors.shadowTint,
          shadowOpacity: itemShadowOpacity,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
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
  material = 'transparent',
  elevated = false,
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
    <IslePanel material={material} elevated={elevated} radius={colors.ui.radius.panel} contentStyle={{ paddingHorizontal: 2, paddingVertical: collapsed ? 6 : 8 }}>
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {leading}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: colors.text, fontSize: collapsed ? 17 : 20, lineHeight: collapsed ? 22 : 26, fontWeight: '700', letterSpacing: 0, includeFontPadding: false, textAlignVertical: 'center' }}>
            {title}
          </Text>
          {subtitle ? <Text numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: '500', marginTop: 2, includeFontPadding: false }}>{subtitle}</Text> : null}
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
  const { colors, canonicalThemeId } = useAppTheme()
  const sheetMaterial = colors.material.sheet
  const sheetExpression = resolveThemeComponentExpression(canonicalThemeId, 'bottomSheet')
  const themeExpression = resolveThemeExpression(canonicalThemeId)
  const fullMotion = motion === 'full'
  const enterFrame = sheetExpression.motion === 'organic'
    ? { opacity: 0, translateY: 18, scale: 0.99 }
    : sheetExpression.motion === 'material'
      ? { opacity: 0, translateY: 24, scale: 0.98 }
      : sheetExpression.motion === 'fluid'
        ? { opacity: 0, translateY: 18, scale: 0.96 }
        : { opacity: 0, translateY: 5, scale: 1 }
  const panelRadius = sheetExpression.shape === 'capsule'
    ? colors.ui.radius.panel
    : sheetExpression.shape === 'material'
      ? Math.min(colors.ui.radius.panel, 28)
      : sheetExpression.shape === 'soft'
        ? Math.min(colors.ui.radius.panel, 22)
        : Math.min(colors.ui.radius.panel, 6)
  const panelMaterial: IsleMaterial = sheetExpression.surface === 'lens'
    ? 'glass'
    : sheetExpression.surface === 'tonal'
      ? 'raised'
      : 'chrome'
  const panelBackground = sheetExpression.surface === 'lens'
    ? colors.ui.semantic.surface.overlay
    : sheetExpression.surface === 'tonal'
      ? colors.ui.semantic.surface.raised
      : sheetExpression.surface === 'atmosphere'
        ? colors.ui.semantic.surface.base
        : colors.ui.semantic.chrome.background
  return (
    <MotiView
      testID={`theme-bottom-sheet-${canonicalThemeId}`}
      from={fullMotion ? enterFrame : { opacity: 0, translateY: 0, scale: 1 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      transition={{
        type: 'timing',
        duration: fullMotion ? themeExpression.motion.duration.panel : motion === 'reduced' ? 120 : 1,
      }}
      style={style}
    >
      <IslePanel
        material={panelMaterial}
        blur={sheetExpression.surface === 'lens'}
        elevated
        radius={panelRadius}
        style={{
          backgroundColor: panelBackground,
          borderColor: sheetExpression.border === 'edge-highlight' ? colors.ui.control.focus : sheetMaterial.border,
          borderTopWidth: sheetExpression.border === 'divider' ? 1 : StyleSheet.hairlineWidth,
        }}
        contentStyle={[{ padding: 12, backgroundColor: sheetExpression.surface === 'lens' ? 'transparent' : sheetMaterial.body }, contentStyle]}
      >
        {sheetExpression.motion === 'precision' ? (
          <View pointerEvents="none" style={{ height: 1, marginHorizontal: -12, marginTop: -12, marginBottom: 10, backgroundColor: colors.ui.semantic.chrome.border }} />
        ) : sheetExpression.motion === 'organic' ? (
          <View pointerEvents="none" style={{ alignSelf: 'center', width: 78, height: 4, marginTop: -7, marginBottom: 10, borderRadius: 4, backgroundColor: colors.ui.control.focus, opacity: 0.24 }} />
        ) : sheetExpression.motion === 'material' ? (
          <View pointerEvents="none" style={{ alignSelf: 'center', width: 32, height: 4, marginTop: -4, marginBottom: 10, borderRadius: 4, backgroundColor: colors.textTertiary, opacity: 0.48 }} />
        ) : (
          <View pointerEvents="none" style={{ alignSelf: 'center', width: 96, height: 1, marginTop: -8, marginBottom: 10, borderRadius: 1, backgroundColor: colors.ui.semantic.content.inverse, opacity: 0.62 }} />
        )}
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
  const playful = colors.ui.limeRoad && colors.ui.ornamented
  const collapsedBackground = danger
    ? colors.ui.tone.danger.background
    : colors.ui.glass || playful
      ? colors.ui.actionBar.itemBackground
      : 'transparent'
  const expandedBackground = danger
    ? colors.ui.tone.danger.background
    : colors.ui.glass
      ? colors.ui.semantic.chrome.background
      : colors.ui.semantic.surface.muted
  const collapsedBorderColor = danger
    ? colors.ui.tone.danger.border
    : colors.ui.glass || playful
      ? colors.ui.actionBar.itemBorder
      : 'transparent'
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityLabel={`${expanded ? t('common.collapse') : t('common.expand')}${title}`}
      accessibilityState={{ expanded }}
      style={{
        borderRadius: Math.min(colors.ui.radius.panel, 8),
      }}
    >
      <MotiView
        animate={{
          backgroundColor: expanded ? expandedBackground : collapsedBackground,
          borderColor: danger ? colors.ui.tone.danger.border : expanded ? colors.ui.control.primaryBorder : collapsedBorderColor,
        }}
        transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
        style={{
          minHeight: 48,
          borderRadius: Math.min(colors.ui.radius.panel, 8),
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderWidth: playful ? 1 : StyleSheet.hairlineWidth,
          borderStyle: danger || !playful ? 'solid' : 'dashed',
        }}
      >
      <View style={{ minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, minHeight: summary && !expanded ? 32 : 28, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: danger ? colors.ui.tone.danger.foreground : colors.text, fontSize: 15, lineHeight: 21, fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center' }}>{title}</Text>
          {summary && !expanded ? <Text numberOfLines={1} style={{ color: colors.textTertiary, fontSize: 11, lineHeight: 15, marginTop: 2, fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' }}>{summary}</Text> : null}
        </View>
        <MotiView animate={{ rotate: expanded ? '180deg' : '0deg' }} transition={{ type: 'timing', duration: motion === 'full' ? 180 : 1 }}>
          <AppIcon name="collapse" color={danger ? colors.ui.tone.danger.foreground : colors.textTertiary} size={19} />
        </MotiView>
      </View>
      <AnimatePresence>
        {expanded && summary ? (
          <MotiView
            key="isle-disclosure-summary"
            from={motion === 'full' ? { opacity: 0, translateY: 6 } : { opacity: 0 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={motion === 'full' ? { opacity: 0, translateY: -4 } : { opacity: 0 }}
            transition={{ type: 'timing', duration: motion === 'full' ? motionTokens.duration.fast : 1 }}
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
