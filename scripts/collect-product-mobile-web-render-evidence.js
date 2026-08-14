const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const http = require('node:http')
const { execFileSync, spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const worklistPath = path.join(root, 'scripts/fixtures/worklists/product-mobile-web-render-evidence-worklist.json')
const storageEvidenceResultPath = 'test-evidence/qa/browser-storage-persistence-results.json'
const storageEvidenceArtifactDir = 'output/playwright/vnext-storage-evidence'
const storageAdapterRelativePath = 'src/platform/workspaces/asyncStorageTavernWorkspace.ts'
const browserDefinitions = Object.freeze({
  chrome: Object.freeze({
    id: 'chrome',
    label: 'Google Chrome',
    candidates: Object.freeze([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ]),
  }),
  edge: Object.freeze({
    id: 'edge',
    label: 'Microsoft Edge',
    candidates: Object.freeze([
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ]),
  }),
  'android-chromium': Object.freeze({
    id: 'android-chromium',
    label: 'Android Chromium',
    packageCandidates: Object.freeze(['com.android.chrome', 'com.android.browser']),
  }),
})

function parseArgs(argv) {
  const options = {
    baseUrl: '',
    output: 'test-evidence/qa/product-mobile-web-render-results.json',
    evidenceDir: 'test-evidence/qa/product-mobile-web-render',
    timeoutMs: 30000,
    selfTest: false,
    storageEvidenceOnly: false,
    browser: 'chrome',
    browserTransport: 'page',
    device: String(process.env.QA_DEVICE_SERIAL ?? '').trim(),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--self-test') {
      options.selfTest = true
    } else if (arg === '--storage-evidence-only') {
      options.storageEvidenceOnly = true
    } else if (arg === '--browser') {
      options.browser = argv[++index] ?? ''
    } else if (arg.startsWith('--browser=')) {
      options.browser = arg.slice('--browser='.length)
    } else if (arg === '--browser-transport') {
      options.browserTransport = argv[++index] ?? ''
    } else if (arg.startsWith('--browser-transport=')) {
      options.browserTransport = arg.slice('--browser-transport='.length)
    } else if (arg === '--device') {
      options.device = argv[++index] ?? ''
    } else if (arg.startsWith('--device=')) {
      options.device = arg.slice('--device='.length)
    } else if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? ''
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length)
    } else if (arg === '--output') {
      options.output = argv[++index] ?? options.output
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length)
    } else if (arg === '--evidence-dir') {
      options.evidenceDir = argv[++index] ?? options.evidenceDir
    } else if (arg.startsWith('--evidence-dir=')) {
      options.evidenceDir = arg.slice('--evidence-dir='.length)
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++index] ?? options.timeoutMs)
    } else if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number(arg.slice('--timeout-ms='.length))
    }
  }
  options.browser = String(options.browser).trim().toLowerCase()
  options.browserTransport = String(options.browserTransport).trim().toLowerCase()
  if (!browserDefinitions[options.browser]) {
    throw new Error(`Unsupported browser ${JSON.stringify(options.browser)}. Expected chrome, edge, or android-chromium.`)
  }
  if (!['page', 'cdp'].includes(options.browserTransport)) {
    throw new Error(`Unsupported browser transport ${JSON.stringify(options.browserTransport)}. Expected page or cdp.`)
  }
  options.device = String(options.device).trim()
  if (options.browser === 'android-chromium' && !/^[A-Za-z0-9._:-]+$/.test(options.device)) {
    throw new Error('Android Chromium storage evidence requires a safe explicit --device or QA_DEVICE_SERIAL value.')
  }
  if (options.browser === 'android-chromium' && options.browserTransport !== 'cdp') {
    throw new Error('Android Chromium storage evidence currently requires the explicit cdp browser transport.')
  }
  options.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.floor(options.timeoutMs) : 30000
  return options
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function validateBrowserStorageEvidence(result) {
  const issues = []
  if (!result || typeof result !== 'object') return ['Browser storage evidence must be an object.']
  if (result.schema !== 'islemind.browser-storage-persistence-evidence.v1') issues.push('Browser storage evidence schema is invalid.')
  if (result.status !== 'captured') issues.push('Browser storage evidence status must be captured.')
  if (!/^[a-f0-9]{64}$/.test(String(result.source?.adapterSha256 ?? ''))) issues.push('Browser storage adapter digest is missing.')
  if (!/^[a-f0-9]{64}$/.test(String(result.source?.bundleSha256 ?? ''))) issues.push('Browser storage bundle digest is missing.')
  if (result.restart?.profileReopened !== true || result.restart?.valuePersisted !== true) issues.push('Browser profile restart persistence was not proven.')
  if (result.restart?.writtenValue !== result.restart?.reopenedValue) issues.push('Browser profile restart value changed after reopen.')
  if (result.crossTab?.lockScope !== 'cross-context') issues.push('Browser storage adapter did not select cross-context locking.')
  if (result.crossTab?.navigatorLocksAvailable !== true) issues.push('Browser Web Locks API was unavailable.')
  if (result.crossTab?.finalCounter !== 2) issues.push('Two-tab exclusive updates did not both commit.')
  if (result.crossTab?.tabCount !== 2) issues.push('Browser storage evidence did not prove two real tabs.')
  if (result.crossTab?.overlapMs !== 0) issues.push('Two-tab exclusive work overlapped.')
  if (!Array.isArray(result.crossTab?.operations) || result.crossTab.operations.length !== 2) issues.push('Two-tab evidence must include two operations.')
  else {
    const transitions = result.crossTab.operations
      .map((operation) => `${operation.before}->${operation.after}`)
      .sort()
    if (transitions.join(',') !== '0->1,1->2') issues.push('Two-tab operations did not serialize as 0->1 then 1->2.')
    const labels = result.crossTab.operations.map((operation) => operation.label).sort()
    if (labels.join(',') !== 'tab-a,tab-b') issues.push('Browser storage evidence did not originate from both named tabs.')
  }
  if (Array.isArray(result.errors) && result.errors.length) issues.push(`Browser storage evidence recorded errors: ${result.errors.join('; ')}.`)
  return issues
}

