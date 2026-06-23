const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const smokeDir = path.join(evidenceDir, 'android-workflow-chat-routing')
const outputPath = path.join(evidenceDir, 'android-workflow-chat-routing-results.json')
const requestLogPath = path.join(evidenceDir, 'android-workflow-chat-routing-mock-requests.jsonl')
const fixturePath = path.join(smokeDir, 'islemind-android-workflow-chat-routing.json')
const runtimeLogPath = path.join(smokeDir, 'islemind-runtime.jsonl')
const topActivityPath = path.join(smokeDir, 'top-activity.txt')
const remoteFixturePath = '/sdcard/Download/islemind-android-workflow-chat-routing.json'
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'dadaa813'

const providerId = 'qa-android-workflow-provider'
const providerName = 'QA Android Workflow Provider'
const modelId = 'qa-android-workflow-model'
const fakeApiKey = 'sk-qa-android-workflow'
const mode = (process.env.QA_ANDROID_WORKFLOW_MODE || 'notification-settings').trim()
const conversationId = `qa-android-workflow-chat-routing-${safeModeId(mode)}`
const prompt = process.env.QA_WORKFLOW_PROMPT || defaultPromptForMode(mode)
const workflowId = workflowIdForMode(mode)
const workflowCaptureLabels = workflowLabelsForMode(mode)
const workflowRouteChecks = routeChecksForMode(mode)
const workflowRouteOutcome = routeOutcomeForMode(mode)

if (!isMainThread) {
  runMockProviderWorker()
} else {
  main()
}

