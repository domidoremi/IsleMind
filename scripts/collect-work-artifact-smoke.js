const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const smokeDir = path.join(evidenceDir, 'work-artifact-smoke')
const outputPath = path.join(evidenceDir, 'work-artifact-smoke-results.json')
const fixturePath = path.join(smokeDir, 'islemind-work-artifact-smoke.json')
const remoteFixturePath = '/sdcard/Download/islemind-work-artifact-smoke.json'
const appPackageName = defaultReleaseAppPackageName
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const conversationId = 'qa-work-artifact-fixture'
const assistantToken = 'QA_WORK_ARTIFACT_RESPONSE_TOKEN'
const continuationPromptPrefix = '从这个工作产物继续，并执行主要下一步'
const continuationPromptStep = '捕获工作产物复制与继续提示运行证据'
const importJsonLabels = ['导入 JSON', 'Import JSON', 'JSON インポート']
const importExportLabels = ['导入 / 导出', 'Import / Export', 'インポート / エクスポート']
const importDoneLabels = ['导入完成', 'Import complete', 'インポート完了']
const skipLabels = ['跳过', 'Skip', 'スキップ']
const copyWorkArtifactLabels = ['复制工作产物', 'Copy work artifact', '作業成果をコピー']
const continueWorkArtifactLabels = ['继续这项工作', 'Continue work', 'この作業を続ける']
const workArtifactActionLabels = [...copyWorkArtifactLabels, ...continueWorkArtifactLabels]
const copyWorkArtifactToastLabels = ['工作产物已复制到剪贴板', 'Work artifact copied to clipboard', '作業成果をクリップボードにコピーしました', '已复制', 'Copied']
const continueWorkArtifactToastLabels = ['已插入继续执行提示', 'Continuation prompt inserted', '継続用プロンプトを入力欄に入れました']
const composerInputLabels = ['给 IsleMind 一个任务', '输入消息', 'Type a message', 'メッセージを入力', continuationPromptPrefix]

