const fs = require('node:fs')
const crypto = require('node:crypto')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { resolveApkArtifactPath, defaultReleaseSmokeVariant } = require('./release-artifact-contract')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')
const {
  createLocalModelDownloadResultFixture,
  validateLocalModelDownloadResult,
} = require('./local-model-download-result-contract')
const {
  createLocalModelCorruptMirrorRowsFixture,
  validateLocalModelCorruptMirrorRows,
} = require('./local-model-corrupt-mirror-log-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const smokeDir = path.join(evidenceDir, 'local-model-android')
const appPackageName = defaultReleaseAppPackageName
const requestedDevice = String(process.env.QA_DEVICE_SERIAL ?? '').trim()
const modelId = 'all-MiniLM-L6-v2'
const ragSectionLabels = ['RAG retrieval mode', 'RAG 检索模式']
const localModelSectionLabels = ['Local models', '本地模型']
const localModelControlLabels = ['Download mirror', '下载镜像源']
const localModelDownloadedLabels = ['模型已下载', 'Downloaded', 'Model downloaded']
const modelRoot = path.join(root, 'assets', 'models', modelId)
const rawDownloadResultPath = path.join(evidenceDir, 'raw-settings-context-local-model-download-emulator-results.json')
const rawCorruptLogPath = path.join(evidenceDir, 'raw-local-model-corrupt-mirror-requests.jsonl')
const outputPath = path.join(evidenceDir, 'local-model-android-evidence-results.json')

if (!isMainThread) {
  runMirrorWorker()
} else if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack ?? error?.message ?? String(error))
    process.exitCode = 1
  })
}

async function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
    return
  }

  if (!requestedDevice) {
    throw new Error('QA_DEVICE_SERIAL is required and must name an Android emulator for local-model evidence.')
  }
  const device = resolveDevice(requestedDevice)
  if (!device) {
    throw new Error(`QA_DEVICE_SERIAL=${requestedDevice} is not a connected Android emulator.`)
  }

  fs.mkdirSync(smokeDir, { recursive: true })
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(rawCorruptLogPath, '', 'utf8')

  const result = {
    generatedAt: new Date().toISOString(),
    device,
    apk: null,
    success: null,
    corrupt: null,
    rawDownloadResult: relative(rawDownloadResultPath),
    rawCorruptLog: relative(rawCorruptLogPath),
    errors: [],
  }

  result.apk = cleanInstallCurrentApk(device)

  result.corrupt = await runScenario(device, {
    mode: 'corrupt',
    capturePrefix: 'local-model-corrupt',
    rawLogPath: rawCorruptLogPath,
    cleanInstallBeforeRun: false,
  })

  result.apk = cleanInstallCurrentApk(device)
  result.success = await runScenario(device, {
    mode: 'success',
    capturePrefix: 'local-model',
    rawLogPath: path.join(smokeDir, 'raw-local-model-download-mirror-requests.jsonl'),
    cleanInstallBeforeRun: false,
  })

  const downloadResult = buildDownloadResult(result.success, result.apk, device)
  const corruptRows = readJsonl(rawCorruptLogPath)
  const issues = collectEvidenceIssues({
    downloadResult,
    corruptRows,
    success: result.success,
    corrupt: result.corrupt,
  })
  result.errors.push(...issues)
  fs.writeFileSync(rawDownloadResultPath, `${JSON.stringify(downloadResult, null, 2)}\n`, 'utf8')
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

  const passed = issues.length === 0
  console.log(`${passed ? 'Local-model Android evidence passed' : 'Local-model Android evidence failed'}: ${relative(outputPath)}, ${relative(rawDownloadResultPath)}, ${relative(rawCorruptLogPath)}`)
  for (const issue of issues) console.error(issue)
  if (!passed) process.exitCode = 1
}

