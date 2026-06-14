import * as FileSystem from 'expo-file-system/legacy'
import type {
  KnowledgeChunk,
  Language,
  RagContextPack,
  RagEvaluationResult,
  RagGenerationVerification,
  RagProfile,
  RagQueryComplexity,
  RagQueryIntent,
  RagQueryPlan,
  RagRetrievalCandidate,
  RagRetrievalOrigin,
  RagRerankResult,
  RagRiskLevel,
  RagTechnique,
  RagTraceStep,
  RetrievalSource,
  Settings,
} from '@/types'
import {
  resolveActiveLocalEmbeddingModel,
  markLocalEmbeddingModelFailure,
  type LocalEmbeddingModel,
  type LocalEmbeddingTokenizer,
} from '@/services/localEmbeddingModels'
import { lazyEmbedding } from '@/services/lazyEmbedding'

export interface SentenceChunk {
  content: string
  sentenceStart: number
  sentenceEnd: number
}

export interface EmbeddingProvider {
  id: 'hash' | 'provider' | 'onnx'
  dimension: number
  embed: (text: string) => Promise<number[]>
  available: () => Promise<boolean>
}

export interface RagRetrievalOptions {
  signal?: AbortSignal
}

export interface AgenticRagOptions {
  query: string
  conversationTitle?: string
  systemPrompt?: string
  settings: Settings
  profile?: RagProfile
  profileReason?: string
  memorySources?: RetrievalSource[]
  retrieveKnowledge: (query: string, limit: number, options?: RagRetrievalOptions) => Promise<RetrievalSource[]>
  retrieveAgentic?: (query: string, plan: RagQueryPlan, limit: number, options?: RagRetrievalOptions) => Promise<RetrievalSource[]>
  now?: () => number
  tokenBudget?: number
  maxContextItems?: number
  signal?: AbortSignal
}

const TARGET_CHUNK_LENGTH = 1200
const MAX_CHUNK_LENGTH = 1600
const OVERLAP_SENTENCES = 2
const DEFAULT_CONTEXT_TOKEN_BUDGET = 2800
const DEFAULT_MAX_CONTEXT_ITEMS = 8

export async function runAgenticRag(options: AgenticRagOptions): Promise<RagContextPack> {
  throwIfAgenticRagCancelled(options.signal)
  const now = options.now?.() ?? Date.now()
  const trace: RagTraceStep[] = []
  const planStarted = now
  const plan = createRagQueryPlan({
    query: options.query,
    conversationTitle: options.conversationTitle,
    systemPrompt: options.systemPrompt,
    settings: options.settings,
    profile: options.profile,
    profileReason: options.profileReason,
    now,
    tokenBudget: options.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET,
    maxContextItems: options.maxContextItems ?? DEFAULT_MAX_CONTEXT_ITEMS,
  })
  trace.push(completeRagTrace({
    id: `${plan.id}-plan`,
    stage: 'plan',
    title: 'RAG plan',
    status: 'done',
    startedAt: planStarted,
    content: `${plan.profile} · ${plan.profileSource} · ${plan.complexity} · ${plan.enabledTechniques.join(', ') || 'baseline'}`,
    metadata: {
      profile: plan.profile,
      profileSource: plan.profileSource,
      profileReason: plan.profileReason,
      language: plan.language,
      intent: plan.intent,
      risk: plan.risk,
      queryVariants: plan.rewrittenQueries.length,
      subQueries: plan.subQueries.length,
    },
  }, options.now?.() ?? Date.now()))

  const retrieved = await retrieveRagCandidates(plan, options)
  throwIfAgenticRagCancelled(options.signal)
  trace.push(retrieved.trace)

  const reranked = rerankAgenticCandidates(plan, retrieved.candidates)
  throwIfAgenticRagCancelled(options.signal)
  trace.push(completeRagTrace({
    id: `${plan.id}-rerank`,
    stage: 'rerank',
    title: 'RAG rerank',
    status: 'done',
    startedAt: options.now?.() ?? Date.now(),
    content: `${reranked.strategy} · ${reranked.before.length} -> ${reranked.after.length}`,
    metadata: {
      strategy: reranked.strategy,
      usedModel: reranked.usedModel,
      crossEncoderFallback: plan.enabledTechniques.includes('cross-encoder'),
      colbertFallback: plan.enabledTechniques.includes('colbert'),
    },
  }, options.now?.() ?? Date.now()))

  const packed = packRagContext(plan, reranked.after, options.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET)
  throwIfAgenticRagCancelled(options.signal)
  trace.push(completeRagTrace({
    id: `${plan.id}-pack`,
    stage: 'pack',
    title: 'RAG context pack',
    status: 'done',
    startedAt: options.now?.() ?? Date.now(),
    content: `${packed.sources.length} sources · compression ${(packed.quality.compressionRatio * 100).toFixed(0)}%`,
    metadata: {
      sourceCount: packed.sources.length,
      citationCoverage: packed.quality.citationCoverage,
      confidence: packed.quality.confidence,
      warnings: packed.quality.warnings,
    },
  }, options.now?.() ?? Date.now()))

  if (plan.enabledTechniques.includes('flare') && packed.quality.missingEvidence) {
    trace.push(completeRagTrace({
      id: `${plan.id}-flare`,
      stage: 'flare',
      title: 'FLARE active retrieval',
      status: 'skipped',
      startedAt: options.now?.() ?? Date.now(),
      content: 'Evidence is thin; runtime generation can trigger a follow-up retrieval pass.',
      metadata: { reason: 'missing-evidence', confidence: packed.quality.confidence },
    }, options.now?.() ?? Date.now()))
  }

  return {
    ...packed,
    trace: [...trace, ...packed.trace],
    retrievalStats: retrieved.stats,
    quality: {
      ...packed.quality,
      candidateCount: retrieved.candidates.length,
      fallbackReasons: collectFallbackReasons(plan, reranked.strategy),
      latencyMs: Math.max(0, (options.now?.() ?? Date.now()) - planStarted),
      tokenBudget: plan.tokenBudget,
      estimatedContextTokens: estimateTokens(packed.contextPrompt),
    },
  }
}