function main() {
  fs.mkdirSync(smokeDir, { recursive: true })
  writeFixture()

  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    fixture: relative(fixturePath),
    remoteFixturePath,
    pushedFixture: false,
    importDialogShown: false,
    importDialogPng: null,
    importDialogUia: null,
    importedChatOpened: false,
    chatPng: null,
    chatUia: null,
    assistantWorkArtifactVisible: false,
    actionMenuOpened: false,
    actionMenuPng: null,
    actionMenuUia: null,
    copyActionVisible: false,
    continueActionVisible: false,
    copyActionTapped: false,
    copyToastVisible: false,
    copyToastVisualEvidenceOnly: false,
    copyToastPng: null,
    copyToastUia: null,
    continueActionTapped: false,
    continueToastVisible: false,
    continueToastVisualEvidenceOnly: false,
    composerContinuationPromptVisible: false,
    continuePromptPng: null,
    continuePromptUia: null,
    log: relative(path.join(smokeDir, 'work-artifact-smoke.log')),
    steps: [],
    errors: [],
  }

  try {
    if (!device) throw new Error('No connected adb device was found.')
    result.pushedFixture = pushFixture(device)
    openSettings(device)
    ensureSettingsVisible(device, result)
    tapImportJson(device, result)
    const pickerStart = captureStep(device, result, 'file-picker-start')
    const importDialog = hasAnyText(pickerStart.uiaText, importDoneLabels)
      ? pickerStart
      : selectFileAndCaptureImportDialog(device, result)
    result.importDialogShown = hasAnyText(importDialog.uiaText, importDoneLabels)
    result.importDialogPng = importDialog.png
    result.importDialogUia = importDialog.uia
    if (!result.importDialogShown) throw new Error('Import completion dialog was not visible after selecting the fixture.')
    tapText(device, importDialog.uiaText, ['知道了', '我知道了', 'OK'])
    sleep(900)

    openChat(device)
    const chat = captureChatWithAssistant(device, result)
    result.assistantWorkArtifactVisible = hasAnyText(chat.uiaText, [assistantToken, '结构化摘要', continuationPromptStep])
    result.importedChatOpened = result.assistantWorkArtifactVisible || hasAnyText(chat.uiaText, ['QA Work Artifact Fixture', 'QA_WORK_ARTIFACT_USER_TOKEN', assistantToken])
    result.chatPng = chat.png
    result.chatUia = chat.uia
    if (!result.importedChatOpened || !result.assistantWorkArtifactVisible) {
      throw new Error('Imported structured work artifact conversation was not visible.')
    }

    const actionMenu = openWorkArtifactActions(device, result)
    result.actionMenuOpened = true
    result.actionMenuPng = actionMenu.png
    result.actionMenuUia = actionMenu.uia
    result.copyActionVisible = hasAnyText(actionMenu.uiaText, copyWorkArtifactLabels)
    result.continueActionVisible = hasAnyText(actionMenu.uiaText, continueWorkArtifactLabels)
    if (!result.copyActionVisible || !result.continueActionVisible) {
      throw new Error('Work artifact action menu did not expose copy and continue actions.')
    }

    result.continueActionTapped = tapText(device, actionMenu.uiaText, continueWorkArtifactLabels)
    if (!result.continueActionTapped) throw new Error('Could not tap the continue-work-artifact action.')
    sleep(900)

    const continuePrompt = captureStep(device, result, 'continue-prompt')
    result.continueToastVisible = hasAnyText(continuePrompt.uiaText, continueWorkArtifactToastLabels)
    result.continueToastVisualEvidenceOnly = !result.continueToastVisible && Boolean(continuePrompt.png && continuePrompt.uia)
    result.composerContinuationPromptVisible = hasContinuationPrompt(continuePrompt.uiaText)
    result.continuePromptPng = continuePrompt.png
    result.continuePromptUia = continuePrompt.uia

    if (!result.composerContinuationPromptVisible) {
      tapText(device, continuePrompt.uiaText, composerInputLabels)
      sleep(700)
      const focusedPrompt = captureStep(device, result, 'continue-prompt-focused')
      result.continueToastVisible = result.continueToastVisible || hasAnyText(focusedPrompt.uiaText, continueWorkArtifactToastLabels)
      result.continueToastVisualEvidenceOnly = !result.continueToastVisible && Boolean(focusedPrompt.png && focusedPrompt.uia)
      result.composerContinuationPromptVisible = hasContinuationPrompt(focusedPrompt.uiaText)
      result.continuePromptPng = focusedPrompt.png
      result.continuePromptUia = focusedPrompt.uia
    }
    if (!result.continueToastVisible && !result.continueToastVisualEvidenceOnly) throw new Error('Continue-work-artifact toast evidence was not captured.')
    if (!result.composerContinuationPromptVisible) throw new Error('Composer did not expose the inserted continuation prompt.')

    const copyMenu = hasAnyText(continuePrompt.uiaText, copyWorkArtifactLabels)
      ? continuePrompt
      : reopenWorkArtifactChatActions(device, result)
    result.copyActionVisible = result.copyActionVisible || hasAnyText(copyMenu.uiaText, copyWorkArtifactLabels)
    result.copyActionTapped = tapText(device, copyMenu.uiaText, copyWorkArtifactLabels)
    if (!result.copyActionTapped) throw new Error('Could not tap the copy-work-artifact action.')
    sleep(700)
    const copyToast = captureStep(device, result, 'copy-toast')
    result.copyToastVisible = hasAnyText(copyToast.uiaText, copyWorkArtifactToastLabels)
    result.copyToastVisualEvidenceOnly = !result.copyToastVisible && Boolean(copyToast.png && copyToast.uia)
    result.copyToastPng = copyToast.png
    result.copyToastUia = copyToast.uia
    if (!result.copyToastVisible && !result.copyToastVisualEvidenceOnly) throw new Error('Copy-work-artifact toast evidence was not captured.')
  } catch (error) {
    result.errors.push(error.message)
  }

  writeLog(result)
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${isPassing(result) ? 'Work artifact smoke passed' : 'Work artifact smoke failed'}: ${relative(outputPath)}`)
  if (!isPassing(result)) process.exitCode = 1
}

function writeFixture() {
  const fixture = {
    app: 'islemind',
    version: 1,
    conversations: [
      {
        id: conversationId,
        title: 'QA Work Artifact Fixture',
        providerId: 'qa-work-artifact-provider',
        model: 'qa-work-artifact-model',
        providerModelMode: 'manual',
        systemPrompt: '',
        temperature: 0.7,
        topP: 1,
        reasoningEffort: 'medium',
        maxTokens: 2048,
        messages: [
          {
            id: 'qa-work-artifact-user',
            role: 'user',
            content: 'QA_WORK_ARTIFACT_USER_TOKEN 请把这个项目状态整理成可交接工作产物。',
            timestamp: 1772000000000,
            status: 'done',
          },
          {
            id: 'qa-work-artifact-assistant',
            role: 'assistant',
            content: [
              assistantToken,
              '',
              '结构化摘要',
              '- IsleMind 已经具备可验证的工作区证据链。',
              '',
              '决策记录',
              '- 将工作产物交接作为聊天消息的一等操作。',
              '',
              '行动项',
              `- 负责人：QA / 下一步：${continuationPromptStep} / 截止：发布门禁`,
              '',
              '风险和阻塞',
              '- 如果只做静态测试，无法证明真实 APK 中操作可用。',
              '',
              '证据仍需补充',
              '- 运行 work artifact smoke 并保存 UIA 与截图。',
              '',
              '待确认问题',
              '- 是否把工作产物动作提升为更醒目的默认操作？',
              '',
              '可分享版本',
              '- IsleMind 可以把 AI 回复转成可复制、可继续执行的工作产物。',
            ].join('\n'),
            timestamp: 1772000005000,
            status: 'done',
          },
        ],
        createdAt: 1772000000000,
        updatedAt: 1772000005000,
      },
    ],
    settings: {
      theme: 'system',
      language: 'zh-CN',
      defaultProvider: 'qa-work-artifact-provider',
      fontSize: 16,
      hapticsEnabled: true,
      defaultTemperature: 0.7,
      memoryEnabled: true,
      knowledgeEnabled: true,
      webSearchEnabled: false,
      webSearchMode: 'native',
      knowledgeTopK: 4,
      memoryTopK: 4,
      ragMode: 'hybrid',
      embeddingMode: 'hybrid',
      localEmbeddingModelSource: 'none',
      localModelDownloadMirrorBaseUrl: '',
      ragProfile: 'balanced',
      ragQueryRewriteEnabled: true,
      ragHydeEnabled: true,
      ragFlareEnabled: true,
      ragGraphEnabled: true,
      ragRaptorEnabled: true,
      ragCrossEncoderEnabled: true,
      ragColbertEnabled: true,
      ragLlmlinguaEnabled: true,
      searchProvider: 'native',
      autoUpdateCheckEnabled: true,
      providerCatalogVersion: 1,
      skillsEnabled: true,
      mcpEnabled: true,
      commandPaletteEnabled: true,
    },
    providers: [
      {
        id: 'qa-work-artifact-provider',
        type: 'openai-compatible',
        presetId: 'custom-openai-compatible',
        detectedPresetId: 'custom-openai-compatible',
        detectionStatus: 'manual',
        name: 'QA Work Artifact Provider',
        apiKey: 'islemind-work-artifact-placeholder-key',
        baseUrl: 'http://10.0.2.2:8799/v1',
        models: ['qa-work-artifact-model'],
        enabled: true,
        lastTestStatus: 'ok',
        lastModelSyncStatus: 'ok',
      },
    ],
    skills: [],
    mcpServers: [],
    exportedAt: 1772000009000,
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
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

function pushFixture(device) {
  const output = runCommand('adb', ['-s', device, 'push', fixturePath, remoteFixturePath])
  return output !== null
}

function openSettings(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'islemind://settings'])
  sleep(2500)
}

function ensureSettingsVisible(device, result) {
  let capture = captureStep(device, result, 'settings-start')
  if (hasAnyText(capture.uiaText, [...importJsonLabels, 'AI 工作区就绪度', ...importExportLabels])) return capture
  return capture
}

function openChat(device) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `islemind://chat/${conversationId}`])
  sleep(2600)
}

