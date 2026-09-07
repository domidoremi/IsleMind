// Run with Bun: real SQLite FTS5, canonical hybrid/query/fallback policies and RAG packing.
// No provider calls, model downloads, user data, or gold labels enter the retriever.
const assert = require('node:assert/strict')
const { Database } = require('bun:sqlite')
const { performance } = require('node:perf_hooks')

const corpus = [
  ['retry', 'Safe retries', 'Use an idempotency key for an external side effect. If the request timed out after dispatch, reconcile its outcome before retrying. Never replay a payment automatically.'],
  ['backup', 'Portable backups', 'Portable JSON backup exports omit API keys and attachment payloads. Restore validates the envelope before writing local records. Keep the original media separately.'],
  ['mcp', 'MCP routing', 'Streamable HTTP requests use Mcp-Method and Mcp-Name headers. Tool results marked isError are failures even when HTTP status is 200.'],
  ['onnx', 'Local embeddings', 'ONNX embeddings require the model tokenizer, correct pooling and output dimension. Reject non-finite vectors and retry transient initialization failures.'],
  ['memory', 'Scoped memory', 'Memory supersession disables an old fact when a correction arrives. Conversation scope and workspace scope must not leak into another conversation.'],
  ['fts', 'SQLite search', 'SQLite FTS5 BM25 returns negative scores. Numerically lower scores indicate stronger matches. Vector similarity uses the opposite ordering direction.'],
  ['zh-cancel', '任务取消', '取消任务后必须停止网络请求，释放资源并保存中断状态。重新启动应用时不要自动重复执行外部操作。'],
  ['zh-private', '本地隐私', '聊天记录和知识文档默认保存在本机。导出备份不包含密钥。删除记忆后，应当同时删除相关检索索引。'],
  ['zh-knowledge', '知识库检索', '混合检索结合关键词搜索与向量相似度。回答应保留原始文档引用，证据不足时明确说明不确定。'],
  ['ja-recovery', '再起動と復旧', 'アプリを再起動した後は中断されたタスクを表示します。外部操作を自動的に繰り返してはいけません。'],
  ['ja-backup', 'バックアップ', 'バックアップには会話と文書を保存します。秘密の認証情報は含めません。復元する前に内容を検証します。'],
  ['mixed', 'ONNX 本地模型', 'ONNX 本地嵌入模型可在离线时使用。tokenizer 必须与模型一致，不能仅凭向量维度相同就混用不同模型。'],
  ['travel', 'Travel notes', 'The island ferry departs at 08:30. Bring a raincoat and a local map. Reservations are not automatically refunded.'],
  ['food', 'Recipe notes', 'Bake the sourdough bread at 230 degrees. Allow the dough to rest. This notebook contains no application configuration.'],
  ['scope-target', 'Selected notebook', 'The selected notebook records the recovery code ORCHID-27 for the island archive.'],
  ...Array.from({ length: 26 }, (_, i) => [
    `scope-decoy-${i}`, 'Other notebook',
    'ORCHID-27 ORCHID-27 ORCHID-27 recovery code for a different notebook. Do not use this document outside its selected scope.',
  ]),
]

// Hand-labelled multilingual product scenarios, not a claim about a production distribution.
const cases = [
  ['en-retry', 'idempotency key external side effect timeout', ['retry']],
  ['en-backup', 'portable JSON backup exports API keys', ['backup']],
  ['en-mcp', 'Mcp-Method Mcp-Name isError HTTP', ['mcp']],
  ['en-onnx', 'ONNX tokenizer pooling dimension', ['onnx']],
  ['en-memory', 'memory supersession conversation scope correction', ['memory']],
  ['en-fts', 'SQLite FTS5 BM25 negative scores', ['fts']],
  ['zh-cancel', '取消任务后如何释放资源', ['zh-cancel']],
  ['zh-private', '删除记忆和检索索引', ['zh-private']],
  ['zh-knowledge', '混合检索与原始文档引用', ['zh-knowledge']],
  ['ja-recovery', '再起動されたタスクと外部操作', ['ja-recovery']],
  ['ja-backup', 'バックアップの認証情報', ['ja-backup']],
  ['mixed', 'ONNX 离线嵌入模型 tokenizer', ['mixed']],
  ['scoped', 'ORCHID-27 recovery code', ['scope-target'], ['scope-target']],
]

