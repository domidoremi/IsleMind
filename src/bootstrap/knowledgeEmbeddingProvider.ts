import * as FileSystem from 'expo-file-system/legacy'
import type { Settings } from '@/types/settingsContracts'
import { resolveConfiguredLocalEmbeddingModel } from '@/bootstrap/localModelCatalog'
import { logContextOperation } from '@/services/runtimeHealthLog'
import type { EmbeddingProvider, LocalEmbeddingModel, LocalEmbeddingTokenizer } from '@/modules/knowledge'

export async function createOnnxEmbeddingProvider(settings: Pick<Settings, 'localEmbeddingModelId' | 'localEmbeddingModelSource'>): Promise<EmbeddingProvider | null> {
  if (settings.localEmbeddingModelSource === 'none') return null

  // 优化：延迟加载模型，仅在首次embed时加载
  // 避免在createProvider时就加载108MB的AI模型

  let cachedModel: { model: LocalEmbeddingModel; source: string; directoryUri: string } | null = null

  const loadModelOnDemand = async () => {
    if (cachedModel) return cachedModel

    const active = await resolveConfiguredLocalEmbeddingModel(settings)
    if (!active) throw new Error('No embedding model available')

    cachedModel = active
    return active
  }

  return {
    id: 'onnx',
    get dimension() { return cachedModel?.model.dimension },
    get model() {
      if (!cachedModel) return undefined
      const model = cachedModel.model
      return `${model.id}@${model.version}:onnx-pipeline-v2:${model.pooling ?? 'mean'}`
    },
    available: async () => {
      try {
        const active = await loadModelOnDemand()
        if (!supportsTokenizer(active.model.tokenizer)) return false

        await getOnnxRuntime()
        await loadTokenizer(active.model, active.directoryUri)
        return true
      } catch (error) {
        await logContextOperation({
          phase: 'knowledge_embedding',
          status: 'error',
          detail: 'onnx_provider_unavailable',
          reason: 'availability_check_failed',
          sourceType: 'text',
          error,
        })
        return false
      }
    },
    embed: async (text: string, options = {}) => {
      throwIfAborted(options.signal)
      const active = await loadModelOnDemand()
      throwIfAborted(options.signal)

      if (!supportsTokenizer(active.model.tokenizer)) {
        throw new Error(`Tokenizer ${active.model.tokenizer} is not supported in this build.`)
      }

      const vector = await embedWithOnnx(active.model, active.directoryUri, text, options.signal)
      return vector
    },
  }
}


type OrtModule = typeof import('onnxruntime-react-native')
type OrtSession = Awaited<ReturnType<OrtModule['InferenceSession']['create']>>

interface TokenizerState {
  vocab: Record<string, number>
  tokenizer: LocalEmbeddingTokenizer
  lowercase: boolean
  clsId: number
  sepId: number
  padId: number
  unkId: number
}

interface SessionEntry { promise: Promise<OrtSession>; users: number; retired?: boolean }
const sessionCache = new Map<string, SessionEntry>()
const tokenizerCache = new Map<string, Promise<TokenizerState>>()

async function getOnnxRuntime(): Promise<OrtModule> {
  return import('onnxruntime-react-native')
}

