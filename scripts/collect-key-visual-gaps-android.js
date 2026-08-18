const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')
const {
  settingsKnowledgeSelfTestSchema,
  validateSettingsKnowledgeSelfTestResult,
} = require('./settings-knowledge-selftest-contract')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa', 'key-visual-gaps')
const outputPath = path.join(root, 'test-evidence', 'qa', 'key-visual-gaps-results.json')
const rawSelfTestOutputPath = path.join(root, 'test-evidence', 'qa', 'raw-settings-knowledge-selftest-results.json')
const appPackageName = defaultReleaseAppPackageName
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'dadaa813'
const knowledgeMemoryScope = 'knowledge-memory'
const sessionOptionsScope = 'session-options'
const sessionOptionsRequiredCaptureNames = Object.freeze([
  'home-session-options-start',
  'home-session-options-configuration-open',
  'home-session-options-panel',
])
const knowledgeMemoryRequiredCaptureNames = Object.freeze([
  'settings-context-selftest-dialog',
  'settings-context-selftest-result',
  'knowledge-delete-start',
  'knowledge-clear-confirm',
  'memory-delete-start',
  'memory-clear-confirm',
])
const contextSelfTestRequiredConfiguration = Object.freeze({
  memoryEnabled: true,
  knowledgeEnabled: true,
  ragMode: 'hybrid',
})
const contextCapabilitySpecs = Object.freeze({
  memoryEnabled: Object.freeze({
    route: 'islemind://settings/memory',
    captureKey: 'memory',
    labels: Object.freeze(['长期记忆', 'Long-term memory', '長期メモリ']),
  }),
  knowledgeEnabled: Object.freeze({
    route: 'islemind://settings/knowledge',
    captureKey: 'knowledge',
    labels: Object.freeze(['本机知识库', 'Local knowledge', 'ローカルナレッジ']),
  }),
})
const contextRagModeLabels = Object.freeze({
  hybrid: Object.freeze(['混合检索', 'Hybrid retrieval', 'ハイブリッド検索']),
  fts: Object.freeze(['仅 FTS', 'FTS only', 'FTS のみ']),
  off: Object.freeze(['关闭 RAG', 'RAG off', 'RAG オフ']),
})

if (require.main === module) main()

function main() {
  let options
  let previousResult = null
  try {
    options = parseCollectorOptions(process.argv.slice(2), {
      captureDestructiveDialogs: process.env.QA_CAPTURE_DESTRUCTIVE_DIALOGS === '1',
    })
    if (options.scope) previousResult = readRequiredExistingResult()
  } catch (error) {
    console.error(error?.message ?? String(error))
    process.exitCode = 1
    return
  }

  fs.mkdirSync(evidenceDir, { recursive: true })
  const device = resolveDevice(defaultDevice)
  const metadata = {
        generatedAt: new Date().toISOString(),
        device,
        packageName: appPackageName,
        options,
      }
  let result = options.scope === knowledgeMemoryScope
    ? createKnowledgeMemoryScopedResult(previousResult, metadata)
    : options.scope === sessionOptionsScope
    ? createSessionOptionsScopedResult(previousResult, metadata)
    : {
        generatedAt: new Date().toISOString(),
        device,
        packageName: appPackageName,
        options,
        captures: [],
        errors: [],
      }
  try {
    if (!device) throw new Error('No connected adb device was found.')

    if (options.scope === knowledgeMemoryScope) {
      captureKnowledgeKeyboard(device, result)
      captureSettingsContextSelfTest(device, result)
      captureKnowledgeMemoryDialogs(device, result)
    } else if (options.scope === sessionOptionsScope) {
      captureHomeSessionOptions(device, result)
    } else {
      captureAppShellStates(device, result)
      captureCleanBaselines(device, result)
      captureRouteAndHomeOverlays(device, result)
      captureKnowledgeKeyboard(device, result)
      captureSettingsContextSelfTest(device, result)
      if (options.captureDestructiveDialogs) captureKnowledgeMemoryDialogs(device, result)
    }
  } catch (error) {
    result.errors.push(error?.message ?? String(error))
  }

  result = options.scope === knowledgeMemoryScope
    ? finalizeKnowledgeMemoryScopedResult(result)
    : options.scope === sessionOptionsScope
    ? finalizeSessionOptionsScopedResult(result)
    : { ...result, passed: result.errors.length === 0 }
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(`${result.passed ? 'Key visual gaps capture passed' : 'Key visual gaps capture failed'}: ${relative(outputPath)}.`)
  if (!result.passed) {
    console.error(result.errors.join('; '))
    process.exitCode = 1
  }
}

function parseCollectorOptions(args = [], defaults = {}) {
  let scope = null
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--scope') {
      scope = args[index + 1] ?? null
      index += 1
    } else if (argument.startsWith('--scope=')) {
      scope = argument.slice('--scope='.length)
    } else {
      throw new Error(`Unknown key visual collector option: ${argument}`)
    }
  }
  if (args.some((argument) => argument === '--scope=')) throw new Error('Key visual collector --scope requires a value.')
  if (scope && scope !== knowledgeMemoryScope && scope !== sessionOptionsScope) {
    throw new Error(`Unsupported key visual collector scope: ${scope}`)
  }
  if (args.includes('--scope') && !scope) throw new Error('Key visual collector --scope requires a value.')
  return {
    scope,
    captureDestructiveDialogs: scope === knowledgeMemoryScope || defaults.captureDestructiveDialogs === true,
  }
}

function isSessionOptionsScopeCaptureName(name) {
  return sessionOptionsRequiredCaptureNames.includes(String(name ?? ''))
}