async function main() {
  const knowledge = await import('../src/modules/knowledge/index.ts')
  const db = new Database(':memory:')
  try {
    const provider = sqliteProvider(db)
    const clock = { now: () => 1_800_000_000_000 }
    const repository = knowledge.createSqliteKnowledgeRepository(provider, { clock })
    const queryEmbedding = knowledge.createKnowledgeQueryEmbeddingUseCase({
      embedWithOnnx: async () => null,
      embedWithProvider: async () => { throw new Error('This evaluation must not call a provider') },
      notifyProviderUnsupported: async () => {},
    })
    const index = knowledge.createSqliteKnowledgeHybridIndex(provider, { repository, queryEmbedding, clock })
    const signal = new AbortController().signal
    for (const [id, title, content] of corpus) {
      const document = {
        schema: knowledge.KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id, title, mimeType: 'text/plain',
        size: Buffer.byteLength(content), chunkCount: 1, status: 'ready',
        sourceUri: `file:///evaluation/${id}.txt`, createdAt: clock.now(), updatedAt: clock.now(),
      }
      const chunks = [{
        schema: knowledge.KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: `${id}-0`, documentId: id,
        title, content, ordinal: 0, chunkIndex: 0, createdAt: clock.now(), embeddingProvider: 'hash',
      }]
      await repository.saveDocument(document, chunks, { signal })
      await index.synchronize(document, chunks, { signal })
    }
    const retrieval = knowledge.createKnowledgeRetrievalUseCase({
      async searchFts(query, limit, options) {
        const rows = await repository.searchFts({ query, limit, ...options })
        return knowledge.rerankKnowledgeSources(query, rows.map(row => ({
          ...row, type: 'knowledge', chunkId: row.id, ftsScore: row.score,
          // Raw BM25 is distinct from an already-normalized relevance score.
          score: undefined,
        })), limit)
      },
      indexedSearch: {
        searchHybrid: async input => (await index.searchHybrid(input)).map(row => ({
          ...row, type: 'knowledge', chunkId: row.id,
        })),
        searchAgentic: async () => { throw new Error('Optional indexes are outside this evaluation') },
      },
    })
    // Harder paraphrases/cross-language questions are measurement-only: do not
    // hide misses or tune a replacement against the hash fallback alone.
    const challenges = [
      ['paraphrase-retry', 'How to avoid charging someone twice when the connection drops after a request?', ['retry']],
      ['paraphrase-memory', 'What happens to an older fact after the user corrects their preference?', ['memory']],
      ['cross-language-model', 'Can embeddings from different vendors be mixed when their array lengths happen to match?', ['mixed']],
      ['zh-offline', '手机没有网络时，本地笔记还能通过哪些方式找到？', ['mixed']],
      ['ja-portable', '認証キーを持ち出さずに別の端末へ記録を移すには？', ['ja-backup']],
      ['paraphrase-travel', 'When does the boat leave for the island?', ['travel']],
    ]
    const results = []
    let citationCount = 0
    const modes = ['fts', 'hybrid', 'hybrid-packed', 'hybrid-rewrite']
    for (const mode of modes) {
      for (const [id, query, expectedIds, scope] of [...cases, ...challenges]) {
        await index.clearCache({ signal })
        const input = {
          query, limit: 5, ragMode: mode === 'fts' ? 'fts' : 'hybrid', embeddingMode: 'local',
          localEmbeddingModelSource: 'none', knowledgeScope: knowledge.buildKnowledgeScope(scope), signal,
        }
        const started = performance.now()
        let selected
        let retrievalCalls = 0
        if (mode === 'hybrid-rewrite' || mode === 'hybrid-packed') {
          const pack = await knowledge.runAgenticRag({
            query, profile: 'balanced', signal, maxContextItems: 5, tokenBudget: 2800,
            settings: { language: 'en', ragMode: 'hybrid', ragProfile: 'balanced', ragQueryRewriteEnabled: mode === 'hybrid-rewrite' },
            retrieveKnowledge: (query, limit, options) => {
              retrievalCalls += 1
              return retrieval.searchWithFallback({ ...input, query, limit, signal: options?.signal })
            },
          })
          selected = pack.sources
          for (const [i, citation] of pack.citations.entries()) {
            assert.equal(citation.chunkId, selected[i].chunkId)
            assert.equal(citation.sourceUri, `file:///evaluation/${citation.documentId}.txt`)
            assert.equal(citation.label, `[${i + 1}]`)
            citationCount += 1
          }
        } else {
          retrievalCalls = 1
          selected = await retrieval.searchWithFallback(input)
        }
        const elapsedMs = performance.now() - started
        const ids = selected.map(source => source.documentId)
        for (const source of selected) {
          const original = corpus.find(row => row[0] === source.documentId)
          assert.ok(original, 'Every hit resolves to a canonical document')
          assert.equal(source.chunkId, `${original[0]}-0`)
          assert.equal(source.sourceUri, `file:///evaluation/${original[0]}.txt`)
          if (mode === 'fts' || mode === 'hybrid') assert.equal(source.content, original[2])
          if (scope) assert.ok(scope.includes(source.documentId), 'Scoped retrieval never returns another notebook')
        }
        const ranks = expectedIds.map(expected => ids.indexOf(expected)).filter(rank => rank >= 0)
        const dcg = ranks.reduce((sum, rank) => sum + 1 / Math.log2(rank + 2), 0)
        const ideal = expectedIds.reduce((sum, _, rank) => sum + 1 / Math.log2(rank + 2), 0)
        results.push({ mode, id, cohort: cases.some(item => item[0] === id) ? 'regression' : 'challenge', retrievalCalls, recall5: ranks.length / expectedIds.length,
          mrr5: ranks.length ? 1 / (Math.min(...ranks) + 1) : 0, ndcg5: dcg / ideal,
          elapsedMs, sourceIds: ids })
        if (mode === 'hybrid') {
          const cached = await retrieval.searchWithFallback(input)
          assert.deepEqual(cached, selected, 'Warm-cache results preserve ranking and provenance')
        }
      }
    }
    const round = n => Number(n.toFixed(4))
    const summaries = ['regression', 'challenge'].flatMap(cohort => modes.map(mode => {
      const rows = results.filter(row => row.mode === mode && row.cohort === cohort)
      const mean = key => round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length)
      const times = rows.map(row => row.elapsedMs).sort((a, b) => a - b)
      return { cohort, mode, cases: rows.length, recall5: mean('recall5'), mrr5: mean('mrr5'), ndcg5: mean('ndcg5'), meanRetrievalCalls: mean('retrievalCalls'),
        hostP50Ms: round(times[Math.floor(times.length / 2)]), hostP95Ms: round(times[Math.ceil(times.length * .95) - 1]) }
    }))
    console.log(JSON.stringify({ corpusDocuments: corpus.length, embedding: 'local-hash (real offline fallback, not neural ONNX)',
      sqlite: db.query('SELECT sqlite_version() AS version').get().version,
      storageBytes: db.query('PRAGMA page_count').get().page_count * db.query('PRAGMA page_size').get().page_size,
      citationIdentityChecks: citationCount, summaries,
      misses: results.filter(row => row.recall5 < 1).map(({ elapsedMs, ...row }) => row),
    }, null, 2))
    // This small known-answer corpus guards basic evidence recall, not open-ended answer quality.
    assert.ok(results.filter(row => row.cohort === 'regression').every(row => row.recall5 === 1), 'Every original regression query must retrieve its labelled evidence within five hits')
    await evaluateCorpusCoverage(knowledge)
    console.log('Knowledge retrieval runtime evaluation passed')
  } finally {
    db.close()
  }
}

