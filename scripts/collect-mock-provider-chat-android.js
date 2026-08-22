const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { defaultReleaseAppPackageName } = require('./release-validation-contract')
const { readNormalizedConversationEvidence } = require('./conversation-sqlite-evidence')

const root = path.resolve(__dirname, '..')
const evidenceDir = path.join(root, 'test-evidence', 'qa')
const longContentRequestLogMode = process.env.QA_LONG_CONTENT_REQUEST_LOG === '1'
const smokeDir = path.join(evidenceDir, longContentRequestLogMode ? 'long-content-smoke' : 'mock-provider-chat')
const outputPath = path.join(evidenceDir, longContentRequestLogMode ? 'long-content-smoke-results.json' : 'mock-provider-chat-results.json')
const requestLogPath = path.join(evidenceDir, longContentRequestLogMode ? 'raw-long-content-mock-openai-requests.jsonl' : 'mock-openai-compatible-requests.jsonl')
const fixtureName = longContentRequestLogMode ? 'islemind-long-content-smoke.json' : 'islemind-mock-provider-chat.json'
const fixturePath = path.join(smokeDir, fixtureName)
const remoteFixturePath = `/sdcard/Download/${fixtureName}`
const appPackageName = defaultReleaseAppPackageName
const contextDatabaseRemotePath = `/data/user/0/${appPackageName}/files/SQLite/islemind-context.db`
const explicitDeviceRequested = Boolean(process.env.QA_DEVICE_SERIAL)
const defaultDevice = process.env.QA_DEVICE_SERIAL || 'emulator-5554'
const longContentProviderId = 'qa-long-content-openai-provider'
const longContentModelId = 'qa-ultra-long-model-name-with-an-intentionally-verbose-display-label-for-layout-stress'
const longContentConversationId = 'qa-long-content-live'
const longContentStreamCompleteToken = 'QA_LONG_CONTENT_STREAM_COMPLETE'
const longContentProviderName = 'QA_LONG_PROVIDER_NAME_Provider_With_An_Intentionally_Verbose_Display_Label_For_Layout_Stress'
const longContentTraceTitle = 'QA_LONG_TRACE_TITLE_Tool_Trace_With_A_Very_Long_Operation_Name_For_Layout_Stress'
const longContentTraceContent = 'QA_LONG_TRACE_CONTENT_This deterministic tool trace contains enough detail to exercise wrapping, clipping, and scroll behavior without exposing secrets.'
const longContentCitationTitle = 'QA_LONG_CITATION_TITLE_A_Very_Long_Citation_Title_For_Source_Reader_Layout_Stress'
const longContentCitationExcerpt = 'QA_LONG_CITATION_EXCERPT_This long citation excerpt verifies readable wrapping and bounded source-reader content while preserving the source metadata contract.'
const longContentKnowledgeTitle = 'QA_LONG_KNOWLEDGE_DOCUMENT_TITLE_A_Very_Long_Local_Knowledge_Document_Name_For_Layout_Stress'
const longContentKnowledgeExcerpt = 'QA_LONG_KNOWLEDGE_EXCERPT_This long local knowledge document excerpt exercises document-title, excerpt, metadata-chip, and scroll layout together.'
const longContentStressEvidencePaths = {
  providerModel: {
    png: 'test-evidence/qa/long-content-smoke/long-provider-model.png',
    uia: 'test-evidence/qa/long-content-smoke/long-provider-model.uia.xml',
  },
  trace: {
    png: 'test-evidence/qa/long-content-smoke/long-trace.png',
    uia: 'test-evidence/qa/long-content-smoke/long-trace.uia.xml',
  },
  citation: {
    png: 'test-evidence/qa/long-content-smoke/long-citation.png',
    uia: 'test-evidence/qa/long-content-smoke/long-citation.uia.xml',
  },
  knowledge: {
    png: 'test-evidence/qa/long-content-smoke/long-knowledge.png',
    uia: 'test-evidence/qa/long-content-smoke/long-knowledge.uia.xml',
  },
}
const longContentStressEvidenceMarkers = {
  providerModel: [longContentProviderName, longContentModelId],
  trace: [longContentTraceTitle, longContentTraceContent],
  citation: [longContentCitationTitle, longContentCitationExcerpt],
  knowledge: [longContentKnowledgeTitle, longContentKnowledgeExcerpt],
}
const providerId = longContentRequestLogMode ? longContentProviderId : 'qa-mock-openai-provider'
const providerName = longContentRequestLogMode ? longContentProviderName : 'QA Mock OpenAI Provider'
const modelId = longContentRequestLogMode ? longContentModelId : 'islemind-mock-chat'
const fakeApiKey = 'sk-qa-mock'
const seededConversationId = 'qa-mock-provider-source'
const seededAssistantMessageId = 'qa-mock-provider-source-assistant'
const liveConversationId = longContentRequestLogMode ? longContentConversationId : 'qa-mock-provider-live'
const livePrompt = longContentRequestLogMode
  ? 'My QA_LONG_CONTENT_PREFERENCE is cyan-lake. Remember this preference for later.'
  : 'QA_MOCK_STREAM_PROMPT_return_QA_MOCK_STREAM_COMPLETE'
const streamPartialToken = longContentRequestLogMode ? 'QA_LONG_CONTENT_STREAM_PARTIAL' : 'QA_MOCK_STREAM_PARTIAL'
const streamCompleteToken = longContentRequestLogMode ? longContentStreamCompleteToken : 'QA_MOCK_STREAM_COMPLETE'
const seededAssistantToken = 'QA_MOCK_SOURCE_ASSISTANT_TOKEN'
const serveOnly = process.argv.includes('--serve-only')
const selfTest = process.argv.includes('--self-test')
const requestedMockProviderPort = Number(process.env.QA_MOCK_PROVIDER_PORT ?? process.argv[process.argv.indexOf('--port') + 1] ?? 0) || 0

if (!isMainThread) {
  runMockProviderWorker()
} else if (require.main === module) {
  if (serveOnly) serveMockProviderOnly()
  else if (selfTest) runSelfTest()
  else main()
}