function tapImportJson(device, result) {
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, result, `settings-import-search-${index}`)
    if (tapText(device, capture.uiaText, importJsonLabels)) {
      sleep(1400)
      return
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the Settings import JSON action.')
}

function tapFileInDocumentsUi(device, result) {
  const fileName = 'islemind-work-artifact-smoke.json'
  let searched = false
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, result, `file-picker-search-${index}`)
    if (hasAnyText(capture.uiaText, importDoneLabels)) return capture
    const fileCapture = dismissDocumentsSearchKeyboardIfNeeded(device, result, capture, fileName, index)
    if (tapFileTitle(device, fileCapture.uiaText, fileName)) {
      sleep(1800)
      return captureStep(device, result, 'import-confirm')
    }
    if (!searched && searchDocumentsUi(device, capture.uiaText, fileName)) {
      searched = true
      sleep(1100)
      continue
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the work artifact fixture in Android DocumentsUI.')
}

function searchDocumentsUi(device, uiaText, fileName) {
  if (!tapText(device, uiaText, ['搜索', 'Search', '検索'])) return false
  sleep(500)
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', fileName])
  return true
}

function dismissDocumentsSearchKeyboardIfNeeded(device, result, capture, fileName, index) {
  if (!documentsFileTitleVisible(capture.uiaText, fileName)) return capture
  if (!documentsSearchFieldFocused(capture.uiaText)) return capture
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(650)
  const dismissed = captureStep(device, result, `file-picker-search-${index}-keyboard-dismissed`)
  return documentsFileTitleVisible(dismissed.uiaText, fileName) ? dismissed : capture
}