function main() {
  fs.mkdirSync(smokeDir, { recursive: true })
  fs.writeFileSync(requestLogPath, '', 'utf8')

  const device = resolveDevice(defaultDevice)
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    prompt,
    mode,
    workflowId,
    fixture: relative(fixturePath),
    remoteFixturePath,
    requestLog: relative(requestLogPath),
    runtimeLog: relative(runtimeLogPath),
    topActivityEvidence: relative(topActivityPath),
    pushedFixture: false,
    imported: false,
    chatOpened: false,
    promptFocused: false,
    workflowPromptSent: false,
    systemSettingsOpened: false,
    systemSettingsUiVisible: false,
    targetActivityMatched: false,
    targetUiVisible: false,
    returnedToChat: false,
    pendingActionVisible: false,
    chatHandoffVisible: false,
    runtimeLogMatched: false,
    runtimeLogHasUpstreamRequest: false,
    runtimeLogEvents: [],
    providerRequestCount: 0,
    providerChatCompletionsCount: 0,
    providerModelListCount: 0,
    providerRequests: [],
    topActivity: '',
    routeOutcome: 'unknown',
    passed: false,
    captures: {},
    steps: [],
    errors: [],
  }

  let worker = null
  try {
    if (!device) throw new Error('No connected adb device was found.')
    worker = startMockProviderServer(requestLogPath)
    const reverseReady = configureAdbReverse(device, worker.port)
    writeFixture(reverseReady ? `http://127.0.0.1:${worker.port}/v1` : `http://10.0.2.2:${worker.port}/v1`)

    result.pushedFixture = pushFixture(device)
    forceStop(device)
    clearRuntimeLog(device)
    if (!tryOpenImportedChat(device, result, 'workflow-chat-before-import')) {
      importFixture(device, result)
    }
    result.imported = true

    openChat(device)
    let capture = captureStep(device, result, 'workflow-chat-start')
    result.chatTopActivity = readTopActivity(device)
    result.chatOpened = Boolean(capture.png) && (
      /com\.islemind\.app/i.test(result.chatTopActivity) ||
      isWorkflowChatUiVisible(capture.uiaText)
    )
    result.captures.chatStartPng = capture.png
    result.captures.chatStartUia = capture.uia
    if (!result.chatOpened) throw new Error('Imported workflow chat was not visible.')

    result.promptFocused = tapText(device, capture.uiaText, ['输入消息', 'Message input', '给 IsleMind 一个任务'])
      || tapEditableAtIndex(device, capture.uiaText, 0)
      || tapPoint(device, 176, 2078)
    if (!result.promptFocused) throw new Error('Could not focus the workflow chat composer input.')
    sleep(500)
    inputText(device, prompt)
    sleep(700)
    capture = captureStep(device, result, 'workflow-prompt-entered')
    result.captures.promptEnteredPng = capture.png
    result.captures.promptEnteredUia = capture.uia

    // Isolate the exact turn: clear the mock request log and runtime log right before sending.
    fs.writeFileSync(requestLogPath, '', 'utf8')
    clearRuntimeLog(device)

    result.workflowPromptSent = tapText(device, capture.uiaText, ['发送消息', 'Send message'])
      || tapActionNearText(device, capture.uiaText, [prompt.slice(0, 16), '输入消息', 'Message input'], ['发送消息', 'Send message'])
      || tapBottomRight(device)
    if (!result.workflowPromptSent) throw new Error('Could not tap Send for the workflow-routing prompt.')
    sleep(1200)

    const systemCapture = captureSystemSettings(device, result)
    result.systemSettingsOpened = /com\.android\.settings/i.test(result.topActivity)
    result.systemSettingsUiVisible = hasAnyText(systemCapture.uiaText, workflowCaptureLabels.system)
    result.targetActivityMatched = workflowRouteChecks.activity.test(result.topActivity)
    result.targetUiVisible = result.targetActivityMatched || result.systemSettingsUiVisible
    result.captures.systemSettingsPng = systemCapture.png
    result.captures.systemSettingsUia = systemCapture.uia

    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    sleep(1200)
    openChat(device)
    capture = captureStep(device, result, 'workflow-chat-return')
    result.returnedToChat = Boolean(capture.png) && /com\.islemind\.app/i.test(readTopActivity(device))
    result.pendingActionVisible = hasAnyText(capture.uiaText, workflowCaptureLabels.pending)
    result.chatHandoffVisible = hasAnyText(capture.uiaText, workflowCaptureLabels.handoff)
    result.captures.chatReturnPng = capture.png
    result.captures.chatReturnUia = capture.uia

    const runtimeText = readRuntimeLogWithRetry(device)
    fs.writeFileSync(runtimeLogPath, runtimeText ? `${runtimeText.trim()}\n` : '', 'utf8')
    const runtimeEntries = parseRuntimeLog(runtimeText)
    result.runtimeLogEvents = runtimeEntries.map((entry) => String(entry.event ?? 'unknown'))
    result.runtimeLogMatched = runtimeEntries.some((entry) => runtimeAuditMatchesMode(entry, mode))
    result.runtimeLogHasUpstreamRequest = runtimeEntries.some((entry) => entry.event === 'upstream.request')

    const rows = readJsonl(requestLogPath)
    result.providerRequests = rows.map((row) => ({
      method: row.method,
      url: row.url,
      body: tryParseJson(row.body),
    }))
    result.providerRequestCount = rows.length
    result.providerChatCompletionsCount = rows.filter((row) => row.method === 'POST' && row.url === '/v1/chat/completions').length
    result.providerModelListCount = rows.filter((row) => row.method === 'GET' && row.url === '/v1/models').length

    if (result.targetUiVisible) result.routeOutcome = workflowRouteOutcome.system
    else if (result.pendingActionVisible) result.routeOutcome = workflowRouteOutcome.pending
    else if (result.chatHandoffVisible) result.routeOutcome = workflowRouteOutcome.handoff

    result.passed = isPassing(result)
  } catch (error) {
    result.errors.push(error?.message ?? String(error))
    result.passed = false
  } finally {
    if (device && worker) clearAdbReverse(device, worker.port)
    if (worker) worker.instance.terminate()
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${result.passed ? 'Android workflow chat routing passed' : 'Android workflow chat routing failed'}: ${relative(outputPath)}.`)
  if (!result.passed) {
    console.error(`Android workflow chat routing failed: ${summarizeFailures(result).join('; ')}`)
    process.exitCode = 1
  }
}

function writeFixture(baseUrl) {
  const now = 1772300000000
  const fixture = {
    app: 'islemind',
    version: 1,
    conversations: [
      {
        id: conversationId,
        title: 'QA Android Workflow Chat Routing',
        providerId,
        model: modelId,
        providerModelMode: 'manual',
        systemPrompt: '',
        temperature: 0.7,
        topP: 1,
        reasoningEffort: 'medium',
        maxTokens: 4096,
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: {
      theme: 'system',
      language: 'zh-CN',
      defaultProvider: providerId,
      fontSize: 16,
      hapticsEnabled: true,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      memoryEnabled: false,
      knowledgeEnabled: false,
      webSearchEnabled: false,
      webSearchMode: 'native',
      knowledgeTopK: 4,
      memoryTopK: 4,
      onboardingCompleted: true,
      ragMode: 'off',
      embeddingMode: 'hybrid',
      localEmbeddingModelSource: 'none',
      localModelDownloadMirrorBaseUrl: '',
      ragProfile: 'balanced',
      ragQueryRewriteEnabled: false,
      ragHydeEnabled: false,
      ragFlareEnabled: false,
      ragGraphEnabled: false,
      ragRaptorEnabled: false,
      ragCrossEncoderEnabled: false,
      ragColbertEnabled: false,
      ragLlmlinguaEnabled: false,
      searchProvider: 'off',
      autoUpdateCheckEnabled: true,
      providerCatalogVersion: 1,
      skillsEnabled: true,
      mcpEnabled: false,
      commandPaletteEnabled: false,
      modelTestCheckParameters: true,
      runtimeLogEnabled: true,
      runtimeLogMaxBytes: 1048576,
      agentWorkflowAllowReadOnlyTools: true,
      agentWorkflowAllowReadWriteTools: 'visible',
      agentWorkflowAllowDestructiveTools: 'confirm',
      agentWorkflowMaxSteps: 3,
      agentWorkflowMaxToolCallsPerStep: 1,
      agentWorkflowOutputCharLimit: 4800,
    },
    providers: [
      {
        id: providerId,
        type: 'openai-compatible',
        presetId: 'custom-openai-compatible',
        detectedPresetId: 'custom-openai-compatible',
        detectionStatus: 'manual',
        name: providerName,
        apiKey: fakeApiKey,
        baseUrl,
        models: [modelId],
        manualModels: [modelId],
        modelAliases: [],
        credentialGroups: [
          {
            id: 'group-1',
            label: 'Default',
            apiKey: fakeApiKey,
            enabled: true,
            availableModels: [modelId],
          },
        ],
        modelConfigs: [
          {
            id: modelId,
            name: modelId,
            provider: 'openai-compatible',
            contextWindow: 32768,
            maxTokens: 32768,
            maxOutputTokens: 4096,
            defaultMaxTokens: 4096,
            supportsVision: false,
            supportsFiles: false,
          },
        ],
        enabled: true,
        lastTestStatus: 'ok',
        lastTestModel: modelId,
        lastModelSyncStatus: 'ok',
      },
    ],
    skills: [],
    mcpServers: [],
    exportedAt: now + 1000,
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
}

function importFixture(device, result) {
  openUrl(device, 'islemind://settings')
  sleep(4200)
  ensureSettingsVisible(device, result)
  const pickerStart = tapImportJson(device, result) ?? captureStep(device, result, 'workflow-file-picker-start')
  const importDialog = hasAnyText(pickerStart.uiaText, ['导入完成', 'Import complete'])
    ? pickerStart
    : selectFileAndCaptureImportDialog(device, result)
  result.captures.importDialogPng = importDialog.png
  result.captures.importDialogUia = importDialog.uia
  if (!hasAnyText(importDialog.uiaText, ['导入完成', 'Import complete'])) {
    throw new Error('Import completion dialog was not visible for the workflow chat routing fixture.')
  }
  tapText(device, importDialog.uiaText, ['知道了', '我知道了', 'OK'])
  sleep(900)
}

function openChat(device) {
  openUrl(device, `islemind://chat/${conversationId}`)
  sleep(3200)
}