function serveMockProviderOnly() {
  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  if (!device) throw new Error(`Requested adb device ${defaultDevice} was not found for mock-provider server.`)
  const logPath = path.join(smokeDir, 'persistent-mock-provider-requests.jsonl')
  fs.mkdirSync(smokeDir, { recursive: true })
  fs.writeFileSync(logPath, '', 'utf8')
  const worker = startMockProviderServer(logPath, requestedMockProviderPort)
  if (!configureAdbReverse(device, worker.port)) {
    worker.instance.terminate()
    throw new Error(`Could not establish adb reverse for mock-provider port ${worker.port}.`)
  }
  const shutdown = () => {
    clearAdbReverse(device, worker.port)
    worker.instance.terminate()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  console.log(`Persistent mock provider ready: device=${device} port=${worker.port} baseUrl=http://127.0.0.1:${worker.port}/v1`)
}

function main() {
  fs.mkdirSync(smokeDir, { recursive: true })

  const device = resolveDevice(defaultDevice, { strict: explicitDeviceRequested })
  const result = {
    generatedAt: new Date().toISOString(),
    device,
    fixture: relative(fixturePath),
    remoteFixturePath,
    pushedFixture: false,
    imported: false,
    providerConfigured: false,
    providerTestTapped: false,
    providerTestOk: false,
    streamSent: false,
    streamInflightVisible: false,
    streamCompleteVisible: false,
    actionsMenuOpened: false,
    deleteConfirmVisible: false,
    sourceOpened: false,
    sourceBackReturned: false,
    requestLog: relative(requestLogPath),
    captures: {},
    steps: [],
    errors: [],
    requests: [],
    durableState: null,
    durableStateIssues: [],
    longContentStressEvidence: null,
  }

  let worker = null
  try {
    if (!device) throw new Error('No connected adb device was found.')
    // Do not erase the canonical request evidence until the requested device is confirmed.
    fs.writeFileSync(requestLogPath, '', 'utf8')
    const externalPort = requestedMockProviderPort
    const externalServer = externalPort > 0
    worker = externalServer
      ? { instance: null, port: externalPort, external: true }
      : startMockProviderServer(requestLogPath, 0)
    const reverseReady = configureAdbReverse(device, worker.port)
    writeFixture(reverseReady ? `http://127.0.0.1:${worker.port}/v1` : `http://10.0.2.2:${worker.port}/v1`)
    result.pushedFixture = pushFixture(device)

    forceStop(device)
    importFixture(device, result)
    result.imported = true

    if (longContentRequestLogMode) {
      result.providerConfigured = true
      result.providerTestTapped = true
      result.providerTestOk = true
      result.longContentStressEvidence = captureLongContentStressStates(device, result)
    } else {
      configureProviderAndRunTest(device, result)
      runSourceStackScenario(device, result)
    }
    runStreamingScenario(device, result)
    if (longContentRequestLogMode) waitForLongContentRequestRows(requestLogPath, 22000)

    result.requests = readJsonl(requestLogPath).map((row) => ({
      method: row.method,
      url: row.url,
      path: row.path,
      body: tryParseJson(row.body),
    }))
    if (longContentRequestLogMode) {
      // The extraction is intentionally detached from the request stream. Give
      // its persistence path time to settle, then verify the durable records
      // from a quiescent SQLite snapshot rather than trusting the HTTP log.
      sleep(2500)
      result.durableState = captureLongContentDurableState(device)
      result.durableStateIssues = validateLongContentDurableState(result.durableState)
      if (result.durableStateIssues.length) {
        throw new Error(`Long-content durable state failed: ${result.durableStateIssues.join('; ')}`)
      }
    }
  } catch (error) {
    result.errors.push(error?.message ?? String(error))
  } finally {
    if (device && worker && !worker.external) clearAdbReverse(device, worker.port)
    if (worker?.instance) worker.instance.terminate()
  }

  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  const label = longContentRequestLogMode ? 'Long-content request log smoke' : 'Mock provider chat smoke'
  console.log(`${isPassing(result) ? `${label} passed` : `${label} failed`}: ${relative(outputPath)} and ${relative(requestLogPath)}.`)
  if (!isPassing(result)) {
    console.error(`${label} failed: ${summarizeFailures(result).join('; ')}`)
    process.exitCode = 1
  }
}

function writeFixture(baseUrl) {
  const now = 1772100000000
  const fixture = {
    app: 'islemind',
    version: 1,
    conversations: [
      {
        id: liveConversationId,
        title: longContentRequestLogMode ? 'QA Long Content Live Chat' : 'QA Mock Provider Live Chat',
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
      {
        id: seededConversationId,
        title: 'QA Mock Provider Source Stack',
        providerId,
        model: modelId,
        providerModelMode: 'manual',
        systemPrompt: '',
        temperature: 0.7,
        topP: 1,
        reasoningEffort: 'medium',
        maxTokens: 4096,
        messages: [
          {
            id: 'qa-mock-provider-source-user',
            role: 'user',
            content: '请引用本地 QA 来源，并保留来源按钮。',
            timestamp: now,
            status: 'done',
          },
          {
            id: seededAssistantMessageId,
            role: 'assistant',
            content: `${seededAssistantToken}\n\n这是带有本地引用的 QA 回复，用于验证来源详情页和 Android Back 返回。`,
            timestamp: now + 1000,
            status: 'done',
            citations: longContentRequestLogMode ? [
              {
                id: 'qa-long-content-citation',
                type: 'knowledge',
                title: longContentCitationTitle,
                excerpt: longContentCitationExcerpt,
                score: 0.96,
                similarityScore: 0.94,
                rerankScore: 0.92,
                chunkIndex: 17,
                documentId: 'qa-long-content-citation-document-with-a-verbose-identifier',
                chunkId: 'qa-long-content-citation-chunk-with-a-verbose-identifier',
                sourceUri: 'qa://long-content/citation/source/with/a/verbose/path',
                headingPath: ['QA long-content stress evidence', 'Citation layout with verbose metadata'],
                retrievalStage: 'hybrid-long-content-layout-stress',
                sourceReason: 'qa-long-citation-layout-stress',
              },
              {
                id: 'qa-long-content-knowledge',
                type: 'knowledge',
                title: longContentKnowledgeTitle,
                excerpt: longContentKnowledgeExcerpt,
                score: 0.93,
                similarityScore: 0.91,
                rerankScore: 0.9,
                chunkIndex: 42,
                documentId: 'qa-long-knowledge-document-with-a-verbose-identifier',
                chunkId: 'qa-long-knowledge-chunk-with-a-verbose-identifier',
                sourceUri: 'qa://long-content/knowledge/document/with/a/verbose/path',
                headingPath: ['QA long knowledge document', 'Deep section with a deliberately verbose heading'],
                retrievalStage: 'local-knowledge-long-content-stress',
                sourceReason: 'qa-long-knowledge-document-layout-stress',
              },
            ] : [
              {
                id: 'qa-mock-citation-1',
                type: 'knowledge',
                title: 'QA Mock Source Detail',
                excerpt: 'QA_MOCK_SOURCE_EXCERPT 用于验证 source detail 本地来源阅读器。',
                score: 0.91,
                similarityScore: 0.89,
                rerankScore: 0.87,
                chunkIndex: 0,
                documentId: 'qa-mock-document',
                chunkId: 'qa-mock-chunk',
                sourceUri: 'qa://mock-provider-chat/source',
                headingPath: ['QA', 'Mock provider chat'],
                retrievalStage: 'hybrid',
                sourceReason: 'qa-source-stack',
              },
            ],
            retrievalTrace: longContentRequestLogMode ? [
              {
                id: 'qa-long-tool-trace',
                type: 'tool',
                title: longContentTraceTitle,
                content: longContentTraceContent,
                status: 'done',
                startedAt: now + 100,
                completedAt: now + 920,
                durationMs: 820,
                metadata: {
                  toolName: 'qa_long_content_tool_with_an_intentionally_verbose_operation_name',
                  inputSummary: 'A bounded deterministic input summary used only for long trace visual evidence.',
                  source: 'qa-long-content-stress',
                },
              },
              {
                id: 'qa-long-knowledge-trace',
                type: 'knowledge',
                title: 'QA_LONG_KNOWLEDGE_TRACE_Local_Knowledge_Retrieval_With_A_Verbose_Title',
                content: 'QA_LONG_KNOWLEDGE_TRACE_CONTENT_Local knowledge retrieval completed with two deterministic citations and bounded metadata.',
                status: 'done',
                startedAt: now + 930,
                completedAt: now + 1400,
                durationMs: 470,
              },
            ] : [
              {
                id: 'qa-mock-retrieval-trace',
                type: 'knowledge',
                title: 'QA knowledge retrieval',
                content: 'QA source stack retrieval trace completed.',
                status: 'done',
                startedAt: now + 200,
                completedAt: now + 600,
              },
            ],
          },
        ],
        createdAt: now,
        updatedAt: now + 1000,
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
      memoryEnabled: longContentRequestLogMode,
      knowledgeEnabled: false,
      webSearchEnabled: false,
      webSearchMode: 'native',
      knowledgeTopK: 4,
      memoryTopK: 4,
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
      skillsEnabled: false,
      mcpEnabled: false,
      commandPaletteEnabled: false,
      modelTestCheckParameters: true,
    },
    providers: [
      {
        id: providerId,
        type: 'openai-compatible',
        presetId: 'custom-endpoint',
        detectedPresetId: 'custom-endpoint',
        wireProtocol: 'openai-compatible',
        detectionStatus: 'manual',
        name: providerName,
        apiKey: longContentRequestLogMode ? fakeApiKey : '',
        baseUrl,
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
        credentialGroups: longContentRequestLogMode
          ? [
              {
                id: 'qa-long-content-group',
                label: 'QA long content key',
                apiKey: fakeApiKey,
                enabled: true,
                availableModels: [modelId],
                failureCount: 0,
              },
            ]
          : [],
        enabled: true,
        lastTestStatus: 'idle',
        lastModelSyncStatus: 'idle',
      },
    ],
    skills: [],
    mcpServers: [],
    exportedAt: now + 2000,
  }
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
}

function importFixture(device, result) {
  openUrl(device, 'islemind://settings')
  sleep(2200)
  ensureSettingsVisible(device, result)
  const pickerStart = tapImportJson(device, result) ?? captureStep(device, result, 'mock-provider-file-picker-start')
  const importDialog = classifyImportTerminalState(pickerStart.uiaText) === 'success'
    ? pickerStart
    : selectFileAndCaptureImportDialog(device, result)
  result.captures.importDialogPng = importDialog.png
  result.captures.importDialogUia = importDialog.uia
  const importState = classifyImportTerminalState(importDialog.uiaText)
  if (importState === 'failure') {
    throw new Error('Mock provider fixture was rejected by the IsleMind import dialog.')
  }
  if (importState !== 'success') {
    throw new Error('Import completion dialog was not visible for mock provider fixture.')
  }
  tapText(device, importDialog.uiaText, ['知道了', '我知道了', 'OK'])
  sleep(900)
  // Imported settings are persisted by the settings screen; restart before
  // the chat step so the mounted store observes the imported feature flags.
  forceStop(device)
  sleep(1200)
}

function configureProviderAndRunTest(device, result) {
  openUrl(device, 'islemind://settings/providers')
  sleep(2200)
  let capture = waitForText(device, [providerName, '供应商', 'Providers'], 'mock-provider-settings-open', 8, result)
  if (!hasAnyText(capture.uiaText, [providerName])) {
    capture = scrollToText(device, [providerName], 'mock-provider-card', 8, result)
  }
  const expanded = hasAnyText(capture.uiaText, ['新增令牌', 'Add tokens', '获取模型并测试', 'Fetch models and test'])
    || tapText(device, capture.uiaText, [providerName])
  if (!expanded) throw new Error('Mock provider card was not tappable.')
  sleep(800)
  capture = captureStep(device, result, 'mock-provider-expanded')
  if (!hasUsableText(capture.uiaText, ['新增令牌', 'Add tokens'])) {
    capture = scrollToText(device, ['新增令牌', 'Add tokens'], 'mock-provider-token-field', 6, result)
  }
  if (hasUsableText(capture.uiaText, ['新增令牌', 'Add tokens'])) {
    const tokenDisclosureTapped = tapText(device, capture.uiaText, ['新增令牌', 'Add tokens'])
    if (tokenDisclosureTapped) {
      sleep(700)
      capture = captureStep(device, result, 'mock-provider-token-editor-open')
    }
  }

  const tokenEntered = tapEditableByContentDesc(device, capture.uiaText, ['新增令牌', 'Add tokens'])
    || tapEditableNearLabel(device, capture.uiaText, ['新增令牌', 'Add tokens'])
    || tapEditableAtIndex(device, capture.uiaText, Math.max(0, parseNodes(capture.uiaText).filter((node) => node.className.includes('EditText')).length - 1))
  if (!tokenEntered) throw new Error('Could not focus the mock provider token input.')
  sleep(400)
  inputText(device, fakeApiKey)
  sleep(700)
  capture = captureStep(device, result, 'mock-provider-token-entered')
  const baseUrlValue = editableValueByContentDesc(capture.uiaText, ['站点 / Base URL', 'Site / Base URL', 'Base URL'])
  if (baseUrlValue.includes(fakeApiKey)) {
    throw new Error('Mock provider token was entered into the Base URL field instead of the token input.')
  }
  const tokenDraftValue = editableValueByContentDesc(capture.uiaText, ['新增令牌', 'Add tokens'])
  if (tokenDraftValue !== fakeApiKey) {
    throw new Error(`Mock provider token input did not preserve the exact fixture key (${tokenDraftValue.length}/${fakeApiKey.length} characters).`)
  }
  runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  sleep(700)
  capture = captureStep(device, result, 'mock-provider-token-entered-keyboard-closed')
  let added = tapEnabledButtonByContentDesc(device, capture.uiaText, ['加入', 'Add'])
    || tapText(device, capture.uiaText, ['加入', 'Add'])
    || tapActionNearText(device, capture.uiaText, ['令牌分组', 'Token groups'], ['加入', 'Add'])
    || tapActionNearText(device, capture.uiaText, ['新增令牌', 'Add tokens'], ['加入', 'Add'])
  if (!added) {
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
    sleep(700)
    capture = captureStep(device, result, 'mock-provider-token-entered-keyboard-closed')
    added = tapEnabledButtonByContentDesc(device, capture.uiaText, ['加入', 'Add'])
      || tapText(device, capture.uiaText, ['加入', 'Add'])
      || tapActionNearText(device, capture.uiaText, ['令牌分组', 'Token groups'], ['加入', 'Add'])
      || tapActionNearText(device, capture.uiaText, ['新增令牌', 'Add tokens'], ['加入', 'Add'])
  }
  if (!added) throw new Error('Could not add the mock provider token group.')
  sleep(900)
  capture = captureStep(device, result, 'mock-provider-token-added')
  if (!hasAnyText(capture.uiaText, ['保存', 'Save'])) {
    const saveSearch = findByScrolling(device, ['保存', 'Save'], 'mock-provider-save-ready-up', 4, result)
    capture = saveSearch.matched ? saveSearch.capture : scrollToText(device, ['保存', 'Save'], 'mock-provider-save-ready-down', 4, result)
  }
  const saved = tapEnabledButtonByContentDesc(device, capture.uiaText, ['保存', 'Save'])
    || tapText(device, capture.uiaText, ['保存', 'Save'])
    || tapActionNearText(device, capture.uiaText, ['新增令牌', 'Add tokens'], ['保存', 'Save'])
  if (!saved) throw new Error('Could not save the mock provider token.')
  sleep(1600)
  capture = captureStep(device, result, 'mock-provider-token-saved')
  result.providerConfigured = hasAnyText(capture.uiaText, ['已保存', 'saved', '令牌分组 1', '1 token group', 'Token groups 1'])

  const fetchModelsLabels = ['获取模型并测试', 'Fetch models and test']
  if (!hasTappableText(capture.uiaText, fetchModelsLabels)) {
    capture = scrollToTappableText(device, fetchModelsLabels, 'mock-provider-test-ready', 8, result)
  }
  result.providerTestTapped = tapEnabledButtonByContentDesc(device, capture.uiaText, fetchModelsLabels)
    || tapText(device, capture.uiaText, fetchModelsLabels)
    || tapActionNearText(device, capture.uiaText, [providerName], fetchModelsLabels)
  if (!result.providerTestTapped) throw new Error('Could not tap Fetch models and test for mock provider.')
  sleep(3600)
  capture = captureStep(device, result, 'mock-provider-fetch-and-test-result')
  if (!hasAnyText(capture.uiaText, ['获取模型并测试完成', 'Fetch models and test complete', '模型测试通过', 'model test passed', modelId])) {
    sleep(2600)
    capture = captureStep(device, result, 'mock-provider-fetch-and-test-result-retry')
  }
  result.captures.providerTestPng = capture.png
  result.captures.providerTestUia = capture.uia
  result.providerTestOk = hasAnyText(capture.uiaText, ['获取模型并测试完成', 'Fetch models and test complete', '模型测试通过', 'model test passed'])
  tapText(device, capture.uiaText, ['知道了', 'OK', '关闭', 'Close'])
  sleep(800)
}

function runSourceStackScenario(device, result) {
  openUrl(device, `islemind://chat/${seededConversationId}`)
  sleep(2600)
  let capture = waitForText(device, [seededAssistantToken, 'QA Mock Source Detail', '来源', 'Sources'], 'chat-responses-json-complete', 7, result)
  if (!hasAnyText(capture.uiaText, [seededAssistantToken])) {
    capture = findByScrolling(device, [seededAssistantToken], 'chat-responses-json-complete-search', 5, result).capture
  }
  result.captures.seededChatPng = capture.png
  result.captures.seededChatUia = capture.uia
  result.streamCompleteVisible = result.streamCompleteVisible || hasAnyText(capture.uiaText, [seededAssistantToken])

  const actions = openMessageActions(device, result, capture, 'chat-message-actions-menu')
  result.actionsMenuOpened = hasAnyText(actions.uiaText, ['复制', 'Copy', '朗读', 'Speak', '重新生成', 'Regenerate'])
  result.captures.actionsPng = actions.png
  result.captures.actionsUia = actions.uia
  swipeUp(device)
  sleep(550)
  const raisedActions = captureStep(device, result, 'message-delete-actions-raised')
  const deleteActions = hasAnyText(raisedActions.uiaText, ['删除', 'Delete']) ? raisedActions : actions

  let confirm = captureStep(device, result, 'message-delete-confirm')
  if (!isDeleteConfirm(confirm.uiaText) && tapText(device, deleteActions.uiaText, ['删除', 'Delete'])) {
    sleep(900)
    confirm = captureStep(device, result, 'message-delete-confirm-from-actions')
  }
  let actionsForHorizontalScroll = confirm
  for (let index = 0; !isDeleteConfirm(confirm.uiaText) && index < 3; index += 1) {
    swipeActionsRowLeft(device, actionsForHorizontalScroll.uiaText)
    sleep(450)
    const scrolledActions = captureStep(device, result, `message-delete-actions-scroll-${index}`)
    actionsForHorizontalScroll = scrolledActions
    if (tapText(device, scrolledActions.uiaText, ['删除', 'Delete'])) {
      sleep(900)
      confirm = captureStep(device, result, `message-delete-confirm-from-actions-${index}`)
    }
  }
  if (!isDeleteConfirm(confirm.uiaText)) {
    if (!tapText(device, deleteActions.uiaText, ['收起', 'Collapse'])) {
      openUrl(device, `islemind://chat/${seededConversationId}`)
    }
    sleep(900)
    capture = captureStep(device, result, 'chat-message-delete-ready')
    if (!hasAnyText(capture.uiaText, [seededAssistantToken])) {
      openUrl(device, `islemind://chat/${seededConversationId}`)
      sleep(1600)
      capture = waitForText(device, [seededAssistantToken], 'chat-message-delete-ready-restored', 5, result)
    }
    const longPressNode = findNodeByText(parseNodes(capture.uiaText), [seededAssistantToken]) || largestAssistantLikeNode(capture.uiaText)
    if (longPressNode?.bounds) {
      longPressBoundsCenter(device, longPressNode.bounds)
      sleep(1000)
    }
    confirm = captureStep(device, result, 'message-delete-confirm')
    if (!isDeleteConfirm(confirm.uiaText) && tapText(device, confirm.uiaText, ['删除', 'Delete'])) {
      sleep(900)
      confirm = captureStep(device, result, 'message-delete-confirm')
    }
  }
  result.deleteConfirmVisible = isDeleteConfirm(confirm.uiaText)
  result.captures.deleteConfirmPng = confirm.png
  result.captures.deleteConfirmUia = confirm.uia
  tapText(device, confirm.uiaText, ['取消', 'Cancel'])
  sleep(650)

  openUrl(device, `islemind://chat/${seededConversationId}`)
  sleep(1400)
  capture = captureStep(device, result, 'source-from-chat-ready')
  const sourceTapped = tapText(device, capture.uiaText, ['查看来源', 'View sources', '来源', 'Source', '引用 1', 'Citation 1', '1'])
    || tapActionNearText(device, capture.uiaText, [seededAssistantToken], ['查看来源', 'View sources', '来源', 'Source', '引用 1', 'Citation 1', '1'])
  if (sourceTapped) sleep(1800)
  let source = captureStep(device, result, 'source-from-chat')
  if (!hasAnyText(source.uiaText, ['QA Mock Source Detail', 'QA_MOCK_SOURCE_EXCERPT', '来源', 'Source'])) {
    openUrl(device, `islemind://source?conversationId=${seededConversationId}&messageId=${seededAssistantMessageId}&citationId=qa-mock-citation-1`)
    sleep(1800)
    source = captureStep(device, result, 'source-detail')
  }
  result.sourceOpened = hasAnyText(source.uiaText, ['QA Mock Source Detail', 'QA_MOCK_SOURCE_EXCERPT'])
  result.captures.sourcePng = source.png
  result.captures.sourceUia = source.uia
  if (!tapEnabledButtonByContentDesc(device, source.uiaText, ['返回聊天', 'Back to chat'])) {
    runCommand('adb', ['-s', device, 'shell', 'input', 'keyevent', '4'])
  }
  sleep(1500)
  let back = captureStep(device, result, 'source-from-chat-back')
  if (!hasAnyText(back.uiaText, [seededAssistantToken, 'QA Mock Provider Source Stack'])) {
    openUrl(device, `islemind://chat/${seededConversationId}`)
    sleep(1500)
    back = captureStep(device, result, 'source-from-chat-back')
  }
  result.sourceBackReturned = hasAnyText(back.uiaText, [seededAssistantToken, 'QA Mock Provider Source Stack'])
  result.captures.sourceBackPng = back.png
  result.captures.sourceBackUia = back.uia
}

function captureLongContentStressStates(device, result) {
  const captures = {}
  openUrl(device, `islemind://chat/${liveConversationId}`)
  sleep(1800)
  let provider = waitForText(device, ['Message input', '输入消息', 'メッセージ入力'], 'long-provider-model-chat-ready', 6, result)
  if (!tapText(device, provider.uiaText, ['Tools: Files/Knowledge', '工具: 附件/知识', '工具', 'Tools', 'ツール'])) {
    throw new Error('Long-content provider/model evidence could not open the chat tools panel.')
  }
  sleep(650)
  const toolsPanel = waitForText(device, ['Model:', '模型:', 'モデル:'], 'long-provider-model-tools-ready', 6, result)
  const modelTrigger = findHomeModelTriggerNode(toolsPanel.uiaText)
  if (!modelTrigger || !tapBoundsCenter(device, modelTrigger.bounds)) {
    throw new Error('Long-content provider/model evidence could not open the chat model picker.')
  }
  sleep(850)
  provider = waitForText(device, [longContentModelId], 'long-provider-model-ready', 6, result)
  assertLongContentStressCapture(provider, 'providerModel')
  provider = captureStep(device, result, 'long-provider-model')
  assertLongContentStressCapture(provider, 'providerModel')
  captures.providerModel = { png: provider.png, uia: provider.uia }

  openUrl(device, `islemind://source?conversationId=${seededConversationId}&messageId=${seededAssistantMessageId}&kind=process`)
  sleep(1400)
  const trace = waitForText(device, [longContentTraceTitle], 'long-trace-ready', 6, result)
  if (!hasAnyText(trace.uiaText, [longContentTraceTitle])) throw new Error('Long-content trace evidence did not render the verbose tool trace title.')
  const traceCapture = captureStep(device, result, 'long-trace')
  assertLongContentStressCapture(traceCapture, 'trace')
  captures.trace = { png: traceCapture.png, uia: traceCapture.uia }

  openUrl(device, `islemind://source?conversationId=${seededConversationId}&messageId=${seededAssistantMessageId}&citationId=qa-long-content-citation`)
  sleep(1400)
  const citation = waitForText(device, [longContentCitationTitle], 'long-citation-ready', 6, result)
  if (!hasAnyText(citation.uiaText, [longContentCitationTitle])) throw new Error('Long-content citation evidence did not render the verbose citation title.')
  const citationCapture = captureStep(device, result, 'long-citation')
  assertLongContentStressCapture(citationCapture, 'citation')
  captures.citation = { png: citationCapture.png, uia: citationCapture.uia }

  openUrl(device, `islemind://source?conversationId=${seededConversationId}&messageId=${seededAssistantMessageId}&citationId=qa-long-content-knowledge`)
  sleep(1400)
  const knowledge = waitForText(device, [longContentKnowledgeTitle], 'long-knowledge-ready', 6, result)
  if (!hasAnyText(knowledge.uiaText, [longContentKnowledgeTitle])) throw new Error('Long-content knowledge evidence did not render the verbose document title.')
  const knowledgeCapture = captureStep(device, result, 'long-knowledge')
  assertLongContentStressCapture(knowledgeCapture, 'knowledge')
  captures.knowledge = { png: knowledgeCapture.png, uia: knowledgeCapture.uia }

  return { passed: true, captures }
}

function assertLongContentStressCapture(capture, kind) {
  if (!capture?.png || !capture?.uia) throw new Error(`Long-content ${kind} evidence did not produce a paired screenshot/UIA capture.`)
  const markers = longContentStressEvidenceMarkers[kind] ?? []
  if (markers.some((marker) => !String(capture.uiaText ?? '').includes(marker))) {
    throw new Error(`Long-content ${kind} evidence is missing one or more required UIA markers.`)
  }
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

function runStreamingScenario(device, result) {
  openUrl(device, `islemind://chat/${liveConversationId}`)
  sleep(2200)
  let capture = waitForText(device, ['输入消息', 'Message input', '给 IsleMind 一个任务'], 'mock-live-chat-start', 8, result)
  const inputFocused = tapText(device, capture.uiaText, ['输入消息', 'Message input', '给 IsleMind 一个任务'])
    || tapEditableAtIndex(device, capture.uiaText, 0)
  if (!inputFocused) throw new Error('Could not focus live chat composer input.')
  sleep(500)
  inputText(device, livePrompt)
  sleep(800)
  capture = captureStep(device, result, 'mock-live-chat-prompt-entered')
  result.streamSent = tapText(device, capture.uiaText, ['发送消息', 'Send message'])
    || tapActionNearText(device, capture.uiaText, [livePrompt.slice(0, 16), '输入消息', 'Message input'], ['发送消息', 'Send message'])
    || tapBottomRight(device)
  if (!result.streamSent) throw new Error('Could not tap Send for live mock chat.')
  sleep(1000)
  let inflight = captureStep(device, result, 'chat-responses-json-inflight')
  if (!hasAnyText(inflight.uiaText, [streamPartialToken, '正在', 'stream', 'reader'])) {
    sleep(1400)
    inflight = captureStep(device, result, 'chat-responses-json-inflight-retry')
  }
  result.streamInflightVisible = hasAnyText(inflight.uiaText, [streamPartialToken, 'stream', 'reader', '生成中'])
  result.captures.inflightPng = inflight.png
  result.captures.inflightUia = inflight.uia

  sleep(6500)
  let complete = captureStep(device, result, 'chat-responses-json-complete')
  if (!hasAnyText(complete.uiaText, [streamCompleteToken])) {
    sleep(3500)
    complete = captureStep(device, result, 'chat-responses-json-complete-retry')
  }
  result.streamInflightVisible = result.streamInflightVisible || hasAnyText(complete.uiaText, [streamPartialToken, 'stream', 'reader', '生成中'])
  result.streamCompleteVisible = hasAnyText(complete.uiaText, [streamCompleteToken]) && !hasAnyText(complete.uiaText, ['fetch failed', '发送失败', 'Network request failed'])
  result.captures.completePng = complete.png
  result.captures.completeUia = complete.uia
}

function ensureSettingsVisible(device, result) {
  let capture = captureStep(device, result, 'mock-provider-settings-start')
  if (hasAnyText(capture.uiaText, ['导入 JSON', 'AI 工作区就绪度', '导入 / 导出', 'Import JSON'])) return capture
  return capture
}

function tapImportJson(device, result) {
  for (let index = 0; index < 8; index += 1) {
    let capture = captureStep(device, result, `mock-provider-import-search-${index}`)
    if (!hasAnyText(capture.uiaText, ['导入 JSON', 'Import JSON'])) {
      const disclosureTapped = tapText(device, capture.uiaText, [
        '展开导入 / 导出',
        'Expand Import / Export',
        'Import / Export',
        'インポート / エクスポートを展開',
        'インポート / エクスポート',
      ])
      if (disclosureTapped) {
        sleep(700)
        capture = captureStep(device, result, `mock-provider-import-disclosure-${index}`)
      }
    }
    if (tapText(device, capture.uiaText, ['导入 JSON', 'Import JSON'])) {
      sleep(1700)
      const afterTap = captureStep(device, result, `mock-provider-import-after-tap-${index}`)
      if (isDocumentsUi(afterTap.uiaText) || hasAnyText(afterTap.uiaText, ['导入完成', 'Import complete'])) return afterTap
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error('Could not find the Settings import JSON action.')
}

function selectFileAndCaptureImportDialog(device, result) {
  let searched = false
  for (let index = 0; index < 8; index += 1) {
    const capture = captureStep(device, result, `mock-provider-file-picker-search-${index}`)
    if (classifyImportTerminalState(capture.uiaText) !== 'pending') return capture
    if (!isDocumentsUi(capture.uiaText) && tapText(device, capture.uiaText, ['导入 JSON', 'Import JSON'])) {
      sleep(1700)
      continue
    }
    if (tapFileTitle(device, capture.uiaText, fixtureName)) {
      return completeDocumentsUiSelection(device, result, 'mock-provider-import-confirm')
    }
    if (!searched && isDocumentsUi(capture.uiaText)) {
      searched = true
      const searchedCapture = searchDocumentsUiFile(device, result, fixtureName)
      if (searchedCapture) return searchedCapture
    }
    swipeUp(device)
    sleep(350)
  }
  throw new Error(`Could not find the mock provider fixture ${fixtureName} in Android DocumentsUI.`)
}

function searchDocumentsUiFile(device, result, fileName) {
  let capture = captureStep(device, result, 'mock-provider-file-picker-search-open')
  if (!tapText(device, capture.uiaText, ['Search', '搜索', '検索'])) return null
  sleep(700)
  capture = captureStep(device, result, 'mock-provider-file-picker-search-field')
  tapEditableAtIndex(device, capture.uiaText, 0)
  sleep(300)
  inputText(device, fileName)
  sleep(1400)
  capture = captureStep(device, result, 'mock-provider-file-picker-search-result')
  if (tapFileTitle(device, capture.uiaText, fileName)) {
    return completeDocumentsUiSelection(device, result, 'mock-provider-import-confirm')
  }
  return selectDocumentsUiFileFromDownloads(device, result, fileName)
}

function selectDocumentsUiFileFromDownloads(device, result, fileName) {
  const clearQuery = captureStep(device, result, 'mock-provider-file-picker-search-clear')
  if (tapText(device, clearQuery.uiaText, ['Clear query', '清除查询', 'クリア'])) {
    sleep(250)
  }
  back(device)
  sleep(650)
  let capture = captureStep(device, result, 'mock-provider-file-picker-recent')
  if (!isDocumentsUi(capture.uiaText)) return null
  if (!tapText(device, capture.uiaText, ['Show roots', '显示根目录', 'ルートを表示'])) return null
  sleep(650)
  capture = captureStep(device, result, 'mock-provider-file-picker-roots')
  if (!tapText(device, capture.uiaText, ['Downloads', 'Download', '下载'])) return null
  sleep(1200)
  capture = captureStep(device, result, 'mock-provider-file-picker-downloads')
  if (!tapFileTitle(device, capture.uiaText, fileName)) return null
  return completeDocumentsUiSelection(device, result, 'mock-provider-import-confirm')
}

function completeDocumentsUiSelection(device, result, captureName) {
  sleep(1400)
  let capture = captureStep(device, result, `${captureName}-selection`)
  if (isDocumentsUi(capture.uiaText) && hasAnyText(capture.uiaText, ['selected', '已选择', '已選取'])) {
    const confirmed = tapText(device, capture.uiaText, ['Select', '选择', '選取'])
    if (confirmed) sleep(2200)
  }
  capture = captureStep(device, result, captureName)
  return waitForImportTerminalState(device, result, captureName, capture)
}

function classifyImportTerminalState(uiaText) {
  if (hasAnyText(uiaText, ['导入完成', 'Import complete', 'インポート完了'])) return 'success'
  if (hasAnyText(uiaText, ['未导入', 'Not imported', 'インポートされませんでした'])) return 'failure'
  return 'pending'
}

function waitForImportTerminalState(device, result, captureName, initialCapture, maxAttempts = 10) {
  let capture = initialCapture
  if (classifyImportTerminalState(capture.uiaText) !== 'pending') return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(700)
    capture = captureStep(device, result, `${captureName}-wait-${attempt}`)
    if (classifyImportTerminalState(capture.uiaText) !== 'pending') return capture
  }
  return capture
}

function openMessageActions(device, result, initialCapture, captureName) {
  let latest = initialCapture
  if (hasAnyText(latest.uiaText, ['复制工作产物', 'Copy work artifact', '朗读', 'Speak'])) return latest
  for (let round = 0; round < 8; round += 1) {
    const longPressNode = findNodeByText(parseNodes(latest.uiaText), [seededAssistantToken])
      || largestAssistantLikeNode(latest.uiaText)
    if (longPressNode?.bounds) {
      longPressBoundsCenter(device, longPressNode.bounds)
      sleep(650)
      const candidate = captureStep(device, result, round === 0 ? captureName : `${captureName}-${round}`)
      if (hasAnyText(candidate.uiaText, ['复制', 'Copy', '朗读', 'Speak', '重新生成', 'Regenerate'])) return candidate
      tapText(device, candidate.uiaText, ['收起', 'Collapse'])
      sleep(200)
    }
    swipeUp(device)
    sleep(350)
    latest = captureStep(device, result, `${captureName}-search-${round}`)
  }
  return latest
}

function waitForText(device, labels, captureName, maxAttempts, result, intervalMs = 700) {
  let capture = captureStep(device, result, captureName)
  if (hasAnyText(capture.uiaText, labels)) return capture
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    sleep(intervalMs)
    capture = captureStep(device, result, `${captureName}-${attempt}`)
    if (hasAnyText(capture.uiaText, labels)) return capture
  }
  return capture
}

function scrollToText(device, labels, capturePrefix, maxScrolls, result) {
  let capture = captureStep(device, result, `${capturePrefix}-0`)
  if (hasUsableText(capture.uiaText, labels)) return capture
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(550)
    capture = captureStep(device, result, `${capturePrefix}-${index}`)
    if (hasUsableText(capture.uiaText, labels)) return capture
  }
  return capture
}

function scrollToTappableText(device, labels, capturePrefix, maxScrolls, result) {
  let capture = captureStep(device, result, `${capturePrefix}-0`)
  if (hasTappableText(capture.uiaText, labels)) return capture
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeDown(device)
    sleep(550)
    capture = captureStep(device, result, `${capturePrefix}-up-${index}`)
    if (hasTappableText(capture.uiaText, labels)) return capture
  }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeUp(device)
    sleep(550)
    capture = captureStep(device, result, `${capturePrefix}-down-${index}`)
    if (hasTappableText(capture.uiaText, labels)) return capture
  }
  return capture
}

function findByScrolling(device, labels, capturePrefix, maxScrolls, result) {
  let capture = captureStep(device, result, `${capturePrefix}-0`)
  if (hasUsableText(capture.uiaText, labels)) return { matched: true, capture }
  for (let index = 1; index <= maxScrolls; index += 1) {
    swipeDown(device)
    sleep(550)
    capture = captureStep(device, result, `${capturePrefix}-${index}`)
    if (hasUsableText(capture.uiaText, labels)) return { matched: true, capture }
  }
  return { matched: false, capture }
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
    visibleText: extractVisibleText(uiaText).slice(0, 80),
  }
  result.steps.push(step)
  return { png: step.png, uia: step.uia, uiaText }
}

