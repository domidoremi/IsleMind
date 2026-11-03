const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { chromium } = require('playwright')
const { PNG } = require('pngjs')
const { assertPaintedNativeNode } = require('./native-painted-visibility')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const webRoot = path.resolve(root, option('--web-root', ''))
const output = path.resolve(root, option('--output', ''))
for (const target of [webRoot, output]) {
  assert.ok(target.startsWith(root + path.sep), 'Use explicit workspace exports and disposable evidence')
}
assert.ok(fs.existsSync(path.join(webRoot, 'index.html')), 'Export the current web app first')
assert.ok(!fs.existsSync(output), 'Preserve existing evidence')
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

const plain = family => family === 'minimal' || family === 'material'
const results = {
  generatedAt: new Date().toISOString(), passed: false, nativeAcceptance: false,
  isolatedBrowserData: true, osClipboardWritten: false, pages: [], transitions: [], retainedTransitions: [],
  errors: [], blockedRequests: [],
}
let stage = 'startup'

function solidRegion(file, region) {
  const png = PNG.sync.read(fs.readFileSync(file))
  const colors = new Map()
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const offset = (y * png.width + x) * 4
      const color = [...png.data.subarray(offset, offset + 4)].join(',')
      colors.set(color, (colors.get(color) ?? 0) + 1)
    }
  }
  assert.equal(colors.size, 1, `${stage}: empty background contains artwork: ${JSON.stringify([...colors].slice(0, 8))}`)
  return { region, color: [...colors.keys()][0], pixels: [...colors.values()][0] }
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({
    executablePath: option('--browser-path', 'C:/Program Files/Google/Chrome/Application/chrome.exe'),
    headless: true,
  })
  try {
    const families = args.includes('--probe') ? ['material'] : ['minimal', 'material', 'monet', 'liquid-glass', 'animal-island-ui']
    for (const family of families) {
      for (const mode of args.includes('--probe') ? ['dark'] : ['light', 'dark']) {
        for (const width of plain(family) && !args.includes('--probe') ? [390, 1280] : [390]) {
          stage = `${family}/${mode}/${width}`
          const height = width >= 1000 ? 900 : 960
          const context = await browser.newContext({
            viewport: { width, height }, colorScheme: mode, reducedMotion: 'reduce',
          })
          try {
            await context.route('**/*', route => {
              const url = new URL(route.request().url())
              if (url.origin === baseUrl || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
              results.blockedRequests.push({ stage, method: route.request().method(), url: url.origin + url.pathname })
              return route.abort()
            })
            await context.addInitScript(({ family, mode }) => {
              if (!localStorage.getItem('@islemind/settings')) {
                localStorage.setItem('@islemind/settings', JSON.stringify({
                  themeId: family, theme: mode, language: 'zh-CN',
                  autoCheckApkUpdate: false, autoUpdateCheckEnabled: false, autoApkDownloadEnabled: false,
                  backgroundVariation: 'random', backgroundMotion: 'immersive', backgroundIntensity: 'high',
                }))
                localStorage.setItem('@islemind/providers', '[]')
              }
              Object.defineProperty(navigator, 'clipboard', {
                configurable: true, value: { writeText: async () => { throw new Error('No clipboard use in background review') } },
              })
              const exec = document.execCommand.bind(document)
              document.execCommand = (command, ...rest) => /^(copy|cut|paste)$/i.test(command) ? false : exec(command, ...rest)
            }, { family, mode })
            const page = await context.newPage()
            page.on('pageerror', error => results.errors.push({ stage, message: error.message }))

            async function capture(name, expectedFamily = family) {
              stage = `${family}/${mode}/${width}/${name}`
              await page.waitForFunction(expected => document.documentElement.dataset.themeId === expected, expectedFamily)
              await page.evaluate(() => document.fonts.ready)
              await page.waitForTimeout(200)
              const artworkCount = await page.locator('[data-testid^="theme-background-"]').count()
              if (plain(expectedFamily)) assert.equal(artworkCount, 0, `${stage}: a plain theme still mounts decoration`)
              else assert.ok(artworkCount > 0, `${stage}: supported theme background disappeared`)
              const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth)
              assert.ok(contentWidth <= width + 1, `${stage}: horizontal page overflow`)
              const screenshot = path.join(output, `${family}-${mode}-${width}-${name}.png`)
              await page.screenshot({ path: screenshot })
              const receipt = { family: expectedFamily, mode, width, name, artworkCount, contentWidth, screenshot }
              if (name.includes('chat')) {
                const png = PNG.sync.read(fs.readFileSync(screenshot))
                receipt.paintedContent = []
                for (const id of ['chat-model-title', 'message-input']) {
                  const bounds = await page.getByTestId(id).boundingBox()
                  assert.ok(bounds, `${stage}: chat content has no visible bounds: ${id}`)
                  receipt.paintedContent.push(assertPaintedNativeNode(png, {
                    id,
                    bounds: `[${Math.ceil(bounds.x)},${Math.ceil(bounds.y)}][${Math.floor(bounds.x + bounds.width)},${Math.floor(bounds.y + bounds.height)}]`,
                  }))
                }
              }
              if (plain(expectedFamily) && name === 'settings') {
                const group = await page.getByTestId('settings-active-task').boundingBox()
                const top = Math.max(Math.ceil(group.y + group.height + 32), Math.floor(height * 0.8))
                assert.ok(top < height - 32, `${stage}: no unobstructed background region to verify`)
                receipt.solidBackground = solidRegion(screenshot, {
                  left: Math.ceil(width * 0.08), right: Math.floor(width * 0.92), top, bottom: height - 32,
                })
              }
              results.pages.push(receipt)
            }

            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
            const draft = 'Keep this disposable local draft intact'
            await page.getByTestId('message-input').fill(draft)
            await page.getByTestId('message-input').blur()
            await capture('chat')
            await page.getByTestId('message-input').focus()
            await capture('chat-focused')
            assert.equal(await page.getByTestId('message-input').inputValue(), draft)
            await page.getByTestId('message-input').blur()
            await page.waitForTimeout(300)

            await page.goto(baseUrl + '/settings', { waitUntil: 'domcontentloaded' })
            await page.getByTestId('settings-entry-appearance').waitFor()
            await capture('settings')
            await page.getByTestId('settings-entry-appearance').click()
            await page.getByTestId('settings-section-background').waitFor()
            if (plain(family)) {
              assert.equal(await page.getByTestId('settings-background-plain').count(), 1)
              for (const group of ['variation', 'preset', 'motion', 'intensity']) {
                assert.equal(await page.getByTestId(`settings-background-${group}-group`).count(), 0)
              }
            } else {
              assert.equal(await page.getByTestId('settings-background-motion-group').count(), 1)
            }
            await page.getByTestId('settings-section-background').scrollIntoViewIfNeeded()
            await capture('appearance-background')

            if (family === 'material' && mode === 'dark' && width === 390) {
              for (const nextFamily of ['minimal', 'monet', 'material']) {
                await page.getByTestId(`settings-theme-family-${nextFamily}`).click()
                await page.waitForFunction(expected => document.documentElement.dataset.themeId === expected
                  && JSON.parse(localStorage.getItem('@islemind/settings')).themeId === expected, nextFamily)
                const artworkCount = await page.locator('[data-testid^="theme-background-"]').count()
                if (plain(nextFamily)) assert.equal(artworkCount, 0)
                else assert.ok(artworkCount > 0)
                const preferences = await page.evaluate(() => {
                  const { backgroundVariation, backgroundMotion, backgroundIntensity } = JSON.parse(localStorage.getItem('@islemind/settings'))
                  return { backgroundVariation, backgroundMotion, backgroundIntensity }
                })
                assert.deepEqual(preferences, {
                  backgroundVariation: 'random', backgroundMotion: 'immersive', backgroundIntensity: 'high',
                })
                results.transitions.push({ nextFamily, artworkCount, retainedPreferences: preferences })
              }

              await page.getByRole('button', { name: '\u8fd4\u56de', exact: true }).click()
              await page.getByTestId('settings-workspace').waitFor()
              await page.getByRole('button', { name: '\u8fd4\u56de\u804a\u5929', exact: true }).click()
              const retainedInput = page.getByTestId('message-input')
              await retainedInput.waitFor()
              assert.equal(await retainedInput.inputValue(), draft)
              await retainedInput.evaluate(element => {
                globalThis.__backgroundRetainedInput = element
                element.setSelectionRange(4, 11)
              })

              const cycle = ['minimal', 'material', 'minimal', 'material', 'monet', 'material', 'liquid-glass', 'material', 'animal-island-ui', 'material']
              for (const [index, nextFamily] of cycle.entries()) {
                await page.getByRole('button', { name: '\u8bbe\u7f6e', exact: true }).click()
                await page.getByTestId('settings-entry-appearance').click()
                await page.getByTestId(`settings-theme-family-${nextFamily}`).click()
                await page.waitForFunction(expected => document.documentElement.dataset.themeId === expected
                  && JSON.parse(localStorage.getItem('@islemind/settings')).themeId === expected, nextFamily)
                await page.getByRole('button', { name: '\u8fd4\u56de', exact: true }).click()
                await page.getByTestId('settings-workspace').waitFor()
                await page.getByRole('button', { name: '\u8fd4\u56de\u804a\u5929', exact: true }).click()
                await retainedInput.waitFor()
                const retention = await retainedInput.evaluate(element => ({
                  sameNativeEquivalentHost: element === globalThis.__backgroundRetainedInput,
                  selection: [element.selectionStart, element.selectionEnd],
                }))
                assert.equal(retention.sameNativeEquivalentHost, true, `${stage}: theme replaced the live input`)
                assert.deepEqual(retention.selection, [4, 11], `${stage}: theme/navigation changed input selection`)
                assert.equal(await retainedInput.inputValue(), draft)
                await capture(`retained-chat-${index + 1}-${nextFamily}`, nextFamily)
                await retainedInput.focus()
                await capture(`retained-chat-focused-${index + 1}-${nextFamily}`, nextFamily)
                await retainedInput.blur()
                results.retainedTransitions.push({ nextFamily, inputHostRetained: true, selectionRetained: true, draftRetained: true })
              }
            }

            await page.goto(baseUrl + '/documents', { waitUntil: 'domcontentloaded' })
            await page.getByTestId('document-library-empty').waitFor()
            await capture('documents')
            await page.getByTestId('document-library-create').click()
            await page.getByTestId('document-body').waitFor()
            await capture('document-editor')
            assert.equal(await page.getByTestId('document-body').inputValue(), '')
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
            await page.getByTestId('message-input').waitFor()
            assert.equal(await page.getByTestId('message-input').inputValue(), draft, `${stage}: draft changed while navigating`)
          } finally {
            await context.close()
          }
        }
      }
    }
    assert.equal(results.errors.length, 0, 'Browser runtime errors')
    assert.equal(results.blockedRequests.length, 0, 'No provider, update or external-source requests should be attempted')
    results.passed = true
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  results.errors.push({ stage, message: error.message })
  console.error(`${stage}: ${error.message}`)
  process.exitCode = 1
}).finally(async () => {
  await new Promise(resolve => server.close(resolve))
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(JSON.stringify({
    passed: results.passed, renderedStates: results.pages.length, themeTransitions: results.transitions.length,
    retainedThemeTransitions: results.retainedTransitions.length,
    errors: results.errors.length, externalRequestsAttempted: results.blockedRequests.length,
  }))
})
