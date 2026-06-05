const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { resolveApkArtifactPath, defaultReleaseSmokeArch, defaultReleaseSmokeVariant } = require('./release-artifact-contract')
const { cleanInstallState, defaultReleaseAppPackageName } = require('./release-validation-contract')
const { sensitiveEvidenceExtensions, sensitiveEvidencePatterns, collectSensitiveEvidenceHits, redactSensitiveEvidenceText } = require('./sensitive-evidence-contract')
const {
  providerRuntimeAndroidSchema,
  providerRuntimeAndroidEvidenceDirRelativePath,
  providerRuntimeAndroidResultRelativePath,
  providerRuntimeAndroidRunLogRelativePath,
  requiredProviderRuntimeAndroidScenarios,
  validateProviderRuntimeAndroidEvidencePath,
  isProviderRuntimeSensitiveDataPassing,
  collectProviderRuntimeAndroidResultContractIssues,
  validateProviderRuntimeAndroidResult,
  isProviderRuntimeAndroidResultPassing,
  summarizeProviderRuntimeAndroidDiagnostics,
} = require('./provider-runtime-android-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const smokeDir = path.join(root, providerRuntimeAndroidEvidenceDirRelativePath)
const outputPath = path.join(root, providerRuntimeAndroidResultRelativePath)
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const remoteFixturePath = '/sdcard/Download/islemind-provider-runtime-android.json'
const runtimeLogEvidence = path.join(root, providerRuntimeAndroidRunLogRelativePath)

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  fs.mkdirSync(smokeDir, { recursive: true })
  const expected = readExpectedAppConfig()
  const apkPath = resolveApkPath(expected)
  const device = resolveDevice(defaultDevice)
  const result = createBaseResult({
    deviceSerial: device,
    apkPath: relative(apkPath),
    packageName: appPackageName,
    expected,
  })

  try {
    if (!device) throw new Error('No connected adb device was found.')
    result.device = readDeviceState(device)
    result.installed = readInstalledPackageInfo(device)
    writeFixture(device)

    result.scenarios.push(runProviderSettingsRoute(device))
    result.scenarios.push(runProviderImportKeyboard(device))
    result.scenarios.push(runChatModelSwitch(device))
    result.scenarios.push(runBlockedModelRecovery(device))
    result.scenarios.push(runRuntimeFallbackTrace(device))
    result.scenarios.push(runProviderHealthState(device))
    result.scenarios.push(runAndroidBack(device))
    result.scenarios.push(runRestartRecovery(device))
  } catch (error) {
    const errorMessage = sanitizeEvidenceText(error?.message ?? error)
    result.errors.push(errorMessage)
    for (const id of requiredProviderRuntimeAndroidScenarios) {
      if (!result.scenarios.some((scenario) => scenario.id === id)) {
        result.scenarios.push(failedScenario(id, 'Scenario was not executed.', errorMessage))
      }
    }
  }

  finalizeResult(result)
  writeRunLog(result)
  writeResult(result)
  if (!isPassing(result)) process.exitCode = 1
}

function runProviderSettingsRoute(device) {
  const record = scenarioRecord('provider-settings-route', {
    expectedState: 'Providers route is visible with provider-management controls and no app error boundary.',
    fixEntry: 'src/components/providers/ProviderSettingsContent.tsx',
  })
  openUrl(device, 'islemind://settings/providers')
  sleep(2200)
  const capture = captureStep(device, record, 'provider-runtime-settings-route')
  const ok = hasAnyText(capture.uiaText, ['供应商', 'Providers', 'プロバイダー'])
    && hasAnyText(capture.uiaText, ['批量导入', 'Batch Import', '添加服务商', 'Add Provider'])
    && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Providers route rendered.' : 'Providers route controls were not visible.')
}

function runProviderImportKeyboard(device) {
  const record = scenarioRecord('provider-import-keyboard', {
    expectedState: 'Provider batch import sheet keeps focused input and import action visible with the Android keyboard open.',
    fixEntry: 'src/components/providers/ProviderSettingsContent.tsx',
  })
  openUrl(device, 'islemind://settings/providers')
  sleep(1600)
  let capture = captureStep(device, record, 'provider-runtime-import-start')
  if (!tapText(device, capture.uiaText, ['批量导入', 'Batch Import'])) {
    return completeScenario(record, false, capture, 'Batch import action was not tappable.')
  }
  sleep(900)
  capture = captureStep(device, record, 'provider-runtime-import-sheet')
  tapFirstEditable(device, capture.uiaText)
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_PROVIDER_RUNTIME'])
  sleep(900)
  capture = captureStep(device, record, 'provider-runtime-import-keyboard')
  record.keyboardState = captureKeyboardState(device, 'provider-runtime-import-keyboard-state')
  const ok = hasAnyText(capture.uiaText, ['导入', 'Import'])
    && hasAnyText(capture.uiaText, ['QA_PROVIDER_RUNTIME', '批量导入', 'Batch Import'])
    && record.keyboardState.imeVisible === true
    && record.keyboardState.editableFocused === true
    && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Keyboard-open provider import was visible.' : 'Keyboard-open provider import state was not proven.')
}

function runChatModelSwitch(device) {
  const record = scenarioRecord('chat-model-switch', {
    expectedState: 'Home chat model picker opens and exposes provider/model switching controls.',
    fixEntry: 'src/components/chat/ChatOptionsPanel.tsx',
  })
  openUrl(device, 'islemind://')
  sleep(2200)
  let capture = captureStep(device, record, 'provider-runtime-home')
  const opened = tapText(device, capture.uiaText, ['切换模型', 'Switch model'])
    || tapText(device, capture.uiaText, ['模型', 'Model'])
    || tapText(device, capture.uiaText, ['供应商', 'Providers'])
  if (opened) {
    sleep(900)
    capture = captureStep(device, record, 'provider-runtime-model-switch')
  }
  const ok = opened
    && hasAnyText(capture.uiaText, ['搜索或切换', 'Search or switch', '供应商', 'Providers', '模型', 'Model'])
    && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Model switch surface opened.' : 'Model switch surface was not proven.')
}

