import { useEffect, useRef, useState } from 'react'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Text, TextInput } from '@/components/ui/AppText'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { ActionFeedback } from '@/components/ui/ActionFeedback'
import { AppIcon } from '@/components/ui/AppIcon'
import Markdown from 'react-native-markdown-display'
import { IsleButton, IsleInput, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useAppUpdateBlocker } from '@/hooks/useAppUpdateBlocker'
import { DOCUMENT_BODY_LIMIT, DOCUMENT_TITLE_LIMIT, DocumentConflictError, documentDraftFromMessage, parseDocumentReviewContext, type DocumentDraft, type DocumentRepository, type DocumentRevisionPort, type DocumentRevisionSource, type SavedDocument } from '@/modules/documents'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { IsleMotionFrame } from '@/components/ui/isle/ThemeMotion'
import { useChatStore } from '@/store/chatStore'
import { DocumentRevisionPanel, type DocumentRevisionBase } from './DocumentRevisionPanel'
import { DocumentContextToggle, DocumentEditorToolbar, DocumentSaveStatus } from './DocumentEditorTools'

export default function DocumentEditorScreen({ repository, revision }: { repository: DocumentRepository; revision: DocumentRevisionPort }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const { height } = useWindowDimensions()
  const typography = colors.design!.semantic.typography
  const editorHeight = Math.max(280, Math.min(620, height * 0.46))
  const dialog = useIsleDialog()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ id?: string; conversationId?: string; messageId?: string }>()
  const id = first(params.id)
  const conversationId = first(params.conversationId)
  const messageId = first(params.messageId)
  const [draft, setDraft] = useState<DocumentDraft | null>(null)
  const [saved, setSaved] = useState<SavedDocument | null>(null)
  const copyFeedback = useActionFeedback(draft?.body)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'loadFailed' | 'sourceUnavailable' | 'saveFailed' | 'conflict' | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const allowLeave = useRef(false)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [preview, setPreview] = useState(false)
  const [showOrigin, setShowOrigin] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const dirty = !!draft && (!saved || draft.title !== saved.title || draft.body !== saved.body || draft.reviewContext !== saved.reviewContext)
  useAppUpdateBlocker(loading || dirty || busy || showReview, 'document-edit')

  useEffect(() => {
    if (id && savedRef.current?.id === id) return
    const controller = new AbortController()
    setDraft(null)
    setSaved(null)
    setLoading(true)
    setError(null)
    setShowReview(false)
    void (async () => {
      if (id) {
        const document = await repository.get(id, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (!document) throw new Error('Missing document')
        setSaved(document)
        setDraft(document)
      } else if (conversationId || messageId) {
        const findSource = () => useChatStore.getState().conversations.find((item) => item.id === conversationId)
        if (!findSource()?.messages.some((item) => item.id === messageId)) await useChatStore.getState().loadAll()
        if (controller.signal.aborted) return
        const conversation = findSource()
        const message = conversation?.messages.find((item) => item.id === messageId)
        if (!conversation || !message) throw new Error('Missing source')
        setDraft(documentDraftFromMessage(conversation, message))
      } else {
        setDraft({ title: t('documents.untitled'), body: '' })
      }
    })().catch(() => {
      if (!controller.signal.aborted) setError(id ? 'loadFailed' : 'sourceUnavailable')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
    // Capture once per route identity; changing language must not discard an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, conversationId, messageId, repository])

  usePreventRemove(dirty || busy, ({ data }) => {
    if (allowLeave.current) { navigation.dispatch(data.action); return }
    if (busyRef.current) return
    void dialog.confirm({ title: t('documents.discardTitle'), message: t('documents.discardMessage'),
      confirmLabel: t('documents.discard'), cancelLabel: t('common.cancel'), tone: 'danger' })
      .then((confirmed) => { if (confirmed) navigation.dispatch(data.action) })
  })
  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && !busy)) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])

  function returnToLibrary() { router.replace('/documents') }
  function failure(reason: unknown) { setError(reason instanceof DocumentConflictError ? 'conflict' : 'saveFailed') }

  async function save(asCopy = false) {
    if (!draft || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = saved && !asCopy
        ? await repository.save(saved.id, saved.revision, { title: draft.title, body: draft.body, reviewContext: draft.reviewContext ?? null })
        : await repository.create(draft)
      savedRef.current = result
      setSaved(result)
      setDraft(result)
      router.setParams({ id: result.id })
    } catch (reason) { failure(reason) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function reload() {
    if (!saved || busyRef.current) return
    if (dirty && !await dialog.confirm({ title: t('documents.reload'), message: t('documents.discardMessage'),
      confirmLabel: t('documents.reload'), cancelLabel: t('common.cancel'), tone: 'danger' })) return
    busyRef.current = true
    setBusy(true)
    try {
      const latest = await repository.get(saved.id)
      if (!latest) { setError('conflict'); return }
      setSaved(latest); setDraft(latest); setError(null)
    } catch { setError('loadFailed') }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function remove() {
    if (!saved || busyRef.current) return
    if (!await dialog.confirm({ title: t('documents.deleteTitle'), message: t('documents.deleteMessage'),
      confirmLabel: t('common.delete'), cancelLabel: t('common.cancel'), tone: 'danger' })) return
    busyRef.current = true
    setBusy(true)
    try {
      await repository.remove(saved.id, saved.revision)
      allowLeave.current = true
      returnToLibrary()
    } catch (reason) { failure(reason) }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function copyText() {
    if (!draft) return
    await copyFeedback.run(() => Clipboard.setStringAsync(draft.body))
  }

  async function acceptRevision(base: DocumentRevisionBase, body: string, sources?: readonly DocumentRevisionSource[]): Promise<boolean> {
    if (busyRef.current || draftRef.current !== base.draft || savedRef.current !== base.saved) return false
    busyRef.current = true; setBusy(true)
    try {
      const reviewContext = sources ? parseDocumentReviewContext({ acceptedAt: Date.now(), title: base.draft.title, body, sources }) : base.draft.reviewContext
      if (base.saved) {
        const current = await repository.get(base.saved.id)
        if (!current || current.revision !== base.saved.revision) { setError('conflict'); return false }
      }
      if (draftRef.current !== base.draft || savedRef.current !== base.saved) return false
      // Acceptance edits only the unsaved draft. The independent Save operation
      // still compares durable revisions and preserves the immutable origin.
      setDraft({ ...base.draft, body, reviewContext })
      if (sources) setShowReview(true)
      return true
    } catch { setError('loadFailed'); return false }
    finally { busyRef.current = false; setBusy(false) }
  }

  async function removeReview() {
    const current = draftRef.current
    if (!current?.reviewContext || busyRef.current) return
    if (!await dialog.confirm({ title: t('documents.review.remove'), message: t('documents.review.removeNotice'),
      confirmLabel: t('documents.review.remove'), cancelLabel: t('common.cancel'), tone: 'danger' })) return
    if (draftRef.current === current && !busyRef.current) setDraft({ ...current, reviewContext: undefined })
  }

  const origin = draft?.origin
  const review = draft?.reviewContext
  return <ThemeDetailFrame kind="documents" title={saved?.title ?? t('documents.new')} backLabel={t('documents.title')} onBack={returnToLibrary}
    actions={<IsleButton label={t('common.save')} compact tone="primary" busy={busy} feedbackPhase={busy ? 'pending' : 'idle'}
      icon={<AppIcon name="check" size={16} color={colors.ui.control.primaryForeground} />}
      disabled={loading || !draft?.title.trim() || (!dirty && !!saved)} onPress={() => void save()} />}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets
      contentContainerStyle={styles.canvas}>
      {loading ? <Text style={{ color: colors.textSecondary }}>{t('common.loading')}</Text> : null}
      {error ? <View style={{ gap: 12 }}>
        <Text selectable accessibilityRole="alert" style={{ color: colors.text }}>{t(`documents.${error}`)}</Text>
        {draft && saved ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton label={t('documents.reload')} disabled={busy} onPress={() => void reload()} />
          <IsleButton label={t('documents.saveCopy')} disabled={busy} onPress={() => void save(true)} />
        </View> : null}
      </View> : null}
      {!loading && draft ? <>
        <View testID="document-editor-identity" style={styles.identity}>
          <Text style={[typography.label, { color: colors.textSecondary }]}>{t('documents.localSpace')}</Text>
          <IsleInput label={t('documents.documentTitle')} accessibilityLabel={t('documents.documentTitle')} testID="document-title"
            inputStyle={typography.headline} value={draft.title} editable={!busy} maxLength={DOCUMENT_TITLE_LIMIT}
            onChangeText={(title) => setDraft({ ...draft, title })} />
          <DocumentSaveStatus status={busy ? 'saving' : dirty ? 'unsaved' : 'saved'} />
        </View>
        <DocumentEditorToolbar preview={preview} onPreviewChange={setPreview} copyPhase={copyFeedback.phase} onCopy={() => void copyText()} />
        <ActionFeedback phase={copyFeedback.phase} errorLabel={t('chat.clipboardUnavailable')} testID="document-copy-feedback" />
        <View testID="document-writing-frame" style={[styles.writingFrame, { borderColor: colors.ui.semantic.chrome.border, backgroundColor: colors.ui.semantic.surface.base }]}>
        {preview ? <View testID="document-preview" style={styles.preview}>
          <Markdown onLinkPress={() => false} rules={{
            image: (node) => <Text key={node.key} style={{ color: colors.textSecondary }}>{t('documents.imageNotLoaded')}</Text>,
          }} style={{ body: { ...typography.body, color: colors.text }, code_inline: { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted }, fence: { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted } }}>
            {draft.body.slice(0, 100_000)}
          </Markdown>
          {draft.body.length > 100_000 ? <Text selectable style={{ color: colors.textSecondary }}>{t('documents.previewLimit')}</Text> : null}
          <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.previewNotice')}</Text>
        </View> : <View style={{ gap: 8 }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.body')}</Text>
          <TextInput accessibilityLabel={t('documents.body')} testID="document-body"
            value={draft.body} multiline scrollEnabled editable={!busy} maxLength={DOCUMENT_BODY_LIMIT} autoCapitalize="sentences" autoCorrect={false}
            style={[typography.body, styles.bodyInput, { height: editorHeight, color: colors.text }]}
            onChangeText={(body) => setDraft({ ...draft, body })} />
        </View>}
        </View>
        <Text selectable style={[typography.caption, { color: colors.textSecondary }]}>{t('documents.retentionNotice')}</Text>
        {origin || review ? <View style={styles.contextControls}>
          {origin ? <DocumentContextToggle testID="document-origin-toggle" open={showOrigin}
            label={t(showOrigin ? 'documents.hideOrigin' : 'documents.showOrigin')} onPress={() => setShowOrigin(!showOrigin)} /> : null}
          {review ? <DocumentContextToggle testID="document-review-toggle" open={showReview}
            label={t(showReview ? 'documents.review.hide' : 'documents.review.show')} onPress={() => setShowReview(!showReview)} /> : null}
        </View> : null}
        {origin && showOrigin ? <IsleMotionFrame role="section" testID="document-origin" style={{ gap: 12, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.semantic.chrome.border }}>
          <Text selectable style={{ color: colors.text, fontWeight: '700' }}>{t('documents.originTitle')}</Text>
          <Text selectable style={{ color: colors.textSecondary }}>{t('documents.originNotice')}</Text>
          <Text selectable style={{ color: colors.text }}>{origin.conversationTitle} · {new Date(origin.messageTimestamp).toLocaleString()}</Text>
          <Text selectable style={{ color: colors.text }}>{t(`documents.originStatus_${origin.messageStatus}`)}{origin.model ? ` · ${origin.model}` : ''}</Text>
          <Text selectable style={{ color: colors.textSecondary }}>{t(draft.body === origin.originalText ? 'documents.originUnchanged' : 'documents.originEdited')}</Text>
          <IsleButton label={t('documents.openChat')} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: origin.conversationId } })} />
          <Text selectable style={{ color: colors.text }}>{origin.originalText}</Text>
          {origin.citations.map((citation, index) => <View key={`${index}:${citation.id}`} style={{ gap: 6 }}>
            <Text selectable style={{ color: colors.text, fontWeight: '600' }}>[{index + 1}] {citation.title} · {t(`source.${citation.type}`)}</Text>
            {citation.excerpt ? <Text selectable style={{ color: colors.textSecondary }}>{citation.excerpt}</Text> : null}
            {citation.url ? <Text selectable style={{ color: colors.textSecondary }}>{citation.url}</Text> : null}
          </View>)}
        </IsleMotionFrame> : null}
        {review && showReview ? <IsleMotionFrame role="section" testID="document-review-context" style={{ gap: 12, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ui.semantic.chrome.border }}>
          <Text selectable style={{ color: colors.text, fontWeight: '700' }}>{t('documents.review.title')}</Text>
          <Text selectable style={{ color: colors.textSecondary }}>{t('documents.review.notice')}</Text>
          <Text selectable style={{ color: colors.textSecondary }}>{t('documents.review.acceptedAt', { time: new Date(review.acceptedAt).toLocaleString() })}</Text>
          <Text selectable style={{ color: colors.textSecondary }}>{t(draft.title === review.title && draft.body === review.body ? 'documents.review.matches' : 'documents.review.changed')}</Text>
          <Text selectable style={{ color: colors.text, fontWeight: '600' }}>{review.title}</Text>
          <Text selectable testID="document-review-body" style={{ color: colors.text }}>{review.body}</Text>
          {review.sources.map((source, index) => <View key={`${index}:${source.citationId}`} style={{ gap: 6 }}>
            <Text selectable style={{ color: colors.text, fontWeight: '600' }}>[S{index + 1}] {source.title} · {t(`source.${source.type}`)}</Text>
            <Text selectable style={{ color: colors.textSecondary }}>{t('documents.review.sourceVersion', { id: source.documentId ?? source.citationId, citation: source.citationId, time: new Date(source.updatedAt).toLocaleString() })}</Text>
            <Text selectable testID={`document-review-source-${index}`} style={{ color: colors.text }}>{source.text}</Text>
          </View>)}
          <IsleButton label={t('documents.review.remove')} disabled={busy} onPress={() => void removeReview()} />
        </IsleMotionFrame> : null}
        <DocumentRevisionPanel key={JSON.stringify([id, conversationId, messageId])} draft={draft} saved={saved} port={revision} disabled={busy} onAccept={acceptRevision} />
        {saved ? <View style={[styles.dangerFooter, { borderTopColor: colors.ui.semantic.chrome.border }]}>
          <IsleButton compact label={t('common.delete')} tone="danger" disabled={busy} onPress={() => void remove()} />
        </View> : null}
      </> : null}
    </ScrollView>
  </ThemeDetailFrame>
}

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value }

const styles = StyleSheet.create({
  canvas: { padding: 20, gap: 18, paddingBottom: 48, width: '100%', maxWidth: 980, alignSelf: 'center' },
  identity: { minWidth: 0, gap: 12 },
  writingFrame: { minWidth: 0, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8 },
  bodyInput: { minWidth: 0, padding: 0, textAlignVertical: 'top' },
  preview: { minWidth: 0, gap: 12 },
  contextControls: { minWidth: 0 },
  dangerFooter: { paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
})
