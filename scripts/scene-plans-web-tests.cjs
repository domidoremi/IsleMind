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
const webRoot = path.resolve(root, option('--web-root', 'test-evidence/qa/islemind-scene-plans-20261106/web-h1'))
const fixtureRoot = path.resolve(root, option('--fixtures', 'test-evidence/qa/islemind-scene-plans-20261106/fixture-h2'))
const out = path.resolve(root, option('--out', 'test-evidence/qa/islemind-scene-plans-20261106/views-h1'))
const families = option('--families', 'minimal,monet,material,liquid-glass,animal-island-ui').split(',')
const modes = option('--modes', 'light,dark').split(',')
const widths = option('--widths', '320,390,960').split(',').map(Number)
assert(families.every(family => ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui'].includes(family))
  && modes.every(mode => ['light', 'dark'].includes(mode)) && widths.every(width => [320, 390, 960].includes(width)))
for (const target of [webRoot, fixtureRoot, out]) assert(target.startsWith(root + path.sep), 'Use workspace evidence')
assert(!fs.existsSync(out), 'Preserve existing evidence')
const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'))
assert(fixture.synthetic && !fixture.externalServicesUsed)
const bundles = path.join(webRoot, '_expo/static/js/web')
const worker = fs.readdirSync(bundles).find(file => /^worker-.*\.js$/.test(file))
const actionChunk = fs.readdirSync(bundles).find(file => /^settingsActionCommand-.*\.js$/.test(file))
assert(worker && actionChunk)
// Resolve the actual compiled owner command, without adding a production test hook.
const definition = parse(fs.readFileSync(path.join(bundles, actionChunk), 'utf8')).program.body
  .find(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === '__d').expression
const actionModule = definition.arguments[1].value
const storeModule = definition.arguments[2].properties.find(property => String(property.key.value ?? property.key.name) === '2').value.value
fs.mkdirSync(out, { recursive: true })
const results = { schema: 'islemind.scene-plans-web-evidence.v1', synthetic: true, nativeAcceptance: false,
  liveProviderRequests: 0, isolatedBrowserData: true, pages: [], checks: [], errors: [], blockedExternalHosts: [],
  ownerTriggers: { command: 'src/presentation/features/settings/settingsActionCommand.ts', actionChunk, actionModule, storeModule },
  fixtureSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'))).digest('hex') }
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }
  if (pathname === '/_qa/seed') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }).end('<!doctype html><title>Isolated scene records</title>'); return }
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
  await page.evaluate(async ({ worker, family, mode, fixture }) => {
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
      pending.set(sequence, { timer, resolve, reject })
      dbWorker.postMessage({ id: sequence, isSync: false, type, data })
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
  }, { worker, family, mode, fixture })
}
async function owners(page, origin) {
  await page.addScriptTag({ url: `${origin}/_expo/static/js/web/${actionChunk}` })
  await page.evaluate(({ actionModule, storeModule }) => {
    if (location.hostname !== '127.0.0.1') throw Error('Owner qualification requires the isolated origin')
    const store = globalThis.__r(storeModule).useSettingsStore
    if (!store || !store.getState().providers.every(provider => provider.id.startsWith('scene-') && provider.baseUrl.endsWith('.fixture.invalid/v1')))
      throw Error('The synthetic owner catalog must be present')
    globalThis.__sceneOwnerStore = store
    globalThis.__sceneThemeCommand = globalThis.__r(actionModule).executeSettingsAction
  }, { actionModule, storeModule })
}
async function databaseRows(page, source) {
  return page.evaluate(async source => {
    const binding = globalThis.__sceneDatabaseWorker
    if (!binding) throw Error('The actual Expo database worker must be ready')
    const { worker, nativeDatabaseId } = binding
    const nativeStatementId = --globalThis.__sceneProbeSequence
    const invoke = (type, data) => new Promise((resolve, reject) => {
      const id = --globalThis.__sceneProbeSequence
      const timer = setTimeout(() => { worker.removeEventListener('message', receive); reject(Error(`SQLite probe timeout: ${type}`)) }, 15000)
      function receive({ data }) {
        if (data.id !== id) return
        clearTimeout(timer); worker.removeEventListener('message', receive)
        data.error ? reject(Error(data.error.message ?? data.error)) : resolve(data.result)
      }
      worker.addEventListener('message', receive)
      worker.postMessage({ id, isSync: false, type, data })
    })
    await invoke('prepare', { nativeDatabaseId, nativeStatementId, source })
    try {
      const names = await invoke('getColumnNames', { nativeStatementId })
      const rows = await invoke('getAll', { nativeDatabaseId, nativeStatementId })
      return rows.map(row => Object.fromEntries(names.map((name, index) => [name, row[index]])))
    } finally { await invoke('finalize', { nativeDatabaseId, nativeStatementId }) }
  }, source)
}
const historicalRows = page => databaseRows(page, "SELECT messageJson FROM conversation_message_records WHERE conversationId = 'scene-existing' ORDER BY ordinal")
const canonical = async page => JSON.parse((await databaseRows(page, "SELECT stateJson FROM conversation_record_state WHERE conversationId = 'scene-existing'"))[0].stateJson)
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
async function openAI(page) {
  await page.getByTestId('chat-model-selector').click()
  await page.getByRole('button', { name: zh.chat.aiConfiguration, exact: true }).click()
  await page.getByTestId('chat-scene-actions').waitFor({ state: 'visible' })
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
      await context.addInitScript(() => {
        const post = Worker.prototype.postMessage
        const statements = new Map()
        globalThis.__sceneProbeSequence = -10000
        Worker.prototype.postMessage = function (message, ...values) {
          if (message.type === 'open' && /islemind-context\.db$/.test(message.data?.databasePath))
            globalThis.__sceneDatabaseWorker = { worker: this, nativeDatabaseId: message.data.nativeDatabaseId }
          if (message.type === 'prepare') statements.set(message.data.nativeStatementId, message.data.source)
          if (globalThis.__sceneFailConversationWrites && message.type === 'run'
            && /INSERT OR REPLACE INTO conversation_record_state/.test(statements.get(message.data.nativeStatementId) ?? '')) {
            globalThis.__sceneConversationFailures = (globalThis.__sceneConversationFailures ?? 0) + 1
            queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
              data: { id: message.id, error: 'Synthetic conversation transaction write failure' },
            })))
            return
          }
          return post.call(this, message, ...values)
        }
        const setItem = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {
          if (key === '@islemind/settings' && globalThis.__sceneFailSettings) throw Error('Synthetic settings write failure')
          return setItem.call(this, key, value)
        }
      })
      const page = await context.newPage()
      page.setDefaultTimeout(15000)
      const pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message))
      let stage = 'seed'
      const goScenes = async () => {
        await page.goto(origin + '/settings/scenes?conversationId=scene-existing', { waitUntil: 'networkidle' })
        await page.getByTestId('scene-saved-scene-writing').waitFor()
      }
      try {
        await seed(page, origin, family, mode)
        stage = 'settings search'
        await page.goto(origin + '/settings', { waitUntil: 'networkidle' })
        await page.getByRole('textbox', { name: zh.settings.search, exact: true }).fill(zh.scenes.title)
        await page.getByTestId('settings-search-results').getByText(zh.scenes.title, { exact: true }).click()
        await page.getByTestId('scene-plans-screen').waitFor()
        await capture(page, identity, 'list')
        stage = 'editor and local draft'
        await page.getByTestId('settings-task-edit').click()
        await page.getByTestId('scene-name').fill('轻量研究')
        await page.getByTestId('scene-description').fill('保存自己的简洁研究配置。')
        await page.getByTestId('scene-model-mode-routing').click()
        await page.getByTestId('scene-prompt-mode-replace').click()
        await page.getByTestId('scene-system-prompt').fill('保持简洁，先陈述结论，再补充依据。')
        await capture(page, identity, 'editor-conversation')
        await page.getByTestId('scene-editor-sections-resources').click()
        await page.getByTestId('scene-enabledTools-mode-none').click()
        await page.getByTestId('scene-knowledgeSources-mode-none').click()
        await capture(page, identity, 'editor-resources')
        await page.getByTestId('scene-editor-sections-context').click()
        const custom = page.getByTestId('scene-context-mode-custom')
        await custom.press('Home')
        assert.equal(await page.getByTestId('scene-context-mode-keep').getAttribute('aria-checked'), 'true')
        await page.getByTestId('scene-context-mode-keep').press('End')
        await page.getByTestId('scene-threshold').fill('.')
        assert.equal(await page.getByTestId('scene-save').isDisabled(), true)
        await page.getByTestId('scene-threshold').fill('65')
        await page.getByTestId('scene-declaration-mode-auto').click()
        await capture(page, identity, 'editor-context')
        stage = 'real theme command and focus retention'
        await owners(page, origin)
        const input = page.getByTestId('scene-threshold')
        await input.focus()
        await input.evaluate(node => { globalThis.__sceneRetainedInput = node; node.setSelectionRange(1, 2) })
        const switched = family === 'minimal' ? 'monet' : 'minimal'
        assert.equal((await page.evaluate(async family => globalThis.__sceneThemeCommand({
          name: 'set_theme_family', arguments: { family }, source: 'local-intent',
        }), switched)).ok, true)
        await page.waitForFunction(family => document.documentElement.dataset.themeId === family, switched)
        assert.equal(await input.evaluate(node => node === globalThis.__sceneRetainedInput && document.activeElement === node && node.value === '65' && node.selectionStart === 1), true)
        assert.equal((await page.evaluate(async family => globalThis.__sceneThemeCommand({
          name: 'set_theme_family', arguments: { family }, source: 'local-intent',
        }), family)).ok, true)
        await page.waitForFunction(family => document.documentElement.dataset.themeId === family, family)
        await page.setViewportSize({ width: width === 320 ? 390 : 320, height: 900 })
        assert.equal(await input.evaluate(node => node === globalThis.__sceneRetainedInput && document.activeElement === node && node.value === '65'), true)
        await page.setViewportSize({ width, height: 900 })
        results.checks.push({ ...identity, check: 'real Settings theme command and width reflow retain draft input, selection and focus' })
        stage = 'settings failure and retry'
        await page.evaluate(() => { globalThis.__sceneFailSettings = true })
        await page.getByTestId('scene-save').click()
        await page.getByText(zh.scenes.saveFailed, { exact: true }).waitFor()
        assert.equal(await page.getByTestId('scene-threshold').inputValue(), '65')
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).scenePlans.some(plan => plan.name === '轻量研究')), false)
        await capture(page, identity, 'save-failure')
        await page.evaluate(() => { globalThis.__sceneFailSettings = false })
        await page.getByTestId('scene-save').click()
        await page.getByText(zh.scenes.saved, { exact: true }).waitFor()
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).scenePlans.find(plan => plan.name === '轻量研究'))
        assert.equal(saved.configuration.model.routingPlan.crossProvider, 'ask')
        assert.deepEqual(saved.configuration.enabledTools, [])
        assert.equal(saved.configuration.contextPolicy.remoteCompactThreshold, 0.65)
        await goScenes()
        await page.getByTestId(`scene-saved-${saved.id}`).waitFor()
        stage = 'preview existing conversation'
        await page.getByTestId('scene-saved-scene-research').click()
        await page.getByTestId('scene-preview').click()
        await page.getByTestId('scene-application-preview').waitFor()
        assert.equal(await page.getByTestId('scene-preview-issues').count(), 0)
        assert((await page.getByTestId('scene-change-routingPlan').innerText()).includes('备用连接 B'))
        assert((await page.getByTestId('scene-change-routingPlan').innerText()).includes(zh.routing.ask))
        assert((await page.getByTestId('scene-change-knowledgeSources').innerText()).includes('scene-document-a'))
        await page.getByTestId('scene-preview-scope').scrollIntoViewIfNeeded()
        await capture(page, identity, 'preview')
        stage = 'conversation transaction failure and retry'
        await page.evaluate(() => { globalThis.__sceneFailConversationWrites = true })
        await page.getByTestId('scene-apply').click()
        await page.getByText(zh.scenes.applyFailed, { exact: true }).waitFor()
        assert.equal((await canonical(page)).scenePlanSource, undefined)
        assert.deepEqual(await historicalRows(page), fixture.historicalMessageBytes)
        assert((await page.evaluate(() => globalThis.__sceneConversationFailures)) > 0)
        await capture(page, identity, 'apply-failure')
        await page.evaluate(() => { globalThis.__sceneFailConversationWrites = false })
        await page.getByTestId('scene-apply').click()
        await page.getByTestId('scene-applied').waitFor()
        const applied = await canonical(page)
        assert.equal(applied.scenePlanSource.id, 'scene-research')
        assert.equal(applied.routingPlan.backup.providerId, 'scene-b')
        assert.equal(applied.resourceScopeOverride.tools, 'selected')
        assert.equal(applied.toolDeclarationModeOverride, 'auto')
        assert(applied.systemPrompt.includes('IsleMind 的功能与设计'))
        assert.deepEqual(await historicalRows(page), fixture.historicalMessageBytes)
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).mcpEnabled), false)
        await capture(page, identity, 'applied')
        results.checks.push({ ...identity, check: 'search, three editor sections, keyboard, invalid threshold, explicit save/retry/reload, local preview, real SQLite rollback/retry and unchanged historical JSON bytes' })
        if (width === 390) {
          stage = 'template copy independence'
          await goScenes()
          await page.getByTestId('scene-edit-scene-research').click()
          await page.getByTestId('scene-description').fill('只更新模板，不更新已应用会话。')
          await page.getByTestId('scene-save').click()
          await page.getByText(zh.scenes.saved, { exact: true }).waitFor()
          assert.equal((await canonical(page)).scenePlanSource.revision, 1)
          stage = 'missing references'
          await page.getByTestId('scene-saved-scene-missing').click()
          await page.getByTestId('scene-preview').click()
          await page.getByTestId('scene-preview-issues').waitFor()
          assert.equal(await page.getByTestId('scene-apply').isDisabled(), true)
          await page.getByTestId('scene-preview-issues').scrollIntoViewIfNeeded()
          await capture(page, identity, 'missing-references')
          stage = 'template conflict keeps local draft'
          await goScenes(); await owners(page, origin)
          await page.getByTestId('scene-edit-scene-writing').click()
          await page.getByTestId('scene-description').fill('保留这份本地草稿。')
          await page.evaluate(async () => {
            const state = globalThis.__sceneOwnerStore.getState()
            const plan = state.settings.scenePlans.find(plan => plan.id === 'scene-writing')
            await state.saveScenePlan({ ...plan, description: '另一项本地操作已更新。' }, plan.revision)
          })
          await page.getByTestId('scene-template-conflict').waitFor()
          assert.equal(await page.getByTestId('scene-description').inputValue(), '保留这份本地草稿。')
          assert.equal(await page.getByTestId('scene-save').isDisabled(), true)
          await capture(page, identity, 'template-conflict')
          await page.getByTestId('scene-save-as-new').click()
          await page.getByTestId('scene-name').fill('另存的写作方案')
          await page.getByTestId('scene-save').click()
          await page.getByText(zh.scenes.saved, { exact: true }).waitFor()
          stage = 'explicit none and unsent draft'
          await page.getByTestId(`scene-saved-${saved.id}`).click()
          const targetSelect = page.getByTestId('scene-target')
          const targetButton = targetSelect.getByRole('button').first()
          await (await targetButton.count() ? targetButton : targetSelect).click()
          await page.getByText(zh.scenes.newConversation, { exact: true }).last().click()
          await page.getByTestId('scene-preview').click()
          await page.getByTestId('scene-application-preview').waitFor()
          assert((await page.getByTestId('scene-change-enabledTools').innerText()).includes(zh.scenes.none))
          await page.getByTestId('scene-apply').click()
          await page.getByTestId('scene-applied').waitFor()
          const idsBeforeOpen = (await databaseRows(page, 'SELECT id FROM conversation_records')).map(row => row.id)
          assert.deepEqual(idsBeforeOpen, ['scene-existing'])
          await capture(page, identity, 'new-draft')
          await page.getByTestId('scene-open-conversation').click()
          await page.getByTestId('chat-model-selector').waitFor()
          const draft = await page.getByTestId('chat-model-selector').evaluate(node => {
            let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber'))]
            while (fiber) {
              const conversation = fiber.memoizedProps?.conversation
              if (conversation) return { id: conversation.id, messages: conversation.messages.length,
                source: conversation.scenePlanSource, resources: conversation.resourceScopeOverride }
              fiber = fiber.return
            }
            throw Error('The actual chat draft must be rendered')
          })
          assert.equal(draft.source.id, saved.id); assert.equal(draft.messages, 0)
          assert.equal(draft.resources.tools, 'none'); assert.equal(draft.resources.knowledge, 'none')
          assert(!idsBeforeOpen.includes(draft.id))
          assert.equal((await databaseRows(page, 'SELECT COUNT(*) AS count FROM conversation_records'))[0].count, 1)
          results.checks.push({ ...identity, check: 'template revision leaves applied copy intact; missing references block; conflict preserves draft and Save as new; new scene creates an unsent draft without a history record' })
          stage = 'full AI shortcuts and provenance'
          await page.goto(origin + '/chat/scene-existing', { waitUntil: 'networkidle' })
          await openAI(page)
          assert((await page.getByTestId('chat-scene-source').innerText()).includes('资料研究'))
          await capture(page, identity, 'chat-shortcuts')
          await page.getByTestId('chat-scene-capture').click()
          await page.getByTestId('scene-editor').waitFor()
          assert((await page.getByTestId('scene-model-value').innerText()).includes('研究主备'))
          await capture(page, identity, 'capture-current')
          stage = 'offline help'
          await page.goto(origin + '/help/models', { waitUntil: 'networkidle' })
          await page.getByText('场景方案', { exact: true }).last().scrollIntoViewIfNeeded()
          await capture(page, identity, 'help')
          results.checks.push({ ...identity, check: 'actual full AI capture shortcut, last-applied provenance and generated offline scene help' })
        }
        assert.deepEqual(pageErrors, [])
      } catch (error) {
        results.errors.push({ ...identity, stage, error: error.message, pageErrors })
        await page.screenshot({ path: path.join(out, `failure-${family}-${mode}-${width}.png`), fullPage: true }).catch(() => {})
        fs.writeFileSync(path.join(out, `failure-${family}-${mode}-${width}.txt`), await page.locator('body').innerText().catch(() => ''))
      } finally {
        fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2))
        await context.close()
      }
      console.log(JSON.stringify({ ...identity, completed: results.checks.filter(check => check.family === family && check.mode === mode && check.width === width).length,
        errors: results.errors.filter(error => error.family === family && error.mode === mode && error.width === width).length }))
      if (args.includes('--stop-on-failure') && results.errors.length) break
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
