const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { chromium } = require('playwright')
const zh = require('../src/i18n/resources/zh-CN.json')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const needsDefaultEvidence = !args.includes('--web-root') || !args.includes('--output')
const evidence = needsDefaultEvidence ? fs.readFileSync(path.join(root, 'test-evidence/qa/current-ui-rhythm-feedback-path.txt'), 'utf8').trim() : ''
const baseline = args.includes('--baseline')
const feedbackOnly = args.includes('--feedback-only')
const navigationOnly = args.includes('--navigation-only')
const webRoot = path.resolve(root, option('--web-root', path.join(evidence, baseline ? 'web-before' : 'web-after')))
const output = path.resolve(root, option('--output', path.join(evidence, baseline ? 'visual-before' : 'visual-after')))
const inside = value => value.startsWith(root + path.sep)
if (!inside(webRoot) || !inside(output)) throw new Error('Use exported files and evidence inside this workspace')
if (!fs.existsSync(path.join(webRoot, 'index.html'))) throw new Error('Export the web app first')
fs.mkdirSync(output, { recursive: true })

const mime = {
  '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}
const server = http.createServer((request, response) => {
  let file
  try { file = path.resolve(webRoot, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname)) }
  catch { response.writeHead(400).end(); return }
  if (file !== webRoot && !file.startsWith(webRoot + path.sep)) { response.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(file)) { response.writeHead(404).end(); return }
    file = path.join(webRoot, 'index.html')
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cache-Control': 'no-store',
  })
  fs.createReadStream(file).pipe(response)
})