function runSelfTest() {
  const serials = ['dadaa813', 'emulator-5554']
  const isFixtureEmulator = (serial) => serial.startsWith('emulator-')
  if (selectEmulatorDevice(serials, 'dadaa813', isFixtureEmulator) !== null) {
    throw new Error('Local-model collector self-test selected a physical device.')
  }
  if (selectEmulatorDevice(['dadaa813'], '', isFixtureEmulator) !== null) {
    throw new Error('Local-model collector self-test allowed implicit physical-device fallback.')
  }
  if (selectEmulatorDevice(serials, 'emulator-5554', isFixtureEmulator) !== 'emulator-5554') {
    throw new Error('Local-model collector self-test did not select the requested emulator.')
  }
  if (buildDeviceMirrorUrl(54321) !== 'http://127.0.0.1:54321') {
    throw new Error('Local-model collector self-test did not isolate the mirror through device loopback.')
  }
  if (!hasAnyText('<node text="Model downloaded" />', localModelDownloadedLabels)) {
    throw new Error('Local-model collector self-test did not recognize the English success dialog.')
  }

  const scrollableNode = '<node text="" class="android.widget.ScrollView" scrollable="true" bounds="[0,66][1080,2334]" />'
  const collapsedContext = `<hierarchy>${scrollableNode}<node text="RAG retrieval mode" class="android.widget.Button" clickable="true" enabled="true" bounds="[33,682][1047,798]" /></hierarchy>`
  const expandedRag = `<hierarchy>${scrollableNode}<node text="Local models" class="android.widget.Button" clickable="true" enabled="true" bounds="[33,1620][1047,1740]" /></hierarchy>`
  const expandedLocalModels = `<hierarchy>${scrollableNode}<node text="Download mirror" class="android.widget.TextView" enabled="true" bounds="[33,980][1047,1030]" /><node text="For example https://hf-mirror.com" hint="For example https://hf-mirror.com" class="android.widget.EditText" enabled="true" bounds="[33,1040][1047,1160]" /></hierarchy>`
  const enteredMirrorUrl = 'http://10.0.2.2:54321'
  const enteredLocalModels = `<hierarchy>${scrollableNode}<node text="Download mirror" class="android.widget.TextView" enabled="true" bounds="[33,980][1047,1030]" /><node text="${enteredMirrorUrl}" hint="For example https://hf-mirror.com" class="android.widget.EditText" enabled="true" bounds="[33,1040][1047,1160]" /></hierarchy>`
  const navigationState = { ragOpened: false, localModelsOpened: false }
  if (planLocalModelSettingsNavigation(collapsedContext, navigationState) !== 'tap-rag') {
    throw new Error('Local-model collector self-test did not open the RAG disclosure first.')
  }
  navigationState.ragOpened = true
  if (planLocalModelSettingsNavigation(expandedRag, navigationState) !== 'tap-local-models') {
    throw new Error('Local-model collector self-test did not open the local-model disclosure second.')
  }
  navigationState.localModelsOpened = true
  if (planLocalModelSettingsNavigation(expandedLocalModels, navigationState) !== 'ready') {
    throw new Error('Local-model collector self-test did not recognize the expanded mirror controls.')
  }
  if (hasEditableValue(expandedLocalModels, enteredMirrorUrl) || !hasEditableValue(enteredLocalModels, enteredMirrorUrl)) {
    throw new Error('Local-model collector self-test did not distinguish a placeholder from an entered mirror URL.')
  }
  const swipe = resolveSwipeGesture(collapsedContext)
  if (swipe.x !== 540 || swipe.startY <= swipe.endY || swipe.startY >= 2334 || swipe.endY <= 66) {
    throw new Error('Local-model collector self-test did not derive a bounded emulator swipe gesture.')
  }

  const issues = collectEvidenceIssues({
    downloadResult: createLocalModelDownloadResultFixture(),
    corruptRows: createLocalModelCorruptMirrorRowsFixture(),
    success: { downloaded: true, finalRowEnabled: true, errors: [] },
    corrupt: { errors: [] },
  })
  if (issues.length) {
    throw new Error(`Local-model collector self-test rejected valid fixture evidence: ${issues.join(', ')}`)
  }
  console.log('Local-model Android evidence collector self-test passed.')
}

function collectEvidenceIssues(input) {
  const issues = [
    ...validateLocalModelDownloadResult(input.downloadResult),
    ...validateLocalModelCorruptMirrorRows(input.corruptRows),
  ]
  if (input.success?.downloaded !== true) issues.push('Successful local-model scenario did not prove a completed download.')
  if (input.success?.finalRowEnabled !== true) issues.push('Successful local-model scenario did not prove the final enabled row.')
  for (const error of input.success?.errors ?? []) issues.push(`Successful local-model scenario error: ${error}`)
  for (const error of input.corrupt?.errors ?? []) issues.push(`Corrupt local-model scenario error: ${error}`)
  return issues
}

