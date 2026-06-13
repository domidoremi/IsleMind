/**
 * 向量优化相关功能的单元测试
 */

import {
  generateLSHProjections,
  computeLSHHash,
  hammingDistance,
  getSimilarBuckets,
  dotProduct,
  computeNorm,
  cosineSimilarity,
  cosineSimilarityWithEarlyStop,
  TopKHeap,
} from '../vectorOptimization'

describe('LSH (Locality-Sensitive Hashing)', () => {
  describe('generateLSHProjections', () => {
    it('should generate correct number of projections', () => {
      const config = { numBits: 16, dimension: 384, seed: 42 }
      const projections = generateLSHProjections(config)

      expect(projections.projections).toHaveLength(16)
      expect(projections.config).toEqual(config)
    })

    it('should generate normalized projection vectors', () => {
      const config = { numBits: 8, dimension: 128, seed: 42 }
      const projections = generateLSHProjections(config)

      projections.projections.forEach(projection => {
        const norm = Math.sqrt(
          projection.reduce((sum, v) => sum + v * v, 0)
        )
        expect(norm).toBeCloseTo(1.0, 5)
      })
    })

    it('should be deterministic with same seed', () => {
      const config1 = { numBits: 16, dimension: 384, seed: 42 }
      const config2 = { numBits: 16, dimension: 384, seed: 42 }

      const proj1 = generateLSHProjections(config1)
      const proj2 = generateLSHProjections(config2)

      expect(proj1.projections[0][0]).toBe(proj2.projections[0][0])
    })
  })

  describe('computeLSHHash', () => {
    it('should compute consistent hash for same embedding', () => {
      const config = { numBits: 16, dimension: 384, seed: 42 }
      const projections = generateLSHProjections(config)
      const embedding = new Float32Array(384).fill(0.5)

      const hash1 = computeLSHHash(embedding, projections)
      const hash2 = computeLSHHash(embedding, projections)

      expect(hash1).toBe(hash2)
    })

    it('should produce different hashes for different embeddings', () => {
      const config = { numBits: 16, dimension: 384, seed: 42 }
      const projections = generateLSHProjections(config)

      const embedding1 = new Float32Array(384).fill(0.5)
      const embedding2 = new Float32Array(384).fill(-0.5)

      const hash1 = computeLSHHash(embedding1, projections)
      const hash2 = computeLSHHash(embedding2, projections)

      expect(hash1).not.toBe(hash2)
    })

    it('should return integer hash', () => {
      const config = { numBits: 16, dimension: 384, seed: 42 }
      const projections = generateLSHProjections(config)
      const embedding = new Float32Array(384).fill(0.5)

      const hash = computeLSHHash(embedding, projections)

      expect(Number.isInteger(hash)).toBe(true)
      expect(hash).toBeGreaterThanOrEqual(0)
      expect(hash).toBeLessThan(2 ** 16)
    })
  })

  describe('hammingDistance', () => {
    it('should return 0 for identical hashes', () => {
      expect(hammingDistance(0b1010, 0b1010)).toBe(0)
    })

    it('should return correct distance for different hashes', () => {
      expect(hammingDistance(0b1010, 0b1011)).toBe(1)
      expect(hammingDistance(0b1010, 0b0101)).toBe(4)
      expect(hammingDistance(0b1111, 0b0000)).toBe(4)
    })
  })

  describe('getSimilarBuckets', () => {
    it('should return only query hash when maxHammingDistance is 0', () => {
      const buckets = getSimilarBuckets(0b1010, 0, 4)
      expect(buckets).toEqual([0b1010])
    })

    it('should return correct number of buckets for distance 1', () => {
      const buckets = getSimilarBuckets(0b1010, 1, 4)
      // Original + 4 neighbors (flip each bit)
      expect(buckets.length).toBe(5)
    })

    it('should include query hash in results', () => {
      const queryHash = 0b1010
      const buckets = getSimilarBuckets(queryHash, 2, 4)
      expect(buckets).toContain(queryHash)
    })
  })
})

