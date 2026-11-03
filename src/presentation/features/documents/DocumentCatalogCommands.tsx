import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { IsleSearchField } from '@/components/ui/isle'
import { WorkspaceChoice } from '@/presentation/layout/WorkspaceChoice'
import { FeedbackGlyph } from '@/components/ui/FeedbackGlyph'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { useDocumentCatalogController } from './useDocumentCatalogController'

export function DocumentCatalogCommands({ controller }: { controller: ReturnType<typeof useDocumentCatalogController> }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const { query, sort, retainingRows, status, documents, visible } = controller
  return <View testID="document-library-filters" style={{ minWidth: 0, gap: 10 }}>
    <IsleSearchField value={query} onChangeText={controller.changeQuery} onClear={() => controller.changeQuery('')}
      clearAccessibilityLabel={t('common.clearSearch')} placeholder={t('documents.search')} accessibilityLabel={t('documents.search')} />
    <View style={styles.statusRow}>
      <View style={styles.count}>
        {retainingRows ? <Text testID="document-library-count" accessibilityLiveRegion="polite"
          style={[typography.caption, { color: colors.textSecondary }]}>
          {t(query.trim() ? 'documents.resultCount' : 'documents.libraryCount', { count: query.trim() ? visible.length : documents.length, total: documents.length })}
        </Text> : null}
        <FeedbackGlyph phase={status === 'loading' ? 'pending' : 'idle'} label={t('documents.refreshing')} testID="document-library-status" />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('documents.sort')} style={styles.sorting}>
        {(['updated', 'title'] as const).map(value => <WorkspaceChoice key={value} testID={`document-sort-${value}`}
          role="radio" label={t(value === 'updated' ? 'documents.sortUpdated' : 'documents.sortTitle')}
          selected={sort === value} onPress={() => controller.changeSort(value)} />)}
      </View>
    </View>
  </View>
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sorting: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
})
