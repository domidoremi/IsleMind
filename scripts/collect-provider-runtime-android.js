const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { resolveApkArtifactPath, defaultReleaseSmokeArch, defaultReleaseSmokeVariant } = require('./release-artifact-contract')
const { cleanInstallState, defaultReleaseAppPackageName } = require('./release-validation-contract')
const { sensitiveEvidenceExtensions, sensitiveEvidencePatterns, collectSensitiveEvidenceHits, redactSensitiveEvidenceText } = require('./sensitive-evidence-contract')
const {
  providerRuntimeAndroidSchema,
  providerRuntimeAndroidEvidenceDirRelativePath,
  providerRuntimeAndroidResultRelativePath,
  providerRuntimeAndroidRunLogRelativePath,
  requiredProviderRuntimeAndroidScenarios,
  providerRuntimeActivationEvidencePaths,
  providerRuntimeRestartRecoveryEvidencePath,
  providerRuntimeRestartRecoveryConversationId,
  providerRuntimeRestartRecoveryVisibleEvidencePaths,
  validateProviderRuntimeAndroidEvidencePath,
  validateProviderRuntimeRestartRecoveryEvidence,
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
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const fixtureFileName = 'islemind-provider-runtime-android.json'
const remoteFixturePath = `/sdcard/Download/${fixtureFileName}`
const runtimeLogEvidence = path.join(root, providerRuntimeAndroidRunLogRelativePath)
const providerId = 'qa-provider-runtime-provider'
const providerName = 'QA Provider Runtime Provider'
const modelId = 'islemind-provider-runtime-chat'
const providerFailureRequestEvidence = path.join(smokeDir, 'provider-runtime-failure-requests.jsonl')
const recoveryConversationId = providerRuntimeRestartRecoveryConversationId
const recoveryRequestMarker = 'QA_PROVIDER_RUNTIME_RECOVERY_REQUEST'
const recoveryCompletionMarker = 'QA_PROVIDER_RUNTIME_RECOVERY_COMPLETE'
const contextDatabaseRemotePath = `/data/user/0/${appPackageName}/files/SQLite/islemind-context.db`
const restartRecoveryEvidence = path.join(root, providerRuntimeRestartRecoveryEvidencePath)
const providerFailureWorkerMode = 'provider-runtime-failure-server'

if (workerData?.mode === providerFailureWorkerMode || !isMainThread || Boolean(parentPort)) {
  runProviderFailureWorker()
} else {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest()
    process.exitCode = 0
    return
  }

  fs.mkdirSync(smokeDir, { recursive: true })
  const expected = readExpectedAppConfig()
  const apkPath = resolveApkPath(expected)
  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  const result = createBaseResult({
    deviceSerial: device,
    apkPath: relative(apkPath),
    packageName: appPackageName,
    expected,
  })

  let providerFailureServer = null
  try {
    if (!device) throw new Error('No connected adb device was found.')
    result.device = readDeviceState(device)
    result.installed = readInstalledPackageInfo(device)
    providerFailureServer = startProviderFailureServer(providerFailureRequestEvidence)
    if (!configureAdbReverse(device, providerFailureServer.port)) {
      throw new Error(`Could not configure adb reverse for provider failure fixture port ${providerFailureServer.port}.`)
    }
    writeFixture(device, `http://127.0.0.1:${providerFailureServer.port}/v1`)

    result.scenarios.push(runProviderSettingsRoute(device))
    result.scenarios.push(runProviderImportKeyboard(device))
    result.scenarios.push(runChatModelSwitch(device))
    result.scenarios.push(runBlockedModelRecovery(device))
    result.scenarios.push(runRuntimeFallbackTrace(device, providerFailureServer))
    result.scenarios.push(runProviderHealthState(device))
    result.scenarios.push(runAndroidBack(device))
    result.scenarios.push(runRestartRecovery(device, providerFailureServer))
    result.scenarios.push(runProviderActivation(device, providerFailureServer))
  } catch (error) {
    const errorMessage = sanitizeEvidenceText(error?.message ?? error)
    result.errors.push(errorMessage)
    for (const id of requiredProviderRuntimeAndroidScenarios) {
      if (!result.scenarios.some((scenario) => scenario.id === id)) {
        result.scenarios.push(failedScenario(id, 'Scenario was not executed.', errorMessage))
      }
    }
  } finally {
    if (device && providerFailureServer) clearAdbReverse(device, providerFailureServer.port)
    if (providerFailureServer) stopProviderFailureServer(providerFailureServer)
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
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  importRuntimeFixture(device, record)
  const capture = openUrlAndWaitForText(device, record, 'islemind://settings/providers', 'provider-runtime-settings-route', ['导入服务商', 'Import providers', '添加服务商', 'Add Provider'], 8, 1100)
  const ok = hasAnyText(capture.uiaText, ['供应商', 'Providers', 'プロバイダー'])
    && hasAnyText(capture.uiaText, ['导入服务商', 'Import providers', '批量导入', 'Batch Import', '添加服务商', 'Add Provider'])
    && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Providers route rendered.' : 'Providers route controls were not visible.')
}

function runProviderImportKeyboard(device) {
  const record = scenarioRecord('provider-import-keyboard', {
    expectedState: 'Provider batch import sheet keeps focused input and import action visible with the Android keyboard open.',
    fixEntry: 'src/components/providers/ProviderSettingsContent.tsx',
  })
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  let capture = openUrlAndWaitForText(device, record, 'islemind://settings/providers', 'provider-runtime-import-start', ['导入服务商', 'Import providers'], 8, 900)
  if (!tapExactContentDesc(device, capture.uiaText, ['导入服务商', 'Import providers'])) {
    return completeScenario(record, false, capture, 'Batch import action was not tappable.')
  }
  capture = waitForText(device, record, 'provider-runtime-import-sheet', ['https://api.example.com/v1'], 8, 700)
  if (!tapFirstEditable(device, capture.uiaText)) {
    return completeScenario(record, false, capture, 'Batch import input was not focusable.')
  }
  runCommand('adb', ['-s', device, 'shell', 'input', 'text', 'QA_PROVIDER_RUNTIME'])
  sleep(900)
  capture = captureStep(device, record, 'provider-runtime-import-keyboard')
  record.keyboardState = captureKeyboardState(device, 'provider-runtime-import-keyboard-state')
  const ok = hasEnabledClickableExactLabel(capture.uiaText, ['导入', 'Import'])
    && hasAnyText(capture.uiaText, ['QA_PROVIDER_RUNTIME'])
    && hasAnyText(capture.uiaText, ['批量导入', 'Batch Import'])
    && record.keyboardState.imeVisible === true
    && record.keyboardState.editableFocused === true
    && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Keyboard-open provider import was visible.' : 'Keyboard-open provider import state was not proven.')
}

function runProviderActivation(device, providerFailureServer) {
  const record = scenarioRecord('provider-activation', {
    expectedState: 'Enable All shows app-owned activation progress and a final ready result for the credential-bearing Provider Runtime fixture.',
    fixEntry: 'src/components/providers/ProviderSettingsContent.tsx',
  })
  record.activationEvidence = emptyProviderActivationEvidence()
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  fs.writeFileSync(providerFailureRequestEvidence, '', 'utf8')
  writeFixture(device, providerFailureServer.baseUrl, 'qa-placeholder-key')
  importRuntimeFixture(device, record)

  let capture = openUrlAndWaitForText(device, record, 'islemind://settings/providers', 'provider-activation-start', [providerName], 8, 850)
  if (!tapText(device, capture.uiaText, ['批量操作', 'Batch actions', '一括操作'])) {
    return completeScenario(record, false, capture, 'Provider activation Batch actions disclosure was not tappable.')
  }
  capture = waitForText(device, record, 'provider-activation-actions', ['启用所有', 'Enable All', 'すべて有効'], 6, 450)
  if (!hasEnabledClickableExactLabel(capture.uiaText, ['启用所有', 'Enable All', 'すべて有効'])) {
    return completeScenario(record, false, capture, 'Provider activation Enable All action was not enabled and clickable.')
  }
  if (!tapText(device, capture.uiaText, ['启用所有', 'Enable All', 'すべて有効'])) {
    return completeScenario(record, false, capture, 'Provider activation Enable All action was not tappable.')
  }

  const progressProbeText = waitForUiaText(device, 'provider-activation-progress-probe', ['正在启用供应商', 'Enabling providers', 'プロバイダーを有効化中'], 8, 200)
  const progress = captureStepUiaFirst(device, record, 'provider-activation-progress')
  const progressVisible = hasProviderActivationProgressEvidence(progress.uiaText)
  record.activationEvidence.progress = activationCaptureEvidence(progressVisible, progress, providerRuntimeActivationEvidencePaths.progress)
  if (!progressVisible) {
    return completeScenario(record, false, progress, `Provider activation progress semantics were not proven after probe=${hasProviderActivationProgressEvidence(progressProbeText)}.`)
  }

  const resultProbeText = waitForUiaText(device, 'provider-activation-result-probe', ['服务商启用完成', 'Provider enable complete', 'プロバイダー有効化完了'], 14, 250)
  const resultCapture = captureStepUiaFirst(device, record, 'provider-activation-result')
  const resultVisible = hasProviderActivationResultEvidence(resultCapture.uiaText)
  record.activationEvidence.result = activationCaptureEvidence(resultVisible, resultCapture, providerRuntimeActivationEvidencePaths.result)
  const requestReceived = readProviderFailureRequestEvidence().some((entry) => entry.method === 'GET' && entry.url === '/v1/models' && entry.status === 200)
  const ok = resultVisible && requestReceived && !hasErrorBoundary(resultCapture.uiaText)
  const actualState = ok
    ? 'Provider activation showed app-owned progress and completed 1/1 ready after a successful local model sync.'
    : `Provider activation result semantics=${resultVisible}; successful model request=${requestReceived}; result probe=${hasProviderActivationResultEvidence(resultProbeText)}.`
  return completeScenario(record, ok, resultCapture, actualState)
}

function runChatModelSwitch(device) {
  const record = scenarioRecord('chat-model-switch', {
    expectedState: 'Home chat model picker opens and exposes provider/model switching controls.',
    fixEntry: 'src/components/chat/ChatOptionsPanel.tsx',
  })
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  openUrl(device, 'islemind://')
  sleep(2200)
  let capture = captureStep(device, record, 'provider-runtime-home')
  capture = ensureChatTopBarVisible(device, record, capture, 'provider-runtime-home-topbar')
  const opened = tapText(device, capture.uiaText, ['模型和会话参数', 'Model and chat options'])
    || tapText(device, capture.uiaText, ['切换模型', 'Switch model'])
    || tapText(device, capture.uiaText, ['模型', 'Model'])
    || tapText(device, capture.uiaText, ['供应商', 'Providers'])
  if (opened) {
    capture = waitForText(device, record, 'provider-runtime-model-switch', ['搜索供应商或模型', 'Search providers or models', '供应商', 'Providers', '模型', 'Model'], 6, 650)
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
  let capture = captureStep(device, record, 'provider-runtime-blocked-model')
  capture = ensureChatTopBarVisible(device, record, capture, 'provider-runtime-blocked-model-topbar')
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

function runRuntimeFallbackTrace(device, providerFailureServer) {
  const record = scenarioRecord('runtime-fallback-trace', {
    expectedState: 'One provider request receives the deterministic HTTP failure and the resulting fallback decision is captured in runtime-log or Chat trace evidence without credential leakage.',
    fixEntry: 'src/bootstrap/providerRequestBinding.ts',
  })
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  const runtimeLogReadable = canReadAppPrivateFiles(device)
  if (runtimeLogReadable) clearRuntimeLog(device)
  fs.writeFileSync(providerFailureRequestEvidence, '', 'utf8')
  writeFixture(device, providerFailureServer.baseUrl, 'qa-placeholder-key')
  importRuntimeFixture(device, record)
  openUrl(device, `islemind://chat/${recoveryConversationId}`)
  sleep(2600)
  let capture = captureStep(device, record, 'provider-runtime-fallback-chat')
  const prompt = 'QA_PROVIDER_RUNTIME_FALLBACK'
  const focused = tapText(device, capture.uiaText, ['输入消息', 'Message input', '给 IsleMind 一个任务'])
    || tapFirstEditable(device, capture.uiaText)
  if (!focused) return completeScenario(record, false, capture, 'Provider runtime fallback chat composer was not focusable.')
  inputText(device, prompt)
  sleep(700)
  capture = captureStep(device, record, 'provider-runtime-fallback-entered')
  if (runtimeLogReadable) clearRuntimeLog(device)
  runCommand('adb', ['-s', device, 'shell', 'logcat', '-c'])
  const sent = tapText(device, capture.uiaText, ['发送消息', 'Send message'])
    || tapActionNearText(device, capture.uiaText, [prompt, '输入消息', 'Message input'], ['发送消息', 'Send message'])
    || tapBottomRight(device, capture.uiaText)
  if (!sent) return completeScenario(record, false, capture, 'Provider runtime fallback prompt could not be sent.')
  let runtimeEvidence = { text: '', privateText: '' }
  let requestReceived = false
  for (let attempt = 0; attempt < 12; attempt += 1) {
    sleep(700)
    requestReceived = readProviderFailureRequestEvidence().some((entry) => entry.method === 'POST' && entry.url === '/v1/chat/completions' && entry.status === 503)
    runtimeEvidence = collectRuntimeLogText(device, runtimeLogReadable)
    if (requestReceived && hasRuntimeFallbackEventEvidence(runtimeEvidence.privateText)) break
  }
  capture = captureStep(device, record, 'provider-runtime-fallback-result')
  const privateFallbackEvidence = hasRuntimeFallbackEventEvidence(runtimeEvidence.privateText)
  let fallbackEvidence = privateFallbackEvidence
    || hasRuntimeFallbackChatTraceEvidence(capture.uiaText)
    || hasRuntimeFallbackDiagnosticsEvidence(capture.uiaText)
  let fallbackEvidenceSource = privateFallbackEvidence ? 'app-private runtime log' : (fallbackEvidence ? 'Chat trace' : null)
  if (!fallbackEvidence && requestReceived) {
    openUrl(device, 'islemind://settings')
    sleep(1400)
    const diagnosticsStart = captureStep(device, record, 'provider-runtime-fallback-diagnostics')
    const diagnostics = openRuntimeDiagnostics(device, record, diagnosticsStart, 'provider-runtime-fallback', 12)
    capture = diagnostics.capture
    if (diagnostics.opened) {
      const found = findRuntimeFallbackDiagnosticsEvidence(device, record, capture, 14)
      capture = found.capture
      fallbackEvidence = found.matched
      if (fallbackEvidence) fallbackEvidenceSource = 'Runtime diagnostics request examples'
    }
  }
  const ok = requestReceived && fallbackEvidence && !hasErrorBoundary(capture.uiaText)
  const actualState = ok
    ? `Deterministic HTTP 503 provider request was received and fallback evidence was captured (${fallbackEvidenceSource}).`
    : `Provider request received=${requestReceived}; runtime fallback evidence captured=${fallbackEvidence}.`
  return completeScenario(record, ok, capture, actualState)
}

function runProviderHealthState(device) {
  const record = scenarioRecord('provider-health-state', {
    expectedState: 'Runtime diagnostics or Provider state exposes provider health without credential values.',
    fixEntry: 'src/components/main/SettingsScreenContent.tsx',
  })
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  let capture = openUrlAndWaitForText(device, record, 'islemind://settings', 'provider-runtime-health', ['供应商', 'Providers', 'AI 设置', 'AI settings'], 8, 900)
  const diagnostics = openRuntimeDiagnostics(device, record, capture, 'provider-runtime-health', 12)
  capture = diagnostics.capture
  const found = diagnostics.opened
    ? findProviderHealthDiagnosticsEvidence(device, record, capture, 14)
    : { matched: false, capture }
  capture = found.capture
  const ok = diagnostics.opened && found.matched && !hasErrorBoundary(capture.uiaText)
  return completeScenario(record, ok, capture, ok ? 'Provider health diagnostics were visible.' : 'Provider health state was not visible.')
}

function runAndroidBack(device) {
  const record = scenarioRecord('android-back', {
    expectedState: 'Android Back returns from Providers to Settings without error boundary.',
    fixEntry: 'app/_layout.tsx',
  })
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  const before = openUrlAndWaitForText(device, record, 'islemind://settings/providers', 'provider-runtime-android-back-before', ['导入服务商', 'Import providers', '添加服务商', 'Add Provider'], 8, 900)
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(1400)
  const after = captureStep(device, record, 'provider-runtime-android-back')
  const ok = hasAnyText(before.uiaText, ['供应商', 'Providers'])
    && hasAnyText(after.uiaText, ['设置', 'Settings', 'AI 工作区', 'AI workspace'])
    && !hasAnyText(after.uiaText, ['供应商不存在', 'Provider not found'])
    && !hasErrorBoundary(after.uiaText)
  return completeScenario(record, ok, after, ok ? 'Android Back returned to Settings.' : 'Android Back did not prove provider-to-settings recovery.')
}

function runRestartRecovery(device, providerFailureServer) {
  const record = scenarioRecord('restart-recovery', {
    expectedState: 'A known ordinary Chat request completes, survives force-stop with a linked terminal AssistantRun and journal entry, and restores its assistant response after relaunch.',
    fixEntry: 'src/modules/assistant-runtime/application/assistantRuntime.ts',
  })
  fs.rmSync(restartRecoveryEvidence, { force: true })
  writeFixture(device, providerFailureServer.baseUrl, 'qa-placeholder-key')
  importRuntimeFixture(device, record)
  let capture = openUrlAndWaitForText(device, record, `islemind://chat/${recoveryConversationId}`, 'provider-runtime-restart-chat', ['输入消息', 'Message input', '给 IsleMind 一个任务'], 8, 750)
  const focused = tapText(device, capture.uiaText, ['输入消息', 'Message input', '给 IsleMind 一个任务'])
    || tapFirstEditable(device, capture.uiaText)
  if (!focused) return completeScenario(record, false, capture, 'Restart recovery Chat composer was not focusable.')
  inputText(device, recoveryRequestMarker)
  sleep(650)
  capture = captureStep(device, record, 'provider-runtime-restart-request-entered')
  const sent = tapText(device, capture.uiaText, ['发送消息', 'Send message'])
    || tapActionNearText(device, capture.uiaText, [recoveryRequestMarker, '输入消息', 'Message input'], ['发送消息', 'Send message'])
    || tapBottomRight(device, capture.uiaText)
  if (!sent) return completeScenario(record, false, capture, 'Restart recovery fixture request could not be sent.')

  let completed = false
  let requestReceived = false
  for (let attempt = 0; attempt < 16; attempt += 1) {
    sleep(650)
    capture = captureStep(device, record, `provider-runtime-restart-complete-${attempt}`)
    requestReceived = readProviderFailureRequestEvidence().some((entry) => (
      entry.method === 'POST'
      && entry.url === '/v1/chat/completions'
      && entry.status === 200
      && entry.kind === 'restart-recovery'
    ))
    completed = requestReceived && hasAnyText(capture.uiaText, [recoveryCompletionMarker])
    if (completed || hasErrorBoundary(capture.uiaText)) break
  }
  if (!completed) {
    return completeScenario(record, false, capture, `Restart recovery fixture completion was not observed; request received=${requestReceived}.`)
  }

  let durableState = null
  let durableIssues = []
  let privateStorageInspectionUnavailable = false
  try {
    durableState = captureRestartRecoveryDurableState(device)
    writeRestartRecoveryDurableEvidence(durableState)
    record.restartRecoveryEvidence = durableState
      ? { proofKind: 'durable-linked-state', evidence: providerRuntimeRestartRecoveryEvidencePath, ...durableState }
      : null
    durableIssues = validateProviderRuntimeRestartRecoveryEvidence(record.restartRecoveryEvidence, {
      root,
      validatePath: validateRepositoryEvidencePath,
    })
  } catch (error) {
    const message = sanitizeEvidenceText(error?.message ?? error)
    privateStorageInspectionUnavailable = message.includes('durable restart proof requires a rooted or debuggable device')
    durableIssues = privateStorageInspectionUnavailable ? [] : [message]
  }

  openUrl(device, `islemind://chat/${recoveryConversationId}`)
  sleep(2600)
  capture = captureStep(device, record, 'provider-runtime-restart-restored')
  const restoredMessage = hasAnyText(capture.uiaText, [recoveryCompletionMarker])
  const restoredConversation = hasAnyText(capture.uiaText, [recoveryRequestMarker])
  if (privateStorageInspectionUnavailable) {
    record.restartRecoveryEvidence = {
      proofKind: 'visible-release-recovery',
      capturedAt: new Date().toISOString(),
      conversationId: recoveryConversationId,
      requestMatched: restoredConversation,
      responseMatched: restoredMessage,
      forceStopPerformed: true,
      relaunchPerformed: true,
      privateStorageInspection: 'unavailable-on-nondebuggable-release',
      ...providerRuntimeRestartRecoveryVisibleEvidencePaths,
    }
    durableIssues = validateProviderRuntimeRestartRecoveryEvidence(record.restartRecoveryEvidence, {
      root,
      validatePath: validateRepositoryEvidencePath,
    })
  }
  const ok = !durableIssues.length
    && restoredMessage
    && restoredConversation
    && !hasErrorBoundary(capture.uiaText)
  const actualState = ok
    ? privateStorageInspectionUnavailable
      ? 'Known ordinary Chat request and assistant response were restored after force-stop; private AssistantRun/journal inspection was unavailable on the non-debuggable release APK.'
      : 'Known ordinary Chat request, terminal AssistantRun/journal, and restored assistant response were proven after force-stop.'
    : `Restart recovery durable issues=${durableIssues.join(' | ') || 'none'}; restored request=${restoredConversation}; restored response=${restoredMessage}.`
  return completeScenario(record, ok, capture, actualState)
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
  const blockedReason = sanitizeEvidenceText(actualState)
  return {
    id,
    status: 'blocked',
    blockedReason,
    steps: [{ name: 'collector-start', actualState: blockedReason }],
    expectedState,
    actualState: blockedReason,
    fixEntry: 'scripts/collect-provider-runtime-android.js',
    png: null,
    uia: null,
    log: relative(runtimeLogEvidence),
    keyboardState: id === 'provider-import-keyboard' ? emptyKeyboardState() : undefined,
  }
}

function emptyProviderActivationEvidence() {
  return {
    progress: { visible: false, png: null, uia: null },
    result: { visible: false, png: null, uia: null },
  }
}

function activationCaptureEvidence(visible, capture, canonicalPaths = null) {
  return {
    visible,
    png: canonicalPaths?.png ?? capture?.png ?? null,
    uia: canonicalPaths?.uia ?? capture?.uia ?? null,
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

function captureRestartRecoveryDurableState(device) {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-provider-runtime-restart-'))
  const localDatabasePath = path.join(snapshotDir, 'islemind-context.db')
  try {
    if (runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName]) === null) {
      throw new Error('Could not force-stop the app before durable restart capture.')
    }
    sleep(900)
    const pulled = runCommand('adb', ['-s', device, 'pull', contextDatabaseRemotePath, localDatabasePath])
    if (pulled === null || !fs.existsSync(localDatabasePath)) {
      throw new Error(`Could not pull the release SQLite database from ${contextDatabaseRemotePath}; durable restart proof requires a rooted or debuggable device.`)
    }
    for (const suffix of ['-wal', '-shm']) {
      runCommand('adb', ['-s', device, 'pull', `${contextDatabaseRemotePath}${suffix}`, `${localDatabasePath}${suffix}`])
    }
    return readRestartRecoveryDurableState(localDatabasePath)
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true })
  }
}

function readRestartRecoveryDurableState(databasePath) {
  let Database
  try {
    ({ Database } = require('bun:sqlite'))
  } catch {
    throw new Error('Durable restart evidence requires the Bun runtime.')
  }
  const database = new Database(databasePath, { readonly: true })
  try {
    const run = database.query(`
      SELECT id, kind, conversationId, responseMessageId, providerId, model,
             status, completedAt, journalSequence, resultJson
      FROM assistant_runs
      WHERE conversationId = ? AND status = 'succeeded'
      ORDER BY createdAt DESC
      LIMIT 1
    `).get(recoveryConversationId)
    const journal = run
      ? database.query(`
          SELECT runId, sequence, type, occurredAt
          FROM assistant_run_journal
          WHERE runId = ?
          ORDER BY sequence ASC
        `).all(run.id)
      : []
    const conversationRow = database.query(
      'SELECT payloadJson FROM conversation_records WHERE id = ? LIMIT 1',
    ).get(recoveryConversationId)
    const conversation = tryParseJson(conversationRow?.payloadJson)
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : []
    const userMessage = [...messages].reverse().find((message) => (
      message?.role === 'user' && String(message.content ?? '').includes(recoveryRequestMarker)
    ))
    const assistantMessage = messages.find((message) => message?.id === run?.responseMessageId)
      ?? [...messages].reverse().find((message) => (
        message?.role === 'assistant' && String(message.content ?? '').includes(recoveryCompletionMarker)
      ))
    const result = tryParseJson(run?.resultJson)
    return {
      capturedAt: new Date().toISOString(),
      conversationId: recoveryConversationId,
      conversation: conversation ? { id: conversation.id ?? null } : null,
      userMessage: userMessage
        ? {
            id: userMessage.id ?? null,
            role: userMessage.role ?? null,
            contentMatched: String(userMessage.content ?? '').includes(recoveryRequestMarker),
          }
        : null,
      assistantMessage: assistantMessage
        ? {
            id: assistantMessage.id ?? null,
            role: assistantMessage.role ?? null,
            status: assistantMessage.status ?? null,
            contentMatched: String(assistantMessage.content ?? '').includes(recoveryCompletionMarker),
          }
        : null,
      run: run
        ? {
            id: run.id ?? null,
            kind: run.kind ?? null,
            conversationId: run.conversationId ?? null,
            responseMessageId: run.responseMessageId ?? null,
            providerId: run.providerId ?? null,
            model: run.model ?? null,
            status: run.status ?? null,
            completedAt: run.completedAt ?? null,
            journalSequence: run.journalSequence ?? null,
            outputMatched: String(result?.outputText ?? '').includes(recoveryCompletionMarker),
          }
        : null,
      journal: journal.map((entry) => ({
        runId: entry.runId,
        sequence: entry.sequence,
        type: entry.type,
        occurredAt: entry.occurredAt,
      })),
    }
  } finally {
    database.close()
  }
}

function writeRestartRecoveryDurableEvidence(durableState) {
  fs.writeFileSync(restartRecoveryEvidence, `${JSON.stringify(durableState, null, 2)}\n`, 'utf8')
  sanitizePersistedTextEvidence(restartRecoveryEvidence)
}

function writeFixture(device, providerBaseUrl, apiKey = '') {
  const fixturePath = path.join(smokeDir, fixtureFileName)
  const now = 1772100000000
  const fixture = {
    app: 'islemind',
    version: 1,
    exportedAt: Date.now(),
    settings: {
      language: 'zh-CN',
      runtimeLogEnabled: true,
      defaultProvider: providerId,
      defaultTemperature: 0.7,
      defaultMaxTokens: 4096,
      memoryEnabled: false,
      knowledgeEnabled: false,
      webSearchEnabled: false,
      mcpEnabled: false,
      providerCatalogVersion: 1,
      providerAllowlist: [],
      providerBlocklist: [],
      modelAllowlist: [],
      modelBlocklist: [],
    },
    conversations: [
      {
        id: recoveryConversationId,
        title: 'QA Provider Runtime Recovery',
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
    providers: [
      {
        id: providerId,
        type: 'openai-compatible',
        presetId: 'custom-endpoint',
        detectedPresetId: 'custom-endpoint',
        wireProtocol: 'openai-compatible',
        detectionStatus: 'manual',
        name: providerName,
        apiKey,
        baseUrl: providerBaseUrl,
        models: [modelId],
        manualModels: [modelId],
        modelAliases: [],
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
        credentialGroups: apiKey
          ? [{ id: 'qa-placeholder-group', label: 'QA placeholder', apiKey, enabled: true, availableModels: [modelId] }]
          : [],
        enabled: true,
        lastTestStatus: 'idle',
        lastModelSyncStatus: 'idle',
      },
    ],
    skills: [],
    mcpServers: [],
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  if (runCommand('adb', ['-s', device, 'push', fixturePath, remoteFixturePath]) !== null) {
    runCommand('adb', ['-s', device, 'shell', 'touch', remoteFixturePath])
    runCommand('adb', ['-s', device, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${remoteFixturePath}`])
  }
}

function importRuntimeFixture(device, record) {
  openUrl(device, 'islemind://settings')
  sleep(2200)
  ensureSettingsVisible(device, record)
  const pickerStart = tapSettingsImportJson(device, record)
  const importDialog = hasAnyText(pickerStart.uiaText, ['导入完成', 'Import complete'])
    ? pickerStart
    : selectFixtureFileAndCaptureImportDialog(device, record)
  if (hasAnyText(importDialog.uiaText, ['导入完成', 'Import complete'])) {
    tapText(device, importDialog.uiaText, ['知道了', '我知道了', 'OK', 'Close'])
    sleep(900)
    return
  }
  runCommand('adb', ['-s', device, 'shell', 'am', 'force-stop', appPackageName])
  sleep(600)
  openUrl(device, 'islemind://settings/providers')
  sleep(2200)
  const importedState = captureStep(device, record, 'provider-runtime-import-state')
  if (!hasAnyText(importedState.uiaText, [providerName])) {
    throw new Error('Provider Runtime fixture import was not confirmed by dialog or provider state.')
  }
}

function ensureSettingsVisible(device, record) {
  let capture = captureStep(device, record, 'provider-runtime-import-settings-start')
  if (hasAnyText(capture.uiaText, ['导入 JSON', 'AI 工作区就绪度', '导入 / 导出', 'Import JSON'])) return capture
  return capture
}

function tapSettingsImportJson(device, record) {
  for (let index = 0; index < 8; index += 1) {
    let capture = captureStep(device, record, `provider-runtime-import-search-${index}`)
    let importTapped = tapText(device, capture.uiaText, ['导入 JSON', 'Import JSON', 'JSON インポート'])
    if (!importTapped && tapText(device, capture.uiaText, ['导入 / 导出', 'Import / Export', 'インポート / エクスポート'])) {
      sleep(900)
      capture = captureStep(device, record, `provider-runtime-import-expanded-${index}`)
      importTapped = tapText(device, capture.uiaText, ['导入 JSON', 'Import JSON', 'JSON インポート'])
    }
    if (importTapped) {
      sleep(1700)
      const afterTap = captureStep(device, record, `provider-runtime-import-after-tap-${index}`)
      if (isDocumentsUi(afterTap.uiaText) || hasAnyText(afterTap.uiaText, ['导入完成', 'Import complete'])) return afterTap
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the Settings import JSON action for Provider Runtime fixture.')
}

function selectFixtureFileAndCaptureImportDialog(device, record) {
  let searched = false
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, record, `provider-runtime-file-picker-search-${index}`)
    if (hasAnyText(capture.uiaText, ['导入完成', 'Import complete'])) return capture
    if (!isDocumentsUi(capture.uiaText) && tapText(device, capture.uiaText, ['导入 JSON', 'Import JSON'])) {
      sleep(1700)
      continue
    }
    if (tapFileTitle(device, capture.uiaText, fixtureFileName)) {
      sleep(2200)
      return captureStep(device, record, 'provider-runtime-import-confirm')
    }
    if (!searched && isDocumentsUi(capture.uiaText)) {
      searched = true
      const searchedCapture = searchDocumentsUiFile(device, record, fixtureFileName)
      if (searchedCapture) return searchedCapture
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the Provider Runtime fixture in Android DocumentsUI.')
}

function searchDocumentsUiFile(device, record, fileName) {
  let capture = captureStep(device, record, 'provider-runtime-file-picker-search-open')
  if (!tapText(device, capture.uiaText, ['Search', '搜索', '検索'])) return null
  sleep(700)
  capture = captureStep(device, record, 'provider-runtime-file-picker-search-field')
  tapFirstEditable(device, capture.uiaText)
  sleep(300)
  inputText(device, fileName)
  sleep(1400)
  capture = captureStep(device, record, 'provider-runtime-file-picker-search-result')
  if (!tapFileTitle(device, capture.uiaText, fileName)) return null
  sleep(2200)
  return captureStep(device, record, 'provider-runtime-import-confirm')
}

function openUrl(device, url) {
  runCommand('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url])
}

function openUrlAndWaitForText(device, record, url, name, labels, maxAttempts = 6, delayMs = 800) {
  openUrl(device, url)
  sleep(delayMs)
  return waitForText(device, record, name, labels, maxAttempts, delayMs)
}

function waitForText(device, record, name, labels, maxAttempts = 6, delayMs = 800) {
  let capture = captureStep(device, record, name)
  if (hasAnyText(capture.uiaText, labels) || hasErrorBoundary(capture.uiaText)) return capture
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
    sleep(delayMs)
    capture = captureStep(device, record, `${name}-wait-${attempt}`)
    if (hasAnyText(capture.uiaText, labels) || hasErrorBoundary(capture.uiaText)) return capture
  }
  return capture
}

function waitForUiaText(device, name, labels, maxAttempts = 6, delayMs = 250) {
  let uiaText = ''
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    uiaText = captureUiaProbe(device, `${name}-${attempt}`)
    if (hasAnyText(uiaText, labels) || hasErrorBoundary(uiaText)) return uiaText
    if (attempt + 1 < maxAttempts) sleep(delayMs)
  }
  return uiaText
}

function captureUiaProbe(device, name) {
  const localUia = path.join(smokeDir, `.${name}-${process.pid}.uia.tmp`)
  const remoteUia = `/sdcard/${name}-${Date.now()}.uia.xml`
  try {
    captureFileWithRetry(device, remoteUia, localUia, () => {
      runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
    })
    return fs.existsSync(localUia) ? sanitizePersistedTextEvidence(localUia) : ''
  } finally {
    fs.rmSync(localUia, { force: true })
  }
}

function captureStep(device, record, name) {
  return captureStepWithOrder(device, record, name, false)
}

function captureStepUiaFirst(device, record, name) {
  return captureStepWithOrder(device, record, name, true)
}

function captureStepWithOrder(device, record, name, uiaFirst) {
  const png = path.join(smokeDir, `${name}.png`)
  const uia = path.join(smokeDir, `${name}.uia.xml`)
  const uniqueName = `${name}-${Date.now()}`
  const remotePng = `/sdcard/${uniqueName}.png`
  const remoteUia = `/sdcard/${uniqueName}.uia.xml`
  const capturePng = () => captureFileWithRetry(device, remotePng, png, () => {
    runCommand('adb', ['-s', device, 'shell', 'screencap', '-p', remotePng])
  })
  const captureUia = () => captureFileWithRetry(device, remoteUia, uia, () => {
    runCommand('adb', ['-s', device, 'shell', 'uiautomator', 'dump', remoteUia])
  })
  if (uiaFirst) {
    captureUia()
    capturePng()
  } else {
    capturePng()
    captureUia()
  }
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

function openRuntimeDiagnostics(device, record, initialCapture, capturePrefix, maxScrolls = 12) {
  const advanced = openDisclosureByScrolling(
    device,
    record,
    initialCapture,
    ['高级接口设置', 'Advanced interface settings', '詳細インターフェース設定'],
    `${capturePrefix}-advanced`,
    maxScrolls
  )
  if (!advanced.opened) return advanced

  const diagnostics = openDisclosureByScrolling(
    device,
    record,
    advanced.capture,
    ['运行时诊断', 'Runtime diagnostics', '実行診断'],
    `${capturePrefix}-runtime-diagnostics`,
    maxScrolls
  )
  if (!diagnostics.opened) return diagnostics

  return openDisclosureByScrolling(
    device,
    record,
    diagnostics.capture,
    ['诊断明细', 'Diagnostic details', '診断詳細'],
    `${capturePrefix}-details`,
    maxScrolls
  )
}

function openDisclosureByScrolling(device, record, initialCapture, labels, capturePrefix, maxScrolls) {
  let capture = initialCapture
  for (let index = 0; index <= maxScrolls; index += 1) {
    if (hasExpandedDisclosure(capture.uiaText, labels)) return { opened: true, capture }
    if (tapText(device, capture.uiaText, labels)) {
      sleep(900)
      capture = captureStep(device, record, `${capturePrefix}-opened`)
      if (hasExpandedDisclosure(capture.uiaText, labels)) return { opened: true, capture }
    }
    if (index === maxScrolls) break
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, record, `${capturePrefix}-scroll-${index}`)
  }
  return { opened: false, capture }
}

function hasExpandedDisclosure(uiaText, labels) {
  const nodes = parseNodes(uiaText)
  return labels.some((label) => nodes.some((node) => (
    node.contentDesc.includes(label)
      && /(?:collapse|收起|折叠|折りたた)/i.test(node.contentDesc)
  )))
}

function findRuntimeFallbackDiagnosticsEvidence(device, record, initialCapture, maxScrolls) {
  let capture = initialCapture
  for (let index = 0; index <= maxScrolls; index += 1) {
    if (hasRuntimeFallbackDiagnosticsEvidence(capture.uiaText)) return { matched: true, capture }
    if (index === maxScrolls) break
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, record, `${record.id}-request-examples-${index}`)
  }
  return { matched: false, capture }
}

function findProviderHealthDiagnosticsEvidence(device, record, initialCapture, maxScrolls) {
  let capture = initialCapture
  for (let index = 0; index <= maxScrolls; index += 1) {
    if (hasProviderHealthDiagnosticsEvidence(capture.uiaText)) return { matched: true, capture }
    if (index === maxScrolls) break
    swipeUp(device)
    sleep(450)
    capture = captureStep(device, record, `${record.id}-diagnostic-details-${index}`)
  }
  return { matched: false, capture }
}

function tapText(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  for (const label of labels) {
    const node = findTappableTextNode(nodes, label)
    if (!node) continue
    return tapBoundsCenter(device, node.bounds)
  }
  return false
}

function tapActionNearText(device, uiaText, anchorLabels, actionLabels) {
  const nodes = parseNodes(uiaText)
  const anchor = nodes.find((node) => anchorLabels.some((label) => textMatches(node, label)))
  const anchorBounds = parseBounds(anchor?.bounds)
  const candidates = []
  for (const label of actionLabels) {
    for (const node of nodes.filter((item) => item.enabled && textMatches(item, label))) {
      const bounds = parseBounds(node.bounds)
      if (!bounds || (anchorBounds && bounds.top < anchorBounds.top - 20)) continue
      candidates.push({ node, bounds })
    }
  }
  candidates.sort((left, right) => anchorBounds
    ? Math.abs(left.bounds.top - anchorBounds.top) - Math.abs(right.bounds.top - anchorBounds.top)
    : left.bounds.top - right.bounds.top)
  const candidate = candidates[0]?.node
  if (!candidate) return false
  tapBoundsCenter(device, candidate.bounds)
  return true
}

function tapExactContentDesc(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  for (const label of labels) {
    const node = nodes.find((item) => item.enabled && item.clickable && item.contentDesc === label)
    if (!node) continue
    tapBoundsCenter(device, node.bounds)
    return true
  }
  return false
}

function hasEnabledClickableExactLabel(uiaText, labels) {
  return parseNodes(uiaText).some((item) => (
    item.enabled
    && item.clickable
    && labels.some((label) => item.text === label || item.contentDesc === label)
  ))
}

function tapTextUpperHalf(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  for (const label of labels) {
    const node = findTappableTextNode(nodes, label)
    if (!node) continue
    tapBoundsAt(device, node.bounds, 0.5, 0.16)
    return true
  }
  return false
}

function tapFirstEditable(device, uiaText) {
  const node = parseNodes(uiaText).find((item) => item.enabled && item.className.includes('EditText'))
  if (!node) return false
  return tapBoundsCenter(device, node.bounds)
}

function ensureChatTopBarVisible(device, record, capture, captureName) {
  if (!hasAnyText(capture.uiaText, ['显示顶部栏', 'Show top bar'])) return capture
  if (!tapText(device, capture.uiaText, ['显示顶部栏', 'Show top bar'])) return capture
  sleep(900)
  return captureStep(device, record, captureName)
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
      packageName: decodeXml(matchFirst(tag, /package="([^"]*)"/) ?? ''),
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
  return tapBoundsAt(device, bounds, 0.5, 0.5)
}

function tapBottomRight(device, uiaText) {
  const nodes = parseNodes(uiaText)
  for (const label of ['发送消息', 'Send message', 'メッセージを送信']) {
    const node = findTappableTextNode(nodes, label)
    if (node) return tapBoundsCenter(device, node.bounds)
  }
  return false
}

function tapBoundsAt(device, bounds, xRatio, yRatio) {
  const box = parseBounds(bounds)
  if (!box) return false
  const x = Math.round(box.left + (box.right - box.left) * xRatio)
  const y = Math.round(box.top + (box.bottom - box.top) * yRatio)
  return runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(x), String(y)]) !== null
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
  const previewBounds = parseBounds(previewNode?.bounds)
  if (!previewBounds) return false
  runCommand('adb', [
    '-s',
    device,
    'shell',
    'input',
    'tap',
    String(Math.max(1, previewBounds.left - 80)),
    String(Math.round((previewBounds.top + previewBounds.bottom) / 2)),
  ])
  return true
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

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '620', '450'])
}

function hasAnyText(text, values) {
  return values.some((value) => text.includes(value))
}

function hasErrorBoundary(uiaText) {
  return hasAnyText(uiaText, ['页面暂时无法显示', 'Page is unavailable', 'Render Error', 'ReferenceError', 'TypeError'])
}

function hasRuntimeFallbackChatTraceEvidence(uiaText) {
  const exactTitles = new Set(['Runtime fallback', '运行时兜底', 'ランタイムフォールバック'])
  return extractVisibleText(uiaText).some((value) => exactTitles.has(value.trim()))
}

function hasRuntimeFallbackEventEvidence(logText) {
  return /"event"\s*:\s*"(?:provider\.fallback\.decided|fallback\.decision)"/i.test(String(logText ?? ''))
}

function hasRuntimeFallbackDiagnosticsEvidence(uiaText) {
  return hasAnyText(uiaText, ['Request examples', '请求样本', 'リクエスト例'])
    && hasAnyText(uiaText, ['fallback', '回退', 'フォールバック'])
    && hasAnyText(uiaText, [providerId, modelId])
}

function hasProviderHealthDiagnosticsEvidence(uiaText) {
  return hasAnyText(uiaText, ['Provider health', '供应商健康', 'プロバイダー状態'])
    && hasAnyText(uiaText, ['cooldown', '冷却', 'クールダウン'])
    && hasAnyText(uiaText, ['credential', '凭据', '認証'])
}

function hasProviderActivationProgressEvidence(uiaText) {
  return hasAppOwnedAnyText(uiaText, ['正在启用供应商', 'Enabling providers', 'プロバイダーを有効化中'])
    && hasAppOwnedAnyText(uiaText, [providerName])
    && hasAppOwnedAnyText(uiaText, ['0/1'])
    && !hasErrorBoundary(uiaText)
}

function hasProviderActivationResultEvidence(uiaText) {
  const completionBanner = hasAppOwnedAnyText(uiaText, ['服务商启用完成', 'Provider enable complete', 'プロバイダー有効化完了'])
    && hasAppOwnedAnyText(uiaText, [`${providerName} 已可用`, `${providerName} is ready`, `${providerName} は利用可能です`, '服务商已启用', 'Provider enabled', 'プロバイダーが有効になりました'])
    && hasAppOwnedAnyText(uiaText, ['1/1'])
  const readyProviderCard = hasAppOwnedAnyText(uiaText, [providerName])
    && hasAppOwnedAnyText(uiaText, ['已同步可用', 'Synced and ready', '同期済み・利用可能'])
    && hasAppOwnedAnyText(uiaText, ['1 个模型', '1 model', '1 モデル'])
    && hasAppOwnedAnyText(uiaText, ['1 组令牌', '1 credential group', '1 認証グループ'])
  return (completionBanner || readyProviderCard) && !hasErrorBoundary(uiaText)
}

function hasAppOwnedAnyText(uiaText, labels) {
  return parseNodes(uiaText).some((node) => (
    node.packageName === appPackageName
    && labels.some((label) => textMatches(node, label))
  ))
}

function isDocumentsUi(uiaText) {
  return hasAnyText(uiaText, [
    'com.google.android.documentsui',
    'com.android.documentsui',
    'Recent',
    '最近',
    'Search',
    '搜索',
    '検索',
  ])
}

function collectRuntimeLogText(device, runtimeLogReadable = true) {
  const privateLog = readRuntimeLogWithRetry(device, runtimeLogReadable, 1)
  const logcat = runCommand('adb', ['-s', device, 'logcat', '-d', '-v', 'time', '-t', '600']) ?? ''
  const logcatLines = logcat
    .split(/\r?\n/)
    .filter((line) => line.includes(appPackageName) || /fallback|runtime|provider|ReactNativeJS/i.test(line))
    .slice(-200)
    .map(sanitizeEvidenceText)
  const text = [sanitizeEvidenceText(privateLog).trim(), logcatLines.join('\n')].filter(Boolean).join('\n')
  fs.writeFileSync(runtimeLogEvidence, `${text}\n`, 'utf8')
  return { text, privateText: sanitizeEvidenceText(privateLog).trim() }
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

function createRestartRecoveryEvidenceFixture() {
  return {
    evidence: providerRuntimeRestartRecoveryEvidencePath,
    capturedAt: '2026-07-21T00:00:00.000Z',
    conversationId: recoveryConversationId,
    conversation: { id: recoveryConversationId },
    userMessage: {
      id: 'restart-user-self-test',
      role: 'user',
      contentMatched: true,
    },
    assistantMessage: {
      id: 'restart-assistant-self-test',
      role: 'assistant',
      status: 'done',
      contentMatched: true,
    },
    run: {
      id: 'restart-run-self-test',
      kind: 'chat',
      conversationId: recoveryConversationId,
      responseMessageId: 'restart-assistant-self-test',
      providerId,
      model: modelId,
      status: 'succeeded',
      completedAt: 1776643200000,
      journalSequence: 4,
      outputMatched: true,
    },
    journal: [{ runId: 'restart-run-self-test', sequence: 4, type: 'run.succeeded', occurredAt: 1776643200000 }],
  }
}

async function runSelfTest() {
  const enabledImportAction = '<node text="" content-desc="Import" class="android.widget.Button" bounds="[0,0][100,100]" enabled="true" clickable="true" />'
  if (!hasEnabledClickableExactLabel(enabledImportAction, ['导入', 'Import'])) {
    throw new Error('Provider Runtime Android self-test rejected an enabled exact Import action.')
  }
  for (const invalidImportAction of [
    '<node text="Batch Import" content-desc="" class="android.widget.TextView" bounds="[0,0][100,100]" enabled="true" clickable="false" />',
    '<node text="" content-desc="Import" class="android.widget.Button" bounds="[0,0][100,100]" enabled="false" clickable="true" />',
    '<node text="" content-desc="Import providers" class="android.widget.Button" bounds="[0,0][100,100]" enabled="true" clickable="true" />',
  ]) {
    if (hasEnabledClickableExactLabel(invalidImportAction, ['导入', 'Import'])) {
      throw new Error('Provider Runtime Android self-test accepted a non-action or non-exact Import label.')
    }
  }
  await assertProviderFailureServerSelfTest()
  const activationProgressUia = `<node package="${appPackageName}" text="正在启用供应商" bounds="[0,0][100,20]" /><node package="${appPackageName}" text="${providerName}" bounds="[0,20][100,40]" /><node package="${appPackageName}" text="0/1" bounds="[0,40][100,60]" />`
  if (!hasProviderActivationProgressEvidence(activationProgressUia)) {
    throw new Error('Provider Runtime Android self-test rejected app-owned activation progress semantics.')
  }
  if (hasProviderActivationProgressEvidence(activationProgressUia.replaceAll(appPackageName, 'com.android.systemui'))) {
    throw new Error('Provider Runtime Android self-test accepted external activation progress semantics.')
  }
  const activationResultUia = `<node package="${appPackageName}" text="服务商启用完成" bounds="[0,0][100,20]" /><node package="${appPackageName}" text="${providerName} 已可用" bounds="[0,20][100,40]" /><node package="${appPackageName}" text="1/1" bounds="[0,40][100,60]" />`
  if (!hasProviderActivationResultEvidence(activationResultUia)) {
    throw new Error('Provider Runtime Android self-test rejected app-owned activation result semantics.')
  }
  const activationReadyCardUia = `<node package="${appPackageName}" text="${providerName}" bounds="[0,0][100,20]" /><node package="${appPackageName}" text="已同步可用" bounds="[0,20][100,40]" /><node package="${appPackageName}" text="1 个模型" bounds="[0,40][100,60]" /><node package="${appPackageName}" text="1 组令牌" bounds="[0,60][100,80]" />`
  if (!hasProviderActivationResultEvidence(activationReadyCardUia)) {
    throw new Error('Provider Runtime Android self-test rejected the app-owned ready provider card.')
  }
  if (hasProviderActivationResultEvidence(activationReadyCardUia.replaceAll(appPackageName, 'com.android.systemui'))) {
    throw new Error('Provider Runtime Android self-test accepted an external ready provider card.')
  }
  if (!hasRuntimeFallbackEventEvidence('{"event":"provider.fallback.decided"}')) {
    throw new Error('Provider Runtime Android self-test did not accept the typed fallback event.')
  }
  if (!hasRuntimeFallbackEventEvidence('{"event":"fallback.decision"}')) {
    throw new Error('Provider Runtime Android self-test did not accept the legacy fallback event.')
  }
  for (const genericText of [
    '{"event":"transport.fallback"}',
    'provider runtime-fallback line from logcat',
    'generic fallback text',
  ]) {
    if (hasRuntimeFallbackEventEvidence(genericText)) {
      throw new Error(`Provider Runtime Android self-test accepted generic fallback evidence: ${genericText}`)
    }
  }
  for (const exactTitle of ['Runtime fallback', '运行时兜底', 'ランタイムフォールバック']) {
    const exactTitleUia = `<node text="${exactTitle}" content-desc="" bounds="[0,0][1,1]" enabled="true" />`
    if (!hasRuntimeFallbackChatTraceEvidence(exactTitleUia)) {
      throw new Error(`Provider Runtime Android self-test rejected an exact fallback UI title: ${exactTitle}`)
    }
  }
  if (hasRuntimeFallbackChatTraceEvidence('<node text="Runtime fallback details" content-desc="" bounds="[0,0][1,1]" enabled="true" />')) {
    throw new Error('Provider Runtime Android self-test accepted generic fallback UI text.')
  }
  if (!hasRuntimeFallbackDiagnosticsEvidence(`Request examples ${providerId}/${modelId} fallback:503`)) {
    throw new Error('Provider Runtime Android self-test did not accept bounded fallback diagnostics evidence.')
  }
  if (hasRuntimeFallbackDiagnosticsEvidence('Runtime diagnostics fallback')) {
    throw new Error('Provider Runtime Android self-test accepted an unbounded diagnostics title as fallback evidence.')
  }
  if (!hasProviderHealthDiagnosticsEvidence('Provider health cooldown 1 credential healthy')) {
    throw new Error('Provider Runtime Android self-test did not accept provider health diagnostics evidence.')
  }
  if (hasProviderHealthDiagnosticsEvidence(`Provider health ${providerName}`)) {
    throw new Error('Provider Runtime Android self-test accepted the provider card as health evidence.')
  }
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
    scannedFiles: 3,
    scannedPaths: [
      providerRuntimeAndroidResultRelativePath,
      providerRuntimeAndroidRunLogRelativePath,
      providerRuntimeRestartRecoveryEvidencePath,
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
      activationEvidence: id === 'provider-activation'
        ? {
            progress: { visible: true, ...providerRuntimeActivationEvidencePaths.progress },
            result: { visible: true, ...providerRuntimeActivationEvidencePaths.result },
          }
        : undefined,
      restartRecoveryEvidence: id === 'restart-recovery'
        ? createRestartRecoveryEvidenceFixture()
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
    for (const evidencePath of [
      providerRuntimeAndroidResultRelativePath,
      providerRuntimeAndroidRunLogRelativePath,
      providerRuntimeRestartRecoveryEvidencePath,
    ]) {
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
        ...(scenario.activationEvidence ? [
          scenario.activationEvidence.progress.png,
          scenario.activationEvidence.progress.uia,
          scenario.activationEvidence.result.png,
          scenario.activationEvidence.result.uia,
        ] : []),
        ...(scenario.restartRecoveryEvidence?.evidence ? [scenario.restartRecoveryEvidence.evidence] : []),
      ].filter(Boolean)) {
        ensureSelfTestEvidenceFile(evidencePath)
      }
    }
    const passingFixture = {
      ...fixture,
      sensitiveData: {
        ...fixture.sensitiveData,
        scannedPaths: [
          relative(outputPath),
          relative(runtimeLogEvidence),
          providerRuntimeRestartRecoveryEvidencePath,
        ],
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
    ['missing restart durable evidence path', { ...fixture.sensitiveData, scannedFiles: 2, scannedPaths: [relative(outputPath), relative(runtimeLogEvidence)] }],
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
    ['non-object scenario record', { ...fixture, scenarios: [...fixture.scenarios, null] }, `scenario record ${requiredProviderRuntimeAndroidScenarios.length + 1} is not an object`],
    ['missing scenario id', { ...fixture, scenarios: [...fixture.scenarios, { ...fixture.scenarios[0], id: '' }] }, `scenario record ${requiredProviderRuntimeAndroidScenarios.length + 1} does not record id`],
    ['unknown scenario id', { ...fixture, scenarios: [...fixture.scenarios, { ...fixture.scenarios[0], id: 'unexpected-provider-runtime-scenario' }] }, `scenario record ${requiredProviderRuntimeAndroidScenarios.length + 1} id unexpected-provider-runtime-scenario is not required`],
    ['missing required scenario', { ...fixture, scenarios: fixture.scenarios.filter((scenario) => scenario.id !== 'android-back') }, 'Missing Provider Runtime Android scenario android-back'],
    ['duplicate required scenario', { ...fixture, scenarios: [...fixture.scenarios, fixture.scenarios.find((scenario) => scenario.id === 'android-back')] }, 'Provider Runtime Android scenario android-back is duplicated'],
    ['activation progress semantics', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'provider-activation'
        ? { ...scenario, activationEvidence: { ...scenario.activationEvidence, progress: { ...scenario.activationEvidence.progress, visible: false } } }
        : scenario),
    }, 'progress evidence does not prove visible=true'],
    ['activation result capture', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'provider-activation'
        ? { ...scenario, activationEvidence: { ...scenario.activationEvidence, result: { ...scenario.activationEvidence.result, uia: null } } }
        : scenario),
    }, 'result evidence uia is missing'],
    ['restart recovery durable state', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? { ...scenario, restartRecoveryEvidence: { ...scenario.restartRecoveryEvidence, assistantMessage: null } }
        : scenario),
    }, 'durable state assistant message is missing'],
    ['restart recovery conversation identity', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? { ...scenario, restartRecoveryEvidence: { ...scenario.restartRecoveryEvidence, conversationId: 'other-conversation' } }
        : scenario),
    }, 'durable state conversationId is other-conversation'],
    ['restart recovery ordinary chat kind', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? {
            ...scenario,
            restartRecoveryEvidence: {
              ...scenario.restartRecoveryEvidence,
              run: { ...scenario.restartRecoveryEvidence.run, kind: 'agent' },
            },
          }
        : scenario),
    }, 'durable state assistant run is not chat'],
    ['restart recovery terminal run state', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? {
            ...scenario,
            restartRecoveryEvidence: {
              ...scenario.restartRecoveryEvidence,
              run: { ...scenario.restartRecoveryEvidence.run, status: 'running' },
            },
          }
        : scenario),
    }, 'durable state assistant run is not succeeded'],
    ['restart recovery terminal journal', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? { ...scenario, restartRecoveryEvidence: { ...scenario.restartRecoveryEvidence, journal: [] } }
        : scenario),
    }, 'durable state journal is missing'],
    ['restart recovery journal linkage', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? {
            ...scenario,
            restartRecoveryEvidence: {
              ...scenario.restartRecoveryEvidence,
              journal: scenario.restartRecoveryEvidence.journal.map((entry) => ({ ...entry, runId: 'other-run' })),
            },
          }
        : scenario),
    }, 'journal has no linked terminal run.succeeded entry'],
    ['restart recovery message linkage', {
      ...fixture,
      scenarios: fixture.scenarios.map((scenario) => scenario.id === 'restart-recovery'
        ? {
            ...scenario,
            restartRecoveryEvidence: {
              ...scenario.restartRecoveryEvidence,
              run: { ...scenario.restartRecoveryEvidence.run, responseMessageId: 'wrong-response-message' },
            },
          }
        : scenario),
    }, 'response message does not match assistant message'],
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
  const blockedNoDeviceResult = createBaseResult({
    deviceSerial: null,
    apkPath: 'dist-apk/IsleMind-self-test.apk',
    packageName: appPackageName,
    expected: fixture.expected,
  })
  for (const id of requiredProviderRuntimeAndroidScenarios) {
    blockedNoDeviceResult.scenarios.push(failedScenario(id, 'Scenario was not executed.', 'No connected adb device was found.'))
  }
  finalizeResult(blockedNoDeviceResult)
  if (blockedNoDeviceResult.passed !== false) throw new Error('Provider Runtime Android self-test accepted blocked no-device evidence as passing.')
  if (!blockedNoDeviceResult.scenarios.every((scenario) => scenario.status === 'blocked' && scenario.blockedReason)) {
    throw new Error('Provider Runtime Android self-test did not mark no-device scenarios as blocked with a reason.')
  }
  if (!blockedNoDeviceResult.contractIssues.some((issue) => issue.includes('does not record deviceSerial'))) {
    throw new Error('Provider Runtime Android self-test did not keep device precondition failures in blocked evidence.')
  }
  if (blockedNoDeviceResult.contractIssues.some((issue) => issue.includes('referenced png evidence is missing') || issue.includes('referenced uia evidence is missing') || issue.includes('step 1 is not an object'))) {
    throw new Error(`Provider Runtime Android self-test kept capture-evidence noise for blocked no-device scenarios: ${blockedNoDeviceResult.contractIssues.join('; ')}`)
  }
  if (blockedNoDeviceResult.diagnostics?.blockedScenarioCount !== requiredProviderRuntimeAndroidScenarios.length) {
    throw new Error('Provider Runtime Android self-test did not summarize blocked no-device scenarios.')
  }
  if (!blockedNoDeviceResult.diagnostics?.blockedScenarioIds?.includes('provider-settings-route')) {
    throw new Error('Provider Runtime Android self-test did not expose blocked scenario ids.')
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

function startProviderFailureServer(logPath, options = {}) {
  fs.writeFileSync(logPath, '', 'utf8')
  const stateBuffer = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)
  const state = new Int32Array(stateBuffer)
  const instance = new Worker(__filename, {
    workerData: {
      mode: providerFailureWorkerMode,
      logPath,
      stateBuffer,
      modelsDelayMs: options.modelsDelayMs ?? 6500,
    },
  })
  Atomics.wait(state, 1, 0, 5000)
  if (Atomics.load(state, 1) !== 1) {
    instance.terminate()
    throw new Error('Provider failure fixture server did not start.')
  }
  instance.unref?.()
  const port = Atomics.load(state, 0)
  return { instance, port, baseUrl: `http://127.0.0.1:${port}/v1`, state }
}

async function assertProviderFailureServerSelfTest() {
  const temporaryLogPath = path.join(smokeDir, `.provider-runtime-server-self-test-${process.pid}.jsonl`)
  fs.mkdirSync(smokeDir, { recursive: true })
  let providerFailureServer = null
  try {
    providerFailureServer = startProviderFailureServer(temporaryLogPath, { modelsDelayMs: 5 })
    const response = await fetch(`${providerFailureServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer qa-self-test-key' },
      body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'self-test' }] }),
    })
    if (response.status !== 503) throw new Error(`Provider Runtime Android self-test expected HTTP 503, got ${response.status}.`)
    await response.arrayBuffer()
    let entries = readProviderFailureRequestEvidenceFromPath(temporaryLogPath)
    if (entries.length !== 1 || entries[0].method !== 'POST' || entries[0].url !== '/v1/chat/completions' || entries[0].status !== 503 || entries[0].kind !== 'fallback-failure') {
      throw new Error(`Provider Runtime Android self-test recorded an invalid failure request: ${JSON.stringify(entries)}.`)
    }
    const recoveryResponse = await fetch(`${providerFailureServer.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer qa-self-test-key' },
      body: JSON.stringify({ model: modelId, stream: true, messages: [{ role: 'user', content: recoveryRequestMarker }] }),
    })
    if (recoveryResponse.status !== 200) throw new Error(`Provider Runtime Android self-test expected recovery HTTP 200, got ${recoveryResponse.status}.`)
    const recoveryText = await recoveryResponse.text()
    if (!recoveryText.includes(recoveryCompletionMarker)) {
      throw new Error('Provider Runtime Android self-test did not receive the recovery completion sentinel.')
    }
    entries = readProviderFailureRequestEvidenceFromPath(temporaryLogPath)
    if (entries.length !== 2 || entries[1].method !== 'POST' || entries[1].url !== '/v1/chat/completions' || entries[1].status !== 200 || entries[1].kind !== 'restart-recovery') {
      throw new Error(`Provider Runtime Android self-test recorded an invalid recovery request: ${JSON.stringify(entries)}.`)
    }
    if (JSON.stringify(entries).includes('qa-self-test-key')) {
      throw new Error('Provider Runtime Android self-test persisted a request credential.')
    }
    const modelsResponse = await fetch(`${providerFailureServer.baseUrl}/models`, {
      headers: { authorization: 'Bearer qa-self-test-key' },
    })
    if (modelsResponse.status !== 200) throw new Error(`Provider Runtime Android self-test expected models HTTP 200, got ${modelsResponse.status}.`)
    const modelsBody = await modelsResponse.json()
    if (!Array.isArray(modelsBody.data) || modelsBody.data[0]?.id !== modelId) {
      throw new Error(`Provider Runtime Android self-test received an invalid models response: ${JSON.stringify(modelsBody)}.`)
    }
  } finally {
    if (providerFailureServer) stopProviderFailureServer(providerFailureServer)
    fs.rmSync(temporaryLogPath, { force: true })
  }
  if (providerFailureServer && Atomics.load(providerFailureServer.state, 2) !== 1) {
    throw new Error('Provider Runtime Android self-test did not close the failure server cleanly.')
  }
}

function runProviderFailureWorker() {
  const state = new Int32Array(workerData.stateBuffer)
  const server = http.createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const isChatRequest = request.method === 'POST' && request.url === '/v1/chat/completions'
      const isModelsRequest = request.method === 'GET' && request.url === '/v1/models'
      const payload = tryParseJson(body) ?? {}
      const isRestartRecoveryRequest = isChatRequest && JSON.stringify(payload.messages ?? []).includes(recoveryRequestMarker)
      const status = isRestartRecoveryRequest ? 200 : isChatRequest ? 503 : isModelsRequest ? 200 : 404
      const kind = isRestartRecoveryRequest ? 'restart-recovery' : isChatRequest ? 'fallback-failure' : isModelsRequest ? 'model-list' : 'not-found'
      const finish = () => {
        fs.appendFileSync(workerData.logPath, `${JSON.stringify({ method: request.method, url: request.url, status, kind })}\n`, 'utf8')
        if (isRestartRecoveryRequest) {
          writeProviderRuntimeRecoveryCompletion(response, payload.stream === true)
          return
        }
        response.writeHead(status, { 'Connection': 'close', 'Content-Type': 'application/json' })
        response.end(isModelsRequest
          ? JSON.stringify({ object: 'list', data: [{ id: modelId, object: 'model', owned_by: 'islemind-qa' }] })
          : JSON.stringify({ error: { message: 'qa_provider_runtime_failure', type: 'qa_http_failure' } }))
      }
      if (isModelsRequest) setTimeout(finish, Math.max(0, Number(workerData.modelsDelayMs) || 0))
      else finish()
    })
  })
  server.on('error', () => {
    Atomics.store(state, 1, 2)
    Atomics.notify(state, 1)
  })
  server.listen(0, '0.0.0.0', () => {
    Atomics.store(state, 0, server.address().port)
    Atomics.store(state, 1, 1)
    Atomics.notify(state, 1)
  })
  parentPort?.on('message', (message) => {
    if (message?.type !== 'close') return
    server.close(() => {
      Atomics.store(state, 2, 1)
      Atomics.notify(state, 2)
      parentPort?.close()
    })
    server.closeAllConnections?.()
  })
}

function writeProviderRuntimeRecoveryCompletion(response, streaming) {
  if (streaming) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache',
    })
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: recoveryCompletionMarker }, index: 0, finish_reason: null }] })}\n\n`)
    response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 } })}\n\n`)
    response.write('data: [DONE]\n\n')
    response.end()
    return
  }
  response.writeHead(200, { 'Connection': 'close', 'Content-Type': 'application/json' })
  response.end(JSON.stringify({
    id: 'chatcmpl-provider-runtime-restart',
    object: 'chat.completion',
    model: modelId,
    choices: [{ index: 0, message: { role: 'assistant', content: recoveryCompletionMarker }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
  }))
}

function stopProviderFailureServer(providerFailureServer) {
  providerFailureServer.instance.postMessage({ type: 'close' })
  Atomics.wait(providerFailureServer.state, 2, 0, 3000)
  const closed = Atomics.load(providerFailureServer.state, 2) === 1
  if (!closed) providerFailureServer.instance.terminate()
  return closed
}

function configureAdbReverse(device, port) {
  clearAdbReverse(device, port)
  return runCommand('adb', ['-s', device, 'reverse', `tcp:${port}`, `tcp:${port}`]) !== null
}

function clearAdbReverse(device, port) {
  runCommand('adb', ['-s', device, 'reverse', '--remove', `tcp:${port}`])
}

function readProviderFailureRequestEvidence() {
  return readProviderFailureRequestEvidenceFromPath(providerFailureRequestEvidence)
}

function readProviderFailureRequestEvidenceFromPath(filePath) {
  if (!fs.existsSync(filePath)) return []
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line) } catch { return null }
    })
    .filter(Boolean)
}

function canReadAppPrivateFiles(device) {
  return runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'pwd']) !== null
}

function clearRuntimeLog(device) {
  runCommand('adb', [
    '-s', device,
    'shell',
    'run-as',
    appPackageName,
    'sh',
    '-c',
    'rm -f files/islemind-runtime.jsonl islemind-runtime.jsonl cache/islemind-runtime.jsonl; for root in files cache; do [ -d "$root" ] && find "$root" -name islemind-runtime.jsonl -type f -print | while IFS= read -r file; do rm -f "$file"; done; done',
  ])
}

function readRuntimeLogWithRetry(device, readable = true, maxAttempts = 6) {
  if (!readable) return ''
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (const candidate of ['files/islemind-runtime.jsonl', 'islemind-runtime.jsonl', 'cache/islemind-runtime.jsonl']) {
      const text = runCommand('adb', ['-s', device, 'shell', 'run-as', appPackageName, 'cat', candidate])
      if (text && String(text).trim()) return String(text)
    }
    if (attempt + 1 < maxAttempts) sleep(450)
  }
  return ''
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

function tryParseJson(value) {
  try {
    return value ? JSON.parse(value) : null
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
