import type { RetrievalSource } from '@/types'

export interface KnowledgeScope {
  ids: Set<string>
  terms: string[]
}

export function buildKnowledgeScope(values?: string[]): KnowledgeScope | undefined {
  const normalized = Array.from(new Set((values ?? []).map((value) => normalizeScopeValue(value)).filter(Boolean)))
  if (!normalized.length) return undefined
  return {
    ids: new Set(normalized),
    terms: normalized,
  }
}

export function filterKnowledgeSources(sources: RetrievalSource[], scope?: KnowledgeScope): RetrievalSource[] {
  if (!scope) return sources
  return sources.filter((source) => {
    const documentId = normalizeScopeValue(source.documentId)
    if (documentId && scope.ids.has(documentId)) return true
    const title = normalizeScopeValue(source.title)
    return scope.terms.some((term) => title.includes(term))
  })
}

function normalizeScopeValue(value?: string): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}
