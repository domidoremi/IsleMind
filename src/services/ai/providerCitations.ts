import type { MessageCitation, ProviderType, RetrievalSource } from '@/types'

export type ProviderCitationSource = ProviderType | 'perplexity'

export function extractCitationsFromText(_text: string, sources: RetrievalSource[] = []): MessageCitation[] {
  return sources.map((source) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    excerpt: source.excerpt || source.content.slice(0, 180),
    url: source.url,
    documentId: source.documentId,
    chunkId: source.chunkId,
    score: source.score,
    ftsScore: source.ftsScore,
    vectorScore: source.vectorScore,
    chunkIndex: source.chunkIndex,
    similarityScore: source.similarityScore,
    sourceUri: source.sourceUri,
    retrievalMode: source.retrievalMode,
  }))
}

export function extractProviderCitations(json: unknown, providerType: ProviderCitationSource): MessageCitation[] {
  const citations: MessageCitation[] = []
  if (!json || typeof json !== 'object') return citations
  const value = json as Record<string, unknown>
  if (providerType === 'perplexity') {
    const searchResults = Array.isArray(value.search_results) ? value.search_results : []
    for (const result of searchResults) {
      const item = result as Record<string, unknown>
      const url = stringField(item.url)
      const title = stringField(item.title) ?? url ?? 'Perplexity Search Result'
      const excerpt = stringField(item.snippet) ?? stringField(item.content)
      citations.push({
        id: url ?? title,
        type: 'web',
        title,
        url,
        excerpt,
        sourceUri: url,
        sourceReason: 'perplexity_search_result',
      })
    }
    if (!citations.length && Array.isArray(value.citations)) {
      for (const citation of value.citations) {
        const url = typeof citation === 'string' ? citation : undefined
        if (!url) continue
        citations.push({
          id: url,
          type: 'web',
          title: url,
          url,
          sourceUri: url,
          sourceReason: 'perplexity_citation',
        })
      }
    }
  }
  if (providerType === 'anthropic') {
    const content = Array.isArray(value.content) ? value.content : []
    for (const part of content) {
      const item = part as Record<string, unknown>
      if (item.type === 'web_search_result') {
        const url = typeof item.url === 'string' ? item.url : undefined
        const title = typeof item.title === 'string' ? item.title : url || 'Web Search'
        citations.push({
          id: url || title,
          type: 'web',
          title,
          url,
          excerpt: typeof item.encrypted_content === 'string' ? undefined : typeof item.page_age === 'string' ? item.page_age : undefined,
        })
      }
    }
  }
  if (providerType === 'google') {
    const candidates = Array.isArray(value.candidates) ? value.candidates : []
    for (const candidate of candidates) {
      const metadata = (candidate as Record<string, unknown>).groundingMetadata as Record<string, unknown> | undefined
      const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : []
      for (const chunk of chunks) {
        const web = (chunk as Record<string, unknown>).web as Record<string, unknown> | undefined
        if (web?.uri || web?.title) {
          citations.push({
            id: String(web.uri || web.title),
            type: 'web',
            title: String(web.title || web.uri || 'Google Search'),
            url: web.uri ? String(web.uri) : undefined,
          })
        }
      }
    }
  }
  if (providerType === 'xiaomi-mimo') {
    const choices = Array.isArray(value.choices) ? value.choices : []
    for (const choice of choices) {
      const choiceRecord = choice as Record<string, unknown>
      const records = [
        choiceRecord.message as Record<string, unknown> | undefined,
        choiceRecord.delta as Record<string, unknown> | undefined,
        choiceRecord,
      ]
      for (const record of records) {
        const annotations = Array.isArray(record?.annotations) ? record.annotations : []
        for (const annotation of annotations) {
          const item = annotation as Record<string, unknown>
          if (item.type !== 'url_citation') continue
          const url = typeof item.url === 'string' ? item.url : undefined
          const title = typeof item.title === 'string' && item.title.trim()
            ? item.title
            : typeof item.site_name === 'string' && item.site_name.trim()
              ? item.site_name
              : url || 'MiMo Web Search'
          citations.push({
            id: url || title,
            type: 'web',
            title,
            url,
            excerpt: typeof item.summary === 'string' ? item.summary : undefined,
          })
        }
      }
    }
  }
  return citations
}

export function extractProviderCitationsFromSse(event: string, providerType: ProviderCitationSource): MessageCitation[] {
  const citations: MessageCitation[] = []
  for (const line of event.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    try {
      citations.push(...extractProviderCitations(JSON.parse(line.slice(6)), providerType))
    } catch {}
  }
  return dedupeCitations(citations)
}

export function dedupeCitations(citations: MessageCitation[]): MessageCitation[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    const key = `${citation.type}:${citation.url || citation.id || citation.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
