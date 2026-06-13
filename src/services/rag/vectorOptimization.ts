/**
 * LSH (Locality-Sensitive Hashing) 向量分桶
 * 用于加速向量相似度搜索
 */

export interface LSHConfig {
  numBits: number // 哈希位数，默认 16
  dimension: number // 向量维度
  seed?: number // 随机种子，用于生成投影矩阵
}

export interface LSHProjections {
  config: LSHConfig
  projections: Float32Array[] // 随机投影向量
}

/**
 * 生成 LSH 随机投影矩阵
 */
export function generateLSHProjections(config: LSHConfig): LSHProjections {
  const { numBits, dimension, seed = 42 } = config
  const projections: Float32Array[] = []

  // 使用确定性随机数生成器（用于可复现性）
  let rng = seed
  const random = () => {
    rng = (rng * 1664525 + 1013904223) % 4294967296
    return (rng / 4294967296) * 2 - 1 // [-1, 1]
  }

  for (let i = 0; i < numBits; i++) {
    const projection = new Float32Array(dimension)
    for (let j = 0; j < dimension; j++) {
      projection[j] = random()
    }
    // 归一化投影向量
    const norm = Math.sqrt(projection.reduce((sum, v) => sum + v * v, 0))
    for (let j = 0; j < dimension; j++) {
      projection[j] /= norm
    }
    projections.push(projection)
  }

  return { config, projections }
}

/**
 * 计算向量的 LSH 哈希值
 */
export function computeLSHHash(
  embedding: Float32Array,
  projections: LSHProjections
): number {
  let hash = 0

  for (let i = 0; i < projections.projections.length; i++) {
    const projection = projections.projections[i]
    let dot = 0

    for (let j = 0; j < embedding.length; j++) {
      dot += embedding[j] * projection[j]
    }

    if (dot > 0) {
      hash |= (1 << i)
    }
  }

  return hash
}

/**
 * 计算两个哈希值的汉明距离
 */
export function hammingDistance(hash1: number, hash2: number): number {
  let xor = hash1 ^ hash2
  let count = 0

  while (xor !== 0) {
    count += xor & 1
    xor >>>= 1
  }

  return count
}

/**
 * 获取相似桶（汉明距离 <= threshold 的桶）
 */
export function getSimilarBuckets(
  queryHash: number,
  maxHammingDistance: number = 2,
  numBits: number = 16
): number[] {
  const buckets: number[] = [queryHash]

  if (maxHammingDistance === 0) {
    return buckets
  }

  // 生成所有汉明距离 <= maxHammingDistance 的哈希值
  const queue: Array<{ hash: number; dist: number }> = [{ hash: queryHash, dist: 0 }]
  const seen = new Set<number>([queryHash])

  while (queue.length > 0) {
    const { hash, dist } = queue.shift()!

    if (dist >= maxHammingDistance) continue

    // 翻转每一位
    for (let bit = 0; bit < numBits; bit++) {
      const newHash = hash ^ (1 << bit)

      if (!seen.has(newHash)) {
        seen.add(newHash)
        buckets.push(newHash)
        queue.push({ hash: newHash, dist: dist + 1 })
      }
    }
  }

  return buckets
}

/**
 * 优化的点积计算（4路展开）
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0
  const len = a.length
  const len4 = len - (len % 4)

  // 4路展开
  for (let i = 0; i < len4; i += 4) {
    sum += a[i] * b[i]
    sum += a[i + 1] * b[i + 1]
    sum += a[i + 2] * b[i + 2]
    sum += a[i + 3] * b[i + 3]
  }

  // 处理余数
  for (let i = len4; i < len; i++) {
    sum += a[i] * b[i]
  }

  return sum
}

/**
 * 计算向量范数
 */
