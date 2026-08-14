export interface KnowledgeRerankableSource {
  title: string
  content: string
  score?: number
  ftsScore?: number
  chunkIndex?: number
  createdAt?: number
}

export interface KnowledgeRerankedSource {
  score: number
  similarityScore: number
}

/**
 * Provider- and storage-independent local reranking policy. Adapters supply
 * candidates with their raw FTS/vector scores; this policy owns the stable
 * ordering signal exposed to context assembly.
 */
export function rerankKnowledgeSources<Source extends KnowledgeRerankableSource>(
  query: string,
  sources: readonly Source[],
  limit: number,
): Array<Source & KnowledgeRerankedSource> {
  const queryTokens = tokenizeForRerank(query)
  const now = Date.now()
  const bm25Values = sources.map((source) => Math.abs(source.ftsScore ?? source.score ?? 0))
  const maxBm25 = Math.max(1, ...bm25Values)
  return sources
    .map((source) => {
      const bm25Normalized = 1 - Math.min(Math.abs(source.ftsScore ?? source.score ?? 0) / maxBm25, 1)
      const overlap = jaccard(queryTokens, tokenizeForRerank(`${source.title} ${source.content}`))
      const position = 1 / (1 + Math.max(0, source.chunkIndex ?? 0))
      const ageDays = Math.max(0, (now - inferCreatedAt(source)) / 86400000)
      const recency = Math.exp(-ageDays / 30)
      const length = lengthFitness(source.content.length)
      const score =
        0.4 * bm25Normalized +
        0.25 * overlap +
        0.15 * position +
        0.1 * recency +
        0.1 * length
      return { ...source, score, similarityScore: score }
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit))
}

function tokenizeForRerank(text: string): Set<string> {
  const lower = text.toLowerCase()
  const tokens = new Set<string>()
  for (const word of lower.match(/[a-z0-9_]+(?:[-'][a-z0-9_]+)?/g) ?? []) {
    if (word.length >= 2) tokens.add(word)
  }
  const cjk = lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []
  for (let index = 0; index < cjk.length - 1; index += 1) tokens.add(`${cjk[index]}${cjk[index + 1]}`)
  return tokens
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function lengthFitness(length: number): number {
  if (length < 120) return Math.max(0.2, length / 120)
  if (length <= 1400) return 1
  return Math.max(0.35, 1 - (length - 1400) / 2400)
}

function inferCreatedAt(source: KnowledgeRerankableSource): number {
  return typeof source.createdAt === 'number' ? source.createdAt : Date.now()
}
