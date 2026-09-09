const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA,
  LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS,
  LOCAL_INFERENCE_RUNTIME_FAMILIES,
  runLocalInferenceCompatibilityEvaluation,
} = require('../src/modules/knowledge/testing/localInferenceCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isLocalInferenceCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isLocalInferenceCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertRuntimeEnvelope(item) {
  assert.ok(item.runtimeSource, `${item.fixtureId} records runtime source`)
  assert.ok(item.docs.length > 0, `${item.fixtureId} records docs`)
  assert.ok(item.baseUrl, `${item.fixtureId} records base URL`)
  assert.ok(item.endpointShape.chat, `${item.fixtureId} records chat endpoint`)
  assert.ok(item.timeoutMs >= 30000, `${item.fixtureId} records timeout policy`)
  assert.ok(item.requirements.minSystemRamGb > 0, `${item.fixtureId} records memory requirement`)
  assert.equal(item.requirements.mobileRuntimeSupported, false, `${item.fixtureId} is not mislabeled as a React Native mobile runtime`)
}

function assertReadyLanRuntime(item) {
  assertRuntimeEnvelope(item)
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready as a LAN service target`)
  assert.equal(item.hostKind, 'lan', `${item.fixtureId} is modeled as a LAN target`)
  assert.equal(item.userOptIn, true, `${item.fixtureId} requires explicit opt-in`)
  assert.equal(item.mobileReachability, 'requires-lan-host', `${item.fixtureId} records mobile LAN reachability`)
  assert.ok(item.capabilitySummary.declared.includes('chat'), `${item.fixtureId} declares chat`)
  assert.ok(item.capabilitySummary.declared.includes('streaming'), `${item.fixtureId} declares streaming`)
  assert.ok(item.modelCount > 0, `${item.fixtureId} records model metadata`)
  assert.ok(item.riskCodes.includes('not_mobile_runtime'), `${item.fixtureId} records server-runtime boundary`)
}

function wordPieceDefinition(vocab) {
  const special = id => ({ SpecialToken: { id, type_id: 0 } })
  return {
    version: '1.0', truncation: null, padding: null,
    model: { type: 'WordPiece', vocab, unk_token: '[UNK]', continuing_subword_prefix: '##', max_input_chars_per_word: 100 },
    normalizer: { type: 'BertNormalizer', clean_text: true, handle_chinese_chars: true, strip_accents: null, lowercase: true },
    pre_tokenizer: { type: 'BertPreTokenizer' },
    post_processor: {
      type: 'TemplateProcessing',
      single: [special('[CLS]'), { Sequence: { id: 'A', type_id: 0 } }, special('[SEP]')],
      pair: [special('[CLS]'), { Sequence: { id: 'A', type_id: 0 } }, special('[SEP]'),
        { Sequence: { id: 'B', type_id: 1 } }, { SpecialToken: { id: '[SEP]', type_id: 1 } }],
      special_tokens: Object.fromEntries(['[CLS]', '[SEP]'].map(token => [token, { id: token, ids: [vocab[token]], tokens: [token] }])),
    },
    added_tokens: ['[PAD]', '[UNK]', '[CLS]', '[SEP]', '[MASK]'].filter(token => Number.isInteger(vocab[token]))
      .map(content => ({ id: vocab[content], content, single_word: false, lstrip: false, rstrip: false, normalized: false, special: true })),
  }
}

function unigramDefinition() {
  // A tiny Darts charsmap: UTF-8 C3 A9 (é) -> "e". The lookup is deliberately
  // prefix-matching, just like the serialized spm_precompiled reference.
  const charsmap = Buffer.alloc(4 + 1024 * 4 + 2)
  charsmap.writeUInt32LE(1024 * 4, 0)
  const unit = (index, value) => charsmap.writeUInt32LE(value >>> 0, 4 + index * 4)
  unit(0, 256 << 10)
  unit(256 ^ 0xc3, ((512 ^ (256 ^ 0xc3)) << 10) | 0xc3)
  unit(512 ^ 0xa9, ((768 ^ (512 ^ 0xa9)) << 10) | 256 | 0xa9)
  unit(768, 0x80000000)
  charsmap[4 + 1024 * 4] = 101
  const vocab = ['<s>', '<pad>', '</s>', '<unk>', '<mask>', '▁', 'a', 'b', 'c', '▁a',
    'ab', 'bc', '😀', 'x', '▁ab', 'e', '\u0301', '\u0323', '▁e']
    .map((token, id) => [token, id < 5 ? 0 : id === 14 ? -100 : [9, 18].includes(id) ? -2 : -1])
  return {
    model: { type: 'Unigram', unk_id: 3, vocab },
    normalizer: { type: 'Precompiled', precompiled_charsmap: charsmap.toString('base64') },
    pre_tokenizer: { type: 'Sequence', pretokenizers: [{ type: 'WhitespaceSplit' },
      { type: 'Metaspace', replacement: '▁', add_prefix_space: true }] },
    post_processor: { type: 'TemplateProcessing',
      single: [{ SpecialToken: { id: '<s>', type_id: 0 } }, { Sequence: { id: 'A', type_id: 0 } }, { SpecialToken: { id: '</s>', type_id: 0 } }],
      special_tokens: Object.fromEntries([['<s>', 0], ['</s>', 2]].map(([id, index]) => [id, { id, ids: [index], tokens: [id] }])) },
    added_tokens: vocab.slice(0, 5).map(([content], id) => ({ id, content, single_word: false,
      lstrip: content === '<mask>', rstrip: false, normalized: false, special: true })),
  }
}

async function runUnigramTokenizerTests() {
  const { parseXlmRobertaTokenizer } = require('../src/platform/localModels/xlmRobertaTokenizer.ts')
  const tokenizer = await parseXlmRobertaTokenizer(JSON.stringify(unigramDefinition()))
  for (const [text, expected] of [
    ['abc', [9, 11]], // Optimal scoring is not longest-match; strict ties keep the earlier path.
    ['😀\u{f0000}\u{f0001}', [5, 12, 3]],
    ['\u{f0000} \u{f0001}', [5, 3, 5, 3]], // Unknown fusion cannot cross pre-token boundaries.
    ['a\u0085b', [9, 5, 7]], ['a\ufeffb', [9, 3, 7]],
    ['▁▁a▁b', [5, 9, 5, 7]],
    ['<unk><unk>a<mask>b', [3, 3, 9, 4, 5, 7]],
    ['é', [18]], ['é\u0301', [18]], // A short grapheme uses its first mapped prefix.
    ['é\u0301\u0323', [18, 16, 17]], // At six UTF-8 bytes, fall back to scalar transforms.
    ['', []], [' \t\n', []],
  ]) assert.deepEqual(await tokenizer.tokenize(text, 128), expected, `Unigram regression: ${JSON.stringify(text)}`)
  assert.deepEqual(await tokenizer.tokenize('abc', 1), [9], 'truncate only after selecting the full-piece best path')
  assert.deepEqual(await tokenizer.tokenize('a', 0), [])
  assert.ok((await tokenizer.tokenize('a'.repeat(32768), 126)).length <= 126)
  await assert.rejects(() => tokenizer.tokenize('a'.repeat(32769), 126), /bound/)
  await assert.rejects(() => tokenizer.tokenize('\ud800', 126), /invalid Unicode/)
  const encodingAbort = new AbortController()
  const encoding = tokenizer.tokenize('a'.repeat(32768), 126, encodingAbort.signal)
  setTimeout(() => encodingAbort.abort(), 0)
  await assert.rejects(encoding, { name: 'AbortError' }, 'long encoding yields to its own cancellation signal')
  const definition = unigramDefinition()
  const escaped = '"vocab":[1]"/\\'
  definition.model.vocab.push(...Array.from({ length: 4096 }, (_, index) => [`piece-${index}`, -20]), [escaped, -1])
  const { model, ...metadata } = definition
  // Reordered fields, nested decoy names, quotes/brackets/backslashes in a
  // piece, and a real batch boundary must not become ad-hoc field extraction.
  const reordered = { decoy: { model: { vocab: [] }, text: '"model":{"vocab":[' }, ...metadata,
    model: { vocab: model.vocab, unk_id: model.unk_id, type: model.type } }
  const batched = await parseXlmRobertaTokenizer(JSON.stringify(reordered, null, 2))
  assert.deepEqual(await batched.tokenize('abc', 126), [9, 11])
  assert.deepEqual(await batched.tokenize(escaped, 126), [5, model.vocab.length - 1])
  const raw = JSON.stringify(unigramDefinition())
  for (const malformed of [
    raw.replace('"vocab":[', '"vocab":[,'), raw.replace('["▁",-1]', '["▁",-1,0]'),
    raw.replace('"unk_id":3,', '"unk_id":3,"vocab":[],'),
    raw.replace('"model":', '"model":null,"model":'), `${raw} trailing-junk`,
  ]) await assert.rejects(() => parseXlmRobertaTokenizer(malformed), 'batched extraction must not bypass the JSON grammar or ambiguous model/vocab rejection')
  for (const mutate of [
    d => { d.model.type = 'BPE' }, d => { d.model.byte_fallback = true },
    d => { d.model.unk_id = -1 }, d => { d.model.vocab.push(d.model.vocab[5]) },
    d => { d.model.vocab[5][1] = NaN }, d => { d.model.vocab[5][0] = 'x'.repeat(33) },
    d => { d.normalizer.type = 'NFKC' }, d => { d.normalizer.precompiled_charsmap = 'not base64' },
    d => { d.pre_tokenizer.pretokenizers[0].type = 'Whitespace' },
    d => { d.pre_tokenizer.pretokenizers[1].prepend_scheme = 'never' },
    d => { d.pre_tokenizer.pretokenizers[1].split = false },
    d => { d.added_tokens[4].lstrip = false }, d => { d.added_tokens[0].normalized = true },
    d => { d.post_processor.special_tokens['<s>'].ids = [999] },
  ]) {
    const definition = unigramDefinition(); mutate(definition)
    await assert.rejects(() => parseXlmRobertaTokenizer(JSON.stringify(definition)), /Unigram|XLM-R/,
      'Unsupported or malformed pipelines must fail closed, not approximate')
  }
}

async function runOnnxInitializationRecoveryTests() {
  const originalLoad = Module._load
  const tokenizerFailure = new Error('temporary tokenizer read failure')
  const sessionFailure = new Error('temporary native session failure')
  let failTokenizer = true
  let failSession = false
  let tokenizerReads = 0
  let tokenizerData = wordPieceDefinition({ '[PAD]': 0, '[CLS]': 1, '[SEP]': 2, '[UNK]': 3, hello: 4, world: 5 })
  let tokenLimit = 8
  let lastFeeds
  let sessionCreates = 0
  let outputFactory
  let finishRun
  let runStarted
  let modelResolutionHook
  let tokenizerReadHook
  let modelResolutions = 0
  let diagnosticErrors = 0
  let tensorDisposals = 0
  const released = []
  const tensor = (data, dims) => ({ data: new Float32Array(data), dims, dispose() { tensorDisposals += 1 } })

  Module._load = function loadWithOnnxFakes(request, parent, isMain) {
    if (request === 'expo-file-system/legacy') return {
      EncodingType: { UTF8: 'utf8' },
      async readAsStringAsync() {
        tokenizerReads += 1
        if (failTokenizer) {
          failTokenizer = false
          throw tokenizerFailure
        }
        await tokenizerReadHook?.()
        return JSON.stringify(tokenizerData)
      },
    }
    if (request === '@/bootstrap/localModelCatalog') return {
      async resolveConfiguredLocalEmbeddingModel(settings, signal) {
        modelResolutions += 1
        await modelResolutionHook?.(signal)
        return {
          model: { id: settings.localEmbeddingModelId, version: 'test-v1', dimension: 2,
            tokenizer: settings.localEmbeddingModelId.startsWith('unigram') ? 'unigram' : 'wordpiece',
            pooling: settings.localEmbeddingModelId === 'cls-pooling' ? 'cls' : 'mean', maxTokens: tokenLimit },
          source: 'downloaded',
          directoryUri: `file:///test-models/${settings.localEmbeddingModelId}/`,
        }
      },
    }
    if (request === '@/services/runtimeHealthLog') return { logContextOperation: async () => { diagnosticErrors += 1 } }
    if (request === 'onnxruntime-react-native') return {
      Tensor: class {
        constructor(type, data, dims) {
          Object.assign(this, { type, data, dims })
        }
        dispose() { tensorDisposals += 1 }
      },
      InferenceSession: {
        async create(uri) {
          sessionCreates += 1
          if (failSession) {
            failSession = false
            throw sessionFailure
          }
          return {
            inputNames: ['input_ids', 'attention_mask', 'token_type_ids'],
            outputNames: ['sentence_embedding'],
            async run(feeds) {
              assert.ok(feeds.input_ids.dims[1] <= tokenLimit, 'special tokens fit inside the model token limit')
              lastFeeds = feeds
              if (runStarted) { runStarted(); await new Promise(resolve => { finishRun = resolve }) }
              return outputFactory?.(feeds) ?? { sentence_embedding: tensor([3, 4], [1, 2]) }
            },
            async release() { released.push(uri) },
          }
        },
      },
    }
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const { createOnnxEmbeddingProvider, releaseOnnxEmbeddingResources } = require('../src/bootstrap/knowledgeEmbeddingProvider.ts')
    const tokenizerProvider = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'retry-tokenizer', localEmbeddingModelSource: 'downloaded' })
    assert.equal(await tokenizerProvider.available(), false, 'a tokenizer read failure makes the provider temporarily unavailable')
    assert.equal(tokenizerReads, 1, 'availability attempts the tokenizer read')
    assert.equal(await tokenizerProvider.available(), true, 'a transient tokenizer failure must not poison the model cache')
    assert.deepEqual(await tokenizerProvider.embed('hello'), [0.6, 0.8], 'the recovered tokenizer can produce an embedding')
    assert.equal(tokenizerReads, 2, 'successful tokenizers stay cached after the retry')

    const sessionProvider = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'retry-session', localEmbeddingModelSource: 'downloaded' })
    failSession = true
    sessionCreates = 0
    tokenizerReads = 0
    const first = await Promise.allSettled([sessionProvider.embed('hello'), sessionProvider.embed('world')])
    assert.deepEqual(first, [
      { status: 'rejected', reason: sessionFailure },
      { status: 'rejected', reason: sessionFailure },
    ], 'concurrent callers receive the same initialization failure')
    assert.equal(sessionCreates, 1, 'concurrent embeddings share one pending native session')
    assert.deepEqual(await sessionProvider.embed('hello'), [0.6, 0.8], 'a failed native session can be retried')
    assert.deepEqual(await sessionProvider.embed('world'), [0.6, 0.8], 'a successful native session remains reusable')
    assert.equal(sessionCreates, 2, 'only the failed session is evicted')
    assert.equal(tokenizerReads, 1, 'session failure does not evict the successful tokenizer')
    assert.equal(sessionProvider.dimension, 2, 'the descriptor exposes the actual model dimension, not a hard-coded 384')
    assert.match(sessionProvider.model, /test-v1:onnx-pipeline-v3:mean$/, 'changed preprocessing has a new vector-space identity')
    assert.ok(released.some(uri => uri.includes('retry-tokenizer')), 'switching models releases the idle native session')
    await sessionProvider.embed('hello '.repeat(30))

    outputFactory = () => ({ sentence_embedding: tensor([3, 4], [1, 2]), last_hidden_state: tensor([1, 0, 1, 0, 1, 0], [1, 3, 2]) })
    assert.deepEqual(await sessionProvider.embed('hello'), [0.6, 0.8], 'sentence embeddings take precedence over raw hidden state')
    outputFactory = () => ({ last_hidden_state: tensor([3, 4, 0, 10, 0, 10], [1, 3, 2]) })
    const cls = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'cls-pooling', localEmbeddingModelSource: 'downloaded' })
    assert.deepEqual(await cls.embed('hello'), [0.6, 0.8], 'CLS models do not mean-pool token states')
    for (const invalid of [tensor([1, 2, 3], [1, 3]), tensor([NaN, 0], [1, 2]), tensor([1, 0], [2, 2]), tensor([0, 0], [1, 2])]) {
      outputFactory = () => ({ sentence_embedding: invalid })
      await assert.rejects(() => cls.embed('hello'), /ONNX embedding/, 'invalid output dimensions/values/norms fail closed')
    }
    outputFactory = undefined
    const unsupported = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'unigram', localEmbeddingModelSource: 'downloaded' })
    const createsBeforeUnsupported = sessionCreates
    assert.equal(await unsupported.available(), false, 'Unigram metadata cannot admit a WordPiece or approximate tokenizer')
    await assert.rejects(() => unsupported.embed('hello'), /Unsupported XLM-R Unigram/)
    assert.equal(sessionCreates, createsBeforeUnsupported, 'rejected preprocessing must not allocate a native model session')

    const cancelled = new AbortController()
    cancelled.abort()
    const createsBefore = sessionCreates
    await assert.rejects(() => cls.embed('hello', { signal: cancelled.signal }), { name: 'AbortError' })
    assert.equal(sessionCreates, createsBefore, 'pre-cancellation starts no native initialization')
    const during = new AbortController()
    const started = new Promise(resolve => { runStarted = resolve })
    const pending = cls.embed('hello', { signal: during.signal })
    await started
    during.abort()
    const releasesBefore = released.length
    const disposalsBefore = tensorDisposals
    await releaseOnnxEmbeddingResources()
    assert.equal(released.length, releasesBefore, 'cleanup never releases a session still executing')
    finishRun()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.ok(tensorDisposals > disposalsBefore, 'cancelled native runs discard and dispose late tensor results')
    assert.equal(released.length, releasesBefore + 1, 'retired native resources release once the run has settled')
    runStarted = undefined
    await releaseOnnxEmbeddingResources()

    const parityVocab = { '[PAD]': 0, '[CLS]': 1, '[SEP]': 2, '[UNK]': 3, '[MASK]': 4,
      hello: 5, world: 6, can: 7, "'": 8, t: 9, cafe: 10, naive: 11,
      'οσ': 12, 'οσα': 13, 'σ': 14, 'ς': 15, '日': 16, '本': 17, '語': 18, 'テキスト': 19,
      ['한국어'.normalize('NFD')]: 20, '##world': 21, '+': 22, '—': 23, '€10': 24, '@@world': 25,
      Hello: 26, 'Café': 27, 'café': 28, Cafe: 29, i: 30, 'i\u0307': 31, '[': 32, mask: 33, ']': 34,
      ['a'.repeat(101)]: 35, ['😀'.repeat(51)]: 36 }
    const cases = [
      ["Can't", [7, 8, 9]],
      ['Café naïve Cafe\u0301', [10, 11, 10]],
      ['ΟΣ ΟΣΑ Σ σ ς', [12, 13, 14, 14, 15]],
      ['日本語テキスト', [16, 17, 18, 19]],
      ['한국어', [20]],
      ['hello𠀀world', [5, 3, 6]],
      ['\ue000hello\u200bworld\0\ufffd', [5, 21]],
      ['hello\u0085world', [5, 21]],
      ['hello\u2003world', [5, 6]],
      ['hello\u0378world', [3]], // Cn is not unicode_categories::is_other.
      ['hello+world—café', [5, 22, 6, 23, 10]],
      ['€10', [24]], // Unicode currency is not BERT punctuation.
      ['HELLO[MASK]world[CLS]', [5, 4, 6, 1]],
      ['[mask]', [32, 33, 34]],
      ['a'.repeat(101), [3]], // Limit applies even to a full vocabulary entry.
      ['😀'.repeat(51), [36]], // Count Unicode scalars, not UTF-16 code units.
      ['', []],
      ['Café Hello', [27, 26], { lowercase: false }],
      ['Café', [28], { strip_accents: false }],
      ['Café', [29], { strip_accents: true, lowercase: false }],
      ['İ', [31], { strip_accents: false }],
      ['İ', [30]],
      ['日本語', [3], { handle_chinese_chars: false }],
      ['\vhello\fworld\u0085', [5, 6], { clean_text: false }],
      ['\0hello', [3], { clean_text: false }],
    ]
    for (const [index, [text, contentIds, normalizer]] of cases.entries()) {
      tokenizerData = wordPieceDefinition(parityVocab)
      Object.assign(tokenizerData.normalizer, normalizer)
      const provider = await createOnnxEmbeddingProvider({ localEmbeddingModelId: `wordpiece-${index}`, localEmbeddingModelSource: 'downloaded' })
      await provider.embed(text)
      const expected = [1, ...contentIds, 2]
      assert.deepEqual(Array.from(lastFeeds.input_ids.data, Number), expected, `BERT/WordPiece regression ${index}`)
      assert.equal(lastFeeds.input_ids.type, 'int64')
      assert.deepEqual(lastFeeds.input_ids.dims, [1, expected.length])
      assert.deepEqual(Array.from(lastFeeds.attention_mask.data, Number), expected.map(() => 1), 'single sentences are not sample-batch padded')
      assert.deepEqual(Array.from(lastFeeds.token_type_ids.data, Number), expected.map(() => 0))
    }
    tokenizerData = wordPieceDefinition(parityVocab)
    tokenizerData.model.continuing_subword_prefix = '@@'
    const prefixed = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'wordpiece-prefix', localEmbeddingModelSource: 'downloaded' })
    await prefixed.embed('helloworld')
    assert.deepEqual(Array.from(lastFeeds.input_ids.data, Number), [1, 5, 25, 2], 'continuation prefix comes from tokenizer.json')
    await prefixed.embed('hello world '.repeat(20))
    assert.deepEqual(Array.from(lastFeeds.input_ids.data, Number), [1, 5, 6, 5, 6, 5, 6, 2], 'right truncation reserves both template tokens')
    for (const [index, mutate] of [
      d => { d.model.type = 'BPE' },
      d => { d.normalizer.type = 'Sequence' },
      d => { d.pre_tokenizer.type = 'Whitespace' },
      d => { d.added_tokens[0].normalized = true },
      d => { d.added_tokens[0].single_word = true },
      d => { d.added_tokens.push({ ...d.added_tokens[0], id: undefined, content: 'absent' }) },
      d => { d.post_processor.special_tokens['[CLS]'].ids = [999] },
      d => { delete d.model.vocab['[UNK]'] },
    ].entries()) {
      tokenizerData = wordPieceDefinition({ ...parityVocab })
      mutate(tokenizerData)
      const provider = await createOnnxEmbeddingProvider({ localEmbeddingModelId: `unsupported-wordpiece-${index}`, localEmbeddingModelSource: 'downloaded' })
      assert.equal(await provider.available(), false, 'unsupported tokenizer semantics fail closed instead of producing approximate embeddings')
      await assert.rejects(() => provider.embed('hello'))
    }
    await releaseOnnxEmbeddingResources()

    const { resolveKnowledgeSearchEmbedding } = require('../src/modules/knowledge/domain/embeddingPersistencePolicy.ts')
    const oldModel = sessionProvider.model.replace('onnx-pipeline-v3', 'onnx-pipeline-v2')
    const oldVector = JSON.stringify([0.6, 0.8])
    assert.deepEqual(resolveKnowledgeSearchEmbedding(oldVector,
      { source: 'onnx', model: sessionProvider.model, embedding: [0.6, 0.8] }, 'retained canonical text', { source: 'onnx', model: oldModel }),
    { embedding: undefined, repairRequired: false }, 'old valid vectors are skipped, not compared, relabelled, or scheduled for destructive repair')

    tokenizerData = wordPieceDefinition(parityVocab)
    outputFactory = undefined
    const abortError = () => Object.assign(new Error('Cancelled model verification'), { name: 'AbortError' })
    const admission = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'admission-cancel', localEmbeddingModelSource: 'downloaded' })
    const preAbort = new AbortController(); preAbort.abort()
    const beforePreAbort = { resolutions: modelResolutions, reads: tokenizerReads, diagnostics: diagnosticErrors }
    await assert.rejects(admission.available({ signal: preAbort.signal }), { name: 'AbortError' }, 'pre-cancelled availability must not admit model work')
    assert.deepEqual({ resolutions: modelResolutions, reads: tokenizerReads, diagnostics: diagnosticErrors }, beforePreAbort)

    let admissionStarted, finishResolution
    const entered = new Promise(resolve => { admissionStarted = resolve })
    const gate = new Promise(resolve => { finishResolution = resolve })
    const abort = new AbortController()
    modelResolutionHook = async signal => {
      assert.equal(signal, abort.signal, 'availability forwards cancellation into file/model resolution')
      admissionStarted(); await gate
      if (signal.aborted) throw abortError()
    }
    const pendingAdmission = admission.available({ signal: abort.signal })
    await entered; abort.abort(); finishResolution()
    await assert.rejects(pendingAdmission, { name: 'AbortError' })
    assert.equal(admission.model, undefined, 'cancelled resolution must not populate the descriptor cache')
    assert.equal(diagnosticErrors, beforePreAbort.diagnostics, 'cancellation is not an availability failure diagnostic')
    const healthy = new AbortController()
    modelResolutionHook = async signal => { assert.equal(signal, healthy.signal) }
    assert.equal(await admission.available({ signal: healthy.signal }), true, 'cancelled availability can retry without a poisoned cache')

    const direct = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'direct-admission', localEmbeddingModelSource: 'downloaded' })
    assert.deepEqual(await direct.embed('hello', { signal: healthy.signal }), [0.6, 0.8], 'direct embed also forwards its admission signal')

    let sharedReady, finishShared, sharedCount = 0
    const bothEntered = new Promise(resolve => { sharedReady = resolve })
    const sharedGate = new Promise(resolve => { finishShared = resolve })
    const cancelledPeer = new AbortController()
    modelResolutionHook = async signal => {
      assert.ok(signal === healthy.signal || signal === cancelledPeer.signal)
      if (++sharedCount === 2) sharedReady()
      await sharedGate
      if (signal.aborted) throw abortError()
    }
    const shared = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'shared-admission', localEmbeddingModelSource: 'downloaded' })
    const peers = Promise.allSettled([shared.available({ signal: cancelledPeer.signal }), shared.available({ signal: healthy.signal })])
    await bothEntered; cancelledPeer.abort(); finishShared()
    const peerResults = await peers
    assert.equal(peerResults[0].status, 'rejected')
    assert.equal(peerResults[0].reason.name, 'AbortError')
    assert.deepEqual(peerResults[1], { status: 'fulfilled', value: true }, 'one cancelled caller cannot cancel a healthy peer')
    assert.match(shared.model, /shared-admission@/)
    modelResolutionHook = undefined
    await releaseOnnxEmbeddingResources()

    tokenizerData = unigramDefinition()
    tokenizerData.model.vocab.push(...Array.from({ length: 4096 }, (_, index) => [`piece-${index}`, -20]))
    tokenLimit = 128
    const unigram = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'unigram-shared-init', localEmbeddingModelSource: 'downloaded' })
    let readReady, completeRead
    const readEntered = new Promise(resolve => { readReady = resolve })
    const readGate = new Promise(resolve => { completeRead = resolve })
    tokenizerReadHook = () => { readReady(); return readGate }
    const cancelledInitialization = new AbortController()
    const beforeSharedInitialization = { reads: tokenizerReads, creates: sessionCreates }
    const initializedPeers = Promise.allSettled([unigram.embed('abc', { signal: cancelledInitialization.signal }), unigram.embed('abc')])
    await readEntered
    cancelledInitialization.abort(); completeRead()
    const initializationResults = await initializedPeers
    assert.equal(initializationResults[0].status, 'rejected')
    assert.equal(initializationResults[0].reason.name, 'AbortError')
    assert.deepEqual(initializationResults[1], { status: 'fulfilled', value: [0.6, 0.8] })
    assert.equal(tokenizerReads, beforeSharedInitialization.reads + 1, 'concurrent Unigram admission shares its tokenizer read/build')
    assert.equal(sessionCreates, beforeSharedInitialization.creates + 1, 'cancelled initialization cannot poison its healthy peer')
    assert.deepEqual(Array.from(lastFeeds.input_ids.data, Number), [0, 9, 11, 2])
    assert.match(unigram.model, /:onnx-unigram-v1:mean$/)

    const retired = await createOnnxEmbeddingProvider({ localEmbeddingModelId: 'unigram-retired-init', localEmbeddingModelSource: 'downloaded' })
    let retiredReady, finishRetiredRead
    const retirementEntered = new Promise(resolve => { retiredReady = resolve })
    const retirementGate = new Promise(resolve => { finishRetiredRead = resolve })
    tokenizerReadHook = () => { retiredReady(); return retirementGate }
    const retiring = retired.embed('abc')
    await retirementEntered
    const createsBeforeRetirement = sessionCreates
    await releaseOnnxEmbeddingResources(); finishRetiredRead()
    await assert.rejects(retiring, { name: 'AbortError' })
    assert.equal(sessionCreates, createsBeforeRetirement, 'resource retirement during preprocessing cannot admit a late native session')
    tokenizerReadHook = undefined
    assert.deepEqual(await retired.embed('abc'), [0.6, 0.8], 'fresh admission can retry without reusing the retired initializer')
    await releaseOnnxEmbeddingResources()
  } finally {
    Module._load = originalLoad
  }
}

