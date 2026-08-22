import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { AppIcon, appIconStroke } from '@/components/ui/AppIcon'
import type { useAppTheme } from '@/hooks/useAppTheme'
import type { ThemeComponentExpression } from '@/theme/themeExpression'
import type { CanonicalThemeId } from '@/types/settingsContracts'

import { IslePressable } from './Pressable'

type ThemeColors = ReturnType<typeof useAppTheme>['colors']

interface ThemeModelSelectorExpressionProps {
  family: CanonicalThemeId
  colors: ThemeColors
  expression: ThemeComponentExpression
  testID?: string
  label: string
  accessibilityLabel: string
  accessibilityHint?: string
  maxWidth: number
  selected: boolean
  iconOnly: boolean
  ellipsizeMode: 'head' | 'middle' | 'tail' | 'clip'
  icon?: ReactNode
  onPress: () => void
}

const decorativeAccessibility = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
  pointerEvents: 'none' as const,
}

export function ThemeModelSelectorExpression(props: ThemeModelSelectorExpressionProps) {
  switch (props.family) {
    case 'minimal':
      return <MinimalModelSelector {...props} />
    case 'monet':
      return <MonetModelSelector {...props} />
    case 'material':
      return <MaterialModelSelector {...props} />
    case 'liquid-glass':
      return <LiquidGlassModelSelector {...props} />
  }
}

function MinimalModelSelector({
  colors,
  expression,
  testID,
  label,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
  selected,
  iconOnly,
  ellipsizeMode,
  icon,
  onPress,
}: ThemeModelSelectorExpressionProps) {
  const foreground = selected ? colors.ui.icon.accentForeground : colors.textSecondary

  return (
    <IslePressable
      testID={testID}
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, expanded: false }}
      onPress={onPress}
      style={[
        styles.minimalPressable,
        iconOnly ? styles.iconOnlySize : styles.labelledSize,
        { maxWidth },
      ]}
    >
      <View testID="theme-model-selector-minimal" style={styles.minimalLedger}>
        <View
          {...decorativeAccessibility}
          style={[
            styles.minimalIndexRail,
            { borderLeftColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border },
          ]}
        >
          <View style={[styles.minimalIndexTickShort, { backgroundColor: foreground }]} />
          <View style={[styles.minimalIndexTickLong, { backgroundColor: foreground }]} />
        </View>
        <View style={[styles.minimalContentRow, iconOnly ? styles.minimalContentRowIconOnly : null]}>
          {icon ? <View style={styles.minimalIconSlot}>{icon}</View> : null}
          {iconOnly ? null : (
            <>
              <Text
                numberOfLines={1}
                ellipsizeMode={ellipsizeMode}
                style={[styles.minimalLabel, { color: foreground }]}
              >
                {label}
              </Text>
              <View style={styles.minimalDisclosureSlot}>
                <AppIcon name="collapse" color={colors.textTertiary} size={11} strokeWidth={appIconStroke.regular} />
              </View>
            </>
          )}
        </View>
        <View
          {...decorativeAccessibility}
          style={[
            styles.minimalBaseline,
            {
              borderBottomColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
              borderBottomWidth: expression.border === 'none' ? StyleSheet.hairlineWidth : 1,
            },
          ]}
        />
      </View>
    </IslePressable>
  )
}

function MonetModelSelector({
  colors,
  testID,
  label,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
  selected,
  iconOnly,
  ellipsizeMode,
  icon,
  onPress,
}: ThemeModelSelectorExpressionProps) {
  const foreground = selected ? colors.ui.icon.accentForeground : colors.textSecondary

  return (
    <IslePressable
      testID={testID}
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, expanded: false }}
      onPress={onPress}
      style={[
        styles.monetPressable,
        iconOnly ? styles.iconOnlySize : styles.labelledSize,
        { maxWidth },
      ]}
    >
      <View testID="theme-model-selector-monet" style={styles.monetComposition}>
        <View
          style={[
            styles.monetRibbon,
            iconOnly ? styles.monetRibbonIconOnly : null,
            {
              backgroundColor: selected ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.base,
              borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
            },
          ]}
        >
          {!iconOnly && selected ? (
            <View
              {...decorativeAccessibility}
              style={[styles.monetSelectedMark, { backgroundColor: colors.ui.control.primaryBorder }]}
            />
          ) : null}
          {icon ? (
            <View style={styles.monetIconSlot}>{icon}</View>
          ) : null}
          {iconOnly ? null : (
            <>
              <Text
                numberOfLines={1}
                ellipsizeMode={ellipsizeMode}
                style={[styles.monetLabel, { color: foreground }]}
              >
                {label}
              </Text>
              <View style={styles.monetDisclosureSlot}>
                <AppIcon name="collapse" color={colors.textTertiary} size={12} strokeWidth={appIconStroke.regular} />
              </View>
            </>
          )}
        </View>
      </View>
    </IslePressable>
  )
}