function tryOpenImportedChat(device, result, name) {
  openChat(device)
  const capture = captureStep(device, result, name)
  result.captures[`${name}Png`] = capture.png
  result.captures[`${name}Uia`] = capture.uia
  return Boolean(capture.png) && isWorkflowChatUiVisible(capture.uiaText) && isCleanReusableWorkflowChat(capture.uiaText)
}

function ensureSettingsVisible(device, result) {
  let capture = captureStep(device, result, 'workflow-settings-start')
  if (hasAnyText(capture.uiaText, ['导入 JSON', 'AI 工作区就绪度', '导入 / 导出', 'Import JSON'])) return capture
  for (let index = 1; index <= 5 && !hasAnyText(capture.uiaText, ['设置', 'Settings', 'AI 设置', 'AI Settings']); index += 1) {
    sleep(900)
    capture = captureStep(device, result, `workflow-settings-start-wait-${index}`)
    if (hasAnyText(capture.uiaText, ['导入 JSON', 'AI 工作区就绪度', '导入 / 导出', 'Import JSON'])) return capture
  }
  if (hasAnyText(capture.uiaText, ['欢迎来到 IsleMind', '跳过'])) {
    if (!tapText(device, capture.uiaText, ['跳过'])) {
      throw new Error('First-run onboarding blocked Settings and the skip action was not tappable.')
    }
    sleep(900)
    openUrl(device, 'islemind://settings')
    sleep(1600)
    capture = captureStep(device, result, 'workflow-settings-after-onboarding-skip')
  }
  return capture
}