export function computeNorm(embedding: Float32Array): number {
  let sum = 0
  const len = embedding.length
  const len4 = len - (len % 4)

  // 4路展开
  for (let i = 0; i < len4; i += 4) {
    sum += embedding[i] * embedding[i]
    sum += embedding[i + 1] * embedding[i + 1]
    sum += embedding[i + 2] * embedding[i + 2]
    sum += embedding[i + 3] * embedding[i + 3]
  }

  // 处理余数
  for (let i = len4; i < len; i++) {
    sum += embedding[i] * embedding[i]
  }

  return Math.sqrt(sum)
}

/**
 * 优化的余弦相似度计算（使用预计算的范数）
 */
export function cosineSimilarity(
  a: Float32Array,
  aNorm: number,
  b: Float32Array,
  bNorm: number
): number {
  const dot = dotProduct(a, b)
  return dot / (aNorm * bNorm)
}

/**
 * 带早期终止的余弦相似度计算
 */
export function cosineSimilarityWithEarlyStop(
  query: Float32Array,
  queryNorm: number,
  candidate: Float32Array,
  candidateNorm: number,
  threshold: number = 0.5,
  checkInterval: number = 64
): number | null {
  let dot = 0
  let partialQueryNorm = 0
  let partialCandidateNorm = 0

  for (let i = 0; i < query.length; i++) {
    dot += query[i] * candidate[i]

    // 每 checkInterval 维检查一次
    if ((i + 1) % checkInterval === 0) {
      partialQueryNorm = 0
      partialCandidateNorm = 0

      for (let j = 0; j <= i; j++) {
        partialQueryNorm += query[j] * query[j]
        partialCandidateNorm += candidate[j] * candidate[j]
      }

      // 估算最大可能相似度
      const maxPossibleSim = dot / Math.sqrt(partialQueryNorm * partialCandidateNorm)

      // 如果最大可能相似度 < threshold * 0.8，提前终止
      if (maxPossibleSim < threshold * 0.8) {
        return null
      }
    }
  }

  return dot / (queryNorm * candidateNorm)
}

/**
 * 批量计算余弦相似度（优化内存访问）
 */
export interface SimilarityResult {
  index: number
  similarity: number
}

export function batchCosineSimilarity(
  query: Float32Array,
  queryNorm: number,
  candidates: Float32Array[],
  candidateNorms: number[],
  threshold: number = 0
): SimilarityResult[] {
  const results: SimilarityResult[] = []

  for (let i = 0; i < candidates.length; i++) {
    const similarity = cosineSimilarity(query, queryNorm, candidates[i], candidateNorms[i])

    if (similarity >= threshold) {
      results.push({ index: i, similarity })
    }
  }

  return results
}

/**
 * Top-K 堆排序（避免完整排序）
 */
export class TopKHeap {
  private heap: SimilarityResult[]
  private k: number

  constructor(k: number) {
    this.k = k
    this.heap = []
  }

  add(result: SimilarityResult): void {
    if (this.heap.length < this.k) {
      this.heap.push(result)
      this.heapifyUp(this.heap.length - 1)
    } else if (result.similarity > this.heap[0].similarity) {
      this.heap[0] = result
      this.heapifyDown(0)
    }
  }

  getTopK(): SimilarityResult[] {
    return this.heap.sort((a, b) => b.similarity - a.similarity)
  }

  private heapifyUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)

      if (this.heap[index].similarity >= this.heap[parentIndex].similarity) break

      [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]]
      index = parentIndex
    }
  }

  private heapifyDown(index: number): void {
    while (true) {
      const leftIndex = 2 * index + 1
      const rightIndex = 2 * index + 2
      let minIndex = index

      if (leftIndex < this.heap.length && this.heap[leftIndex].similarity < this.heap[minIndex].similarity) {
        minIndex = leftIndex
      }

      if (rightIndex < this.heap.length && this.heap[rightIndex].similarity < this.heap[minIndex].similarity) {
        minIndex = rightIndex
      }

      if (minIndex === index) break

      [this.heap[index], this.heap[minIndex]] = [this.heap[minIndex], this.heap[index]]
      index = minIndex
    }
  }
}
