#!/usr/bin/env node
// Real application + patched Expo worker/OPFS qualification, not a storage mock.
// The Metro module registry is used only by this host script, never by app code.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback
const url = new URL(option('--url', 'http://127.0.0.1:18110'))
const out = option('--out') && path.resolve(option('--out'))
const executablePath = option('--browser')
const idleMs = Number(option('--idle-ms', '1800000'))
assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Use a local current-tree Metro application')
assert(out && executablePath && path.isAbsolute(executablePath), 'Explicit --out and resolved --browser are required')
assert(Number.isSafeInteger(idleMs) && idleMs >= 0, 'Invalid --idle-ms')
assert(!fs.existsSync(out), 'Use a new evidence directory; never overwrite a prior browser profile')
fs.mkdirSync(out, { recursive: true })
const report = { schema: 'islemind.web-storage-qualification.v1', url: url.href, executablePath,
  profile: path.join(out, 'profile'), idleMs, startedAt: new Date().toISOString(), checks: [], errors: [] }
let context, page
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2))
const pass = (name, detail) => { report.checks.push({ name, detail, at: new Date().toISOString() }); save() }
async function launch() {
  context = await chromium.launchPersistentContext(report.profile, { executablePath, headless: true, viewport: { width: 430, height: 932 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === url.origin ? route.continue() : route.abort())
  page = context.pages()[0] || await context.newPage()
  page.on('pageerror', pageError)
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await ready(page)
}
async function ready(target) {
  await target.waitForFunction(() => document.querySelector('textarea') && !document.body.innerText.includes('BOOT-'), null, { timeout: 90000 })
}
function pageError(error) { report.errors.push(String(error)) }
async function application(operation) {
  return page.evaluate(async operation => {
    const mod = name => {
      const found = [...__r.getModules()].find(([, module]) => module.verboseName === name)
      if (!found) throw new Error(`Real application module not found: ${name}`)
      return __r(found[0])
    }
    const conversation = mod('src/bootstrap/conversationPersistence.ts').conversationPersistence
    const lifecycle = mod('src/bootstrap/providerRemoteCompactLifecycle.ts').providerRemoteCompactLifecycle
    const db = await mod('src/platform/storage/expoSqliteDatabase.ts').createExpoSqliteDatabaseProvider().get()
    const input = { conversationId: 'web-storage-qualification', providerId: 'qualification-provider', model: 'namespace/model',
      settings: { remoteCompactMode: 'auto', runtimeLogEnabled: true }, strategy: 'native-openai-responses',
      capabilityKind: 'native-compaction', remoteClassification: 'remote-available' }
    const completed = { ...input, mode: 'auto', responseId: 'qualification-response', messageCount: 1,
      contextFragments: [{ id: 'fragment', sourceId: 'source', sourceHash: 'hash', included: true }] }
    if (operation === 'seed') {
      const now = Date.now()
      await conversation.save({ id: input.conversationId, title: 'Web durable qualification', providerId: null, model: null,
        systemPrompt: '', temperature: 0.7, maxTokens: 100, createdAt: now, updatedAt: now,
        messages: [{ id: 'qualification-message', role: 'assistant', content: 'Acknowledged 繁體 日本語 😀 e\u0301', status: 'cancelled', timestamp: now }] })
      await lifecycle.recordCompleted(completed)
    }
    if (operation === 'corrupt') await db.run('UPDATE compact_states SET compactItemJson=? WHERE conversationId=?', ['{invalid', input.conversationId])
    if (operation === 'repair') await lifecycle.recordCompleted(completed)
    if (operation === 'write-failure') {
      // The repository owns another connection; target only this fixture.
      await db.exec("CREATE TRIGGER reject_qualification_compact_write BEFORE INSERT ON compact_states WHEN NEW.conversationId='web-storage-qualification' BEGIN SELECT RAISE(ABORT, 'qualification write failure'); END")
      try { await lifecycle.recordCompleted({ ...completed, responseId: 'unacknowledged' }) }
      finally { await db.exec('DROP TRIGGER reject_qualification_compact_write;') }
    }
    return { conversation: await conversation.loadRecord(input.conversationId), compact: await lifecycle.resolvePreviousState(input),
      sqlite: await db.getFirst('SELECT sqlite_version() AS version'), journal: await db.getFirst('PRAGMA journal_mode'),
      synchronous: await db.getFirst('PRAGMA synchronous'), integrity: await db.getAll('PRAGMA integrity_check'),
      isolation: crossOriginIsolated, timeOrigin: performance.timeOrigin }
  }, operation)
}
async function files() {
  return page.evaluate(async () => {
    const result = []
    async function walk(directory, prefix = '') {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'directory') await walk(handle, `${prefix}${name}/`)
        else {
          const bytes = await (await handle.getFile()).arrayBuffer()
          result.push({ path: prefix + name, size: bytes.byteLength,
            sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('') })
        }
      }
    }
    await walk(await navigator.storage.getDirectory())
    return result.sort((a, b) => a.path.localeCompare(b.path))
  })
}
function same(expected, actual) {
  assert.deepEqual(actual.conversation, expected.conversation, 'Acknowledged conversation changed')
  assert.deepEqual(actual.compact, expected.compact, 'Acknowledged continuation changed')
  assert.deepEqual(actual.integrity, [{ integrity_check: 'ok' }])
}
async function main() {
  await launch()
  const baseline = await application('seed')
  assert.equal(baseline.compact.previousResponseId, 'qualification-response')
  pass('acknowledged-app-writes', baseline)
  const before = await files()
  await new Promise(resolve => setTimeout(resolve, idleMs))
  const after = await files() // Observe filesystem before SQL can recreate anything.
  assert.deepEqual(after, before, 'Raw OPFS files changed during idle')
  same(baseline, await application('read'))
  pass('idle-raw-opfs-and-rows', { before, after, elapsedMs: idleMs })
  await page.reload(); await ready(page)
  same(baseline, await application('read')); pass('reload')
  await context.close(); await launch()
  same(baseline, await application('read')); pass('browser-exit-and-persistent-profile-reopen')
  const cdp = await context.newCDPSession(page)
  const crashed = page.waitForEvent('crash', { timeout: 30000 })
  // Chromium does not necessarily reply to the crashing command. Wait for the
  // actual target event instead of hanging on its protocol response.
  void cdp.send('Page.crash').catch(() => {})
  await crashed
  await page.close()
  page = await context.newPage()
  page.on('pageerror', pageError)
  await page.goto(url.href); await ready(page)
  same(baseline, await application('read')); pass('renderer-crash-and-recovery')
  const contender = await context.newPage()
  contender.on('pageerror', pageError)
  await contender.goto(url.href, { waitUntil: 'domcontentloaded' })
  await contender.waitForFunction(() => document.body.innerText.includes('BOOT-'), null, { timeout: 60000 })
  pass('second-tab-fails-closed', await contender.locator('body').innerText())
  await page.close(); page = contender
  // Page close precedes asynchronous Chromium worker/OPFS handle release.
  await new Promise(resolve => setTimeout(resolve, 1000))
  await page.getByRole('button', { name: /^(Retry|重试|再試行)$/ }).click()
  await ready(page)
  same(baseline, await application('read')); pass('retry-after-exclusive-owner-closes')
  assert.deepEqual((await application('corrupt')).compact, {})
  pass('corruption-safe-fallback')
  same(baseline, await application('repair'))
  same(baseline, await application('write-failure')); pass('failed-write-preserves-acknowledged-state')
  await page.reload(); await ready(page)
  same(baseline, await application('read')); pass('repaired-state-persists-after-reload')
  await page.screenshot({ path: path.join(out, 'app.png'), fullPage: true })
  assert.deepEqual(report.errors, [], 'Unexpected application page errors')
  report.completedAt = new Date().toISOString()
  report.passed = true
}
main().catch(async error => {
  report.passed = false; report.failure = String(error); process.exitCode = 1
  report.failurePage = await page?.locator('body').innerText().catch(() => undefined)
})
  .finally(async () => { save(); await context?.close(); console.log(JSON.stringify(report, null, 2)) })
