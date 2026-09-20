#!/usr/bin/env node
// Minimal browser-only reproduction: no IsleMind, SQLite, workers, libraries,
// cleanup, reload or application code executes in the tested pages.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
const executablePath = args.includes('--browser') && option('--browser')
const out = args.includes('--out') && path.resolve(option('--out'))
assert(executablePath && path.isAbsolute(executablePath) && out, 'Explicit resolved --browser and new --out are required')
assert(!fs.existsSync(out), 'Never overwrite a browser profile or prior evidence')
fs.mkdirSync(out, { recursive: true })

const beforeTimeoutMs = 590000, afterTimeoutMs = 610000
const report = { schema: 'islemind.chromium-opfs-idle-reproduction.v1', executablePath,
  startedAt: new Date().toISOString(), beforeTimeoutMs, afterTimeoutMs, cases: [],
  qualification: 'Browser-only experiment, not application qualification. Reproduced loss is not a durability pass.' }
const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
  response.end('<!doctype html><title>Native OPFS idle reproduction</title><p>No application loaded.</p>')
})
let browser, persistent

async function snapshot(page, retainedHandleFirst = false) {
  return page.evaluate(async retainedHandleFirst => {
    const result = { at: Date.now(), timeOrigin: performance.timeOrigin, href: location.href }
    const attempt = async work => {
      try { return { value: await work() } }
      catch (error) { return { error: error.name, message: error.message } }
    }
    if (retainedHandleFirst) result.retainedFile = await attempt(async () => (await savedFile.getFile()).text())
    result.retainedDirectory = await attempt(() => Array.fromAsync(savedRoot.keys()))
    const root = await navigator.storage.getDirectory()
    result.reopenedDirectory = await Array.fromAsync(root.keys())
    result.rootFile = await attempt(async () => (await (await root.getFileHandle('control.txt')).getFile()).text())
    result.nestedFile = await attempt(async () => {
      const directory = await root.getDirectoryHandle('independent')
      return (await (await directory.getFileHandle('leaf.txt')).getFile()).text()
    })
    result.quota = await navigator.storage.estimate()
    return result
  }, retainedHandleFirst)
}

async function experiment(name, context, idleMs, polled = false, retainedHandleFirst = false) {
  const page = await context.newPage()
  const result = { name, idleMs, polled, retainedHandleFirst, events: [], polls: [] }
  report.cases.push(result)
  for (const event of ['close', 'crash']) page.on(event, () => result.events.push({ event, at: Date.now() }))
  page.on('pageerror', error => result.events.push({ event: 'pageerror', message: String(error), at: Date.now() }))
  await page.goto(report.origin)
  result.seed = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const nested = await root.getDirectoryHandle('independent', { create: true })
    const control = await root.getFileHandle('control.txt', { create: true })
    const leaf = await nested.getFileHandle('leaf.txt', { create: true })
    for (const [file, data] of [[control, 'root control'], [leaf, 'nested control']]) {
      const writer = await file.createWritable()
      await writer.write(data)
      await writer.close()
    }
    globalThis.savedRoot = root
    globalThis.savedFile = control
    return { at: Date.now(), timeOrigin: performance.timeOrigin, href: location.href,
      entries: await Array.fromAsync(root.keys()), contents: await Promise.all([control, leaf].map(async file => (await file.getFile()).text())) }
  })
  save()
  const deadline = Date.now() + idleMs
  if (polled) {
    while (Date.now() + 30000 < deadline) {
      await sleep(30000)
      result.polls.push(await snapshot(page))
      save()
    }
  }
  // Crucially, untouched cases perform no Storage API call before the deadline.
  await sleep(Math.max(0, deadline - Date.now()))
  result.after = await snapshot(page, retainedHandleFirst)
  result.elapsedMs = result.after.at - result.seed.at
  result.retained = result.after.rootFile.value === 'root control' && result.after.nestedFile.value === 'nested control'
  result.samePage = result.after.timeOrigin === result.seed.timeOrigin && result.after.href === result.seed.href
  save()
}

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  report.origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ executablePath, headless: true })
  const cdp = await browser.newBrowserCDPSession()
  report.browser = await cdp.send('Browser.getVersion')
  await cdp.detach()
  persistent = await chromium.launchPersistentContext(path.join(out, 'persistent-profile'), { executablePath, headless: true })
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()))
  await Promise.all([
    experiment('private-before-timeout', contexts[0], beforeTimeoutMs),
    experiment('private-after-timeout', contexts[1], afterTimeoutMs),
    experiment('private-retained-handle-first', contexts[2], afterTimeoutMs, false, true),
    experiment('private-polled', contexts[3], afterTimeoutMs, true),
    experiment('persistent-untouched', persistent, afterTimeoutMs),
  ])
  const row = name => report.cases.find(item => item.name === name)
  report.controlsValid = ['private-before-timeout', 'private-polled', 'persistent-untouched'].every(name => row(name).retained)
    && report.cases.every(item => item.samePage && item.events.length === 0 && item.elapsedMs >= item.idleMs)
  report.reproduced = report.controlsValid && ['private-after-timeout', 'private-retained-handle-first'].every(name => !row(name).retained)
  report.completedAt = new Date().toISOString()
  assert(report.controlsValid, 'Control failed: do not draw a browser-specific idle-loss conclusion')
}

main().catch(error => { report.failure = String(error); process.exitCode = 1 })
  .finally(async () => {
    save()
    await browser?.close()
    await persistent?.close()
    server.close()
    console.log(JSON.stringify({ reproduced: report.reproduced, controlsValid: report.controlsValid, failure: report.failure, out }))
  })
