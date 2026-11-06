import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { AppIcon } from '@/components/ui/AppIcon'
import { IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'

export interface ProviderConnectionRowProps {
  id: string
  position: number
  name: string
  endpoint: string
  stateLabel: string
  modelsLabel: string
  recentLabel?: string
  selectLabel: string
  editLabel: string
  enabled: boolean
  featured: boolean
  selected: boolean
  batchMode: boolean
  expanded: boolean
  onToggleSelected: () => void
  onOpen: () => void
  onEdit: () => void
}

export function ProviderConnectionRow(props: ProviderConnectionRowProps) {
  const { colors } = useAppTheme()
  const { width, fontScale } = useWindowDimensions()
  const narrow = width / fontScale < 360
  const typography = colors.design!.semantic.typography
  const accent = props.featured && props.enabled
  return <View testID={`provider-row-${props.id}`} style={[styles.row, {
    borderBottomColor: colors.ui.section.divider,
    borderLeftColor: accent ? colors.ui.icon.accentForeground : 'transparent',
    backgroundColor: props.selected ? colors.ui.semantic.surface.muted : 'transparent',
  }]}>
    {props.batchMode ? <IslePressable accessibilityRole="checkbox" accessibilityLabel={props.selectLabel}
      accessibilityState={{ checked: props.selected }} onPress={props.onToggleSelected} style={styles.iconAction}>
      <AppIcon name={props.selected ? 'check' : 'list-check'} color={colors.textSecondary} size={18} />
    </IslePressable> : null}
    <IslePressable testID={`provider-open-${props.id}`} accessibilityRole="button"
      accessibilityLabel={[props.name, props.stateLabel, props.modelsLabel, props.endpoint].join('. ')}
      accessibilityState={{ expanded: props.expanded }} onPress={props.onOpen} style={styles.open}>
      {!props.batchMode && !narrow ? <Text accessible={false} importantForAccessibility="no"
        style={[styles.position, typography.caption, { color: accent ? colors.ui.icon.accentForeground : colors.textTertiary }]}>
        {String(props.position).padStart(2, '0')}
      </Text> : null}
      <View style={styles.identity}>
        <Text numberOfLines={3} style={[typography.title, { color: colors.text }]}>{props.name}</Text>
        <Text numberOfLines={1} style={[typography.caption, { color: colors.textTertiary }]}>{props.endpoint}</Text>
        <View style={styles.metadata}>
          <View style={styles.state}>
            <View style={[styles.stateDot, { backgroundColor: props.enabled ? colors.ui.icon.accentForeground : colors.textTertiary }]} />
            <Text style={[typography.caption, { flexShrink: 1, minWidth: 0, color: colors.textSecondary }]}>{props.stateLabel}</Text>
          </View>
          <Text style={[typography.caption, { maxWidth: '100%', color: colors.textSecondary }]}>{props.modelsLabel}</Text>
        </View>
        {props.recentLabel ? <Text testID={`provider-recent-${props.id}`} numberOfLines={2}
          style={[typography.caption, { color: colors.textSecondary }]}>{props.recentLabel}</Text> : null}
      </View>
      <View accessible={false} importantForAccessibility="no-hide-descendants">
        <AppIcon name="back-next" color={colors.textTertiary} size={16} />
      </View>
    </IslePressable>
    {!props.batchMode ? <IslePressable testID={`provider-edit-${props.id}`} accessibilityRole="button"
      accessibilityLabel={props.editLabel} onPress={props.onEdit} style={styles.iconAction}>
      <AppIcon name="edit" color={colors.textSecondary} size={18} />
    </IslePressable> : null}
  </View>
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 8, paddingHorizontal: 10, borderLeftWidth: 3, borderBottomWidth: StyleSheet.hairlineWidth },
  open: { flex: 1, minWidth: 0, minHeight: 92, paddingVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  position: { width: 20, flexShrink: 0, alignSelf: 'flex-start', paddingTop: 3 },
  identity: { flex: 1, minWidth: 0, gap: 6 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 4 },
  state: { flexDirection: 'row', alignItems: 'center', maxWidth: '100%', gap: 5 },
  stateDot: { width: 5, height: 5, borderRadius: 3, flexShrink: 0 },
  iconAction: { width: 44, height: 44, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
})
