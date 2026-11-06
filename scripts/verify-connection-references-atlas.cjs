const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '..')
const evidence = path.resolve(root, process.argv[2] || 'test-evidence/qa/islemind-connection-references-20261106')
assert(evidence.startsWith(root + path.sep))
const out = path.join(evidence, 'atlas-verification.json')
assert(!fs.existsSync(out), 'Preserve previous atlas verification')
const data = JSON.parse(fs.readFileSync(path.join(evidence, 'atlas-manifest.json'), 'utf8'))
assert.equal(data.schema, 'islemind.connection-references-atlas.v1')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const receipt = { schema: 'islemind.connection-references-atlas-verification.v1', startedAt: new Date().toISOString(),
  indexSha256: hash(path.join(evidence, 'index.html')), manifestSha256: hash(path.join(evidence, 'atlas-manifest.json')),
  offline: true, cases: [], checks: [], errors: [], pageErrors: [], externalRequests: [], pass: false }
async function main() {
  let browser
  try {
    for (const item of data.screenshots) {
      const file = path.resolve(evidence, item.file)
      assert(file.startsWith(evidence + path.sep))
      assert.equal(hash(file), item.sha256)
    }
    receipt.screenshotHashes = data.screenshots.length
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true })
    context.on('request', request => { if (!['file:', 'about:', 'data:'].includes(new URL(request.url()).protocol)) receipt.externalRequests.push(request.url()) })
    const page = await context.newPage()
    page.on('pageerror', error => receipt.pageErrors.push(error.message))
    await page.goto(pathToFileURL(path.join(evidence, 'index.html')).href)
    async function filter(family, mode, width, view = 'all') {
      for (const [name, value] of Object.entries({ family, mode, width, view })) await page.locator(`#${name}`).selectOption(value)
      const expected = data.screenshots.filter(item => item.family === family && item.mode === mode && item.width === width && (view === 'all' || item.view === view)).length
      assert.equal(await page.locator('#gallery figure').count(), expected)
      assert.equal(await page.locator('#empty').isVisible(), expected === 0)
      assert((await page.locator('#status').innerText()).startsWith(`${expected} 张当前截图`))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      return expected
    }
    for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) for (const mode of ['light', 'dark']) {
      for (const width of ['320', '390', '960', 'android']) {
        const screenshots = await filter(family, mode, width)
        assert(screenshots > 0)
        receipt.cases.push({ family, mode, width, screenshots })
      }
    }
    assert.equal(await filter('minimal', 'light', '320', 'read-failure'), 0)
    receipt.checks.push('Unrecorded step/width combinations show the empty explanation.')
    await filter('minimal', 'light', '390', 'references')
    await page.locator('#gallery button').first().click()
    await page.waitForFunction(() => document.querySelector('#zoom-image').naturalWidth > 0)
    assert.equal(await page.locator('#zoom').evaluate(dialog => dialog.open), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('#gallery button').first().evaluate(button => document.activeElement === button), true)
    receipt.checks.push('Screenshot zoom opens the actual local PNG; Escape closes it and restores focus.')
    const links = await page.locator('nav a').evaluateAll(elements => elements.map(element => element.href))
    for (const link of links) {
      const file = fileURLToPath(link)
      assert(file.startsWith(root + path.sep) && fs.statSync(file).isFile())
    }
    receipt.localLinks = links.length
    receipt.checks.push('The implementation report and separate Web/Android/gate links resolve to existing local files.')
    await page.locator('#gallery img').first().scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('#gallery img').naturalWidth > 0)
    assert(await page.locator('#gallery img').first().evaluate(image => image.getBoundingClientRect().width <= 390))
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: path.join(evidence, 'atlas-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 320, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: path.join(evidence, 'atlas-narrow.png'), fullPage: true })
    receipt.checks.push('Desktop and 320px controls fit without horizontal overflow; a single phone image retains its capture width.')
    assert.deepEqual(receipt.pageErrors, []); assert.deepEqual(receipt.externalRequests, [])
    receipt.pass = true
  } catch (error) { receipt.errors.push({ message: error.message, stack: error.stack }); process.exitCode = 1 }
  finally {
    await browser?.close()
    receipt.completedAt = new Date().toISOString()
    fs.writeFileSync(out, JSON.stringify(receipt, null, 2))
    console.log(JSON.stringify({ pass: receipt.pass, cases: receipt.cases.length, checks: receipt.checks.length, screenshots: receipt.screenshotHashes, errors: receipt.errors }))
  }
}
main()
