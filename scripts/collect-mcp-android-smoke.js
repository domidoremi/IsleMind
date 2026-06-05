const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const smokeDir = path.join(evidenceDir, 'settings-mcp-smoke')
const outputPath = path.join(evidenceDir, 'settings-mcp-offline-results.json')
const requestLogPath = path.join(evidenceDir, 'settings-mcp-online-cleartext-server-requests.jsonl')
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'

if (!isMainThread) {
  runMockMcpWorker()
} else {
  main()
}

function main() {
  fs.mkdirSync(smokeDir, { recursive: true })
  fs.writeFileSync(requestLogPath, '', 'utf8')

  const device = resolveDevice(defaultDevice)
  const runToken = Date.now().toString(36).slice(-6).toUpperCase()
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    builtInServer: { status: 'unknown', png: null, uia: null },
    offlineServer: {
      name: `QA_MCP_OFFLINE_${runToken}`,
      url: 'http://10.0.2.2:9/mcp',
      checks: [],
      captures: {},
    },
    externalOnlineServer: {
      name: `QA_MCP_ONLINE_${runToken}`,
      status: 'failed',
      emulatorUrl: null,
      methods: [],
      captures: {},
    },
    requestLog: relative(requestLogPath),
    errors: [],
  }

  let worker = null
  try {
    if (!device) throw new Error('No connected adb device was found for MCP smoke.')
    runCommand('adb', ['-s', device, 'logcat', '-c'])
    forceStop(device)

    const builtIn = waitForSettingsMcp(device, 'settings-mcp-built-in')
    result.builtInServer = {
      status: hasAnyText(builtIn.uiaText, ['已连接', 'Connected']) ? '已连接' : 'unknown',
      png: builtIn.png,
      uia: builtIn.uia,
      visibleText: extractVisibleText(builtIn.uiaText).slice(0, 80),
    }

    runOfflineScenario(device, result)
    forceStop(device)

    worker = startMockMcpServer(requestLogPath)
    result.externalOnlineServer.emulatorUrl = `http://10.0.2.2:${worker.port}/mcp`
    runOnlineScenario(device, result)
    result.externalOnlineServer.methods = readJsonl(requestLogPath).map((row) => row.payload?.method).filter(Boolean)
    const requiredMethods = ['resources/list', 'prompts/list', 'tools/list', 'initialize']
    const onlinePassed = requiredMethods.every((method) => result.externalOnlineServer.methods.includes(method))
      && result.externalOnlineServer.captures.syncSucceeded === true
    result.externalOnlineServer.status = onlinePassed ? 'passed' : 'failed'
  } catch (error) {
    result.errors.push(error?.message ?? String(error))
  } finally {
    if (worker) worker.instance.terminate()
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`MCP Android smoke wrote ${relative(outputPath)} and ${relative(requestLogPath)}.`)
  if (!isMcpResultPassing(result)) {
    console.error(`MCP Android smoke failed: ${summarizeMcpFailures(result).join('; ')}`)
    process.exitCode = 1
  }
}

