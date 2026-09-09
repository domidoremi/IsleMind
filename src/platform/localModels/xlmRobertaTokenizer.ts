import { splitGraphemes } from 'unicode-segmenter/grapheme'

// This is the catalogue's XLM-R Unigram pipeline, not a general tokenizer.json
// interpreter. Bounds reject work rather than silently change its tokenization.
const MAX_INPUT_UNITS = 32_768
const MAX_NORMALIZED_UNITS = 65_536
const MAX_VOCABULARY = 262_144
const MAX_PIECE_SCALARS = 32

export interface XlmRobertaTokenizer {
  kind: 'xlm-roberta'
  clsId: number
  sepId: number
  tokenize(text: string, tokenBudget: number, signal?: AbortSignal): Promise<number[]>
}

/** Preserve the serialized SentencePiece charsmap; generic NFKC is not equivalent. */
export async function parseXlmRobertaTokenizer(raw: string): Promise<XlmRobertaTokenizer> {
  if (raw.length > 20 * 1024 * 1024) throw new Error('Unigram tokenizer exceeds its size bound.')
  const parsed = await parseVocabulary(raw)
  const data = parsed.data as {
    model?: { type?: string; unk_id?: number; byte_fallback?: boolean; vocab?: null }
    normalizer?: { type?: string; precompiled_charsmap?: string }
    pre_tokenizer?: { type?: string; pretokenizers?: Array<{
      type?: string; replacement?: string; add_prefix_space?: boolean; prepend_scheme?: string; split?: boolean
    }> }
    post_processor?: {
      type?: string
      single?: Array<{ SpecialToken?: { id?: string; type_id?: number }; Sequence?: { id?: string; type_id?: number } }>
      special_tokens?: Record<string, { id?: string; ids?: number[]; tokens?: string[] }>
    }
    added_tokens?: Array<{ id: number; content: string; single_word: boolean; lstrip: boolean; rstrip: boolean; normalized: boolean; special: boolean }>
  }
  const model = data?.model, processor = data?.post_processor, single = processor?.single
  const pre = data?.pre_tokenizer?.pretokenizers, meta = pre?.[1]
  if (model?.type !== 'Unigram' || (model.byte_fallback !== undefined && model.byte_fallback !== false)
    || model.vocab !== null || parsed.vocab.size < 5
    || !Number.isSafeInteger(model.unk_id) || model.unk_id! < 0 || model.unk_id! >= parsed.vocab.size
    || data.normalizer?.type !== 'Precompiled' || typeof data.normalizer.precompiled_charsmap !== 'string'
    || data.pre_tokenizer?.type !== 'Sequence' || pre?.length !== 2 || pre[0]?.type !== 'WhitespaceSplit'
    || meta?.type !== 'Metaspace' || meta.replacement !== '▁' || meta.add_prefix_space !== true
    || (meta.prepend_scheme !== undefined && meta.prepend_scheme !== 'always') || (meta.split !== undefined && meta.split !== true)
    || processor?.type !== 'TemplateProcessing' || single?.length !== 3
    || single[0]?.SpecialToken?.id !== '<s>' || single[0].SpecialToken.type_id !== 0
    || single[1]?.Sequence?.id !== 'A' || single[1].Sequence.type_id !== 0
    || single[2]?.SpecialToken?.id !== '</s>' || single[2].SpecialToken.type_id !== 0) {
    throw new Error('Unsupported XLM-R Unigram tokenizer configuration.')
  }
  const { vocab, scores, minScore, maxPieceScalars } = parsed
  const specialNames = ['<s>', '<pad>', '</s>', '<unk>', '<mask>']
  const added = data.added_tokens
  if (!Array.isArray(added) || added.length !== specialNames.length
    || new Set(added.map(token => token?.content)).size !== specialNames.length
    || added.some(token => !token || !specialNames.includes(token.content) || vocab.get(token.content) !== token.id
      || token.single_word !== false || token.lstrip !== (token.content === '<mask>')
      || token.rstrip !== false || token.normalized !== false || token.special !== true)
    || vocab.get('<unk>') !== model.unk_id) throw new Error('Unsupported Unigram added-token configuration.')
  for (const name of ['<s>', '</s>']) {
    const special = processor.special_tokens?.[name]
    if (special?.id !== name || special.ids?.length !== 1 || special.ids[0] !== vocab.get(name)
      || special.tokens?.length !== 1 || special.tokens[0] !== name) throw new Error('Unsupported Unigram special-token template.')
  }
  return { kind: 'xlm-roberta', clsId: vocab.get('<s>')!, sepId: vocab.get('</s>')!,
    tokenize: createEncoder(vocab, scores, maxPieceScalars, minScore - 10, model.unk_id!,
      createPrecompiledNormalizer(data.normalizer.precompiled_charsmap)) }
}

