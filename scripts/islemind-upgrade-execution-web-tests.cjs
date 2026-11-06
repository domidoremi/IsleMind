const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const worklist = require('./fixtures/worklists/complete-ui-experience-worklist.json')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const webRoot = path.resolve(root, option('--web-root', 'test-evidence/qa/islemind-upgrade-20261106/web-pass-f'))
const fixtureRoot = path.resolve(root, option('--fixtures', 'test-evidence/qa/islemind-upgrade-20261106/execution-fixture'))
const output = path.resolve(root, option('--output', `test-evidence/qa/islemind-upgrade-20261106/executions-${Date.now()}`))
for (const target of [webRoot, fixtureRoot, output]) assert.ok(target.startsWith(root + path.sep), 'Use workspace exports and disposable evidence')
assert.ok(!fs.existsSync(output), 'Preserve prior evidence; use a fresh output directory')
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
assert.ok(fixture.synthetic && !fixture.externalServicesUsed && fixture.execution, 'Use explicit synthetic execution receipts')
const execution = fixture.execution
const worker = fs.readdirSync(path.join(webRoot, '_expo/static/js/web')).find(file => /^worker-.*\.js$/.test(file))
assert.ok(worker, 'Use the real exported Expo SQLite worker')
fs.mkdirSync(output, { recursive: true })
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname) } catch { response.writeHead(400).end(); return }
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  if (pathname === '/_qa/seed') {
    response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Isolated execution receipts</title>')
    return
  }
  let file = pathname === '/_qa/execution.sqlite' ? path.join(fixtureRoot, 'working-states.sqlite') : path.resolve(webRoot, '.' + pathname)
  if (pathname !== '/_qa/execution.sqlite' && file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) { response.writeHead(404).end(); return }
    file = path.join(webRoot, 'index.html')
  }
  response.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable' })
  fs.createReadStream(file).pipe(response)
})
const results = { syntheticData: true, isolatedBrowserData: true, liveProviderRequests: 0, osClipboardWritten: false, nativeAcceptance: false,
  webRoot, pages: [], errors: [], blockedExternalHosts: [] }
let stage = 'startup'

