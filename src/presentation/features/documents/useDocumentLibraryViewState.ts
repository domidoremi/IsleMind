import { useSyncExternalStore } from 'react'
import type { DocumentRepository, DocumentSummary } from '@/modules/documents'

interface DocumentLibrarySnapshot {
  documents: readonly DocumentSummary[]
  query: string
  hasSnapshot: boolean
}

function createViewState() {
  let snapshot: DocumentLibrarySnapshot = { documents: [], query: '', hasSnapshot: false }
  const listeners = new Set<() => void>()
  const publish = (next: DocumentLibrarySnapshot) => {
    snapshot = next
    listeners.forEach(listener => listener())
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setDocuments: (documents: DocumentSummary[]) => publish({ ...snapshot, documents: [...documents], hasSnapshot: true }),
    setQuery: (query: string) => { if (snapshot.query !== query) publish({ ...snapshot, query }) },
  }
}

// Route replacement keeps only catalog summaries and search UI, never bodies or durable writes.
const viewStates = new WeakMap<DocumentRepository, ReturnType<typeof createViewState>>()

export function useDocumentLibraryViewState(repository: DocumentRepository) {
  let state = viewStates.get(repository)
  if (!state) {
    state = createViewState()
    viewStates.set(repository, state)
  }
  const snapshot = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot)
  return { ...snapshot, setDocuments: state.setDocuments, setQuery: state.setQuery }
}
