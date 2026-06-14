const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const memoryStorage = new Map()
const secureStorage = new Map()
const contextMemoryRows = []
const localFileFixtures = new Map()
const localDownloadFixtures = new Map()
const localFileReadRequests = []
const localFileOperations = []
const launchedIntents = []
const supportedCpuArchitectures = ['arm64-v8a', 'armeabi-v7a']
let expoDeviceModuleAvailable = true
const reactNativePlatform = {
  OS: 'test',
  select: (choices) => choices?.[reactNativePlatform.OS] ?? choices?.default,
}

global.__DEV__ = false

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return {
      __esModule: true,
      default: {
        getItem: async (key) => memoryStorage.get(key) ?? null,
        setItem: async (key, value) => memoryStorage.set(key, value),
        removeItem: async (key) => memoryStorage.delete(key),
        multiRemove: async (keys) => keys.forEach((key) => memoryStorage.delete(key)),
      },
    }
  }
  if (request === 'expo-secure-store') {
    return {
      setItemAsync: async (key, value) => secureStorage.set(key, value),
      getItemAsync: async (key) => secureStorage.get(key) ?? null,
      deleteItemAsync: async (key) => secureStorage.delete(key),
    }
  }
  if (request === 'expo-sqlite') {
    return {
      openDatabaseAsync: async () => ({
        execAsync: async () => undefined,
        runAsync: async (sql, ...args) => {
          if (/UPDATE memories SET lastHitAt/i.test(sql)) {
            const [lastHitAt, id] = args
            const row = contextMemoryRows.find((item) => item.id === id)
            if (row) row.lastHitAt = lastHitAt
          }
          if (/UPDATE memories SET status = \?, updatedAt = \? WHERE id = \?/i.test(sql)) {
            const [status, updatedAt, id] = args
            const row = contextMemoryRows.find((item) => item.id === id)
            if (row) {
              row.status = status
              row.updatedAt = updatedAt
            }
          }
          if (/UPDATE memories SET status = 'disabled'/i.test(sql)) {
            const [updatedAt, cutoff] = args
            for (const row of contextMemoryRows) {
              const lastRelevantUse = row.lastHitAt ?? row.updatedAt ?? row.createdAt
              if (row.status === 'active' && lastRelevantUse < cutoff) {
                row.status = 'disabled'
                row.updatedAt = updatedAt
              }
            }
          }
          if (/DELETE FROM memories/i.test(sql)) {
            contextMemoryRows.splice(0, contextMemoryRows.length)
          }
          if (/INSERT OR REPLACE INTO memories/i.test(sql) || /INSERT INTO memories/i.test(sql)) {
            const [id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt] = args
            const existingIndex = contextMemoryRows.findIndex((item) => item.id === id)
            const row = { id, content, status, conversationId, sourceKind, sourceDetail, confidence, lastHitAt, createdAt, updatedAt }
            if (existingIndex >= 0) {
              contextMemoryRows[existingIndex] = row
            } else {
              contextMemoryRows.push(row)
            }
          }
        },
        getAllAsync: async (sql, ...args) => {
          if (/FROM memory_fts/i.test(sql)) {
            const limit = args.at(-1) ?? contextMemoryRows.length
            const statuses = args.slice(1, -1)
            return contextMemoryRows
              .filter((row) => statuses.includes(row.status))
              .slice(0, limit)
              .map((row, index) => ({ ...row, score: row.score ?? -1 / (index + 1) }))
          }
          if (/FROM memories/i.test(sql)) {
            return [...contextMemoryRows]
          }
          return []
        },
        getFirstAsync: async () => null,
      }),
    }
  }
  if (request === 'expo-document-picker') {
    return { getDocumentAsync: async () => ({ canceled: true, assets: [] }) }
  }
  if (request === 'expo-file-system/legacy' || request === 'expo-file-system') {
    return {
      EncodingType: { UTF8: 'utf8', Base64: 'base64' },
      getInfoAsync: async (uri) => {
        const fixture = localFileFixtures.get(uri)
        if (fixture) {
          return { exists: true, uri, isDirectory: false, size: fixture.length, modificationTime: 0 }
        }
        if ([...localFileFixtures.keys()].some((key) => key.startsWith(uri))) {
          return { exists: true, uri, isDirectory: true, size: 0, modificationTime: 0 }
        }
        return { exists: false, uri: uri ?? 'file:///tmp/', isDirectory: false }
      },
      makeDirectoryAsync: async (uri) => {
        localFileOperations.push({ type: 'mkdir', uri })
      },
      deleteAsync: async (uri) => {
        localFileOperations.push({ type: 'delete', uri })
        localFileFixtures.delete(uri)
        for (const key of [...localFileFixtures.keys()]) {
          if (key.startsWith(uri)) localFileFixtures.delete(key)
        }
      },
      downloadAsync: async (url, uri) => {
        const fixture = localDownloadFixtures.get(url)
        const status = fixture?.status ?? 404
        const body = fixture?.body ?? Buffer.alloc(0)
        if (status >= 200 && status < 300) {
          localFileFixtures.set(uri, body)
        }
        localFileOperations.push({ type: 'download', url, uri, status, bytes: body.length })
        return { status, uri, headers: {}, mimeType: null }
      },
      getContentUriAsync: async (uri) => `content://${uri.replace(/^file:\/\//, '')}`,
      createDownloadResumable: (url, uri, _options, onProgress) => ({
        downloadAsync: async () => {
          const fixture = localDownloadFixtures.get(url)
          const status = fixture?.status ?? 404
          const body = fixture?.body ?? Buffer.alloc(0)
          if (status >= 200 && status < 300) {
            onProgress?.({ totalBytesWritten: Math.ceil(body.length / 2), totalBytesExpectedToWrite: body.length })
            localFileFixtures.set(uri, body)
            onProgress?.({ totalBytesWritten: body.length, totalBytesExpectedToWrite: body.length })
          }
          localFileOperations.push({ type: 'download', url, uri, status, bytes: body.length })
          return { status, uri, headers: {}, mimeType: null }
        },
      }),
      readAsStringAsync: async (uri, options = {}) => {
        const fixture = localFileFixtures.get(uri)
        if (!fixture) return ''
        const position = options.position ?? 0
        const length = options.length ?? fixture.length - position
        const chunk = fixture.subarray(position, Math.min(fixture.length, position + length))
        localFileReadRequests.push({ uri, position, length, actualLength: chunk.length, encoding: options.encoding })
        return options.encoding === 'base64' ? chunk.toString('base64') : chunk.toString('utf8')
      },
      moveAsync: async ({ from, to }) => {
        localFileOperations.push({ type: 'move', from, to })
        const exact = localFileFixtures.get(from)
        if (exact) {
          localFileFixtures.set(to, exact)
          localFileFixtures.delete(from)
          return
        }
        for (const key of [...localFileFixtures.keys()]) {
          if (key.startsWith(from)) {
            localFileFixtures.set(`${to}${key.slice(from.length)}`, localFileFixtures.get(key))
            localFileFixtures.delete(key)
          }
        }
      },
      writeAsStringAsync: async (uri, value, options = {}) => {
        localFileFixtures.set(uri, Buffer.from(String(value), options.encoding === 'base64' ? 'base64' : 'utf8'))
      },
      documentDirectory: 'file:///tmp/',
      cacheDirectory: 'file:///tmp/',
    }
  }
  if (request === 'expo-crypto') {
    return {
      CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
      digest: async () => new Uint8Array(32).buffer,
    }
  }
  if (request === 'react-native') {
    return {
      Platform: reactNativePlatform,
      NativeModules: {},
      StyleSheet: { create: (styles) => styles },
    }
  }
  if (request === 'expo-application') {
    return {
      nativeApplicationVersion: '1.0.6',
      nativeBuildVersion: '106',
    }
  }
  if (request === 'expo-constants') {
    return {
      __esModule: true,
      default: {
        expoConfig: { version: '1.0.6' },
        platform: { android: { versionCode: 106 } },
      },
    }
  }
  if (request === 'expo-device') {
    if (!expoDeviceModuleAvailable) throw new Error("Cannot find native module 'ExpoDevice'")
    return { supportedCpuArchitectures }
  }
  if (request === 'expo-intent-launcher') {
    return {
      startActivityAsync: async (action, params) => {
        launchedIntents.push({ action, params })
      },
    }
  }
  if (request === 'expo-clipboard') {
    return {
      setStringAsync: async () => undefined,
      getStringAsync: async () => '',
    }
  }
  if (request === 'expo/fetch') {
    return { fetch: (...args) => global.fetch(...args) }
  }
  return originalLoad.call(this, request, parent, isMain)
}

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2021,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

const {
  applyProviderPreset,
  detectProviderPreset,
  maskSecret,
  parseCredentialGroups,
  parseProviderImportText,
  probeProviderPreset,
} = require('../src/services/ai/providerRegistry.ts')
const {
  looksLikeProviderImportConnectionText,
  parseProviderImportDraft,
} = require('../src/services/ai/providerImportDraft.ts')
const {
  DEFAULT_PROVIDER_PRESET_ID,
  DEFAULT_PROVIDER_WIRE_PROTOCOL,
  PROVIDER_WIRE_PROTOCOL_OPTIONS,
  defaultProviderCredentialMode,
  defaultProviderTokenPlanRegion,
  defaultProviderWireProtocol,
  inferProviderTokenPlanRegionFromBaseUrl,
  inferProviderWireProtocolFromBaseUrl,
  initialProviderPresetId,
  initialProviderWireProtocol,
  resolveProviderConfigDraft,
} = require('../src/services/ai/providerConfigPolicy.ts')
const {
  inferProviderCredentialModeFromKeyOrBaseUrl,
} = require('../src/services/ai/providerProtocolPolicy.ts')
const {
  chooseCredentialForModel,
  mergeCredentialModelAvailability,
  normalizeProviderCredentialGroups,
  runCredentialGroupModelSync,
  updateCredentialGroupHealth,
} = require('../src/services/ai/providerCredentials.ts')
const { packChatMessages } = require('../src/services/contextPacker.ts')
const {
  DEFAULT_MODELS,
  getModelConfig,
  getProviderConfigIssue,
  getProviderModels,
  getXiaomiMimoOfficialBaseUrl,
  mergeModelConfig,
} = require('../src/types/index.ts')
const {
  buildAnthropicBodyForTest,
  buildGoogleBodyForTest,
  buildOpenAIBodyForTest,
  buildOpenAIResponsesBodyForTest,
  fetchChatStreamWithRetryForTest,
  fetchProviderModelConfigsDetailed,
  formatProviderHttpErrorForTest,
  getAPIEndpointForTest,
  getBodyForTest,
  getXiaomiMimoModelDiscoveryEndpointForTest,
  evaluatePayloadRulesForTest,
  mergeAliasAccessPolicyForTest,
  optimizeRequestBodyForTest,
  parseAnthropicModelsForTest,
  parseProviderStreamEventForTest,
  parseProviderStreamChunkForTest,
  rectifyAnthropicRequestBodyForTest,
  resolveProviderModelAccessForTest,
  resolveProviderModelAliasAccessForTest,
  resolveProviderRequestConformanceForTest,
  resolveProviderRouteForTest,
  resolveProxyPolicyForTest,
  resolveRuntimeFallbackPlanForTest,
  selectUpstreamTransportForTest,
  streamChat,
  testProviderModelDetailed,
} = require('../src/services/ai/base.ts')
const { runResponsesWebSocketTransport } = require('../src/services/ai/transport/responsesWebSocketTransport.ts')
const { activeSessionLeaseCount, acquireSessionLease } = require('../src/services/ai/transport/sessionLeasePool.ts')
const { resolveProviderCapabilityManifest } = require('../src/services/ai/providerConformance.ts')
const { resolveProviderEndpoint } = require('../src/services/ai/providerRouteAssembly.ts')
const { buildProviderFallbackCandidates } = require('../src/services/ai/providerFallbackCandidates.ts')
const { appendRuntimeLog, clearRuntimeLog, getRuntimeLogInfo, getRuntimeLogPath, readRuntimeLogText, redactRuntimeLogValue } = require('../src/services/runtimeLog.ts')
const { buildRuntimeDiagnosticsSummary } = require('../src/services/runtimeDiagnostics.ts')
const {
  decideRemoteCompact,
  estimateRemoteCompactSavedTokens,
} = require('../src/services/ai/compact/remoteCompact.ts')
const {
  clearCompactUsageRecords,
  listCompactUsageRecords,
  recordCompactUsage,
} = require('../src/services/ai/compact/compactUsage.ts')
const {
  getBingCompatibleEndpoint,
  legacySearchModeForProvider,
  resolveSearchProvider,
} = require('../src/services/searchPolicy.ts')
const {
  applySkillStack,
  createBaseSkill,
  exportSkill,
  importSkill,
  renderSkillTemplate,
} = require('../src/services/skills.ts')
const {
  builtinMcpServer,
  callMcpTool,
  truncateToolBlocks,
} = require('../src/services/mcp.ts')
const { buildProviderActivationTestCandidatesForTest, summarizeProviderActivation, syncAndTestProvider } = require('../src/services/providerActivation.ts')
const {
  clearHistoricalInjectedProviderModels,
  clearHistoricalInjectedGroupModels,
  getProviderManualModels,
  getProviderSelectableModels,
  getProviderAvailableModels,
  getProviderPreferredModel,
  resolveProviderModelAlias,
  isProviderConversationReady,
  summarizeProviderModelInventory,
} = require('../src/utils/providerModels.ts')
const { parseModelEntries } = require('../src/utils/text.ts')
const { summarizeWorkArtifact } = require('../src/utils/workArtifact.ts')
const { getReasoningEffortOptions, providerSupportsReasoning } = require('../src/utils/modelReasoning.ts')
const { resolveAgentProviderToolTarget } = require('../src/services/agent/agentProviderToolAdapter.ts')
const {
  DEFAULT_ONBOARDING_COMPANION_MODE,
  getOnboardingCompanionProfile,
  getOnboardingConversationDefaults,
  getOnboardingSettingsDefaults,
  isOnboardingSystemPrompt,
} = require('../src/utils/onboardingProfile.ts')
const { buildMemoryReviewSummary, filterPendingMemoriesForReview } = require('../src/utils/memoryReview.ts')
const {
  buildMem0AddPayload,
  exportMemoriesAsMem0,
  importMem0Memories,
} = require('../src/utils/mem0Interop.ts')
const { buildKnowledgeRecoverySummary } = require('../src/utils/knowledgeRecovery.ts')
const { setServiceLanguage, st } = require('../src/i18n/service.ts')
const {
  buildCompressedContextPrompt,
  createRagQueryPlan,
  createOnnxEmbeddingProvider,
  createOnnxPlaceholderProvider,
  packRagContext,
  rerankRetrievalSources,
  runAgenticRag,
  splitTextIntoSentenceChunks,
  verifyRagGeneration,
} = require('../src/services/rag.ts')
const { classifyMemoryCandidateForTest } = require('../src/services/context.ts')
const { exportContextSnapshot, importContextSnapshot, searchMemories, updateMemoryStatus } = require('../src/services/contextStore.ts')
const { runRagGoldEvaluation } = require('../src/services/ragEvaluation.ts')
const {
  LOCAL_EMBEDDING_MODELS,
  downloadLocalEmbeddingModel,
  formatModelBytes,
  listLocalEmbeddingModelViews,
  localModelCacheKey,
  sha256BytesForTest,
  sha256ChunksForTest,
  verifyLocalEmbeddingModel,
} = require('../src/services/localEmbeddingModels.ts')
const {
  checkLatestApkRelease,
  compareReleaseToSnapshotForTest,
  downloadAndOpenApkInstaller,
  normalizeApkUpdateManifestForTest,
  selectApkAssetForTest,
  shouldRecordApkUpdateCheck,
} = require('../src/services/appUpdates.ts')
const {
  getProviderModelDisplayCandidates,
} = require('../src/services/ai/policy/providerModelAccess.ts')
const modelCatalog = require('../assets/models/catalog.json')
const { exportAllData, importAllData, importAllDataDetailed, loadData } = require('../src/services/storage.ts')
const { useChatStore } = require('../src/store/chatStore.ts')
const { useSettingsStore } = require('../src/store/settingsStore.ts')

const FAKE_KEY_A = 'token-fake-alpha-1234567890'
const FAKE_KEY_B = 'token-fake-beta-1234567890'
const FAKE_KEY_C = 'token-fake-gamma-1234567890'
const FAKE_KEY_D = 'token-fake-delta-1234567890'
const FAKE_KEY_E = 'token-fake-epsilon-1234567890'
const FAKE_KEY_F = 'token-fake-zeta-1234567890'
const FAKE_MIMO_TP_KEY = 'tp-test-token-plan-fake-1234567890'
const API_KEY_FIELD = 'api' + 'Key'

function localModelFixturePath(modelId, filePath) {
  return path.join(root, 'assets', 'models', modelId, ...filePath.split('/'))
}

function localModelDownloadUrl(model, filePath) {
  return `${model.downloadBaseUrl.replace(/\/+$/, '')}/${filePath.replace(/^\/+/, '')}`
}

function localModelMirrorUrl(model, mirrorBaseUrl, filePath) {
  const official = new URL(model.downloadBaseUrl)
  const officialPath = official.pathname.replace(/^\/+|\/+$/g, '')
  return `${mirrorBaseUrl.replace(/\/+$/, '')}/${officialPath}/${filePath.replace(/^\/+/, '')}`
}

function resetLocalModelFileMocks() {
  localFileFixtures.clear()
  localDownloadFixtures.clear()
  localFileReadRequests.length = 0
  localFileOperations.length = 0
  launchedIntents.length = 0
  supportedCpuArchitectures.splice(0, supportedCpuArchitectures.length, 'arm64-v8a', 'armeabi-v7a')
  expoDeviceModuleAvailable = true
  reactNativePlatform.OS = 'test'
}

const WORK_ARTIFACT_TEMPLATE_GATES = {
  en: [
    ['summary', /Structured summary/i],
    ['decision', /Decision log/i],
    ['action', /Action items/i],
    ['risk', /Risks? (and blockers|or blockers)?/i],
    ['question', /Open questions/i],
    ['evidence', /Evidence still needed|Verification command or evidence/i],
    ['shareable', /short version.*(sent to collaborators|send to collaborators)|copy to someone/i],
  ],
  zh: [
    ['summary', /结构化摘要/],
    ['decision', /决策记录/],
    ['action', /行动项/],
    ['risk', /风险和阻塞|风险/],
    ['question', /待确认问题/],
    ['evidence', /证据仍需补充|需要补充验证的证据|验证证据/],
    ['shareable', /可直接发给协作者|可直接复制给他人/],
  ],
  ja: [
    ['summary', /構造化.*要約/],
    ['decision', /決定ログ/],
    ['action', /アクション項目/],
    ['risk', /リスク/],
    ['question', /確認事項/],
    ['evidence', /必要な根拠|検証.*根拠|検証コマンドまたは証拠/],
    ['shareable', /協力者に送れる|コピーできる/],
  ],
}

const WORK_ARTIFACT_ACTION_METADATA = {
  en: /owner\s*\/\s*next step\s*\/\s*(deadline|trigger)/i,
  zh: /负责人\s*\/\s*下一步\s*\/\s*(截止|触发条件)/,
  ja: /担当者\s*\/\s*次の一歩\s*\/\s*(期限|発火条件)/,
}

function assertStructuredWorkTemplate(value, label, language) {
  assert.ok(value.length >= 80, `${label} is detailed enough to guide a real work artifact`)
  const hasInput = language === 'zh'
    ? /输入/.test(value)
    : language === 'ja'
      ? /入力/.test(value)
      : /Input/.test(value)
  const hasOutputContract = language === 'zh'
    ? /输出必须包含/.test(value)
    : language === 'ja'
      ? /出力には必ず/.test(value)
      : /Output must include/.test(value)
  const hasFixedHeadingsContract = language === 'zh'
    ? /固定标题/.test(value)
    : language === 'ja'
      ? /固定見出し/.test(value)
      : /exact section headings/i.test(value)
  const hasActionableOutcome = language === 'zh'
    ? /(行动|下一步|第一步|验证|风险)/.test(value)
    : language === 'ja'
      ? /(アクション|次|最初|検証|リスク)/.test(value)
      : /(Action|Next|first step|validation|risk)/i.test(value)
  assert.ok(hasInput, `${label} includes an input section`)
  assert.ok(hasOutputContract, `${label} includes an output contract`)
  assert.ok(hasFixedHeadingsContract, `${label} requires exact section headings for parser reliability`)
  assert.ok(hasActionableOutcome, `${label} asks for actionable output`)
  for (const [gate, pattern] of WORK_ARTIFACT_TEMPLATE_GATES[language]) {
    assert.ok(pattern.test(value), `${label} includes a parser-recognizable ${gate} section`)
  }
  assert.ok(
    WORK_ARTIFACT_ACTION_METADATA[language].test(value),
    `${label} requires owner, next step, and deadline/trigger metadata for actions`
  )
}

