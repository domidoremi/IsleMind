import * as FileSystem from 'expo-file-system/legacy'
import type { Settings } from '@/types/settingsContracts'
import { resolveActiveLocalEmbeddingModel, type LocalEmbeddingModel, type LocalEmbeddingTokenizer } from '@/bootstrap/localModelRuntime'
import { logContextOperation } from '@/services/runtimeHealthLog'
import type { EmbeddingProvider } from '@/modules/knowledge'

export async function createOnnxEmbeddingProvider(settings: Pick<Settings, 'localEmbeddingModelId' | 'localEmbeddingModelSource'>): Promise<EmbeddingProvider | null> {
  if (settings.localEmbeddingModelSource === 'none') return null

  // 优化：延迟加载模型，仅在首次embed时加载
  // 避免在createProvider时就加载108MB的AI模型

  let cachedModel: { model: LocalEmbeddingModel; source: string; directoryUri: string } | null = null

  const loadModelOnDemand = async () => {
    if (cachedModel) return cachedModel

    const active = await resolveActiveLocalEmbeddingModel(settings as Settings)
    if (!active) throw new Error('No embedding model available')

    cachedModel = active
    return active
  }

  return {
    id: 'onnx',
    dimension: 384, // 默认维度，实际会从模型中获取
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
    embed: async (text: string) => {
      const active = await loadModelOnDemand()

      if (!supportsTokenizer(active.model.tokenizer)) {
        throw new Error(`Tokenizer ${active.model.tokenizer} is not supported in this build.`)
      }

      const vector = await embedWithOnnx(active.model, active.directoryUri, text)
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

const sessionCache = new Map<string, Promise<OrtSession>>()
const tokenizerCache = new Map<string, Promise<TokenizerState>>()

async function getOnnxRuntime(): Promise<OrtModule> {
  return import('onnxruntime-react-native')
}

async function embedWithOnnx(model: LocalEmbeddingModel, directoryUri: string, text: string): Promise<number[]> {
  const [ort, tokenizer, session] = await Promise.all([
    getOnnxRuntime(),
    loadTokenizer(model, directoryUri),
    loadSession(model, directoryUri),
  ])
  const tokens = encodeText(tokenizer, text, model.maxTokens)
  const dims = [1, tokens.inputIds.length]
  const feeds: Record<string, unknown> = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(tokens.inputIds.map(BigInt)), dims),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from(tokens.attentionMask.map(BigInt)), dims),
  }
  if (session.inputNames.includes('token_type_ids')) {
    feeds.token_type_ids = new ort.Tensor('int64', BigInt64Array.from(tokens.tokenTypeIds.map(BigInt)), dims)
  }
  const results = await session.run(feeds as never)
  const outputName = chooseEmbeddingOutputName(session.outputNames, results)
  const output = results[outputName]
  const data = Array.from(output.data as Float32Array)
  const outputDims = Array.from(output.dims)
  if (outputDims.length === 3) {
    return meanPool(data, outputDims[1], outputDims[2], tokens.attentionMask)
  }
  if (outputDims.length === 2) {
    return normalizeVector(data.slice(0, outputDims[1]))
  }
  throw new Error('Unexpected ONNX embedding output shape.')
}

async function loadSession(model: LocalEmbeddingModel, directoryUri: string): Promise<OrtSession> {
  const key = `${model.id}:${directoryUri}`
  let pending = sessionCache.get(key)
  if (!pending) {
    pending = (async () => {
      const ort = await getOnnxRuntime()
      const modelUri = `${directoryUri}onnx/model_quantized.onnx`
      return ort.InferenceSession.create(modelUri, {
        graphOptimizationLevel: 'all',
        executionMode: 'sequential',
        intraOpNumThreads: 1,
        interOpNumThreads: 1,
      })
    })()
    sessionCache.set(key, pending)
  }
  return pending
}

async function loadTokenizer(model: LocalEmbeddingModel, directoryUri: string): Promise<TokenizerState> {
  const key = `${model.id}:${directoryUri}`
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
    })()
    tokenizerCache.set(key, pending)
  }
  return pending
}

function encodeText(tokenizer: TokenizerState, text: string, maxTokens: number): { inputIds: number[]; attentionMask: number[]; tokenTypeIds: number[] } {
  const tokenBudget = Math.max(8, maxTokens - 2)
  const rawTokens = tokenizer.tokenizer === 'wordpiece'
    ? tokenizeWordPiece(text, tokenizer)
    : tokenizeSentencePieceLite(text, tokenizer)
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

function tokenizeSentencePieceLite(text: string, tokenizer: TokenizerState): number[] {
  const normalized = tokenizer.lowercase ? text.toLowerCase() : text
  const parts = normalized.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]|[^\s]+/g) ?? []
  const ids: number[] = []
  for (const part of parts) {
    const candidates = [`▁${part}`, part]
    const direct = candidates.find((candidate) => tokenizer.vocab[candidate] !== undefined)
    if (direct) {
      ids.push(tokenizer.vocab[direct])
      continue
    }
    for (const char of Array.from(part)) {
      ids.push(tokenizer.vocab[`▁${char}`] ?? tokenizer.vocab[char] ?? tokenizer.unkId)
    }
  }
  return ids
}

function chooseEmbeddingOutputName(outputNames: readonly string[], results: Record<string, { dims: readonly number[]; data: unknown }>): string {
  const preferred = ['last_hidden_state', 'token_embeddings', 'sentence_embedding', 'pooler_output']
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
  if (!magnitude) return vector
  return vector.map((value) => Number((value / magnitude).toFixed(6)))
}

function supportsTokenizer(tokenizer: LocalEmbeddingTokenizer): boolean {
  return tokenizer === 'wordpiece' || tokenizer === 'unigram'
}