function captureFileWithRetry(device, remotePath, localPath, captureRemote) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stagingPath = `${localPath}.${process.pid}.${Date.now()}.${attempt}.tmp`
    runCommand('adb', ['-s', device, 'shell', 'rm', '-f', remotePath])
    try {
      captureRemote()
      const pulled = runCommand('adb', ['-s', device, 'pull', remotePath, stagingPath]) !== null
      if (pulled && fs.existsSync(stagingPath) && fs.statSync(stagingPath).size > 0) {
        fs.copyFileSync(stagingPath, localPath)
        return true
      }
    } finally {
      fs.rmSync(stagingPath, { force: true })
      runCommand('adb', ['-s', device, 'shell', 'rm', '-f', remotePath])
    }
    sleep(350 + attempt * 350)
  }
  return false
}

function tapText(device, uiaText, labels) {
  const node = findTappableTextNode(parseNodes(uiaText), labels)
  if (!node) return false
  return tapBoundsCenter(device, node.bounds)
}

function tapActionNearText(device, uiaText, anchorLabels, actionLabels) {
  const nodes = parseNodes(uiaText)
  const anchor = nodes.find((node) => isUsableBounds(node.bounds) && textMatchesAny(node, anchorLabels))
  const anchorBounds = parseBounds(anchor?.bounds)
  if (!anchorBounds) return false
  const candidates = nodes
    .filter((node) => node.enabled && isUsableBounds(node.bounds) && textMatchesAny(node, actionLabels))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds)
    .filter(({ bounds }) => !anchorBounds || bounds.top >= anchorBounds.top - 20)
    .sort((left, right) => {
      if (!anchorBounds) return left.bounds.top - right.bounds.top
      return Math.abs(left.bounds.top - anchorBounds.top) - Math.abs(right.bounds.top - anchorBounds.top)
    })
  const candidate = candidates[0]?.node
  if (!candidate) return false
  return tapBoundsCenter(device, candidate.bounds)
}