function assertReleaseVersionsAligned() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const appJson = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(appJson.expo.version, packageJson.version, 'app.json version follows package.json')

  const currentApkSmokeScript = fs.readFileSync(path.join(root, 'scripts/collect-current-apk-smoke.js'), 'utf8')
  assert.ok(
    currentApkSmokeScript.includes("require('./release-artifact-contract')"),
    'current APK smoke uses the shared release artifact contract'
  )
  assert.ok(
    currentApkSmokeScript.includes("require('./release-freshness-contract')"),
    'current APK smoke uses the shared release freshness contract'
  )
  assert.ok(
    currentApkSmokeScript.includes("require('./release-validation-contract')"),
    'current APK smoke uses the shared release validation contract'
  )
  assert.ok(
    currentApkSmokeScript.includes('defaultReleaseAppPackageName'),
    'current APK smoke uses the shared release app package contract'
  )
  assert.ok(
    currentApkSmokeScript.includes('resolveApkArtifactPath(root, { version, arch, variant })'),
    'current APK smoke resolves default artifact paths through the shared contract'
  )
  assert.ok(
    currentApkSmokeScript.includes('collectReleaseSourceFreshness(root, apk)'),
    'current APK smoke resolves source freshness through the shared contract'
  )
  assert.ok(
    currentApkSmokeScript.includes('validateCurrentApkSmokeResult(result, { expected: expectedApp })'),
    'current APK smoke resolves pass/fail through the shared release validation contract'
  )
  assert.ok(
    currentApkSmokeScript.includes('cleanInstallState(info.firstInstallTime, info.lastUpdateTime)'),
    'current APK smoke records clean-install state through the shared release validation contract'
  )
  assert.ok(
    currentApkSmokeScript.includes('androidPackage: expo.android?.package ?? null'),
    'current APK smoke records the expected Android package identity in evidence'
  )
  assert.ok(
    !/IsleMind-1\.0\.6-x86_64-no-model\.apk/.test(currentApkSmokeScript),
    'current APK smoke does not hardcode the current release version in its default artifact path'
  )

  const qaAuditScript = fs.readFileSync(path.join(root, 'scripts/qa-coverage-audit.js'), 'utf8')
  assert.ok(
    qaAuditScript.includes("require('./release-artifact-contract')"),
    'QA audit release provenance uses the shared release artifact contract'
  )
  assert.ok(
    qaAuditScript.includes("require('./release-freshness-contract')"),
    'QA audit release provenance uses the shared release freshness contract'
  )
  assert.ok(
    qaAuditScript.includes("require('./release-validation-contract')"),
    'QA audit release provenance uses the shared release validation contract'
  )
  assert.ok(
    qaAuditScript.includes('formatApkArtifactRelativePath({'),
    'QA audit release provenance resolves the canonical APK path through the shared contract'
  )
  assert.ok(
    qaAuditScript.includes('collectReleaseSourceFreshness(root, apk)'),
    'QA audit release provenance resolves source freshness through the shared contract'
  )
  assert.ok(
    qaAuditScript.includes('validateCurrentApkSmokeResult(data, { expected: data.expected ?? readExpectedAppConfig() })'),
    'QA audit current APK evidence check uses the shared release validation contract'
  )
  assert.ok(
    qaAuditScript.includes('cleanInstallState(info.firstInstallTime, info.lastUpdateTime)'),
    'QA audit reads clean-install state through the shared release validation contract'
  )
  assert.ok(
    qaAuditScript.includes('defaultReleaseAppPackageName'),
    'QA audit reads the Android package identity through the shared release validation contract'
  )
  assert.ok(
    qaAuditScript.includes('Clean install window'),
    'QA audit renders the clean-install timing window in release provenance evidence'
  )
  const memoryReviewSmokeScript = fs.readFileSync(path.join(root, 'scripts/collect-memory-review-smoke.js'), 'utf8')
  assert.ok(
    memoryReviewSmokeScript.includes("require('./release-validation-contract')") && memoryReviewSmokeScript.includes('defaultReleaseAppPackageName'),
    'memory review smoke collector reads the Android package identity through the shared release validation contract'
  )
  const workArtifactSmokeScript = fs.readFileSync(path.join(root, 'scripts/collect-work-artifact-smoke.js'), 'utf8')
  assert.ok(
    workArtifactSmokeScript.includes("require('./release-validation-contract')") && workArtifactSmokeScript.includes('defaultReleaseAppPackageName'),
    'work artifact smoke collector reads the Android package identity through the shared release validation contract'
  )
  assert.ok(
    !/function validateReleaseProvenance/.test(qaAuditScript),
    'QA audit does not keep a private release provenance validator'
  )
  assert.ok(
    !/IsleMind-1\.0\.6-x86_64-no-model\.apk/.test(qaAuditScript),
    'QA audit release provenance does not hardcode the current release version'
  )
  assert.ok(
    qaAuditScript.includes('first-run onboarding handoff is blocking and app-owned touch targets are blocking'),
    'QA audit self-test proves first-run onboarding handoff remains a blocking paired-evidence gate'
  )
  assert.ok(
    qaAuditScript.includes('app-owned touch targets are blocking'),
    'QA audit self-test proves app-owned small touch targets remain blocking'
  )
  assert.ok(
    qaAuditScript.includes('summarizeBlockingTouchTargets(uiSnapshots)'),
    'QA audit centralizes app-owned small touch target blocking'
  )
  assert.ok(
    qaAuditScript.includes('app-owned runtime touch target(s) are below 44dp'),
    'QA audit blocks runtime app touch targets below 44dp'
  )
  assert.ok(
    !/First-run onboarding handoff[\s\S]{0,260}blocking: false/.test(qaAuditScript),
    'QA audit does not classify first-run onboarding handoff as follow-up evidence'
  )
  assert.ok(
    qaAuditScript.includes("require('./sensitive-evidence-contract')") && qaAuditScript.includes('sensitiveEvidenceExtensions'),
    'QA audit reads sensitive evidence extensions through the shared sensitive evidence contract'
  )
  assert.ok(
    !/const sensitiveEvidenceExtensions = new Set/.test(qaAuditScript),
    'QA audit does not keep a private sensitive evidence extension list'
  )

  const providerRuntimeAndroidCollectorScript = fs.readFileSync(path.join(root, 'scripts/collect-provider-runtime-android.js'), 'utf8')
  assert.ok(
    providerRuntimeAndroidCollectorScript.includes("require('./sensitive-evidence-contract')") && providerRuntimeAndroidCollectorScript.includes('sensitiveEvidenceExtensions'),
    'Provider Runtime Android collector reads sensitive evidence extensions through the shared sensitive evidence contract'
  )
  assert.ok(
    providerRuntimeAndroidCollectorScript.includes('redactSensitiveEvidenceText'),
    'Provider Runtime Android collector imports shared sensitive evidence redaction'
  )
  assert.ok(
    /function sanitizeEvidenceText\(value\)\s*\{\s*return redactSensitiveEvidenceText\(value\)\s*\}/.test(providerRuntimeAndroidCollectorScript),
    'Provider Runtime Android collector delegates persisted text redaction to the shared sensitive evidence contract'
  )
  assert.ok(
    !/const sensitiveEvidenceExtensions = new Set/.test(providerRuntimeAndroidCollectorScript),
    'Provider Runtime Android collector does not keep a private sensitive evidence extension list'
  )
  assert.ok(
    !/const replacements = \[/.test(providerRuntimeAndroidCollectorScript),
    'Provider Runtime Android collector does not keep private credential redaction patterns'
  )

  const buildScript = fs.readFileSync(path.join(root, 'scripts/build-local-android-apk.js'), 'utf8')
  assert.ok(
    buildScript.includes("require('./release-artifact-contract')"),
    'local APK build uses the shared release artifact contract'
  )
  assert.ok(
    buildScript.includes('--release-arch can only be used with --release.'),
    'local APK build supports constrained release-arch smoke refreshes'
  )
  assert.ok(
    buildScript.includes('passes.filter((pass) => pass.arch === args.releaseArch)'),
    'local APK build can target the canonical x86_64 release artifact without rebuilding every ABI'
  )
  assert.ok(
    !/function formatArtifactName/.test(buildScript),
    'local APK build does not keep a private APK artifact naming function'
  )

  const releaseArtifactContract = require('./release-artifact-contract')
  const releaseFreshnessContract = require('./release-freshness-contract')
  const releaseValidationContract = require('./release-validation-contract')
  const architectureBoundaryAudit = require('./architecture-boundary-audit')
  const sensitiveEvidenceContract = require('./sensitive-evidence-contract')
  assert.equal(releaseArtifactContract.apkOutputDirName, 'dist-apk', 'release artifact contract owns the APK output directory')
  assert.equal(releaseArtifactContract.defaultReleaseSmokeArch, 'x86_64', 'release artifact contract owns the smoke ABI')
  assert.equal(releaseArtifactContract.defaultReleaseSmokeVariant, 'no-model', 'release artifact contract owns the smoke variant')
  assert.equal(releaseValidationContract.defaultReleaseAppPackageName, appJson.expo.android.package, 'release validation contract owns the app package identity')
  assert.equal(releaseValidationContract.cleanInstallWindowMs, 60_000, 'release validation contract owns the clean-install tolerance window')
  assert.deepEqual(
    releaseValidationContract.cleanInstallState('2026-06-01 11:42:46', '2026-06-01 11:42:46'),
    { cleanInstall: true, cleanInstallWindowMs: 0 },
    'release validation contract accepts exact clean-install timestamps'
  )
  assert.deepEqual(
    releaseValidationContract.cleanInstallState('2026-06-01 11:42:46', '2026-06-01 11:43:45'),
    { cleanInstall: true, cleanInstallWindowMs: 59000 },
    'release validation contract accepts install/update timestamps inside the clean-install window'
  )
  assert.deepEqual(
    releaseValidationContract.cleanInstallState('2026-06-01 11:42:46', '2026-06-01 11:44:00'),
    { cleanInstall: false, cleanInstallWindowMs: 74000 },
    'release validation contract rejects install/update timestamps outside the clean-install window'
  )
  assert.deepEqual(
    releaseValidationContract.cleanInstallState(null, '2026-06-01 11:42:46'),
    { cleanInstall: false, cleanInstallWindowMs: null },
    'release validation contract rejects missing clean-install timestamps'
  )
  assert.equal(
    releaseArtifactContract.formatApkArtifactName({ version: packageJson.version, buildType: 'release', variant: 'no-model', arch: 'x86_64' }),
    `IsleMind-${packageJson.version}-x86_64-no-model.apk`,
    'release artifact contract formats release APK names'
  )
  assert.equal(
    releaseArtifactContract.formatApkArtifactName({ version: packageJson.version, buildType: 'debug', variant: 'no-model', arch: 'universal-64' }),
    `IsleMind-${packageJson.version}-android-debug-no-model-universal-64.apk`,
    'release artifact contract formats debug APK names'
  )
  assert.equal(
    releaseArtifactContract.formatApkArtifactRelativePath({ version: packageJson.version, variant: 'no-model', arch: 'x86_64' }).replace(/\\/g, '/'),
    `dist-apk/IsleMind-${packageJson.version}-x86_64-no-model.apk`,
    'release artifact contract returns repo-relative APK paths'
  )
  assert.equal(releaseFreshnessContract.releaseFreshnessToleranceMs, 2000, 'release freshness contract owns the freshness tolerance')
  assert.ok(releaseFreshnessContract.releaseSourceExtensions.has('.tsx'), 'release freshness contract tracks TSX release inputs')
  assert.ok(!releaseFreshnessContract.releaseSourceExtensions.has('.md'), 'release freshness contract excludes docs from APK freshness inputs')
  assert.deepEqual(
    [...sensitiveEvidenceContract.sensitiveEvidenceExtensions].sort(),
    ['.json', '.jsonl', '.log', '.md', '.txt', '.xml'],
    'sensitive evidence contract owns all text evidence extensions scanned for credential leakage'
  )
  assert.equal(typeof sensitiveEvidenceContract.collectSensitiveEvidenceHits, 'function', 'sensitive evidence contract exports the shared hit collector')
  assert.equal(typeof sensitiveEvidenceContract.redactSensitiveEvidenceText, 'function', 'sensitive evidence contract exports the shared redaction helper')
  const sensitiveRedactionFixture = [
    `key=sk-${'test'.repeat(8)}`,
    `mimo=tp-${'test'.repeat(8)}`,
    `github=ghp_${'a'.repeat(24)}`,
    `google=AIza${'a'.repeat(24)}`,
    `oauth=ya29.${'a'.repeat(24)}`,
    `error=Bearer ${'Abcd'.repeat(10)}`,
    'refresh_token=Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH',
  ].join('\n')
  const sensitiveRedacted = sensitiveEvidenceContract.redactSensitiveEvidenceText(sensitiveRedactionFixture)
  assert.ok(!sensitiveRedacted.includes('sk-test'), 'sensitive evidence redaction removes OpenAI-style API keys')
  assert.ok(!sensitiveRedacted.includes('tp-test'), 'sensitive evidence redaction removes MiMo Token Plan keys')
  assert.ok(!sensitiveRedacted.includes('ghp_'), 'sensitive evidence redaction removes GitHub tokens')
  assert.ok(!sensitiveRedacted.includes('AIza'), 'sensitive evidence redaction removes Google API keys')
  assert.ok(!sensitiveRedacted.includes('ya29.'), 'sensitive evidence redaction removes Google OAuth access tokens')
  assert.ok(!sensitiveRedacted.includes(`Bearer ${'Abcd'.repeat(10)}`), 'sensitive evidence redaction removes bearer token values')
  assert.ok(!sensitiveRedacted.includes('Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH'), 'sensitive evidence redaction removes high-entropy credential assignments')
  assert.ok(sensitiveRedacted.includes('[redacted:openai-api-key]'), 'sensitive evidence redaction marks OpenAI-style API keys')
  assert.ok(sensitiveRedacted.includes('[redacted:mimo-token-plan-key]'), 'sensitive evidence redaction marks MiMo Token Plan keys')
  assert.ok(sensitiveRedacted.includes('[redacted:github-token]'), 'sensitive evidence redaction marks GitHub tokens')
  assert.ok(sensitiveRedacted.includes('[redacted:google-api-key]'), 'sensitive evidence redaction marks Google API keys')
  assert.ok(sensitiveRedacted.includes('[redacted:google-oauth-token]'), 'sensitive evidence redaction marks Google OAuth access tokens')
  assert.ok(sensitiveRedacted.includes('Bearer [redacted:bearer-token]'), 'sensitive evidence redaction preserves bearer prefix with a redacted value')
  assert.ok(sensitiveRedacted.includes('refresh_token=[redacted:credential]'), 'sensitive evidence redaction preserves credential field labels')
  const releaseInputs = releaseFreshnessContract.collectReleaseInputFiles(root).map((file) => path.relative(root, file).replace(/\\/g, '/'))
  for (const expectedInput of ['app.json', 'app/_layout.tsx', 'src/services/context.ts', 'assets/icon.png', 'assets/models/catalog.json']) {
    assert.ok(releaseInputs.includes(expectedInput), `release freshness contract includes ${expectedInput}`)
  }
  const newestReleaseInput = releaseFreshnessContract.findNewestReleaseInput(root)
  assert.ok(newestReleaseInput?.path, 'release freshness contract reports the newest release input path')
  const currentFreshness = releaseFreshnessContract.collectReleaseSourceFreshness(root, { modifiedAt: new Date(Date.now() + 60_000).toISOString() })
  assert.equal(currentFreshness.status, 'current', 'release freshness contract marks APKs newer than inputs as current')
  const staleFreshness = releaseFreshnessContract.collectReleaseSourceFreshness(root, { modifiedAt: '1970-01-01T00:00:00.000Z' })
  assert.equal(staleFreshness.status, 'stale', 'release freshness contract marks APKs older than inputs as stale')
  const passingReleaseEvidence = {
    appPackageName: releaseValidationContract.defaultReleaseAppPackageName,
    apk: {
      path: `dist-apk/IsleMind-${packageJson.version}-x86_64-no-model.apk`,
      exists: true,
      sha256: 'a'.repeat(64),
      sidecarSha256: 'a'.repeat(64),
      sizeBytes: 1,
      modifiedAt: new Date(Date.now() + 60_000).toISOString(),
    },
    expected: {
      packageVersion: packageJson.version,
      expoVersion: appJson.expo.version,
      androidPackage: appJson.expo.android.package,
      androidVersionCode: appJson.expo.android.versionCode,
    },
    sourceFreshness: currentFreshness,
    installed: {
      deviceSerial: 'emulator-5554',
      deviceAbi: 'x86_64',
      packagePath: `package:/data/app/${releaseValidationContract.defaultReleaseAppPackageName}/base.apk`,
      versionName: appJson.expo.version,
      versionCode: appJson.expo.android.versionCode,
      primaryCpuAbi: 'x86_64',
      firstInstallTime: '2026-06-01 11:42:46',
      lastUpdateTime: '2026-06-01 11:42:46',
      cleanInstall: true,
      cleanInstallWindowMs: 0,
    },
    launch: { ok: true, fatalLog: { fatal: false } },
    compatibility16kb: { ok: true, zipAlignmentOk: true, elf64Ok: true },
    source: 'adb',
  }
  assert.deepEqual(releaseValidationContract.validateReleaseProvenance(passingReleaseEvidence), [], 'release validation contract accepts current provenance evidence')
  assert.deepEqual(releaseValidationContract.validateCurrentApkSmokeResult(passingReleaseEvidence), [], 'release validation contract accepts current APK smoke evidence')
  const missingProvenancePackageIssues = releaseValidationContract.validateReleaseProvenance({
    ...passingReleaseEvidence,
    appPackageName: null,
  })
  assert.ok(missingProvenancePackageIssues.some((issue) => /appPackageName is missing/i.test(issue)), 'release validation contract rejects missing provenance package identity')
  const wrongProvenancePackageIssues = releaseValidationContract.validateReleaseProvenance({
    ...passingReleaseEvidence,
    appPackageName: 'com.example.invalid',
  })
  assert.ok(wrongProvenancePackageIssues.some((issue) => /appPackageName is com\.example\.invalid/i.test(issue)), 'release validation contract rejects wrong provenance package identity')
  const staleReleaseIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    sourceFreshness: staleFreshness,
  })
  assert.ok(staleReleaseIssues.some((issue) => /stale APK/i.test(issue)), 'release validation contract rejects stale APK smoke evidence')
  const missingLaunchIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    launch: { ok: false, fatalLog: { fatal: true } },
  })
  assert.ok(missingLaunchIssues.some((issue) => /launch smoke/i.test(issue)), 'release validation contract rejects failed launch evidence')
  const wrongPackageIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    expected: {
      ...passingReleaseEvidence.expected,
      androidPackage: 'com.example.invalid',
    },
  })
  assert.ok(wrongPackageIssues.some((issue) => /android\.package/i.test(issue)), 'release validation contract rejects wrong Android package identity')
  const missingExpectedPackageIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    expected: {
      ...passingReleaseEvidence.expected,
      androidPackage: null,
    },
  })
  assert.ok(missingExpectedPackageIssues.some((issue) => /android\.package is missing/i.test(issue)), 'release validation contract rejects missing Android package identity')
  const missingExpectedVersionCodeIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    expected: {
      ...passingReleaseEvidence.expected,
      androidVersionCode: null,
    },
  })
  assert.ok(missingExpectedVersionCodeIssues.some((issue) => /android\.versionCode is missing/i.test(issue)), 'release validation contract rejects missing Android versionCode identity')
  const missingPackagePathIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    installed: {
      ...passingReleaseEvidence.installed,
      packagePath: null,
    },
  })
  assert.ok(missingPackagePathIssues.some((issue) => /package path/i.test(issue)), 'release validation contract rejects missing installed package path identity')
  const missingInstalledDeviceIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    installed: {
      ...passingReleaseEvidence.installed,
      deviceSerial: '',
    },
  })
  assert.ok(missingInstalledDeviceIssues.some((issue) => /deviceSerial is missing/i.test(issue)), 'release validation contract rejects missing installed device identity')
  const missingInstallTimestampIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    installed: {
      ...passingReleaseEvidence.installed,
      firstInstallTime: null,
    },
  })
  assert.ok(missingInstallTimestampIssues.some((issue) => /timestamps are missing/i.test(issue)), 'release validation contract rejects missing installed timestamp evidence')
  const missingCleanInstallWindowIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    installed: {
      ...passingReleaseEvidence.installed,
      cleanInstallWindowMs: undefined,
    },
  })
  assert.ok(missingCleanInstallWindowIssues.some((issue) => /clean-install window/i.test(issue)), 'release validation contract rejects missing clean-install window evidence')
  const invalidCleanInstallWindowIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    installed: {
      ...passingReleaseEvidence.installed,
      cleanInstallWindowMs: -1,
    },
  })
  assert.ok(invalidCleanInstallWindowIssues.some((issue) => /clean-install window is invalid/i.test(issue)), 'release validation contract rejects invalid clean-install window evidence')
  const oversizedCleanInstallWindowIssues = releaseValidationContract.validateCurrentApkSmokeResult({
    ...passingReleaseEvidence,
    installed: {
      ...passingReleaseEvidence.installed,
      cleanInstallWindowMs: releaseValidationContract.cleanInstallWindowMs + 1,
    },
  })
  assert.ok(oversizedCleanInstallWindowIssues.some((issue) => /exceeds/i.test(issue)), 'release validation contract rejects clean-install windows outside the tolerance')
  assert.equal(architectureBoundaryAudit.architectureBoundaryAuditEvidenceName, 'architecture-boundary-audit-results.json', 'architecture boundary audit owns its evidence file name')
  assert.deepEqual(
    architectureBoundaryAudit.architectureBoundaryReviewBudgets.map((budget) => `${budget.checkId}:${budget.maxSurfaces}/${budget.maxHits}`),
    ['local-data-store-containment:0/0', 'provider-presentation-coupling:0/0'],
    'architecture boundary audit owns explicit review budgets for bounded coupling'
  )
  assert.equal(typeof architectureBoundaryAudit.runArchitectureBoundaryAuditSelfTest, 'function', 'architecture boundary audit exposes a lightweight self-test contract')
  const architectureBoundaryResult = architectureBoundaryAudit.collectArchitectureBoundaryAudit(root)
  assert.equal(architectureBoundaryResult.schema, 'islemind.architecture-boundary-audit.v1', 'architecture boundary audit emits a stable schema')
  assert.equal(architectureBoundaryResult.summary.checks, 11, 'architecture boundary audit includes agentic workflow and review budget enforcement')
  assert.equal(architectureBoundaryResult.summary.blockingIssues, 0, 'architecture boundary audit has no blocking issues')
  assert.equal(architectureBoundaryResult.summary.reviewFindings, 0, 'architecture boundary audit has no current provider presentation review surfaces')
  for (const id of [
    'provider-transport-boundary',
    'context-pipeline-boundary',
    'local-model-strategy-boundary',
    'migration-recovery-boundary',
    'agentic-workflow-engine-boundary',
    'audit-evidence-boundary',
    'network-adapter-containment',
    'local-data-store-containment',
    'local-model-runtime-containment',
    'provider-presentation-coupling',
    'architecture-review-budget',
  ]) {
    assert.ok(architectureBoundaryResult.checks.some((check) => check.id === id), `architecture boundary audit includes ${id}`)
  }
  assert.ok(
    architectureBoundaryResult.checks.some((check) => check.id === 'provider-presentation-coupling' && check.status === 'passed'),
    'architecture boundary audit blocks new provider presentation coupling instead of accepting a UI review surface'
  )
  assert.ok(
    !architectureBoundaryResult.reviewFindings.some((item) => /src\/components\/chat\/ChatWorkspace\.tsx/.test(item.issue)),
    'architecture boundary audit proves ChatWorkspace no longer carries provider presentation coupling'
  )
  assert.ok(
    !architectureBoundaryResult.reviewFindings.some((item) => /src\/components\/chat\/ChatWorkspace\.tsx \(.*localDataStore/.test(item.issue)),
    'architecture boundary audit proves ChatWorkspace no longer reaches the local data store directly'
  )
  assert.ok(
    !architectureBoundaryResult.reviewFindings.some((item) => item.checkId === 'local-data-store-containment'),
    'architecture boundary audit proves UI data-store coupling has no review surface'
  )
  const contextPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ContextPanel.tsx'), 'utf8')
  assert.ok(
    !contextPanelSource.includes("@/services/localDataStore"),
    'ContextPanel reads RAG diagnostics and cache maintenance through the RAG service boundary'
  )
  assert.ok(
    contextPanelSource.includes("@/services/ragEvaluation"),
    'ContextPanel keeps RAG maintenance actions outside direct SQLite access'
  )
  assert.ok(
    !/function searchModeLabel/.test(contextPanelSource),
    'ContextPanel reads search provider labels through the search policy boundary'
  )
  assert.ok(
    contextPanelSource.includes('SEARCH_PROVIDER_OPTIONS'),
    'ContextPanel reads search provider option order through the search policy boundary'
  )
  assert.ok(
    contextPanelSource.includes('SEARCH_PROVIDER_CREDENTIAL_FIELDS'),
    'ContextPanel reads search credential field metadata through the search policy boundary'
  )
  assert.ok(
    !architectureBoundaryResult.reviewFindings.some((item) => /src\/components\/settings\/ContextPanel\.tsx/.test(item.issue)),
    'architecture boundary audit proves ContextPanel no longer carries provider presentation coupling'
  )
  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  assert.ok(
    apiKeyPanelSource.includes("@/services/ai/providerConfigPolicy"),
    'ApiKeyPanel reads provider protocol and base URL draft behavior through the provider config policy boundary'
  )
  assert.ok(
    !/function inferMimoWireProtocol|shouldReplaceMimoBaseUrl|xiaomi-mimo|openai-compatible|anthropic-compatible|xiaomimimo/.test(apiKeyPanelSource),
    'ApiKeyPanel does not keep provider-specific protocol and endpoint rules in the UI layer'
  )
  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  assert.ok(
    chatWorkspaceSource.includes("@/services/conversationMetrics"),
    'ChatWorkspace reads conversation metrics through the pure metrics boundary'
  )
  assert.ok(
    !chatWorkspaceSource.includes("@/services/localDataStore"),
    'ChatWorkspace does not import the SQLite-backed local data store for display metrics'
  )
  assert.ok(
    chatWorkspaceSource.includes("@/utils/providerModels"),
    'ChatWorkspace reads model family metadata through the provider model utility boundary'
  )
  assert.ok(
    !/function inferModelFamily/.test(chatWorkspaceSource),
    'ChatWorkspace does not keep provider/model family classification rules in the UI layer'
  )
  const providerModels = require('../src/utils/providerModels.ts')
  assert.deepEqual(
    providerModels.MODEL_QUICK_GROUPS,
    ['all', 'gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'kimi', 'doubao', 'grok', 'glm', 'minimax', 'mimo', 'llama', 'other'],
    'provider model utility owns stable model quick-filter groups'
  )
  assert.equal(
    providerModels.inferModelFamily({ type: 'anthropic', name: 'Claude', models: [], enabled: true }, 'claude-sonnet-4'),
    'claude',
    'provider model utility classifies Claude-compatible models outside UI components'
  )
  assert.equal(
    providerModels.inferModelFamily({ type: 'openai-compatible', name: 'Xiaomi MiMo', baseUrl: 'https://api.xiaomimimo.com', models: [], enabled: true }, 'mimo-v2'),
    'mimo',
    'provider model utility classifies MiMo-compatible models outside UI components'
  )
  assert.equal(
    providerModels.inferModelFamily({ type: 'openai-compatible', name: 'MiniMax', baseUrl: 'https://api.minimax.io/v1', models: [], enabled: true }, 'MiniMax-M3'),
    'minimax',
    'provider model utility classifies MiniMax-compatible models outside UI components'
  )
  const conversationMetrics = require('../src/services/conversationMetrics.ts')
  const metricFixture = conversationMetrics.getConversationMetrics({
    id: 'metric-conversation',
    title: 'Metric fixture',
    providerId: 'mock',
    model: 'mock-model',
    createdAt: 1,
    updatedAt: 2,
    messages: [
      { id: 'user', role: 'user', content: 'hello', createdAt: 1, usage: { inputTokens: 3, outputTokens: 0, totalTokens: 3, source: 'provider' } },
      { id: 'assistant', role: 'assistant', content: 'world', createdAt: 2, durationMs: 1200, citations: [{ id: 'source', title: 'Source', excerpt: 'Quote' }], usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12, reasoningTokens: 2, source: 'estimated' } },
    ],
  })
  assert.deepEqual(
    metricFixture,
    { inputTokens: 8, outputTokens: 7, totalTokens: 15, reasoningTokens: 2, estimated: true, durationMs: 1200, messageCount: 2, sourceCount: 1 },
    'pure conversation metrics preserve token, duration, message, and citation totals'
  )
  assert.deepEqual(
    conversationMetrics.usageFromMetrics(metricFixture),
    { inputTokens: 8, outputTokens: 7, reasoningTokens: 2, totalTokens: 15, source: 'estimated' },
    'pure conversation metrics still convert back to MessageUsage'
  )
  const architectureReviewBudget = architectureBoundaryResult.checks.find((check) => check.id === 'architecture-review-budget')
  assert.equal(architectureReviewBudget?.status, 'passed', 'architecture boundary audit keeps current review surfaces inside explicit budget')
  assert.deepEqual(
    architectureReviewBudget.evidence,
    [
      'local-data-store-containment: 0/0 surfaces, 0/0 hits',
      'provider-presentation-coupling: 0/0 surfaces, 0/0 hits',
    ],
    'architecture boundary audit reports current review budget utilization'
  )
  assert.equal(DEFAULT_PROVIDER_PRESET_ID, 'custom-openai-compatible', 'provider config policy owns the default custom preset id')
  assert.equal(DEFAULT_PROVIDER_WIRE_PROTOCOL, 'openai-compatible', 'provider config policy owns the default wire protocol')
  assert.deepEqual(PROVIDER_WIRE_PROTOCOL_OPTIONS, ['openai-compatible', 'anthropic-compatible'], 'provider config policy owns supported wire protocol option order')
  assert.equal(inferProviderWireProtocolFromBaseUrl('https://token-plan-cn.xiaomimimo.com/anthropic'), 'anthropic-compatible', 'provider config policy infers Anthropic-compatible endpoints')
  assert.equal(inferProviderCredentialModeFromKeyOrBaseUrl('sk-fake', 'https://token-plan-cn.xiaomimimo.com/v1'), 'payg', 'provider protocol policy infers pay-as-you-go keys before endpoint defaults')
  assert.equal(inferProviderCredentialModeFromKeyOrBaseUrl('', 'https://api.xiaomimimo.com/v1'), 'payg', 'provider protocol policy infers pay-as-you-go official endpoints')
  assert.equal(inferProviderCredentialModeFromKeyOrBaseUrl('', 'https://token-plan-sgp.xiaomimimo.com/v1'), 'token-plan', 'provider protocol policy defaults token-plan endpoints')
  assert.equal(inferProviderTokenPlanRegionFromBaseUrl('https://token-plan-sgp.xiaomimimo.com/anthropic'), 'sgp', 'provider protocol policy infers Singapore token plan region')
  assert.equal(defaultProviderCredentialMode(undefined), 'token-plan', 'provider protocol policy owns credential mode defaults')
  assert.equal(defaultProviderTokenPlanRegion(undefined), 'cn', 'provider protocol policy owns token plan region defaults')
  assert.equal(defaultProviderWireProtocol(undefined), DEFAULT_PROVIDER_WIRE_PROTOCOL, 'provider protocol policy owns persisted wire protocol defaults')
  assert.equal(initialProviderPresetId({}), DEFAULT_PROVIDER_PRESET_ID, 'provider config policy returns the default preset for new provider drafts')
  assert.equal(
    initialProviderWireProtocol({ baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic' }),
    'anthropic-compatible',
    'provider config policy initializes protocol from the endpoint when saved protocol is absent'
  )
  assert.deepEqual(
    resolveProviderConfigDraft({
      provider: { credentialMode: 'token-plan', tokenPlanRegion: 'cn' },
      presetId: 'xiaomi-mimo',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
      wireProtocol: 'anthropic-compatible',
    }),
    {
      presetId: 'xiaomi-mimo',
      isProtocolSelectable: true,
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
      credentialMode: 'token-plan',
      tokenPlanRegion: 'cn',
      wireProtocol: 'anthropic-compatible',
    },
    'provider config policy replaces official endpoint variants when protocol changes'
  )
  assert.equal(
    resolveProviderConfigDraft({
      provider: { credentialMode: 'token-plan', tokenPlanRegion: 'cn' },
      presetId: 'xiaomi-mimo',
      baseUrl: 'https://gateway.example/mimo',
      wireProtocol: 'anthropic-compatible',
    }).baseUrl,
    'https://gateway.example/mimo',
    'provider config policy preserves custom gateway endpoints'
  )
  assert.deepEqual(
    parseCredentialGroups('sk-one\nsk-two,sk-one').map((group) => group.apiKey),
    ['sk-one', 'sk-two'],
    'credential groups keep legacy line/comma parsing and dedupe tokens'
  )
  assert.deepEqual(
    parseCredentialGroups(JSON.stringify(['sk-json-one', 'sk-json-two'])).map((group) => group.apiKey),
    ['sk-json-one', 'sk-json-two'],
    'credential groups parse JSON token arrays'
  )
  const parsedCredentialObject = parseCredentialGroups(JSON.stringify({
    keys: ['sk-object-one'],
    apiKeys: ['sk-object-two'],
    credentialGroups: [{ label: 'Backup', key: 'sk-object-three', enabled: false }],
  }))
  assert.deepEqual(
    parsedCredentialObject.map((group) => ({ apiKey: group.apiKey, enabled: group.enabled })),
    [
      { apiKey: 'sk-object-one', enabled: true },
      { apiKey: 'sk-object-two', enabled: true },
      { apiKey: 'sk-object-three', enabled: false },
    ],
    'credential groups parse JSON objects with keys/apiKeys/credentialGroups'
  )
  assert.equal(parsedCredentialObject[2].label, 'Backup', 'credential group JSON preserves explicit labels')

  const readmeChecks = [
    {
      file: 'README.md',
      markers: ['结构化工作产物', '质量门槛', '复制交接', '继续提示'],
    },
    {
      file: 'docs/readme/README.en.md',
      markers: ['structured work artifacts', 'Quality gates', 'copyable handoffs', 'continuation prompts'],
    },
    {
      file: 'docs/readme/README.zh-CN.md',
      markers: ['结构化工作产物', '质量门槛', '复制交接', '继续提示'],
    },
    {
      file: 'docs/readme/README.ja.md',
      markers: ['構造化された作業成果物', '品質ゲート', 'コピー可能な引き継ぎ', '継続プロンプト'],
    },
  ]
  for (const { file, markers } of readmeChecks) {
    const readme = fs.readFileSync(path.join(root, file), 'utf8')
    for (const marker of markers) {
      assert.ok(readme.includes(marker), `${file} documents AI productivity work artifact capability: ${marker}`)
    }
  }
}

async function assertResponsesWebSocketTransportBehavior() {
  const originalWebSocket = global.WebSocket
  try {
    const success = await runFakeWebSocketScenario(({ instance }) => {
      instance.open()
      instance.message({ type: 'response.output_text.delta', delta: 'hel' })
      instance.message({ type: 'response.output_text.delta', delta: 'lo' })
      instance.message({ type: 'response.completed', response: { id: 'resp-ok' }, usage: { input_tokens: 30, output_tokens: 2, total_tokens: 32 } })
    })
    assert.deepEqual(success.chunks, ['hel', 'lo'], 'Responses WebSocket emits streamed text chunks')
    assert.equal(success.done?.text, 'hello', 'Responses WebSocket completes with accumulated text')
    assert.equal(success.done?.responseId, 'resp-ok', 'Responses WebSocket forwards response id')
    assert.equal(success.done?.usage?.inputTokens, 30, 'Responses WebSocket forwards provider usage')
    assert.ok(success.sent.some((message) => message.type === 'response.create'), 'Responses WebSocket sends response.create')
    assert.ok(!('stream' in success.sent[0]), 'Responses WebSocket removes stream from response.create payload')

    const toolCallSuccess = await runFakeWebSocketScenario(({ instance }) => {
      instance.open()
      instance.message({ type: 'response.output_item.added', item: { id: 'rs_websocket_search', type: 'reasoning', encrypted_content: 'encrypted-websocket-reasoning', summary: [] } })
      instance.message({ type: 'response.output_item.added', item: { id: 'fc_websocket_search', call_id: 'call_websocket_search', type: 'function_call', name: 'search_web', arguments: '{"query":' } })
      instance.message({ type: 'response.function_call_arguments.delta', item_id: 'fc_websocket_search', delta: '"Isle' })
      instance.message({ type: 'response.function_call_arguments.delta', item_id: 'fc_websocket_search', delta: 'Mind"}' })
      instance.message({ type: 'response.completed', response: { id: 'resp-tool-ok' } })
    })
    assert.equal(toolCallSuccess.done?.providerToolCalls?.[0]?.id, 'fc_websocket_search', 'Responses WebSocket forwards provider tool call id')
    assert.equal(toolCallSuccess.done?.providerToolCalls?.[0]?.callId, 'call_websocket_search', 'Responses WebSocket forwards provider function call_id')
    assert.equal(toolCallSuccess.done?.providerToolCalls?.[0]?.name, 'search_web', 'Responses WebSocket forwards provider tool call name')
    assert.equal(toolCallSuccess.done?.providerToolCalls?.[0]?.arguments?.query, 'IsleMind', 'Responses WebSocket merges streamed provider tool arguments')
    assert.deepEqual(
      toolCallSuccess.done?.responseItems?.[0],
      { id: 'rs_websocket_search', type: 'reasoning', encrypted_content: 'encrypted-websocket-reasoning', summary: [] },
      'Responses WebSocket forwards reasoning replay items'
    )

    const handshakeFailure = await runFakeWebSocketScenario(({ instance }) => {
      instance.error()
    })
    assert.equal(handshakeFailure.error?.message, 'websocket_transport_error', 'Responses WebSocket rejects handshake failure before tokens')
    assert.equal(handshakeFailure.chunks.length, 0, 'Responses WebSocket handshake failure emits no chunks')

    const midStreamFailure = await runFakeWebSocketScenario(({ instance }) => {
      instance.open()
      instance.message({ type: 'response.output_text.delta', delta: 'partial' })
      instance.error()
    })
    assert.equal(midStreamFailure.error?.message, 'websocket_transport_error', 'Responses WebSocket rejects mid-stream failure')
    assert.deepEqual(midStreamFailure.chunks, ['partial'], 'Responses WebSocket mid-stream failure preserves emitted chunks for caller retry policy')

    const abortController = new AbortController()
    const aborted = await runFakeWebSocketScenario(({ instance }) => {
      instance.open()
      abortController.abort()
    }, abortController)
    assert.equal(aborted.error?.name, 'AbortError', 'Responses WebSocket abort rejects with AbortError')
    assert.equal(aborted.closed, true, 'Responses WebSocket abort closes the socket')

    const key = 'provider:model:conversation:session'
    const lease = await acquireSessionLease({ key, limit: 1, timeoutMs: 10 })
    assert.equal(activeSessionLeaseCount(key), 1, 'session lease records active acquisition')
    lease.release()
    lease.release()
    assert.equal(activeSessionLeaseCount(key), 0, 'session lease release is idempotent')
  } finally {
    if (originalWebSocket === undefined) {
      delete global.WebSocket
    } else {
      global.WebSocket = originalWebSocket
    }
  }
}

async function runFakeWebSocketScenario(script, controller = new AbortController()) {
  const instances = []
  class FakeWebSocket {
    constructor(url, _protocols, options) {
      this.url = url
      this.options = options
      this.sent = []
      this.closed = false
      instances.push(this)
    }
    send(value) {
      this.sent.push(JSON.parse(value))
    }
    close() {
      this.closed = true
    }
    open() {
      this.onopen?.()
    }
    message(payload) {
      this.onmessage?.({ data: JSON.stringify(payload) })
    }
    error() {
      this.onerror?.(new Error('fake websocket error'))
    }
  }
  global.WebSocket = FakeWebSocket
  const chunks = []
  const traces = []
  let done = null
  let error = null
  const promise = runResponsesWebSocketTransport({
    url: 'wss://api.example/v1/responses',
    headers: { Authorization: 'Bearer sk-test-token' },
    body: { model: 'gpt-5.2', input: [{ role: 'user', content: 'hello' }], stream: true },
    req: { provider: { id: 'openai-main', type: 'openai', name: 'OpenAI', apiKey: '', models: ['gpt-5.2'], enabled: true }, model: 'gpt-5.2', messages: [{ role: 'user', content: 'hello' }] },
    signal: controller.signal,
    parseEvent: parseProviderStreamEventForTest,
    wireProviderType: 'openai',
    extractCitations: () => [],
    onChunk: (chunk) => chunks.push(chunk),
    onDone: (result) => { done = result },
    onError: (err) => { error = err },
    onTrace: (trace) => traces.push(trace),
  }).catch((err) => { error = err })
  assert.equal(instances.length, 1, 'fake WebSocket instance was created')
  script({ instance: instances[0] })
  await promise
  return { chunks, traces, done, error, sent: instances[0].sent, closed: instances[0].closed }
}

async function assertRuntimeLogFileBehavior() {
  const uri = getRuntimeLogPath()
  localFileFixtures.delete(uri)
  await appendRuntimeLog('upstream.request', {
    providerId: 'openai-main',
    model: 'gpt-5.2',
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
    body: JSON.stringify({ model: 'gpt-5.2', input: [{ content: 'secret prompt text' }] }),
  }, { enabled: true, maxBytes: 4096 })
  const content = localFileFixtures.get(uri)?.toString('utf8') ?? ''
  const entry = JSON.parse(content.trim())
  assert.equal(entry.schema, 'islemind.runtime-log.v1', 'runtime log writes JSONL schema')
  assert.equal(entry.event, 'upstream.request', 'runtime log writes event family')
  assert.equal(entry.authorization, '[redacted]', 'runtime log file redacts authorization')
  assert.deepEqual(entry.body.keys, ['input', 'model'], 'runtime log file stores payload keys only')
  assert.ok(!content.includes('secret prompt text'), 'runtime log file omits raw prompt text')
  localFileFixtures.set(uri, Buffer.from(`${'x'.repeat(5000)}\n`))
  await appendRuntimeLog('compact.usage', { providerId: 'openai-main', status: 'completed' }, { enabled: true, maxBytes: 4096 })
  assert.ok((localFileFixtures.get(uri)?.length ?? 0) <= 4096, 'runtime log rotation respects max bytes')
  localFileFixtures.set(uri, Buffer.from(`${'运行日志'.repeat(1800)}\n`))
  await appendRuntimeLog('compact.usage', { providerId: 'openai-main', status: 'completed' }, { enabled: true, maxBytes: 4096 })
  assert.ok((localFileFixtures.get(uri)?.length ?? 0) <= 4096, 'runtime log rotation respects UTF-8 byte limits')
  const info = await getRuntimeLogInfo()
  assert.equal(info.exists, true, 'runtime log info detects the current log file')
  assert.equal(info.path, uri, 'runtime log info returns the same path')
  assert.ok((await readRuntimeLogText()).includes('compact.usage'), 'runtime log tail reads recent events')
  await clearRuntimeLog()
  assert.equal(localFileFixtures.has(uri), false, 'runtime log clear deletes the log file')
}

async function assertRuntimeDiagnosticsBehavior() {
  clearCompactUsageRecords()
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 1000 })
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 1000, outputTokens: 120, estimatedSavedTokens: 430 })
  recordCompactUsage({
    mode: 'auto',
    providerId: 'fallback',
    model: 'manual-model',
    fallbackLocal: true,
    localSourceTokens: 800,
    localCompressedTokens: 200,
    localEstimatedSavedTokens: 600,
    localCompressionRatio: 0.25,
    localCompressionSchemaVersion: 2,
    localCompressionStrategy: 'structured-v2',
    localCompressionTriggerReason: 'message_budget_exceeded',
    localSourceMessageCount: 6,
    localKeptMessageCount: 8,
    localSourceRoleCounts: { user: 3, assistant: 3 },
    localKeptRoleCounts: { user: 4, assistant: 4 },
    localSummarySectionCount: 3,
    localSummaryItemCount: 7,
    localSummarySections: [{ id: 'recent', title: '近期旧消息', itemCount: 4 }],
  })
  recordCompactUsage({
    mode: 'off',
    providerId: 'local-only',
    model: 'manual-model',
    localSourceTokens: 500,
    localCompressedTokens: 250,
    localEstimatedSavedTokens: 250,
    localCompressionRatio: 0.5,
    localCompressionSchemaVersion: 2,
    localCompressionStrategy: 'structured-v2',
    localCompressionTriggerReason: 'message_budget_exceeded',
  })
  recordCompactUsage({ mode: 'required', providerId: 'fallback', model: 'manual-model', failureCode: 'provider_capability_missing' })
  const openAiPreset = applyProviderPreset({
    id: 'openai-main',
    type: 'openai',
    name: 'OpenAI',
    apiKey: '',
    models: ['gpt-5.2'],
    enabled: true,
    lastTestStatus: 'ok',
    manualModels: ['gpt-5.2'],
    modelAliases: [{ alias: 'fast', model: 'gpt-5.2' }],
  }, 'openai')
  assert.equal(openAiPreset.capabilities.responsesWebSocket, true, 'OpenAI preset declares Responses WebSocket support')
  const customProvider = {
    id: 'custom',
    type: 'openai-compatible',
    name: 'Custom',
    apiKey: '',
    models: ['manual-model'],
    enabled: true,
    lastModelSyncStatus: 'bad',
    capabilities: {
      chat: true,
      streaming: true,
      modelList: false,
      vision: false,
      files: false,
      audioInput: false,
      audioTranscription: false,
      speech: false,
      nativeSearch: false,
      reasoningEffort: false,
      topP: true,
      payloadPolicy: true,
    },
  }
  const summary = await buildRuntimeDiagnosticsSummary({
    providers: [openAiPreset, customProvider],
    settings: {
      transportMode: 'websocket',
      remoteCompactMode: 'auto',
      payloadPolicyMode: 'block',
      proxyMode: 'system-detected',
      providerAllowlist: ['openai-*'],
      modelBlocklist: ['bad-*'],
      runtimeLogEnabled: true,
      runtimeLogMaxBytes: 4096,
    },
  })
  assert.equal(summary.websocket.readyProviders, 1, 'runtime diagnostics counts WebSocket-ready providers')
  assert.equal(summary.compact.requestCount, 5, 'runtime diagnostics counts compact usage records')
  assert.equal(summary.compact.remoteRequestCount, 1, 'runtime diagnostics counts remote compact request attempts')
  assert.equal(summary.compact.localCompressionCount, 2, 'runtime diagnostics counts every local compact record')
  assert.equal(summary.compact.localFallbackCount, 1, 'runtime diagnostics keeps local compact fallback records separate')
  assert.equal(summary.compact.localEstimatedSavedTokens, 850, 'runtime diagnostics sums all local compact saved tokens separately')
  assert.equal(summary.compact.localAverageCompressionRatio, 0.375, 'runtime diagnostics reports average local compact compression ratio')
  assert.equal(summary.compact.completedCount, 1, 'runtime diagnostics counts completed remote compact records')
  assert.equal(summary.compact.failureCount, 1, 'runtime diagnostics counts compact failures')
  assert.equal(summary.compact.estimatedSavedTokens, 430, 'runtime diagnostics sums compact saved tokens')
  assert.equal(summary.policy.providerAllowRules, 1, 'runtime diagnostics counts provider allow rules')
  assert.equal(summary.policy.modelBlockRules, 1, 'runtime diagnostics counts model block rules')
  assert.equal(summary.proxy.reason, 'system_proxy_platform_stack', 'runtime diagnostics reports system proxy as platform-stack mode')
  assert.equal(summary.log.enabled, true, 'runtime diagnostics reports log enablement')
  assert.equal(summary.providers.ready, 1, 'runtime diagnostics counts ready providers')
  assert.equal(summary.providers.degraded, 1, 'runtime diagnostics counts degraded providers')
  assert.equal(summary.providers.aliasProviders, 1, 'runtime diagnostics counts alias providers')
}