function runBlockedModelRecovery(device) {
  const record = scenarioRecord('blocked-model-recovery', {
    expectedState: 'Blocked or unavailable model state shows recoverable configuration or switch action without sending.',
    fixEntry: 'src/components/chat/ChatWorkspace.tsx',
  })
  openUrl(device, 'islemind://')
  sleep(1800)
  const capture = captureStep(device, record, 'provider-runtime-blocked-model')
  const ok = hasAnyText(capture.uiaText, [
    '模型不可用',
    'Model unavailable',
    '当前会话配置异常',
    'Session configuration',
    '会话参数',
    'Session settings',
    '去配置',
    'Configure',
    '切换模型',
    'Switch model',
    '切换',
    'Switch',
    '当前服务商',
    'Current provider',
  ]) && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Recoverable blocked-model state was visible.' : 'Blocked-model recovery state was not visible in the current fixture state.')
}

function runRuntimeFallbackTrace(device) {
  const record = scenarioRecord('runtime-fallback-trace', {
    expectedState: 'Runtime fallback trace or runtime log evidence exists without full credential leakage.',
    fixEntry: 'src/services/ai/base.ts',
  })
  openUrl(device, 'islemind://settings')
  sleep(1600)
  let capture = captureStep(device, record, 'provider-runtime-fallback')
  const logText = collectRuntimeLogText(device)
  let ok = hasRuntimeFallbackEvidence(logText, capture.uiaText)
  if (!ok) {
    const found = findByScrolling(device, record, capture, [
      'fallback',
      'Fallback',
      '降级',
      '运行时诊断',
      'Runtime diagnostics',
    ], 5)
    capture = found.capture
    ok = found.matched || hasRuntimeFallbackEvidence(logText, capture.uiaText)
  }
  return completeScenario(record, ok, capture, ok ? 'Runtime fallback evidence was visible or logged.' : 'Runtime fallback evidence was not present in current app state.')
}

function runProviderHealthState(device) {
  const record = scenarioRecord('provider-health-state', {
    expectedState: 'Runtime diagnostics or Provider state exposes provider health without credential values.',
    fixEntry: 'src/components/main/SettingsScreenContent.tsx',
  })
  openUrl(device, 'islemind://settings')
  sleep(1800)
  let capture = captureStep(device, record, 'provider-runtime-health')
  const found = findByScrolling(device, record, capture, ['运行时诊断', 'Runtime diagnostics', '供应商健康', 'provider health', 'Providers'], 5)
  capture = found.capture
  const ok = found.matched && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Provider health diagnostics were visible.' : 'Provider health state was not visible.')
}

function runAndroidBack(device) {
  const record = scenarioRecord('android-back', {
    expectedState: 'Android Back returns from Providers to Settings without error boundary.',
    fixEntry: 'app/_layout.tsx',
  })
  openUrl(device, 'islemind://settings/providers')
  sleep(1600)
  const before = captureStep(device, record, 'provider-runtime-android-back-before')
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(1400)
  const after = captureStep(device, record, 'provider-runtime-android-back')
  const ok = hasAnyText(before.uiaText, ['供应商', 'Providers'])
    && hasAnyText(after.uiaText, ['设置', 'Settings', 'AI 工作区', 'AI workspace'])
    && !hasAnyText(after.uiaText, ['供应商不存在', 'Provider not found'])
    && !hasErrorBoundary(after.uiaText)
  return completeScenario(record, ok, after, ok ? 'Android Back returned to Settings.' : 'Android Back did not prove provider-to-settings recovery.')
}

function runRestartRecovery(device) {
  const record = scenarioRecord('restart-recovery', {
    expectedState: 'Force-stop and relaunch restores the home/settings shell without blank screen or error boundary.',
    fixEntry: 'app/_layout.tsx',
  })
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(900)
  openUrl(device, 'islemind://')
  sleep(2600)
  const capture = captureStep(device, record, 'provider-runtime-restart')
  const ok = hasAnyText(capture.uiaText, ['IsleMind', '给 IsleMind 一个任务', 'Settings', '设置', 'Providers', '供应商'])
    && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'App shell restored after restart.' : 'Restart recovery was not proven.')
}

function scenarioRecord(id, { expectedState, fixEntry }) {
  return {
    id,
    status: 'failed',
    steps: [],
    expectedState,
    actualState: 'not_executed',
    fixEntry,
    png: null,
    uia: null,
    log: relative(runtimeLogEvidence),
  }
}

function failedScenario(id, expectedState, actualState) {
  return {
    id,
    status: 'failed',
    steps: ['collector-start'],
    expectedState,
    actualState: sanitizeEvidenceText(actualState),
    fixEntry: 'scripts/collect-provider-runtime-android.js',
    png: null,
    uia: null,
    log: relative(runtimeLogEvidence),
    keyboardState: id === 'provider-import-keyboard' ? emptyKeyboardState() : undefined,
  }
}

function completeScenario(record, ok, capture, actualState) {
  record.status = ok ? 'passed' : 'failed'
  record.actualState = sanitizeEvidenceText(actualState)
  record.png = capture?.png ?? record.png
  record.uia = capture?.uia ?? record.uia
  return record
}