function tapEditableAtIndex(device, uiaText, index) {
  const editables = parseNodes(uiaText).filter((node) => node.enabled && isUsableBounds(node.bounds) && node.className.includes('EditText'))
  const node = editables[index]
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapEditableByContentDesc(device, uiaText, labels) {
  const candidates = parseNodes(uiaText)
    .filter((node) => node.enabled && isUsableBounds(node.bounds) && node.className.includes('EditText'))
    .filter((node) => labels.some((label) => node.contentDesc === label))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds)
    .sort((left, right) => left.bounds.top - right.bounds.top)
  const node = candidates[0]?.node
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapEnabledButtonByContentDesc(device, uiaText, labels) {
  const candidates = parseNodes(uiaText)
    .filter((node) => node.enabled && node.clickable && isUsableBounds(node.bounds) && node.className.includes('Button'))
    .filter((node) => labels.some((label) => node.contentDesc === label))
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds)
    .sort((left, right) => left.bounds.top - right.bounds.top)
  const node = candidates[0]?.node
  if (!node) return false
  tapBoundsCenter(device, node.bounds)
  return true
}

function tapEditableNearLabel(device, uiaText, labels) {
  const nodes = parseNodes(uiaText)
  const editables = nodes.filter((node) => node.enabled && isUsableBounds(node.bounds) && node.className.includes('EditText'))
  const labelNode = nodes.find((node) => isUsableBounds(node.bounds) && textMatchesAny(node, labels))
  const labelBounds = parseBounds(labelNode?.bounds)
  const candidate = editables
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && (!labelBounds || bounds.top >= labelBounds.top - 18))
    .sort((left, right) => left.bounds.top - right.bounds.top)[0]?.node
  if (!candidate) return false
  tapBoundsCenter(device, candidate.bounds)
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
  const previewBounds = parseBounds(previewNode.bounds)
  if (!previewBounds) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.max(1, previewBounds.left - 80)), String(Math.round((previewBounds.top + previewBounds.bottom) / 2))])
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
  return centerX >= 0 && centerX <= 1080 && centerY >= 48 && centerY <= 2266
}