function tapImportJson(device, result) {
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, result, `workflow-settings-import-search-${index}`)
    if (isSettingsDetailPage(capture.uiaText)) {
      tapText(device, capture.uiaText, ['返回', 'Back']) || runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
      sleep(900)
      continue
    }
    const importVisible = hasAnyText(capture.uiaText, ['导入 JSON', 'AI 工作区就绪度', '导入 / 导出', 'Import JSON'])
    const tapped = importVisible && tapText(device, capture.uiaText, ['导入 JSON', 'Import JSON'])
    if (tapped) {
      sleep(1700)
      const afterTap = captureStep(device, result, `workflow-settings-import-tapped-${index}`)
      if (isDocumentsUi(afterTap.uiaText) || hasAnyText(afterTap.uiaText, ['导入完成', 'Import complete'])) return afterTap
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the Settings import JSON action.')
}

function selectFileAndCaptureImportDialog(device, result) {
  let searched = false
  for (let index = 0; index < 6; index += 1) {
    const capture = captureStep(device, result, `workflow-file-picker-search-${index}`)
    if (hasAnyText(capture.uiaText, ['导入完成', 'Import complete'])) return capture
    if (tapFileTitle(device, capture.uiaText, path.basename(fixturePath))) {
      sleep(1800)
      const imported = captureStep(device, result, 'workflow-import-confirm')
      if (hasAnyText(imported.uiaText, ['导入完成', 'Import complete'])) return imported
    }
    if (!searched && isDocumentsUi(capture.uiaText)) {
      searched = true
      const searchedCapture = searchDocumentsUiFile(device, result, path.basename(fixturePath))
      if (searchedCapture) return searchedCapture
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the workflow routing fixture in Android DocumentsUI.')
}

function searchDocumentsUiFile(device, result, fileName) {
  let capture = captureStep(device, result, 'workflow-file-picker-search-open')
  if (!tapText(device, capture.uiaText, ['Search', '搜索'])) return null
  sleep(700)
  capture = captureStep(device, result, 'workflow-file-picker-search-field')
  if (!tapEditableAtIndex(device, capture.uiaText, 0)) return null
  sleep(300)
  inputText(device, fileName)
  sleep(1400)
  capture = captureStep(device, result, 'workflow-file-picker-search-result')
  if (!tapFileTitle(device, capture.uiaText, fileName)) return null
  sleep(2200)
  return captureStep(device, result, 'workflow-import-confirm')
}

function captureSystemSettings(device, result) {
  let latest = captureStep(device, result, 'workflow-post-send-0')
  let topActivity = readTopActivity(device)
  for (let index = 0; index < 5; index += 1) {
    result.topActivity = topActivity
    fs.writeFileSync(topActivityPath, `${topActivity}\n`, 'utf8')
    if (/com\.android\.settings/i.test(topActivity)) return latest
    if (hasAnyText(latest.uiaText, ['Notifications', '通知', '通知设置', '应用通知', 'Promoted notifications', 'Settings'])) return latest
    sleep(800)
    topActivity = readTopActivity(device)
    latest = captureStep(device, result, `workflow-post-send-${index + 1}`)
  }
  result.topActivity = topActivity
  fs.writeFileSync(topActivityPath, `${topActivity}\n`, 'utf8')
  return latest
}

function readTopActivity(device) {
  const commands = [
    ['-s', device, 'shell', 'sh', '-c', 'dumpsys activity activities | grep -m 1 -E "mResumedActivity|topResumedActivity"'],
    ['-s', device, 'shell', 'sh', '-c', 'dumpsys window windows | grep -m 1 -E "mCurrentFocus|mFocusedApp"'],
    ['-s', device, 'shell', 'dumpsys', 'activity', 'activities'],
    ['-s', device, 'shell', 'dumpsys', 'window', 'windows'],
  ]
  for (const args of commands) {
    const output = runCommand('adb', args)
    const line = extractTopActivityLine(output)
    if (line) return line
  }
  return ''
}

function extractTopActivityLine(value) {
  const lines = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.find((line) => /mResumedActivity|topResumedActivity|mCurrentFocus|mFocusedApp/i.test(line)) ?? ''
}

function clearRuntimeLog(device) {
  runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'rm', '-f', 'files/islemind-runtime.jsonl'])
}

