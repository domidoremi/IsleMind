const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL, fileURLToPath } = require('node:url')
const { chromium } = require('playwright')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidence = path.resolve(root, option('--evidence-root', 'test-evidence/qa/islemind-scene-plans-20261106'))
assert(evidence.startsWith(root + path.sep), 'Use local workspace evidence')
const out = path.resolve(evidence, option('--out', 'atlas-verification.json'))
assert(out.startsWith(evidence + path.sep))
if (fs.existsSync(out)) {
  assert(args.includes('--refresh') && JSON.parse(fs.readFileSync(out)).schema === 'islemind.scene-plans-atlas-verification.v1',
    'Preserve earlier verification unless explicitly refreshing the known atlas record')
}
const manifestPath = path.join(evidence, 'atlas-manifest.json')
const indexPath = path.join(evidence, 'index.html')
const data = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
assert.equal(data.schema, 'islemind.scene-plans-atlas.v1')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const receipt = {
  schema: 'islemind.scene-plans-atlas-verification.v1',
  startedAt: new Date().toISOString(),
  indexSha256: hash(indexPath),
  manifestSha256: hash(manifestPath),
  offline: true,
  cases: [],
  checks: [],
  pageErrors: [],
  externalRequests: [],
  errors: [],
}
const save = () => fs.writeFileSync(out, JSON.stringify(receipt, null, 2))

async function main() {
  let browser
  try {
    for (const entry of data.screenshots) {
      const file = path.resolve(evidence, decodeURIComponent(entry.file))
      assert(file.startsWith(evidence + path.sep))
      assert.equal(hash(file), entry.sha256)
    }
    receipt.screenshotHashes = data.screenshots.length
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true })
    context.on('request', request => {
      if (!['file:', 'about:', 'data:'].includes(new URL(request.url()).protocol)) receipt.externalRequests.push(request.url())
    })
    const page = await context.newPage()
    page.on('pageerror', error => receipt.pageErrors.push(error.message))
    const url = pathToFileURL(indexPath).href
    await page.goto(url)
    await page.locator('#status').waitFor()

    async function filter(platform, family, mode, width, step = 'all') {
      for (const [id, value] of Object.entries({ platform, family, mode, width: String(width), step })) {
        await page.locator(`#${id}`).selectOption(value)
      }
      const expected = data.screenshots.filter(entry => (platform === 'all' || entry.platform === platform)
        && entry.family === family && entry.mode === mode && (width === 'all' || entry.width === width)
        && (step === 'all' || entry.view === step)).length
      assert.equal(await page.locator('#gallery figure').count(), expected)
      assert.equal(await page.locator('#empty').isVisible(), expected === 0)
      assert((await page.locator('#status').innerText()).startsWith(`${expected} 张截图`))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
      return expected
    }

    for (const family of data.families) for (const mode of ['light', 'dark']) {
      for (const [platform, width] of [['web', 320], ['web', 390], ['web', 960], ['android', 'all'], ['all', 'all']]) {
        const count = await filter(platform, family.id, mode, width)
        assert(count > 0, 'Every promised platform/theme/width combination has retained views')
        receipt.cases.push({ platform, family: family.id, mode, width, screenshots: count })
      }
    }
    assert.equal(await filter('android', 'minimal', 'light', 390), 0)
    receipt.checks.push('An unrecorded Android/CSS-width combination shows the empty-state explanation.')

    await filter('web', 'animal-island-ui', 'dark', 390, 'preview')
    assert.equal(await page.locator('#gallery figure strong').first().innerText(), '应用作用范围与变化')
    await page.locator('#reset').click()
    for (const [id, expected] of Object.entries({ platform: 'all', family: 'minimal', mode: 'light', width: 'all', step: 'all' })) {
      assert.equal(await page.locator(`#${id}`).inputValue(), expected)
    }
    receipt.checks.push('Step selection filters retained previews; Reset restores all five controls.')

    const links = await page.locator('#links a, #gallery a').evaluateAll(elements => elements.map(element => element.href))
    for (const link of links) {
      const file = fileURLToPath(link)
      assert(file.startsWith(evidence + path.sep) && fs.statSync(file).isFile())
    }
    receipt.localLinks = links.length
    await page.locator('#gallery a').first().click()
    await page.waitForURL(value => value.protocol === 'file:' && value.pathname.endsWith('.png'))
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0)
    await page.goBack()
    await page.locator('#links a').first().click()
    await page.waitForURL(value => value.protocol === 'file:' && value.pathname.endsWith('results.json'))
    assert(await page.locator('body').innerText().then(value => value.includes('"schema"')))
    await page.goBack()
    receipt.checks.push('Local screenshot and result links open their actual PNG/JSON and return to the atlas.')

    await filter('web', 'minimal', 'light', 390, 'preview')
    await page.locator('#gallery img').first().scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelector('#gallery img')?.naturalWidth > 0)
    assert(await page.locator('#gallery img').first().evaluate(image => image.getBoundingClientRect().width <= 390))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(evidence, 'atlas-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 320, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(evidence, 'atlas-narrow.png'), fullPage: true })
    receipt.checks.push('Desktop and 320 CSS-pixel atlas controls remain usable with no horizontal page overflow.')
    assert.deepEqual(receipt.pageErrors, [])
    assert.deepEqual(receipt.externalRequests, [])
    receipt.pass = true
  } catch (error) {
    receipt.errors.push({ message: error.message, stack: error.stack })
    receipt.pass = false
    process.exitCode = 1
  } finally {
    await browser?.close()
    receipt.completedAt = new Date().toISOString()
    save()
    console.log(JSON.stringify({ pass: receipt.pass, cases: receipt.cases.length, checks: receipt.checks.length,
      screenshotHashes: receipt.screenshotHashes, pageErrors: receipt.pageErrors.length, externalRequests: receipt.externalRequests.length }))
  }
}

main()
