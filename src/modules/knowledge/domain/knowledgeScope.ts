export interface KnowledgeScope {
  readonly ids: ReadonlySet<string>
  readonly terms: readonly string[]
}

export interface KnowledgeScopedSource {
  documentId?: string
  title?: string
}

/** Creates the normalized document/title scope used by retrieval strategies. */
export function buildKnowledgeScope(values?: readonly string[]): KnowledgeScope | undefined {
  const normalized = Array.from(new Set((values ?? [])
    .map(normalizeScopeValue)
    .filter(Boolean)))
  if (!normalized.length) return undefined
  return {
    ids: new Set(normalized),
    terms: normalized,
  }
}

/** Retains a result when its document ID or title belongs to the requested scope. */
export function filterKnowledgeSources<Source extends KnowledgeScopedSource>(
  sources: readonly Source[],
  scope?: KnowledgeScope,
): Source[] {
  if (!scope) return [...sources]
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
