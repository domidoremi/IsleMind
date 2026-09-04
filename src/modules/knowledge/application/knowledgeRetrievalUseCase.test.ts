import { createKnowledgeRetrievalUseCase } from './knowledgeRetrievalUseCase'
import { runAgenticRag } from './ragOrchestration'
import type { Settings } from '@/types/settingsContracts'

describe('knowledge retrieval diagnostics', () => {
  it('keeps the FTS fallback available when diagnostic reporting fails', async () => {
    const retrieval = createKnowledgeRetrievalUseCase<{
      id: string
      documentId: string
      title: string
    }>({
      async searchFts() {
        return [{ id: 'fallback', documentId: 'doc-1', title: 'Fallback source' }]
      },
      indexedSearch: {
        async searchHybrid() {
          throw new Error('hybrid index unavailable')
        },
        async searchAgentic() {
          return []
        },
      },
      async report() {
        throw new Error('diagnostics unavailable')
      },
    })

    await expect(retrieval.searchWithFallback({
      query: 'fallback source',
      limit: 1,
      ragMode: 'hybrid',
      embeddingMode: 'local',
    })).resolves.toEqual([{ id: 'fallback', documentId: 'doc-1', title: 'Fallback source' }])
  })

  it('does not turn an agentic miss into a diagnostic failure', async () => {
    const retrieval = createKnowledgeRetrievalUseCase<{ id: string; title?: string }>({
      async searchFts() { return [] },
      indexedSearch: {
        async searchHybrid() { return [] },
        async searchAgentic() { throw new Error('agentic index unavailable') },
      },
      async report() { throw new Error('diagnostics unavailable') },
    })

    await expect(retrieval.searchAgentic({ query: 'missing', limit: 4 })).resolves.toEqual([])
  })

  it('keeps fast Chat retrieval on FTS without invoking advanced indexes', async () => {
    const retrievalModes: Array<'baseline' | 'advanced' | undefined> = []
    let agenticCalls = 0
    const settings = {
      language: 'en',
      ragMode: 'hybrid',
      ragProfile: 'fast',
      ragQueryRewriteEnabled: true,
    } as Settings

    await runAgenticRag({
      query: 'find the local note',
      settings,
      retrieveKnowledge: async (_query, _limit, options) => {
        retrievalModes.push(options?.mode)
        return [{
          id: 'fts-source',
          type: 'knowledge',
          title: 'Local note',
          content: 'A local note returned through FTS.',
        }]
      },
      retrieveAgentic: async () => {
        agenticCalls += 1
        return []
      },
    })

    expect(retrievalModes).toEqual(['baseline'])
    expect(agenticCalls).toBe(0)
  })

  it('keeps a balanced complex Chat query on FTS without invoking advanced indexes', async () => {
    const retrievalModes: Array<'baseline' | 'advanced' | undefined> = []
    let agenticCalls = 0
    const settings = {
      language: 'en',
      ragMode: 'hybrid',
      ragProfile: 'balanced',
      ragQueryRewriteEnabled: true,
      ragRaptorEnabled: true,
      ragGraphEnabled: true,
    } as Settings

    await runAgenticRag({
      query: 'Compare the migration risks across local notes and explain their relationships.',
      settings,
      retrieveKnowledge: async (_query, _limit, options) => {
        retrievalModes.push(options?.mode)
        return [{
          id: 'balanced-fts-source',
          type: 'knowledge',
          title: 'Migration note',
          content: 'A local note returned through the baseline FTS path.',
        }]
      },
      retrieveAgentic: async () => {
        agenticCalls += 1
        return []
      },
    })

    expect(retrievalModes.length).toBeGreaterThan(0)
    expect(retrievalModes.every((mode) => mode === 'baseline')).toBe(true)
    expect(agenticCalls).toBe(0)
  })

  it('admits hybrid and agentic retrieval only for an explicit deep plan', async () => {
    const retrievalModes: Array<'baseline' | 'advanced' | undefined> = []
    let agenticCalls = 0
    const settings = {
      language: 'en',
      ragMode: 'hybrid',
      ragProfile: 'deep',
      ragColbertEnabled: true,
    } as Settings

    await runAgenticRag({
      query: 'compare indexed notes',
      settings,
      retrieveKnowledge: async (_query, _limit, options) => {
        retrievalModes.push(options?.mode)
        return [{
          id: 'hybrid-source',
          type: 'knowledge',
          title: 'Indexed note',
          content: 'An indexed note returned through the advanced path.',
        }]
      },
      retrieveAgentic: async () => {
        agenticCalls += 1
        return []
      },
    })

    expect(retrievalModes.length).toBeGreaterThan(0)
    expect(retrievalModes.every((mode) => mode === 'advanced')).toBe(true)
    expect(agenticCalls).toBe(1)
  })

  it('surfaces embedding fallback reasons in RAG quality evidence', async () => {
    const settings = {
      language: 'en',
      ragMode: 'hybrid',
      ragProfile: 'fast',
    } as Settings

    const result = await runAgenticRag({
      query: 'find the local note',
      settings,
      retrieveKnowledge: async (_query, _limit, options) => {
        options?.onEmbeddingResolved?.({ source: 'local-hash', reason: 'provider_embedding_failed' })
        return [{
          id: 'fallback-source',
          type: 'knowledge',
          title: 'Fallback note',
          content: 'A local hash fallback result.',
        }]
      },
    })

    expect(result.quality.fallbackReasons).toEqual([
      'embedding-local-hash',
      'embedding-provider-failed',
    ])
  })
})
