const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa', 'key-visual-gaps')
const outputPath = path.join(root, 'test-evidence', 'qa', 'key-visual-gaps-results.json')
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'dadaa813'
const captureDestructiveDialogs = process.env.QA_CAPTURE_DESTRUCTIVE_DIALOGS === '1'

main()

function main() {
  fs.mkdirSync(evidenceDir, { recursive: true })
  const device = resolveDevice(defaultDevice)
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    packageName: appPackageName,
    options: {
      captureDestructiveDialogs,
    },
    captures: [],
    errors: [],
  }
  try {
    if (!device) throw new Error('No connected adb device was found.')

    captureAppShellStates(device, result)
    captureCleanBaselines(device, result)
    captureRouteAndHomeOverlays(device, result)
    captureKnowledgeKeyboard(device, result)
    if (captureDestructiveDialogs) captureKnowledgeMemoryDialogs(device, result)
  } catch (error) {
    result.errors.push(error?.message ?? String(error))
  }

  result.passed = result.errors.length === 0
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${result.passed ? 'Key visual gaps capture passed' : 'Key visual gaps capture failed'}: ${relative(outputPath)}.`)
  if (!result.passed) {
    console.error(result.errors.join('; '))
    process.exitCode = 1
  }
}

function captureAppShellStates(device, result) {
  openUrl(device, 'islemind://source?qaErrorBoundary=1&qaCapture=key-visual-gaps')
  sleep(2200)
  captureAndAssert(device, result, 'app-shell-error-boundary', {
    includeAny: [
      ['页面暂时无法显示', 'This page cannot be shown', 'このページを表示できません'],
      ['错误编号', 'Error reference'],
      ['QA forced source render failure'],
    ],
  })
  forceStopApp(device)
  sleep(700)

  openUrl(device, 'islemind://?qaUpdateNotice=QA')
  sleep(2600)
  const update = captureAndAssert(device, result, 'app-shell-update-notice', {
    includeAny: [
      ['发现新版本', 'New version found', '新しいバージョンがあります'],
      ['发现新版 APK：QA', 'New APK found: QA', '新しい APK があります: QA'],
    ],
    excludeAny: [
      ['open notification settings'],
      ['会话消息列表'],
    ],
  })
  tapText(device, update.uiaText, ['我知道了', 'OK', '知道了', '关闭'])
}

function captureCleanBaselines(device, result) {
  openUrl(device, 'islemind://')
  sleep(1800)
  captureAndAssert(device, result, 'current-x86-clean-baseline-home', {
    includeAny: [
      ['开始一段新对话', 'No provider connected', 'Chat'],
      ['模型和会话参数', 'Model and session', '配置服务商'],
    ],
  })

  openUrl(device, 'islemind://settings')
  sleep(1900)
  captureAndAssert(device, result, 'current-x86-clean-baseline-settings', {
    includeAny: [
      ['设置', 'Settings', '設定'],
      ['服务商', 'Providers', 'プロバイダー'],
    ],
  })

  openUrl(device, 'islemind://chat')
  sleep(1800)
  captureAndAssert(device, result, 'current-x86-clean-baseline-conversations', {
    includeAny: [
      ['还没有对话', 'No conversations yet', 'まだ会話がありません'],
      ['查看历史对话', 'View chat history', '会話履歴を見る'],
      ['历史', 'History', '履歴'],
    ],
  })
}

function captureRouteAndHomeOverlays(device, result) {
  openUrl(device, 'islemind://chat/__qa_missing__')
  sleep(2200)
  captureAndAssert(device, result, 'chat-invalid-route', {
    includeAny: [
      ['对话不可用', 'Conversation unavailable'],
      ['没有找到', 'not found', 'No results'],
    ],
  })

  openUrl(device, 'islemind://')
  sleep(1800)
  let home = captureStep(device, result, 'home-overlay-start')
  if (!tapText(device, home.uiaText, ['模型和会话参数', 'QA Android Workflow Provider', 'QA Mock OpenAI Provider', '配置服务商', 'Model and session'])) {
    result.errors.push('home-bottom-model-panel trigger was not tappable.')
  }
  sleep(900)
  captureAndAssert(device, result, 'home-bottom-model-panel', {
    includeAny: [
      ['模型和会话参数', 'Model and session'],
      ['服务商', 'Provider'],
      ['温度', 'Temperature'],
    ],
  })
  back(device)
  sleep(500)

  home = captureStep(device, result, 'home-more-panel-start')
  if (!tapText(device, home.uiaText, ['工具: 附件/知识', 'Tools'])) {
    result.errors.push('home-more-panel trigger was not tappable.')
  }
  sleep(800)
  captureAndAssert(device, result, 'home-more-panel', {
    includeAny: [
      ['本地知识', 'Local knowledge'],
      ['附件', 'Attachment'],
      ['工具', 'Tools'],
    ],
  })
  back(device)
  sleep(500)

  home = captureStep(device, result, 'home-session-options-start')
  tapText(device, home.uiaText, ['显示顶部栏', 'Show top bar'])
  sleep(700)
  home = captureStep(device, result, 'home-session-options-visible-top')
  if (!tapText(device, home.uiaText, ['模型和会话参数', 'QA Android Workflow Provider', 'QA Mock OpenAI Provider', '设置', 'Settings'])) {
    result.errors.push('home-session-options-panel trigger was not tappable.')
  }
  sleep(900)
  captureAndAssert(device, result, 'home-session-options-panel', {
    includeAny: [
      ['模型和会话参数', 'Model and session'],
      ['服务商', 'Provider'],
      ['设置', 'Settings'],
    ],
  })
  back(device)
  sleep(500)
}

function captureKnowledgeKeyboard(device, result) {
  openUrl(device, 'islemind://settings/knowledge?focus=import')
  sleep(2100)
  let knowledge = captureAndAssert(device, result, 'settings-knowledge-before-keyboard', {
    includeAny: [
      ['导入知识文件', 'Import knowledge file'],
      ['粘贴文本入库', 'Paste text into knowledge'],
      ['知识标题', 'Knowledge title'],
    ],
    excludeAny: [
      ['Skills'],
      ['提示词、参数、知识源'],
    ],
  })
  if (!tapEditableByNearbyLabel(device, knowledge.uiaText, ['知识正文', 'Body', '粘贴文本入库']) && !tapEditableAtIndex(device, knowledge.uiaText, 1)) {
    result.errors.push('Knowledge body field was not tappable.')
  }
  sleep(400)
  inputText(device, 'QA knowledge keyboard import body')
  sleep(700)
  captureAndAssert(device, result, 'settings-knowledge-body-keyboard-open', {
    includeAny: [
      ['导入知识文件', 'Import knowledge file'],
      ['粘贴文本入库', 'Paste text into knowledge'],
      ['知识标题', 'Knowledge title'],
      ['QA knowledge keyboard import body'],
    ],
    excludeAny: [
      ['Skills'],
      ['提示词、参数、知识源'],
    ],
  })
  back(device)
  sleep(400)
}

function captureKnowledgeMemoryDialogs(device, result) {
  openUrl(device, 'islemind://settings/knowledge')
  sleep(1600)
  let knowledge = captureAndAssert(device, result, 'knowledge-selftest-entry', {
    includeAny: [
      ['运行上下文功能自检', 'Run context self-test'],
      ['知识库', 'knowledge files'],
      ['导入知识文件', 'Import knowledge file'],
    ],
  })
  tapText(device, knowledge.uiaText, ['运行上下文功能自检', 'Run context self-test'])
  sleep(1400)
  captureAndAssert(device, result, 'knowledge-selftest-dialog', {
    includeAny: [
      ['自检', 'self-test'],
      ['步骤', 'steps'],
      ['完成', 'complete', 'issues'],
    ],
  })
  back(device)
  sleep(500)

  knowledge = captureStep(device, result, 'knowledge-delete-start')
  if (tapText(device, knowledge.uiaText, ['清空知识库', '知识库', 'knowledge files'])) {
    sleep(600)
    captureAndAssert(device, result, 'knowledge-clear-confirm', {
      includeAny: [
        ['清空', 'Clear'],
        ['确认', 'Confirm'],
        ['知识库', 'knowledge'],
      ],
    })
    back(device)
    sleep(400)
  } else {
    result.errors.push('knowledge-clear-confirm trigger was not tappable.')
  }

  openUrl(device, 'islemind://settings/memory')
  sleep(1600)
  const memory = captureAndAssert(device, result, 'memory-delete-start', {
    includeAny: [
      ['记忆', 'Memory', 'memories'],
      ['长期记忆', 'Long-term memory'],
    ],
  })
  if (tapText(device, memory.uiaText, ['清空记忆', '记忆 0', 'memories'])) {
    sleep(600)
    captureAndAssert(device, result, 'memory-clear-confirm', {
      includeAny: [
        ['清空', 'Clear'],
        ['确认', 'Confirm'],
        ['记忆', 'memory'],
      ],
    })
    back(device)
    sleep(400)
  } else {
    result.errors.push('memory-clear-confirm trigger was not tappable.')
  }
}

function captureAndAssert(device, result, name, assertion) {
  const capture = captureStep(device, result, name)
  const issues = assertCaptureText(name, capture.uiaText, assertion)
  if (issues.length) {
    result.errors.push(...issues)
    const record = result.captures.find((item) => item.name === name)
    if (record) record.semanticIssues = issues
  } else {
    const record = result.captures.find((item) => item.name === name)
    if (record) record.semanticPassed = true
  }
  return capture
}

function assertCaptureText(name, uiaText, assertion = {}) {
  const visible = extractVisibleText(uiaText)
  const haystack = visible.join('\n')
  const issues = []
  for (const group of assertion.includeAny ?? []) {
    if (!group.some((marker) => haystack.includes(marker))) {
      issues.push(`${name} missing semantic marker: one of ${group.map((item) => JSON.stringify(item)).join(', ')}`)
    }
  }
  for (const group of assertion.excludeAny ?? []) {
    const matched = group.find((marker) => haystack.includes(marker))
    if (matched) issues.push(`${name} includes excluded marker: ${JSON.stringify(matched)}`)
  }
  return issues
}

function captureStep(device, result, name) {
  const png = path.join(evidenceDir, `${name}.png`)
  const uia = path.join(evidenceDir, `${name}.uia.xml`)
  const remotePng = `/sdcard/Download/${name}.png`
  const remoteUia = `/sdcard/Download/${name}.uia.xml`
  runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng])
  runCommand('adb', ['-s', device, 'pull', remotePng, png])
  runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
  runCommand('adb', ['-s', device, 'pull', remoteUia, uia])
  const uiaText = fs.existsSync(uia) ? fs.readFileSync(uia, 'utf8') : ''
  result.captures.push({ name, png: relative(png), uia: relative(uia), visibleText: extractVisibleText(uiaText) })
  return { png, uia, uiaText }
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

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', shellQuote(url)])
}

function back(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
}

function forceStopApp(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function inputText(device, value) {
  const escaped = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/\s/g, '%s')
    .replace(/'/g, "\\'")
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', escaped])
}

function tapText(device, uiaText, labels) {
  const node = findTappableTextNode(parseNodes(uiaText), labels)
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapEditableAtIndex(device, uiaText, index) {
  const editables = parseNodes(uiaText).filter((node) => (
    node.enabled &&
    isUsableBounds(node.bounds) &&
    (node.className.includes('EditText') || node.className.includes('AutoCompleteTextView'))
  ))
  const node = editables[index]
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapEditableByNearbyLabel(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const labelsWithBounds = nodes
    .filter((node) => node.enabled && isUsableBounds(node.bounds) && textMatchesAny(node, labels))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter((item) => item.bounds)
  const editables = nodes
    .filter((node) => node.enabled && isUsableBounds(node.bounds) && (node.className.includes('EditText') || node.className.includes('AutoCompleteTextView')))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter((item) => item.bounds)
  for (const label of labelsWithBounds) {
    const below = editables
      .filter((editable) => editable.bounds.top >= label.bounds.top - 24)
      .sort((left, right) => Math.abs(left.bounds.top - label.bounds.bottom) - Math.abs(right.bounds.top - label.bounds.bottom))[0]
    if (below) {
      tapBoundsCenter(device, below.node.bounds)
      return true
    }
  }
  return false
}

function tapBoundsCenter(device, boundsText) {
  const bounds = parseBounds(boundsText)
  if (!bounds) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((bounds.left + bounds.right) / 2)), String(Math.round((bounds.top + bounds.bottom) / 2))])
  return true
}

function findTappableTextNode(nodes, labels) {
  const clickable = nodes.filter((item) => item.enabled && item.clickable && isUsableBounds(item.bounds))
  for (const label of labels) {
    const exactClickable = clickable.find((item) => item.text === label || item.contentDesc === label)
    if (exactClickable) return exactClickable
  }
  const containingClickable = clickable.find((item) => textMatchesAny(item, labels))
  if (containingClickable) return containingClickable
  const visibleLabel = nodes.find((item) => item.enabled && isUsableBounds(item.bounds) && textMatchesAny(item, labels))
  const visibleBounds = parseBounds(visibleLabel?.bounds)
  if (!visibleBounds) return visibleLabel ?? null
  return clickable
    .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
    .filter(({ bounds }) => bounds && boundsContains(bounds, visibleBounds))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.item
    ?? visibleLabel
}

function textMatchesAny(node, labels) {
  return labels.some((label) => node.text.includes(label) || node.contentDesc.includes(label))
}

function parseNodes(uiaText) {
  const nodes = []
  const pattern = /<node\b([^>]*)>/g
  let match
  while ((match = pattern.exec(String(uiaText ?? '')))) {
    const attrs = match[1]
    nodes.push({
      text: decodeXml(attr(attrs, 'text')),
      contentDesc: decodeXml(attr(attrs, 'content-desc')),
      className: decodeXml(attr(attrs, 'class')),
      bounds: decodeXml(attr(attrs, 'bounds')),
      clickable: attr(attrs, 'clickable') === 'true',
      enabled: attr(attrs, 'enabled') !== 'false',
    })
  }
  return nodes
}

function extractVisibleText(uiaText) {
  const values = []
  for (const node of parseNodes(uiaText)) {
    if (node.text) values.push(node.text)
    if (node.contentDesc) values.push(node.contentDesc)
  }
  return [...new Set(values)]
}

function attr(attrs, name) {
  const match = attrs.match(new RegExp(`${name}="([^"]*)"`))
  return match?.[1] ?? ''
}

function parseBounds(boundsText) {
  const match = String(boundsText ?? '').match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
  if (!match) return null
  const [, left, top, right, bottom] = match.map(Number)
  return { left, top, right, bottom }
}

function isUsableBounds(boundsText) {
  const bounds = parseBounds(boundsText)
  return Boolean(bounds && bounds.right > bounds.left && bounds.bottom > bounds.top)
}

function boundsContains(outer, inner) {
  return outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      maxBuffer: 12 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}
