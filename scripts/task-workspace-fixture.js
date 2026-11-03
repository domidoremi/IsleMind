const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { DatabaseSync } = require('node:sqlite')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = name => args.includes(name) ? path.resolve(root, args[args.indexOf(name) + 1]) : undefined
const base = option('--base')
const output = option('--output')
for (const directory of [base, output]) assert.ok(directory?.startsWith(root + path.sep), 'Use explicit workspace fixture directories')
assert.ok(!fs.existsSync(output), 'Preserve existing fixtures')
const baseline = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'))
assert.equal(baseline.synthetic, true)
assert.equal(baseline.externalServicesUsed, false)
fs.mkdirSync(output, { recursive: true })
const filename = path.join(output, 'task-workspace.sqlite')
fs.copyFileSync(path.join(base, baseline.database), filename)

const copy = {
  title: '\u8ba9\u5185\u5bb9\u7ad9\u5728\u524d\u9762\uff1a\u4e00\u6b21\u5de5\u4f5c\u533a\u7684\u91cd\u6784',
  original: '\u5efa\u8bae\u628a\u5185\u5bb9\u653e\u5728\u4e2d\u5fc3\uff0c\u8ba9\u5de5\u5177\u56f4\u7ed5\u4efb\u52a1\u5c55\u5f00\u3002\u8fd9\u662f\u56de\u7b54\u5f53\u65f6\u4fdd\u7559\u7684\u6587\u5b57\uff0c\u4e0d\u662f\u5f53\u524d\u539f\u6587\u3002',
  body: [
    '## \u7ed9\u300c\u7075\u52a8\u300d\u4e00\u4e2a\u53ef\u9a8c\u8bc1\u7684\u5b9a\u4e49',
    '\u8f7b\u76c8\u4e0d\u662f\u589e\u52a0\u88c5\u9970\uff0c\u800c\u662f\u8ba9\u4e0b\u4e00\u6b65\u66f4\u660e\u786e\u3002\u9875\u9762\u9996\u5148\u56de\u5e94\u5f53\u524d\u4efb\u52a1\uff0c\u5de5\u5177\u5728\u9700\u8981\u65f6\u51fa\u73b0\uff0c\u72b6\u6001\u53d8\u5316\u4e0d\u6253\u65ad\u8f93\u5165\u3002',
    '### \u4ece\u914d\u7f6e\u6e05\u5355\u5230\u4efb\u52a1\u5de5\u4f5c\u533a',
    '- \u9996\u9875\uff1a\u5148\u9009\u62e9\u8d77\u70b9\uff0c\u518d\u51c6\u5907\u8349\u7a3f\uff0c\u53d1\u9001\u4ecd\u7136\u7531\u4f60\u51b3\u5b9a\u3002',
    '- \u8bbe\u7f6e\uff1a\u641c\u7d22\u4e0e\u4efb\u52a1\u533a\u57df\u5404\u81ea\u4fdd\u7559\u72b6\u6001\uff0c\u4e0d\u518d\u6eda\u5b8c\u4e00\u6574\u9875\u76ee\u5f55\u3002',
    '- \u6587\u6863\uff1a\u7a3f\u4ef6\u5728\u4e2d\u5fc3\uff0c\u6765\u6e90\u3001\u4fee\u8ba2\u4e0e\u8be6\u60c5\u4e00\u6b21\u53ea\u6253\u5f00\u4e00\u9879\u3002',
    '### \u9a8c\u8bc1\u800c\u4e0d\u662f\u51ed\u611f\u89c9',
    '\u68c0\u67e5\u7a84\u5c4f\u3001\u5bbd\u5c4f\u4e0e\u4e94\u79cd\u4e3b\u9898\uff1b\u68c0\u67e5\u8f93\u5165\u8282\u70b9\u3001\u9009\u62e9\u8303\u56f4\u548c\u8fd4\u56de\u4f4d\u7f6e\u662f\u5426\u4fdd\u6301\u4e0d\u53d8\u3002',
    '### \u5de5\u4f5c\u8bb0\u5f55',
  ],
  note: '\u8fd9\u662f\u4e00\u6b21\u79bb\u7ebf\u7684\u754c\u9762\u9a8c\u8bc1\u8bb0\u5f55\u3002\u4fdd\u7559\u5f53\u524d\u8349\u7a3f\u3001\u771f\u5b9e\u6765\u6e90\u4e0e\u663e\u5f0f\u4fdd\u5b58\uff0c\u6bd4\u88c5\u9970\u6027\u52a8\u6548\u66f4\u91cd\u8981\u3002',
  sourceTitle: '\u9605\u8bfb\u6750\u6599\uff1a\u6b63\u6587\u4e0e\u5de5\u5177\u7684\u5c42\u6b21',
  sourceText: [
    '\u7075\u52a8\u9996\u5148\u662f\u4e00\u79cd\u660e\u786e\u7684\u56e0\u679c\u5173\u7cfb\uff1a\u64cd\u4f5c\u4e4b\u540e\u9875\u9762\u544a\u8bc9\u4f60\u53d1\u751f\u4e86\u4ec0\u4e48\uff0c\u5e76\u7ed9\u51fa\u4e0b\u4e00\u6b65\u3002\u5b83\u4e0d\u7b49\u4e8e\u6bcf\u4e00\u4e2a\u63a7\u4ef6\u90fd\u79fb\u52a8\u3002',
    '\u9605\u8bfb\u6750\u6599\u4e0e\u5de5\u5177\u4f7f\u7528\u4e0d\u540c\u7684\u5c42\u6b21\u3002\u6b63\u6587\u5e94\u5f53\u7a33\u5b9a\uff1b\u9009\u4e2d\u7684\u5de5\u5177\u80fd\u6539\u53d8\u4e0a\u4e0b\u6587\uff0c\u4f46\u4e0d\u80fd\u66ff\u6362\u6b63\u5728\u7f16\u8f91\u7684\u7a3f\u4ef6\u3002',
    '\u6d4b\u8bd5\u8986\u76d6\u771f\u5b9e\u6570\u636e\u91cf\u3001\u7a84\u5c4f\u4e0e\u5927\u5b57\u53f7\uff0c\u786e\u8ba4\u8fd4\u56de\u76ee\u5f55\u540e\u67e5\u8be2\u548c\u6eda\u52a8\u4f4d\u7f6e\u4e0d\u53d8\u3002',
  ],
  webTitle: '\u53c2\u8003\u6458\u5f55',
  webExcerpt: '\u8fd9\u662f\u56de\u7b54\u5f53\u65f6\u4fdd\u7559\u7684\u6458\u5f55\u3002\u6d4f\u89c8\u6765\u6e90\u5217\u8868\u4e0d\u4f1a\u8bbf\u95ee\u539f\u7f51\u9875\uff0c\u53ea\u6709\u660e\u786e\u6253\u5f00\u539f\u6587\u624d\u4f1a\u542f\u52a8\u5916\u90e8\u6d4f\u89c8\u5668\u3002',
}

