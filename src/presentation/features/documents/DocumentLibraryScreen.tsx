import { useState } from 'react'
import { router } from 'expo-router'
import { FlatList, StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleMotionFrame } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { DocumentRepository } from '@/modules/documents'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { useWorkspaceLayout } from '@/presentation/layout/useWorkspaceLayout'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import { useDocumentCatalogController } from './useDocumentCatalogController'
import { DocumentCatalogCommands } from './DocumentCatalogCommands'
import { DocumentCatalogItem } from './DocumentCatalogItem'
import { DocumentContextToggle } from './DocumentEditorTools'

export default function DocumentLibraryScreen({ repository }: { repository: DocumentRepository }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const controller = useDocumentCatalogController(repository)
  const { rows, query, openedId, visible, retainingRows, status, language } = controller
  const layout = useWorkspaceLayout()
  const create = () => router.push('/documents/edit')
  const [showStorage, setShowStorage] = useState(false)

  return <ThemeDetailFrame kind="documents" title={t('documents.title')} backLabel={t('common.back')}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/conversations')}
    actions={<IsleButton testID="document-new" label={t('documents.new')} compact onPress={create} />}>
    <View testID={retainingRows ? 'document-library-catalog' : undefined}
      style={[styles.workspace, { paddingHorizontal: layout.gutter, maxWidth: layout.maxWidth }]}>
      <View testID="document-library-commands" style={styles.commands}>
        <DocumentCatalogCommands controller={controller} />
        {status === 'error' ? <View testID="document-library-read-error" style={styles.readError}>
          <AppIcon name="warning" size={18} color={colors.ui.tone.danger.foreground} />
          <Text selectable accessibilityRole="alert" style={[typography.body, { color: colors.text, flex: 1 }]}>
            {t(retainingRows ? 'documents.refreshFailed' : 'documents.loadFailed')}
          </Text>
          <IsleButton compact label={t('common.retry')} onPress={controller.retry} />
        </View> : null}
      </View>
      <WorkspaceSurface role="reading" testID="document-library-reading" style={styles.reading}>
        <FlatList ref={controller.list} testID="document-library-list" data={retainingRows ? rows : []}
          keyExtractor={row => row.id} initialNumToRender={16} maxToRenderPerBatch={16} windowSize={7}
          style={{ flex: 1 }} contentContainerStyle={styles.canvas}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
          onLayout={event => controller.onViewport(event.nativeEvent.layout.height)}
          onContentSizeChange={(_width, height) => controller.onContent(height)}
          onScroll={event => controller.onScroll(event.nativeEvent.contentOffset.y)} scrollEventThrottle={64}
          ListEmptyComponent={<>
            {status === 'loading' && !retainingRows ? <View testID="document-library-loading"
              accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }} style={styles.loading}>
              {[0, 1, 2].map(index => <View key={index} accessible={false} accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants" style={styles.loadingRow}>
                <View style={[styles.loadingLine, { width: index === 1 ? '88%' : '68%', backgroundColor: colors.ui.semantic.surface.muted }]} />
                <View style={[styles.loadingLine, { width: '42%', height: 8, backgroundColor: colors.ui.semantic.surface.muted }]} />
              </View>)}
            </View> : null}
            {status === 'ready' && !visible.length ? <IsleMotionFrame role="section" testID="document-library-empty" style={styles.empty}>
              <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={[styles.emptyMark, { backgroundColor: colors.ui.icon.accentBackground, borderRadius: colors.design!.semantic.radius.large }]}>
                <AppIcon name={query.trim() ? 'search' : 'edit'} size={28} color={colors.ui.icon.accentForeground} />
              </View>
              <Text accessibilityRole="header" style={[typography.headline, { color: colors.text, textAlign: 'center' }]}>
                {t(query.trim() ? 'documents.noMatches' : 'documents.emptyTitle')}
              </Text>
              {!query.trim() ? <Text style={[typography.body, { color: colors.textSecondary, textAlign: 'center' }]}>{t('taskWorkspace.catalog.emptyHint')}</Text> : null}
              <IsleButton testID={query.trim() ? 'document-library-clear' : 'document-library-create'}
                label={t(query.trim() ? 'common.clearSearch' : 'documents.new')} tone={query.trim() ? 'soft' : 'primary'}
                 style={{ alignSelf: 'center' }} onPress={query.trim() ? () => controller.changeQuery('') : create} />
            </IsleMotionFrame> : null}
          </>}
          ListFooterComponent={<View style={styles.footer}>
            <DocumentContextToggle open={showStorage} label={t('documents.storage')}
              onPress={() => setShowStorage(value => !value)} testID="document-library-storage-toggle" />
            {showStorage ? <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.libraryNotice')}</Text> : null}
          </View>}
          renderItem={({ item }) => item.kind === 'heading'
            ? <Text testID={`document-catalog-${item.id}`} accessibilityRole="header"
              style={[typography.label, styles.group, { color: colors.textSecondary }]}>
              {item.labelKey ? t(item.labelKey) : item.label}
            </Text>
            : <DocumentCatalogItem document={item.document} selected={openedId === item.document.id} language={language} wide={layout.wide}
              onOpen={() => {
                controller.setOpenedId(item.document.id)
                router.push({ pathname: '/documents/edit', params: { id: item.document.id } })
              }} />}
        />
      </WorkspaceSurface>
    </View>
  </ThemeDetailFrame>
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minHeight: 0, minWidth: 0, width: '100%', alignSelf: 'center', paddingTop: 12, paddingBottom: 20, gap: 12 },
  commands: { minWidth: 0, gap: 12 },
  reading: { flex: 1, minHeight: 0, padding: 8 },
  canvas: { flexGrow: 1, paddingHorizontal: 4, paddingBottom: 12 },
  group: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 10 },
  loading: { gap: 8, paddingHorizontal: 12 },
  loadingRow: { minHeight: 96, gap: 12, paddingVertical: 26 },
  loadingLine: { height: 16, borderRadius: 4 },
  readError: { minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  empty: { alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 440, alignSelf: 'center', paddingVertical: 44, paddingHorizontal: 20, gap: 18 },
  emptyMark: { width: 68, height: 72, justifyContent: 'center', alignItems: 'center' },
  footer: { paddingTop: 20, paddingHorizontal: 12, gap: 12 },
})
