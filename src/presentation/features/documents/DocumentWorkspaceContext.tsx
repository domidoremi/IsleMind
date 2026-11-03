import type { Dispatch } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Text } from '@/components/ui/AppText'
import { AppIcon, type AppIconName } from '@/components/ui/AppIcon'
import { IsleButton, IslePressable } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { DocumentDraft, DocumentRevisionPort, DocumentRevisionSource, SavedDocument } from '@/modules/documents'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import { DocumentRevisionPanel, type DocumentRevisionBase } from './DocumentRevisionPanel'
import { DocumentSourceContext } from './DocumentSourceContext'
import type { DocumentEditorViewAction, DocumentEditorViewState } from './documentEditorViewState'

export function DocumentWorkspaceContext({ draft, saved, busy, view, dispatch, revision, routeKey, wide, onAccept, onDelete, onRemoveReview, onInputFocus, onInputBlur, onInputLayout }: {
  draft: DocumentDraft
  saved: SavedDocument | null
  busy: boolean
  view: DocumentEditorViewState
  dispatch: Dispatch<DocumentEditorViewAction>
  revision: DocumentRevisionPort
  routeKey: string
  wide: boolean
  onAccept: (base: DocumentRevisionBase, body: string, sources?: readonly DocumentRevisionSource[]) => Promise<boolean>
  onDelete: () => void
  onRemoveReview: () => void
  onInputFocus?: () => void
  onInputBlur?: () => void
  onInputLayout?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const typography = colors.design!.semantic.typography
  const originOpen = view.panel === 'sources' && view.sourceTab === 'origin'
  const reviewOpen = view.panel === 'sources' && view.sourceTab === 'review'
  const selectSource = (tab: 'origin' | 'review') => dispatch(
    view.panel === 'sources' && view.sourceTab === tab ? { type: 'close-panel' } : { type: 'source-tab', tab },
  )
  const tool = (id: string, label: string, visibleLabel: string, icon: AppIconName, selected: boolean, onPress: () => void) =>
    <IslePressable key={id} testID={id} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ expanded: selected }} haptic onPress={onPress}
      style={[styles.tool, { backgroundColor: selected ? colors.ui.icon.accentBackground : 'transparent', borderRadius: colors.design!.semantic.radius.medium }]}>
      <AppIcon name={icon} size={18} color={selected ? colors.ui.icon.accentForeground : colors.textSecondary} />
      <Text style={[typography.label, { color: selected ? colors.text : colors.textSecondary, flexShrink: 1 }]}>{visibleLabel}</Text>
    </IslePressable>

  return <View testID="document-context-workspace" style={{ minWidth: 0, gap: 12 }}>
    {wide ? <Text accessibilityRole="header" style={[typography.label, { color: colors.textSecondary }]}>{t('taskWorkspace.context')}</Text> : null}
    <View testID="document-context-actions" style={[styles.tools, { flexDirection: wide ? 'column' : 'row' }]}>
      {draft.origin ? tool('document-origin-toggle', t(originOpen ? 'documents.hideOrigin' : 'documents.showOrigin'), t('taskWorkspace.sources'), 'source', originOpen, () => selectSource('origin')) : null}
      {draft.reviewContext ? tool('document-review-toggle', t(reviewOpen ? 'documents.review.hide' : 'documents.review.show'), t('taskWorkspace.review'), 'list-check', reviewOpen, () => selectSource('review')) : null}
      {tool('document-revision-toggle', t(view.panel === 'revision' ? 'documents.revision.close' : 'documents.revision.open'), t('taskWorkspace.revision'), 'edit', view.panel === 'revision', () => dispatch({ type: 'toggle-panel', panel: 'revision' }))}
      {tool('document-storage-toggle', t('documents.storage'), t('taskWorkspace.details'), 'settings-sliders', view.panel === 'details', () => dispatch({ type: 'toggle-panel', panel: 'details' }))}
    </View>
    {view.panel === null && wide ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{t('taskWorkspace.contextHint')}</Text> : null}
    <WorkspaceSurface role="support" testID="document-context-panel"
      style={view.panel === null ? styles.hidden : { gap: 14 }}>
      <View style={styles.panelHeader}>
        <Text accessibilityRole="header" style={[typography.label, { flex: 1, color: colors.text }]}>{t(view.panel === 'sources' ? 'taskWorkspace.sources' : view.panel === 'revision' ? 'taskWorkspace.revision' : 'documents.storage')}</Text>
        <IslePressable testID="document-context-close" accessibilityRole="button" accessibilityLabel={t('common.close')}
          onPress={() => dispatch({ type: 'close-panel' })} style={styles.close}>
          <AppIcon name="close" size={18} color={colors.textSecondary} />
        </IslePressable>
      </View>
      <View style={view.panel === 'sources' ? undefined : styles.hidden} accessibilityElementsHidden={view.panel !== 'sources'} importantForAccessibility={view.panel === 'sources' ? 'auto' : 'no-hide-descendants'}>
        <DocumentSourceContext draft={draft} tab={view.sourceTab} busy={busy} onRemoveReview={onRemoveReview} />
      </View>
      <DocumentRevisionPanel key={routeKey} draft={draft} saved={saved} port={revision} disabled={busy}
        open={view.panel === 'revision'} embedded onAccept={onAccept}
        onInputFocus={onInputFocus} onInputBlur={onInputBlur} onInputLayout={onInputLayout} />
      <View style={view.panel === 'details' ? { gap: 16 } : styles.hidden}
        accessibilityElementsHidden={view.panel !== 'details'} importantForAccessibility={view.panel === 'details' ? 'auto' : 'no-hide-descendants'}>
        <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.retentionNotice')}</Text>
        <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.copyNotice')}</Text>
        {saved ? <View style={{ paddingTop: 12, alignItems: 'flex-start' }}>
          <IsleButton compact label={t('common.delete')} tone="danger" disabled={busy} onPress={onDelete} />
        </View> : null}
      </View>
    </WorkspaceSurface>
  </View>
}

const styles = StyleSheet.create({
  tools: { minWidth: 0, flexWrap: 'wrap', gap: 4 },
  tool: { minWidth: 0, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hidden: { display: 'none' },
})
