import type { Language, RagProfile } from './settingsContracts'
import type { ProcessTraceStatus } from '@/core'

export type MemoryStatus = 'pending' | 'active' | 'disabled'
export type MemorySourceKind = 'manual' | 'deterministic' | 'model' | 'imported' | 'legacy'
export type RetrievalSourceType = 'memory' | 'knowledge' | 'web'
export type RagQueryComplexity = 'simple' | 'focused' | 'complex'
export type RagQueryIntent = 'fact' | 'how-to' | 'analysis' | 'comparison' | 'debug' | 'creative'
export type RagRiskLevel = 'low' | 'medium' | 'high'
export type RagTechnique =
  | 'hybrid-search'
  | 'query-rewriting'
  | 'hyde'
  | 'cross-encoder'
  | 'lost-in-middle'
  | 'citation-injection'
  | 'llmlingua'
  | 'colbert'
  | 'graphrag'
  | 'raptor'
  | 'flare'
export type RagRetrievalOrigin = RetrievalSourceType | 'query-rewrite' | 'hyde' | 'raptor' | 'graph' | 'colbert'
export type LocalRagModelCapability = 'embedding' | 'reranker' | 'colbert' | 'compressor'

export interface RagQueryPlan {
  id: string
  profile: RagProfile
  profileSource: 'settings' | 'tool-request' | 'rag-mode'
  profileReason?: string
  query: string
  language: Language | 'mixed'
  intent: RagQueryIntent
  complexity: RagQueryComplexity
  risk: RagRiskLevel
  rewrittenQueries: string[]
  hydePrompt?: string
  subQueries: string[]
  enabledTechniques: RagTechnique[]
  retrievalBudget: number
  contextItemBudget: number
  tokenBudget: number
  createdAt: number
}

export interface RagRetrievalCandidate extends RetrievalSource {
  candidateId: string
  origin: RagRetrievalOrigin
  queryVariant?: string
  originalRank?: number
  originalScore?: number
  rerankScore?: number
  compressionRatio?: number
  sourceReason?: string
  headingPath?: string[]
  semanticBoundary?: string
  qualityScore?: number
}

export interface RagRerankResult {
  before: RagRetrievalCandidate[]
  after: RagRetrievalCandidate[]
  strategy: 'local-statistical' | 'cross-encoder-fallback' | 'cross-encoder-local' | 'colbert-lite' | 'colbert-local'
  usedModel?: string
  fallbackReasons?: string[]
}

export interface RagCitation extends MessageCitation {
  label: string
  rerankScore?: number
  compressionRatio?: number
  sourceReason?: string
}

export interface RagContextPack {
  plan: RagQueryPlan
  sources: RagRetrievalCandidate[]
  citations: RagCitation[]
  contextPrompt: string
  trace: RagTraceStep[]
  quality: RagEvaluationResult
  retrievalStats?: RagRetrievalStats
}

export interface RagTraceStep {
  id: string
  stage: 'plan' | 'retrieve' | 'rerank' | 'pack' | 'generate' | 'verify' | 'flare' | 'evaluate'
  title: string
  status: ProcessTraceStatus
  content?: string
  startedAt: number
  completedAt?: number
  durationMs?: number
  metadata?: Record<string, unknown>
}

export interface RagEvaluationResult {
  sourceCount: number
  candidateCount?: number
  citationCoverage: number
  contextPrecision: number
  compressionRatio: number
  confidence: number
  activeRetrievals: number
  missingEvidence: boolean
  warnings: string[]
  generationConfidence?: number
  factualClaimCount?: number
  citedClaimCount?: number
  unsupportedClaimCount?: number
  flareTriggered?: boolean
  fallbackReasons?: string[]
  latencyMs?: number
  tokenBudget?: number
  estimatedContextTokens?: number
}

export interface RagRetrievalStats {
  queryVariants: number
  memoryCandidates: number
  knowledgeCandidates: number
  advancedCandidates: number
  byOrigin: Partial<Record<RagRetrievalOrigin, number>>
}

export interface RagEvaluationLog {
  id: string
  query: string
  plan?: RagQueryPlan
  quality?: RagEvaluationResult
  sourceCount: number
  latencyMs?: number
  createdAt: number
}

export interface RagIndexingJobStatus {
  id: string
  documentId?: string
  kind: string
  status: string
  progress?: number
  error?: string
  createdAt: number
  updatedAt: number
}

export interface RagGenerationVerification {
  confidence: number
  factualClaimCount: number
  citedClaimCount: number
  unsupportedClaimCount: number
  needsFlare: boolean
  reasons: string[]
  followupQuery?: string
}

export interface MessageCitation {
  id: string
  type: RetrievalSourceType
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
}

export interface RetrievalSource extends MessageCitation {
  content: string
}

export interface MemoryItem {
  id: string
  content: string
  status: MemoryStatus
  conversationId?: string
  sourceKind?: MemorySourceKind
  sourceDetail?: string
  confidence?: number
  score?: number
  lastHitAt?: number
  createdAt: number
  updatedAt: number
}

export interface KnowledgeDocument {
  id: string
  title: string
  mimeType: string
  size: number
  chunkCount: number
  status: 'ready' | 'extracting' | 'error'
  error?: string
  sourceUri?: string
  rawPath?: string
  contentHash?: string
  createdAt: number
  updatedAt: number
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  title: string
  content: string
  ordinal: number
  chunkIndex?: number
  sentenceStart?: number
  sentenceEnd?: number
  semanticBoundary?: string
  headingPath?: string[]
  entities?: string[]
  relations?: string[]
  summaryNodeId?: string
  parentChunkId?: string
  qualityScore?: number
  embeddingModelId?: string
  rerankSignals?: Record<string, number>
  embeddingProvider?: 'hash' | 'provider' | 'onnx'
  lastHitAt?: number
  score?: number
  ftsScore?: number
  vectorScore?: number
  retrievalMode?: 'fts' | 'vector' | 'hybrid'
  createdAt: number
}

export interface SearchProviderSettings {
  tavilyConfigured: boolean
}
