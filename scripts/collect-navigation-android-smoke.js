const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'

const routeDir = path.join(evidenceDir, 'fresh-route-smoke')
const backDir = path.join(evidenceDir, 'settings-back-dynamic')
const providerBackDir = path.join(evidenceDir, 'fresh-back-smoke-after-fix')
const keyboardDir = path.join(evidenceDir, 'fresh-keyboard-smoke-after-fix')

const routeCases = [
  {
    name: 'home',
    url: 'islemind://',
    markerGroups: [['输入消息', '问点什么', 'Input message'], ['会话参数', 'Session settings', '配置服务商', '显示顶部栏', 'Show top bar']],
  },
  {
    name: 'conversations',
    url: 'islemind://conversations',
    markerGroups: [['对话', 'Conversations'], ['新对话', 'New chat', '还没有历史']],
  },
  {
    name: 'settings',
    url: 'islemind://settings',
    markerGroups: [['设置', 'Settings'], ['AI 设置', 'AI workspace', '供应商']],
  },
  {
    name: 'settings-providers',
    url: 'islemind://settings/providers',
    markerGroups: [['供应商', 'Providers'], ['批量导入', 'Batch Import', '添加服务商']],
  },
  {
    name: 'settings-context',
    url: 'islemind://settings/context',
    markerGroups: [['上下文', 'Context'], ['联网搜索', 'RAG', 'Search']],
  },
  {
    name: 'settings-memory',
    url: 'islemind://settings/memory',
    markerGroups: [['记忆', 'Memory'], ['长期记忆', '清空记忆', 'Long-term memory']],
  },
  {
    name: 'settings-knowledge',
    url: 'islemind://settings/knowledge',
    markerGroups: [['知识', 'Knowledge'], ['导入知识文件', '粘贴文本入库', 'Import knowledge']],
  },
  {
    name: 'settings-preferences',
    url: 'islemind://settings/preferences',
    markerGroups: [['偏好', 'Preferences'], ['生成参数', '触觉反馈', 'Generation']],
  },
  {
    name: 'settings-skills',
    url: 'islemind://settings/skills',
    markerGroups: [['Skills'], ['创建 Skill', 'Create Skill']],
  },
  {
    name: 'settings-mcp',
    url: 'islemind://settings/mcp',
    markerGroups: [['MCP 工具', 'MCP'], ['添加 MCP Server', '内置工具', 'Add MCP']],
  },
  {
    name: 'source-fallback',
    url: 'islemind://source',
    markerGroups: [['来源', 'Source'], ['没有来源', '未找到来源', 'No source']],
  },
]

const settingsBackCases = [
  {
    Case: 'providers',
    url: 'islemind://settings/providers',
    markerGroups: [['供应商', 'Providers'], ['连接概况', '批量导入', '添加服务商']],
    childOnlyMarkers: ['连接概况', '供应商列表', '批量导入'],
  },
  {
    Case: 'context',
    url: 'islemind://settings/context',
    markerGroups: [['上下文', 'Context'], ['联网搜索', 'RAG']],
    childOnlyMarkers: ['联网搜索', 'RAG 策略', 'Agentic 策略'],
  },
  {
    Case: 'memory',
    url: 'islemind://settings/memory',
    markerGroups: [['记忆', 'Memory'], ['长期记忆', '清空记忆']],
    childOnlyMarkers: ['长期记忆', '清空记忆'],
  },
  {
    Case: 'knowledge',
    url: 'islemind://settings/knowledge',
    markerGroups: [['知识', 'Knowledge'], ['导入知识文件', '粘贴文本入库']],
    childOnlyMarkers: ['导入知识文件', '粘贴文本入库', '清空知识库'],
  },
  {
    Case: 'preferences',
    url: 'islemind://settings/preferences',
    markerGroups: [['偏好', 'Preferences'], ['生成参数', '触觉反馈']],
    childOnlyMarkers: ['生成参数', '触觉反馈', '经典页面滑动'],
  },
  {
    Case: 'skills',
    url: 'islemind://settings/skills',
    markerGroups: [['Skills'], ['创建 Skill', 'Create Skill']],
    childOnlyMarkers: ['创建 Skill', '系统提示词', 'provider-id'],
  },
  {
    Case: 'mcp',
    url: 'islemind://settings/mcp',
    markerGroups: [['MCP 工具', 'MCP'], ['添加 MCP Server', '内置工具']],
    childOnlyMarkers: ['添加 MCP Server', '内置工具', 'islemind://builtin'],
  },
]

