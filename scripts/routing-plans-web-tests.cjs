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
const output = path.resolve(root, option('--output', `test-evidence/routing-plans-2026-11-06/browser-${Date.now()}`))
const webRoot = path.resolve(root, option('--web-root', 'test-evidence/routing-plans-2026-11-06/web'))
for (const target of [output, webRoot]) assert.ok(target.startsWith(root + path.sep), 'Use workspace exports and disposable evidence')
assert.ok(!fs.existsSync(output), 'Preserve prior evidence; use a fresh output directory')
fs.mkdirSync(output, { recursive: true })
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.ico': 'image/x-icon' }
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  let file = path.resolve(webRoot, '.' + pathname)
  if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(webRoot, 'index.html')
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(response)
})
const providers = ['a', 'b'].map((id, index) => ({ id, name: index ? '备用连接 B' : '首选连接 A', type: 'openai-compatible', presetId: 'custom-endpoint',
  wireProtocol: 'openai-compatible', baseUrl: `https://${id}.fixture.invalid/v1`, enabled: true, apiKey: '', models: ['gpt-4o-mini'], manualModels: ['gpt-4o-mini'], lastModelSyncStatus: 'ok' }))
const results = { webRoot, isolatedBrowserData: true, nativeAcceptance: false, liveProviderRequests: 0, pages: [], pageErrors: [], blockedExternalHosts: [] }

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const families = args.includes('--matrix') ? worklist.families : ['minimal']
    const modes = args.includes('--matrix') ? worklist.modes : ['light']
    for (const family of families) for (const mode of modes) for (const width of [390, 1280, 320]) {
      const name = `${family}-${mode}-${width}`
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: mode })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
        results.blockedExternalHosts.push(url.hostname)
        return route.abort()
      })
      await context.addInitScript(({ providers, family, mode }) => {
        if (localStorage.getItem('routing-fixture')) return
        localStorage.setItem('routing-fixture', '1')
        localStorage.setItem('@islemind/settings', JSON.stringify({ theme: mode, themeId: family, language: 'zh-CN',
          defaultProvider: 'a', autoUpdateCheckEnabled: false, backgroundMotion: 'static', webSearchEnabled: false, searchProvider: 'off', modelRoutingPlans: [] }))
        localStorage.setItem('@islemind/language-source', JSON.stringify('user'))
        localStorage.setItem('@islemind/providers', JSON.stringify(providers))
      }, { providers, family, mode })
      const page = await context.newPage()
      page.on('pageerror', error => results.pageErrors.push({ family, mode, width, message: error.message }))
      try {
        await page.goto(origin + '/settings/routing', { waitUntil: 'domcontentloaded' })
        await page.getByTestId('routing-add').waitFor({ timeout: 60000 })
        await page.waitForFunction(({ family, mode }) => document.documentElement.dataset.themeId === family
          && document.documentElement.dataset.themeMode === mode, { family, mode })
        await page.getByTestId('routing-add').click()
        await page.getByTestId('routing-name').fill('稳定研究')
        await page.getByTestId('routing-mode-fallback').press('Home')
        assert.equal(await page.getByTestId('routing-mode-fixed').getAttribute('aria-checked'), 'true')
        await page.getByTestId('routing-mode-fixed').press('End')
        assert.equal(await page.getByTestId('routing-mode-fallback').getAttribute('aria-checked'), 'true')
        await page.getByTestId('routing-choose-primary').click()
        await page.getByTestId('routing-target-a-gpt-4o-mini').click()
        await page.getByTestId('routing-choose-backup').click()
        await page.getByTestId('routing-target-b-gpt-4o-mini').click()
        await page.getByTestId('routing-consent-ask').press('End')
        assert.equal(await page.getByTestId('routing-consent-allow').getAttribute('aria-checked'), 'true')
        await page.getByTestId('routing-consent-allow').press('Home')
        assert.equal(await page.getByTestId('routing-consent-ask').getAttribute('aria-checked'), 'true')
        await page.getByTestId('routing-preview').scrollIntoViewIfNeeded()
        await page.screenshot({ path: path.join(output, `editor-${name}.png`), fullPage: true })
        await page.getByTestId('routing-save').click()
        await page.getByTestId('routing-add').waitFor()
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).modelRoutingPlans)
        assert.equal(saved[0].name, '稳定研究')
        assert.equal(saved[0].backup.providerId, 'b')
        assert.equal(saved[0].crossProvider, 'ask')
        assert.deepEqual(saved[0].primary, { providerId: 'a', model: 'gpt-4o-mini' })
        assert.deepEqual(saved[0].backup, { providerId: 'b', model: 'gpt-4o-mini' })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.getByTestId(`routing-saved-${saved[0].id}`).waitFor()
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        assert.equal(overflow, false)
        await page.screenshot({ path: path.join(output, `saved-${name}.png`), fullPage: true })
        await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
        // Open the setup model selector, then inspect the saved plan in its real menu.
        await page.getByTestId('chat-model-selector').waitFor({ timeout: 30000 })
        await page.getByTestId('chat-model-selector').click()
        await page.getByText('稳定研究', { exact: true }).click()
        await page.waitForFunction(() => document.querySelector('[data-testid="chat-model-selector"]')?.getAttribute('aria-label')?.includes('稳定研究'))
        await page.getByTestId('chat-model-selector').click()
        await page.getByRole('button', { name: zh.chat.aiConfiguration, exact: true }).click()
        await page.getByTestId('chat-routing-plans').waitFor()
        await page.getByText(zh.routing.snapshotHint, { exact: true }).waitFor()
        await page.screenshot({ path: path.join(output, `selected-${name}.png`), fullPage: true })
        results.pages.push({ family, mode, width, save: true, reload: true, select: true, scopeHint: true, keyboard: true, overflow })
      } catch (error) {
        fs.writeFileSync(path.join(output, `failure-props-${name}.json`), JSON.stringify(await page.evaluate(() => {
          const element = document.querySelector('[data-testid="chat-model-selector"]')
          if (!element) return {}
          let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber'))]
          const found = []
          while (fiber) {
            const props = fiber.memoizedProps
            if (props?.conversation) found.push({ component: fiber.type?.name, conversation: { id: props.conversation.id, model: props.conversation.model, routingPlan: props.conversation.routingPlan } })
            fiber = fiber.return
          }
          return { label: element.getAttribute('aria-label'), text: element.textContent, found }
        }), null, 2))
        await page.screenshot({ path: path.join(output, `failure-${name}.png`), fullPage: true })
        fs.writeFileSync(path.join(output, `failure-${name}.txt`), await page.locator('body').innerText())
        throw error
      } finally { await context.close() }
    }
    assert.deepEqual(results.pageErrors, [])
    assert.deepEqual(results.blockedExternalHosts, [])
    console.log(JSON.stringify({ cases: results.pages.length, errors: results.pageErrors.length, externalRequests: results.blockedExternalHosts.length }))
  } finally {
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2))
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close() })
