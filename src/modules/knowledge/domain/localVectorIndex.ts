export const KNOWLEDGE_LOCAL_VECTOR_DIMENSION = 128
export const KNOWLEDGE_MAX_VECTOR_DIMENSION = 8192

export function isKnowledgeEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= KNOWLEDGE_MAX_VECTOR_DIMENSION
    && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

export function createLocalKnowledgeEmbedding(text: string): number[] {
  const vector = Array.from({ length: KNOWLEDGE_LOCAL_VECTOR_DIMENSION }, () => 0)
  const tokens = tokenizeKnowledgeText(text)
  for (const token of tokens) {
    const index = Math.abs(hashKnowledgeText(token)) % KNOWLEDGE_LOCAL_VECTOR_DIMENSION
    const weight = token.length > 1 ? 1 : 0.62
    vector[index] += weight
  }
  return normalizeKnowledgeVector(vector)
}

export function tokenizeKnowledgeText(text: string): string[] {
  const lower = text.toLowerCase()
  const words = lower.match(/[a-z0-9_]+(?:[-'][a-z0-9_]+)?/g) ?? []
  const cjk = lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) ?? []
  const cjkBigrams = cjk.slice(0, -1).map((char, index) => `${char}${cjk[index + 1]}`)
  return [...words, ...cjk, ...cjkBigrams].filter(Boolean)
}

export function normalizeKnowledgeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude) return vector
  return vector.map((value) => Number((value / magnitude).toFixed(6)))
}

export function knowledgeCosineSimilarity(left: number[], right: number[]): number {
  if (!isKnowledgeEmbedding(left) || !isKnowledgeEmbedding(right) || left.length !== right.length) return 0
  // Providers need not return unit vectors. Scale first to avoid overflow.
  const leftScale = Math.max(...left.map(Math.abs))
  const rightScale = Math.max(...right.map(Math.abs))
  if (!leftScale || !rightScale) return 0
  let sum = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] / leftScale
    const b = right[index] / rightScale
    sum += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  return Math.max(0, Math.min(1, sum / Math.sqrt(leftNorm * rightNorm)))
}

export function parseKnowledgeEmbedding(raw?: string): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isKnowledgeEmbedding(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function hashKnowledgeText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash | 0
}
