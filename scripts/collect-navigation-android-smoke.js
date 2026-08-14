const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const stableCaptureCount = 2

const routeDir = path.join(evidenceDir, 'fresh-route-smoke')
const backDir = path.join(evidenceDir, 'settings-back-dynamic')
const homeReturnDir = path.join(evidenceDir, 'home-return-navigation')
const keyboardDir = path.join(evidenceDir, 'fresh-keyboard-smoke-after-fix')
const homeReturnRepeatCount = 2

const routeCases = [
  {
    name: 'home',
    url: 'islemind://',
    markerGroups: [['输入消息', '问点什么', 'Input message', 'Message input'], ['发送消息', 'Send message', '查看历史对话', 'View chat history']],
  },
  {
    name: 'conversations',
    url: 'islemind://conversations',
    markerGroups: [['对话', 'Conversations', 'Chats'], ['新对话', 'New chat', 'New Chat', '还没有历史', 'No history yet']],
  },
  {
    name: 'settings',
    url: 'islemind://settings',
    markerGroups: [['设置', 'Settings'], ['常用', 'Common', '服务商与模型', 'Provider & model'], ['外观与语言', 'Appearance & language', '基础功能', 'Basic Features']],
  },
  {
    name: 'settings-providers',
    url: 'islemind://settings/providers',
    markerGroups: [['供应商', '服务商', 'Providers'], ['批量导入', 'Batch Import', 'Import providers', '添加服务商', 'Add Provider']],
    siblingMarkers: ['Retrieval, search, checks', 'Memory status', 'Files and text', 'Model parameters, interaction, feedback', 'Prompts, parameters, knowledge sources', 'HTTP/SSE/Streamable HTTP tool servers'],
  },
  {
    name: 'settings-context',
    url: 'islemind://settings/context',
    markerGroups: [['上下文', 'Context'], ['检索、搜索与检查', 'Retrieval, search, checks', '联网搜索', 'Web search', 'Search']],
    siblingMarkers: ['Use other sort modes to inspect providers', 'Memory status', 'Files and text', 'Model parameters, interaction, feedback', 'Prompts, parameters, knowledge sources', 'HTTP/SSE/Streamable HTTP tool servers'],
  },
  {
    name: 'settings-memory',
    url: 'islemind://settings/memory',
    markerGroups: [['记忆', 'Memory'], ['记忆状态', 'Memory status', '长期记忆', 'Long-term memory']],
    siblingMarkers: ['Use other sort modes to inspect providers', 'Retrieval, search, checks', 'Files and text', 'Model parameters, interaction, feedback', 'Prompts, parameters, knowledge sources', 'HTTP/SSE/Streamable HTTP tool servers'],
  },
  {
    name: 'settings-knowledge',
    url: 'islemind://settings/knowledge',
    markerGroups: [['知识', 'Knowledge'], ['文件和文本', 'Files and text', '导入知识文件', 'Import knowledge file']],
    siblingMarkers: ['Use other sort modes to inspect providers', 'Retrieval, search, checks', 'Memory status', 'Model parameters, interaction, feedback', 'Prompts, parameters, knowledge sources', 'HTTP/SSE/Streamable HTTP tool servers'],
  },
  {
    name: 'settings-preferences',
    url: 'islemind://settings/preferences',
    markerGroups: [
      ['偏好', 'Preferences', '環境設定'],
      ['模型参数、交互、反馈', 'Model parameters, interaction, feedback', 'モデル設定、操作、フィードバック'],
      ['生成参数', 'Generation', '生成'],
    ],
    siblingMarkers: ['Use other sort modes to inspect providers', 'Retrieval, search, checks', 'Memory status', 'Files and text', 'Prompts, parameters, knowledge sources', 'HTTP/SSE/Streamable HTTP tool servers'],
  },
  {
    name: 'settings-skills',
    url: 'islemind://settings/skills',
    markerGroups: [['技能', 'Skills', 'スキル'], ['提示词、参数、知识源', 'Prompts, parameters, knowledge sources', 'プロンプト、パラメータ、ナレッジソース', '创建技能', 'Create Skill', 'スキル作成']],
    siblingMarkers: ['Use other sort modes to inspect providers', 'Retrieval, search, checks', 'Memory status', 'Files and text', 'Model parameters, interaction, feedback', 'HTTP/SSE/Streamable HTTP tool servers'],
  },
  {
    name: 'settings-mcp',
    url: 'islemind://settings/mcp',
    markerGroups: [['MCP 工具', 'MCP Tools'], ['HTTP/SSE/Streamable HTTP tool servers', '添加 MCP Server', 'Add MCP Server', '内置工具', 'Built-in tools']],
    siblingMarkers: ['Use other sort modes to inspect providers', 'Retrieval, search, checks', 'Memory status', 'Files and text', 'Model parameters, interaction, feedback', 'Prompts, parameters, knowledge sources'],
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
    markerGroups: [['供应商', '服务商', 'Providers'], ['批量导入', 'Import providers', '添加服务商', 'Add Provider']],
    childOnlyMarkers: ['Use other sort modes to inspect providers', 'Import providers', 'Add Provider'],
  },
  {
    Case: 'context',
    url: 'islemind://settings/context',
    markerGroups: [['上下文', 'Context'], ['检索、搜索与检查', 'Retrieval, search, checks', '联网搜索', 'Web search']],
    childOnlyMarkers: ['RAG retrieval mode', 'Search API'],
  },
  {
    Case: 'memory',
    url: 'islemind://settings/memory',
    markerGroups: [['记忆', 'Memory'], ['记忆状态', 'Memory status', '长期记忆', 'Long-term memory']],
    childOnlyMarkers: ['Clear 0 memories', 'No memories', 'Confirmed memories will appear here'],
  },
  {
    Case: 'knowledge',
    url: 'islemind://settings/knowledge',
    markerGroups: [['知识', 'Knowledge'], ['文件和文本', 'Files and text', '导入知识文件', 'Import knowledge file']],
    childOnlyMarkers: ['Import knowledge file', 'Paste text into knowledge', 'No knowledge files'],
  },
  {
    Case: 'preferences',
    url: 'islemind://settings/preferences',
    markerGroups: [
      ['偏好', 'Preferences', '環境設定'],
      ['模型参数、交互、反馈', 'Model parameters, interaction, feedback', 'モデル設定、操作、フィードバック'],
      ['生成参数', 'Generation', '生成'],
    ],
    childOnlyMarkers: ['生成参数', 'Generation', '温度', 'Agent 工作流', 'Agent workflow', 'Agent ワークフロー'],
  },
  {
    Case: 'skills',
    url: 'islemind://settings/skills',
    markerGroups: [['技能', 'Skills', 'スキル'], ['提示词、参数、知识源', 'Prompts, parameters, knowledge sources', 'プロンプト、パラメータ、ナレッジソース', '创建技能', 'Create Skill', 'スキル作成']],
    childOnlyMarkers: ['提示词、参数、知识源', 'Prompts, parameters, knowledge sources', 'プロンプト、パラメータ、ナレッジソース', '创建技能', 'Create Skill', 'スキル作成', '工作流模板', 'Workflow templates', 'ワークフローテンプレート'],
  },
  {
    Case: 'mcp',
    url: 'islemind://settings/mcp',
    markerGroups: [['MCP 工具', 'MCP Tools'], ['HTTP/SSE/Streamable HTTP tool servers', '添加 MCP Server', 'Add MCP Server', '内置工具', 'Built-in tools']],
    childOnlyMarkers: ['HTTP/SSE/Streamable HTTP tool servers', 'Add MCP Server', 'Built-in tools'],
  },
]