async function assertUpstreamGovernanceBehavior() {
  const anthropicProvider = {
    id: 'anthropic-main',
    type: 'anthropic',
    name: 'Anthropic',
    apiKey: 'token-test-fake',
    models: ['claude-sonnet-4-20250514'],
    enabled: true,
  }
  const anthropicReq = {
    provider: anthropicProvider,
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'hello' }],
    settings: {
      requestRectificationEnabled: true,
      anthropicThinkingSignatureRectificationEnabled: true,
      anthropicThinkingBudgetRectificationEnabled: true,
    },
  }
  const disabledRectification = rectifyAnthropicRequestBodyForTest({
    req: { ...anthropicReq, settings: {} },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [], max_tokens: 2048 }),
    errorText: 'budget_tokens must be at least 1024',
    rectified: false,
  })
  assert.equal(disabledRectification, undefined, 'Anthropic rectification is default-off')
  const signatureRectified = rectifyAnthropicRequestBodyForTest({
    req: anthropicReq,
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      thinking: { type: 'enabled', budget_tokens: 2048 },
      output_config: { effort: 'high' },
      messages: [
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden', signature: 'invalid' }, { type: 'text', text: 'answer' }] },
        { role: 'user', content: [{ type: 'text', text: 'continue' }] },
      ],
    }),
    errorText: 'invalid_request_error: thinking signature is incompatible with this request',
    rectified: false,
  })
  assert.equal(signatureRectified.kind, 'thinking_signature', 'Anthropic signature rectification is detected')
  assert.equal(signatureRectified.body.thinking, undefined, 'signature rectification removes request thinking config')
  assert.equal(signatureRectified.body.output_config, undefined, 'signature rectification removes output_config')
  assert.equal(signatureRectified.body.messages[0].content.length, 1, 'signature rectification removes incompatible thinking blocks')

  const budgetRectified = rectifyAnthropicRequestBodyForTest({
    req: anthropicReq,
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [], max_tokens: 2048 }),
    errorText: 'budget_tokens must be at least 1024 and comply with the max_tokens constraint',
    rectified: false,
  })
  assert.equal(budgetRectified.kind, 'thinking_budget', 'Anthropic budget rectification is detected')
  assert.deepEqual(budgetRectified.body.thinking, { type: 'enabled', budget_tokens: 32000 }, 'budget rectification normalizes thinking to 32000 tokens')
  assert.equal(budgetRectified.body.max_tokens, 64000, 'budget rectification raises max_tokens when needed')
  const secondRectification = rectifyAnthropicRequestBodyForTest({
    req: anthropicReq,
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [], max_tokens: 2048 }),
    errorText: 'budget_tokens must be at least 1024',
    rectified: true,
  })
  assert.equal(secondRectification, undefined, 'Anthropic rectification is single-retry only')

  const bedrockBody = {
    model: 'claude-opus-4-7',
    system: 'System prompt',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    max_tokens: 4096,
    stream: true,
  }
  const optimizedBedrock = optimizeRequestBodyForTest(bedrockBody, {
    provider: {
      id: 'aws-bedrock',
      type: 'anthropic',
      name: 'Amazon Bedrock',
      baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
      apiKey: 'token-test-fake',
      models: ['claude-opus-4-7'],
      enabled: true,
    },
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    settings: {
      bedrockRequestOptimizerEnabled: true,
      thinkingOptimizerEnabled: true,
      cacheInjectionEnabled: true,
      cacheTtl: '5m',
    },
  })
  assert.deepEqual(optimizedBedrock.thinking, { type: 'adaptive', display: 'summarized' }, 'Bedrock optimizer enables adaptive thinking for supported Claude Opus/Sonnet models')
  assert.equal(optimizedBedrock.output_config.effort, 'high', 'Bedrock optimizer maps thinking effort')
  assert.equal(optimizedBedrock.system[0].cache_control.ttl, '5m', 'Bedrock optimizer injects cache TTL on system text')
  assert.equal(optimizedBedrock.messages[0].content[0].cache_control.ttl, '5m', 'Bedrock optimizer injects cache TTL on message text')
  const nonBedrock = optimizeRequestBodyForTest(bedrockBody, {
    provider: {
      id: 'custom-aws-proxy',
      type: 'anthropic',
      name: 'Custom AWS proxy',
      baseUrl: 'https://aws-proxy.example/v1/messages',
      apiKey: 'token-test-fake',
      models: ['claude-opus-4-7'],
      enabled: true,
    },
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    settings: {
      bedrockRequestOptimizerEnabled: true,
      thinkingOptimizerEnabled: true,
      cacheInjectionEnabled: true,
      cacheTtl: '5m',
    },
  })
  assert.equal(nonBedrock.thinking, undefined, 'Bedrock optimizer does not run for non-Bedrock AWS-named providers')
  assert.equal(typeof nonBedrock.system, 'string', 'Bedrock cache injection is Bedrock-only')

  const originalFetch = global.fetch
  try {
    const modelTestBodies = []
    global.fetch = async (_url, init) => {
      const requestBody = JSON.parse(init.body)
      modelTestBodies.push(requestBody)
      const responseBody = requestBody.generationConfig
        ? { candidates: [{ content: { parts: [{ thought: true, text: 'Checking.' }, { text: 'OK' }] } }], usageMetadata: { thoughtsTokenCount: 2 } }
        : { choices: [{ message: { content: 'OK' } }] }
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const aliasProvider = {
      id: 'custom-model-test',
      type: 'openai-compatible',
      name: 'Custom Model Test',
      baseUrl: 'https://api.example/v1',
      apiKey: FAKE_KEY_A,
      models: ['friendly'],
      modelAliases: [{ alias: 'friendly', model: 'upstream-model' }],
      enabled: true,
    }
    const checkedModelTest = await testProviderModelDetailed(aliasProvider, 'friendly', FAKE_KEY_A, { checkParameters: true })
    const reducedModelTest = await testProviderModelDetailed(aliasProvider, 'friendly', FAKE_KEY_A, { checkParameters: false })
    assert.equal(checkedModelTest.ok, true, 'model test accepts aliased requested models')
    assert.equal(reducedModelTest.ok, true, 'model test accepts reduced-parameter checks')
    assert.equal(modelTestBodies[0].model, 'upstream-model', 'model test sends the upstream alias target')
    assert.equal(modelTestBodies[0].temperature, 0.7, 'model test keeps generation parameters when parameter checks are enabled')
    assert.equal(modelTestBodies[1].temperature, undefined, 'model test removes generation parameters when parameter checks are disabled')
    const checkedGeminiTest = await testProviderModelDetailed({
      id: 'google-test',
      type: 'google',
      name: 'Google Test',
      apiKey: FAKE_KEY_A,
      models: ['gemini-3.5-flash'],
      enabled: true,
    }, 'gemini-3.5-flash', FAKE_KEY_A, { checkParameters: true })
    const reducedGeminiTest = await testProviderModelDetailed({
      id: 'google-test',
      type: 'google',
      name: 'Google Test',
      apiKey: FAKE_KEY_A,
      models: ['gemini-3.5-flash'],
      enabled: true,
    }, 'gemini-3.5-flash', FAKE_KEY_A, { checkParameters: false })
    assert.equal(checkedGeminiTest.ok, true, 'Gemini model test accepts thought summary parts without treating them as answer text')
    assert.equal(reducedGeminiTest.ok, true, 'Gemini reduced-parameter model test remains low-cost')
    assert.equal(modelTestBodies[2].generationConfig.thinkingConfig.thinkingLevel, 'medium', 'Gemini 3.5 parameter checks request the official default thinking level')
    assert.equal(modelTestBodies[2].generationConfig.thinkingConfig.includeThoughts, true, 'Gemini 3.5 parameter checks request thought summaries')
    assert.equal(modelTestBodies[2].generationConfig.maxOutputTokens, 128, 'Gemini thinking model tests reserve enough response budget for thought summaries')
    assert.equal(modelTestBodies[3].generationConfig.thinkingConfig, undefined, 'Gemini reduced-parameter checks remove thinkingConfig')

    const blockedAccessTraces = []
    let blockedAccessError
    const blockedAccessHandle = await streamChat(
      {
        provider: aliasProvider,
        model: 'friendly',
        messages: [{ role: 'user', content: 'hello' }],
        settings: { modelBlocklist: ['upstream-model'] },
      },
      () => {},
      () => {},
      (error) => { blockedAccessError = error },
      undefined,
      (trace) => blockedAccessTraces.push(trace)
    )
    await blockedAccessHandle.done
    const blockedAccessTrace = blockedAccessTraces.find((trace) => trace.id.startsWith('runtime-governance-'))
    assert.equal(blockedAccessError.message, 'access_policy_model_blocked', 'blocked upstream alias access fails before fetch')
    assert.equal(blockedAccessTrace.status, 'error', 'blocked runtime access emits an error trace')
    assert.equal(blockedAccessTrace.metadata.accessAllowed, false, 'blocked runtime access trace records the access decision')
    assert.equal(blockedAccessTrace.metadata.accessReason, 'model_blocked', 'blocked runtime access trace records the policy reason')

    const nonStreamingBodies = []
    const nonStreamingProvider = {
      id: 'openai-pro',
      type: 'openai',
      name: 'OpenAI Pro',
      apiKey: FAKE_KEY_A,
      models: ['gpt-5.5-pro'],
      enabled: true,
    }
    let nonStreamingText = ''
    global.fetch = async (_url, init) => {
      nonStreamingBodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ output_text: 'non-streaming OK' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const nonStreamingHandle = await streamChat(
      {
        provider: nonStreamingProvider,
        model: 'gpt-5.5-pro',
        messages: [{ role: 'user', content: 'hello' }],
        stream: true,
      },
      (chunk) => { nonStreamingText += chunk },
      () => {},
      (error) => { throw error }
    )
    await nonStreamingHandle.done
    assert.equal(nonStreamingBodies[0].stream, false, 'model-level streaming disable overrides requested streaming')
    assert.equal(nonStreamingText, 'non-streaming OK', 'non-streaming model responses are parsed through the normal done path')

    let calls = 0
    global.fetch = async () => {
      calls += 1
      return new Response(calls === 1 ? 'server overloaded' : 'data: [DONE]\n\n', { status: calls === 1 ? 500 : 200 })
    }
    const retriedResponse = await fetchChatStreamWithRetryForTest({
      req: {
        provider: anthropicProvider,
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        settings: { upstreamMaxRetries: 1, upstreamRequestTimeoutMs: 5000, upstreamCircuitBreakerEnabled: false },
      },
      url: 'https://api.anthropic.com/v1/messages',
      headers: {},
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [], max_tokens: 128 }),
      stream: true,
      controller: new AbortController(),
    })
    assert.equal(retriedResponse.ok, true, 'Anthropic retryable 5xx responses are retried')
    assert.equal(calls, 2, 'Anthropic retry count applies after non-rectifiable 5xx')

    const sentBodies = []
    global.fetch = async (_url, init) => {
      sentBodies.push(JSON.parse(init.body))
      return new Response(sentBodies.length === 1 ? 'budget_tokens must be at least 1024' : 'data: [DONE]\n\n', { status: sentBodies.length === 1 ? 400 : 200 })
    }
    const rectifiedResponse = await fetchChatStreamWithRetryForTest({
      req: {
        provider: anthropicProvider,
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hello' }],
        settings: {
          upstreamMaxRetries: 0,
          upstreamRequestTimeoutMs: 5000,
          upstreamCircuitBreakerEnabled: false,
          requestRectificationEnabled: true,
          anthropicThinkingBudgetRectificationEnabled: true,
        },
      },
      url: 'https://api.anthropic.com/v1/messages',
      headers: {},
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [], max_tokens: 2048 }),
      stream: true,
      controller: new AbortController(),
    })
    assert.equal(rectifiedResponse.ok, true, 'Anthropic rectification retry is independent of max retry count')
    assert.equal(sentBodies.length, 2, 'Anthropic rectification retries once')
    assert.equal(sentBodies[1].thinking.budget_tokens, 32000, 'rectification retry sends normalized thinking budget')
    assert.equal(sentBodies[1].max_tokens, 64000, 'rectification retry sends normalized max_tokens')

    memoryStorage.clear()
    const fallbackOpenAI = {
      id: 'fallback-openai',
      type: 'openai',
      name: 'Fallback OpenAI',
      apiKey: FAKE_KEY_A,
      models: ['gpt-5.5', 'gpt-5.5-mini'],
      credentialGroups: [{ id: 'openai-a', label: 'A', apiKey: FAKE_KEY_A, enabled: true, availableModels: ['gpt-5.5', 'gpt-5.5-mini'] }],
      enabled: true,
    }
    const fallbackAnthropic = {
      id: 'fallback-anthropic',
      type: 'anthropic',
      name: 'Fallback Anthropic',
      apiKey: FAKE_KEY_B,
      models: ['claude-sonnet-4-6'],
      credentialGroups: [{ id: 'anthropic-a', label: 'A', apiKey: FAKE_KEY_B, enabled: true }],
      enabled: true,
    }
    const fallbackPlan = await resolveRuntimeFallbackPlanForTest({
      req: {
        provider: fallbackOpenAI,
        fallbackProviders: [fallbackOpenAI, fallbackAnthropic],
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        messages: [{ role: 'user', content: 'hello' }],
        settings: { runtimeLogEnabled: true },
      },
      status: 429,
      credentialGroupId: 'openai-a',
      responseText: 'rate limit',
    })
    assert.equal(fallbackPlan.classification.trigger, 'rate_limited', 'runtime fallback classifies 429')
    assert.equal(fallbackPlan.decision.eligible, true, 'runtime fallback finds same-provider alternate model')
    assert.equal(fallbackPlan.decision.selected.model, 'gpt-5.5-mini', 'runtime fallback selects same-provider alternate model')
    assert.ok(fallbackPlan.decision.rejectedCandidates.some((item) => item.providerId === 'fallback-anthropic' && item.reason === 'cross_provider_disallowed'), 'runtime fallback blocks cross-provider candidate by default')
    assert.ok(memoryStorage.get('@islemind/provider-health')?.includes('fallback-openai'), 'runtime fallback persists original route health')

    memoryStorage.clear()
    await clearRuntimeLog()
    const fallbackBodies = []
    const fallbackChunks = []
    const fallbackTraces = []
    let fallbackDone
    let fallbackError
    global.fetch = async (_url, init) => {
      fallbackBodies.push(init?.body ? JSON.parse(init.body) : null)
      if (fallbackBodies.length === 1) return new Response(null, { status: 200 })
      if (fallbackBodies.length === 2) return new Response('rate limit', { status: 429 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const fallbackHandle = await streamChat(
      {
        provider: fallbackOpenAI,
        fallbackProviders: [fallbackOpenAI, fallbackAnthropic],
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'hello' }],
        settings: { runtimeLogEnabled: true, upstreamMaxRetries: 0, upstreamCircuitBreakerEnabled: false },
      },
      (chunk) => fallbackChunks.push(chunk),
      (result) => { fallbackDone = result },
      (error) => { fallbackError = error },
      undefined,
      (trace) => fallbackTraces.push(trace)
    )
    await fallbackHandle.done
    assert.equal(fallbackError, undefined, fallbackError?.message)
    assert.equal(fallbackChunks.join(''), 'fallback OK', 'runtime fallback emits selected provider text')
    assert.equal(fallbackDone.text, 'fallback OK', 'runtime fallback completes with selected provider result')
    assert.equal(fallbackBodies.length, 3, 'runtime fallback sends stream probe, non-streaming retry, and selected fallback retry')
    assert.equal(fallbackBodies[1].stream, false, 'runtime fallback retry disables streaming')
    assert.equal(fallbackBodies[2].model, 'gpt-5.5-mini', 'runtime fallback retry sends selected model')
    const fallbackLogText = await readRuntimeLogText()
    assert.ok(fallbackLogText.includes('"event":"fallback.decision"'), 'runtime fallback writes decision evidence')
    assert.ok(fallbackLogText.includes('"event":"route.decision"'), 'runtime fallback retry writes route decision evidence')
    assert.ok(fallbackLogText.includes('"selectedModel":"gpt-5.5-mini"'), 'runtime fallback route evidence records selected fallback model')
    assert.ok(memoryStorage.get('@islemind/provider-health')?.includes('gpt-5.5-mini'), 'runtime fallback records selected route success')
    const runtimeGovernanceTrace = fallbackTraces.find((trace) => trace.id.startsWith('runtime-governance-'))
    assert.equal(runtimeGovernanceTrace.status, 'done', 'runtime governance trace completes for allowed upstream requests')
    assert.equal(runtimeGovernanceTrace.metadata.accessAllowed, true, 'runtime governance trace records access allowance')
    assert.equal(runtimeGovernanceTrace.metadata.routeBlocked, false, 'runtime governance trace records route decision')
    assert.equal(runtimeGovernanceTrace.metadata.transport, 'http_sse', 'runtime governance trace records transport selection')
    assert.equal(runtimeGovernanceTrace.metadata.payloadPolicyMode, 'warn', 'runtime governance trace records payload policy')
    assert.equal(runtimeGovernanceTrace.metadata.proxyMode, 'off', 'runtime governance trace records proxy policy')
    const runtimeFallbackTrace = fallbackTraces.find((trace) => trace.id.startsWith('runtime-fallback-'))
    assert.equal(runtimeFallbackTrace.status, 'done', 'runtime fallback emits a completed trace')
    assert.equal(runtimeFallbackTrace.metadata.trigger, 'rate_limited', 'runtime fallback trace records trigger state')
    assert.equal(runtimeFallbackTrace.metadata.selectedModel, 'gpt-5.5-mini', 'runtime fallback trace records selected model')

    memoryStorage.clear()
    await clearRuntimeLog()
    const directFallbackBodies = []
    const directFallbackChunks = []
    const directFallbackTraces = []
    let directFallbackDone
    let directFallbackError
    global.fetch = async (_url, init) => {
      directFallbackBodies.push(init?.body ? JSON.parse(init.body) : null)
      if (directFallbackBodies.length === 1) return new Response('rate limit', { status: 429 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'direct fallback OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const directFallbackHandle = await streamChat(
      {
        provider: fallbackOpenAI,
        fallbackProviders: [fallbackOpenAI, fallbackAnthropic],
        model: 'gpt-5.5',
        messages: [{ role: 'user', content: 'hello' }],
        settings: { runtimeLogEnabled: true, upstreamMaxRetries: 0, upstreamCircuitBreakerEnabled: false },
      },
      (chunk) => directFallbackChunks.push(chunk),
      (result) => { directFallbackDone = result },
      (error) => { directFallbackError = error },
      undefined,
      (trace) => directFallbackTraces.push(trace)
    )
    await directFallbackHandle.done
    assert.equal(directFallbackError, undefined, directFallbackError?.message)
    assert.equal(directFallbackChunks.join(''), 'direct fallback OK', 'runtime fallback recovers initial HTTP failure before streaming starts')
    assert.equal(directFallbackDone.text, 'direct fallback OK', 'direct runtime fallback completes with selected provider result')
    assert.equal(directFallbackBodies.length, 2, 'direct runtime fallback sends initial stream request and selected fallback retry')
    assert.equal(directFallbackBodies[0].stream, true, 'direct runtime fallback starts from the requested stream path')
    assert.equal(directFallbackBodies[1].model, 'gpt-5.5-mini', 'direct runtime fallback retry sends selected model')
    const directFallbackLogText = await readRuntimeLogText()
    assert.ok(directFallbackLogText.includes('"event":"fallback.decision"'), 'direct runtime fallback writes decision evidence')
    assert.ok(directFallbackLogText.includes('"event":"route.decision"'), 'direct runtime fallback retry writes route decision evidence')
    assert.ok(directFallbackLogText.includes('"selectedModel":"gpt-5.5-mini"'), 'direct runtime fallback route evidence records selected fallback model')
    const directRuntimeFallbackTrace = directFallbackTraces.find((trace) => trace.id.startsWith('runtime-fallback-'))
    assert.equal(directRuntimeFallbackTrace.metadata.selectedModel, 'gpt-5.5-mini', 'direct runtime fallback trace records selected route')
  } finally {
    global.fetch = originalFetch
  }
}

async function assertProviderStoreLifecycleBehavior() {
  memoryStorage.clear()
  secureStorage.clear()
  useChatStore.setState({ conversations: [], currentId: null, isLoading: false, error: null })
  await useSettingsStore.getState().clearAll()
  memoryStorage.clear()

  const blockedProvider = {
    id: 'store-blocked-provider',
    type: 'openai',
    presetId: 'openai',
    detectedPresetId: 'openai',
    name: 'Store Blocked Provider',
    apiKey: FAKE_KEY_C,
    baseUrl: 'https://api.openai.com/v1',
    models: ['blocked-chat'],
    enabled: true,
    lastTestStatus: 'ok',
    lastTestModel: 'blocked-chat',
    credentialGroups: [
      { id: 'blocked-group', label: 'Blocked Group', apiKey: FAKE_KEY_D, enabled: true, lastModelSyncStatus: 'ok', availableModels: ['blocked-chat'] },
    ],
  }
  const allowedProvider = {
    id: 'store-policy-provider',
    type: 'openai',
    presetId: 'openai',
    detectedPresetId: 'openai',
    name: 'Store Policy Provider',
    apiKey: FAKE_KEY_A,
    baseUrl: 'https://api.openai.com/v1',
    models: ['blocked-chat', 'gpt-5.5-mini', 'gpt-4o'],
    manualModels: ['manual-chat'],
    modelAliases: [{ alias: 'fast', model: 'gpt-5.5-mini' }],
    enabled: true,
    lastTestStatus: 'ok',
    lastTestModel: 'gpt-5.5-mini',
    credentialGroups: [
      { id: 'policy-group', label: 'Policy Group', apiKey: FAKE_KEY_B, enabled: true, lastModelSyncStatus: 'ok', availableModels: ['blocked-chat', 'gpt-5.5-mini', 'gpt-4o', 'fast'] },
    ],
  }

  await useSettingsStore.getState().addProvider(blockedProvider)
  await useSettingsStore.getState().addProvider(allowedProvider)
  useSettingsStore.getState().updateSettings({
    defaultProvider: allowedProvider.id,
    modelAllowlist: ['gpt-*'],
    modelBlocklist: ['blocked-*'],
  })

  const storedAllowedProvider = useSettingsStore.getState().providers.find((provider) => provider.id === allowedProvider.id)
  assert.equal(storedAllowedProvider?.apiKey, '', 'settings store strips provider API keys before saving provider state')
  assert.equal(storedAllowedProvider?.credentialGroups?.[0]?.apiKey, '', 'settings store strips credential group API keys before saving provider state')
  assert.equal(secureStorage.get('islemind.key.store-policy-provider'), FAKE_KEY_A, 'settings store persists provider API keys in SecureStore')
  assert.equal(secureStorage.get('islemind.key.store-policy-provider.policy-group'), FAKE_KEY_B, 'settings store persists credential group API keys in SecureStore')

  const configuredProviders = await useSettingsStore.getState().getConfiguredProviders()
  assert.deepEqual(configuredProviders.map((provider) => provider.id), [allowedProvider.id], 'settings store filters configured providers through model access policy')
  assert.equal(configuredProviders[0].apiKey, FAKE_KEY_A, 'settings store hydrates provider API keys for configured provider reads')
  assert.equal(configuredProviders[0].credentialGroups?.[0]?.apiKey, FAKE_KEY_B, 'settings store hydrates credential group API keys for configured provider reads')

  const primaryProvider = await useSettingsStore.getState().getPrimaryConfiguredProvider()
  assert.equal(primaryProvider?.id, allowedProvider.id, 'settings store primary provider resolves through configured provider filtering')

  const conversationId = useChatStore.getState().create(allowedProvider.id, 'gpt-5.5-mini')
  const blockedSwitch = useChatStore.getState().switchConversationModel(conversationId, allowedProvider.id, 'blocked-chat')
  assert.equal(blockedSwitch, false, 'chat store rejects blocked model switches through the real store entry')
  assert.equal(useChatStore.getState().getCurrent()?.model, 'gpt-5.5-mini', 'chat store keeps the previous model after a blocked switch')
  assert.ok(useChatStore.getState().error?.includes('blocked-chat'), 'chat store records a blocked model switch error')

  useChatStore.getState().setError(null)
  const aliasSwitch = useChatStore.getState().switchConversationModel(conversationId, allowedProvider.id, ' fast ')
  assert.equal(aliasSwitch, true, 'chat store accepts alias switches when the upstream model passes policy')
  assert.equal(useChatStore.getState().getCurrent()?.model, 'fast', 'chat store stores the trimmed alias after an allowed switch')
  assert.equal(useChatStore.getState().getCurrent()?.providerModelMode, 'manual', 'chat store marks successful switches as manual conversation overrides')
  assert.equal(useChatStore.getState().getCurrent()?.reasoningEffort, 'low', 'chat store resolves alias model metadata before preserving supported reasoning effort')
  const nonReasoningSwitch = useChatStore.getState().switchConversationModel(conversationId, allowedProvider.id, 'gpt-4o')
  assert.equal(nonReasoningSwitch, true, 'chat store accepts allowed switches to non-reasoning models')
  assert.equal(useChatStore.getState().getCurrent()?.reasoningEffort, undefined, 'chat store clears reasoning effort when the target model does not support reasoning controls')
  const aliasCreatedConversationId = useChatStore.getState().create(allowedProvider.id, 'fast')
  assert.equal(useChatStore.getState().getCurrent()?.id, aliasCreatedConversationId, 'chat store selects conversations created from model aliases')
  assert.equal(useChatStore.getState().getCurrent()?.model, 'fast', 'chat store preserves the user-facing model alias on create')
  assert.equal(useChatStore.getState().getCurrent()?.reasoningEffort, 'low', 'chat store resolves alias model metadata before assigning default reasoning effort')
  const kimiDefaultProvider = {
    id: 'kimi-defaults',
    type: 'openai-compatible',
    presetId: 'moonshot',
    name: 'Kimi Defaults',
    apiKey: FAKE_KEY_A,
    baseUrl: 'https://api.moonshot.ai/v1',
    models: ['kimi-k2.6'],
    enabled: true,
  }
  await useSettingsStore.getState().addProvider(kimiDefaultProvider)
  const kimiConversationId = useChatStore.getState().create(kimiDefaultProvider.id, 'kimi-k2.6')
  assert.equal(useChatStore.getState().getCurrent()?.id, kimiConversationId, 'chat store selects the newly created Kimi conversation')
  assert.equal(useChatStore.getState().getCurrent()?.reasoningEffort, 'high', 'chat store normalizes new conversations to a model-supported Kimi reasoning effort')
  const plainConversationId = useChatStore.getState().create(allowedProvider.id, 'gpt-4o')
  assert.equal(useChatStore.getState().getCurrent()?.id, plainConversationId, 'chat store selects the newly created non-reasoning conversation')
  assert.equal(useChatStore.getState().getCurrent()?.reasoningEffort, undefined, 'chat store does not attach default reasoning to new non-reasoning conversations')
  await useSettingsStore.getState().removeProvider(kimiDefaultProvider.id)
  useSettingsStore.getState().updateSettings({ defaultProvider: allowedProvider.id })

  await useSettingsStore.getState().removeProvider(allowedProvider.id)
  assert.equal(useSettingsStore.getState().settings.defaultProvider, blockedProvider.id, 'settings store moves the default provider to the remaining provider after removal')
  assert.equal(await useSettingsStore.getState().getPrimaryConfiguredProvider(), null, 'settings store returns no primary provider when the remaining provider is policy-blocked')

  useChatStore.getState().clearAll()
  await useSettingsStore.getState().clearAll()
  useChatStore.setState({ conversations: [], currentId: null, isLoading: false, error: null })
  memoryStorage.clear()
  secureStorage.clear()
}

async function run() {
  assertReleaseVersionsAligned()
  await assertResponsesWebSocketTransportBehavior()
  await assertRuntimeLogFileBehavior()
  await assertRuntimeDiagnosticsBehavior()
  await assertUpstreamGovernanceBehavior()

  assert.equal(
    detectProviderPreset({ baseUrl: 'https://new-api.abrdns.com/', [API_KEY_FIELD]: 'token-live-fake' }).presetId,
    'newapi',
    'detects NewAPI-style aggregators from host'
  )
  assert.equal(
    detectProviderPreset({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }).presetId,
    'dashscope',
    'detects DashScope compatible mode'
  )
  assert.equal(
    detectProviderPreset({ baseUrl: 'https://api.moonshot.ai/v1' }).presetId,
    'moonshot',
    'detects Moonshot OpenAI-compatible hosts'
  )
  assert.equal(
    detectProviderPreset({ baseUrl: 'https://api.minimax.io/v1' }).presetId,
    'minimax',
    'detects MiniMax OpenAI-compatible hosts'
  )

  const groups = parseCredentialGroups('sk-a\n\nsk-b, sk-c')
  assert.deepEqual(groups.map((group) => group.label), ['令牌分组 1', '令牌分组 2', '令牌分组 3'])
  assert.ok(groups.every((group) => group.enabled), 'parsed groups are enabled by default')
  assert.equal(maskSecret('token-fake-1234567890'), 'toke...7890')
  setServiceLanguage('en')
  assert.equal(st('apiKeyPanel.groupName', { index: 1 }), 'Token group 1', 'service i18n follows language changes')
  assert.equal(st('messageBubble.copyWorkArtifact'), 'Copy work artifact', 'message actions expose work artifact copy')
  assert.equal(st('messageBubble.copyWorkArtifactCopied'), 'Work artifact copied to clipboard.', 'message actions confirm copied work artifacts')
  assert.equal(st('messageBubble.continueWorkArtifact'), 'Continue work', 'message actions expose work artifact continuation')
  assert.equal(st('messageBubble.continueWorkArtifactInserted'), 'Continuation prompt inserted.', 'message actions confirm inserted continuation prompts')
  assert.ok(st('onboarding.firstPrompt.samples.engineering').includes('Verification command or evidence'), 'onboarding first prompt seeds structured productivity drafts')
  assert.ok(st('onboarding.firstPrompt.samples.organize').includes('A version I can copy'), 'onboarding organize prompt produces a shareable work artifact')
  assert.equal(st('chatRunner.trace.compactPolicyTitle'), 'Compact policy', 'chat runner exposes compact policy trace label')
  assert.equal(st('chatRunner.error.remoteCompactRequiredFailed'), 'Remote compact is required, but the current provider does not declare support.', 'chat runner exposes remote compact required failure text')
  assert.equal(st('providerTrace.runtimeGovernanceTitle'), 'Runtime policy', 'provider trace exposes runtime governance trace label')
  assert.equal(st('providerTrace.runtimeFallbackTitle'), 'Runtime fallback', 'provider trace exposes runtime fallback trace label')
  ;[
    'onboarding.firstPrompt.samples.concise',
    'onboarding.firstPrompt.samples.research',
    'onboarding.firstPrompt.samples.engineering',
    'onboarding.firstPrompt.samples.organize',
    'onboarding.firstPrompt.samples.plan',
  ].forEach((key) => assertStructuredWorkTemplate(st(key), key, 'en'))
  setServiceLanguage('ja')
  assert.equal(st('search.disabled'), 'Web 検索は無効です。', 'service i18n supports Japanese resources')
  assert.equal(st('messageBubble.copyWorkArtifact'), '作業成果をコピー', 'Japanese message actions expose work artifact copy')
  assert.equal(st('messageBubble.continueWorkArtifact'), 'この作業を続ける', 'Japanese message actions expose work artifact continuation')
  assert.ok(st('onboarding.firstPrompt.samples.plan').includes('決定ログ'), 'Japanese onboarding first prompt produces parser-recognizable work artifacts')
  ;[
    'onboarding.firstPrompt.samples.concise',
    'onboarding.firstPrompt.samples.research',
    'onboarding.firstPrompt.samples.engineering',
    'onboarding.firstPrompt.samples.organize',
    'onboarding.firstPrompt.samples.plan',
  ].forEach((key) => assertStructuredWorkTemplate(st(key), key, 'ja'))
  setServiceLanguage('zh-CN')

  const governedProvider = {
    id: 'openai-main',
    type: 'openai',
    presetId: 'openai',
    detectedPresetId: 'openai',
    name: 'OpenAI',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.2'],
    enabled: true,
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      vision: true,
      files: true,
      audioInput: false,
      audioTranscription: true,
      speech: true,
      nativeSearch: true,
      reasoningEffort: true,
      topP: true,
      responsesApi: true,
      responsesWebSocket: true,
      remoteCompact: true,
      payloadPolicy: true,
    },
  }
  assert.deepEqual(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { providerAllowlist: ['openai-*'], modelAllowlist: ['gpt-*'] },
    }),
    { allowed: true, providerId: 'openai-main', model: 'gpt-5.2', matchedRules: ['providerAllowlist:openai-*', 'modelAllowlist:gpt-*'] },
    'provider/model allowlists accept exact and wildcard matches'
  )
  assert.equal(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { providerBlocklist: ['openai-main'] },
    }).reason,
    'provider_blocked',
    'provider blocklist takes precedence'
  )
  assert.equal(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { providerBlocklist: ['preset:openai'] },
    }).reason,
    'provider_blocked',
    'provider blocklist accepts preset-scoped matches'
  )
  assert.equal(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { providerAllowlist: ['preset:openai'] },
    }).allowed,
    true,
    'provider allowlist accepts preset-scoped matches'
  )
  assert.equal(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { providerAllowlist: ['host:api.openai.com'] },
    }).allowed,
    true,
    'provider allowlist accepts host-scoped matches'
  )
  assert.equal(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { modelBlocklist: ['family:gpt'] },
    }).reason,
    'model_blocked',
    'model blocklist accepts family-scoped matches'
  )
  assert.equal(
    resolveProviderModelAccessForTest({
      provider: governedProvider,
      model: 'gpt-5.2',
      settings: { modelAllowlist: ['family:gpt'] },
    }).allowed,
    true,
    'model allowlist accepts family-scoped matches'
  )
  const payloadWarn = evaluatePayloadRulesForTest({
    body: { model: 'gpt-5.2', input: [{ role: 'user', content: 'hello' }] },
    messages: [{ role: 'user', content: 'hello' }],
    mode: 'warn',
  })
  assert.equal(payloadWarn.blocked, false, 'payload warn mode does not block valid requests')
  const payloadBlock = evaluatePayloadRulesForTest({
    body: { model: 'gpt-5.2', input: [] },
    messages: [],
    mode: 'block',
  })
  assert.equal(payloadBlock.blocked, true, 'payload block mode blocks empty message requests')
  assert.equal(
    resolveProxyPolicyForTest({
      provider: governedProvider,
      url: 'https://api.openai.com/v1/responses?x=1',
      settings: { proxyMode: 'custom-base-url', proxyBaseUrl: 'https://proxy.example/upstream' },
    }).effectiveUrl,
    'https://proxy.example/upstream/v1/responses?x=1',
    'custom-base-url proxy preserves endpoint path and query'
  )
  assert.deepEqual(
    selectUpstreamTransportForTest({
      provider: governedProvider,
      usesResponsesApi: true,
      stream: true,
      settings: { transportMode: 'websocket' },
      hasWebSocketRuntime: true,
    }),
    { transport: 'responses_websocket', requestedMode: 'websocket' },
    'transport selector allows Responses WebSocket only when runtime and capabilities match'
  )
  assert.equal(
    selectUpstreamTransportForTest({
      provider: { ...governedProvider, capabilities: { ...governedProvider.capabilities, responsesWebSocket: false } },
      usesResponsesApi: true,
      stream: true,
      settings: { transportMode: 'websocket' },
      hasWebSocketRuntime: true,
    }).fallbackReason,
    'provider_capability_missing',
    'transport selector falls back when provider WebSocket capability is missing'
  )
  assert.deepEqual(
    selectUpstreamTransportForTest({
      provider: governedProvider,
      usesResponsesApi: true,
      stream: false,
      settings: { transportMode: 'websocket' },
      hasWebSocketRuntime: true,
    }),
    { transport: 'http_sse', requestedMode: 'websocket', fallbackReason: 'streaming_disabled' },
    'transport selector does not choose Responses WebSocket for non-streaming requests'
  )
  const compactResponsesBody = buildOpenAIResponsesBodyForTest({
    provider: governedProvider,
    model: 'gpt-5.2',
    messages: [{ role: 'user', content: 'compress me' }],
    maxTokens: 128,
    stream: true,
    remoteCompactEligible: true,
    settings: { remoteCompactThreshold: 0.7 },
  })
  assert.deepEqual(
    compactResponsesBody.context_management,
    [{ type: 'compaction', compact_threshold: 0.7 }],
    'Responses requests include server-side compaction when remote compact is eligible'
  )
  const compactEligible = decideRemoteCompact({
    provider: governedProvider,
    model: 'gpt-5.2',
    messages: [{ role: 'user', content: 'x '.repeat(2000) }],
    budgetTokens: 100,
    settings: { remoteCompactMode: 'auto', remoteCompactThreshold: 0.8 },
  })
  assert.equal(compactEligible.enabled, true, 'remote compact auto mode enables under context pressure')
  assert.equal(estimateRemoteCompactSavedTokens(1000, 120), 430, 'remote compact saved-token estimate is deterministic')
  clearCompactUsageRecords()
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 100, outputTokens: 20, estimatedSavedTokens: 35 })
  assert.equal(listCompactUsageRecords().length, 1, 'compact usage accounting stores separate compact records')
  const redactedLog = redactRuntimeLogValue({
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
    apiKey: 'sk-testabcdefghijklmnopqrstuvwxyz123456',
    body: JSON.stringify({ model: 'gpt-5.2', input: [{ content: 'secret prompt text' }] }),
  })
  assert.equal(redactedLog.authorization, '[redacted]', 'runtime log redacts authorization fields')
  assert.equal(redactedLog.apiKey, '[redacted]', 'runtime log redacts API key fields')
  assert.deepEqual(redactedLog.body.keys, ['input', 'model'], 'runtime log stores payload keys instead of full body')
  assert.equal(st('messageBubble.copyWorkArtifact'), '复制工作产物', 'Chinese message actions expose work artifact copy')
  assert.equal(st('messageBubble.continueWorkArtifact'), '继续这项工作', 'Chinese message actions expose work artifact continuation')
  assert.ok(st('onboarding.firstPrompt.samples.research').includes('输出必须包含'), 'Chinese onboarding first prompt remains structured')
  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  assert.ok(settingsScreenSource.includes('localSaved: diagnostics.compact.localEstimatedSavedTokens'), 'settings diagnostics surfaces local compact saved-token totals')
  assert.ok(settingsScreenSource.includes('localRatio: formatCompactRatio(diagnostics.compact.localAverageCompressionRatio)'), 'settings diagnostics surfaces local compact average ratio')
  assert.ok(settingsScreenSource.includes('function formatCompactRatio'), 'settings diagnostics formats local compact ratio for display')
  for (const locale of ['en', 'zh-CN', 'ja']) {
    const localeSource = fs.readFileSync(path.join(root, 'src/i18n/resources', `${locale}.json`), 'utf8')
    assert.ok(localeSource.includes('{{localSaved}}'), `${locale} compact diagnostics includes localSaved placeholder`)
    assert.ok(localeSource.includes('{{localRatio}}'), `${locale} compact diagnostics includes localRatio placeholder`)
  }
  ;[
    'onboarding.firstPrompt.samples.concise',
    'onboarding.firstPrompt.samples.research',
    'onboarding.firstPrompt.samples.engineering',
    'onboarding.firstPrompt.samples.organize',
    'onboarding.firstPrompt.samples.plan',
  ].forEach((key) => assertStructuredWorkTemplate(st(key), key, 'zh'))

  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  assert.ok(!chatWorkspaceSource.includes('WorkStarterActions'), 'chat workspace removes visible work starter actions')
  assert.ok(!chatWorkspaceSource.includes('WORK_STARTERS'), 'chat workspace removes work starter data source')
  assert.ok(!chatWorkspaceSource.includes('workStarterCommands'), 'chat command palette no longer derives work starter commands')
  assert.ok(!chatWorkspaceSource.includes("t('chat.commandWorkStarterDescription')"), 'chat command palette no longer uses work starter descriptions')
  assert.ok(chatWorkspaceSource.includes("import { summarizeWorkArtifact } from '@/utils/workArtifact'"), 'chat workspace imports work artifact summarization')
  assert.ok(chatWorkspaceSource.includes('summarizeWorkArtifact(item.responseText ?? item.content)'), 'chat workspace summarizes assistant output before copying work artifacts')
  assert.ok(chatWorkspaceSource.includes('Clipboard.setStringAsync(workArtifact.handoffText)'), 'chat workspace copies the work artifact handoff package')
  assert.ok(!chatWorkspaceSource.includes('Clipboard.setStringAsync(workArtifact.shareableText)'), 'chat workspace does not copy the weaker shareable summary for work artifact handoff')
  assert.ok(chatWorkspaceSource.includes('function readCompletedWorkArtifactTraceFollowUpPrompt'), 'chat workspace reads completed work artifact follow-up prompts from trace metadata')
  assert.ok(chatWorkspaceSource.includes("continuationAction?.reason !== 'work-artifact-follow-up'"), 'chat workspace only trusts completed work artifact continuation actions for work artifact continuation')
  assert.ok(chatWorkspaceSource.includes('function readValidatedWorkArtifactBodyFollowUpPrompt'), 'chat workspace validates parsed work artifact follow-up prompts before fallback')
  assert.ok(chatWorkspaceSource.includes('const audit = validateWorkArtifactQuality(workArtifact)'), 'chat workspace audits parsed work artifacts before fallback continuation')
  assert.ok(chatWorkspaceSource.includes('const traceFollowUpPrompt = readCompletedWorkArtifactTraceFollowUpPrompt(item)'), 'chat workspace checks the completed work artifact trace before body fallback')
  assert.ok(chatWorkspaceSource.includes('const bodyFollowUpPrompt = readValidatedWorkArtifactBodyFollowUpPrompt(item)'), 'chat workspace reads parsed work artifact fallback only through the validation helper')
  assert.ok(chatWorkspaceSource.includes('const continuePrompt = traceFollowUpPrompt || bodyFollowUpPrompt'), 'chat workspace falls back to validated parsed work artifact follow-up prompts only after trace metadata')
  assert.ok(chatWorkspaceSource.includes('if (!continuePrompt)'), 'chat workspace requires a trace follow-up or validated parser-recognized work artifact before composer insertion')
  assert.ok(chatWorkspaceSource.includes('onApplyStarter(continuePrompt)'), 'chat workspace inserts the safe work artifact continuation prompt into the composer')
  assert.ok(chatWorkspaceSource.includes("t('messageBubble.continueWorkArtifactInserted')"), 'chat workspace confirms continuation prompt insertion')

  const messageBubbleSource = fs.readFileSync(path.join(root, 'src/components/chat/MessageBubble.tsx'), 'utf8')
  assert.ok(messageBubbleSource.includes('onCopyWorkArtifact?: (message: Message) => void'), 'message bubble exposes a typed work artifact copy action')
  assert.ok(messageBubbleSource.includes('onContinueWorkArtifact?: (message: Message) => void'), 'message bubble exposes a typed work artifact continuation action')
  assert.ok(messageBubbleSource.includes("label={t('messageBubble.copyWorkArtifact')}"), 'message bubble renders a localized work artifact action')
  assert.ok(messageBubbleSource.includes("label={t('messageBubble.continueWorkArtifact')}"), 'message bubble renders a localized work artifact continuation action')
  assert.ok(messageBubbleSource.includes('!isUser'), 'work artifact action is guarded to assistant messages')
  assert.ok(messageBubbleSource.includes('onContinueWorkArtifact ? () => onContinueWorkArtifact(message) : undefined'), 'work artifact continuation action is only available when a parent callback exists')

  const workArtifact = summarizeWorkArtifact(`
## Structured summary
- IsleMind is ready to support focused work after release evidence is refreshed.

## Decision log
- Keep the default APK local-first and ship model bundles as optional variants.

## Action items
- Owner: QA / Next step: capture settings readiness and chat action evidence / Deadline: release gate
- Owner: Product / Next step: publish the collaborator brief / Trigger: README version aligned

## Risks and blockers
- APK freshness remains stale until a rebuild and clean install pass.

## Evidence still needed
- bun run type-check -- --incremental false

## Open questions
- Which provider should be recommended first for new users?

## A short version that can be sent to collaborators
- IsleMind can handle focused work once release evidence is refreshed.
`)
  assert.equal(workArtifact.hasWorkArtifact, true, 'assistant replies with structured sections are recognized as work artifacts')
  assert.equal(workArtifact.quality, 'complete', 'complete work artifacts include execution, decision, risk, question, and evidence coverage')
  assert.equal(workArtifact.actionItemCount, 2, 'work artifact summary counts action items')
  assert.equal(workArtifact.executableActionCount, 2, 'work artifact summary counts executable action items')
  assert.equal(workArtifact.decisionCount, 1, 'work artifact summary counts decisions')
  assert.equal(workArtifact.riskCount, 1, 'work artifact summary counts risks')
  assert.equal(workArtifact.openQuestionCount, 1, 'work artifact summary counts open questions')
  assert.equal(workArtifact.evidenceCount, 1, 'work artifact summary counts evidence requests')
  assert.deepEqual(workArtifact.missingKinds, [], 'complete work artifacts expose no missing quality gates')
  assert.equal(workArtifact.primaryNextStep, 'capture settings readiness and chat action evidence', 'work artifacts expose a primary next step')
  assert.ok(workArtifact.qualitySummary.includes('ready to hand off or continue'), 'complete work artifacts expose a handoff readiness summary')
  assert.equal(workArtifact.sections.find((section) => section.kind === 'action')?.items[0]?.owner, 'QA', 'action artifacts preserve owner metadata')
  assert.equal(workArtifact.sections.find((section) => section.kind === 'action')?.items[0]?.nextStep, 'capture settings readiness and chat action evidence', 'action artifacts preserve next-step metadata')
  assert.ok(workArtifact.shareableText.includes('Shareable version'), 'work artifacts expose a copyable shareable summary')
  assert.ok(workArtifact.followUpPrompt.includes('execute the primary next step'), 'complete work artifacts expose a continuation prompt')
  assert.ok(workArtifact.handoffText.startsWith('Work artifact handoff'), 'work artifacts expose a handoff package')
  assert.ok(workArtifact.handoffText.includes('Quality: complete'), 'handoff packages expose quality')
  assert.ok(workArtifact.handoffText.includes('Executable actions: 2/2'), 'handoff packages expose executable action coverage')
  assert.ok(workArtifact.handoffText.includes('Coverage: Decision log 1, Risks 1, Open questions 1, Evidence 1'), 'handoff packages expose maturity gate coverage')
  assert.ok(workArtifact.handoffText.includes('Missing gates: none'), 'complete handoff packages report no missing gates')
  assert.ok(workArtifact.handoffText.includes('Primary next step: capture settings readiness and chat action evidence'), 'handoff packages expose the primary next step')
  assert.ok(workArtifact.handoffText.includes('Quality note: this artifact covers execution'), 'handoff packages include a quality summary')
  assert.ok(workArtifact.handoffText.includes('Continue prompt'), 'handoff packages include a prompt for the next AI turn')
  assert.equal(workArtifact.language, 'en', 'English work artifacts keep English continuation prompts')

  const chineseWorkArtifact = summarizeWorkArtifact(`
结构化摘要
1. 设置和知识库已经形成可恢复的工作台。

行动项
- 负责人：我 / 下一步：整理每日计划 / 截止：今天

风险和阻塞
- 内存不足会阻塞 APK 验证。

待确认问题
- 是否默认启用搜索？
`)
  assert.equal(chineseWorkArtifact.hasWorkArtifact, true, 'Chinese assistant replies are recognized as work artifacts')
  assert.equal(chineseWorkArtifact.quality, 'actionable', 'Chinese work artifacts can be actionable while still missing maturity gates')
  assert.equal(chineseWorkArtifact.actionItemCount, 1, 'Chinese work artifacts count action items')
  assert.equal(chineseWorkArtifact.executableActionCount, 1, 'Chinese work artifacts count executable actions')
  assert.equal(chineseWorkArtifact.riskCount, 1, 'Chinese work artifacts count risks')
  assert.equal(chineseWorkArtifact.openQuestionCount, 1, 'Chinese work artifacts count open questions')
  assert.deepEqual(chineseWorkArtifact.missingKinds, ['decision', 'evidence'], 'work artifact quality reports missing decision and evidence gates')
  assert.equal(chineseWorkArtifact.primaryNextStep, '整理每日计划', 'Chinese work artifacts expose localized next-step metadata')
  assert.equal(chineseWorkArtifact.language, 'zh-CN', 'Chinese work artifacts keep Chinese continuation prompts')
  assert.ok(chineseWorkArtifact.qualitySummary.includes('已有 1 个可执行行动'), 'Chinese work artifacts expose localized quality summaries')
  assert.ok(chineseWorkArtifact.shareableText.includes('摘要'), 'Chinese work artifact sections use localized labels')
  assert.ok(chineseWorkArtifact.followUpPrompt.includes('补齐缺失门槛：决策记录、证据'), 'Chinese actionable work artifacts ask the next turn to fill missing gates in Chinese')
  assert.ok(chineseWorkArtifact.handoffText.startsWith('工作产物交接'), 'Chinese handoff packages use localized titles')
  assert.ok(chineseWorkArtifact.handoffText.includes('质量: actionable'), 'handoff packages preserve actionable quality for localized artifacts')
  assert.ok(chineseWorkArtifact.handoffText.includes('可执行行动: 1/1'), 'Chinese handoff packages expose executable action coverage')
  assert.ok(chineseWorkArtifact.handoffText.includes('覆盖范围: 决策记录 0、风险 1、待确认问题 1、证据 0'), 'Chinese handoff packages expose maturity gate coverage')
  assert.ok(chineseWorkArtifact.handoffText.includes('缺失门槛: 决策记录、证据'), 'handoff packages expose missing quality gates in Chinese')
  assert.ok(chineseWorkArtifact.handoffText.includes('质量说明：产物已有 1 个可执行行动'), 'Chinese handoff packages include localized quality summaries')
  assert.ok(chineseWorkArtifact.handoffText.includes('继续提示'), 'localized handoff packages include a continuation prompt label')
  assert.equal(chineseWorkArtifact.sections.find((section) => section.kind === 'action')?.items[0]?.owner, '我', 'Chinese action artifacts preserve owner metadata')

  const japaneseWorkArtifact = summarizeWorkArtifact(`
要約
- 設定と知識ベースは復旧できる作業台になっています。

アクション項目
- 担当者：私 / 次の一歩：今日の検証結果を整理 / 期限：今日

リスク
- APK 検証が未完了です。

確認事項
- どのプロバイダーを初期推奨にするか？
`)
  assert.equal(japaneseWorkArtifact.hasWorkArtifact, true, 'Japanese assistant replies are recognized as work artifacts')
  assert.equal(japaneseWorkArtifact.language, 'ja', 'Japanese work artifacts keep Japanese continuation prompts')
  assert.equal(japaneseWorkArtifact.quality, 'actionable', 'Japanese work artifacts can be actionable while still missing maturity gates')
  assert.deepEqual(japaneseWorkArtifact.missingKinds, ['decision', 'evidence'], 'Japanese work artifacts report missing decision and evidence gates')
  assert.equal(japaneseWorkArtifact.primaryNextStep, '今日の検証結果を整理', 'Japanese work artifacts expose localized next-step metadata')
  assert.ok(japaneseWorkArtifact.qualitySummary.includes('1 件の実行可能なアクション'), 'Japanese work artifacts expose localized quality summaries')
  assert.ok(japaneseWorkArtifact.followUpPrompt.includes('不足ゲートを補完してください：決定ログ、根拠'), 'Japanese work artifacts ask the next turn to fill missing gates in Japanese')
  assert.ok(japaneseWorkArtifact.handoffText.startsWith('作業成果の引き継ぎ'), 'Japanese handoff packages use localized titles')
  assert.ok(japaneseWorkArtifact.handoffText.includes('実行可能なアクション: 1/1'), 'Japanese handoff packages expose executable action coverage')
  assert.ok(japaneseWorkArtifact.handoffText.includes('カバレッジ: 決定ログ 0、リスク 1、確認事項 1、根拠 0'), 'Japanese handoff packages expose maturity gate coverage')
  assert.ok(japaneseWorkArtifact.handoffText.includes('継続プロンプト'), 'Japanese handoff packages include a localized continuation prompt label')
  assert.equal(japaneseWorkArtifact.sections.find((section) => section.kind === 'action')?.items[0]?.owner, '私', 'Japanese action artifacts preserve owner metadata')

  const weakWorkArtifact = summarizeWorkArtifact(`
Summary
- This is a useful explanation.

Risks
- It does not define an owner or next step.
`)
  assert.equal(weakWorkArtifact.hasWorkArtifact, true, 'weak but structured replies are still detected')
  assert.equal(weakWorkArtifact.quality, 'partial', 'weak work artifacts are not treated as actionable')
  assert.equal(weakWorkArtifact.executableActionCount, 0, 'weak work artifacts do not fake executable actions')
  assert.deepEqual(weakWorkArtifact.missingKinds, ['action', 'decision', 'question', 'evidence'], 'weak work artifacts report missing production gates')
  assert.ok(weakWorkArtifact.qualitySummary.includes('not directly executable yet'), 'weak work artifacts explain why they are not handoff-ready')
  assert.ok(weakWorkArtifact.followUpPrompt.includes('Action items, Decision log, Open questions, Evidence'), 'weak work artifacts produce a repair prompt')
  assert.ok(weakWorkArtifact.handoffText.includes('Executable actions: 0/0'), 'weak handoff packages expose missing executable action coverage')
  assert.ok(weakWorkArtifact.handoffText.includes('Missing gates: Action items, Decision log, Open questions, Evidence'), 'weak handoff packages list missing execution gates')

  const imported = parseProviderImportText(`供应商A: https://a.example/v1, 秘钥: ${FAKE_KEY_A}, 秘钥2: ${FAKE_KEY_B}, 模型: model-a; Provider B, Base URL=https://b.example/v1, API Key=${FAKE_KEY_C}, Models=model-b`)
  assert.equal(imported.providers.length, 2, 'imports semicolon separated provider blocks')
  assert.equal(imported.providers[0].enabled, false, 'imported providers are disabled by default')
  assert.equal(imported.providers[0].credentialGroups.length, 2, 'imports repeated Chinese key fields')
  assert.deepEqual(imported.providers[1].models, ['model-b'], 'imports English model field')

  const csvImported = parseProviderImportText(`Provider C, https://c.example/v1, ${FAKE_KEY_D}`)
  assert.equal(csvImported.providers.length, 1, 'imports CSV-ish provider lines')
  assert.equal(csvImported.providers[0].baseUrl, 'https://c.example/v1')

  const urlKeyImported = parseProviderImportText(`
https://new-api.example.com/
${FAKE_KEY_A}
${FAKE_KEY_B}

https://newapi.example.net/
${FAKE_KEY_C}
${FAKE_KEY_D}
`)
  assert.equal(urlKeyImported.providers.length, 2, 'imports URL followed by key lines separated by blank lines')
  assert.equal(urlKeyImported.providers[0].baseUrl, 'https://new-api.example.com/')
  assert.equal(urlKeyImported.providers[0].name, 'new-api.example.com')
  assert.equal(urlKeyImported.providers[0].credentialGroups.length, 2)
  assert.equal(urlKeyImported.providers[1].baseUrl, 'https://newapi.example.net/')
  assert.equal(urlKeyImported.providers[1].credentialGroups.length, 2)

  const jsonImported = parseProviderImportText(JSON.stringify({
    providers: [
      {
        name: 'JSON Provider',
        baseUrl: 'https://json.example/v1',
        apiKeys: [FAKE_KEY_A, FAKE_KEY_B],
        models: ['json-model-a', 'json-model-b'],
      },
    ],
  }))
  assert.equal(jsonImported.sourceType, 'json')
  assert.equal(jsonImported.providers.length, 1, 'imports JSON provider arrays')
  assert.equal(jsonImported.providers[0].credentialGroups.length, 2)
  assert.deepEqual(jsonImported.providers[0].models, ['json-model-a', 'json-model-b'])

  const newApiConnectionImported = parseProviderImportText(JSON.stringify({
    _type: 'newapi_channel_conn',
    url: 'https://gateway.example/v1',
    key: FAKE_KEY_C,
  }))
  assert.equal(newApiConnectionImported.sourceType, 'json', 'imports NewAPI connection config JSON as JSON')
  assert.equal(newApiConnectionImported.providers.length, 1, 'imports NewAPI connection config JSON')
  assert.equal(newApiConnectionImported.providers[0].presetId, 'newapi', 'NewAPI connection config selects the NewAPI preset')
  assert.equal(newApiConnectionImported.providers[0].name, 'NewAPI / OneAPI', 'NewAPI connection config uses a non-secret provider name')
  assert.equal(newApiConnectionImported.providers[0].baseUrl, 'https://gateway.example/v1', 'NewAPI connection config preserves the provided Base URL')
  assert.equal(newApiConnectionImported.providers[0].credentialGroups.length, 1, 'NewAPI connection config imports one credential group')
  assert.equal(newApiConnectionImported.providers[0].credentialGroups[0][API_KEY_FIELD], FAKE_KEY_C, 'NewAPI connection config stores the provided key in the credential group')
  assert.ok(!newApiConnectionImported.warnings.join('\n').includes(FAKE_KEY_C), 'NewAPI connection config diagnostics do not echo imported keys')
  assert.equal(looksLikeProviderImportConnectionText(JSON.stringify({ _type: 'newapi_channel_conn', url: 'https://gateway.example/v1', key: FAKE_KEY_C })), true, 'provider import draft detects NewAPI connection JSON text')
  const newApiConnectionDraft = parseProviderImportDraft(JSON.stringify({
    _type: 'newapi_channel_conn',
    url: 'https://gateway.example/v1',
    key: FAKE_KEY_C,
  }), { requireConnection: true })
  assert.equal(newApiConnectionDraft?.presetId, 'newapi', 'provider import draft exposes NewAPI preset for form application')
  assert.equal(newApiConnectionDraft?.baseUrl, 'https://gateway.example/v1', 'provider import draft exposes Base URL for form application')
  assert.equal(newApiConnectionDraft?.credentialText, FAKE_KEY_C, 'provider import draft exposes credential text only for field application')

  const providerSettingsContentSource = fs.readFileSync(path.join(root, 'src/components/providers/ProviderSettingsContent.tsx'), 'utf8')
  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  assert.ok(providerSettingsContentSource.includes('Clipboard.hasStringAsync()'), 'provider import requests clipboard text availability before reading clipboard text')
  assert.ok(providerSettingsContentSource.includes('parseProviderImportText(input)'), 'provider import modal detects manually pasted provider configs')
  assert.ok(providerSettingsContentSource.includes("parseProviderImportDraft(text, { requireConnection: source === 'manual', preferredWireProtocol: wireProtocol })"), 'add provider form applies detected provider import drafts from clipboard and manual input')
  assert.ok(providerSettingsContentSource.includes('onChangeText: handleKeysText'), 'add provider form routes token input through provider import auto-detection')
  assert.ok(apiKeyPanelSource.includes('readProviderClipboard'), 'single provider editor exposes clipboard provider import handling')
  assert.ok(apiKeyPanelSource.includes('onChangeText: handleCredentialText'), 'single provider editor routes multi-token input through provider import auto-detection')

  const tableImported = parseProviderImportText(`name,base_url,api_key,models\nCSV Provider,https://csv.example/v1,${FAKE_KEY_E},csv-model`)
  assert.equal(tableImported.sourceType, 'csv')
  assert.equal(tableImported.providers.length, 1, 'imports CSV header rows')
  assert.equal(tableImported.providers[0].baseUrl, 'https://csv.example/v1')
  assert.deepEqual(tableImported.providers[0].models, ['csv-model'])

  const mimoOpenAiImported = parseProviderImportText(`Xiaomi MiMo, https://token-plan-cn.xiaomimimo.com/v1, ${FAKE_MIMO_TP_KEY}`)
  assert.equal(mimoOpenAiImported.providers.length, 1, 'imports MiMo Token Plan OpenAI-compatible provider')
  assert.equal(mimoOpenAiImported.providers[0].type, 'xiaomi-mimo', 'MiMo OpenAI-compatible import detects provider type')
  assert.equal(mimoOpenAiImported.providers[0].credentialMode, 'token-plan', 'MiMo OpenAI-compatible import detects Token Plan key mode')
  assert.equal(mimoOpenAiImported.providers[0].tokenPlanRegion, 'cn', 'MiMo OpenAI-compatible import detects CN region')
  assert.equal(mimoOpenAiImported.providers[0].wireProtocol, 'openai-compatible', 'MiMo /v1 import selects OpenAI-compatible protocol')
  assert.equal(mimoOpenAiImported.providers[0].credentialGroups.length, 1, 'MiMo OpenAI-compatible import keeps tp- key')

  const mimoAnthropicImported = parseProviderImportText(`Xiaomi MiMo Anthropic, https://token-plan-cn.xiaomimimo.com/anthropic, ${FAKE_MIMO_TP_KEY}`)
  assert.equal(mimoAnthropicImported.providers.length, 1, 'imports MiMo Token Plan Anthropic-compatible provider')
  assert.equal(mimoAnthropicImported.providers[0].type, 'xiaomi-mimo', 'MiMo Anthropic-compatible import detects provider type')
  assert.equal(mimoAnthropicImported.providers[0].baseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic', 'MiMo Anthropic-compatible import preserves user-facing /anthropic base URL')
  assert.equal(mimoAnthropicImported.providers[0].credentialMode, 'token-plan', 'MiMo Anthropic-compatible import detects Token Plan key mode')
  assert.equal(mimoAnthropicImported.providers[0].tokenPlanRegion, 'cn', 'MiMo Anthropic-compatible import detects CN region')
  assert.equal(mimoAnthropicImported.providers[0].wireProtocol, 'anthropic-compatible', 'MiMo /anthropic import selects Anthropic-compatible protocol')
  assert.equal(mimoAnthropicImported.providers[0].credentialGroups.length, 1, 'MiMo Anthropic-compatible import keeps tp- key')

  const mimoMultiProtocolText = `${FAKE_MIMO_TP_KEY}
兼容OpenAI接口协议：
https://token-plan-cn.xiaomimimo.com/v1
兼容Anthropic接口协议：
https://token-plan-cn.xiaomimimo.com/anthropic`
  const mimoMultiProtocolImported = parseProviderImportText(mimoMultiProtocolText)
  assert.equal(mimoMultiProtocolImported.providers.length, 2, 'MiMo multi-protocol paste imports both labeled endpoints')
  assert.deepEqual(
    mimoMultiProtocolImported.providers.map((provider) => provider.baseUrl),
    ['https://token-plan-cn.xiaomimimo.com/v1', 'https://token-plan-cn.xiaomimimo.com/anthropic'],
    'MiMo multi-protocol paste preserves labeled endpoint order'
  )
  assert.deepEqual(
    mimoMultiProtocolImported.providers.map((provider) => provider.wireProtocol),
    ['openai-compatible', 'anthropic-compatible'],
    'MiMo multi-protocol paste assigns protocol per labeled endpoint'
  )
  assert.ok(mimoMultiProtocolImported.providers.every((provider) => provider.name === 'Xiaomi MiMo'), 'MiMo multi-protocol paste uses detected preset name')
  assert.ok(mimoMultiProtocolImported.providers.every((provider) => provider.credentialGroups.length === 1), 'MiMo multi-protocol paste keeps the tp- key on each endpoint candidate')
  const mimoAnthropicDraft = parseProviderImportDraft(mimoMultiProtocolText, { requireConnection: true, preferredWireProtocol: 'anthropic-compatible' })
  assert.equal(mimoAnthropicDraft?.baseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic', 'provider import draft can prefer the Anthropic-compatible labeled endpoint')
  assert.equal(mimoAnthropicDraft?.wireProtocol, 'anthropic-compatible', 'provider import draft exposes the preferred Anthropic-compatible protocol')
  const mimoOpenAiDraft = parseProviderImportDraft(mimoMultiProtocolText, { requireConnection: true, preferredWireProtocol: 'openai-compatible' })
  assert.equal(mimoOpenAiDraft?.baseUrl, 'https://token-plan-cn.xiaomimimo.com/v1', 'provider import draft can prefer the OpenAI-compatible labeled endpoint')
  assert.equal(mimoOpenAiDraft?.credentialText, FAKE_MIMO_TP_KEY, 'provider import draft keeps the imported MiMo token plan key')

  const genericMultiProtocolText = `${FAKE_KEY_A}
OpenAI-compatible endpoint:
https://gateway.example/openai/v1
Anthropic-compatible endpoint:
https://gateway.example/anthropic`
  const genericMultiProtocolImported = parseProviderImportText(genericMultiProtocolText)
  assert.equal(genericMultiProtocolImported.providers.length, 2, 'generic multi-protocol paste imports both labeled endpoints')
  assert.deepEqual(
    genericMultiProtocolImported.providers.map((provider) => provider.presetId),
    ['custom-openai-compatible', 'custom-anthropic-compatible'],
    'generic multi-protocol paste selects custom presets from endpoint labels'
  )
  assert.deepEqual(
    genericMultiProtocolImported.providers.map((provider) => provider.wireProtocol),
    ['openai-compatible', 'anthropic-compatible'],
    'generic multi-protocol paste keeps explicit wire protocol hints'
  )
  assert.deepEqual(
    genericMultiProtocolImported.providers.map((provider) => provider.type),
    ['openai-compatible', 'anthropic'],
    'generic multi-protocol paste maps endpoint labels to provider transport types'
  )
  const genericAnthropicDraft = parseProviderImportDraft(genericMultiProtocolText, { requireConnection: true, preferredWireProtocol: 'anthropic-compatible' })
  assert.equal(genericAnthropicDraft?.presetId, 'custom-anthropic-compatible', 'provider import draft can prefer a generic Anthropic-compatible endpoint')
  assert.equal(genericAnthropicDraft?.baseUrl, 'https://gateway.example/anthropic', 'provider import draft applies the generic Anthropic-compatible base URL')
  assert.equal(genericAnthropicDraft?.credentialText, FAKE_KEY_A, 'provider import draft keeps the generic imported key')

  const genericSingleAnthropicText = `${FAKE_KEY_B}
兼容Anthropic接口协议：
https://gateway.example/messages`
  const genericSingleAnthropicImported = parseProviderImportText(genericSingleAnthropicText)
  assert.equal(genericSingleAnthropicImported.providers.length, 1, 'generic single labeled Anthropic paste imports one provider')
  assert.equal(genericSingleAnthropicImported.providers[0].presetId, 'custom-anthropic-compatible', 'generic single labeled Anthropic paste selects the Anthropic-compatible preset even without /anthropic path')
  assert.equal(genericSingleAnthropicImported.providers[0].wireProtocol, 'anthropic-compatible', 'generic single labeled Anthropic paste preserves the label-derived protocol')

  const probeCalls = []
  const probed = await probeProviderPreset(
    { baseUrl: 'https://unknown.example/v1', [API_KEY_FIELD]: 'token-probe-fake' },
    {
      fetch: async (url, init) => {
        probeCalls.push({ url, auth: init.headers.Authorization })
        return {
          ok: probeCalls.length === 1,
          status: probeCalls.length === 1 ? 200 : 404,
          json: async () => ({ data: [{ id: 'gpt-4o-mini' }] }),
        }
      },
    }
  )
  assert.equal(probed.ok, true, 'network probe detects OpenAI-compatible /models')
  assert.equal(probed.presetId, 'custom-openai-compatible')
  assert.equal(probeCalls.length, 1, 'network probe stops after first successful protocol')

  const failedProbe = await probeProviderPreset(
    { baseUrl: 'https://unknown.example/v1', [API_KEY_FIELD]: 'token-probe-fake' },
    {
      fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
    }
  )
  assert.equal(failedProbe.ok, false, 'failed network probe keeps a manual-friendly fallback')
  assert.equal(failedProbe.presetId, 'custom-openai-compatible')

  assert.equal(resolveSearchProvider({ webSearchEnabled: true, searchProvider: 'google' }), 'google')
  assert.equal(resolveSearchProvider({ webSearchEnabled: true, webSearchMode: 'tavily' }), 'tavily')
  assert.equal(resolveSearchProvider({ webSearchEnabled: false, searchProvider: 'google' }), 'off')
  assert.equal(legacySearchModeForProvider('bing'), 'tavily')
  assert.equal(getBingCompatibleEndpoint({ customSearchEndpoint: '' }), null, 'Bing requires an explicit compatible endpoint')
  assert.equal(getBingCompatibleEndpoint({ customSearchEndpoint: ' https://search.example?q={query} ' }), 'https://search.example?q={query}')

  const provider = applyProviderPreset(
    {
      id: 'newapi-main',
      type: 'openai-compatible',
      name: 'NewAPI',
      apiKey: '',
      baseUrl: 'https://new-api.abrdns.com',
      enabled: true,
      models: [],
      credentialGroups: groups.map((group, index) => ({
        ...group,
        [API_KEY_FIELD]: `token-test-${index}`,
        lastModelSyncStatus: 'ok',
        availableModels: index === 0 ? ['gpt-4o-mini'] : ['claude-3-5-sonnet-20241022'],
      })),
    },
    'newapi'
  )
  assert.deepEqual(provider.models, [], 'preset application does not inject default models')
  const deepseekPreset = applyProviderPreset(
    {
      id: 'deepseek-empty',
      type: 'openai-compatible',
      name: '',
      models: [],
    },
    'deepseek'
  )
  assert.deepEqual(deepseekPreset.models, [], 'quick presets expose no saved default models')
  const importWithoutModels = parseProviderImportText(`Provider Empty, https://empty.example/v1, ${FAKE_KEY_F}`)
  assert.deepEqual(importWithoutModels.providers[0].models, [], 'provider import keeps models empty when no model field is provided')
  const policyImported = parseProviderImportText(
    `Policy Provider, https://policy.example/v1, ${FAKE_KEY_A}, Models=allowed-chat|blocked-chat`,
    { accessSettings: { modelAllowlist: ['allowed-*'], modelBlocklist: ['blocked-*'] } }
  )
  assert.deepEqual(policyImported.providers[0].models, ['allowed-chat'], 'provider import filters explicit models through access policy')
  assert.equal(policyImported.warnings.length, 1, 'provider import records model policy filtering')
  const providerPolicyImported = parseProviderImportText(
    `Blocked Provider, https://blocked.example/v1, ${FAKE_KEY_B}, Models=allowed-chat`,
    { accessSettings: { providerBlocklist: ['import-*'] } }
  )
  assert.deepEqual(providerPolicyImported.providers, [], 'provider import skips providers blocked by provider policy')
  assert.equal(providerPolicyImported.warnings.length, 1, 'provider import records provider policy skips')
  assert.deepEqual(
    clearHistoricalInjectedProviderModels({
      id: 'legacy-defaults',
      type: 'openai-compatible',
      name: 'Legacy defaults',
      apiKey: '',
      models: ['deepseek-v4-pro', 'custom-manual-model', 'deepseek-v4-flash'],
      enabled: false,
    }),
    ['custom-manual-model'],
    'legacy injected DeepSeek defaults are removed from mixed unsynced model lists'
  )
  assert.deepEqual(
    parseModelEntries('manual-chat\nfast=gpt-4o-mini\nreasoner -> deepseek-reasoner\nmanual-chat'),
    {
      models: ['manual-chat', 'gpt-4o-mini', 'deepseek-reasoner'],
      aliases: [
        { alias: 'fast', model: 'gpt-4o-mini' },
        { alias: 'reasoner', model: 'deepseek-reasoner' },
      ],
    },
    'manual model editor parses model IDs and alias mappings'
  )
  assert.deepEqual(
    clearHistoricalInjectedGroupModels({
      id: 'group-defaults',
      label: 'group',
      enabled: true,
      availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }),
    [],
    'legacy injected DeepSeek defaults are removed from unsynced credential groups'
  )
  assert.deepEqual(
    clearHistoricalInjectedGroupModels({
      id: 'group-synced',
      label: 'group',
      enabled: true,
      lastModelSyncStatus: 'ok',
      availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }),
    [],
    'synced credential group DeepSeek placeholders are removed for non-DeepSeek providers'
  )
  assert.deepEqual(
    clearHistoricalInjectedGroupModels({
      id: 'group-deepseek',
      label: 'group',
      enabled: true,
      lastModelSyncStatus: 'ok',
      availableModels: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    }, {
      id: 'deepseek-real',
      type: 'openai-compatible',
      name: 'DeepSeek',
      apiKey: '',
      presetId: 'deepseek',
      models: [],
      enabled: false,
    }),
    ['deepseek-v4-pro', 'deepseek-v4-flash'],
    'real DeepSeek credential group model lists are preserved'
  )

  const normalized = normalizeProviderCredentialGroups(provider)
  assert.equal(normalized.credentialGroups.length, 3)
  assert.equal(chooseCredentialForModel(normalized, 'claude-3-5-sonnet-20241022').credentialGroupId, groups[1].id)
  const blankGroupProvider = normalizeProviderCredentialGroups({
    ...provider,
    models: ['legacy-provider-model'],
    credentialGroups: [{ ...groups[0], availableModels: undefined }],
  })
  assert.deepEqual(blankGroupProvider.credentialGroups[0].availableModels, [], 'credential groups do not inherit provider models without a sync result')
  const manualProvider = normalizeProviderCredentialGroups({
    ...provider,
    id: 'manual-only',
    models: [],
    manualModels: ['manual-chat'],
    modelAliases: [{ alias: 'fast', model: 'gpt-4o-mini' }],
    lastModelSyncStatus: 'bad',
    credentialGroups: [{ ...groups[0], availableModels: ['gpt-4o-mini'], lastModelSyncStatus: 'ok' }],
  })
  assert.deepEqual(getProviderManualModels(manualProvider), ['manual-chat'], 'explicit manual models survive failed /models sync')
  assert.deepEqual(getProviderSelectableModels(manualProvider), ['gpt-4o-mini', 'manual-chat', 'fast'], 'selectable models include synced models, manual models, and aliases')
  assert.equal(resolveProviderModelAlias(manualProvider, 'fast'), 'gpt-4o-mini', 'model alias resolves to upstream model id')
  assert.deepEqual(
    summarizeProviderModelInventory(manualProvider),
    {
      remoteModels: 1,
      manualModels: 1,
      aliases: 1,
      selectableModels: 3,
      hasRemoteEvidence: true,
    },
    'provider model inventory summarizes remote models, manual models, and aliases separately'
  )
  assert.equal(chooseCredentialForModel(manualProvider, 'fast').credentialGroupId, groups[0].id, 'credential selection matches alias through upstream model')
  assert.equal(
    getBodyForTest({
      provider: manualProvider,
      model: resolveProviderModelAlias(manualProvider, 'fast'),
      requestedModel: 'fast',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    }).model,
    'gpt-4o-mini',
    'request body sends upstream model when conversation stores an alias'
  )
  assert.equal(
    resolveProviderModelAccessForTest({ provider: manualProvider, model: resolveProviderModelAlias(manualProvider, 'fast'), settings: { modelAllowlist: ['gpt-*'] } }).allowed,
    true,
    'model allowlist can match the upstream target for an alias'
  )
  assert.equal(
    resolveProviderModelAccessForTest({ provider: manualProvider, model: 'fast', settings: { modelBlocklist: ['fast'] } }).allowed,
    false,
    'model blocklist can block the alias itself'
  )
  const aliasAllowOnly = mergeAliasAccessPolicyForTest(
    resolveProviderModelAccessForTest({ provider: manualProvider, model: 'fast', settings: { modelAllowlist: ['gpt-*'] } }),
    resolveProviderModelAccessForTest({ provider: manualProvider, model: resolveProviderModelAlias(manualProvider, 'fast'), settings: { modelAllowlist: ['gpt-*'] } })
  )
  assert.equal(aliasAllowOnly.allowed, true, 'alias access policy accepts allowlist matches on the upstream model')
  const aliasBlock = mergeAliasAccessPolicyForTest(
    resolveProviderModelAccessForTest({ provider: manualProvider, model: 'fast', settings: { modelBlocklist: ['fast'], modelAllowlist: ['gpt-*'] } }),
    resolveProviderModelAccessForTest({ provider: manualProvider, model: resolveProviderModelAlias(manualProvider, 'fast'), settings: { modelBlocklist: ['fast'], modelAllowlist: ['gpt-*'] } })
  )
  assert.equal(aliasBlock.allowed, false, 'alias access policy keeps blocklist precedence over upstream allowlist')
  assert.equal(
    resolveProviderModelAliasAccessForTest({ provider: manualProvider, model: 'fast', settings: { modelAllowlist: ['gpt-*'] } }).allowed,
    true,
    'shared alias access helper accepts allowlist matches on the upstream model'
  )
  assert.equal(
    resolveProviderModelAliasAccessForTest({ provider: manualProvider, model: 'fast', settings: { modelBlocklist: ['fast'], modelAllowlist: ['gpt-*'] } }).allowed,
    false,
    'shared alias access helper keeps alias blocklist precedence'
  )
  const displayPolicyProvider = { ...manualProvider, id: 'display-policy-provider', enabled: true }
  const displayDisabledProvider = { ...manualProvider, id: 'display-disabled-policy-provider', enabled: false }
  const displayBlockedProvider = { ...manualProvider, id: 'display-blocked-policy-provider', enabled: true }
  const displayLocalSetupProvider = { ...manualProvider, id: 'local-setup', enabled: true }
  const displayCandidates = getProviderModelDisplayCandidates({
    providers: [displayPolicyProvider, displayDisabledProvider, displayBlockedProvider, displayLocalSetupProvider],
    settings: {
      modelAllowlist: ['gpt-*'],
      providerBlocklist: [displayBlockedProvider.id],
    },
  })
  assert.deepEqual(displayCandidates.map((candidate) => candidate.provider.id), [displayPolicyProvider.id], 'provider picker display candidates hide disabled, local setup, and policy-blocked providers')
  assert.deepEqual(displayCandidates[0].models, ['gpt-4o-mini', 'fast'], 'model picker display candidates expose only policy-allowed direct and alias models')
  assert.equal(displayCandidates[0].preferredModel, 'gpt-4o-mini', 'display candidates expose the policy-allowed preferred model')
  const managementDisplayCandidates = getProviderModelDisplayCandidates({
    providers: [displayDisabledProvider],
    settings: { modelAllowlist: ['gpt-*'] },
    includeDisabled: true,
  })
  assert.deepEqual(managementDisplayCandidates.map((candidate) => candidate.provider.id), [displayDisabledProvider.id], 'provider management model filtering can inspect disabled providers without exposing them to chat picker defaults')

  const failedHealth = updateCredentialGroupHealth(normalized, groups[1].id, false, 2000)
  assert.equal(failedHealth.credentialGroups[1].failureCount, 1)
  assert.equal(failedHealth.credentialGroups[1].lastFailureAt, 2000)
  const healthyAgain = updateCredentialGroupHealth(failedHealth, groups[1].id, true, 3000)
  assert.equal(healthyAgain.credentialGroups[1].failureCount, 0)
  assert.equal(healthyAgain.credentialGroups[1].lastUsedAt, 3000)

  const availability = mergeCredentialModelAvailability(normalized.credentialGroups)
  assert.deepEqual(
    availability.find((item) => item.modelId === 'claude-3-5-sonnet-20241022')?.credentialGroupIds,
    [groups[1].id, groups[2].id]
  )
  const testedReadyProvider = {
    ...normalized,
    enabled: true,
    lastTestStatus: 'ok',
    lastTestModel: 'claude-3-5-sonnet-20241022',
  }
  assert.equal(getProviderPreferredModel(testedReadyProvider), 'claude-3-5-sonnet-20241022', 'last tested model is preferred for conversation defaults')
  assert.equal(isProviderConversationReady(testedReadyProvider), true, 'provider is chat-ready only after a successful model test')
  assert.deepEqual(getProviderAvailableModels(testedReadyProvider), ['gpt-4o-mini', 'claude-3-5-sonnet-20241022'], 'provider available models merge provider and synced group models')
  assert.equal(
    isProviderConversationReady({ ...testedReadyProvider, lastTestStatus: 'bad', lastTestModel: 'gpt-4o-mini' }),
    false,
    'synced models without a passing test are not treated as chat-ready'
  )
  assert.equal(classifyMemoryCandidateForTest('用户偏好：使用中文回答'), 'none', 'stable user preferences are accepted as memory candidates')
  assert.equal(classifyMemoryCandidateForTest('用户 API Key 是 sk-secret-test'), 'sensitive', 'memory candidates reject API keys and secrets')
  assert.equal(classifyMemoryCandidateForTest('用户默认令牌是 tp-test-token-plan-fake-1234567890'), 'sensitive', 'memory candidates reject provider-token shaped values')
  assert.equal(classifyMemoryCandidateForTest('用户凭证是 ghp_abcdefghijklmnopqrstuvwxyz123456'), 'sensitive', 'memory candidates reject GitHub-token shaped values')
  assert.equal(classifyMemoryCandidateForTest('用户标识：ProjectPhoenixPreferredLocaleZhCN'), 'none', 'stable non-secret identifiers are still accepted')
  assert.equal(classifyMemoryCandidateForTest('用户今天想临时用英文回答'), 'one_time', 'memory candidates reject one-time or temporary instructions')
  assert.equal(classifyMemoryCandidateForTest('用户可能喜欢深色模式'), 'uncertain', 'memory candidates reject uncertain inferred preferences')
  assert.equal(classifyMemoryCandidateForTest('json: []'), 'empty', 'empty model memory output is classified explicitly')
  const memoryReviewSummary = buildMemoryReviewSummary([
    { id: 'pending-model', content: 'Model pending memory', status: 'pending', sourceKind: 'model', confidence: 0.62, createdAt: 1000, updatedAt: 1000 },
    { id: 'pending-rule', content: 'Rule pending memory', status: 'pending', sourceKind: 'deterministic', confidence: 0.82, createdAt: 1000, updatedAt: 1000 },
    { id: 'pending-legacy', content: 'Legacy pending memory', status: 'pending', confidence: undefined, createdAt: 1000, updatedAt: 1000 },
    { id: 'active-model', content: 'Active memory should not require review', status: 'active', sourceKind: 'model', confidence: 0.2, createdAt: 1000, updatedAt: 1000 },
  ])
  assert.deepEqual(
    memoryReviewSummary,
    {
      pendingCount: 3,
      modelCount: 1,
      deterministicCount: 1,
      manualCount: 0,
      importedCount: 0,
      legacyCount: 1,
      lowConfidenceCount: 1,
      averageConfidence: 0.72,
    },
    'memory review summary exposes pending provenance and low-confidence review pressure'
  )
  const memoryReviewQueue = [
    { id: 'pending-imported', content: 'Imported memory', status: 'pending', sourceKind: 'imported', confidence: 0.91, createdAt: 1000, updatedAt: 1000 },
    { id: 'pending-model-low', content: 'Low confidence model memory', status: 'pending', sourceKind: 'model', confidence: 0.62, createdAt: 1000, updatedAt: 1000 },
    { id: 'pending-manual', content: 'Manual memory', status: 'pending', sourceKind: 'manual', confidence: 1, createdAt: 1000, updatedAt: 1000 },
    { id: 'pending-legacy', content: 'Legacy memory', status: 'pending', confidence: undefined, createdAt: 1000, updatedAt: 1000 },
    { id: 'active-imported', content: 'Active imported memory', status: 'active', sourceKind: 'imported', confidence: 0.2, createdAt: 1000, updatedAt: 1000 },
  ]
  assert.deepEqual(filterPendingMemoriesForReview(memoryReviewQueue, 'imported').map((memory) => memory.id), ['pending-imported'], 'memory review queue can isolate imported mem0 memories before approval')
  assert.deepEqual(filterPendingMemoriesForReview(memoryReviewQueue, 'model').map((memory) => memory.id), ['pending-model-low'], 'memory review queue can isolate model-extracted memories')
  assert.deepEqual(filterPendingMemoriesForReview(memoryReviewQueue, 'manual').map((memory) => memory.id), ['pending-manual'], 'memory review queue can isolate manually added pending memories')
  assert.deepEqual(filterPendingMemoriesForReview(memoryReviewQueue, 'legacy').map((memory) => memory.id), ['pending-legacy'], 'memory review queue can isolate legacy memories with missing provenance')
  assert.deepEqual(filterPendingMemoriesForReview(memoryReviewQueue, 'lowConfidence').map((memory) => memory.id), ['pending-model-low'], 'memory review queue isolates low-confidence pending memories and excludes active memories')
  const knowledgeRecoverySummary = buildKnowledgeRecoverySummary([
    { id: 'ready-doc', title: 'Ready', mimeType: 'text/plain', size: 1200, chunkCount: 3, status: 'ready', createdAt: 1000, updatedAt: 1000 },
    { id: 'failed-doc', title: 'Failed', mimeType: 'text/plain', size: 800, chunkCount: 0, status: 'error', error: 'Parser failed', createdAt: 1000, updatedAt: 1200 },
    { id: 'empty-doc', title: 'Empty', mimeType: 'text/plain', size: 0, chunkCount: 0, status: 'ready', createdAt: 1000, updatedAt: 1300 },
    { id: 'indexing-doc', title: 'Indexing', mimeType: 'text/plain', size: 500, chunkCount: 0, status: 'extracting', createdAt: 1000, updatedAt: 1400 },
  ], [
    { id: 'job-error', documentId: 'failed-doc', kind: 'embedding', status: 'error', error: 'Embedding failed', createdAt: 1000, updatedAt: 1500 },
    { id: 'job-running', documentId: 'indexing-doc', kind: 'embedding', status: 'running', progress: 0.4, createdAt: 1000, updatedAt: 1600 },
  ])
  assert.deepEqual(
    knowledgeRecoverySummary,
    {
      failedDocuments: 1,
      emptyDocuments: 1,
      indexingDocuments: 1,
      failedJobs: 1,
      runningJobs: 1,
      recoverableDocuments: 2,
      lastError: 'Parser failed',
    },
    'knowledge recovery summary exposes failed documents, empty documents, job failures, and the latest actionable error'
  )
  const onboardingResearch = getOnboardingCompanionProfile('research')
  const onboardingEngineering = getOnboardingCompanionProfile('engineering')
  const onboardingConcise = getOnboardingCompanionProfile('concise')
  const defaultOnboarding = getOnboardingCompanionProfile()
  const defaultConversationDefaults = getOnboardingConversationDefaults()
  assert.equal(DEFAULT_ONBOARDING_COMPANION_MODE, 'concise', 'onboarding defaults to concise mode')
  assert.equal(defaultOnboarding.mode, 'concise', 'missing onboarding mode resolves to concise profile')
  assert.equal(defaultConversationDefaults.temperature, 0.3, 'default conversation settings stay concise')
  assert.equal(defaultConversationDefaults.reasoningEffort, 'low', 'default conversation reasoning stays concise')
  assert.equal(defaultConversationDefaults.systemPrompt, '', 'default conversations start without a preset system prompt')
  assert.equal(onboardingResearch.ragProfile, 'deep', 'research onboarding defaults to deep RAG')
  assert.equal(onboardingEngineering.reasoningEffort, 'high', 'engineering onboarding defaults to high reasoning')
  assert.equal(onboardingConcise.ragProfile, 'fast', 'concise onboarding favors fast retrieval')
  assert.equal(isOnboardingSystemPrompt(''), false, 'empty system prompts are not treated as legacy onboarding text')
  assert.equal(isOnboardingSystemPrompt('Custom project prompt'), false, 'custom system prompts are preserved')
  const creativeConversationDefaults = getOnboardingConversationDefaults('creative')
  assert.equal(creativeConversationDefaults.reasoningEffort, 'medium', 'creative chat defaults use medium reasoning')
  assert.equal(creativeConversationDefaults.temperature, 0.9, 'creative chat defaults use a higher temperature')
  assert.equal(creativeConversationDefaults.systemPrompt, '', 'creative chat defaults do not inject a preset system prompt')
  const companionSettings = getOnboardingSettingsDefaults('companion')
  assert.deepEqual(
    companionSettings,
    {
      onboardingCompanionMode: 'companion',
      defaultTemperature: 0.75,
      ragProfile: 'balanced',
      knowledgeTopK: 4,
      memoryTopK: 6,
    },
    'onboarding completion persists runtime defaults, not only the selected mode'
  )
  contextMemoryRows.splice(0, contextMemoryRows.length,
    {
      id: 'pending-memory',
      content: 'Pending memory should wait for user confirmation before retrieval.',
      status: 'pending',
      sourceKind: 'model',
      sourceDetail: 'Model-assisted extraction from recent conversation',
      confidence: 0.68,
      score: -1,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'active-memory',
      content: 'Active memory is allowed in chat context retrieval.',
      status: 'active',
      sourceKind: 'deterministic',
      sourceDetail: 'Rule-based extraction from explicit user statements',
      confidence: 0.82,
      score: -1,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'low-confidence-memory',
      content: 'Low-confidence memory is lower priority when retrieval evidence ties.',
      status: 'active',
      sourceKind: 'model',
      sourceDetail: 'Model-assisted extraction from recent conversation',
      confidence: 0.2,
      score: -1,
      createdAt: 1000,
      updatedAt: 1000,
    }
  )
  const defaultMemoryHits = await searchMemories('memory retrieval', 5)
  assert.deepEqual(defaultMemoryHits.map((hit) => hit.id), ['active-memory', 'low-confidence-memory'], 'default memory retrieval excludes pending memories until the user confirms them')
  const reviewMemoryHits = await searchMemories('memory retrieval', 5, ['pending', 'active'])
  assert.deepEqual(new Set(reviewMemoryHits.map((hit) => hit.id)), new Set(['pending-memory', 'active-memory', 'low-confidence-memory']), 'review flows can explicitly include pending memories')
  assert.equal(
    reviewMemoryHits.findIndex((hit) => hit.id === 'active-memory') < reviewMemoryHits.findIndex((hit) => hit.id === 'low-confidence-memory'),
    true,
    'memory retrieval ranks lower-confidence memories after stronger memories when evidence ties'
  )
  assert.ok(
    reviewMemoryHits.find((hit) => hit.id === 'pending-memory')?.sourceReason?.includes('source=model'),
    'review memory retrieval exposes model extraction provenance'
  )
  assert.ok(
    reviewMemoryHits.find((hit) => hit.id === 'pending-memory')?.sourceReason?.includes('confidence=0.68'),
    'review memory retrieval exposes extraction confidence'
  )
  assert.ok(
    reviewMemoryHits.find((hit) => hit.id === 'active-memory')?.sourceReason?.includes('source=deterministic'),
    'active memory retrieval exposes deterministic extraction provenance'
  )
  await importContextSnapshot({
    memories: [{
      id: 'imported-memory',
      content: 'Imported memory without provenance receives an imported source kind.',
      status: 'active',
      createdAt: 2000,
      updatedAt: 2000,
    }],
  })
  const importedSnapshot = await exportContextSnapshot()
  assert.equal(importedSnapshot.memories.find((memory) => memory.id === 'imported-memory')?.sourceKind, 'imported', 'imported memories without source metadata are marked as imported')
  assert.equal(importedSnapshot.memories.find((memory) => memory.id === 'imported-memory')?.confidence, 0.74, 'imported memories without confidence use the imported confidence default')
  const mem0Envelope = exportMemoriesAsMem0(importedSnapshot.memories, { user_id: 'local-user', app_id: 'islemind' }, '2026-05-28T20:30:00.000Z')
  assert.equal(mem0Envelope.schema, 'islemind.mem0.v1', 'mem0 export declares a stable IsleMind interchange schema')
  assert.equal(mem0Envelope.filters.user_id, 'local-user', 'mem0 export preserves user scope filters')
  assert.equal(mem0Envelope.memories[0].memory, 'Imported memory without provenance receives an imported source kind.', 'mem0 export uses the canonical memory field')
  assert.equal(mem0Envelope.memories[0].metadata.islemind_source_kind, 'imported', 'mem0 export keeps IsleMind memory provenance')
  assert.equal(mem0Envelope.memories[0].metadata.islemind_status, 'active', 'mem0 export keeps IsleMind review status')
  assert.equal(mem0Envelope.memories[0].created_at, '1970-01-01T00:00:02.000Z', 'mem0 export converts local timestamps to ISO timestamps')
  const mem0Payload = buildMem0AddPayload(importedSnapshot.memories[0], { user_id: 'local-user' })
  assert.deepEqual(mem0Payload.messages, [{ role: 'user', content: 'Imported memory without provenance receives an imported source kind.' }], 'mem0 add payload uses message input for API compatibility')
  assert.equal(mem0Payload.infer, false, 'mem0 add payload disables second-pass inference because IsleMind already extracted the memory')
  const mem0Imported = importMem0Memories([
    {
      id: 'mem0-remote-id',
      memory: 'Remote mem0 memory should enter IsleMind review first.',
      user_id: 'remote-user',
      agent_id: 'assistant',
      metadata: { confidence: 0.91 },
      created_at: '2026-05-28T20:31:00.000Z',
      updated_at: '2026-05-28T20:32:00.000Z',
    },
    {
      memory: 'IsleMind round-tripped memory should keep its local status.',
      metadata: {
        islemind_id: 'roundtrip-memory',
        islemind_status: 'active',
        islemind_source_kind: 'model',
        islemind_source_detail: 'validated by user',
        islemind_confidence: 0.66,
        islemind_created_at_ms: 3000,
        islemind_updated_at_ms: 4000,
      },
    },
  ], { now: 5000 })
  assert.equal(mem0Imported[0].id, 'mem0-remote-id', 'mem0 import keeps remote ids when no IsleMind id exists')
  assert.equal(mem0Imported[0].status, 'pending', 'mem0 import defaults external memories to pending review')
  assert.equal(mem0Imported[0].sourceKind, 'imported', 'mem0 import marks external memories as imported')
  assert.equal(mem0Imported[0].sourceDetail, 'mem0:user_id=remote-user,agent_id=assistant', 'mem0 import records entity scope as source detail')
  assert.equal(mem0Imported[0].confidence, 0.91, 'mem0 import accepts external confidence metadata')
  assert.equal(mem0Imported[0].createdAt, Date.parse('2026-05-28T20:31:00.000Z'), 'mem0 import parses created_at timestamps')
  assert.deepEqual(
    mem0Imported[1],
    {
      id: 'roundtrip-memory',
      content: 'IsleMind round-tripped memory should keep its local status.',
      status: 'active',
      conversationId: undefined,
      sourceKind: 'model',
      sourceDetail: 'validated by user',
      confidence: 0.66,
      lastHitAt: undefined,
      createdAt: 3000,
      updatedAt: 4000,
    },
    'mem0 import preserves IsleMind round-trip metadata when present'
  )
  const portableJson = JSON.parse(await exportAllData())
  assert.equal(portableJson.mem0.schema, 'islemind.mem0.v1', 'portable export includes a mem0-compatible memory envelope')
  assert.equal(portableJson.mem0.filters.app_id, 'islemind', 'portable mem0 export declares the app scope')
  assert.equal(portableJson.mem0.memories[0].metadata.islemind_id, 'imported-memory', 'portable mem0 export keeps local memory provenance')
  const mem0OnlyImportOk = await importAllData(JSON.stringify({
    schema: 'islemind.mem0.v1',
    source: 'islemind',
    exported_at: '2026-05-28T21:00:00.000Z',
    filters: { user_id: 'remote-user' },
    memories: [{
      id: 'portable-mem0-memory',
      memory: 'Portable mem0 import enters IsleMind memory review.',
      user_id: 'remote-user',
      metadata: { confidence: 0.88 },
      created_at: '2026-05-28T21:01:00.000Z',
      updated_at: '2026-05-28T21:02:00.000Z',
    }],
  }))
  assert.equal(mem0OnlyImportOk, true, 'portable import accepts mem0-compatible memory envelopes')
  const mem0OnlyImportResult = await importAllDataDetailed(JSON.stringify({
    schema: 'islemind.mem0.v1',
    source: 'islemind',
    exported_at: '2026-05-28T21:10:00.000Z',
    filters: { user_id: 'remote-user' },
    memories: [{
      id: 'portable-mem0-memory-detailed',
      memory: 'Detailed mem0 import reports the imported review count.',
      user_id: 'remote-user',
    }],
  }))
  assert.deepEqual(mem0OnlyImportResult, { ok: true, kind: 'mem0', memories: 1 }, 'detailed mem0 imports report review queue counts for user-facing feedback')
  const mem0OnlySnapshot = await exportContextSnapshot()
  const portableMem0Memory = mem0OnlySnapshot.memories.find((memory) => memory.id === 'portable-mem0-memory')
  assert.equal(portableMem0Memory?.status, 'pending', 'mem0-only imports enter memory review instead of becoming active')
  assert.equal(portableMem0Memory?.sourceKind, 'imported', 'mem0-only imports are marked as imported memories')
  assert.equal(portableMem0Memory?.sourceDetail, 'mem0:user_id=remote-user', 'mem0-only imports preserve entity scope evidence')
  const preApprovalHits = await searchMemories('Portable mem0 import', 10)
  assert.equal(preApprovalHits.some((hit) => hit.id === 'portable-mem0-memory'), false, 'mem0-only imports stay out of default retrieval while pending review')
  const pendingReviewHits = await searchMemories('Portable mem0 import', 10, ['pending', 'active'])
  assert.equal(pendingReviewHits.some((hit) => hit.id === 'portable-mem0-memory'), true, 'memory review can include pending mem0 imports for inspection')
  assert.ok(
    pendingReviewHits.find((hit) => hit.id === 'portable-mem0-memory')?.sourceReason?.includes('source=imported'),
    'pending mem0 review hits expose imported provenance before approval'
  )
  await updateMemoryStatus('portable-mem0-memory', 'active')
  const postApprovalHits = await searchMemories('Portable mem0 import', 10)
  assert.equal(postApprovalHits.some((hit) => hit.id === 'portable-mem0-memory'), true, 'confirming a mem0 import promotes it into default chat memory retrieval')
  assert.ok(
    postApprovalHits.find((hit) => hit.id === 'portable-mem0-memory')?.sourceReason?.includes('mem0:user_id=remote-user'),
    'approved mem0 retrieval hits keep source scope evidence'
  )
  const rawMem0ResultsOk = await importAllData(JSON.stringify({
    results: [{
      id: 'raw-mem0-result',
      text: 'Raw mem0 API results can also be reviewed.',
      app_id: 'mem0-app',
    }],
  }))
  assert.equal(rawMem0ResultsOk, true, 'portable import accepts raw mem0 results JSON')
  const rawMem0Snapshot = await exportContextSnapshot()
  assert.equal(rawMem0Snapshot.memories.find((memory) => memory.id === 'raw-mem0-result')?.status, 'pending', 'raw mem0 results default to pending review')
  await importContextSnapshot({
    memories: [{
      id: 'local-confirmed-memory',
      content: 'Duplicate external memory should stay unique.',
      status: 'active',
      sourceKind: 'deterministic',
      sourceDetail: 'local-confirmed',
      confidence: 0.82,
      createdAt: 1000,
      updatedAt: 1000,
    }],
  })
  const duplicateExternalImport = await importAllDataDetailed(JSON.stringify({
    results: [{
      id: 'remote-duplicate-memory',
      text: 'Duplicate external memory should stay unique.',
      user_id: 'remote-user',
      metadata: { confidence: 0.91 },
    }],
  }))
  assert.deepEqual(duplicateExternalImport, { ok: true, kind: 'mem0', memories: 1 }, 'duplicate mem0 imports still report a valid import attempt')
  const duplicateExternalSnapshot = await exportContextSnapshot()
  const mergedExternalMemories = duplicateExternalSnapshot.memories.filter((memory) => memory.content === 'Duplicate external memory should stay unique.')
  assert.equal(mergedExternalMemories.length, 1, 'external memory imports merge duplicate content instead of adding another review row')
  assert.equal(mergedExternalMemories[0].id, 'local-confirmed-memory', 'duplicate external memories keep the existing local memory id')
  assert.equal(mergedExternalMemories[0].status, 'active', 'duplicate external memories do not downgrade an approved local memory')
  assert.equal(mergedExternalMemories[0].sourceKind, 'deterministic', 'duplicate external memories keep stronger local provenance')
  assert.equal(mergedExternalMemories[0].confidence, 0.91, 'duplicate external memories retain the strongest confidence')
  assert.ok(mergedExternalMemories[0].sourceDetail?.includes('local-confirmed'), 'duplicate external memories keep local source detail')
  assert.ok(mergedExternalMemories[0].sourceDetail?.includes('mem0:user_id=remote-user'), 'duplicate external memories append mem0 scope detail')
  await importContextSnapshot({ memories: [] })
  const repeatedMem0ImportOk = await importAllData(JSON.stringify({
    results: [
      {
        id: 'repeated-mem0-a',
        text: 'Repeated mem0 memory enters review once.',
        user_id: 'remote-user',
        metadata: { confidence: 0.7 },
      },
      {
        id: 'repeated-mem0-b',
        text: 'Repeated mem0 memory enters review once.',
        user_id: 'remote-user',
        metadata: { confidence: 0.9 },
      },
    ],
  }))
  assert.equal(repeatedMem0ImportOk, true, 'repeated mem0 results remain importable')
  const repeatedMem0Snapshot = await exportContextSnapshot()
  const repeatedMem0Memories = repeatedMem0Snapshot.memories.filter((memory) => memory.content === 'Repeated mem0 memory enters review once.')
  assert.equal(repeatedMem0Memories.length, 1, 'repeated mem0 records are deduplicated before entering review')
  assert.equal(repeatedMem0Memories[0].id, 'repeated-mem0-a', 'repeated mem0 imports keep the first imported id as the review identity')
  assert.equal(repeatedMem0Memories[0].status, 'pending', 'repeated mem0 imports still require review before retrieval')
  assert.equal(repeatedMem0Memories[0].confidence, 0.9, 'repeated mem0 imports keep the strongest duplicate confidence')
  const calls = []
  const synced = await runCredentialGroupModelSync(
    {
      ...normalized,
      credentialGroups: normalized.credentialGroups.slice(0, 2).map((group) => ({ ...group, [API_KEY_FIELD]: `key-${group.id}` })),
    },
    {
      delay: async (ms) => calls.push(`delay:${ms}`),
      jitter: () => 0,
      fetchModels: async (_provider, group) => {
        calls.push(`fetch:${group.id}`)
        return [{ id: `model-${group.id}`, name: `Model ${group.id}`, provider: 'openai-compatible' }]
      },
      now: () => 1000,
    }
  )
  assert.deepEqual(calls, [`fetch:${groups[0].id}`, 'delay:1200', `fetch:${groups[1].id}`])
  assert.equal(synced.models.length, 2)
  assert.equal(synced.credentialGroups[0].lastModelSyncStatus, 'ok')

  const failedSynced = await runCredentialGroupModelSync(
    {
      ...normalized,
      models: ['stale-default-model'],
      credentialGroups: normalized.credentialGroups.slice(0, 1).map((group) => ({ ...group, [API_KEY_FIELD]: `key-${group.id}` })),
    },
    {
      delay: async () => undefined,
      fetchModels: async () => {
        throw new Error('model endpoint failed')
      },
      now: () => 2000,
    }
  )
  assert.deepEqual(failedSynced.models, ['stale-default-model'], 'failed credential sync keeps existing model catalog without marking it usable')
  assert.equal(failedSynced.credentialGroups[0].lastModelSyncStatus, 'bad')
  assert.deepEqual(getProviderAvailableModels(failedSynced), [], 'failed credential sync does not expose stale models as account-available')
  const formatted500 = formatProviderHttpErrorForTest(
    500,
    JSON.stringify({ error: { type: 'upstream_error', message: 'No auth credentials found', request_id: 'req_123' } }),
    { id: 'p', type: 'openai-compatible', name: 'Example API', [API_KEY_FIELD]: 'token-test-fake', models: ['model-a'], enabled: true },
    'model-a'
  )
  assert.ok(formatted500.includes('HTTP 500') || formatted500.includes('500'), 'formatted provider errors keep HTTP status')
  assert.ok(formatted500.includes('upstream_error'), 'formatted provider errors keep error type')
  assert.ok(formatted500.includes('req_123'), 'formatted provider errors keep request id')
  assert.equal(formatted500.includes('{\"error\"'), false, 'formatted provider errors do not expose raw JSON')
  const activationSummary = summarizeProviderActivation([
    { providerId: 'ok', providerName: 'OK', enabled: true, hadCredential: true, synced: true, syncAttempted: true, modelCount: 2, syncedGroups: 1, missingToken: false, tested: true, testOk: true, messages: [], failures: [] },
    { providerId: 'models-only', providerName: 'Models Only', enabled: true, hadCredential: true, synced: true, syncAttempted: true, modelCount: 2, syncedGroups: 1, missingToken: false, tested: true, testOk: false, messages: ['test failed'], failures: [{ providerName: 'Models Only', message: 'test failed' }] },
    { providerId: 'none', providerName: 'No Models', enabled: true, hadCredential: true, synced: false, syncAttempted: true, modelCount: 0, syncedGroups: 0, missingToken: false, tested: false, testOk: false, messages: ['no models'], failures: [{ providerName: 'No Models', message: 'no models' }] },
  ])
  assert.ok(activationSummary.message.includes('目标 3') || activationSummary.message.includes('3 targeted'), 'activation summary includes target count')
  assert.ok(activationSummary.message.includes('测试通过 1') || activationSummary.message.includes('1 tests passed'), 'activation summary separates tested-ok count')
  assert.ok(activationSummary.message.includes('无模型 1') || activationSummary.message.includes('1 no models'), 'activation summary includes no-model count')
  assert.ok(
    st('providerSettings.activationProgressMessage', { completed: 2, total: 3, synced: 1, tested: 1, failed: 1 }).includes('2') &&
      st('providerSettings.activationCurrent', { name: 'Example' }).includes('Example'),
    'activation progress copy is structured for live batch status'
  )
  const activationPolicyProvider = {
    id: 'policy-activation',
    type: 'openai',
    name: 'Policy Activation',
    apiKey: FAKE_KEY_A,
    models: ['blocked-chat', 'gpt-5.5-mini'],
    manualModels: ['manual-chat'],
    modelAliases: [{ alias: 'fast', model: 'gpt-5.5-mini' }],
    enabled: true,
    credentialGroups: [
      { id: 'policy-group', label: 'Policy Group', apiKey: FAKE_KEY_B, enabled: true, lastModelSyncStatus: 'ok', availableModels: ['blocked-chat', 'gpt-5.5-mini', 'fast'] },
    ],
  }
  assert.deepEqual(
    buildProviderActivationTestCandidatesForTest(activationPolicyProvider, undefined, { modelAllowlist: ['gpt-*'], modelBlocklist: ['blocked-*'] }).map((candidate) => candidate.model),
    ['gpt-5.5-mini'],
    'provider activation auto-tests only one allowed model per credential group'
  )
  const activationManyModelProvider = {
    ...activationPolicyProvider,
    models: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-4o'],
    credentialGroups: [
      { id: 'group-a', label: 'Group A', apiKey: FAKE_KEY_A, enabled: true, lastModelSyncStatus: 'ok', availableModels: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-4o'] },
      { id: 'group-b', label: 'Group B', apiKey: FAKE_KEY_B, enabled: true, lastModelSyncStatus: 'ok', availableModels: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-4o'] },
    ],
  }
  const manyModelActivationCandidates = buildProviderActivationTestCandidatesForTest(activationManyModelProvider)
  assert.equal(manyModelActivationCandidates.length, 2, 'provider activation does not test every synced model during automatic activation')
  assert.deepEqual(
    manyModelActivationCandidates.map((candidate) => candidate.groupId),
    ['group-a', 'group-b'],
    'provider activation keeps automatic testing bounded to one candidate per credential group'
  )
  const mimoActivationCandidates = buildProviderActivationTestCandidatesForTest({
    id: 'mimo-activation',
    type: 'xiaomi-mimo',
    name: 'MiMo Activation',
    apiKey: FAKE_KEY_A,
    models: ['mimo-v2.5-asr', 'mimo-v2.5-tts', 'mimo-v2.5-pro'],
    modelConfigs: ['mimo-v2.5-asr', 'mimo-v2.5-tts', 'mimo-v2.5-pro'].map((id) => getModelConfig(id, 'xiaomi-mimo')),
    enabled: true,
    credentialGroups: [{
      id: 'mimo-group',
      label: 'MiMo Group',
      apiKey: FAKE_KEY_A,
      enabled: true,
      lastModelSyncStatus: 'ok',
      availableModels: ['mimo-v2.5-asr', 'mimo-v2.5-tts', 'mimo-v2.5-pro'],
    }],
  })
  assert.deepEqual(
    mimoActivationCandidates.map((candidate) => candidate.model),
    ['mimo-v2.5-pro'],
    'provider activation skips MiMo ASR/TTS models during automatic health checks'
  )
  const originalFetchForActivationRateLimit = global.fetch
  let rateLimitedActivationProvider = {
    ...activationManyModelProvider,
    id: 'activation-rate-limited',
    name: 'Activation Rate Limited',
    syncPolicy: { minDelayMs: 0, maxDelayMs: 0, timeoutMs: 18000, strategy: 'sequential-low-rate' },
  }
  let activationHealthCheckCalls = 0
  try {
    global.fetch = async (_url, init = {}) => {
      if ((init.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({
          data: [
            { id: 'gpt-5.5-mini' },
            { id: 'gpt-4o' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      activationHealthCheckCalls += 1
      return new Response('rate limit', { status: 429 })
    }
    const rateLimitedActivation = await syncAndTestProvider(rateLimitedActivationProvider, {
      updateProvider: async (_id, updates) => {
        rateLimitedActivationProvider = { ...rateLimitedActivationProvider, ...updates }
      },
      hydrateProviderKey: async () => rateLimitedActivationProvider,
      updateProviderCredentialGroupHealth: async (_providerId, groupId, ok) => {
        rateLimitedActivationProvider = {
          ...rateLimitedActivationProvider,
          credentialGroups: rateLimitedActivationProvider.credentialGroups?.map((group) =>
            group.id === groupId ? { ...group, lastTestStatus: ok ? 'ok' : 'bad' } : group
          ),
        }
      },
      delay: async () => undefined,
    }, { enable: true, checkParameters: false })
    assert.equal(activationHealthCheckCalls, 1, 'provider activation stops health checks after the first rate-limited model test')
    assert.equal(rateLimitedActivation.testOk, false, 'rate-limited activation does not report a successful test')
    assert.equal(rateLimitedActivation.failures[0]?.code, 'rate_limited', 'rate-limited activation records the provider error code')
  } finally {
    global.fetch = originalFetchForActivationRateLimit
  }
  assert.deepEqual(
    buildProviderActivationTestCandidatesForTest(activationPolicyProvider, 'fast', { modelAllowlist: ['gpt-*'] }).map((candidate) => candidate.model),
    ['fast'],
    'provider activation honors an explicit alias test model when its upstream model is allowed'
  )
  assert.equal(
    buildProviderActivationTestCandidatesForTest(activationPolicyProvider, 'blocked-chat', { modelBlocklist: ['blocked-*'] }).some((candidate) => candidate.model === 'blocked-chat'),
    false,
    'provider activation does not test an explicitly blocked requested model'
  )
  await assertProviderStoreLifecycleBehavior()

  const importedDataOk = await importAllData(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [
      {
        id: 'legacy-deepseek',
        type: 'openai-compatible',
        name: 'Legacy DeepSeek',
        enabled: false,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
      },
      {
        id: 'remote-placeholder',
        type: 'openai-compatible',
        name: 'Remote Placeholder',
        enabled: false,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        lastModelSyncStatus: 'ok',
      },
      {
        id: 'real-deepseek',
        type: 'openai-compatible',
        presetId: 'deepseek',
        name: 'DeepSeek',
        enabled: false,
        models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
        lastModelSyncStatus: 'ok',
      },
    ],
    exportedAt: Date.now(),
  }))
  assert.equal(importedDataOk, true, 'imports portable data for model normalization')
  const storedProviders = await loadData('PROVIDERS')
  assert.deepEqual(storedProviders[0].models, [], 'historical injected DeepSeek models are cleared without sync evidence')
  assert.deepEqual(storedProviders[1].models, [], 'synced placeholders are cleared for non-DeepSeek providers')
  assert.deepEqual(storedProviders[2].models, ['deepseek-v4-pro', 'deepseek-v4-flash'], 'real DeepSeek model lists are preserved')
  const importedDataResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(importedDataResult, { ok: true, kind: 'islemind', conversations: 0 }, 'detailed IsleMind imports report full-restore semantics for user-facing feedback')

  const packed = packChatMessages({
    messages: Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index} ${'long text '.repeat(120)}`,
    })),
    contextPrompt: 'retrieved context',
    modelContextWindow: 1200,
    maxOutputTokens: 256,
  })
  assert.ok(packed.messages.length < 18, 'packs long histories into a sliding window')
  assert.ok(packed.trimmedCount > 0, 'reports the number of trimmed messages')
  assert.ok(packed.contextPrompt.includes('历史摘要'), 'adds a deterministic summary for trimmed history')
  assert.ok(packed.contextPrompt.includes('近期旧消息'), 'local compression v2 labels preserved older recent turns')
  assert.ok(packed.estimatedInputTokens <= packed.budgetTokens, 'stays under the planned input budget')
  assert.ok(packed.budgetTokens < 1200, 'reserves output tokens from the input context budget')
  assert.equal(packed.compressionTriggered, true, 'compression trace exposes trigger state')
  assert.ok(packed.fixedTokens >= 0 && packed.modelBudgetTokens > 0 && packed.reservedOutputTokens >= 256, 'compression trace exposes full budget fields')
  assert.equal(packed.compressionMetadata.schemaVersion, 2, 'local compression metadata exposes the v2 schema version')
  assert.equal(packed.compressionMetadata.strategy, 'structured-v2', 'local compression v2 exposes its strategy')
  assert.equal(packed.compressionMetadata.triggerReason, 'message_budget_exceeded', 'local compression metadata reports the trigger reason')
  assert.equal(packed.compressionMetadata.sourceMessageCount, packed.trimmedCount, 'local compression metadata counts the summarized source messages')
  assert.equal(packed.compressionMetadata.keptMessageCount, packed.messages.length, 'local compression metadata counts retained request messages')
  assert.equal(
    packed.compressionMetadata.sourceRoleCounts.user + packed.compressionMetadata.sourceRoleCounts.assistant,
    packed.compressionMetadata.sourceMessageCount,
    'local compression metadata reports source role counts'
  )
  assert.equal(
    packed.compressionMetadata.keptRoleCounts.user + packed.compressionMetadata.keptRoleCounts.assistant,
    packed.compressionMetadata.keptMessageCount,
    'local compression metadata reports kept role counts'
  )
  assert.ok(packed.compressionMetadata.summarySectionCount > 0, 'local compression metadata counts structured sections')
  assert.ok(packed.compressionMetadata.summaryItemCount > 0, 'local compression metadata counts structured summary items')
  assert.ok(packed.compressionMetadata.summarySections.some((section) => section.id === 'recent' && section.itemCount > 0), 'local compression metadata exposes rendered section distribution')
  assert.ok(packed.compressionMetadata.sourceTokens > packed.compressionMetadata.compressedTokens, 'local compression metadata estimates token savings')
  assert.equal(
    packed.compressionMetadata.estimatedSavedTokens,
    packed.compressionMetadata.sourceTokens - packed.compressionMetadata.compressedTokens,
    'local compression metadata reports saved tokens from source and compressed estimates'
  )
  assert.ok(packed.compressionMetadata.compressionRatio > 0 && packed.compressionMetadata.compressionRatio < 1, 'local compression metadata reports an effectiveness ratio')
  assert.ok(packed.compressionMetadata.summaryTokens <= packed.compressionMetadata.summaryTokenBudget, 'local compression metadata reports a budgeted summary')
  const structuredPacked = packChatMessages({
    messages: [
      { role: 'user', content: `用户约束: 必须保持 TUN 模式开启，不要破坏 remote compact 探针。${'constraint detail '.repeat(60)}` },
      { role: 'assistant', content: `已确认决策: 采用 structured-v2 本地压缩，并保留 localCompression false 路径。${'decision detail '.repeat(60)}` },
      { role: 'user', content: `失败与风险: 上次验证出现 TS2322 风险，运行命令可能 timeout。${'risk detail '.repeat(60)}` },
      { role: 'assistant', content: `待办与下一步: 需要运行 bun run test:provider-intelligence 并检查 src/services/contextPacker.ts。${'action detail '.repeat(60)}` },
      { role: 'user', content: `重要引用: docs/agentic-workflow-roadmap.md scripts/provider-intelligence-tests.js G:\\Project\\IsleMind\\src\\services\\contextPacker.ts。${'reference detail '.repeat(45)}` },
      { role: 'assistant', content: `完成: 远程压缩仍由 provider capability 和 responsesApi 控制。${'remote compact detail '.repeat(60)}` },
      ...Array.from({ length: 8 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `recent retained message ${index} ${'recent detail '.repeat(70)}`,
      })),
    ],
    contextPrompt: 'retrieved context',
    modelContextWindow: 2600,
    maxOutputTokens: 256,
  })
  assert.equal(structuredPacked.compressionMetadata.strategy, 'structured-v2', 'structured local compression uses the v2 strategy')
  assert.equal(structuredPacked.compressionMetadata.schemaVersion, 2, 'structured local compression uses schema v2')
  assert.equal(structuredPacked.compressionMetadata.triggerReason, 'message_budget_exceeded', 'structured local compression records its budget trigger')
  for (const heading of ['用户约束', '已确认决策', '失败与风险', '待办与下一步', '重要引用']) {
    assert.ok(structuredPacked.contextPrompt.includes(heading), `structured local compression preserves ${heading}`)
  }
  assert.ok(structuredPacked.contextPrompt.includes('src/services/contextPacker.ts'), 'structured local compression extracts file references')
  assert.ok(structuredPacked.compressionMetadata.summarySectionCount >= 5, 'structured local compression records semantic section coverage')
  assert.ok(structuredPacked.compressionMetadata.summaryItemCount >= 5, 'structured local compression records semantic item coverage')
  const structuredSectionIds = structuredPacked.compressionMetadata.summarySections.map((section) => section.id)
  for (const sectionId of ['constraints', 'decisions', 'failures', 'actions', 'references']) {
    assert.ok(structuredSectionIds.includes(sectionId), `structured local compression reports ${sectionId} section metadata`)
  }
  assert.ok(structuredPacked.compressionMetadata.summarySections.every((section) => section.title && section.itemCount >= 0), 'structured local compression section metadata is display-safe')
  assert.ok(structuredPacked.compressionMetadata.sourceTokens > structuredPacked.compressionMetadata.compressedTokens, 'structured local compression quantifies summary savings')
  assert.ok(structuredPacked.compressionMetadata.estimatedSavedTokens > 0, 'structured local compression reports positive saved tokens')
  assert.ok(structuredPacked.compressionMetadata.compressionRatio > 0 && structuredPacked.compressionMetadata.compressionRatio < 1, 'structured local compression reports compression ratio below 1')
  assert.ok(structuredPacked.compressionMetadata.summaryTokens <= structuredPacked.compressionMetadata.summaryTokenBudget, 'structured local compression fits its summary budget')
  const remoteCompactProbe = packChatMessages({
    messages: Array.from({ length: 18 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `message ${index} ${'long text '.repeat(120)}`,
    })),
    contextPrompt: 'retrieved context',
    modelContextWindow: 1200,
    maxOutputTokens: 256,
    localCompression: false,
  })
  assert.equal(remoteCompactProbe.messages.length, 18, 'remote compact probes keep full local history before server-side compaction')
  assert.equal(remoteCompactProbe.trimmedCount, 0, 'remote compact probes do not consume the local trimming path')
  assert.equal(remoteCompactProbe.compressionTriggered, false, 'remote compact probes report local compression as inactive')
  assert.equal(remoteCompactProbe.compressionMetadata.strategy, 'none', 'remote compact probes report no local compression strategy')
  assert.equal(remoteCompactProbe.compressionMetadata.schemaVersion, 2, 'remote compact probes still expose the metadata schema version')
  assert.equal(remoteCompactProbe.compressionMetadata.triggerReason, 'disabled_or_unneeded', 'remote compact probes report local compression as disabled')
  assert.equal(remoteCompactProbe.compressionMetadata.sourceMessageCount, 0, 'remote compact probes report no local compression source messages')
  assert.equal(remoteCompactProbe.compressionMetadata.keptMessageCount, 0, 'remote compact probes report no retained local compression count')
  assert.deepEqual(remoteCompactProbe.compressionMetadata.sourceRoleCounts, { user: 0, assistant: 0 }, 'remote compact probes report empty source role counts')
  assert.deepEqual(remoteCompactProbe.compressionMetadata.keptRoleCounts, { user: 0, assistant: 0 }, 'remote compact probes report empty kept role counts')
  assert.equal(remoteCompactProbe.compressionMetadata.summarySectionCount, 0, 'remote compact probes report no local summary sections')
  assert.equal(remoteCompactProbe.compressionMetadata.summaryItemCount, 0, 'remote compact probes report no local summary items')
  assert.deepEqual(remoteCompactProbe.compressionMetadata.summarySections, [], 'remote compact probes report no local summary section distribution')
  assert.equal(remoteCompactProbe.compressionMetadata.sourceTokens, 0, 'remote compact probes report no local compression source token estimate')
  assert.equal(remoteCompactProbe.compressionMetadata.compressedTokens, 0, 'remote compact probes report no local compression output token estimate')
  assert.equal(remoteCompactProbe.compressionMetadata.estimatedSavedTokens, 0, 'remote compact probes report no local compression savings')
  assert.equal(remoteCompactProbe.compressionMetadata.compressionRatio, 0, 'remote compact probes report no local compression ratio')
  assert.equal(
    decideRemoteCompact({
      provider: governedProvider,
      model: 'gpt-5.2',
      messages: remoteCompactProbe.messages,
      contextPrompt: remoteCompactProbe.contextPrompt,
      budgetTokens: remoteCompactProbe.budgetTokens,
      estimatedInputTokens: remoteCompactProbe.estimatedInputTokens,
      settings: { remoteCompactMode: 'auto', remoteCompactThreshold: 0.8 },
    }).enabled,
    true,
    'remote compact decisions evaluate the untrimmed prompt before local fallback packing'
  )

  const singleLongPacked = packChatMessages({
    messages: [{ role: 'user', content: 'oversized '.repeat(1200) }],
    contextPrompt: 'retrieved context',
    modelContextWindow: 900,
    maxOutputTokens: 256,
  })
  assert.equal(singleLongPacked.messages.length, 1, 'keeps one recent oversized message after compression')
  assert.ok(singleLongPacked.messages[0].content.includes('前文过长'), 'truncates a single oversized message deterministically')
  assert.ok(singleLongPacked.estimatedInputTokens <= singleLongPacked.budgetTokens, 'single-message truncation stays within budget')
  assert.equal(singleLongPacked.truncatedSingleMessage, true, 'single-message truncation is reflected in trace metadata')
  assert.equal(singleLongPacked.compressionMetadata.strategy, 'single-message-truncation', 'single-message truncation is exposed as a local compression strategy')
  assert.equal(singleLongPacked.compressionMetadata.schemaVersion, 2, 'single-message truncation uses compression metadata schema v2')
  assert.equal(singleLongPacked.compressionMetadata.triggerReason, 'single_message_budget_exceeded', 'single-message truncation reports its trigger reason')
  assert.equal(singleLongPacked.compressionMetadata.sourceMessageCount, 0, 'single-message truncation does not report summarized source messages')
  assert.equal(singleLongPacked.compressionMetadata.keptMessageCount, 1, 'single-message truncation reports the retained message count')
  assert.deepEqual(singleLongPacked.compressionMetadata.summarySections, [], 'single-message truncation reports no structured summary sections')
  assert.ok(singleLongPacked.compressionMetadata.sourceTokens > singleLongPacked.compressionMetadata.compressedTokens, 'single-message truncation estimates token savings')
  assert.ok(singleLongPacked.compressionMetadata.estimatedSavedTokens > 0, 'single-message truncation reports saved tokens')
  assert.ok(singleLongPacked.compressionMetadata.compressionRatio > 0 && singleLongPacked.compressionMetadata.compressionRatio < 1, 'single-message truncation reports compression ratio below 1')
  const chatRunnerSource = fs.readFileSync(path.join(root, 'src/services/chatRunner.ts'), 'utf8')
  assert.ok(
    chatRunnerSource.includes('if (activePrompt.compressionTriggered)'),
    'chat runner emits context-pack trace metadata for every local compression strategy'
  )
  assert.ok(
    chatRunnerSource.includes('summarySections: activePrompt.compressionMetadata.summarySections'),
    'chat runner forwards local compression section distribution to trace metadata'
  )
  assert.ok(
    chatRunnerSource.includes('compressionSchemaVersion: activePrompt.compressionMetadata.schemaVersion'),
    'chat runner forwards local compression schema version to trace metadata'
  )
  assert.ok(
    chatRunnerSource.includes('compressionTriggerReason: activePrompt.compressionMetadata.triggerReason'),
    'chat runner forwards local compression trigger reason to trace metadata'
  )
  assert.ok(
    chatRunnerSource.includes('summaryKeptMessageCount: activePrompt.compressionMetadata.keptMessageCount'),
    'chat runner forwards retained message count to trace metadata'
  )
  assert.ok(
    chatRunnerSource.includes('compressionEstimatedSavedTokens: activePrompt.compressionMetadata.estimatedSavedTokens'),
    'chat runner forwards local compression savings estimate to trace metadata'
  )
  assert.ok(
    chatRunnerSource.includes('localEstimatedSavedTokens: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.estimatedSavedTokens : undefined'),
    'chat runner records local compression savings in compact usage diagnostics'
  )
  assert.ok(
    chatRunnerSource.includes('localCompressionStrategy: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.strategy : undefined'),
    'chat runner records local compression strategy in compact usage diagnostics'
  )
  assert.ok(
    chatRunnerSource.includes('localSummarySections: activePrompt.compressionTriggered ? activePrompt.compressionMetadata.summarySections : undefined'),
    'chat runner records local compression section metadata in compact usage diagnostics'
  )
  const highReasoningPacked = packChatMessages({
    messages: [{ role: 'user', content: 'reasoning budget '.repeat(500) }],
    modelContextWindow: 6000,
    maxOutputTokens: 1024,
    providerType: 'openai',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
  })
  assert.ok(highReasoningPacked.reasoningReserveTokens >= 4096, 'high reasoning reserves extra thinking room before packing history')
  const claudeMaxReasoningPacked = packChatMessages({
    messages: [{ role: 'user', content: 'claude reasoning budget '.repeat(500) }],
    modelContextWindow: 1000000,
    maxOutputTokens: 128000,
    providerType: 'anthropic',
    model: 'claude-fable-5',
    reasoningEffort: 'max',
  })
  assert.equal(claudeMaxReasoningPacked.reasoningReserveTokens, 8192, 'Claude max reasoning reserves the highest local thinking budget before packing history')
  const qwenHighReasoningPacked = packChatMessages({
    messages: [{ role: 'user', content: 'qwen reasoning budget '.repeat(500) }],
    modelContextWindow: 1000000,
    maxOutputTokens: 65536,
    providerType: 'openai-compatible',
    model: 'qwen3.7-max',
    reasoningEffort: 'high',
  })
  assert.equal(qwenHighReasoningPacked.reasoningReserveTokens, 262144, 'Qwen high reasoning reserves the official 256K thinking budget')
  assert.equal(qwenHighReasoningPacked.reservedOutputTokens, 327680, 'Qwen context packing reserves output plus thinking budget')

  const remoteConfig = mergeModelConfig('remote-large', 'openai-compatible', {
    contextWindow: 65536,
    maxOutputTokens: 4096,
    defaultMaxTokens: 12000,
    source: 'remote',
  })
  assert.equal(remoteConfig.contextWindow, 65536, 'remote context window is stored as context')
  assert.equal(remoteConfig.maxTokens, remoteConfig.contextWindow, 'maxTokens remains a legacy alias for context window')
  assert.equal(remoteConfig.maxOutputTokens, 4096, 'remote output limit is not replaced by context window')
  assert.equal(remoteConfig.defaultMaxTokens, 4096, 'default output tokens are clamped to maxOutputTokens')
  const inferredConfig = getModelConfig('unknown-compatible-model', 'openai-compatible')
  assert.ok(inferredConfig.defaultMaxTokens <= inferredConfig.maxOutputTokens, 'inferred model defaults fit output limit')
  assert.ok(DEFAULT_MODELS.every((model) => model.defaultMaxTokens <= model.maxOutputTokens && model.maxOutputTokens <= model.contextWindow), 'built-in model token limits are internally consistent')
  const mimoAnthropicBaseUrl = getXiaomiMimoOfficialBaseUrl('token-plan', 'cn', 'anthropic-compatible')
  assert.equal(mimoAnthropicBaseUrl, 'https://token-plan-cn.xiaomimimo.com/anthropic', 'MiMo Token Plan Anthropic preset matches the documented user-facing base URL')
  const mimoAnthropicProvider = {
    id: 'mimo-cn-anthropic',
    type: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    [API_KEY_FIELD]: 'tp-test-fake',
    baseUrl: mimoAnthropicBaseUrl,
    credentialMode: 'token-plan',
    tokenPlanRegion: 'cn',
    wireProtocol: 'anthropic-compatible',
    models: ['mimo-v2.5'],
    enabled: true,
    capabilities: { reasoningEffort: true },
  }
  assert.equal(getProviderConfigIssue(mimoAnthropicProvider, 'tp-test-fake'), null, 'MiMo Anthropic /anthropic base URL is accepted in settings validation')
  assert.equal(
    getAPIEndpointForTest(mimoAnthropicProvider),
    'https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages',
    'MiMo Anthropic chat requests add /v1/messages at runtime'
  )
  assert.equal(
    getAPIEndpointForTest({ ...mimoAnthropicProvider, baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic/v1' }),
    'https://token-plan-cn.xiaomimimo.com/anthropic/v1/messages',
    'legacy MiMo Anthropic /anthropic/v1 base URLs remain compatible'
  )
  assert.equal(
    getXiaomiMimoModelDiscoveryEndpointForTest(mimoAnthropicProvider),
    'https://token-plan-cn.xiaomimimo.com/v1/models',
    'MiMo Anthropic-compatible providers discover models from the OpenAI-compatible /v1/models endpoint'
  )
  const originalFetch = global.fetch
  const mimoDiscoveryCalls = []
  global.fetch = async (url, init) => {
    mimoDiscoveryCalls.push({ url: String(url), authorization: init?.headers?.Authorization })
    return {
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      text: async () => JSON.stringify({
        object: 'list',
        data: [
          { id: 'mimo-v2.5-pro', object: 'model', owned_by: 'xiaomi' },
          { id: 'mimo-v2.5-tts', object: 'model', owned_by: 'xiaomi' },
        ],
      }),
    }
  }
  try {
    const mimoDiscoveryResult = await fetchProviderModelConfigsDetailed(mimoAnthropicProvider, 'tp-test-fake')
    assert.equal(mimoDiscoveryResult.ok, true, 'MiMo Anthropic-compatible model sync succeeds through /v1/models')
    assert.deepEqual(mimoDiscoveryResult.data.map((model) => model.id), ['mimo-v2.5-pro', 'mimo-v2.5-tts'])
    assert.equal(mimoDiscoveryResult.data[0].contextWindow, getModelConfig('mimo-v2.5-pro', 'xiaomi-mimo').contextWindow, 'MiMo remote IDs inherit verified built-in context metadata')
    assert.equal(mimoDiscoveryResult.data[1].chatCompatible, false, 'MiMo TTS remote IDs remain non-chat models')
    assert.equal(mimoDiscoveryCalls.length, 1, 'MiMo Anthropic-compatible model sync makes one discovery request')
    assert.equal(mimoDiscoveryCalls[0].url, 'https://token-plan-cn.xiaomimimo.com/v1/models', 'MiMo discovery does not call unsupported /anthropic/models')
    assert.equal(mimoDiscoveryCalls[0].authorization, 'Bearer tp-test-fake', 'MiMo model discovery uses bearer auth')
  } finally {
    global.fetch = originalFetch
  }
  const xiaomiMimoModelIds = getProviderModels('xiaomi-mimo').map((model) => model.id)
  assert.deepEqual(xiaomiMimoModelIds, [
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'mimo-v2-pro',
    'mimo-v2-omni',
    'mimo-v2-flash',
    'mimo-v2.5-tts',
    'mimo-v2.5-tts-voiceclone',
    'mimo-v2.5-tts-voicedesign',
    'mimo-v2.5-asr',
    'mimo-v2-tts',
  ], 'MiMo built-in catalog includes every currently documented model')
  const unknownMimoConfig = getModelConfig('mimo-v3-unannounced', 'xiaomi-mimo')
  assert.equal(unknownMimoConfig.contextWindow, 32768, 'unknown MiMo models use a safe 32K budget until the provider returns metadata or the static catalog is updated')
  assert.equal(unknownMimoConfig.maxOutputTokens, 4096, 'unknown MiMo output limit stays conservative')
  assert.equal(unknownMimoConfig.supportsVision, false, 'unknown MiMo models do not inherit vision support by default')
  assert.equal(getModelConfig('mimo-v2.5-tts', 'xiaomi-mimo').chatCompatible, false, 'MiMo TTS models are cataloged but not chat-compatible')
  assert.equal(getModelConfig('mimo-v2.5-tts', 'xiaomi-mimo').maxOutputTokens, 8192, 'MiMo TTS models keep the official 8K max output metadata')
  assert.equal(getModelConfig('mimo-v2.5-asr', 'xiaomi-mimo').chatCompatible, false, 'MiMo ASR models are cataloged but not chat-compatible')
  assert.equal(getModelConfig('mimo-v2.5-asr', 'xiaomi-mimo').maxOutputTokens, 2048, 'MiMo ASR model keeps the official 2K max output metadata')
  assert.deepEqual(
    getReasoningEffortOptions(mimoAnthropicProvider, 'mimo-v2.5'),
    ['none', 'high'],
    'MiMo chat models expose the provider-supported thinking toggle'
  )
  assert.deepEqual(
    getReasoningEffortOptions(mimoAnthropicProvider, 'mimo-v2.5-tts'),
    [],
    'MiMo TTS models do not expose chat reasoning controls'
  )
  const mimoOpenAIReasoningBody = buildOpenAIBodyForTest({
    provider: { ...mimoAnthropicProvider, id: 'mimo-cn-openai', wireProtocol: 'openai-compatible', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
    model: 'mimo-v2.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 128,
    stream: false,
  })
  assert.deepEqual(mimoOpenAIReasoningBody.thinking, { type: 'enabled' }, 'MiMo OpenAI-compatible requests send the official thinking toggle')
  assert.equal(mimoOpenAIReasoningBody.reasoning, undefined, 'MiMo OpenAI-compatible requests avoid unsupported reasoning objects')
  assert.equal(mimoOpenAIReasoningBody.reasoning_effort, undefined, 'MiMo OpenAI-compatible requests avoid generic reasoning_effort')
  assert.equal(mimoOpenAIReasoningBody.temperature, undefined, 'MiMo thinking requests omit custom temperature')
  assert.equal(mimoOpenAIReasoningBody.top_p, undefined, 'MiMo thinking requests omit custom top_p')
  assert.equal(mimoOpenAIReasoningBody.max_completion_tokens, 128, 'MiMo OpenAI-compatible requests reserve enough output room for reasoning plus text')
  const mimoOpenAIReasoningConformance = resolveProviderRequestConformanceForTest({
    provider: { ...mimoAnthropicProvider, id: 'mimo-cn-openai', wireProtocol: 'openai-compatible', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
    model: 'mimo-v2.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 128,
  }, mimoOpenAIReasoningBody)
  assert.equal(mimoOpenAIReasoningConformance.manifest.reasoning.requestShape, 'xiaomi-mimo-thinking', 'provider conformance exposes MiMo thinking request shape')
  assert.equal(mimoOpenAIReasoningConformance.reasoning.enabled, true, 'provider conformance treats MiMo high as active thinking')
  assert.equal(mimoOpenAIReasoningConformance.reasoning.providerValue, 'enabled', 'provider conformance maps MiMo active thinking to the accepted provider value')
  const mimoOpenAIThinkingOffBody = buildOpenAIBodyForTest({
    provider: { ...mimoAnthropicProvider, id: 'mimo-cn-openai', wireProtocol: 'openai-compatible', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1' },
    model: 'mimo-v2.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    temperature: 0.4,
    topP: 0.8,
    maxTokens: 128,
    stream: false,
  })
  assert.deepEqual(mimoOpenAIThinkingOffBody.thinking, { type: 'disabled' }, 'MiMo none explicitly disables thinking instead of relying on provider defaults')
  assert.equal(mimoOpenAIThinkingOffBody.temperature, 0.4, 'MiMo disabled-thinking requests may customize temperature')
  assert.equal(mimoOpenAIThinkingOffBody.top_p, 0.8, 'MiMo disabled-thinking requests may customize top_p')
  const mimoAnthropicReasoningBody = buildAnthropicBodyForTest({
    provider: mimoAnthropicProvider,
    model: 'mimo-v2.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 128,
    stream: false,
  })
  assert.deepEqual(mimoAnthropicReasoningBody.thinking, { type: 'enabled' }, 'MiMo Anthropic-compatible requests send the official thinking toggle')
  assert.equal(mimoAnthropicReasoningBody.reasoning, undefined, 'MiMo Anthropic-compatible requests avoid unsupported reasoning objects')
  assert.equal(mimoAnthropicReasoningBody.output_config, undefined, 'MiMo Anthropic-compatible requests do not use Claude output_config thinking tiers')
  assert.equal(mimoAnthropicReasoningBody.max_tokens, 128, 'MiMo Anthropic-compatible tests reserve enough output room for reasoning plus text')
  assert.deepEqual(
    getProviderAvailableModels({
      ...mimoAnthropicProvider,
      models: ['mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-asr'],
      modelConfigs: ['mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-asr'].map((id) => getModelConfig(id, 'xiaomi-mimo')),
      credentialGroups: [{
        id: 'default',
        label: 'default',
        enabled: true,
        lastModelSyncStatus: 'ok',
        availableModels: ['mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone', 'mimo-v2.5-asr'],
      }],
    }),
    ['mimo-v2.5-pro'],
    'chat model availability excludes MiMo TTS and ASR models'
  )
  assert.equal(getModelConfig('gpt-5.5', 'openai').contextWindow, 1050000, 'GPT-5.5 context matches verified OpenAI docs')
  assert.equal(getModelConfig('gpt-5.5', 'openai').maxOutputTokens, 128000, 'GPT-5.5 output limit matches verified OpenAI docs')
  assert.equal(getModelConfig('gpt-5.5', 'openai').supportsTools, true, 'OpenAI current models expose native tool support')
  assert.equal(getModelConfig('gpt-5.5-pro', 'openai').supportsStreaming, false, 'GPT-5.5 Pro records official non-streaming support')
  assert.deepEqual(getModelConfig('gpt-5.5-pro', 'openai').reasoningEfforts, ['medium', 'high', 'xhigh'], 'GPT-5.5 Pro exposes source-backed reasoning tiers')
  const openAIStreamingProvider = {
    id: 'openai-streaming-provider',
    type: 'openai',
    name: 'OpenAI Streaming Provider',
    apiKey: FAKE_KEY_A,
    models: ['gpt-5.5-pro', 'gpt-5.5'],
    credentialGroups: [{ id: 'openai-a', label: 'A', apiKey: FAKE_KEY_A, enabled: true, availableModels: ['gpt-5.5-pro', 'gpt-5.5'] }],
    capabilities: { streaming: true },
    enabled: true,
  }
  const gpt55Manifest = resolveProviderCapabilityManifest({ provider: openAIStreamingProvider, model: 'gpt-5.5' })
  const gpt55ProManifest = resolveProviderCapabilityManifest({ provider: openAIStreamingProvider, model: 'gpt-5.5-pro' })
  assert.equal(gpt55Manifest.transport.streaming, true, 'provider manifest records model-level streaming support')
  assert.equal(gpt55Manifest.transport.preferredEndpoint, 'responses', 'provider manifest records the model preferred endpoint')
  assert.equal(gpt55ProManifest.transport.streaming, false, 'provider manifest disables streaming when the selected model is non-streaming')
  const gpt55ProRoute = resolveProviderRouteForTest(
    { provider: openAIStreamingProvider, model: 'gpt-5.5-pro', messages: [{ role: 'user', content: 'hello' }], stream: false },
    { model: 'gpt-5.5-pro', stream: false },
    { transport: 'http_sse' }
  )
  assert.equal(gpt55ProRoute.decision.transportPlan.streaming, false, 'route decision exposes model-level non-streaming transport support')
  assert.equal(gpt55ProRoute.decision.transportPlan.preferredEndpoint, 'responses', 'route decision exposes the preferred endpoint from model metadata')
  const streamingFallbackCandidates = buildProviderFallbackCandidates({
    providers: [openAIStreamingProvider],
    original: { providerId: 'origin', model: 'origin-model' },
    requiredCapabilities: ['streaming'],
  })
  assert.ok(streamingFallbackCandidates.candidates.some((item) => item.model === 'gpt-5.5'), 'streaming fallback candidates keep streaming-capable models')
  assert.ok(!streamingFallbackCandidates.candidates.some((item) => item.model === 'gpt-5.5-pro'), 'streaming fallback candidates exclude non-streaming models')
  assert.ok(
    streamingFallbackCandidates.rejectedCandidates.some((item) => item.model === 'gpt-5.5-pro' && item.reason === 'capability_mismatch'),
    'streaming fallback candidates record non-streaming model capability mismatch'
  )
  assert.equal(getModelConfig('gpt-5.4', 'openai').contextWindow, 1050000, 'GPT-5.4 context matches verified OpenAI docs')
  assert.equal(getModelConfig('gpt-5.4-pro', 'openai').contextWindow, 1050000, 'GPT-5.4 Pro context matches verified OpenAI docs')
  assert.deepEqual(getModelConfig('gpt-5.2-pro', 'openai').reasoningEfforts, ['medium', 'high', 'xhigh'], 'GPT-5.2 Pro only exposes source-backed supported effort tiers')
  assert.equal(getModelConfig('gpt-4.1', 'openai').contextWindow, 1047576, 'GPT-4.1 context remains exact')
  assert.equal(getModelConfig('gpt-4o', 'openai').maxOutputTokens, 16384, 'GPT-4o output limit remains exact')
  assert.equal(getModelConfig('gpt-4.1', 'openai').supportsTools, true, 'OpenAI legacy chat models expose native tool support')
  assert.equal(getModelConfig('deepseek-v4-pro', 'openai-compatible').contextWindow, 1000000, 'DeepSeek V4 Pro context is official 1M')
  assert.equal(getModelConfig('deepseek-v4-pro', 'openai-compatible').maxOutputTokens, 384000, 'DeepSeek V4 Pro output limit is official 384K')
  assert.deepEqual(getModelConfig('deepseek-v4-pro', 'openai-compatible').reasoningEfforts, ['none', 'high', 'xhigh'], 'DeepSeek V4 Pro exposes official high/max thinking efforts')
  assert.equal(getModelConfig('deepseek-chat', 'openai-compatible').reasoningMode, undefined, 'DeepSeek Chat alias remains the official non-thinking compatibility mode')
  assert.deepEqual(getModelConfig('deepseek-reasoner', 'openai-compatible').reasoningEfforts, ['high', 'xhigh'], 'DeepSeek Reasoner exposes only enabled official thinking efforts')
  assert.equal(getModelConfig('qwen3.7-max', 'openai-compatible').contextWindow, 1000000, 'Qwen3.7 Max context uses official DashScope model metadata')
  assert.equal(getModelConfig('qwen3.7-max', 'openai-compatible').maxOutputTokens, 65536, 'Qwen3.7 Max output limit uses official DashScope model metadata')
  assert.equal(getModelConfig('qwen3.6-plus', 'openai-compatible').contextWindow, 1000000, 'Qwen3.6 Plus context uses official DashScope model metadata')
  assert.equal(getModelConfig('qwen3.6-plus', 'openai-compatible').maxOutputTokens, 65536, 'Qwen3.6 Plus output limit uses official DashScope model metadata')
  assert.equal(getModelConfig('qwen3.5-flash', 'openai-compatible').contextWindow, 1000000, 'Qwen3.5 Flash context uses official DashScope model metadata')
  assert.deepEqual(getModelConfig('qwen3.5-plus', 'openai-compatible').reasoningEfforts, ['none', 'low', 'medium', 'high'], 'Qwen3.5 models expose DashScope thinking levels')
  assert.equal(getModelConfig('kimi-k2.6', 'openai-compatible').contextWindow, 262144, 'Kimi K2.6 context uses official Moonshot model metadata')
  assert.equal(getModelConfig('kimi-k2.6', 'openai-compatible').maxOutputTokens, 32768, 'Kimi K2.6 output limit follows the official 32K max_tokens guidance')
  assert.equal(getModelConfig('kimi-k2.6', 'openai-compatible').defaultMaxTokens, 32768, 'Kimi K2.6 default output budget follows the official thinking-model guidance')
  assert.equal(getModelConfig('kimi-k2.6', 'openai-compatible').supportsVision, true, 'Kimi K2.6 exposes official visual input support')
  assert.equal(getModelConfig('kimi-k2.5', 'openai-compatible').contextWindow, 262144, 'Kimi K2.5 context uses official Moonshot model metadata')
  assert.equal(getModelConfig('kimi-k2.5', 'openai-compatible').maxOutputTokens, 32768, 'Kimi K2.5 output limit follows the official 32K max_tokens guidance')
  assert.deepEqual(getModelConfig('kimi-k2.5', 'openai-compatible').reasoningEfforts, ['none', 'high'], 'Kimi K2.5 exposes the provider-supported thinking toggle')
  assert.equal(getModelConfig('kimi-k2.5', 'openai-compatible').supportsVision, true, 'Kimi K2.5 exposes official visual input support')
  assert.equal(getModelConfig('kimi-k2-turbo-preview', 'openai-compatible').deprecated, true, 'Kimi K2 Turbo Preview is retained only as a discontinued compatibility entry')
  assert.equal(getModelConfig('moonshot-v1-128k', 'openai-compatible').maxOutputTokens, 65536, 'Moonshot V1 128K output limit uses official Moonshot model metadata')
  assert.equal(getModelConfig('glm-5.1', 'openai-compatible').contextWindow, 200000, 'GLM-5.1 context uses official BigModel metadata')
  assert.equal(getModelConfig('glm-5.1', 'openai-compatible').maxOutputTokens, 128000, 'GLM-5.1 output limit uses official BigModel metadata')
  assert.equal(getModelConfig('MiniMax-M3', 'openai-compatible').contextWindow, 1000000, 'MiniMax M3 context uses official MiniMax metadata')
  assert.equal(getModelConfig('MiniMax-M3', 'openai-compatible').maxOutputTokens, 524288, 'MiniMax M3 output limit uses official MiniMax metadata')
  assert.equal(getModelConfig('MiniMax-M3', 'openai-compatible').defaultMaxTokens, 131072, 'MiniMax M3 default output budget follows the official recommendation')
  assert.equal(getModelConfig('MiniMax-M3', 'openai-compatible').supportsVision, true, 'MiniMax M3 exposes official image input support')
  assert.equal(getModelConfig('MiniMax-M2.7', 'openai-compatible').contextWindow, 1000000, 'MiniMax M2.7 context uses official MiniMax metadata')
  assert.equal(getModelConfig('MiniMax-M2.7', 'openai-compatible').maxOutputTokens, 204800, 'MiniMax M2.7 output limit uses official MiniMax metadata')
  assert.equal(getModelConfig('MiniMax-M2.7', 'openai-compatible').defaultMaxTokens, 65536, 'MiniMax M2.7 default output budget follows the official recommendation')
  assert.equal(getModelConfig('MiniMax-M2.5', 'openai-compatible').contextWindow, 204800, 'MiniMax M2.5 context uses official 204800-token metadata')
  assert.equal(getModelConfig('grok-4.3', 'openai-compatible').contextWindow, 1000000, 'Grok 4.3 context uses official xAI model metadata')
  assert.equal(getModelConfig('grok-4.3', 'openai-compatible').maxOutputTokens, 1000000, 'Grok 4.3 visible output budget can use the official context ceiling through max_completion_tokens')
  assert.equal(getModelConfig('grok-4.3', 'openai-compatible').preferredEndpoint, 'responses', 'Grok 4.3 records xAI Responses as the official preferred endpoint')
  assert.deepEqual(getModelConfig('grok-4.20', 'openai-compatible').reasoningEfforts, ['none', 'low', 'medium', 'high'], 'Grok 4.20 exposes xAI reasoning efforts')
  assert.deepEqual(getModelConfig('grok-4.20-multi-agent', 'openai-compatible').reasoningEfforts, ['low', 'medium', 'high', 'xhigh'], 'Grok 4.20 Multi-Agent exposes official xhigh effort')
  assert.equal(getModelConfig('grok-4.20-non-reasoning', 'openai-compatible').reasoningMode, undefined, 'Grok 4.20 non-reasoning model does not expose reasoning controls')
  assert.equal(getModelConfig('grok-build-0.1', 'openai-compatible').contextWindow, 256000, 'Grok Build context uses official xAI model metadata')
  assert.equal(getModelConfig('grok-4.1', 'openai-compatible').deprecated, true, 'Grok 4.1 shorthand is treated as a compatibility entry, not a current xAI API model')
  assert.equal(getModelConfig('grok-4', 'openai-compatible').deprecated, true, 'Grok 4 legacy entry is treated as retired/redirected to Grok 4.3')
  assert.equal(getModelConfig('claude-fable-5', 'anthropic').contextWindow, 1000000, 'Claude Fable 5 context uses official current model overview')
  assert.equal(getModelConfig('claude-fable-5', 'anthropic').maxOutputTokens, 128000, 'Claude Fable 5 output limit uses official current model overview')
  assert.deepEqual(getModelConfig('claude-fable-5', 'anthropic').reasoningEfforts, ['low', 'medium', 'high', 'xhigh', 'max'], 'Claude Fable 5 exposes official always-on adaptive effort tiers')
  assert.equal(getModelConfig('claude-mythos-5', 'anthropic').contextWindow, 1000000, 'Claude Mythos 5 context uses official current model overview')
  assert.equal(getModelConfig('claude-mythos-5', 'anthropic').maxOutputTokens, 128000, 'Claude Mythos 5 output limit uses official current model overview')
  assert.equal(getModelConfig('claude-fable-5-20260602', 'anthropic').deprecated, true, 'Claude Fable dated draft id is treated as a compatibility entry')
  assert.equal(getModelConfig('claude-opus-4-8', 'anthropic').contextWindow, 1000000, 'Claude Opus 4.8 context uses official current model overview')
  assert.deepEqual(getModelConfig('claude-opus-4-8', 'anthropic').reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'Claude Opus 4.8 exposes official output_config effort tiers')
  assert.equal(getModelConfig('claude-opus-4-7', 'anthropic').contextWindow, 1000000, 'Claude Opus 4.7 context uses official current model overview')
  assert.equal(getModelConfig('claude-sonnet-4-6', 'anthropic').maxOutputTokens, 64000, 'Claude Sonnet 4.6 output limit uses official current model overview')
  assert.equal(getModelConfig('claude-opus-4-8', 'anthropic').supportsTools, true, 'Claude current models expose native tool support')
  assert.equal(getModelConfig('gemini-3.5-flash', 'google').deprecated, false, 'Gemini 3.5 Flash is cataloged as a current default-capable model')
  assert.deepEqual(getModelConfig('gemini-3.5-flash', 'google').reasoningEfforts, ['minimal', 'low', 'medium', 'high'], 'Gemini 3.5 Flash exposes official thinking levels')
  assert.equal(getModelConfig('gemini-3.5-flash', 'google').supportsTools, true, 'Gemini current models expose native tool support')
  assert.equal(getModelConfig('gemini-3-pro-preview', 'google').deprecated, true, 'Gemini 3 Pro Preview is not recommended as a default')
  assert.equal(getModelConfig('mimo-v2-pro', 'xiaomi-mimo').deprecated, true, 'MiMo V2 Pro is marked deprecated during the official retirement window')
  assert.equal(getModelConfig('mimo-v2-omni', 'xiaomi-mimo').deprecated, true, 'MiMo V2 Omni is marked deprecated during the official retirement window')
  const qwenProvider = { id: 'dashscope', type: 'openai-compatible', presetId: 'dashscope', name: 'DashScope', models: ['qwen3.7-max', 'qwen3.6-flash', 'qwen3.6-plus', 'qwen3.5-flash'], enabled: true }
  const deepSeekProvider = { id: 'deepseek', type: 'openai-compatible', presetId: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-pro'], enabled: true }
  const kimiProvider = { id: 'moonshot', type: 'openai-compatible', presetId: 'moonshot', name: 'Moonshot', models: ['kimi-k2.6', 'kimi-k2.5'], enabled: true }
  const minimaxProvider = { id: 'minimax', type: 'openai-compatible', presetId: 'minimax', name: 'MiniMax', models: ['MiniMax-M3'], enabled: true }
  const grokProvider = { id: 'xai', type: 'openai-compatible', presetId: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', models: ['grok-4.3', 'grok-4.20', 'grok-4.20-multi-agent', 'grok-4.20-non-reasoning'], enabled: true }
  assert.equal(getModelConfig('qwen3.7-max', 'openai-compatible').supportsTools, true, 'Qwen models expose native tool support')
  assert.equal(getModelConfig('kimi-k2.6', 'openai-compatible').supportsTools, true, 'Kimi models expose native tool support')
  assert.equal(getModelConfig('MiniMax-M3', 'openai-compatible').supportsTools, true, 'MiniMax models expose native tool support')
  assert.equal(getModelConfig('grok-4.3', 'openai-compatible').supportsTools, true, 'Grok models expose native tool support')
  assert.deepEqual(getReasoningEffortOptions(deepSeekProvider, 'deepseek-v4-pro'), ['none', 'high', 'xhigh'], 'DeepSeek thinking models expose only source-backed effort levels')
  assert.deepEqual(getReasoningEffortOptions(deepSeekProvider, 'deepseek-chat'), [], 'DeepSeek Chat compatibility alias does not expose thinking controls')
  assert.deepEqual(getReasoningEffortOptions(qwenProvider, 'qwen3.7-max'), ['none', 'low', 'medium', 'high'], 'Qwen thinking models expose DashScope thinking levels')
  assert.deepEqual(getReasoningEffortOptions(qwenProvider, 'qwen3.5-flash'), ['none', 'low', 'medium', 'high'], 'Qwen3.5 thinking models expose DashScope thinking levels')
  assert.deepEqual(getReasoningEffortOptions(kimiProvider, 'kimi-k2.6'), ['none', 'high'], 'Kimi thinking models expose the provider-supported thinking toggle')
  assert.deepEqual(getReasoningEffortOptions(kimiProvider, 'kimi-k2.5'), ['none', 'high'], 'Kimi K2.5 exposes the provider-supported thinking toggle')
  assert.deepEqual(getReasoningEffortOptions(grokProvider, 'grok-4.3'), ['none', 'low', 'medium', 'high'], 'Grok reasoning models expose xAI effort levels')
  assert.deepEqual(getReasoningEffortOptions(grokProvider, 'grok-4.20'), ['none', 'low', 'medium', 'high'], 'Grok 4.20 reasoning model exposes xAI effort levels')
  assert.deepEqual(getReasoningEffortOptions(grokProvider, 'grok-4.20-multi-agent'), ['low', 'medium', 'high', 'xhigh'], 'Grok 4.20 Multi-Agent exposes xAI xhigh effort')
  assert.deepEqual(getReasoningEffortOptions(grokProvider, 'grok-4.20-non-reasoning'), [], 'Grok 4.20 non-reasoning model does not expose reasoning controls')
  assert.deepEqual(getReasoningEffortOptions(grokProvider, 'grok-4'), [], 'Grok legacy compatibility entries do not expose xAI reasoning_effort controls')
  assert.deepEqual(getReasoningEffortOptions(minimaxProvider, 'MiniMax-M3'), ['none', 'high'], 'MiniMax M3 exposes the provider-supported thinking toggle')
  assert.deepEqual(
    getReasoningEffortOptions({ id: 'anthropic-current', type: 'anthropic', name: 'Anthropic', models: ['claude-fable-5'], enabled: true }, 'claude-fable-5'),
    ['low', 'medium', 'high', 'xhigh', 'max'],
    'Claude Fable 5 exposes always-on adaptive effort controls without a disable option'
  )
  assert.equal(resolveAgentProviderToolTarget('openai-compatible', { assumeOpenAICompatibleTools: true }), 'openai-chat', 'source-backed compatible providers can declare OpenAI-format tools')
  assert.equal(resolveAgentProviderToolTarget('openai-compatible', { assumeOpenAICompatibleTools: true, preferredEndpoint: 'responses' }), 'openai-responses', 'xAI Responses-compatible providers declare Responses-format tools')
  assert.equal(resolveAgentProviderToolTarget('xiaomi-mimo', { wireProtocol: 'anthropic-compatible' }), 'anthropic', 'MiMo Anthropic-compatible endpoints declare Anthropic-format tools')
  assert.deepEqual(
    getReasoningEffortOptions({ id: 'google', type: 'google', name: 'Google', models: ['gemini-3.5-flash'], enabled: true }, 'gemini-3.5-flash'),
    ['minimal', 'low', 'medium', 'high'],
    'Gemini 3.5 Flash exposes thinking levels through Google provider metadata'
  )
  const googlePrefixedModelProvider = {
    id: 'google-prefixed-models',
    type: 'google',
    name: 'Google Prefixed Models',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    [API_KEY_FIELD]: FAKE_KEY_A,
    models: ['models/gemini-3.5-flash'],
    modelConfigs: [{ ...getModelConfig('gemini-3.5-flash', 'google'), id: 'models/gemini-3.5-flash', source: 'remote' }],
    enabled: true,
  }
  assert.deepEqual(
    getReasoningEffortOptions(googlePrefixedModelProvider, 'models/gemini-3.5-flash'),
    ['minimal', 'low', 'medium', 'high'],
    'Gemini official models/ resource names still expose thinking levels'
  )
  assert.equal(providerSupportsReasoning(googlePrefixedModelProvider, 'models/gemini-3.5-flash'), true, 'Gemini official models/ resource names keep quick reasoning enabled')
  assert.equal(
    resolveProviderEndpoint({ provider: googlePrefixedModelProvider, model: 'models/gemini-3.5-flash', stream: true }),
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${FAKE_KEY_A}`,
    'Gemini official models/ resource names do not duplicate the models path in streaming requests'
  )
  const openAIResponsesBody = buildOpenAIResponsesBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5.5'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'xhigh',
    maxTokens: 999999,
  })
  assert.equal(openAIResponsesBody.reasoning.effort, 'xhigh', 'OpenAI Responses uses official reasoning.effort values including xhigh')
  assert.equal(openAIResponsesBody.reasoning.summary, 'auto', 'OpenAI Responses requests official reasoning summaries')
  assert.deepEqual(openAIResponsesBody.include, ['reasoning.encrypted_content'], 'OpenAI Responses reasoning requests ask for encrypted reasoning replay items')
  assert.ok(openAIResponsesBody.max_output_tokens <= getModelConfig('gpt-5.5', 'openai').maxOutputTokens, 'Responses output tokens are clamped')
  const openAINoReasoningSummaryBody = buildOpenAIResponsesBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5.5'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 4096,
  })
  assert.equal(openAINoReasoningSummaryBody.reasoning, undefined, 'OpenAI Responses omits reasoning summaries when no reasoning object is sent')
  const openAIMinimalResponsesBody = buildOpenAIResponsesBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  })
  assert.equal(openAIMinimalResponsesBody.reasoning.effort, 'minimal', 'OpenAI GPT-5 Responses preserves official minimal reasoning effort')
  const openAIMinimalConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'gpt-5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  }, openAIMinimalResponsesBody)
  assert.equal(openAIMinimalConformance.reasoning.enabled, true, 'provider conformance treats OpenAI minimal as active reasoning')
  assert.equal(openAIMinimalConformance.reasoning.providerValue, 'minimal', 'provider conformance preserves OpenAI minimal provider value')
  assert.equal(openAIMinimalConformance.manifest.payload.reasoningSummaryField, 'reasoning.summary', 'provider conformance records OpenAI Responses reasoning summary field')
  const openAIChatBodyWithTools = buildOpenAIBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-4.1'],
      enabled: true,
    },
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: 'hello' }],
    providerToolDeclarations: [{
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search readable web sources.',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    }],
  })
  assert.equal(openAIChatBodyWithTools.tools[0].type, 'function', 'OpenAI Chat carries native provider tool declarations')
  assert.equal(openAIChatBodyWithTools.tools[0].function.name, 'search_web', 'OpenAI Chat preserves provider function name')
  const openAIResponsesBodyWithTools = buildOpenAIResponsesBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5.5'],
      enabled: true,
    },
    model: 'gpt-5.5',
    messages: [{ role: 'user', content: 'hello' }],
    webSearchMode: 'native',
    providerToolDeclarations: [{
      type: 'function',
      name: 'inspect_source',
      description: 'Inspect a cited source.',
      parameters: { type: 'object', properties: { sourceId: { type: 'string' } } },
    }],
  })
  assert.equal(openAIResponsesBodyWithTools.tools[0].type, 'web_search_preview', 'OpenAI Responses keeps native web search declaration')
  assert.equal(openAIResponsesBodyWithTools.tools[1].name, 'inspect_source', 'OpenAI Responses appends IsleMind provider tool declarations')
  const openAIResponsesToolResultBody = buildOpenAIResponsesBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5.5'],
      enabled: true,
    },
    model: 'gpt-5.5',
    messages: [
      { role: 'user', content: 'Need source details.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'fc_inspect_source',
          callId: 'call_inspect_source',
          name: 'inspect_source',
          arguments: { sourceId: 'src-1' },
        }],
      },
      {
        role: 'tool',
        name: 'inspect_source',
        toolCallId: 'call_inspect_source',
        content: 'Source details.',
      },
    ],
    stream: false,
  })
  assert.deepEqual(
    openAIResponsesToolResultBody.input[1],
    { type: 'function_call', id: 'fc_inspect_source', call_id: 'call_inspect_source', name: 'inspect_source', arguments: '{"sourceId":"src-1"}' },
    'OpenAI Responses tool replay uses official function_call input items'
  )
  assert.deepEqual(
    openAIResponsesToolResultBody.input[2],
    { type: 'function_call_output', call_id: 'call_inspect_source', output: 'Source details.' },
    'OpenAI Responses tool replay sends official function_call_output items'
  )
  const openAIResponsesReasoningReplayBody = buildOpenAIResponsesBodyForTest({
    provider: {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gpt-5.5'],
      enabled: true,
    },
    model: 'gpt-5.5',
    messages: [
      { role: 'user', content: 'Need source details.' },
      {
        role: 'assistant',
        content: '',
        responseItems: [{
          type: 'reasoning',
          id: 'rs_inspect_source',
          encrypted_content: 'encrypted-reasoning-state',
          summary: [],
        }],
        toolCalls: [{
          id: 'fc_inspect_source',
          callId: 'call_inspect_source',
          name: 'inspect_source',
          arguments: { sourceId: 'src-1' },
        }],
      },
      {
        role: 'tool',
        name: 'inspect_source',
        toolCallId: 'call_inspect_source',
        content: 'Source details.',
      },
    ],
    reasoningEffort: 'high',
    stream: false,
  })
  assert.deepEqual(
    openAIResponsesReasoningReplayBody.input.slice(1, 4),
    [
      { type: 'reasoning', id: 'rs_inspect_source', encrypted_content: 'encrypted-reasoning-state', summary: [] },
      { type: 'function_call', id: 'fc_inspect_source', call_id: 'call_inspect_source', name: 'inspect_source', arguments: '{"sourceId":"src-1"}' },
      { type: 'function_call_output', call_id: 'call_inspect_source', output: 'Source details.' },
    ],
    'OpenAI Responses tool replay preserves reasoning items before function_call_output'
  )
  const anthropicBodyWithTools = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-sonnet-4-6'],
      enabled: true,
    },
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hello' }],
    webSearchMode: 'native',
    providerToolDeclarations: [{
      name: 'read_context',
      description: 'Read local context.',
      input_schema: { type: 'object', properties: { query: { type: 'string' } } },
    }],
  })
  assert.equal(anthropicBodyWithTools.tools[0].type, 'web_search_20260209', 'Anthropic current Claude models use the official dynamic web search tool')
  assert.equal(anthropicBodyWithTools.tools[1].name, 'read_context', 'Anthropic appends IsleMind provider tool declarations')
  const anthropicWebSearchConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-sonnet-4-6'],
      enabled: true,
    },
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hello' }],
    webSearchMode: 'native',
  }, anthropicBodyWithTools)
  assert.equal(anthropicWebSearchConformance.manifest.tools.nativeWebSearchToolType, 'web_search_20260209', 'provider conformance records Anthropic current web search tool type')
  const anthropicLegacyWebSearchBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-3-5-sonnet-20241022'],
      enabled: true,
    },
    model: 'claude-3-5-sonnet-20241022',
    messages: [{ role: 'user', content: 'hello' }],
    webSearchMode: 'native',
  })
  assert.equal(anthropicLegacyWebSearchBody.tools[0].type, 'web_search_20250305', 'Anthropic legacy Claude models keep the compatible web search tool type')
  const anthropicToolResultBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-sonnet-4-6'],
      enabled: true,
    },
    model: 'claude-sonnet-4-6',
    messages: [
      { role: 'user', content: 'Need context.' },
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          text: '',
          toolUse: { id: 'toolu_read_context', name: 'read_context', input: { query: 'IsleMind' } },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          text: '',
          toolResult: { tool_use_id: 'toolu_read_context', content: 'Context result.' },
        }],
      },
    ],
    maxTokens: 1024,
    stream: false,
  })
  assert.deepEqual(
    anthropicToolResultBody.messages[1].content[0],
    { type: 'tool_use', id: 'toolu_read_context', name: 'read_context', input: { query: 'IsleMind' } },
    'Anthropic provider-native tool revision replays assistant tool_use content blocks'
  )
  assert.deepEqual(
    anthropicToolResultBody.messages[2].content[0],
    { type: 'tool_result', tool_use_id: 'toolu_read_context', content: 'Context result.' },
    'Anthropic provider-native tool revision sends official tool_result content blocks'
  )
  const anthropicThinkingToolChunk = parseProviderStreamChunkForTest([
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Checking tool context."}}',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"thinking-signature-1"}}',
  ].join('\n'), 'anthropic')
  assert.deepEqual(
    anthropicThinkingToolChunk.providerContentBlocks,
    [{ type: 'thinking', thinking: 'Checking tool context.', signature: 'thinking-signature-1' }],
    'Anthropic streaming parser preserves thinking blocks and signatures for official tool-result continuation'
  )
  const anthropicToolThinkingReplayBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-sonnet-4-6'],
      enabled: true,
    },
    model: 'claude-sonnet-4-6',
    messages: [
      { role: 'user', content: 'Need context.' },
      {
        role: 'assistant',
        providerContentBlocks: [
          { type: 'thinking', thinking: 'Checking tool context.', signature: 'thinking-signature-1' },
          { type: 'redacted_thinking', data: 'encrypted-redacted-thinking' },
        ],
        content: [{
          type: 'tool_use',
          text: '',
          toolUse: { id: 'toolu_read_context', name: 'read_context', input: { query: 'IsleMind' } },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          text: '',
          toolResult: { tool_use_id: 'toolu_read_context', content: 'Context result.' },
        }],
      },
    ],
    maxTokens: 1024,
    stream: false,
  })
  assert.deepEqual(
    anthropicToolThinkingReplayBody.messages[1].content.slice(0, 3),
    [
      { type: 'thinking', thinking: 'Checking tool context.', signature: 'thinking-signature-1' },
      { type: 'redacted_thinking', data: 'encrypted-redacted-thinking' },
      { type: 'tool_use', id: 'toolu_read_context', name: 'read_context', input: { query: 'IsleMind' } },
    ],
    'Anthropic provider-native tool revision replays thinking and redacted_thinking blocks before tool_use'
  )
  const googleBodyWithTools = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash'],
      enabled: true,
    },
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    webSearchMode: 'native',
    providerToolDeclarations: [{
      functionDeclarations: [{
        name: 'read_context',
        description: 'Read local context.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      }],
    }],
  })
  assert.ok(googleBodyWithTools.tools[0].google_search, 'Google keeps native web search declaration')
  assert.equal(googleBodyWithTools.tools[1].functionDeclarations[0].name, 'read_context', 'Google appends IsleMind provider tool declarations')
  const googleFunctionResponseBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-3.5-flash'],
      enabled: true,
    },
    model: 'gemini-3.5-flash',
    messages: [
      { role: 'user', content: 'Need context.' },
      {
        role: 'assistant',
        content: [{
          type: 'function_call',
          text: '',
          functionCall: { name: 'read_context', args: { query: 'IsleMind' } },
          thoughtSignature: 'signature-on-function-call',
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'function_response',
          text: '',
          functionResponse: { name: 'read_context', response: { result: 'Context result.' } },
        }],
      },
    ],
    maxTokens: 1024,
  })
  assert.deepEqual(
    googleFunctionResponseBody.contents[1].parts[0],
    { functionCall: { name: 'read_context', args: { query: 'IsleMind' } }, thoughtSignature: 'signature-on-function-call' },
    'Google provider-native tool revision preserves Gemini functionCall thought signatures'
  )
  assert.deepEqual(
    googleFunctionResponseBody.contents[2].parts[0],
    { functionResponse: { name: 'read_context', response: { result: 'Context result.' } } },
    'Google provider-native tool revision sends official functionResponse parts'
  )
  const geminiThoughtSseChunk = parseProviderStreamChunkForTest([
    `data: ${JSON.stringify({
      candidates: [{
        content: {
          parts: [
            { thought: true, text: 'Checking the request.' },
            { functionCall: { name: 'read_context', args: { query: 'IsleMind' } }, thoughtSignature: 'signature-on-function-call' },
            { text: 'Gemini answer.', thoughtSignature: 'signature-on-answer-part' },
          ],
        },
      }],
      usageMetadata: {
        promptTokenCount: 3,
        candidatesTokenCount: 4,
        thoughtsTokenCount: 5,
        totalTokenCount: 12,
      },
    })}`,
    '',
  ].join('\n'), 'google')
  assert.equal(geminiThoughtSseChunk.text, 'Gemini answer.', 'Gemini thought summaries are not emitted as answer text')
  assert.ok(geminiThoughtSseChunk.traces.some((trace) => trace.content === 'Checking the request.'), 'Gemini thought summaries are emitted as reasoning traces')
  assert.ok(
    geminiThoughtSseChunk.traces.some((trace) => trace.metadata?.hiddenSignature === true),
    'Gemini thought signatures are preserved even when attached to an answer part'
  )
  assert.equal(geminiThoughtSseChunk.providerToolCalls?.[0]?.thoughtSignature, 'signature-on-function-call', 'Gemini function call thought signatures stay attached to provider tool calls')
  assert.equal(geminiThoughtSseChunk.usage.reasoningTokens, 5, 'Gemini thoughtsTokenCount is preserved as reasoning token usage')
  const minimaxReasoningDetailsChunk = parseProviderStreamChunkForTest([
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          reasoning_details: [{ text: 'Checking MiniMax reasoning.' }],
          content: 'MiniMax answer.',
        },
      }],
    })}`,
    '',
  ].join('\n'), 'openai-compatible')
  assert.equal(minimaxReasoningDetailsChunk.text, 'MiniMax answer.', 'MiniMax reasoning_details are not emitted as answer text')
  assert.ok(
    minimaxReasoningDetailsChunk.traces.some((trace) => trace.content === 'Checking MiniMax reasoning.'),
    'MiniMax reasoning_details are emitted as reasoning traces'
  )
  const deepSeekReasoningContentChunk = parseProviderStreamChunkForTest([
    `data: ${JSON.stringify({
      choices: [{
        delta: {
          reasoning_content: 'Encrypted reasoning state.',
          content: 'DeepSeek answer.',
        },
      }],
    })}`,
    '',
  ].join('\n'), 'openai-compatible')
  assert.equal(deepSeekReasoningContentChunk.text, 'DeepSeek answer.', 'OpenAI-compatible reasoning_content is not emitted as answer text')
  assert.equal(deepSeekReasoningContentChunk.reasoningContent, 'Encrypted reasoning state.', 'OpenAI-compatible reasoning_content is preserved for provider replay')
  assert.ok(
    deepSeekReasoningContentChunk.traces.some((trace) => trace.content === 'Encrypted reasoning state.'),
    'OpenAI-compatible reasoning_content is still emitted as a reasoning trace'
  )
  const responsesJsonChunk = parseProviderStreamChunkForTest(JSON.stringify({
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Responses JSON text' }],
      },
    ],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  }), 'openai')
  assert.equal(responsesJsonChunk.text, 'Responses JSON text', 'Responses JSON body is parsed when a streaming request receives buffered JSON')
  assert.equal(responsesJsonChunk.usage.totalTokens, 7, 'Responses JSON body preserves provider usage')
  const responsesReasoningJsonChunk = parseProviderStreamChunkForTest(JSON.stringify({
    id: 'resp_reasoning_tool',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'reasoning',
        id: 'rs_inspect_source',
        encrypted_content: 'encrypted-reasoning-state',
        summary: [],
      },
      {
        type: 'function_call',
        id: 'fc_inspect_source',
        call_id: 'call_inspect_source',
        name: 'inspect_source',
        arguments: '{"sourceId":"src-1"}',
      },
    ],
    usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
  }), 'openai')
  assert.equal(responsesReasoningJsonChunk.text, '', 'Responses replay items are not emitted as answer text')
  assert.deepEqual(
    responsesReasoningJsonChunk.responseItems,
    [
      { type: 'reasoning', id: 'rs_inspect_source', encrypted_content: 'encrypted-reasoning-state', summary: [] },
      { type: 'function_call', id: 'fc_inspect_source', call_id: 'call_inspect_source', name: 'inspect_source', arguments: '{"sourceId":"src-1"}' },
    ],
    'Responses JSON preserves reasoning and function_call items for tool replay'
  )
  const responsesSseChunk = parseProviderStreamChunkForTest([
    'data: {"type":"response.output_text.delta","delta":"Hello"}',
    '',
    'data: {"type":"response.output_text.delta","delta":" world"}',
    '',
    'data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"Hello world"}]}]}}',
    '',
  ].join('\n'), 'openai')
  assert.equal(responsesSseChunk.text, 'Hello world', 'Responses SSE delta text is not duplicated by completion events')
  const xaiReasoningSummaryChunk = parseProviderStreamChunkForTest([
    'data: {"type":"response.reasoning_summary_text.delta","delta":"Thinking about the request"}',
    '',
  ].join('\n'), 'openai-compatible')
  assert.equal(xaiReasoningSummaryChunk.text, '', 'xAI Responses reasoning summary deltas are not emitted as answer text')
  assert.ok(
    xaiReasoningSummaryChunk.traces.some((trace) => trace.type === 'reasoning' && trace.content === 'Thinking about the request'),
    'xAI Responses reasoning summary deltas are surfaced as provider reasoning traces'
  )
  const responsesFunctionCallChunk = parseProviderStreamChunkForTest([
    `data: ${JSON.stringify({
      type: 'response.output_item.added',
      item: {
        id: 'fc_inspect_source',
        call_id: 'call_inspect_source',
        type: 'function_call',
        name: 'inspect_source',
        arguments: '{"sourceId":"src-1"}',
      },
    })}`,
    '',
  ].join('\n'), 'openai')
  assert.equal(responsesFunctionCallChunk.providerToolCalls?.[0]?.id, 'fc_inspect_source', 'Responses parser preserves output item id')
  assert.equal(responsesFunctionCallChunk.providerToolCalls?.[0]?.callId, 'call_inspect_source', 'Responses parser preserves function call_id for tool outputs')
  const deepSeekThinkingBody = buildOpenAIBodyForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-v4-pro'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'xhigh',
    maxTokens: 999999,
  })
  assert.deepEqual(deepSeekThinkingBody.thinking, { type: 'enabled' }, 'DeepSeek thinking uses official thinking toggle')
  assert.equal(deepSeekThinkingBody.reasoning_effort, 'max', 'DeepSeek xhigh maps to official max effort')
  assert.equal(deepSeekThinkingBody.temperature, undefined, 'DeepSeek thinking mode omits temperature')
  assert.ok(deepSeekThinkingBody.max_tokens <= getModelConfig('deepseek-v4-pro', 'openai-compatible').maxOutputTokens, 'DeepSeek request max tokens are clamped to output limit')
  const deepSeekThinkingConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-v4-pro'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'xhigh',
    maxTokens: 4096,
  }, deepSeekThinkingBody)
  assert.equal(deepSeekThinkingConformance.manifest.payload.requiresReasoningStatePassthrough, true, 'provider conformance marks DeepSeek reasoning_content passthrough as required')
  const deepSeekToolReplayBody = buildOpenAIBodyForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-v4-pro'],
      enabled: true,
      capabilities: { reasoningEffort: true, nativeTools: true },
    },
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'user', content: 'Need context.' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'DeepSeek tool reasoning state.',
        toolCalls: [{
          id: 'call_read_context',
          name: 'read_context',
          arguments: { query: 'IsleMind' },
        }],
      },
      {
        role: 'tool',
        name: 'read_context',
        toolCallId: 'call_read_context',
        content: 'Context result.',
      },
    ],
    maxTokens: 1024,
    stream: false,
  })
  assert.equal(deepSeekToolReplayBody.messages[1].reasoning_content, 'DeepSeek tool reasoning state.', 'DeepSeek tool-call replay preserves reasoning_content on the assistant tool-call message')
  const deepSeekPlainReplayBody = buildOpenAIBodyForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-v4-pro'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'deepseek-v4-pro',
    messages: [
      { role: 'assistant', content: 'Plain answer.', reasoningContent: 'DeepSeek plain reasoning state.' },
      { role: 'user', content: 'Follow up.' },
    ],
    maxTokens: 1024,
    stream: false,
  })
  assert.equal(deepSeekPlainReplayBody.messages[0].reasoning_content, undefined, 'DeepSeek plain multi-turn replay omits reasoning_content when no tool call was performed')
  const deepSeekOffBody = buildOpenAIBodyForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-v4-flash'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 512,
  })
  assert.deepEqual(deepSeekOffBody.thinking, { type: 'disabled' }, 'DeepSeek none disables thinking instead of sending unsupported minimal')
  assert.equal(deepSeekOffBody.reasoning_effort, undefined, 'DeepSeek disabled thinking omits effort')
  const deepSeekChatAliasBody = buildOpenAIBodyForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-chat'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 512,
  })
  assert.equal(deepSeekChatAliasBody.thinking, undefined, 'DeepSeek Chat alias does not send thinking controls')
  assert.equal(deepSeekChatAliasBody.reasoning_effort, undefined, 'DeepSeek Chat alias does not send reasoning_effort')
  const deepSeekChatAliasConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'deepseek',
      type: 'openai-compatible',
      presetId: 'deepseek',
      name: 'DeepSeek',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['deepseek-chat'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 512,
  }, deepSeekChatAliasBody)
  assert.equal(deepSeekChatAliasConformance.manifest.reasoning.supported, false, 'DeepSeek Chat alias conformance reports non-thinking mode')
  const nonReasoningBody = buildOpenAIBodyForTest({
    provider: {
      id: 'plain',
      type: 'openai-compatible',
      name: 'Plain Provider',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['reasoner-model'],
      enabled: true,
      capabilities: { reasoningEffort: true },
    },
    model: 'reasoner-model',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 512,
  })
  assert.equal(nonReasoningBody.reasoning_effort, undefined, 'generic compatible providers do not receive reasoning fields without source-backed support')
  const qwenThinkingBody = buildOpenAIBodyForTest({
    provider: {
      ...qwenProvider,
      [API_KEY_FIELD]: 'token-test-fake',
      capabilities: { reasoningEffort: true, nativeTools: true },
    },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
    providerToolDeclarations: [{
      type: 'function',
      function: {
        name: 'read_context',
        description: 'Read local context.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    }],
  })
  assert.equal(qwenThinkingBody.enable_thinking, true, 'Qwen DashScope thinking uses enable_thinking')
  assert.equal(qwenThinkingBody.thinking_budget, 262144, 'Qwen DashScope high thinking uses the official 256K thinking budget')
  assert.deepEqual(qwenThinkingBody.stream_options, { include_usage: true }, 'Qwen DashScope streaming requests include usage metadata')
  assert.equal(qwenThinkingBody.temperature, undefined, 'Qwen thinking requests omit sampling parameters')
  assert.equal(qwenThinkingBody.tools[0].function.name, 'read_context', 'Qwen OpenAI-compatible requests carry native tool declarations')
  const buildQwenHighThinkingBody = (model) => buildOpenAIBodyForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model,
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  const qwen36FlashThinkingBody = buildQwenHighThinkingBody('qwen3.6-flash')
  assert.equal(qwen36FlashThinkingBody.thinking_budget, 131072, 'Qwen3.6 Flash high thinking uses the official 128K thinking budget')
  const qwen36MaxPreviewThinkingBody = buildQwenHighThinkingBody('qwen3.6-max-preview')
  assert.equal(qwen36MaxPreviewThinkingBody.thinking_budget, 131072, 'Qwen3.6 Max Preview high thinking uses the official 128K thinking budget')
  const qwen36PlusThinkingBody = buildQwenHighThinkingBody('qwen3.6-plus')
  assert.equal(qwen36PlusThinkingBody.thinking_budget, 81920, 'Qwen3.6 Plus high thinking uses the official 80K thinking budget')
  const qwen35PlusThinkingBody = buildQwenHighThinkingBody('qwen3.5-plus')
  assert.equal(qwen35PlusThinkingBody.thinking_budget, 81920, 'Qwen3.5 Plus high thinking uses the official 80K thinking budget')
  const qwen35FlashThinkingBody = buildQwenHighThinkingBody('qwen3.5-flash')
  assert.equal(qwen35FlashThinkingBody.thinking_budget, 81920, 'Qwen3.5 Flash high thinking uses the official 80K thinking budget')
  const qwen36FlashConformance = resolveProviderRequestConformanceForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.6-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, qwen36FlashThinkingBody)
  assert.equal(qwen36FlashConformance.reasoning.providerValue, 131072, 'provider conformance mirrors the official Qwen3.6 Flash 128K thinking budget')
  const qwen35FlashConformance = resolveProviderRequestConformanceForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, qwen35FlashThinkingBody)
  assert.equal(qwen35FlashConformance.reasoning.providerValue, 81920, 'provider conformance mirrors the official Qwen3.5 80K thinking budget')
  const qwenToolResultBody = buildOpenAIBodyForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake' },
    model: 'qwen3.7-max',
    messages: [
      { role: 'user', content: 'Need context.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'call_read_context',
          name: 'read_context',
          arguments: { query: 'IsleMind' },
        }],
      },
      {
        role: 'tool',
        name: 'read_context',
        toolCallId: 'call_read_context',
        content: 'Context result.',
      },
    ],
    maxTokens: 1024,
    stream: false,
  })
  assert.deepEqual(
    qwenToolResultBody.messages[1].tool_calls[0],
    { id: 'call_read_context', type: 'function', function: { name: 'read_context', arguments: '{"query":"IsleMind"}' } },
    'Qwen OpenAI-compatible tool revision replays assistant tool_calls in official format'
  )
  assert.deepEqual(
    qwenToolResultBody.messages[2],
    { role: 'tool', tool_call_id: 'call_read_context', name: 'read_context', content: 'Context result.' },
    'Qwen OpenAI-compatible tool revision sends official tool result messages'
  )
  const qwenMediumThinkingBody = buildOpenAIBodyForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  })
  assert.equal(qwenMediumThinkingBody.enable_thinking, true, 'Qwen medium thinking stays enabled')
  assert.equal(qwenMediumThinkingBody.thinking_budget, 65536, 'Qwen DashScope medium thinking uses a bounded 64K thinking budget')
  const qwenNonStreamingBody = buildOpenAIBodyForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 512,
    stream: false,
  })
  assert.equal(qwenNonStreamingBody.stream_options, undefined, 'Qwen non-streaming requests omit stream_options')
  const qwenOffBody = buildOpenAIBodyForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 512,
  })
  assert.equal(qwenOffBody.enable_thinking, false, 'Qwen none explicitly disables thinking when the user turns reasoning off')
  assert.equal(qwenOffBody.thinking_budget, undefined, 'Qwen disabled thinking omits thinking_budget')
  const qwenMinimalBody = buildOpenAIBodyForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 512,
  })
  assert.equal(qwenMinimalBody.enable_thinking, false, 'Qwen minimal remains an explicit off state for DashScope thinking')
  assert.equal(qwenMinimalBody.thinking_budget, undefined, 'Qwen minimal off state omits thinking_budget')
  const qwenMinimalConformance = resolveProviderRequestConformanceForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 512,
  }, qwenMinimalBody)
  assert.equal(qwenMinimalConformance.reasoning.enabled, false, 'provider conformance keeps DashScope minimal as disabled thinking')
  const kimiThinkingBody = buildOpenAIBodyForTest({
    provider: { ...kimiProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  assert.deepEqual(kimiThinkingBody.thinking, { type: 'enabled' }, 'Kimi thinking uses Moonshot thinking.type')
  assert.equal(kimiThinkingBody.temperature, undefined, 'Kimi thinking requests omit sampling parameters')
  assert.equal(kimiThinkingBody.max_completion_tokens, 4096, 'Kimi requests use official max_completion_tokens')
  assert.equal(kimiThinkingBody.max_tokens, undefined, 'Kimi requests do not send deprecated max_tokens')
  const kimi25ThinkingBody = buildOpenAIBodyForTest({
    provider: { ...kimiProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'kimi-k2.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  assert.deepEqual(kimi25ThinkingBody.thinking, { type: 'enabled' }, 'Kimi K2.5 thinking uses Moonshot thinking.type')
  assert.equal(kimi25ThinkingBody.max_completion_tokens, 4096, 'Kimi K2.5 requests use official max_completion_tokens')
  const kimiOffBody = buildOpenAIBodyForTest({
    provider: { ...kimiProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    temperature: 0.2,
    topP: 0.5,
    maxTokens: 512,
  })
  assert.deepEqual(kimiOffBody.thinking, { type: 'disabled' }, 'Kimi none explicitly disables thinking')
  assert.equal(kimiOffBody.temperature, undefined, 'Kimi K2.6 disabled-thinking requests still omit fixed sampling parameters')
  assert.equal(kimiOffBody.top_p, undefined, 'Kimi K2.6 disabled-thinking requests omit top_p')
  assert.equal(kimiOffBody.max_completion_tokens, 512, 'Kimi disabled-thinking requests use official max_completion_tokens')
  const kimiDefaultThinkingBody = buildOpenAIBodyForTest({
    provider: { ...kimiProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true } },
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0.2,
    topP: 0.5,
    maxTokens: 2048,
  })
  assert.equal(kimiDefaultThinkingBody.thinking, undefined, 'Kimi K2.6 default thinking relies on the official enabled default')
  assert.equal(kimiDefaultThinkingBody.temperature, undefined, 'Kimi K2.6 default thinking omits fixed sampling parameters')
  assert.equal(kimiDefaultThinkingBody.top_p, undefined, 'Kimi K2.6 default thinking omits top_p')
  assert.equal(kimiDefaultThinkingBody.max_completion_tokens, 2048, 'Kimi K2.6 default thinking uses max_completion_tokens')
  const kimiToolReplayBody = buildOpenAIBodyForTest({
    provider: { ...kimiProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'kimi-k2.6',
    messages: [
      { role: 'user', content: 'Need context.' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'Encrypted Kimi reasoning state.',
        toolCalls: [{
          id: 'call_read_context',
          name: 'read_context',
          arguments: { query: 'IsleMind' },
        }],
      },
      {
        role: 'tool',
        name: 'read_context',
        toolCallId: 'call_read_context',
        content: 'Context result.',
      },
    ],
    maxTokens: 1024,
    stream: false,
  })
  assert.equal(kimiToolReplayBody.messages[1].reasoning_content, 'Encrypted Kimi reasoning state.', 'Kimi tool-result replay preserves assistant reasoning_content')
  assert.equal(kimiToolReplayBody.messages[1].tool_calls[0].id, 'call_read_context', 'Kimi tool-result replay keeps official tool_calls')
  assert.deepEqual(kimiToolReplayBody.thinking, { type: 'enabled', keep: 'all' }, 'Kimi preserved thinking requests thinking.keep all when replaying reasoning_content')
  const genericReasoningReplayBody = buildOpenAIBodyForTest({
    provider: {
      id: 'generic-compatible',
      type: 'openai-compatible',
      name: 'Generic Compatible',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['generic-chat'],
      enabled: true,
    },
    model: 'generic-chat',
    messages: [{ role: 'assistant', content: 'hello', reasoningContent: 'should-not-send' }],
    maxTokens: 512,
  })
  assert.equal(genericReasoningReplayBody.messages[0].reasoning_content, undefined, 'generic compatible providers do not receive reasoning_content replay without source-backed support')
  const grokReasoningBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
    providerToolDeclarations: [{
      type: 'function',
      name: 'inspect_source',
      description: 'Inspect a source.',
      parameters: { type: 'object', properties: { sourceId: { type: 'string' } } },
    }],
  })
  assert.equal(grokReasoningBody.reasoning.effort, 'high', 'Grok Responses reasoning uses official xAI reasoning.effort')
  assert.equal(grokReasoningBody.reasoning.summary, undefined, 'Grok Responses does not inherit OpenAI-only reasoning.summary')
  assert.deepEqual(grokReasoningBody.include, ['reasoning.encrypted_content'], 'Grok Responses reasoning requests preserve encrypted reasoning state for tool loops')
  assert.equal(grokReasoningBody.max_output_tokens, 4096, 'Grok Responses uses xAI-supported max_output_tokens')
  assert.equal(grokReasoningBody.max_completion_tokens, undefined, 'Grok Responses avoids chat-completions max_completion_tokens')
  assert.equal(grokReasoningBody.max_tokens, undefined, 'Grok Responses avoids deprecated max_tokens')
  assert.equal(grokReasoningBody.tools[0].name, 'inspect_source', 'Grok Responses requests carry native Responses tool declarations')
  const grok420MultiAgentBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.20-multi-agent',
    messages: [{ role: 'user', content: 'coordinate agents' }],
    reasoningEffort: 'xhigh',
    maxTokens: 4096,
  })
  assert.equal(grok420MultiAgentBody.reasoning.effort, 'xhigh', 'Grok 4.20 Multi-Agent preserves official xAI xhigh reasoning effort')
  const grok420MultiAgentConformance = resolveProviderRequestConformanceForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.20-multi-agent',
    messages: [{ role: 'user', content: 'coordinate agents' }],
    reasoningEffort: 'xhigh',
    maxTokens: 4096,
  }, grok420MultiAgentBody)
  assert.equal(grok420MultiAgentConformance.reasoning.providerValue, 'xhigh', 'provider conformance preserves xAI Multi-Agent xhigh reasoning effort')
  const grok420NonReasoningBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.20-non-reasoning',
    messages: [{ role: 'user', content: 'fast answer' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  assert.equal(grok420NonReasoningBody.reasoning, undefined, 'Grok 4.20 non-reasoning requests omit reasoning controls')
  const grokNativeSearchBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'latest xAI docs?' }],
    webSearchMode: 'native',
    maxTokens: 4096,
  })
  assert.equal(grokNativeSearchBody.tools[0].type, 'web_search', 'Grok Responses native search uses the official xAI web_search tool')
  const grokNativeSearchConformance = resolveProviderRequestConformanceForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'latest xAI docs?' }],
    webSearchMode: 'native',
    maxTokens: 4096,
  }, grokNativeSearchBody)
  assert.equal(grokNativeSearchConformance.manifest.tools.nativeWebSearchToolType, 'web_search', 'provider conformance records xAI Responses web search tool type')
  const grokRuntimeBody = getBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true, responsesApi: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  assert.equal(grokRuntimeBody.input[0].content, 'hello', 'Grok runtime request body uses Responses input instead of chat messages')
  assert.equal(grokRuntimeBody.reasoning.effort, 'high', 'Grok runtime request body uses Responses reasoning.effort')
  const grokResponsesEndpoint = resolveProviderEndpoint({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake' },
    model: 'grok-4.3',
    stream: true,
    usesResponsesApi: true,
  })
  assert.equal(grokResponsesEndpoint, 'https://api.x.ai/v1/responses', 'Grok Responses requests resolve to the xAI /v1/responses endpoint')
  const grokMediumReasoningBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  })
  assert.equal(grokMediumReasoningBody.reasoning.effort, 'medium', 'Grok medium reasoning remains a provider-native xAI effort')
  const grokDefaultReasoningBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 4096,
  })
  assert.equal(grokDefaultReasoningBody.reasoning, undefined, 'Grok default reasoning relies on xAI server-side low effort')
  assert.deepEqual(grokDefaultReasoningBody.include, ['reasoning.encrypted_content'], 'Grok default reasoning still requests encrypted state for continuation')
  const grokNoReasoningBody = buildOpenAIResponsesBodyForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 4096,
  })
  assert.equal(grokNoReasoningBody.reasoning.effort, 'none', 'Grok none reasoning explicitly disables xAI default reasoning')
  assert.equal(grokNoReasoningBody.include, undefined, 'Grok disabled reasoning does not request encrypted reasoning content')
  const grokNoReasoningConformance = resolveProviderRequestConformanceForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 4096,
  }, grokNoReasoningBody)
  assert.equal(grokNoReasoningConformance.reasoning.enabled, false, 'provider conformance treats xAI none as disabled reasoning')
  const minimaxToolBody = buildOpenAIBodyForTest({
    provider: { ...minimaxProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 4096,
    providerToolDeclarations: [{
      type: 'function',
      function: {
        name: 'summarize_file',
        description: 'Summarize a file.',
        parameters: { type: 'object', properties: { fileId: { type: 'string' } } },
      },
    }],
  })
  assert.equal(minimaxToolBody.tools[0].function.name, 'summarize_file', 'MiniMax requests carry native tool declarations')
  assert.equal(minimaxToolBody.thinking, undefined, 'MiniMax M3 requests omit thinking when unset and rely on the official adaptive default')
  assert.equal(minimaxToolBody.reasoning_split, true, 'MiniMax M3 requests split reasoning output from answer text by default')
  assert.equal(minimaxToolBody.reasoning_effort, undefined, 'MiniMax M3 requests do not send unsupported reasoning_effort')
  assert.equal(minimaxToolBody.max_completion_tokens, 4096, 'MiniMax OpenAI-compatible requests use the official max_completion_tokens field')
  assert.equal(minimaxToolBody.max_tokens, undefined, 'MiniMax OpenAI-compatible requests avoid the deprecated max_tokens field')
  const minimaxThinkingBody = buildOpenAIBodyForTest({
    provider: { ...minimaxProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    temperature: 0.4,
    topP: 0.8,
    maxTokens: 999999,
  })
  assert.deepEqual(minimaxThinkingBody.thinking, { type: 'adaptive' }, 'MiniMax M3 high reasoning uses official adaptive thinking')
  assert.equal(minimaxThinkingBody.reasoning_split, true, 'MiniMax M3 high reasoning requests separated reasoning output')
  assert.equal(minimaxThinkingBody.reasoning_effort, undefined, 'MiniMax M3 adaptive thinking avoids unsupported reasoning_effort')
  assert.equal(minimaxThinkingBody.temperature, 0.4, 'MiniMax M3 thinking requests keep provider-supported temperature')
  assert.equal(minimaxThinkingBody.top_p, 0.8, 'MiniMax M3 thinking requests keep provider-supported top_p')
  assert.equal(minimaxThinkingBody.max_completion_tokens, getModelConfig('MiniMax-M3', 'openai-compatible').maxOutputTokens, 'MiniMax M3 request max tokens clamp to the official output maximum')
  const minimaxOffBody = buildOpenAIBodyForTest({
    provider: { ...minimaxProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 512,
  })
  assert.deepEqual(minimaxOffBody.thinking, { type: 'disabled' }, 'MiniMax M3 none explicitly disables thinking')
  assert.equal(minimaxOffBody.reasoning_split, undefined, 'MiniMax M3 disabled thinking omits reasoning_split')
  const minimaxToolReplayBody = buildOpenAIBodyForTest({
    provider: { ...minimaxProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [
      { role: 'user', content: 'Need a file summary.' },
      {
        role: 'assistant',
        content: '',
        reasoningContent: 'MiniMax structured thinking is response-only.',
        toolCalls: [{
          id: 'call_summarize_file',
          name: 'summarize_file',
          arguments: { path: 'docs/README.md' },
        }],
      },
      {
        role: 'tool',
        name: 'summarize_file',
        toolCallId: 'call_summarize_file',
        content: 'Summary.',
      },
    ],
    maxTokens: 4096,
    stream: false,
  })
  assert.equal(minimaxToolReplayBody.messages[1].reasoning_content, undefined, 'MiniMax tool-result replay avoids non-schema reasoning_content fields')
  assert.equal(minimaxToolReplayBody.messages[1].tool_calls[0].id, 'call_summarize_file', 'MiniMax tool-result replay preserves official tool_calls')
  const minimaxConformance = resolveProviderRequestConformanceForTest({
    provider: { ...minimaxProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, minimaxThinkingBody)
  assert.equal(minimaxConformance.manifest.family, 'minimax', 'provider conformance classifies MiniMax as MiniMax')
  assert.equal(minimaxConformance.manifest.reasoning.requestShape, 'minimax-thinking', 'provider conformance exposes MiniMax thinking request shape')
  assert.equal(minimaxConformance.reasoning.providerValue, 'adaptive', 'provider conformance maps MiniMax active thinking to adaptive')
  assert.equal(minimaxConformance.manifest.payload.maxTokensField, 'max_completion_tokens', 'provider conformance records MiniMax OpenAI-compatible max token field')
  assert.equal(minimaxConformance.manifest.payload.requiresReasoningStatePassthrough, false, 'provider conformance avoids non-schema MiniMax reasoning state passthrough')
  assert.equal(minimaxConformance.manifest.payload.reasoningOutputSplitField, 'reasoning_split', 'provider conformance records MiniMax reasoning_split output separation')
  assert.equal(minimaxConformance.manifest.modalities.input.video, true, 'provider conformance records MiniMax M3 video input support')
  const minimaxAnthropicBody = buildAnthropicBodyForTest({
    provider: { ...minimaxProvider, wireProtocol: 'anthropic-compatible', [API_KEY_FIELD]: 'token-test-fake', capabilities: { nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
    stream: false,
  })
  assert.deepEqual(minimaxAnthropicBody.thinking, { type: 'adaptive' }, 'MiniMax Anthropic-compatible requests use official adaptive thinking')
  assert.equal(minimaxAnthropicBody.output_config, undefined, 'MiniMax Anthropic-compatible requests avoid Claude output_config thinking tiers')
  assert.equal(minimaxAnthropicBody.max_tokens, 4096, 'MiniMax Anthropic-compatible requests keep Anthropic max_tokens field')
  const minimaxAnthropicConformance = resolveProviderRequestConformanceForTest({
    provider: { ...minimaxProvider, wireProtocol: 'anthropic-compatible', [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'MiniMax-M3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, minimaxAnthropicBody)
  assert.equal(minimaxAnthropicConformance.manifest.family, 'minimax', 'provider conformance keeps MiniMax family on Anthropic-compatible wire protocol')
  assert.equal(minimaxAnthropicConformance.manifest.protocol, 'anthropic-compatible', 'provider conformance records MiniMax Anthropic-compatible protocol')
  assert.equal(minimaxAnthropicConformance.manifest.payload.maxTokensField, 'max_tokens', 'provider conformance records MiniMax Anthropic-compatible max token field')
  assert.equal(minimaxAnthropicConformance.manifest.payload.reasoningOutputSplitField, undefined, 'provider conformance avoids OpenAI-only reasoning_split on MiniMax Anthropic-compatible requests')
  const qwenConformance = resolveProviderRequestConformanceForTest({
    provider: { ...qwenProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'qwen3.7-max',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, qwenThinkingBody)
  assert.equal(qwenConformance.manifest.family, 'dashscope', 'provider conformance classifies Qwen as DashScope')
  assert.equal(qwenConformance.manifest.reasoning.requestShape, 'dashscope-thinking', 'provider conformance exposes Qwen thinking request shape')
  assert.equal(qwenConformance.manifest.payload.streamUsageField, 'stream_options.include_usage', 'provider conformance records DashScope stream usage field')
  assert.equal(qwenConformance.reasoning.providerValue, 262144, 'provider conformance exposes Qwen high thinking budget')
  assert.equal(qwenConformance.manifest.tools.supported, true, 'provider conformance exposes Qwen native tool support')
  assert.equal(qwenConformance.manifest.tools.requestShape, 'openai-tools', 'provider conformance exposes Qwen OpenAI-format tool shape')
  const kimiConformance = resolveProviderRequestConformanceForTest({
    provider: { ...kimiProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'kimi-k2.6',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'low',
    maxTokens: 4096,
  }, kimiThinkingBody)
  assert.equal(kimiConformance.reasoning.effective, 'high', 'provider conformance downgrades unsupported Kimi levels to high instead of disabling thinking')
  assert.equal(kimiConformance.manifest.reasoning.requestShape, 'kimi-thinking', 'provider conformance exposes Kimi thinking request shape')
  assert.equal(kimiConformance.manifest.payload.maxTokensField, 'max_completion_tokens', 'provider conformance exposes Moonshot max_completion_tokens')
  assert.equal(kimiConformance.manifest.payload.requiresReasoningStatePassthrough, true, 'provider conformance marks Kimi reasoning_content passthrough as required')
  assert.equal(kimiConformance.manifest.payload.reasoningStatePreservationField, 'thinking.keep', 'provider conformance records Kimi preserved-thinking keep field')
  assert.equal(kimiConformance.manifest.tools.supported, true, 'provider conformance exposes Kimi native tool support')
  const grokConformance = resolveProviderRequestConformanceForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, grokReasoningBody)
  assert.equal(grokConformance.manifest.family, 'xai', 'provider conformance classifies Grok as xAI')
  assert.equal(grokConformance.manifest.protocol, 'openai-responses', 'provider conformance exposes xAI Responses protocol for Grok 4.3')
  assert.equal(grokConformance.manifest.reasoning.requestShape, 'xai-reasoning-effort', 'provider conformance exposes Grok reasoning request shape')
  assert.equal(grokConformance.manifest.payload.maxTokensField, 'max_output_tokens', 'provider conformance exposes xAI Responses max_output_tokens')
  assert.equal(grokConformance.manifest.payload.requiresReasoningStatePassthrough, true, 'provider conformance marks Grok reasoning_content passthrough as required')
  assert.deepEqual(
    grokConformance.manifest.payload.unsupportedFieldsWhenReasoning,
    ['presence_penalty', 'presencePenalty', 'frequency_penalty', 'frequencyPenalty', 'stop', 'stop_sequences', 'stopSequences'],
    'provider conformance records xAI reasoning-incompatible fields'
  )
  const grokHardenedConformance = resolveProviderRequestConformanceForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  }, {
    ...grokReasoningBody,
    presence_penalty: 0.2,
    frequency_penalty: 0.1,
    stop: ['END'],
  })
  assert.ok(grokHardenedConformance.removedParams.includes('presence_penalty'), 'provider conformance removes xAI reasoning-incompatible presence_penalty')
  assert.ok(grokHardenedConformance.removedParams.includes('frequency_penalty'), 'provider conformance removes xAI reasoning-incompatible frequency_penalty')
  assert.ok(grokHardenedConformance.removedParams.includes('stop'), 'provider conformance removes xAI reasoning-incompatible stop')
  assert.equal(grokConformance.manifest.tools.supported, true, 'provider conformance exposes Grok native tool support')
  const grokMediumConformance = resolveProviderRequestConformanceForTest({
    provider: { ...grokProvider, [API_KEY_FIELD]: 'token-test-fake', capabilities: { reasoningEffort: true, nativeTools: true } },
    model: 'grok-4.3',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  }, grokMediumReasoningBody)
  assert.equal(grokMediumConformance.reasoning.providerValue, 'medium', 'provider conformance preserves xAI medium reasoning effort')
  const gemini25Body = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash'],
      enabled: true,
    },
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'low',
    maxTokens: 4096,
  })
  assert.equal(gemini25Body.generationConfig.thinkingConfig.thinkingBudget, 1024, 'Gemini 2.5 uses thinkingBudget')
  assert.equal(gemini25Body.generationConfig.thinkingConfig.includeThoughts, true, 'Gemini 2.5 requests thought summaries for visible thinking efforts')
  assert.ok(gemini25Body.generationConfig.maxOutputTokens <= getModelConfig('gemini-2.5-flash', 'google').maxOutputTokens, 'Gemini maxOutputTokens is clamped to output limit')
  const gemini25DynamicBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash'],
      enabled: true,
    },
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  })
  assert.equal(gemini25DynamicBody.generationConfig.thinkingConfig.thinkingBudget, -1, 'Gemini 2.5 Flash medium uses dynamic thinking budget')
  const gemini25DynamicConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash'],
      enabled: true,
    },
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  }, gemini25DynamicBody)
  assert.equal(gemini25DynamicConformance.reasoning.providerValue, -1, 'provider conformance preserves Gemini dynamic thinking budget')
  const gemini25ProLowBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-pro'],
      enabled: true,
    },
    model: 'gemini-2.5-pro',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'low',
    maxTokens: 4096,
  })
  assert.equal(gemini25ProLowBody.generationConfig.thinkingConfig.thinkingBudget, 2048, 'Gemini 2.5 Pro low uses the Pro thinking budget floor')
  const gemini25ProLowConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-pro'],
      enabled: true,
    },
    model: 'gemini-2.5-pro',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'low',
    maxTokens: 4096,
  }, gemini25ProLowBody)
  assert.equal(gemini25ProLowConformance.reasoning.providerValue, 2048, 'provider conformance mirrors Gemini 2.5 Pro low thinking budget')
  const geminiOversizedRoute = resolveProviderRouteForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash'],
      enabled: true,
    },
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 999999,
  }, {
    contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
    generationConfig: { maxOutputTokens: 999999 },
  })
  assert.equal(
    geminiOversizedRoute.body.generationConfig.maxOutputTokens,
    getModelConfig('gemini-2.5-flash', 'google').maxOutputTokens,
    'Google conformance clamps nested generationConfig.maxOutputTokens'
  )
  assert.equal(
    geminiOversizedRoute.conformance.adjustedParams['generationConfig.maxOutputTokens'],
    getModelConfig('gemini-2.5-flash', 'google').maxOutputTokens,
    'Google conformance records nested output-token adjustment evidence'
  )
  assert.equal(geminiOversizedRoute.decision.contextPlan.maxTokensField, 'generationConfig.maxOutputTokens', 'Google route plan points at the nested max token field')
  const gemini25MinimalBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash'],
      enabled: true,
    },
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  })
  assert.equal(gemini25MinimalBody.generationConfig.thinkingConfig.includeThoughts, undefined, 'Gemini minimal thinking does not request visible thought summaries')
  const gemini25FlashLiteOffBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash-lite'],
      enabled: true,
    },
    model: 'gemini-2.5-flash-lite',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'none',
    maxTokens: 4096,
  })
  assert.equal(gemini25FlashLiteOffBody.generationConfig.thinkingConfig.thinkingBudget, 0, 'Gemini 2.5 Flash-Lite none disables thinking with budget 0')
  const gemini25FlashLiteMinimalBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash-lite'],
      enabled: true,
    },
    model: 'gemini-2.5-flash-lite',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  })
  assert.equal(gemini25FlashLiteMinimalBody.generationConfig.thinkingConfig.thinkingBudget, 0, 'Gemini 2.5 Flash-Lite minimal keeps the no-thinking budget')
  assert.equal(gemini25FlashLiteMinimalBody.generationConfig.thinkingConfig.includeThoughts, undefined, 'Gemini 2.5 Flash-Lite minimal does not request visible thought summaries')
  const gemini25FlashLiteMinimalConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-2.5-flash-lite'],
      enabled: true,
    },
    model: 'gemini-2.5-flash-lite',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  }, gemini25FlashLiteMinimalBody)
  assert.equal(gemini25FlashLiteMinimalConformance.reasoning.enabled, true, 'provider conformance treats Gemini 2.5 Flash-Lite minimal as an active thinking control')
  assert.equal(gemini25FlashLiteMinimalConformance.reasoning.providerValue, 0, 'provider conformance maps Gemini 2.5 Flash-Lite minimal to budget 0')
  const gemini3Body = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-3-flash-preview'],
      enabled: true,
    },
    model: 'gemini-3-flash-preview',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  assert.equal(gemini3Body.generationConfig.thinkingConfig.thinkingLevel, 'high', 'Gemini 3 uses thinkingLevel')
  assert.equal(gemini3Body.generationConfig.thinkingConfig.includeThoughts, true, 'Gemini 3 requests thought summaries for visible thinking levels')
  const gemini35Body = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-3.5-flash'],
      enabled: true,
    },
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  })
  assert.equal(gemini35Body.generationConfig.thinkingConfig.thinkingLevel, 'medium', 'Gemini 3.5 Flash uses thinkingLevel')
  assert.equal(gemini35Body.generationConfig.thinkingConfig.includeThoughts, true, 'Gemini 3.5 Flash requests thought summaries for visible thinking levels')
  const gemini35PrefixedBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['models/gemini-3.5-flash'],
      enabled: true,
    },
    model: 'models/gemini-3.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'medium',
    maxTokens: 4096,
  })
  assert.equal(gemini35PrefixedBody.generationConfig.thinkingConfig.thinkingLevel, 'medium', 'Gemini official models/ resource names still use thinkingLevel')
  assert.equal(gemini35PrefixedBody.generationConfig.thinkingConfig.includeThoughts, true, 'Gemini official models/ resource names still request thought summaries')
  const gemini35MinimalBody = buildGoogleBodyForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-3.5-flash'],
      enabled: true,
    },
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  })
  assert.equal(gemini35MinimalBody.generationConfig.thinkingConfig.thinkingLevel, 'minimal', 'Gemini 3.5 Flash preserves official minimal thinking level')
  assert.equal(gemini35MinimalBody.generationConfig.thinkingConfig.includeThoughts, undefined, 'Gemini 3.5 Flash minimal does not request visible thought summaries')
  const gemini35MinimalConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'google',
      type: 'google',
      name: 'Google',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['gemini-3.5-flash'],
      enabled: true,
    },
    model: 'gemini-3.5-flash',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'minimal',
    maxTokens: 4096,
  }, gemini35MinimalBody)
  assert.equal(gemini35MinimalConformance.reasoning.enabled, true, 'provider conformance treats Gemini thinkingLevel minimal as active thinking control')
  assert.equal(gemini35MinimalConformance.reasoning.providerValue, 'minimal', 'provider conformance preserves Gemini minimal thinking level')
  const parsedAnthropic = parseAnthropicModelsForTest([
    { id: 'claude-test-current', display_name: 'Claude Test', max_input_tokens: 1000000, max_tokens: 128000, capabilities: ['chat', 'extended_thinking'] },
  ])
  assert.equal(parsedAnthropic[0].contextWindow, 1000000, 'Anthropic Models API max_input_tokens is parsed as context window')
  assert.equal(parsedAnthropic[0].maxOutputTokens, 128000, 'Anthropic Models API max_tokens is parsed as output limit')
  assert.equal(parsedAnthropic[0].reasoningMode, 'anthropic-thinking', 'Anthropic model capabilities mark thinking support')
  const anthropicFableAdaptiveBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-fable-5'],
      enabled: true,
    },
    model: 'claude-fable-5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'max',
    maxTokens: 128000,
  })
  assert.equal(anthropicFableAdaptiveBody.thinking, undefined, 'Claude Fable 5 does not send a synthetic thinking object because adaptive thinking is always on')
  assert.equal(anthropicFableAdaptiveBody.output_config.effort, 'max', 'Claude Fable 5 preserves official max effort')
  const anthropicFableConformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      capabilities: { reasoningEffort: true, nativeTools: true },
      models: ['claude-fable-5'],
      enabled: true,
    },
    model: 'claude-fable-5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'max',
    maxTokens: 128000,
  }, anthropicFableAdaptiveBody)
  assert.equal(anthropicFableConformance.manifest.reasoning.requestShape, 'anthropic-output-config-effort', 'provider conformance exposes Claude Fable 5 output_config effort control')
  assert.equal(anthropicFableConformance.reasoning.providerValue, 'max', 'provider conformance preserves Claude Fable 5 max effort')
  const anthropicAdaptiveBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-opus-4-7'],
      enabled: true,
    },
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'xhigh',
    maxTokens: 128000,
  })
  assert.deepEqual(anthropicAdaptiveBody.thinking, { type: 'adaptive', display: 'summarized' }, 'Claude Opus 4.7 uses adaptive thinking instead of manual budget tokens')
  assert.equal(anthropicAdaptiveBody.output_config.effort, 'xhigh', 'Claude Opus 4.7 sends source-backed effort level')
  assert.equal(anthropicAdaptiveBody.temperature, undefined, 'Claude Opus 4.7 omits sampling parameters when reasoning is enabled')
  const anthropic47DefaultBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-opus-4-7'],
      enabled: true,
    },
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 4096,
  })
  assert.equal(anthropic47DefaultBody.temperature, undefined, 'Claude Opus 4.7 omits default temperature even without explicit reasoning')
  assert.equal(anthropic47DefaultBody.top_p, undefined, 'Claude Opus 4.7 omits default top_p even without explicit reasoning')
  const anthropic47Conformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      capabilities: { reasoningEffort: true, nativeTools: true },
      models: ['claude-opus-4-7'],
      enabled: true,
    },
    model: 'claude-opus-4-7',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 4096,
  }, { ...anthropic47DefaultBody, temperature: 0.7, top_p: 1 })
  assert.deepEqual(anthropic47Conformance.removedParams.sort(), ['temperature', 'top_p'], 'provider conformance removes Claude Opus 4.7 unsupported sampling parameters')
  const anthropic48AdaptiveBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-opus-4-8'],
      enabled: true,
    },
    model: 'claude-opus-4-8',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'max',
    maxTokens: 128000,
  })
  assert.deepEqual(anthropic48AdaptiveBody.thinking, { type: 'adaptive', display: 'summarized' }, 'Claude Opus 4.8 uses adaptive thinking instead of manual budget tokens')
  assert.equal(anthropic48AdaptiveBody.output_config.effort, 'max', 'Claude Opus 4.8 preserves max effort')
  const anthropic48Conformance = resolveProviderRequestConformanceForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      capabilities: { reasoningEffort: true, nativeTools: true },
      models: ['claude-opus-4-8'],
      enabled: true,
    },
    model: 'claude-opus-4-8',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'max',
    maxTokens: 128000,
  }, anthropic48AdaptiveBody)
  assert.equal(anthropic48Conformance.manifest.reasoning.requestShape, 'anthropic-adaptive', 'provider conformance exposes Claude Opus 4.8 adaptive thinking')
  assert.equal(anthropic48Conformance.reasoning.providerValue, 'max', 'provider conformance preserves Claude Opus 4.8 max effort')
  assert.equal(anthropic48Conformance.manifest.payload.requiresReasoningStatePassthrough, true, 'provider conformance records Claude thinking block passthrough requirement')
  assert.equal(anthropic48Conformance.manifest.payload.reasoningStatePreservationField, 'anthropic-content-blocks', 'provider conformance records Claude thinking block preservation field')
  assert.equal(anthropic48Conformance.manifest.tools.supported, true, 'provider conformance exposes Claude Opus 4.8 native tool support')
  const anthropicManualBody = buildAnthropicBodyForTest({
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      name: 'Anthropic',
      [API_KEY_FIELD]: 'token-test-fake',
      models: ['claude-sonnet-4-20250514'],
      modelConfigs: [{ ...getModelConfig('claude-sonnet-4-20250514', 'anthropic'), reasoningMode: 'anthropic-thinking' }],
      enabled: true,
    },
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 4096,
  })
  assert.equal(anthropicManualBody.thinking.type, 'enabled', 'Older Claude thinking models use manual extended thinking')
  assert.ok(anthropicManualBody.thinking.budget_tokens < anthropicManualBody.max_tokens, 'Claude manual thinking budget stays below max_tokens')

  const baseSkill = createBaseSkill({
    id: 'skill-review',
    name: 'Code Review',
    systemPrompt: 'Review {{target}}. Output in {{language}}.',
    providerId: 'provider-local-only',
    model: 'local-model-only',
    variables: [
      { name: 'target', type: 'text', defaultValue: 'diff' },
      { name: 'language', type: 'text', defaultValue: 'Chinese' },
    ],
    priority: 10,
  })
  const advancedSkill = createBaseSkill({
    id: 'skill-json',
    name: 'JSON Output',
    layer: 'advanced',
    systemPrompt: 'Return concise JSON.',
    temperature: 0.2,
    enabledTools: ['app_info'],
    knowledgeSources: ['doc-1'],
    priority: 20,
  })
  const exportedSkill = exportSkill(baseSkill)
  const exportedSkillEnvelope = JSON.parse(exportedSkill)
  assert.equal(exportedSkillEnvelope.schema, 'islemind.skill.portable.v2', 'skill export uses the portable envelope schema')
  assert.equal(exportedSkillEnvelope.manifest.kind, 'skill', 'skill export manifest identifies regular skills')
  assert.equal(exportedSkillEnvelope.manifest.skillId, 'skill-review', 'skill export manifest records the skill id')
  assert.equal(exportedSkillEnvelope.manifest.hasProviderBinding, false, 'skill export manifest records provider binding absence')
  assert.equal(exportedSkillEnvelope.manifest.hasModelBinding, false, 'skill export manifest records model binding absence')
  assert.equal(exportedSkillEnvelope.manifest.providerBindingOmitted, true, 'skill export manifest records omitted provider binding')
  assert.equal(exportedSkillEnvelope.manifest.modelBindingOmitted, true, 'skill export manifest records omitted model binding')
  assert.equal(exportedSkillEnvelope.skill.providerId, undefined, 'skill export omits local provider bindings from portable payloads')
  assert.equal(exportedSkillEnvelope.skill.model, undefined, 'skill export omits local model bindings from portable payloads')
  assert.equal(exportedSkillEnvelope.skill.schema, 'islemind.skill.v1', 'skill export envelope carries the portable skill payload')
  const importedSkill = importSkill(exportedSkill)
  assert.equal(importedSkill.ok, true, 'imports .isleskill JSON')
  assert.equal(importedSkill.manifest?.schema, 'islemind.skill.portable.v2', 'skill import returns portable manifest metadata')
  assert.equal(importedSkill.manifest?.providerBindingOmitted, true, 'skill import preserves portable provider omission audit metadata')
  assert.equal(importedSkill.manifest?.modelBindingOmitted, true, 'skill import preserves portable model omission audit metadata')
  assert.equal(importedSkill.skill.providerId, undefined, 'skill import keeps portable provider binding omitted')
  assert.equal(importedSkill.skill.model, undefined, 'skill import keeps portable model binding omitted')
  const legacyImportedSkill = importSkill(JSON.stringify(baseSkill))
  assert.equal(legacyImportedSkill.ok, true, 'imports legacy raw .isleskill JSON')
  assert.equal(legacyImportedSkill.manifest?.kind, 'skill', 'legacy raw skill imports synthesize portable manifest metadata')
  assert.equal(legacyImportedSkill.manifest?.providerBindingOmitted, true, 'legacy raw skill imports report omitted provider binding')
  assert.equal(legacyImportedSkill.manifest?.modelBindingOmitted, true, 'legacy raw skill imports report omitted model binding')
  assert.equal(legacyImportedSkill.skill.providerId, undefined, 'legacy raw skill imports do not inherit external provider binding')
  assert.equal(legacyImportedSkill.skill.model, undefined, 'legacy raw skill imports do not inherit external model binding')
  assert.equal(renderSkillTemplate('Hello {{name}}', { name: 'IsleMind' }), 'Hello IsleMind')
  const skillApplied = applySkillStack({
    skills: [advancedSkill, baseSkill],
    variables: { target: 'provider sync', language: 'Japanese' },
  })
  assert.ok(skillApplied.snapshot.systemPrompt.includes('Review provider sync'), 'renders skill variables')
  assert.ok(skillApplied.snapshot.systemPrompt.includes('Return concise JSON'), 'stacks multiple prompts')
  assert.deepEqual(skillApplied.conversationUpdates.enabledTools, ['app_info'])
  assert.deepEqual(skillApplied.conversationUpdates.knowledgeSources, ['doc-1'])
  assert.equal(skillApplied.conversationUpdates.temperature, 0.2)

  const chunks = splitTextIntoSentenceChunks('第一句。第二句很短。第三句继续说明。Fourth sentence. Fifth sentence.', 18)
  assert.ok(chunks.length >= 2, 'sentence chunker splits long text')
  assert.ok(chunks.every((chunk) => /[。.!?]$/.test(chunk.content.trim())), 'chunks retain sentence endings')
  assert.ok(chunks.some((chunk) => chunk.sentenceStart > 0 && chunk.content.includes('第二句很短。')), 'chunks use sentence overlap windows')
  const reranked = rerankRetrievalSources('alpha beta', [
    { id: 'old', type: 'knowledge', title: 'Old', content: 'gamma delta', score: 0.9, chunkIndex: 10 },
    { id: 'match', type: 'knowledge', title: 'Alpha', content: 'alpha beta beta', score: 0.2, chunkIndex: 0 },
  ], 2)
  assert.equal(reranked[0].id, 'match', 'local rerank promotes token overlap and early chunks')
  assert.ok(buildCompressedContextPrompt(reranked).includes('[1]'), 'compressed context includes citation labels')
  const ragPlan = createRagQueryPlan({
    query: '比较 Alpha 和 Beta 的配置差异，并分析迁移风险？',
    settings: {
      language: 'zh-CN',
      ragMode: 'hybrid',
      ragProfile: 'balanced',
      ragQueryRewriteEnabled: true,
      ragHydeEnabled: true,
      ragRaptorEnabled: true,
      ragGraphEnabled: true,
      ragCrossEncoderEnabled: true,
    },
    now: 1234,
  })
  assert.equal(ragPlan.complexity, 'complex', 'agentic planner detects multi-hop queries')
  assert.ok(ragPlan.enabledTechniques.includes('query-rewriting'), 'balanced complex queries enable rewriting')
  assert.ok(ragPlan.enabledTechniques.includes('hyde'), 'balanced complex queries enable HyDE')
  assert.ok(ragPlan.enabledTechniques.includes('graphrag'), 'complex queries enable GraphRAG planning')
  const packedRag = packRagContext(ragPlan, [
    { id: 'rag-a', candidateId: 'a', origin: 'knowledge', type: 'knowledge', title: 'Alpha', content: 'Alpha uses local indexes. Beta uses remote reranking. Migration risk is token budget pressure.', score: 0.91, rerankScore: 0.91, chunkIndex: 0 },
    { id: 'rag-b', candidateId: 'b', origin: 'hyde', type: 'knowledge', title: 'Beta', content: 'Beta requires fallback when cross encoder models are missing. Citation coverage should stay explicit.', score: 0.83, rerankScore: 0.83, chunkIndex: 1 },
  ], 400)
  assert.ok(packedRag.contextPrompt.includes('[1]'), 'agentic pack injects numbered citations')
  assert.equal(packedRag.citations.length, 2, 'agentic pack returns citation metadata')
  assert.ok(packedRag.quality.confidence > 0, 'agentic pack evaluates quality')
  assert.ok(packedRag.trace.some((step) => step.stage === 'verify'), 'agentic pack emits a verification trace')
  assert.ok(packedRag.citations.every((citation) => citation.label && citation.rerankScore !== undefined), 'citations carry labels and rerank details')
  const agentic = await runAgenticRag({
    query: 'Why does Alpha migration fail and what evidence supports the fix?',
    settings: {
      language: 'en',
      ragMode: 'hybrid',
      ragProfile: 'deep',
      ragQueryRewriteEnabled: true,
      ragHydeEnabled: true,
      ragFlareEnabled: true,
      ragCrossEncoderEnabled: true,
      ragColbertEnabled: true,
      ragLlmlinguaEnabled: true,
    },
    memorySources: [{ id: 'mem-a', type: 'memory', title: 'Memory', content: 'Alpha migration failed because indexes were stale.', excerpt: 'Alpha migration failed because indexes were stale.' }],
    retrieveKnowledge: async (query, limit) => [
      { id: `k-${query.length}-${limit}`, type: 'knowledge', title: 'Migration note', content: `Evidence for ${query}: rebuild indexes and verify citations.`, score: 0.7, chunkIndex: 0 },
    ],
    retrieveAgentic: async (_query, plan, limit) => plan.enabledTechniques.includes('colbert')
      ? [
          { id: `colbert-${limit}`, type: 'knowledge', title: 'ColBERT-lite note', content: 'Token max-sim evidence remains available without a downloaded ColBERT model.', score: 0.68, sourceReason: 'colbert-token-maxsim' },
        ]
      : [],
    now: () => 1234,
  })
  assert.ok(agentic.trace.some((step) => step.stage === 'retrieve'), 'agentic RAG records retrieval trace')
  assert.ok(agentic.trace.some((step) => step.stage === 'pack'), 'agentic RAG records pack trace')
  assert.ok(agentic.quality.sourceCount >= 1, 'agentic RAG returns usable sources')
  assert.ok(agentic.contextPrompt.includes('[1]'), 'agentic RAG context prompt preserves citation injection')
  assert.ok(agentic.trace.find((step) => step.stage === 'retrieve').metadata.advancedCandidates >= 1, 'agentic RAG merges advanced index candidates')
  assert.ok(agentic.sources.some((source) => source.origin === 'colbert'), 'advanced retrieval origin is preserved')
  const flareCheck = verifyRagGeneration({
    answer: 'Alpha migration failed because a hidden cache invalidated production traffic. Beta recovery requires a server restart.',
    query: 'Why does Alpha migration fail and what evidence supports the fix?',
    citations: agentic.citations,
    quality: { ...agentic.quality, confidence: 0.2, citationCoverage: 0.1 },
  })
  assert.equal(flareCheck.needsFlare, true, 'FLARE is requested for low-confidence unsupported generations')
  assert.ok(flareCheck.followupQuery.includes('补充证据'), 'FLARE follow-up query asks for additional evidence')
  const goldRun = await runRagGoldEvaluation({
    language: 'en',
    ragMode: 'hybrid',
    ragProfile: 'deep',
    ragQueryRewriteEnabled: true,
    ragHydeEnabled: true,
    ragRaptorEnabled: true,
    ragGraphEnabled: true,
    ragColbertEnabled: true,
    ragCrossEncoderEnabled: true,
    ragLlmlinguaEnabled: true,
  })
  assert.equal(goldRun.cases.length, 3, 'built-in RAG gold evaluation covers the bundled cases')
  assert.ok(goldRun.averageConfidence > 0, 'built-in RAG gold evaluation reports confidence')
  assert.ok(goldRun.fallbackReasons.includes('cross-encoder-model-unavailable'), 'gold evaluation records model fallback reasons')
  assert.equal(await createOnnxPlaceholderProvider().available(), false, 'ONNX placeholder stays disabled')
  assert.ok(LOCAL_EMBEDDING_MODELS.some((model) => model.id === 'all-MiniLM-L6-v2'), 'local embedding catalog exposes MiniLM')
  assert.ok(modelCatalog.models.every((model) => model.sourceUrl && model.publisher && model.upstreamModel && model.license), 'model catalog includes source and attribution metadata')
  assert.ok(modelCatalog.models.some((model) => model.capability === 'reranker' && model.files.length === 0), 'reranker capability placeholder is cataloged without bundling files')
  assert.ok(modelCatalog.models.some((model) => model.capability === 'colbert' && model.files.length === 0), 'ColBERT capability placeholder is cataloged without bundling files')
  assert.ok(modelCatalog.models.some((model) => model.capability === 'compressor' && model.files.length === 0), 'compressor capability placeholder is cataloged without bundling files')
  assert.deepEqual(modelCatalog.variants['no-model'].bundledModels, [], 'no-model variant does not bundle embeddings')
  assert.deepEqual(modelCatalog.variants['with-model-small'].bundledModels, ['all-MiniLM-L6-v2'], 'with-model-small bundles only MiniLM')
  assert.equal(
    modelCatalog.models.find((model) => model.id === 'all-MiniLM-L6-v2').files.reduce((sum, file) => sum + file.bytes, 0),
    modelCatalog.models.find((model) => model.id === 'all-MiniLM-L6-v2').sizeBytes,
    'catalog model size matches file sum'
  )
  assert.equal(formatModelBytes(1024 * 1024), '1.0 MB')
  assert.ok(localModelCacheKey({ localEmbeddingModelId: 'all-MiniLM-L6-v2', localEmbeddingModelSource: 'downloaded' }).includes('downloaded'))
  const textEncoder = new TextEncoder()
  const apkManifestFixture = {
    versionName: '1.0.7',
    versionCode: 107,
    publishedAt: '2026-06-05T00:00:00Z',
    releaseUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
    assets: [
      {
        abi: 'universal-64',
        variant: 'no-model',
        name: 'IsleMind-1.0.7-universal-64-no-model.apk',
        url: 'https://example.test/IsleMind-1.0.7-universal-64-no-model.apk',
        sha256: '1'.repeat(64),
        sizeBytes: 300,
      },
      {
        abi: 'arm64-v8a',
        variant: 'with-model-small',
        name: 'IsleMind-1.0.7-arm64-v8a-with-model-small.apk',
        url: 'https://example.test/IsleMind-1.0.7-arm64-v8a-with-model-small.apk',
        sha256: '2'.repeat(64),
        sizeBytes: 200,
      },
      {
        abi: 'arm64-v8a',
        variant: 'no-model',
        name: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
        url: 'https://example.test/IsleMind-1.0.7-arm64-v8a-no-model.apk',
        sha256: '3'.repeat(64),
        sizeBytes: 100,
      },
    ],
  }
  const selectedManifestRelease = normalizeApkUpdateManifestForTest(apkManifestFixture, ['arm64-v8a', 'armeabi-v7a'])
  assert.ok(selectedManifestRelease, 'APK manifest produces a selected release')
  assert.equal(selectedManifestRelease.apkName, 'IsleMind-1.0.7-arm64-v8a-no-model.apk', 'APK manifest selects the device arm64 no-model asset')
  assert.equal(selectedManifestRelease.versionCode, 107, 'APK manifest preserves Android versionCode')
  assert.equal(selectedManifestRelease.sha256, '3'.repeat(64), 'APK manifest preserves selected asset checksum')
  const unknownAbiAsset = selectApkAssetForTest(apkManifestFixture.assets, ['riscv64'])
  assert.ok(unknownAbiAsset, 'APK asset selection returns a fallback asset for unknown ABIs')
  assert.equal(unknownAbiAsset.abi, 'universal-64', 'unknown device ABI falls back to universal-64 no-model')
  assert.ok(
    compareReleaseToSnapshotForTest(
      {
        version: '1.0.6',
        versionCode: 107,
        tagName: 'v1.0.6',
        name: 'IsleMind 1.0.6',
        htmlUrl: 'https://example.test/release',
        apkUrl: 'https://example.test/app.apk',
        apkName: 'app.apk',
        publishedAt: null,
      },
      { appVersion: '9.9.9', buildVersion: '106', updateMode: 'apk', hotUpdateMode: 'disabled' }
    ) > 0,
    'APK update comparison uses versionCode before versionName'
  )
  assert.equal(shouldRecordApkUpdateCheck({ status: 'available', message: '' }), true, 'available update checks update the last-check timestamp')
  assert.equal(shouldRecordApkUpdateCheck({ status: 'unavailable', message: '' }), true, 'unavailable update checks update the last-check timestamp')
  assert.equal(shouldRecordApkUpdateCheck({ status: 'error', message: '', reason: 'network' }), false, 'failed update checks do not update the last-check timestamp')

  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const originalFetchForApk = global.fetch
  const updateFetchUrls = []
  global.fetch = async (url) => {
    updateFetchUrls.push(String(url))
    if (String(url).includes('raw.githubusercontent.com')) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.0.7',
        name: 'IsleMind 1.0.7',
        html_url: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
        published_at: '2026-06-05T00:00:00Z',
        assets: [
          {
            name: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
            browser_download_url: 'https://example.test/IsleMind-1.0.7-arm64-v8a-no-model.apk',
            size: 123,
          },
        ],
      }),
    }
  }
  try {
    const fallbackUpdate = await checkLatestApkRelease()
    assert.equal(fallbackUpdate.status, 'available', 'GitHub Release API remains the fallback when the manifest is unavailable')
    assert.ok(fallbackUpdate.release, 'GitHub fallback returns release metadata for available updates')
    assert.equal(fallbackUpdate.release.apkName, 'IsleMind-1.0.7-arm64-v8a-no-model.apk', 'GitHub fallback still selects the device ABI APK')
    assert.ok(updateFetchUrls[0].includes('/updates/android.json'), 'APK update check tries the static manifest first')
    assert.ok(updateFetchUrls[1].includes('/repos/domidoremi/IsleMind/releases/latest'), 'APK update check falls back to the GitHub latest API')
  } finally {
    global.fetch = originalFetchForApk
    reactNativePlatform.OS = 'test'
  }

  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  expoDeviceModuleAvailable = false
  const originalFetchForNoDeviceModule = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => apkManifestFixture,
  })
  try {
    const noDeviceModuleUpdate = await checkLatestApkRelease()
    assert.equal(noDeviceModuleUpdate.status, 'available', 'missing ExpoDevice native module does not crash APK update checks')
    assert.ok(noDeviceModuleUpdate.release, 'missing ExpoDevice native module still returns selected release metadata')
    assert.equal(noDeviceModuleUpdate.release.apkName, 'IsleMind-1.0.7-universal-64-no-model.apk', 'missing ExpoDevice native module uses unknown-ABI universal fallback')
  } finally {
    global.fetch = originalFetchForNoDeviceModule
    expoDeviceModuleAvailable = true
    reactNativePlatform.OS = 'test'
  }

  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const corruptApkBody = Buffer.from('not the expected apk')
  const corruptApkUrl = 'https://example.test/corrupt.apk'
  localDownloadFixtures.set(corruptApkUrl, { status: 200, body: corruptApkBody })
  const checksumResult = await downloadAndOpenApkInstaller({
    version: '1.0.7',
    versionCode: 107,
    tagName: 'v1.0.7',
    name: 'IsleMind 1.0.7',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
    apkUrl: corruptApkUrl,
    apkName: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
    publishedAt: null,
    sha256: '0'.repeat(64),
    sizeBytes: corruptApkBody.length,
    abi: 'arm64-v8a',
    variant: 'no-model',
  })
  assert.equal(checksumResult.status, 'error', 'APK checksum mismatch is reported as an update error')
  assert.equal(checksumResult.reason, 'checksum_mismatch', 'APK checksum mismatch carries the checksum_mismatch reason')
  assert.equal(launchedIntents.length, 0, 'APK checksum mismatch blocks Android installer launch')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.endsWith('IsleMind-1.0.7-arm64-v8a-no-model.apk')),
    'APK checksum mismatch deletes the cached APK'
  )
  reactNativePlatform.OS = 'test'

  assert.equal(
    sha256BytesForTest(textEncoder.encode('')),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'local model checksum handles empty files with the JS SHA-256 fallback'
  )
  assert.equal(
    sha256BytesForTest(textEncoder.encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'local model checksum handles a single SHA-256 block'
  )
  assert.equal(
    sha256BytesForTest(textEncoder.encode('a'.repeat(1000))),
    '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    'local model checksum handles multi-block downloaded files'
  )
  assert.equal(
    sha256ChunksForTest([
      textEncoder.encode('a'.repeat(13)),
      textEncoder.encode('a'.repeat(987)),
    ]),
    '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    'local model checksum handles incremental file chunks'
  )
  const miniLm = modelCatalog.models.find((model) => model.id === 'all-MiniLM-L6-v2')
  resetLocalModelFileMocks()
  for (const file of miniLm.files) {
    localFileFixtures.set(
      `file:///tmp/islemind-models/all-MiniLM-L6-v2/${file.path}`,
      fs.readFileSync(localModelFixturePath('all-MiniLM-L6-v2', file.path))
    )
  }
  assert.equal(await verifyLocalEmbeddingModel('all-MiniLM-L6-v2', 'downloaded'), true, 'downloaded MiniLM fixture verifies size and SHA-256 from catalog')
  assert.ok(
    localFileReadRequests.some((request) => request.uri.endsWith('/onnx/model_quantized.onnx') && request.position > 0),
    'large local model files are verified through multiple file chunks'
  )
  assert.ok(
    localFileReadRequests.every((request) => request.encoding === 'base64' && request.length <= 1024 * 1024),
    'local model verification reads bounded base64 chunks'
  )
  resetLocalModelFileMocks()
  memoryStorage.delete('@islemind/local-embedding-models')
  for (const file of miniLm.files) {
    localDownloadFixtures.set(
      localModelDownloadUrl(miniLm, file.path),
      { status: 200, body: fs.readFileSync(localModelFixturePath(miniLm.id, file.path)) }
    )
  }
  const downloadProgress = []
  const downloadedMiniLm = await downloadLocalEmbeddingModel(miniLm.id, {
    onProgress: (event) => downloadProgress.push(event),
  })
  assert.equal(downloadedMiniLm.modelId, miniLm.id, 'download flow records the downloaded model id')
  assert.equal(downloadedMiniLm.source, 'downloaded', 'download flow records downloaded source')
  assert.equal(downloadedMiniLm.bytes, miniLm.sizeBytes, 'download flow records the verified byte total')
  assert.deepEqual(downloadedMiniLm.sha256, Object.fromEntries(miniLm.files.map((file) => [file.path, file.sha256])), 'download flow stores catalog SHA-256 values')
  assert.ok(
    ['preparing', 'downloading', 'verifying', 'finalizing'].every((stage) => downloadProgress.some((event) => event.stage === stage)),
    'download flow emits preparing/downloading/verifying/finalizing progress'
  )
  assert.equal(downloadProgress.at(-1).percent, 100, 'download flow ends at 100 percent')
  assert.ok(
    miniLm.files.every((file) => localFileFixtures.has(`file:///tmp/islemind-models/${miniLm.id}/${file.path}`)),
    'download flow moves all verified files into the final model directory'
  )
  assert.ok(
    ![...localFileFixtures.keys()].some((uri) => uri.includes(`${miniLm.id}.tmp-`)),
    'download flow leaves no temporary model files after success'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'download' && operation.url === localModelDownloadUrl(miniLm, 'onnx/model_quantized.onnx')),
    'download flow uses the official model file URL'
  )
  assert.ok(localFileOperations.some((operation) => operation.type === 'move'), 'download flow atomically moves the temporary directory into place')
  const downloadedViews = await listLocalEmbeddingModelViews({
    localEmbeddingModelId: miniLm.id,
    localEmbeddingModelSource: 'downloaded',
  })
  assert.equal(downloadedViews.find((view) => view.model.id === miniLm.id).status, 'enabled', 'successful download appears as enabled when selected')

  resetLocalModelFileMocks()
  memoryStorage.delete('@islemind/local-embedding-models')
  const mirrorBaseUrl = 'https://mirror.example/hf'
  for (const file of miniLm.files) {
    localDownloadFixtures.set(localModelDownloadUrl(miniLm, file.path), { status: 503, body: Buffer.alloc(0) })
    localDownloadFixtures.set(
      localModelMirrorUrl(miniLm, mirrorBaseUrl, file.path),
      { status: 200, body: fs.readFileSync(localModelFixturePath(miniLm.id, file.path)) }
    )
  }
  const mirrorProgress = []
  const mirroredMiniLm = await downloadLocalEmbeddingModel(miniLm.id, {
    mirrorBaseUrl,
    onProgress: (event) => mirrorProgress.push(event),
  })
  assert.equal(mirroredMiniLm.bytes, miniLm.sizeBytes, 'mirror retry verifies the downloaded model')
  assert.ok(mirrorProgress.some((event) => event.stage === 'retrying'), 'mirror retry emits retrying progress after official failure')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'download' && operation.status === 503),
    'mirror retry records the official failure before falling back'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'download' && operation.url === localModelMirrorUrl(miniLm, mirrorBaseUrl, 'config.json')),
    'mirror retry uses the configured mirror URL shape'
  )

  resetLocalModelFileMocks()
  memoryStorage.delete('@islemind/local-embedding-models')
  for (const file of miniLm.files) {
    const body = fs.readFileSync(localModelFixturePath(miniLm.id, file.path))
    localDownloadFixtures.set(localModelDownloadUrl(miniLm, file.path), {
      status: 200,
      body: file.path === 'tokenizer.json' ? Buffer.from('bad checksum') : body,
    })
  }
  await assert.rejects(
    () => downloadLocalEmbeddingModel(miniLm.id),
    /Downloaded file size mismatch|Downloaded file checksum mismatch/,
    'download flow rejects corrupted model files'
  )
  assert.ok(
    ![...localFileFixtures.keys()].some((uri) => uri.includes(`${miniLm.id}.tmp-`)),
    'download failure cleans temporary model files'
  )
  assert.ok(
    !miniLm.files.some((file) => localFileFixtures.has(`file:///tmp/islemind-models/${miniLm.id}/${file.path}`)),
    'download failure does not publish partial files into the final directory'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes(`${miniLm.id}.tmp-`)),
    'download failure deletes the temporary directory'
  )
  const failedViews = await listLocalEmbeddingModelViews({
    localEmbeddingModelId: null,
    localEmbeddingModelSource: 'none',
  })
  assert.equal(failedViews.find((view) => view.model.id === miniLm.id).status, 'verify-failed', 'download failure marks the model as needing attention')
  assert.equal(await createOnnxEmbeddingProvider({ localEmbeddingModelSource: 'none' }), null, 'ONNX provider is absent without bundled or downloaded model')

  const builtin = builtinMcpServer()
  assert.equal(builtin.transport, 'sse')
  assert.equal(builtin.tools.find((tool) => tool.name === 'app_info').permission, 'read-only')
  const appInfo = await callMcpTool(builtin, 'app_info', {})
  assert.equal(appInfo.ok, true, 'built-in MCP app_info works without network')
  assert.ok(appInfo.content[0].text.includes('stdio is disabled'), 'MCP app_info states mobile transport boundary')
  const truncated = truncateToolBlocks([{ type: 'text', text: 'x'.repeat(2000) }], 50)
  assert.ok(truncated[0].text.length < 1000, 'MCP tool output is truncated to budget')
}

run()
  .then(() => {
    console.log('provider-intelligence tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
