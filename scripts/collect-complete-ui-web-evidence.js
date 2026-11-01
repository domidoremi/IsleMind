const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const worklist = require('./fixtures/worklists/complete-ui-experience-worklist.json')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const baseUrl = option('--base-url', 'http://localhost:8081').replace(/\/$/, '')
const output = path.resolve(root, option('--output', 'test-evidence/qa/complete-ui-web'))
const smoke = args.includes('--smoke')
const summaryOnly = args.includes('--source-only')

function sourceRoutes(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceRoutes(file)
    if (!entry.name.endsWith('.tsx') || /^[+_]/.test(entry.name)) return []
    const route = '/' + path.relative(path.join(root, 'app'), file).replace(/\\/g, '/').replace(/\.tsx$/, '').replace(/(^|\/)index$/, '')
    return [route.replace(/\/$/, '') || '/']
  })
}
function routeTemplate(route) {
  return route.replace(/\/settings\/category\/[^/]+$/, '/settings/category/[category]')
    .replace(/\/settings\/system\/[^/]+$/, '/settings/system/[panel]')
}
function validateWorklist() {
  const actual = sourceRoutes(path.join(root, 'app'))
  const covered = new Set(worklist.routes.map(routeTemplate))
  const missing = actual.filter(route => !covered.has(route))
  const stale = [...covered].filter(route => !actual.includes(route))
  if (missing.length || stale.length) throw new Error(JSON.stringify({ missing, stale }))
  if (new Set(worklist.routes).size !== worklist.routes.length) throw new Error('Duplicate route coverage')
  const contracts = fs.readFileSync(path.join(root, 'src/types/settingsContracts.ts'), 'utf8')
  for (const family of worklist.families) if (!contracts.includes(`'${family}'`)) throw new Error(`Unknown family: ${family}`)
}
function captureSourceDigest() {
  const linkedUi = path.dirname(require.resolve('animal-island-ui-rn/package.json'))
  const hash = crypto.createHash('sha256')
  let files = 0
  function add(file, label) {
    if (!fs.existsSync(file)) return
    const stat = fs.statSync(file)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) add(path.join(file, name), `${label}/${name}`)
      return
    }
    hash.update(label).update('\0').update(fs.readFileSync(file)).update('\0')
    files += 1
  }
  for (const name of ['app', 'src', 'assets', 'package.json', 'bun.lock', 'app.config.ts', 'babel.config.js', 'metro.config.js',
    'scripts/collect-complete-ui-web-evidence.js', 'scripts/complete-ui-web-workflows-tests.js', 'scripts/fixtures/worklists/complete-ui-experience-worklist.json']) {
    add(path.join(root, name), name)
  }
  for (const name of ['src', 'dist', 'package.json']) add(path.join(linkedUi, name), `linked-ui/${name}`)
  return { algorithm: 'sha256', files, hash: hash.digest('hex') }
}
async function settle(page) {
  await page.waitForFunction(() => document.documentElement.dataset.themeReady === 'true', null, { timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 30_000 })
}
async function layout(page) {
  return page.evaluate(() => {
    const visible = element => {
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0 || node.getAttribute('aria-hidden') === 'true') return false
      }
      return true
    }
    const overflow = [...document.querySelectorAll('button,input,textarea,[role="button"],[role="radio"],[role="switch"]')]
      .filter(visible).flatMap(element => {
        const rect = element.getBoundingClientRect()
        if (!rect.width || rect.right <= innerWidth + 2 && rect.left >= -2) return []
        return [{ label: (element.getAttribute('aria-label') || element.getAttribute('data-testid') || element.textContent || '').slice(0, 80), left: Math.round(rect.left), right: Math.round(rect.right) }]
      }).slice(0, 8)
    const text = document.body.innerText.trim()
    return {
      family: document.documentElement.dataset.themeId,
      mode: document.documentElement.dataset.themeMode,
      overflow,
      documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 2,
      textLength: text.length,
      excerpt: text.slice(0, 140),
    }
  })
}
async function main() {
  validateWorklist()
  if (summaryOnly) {
    console.log(JSON.stringify({ routes: worklist.routes.length, families: worklist.families.length, combinations: worklist.routes.length * worklist.families.length * worklist.modes.length * worklist.viewports.length }))
    return
  }
  if (!output.startsWith(root + path.sep)) throw new Error('Evidence output must remain inside the workspace')
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl)) throw new Error('Use an explicit local development server')
  const startedAt = new Date().toISOString()
  const sourceStart = captureSourceDigest()
  fs.mkdirSync(output, { recursive: true })
  const { chromium } = require('playwright')
  const browser = await chromium.launch({
    executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
    headless: true,
  })
  const checks = []
  const blockedOrigins = new Set()
  const families = smoke ? worklist.families.slice(0, 1) : worklist.families
  const modes = smoke ? worklist.modes.slice(0, 1) : worklist.modes
  const viewports = smoke ? worklist.viewports.slice(0, 1) : worklist.viewports
  const routes = smoke ? ['/', '/documents/edit', '/settings/providers', '/settings/preferences', '/settings/knowledge', '/settings/system/appearance', '/help/chat', '/report'] : worklist.routes
  try {
    for (const family of families) for (const mode of modes) for (const viewport of viewports) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: mode, reducedMotion: 'reduce' })
      await context.route('**/*', request => {
        const url = request.request().url()
        if (url.startsWith(baseUrl + '/') || /^(data|blob):/.test(url)) return request.continue()
        try { blockedOrigins.add(new URL(url).origin) } catch {}
        return request.abort()
      })
      // This storage exists only in a new ephemeral browser context, never a user profile.
      await context.addInitScript(({ family, mode }) => {
        if (localStorage.getItem('islemind-complete-ui-fixture')) return
        localStorage.setItem('@islemind/settings', JSON.stringify({
          themeId: family, theme: mode, language: 'zh-CN', autoCheckApkUpdate: false,
          systemStatusNotificationsEnabled: false, backgroundMotion: 'static',
        }))
        localStorage.setItem('islemind-complete-ui-fixture', '1')
      }, { family, mode })
      const page = await context.newPage()
      let errors = []
      page.on('pageerror', error => errors.push(error.message.slice(0, 200)))
      for (const template of routes) {
        errors = []
        const route = template.replace('[id]', 'qa-ui-missing').replace('[runId]', 'qa-ui-missing').replace('[slug]', 'chat')
        let measured
        let failure
        try {
          await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded', timeout: 90_000 })
          await settle(page)
          measured = await layout(page)
        } catch (error) { failure = error.message.slice(0, 250) }
        const passed = !failure && !errors.length && measured.family === family && measured.mode === mode
          && !measured.overflow.length && !measured.documentOverflow && measured.textLength > 0
        const result = { route: template, family, mode, viewport: viewport.id, passed, ...measured, errors, failure }
        checks.push(result)
        fs.writeFileSync(path.join(output, 'progress.json'), JSON.stringify({ completed: checks.length, failed: checks.filter(check => !check.passed).length, latest: result }, null, 2))
        if (passed && template === '/settings/system/appearance') {
          await page.getByTestId('settings-appearance-preview').scrollIntoViewIfNeeded()
          await page.screenshot({ path: path.join(output, `${family}-${mode}-${viewport.id}.jpg`), type: 'jpeg', quality: 60 })
        }
      }
      console.log(`${family}/${mode}/${viewport.id}: ${checks.slice(-routes.length).filter(check => check.passed).length}/${routes.length}`)
      await context.close()
    }
  } finally { await browser.close() }
  const failed = checks.filter(check => !check.passed)
  const sourceEnd = captureSourceDigest()
  const sourceStable = sourceStart.files === sourceEnd.files && sourceStart.hash === sourceEnd.hash
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
    schema: 'islemind.complete-ui-web-evidence.v1', scope: smoke ? 'smoke' : 'full', startedAt, capturedAt: new Date().toISOString(),
    sourceStart, sourceEnd, sourceStable,
    routeCount: worklist.routes.length, checks, passed: checks.length - failed.length,
    failed: failed.length, blockedOrigins: [...blockedOrigins], nativeAcceptance: false,
    dynamicRouteState: worklist.dynamicRouteState,
  }, null, 2))
  console.log(JSON.stringify({ checks: checks.length, passed: checks.length - failed.length, failed: failed.length, sourceStable, nativeAcceptance: false }))
  if (failed.length || !sourceStable) process.exitCode = 1
}

module.exports = { validateWorklist, sourceRoutes, routeTemplate, settle, layout }
if (require.main === module) main().catch(error => { console.error(error.message.slice(0, 1000)); process.exitCode = 1 })