function createBaseResult({ deviceSerial, apkPath, packageName, expected = null }) {
  return {
    schema: providerRuntimeAndroidSchema,
    generatedAt: new Date().toISOString(),
    deviceSerial,
    apkPath,
    packageName,
    expected,
    device: null,
    installed: null,
    sensitiveData: { fullCredentialLeak: false, scannedFiles: 0, hits: [] },
    scenarios: [],
    errors: [],
    passed: false,
    contractIssues: [],
    diagnostics: null,
  }
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

function readDeviceState(device) {
  return {
    serial: device,
    abi: runCommand('adb', ['-s', device, 'shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null,
    sdk: runCommand('adb', ['-s', device, 'shell', 'getprop', 'ro.build.version.sdk'])?.trim() ?? null,
  }
}

function readInstalledPackageInfo(device) {
  const packageDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'package', appPackageName]) ?? ''
  const info = {
    deviceSerial: device,
    packagePath: runCommand('adb', ['-s', device, 'shell', 'pm', 'path', appPackageName])?.trim() ?? null,
    versionName: matchFirst(packageDump, /versionName=([^\s]+)/),
    versionCode: toNumber(matchFirst(packageDump, /versionCode=(\d+)/)),
    firstInstallTime: matchFirst(packageDump, /firstInstallTime=([^\n\r]+)/),
    lastUpdateTime: matchFirst(packageDump, /lastUpdateTime=([^\n\r]+)/),
  }
  Object.assign(info, cleanInstallState(info.firstInstallTime, info.lastUpdateTime))
  return info
}

function writeFixture(device) {
  const fixturePath = path.join(smokeDir, 'islemind-provider-runtime-android.json')
  const fixture = {
    app: 'islemind',
    version: 1,
    exportedAt: Date.now(),
    settings: {
      language: 'zh-CN',
      onboardingCompleted: true,
      runtimeLogEnabled: true,
      providerAllowlist: [],
      providerBlocklist: [],
      modelAllowlist: [],
      modelBlocklist: [],
    },
    conversations: [],
    providers: [],
    skills: [],
    mcpServers: [],
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  runCommand('adb', ['-s', device, 'push', fixturePath, remoteFixturePath])
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function captureStep(device, record, name) {
  const png = path.join(smokeDir, `${name}.png`)
  const uia = path.join(smokeDir, `${name}.uia.xml`)
  captureFileWithRetry(device, `/sdcard/${name}.png`, png, () => {
    runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', `/sdcard/${name}.png`])
  })
  captureFileWithRetry(device, `/sdcard/${name}.uia.xml`, uia, () => {
    runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', `/sdcard/${name}.uia.xml`])
  })
  const uiaText = fs.existsSync(uia) ? sanitizePersistedTextEvidence(uia) : ''
  const step = {
    name,
    png: relative(png),
    uia: relative(uia),
    visibleText: extractVisibleText(uiaText).slice(0, 100),
  }
  record.steps.push(step)
  return { png: step.png, uia: step.uia, uiaText }
}

function captureFileWithRetry(device, remotePath, localPath, captureRemote) {
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    captureRemote()
    runCommand('adb', ['-s', device, 'pull', remotePath, localPath])
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) return true
    sleep(450 + attempt * 350)
  }
  return false
}

function findByScrolling(device, record, initialCapture, labels, maxScrolls) {
  let capture = initialCapture
  if (hasAnyText(capture.uiaText, labels)) return { matched: true, capture }
  for (let index = 0; index < maxScrolls; index += 1) {
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, record, `${record.id}-scroll-${index}`)
    if (hasAnyText(capture.uiaText, labels)) return { matched: true, capture }
  }
  return { matched: false, capture }
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
      clickable: matchFirst(tag, /clickable="([^"]+)"/) === 'true',
    })
  }
  return nodes
}

function textMatches(node, label) {
  return node.text.includes(label) || node.contentDesc.includes(label)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box) return
  const x = Math.round((box.left + box.right) / 2)
  const y = Math.round((box.top + box.bottom) / 2)
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(x), String(y)])
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '620', '450'])
}

function hasAnyText(text, values) {
  return values.some((value) => text.includes(value))
}

function hasErrorBoundary(uiaText) {
  return hasAnyText(uiaText, ['页面暂时无法显示', 'Page is unavailable', 'Render Error', 'ReferenceError', 'TypeError'])
}

function hasRuntimeFallbackEvidence(logText, uiaText) {
  return /fallback\.decision|runtime-fallback|transport\.fallback/i.test(logText)
    || hasAnyText(uiaText, ['fallback', 'Fallback', '降级', '运行时诊断', 'Runtime diagnostics'])
}

function collectRuntimeLogText(device) {
  const logcat = runCommand('adb', ['-s', device, 'logcat', '-d', '-v', 'time', '-t', '600']) ?? ''
  const lines = logcat
    .split(/\r?\n/)
    .filter((line) => line.includes(appPackageName) || /fallback|runtime|provider|ReactNativeJS/i.test(line))
    .slice(-200)
    .map(sanitizeEvidenceText)
  const text = lines.join('\n')
  fs.writeFileSync(runtimeLogEvidence, `${text}\n`, 'utf8')
  return text
}

function writeRunLog(result) {
  fs.appendFileSync(runtimeLogEvidence, `${formatRunLogLines(result).join('\n')}\n`, 'utf8')
}

function formatRunLogLines(result) {
  const lines = [
    `generatedAt=${result.generatedAt}`,
    `deviceSerial=${result.deviceSerial ?? 'missing'}`,
    `apkPath=${result.apkPath ?? 'missing'}`,
    `packageName=${result.packageName ?? 'missing'}`,
    `fullCredentialLeak=${result.sensitiveData.fullCredentialLeak}`,
    `passed=${result.passed === true}`,
    `contractIssueCount=${Array.isArray(result.contractIssues) ? result.contractIssues.length : 'missing'}`,
    ...result.scenarios.map((scenario) => `scenario=${scenario.id}:${scenario.status}:${sanitizeEvidenceText(scenario.actualState)}`),
    ...(Array.isArray(result.contractIssues) ? result.contractIssues.map((issue) => `contractIssue=${sanitizeEvidenceText(issue)}`) : []),
    ...result.errors.map((error) => `error=${sanitizeEvidenceText(error)}`),
  ]
  return lines
}

