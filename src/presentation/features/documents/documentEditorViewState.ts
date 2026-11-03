export type DocumentEditorPanel = 'sources' | 'revision' | 'details'
export type DocumentSourceTab = 'origin' | 'review'

export interface DocumentEditorViewState {
  mode: 'write' | 'preview'
  panel: DocumentEditorPanel | null
  sourceTab: DocumentSourceTab
}

export type DocumentEditorViewAction =
  | { type: 'mode'; mode: DocumentEditorViewState['mode'] }
  | { type: 'toggle-panel'; panel: DocumentEditorPanel }
  | { type: 'open-panel'; panel: DocumentEditorPanel; sourceTab?: DocumentSourceTab }
  | { type: 'source-tab'; tab: DocumentSourceTab }
  | { type: 'close-panel' }
  | { type: 'reset' }

export const INITIAL_DOCUMENT_EDITOR_VIEW: DocumentEditorViewState = {
  mode: 'write',
  panel: null,
  sourceTab: 'origin',
}

export function documentEditorViewReducer(state: DocumentEditorViewState, action: DocumentEditorViewAction): DocumentEditorViewState {
  switch (action.type) {
    case 'mode':
      return action.mode === state.mode ? state : { ...state, mode: action.mode }
    case 'toggle-panel':
      return { ...state, panel: state.panel === action.panel ? null : action.panel }
    case 'open-panel':
      return { ...state, panel: action.panel, sourceTab: action.sourceTab ?? state.sourceTab }
    case 'source-tab':
      return { ...state, panel: 'sources', sourceTab: action.tab }
    case 'close-panel':
      return state.panel === null ? state : { ...state, panel: null }
    case 'reset':
      return INITIAL_DOCUMENT_EDITOR_VIEW
  }
}
