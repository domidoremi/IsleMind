export const KNOWLEDGE_LOCAL_VECTOR_DIMENSION = 128

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
  const length = Math.min(left.length, right.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index]
  }
  return Math.max(0, Math.min(1, sum))
}

export function parseKnowledgeEmbedding(raw?: string): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.every((value) => typeof value === 'number') ? parsed : null
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