function throwIfAgenticRagCancelled(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('RAG retrieval was cancelled.')
  error.name = 'AbortError'
  throw error
}

export function createRagQueryPlan(input: {
  query: string
  conversationTitle?: string
  systemPrompt?: string
  settings: Settings
  profile?: RagProfile
  profileReason?: string
  now?: number
  tokenBudget?: number
  maxContextItems?: number
}): RagQueryPlan {
  const query = input.query.trim()
  const profileSelection = resolveRagProfileSelection({
    requestedProfile: input.profile,
    requestReason: input.profileReason,
    settings: input.settings,
  })
  const profile = profileSelection.profile
  const language = detectLanguage(query)
  const intent = detectIntent(query)
  const complexity = detectComplexity(query)
  const risk = detectRisk(query)
  const enabledTechniques = resolveEnabledTechniques(input.settings, profile, complexity)
  const rewrittenQueries = enabledTechniques.includes('query-rewriting')
    ? rewriteQueryVariants(query, { conversationTitle: input.conversationTitle, language, intent, complexity })
    : [query]
  const subQueries = complexity === 'complex' || profile === 'deep' ? buildSubQueries(query) : []
  return {
    id: `rag-${Math.abs(hashString(`${query}:${input.now ?? Date.now()}`)).toString(36)}`,
    profile,
    profileSource: profileSelection.source,
    profileReason: profileSelection.reason,
    query,
    language,
    intent,
    complexity,
    risk,
    rewrittenQueries,
    hydePrompt: enabledTechniques.includes('hyde') ? buildHydePrompt(query, language, intent) : undefined,
    subQueries,
    enabledTechniques,
    retrievalBudget: profile === 'deep' ? 24 : complexity === 'complex' ? 18 : 12,
    contextItemBudget: input.maxContextItems ?? DEFAULT_MAX_CONTEXT_ITEMS,
    tokenBudget: input.tokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET,
    createdAt: input.now ?? Date.now(),
  }
}

export function rerankAgenticCandidates(plan: RagQueryPlan, candidates: RagRetrievalCandidate[]): RagRerankResult {
  const before = candidates.map((candidate) => ({ ...candidate }))
  const queryTokens = tokenizeForRerank([plan.query, ...plan.rewrittenQueries, ...plan.subQueries].join(' '))
  const maxOriginalScore = Math.max(0.001, ...candidates.map((candidate) => Math.abs(candidate.originalScore ?? candidate.score ?? 0)))
  const scored = candidates.map((candidate) => {
    const sourceText = `${candidate.title} ${candidate.content}`
    const overlap = jaccard(queryTokens, tokenizeForRerank(sourceText))
    const normalizedOriginal = Math.min(Math.abs(candidate.originalScore ?? candidate.score ?? 0) / maxOriginalScore, 1)
    const sourcePrior = originPrior(candidate.origin)
    const quality = candidate.qualityScore ?? estimateChunkQuality(candidate.content)
    const position = 1 / (1 + Math.max(0, candidate.chunkIndex ?? candidate.originalRank ?? 0))
    const crossEncoderFallback = lexicalCrossEncoderFallback(plan.query, candidate)
    const colbertFallback = plan.enabledTechniques.includes('colbert') ? maxTokenMatch(queryTokens, tokenizeForRerank(sourceText)) : 0
    const score =
      0.26 * normalizedOriginal +
      0.22 * overlap +
      0.18 * crossEncoderFallback +
      0.12 * colbertFallback +
      0.1 * sourcePrior +
      0.07 * quality +
      0.05 * position
    return {
      ...candidate,
      rerankScore: Number(score.toFixed(4)),
      score: Number(score.toFixed(4)),
      similarityScore: Number(score.toFixed(4)),
      sourceReason: candidate.sourceReason ?? buildSourceReason(candidate, overlap, crossEncoderFallback),
    }
  })
  const after = applyLostInMiddleOrdering(scored.sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0)), plan.contextItemBudget)
  const strategy = resolveRerankStrategy(plan)
  return {
    before,
    after,
    strategy,
    fallbackReasons: collectFallbackReasons(plan, strategy),
  }
}

export function packRagContext(plan: RagQueryPlan, candidates: RagRetrievalCandidate[], tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET): RagContextPack {
  const selected: RagRetrievalCandidate[] = []
  let usedTokens = 0
  for (const candidate of candidates) {
    const compressed = compressCandidate(candidate, plan, Math.max(180, Math.floor(tokenBudget / Math.max(1, plan.contextItemBudget)) * 4))
    const estimated = estimateTokens(`${compressed.title}\n${compressed.content}`)
    if (selected.length && usedTokens + estimated > tokenBudget) continue
    selected.push(compressed)
    usedTokens += estimated
    if (selected.length >= plan.contextItemBudget) break
  }
  const citations = selected.map((source, index) => ({
    id: source.id,
    type: source.type,
    title: source.title,
    excerpt: source.excerpt ?? extractiveSummary(source.content, 180),
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
    rerankScore: source.rerankScore,
    compressionRatio: source.compressionRatio,
    sourceReason: source.sourceReason,
    headingPath: source.headingPath,
    semanticBoundary: source.semanticBoundary,
    qualityScore: source.qualityScore,
    queryVariant: source.queryVariant,
    retrievalStage: source.origin,
    label: `[${index + 1}]`,
  }))
  const contextPrompt = selected.length
    ? [
        '以下是 IsleMind Agentic RAG 选择的本机上下文。请优先依据带编号的证据回答；如果证据不足，请说明不确定。',
        `RAG profile: ${plan.profile}; intent: ${plan.intent}; complexity: ${plan.complexity}.`,
        ...selected.map((source, index) => {
          const meta = [
            source.retrievalMode ? `mode=${source.retrievalMode}` : '',
            source.origin ? `origin=${source.origin}` : '',
            source.rerankScore !== undefined ? `rerank=${source.rerankScore.toFixed(2)}` : '',
            source.sourceReason ? `reason=${source.sourceReason}` : '',
          ].filter(Boolean).join(' · ')
          return `[${index + 1}] ${source.title}${meta ? `\n${meta}` : ''}\n${source.content}`
        }),
      ].join('\n\n')
    : ''
  const quality = evaluateRagContext(plan, candidates, selected)
  return {
    plan,
    sources: selected,
    citations,
    contextPrompt,
    trace: [completeRagTrace({
      id: `${plan.id}-verify`,
      stage: 'verify',
      title: 'RAG quality',
      status: quality.missingEvidence ? 'skipped' : 'done',
      startedAt: Date.now(),
      content: `confidence=${quality.confidence.toFixed(2)} · citation=${quality.citationCoverage.toFixed(2)}`,
      metadata: quality as unknown as Record<string, unknown>,
    }, Date.now())],
    quality,
  }
}

