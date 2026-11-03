import { useState } from 'react'
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text, TextInput } from '@/components/ui/AppText'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-native-markdown-display'
import { IsleButton } from '@/components/ui/isle'
import { AppIcon } from '@/components/ui/AppIcon'
import { ActionFeedback } from '@/components/ui/ActionFeedback'
import { useAppTheme } from '@/hooks/useAppTheme'
import { DOCUMENT_BODY_LIMIT, DOCUMENT_TITLE_LIMIT, type DocumentRepository, type DocumentRevisionPort } from '@/modules/documents'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { useWorkspaceLayout } from '@/presentation/layout/useWorkspaceLayout'
import { WorkspaceSurface } from '@/presentation/layout/WorkspaceSurface'
import { useKeyboardScrollViewport } from '@/presentation/layout/useKeyboardScrollViewport'
import { DocumentEditorToolbar, DocumentSaveStatus } from './DocumentEditorTools'
import { DocumentWorkspaceContext } from './DocumentWorkspaceContext'
import { useDocumentEditorController } from './useDocumentEditorController'

export default function DocumentEditorScreen({ repository, revision }: { repository: DocumentRepository; revision: DocumentRevisionPort }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const { height } = useWindowDimensions()
  const layout = useWorkspaceLayout()
  const typography = colors.design!.semantic.typography
  const editor = useDocumentEditorController(repository)
  const { draft, saved, loading, error, busy, preview } = editor
  const routeKey = JSON.stringify([editor.id, editor.conversationId, editor.messageId])
  const keyboardViewport = useKeyboardScrollViewport(routeKey)
  const [titleHeight, setTitleHeight] = useState(typography.headline.lineHeight)
  const readingHeight = Math.max(240, Math.min(760, height * (layout.wide ? 0.64 : 0.52)))
  const editorHeight = keyboardViewport.keyboardVisible && keyboardViewport.visibleHeight > 0
    ? Math.min(readingHeight, Math.max(44, keyboardViewport.visibleHeight - 32))
    : readingHeight

  return <ThemeDetailFrame kind="documents" title={t('documents.title')}
    backLabel={t(editor.conversationId && editor.messageId ? 'common.backToChat' : 'documents.title')} onBack={editor.returnFromEditor}
    actions={<View style={styles.headerActions}>
      <DocumentSaveStatus status={busy ? 'saving' : editor.saveStatus} />
      <IsleButton testID="document-save-action" label={t('common.save')} compact tone="primary" busy={busy}
        feedbackPhase={busy ? 'pending' : 'idle'} icon={<AppIcon name="check" size={16} color={colors.ui.control.primaryForeground} />}
        disabled={loading || !editor.canSave} onPress={() => void editor.save()} />
    </View>}>
    <View style={{ flex: 1, minHeight: 0 }}>
      {!loading && draft ? <View style={[styles.commandBar, { paddingHorizontal: layout.gutter }]}>
        <DocumentEditorToolbar preview={preview} onPreviewChange={editor.changePreview}
          copyPhase={editor.copyFeedback.phase} copyDisabled={!draft.body.length} onCopy={() => void editor.copyText()} />
      </View> : null}
      <View ref={keyboardViewport.frameRef} testID="document-scroll-viewport" collapsable={false}
        onLayout={keyboardViewport.onFrameLayout} style={{ flex: 1, minHeight: 0 }}>
      <ScrollView ref={keyboardViewport.scrollRef} testID="document-reading-scroll"
        style={{ flex: 1, marginBottom: keyboardViewport.bottomInset }} contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
        onLayout={keyboardViewport.onScrollLayout} onScroll={keyboardViewport.onScroll}
        onScrollBeginDrag={keyboardViewport.onScrollBeginDrag} scrollEventThrottle={16}
        contentContainerStyle={[styles.canvas, { paddingHorizontal: layout.gutter, maxWidth: layout.maxWidth }]}>
        {loading ? <Text style={{ color: colors.textSecondary }}>{t('common.loading')}</Text> : null}
        {error ? <View style={{ gap: 12 }}>
          <Text selectable accessibilityRole="alert" style={[typography.body, { color: colors.text }]}>{t(`documents.${error}`)}</Text>
          {draft && saved ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <IsleButton label={t('documents.reload')} disabled={busy} onPress={() => void editor.reload()} />
            <IsleButton label={t('documents.saveCopy')} disabled={busy} onPress={() => void editor.save(true)} />
          </View> : null}
        </View> : null}
        <ActionFeedback phase={editor.copyFeedback.phase} errorLabel={t('chat.clipboardUnavailable')} testID="document-copy-feedback" />
        {!loading && draft ? <View testID="document-workspace" style={{ minWidth: 0, flexDirection: layout.wide ? 'row' : 'column', gap: layout.gap }}>
          <View testID="document-writing-column" style={{ flex: layout.wide ? 1 : undefined, minWidth: 0 }}>
            <WorkspaceSurface role="reading" testID="document-writing-frame" focused={editor.writingFocused} style={{ gap: 22 }}>
              <View testID="document-editor-identity" style={{ minWidth: 0 }}>
                <TextInput testID="document-title" accessibilityLabel={t('documents.documentTitle')}
                  value={draft.title} editable={!busy} multiline maxLength={DOCUMENT_TITLE_LIMIT}
                  placeholder={t('documents.untitled')} placeholderTextColor={colors.textTertiary}
                  onFocus={keyboardViewport.onInputFocus} onBlur={keyboardViewport.onInputBlur} onLayout={keyboardViewport.onInputLayout}
                  onContentSizeChange={event => setTitleHeight(Math.max(typography.headline.lineHeight, event.nativeEvent.contentSize.height))}
                  onChangeText={title => editor.setDraft({ ...draft, title })}
                  style={[typography.headline, styles.heading, { height: titleHeight, color: colors.text }]} />
              </View>
              {preview ? <View testID="document-preview" style={{ minWidth: 0, gap: 12 }}>
                <Markdown onLinkPress={() => false} rules={{
                  image: node => <Text key={node.key} style={{ color: colors.textSecondary }}>{t('documents.imageNotLoaded')}</Text>,
                }} style={{ body: { ...typography.body, color: colors.text }, code_inline: { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted }, fence: { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted } }}>
                  {draft.body.slice(0, 100_000)}
                </Markdown>
                {draft.body.length > 100_000 ? <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.previewLimit')}</Text> : null}
                <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.previewNotice')}</Text>
              </View> : null}
              <View style={preview ? styles.hidden : undefined} accessibilityElementsHidden={preview} importantForAccessibility={preview ? 'no-hide-descendants' : 'auto'}>
                <TextInput ref={editor.bodyInput} testID="document-body" accessibilityLabel={t('documents.body')}
                  value={draft.body} multiline scrollEnabled editable={!busy} maxLength={DOCUMENT_BODY_LIMIT}
                  autoCapitalize="sentences" autoCorrect={false} placeholder={t('taskWorkspace.startWriting')} placeholderTextColor={colors.textTertiary}
                  onFocus={() => { editor.setWritingFocused(true); keyboardViewport.onInputFocus() }}
                  onBlur={() => { editor.setWritingFocused(false); keyboardViewport.onInputBlur() }}
                  onLayout={keyboardViewport.onInputLayout}
                  onSelectionChange={event => { if (!preview) editor.bodySelection.current = event.nativeEvent.selection }}
                  onScroll={event => {
                    if (!preview) editor.bodyScroll.current = Platform.OS === 'web'
                      ? (editor.bodyInput.current as TextInput & { scrollTop?: number } | null)?.scrollTop ?? 0
                      : event.nativeEvent.contentOffset.y
                  }}
                  onChangeText={body => editor.setDraft({ ...draft, body })}
                  style={[typography.body, styles.body, { height: editorHeight, color: colors.text }]} />
              </View>
            </WorkspaceSurface>
          </View>
          <View testID="document-context-column" style={{ minWidth: 0, flexBasis: layout.wide ? layout.sidebarWidth : 'auto', flexShrink: 0 }}>
            <DocumentWorkspaceContext draft={draft} saved={saved} busy={busy} view={editor.view} dispatch={editor.dispatchView}
              revision={revision} routeKey={routeKey} wide={layout.wide}
              onInputFocus={keyboardViewport.onInputFocus} onInputBlur={keyboardViewport.onInputBlur} onInputLayout={keyboardViewport.onInputLayout}
              onAccept={editor.acceptRevision} onDelete={() => void editor.remove()} onRemoveReview={() => void editor.removeReview()} />
          </View>
        </View> : null}
      </ScrollView>
      </View>
    </View>
  </ThemeDetailFrame>
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  commandBar: { paddingTop: 8, paddingBottom: 10, width: '100%', maxWidth: 1280, alignSelf: 'center' },
  canvas: { paddingTop: 4, paddingBottom: 48, gap: 12, width: '100%', alignSelf: 'center' },
  heading: { minWidth: 0, padding: 0, textAlignVertical: 'top' },
  body: { minWidth: 0, padding: 0, textAlignVertical: 'top' },
  hidden: { display: 'none' },
})