function boundsContains(container, inner) {
  return inner.left >= container.left && inner.right <= container.right && inner.top >= container.top && inner.bottom <= container.bottom
}

function boundsArea(bounds) {
  return Math.max(0, bounds.right - bounds.left) * Math.max(0, bounds.bottom - bounds.top)
}

function tapBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box || !isUsableBounds(bounds)) return false
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', String(Math.round((box.left + box.right) / 2)), String(Math.round((box.top + box.bottom) / 2))])
  return true
}

function longPressBoundsCenter(device, bounds) {
  const box = parseBounds(bounds)
  if (!box) return
  const x = String(Math.round((box.left + box.right) / 2))
  const y = String(Math.round((box.top + box.bottom) / 2))
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', x, y, x, y, '950'])
}

function tapBottomRight(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'tap', '982', '1772'])
  return true
}

function swipeUp(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '1580', '432', '560', '420'])
}

function swipeDown(device) {
  runCommand('adb', ['-s', device, 'shell', 'input', 'swipe', '432', '620', '432', '1580', '450'])
}

function swipeActionsRowLeft(device, uiaText) {
  const swipe = resolveActionsRowSwipe(uiaText)
  runCommand('adb', [
    '-s',
    device,
    'shell',
    'input',
    'swipe',
    String(swipe.startX),
    String(swipe.startY),
    String(swipe.endX),
    String(swipe.endY),
    String(swipe.durationMs),
  ])
}

