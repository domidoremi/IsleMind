import { useEffect, useRef, useState } from 'react'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { Platform, ScrollView, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-native-markdown-display'
import { IsleButton, IsleInput, useIsleDialog } from '@/components/ui/isle'
import { useAppTheme } from '@/hooks/useAppTheme'
import { DOCUMENT_BODY_LIMIT, DOCUMENT_TITLE_LIMIT, DocumentConflictError, documentDraftFromMessage, type DocumentDraft, type DocumentRepository, type DocumentRevisionPort, type SavedDocument } from '@/modules/documents'
import { ThemeDetailFrame } from '@/presentation/app-shell/ThemeDetailFrame'
import { useChatStore } from '@/store/chatStore'
import { DocumentRevisionPanel, type DocumentRevisionBase } from './DocumentRevisionPanel'

export default function DocumentEditorScreen({ repository, revision }: { repository: DocumentRepository; revision: DocumentRevisionPort }) {
  const { t } = useTranslation()
  const { colors } = useAppTheme()
  const dialog = useIsleDialog()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ id?: string; conversationId?: string; messageId?: string }>()
  const id = first(params.id)
  const conversationId = first(params.conversationId)
  const messageId = first(params.messageId)
  const [draft, setDraft] = useState<DocumentDraft | null>(null)
  const [saved, setSaved] = useState<SavedDocument | null>(null)
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
  const dirty = !!draft && (!saved || draft.title !== saved.title || draft.body !== saved.body)

  useEffect(() => {
    if (id && savedRef.current?.id === id) return
    const controller = new AbortController()
    setDraft(null)
    setSaved(null)
    setLoading(true)
    setError(null)
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
        ? await repository.save(saved.id, saved.revision, draft)
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
    const copied = await Clipboard.setStringAsync(draft.body).catch(() => false)
    dialog.toast({ title: t(copied ? 'common.copied' : 'chat.clipboardUnavailable'),
      message: copied ? t('documents.copyNotice') : undefined, tone: copied ? 'mint' : 'amber' })
  }

  async function acceptRevision(base: DocumentRevisionBase, body: string): Promise<boolean> {
    if (busyRef.current || draftRef.current !== base.draft || savedRef.current !== base.saved) return false
    busyRef.current = true; setBusy(true)
    try {
      if (base.saved) {
        const current = await repository.get(base.saved.id)
        if (!current || current.revision !== base.saved.revision) { setError('conflict'); return false }
      }
      if (draftRef.current !== base.draft || savedRef.current !== base.saved) return false
      // Acceptance edits only the unsaved draft. The independent Save operation
      // still compares durable revisions and preserves the immutable origin.
      setDraft({ ...base.draft, body })
      return true
    } catch { setError('loadFailed'); return false }
    finally { busyRef.current = false; setBusy(false) }
  }

  const origin = draft?.origin
  return <ThemeDetailFrame kind="documents" title={saved?.title ?? t('documents.new')} backLabel={t('documents.title')} onBack={returnToLibrary}
    actions={<IsleButton label={t('common.save')} compact tone="primary" busy={busy} disabled={loading || !draft?.title.trim() || (!dirty && !!saved)} onPress={() => void save()} />}>
    <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 48, width: '100%', maxWidth: 980, alignSelf: 'center' }}>
      {loading ? <Text style={{ color: colors.textSecondary }}>{t('common.loading')}</Text> : null}
      {error ? <View style={{ gap: 12 }}>
        <Text selectable accessibilityRole="alert" style={{ color: colors.text }}>{t(`documents.${error}`)}</Text>
        {draft && saved ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton label={t('documents.reload')} disabled={busy} onPress={() => void reload()} />
          <IsleButton label={t('documents.saveCopy')} disabled={busy} onPress={() => void save(true)} />
        </View> : null}
      </View> : null}
      {!loading && draft ? <>
        <Text selectable style={{ color: colors.textSecondary }}>{t('documents.retentionNotice')}</Text>
        <Text testID="document-save-status" accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>
          {t(busy ? 'documents.saving' : dirty ? 'documents.unsaved' : 'documents.saved')}
        </Text>
        <IsleInput label={t('documents.documentTitle')} accessibilityLabel={t('documents.documentTitle')} testID="document-title"
          value={draft.title} editable={!busy} maxLength={DOCUMENT_TITLE_LIMIT} onChangeText={(title) => setDraft({ ...draft, title })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <IsleButton label={t(preview ? 'documents.edit' : 'documents.preview')} onPress={() => setPreview(!preview)} />
          <IsleButton label={t('documents.copyText')} onPress={() => void copyText()} />
          {origin ? <IsleButton label={t(showOrigin ? 'documents.hideOrigin' : 'documents.showOrigin')} onPress={() => setShowOrigin(!showOrigin)} /> : null}
          {saved ? <IsleButton label={t('common.delete')} tone="danger" disabled={busy} onPress={() => void remove()} /> : null}
        </View>
        {preview ? <View testID="document-preview">
          <Markdown onLinkPress={() => false} rules={{
            image: (node) => <Text key={node.key} style={{ color: colors.textSecondary }}>{t('documents.imageNotLoaded')}</Text>,
          }} style={{ body: { color: colors.text, fontSize: 16 }, code_inline: { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted }, fence: { color: colors.text, backgroundColor: colors.ui.semantic.surface.muted } }}>
            {draft.body.slice(0, 100_000)}
          </Markdown>
          {draft.body.length > 100_000 ? <Text selectable style={{ color: colors.textSecondary }}>{t('documents.previewLimit')}</Text> : null}
          <Text selectable style={{ color: colors.textSecondary }}>{t('documents.previewNotice')}</Text>
        </View> : <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{t('documents.body')}</Text>
          <TextInput accessibilityLabel={t('documents.body')} testID="document-body"
            value={draft.body} multiline scrollEnabled editable={!busy} maxLength={DOCUMENT_BODY_LIMIT} autoCapitalize="sentences" autoCorrect={false}
            style={{ height: 320, padding: 12, textAlignVertical: 'top', fontSize: 16, lineHeight: 24, color: colors.text,
              borderWidth: 1, borderRadius: 8, borderColor: colors.ui.semantic.chrome.border, backgroundColor: colors.ui.semantic.surface.base }}
            onChangeText={(body) => setDraft({ ...draft, body })} />
        </View>}
        {origin && showOrigin ? <View testID="document-origin" style={{ gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.ui.semantic.chrome.border }}>
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
        </View> : null}
        <DocumentRevisionPanel key={JSON.stringify([id, conversationId, messageId])} draft={draft} saved={saved} port={revision} disabled={busy} onAccept={acceptRevision} />
      </> : null}
    </ScrollView>
  </ThemeDetailFrame>
}

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value }
