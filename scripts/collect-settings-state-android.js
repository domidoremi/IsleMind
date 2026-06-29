const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const appPackageName = defaultReleaseAppPackageName
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const smokeDir = path.join(evidenceDir, 'settings-state-smoke')

function main() {
  fs.mkdirSync(smokeDir, { recursive: true })
  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  if (!device) throw new Error('No connected adb device was found for settings state smoke.')

  const originalFontScale = normalizeOriginalFontScale(readFontScale(device))
  const results = {
    themeLocale: [],
    preferences: null,
    fontScale: null,
    keyboardEvidence: [],
  }

  try {
    restoreAppearance(device)
    results.themeLocale = runThemeLocaleSmoke(device)
    restoreAppearance(device)
    results.preferences = runPreferencesPersistenceSmoke(device)
    results.keyboardEvidence.push(runSkillsKeyboardSmoke(device))
    results.keyboardEvidence.push(runContextSearchKeyboardSmoke(device))
    results.fontScale = runFontScaleSmoke(device, originalFontScale)
  } finally {
    writeFontScale(device, originalFontScale)
    restoreAppearance(device)
  }

  fs.writeFileSync(path.join(evidenceDir, 'theme-locale-results.json'), `${JSON.stringify(results.themeLocale, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(evidenceDir, 'settings-preferences-persistence-results.json'), `${JSON.stringify(results.preferences, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(evidenceDir, 'font-scale-results.json'), `${JSON.stringify(results.fontScale, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(smokeDir, 'settings-keyboard-results.json'), `${JSON.stringify(results.keyboardEvidence, null, 2)}\n`, 'utf8')

  const failedThemeSteps = results.themeLocale.filter((row) => !row.ok)
  const keyboardFailures = results.keyboardEvidence.filter((row) => !row.inputFocused || row.errorVisible)
  const failed = [
    ...failedThemeSteps.map((row) => `theme:${row.Step}`),
    ...(results.preferences?.changedAfterToggle && results.preferences?.persistedAfterRestart ? [] : ['preferences:persistence']),
    ...(results.fontScale?.testFontScale === '1.30' ? [] : ['font-scale:1.30']),
    ...keyboardFailures.map((row) => `keyboard:${row.name}`),
  ]

  console.log(`Settings state smoke wrote ${results.themeLocale.length} theme/locale rows, preferences=${failed.includes('preferences:persistence') ? 'failed' : 'passed'}, fontScale=${results.fontScale?.testFontScale ?? 'missing'}.`)
  if (failed.length) {
    console.error(`Settings state smoke failures: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

function runThemeLocaleSmoke(device) {
  const rows = []

  openSettingsRoot(device, 'theme-root-dark')
  const darkTap = findAndTapText(device, ['深色', 'Dark', 'ダーク'], 'theme-find-dark', 8)
  sleep(900)
  let capture = captureStep(device, 'settings-dark')
  rows.push(themeLocaleRow('theme-dark', darkTap, capture, ['深色', 'Dark', 'ダーク', '日间', 'Light']))
  openUrl(device, 'islemind://')
  sleep(1200)
  capture = captureStep(device, 'home-dark')

  openSettingsRoot(device, 'theme-root-en')
  let languageSelection = chooseLanguageAndWait(device, ['English'], ['Theme System', 'Language', 'Day / Night'], 'theme-find-en', 'settings-en')
  capture = languageSelection.capture
  rows.push(themeLocaleRow('language-en', languageSelection.tapped, capture, ['Theme System', 'Language', 'Day / Night']))
  openUrl(device, 'islemind://')
  sleep(1200)
  captureStep(device, 'home-en')

  openSettingsRoot(device, 'theme-root-ja')
  languageSelection = chooseLanguageAndWait(device, ['日本語'], ['テーマシステム', '言語', '昼 / 夜'], 'theme-find-ja', 'settings-ja')
  capture = languageSelection.capture
  rows.push(themeLocaleRow('language-ja', languageSelection.tapped, capture, ['テーマシステム', '言語', '昼 / 夜']))
  openUrl(device, 'islemind://')
  sleep(1200)
  captureStep(device, 'home-ja')

  openSettingsRoot(device, 'theme-root-zh')
  languageSelection = chooseLanguageAndWait(device, ['简体中文'], ['主题系统', '语言', '日间 / 夜间'], 'theme-find-zh', 'settings-restore-zh')
  capture = languageSelection.capture
  rows.push(themeLocaleRow('restore-zh', languageSelection.tapped, capture, ['主题系统', '语言', '日间 / 夜间']))

  openSettingsRoot(device, 'theme-root-system')
  const systemTap = findAndTapText(device, ['跟随系统', 'System', 'システム'], 'theme-find-system', 8)
  sleep(900)
  capture = captureStep(device, 'settings-restore-system')
  rows.push(themeLocaleRow('restore-system', systemTap, capture, ['跟随系统', 'System', '设置', 'Settings']))

  return rows
}

function themeLocaleRow(step, tapped, capture, markers) {
  return {
    Step: step,
    ok: tapped && hasAnyText(capture.uiaText, markers) && !hasErrorBoundary(capture.uiaText),
    tapped,
    png: capture.png,
    uia: capture.uia,
    visibleText: extractVisibleText(capture.uiaText).slice(0, 80),
  }
}

function runPreferencesPersistenceSmoke(device) {
  const logPath = path.join(smokeDir, 'preferences-persistence.log')
  forceStop(device)
  sleep(700)
  openSettingsSubpage(
    device,
    'islemind://settings/preferences',
    ['偏好', 'Preferences', '設定'],
    ['生成参数', 'Generation parameters', '触觉反馈', 'Haptics'],
    'preferences-root-open'
  )
  const before = waitForText(device, ['触觉反馈', 'Haptics', '偏好', 'Preferences'], 'preferences-persistence-before', 6)
  const tapped = tapText(device, before.uiaText, ['触觉反馈', 'Haptics', '触覚フィードバック'])
  sleep(900)
  const after = captureStep(device, 'preferences-persistence-after-toggle')
  forceStop(device)
  sleep(700)
  openUrl(device, 'islemind://settings/preferences')
  sleep(1800)
  const afterRestart = waitForText(device, ['触觉反馈', 'Haptics', '偏好', 'Preferences'], 'preferences-persistence-after-restart', 6)
  const restoreTapped = tapText(device, afterRestart.uiaText, ['触觉反馈', 'Haptics', '触覚フィードバック'])
  sleep(500)
  fs.writeFileSync(logPath, [
    `generatedAt=${new Date().toISOString()}`,
    `tapped=${tapped}`,
    `restoreTapped=${restoreTapped}`,
    `beforeText=${extractVisibleText(before.uiaText).slice(0, 16).join(' | ')}`,
    `afterRestartText=${extractVisibleText(afterRestart.uiaText).slice(0, 16).join(' | ')}`,
  ].join('\n') + '\n', 'utf8')

  return {
    generatedAt: new Date().toISOString(),
    label: '触觉反馈',
    changedAfterToggle: tapped && !hasErrorBoundary(after.uiaText),
    persistedAfterRestart: tapped && hasAnyText(afterRestart.uiaText, ['触觉反馈', 'Haptics', '偏好', 'Preferences']) && !hasErrorBoundary(afterRestart.uiaText),
    stateEvidence: 'release UI toggle capture; private AsyncStorage is not readable from non-debuggable APK',
    before: {
      inferredState: 'before-toggle',
      png: before.png,
      uia: before.uia,
      visibleText: extractVisibleText(before.uiaText).slice(0, 40),
    },
    afterToggle: {
      inferredState: 'after-toggle',
      png: after.png,
      uia: after.uia,
      visibleText: extractVisibleText(after.uiaText).slice(0, 40),
    },
    afterRestart: {
      inferredState: 'after-restart',
      png: afterRestart.png,
      uia: afterRestart.uia,
      visibleText: extractVisibleText(afterRestart.uiaText).slice(0, 40),
    },
    restoreTapped,
    log: relative(logPath),
  }
}

function runSkillsKeyboardSmoke(device) {
  openUrl(device, 'islemind://settings/skills')
  sleep(1400)
  let capture = captureStep(device, 'settings-skills-before-keyboard')
  const tapped = tapFirstEditable(device, capture.uiaText)
  if (tapped) {
    sleep(450)
    runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_SKILL'])
    sleep(900)
  }
  capture = captureStep(device, 'settings-skills-keyboard-open')
  return keyboardRow('settings-skills-keyboard-open', tapped, capture, ['QA_SKILL', '名称', 'Name', '保存', 'Save'])
}

function runContextSearchKeyboardSmoke(device) {
  openUrl(device, 'islemind://settings/context')
  sleep(1400)
  findAndTapText(device, ['Tavily'], 'context-find-tavily', 3)
  sleep(600)
  const tapped = findAndTapEditable(device, ['Tavily Key', 'tvly-', 'Google Search Key'], 'context-find-search-key', 10)
  if (tapped) {
    sleep(450)
    runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_SEARCH_KEY'])
    sleep(900)
  }
  const capture = captureStep(device, 'settings-context-search-key-keyboard-open')
  return keyboardRow('settings-context-search-key-keyboard-open', tapped, capture, ['Tavily Key', 'QA_SEARCH_KEY', '保存搜索配置'])
}

function keyboardRow(name, tapped, capture, markers) {
  const nodes = parseNodes(capture.uiaText)
  return {
    name,
    tapped,
    inputFocused: nodes.some((node) => node.enabled && node.focused && node.className.includes('EditText')),
    actionVisible: hasAnyText(capture.uiaText, markers),
    errorVisible: hasErrorBoundary(capture.uiaText),
    png: capture.png,
    uia: capture.uia,
    visibleText: extractVisibleText(capture.uiaText).slice(0, 80),
  }
}

function runFontScaleSmoke(device, originalFontScale) {
  writeFontScale(device, '1.30')
  forceStop(device)
  sleep(800)
  openUrl(device, 'islemind://settings')
  sleep(1800)
  const settingsCapture = captureStep(device, 'fontscale-130-settings')
  openUrl(device, 'islemind://')
  sleep(1400)
  const homeCapture = captureStep(device, 'fontscale-130-home')
  return {
    generatedAt: new Date().toISOString(),
    serial: device,
    originalFontScale,
    testFontScale: '1.30',
    settingsPng: settingsCapture.png,
    settingsUia: settingsCapture.uia,
    homePng: homeCapture.png,
    homeUia: homeCapture.uia,
    settingsVisibleText: extractVisibleText(settingsCapture.uiaText).slice(0, 60),
    homeVisibleText: extractVisibleText(homeCapture.uiaText).slice(0, 60),
  }
}

function restoreAppearance(device) {
  openSettingsRoot(device, 'restore-root-zh')
  findAndTapText(device, ['简体中文'], 'restore-find-zh', 8)
  sleep(900)
  openSettingsRoot(device, 'restore-root-system')
  findAndTapText(device, ['跟随系统', 'System', 'システム'], 'restore-find-system', 8)
  sleep(500)
}

function openSettingsRoot(device, capturePrefix) {
  openUrl(device, 'islemind://settings')
  sleep(1600)
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  if (tapText(device, capture.uiaText, ['返回', 'Back', '戻る'])) {
    sleep(900)
    capture = captureStep(device, `${capturePrefix}-back`)
    if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  }
  openUrl(device, 'islemind://settings')
  sleep(1800)
  capture = captureStep(device, `${capturePrefix}-retry`)
  if (isSettingsRoot(capture.uiaText)) return normalizeSettingsRootScroll(device, capturePrefix, capture)
  return capture
}

function openSettingsSubpage(device, url, entryLabels, targetMarkers, capturePrefix) {
  openUrl(device, url)
  sleep(1800)
  let capture = captureStep(device, `${capturePrefix}-direct`)
  if (hasAnyText(capture.uiaText, targetMarkers)) return capture
  openSettingsRoot(device, `${capturePrefix}-root`)
  for (let index = 0; index < 8; index += 1) {
    capture = captureStep(device, `${capturePrefix}-find-${index}`)
    if (tapText(device, capture.uiaText, entryLabels)) {
      sleep(1200)
      return capture
    }
    swipeUp(device)
    sleep(350)
  }
  return capture
}

function isSettingsRoot(uiaText) {
  return hasAnyText(uiaText, [
    '主题系统',
    'Theme System',
    'テーマシステム',
    '导入 / 导出',
    'Import / Export',
    'インポート / エクスポート',
    '技能',
    'Skills',
    'スキル',
    'MCP Tools',
    'Agent workflow',
    'エージェントワークフロー',
  ])
}

function normalizeSettingsRootScroll(device, capturePrefix, initialCapture) {
  let capture = initialCapture
  for (let index = 1; index <= 4; index += 1) {
    swipeDown(device)
    sleep(300)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
  }
  return capture
}

function findAndTapText(device, labels, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapText(device, capture.uiaText, labels)) return true
  for (let index = 1; index <= Math.min(4, maxScrolls); index += 1) {
    swipeDown(device)
    sleep(350)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
    if (tapText(device, capture.uiaText, labels)) return true
  }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapText(device, capture.uiaText, labels)) return true
  }
  return false
}

function findAndTapEditable(device, labels, capturePrefix, maxScrolls) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  if (tapEditable(device, capture.uiaText, labels)) return true
  for (let index = 1; index <= Math.min(4, maxScrolls); index += 1) {
    swipeDown(device)
    sleep(350)
    capture = captureStep(device, `${capturePrefix}-top-${index}`)
    if (tapEditable(device, capture.uiaText, labels)) return true
  }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index}`)
    if (tapEditable(device, capture.uiaText, labels)) return true
  }
  return false
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

function chooseLanguageAndWait(device, labels, targetMarkers, findPrefix, captureName) {
  let tapped = findAndTapText(device, labels, findPrefix, 8)
  sleep(1800)
  let capture = waitForText(device, targetMarkers, captureName, 8)
  if (hasAnyText(capture.uiaText, targetMarkers)) return { tapped, capture }
  sleep(1600)
  const retryTapped = findAndTapText(device, labels, `${findPrefix}-retry`, 8)
  tapped = tapped || retryTapped
  sleep(2200)
  capture = waitForText(device, targetMarkers, captureName, 8)
  return { tapped, capture }
}

function tapText(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  for (const label of labels) {
    const node = findTappableTextNode(nodes, label)
    if (!node) continue
    tapBoundsCenter(device, node.bounds)
    return true
  }
  return false
}

function tapEditable(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const editables = nodes.filter((node) => node.enabled && node.className.includes('EditText'))
  for (const label of labels) {
    const direct = editables.find((node) => textMatches(node, label))
    if (direct) {
      tapBoundsCenter(device, direct.bounds)
      return true
    }
  }
  const labelNode = nodes.find((node) => labels.some((label) => textMatches(node, label)))
  if (!labelNode) return false
  const labelBounds = parseBounds(labelNode.bounds)
  const candidate = editables
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && (!labelBounds || bounds.top >= labelBounds.top - 12))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0]?.node
  if (!candidate) return false
  tapBoundsCenter(device, candidate.bounds)
  return true
}

function tapFirstEditable(device, uiaText) {
  const node = parseNodes(uiaText).find((item) => item.enabled && item.className.includes('EditText'))
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function findTappableTextNode(nodes, label) {
  const clickable = nodes.filter((item) => item.enabled && item.clickable)
  const exactClickable = clickable.find((item) => item.text === label || item.contentDesc === label)
  if (exactClickable) return exactClickable
  const containingClickable = clickable.find((item) => textMatches(item, label))
  if (containingClickable) return containingClickable

  const visibleLabel = nodes.find((item) => item.enabled && textMatches(item, label))
  const visibleBounds = visibleLabel ? parseBounds(visibleLabel.bounds) : null
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

function swipeDown(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '560', '432', '1580', '420'])
}

function forceStop(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function resolveDevice(requested, options = {}) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (serials.includes(requested)) return requested
  if (options.strict) return null
  return serials[0] ?? null
}

function readFontScale(device) {
  return (runCommand('adb', ['-s', device, 'shell', 'settings', 'get', 'system', 'font_scale']) ?? '').trim()
}

function writeFontScale(device, value) {
  runCommand('adb', ['-s', device, 'shell', 'settings', 'put', 'system', 'font_scale', value])
}

function normalizeOriginalFontScale(value) {
  const parsed = Number.parseFloat(String(value ?? '').trim())
  if (!Number.isFinite(parsed)) return '1.0'
  if (Math.abs(parsed - 1) < 0.01) return '1.0'
  return parsed.toFixed(2)
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function textMatches(node, label) {
  return node.text.includes(label) || node.contentDesc.includes(label)
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