async function runScenario(device, options) {
  const rawLogPath = options.rawLogPath
  fs.writeFileSync(rawLogPath, '', 'utf8')
  const mirror = await startMirror(options.mode, rawLogPath)
  let reversedPort = null
  const networkState = readNetworkState(device)
  const scenario = {
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    mirror: null,
    networkState,
    captures: {},
    observations: [],
    downloaded: false,
    finalRowEnabled: false,
    errors: [],
  }

  try {
    const mirrorUrl = buildDeviceMirrorUrl(mirror.port)
    scenario.mirror = {
      emulatorUrl: mirrorUrl,
      hostPort: mirror.port,
      mode: options.mode,
    }
    const reverseResult = runCommand('adb', ['-s', device, 'reverse', `tcp:${mirror.port}`, `tcp:${mirror.port}`])
    if (reverseResult === null) throw new Error('Could not establish the local-model ADB reverse mirror lease.')
    reversedPort = mirror.port
    if (process.env.QA_LOCAL_MODEL_KEEP_NETWORK !== '1') disableExternalNetwork(device)

    forceStop(device)
    const context = waitForSettingsContext(device, `${options.capturePrefix}-context-start`)
    scenario.captures.contextStartPng = context.png
    scenario.captures.contextStartUia = context.uia

    const mirrorSet = setMirrorUrl(device, mirrorUrl, `${options.capturePrefix}-mirror`)
    scenario.captures.mirrorSetPng = mirrorSet.capture.png
    scenario.captures.mirrorSetUia = mirrorSet.capture.uia
    scenario.captures.mirrorTypedPng = mirrorSet.typedCapture?.png ?? null
    scenario.captures.mirrorTypedUia = mirrorSet.typedCapture?.uia ?? null
    scenario.captures.mirrorReloadedContextPng = mirrorSet.reloadedContext?.png ?? null
    scenario.captures.mirrorReloadedContextUia = mirrorSet.reloadedContext?.uia ?? null
    scenario.captures.mirrorReloadedSettingsPng = mirrorSet.capture.png
    scenario.captures.mirrorReloadedSettingsUia = mirrorSet.capture.uia
    scenario.mirror.inputTapped = mirrorSet.tapped

    const confirm = openDownloadConfirm(device, `${options.capturePrefix}-download`)
    scenario.observations.push(observation('confirm', confirm))
    scenario.captures.confirmPng = confirm.png
    scenario.captures.confirmUia = confirm.uia
    if (!tapText(device, confirm.uiaText, ['下载', 'Download'])) {
      throw new Error('Could not confirm local model download.')
    }

    const afterConfirm = waitForAnyText(device, ['准备下载', '下载中', '切换镜像重试', 'preparing', 'downloading', 'retrying', modelId], `${options.capturePrefix}-download-start`, 8, 700)
    scenario.observations.push(observation('start', afterConfirm))
    scenario.captures.downloadStartPng = afterConfirm.png
    scenario.captures.downloadStartUia = afterConfirm.uia

    if (options.mode === 'success') {
      const progress = waitForAnyText(device, ['下载中', 'model_quantized.onnx', 'onnx/model_quantized.onnx', '%'], 'local-model-download-after', 16, 550)
      scenario.observations.push(observation('download-progress', progress))
      scenario.captures.downloadProgressPng = progress.png
      scenario.captures.downloadProgressUia = progress.uia

      const verify = waitForAnyText(device, ['校验中', '写入完成', 'finalizing', 'verifying', '模型已下载'], `${options.capturePrefix}-verify`, 22, 650)
      scenario.observations.push(observation('verify', verify))
      scenario.captures.verifyPng = verify.png
      scenario.captures.verifyUia = verify.uia

      const successDialog = waitForAnyText(device, localModelDownloadedLabels, `${options.capturePrefix}-success-dialog`, 60, 1000)
      scenario.observations.push(observation('success-dialog', successDialog))
      scenario.captures.successDialogPng = successDialog.png
      scenario.captures.successDialogUia = successDialog.uia
      tapText(device, successDialog.uiaText, ['知道了', 'OK', 'Close', '关闭'])
      sleep(800)

      const finalRow = waitForModelStatus(device, ['已启用', 'Enabled'], 'local-model-downloaded-row', 20, 900)
      scenario.observations.push(observation('final-row', finalRow))
      scenario.captures.finalRowPng = finalRow.png
      scenario.captures.finalRowUia = finalRow.uia
      scenario.downloaded = hasAnyText(successDialog.uiaText, localModelDownloadedLabels) || hasModelStatus(finalRow.uiaText, ['已启用', 'Enabled'])
      scenario.finalRowEnabled = hasModelStatus(finalRow.uiaText, ['已启用', 'Enabled'])
    } else {
      const failed = waitForAnyText(device, ['模型下载失败', '失败详情', '校验失败', 'download failed', 'corrupt mirror fixture'], 'local-model-corrupt-download-after', 24, 800)
      scenario.observations.push(observation('failure-dialog', failed))
      scenario.captures.failureDialogPng = failed.png
      scenario.captures.failureDialogUia = failed.uia
      tapText(device, failed.uiaText, ['知道了', 'OK', 'Close', '关闭'])
      sleep(900)
      const row = waitForAnyText(device, ['校验失败', '未下载', modelId], 'local-model-corrupt-row-after-dismiss', 10, 700)
      scenario.observations.push(observation('failure-row', row))
      scenario.captures.failureRowPng = row.png
      scenario.captures.failureRowUia = row.uia
      scenario.finalRowEnabled = false
    }
  } catch (error) {
    scenario.errors.push(error?.message ?? String(error))
  } finally {
    restoreNetworkState(device, networkState)
    if (reversedPort) runCommand('adb', ['-s', device, 'reverse', '--remove', `tcp:${reversedPort}`])
    mirror.instance.terminate()
  }

  return scenario
}