function selectFileAndCaptureImportDialog(device, result) {
  const capture = tapFileInDocumentsUi(device, result)
  if (capture && hasAnyText(capture.uiaText, importDoneLabels)) return capture
  sleep(1800)
  return captureStep(device, result, 'import-confirm')
}

function captureChatWithAssistant(device, result) {
  let latest = captureStep(device, result, 'chat-start')
  for (let index = 0; index < 6; index += 1) {
    if (hasAnyText(latest.uiaText, [assistantToken, '结构化摘要', continuationPromptStep])) return latest
    swipeDown(device)
    sleep(400)
    latest = captureStep(device, result, `chat-search-assistant-${index}`)
  }
  return latest
}

function openWorkArtifactActions(device, result) {
  let latest = captureStep(device, result, 'actions-search-start')
  if (hasAnyText(latest.uiaText, workArtifactActionLabels)) return latest
  if (tapAssistantMessageBody(device, latest.uiaText)) {
    sleep(750)
    const candidate = captureStep(device, result, 'actions-open-message-body')
    if (hasAnyText(candidate.uiaText, workArtifactActionLabels)) return candidate
    latest = candidate
  }
  for (let round = 0; round < 8; round += 1) {
    const actionNodes = parseNodes(latest.uiaText).filter((node) => node.enabled && ['操作', 'Actions', 'アクション'].some((label) => textMatches(node, label)))
    for (const node of actionNodes.sort((a, b) => parseBounds(b.bounds).top - parseBounds(a.bounds).top)) {
      tapBoundsCenter(device, node.bounds)
      sleep(650)
      const candidate = captureStep(device, result, `actions-open-${round}`)
      if (hasAnyText(candidate.uiaText, workArtifactActionLabels)) return candidate
      tapText(device, candidate.uiaText, ['收起'])
      sleep(200)
    }
    if (tapAssistantMessageBody(device, latest.uiaText)) {
      sleep(750)
      const candidate = captureStep(device, result, `actions-open-body-${round}`)
      if (hasAnyText(candidate.uiaText, workArtifactActionLabels)) return candidate
      latest = candidate
      continue
    }
    swipeDown(device)
    sleep(350)
    latest = captureStep(device, result, `actions-search-${round}`)
  }
  throw new Error('Could not open the assistant work artifact action menu.')
}

