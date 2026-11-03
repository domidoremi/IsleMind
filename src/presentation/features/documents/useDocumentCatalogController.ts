import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { FlatList } from 'react-native'
import type { DocumentRepository } from '@/modules/documents'
import { buildDocumentCatalogRows, selectDocumentSummaries, type DocumentCatalogRow } from './documentLibraryPresentation'
import { useDocumentLibraryViewState } from './useDocumentLibraryViewState'

export function useDocumentCatalogController(repository: DocumentRepository) {
  const { i18n } = useTranslation()
  const state = useDocumentLibraryViewState(repository)
  const { documents, query, sort, hasSnapshot, setDocuments, getScrollOffset, setScrollOffset } = state
  const list = useRef<FlatList<DocumentCatalogRow>>(null)
  const restoreOffset = useRef<number | null>(getScrollOffset())
  const viewportHeight = useRef(0)
  const contentHeight = useRef(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const retainingRows = hasSnapshot && documents.length > 0
  const language = i18n?.language ?? 'zh-CN'
  const visible = useMemo(() => selectDocumentSummaries(documents, query, sort, language), [documents, query, sort, language])
  const rows = useMemo(() => buildDocumentCatalogRows(visible, sort, language, Date.now()), [visible, sort, language])

  useEffect(() => { restoreOffset.current = getScrollOffset() }, [repository, getScrollOffset])
  useFocusEffect(useCallback(() => {
    const controller = new AbortController()
    setStatus('loading')
    void repository.list({ signal: controller.signal }).then(values => {
      if (controller.signal.aborted) return
      setDocuments(values); setStatus('ready')
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [repository, attempt, setDocuments]))

  function resetScroll() {
    restoreOffset.current = null
    setScrollOffset(0)
    list.current?.scrollToOffset({ offset: 0, animated: false })
  }
  function restoreScroll() {
    if (!retainingRows || restoreOffset.current === null || viewportHeight.current <= 0 || contentHeight.current <= 0) return
    const offset = Math.min(restoreOffset.current, Math.max(0, contentHeight.current - viewportHeight.current))
    restoreOffset.current = null
    list.current?.scrollToOffset({ offset, animated: false })
  }

  return {
    ...state, rows, visible, language, list, status, retainingRows,
    retry: () => setAttempt(value => value + 1),
    changeQuery: (value: string) => { state.setQuery(value); resetScroll() },
    changeSort: (value: typeof sort) => { if (value !== sort) { state.setSort(value); resetScroll() } },
    onViewport: (height: number) => { viewportHeight.current = height; restoreScroll() },
    onContent: (height: number) => { contentHeight.current = height; restoreScroll() },
    onScroll: (offset: number) => { if (restoreOffset.current === null) setScrollOffset(offset) },
  }
}