function buildDownloadResult(success, apk, device) {
  return {
    schema: 'islemind.local-model-download-result.v1',
    generatedAt: new Date().toISOString(),
    startedFromFreshInstall: true,
    device: {
      serial: device,
      emulator: true,
      abi: apk?.deviceAbi ?? '',
    },
    apk: {
      path: apk?.path ?? '',
      sha256: apk?.sha256 ?? '',
      arch: apk?.arch ?? '',
      variant: apk?.variant ?? '',
    },
    mirror: {
      emulatorUrl: success?.mirror?.emulatorUrl ?? '',
      model: modelId,
      mode: success?.mirror?.mode ?? 'success',
    },
    observations: normalizeRequiredDownloadObservations(success?.observations ?? []),
  }
}

function normalizeRequiredDownloadObservations(observations) {
  const byStep = new Map(observations.map((item) => [item.step, item]))
  return ['confirm', 'start', 'download-progress', 'verify', 'success-dialog', 'final-row']
    .map((step) => byStep.get(step) ?? { step, visibleText: [] })
}

function observation(step, capture) {
  return {
    step,
    png: capture.png,
    uia: capture.uia,
    visibleText: extractVisibleText(capture.uiaText).slice(0, 120),
  }
}

function waitForSettingsContext(device, captureName) {
  openUrl(device, 'islemind://settings/context')
  sleep(1900)
  return waitForAnyText(device, ['上下文', 'Context', '本地模型', 'Local model'], captureName, 8, 750)
}

