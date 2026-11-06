const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidence = fs.readFileSync(path.join(root, 'test-evidence/qa/current-ui-working-states-path.txt'), 'utf8').trim()
const prior = fs.readFileSync(path.join(root, 'test-evidence/qa/current-ui-rhythm-feedback-path.txt'), 'utf8').trim()
const baseline = args.includes('--baseline')
const probe = args.includes('--probe')
const refreshProbe = args.includes('--refresh-probe')
const webRoot = path.resolve(option('--web-root', path.join(baseline ? prior : evidence, baseline ? 'web-accepted-v2' : 'web-after')))
const output = path.resolve(option('--output', path.join(evidence, baseline ? 'visual-before' : 'visual-after')))
const fixtureRoot = path.resolve(option('--fixtures', path.join(evidence, 'fixtures-v2')))
for (const target of [webRoot, output, fixtureRoot]) {
  if (!target.startsWith(root + path.sep)) throw new Error('Use workspace exports and isolated evidence')
}
fs.mkdirSync(output, { recursive: true })
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
const worker = fs.readdirSync(path.join(webRoot, '_expo/static/js/web')).find(file => /^worker-.*\.js$/.test(file))
assert.ok(worker, 'The real exported Expo SQLite worker must be present')
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  let url
  try { url = new URL(request.url, 'http://localhost') } catch { response.writeHead(400).end(); return }
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' }
  if (url.pathname === '/_qa/seed') {
    response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Disposable UI fixture</title>')
    return
  }
  if (url.pathname === '/_qa/working-states.sqlite') {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream' })
    fs.createReadStream(path.join(fixtureRoot, 'working-states.sqlite')).pipe(response)
    return
  }
  let file
  try { file = path.resolve(webRoot, '.' + decodeURIComponent(url.pathname)) } catch { response.writeHead(400).end(); return }
  if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) { response.writeHead(404).end(); return }
    file = path.join(webRoot, 'index.html')
  }
  response.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(response)
})
const results = { baseline, syntheticData: true, isolatedBrowserData: true, osClipboardWritten: false, nativeAcceptance: false, pages: [], checks: [], errors: [], blockedExternalHosts: [] }
let stage = 'startup'