function runOfflineScenario(device, result) {
  const added = addServerThroughUi(device, {
    name: result.offlineServer.name,
    url: result.offlineServer.url,
    keyboardCaptureName: 'settings-mcp-keyboard-open',
    addedCaptureName: 'settings-mcp-offline-added',
  })
  result.offlineServer.captures.keyboardPng = added.keyboard.png
  result.offlineServer.captures.keyboardUia = added.keyboard.uia
  result.offlineServer.captures.addedPng = added.added.png
  result.offlineServer.captures.addedUia = added.added.uia
  result.offlineServer.checks.push({
    name: 'keyboard-open-input',
    status: added.keyboardOpen ? 'passed' : 'failed',
    evidence: added.keyboard.uia,
  })
  result.offlineServer.checks.push({
    name: 'server-added',
    status: added.serverVisible ? 'passed' : 'failed',
    evidence: added.added.uia,
  })

  const offlineCard = scrollToText(device, [result.offlineServer.name], 'settings-mcp-offline-card', 5)
  const syncTapped = tapActionNearText(device, offlineCard.uiaText, [result.offlineServer.name], ['同步', 'Sync'])
  sleep(2600)
  let offline = captureStep(device, 'settings-mcp-offline-sync-failed')
  if (!hasAnyText(offline.uiaText, ['MCP 同步失败', 'MCP sync failed', 'failed', 'HTTP', 'Network', 'error'])) {
    sleep(2500)
    offline = captureStep(device, 'settings-mcp-offline-sync-failed')
  }
  const offlineFailed = syncTapped && hasAnyText(offline.uiaText, ['MCP 同步失败', 'failed', 'Network request failed', 'HTTP'])
  result.offlineServer.captures.offlinePng = offline.png
  result.offlineServer.captures.offlineUia = offline.uia
  result.offlineServer.checks.push({
    name: 'offline-sync-failure-visible',
    status: offlineFailed ? 'passed' : 'failed',
    evidence: offline.uia,
  })

  tapText(device, offline.uiaText, ['知道了', 'OK', '关闭', 'Close'])
  sleep(700)
  const deleted = deleteServerThroughUi(device, result.offlineServer.name, 'settings-mcp-offline')
  result.offlineServer.captures.deleteConfirmPng = deleted.confirm.png
  result.offlineServer.captures.deleteConfirmUia = deleted.confirm.uia
  result.offlineServer.captures.deletedPng = deleted.after.png
  result.offlineServer.captures.deletedUia = deleted.after.uia
  result.offlineServer.captures.deleteConfirmed = deleted.confirmVisible && deleted.deleted
}

function runOnlineScenario(device, result) {
  const added = addServerThroughUi(device, {
    name: result.externalOnlineServer.name,
    url: result.externalOnlineServer.emulatorUrl,
    keyboardCaptureName: 'settings-mcp-online-keyboard-open',
    addedCaptureName: 'settings-mcp-online-added',
  })
  result.externalOnlineServer.captures.keyboardPng = added.keyboard.png
  result.externalOnlineServer.captures.keyboardUia = added.keyboard.uia
  result.externalOnlineServer.captures.addedPng = added.added.png
  result.externalOnlineServer.captures.addedUia = added.added.uia

  const onlineCard = scrollToText(device, [result.externalOnlineServer.name], 'settings-mcp-online-card', 5)
  const syncTapped = tapActionNearText(device, onlineCard.uiaText, [result.externalOnlineServer.name], ['同步', 'Sync'])
  sleep(2600)
  let online = captureStep(device, 'settings-mcp-online-sync-success')
  if (!hasAnyText(online.uiaText, ['MCP 已连接', 'MCP connected', '工具 1', '资源 1', '提示词 1'])) {
    sleep(2400)
    online = captureStep(device, 'settings-mcp-online-sync-success')
  }
  result.externalOnlineServer.captures.syncPng = online.png
  result.externalOnlineServer.captures.syncUia = online.uia
  result.externalOnlineServer.captures.syncTapped = syncTapped
  result.externalOnlineServer.captures.syncSucceeded = syncTapped && hasAnyText(online.uiaText, ['MCP 已连接', '工具 1', '资源 1', '提示词 1', 'QA_MCP_ONLINE'])

  tapText(device, online.uiaText, ['知道了', 'OK', '关闭', 'Close'])
  sleep(800)
  const toggleCapture = scrollToText(device, [result.externalOnlineServer.name], 'settings-mcp-online-toggle-ready', 5)
  const toggleTapped = tapActionNearText(device, toggleCapture.uiaText, [result.externalOnlineServer.name], ['开启', 'Enabled', 'On'])
  sleep(800)
  const toggled = captureStep(device, 'settings-mcp-online-toggle-disabled')
  result.externalOnlineServer.captures.toggleTapped = toggleTapped
  result.externalOnlineServer.captures.togglePng = toggled.png
  result.externalOnlineServer.captures.toggleUia = toggled.uia

  const deleted = deleteServerThroughUi(device, result.externalOnlineServer.name, 'settings-mcp-online')
  result.externalOnlineServer.captures.deleteConfirmPng = deleted.confirm.png
  result.externalOnlineServer.captures.deleteConfirmUia = deleted.confirm.uia
  result.externalOnlineServer.captures.deletedPng = deleted.after.png
  result.externalOnlineServer.captures.deletedUia = deleted.after.uia
  result.externalOnlineServer.captures.deleteConfirmed = deleted.deleted
}