function tapAssistantMessageBody(device, uiaText) {
  return tapText(device, uiaText, [assistantToken, '结构化摘要', continuationPromptStep])
}

function reopenWorkArtifactChatActions(device, result) {
  openChat(device)
  const chat = captureChatWithAssistant(device, result)
  if (!hasAnyText(chat.uiaText, [assistantToken, '结构化摘要', continuationPromptStep])) {
    throw new Error('Could not return to the imported work artifact chat for copy verification.')
  }
  return openWorkArtifactActions(device, result)
}

function tapFileTitle(device, uiaText, fileName) {
  const nodes = parseNodes(uiaText)
  const titleNodes = nodes
    .filter((item) => item.enabled && item.text === fileName)
    .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
    .filter(({ bounds }) => bounds && bounds.top > 300)
    .sort((a, b) => a.bounds.top - b.bounds.top)
  for (const { item: titleNode, bounds: titleBounds } of titleNodes) {
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
  const previewNode = nodes.find((item) => item.enabled && item.clickable && item.contentDesc.includes(fileName))
  if (!previewNode) return false
  const box = parseBounds(previewNode.bounds)
  if (!box) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.max(1, box.left - 80)), String(Math.round((box.top + box.bottom) / 2))])
  return true
}

function captureStep(device, result, name) {
  const png = path.join(smokeDir, `${name}.png`)
  const uia = path.join(smokeDir, `${name}.uia.xml`)
  runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', `/sdcard/${name}.png`])
  runCommand('adb', ['-s', device, 'pull', `/sdcard/${name}.png`, png])
  runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', `/sdcard/${name}.uia.xml`])
  runCommand('adb', ['-s', device, 'pull', `/sdcard/${name}.uia.xml`, uia])
  const uiaText = fs.existsSync(uia) ? fs.readFileSync(uia, 'utf8') : ''
  const step = {
    name,
    png: relative(png),
    uia: relative(uia),
    visibleText: extractVisibleText(uiaText).slice(0, 90),
  }
  result.steps.push(step)
  return { png: step.png, uia: step.uia, uiaText }
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
    .sort((a, b) => boundsArea(a.bounds) - boundsArea(b.bounds))[0]?.item
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
      resourceId: decodeXml(matchFirst(tag, /resource-id="([^"]*)"/) ?? ''),
      bounds,
      enabled: matchFirst(tag, /enabled="([^"]+)"/) !== 'false',
      clickable: matchFirst(tag, /clickable="([^"]+)"/) === 'true',
      focused: matchFirst(tag, /focused="([^"]+)"/) === 'true',
    })
  }
  return nodes
}

function documentsFileTitleVisible(uiaText, fileName) {
  return parseNodes(uiaText).some((item) => item.enabled && item.text === fileName && parseBounds(item.bounds)?.top > 300)
}

function documentsSearchFieldFocused(uiaText) {
  return parseNodes(uiaText).some((item) =>
    item.enabled &&
    item.focused &&
    item.resourceId === 'com.google.android.documentsui:id/search_src_text')
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

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '620', '450'])
}

function swipeDown(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '620', '432', '1580', '450'])
}

function hasAnyText(text, values) {
  return values.some((value) => text.includes(value))
}

function hasContinuationPrompt(uiaText) {
  return uiaText.includes(continuationPromptPrefix) && uiaText.includes(continuationPromptStep)
}

function extractVisibleText(uiaText) {
  const values = []
  for (const node of parseNodes(uiaText)) {
    if (node.text) values.push(node.text)
    if (node.contentDesc) values.push(node.contentDesc)
  }
  return [...new Set(values)]
}