export function verifyRagGeneration(input: {
  answer: string
  query: string
  citations: { label?: string; id?: string; title?: string; excerpt?: string }[]
  quality?: RagEvaluationResult
  minConfidence?: number
}): RagGenerationVerification {
  const answer = input.answer.trim()
  const claims = extractFactualClaims(answer)
  const citationPattern = /\[(\d+)\]/g
  const citedLabels = new Set(Array.from(answer.matchAll(citationPattern)).map((match) => `[${match[1]}]`))
  const citationText = input.citations
    .map((citation, index) => `${citation.label ?? `[${index + 1}]`} ${citation.title ?? ''} ${citation.excerpt ?? ''}`)
    .join('\n')
  const citedClaimCount = claims.filter((claim) => citedLabels.size && hasCitationNearby(answer, claim, citedLabels)).length
  const unsupportedClaimCount = claims.filter((claim) => !isClaimSupported(claim, citationText)).length
  const citationCoverage = claims.length ? citedClaimCount / claims.length : (input.quality?.citationCoverage ?? 0)
  const supportScore = claims.length ? 1 - unsupportedClaimCount / claims.length : 1
  const baseline = input.quality?.confidence ?? 0.5
  const confidence = Math.max(0, Math.min(1, 0.42 * baseline + 0.28 * citationCoverage + 0.3 * supportScore))
  const reasons: string[] = []
  if (!answer) reasons.push('empty-answer')
  if (citationCoverage < 0.34 && claims.length >= 2) reasons.push('low-citation-coverage')
  if (unsupportedClaimCount > 0) reasons.push('unsupported-claims')
  if (input.quality?.missingEvidence) reasons.push('missing-evidence')
  const threshold = input.minConfidence ?? 0.58
  return {
    confidence: Number(confidence.toFixed(3)),
    factualClaimCount: claims.length,
    citedClaimCount,
    unsupportedClaimCount,
    needsFlare: reasons.length > 0 && confidence < threshold,
    reasons,
    followupQuery: reasons.length ? buildFlareFollowupQuery(input.query, claims, input.citations) : undefined,
  }
}

export function buildFlareContextPrompt(query: string, sources: RetrievalSource[]): string {
  if (!sources.length) return ''
  return [
    'FLARE 补充检索证据。请只用这些证据修订缺证据或低置信部分，不要编造未出现的信息。',
    `Original query: ${query}`,
    buildCompressedContextPrompt(sources),
  ].join('\n\n')
}

export function splitTextIntoSentenceChunks(text: string, targetLength = TARGET_CHUNK_LENGTH): SentenceChunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const sentences = segmentSentences(normalized)
  const chunks: SentenceChunk[] = []
  let current: string[] = []
  let currentStart = 0
  let index = 0

  function flush(endIndex: number) {
    const content = current.join('').trim()
    if (content) {
      chunks.push({ content, sentenceStart: currentStart, sentenceEnd: Math.max(currentStart, endIndex) })
    }
  }

  while (index < sentences.length) {
    const sentence = sentences[index]
    if (!current.length) currentStart = index
    const nextLength = current.join('').length + sentence.length
    if (current.length && (nextLength > targetLength || nextLength > MAX_CHUNK_LENGTH)) {
      flush(index - 1)
      const overlap = current.length > OVERLAP_SENTENCES ? current.slice(-OVERLAP_SENTENCES) : []
      current = overlap.length ? [...overlap] : []
      currentStart = Math.max(0, index - current.length)
      continue
    }
    current.push(sentence)
    index += 1
  }
  flush(sentences.length - 1)
  return chunks
}

export function rerankRetrievalSources(query: string, sources: RetrievalSource[], limit: number): RetrievalSource[] {
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
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, Math.max(1, limit))
}

export function buildCompressedContextPrompt(sources: RetrievalSource[]): string {
  if (!sources.length) return ''
  return sources
    .map((source, index) => {
      const summary = extractiveSummary(source.content)
      return `[${index + 1}] ${source.title}\n${summary}`
    })
    .join('\n\n')
}

export function compressRagSource(source: RetrievalSource, maxChars = 720): RetrievalSource {
  return {
    ...source,
    content: extractiveSummary(source.content, maxChars),
    excerpt: source.excerpt ?? extractiveSummary(source.content, 180),
  }
}

export function extractiveSummary(text: string, maxChars = 220): string {
  const sentences = segmentSentences(text)
  const selected = sentences.slice(0, 2).join('').trim()
  const fallback = text.replace(/\s+/g, ' ').trim()
  const summary = selected || fallback
  return summary.length > maxChars ? `${summary.slice(0, maxChars).trim()}...` : summary
}

export function createHashEmbeddingProvider(embed: (text: string) => number[]): EmbeddingProvider {
  return {
    id: 'hash',
    dimension: 128,
    embed: async (text) => embed(text),
    available: async () => true,
  }
}

export function createOnnxPlaceholderProvider(): EmbeddingProvider {
  return {
    id: 'onnx',
    dimension: 384,
    embed: async () => {
      throw new Error('ONNX embedding is not bundled in this build.')
    },
    available: async () => false,
  }
}