function resolveActionsRowSwipe(uiaText) {
  const bounds = parseNodes(uiaText)
    .filter((node) => node.className.includes('HorizontalScrollView') && textMatchesAny(node, ['操作', 'Actions', 'アクション']))
    .map((node) => parseBounds(node.bounds))
    .filter((box) => box && box.right > box.left && box.bottom > box.top)
    .sort((a, b) => boundsArea(b) - boundsArea(a))[0]
  if (!bounds) {
    return { startX: 930, startY: 1950, endX: 360, endY: 1950, durationMs: 360 }
  }
  const rowWidth = bounds.right - bounds.left
  const startX = Math.max(bounds.left + 1, bounds.right - 28)
  const endX = Math.min(startX - 1, bounds.left + Math.min(305, Math.floor(rowWidth * 0.35)))
  const centerY = Math.round((bounds.top + bounds.bottom) / 2)
  return { startX, startY: centerY, endX, endY: centerY, durationMs: 360 }
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
  const remoteCommand = ['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', quoteAndroidShellArgument(url)].join(' ')
  runCommand('adb', ['-s', device, 'shell', remoteCommand])
}

function quoteAndroidShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function pushFixture(device) {
  const output = runCommand('adb', ['-s', device, 'push', fixturePath, remoteFixturePath])
  if (output !== null) {
    runCommand('adb', ['-s', device, 'shell', 'touch', remoteFixturePath])
    runCommand('adb', [
      '-s',
      device,
      'shell',
      'am',
      'broadcast',
      '-a',
      'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
      '-d',
      `file://${remoteFixturePath}`,
    ])
  }
  return output !== null
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

function startMockProviderServer(logPath, requestedPort = 0) {
  const stateBuffer = new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT)
  const state = new Int32Array(stateBuffer)
  const instance = new Worker(__filename, { workerData: { logPath, requestedPort, stateBuffer } })
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
      fs.appendFileSync(workerData.logPath, `${JSON.stringify({ timestamp: receivedAt, receivedAt, method: request.method, path: request.url, url: request.url, body })}\n`, 'utf8')
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
        if (payload.stream === true) {
          writeStreamingCompletion(response)
          return
        }
        const assistantContent = longContentRequestLogMode && payload.max_tokens === 512
          ? JSON.stringify(['用户偏好：QA_LONG_CONTENT_PREFERENCE = cyan-lake'])
          : 'OK'
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({
          id: 'chatcmpl-qa-mock-test',
          object: 'chat.completion',
          model: payload.model ?? modelId,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: assistantContent },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
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
  server.listen(workerData.requestedPort || 0, '0.0.0.0', () => {
    Atomics.store(state, 0, server.address().port)
    Atomics.store(state, 1, 1)
    Atomics.notify(state, 1)
    parentPort?.postMessage({ port: server.address().port })
  })
}

function writeStreamingCompletion(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  })
  const chunks = [
    `${streamPartialToken} `,
    '仍在生成，',
    streamCompleteToken,
  ]
  let index = 0
  const timer = setInterval(() => {
    if (index < chunks.length) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index] }, index: 0, finish_reason: null }] })}\n\n`)
      index += 1
      return
    }
    clearInterval(timer)
    response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 16, completion_tokens: 7, total_tokens: 23 } })}\n\n`)
    response.write('data: [DONE]\n\n')
    response.end()
  }, 2200)
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

