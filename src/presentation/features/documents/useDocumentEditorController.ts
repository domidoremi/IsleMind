import { useEffect, useReducer, useRef, useState } from 'react'
import { router, useLocalSearchParams, useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { Platform } from 'react-native'
import type { TextInput } from '@/components/ui/AppText'
import * as Clipboard from 'expo-clipboard'
import { useTranslation } from 'react-i18next'
import { useActionFeedback } from '@/hooks/useActionFeedback'
import { useIsleDialog } from '@/components/ui/isle'
import { useAppUpdateBlocker } from '@/hooks/useAppUpdateBlocker'
import { DocumentConflictError, documentDraftFromMessage, parseDocumentReviewContext, type DocumentDraft, type DocumentRepository, type DocumentRevisionSource, type SavedDocument } from '@/modules/documents'
import { useChatStore } from '@/store/chatStore'
import type { DocumentRevisionBase } from './DocumentRevisionPanel'
import { documentEditorViewReducer, INITIAL_DOCUMENT_EDITOR_VIEW } from './documentEditorViewState'
import { resolveDocumentDraftState } from './documentDraftState'

type WebEditorInput = TextInput & { selectionStart: number; selectionEnd: number; scrollTop: number; setSelectionRange?: (start: number, end: number) => void }

export function useDocumentEditorController(repository: DocumentRepository) {
  const { t } = useTranslation()
  const dialog = useIsleDialog()
  const navigation = useNavigation()
  const params = useLocalSearchParams<{ id?: string; conversationId?: string; messageId?: string }>()
  const id = first(params.id)
  const conversationId = first(params.conversationId)
  const messageId = first(params.messageId)
  const [draft, setDraft] = useState<DocumentDraft | null>(null)
  const [saved, setSaved] = useState<SavedDocument | null>(null)
  const [initialDraft, setInitialDraft] = useState<DocumentDraft | null>(null)
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
  const [view, dispatchView] = useReducer(documentEditorViewReducer, INITIAL_DOCUMENT_EDITOR_VIEW)
  const preview = view.mode === 'preview'
  const [writingFocused, setWritingFocused] = useState(false)
  const bodyInput = useRef<TextInput>(null)
  const bodySelection = useRef({ start: 0, end: 0 })
  const bodyScroll = useRef(0)
  const resumeWritingFocus = useRef(false)
  const { dirty, canSave, status: saveStatus } = resolveDocumentDraftState({ draft, saved, initialDraft })
  useAppUpdateBlocker(loading || dirty || busy || view.panel !== null, 'document-edit')

  useEffect(() => {
    if (id && savedRef.current?.id === id) return
    const controller = new AbortController()
    setDraft(null)
    setSaved(null)
    setInitialDraft(null)
    setLoading(true)
    setError(null)
    dispatchView({ type: 'reset' })
    setWritingFocused(false)
    resumeWritingFocus.current = false
    bodySelection.current = { start: 0, end: 0 }
    bodyScroll.current = 0
    void (async () => {
      if (id) {
        const document = await repository.get(id, { signal: controller.signal })
        if (controller.signal.aborted) return
        if (!document) throw new Error('Missing document')
        setSaved(document)
        setInitialDraft(document)
        setDraft(document)
      } else if (conversationId || messageId) {
        const findSource = () => useChatStore.getState().conversations.find((item) => item.id === conversationId)
        if (!findSource()?.messages.some((item) => item.id === messageId)) await useChatStore.getState().loadAll()
        if (controller.signal.aborted) return
        const conversation = findSource()
        const message = conversation?.messages.find((item) => item.id === messageId)
        if (!conversation || !message) throw new Error('Missing source')
        const imported = documentDraftFromMessage(conversation, message)
        setInitialDraft(imported)
        setDraft(imported)
      } else {
        const blank = { title: t('documents.untitled'), body: '' }
        setInitialDraft(blank)
        setDraft(blank)
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
    void dialog.confirm({ title: t('documents.discardTitle'), message: t(saved ? 'documents.discardMessage' : 'documents.discardNewMessage'),
      confirmLabel: t('documents.discard'), cancelLabel: t('common.cancel'), tone: 'danger' })
      .then((confirmed) => { if (confirmed) navigation.dispatch(data.action) })
  })
  useEffect(() => {
    if (Platform.OS !== 'web' || (!dirty && !busy)) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])

  function changePreview(next: boolean) {
    if (next === preview) return
    if (next) {
      if (Platform.OS === 'web' && bodyInput.current) {
        const element = bodyInput.current as WebEditorInput
        bodySelection.current = { start: element.selectionStart, end: element.selectionEnd }
        bodyScroll.current = element.scrollTop
      }
      bodyInput.current?.blur()
      setWritingFocused(false)
    } else resumeWritingFocus.current = true
    dispatchView({ type: 'mode', mode: next ? 'preview' : 'write' })
  }

  useEffect(() => {
    if (preview || !resumeWritingFocus.current) return
    resumeWritingFocus.current = false
    const frame = requestAnimationFrame(() => {
      const input = bodyInput.current
      if (!input) return
      input.focus()
      const length = draftRef.current?.body.length ?? 0
      const start = Math.min(bodySelection.current.start, length)
      const end = Math.min(bodySelection.current.end, length)
      if (Platform.OS === 'web') {
        const element = input as WebEditorInput
        element.setSelectionRange?.(start, end)
        element.scrollTop = bodyScroll.current
      } else input.setSelection?.(start, end)
    })
    return () => cancelAnimationFrame(frame)
  }, [preview, id, conversationId, messageId, repository])

  function returnToLibrary() { router.replace('/documents') }
  function returnFromEditor() {
    if (router.canGoBack()) { router.back(); return }
    if (conversationId && messageId) { router.replace({ pathname: '/chat/[id]', params: { id: conversationId } }); return }
    returnToLibrary()
  }
  function failure(reason: unknown) { setError(reason instanceof DocumentConflictError ? 'conflict' : 'saveFailed') }

  async function save(asCopy = false) {
    if (!draft || busyRef.current || !draft.title.trim() || (!asCopy && !canSave)) return
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
    if (!draft?.body.length) return
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
      if (sources) dispatchView({ type: 'open-panel', panel: 'sources', sourceTab: 'review' })
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

  return {
    id, conversationId, messageId, draft, saved, setDraft, dirty, canSave, saveStatus, loading, error, busy,
    view, dispatchView, preview, changePreview, writingFocused, setWritingFocused,
    bodyInput, bodySelection, bodyScroll, copyFeedback,
    save, reload, remove, copyText, acceptRevision, removeReview, returnFromEditor,
  }
}

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value }