export async function createOnnxEmbeddingProvider(settings: Pick<Settings, 'localEmbeddingModelId' | 'localEmbeddingModelSource'>): Promise<EmbeddingProvider | null> {
  if (settings.localEmbeddingModelSource === 'none') return null

  // 优化：延迟加载模型，仅在首次embed时加载
  // 避免在createProvider时就加载108MB的AI模型

  let cachedModel: { model: LocalEmbeddingModel; source: string; directoryUri: string } | null = null

  const loadModelOnDemand = async () => {
    if (cachedModel) return cachedModel

    const active = await resolveActiveLocalEmbeddingModel(settings as Settings)
    if (!active) throw new Error('No embedding model available')

    cachedModel = active
    return active
  }

  return {
    id: 'onnx',
    dimension: 384, // 默认维度，实际会从模型中获取
    available: async () => {
      try {
        const active = await loadModelOnDemand()
        if (!supportsTokenizer(active.model.tokenizer)) return false

        await getOnnxRuntime()
        await loadTokenizer(active.model, active.directoryUri)
        return true
      } catch (error) {
        console.error('[ONNX] Provider not available:', error)
        return false
      }
    },
    embed: async (text: string) => {
      const active = await loadModelOnDemand()

      if (!supportsTokenizer(active.model.tokenizer)) {
        throw new Error(`Tokenizer ${active.model.tokenizer} is not supported in this build.`)
      }

      const vector = await embedWithOnnx(active.model, active.directoryUri, text)
      return vector
    },
  }
}

export function annotateCitationIndex(source: RetrievalSource, index: number): RetrievalSource {
  return {
    ...source,
    chunkIndex: source.chunkIndex ?? index,
  }
}

function segmentSentences(text: string): string[] {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (locale?: string, options?: Record<string, string>) => { segment: (input: string) => Iterable<{ segment: string }> } }).Segmenter
  if (Segmenter) {
    try {
      const segmenter = new Segmenter(undefined, { granularity: 'sentence' })
      const result = Array.from(segmenter.segment(text)).map((item) => item.segment).filter((item) => item.trim())
      if (result.length) return result
    } catch {
      // Regex fallback below.
    }
  }
  const matches = text.match(/[^。！？!?;\n]+[。！？!?;；]?|\n+/g) ?? [text]
  return matches.map((item) => item).filter((item) => item.trim())
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

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function maxTokenMatch(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let best = 0
  for (const token of a) {
    if (b.has(token)) best += token.length > 2 ? 1 : 0.5
  }
  return Math.min(1, best / Math.max(1, a.size))
}

function resolveRagProfileSelection(input: {
  requestedProfile?: RagProfile
  requestReason?: string
  settings: Settings
}): { profile: RagProfile; source: RagQueryPlan['profileSource']; reason: string } {
  if (input.settings.ragMode === 'off') {
    return {
      profile: 'offline',
      source: 'rag-mode',
      reason: 'ragMode=off',
    }
  }
  if (isRagProfile(input.requestedProfile)) {
    return {
      profile: input.requestedProfile,
      source: 'tool-request',
      reason: sanitizeRagProfileReason(input.requestReason) ?? 'agent tool request',
    }
  }
  return {
    profile: input.settings.ragProfile ?? 'balanced',
    source: 'settings',
    reason: input.settings.ragProfile ? 'settings.ragProfile' : 'default-balanced',
  }
}

function isRagProfile(value: unknown): value is RagProfile {
  return value === 'fast' || value === 'balanced' || value === 'deep' || value === 'offline'
}

function sanitizeRagProfileReason(value: string | undefined): string | undefined {
  if (!value) return undefined
  const sanitized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return sanitized ? sanitized.slice(0, 160) : undefined
}

function detectLanguage(query: string): Language | 'mixed' {
  const hasCjk = /[\u3400-\u9fff]/.test(query)
  const hasKana = /[\u3040-\u30ff]/.test(query)
  const hasLatin = /[a-z]/i.test(query)
  if ((hasCjk || hasKana) && hasLatin) return 'mixed'
  if (hasKana) return 'ja'
  if (hasCjk) return 'zh-CN'
  return 'en'
}

function detectIntent(query: string): RagQueryIntent {
  const text = query.toLowerCase()
  if (/(怎么|如何|步骤|教程|how to|guide|setup|配置|修复)/i.test(text)) return 'how-to'
  if (/(比较|对比|区别|versus| vs |compare|tradeoff)/i.test(text)) return 'comparison'
  if (/(为什么|原因|分析|评估|analyze|why|root cause)/i.test(text)) return 'analysis'
  if (/(报错|错误|异常|debug|bug|stack|trace|crash|failed)/i.test(text)) return 'debug'
  if (/(写|生成|创作|draft|compose|create)/i.test(text)) return 'creative'
  return 'fact'
}

function detectComplexity(query: string): RagQueryComplexity {
  const length = query.trim().length
  const clauses = (query.match(/[?？。！？;；\n]/g) ?? []).length
  const multiHopHints = /(并且|同时|分别|多个|综合|关联|影响|比较|对比|差异|迁移|风险|分析|compare|and|then|across|relationship|graph|risk|migration)/i.test(query)
  if (length > 180 || clauses >= 3 || multiHopHints) return 'complex'
  if (length > 64 || clauses >= 1) return 'focused'
  return 'simple'
}

function detectRisk(query: string): RagRiskLevel {
  if (/(医疗|法律|财务|投资|诊断|合规|medical|legal|finance|diagnosis|compliance)/i.test(query)) return 'high'
  if (/(删除|覆盖|迁移|发布|release|deploy|支付|隐私|security|安全)/i.test(query)) return 'medium'
  return 'low'
}

function resolveEnabledTechniques(settings: Settings, profile: RagProfile, complexity: RagQueryComplexity): RagTechnique[] {
  if (profile === 'offline') return ['hybrid-search', 'citation-injection', 'lost-in-middle']
  const deepEnough = profile === 'deep' || (profile === 'balanced' && complexity !== 'simple')
  const techniques: RagTechnique[] = ['hybrid-search', 'citation-injection', 'lost-in-middle']
  if (settings.ragCrossEncoderEnabled !== false && deepEnough) techniques.push('cross-encoder')
  if (settings.ragQueryRewriteEnabled !== false && deepEnough) techniques.push('query-rewriting')
  if (settings.ragHydeEnabled !== false && deepEnough) techniques.push('hyde')
  if (settings.ragRaptorEnabled !== false && (profile === 'deep' || complexity === 'complex')) techniques.push('raptor')
  if (settings.ragGraphEnabled !== false && (profile === 'deep' || complexity === 'complex')) techniques.push('graphrag')
  if (settings.ragColbertEnabled !== false && profile === 'deep') techniques.push('colbert')
  if (settings.ragLlmlinguaEnabled !== false && deepEnough) techniques.push('llmlingua')
  if (settings.ragFlareEnabled !== false && deepEnough) techniques.push('flare')
  return techniques
}