function addServerThroughUi(device, { name, url, keyboardCaptureName, addedCaptureName }) {
  openUrl(device, 'islemind://settings/mcp')
  sleep(1800)
  let capture = waitForText(device, ['添加 MCP Server', 'Add MCP', 'Server URL'], `${keyboardCaptureName}-before`, 6)
  const nameTapped = tapEditableAtIndex(device, capture.uiaText, 0)
  if (nameTapped) {
    sleep(300)
    inputText(device, name)
  }
  sleep(400)
  capture = captureStep(device, `${keyboardCaptureName}-name`)
  const urlTapped = tapEditableAtIndex(device, capture.uiaText, 1) || tapEditableNearLabel(device, capture.uiaText, ['Server URL', 'URL'])
  if (urlTapped) {
    sleep(300)
    inputText(device, url)
  }
  sleep(900)
  const keyboard = captureStep(device, keyboardCaptureName)
  const keyboardOpen = parseNodes(keyboard.uiaText).some((node) => node.enabled && node.focused && node.className.includes('EditText'))
    && hasAnyText(keyboard.uiaText, [name, 'Server URL', '添加'])

  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(900)
  let addCapture = captureStep(device, `${addedCaptureName}-before-add`)
  const addTapped = tapText(device, addCapture.uiaText, ['添加', 'Add'])
  sleep(1700)
  let added = captureStep(device, addedCaptureName)
  if (!hasAnyText(added.uiaText, [name])) {
    added = scrollToText(device, [name], addedCaptureName, 5)
  }
  return {
    keyboard,
    added,
    keyboardOpen,
    addTapped,
    serverVisible: addTapped && hasServerCardText(added.uiaText, name),
  }
}

function deleteServerThroughUi(device, serverName, prefix) {
  const card = scrollToText(device, [serverName], `${prefix}-delete-ready`, 14)
  const deleteTapped = tapActionNearText(device, card.uiaText, [serverName], ['删除', 'Delete'])
  sleep(900)
  const confirm = captureStep(device, `${prefix}-delete-confirm`)
  const confirmVisible = deleteTapped && hasAnyText(confirm.uiaText, ['删除 MCP Server', serverName, 'Delete MCP'])
  const confirmed = tapText(device, confirm.uiaText, ['删除', 'Delete'])
  sleep(1200)
  const after = captureStep(device, `${prefix}-deleted`)
  return {
    confirm,
    after,
    confirmVisible,
    deleted: confirmed && !hasAnyText(after.uiaText, [serverName]) && !hasErrorBoundary(after.uiaText),
  }
}

function waitForSettingsMcp(device, captureName) {
  openUrl(device, 'islemind://settings/mcp')
  sleep(1800)
  return waitForText(device, ['添加 MCP Server', '内置工具', 'MCP Tools', 'islemind://builtin'], captureName, 8)
}

function waitForText(device, labels, captureName, maxAttempts, intervalMs = 700) {
  let capture = captureStep(device, captureName)
  if (hasAnyText(capture.uiaText, labels)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(intervalMs)
    capture = captureStep(device, captureName)
    if (hasAnyText(capture.uiaText, labels)) return capture
  }
  return capture
}

function scrollToText(device, labels, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (hasAnyText(capture.uiaText, labels)) return capture
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(550)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (hasAnyText(capture.uiaText, labels)) return capture
  }
  return capture
}