async function embedWithOnnx(model: LocalEmbeddingModel, directoryUri: string, text: string, signal?: AbortSignal): Promise<number[]> {
  throwIfAborted(signal)
  const entry = acquireSession(model, directoryUri)
  const feeds: Record<string, InstanceType<OrtModule['Tensor']>> = {}
  let results: Awaited<ReturnType<OrtSession['run']>> | undefined
  try {
    const [ort, tokenizer, session] = await Promise.all([
      getOnnxRuntime(),
      loadTokenizer(model, directoryUri),
      entry.promise,
    ])
    throwIfAborted(signal)
    const tokens = encodeText(tokenizer, text, model.maxTokens)
    const dims = [1, tokens.inputIds.length]
    feeds.input_ids = new ort.Tensor('int64', BigInt64Array.from(tokens.inputIds.map(BigInt)), dims)
    feeds.attention_mask = new ort.Tensor('int64', BigInt64Array.from(tokens.attentionMask.map(BigInt)), dims)
    if (session.inputNames.includes('token_type_ids')) {
      feeds.token_type_ids = new ort.Tensor('int64', BigInt64Array.from(tokens.tokenTypeIds.map(BigInt)), dims)
    }
    results = await session.run(feeds)
    // RN's ONNX binding has no per-run AbortSignal. Do not release an active
    // native session; discard late results and dispose tensors after it settles.
    throwIfAborted(signal)
    const outputName = chooseEmbeddingOutputName(session.outputNames, results)
    const output = results[outputName]
    const data = Array.from(output.data as Float32Array)
    const outputDims = Array.from(output.dims)
    if (outputDims[0] !== 1 || outputDims.at(-1) !== model.dimension
      || outputDims.some((size) => !Number.isInteger(size) || size <= 0)
      || outputDims.reduce((total, size) => total * size, 1) !== data.length
      || data.some((value) => !Number.isFinite(value))) {
      throw new Error('Invalid ONNX embedding dimensions or values.')
    }
    if (outputDims.length === 3) {
      if (outputDims[1] !== tokens.inputIds.length) throw new Error('ONNX embedding sequence length mismatch.')
      if (model.pooling === 'cls') return normalizeVector(data.slice(0, model.dimension))
      return meanPool(data, outputDims[1], outputDims[2], tokens.attentionMask)
    }
    if (outputDims.length === 2) {
      return normalizeVector(data.slice(0, outputDims[1]))
    }
    throw new Error('Unexpected ONNX embedding output shape.')
  } finally {
    try {
      for (const tensor of new Set([...Object.values(results ?? {}), ...Object.values(feeds)])) tensor.dispose()
    } finally {
      entry.users -= 1
      await pruneSessions()
    }
  }
}

function acquireSession(model: LocalEmbeddingModel, directoryUri: string): SessionEntry {
  const key = `${model.id}:${model.version}:${directoryUri}`
  let entry = sessionCache.get(key)
  if (!entry) {
    const promise = (async () => {
      const ort = await getOnnxRuntime()
      const modelUri = `${directoryUri}onnx/model_quantized.onnx`
      return ort.InferenceSession.create(modelUri, {
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      })
    })().catch((error) => {
      // Share initialization in flight, but allow the next request to retry a failure.
      if (sessionCache.get(key)?.promise === promise) sessionCache.delete(key)
      throw error
    })
    entry = { promise, users: 0 }
  }
  entry.users += 1
  sessionCache.delete(key)
  sessionCache.set(key, entry)
  return entry
}

async function pruneSessions(): Promise<void> {
  for (const [key, entry] of sessionCache) {
    if (entry.users || (!entry.retired && sessionCache.size <= 1)) continue
    sessionCache.delete(key)
    const session = await entry.promise.catch(() => undefined)
    if (!session) continue
    try { await session.release() } catch (error) {
      // Cleanup diagnostics must not change the outcome of a completed run.
      await logContextOperation({ phase: 'knowledge_embedding', status: 'error', detail: 'onnx_session_release_failed', sourceType: 'text', error }).catch(() => undefined)
    }
  }
}

/** Retire idle native resources; in-flight sessions release only after completion. */
export async function releaseOnnxEmbeddingResources(): Promise<void> {
  tokenizerCache.clear()
  for (const entry of sessionCache.values()) entry.retired = true
  await pruneSessions()
}

async function loadTokenizer(model: LocalEmbeddingModel, directoryUri: string): Promise<TokenizerState> {
  const key = `${model.id}:${model.version}:${directoryUri}`
  let pending = tokenizerCache.get(key)
  if (!pending) {
    pending = (async () => {
      const raw = await FileSystem.readAsStringAsync(`${directoryUri}tokenizer.json`, { encoding: FileSystem.EncodingType.UTF8 })
      const data = JSON.parse(raw) as {
        model?: { vocab?: Record<string, number> | Array<[string, number]> }
        normalizer?: unknown
      }
      const vocab = Array.isArray(data.model?.vocab)
        ? Object.fromEntries(data.model.vocab.map(([token], index) => [token, index]))
        : data.model?.vocab ?? {}
      if (!Object.keys(vocab).length) throw new Error('Tokenizer vocabulary is empty.')
      return {
        vocab,
        tokenizer: model.tokenizer,
        lowercase: JSON.stringify(data.normalizer ?? '').toLowerCase().includes('lowercase') || model.tokenizer === 'wordpiece',
        clsId: vocab['[CLS]'] ?? vocab['<s>'] ?? 101,
        sepId: vocab['[SEP]'] ?? vocab['</s>'] ?? 102,
        padId: vocab['[PAD]'] ?? vocab['<pad>'] ?? 0,
        unkId: vocab['[UNK]'] ?? vocab['<unk>'] ?? 100,
      }
    })().catch((error) => {
      if (tokenizerCache.get(key) === pending) tokenizerCache.delete(key)
      throw error
    })
    tokenizerCache.set(key, pending)
    while (tokenizerCache.size > 2) tokenizerCache.delete(tokenizerCache.keys().next().value!)
  }
  return pending
}