async function parseVocabulary(raw: string) {
  // A single JSON.parse of this model's 250k pair objects blocks Hermes even
  // when later Map construction yields. Locate the array structurally, parse
  // bounded batches with the built-in JSON grammar, then discard each batch.
  // No regex field extraction, alternate number/string parser, or disk cache.
  const modelStart = objectValue(raw, 0, 'model')
  const start = objectValue(raw, modelStart, 'vocab')
  if (raw[start] !== '[') throw new Error('Unsupported XLM-R Unigram tokenizer configuration.')
  const vocab = new Map<string, number>(), scores = new Float64Array(MAX_VOCABULARY)
  let cursor = jsonSpace(raw, start + 1), minScore = 0, maxPieceScalars = 0
  while (raw[cursor] !== ']') {
    const batchStart = cursor
    let batchEnd = cursor, count = 0
    do {
      if (vocab.size + ++count > MAX_VOCABULARY || raw[cursor] !== '[') throw new Error('Invalid Unigram vocabulary entry or size.')
      const stringStart = jsonSpace(raw, cursor + 1)
      if (raw[stringStart] !== '"') throw new Error('Invalid Unigram vocabulary string.')
      const stringEnd = jsonStringEnd(raw, stringStart)
      const end = raw.indexOf(']', stringEnd)
      if (end === -1) throw new Error('Unterminated Unigram vocabulary entry.')
      if (end - cursor > 1024) throw new Error('Unigram vocabulary entry exceeds its size bound.')
      batchEnd = end + 1
      cursor = jsonSpace(raw, batchEnd)
      if (raw[cursor] === ']') break
      if (raw[cursor] !== ',') throw new Error('Invalid Unigram vocabulary separator.')
      cursor = jsonSpace(raw, cursor + 1)
      if (raw[cursor] !== '[') throw new Error('Invalid Unigram vocabulary entry.')
    } while (count < 4096)
    const batch: unknown[] = JSON.parse(`[${raw.slice(batchStart, batchEnd)}]`)
    for (const pair of batch) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !pair[0]
        || typeof pair[1] !== 'number' || !Number.isFinite(pair[1]) || pair[1] > 0 || vocab.has(pair[0])) {
        throw new Error('Invalid Unigram vocabulary.')
      }
      let length = 0
      for (let index = 0; index < pair[0].length;) {
        const code = pair[0].codePointAt(index)!
        if (++length > MAX_PIECE_SCALARS || (code >= 0xd800 && code <= 0xdfff)) throw new Error('Unsupported Unigram vocabulary piece.')
        index += code > 0xffff ? 2 : 1
      }
      maxPieceScalars = Math.max(maxPieceScalars, length)
      minScore = Math.min(minScore, pair[1])
      const id = vocab.size
      vocab.set(pair[0], id); scores[id] = pair[1]
    }
    // Shared initialization must allow interaction/cancellation, without one
    // caller owning or aborting another caller's vocabulary build.
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  const metadata = `${raw.slice(0, start)}null${raw.slice(cursor + 1)}`
  if (metadata.length > 1024 * 1024) throw new Error('Unigram metadata exceeds its size bound.')
  // Duplicate model/vocab keys cannot hide a different array behind our marker.
  objectValue(metadata, objectValue(metadata, 0, 'model', true), 'vocab', true)
  return { data: JSON.parse(metadata) as unknown, vocab, scores, minScore, maxPieceScalars }
}

function jsonSpace(raw: string, start: number): number {
  while (start < raw.length && ' \t\r\n'.includes(raw[start])) start += 1
  return start
}

function jsonStringEnd(raw: string, start: number): number {
  let end = raw.indexOf('"', start + 1)
  while (end !== -1) {
    let escapes = 0
    for (let i = end - 1; i > start && raw[i] === '\\'; i -= 1) escapes += 1
    if (escapes % 2 === 0) return end + 1
    end = raw.indexOf('"', end + 1)
  }
  throw new Error('Unterminated Unigram JSON string.')
}

function jsonValueEnd(raw: string, start: number): number {
  if (raw[start] === '"') return jsonStringEnd(raw, start)
  if (raw[start] !== '[' && raw[start] !== '{') {
    while (start < raw.length && !',]} \t\r\n'.includes(raw[start])) start += 1
    return start
  }
  let depth = 0
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i]
    if (char === '"') i = jsonStringEnd(raw, i) - 1
    else if (char === '[' || char === '{') depth += 1
    else if ((char === ']' || char === '}') && --depth === 0) return i + 1
  }
  throw new Error('Unterminated Unigram JSON value.')
}

