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
const file = path.join(output, 'connection-references.sqlite')
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
  const { createSqliteConversationRepository } = require('../src/modules/conversations')
  const { projectSettingsProviderReferences } = require('../src/modules/settings')
  const fixture = require('./connection-references-fixture.ts').createConnectionReferencesFixture()
  const conversations = createSqliteConversationRepository({ get: async () => database })
  for (const conversation of fixture.conversations) await conversations.save(conversation)
  const reports = {}
  for (const scope of [...fixture.providers.map(provider => provider.id), 'all']) {
    const ids = scope === 'all' ? fixture.providers.map(provider => provider.id) : [scope]
    const saved = await conversations.readProviderReferences({ providerIds: ids })
    const references = [...saved.references, ...projectSettingsProviderReferences(fixture.settings, ids)]
    const counts = Object.fromEntries(Object.keys(fixture.expected[scope]).map(kind => [kind, references.filter(item => item.kind === kind).length]))
    assert.deepEqual(counts, fixture.expected[scope])
    assert.equal(saved.inspected, 81); assert.equal(saved.remaining, 0); assert.equal(saved.unreadable, 0)
    reports[scope] = { counts, inspected: saved.inspected, olderBackupFound: saved.references.some(reference => reference.id === 'scene-history-080') }
  }
  const historicalMessageBytes = native.prepare('SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal').all()
  assert.equal(native.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(), [])
  native.close()
  const manifest = { ...fixture, database: path.basename(file),
    databaseSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    historicalMessageBytes, reports, integrity: 'ok' }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ database: file, conversations: fixture.conversations.length, reports, integrity: manifest.integrity }))
}
main().catch(error => { try { native.close() } catch {} console.error(error); process.exitCode = 1 })
