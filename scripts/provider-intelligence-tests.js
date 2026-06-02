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
      downloadAsync: async (_url, uri) => ({ status: 200, uri, headers: {}, mimeType: null }),
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
      Platform: { OS: 'test', select: (choices) => choices?.default },
      NativeModules: {},
      StyleSheet: { create: (styles) => styles },
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
  resolveProxyPolicyForTest,
  resolveRuntimeFallbackPlanForTest,
  selectUpstreamTransportForTest,
  streamChat,
  testProviderModelDetailed,
} = require('../src/services/ai/base.ts')
const { runResponsesWebSocketTransport } = require('../src/services/ai/transport/responsesWebSocketTransport.ts')
const { activeSessionLeaseCount, acquireSessionLease } = require('../src/services/ai/transport/sessionLeasePool.ts')
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
const { buildProviderActivationTestCandidatesForTest, summarizeProviderActivation } = require('../src/services/providerActivation.ts')
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
const { buildWorkspaceReadiness } = require('../src/utils/workspaceReadiness.ts')
const { summarizeWorkArtifact } = require('../src/utils/workArtifact.ts')
const { getReasoningEffortOptions } = require('../src/utils/modelReasoning.ts')
const {
  getOnboardingCompanionProfile,
  getOnboardingConversationDefaults,
  getOnboardingSettingsDefaults,
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
  getProviderModelDisplayCandidates,
} = require('../src/services/ai/policy/providerModelAccess.ts')
const { deriveHomePetState } = require('../src/components/mascot/petState.ts')
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
  assert.equal(architectureBoundaryResult.summary.checks, 10, 'architecture boundary audit includes review budget enforcement')
  assert.equal(architectureBoundaryResult.summary.blockingIssues, 0, 'architecture boundary audit has no blocking issues')
  assert.equal(architectureBoundaryResult.summary.reviewFindings, 0, 'architecture boundary audit has no current provider presentation review surfaces')
  for (const id of [
    'provider-transport-boundary',
    'context-pipeline-boundary',
    'local-model-strategy-boundary',
    'migration-recovery-boundary',
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
    ['all', 'gpt', 'claude', 'gemini', 'deepseek', 'qwen', 'kimi', 'doubao', 'grok', 'glm', 'mimo', 'llama', 'other'],
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

  const readmeChecks = [
    {
      file: 'README.md',
      markers: ['structured work artifacts', 'quality gates', 'copyable handoffs', 'continuation prompts'],
    },
    {
      file: 'README.zh-CN.md',
      markers: ['结构化工作产物', '质量门槛', '可复制交接', '继续执行提示'],
    },
    {
      file: 'README.ja.md',
      markers: ['構造化作業成果', '品質ゲート', 'コピー可能な引き継ぎ', '継続プロンプト'],
    },
  ]
  for (const { file, markers } of readmeChecks) {
    const readme = fs.readFileSync(path.join(root, file), 'utf8')
    assert.ok(
      readme.includes(`\`${packageJson.version}\``),
      `${file} documents the current app version ${packageJson.version}`
    )
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
  const info = await getRuntimeLogInfo()
  assert.equal(info.exists, true, 'runtime log info detects the current log file')
  assert.equal(info.path, uri, 'runtime log info returns the same path')
  assert.ok((await readRuntimeLogText()).includes('compact.usage'), 'runtime log tail reads recent events')
  await clearRuntimeLog()
  assert.equal(localFileFixtures.has(uri), false, 'runtime log clear deletes the log file')
}

async function assertRuntimeDiagnosticsBehavior() {
  clearCompactUsageRecords()
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 1000, outputTokens: 120, estimatedSavedTokens: 430 })
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
  assert.equal(summary.compact.requestCount, 2, 'runtime diagnostics counts compact usage records')
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
      modelTestBodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
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
    models: ['blocked-chat', 'gpt-5.5-mini'],
    manualModels: ['manual-chat'],
    modelAliases: [{ alias: 'fast', model: 'gpt-5.5-mini' }],
    enabled: true,
    lastTestStatus: 'ok',
    lastTestModel: 'gpt-5.5-mini',
    credentialGroups: [
      { id: 'policy-group', label: 'Policy Group', apiKey: FAKE_KEY_B, enabled: true, lastModelSyncStatus: 'ok', availableModels: ['blocked-chat', 'gpt-5.5-mini', 'fast'] },
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

  const groups = parseCredentialGroups('sk-a\n\nsk-b, sk-c')
  assert.deepEqual(groups.map((group) => group.label), ['令牌分组 1', '令牌分组 2', '令牌分组 3'])
  assert.ok(groups.every((group) => group.enabled), 'parsed groups are enabled by default')
  assert.equal(maskSecret('token-fake-1234567890'), 'toke...7890')
  setServiceLanguage('en')
  assert.equal(st('apiKeyPanel.groupName', { index: 1 }), 'Token group 1', 'service i18n follows language changes')
  assert.equal(st('chat.starterPlanLabel'), 'Plan today', 'service i18n exposes work starter labels')
  assert.equal(st('chat.commandWorkStarterDescription'), 'Insert a structured work template', 'command palette exposes work starter descriptions')
  assert.equal(st('messageBubble.copyWorkArtifact'), 'Copy work artifact', 'message actions expose work artifact copy')
  assert.equal(st('messageBubble.copyWorkArtifactCopied'), 'Work artifact copied to clipboard.', 'message actions confirm copied work artifacts')
  assert.equal(st('messageBubble.continueWorkArtifact'), 'Continue work', 'message actions expose work artifact continuation')
  assert.equal(st('messageBubble.continueWorkArtifactInserted'), 'Continuation prompt inserted.', 'message actions confirm inserted continuation prompts')
  assert.ok(st('chat.starterCompareDraft').includes('Output must include'), 'work starter drafts define an output contract')
  assert.ok(st('chat.starterBriefDraft').includes('A short version'), 'work starters include a shareable project brief flow')
  assert.ok(st('onboarding.firstPrompt.samples.engineering').includes('Verification command or evidence'), 'onboarding first prompt seeds structured productivity drafts')
  assert.ok(st('onboarding.firstPrompt.samples.organize').includes('A version I can copy'), 'onboarding organize prompt produces a shareable work artifact')
  assert.equal(st('chatRunner.trace.compactPolicyTitle'), 'Compact policy', 'chat runner exposes compact policy trace label')
  assert.equal(st('chatRunner.error.remoteCompactRequiredFailed'), 'Remote compact is required, but the current provider does not declare support.', 'chat runner exposes remote compact required failure text')
  assert.equal(st('providerTrace.runtimeGovernanceTitle'), 'Runtime policy', 'provider trace exposes runtime governance trace label')
  assert.equal(st('providerTrace.runtimeFallbackTitle'), 'Runtime fallback', 'provider trace exposes runtime fallback trace label')
  ;[
    'chat.starterPlanDraft',
    'chat.starterNotesDraft',
    'chat.starterCompareDraft',
    'chat.starterBriefDraft',
    'onboarding.firstPrompt.samples.concise',
    'onboarding.firstPrompt.samples.research',
    'onboarding.firstPrompt.samples.engineering',
    'onboarding.firstPrompt.samples.organize',
    'onboarding.firstPrompt.samples.plan',
  ].forEach((key) => assertStructuredWorkTemplate(st(key), key, 'en'))
  setServiceLanguage('ja')
  assert.equal(st('search.disabled'), 'Web 検索は無効です。', 'service i18n supports Japanese resources')
  assert.equal(st('chat.starterNotesLabel'), 'メモを整理', 'Japanese resources expose work starter labels')
  assert.equal(st('chat.commandWorkStarterDescription'), '構造化された作業テンプレートを挿入', 'Japanese command palette exposes work starter descriptions')
  assert.equal(st('messageBubble.copyWorkArtifact'), '作業成果をコピー', 'Japanese message actions expose work artifact copy')
  assert.equal(st('messageBubble.continueWorkArtifact'), 'この作業を続ける', 'Japanese message actions expose work artifact continuation')
  assert.ok(st('chat.starterBriefDraft').includes('協力者に送れる短い版'), 'Japanese work starter drafts include the project brief flow')
  assert.ok(st('onboarding.firstPrompt.samples.plan').includes('決定ログ'), 'Japanese onboarding first prompt produces parser-recognizable work artifacts')
  ;[
    'chat.starterPlanDraft',
    'chat.starterNotesDraft',
    'chat.starterCompareDraft',
    'chat.starterBriefDraft',
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
      settings: { transportMode: 'websocket' },
      hasWebSocketRuntime: true,
    }).fallbackReason,
    'provider_capability_missing',
    'transport selector falls back when provider WebSocket capability is missing'
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
  assert.equal(st('chat.starterPlanLabel'), '安排今天', 'Chinese resources expose work starter labels')
  assert.equal(st('chat.commandWorkStarterDescription'), '插入结构化工作模板', 'Chinese command palette exposes work starter descriptions')
  assert.equal(st('messageBubble.copyWorkArtifact'), '复制工作产物', 'Chinese message actions expose work artifact copy')
  assert.equal(st('messageBubble.continueWorkArtifact'), '继续这项工作', 'Chinese message actions expose work artifact continuation')
  assert.ok(st('chat.starterBriefDraft').includes('可直接发给协作者'), 'Chinese work starter drafts include the project brief flow')
  assert.ok(st('onboarding.firstPrompt.samples.research').includes('输出必须包含'), 'Chinese onboarding first prompt remains structured')
  ;[
    'chat.starterPlanDraft',
    'chat.starterNotesDraft',
    'chat.starterCompareDraft',
    'chat.starterBriefDraft',
    'onboarding.firstPrompt.samples.concise',
    'onboarding.firstPrompt.samples.research',
    'onboarding.firstPrompt.samples.engineering',
    'onboarding.firstPrompt.samples.organize',
    'onboarding.firstPrompt.samples.plan',
  ].forEach((key) => assertStructuredWorkTemplate(st(key), key, 'zh'))

  const chatWorkspaceSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  assert.ok(chatWorkspaceSource.includes('const workStarterCommands = WORK_STARTERS.map'), 'chat command palette derives commands from work starters')
  assert.ok(chatWorkspaceSource.includes("id: `work-starter-${starter.id}`"), 'work starter command ids are stable and namespaced')
  assert.ok(chatWorkspaceSource.includes("description: t('chat.commandWorkStarterDescription')"), 'work starter commands use localized descriptions')
  assert.ok(chatWorkspaceSource.includes('insertText: t(starter.draftKey)'), 'work starter commands insert the structured draft text')
  assert.ok(chatWorkspaceSource.includes("import { summarizeWorkArtifact } from '@/utils/workArtifact'"), 'chat workspace imports work artifact summarization')
  assert.ok(chatWorkspaceSource.includes('summarizeWorkArtifact(item.responseText ?? item.content)'), 'chat workspace summarizes assistant output before copying work artifacts')
  assert.ok(chatWorkspaceSource.includes('Clipboard.setStringAsync(workArtifact.handoffText)'), 'chat workspace copies the work artifact handoff package')
  assert.ok(!chatWorkspaceSource.includes('Clipboard.setStringAsync(workArtifact.shareableText)'), 'chat workspace does not copy the weaker shareable summary for work artifact handoff')
  assert.ok(chatWorkspaceSource.includes('onApplyStarter(workArtifact.followUpPrompt)'), 'chat workspace inserts work artifact continuation prompts into the composer')
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
- npm run type-check -- --incremental false

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
  const readyWorkspace = buildWorkspaceReadiness({
    providers: [testedReadyProvider],
    settings: {
      memoryEnabled: true,
      knowledgeEnabled: true,
      ragMode: 'hybrid',
      webSearchEnabled: true,
      searchProvider: 'native',
      autoUpdateCheckEnabled: true,
    },
    contextHealth: {
      loading: false,
      memoryCount: 3,
      activeMemoryCount: 2,
      pendingMemoryCount: 1,
      knowledgeDocumentCount: 2,
      knowledgeChunkCount: 12,
      failedKnowledgeDocumentCount: 0,
    },
  })
  assert.equal(readyWorkspace.readyCount, 5, 'workspace readiness counts every configured AI productivity capability')
  assert.equal(readyWorkspace.totalCount, 5, 'workspace readiness exposes the full settings checklist')
  assert.deepEqual(
    Object.fromEntries(readyWorkspace.items.map((item) => [item.key, item.status])),
    {
      provider: 'ready',
      memory: 'ready',
      knowledge: 'ready',
      search: 'ready',
      recovery: 'ready',
    },
    'workspace readiness marks configured providers, memory, knowledge, search, and recovery as ready'
  )
  assert.equal(
    readyWorkspace.items.find((item) => item.key === 'provider')?.metrics.readyProviders,
    1,
    'workspace readiness reports the number of chat-ready providers'
  )
  assert.equal(
    readyWorkspace.items.find((item) => item.key === 'search')?.metrics.searchProvider,
    'native',
    'workspace readiness reports the resolved search provider'
  )
  assert.equal(readyWorkspace.primaryAction, null, 'workspace readiness has no primary action when every capability is ready')
  const pendingOnlyMemoryWorkspace = buildWorkspaceReadiness({
    providers: [testedReadyProvider],
    settings: {
      memoryEnabled: true,
      knowledgeEnabled: true,
      ragMode: 'hybrid',
      webSearchEnabled: true,
      searchProvider: 'native',
      autoUpdateCheckEnabled: true,
    },
    contextHealth: {
      loading: false,
      memoryCount: 2,
      activeMemoryCount: 0,
      pendingMemoryCount: 2,
      knowledgeDocumentCount: 2,
      knowledgeChunkCount: 12,
      failedKnowledgeDocumentCount: 0,
    },
  })
  assert.equal(
    pendingOnlyMemoryWorkspace.items.find((item) => item.key === 'memory')?.status,
    'review',
    'workspace readiness does not mark pending-only memories ready because pending memories are excluded from chat retrieval'
  )
  assert.equal(
    pendingOnlyMemoryWorkspace.primaryAction?.key,
    'memory',
    'workspace readiness points pending-only memory users to memory review as the next best action'
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
  const emptyContextWorkspace = buildWorkspaceReadiness({
    providers: [testedReadyProvider],
    settings: {
      memoryEnabled: true,
      knowledgeEnabled: true,
      ragMode: 'hybrid',
      webSearchEnabled: true,
      searchProvider: 'native',
      autoUpdateCheckEnabled: true,
    },
    contextHealth: {
      loading: false,
      memoryCount: 0,
      activeMemoryCount: 0,
      pendingMemoryCount: 0,
      knowledgeDocumentCount: 0,
      knowledgeChunkCount: 0,
      failedKnowledgeDocumentCount: 0,
    },
  })
  assert.deepEqual(
    Object.fromEntries(emptyContextWorkspace.items.map((item) => [item.key, item.status])),
    {
      provider: 'ready',
      memory: 'review',
      knowledge: 'review',
      search: 'ready',
      recovery: 'ready',
    },
    'workspace readiness asks for review when memory and knowledge are enabled but empty'
  )
  const failedKnowledgeWorkspace = buildWorkspaceReadiness({
    providers: [testedReadyProvider],
    settings: {
      memoryEnabled: true,
      knowledgeEnabled: true,
      ragMode: 'hybrid',
      webSearchEnabled: true,
      searchProvider: 'native',
      autoUpdateCheckEnabled: true,
    },
    contextHealth: {
      loading: false,
      memoryCount: 1,
      activeMemoryCount: 1,
      pendingMemoryCount: 0,
      knowledgeDocumentCount: 1,
      knowledgeChunkCount: 8,
      failedKnowledgeDocumentCount: 1,
    },
  })
  assert.equal(
    failedKnowledgeWorkspace.items.find((item) => item.key === 'knowledge')?.status,
    'review',
    'workspace readiness asks for review when knowledge indexing has failures even if chunks exist'
  )
  assert.equal(
    failedKnowledgeWorkspace.primaryAction?.key,
    'knowledge',
    'workspace readiness prioritizes failed knowledge recovery ahead of lower-risk review items'
  )
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
  assert.equal(onboardingResearch.ragProfile, 'deep', 'research onboarding defaults to deep RAG')
  assert.equal(onboardingEngineering.reasoningEffort, 'high', 'engineering onboarding defaults to high reasoning')
  assert.equal(onboardingConcise.ragProfile, 'fast', 'concise onboarding favors fast retrieval')
  assert.ok(onboardingResearch.systemPrompt.includes('research partner'), 'research onboarding writes a role prompt')
  assert.ok(onboardingEngineering.systemPrompt.includes('engineering partner'), 'engineering onboarding writes a role prompt')
  const creativeConversationDefaults = getOnboardingConversationDefaults('creative')
  assert.equal(creativeConversationDefaults.reasoningEffort, 'medium', 'creative chat defaults use medium reasoning')
  assert.equal(creativeConversationDefaults.temperature, 0.9, 'creative chat defaults use a higher temperature')
  assert.ok(creativeConversationDefaults.systemPrompt.includes('creative partner'), 'creative chat defaults include the selected behavior contract')
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
  const actionWorkspace = buildWorkspaceReadiness({
    providers: [],
    settings: {
      memoryEnabled: false,
      knowledgeEnabled: false,
      ragMode: 'off',
      webSearchEnabled: false,
      searchProvider: 'off',
      autoUpdateCheckEnabled: false,
    },
  })
  assert.equal(actionWorkspace.readyCount, 0, 'workspace readiness does not count disabled capabilities as ready')
  assert.deepEqual(
    Object.fromEntries(actionWorkspace.items.map((item) => [item.key, item.status])),
    {
      provider: 'action',
      memory: 'action',
      knowledge: 'action',
      search: 'review',
      recovery: 'review',
    },
    'workspace readiness separates missing setup actions from settings that only need review'
  )
  assert.equal(
    actionWorkspace.primaryAction?.key,
    'provider',
    'workspace readiness prioritizes provider setup as the first production-workspace action'
  )

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
    ['gpt-5.5-mini', 'fast'],
    'provider activation candidates exclude blocked models and keep alias candidates allowed through upstream policy'
  )
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
  assert.ok(packed.estimatedInputTokens <= packed.budgetTokens, 'stays under the planned input budget')
  assert.ok(packed.budgetTokens < 1200, 'reserves output tokens from the input context budget')
  assert.equal(packed.compressionTriggered, true, 'compression trace exposes trigger state')
  assert.ok(packed.fixedTokens >= 0 && packed.modelBudgetTokens > 0 && packed.reservedOutputTokens >= 256, 'compression trace exposes full budget fields')

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
  const highReasoningPacked = packChatMessages({
    messages: [{ role: 'user', content: 'reasoning budget '.repeat(500) }],
    modelContextWindow: 6000,
    maxOutputTokens: 1024,
    providerType: 'openai',
    model: 'gpt-5.5',
    reasoningEffort: 'high',
  })
  assert.ok(highReasoningPacked.reasoningReserveTokens >= 4096, 'high reasoning reserves extra thinking room before packing history')

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
    'mimo-v2-tts',
  ], 'MiMo built-in catalog includes every currently documented model')
  const unknownMimoConfig = getModelConfig('mimo-v3-unannounced', 'xiaomi-mimo')
  assert.equal(unknownMimoConfig.contextWindow, 32768, 'unknown MiMo models use a safe 32K budget until the provider returns metadata or the static catalog is updated')
  assert.equal(unknownMimoConfig.maxOutputTokens, 4096, 'unknown MiMo output limit stays conservative')
  assert.equal(unknownMimoConfig.supportsVision, false, 'unknown MiMo models do not inherit vision support by default')
  assert.equal(getModelConfig('mimo-v2.5-tts', 'xiaomi-mimo').chatCompatible, false, 'MiMo TTS models are cataloged but not chat-compatible')
  assert.deepEqual(
    getReasoningEffortOptions(mimoAnthropicProvider, 'mimo-v2.5'),
    ['minimal', 'low', 'medium', 'high'],
    'MiMo chat models expose the runtime-supported reasoning effort tiers'
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
    reasoningEffort: 'minimal',
    maxTokens: 128,
    stream: false,
  })
  assert.deepEqual(mimoOpenAIReasoningBody.reasoning, { effort: 'low' }, 'MiMo OpenAI-compatible requests send the accepted reasoning object')
  assert.equal(mimoOpenAIReasoningBody.reasoning_effort, undefined, 'MiMo OpenAI-compatible requests avoid generic reasoning_effort')
  assert.equal(mimoOpenAIReasoningBody.max_completion_tokens, 128, 'MiMo OpenAI-compatible requests reserve enough output room for reasoning plus text')
  const mimoAnthropicReasoningBody = buildAnthropicBodyForTest({
    provider: mimoAnthropicProvider,
    model: 'mimo-v2.5',
    messages: [{ role: 'user', content: 'hello' }],
    reasoningEffort: 'high',
    maxTokens: 128,
    stream: false,
  })
  assert.deepEqual(mimoAnthropicReasoningBody.reasoning, { effort: 'high' }, 'MiMo Anthropic-compatible requests send the accepted reasoning object')
  assert.equal(mimoAnthropicReasoningBody.thinking, undefined, 'MiMo Anthropic-compatible requests do not use Claude thinking syntax')
  assert.equal(mimoAnthropicReasoningBody.max_tokens, 128, 'MiMo Anthropic-compatible tests reserve enough output room for reasoning plus text')
  assert.deepEqual(
    getProviderAvailableModels({
      ...mimoAnthropicProvider,
      models: ['mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'],
      modelConfigs: ['mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'].map((id) => getModelConfig(id, 'xiaomi-mimo')),
      credentialGroups: [{
        id: 'default',
        label: 'default',
        enabled: true,
        lastModelSyncStatus: 'ok',
        availableModels: ['mimo-v2.5-pro', 'mimo-v2.5-tts', 'mimo-v2.5-tts-voiceclone'],
      }],
    }),
    ['mimo-v2.5-pro'],
    'chat model availability excludes MiMo TTS models'
  )
  assert.equal(getModelConfig('gpt-5.5', 'openai').contextWindow, 1050000, 'GPT-5.5 context matches verified OpenAI docs')
  assert.equal(getModelConfig('gpt-5.5', 'openai').maxOutputTokens, 128000, 'GPT-5.5 output limit matches verified OpenAI docs')
  assert.equal(getModelConfig('gpt-5.4', 'openai').contextWindow, 1050000, 'GPT-5.4 context matches verified OpenAI docs')
  assert.deepEqual(getModelConfig('gpt-5.2-pro', 'openai').reasoningEfforts, ['medium', 'high', 'xhigh'], 'GPT-5.2 Pro only exposes source-backed supported effort tiers')
  assert.equal(getModelConfig('gpt-4.1', 'openai').contextWindow, 1047576, 'GPT-4.1 context remains exact')
  assert.equal(getModelConfig('gpt-4o', 'openai').maxOutputTokens, 16384, 'GPT-4o output limit remains exact')
  assert.equal(getModelConfig('deepseek-v4-pro', 'openai-compatible').contextWindow, 1000000, 'DeepSeek V4 Pro context is official 1M')
  assert.equal(getModelConfig('deepseek-v4-pro', 'openai-compatible').maxOutputTokens, 384000, 'DeepSeek V4 Pro output limit is official 384K')
  assert.equal(getModelConfig('claude-opus-4-7', 'anthropic').contextWindow, 1000000, 'Claude Opus 4.7 context uses official current model overview')
  assert.equal(getModelConfig('claude-sonnet-4-6', 'anthropic').maxOutputTokens, 64000, 'Claude Sonnet 4.6 output limit uses official current model overview')
  assert.equal(getModelConfig('gemini-3-pro-preview', 'google').deprecated, true, 'Gemini 3 Pro Preview is not recommended as a default')
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
  assert.ok(openAIResponsesBody.max_output_tokens <= getModelConfig('gpt-5.5', 'openai').maxOutputTokens, 'Responses output tokens are clamped')
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
  const responsesSseChunk = parseProviderStreamChunkForTest([
    'data: {"type":"response.output_text.delta","delta":"Hello"}',
    '',
    'data: {"type":"response.output_text.delta","delta":" world"}',
    '',
    'data: {"type":"response.completed","response":{"output":[{"content":[{"type":"output_text","text":"Hello world"}]}]}}',
    '',
  ].join('\n'), 'openai')
  assert.equal(responsesSseChunk.text, 'Hello world', 'Responses SSE delta text is not duplicated by completion events')
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
  assert.ok(gemini25Body.generationConfig.maxOutputTokens <= getModelConfig('gemini-2.5-flash', 'google').maxOutputTokens, 'Gemini maxOutputTokens is clamped to output limit')
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
  const parsedAnthropic = parseAnthropicModelsForTest([
    { id: 'claude-test-current', display_name: 'Claude Test', max_input_tokens: 1000000, max_tokens: 128000, capabilities: ['chat', 'extended_thinking'] },
  ])
  assert.equal(parsedAnthropic[0].contextWindow, 1000000, 'Anthropic Models API max_input_tokens is parsed as context window')
  assert.equal(parsedAnthropic[0].maxOutputTokens, 128000, 'Anthropic Models API max_tokens is parsed as output limit')
  assert.equal(parsedAnthropic[0].reasoningMode, 'anthropic-thinking', 'Anthropic model capabilities mark thinking support')
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
  const importedSkill = importSkill(exportedSkill)
  assert.equal(importedSkill.ok, true, 'imports .isleskill JSON')
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

  const petIdle = deriveHomePetState({ reasoningEffort: 'medium' })
  assert.equal(petIdle.animation, 'idle', 'pet is idle without chat activity')
  const petUnconfigured = deriveHomePetState({ modelStatus: 'unconfigured' })
  assert.equal(petUnconfigured.reason, 'model_unconfigured', 'missing provider is its own pet state')
  const petUnavailable = deriveHomePetState({ modelStatus: 'unavailable' })
  assert.equal(petUnavailable.reason, 'model_unavailable', 'unavailable model is its own pet state')
  const petModelTesting = deriveHomePetState({ modelStatus: 'testing' })
  assert.equal(petModelTesting.animation, 'modelTesting', 'model testing uses the testing pet animation')
  const petStreaming = deriveHomePetState({
    reasoningEffort: 'low',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming' }] },
  })
  assert.equal(petStreaming.animation, 'running', 'pet works while a reply streams')
  assert.ok(petStreaming.speed < 1, 'low reasoning slows the working pet loop')
  const petSending = deriveHomePetState({
    reasoningEffort: 'medium',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'sending' }] },
  })
  assert.equal(petSending.reason, 'sending_prompt', 'sending messages use a dedicated pet state')
  const petHighReasoning = deriveHomePetState({
    reasoningEffort: 'high',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming' }] },
  })
  assert.equal(petHighReasoning.animation, 'deepThinking', 'high reasoning switches pet into deep thinking')
  assert.equal(petHighReasoning.atlasId, 'rag', 'high reasoning targets the RAG atlas')
  const petTool = deriveHomePetState({
    reasoningEffort: 'medium',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming', toolCalls: [{ type: 'tool', status: 'running' }] }] },
  })
  assert.equal(petTool.animation, 'toolWorking', 'running tool traces switch pet into tool working animation')
  assert.equal(petTool.atlasId, 'provider', 'tool activity targets the provider atlas')
  assert.equal(petTool.reason, 'tool', 'running tool traces switch pet to tool mood')
  const petMcpTool = deriveHomePetState({
    toolActivity: 'mcp',
    conversation: { messages: [{ role: 'assistant', status: 'streaming', toolCalls: [{ type: 'tool', title: 'MCP lookup', status: 'running' }] }] },
  })
  assert.equal(petMcpTool.animation, 'mcpWorking', 'MCP tool activity uses a dedicated pet animation')
  const petSkillTool = deriveHomePetState({ toolActivity: 'skill' })
  assert.equal(petSkillTool.reason, 'skill_tool', 'skill activity uses a dedicated pet state')
  const petAttachmentTool = deriveHomePetState({ toolActivity: 'attachment' })
  assert.equal(petAttachmentTool.animation, 'attachmentReading', 'attachment activity uses a dedicated pet animation')
  const petWebSearch = deriveHomePetState({ toolActivity: 'search' })
  assert.equal(petWebSearch.reason, 'web_search', 'web search activity uses a dedicated pet state')
  const petRetrieval = deriveHomePetState({
    reasoningEffort: 'medium',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming', retrievalTrace: [{ type: 'retrieval', status: 'running' }] }] },
  })
  assert.equal(petRetrieval.animation, 'retrieving', 'running retrieval traces switch pet to retrieving')
  assert.equal(petRetrieval.atlasId, 'rag', 'retrieval activity targets the RAG atlas')
  const petDeepRag = deriveHomePetState({ ragActivity: 'deep' })
  assert.equal(petDeepRag.reason, 'rag_deep', 'deep RAG activity uses a dedicated pet state')
  const petCompressing = deriveHomePetState({ ragActivity: 'compressing' })
  assert.equal(petCompressing.animation, 'contextCompressing', 'context compression uses a dedicated pet animation')
  const petFlare = deriveHomePetState({ ragActivity: 'flare' })
  assert.equal(petFlare.reason, 'rag_flare', 'second-pass retrieval uses a dedicated pet state')
  const petMemory = deriveHomePetState({ ragActivity: 'memory' })
  assert.equal(petMemory.animation, 'memoryLinking', 'memory RAG activity uses a dedicated pet animation')
  assert.equal(petMemory.reason, 'memory_linking', 'memory RAG activity uses a dedicated pet state')
  const petGraph = deriveHomePetState({ ragActivity: 'graph' })
  assert.equal(petGraph.animation, 'graphMapping', 'graph RAG activity uses a dedicated pet animation')
  assert.equal(petGraph.labelKey, 'pet.a11y.graphMapping', 'graph RAG activity exposes its a11y label')
  const petCitation = deriveHomePetState({ ragActivity: 'citation' })
  assert.equal(petCitation.animation, 'citationReview', 'citation RAG activity uses a dedicated pet animation')
  assert.equal(petCitation.reason, 'citation_review', 'citation RAG activity uses a dedicated pet state')
  const petIndexing = deriveHomePetState({ ragActivity: 'indexing' })
  assert.equal(petIndexing.animation, 'knowledgeIndexing', 'indexing RAG activity uses a dedicated pet animation')
  assert.equal(petIndexing.reason, 'knowledge_indexing', 'indexing RAG activity uses a dedicated pet state')
  const petFallback = deriveHomePetState({
    reasoningEffort: 'medium',
    isStreaming: true,
    conversation: { messages: [{ role: 'assistant', status: 'streaming', retrievalTrace: [{ type: 'retrieval', status: 'running', metadata: { fallbackReason: 'cross-encoder-model-unavailable' } }] }] },
  })
  assert.equal(petFallback.animation, 'warningRecover', 'fallback retrieval switches pet to warning recovery')
  const petProviderSync = deriveHomePetState({ providerActivity: 'syncing' })
  assert.equal(petProviderSync.animation, 'syncingModels', 'provider activation switches pet to model syncing')
  assert.equal(petProviderSync.atlasId, 'provider', 'provider sync targets provider atlas')
  const petProviderIssue = deriveHomePetState({ providerActivity: 'partialFailure' })
  assert.equal(petProviderIssue.reason, 'provider_issue', 'provider failures use a dedicated pet state')
  const petUpdateCheck = deriveHomePetState({ updateActivity: 'checking' })
  assert.equal(petUpdateCheck.reason, 'update_check', 'update checks use a dedicated pet state')
  const petSuccess = deriveHomePetState({
    conversation: { messages: [{ role: 'assistant', status: 'done', timestamp: Date.now() }] },
  })
  assert.equal(petSuccess.reason, 'success', 'recent completed replies use the celebration pet state')
  const petError = deriveHomePetState({
    conversation: { messages: [{ role: 'assistant', status: 'error' }] },
  })
  assert.equal(petError.animation, 'warningRecover', 'failed messages switch pet to warning recovery')
  const petActionStates = [
    petIdle,
    petUnconfigured,
    petUnavailable,
    petModelTesting,
    petStreaming,
    petSending,
    petHighReasoning,
    petTool,
    petMcpTool,
    petSkillTool,
    petAttachmentTool,
    petWebSearch,
    petRetrieval,
    petDeepRag,
    petCompressing,
    petFlare,
    petMemory,
    petGraph,
    petCitation,
    petIndexing,
    petFallback,
    petProviderSync,
    petProviderIssue,
    petUpdateCheck,
    petSuccess,
    petError,
  ]
  assert.ok(new Set(petActionStates.map((state) => state.reason)).size >= 15, 'pet state derivation covers at least 15 action states')
  assert.ok(new Set(petActionStates.map((state) => state.animation)).size >= 15, 'pet state derivation reaches at least 15 distinct animations')
  assert.ok(petActionStates.every((state) => state.labelKey.startsWith('pet.a11y.')), 'every pet action state exposes an a11y label key')
  const islePetJson = JSON.parse(fs.readFileSync(path.join(root, 'assets/pets/isle/pet.json'), 'utf8'))
  assert.equal(islePetJson.id, 'isle', 'Isle manifest uses the Isle pet id')
  assert.equal(islePetJson.displayName, 'Isle', 'Isle manifest uses the Isle display name')
  assert.deepEqual(islePetJson.atlases.map((atlas) => atlas.id), ['core', 'rag', 'provider'], 'Isle manifest exposes core, rag, and provider atlases')
  assert.equal(islePetJson.atlases.find((atlas) => atlas.id === 'core').available, true, 'Isle core atlas is available')
  assert.equal(islePetJson.atlases.find((atlas) => atlas.id === 'rag').generationStatus, 'pending-imagegen', 'Isle RAG atlas stays pending until imagegen assets are recorded')
  assert.equal(islePetJson.animations.deepThinking.fallbackAnimation, 'review', 'new Isle actions declare safe core fallbacks')
  assert.ok(Object.keys(islePetJson.animations).length >= 28, 'Isle manifest declares the expanded pet animation set')
  assert.equal(islePetJson.animations.contextCompressing.fallbackAnimation, 'review', 'context compression declares a safe core fallback')
  assert.equal(islePetJson.animations.memoryLinking.fallbackAnimation, 'review', 'memory linking declares a safe core fallback')
  assert.equal(islePetJson.animations.graphMapping.row, 6, 'graph mapping fills the next RAG atlas row')
  assert.equal(islePetJson.animations.citationReview.fallbackAnimation, 'review', 'citation review declares a safe core fallback')
  assert.equal(islePetJson.animations.knowledgeIndexing.fallbackAnimation, 'running', 'knowledge indexing declares an active core fallback')
  assert.equal(islePetJson.animations.webSearching.fallbackAnimation, 'runningRight', 'web searching declares a kinetic core fallback')
  assert.equal(islePetJson.animations.providerIssue.fallbackAnimation, 'failed', 'provider issues declare a failure core fallback')

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