describe('Vector Operations', () => {
  describe('dotProduct', () => {
    it('should compute correct dot product', () => {
      const a = new Float32Array([1, 2, 3, 4])
      const b = new Float32Array([2, 3, 4, 5])

      const result = dotProduct(a, b)
      // 1*2 + 2*3 + 3*4 + 4*5 = 2 + 6 + 12 + 20 = 40
      expect(result).toBe(40)
    })

    it('should handle zero vectors', () => {
      const a = new Float32Array([0, 0, 0, 0])
      const b = new Float32Array([1, 2, 3, 4])

      expect(dotProduct(a, b)).toBe(0)
    })

    it('should work with different sizes', () => {
      const a = new Float32Array([1, 2, 3])
      const b = new Float32Array([4, 5, 6])

      const result = dotProduct(a, b)
      // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
      expect(result).toBe(32)
    })
  })

  describe('computeNorm', () => {
    it('should compute correct L2 norm', () => {
      const v = new Float32Array([3, 4])
      const norm = computeNorm(v)

      // sqrt(3^2 + 4^2) = sqrt(25) = 5
      expect(norm).toBe(5)
    })

    it('should handle unit vectors', () => {
      const v = new Float32Array([1, 0, 0])
      expect(computeNorm(v)).toBe(1)
    })

    it('should handle zero vector', () => {
      const v = new Float32Array([0, 0, 0])
      expect(computeNorm(v)).toBe(0)
    })
  })

  describe('cosineSimilarity', () => {
    it('should return 1 for identical normalized vectors', () => {
      const a = new Float32Array([1, 0, 0])
      const b = new Float32Array([1, 0, 0])
      const normA = computeNorm(a)
      const normB = computeNorm(b)

      const sim = cosineSimilarity(a, normA, b, normB)
      expect(sim).toBeCloseTo(1.0, 5)
    })

    it('should return 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0])
      const b = new Float32Array([0, 1])
      const normA = computeNorm(a)
      const normB = computeNorm(b)

      const sim = cosineSimilarity(a, normA, b, normB)
      expect(sim).toBeCloseTo(0, 5)
    })

    it('should return -1 for opposite vectors', () => {
      const a = new Float32Array([1, 0])
      const b = new Float32Array([-1, 0])
      const normA = computeNorm(a)
      const normB = computeNorm(b)

      const sim = cosineSimilarity(a, normA, b, normB)
      expect(sim).toBeCloseTo(-1.0, 5)
    })
  })

  describe('cosineSimilarityWithEarlyStop', () => {
    it('should return null for dissimilar vectors', () => {
      const query = new Float32Array(384).fill(1)
      const candidate = new Float32Array(384).fill(-1)
      const queryNorm = computeNorm(query)
      const candidateNorm = computeNorm(candidate)

      const sim = cosineSimilarityWithEarlyStop(
        query,
        queryNorm,
        candidate,
        candidateNorm,
        0.5,
        64
      )

      expect(sim).toBeNull()
    })

    it('should return similarity for similar vectors', () => {
      const query = new Float32Array(384).fill(1)
      const candidate = new Float32Array(384).fill(0.9)
      const queryNorm = computeNorm(query)
      const candidateNorm = computeNorm(candidate)

      const sim = cosineSimilarityWithEarlyStop(
        query,
        queryNorm,
        candidate,
        candidateNorm,
        0.5,
        64
      )

      expect(sim).not.toBeNull()
      expect(sim).toBeGreaterThan(0.5)
    })
  })
})

describe('TopKHeap', () => {
  it('should maintain top K elements', () => {
    const heap = new TopKHeap(3)

    heap.add({ index: 0, similarity: 0.5 })
    heap.add({ index: 1, similarity: 0.8 })
    heap.add({ index: 2, similarity: 0.3 })
    heap.add({ index: 3, similarity: 0.9 })
    heap.add({ index: 4, similarity: 0.7 })

    const topK = heap.getTopK()

    expect(topK).toHaveLength(3)
    expect(topK[0].similarity).toBe(0.9)
    expect(topK[1].similarity).toBe(0.8)
    expect(topK[2].similarity).toBe(0.7)
  })

  it('should handle fewer than K elements', () => {
    const heap = new TopKHeap(5)

    heap.add({ index: 0, similarity: 0.5 })
    heap.add({ index: 1, similarity: 0.8 })

    const topK = heap.getTopK()

    expect(topK).toHaveLength(2)
    expect(topK[0].similarity).toBe(0.8)
  })

  it('should return empty array when no elements added', () => {
    const heap = new TopKHeap(3)
    const topK = heap.getTopK()

    expect(topK).toEqual([])
  })

  it('should maintain correct order with duplicate similarities', () => {
    const heap = new TopKHeap(3)

    heap.add({ index: 0, similarity: 0.5 })
    heap.add({ index: 1, similarity: 0.5 })
    heap.add({ index: 2, similarity: 0.5 })
    heap.add({ index: 3, similarity: 0.8 })

    const topK = heap.getTopK()

    expect(topK).toHaveLength(3)
    expect(topK[0].similarity).toBe(0.8)
  })
})