function readRuntimeLogWithRetry(device) {
  const candidates = [
    'files/islemind-runtime.jsonl',
    'islemind-runtime.jsonl',
    'cache/islemind-runtime.jsonl',
  ]
  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const candidate of candidates) {
      const text = runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'cat', candidate])
      if (text && String(text).trim()) return String(text)
    }
    sleep(700)
  }
  return ''
}

function parseRuntimeLog(text) {
  return String(text ?? '')
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

function waitForText(device, labels, name, maxAttempts, result) {
  let capture = captureStep(device, result, `${name}-0`)
  if (hasAnyText(capture.uiaText, labels)) return capture
  for (let index = 1; index <= maxAttempts; index += 1) {
    sleep(600)
    capture = captureStep(device, result, `${name}-${index}`)
    if (hasAnyText(capture.uiaText, labels)) return capture
  }
  return capture
}

function captureStep(device, result, name) {
  const pngPath = path.join(smokeDir, `${name}.png`)
  const uiaPath = path.join(smokeDir, `${name}.uia.xml`)
  const uniqueName = `${name}-${Date.now()}`
  const remotePng = `/sdcard/${uniqueName}.png`
  const remoteUia = `/sdcard/${uniqueName}.uia.xml`
  const pngOk = captureFileWithRetry(device, remotePng, pngPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng])
  })
  const uiaOk = captureFileWithRetry(device, remoteUia, uiaPath, () => {
    runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
  })
  const uiaText = uiaOk && fs.existsSync(uiaPath) ? fs.readFileSync(uiaPath, 'utf8') : ''
  const step = {
    name,
    png: pngOk ? relative(pngPath) : null,
    uia: uiaOk ? relative(uiaPath) : null,
    visibleText: extractVisibleText(uiaText).slice(0, 90),
  }
  result.steps.push(step)
  return { png: step.png, uia: step.uia, uiaText }
}

function captureFileWithRetry(device, remotePath, localPath, captureRemote) {
  if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    captureRemote()
    runCommand('adb', ['-s', device, 'pull', remotePath, localPath])
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) return true
    sleep(350 + attempt * 350)
  }
  return false
}