function setMirrorUrl(device, mirrorUrl, capturePrefix) {
  let capture = openLocalModelSettings(device, `${capturePrefix}-settings`)
  for (let index = 0; index < 14; index += 1) {
    const tapped = tapEditable(device, capture.uiaText, ['下载镜像源', 'Download mirror', 'Mirror', 'https://hf-mirror.com'])
    if (tapped) {
      sleep(1100)
      const entered = replaceFocusedEditableText(device, mirrorUrl, `${capturePrefix}-typed`)
      if (!entered) throw new Error('Could not enter the local-model mirror URL.')
      runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
      sleep(800)
      const enteredCapture = captureStep(device, `${capturePrefix}-entered`)
      if (!hasEditableValue(enteredCapture.uiaText, mirrorUrl)) {
        throw new Error('Local-model mirror URL did not persist after keyboard dismissal.')
      }
      forceStop(device)
      sleep(900)
      const reloadedContext = waitForSettingsContext(device, `${capturePrefix}-reloaded-context`)
      const reloadedSettings = openLocalModelSettings(device, `${capturePrefix}-reloaded-settings`)
      if (!hasEditableValue(reloadedSettings.uiaText, mirrorUrl)) {
        throw new Error('Local-model mirror URL did not survive app restart.')
      }
      return {
        tapped: true,
        capture: reloadedSettings,
        typedCapture: enteredCapture,
        reloadedContext,
      }
    }
    swipeUp(device, capture.uiaText)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index + 1}`)
  }
  return { tapped: false, capture }
}

function replaceFocusedEditableText(device, value, capturePrefix) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    runCommand('adb', ['-s', device, 'shell', 'input', 'keycombination', 'KEYCODE_CTRL_LEFT', 'KEYCODE_A'])
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', 'KEYCODE_DEL'])
    sleep(250)
    inputText(device, value)
    sleep(1100)
    const capture = captureStep(device, `${capturePrefix}-${attempt + 1}`)
    if (hasEditableValue(capture.uiaText, value)) return true
    sleep(650)
  }
  return false
}

function hasEditableValue(uiaText, value) {
  return parseNodes(uiaText).some((node) => node.className.includes('EditText') && node.text === value)
}

function openLocalModelSettings(device, capturePrefix) {
  const state = { ragOpened: false, localModelsOpened: false }
  let capture = captureStep(device, `${capturePrefix}-0`)
  for (let index = 0; index < 24; index += 1) {
    const action = planLocalModelSettingsNavigation(capture.uiaText, state)
    if (action === 'ready') return capture
    if (action === 'tap-rag') {
      if (!tapText(device, capture.uiaText, ragSectionLabels)) {
        throw new Error('Could not open RAG settings for local-model evidence.')
      }
      state.ragOpened = true
    } else if (action === 'tap-local-models') {
      if (!tapText(device, capture.uiaText, localModelSectionLabels)) {
        throw new Error('Could not open local-model settings for evidence.')
      }
      state.localModelsOpened = true
    } else {
      swipeUp(device, capture.uiaText)
    }
    sleep(550)
    capture = captureStep(device, `${capturePrefix}-${index + 1}`)
  }
  throw new Error('Could not reach local-model mirror controls.')
}

function planLocalModelSettingsNavigation(uiaText, state) {
  if (hasAnyText(uiaText, localModelControlLabels)) return 'ready'
  if (!state.ragOpened && hasAnyText(uiaText, ragSectionLabels)) return 'tap-rag'
  if (!state.localModelsOpened && hasAnyText(uiaText, localModelSectionLabels)) return 'tap-local-models'
  return 'swipe'
}

function openDownloadConfirm(device, capturePrefix) {
  let capture = captureStep(device, `${capturePrefix}-0`)
  for (let index = 0; index < 18; index += 1) {
    if (hasAnyText(capture.uiaText, [modelId]) && tapText(device, capture.uiaText, ['下载', 'Download'])) {
      sleep(900)
      return captureStep(device, `${capturePrefix}-confirm`)
    }
    swipeUp(device, capture.uiaText)
    sleep(450)
    capture = captureStep(device, `${capturePrefix}-${index + 1}`)
  }
  throw new Error('Could not open local model download confirmation.')
}

function waitForAnyText(device, labels, captureName, maxAttempts, intervalMs) {
  let capture = captureStep(device, captureName)
  if (hasAnyText(capture.uiaText, labels)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(intervalMs)
    capture = captureStep(device, captureName)
    if (hasAnyText(capture.uiaText, labels)) return capture
  }
  return capture
}

function waitForModelStatus(device, labels, captureName, maxAttempts, intervalMs) {
  let capture = captureStep(device, captureName)
  if (hasModelStatus(capture.uiaText, labels)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(intervalMs)
    capture = captureStep(device, captureName)
    if (hasModelStatus(capture.uiaText, labels)) return capture
  }
  return capture
}

function hasModelStatus(uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const modelNode = nodes.find((node) => node.text === modelId || node.contentDesc === modelId)
  const modelBounds = modelNode ? parseBounds(modelNode.bounds) : null
  if (!modelBounds) return false
  return nodes
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .some(({ node, bounds }) => {
      if (!bounds || !labels.some((label) => node.text === label || node.contentDesc === label)) return false
      return bounds.top >= modelBounds.top - 80 && bounds.top <= modelBounds.top + 420
    })
}

function startMirror(mode, logPath) {
  return new Promise((resolve, reject) => {
    const instance = new Worker(__filename, {
      workerData: { mode, logPath, modelRoot },
    })
    const timeout = setTimeout(() => {
      instance.terminate()
      reject(new Error(`Timed out starting ${mode} local-model mirror.`))
    }, 10000)
    instance.once('message', (message) => {
      clearTimeout(timeout)
      if (message?.type === 'ready') {
        resolve({ instance, port: message.port })
      } else {
        reject(new Error(message?.error ?? `Failed to start ${mode} local-model mirror.`))
      }
    })
    instance.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

function runMirrorWorker() {
  const server = http.createServer((request, response) => {
    handleMirrorRequest(request, response)
  })
  server.listen(0, '127.0.0.1', () => {
    parentPort.postMessage({ type: 'ready', port: server.address().port })
  })
}

function handleMirrorRequest(request, response) {
  const receivedAt = new Date().toISOString()
  const relativePath = requestRelativePath(request.url)
  let status = 200
  let error = null
  try {
    if (!relativePath) {
      status = 404
      error = 'unrecognized local-model mirror path'
      response.writeHead(status)
      response.end(error)
      return
    }
    if (workerData.mode === 'corrupt' && relativePath === 'onnx/model_quantized.onnx') {
      status = 500
      error = 'corrupt mirror fixture'
      response.writeHead(status, { 'Content-Type': 'text/plain' })
      response.end(error)
      return
    }
    const file = path.join(workerData.modelRoot, relativePath)
    if (!file.startsWith(workerData.modelRoot) || !fs.existsSync(file)) {
      status = 404
      error = 'missing local-model mirror fixture'
      response.writeHead(status)
      response.end(error)
      return
    }
    const stat = fs.statSync(file)
    response.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
    })
    if (workerData.mode === 'success' && relativePath === 'onnx/model_quantized.onnx') {
      streamFileSlowly(file, response)
    } else {
      fs.createReadStream(file).pipe(response)
    }
  } catch (caught) {
    status = 500
    error = caught?.message ?? String(caught)
    response.writeHead(status)
    response.end(error)
  } finally {
    fs.appendFileSync(workerData.logPath, `${JSON.stringify({
      timestamp: receivedAt,
      method: request.method,
      url: request.url,
      relative: relativePath,
      status,
      error,
    })}\n`, 'utf8')
  }
}

function streamFileSlowly(file, response) {
  const stream = fs.createReadStream(file, { highWaterMark: 128 * 1024 })
  stream.on('data', (chunk) => {
    stream.pause()
    response.write(chunk, () => setTimeout(() => stream.resume(), 28))
  })
  stream.on('end', () => response.end())
  stream.on('error', (error) => {
    response.destroy(error)
  })
}

function requestRelativePath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://local-model-mirror').pathname)
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  const marker = '/resolve/main/'
  const markerIndex = pathname.indexOf(marker)
  if (markerIndex >= 0) return pathname.slice(markerIndex + marker.length)
  const modelIndex = pathname.indexOf(`${modelId}/`)
  if (modelIndex >= 0) return pathname.slice(modelIndex + modelId.length + 1)
  return pathname
}

function cleanInstallCurrentApk(device) {
  const descriptor = resolveCurrentApkDescriptor(device)
  const apkPath = descriptor.path
  runCommand('adb', ['-s', device, 'uninstall', appPackageName], { timeout: 120000 })
  const installOutput = execFileSync('adb', ['-s', device, 'install', apkPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim()
  return {
    path: relative(apkPath),
    sha256: sha256File(apkPath),
    arch: descriptor.arch,
    variant: descriptor.variant,
    deviceAbi: descriptor.deviceAbi,
    installOutput,
    startedFromFreshInstall: true,
  }
}

function resolveCurrentApkDescriptor(device) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const deviceAbi = readDeviceAbi(device) || ''
  const arch = process.env.QA_APK_ARCH || deviceAbi || 'arm64-v8a'
  const variant = process.env.QA_APK_VARIANT || defaultReleaseSmokeVariant
  const resolvedPath = process.env.QA_APK_PATH
    ? path.resolve(root, process.env.QA_APK_PATH)
    : resolveApkArtifactPath(root, { version: packageJson.version, arch, variant })
  return { path: resolvedPath, arch, variant, deviceAbi }
}

function readDeviceAbi(device) {
  return runCommand('adb', ['-s', device, 'shell', 'getprop', 'ro.product.cpu.abi'])?.trim() ?? null
}

function buildDeviceMirrorUrl(port) {
  return `http://127.0.0.1:${port}`
}