function rewriteQueryVariants(query: string, context: { conversationTitle?: string; language: Language | 'mixed'; intent: RagQueryIntent; complexity: RagQueryComplexity }): string[] {
  const variants = new Set<string>([query.trim()])
  const normalized = query.replace(/\s+/g, ' ').trim()
  if (context.conversationTitle && context.complexity !== 'simple') {
    variants.add(`${context.conversationTitle}: ${normalized}`)
  }
  if (context.intent === 'debug') {
    variants.add(`${normalized} error cause fix reproduction`)
  } else if (context.intent === 'comparison') {
    variants.add(`${normalized} differences tradeoffs recommendation`)
  } else if (context.intent === 'how-to') {
    variants.add(`${normalized} steps configuration checklist`)
  } else if (context.intent === 'analysis') {
    variants.add(`${normalized} evidence reason impact`)
  }
  if (context.language === 'zh-CN' || context.language === 'mixed') {
    variants.add(`${normalized} 关键事实 依据 结论`)
  }
  return Array.from(variants).filter(Boolean).slice(0, context.complexity === 'complex' ? 5 : 3)
}

function buildSubQueries(query: string): string[] {
  const parts = query
    .split(/[。！？!?;；\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
  if (parts.length > 1) return parts.slice(0, 4)
  const keywords = Array.from(tokenizeForRerank(query)).slice(0, 8).join(' ')
  return keywords ? [`背景 ${keywords}`, `约束 ${keywords}`, `结论 ${keywords}`] : []
}

function buildHydePrompt(query: string, language: Language | 'mixed', intent: RagQueryIntent): string {
  const prefix = language === 'en'
    ? 'Hypothetical answer for retrieval'
    : language === 'ja'
      ? '検索用の仮説回答'
      : '用于检索的假设答案'
  return `${prefix}: ${query}\nIntent: ${intent}. Include likely terminology, entities, and expected evidence.`
}

async function retrieveRagCandidates(plan: RagQueryPlan, options: AgenticRagOptions): Promise<{ candidates: RagRetrievalCandidate[]; trace: RagTraceStep; stats: NonNullable<RagContextPack['retrievalStats']> }> {
  const startedAt = options.now?.() ?? Date.now()
  throwIfAgenticRagCancelled(options.signal)
  const variants = [
    ...plan.rewrittenQueries,
    ...plan.subQueries,
    plan.hydePrompt ?? '',
  ].map((item) => item.trim()).filter(Boolean)
  const perQueryLimit = Math.max(4, Math.ceil(plan.retrievalBudget / Math.max(1, variants.length)))
  const memoryCandidates = (options.memorySources ?? []).map((source, index) => toCandidate(source, 'memory', plan.query, index))
  const retrievalOptions = options.signal ? { signal: options.signal } : undefined
  const batches = await Promise.all(variants.map(async (variant) => {
    throwIfAgenticRagCancelled(options.signal)
    const hits = await options.retrieveKnowledge(variant, perQueryLimit, retrievalOptions)
    throwIfAgenticRagCancelled(options.signal)
    const origin: RagRetrievalOrigin = variant === plan.hydePrompt ? 'hyde' : variant === plan.query ? 'knowledge' : 'query-rewrite'
    return hits.map((source, index) => toCandidate(source, origin, variant, index))
  }))
  throwIfAgenticRagCancelled(options.signal)
  const advancedHits = options.retrieveAgentic
    ? await options.retrieveAgentic(plan.query, plan, Math.max(4, Math.ceil(plan.retrievalBudget / 3)), retrievalOptions)
    : []
  throwIfAgenticRagCancelled(options.signal)
  const advancedCandidates = advancedHits.map((source, index) => toCandidate(
    source,
    inferAdvancedOrigin(source),
    plan.query,
    index
  ))
  const candidates = dedupeCandidates([...memoryCandidates, ...batches.flat(), ...advancedCandidates])
  const byOrigin = candidates.reduce<NonNullable<RagContextPack['retrievalStats']>['byOrigin']>((acc, candidate) => {
    acc[candidate.origin] = (acc[candidate.origin] ?? 0) + 1
    return acc
  }, {})
  const stats = {
    queryVariants: variants.length,
    memoryCandidates: memoryCandidates.length,
    knowledgeCandidates: candidates.filter((item) => item.type === 'knowledge').length,
    advancedCandidates: advancedCandidates.length,
    byOrigin,
  }
  return {
    candidates,
    stats,
    trace: completeRagTrace({
      id: `${plan.id}-retrieve`,
      stage: 'retrieve',
      title: 'RAG retrieve',
      status: 'done',
      startedAt,
      content: `${candidates.length} candidates from ${variants.length} query variants`,
      metadata: {
        ...stats,
        hyde: !!plan.hydePrompt,
      },
    }, options.now?.() ?? Date.now()),
  }
}

function resolveRerankStrategy(plan: RagQueryPlan): RagRerankResult['strategy'] {
  if (plan.enabledTechniques.includes('cross-encoder')) return 'cross-encoder-fallback'
  if (plan.enabledTechniques.includes('colbert')) return 'colbert-lite'
  return 'local-statistical'
}

function collectFallbackReasons(plan: RagQueryPlan, strategy: RagRerankResult['strategy']): string[] {
  const reasons: string[] = []
  if (strategy === 'cross-encoder-fallback') reasons.push('cross-encoder-model-unavailable')
  if (strategy === 'colbert-lite') reasons.push('colbert-model-unavailable')
  if (plan.enabledTechniques.includes('llmlingua')) reasons.push('llmlingua-model-unavailable')
  return reasons
}

function toCandidate(source: RetrievalSource, origin: RagRetrievalOrigin, queryVariant: string, index: number): RagRetrievalCandidate {
  return {
    ...source,
    candidateId: `${origin}:${source.id}:${hashString(queryVariant)}`,
    origin,
    queryVariant,
    originalRank: index,
    originalScore: source.score,
    qualityScore: source.qualityScore ?? estimateChunkQuality(source.content),
    semanticBoundary: source.semanticBoundary ?? inferSemanticBoundary(source.content),
  }
}

function dedupeCandidates(candidates: RagRetrievalCandidate[]): RagRetrievalCandidate[] {
  const byKey = new Map<string, RagRetrievalCandidate>()
  for (const candidate of candidates) {
    const key = candidate.chunkId ?? candidate.url ?? candidate.id
    const existing = byKey.get(key)
    if (!existing || (candidate.score ?? 0) > (existing.score ?? 0)) {
      byKey.set(key, existing ? { ...candidate, origin: mergeOrigin(existing.origin, candidate.origin) } : candidate)
    }
  }
  return Array.from(byKey.values())
}

function mergeOrigin(left: RagRetrievalOrigin, right: RagRetrievalOrigin): RagRetrievalOrigin {
  if (left === right) return left
  if (left === 'memory' || right === 'memory') return 'memory'
  if (left === 'hyde' || right === 'hyde') return 'hyde'
  return 'query-rewrite'
}

function inferAdvancedOrigin(source: RetrievalSource): RagRetrievalOrigin {
  const reason = source.sourceReason ?? ''
  if (reason.includes('raptor')) return 'raptor'
  if (reason.includes('graph')) return 'graph'
  if (reason.includes('colbert')) return 'colbert'
  return 'knowledge'
}

function originPrior(origin: RagRetrievalOrigin): number {
  switch (origin) {
    case 'memory':
      return 0.95
    case 'knowledge':
      return 0.9
    case 'hyde':
      return 0.76
    case 'query-rewrite':
      return 0.72
    case 'raptor':
    case 'graph':
    case 'colbert':
      return 0.82
    case 'web':
      return 0.68
  }
}

function lexicalCrossEncoderFallback(query: string, candidate: RetrievalSource): number {
  const queryTokens = Array.from(tokenizeForRerank(query))
  if (!queryTokens.length) return 0
  const text = `${candidate.title} ${candidate.content}`.toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (text.includes(token.toLowerCase())) score += token.length > 2 ? 1 : 0.5
  }
  const titleBoost = queryTokens.some((token) => candidate.title.toLowerCase().includes(token.toLowerCase())) ? 0.15 : 0
  return Math.min(1, score / queryTokens.length + titleBoost)
}

function buildSourceReason(candidate: RagRetrievalCandidate, overlap: number, crossScore: number): string {
  if (candidate.origin === 'memory') return 'memory-match'
  if (crossScore > 0.55) return 'semantic-overlap'
  if (overlap > 0.25) return 'keyword-overlap'
  if ((candidate.vectorScore ?? 0) > (candidate.ftsScore ?? 0)) return 'vector-match'
  return candidate.retrievalMode ?? candidate.origin
}

function applyLostInMiddleOrdering(candidates: RagRetrievalCandidate[], limit: number): RagRetrievalCandidate[] {
  const selected = candidates.slice(0, Math.max(1, limit))
  const result: RagRetrievalCandidate[] = []
  selected.forEach((candidate, index) => {
    if (index % 2 === 0) result.unshift(candidate)
    else result.push(candidate)
  })
  return result.map((candidate, index) => ({ ...candidate, chunkIndex: candidate.chunkIndex, originalRank: candidate.originalRank ?? index }))
}

function compressCandidate(candidate: RagRetrievalCandidate, plan: RagQueryPlan, maxChars: number): RagRetrievalCandidate {
  const originalLength = candidate.content.length
  const shouldCompress = plan.enabledTechniques.includes('llmlingua') || originalLength > maxChars
  const content = shouldCompress ? extractiveSummary(candidate.content, maxChars) : candidate.content
  return {
    ...candidate,
    content,
    excerpt: candidate.excerpt ?? extractiveSummary(content, 180),
    compressionRatio: originalLength ? Number((content.length / originalLength).toFixed(3)) : 1,
  }
}

function evaluateRagContext(plan: RagQueryPlan, candidates: RagRetrievalCandidate[], selected: RagRetrievalCandidate[]): RagEvaluationResult {
  const sourceCount = selected.length
  const cited = selected.filter((source) => source.id && (source.excerpt || source.content)).length
  const citationCoverage = sourceCount ? cited / sourceCount : 0
  const averageScore = sourceCount
    ? selected.reduce((sum, source) => sum + (source.rerankScore ?? source.score ?? 0), 0) / sourceCount
    : 0
  const contextPrecision = Math.min(1, averageScore)
  const originalChars = selected.reduce((sum, source) => sum + Math.max(source.content.length / Math.max(source.compressionRatio ?? 1, 0.001), source.content.length), 0)
  const packedChars = selected.reduce((sum, source) => sum + source.content.length, 0)
  const compressionRatio = originalChars ? packedChars / originalChars : 1
  const missingEvidence = plan.risk !== 'low' ? sourceCount < 2 : sourceCount === 0
  const confidence = Math.max(0, Math.min(1, 0.45 * contextPrecision + 0.25 * citationCoverage + 0.2 * Math.min(sourceCount / Math.max(1, plan.contextItemBudget), 1) + 0.1 * (candidates.length ? 1 : 0)))
  const warnings: string[] = []
  if (missingEvidence) warnings.push('missing-evidence')
  if (compressionRatio < 0.45) warnings.push('heavy-compression')
  if (plan.enabledTechniques.includes('cross-encoder')) warnings.push('cross-encoder-fallback')
  if (plan.enabledTechniques.includes('colbert')) warnings.push('colbert-lite-fallback')
  return {
    sourceCount,
    candidateCount: candidates.length,
    citationCoverage: Number(citationCoverage.toFixed(3)),
    contextPrecision: Number(contextPrecision.toFixed(3)),
    compressionRatio: Number(compressionRatio.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
    activeRetrievals: plan.rewrittenQueries.length + plan.subQueries.length + (plan.hydePrompt ? 1 : 0),
    missingEvidence,
    warnings,
    fallbackReasons: collectFallbackReasons(plan, plan.enabledTechniques.includes('cross-encoder') ? 'cross-encoder-fallback' : plan.enabledTechniques.includes('colbert') ? 'colbert-lite' : 'local-statistical'),
    tokenBudget: plan.tokenBudget,
    estimatedContextTokens: selected.reduce((sum, source) => sum + estimateTokens(source.content), 0),
  }
}

function extractFactualClaims(answer: string): string[] {
  return answer
    .split(/[。！？.!?\n]+/)
    .map((item) => item.replace(/\[[0-9]+\]/g, '').trim())
    .filter((item) => item.length >= 12)
    .filter((item) => !/^(sure|好的|可以|以下|here are|let me)/i.test(item))
    .slice(0, 12)
}

function hasCitationNearby(answer: string, claim: string, labels: Set<string>): boolean {
  const index = answer.indexOf(claim)
  if (index < 0) return false
  const window = answer.slice(Math.max(0, index - 24), Math.min(answer.length, index + claim.length + 48))
  for (const label of labels) {
    if (window.includes(label)) return true
  }
  return false
}

function isClaimSupported(claim: string, citationText: string): boolean {
  if (!citationText.trim()) return false
  const claimTokens = tokenizeForRerank(claim)
  const sourceTokens = tokenizeForRerank(citationText)
  return jaccard(claimTokens, sourceTokens) >= 0.08 || maxTokenMatch(claimTokens, sourceTokens) >= 0.28
}

function buildFlareFollowupQuery(query: string, claims: string[], citations: { title?: string; excerpt?: string }[]): string {
  const unsupported = claims.slice(0, 3).join(' ')
  const citationHints = citations.slice(0, 3).map((citation) => citation.title ?? citation.excerpt ?? '').filter(Boolean).join(' ')
  return [query, unsupported, citationHints, '补充证据 引用 来源'].filter(Boolean).join('\n').slice(0, 900)
}

function completeRagTrace(step: RagTraceStep, completedAt: number): RagTraceStep {
  return {
    ...step,
    completedAt,
    durationMs: Math.max(0, completedAt - step.startedAt),
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

function estimateChunkQuality(content: string): number {
  const trimmed = content.trim()
  if (!trimmed) return 0
  const sentenceCount = segmentSentences(trimmed).length
  const lengthScore = lengthFitness(trimmed.length)
  const structureScore = /(^|\n)#{1,6}\s|\n[-*]\s|\n\d+[.)]/.test(trimmed) ? 0.12 : 0
  const sentenceScore = Math.min(0.18, sentenceCount / 20)
  return Number(Math.min(1, 0.7 * lengthScore + structureScore + sentenceScore).toFixed(3))
}

function inferSemanticBoundary(content: string): string {
  const firstLine = content.split('\n').map((line) => line.trim()).find(Boolean)
  if (!firstLine) return 'body'
  if (/^#{1,6}\s/.test(firstLine)) return 'heading'
  if (/^[-*]\s|\d+[.)]/.test(firstLine)) return 'list'
  return 'sentence'
}

function lengthFitness(length: number): number {
  if (length < 120) return Math.max(0.2, length / 120)
  if (length <= 1400) return 1
  return Math.max(0.35, 1 - (length - 1400) / 2400)
}

function inferCreatedAt(source: RetrievalSource): number {
  const created = 'createdAt' in source ? source.createdAt : undefined
  return typeof created === 'number' ? created : Date.now()
}

type OrtModule = typeof import('onnxruntime-react-native')
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

interface TokenizerState {
  vocab: Record<string, number>
  tokenizer: LocalEmbeddingTokenizer
  lowercase: boolean
  clsId: number
  sepId: number
  padId: number
  unkId: number
}

const sessionCache = new Map<string, Promise<OrtSession>>()
const tokenizerCache = new Map<string, Promise<TokenizerState>>()

async function getOnnxRuntime(): Promise<OrtModule> {
  return import('onnxruntime-react-native')
}

async function embedWithOnnx(model: LocalEmbeddingModel, directoryUri: string, text: string): Promise<number[]> {
  const [ort, tokenizer, session] = await Promise.all([
    getOnnxRuntime(),
    loadTokenizer(model, directoryUri),
    loadSession(model, directoryUri),
  ])
  const tokens = encodeText(tokenizer, text, model.maxTokens)
  const dims = [1, tokens.inputIds.length]
  const feeds: Record<string, unknown> = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(tokens.inputIds.map(BigInt)), dims),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from(tokens.attentionMask.map(BigInt)), dims),
  }
  if (session.inputNames.includes('token_type_ids')) {
    feeds.token_type_ids = new ort.Tensor('int64', BigInt64Array.from(tokens.tokenTypeIds.map(BigInt)), dims)
  }
  const results = await session.run(feeds as never)
  const outputName = chooseEmbeddingOutputName(session.outputNames, results)
  const output = results[outputName]
  const data = Array.from(output.data as Float32Array)
  const outputDims = Array.from(output.dims)
  if (outputDims.length === 3) {
    return meanPool(data, outputDims[1], outputDims[2], tokens.attentionMask)
  }
  if (outputDims.length === 2) {
    return normalizeVector(data.slice(0, outputDims[1]))
  }
  throw new Error('Unexpected ONNX embedding output shape.')
}

async function loadSession(model: LocalEmbeddingModel, directoryUri: string): Promise<OrtSession> {
  const key = `${model.id}:${directoryUri}`
  let pending = sessionCache.get(key)
  if (!pending) {
    pending = (async () => {
      const ort = await getOnnxRuntime()
      const modelUri = `${directoryUri}onnx/model_quantized.onnx`
      const modelInput = await readFileBytes(modelUri)
      return ort.InferenceSession.create(modelInput, {
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      })
    })()
    sessionCache.set(key, pending)
  }
  return pending
}

async function loadTokenizer(model: LocalEmbeddingModel, directoryUri: string): Promise<TokenizerState> {
  const key = `${model.id}:${directoryUri}`
  let pending = tokenizerCache.get(key)
  if (!pending) {
    pending = (async () => {
      const raw = await FileSystem.readAsStringAsync(`${directoryUri}tokenizer.json`, { encoding: FileSystem.EncodingType.UTF8 })
      const data = JSON.parse(raw) as {
        model?: { vocab?: Record<string, number> | Array<[string, number]> }
        normalizer?: unknown
      }
      const vocab = Array.isArray(data.model?.vocab)
        ? Object.fromEntries(data.model.vocab.map(([token], index) => [token, index]))
        : data.model?.vocab ?? {}
      if (!Object.keys(vocab).length) throw new Error('Tokenizer vocabulary is empty.')
      return {
        vocab,
        tokenizer: model.tokenizer,
        lowercase: JSON.stringify(data.normalizer ?? '').toLowerCase().includes('lowercase') || model.tokenizer === 'wordpiece',
        clsId: vocab['[CLS]'] ?? vocab['<s>'] ?? 101,
        sepId: vocab['[SEP]'] ?? vocab['</s>'] ?? 102,
        padId: vocab['[PAD]'] ?? vocab['<pad>'] ?? 0,
        unkId: vocab['[UNK]'] ?? vocab['<unk>'] ?? 100,
      }
    })()
    tokenizerCache.set(key, pending)
  }
  return pending
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })
  return base64ToBytes(base64)
}