function objectValue(raw: string, start: number, key: string, unique = false): number {
  let cursor = jsonSpace(raw, start), found = -1
  if (raw[cursor] !== '{') throw new Error('Invalid Unigram JSON object.')
  cursor = jsonSpace(raw, cursor + 1)
  while (raw[cursor] !== '}') {
    if (raw[cursor] !== '"') throw new Error('Invalid Unigram JSON key.')
    const end = jsonStringEnd(raw, cursor)
    const name = JSON.parse(raw.slice(cursor, end))
    cursor = jsonSpace(raw, end)
    if (raw[cursor] !== ':') throw new Error('Invalid Unigram JSON property.')
    cursor = jsonSpace(raw, cursor + 1)
    if (name === key) {
      if (found !== -1) throw new Error('Duplicate Unigram JSON property.')
      found = cursor
      if (!unique) return found
    }
    cursor = jsonSpace(raw, jsonValueEnd(raw, cursor))
    if (raw[cursor] === '}') break
    if (raw[cursor] !== ',') throw new Error('Invalid Unigram JSON separator.')
    cursor = jsonSpace(raw, cursor + 1)
    if (raw[cursor] === '}') throw new Error('Invalid Unigram JSON trailing comma.')
  }
  if (found === -1) throw new Error(`Missing Unigram JSON ${key}.`)
  return found
}

function createEncoder(vocab: Map<string, number>, scores: Float64Array, maxPieceScalars: number,
  unknownScore: number, unknownId: number, normalize: (text: string, signal?: AbortSignal) => Promise<string>): XlmRobertaTokenizer['tokenize'] {
  // Keep only compact lookup state, not the raw JSON or its 250k pair objects.
  return async (text, tokenBudget, signal) => {
    if (text.length > MAX_INPUT_UNITS || /[\uD800-\uDFFF]/u.test(text)) throw new Error('Unigram input exceeds its bound or contains invalid Unicode.')
    if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 0) throw new Error('Invalid Unigram token budget.')
    const ids: number[] = []
    let normalizedUnits = 0
    const append = async (ordinary: string) => {
      if (ids.length >= tokenBudget) return
      const normalized = await normalize(ordinary, signal)
      normalizedUnits += normalized.length
      if (normalizedUnits > MAX_NORMALIZED_UNITS) throw new Error('Unigram normalization exceeds its bound.')
      // Rust White_Space includes NEL, unlike JavaScript's \s; BOM is not whitespace.
      for (const word of normalized.matchAll(/[^\p{White_Space}]+/gu)) {
        const prefixed = word[0].startsWith('▁') ? word[0] : `▁${word[0]}`
        // Metaspace splits existing markers too (MergedWithNext), including repeats.
        for (const piece of prefixed.matchAll(/▁[^▁]*/gu)) {
          if (ids.length >= tokenBudget) return
          const encoded = await encodePiece(piece[0], vocab, scores, maxPieceScalars, unknownScore, unknownId, signal)
          for (const id of encoded) {
            if (ids.length >= tokenBudget) break
            ids.push(id)
          }
        }
      }
    }
    let offset = 0
    // Added specials match literally before normalization, never case folded.
    for (const match of text.matchAll(/<mask>|<pad>|<unk>|<\/s>|<s>/gu)) {
      let ordinary = text.slice(offset, match.index)
      if (match[0] === '<mask>') ordinary = ordinary.replace(/\p{White_Space}+$/u, '')
      await append(ordinary)
      if (ids.length >= tokenBudget) return ids
      ids.push(vocab.get(match[0])!)
      offset = match.index + match[0].length
    }
    await append(text.slice(offset))
    return ids
  }
}

async function encodePiece(piece: string, vocab: Map<string, number>, scores: Float64Array, maxPieceScalars: number,
  unknownScore: number, unknownId: number, signal?: AbortSignal): Promise<number[]> {
  // Exact Viterbi over scalar boundaries. A trie of JS objects multiplies the
  // 250k vocabulary's retained heap; bounded substring lookups need no such trie.
  const best = new Float64Array(piece.length + 1)
  const starts = new Int32Array(piece.length + 1).fill(-1)
  const tokens = new Uint32Array(piece.length + 1)
  const update = (start: number, end: number, id: number, score: number) => {
    const candidate = best[start] + score
    // Rust preserves the earlier path on ties. Do not use >= or float32 scores.
    if (starts[end] === -1 || candidate > best[end]) {
      best[end] = candidate; starts[end] = start; tokens[end] = id
    }
  }
  let nextYield = 4096
  for (let start = 0; start < piece.length;) {
    const next = start + (piece.codePointAt(start)! > 0xffff ? 2 : 1)
    let end = start, hasSingle = false
    for (let count = 0; count < maxPieceScalars && end < piece.length; count += 1) {
      end += piece.codePointAt(end)! > 0xffff ? 2 : 1
      const id = vocab.get(piece.slice(start, end))
      if (id === undefined) continue
      if (end === next) hasSingle = true
      update(start, end, id, scores[id])
    }
    if (!hasSingle) update(start, next, unknownId, unknownScore)
    start = next
    if (start >= nextYield) { nextYield = start + 4096; await yieldEncoding(signal) }
  }
  const result: number[] = []
  for (let end = piece.length; end > 0; end = starts[end]) {
    const id = tokens[end]
    if (id !== unknownId || result.at(-1) !== unknownId) result.push(id)
  }
  // Choose the optimal path over the entire piece before right truncation.
  return result.reverse()
}