function finalizeResult(result) {
  const plannedEvidencePaths = new Set([
    relative(outputPath),
    relative(runtimeLogEvidence),
  ])
  const validatePath = (value) => validateRepositoryOrPlannedEvidencePath(value, plannedEvidencePaths)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result.sensitiveData = scanSensitiveEvidence(buildPendingSensitiveEvidence(result))
    result.contractIssues = collectProviderRuntimeAndroidResultContractIssues(result, {
      expectedPackageName: appPackageName,
      validatePath,
    })
    result.passed = result.contractIssues.length === 0
    result.diagnostics = summarizeProviderRuntimeAndroidDiagnostics(result, {
      expectedPackageName: appPackageName,
      validatePath,
    })
  }
  return result
}

function scanSensitiveEvidence(extraEvidence = []) {
  const sources = new Map()
  const files = listFiles(smokeDir).filter((file) => sensitiveEvidenceExtensions.has(path.extname(file)))
  for (const file of files) {
    sources.set(relative(file), fs.readFileSync(file, 'utf8'))
  }
  for (const item of extraEvidence) {
    const key = relative(item.file)
    const existing = sources.get(key)
    sources.set(key, existing ? `${existing}\n${item.text}` : String(item.text ?? ''))
  }
  return scanSensitiveEvidenceSources(sources)
}

function buildPendingSensitiveEvidence(result) {
  return [
    { file: outputPath, text: formatResultJson(result) },
    { file: runtimeLogEvidence, text: formatRunLogLines(result).join('\n') },
  ]
}

function scanSensitiveEvidenceSources(sources) {
  const hits = []
  for (const [file, text] of sources) {
    hits.push(...collectSensitiveEvidenceHits(file, text).map(({ index, ...hit }) => hit))
  }
  return { fullCredentialLeak: hits.length > 0, scannedFiles: sources.size, scannedPaths: [...sources.keys()].sort(), hits }
}

function isPassing(result) {
  return isProviderRuntimeAndroidResultPassing(result, {
    expectedPackageName: appPackageName,
    validatePath: validateRepositoryEvidencePath,
  })
}

function isPassingSensitiveData(sensitiveData, options = {}) {
  return isProviderRuntimeSensitiveDataPassing(sensitiveData, {
    validatePath: validateRepositoryEvidencePath,
    ...options,
  })
}

function validateRepositoryEvidencePath(value) {
  return validateProviderRuntimeAndroidEvidencePath(root, value)
}

function validateRepositoryOrPlannedEvidencePath(value, plannedEvidencePaths) {
  const issue = validateRepositoryEvidencePath(value)
  if (issue === 'missing' && plannedEvidencePaths.has(value)) return null
  return issue
}

function writeResult(result) {
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(outputPath, `${formatResultJson(result)}\n`, 'utf8')
  console.log(`${isPassing(result) ? 'Provider Runtime Android smoke passed' : 'Provider Runtime Android smoke failed'}: ${relative(outputPath)}`)
}

function formatResultJson(result) {
  return JSON.stringify(result, null, 2)
}