function storageHarnessEntrySource() {
  return [
    `import { createAsyncStorageTavernWorkspacePort } from '../../../../src/platform/workspaces/asyncStorageTavernWorkspace.ts'`,
    `const port = createAsyncStorageTavernWorkspacePort()`,
    `const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))`,
    `globalThis.islemindStorageEvidence = {`,
    `  lockScope: port.lockScope,`,
    `  navigatorLocksAvailable: Boolean(globalThis.navigator?.locks),`,
    `  get: (key) => port.get(key),`,
    `  set: (key, value) => port.set(key, value),`,
    `  remove: (key) => port.remove(key),`,
    `  keys: () => port.getAllKeys(),`,
    `  runCounterUpdate: (key, label, holdMs) => port.runExclusive(key, async () => {`,
    `    const startedAt = performance.timeOrigin + performance.now()`,
    `    const before = Number.parseInt((await port.get(key)) ?? '0', 10) || 0`,
    `    await delay(holdMs)`,
    `    await port.set(key, String(before + 1))`,
    `    const finishedAt = performance.timeOrigin + performance.now()`,
    `    return { label, before, after: before + 1, startedAt, finishedAt }`,
    `  }),`,
    `}`,
    `const evidenceParams = new URLSearchParams(location.search)`,
    `const evidencePhase = evidenceParams.get('evidencePhase') || ''`,
    `const evidenceRunId = evidenceParams.get('runId') || ''`,
    `const evidenceRole = evidenceParams.get('role') || ''`,
    `const evidenceKey = 'islemind:vnext:browser-restart-evidence'`,
    `const counterKey = 'islemind:vnext:browser-cross-tab-counter'`,
    `const barrierPrefix = 'islemind:vnext:browser-evidence:' + evidenceRunId + ':'`,
    `const waitForLocalValue = async (key, expected, timeoutMs = 15000) => {`,
    `  const deadline = Date.now() + timeoutMs`,
    `  while (Date.now() < deadline) {`,
    `    if (localStorage.getItem(key) === expected) return`,
    `    await delay(25)`,
    `  }`,
    `  throw new Error('Timed out waiting for browser evidence barrier ' + key)`,
    `}`,
    `const postEvidence = async (kind, payload = {}) => {`,
    `  const response = await fetch('/evidence', {`,
    `    method: 'POST',`,
    `    headers: { 'Content-Type': 'application/json' },`,
    `    body: JSON.stringify({ runId: evidenceRunId, kind, ...payload }),`,
    `  })`,
    `  if (!response.ok) throw new Error('Browser evidence endpoint rejected ' + kind + ' with ' + response.status)`,
    `}`,
    `const runBrowserPageEvidence = async () => {`,
    `  if (!evidencePhase) return`,
    `  if (!/^[a-f0-9-]{16,64}$/.test(evidenceRunId)) throw new Error('Browser evidence run identity is invalid.')`,
    `  if (evidencePhase === 'write') {`,
    `    const value = JSON.stringify({ schema: 'islemind.browser-restart.v1', marker: crypto.randomUUID() })`,
    `    await port.remove(evidenceKey)`,
    `    await port.set(evidenceKey, value)`,
    `    const persisted = await port.get(evidenceKey)`,
    `    if (persisted !== value) throw new Error('Browser evidence write did not reread exactly.')`,
    `    await postEvidence('restart-written', { value })`,
    `    return`,
    `  }`,
    `  if (evidencePhase !== 'verify' || !['a', 'b'].includes(evidenceRole)) {`,
    `    throw new Error('Browser evidence phase or role is invalid.')`,
    `  }`,
    `  const readyKey = barrierPrefix + 'ready'`,
    `  const joinedKey = barrierPrefix + 'joined'`,
    `  const goKey = barrierPrefix + 'go'`,
    `  const doneAKey = barrierPrefix + 'done-a'`,
    `  const doneBKey = barrierPrefix + 'done-b'`,
    `  if (evidenceRole === 'a') {`,
    `    const reopenedValue = await port.get(evidenceKey)`,
    `    await postEvidence('restart-read', { value: reopenedValue })`,
    `    const peerUrl = evidenceParams.get('peerUrl') || ''`,
    `    if (!peerUrl.startsWith(location.origin + '/?')) throw new Error('Browser evidence peer URL is invalid.')`,
    `    const peerWindow = window.open(peerUrl, 'islemind-storage-evidence-peer')`,
    `    if (!peerWindow) throw new Error('Browser evidence peer tab could not be opened.')`,
    `    await port.set(counterKey, '0')`,
    `    for (const key of [readyKey, joinedKey, goKey, doneAKey, doneBKey]) localStorage.removeItem(key)`,
    `    localStorage.setItem(readyKey, '1')`,
    `    await waitForLocalValue(joinedKey, '1')`,
    `    localStorage.setItem(goKey, '1')`,
    `  } else {`,
    `    await waitForLocalValue(readyKey, '1')`,
    `    localStorage.setItem(joinedKey, '1')`,
    `    await waitForLocalValue(goKey, '1')`,
    `  }`,
    `  const operation = await globalThis.islemindStorageEvidence.runCounterUpdate(`,
    `    counterKey,`,
    `    evidenceRole === 'a' ? 'tab-a' : 'tab-b',`,
    `    evidenceRole === 'a' ? 350 : 120,`,
    `  )`,
    `  localStorage.setItem(evidenceRole === 'a' ? doneAKey : doneBKey, '1')`,
    `  await postEvidence('operation', { operation })`,
    `  if (evidenceRole === 'a') {`,
    `    await waitForLocalValue(doneBKey, '1')`,
    `    const finalCounter = Number.parseInt((await port.get(counterKey)) || '', 10)`,
    `    await postEvidence('cross-tab-summary', {`,
    `      finalCounter,`,
    `      lockScope: port.lockScope,`,
    `      navigatorLocksAvailable: Boolean(globalThis.navigator?.locks),`,
    `    })`,
    `    await port.remove(evidenceKey)`,
    `    await port.remove(counterKey)`,
    `    for (const key of [readyKey, joinedKey, goKey, doneAKey, doneBKey]) localStorage.removeItem(key)`,
    `  }`,
    `}`,
    `document.body.dataset.ready = 'true'`,
    `void runBrowserPageEvidence().catch(async (error) => {`,
    `  document.body.dataset.error = 'true'`,
    `  if (/^[a-f0-9-]{16,64}$/.test(evidenceRunId)) {`,
    `    await postEvidence('error', { message: String(error?.message ?? error).slice(0, 500) }).catch(() => undefined)`,
    `  }`,
    `})`,
  ].join('\n')
}

async function buildStorageEvidenceHarness(artifactRoot) {
  if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
    throw new Error('The storage evidence collector must run with Bun so the current TypeScript adapter can be bundled.')
  }
  const harnessDir = path.join(artifactRoot, 'harness')
  fs.mkdirSync(harnessDir, { recursive: true })
  const entryPath = path.join(harnessDir, 'entry.js')
  const bundlePath = path.join(harnessDir, 'bundle.js')
  const htmlPath = path.join(harnessDir, 'index.html')
  fs.writeFileSync(entryPath, `${storageHarnessEntrySource()}\n`, 'utf8')
  const build = await Bun.build({
    entrypoints: [entryPath],
    outdir: harnessDir,
    naming: 'bundle.js',
    target: 'browser',
    minify: false,
    sourcemap: 'none',
  })
  if (!build.success || !fs.existsSync(bundlePath)) {
    const messages = (build.logs ?? []).map((item) => item.message).join('; ')
    throw new Error(`Could not bundle the current browser storage adapter: ${messages || 'unknown build failure'}`)
  }
  fs.writeFileSync(htmlPath, '<!doctype html><html><head><meta charset="utf-8"><title>IsleMind storage evidence</title></head><body><main>IsleMind current-source storage evidence</main><script type="module" src="/bundle.js"></script></body></html>\n', 'utf8')
  return { bundlePath, htmlPath }
}

async function listenStorageHarness(harness) {
  const events = []
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/evidence') {
      let body = ''
      let bytes = 0
      request.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes <= 32768) body += chunk.toString('utf8')
      })
      request.on('end', () => {
        try {
          if (bytes > 32768) throw new Error('Browser evidence event exceeded 32 KiB.')
          const event = JSON.parse(body)
          if (!event || typeof event !== 'object' || !/^[a-f0-9-]{16,64}$/.test(String(event.runId ?? ''))) {
            throw new Error('Browser evidence event identity is invalid.')
          }
          events.push(event)
          response.writeHead(204, { 'Cache-Control': 'no-store' })
          response.end()
        } catch (error) {
          response.writeHead(400, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
          response.end(String(error?.message ?? error).slice(0, 500))
        }
      })
      return
    }
    const file = request.url === '/bundle.js' ? harness.bundlePath : harness.htmlPath
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': request.url === '/bundle.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    })
    response.end(fs.readFileSync(file))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not resolve the storage evidence loopback server address.')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    events,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

