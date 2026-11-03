import { resolveDocumentDraftState } from './documentDraftState'
import type { DocumentDraft, SavedDocument } from '@/modules/documents'

const blank: DocumentDraft = { title: 'Untitled document', body: '' }
const saved = { ...blank, id: 'saved', body: 'Stored text' } as SavedDocument

it('distinguishes an untouched new draft from a saved document', () => {
  expect(resolveDocumentDraftState({ draft: blank, saved: null, initialDraft: blank })).toEqual({
    dirty: false, canSave: false, status: 'new',
  })
  expect(resolveDocumentDraftState({ draft: saved, saved, initialDraft: saved })).toEqual({
    dirty: false, canSave: false, status: 'saved',
  })
})

it.each([
  { ...blank, body: 'A real draft' },
  { ...blank, body: ' ' },
  { ...blank, title: 'An intentional title' },
])('protects unsaved bytes or an edited title', draft => {
  expect(resolveDocumentDraftState({ draft, saved: null, initialDraft: blank })).toEqual({
    dirty: true, canSave: true, status: 'unsaved',
  })
})

it('recognizes an undo to the pristine baseline without discarding the baseline title', () => {
  expect(resolveDocumentDraftState({ draft: { ...blank }, saved: null, initialDraft: blank }).dirty).toBe(false)
  expect(resolveDocumentDraftState({ draft: { ...saved }, saved, initialDraft: blank }).dirty).toBe(false)
})

it('protects an imported answer even without a user edit', () => {
  const imported = { ...blank, origin: { originalText: 'Imported answer' } } as DocumentDraft
  expect(resolveDocumentDraftState({ draft: imported, saved: null, initialDraft: imported }).dirty).toBe(true)
})

it('protects accepted revisions and refuses a blank title without losing dirty state', () => {
  expect(resolveDocumentDraftState({ draft: { ...saved, title: ' ', body: 'Accepted revision' }, saved, initialDraft: saved })).toEqual({
    dirty: true, canSave: false, status: 'unsaved',
  })
})