function isEmulatorDevice(device) {
  if (String(device).startsWith('emulator-')) return true
  return (runCommand('adb', ['-s', device, 'shell', 'getprop', 'ro.kernel.qemu']) ?? '').trim() === '1'
}

function readNetworkState(device) {
  return {
    wifiEnabled: /enabled/i.test(runCommand('adb', ['-s', device, 'shell', 'cmd', 'wifi', 'status']) ?? ''),
    dataEnabled: (runCommand('adb', ['-s', device, 'shell', 'settings', 'get', 'global', 'mobile_data']) ?? '').trim() === '1',
  }
}

function disableExternalNetwork(device) {
  runCommand('adb', ['-s', device, 'shell', 'svc', 'wifi', 'disable'])
  runCommand('adb', ['-s', device, 'shell', 'svc', 'data', 'disable'])
  sleep(1200)
}

function restoreNetworkState(device, state) {
  if (!state) return
  runCommand('adb', ['-s', device, 'shell', 'svc', 'wifi', state.wifiEnabled ? 'enable' : 'disable'])
  runCommand('adb', ['-s', device, 'shell', 'svc', 'data', state.dataEnabled ? 'enable' : 'disable'])
}

function resolveDevice(requested) {
  const output = runCommand('adb', ['devices']) ?? ''
  const serials = output
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  return selectEmulatorDevice(serials, requested, isEmulatorDevice)
}