async function waitForStorageEvidenceEvent(server, runId, kind, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const errorIndex = server.events.findIndex((event) => event.runId === runId && event.kind === 'error')
    if (errorIndex >= 0) {
      const [event] = server.events.splice(errorIndex, 1)
      throw new Error(`Browser-native storage harness failed: ${String(event.message ?? 'unknown error')}`)
    }
    const index = server.events.findIndex((event) => event.runId === runId && event.kind === kind)
    if (index >= 0) return server.events.splice(index, 1)[0]
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Browser-native storage harness did not report ${kind} within ${timeoutMs}ms.`)
}

async function waitForStorageHarness(page, origin, timeoutMs) {
  await page.goto(origin, { waitUntil: 'load', timeout: timeoutMs })
  await page.waitForFunction(() => Boolean(globalThis.islemindStorageEvidence && document.body.dataset.ready === 'true'), null, { timeout: timeoutMs })
}

function resolveBrowserExecutable(browserId, existsSync = fs.existsSync) {
  const definition = browserDefinitions[browserId]
  if (!definition) throw new Error(`Unsupported browser ${JSON.stringify(browserId)}.`)
  if (!Array.isArray(definition.candidates)) {
    return { id: definition.id, label: definition.label, executable: null }
  }
  return {
    id: definition.id,
    label: definition.label,
    executable: definition.candidates.find((candidate) => existsSync(candidate)) ?? null,
  }
}

function runAdb(device, args, timeoutMs = 30000) {
  return execFileSync('adb', ['-s', device, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    windowsHide: true,
  }).trim()
}

function resolveAndroidBrowserPackage(device, adb = runAdb) {
  for (const packageName of browserDefinitions['android-chromium'].packageCandidates) {
    try {
      if (/^package:/.test(adb(device, ['shell', 'pm', 'path', packageName]))) return packageName
    } catch {
      // Continue to the next explicitly supported Chromium package.
    }
  }
  throw new Error(`No supported Android Chromium package is installed on ${device}.`)
}

function resolveAndroidDevToolsSocket(unixSockets, packageName) {
  const candidates = [...String(unixSockets ?? '').matchAll(/@(chrome_devtools_remote(?:_\d+)?|browser_webview_devtools_remote_\d+)\b/g)]
    .map((match) => match[1])
  const preferredPrefix = packageName === 'com.android.chrome' ? 'chrome_devtools_remote' : 'browser_webview_devtools_remote_'
  return candidates.find((candidate) => candidate.startsWith(preferredPrefix)) ?? candidates[0] ?? null
}

function removeAndroidForward(device, port) {
  if (!port) return
  try {
    runAdb(device, ['forward', '--remove', `tcp:${port}`])
  } catch {
    // Best-effort cleanup cannot replace the evidence outcome.
  }
}

function removeAndroidReverse(device, port) {
  if (!port) return
  try {
    runAdb(device, ['reverse', '--remove', `tcp:${port}`])
  } catch {
    // Best-effort cleanup cannot replace the evidence outcome.
  }
}

async function launchAndroidChromiumBrowser(playwright, device, packageName, origin, timeoutMs, onForward = () => undefined) {
  runAdb(device, ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', origin, packageName], timeoutMs)
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const unixSockets = runAdb(device, ['shell', 'cat', '/proc/net/unix'])
      const socket = resolveAndroidDevToolsSocket(unixSockets, packageName)
      if (socket) {
        const port = Number.parseInt(runAdb(device, ['forward', 'tcp:0', `localabstract:${socket}`]), 10)
        if (!Number.isInteger(port) || port <= 0) throw new Error('adb did not return a valid loopback DevTools port.')
        onForward(port)
        try {
          const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: timeoutMs })
          const context = browser.contexts()[0]
          if (!context) throw new Error('Android Chromium DevTools did not expose a persistent browser context.')
          return { browser, context, device, packageName, port, socket }
        } catch (error) {
          removeAndroidForward(device, port)
          throw error
        }
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`Android Chromium did not expose a usable DevTools socket within ${timeoutMs}ms: ${lastError?.message ?? 'socket unavailable'}`)
}

async function closeAndroidChromiumSession(session) {
  if (!session) return
  await session.browser.close().catch(() => undefined)
  removeAndroidForward(session.device, session.port)
}

async function waitForDevToolsPort(profilePath, child, timeoutMs, browserLabel) {
  const portFile = path.join(profilePath, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${browserLabel} exited before exposing DevTools (code ${child.exitCode}).`)
    if (fs.existsSync(portFile)) {
      const port = Number.parseInt(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0], 10)
      if (Number.isInteger(port) && port > 0) return port
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`${browserLabel} did not expose a DevTools port within ${timeoutMs}ms.`)
}

async function launchPersistentBrowser(playwright, profilePath, timeoutMs, browserId) {
  const selectedBrowser = resolveBrowserExecutable(browserId)
  if (!selectedBrowser.executable) throw new Error(`${selectedBrowser.label} is not installed at a supported physical path.`)
  fs.mkdirSync(profilePath, { recursive: true })
  const child = spawn(selectedBrowser.executable, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--disable-session-crashed-bubble',
    '--disable-sync',
    '--hide-crash-restore-bubble',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-sandbox',
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0',
    `--user-data-dir=${profilePath}`,
    'about:blank',
  ], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  })
  try {
    const port = await waitForDevToolsPort(profilePath, child, timeoutMs, selectedBrowser.label)
    const browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: timeoutMs })
    const context = browser.contexts()[0]
    if (!context) throw new Error(`${selectedBrowser.label} DevTools connection did not expose a persistent browser context.`)
    return { browser, child, context, port, selectedBrowser }
  } catch (error) {
    if (child.exitCode === null) child.kill()
    throw error
  }
}

async function closePersistentBrowser(session) {
  if (!session) return
  await session.browser.close().catch(() => undefined)
  if (session.child.exitCode === null) session.child.kill()
}

function launchBrowserPageSession(profilePath, browserId, urls) {
  const selectedBrowser = resolveBrowserExecutable(browserId)
  if (!selectedBrowser.executable) throw new Error(`${selectedBrowser.label} is not installed at a supported physical path.`)
  fs.mkdirSync(profilePath, { recursive: true })
  const child = spawn(selectedBrowser.executable, [
    '--headless=new',
    '--disable-background-mode',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--disable-session-crashed-bubble',
    '--disable-sync',
    '--hide-crash-restore-bubble',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-sandbox',
    `--user-data-dir=${profilePath}`,
    ...urls,
  ], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  })
  const version = (() => {
    try {
      return execFileSync(selectedBrowser.executable, ['--version'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10000,
        windowsHide: true,
      }).trim()
    } catch {
      return 'unavailable'
    }
  })()
  return { child, selectedBrowser, version }
}

async function closeBrowserPageSession(session) {
  if (!session?.child || browserChildHasExited(session.child)) return
  const child = session.child
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T'], {
      cwd: root,
      stdio: 'ignore',
      timeout: 10000,
      windowsHide: true,
    })
  } catch {
    // Fall through to exact-tree force cleanup only when graceful shutdown is unavailable.
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
  if (browserChildHasExited(child)) return
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      cwd: root,
      stdio: 'ignore',
      timeout: 10000,
      windowsHide: true,
    })
  } catch {
    if (!browserChildHasExited(child)) child.kill()
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))])
  if (!browserChildHasExited(child)) throw new Error(`Owned ${session.selectedBrowser.label} process ${child.pid} did not exit.`)
}

function browserChildHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null
}

async function collectAndroidChromiumStorageEvidence(options) {
  const playwright = loadPlaywright()
  const artifactRoot = resolveInsideRoot(storageEvidenceArtifactDir)
  const screenshotPath = path.join(artifactRoot, 'browser-storage-evidence-android.png')
  const adapterPath = resolveInsideRoot(storageAdapterRelativePath)
  const selectedBrowser = resolveBrowserExecutable(options.browser)
  const errors = []
  let server = null
  let browserSession = null
  let devicePort = null
  let forwardedPort = null
  let packageName = null
  let result = null
  try {
    if (!playwright?.chromium) throw new Error('Playwright Chromium is not available in this workspace.')
    const harness = await buildStorageEvidenceHarness(artifactRoot)
    server = await listenStorageHarness(harness)
    devicePort = Number.parseInt(new URL(server.origin).port, 10)
    if (!Number.isInteger(devicePort) || devicePort <= 0) throw new Error('The storage evidence harness did not expose a valid loopback port.')
    packageName = resolveAndroidBrowserPackage(options.device)
    runAdb(options.device, ['reverse', `tcp:${devicePort}`, `tcp:${devicePort}`])

    const evidenceKey = 'islemind:vnext:browser-restart-evidence'
    const counterKey = 'islemind:vnext:browser-cross-tab-counter'
    const writtenValue = JSON.stringify({ schema: 'islemind.browser-restart.v1', marker: crypto.randomUUID() })

    browserSession = await launchAndroidChromiumBrowser(playwright, options.device, packageName, server.origin, options.timeoutMs, (port) => {
      forwardedPort = port
    })
    let context = browserSession.context
    let page = context.pages()[0] ?? await context.newPage()
    await waitForStorageHarness(page, server.origin, options.timeoutMs)
    await page.evaluate(async ({ evidenceKey, writtenValue }) => {
      await globalThis.islemindStorageEvidence.remove(evidenceKey)
      await globalThis.islemindStorageEvidence.set(evidenceKey, writtenValue)
    }, { evidenceKey, writtenValue })
    await closeAndroidChromiumSession(browserSession)
    browserSession = null
    runAdb(options.device, ['shell', 'am', 'force-stop', packageName])

    browserSession = await launchAndroidChromiumBrowser(playwright, options.device, packageName, server.origin, options.timeoutMs, (port) => {
      forwardedPort = port
    })
    context = browserSession.context
    page = context.pages()[0] ?? await context.newPage()
    await waitForStorageHarness(page, server.origin, options.timeoutMs)
    const reopenedValue = await page.evaluate((key) => globalThis.islemindStorageEvidence.get(key), evidenceKey)
    const firstTab = page
    const secondTab = await context.newPage()
    await waitForStorageHarness(secondTab, server.origin, options.timeoutMs)
    await firstTab.evaluate((key) => globalThis.islemindStorageEvidence.set(key, '0'), counterKey)
    const [firstOperation, secondOperation] = await Promise.all([
      firstTab.evaluate((key) => globalThis.islemindStorageEvidence.runCounterUpdate(key, 'tab-a', 350), counterKey),
      secondTab.evaluate((key) => globalThis.islemindStorageEvidence.runCounterUpdate(key, 'tab-b', 120), counterKey),
    ])
    const finalCounter = Number.parseInt(await firstTab.evaluate((key) => globalThis.islemindStorageEvidence.get(key), counterKey), 10)
    const runtime = await firstTab.evaluate(() => ({
      lockScope: globalThis.islemindStorageEvidence.lockScope,
      navigatorLocksAvailable: globalThis.islemindStorageEvidence.navigatorLocksAvailable,
    }))
    await firstTab.screenshot({ path: screenshotPath, fullPage: true })
    await firstTab.evaluate(async ({ evidenceKey, counterKey }) => {
      await globalThis.islemindStorageEvidence.remove(evidenceKey)
      await globalThis.islemindStorageEvidence.remove(counterKey)
    }, { evidenceKey, counterKey })

    const operations = [firstOperation, secondOperation]
    result = {
      schema: 'islemind.browser-storage-persistence-evidence.v1',
      status: 'captured',
      generatedAt: new Date().toISOString(),
      runner: 'Current-source AsyncStorage Tavern adapter + Playwright Android Chromium CDP',
      source: {
        adapter: storageAdapterRelativePath,
        adapterSha256: sha256File(adapterPath),
        bundle: normalizeEvidencePath(path.relative(root, harness.bundlePath)),
        bundleSha256: sha256File(harness.bundlePath),
      },
      browser: {
        id: selectedBrowser.id,
        package: packageName,
        device: options.device,
        version: browserSession.browser.version(),
        devToolsSocket: browserSession.socket,
        persistentProfile: `android-package-data:${packageName}`,
      },
      restart: { profileReopened: true, valuePersisted: reopenedValue === writtenValue, writtenValue, reopenedValue },
      crossTab: { ...runtime, tabCount: 2, finalCounter, overlapMs: operationsOverlapMs(operations), operations },
      screenshot: normalizeEvidencePath(path.relative(root, screenshotPath)),
      errors,
    }
  } catch (error) {
    errors.push(sanitizeBrowserEvidenceError(error?.message ?? error))
    result = {
      schema: 'islemind.browser-storage-persistence-evidence.v1',
      status: 'blocked',
      generatedAt: new Date().toISOString(),
      runner: 'Current-source AsyncStorage Tavern adapter + Playwright Android Chromium CDP',
      browser: { id: selectedBrowser.id, package: packageName, device: options.device },
      errors,
    }
  } finally {
    if (browserSession) await closeAndroidChromiumSession(browserSession)
    if (packageName) {
      try {
        runAdb(options.device, ['shell', 'am', 'force-stop', packageName])
      } catch {
        // Browser shutdown is best-effort after the evidence result is fixed.
      }
    }
    removeAndroidForward(options.device, forwardedPort)
    removeAndroidReverse(options.device, devicePort)
    if (server) await server.close().catch(() => undefined)
  }
  const issues = validateBrowserStorageEvidence(result)
  const written = writeResult(storageEvidenceResultPath, result)
  return { result, written, issues }
}

function operationsOverlapMs(operations) {
  if (!Array.isArray(operations) || operations.length !== 2) return null
  const ordered = [...operations].sort((left, right) => left.startedAt - right.startedAt)
  return Math.max(0, Math.min(ordered[0].finishedAt, ordered[1].finishedAt) - Math.max(ordered[0].startedAt, ordered[1].startedAt))
}

function sanitizeBrowserEvidenceError(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000)
}