function tapText(device, uiaText, labels) {
  const node = findTappableTextNode(parseNodes(uiaText), labels)
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapActionNearText(device, uiaText, anchorLabels, actionLabels) {
  const nodes = parseNodes(uiaText)
  const anchor = nodes.find((node) => textMatchesAny(node, anchorLabels))
  const anchorBounds = parseBounds(anchor?.bounds)
  const candidates = nodes
    .filter((node) => node.enabled && textMatchesAny(node, actionLabels))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds)
    .filter(({ bounds }) => !anchorBounds || bounds.top >= anchorBounds.top - 20)
    .sort((left, right) => {
      if (!anchorBounds) return left.bounds.top - right.bounds.top
      return Math.abs(left.bounds.top - anchorBounds.top) - Math.abs(right.bounds.top - anchorBounds.top)
    })
  const candidate = candidates[0]?.node ?? findTappableTextNode(nodes, actionLabels)
  if (!candidate) return false
  tapBoundsCenter(device, candidate.bounds)
  return true
}

function tapEditableAtIndex(device, uiaText, index) {
  const editables = parseNodes(uiaText).filter((node) => node.enabled && node.className.includes('EditText'))
  const node = editables[index]
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapEditableNearLabel(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const editables = nodes.filter((node) => node.enabled && node.className.includes('EditText'))
  const labelNode = nodes.find((node) => textMatchesAny(node, labels))
  const labelBounds = parseBounds(labelNode?.bounds)
  const candidate = editables
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && (!labelBounds || bounds.top >= labelBounds.top - 12))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0]?.node
  if (!candidate) return false
  tapBoundsCenter(device, candidate.bounds)
  return true
}

function findTappableTextNode(nodes, labels) {
  const clickable = nodes.filter((item) => item.enabled && item.clickable)
  for (const label of labels) {
    const exactClickable = clickable.find((item) => item.text === label || item.contentDesc === label)
    if (exactClickable) return exactClickable
  }
  const containingClickable = clickable.find((item) => textMatchesAny(item, labels))
  if (containingClickable) return containingClickable

  const visibleLabel = nodes.find((item) => item.enabled && textMatchesAny(item, labels))
  const visibleBounds = parseBounds(visibleLabel?.bounds)
  if (!visibleBounds) return visibleLabel ?? null
  return clickable
    .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
    .filter(({ bounds }) => bounds && boundsContains(bounds, visibleBounds))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.item
    ?? visibleLabel
}

function captureStep(device, name) {
  const pngPath = path.join(smokeDir, `${name}.png`)
  const uiaPath = path.join(smokeDir, `${name}.uia.xml`)
  const uniqueName = `${name}-${Date.now()}`
  const remotePng = `/sdcard/Download/${uniqueName}.png`
  const remoteUia = `/sdcard/Download/${uniqueName}.uia.xml`
  const pngOk = captureFileWithRetry(device, remotePng, pngPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng])
  })
  const uiaOk = captureFileWithRetry(device, remoteUia, uiaPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
  })
  const uiaText = uiaOk && fs.existsSync(uiaPath) ? fs.readFileSync(uiaPath, 'utf8') : ''
  return {
    png: pngOk ? relative(pngPath) : null,
    uia: uiaOk ? relative(uiaPath) : null,
    uiaText,
  }
}

function captureFileWithRetry(device, remotePath, localPath, captureRemote) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    captureRemote()
    runCommand('adb', ['-s', device, 'pull', remotePath, localPath])
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) return true
    sleep(350 + attempt * 350)
  }
  return false
}

function parseNodes(uiaText) {
  const nodes = []
  const pattern = /<node\b[^>]*>/g
  let match
  while ((match = pattern.exec(uiaText))) {
    const tag = match[0]
    const bounds = matchFirst(tag, /bounds="([^"]+)"/)
    if (!bounds) continue
    nodes.push({
      text: decodeXml(matchFirst(tag, /text="([^"]*)"/) ?? ''),
      contentDesc: decodeXml(matchFirst(tag, /content-desc="([^"]*)"/) ?? ''),
      className: decodeXml(matchFirst(tag, /class="([^"]*)"/) ?? ''),
      bounds,
      enabled: matchFirst(tag, /enabled="([^"]+)"/) !== 'false',
      focused: matchFirst(tag, /focused="([^"]+)"/) === 'true',
      clickable: matchFirst(tag, /clickable="([^"]+)"/) === 'true',
    })
  }
  return nodes
}