function encodeText(tokenizer: TokenizerState, text: string, maxTokens: number): { inputIds: number[]; attentionMask: number[]; tokenTypeIds: number[] } {
  const tokenBudget = Math.max(8, maxTokens - 2)
  const rawTokens = tokenizer.tokenizer === 'wordpiece'
    ? tokenizeWordPiece(text, tokenizer)
    : tokenizeSentencePieceLite(text, tokenizer)
  const contentIds = rawTokens.slice(0, tokenBudget)
  const inputIds = [tokenizer.clsId, ...contentIds, tokenizer.sepId]
  const attentionMask = inputIds.map(() => 1)
  const tokenTypeIds = inputIds.map(() => 0)
  return { inputIds, attentionMask, tokenTypeIds }
}

function tokenizeWordPiece(text: string, tokenizer: TokenizerState): number[] {
  const normalized = tokenizer.lowercase ? text.toLowerCase() : text
  const words = normalized.match(/[a-z0-9]+(?:'[a-z0-9]+)?|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\s]/gi) ?? []
  const ids: number[] = []
  for (const word of words) {
    const pieces = wordPieceTokenize(word, tokenizer.vocab)
    if (!pieces.length) {
      ids.push(tokenizer.unkId)
      continue
    }
    ids.push(...pieces.map((piece) => tokenizer.vocab[piece] ?? tokenizer.unkId))
  }
  return ids
}

function wordPieceTokenize(word: string, vocab: Record<string, number>): string[] {
  if (vocab[word] !== undefined) return [word]
  const chars = Array.from(word)
  const pieces: string[] = []
  let start = 0
  while (start < chars.length) {
    let end = chars.length
    let current = ''
    while (start < end) {
      const candidate = `${start > 0 ? '##' : ''}${chars.slice(start, end).join('')}`
      if (vocab[candidate] !== undefined) {
        current = candidate
        break
      }
      end -= 1
    }
    if (!current) return []
    pieces.push(current)
    start = end
  }
  return pieces
}

function tokenizeSentencePieceLite(text: string, tokenizer: TokenizerState): number[] {
  const normalized = tokenizer.lowercase ? text.toLowerCase() : text
  const parts = normalized.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\s]+/g) ?? []
  const ids: number[] = []
  for (const part of parts) {
    const candidates = [`▁${part}`, part]
    const direct = candidates.find((candidate) => tokenizer.vocab[candidate] !== undefined)
    if (direct) {
      ids.push(tokenizer.vocab[direct])
      continue
    }
    for (const char of Array.from(part)) {
      ids.push(tokenizer.vocab[`▁${char}`] ?? tokenizer.vocab[char] ?? tokenizer.unkId)
    }
  }
  return ids
}