function tapText(device, uiaText, labels) {
  const node = findTappableTextNode(parseNodes(uiaText), labels)
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapActionNearText(device, uiaText, anchorLabels, actionLabels) {
  const nodes = parseNodes(uiaText)
  const anchor = nodes.find((node) => isUsableBounds(node.bounds) && textMatchesAny(node, anchorLabels))
  const anchorBounds = parseBounds(anchor?.bounds)
  const candidates = nodes
    .filter((node) => node.enabled && isUsableBounds(node.bounds) && textMatchesAny(node, actionLabels))
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
  const editables = parseNodes(uiaText).filter((node) => node.enabled && isUsableBounds(node.bounds) && node.className.includes('EditText'))
  const node = editables[index]
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapFileTitle(device, uiaText, fileName) {
  const nodes = parseNodes(uiaText)
  const titleNode = nodes.find((item) => item.enabled && item.text === fileName)
  const titleBounds = titleNode ? parseBounds(titleNode.bounds) : null
  if (titleBounds) {
    const card = nodes
      .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
      .filter(({ item, bounds }) => item.enabled && item.clickable && bounds && boundsContains(bounds, titleBounds))
      .sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))[0]
    if (card?.bounds) {
      const x = Math.round(card.bounds.left + (card.bounds.right - card.bounds.left) * 0.35)
      const y = Math.round(card.bounds.top + (card.bounds.bottom - card.bounds.top) * 0.55)
      runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(x), String(y)])
      return true
    }
    tapBoundsCenter(device, titleNode.bounds)
    return true
  }
  const previewNode = nodes.find((item) => (
    item.enabled &&
    item.clickable &&
    item.contentDesc.includes(fileName) &&
    /Preview|预览|Open|打开/i.test(item.contentDesc)
  ))
  if (!previewNode) return false
  const previewBounds = parseBounds(previewNode.bounds)
  if (!previewBounds) return false
  const containingCard = nodes
    .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
    .filter(({ item, bounds }) => item.enabled && item.clickable && bounds && boundsContains(bounds, previewBounds) && boundsArea(bounds) >= boundsArea(previewBounds))
    .sort((a, b) => boundsArea(b.bounds) - boundsArea(a.bounds))[0]
  const targetBounds = containingCard?.item?.bounds ?? previewNode.bounds
  if (!isUsableBounds(targetBounds)) return false
  tapBoundsCenter(device, targetBounds)
  return true
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
  const match = String(bounds ?? '').match(/\[(\-?\d+),(\-?\d+)\]\[(\-?\d+),(\-?\d+)\]/)
  if (!match) return null
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  }
}

function isUsableBounds(bounds) {
  const box = parseBounds(bounds)
  if (!box) return false
  if (box.right <= box.left || box.bottom <= box.top) return false
  const centerX = (box.left + box.right) / 2
  const centerY = (box.top + box.bottom) / 2
  return centerX >= 0 && centerX <= 1080 && centerY >= 48 && centerY <= 2200
}

function boundsContains(container, inner) {
  return inner.left >= container.left && inner.right <= container.right && inner.top >= container.top && inner.bottom <= container.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box || !isUsableBounds(bounds)) return
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2))])
}

function tapBottomRight(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', '950', '2078'])
  return true
}

function tapPoint(device, x, y) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))])
  return true
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '620', '450'])
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