function main() {
  for (const dir of [evidenceDir, routeDir, backDir, providerBackDir, keyboardDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const device = resolveDevice(defaultDevice)
  if (!device) {
    throw new Error('No connected adb device was found for navigation smoke.')
  }

  runCommand('adb', ['-s', device, 'logcat', '-c'])
  forceStop(device)

  const routeRows = runRouteSmoke(device)
  const backRows = runSettingsBackSmoke(device)
  const keyboardResult = runHomeKeyboardSmoke(device)

  writeProviderBackResult(backRows)
  fs.writeFileSync(path.join(backDir, '..', 'settings-back-dynamic-results.json'), `${JSON.stringify(backRows, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(routeDir, 'route-smoke-results.json'), `${JSON.stringify(routeRows, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(keyboardDir, 'home-keyboard-open-results.json'), `${JSON.stringify(keyboardResult, null, 2)}\n`, 'utf8')

  const failedRoutes = routeRows.filter((row) => !row.expectedOk || row.errorText)
  const failedBack = backRows.filter((row) => !row.Found || !row.ChildOk || !row.BackOk)
  const keyboardFailed = !keyboardResult.inputFocused || !keyboardResult.sendButtonPresent || !keyboardResult.homeStillVisible || keyboardResult.errorVisible
  const failures = [
    ...failedRoutes.map((row) => `route:${row.name}`),
    ...failedBack.map((row) => `back:${row.Case}`),
    ...(keyboardFailed ? ['keyboard:home'] : []),
  ]

  console.log(`Navigation Android smoke wrote ${routeRows.length} routes, ${backRows.length} Back cases, keyboard=${keyboardFailed ? 'failed' : 'passed'}.`)
  if (failures.length) {
    console.error(`Navigation Android smoke failures: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

function runRouteSmoke(device) {
  const startedAt = Date.now()
  const rows = routeCases.map((testCase) => {
    openUrl(device, testCase.url)
    sleep(1800)
    const capture = captureStep(device, routeDir, `${testCase.name}-route`)
    const expectedOk = matchesMarkerGroups(capture.uiaText, testCase.markerGroups) && !hasErrorBoundary(capture.uiaText)
    return {
      name: testCase.name,
      url: testCase.url,
      expectedOk,
      errorText: extractErrorText(capture.uiaText),
      png: capture.png,
      uia: capture.uia,
      visibleText: extractVisibleText(capture.uiaText).slice(0, 60),
    }
  })
  writeFatalLog(device, path.join(routeDir, 'route-smoke-current.log'), startedAt)
  return rows
}

function runSettingsBackSmoke(device) {
  return settingsBackCases.map((testCase) => {
    openUrl(device, testCase.url)
    sleep(1600)
    const child = captureStep(device, backDir, `settings-back-dynamic-${testCase.Case}-child`)
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    sleep(1300)
    const after = captureStep(device, backDir, `settings-back-dynamic-${testCase.Case}-after`)
    const childOk = matchesMarkerGroups(child.uiaText, testCase.markerGroups) && !hasErrorBoundary(child.uiaText)
    const backOk = hasSettingsShell(after.uiaText) && !hasErrorBoundary(after.uiaText)
    return {
      Case: testCase.Case,
      Found: child.uiaText.length > 0,
      ChildOk: childOk,
      BackOk: backOk,
      StayedOnChild: testCase.childOnlyMarkers.some((marker) => after.uiaText.includes(marker)),
      childPng: child.png,
      childUia: child.uia,
      afterPng: after.png,
      afterUia: after.uia,
      childVisibleText: extractVisibleText(child.uiaText).slice(0, 60),
      afterVisibleText: extractVisibleText(after.uiaText).slice(0, 60),
    }
  })
}

function runHomeKeyboardSmoke(device) {
  const logPath = path.join(keyboardDir, 'home-keyboard-open.log')
  const startedAt = Date.now()
  openUrl(device, 'islemind://')
  let capture = waitForHomeComposer(device, 'home-keyboard-before-focus', 8)
  const tapped = tapFirstEditable(device, capture.uiaText)
  if (tapped) {
    sleep(500)
    runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_KEYBOARD'])
    sleep(900)
  }
  capture = captureStep(device, keyboardDir, 'home-keyboard-open')
  const nodes = parseNodes(capture.uiaText)
  const inputFocused = nodes.some((node) => node.enabled && node.focused && node.className.includes('EditText'))
  const sendButtonPresent = nodes.some((node) => textMatchesAny(node, ['发送消息', 'Send message', 'Send']))
  const homeStillVisible = hasAnyText(capture.uiaText, ['输入消息', '问点什么', '会话参数', '配置服务商', 'Input message'])
  const errorVisible = hasErrorBoundary(capture.uiaText)
  writeFatalLog(device, logPath, startedAt)
  return {
    generatedAt: new Date().toISOString(),
    device,
    tappedInput: tapped,
    inputFocused,
    sendButtonPresent,
    homeStillVisible,
    errorVisible,
    png: capture.png,
    uia: capture.uia,
    log: relative(logPath),
    visibleText: extractVisibleText(capture.uiaText).slice(0, 60),
  }
}

function waitForHomeComposer(device, captureName, maxAttempts) {
  let capture = captureStep(device, keyboardDir, captureName)
  if (hasHomeComposer(capture.uiaText)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(500 + attempt * 150)
    capture = captureStep(device, keyboardDir, captureName)
    if (hasHomeComposer(capture.uiaText)) return capture
  }
  return capture
}

function hasHomeComposer(uiaText) {
  return hasAnyText(uiaText, ['输入消息', '问点什么', 'Input message'])
    && hasAnyText(uiaText, ['发送消息', 'Send message', 'Send'])
}

function writeProviderBackResult(backRows) {
  const provider = backRows.find((row) => row.Case === 'providers') ?? {}
  const logPath = path.join(providerBackDir, 'providers-back-fixed.log')
  fs.writeFileSync(logPath, `generatedAt=${new Date().toISOString()}\ncase=providers\nchildOk=${provider.ChildOk === true}\nbackToSettings=${provider.BackOk === true}\n`, 'utf8')
  fs.writeFileSync(path.join(providerBackDir, 'providers-back-fixed-results.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    childOk: provider.ChildOk === true,
    backToSettings: provider.BackOk === true,
    stayedOnProviders: provider.StayedOnChild === true,
    errorAfterBack: false,
    beforePng: provider.childPng ?? null,
    beforeUia: provider.childUia ?? null,
    afterPng: provider.afterPng ?? null,
    afterUia: provider.afterUia ?? null,
    log: relative(logPath),
  }, null, 2)}\n`, 'utf8')
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

function forceStop(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function captureStep(device, dir, name) {
  const pngPath = path.join(dir, `${name}.png`)
  const uiaPath = path.join(dir, `${name}.uia.xml`)
  const remotePng = `/sdcard/Download/${name}.png`
  const remoteUia = `/sdcard/Download/${name}.uia.xml`
  captureFileWithRetry(device, remotePng, pngPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng])
  })
  captureFileWithRetry(device, remoteUia, uiaPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
  })
  const uiaText = fs.existsSync(uiaPath) ? fs.readFileSync(uiaPath, 'utf8') : ''
  return {
    png: relative(pngPath),
    uia: relative(uiaPath),
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

function tapFirstEditable(device, uiaText) {
  const node = parseNodes(uiaText).find((item) => item.enabled && item.className.includes('EditText'))
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box) return
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2))])
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

function matchesMarkerGroups(uiaText, groups) {
  return groups.every((group) => hasAnyText(uiaText, group))
}

function hasSettingsShell(uiaText) {
  return hasAnyText(uiaText, ['设置', 'Settings'])
    && hasAnyText(uiaText, ['AI 设置', '供应商', '上下文', '记忆', '知识', 'Preferences'])
}

function hasErrorBoundary(uiaText) {
  return hasAnyText(uiaText, ['页面暂时无法显示', 'Page is unavailable', 'Render Error', 'ReferenceError', 'TypeError'])
}

function extractErrorText(uiaText) {
  if (!hasErrorBoundary(uiaText)) return ''
  return extractVisibleText(uiaText).filter((text) => /页面暂时无法显示|Page is unavailable|Render Error|ReferenceError|TypeError/.test(text)).join(' | ')
}

function extractVisibleText(uiaText) {
  const values = []
  for (const match of uiaText.matchAll(/\b(?:text|content-desc)="([^"]+)"/g)) {
    const value = decodeXml(match[1]).trim()
    if (value && !values.includes(value)) values.push(value)
  }
  return values
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function textMatchesAny(node, labels) {
  return labels.some((label) => node.text.includes(label) || node.contentDesc.includes(label))
}

function writeFatalLog(device, file, startedAt) {
  const output = runCommand('adb', ['-s', device, 'logcat', '-d', '-v', 'time', '-t', '600']) ?? ''
  const startedIso = new Date(startedAt).toISOString()
  const lines = output
    .split(/\r?\n/)
    .filter((line) => line.includes(appPackageName) || /ReactNativeJS|AndroidRuntime|FATAL EXCEPTION/i.test(line))
    .filter((line) => /FATAL EXCEPTION|\sE\/AndroidRuntime|ReactNativeJS.*(?:TypeError|ReferenceError|Render Error)/i.test(line))
    .map(sanitizeEvidenceText)
  const body = [
    `generatedAt=${new Date().toISOString()}`,
    `startedAt=${startedIso}`,
    `fatalOrRenderErrorCount=${lines.length}`,
    ...lines,
  ].join('\n')
  fs.writeFileSync(file, `${body}\n`, 'utf8')
}

function sanitizeEvidenceText(value) {
  return String(value ?? '')
    .replace(/tp-[A-Za-z0-9_-]{16,}/g, 'tp-[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [redacted]')
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: 6 * 1024 * 1024,
    })
  } catch {
    return null
  }
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

main()