function encodeText(tokenizer: TokenizerState, text: string, maxTokens: number): { inputIds: number[]; attentionMask: number[]; tokenTypeIds: number[] } {
  const tokenBudget = Math.max(0, maxTokens - 2)
  const rawTokens = tokenizeWordPiece(text, tokenizer)
  const contentIds = rawTokens.slice(0, tokenBudget)
  const inputIds = [tokenizer.clsId, ...contentIds, tokenizer.sepId]
  const attentionMask = inputIds.map(() => 1)
  const tokenTypeIds = inputIds.map(() => 0)
  return { inputIds, attentionMask, tokenTypeIds }
}

function tokenizeWordPiece(text: string, tokenizer: TokenizerState): number[] {
  const normalized = tokenizer.lowercase ? text.toLowerCase() : text
  const words = normalized.match(/[a-z0-9]+(?:'[a-z0-9]+)?|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\s]/gi) ?? []
  const ids: number[] = []
  for (const word of words) {
    const pieces = wordPieceTokenize(word, tokenizer.vocab)
    if (!pieces.length) {
      ids.push(tokenizer.unkId)
      continue
    }
    ids.push(...pieces.map((piece) => tokenizer.vocab[piece] ?? tokenizer.unkId))
  }
  return ids
}

function wordPieceTokenize(word: string, vocab: Record<string, number>): string[] {
  if (vocab[word] !== undefined) return [word]
  const chars = Array.from(word)
  const pieces: string[] = []
  let start = 0
  while (start < chars.length) {
    let end = chars.length
    let current = ''
    while (start < end) {
      const candidate = `${start > 0 ? '##' : ''}${chars.slice(start, end).join('')}`
      if (vocab[candidate] !== undefined) {
        current = candidate
        break
      }
      end -= 1
    }
    if (!current) return []
    pieces.push(current)
    start = end
  }
  return pieces
}

function chooseEmbeddingOutputName(outputNames: readonly string[], results: Record<string, { dims: readonly number[]; data: unknown }>): string {
  const preferred = ['sentence_embedding', 'last_hidden_state', 'token_embeddings']
  for (const name of preferred) {
    if (results[name]) return name
  }
  const ranked = outputNames.find((name) => results[name]?.dims?.length === 3)
    ?? outputNames.find((name) => results[name]?.dims?.length === 2)
    ?? outputNames[0]
  if (!ranked) throw new Error('ONNX embedding model returned no outputs.')
  return ranked
}

function meanPool(data: number[], sequenceLength: number, dimension: number, mask: number[]): number[] {
  const vector = Array.from({ length: dimension }, () => 0)
  let count = 0
  for (let tokenIndex = 0; tokenIndex < sequenceLength; tokenIndex += 1) {
    if (!mask[tokenIndex]) continue
    count += 1
    const offset = tokenIndex * dimension
    for (let dim = 0; dim < dimension; dim += 1) {
      vector[dim] += data[offset + dim] ?? 0
    }
  }
  if (count) {
    for (let dim = 0; dim < dimension; dim += 1) vector[dim] /= count
  }
  return normalizeVector(vector)
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!magnitude || !Number.isFinite(magnitude)) throw new Error('ONNX embedding has no finite nonzero norm.')
  return vector.map((value) => Number((value / magnitude).toFixed(6)))
}

function supportsTokenizer(tokenizer: LocalEmbeddingTokenizer): boolean {
  // Character fallback is not a Unigram/SentencePiece tokenizer. Fail closed
  // to the explicitly labelled lexical/hash path until a faithful adapter exists.
  return tokenizer === 'wordpiece'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('ONNX embedding was cancelled.')
  error.name = 'AbortError'
  throw error
}
