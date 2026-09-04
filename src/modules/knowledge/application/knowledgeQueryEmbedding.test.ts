import {
  createKnowledgeQueryEmbeddingUseCase,
} from './knowledgeQueryEmbedding'

describe('knowledge query embedding fallback diagnostics', () => {
  it('reports an explicit local-hash request', async () => {
    const resolved: unknown[] = []
    const useCase = createKnowledgeQueryEmbeddingUseCase({
      async embedWithOnnx() { return null },
      async embedWithProvider() { return [1, 0] },
      async notifyProviderUnsupported() {},
    })

    const embedding = await useCase.resolve({
      query: 'local query',
      chunks: [],
      embeddingMode: 'local',
      providerConfigured: false,
      providerSupportsEmbeddings: false,
      onResolved: (notice) => resolved.push(notice),
    })

    expect(embedding.length).toBeGreaterThan(0)
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
      chunks: [{ source: 'provider', embeddingJson: '[1, 0]' }],
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
      async embedWithProvider() { return [0.25, 0.75] },
      async notifyProviderUnsupported() {},
    })

    await expect(useCase.resolve({
      query: 'provider query',
      chunks: [{ source: 'provider', embeddingJson: '[1, 0]' }],
      embeddingMode: 'provider',
      provider: { id: 'provider-1' },
      providerConfigured: true,
      providerSupportsEmbeddings: true,
      onResolved: (notice) => resolved.push(notice),
    })).resolves.toEqual([0.25, 0.75])

    expect(resolved).toEqual([{ source: 'provider' }])
  })
})
