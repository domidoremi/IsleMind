const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(__dirname, '..', 'src', request.slice(2)) : request, parent, isMain, options)
}
require.extensions['.ts'] = (module, filename) => module._compile(transformTypeScriptModule(fs.readFileSync(filename, 'utf8'), filename), filename)
const { createHttpContentReporting } = require('../src/modules/conversations/adapters/httpContentReporting.ts')
const { bindExecutionTimerMirror } = require('../src/core/executionTimers.ts')

// Synthetic destination is never contacted. The test-only fetch adapter maps it
// to loopback; the production HTTPS validator is not disabled or parameterized.
const configuration = { endpoint: 'https://reports.islemind.org/v1/reports', operator: 'Synthetic test operator', privacyPolicyUrl: 'https://reports.islemind.org/privacy' }
const reportId = '12345678-1234-4567-89ab-123456789abc'
const draft = { excerpt: 'Synthetic answer', reason: 'other', note: 'Synthetic note' }
const inputs = { configuration, appVersion: '1.1.2', randomUUID: () => reportId }
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
const signal = () => new AbortController().signal

async function run() {
  let redirected = 0
  const receipts = []
  const destination = http.createServer((_req, res) => { redirected++; res.end('unexpected') })
  let target
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    receipts.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
    if (/^\/redirect\//.test(req.url)) { res.writeHead(Number(req.url.split('/')[2]), { Location: target }); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.url === '/pending') { res.write('{'); return }
    if (req.url === '/oversized') return res.end(' '.repeat(4097))
    if (req.url === '/wrong-id') return res.end(JSON.stringify({ reportId: 'wrong', status: 'received' }))
    if (req.url === '/not-received') return res.end(JSON.stringify({ reportId, status: 'reviewed' }))
    if (req.url === '/invalid-json') return res.end('<html>private server diagnostic</html>')
    res.end(JSON.stringify({ reportId, status: 'received' }))
  })
  let mirrorCallback
  const unbind = bindExecutionTimerMirror({ schedule(callback, ms) {
    assert.equal(ms, 15000)
    mirrorCallback = callback
    return () => { if (mirrorCallback === callback) mirrorCallback = undefined }
  } })
  try {
    target = await listen(destination)
    const origin = await listen(server)
    const requests = []
    const client = (route, onHeaders) => createHttpContentReporting({ ...inputs, fetch: async (url, init) => {
      assert.equal(url, configuration.endpoint)
      requests.push(init)
      const response = await fetch(`${origin}${route}`, init)
      onHeaders?.()
      Object.defineProperty(response, 'url', { value: url })
      return response
    } })
    const success = client('/success')
    const report = success.prepare({ ...draft, history: 'must not be sent' })
    assert.equal(requests.length, 0, 'opening/reviewing cannot send')
    await success.submit(report, signal())
    await success.submit(report, signal())
    assert.equal(receipts[0].body, receipts[1].body, 'manual retry retains exact body and id')
    assert.deepEqual(JSON.parse(receipts[0].body), { schemaVersion: 1, reportId, appVersion: '1.1.2', ...draft })
    assert.equal(receipts[0].headers['idempotency-key'], reportId)
    assert.equal(receipts[0].headers.authorization, undefined)
    assert.equal(receipts[0].headers.cookie, undefined)
    for (const request of requests) {
      assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error')
      assert.equal(request.referrerPolicy, 'no-referrer'); assert.equal(request.cache, 'no-store')
    }
    for (const code of [301, 302, 303, 307, 308]) await assert.rejects(client(`/redirect/${code}`).submit(report, signal()), { code: 'failed' })
    assert.equal(redirected, 0, 'redirected hosts never receive a report')
    for (const route of ['/oversized', '/wrong-id', '/not-received', '/invalid-json']) {
      await assert.rejects(client(route).submit(report, signal()), error => error.code === 'failed' && error.message === 'failed')
    }
    const caller = new AbortController()
    await assert.rejects(client('/pending', () => caller.abort()).submit(report, caller.signal), { code: 'cancelled' })
    // Actual loopback headers/body remain pending; the real mirrored deadline path
    // aborts the transport, not just a UI timeout. No 15-second sleep in this test.
    await assert.rejects(client('/pending', () => mirrorCallback()).submit(report, signal()), { code: 'timeout' })
    assert.equal(mirrorCallback, undefined)
    let calls = 0
    const disabled = createHttpContentReporting({ ...inputs, configuration: null, fetch: async () => { calls++; throw Error('must not run') } })
    assert.throws(() => disabled.prepare(draft), { code: 'unavailable' })
    await assert.rejects(disabled.submit(report, signal()), { code: 'unavailable' })
    const aborted = new AbortController(); aborted.abort()
    const noNetwork = createHttpContentReporting({ ...inputs, fetch: async () => { calls++; throw Error('must not run') } })
    await assert.rejects(noNetwork.submit(report, aborted.signal), { code: 'cancelled' })
    await assert.rejects(noNetwork.submit({ ...report, credentials: 'must not send' }, signal()), { code: 'invalid' })
    assert.equal(calls, 0)
    // Even an uncooperative transport cannot strand the UI or leak its exception.
    const stalled = createHttpContentReporting({ ...inputs, fetch: () => new Promise(() => {}) })
    const pending = stalled.submit(report, signal()); mirrorCallback()
    await assert.rejects(pending, { code: 'timeout' })
    console.log('Content reporting transport passed: explicit minimal payload, stable retries, redirect isolation, acknowledgement bounds, cancellation, deadlines and disabled admission (synthetic loopback only).')
  } finally { unbind(); await Promise.all([close(server), close(destination)]) }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