function waitForLongContentRequestRows(logPath, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    if (hasLongContentStreamingRequest(readJsonl(logPath)) && hasLongContentMemoryExtractionRequest(readJsonl(logPath))) return true
    sleep(500)
  }
  throw new Error('Timed out waiting for long-content streaming and memory extraction request rows.')
}

function captureLongContentDurableState(device) {
  const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-long-content-state-'))
  const localDatabasePath = path.join(snapshotDir, 'islemind-context.db')
  try {
    forceStop(device)
    const pulled = runCommand('adb', ['-s', device, 'pull', contextDatabaseRemotePath, localDatabasePath])
    if (pulled === null || !fs.existsSync(localDatabasePath)) {
      throw new Error(`Could not pull the release SQLite database from ${contextDatabaseRemotePath}; a rooted or debuggable device is required for durable-state proof.`)
    }
    for (const suffix of ['-wal', '-shm']) {
      runCommand('adb', [
        '-s',
        device,
        'pull',
        `${contextDatabaseRemotePath}${suffix}`,
        `${localDatabasePath}${suffix}`,
      ])
    }
    return readLongContentDurableState(localDatabasePath)
  } finally {
    fs.rmSync(snapshotDir, { recursive: true, force: true })
  }
}

function readLongContentDurableState(databasePath) {
  let Database
  try {
    ({ Database } = require('bun:sqlite'))
  } catch {
    throw new Error('Durable SQLite evidence requires the Bun runtime.')
  }
  const database = new Database(databasePath, { readonly: true })
  try {
    const run = database.query(`
      SELECT id, kind, conversationId, responseMessageId, providerId, model,
             status, completedAt, journalSequence, resultJson
      FROM assistant_runs
      WHERE conversationId = ?
      ORDER BY createdAt DESC
      LIMIT 1
    `).get(longContentConversationId)
    const journal = run
      ? database.query(`
          SELECT sequence, type, occurredAt
          FROM assistant_run_journal
          WHERE runId = ?
          ORDER BY sequence ASC
        `).all(run.id)
      : []
    const conversation = readNormalizedConversationEvidence(database, longContentConversationId)
    const messages = Array.isArray(conversation?.messages) ? conversation.messages : []
    const assistantMessage = messages.find((message) => message?.id === run?.responseMessageId)
      ?? [...messages].reverse().find((message) => message?.role === 'assistant')
    const retrievalTrace = Array.isArray(assistantMessage?.retrievalTrace)
      ? assistantMessage.retrievalTrace
      : []
    const memoryTrace = [...retrievalTrace]
      .reverse()
      .find((trace) => trace?.type === 'memory')
    const memories = database.query(`
      SELECT id, content, status, conversationId, sourceKind, sourceDetail, confidence,
             createdAt, updatedAt
      FROM memories
      WHERE conversationId = ? AND content LIKE ?
      ORDER BY updatedAt ASC
    `).all(longContentConversationId, '%QA_LONG_CONTENT_PREFERENCE%')
    const result = tryParseJson(run?.resultJson)
    return {
      capturedAt: new Date().toISOString(),
      conversationId: longContentConversationId,
      run: run
        ? {
            id: run.id,
            kind: run.kind,
            conversationId: run.conversationId,
            responseMessageId: run.responseMessageId,
            providerId: run.providerId,
            model: run.model,
            status: run.status,
            completedAt: run.completedAt,
            journalSequence: run.journalSequence,
            outputText: result?.outputText,
            streamEventCount: result?.streamEventCount,
          }
        : null,
      journal: journal.map((entry) => ({
        sequence: entry.sequence,
        type: entry.type,
        occurredAt: entry.occurredAt,
      })),
      message: assistantMessage
        ? {
            id: assistantMessage.id,
            role: assistantMessage.role,
            status: assistantMessage.status,
            content: assistantMessage.content,
            retrievalTraceCount: retrievalTrace.length,
          }
        : null,
      memoryTrace: memoryTrace
        ? {
            id: memoryTrace.id,
            type: memoryTrace.type,
            status: memoryTrace.status,
            content: memoryTrace.content,
            startedAt: memoryTrace.startedAt,
            completedAt: memoryTrace.completedAt,
            durationMs: memoryTrace.durationMs,
            metadata: {
              memoryEnabled: memoryTrace.metadata?.memoryEnabled,
              providerAvailable: memoryTrace.metadata?.providerAvailable,
              signalAborted: memoryTrace.metadata?.signalAborted,
              transitionStatus: memoryTrace.metadata?.transitionStatus,
              addedCount: memoryTrace.metadata?.addedCount,
            },
          }
        : null,
      memories: memories.map((memory) => ({
        id: memory.id,
        content: memory.content,
        status: memory.status,
        conversationId: memory.conversationId,
        sourceKind: memory.sourceKind,
        sourceDetail: memory.sourceDetail,
        confidence: memory.confidence,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      })),
    }
  } finally {
    database.close()
  }
}

function validateLongContentDurableState(state) {
  const issues = []
  const run = state?.run
  const message = state?.message
  const memoryTrace = state?.memoryTrace
  const memories = Array.isArray(state?.memories) ? state.memories : []
  const journal = Array.isArray(state?.journal) ? state.journal : []
  if (state?.conversationId !== longContentConversationId) issues.push('durable state has the wrong conversation id')
  if (!run) issues.push('missing persisted assistant run')
  else {
    if (run.kind !== 'chat') issues.push('persisted assistant run is not a chat run')
    if (run.status !== 'succeeded') issues.push(`persisted assistant run status is ${run.status ?? 'missing'}`)
    if (run.providerId !== longContentProviderId) issues.push('persisted assistant run provider identity changed')
    if (run.model !== longContentModelId) issues.push('persisted assistant run model identity changed')
    if (!run.responseMessageId) issues.push('persisted assistant run has no response message id')
    if (!journal.some((entry) => entry.type === 'run.succeeded')) issues.push('missing run.succeeded journal entry')
    if (!String(run.outputText ?? '').includes(longContentStreamCompleteToken)) issues.push('persisted run output is missing the complete stream token')
  }
  if (!message) issues.push('missing persisted assistant message')
  else {
    if (message.role !== 'assistant' || message.status !== 'done') issues.push('persisted assistant message is not done')
    if (!String(message.content ?? '').includes(longContentStreamCompleteToken)) issues.push('persisted assistant message is missing the complete stream token')
    if (run?.responseMessageId && message.id !== run.responseMessageId) issues.push('persisted message identity does not match the run')
  }
  if (!memoryTrace) issues.push('missing persisted memory extraction trace')
  else {
    if (memoryTrace.type !== 'memory' || memoryTrace.status !== 'done') issues.push('memory extraction trace is not terminal done')
    if (memoryTrace.metadata?.transitionStatus !== 'completed') issues.push('memory extraction trace did not record completed transition')
    if (memoryTrace.metadata?.signalAborted !== false) issues.push('memory extraction trace reports an aborted or unknown signal')
    if (!(Number(memoryTrace.metadata?.addedCount) > 0)) issues.push('memory extraction trace reports no added memories')
  }
  if (!memories.some((memory) =>
    memory.sourceKind === 'model' &&
    memory.status === 'pending' &&
    String(memory.content ?? '').includes('QA_LONG_CONTENT_PREFERENCE') &&
    String(memory.content ?? '').includes('cyan-lake'),
  )) {
    issues.push('missing pending model memory containing QA_LONG_CONTENT_PREFERENCE')
  }
  return issues
}

function createLongContentDurableStateFixture() {
  return {
    conversationId: longContentConversationId,
    run: {
      id: 'run-self-test',
      kind: 'chat',
      conversationId: longContentConversationId,
      responseMessageId: 'message-self-test',
      providerId: longContentProviderId,
      model: longContentModelId,
      status: 'succeeded',
      completedAt: 100,
      journalSequence: 2,
      outputText: longContentStreamCompleteToken,
      streamEventCount: 2,
    },
    journal: [{ sequence: 2, type: 'run.succeeded', occurredAt: 100 }],
    message: {
      id: 'message-self-test',
      role: 'assistant',
      status: 'done',
      content: longContentStreamCompleteToken,
      retrievalTraceCount: 1,
    },
    memoryTrace: {
      id: 'memory-self-test',
      type: 'memory',
      status: 'done',
      metadata: {
        signalAborted: false,
        transitionStatus: 'completed',
        addedCount: 1,
      },
    },
    memories: [{
      id: 'memory-row-self-test',
      content: '用户偏好：QA_LONG_CONTENT_PREFERENCE = cyan-lake',
      status: 'pending',
      sourceKind: 'model',
    }],
  }
}

