const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { parse } = require('@babel/parser')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')
const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidence = 'test-evidence/qa/islemind-connection-references-20261106'
const webRoot = path.resolve(root, option('--web-root', `${evidence}/web-i1`))
const fixtureRoot = path.resolve(root, option('--fixtures', `${evidence}/fixture-i1`))
const out = path.resolve(root, option('--out', `${evidence}/views-i1`))
const families = option('--families', 'minimal,monet,material,liquid-glass,animal-island-ui').split(',')
const modes = option('--modes', 'light,dark').split(',')
const widths = option('--widths', '320,390,960').split(',').map(Number)
assert(families.every(value => ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'].includes(value)))
assert(modes.every(value => ['light', 'dark'].includes(value)) && widths.every(value => [320, 390, 960].includes(value)))
for (const target of [webRoot, fixtureRoot, out]) assert(target.startsWith(root + path.sep), 'Use workspace evidence')
assert(!fs.existsSync(out), 'Preserve previous evidence')
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
assert(fixture.synthetic && !fixture.externalServicesUsed && fixture.conversations.length === 81)
fs.mkdirSync(out, { recursive: true })
const bundles = path.join(webRoot, '_expo/static/js/web')
const worker = fs.readdirSync(bundles).find(file => /^worker-.*\.js$/.test(file))
const actionChunk = fs.readdirSync(bundles).find(file => /^settingsActionCommand-.*\.js$/.test(file))
assert(worker && actionChunk)
const definitions = new Map()
function definitionsIn(file) {
  if (!definitions.has(file)) definitions.set(file, parse(fs.readFileSync(path.join(bundles, file), 'utf8')).program.body
    .filter(node => node.type === 'ExpressionStatement' && node.expression?.callee?.name === '__d').map(node => node.expression))
  return definitions.get(file)
}
const actionDefinition = definitionsIn(actionChunk)[0]
const actionModule = actionDefinition.arguments[1].value
const storeModule = actionDefinition.arguments[2].properties.find(property => String(property.key.value ?? property.key.name) === '2').value.value
function ownerExport(name) {
  for (const file of fs.readdirSync(bundles).filter(file => file.endsWith('.js') && !file.startsWith('worker-'))) {
    if (!fs.readFileSync(path.join(bundles, file), 'utf8').includes(`.${name}=`)) continue
    for (const definition of definitionsIn(file)) {
      const factory = definition.arguments[0]
      const exported = factory.params[5]?.name
      const body = fs.readFileSync(path.join(bundles, file), 'utf8').slice(factory.start, factory.end)
      if (exported && new RegExp(`\\b${exported.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.${name}=`).test(body)) {
        return { file, module: definition.arguments[1].value }
      }
    }
  }
  throw Error(`Missing compiled owner export: ${name}`)
}
const routerOwner = ownerExport('router')
const results = {
  schema: 'islemind.connection-references-web-evidence.v1', synthetic: true, nativeAcceptance: false,
  liveProviderRequests: 0, realCapabilityExecutions: 0, isolatedBrowserData: true,
  pages: [], checks: [], errors: [], blockedExternalHosts: [],
  fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'))).digest('hex'),
  ownerTriggers: { actionChunk, actionModule, storeModule, router: routerOwner },
}
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  if (pathname === '/_qa/seed') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Isolated connection references</title>'); return }
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
  walk(webRoot); return hash.digest('hex')
}
async function seed(page, origin, family, mode) {
  await page.goto(origin + '/_qa/seed')
  await page.evaluate(async ({ worker, fixture, family, mode }) => {
    const bytes = new Uint8Array(await (await fetch('/_qa/fixture.sqlite')).arrayBuffer())
    const dbWorker = new Worker(`/_expo/static/js/web/${worker}`)
    let id = 0
    const pending = new Map()
    dbWorker.onmessage = ({ data }) => {
      const operation = pending.get(data.id)
      if (!operation) return
      pending.delete(data.id); clearTimeout(operation.timer)
      data.error ? operation.reject(Error(data.error.message ?? data.error)) : operation.resolve(data.result)
    }
    const invoke = (type, data) => new Promise((resolve, reject) => {
      const sequence = ++id
      const timer = setTimeout(() => { pending.delete(sequence); reject(Error(`Fixture worker timeout: ${type}`)) }, 15000)
      pending.set(sequence, { timer, resolve, reject }); dbWorker.postMessage({ id: sequence, isSync: false, type, data })
    })
    try {
      await invoke('open', { nativeDatabaseId: 1, databasePath: ':memory:', options: {}, serializedData: bytes })
      await invoke('open', { nativeDatabaseId: 2, databasePath: './islemind-context.db', options: { useNewConnection: true } })
      await invoke('backupDatabase', { destNativeDatabaseId: 2, destDatabaseName: 'main', sourceNativeDatabaseId: 1, sourceDatabaseName: 'main' })
      await invoke('close', { nativeDatabaseId: 1 }); await invoke('close', { nativeDatabaseId: 2 })
    } finally { dbWorker.terminate() }
    localStorage.setItem('@islemind/settings', JSON.stringify({ ...fixture.settings, themeId: family, theme: mode }))
    localStorage.setItem('@islemind/providers', JSON.stringify(fixture.providers))
    localStorage.setItem('@islemind/skills', JSON.stringify(fixture.skills))
    localStorage.setItem('@islemind/mcp-servers', JSON.stringify(fixture.mcpServers))
    localStorage.setItem('@islemind/language-source', JSON.stringify('user'))
  }, { worker, fixture, family, mode })
}
async function owners(page, origin) {
  await page.addScriptTag({ url: `${origin}/_expo/static/js/web/${actionChunk}` })
  await page.evaluate(({ actionModule, storeModule, routerModule }) => {
    if (location.hostname !== '127.0.0.1') throw Error('Qualification must use the isolated origin')
    const store = globalThis.__r(storeModule).useSettingsStore
    if (!store?.getState().providers.every(provider => provider.id.startsWith('scene-') && provider.baseUrl.endsWith('.fixture.invalid/v1')))
      throw Error('The synthetic catalog must be present')
    globalThis.__referenceThemeCommand = globalThis.__r(actionModule).executeSettingsAction
    globalThis.__referenceRouter = globalThis.__r(routerModule).router
    if (typeof globalThis.__referenceRouter?.push !== 'function') throw Error('The actual router must be present')
  }, { actionModule, storeModule, routerModule: routerOwner.module })
}
async function databaseRows(page, source) {
  return page.evaluate(async source => {
    if (!/^SELECT\b/i.test(source)) throw Error('Evidence reads are SELECT only')
    const { worker, nativeDatabaseId } = globalThis.__referenceDatabaseWorker
    const nativeStatementId = --globalThis.__referenceProbeSequence
    const invoke = (type, data) => new Promise((resolve, reject) => {
      const id = --globalThis.__referenceProbeSequence
      const timer = setTimeout(() => { worker.removeEventListener('message', receive); reject(Error(`SQLite evidence timeout: ${type}`)) }, 15000)
      function receive({ data }) {
        if (data.id !== id) return
        clearTimeout(timer); worker.removeEventListener('message', receive)
        data.error ? reject(Error(data.error.message ?? data.error)) : resolve(data.result)
      }
      worker.addEventListener('message', receive); worker.postMessage({ id, isSync: false, type, data })
    })
    await invoke('prepare', { nativeDatabaseId, nativeStatementId, source })
    try {
      const names = await invoke('getColumnNames', { nativeStatementId })
      const rows = await invoke('getAll', { nativeDatabaseId, nativeStatementId })
      return rows.map(row => Object.fromEntries(names.map((name, index) => [name, row[index]])))
    } finally { await invoke('finalize', { nativeDatabaseId, nativeStatementId }) }
  }, source)
}
async function capture(page, identity, view) {
  await page.evaluate(() => document.fonts.ready)
  if (['conversation', 'older-conversation'].includes(view)) {
    await page.waitForFunction(() => {
      const banner = document.querySelector('[data-testid="chat-provider-health-banner"]')
      const message = [...document.querySelectorAll('[dir="auto"]')].find(node => /^保留原样的第 \d+ 条历史内容。$/.test(node.textContent ?? ''))
      if (!banner || !message) return false
      const messageRect = message.getBoundingClientRect(), bannerRect = banner.getBoundingClientRect()
      return messageRect.top >= bannerRect.bottom + 4 && messageRect.bottom <= innerHeight
    })
  }
  const measured = await page.evaluate(() => {
    const visible = element => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || node.getAttribute('aria-hidden') === 'true') return false
      }
      return true
    }
    const overflow = [...document.querySelectorAll('input,button,[role="button"],[role="radio"],[role="tab"]')].filter(visible).flatMap(control => {
      const rect = control.getBoundingClientRect()
      return rect.width && (rect.left < -2 || rect.right > innerWidth + 2)
        ? [{ label: (control.getAttribute('aria-label') || control.textContent || '').slice(0, 100), left: rect.left, right: rect.right }] : []
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
const countLabel = (kind, count) => zh.connectionReferences.count[kind].replace('{{count}}', count)
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
      await context.addInitScript(() => {
        const post = Worker.prototype.postMessage
        const statements = new Map()
        globalThis.__referenceProbeSequence = -10000
        globalThis.__referenceSqlReads = []
        Worker.prototype.postMessage = function (message, ...values) {
          if (message.type === 'open' && /islemind-context\.db$/.test(message.data?.databasePath))
            globalThis.__referenceDatabaseWorker = { worker: this, nativeDatabaseId: message.data.nativeDatabaseId }
          if (message.type === 'prepare') statements.set(message.data.nativeStatementId, message.data.source)
          const sql = statements.get(message.data?.nativeStatementId) ?? ''
          if (['getAll', 'run', 'step'].includes(message.type) && sql) globalThis.__referenceSqlReads.push(sql)
          if (globalThis.__referenceFailReads && ['getAll', 'run', 'step'].includes(message.type) && /AS referenceJson/.test(sql)) {
            queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: 'Synthetic reference metadata read failure' } })))
            return
          }
          return post.call(this, message, ...values)
        }
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      let stage = 'seed'
      const goProvider = async id => {
        await page.goto(origin + `/settings/providers?providerId=${id}&tab=connection`, { waitUntil: 'networkidle' })
        await page.getByTestId('provider-references-toggle').waitFor()
      }
      const openReferences = async id => {
        await page.getByTestId('provider-references-toggle').click()
        await page.getByTestId('provider-references-routing').waitFor()
        for (const [kind, count] of Object.entries(fixture.expected[id])) {
          if (count) assert((await page.getByTestId(`provider-references-${kind}`).innerText()).includes(countLabel(kind, count)))
        }
        assert((await page.getByTestId('provider-references-report').innerText()).includes(zh.connectionReferences.inspected.replace('{{count}}', 81).replace('{{drafts}}', 0)))
      }
      try {
        await seed(page, origin, family, mode)
        stage = 'closed provider reference disclosure'
        await goProvider('scene-a')
        assert.equal(await page.getByTestId('provider-references-report').count(), 0)
        await capture(page, identity, 'closed')
        stage = 'exact references and metadata-only reads'
        await page.evaluate(() => { globalThis.__referenceSqlReads = [] })
        await openReferences('scene-a')
        const reads = await page.evaluate(() => globalThis.__referenceSqlReads)
        assert(reads.some(sql => /AS referenceJson/.test(sql)))
        assert(!reads.some(sql => /conversation_message_records|systemPrompt|skillVariables/.test(sql)))
        await page.getByTestId('provider-references-toggle').scrollIntoViewIfNeeded()
        await capture(page, identity, 'references')
        results.checks.push({ ...identity, check: '41 conversation references include an older backup outside the first 40 rows; on-demand SQL selects metadata only' })
        if (width === 390) {
          await page.getByTestId('provider-references-refresh').scrollIntoViewIfNeeded()
          await capture(page, identity, 'coverage')
        }
        stage = 'exact routing reference'
        await page.getByTestId('provider-reference-routing-scene-route').click()
        await page.getByTestId('routing-name').waitFor()
        assert.equal(await page.getByTestId('routing-name').inputValue(), '研究主备')
        await capture(page, identity, 'routing-editor')
        if (width === 390) {
          await owners(page, origin)
          const input = page.getByTestId('routing-name')
          await input.fill('保留的路由草稿')
          await input.evaluate(node => { globalThis.__referenceRetainedInput = node; node.focus(); node.setSelectionRange(1, 3) })
          const alternate = family === 'minimal' ? 'monet' : 'minimal'
          assert.equal((await page.evaluate(async family => globalThis.__referenceThemeCommand({ name: 'set_theme_family', arguments: { family }, source: 'local-intent' }), alternate)).ok, true)
          await page.waitForFunction(family => document.documentElement.dataset.themeId === family, alternate)
          assert.equal(await input.evaluate(node => node === globalThis.__referenceRetainedInput && document.activeElement === node && node.value === '保留的路由草稿' && node.selectionStart === 1), true)
          assert.equal((await page.evaluate(async family => globalThis.__referenceThemeCommand({ name: 'set_theme_family', arguments: { family }, source: 'local-intent' }), family)).ok, true)
          await page.waitForFunction(family => document.documentElement.dataset.themeId === family, family)
          results.checks.push({ ...identity, check: 'actual Settings theme command preserves route draft, DOM input, focus and selection' })
        }
        stage = 'backup roles and independent scene reference'
        await goProvider('scene-b'); await openReferences('scene-b')
        await page.getByTestId('provider-references-routing').scrollIntoViewIfNeeded()
        await capture(page, identity, 'backup-roles')
        stage = 'older conversation reference outside the loaded page'
        await page.getByTestId('provider-reference-conversation-scene-history-040').click()
        await page.getByTestId('chat-model-selector').waitFor()
        await page.getByText('保留原样的第 41 条历史内容。', { exact: true }).waitFor()
        await capture(page, identity, 'older-conversation')
        assert.deepEqual(await databaseRows(page, 'SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal'), fixture.historicalMessageBytes)
        results.checks.push({ ...identity, check: 'an exact older conversation reference outside the 40-row page loads its own history without rewriting it' })
        await goProvider('scene-b'); await openReferences('scene-b')
        await page.getByTestId('provider-reference-scene-scene-research').click()
        await page.getByTestId('scene-name').waitFor()
        assert.equal(await page.getByTestId('scene-name').inputValue(), '资料研究')
        await capture(page, identity, 'scene-editor')
        stage = 'conversation reference without execution'
        await goProvider('scene-a'); await openReferences('scene-a')
        await page.getByTestId('provider-reference-conversation-scene-existing').click()
        await page.getByTestId('chat-model-selector').waitFor()
        await page.getByText('保留原样的第 1 条历史内容。', { exact: true }).waitFor()
        await capture(page, identity, 'conversation')
        assert.deepEqual(await databaseRows(page, 'SELECT messageJson FROM conversation_message_records ORDER BY conversationId, ordinal'), fixture.historicalMessageBytes)
        results.checks.push({ ...identity, check: 'exact route, copied scene and conversation navigation; historical JSON bytes remain unchanged' })
        if (width === 390) {
          stage = 'reference read failure and retry'
          await goProvider('scene-a')
          await page.evaluate(() => { globalThis.__referenceFailReads = true })
          await page.getByTestId('provider-references-toggle').click()
          await page.getByText(zh.connectionReferences.loadFailed, { exact: true }).waitFor()
          assert.equal(await page.getByText(zh.connectionReferences.none, { exact: true }).count(), 0)
          await capture(page, identity, 'read-failure')
          await page.evaluate(() => { globalThis.__referenceFailReads = false })
          await page.getByTestId('provider-references-refresh').click()
          await page.getByTestId('provider-references-routing').waitFor()
          assert((await page.getByTestId('provider-references-conversation').innerText()).includes(countLabel('conversation', 41)))
          results.checks.push({ ...identity, check: 'real Expo SQLite read failure is shown separately from empty data; explicit retry succeeds' })
          for (const kind of ['all', 'invalid', 'selected']) {
            stage = `delete ${kind} impact`
            await page.goto(origin + '/settings/providers', { waitUntil: 'networkidle' })
            await page.getByRole('button', { name: zh.providerSettings.manageConnections, exact: true }).click()
            if (kind === 'selected') {
              await page.getByRole('button', { name: zh.providerSettings.selectionMode, exact: true }).click()
              await page.getByRole('checkbox', { name: `${zh.providerSettings.selectProvider} ${fixture.providers[0].name}`, exact: true }).click()
              await page.getByRole('button', { name: zh.providerSettings.deleteSelected, exact: true }).click()
            } else await page.getByRole('button', { name: kind === 'all' ? zh.providerSettings.clearAll : zh.providerSettings.clearInvalid, exact: true }).click()
            await page.getByText(zh.connectionReferences.keptAfterDelete, { exact: false }).waitFor()
            const expected = fixture.expected[kind === 'selected' ? 'scene-a' : 'all']
            const body = await page.locator('body').innerText()
            for (const [group, count] of Object.entries(expected)) if (count) assert(body.includes(countLabel(group, count)))
            await capture(page, identity, `delete-${kind}`)
            await page.getByRole('button', { name: zh.common.cancel, exact: true }).last().click()
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/providers')).length), 2)
          }
          results.checks.push({ ...identity, check: 'all, invalid and selected deletion confirmations show object counts and coverage; cancellation leaves providers intact' })
          stage = 'deleted reference destinations'
          await page.goto(origin + '/settings/routing?planId=scene-deleted', { waitUntil: 'networkidle' })
          await page.getByText(zh.connectionReferences.missing, { exact: true }).waitFor()
          assert.equal(await page.getByTestId('routing-editor').count(), 0)
          await capture(page, identity, 'missing-route')
          await page.goto(origin + '/settings/scenes?planId=scene-deleted', { waitUntil: 'networkidle' })
          await page.getByText(zh.connectionReferences.missing, { exact: true }).waitFor()
          assert.equal(await page.getByTestId('scene-editor').count(), 0)
          await capture(page, identity, 'missing-scene')
          results.checks.push({ ...identity, check: 'deleted template destinations report absence without creating or applying a replacement' })
          stage = 'unsent draft is a separate local reference'
          // A keep-model scene cannot supply a new draft's missing target.
          // Choose its model explicitly through the existing editor first.
          await page.getByTestId('scene-edit-scene-writing').click()
          await page.getByTestId('scene-choose-model').click()
          await page.getByTestId('scene-model-scene-a-gpt-4o-mini').click()
          await page.getByTestId('scene-save').click()
          await page.getByText(zh.scenes.saved, { exact: true }).waitFor()
          await page.getByTestId('scene-saved-scene-writing').click()
          const target = page.getByTestId('scene-target')
          const targetButton = target.getByRole('button').first()
          await (await targetButton.count() ? targetButton : target).click()
          await page.getByText(zh.scenes.newConversation, { exact: true }).last().click()
          await page.getByTestId('scene-preview').click()
          await page.getByTestId('scene-application-preview').waitFor()
          await page.getByTestId('scene-apply').click()
          await page.getByTestId('scene-applied').waitFor()
          await page.getByTestId('scene-open-conversation').click()
          await page.getByTestId('chat-model-selector').waitFor()
          await owners(page, origin)
          await page.evaluate(() => globalThis.__referenceRouter.push('/settings/providers?providerId=scene-a&tab=connection'))
          await page.getByTestId('provider-references-toggle').waitFor()
          await page.getByTestId('provider-references-toggle').click()
          await page.getByTestId('provider-references-conversation').waitFor()
          const report = await page.getByTestId('provider-references-report').innerText()
          assert(report.includes(countLabel('conversation', 42)) && report.includes(zh.connectionReferences.draft))
          assert(report.includes(zh.connectionReferences.inspected.replace('{{count}}', 81).replace('{{drafts}}', 1)))
          assert.equal((await databaseRows(page, 'SELECT COUNT(*) AS count FROM conversation_records'))[0].count, 81)
          await capture(page, identity, 'unsent-draft')
          results.checks.push({ ...identity, check: 'a real scene application creates an unsent local draft; reference count increases without writing a conversation record' })
        }
        assert.deepEqual(pageErrors, [])
        results.checks.push({ ...identity, check: 'no page errors or external requests', pageErrors })
        console.log(JSON.stringify({ ...identity, passed: true, pages: results.pages.filter(item => item.family === family && item.mode === mode && item.width === width).length }))
      } catch (error) {
        const screenshot = `${family}-${mode}-${width}-failure.png`
        await page.screenshot({ path: path.join(out, screenshot), fullPage: true }).catch(() => undefined)
        results.errors.push({ ...identity, stage, message: error.stack, pageErrors, screenshot })
        console.error(JSON.stringify({ ...identity, stage, error: error.message }))
      } finally { await context.close() }
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
  results.passed = results.errors.length === 0 && results.blockedExternalHosts.length === 0 && results.exportHash === exportHash()
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
  assert(results.passed, 'Connection reference Web evidence failed')
  console.log(JSON.stringify({ passed: true, pages: results.pages.length, checks: results.checks.length, exportHash: results.exportHash }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
