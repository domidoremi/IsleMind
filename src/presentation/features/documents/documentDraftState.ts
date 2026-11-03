import type { DocumentDraft, SavedDocument } from '@/modules/documents'

export type DocumentSaveState = 'new' | 'unsaved' | 'saved'

export function resolveDocumentDraftState({ draft, saved, initialDraft }: {
  draft: DocumentDraft | null
  saved: SavedDocument | null
  initialDraft: DocumentDraft | null
}) {
  if (!draft) return { dirty: false, canSave: false, status: 'new' as DocumentSaveState }
  const baseline = saved ?? initialDraft
  const edited = !!baseline && (
    draft.title !== baseline.title
    || draft.body !== baseline.body
    || draft.reviewContext !== baseline.reviewContext
  )
  // Imported/accepted content needs protection even before the first user edit.
  const retained = !saved && (draft.body.length > 0 || !!draft.origin || !!draft.reviewContext)
  const dirty = edited || retained
  const status: DocumentSaveState = dirty ? 'unsaved' : saved ? 'saved' : 'new'
  return { dirty, canSave: !!draft.title.trim() && dirty, status }
}
