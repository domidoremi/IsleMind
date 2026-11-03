import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'

export function SettingsConnectionCard({ name, model, hasDefault, hasConnections, onOpen }: {
  name?: string
  model?: string
  hasDefault: boolean
  hasConnections: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const label = t(hasDefault ? 'settingsUx.design.currentConnection' : 'settingsWorkspace.categories.models')
  const title = name ?? t(hasConnections ? 'settings.providers' : 'settingsUx.addConnection')
  const action = t(hasConnections ? 'settingsUx.design.manageConnections' : 'settingsUx.design.pasteConfiguration')
  return <View testID="settings-connection-card">
    <IslePressable testID="settings-entry-providers" accessibilityRole="button"
      accessibilityLabel={[label, title, model].filter(Boolean).join(', ')} haptic onPress={onOpen} style={styles.card}>
      <View style={styles.identity}>
        <View pointerEvents="none" style={styles.mark}>
          <AppIcon name={hasConnections ? 'model' : 'add'} size={22} color={colors.ui.icon.accentForeground} />
        </View>
        <View style={{ minWidth: 0, flex: 1, gap: 4 }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
          <Text style={[typography.title, { color: colors.text }]}>{title}</Text>
          {model ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{model}</Text> : null}
          <Text style={[typography.label, { color: colors.ui.icon.accentForeground }]}>{action}</Text>
        </View>
        <AppIcon name="arrow-right" size={18} color={colors.ui.icon.accentForeground} />
      </View>
    </IslePressable>
  </View>
}

const styles = StyleSheet.create({
  card: { minWidth: 0, minHeight: 76, paddingHorizontal: 2, paddingVertical: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: { width: 24, height: 28, justifyContent: 'center', alignItems: 'center' },
})