const homeReturnCases = [
  {
    name: 'history-to-home',
    url: 'islemind://conversations',
    markerGroups: [['对话', 'Conversations', 'Chats'], ['新对话', 'New chat', 'New Chat', '还没有历史', 'No history yet']],
    siblingMarkers: ['新对话', 'New chat', 'New Chat', '还没有历史', 'No history yet'],
  },
  {
    name: 'settings-to-home',
    url: 'islemind://settings',
    markerGroups: [['设置', 'Settings'], ['常用', 'Common', '服务商与模型', 'Provider & model']],
    siblingMarkers: ['服务商与模型', 'Provider & model', '外观与语言', 'Appearance & language', '基础功能', 'Basic Features'],
  },
  {
    name: 'nested-settings-to-home',
    url: 'islemind://settings/preferences',
    markerGroups: [['偏好', 'Preferences', '環境設定'], ['生成参数', 'Generation', '生成']],
    childOnlyMarkers: ['生成参数', 'Generation', '温度', 'Agent 工作流', 'Agent workflow', 'Agent ワークフロー'],
    siblingMarkers: ['服务商与模型', 'Provider & model', '外观与语言', 'Appearance & language', '基础功能', 'Basic Features'],
    returnToSettingsRoot: true,
  },
]

function main() {
  for (const dir of [evidenceDir, routeDir, backDir, homeReturnDir, keyboardDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const device = resolveDevice(defaultDevice)
  if (!device) {
    throw new Error(`Requested adb device ${defaultDevice} was not found for navigation smoke.`)
  }

  runCommand('adb', ['-s', device, 'logcat', '-c'])
  forceStop(device)

  const routeRows = runRouteSmoke(device)
  const backRows = runSettingsBackSmoke(device)
  const homeReturnRows = runHomeReturnSmoke(device)
  const keyboardResult = runHomeKeyboardSmoke(device)

  fs.writeFileSync(path.join(backDir, '..', 'settings-back-dynamic-results.json'), `${JSON.stringify(backRows, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(routeDir, 'route-smoke-results.json'), `${JSON.stringify(routeRows, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(homeReturnDir, 'home-return-results.json'), `${JSON.stringify(homeReturnRows, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(keyboardDir, 'home-keyboard-open-results.json'), `${JSON.stringify(keyboardResult, null, 2)}\n`, 'utf8')

  const failedRoutes = routeRows.filter((row) => !row.expectedOk || row.errorText)
  const failedBack = backRows.filter((row) => !row.Found || !row.ChildOk || !row.BackOk || row.StayedOnChild)
  const failedHomeReturns = homeReturnRows.filter((row) => !row.sourceStable || !row.tappedHome || !row.homeStable || row.siblingVisible || row.errorVisible)
  const keyboardFailed = !keyboardResult.inputFocused || !keyboardResult.sendButtonPresent || !keyboardResult.homeStillVisible || keyboardResult.errorVisible || !keyboardResult.ime?.visible || !keyboardResult.nonOccluded
  const failures = [
    ...failedRoutes.map((row) => `route:${row.name}`),
    ...failedBack.map((row) => `back:${row.Case}`),
    ...failedHomeReturns.map((row) => `home-return:${row.name}:cycle-${row.cycle}`),
    ...(keyboardFailed ? ['keyboard:home'] : []),
  ]

  console.log(`Navigation Android smoke wrote ${routeRows.length} routes, ${backRows.length} Back cases, ${homeReturnRows.length} repeated Home returns, keyboard=${keyboardFailed ? 'failed' : 'passed'}.`)
  if (failures.length) {
    console.error(`Navigation Android smoke failures: ${failures.join(', ')}`)
    process.exitCode = 1
  }
}

function runRouteSmoke(device) {
  const startedAt = Date.now()
  const rows = routeCases.map((testCase) => {
    openUrl(device, testCase.url)
    const stable = waitForStableCapture(device, routeDir, `${testCase.name}-route`, (uiaText) => (
      matchesMarkerGroups(uiaText, testCase.markerGroups)
      && !hasAnyText(uiaText, testCase.siblingMarkers ?? [])
      && !hasErrorBoundary(uiaText)
    ))
    const capture = stable.capture
    const siblingVisible = hasAnyText(capture.uiaText, testCase.siblingMarkers ?? [])
    return {
      name: testCase.name,
      url: testCase.url,
      expectedOk: stable.stable,
      siblingVisible,
      errorText: extractErrorText(capture.uiaText),
      png: capture.png,
      uia: capture.uia,
      stableCaptureCount: stable.consecutive,
      attempts: stable.attempts,
      transitionSequence: stable.transitionSequence,
      visibleText: extractVisibleText(capture.uiaText).slice(0, 60),
    }
  })
  writeFatalLog(device, path.join(routeDir, 'route-smoke-current.log'), startedAt)
  return rows
}

function runSettingsBackSmoke(device) {
  return settingsBackCases.map((testCase) => {
    openUrl(device, testCase.url)
    const childStable = waitForStableCapture(device, backDir, `settings-back-dynamic-${testCase.Case}-child`, (uiaText) => (
      matchesMarkerGroups(uiaText, testCase.markerGroups)
      && !hasErrorBoundary(uiaText)
    ))
    const child = childStable.capture
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    const afterStable = waitForStableCapture(device, backDir, `settings-back-dynamic-${testCase.Case}-after`, (uiaText) => (
      hasSettingsShell(uiaText)
      && !hasAnyText(uiaText, testCase.childOnlyMarkers)
      && !hasErrorBoundary(uiaText)
    ))
    const after = afterStable.capture
    const stayedOnChild = hasAnyText(after.uiaText, testCase.childOnlyMarkers)
    return {
      Case: testCase.Case,
      Found: child.uiaText.length > 0,
      ChildOk: childStable.stable,
      BackOk: afterStable.stable && !stayedOnChild,
      StayedOnChild: stayedOnChild,
      childAttempts: childStable.attempts,
      childStableCaptureCount: childStable.consecutive,
      childTransitionSequence: childStable.transitionSequence,
      afterAttempts: afterStable.attempts,
      afterStableCaptureCount: afterStable.consecutive,
      afterTransitionSequence: afterStable.transitionSequence,
      errorAfterBack: hasErrorBoundary(after.uiaText),
      childPng: child.png,
      childUia: child.uia,
      afterPng: after.png,
      afterUia: after.uia,
      childVisibleText: extractVisibleText(child.uiaText).slice(0, 60),
      afterVisibleText: extractVisibleText(after.uiaText).slice(0, 60),
    }
  })
}

function runHomeReturnSmoke(device) {
  const startedAt = Date.now()
  const rows = []

  for (const testCase of homeReturnCases) {
    for (let cycle = 1; cycle <= homeReturnRepeatCount; cycle += 1) {
      const capturePrefix = `${testCase.name}-cycle-${cycle}`
      openUrl(device, testCase.url)
      const source = waitForStableCapture(device, homeReturnDir, `${capturePrefix}-source`, (uiaText) => (
        matchesMarkerGroups(uiaText, testCase.markerGroups)
        && !hasErrorBoundary(uiaText)
      ))

      let navigationSource = source
      if (testCase.returnToSettingsRoot && source.stable) {
        runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
        navigationSource = waitForStableCapture(device, homeReturnDir, `${capturePrefix}-settings-root`, (uiaText) => (
          hasSettingsShell(uiaText)
          && !hasAnyText(uiaText, testCase.childOnlyMarkers ?? [])
          && !hasErrorBoundary(uiaText)
        ))
      }

      const tappedHome = navigationSource.stable
        && tapFirstMatchingNode(device, navigationSource.capture.uiaText, ['聊天', 'Chat', 'チャット'])
      const transitionStartedAt = Date.now()
      const home = waitForStableCapture(device, homeReturnDir, `${capturePrefix}-home`, (uiaText) => (
        hasHomeComposer(uiaText)
        && !hasAnyText(uiaText, testCase.siblingMarkers)
        && !hasErrorBoundary(uiaText)
      ))
      const siblingVisible = hasAnyText(home.capture.uiaText, testCase.siblingMarkers)
      const errorVisible = hasErrorBoundary(home.capture.uiaText)

      rows.push({
        name: testCase.name,
        cycle,
        url: testCase.url,
        sourceStable: source.stable && navigationSource.stable,
        tappedHome,
        homeStable: home.stable,
        siblingVisible,
        errorVisible,
        timeToStableHomeMs: Date.now() - transitionStartedAt,
        sourceAttempts: source.attempts,
        sourceStableCaptureCount: source.consecutive,
        sourceTransitionSequence: source.transitionSequence,
        navigationSourceAttempts: navigationSource.attempts,
        navigationSourceStableCaptureCount: navigationSource.consecutive,
        homeAttempts: home.attempts,
        homeStableCaptureCount: home.consecutive,
        homeTransitionSequence: home.transitionSequence,
        sourcePng: source.capture.png,
        sourceUia: source.capture.uia,
        navigationSourcePng: navigationSource.capture.png,
        navigationSourceUia: navigationSource.capture.uia,
        homePng: home.capture.png,
        homeUia: home.capture.uia,
        homeVisibleText: extractVisibleText(home.capture.uiaText).slice(0, 60),
      })
    }
  }

  writeFatalLog(device, path.join(homeReturnDir, 'home-return-current.log'), startedAt)
  return rows
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
    sleep(500)
  }
  const imeWait = waitForImeVisible(device, keyboardDir, 'home-keyboard-open')
  capture = imeWait.capture
  const nodes = parseNodes(capture.uiaText)
  const inputFocused = nodes.some((node) => node.enabled && node.focused && node.className.includes('EditText'))
  const inputNode = nodes.find((node) => node.enabled && node.className.includes('EditText') && textMatchesAny(node, ['输入消息', '问点什么', 'Input message', 'Message input']))
    ?? nodes.find((node) => node.enabled && node.className.includes('EditText'))
  const sendNode = nodes.find((node) => textMatchesAny(node, ['发送消息', 'Send message', 'Send']))
  const inputBounds = parseBounds(inputNode?.bounds)
  const sendBounds = parseBounds(sendNode?.bounds)
  const ime = imeWait.ime
  const inputAboveIme = Boolean(inputBounds && ime.bounds && inputBounds.bottom <= ime.bounds.top)
  const sendAboveIme = Boolean(sendBounds && ime.bounds && sendBounds.bottom <= ime.bounds.top)
  const sendButtonPresent = Boolean(sendNode)
  const homeStillVisible = hasAnyText(capture.uiaText, ['输入消息', '问点什么', 'Input message', 'Message input', '查看历史对话', 'View chat history'])
  const errorVisible = hasErrorBoundary(capture.uiaText)
  const nonOccluded = ime.visible && inputAboveIme && sendAboveIme
  writeFatalLog(device, logPath, startedAt)
  return {
    generatedAt: new Date().toISOString(),
    device,
    tappedInput: tapped,
    inputFocused,
    sendButtonPresent,
    homeStillVisible,
    errorVisible,
    ime,
    imeAttempts: imeWait.attempts,
    inputBounds,
    sendBounds,
    inputAboveIme,
    sendAboveIme,
    nonOccluded,
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
  return hasAnyText(uiaText, ['输入消息', '问点什么', 'Input message', 'Message input'])
    && hasAnyText(uiaText, ['发送消息', 'Send message', 'Send'])
}

function resolveDevice(requested) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  return null
}

function waitForStableCapture(device, dir, name, predicate, maxAttempts = 12) {
  let capture = { png: null, uia: null, uiaText: '' }
  let consecutive = 0
  const transitionSequence = []
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) sleep(Math.min(500 + attempt * 100, 1200))
    capture = captureStep(device, dir, name)
    const matched = Boolean(predicate(capture.uiaText))
    consecutive = matched ? consecutive + 1 : 0
    transitionSequence.push({
      attempt,
      matched,
      errorVisible: hasErrorBoundary(capture.uiaText),
      visibleText: extractVisibleText(capture.uiaText).slice(0, 12),
    })
    if (consecutive >= stableCaptureCount) {
      return { capture, stable: true, consecutive, attempts: attempt, transitionSequence }
    }
  }
  return { capture, stable: false, consecutive, attempts: maxAttempts, transitionSequence }
}

function waitForImeVisible(device, dir, name, maxAttempts = 10) {
  let capture = { png: null, uia: null, uiaText: '' }
  let ime = readImeState(device)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) sleep(450)
    capture = captureStep(device, dir, name)
    ime = readImeState(device)
    if (ime.visible && ime.bounds) return { capture, ime, attempts: attempt }
  }
  return { capture, ime, attempts: maxAttempts }
}

function readImeState(device) {
  const inputMethod = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'input_method']) ?? ''
  const windowDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window']) ?? ''
  const frameMatch = windowDump.match(/type=(?:ime|ITYPE_IME)[^\r\n]*?frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\][^\r\n]*?visible=(true|false)/i)
  const bounds = frameMatch ? {
    left: Number(frameMatch[1]),
    top: Number(frameMatch[2]),
    right: Number(frameMatch[3]),
    bottom: Number(frameMatch[4]),
  } : null
  const inputShown = /\bmInputShown=true\b/.test(inputMethod)
  const windowVisible = /\bmIsImeShowing=true\b/.test(windowDump) || frameMatch?.[5] === 'true'
  return {
    visible: inputShown && windowVisible && Boolean(bounds),
    inputShown,
    windowVisible,
    bounds,
  }
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
  return tapBoundsCenter(device, node.bounds)
}

function tapFirstMatchingNode(device, uiaText, labels) {
  const node = parseNodes(uiaText).find((item) => item.enabled && item.clickable && textMatchesAny(item, labels))
  if (!node) return false
  return tapBoundsCenter(device, node.bounds)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box) return false
  return runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2))]) !== null
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
