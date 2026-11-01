const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { DatabaseSync } = require('node:sqlite')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const output = path.resolve(process.argv[2] ?? '')
if (!output.startsWith(root + path.sep)) throw new Error('Use a workspace evidence directory')
fs.mkdirSync(output, { recursive: true })
const filename = path.join(output, 'working-states.sqlite')
if (fs.existsSync(filename)) throw new Error('Preserve the existing fixture; use a fresh output directory')

const resolve = Module._resolveFilename
Module._resolveFilename = function resolveFixtureModule(request, parent, ...args) {
  if (request === '@/platform/storage') request = path.join(root, 'src/platform/storage/expoSqliteDatabase.ts')
  else if (request.startsWith('@/')) request = path.join(root, 'src', request.slice(2))
  return resolve.call(this, request, parent, ...args)
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
    try {
      const result = await work(executor)
      native.exec('COMMIT')
      return result
    } catch (error) {
      native.exec('ROLLBACK')
      throw error
    }
  },
}
const provider = { get: async () => database }
const providers = [
  { id: 'fixture-writing', type: 'openai-compatible', name: 'Writing desk', baseUrl: 'https://writing.invalid/v1', models: ['local-writing-instruct', 'review/long-context-editorial-instruct-2026-10-31'], apiKey: '', enabled: true },
  { id: 'fixture-research', type: 'openai-compatible', name: 'Research and reference connection', baseUrl: 'https://reference.invalid/a-long-workspace-name/openai-compatible/v1', models: ['reference/long-context-instruct-2026-10-31'], apiKey: '', enabled: true },
  { id: 'fixture-offline', type: 'openai-compatible', name: 'Offline archive', baseUrl: 'https://archive.invalid/v1', models: [], apiKey: '', enabled: false },
]
const titles = [
  'A small idea, ready for its next draft',
  'A longer working note: decisions, loose ends, and references for the next review',
  'AnUnbrokenTitleThatMustNeverPushTheDocumentListOutsideANarrowViewport',
  '\u672c\u5730\u5199\u4f5c\u7b14\u8bb0\uff1a\u4ece\u804a\u5929\u4e2d\u4fdd\u7559\u7684\u4e00\u4e2a\u60f3\u6cd5',
]

async function main() {
  const { createSqliteDocumentRepository } = require('../src/modules/documents/adapters/sqliteDocumentRepository.ts')
  const { createSqliteUsageRecordRepository } = require('../src/modules/diagnostics/adapters/sqliteUsageRecordRepository.ts')
  const now = Date.now()
  let sequence = 0
  let time = now
  const documents = createSqliteDocumentRepository({ databaseProvider: provider, createId: () => `fixture-document-${++sequence}`, now: () => time })
  for (const [index, title] of titles.entries()) {
    time = now - index * 3600000
    await documents.create({ title, body: 'A disposable UI fixture. No model, credential, or external service is used.' })
  }
  const usage = createSqliteUsageRecordRepository(provider)
  const records = ['success', 'success', 'failed', 'cancelled', 'limited', 'partial'].map((status, index) => ({
    schema: 'islemind.usage-record.v1',
    id: `fixture-request-${index + 1}`,
    occurredAt: now - index * 3600000,
    completedAt: now - index * 3600000 + 1600 + index * 340,
    providerId: providers[index % 2].id,
    providerType: 'openai-compatible',
    providerName: providers[index % 2].name,
    requestedModel: index === 1 ? 'review/long-context-editorial-instruct-2026-10-31' : providers[index % 2].models[0],
    upstreamModel: index === 1 ? 'review/long-context-editorial-instruct-2026-10-31' : providers[index % 2].models[0],
    operationSource: index === 1 ? 'knowledge' : 'chat',
    dataSource: index === 5 ? 'estimated' : 'live-provider',
    measurementSource: index === 5 ? 'estimated' : index < 2 ? 'provider' : 'unavailable',
    status,
    ...(status === 'failed' ? { statusCode: 503, errorCode: 'upstream_error' } : {}),
    durationMs: 1600 + index * 340,
    firstTokenMs: 380 + index * 70,
    attempt: 1,
    attemptReason: 'initial',
    tokens: index < 2 || index === 5 ? { inputTokens: 3200 + index * 290, outputTokens: 640 + index * 40, totalTokens: 3840 + index * 330 } : {},
    ...(index < 2 ? { totalCostNanodollars: 14500000 + index * 5000000 } : {}),
    costProvenance: index < 2 ? 'supplier-known' : 'unavailable',
  }))
  for (const record of records) assert.equal(await usage.append(record), true)
  assert.equal((await documents.list()).length, titles.length)
  const requestCount = (await usage.list()).total
  assert.equal(requestCount, records.length - 1)
  assert.equal((await usage.list({ filter: { includeEstimated: true } })).total, records.length)
  native.exec('PRAGMA journal_mode = DELETE')
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
    synthetic: true, externalServicesUsed: false, credentials: false, createdAt: now,
    providers, documentTitles: titles, documentCount: titles.length, requestCount, requestsWithEstimates: records.length,
  }, null, 2) + '\n')
  console.log(JSON.stringify({ documents: titles.length, usageRecords: records.length, providers: providers.length, output }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(() => native.close())
