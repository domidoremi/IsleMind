const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const worklist = require('./fixtures/worklists/complete-ui-experience-worklist.json')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const baseline = args.includes('--baseline')
const requestedRoutes = option('--routes', '')?.split(',').filter(Boolean)
const requestedWidth = Number(option('--width', 0))
assert.ok(!requestedWidth || Number.isInteger(requestedWidth) && requestedWidth >= 280 && requestedWidth <= 2560, 'Use a supported logical viewport width')
const webRoot = path.resolve(root, option('--web-root', 'test-evidence/qa/islemind-upgrade-20261106/web-after'))
const output = path.resolve(root, option('--output', 'test-evidence/qa/islemind-upgrade-20261106/visual-after'))
for (const target of [webRoot, output]) assert.ok(target.startsWith(root + path.sep), 'Use workspace exports and disposable evidence')
assert.ok(!fs.existsSync(output), 'Keep prior evidence; use a fresh output directory')
fs.mkdirSync(output, { recursive: true })
const mime = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' }
const server = http.createServer((request, response) => {
  let pathname
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname) } catch { response.writeHead(400).end(); return }
  let file = path.resolve(webRoot, '.' + pathname)
  if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) { response.writeHead(404).end(); return }
    file = path.join(webRoot, 'index.html')
  }
  response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': file.endsWith('.html') ? 'no-store' : 'public, max-age=31536000, immutable' })
  fs.createReadStream(file).pipe(response)
})
const providers = ['a', 'b'].map((id, index) => ({
  id, name: index ? '备用连接 B' : '首选连接 A', type: 'openai-compatible', presetId: 'custom-endpoint',
  wireProtocol: 'openai-compatible', baseUrl: `https://${id}.fixture.invalid/v1`, enabled: true, apiKey: '',
  models: ['gpt-4o-mini'], manualModels: ['gpt-4o-mini'], lastModelSyncStatus: 'ok',
}))
const routingPlan = { schema: 'islemind.model-routing-plan.v1', id: 'stable', name: '稳定研究',
  mode: 'fallback', primary: { providerId: 'a', model: 'gpt-4o-mini' }, backup: { providerId: 'b', model: 'gpt-4o-mini' }, crossProvider: 'ask' }
const results = { baseline, nativeAcceptance: false, isolatedBrowserData: true, liveProviderRequests: 0,
  pages: [], checks: [], errors: [], blockedExternalHosts: [] }
const guideChapters = fs.readdirSync(path.join(root, 'docs/user-guide/zh-CN'))
  .filter(file => file.endsWith('.md')).map(file => file.slice(0, -3)).sort()
const expandedRoutes = worklist.routes.flatMap(route => route === '/help/[slug]' ? guideChapters.map(slug => '/help/' + slug) : [route])
if (requestedRoutes?.length) for (const route of requestedRoutes) assert.ok(expandedRoutes.includes(route), 'Focused routes must belong to the current inventory')
const routes = requestedRoutes?.length ? requestedRoutes : baseline
  ? ['/', '/settings', '/settings/providers', '/settings/routing', '/settings/skills', '/settings/mcp', '/settings/preferences', '/agent', '/request/qa-missing']
  : expandedRoutes
results.coverage = { routeTemplates: worklist.routes.length, helpChapters: guideChapters.length, destinations: routes.length }
const modes = baseline ? ['light', 'dark'] : worklist.modes
const viewports = requestedWidth ? [{ id: 'narrow', width: requestedWidth, height: 900 }]
  : baseline ? [{ id: 'mobile', width: 390, height: 900 }] : worklist.viewports
