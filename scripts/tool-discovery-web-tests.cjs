const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const webRoot = path.resolve(root, option('--web-root', 'test-evidence/qa/islemind-tool-discovery-20261106/web-g'))
const fixtureRoot = path.resolve(root, option('--fixtures', 'test-evidence/qa/islemind-tool-discovery-20261106/fixture-g2'))
const out = path.resolve(root, option('--out', 'test-evidence/qa/islemind-tool-discovery-20261106/views-g'))
const families = option('--families', 'minimal,monet,material,liquid-glass,animal-island-ui').split(',')
const modes = option('--modes', 'light,dark').split(',')
const widths = option('--widths', '320,390,960').split(',').map(Number)
assert(families.every(family => ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'].includes(family))
  && modes.every(mode => ['light', 'dark'].includes(mode)) && widths.every(width => [320, 390, 960].includes(width)))
for (const target of [webRoot, fixtureRoot, out]) assert(target.startsWith(root + path.sep), 'Use workspace evidence')
assert(!fs.existsSync(out), 'Preserve existing evidence')
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
assert(fixture.synthetic && !fixture.externalServicesUsed)
const captured = fixture.runs.find(run => run.protocol === 'native')
const worker = fs.readdirSync(path.join(webRoot, '_expo/static/js/web')).find(file => /^worker-.*\.js$/.test(file))
assert(worker)
fs.mkdirSync(out, { recursive: true })
const results = { schema: 'islemind.tool-discovery-web-evidence.v1', synthetic: true, nativeAcceptance: false,
  liveProviderRequests: 0, isolatedBrowserData: true, pages: [], checks: [], errors: [], blockedExternalHosts: [] }
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  if (pathname === '/_qa/seed') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Isolated tool records</title>'); return }
  let file = pathname === '/_qa/fixture.sqlite' ? path.join(fixtureRoot, fixture.database) : path.resolve(webRoot, '.' + pathname)
  if (pathname !== '/_qa/fixture.sqlite' && file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) { response.writeHead(404).end(); return }
    file = path.join(webRoot, 'index.html')
  }
  response.writeHead(200, { ...headers, 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(response)
})
function exportHash() {
  const hash = crypto.createHash('sha256')
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else hash.update(path.relative(webRoot, file)).update('\0').update(fs.readFileSync(file)).update('\0')
    }
  }
  walk(webRoot)
  return hash.digest('hex')
}
async function seed(page, origin, family, mode) {
  await page.goto(origin + '/_qa/seed')
  await page.evaluate(async ({ worker, family, mode, providers }) => {
    const bytes = new Uint8Array(await (await fetch('/_qa/fixture.sqlite')).arrayBuffer())
    const dbWorker = new Worker(`/_expo/static/js/web/${worker}`)
    let id = 0
    const pending = new Map()
    dbWorker.onmessage = ({ data }) => {
      const operation = pending.get(data.id)
      if (!operation) return
      pending.delete(data.id); clearTimeout(operation.timer)
      data.error ? operation.reject(Error(data.error.message)) : operation.resolve(data.result)
    }
    const invoke = (type, data) => new Promise((resolve, reject) => {
      const sequence = ++id
      const timer = setTimeout(() => { pending.delete(sequence); reject(Error(`Fixture worker timeout: ${type}`)) }, 15000)
      pending.set(sequence, { timer, resolve, reject })
      dbWorker.postMessage({ id: sequence, isSync: false, type, data })
    })
    try {
      await invoke('open', { nativeDatabaseId: 1, databasePath: ':memory:', options: {}, serializedData: bytes })
      await invoke('open', { nativeDatabaseId: 2, databasePath: './islemind-context.db', options: { useNewConnection: true } })
      await invoke('backupDatabase', { destNativeDatabaseId: 2, destDatabaseName: 'main', sourceNativeDatabaseId: 1, sourceDatabaseName: 'main' })
      await invoke('close', { nativeDatabaseId: 1 }); await invoke('close', { nativeDatabaseId: 2 })
    } finally { dbWorker.terminate() }
    // Deliberately omit the new field: old settings must still select full.
    localStorage.setItem('@islemind/settings', JSON.stringify({ themeId: family, theme: mode, language: 'zh-CN',
      backgroundMotion: 'static', autoUpdateCheckEnabled: false, autoCheckApkUpdate: false, webSearchEnabled: false, searchProvider: 'off' }))
    localStorage.setItem('@islemind/providers', JSON.stringify(providers))
    localStorage.setItem('@islemind/language-source', JSON.stringify('user'))
  }, { worker, family, mode, providers: fixture.providers })
}
async function capture(page, identity, view) {
  await page.evaluate(() => document.fonts.ready)
  const measured = await page.evaluate(() => {
    const visible = element => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || node.getAttribute('aria-hidden') === 'true') return false
      }
      return true
    }
    const controls = [...document.querySelectorAll('input,button,[role="button"],[role="radio"],[role="tab"]')].filter(visible)
    const overflow = controls.flatMap(control => {
      const rect = control.getBoundingClientRect()
      return rect.width && (rect.left < -2 || rect.right > innerWidth + 2)
        ? [{ label: (control.getAttribute('aria-label') || control.textContent || '').slice(0, 80), left: rect.left, right: rect.right }] : []
    })
    return { family: document.documentElement.dataset.themeId, mode: document.documentElement.dataset.themeMode,
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2, overflow }
  })
  assert.equal(measured.family, identity.family); assert.equal(measured.mode, identity.mode)
  assert.equal(measured.documentOverflow, false); assert.deepEqual(measured.overflow, [])
  const screenshot = `${identity.family}-${identity.mode}-${identity.width}-${view}.png`
  await page.screenshot({ path: path.join(out, screenshot), fullPage: true })
  results.pages.push({ ...identity, view, ...measured, screenshot })
}
async function main() {
  results.exportHash = exportHash()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true })
  try {
    for (const family of families) for (const mode of modes) for (const width of widths) {
      const identity = { family, mode, width }
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: mode, reducedMotion: 'reduce' })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
        results.blockedExternalHosts.push(url.hostname); return route.abort()
      })
      const page = await context.newPage()
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      let stage = 'seed'
      try {
        await seed(page, origin, family, mode)
        stage = 'settings search'
        await page.goto(origin + '/settings', { waitUntil: 'networkidle' })
        await page.getByRole('textbox', { name: zh.settings.search, exact: true }).fill(zh.toolDeclarations.title)
        await page.getByTestId('settings-search-results').getByText(zh.toolDeclarations.title, { exact: true }).click()
        stage = 'tool editor'
        const full = page.getByTestId('settings-tool-declaration-mode-full')
        const auto = page.getByTestId('settings-tool-declaration-mode-auto')
        await full.waitFor({ state: 'visible' })
        assert.equal(await full.getAttribute('aria-checked'), 'true')
        assert.equal(await page.getByText(zh.common.loading, { exact: true }).count(), 0, 'Tool settings do not show unrelated resource loading')
        await capture(page, identity, 'editor-full')
        await full.focus(); await page.keyboard.press('End')
        assert.equal(await auto.getAttribute('aria-checked'), 'true')
        await page.keyboard.press('Home')
        assert.equal(await full.getAttribute('aria-checked'), 'true')
        await auto.click()
        const save = page.getByRole('button', { name: zh.settingsWorkspace.save, exact: true })
        await save.waitFor({ state: 'visible' })
        const storedMode = await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).toolDeclarationMode)
        assert(storedMode === undefined || storedMode === 'full')
        stage = 'save failure'
        await page.evaluate(() => {
          const original = Storage.prototype.setItem
          globalThis.__toolFixtureWriteBlocked = true
          Storage.prototype.setItem = function (key, value) {
            if (key === '@islemind/settings' && globalThis.__toolFixtureWriteBlocked) throw Error('Synthetic settings write failure')
            return original.call(this, key, value)
          }
        })
        await save.click()
        await page.getByText(zh.settingsWorkspace.saveFailed, { exact: true }).waitFor({ state: 'visible' })
        assert.equal(await auto.getAttribute('aria-checked'), 'true')
        await capture(page, identity, 'save-failure')
        await page.evaluate(() => { globalThis.__toolFixtureWriteBlocked = false })
        await save.click()
        await save.waitFor({ state: 'hidden' })
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).toolDeclarationMode), 'auto')
        await page.reload({ waitUntil: 'networkidle' })
        assert.equal(await page.getByTestId('settings-tool-declaration-mode-auto').getAttribute('aria-checked'), 'true')
        results.checks.push({ ...identity, check: 'legacy default, search route, radio keyboard, explicit save, failed write and reload' })
        stage = 'captured context record'
        await page.goto(origin + '/settings/context?conversationId=tool-discovery-native', { waitUntil: 'networkidle' })
        await page.getByTestId('chat-context-tool-declarations').waitFor({ state: 'visible' })
        const record = page.getByTestId('chat-context-tool-declarations')
        assert((await record.innerText()).includes('0 / 24'))
        assert((await record.innerText()).includes(captured.firstDeclarations.declarationChars.toLocaleString('zh-CN')))
        assert((await record.innerText()).includes(captured.firstDeclarations.fullDeclarationChars.toLocaleString('zh-CN')))
        await capture(page, identity, 'record')
        stage = 'offline help'
        await page.goto(origin + '/help/tools', { waitUntil: 'networkidle' })
        await page.getByText('工具定义与按需发现', { exact: true }).waitFor({ state: 'visible' })
        await capture(page, identity, 'help')
        assert.deepEqual(pageErrors, [])
        results.checks.push({ ...identity, check: 'real SQLite declaration receipt, separate characters, offline help' })
      } catch (error) {
        results.errors.push({ ...identity, stage, error: error.message, pageErrors })
        await page.screenshot({ path: path.join(out, `failure-${family}-${mode}-${width}.png`), fullPage: true }).catch(() => {})
      } finally {
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
        await context.close()
      }
    }
    assert.equal(exportHash(), results.exportHash)
    assert.deepEqual(results.errors, []); assert.deepEqual(results.blockedExternalHosts, [])
    console.log(JSON.stringify({ views: results.pages.length, checks: results.checks.length, errors: results.errors.length, exportHash: results.exportHash }))
  } finally {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
    await browser.close(); await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close() })