function extractVisibleText(uiaText) {
  const values = []
  for (const node of parseNodes(uiaText)) {
    if (node.text) values.push(node.text)
    if (node.contentDesc) values.push(node.contentDesc)
  }
  return [...new Set(values)]
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function isSettingsDetailPage(uiaText) {
  return hasAnyText(uiaText, ['创建 Skill', '服务商 ID', '模型 ID', 'Base URL', 'API Key']) &&
    hasAnyText(uiaText, ['返回', 'Back'])
}

function isWorkflowChatUiVisible(uiaText) {
  return hasAnyText(uiaText, [
    'QA Android Workflow Provider',
    'Qa Android Workflow Model',
    '会话消息列表',
    '输入消息',
    'Message input',
  ])
}

function isCleanReusableWorkflowChat(uiaText) {
  const text = String(uiaText ?? '')
  if (text.includes(prompt)) return false
  const targetCount = matchFirst(text, /会话消息列表[^"]*共\s*(\d+)\s*条消息/) ?? matchFirst(text, /message list[^"]*(\d+)\s*messages?/i)
  if (targetCount !== null) return Number(targetCount) === 0
  return !hasAnyText(text, ['"opened": true', 'Agentic workflow', 'android.', 'set an alarm', 'open notification settings', 'create a todo'])
}

function safeModeId(value) {
  const safe = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe || 'notification-settings'
}

function isDocumentsUi(uiaText) {
  const text = String(uiaText ?? '')
  return text.includes('com.google.android.documentsui')
    || text.includes('com.android.documentsui')
    || hasAnyText(text, ['Recent', 'Downloads', '最近', '下载', 'Open from', 'Show roots'])
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

function forceStop(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function pushFixture(device) {
  const output = runCommand('adb', ['-s', device, 'push', fixturePath, remoteFixturePath])
  if (output !== null) runCommand('adb', ['-s', device, 'shell', 'touch', remoteFixturePath])
  return output !== null
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

function configureAdbReverse(device, port) {
  const local = `tcp:${port}`
  const remote = `tcp:${port}`
  clearAdbReverse(device, port)
  return runCommand('adb', ['-s', device, 'reverse', local, remote]) !== null
}

function clearAdbReverse(device, port) {
  runCommand('adb', ['-s', device, 'reverse', '--remove', `tcp:${port}`])
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

function startMockProviderServer(logPath) {
  const stateBuffer = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT)
  const state = new Int32Array(stateBuffer)
  const instance = new Worker(__filename, { workerData: { logPath, stateBuffer } })
  Atomics.wait(state, 1, 0, 5000)
  if (Atomics.load(state, 1) !== 1) {
    instance.terminate()
    throw new Error('Mock provider server did not start.')
  }
  return { instance, port: Atomics.load(state, 0) }
}

function runMockProviderWorker() {
  const state = new Int32Array(workerData.stateBuffer)
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const receivedAt = new Date().toISOString()
      fs.appendFileSync(workerData.logPath, `${JSON.stringify({ receivedAt, method: request.method, url: request.url, body })}\n`, 'utf8')
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          object: 'list',
          data: [
            {
              id: modelId,
              object: 'model',
              owned_by: 'islemind-qa',
              context_window: 32768,
              max_output_tokens: 4096,
            },
          ],
        }))
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        let payload = {}
        try {
          payload = body ? JSON.parse(body) : {}
        } catch {
          payload = {}
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          id: 'chatcmpl-qa-android-workflow',
          object: 'chat.completion',
          model: payload.model ?? modelId,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'SHOULD_NOT_BE_USED' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }))
        return
      }
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'not_found' } }))
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

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function isPassing(result) {
  const uiMatched = result.targetUiVisible || result.pendingActionVisible || result.chatHandoffVisible
  return Boolean(
    result.device &&
    result.pushedFixture &&
    result.imported &&
    result.chatOpened &&
    result.promptFocused &&
    result.workflowPromptSent &&
    uiMatched &&
    result.runtimeLogMatched &&
    !result.runtimeLogHasUpstreamRequest &&
    result.providerChatCompletionsCount === 0 &&
    result.errors.length === 0
  )
}

function summarizeFailures(result) {
  const failures = []
  for (const key of ['device', 'pushedFixture', 'imported', 'chatOpened', 'promptFocused', 'workflowPromptSent', 'runtimeLogMatched']) {
    if (!result[key]) failures.push(`${key}=false`)
  }
  if (!(result.targetUiVisible || result.pendingActionVisible || result.chatHandoffVisible)) {
    failures.push('missing workflow UI evidence')
  }
  if (result.runtimeLogHasUpstreamRequest) failures.push('runtimeLogHasUpstreamRequest=true')
  if (result.providerChatCompletionsCount !== 0) failures.push(`providerChatCompletionsCount=${result.providerChatCompletionsCount}`)
  failures.push(...result.errors)
  return failures
}

