import {
  createProviderCitationSupportBinder,
  mergeProviderCitationSupport,
  parseProviderCitationPassage,
  PROVIDER_CITATION_SUPPORT_LIMITS,
  type ProviderCitationPassage,
  type ProviderCitationSupport,
} from '@/core'
import { asRecord } from './providerJsonPolicy'
import { visitProviderSseData } from './providerSseData'

export type ProviderCitationType = 'memory' | 'knowledge' | 'web'
export type ProviderCitationSource = string

export interface ProviderCitation {
  id: string
  type: ProviderCitationType
  title: string
  excerpt?: string
  url?: string
  documentId?: string
  chunkId?: string
  score?: number
  ftsScore?: number
  vectorScore?: number
  chunkIndex?: number
  similarityScore?: number
  sourceUri?: string
  retrievalMode?: 'fts' | 'vector' | 'hybrid'
  rerankScore?: number
  compressionRatio?: number
  sourceReason?: string
  headingPath?: string[]
  semanticBoundary?: string
  qualityScore?: number
  queryVariant?: string
  retrievalStage?: string
  providerSupport?: ProviderCitationSupport
}

export interface ProviderRetrievalSource extends ProviderCitation {
  content: string
}

export function extractCitationsFromText(
  _text: string,
  sources: readonly ProviderRetrievalSource[] = [],
): ProviderCitation[] {
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

export function extractProviderCitations(json: unknown, providerType: ProviderCitationSource, answerText?: string): ProviderCitation[] {
  if (providerType === 'google') {
    const collector = createProviderCitationCollector(providerType)
    collector.addJson(json)
    return collector.finish(answerText)
  }
  const citations: ProviderCitation[] = []
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

export function extractProviderCitationsFromSse(event: string, providerType: ProviderCitationSource, answerText?: string): ProviderCitation[] {
  const collector = createProviderCitationCollector(providerType)
  collector.addSse(event)
  return collector.finish(answerText)
}

export function dedupeCitations(citations: ProviderCitation[]): ProviderCitation[] {
  return mergeCitationsBy(citations, (citation) => `${citation.type}:${citation.url || citation.id || citation.title}`)
}

/** Continuations may extend support, but differing captured identities remain ambiguous. */
export function mergeIdenticalProviderCitations(citations: ProviderCitation[]): ProviderCitation[] {
  return mergeCitationsBy(citations, ({ providerSupport: _support, ...citation }) => JSON.stringify(citation))
}

function mergeCitationsBy(citations: ProviderCitation[], keyFor: (citation: ProviderCitation) => string): ProviderCitation[] {
  const result = new Map<string, ProviderCitation>()
  for (const citation of citations) {
    const key = keyFor(citation)
    const previous = result.get(key)
    if (!previous) result.set(key, citation)
    else if (previous.providerSupport || citation.providerSupport) {
      const providerSupport = mergeProviderCitationSupport(previous.providerSupport, citation.providerSupport)
      result.set(key, { ...previous, providerSupport })
    }
  }
  return [...result.values()]
}

export interface ProviderCitationCollector {
  addJson(json: unknown): void
  /** Complete SSE events, or an EOF remainder; not arbitrary transport fragments. */
  addSse(event: string): void
  /** Bind only to the final visible answer, after thinking/tool text filtering. */
  finish(answerText?: string): ProviderCitation[]
}

const MAX_GROUNDING_SLOTS = 128
const MAX_GROUNDING_SUPPORTS = 64
const MAX_SUPPORT_SOURCE_INDICES = 16
const MAX_GROUNDING_TEXT_CHARS = 32_768

/** Request-scoped: Google sends new chunks but support indices span ALL stream responses. */
export function createProviderCitationCollector(providerType: ProviderCitationSource): ProviderCitationCollector {
  const slots: Array<ProviderCitation | undefined> = []
  const declarations: Array<{ passage: ProviderCitationPassage; indices: number[] }> = []
  let supportCount = 0
  let supportChars = 0
  let associationsComplete = true
  let selectedCandidateIndex: number | undefined
  let candidateDiscontinuity = false
  let otherCitations: ProviderCitation[] = []

  function addJson(json: unknown): void {
    if (providerType !== 'google') {
      otherCitations = dedupeCitations([...otherCitations, ...extractProviderCitations(json, providerType)])
      return
    }
    const value = asRecord(json)
    if (!value || (value.candidates !== undefined && !Array.isArray(value.candidates))) {
      associationsComplete = false
      return
    }
    // Same candidate as extractGoogleText / the stream text parser. Never flatten peers.
    const candidate = asRecord(Array.isArray(value?.candidates) ? value.candidates[0] : undefined)
    if (!candidate || candidateDiscontinuity) {
      if (Array.isArray(value.candidates) && value.candidates.length) associationsComplete = false
      return
    }
    const candidateIndex = candidate.index === undefined ? 0 : candidate.index
    if (typeof candidateIndex !== 'number' || !Number.isInteger(candidateIndex) || candidateIndex < 0 ||
      (selectedCandidateIndex !== undefined && selectedCandidateIndex !== candidateIndex)) {
      // Text parsing selects the first item. A changing candidate identity cannot
      // share one cumulative grounding index space, so discard this unknown map.
      candidateDiscontinuity = true
      slots.length = 0
      declarations.length = 0
      return
    }
    selectedCandidateIndex = candidateIndex
    const metadata = asRecord(candidate?.groundingMetadata)
    if ((candidate.groundingMetadata !== undefined && !metadata) ||
      (metadata?.groundingChunks !== undefined && !Array.isArray(metadata.groundingChunks))) associationsComplete = false
    const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : []
    for (const chunk of chunks.slice(0, MAX_GROUNDING_SLOTS - slots.length)) {
      const web = asRecord(asRecord(chunk)?.web)
      const url = boundedString(web?.uri, 8_192)
      const title = boundedString(web?.title, 1_024) ?? url
      // Unsupported/malformed slots still count. Never shift later source indices.
      slots.push(title ? { id: url ?? title, type: 'web', title, url } : undefined)
    }
    if (!associationsComplete) return
    const supports = Array.isArray(metadata?.groundingSupports) ? metadata.groundingSupports : []
    for (const support of supports.slice(0, Math.max(0, MAX_GROUNDING_SUPPORTS - supportCount))) {
      supportCount += 1
      const record = asRecord(support)
      const segment = asRecord(record?.segment)
      const passage = parseProviderCitationPassage({
        text: segment?.text, partIndex: segment?.partIndex === undefined ? 0 : segment.partIndex,
        startByte: segment?.startIndex === undefined ? 0 : segment.startIndex, endByte: segment?.endIndex,
      })
      if (!passage || supportChars + passage.text.length > MAX_GROUNDING_TEXT_CHARS ||
        !Array.isArray(record?.groundingChunkIndices)) continue
      const indices = record.groundingChunkIndices.slice(0, MAX_SUPPORT_SOURCE_INDICES)
        .filter((index): index is number => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < MAX_GROUNDING_SLOTS)
      if (!indices.length) continue
      declarations.push({ passage, indices: [...new Set(indices)] })
      supportChars += passage.text.length
    }
  }

  function addSse(event: string): void {
    const append = (payload: string): boolean => {
      try { addJson(JSON.parse(payload)); return true } catch { return false }
    }
    const { sawDataLine, malformedData } = visitProviderSseData(event, append)
    if (malformedData || (!sawDataLine && event.trim().startsWith('{') && !append(event.trim()))) {
      // An unreadable response may have introduced chunks. Continuing its
      // cumulative index space would silently bind later indices to wrong URLs.
      associationsComplete = false
      declarations.length = 0
    }
  }

  function finish(answerText?: string): ProviderCitation[] {
    if (providerType !== 'google') return otherCitations
    const citations = dedupeCitations(slots.filter((citation): citation is ProviderCitation => Boolean(citation)))
    if (!associationsComplete || !answerText || answerText.length > PROVIDER_CITATION_SUPPORT_LIMITS.answerChars) return citations
    const passagesById = new Map<string, ProviderCitationPassage[]>()
    let retainedChars = 0
    for (const { passage, indices } of declarations) {
      if (!answerText.includes(passage.text)) continue
      // A title-only entry is captured, but is not a stable source identity.
      const sourceIds = new Set(indices.map((index) => slots[index]?.url).filter((id): id is string => Boolean(id)))
      for (const id of sourceIds) {
        const passages = passagesById.get(id) ?? []
        if (passages.length >= PROVIDER_CITATION_SUPPORT_LIMITS.passages ||
          passages.reduce((chars, item) => chars + item.text.length, 0) + passage.text.length > PROVIDER_CITATION_SUPPORT_LIMITS.totalPassageChars ||
          retainedChars + passage.text.length > MAX_GROUNDING_TEXT_CHARS ||
          passages.some((existing) => JSON.stringify(existing) === JSON.stringify(passage))) continue
        passages.push(passage)
        passagesById.set(id, passages)
        retainedChars += passage.text.length
      }
    }
    const bindSupport = createProviderCitationSupportBinder(answerText)
    return citations.map((citation) => {
      const providerSupport = bindSupport(citation.url ? passagesById.get(citation.url) ?? [] : [])
      return providerSupport ? { ...citation, providerSupport } : citation
    })
  }

  return { addJson, addSse, finish }
}

function boundedString(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' && value.length <= limit ? stringField(value) : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