async function evaluateCorpusCoverage(knowledge) {
  // Controlled geometry tests candidate coverage and exact-ranking agreement,
  // not the semantic quality of an embedding model. No provider is contacted.
  const measurements = []
  for (const count of [701, 4097]) {
    const db = new Database(':memory:')
    try {
      let pages = []
      const provider = sqliteProvider(db, (sql, rows) => {
        if (sql.includes('e.embeddingJson, e.source, e.model')) pages.push(rows.map(row => row.id))
      })
      const clock = { now: () => 1_800_000_000_000 }
      const repository = knowledge.createSqliteKnowledgeRepository(provider, { clock })
      let queryVector
      let embeddingCalls = 0
      const model = 'synthetic-coverage-space'
      const queryEmbedding = knowledge.createKnowledgeQueryEmbeddingUseCase({
        embedWithOnnx: async () => null,
        embedWithProvider: async () => { embeddingCalls += 1; return { embedding: queryVector, model } },
        notifyProviderUnsupported: async () => { throw new Error('The synthetic adapter is configured') },
      })
      const index = knowledge.createSqliteKnowledgeHybridIndex(provider, {
        repository, queryEmbedding, clock, cacheTtlMs: 0,
        resolveProviderEmbeddingState: () => ({ configured: true, supportsEmbeddings: true }),
      })
      const signal = new AbortController().signal
      const document = {
        schema: knowledge.KNOWLEDGE_DOCUMENT_RECORD_SCHEMA, id: 'archive', title: 'Notebook archive',
        mimeType: 'text/plain', size: count * 120, chunkCount: count, status: 'ready',
        sourceUri: 'archive.txt', createdAt: clock.now(), updatedAt: clock.now(),
      }
      const chunks = Array.from({ length: count }, (_, ordinal) => ({
        schema: knowledge.KNOWLEDGE_CHUNK_RECORD_SCHEMA, id: `chunk-${String(ordinal).padStart(5, '0')}`,
        documentId: document.id, title: document.title,
        content: 'Residents kept disconnected notebooks. The manuscript contains archival notes and recorded local observations.',
        ordinal, chunkIndex: ordinal, embeddingProvider: 'hash', createdAt: clock.now() + ordinal,
        sourceUri: document.sourceUri,
      }))
      await repository.saveDocument(document, chunks, { signal })
      await index.synchronize(document, chunks, { signal })
      let randomState = 0x51e2026
      const random = () => {
        randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5
        return (randomState >>> 0) / 0xffffffff * 2 - 1
      }
      const vectors = chunks.map((_, i) => count === 701
        ? (i === 0 ? [1, 0] : [0, 1])
        : Array.from({ length: 384 }, random))
      const update = db.query("UPDATE chunk_embeddings SET embeddingJson = ?, dimension = ?, source = 'provider', model = ?, status = 'ready' WHERE chunkId = ?")
      db.transaction(() => chunks.forEach((chunk, i) => update.run(JSON.stringify(vectors[i]), vectors[i].length, model, chunk.id)))()
      const query = 'genesis rationale'
      assert.equal((await repository.searchFts({ query, limit: 5, signal })).length, 0, 'Lexical hits cannot mask vector coverage in this cohort')
      for (const target of count === 701 ? [0] : [0, 2048, 4096]) {
        queryVector = vectors[target]
        pages = []
        const callsBefore = embeddingCalls
        const started = performance.now()
        const actual = await index.searchHybrid({ query, limit: 5, embeddingMode: 'provider', provider: {}, signal })
        const elapsedMs = performance.now() - started
        const scanPages = pages
        const candidates = chunks.flatMap((chunk, i) => {
          const vectorScore = knowledge.knowledgeCosineSimilarity(queryVector, vectors[i])
          return vectorScore > 0 ? [{ ...chunk, score: vectorScore, vectorScore, retrievalMode: 'vector' }] : []
        }).sort((a, b) => b.vectorScore - a.vectorScore || b.createdAt - a.createdAt || a.id.localeCompare(b.id)).slice(0, 20)
        const expected = knowledge.rerankKnowledgeSources(query, knowledge.fuseHybridKnowledgeCandidates([], candidates, 'hybrid'), 5)
        assert.deepEqual(actual.map(row => row.id), expected.map(row => row.id), 'Paged results match exhaustive same-policy ranking across the entire corpus')
        assert.ok(actual.some(row => row.id === chunks[target].id), 'Older, middle and latest exact-vector matches remain discoverable')
        assert.equal(embeddingCalls - callsBefore, 1, 'One query embedding is resolved for the whole corpus, not once per page')
        assert.equal(scanPages.flat().length, count)
        assert.equal(new Set(scanPages.flat()).size, count, 'Every scoped chunk is scored once without offset skips/duplicates')
        assert.ok(scanPages.every(page => page.length <= 128), 'Corpus size never increases the maximum vector page transferred to JS')
        for (const hit of actual) {
          assert.equal(hit.sourceUri, document.sourceUri)
          assert.equal(hit.content, chunks[hit.ordinal].content)
          assert.equal(hit.vectorScore, knowledge.knowledgeCosineSimilarity(queryVector, vectors[hit.ordinal]))
        }
        measurements.push({ corpusChunks: count, vectorDimension: queryVector.length, targetOrdinal: target,
          exactRankingAgreement: true, targetRecall5: 1, queryEmbeddingCalls: embeddingCalls - callsBefore,
          scannedRows: scanPages.flat().length, pages: scanPages.length, maxPageRows: Math.max(...scanPages.map(page => page.length)),
          hostElapsedMs: Number(elapsedMs.toFixed(3)) })
      }

      // Source discovery must not infer capability from only the first page or
      // newest rows. Keep a single provider vector at the end of the key range.
      db.query("UPDATE chunk_embeddings SET source = 'local', model = ? WHERE chunkId <> ?")
        .run(knowledge.KNOWLEDGE_LOCAL_HASH_MODEL_ID, chunks.at(-1).id)
      queryVector = vectors.at(-1)
      const callsBefore = embeddingCalls
      const hits = await index.searchHybrid({ query, limit: 5, embeddingMode: 'provider', provider: {}, signal })
      assert.deepEqual(hits.map(hit => hit.id), [chunks.at(-1).id], 'A compatible vector outside the first page is sufficient to select the query source')
      assert.equal(embeddingCalls - callsBefore, 1)
      console.log(JSON.stringify({ coverageStorage: { corpusChunks: count,
        storageBytes: db.query('PRAGMA page_count').get().page_count * db.query('PRAGMA page_size').get().page_size } }))
    } finally { db.close() }
  }
  console.log(JSON.stringify({ corpusCoverage: measurements,
    evidence: 'Real SQLite and production hybrid/query/ranking policies with deterministic synthetic vectors; not model quality or device performance.' }, null, 2))
}

function sqliteProvider(db, observeRows) {
  db.exec('PRAGMA foreign_keys = ON')
  const executor = {
    async exec(sql) { db.exec(sql) },
    async run(sql, args = []) {
      const result = db.query(sql).run(...args)
      return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
    },
    async getFirst(sql, args = []) { return db.query(sql).get(...args) ?? null },
    async getAll(sql, args = []) {
      const rows = db.query(sql).all(...args)
      observeRows?.(sql, rows)
      return rows
    },
  }
  const database = {
    ...executor,
    async transaction(work) {
      db.exec('BEGIN IMMEDIATE')
      try { const value = await work(executor); db.exec('COMMIT'); return value }
      catch (error) { db.exec('ROLLBACK'); throw error }
    },
  }
  return { get: async () => database }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