function createPrecompiledNormalizer(base64: string): (text: string, signal?: AbortSignal) => Promise<string> {
  const bytes = decodeCharsmap(base64)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const trieBytes = view.getUint32(0, true)
  if (trieBytes < 4 || trieBytes % 4 || trieBytes + 4 >= bytes.length || bytes.at(-1) !== 0) throw new Error('Invalid Unigram charsmap layout.')
  const trie = new Uint32Array(trieBytes / 4)
  for (let i = 0; i < trie.length; i += 1) trie[i] = view.getUint32(4 + i * 4, true)
  const replacements = bytes.subarray(4 + trieBytes)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  decoder.decode(replacements) // Reject malformed UTF-8, not a replacement-character approximation.
  const encoder = new TextEncoder()
  const offset = (unit: number) => ((unit >>> 10) << ((unit & 512) >>> 6)) >>> 0
  if (offset(trie[0]) >= trie.length) throw new Error('Invalid Unigram charsmap root.')
  const replacementCache = new Map<number, string>()
  const transform = (utf8: Uint8Array): string | undefined => {
    let node = offset(trie[0])
    for (const byte of utf8) {
      if (!byte) break
      node ^= byte
      if (node < 0 || node >= trie.length) return undefined
      const unit = trie[node]
      if ((unit & 0x800000ff) !== byte) return undefined
      node ^= offset(unit)
      if ((unit >>> 8) & 1) {
        if (node < 0 || node >= trie.length) throw new Error('Invalid Unigram charsmap leaf.')
        const value = trie[node] & 0x7fffffff
        if (value >= replacements.length) throw new Error('Invalid Unigram charsmap replacement.')
        let replacement = replacementCache.get(value)
        if (replacement === undefined) {
          const end = replacements.indexOf(0, value)
          if (end === -1) throw new Error('Unterminated Unigram charsmap replacement.')
          replacement = decoder.decode(replacements.subarray(value, end))
          if (replacementCache.size < 4096) replacementCache.set(value, replacement)
        }
        return replacement // spm_precompiled uses the first prefix, not longest.
      }
    }
    return undefined
  }
  return async (text, signal) => {
    let normalized = ''
    let processed = 0
    const append = (part: string) => {
      if (normalized.length + part.length > MAX_NORMALIZED_UNITS) throw new Error('Unigram normalization exceeds its bound.')
      normalized += part
    }
    // Match HF's Precompiled semantics: try a whole extended grapheme only
    // below SIX UTF-8 bytes, otherwise normalize its scalars independently.
    for (const grapheme of splitGraphemes(text)) {
      const utf8 = encoder.encode(grapheme)
      const mapped = utf8.length < 6 ? transform(utf8) : undefined
      if (mapped !== undefined) { append(mapped); processed += grapheme.length }
      else for (const char of grapheme) {
        append(transform(encoder.encode(char)) ?? char)
        processed += char.length
        if (processed >= 4096) { processed = 0; await yieldEncoding(signal) }
      }
      if (processed >= 4096) { processed = 0; await yieldEncoding(signal) }
    }
    return normalized
  }
}

async function yieldEncoding(signal?: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  if (signal?.aborted) throw Object.assign(new Error('Unigram encoding was cancelled.'), { name: 'AbortError' })
}

function decodeCharsmap(base64: string): Uint8Array {
  if (base64.length < 12 || base64.length > 1024 * 1024 || base64.length % 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('Invalid Unigram charsmap encoding.')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const output = new Uint8Array(base64.length / 4 * 3 - padding)
  let offset = 0
  for (let i = 0; i < base64.length; i += 4) {
    const a = alphabet.indexOf(base64[i]), b = alphabet.indexOf(base64[i + 1])
    const c = alphabet.indexOf(base64[i + 2]), d = alphabet.indexOf(base64[i + 3])
    output[offset++] = (a << 2) | (b >>> 4)
    if (offset < output.length) output[offset++] = ((b & 15) << 4) | (c >>> 2)
    if (offset < output.length) output[offset++] = ((c & 3) << 6) | d
  }
  return output
}