const slug = value => value.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'home'
function exportDigest() {
  const hash = crypto.createHash('sha256')
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else hash.update(path.relative(webRoot, file)).update('\0').update(fs.readFileSync(file)).update('\0')
    }
  }
  walk(webRoot)
  return hash.digest('hex')
}
async function measure(page) {
  return page.evaluate(() => {
    const visible = element => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || node.getAttribute('aria-hidden') === 'true') return false
      }
      return true
    }
    const overflow = [...document.querySelectorAll('button,input,textarea,[role="button"],[role="radio"],[role="tab"],[role="switch"]')]
      .filter(visible).flatMap(element => {
        const rect = element.getBoundingClientRect()
        if (!rect.width || rect.right <= innerWidth + 2 && rect.left >= -2) return []
        return [{ label: (element.getAttribute('aria-label') || element.getAttribute('data-testid') || element.textContent || '').slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right) }]
      }).slice(0, 8)
    return { family: document.documentElement.dataset.themeId, mode: document.documentElement.dataset.themeMode,
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2,
      overflow, textLength: document.body.innerText.trim().length }
  })
}
async function main() {
  results.exportHash = exportDigest()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true })
  try {
    for (const family of worklist.families) for (const mode of modes) for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, colorScheme: mode, reducedMotion: 'reduce' })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
        results.blockedExternalHosts.push(url.hostname)
        return route.abort()
      })
      await context.addInitScript(({ family, mode, providers, routingPlan }) => {
        if (localStorage.getItem('islemind-upgrade-fixture')) return
        localStorage.setItem('islemind-upgrade-fixture', '1')
        localStorage.setItem('@islemind/settings', JSON.stringify({ themeId: family, theme: mode, language: 'zh-CN',
          defaultProvider: 'a', autoUpdateCheckEnabled: false, autoCheckApkUpdate: false, systemStatusNotificationsEnabled: false,
          backgroundMotion: 'static', webSearchEnabled: false, searchProvider: 'off', modelRoutingPlans: [routingPlan] }))
        localStorage.setItem('@islemind/language-source', JSON.stringify('user'))
        localStorage.setItem('@islemind/providers', JSON.stringify(providers))
      }, { family, mode, providers, routingPlan })
      const page = await context.newPage()
      let pageErrors = []
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 300)))
      for (const template of routes) {
        pageErrors = []
        const route = template.replace('[id]', 'qa-missing').replace('[runId]', 'qa-missing').replace('[slug]', 'chat')
        try {
          await page.goto(origin + route, { waitUntil: 'domcontentloaded' })
          await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true', null, { timeout: 60_000 })
          await page.waitForLoadState('networkidle', { timeout: 15_000 })
          const measured = await measure(page)
          assert.equal(measured.family, family)
          assert.equal(measured.mode, mode)
          assert.ok(measured.textLength > 0, 'Rendered route has content')
          assert.deepEqual(pageErrors, [])
          assert.equal(measured.documentOverflow, false)
          assert.deepEqual(measured.overflow, [])
          const entry = { family, mode, viewport: viewport.id, route: template, ...measured }
          results.pages.push(entry)
          if (baseline || args.includes('--capture-all') || viewport.id === 'mobile' && ['/', '/settings', '/settings/routing', '/settings/providers', '/agent', '/request/[id]'].includes(template)) {
            const file = `${family}-${mode}-${viewport.id}-${slug(template)}.png`
            await page.screenshot({ path: path.join(output, file), fullPage: true })
            entry.screenshot = file
          }
        } catch (error) {
          results.errors.push({ family, mode, viewport: viewport.id, route: template, message: error.message, pageErrors })
          await page.screenshot({ path: path.join(output, `failure-${family}-${mode}-${viewport.id}-${slug(template)}.png`), fullPage: true }).catch(() => {})
        }
        fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
      }
      await context.close()
    }
    assert.equal(results.exportHash, exportDigest(), 'Export remains unchanged throughout the run')
    assert.deepEqual(results.errors, [])
    assert.deepEqual(results.blockedExternalHosts, [])
    console.log(JSON.stringify({ pages: results.pages.length, errors: results.errors.length, externalRequests: results.blockedExternalHosts.length }))
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close() })