function readRequiredExistingResult() {
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Scoped key visual collection requires the existing global result at ${relative(outputPath)}.`)
  }
  let result
  try {
    result = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  } catch {
    throw new Error(`Scoped key visual collection could not parse the existing global result at ${relative(outputPath)}.`)
  }
  if (!result || typeof result !== 'object' || !Array.isArray(result.captures)) {
    throw new Error(`Scoped key visual collection requires a global result with a captures array at ${relative(outputPath)}.`)
  }
  if (!hasGlobalCaptureBaseline(result)) {
    throw new Error(`Scoped key visual collection requires an existing global capture baseline at ${relative(outputPath)}.`)
  }
  return result
}

function isKnowledgeMemoryScopeCaptureName(name) {
  const value = String(name ?? '')
  return value.startsWith('settings-knowledge-')
    || value.startsWith('settings-context-selftest-')
    || knowledgeMemoryRequiredCaptureNames.includes(value)
}

function hasGlobalCaptureBaseline(result) {
  return Array.isArray(result?.captures) && result.captures.some((capture) => (
    typeof capture?.name === 'string'
    && capture.name.length > 0
    && !isKnowledgeMemoryScopeCaptureName(capture.name)
  ))
}

function createInvalidScopedCapture(capture, name = capture?.name) {
  const issue = `${name} is stale until replaced by the current ${knowledgeMemoryScope} scoped collection.`
  return {
    ...(capture ?? {}),
    name,
    semanticPassed: false,
    semanticIssues: [...new Set([
      ...(Array.isArray(capture?.semanticIssues) ? capture.semanticIssues : []),
      issue,
    ])],
  }
}

function createKnowledgeMemoryScopedResult(previousResult, metadata) {
  if (!previousResult || typeof previousResult !== 'object' || !Array.isArray(previousResult.captures)) {
    throw new Error('Knowledge/Memory scoped collection requires an existing global result.')
  }
  if (!hasGlobalCaptureBaseline(previousResult)) {
    throw new Error('Knowledge/Memory scoped collection requires an existing global capture baseline.')
  }
  const {
    generatedAt: _generatedAt,
    device: _device,
    packageName: _packageName,
    options: _options,
    captures: previousCaptures,
    errors: previousErrors,
    retainedErrors: previousRetainedErrors,
    passed: _passed,
    contextSelfTestConfiguration: _contextSelfTestConfiguration,
    ...retained
  } = previousResult
  const captures = previousCaptures.map((capture) => (
    isKnowledgeMemoryScopeCaptureName(capture?.name)
      ? createInvalidScopedCapture(capture)
      : { ...capture }
  ))
  for (const name of knowledgeMemoryRequiredCaptureNames) {
    if (captures.some((capture) => capture?.name === name)) continue
    captures.push(createInvalidScopedCapture({
      name,
      png: null,
      uia: null,
      packageName: null,
      visibleText: [],
    }))
  }
  return {
    ...retained,
    generatedAt: metadata.generatedAt,
    device: metadata.device,
    packageName: metadata.packageName,
    options: { ...metadata.options, scope: knowledgeMemoryScope, captureDestructiveDialogs: true },
    captures,
    errors: [],
    retainedErrors: [...new Set([
      ...(Array.isArray(previousRetainedErrors) ? previousRetainedErrors : []),
      ...(Array.isArray(previousErrors) ? previousErrors : []),
    ])],
    passed: false,
  }
}

function createSessionOptionsScopedResult(previousResult, metadata) {
  if (!previousResult || typeof previousResult !== 'object' || !Array.isArray(previousResult.captures)) {
    throw new Error('Session-options scoped collection requires an existing global result.')
  }
  if (!hasGlobalCaptureBaseline(previousResult)) {
    throw new Error('Session-options scoped collection requires an existing global capture baseline.')
  }
  const {
    generatedAt: _generatedAt,
    device: _device,
    packageName: _packageName,
    options: _options,
    captures: previousCaptures,
    errors: previousErrors,
    retainedErrors: previousRetainedErrors,
    passed: _passed,
    ...retained
  } = previousResult
  const captures = previousCaptures.map((capture) => (
    isSessionOptionsScopeCaptureName(capture?.name)
      ? createInvalidScopedCapture(capture)
      : { ...capture }
  ))
  for (const name of sessionOptionsRequiredCaptureNames) {
    if (captures.some((capture) => capture?.name === name)) continue
    captures.push(createInvalidScopedCapture({
      name,
      png: null,
      uia: null,
      packageName: null,
      visibleText: [],
    }))
  }
  return {
    ...retained,
    generatedAt: metadata.generatedAt,
    device: metadata.device,
    packageName: metadata.packageName,
    options: { ...metadata.options, scope: sessionOptionsScope, captureDestructiveDialogs: false },
    captures,
    errors: [],
    retainedErrors: [...new Set([
      ...(Array.isArray(previousRetainedErrors) ? previousRetainedErrors : []),
      ...(Array.isArray(previousErrors) ? previousErrors : []),
    ])],
    passed: false,
  }
}

function finalizeKnowledgeMemoryScopedResult(input) {
  const captures = (Array.isArray(input?.captures) ? input.captures : []).map((capture) => ({ ...capture }))
  const errors = Array.isArray(input?.errors) ? [...input.errors] : []
  for (const name of knowledgeMemoryRequiredCaptureNames) {
    let index = captures.findIndex((capture) => capture?.name === name)
    if (index < 0) {
      captures.push(createInvalidScopedCapture({ name, png: null, uia: null, packageName: null, visibleText: [] }))
      index = captures.length - 1
    }
    const capture = captures[index]
    const issues = []
    if (!capture.png || !capture.uia) issues.push(`${name} does not have a fresh paired PNG/UIA capture.`)
    if (capture.packageName !== appPackageName) {
      issues.push(`${name} captured package ${JSON.stringify(capture.packageName ?? null)} instead of ${JSON.stringify(appPackageName)}.`)
    }
    if (capture.semanticPassed !== true || (Array.isArray(capture.semanticIssues) && capture.semanticIssues.length)) {
      issues.push(`${name} did not pass its current semantic assertion.`)
    }
    if (!issues.length) continue
    captures[index] = {
      ...capture,
      semanticPassed: false,
      semanticIssues: [...new Set([
        ...(Array.isArray(capture.semanticIssues) ? capture.semanticIssues : []),
        ...issues,
      ])],
    }
    errors.push(...issues)
  }
  const uniqueErrors = [...new Set(errors)]
  return {
    ...input,
    captures,
    errors: uniqueErrors,
    passed: uniqueErrors.length === 0,
  }
}

function finalizeSessionOptionsScopedResult(input) {
  const captures = (Array.isArray(input?.captures) ? input.captures : []).map((capture) => ({ ...capture }))
  const errors = Array.isArray(input?.errors) ? [...input.errors] : []
  for (const name of sessionOptionsRequiredCaptureNames) {
    let index = captures.findIndex((capture) => capture?.name === name)
    if (index < 0) {
      captures.push(createInvalidScopedCapture({ name, png: null, uia: null, packageName: null, visibleText: [] }))
      index = captures.length - 1
    }
    const capture = captures[index]
    const issues = []
    if (!capture.png || !capture.uia) issues.push(`${name} does not have a fresh paired PNG/UIA capture.`)
    if (capture.packageName !== appPackageName) {
      issues.push(`${name} captured package ${JSON.stringify(capture.packageName ?? null)} instead of ${JSON.stringify(appPackageName)}.`)
    }
    if (capture.semanticPassed !== true || (Array.isArray(capture.semanticIssues) && capture.semanticIssues.length)) {
      issues.push(`${name} did not pass its current semantic assertion.`)
    }
    if (!issues.length) continue
    captures[index] = {
      ...capture,
      semanticPassed: false,
      semanticIssues: [...new Set([
        ...(Array.isArray(capture.semanticIssues) ? capture.semanticIssues : []),
        ...issues,
      ])],
    }
    errors.push(...issues)
  }
  const uniqueErrors = [...new Set(errors)]
  return {
    ...input,
    captures,
    errors: uniqueErrors,
    passed: uniqueErrors.length === 0,
  }
}

function captureAppShellStates(device, result) {
  openForcedRoute(device, 'islemind://source?qaErrorBoundary=1&qaCapture=key-visual-gaps')
  captureAndAssertStable(device, result, 'app-shell-error-boundary', {
    packageName: appPackageName,
    includeAny: [
      ['页面暂时无法显示', 'This page cannot be shown', 'このページを表示できません'],
      ['错误编号', 'Error reference'],
    ],
  })
  openForcedRoute(device, 'islemind:///?qaUpdateNotice=QA')
  const update = captureAndAssert(device, result, 'app-shell-update-notice', {
    includeAny: [
      ['发现新版本', 'New version found', '新しいバージョンがあります'],
      ['发现新版 APK：QA', 'New APK found: QA', '新しい APK があります: QA'],
    ],
  })
  tapText(device, update.uiaText, ['我知道了', 'OK', '知道了', '关闭'])
  forceStopApp(device)
  sleep(700)
}

function captureCleanBaselines(device, result) {
  openUrl(device, 'islemind://')
  captureAndAssertStable(device, result, 'current-x86-clean-baseline-home', {
    includeAny: [
      ['会话消息列表', '开始一段新对话', 'Start a new conversation', 'Chat', 'Chats'],
      ['工具: 附件/知识', 'Tools: Files/Knowledge', 'ツール: 添付/知識'],
      ['输入消息', 'Message input', 'メッセージ入力'],
      ['发送消息', 'Send message', 'メッセージを送信'],
    ],
  })

  openUrl(device, 'islemind://settings')
  captureAndAssertStable(device, result, 'current-x86-clean-baseline-settings', {
    includeAny: [
      ['设置', 'Settings', '設定'],
      ['服务商', 'Providers', 'プロバイダー'],
    ],
  })

  openUrl(device, 'islemind://conversations')
  captureAndAssertStable(device, result, 'current-x86-clean-baseline-conversations', {
    includeAny: [
      ['搜索对话', 'Search conversations', '会話を検索'],
      ['新对话', 'New Chat', '新しいチャット'],
    ],
  })
}

function captureRouteAndHomeOverlays(device, result) {
  openUrl(device, 'islemind://chat/__qa_missing__')
  captureAndAssertStable(device, result, 'chat-invalid-route', {
    includeAny: [
      ['会话不可用', 'Chat unavailable', 'チャットを利用できません'],
      ['找不到这个会话', 'This chat was not found', 'このチャットは見つかりません'],
    ],
  })

  openUrl(device, 'islemind://')
  sleep(700)
  let home = captureStep(device, result, 'home-overlay-start')
  if (!tapText(device, home.uiaText, ['工具: 附件/知识', '工具', 'Tools', 'ツール'])) {
    result.errors.push('home-more-panel trigger was not tappable.')
  } else {
    sleep(700)
    let toolsPanel = captureAndAssertStable(device, result, 'home-more-panel-start', {
      includeAny: [
        ['模型', 'Model', 'モデル'],
        ['完成', 'Done', '完了'],
      ],
    })
    const modelTrigger = findHomeModelTriggerNode(toolsPanel.uiaText)
    if (!modelTrigger || !tapBoundsCenter(device, modelTrigger.bounds)) {
      result.errors.push('home-bottom-model-panel trigger was not tappable from the tools panel.')
    } else {
      sleep(900)
      const picker = captureAndAssertStable(device, result, 'home-bottom-model-panel', {
        includeAny: [
          ['供应商', 'Providers', 'プロバイダー'],
          ['模型', 'Model', 'モデル'],
        ],
      })
      back(device)
      sleep(500)
      openUrl(device, 'islemind://')
      sleep(700)
      const reopenedHome = captureStep(device, result, 'home-more-panel-reopen-start')
      if (!tapText(device, reopenedHome.uiaText, ['工具: 附件/知识', '工具', 'Tools', 'ツール'])) {
        result.errors.push('home-more-panel reopen trigger was not tappable after closing AI configuration.')
      }
      sleep(500)
    }

    toolsPanel = captureAndAssertStable(device, result, 'home-more-panel', {
      includeAny: [
        ['快捷操作', '输入工具', 'Quick actions', 'Input tools', 'クイック操作', '入力ツール'],
        ['选择工具，或点击空白处收起', '媒体工具会跟随当前模式/服务商', 'Pick a tool or tap outside', 'Media tools follow', 'ツールを選択するか、外側をタップして閉じます'],
      ],
    })
    if (!tapText(device, toolsPanel.uiaText, ['完成', 'Done', '完了'])) back(device)
    sleep(500)
  }

  captureHomeSessionOptions(device, result)
}

function captureHomeSessionOptions(device, result) {
  openColdRoute(device, 'islemind://chat/qa-mock-provider-live')
  const home = captureAndAssertStable(device, result, 'home-session-options-start', {
    packageName: appPackageName,
    includeAny: [
      ['会话消息', 'Conversation messages', '会話メッセージ'],
    ],
    excludeAny: [
      ['Tavern'],
      ['Agent'],
      ['会话不可用', 'Chat unavailable', 'チャットを利用できません'],
    ],
  }, { maxAttempts: 18, intervalMs: 700 })
  const configurationTrigger = findChatAiConfigurationTriggerNode(home.uiaText)
  if (!configurationTrigger || !tapBoundsCenter(device, configurationTrigger.bounds)) {
    captureStep(device, result, 'home-session-options-panel')
    const unavailableIssue = 'home-session-options-panel Chat header AI configuration trigger is unavailable on the direct Chat route.'
    const record = result.captures.find((item) => item.name === 'home-session-options-panel')
    if (record) {
      record.semanticPassed = false
      record.semanticIssues = [unavailableIssue]
    }
    result.errors.push(unavailableIssue)
    return
  }
  sleep(900)
  captureAndAssertStable(device, result, 'home-session-options-configuration-open', {
    packageName: appPackageName,
    includeAny: [
      ['供应商', 'Providers', 'プロバイダー'],
      ['模型', 'Model', 'モデル'],
    ],
  })
  captureAndAssert(device, result, 'home-session-options-panel', {
    packageName: appPackageName,
    includeAny: [
      ['供应商', 'Providers', 'プロバイダー'],
      ['模型', 'Model', 'モデル'],
    ],
  })
  back(device)
  sleep(500)
}

function findChatAiConfigurationTriggerNode(uiaText) {
  const exactLabels = ['切换模型', 'Switch model', 'モデルを切り替え', '快速模型', 'Quick model', 'クイックモデル']
  const prefixes = ['模型:', 'Model:', 'モデル:']
  return parseNodes(uiaText)
    .filter((node) => (
      node.enabled &&
      node.clickable &&
      isUsableBounds(node.bounds) &&
      (exactLabels.includes(node.contentDesc.trim()) || exactLabels.includes(node.text.trim()) || prefixes.some((prefix) => node.contentDesc.trimStart().startsWith(prefix)))
    ))
    .sort((a, b) => (b.bounds.right - b.bounds.left) - (a.bounds.right - a.bounds.left))[0] ?? null
}

function findHomeModelTriggerNode(uiaText) {
  const prefixes = ['模型:', 'Model:', 'モデル:']
  return parseNodes(uiaText)
    .filter((node) => (
      node.enabled &&
      node.clickable &&
      isUsableBounds(node.bounds) &&
      prefixes.some((prefix) => node.contentDesc.trimStart().startsWith(prefix) || node.text.trimStart().startsWith(prefix))
    ))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .sort((left, right) => boundsArea(right.bounds) - boundsArea(left.bounds))[0]?.node ?? null
}

function captureKnowledgeKeyboard(device, result) {
  openUrl(device, 'islemind://settings/knowledge')
  let knowledge = captureAndAssertStable(device, result, 'settings-knowledge-before-keyboard', {
    includeAny: [
      ['导入知识文件', 'Import knowledge file'],
      ['粘贴文本入库', 'Paste text into knowledge'],
    ],
    excludeAny: [
      ['Skills'],
      ['提示词、参数、知识源'],
    ],
  })
  if (!tapText(device, knowledge.uiaText, ['粘贴文本入库', 'Paste text into knowledge', '貼り付けテキストをナレッジ化'])) {
    result.errors.push('Knowledge paste-text disclosure was not tappable.')
  }
  sleep(600)
  knowledge = captureAndAssert(device, result, 'settings-knowledge-paste-expanded', {
    includeAny: [
      ['导入知识文件', 'Import knowledge file'],
      ['粘贴文本入库', 'Paste text into knowledge'],
      ['知识标题', 'Knowledge title', 'ナレッジタイトル'],
    ],
  })
  if (!tapEditableByNearbyLabel(device, knowledge.uiaText, ['知识正文', 'Body', '粘贴文本入库']) && !tapEditableAtIndex(device, knowledge.uiaText, 1)) {
    result.errors.push('Knowledge body field was not tappable.')
  }
  sleep(400)
  inputText(device, 'QA knowledge keyboard import body')
  sleep(700)
  captureAndAssertStable(device, result, 'settings-knowledge-body-keyboard-open', {
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

function captureSettingsContextSelfTest(device, result) {
  const configuration = createContextSelfTestConfigurationRecord()
  let summary = null
  let detailsCard = null
  let detailCaptures = []
  let steps = []
  try {
    const prepared = prepareContextSelfTestConfiguration(device, result)
    configuration.original = prepared.original
    configuration.applied = prepared.applied
    configuration.ready = prepared.ready
    if (!prepared.ready) {
      result.errors.push('Context self-test prerequisites could not be enabled.')
      return
    }

    openUrl(device, 'islemind://settings/context')
    let context = captureAndAssertStable(device, result, 'settings-context-selftest-entry', {
      includeAny: [
        ['上下文', 'Context', 'コンテキスト'],
        ['RAG 检索模式', 'RAG retrieval mode', 'RAG 検索モード'],
      ],
    })

    if (!hasAnyText(context.uiaText, ['运行上下文功能自检', 'Run context self-test', 'コンテキスト自己テストを実行'])) {
      if (!tapContextRagDisclosure(device, context.uiaText)) {
        result.errors.push('Context RAG retrieval disclosure was not tappable.')
      }
      context = captureAndAssertStable(device, result, 'settings-context-selftest-expanded', {
        includeAny: [
          ['运行上下文功能自检', 'Run context self-test', 'コンテキスト自己テストを実行'],
        ],
      }, { maxAttempts: 14 })
    }

    if (!tapTextAfterScrolling(device, result, context, 'settings-context-selftest-trigger', ['运行上下文功能自检', 'Run context self-test', 'コンテキスト自己テストを実行'])) {
      result.errors.push('Context self-test trigger was not tappable.')
      return
    }

    const notice = captureAndAssertStable(device, result, 'settings-context-selftest-dialog', {
      includeAny: [
        ['自检', 'self-test', '自己テスト'],
        ['通过', 'passed', '成功'],
        ['失败', 'failed', '失敗'],
      ],
    }, { maxAttempts: 24, intervalMs: 900 })
    summary = parseSelfTestSummary(notice.uiaText)
    if (summary) {
      summary.png = relative(notice.png)
      summary.uia = relative(notice.uia)
    }
    const dismissed = tapText(device, notice.uiaText, ['知道了', 'OK', '閉じる'])
    if (!dismissed) result.errors.push('Context self-test result notice was not dismissible.')
    sleep(500)

    detailsCard = captureAndAssertStable(device, result, 'settings-context-selftest-result', {
      includeAny: [
        ['最近自检', 'Last self-test', '直近の自己テスト'],
        ['详情', 'Details', '詳細'],
      ],
    }, { maxAttempts: 18, intervalMs: 800 })
    if (!tapText(device, detailsCard.uiaText, ['最近自检', 'Last self-test', '直近の自己テスト', '详情', 'Details', '詳細'])) {
      result.errors.push('Context self-test result details were not expandable.')
      return
    }
    sleep(500)

    detailCaptures = []
    const stepMap = new Map()
    let unchanged = 0
    for (let index = 0; index < 8; index += 1) {
      const capture = captureStep(device, result, `settings-context-selftest-details-${index}`)
      detailCaptures.push(capture)
      const before = stepMap.size
      for (const step of parseSelfTestSteps(capture.uiaText)) stepMap.set(step.name, step)
      unchanged = stepMap.size === before ? unchanged + 1 : 0
      const expectedTotal = summary && Number.isFinite(summary.total) ? summary.total : 0
      if ((expectedTotal && stepMap.size >= expectedTotal) || unchanged >= 2) break
      swipeUp(device)
      sleep(450)
    }
    steps = [...stepMap.values()]
  } finally {
    const restored = restoreContextSelfTestConfiguration(device, result, configuration.original)
    configuration.restored = restored.state
    configuration.restorationPassed = restored.ok
    if (!restored.ok) result.errors.push('Context self-test original configuration was not fully restored.')
    result.contextSelfTestConfiguration = configuration
    writeRawSelfTestResult(result, device, summary, detailsCard, detailCaptures, steps, configuration)
  }
}

function createContextSelfTestConfigurationRecord() {
  return {
    required: { ...contextSelfTestRequiredConfiguration },
    original: { memoryEnabled: null, knowledgeEnabled: null, ragMode: null },
    applied: { memoryEnabled: null, knowledgeEnabled: null, ragMode: null },
    restored: { memoryEnabled: null, knowledgeEnabled: null, ragMode: null },
    ready: false,
    restorationPassed: false,
  }
}

function createContextSelfTestConfigurationPlan(original) {
  if (!isContextSelfTestConfiguration(original)) return null
  const keys = ['memoryEnabled', 'knowledgeEnabled', 'ragMode']
  const apply = keys
    .filter((key) => original[key] !== contextSelfTestRequiredConfiguration[key])
    .map((key) => ({ key, value: contextSelfTestRequiredConfiguration[key] }))
  return {
    required: { ...contextSelfTestRequiredConfiguration },
    original: { ...original },
    apply,
    restore: createContextSelfTestRestorationPlan(original, contextSelfTestRequiredConfiguration),
  }
}

function createContextSelfTestRestorationPlan(original, current) {
  if (!isContextSelfTestConfiguration(original) || !current || typeof current !== 'object') return null
  return ['ragMode', 'knowledgeEnabled', 'memoryEnabled']
    .filter((key) => current[key] !== original[key])
    .map((key) => ({ key, value: original[key] }))
}

function isContextSelfTestConfiguration(value) {
  return Boolean(value)
    && typeof value.memoryEnabled === 'boolean'
    && typeof value.knowledgeEnabled === 'boolean'
    && ['hybrid', 'fts', 'off'].includes(value.ragMode)
}

function contextSelfTestConfigurationMatches(left, right) {
  return isContextSelfTestConfiguration(left)
    && isContextSelfTestConfiguration(right)
    && left.memoryEnabled === right.memoryEnabled
    && left.knowledgeEnabled === right.knowledgeEnabled
    && left.ragMode === right.ragMode
}

function prepareContextSelfTestConfiguration(device, result) {
  const original = observeContextSelfTestConfiguration(device, result, 'before')
  const plan = createContextSelfTestConfigurationPlan(original)
  const applied = { ...original }
  if (!plan) {
    result.errors.push('Context self-test configuration could not be read from enabled, checkable controls.')
    return { original, applied, ready: false }
  }
  for (const operation of plan.apply) {
    applied[operation.key] = applyContextSelfTestConfigurationValue(device, result, operation.key, operation.value, 'apply')
  }
  return {
    original,
    applied,
    ready: contextSelfTestConfigurationMatches(applied, plan.required),
  }
}

function restoreContextSelfTestConfiguration(device, result, original) {
  const outcome = restoreContextSelfTestConfigurationWithCallbacks(original, {
    observe: (phase) => observeContextSelfTestConfiguration(device, result, phase),
    apply: (operation) => applyContextSelfTestConfigurationValue(device, result, operation.key, operation.value, 'restore'),
  })
  if (!outcome.plan) {
    result.errors.push('Context self-test original configuration was not complete; restoration could not be proven.')
    return { state: outcome.finalState, ok: false }
  }
  return { state: outcome.finalState, ok: outcome.ok }
}

function restoreContextSelfTestConfigurationWithCallbacks(original, callbacks) {
  const state = callbacks.observe('restore-before')
  const plan = createContextSelfTestRestorationPlan(original, state)
  if (!plan) {
    return { state, finalState: state, plan: null, ok: false }
  }

  for (const operation of plan) callbacks.apply(operation)
  const finalState = callbacks.observe('restore-after')
  return {
    state,
    finalState,
    plan,
    ok: contextSelfTestConfigurationMatches(finalState, original),
  }
}

function observeContextSelfTestConfiguration(device, result, phase) {
  const memoryEnabled = observeContextCapability(device, result, 'memoryEnabled', phase)
  const knowledgeEnabled = observeContextCapability(device, result, 'knowledgeEnabled', phase)
  const ragMode = observeContextRagMode(device, result, phase)
  return { memoryEnabled, knowledgeEnabled, ragMode }
}

function observeContextCapability(device, result, key, phase) {
  const spec = contextCapabilitySpecs[key]
  openUrl(device, spec.route)
  sleep(700)
  const capture = captureAndAssertStable(device, result, `settings-context-selftest-config-${phase}-${spec.captureKey}`, {
    includeAny: [spec.labels],
  }, { maxAttempts: 14, intervalMs: 500 })
  const node = findContextCapabilityToggleNode(capture.uiaText, key)
  if (!node || !node.checkable || !isUsableBounds(node.bounds)) {
    result.errors.push(`Context self-test ${key} toggle was not a usable checkable control.`)
    return null
  }
  return node.checked
}

function applyContextSelfTestConfigurationValue(device, result, key, desired, phase) {
  if (key === 'ragMode') return setContextRagMode(device, result, desired, phase)
  const spec = contextCapabilitySpecs[key]
  openUrl(device, spec.route)
  sleep(700)
  let capture = captureAndAssertStable(device, result, `settings-context-selftest-config-${phase}-${spec.captureKey}`, {
    includeAny: [spec.labels],
  }, { maxAttempts: 14, intervalMs: 500 })
  let current = readContextCapabilityState(capture.uiaText, key)
  if (current === desired) return current
  const node = findContextCapabilityToggleNode(capture.uiaText, key)
  if (!node || !tapBoundsCenter(device, node.bounds)) {
    result.errors.push(`Context self-test ${key} toggle could not be tapped.`)
    return current
  }
  let consecutive = 0
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sleep(450)
    capture = captureStep(device, result, `settings-context-selftest-config-${phase}-${spec.captureKey}`)
    current = readContextCapabilityState(capture.uiaText, key)
    consecutive = current === desired ? consecutive + 1 : 0
    if (consecutive >= 2) return current
  }
  result.errors.push(`Context self-test ${key} toggle did not settle to ${String(desired)}.`)
  return current
}

function observeContextRagMode(device, result, phase) {
  const context = captureExpandedContextConfiguration(device, result, phase)
  const mode = readContextRagMode(context.uiaText)
  if (!mode) result.errors.push('Context self-test RAG mode selection was not readable.')
  return mode
}

function setContextRagMode(device, result, desired, phase) {
  if (!['hybrid', 'fts', 'off'].includes(desired)) {
    result.errors.push(`Context self-test RAG mode ${String(desired)} is invalid.`)
    return null
  }
  let context = captureExpandedContextConfiguration(device, result, phase)
  let current = readContextRagMode(context.uiaText)
  if (current === desired) return current
  const node = findContextRagModeNode(context.uiaText, desired)
  if (!node || !tapBoundsCenter(device, node.bounds)) {
    result.errors.push(`Context self-test RAG mode ${desired} was not tappable.`)
    return current
  }
  let consecutive = 0
  for (let attempt = 0; attempt < 10; attempt += 1) {
    sleep(450)
    context = captureStep(device, result, `settings-context-selftest-config-${phase}-rag`)
    current = readContextRagMode(context.uiaText)
    consecutive = current === desired ? consecutive + 1 : 0
    if (consecutive >= 2) return current
  }
  result.errors.push(`Context self-test RAG mode did not settle to ${desired}.`)
  return current
}

function captureExpandedContextConfiguration(device, result, phase) {
  openUrl(device, 'islemind://settings/context')
  let context = captureAndAssertStable(device, result, `settings-context-selftest-config-${phase}-entry`, {
    includeAny: [['上下文', 'Context', 'コンテキスト'], ['RAG 检索模式', 'RAG retrieval mode', 'RAG 検索モード']],
  }, { maxAttempts: 14, intervalMs: 500 })
  if (!findContextRagModeNode(context.uiaText, 'hybrid') && !findContextRagModeNode(context.uiaText, 'fts') && !findContextRagModeNode(context.uiaText, 'off')) {
    if (!tapContextRagDisclosure(device, context.uiaText)) {
      result.errors.push('Context self-test RAG retrieval disclosure was not tappable while reading configuration.')
      return context
    }
    context = captureAndAssertStable(device, result, `settings-context-selftest-config-${phase}-expanded`, {
      includeAny: [contextRagModeLabels.hybrid, contextRagModeLabels.fts, contextRagModeLabels.off],
    }, { maxAttempts: 14, intervalMs: 500 })
  }
  return context
}

function findContextCapabilityToggleNode(uiaText, key) {
  const labels = contextCapabilitySpecs[key]?.labels ?? []
  return parseNodes(uiaText)
    .filter((node) => (
      node.enabled &&
      node.clickable &&
      node.checkable &&
      isUsableBounds(node.bounds) &&
      labels.some((label) => node.contentDesc.trimStart().startsWith(label))
    ))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .sort((left, right) => boundsArea(right.bounds) - boundsArea(left.bounds))[0]?.node ?? null
}

function readContextCapabilityState(uiaText, key) {
  return findContextCapabilityToggleNode(uiaText, key)?.checked ?? null
}

function findContextRagModeNode(uiaText, mode) {
  const labels = contextRagModeLabels[mode] ?? []
  return parseNodes(uiaText)
    .filter((node) => (
      node.enabled &&
      node.clickable &&
      isUsableBounds(node.bounds) &&
      labels.some((label) => node.contentDesc === label || node.text === label)
    ))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .sort((left, right) => boundsArea(right.bounds) - boundsArea(left.bounds))[0]?.node ?? null
}

function readContextRagMode(uiaText) {
  for (const mode of ['hybrid', 'fts', 'off']) {
    const node = findContextRagModeNode(uiaText, mode)
    if (node?.selected) return mode
  }
  const disclosure = findContextRagDisclosureNode(uiaText)
  const value = `${disclosure?.contentDesc ?? ''} ${disclosure?.text ?? ''}`
  for (const mode of ['hybrid', 'fts', 'off']) {
    if ((contextRagModeLabels[mode] ?? []).some((label) => value.includes(label))) return mode
  }
  return null
}

function captureKnowledgeMemoryDialogs(device, result) {
  openUrl(device, 'islemind://settings/knowledge')
  sleep(1600)
  const knowledge = captureAndAssertStable(device, result, 'knowledge-delete-start', {
    includeAny: [
      ['知识库', 'Knowledge', 'ナレッジ'],
      ['本机知识库', 'Local knowledge', 'ローカルナレッジ'],
    ],
  })
  const knowledgeClear = findDestructiveClearNode(knowledge.uiaText, 'knowledge')
  if (knowledgeClear && tapBoundsCenter(device, knowledgeClear.bounds)) {
    sleep(600)
    captureAndAssertStable(device, result, 'knowledge-clear-confirm', {
      includeAny: [
        ['清空知识库', 'knowledge files', 'ナレッジ'],
        ['确认清空？', 'Clear everything?', '消去しますか？'],
        ['取消', 'Cancel', 'キャンセル'],
      ],
    })
    back(device)
    sleep(400)
  } else {
    result.errors.push('knowledge-clear-confirm trigger was not tappable.')
  }

  openUrl(device, 'islemind://settings/memory')
  sleep(1600)
  const memory = captureAndAssertStable(device, result, 'memory-delete-start', {
    includeAny: [
      ['记忆', 'Memory', 'memories'],
      ['长期记忆', 'Long-term memory'],
    ],
  })
  const memoryClear = findDestructiveClearNode(memory.uiaText, 'memory')
  if (memoryClear && tapBoundsCenter(device, memoryClear.bounds)) {
    sleep(600)
    captureAndAssertStable(device, result, 'memory-clear-confirm', {
      includeAny: [
        ['清空记忆', 'memories', '記憶'],
        ['确认清空？', 'Clear everything?', '消去しますか？'],
        ['取消', 'Cancel', 'キャンセル'],
      ],
    })
    back(device)
    sleep(400)
  } else {
    result.errors.push('memory-clear-confirm trigger was not tappable.')
  }
}

function findDestructiveClearNode(uiaText, kind) {
  const patterns = kind === 'knowledge'
    ? [/^清空知识库\s*\d+$/, /^Clear\s+\d+\s+knowledge files$/i, /^ナレッジ\s*\d+を消去$/]
    : kind === 'memory'
      ? [/^清空记忆\s*\d+$/, /^Clear\s+\d+\s+memories$/i, /^記憶\s*\d+を消去$/]
      : []
  return parseNodes(uiaText)
    .filter((node) => (
      node.enabled
      && node.clickable
      && isUsableBounds(node.bounds)
      && patterns.some((pattern) => pattern.test(node.contentDesc || node.text))
    ))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.node ?? null
}

function captureAndAssert(device, result, name, assertion) {
  const capture = captureStep(device, result, name)
  const issues = assertCaptureText(name, capture.uiaText, resolveCaptureAssertion(result, assertion))
  if (issues.length) {
    result.errors.push(...issues)
    const record = result.captures.find((item) => item.name === name)
    if (record) {
      record.semanticPassed = false
      record.semanticIssues = issues
    }
  } else {
    const record = result.captures.find((item) => item.name === name)
    if (record) {
      record.semanticPassed = true
      delete record.semanticIssues
    }
  }
  return capture
}

function captureAndAssertStable(device, result, name, assertion, options = {}) {
  const maxAttempts = options.maxAttempts ?? 12
  const intervalMs = options.intervalMs ?? 600
  let capture = null
  let consecutive = 0
  let issues = []
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    capture = captureStep(device, result, name)
    issues = assertCaptureText(name, capture.uiaText, resolveCaptureAssertion(result, assertion))
    if (issues.length === 0) consecutive += 1
    else consecutive = 0
    if (consecutive >= 2) break
    sleep(intervalMs)
  }
  const record = result.captures.find((item) => item.name === name)
  if (issues.length) {
    result.errors.push(...issues)
    if (record) {
      record.semanticPassed = false
      record.semanticIssues = issues
    }
  } else if (record) {
    record.semanticPassed = true
    delete record.semanticIssues
  }
  return capture ?? { png: null, uia: null, uiaText: '' }
}

function resolveCaptureAssertion(result, assertion = {}) {
  if (result?.options?.scope !== knowledgeMemoryScope) return assertion
  return { ...assertion, packageName: appPackageName }
}

function parseSelfTestSummary(uiaText) {
  const visible = extractVisibleText(uiaText)
  const summaryText = visible.find((value) => (
    /(?:通过|成功)\s*\d+/.test(value) && /(?:警告|warnings?|設定が必要)\s*\d+/i.test(value) && /(?:失败|失敗|failed)\s*\d+/i.test(value)
  )) ?? visible.find((value) => (
    /(?:passed|passed:)\s*\d+/i.test(value) && /warnings?\s*\d+/i.test(value) && /failed\s*\d+/i.test(value)
  )) ?? visible.find((value) => /\d+\s*passed/i.test(value) && /\d+\s*failed/i.test(value)) ?? ''
  const patterns = [
    /(?:通过|成功)\s*(\d+).*?(?:警告|warnings?|設定が必要)\s*(\d+).*?(?:失败|失敗|failed)\s*(\d+)/i,
    /passed\s*:?[ ]*(\d+).*?warnings?\s*:?[ ]*(\d+).*?failed\s*:?[ ]*(\d+)/i,
    /(\d+)\s*passed.*?(\d+)\s*warnings?.*?(\d+)\s*failed/i,
  ]
  let match = null
  for (const pattern of patterns) {
    match = summaryText.match(pattern)
    if (match) break
  }
  const passed = match ? Number(match[1]) : 0
  const warning = match ? Number(match[2]) : 0
  const failed = match ? Number(match[3]) : 0
  const title = visible.find((value) => /自检|self-test|自己テスト/i.test(value) && !/通过|成功|警告|失败|失敗|passed|failed/i.test(value)) ?? ''
  return {
    title,
    observedSummary: summaryText,
    passed,
    warning,
    failed,
    total: passed + warning + failed,
  }
}

function parseSelfTestSteps(uiaText) {
  const statuses = [
    { label: '通过', normalized: '通过' },
    { label: 'Passed', normalized: '通过' },
    { label: '成功', normalized: '通过' },
    { label: '需配置', normalized: '需配置' },
    { label: 'Needs config', normalized: '需配置' },
    { label: '設定が必要', normalized: '需配置' },
    { label: '失败', normalized: '失败' },
    { label: 'Failed', normalized: '失败' },
    { label: '失敗', normalized: '失败' },
  ]
  const steps = []
  for (const node of parseNodes(uiaText)) {
    const label = node.contentDesc
    if (!label) continue
    for (const status of statuses) {
      const delimiter = `. ${status.label}. `
      const index = label.indexOf(delimiter)
      if (index < 0) continue
      const rawName = label.slice(0, index).trim()
      const detail = label.slice(index + delimiter.length).trim()
      if (!rawName) break
      steps.push({
        name: normalizeSelfTestStepName(rawName),
        status: status.normalized,
        detail,
      })
      break
    }
  }
  return steps
}

function normalizeSelfTestStepName(name) {
  const value = String(name ?? '').trim()
  if (/联网搜索|web\s*search|web\s*検索|ウェブ検索|tavily.*(?:search|検索)/i.test(value)) return '联网搜索'
  return value
}

function writeRawSelfTestResult(result, device, summary, detailsCard, detailCaptures, steps = [], configuration = null) {
  const normalizedSteps = steps.map((step) => ({
    name: normalizeSelfTestStepName(step.name),
    status: step.status,
    ...(step.detail ? { detail: step.detail } : {}),
  }))
  const passed = summary?.passed ?? normalizedSteps.filter((step) => step.status === '通过').length
  const warning = summary?.warning ?? normalizedSteps.filter((step) => step.status === '需配置').length
  const failed = summary?.failed ?? normalizedSteps.filter((step) => step.status === '失败').length
  const raw = {
    schema: settingsKnowledgeSelfTestSchema,
    generatedAt: new Date().toISOString(),
    route: 'settings/context',
    device,
    ...(configuration ? { configuration } : {}),
    summaryDialog: {
      title: summary?.title || (failed ? '自检发现问题' : '自检完成'),
      summary: `通过 ${passed}，失败 ${failed}，需配置 ${warning}`,
      failed,
      ...(summary?.observedSummary ? { observedSummary: summary.observedSummary } : {}),
      ...(summary?.png ? { png: summary.png } : {}),
      ...(summary?.uia ? { uia: summary.uia } : {}),
    },
    steps: normalizedSteps,
    captures: {
      result: detailsCard ? { png: relativeOrNull(detailsCard.png), uia: relativeOrNull(detailsCard.uia) } : null,
      details: detailCaptures.map((capture) => ({ png: relativeOrNull(capture.png), uia: relativeOrNull(capture.uia) })),
    },
  }
  fs.mkdirSync(path.dirname(rawSelfTestOutputPath), { recursive: true })
  fs.writeFileSync(rawSelfTestOutputPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  const issues = validateSettingsKnowledgeSelfTestResult(raw)
  if (issues.length) result.errors.push(...issues.map((issue) => `Context self-test raw result: ${issue}`))
  return raw
}

function assertCaptureText(name, uiaText, assertion = {}) {
  const visible = extractVisibleText(uiaText)
  const haystack = visible.join('\n')
  const issues = []
  if (assertion.packageName) {
    const capturedPackage = readCapturePackage(uiaText)
    if (capturedPackage !== assertion.packageName) {
      issues.push(`${name} captured package ${JSON.stringify(capturedPackage || null)} instead of ${JSON.stringify(assertion.packageName)}`)
    }
  }
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

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function captureStep(device, result, name) {
  const png = path.join(evidenceDir, `${name}.png`)
  const uia = path.join(evidenceDir, `${name}.uia.xml`)
  const uniqueName = `${name}-${process.pid}-${Date.now()}`
  const remotePng = `/sdcard/Download/${uniqueName}.png`
  const remoteUia = `/sdcard/Download/${uniqueName}.uia.xml`
  let pngOk = false
  let uiaOk = false
  try {
    pngOk = captureFreshFile(device, remotePng, png, () => runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng]))
    uiaOk = captureFreshFile(device, remoteUia, uia, () => runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia]))
  } finally {
    cleanupRemoteFiles(device, [remotePng, remoteUia])
  }
  const uiaText = uiaOk && fs.existsSync(uia) ? fs.readFileSync(uia, 'utf8') : ''
  const record = {
    name,
    png: pngOk ? relative(png) : null,
    uia: uiaOk ? relative(uia) : null,
    packageName: readCapturePackage(uiaText),
    visibleText: extractVisibleText(uiaText),
  }
  const existingIndex = result.captures.findIndex((item) => item.name === name)
  if (existingIndex >= 0) result.captures[existingIndex] = record
  else result.captures.push(record)
  return { png: pngOk ? png : null, uia: uiaOk ? uia : null, uiaText }
}

function captureFreshFile(device, remotePath, localPath, captureRemote) {
  const stagingPath = `${localPath}.${process.pid}.${Date.now()}.tmp`
  try {
    const captured = captureRemote()
    const pulled = captured !== null
      && runCommand('adb', ['-s', device, 'pull', remotePath, stagingPath]) !== null
    if (!pulled || !fs.existsSync(stagingPath) || fs.statSync(stagingPath).size <= 0) return false
    fs.copyFileSync(stagingPath, localPath)
    return true
  } finally {
    fs.rmSync(stagingPath, { force: true })
  }
}

function cleanupRemoteFiles(device, remotePaths) {
  const paths = remotePaths.filter((value) => typeof value === 'string' && value.startsWith('/sdcard/Download/'))
  if (!paths.length) return
  runCommand('adb', ['-s', device, 'shell', 'rm', '-f', ...paths], { timeoutMs: 5000 })
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
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', shellQuote(url), '-p', appPackageName])
}

function openColdRoute(device, url) {
  runCommand('adb', [
    '-s', device,
    'shell',
    'am',
    'start',
    '-W',
    '-S',
    '-n',
    `${appPackageName}/.MainActivity`,
    '-a',
    'android.intent.action.VIEW',
    '-c',
    'android.intent.category.BROWSABLE',
    '-d',
    shellQuote(url),
  ])
  sleep(1200)
}

function openForcedRoute(device, url) {
  forceStopApp(device)
  sleep(700)
  openUrl(device, url)
  sleep(900)
  openUrl(device, url)
}

function back(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1640', '432', '480', '500'])
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

function tapTextAfterScrolling(device, result, initialCapture, captureName, labels, maxSwipes = 6) {
  if (tapText(device, initialCapture.uiaText, labels)) return true
  for (let attempt = 0; attempt < maxSwipes; attempt += 1) {
    swipeUp(device)
    sleep(450)
    const capture = captureStep(device, result, captureName)
    if (!tapText(device, capture.uiaText, labels)) continue
    const record = result.captures.find((item) => item.name === captureName)
    if (record) record.semanticPassed = true
    return true
  }
  return false
}

function tapContextRagDisclosure(device, uiaText) {
  const node = findContextRagDisclosureNode(uiaText)
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function findContextRagDisclosureNode(uiaText) {
  const prefixes = [
    'RAG 检索模式',
    'RAG retrieval mode',
    'RAG 検索モード',
  ]
  return parseNodes(uiaText)
    .filter((node) => (
      node.enabled &&
      node.clickable &&
      isUsableBounds(node.bounds) &&
      prefixes.some((prefix) => node.contentDesc.trimStart().startsWith(prefix))
    ))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .sort((left, right) => boundsArea(right.bounds) - boundsArea(left.bounds))[0]?.node ?? null
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

  const exactVisibleLabel = nodes.find((item) => (
    item.enabled &&
    isUsableBounds(item.bounds) &&
    labels.some((label) => item.text === label || item.contentDesc === label)
  ))
  const exactVisibleBounds = parseBounds(exactVisibleLabel?.bounds)
  if (exactVisibleBounds) {
    return clickable
      .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
      .filter(({ bounds }) => bounds && boundsContains(bounds, exactVisibleBounds))
      .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.item
      ?? exactVisibleLabel
  }

  const containingClickable = clickable
    .filter((item) => textMatchesAny(item, labels))
    .map((item) => ({ item, bounds: parseBounds(item.bounds) }))
    .sort((left, right) => boundsArea(left.bounds) - boundsArea(right.bounds))[0]?.item
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
      packageName: decodeXml(attr(attrs, 'package')),
      resourceId: decodeXml(attr(attrs, 'resource-id')),
      bounds: decodeXml(attr(attrs, 'bounds')),
      checkable: attr(attrs, 'checkable') === 'true',
      checked: attr(attrs, 'checked') === 'true',
      clickable: attr(attrs, 'clickable') === 'true',
      enabled: attr(attrs, 'enabled') !== 'false',
      selected: attr(attrs, 'selected') === 'true',
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

function readCapturePackage(uiaText) {
  return parseNodes(uiaText).find((node) => node.packageName)?.packageName ?? null
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

function runCommand(command, args, options = {}) {
  try {
    return execFileSync(resolveExecutableCommand(command), args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 30000,
      maxBuffer: 12 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

function resolveExecutableCommand(command, platform = process.platform) {
  return platform === 'win32' && command === 'adb' ? 'adb.exe' : command
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/')
}

function relativeOrNull(file) {
  return file ? relative(file) : null
}

module.exports = {
  assertCaptureText,
  createKnowledgeMemoryScopedResult,
  createSessionOptionsScopedResult,
  createContextSelfTestConfigurationPlan,
  createContextSelfTestRestorationPlan,
  finalizeKnowledgeMemoryScopedResult,
  finalizeSessionOptionsScopedResult,
  findContextCapabilityToggleNode,
  findContextRagDisclosureNode,
  findContextRagModeNode,
  findDestructiveClearNode,
  findChatAiConfigurationTriggerNode,
  findHomeModelTriggerNode,
  findTappableTextNode,
  hasGlobalCaptureBaseline,
  parseNodes,
  parseCollectorOptions,
  readContextCapabilityState,
  readCapturePackage,
  readContextRagMode,
  resolveExecutableCommand,
  parseSelfTestSummary,
  isKnowledgeMemoryScopeCaptureName,
  isSessionOptionsScopeCaptureName,
  knowledgeMemoryRequiredCaptureNames,
  resolveCaptureAssertion,
  restoreContextSelfTestConfigurationWithCallbacks,
  sessionOptionsRequiredCaptureNames,
}
