import { useSyncExternalStore } from 'react'
import type { DocumentRepository, DocumentSummary } from '@/modules/documents'

interface DocumentLibrarySnapshot {
  documents: readonly DocumentSummary[]
  query: string
  hasSnapshot: boolean
  sort: DocumentLibrarySort
  openedId?: string
}

export type DocumentLibrarySort = 'updated' | 'title'

function createViewState() {
  let snapshot: DocumentLibrarySnapshot = { documents: [], query: '', hasSnapshot: false, sort: 'updated' }
  let scrollOffset = 0
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
    setQuery: (query: string) => {
      if (snapshot.query === query) return
      scrollOffset = 0
      publish({ ...snapshot, query })
    },
    setSort: (sort: DocumentLibrarySort) => {
      if (snapshot.sort === sort) return
      scrollOffset = 0
      publish({ ...snapshot, sort })
    },
    setOpenedId: (openedId: string) => publish({ ...snapshot, openedId }),
    getScrollOffset: () => scrollOffset,
    setScrollOffset: (offset: number) => { scrollOffset = Math.max(0, Number.isFinite(offset) ? offset : 0) },
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
  return { ...snapshot, setDocuments: state.setDocuments, setQuery: state.setQuery, setSort: state.setSort,
    setOpenedId: state.setOpenedId, getScrollOffset: state.getScrollOffset, setScrollOffset: state.setScrollOffset }
}
