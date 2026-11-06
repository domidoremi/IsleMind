const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidence = fs.readFileSync(path.join(root, 'test-evidence/qa/current-ui-detail-workspaces-path.txt'), 'utf8').trim()
const prior = JSON.parse(fs.readFileSync(path.join(evidence, 'baseline.json'), 'utf8'))
const baseline = args.includes('--baseline')
const probe = args.includes('--probe')
const webRoot = path.resolve(option('--web-root', baseline ? prior.acceptedExport : path.join(evidence, 'web-after')))
const output = path.resolve(option('--output', path.join(evidence, baseline ? 'visual-before' : 'visual-after')))
const fixtureRoot = path.resolve(option('--fixtures', prior.fixture))
for (const target of [webRoot, output, fixtureRoot]) if (!target.startsWith(root + path.sep)) throw new Error('Use workspace exports and disposable evidence')
if (fs.existsSync(output)) throw new Error('Preserve existing evidence; use a fresh output directory')
fs.mkdirSync(output, { recursive: true })
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
const longProviderName = 'Research and reference connection for a multi-model editorial workspace'
const worker = fs.readdirSync(path.join(webRoot, '_expo/static/js/web')).find(file => /^worker-.*\.js$/.test(file))
assert.ok(worker, 'Use the actual exported Expo SQLite worker')
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  let url
  try { url = new URL(request.url, 'http://localhost') } catch { response.writeHead(400).end(); return }
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' }
  if (url.pathname === '/_qa/seed') {
    response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Disposable UI fixture</title>')
    return
  }
  if (url.pathname === '/_qa/fixture.sqlite') {
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
const results = { baseline, syntheticData: true, isolatedBrowserData: true, nativeAcceptance: false, osClipboardWritten: false, pages: [], checks: [], errors: [], blockedExternalHosts: [] }
let stage = 'startup'
let currentPage

async function seed(page, baseUrl, family) {
  await page.goto(baseUrl + '/_qa/seed')
  await page.evaluate(async ({ worker, fixture, family, longProviderName }) => {
    const bytes = new Uint8Array(await (await fetch('/_qa/fixture.sqlite')).arrayBuffer())
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
    const providers = fixture.providers.map((provider, index) => index === 1 ? { ...provider, name: longProviderName } : provider)
    localStorage.setItem('@islemind/providers', JSON.stringify(providers))
    localStorage.setItem('@islemind/settings', JSON.stringify({
      themeId: family, theme: 'light', language: 'zh-CN', defaultProvider: providers[0].id,
      autoCheckApkUpdate: false, backgroundMotion: 'static',
    }))
  }, { worker, fixture, family, longProviderName })
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
}
async function snapshot(page, name, family, width) {
  await settle(page)
  const geometry = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    rows: [...document.querySelectorAll('[data-testid]')]
      .filter(node => /^(usage-detail-(cell|field)-|provider-configuration-title$|document-editor-toolbar$|document-writing-frame$)/.test(node.dataset.testid))
      .filter(node => node.getBoundingClientRect().width > 0)
      .map(node => {
        const bounds = node.getBoundingClientRect()
        return { id: node.dataset.testid, width: bounds.width, height: bounds.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }
      }),
  }))
  assert.ok(geometry.contentWidth <= width + 1, `${family}/${width}/${name}: horizontal page overflow`)
  if (!baseline) for (const row of geometry.rows) assert.ok(row.scrollWidth <= row.clientWidth + 1, `${row.id}: horizontal content overflow`)
  results.pages.push({ family, width, name, ...geometry })
  await page.screenshot({ path: path.join(output, `${family}-${width}-${name}.jpg`), type: 'jpeg', quality: 65 })
}
async function openDocument(page, baseUrl) {
  await page.goto(baseUrl + '/documents/edit?id=fixture-document-1', { waitUntil: 'domcontentloaded' })
  await page.getByTestId('document-body').waitFor()
}
async function openProvider(page, baseUrl) {
  await page.goto(baseUrl + '/settings/providers', { waitUntil: 'domcontentloaded' })
  await page.getByTestId(`provider-edit-${fixture.providers[1].id}`).click()
  await page.getByRole('tab', { name: zh.apiKeyPanel.workspaceConnection, exact: true }).waitFor()
}
async function openUsage(page, baseUrl, requestId = 'fixture-request-1') {
  await page.goto(baseUrl + '/settings/usage' + (baseline ? '' : '?view=requests&range=all'), { waitUntil: 'domcontentloaded' })
  const row = page.getByTestId(`usage-request-${baseline ? '' : 'attempt:'}${requestId}`)
  await row.scrollIntoViewIfNeeded()
  await row.click()
  if (!baseline) await page.getByTestId('usage-request-detail').waitFor()
  else await page.getByText(zh.usage.requestDetail, { exact: true }).first().waitFor()
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true })
  try {
    const families = probe ? ['minimal'] : ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
    for (const family of families) {
      const widths = probe ? [320, 390] : ['minimal', 'liquid-glass'].includes(family) ? [320, 390, 1280] : [320, 390]
      for (const width of widths) {
        const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, reducedMotion: 'reduce', colorScheme: 'light' })
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
        })
        const page = await context.newPage()
        currentPage = page
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => results.errors.push({ stage, message: error.message.slice(0, 240) }))
        stage = `${family}/${width}/seed`
        await seed(page, baseUrl, family)

        stage = `${family}/${width}/document editor`
        await openDocument(page, baseUrl)
        await snapshot(page, 'document-editor', family, width)
        if (!baseline) {
          const body = page.getByTestId('document-body')
          const draft = '# A local working draft\n\nThe document stays here until I choose Save.\n\n[Local preview does not open links](https://link.invalid/review)\n\n![No external image](https://image.invalid/item.png)\n\nA second paragraph for the next revision.'
          await body.fill(draft)
          await page.waitForFunction(label => document.querySelector('[data-testid="document-save-status"]')?.textContent === label, zh.documents.unsaved)
          await body.evaluate(node => { globalThis.__uiBody = node })
          const beforeCopy = await body.boundingBox()
          await page.getByTestId('document-copy').click()
          await page.waitForFunction(text => globalThis.__uiCopied === text, draft)
          await settle(page)
          const afterCopy = await body.boundingBox()
          assert.ok(Math.abs(beforeCopy.y - afterCopy.y) <= 1, 'Copy receipt must not move the writing field')
          assert.equal(await body.evaluate(node => node === globalThis.__uiBody), true)
          const slotBefore = await page.getByTestId('document-save-status-slot').boundingBox()
          const bodyBeforeSave = await body.boundingBox()
          await page.getByRole('button', { name: zh.common.save, exact: true }).click()
          await page.waitForFunction(label => document.querySelector('[data-testid="document-save-status"]')?.textContent === label, zh.documents.saved)
          await settle(page)
          const slotAfter = await page.getByTestId('document-save-status-slot').boundingBox()
          const bodyAfterSave = await body.boundingBox()
          assert.ok(Math.abs(slotBefore.height - slotAfter.height) <= 1, 'Save state reserves the same fluid notice space')
          assert.ok(Math.abs(bodyBeforeSave.y - bodyAfterSave.y) <= 1, 'Save state must not move the writing field')
          assert.equal(await body.evaluate(node => node === globalThis.__uiBody), true)
          await snapshot(page, 'document-saved', family, width)
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.getByTestId('document-body').waitFor()
          assert.equal(await page.getByTestId('document-body').inputValue(), draft)
          await page.getByRole('tab', { name: zh.documents.preview, exact: true }).click()
          assert.equal(await page.getByTestId('document-mode-preview').getAttribute('aria-selected'), 'true')
          await page.getByText(zh.documents.imageNotLoaded, { exact: true }).waitFor()
          await snapshot(page, 'document-preview', family, width)
          await page.getByRole('tab', { name: zh.documents.edit, exact: true }).click()
          assert.equal(await page.getByTestId('document-body').inputValue(), draft)
          results.checks.push({ family, width, name: 'Local writing modes, durable save/reload, copy, and stable save geometry', saveSlotShift: slotAfter.height - slotBefore.height, bodySaveShift: bodyAfterSave.y - bodyBeforeSave.y })
        }

        stage = `${family}/${width}/provider configuration`
        await openProvider(page, baseUrl)
        await snapshot(page, 'provider-connection', family, width)
        if (!baseline) {
          const title = page.getByTestId('provider-configuration-title')
          assert.equal(await title.getAttribute('aria-label'), longProviderName)
          const close = await page.getByTestId('provider-configuration-close').boundingBox()
          assert.ok(close.width >= 44 && close.height >= 44)
          for (const [name, label] of [['models', zh.apiKeyPanel.workspaceModels], ['advanced', zh.apiKeyPanel.workspaceAdvanced], ['connection', zh.apiKeyPanel.workspaceConnection]]) {
            const tab = page.getByRole('tab', { name: label, exact: true })
            await tab.click()
            assert.equal(await tab.getAttribute('aria-selected'), 'true')
            if (name !== 'connection') await snapshot(page, `provider-${name}`, family, width)
          }
          await page.getByTestId('provider-configuration-close').click()
          await page.getByTestId('provider-configuration-title').waitFor({ state: 'hidden' })
          results.checks.push({ family, width, name: 'Full provider identity, close target, and all configuration views remain available' })
        }

        stage = `${family}/${width}/request detail`
        await openUsage(page, baseUrl)
        await snapshot(page, 'usage-detail', family, width)
        if (!baseline) {
          const expected = { input: '3,200', output: '640', total: '3,840' }
          for (const [id, value] of Object.entries(expected)) assert.equal(await page.getByTestId(`usage-detail-value-${id}`).textContent(), value)
          await page.getByTestId('usage-detail-redaction').waitFor()
          const total = await page.getByTestId('usage-detail-cell-total').boundingBox()
          const latency = await page.getByTestId('usage-detail-cell-latency').boundingBox()
          assert.ok(total.x + total.width <= latency.x + 1 || total.y + total.height <= latency.y + 1, 'Key readings must not overlap')
          await page.getByRole('button', { name: zh.common.back, exact: true }).click()
          await page.getByRole('tab', { name: zh.usage.requestLog, exact: true }).waitFor()
          await openUsage(page, baseUrl, 'fixture-request-3')
          await page.getByTestId('usage-attempt-1').click()
          await page.getByTestId('usage-detail-value-error').waitFor()
          assert.equal(await page.getByTestId('usage-detail-value-error').textContent(), 'upstream_error')
          await snapshot(page, 'usage-error-detail', family, width)
          results.checks.push({ family, width, name: 'Real synthetic usage fields, redaction, and failure detail are retained' })
        }
        if (!baseline && width === 390) {
          await page.evaluate(() => {
            const settings = JSON.parse(localStorage.getItem('@islemind/settings'))
            settings.theme = 'dark'
            localStorage.setItem('@islemind/settings', JSON.stringify(settings))
          })
          await openDocument(page, baseUrl)
          await snapshot(page, 'document-editor-dark', family, width)
          await openProvider(page, baseUrl)
          await snapshot(page, 'provider-connection-dark', family, width)
          await openUsage(page, baseUrl)
          await snapshot(page, 'usage-detail-dark', family, width)
        }
        await context.close()
      }
    }
    assert.equal(results.errors.length, 0, 'No uncaught browser errors')
    assert.equal(results.blockedExternalHosts.includes('image.invalid'), false, 'Preview must not even attempt an external image')
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({ path: path.join(output, 'failure.jpg'), type: 'jpeg', quality: 65 }).catch(() => {})
      const state = await currentPage.evaluate(() => ({ url: location.href, saveStatus: document.querySelector('[data-testid="document-save-status"]')?.textContent, alerts: [...document.querySelectorAll('[role="alert"]')].map(node => node.textContent) })).catch(() => null)
      fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify(state, null, 2) + '\n')
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