function MaterialModelSelector({
  colors,
  expression,
  testID,
  label,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
  selected,
  iconOnly,
  ellipsizeMode,
  icon,
  onPress,
}: ThemeModelSelectorExpressionProps) {
  const foreground = selected ? colors.ui.icon.accentForeground : colors.textSecondary

  return (
    <IslePressable
      testID={testID}
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, expanded: false }}
      onPress={onPress}
      style={[
        styles.materialPressable,
        iconOnly ? styles.iconOnlySize : styles.labelledSize,
        {
          maxWidth,
          backgroundColor: colors.ui.semantic.surface.muted,
          borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.semantic.chrome.border,
          borderWidth: expression.border === 'none' ? 0 : 1,
        },
      ]}
    >
      <View testID="theme-model-selector-material" style={styles.materialComposition}>
        <View
          {...decorativeAccessibility}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary, opacity: selected ? 0.12 : 0.045 }]}
        />
        <View
          {...decorativeAccessibility}
          style={[
            styles.materialIndicatorRail,
            { backgroundColor: selected ? colors.primary : colors.ui.semantic.chrome.border },
          ]}
        />
        <View
          style={[
            styles.materialLeadingSlot,
            iconOnly ? styles.materialLeadingSlotIconOnly : null,
            { borderRightColor: colors.ui.semantic.chrome.border },
          ]}
        >
          {icon ?? <AppIcon name="model" color={foreground} size={14} strokeWidth={appIconStroke.strong} />}
        </View>
        {iconOnly ? null : (
          <>
            <View style={styles.materialLabelSlot}>
              <Text
                numberOfLines={1}
                ellipsizeMode={ellipsizeMode}
                style={[styles.materialLabel, { color: foreground }]}
              >
                {label}
              </Text>
            </View>
            <View style={[styles.materialDisclosureSlot, { backgroundColor: colors.ui.actionBar.itemBackground }]}>
              <AppIcon name="collapse" color={colors.textTertiary} size={13} strokeWidth={appIconStroke.strong} />
            </View>
          </>
        )}
      </View>
    </IslePressable>
  )
}

function LiquidGlassModelSelector({
  colors,
  expression,
  testID,
  label,
  accessibilityLabel,
  accessibilityHint,
  maxWidth,
  selected,
  iconOnly,
  ellipsizeMode,
  icon,
  onPress,
}: ThemeModelSelectorExpressionProps) {
  const foreground = selected ? colors.ui.icon.accentForeground : colors.textSecondary

  return (
    <IslePressable
      testID={testID}
      haptic
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, expanded: false }}
      onPress={onPress}
      style={[
        styles.glassPressable,
        iconOnly ? styles.iconOnlySize : styles.labelledSize,
        {
           maxWidth,
           backgroundColor: selected ? colors.ui.actionBar.itemActiveBackground : colors.ui.semantic.surface.overlay,
           borderColor: colors.ui.actionBar.itemBorder,
           borderWidth: 0,
         },
      ]}
    >
      <View testID="theme-model-selector-liquid-glass" style={styles.glassComposition}>
        <View
          style={[
            styles.glassInnerPlane,
            iconOnly ? styles.glassInnerPlaneIconOnly : null,
            {
              backgroundColor: colors.ui.actionBar.itemBackground,
              borderColor: selected ? colors.ui.control.primaryBorder : colors.ui.actionBar.itemBorder,
              borderWidth: expression.border === 'none' ? 0 : StyleSheet.hairlineWidth,
            },
          ]}
        >
          <View style={styles.glassLeadingLens}>
            {icon ?? <AppIcon name="model" color={foreground} size={12} strokeWidth={appIconStroke.regular} />}
          </View>
          {iconOnly ? null : (
            <>
              <Text
                numberOfLines={1}
                ellipsizeMode={ellipsizeMode}
                style={[styles.glassLabel, { color: foreground }]}
              >
                {label}
              </Text>
              <View
                style={[
                   styles.glassDisclosureLens,
                   {
                     backgroundColor: 'transparent',
                   },
                 ]}
              >
                <AppIcon name="collapse" color={colors.textTertiary} size={12} strokeWidth={appIconStroke.regular} />
              </View>
            </>
          )}
        </View>
      </View>
    </IslePressable>
  )
}

