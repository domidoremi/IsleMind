#!/usr/bin/env node
// Capture the production provider's model inputs, not inference evidence. Pair
// with collect-local-embedding-reference.py for independent Rust/ORT results.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const { pathToFileURL } = require('node:url')
const { transformTypeScriptModule } = require('./node-ts-support')
const { corpus, cases: retrievalCases, challenges, modelFitCases } = require('./knowledge-retrieval-runtime-eval')

async function main() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
  const input = option('--cases')
  const output = option('--out')
  assert.ok(input && output, 'Usage: node scripts/collect-local-embedding-inputs.js --cases <JSON> --out <fresh JSON> [--include-retrieval] [--include-model-fit] [--model-id <catalogue ID>] [--model-dir <verified cache>] [--tokenizer-file <catalogue tokenizer>]')
  assert.ok(!fs.existsSync(output), 'Refusing to overwrite existing evidence')
  const root = path.resolve(__dirname, '..')
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'assets/models/catalog.json'), 'utf8'))
  const model = catalog.models.find(item => item.id === option('--model-id', 'all-MiniLM-L6-v2'))
  assert.ok(model, 'Model must exist in the catalogue')
  const directory = path.resolve(option('--model-dir', path.join(root, 'assets/models', model.id)))
  const directoryUri = pathToFileURL(directory + path.sep).href
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  const tokenizerFile = path.resolve(option('--tokenizer-file', path.join(directory, 'tokenizer.json')))
  const tokenizerSha256 = hash(tokenizerFile)
  assert.equal(tokenizerSha256, model.files.find(file => file.path === 'tokenizer.json').sha256)
  const selected = JSON.parse(fs.readFileSync(input, 'utf8')).cases.map(({ id, text, group }) => ({ id, text, group: group ?? 'edge' }))
  if (args.includes('--include-retrieval')) {
    selected.push(...corpus.map(([id, , text]) => ({ id: `document:${id}`, text, group: 'document' })))
    selected.push(...[...retrievalCases, ...challenges].map(([id, text]) => ({ id: `query:${id}`, text, group: 'query' })))
  }
  if (args.includes('--include-model-fit')) {
    selected.push(...modelFitCases.map(({ id, query }) => ({ id: `query:${id}`, text: query, group: 'model-fit' })))
  }
  assert.equal(new Set(selected.map(item => item.id)).size, selected.length, 'Case IDs must be unique')
  assert.ok(selected.every(item => typeof item.id === 'string' && typeof item.text === 'string'))
  const originalLoad = Module._load
  const originalResolve = Module._resolveFilename
  const originalTs = require.extensions['.ts']
  let feeds
  let providerModule
  Module._resolveFilename = function resolve(request, parent, isMain, options) {
    return originalResolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, parent, isMain, options)
  }
  require.extensions['.ts'] = (module, filename) => module._compile(transformTypeScriptModule(fs.readFileSync(filename, 'utf8'), filename), filename)
  Module._load = function load(request, parent, isMain) {
    if (request === 'expo-file-system/legacy') return { EncodingType: { UTF8: 'utf8' }, readAsStringAsync: async uri => {
      assert.equal(uri, `${directoryUri}tokenizer.json`)
      return fs.readFileSync(tokenizerFile, 'utf8')
    } }
    if (request === '@/bootstrap/localModelCatalog') return { resolveConfiguredLocalEmbeddingModel: async () => ({ model, source: 'downloaded', directoryUri }) }
    if (request === '@/services/runtimeHealthLog') return { logContextOperation: async () => {} }
    if (request === 'onnxruntime-react-native') return {
      Tensor: class { constructor(type, data, dims) { Object.assign(this, { type, data, dims }) } dispose() {} },
      InferenceSession: { async create() { return {
        inputNames: ['input_ids', 'attention_mask', 'token_type_ids'], outputNames: ['sentence_embedding'], release: async () => {},
        async run(inputFeeds) {
          feeds = inputFeeds
          const data = new Float32Array(model.dimension); data[0] = 1
          return { sentence_embedding: { data, dims: [1, model.dimension], dispose() {} } }
        },
      } } },
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const source = path.join(root, 'src/bootstrap/knowledgeEmbeddingProvider.ts')
    providerModule = require(source)
    const provider = await providerModule.createOnnxEmbeddingProvider({ localEmbeddingModelId: model.id, localEmbeddingModelSource: 'downloaded' })
    const records = []
    for (const item of selected) {
      await provider.embed(item.text)
      assert.equal(feeds.input_ids.type, 'int64')
      records.push({ ...item, inputIds: Array.from(feeds.input_ids.data, Number),
        attentionMask: Array.from(feeds.attention_mask.data, Number), tokenTypeIds: Array.from(feeds.token_type_ids.data, Number) })
    }
    const result = { evidenceClass: 'Host verified', createdAt: new Date().toISOString(),
      provenance: { sourceSha256: hash(source), model: provider.model, tokenizerSha256,
        preprocessingSha256: Object.fromEntries([
          'src/platform/localModels/xlmRobertaTokenizer.ts', 'node_modules/unicode-segmenter/package.json',
          ...['grapheme', 'core', '_grapheme_data'].flatMap(name => ['js', 'cjs'].map(ext => `node_modules/unicode-segmenter/${name}.${ext}`)),
        ].map(file => [file, hash(path.join(root, file))])),
        note: 'Production input capture using an ONNX stub. No model inference or native behavior is established by this file.' }, cases: records }
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ out: output, cases: records.length, model: provider.model, evidenceClass: result.evidenceClass }))
  } finally {
    await providerModule?.releaseOnnxEmbeddingResources()
    Module._load = originalLoad
    Module._resolveFilename = originalResolve
    if (originalTs) require.extensions['.ts'] = originalTs
    else delete require.extensions['.ts']
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