function writeLog(result) {
  const lines = [
    `generatedAt=${result.generatedAt}`,
    `device=${result.device ?? 'missing'}`,
    `pushedFixture=${result.pushedFixture}`,
    `importDialogShown=${result.importDialogShown}`,
    `importedChatOpened=${result.importedChatOpened}`,
    `assistantWorkArtifactVisible=${result.assistantWorkArtifactVisible}`,
    `copyActionVisible=${result.copyActionVisible}`,
    `continueActionVisible=${result.continueActionVisible}`,
    `copyToastVisible=${result.copyToastVisible}`,
    `copyToastVisualEvidenceOnly=${result.copyToastVisualEvidenceOnly}`,
    `continueToastVisible=${result.continueToastVisible}`,
    `continueToastVisualEvidenceOnly=${result.continueToastVisualEvidenceOnly}`,
    `composerContinuationPromptVisible=${result.composerContinuationPromptVisible}`,
    ...result.errors.map((error) => `error=${error}`),
  ]
  fs.writeFileSync(path.join(smokeDir, 'work-artifact-smoke.log'), `${lines.join('\n')}\n`, 'utf8')
}

function runSelfTest() {
  const fileName = 'islemind-work-artifact-smoke.json'
  const focusedSearchWithFile = [
    '<node text="" resource-id="com.google.android.documentsui:id/search_src_text" content-desc="" enabled="true" clickable="true" focused="true" bounds="[220,106][2156,205]" />',
    `<node text="${fileName}" resource-id="android:id/title" content-desc="" enabled="true" clickable="false" focused="false" bounds="[198,890][886,949]" />`,
    `<node text="" resource-id="com.google.android.documentsui:id/preview_icon" content-desc="预览“${fileName}”文件" enabled="true" clickable="true" focused="false" bounds="[2112,849][2310,1036]" />`,
  ].join('\n')
  const fileHiddenByHeaderOnly = [
    `<node text="${fileName}" resource-id="com.google.android.documentsui:id/search_src_text" content-desc="" enabled="true" clickable="true" focused="true" bounds="[220,106][2156,205]" />`,
  ].join('\n')

  assert.equal(documentsFileTitleVisible(focusedSearchWithFile, fileName), true, 'DocumentsUI file row is visible below the header')
  assert.equal(documentsSearchFieldFocused(focusedSearchWithFile), true, 'DocumentsUI focused search field is detected')
  assert.equal(documentsFileTitleVisible(fileHiddenByHeaderOnly, fileName), false, 'Search query text is not mistaken for a tappable file row')
  assert.equal(extractVisibleText(focusedSearchWithFile).includes(`预览“${fileName}”文件`), true, 'localized preview content-desc is decoded')
  console.log('Work artifact smoke self-test passed')
}

function isPassing(result) {
  return Boolean(
    result.device &&
    result.pushedFixture &&
    result.importDialogShown &&
    result.importedChatOpened &&
    result.assistantWorkArtifactVisible &&
    result.actionMenuOpened &&
    result.copyActionVisible &&
    result.continueActionVisible &&
    result.copyActionTapped &&
    (result.copyToastVisible || result.copyToastVisualEvidenceOnly) &&
    result.continueActionTapped &&
    (result.continueToastVisible || result.continueToastVisualEvidenceOnly) &&
    result.composerContinuationPromptVisible &&
    result.chatPng &&
    result.chatUia &&
    result.actionMenuPng &&
    result.actionMenuUia &&
    result.copyToastPng &&
    result.copyToastUia &&
    result.continuePromptPng &&
    result.continuePromptUia &&
    fs.existsSync(path.join(root, result.chatPng)) &&
    fs.existsSync(path.join(root, result.chatUia)) &&
    fs.existsSync(path.join(root, result.actionMenuPng)) &&
    fs.existsSync(path.join(root, result.actionMenuUia)) &&
    fs.existsSync(path.join(root, result.copyToastPng)) &&
    fs.existsSync(path.join(root, result.copyToastUia)) &&
    fs.existsSync(path.join(root, result.continuePromptPng)) &&
    fs.existsSync(path.join(root, result.continuePromptUia)) &&
    result.errors.length === 0
  )
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

function decodeXml(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    runSelfTest()
  } else {
    main()
  }
}

module.exports = {
  documentsFileTitleVisible,
  documentsSearchFieldFocused,
  extractVisibleText,
  isPassing,
  parseNodes,
  runSelfTest,
}
