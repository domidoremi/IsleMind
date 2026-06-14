/**
 * Experimental vector scoring helpers for repository evaluation and future spikes.
 * This file is intentionally standalone and is not imported by the production runtime.
 */

export interface VectorCandidate {
  id: string
  vector?: readonly number[] | null
  lexicalScore?: number
  freshnessScore?: number
  qualityScore?: number
}

export interface HybridScoreWeights {
  lexical: number
  vector: number
  freshness: number
  quality: number
}

export interface RankedVectorCandidate extends VectorCandidate {
  vectorScore: number
  normalizedVectorScore: number
  normalizedLexicalScore: number
  normalizedFreshnessScore: number
  normalizedQualityScore: number
  hybridScore: number
}

const DEFAULT_WEIGHTS: HybridScoreWeights = {
  lexical: 0.3,
  vector: 0.45,
  freshness: 0.1,
  quality: 0.15,
}

export function normalizeVector(input: readonly number[]): number[] {
  const magnitude = Math.sqrt(input.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(magnitude) || magnitude <= 0) {
    return input.map(() => 0)
  }
  return input.map((value) => value / magnitude)
}

export function dotProduct(left: readonly number[], right: readonly number[]): number {
  const limit = Math.min(left.length, right.length)
  let total = 0
  for (let index = 0; index < limit; index += 1) {
    total += left[index] * right[index]
  }
  return total
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (!left.length || !right.length) return 0
  return dotProduct(normalizeVector(left), normalizeVector(right))
}

export function batchCosineSimilarity(
  queryVector: readonly number[],
  candidates: ReadonlyArray<readonly number[]>,
): number[] {
  const normalizedQuery = normalizeVector(queryVector)
  return candidates.map((candidate) => {
    if (!candidate.length) return 0
    return dotProduct(normalizedQuery, normalizeVector(candidate))
  })
}

export function minMaxNormalize(values: readonly number[]): number[] {
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return values.map(() => 0)
  }
  if (max === min) {
    return values.map((value) => (value > 0 ? 1 : 0))
  }
  return values.map((value) => (value - min) / (max - min))
}

export function scoreHybridCandidates(
  queryVector: readonly number[],
  candidates: readonly VectorCandidate[],
  weights: Partial<HybridScoreWeights> = {},
): RankedVectorCandidate[] {
  const mergedWeights: HybridScoreWeights = {
    lexical: weights.lexical ?? DEFAULT_WEIGHTS.lexical,
    vector: weights.vector ?? DEFAULT_WEIGHTS.vector,
    freshness: weights.freshness ?? DEFAULT_WEIGHTS.freshness,
    quality: weights.quality ?? DEFAULT_WEIGHTS.quality,
  }

  const vectorScores = candidates.map((candidate) => {
    const candidateVector = candidate.vector ?? []
    return candidateVector.length ? cosineSimilarity(queryVector, candidateVector) : 0
  })
  const lexicalScores = candidates.map((candidate) => candidate.lexicalScore ?? 0)
  const freshnessScores = candidates.map((candidate) => candidate.freshnessScore ?? 0)
  const qualityScores = candidates.map((candidate) => candidate.qualityScore ?? 0)

  const normalizedVectorScores = minMaxNormalize(vectorScores)
  const normalizedLexicalScores = minMaxNormalize(lexicalScores)
  const normalizedFreshnessScores = minMaxNormalize(freshnessScores)
  const normalizedQualityScores = minMaxNormalize(qualityScores)

  return candidates
    .map<RankedVectorCandidate>((candidate, index) => {
      const hybridScore =
        normalizedVectorScores[index] * mergedWeights.vector +
        normalizedLexicalScores[index] * mergedWeights.lexical +
        normalizedFreshnessScores[index] * mergedWeights.freshness +
        normalizedQualityScores[index] * mergedWeights.quality

      return {
        ...candidate,
        vectorScore: vectorScores[index],
        normalizedVectorScore: normalizedVectorScores[index],
        normalizedLexicalScore: normalizedLexicalScores[index],
        normalizedFreshnessScore: normalizedFreshnessScores[index],
        normalizedQualityScore: normalizedQualityScores[index],
        hybridScore,
      }
    })
    .sort((left, right) => right.hybridScore - left.hybridScore)
}

export function topKHybridCandidates(
  queryVector: readonly number[],
  candidates: readonly VectorCandidate[],
  limit: number,
  weights: Partial<HybridScoreWeights> = {},
): RankedVectorCandidate[] {
  if (limit <= 0) return []
  return scoreHybridCandidates(queryVector, candidates, weights).slice(0, limit)
}

export function reciprocalRankFusion(rankings: ReadonlyArray<ReadonlyArray<string>>, k = 60): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>()
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      const contribution = 1 / (k + index + 1)
      scores.set(id, (scores.get(id) ?? 0) + contribution)
    })
  }
  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((left, right) => right.score - left.score)
}
