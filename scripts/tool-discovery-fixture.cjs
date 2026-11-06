const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const crypto = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const output = path.resolve(process.argv[2] || '')
assert(output.startsWith(root + path.sep) && !fs.existsSync(output), 'Use a fresh workspace evidence directory')
fs.mkdirSync(output, { recursive: true })
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...args) {
  if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2))
  return resolve.call(this, request, parent, ...args)
}
require.extensions['.ts'] = (module, file) => module._compile(transformTypeScriptModule(fs.readFileSync(file, 'utf8'), file), file)
const file = path.join(output, 'tool-discovery.sqlite')
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
const provider = { get: async () => database }
async function main() {
  const { createSqliteAssistantRunPersistence } = require('../src/modules/assistant-runtime')
  const { createSqliteConversationRepository } = require('../src/modules/conversations')
  const { runToolDiscoveryFixture } = require('./tool-discovery-fixture.ts')
  const persistence = createSqliteAssistantRunPersistence(provider)
  const conversations = createSqliteConversationRepository(provider)
  const runs = []
  for (const protocol of ['native', 'tagged']) {
    const result = await runToolDiscoveryFixture(persistence, {
      protocol, runId: `tool-discovery-${protocol}`, conversationId: `tool-discovery-${protocol}`,
    })
    await conversations.save(result.conversation)
    assert.equal(result.activityCount, 2)
    assert.equal(result.journalReceiptCount, 2)
    assert(result.declarationSavingCharacters > 0)
    runs.push(result)
  }
  assert.equal(native.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  native.close()
  const manifest = { schema: 'islemind.tool-discovery-web-fixture.v1', synthetic: true, externalServicesUsed: false,
    database: path.basename(file), databaseSha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    providers: [runs[0].provider], runs }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify({ protocols: runs.map(run => run.protocol), receipts: runs.map(run => run.journalReceiptCount),
    characterSaving: runs.map(run => run.declarationSavingCharacters), database: file }))
}
main().catch(error => { try { native.close() } catch {} console.error(error); process.exitCode = 1 })