async function seed(page, baseUrl, family) {
  await page.goto(baseUrl + '/_qa/seed')
  await page.evaluate(async ({ worker, fixture, family }) => {
    // The exported worker seeds only this disposable origin; no app QA hooks.
    const bytes = new Uint8Array(await (await fetch('/_qa/working-states.sqlite')).arrayBuffer())
    const dbWorker = new Worker(`/_expo/static/js/web/${worker}`)
    let id = 0
    const pending = new Map()
    dbWorker.onmessage = ({ data }) => {
      const request = pending.get(data.id)
      if (!request) return
      pending.delete(data.id)
      clearTimeout(request.timer)
      if (data.error) request.reject(new Error(data.error.message ?? String(data.error)))
      else request.resolve(data.result)
    }
    dbWorker.onerror = event => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(event.message)) }
      pending.clear()
    }
    const invoke = (type, data) => new Promise((resolve, reject) => {
      const next = ++id
      const timer = setTimeout(() => { pending.delete(next); reject(new Error(`Fixture worker timed out: ${type}`)) }, 15000)
      pending.set(next, { resolve, reject, timer })
      dbWorker.postMessage({ id: next, isSync: false, type, data })
    })
    try {
      await invoke('open', { nativeDatabaseId: 1, databasePath: ':memory:', options: {}, serializedData: bytes })
      await invoke('open', { nativeDatabaseId: 2, databasePath: './islemind-context.db', options: { useNewConnection: true } })
      await invoke('backupDatabase', { destNativeDatabaseId: 2, destDatabaseName: 'main', sourceNativeDatabaseId: 1, sourceDatabaseName: 'main' })
      await invoke('close', { nativeDatabaseId: 1 })
      await invoke('close', { nativeDatabaseId: 2 })
    } finally { dbWorker.terminate() }
    localStorage.setItem('@islemind/providers', JSON.stringify(fixture.providers))
    localStorage.setItem('@islemind/settings', JSON.stringify({
      themeId: family, theme: 'light', language: 'zh-CN', defaultProvider: fixture.providers[0].id,
      autoCheckApkUpdate: false, backgroundMotion: 'static',
    }))
  }, { worker, fixture, family })
}
async function settle(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
}
async function snapshot(page, name, family, width) {
  await settle(page)
  const geometry = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid]')].filter(node => /^usage-request-|^document-row-|^provider-open-/.test(node.dataset.testid))
    return {
      contentWidth: document.documentElement.scrollWidth,
      rows: rows.map(node => {
        const bounds = node.getBoundingClientRect()
        return { id: node.dataset.testid, width: bounds.width, height: bounds.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }
      }),
      contexts: [...document.querySelectorAll('[data-testid^="usage-context-"]')].map(node => {
        const source = node.lastElementChild
        return { id: node.dataset.testid, sourceHeight: source?.getBoundingClientRect().height ?? 0, lineHeight: source ? Number.parseFloat(getComputedStyle(source).lineHeight) : 0 }
      }),
    }
  })
  assert.ok(geometry.contentWidth <= width + 1, `${family}/${width}/${name}: horizontal page overflow`)
  if (!baseline) for (const row of geometry.rows) assert.ok(row.scrollWidth <= row.clientWidth + 1, `${row.id}: clipped content or horizontal overflow`)
  if (!baseline) for (const context of geometry.contexts) if (context.lineHeight > 0) assert.ok(context.sourceHeight <= context.lineHeight + 1, `${context.id}: a short request source split inside its label`)
  results.pages.push({ family, width, name, ...geometry })
  await page.screenshot({ path: path.join(output, `${family}-${width}-${name}.jpg`), type: 'jpeg', quality: 65 })
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true })
  let currentPage
  try {
    const families = probe || refreshProbe ? ['minimal'] : ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
    for (const family of families) {
      const widths = refreshProbe ? [390] : probe ? [320] : ['minimal', 'liquid-glass'].includes(family) ? [320, 390, 1280] : [320, 390]
      for (const width of widths) {
        stage = `${family}/${width}/seed`
        const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, colorScheme: 'light', reducedMotion: 'reduce' })
        await context.route('**/*', route => {
          const url = new URL(route.request().url())
          if (url.origin === baseUrl || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
          results.blockedExternalHosts.push(url.hostname)
          return route.abort()
        })
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__uiCopied = text } } })
          const exec = document.execCommand.bind(document)
          document.execCommand = (command, ...values) => /^(copy|cut|paste)$/i.test(command) ? false : exec(command, ...values)
          const post = Worker.prototype.postMessage
          const heldReads = []
          Worker.prototype.postMessage = function (message, ...values) {
            if (globalThis.__uiHoldDocumentRead && message.type === 'prepare' && /SELECT id, title, createdAt, updatedAt FROM saved_documents/.test(message.data?.source)) {
              heldReads.push({ worker: this, message, values })
              return
            }
            return post.call(this, message, ...values)
          }
          globalThis.__uiHeldDocumentReadCount = () => heldReads.length
          globalThis.__uiFailDocumentReads = () => {
            globalThis.__uiHoldDocumentRead = false
            for (const { worker, message } of heldReads.splice(0)) worker.dispatchEvent(new MessageEvent('message', {
              data: { id: message.id, error: 'A controlled browser-only document read failure' },
            }))
          }
        })
        const page = await context.newPage()
        currentPage = page
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => results.errors.push({ stage, message: error.message.slice(0, 240) }))
        await seed(page, baseUrl, family)
        stage = `${family}/${width}/documents`
        await page.goto(baseUrl + '/documents', { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: fixture.documentTitles[0], exact: true }).waitFor()
        await snapshot(page, 'documents-populated', family, width)
        const search = page.getByRole('textbox', { name: zh.documents.search, exact: true })
        await search.fill('not in this library')
        await page.getByText(zh.documents.noMatches, { exact: true }).waitFor()
        await snapshot(page, 'documents-no-results', family, width)
        await page.getByTestId('document-library-clear').click()
        assert.equal(await search.inputValue(), '')
        await page.getByRole('button', { name: fixture.documentTitles[0], exact: true }).waitFor()
        results.checks.push(`${family}/${width}: local catalog survives search and clear`)
        if (!baseline && family === 'minimal' && width === 390) {
          stage = 'document catalog refresh retention'
          const catalog = page.locator('[data-testid="document-library-catalog"]:visible')
          const retainedQuery = fixture.documentTitles[0]
          await search.fill(retainedQuery)
          const retainedIds = await catalog.locator('[data-testid^="document-row-"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid))
          await page.getByRole('button', { name: fixture.documentTitles[0], exact: true }).click()
          await page.getByTestId('document-title').waitFor()
          await page.evaluate(() => { globalThis.__uiHoldDocumentRead = true })
          await page.getByRole('button', { name: zh.documents.title, exact: true }).click()
          stage = 'document catalog pending state after editor return'
          const pendingRead = page.locator(`[data-testid="document-library-status"][aria-label=${JSON.stringify(zh.documents.refreshing)}]:visible`)
          await pendingRead.waitFor()
          stage = 'document catalog controlled delayed read'
          await page.waitForFunction(() => globalThis.__uiHeldDocumentReadCount() > 0)
          assert.equal(await search.inputValue(), retainedQuery)
          assert.deepEqual(await catalog.locator('[data-testid^="document-row-"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid)), retainedIds)
          await catalog.evaluate(node => { globalThis.__uiCatalogNode = node })
          await search.evaluate(node => { globalThis.__uiCatalogSearch = node })
          assert.equal(await search.evaluate(node => node === globalThis.__uiCatalogSearch), true)
          assert.equal(await page.locator('[data-testid="document-library-loading"]:visible').count(), 0)
          await snapshot(page, 'documents-refreshing', family, width)
          await page.evaluate(() => globalThis.__uiFailDocumentReads())
          const readError = page.locator('[data-testid="document-library-read-error"]:visible')
          const refreshError = readError.getByRole('alert')
          await refreshError.waitFor()
          assert.equal(await refreshError.textContent(), zh.documents.refreshFailed)
          assert.equal(await catalog.evaluate(node => node === globalThis.__uiCatalogNode), true)
          assert.equal(await search.evaluate(node => node === globalThis.__uiCatalogSearch), true)
          await snapshot(page, 'documents-refresh-failed', family, width)
          await page.getByRole('button', { name: zh.common.retry, exact: true }).click()
          await readError.waitFor({ state: 'hidden' })
          assert.equal(await search.evaluate(node => node === globalThis.__uiCatalogSearch), true)
          assert.equal(await search.inputValue(), retainedQuery)
          assert.equal(await catalog.evaluate(node => node === globalThis.__uiCatalogNode), true)
          await page.getByRole('button', { name: fixture.documentTitles[0], exact: true }).waitFor()
          await pendingRead.waitFor({ state: 'hidden' })
          await search.fill('')
          results.checks.push('Editor return restores catalog and query; delayed read, failure, and retry retain the active catalog/input DOM')
        }

        stage = `${family}/${width}/providers`
        await page.goto(baseUrl + '/settings/providers', { waitUntil: 'domcontentloaded' })
        await page.getByTestId(`provider-open-${fixture.providers[0].id}`).waitFor()
        await snapshot(page, 'providers-populated', family, width)
        await page.getByTestId(`provider-edit-${fixture.providers[0].id}`).click()
        await page.getByText(zh.apiKeyPanel.workspaceConnection, { exact: true }).first().waitFor()
        await snapshot(page, 'provider-connection', family, width)

        stage = `${family}/${width}/usage`
        await page.goto(baseUrl + '/settings/usage', { waitUntil: 'domcontentloaded' })
        await page.getByTestId('usage-primary-metric').waitFor()
        await page.getByTestId('usage-primary-metric').getByText(baseline ? String(fixture.requestCount) : '0', { exact: true }).waitFor()
        if (!baseline) await page.getByRole('tab', { name: zh.usage.requestLog, exact: true }).click()
        await snapshot(page, 'usage-requests', family, width)
        await page.getByRole('list', { name: zh.usage.requestLog, exact: true }).scrollIntoViewIfNeeded()
        await snapshot(page, 'usage-request-list', family, width)
        if (!baseline) {
          await page.getByTestId('usage-request-attempt:fixture-request-1').click()
          await page.getByText(zh.usage.requestDetail, { exact: true }).first().waitFor()
          await snapshot(page, 'usage-request-detail', family, width)
          await page.getByRole('button', { name: zh.common.back, exact: true }).click()
          assert.equal(await page.getByRole('tab', { name: zh.usage.requestLog, exact: true }).getAttribute('aria-selected'), 'true')
          await page.getByRole('tab', { name: zh.usage.overviewTab, exact: true }).click()
          results.checks.push(`${family}/${width}: request detail remains available`)
        }
        await page.getByRole('tab', { name: zh.usage.providerStatistics, exact: true }).click()
        assert.equal(await page.getByRole('tab', { name: zh.usage.providerStatistics, exact: true }).getAttribute('aria-selected'), 'true')
        await page.getByRole('list', { name: zh.usage.providerStatistics, exact: true }).scrollIntoViewIfNeeded()
        await snapshot(page, 'usage-providers', family, width)
        await page.getByRole('tab', { name: zh.usage.modelStatistics, exact: true }).click()
        await page.getByRole('list', { name: zh.usage.modelStatistics, exact: true }).scrollIntoViewIfNeeded()
        await snapshot(page, 'usage-models', family, width)
        results.checks.push(`${family}/${width}: usage reads real synthetic SQLite records and switches groups`)
        if (!baseline && width === 390) {
          await page.evaluate(() => {
            const settings = JSON.parse(localStorage.getItem('@islemind/settings'))
            localStorage.setItem('@islemind/settings', JSON.stringify({ ...settings, theme: 'dark' }))
          })
          for (const [name, route, ready] of [
            ['documents-dark', '/documents', 'document-library-catalog'],
            ['providers-dark', '/settings/providers', `provider-open-${fixture.providers[0].id}`],
            ['usage-dark', '/settings/usage', 'usage-primary-metric'],
          ]) {
            stage = `${family}/${width}/${name}`
            await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' })
            await page.getByTestId(ready).waitFor()
            await page.waitForFunction(() => document.documentElement.dataset.themeMode === 'dark')
            await snapshot(page, name, family, width)
          }
        }
        await context.close()
      }
    }
    assert.equal(results.errors.length, 0, 'No uncaught browser errors')
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) {
      const state = await currentPage.evaluate(() => ({
        url: location.href,
        catalogCount: document.querySelectorAll('[data-testid="document-library-catalog"]').length,
        loadingCount: document.querySelectorAll('[data-testid="document-library-loading"]').length,
        status: document.querySelector('[data-testid="document-library-status"]')?.getAttribute('aria-label'),
        readError: document.querySelector('[data-testid="document-library-read-error"]')?.textContent,
        heldReads: globalThis.__uiHeldDocumentReadCount?.(),
      })).catch(() => null)
      fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify(state, null, 2) + '\n')
      await currentPage.screenshot({ path: path.join(output, 'failure.jpg'), type: 'jpeg', quality: 65 }).catch(() => {})
    }
    throw error
  } finally { await browser.close() }
}
main().catch(error => { results.failedStage = stage; results.failure = error.message; process.exitCode = 1 }).finally(() => {
  server.close()
  results.blockedExternalHosts = [...new Set(results.blockedExternalHosts)]
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify({ pages: results.pages.length, checks: results.checks.length, errors: results.errors.length, failedStage: results.failedStage, failure: results.failure ?? null, output }))
})