const resolve = Module._resolveFilename
Module._resolveFilename = function resolveFixtureModule(request, parent, ...rest) {
  if (request === '@/platform/storage') request = path.join(root, 'src/platform/storage/expoSqliteDatabase.ts')
  else if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2))
  return resolve.call(this, request, parent, ...rest)
}
require.extensions['.ts'] = (module, file) => module._compile(transformTypeScriptModule(fs.readFileSync(file, 'utf8'), file), file)

const native = new DatabaseSync(filename)
const executor = {
  async exec(sql) { native.exec(sql) },
  async run(sql, values = []) {
    const result = native.prepare(sql).run(...values)
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) }
  },
  async getFirst(sql, values = []) { return native.prepare(sql).get(...values) ?? null },
  async getAll(sql, values = []) { return native.prepare(sql).all(...values) },
}
const database = {
  ...executor,
  async transaction(work) {
    native.exec('BEGIN IMMEDIATE')
    try { const result = await work(executor); native.exec('COMMIT'); return result }
    catch (error) { native.exec('ROLLBACK'); throw error }
  },
}

async function main() {
  const now = Date.now()
  const messageTimestamp = now - 3 * 3600000
  const documentId = 'task-source-document'
  const chunks = copy.sourceText.map((content, ordinal) => ({
    schema: 'islemind.knowledge-chunk-record.v1', id: `task-source-chunk-${ordinal}`,
    documentId, title: copy.sourceTitle, ordinal, chunkIndex: ordinal,
    headingPath: [copy.sourceTitle, String(ordinal + 1)], content, createdAt: now - 86400000,
  }))
  const { createSqliteKnowledgeRepository } = require('../src/modules/knowledge/adapters/sqliteKnowledgeRepository.ts')
  const knowledge = createSqliteKnowledgeRepository({ get: async () => database })
  await knowledge.saveDocument({
    schema: 'islemind.knowledge-document-record.v1', id: documentId, title: copy.sourceTitle,
    mimeType: 'text/plain', size: Buffer.byteLength(copy.sourceText.join('\n')), chunkCount: chunks.length,
    status: 'ready', sourceUri: 'notes/reading-workspace.txt', createdAt: now - 86400000, updatedAt: now - 3600000,
  }, chunks)
  const localCitation = {
    id: 'task-local-source', type: 'knowledge', title: copy.sourceTitle, documentId,
    chunkId: chunks[1].id, chunkIndex: 1, sourceUri: 'notes/reading-workspace.txt',
    excerpt: copy.original, score: 0.87, retrievalStage: 'retained-knowledge',
  }
  const citations = [localCitation, ...baseline.citations.map((citation, index) => ({
    ...citation, title: `${copy.webTitle} ${String(index + 1).padStart(2, '0')}: ${copy.sourceTitle}`,
    excerpt: `${copy.webExcerpt}\n\n${copy.sourceText[index % copy.sourceText.length]}`,
  }))]
  const body = [...copy.body, ...Array.from({ length: 100 }, (_, index) => `${String(index + 1).padStart(3, '0')}. ${copy.note}`),
    '[Not opened](https://unused.invalid/link)', '![Not loaded](https://unused.invalid/image.png)'].join('\n\n')
  const stored = native.prepare('SELECT payloadJson FROM saved_documents WHERE id = ?').get(baseline.documentId)
  const document = {
    ...JSON.parse(stored.payloadJson), title: copy.title, body, updatedAt: now,
    origin: {
      conversationId: baseline.conversationId, conversationTitle: copy.title, messageId: baseline.messageId,
      messageStatus: 'done', messageTimestamp, originalText: copy.original, citations: citations.slice(0, 3),
    },
  }
  const { parseSavedDocument } = require('../src/modules/documents/document.ts')
  parseSavedDocument(document)
  native.prepare('UPDATE saved_documents SET title = ?, updatedAt = ?, payloadJson = ? WHERE id = ?')
    .run(document.title, document.updatedAt, JSON.stringify(document), document.id)
  const oldMessage = JSON.parse(native.prepare('SELECT messageJson FROM conversation_message_records WHERE conversationId = ? AND id = ?')
    .get(baseline.conversationId, baseline.messageId).messageJson)
  native.prepare('UPDATE conversation_message_records SET messageJson = ? WHERE conversationId = ? AND id = ?')
    .run(JSON.stringify({ ...oldMessage, timestamp: messageTimestamp, content: copy.original, responseText: copy.original, citations }), baseline.conversationId, baseline.messageId)
  const state = JSON.parse(native.prepare('SELECT stateJson FROM conversation_record_state WHERE conversationId = ?').get(baseline.conversationId).stateJson)
  native.prepare('UPDATE conversation_record_state SET stateJson = ? WHERE conversationId = ?')
    .run(JSON.stringify({ ...state, title: copy.title }), baseline.conversationId)
  native.prepare('UPDATE conversation_records SET title = ? WHERE id = ?').run(copy.title, baseline.conversationId)
  const read = await knowledge.readLocalSource({ type: 'knowledge', documentId })
  assert.equal(read.chunks[1].content, chunks[1].content)
  const manifest = {
    ...baseline, database: path.basename(filename), body, citations, localCitation,
    sourceDocument: { title: copy.sourceTitle, chunks: copy.sourceText }, generatedAt: new Date(now).toISOString(),
    synthetic: true, externalServicesUsed: false, sourceFixture: path.relative(root, base),
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(JSON.stringify({ output, documents: manifest.documentCount, citations: citations.length, localChunks: chunks.length, bodyLength: body.length, synthetic: true }))
}

main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => native.close())