async function collectBrowserPageStorageEvidence(options) {
  const artifactRoot = resolveInsideRoot(storageEvidenceArtifactDir)
  const selectedBrowser = resolveBrowserExecutable(options.browser)
  const profilePath = path.join(artifactRoot, `current-source-${selectedBrowser.id}-page-profile-${process.pid}`)
  const adapterPath = resolveInsideRoot(storageAdapterRelativePath)
  const errors = []
  const runId = crypto.randomUUID()
  let server = null
  let browserSession = null
  let result = null
  let firstPid = null
  let secondPid = null
  try {
    if (options.browser === 'android-chromium') {
      throw new Error('The browser-native page transport currently supports installed desktop Chrome or Edge only.')
    }
    fs.mkdirSync(profilePath, { recursive: true })
    const harness = await buildStorageEvidenceHarness(artifactRoot)
    server = await listenStorageHarness(harness)

    const writeUrl = new URL(server.origin)
    writeUrl.searchParams.set('evidencePhase', 'write')
    writeUrl.searchParams.set('runId', runId)
    browserSession = launchBrowserPageSession(profilePath, selectedBrowser.id, [writeUrl.toString()])
    firstPid = browserSession.child.pid
    const writtenEvent = await waitForStorageEvidenceEvent(server, runId, 'restart-written', options.timeoutMs)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await closeBrowserPageSession(browserSession)
    browserSession = null
    await new Promise((resolve) => setTimeout(resolve, 250))

    const firstTabUrl = new URL(server.origin)
    firstTabUrl.searchParams.set('evidencePhase', 'verify')
    firstTabUrl.searchParams.set('runId', runId)
    firstTabUrl.searchParams.set('role', 'a')
    const secondTabUrl = new URL(firstTabUrl)
    secondTabUrl.searchParams.set('role', 'b')
    firstTabUrl.searchParams.set('peerUrl', secondTabUrl.toString())
    browserSession = launchBrowserPageSession(profilePath, selectedBrowser.id, [firstTabUrl.toString()])
    secondPid = browserSession.child.pid

    const reopenedEvent = await waitForStorageEvidenceEvent(server, runId, 'restart-read', options.timeoutMs)
    const firstOperationEvent = await waitForStorageEvidenceEvent(server, runId, 'operation', options.timeoutMs)
    const secondOperationEvent = await waitForStorageEvidenceEvent(server, runId, 'operation', options.timeoutMs)
    const summaryEvent = await waitForStorageEvidenceEvent(server, runId, 'cross-tab-summary', options.timeoutMs)
    const operations = [firstOperationEvent.operation, secondOperationEvent.operation]
    result = {
      schema: 'islemind.browser-storage-persistence-evidence.v1',
      status: 'captured',
      generatedAt: new Date().toISOString(),
      runner: `Current-source AsyncStorage Tavern adapter + browser-native persistent ${selectedBrowser.label}`,
      source: {
        adapter: storageAdapterRelativePath,
        adapterSha256: sha256File(adapterPath),
        bundle: normalizeEvidencePath(path.relative(root, harness.bundlePath)),
        bundleSha256: sha256File(harness.bundlePath),
      },
      browser: {
        id: selectedBrowser.id,
        transport: 'page',
        executable: selectedBrowser.executable,
        version: browserSession.version,
        persistentProfile: normalizeEvidencePath(path.relative(root, profilePath)),
        launchPids: [firstPid, secondPid],
      },
      restart: {
        profileReopened: Number.isInteger(firstPid) && Number.isInteger(secondPid) && firstPid !== secondPid,
        valuePersisted: reopenedEvent.value === writtenEvent.value,
        writtenValue: writtenEvent.value,
        reopenedValue: reopenedEvent.value,
      },
      crossTab: {
        lockScope: summaryEvent.lockScope,
        navigatorLocksAvailable: summaryEvent.navigatorLocksAvailable,
        tabCount: 2,
        finalCounter: summaryEvent.finalCounter,
        overlapMs: operationsOverlapMs(operations),
        operations,
      },
      errors,
    }
  } catch (error) {
    errors.push(sanitizeBrowserEvidenceError(error?.message ?? error))
    result = {
      schema: 'islemind.browser-storage-persistence-evidence.v1',
      status: 'blocked',
      generatedAt: new Date().toISOString(),
      runner: `Current-source AsyncStorage Tavern adapter + browser-native persistent ${selectedBrowser.label}`,
      browser: { id: selectedBrowser.id, transport: 'page', executable: selectedBrowser.executable },
      errors,
    }
  } finally {
    if (browserSession) await closeBrowserPageSession(browserSession).catch((error) => {
      errors.push(sanitizeBrowserEvidenceError(error?.message ?? error))
    })
    if (server) await server.close().catch(() => undefined)
  }
  const issues = validateBrowserStorageEvidence(result)
  const written = writeResult(storageEvidenceResultPath, result)
  return { result, written, issues }
}

async function collectBrowserStorageEvidence(options) {
  if (options.browserTransport === 'page') return collectBrowserPageStorageEvidence(options)
  if (options.browser === 'android-chromium') return collectAndroidChromiumStorageEvidence(options)
  const playwright = loadPlaywright()
  const artifactRoot = resolveInsideRoot(storageEvidenceArtifactDir)
  const selectedBrowser = resolveBrowserExecutable(options.browser)
  const profilePath = path.join(artifactRoot, `current-source-${selectedBrowser.id}-profile-${process.pid}`)
  const screenshotPath = path.join(artifactRoot, 'browser-storage-evidence.png')
  const adapterPath = resolveInsideRoot(storageAdapterRelativePath)
  const errors = []
  let server = null
  let browserSession = null
  let result = null
  try {
    if (!playwright?.chromium) throw new Error('Playwright Chromium is not available in this workspace.')
    fs.mkdirSync(profilePath, { recursive: true })
    const harness = await buildStorageEvidenceHarness(artifactRoot)
    server = await listenStorageHarness(harness)
    const evidenceKey = 'islemind:vnext:browser-restart-evidence'
    const counterKey = 'islemind:vnext:browser-cross-tab-counter'
    const writtenValue = JSON.stringify({ schema: 'islemind.browser-restart.v1', marker: crypto.randomUUID() })

    browserSession = await launchPersistentBrowser(playwright, profilePath, options.timeoutMs, selectedBrowser.id)
    let context = browserSession.context
    let page = context.pages()[0] ?? await context.newPage()
    await waitForStorageHarness(page, server.origin, options.timeoutMs)
    await page.evaluate(async ({ evidenceKey, writtenValue }) => {
      await globalThis.islemindStorageEvidence.remove(evidenceKey)
      await globalThis.islemindStorageEvidence.set(evidenceKey, writtenValue)
    }, { evidenceKey, writtenValue })
    await closePersistentBrowser(browserSession)
    browserSession = null

    browserSession = await launchPersistentBrowser(playwright, profilePath, options.timeoutMs, selectedBrowser.id)
    context = browserSession.context
    page = context.pages()[0] ?? await context.newPage()
    await waitForStorageHarness(page, server.origin, options.timeoutMs)
    const reopenedValue = await page.evaluate((key) => globalThis.islemindStorageEvidence.get(key), evidenceKey)
    const firstTab = page
    const secondTab = await context.newPage()
    await waitForStorageHarness(secondTab, server.origin, options.timeoutMs)
    await firstTab.evaluate((key) => globalThis.islemindStorageEvidence.set(key, '0'), counterKey)
    const [firstOperation, secondOperation] = await Promise.all([
      firstTab.evaluate((key) => globalThis.islemindStorageEvidence.runCounterUpdate(key, 'tab-a', 350), counterKey),
      secondTab.evaluate((key) => globalThis.islemindStorageEvidence.runCounterUpdate(key, 'tab-b', 120), counterKey),
    ])
    const finalCounter = Number.parseInt(await firstTab.evaluate((key) => globalThis.islemindStorageEvidence.get(key), counterKey), 10)
    const runtime = await firstTab.evaluate(() => ({
      lockScope: globalThis.islemindStorageEvidence.lockScope,
      navigatorLocksAvailable: globalThis.islemindStorageEvidence.navigatorLocksAvailable,
    }))
    await firstTab.screenshot({ path: screenshotPath, fullPage: true })
    await firstTab.evaluate(async ({ evidenceKey, counterKey }) => {
      await globalThis.islemindStorageEvidence.remove(evidenceKey)
      await globalThis.islemindStorageEvidence.remove(counterKey)
    }, { evidenceKey, counterKey })

    const operations = [firstOperation, secondOperation]
    result = {
      schema: 'islemind.browser-storage-persistence-evidence.v1',
      status: 'captured',
      generatedAt: new Date().toISOString(),
      runner: `Current-source AsyncStorage Tavern adapter + Playwright persistent ${selectedBrowser.label}`,
      source: {
        adapter: storageAdapterRelativePath,
        adapterSha256: sha256File(adapterPath),
        bundle: normalizeEvidencePath(path.relative(root, harness.bundlePath)),
        bundleSha256: sha256File(harness.bundlePath),
      },
      browser: {
        id: selectedBrowser.id,
        executable: selectedBrowser.executable,
        version: browserSession.browser.version(),
        persistentProfile: normalizeEvidencePath(path.relative(root, profilePath)),
      },
      restart: { profileReopened: true, valuePersisted: reopenedValue === writtenValue, writtenValue, reopenedValue },
      crossTab: { ...runtime, tabCount: 2, finalCounter, overlapMs: operationsOverlapMs(operations), operations },
      screenshot: normalizeEvidencePath(path.relative(root, screenshotPath)),
      errors,
    }
  } catch (error) {
    errors.push(sanitizeBrowserEvidenceError(error?.message ?? error))
    result = {
      schema: 'islemind.browser-storage-persistence-evidence.v1',
      status: 'blocked',
      generatedAt: new Date().toISOString(),
      runner: `Current-source AsyncStorage Tavern adapter + Playwright persistent ${selectedBrowser.label}`,
      browser: { id: selectedBrowser.id, executable: selectedBrowser.executable },
      errors,
    }
  } finally {
    if (browserSession) await closePersistentBrowser(browserSession)
    if (server) await server.close().catch(() => undefined)
  }
  const issues = validateBrowserStorageEvidence(result)
  const written = writeResult(storageEvidenceResultPath, result)
  return { result, written, issues }
}