async function seed(page, origin, family, mode) {
  await page.goto(origin + '/_qa/seed')
  await page.evaluate(async ({ worker, fixture, family, mode }) => {
    const bytes = new Uint8Array(await (await fetch('/_qa/execution.sqlite')).arrayBuffer())
    const dbWorker = new Worker(`/_expo/static/js/web/${worker}`)
    let sequence = 0
    const pending = new Map()
    dbWorker.onmessage = ({ data }) => {
      const operation = pending.get(data.id)
      if (!operation) return
      pending.delete(data.id); clearTimeout(operation.timer)
      if (data.error) operation.reject(new Error(data.error.message ?? String(data.error)))
      else operation.resolve(data.result)
    }
    dbWorker.onerror = event => {
      for (const operation of pending.values()) { clearTimeout(operation.timer); operation.reject(new Error(event.message)) }
      pending.clear()
    }
    const invoke = (type, data) => new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture worker timed out: ${type}`)) }, 15000)
      pending.set(id, { resolve, reject, timer })
      dbWorker.postMessage({ id, isSync: false, type, data })
    })
    try {
      await invoke('open', { nativeDatabaseId: 1, databasePath: ':memory:', options: {}, serializedData: bytes })
      await invoke('open', { nativeDatabaseId: 2, databasePath: './islemind-context.db', options: { useNewConnection: true } })
      await invoke('backupDatabase', { destNativeDatabaseId: 2, destDatabaseName: 'main', sourceNativeDatabaseId: 1, sourceDatabaseName: 'main' })
      await invoke('close', { nativeDatabaseId: 1 })
      await invoke('close', { nativeDatabaseId: 2 })
    } finally { dbWorker.terminate() }
    localStorage.setItem('@islemind/settings', JSON.stringify({ themeId: family, theme: mode, language: 'zh-CN',
      defaultProvider: fixture.providers[0].id, autoUpdateCheckEnabled: false, autoCheckApkUpdate: false, backgroundMotion: 'static' }))
    localStorage.setItem('@islemind/providers', JSON.stringify(fixture.providers))
    localStorage.setItem('@islemind/language-source', JSON.stringify('user'))
  }, { worker, fixture, family, mode })
}

async function snapshot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  assert.equal(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2), false, 'No horizontal page overflow')
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true })
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true })
  try {
    const families = args.includes('--probe') ? ['minimal'] : worklist.families
    const modes = args.includes('--probe') ? ['light'] : worklist.modes
    for (const family of families) for (const mode of modes) {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 }, colorScheme: mode, reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.setDefaultTimeout(20000)
      page.on('pageerror', error => results.errors.push({ stage, message: error.message }))
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
        results.blockedExternalHosts.push(url.hostname)
        return route.abort()
      })
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__upgradeCopied = text } } })
        const original = document.execCommand.bind(document)
        document.execCommand = (command, ...parameters) => /^(copy|cut|paste)$/i.test(command) ? false : original(command, ...parameters)
      })
      try {
        stage = `${family}/${mode}/seed`
        await seed(page, origin, family, mode)
        stage = `${family}/${mode}/filtered request`
        await page.goto(`${origin}/settings/usage?view=requests&range=all&providerId=${execution.backupProviderId}`, { waitUntil: 'domcontentloaded' })
        await page.getByTestId(`usage-request-request:${execution.requestId}`).click()
        const detail = page.locator('[data-testid="usage-execution-detail"]:visible')
        await detail.waitFor()
        assert.equal(new URL(page.url()).pathname, '/request/' + execution.requestId)
        assert.equal(new URL(page.url()).searchParams.get('kind'), 'request')
        assert.equal(await detail.getByTestId('usage-detail-value-reported-model').textContent(), execution.reportedModel)
        assert.equal(await detail.getByTestId('usage-detail-value-upstream').textContent(), zh.usage.executionNotReported)
        await page.getByText(zh.routing.receipt.replace('{{name}}', execution.planName), { exact: true }).waitFor()
        assert.equal(await detail.locator('button[data-testid^="usage-attempt-"]').count(), 2, 'Full request details keep the primary attempt outside the provider filter')
        const primary = detail.getByTestId('usage-attempt-1').locator('..')
        const backup = detail.getByTestId('usage-attempt-2').locator('..')
        await detail.getByTestId('usage-attempt-1').click()
        assert.equal(await primary.getByTestId('usage-detail-value-error').textContent(), 'upstream_error')
        assert.equal(await primary.getByTestId('usage-detail-value-total').textContent(), '—')
        assert.equal(await primary.getByTestId('usage-detail-value-reported-model').textContent(), zh.usage.executionNotReported)
        await detail.getByTestId('usage-attempt-2').click()
        assert.equal(await backup.getByTestId('usage-detail-value-reported-model').textContent(), execution.reportedModel)
        assert.equal(await backup.getByTestId('usage-detail-value-model').textContent(), execution.backupModel)
        await snapshot(page, `${family}-${mode}-request-attempts`)
        await detail.getByRole('button', { name: zh.usage.copyRedactedSummary, exact: true }).click()
        await page.waitForFunction(() => typeof globalThis.__upgradeCopied === 'string')
        const copied = await page.evaluate(() => globalThis.__upgradeCopied)
        assert.ok(copied.includes(execution.primaryModel) && copied.includes(execution.backupModel))
        await page.getByRole('button', { name: zh.common.back, exact: true }).click()
        await page.getByTestId(`usage-request-request:${execution.requestId}`).waitFor()
        assert.equal(new URL(page.url()).searchParams.get('providerId'), execution.backupProviderId)
        assert.equal(await page.getByRole('tab', { name: zh.usage.requestLog, exact: true }).getAttribute('aria-selected'), 'true')
        await page.getByTestId(`usage-request-request:${execution.requestId}`).click()
        await detail.getByRole('button', { name: zh.usage.openConnection, exact: true }).click()
        await page.getByRole('tab', { name: zh.apiKeyPanel.workspaceConnection, exact: true }).waitFor()
        const connection = fixture.providers.find(provider => provider.id === execution.backupProviderId)
        assert.equal(await page.getByRole('textbox', { name: zh.providerSettings.name, exact: true }).inputValue(), connection.name)
        assert.equal(await page.getByRole('textbox', { name: zh.providerSettings.baseUrl, exact: true }).inputValue(), connection.baseUrl)
        assert.equal(await page.getByRole('tab', { name: zh.apiKeyPanel.workspaceConnection, exact: true }).getAttribute('aria-selected'), 'true')
        stage = `${family}/${mode}/response and continuation`
        await page.goto(`${origin}/request/${execution.responseId}?kind=response`, { waitUntil: 'domcontentloaded' })
        await detail.waitFor()
        assert.equal(await detail.locator('button[data-testid^="usage-attempt-"]').count(), 3)
        assert.equal(await detail.getByTestId('usage-request-detail').count(), 2, 'One reply groups the original request and its tool continuation')
        await snapshot(page, `${family}-${mode}-response`)
        results.pages.push({ family, mode, filteredRequestHasFullAttempts: true, reportedModelIsSeparate: true, unknownIsPreserved: true,
          backRestoresFilter: true, exactConnection: true, replyContainsContinuation: true, controlledSummaryCopy: true })
      } catch (error) {
        await page.screenshot({ path: path.join(output, `failure-${family}-${mode}.png`), fullPage: true }).catch(() => {})
        throw error
      } finally {
        await context.close()
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
      }
    }
    assert.deepEqual(results.errors, [])
    assert.deepEqual(results.blockedExternalHosts, [])
    console.log(JSON.stringify({ cases: results.pages.length, errors: results.errors.length, externalRequests: results.blockedExternalHosts.length }))
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => {
  results.failure = { stage, message: error.message }
  console.error(error)
  process.exitCode = 1
}).finally(() => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)))
