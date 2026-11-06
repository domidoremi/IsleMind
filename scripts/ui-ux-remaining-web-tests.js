const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' }

async function runUiUxRemainingWebChecks({ webRoot, output, fixturesRoot, probe = false }) {
  webRoot = path.resolve(webRoot)
  output = path.resolve(output)
  fixturesRoot = path.resolve(fixturesRoot)
  for (const target of [webRoot, output, fixturesRoot]) assert.ok(path.resolve(target).startsWith(root + path.sep), 'Use workspace exports and disposable evidence')
  assert.ok(!fs.existsSync(output), 'Preserve existing evidence; use a fresh output directory')
  fs.mkdirSync(output, { recursive: true })
  const fixture = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'manifest.json'), 'utf8'))
  assert.equal(fixture.synthetic, true)
  assert.equal(fixture.externalServicesUsed, false)
  const worker = fs.readdirSync(path.join(webRoot, '_expo/static/js/web')).find(file => /^worker-.*\.js$/.test(file))
  assert.ok(worker, 'Use the exported Expo SQLite worker')
  const results = { syntheticData: true, isolatedBrowserData: true, osClipboardWritten: false, nativeAcceptance: false, pages: [], checks: [], errors: [], blockedHosts: [] }
  let stage = 'startup'
  let page
  const server = http.createServer((request, response) => {
    const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' }
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname) } catch { response.writeHead(400).end(); return }
    if (pathname === '/_qa/seed') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Disposable UX fixture</title>'); return }
    if (pathname === '/_qa/fixture.sqlite') {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream' })
      fs.createReadStream(path.join(fixturesRoot, fixture.database)).pipe(response)
      return
    }
    let file = path.resolve(webRoot, '.' + pathname)
    if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      if (path.extname(file)) { response.writeHead(404).end(); return }
      file = path.join(webRoot, 'index.html')
    }
    response.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(response)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })

  async function seed(family, mode) {
    await page.goto(baseUrl + '/_qa/seed')
    await page.evaluate(async ({ fixture, worker, family, mode }) => {
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
      localStorage.setItem('@islemind/providers', JSON.stringify(fixture.providers))
      localStorage.setItem('@islemind/settings', JSON.stringify({ themeId: family, theme: mode, language: 'zh-CN', defaultProvider: fixture.providers[0].id, autoUpdateCheckEnabled: false, backgroundMotion: 'static' }))
    }, { fixture, worker, family, mode })
  }

  async function snapshot(name, family, width, mode) {
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(160)
    const metrics = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      fields: [...document.querySelectorAll('[data-testid]')]
        .filter(node => /^(document-writing-frame|document-library-filters|document-context-column|source-navigation-column|source-reading-column)$/.test(node.dataset.testid))
        .map(node => ({ id: node.dataset.testid, rect: node.getBoundingClientRect().toJSON(), scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
    }))
    assert.ok(metrics.contentWidth <= width + 1, `${stage}: horizontal document overflow`)
    for (const field of metrics.fields) assert.ok(field.scrollWidth <= field.clientWidth + 1, `${stage}: ${field.id} content overflow`)
    const screenshot = path.join(output, `${family}-${width}-${mode}-${name}.png`)
    await page.screenshot({ path: screenshot })
    results.pages.push({ family, width, mode, name, ...metrics, screenshot })
  }

  async function library() {
    await page.goto(baseUrl + '/documents', { waitUntil: 'domcontentloaded' })
    await page.getByTestId(`document-row-${fixture.documentId}`).waitFor()
    await page.getByTestId('document-library-count').filter({ hasText: String(fixture.documentCount) }).waitFor()
  }

  try {
    const families = probe ? ['minimal'] : ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
    const matrix = families.flatMap(family => (probe ? [390, 1280] : [320, 390, 1280]).map(width => ({ family, width, mode: 'light' })))
    if (!probe) matrix.push(...families.map(family => ({ family, width: 390, mode: 'dark' })))
    for (const { family, width, mode } of matrix) {
      stage = `${family}/${width}/${mode}`
      const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, reducedMotion: 'reduce', colorScheme: mode })
      try {
        await context.route('**/*', route => {
          const url = new URL(route.request().url())
          if (url.origin === baseUrl || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
          results.blockedHosts.push(url.hostname)
          return route.abort()
        })
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__uxClipboard = text } } })
          const exec = document.execCommand.bind(document)
          document.execCommand = (command, ...args) => /^(copy|cut|paste)$/i.test(command) ? false : exec(command, ...args)
        })
        page = await context.newPage()
        page.on('pageerror', error => results.errors.push({ stage, message: error.message }))
        await seed(family, mode)
        await library()
        const renderedRows = await page.locator('[data-testid^="document-row-"]').count()
        assert.ok(renderedRows > 0 && renderedRows < fixture.documentCount, 'The catalog must not mount every saved document')
        await snapshot('catalog', family, width, mode)
        await page.getByTestId('document-sort-title').click()
        assert.equal(await page.getByTestId('document-sort-title').getAttribute('aria-checked'), 'true')
        await page.getByRole('textbox', { name: zh.documents.search }).fill('Notebook')
        await page.getByTestId(`document-row-${fixture.documentId}`).click()
        const body = page.getByTestId('document-body')
        await body.waitFor()
        await page.evaluate(() => document.fonts.ready)
        const draft = fixture.body + '\n\nAn explicit user edit.'
        await body.fill(draft)
        await body.evaluate(node => {
          globalThis.__uxBody = node
          globalThis.__uxTitle = document.querySelector('[data-testid="document-title"]')
          node.focus()
          node.setSelectionRange(40, 80)
          node.scrollTop = 200
          node.dispatchEvent(new Event('select', { bubbles: true }))
          node.dispatchEvent(new Event('scroll', { bubbles: true }))
        })
        await page.getByTestId('document-mode-preview').click()
        await page.getByTestId('document-preview').waitFor()
        assert.equal(await page.getByTestId('document-body').evaluate(node => node === globalThis.__uxBody), true)
        await snapshot('preview', family, width, mode)
        await page.getByTestId('document-mode-edit').click()
        await page.waitForFunction(() => document.activeElement === globalThis.__uxBody)
        const restored = await body.evaluate(node => ({ same: node === globalThis.__uxBody, start: node.selectionStart, end: node.selectionEnd, scroll: node.scrollTop }))
        assert.equal(restored.same, true)
        assert.equal(restored.start, 40)
        assert.equal(restored.end, 80)
        assert.ok(Math.abs(restored.scroll - 200) <= 1, 'Preview must retain internal writing scroll')
        assert.equal(await body.inputValue(), draft)
        await page.getByTestId('document-storage-toggle').click()
        await page.getByText(zh.documents.retentionNotice, { exact: true }).waitFor()
        await page.getByTestId('document-storage-toggle').click()
        if (width >= 1000) {
          assert.equal(await page.getByTestId('document-workspace').evaluate(node => getComputedStyle(node).flexDirection), 'row')
          await page.setViewportSize({ width: 780, height: 900 })
          await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="document-workspace"]')).flexDirection === 'column')
          assert.equal(await body.evaluate(node => node === globalThis.__uxBody), true)
          assert.equal(await body.inputValue(), draft)
          await page.setViewportSize({ width, height: 900 })
        }
        await snapshot('writer', family, width, mode)
        await page.getByRole('button', { name: zh.common.save, exact: true }).click()
        await page.getByTestId('document-save-status').filter({ hasText: zh.documents.saved }).waitFor()
        assert.equal(await body.evaluate(node => node === globalThis.__uxBody), true)
        await page.getByRole('button', { name: zh.documents.title, exact: true }).click()
        await page.getByTestId('document-library-count').waitFor()
        assert.equal(await page.getByRole('textbox', { name: zh.documents.search }).inputValue(), 'Notebook')
        assert.equal(await page.getByTestId('document-sort-title').getAttribute('aria-checked'), 'true')
        await page.getByTestId('document-library-list').evaluate(node => { node.scrollTop = 1100; node.dispatchEvent(new Event('scroll', { bubbles: true })) })
        await page.waitForTimeout(180)
        const scrollBefore = await page.getByTestId('document-library-list').evaluate(node => node.scrollTop)
        assert.ok(scrollBefore > 500)
        const openedId = await page.locator('[data-testid^="document-row-"]').evaluateAll(nodes => {
          const viewport = document.querySelector('[data-testid="document-library-list"]').getBoundingClientRect()
          const top = Math.max(0, viewport.top) + 2
          const bottom = Math.min(innerHeight, viewport.bottom) - 2
          const visible = nodes.filter(node => { const box = node.getBoundingClientRect(); return box.top > top && box.bottom < bottom })
          return visible[1]?.dataset.testid
        })
        assert.ok(openedId, 'A visible catalog row is required for the return check')
        await page.getByTestId(openedId).click()
        await page.getByTestId('document-body').waitFor()
        await page.getByRole('button', { name: zh.documents.title, exact: true }).click()
        await page.getByTestId('document-library-catalog').waitFor()
        await page.waitForTimeout(250)
        const scrollAfter = await page.getByTestId('document-library-list').evaluate(node => node.scrollTop)
        assert.ok(Math.abs(scrollAfter - scrollBefore) <= 2, `Catalog return moved from ${scrollBefore} to ${scrollAfter}`)
        assert.equal(await page.getByTestId(openedId).getAttribute('aria-selected'), 'true')
        results.checks.push({ family, width, mode, renderedRows, bodyRestoration: restored, catalogScrollBefore: scrollBefore, catalogScrollAfter: scrollAfter })

        stage = `${family}/${width}/${mode}/source`
        await page.goto(`${baseUrl}/source?conversationId=${fixture.conversationId}&messageId=${fixture.messageId}&citationId=${fixture.citations.at(-1).id}`, { waitUntil: 'domcontentloaded' })
        const picker = page.getByTestId('source-citation-picker')
        await picker.waitFor()
        if (await picker.getAttribute('aria-expanded') === 'false') await picker.click()
        const last = page.getByTestId(`source-citation-${fixture.citations.length - 1}`)
        await last.waitFor()
        await page.waitForFunction(index => document.querySelector(`[data-testid="source-citation-${index}"]`)?.getAttribute('aria-selected') === 'true', fixture.citations.length - 1)
        await page.waitForTimeout(150)
        const selectedBounds = await last.boundingBox()
        assert.ok(selectedBounds.x >= -1 && selectedBounds.x + selectedBounds.width <= width + 1, 'The selected source should be visible horizontally')
        if (width >= 1000) assert.ok(selectedBounds.y >= 0 && selectedBounds.y + selectedBounds.height <= 900, 'The selected source should be visible vertically')
        await snapshot('source', family, width, mode)
        await page.getByTestId('source-citation-0').click()
        await page.waitForFunction(() => document.querySelector('[data-testid="source-citation-0"]')?.getAttribute('aria-selected') === 'true')
        if (width < 1000) assert.equal(await picker.getAttribute('aria-expanded'), 'false', 'Selecting a source closes the compact picker without changing its identity')
        assert.equal(new URL(page.url()).searchParams.get('citationId'), fixture.citations[0].id)
        if (width === 390 && mode === 'light') {
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
          await page.getByTestId('composer-overlay').waitFor()
          await snapshot('home-retained', family, width, mode)
        }
      } catch (error) {
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
        throw error
      } finally { await context.close() }
    }
    assert.deepEqual(results.errors, [], 'No runtime page errors')
    assert.deepEqual(results.blockedHosts, [], 'No external source or provider requests')
  } catch (error) {
    results.failure = { stage, message: error.message }
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
  return { pages: results.pages.length, workflowChecks: results.checks.length, errors: results.errors.length, blockedExternalRequests: results.blockedHosts.length, output }
}

module.exports = { runUiUxRemainingWebChecks }
if (require.main === module) {
  const args = process.argv.slice(2)
  const option = name => args.includes(name) ? path.resolve(args[args.indexOf(name) + 1]) : undefined
  runUiUxRemainingWebChecks({ webRoot: option('--web-root'), output: option('--output'), fixturesRoot: option('--fixtures'), probe: args.includes('--probe') })
    .then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