function defaultPromptForMode(nextMode) {
  switch (nextMode) {
    case 'alarm':
      return 'set an alarm for 8:00 am called take a break'
    case 'calendar':
      return 'create a todo for 2026-06-20 20:00 titled take a break'
    default:
      return 'open notification settings'
  }
}

function workflowIdForMode(nextMode) {
  switch (nextMode) {
    case 'alarm':
      return 'agent-workflow-android-alarm'
    case 'calendar':
      return 'agent-workflow-android-calendar-todo'
    default:
      return 'agent-workflow-android-notification-settings'
  }
}

function routeOutcomeForMode(nextMode) {
  switch (nextMode) {
    case 'alarm':
      return { system: 'clock-opened', pending: 'alarm-pending-visible', handoff: 'alarm-handoff-visible' }
    case 'calendar':
      return { system: 'calendar-opened', pending: 'calendar-pending-visible', handoff: 'calendar-handoff-visible' }
    default:
      return { system: 'system-settings-opened', pending: 'pending-action-visible', handoff: 'chat-handoff-visible' }
  }
}

function routeChecksForMode(nextMode) {
  switch (nextMode) {
    case 'alarm':
      return { activity: /(deskclock|clock|alarm)/i }
    case 'calendar':
      return { activity: /(calendar|agenda|event|todo|reminder)/i }
    default:
      return { activity: /com\.android\.settings/i }
  }
}

function runtimeAuditMatchesMode(entry, nextMode) {
  if (!entry || entry.event !== 'android.operation.audit') return false
  switch (nextMode) {
    case 'alarm':
      return entry.toolName === 'android.alarm.open_create_intent' ||
        entry.toolId === 'android:alarm.open_create_intent' ||
        entry.operationKind === 'alarm-intent' ||
        entry.scope === 'system-clock'
    case 'calendar':
      return entry.toolName === 'android.reminder.open_create_todo' ||
        entry.toolId === 'android:reminder.open_create_todo' ||
        entry.operationKind === 'calendar-todo-intent' ||
        entry.scope === 'system-calendar'
    default:
      return entry.toolName === 'android.notifications.open_settings' ||
        entry.toolId === 'android:notifications.open_settings' ||
        entry.operationKind === 'notification-settings-intent' ||
        entry.scope === 'system-notification-settings'
  }
}

function workflowLabelsForMode(nextMode) {
  switch (nextMode) {
    case 'alarm':
      return {
        system: ['时钟', '闹钟', 'Clock', 'Alarm', 'set alarm', 'create alarm'],
        pending: ['需要你确认后继续', 'Action needs confirmation', 'Open Android alarm editor', '打开 Android 闹钟编辑器', 'Android alarm handoff workflow', 'android.alarm.open_create_intent'],
        handoff: ['已打开 Android 时钟界面', 'Android Clock is open', '"opened": true', '"target": "alarm"', 'alarm', 'clock'],
      }
    case 'calendar':
      return {
        system: ['日历', 'Calendar', 'Reminder', 'Todo', 'create event', 'create reminder'],
        pending: ['需要你确认后继续', 'Action needs confirmation', 'Open Android calendar editor', '打开 Android 日历编辑器', 'Android calendar to-do handoff workflow', 'android.reminder.open_create_todo'],
        handoff: ['已打开 Android 日历界面', 'Android Calendar is open', '"opened": true', '"target": "calendar-todo"', 'calendar', 'reminder', 'todo'],
      }
    default:
      return {
        system: ['com.android.settings', '通知', '通知设置', '通知管理', '应用通知', 'Notifications', 'App notifications', 'Allow notifications', 'Promoted notifications', 'Settings'],
        pending: [
          'Action needs confirmation',
          '需要你确认后继续',
          'Open Android notification settings',
          'IsleMind opens Android notification-related system settings for this app.',
          'Use the visible confirmation action below to continue.',
          '需要确认后继续',
        ],
        handoff: ['"opened": true', '"target": "notifications"', '"backgroundReliable": false', '"reason": "opened"', 'opened', 'backgroundReliable', 'notification'],
      }
  }
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}
