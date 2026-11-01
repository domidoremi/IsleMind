import { useCallback, useState } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import { IsleButton, IsleMotionFrame, IslePressable, IsleSearchField } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { FeedbackGlyph } from '@/components/ui/FeedbackGlyph'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { DocumentRepository } from '@/modules/documents'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { useDocumentLibraryViewState } from './useDocumentLibraryViewState'
import { WorkspaceIntro } from '@/components/ui/WorkspaceIntro'

export default function DocumentLibraryScreen({ repository }: { repository: DocumentRepository }) {
  const { t } = useTranslation()
  const { colors, canonicalThemeId } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const create = () => router.push('/documents/edit')
  const { documents, query, hasSnapshot, setDocuments, setQuery } = useDocumentLibraryViewState(repository)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  useFocusEffect(useCallback(() => {
    const controller = new AbortController()
    setStatus('loading')
    void repository.list({ signal: controller.signal }).then((rows) => {
      if (!controller.signal.aborted) { setDocuments(rows); setStatus('ready') }
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [repository, attempt, setDocuments]))
  const visible = documents.filter((document) => document.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const retainingRows = hasSnapshot && documents.length > 0

  return <ThemeDetailFrame kind="documents" title={t('documents.title')} backLabel={t('common.back')}
    onBack={() => router.canGoBack() ? router.back() : router.replace('/conversations')}
    actions={<IsleButton testID="document-new" label={t('documents.new')} compact onPress={create} />}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.canvas}>
      <WorkspaceIntro compact icon="source" title={t('documents.localSpace')} description={t('documents.libraryNotice')}
        status={<View style={styles.catalogStatus}>
            {retainingRows ? <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t('documents.libraryCount', { count: documents.length })}</Text> : null}
            <FeedbackGlyph phase={status === 'loading' ? 'pending' : 'idle'} label={t('documents.refreshing')} testID="document-library-status" />
          </View>} />
      <IsleSearchField value={query} onChangeText={setQuery} onClear={() => setQuery('')} clearAccessibilityLabel={t('common.clearSearch')} placeholder={t('documents.search')} accessibilityLabel={t('documents.search')} />
      {status === 'loading' && !retainingRows ? <View testID="document-library-loading" accessibilityLabel={t('common.loading')} accessibilityState={{ busy: true }} style={styles.loading}>
        {[0, 1, 2].map(index => <View key={index} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.loadingRow, { borderBottomColor: colors.ui.semantic.chrome.border }]}>
          <View style={[styles.loadingLine, { width: index === 1 ? '88%' : '68%', backgroundColor: colors.ui.semantic.surface.muted }]} />
          <View style={[styles.loadingLine, { width: '42%', height: 8, backgroundColor: colors.ui.semantic.surface.muted }]} />
        </View>)}
      </View> : null}
      {status === 'error' ? <View testID="document-library-read-error" style={retainingRows ? styles.readError : styles.empty}>
        <AppIcon name="warning" size={retainingRows ? 18 : 28} color={colors.ui.tone.danger.foreground} />
        <Text selectable accessibilityRole="alert" style={{ ...typography.body, color: colors.text, textAlign: retainingRows ? 'left' : 'center' }}>{t(retainingRows ? 'documents.refreshFailed' : 'documents.loadFailed')}</Text>
        <IsleButton label={t('common.retry')} onPress={() => setAttempt((value) => value + 1)} style={styles.centeredAction} />
      </View> : null}
      {status === 'ready' && !visible.length ? <IsleMotionFrame role="section" testID="document-library-empty" style={styles.empty}>
        {!query.trim() ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.paper, { backgroundColor: colors.ui.semantic.surface.raised, borderColor: colors.ui.semantic.chrome.border, borderRadius: canonicalThemeId === 'minimal' ? 4 : canonicalThemeId === 'animal-island-ui' ? 12 : 20 }]}>
          <View style={[styles.bookmark, { backgroundColor: colors.ui.icon.accentForeground }]} />
          <AppIcon name="edit" size={24} color={colors.ui.icon.accentForeground} />
          {[0.86, 0.68, 0.78].map((width, index) => <View key={index} style={{ width: `${width * 100}%`, height: 3, borderRadius: 2, backgroundColor: colors.ui.section.divider }} />)}
        </View> : <AppIcon name="search" size={28} color={colors.textTertiary} />}
        <View style={styles.emptyCopy}>
          <Text accessibilityRole="header" style={{ ...typography.headline, color: colors.text, textAlign: 'center' }}>{t(query.trim() ? 'documents.noMatches' : 'documents.emptyTitle')}</Text>
          {!query.trim() ? <Text selectable style={{ ...typography.body, color: colors.textSecondary, textAlign: 'center' }}>{t('documents.empty')}</Text> : null}
        </View>
        <IsleButton testID={query.trim() ? 'document-library-clear' : 'document-library-create'} label={t(query.trim() ? 'common.clearSearch' : 'documents.new')} tone={query.trim() ? 'soft' : 'primary'}
          icon={!query.trim() ? <AppIcon name="add" size={16} color={colors.ui.control.primaryForeground} /> : undefined}
          onPress={query.trim() ? () => setQuery('') : create} style={styles.centeredAction} />
      </IsleMotionFrame> : null}
      {retainingRows ? <View accessibilityRole="list" testID="document-library-catalog">{visible.map((document, index) => <IslePressable key={document.id}
        testID={`document-row-${document.id}`} haptic accessibilityRole="button" accessibilityLabel={document.title} accessibilityHint={t('documents.openHint')}
        onPress={() => router.push({ pathname: '/documents/edit', params: { id: document.id } })}
        style={[styles.documentRow, { borderBottomColor: colors.ui.semantic.chrome.border }]}>
        <Text accessible={false} importantForAccessibility="no" style={{ ...typography.caption, color: colors.textTertiary }}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={styles.documentCopy}>
          <Text numberOfLines={3} style={{ ...typography.title, color: colors.text }}>{document.title}</Text>
          <Text style={{ ...typography.caption, color: colors.textSecondary }}>{t('documents.updated', { time: new Date(document.updatedAt).toLocaleString() })}</Text>
        </View>
        <AppIcon name="arrow-right" size={18} color={colors.textTertiary} />
      </IslePressable>)}</View> : null}
    </ScrollView>
  </ThemeDetailFrame>
}

const styles = StyleSheet.create({
  canvas: { flexGrow: 1, padding: 20, gap: 20, width: '100%', maxWidth: 880, alignSelf: 'center', paddingBottom: 40 },
  intro: { gap: 10 },
  libraryLabel: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  catalogStatus: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  loading: { gap: 4 },
  loadingRow: { minHeight: 96, gap: 12, paddingVertical: 26, borderBottomWidth: StyleSheet.hairlineWidth },
  loadingLine: { height: 16, borderRadius: 4 },
  readError: { minWidth: 0, gap: 10 },
  empty: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 440, alignSelf: 'center', paddingVertical: 36, gap: 24 },
  emptyCopy: { width: '100%', gap: 10 },
  paper: { width: 112, aspectRatio: 0.82, borderWidth: StyleSheet.hairlineWidth, padding: 20, justifyContent: 'flex-end', gap: 14 },
  bookmark: { position: 'absolute', top: 0, right: 20, width: 12, height: 32, borderBottomLeftRadius: 6, borderBottomRightRadius: 6 },
  centeredAction: { alignSelf: 'center' },
  documentRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 80, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  documentCopy: { flex: 1, minWidth: 0, gap: 6 },
})
