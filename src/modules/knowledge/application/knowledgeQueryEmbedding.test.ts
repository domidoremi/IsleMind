import {
  createKnowledgeQueryEmbeddingUseCase,
} from './knowledgeQueryEmbedding'

describe('knowledge query embedding fallback diagnostics', () => {
  it('reports an explicit local-hash request', async () => {
    const resolved: unknown[] = []
    const useCase = createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx() { return null },
      async embedWithProvider() { return { embedding: [1, 0], model: 'test-model' } },
      async notifyProviderUnsupported() {},
    })

    const embedding = await useCase.resolve({
      query: 'local query',
      availableSources: [],
      embeddingMode: 'local',
      providerConfigured: false,
      providerSupportsEmbeddings: false,
      onResolved: (notice) => resolved.push(notice),
    })

    expect(embedding.embedding.length).toBeGreaterThan(0)
    expect(embedding.source).toBe('local')
    expect(resolved).toEqual([{ source: 'local-hash', reason: 'local_embedding_requested' }])
  })

  it('reports provider failure before falling back to the local hash vector', async () => {
    const resolved: unknown[] = []
    const useCase = createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx() { return null },
      async embedWithProvider() { throw new Error('provider unavailable') },
      async notifyProviderUnsupported() {},
    })

    await useCase.resolve({
      query: 'provider query',
      availableSources: ['provider'],
      embeddingMode: 'hybrid',
      provider: { id: 'provider-1' },
      providerConfigured: true,
      providerSupportsEmbeddings: true,
      onResolved: (notice) => resolved.push(notice),
    })

    expect(resolved).toEqual([{ source: 'local-hash', reason: 'provider_embedding_failed' }])
  })

  it('reports a successful provider embedding without a fallback notice', async () => {
    const resolved: unknown[] = []
    const useCase = createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx() { return null },
      async embedWithProvider() { return { embedding: [0.25, 0.75], model: 'test-model' } },
      async notifyProviderUnsupported() {},
    })

    await expect(useCase.resolve({
      query: 'provider query',
      availableSources: ['provider'],
      embeddingMode: 'provider',
      provider: { id: 'provider-1' },
      providerConfigured: true,
      providerSupportsEmbeddings: true,
      onResolved: (notice) => resolved.push(notice),
    })).resolves.toEqual({ embedding: [0.25, 0.75], model: 'test-model', source: 'provider' })

    expect(resolved).toEqual([{ source: 'provider' }])
  })

  it.each([{ embedding: [] }, { embedding: [NaN] }, { embedding: [Infinity] }])('rejects invalid provider values: %j', async ({ embedding }) => {
    const useCase = createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx() { return null },
      async embedWithProvider() { return { embedding, model: 'test-model' } },
      async notifyProviderUnsupported() {},
    })
    const result = await useCase.resolve({ query: 'test', availableSources: ['provider'],
      provider: {}, providerConfigured: true, providerSupportsEmbeddings: true })
    expect(result.source).toBe('local')
  })
})
