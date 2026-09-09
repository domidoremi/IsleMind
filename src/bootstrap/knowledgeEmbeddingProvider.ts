import * as FileSystem from 'expo-file-system/legacy'
import type { Settings } from '@/types/settingsContracts'
import { resolveConfiguredLocalEmbeddingModel } from '@/bootstrap/localModelCatalog'
import { logContextOperation } from '@/services/runtimeHealthLog'
import type { EmbeddingProvider, LocalEmbeddingModel, LocalEmbeddingTokenizer } from '@/modules/knowledge'
import { parseXlmRobertaTokenizer, type XlmRobertaTokenizer } from '@/platform/localModels/xlmRobertaTokenizer'

export async function createOnnxEmbeddingProvider(settings: Pick<Settings, 'localEmbeddingModelId' | 'localEmbeddingModelSource'>): Promise<EmbeddingProvider | null> {
  if (settings.localEmbeddingModelSource === 'none') return null

  // Resolve lazily at availability/embed admission, not provider construction.
  // Only successful, non-cancelled verification may populate this local cache.

  let cachedModel: { model: LocalEmbeddingModel; source: string; directoryUri: string } | null = null

  const loadModelOnDemand = async (signal?: AbortSignal) => {
    throwIfAborted(signal)
    if (cachedModel) return cachedModel

    const active = await resolveConfiguredLocalEmbeddingModel(settings, signal)
    throwIfAborted(signal)
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
      const pipeline = model.tokenizer === 'unigram' ? 'onnx-unigram-v1' : 'onnx-pipeline-v3'
      return `${model.id}@${model.version}:${pipeline}:${model.pooling ?? 'mean'}`
    },
    available: async (options = {}) => {
      throwIfAborted(options.signal)
      try {
        const active = await loadModelOnDemand(options.signal)
        if (!supportsTokenizer(active.model.tokenizer)) return false

        await getOnnxRuntime()
        throwIfAborted(options.signal)
        await loadTokenizer(active.model, active.directoryUri)
        throwIfAborted(options.signal)
        return true
      } catch (error) {
        throwIfAborted(options.signal)
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
      const active = await loadModelOnDemand(options.signal)
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
  vocab: Map<string, number>
  lowercase: boolean
  cleanText: boolean
  handleChineseChars: boolean
  stripAccents: boolean
  continuingSubwordPrefix: string
  maxInputCharsPerWord: number
  clsId: number
  sepId: number
  unkId: number
  addedTokens: Map<string, number>
  addedTokenPattern?: RegExp
}

interface SessionEntry { promise: Promise<OrtSession>; users: number; retired?: boolean }
const sessionCache = new Map<string, SessionEntry>()
const tokenizerCache = new Map<string, Promise<TokenizerState | XlmRobertaTokenizer>>()
let resourceEpoch = 0

async function getOnnxRuntime(): Promise<OrtModule> {
  return import('onnxruntime-react-native')
}

async function embedWithOnnx(model: LocalEmbeddingModel, directoryUri: string, text: string, signal?: AbortSignal): Promise<number[]> {
  throwIfAborted(signal)
  const admissionEpoch = resourceEpoch
  const tokenizer = await loadTokenizer(model, directoryUri)
  throwIfAborted(signal)
  // Validate preprocessing and its input bounds before allocating a native
  // model session. Unsupported/oversized input must not load model weights.
  const tokens = await encodeText(tokenizer, text, model.maxTokens, signal)
  throwIfAborted(signal)
  if (admissionEpoch !== resourceEpoch) {
    // A delete/retirement during preprocessing must not allocate a new session
    // after releaseOnnxEmbeddingResources has already retired the old resources.
    throw Object.assign(new Error('ONNX embedding resources were retired during admission.'), { name: 'AbortError' })
  }
  const entry = acquireSession(model, directoryUri)
  const feeds: Record<string, InstanceType<OrtModule['Tensor']>> = {}
  let results: Awaited<ReturnType<OrtSession['run']>> | undefined
  try {
    const [ort, session] = await Promise.all([
      getOnnxRuntime(),
      entry.promise,
    ])
    throwIfAborted(signal)
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
  resourceEpoch += 1
  tokenizerCache.clear()
  for (const entry of sessionCache.values()) entry.retired = true
  await pruneSessions()
}

async function loadTokenizer(model: LocalEmbeddingModel, directoryUri: string): Promise<TokenizerState | XlmRobertaTokenizer> {
  const key = `${model.id}:${model.version}:${directoryUri}`
  let pending = tokenizerCache.get(key)
  if (!pending) {
    pending = (async () => {
      const raw = await FileSystem.readAsStringAsync(`${directoryUri}tokenizer.json`, { encoding: FileSystem.EncodingType.UTF8 })
      return model.tokenizer === 'unigram' ? parseXlmRobertaTokenizer(raw) : parseWordPieceTokenizer(raw)
    })().catch((error) => {
      if (tokenizerCache.get(key) === pending) tokenizerCache.delete(key)
      throw error
    })
    tokenizerCache.set(key, pending)
    while (tokenizerCache.size > 2) tokenizerCache.delete(tokenizerCache.keys().next().value!)
  }
  return pending
}

async function encodeText(tokenizer: TokenizerState | XlmRobertaTokenizer, text: string, maxTokens: number, signal?: AbortSignal): Promise<{ inputIds: number[]; attentionMask: number[]; tokenTypeIds: number[] }> {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 2) throw new Error('Invalid embedding token limit.')
  // Single sentences use the catalogue/model-card limit, without export-time
  // sample-batch padding. Both template tokens count towards that limit.
  const tokenBudget = maxTokens - 2
  const rawTokens = 'tokenize' in tokenizer ? await tokenizer.tokenize(text, tokenBudget, signal) : tokenizeWordPiece(text, tokenizer)
  const contentIds = rawTokens.slice(0, tokenBudget)
  const inputIds = [tokenizer.clsId, ...contentIds, tokenizer.sepId]
  const attentionMask = inputIds.map(() => 1)
  const tokenTypeIds = inputIds.map(() => 0)
  return { inputIds, attentionMask, tokenTypeIds }
}

/** The catalogue's BERT/WordPiece pipeline, not a general tokenizer.json interpreter. */
function parseWordPieceTokenizer(raw: string): TokenizerState {
  const data = JSON.parse(raw) as {
    model?: { type?: string; vocab?: Record<string, number>; unk_token?: string; continuing_subword_prefix?: string; max_input_chars_per_word?: number }
    normalizer?: { type?: string; clean_text?: boolean; handle_chinese_chars?: boolean; strip_accents?: boolean | null; lowercase?: boolean }
    pre_tokenizer?: { type?: string }
    post_processor?: {
      type?: string
      single?: Array<{ SpecialToken?: { id?: string; type_id?: number }; Sequence?: { id?: string; type_id?: number } }>
      special_tokens?: Record<string, { id?: string; ids?: number[]; tokens?: string[] }>
    }
    added_tokens?: Array<{ id: number; content: string; single_word: boolean; lstrip: boolean; rstrip: boolean; normalized: boolean; special: boolean }>
  }
  const model = data?.model
  const normalizer = data?.normalizer
  const processor = data?.post_processor
  const single = processor?.single
  if (model?.type !== 'WordPiece' || !model.vocab || Array.isArray(model.vocab) || typeof model.vocab !== 'object'
    || typeof model.unk_token !== 'string' || typeof model.continuing_subword_prefix !== 'string'
    || !Number.isSafeInteger(model.max_input_chars_per_word) || model.max_input_chars_per_word! < 0
    || normalizer?.type !== 'BertNormalizer' || typeof normalizer.lowercase !== 'boolean'
    || typeof normalizer.clean_text !== 'boolean' || typeof normalizer.handle_chinese_chars !== 'boolean'
    || (normalizer.strip_accents != null && typeof normalizer.strip_accents !== 'boolean')
    || data.pre_tokenizer?.type !== 'BertPreTokenizer' || processor?.type !== 'TemplateProcessing'
    || single?.length !== 3 || single[0]?.SpecialToken?.id !== '[CLS]' || single[0].SpecialToken.type_id !== 0
    || single[1]?.Sequence?.id !== 'A' || single[1].Sequence.type_id !== 0
    || single[2]?.SpecialToken?.id !== '[SEP]' || single[2].SpecialToken.type_id !== 0) {
    throw new Error('Unsupported BERT WordPiece tokenizer configuration.')
  }
  const vocab = new Map(Object.entries(model.vocab))
  if (!vocab.size || [...vocab.values()].some((id) => !Number.isSafeInteger(id) || id < 0 || id > 0xffffffff)) {
    throw new Error('Invalid WordPiece vocabulary.')
  }
  const clsId = vocab.get('[CLS]')
  const sepId = vocab.get('[SEP]')
  const unkId = vocab.get(model.unk_token)
  for (const token of ['[CLS]', '[SEP]']) {
    const special = processor.special_tokens?.[token]
    if (special?.id !== token || special.ids?.length !== 1 || special.ids[0] !== vocab.get(token)
      || special.tokens?.length !== 1 || special.tokens[0] !== token) {
      throw new Error('Unsupported WordPiece special-token template.')
    }
  }
  if (clsId === undefined || sepId === undefined || unkId === undefined) throw new Error('Missing WordPiece special token.')
  const added = data.added_tokens ?? []
  if (!Array.isArray(added) || added.some((token) => !token || !Number.isSafeInteger(token.id) || typeof token.content !== 'string' || !token.content
    || vocab.get(token.content) !== token.id || token.single_word !== false || token.lstrip !== false
    || token.rstrip !== false || token.normalized !== false || token.special !== true)) {
    throw new Error('Unsupported WordPiece added-token configuration.')
  }
  const addedTokens = new Map(added.map((token) => [token.content, token.id]))
  // Match literal added tokens before normalization, leftmost and longest first.
  const alternatives = [...addedTokens.keys()].sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return {
    vocab, clsId, sepId, unkId, addedTokens,
    addedTokenPattern: alternatives.length ? new RegExp(alternatives.join('|'), 'gu') : undefined,
    lowercase: normalizer.lowercase,
    cleanText: normalizer.clean_text,
    handleChineseChars: normalizer.handle_chinese_chars,
    stripAccents: normalizer.strip_accents ?? normalizer.lowercase,
    continuingSubwordPrefix: model.continuing_subword_prefix,
    maxInputCharsPerWord: model.max_input_chars_per_word!,
  }
}

function isBertChineseCharacter(code: number): boolean {
  // Match HF tokenizers' BERT ranges, including supplementary characters, not
  // Japanese kana or Hangul. The 2B920 boundary is the upstream definition.
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0x20000 && code <= 0x2a6df) || (code >= 0x2a700 && code <= 0x2b73f)
    || (code >= 0x2b740 && code <= 0x2b81f) || (code >= 0x2b920 && code <= 0x2ceaf)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x2f800 && code <= 0x2fa1f)
}