const pages = navigationOnly ? [['home', '/'], ['settings', '/settings']] : [['home', '/'], ['settings', '/settings'], ['providers', '/settings/providers'], ['documents', '/documents'], ['usage', '/settings/usage']]
const families = baseline || feedbackOnly ? ['minimal'] : ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']
const results = { baseline, navigationOnly, nativeAcceptance: false, isolatedBrowserData: true, osClipboardWritten: false, pages: [], feedback: [], errors: [], blockedExternalHosts: [] }
let stage = 'startup'

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: true,
  })
  try {
    for (const family of families) {
      const widths = baseline || feedbackOnly ? [390] : ['minimal', 'liquid-glass'].includes(family) ? [390, 320, 1280] : [390, 320]
      for (const width of widths) {
        stage = `${family} ${width}`
        const context = await browser.newContext({ viewport: { width, height: width >= 1000 ? 900 : 844 }, colorScheme: 'light', reducedMotion: 'reduce' })
        await context.route('**/*', route => {
          const url = new URL(route.request().url())
          if (url.origin === baseUrl || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
          results.blockedExternalHosts.push(url.hostname)
          return route.abort()
        })
        await context.addInitScript(({ family }) => {
          if (!localStorage.getItem('@islemind/settings')) {
            localStorage.setItem('@islemind/settings', JSON.stringify({
              themeId: family, theme: 'light', language: 'zh-CN', autoCheckApkUpdate: false, backgroundMotion: 'static',
            }))
          }
          // Only this disposable browser clipboard changes; never touch the OS clipboard.
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => {
              if (globalThis.__uiClipboardDenied) throw new Error('Browser-owned clipboard denial')
              globalThis.__uiCopied = text
            },
          } })
          const execCommand = document.execCommand.bind(document)
          document.execCommand = (command, ...parameters) => /^(copy|cut|paste)$/i.test(command) ? false : execCommand(command, ...parameters)
        }, { family })
        const page = await context.newPage()
        page.on('pageerror', error => results.errors.push({ stage, message: error.message }))
        for (const [name, route] of pages) {
          stage = `${family} ${width} ${name}`
          await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' })
          await page.waitForFunction(family => document.documentElement.dataset.themeId === family, family)
          await page.waitForFunction(() => document.body.innerText.trim().length > 15)
          if (name === 'documents') await page.getByText(baseline ? zh.documents.empty : zh.documents.emptyTitle, { exact: true }).waitFor()
          if (name === 'usage') await page.getByText(zh.usage.emptyTitle, { exact: true }).waitFor()
          if (name === 'settings') await page.getByTestId('settings-groups').waitFor()
          if (name === 'providers') await page.getByTestId(`provider-settings-experience-${family}`).waitFor()
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(250)
          const geometry = await page.evaluate(name => ({
            width: innerWidth, contentWidth: document.documentElement.scrollWidth,
            buttons: [...document.querySelectorAll('[role="button"]')].filter(node => {
              const bounds = node.getBoundingClientRect()
              return bounds.width > 0 && bounds.height > 0 && !node.closest('[aria-hidden="true"]')
            }).length,
            settingsRows: name === 'settings' ? [...document.querySelectorAll('[data-testid="settings-groups"] [data-testid^="settings-entry-"]')].map(node => ({
              id: node.dataset.testid,
              direction: getComputedStyle(node).flexDirection,
              minHeight: Number.parseFloat(getComputedStyle(node).minHeight),
              height: node.getBoundingClientRect().height,
            })) : [],
          }), name)
          if (!baseline) assert.ok(geometry.contentWidth <= width + 1, `${stage}: horizontal page overflow`)
          if (!baseline && name === 'settings') {
            assert.ok(geometry.settingsRows.length > 0, `${stage}: missing navigation rows`)
            for (const row of geometry.settingsRows) {
              const tile = family === 'material' && width >= 350 && ['model-availability', 'preferences', 'appearance'].some(id => row.id === `settings-entry-${id}`)
              const minHeight = tile ? 106 : family === 'minimal' ? 56 : family === 'monet' ? 76 : 68
              assert.equal(row.direction, tile ? 'column' : 'row', `${stage}: ${row.id} loses its layout style`)
              assert.ok(row.minHeight >= minHeight && row.height >= minHeight - 1, `${stage}: ${row.id} loses its touch target`)
            }
          }
          results.pages.push({ family, width, name, ...geometry })
          await page.screenshot({ path: path.join(output, `${family}-${width}-${name}.jpg`), type: 'jpeg', quality: 65 })
        }
        if (!navigationOnly && width === 390 && family === 'minimal') {
          stage = 'appearance feedback geometry'
          await page.goto(baseUrl + '/settings/system/appearance', { waitUntil: 'domcontentloaded' })
          await page.getByTestId('settings-appearance-status').waitFor()
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(350)
          const geometryBefore = await page.evaluate(() => {
            const bounds = node => {
              if (!node) return null
              const box = node.getBoundingClientRect()
              return { y: box.y, height: box.height }
            }
            const capture = () => ({
              scrollY,
              viewportTop: visualViewport?.offsetTop ?? 0,
              status: bounds(document.querySelector('[data-testid="settings-appearance-status"]')),
              mode: bounds(document.querySelector('[data-testid="settings-theme-mode-group"]')),
              control: bounds(document.querySelector('[data-testid="settings-theme-mode-dark"]')),
              header: bounds(document.querySelector('[data-testid="settings-page-experience-minimal"]')),
              scrollers: [...document.querySelectorAll('body *')].filter(node => {
                const style = getComputedStyle(node)
                return ['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight
              }).map(node => ({ scrollTop: node.scrollTop, height: node.clientHeight, contentHeight: node.scrollHeight })),
            })
            globalThis.__uiAppearanceCapture = capture
            globalThis.__uiAppearanceScrolls = []
            document.addEventListener('pointerdown', () => { globalThis.__uiAppearanceAtPress = capture() }, { once: true, capture: true })
            document.addEventListener('scroll', () => { globalThis.__uiAppearanceScrolls.push(capture()) }, { capture: true })
            return capture()
          })
          const before = await page.getByTestId('settings-appearance-status').boundingBox()
          const nextBefore = await page.getByTestId('settings-theme-mode-group').boundingBox()
          await page.getByTestId('settings-theme-mode-dark').click()
          await page.waitForFunction(() => JSON.parse(localStorage.getItem('@islemind/settings')).theme === 'dark' && document.documentElement.dataset.themeMode === 'dark')
          if (!baseline) {
            await page.waitForFunction(label => document.querySelector('[data-testid="settings-appearance-status-glyph"]')?.getAttribute('aria-label') === label, zh.settings.appearanceApplied)
            await page.getByTestId('settings-undo').waitFor()
          }
          await page.waitForTimeout(350)
          const after = await page.getByTestId('settings-appearance-status').boundingBox()
          const nextAfter = await page.getByTestId('settings-theme-mode-group').boundingBox()
          const receipt = {
            name: 'appearance', statusHeightChange: after.height - before.height,
            nextSectionShift: (nextAfter.y - after.y) - (nextBefore.y - before.y),
            viewportShift: after.y - before.y,
            geometryBefore,
            geometryAtPress: await page.evaluate(() => globalThis.__uiAppearanceAtPress),
            geometryAfter: await page.evaluate(() => globalThis.__uiAppearanceCapture()),
            scrollEvents: await page.evaluate(() => globalThis.__uiAppearanceScrolls),
          }
          results.feedback.push(receipt)
          if (!baseline) {
            assert.ok(Math.abs(receipt.statusHeightChange) < 0.5, 'Success must not add a status row')
            assert.ok(Math.abs(receipt.nextSectionShift) < 0.5, 'Success must not move the next section')
            assert.ok(Math.abs(receipt.viewportShift) < 0.5, 'Success and undo must not shift the appearance content')
            const glyph = await page.getByTestId('settings-appearance-status-glyph').boundingBox()
            assert.equal(glyph.width, 18)
            assert.equal(glyph.height, 18)
          }
          await page.screenshot({ path: path.join(output, 'appearance-confirmed.jpg'), type: 'jpeg', quality: 65 })

          if (!baseline) {
            stage = 'appearance fixed-slot undo'
            const undo = page.getByTestId('settings-undo')
            const undoBounds = await undo.boundingBox()
            assert.equal(undoBounds.width, 44)
            assert.equal(undoBounds.height, 44)
            await undo.click()
            await page.waitForFunction(() => JSON.parse(localStorage.getItem('@islemind/settings')).theme === 'light' && document.documentElement.dataset.themeMode === 'light')
            await page.waitForTimeout(350)
            const undone = await page.getByTestId('settings-appearance-status').boundingBox()
            assert.ok(Math.abs(undone.y - before.y) < 0.5, 'Undo must not insert or remove a content row')
            assert.equal(await page.getByTestId('settings-undo').count(), 0)
            receipt.undoRetained = true
            receipt.undoViewportShift = undone.y - before.y

            stage = 'settings field acknowledgement'
            await page.goto(baseUrl + '/settings/preferences', { waitUntil: 'domcontentloaded' })
            const field = page.getByRole('textbox', { name: zh.preferences.assistantDisplayName, exact: true })
            await field.fill('Local UI name')
            await field.evaluate(node => { globalThis.__uiField = node })
            const status = page.getByTestId('settings-field-assistantDisplayName-status')
            const fieldBefore = await status.boundingBox()
            const inputBefore = await field.boundingBox()
            await page.getByRole('button', { name: zh.settingsWorkspace.save, exact: true }).click()
            await page.waitForFunction(label => document.querySelector('[data-testid="settings-field-assistantDisplayName-status"]')?.getAttribute('aria-label') === label, zh.settingsWorkspace.saved)
            const fieldAfter = await status.boundingBox()
            const inputAfter = await field.boundingBox()
            assert.equal(fieldBefore.width, fieldAfter.width)
            assert.equal(fieldBefore.height, fieldAfter.height)
            assert.ok(Math.abs(fieldBefore.y - fieldAfter.y) < 0.5, 'Saving must not insert undo above the field')
            assert.ok(Math.abs(inputBefore.y - inputAfter.y) < 0.5, 'Saving must retain the input position')
            assert.equal(await field.inputValue(), 'Local UI name')
            assert.equal(await field.evaluate(node => node === globalThis.__uiField), true)
            assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('@islemind/settings')).assistantDisplayName), 'Local UI name')
            assert.equal(await page.getByTestId('settings-undo').count(), 1)
            results.feedback.push({ name: 'settings field', width: fieldAfter.width, height: fieldAfter.height, viewportShift: inputAfter.y - inputBefore.y, durableWrite: true, inputRetained: true, undoRetained: true })

            stage = 'document copy feedback geometry'
            await page.goto(baseUrl + '/documents/edit', { waitUntil: 'domcontentloaded' })
            await page.getByTestId('document-title').fill('A local UI verification note')
            await page.getByTestId('document-body').fill('An isolated browser draft. No AI or external service is used.')
            await page.getByRole('button', { name: zh.common.save, exact: true }).click()
            await page.waitForFunction(label => document.querySelector('[data-testid="document-save-status"]')?.textContent === label, zh.documents.saved)
            const copy = page.getByTestId('document-copy')
            await copy.scrollIntoViewIfNeeded()
            const buttonBefore = await copy.boundingBox()
            const bodyBefore = await page.getByTestId('document-body').boundingBox()
            await copy.click()
            await page.waitForFunction(() => Boolean(globalThis.__uiCopied))
            await page.waitForFunction(() => document.querySelector('[data-testid="document-copy-announcement"]')?.textContent.length > 0)
            const buttonAfter = await copy.boundingBox()
            const bodyAfter = await page.getByTestId('document-body').boundingBox()
            assert.equal(await page.getByTestId('document-copy-feedback').count(), 0)
            assert.ok(Math.abs(buttonBefore.width - buttonAfter.width) < 0.5)
            assert.ok(Math.abs(buttonBefore.height - buttonAfter.height) < 0.5)
            assert.ok(Math.abs(bodyBefore.y - bodyAfter.y) < 0.5)
            await page.screenshot({ path: path.join(output, 'document-copy-confirmed.jpg'), type: 'jpeg', quality: 65 })
            await page.evaluate(() => { globalThis.__uiClipboardDenied = true })
            await copy.click()
            await page.getByTestId('document-copy-feedback').getByText(zh.chat.clipboardUnavailable, { exact: true }).waitFor()
            await page.screenshot({ path: path.join(output, 'document-copy-denied.jpg'), type: 'jpeg', quality: 65 })
            await page.evaluate(() => { globalThis.__uiClipboardDenied = false })
            await copy.click()
            await page.waitForFunction(() => !document.querySelector('[data-testid="document-copy-feedback"]'))
            await page.screenshot({ path: path.join(output, 'document-copy-retried.jpg'), type: 'jpeg', quality: 65 })
            results.feedback.push({ name: 'document copy', buttonWidthChange: buttonAfter.width - buttonBefore.width, bodyShift: bodyAfter.y - bodyBefore.y, failureAndRetry: true })
          }
        }
        await context.close()
      }
    }
    if (args.includes('--workflows')) {
      stage = 'extended UI workflows'
      const report = path.join(output, 'workflow-results.json')
      try {
        const run = await promisify(execFile)(process.execPath, [path.join(root, 'scripts/complete-ui-web-workflows-tests.js'), '--base-url', baseUrl, '--output', report], { cwd: root, maxBuffer: 1024 * 1024 })
        fs.writeFileSync(path.join(output, 'workflows.log'), run.stdout + run.stderr)
        results.workflowChecks = JSON.parse(fs.readFileSync(report, 'utf8')).checks.length
      } catch (error) {
        fs.writeFileSync(path.join(output, 'workflows.log'), (error.stdout ?? '') + (error.stderr ?? ''))
        throw error
      }
    }
    assert.equal(results.errors.length, 0, 'No uncaught browser errors')
  } finally { await browser.close() }
}

main().catch(error => {
  results.failedStage = stage
  results.failure = error.message
  process.exitCode = 1
}).finally(() => {
  server.close()
  results.blockedExternalHosts = [...new Set(results.blockedExternalHosts)]
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  const feedback = results.feedback.map(({ geometryBefore, geometryAtPress, geometryAfter, scrollEvents, ...receipt }) => receipt)
  console.log(JSON.stringify({ pages: results.pages.length, feedback, workflows: results.workflowChecks ?? 0, errors: results.errors.length, failure: results.failure ?? null, output }))
})