async function runBootstrapOnnxAdmissionTests() {
  const originalLoad = Module._load
  const bootstrapPath = require.resolve('../src/bootstrap/knowledgeRepository.ts')
  const originalCachedModule = require.cache[bootstrapPath]
  let queryDependencies, indexDependencies
  let resolvedModel = 'admission-test'
  const admissions = [], embeds = []
  Module._load = function loadBootstrapAdmission(request, parent, isMain) {
    if (request === '@/modules/knowledge') return {
      createSqliteKnowledgeRepository: () => ({}), createSqliteKnowledgeColbertIndex: () => ({}), createSqliteKnowledgeAgenticIndex: () => ({}),
      createKnowledgeQueryEmbeddingUseCase: dependencies => { queryDependencies = dependencies; return {} },
      createSqliteKnowledgeHybridIndex: (_, dependencies) => { indexDependencies = dependencies; return {} },
    }
    if (request === '@/platform/storage') return { createExpoSqliteDatabaseProvider: () => ({}) }
    if (request === '@/modules/providers') return {}
    if (request === '@/core') return { sha256Hex: () => 'unused-provider-space' }
    if (request === './knowledgeEmbeddingProvider') return { createOnnxEmbeddingProvider: async () => ({
      model: resolvedModel, available: async options => { admissions.push(options); return true },
      embed: async (_, options) => { embeds.push(options); return [1, 0] },
    }) }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    delete require.cache[bootstrapPath]
    require(bootstrapPath)
    const signal = new AbortController().signal
    await queryDependencies.embedWithOnnx({ query: 'hello', embeddingMode: 'local', signal })
    const port = await indexDependencies.resolveOnnxEmbeddingPort({ embeddingMode: 'local', signal })
    await port.embed('hello', { signal })
    assert.equal(admissions.length, 2)
    assert.ok(admissions.every(options => options?.signal === signal), 'both actual bootstrap factories pass the owner signal into availability')
    assert.ok(embeds.every(options => options.signal === signal))
    const beforeFallback = embeds.length
    resolvedModel = 'fallback-model@v1:onnx-pipeline-v3:mean'
    const refused = await indexDependencies.resolveOnnxEmbeddingPort({ embeddingMode: 'local', localEmbeddingModelId: 'selected-model', signal })
    assert.equal(refused, undefined, 'explicit indexing cannot admit a different fallback model after requested-model failure')
    assert.equal(embeds.length, beforeFallback, 'fallback indexing never dispatches inference')
    assert.equal((await queryDependencies.embedWithOnnx({ query: 'hello', embeddingMode: 'local', localEmbeddingModelId: 'selected-model', signal })).model,
      resolvedModel, 'read-only catalogue fallback retains its actual vector-space identity')
    resolvedModel = 'selected-model@v1:onnx-unigram-v1:mean'
    assert.ok(await indexDependencies.resolveOnnxEmbeddingPort({ embeddingMode: 'local', localEmbeddingModelId: 'selected-model', signal }),
      'explicit indexing still admits its verified requested model')
  } finally {
    Module._load = originalLoad
    delete require.cache[bootstrapPath]
    if (originalCachedModule) require.cache[bootstrapPath] = originalCachedModule
  }
}