function runSelfTest() {
  const fixture = createBaseResult({
    deviceSerial: 'emulator-self-test',
    apkPath: 'dist-apk/IsleMind-self-test.apk',
    packageName: appPackageName,
    expected: {
      packageVersion: '1.0.0',
      expoVersion: '1.0.0',
      androidPackage: appPackageName,
      androidVersionCode: 1,
    },
  })
  fixture.sensitiveData = {
    fullCredentialLeak: false,
    scannedFiles: 2,
    scannedPaths: [
      providerRuntimeAndroidResultRelativePath,
      providerRuntimeAndroidRunLogRelativePath,
    ],
    hits: [],
  }
  fixture.device = {
    serial: 'emulator-self-test',
    abi: 'x86_64',
    sdk: '35',
  }
  fixture.passed = true
  fixture.installed = {
    deviceSerial: 'emulator-self-test',
    packagePath: `package:/data/app/~~self-test/${appPackageName}-self-test/base.apk`,
    versionName: '1.0.0',
    versionCode: 1,
    firstInstallTime: '2026-06-02 00:00:00',
    lastUpdateTime: '2026-06-02 00:00:12',
    cleanInstall: true,
    cleanInstallWindowMs: 12000,
  }
  fixture.contractIssues = []
  fixture.diagnostics = null
  for (const id of requiredProviderRuntimeAndroidScenarios) {
    fixture.scenarios.push({
      id,
      status: 'passed',
      steps: [{ name: `${id}-step`, png: `test-evidence/qa/provider-runtime-android/${id}.png`, uia: `test-evidence/qa/provider-runtime-android/${id}.uia.xml`, visibleText: [id] }],
      expectedState: `${id} expected`,
      actualState: `${id} actual`,
      fixEntry: 'scripts/collect-provider-runtime-android.js',
      png: `test-evidence/qa/provider-runtime-android/${id}.png`,
      uia: `test-evidence/qa/provider-runtime-android/${id}.uia.xml`,
      log: providerRuntimeAndroidRunLogRelativePath,
      keyboardState: id === 'provider-import-keyboard'
        ? {
            imeVisible: true,
            editableFocused: true,
            evidence: 'test-evidence/qa/provider-runtime-android/provider-runtime-import-keyboard-state.json',
            signals: { inputShown: true, inputViewShown: true, servedEditText: true, currentFocusEditText: true, imeWindowVisible: true },
          }
        : undefined,
    })
  }
  const knownSensitivePaths = new Set(fixture.sensitiveData.scannedPaths)
  const sensitiveDataOptions = {
    validatePath: (value) => knownSensitivePaths.has(value) ? null : 'missing',
  }
  fixture.diagnostics = summarizeProviderRuntimeAndroidDiagnostics(fixture, {
    expectedPackageName: appPackageName,
    validatePath: false,
    sensitiveData: sensitiveDataOptions,
    scenario: { validatePath: false },
  })
  const issues = validateResultShape(fixture, { sensitiveData: sensitiveDataOptions })
  if (issues.length) throw new Error(`Provider Runtime Android self-test failed: ${issues.join('; ')}`)
  const createdSelfTestEvidenceFiles = []
  const createdSelfTestEvidenceDirs = []
  const ensureSelfTestEvidenceFile = (evidencePath) => {
    const absolutePath = path.join(root, evidencePath)
    if (fs.existsSync(absolutePath)) return
    const evidenceDir = path.dirname(absolutePath)
    if (!fs.existsSync(evidenceDir)) createdSelfTestEvidenceDirs.push(evidenceDir)
    fs.mkdirSync(evidenceDir, { recursive: true })
    fs.writeFileSync(absolutePath, '', 'utf8')
    createdSelfTestEvidenceFiles.push(absolutePath)
  }
  try {
    for (const evidencePath of [providerRuntimeAndroidResultRelativePath, providerRuntimeAndroidRunLogRelativePath]) {
      ensureSelfTestEvidenceFile(evidencePath)
    }
    for (const scenario of fixture.scenarios) {
      const stepEvidencePaths = scenario.steps.flatMap((step) => step && typeof step === 'object'
        ? [step.png, step.uia]
        : [])
      for (const evidencePath of [
        scenario.png,
        scenario.uia,
        ...stepEvidencePaths,
        ...(scenario.keyboardState?.evidence ? [scenario.keyboardState.evidence] : []),
      ].filter(Boolean)) {
        ensureSelfTestEvidenceFile(evidencePath)
      }
    }
    const passingFixture = {
      ...fixture,
      sensitiveData: {
        ...fixture.sensitiveData,
        scannedPaths: [relative(outputPath), relative(runtimeLogEvidence)],
      },
    }
    if (!isPassing(passingFixture)) throw new Error('Provider Runtime Android self-test rejected normalized scenario evidence paths.')
    const nonNormalizedScenarioFixture = {
      ...passingFixture,
      scenarios: passingFixture.scenarios.map((scenario, index) => index === 0
        ? { ...scenario, png: `./${scenario.png}` }
        : scenario),
    }
    if (isPassing(nonNormalizedScenarioFixture)) {
      throw new Error('Provider Runtime Android self-test accepted non-normalized scenario evidence paths.')
    }
    const nonNormalizedStepFixture = {
      ...passingFixture,
      scenarios: passingFixture.scenarios.map((scenario, index) => index === 0
        ? {
            ...scenario,
            steps: scenario.steps.map((step, stepIndex) => stepIndex === 0
              ? { ...step, png: `./${step.png}` }
              : step),
          }
        : scenario),
    }
    if (isPassing(nonNormalizedStepFixture)) {
      throw new Error('Provider Runtime Android self-test accepted non-normalized step evidence paths.')
    }
    const nonNormalizedScenarioLogFixture = {
      ...passingFixture,
      scenarios: passingFixture.scenarios.map((scenario, index) => index === 0
        ? { ...scenario, log: `./${scenario.log}` }
        : scenario),
    }
    if (isPassing(nonNormalizedScenarioLogFixture)) {
      throw new Error('Provider Runtime Android self-test accepted non-normalized scenario log evidence paths.')
    }
  } finally {
    for (const file of createdSelfTestEvidenceFiles.reverse()) {
      fs.rmSync(file, { force: true })
    }
    for (const dir of createdSelfTestEvidenceDirs.reverse()) {
      try {
        fs.rmdirSync(dir)
      } catch {
        // Keep directories that now contain user or evidence files.
      }
    }
  }
  const sensitiveDataInvalidCases = [
    ['leak flag', { ...fixture.sensitiveData, fullCredentialLeak: true }],
    ['zero scanned files', { ...fixture.sensitiveData, scannedFiles: 0, scannedPaths: [] }],
    ['missing scanned files', { ...fixture.sensitiveData, scannedFiles: undefined }],
    ['missing scanned paths', { ...fixture.sensitiveData, scannedPaths: undefined }],
    ['non-string scanned path', { ...fixture.sensitiveData, scannedFiles: 2, scannedPaths: [relative(outputPath), null] }],
    ['blank scanned path', { ...fixture.sensitiveData, scannedFiles: 2, scannedPaths: [relative(outputPath), ''] }],
    ['scanned path count mismatch', { ...fixture.sensitiveData, scannedPaths: [relative(outputPath)] }],
    ['duplicate scanned path', { ...fixture.sensitiveData, scannedFiles: 3, scannedPaths: [relative(outputPath), relative(runtimeLogEvidence), relative(runtimeLogEvidence)] }],
    ['missing result path', { ...fixture.sensitiveData, scannedPaths: [relative(runtimeLogEvidence), 'test-evidence/qa/provider-runtime-android/step.uia.xml'] }],
    ['missing run log path', { ...fixture.sensitiveData, scannedPaths: [relative(outputPath), 'test-evidence/qa/provider-runtime-android/step.uia.xml'] }],
    ['missing referenced path', { ...fixture.sensitiveData, scannedFiles: 3, scannedPaths: [relative(outputPath), relative(runtimeLogEvidence), 'test-evidence/qa/provider-runtime-android/missing.log'] }],
    ['missing hits array', { ...fixture.sensitiveData, hits: undefined }],
    ['non-empty hits', { ...fixture.sensitiveData, hits: [{ file: 'test-evidence/qa/provider-runtime-android/leak.log' }] }],
  ]
  for (const [name, sensitiveData] of sensitiveDataInvalidCases) {
    if (isPassingSensitiveData(sensitiveData, sensitiveDataOptions)) {
      throw new Error(`Provider Runtime Android self-test accepted invalid sensitiveData: ${name}.`)
    }
  }
  const resultInvalidCases = [
    ['schema', { ...fixture, schema: 'islemind.provider-runtime-android.invalid' }, 'schema is invalid'],
    ['generatedAt missing', { ...fixture, generatedAt: '' }, 'does not record generatedAt'],
    ['generatedAt parseable', { ...fixture, generatedAt: 'not-a-date' }, 'generatedAt is not parseable'],
    ['generatedAt UTC ISO', { ...fixture, generatedAt: '2026-06-02T00:00:00+08:00' }, 'generatedAt is not UTC ISO-8601'],
    ['deviceSerial', { ...fixture, deviceSerial: '' }, 'does not record deviceSerial'],
    ['device state', { ...fixture, device: null }, 'does not record device state'],
    ['device serial mismatch', { ...fixture, device: { ...fixture.device, serial: 'emulator-other' } }, 'device serial emulator-other does not match deviceSerial emulator-self-test'],
    ['device ABI', { ...fixture, device: { ...fixture.device, abi: '' } }, 'device ABI is missing'],
    ['device SDK', { ...fixture, device: { ...fixture.device, sdk: '' } }, 'device SDK is missing'],
    ['apkPath', { ...fixture, apkPath: '' }, 'does not record apkPath'],
    ['absolute apkPath', { ...fixture, apkPath: path.join(root, 'dist-apk/IsleMind-self-test.apk') }, 'apkPath is not repository-relative'],
    ['outside apkPath', { ...fixture, apkPath: '../outside.apk' }, 'apkPath is outside the repository'],
    ['non-normalized apkPath', { ...fixture, apkPath: './dist-apk/IsleMind-self-test.apk' }, 'apkPath is not normalized repository-relative'],
    ['non-apk apkPath', { ...fixture, apkPath: 'dist-apk/IsleMind-self-test.txt' }, 'apkPath must reference an APK'],
    ['packageName', { ...fixture, packageName: 'com.invalid.app' }, 'packageName is com.invalid.app'],
    ['expected config', { ...fixture, expected: null }, 'does not record expected app config'],
    ['expected package missing', { ...fixture, expected: { ...fixture.expected, androidPackage: null } }, 'expected app config Android package is missing'],
    ['expected package', { ...fixture, expected: { ...fixture.expected, androidPackage: 'com.invalid.app' } }, 'expected app config Android package'],
    ['expected version code missing', { ...fixture, expected: { ...fixture.expected, androidVersionCode: null } }, 'expected app config Android versionCode is missing'],
    ['expected version mismatch', { ...fixture, expected: { ...fixture.expected, expoVersion: '9.9.9' } }, 'installed versionName'],
    ['expected code mismatch', { ...fixture, expected: { ...fixture.expected, androidVersionCode: 999 } }, 'installed versionCode'],
    ['installed state', { ...fixture, installed: null }, 'does not record installed package provenance'],
    ['installed device serial missing', { ...fixture, installed: { ...fixture.installed, deviceSerial: '' } }, 'installed deviceSerial is missing'],
    ['installed device serial mismatch', { ...fixture, installed: { ...fixture.installed, deviceSerial: 'emulator-other' } }, 'installed deviceSerial emulator-other does not match deviceSerial emulator-self-test'],
    ['installed package path', { ...fixture, installed: { ...fixture.installed, packagePath: 'package:/data/app/com.invalid.app/base.apk' } }, 'installed package path does not include expected package'],
    ['installed version name', { ...fixture, installed: { ...fixture.installed, versionName: '' } }, 'installed versionName'],
    ['installed version code', { ...fixture, installed: { ...fixture.installed, versionCode: null } }, 'installed versionCode'],
    ['installed timestamps', { ...fixture, installed: { ...fixture.installed, firstInstallTime: null } }, 'installed package timestamps'],
    ['installed missing clean install window', { ...fixture, installed: { ...fixture.installed, cleanInstallWindowMs: undefined } }, 'clean install window is missing'],
    ['installed invalid clean install window', { ...fixture, installed: { ...fixture.installed, cleanInstallWindowMs: -1 } }, 'clean install window is invalid'],
    ['installed oversized clean install window', { ...fixture, installed: { ...fixture.installed, cleanInstallWindowMs: 60001 } }, 'clean install window 60001ms exceeds 60000ms'],
    ['installed clean install', { ...fixture, installed: { ...fixture.installed, cleanInstall: false, cleanInstallWindowMs: 120000 } }, 'clean install is not proven'],
    ['errors array', { ...fixture, errors: null }, 'does not record errors as an array'],
    ['non-string error', { ...fixture, errors: ['valid collector error', ''] }, 'records non-string errors'],
    ['scenarios array', { ...fixture, scenarios: null }, 'does not record scenarios as an array'],
    ['non-object scenario record', { ...fixture, scenarios: [...fixture.scenarios, null] }, 'scenario record 9 is not an object'],
    ['missing scenario id', { ...fixture, scenarios: [...fixture.scenarios, { ...fixture.scenarios[0], id: '' }] }, 'scenario record 9 does not record id'],
    ['unknown scenario id', { ...fixture, scenarios: [...fixture.scenarios, { ...fixture.scenarios[0], id: 'unexpected-provider-runtime-scenario' }] }, 'scenario record 9 id unexpected-provider-runtime-scenario is not required'],
    ['missing required scenario', { ...fixture, scenarios: fixture.scenarios.filter((scenario) => scenario.id !== 'android-back') }, 'Missing Provider Runtime Android scenario android-back'],
    ['duplicate required scenario', { ...fixture, scenarios: [...fixture.scenarios, fixture.scenarios.find((scenario) => scenario.id === 'android-back')] }, 'Provider Runtime Android scenario android-back is duplicated'],
    ['missing diagnostics', { ...fixture, diagnostics: null }, 'does not record diagnostics'],
    ['stale diagnostics', { ...fixture, diagnostics: { ...fixture.diagnostics, contractIssueCount: 99 } }, 'diagnostics do not match current contract state'],
  ]
  for (const [name, invalidResult, expectedIssue] of resultInvalidCases) {
    const issues = validateProviderRuntimeAndroidResult(invalidResult, {
      expectedPackageName: appPackageName,
      validatePath: false,
      sensitiveData: sensitiveDataOptions,
      scenario: { validatePath: false },
    })
    if (!issues.some((issue) => issue.includes(expectedIssue))) {
      throw new Error(`Provider Runtime Android self-test accepted invalid result ${name}: ${issues.join('; ')}`)
    }
  }
  const diagnosticsIssues = validateProviderRuntimeAndroidResult(fixture, {
    expectedPackageName: appPackageName,
    validatePath: false,
    sensitiveData: sensitiveDataOptions,
    scenario: { validatePath: false },
  })
  if (diagnosticsIssues.length) {
    throw new Error(`Provider Runtime Android self-test rejected diagnostics summary: ${diagnosticsIssues.join('; ')}`)
  }
  const finalizedMissingDevice = finalizeResult(createBaseResult({
    deviceSerial: null,
    apkPath: 'dist-apk/IsleMind-self-test.apk',
    packageName: appPackageName,
    expected: fixture.expected,
  }))
  if (finalizedMissingDevice.passed !== false) throw new Error('Provider Runtime Android self-test accepted a finalized result without deviceSerial.')
  if (!finalizedMissingDevice.contractIssues.some((issue) => issue.includes('does not record deviceSerial'))) {
    throw new Error(`Provider Runtime Android self-test did not record finalized contractIssues: ${finalizedMissingDevice.contractIssues.join('; ')}`)
  }
  if (finalizedMissingDevice.diagnostics?.failedScenarioCount !== requiredProviderRuntimeAndroidScenarios.length) {
    throw new Error('Provider Runtime Android self-test did not record finalized failed scenario count.')
  }
  if (finalizedMissingDevice.diagnostics?.contractIssueCount !== finalizedMissingDevice.contractIssues.length) {
    throw new Error('Provider Runtime Android self-test did not align diagnostics with contractIssues.')
  }
  const finalizedRunLog = formatRunLogLines(finalizedMissingDevice)
  if (!finalizedRunLog.includes('passed=false')) throw new Error('Provider Runtime Android self-test did not write final passed=false to run log lines.')
  if (!finalizedRunLog.some((line) => line.startsWith('contractIssue=') && line.includes('does not record deviceSerial'))) {
    throw new Error('Provider Runtime Android self-test did not write contract issues to run log lines.')
  }
  const finalizedPendingEvidenceScan = scanSensitiveEvidenceSources(new Map([
    [providerRuntimeAndroidResultRelativePath, formatResultJson(finalizedMissingDevice)],
    [providerRuntimeAndroidRunLogRelativePath, finalizedRunLog.join('\n')],
  ]))
  if (finalizedPendingEvidenceScan.fullCredentialLeak) {
    throw new Error(`Provider Runtime Android self-test leaked credentials in finalized pending evidence: ${finalizedPendingEvidenceScan.hits.map((hit) => hit.label).join(', ')}`)
  }
  if (!finalizedPendingEvidenceScan.scannedPaths.includes(providerRuntimeAndroidResultRelativePath)) {
    throw new Error('Provider Runtime Android self-test did not scan finalized result JSON body.')
  }
  if (!finalizedPendingEvidenceScan.scannedPaths.includes(providerRuntimeAndroidRunLogRelativePath)) {
    throw new Error('Provider Runtime Android self-test did not scan finalized run log lines.')
  }
  if (validateRepositoryEvidencePath('../outside-provider-runtime.log') !== 'outside the repository') {
    throw new Error('Provider Runtime Android self-test did not reject outside-repository sensitiveData paths.')
  }
  if (validateRepositoryEvidencePath('test-evidence/qa/provider-runtime-android/missing.log') !== 'missing') {
    throw new Error('Provider Runtime Android self-test did not reject missing sensitiveData paths.')
  }
  if (validateRepositoryEvidencePath(outputPath) !== 'not repository-relative') {
    throw new Error('Provider Runtime Android self-test did not reject absolute sensitiveData paths.')
  }
  if (validateRepositoryEvidencePath(`./${providerRuntimeAndroidRunLogRelativePath}`) !== 'not normalized repository-relative') {
    throw new Error('Provider Runtime Android self-test did not reject non-normalized sensitiveData paths.')
  }
  const leakedFixture = {
    ...fixture,
    sensitiveData: { fullCredentialLeak: true, scannedFiles: 1, hits: [{ file: 'test-evidence/qa/provider-runtime-android/leak.log' }] },
  }
  const leakLine = formatRunLogLines(leakedFixture).find((line) => line.startsWith('fullCredentialLeak='))
  if (leakLine !== 'fullCredentialLeak=true') throw new Error(`Provider Runtime Android self-test expected final leak state in run log, got ${leakLine ?? 'missing'}.`)
  const bearerSecret = `Bearer ${'Abcd'.repeat(10)}`
  const redactedLines = formatRunLogLines({
    ...fixture,
    errors: [`Request failed with ${bearerSecret}`],
    scenarios: fixture.scenarios.map((scenario, index) => index === 0
      ? { ...scenario, actualState: `Transport failed with ${bearerSecret}` }
      : scenario),
  }).join('\n')
  if (redactedLines.includes(bearerSecret)) throw new Error('Provider Runtime Android self-test leaked a bearer token in run log lines.')
  if (!redactedLines.includes('[redacted:bearer-token]')) throw new Error('Provider Runtime Android self-test did not mark bearer token redaction.')
  const plannedSecret = `sk-${'test'.repeat(8)}`
  const plannedEvidenceScan = scanSensitiveEvidenceSources(new Map([
    [providerRuntimeAndroidResultRelativePath, [
      JSON.stringify({ error: plannedSecret }),
      `mimo=tp-${'test'.repeat(8)}`,
      `github=ghp_${'a'.repeat(24)}`,
      `google=AIza${'a'.repeat(24)}`,
      `oauth=ya29.${'a'.repeat(24)}`,
    ].join('\n')],
    [providerRuntimeAndroidRunLogRelativePath, [
      `error=Bearer ${'Abcd'.repeat(10)}`,
      'refresh_token=Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH',
    ].join('\n')],
  ]))
  if (!plannedEvidenceScan.fullCredentialLeak) throw new Error('Provider Runtime Android self-test expected planned output evidence scan to detect credentials.')
  if (!plannedEvidenceScan.hits.some((hit) => hit.file.endsWith('provider-runtime-android-results.json'))) throw new Error('Provider Runtime Android self-test did not scan planned result JSON.')
  if (!plannedEvidenceScan.hits.some((hit) => hit.file.endsWith('provider-runtime-android.log'))) throw new Error('Provider Runtime Android self-test did not scan planned run log.')
  if (!plannedEvidenceScan.scannedPaths.includes(providerRuntimeAndroidResultRelativePath)) throw new Error('Provider Runtime Android self-test did not record planned result JSON scan path.')
  if (!plannedEvidenceScan.scannedPaths.includes(providerRuntimeAndroidRunLogRelativePath)) throw new Error('Provider Runtime Android self-test did not record planned run log scan path.')
  const detectedLabels = new Set(plannedEvidenceScan.hits.map((hit) => hit.label))
  const missingLabels = sensitiveEvidencePatterns.map((item) => item.label).filter((label) => !detectedLabels.has(label))
  if (missingLabels.length) throw new Error(`Provider Runtime Android self-test missed sensitive evidence labels: ${missingLabels.join(', ')}`)
  const rawTextEvidence = `text="token=Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH" log="Bearer ${'Abcd'.repeat(10)}"`
  const sanitizedTextEvidence = sanitizeEvidenceText(rawTextEvidence)
  if (sanitizedTextEvidence.includes('Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH')) throw new Error('Provider Runtime Android self-test leaked a credential assignment in persisted text evidence.')
  if (sanitizedTextEvidence.includes(`Bearer ${'Abcd'.repeat(10)}`)) throw new Error('Provider Runtime Android self-test leaked a bearer token in persisted text evidence.')
  console.log(`Provider Runtime Android self-test passed (${requiredProviderRuntimeAndroidScenarios.length} required scenarios).`)
}

