import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IslePressable } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { DocumentSummary } from '@/modules/documents'

export function DocumentCatalogItem({ document, selected, language, wide, onOpen }: {
  document: DocumentSummary
  selected: boolean
  language: string
  wide: boolean
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const { colors, canonicalThemeId } = useAppTheme()
  const typography = colors.design!.semantic.typography
  return <IslePressable testID={`document-row-${document.id}`} haptic accessibilityRole="button"
    accessibilityLabel={document.title} accessibilityHint={t('documents.openHint')} accessibilityState={{ selected }}
    onPress={onOpen} style={[styles.row, {
      borderRadius: colors.design!.semantic.radius.medium,
      backgroundColor: selected ? colors.ui.icon.accentBackground : 'transparent',
    }]}>
    <View pointerEvents="none" style={[styles.mark, { backgroundColor: selected ? colors.ui.icon.accentBackground : colors.ui.semantic.surface.muted, borderRadius: canonicalThemeId === 'minimal' ? 6 : 12 }]}>
      <AppIcon name="source" size={20} color={selected ? colors.ui.icon.accentForeground : colors.textSecondary} />
    </View>
    <View style={styles.copy}>
      <Text numberOfLines={2} style={[typography.title, { color: colors.text }]}>{document.title}</Text>
      {!wide ? <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {t('documents.updated', { time: new Date(document.updatedAt).toLocaleDateString(language) })}
      </Text> : null}
    </View>
    {wide ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{new Date(document.updatedAt).toLocaleString(language)}</Text> : null}
    <AppIcon name="arrow-right" size={18} color={selected ? colors.ui.icon.accentForeground : colors.textTertiary} />
  </IslePressable>
}

const styles = StyleSheet.create({
  row: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 84, paddingHorizontal: 12, paddingVertical: 16 },
  mark: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 6 },
})
