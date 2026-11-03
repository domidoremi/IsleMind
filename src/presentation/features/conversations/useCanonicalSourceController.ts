import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import type { KnowledgeLocalSource, KnowledgeLocalSourceReader, KnowledgeLocalSourceReference } from '@/modules/knowledge'
import type { MessageCitation } from '@/types/contextContracts'

type ReadState = { key: string } & (
  | { status: 'loading' | 'missing' | 'unlinked' | 'error' }
  | { status: 'ready'; source: KnowledgeLocalSource }
)

export function useCanonicalSourceController({ conversationId, messageId, citation, readLocalSource }: {
  conversationId: string
  messageId: string
  citation: MessageCitation
  readLocalSource: KnowledgeLocalSourceReader['readLocalSource']
}) {
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<ReadState>()
  const [expandedKey, setExpandedKey] = useState<string>()
  const key = JSON.stringify([conversationId, messageId, citation.type, citation.id, citation.documentId, citation.chunkId, refresh])
  const current = state?.key === key ? state : undefined
  const documentId = citation.documentId
  const sourceId = citation.id
  const sourceType = citation.type

  useFocusEffect(useCallback(() => {
    const controller = new AbortController()
    const reference: KnowledgeLocalSourceReference | undefined = sourceType === 'knowledge' && documentId
      ? { type: 'knowledge', documentId }
      : sourceType === 'memory' ? { type: 'memory', memoryId: sourceId, conversationId } : undefined
    setState({ key, status: reference ? 'loading' : 'unlinked' })
    if (reference) void (async () => {
      try {
        const source = await readLocalSource(reference, { signal: controller.signal })
        if (!controller.signal.aborted) setState(source ? { key, status: 'ready', source } : { key, status: 'missing' })
      } catch {
        if (!controller.signal.aborted) setState({ key, status: 'error' })
      }
    })()
    return () => controller.abort()
  }, [conversationId, documentId, key, readLocalSource, sourceId, sourceType]))

  const source = current?.status === 'ready' ? current.source : undefined
  const document = source?.type === 'knowledge' ? source.document : undefined
  const memory = source?.type === 'memory' ? source.memory : undefined
  const chunks = source?.type === 'knowledge' ? source.chunks : []
  const citedChunk = citation.chunkId ? chunks.find(chunk => chunk.id === citation.chunkId) : undefined
  const showAll = expandedKey === key || !citedChunk
  return {
    source, document, memory, chunks, citedChunk, showAll,
    status: current?.status ?? 'loading',
    updatedAt: document?.updatedAt ?? memory?.updatedAt,
    visibleChunks: showAll ? chunks : citedChunk ? [citedChunk] : [],
    toggleSections: () => setExpandedKey(showAll ? undefined : key),
    refreshSource: () => setRefresh(value => value + 1),
  }
}