async function runFileIntegrityAdapterTests() {
  // These are JS boundary tests with native/Expo fakes, not Android hash evidence.
  const crypto = require('node:crypto')
  const originalLoad = Module._load
  const modulePaths = ['expoLocalModelFileIntegrity', 'expoLocalModelArtifactInstaller']
    .map(name => require.resolve(`../src/platform/localModels/${name}.ts`))
  const cached = modulePaths.map(name => require.cache[name])
  const bytes = Buffer.alloc(1024 * 1024 + 7, 97)
  const expected = crypto.createHash('sha256').update(bytes).digest('hex')
  const requests = [], calls = [], cancellations = []
  let infoCalls = 0
  const fileSystem = {
    documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' },
    async getInfoAsync() { infoCalls += 1; return { exists: true, size: bytes.length } },
    async readAsStringAsync(uri, options) {
      requests.push(options)
      return bytes.subarray(options.position, options.position + options.length).toString('base64')
    },
  }
  const nativeModule = {
    async sha256File(id, uri, size) {
      calls.push({ id, uri, size })
      return { sha256: expected, bytesHashed: bytes.length }
    },
    cancel(id) { cancellations.push(id) },
  }
  Module._load = function loadWithIntegrityFakes(request, parent, isMain) {
    if (request === 'expo-file-system/legacy') return fileSystem
    if (request === 'react-native') return { Platform: { OS: 'android' }, NativeModules: { AndroidFileIntegrity: nativeModule } }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    modulePaths.forEach(name => { delete require.cache[name] })
    const { createExpoLocalModelFileIntegrityPort } = require(modulePaths[0])
    const port = createExpoLocalModelFileIntegrityPort()
    assert.equal(await port.sha256File('file:///docs/model'), expected)
    assert.equal(await port.sha256File('file:///cache/update.apk'), expected)
    const { createExpoLocalModelArtifactInstallerPort } = require(modulePaths[1])
    assert.equal(await createExpoLocalModelArtifactInstallerPort(fileSystem).sha256File('file:///docs/staging/model'), expected)
    assert.equal(calls.length, 3, 'admission, APK cache and installer use the native digest')
    assert.ok(calls.every(call => call.size === bytes.length))
    assert.equal(requests.length, 0, 'native hashing never loads file bytes into JS')

    const fallback = createExpoLocalModelFileIntegrityPort(fileSystem, null)
    assert.equal(await fallback.sha256File('file:///docs/model'), expected, 'older APK/other-platform fallback preserves the full digest')
    assert.deepEqual(requests.map(({ position, length }) => [position, length]), [[0, 1024 * 1024], [1024 * 1024, 7]])
    assert.equal(await port.sha256File('asset:///model'), expected, 'other URI schemes retain the Expo reader')
    assert.equal(await port.sha256File('file:///external/model'), expected, 'non-private paths are not redirected to the private-file native API')
    assert.equal(calls.length, 3)

    const beforeInfo = infoCalls, beforeNative = calls.length
    const preAborted = new AbortController(); preAborted.abort()
    await assert.rejects(port.sha256File('file:///docs/model', preAborted.signal), { name: 'AbortError' })
    assert.equal(infoCalls, beforeInfo); assert.equal(calls.length, beforeNative)
    const beforeReads = requests.length
    for (const bad of [{ sha256: expected, bytesHashed: bytes.length - 1 }, { sha256: 'not-sha256', bytesHashed: bytes.length }]) {
      await assert.rejects(createExpoLocalModelFileIntegrityPort(fileSystem, {
        ...nativeModule, async sha256File() { return bad },
      }).sha256File('file:///docs/model'), /incomplete digest/)
    }
    const failure = new Error('native read failed')
    await assert.rejects(createExpoLocalModelFileIntegrityPort(fileSystem, {
      ...nativeModule, async sha256File() { throw failure },
    }).sha256File('file:///docs/model'), error => error === failure)
    assert.equal(requests.length, beforeReads, 'invalid/native failures never silently downgrade to the JS reader')

    const pending = []
    let started
    const bothStarted = new Promise(resolve => { started = resolve })
    const concurrent = createExpoLocalModelFileIntegrityPort(fileSystem, {
      ...nativeModule,
      sha256File(id) {
        return new Promise(resolve => { pending.push({ id, resolve }); if (pending.length === 2) started() })
      },
    })
    const abort = new AbortController(), healthy = new AbortController()
    let settled = false
    const cancelled = concurrent.sha256File('file:///docs/model', abort.signal).finally(() => { settled = true })
    const cancelledAssertion = assert.rejects(cancelled, { name: 'AbortError' })
    const other = concurrent.sha256File('file:///docs/model', healthy.signal)
    await bothStarted
    assert.notEqual(pending[0].id, pending[1].id, 'concurrent hashes have independent native ownership')
    abort.abort()
    assert.deepEqual(cancellations, [pending[0].id])
    await Promise.resolve()
    assert.equal(settled, false, 'cancellation awaits native cleanup instead of abandoning its worker')
    pending[1].resolve({ sha256: expected, bytesHashed: bytes.length })
    assert.equal(await other, expected)
    pending[0].resolve({ sha256: expected, bytesHashed: bytes.length })
    await cancelledAssertion
    healthy.abort()
    assert.deepEqual(cancellations, [pending[0].id], 'settled listeners detach; cancellation cannot poison another hash')

    const duringDispatch = new AbortController()
    const raced = createExpoLocalModelFileIntegrityPort(fileSystem, {
      ...nativeModule,
      sha256File() { duringDispatch.abort(); return Promise.resolve({ sha256: expected, bytesHashed: bytes.length }) },
    })
    await assert.rejects(raced.sha256File('file:///docs/model', duringDispatch.signal), { name: 'AbortError' })
    assert.equal(cancellations.length, 2, 'dispatch/registration cancellation race still reaches native ownership')
    console.log('File integrity adapter boundary tests passed (Host verified; mocked native module)')
  } finally {
    Module._load = originalLoad
    modulePaths.forEach((name, index) => { delete require.cache[name]; if (cached[index]) require.cache[name] = cached[index] })
  }
}