function readWorklist() {
  return JSON.parse(fs.readFileSync(worklistPath, 'utf8'))
}

function normalizeEvidencePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '')
}

function resolveInsideRoot(relativePath) {
  const normalized = normalizeEvidencePath(relativePath)
  const absolute = path.resolve(root, normalized)
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (absolute !== root && !absolute.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing to write outside repository root: ${relativePath}`)
  }
  return absolute
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value ?? ''))
  if (!match) throw new Error(`Invalid viewport ${value}`)
  return { width: Number(match[1]), height: Number(match[2]) }
}

function createBlockedResult(status, errors) {
  return {
    schema: 'islemind.product-mobile-web-render-results.v1',
    status,
    runner: 'Expo Web + Playwright',
    note: 'Web viewport evidence only; native device/ADB evidence remains separate.',
    captures: [],
    fixedDuringRun: [],
    errors: errors.map((message) => ({ message })),
  }
}

function writeResult(relativeOutputPath, result) {
  const outputPath = resolveInsideRoot(relativeOutputPath)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  return outputPath
}

function loadPlaywright() {
  try {
    return require('playwright')
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return null
    throw error
  }
}

function requiredCaptures(worklist) {
  return [
    ...(worklist.requiredCaptures ?? []),
    ...(worklist.appearanceRequiredCaptures ?? []),
  ]
}

function readPngDimensions(filePath) {
  const png = fs.readFileSync(filePath)
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error(`Expected a PNG screenshot at ${path.relative(root, filePath)}`)
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

function assertAppearanceDefinition(expected) {
  const appearance = expected.appearance
  if (!appearance) return
  if (!['minimal', 'lime-road', 'markdown'].includes(appearance.family)) {
    throw new Error(`Appearance capture ${expected.id} has an invalid family`)
  }
  if (!['light', 'dark', 'system'].includes(appearance.mode)) {
    throw new Error(`Appearance capture ${expected.id} has an invalid mode`)
  }
  if (!['default', 'teal', 'indigo', 'coral', 'amber', 'custom'].includes(appearance.accentId)) {
    throw new Error(`Appearance capture ${expected.id} has an invalid accent id`)
  }
  if (appearance.accentId === 'custom' && !/^#[0-9A-F]{6}$/i.test(appearance.accent ?? '')) {
    throw new Error(`Appearance capture ${expected.id} requires a six-digit custom accent`)
  }
}

async function waitForChecked(locator, label) {
  await locator.waitFor({ state: 'visible' })
  const ariaChecked = await locator.getAttribute('aria-checked')
  if (ariaChecked !== 'true') throw new Error(`${label} is not aria-checked`)
}

async function inspectRadioGroup(page, groupTestId, expectedCheckedTestId) {
  const group = page.getByTestId(groupTestId)
  await group.waitFor({ state: 'visible' })
  const role = await group.getAttribute('role')
  if (role !== 'radiogroup') throw new Error(`${groupTestId} must render role=radiogroup (got ${role ?? 'none'})`)

  const radios = group.getByRole('radio')
  const count = await radios.count()
  if (!count) throw new Error(`${groupTestId} does not render radio controls`)

  const states = []
  for (let index = 0; index < count; index += 1) {
    const radio = radios.nth(index)
    const testId = await radio.getAttribute('data-testid')
    const ariaChecked = await radio.getAttribute('aria-checked')
    if (ariaChecked !== 'true' && ariaChecked !== 'false') {
      throw new Error(`${groupTestId} radio ${testId ?? index} is missing aria-checked`)
    }
    states.push({ testId, ariaChecked })
  }

  const checked = states.filter((state) => state.ariaChecked === 'true')
  if (checked.length !== 1 || checked[0].testId !== expectedCheckedTestId) {
    throw new Error(`${groupTestId} must have exactly ${expectedCheckedTestId} checked (got ${checked.map((state) => state.testId).join(', ') || 'none'})`)
  }
  return { role, radioCount: count, checkedTestId: checked[0].testId }
}

async function inspectViewportBounds(page, testId) {
  const control = page.getByTestId(testId)
  await control.scrollIntoViewIfNeeded()
  const bounds = await control.boundingBox()
  const viewport = page.viewportSize()
  if (!bounds || !viewport) throw new Error(`${testId} has no rendered bounds`)
  const withinViewport = bounds.x >= 0
    && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width
    && bounds.y + bounds.height <= viewport.height
  if (!withinViewport) throw new Error(`${testId} exceeds the ${viewport.width}x${viewport.height} viewport`)
  return { ...bounds, viewport, withinViewport }
}

async function prepareAppearanceCapture(page, expected) {
  const appearance = expected.appearance
  if (!appearance) return undefined
  assertAppearanceDefinition(expected)

  await page.getByTestId('settings-control-tab-system').click()
  await page.getByTestId('settings-appearance-toggle').click()
  const foldout = page.getByTestId('settings-appearance-foldout')
  await foldout.waitFor({ state: 'visible' })

  const family = page.getByTestId(`settings-theme-family-${appearance.family}`)
  await family.click()
  await waitForChecked(family, `family ${appearance.family}`)

  const mode = page.getByTestId(`settings-theme-mode-${appearance.mode}`)
  await mode.click()
  await waitForChecked(mode, `mode ${appearance.mode}`)

  const accent = page.getByTestId(`settings-theme-accent-${appearance.accentId}`)
  if (appearance.accentId === 'custom') {
    const input = page.getByTestId('settings-theme-accent-input')
    await input.fill(appearance.accent)
    await page.getByTestId('settings-theme-accent-apply').click()
  } else {
    await accent.click()
  }
  await waitForChecked(accent, `accent ${appearance.accentId}`)

  const radioGroups = {
    family: await inspectRadioGroup(page, 'settings-theme-family-group', `settings-theme-family-${appearance.family}`),
    mode: await inspectRadioGroup(page, 'settings-theme-mode-group', `settings-theme-mode-${appearance.mode}`),
    accent: await inspectRadioGroup(page, 'settings-theme-accent-group', `settings-theme-accent-${appearance.accentId}`),
  }
  const customControls = {
    input: await inspectViewportBounds(page, 'settings-theme-accent-input'),
    apply: await inspectViewportBounds(page, 'settings-theme-accent-apply'),
  }
  const screenshotAnchor = appearance.accentId === 'custom'
    ? page.getByTestId('settings-theme-accent-input')
    : page.getByTestId('settings-theme-family-group')
  await screenshotAnchor.scrollIntoViewIfNeeded()
  return { ...appearance, radioGroups, customControls }
}

async function prepareInteractionCapture(page, expected) {
  if (expected.interaction !== 'open-toolbox') return undefined
  const trigger = page.getByTestId('chat-floating-toolbox-trigger')
  await trigger.waitFor({ state: 'visible' })
  await trigger.click()
  const panel = page.getByTestId('chat-floating-toolbox-panel')
  await panel.waitFor({ state: 'visible' })
  await waitForStableBounds(panel)
  const expanded = await trigger.getAttribute('aria-expanded')
  if (expanded !== 'true') throw new Error('Toolbox trigger must expose aria-expanded=true after opening')
  const actions = panel.getByRole('button')
  const actionCount = await actions.count()
  if (!actionCount) throw new Error('Toolbox panel must render at least one action')
  const firstActionBounds = await actions.first().boundingBox()
  const viewport = page.viewportSize()
  if (!firstActionBounds || !viewport) throw new Error('Toolbox first action has no rendered bounds')
  return {
    kind: expected.interaction,
    expanded: true,
    trigger: await inspectViewportBounds(page, 'chat-floating-toolbox-trigger'),
    panel: await inspectViewportBounds(page, 'chat-floating-toolbox-panel'),
    actionCount,
    firstAction: {
      ...firstActionBounds,
      viewport,
      withinViewport: firstActionBounds.x >= 0 && firstActionBounds.y >= 0 && firstActionBounds.x + firstActionBounds.width <= viewport.width && firstActionBounds.y + firstActionBounds.height <= viewport.height,
    },
  }
}

async function waitForStableBounds(locator) {
  await locator.evaluate((element) => new Promise((resolve) => {
    let previous = ''
    let stableFrames = 0
    const observe = () => {
      const rect = element.getBoundingClientRect()
      const current = [rect.x, rect.y, rect.width, rect.height]
        .map((value) => value.toFixed(3))
        .join(':')
      stableFrames = current === previous ? stableFrames + 1 : 0
      previous = current
      if (stableFrames >= 3) {
        resolve(undefined)
        return
      }
      requestAnimationFrame(observe)
    }
    requestAnimationFrame(observe)
  }))
}

async function collect(options) {
  const worklist = readWorklist()
  const outputPath = options.output || worklist.resultPath
  const evidenceDir = options.evidenceDir || worklist.screenshotDirectory

  if (!options.baseUrl) {
    const result = createBlockedResult('blocked-no-web-render-evidence', [
      'No Expo Web base URL provided. Start Expo Web and pass --base-url to collect rendered viewport evidence.',
    ])
    const written = writeResult(outputPath, result)
    return { result, written }
  }

  const playwright = loadPlaywright()
  if (!playwright?.chromium) {
    const result = createBlockedResult('blocked-missing-playwright', [
      'Playwright is not available in this workspace. Install or provide Playwright before claiming captured web evidence.',
    ])
    const written = writeResult(outputPath, result)
    return { result, written }
  }

  const browser = await playwright.chromium.launch()
  const captures = []
  const errors = []
  try {
    for (const expected of requiredCaptures(worklist)) {
      const viewport = parseViewport(expected.viewport)
      const page = await browser.newPage({ viewport })
      const pageErrors = []
      page.on('console', (message) => {
        if (message.type() === 'error') {
          const location = message.location()
          const source = location.url
            ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
            : ''
          pageErrors.push(`${message.text()}${source}`)
        }
      })
      page.on('pageerror', (error) => {
        pageErrors.push(error.message)
      })

      const routeUrl = new URL(expected.route, options.baseUrl).toString()
      const screenshot = normalizeEvidencePath(path.posix.join(evidenceDir.replace(/\\/g, '/'), expected.screenshotName))
      const screenshotPath = resolveInsideRoot(screenshot)
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })

      try {
        await page.goto(routeUrl, { waitUntil: 'networkidle', timeout: options.timeoutMs })
        await page.waitForFunction(() => (document.body?.innerText.trim().length ?? 0) > 20, undefined, { timeout: options.timeoutMs })
        const appearance = await prepareAppearanceCapture(page, expected)
        const interaction = await prepareInteractionCapture(page, expected)
        await page.screenshot({ path: screenshotPath, fullPage: false })
        const screenshotDimensions = readPngDimensions(screenshotPath)
        if (pageErrors.length) {
          throw new Error(`Console errors: ${pageErrors.join(' | ')}`)
        }
        captures.push({
          id: expected.id,
          route: expected.route,
          mode: expected.mode,
          viewport: expected.viewport,
          screenshot,
          screenshotDimensions,
          consoleErrors: pageErrors.length,
          verified: expected.verified ?? [],
          ...(appearance ? { appearance } : {}),
          ...(interaction ? { interaction } : {}),
        })
      } catch (error) {
        errors.push({
          id: expected.id,
          route: expected.route,
          message: error?.message ?? String(error),
        })
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }

  const result = {
    schema: 'islemind.product-mobile-web-render-results.v1',
    status: errors.length > 0 ? 'blocked-web-render-verification' : 'captured',
    runner: 'Expo Web + Playwright',
    note: 'Web viewport evidence only; native device/ADB evidence remains separate.',
    captures,
    fixedDuringRun: [],
    errors,
  }
  const written = writeResult(outputPath, result)
  return { result, written }
}

function selfTest() {
  const worklist = readWorklist()
  if (worklist.schema !== 'islemind.product-mobile-web-render-evidence-worklist.v1') {
    throw new Error('Unexpected web render worklist schema')
  }
  if (!Array.isArray(worklist.requiredCaptures) || worklist.requiredCaptures.length !== 3) {
    throw new Error('Web render worklist must define three Chat-only required captures')
  }
  if (!Array.isArray(worklist.appearanceRequiredCaptures) || worklist.appearanceRequiredCaptures.length !== 13) {
    throw new Error('Web render worklist must define thirteen required appearance captures')
  }
  const defaultBrowserOptions = parseArgs([])
  const edgeBrowserOptions = parseArgs(['--browser', 'edge'])
  const edgeEqualsOptions = parseArgs(['--browser=edge'])
  const cdpBrowserOptions = parseArgs(['--browser-transport', 'cdp'])
  const androidBrowserOptions = parseArgs(['--browser', 'android-chromium', '--browser-transport', 'cdp', '--device', 'dadaa813'])
  if (defaultBrowserOptions.browser !== 'chrome' || edgeBrowserOptions.browser !== 'edge' || edgeEqualsOptions.browser !== 'edge') {
    throw new Error('Browser selection arguments did not preserve Chrome default and explicit Edge support.')
  }
  if (defaultBrowserOptions.browserTransport !== 'page' || cdpBrowserOptions.browserTransport !== 'cdp') {
    throw new Error('Browser storage evidence did not preserve the page default and explicit CDP fallback.')
  }
  if (androidBrowserOptions.browser !== 'android-chromium' || androidBrowserOptions.device !== 'dadaa813') {
    throw new Error('Android Chromium selection did not preserve the explicit device.')
  }
  const expectedEdgeExecutable = browserDefinitions.edge.candidates[1]
  const resolvedEdge = resolveBrowserExecutable('edge', (candidate) => candidate === expectedEdgeExecutable)
  if (resolvedEdge.id !== 'edge' || resolvedEdge.label !== 'Microsoft Edge' || resolvedEdge.executable !== expectedEdgeExecutable) {
    throw new Error('Physical Edge candidate resolution is not stable.')
  }
  let rejectedUnsupportedBrowser = false
  try {
    parseArgs(['--browser', 'unsupported'])
  } catch (error) {
    rejectedUnsupportedBrowser = /Unsupported browser/.test(String(error?.message ?? error))
  }
  if (!rejectedUnsupportedBrowser) throw new Error('Unsupported browser selection did not fail closed.')
  let rejectedUnsupportedTransport = false
  try {
    parseArgs(['--browser-transport', 'unsupported'])
  } catch (error) {
    rejectedUnsupportedTransport = /Unsupported browser transport/.test(String(error?.message ?? error))
  }
  if (!rejectedUnsupportedTransport) throw new Error('Unsupported browser transport did not fail closed.')
  let rejectedAndroidPageTransport = false
  try {
    parseArgs(['--browser', 'android-chromium', '--device', 'dadaa813'])
  } catch (error) {
    rejectedAndroidPageTransport = /explicit cdp browser transport/.test(String(error?.message ?? error))
  }
  if (!rejectedAndroidPageTransport) throw new Error('Android Chromium accepted the browser-native page transport without an implementation.')
  if (!browserChildHasExited({ exitCode: null, signalCode: 'SIGTERM' }) || browserChildHasExited({ exitCode: null, signalCode: null })) {
    throw new Error('Browser-native process cleanup does not distinguish signal exit from a running child.')
  }
  let rejectedUnsafeDevice = false
  try {
    parseArgs(['--browser', 'android-chromium', '--device', '../unsafe'])
  } catch (error) {
    rejectedUnsafeDevice = /safe explicit/.test(String(error?.message ?? error))
  }
  if (!rejectedUnsafeDevice) throw new Error('Android Chromium selection accepted an unsafe device serial.')
  const browserPageHarnessSource = storageHarnessEntrySource()
  for (const marker of ["postEvidence('restart-written'", "postEvidence('restart-read'", "postEvidence('operation'", "postEvidence('cross-tab-summary'"]) {
    if (!browserPageHarnessSource.includes(marker)) throw new Error(`Browser-native storage harness is missing ${marker}.`)
  }
  const packageCalls = []
  const resolvedPackage = resolveAndroidBrowserPackage('device', (_device, args) => {
    packageCalls.push(args.at(-1))
    if (args.at(-1) === 'com.android.browser') return 'package:/system/app/Browser/Browser.apk'
    throw new Error('missing')
  })
  if (resolvedPackage !== 'com.android.browser' || packageCalls.join(',') !== 'com.android.chrome,com.android.browser') {
    throw new Error('Android Chromium package fallback order is not stable.')
  }
  const resolvedSocket = resolveAndroidDevToolsSocket([
    '0000 @chrome_devtools_remote',
    '0000 @browser_webview_devtools_remote_12297',
  ].join('\n'), 'com.android.browser')
  if (resolvedSocket !== 'browser_webview_devtools_remote_12297') {
    throw new Error('Android Chromium DevTools socket selection did not prefer the selected package family.')
  }
  for (const capture of requiredCaptures(worklist)) {
    parseViewport(capture.viewport)
    if (!capture.screenshotName.endsWith('.png')) throw new Error(`Capture ${capture.id} does not use a PNG screenshot`)
    assertAppearanceDefinition(capture)
  }
  const blocked = createBlockedResult('blocked-no-web-render-evidence', ['missing'])
  if (blocked.captures.length !== 0 || !/native device\/ADB/i.test(blocked.note)) {
    throw new Error('Blocked web render result must not fake captures and must separate native proof')
  }
  const validStorageEvidence = {
    schema: 'islemind.browser-storage-persistence-evidence.v1',
    status: 'captured',
    source: { adapterSha256: 'a'.repeat(64), bundleSha256: 'b'.repeat(64) },
    restart: { profileReopened: true, valuePersisted: true, writtenValue: 'marker', reopenedValue: 'marker' },
    crossTab: {
      lockScope: 'cross-context',
      navigatorLocksAvailable: true,
      tabCount: 2,
      finalCounter: 2,
      overlapMs: 0,
      operations: [
        { label: 'tab-a', before: 0, after: 1, startedAt: 10, finishedAt: 20 },
        { label: 'tab-b', before: 1, after: 2, startedAt: 20, finishedAt: 30 },
      ],
    },
    errors: [],
  }
  const validStorageIssues = validateBrowserStorageEvidence(validStorageEvidence)
  if (validStorageIssues.length) throw new Error(`Browser storage evidence self-test rejected valid evidence: ${validStorageIssues.join(', ')}`)
  const overlappingIssues = validateBrowserStorageEvidence({
    ...validStorageEvidence,
    crossTab: { ...validStorageEvidence.crossTab, overlapMs: 5 },
  })
  if (!overlappingIssues.some((issue) => issue.includes('overlapped'))) {
    throw new Error('Browser storage evidence self-test accepted overlapping cross-tab work.')
  }
  const staleRestartIssues = validateBrowserStorageEvidence({
    ...validStorageEvidence,
    restart: { ...validStorageEvidence.restart, reopenedValue: 'changed' },
  })
  if (!staleRestartIssues.some((issue) => issue.includes('changed after reopen'))) {
    throw new Error('Browser storage evidence self-test accepted a changed restart value.')
  }
  console.log('Product mobile web render evidence collector self-test passed')
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) {
    selfTest()
  } else if (options.storageEvidenceOnly) {
    collectBrowserStorageEvidence(options).then(({ result, written, issues }) => {
      console.log(`Wrote ${result.status} browser storage evidence result to ${path.relative(root, written)}`)
      if (issues.length) {
        console.error(`Browser storage evidence failed: ${issues.join('; ')}`)
        process.exitCode = 1
      }
    }).catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
  } else {
    collect(options).then(({ result, written }) => {
      console.log(`Wrote ${result.status} web render evidence result to ${path.relative(root, written)}`)
      if (result.status !== 'captured') process.exitCode = 1
    }).catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
  }
}

module.exports = {
  collect,
  collectBrowserPageStorageEvidence,
  collectBrowserStorageEvidence,
  createBlockedResult,
  normalizeEvidencePath,
  parseArgs,
  parseViewport,
  resolveAndroidBrowserPackage,
  resolveAndroidDevToolsSocket,
  resolveBrowserExecutable,
  selfTest,
  validateBrowserStorageEvidence,
}
