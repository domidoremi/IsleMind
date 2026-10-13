const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const http = require('node:http')
const { DatabaseSync } = require('node:sqlite')
const { createService, configuration } = require('../services/content-reporting/server.cjs')
const { openStore, validateReport } = require('../services/content-reporting/store.cjs')

const report = (overrides = {}) => ({ schemaVersion: 1, reportId: randomUUID(), appVersion: '1.1.2',
  reason: 'other', excerpt: 'Synthetic answer only', note: 'Synthetic note', ...overrides })
async function fixture(t, overrides = {}, dependencies = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'islemind-reports-'))
  const config = { ...configuration({}), filename: path.join(directory, 'reports.sqlite'), ...overrides }
  const { server, store } = createService(config, dependencies)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const close = () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  t.after(async () => { if (server.listening) await close(); rmSync(directory, { recursive: true, force: true }) })
  const send = (body, headers = {}, route = '/v1/reports') => fetch(`${url}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': body.reportId || '', ...headers }, body: JSON.stringify(body),
  })
  return { store, config, url, close, send }
}
test('durable receipt, canonical retries, conflict, and concurrent duplicate admission', async t => {
  const f = await fixture(t)
  const value = report()
  const first = await f.send(value)
  assert.equal(first.status, 201)
  assert.equal(first.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await first.json(), { reportId: value.reportId, status: 'received' })
  const reversed = Object.fromEntries(Object.entries(value).reverse())
  assert.equal((await f.send(reversed)).status, 200)
  assert.equal((await f.send({ ...value, note: 'Changed' })).status, 409)
  const second = report()
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => f.send(second)))
  assert.equal(duplicates.filter(r => r.status === 201).length, 1)
  assert.equal(duplicates.filter(r => r.status === 200).length, 7)
  await f.close()
  const reopened = openStore(f.config.filename)
  try {
    assert.equal(reopened.list().length, 2)
    assert.deepEqual(reopened.show(value.reportId).body, value)
    assert.equal(reopened.receive(validateReport(value, value.reportId)), false)
  } finally { reopened.close() }
})
test('strict schema, UTF-16 bounds, malformed encoding and media reject before storage', async t => {
  const f = await fixture(t)
  const value = report()
  for (const mutation of [{ ...value, history: 'not permitted' }, { ...value, schemaVersion: 2 }, { ...value, excerpt: ' ' },
    { ...value, excerpt: 'a'.repeat(4001) }, { ...value, note: '😀'.repeat(501) }, { ...value, reason: 'unknown' },
    { ...value, appVersion: 'invalid' }, { ...value, note: '\ud800' }, { ...value, reportId: 'not-uuid' }]) {
    assert.equal((await f.send(mutation)).status, 400)
  }
  assert.equal((await f.send(value, { 'Idempotency-Key': randomUUID() })).status, 400)
  assert.equal((await f.send(value, { 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await f.send(value, { 'Content-Encoding': 'gzip' })).status, 415)
  for (const headers of [{ Authorization: 'Synthetic credential' }, { Cookie: 'synthetic=1' }]) assert.equal((await f.send(value, headers)).status, 400)
  const malformed = await fetch(`${f.url}/v1/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: Buffer.from([0xff]) })
  assert.equal(malformed.status, 400)
  assert.equal(f.store.list().length, 0)
})
test('bounded body rejects declared and streaming oversized requests', async t => {
  const f = await fixture(t)
  assert.equal((await f.send(report({ excerpt: 'a'.repeat(33_000) }))).status, 413)
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${f.url}/v1/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, res => {
      res.resume(); resolve(res.statusCode)
    })
    req.on('error', reject); req.write(' '.repeat(17_000)); req.end(' '.repeat(17_000))
  })
  assert.equal(status, 413)
  assert.equal(f.store.list().length, 0)
})
test('partial request has a real deadline and never becomes a received report', { timeout: 8000 }, async t => {
  const f = await fixture(t)
  const started = Date.now()
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${f.url}/v1/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      res.resume(); resolve(res.statusCode); req.destroy()
    })
    req.on('error', reject); req.write('{')
  })
  assert.equal(status, 408)
  assert.ok(Date.now() - started >= 4500, 'actually waits for the body deadline')
  assert.equal(f.store.list().length, 0)
})
test('native requests work without Origin; browser CORS allowlist and no HTTP management', async t => {
  const origin = 'https://app.islemind.org'
  const f = await fixture(t, { origins: [origin] })
  assert.equal((await f.send(report())).status, 201)
  assert.equal((await f.send(report(), { Origin: 'https://untrusted.invalid' })).status, 403)
  assert.equal((await f.send(report(), { Origin: 'null' })).status, 403)
  const allowed = await f.send(report(), { Origin: origin })
  assert.equal(allowed.status, 201); assert.equal(allowed.headers.get('access-control-allow-origin'), origin)
  assert.equal(allowed.headers.get('access-control-allow-credentials'), null)
  const preflight = await fetch(`${f.url}/v1/reports`, { method: 'OPTIONS', headers: { Origin: origin,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,idempotency-key' } })
  assert.equal(preflight.status, 204)
  for (const route of ['/admin', '/v1/reports/123', '/v1/reports?query=1', '/privacy']) assert.equal((await fetch(f.url + route)).status, 404)
  assert.equal((await fetch(f.url + '/v1/reports')).status, 405)
  assert.equal((await fetch(f.url + '/healthz')).status, 200)
})
test('admission quota persists across restart; retries do not consume it', async t => {
  let time = 1000
  const f = await fixture(t, { maxSubmissionsPerHour: 1 }, { now: () => time })
  const value = report()
  assert.equal((await f.send(value)).status, 201)
  assert.equal((await f.send(value)).status, 200)
  assert.equal((await f.send(report())).status, 429)
  await f.close()
  const reopened = openStore(f.config.filename, { maxSubmissionsPerHour: 1, now: () => time })
  try {
    assert.throws(() => reopened.receive(report()), { status: 429 })
    time += 3_600_000
    assert.equal(reopened.receive(report()), true)
  } finally { reopened.close() }
})
test('global throttle cannot be bypassed with forged proxy/IP headers', async t => {
  let time = 1000
  const f = await fixture(t, { requestsPerMinute: 1 }, { now: () => time })
  assert.equal((await f.send(report())).status, 201)
  assert.equal((await f.send(report(), { 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '5.6.7.8' })).status, 429)
  time += 60_000
  assert.equal((await f.send(report())).status, 201)
})
test('capacity and failed writes never acknowledge or leak diagnostics', async t => {
  const events = []
  const f = await fixture(t, { maxReports: 1 }, { onEvent: value => events.push(value) })
  const first = report()
  assert.equal((await f.send(first)).status, 201)
  assert.equal((await f.send(report())).status, 503)
  assert.equal((await f.send(first)).status, 200)
  assert.deepEqual(events, ['storage_unavailable'])
  const second = await fixture(t, {}, { onEvent: value => events.push(value) })
  const connection = new DatabaseSync(second.config.filename)
  connection.exec("CREATE TRIGGER fail_write BEFORE INSERT ON reports BEGIN SELECT RAISE(FAIL, 'synthetic_private_detail'); END")
  connection.close()
  const failed = await second.send(report())
  assert.equal(failed.status, 503)
  assert.deepEqual(await failed.json(), { error: 'temporarily_unavailable' })
  assert.equal(second.store.list().length, 0)
})
test('local review persists and purge cannot be undone by a late retry', async t => {
  const f = await fixture(t)
  const value = report()
  await f.send(value)
  f.store.review(value.reportId, 'action_required', 'Synthetic triage decision')
  assert.equal(f.store.list('received').length, 0)
  assert.equal(f.store.list('action_required').length, 1)
  assert.equal(f.store.show(value.reportId).review_note, 'Synthetic triage decision')
  assert.throws(() => f.store.review(value.reportId, 'received', ''), { status: 400 })
  f.store.purge(value.reportId)
  const removed = f.store.show(value.reportId)
  assert.equal(removed.body, null); assert.equal(removed.review_note, null); assert.equal(removed.reason, null)
  assert.equal((await f.send(value)).status, 410)
  assert.throws(() => f.store.review(value.reportId, 'no_action', 'late'), { status: 404 })
})
test('production application adapter submits to the real service through synthetic loopback mapping', async t => {
  const Module = require('node:module')
  const { transformTypeScriptModule } = require('./node-ts-support')
  const resolve = Module._resolveFilename, extension = require.extensions['.ts']
  Module._resolveFilename = function (request, parent, isMain, options) {
    return resolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', 'src', request.slice(2)) : request, parent, isMain, options)
  }
  require.extensions['.ts'] = (module, filename) => module._compile(transformTypeScriptModule(readFileSync(filename, 'utf8'), filename), filename)
  try {
    const { createHttpContentReporting } = require('../src/modules/conversations/adapters/httpContentReporting.ts')
    const f = await fixture(t)
    const client = createHttpContentReporting({
      configuration: { endpoint: 'https://reports.islemind.org/v1/reports', operator: 'Synthetic test operator', privacyPolicyUrl: 'https://reports.islemind.org/privacy' },
      appVersion: '1.1.2', randomUUID,
      fetch: async (url, init) => {
        const response = await fetch(f.url + '/v1/reports', init)
        Object.defineProperty(response, 'url', { value: url }); return response
      },
    })
    const value = client.prepare({ excerpt: 'Synthetic visible answer', note: '', reason: 'privacy' })
    await client.submit(value, new AbortController().signal)
    await client.submit(value, new AbortController().signal)
    assert.equal(f.store.list().length, 1)
    assert.deepEqual(f.store.show(value.reportId).body, value)
  } finally { Module._resolveFilename = resolve; if (extension) require.extensions['.ts'] = extension; else delete require.extensions['.ts'] }
})
test('unsafe configuration fails closed', () => {
  for (const env of [{ PORT: 'NaN' }, { REPORT_MAX_RECORDS: '0' }, { REPORT_WEB_ORIGINS: '*' },
    { REPORT_WEB_ORIGINS: 'http://app.islemind.org' }, { REPORT_WEB_ORIGINS: 'https://app.islemind.org/path' }]) assert.throws(() => configuration(env))
  assert.throws(() => openStore('reports.sqlite'), /absolute/)
})