function validateResultShape(result, options = {}) {
  return validateProviderRuntimeAndroidResult(result, {
    expectedPackageName: appPackageName,
    validatePath: false,
    sensitiveData: options.sensitiveData,
    scenario: { validatePath: false },
  })
}

function captureKeyboardState(device, name) {
  const evidencePath = path.join(smokeDir, `${name}.json`)
  const inputMethodDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'input_method']) ?? ''
  const windowDump = runCommand('adb', ['-s', device, 'shell', 'dumpsys', 'window']) ?? ''
  const signals = {
    inputShown: readDumpBoolean(inputMethodDump, ['mInputShown', 'inputShown']),
    inputViewShown: readDumpBoolean(inputMethodDump, ['mIsInputViewShown', 'isInputViewShown', 'mInputViewShown']),
    servedEditText: /m(?:Next)?ServedView=.*(?:EditText|ReactEditText)/i.test(inputMethodDump),
    currentFocusEditText: /mCurrentFocus=.*(?:EditText|ReactEditText)/i.test(windowDump),
    imeWindowVisible: readDumpBoolean(windowDump, ['mInputMethodWindowVisible', 'inputMethodWindowVisible']),
  }
  const state = {
    imeVisible: [signals.inputShown, signals.inputViewShown, signals.imeWindowVisible].some((value) => value === true),
    editableFocused: signals.servedEditText || signals.currentFocusEditText,
    evidence: relative(evidencePath),
    signals,
  }
  fs.writeFileSync(evidencePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return state
}

