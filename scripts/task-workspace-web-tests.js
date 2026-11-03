const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const mime = { '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' }
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function runTaskWorkspaceWebChecks({ webRoot, fixturesRoot, output, baseline = false, probe = false, captureOnly = false, entryOnly = false }) {
  for (const value of [webRoot, fixturesRoot, output]) assert.ok(value?.startsWith(root + path.sep), 'Use explicit workspace exports and disposable evidence')
  assert.ok(!fs.existsSync(output), 'Preserve existing evidence')
  fs.mkdirSync(output, { recursive: true })
  const manifestFile = path.join(fixturesRoot, 'manifest.json')
  const fixture = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  assert.equal(fixture.synthetic, true)
  assert.equal(fixture.externalServicesUsed, false)
  const worker = fs.readdirSync(path.join(webRoot, '_expo/static/js/web')).find(file => /^worker-.*\.js$/.test(file))
  assert.ok(worker, 'Use the exported SQLite worker')
  const results = {
    baseline, entryOnly, passed: false, syntheticData: true, isolatedBrowserData: true, osClipboardWritten: false,
    nativeAcceptance: false, fixtureHash: hash(manifestFile), databaseHash: hash(path.join(fixturesRoot, fixture.database)),
    webRoot, pages: [], checks: [], errors: [], blockedRequests: [],
  }
  let stage = 'startup'
  let page
  const server = http.createServer((request, response) => {
    const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' }
    let pathname
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname) } catch { response.writeHead(400).end(); return }
    if (pathname === '/_qa/seed') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Disposable workspace fixture</title>'); return }
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
  results.browserVersion = browser.version()

  async function seed(family, mode) {
    await page.goto(baseUrl + '/_qa/seed')
    await page.evaluate(async ({ fixture, worker, family, mode }) => {
      const bytes = new Uint8Array(await (await fetch('/_qa/fixture.sqlite')).arrayBuffer())
      const dbWorker = new Worker(`/_expo/static/js/web/${worker}`)
      const pending = new Map()
      let sequence = 0
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
      localStorage.setItem('@islemind/providers', JSON.stringify(fixture.providers))
      for (const provider of fixture.providers) if (provider.enabled) {
        localStorage.setItem(`@islemind/secure/islemind.key.${provider.id}`, 'disposable-ui-fixture-not-a-real-key')
      }
      localStorage.setItem('@islemind/settings', JSON.stringify({
        themeId: family, theme: mode, language: 'zh-CN', defaultProvider: fixture.providers[0].id,
        autoUpdateCheckEnabled: false, autoApkDownloadEnabled: false, backgroundMotion: 'static',
      }))
    }, { fixture, worker, family, mode })
  }

  async function navigate(route) {
    await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.innerText.trim().length > 15)
  }

  async function snapshot(name, family, width, mode) {
    stage = `${family}/${width}/${mode}/${name}`
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(180)
    const metrics = await page.evaluate(() => ({
      contentWidth: document.documentElement.scrollWidth,
      theme: document.documentElement.dataset.themeId,
      fields: [...document.querySelectorAll('[data-testid]')]
        .filter(node => /^(chat-entry-workspace|chat-entry-task-choices|settings-workspace|settings-task-navigator|document-title|document-writing-frame|document-library-filters|document-context-column|source-citation-commands|source-reading-column|source-reader-label)$/.test(node.dataset.testid))
        .filter(node => node.getBoundingClientRect().width > 0)
        .map(node => ({
          id: node.dataset.testid, rect: node.getBoundingClientRect().toJSON(),
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
          fontFamily: getComputedStyle(node).fontFamily, fontSize: getComputedStyle(node).fontSize,
          lineHeight: getComputedStyle(node).lineHeight,
        })),
    }))
    assert.ok(metrics.contentWidth <= width + 1, `${stage}: horizontal document overflow`)
    assert.equal(metrics.theme, family, 'The requested canonical theme must render')
    if (!baseline) for (const field of metrics.fields) {
      if (field.id !== 'document-title') assert.ok(field.scrollWidth <= field.clientWidth + 1, `${stage}: ${field.id} content overflow`)
      else assert.ok(field.scrollHeight <= field.clientHeight + 2, `${stage}: the multiline manuscript title is clipped`)
      if (field.id === 'source-reader-label') {
        const lineHeight = Number.parseFloat(field.lineHeight) || Number.parseFloat(field.fontSize) * 1.4
        assert.ok(field.scrollHeight <= lineHeight * 2 + 2, `${stage}: source metadata collapsed into a narrow text column`)
      }
    }
    const capture = mode === 'light' && width !== 320 || ['home', 'settings', 'writer', 'source-local'].includes(name)
    const screenshot = capture ? path.join(output, `${family}-${width}-${mode}-${name}.png`) : undefined
    if (screenshot) await page.screenshot({ path: screenshot })
    results.pages.push({ family, width, mode, name, ...metrics, screenshot })
  }

  async function openPicker() {
    const picker = page.getByTestId('source-citation-picker')
    if (await picker.count() && await picker.getAttribute('aria-expanded') !== 'true') await picker.click()
  }

  try {
    const families = probe ? ['minimal'] : ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
    const matrix = families.flatMap(family => (entryOnly ? [390] : [390, 1280]).map(width => ({ family, width, mode: 'light' })))
    if (!probe && !baseline && !entryOnly) matrix.push(...families.flatMap(family => [
      { family, width: 320, mode: 'light' }, { family, width: 390, mode: 'dark' },
    ]))
    for (const { family, width, mode } of matrix) {
      stage = `${family}/${width}/${mode}`
      const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, reducedMotion: 'reduce', colorScheme: mode, hasTouch: entryOnly })
      try {
        await context.route('**/*', route => {
          const url = new URL(route.request().url())
          if (url.origin === baseUrl || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
          results.blockedRequests.push({ stage, url: `${url.origin}${url.pathname}`, method: route.request().method() })
          return route.abort()
        })
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { globalThis.__workspaceClipboard = text } } })
          const exec = document.execCommand.bind(document)
          document.execCommand = (command, ...rest) => /^(copy|cut|paste)$/i.test(command) ? false : exec(command, ...rest)
        })
        page = await context.newPage()
        page.setDefaultTimeout(15000)
        page.on('pageerror', error => results.errors.push({ stage, message: error.message }))
        await seed(family, mode)
        await navigate('/')
        await page.getByTestId('composer-overlay').waitFor()
        // The fixture intentionally has history, so enter a new task explicitly.
        await page.getByRole('button', { name: zh.chat.newConversation, exact: true }).click()
        if (!baseline) await page.getByTestId('chat-entry-workspace').waitFor()
        await snapshot('home', family, width, mode)
        if (!baseline && !captureOnly) {
          const composer = page.getByRole('textbox', { name: zh.chat.inputAccessibility })
          await page.getByTestId('chat-entry-prepare').waitFor()
          await page.waitForFunction(() => document.querySelector('[data-testid="chat-entry-prepare"]')?.getAttribute('aria-disabled') !== 'true')
          await page.getByTestId('chat-entry-task-analyze').click()
          assert.equal(await composer.inputValue(), '')
          await page.getByTestId('chat-entry-prepare').click()
          await page.waitForFunction(prompt => document.querySelector('textarea[aria-label]')?.value === prompt, zh.chatPresentation.starters.analyze.prompt)
          const prepared = await composer.inputValue()
          await page.getByTestId('chat-entry-starting-points-toggle').click()
          await page.getByTestId('chat-entry-task-draft').click()
          assert.equal(await page.getByTestId('chat-entry-prepare').isDisabled(), true)
          assert.equal(await composer.inputValue(), prepared)
          await page.getByTestId('chat-entry-starting-points-toggle').click()
          assert.equal(await page.getByTestId('chat-entry-task-panel').isVisible(), false)
          results.checks.push({ family, width, mode, name: 'entry-prepares-only-explicitly-and-preserves-existing-draft' })
          if (entryOnly) {
            await composer.evaluate(node => { globalThis.__workspaceEntryInput = node; node.focus() })
            await page.getByTestId('chat-entry-starting-points-toggle').tap()
            await page.waitForFunction(() => document.activeElement !== globalThis.__workspaceEntryInput)
            assert.equal(await composer.inputValue(), prepared)
            await snapshot('home-draft', family, width, mode)
            results.checks.push({ family, width, mode, name: 'touching-entry-content-clears-focus-without-changing-or-sending-the-draft' })
            console.log(JSON.stringify({ stage, pages: results.pages.length, checks: results.checks.length }))
            continue
          }
          await composer.fill('')
        }

        await navigate('/settings')
        await page.getByTestId(baseline ? 'settings-groups' : 'settings-task-navigator').waitFor()
        await snapshot('settings', family, width, mode)
        const settingsSearch = page.getByRole('textbox', { name: zh.settings.search })
        if (!baseline) {
          await settingsSearch.evaluate(node => { globalThis.__workspaceSettingsSearch = node })
          await page.getByTestId('settings-task-capabilities').click()
          await page.getByTestId('settings-entry-mcp').waitFor()
          await snapshot('settings-capabilities', family, width, mode)
        }
        await settingsSearch.fill('temperature')
        await page.getByTestId('settings-result-temperature').waitFor()
        await snapshot('settings-search', family, width, mode)
        await settingsSearch.fill('')
        if (!baseline) {
          await page.getByTestId('settings-task-navigator').waitFor()
          assert.equal(await settingsSearch.evaluate(node => node === globalThis.__workspaceSettingsSearch), true)
          assert.equal(await page.getByTestId('settings-task-capabilities').getAttribute('aria-selected'), 'true')
          results.checks.push({ family, width, mode, name: 'settings-search-and-task-area-have-independent-retained-state' })
        }

        await navigate('/settings/providers')
        await page.getByTestId(`provider-settings-experience-${family}`).waitFor()
        await snapshot('providers', family, width, mode)
        await navigate('/documents')
        await page.getByTestId(`document-row-${fixture.documentId}`).waitFor()
        const renderedRows = await page.locator('[data-testid^="document-row-"]').count()
        assert.ok(renderedRows > 0 && renderedRows < fixture.documentCount, 'Only a window of catalog summaries should mount')
        await snapshot('catalog', family, width, mode)
        if (!baseline) assert.equal(await page.getByTestId('document-library-list').evaluate((node, label) => !!node.querySelector(`input[aria-label="${label}"]`), zh.documents.search), false)

        await page.getByTestId(`document-row-${fixture.documentId}`).click()
        const body = page.getByTestId('document-body')
        await body.waitFor()
        await snapshot('writer', family, width, mode)
        await body.evaluate(node => {
          globalThis.__workspaceBody = node
          globalThis.__workspaceTitle = document.querySelector('[data-testid="document-title"]')
          node.focus(); node.setSelectionRange(40, 80); node.scrollTop = 200
          node.dispatchEvent(new Event('select', { bubbles: true }))
          node.dispatchEvent(new Event('scroll', { bubbles: true }))
        })
        await page.getByTestId('document-mode-preview').click()
        await page.getByTestId('document-preview').waitFor()
        assert.equal(await body.evaluate(node => node === globalThis.__workspaceBody), true)
        await snapshot('preview', family, width, mode)
        await page.getByTestId('document-mode-edit').click()
        await page.waitForFunction(() => document.activeElement === globalThis.__workspaceBody)
        const restored = await body.evaluate(node => ({ start: node.selectionStart, end: node.selectionEnd, scroll: node.scrollTop }))
        assert.equal(restored.start, 40); assert.equal(restored.end, 80)
        assert.ok(Math.abs(restored.scroll - 200) <= 1, 'Preview preserves internal writing scroll')
        await page.getByTestId('document-origin-toggle').click()
        await page.getByTestId('document-origin').waitFor()
        await snapshot('editor-sources', family, width, mode)
        if (!baseline) {
          await page.getByTestId('document-revision-toggle').click()
          const instruction = page.getByTestId('document-revision-instruction')
          await instruction.waitFor()
          await instruction.fill('Clarify the argument, without changing the evidence.')
          await instruction.evaluate(node => { globalThis.__workspaceInstruction = node })
          await snapshot('editor-revision', family, width, mode)
          await page.getByTestId('document-storage-toggle').click()
          assert.equal(await instruction.isVisible(), false)
          await page.getByTestId('document-revision-toggle').click()
          assert.equal(await instruction.evaluate(node => node === globalThis.__workspaceInstruction), true)
          assert.equal(await instruction.inputValue(), 'Clarify the argument, without changing the evidence.')
          await page.getByTestId('document-context-close').click()
          if (width >= 1000 && !captureOnly) {
            await page.setViewportSize({ width: 780, height: 900 })
            await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="document-workspace"]')).flexDirection === 'column')
            assert.equal(await body.evaluate(node => node === globalThis.__workspaceBody), true)
            assert.equal(await page.getByTestId('document-title').evaluate(node => node === globalThis.__workspaceTitle), true)
            await page.setViewportSize({ width, height: 900 })
          }
          results.checks.push({ family, width, mode, name: 'writing-preview-context-preserve-inputs-and-selection', restored })
        }
        if (!baseline && !captureOnly) {
          await body.fill(fixture.body + '\n\nAn explicitly saved QA edit.')
          await page.getByRole('button', { name: zh.common.save, exact: true }).click()
          await page.getByTestId('document-save-status').filter({ hasText: zh.documents.saved }).waitFor()
          assert.equal(await body.evaluate(node => node === globalThis.__workspaceBody), true)
        }
        await page.getByRole('button', { name: zh.documents.title, exact: true }).click()
        await page.getByTestId('document-library-count').waitFor()
        if (!baseline && !captureOnly) {
          await page.getByTestId('document-sort-title').click()
          await page.getByRole('textbox', { name: zh.documents.search }).fill('Notebook')
          const catalog = page.getByTestId('document-library-list')
          await catalog.evaluate(node => { node.scrollTop = 1100; node.dispatchEvent(new Event('scroll', { bubbles: true })) })
          await page.waitForTimeout(200)
          const before = await catalog.evaluate(node => node.scrollTop)
          assert.ok(before > 500)
          const id = await page.locator('[data-testid^="document-row-"]').evaluateAll(nodes => {
            const visible = nodes.filter(node => { const box = node.getBoundingClientRect(); return box.top > 240 && box.bottom < innerHeight - 40 })
            return visible[1]?.dataset.testid
          })
          assert.ok(id, 'A visible summary is required for the return check')
          await page.getByTestId(id).click()
          await page.getByTestId('document-body').waitFor()
          await page.getByRole('button', { name: zh.documents.title, exact: true }).click()
          await page.getByTestId('document-library-catalog').waitFor()
          await page.waitForTimeout(250)
          const after = await page.getByTestId('document-library-list').evaluate(node => node.scrollTop)
          assert.ok(Math.abs(after - before) <= 2, `Catalog return moved from ${before} to ${after}`)
          assert.equal(await page.getByRole('textbox', { name: zh.documents.search }).inputValue(), 'Notebook')
          assert.equal(await page.getByTestId('document-sort-title').getAttribute('aria-checked'), 'true')
          assert.equal(await page.getByTestId(id).getAttribute('aria-selected'), 'true')
          results.checks.push({ family, width, mode, name: 'catalog-restores-query-sort-selected-summary-and-measured-scroll', before, after, renderedRows })
        }

        await navigate(`/source?conversationId=${fixture.conversationId}&messageId=${fixture.messageId}&citationId=${fixture.citations.at(-1).id}`)
        await page.getByText(zh.source.previewUnsupportedWebMessage, { exact: true }).waitFor()
        await snapshot('source-web', family, width, mode)
        const selectedUrl = page.url()
        await openPicker()
        await page.getByTestId(`source-citation-${fixture.citations.length - 1}`).waitFor()
        assert.equal(page.url(), selectedUrl, 'Opening the picker cannot select or read another source')
        await snapshot('source-picker', family, width, mode)
        await page.getByTestId('source-citation-0').click()
        await page.getByTestId('canonical-source-reader').waitFor()
        await page.getByText(fixture.sourceDocument.chunks[1], { exact: true }).waitFor()
        assert.equal(new URL(page.url()).searchParams.get('citationId'), fixture.localCitation.id)
        await snapshot('source-local', family, width, mode)
        await page.getByRole('button', { name: zh.source.showAllSavedSections.replace('{{count}}', '3'), exact: true }).click()
        await page.getByText(fixture.sourceDocument.chunks[0], { exact: true }).waitFor()
        results.checks.push({ family, width, mode, name: 'source-picker-is-passive-and-explicit-selection-loads-exact-retained-source' })
        console.log(JSON.stringify({ stage: `${family}/${width}/${mode}`, pages: results.pages.length, checks: results.checks.length }))
      } catch (error) {
        if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
        throw error
      } finally { await context.close() }
    }
    assert.deepEqual(results.errors, [], 'No runtime page errors')
    assert.deepEqual(results.blockedRequests, [], 'No attempted external provider or source requests')
    results.passed = true
  } catch (error) {
    results.failure = { stage, message: error.message }
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
    throw error
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
  return { output, passed: results.passed, pages: results.pages.length, checks: results.checks.length, externalRequests: results.blockedRequests.length }
}

module.exports = { runTaskWorkspaceWebChecks }
if (require.main === module) {
  const args = process.argv.slice(2)
  const option = name => args.includes(name) ? path.resolve(root, args[args.indexOf(name) + 1]) : undefined
  runTaskWorkspaceWebChecks({
    webRoot: option('--web-root'), fixturesRoot: option('--fixtures'), output: option('--output'),
    baseline: args.includes('--baseline'), probe: args.includes('--probe'), captureOnly: args.includes('--capture-only'),
    entryOnly: args.includes('--entry-only'),
  }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