function selectEmulatorDevice(serials, requested, emulatorPredicate) {
  const normalizedRequested = String(requested ?? '').trim()
  if (!normalizedRequested || !serials.includes(normalizedRequested)) return null
  return emulatorPredicate(normalizedRequested) ? normalizedRequested : null
}

function sha256File(file) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(file))
  return hash.digest('hex')
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
      focused: matchFirst(tag, /focused="([^"]+)"/) === 'true',
      clickable: matchFirst(tag, /clickable="([^"]+)"/) === 'true',
      scrollable: matchFirst(tag, /scrollable="([^"]+)"/) === 'true',
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

function resolveSwipeGesture(uiaText) {
  const scrollableBounds = parseNodes(uiaText)
    .filter((node) => node.scrollable)
    .map((node) => parseBounds(node.bounds))
    .filter(Boolean)
    .sort((left, right) => boundsArea(right) - boundsArea(left))[0]
  if (!scrollableBounds) return { x: 540, startY: 1780, endY: 620 }
  const height = scrollableBounds.bottom - scrollableBounds.top
  const verticalInset = Math.max(96, Math.round(height * 0.16))
  return {
    x: Math.round((scrollableBounds.left + scrollableBounds.right) / 2),
    startY: scrollableBounds.bottom - verticalInset,
    endY: scrollableBounds.top + verticalInset,
  }
}

function swipeUp(device, uiaText) {
  const gesture = resolveSwipeGesture(uiaText)
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', String(gesture.x), String(gesture.startY), String(gesture.x), String(gesture.endY), '430'])
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
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url], { timeout: 30000 })
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function textMatches(node, label) {
  return node.text.includes(label) || node.contentDesc.includes(label)
}

function extractVisibleText(uiaText) {
  const values = []
  for (const match of String(uiaText ?? '').matchAll(/\b(?:text|content-desc)="([^"]+)"/g)) {
    const value = decodeXml(match[1]).trim()
    if (value && !values.includes(value)) values.push(value)
  }
  return values
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function runCommand(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 20000,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
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

module.exports = {
  buildDownloadResult,
  collectEvidenceIssues,
  resolveCurrentApkDescriptor,
  selectEmulatorDevice,
}
