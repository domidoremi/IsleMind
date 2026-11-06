import { useState } from 'react'
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { MotiView } from 'moti'
import { Text } from '@/components/ui/AppText'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useThemeMotion } from '@/hooks/useThemeMotion'

/** Navigation shares the page canvas; only the current choice gets a marker. */
export function WorkspaceChoice({ label, accessibilityLabel = label, selected, disabled = false, onPress, role = 'tab', icon, testID, tabIndex, style }: {
  label: string
  accessibilityLabel?: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
  role?: 'tab' | 'radio'
  icon?: AppIconName
  testID?: string
  tabIndex?: 0 | -1
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useAppTheme()
  const motion = useThemeMotion('accent', { readable: true })
  const [focused, setFocused] = useState(false)
  const semantic = colors.design!.semantic
  const color = selected ? semantic.color.onPrimaryContainer : colors.textSecondary
  return <IslePressable testID={testID} haptic accessibilityRole={role} accessibilityLabel={accessibilityLabel}
    tabIndex={Platform.OS === 'web' ? tabIndex : undefined}
    disabled={disabled}
    accessibilityState={role === 'radio' ? { checked: selected, disabled } : { selected, disabled }}
    onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.choice, {
      borderRadius: semantic.radius.medium,
      borderColor: focused ? colors.ui.semantic.control.focus : 'transparent',
      opacity: disabled ? 0.5 : 1,
    }, style]}>
    <MotiView pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      animate={{ opacity: selected ? 1 : 0 }}
      transition={motion.intensity === 'full' ? motion.transition : { type: 'timing', duration: 0 }}
      style={[StyleSheet.absoluteFill, { borderRadius: semantic.radius.medium, backgroundColor: semantic.color.primaryContainer }]} />
    <View style={styles.label}>
      {icon ? <AppIcon name={icon} size={16} color={color} /> : null}
      <Text style={[colors.design!.semantic.typography.label, styles.text, { color }]}>{label}</Text>
    </View>
    <MotiView testID={testID ? `${testID}-selection` : undefined} pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      animate={motion.intensity === 'full' ? { opacity: selected ? 1 : 0, scaleX: selected ? 1 : 0.5 } : { opacity: selected ? 1 : 0 }}
      transition={motion.intensity === 'full' ? motion.transition : { type: 'timing', duration: 0 }}
      style={[styles.selection, { backgroundColor: color }]} />
  </IslePressable>
}

const styles = StyleSheet.create({
  choice: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, backgroundColor: 'transparent' },
  label: { minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  text: { flexShrink: 1, textAlign: 'center' },
  selection: { position: 'absolute', left: 12, right: 12, bottom: 2, height: 2, borderRadius: 1 },
})