function normalizeBertText(text: string, tokenizer: TokenizerState): string {
  let normalized = ''
  for (let char of text) {
    if (tokenizer.cleanText) {
      // unicode_categories::is_other is Cc/Cf/Co, not every \p{C} (Cn).
      if (char === '\0' || char === '\ufffd'
        || (char !== '\t' && char !== '\n' && char !== '\r' && /[\p{Cc}\p{Cf}\p{Co}]/u.test(char))) continue
      if (/\p{White_Space}/u.test(char)) char = ' '
    }
    normalized += tokenizer.handleChineseChars && isBertChineseCharacter(char.codePointAt(0)!) ? ` ${char} ` : char
  }
  // Order matters: NFD/nonspacing-mark removal precedes character-wise case
  // mapping. Whole-string lowercasing applies contextual Greek final sigma.
  if (tokenizer.stripAccents) normalized = normalized.normalize('NFD').replace(/\p{Mn}/gu, '')
  return tokenizer.lowercase ? Array.from(normalized, (char) => char.toLowerCase()).join('') : normalized
}

function tokenizeWordPiece(text: string, tokenizer: TokenizerState): number[] {
  const ids: number[] = []
  const appendOrdinaryText = (segment: string) => {
    let word = ''
    const flush = () => {
      if (word) ids.push(...wordPieceTokenize(word, tokenizer))
      word = ''
    }
    for (const char of normalizeBertText(segment, tokenizer)) {
      const code = char.codePointAt(0)!
      if (/\p{White_Space}/u.test(char)) flush()
      else if ((code >= 33 && code <= 47) || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96) || (code >= 123 && code <= 126) || /\p{P}/u.test(char)) {
        flush()
        ids.push(...wordPieceTokenize(char, tokenizer))
      } else word += char
    }
    flush()
  }
  let offset = 0
  if (tokenizer.addedTokenPattern) {
    for (const match of text.matchAll(tokenizer.addedTokenPattern)) {
      appendOrdinaryText(text.slice(offset, match.index))
      ids.push(tokenizer.addedTokens.get(match[0])!)
      offset = match.index + match[0].length
    }
  }
  appendOrdinaryText(text.slice(offset))
  return ids
}

function wordPieceTokenize(word: string, tokenizer: TokenizerState): number[] {
  const chars = Array.from(word)
  if (chars.length > tokenizer.maxInputCharsPerWord) return [tokenizer.unkId]
  const pieces: number[] = []
  let start = 0
  while (start < chars.length) {
    let end = chars.length
    let current: number | undefined
    while (start < end) {
      const candidate = `${start > 0 ? tokenizer.continuingSubwordPrefix : ''}${chars.slice(start, end).join('')}`
      current = tokenizer.vocab.get(candidate)
      if (current !== undefined) {
        break
      }
      end -= 1
    }
    if (current === undefined) return [tokenizer.unkId]
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
  // Only the validated BERT and XLM-R configurations are accepted by their
  // parsers. Other SentencePiece pipelines still fail closed, never approximate.
  return tokenizer === 'wordpiece' || tokenizer === 'unigram'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('ONNX embedding was cancelled.')
  error.name = 'AbortError'
  throw error
}