const styles = StyleSheet.create({
  // Keep the labelled selector readable and tappable when the composer rail shrinks.
  labelledSize: { minWidth: 72, flexGrow: 0, flexShrink: 1 },
  iconOnlySize: { width: 44, minWidth: 44, flexGrow: 0, flexShrink: 0 },
  minimalPressable: { height: 44, overflow: 'hidden', justifyContent: 'center', paddingHorizontal: 2 },
  minimalLedger: { position: 'relative', height: 34, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  minimalIndexRail: { width: 11, height: 25, flexShrink: 0, justifyContent: 'center', gap: 5, borderLeftWidth: 1, paddingLeft: 3 },
  minimalIndexTickShort: { width: 4, height: 1, opacity: 0.65 },
  minimalIndexTickLong: { width: 7, height: 1, opacity: 0.9 },
  minimalContentRow: { minWidth: 0, flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 4 },
  minimalContentRowIconOnly: { justifyContent: 'center', paddingLeft: 0 },
  minimalIconSlot: { width: 18, height: 18, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  minimalLabel: { minWidth: 0, flex: 1, fontSize: 10.5, lineHeight: 15, fontWeight: '700', includeFontPadding: false },
  minimalDisclosureSlot: { width: 15, height: 22, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  minimalBaseline: { position: 'absolute', left: 2, right: 0, bottom: 2, height: 1 },
  monetPressable: { height: 44, justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 1 },
  monetComposition: { position: 'relative', height: 40, minWidth: 0, justifyContent: 'center' },
  monetRibbon: { position: 'relative', height: 32, marginLeft: 3, marginRight: 5, paddingLeft: 7, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 14, borderTopRightRadius: 8, borderBottomRightRadius: 16, borderBottomLeftRadius: 10 },
  monetRibbonIconOnly: { marginLeft: 5, marginRight: 5, justifyContent: 'center', paddingHorizontal: 0 },
  monetSelectedMark: { position: 'absolute', left: 2, top: 7, bottom: 7, width: 2, borderRadius: 1 },
  monetIconSlot: { width: 18, height: 18, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  monetLabel: { minWidth: 0, flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '700', includeFontPadding: false },
  monetDisclosureSlot: { width: 16, height: 24, flexShrink: 0, alignItems: 'center', justifyContent: 'center', transform: [{ translateY: 1 }] },
  materialPressable: { height: 44, overflow: 'hidden', borderRadius: 12 },
  materialComposition: { position: 'relative', flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'stretch' },
  materialIndicatorRail: { width: 3, flexShrink: 0, opacity: 0.88 },
  materialLeadingSlot: { width: 28, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  materialLeadingSlotIconOnly: { width: 40, borderRightWidth: 0 },
  materialLabelSlot: { minWidth: 0, flex: 1, justifyContent: 'center', paddingHorizontal: 6 },
  materialLabel: { fontSize: 11.5, lineHeight: 16, fontWeight: '800', includeFontPadding: false },
  materialDisclosureSlot: { width: 26, height: 26, flexShrink: 0, alignSelf: 'center', marginRight: 4, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  glassPressable: { height: 44, overflow: 'hidden', borderRadius: 20, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  glassComposition: { position: 'relative', flex: 1, minWidth: 0, justifyContent: 'center', paddingHorizontal: 3 },
  glassInnerPlane: { minWidth: 0, height: 34, paddingLeft: 4, paddingRight: 3, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 5 },
  glassInnerPlaneIconOnly: { justifyContent: 'center', paddingHorizontal: 0 },
  glassLeadingLens: { width: 24, height: 24, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  glassLabel: { minWidth: 0, flex: 1, fontSize: 11, lineHeight: 15, fontWeight: '700', includeFontPadding: false },
  glassDisclosureLens: { width: 24, height: 24, flexShrink: 0, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
