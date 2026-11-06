const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const output = path.resolve(process.argv[2] || '')
assert(output.startsWith(root + path.sep) && !fs.existsSync(output), 'Use fresh workspace evidence')
fs.mkdirSync(output, { recursive: true })
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...args) {
  if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2))
  return resolve.call(this, request, parent, ...args)
}
require.extensions['.ts'] = (module, file) => module._compile(transformTypeScriptModule(fs.readFileSync(file, 'utf8'), file), file)
const file = path.join(output, 'scene-plans.sqlite')
const native = new DatabaseSync(file)
native.exec('PRAGMA foreign_keys=ON')
const executor = {
  async exec(sql) { native.exec(sql) },
  async run(sql, values = []) { const result = native.prepare(sql).run(...values); return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) } },
  async getFirst(sql, values = []) { return native.prepare(sql).get(...values) ?? null },
  async getAll(sql, values = []) { return native.prepare(sql).all(...values) },
}
let tail = Promise.resolve()
const database = { ...executor, transaction(work) {
  const result = tail.then(async () => {
    native.exec('BEGIN IMMEDIATE')
    try { const value = await work(executor); native.exec('COMMIT'); return value }
    catch (error) { native.exec('ROLLBACK'); throw error }
  })
  tail = result.then(() => undefined, () => undefined)
  return result
} }
async function main() {
  const provider = { get: async () => database }
  const { createSqliteConversationRepository } = require('../src/modules/conversations')
  const { createSqliteKnowledgeRepository } = require('../src/modules/knowledge')
  const { normalizeScenePlans } = require('../src/modules/settings')
  const fixture = require('./scene-plans-fixture.ts').createScenePlansFixture()
  assert.equal(normalizeScenePlans(fixture.settings.scenePlans).length, 4)
  const conversations = createSqliteConversationRepository(provider)
  const knowledge = createSqliteKnowledgeRepository(provider)
  for (const conversation of fixture.conversations) await conversations.save(conversation)
  for (const document of fixture.documents) await knowledge.saveDocument(document, fixture.chunks.filter(chunk => chunk.documentId === document.id))
  const messageBytes = native.prepare('SELECT messageJson FROM conversation_message_records WHERE conversationId = ? ORDER BY ordinal').all('scene-existing')
  assert.equal(native.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(), [])
  native.close()
  const manifest = { ...fixture, database: path.basename(file),
    databaseSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    historicalMessageBytes: messageBytes, integrity: 'ok' }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ plans: fixture.settings.scenePlans.length, conversations: fixture.conversations.length,
    documents: fixture.documents.length, database: file, integrity: manifest.integrity }))
}
main().catch(error => { try { native.close() } catch {} console.error(error); process.exitCode = 1 })