function emptyKeyboardState() {
  return {
    imeVisible: false,
    editableFocused: false,
    evidence: null,
    signals: {},
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else files.push(full)
  }
  return files
}

function parseBounds(bounds) {
  const match = String(bounds ?? '').match(/\[(\-?\d+),(\-?\d+)\]\[(\-?\d+),(\-?\d+)\]/)
  if (!match) return null
  const [, left, top, right, bottom] = match.map(Number)
  return { left, top, right, bottom }
}

function boundsContains(outer, inner) {
  return outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function extractVisibleText(uiaText) {
  const values = []
  for (const node of parseNodes(uiaText)) {
    if (node.text) values.push(node.text)
    if (node.contentDesc) values.push(node.contentDesc)
  }
  return [...new Set(values)]
}

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function matchFirst(value, pattern) {
  const match = String(value ?? '').match(pattern)
  return match?.[1]?.trim() ?? null
}

function readDumpBoolean(text, keys) {
  for (const key of keys) {
    const escaped = escapeRegExp(key)
    const match = String(text ?? '').match(new RegExp(`\\b${escaped}\\s*[=:]\\s*(true|false)\\b`, 'i'))
    if (match) return match[1].toLowerCase() === 'true'
  }
  return null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function sanitizePersistedTextEvidence(file) {
  const original = fs.readFileSync(file, 'utf8')
  const sanitized = sanitizeEvidenceText(original)
  if (sanitized !== original) fs.writeFileSync(file, sanitized, 'utf8')
  return sanitized
}

function sanitizeEvidenceText(value) {
  return redactSensitiveEvidenceText(value)
}

function readExpectedAppConfig() {
  const packageJson = readJsonFile(path.join(root, 'package.json'))
  const appJson = readJsonFile(path.join(root, 'app.json'))
  const expo = appJson?.expo ?? {}
  return {
    packageVersion: packageJson?.version ?? null,
    expoVersion: expo.version ?? null,
    androidPackage: expo.android?.package ?? null,
    androidVersionCode: expo.android?.versionCode ?? null,
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function resolveApkPath(expected = readExpectedAppConfig()) {
  if (process.env.QA_APK_PATH) return path.resolve(root, process.env.QA_APK_PATH)
  const version = expected.packageVersion || expected.expoVersion || 'missing-version'
  const arch = process.env.QA_APK_ARCH || defaultReleaseSmokeArch
  const variant = process.env.QA_APK_VARIANT || defaultReleaseSmokeVariant
  return resolveApkArtifactPath(root, { version, arch, variant })
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

main()
