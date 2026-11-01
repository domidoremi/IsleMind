import type { ReactNode } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export function ProviderConfigurationHeader({ name, closeLabel, onClose, feedback, help }: {
  name: string
  closeLabel: string
  onClose: () => void
  feedback: ReactNode
  help: ReactNode
}) {
  const { colors } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
  const narrow = width / fontScale < 400
  return <View testID="provider-configuration-header" style={styles.row}>
    {!narrow ? <View testID="provider-configuration-ornament" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.icon, { backgroundColor: colors.ui.icon.accentBackground }]}>
      <AppIcon name="provider-key" color={colors.ui.icon.accentForeground} size={16} />
    </View> : null}
    <Text testID="provider-configuration-title" accessibilityRole="header" accessibilityLabel={name} numberOfLines={3}
      style={[styles.title, colors.design!.semantic.typography.title, { color: colors.text }]}>{name}</Text>
    <View style={styles.actions}>
      {feedback}
      {help}
      <IslePressable haptic testID="provider-configuration-close" accessibilityRole="button" accessibilityLabel={closeLabel}
        onPress={onClose} style={styles.close}>
        <AppIcon name="close" color={colors.textSecondary} size={17} />
      </IslePressable>
    </View>
  </View>
}

const styles = StyleSheet.create({
  row: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, minWidth: 0 },
  actions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { width: 32, height: 32, borderRadius: 8, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  close: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
})