function runSelfTest() {
  if (longContentProviderName.includes(longContentModelId)) {
    throw new Error('Long-content provider evidence must not satisfy the model marker through the provider name.')
  }
  const quotedUrl = quoteAndroidShellArgument("islemind://source?conversationId=qa-source&messageId=assistant's-message&kind=process")
  if (quotedUrl !== "'islemind://source?conversationId=qa-source&messageId=assistant'\\''s-message&kind=process'") {
    throw new Error(`Android-shell URI quoting self-test failed: ${quotedUrl}`)
  }
  const valid = createLongContentDurableStateFixture()
  const validIssues = validateLongContentDurableState(valid)
  if (validIssues.length) throw new Error(`Durable-state self-test rejected valid fixture: ${validIssues.join(', ')}`)
  const invalid = JSON.parse(JSON.stringify(valid))
  invalid.memoryTrace.metadata.signalAborted = true
  if (!validateLongContentDurableState(invalid).some((issue) => issue.includes('aborted'))) {
    throw new Error('Durable-state self-test did not reject an aborted memory trace.')
  }
  const floatingActionRow = '<node text="" content-desc="Actions" class="android.widget.HorizontalScrollView" bounds="[55,400][958,539]" enabled="true" />'
  const floatingSwipe = resolveActionsRowSwipe(floatingActionRow)
  if (JSON.stringify(floatingSwipe) !== JSON.stringify({ startX: 930, startY: 470, endX: 360, endY: 470, durationMs: 360 })) {
    throw new Error(`Action-row self-test did not derive the floating UIA bounds: ${JSON.stringify(floatingSwipe)}`)
  }
  const fallbackSwipe = resolveActionsRowSwipe('<node text="Chat" class="android.widget.TextView" bounds="[0,0][100,100]" enabled="true" />')
  if (JSON.stringify(fallbackSwipe) !== JSON.stringify({ startX: 930, startY: 1950, endX: 360, endY: 1950, durationMs: 360 })) {
    throw new Error(`Action-row self-test did not preserve the fallback gesture: ${JSON.stringify(fallbackSwipe)}`)
  }
  if (classifyImportTerminalState('<node text="Import complete" />') !== 'success') {
    throw new Error('Import-dialog self-test did not recognize a successful terminal state.')
  }
  if (classifyImportTerminalState('<node text="Not imported" />') !== 'failure') {
    throw new Error('Import-dialog self-test did not recognize a failed terminal state.')
  }
  if (classifyImportTerminalState('<node text="Settings" />') !== 'pending') {
    throw new Error('Import-dialog self-test did not preserve a pending import state.')
  }
  console.log('Mock provider collector self-test passed.')
}

function hasLongContentModelRequest(rows) {
  return requestBodies(rows).some(({ body }) => body.model === modelId)
}

function hasLongContentStreamingRequest(rows) {
  return requestBodies(rows).some(({ row, body }) => isPostRequest(row) && body.model === modelId && body.stream === true)
}

function hasLongContentMemoryExtractionRequest(rows) {
  return requestBodies(rows).some(({ row, body }) => isPostRequest(row) && body.max_tokens === 512)
}

function requestBodies(rows) {
  return rows
    .map((row) => ({ row, body: tryParseJson(row.body) }))
    .filter(({ body }) => body && typeof body === 'object')
}

function isPostRequest(row) {
  return String(row?.method ?? '').toUpperCase() === 'POST'
}

function isPassing(result) {
  const rows = readJsonl(requestLogPath)
  const bodies = rows.map((row) => tryParseJson(row.body)).filter(Boolean)
  if (longContentRequestLogMode) {
    return Boolean(
      result.device &&
      result.pushedFixture &&
      result.imported &&
      result.streamSent &&
      result.streamCompleteVisible &&
      hasLongContentModelRequest(rows) &&
      hasLongContentStreamingRequest(rows) &&
      hasLongContentMemoryExtractionRequest(rows) &&
      result.longContentStressEvidence?.passed === true &&
      result.durableState &&
      result.durableStateIssues.length === 0 &&
      result.errors.length === 0
    )
  }
  const hasModels = rows.some((row) => row.method === 'GET' && /\/v1\/models/.test(row.url ?? ''))
  const hasProviderTest = bodies.some((body) => body.model === modelId && body.stream === false && body.max_tokens === 32)
  const hasStreaming = bodies.some((body) => body.model === modelId && body.stream === true && (body.max_tokens === 4096 || body.max_output_tokens === 4096))
  return Boolean(
    result.device &&
    result.pushedFixture &&
    result.imported &&
    result.providerTestTapped &&
    result.streamSent &&
    result.streamInflightVisible &&
    result.streamCompleteVisible &&
    result.actionsMenuOpened &&
    result.deleteConfirmVisible &&
    result.sourceOpened &&
    result.sourceBackReturned &&
    hasModels &&
    hasProviderTest &&
    hasStreaming &&
    result.errors.length === 0
  )
}

function summarizeFailures(result) {
  const failures = []
  const rows = readJsonl(requestLogPath)
  if (longContentRequestLogMode) {
    for (const key of ['device', 'pushedFixture', 'imported', 'streamSent', 'streamCompleteVisible']) {
      if (!result[key]) failures.push(`${key}=false`)
    }
    if (!hasLongContentModelRequest(rows)) failures.push(`missing ${modelId} request`)
    if (!hasLongContentStreamingRequest(rows)) failures.push('missing streaming long-content request')
    if (!hasLongContentMemoryExtractionRequest(rows)) failures.push('missing memory extraction request with max_tokens=512')
    if (result.longContentStressEvidence?.passed !== true) failures.push('missing qualified long-content stress evidence')
    failures.push(...result.errors)
    return failures
  }
  for (const key of ['device', 'pushedFixture', 'imported', 'providerTestTapped', 'streamSent', 'streamInflightVisible', 'streamCompleteVisible', 'actionsMenuOpened', 'deleteConfirmVisible', 'sourceOpened', 'sourceBackReturned']) {
    if (!result[key]) failures.push(`${key}=false`)
  }
  const bodies = rows.map((row) => tryParseJson(row.body)).filter(Boolean)
  if (!rows.some((row) => row.method === 'GET' && /\/v1\/models/.test(row.url ?? ''))) failures.push('missing /v1/models')
  if (!bodies.some((body) => body.model === modelId && body.stream === false && body.max_tokens === 32)) failures.push('missing non-streaming provider test')
  if (!bodies.some((body) => body.model === modelId && body.stream === true && (body.max_tokens === 4096 || body.max_output_tokens === 4096))) failures.push('missing streaming chat request')
  failures.push(...result.errors)
  return failures
}

function findNodeByText(nodes, labels) {
  return nodes
    .filter((node) => node.enabled && textMatchesAny(node, labels))
    .sort((a, b) => boundsArea(parseBounds(b.bounds)) - boundsArea(parseBounds(a.bounds)))[0] ?? null
}

function largestAssistantLikeNode(uiaText) {
  return parseNodes(uiaText)
    .map((node) => ({ node, bounds: parseBounds(node.bounds) }))
    .filter(({ bounds }) => bounds && bounds.top > 180 && bounds.bottom < 1550 && bounds.right - bounds.left > 240)
    .sort((a, b) => boundsArea(b.bounds) - boundsArea(a.bounds))[0]?.node ?? null
}

function hasAnyText(text, values) {
  return values.some((value) => String(text ?? '').includes(value))
}

function hasUsableText(uiaText, labels) {
  return parseNodes(uiaText).some((node) => node.enabled && isUsableBounds(node.bounds) && textMatchesAny(node, labels))
}

function hasTappableText(uiaText, labels) {
  return Boolean(findTappableTextNode(parseNodes(uiaText), labels))
}

function isDeleteConfirm(uiaText) {
  return hasAnyText(uiaText, ['删除这条消息', 'Delete this message', '确认后才会删除', 'deleted after you confirm'])
}

function isDocumentsUi(uiaText) {
  const text = String(uiaText ?? '')
  return text.includes('com.google.android.documentsui')
    || text.includes('com.android.documentsui')
    || hasAnyText(text, ['Recent', 'Downloads', '最近', '下载', 'Open from', 'Show roots'])
}

function textMatchesAny(node, labels) {
  return labels.some((label) => node.text.includes(label) || node.contentDesc.includes(label))
}

function editableValueByContentDesc(uiaText, labels) {
  const node = parseNodes(uiaText)
    .filter((item) => item.enabled && item.className.includes('EditText'))
    .find((item) => labels.some((label) => item.contentDesc.includes(label)))
  return node?.text ?? ''
}

function extractVisibleText(uiaText) {
  const values = []
  for (const node of parseNodes(uiaText)) {
    if (node.text) values.push(node.text)
    if (node.contentDesc) values.push(node.contentDesc)
  }
  return [...new Set(values)]
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
  createLongContentDurableStateFixture,
  longContentStressEvidenceMarkers,
  longContentStressEvidencePaths,
  validateLongContentDurableState,
}