async function run() {
  assert.equal(LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA, 'islemind.local-inference-compatibility-eval.v1', 'local inference schema is versioned')
  assert.deepEqual(
    LOCAL_INFERENCE_RUNTIME_FAMILIES,
    ['ollama', 'llama-cpp', 'lm-studio', 'localai', 'vllm', 'sglang'],
    'local inference gate covers current local runtime families'
  )
  assert.deepEqual(
    LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS,
    [
      'ollama-openai-compatible',
      'llama-cpp-server',
      'lm-studio-openai-compatible',
      'localai-audio-and-grammar',
      'vllm-gpu-server',
      'sglang-reasoning-server',
      'mobile-loopback-warning',
      'model-list-fallback',
      'memory-pressure-boundary',
    ],
    'local inference fixtures cover ready runtimes and failure boundaries'
  )

  const evaluation = runLocalInferenceCompatibilityEvaluation({ now: () => 2000000000000 })
  assert.equal(evaluation.schema, LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `local inference gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  assertReadyLanRuntime(diagnostic(evaluation, 'ollama-openai-compatible'))
  assertReadyLanRuntime(diagnostic(evaluation, 'llama-cpp-server'))
  assertReadyLanRuntime(diagnostic(evaluation, 'lm-studio-openai-compatible'))
  assertReadyLanRuntime(diagnostic(evaluation, 'vllm-gpu-server'))
  assertReadyLanRuntime(diagnostic(evaluation, 'sglang-reasoning-server'))

  const ollama = diagnostic(evaluation, 'ollama-openai-compatible')
  assert.ok(ollama.docs.some((url) => url.includes('docs.ollama.com')), 'Ollama fixture records current docs')
  assert.ok(ollama.capabilitySummary.declared.includes('structuredOutput'), 'Ollama fixture records structured output')
  assert.ok(ollama.capabilitySummary.declared.includes('embeddings'), 'Ollama fixture records embeddings')

  const llamaCpp = diagnostic(evaluation, 'llama-cpp-server')
  assert.equal(llamaCpp.family, 'llama-cpp', 'llama.cpp fixture records family')
  assert.ok(llamaCpp.manualModelFallbackUsed === false, 'llama.cpp ready fixture uses discovered metadata')

  const localai = diagnostic(evaluation, 'localai-audio-and-grammar')
  assertRuntimeEnvelope(localai)
  assert.equal(localai.readiness, 'ready', 'LocalAI remains ready as a LAN service target')
  assert.ok(localai.capabilitySummary.declared.includes('audio'), 'LocalAI fixture records transcription capability')
  assert.ok(localai.capabilitySummary.declared.includes('speech'), 'LocalAI fixture records speech capability')
  assert.ok(localai.riskCodes.includes('structured_output_adapter_required'), 'LocalAI grammar-backed structured output requires an adapter')

  const loopback = diagnostic(evaluation, 'mobile-loopback-warning')
  assertRuntimeEnvelope(loopback)
  assert.equal(loopback.hostKind, 'loopback', 'mobile loopback fixture records loopback host')
  assert.equal(loopback.mobileReachability, 'not-reachable', 'mobile loopback fixture records mobile reachability failure')
  assert.equal(loopback.readiness, 'blocked', 'mobile localhost is blocked')
  assert.ok(loopback.riskCodes.includes('mobile_loopback_unreachable'), 'mobile localhost risk is explicit')

  const fallback = diagnostic(evaluation, 'model-list-fallback')
  assertRuntimeEnvelope(fallback)
  assert.equal(fallback.modelListStatus, 'error', 'model-list fallback fixture records failed model list')
  assert.equal(fallback.manualModelFallbackUsed, true, 'model-list fallback uses a manual model')
  assert.equal(fallback.modelCount, 1, 'manual model counts as one configured model')
  assert.equal(fallback.readiness, 'needs-user-config', 'model-list failure requires user configuration')
  assert.ok(fallback.riskCodes.includes('model_list_unavailable'), 'model-list failure risk is explicit')

  const memoryPressure = diagnostic(evaluation, 'memory-pressure-boundary')
  assertRuntimeEnvelope(memoryPressure)
  assert.equal(memoryPressure.readiness, 'blocked', 'oversized local runtime is blocked')
  assert.ok(memoryPressure.riskCodes.includes('memory_pressure'), 'memory pressure risk is explicit')
  assert.equal(memoryPressure.requirements.minSystemRamGb, 48, 'memory pressure fixture records system RAM requirement')
  assert.equal(memoryPressure.requirements.minGpuVramGb, 48, 'memory pressure fixture records GPU VRAM requirement')

  await runUnigramTokenizerTests()
  await runOnnxInitializationRecoveryTests()
  await runBootstrapOnnxAdmissionTests()
  await runFileIntegrityAdapterTests()
  console.log('Local inference compatibility tests passed')
}

if (require.main === module) run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

module.exports = { run }