function parseBounds(bounds) {
  const match = String(bounds ?? '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!match) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

function boundsContains(container, inner) {
  return inner.left >= container.left && inner.right <= container.right && inner.top >= container.top && inner.bottom <= container.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box) return
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2))])
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '560', '420'])
}

function inputText(device, value) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', escapeInputText(value)])
}

function escapeInputText(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\s/g, '%s')
    .replace(/&/g, '\\&')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function forceStop(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function resolveDevice(requested) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  return serials[0] ?? null
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 25000,
      maxBuffer: 8 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function startMockMcpServer(logPath) {
  const stateBuffer = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT)
  const state = new Int32Array(stateBuffer)
  const instance = new Worker(__filename, { workerData: { logPath, stateBuffer } })
  Atomics.wait(state, 1, 0, 5000)
  if (Atomics.load(state, 1) !== 1) {
    instance.terminate()
    throw new Error('Mock MCP server did not start.')
  }
  return { instance, port: Atomics.load(state, 0) }
}

function runMockMcpWorker() {
  const state = new Int32Array(workerData.stateBuffer)
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const receivedAt = new Date().toISOString()
      let payload = null
      try {
        payload = body ? JSON.parse(body) : null
      } catch {
        payload = { parseError: true, raw: body }
      }
      fs.appendFileSync(workerData.logPath, `${JSON.stringify({ receivedAt, method: request.method, url: request.url, payload })}\n`, 'utf8')
      const method = payload?.method
      const result = mockMcpResult(method)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: payload?.id ?? 1, result }))
    })
  })
  server.on('error', () => {
    Atomics.store(state, 2, 1)
    Atomics.store(state, 1, 2)
    Atomics.notify(state, 1)
  })
  server.listen(0, '0.0.0.0', () => {
    Atomics.store(state, 0, server.address().port)
    Atomics.store(state, 1, 1)
    Atomics.notify(state, 1)
    parentPort?.postMessage({ port: server.address().port })
  })
}

function mockMcpResult(method) {
  if (method === 'initialize') {
    return {
      protocolVersion: '2025-03-26',
      capabilities: {},
      serverInfo: { name: 'qa-cleartext-mcp', version: '1.0.0' },
    }
  }
  if (method === 'tools/list') {
    return {
      tools: [
        {
          name: 'qa_echo',
          description: 'QA echo tool',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
    }
  }
  if (method === 'resources/list') {
    return { resources: [{ uri: 'qa://resource', name: 'QA Resource', description: 'QA resource evidence' }] }
  }
  if (method === 'prompts/list') {
    return { prompts: [{ name: 'qa_prompt', description: 'QA prompt evidence' }] }
  }
  return {}
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function isMcpResultPassing(result) {
  return result.builtInServer?.status === '已连接'
    && (result.offlineServer?.checks ?? []).every((check) => check.status === 'passed')
    && result.externalOnlineServer?.status === 'passed'
    && !result.errors.length
}

function summarizeMcpFailures(result) {
  const failures = []
  if (result.builtInServer?.status !== '已连接') failures.push('built-in server status was not 已连接')
  for (const check of result.offlineServer?.checks ?? []) {
    if (check.status !== 'passed') failures.push(`${check.name}=${check.status}`)
  }
  if (result.externalOnlineServer?.status !== 'passed') failures.push(`online=${result.externalOnlineServer?.status ?? 'missing'}`)
  if (result.errors.length) failures.push(...result.errors)
  return failures
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function hasServerCardText(uiaText, serverName) {
  return parseNodes(uiaText).some((node) => node.text === serverName && !node.className.includes('EditText'))
}

function textMatchesAny(node, labels) {
  return labels.some((label) => node.text.includes(label) || node.contentDesc.includes(label))
}

function hasErrorBoundary(uiaText) {
  return hasAnyText(uiaText, ['页面暂时无法显示', 'Page is unavailable', 'Render Error', 'ReferenceError', 'TypeError'])
}

function extractVisibleText(uiaText) {
  const values = []
  for (const match of uiaText.matchAll(/\b(?:text|content-desc)="([^"]+)"/g)) {
    const value = decodeXml(match[1]).trim()
    if (value && !values.includes(value)) values.push(value)
  }
  return values
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}