function chooseEmbeddingOutputName(outputNames: readonly string[], results: Record<string, { dims: readonly number[]; data: unknown }>): string {
  const preferred = ['last_hidden_state', 'token_embeddings', 'sentence_embedding', 'pooler_output']
  for (const name of preferred) {
    if (results[name]) return name
  }
  const ranked = outputNames.find((name) => results[name]?.dims?.length === 3)
    ?? outputNames.find((name) => results[name]?.dims?.length === 2)
    ?? outputNames[0]
  if (!ranked) throw new Error('ONNX embedding model returned no outputs.')
  return ranked
}

function meanPool(data: number[], sequenceLength: number, dimension: number, mask: number[]): number[] {
  const vector = Array.from({ length: dimension }, () => 0)
  let count = 0
  for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
    if (!mask[tokenIndex]) continue
    count += 1
    const offset = tokenIndex * dimension
    for (let dim = 0; dim < dimension; dim += 1) {
      vector[dim] += data[offset + dim] ?? 0
    }
  }
  if (count) {
    for (let dim = 0; dim < dimension; dim += 1) vector[dim] /= count
  }
  return normalizeVector(vector)
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude) return vector
  return vector.map((value) => Number((value / magnitude).toFixed(6)))
}

function supportsTokenizer(tokenizer: LocalEmbeddingTokenizer): boolean {
  return tokenizer === 'wordpiece' || tokenizer === 'unigram'
}

function base64ToBytes(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, '')
  const output: number[] = []
  for (let index = 0; index < clean.length; index += 4) {
    const a = chars.indexOf(clean[index])
    const b = chars.indexOf(clean[index + 1])
    const c = clean[index + 2] === '=' ? -1 : chars.indexOf(clean[index + 2])
    const d = clean[index + 3] === '=' ? -1 : chars.indexOf(clean[index + 3])
    if (a < 0 || b < 0) continue
    output.push((a << 2) | (b >> 4))
    if (c >= 0) output.push(((b & 15) << 4) | (c >> 2))
    if (d >= 0 && c >= 0) output.push(((c & 3) << 6) | d)
  }
  return new Uint8Array(output)
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
