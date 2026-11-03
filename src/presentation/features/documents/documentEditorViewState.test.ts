import { documentEditorViewReducer, INITIAL_DOCUMENT_EDITOR_VIEW } from './documentEditorViewState'

it('switches writing/preview without closing the current contextual task', () => {
  const state = documentEditorViewReducer(INITIAL_DOCUMENT_EDITOR_VIEW, { type: 'open-panel', panel: 'revision' })
  expect(documentEditorViewReducer(state, { type: 'mode', mode: 'preview' })).toEqual({ ...state, mode: 'preview' })
  expect(documentEditorViewReducer(state, { type: 'mode', mode: 'write' })).toBe(state)
})

it('replaces rather than accumulates open panels and retains the chosen source tab', () => {
  const sources = documentEditorViewReducer(INITIAL_DOCUMENT_EDITOR_VIEW, { type: 'source-tab', tab: 'review' })
  const details = documentEditorViewReducer(sources, { type: 'toggle-panel', panel: 'details' })
  expect(details).toEqual({ mode: 'write', panel: 'details', sourceTab: 'review' })
  expect(documentEditorViewReducer(details, { type: 'toggle-panel', panel: 'details' }).panel).toBeNull()
  expect(documentEditorViewReducer(details, { type: 'open-panel', panel: 'sources' }).sourceTab).toBe('review')
})

it('resets view state only for a new editor identity', () => {
  const modified = { mode: 'preview', panel: 'revision', sourceTab: 'review' } as const
  expect(documentEditorViewReducer(modified, { type: 'reset' })).toBe(INITIAL_DOCUMENT_EDITOR_VIEW)
  expect(documentEditorViewReducer(INITIAL_DOCUMENT_EDITOR_VIEW, { type: 'close-panel' })).toBe(INITIAL_DOCUMENT_EDITOR_VIEW)
})
