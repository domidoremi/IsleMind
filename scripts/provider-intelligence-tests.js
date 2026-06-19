const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename
const originalLoad = Module._load
const memoryStorage = new Map()
const asyncStorageFaults = {
  getItem: null,
  setItem: null,
  removeItem: null,
  multiRemove: null,
}
const secureStorage = new Map()
const contextMemoryRows = []
const contextKnowledgeDocuments = []
const contextKnowledgeChunks = []
const contextDocumentSources = []
const conversationRecords = []
const compactStateRows = []
const localFileFixtures = new Map()
const localDownloadFixtures = new Map()
const localFileReadRequests = []
const localFileOperations = []
const launchedIntents = []
const sharedFiles = []
let nextReadDirectoryEntries = null
const intentLauncherModule = {
  startActivityAsync: async (action, params) => {
    launchedIntents.push({ action, params })
  },
}
let nextDocumentPickerResult = null
let nextImageLibraryResult = null
let nextCameraResult = null
let nextManipulateResultFactory = null
let nextSqliteOpenError = null
let sharingAvailable = false
const supportedCpuArchitectures = ['arm64-v8a', 'armeabi-v7a']
let expoDeviceModuleAvailable = true
const reactNativePlatform = {
  OS: 'test',
  select: (choices) => choices?.[reactNativePlatform.OS] ?? choices?.default,
}

global.__DEV__ = false

function resetAsyncStorageFaults() {
  asyncStorageFaults.getItem = null
  asyncStorageFaults.setItem = null
  asyncStorageFaults.removeItem = null
  asyncStorageFaults.multiRemove = null
}

function readAsyncStorageFault(operation, ...args) {
  const fault = asyncStorageFaults[operation]
  if (!fault) return null
  return typeof fault === 'function' ? fault(...args) : fault
}

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
        getItem: async (key) => {
          const fault = readAsyncStorageFault('getItem', key)
          if (fault) throw fault
          return memoryStorage.get(key) ?? null
        },
        setItem: async (key, value) => {
          const fault = readAsyncStorageFault('setItem', key, value)
          if (fault) throw fault
          memoryStorage.set(key, value)
        },
        removeItem: async (key) => {
          const fault = readAsyncStorageFault('removeItem', key)
          if (fault) throw fault
          memoryStorage.delete(key)
        },
        multiRemove: async (keys) => {
          const fault = readAsyncStorageFault('multiRemove', keys)
          if (fault) throw fault
          keys.forEach((key) => memoryStorage.delete(key))
        },
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
      openDatabaseAsync: async () => {
        if (nextSqliteOpenError) {
          const error = nextSqliteOpenError
          nextSqliteOpenError = null
          throw error
        }
        return ({
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
          if (/DELETE FROM knowledge_documents/i.test(sql)) {
            contextKnowledgeDocuments.splice(0, contextKnowledgeDocuments.length)
          }
          if (/DELETE FROM knowledge_chunks/i.test(sql)) {
            contextKnowledgeChunks.splice(0, contextKnowledgeChunks.length)
          }
          if (/DELETE FROM knowledge_fts/i.test(sql)) {
            return
          }
          if (/DELETE FROM document_sources/i.test(sql)) {
            contextDocumentSources.splice(0, contextDocumentSources.length)
          }
          if (/DELETE FROM conversation_records/i.test(sql)) {
            conversationRecords.splice(0, conversationRecords.length)
          }
          if (/DELETE FROM compact_states/i.test(sql)) {
            compactStateRows.splice(0, compactStateRows.length)
          }
          if (/UPDATE compact_states SET status = 'invalidated'/i.test(sql)) {
            const [failureCode, updatedAt, scope] = args
            if (/WHERE providerId = \? AND status = 'active'/i.test(sql)) {
              for (const row of compactStateRows) {
                if (row.providerId === scope && row.status === 'active') {
                  row.status = 'invalidated'
                  row.failureCode = failureCode
                  row.updatedAt = updatedAt
                }
              }
            } else if (/WHERE conversationId = \? AND status = 'active'/i.test(sql)) {
              for (const row of compactStateRows) {
                if (row.conversationId === scope && row.status === 'active') {
                  row.status = 'invalidated'
                  row.failureCode = failureCode
                  row.updatedAt = updatedAt
                }
              }
            } else if (/WHERE status = 'active'/i.test(sql)) {
              for (const row of compactStateRows) {
                if (row.status === 'active') {
                  row.status = 'invalidated'
                  row.failureCode = failureCode
                  row.updatedAt = updatedAt
                }
              }
            }
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
          if (/INSERT OR REPLACE INTO document_sources/i.test(sql)) {
            const [documentId, sourceUri, rawPath, contentHash, updatedAt] = args
            const existingIndex = contextDocumentSources.findIndex((item) => item.documentId === documentId)
            const row = { documentId, sourceUri, rawPath, contentHash, updatedAt }
            if (existingIndex >= 0) contextDocumentSources[existingIndex] = row
            else contextDocumentSources.push(row)
          }
          if (/INSERT OR REPLACE INTO knowledge_documents/i.test(sql) || /INSERT INTO knowledge_documents/i.test(sql)) {
            const [id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt] = args
            const existingIndex = contextKnowledgeDocuments.findIndex((item) => item.id === id)
            const row = { id, title, mimeType, size, chunkCount, status, error, sourceUri, rawPath, contentHash, createdAt, updatedAt }
            if (existingIndex >= 0) contextKnowledgeDocuments[existingIndex] = row
            else contextKnowledgeDocuments.push(row)
          }
          if (/INSERT INTO knowledge_chunks/i.test(sql)) {
            const [id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt] = args
            const existingIndex = contextKnowledgeChunks.findIndex((item) => item.id === id)
            const row = { id, documentId, title, content, ordinal, chunkIndex, sentenceStart, sentenceEnd, semanticBoundary, headingPathJson, entitiesJson, relationsJson, summaryNodeId, parentChunkId, qualityScore, embeddingModelId, rerankSignalsJson, embeddingProvider, lastHitAt, createdAt }
            if (existingIndex >= 0) contextKnowledgeChunks[existingIndex] = row
            else contextKnowledgeChunks.push(row)
          }
          if (/INSERT OR REPLACE INTO conversation_records/i.test(sql)) {
            const [id, title, providerId, model, updatedAt, payloadJson] = args
            const existingIndex = conversationRecords.findIndex((item) => item.id === id)
            const row = { id, title, providerId, model, updatedAt, payloadJson }
            if (existingIndex >= 0) conversationRecords[existingIndex] = row
            else conversationRecords.push(row)
          }
          if (/INSERT OR REPLACE INTO compact_states/i.test(sql)) {
            const [
              id,
              conversationId,
              providerId,
              model,
              responseId,
              sessionId,
              compactItemJson,
              sourceMessageStartIndex,
              sourceMessageEndIndex,
              inputTokens,
              outputTokens,
              estimatedSavedTokens,
              status,
              failureCode,
              createdAt,
              updatedAt,
              expiresAt,
            ] = args
            const existingIndex = compactStateRows.findIndex((item) => item.id === id)
            const row = {
              id,
              conversationId,
              providerId,
              model,
              responseId,
              sessionId,
              compactItemJson,
              sourceMessageStartIndex,
              sourceMessageEndIndex,
              inputTokens,
              outputTokens,
              estimatedSavedTokens,
              status,
              failureCode,
              createdAt,
              updatedAt,
              expiresAt,
            }
            if (existingIndex >= 0) compactStateRows[existingIndex] = row
            else compactStateRows.push(row)
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
          if (/FROM knowledge_fts/i.test(sql)) {
            const limit = args.at(-1) ?? contextKnowledgeChunks.length
            return contextKnowledgeChunks
              .slice(0, limit)
              .map((row, index) => {
                const document = contextKnowledgeDocuments.find((item) => item.id === row.documentId)
                return {
                  ...row,
                  sourceUri: document?.sourceUri,
                  rawPath: document?.rawPath,
                  score: row.score ?? -1 / (index + 1),
                }
              })
          }
          if (/FROM memories/i.test(sql)) {
            return [...contextMemoryRows]
          }
          if (/FROM knowledge_documents/i.test(sql)) {
            return [...contextKnowledgeDocuments]
          }
          if (/FROM knowledge_chunks/i.test(sql) && /WHERE id IN/i.test(sql)) {
            const ids = new Set(args)
            return contextKnowledgeChunks.filter((row) => ids.has(row.id))
          }
          if (/FROM knowledge_chunks/i.test(sql)) {
            return [...contextKnowledgeChunks]
          }
          if (/FROM document_sources/i.test(sql)) {
            const ids = new Set(args)
            return contextDocumentSources.filter((row) => ids.has(row.documentId))
          }
          if (/FROM conversation_records/i.test(sql)) {
            return [...conversationRecords].sort((a, b) => b.updatedAt - a.updatedAt)
          }
          if (/FROM compact_states/i.test(sql)) {
            const [conversationId, providerId, model, now] = args
            return compactStateRows
              .filter((row) =>
                row.conversationId === conversationId &&
                row.providerId === providerId &&
                row.model === model &&
                row.status === 'active' &&
                (row.expiresAt == null || row.expiresAt > now)
              )
              .sort((a, b) => b.updatedAt - a.updatedAt)
          }
          return []
        },
        getFirstAsync: async () => null,
      })
      },
    }
  }
  if (request === 'expo-document-picker') {
    return {
      getDocumentAsync: async () => {
        const result = nextDocumentPickerResult ?? { canceled: true, assets: [] }
        nextDocumentPickerResult = null
        return result
      },
    }
  }
  if (request === 'expo-image-picker') {
    return {
      launchImageLibraryAsync: async () => {
        const result = nextImageLibraryResult ?? { canceled: true, assets: [] }
        nextImageLibraryResult = null
        return result
      },
      launchCameraAsync: async () => {
        const result = nextCameraResult ?? { canceled: true, assets: [] }
        nextCameraResult = null
        return result
      },
    }
  }
  if (request === 'expo-image-manipulator') {
    return {
      SaveFormat: { JPEG: 'jpeg' },
      manipulateAsync: async (uri) => {
        if (typeof nextManipulateResultFactory === 'function') {
          const factory = nextManipulateResultFactory
          nextManipulateResultFactory = null
          return factory(uri)
        }
        return { uri }
      },
    }
  }
  if (request === 'expo-audio') {
    return {
      AudioModule: {
        requestRecordingPermissionsAsync: async () => ({ granted: false }),
      },
      useAudioRecorder: () => null,
      createAudioPlayer: () => {
        let playbackListener = null
        const player = {
          play: () => undefined,
          pause: () => undefined,
          remove: () => {
            if (global.__lastExpoAudioPlayer === player) {
              global.__lastExpoAudioPlayer = null
            }
            playbackListener = null
          },
          addListener: (event, listener) => {
            if (event === 'playbackStatusUpdate') {
              playbackListener = listener
            }
            return {
              remove: () => {
                if (playbackListener === listener) playbackListener = null
              },
            }
          },
          emitPlaybackStatusUpdate: (status) => {
            playbackListener?.(status)
          },
        }
        global.__lastExpoAudioPlayer = player
        return player
      },
    }
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
      readDirectoryAsync: async (uri) => {
        if (Array.isArray(nextReadDirectoryEntries)) {
          const entries = nextReadDirectoryEntries
          nextReadDirectoryEntries = null
          return entries
        }
        const entries = new Set()
        const normalized = uri.endsWith('/') ? uri : `${uri}/`
        for (const key of localFileFixtures.keys()) {
          if (!key.startsWith(normalized)) continue
          const rest = key.slice(normalized.length)
          const name = rest.split('/')[0]
          if (name) entries.add(name)
        }
        return [...entries]
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
      cacheDirectory: 'file:///cache/',
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
    return intentLauncherModule
  }
  if (request === 'expo-clipboard') {
    return {
      setStringAsync: async () => undefined,
      getStringAsync: async () => '',
    }
  }
  if (request === 'expo-speech') {
    return {
      stop: () => undefined,
      speak: () => undefined,
    }
  }
  if (request === 'expo-sharing') {
    return {
      isAvailableAsync: async () => sharingAvailable,
      shareAsync: async (uri, options) => {
        sharedFiles.push({ uri, options })
      },
    }
  }
  if (request === 'onnxruntime-react-native') {
    class FakeTensor {
      constructor(type, data, dims) {
        this.type = type
        this.data = data
        this.dims = dims
      }
    }
    return {
      Tensor: FakeTensor,
      InferenceSession: {
        create: async (modelPath) => ({
          inputNames: ['input_ids', 'attention_mask', 'token_type_ids'],
          outputNames: ['sentence_embedding'],
          run: async () => ({
            sentence_embedding: {
              dims: [1, 384],
              data: new Float32Array(Array.from({ length: 384 }, (_, index) => (index % 16) + 1)),
            },
          }),
          modelPath,
        }),
      },
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
  findCredentialGroupIdForKey,
  mergeCredentialModelAvailability,
  normalizeProviderCredentialGroups,
  runCredentialGroupModelSync,
  updateCredentialGroupHealth,
} = require('../src/services/ai/providerCredentials.ts')
const { packChatMessages } = require('../src/services/contextPacker.ts')
const IntentLauncher = require('expo-intent-launcher')
const {
  DEFAULT_MODELS,
  getModelConfig,
  getProviderConfigIssue,
  getProviderModels,
  getXiaomiMimoOfficialBaseUrl,
  hasCustomProviderBaseUrl,
  isHttpProviderBaseUrl,
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
const { ProviderHttpError, classifyHttpStatus, extractProviderErrorDetail, failure, success } = require('../src/services/ai/providerOperationResult.ts')
const {
  dedupeModelIds,
  fetchProviderModelConfigsFromRemote,
  mapGoogleModels,
  mapOpenAICompatibleModels,
  normalizeRemoteModelId,
} = require('../src/services/ai/providerModelDiscovery.ts')
const {
  getModelTestMaxTokens,
  getModelTestReasoningEffort,
  reduceModelTestBody,
} = require('../src/services/ai/providerModelTest.ts')
const {
  isDashScopeProvider,
  isMiniMaxProvider,
  isMoonshotProvider,
  isPerplexityProvider,
  isXAIProvider,
  shouldRequestDashScopeStreamUsage,
} = require('../src/services/ai/providerIdentity.ts')
const {
  buildProviderCapabilityMatrix,
  buildProviderCoverageBuckets,
  describeProviderCapabilityStatus,
  providerNeedsHostedCompatibilityWork,
  providerSuppressesGenericModelList,
  summarizeProviderCapabilityMatrix,
} = require('../src/services/ai/providerCapabilityMatrix.ts')
const {
  buildPayloadPolicyLogData,
  buildProviderRouteDecisionLogData,
  buildProxyPolicyLogData,
  buildUpstreamRequestLogData,
  createRuntimeFallbackTrace,
  createRuntimeGovernanceTrace,
  createStreamModeTrace,
  emitRuntimeGovernanceTrace,
  runtimeLogOptions,
  summarizePayloadPolicy,
  summarizeProxyPolicy,
  summarizeRouteDecision,
  summarizeTransportSelection,
} = require('../src/services/ai/providerRuntimeDiagnostics.ts')
const {
  assertProviderCircuitClosed,
  providerCircuitKey,
  providerRetryDelayMs,
  recordProviderCircuitFailure,
  recordProviderCircuitSuccess,
  resolveProviderMaxRetries,
  resolveProviderRequestTimeoutMs,
} = require('../src/services/ai/providerRuntimeRetry.ts')
const {
  providerRuntimeError,
  runStreamTask,
  withCredentialGroup,
} = require('../src/services/ai/providerRuntimeResult.ts')
const {
  parseProviderStreamChunk,
  parseProviderStreamEvent,
} = require('../src/services/ai/providerStreamParsing.ts')
const { extractUsage, numberValue } = require('../src/services/ai/providerUsage.ts')
const {
  dedupeCitations,
  extractCitationsFromText,
  extractProviderCitations,
  extractProviderCitationsFromSse,
} = require('../src/services/ai/providerCitations.ts')
const {
  normalizeAnthropicEffort,
  normalizeAnthropicThinking,
  supportsAnthropicAdaptiveThinking,
  usesAnthropicOutputConfigOnlyThinking,
} = require('../src/services/ai/providerAnthropicThinking.ts')
const {
  anthropicAttachmentPart,
  anthropicNativeWebSearchTool,
  supportsAnthropicDynamicWebSearch,
} = require('../src/services/ai/providerAnthropicRequest.ts')
const {
  extractAnthropicReplayContentBlocks,
  mergeAnthropicReplayContentBlocks,
  sanitizeAnthropicReplayContentBlocks,
} = require('../src/services/ai/providerAnthropicReplay.ts')
const {
  normalizeAnthropicThinkingBudgetBody,
  stripThinkingBlocks,
} = require('../src/services/ai/providerAnthropicRectification.ts')
const {
  injectBedrockCache,
  isAnthropicWireProvider,
  isBedrockProvider,
  optimizeBedrockThinking,
} = require('../src/services/ai/providerRequestOptimization.ts')
const { dedupeTraces, splitSseBuffer } = require('../src/services/ai/providerStreamUtils.ts')
const { runResponsesWebSocketTransport } = require('../src/services/ai/transport/responsesWebSocketTransport.ts')
const { activeSessionLeaseCount, acquireSessionLease } = require('../src/services/ai/transport/sessionLeasePool.ts')
const { resolveProviderCapabilityManifest } = require('../src/services/ai/providerConformance.ts')
const { resolveProviderEndpoint } = require('../src/services/ai/providerRouteAssembly.ts')
const {
  bedrockRuntimeInvokeModelUrl,
  getBedrockRuntimeSupportIssue,
  inferBedrockMantleRegion,
  inferBedrockRuntimeRegion,
  isBedrockMantleBaseUrl,
  isBedrockMantleProvider,
  isBedrockRuntimeProvider,
  normalizeBedrockMantleBaseUrl,
  parseBedrockRuntimeCredentials,
  prepareBedrockRuntimeInvokeModelRequest,
} = require('../src/services/ai/providerAwsBedrockRouting.ts')
const { hmacSha256Hex, sha256Hex, signAwsRequestV4 } = require('../src/services/ai/providerAwsSigV4.ts')
const {
  isAzureOpenAILegacyDeploymentProvider,
  isAzureOpenAIProvider,
  isAzureOpenAIV1Provider,
  normalizeAzureOpenAIBaseUrl,
} = require('../src/services/ai/providerHostedRouting.ts')
const {
  getHostedProviderKind,
  getHostedProviderSupportIssue,
  isAwsBedrockHostedProvider,
  isHostedProviderGap,
  isVertexAIOpenAICompatibleProvider,
  isVertexAIProvider,
} = require('../src/services/ai/providerHostedBoundary.ts')
const { buildProviderFallbackCandidates } = require('../src/services/ai/providerFallbackCandidates.ts')
const {
  fallbackProvidersForRequest,
  providerForRuntimeFallback,
  requiredFallbackCapabilities,
  retryAfterMsFromFailure,
  routeForRuntimeFallback,
} = require('../src/services/ai/providerRuntimeFallback.ts')
const { fetchWithTimeout, safeResponseText } = require('../src/services/ai/providerHttp.ts')
const { asRecord, parseProviderJson, safeJsonPreview, stringValue, stringifyReasoningDetails } = require('../src/services/ai/providerJsonUtils.ts')
const { endpointHost, resolveNonStreamingProviderEndpoint, toWebSocketUrl } = require('../src/services/ai/providerEndpointUtils.ts')
const { fallbackModel, pickEmbeddingModel } = require('../src/services/ai/providerDefaultModels.ts')
const { arrayBufferToBase64 } = require('../src/services/ai/providerBinaryUtils.ts')
const { createStreamingChunkBuffer, createStreamingTraceBuffer, mergeBufferedTrace } = require('../src/services/chatStreamingBuffers.ts')
const { formatAgentWorkflowSaveBlockedReason, resolveConfirmedPendingActionTool } = require('../src/services/chatAgentActionUtils.ts')
const { buildSetupGuide, classifyChatError, toUserFacingError } = require('../src/services/chatErrorUtils.ts')
const {
  generateAnswerWithMcpToolResult,
  resolveMcpToolRevision,
} = require('../src/services/chatMcpToolRuntime.ts')
const { buildMcpToolRevisionMessages, buildMcpToolRevisionSystemPrompt } = require('../src/services/chatMcpRevisionUtils.ts')
const {
  buildCompletedRemoteCompactRuntimeLogPayload,
  buildCompletedRemoteCompactStateRecord,
  buildCompletedRemoteCompactUsageInput,
} = require('../src/services/chatRemoteCompactUtils.ts')
const { resolveRuntimeConversation, resolveRuntimeResolutionError } = require('../src/services/chatRuntimeResolution.ts')
const { dedupeMessageCitations, formatWebPrompt, normalizeUserContent } = require('../src/services/chatMessageUtils.ts')
const { buildAndroidUndoPromptContext, safeChatPromptText } = require('../src/services/chatAndroidUndoPrompt.ts')
const {
  buildProviderNativeToolManifestTrace,
  buildProviderNativeToolRevisionMessages,
  buildProviderNativeToolTraceMetadata,
  findProviderToolNameMapEntry,
  providerSupportsNativeTools,
  safeProviderNativeToolText,
  usesAnthropicCompatibleToolResultMessages,
  usesOpenAICompatibleToolResultMessages,
} = require('../src/services/chatProviderNativeToolUtils.ts')
const {
  clampTraceContent,
  completeTrace,
  sanitizeTrace,
  settleMessageTraces,
  settleTrace,
  tracesNeedingSettlement,
} = require('../src/services/chatTraceUtils.ts')
const {
  addOptionalNumbers,
  findMcpTool,
  formatToolBlocks,
  mergeUsage,
  sanitizeToolRevisionAnswerText,
  stringifyToolArguments,
  stripMcpCallBlocks,
} = require('../src/services/chatToolResultUtils.ts')
const { clamp01, clampInteger } = require('../src/services/ai/providerNumberUtils.ts')
const { getHeaders } = require('../src/services/ai/providerHeaders.ts')
const { getWireProviderType, isAnthropicWireRequest } = require('../src/services/ai/providerWireProtocol.ts')
const {
  clampMaxTokens,
  isXiaomiMimoThinkingActive,
  normalizeTemperature,
  normalizeXiaomiMimoThinking,
} = require('../src/services/ai/providerRequestParameters.ts')
const {
  buildOpenAIResponsesReasoning,
  getOpenAIChatMaxTokensField,
  normalizeOpenAIReasoningEffort,
  openAICompatibleAttachmentPart,
  openAIResponsesAttachmentPart,
  openAIResponsesNativeWebSearchTool,
  shouldIncludeOpenAIResponsesEncryptedReasoning,
  shouldReplayOpenAICompatibleReasoningContent,
  usesOpenAIResponses,
} = require('../src/services/ai/providerOpenAIRequest.ts')
const {
  isKimiSamplingLocked,
  normalizeDashScopeThinking,
  normalizeDashScopeThinkingBudget,
  normalizeDeepSeekThinking,
  normalizeKimiPreservedThinking,
  normalizeKimiThinking,
  normalizeMiniMaxThinking,
  shouldRequestMiniMaxReasoningSplit,
} = require('../src/services/ai/providerOpenAICompatibleThinking.ts')
const {
  normalizeGeminiThinkingBudget,
  normalizeGeminiThinkingLevel,
  normalizeGoogleThinkingConfig,
  withGoogleThoughtSummaries,
} = require('../src/services/ai/providerGoogleThinking.ts')
const {
  googleAttachmentPart,
  googleNativeWebSearchTool,
} = require('../src/services/ai/providerGoogleRequest.ts')
const {
  toAnthropicContentBlocks,
  toGoogleContentParts,
  toTextContent,
} = require('../src/services/ai/providerContentParts.ts')
const {
  extractOpenAIReasoningContent,
  extractOpenAIResponseReplayItems,
  mergeOpenAIResponseReplayItems,
} = require('../src/services/ai/providerOpenAIReplay.ts')
const {
  extractAnthropicText,
  extractGoogleText,
  extractOpenAIText,
  extractResponseId,
  stringifyOpenAIReasoningItem,
} = require('../src/services/ai/providerResponseText.ts')
const {
  parseProviderBufferedStreamResponse,
  parseProviderBufferedStreamJson,
  parseProviderChatCompletionJson,
  parseProviderNonStreamingResponse,
  parseProviderNonStreamingText,
  readProviderResponseBody,
} = require('../src/services/ai/providerResponseParsing.ts')
const {
  createProviderTrace,
  extractTracesFromJson,
  isDoneEvent,
  isReasoningEventType,
  isToolEventType,
  stableTraceId,
  summarizeToolEvent,
} = require('../src/services/ai/providerTraceUtils.ts')
const {
  executableProviderToolCalls,
  extractProviderToolCalls,
  mergeProviderToolCallParts,
} = require('../src/services/ai/providerToolCalls.ts')
const {
  cloneProviderToolDeclarations,
  mergeProviderToolDeclarations,
} = require('../src/services/ai/providerToolDeclarations.ts')
const {
  cloneOpenAIResponsesInputItems,
  hasOpenAIResponsesFunctionCallItem,
  stringifyProviderToolArguments,
  toOpenAIChatToolCall,
  toOpenAIResponsesFunctionCallInput,
} = require('../src/services/ai/providerToolReplay.ts')
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
  buildCustomSearchUrl,
  getBingCompatibleEndpoint,
  legacySearchModeForProvider,
  resolveSearchProvider,
  safeCustomSearchEndpoint,
} = require('../src/services/searchPolicy.ts')
const { searchExternalWeb } = require('../src/services/searchAdapters.ts')
const { callBuiltinTool } = require('../src/services/builtinToolRegistry.ts')
const {
  MAX_IMPORT_JSON_FILE_BYTES,
  MAX_IMPORT_TEXT_FILE_BYTES,
  deleteTemporaryImportCopy,
  readUtf8ImportFile,
} = require('../src/services/fileImportGuards.ts')
const {
  applySkillStack,
  createBaseSkill,
  exportSkill,
  importSkill,
  renderSkillTemplate,
} = require('../src/services/skills.ts')
const { exportToJsonFile, importFromJsonFileDetailed } = require('../src/services/portableData.ts')
const {
  builtinMcpServer,
  callMcpTool,
  listMcpServers,
  truncateToolBlocks,
  refreshMcpManifest,
} = require('../src/services/mcp.ts')
const { MCP_TOOL_CALL_TAG, parseMcpToolRequest } = require('../src/services/mcpToolRequest.ts')
const { buildMcpContextPrompt, buildMcpManifestTrace, collectResolvedMcpTools } = require('../src/services/chatMcpContextUtils.ts')
const { buildProviderActivationTestCandidatesForTest, summarizeProviderActivation, syncAndTestProvider } = require('../src/services/providerActivation.ts')
const { ACTIVATION_STAGE_PROGRESS, activationItemProgress, aggregateActivationItems, createActivationItems, patchActivationItem } = require('../src/services/providerActivationJob.ts')
const { countDetectedProviderImports, formatProviderNameList } = require('../src/services/providerImportSummary.ts')
const { compareProviders, filterAndSortProviders, providerMatchesModelFilter } = require('../src/services/providerSettingsList.ts')
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
const { isAllowedWebViewNavigation, safeHttpUrl } = require('../src/utils/sourceUrlSafety.ts')
const { isAllowedAndroidApkUriForTest, sanitizeAndroidApkUriForTest } = require('../src/services/androidUriPolicy.ts')
const { getReasoningEffortOptions, providerSupportsReasoning } = require('../src/utils/modelReasoning.ts')
const { resolveAgentProviderToolTarget } = require('../src/services/agent/agentProviderToolAdapter.ts')
const { resolveAgentTool } = require('../src/services/agent/agentToolRegistry.ts')
const { validateAgentWorkflowDefinition } = require('../src/services/agent/agentWorkflowDefinitions.ts')
const { buildAgentWorkflowSkillSavePreview, createAgentWorkflowSkillSuggestionFromRun } = require('../src/services/agent/agentWorkflowSkills.ts')
const { formatAgentToolRequestIdentity } = require('../src/services/agent/agentToolIdentityUtils.ts')
const {
  DEFAULT_ONBOARDING_COMPANION_MODE,
  getOnboardingCompanionProfile,
  getOnboardingConversationDefaults,
  getOnboardingSettingsDefaults,
  isOnboardingSystemPrompt,
} = require('../src/utils/onboardingProfile.ts')
const { buildMemoryReviewSummary, filterPendingMemoriesForReview } = require('../src/utils/memoryReview.ts')
const {
  capabilityLabel,
  formatKnowledgeMeta,
  formatMemoryMeta,
  formatMemoryTime,
  memoryReviewFocusKey,
  memorySourceKindKey,
  shortenKnowledgeSource,
} = require('../src/services/contextAssetFormatters.ts')
const {
  filterAndSortKnowledgeDocuments,
  filterAndSortMemories,
  hasKnowledgeAssetFilters,
  hasMemoryAssetFilters,
  knowledgeAssetEmptyMessage,
  memoryAssetEmptyMessage,
  sortKnowledgeDocuments,
  sortMemories,
} = require('../src/services/contextAssetFilters.ts')
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
const { classifyMemoryCandidateForTest, importKnowledgeFile, importKnowledgePlainText, retrieveContext, extractMemories } = require('../src/services/context.ts')
const { executeAndroidDeviceTool, listAndroidDeviceToolManifests } = require('../src/services/androidDeviceTools.ts')
const { exportContextSnapshot, importContextSnapshot, listKnowledgeDocuments, searchKnowledge, searchMemories, updateMemoryStatus } = require('../src/services/contextStore.ts')
const { searchKnowledgeWithFallback, searchAgenticKnowledgeWithScope } = require('../src/services/knowledgeRetrievalRuntime.ts')
const { runRagGoldEvaluation } = require('../src/services/ragEvaluation.ts')
const {
  LOCAL_EMBEDDING_MODELS,
  deleteDownloadedLocalEmbeddingModel,
  downloadLocalEmbeddingModel,
  formatModelBytes,
  listLocalEmbeddingModelViews,
  localModelCacheKey,
  sha256BytesForTest,
  sha256ChunksForTest,
  verifyLocalEmbeddingModel,
} = require('../src/services/localEmbeddingModels.ts')
const { isDownloadableLocalModel, localCapabilityEnabled, splitLocalModelViews } = require('../src/services/contextLocalModelRules.ts')
const { lazyEmbedding } = require('../src/services/lazyEmbedding.ts')
const {
  checkLatestApkRelease,
  compareReleaseToSnapshotForTest,
  downloadAndOpenApkInstaller,
  normalizeApkUpdateManifestForTest,
  selectApkAssetForTest,
  shouldRecordApkUpdateCheck,
} = require('../src/services/appUpdates.ts')
const { clearStagedApkDownloads } = require('../src/services/apkInstallCache.ts')
const { logRenderError, logStorageOperationFailure } = require('../src/services/runtimeHealthLog.ts')
const {
  getProviderModelDisplayCandidates,
} = require('../src/services/ai/policy/providerModelAccess.ts')
const modelCatalog = require('../assets/models/catalog.json')
const { pickDocument, pickImage, takePhoto } = require('../src/services/attachment.ts')
const {
  attachmentHasPayload,
  filterSendableAttachments,
  sanitizeAttachmentsForPersistence,
} = require('../src/services/attachmentContract.ts')
const { localDataStore } = require('../src/services/localDataStore.ts')
const { speakText, stopSpeaking, transcribeLocalAudio } = require('../src/services/speech.ts')
const { clearAllData, exportAllData, importAllData, importAllDataDetailed, loadData, saveData } = require('../src/services/storage.ts')
const { buildEstimatedUsage, estimateMessageTokens, estimateTextTokens } = require('../src/services/tokenUsage.ts')
const { useChatStore } = require('../src/store/chatStore.ts')
const { useSettingsStore } = require('../src/store/settingsStore.ts')
const {
  clearActiveStream,
  getActiveStream,
  registerStreamAborter,
  setActiveStream,
} = require('../src/services/chatStreamLifecycle.ts')
const {
  saveCompactState,
  listActiveCompactStates,
  invalidateAllCompactStates,
  invalidateCompactStatesByProvider,
} = require('../src/services/ai/compact/compactStateStore.ts')
const {
  loadProviderHealthSnapshot,
  mergeProviderHealthRecords,
} = require('../src/services/ai/providerHealthStore.ts')

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
  sharedFiles.length = 0
  nextDocumentPickerResult = null
  nextImageLibraryResult = null
  nextCameraResult = null
  nextManipulateResultFactory = null
  nextSqliteOpenError = null
  nextReadDirectoryEntries = null
  sharingAvailable = false
  supportedCpuArchitectures.splice(0, supportedCpuArchitectures.length, 'arm64-v8a', 'armeabi-v7a')
  expoDeviceModuleAvailable = true
  reactNativePlatform.OS = 'test'
  resetAsyncStorageFaults()
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
    chatWorkspaceSource.includes("@/services/providerModelHealth"),
    'ChatWorkspace routes model health checks through the provider model health boundary'
  )
  assert.ok(
    !chatWorkspaceSource.includes("@/services/ai/base"),
    'ChatWorkspace does not import provider transport test helpers directly'
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
    route: {
      endpoint: `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=${FAKE_KEY_A}`,
      fallback: 'https://proxy.example/chat?token=runtime-token-secret',
    },
    headerText: 'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==; proxy-authorization: bearer abcdefghijklmnopqrstuvwxyz123456',
    body: JSON.stringify({ model: 'gpt-5.2', input: [{ content: 'secret prompt text' }] }),
  }, { enabled: true, maxBytes: 4096 })
  const content = localFileFixtures.get(uri)?.toString('utf8') ?? ''
  const entry = JSON.parse(content.trim())
  assert.equal(entry.schema, 'islemind.runtime-log.v1', 'runtime log writes JSONL schema')
  assert.equal(entry.event, 'upstream.request', 'runtime log writes event family')
  assert.equal(entry.authorization, '[redacted]', 'runtime log file redacts authorization')
  assert.equal(entry.route.endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:streamGenerateContent?alt=sse&key=[redacted]', 'runtime log file redacts sensitive query-string API keys')
  assert.equal(entry.route.fallback, 'https://proxy.example/chat?token=[redacted]', 'runtime log file redacts sensitive query-string token parameters')
  assert.equal(entry.headerText, 'Authorization: Basic [redacted]; proxy-authorization: bearer [redacted]', 'runtime log file redacts header-like authorization strings')
  assert.deepEqual(entry.body.keys, ['input', 'model'], 'runtime log file stores payload keys only')
  assert.ok(!content.includes('secret prompt text'), 'runtime log file omits raw prompt text')
  assert.ok(!content.includes(FAKE_KEY_A), 'runtime log file omits raw query-string API key values')
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
  localFileFixtures.set(uri, Buffer.from([
    JSON.stringify({ index: 1, note: 'x'.repeat(13000) }),
    JSON.stringify({ index: 2, event: 'upstream.request' }),
    JSON.stringify({ index: 3, event: 'upstream.response' }),
    '',
  ].join('\n'), 'utf8'))
  const parsedTailEntries = (await readRuntimeLogText())
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  assert.deepEqual(parsedTailEntries.map((entry) => entry.index), [2, 3], 'runtime log tail drops truncated leading fragments and keeps full JSONL lines')
  await clearRuntimeLog()
  assert.equal(localFileFixtures.has(uri), false, 'runtime log clear deletes the log file')

  await Promise.all([
    appendRuntimeLog('upstream.request', { providerId: 'openai-main', model: 'gpt-5.2', requestId: 'req-1' }, { enabled: true, maxBytes: 4096 }),
    appendRuntimeLog('upstream.response', { providerId: 'openai-main', model: 'gpt-5.2', requestId: 'req-1', status: 200 }, { enabled: true, maxBytes: 4096 }),
  ])
  const concurrentEntries = (localFileFixtures.get(uri)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    concurrentEntries.map((entry) => entry.event),
    ['upstream.request', 'upstream.response'],
    'runtime log serializes concurrent appends without dropping entries'
  )

  const appendThenClear = appendRuntimeLog('compact.usage', { providerId: 'openai-main', status: 'completed' }, { enabled: true, maxBytes: 4096 })
  const clearWhileAppendPending = clearRuntimeLog()
  await Promise.all([appendThenClear, clearWhileAppendPending])
  assert.equal(localFileFixtures.has(uri), false, 'runtime log clear waits for pending writes before deleting the file')
}

async function assertRuntimeDiagnosticsBehavior() {
  await clearRuntimeLog()
  await appendRuntimeLog('provider.conformance', { protocol: 'openai-responses', providerId: 'openai-main' }, { enabled: true, maxBytes: 4096 })
  await appendRuntimeLog('transport.fallback', { from: 'responses_websocket', to: 'http_sse', providerId: 'openai-main' }, { enabled: true, maxBytes: 4096 })
  clearCompactUsageRecords()
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 1000 })
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 1000, outputTokens: 120, estimatedSavedTokens: 430 })
  recordCompactUsage({
    mode: 'auto',
    providerId: 'fallback',
    model: 'manual-model',
    fallbackLocal: true,
    decisionReason: 'below_threshold',
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
  assert.equal(summary.compact.readyProviders, 1, 'runtime diagnostics counts ready compact providers')
  assert.equal(summary.compact.fallbackReasons.belowThreshold, 1, 'runtime diagnostics counts local fallback below-threshold decisions')
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
  assert.equal(summary.responses.capableProviders, 1, 'runtime diagnostics counts responses-capable providers')
  assert.equal(summary.responses.readyProviders, 1, 'runtime diagnostics counts ready responses providers')
  assert.equal(summary.responses.activeProtocols['openai-responses'], 1, 'runtime diagnostics summarizes observed active response protocols from runtime logs')
  assert.equal(summary.websocket.fallbackCount, 1, 'runtime diagnostics counts observed WebSocket fallbacks from runtime logs')
  assert.deepEqual(
    summary.capabilityMatrix.hostingProfiles,
    { official: 1, aggregator: 0, relay: 1, 'local-runtime': 0, 'cloud-hosted': 0 },
    'runtime diagnostics reports provider hosting-profile coverage buckets'
  )
  assert.equal(summary.capabilityMatrix.supportLevels.partial, 2, 'runtime diagnostics reports support-level summaries')
  assert.equal(summary.capabilityMatrix.hostedGapProviders, 0, 'runtime diagnostics reports zero hosted gaps when no hosted providers are configured')
  assert.equal(summary.capabilityMatrix.genericModelListSuppressedProviders, 1, 'runtime diagnostics reports providers that intentionally suppress generic model-list sync')
  const invalidProxySummary = await buildRuntimeDiagnosticsSummary({
    providers: [openAiPreset, customProvider],
    settings: {
      transportMode: 'websocket',
      remoteCompactMode: 'auto',
      payloadPolicyMode: 'block',
      proxyMode: 'custom-base-url',
      proxyBaseUrl: 'file:///tmp/proxy',
      providerAllowlist: ['openai-*'],
      modelBlocklist: ['bad-*'],
      runtimeLogEnabled: true,
      runtimeLogMaxBytes: 4096,
    },
  })
  assert.equal(invalidProxySummary.proxy.applied, false, 'runtime diagnostics rejects non-web custom proxy base URLs')
  assert.equal(invalidProxySummary.proxy.reason, 'invalid_custom_base_url', 'runtime diagnostics records invalid custom proxy base URLs')

  const hostedSummary = await buildRuntimeDiagnosticsSummary({
    providers: [
      openAiPreset,
      {
        id: 'azure',
        type: 'openai-compatible',
        name: 'Azure OpenAI',
        baseUrl: 'https://example.openai.azure.com/openai/v1',
        apiKey: '',
        models: ['gpt-4.1'],
        enabled: true,
        capabilities: { ...customProvider.capabilities, modelList: true },
      },
    ],
    settings: {
      transportMode: 'auto',
      remoteCompactMode: 'auto',
      payloadPolicyMode: 'warn',
      proxyMode: 'off',
      runtimeLogEnabled: false,
      runtimeLogMaxBytes: 4096,
    },
  })
  assert.equal(hostedSummary.capabilityMatrix.hostingProfiles['cloud-hosted'], 1, 'runtime diagnostics classifies hosted providers separately')
  assert.equal(hostedSummary.capabilityMatrix.plannedProviders, 0, 'runtime diagnostics does not count Azure OpenAI v1 as a hosted implementation gap')
  assert.equal(hostedSummary.capabilityMatrix.hostedGapProviders, 0, 'runtime diagnostics keeps hosted gaps for providers without a supported hosted route')

  const hostedGapSummary = await buildRuntimeDiagnosticsSummary({
    providers: [
      openAiPreset,
      {
        id: 'bedrock',
        type: 'anthropic',
        name: 'AWS Bedrock',
        presetId: 'aws-bedrock',
        baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        apiKey: '',
        models: ['anthropic.claude-3-7-sonnet'],
        enabled: true,
      },
      {
        id: 'vertex-native',
        type: 'openai-compatible',
        name: 'Vertex AI',
        presetId: 'vertex-ai',
        baseUrl: 'https://us-central1-aiplatform.googleapis.com',
        apiKey: '',
        models: ['gemini-2.5-pro'],
        enabled: true,
      },
      {
        id: 'vertex-openai',
        type: 'openai-compatible',
        name: 'Vertex AI OpenAI',
        presetId: 'vertex-ai',
        baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/islemind-dev/locations/us-central1/endpoints/openapi',
        apiKey: '',
        models: ['gemini-2.5-pro'],
        enabled: true,
      },
    ],
    settings: {
      transportMode: 'auto',
      remoteCompactMode: 'auto',
      payloadPolicyMode: 'warn',
      proxyMode: 'off',
      runtimeLogEnabled: false,
      runtimeLogMaxBytes: 4096,
    },
  })
  assert.equal(hostedGapSummary.capabilityMatrix.hostingProfiles['cloud-hosted'], 3, 'runtime diagnostics counts Bedrock and Vertex AI as hosted providers')
  assert.equal(hostedGapSummary.capabilityMatrix.plannedProviders, 2, 'runtime diagnostics counts hosted providers that still need dedicated auth and path implementation')
  assert.equal(hostedGapSummary.capabilityMatrix.hostedGapProviders, 2, 'runtime diagnostics reports Bedrock and native Vertex AI hosted gaps explicitly')
}

async function assertRuntimeDiagnosticsFailurePath() {
  const settingsScreenSource = fs.readFileSync(path.join(root, 'src/components/main/SettingsScreenContent.tsx'), 'utf8')
  assert.ok(settingsScreenSource.includes('runtimeDiagnosticsRefreshFailed'), 'settings diagnostics exposes refresh failure feedback')
  assert.ok(settingsScreenSource.includes('runtimeLogCopyFailed'), 'settings diagnostics exposes copy failure feedback')
  assert.ok(settingsScreenSource.includes('runtimeLogShareFailed'), 'settings diagnostics exposes share failure feedback')
  assert.ok(settingsScreenSource.includes('runtimeLogClearFailed'), 'settings diagnostics exposes clear failure feedback')
  assert.ok(settingsScreenSource.includes('const logInfo = await getRuntimeLogInfo()'), 'settings diagnostics checks runtime log file metadata before sharing')
  assert.ok(settingsScreenSource.includes('if (!logInfo.exists || logInfo.size <= 0)'), 'settings diagnostics falls back to copy when the runtime log file is missing or empty')
  assert.ok(settingsScreenSource.includes('finally {'), 'settings diagnostics resets refreshing state in a finally block')
}

async function assertAppUpdateRuntimeLogging() {
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  resetLocalModelFileMocks()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })
  reactNativePlatform.OS = 'android'
  const originalFetchForUpdateLogging = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
  })
  try {
    const result = await checkLatestApkRelease()
    assert.equal(result.status, 'error', 'APK update logging test reaches an error result')
    const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const updateEntry = entries.find((entry) => entry.event === 'app.update' && entry.phase === 'check')
    assert.ok(updateEntry, 'APK update checks append runtime log entries')
    assert.equal(updateEntry.status, 'error', 'APK update runtime log records check status')
    assert.equal(updateEntry.reason, 'rate_limited', 'APK update runtime log records failure reason')
  } finally {
    global.fetch = originalFetchForUpdateLogging
    reactNativePlatform.OS = 'test'
  }

  localFileFixtures.delete(runtimeLogPath)
  resetLocalModelFileMocks()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096 })
  reactNativePlatform.OS = 'android'
  const originalFetchForDisabledUpdateLogging = global.fetch
  global.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({}),
  })
  try {
    const disabledResult = await checkLatestApkRelease()
    assert.equal(disabledResult.status, 'error', 'APK update checks keep the same error result when runtime logs are disabled')
    assert.equal(localFileFixtures.has(runtimeLogPath), false, 'APK update checks stay quiet when runtime logs are disabled')
  } finally {
    global.fetch = originalFetchForDisabledUpdateLogging
    reactNativePlatform.OS = 'test'
  }
}

async function assertStorageFailureRuntimeLogging() {
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  resetAsyncStorageFaults()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })
  asyncStorageFaults.setItem = new Error('storage token=super-secret-value')
  try {
    await saveData('PROVIDERS', [{ id: 'broken' }])
  } finally {
    resetAsyncStorageFaults()
  }
  const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const storageEntry = entries.find((entry) => entry.event === 'storage.operation' && entry.operation === 'save')
  assert.ok(storageEntry, 'storage persistence failures append runtime log entries')
  assert.equal(storageEntry.storageKey, 'PROVIDERS', 'storage persistence log records the storage key')
  assert.equal(storageEntry.status, 'error', 'storage persistence log records error status')
  assert.equal(storageEntry.errorText, 'storage token=[redacted]', 'storage persistence log redacts sensitive error text')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  resetAsyncStorageFaults()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096 })
  await logStorageOperationFailure({
    operation: 'save',
    storageKey: 'PROVIDERS',
    error: new Error('storage token=super-secret-value'),
  })
  assert.equal(localFileFixtures.has(runtimeLogPath), false, 'storage persistence failures stay quiet when runtime logs are disabled')
}

async function assertRenderGuardRuntimeLogging() {
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })
  await logRenderError({
    label: 'message-bubble',
    compact: true,
    fallbackText: 'assistant raw output',
    componentStack: '\n at MessageBubble',
    error: new Error('render token=super-secret-value'),
  })
  const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const renderEntry = entries.find((entry) => entry.event === 'render.error')
  assert.ok(renderEntry, 'render guard failures append runtime log entries')
  assert.equal(renderEntry.label, 'message-bubble', 'render guard log records the failing label')
  assert.equal(renderEntry.compact, true, 'render guard log records compact state')
  assert.equal(renderEntry.fallbackTextPresent, true, 'render guard log records fallback availability without storing raw fallback text')
  assert.equal(renderEntry.errorText, 'render token=[redacted]', 'render guard log redacts sensitive render errors')
  assert.ok(!JSON.stringify(renderEntry).includes('assistant raw output'), 'render guard log does not persist raw fallback content')
  const renderGuardSource = fs.readFileSync(path.join(root, 'src/components/ui/RenderGuard.tsx'), 'utf8')
  assert.ok(renderGuardSource.includes('void logRenderError({'), 'RenderGuard routes componentDidCatch failures into runtime logging')
  assert.ok(renderGuardSource.includes('componentStack: info.componentStack'), 'RenderGuard runtime log keeps component stack context')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096 })
  await logRenderError({
    label: 'message-bubble',
    compact: true,
    fallbackText: 'assistant raw output',
    componentStack: '\n at MessageBubble',
    error: new Error('render token=super-secret-value'),
  })
  assert.equal(localFileFixtures.has(runtimeLogPath), false, 'render guard failures stay quiet when runtime logs are disabled')
}

async function assertMcpRuntimeLogging() {
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })
  const invalidRuntimeMcpServer = {
    id: 'mcp-runtime-invalid',
    name: 'Runtime Invalid MCP',
    url: 'islemind://external-mcp',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    manifestTtlMs: 1000,
    tools: [{ name: 'read_remote_fixture', permission: 'read-only', enabled: true, serverId: 'mcp-runtime-invalid' }],
    resources: [],
    prompts: [],
    approvedToolNames: ['read_remote_fixture'],
    createdAt: 1,
    updatedAt: 1,
  }
  const originalFetchForInvalidMcp = global.fetch
  try {
    global.fetch = async () => {
      throw new Error('invalid MCP URLs must not reach fetch')
    }
    const invalidMcpCallResult = await callMcpTool(invalidRuntimeMcpServer, 'read_remote_fixture', {})
    assert.equal(invalidMcpCallResult.ok, false, 'MCP runtime rejects invalid non-web server URLs before execution')
    assert.equal(invalidMcpCallResult.trace.status, 'skipped', 'invalid MCP runtime URLs fail closed before tool execution')
    const invalidMcpRefreshResult = await refreshMcpManifest(invalidRuntimeMcpServer)
    assert.equal(invalidMcpRefreshResult.status, 'error', 'manifest refresh rejects invalid non-web MCP server URLs before fetch')
  } finally {
    global.fetch = originalFetchForInvalidMcp
  }
  const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const toolCallEntry = entries.find((entry) => entry.event === 'mcp.operation' && entry.phase === 'tool_call' && entry.detail === 'non_http_server_url')
  assert.ok(toolCallEntry, 'MCP tool failures append runtime log entries')
  assert.equal(toolCallEntry.status, 'skipped', 'MCP tool runtime log records skipped boundary failures')
  assert.equal(toolCallEntry.serverId, 'mcp-runtime-invalid', 'MCP tool runtime log records the server id')
  const refreshEntry = entries.find((entry) => entry.event === 'mcp.operation' && entry.phase === 'manifest_refresh' && entry.detail === 'non_http_server_url')
  assert.ok(refreshEntry, 'MCP manifest refresh failures append runtime log entries')
  assert.equal(refreshEntry.status, 'skipped', 'MCP manifest runtime log records skipped boundary failures')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096 })
  const originalFetchForDisabledMcp = global.fetch
  try {
    global.fetch = async () => {
      throw new Error('invalid MCP URLs must not reach fetch')
    }
    await callMcpTool(invalidRuntimeMcpServer, 'read_remote_fixture', {})
    await refreshMcpManifest(invalidRuntimeMcpServer)
  } finally {
    global.fetch = originalFetchForDisabledMcp
  }
  assert.equal(localFileFixtures.has(runtimeLogPath), false, 'MCP runtime health events stay quiet when runtime logs are disabled')
}

async function assertContextRuntimeLogging() {
  resetLocalModelFileMocks()
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })

  nextSqliteOpenError = new Error('context init token=super-secret-value')
  const retrieved = await retrieveContext(
    { id: 'conv-1', title: 'Test', providerId: 'provider-1', model: 'model-1', messages: [], createdAt: 1, updatedAt: 1 },
    { id: 'msg-1', role: 'user', content: 'hello', timestamp: 1, status: 'done' }
  )
  assert.deepEqual(retrieved, { sources: [], prompt: '' }, 'context retrieval still fails closed when initialization fails')

  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/broken-knowledge.txt',
      name: 'broken-knowledge.txt',
      mimeType: 'text/plain',
      size: 24,
    }],
  }
  localFileFixtures.set('file:///tmp/broken-knowledge.txt', Buffer.from('broken import text', 'utf8'))
  nextSqliteOpenError = new Error('knowledge import token=super-secret-value')
  await assert.rejects(
    () => importKnowledgeFile(),
    /knowledge import token=super-secret-value/,
    'knowledge import still surfaces fatal initialization failures'
  )

  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096, memoryEnabled: true })
  const originalFetchForContext = global.fetch
  try {
    global.fetch = async () => { throw new Error('memory extract token=super-secret-value') }
    const extracted = await extractMemories(
      'conv-2',
      [
        { id: 'msg-u1', role: 'user', content: 'I prefer terse answers.', timestamp: 1, status: 'done' },
        { id: 'msg-a1', role: 'assistant', content: 'ok', timestamp: 2, status: 'done' },
      ],
      {
        id: 'provider-openai',
        type: 'openai',
        name: 'OpenAI',
        apiKey: FAKE_KEY_A,
        models: ['gpt-5.2'],
        enabled: true,
      },
      'gpt-5.2'
    )
    assert.ok(extracted.some((item) => item.includes('用户偏好')), 'deterministic memory extraction still returns fallback items when model extraction fails')
  } finally {
    global.fetch = originalFetchForContext
  }

  const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const initEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'initialize' && entry.detail === 'retrieve_context')
  assert.ok(initEntry, 'context initialization failures append runtime log entries')
  assert.equal(initEntry.status, 'error', 'context initialization runtime log records error status')
  assert.equal(initEntry.errorText, 'context init token=[redacted]', 'context initialization runtime log redacts sensitive error text')
  const importEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'knowledge_import' && entry.detail === 'import_knowledge_file_failed')
  assert.ok(importEntry, 'context knowledge import failures append runtime log entries')
  assert.equal(importEntry.title, 'broken-knowledge.txt', 'context knowledge import runtime log records the source title')
  assert.equal(importEntry.errorText, 'knowledge import token=[redacted]', 'context knowledge import runtime log redacts sensitive error text')
  const memoryEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'memory_extract' && entry.detail === 'model_extraction_failed')
  assert.ok(memoryEntry, 'context memory extraction failures append runtime log entries')
  assert.equal(memoryEntry.providerId, 'provider-openai', 'context memory extraction runtime log records provider identity')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096, memoryEnabled: true })

  const contextStoreModule = require('../src/services/contextStore.ts')
  const originalInitializeContextStore = contextStoreModule.initializeContextStore
  try {
    contextStoreModule.initializeContextStore = async () => {
      throw new Error('context init token=super-secret-value')
    }
    const disabledRetrieved = await retrieveContext(
      { id: 'conv-1b', title: 'Test', providerId: 'provider-1', model: 'model-1', messages: [], createdAt: 1, updatedAt: 1 },
      { id: 'msg-1b', role: 'user', content: 'hello again', timestamp: 1, status: 'done' }
    )
    assert.deepEqual(disabledRetrieved, { sources: [], prompt: '' }, 'context retrieval keeps the same fail-closed result when runtime logs are disabled')
  } finally {
    contextStoreModule.initializeContextStore = originalInitializeContextStore
  }

  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/broken-knowledge-disabled.txt',
      name: 'broken-knowledge-disabled.txt',
      mimeType: 'text/plain',
      size: 24,
    }],
  }
  localFileFixtures.set('file:///tmp/broken-knowledge-disabled.txt', Buffer.from('broken import text', 'utf8'))
  try {
    contextStoreModule.initializeContextStore = async () => {
      throw new Error('knowledge import token=super-secret-value')
    }
    await assert.rejects(
      () => importKnowledgeFile(),
      /knowledge import token=super-secret-value/,
      'knowledge import still surfaces fatal initialization failures when runtime logs are disabled'
    )
  } finally {
    contextStoreModule.initializeContextStore = originalInitializeContextStore
  }

  try {
    contextStoreModule.initializeContextStore = async () => {
      throw new Error('plain text import token=super-secret-value')
    }
    await assert.rejects(
      () => importKnowledgePlainText('disabled-note', 'disabled plain text body'),
      /plain text import token=super-secret-value/,
      'plain text knowledge import still surfaces fatal initialization failures when runtime logs are disabled'
    )
  } finally {
    contextStoreModule.initializeContextStore = originalInitializeContextStore
  }

  const originalFetchForDisabledContext = global.fetch
  try {
    global.fetch = async () => { throw new Error('memory extract token=super-secret-value') }
    const disabledExtracted = await extractMemories(
      'conv-2b',
      [
        { id: 'msg-u2', role: 'user', content: 'I prefer ultra-terse disabled-mode answers.', timestamp: 1, status: 'done' },
        { id: 'msg-a2', role: 'assistant', content: 'ok', timestamp: 2, status: 'done' },
      ],
      {
        id: 'provider-openai',
        type: 'openai',
        name: 'OpenAI',
        apiKey: FAKE_KEY_A,
        models: ['gpt-5.2'],
        enabled: true,
      },
      'gpt-5.2'
    )
    assert.ok(disabledExtracted.some((item) => item.includes('ultra-terse disabled-mode answers')), 'deterministic memory extraction still returns fallback items when runtime logs are disabled')
  } finally {
    global.fetch = originalFetchForDisabledContext
  }

  assert.equal(localFileFixtures.has(runtimeLogPath), false, 'context runtime health events stay quiet when runtime logs are disabled')
}

async function assertKnowledgeRetrievalRuntimeLogging() {
  resetLocalModelFileMocks()
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })

  const originalSearchHybrid = localDataStore.searchHybrid
  const originalSearchAgenticIndexes = localDataStore.searchAgenticIndexes
  try {
    localDataStore.searchHybrid = async () => { throw new Error('hybrid retrieval token=super-secret-value') }
    const fallbackResults = await searchKnowledgeWithFallback({
      query: 'fallback query',
      limit: 4,
      ragMode: 'hybrid',
      embeddingMode: 'hybrid',
    })
    assert.deepEqual(fallbackResults, [], 'knowledge retrieval falls back to empty results when both hybrid and FTS search fail')

    localDataStore.searchAgenticIndexes = async () => { throw new Error('agentic retrieval token=super-secret-value') }
    const agenticResults = await searchAgenticKnowledgeWithScope({
      query: 'agentic query',
      limit: 4,
      techniques: ['raptor'],
    })
    assert.deepEqual(agenticResults, [], 'agentic retrieval still fails closed when advanced search throws')
  } finally {
    localDataStore.searchHybrid = originalSearchHybrid
    localDataStore.searchAgenticIndexes = originalSearchAgenticIndexes
  }

  const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const hybridEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'knowledge_retrieval' && entry.detail === 'hybrid_search_failed')
  assert.ok(hybridEntry, 'hybrid retrieval failures append runtime log entries')
  assert.equal(hybridEntry.errorText, 'hybrid retrieval token=[redacted]', 'hybrid retrieval runtime log redacts sensitive error text')
  const fallbackEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'knowledge_retrieval' && entry.detail === 'fts_fallback_applied')
  assert.ok(fallbackEntry || entries.find((entry) => entry.detail === 'fts_fallback_failed'), 'knowledge retrieval runtime log records fallback outcomes after hybrid failure')
  const agenticEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'knowledge_retrieval' && entry.detail === 'agentic_search_failed')
  assert.ok(agenticEntry, 'agentic retrieval failures append runtime log entries')
  assert.equal(agenticEntry.errorText, 'agentic retrieval token=[redacted]', 'agentic retrieval runtime log redacts sensitive error text')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096 })

  const originalSearchHybridDisabled = localDataStore.searchHybrid
  const originalSearchAgenticIndexesDisabled = localDataStore.searchAgenticIndexes
  try {
    localDataStore.searchHybrid = async () => { throw new Error('hybrid retrieval token=super-secret-value') }
    const disabledFallbackResults = await searchKnowledgeWithFallback({
      query: 'fallback query disabled',
      limit: 4,
      ragMode: 'hybrid',
      embeddingMode: 'hybrid',
    })
    assert.deepEqual(disabledFallbackResults, [], 'knowledge retrieval keeps the same fail-closed result when runtime logs are disabled')

    localDataStore.searchAgenticIndexes = async () => { throw new Error('agentic retrieval token=super-secret-value') }
    const disabledAgenticResults = await searchAgenticKnowledgeWithScope({
      query: 'agentic query disabled',
      limit: 4,
      techniques: ['raptor'],
    })
    assert.deepEqual(disabledAgenticResults, [], 'agentic retrieval keeps the same fail-closed result when runtime logs are disabled')
  } finally {
    localDataStore.searchHybrid = originalSearchHybridDisabled
    localDataStore.searchAgenticIndexes = originalSearchAgenticIndexesDisabled
  }

  assert.equal(localFileFixtures.has(runtimeLogPath), false, 'knowledge retrieval runtime health events stay quiet when runtime logs are disabled')
}

async function assertKnowledgeEmbeddingRuntimeLogging() {
  resetLocalModelFileMocks()
  const runtimeLogPath = getRuntimeLogPath()
  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096 })

  const onnxProvider = await createOnnxEmbeddingProvider({
    localEmbeddingModelId: 'all-MiniLM-L6-v2',
    localEmbeddingModelSource: 'downloaded',
  })
  assert.ok(onnxProvider, 'ONNX provider factory still returns a provider object when a downloaded model may be configured')
  assert.equal(await onnxProvider.available(), false, 'ONNX provider reports unavailable when no downloaded model files are actually present')

  const entries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const embeddingEntry = entries.find((entry) => entry.event === 'context.operation' && entry.phase === 'knowledge_embedding' && entry.detail === 'onnx_provider_unavailable')
  assert.ok(embeddingEntry, 'ONNX availability failures append runtime log entries')
  assert.match(String(embeddingEntry.errorText ?? ''), /No embedding model available|not bundled/, 'ONNX availability runtime log preserves the failure reason')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: true, runtimeLogMaxBytes: 4096, localEmbeddingModelSource: 'none' })
  lazyEmbedding.unload()
  await assert.rejects(
    () => lazyEmbedding.embed('hello'),
    /No embedding model available/,
    'lazy embedding still surfaces the no-model failure to callers'
  )
  const lazyEntries = (localFileFixtures.get(runtimeLogPath)?.toString('utf8') ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const lazyEntry = lazyEntries.find((entry) => entry.event === 'context.operation' && entry.phase === 'knowledge_embedding' && entry.detail === 'lazy_embedding_model_unavailable')
  assert.ok(lazyEntry, 'lazy embedding no-model failures append runtime log entries')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096, localEmbeddingModelSource: 'downloaded', localEmbeddingModelId: 'all-MiniLM-L6-v2' })

  const disabledOnnxProvider = await createOnnxEmbeddingProvider({
    localEmbeddingModelId: 'all-MiniLM-L6-v2',
    localEmbeddingModelSource: 'downloaded',
  })
  assert.ok(disabledOnnxProvider, 'ONNX provider factory still returns a provider object when runtime logs are disabled')
  assert.equal(await disabledOnnxProvider.available(), false, 'ONNX availability keeps the same failure result when runtime logs are disabled')

  localFileFixtures.delete(runtimeLogPath)
  memoryStorage.clear()
  await saveData('SETTINGS', { runtimeLogEnabled: false, runtimeLogMaxBytes: 4096, localEmbeddingModelSource: 'none' })
  lazyEmbedding.unload()
  await assert.rejects(
    () => lazyEmbedding.embed('hello disabled'),
    /No embedding model available/,
    'lazy embedding still surfaces the no-model failure when runtime logs are disabled'
  )
  assert.equal(localFileFixtures.has(runtimeLogPath), false, 'knowledge embedding runtime health events stay quiet when runtime logs are disabled')
}

async function assertUpstreamGovernanceBehavior() {
  const originalFetchForHttpHelper = global.fetch
  try {
    let helperFetchSawAbortSignal = false
    global.fetch = async (_url, init) => {
      helperFetchSawAbortSignal = init?.signal instanceof AbortSignal
      return new Response('helper ok', { status: 200 })
    }
    const helperResponse = await fetchWithTimeout('https://helper.example/test', { method: 'GET' }, 1000)
    assert.equal(await helperResponse.text(), 'helper ok', 'provider HTTP helper returns the delegated fetch response')
    assert.equal(helperFetchSawAbortSignal, true, 'provider HTTP helper forwards an abort signal')
  } finally {
    global.fetch = originalFetchForHttpHelper
  }
  assert.equal(
    await safeResponseText({ text: async () => { throw new Error('read failed') } }),
    '',
    'provider HTTP helper returns blank text when response body reading fails'
  )
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
  assert.deepEqual(
    stripThinkingBlocks({
      thinking: { type: 'enabled' },
      output_config: { effort: 'high' },
      messages: [{ role: 'assistant', content: [{ type: 'redacted_thinking', text: 'hidden' }, { type: 'text', text: 'answer' }, { type: 'signature_delta', signature: 'bad' }] }],
    }),
    { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'answer' }] }] },
    'Anthropic rectification helper strips thinking and signature content parts'
  )

  const budgetRectified = rectifyAnthropicRequestBodyForTest({
    req: anthropicReq,
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', messages: [], max_tokens: 2048 }),
    errorText: 'budget_tokens must be at least 1024 and comply with the max_tokens constraint',
    rectified: false,
  })
  assert.equal(budgetRectified.kind, 'thinking_budget', 'Anthropic budget rectification is detected')
  assert.deepEqual(budgetRectified.body.thinking, { type: 'enabled', budget_tokens: 32000 }, 'budget rectification normalizes thinking to 32000 tokens')
  assert.equal(budgetRectified.body.max_tokens, 64000, 'budget rectification raises max_tokens when needed')
  assert.deepEqual(
    normalizeAnthropicThinkingBudgetBody({ max_tokens: 96000, messages: [] }),
    { max_tokens: 96000, messages: [], thinking: { type: 'enabled', budget_tokens: 32000 } },
    'Anthropic rectification helper preserves already-large max_tokens'
  )
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
  assert.equal(isBedrockProvider({ id: 'aws-bedrock', type: 'anthropic', name: 'Amazon Bedrock', baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com' }), true, 'Bedrock optimizer helper detects Bedrock runtime hosts')
  assert.equal(isAnthropicWireProvider({ type: 'xiaomi-mimo', wireProtocol: 'anthropic-compatible' }), true, 'Bedrock optimizer helper detects Anthropic-compatible wire protocol')
  assert.deepEqual(
    getHeaders({ id: 'anthropic-main', type: 'anthropic', name: 'Anthropic', apiKey: FAKE_KEY_A, models: [], enabled: true }),
    { 'Content-Type': 'application/json', 'x-api-key': FAKE_KEY_A, 'anthropic-version': '2023-06-01' },
    'provider header helper preserves official Anthropic headers'
  )
  assert.deepEqual(
    getHeaders({ id: 'mimo-anthropic', type: 'xiaomi-mimo', name: 'MiMo Anthropic', apiKey: FAKE_KEY_A, models: [], enabled: true, wireProtocol: 'anthropic-compatible' }),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${FAKE_KEY_A}`, 'anthropic-version': '2023-06-01' },
    'provider header helper preserves Anthropic-compatible bearer headers'
  )
  assert.deepEqual(
    getHeaders({ id: 'google-main', type: 'google', name: 'Google', apiKey: FAKE_KEY_A, models: [], enabled: true }),
    { 'Content-Type': 'application/json' },
    'provider header helper keeps Google API keys out of headers'
  )
  assert.deepEqual(
    getHeaders({ id: 'azure-openai-main', type: 'openai-compatible', name: 'Azure OpenAI', baseUrl: 'https://example.openai.azure.com/openai/v1', apiKey: FAKE_KEY_A, models: [], enabled: true }),
    { 'Content-Type': 'application/json', 'api-key': FAKE_KEY_A },
    'provider header helper uses Azure OpenAI API-key authentication for Azure v1 endpoints'
  )
  assert.equal(
    getWireProviderType({ id: 'custom-anthropic', type: 'openai-compatible', name: 'Custom Anthropic', apiKey: FAKE_KEY_A, models: [], enabled: true, wireProtocol: 'anthropic-compatible' }),
    'anthropic',
    'provider wire helper maps Anthropic-compatible providers to Anthropic parsing'
  )
  assert.equal(
    isAnthropicWireRequest({ provider: { id: 'mimo-anthropic', type: 'xiaomi-mimo', name: 'MiMo Anthropic', apiKey: FAKE_KEY_A, models: [], enabled: true, wireProtocol: 'anthropic-compatible' } }),
    true,
    'provider wire helper detects Anthropic-compatible requests'
  )
  assert.equal(supportsAnthropicAdaptiveThinking('claude-opus-4-7'), true, 'Anthropic thinking helper keeps adaptive model detection')
  assert.equal(usesAnthropicOutputConfigOnlyThinking('claude-fable-5'), true, 'Anthropic thinking helper keeps output_config-only model detection')
  assert.equal(normalizeAnthropicEffort('claude-opus-4-7', 'xhigh'), 'xhigh', 'Anthropic thinking helper keeps xhigh effort for newer Opus models')
  assert.equal(normalizeAnthropicEffort('claude-sonnet-4-20250514', 'xhigh'), 'max', 'Anthropic thinking helper maps unsupported xhigh to max')
  assert.equal(supportsAnthropicDynamicWebSearch('claude-sonnet-4-6'), true, 'Anthropic request helper detects dynamic web search models')
  assert.equal(supportsAnthropicDynamicWebSearch('claude-3-5-sonnet-20241022'), false, 'Anthropic request helper keeps legacy web search models on compatible tool type')
  assert.deepEqual(
    anthropicNativeWebSearchTool('claude-opus-4-7'),
    { type: 'web_search_20260209', name: 'web_search', max_uses: 3 },
    'Anthropic request helper keeps current web search tool shape'
  )
  assert.deepEqual(
    anthropicNativeWebSearchTool('claude-3-5-sonnet-20241022'),
    { type: 'web_search_20250305', name: 'web_search', max_uses: 3 },
    'Anthropic request helper keeps legacy web search tool shape'
  )
  assert.deepEqual(
    anthropicAttachmentPart({ id: 'anthropic-image', type: 'image', uri: 'file://image.png', name: 'image.png', mimeType: 'image/png', size: 12, base64: 'aW1n' }),
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1n' } },
    'Anthropic request helper keeps image attachment block shape'
  )
  assert.deepEqual(
    anthropicAttachmentPart({ id: 'anthropic-pdf', type: 'pdf', uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 12, base64: 'cGRm' }),
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'cGRm' } },
    'Anthropic request helper keeps PDF attachment block shape'
  )
  assert.deepEqual(
    anthropicAttachmentPart({ id: 'anthropic-text', type: 'text', uri: 'file://note.txt', name: 'note.txt', mimeType: 'text/plain', size: 12, base64: 'dHh0' }),
    { type: 'document', source: { type: 'base64', media_type: 'text/plain', data: 'dHh0' } },
    'Anthropic request helper keeps text attachment block shape'
  )
  assert.equal(
    anthropicAttachmentPart({ id: 'anthropic-document', type: 'document', uri: 'file://doc.bin', name: 'doc.bin', mimeType: 'application/octet-stream', size: 12, base64: 'ZG9j' }),
    undefined,
    'Anthropic request helper preserves unsupported document attachment omission'
  )
  assert.equal(
    anthropicAttachmentPart({ id: 'anthropic-empty', type: 'image', uri: 'file://image.png', name: 'image.png', mimeType: 'image/png', size: 12 }),
    undefined,
    'Anthropic request helper omits attachments without base64 data'
  )
  const anthropicThinkingProvider = { id: 'anthropic-main', type: 'anthropic', name: 'Anthropic', apiKey: FAKE_KEY_A, models: ['claude-opus-4-7', 'claude-fable-5', 'claude-sonnet-4-20250514'], enabled: true }
  assert.deepEqual(
    normalizeAnthropicThinking({ provider: anthropicThinkingProvider, model: 'claude-opus-4-7', reasoningEffort: 'xhigh', maxTokens: 8192 }),
    { thinking: { type: 'adaptive', display: 'summarized' }, outputConfig: { effort: 'xhigh' } },
    'Anthropic thinking helper keeps adaptive thinking plus output_config effort'
  )
  assert.deepEqual(
    normalizeAnthropicThinking({ provider: anthropicThinkingProvider, model: 'claude-fable-5', reasoningEffort: 'high', maxTokens: 8192 }),
    { outputConfig: { effort: 'high' } },
    'Anthropic thinking helper keeps output_config-only models free of request thinking'
  )
  assert.deepEqual(
    normalizeAnthropicThinking({ provider: anthropicThinkingProvider, model: 'claude-sonnet-4-20250514', reasoningEffort: 'low', maxTokens: 512 }),
    { thinking: { type: 'enabled', budget_tokens: 511 } },
    'Anthropic thinking helper keeps legacy budget constrained below max_tokens'
  )
  assert.equal(
    normalizeAnthropicThinking({ provider: anthropicThinkingProvider, model: 'claude-sonnet-4-20250514', reasoningEffort: 'minimal', maxTokens: 512 }),
    undefined,
    'Anthropic thinking helper omits none/minimal reasoning requests'
  )
  assert.deepEqual(
    optimizeBedrockThinking({ max_tokens: 2048 }, {
      provider: { id: 'bedrock-anthropic', type: 'anthropic', name: 'Bedrock Anthropic', baseUrl: 'https://bedrock-runtime.example' },
      model: 'claude-sonnet-4-20250514',
      reasoningEffort: 'medium',
      fallbackMaxTokens: 2048,
    }),
    { max_tokens: 4096, thinking: { type: 'enabled', budget_tokens: 2047 } },
    'Bedrock thinking optimizer keeps legacy thinking-budget fallback behavior'
  )
  assert.deepEqual(
    injectBedrockCache({ messages: [{ role: 'user', content: [{ type: 'tool_use', id: 'tool-1' }, { type: 'text', text: 'cache me' }] }] }, '1h').messages[0].content[1].cache_control,
    { type: 'ephemeral', ttl: '1h' },
    'Bedrock cache helper injects cache control into the last text part'
  )
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

  assert.equal(isMiniMaxProvider({ id: 'custom', type: 'openai-compatible', name: 'Mini Max Proxy', apiKey: FAKE_KEY_A, models: [], enabled: true }), true, 'provider identity helper detects MiniMax names')
  assert.equal(isDashScopeProvider({ id: 'custom', type: 'openai-compatible', name: 'Custom', apiKey: FAKE_KEY_A, models: ['qwen3-coder'], enabled: true }), true, 'provider identity helper detects DashScope model families')
  assert.equal(isMoonshotProvider({ id: 'custom', type: 'openai-compatible', name: 'Custom', apiKey: FAKE_KEY_A, models: ['kimi-k2'], enabled: true }), true, 'provider identity helper detects Moonshot/Kimi model families')
  assert.equal(isXAIProvider({ id: 'custom', type: 'openai-compatible', name: 'Custom', baseUrl: 'https://api.x.ai/v1', apiKey: FAKE_KEY_A, models: [], enabled: true }), true, 'provider identity helper detects xAI hosts')
  assert.equal(
    shouldRequestDashScopeStreamUsage({ provider: { id: 'dashscope-stream', type: 'openai-compatible', name: 'DashScope', apiKey: FAKE_KEY_A, models: [], enabled: true }, stream: false }),
    false,
    'provider identity helper does not request DashScope stream usage for non-streaming requests'
  )
  const mimoParameterProvider = { id: 'mimo-params', type: 'xiaomi-mimo', name: 'MiMo Params', apiKey: FAKE_KEY_A, models: ['mimo-v2.5-pro'], enabled: true, capabilities: { reasoningEffort: true } }
  assert.deepEqual(
    normalizeXiaomiMimoThinking({ provider: mimoParameterProvider, model: 'mimo-v2.5-pro', reasoningEffort: 'none' }),
    { type: 'disabled' },
    'provider request parameter helper preserves explicit MiMo thinking disable'
  )
  assert.equal(
    isXiaomiMimoThinkingActive({ provider: mimoParameterProvider, model: 'mimo-v2.5-pro' }),
    true,
    'provider request parameter helper treats default MiMo reasoning models as thinking-active'
  )
  assert.equal(
    normalizeTemperature({ provider: mimoParameterProvider, model: 'mimo-v2.5-pro', reasoningEffort: 'high', temperature: 1.2 }),
    undefined,
    'provider request parameter helper omits MiMo temperature while thinking is active'
  )
  assert.equal(
    normalizeTemperature({ provider: mimoParameterProvider, model: 'mimo-chat', temperature: 2 }),
    1.5,
    'provider request parameter helper clamps MiMo non-thinking temperature'
  )
  assert.equal(
    normalizeTemperature({ provider: { id: 'minimax-temp', type: 'openai-compatible', name: 'MiniMax', apiKey: FAKE_KEY_A, models: ['MiniMax-M3'], enabled: true }, model: 'MiniMax-M3', temperature: 4 }),
    2,
    'provider request parameter helper clamps MiniMax temperature'
  )
  assert.equal(
    clampMaxTokens({ provider: { id: 'token-clamp', type: 'openai-compatible', name: 'Token Clamp', apiKey: FAKE_KEY_A, models: ['MiniMax-M3'], enabled: true }, model: 'MiniMax-M3', maxTokens: 9999999 }),
    getModelConfig('MiniMax-M3', 'openai-compatible').maxOutputTokens,
    'provider request parameter helper clamps max tokens to model metadata'
  )
  const openAIRequestProvider = { id: 'openai-helper', type: 'openai', name: 'OpenAI', apiKey: FAKE_KEY_A, models: ['gpt-5.5'], enabled: true, capabilities: { reasoningEffort: true } }
  assert.equal(
    getOpenAIChatMaxTokensField({ provider: openAIRequestProvider, model: 'gpt-5.5' }),
    'max_completion_tokens',
    'OpenAI request helper keeps official chat max-token field'
  )
  assert.equal(
    getOpenAIChatMaxTokensField({ provider: { id: 'generic-helper', type: 'openai-compatible', name: 'Generic', apiKey: FAKE_KEY_A, models: ['generic-chat'], enabled: true }, model: 'generic-chat' }),
    'max_tokens',
    'OpenAI request helper keeps generic compatible max-token field'
  )
  assert.deepEqual(
    openAICompatibleAttachmentPart({ id: 'att-image', type: 'image', uri: 'file://image.png', name: 'image.png', mimeType: 'image/png', size: 12, base64: 'aW1n' }),
    { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n', detail: 'auto' } },
    'OpenAI request helper keeps image attachment parts'
  )
  assert.deepEqual(
    openAICompatibleAttachmentPart({ id: 'att-pdf', type: 'file', uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 12, base64: 'cGRm' }),
    { type: 'file', file: { filename: 'doc.pdf', file_data: 'data:application/pdf;base64,cGRm' } },
    'OpenAI request helper keeps file attachment parts'
  )
  assert.deepEqual(
    openAIResponsesAttachmentPart({ id: 'att-responses-image', type: 'image', uri: 'file://image.png', name: 'image.png', mimeType: 'image/png', size: 12, base64: 'aW1n' }),
    { type: 'input_image', image_url: 'data:image/png;base64,aW1n' },
    'OpenAI request helper keeps Responses image attachment parts'
  )
  assert.deepEqual(
    openAIResponsesAttachmentPart({ id: 'att-responses-pdf', type: 'pdf', uri: 'file://doc.pdf', name: 'doc.pdf', mimeType: 'application/pdf', size: 12, base64: 'cGRm' }),
    { type: 'input_file', filename: 'doc.pdf', file_data: 'data:application/pdf;base64,cGRm' },
    'OpenAI request helper keeps Responses file attachment parts'
  )
  assert.equal(
    normalizeOpenAIReasoningEffort({ provider: openAIRequestProvider, model: 'gpt-5.5', reasoningEffort: 'xhigh' }),
    'xhigh',
    'OpenAI request helper keeps OpenAI reasoning effort normalization'
  )
  assert.deepEqual(
    buildOpenAIResponsesReasoning('high', openAIRequestProvider),
    { effort: 'high', summary: 'auto' },
    'OpenAI request helper keeps OpenAI-only Responses reasoning summaries'
  )
  const xaiRequestProvider = { id: 'xai-helper', type: 'openai-compatible', presetId: 'xai', name: 'xAI', baseUrl: 'https://api.x.ai/v1', apiKey: FAKE_KEY_A, models: ['grok-4.3', 'grok-4.20-multi-agent'], enabled: true, capabilities: { reasoningEffort: true, nativeTools: true } }
  assert.deepEqual(
    buildOpenAIResponsesReasoning('high', xaiRequestProvider),
    { effort: 'high' },
    'OpenAI request helper omits OpenAI reasoning summaries for xAI Responses'
  )
  assert.deepEqual(openAIResponsesNativeWebSearchTool(xaiRequestProvider), { type: 'web_search' }, 'OpenAI request helper keeps xAI native web search type')
  assert.equal(
    shouldIncludeOpenAIResponsesEncryptedReasoning({ provider: xaiRequestProvider, model: 'grok-4.3' }),
    true,
    'OpenAI request helper keeps default xAI encrypted reasoning continuation'
  )
  assert.equal(
    shouldIncludeOpenAIResponsesEncryptedReasoning({ provider: xaiRequestProvider, model: 'grok-4.3' }, 'none'),
    false,
    'OpenAI request helper omits encrypted reasoning when reasoning is explicitly disabled'
  )
  assert.equal(
    usesOpenAIResponses({ provider: openAIRequestProvider, model: 'gpt-5.5', webSearchMode: 'native' }),
    true,
    'OpenAI request helper routes native OpenAI web search through Responses'
  )
  assert.equal(
    usesOpenAIResponses({ provider: xaiRequestProvider, model: 'grok-4.3' }),
    true,
    'OpenAI request helper keeps xAI preferred Responses routing'
  )
  assert.equal(
    normalizeOpenAIReasoningEffort({ provider: xaiRequestProvider, model: 'grok-4.20-multi-agent', reasoningEffort: 'minimal' }),
    'low',
    'OpenAI request helper preserves xAI Multi-Agent minimal-to-low reasoning fallback'
  )
  assert.equal(
    shouldReplayOpenAICompatibleReasoningContent({ provider: { id: 'deepseek-helper', type: 'openai-compatible', presetId: 'deepseek', name: 'DeepSeek', apiKey: FAKE_KEY_A, models: ['deepseek-v4-pro'], enabled: true }, model: 'deepseek-v4-pro' }, {}),
    false,
    'OpenAI request helper does not replay DeepSeek reasoning without tool calls'
  )
  assert.equal(
    shouldReplayOpenAICompatibleReasoningContent({ provider: { id: 'deepseek-helper', type: 'openai-compatible', presetId: 'deepseek', name: 'DeepSeek', apiKey: FAKE_KEY_A, models: ['deepseek-v4-pro'], enabled: true }, model: 'deepseek-v4-pro' }, { toolCalls: [{ id: 'call-1' }] }),
    true,
    'OpenAI request helper replays DeepSeek reasoning only for tool continuations'
  )
  assert.equal(
    shouldReplayOpenAICompatibleReasoningContent({ provider: { id: 'kimi-helper', type: 'openai-compatible', presetId: 'moonshot', name: 'Moonshot', apiKey: FAKE_KEY_A, models: ['kimi-k2.6'], enabled: true }, model: 'kimi-k2.6' }, {}),
    true,
    'OpenAI request helper preserves Kimi reasoning replay'
  )
  assert.equal(
    shouldReplayOpenAICompatibleReasoningContent({ provider: xaiRequestProvider, model: 'grok-4.3' }, {}),
    true,
    'OpenAI request helper preserves xAI reasoning replay'
  )
  assert.equal(
    shouldReplayOpenAICompatibleReasoningContent({ provider: { ...xaiRequestProvider, wireProtocol: 'anthropic-compatible' }, model: 'grok-4.3' }, { toolCalls: [{ id: 'call-1' }] }),
    false,
    'OpenAI request helper does not replay OpenAI-compatible reasoning on Anthropic wire protocol'
  )
  assert.deepEqual(
    normalizeDeepSeekThinking({ provider: { id: 'deepseek-helper', type: 'openai-compatible', presetId: 'deepseek', name: 'DeepSeek', apiKey: FAKE_KEY_A, models: ['deepseek-v4-pro'], enabled: true }, model: 'deepseek-v4-pro', reasoningEffort: 'xhigh' }),
    { type: 'enabled', effort: 'max' },
    'OpenAI-compatible thinking helper maps DeepSeek xhigh to max effort'
  )
  assert.deepEqual(
    normalizeDashScopeThinking({ provider: { id: 'qwen-helper', type: 'openai-compatible', presetId: 'dashscope', name: 'DashScope', apiKey: FAKE_KEY_A, models: ['qwen3.7-max'], enabled: true }, model: 'qwen3.7-max', reasoningEffort: 'high' }),
    { enabled: true, budget: 262144 },
    'OpenAI-compatible thinking helper preserves DashScope high thinking budget'
  )
  assert.equal(normalizeDashScopeThinkingBudget('qwen3.6-plus', 'medium'), 65536, 'OpenAI-compatible thinking helper preserves medium Qwen budget cap')
  const kimiHelperProvider = { id: 'kimi-helper', type: 'openai-compatible', presetId: 'moonshot', name: 'Moonshot', apiKey: FAKE_KEY_A, models: ['kimi-k2.6'], enabled: true }
  const kimiHelperThinking = normalizeKimiThinking({ provider: kimiHelperProvider, model: 'kimi-k2.6', reasoningEffort: 'high' })
  assert.deepEqual(kimiHelperThinking, { type: 'enabled' }, 'OpenAI-compatible thinking helper enables Kimi thinking')
  assert.deepEqual(
    normalizeKimiPreservedThinking({ provider: kimiHelperProvider, model: 'kimi-k2.6', messages: [{ role: 'assistant', reasoningContent: 'kept reasoning' }] }, kimiHelperThinking),
    { type: 'enabled', keep: 'all' },
    'OpenAI-compatible thinking helper preserves Kimi assistant reasoning replay'
  )
  assert.equal(isKimiSamplingLocked({ provider: kimiHelperProvider, model: 'kimi-k2.6' }), true, 'OpenAI-compatible thinking helper locks Kimi sampling')
  const miniMaxHelperReq = { provider: { id: 'minimax-helper', type: 'openai-compatible', presetId: 'minimax', name: 'MiniMax', apiKey: FAKE_KEY_A, models: ['MiniMax-M3'], enabled: true }, model: 'MiniMax-M3', reasoningEffort: 'high' }
  const miniMaxHelperThinking = normalizeMiniMaxThinking(miniMaxHelperReq)
  assert.deepEqual(miniMaxHelperThinking, { type: 'adaptive' }, 'OpenAI-compatible thinking helper preserves MiniMax adaptive thinking')
  assert.equal(shouldRequestMiniMaxReasoningSplit(miniMaxHelperReq, miniMaxHelperThinking), true, 'OpenAI-compatible thinking helper requests MiniMax reasoning split')
  assert.deepEqual(
    normalizeGoogleThinkingConfig({ provider: { id: 'google-helper', type: 'google', name: 'Google', apiKey: FAKE_KEY_A, models: ['gemini-2.5-flash'], enabled: true }, model: 'gemini-2.5-flash', reasoningEffort: 'low' }),
    { thinkingBudget: 1024, includeThoughts: true },
    'Google thinking helper preserves Gemini 2.5 Flash low thinking budget'
  )
  assert.deepEqual(
    normalizeGoogleThinkingConfig({ provider: { id: 'google-helper', type: 'google', name: 'Google', apiKey: FAKE_KEY_A, models: ['gemini-3.5-flash'], enabled: true }, model: 'gemini-3.5-flash', reasoningEffort: 'minimal' }),
    { thinkingLevel: 'minimal' },
    'Google thinking helper preserves Gemini 3.5 minimal thinking level without thought summaries'
  )
  assert.equal(normalizeGeminiThinkingBudget('gemini-2.5-pro', 'low'), 2048, 'Google thinking helper preserves Gemini Pro low thinking floor')
  assert.equal(
    normalizeGeminiThinkingLevel('xhigh', getModelConfig('gemini-3.5-flash', 'google')),
    'high',
    'Google thinking helper maps xhigh to Gemini high thinking level'
  )
  assert.deepEqual(
    withGoogleThoughtSummaries({ thinkingBudget: 0 }, 'minimal'),
    { thinkingBudget: 0 },
    'Google thinking helper does not request thought summaries for minimal thinking'
  )
  assert.deepEqual(
    googleNativeWebSearchTool(),
    { google_search: {} },
    'Google request helper keeps native web search tool shape'
  )
  assert.deepEqual(
    googleAttachmentPart({ id: 'google-image', type: 'image', uri: 'file://image.png', name: 'image.png', mimeType: 'image/png', size: 12, base64: 'aW1n' }),
    { inline_data: { mime_type: 'image/png', data: 'aW1n' } },
    'Google request helper keeps inline attachment data shape'
  )
  assert.equal(
    googleAttachmentPart({ id: 'google-empty', type: 'image', uri: 'file://image.png', name: 'image.png', mimeType: 'image/png', size: 12 }),
    undefined,
    'Google request helper omits attachments without base64 data'
  )

  const googleModelTestProvider = {
    id: 'google-model-test-helper',
    type: 'google',
    name: 'Google Model Test Helper',
    apiKey: FAKE_KEY_A,
    models: ['gemini-3.5-flash'],
    enabled: true,
  }
  const googleModelTestEffort = getModelTestReasoningEffort(googleModelTestProvider, 'gemini-3.5-flash')
  assert.equal(googleModelTestEffort, 'medium', 'provider model-test helper selects Gemini medium reasoning effort')
  assert.equal(
    getModelTestMaxTokens(googleModelTestProvider, 'gemini-3.5-flash', googleModelTestEffort),
    128,
    'provider model-test helper reserves reasoning response budget'
  )
  assert.deepEqual(
    reduceModelTestBody({
      model: 'gemini-3.5-flash',
      temperature: 0.7,
      top_p: 0.8,
      reasoning: { effort: 'medium' },
      generationConfig: {
        temperature: 0.7,
        topP: 0.8,
        thinkingConfig: { thinkingLevel: 'medium' },
        maxOutputTokens: 128,
      },
    }),
    {
      model: 'gemini-3.5-flash',
      generationConfig: {
        maxOutputTokens: 128,
      },
    },
    'provider model-test helper removes optional generation controls while preserving output budget'
  )

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

    const bedrockRuntimeChatProvider = {
      id: 'bedrock-runtime-chat',
      type: 'anthropic',
      name: 'AWS Bedrock Runtime',
      presetId: 'aws-bedrock',
      baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
      apiKey: JSON.stringify({
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
        sessionToken: 'session-token-example',
      }),
      models: ['anthropic.claude-3-7-sonnet'],
      enabled: true,
    }
    const bedrockRuntimeChatCalls = []
    let bedrockRuntimeChatText = ''
    global.fetch = async (url, init) => {
      bedrockRuntimeChatCalls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'bedrock runtime OK' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const bedrockRuntimeChatHandle = await streamChat(
      {
        provider: bedrockRuntimeChatProvider,
        model: 'anthropic.claude-3-7-sonnet',
        messages: [{ role: 'user', content: 'hello' }],
        stream: false,
        settings: { upstreamCircuitBreakerEnabled: false },
      },
      (chunk) => { bedrockRuntimeChatText += chunk },
      () => {},
      (error) => { throw error }
    )
    await bedrockRuntimeChatHandle.done
    assert.equal(bedrockRuntimeChatCalls[0].url, 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-7-sonnet/invoke', 'Bedrock Runtime non-streaming chat uses InvokeModel')
    assert.match(bedrockRuntimeChatCalls[0].headers.Authorization, /AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//, 'Bedrock Runtime non-streaming chat signs InvokeModel requests')
    assert.equal(bedrockRuntimeChatCalls[0].headers['X-Amz-Security-Token'], 'session-token-example', 'Bedrock Runtime non-streaming chat forwards session token')
    assert.equal(bedrockRuntimeChatCalls[0].body.anthropic_version, 'bedrock-2023-05-31', 'Bedrock Runtime non-streaming chat sends Anthropic Bedrock API version')
    assert.equal(bedrockRuntimeChatCalls[0].body.stream, undefined, 'Bedrock Runtime non-streaming chat omits stream for InvokeModel')
    assert.equal(bedrockRuntimeChatText, 'bedrock runtime OK', 'Bedrock Runtime non-streaming chat parses Anthropic InvokeModel response')

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
    assert.deepEqual(
      requiredFallbackCapabilities({
        provider: fallbackOpenAI,
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        attachments: [
          { id: 'fixture-image', type: 'image', uri: 'image://fixture', name: 'fixture.png', mimeType: 'image/png', size: 128, base64: 'ZmFrZQ==' },
          { id: 'fixture-pdf', type: 'pdf', uri: 'file://fixture.pdf', name: 'fixture.pdf', mimeType: 'application/pdf', size: 256, base64: 'cGRm' },
        ],
      }),
      ['text', 'reasoning', 'image', 'file'],
      'runtime fallback helper derives required text, reasoning, image, and file capabilities'
    )
    assert.deepEqual(
      requiredFallbackCapabilities({
        provider: fallbackOpenAI,
        model: 'gpt-5.5',
        reasoningEffort: 'high',
        attachments: [{ id: 'stale-image', type: 'image', uri: 'file:///tmp/stale-image.png', name: 'stale-image.png', mimeType: 'image/png', size: 1024 }],
      }),
      ['text', 'reasoning'],
      'runtime fallback helper ignores metadata-only persisted attachments without inline payloads'
    )
    assert.deepEqual(
      fallbackProvidersForRequest({ provider: fallbackOpenAI, model: 'gpt-5.5', fallbackProviders: [fallbackAnthropic] }).map((provider) => provider.id),
      ['fallback-openai', 'fallback-anthropic'],
      'runtime fallback helper prepends current provider when fallback list omits it'
    )
    assert.deepEqual(
      routeForRuntimeFallback({ provider: fallbackOpenAI, model: 'gpt-5.5-mini', reasoningEffort: 'minimal' }, 'openai-a'),
      { providerId: 'fallback-openai', model: 'gpt-5.5-mini', credentialGroupId: 'openai-a', region: undefined, capabilities: ['text'] },
      'runtime fallback helper builds original route evidence'
    )
    assert.equal(
      providerForRuntimeFallback({ provider: fallbackOpenAI, model: 'gpt-5.5', fallbackProviders: [fallbackAnthropic] }, { providerId: 'fallback-anthropic', model: 'claude-sonnet-4-6', credentialGroupId: 'anthropic-a', capabilities: ['text'] }).apiKey,
      FAKE_KEY_B,
      'runtime fallback helper hydrates selected credential group API key'
    )
    assert.equal(retryAfterMsFromFailure(429), 60000, 'runtime fallback helper maps rate limits to retry-after')
    assert.equal(retryAfterMsFromFailure(503), 20000, 'runtime fallback helper maps server errors to retry-after')
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

  useSettingsStore.getState().updateSettings({
    customSearchEndpoint: 'https://user:pass@search.example/query?q={query}',
    localModelDownloadMirrorBaseUrl: 'file:///tmp/local-model-mirror',
    proxyBaseUrl: 'islemind://proxy',
  })
  assert.equal(useSettingsStore.getState().settings.customSearchEndpoint, '', 'settings store strips embedded-credential custom search endpoints before keeping them in memory')
  assert.equal(useSettingsStore.getState().settings.localModelDownloadMirrorBaseUrl, '', 'settings store strips non-web local-model mirror URLs before keeping them in memory')
  assert.equal(useSettingsStore.getState().settings.proxyBaseUrl, '', 'settings store strips non-web proxy base URLs before keeping them in memory')
  const persistedUnsafeSettings = await loadData('SETTINGS')
  assert.equal(persistedUnsafeSettings.customSearchEndpoint, '', 'settings store strips embedded-credential custom search endpoints before AsyncStorage persistence')
  assert.equal(persistedUnsafeSettings.localModelDownloadMirrorBaseUrl, '', 'settings store strips non-web local-model mirror URLs before AsyncStorage persistence')
  assert.equal(persistedUnsafeSettings.proxyBaseUrl, '', 'settings store strips non-web proxy base URLs before AsyncStorage persistence')

  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      customSearchEndpoint: '',
      localModelDownloadMirrorBaseUrl: '',
      proxyBaseUrl: '',
    },
  }))
  memoryStorage.set('@islemind/settings', JSON.stringify({
    ...persistedUnsafeSettings,
    customSearchEndpoint: 'https://mirror-user:mirror-pass@search.example/import?q={query}',
    localModelDownloadMirrorBaseUrl: 'islemind://mirror-host',
    proxyBaseUrl: 'file:///tmp/import-proxy',
  }))
  await useSettingsStore.getState().load()
  assert.equal(useSettingsStore.getState().settings.customSearchEndpoint, '', 'settings store load strips embedded-credential custom search endpoints from persisted settings')
  assert.equal(useSettingsStore.getState().settings.localModelDownloadMirrorBaseUrl, '', 'settings store load strips non-web mirror URLs from persisted settings')
  assert.equal(useSettingsStore.getState().settings.proxyBaseUrl, '', 'settings store load strips non-web proxy base URLs from persisted settings')

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

  const deleteAbortCalls = []
  registerStreamAborter((conversationId) => {
    deleteAbortCalls.push(conversationId)
    clearActiveStream(conversationId)
  })
  setActiveStream(conversationId, {
    controller: new AbortController(),
    messageId: 'streaming-message',
  })
  useChatStore.getState().delete(conversationId)
  assert.deepEqual(deleteAbortCalls, [conversationId], 'chat store delete aborts the active stream before removing the conversation')
  assert.equal(getActiveStream(conversationId), undefined, 'chat store delete clears the active stream entry after aborting')
  registerStreamAborter((conversationId) => {
    deleteAbortCalls.push(`clear:${conversationId}`)
    clearActiveStream(conversationId)
  })
  setActiveStream(conversationId, {
    controller: new AbortController(),
    messageId: 'streaming-message-two',
  })
  setActiveStream(plainConversationId, {
    controller: new AbortController(),
    messageId: 'streaming-message-three',
  })
  useChatStore.getState().clearAll()
  assert.deepEqual(
    deleteAbortCalls.slice(1),
    [`clear:${conversationId}`, `clear:${plainConversationId}`],
    'chat store clearAll aborts every active stream before clearing conversations'
  )
  assert.equal(getActiveStream(conversationId), undefined, 'chat store clearAll clears the deleted conversation stream entry')
  assert.equal(getActiveStream(plainConversationId), undefined, 'chat store clearAll clears the remaining active stream entry')
  registerStreamAborter(null)

  await mergeProviderHealthRecords([
    {
      providerId: allowedProvider.id,
      model: 'gpt-5.5-mini',
      status: 'cooldown',
      successes: 0,
      failures: 1,
      consecutiveFailures: 1,
      lastFailureAtMs: 10,
    },
    {
      providerId: blockedProvider.id,
      model: 'blocked-chat',
      status: 'healthy',
      successes: 1,
      failures: 0,
      consecutiveFailures: 0,
      lastSuccessAtMs: 11,
    },
  ], { nowMs: 12 })
  await saveCompactState({
    id: 'provider-store-compact-allowed',
    conversationId,
    providerId: allowedProvider.id,
    model: 'gpt-5.5-mini',
    compactItemJson: '{"summary":"allowed stale compact"}',
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: 1,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  })
  await saveCompactState({
    id: 'provider-store-compact-blocked',
    conversationId: 'blocked-conversation',
    providerId: blockedProvider.id,
    model: 'blocked-chat',
    compactItemJson: '{"summary":"blocked active compact"}',
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: 1,
    status: 'active',
    createdAt: 2,
    updatedAt: 2,
  })

  await useSettingsStore.getState().removeProvider(allowedProvider.id)
  assert.equal(useSettingsStore.getState().settings.defaultProvider, blockedProvider.id, 'settings store moves the default provider to the remaining provider after removal')
  assert.equal(await useSettingsStore.getState().getPrimaryConfiguredProvider(), null, 'settings store returns no primary provider when the remaining provider is policy-blocked')
  const healthAfterRemoval = await loadProviderHealthSnapshot({ nowMs: 12 })
  assert.equal(healthAfterRemoval.records.some((record) => record.providerId === allowedProvider.id), false, 'settings store removes persisted provider health records when removing a provider')
  assert.equal(healthAfterRemoval.records.some((record) => record.providerId === blockedProvider.id), true, 'settings store preserves other provider health records when removing a provider')
  assert.deepEqual(await listActiveCompactStates(conversationId, allowedProvider.id, 'gpt-5.5-mini'), [], 'settings store invalidates removed-provider compact state')
  assert.equal(
    compactStateRows.find((row) => row.id === 'provider-store-compact-allowed')?.failureCode,
    'provider_removed',
    'settings store records provider_removed as the compact invalidation reason'
  )
  assert.equal(
    compactStateRows.find((row) => row.id === 'provider-store-compact-blocked')?.status,
    'active',
    'settings store leaves other providers compact state untouched on single-provider removal'
  )

  await mergeProviderHealthRecords([
    {
      providerId: blockedProvider.id,
      model: 'blocked-chat',
      status: 'cooldown',
      successes: 1,
      failures: 1,
      consecutiveFailures: 1,
      lastFailureAtMs: 20,
    },
  ], { nowMs: 21 })

  useChatStore.getState().clearAll()
  await useSettingsStore.getState().clearAllProviders()
  assert.deepEqual((await loadProviderHealthSnapshot({ nowMs: 21 })).records, [], 'settings store clears persisted provider health snapshots when clearing all providers')
  assert.equal(compactStateRows.every((row) => row.status !== 'active'), true, 'settings store invalidates all compact state when clearing all providers')
  assert.equal(
    compactStateRows.find((row) => row.id === 'provider-store-compact-blocked')?.failureCode,
    'providers_cleared',
    'settings store records providers_cleared as the clear-all compact invalidation reason'
  )
  await mergeProviderHealthRecords([
    {
      providerId: blockedProvider.id,
      model: 'blocked-chat',
      status: 'cooldown',
      successes: 0,
      failures: 1,
      consecutiveFailures: 1,
      lastFailureAtMs: 30,
    },
  ], { nowMs: 31 })
  await saveCompactState({
    id: 'provider-store-reset-compact',
    conversationId: 'reset-conversation',
    providerId: blockedProvider.id,
    model: 'blocked-chat',
    compactItemJson: '{"summary":"reset stale compact"}',
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: 1,
    status: 'active',
    createdAt: 30,
    updatedAt: 30,
  })
  await useSettingsStore.getState().clearAll()
  assert.deepEqual((await loadProviderHealthSnapshot({ nowMs: 31 })).records, [], 'settings store clearAll clears provider health snapshots when resetting settings')
  assert.equal((await listActiveCompactStates('reset-conversation', blockedProvider.id, 'blocked-chat')).length, 0, 'settings store clearAll clears provider compact state when resetting settings')
  useChatStore.setState({ conversations: [], currentId: null, isLoading: false, error: null })
  memoryStorage.clear()
  secureStorage.clear()
  compactStateRows.splice(0, compactStateRows.length)
}

async function assertSettingsUrlPersistenceBehavior() {
  await assertProviderStoreLifecycleBehavior()

  const importedSettingsUrlResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: {
      theme: 'system',
      language: 'zh-CN',
      defaultProvider: null,
      fontSize: 16,
      hapticsEnabled: true,
      customSearchEndpoint: 'https://user:pass@search.example/query?q={query}',
      localModelDownloadMirrorBaseUrl: 'file:///tmp/local-model-mirror',
      proxyBaseUrl: 'islemind://proxy',
    },
    providers: [],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(importedSettingsUrlResult, { ok: true, kind: 'islemind', conversations: 0 }, 'portable settings import still accepts otherwise valid backups')
  const importedSettingsRows = await loadData('SETTINGS')
  assert.equal(importedSettingsRows.customSearchEndpoint, '', 'portable import strips embedded-credential custom search endpoints before settings persistence')
  assert.equal(importedSettingsRows.localModelDownloadMirrorBaseUrl, '', 'portable import strips non-web local-model mirror URLs before settings persistence')
  assert.equal(importedSettingsRows.proxyBaseUrl, '', 'portable import strips non-web proxy base URLs before settings persistence')
  await saveData('SETTINGS', {
    theme: 'system',
    language: 'zh-CN',
    defaultProvider: null,
    fontSize: 16,
    hapticsEnabled: true,
    customSearchEndpoint: 'https://user:pass@search.example/query?q={query}',
    localModelDownloadMirrorBaseUrl: 'file:///tmp/local-model-mirror',
    proxyBaseUrl: 'islemind://proxy',
  })
  const exportedSettingsUrlPayload = JSON.parse(await exportAllData())
  assert.equal(exportedSettingsUrlPayload.settings.customSearchEndpoint, '', 'portable export does not reintroduce embedded-credential custom search endpoints from stored settings')
  assert.equal(exportedSettingsUrlPayload.settings.localModelDownloadMirrorBaseUrl, '', 'portable export does not reintroduce non-web local-model mirror URLs from stored settings')
  assert.equal(exportedSettingsUrlPayload.settings.proxyBaseUrl, '', 'portable export does not reintroduce non-web proxy base URLs from stored settings')

  await useSettingsStore.getState().clearAll()
  useChatStore.setState({ conversations: [], currentId: null, isLoading: false, error: null })
  memoryStorage.clear()
  secureStorage.clear()
}

async function assertClearAllDataBehavior() {
  await saveData('CONVERSATIONS', [{
    id: 'clear-all-conversation',
    title: 'Clear all conversation',
    providerId: 'clear-all-provider',
    model: 'gpt-5.5-mini',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }])
  await saveData('SETTINGS', {
    theme: 'system',
    language: 'zh-CN',
    defaultProvider: 'clear-all-provider',
    fontSize: 16,
    hapticsEnabled: true,
  })
  await saveData('PROVIDERS', [{
    id: 'clear-all-provider',
    type: 'openai-compatible',
    name: 'Clear All Provider',
    enabled: true,
    models: ['gpt-5.5-mini'],
    credentialGroups: [
      { id: 'primary', label: 'Primary', apiKey: '', enabled: true },
    ],
  }])
  await saveData('SKILLS', [{
    schema: 'islemind.skill.v1',
    id: 'clear-all-skill',
    name: 'Clear All Skill',
    layer: 'base',
    priority: 0,
    systemPrompt: 'Keep this removable.',
    createdAt: 1,
    updatedAt: 1,
    tags: [],
  }])
  await saveData('MCP_SERVERS', [{
    id: 'clear-all-mcp',
    name: 'Clear All MCP',
    url: 'https://mcp.example.test',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    manifestTtlMs: 1000,
    tools: [],
    resources: [],
    prompts: [],
    approvedToolNames: [],
    createdAt: 1,
    updatedAt: 1,
  }])
  memoryStorage.set('@islemind/active-conversation', JSON.stringify('clear-all-conversation'))
  memoryStorage.set('@islemind/provider-health', JSON.stringify({
    version: 1,
    updatedAtMs: 1,
    records: [{ providerId: 'clear-all-provider', status: 'healthy', successes: 1, failures: 0, consecutiveFailures: 0 }],
  }))
  memoryStorage.set('@islemind/local-embedding-models', JSON.stringify({
    records: {
      'all-MiniLM-L6-v2': {
        modelId: 'all-MiniLM-L6-v2',
        source: 'downloaded',
        downloadedAt: 1,
        verifiedAt: 1,
        bytes: 128,
      },
    },
    failed: {
      'all-MiniLM-L6-v2': 'stale verify failure',
    },
  }))
  secureStorage.set('islemind.key.clear-all-provider', FAKE_KEY_A)
  secureStorage.set('islemind.key.clear-all-provider.primary', FAKE_KEY_B)
  secureStorage.set('islemind.key.tavily', FAKE_KEY_C)
  secureStorage.set('islemind.key.google-search', FAKE_KEY_D)
  secureStorage.set('islemind.key.bing-search', FAKE_KEY_E)
  secureStorage.set('islemind.key.custom-search', FAKE_KEY_F)
  await importContextSnapshot({
    memories: [{
      id: 'clear-all-memory',
      content: 'Clear all should remove this memory.',
      status: 'active',
      sourceKind: 'manual',
      createdAt: 1,
      updatedAt: 1,
    }],
    documents: [{
      id: 'clear-all-document',
      title: 'Clear All Knowledge',
      mimeType: 'text/plain',
      size: 24,
      chunkCount: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    }],
    chunks: [{
      id: 'clear-all-chunk',
      documentId: 'clear-all-document',
      title: 'Clear All Knowledge',
      content: 'Clear all should remove this knowledge chunk.',
      ordinal: 0,
      createdAt: 1,
    }],
  })
  await saveCompactState({
    id: 'clear-all-compact',
    conversationId: 'clear-all-conversation',
    providerId: 'clear-all-provider',
    model: 'gpt-5.5-mini',
    compactItemJson: '{"summary":"stale compact"}',
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: 1,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  })
  recordCompactUsage({
    mode: 'auto',
    providerId: 'clear-all-provider',
    model: 'gpt-5.5-mini',
    inputTokens: 12,
    outputTokens: 5,
  })
  await clearRuntimeLog()
  await appendRuntimeLog('storage.operation', { detail: 'clear-all-setup' }, { enabled: true, maxBytes: 4096 })
  localFileFixtures.set('file:///tmp/islemind-models/all-MiniLM-L6-v2/model.onnx', Buffer.from('fake-model'))
  localFileFixtures.set('file:///cache/IsleMind-clear-all.apk', Buffer.from('apk'))
  localFileFixtures.set('file:///cache/islemind-apk-cleanup-clear-all.txt', Buffer.from('file:///cache/IsleMind-clear-all.apk', 'utf8'))

  await clearAllData()

  assert.equal(await loadData('CONVERSATIONS'), null, 'clearAllData removes persisted conversations')
  assert.equal(await loadData('SETTINGS'), null, 'clearAllData removes persisted settings')
  assert.equal(await loadData('PROVIDERS'), null, 'clearAllData removes persisted providers')
  assert.equal(await loadData('SKILLS'), null, 'clearAllData removes persisted skills')
  assert.equal(await loadData('MCP_SERVERS'), null, 'clearAllData removes persisted MCP servers')
  assert.equal(memoryStorage.get('@islemind/active-conversation'), undefined, 'clearAllData removes the active conversation pointer')
  assert.equal(memoryStorage.get('@islemind/provider-health'), undefined, 'clearAllData removes persisted provider health snapshots')
  assert.equal(memoryStorage.get('@islemind/local-embedding-models'), undefined, 'clearAllData removes persisted local embedding model state')
  assert.equal(secureStorage.get('islemind.key.clear-all-provider'), undefined, 'clearAllData removes provider secure keys')
  assert.equal(secureStorage.get('islemind.key.clear-all-provider.primary'), undefined, 'clearAllData removes provider credential-group secure keys')
  assert.equal(secureStorage.get('islemind.key.tavily'), undefined, 'clearAllData removes Tavily search keys')
  assert.equal(secureStorage.get('islemind.key.google-search'), undefined, 'clearAllData removes Google search keys')
  assert.equal(secureStorage.get('islemind.key.bing-search'), undefined, 'clearAllData removes Bing search keys')
  assert.equal(secureStorage.get('islemind.key.custom-search'), undefined, 'clearAllData removes custom-search keys')
  assert.deepEqual(await exportContextSnapshot(), { memories: [], documents: [], chunks: [] }, 'clearAllData removes context memories, knowledge documents, and knowledge chunks')
  assert.deepEqual(await localDataStore.loadConversations(), [], 'clearAllData removes SQLite conversation records')
  assert.deepEqual(await searchKnowledge('Clear all should remove this knowledge chunk.', 10), [], 'clearAllData removes knowledge source indexes used by retrieval')
  assert.deepEqual(await listActiveCompactStates('clear-all-conversation', 'clear-all-provider', 'gpt-5.5-mini'), [], 'clearAllData removes persisted remote compact state')
  assert.deepEqual(listCompactUsageRecords(), [], 'clearAllData removes in-memory remote compact usage records')
  assert.equal((await getRuntimeLogInfo()).exists, false, 'clearAllData removes the runtime log file')
  assert.equal(localFileFixtures.has('file:///tmp/islemind-models/all-MiniLM-L6-v2/model.onnx'), false, 'clearAllData removes downloaded local embedding model files')
  assert.ok(localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes('all-MiniLM-L6-v2')), 'clearAllData deletes downloaded local embedding model directories')
  assert.equal(localFileFixtures.has('file:///cache/IsleMind-clear-all.apk'), false, 'clearAllData removes staged APK installer cache files')
  assert.equal(localFileFixtures.has('file:///cache/islemind-apk-cleanup-clear-all.txt'), false, 'clearAllData removes staged APK cleanup markers')

  memoryStorage.clear()
  secureStorage.clear()
  localFileFixtures.clear()
  localFileOperations.length = 0
  compactStateRows.splice(0, compactStateRows.length)
  clearCompactUsageRecords()
}

async function assertApkUpdateBehavior() {
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
  assert.equal(isAllowedAndroidApkUriForTest('file:///tmp/IsleMind-1.0.7.apk'), true, 'Android APK URI policy allows explicit file APK URIs')
  assert.equal(isAllowedAndroidApkUriForTest('content://downloads/document/IsleMind-1.0.7.apk'), true, 'Android APK URI policy allows content URIs whose document path is an APK')
  assert.equal(isAllowedAndroidApkUriForTest('content://downloads/document/report.pdf'), false, 'Android APK URI policy rejects non-APK content document URIs')
  assert.equal(isAllowedAndroidApkUriForTest('content://com.android.externalstorage.documents/tree/Download'), false, 'Android APK URI policy rejects SAF tree grants as installer APK input')
  assert.equal(sanitizeAndroidApkUriForTest('  content://downloads/document/app.apk  '), 'content://downloads/document/app.apk', 'Android APK URI policy trims accepted APK URIs')
  assert.equal(sanitizeAndroidApkUriForTest('https://example.test/app.apk'), undefined, 'Android APK URI policy rejects remote APK URLs for system-installer handoff')
  assert.throws(
    () => normalizeApkUpdateManifestForTest({
      ...apkManifestFixture,
      releaseUrl: 'islemind://release',
    }, ['arm64-v8a']),
    /releaseUrl must be an explicit HTTP\(S\) URL/,
    'APK manifest rejects non-web release URLs'
  )
  assert.throws(
    () => normalizeApkUpdateManifestForTest({
      ...apkManifestFixture,
      assets: [{
        ...apkManifestFixture.assets[0],
        url: 'file:///tmp/update.apk',
      }],
    }, ['arm64-v8a']),
    /url must be an explicit HTTP\(S\) URL/,
    'APK manifest rejects non-web APK asset URLs'
  )
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
  const originalFetchForInvalidGithubAsset = global.fetch
  global.fetch = async (url) => {
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
            browser_download_url: 'islemind://bad-apk',
            size: 123,
          },
        ],
      }),
    }
  }
  try {
    const invalidGithubAssetUpdate = await checkLatestApkRelease()
    assert.equal(invalidGithubAssetUpdate.status, 'unavailable', 'GitHub fallback ignores non-web APK asset URLs and returns no installable update')
  } finally {
    global.fetch = originalFetchForInvalidGithubAsset
    reactNativePlatform.OS = 'test'
  }

  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const originalFetchForUserInfoGithubAsset = global.fetch
  global.fetch = async (url) => {
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
            browser_download_url: 'https://release-user:release-pass@example.test/IsleMind-1.0.7-arm64-v8a-no-model.apk',
            size: 123,
          },
        ],
      }),
    }
  }
  try {
    const userInfoGithubAssetUpdate = await checkLatestApkRelease()
    assert.equal(userInfoGithubAssetUpdate.status, 'unavailable', 'GitHub fallback ignores APK asset URLs with embedded credentials')
  } finally {
    global.fetch = originalFetchForUserInfoGithubAsset
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
  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const failingApkUrl = 'https://example.test/failing.apk'
  localDownloadFixtures.set(failingApkUrl, { status: 500, body: Buffer.from('fail') })
  const failedDownloadResult = await downloadAndOpenApkInstaller({
    version: '1.0.7',
    versionCode: 107,
    tagName: 'v1.0.7',
    name: 'IsleMind 1.0.7',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
    apkUrl: failingApkUrl,
    apkName: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
    publishedAt: null,
    sha256: '0'.repeat(64),
    sizeBytes: 4,
    abi: 'arm64-v8a',
    variant: 'no-model',
  })
  assert.equal(failedDownloadResult.status, 'error', 'APK HTTP download failure is reported as an update error')
  assert.equal(failedDownloadResult.reason, 'network', 'APK HTTP download failure carries the network reason')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.endsWith('IsleMind-1.0.7-arm64-v8a-no-model.apk')),
    'APK HTTP download failure deletes the cached APK'
  )
  const invalidApkUrlResult = await downloadAndOpenApkInstaller({
    version: '1.0.7',
    versionCode: 107,
    tagName: 'v1.0.7',
    name: 'IsleMind 1.0.7',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
    apkUrl: 'file:///tmp/bad-update.apk',
    apkName: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
    publishedAt: null,
    sha256: '0'.repeat(64),
    sizeBytes: 12,
    abi: 'arm64-v8a',
    variant: 'no-model',
  })
  assert.equal(invalidApkUrlResult.status, 'error', 'installer flow rejects non-web APK URLs before download')
  assert.equal(invalidApkUrlResult.reason, 'manifest_invalid', 'installer flow reports invalid APK URLs as manifest_invalid')
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'download' && operation.url === 'file:///tmp/bad-update.apk'),
    false,
    'installer flow never attempts non-web APK downloads'
  )
  const userInfoApkUrlResult = await downloadAndOpenApkInstaller({
    version: '1.0.7',
    versionCode: 107,
    tagName: 'v1.0.7',
    name: 'IsleMind 1.0.7',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
    apkUrl: 'https://release-user:release-pass@example.test/private.apk',
    apkName: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
    publishedAt: null,
    sha256: '0'.repeat(64),
    sizeBytes: 12,
    abi: 'arm64-v8a',
    variant: 'no-model',
  })
  assert.equal(userInfoApkUrlResult.status, 'error', 'installer flow rejects APK URLs with embedded credentials before download')
  assert.equal(userInfoApkUrlResult.reason, 'manifest_invalid', 'installer flow reports embedded-credential APK URLs as manifest_invalid')
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'download' && operation.url === 'https://release-user:release-pass@example.test/private.apk'),
    false,
    'installer flow never attempts APK downloads with embedded credentials'
  )
  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const installerFailUrl = 'https://example.test/installer-fail.apk'
  localDownloadFixtures.set(installerFailUrl, { status: 200, body: Buffer.from('apk-binary') })
  const originalStartActivityAsync = IntentLauncher.startActivityAsync
  IntentLauncher.startActivityAsync = async () => { throw new Error('installer failed') }
  try {
    const installerFailBody = Buffer.from('apk-binary')
    const installerFailureResult = await downloadAndOpenApkInstaller({
      version: '1.0.7',
      versionCode: 107,
      tagName: 'v1.0.7',
      name: 'IsleMind 1.0.7',
      htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
      apkUrl: installerFailUrl,
      apkName: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
      publishedAt: null,
      sha256: sha256BytesForTest(Buffer.from('apk-binary')),
      sizeBytes: installerFailBody.length,
      abi: 'arm64-v8a',
      variant: 'no-model',
    })
    assert.equal(installerFailureResult.status, 'error', 'APK installer launch failure is reported as an update error')
    assert.equal(installerFailureResult.reason, 'installer_failed', 'APK installer launch failure carries the installer_failed reason')
    assert.ok(
      localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.endsWith('IsleMind-1.0.7-arm64-v8a-no-model.apk')),
      'APK installer launch failure deletes the cached APK'
    )
  } finally {
    IntentLauncher.startActivityAsync = originalStartActivityAsync
  }
  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const installerSuccessUrl = 'https://example.test/installer-success.apk'
  const installerSuccessBody = Buffer.from('apk-binary-success')
  localDownloadFixtures.set(installerSuccessUrl, { status: 200, body: installerSuccessBody })
  const installerSuccessResult = await downloadAndOpenApkInstaller({
    version: '1.0.7',
    versionCode: 107,
    tagName: 'v1.0.7',
    name: 'IsleMind 1.0.7',
    htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.0.7',
    apkUrl: installerSuccessUrl,
    apkName: 'IsleMind-1.0.7-arm64-v8a-no-model.apk',
    publishedAt: null,
    sha256: sha256BytesForTest(installerSuccessBody),
    sizeBytes: installerSuccessBody.length,
    abi: 'arm64-v8a',
    variant: 'no-model',
  })
  assert.equal(installerSuccessResult.status, 'downloaded', 'successful APK handoff still reports installer-opened status')
  assert.equal(launchedIntents.at(-1)?.action, 'android.intent.action.INSTALL_PACKAGE', 'successful APK handoff still opens the Android installer')
  assert.equal(localFileFixtures.has(installerSuccessResult.localUri), true, 'successful APK handoff leaves the package available for the installer immediately after launch')
  assert.ok(
    [...localFileFixtures.keys()].some((uri) => uri.startsWith('file:///cache/islemind-apk-cleanup-')),
    'successful APK handoff writes a cache cleanup marker'
  )
  const deletedStagedApks = await clearStagedApkDownloads()
  assert.equal(deletedStagedApks, 1, 'staged APK cleanup deletes the installer handoff package on the next cleanup pass')
  assert.equal(localFileFixtures.has(installerSuccessResult.localUri), false, 'staged APK cleanup removes the installer handoff package from cache')
  assert.equal(
    [...localFileFixtures.keys()].some((uri) => uri.startsWith('file:///cache/islemind-apk-cleanup-')),
    false,
    'staged APK cleanup removes cleanup markers after processing them'
  )
  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  localFileFixtures.set('file:///cache/islemind-apk-cleanup-malicious.txt', Buffer.from('file:///tmp/not-cache.apk', 'utf8'))
  localFileFixtures.set('file:///tmp/not-cache.apk', Buffer.from('do-not-delete'))
  const rejectedStagedApks = await clearStagedApkDownloads()
  assert.equal(rejectedStagedApks, 0, 'staged APK cleanup refuses marker payloads outside app cache')
  assert.equal(localFileFixtures.has('file:///tmp/not-cache.apk'), true, 'staged APK cleanup does not delete non-cache marker payloads')
  assert.equal(localFileFixtures.has('file:///cache/islemind-apk-cleanup-malicious.txt'), false, 'staged APK cleanup still removes rejected markers')
  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  localFileFixtures.set('file:///cache/islemind-apk-cleanup-valid.txt', Buffer.from('file:///cache/valid-direct.apk', 'utf8'))
  localFileFixtures.set('file:///cache/valid-direct.apk', Buffer.from('apk'))
  localFileFixtures.set('file:///tmp/islemind-apk-cleanup-parent.txt', Buffer.from('file:///cache/parent-target.apk', 'utf8'))
  localFileFixtures.set('file:///cache/parent-target.apk', Buffer.from('apk'))
  localFileFixtures.set('file:///tmp/absolute-marker.txt', Buffer.from('file:///cache/absolute-target.apk', 'utf8'))
  localFileFixtures.set('file:///cache/absolute-target.apk', Buffer.from('apk'))
  localFileFixtures.set('file:///cache/nested/child.apk', Buffer.from('apk'))
  localFileFixtures.set('file:///cacheprefix/confused.apk', Buffer.from('apk'))
  nextReadDirectoryEntries = [
    'islemind-apk-cleanup-valid.txt',
    '../islemind-apk-cleanup-parent.txt',
    'file:///tmp/absolute-marker.txt',
    'islemind-apk-cleanup-nested.txt',
    'islemind-apk-cleanup-prefix-confusion.txt',
  ]
  localFileFixtures.set('file:///cache/islemind-apk-cleanup-nested.txt', Buffer.from('file:///cache/nested/child.apk', 'utf8'))
  localFileFixtures.set('file:///cache/islemind-apk-cleanup-prefix-confusion.txt', Buffer.from('file:///cacheprefix/confused.apk', 'utf8'))
  const boundedMarkerCleanupCount = await clearStagedApkDownloads()
  assert.equal(boundedMarkerCleanupCount, 1, 'staged APK cleanup only deletes direct child app-cache APK payloads from direct child markers')
  assert.equal(localFileFixtures.has('file:///cache/valid-direct.apk'), false, 'staged APK cleanup deletes valid direct child APK payloads')
  assert.equal(localFileFixtures.has('file:///cache/parent-target.apk'), true, 'staged APK cleanup ignores parent-traversal marker entries')
  assert.equal(localFileFixtures.has('file:///cache/absolute-target.apk'), true, 'staged APK cleanup ignores absolute marker entries')
  assert.equal(localFileFixtures.has('file:///cache/nested/child.apk'), true, 'staged APK cleanup does not treat nested cache paths as direct staged APK payloads')
  assert.equal(localFileFixtures.has('file:///cacheprefix/confused.apk'), true, 'staged APK cleanup rejects cache-prefix-confusion APK payloads')
  assert.ok(!localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes('..')), 'staged APK cleanup never deletes parent-traversal marker paths')
  assert.ok(!localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/absolute-marker.txt'), 'staged APK cleanup never deletes absolute marker paths')
  launchedIntents.length = 0
  const apkInstallerTool = listAndroidDeviceToolManifests().find((tool) => tool.id === 'android:apk.open_installer')
  assert.ok(apkInstallerTool, 'Android device tool registry includes the APK installer handoff tool')
  const rejectedContentApkToolResult = await executeAndroidDeviceTool(apkInstallerTool, {
    apkUri: 'content://downloads/document/report.pdf',
  })
  assert.equal(rejectedContentApkToolResult.ok, false, 'Android APK installer tool rejects non-APK content URIs')
  assert.equal(rejectedContentApkToolResult.errorCode, 'schema_invalid', 'Android APK installer tool reports non-APK content URIs as invalid schema')
  assert.equal(launchedIntents.length, 0, 'Android APK installer tool does not grant or launch intents for non-APK content URIs')
  localFileFixtures.set('content://downloads/document/IsleMind-1.0.7.apk', Buffer.from('apk'))
  const acceptedContentApkToolResult = await executeAndroidDeviceTool(apkInstallerTool, {
    apkUri: 'content://downloads/document/IsleMind-1.0.7.apk',
  })
  assert.equal(acceptedContentApkToolResult.ok, true, 'Android APK installer tool still accepts content URIs that identify APK files')
  assert.equal(launchedIntents.at(-1)?.action, 'android.intent.action.INSTALL_PACKAGE', 'Android APK installer tool opens the system package installer for APK content URIs')
  reactNativePlatform.OS = 'test'
}

async function assertAndroidAppCacheCleanupBehavior() {
  resetLocalModelFileMocks()
  reactNativePlatform.OS = 'android'
  const clearCacheTool = listAndroidDeviceToolManifests().find((tool) => tool.id === 'android:storage.clear_app_cache')
  assert.ok(clearCacheTool, 'Android device tool registry includes the app-cache cleanup tool')
  localFileFixtures.set('file:///cache/safe-cache.bin', Buffer.from('cache'))
  localFileFixtures.set('file:///tmp/outside-cache.bin', Buffer.from('outside'))
  nextReadDirectoryEntries = [
    'safe-cache.bin',
    '../outside-cache.bin',
    'nested/cache.bin',
    'file:///tmp/outside-cache.bin',
    ' trailing-space.bin ',
    '',
  ]

  const result = await executeAndroidDeviceTool(clearCacheTool)
  const payload = JSON.parse(result.output)
  assert.equal(result.ok, true, 'Android app-cache cleanup keeps normal successful tool status')
  assert.equal(payload.deletedEntryCount, 1, 'Android app-cache cleanup deletes valid direct child cache entries')
  assert.equal(payload.failureCount, 5, 'Android app-cache cleanup reports refused malformed cache entries as failures')
  assert.equal(localFileFixtures.has('file:///cache/safe-cache.bin'), false, 'Android app-cache cleanup removes valid direct child cache files')
  assert.equal(localFileFixtures.has('file:///tmp/outside-cache.bin'), true, 'Android app-cache cleanup does not delete paths outside app cache')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///cache/safe-cache.bin'),
    'Android app-cache cleanup constructs delete targets inside the normalized cache directory'
  )
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes('..')),
    false,
    'Android app-cache cleanup never deletes parent-traversal cache entries'
  )
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/outside-cache.bin'),
    false,
    'Android app-cache cleanup never deletes absolute URI cache entries'
  )
  assert.equal(result.metadata?.androidOperationAudit?.scope, 'app-cache', 'Android app-cache cleanup audit remains scoped to app cache')
  assert.equal(result.metadata?.androidOperationAudit?.userFilesDeleted, false, 'Android app-cache cleanup audit records that user files were not deleted')
  reactNativePlatform.OS = 'test'
}

function assertChatAndroidUndoPromptBehavior() {
  assert.equal(safeChatPromptText('  sk-secret-token-1234567890  ', 120), '[redacted]', 'chat prompt helper redacts provider-looking secrets')
  const prompt = buildAndroidUndoPromptContext({
    id: 'assistant-with-undo-focused',
    role: 'assistant',
    content: 'Moved two files into Documents.',
    timestamp: 1,
    status: 'done',
    reasoning: [{
      id: 'workflow-undo-focused',
      type: 'reasoning',
      title: 'Agent workflow',
      status: 'done',
      startedAt: 1,
      completedAt: 4,
      metadata: {
        androidUndoOperationCount: 2,
        androidUndoToolName: 'android.files.undo_operations',
        androidUndoRequiresVisibleConfirmation: true,
        androidUndoSummary: 'Can reverse the completed move operations.',
      },
    }],
    toolCalls: [{
      id: 'android-apply-focused',
      type: 'tool',
      title: 'Android apply',
      status: 'done',
      content: JSON.stringify({
        undoOperations: [
          {
            id: 'undo-1',
            action: 'move',
            sourceName: 'report.pdf',
            targetName: 'report.pdf',
            password: 'do-not-leak-password',
            nested: { token: 'do-not-leak-token' },
            requiresUserConfirmation: true,
          },
        ],
      }),
      startedAt: 2,
      completedAt: 3,
      metadata: {
        source: 'android',
        toolId: 'android:files.apply_operations',
      },
    }],
  }, 'Empty response')
  assert.ok(prompt.includes('Undo tool: android.files.undo_operations'), 'Android undo prompt preserves the undo tool identity')
  assert.ok(prompt.includes('Undo operations: 1'), 'Android undo prompt includes sanitized undo operation count')
  assert.ok(prompt.includes('Visible confirmation required: yes'), 'Android undo prompt preserves the visible confirmation requirement')
  assert.ok(prompt.includes('Delete-based rollback: unsupported'), 'Android undo prompt keeps the delete rollback boundary explicit')
  assert.ok(prompt.includes('"password": "[redacted]"'), 'Android undo prompt redacts sensitive operation fields')
  assert.ok(prompt.includes('"token": "[redacted]"'), 'Android undo prompt redacts nested sensitive operation fields')
  assert.ok(!prompt.includes('do-not-leak'), 'Android undo prompt omits raw sensitive operation values')
}

async function assertExpandedProviderPresetCoverage() {
  const expandedProviderDetectionFixtures = [
    ['https://api.mistral.ai/v1', 'mistral'],
    ['https://api.groq.com/openai/v1', 'groq'],
    ['https://api.together.ai/v1', 'together'],
    ['https://api.fireworks.ai/inference/v1', 'fireworks'],
    ['https://api.perplexity.ai/chat/completions', 'perplexity'],
    ['https://api.cohere.ai/compatibility/v1', 'cohere'],
    ['https://api.cerebras.ai/v1', 'cerebras'],
    ['https://api.sambanova.ai/v1', 'sambanova'],
    ['https://integrate.api.nvidia.com/v1', 'nvidia-nim'],
    ['https://router.huggingface.co/v1', 'huggingface'],
    ['https://models.github.ai/inference', 'github-models'],
    ['https://api.deepinfra.com/v1/openai', 'deepinfra'],
    ['https://api.novita.ai/v3/openai', 'novita'],
    ['https://api.siliconflow.cn/v1', 'siliconflow'],
    ['https://api-inference.modelscope.cn/v1', 'modelscope'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'volcengine-ark'],
    ['https://qianfan.baidubce.com/v2', 'baidu-qianfan'],
    ['https://api.hunyuan.cloud.tencent.com/v1', 'tencent-hunyuan'],
    ['https://api.baichuan-ai.com/v1', 'baichuan'],
    ['https://api.stepfun.com/v1', 'stepfun'],
    ['https://api.lingyiwanwu.com/v1', 'zero-one'],
    ['https://example.openai.azure.com/openai/v1', 'azure-openai'],
    ['https://bedrock-mantle.us-east-1.api.aws/v1', 'aws-bedrock'],
    ['https://bedrock-runtime.us-east-1.amazonaws.com', 'aws-bedrock'],
    ['https://us-central1-aiplatform.googleapis.com', 'vertex-ai'],
    ['http://localhost:11434/v1', 'ollama'],
    ['http://localhost:1234/v1', 'lm-studio'],
    ['http://localhost:8080/v1', 'localai'],
    ['http://localhost:8000/v1', 'vllm'],
    ['http://localhost:30000/v1', 'sglang'],
  ]
  for (const [baseUrl, presetId] of expandedProviderDetectionFixtures) {
    assert.equal(
      detectProviderPreset({ baseUrl }).presetId,
      presetId,
      `detects expanded provider preset for ${baseUrl}`
    )
  }

  const groqPreset = applyProviderPreset({ apiKey: FAKE_KEY_A, models: [], enabled: false }, 'groq')
  assert.equal(groqPreset.type, 'openai-compatible', 'expanded Groq preset stays on OpenAI-compatible request shape')
  assert.equal(groqPreset.capabilities.responsesApi, true, 'expanded Groq preset declares Responses API support')
  assert.equal(groqPreset.capabilities.remoteCompact, false, 'expanded non-official Responses presets do not infer remote compact')
  const vertexPreset = applyProviderPreset({ apiKey: FAKE_KEY_A, baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/islemind-dev/locations/us-central1/endpoints/openapi', models: [], enabled: false }, 'vertex-ai')
  assert.equal(vertexPreset.type, 'openai-compatible', 'Vertex AI preset uses its OpenAI-compatible hosted endpoint shape')
  assert.equal(vertexPreset.capabilities.modelList, true, 'Vertex AI OpenAI-compatible endpoint keeps model-list sync enabled when configured under /endpoints/openapi')
  const bedrockMantlePreset = applyProviderPreset({ apiKey: FAKE_KEY_A, models: [], enabled: false }, 'aws-bedrock')
  assert.equal(bedrockMantlePreset.type, 'openai-compatible', 'AWS Bedrock preset defaults to the OpenAI-compatible Mantle API shape')
  assert.equal(bedrockMantlePreset.baseUrl, 'https://bedrock-mantle.us-east-1.api.aws/v1', 'AWS Bedrock preset defaults to the Mantle /v1 base URL')
  assert.equal(bedrockMantlePreset.capabilities.responsesApi, true, 'AWS Bedrock Mantle preset declares Responses API routing')
  assert.equal(bedrockMantlePreset.capabilities.modelList, true, 'AWS Bedrock Mantle preset keeps OpenAI-compatible model-list sync enabled')
  assert.equal(isBedrockMantleBaseUrl('https://bedrock-mantle.us-west-2.api.aws/v1/responses'), true, 'Bedrock Mantle helper detects OpenAI-compatible Bedrock API hosts')
  assert.equal(normalizeBedrockMantleBaseUrl('https://bedrock-mantle.us-west-2.api.aws/v1/chat/completions'), 'https://bedrock-mantle.us-west-2.api.aws/v1', 'Bedrock Mantle base URL normalization keeps the /v1 namespace')
  assert.equal(inferBedrockMantleRegion('https://bedrock-mantle.eu-central-1.api.aws/v1'), 'eu-central-1', 'Bedrock Mantle helper infers the configured AWS region')

  const perplexityPreset = applyProviderPreset({ apiKey: FAKE_KEY_A, models: ['sonar'], enabled: false }, 'perplexity')
  assert.equal(isPerplexityProvider(perplexityPreset), true, 'provider identity helper detects Perplexity presets')
  assert.equal(perplexityPreset.capabilities.modelList, false, 'Perplexity preset disables generic /models sync by default')
  assert.equal(getAPIEndpointForTest(perplexityPreset), 'https://api.perplexity.ai/chat/completions', 'Perplexity preset keeps chat-completions endpoint under its compatibility root')
  assert.equal(
    getAPIEndpointForTest({ ...perplexityPreset, baseUrl: 'https://api.perplexity.ai/chat/completions' }),
    'https://api.perplexity.ai/chat/completions',
    'Perplexity endpoint normalization does not append an extra /v1 to direct chat-completions URLs'
  )

  const originalFetch = global.fetch
  try {
    global.fetch = async () => {
      throw new Error('provider presets with modelList=false must not call remote discovery')
    }
    assert.deepEqual(
      await fetchProviderModelConfigsFromRemote(perplexityPreset, 1),
      [],
      'model discovery skips providers that explicitly disable model-list sync'
    )
  } finally {
    global.fetch = originalFetch
  }
}

async function assertProviderCapabilityMatrixBehavior() {
  const officialProvider = applyProviderPreset({ apiKey: FAKE_KEY_A, models: ['gpt-5.5'], enabled: true }, 'openai')
  const azureV1Provider = {
    id: 'azure',
    type: 'openai-compatible',
    name: 'Azure OpenAI',
    presetId: 'azure-openai',
    baseUrl: 'https://example.openai.azure.com/openai/v1',
    apiKey: FAKE_KEY_A,
    models: ['gpt-4.1'],
    enabled: true,
    capabilities: { responsesApi: true },
  }
  const azureLegacyProvider = {
    ...azureV1Provider,
    id: 'azure-legacy',
    baseUrl: 'https://example.openai.azure.com/openai/deployments/gpt-4o',
  }
  const azureMissingBaseUrlProvider = {
    ...azureV1Provider,
    id: 'azure-missing-base-url',
    baseUrl: undefined,
  }
  const bedrockRuntimeProvider = {
    id: 'bedrock-runtime',
    type: 'anthropic',
    name: 'AWS Bedrock Runtime',
    presetId: 'aws-bedrock',
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    apiKey: FAKE_KEY_A,
    models: ['anthropic.claude-3-7-sonnet'],
    enabled: true,
  }
  const bedrockRuntimeCredentialJson = JSON.stringify({
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    sessionToken: 'session-token-example',
  })
  const bedrockRuntimeReadyProvider = {
    ...bedrockRuntimeProvider,
    id: 'bedrock-runtime-ready',
    apiKey: bedrockRuntimeCredentialJson,
  }
  const bedrockMantleProvider = {
    id: 'bedrock-mantle',
    type: 'openai-compatible',
    name: 'AWS Bedrock Mantle',
    presetId: 'aws-bedrock',
    baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1',
    apiKey: FAKE_KEY_A,
    models: ['openai.gpt-oss-120b-1:0'],
    enabled: true,
    capabilities: { responsesApi: true, nativeTools: true },
  }
  const vertexNativeProvider = {
    id: 'vertex-native',
    type: 'openai-compatible',
    name: 'Vertex AI',
    presetId: 'vertex-ai',
    baseUrl: 'https://us-central1-aiplatform.googleapis.com',
    apiKey: FAKE_KEY_A,
    models: ['gemini-2.5-pro'],
    enabled: true,
  }
  const vertexOpenAIProvider = {
    ...vertexNativeProvider,
    id: 'vertex-openai',
    baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/islemind-dev/locations/us-central1/endpoints/openapi',
  }
  const matrix = buildProviderCapabilityMatrix(officialProvider)
  assert.equal(matrix.hostingProfile, 'official', 'official provider is classified as official hosting')
  assert.equal(matrix.summaryLevel, 'partial', 'official provider still reports partial due to cache coverage not being universal')
  assert.ok(matrix.statuses.some((status) => status.area === 'response' && status.level === 'full'), 'official provider has full response support')
  assert.ok(matrix.statuses.some((status) => status.area === 'cache' && status.level === 'partial'), 'official provider cache support remains explicit rather than universal')
  assert.equal(summarizeProviderCapabilityMatrix(matrix), 'official · partial', 'matrix summary is human-readable')
  assert.equal(providerSuppressesGenericModelList(applyProviderPreset({ apiKey: FAKE_KEY_A, models: [], enabled: false }, 'perplexity')), true, 'Perplexity suppresses generic model-list sync')
  assert.equal(isAzureOpenAIProvider(azureV1Provider), true, 'hosted routing helper detects Azure OpenAI providers')
  assert.equal(isAzureOpenAIV1Provider(azureV1Provider), true, 'hosted routing helper detects Azure OpenAI v1-compatible base URLs')
  assert.equal(isAzureOpenAILegacyDeploymentProvider(azureLegacyProvider), true, 'hosted routing helper detects legacy deployment-style Azure OpenAI paths')
  assert.equal(normalizeAzureOpenAIBaseUrl('https://example.openai.azure.com'), 'https://example.openai.azure.com/openai/v1', 'Azure OpenAI bare resource endpoints normalize to /openai/v1')
  assert.equal(normalizeAzureOpenAIBaseUrl('https://example.openai.azure.com/openai/v1/chat/completions'), 'https://example.openai.azure.com/openai/v1', 'Azure OpenAI full chat endpoints normalize back to the v1 base namespace')
  assert.equal(
    resolveProviderEndpoint({ provider: azureV1Provider, model: 'gpt-4.1', stream: true }),
    'https://example.openai.azure.com/openai/v1/chat/completions',
    'Azure OpenAI v1 chat routing keeps the /openai/v1 namespace'
  )
  assert.equal(
    resolveProviderEndpoint({ provider: azureV1Provider, model: 'gpt-4.1', stream: true, usesResponsesApi: true }),
    'https://example.openai.azure.com/openai/v1/responses',
    'Azure OpenAI v1 Responses routing keeps the /openai/v1 namespace'
  )
  assert.equal(
    resolveProviderEndpoint({ provider: azureMissingBaseUrlProvider, model: 'gpt-4.1', stream: true }),
    '/chat/completions',
    'Azure OpenAI presets without a resource base URL do not silently fall back to the official OpenAI endpoint'
  )
  assert.equal(providerNeedsHostedCompatibilityWork(azureV1Provider), false, 'Azure OpenAI v1 endpoints are no longer reported as a hosted compatibility gap')
  assert.equal(providerNeedsHostedCompatibilityWork(azureLegacyProvider), true, 'legacy Azure deployment paths still require dedicated compatibility work')
  assert.equal(providerNeedsHostedCompatibilityWork(azureMissingBaseUrlProvider), true, 'Azure OpenAI presets still require a configured Azure resource base URL')
  assert.equal(buildProviderCapabilityMatrix(azureMissingBaseUrlProvider).hostingProfile, 'cloud-hosted', 'Azure OpenAI presets remain cloud-hosted even before the resource URL is configured')
  assert.equal(getHostedProviderKind(bedrockRuntimeProvider), 'aws-bedrock', 'hosted boundary helper detects AWS Bedrock Runtime providers')
  assert.equal(getHostedProviderKind(bedrockMantleProvider), 'aws-bedrock', 'hosted boundary helper detects AWS Bedrock Mantle providers')
  assert.equal(getHostedProviderKind(vertexNativeProvider), 'vertex-ai', 'hosted boundary helper detects Vertex AI providers')
  assert.equal(isAwsBedrockHostedProvider(bedrockRuntimeProvider), true, 'hosted boundary helper identifies Bedrock runtime hosts')
  assert.equal(isAwsBedrockHostedProvider(bedrockMantleProvider), true, 'hosted boundary helper identifies Bedrock Mantle hosts')
  assert.equal(isBedrockRuntimeProvider(bedrockRuntimeProvider), true, 'Bedrock routing helper detects runtime hosts that still need SigV4')
  assert.equal(isBedrockRuntimeProvider(bedrockMantleProvider), false, 'Bedrock routing helper does not misclassify Mantle presets as Runtime')
  assert.equal(isBedrockMantleProvider(bedrockMantleProvider), true, 'Bedrock routing helper detects Mantle OpenAI-compatible hosts')
  assert.equal(parseBedrockRuntimeCredentials(FAKE_KEY_A), null, 'Bedrock Runtime credential parser rejects single API-key strings')
  assert.equal(parseBedrockRuntimeCredentials(bedrockRuntimeCredentialJson).accessKeyId, 'AKIDEXAMPLE', 'Bedrock Runtime credential parser accepts JSON AWS credentials')
  assert.equal(parseBedrockRuntimeCredentials('AWS_ACCESS_KEY_ID=AKIAENV\nAWS_SECRET_ACCESS_KEY=secret\nAWS_REGION=us-west-2').region, 'us-west-2', 'Bedrock Runtime credential parser accepts env-like AWS credentials')
  assert.equal(inferBedrockRuntimeRegion('https://bedrock-runtime.eu-west-1.amazonaws.com'), 'eu-west-1', 'Bedrock Runtime helper infers region from runtime host')
  assert.equal(getBedrockRuntimeSupportIssue(bedrockRuntimeProvider), 'missing_aws_credentials', 'Bedrock Runtime without AWS credentials remains a hosted gap')
  assert.equal(getBedrockRuntimeSupportIssue(bedrockRuntimeReadyProvider), null, 'Bedrock Runtime with AWS credentials and runtime host is ready for signed InvokeModel preparation')
  assert.equal(isVertexAIProvider(vertexNativeProvider), true, 'hosted boundary helper identifies Vertex AI hosts')
  assert.equal(isVertexAIOpenAICompatibleProvider(vertexNativeProvider), false, 'hosted boundary helper keeps native Vertex paths planned')
  assert.equal(isVertexAIOpenAICompatibleProvider(vertexOpenAIProvider), true, 'hosted boundary helper detects Vertex OpenAI-compatible endpoints')
  assert.equal(isHostedProviderGap(bedrockRuntimeProvider), true, 'Bedrock Runtime remains a hosted gap until SigV4 routing is implemented')
  assert.equal(isHostedProviderGap(bedrockRuntimeReadyProvider), false, 'Bedrock Runtime with AWS credentials passes the chat hosted boundary for signed non-streaming InvokeModel')
  assert.equal(isHostedProviderGap(bedrockMantleProvider), false, 'Bedrock Mantle OpenAI-compatible endpoints pass hosted boundary checks')
  assert.equal(isHostedProviderGap(vertexNativeProvider), true, 'native Vertex AI remains a hosted gap until native project routing is implemented')
  assert.equal(isHostedProviderGap(vertexOpenAIProvider), false, 'Vertex AI OpenAI-compatible endpoints are no longer reported as hosted gaps')
  assert.match(
    getHostedProviderSupportIssue(bedrockRuntimeProvider, 'chat')?.message ?? '',
    /SigV4|Converse|InvokeModel/,
    'Bedrock Runtime hosted gap exposes an explicit unsupported reason'
  )
  assert.equal(getHostedProviderSupportIssue(bedrockMantleProvider, 'chat'), null, 'Bedrock Mantle endpoints pass hosted boundary checks')
  assert.equal(getHostedProviderSupportIssue(bedrockRuntimeReadyProvider, 'chat'), null, 'Bedrock Runtime signed InvokeModel path passes chat hosted boundary checks')
  assert.match(
    getHostedProviderSupportIssue(bedrockRuntimeReadyProvider, 'modelList')?.message ?? '',
    /Mantle|SigV4|Converse|InvokeModel/,
    'Bedrock Runtime model-list remains a hosted gap even when chat request signing is available'
  )
  assert.match(
    getHostedProviderSupportIssue(vertexNativeProvider, 'chat')?.message ?? '',
    /Google Cloud|project\/location|project/i,
    'Vertex AI hosted gap exposes an explicit unsupported reason'
  )
  assert.equal(getHostedProviderSupportIssue(vertexOpenAIProvider, 'chat'), null, 'Vertex OpenAI-compatible endpoints pass hosted boundary checks')
  assert.equal(buildProviderCapabilityMatrix(bedrockRuntimeProvider).hostingProfile, 'cloud-hosted', 'Bedrock Runtime providers are classified as cloud-hosted')
  assert.equal(buildProviderCapabilityMatrix(bedrockRuntimeProvider).summaryLevel, 'planned', 'Bedrock Runtime remains planned until SigV4 hosted routing is implemented')
  assert.equal(buildProviderCapabilityMatrix(bedrockRuntimeReadyProvider).summaryLevel, 'planned', 'Bedrock Runtime stays planned overall because model-list, remote compact, and tools still need direct Runtime support')
  assert.equal(describeProviderCapabilityStatus(buildProviderCapabilityMatrix(bedrockRuntimeReadyProvider), 'response'), 'AWS Bedrock Runtime InvokeModel request preparation and SigV4 signing are available for non-streaming Anthropic-style chat; streaming and Converse remain planned', 'Bedrock Runtime ready capability matrix shows partial response support')
  assert.equal(buildProviderCapabilityMatrix(bedrockMantleProvider).summaryLevel, 'partial', 'Bedrock Mantle is partial-ready through the OpenAI-compatible hosted path')
  assert.equal(buildProviderCapabilityMatrix(vertexNativeProvider).summaryLevel, 'planned', 'native Vertex AI remains planned until the hosted route is implemented')
  assert.equal(buildProviderCapabilityMatrix(vertexOpenAIProvider).summaryLevel, 'partial', 'Vertex AI OpenAI-compatible endpoints are partial-ready through the hosted OpenAI path')
  assert.equal(
    resolveProviderEndpoint({ provider: bedrockMantleProvider, model: 'openai.gpt-oss-120b-1:0', stream: true }),
    'https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions',
    'Bedrock Mantle chat routing keeps the hosted /v1 namespace'
  )
  assert.equal(
    resolveProviderEndpoint({ provider: bedrockMantleProvider, model: 'openai.gpt-oss-120b-1:0', stream: true, usesResponsesApi: true }),
    'https://bedrock-mantle.us-east-1.api.aws/v1/responses',
    'Bedrock Mantle Responses routing keeps the hosted /v1 namespace'
  )
  assert.equal(
    resolveProviderEndpoint({ provider: vertexOpenAIProvider, model: 'gemini-2.5-pro', stream: true }),
    'https://us-central1-aiplatform.googleapis.com/v1/projects/islemind-dev/locations/us-central1/endpoints/openapi/chat/completions',
    'Vertex AI OpenAI-compatible chat routing keeps the hosted /endpoints/openapi namespace'
  )
  assert.deepEqual(
    getHeaders(vertexOpenAIProvider),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${FAKE_KEY_A}` },
    'Vertex AI OpenAI-compatible endpoints use Google Cloud access-token bearer auth'
  )
  assert.deepEqual(
    getHeaders(bedrockMantleProvider),
    { 'Content-Type': 'application/json', Authorization: `Bearer ${FAKE_KEY_A}` },
    'Bedrock Mantle endpoints use Bedrock API-key bearer auth'
  )
  assert.equal(
    describeProviderCapabilityStatus(buildProviderCapabilityMatrix(bedrockRuntimeProvider), 'response'),
    getHostedProviderSupportIssue(bedrockRuntimeProvider, 'chat')?.message,
    'Bedrock Runtime capability matrix keeps the hosted boundary explicit'
  )
  assert.equal(
    describeProviderCapabilityStatus(buildProviderCapabilityMatrix(bedrockMantleProvider), 'protocol'),
    'AWS Bedrock Mantle exposes OpenAI-compatible Chat Completions, Responses, and Models APIs, while Bedrock Runtime Invoke/Converse still needs SigV4 routing',
    'Bedrock Mantle capability matrix describes the partial-ready protocol path'
  )
  assert.equal(
    describeProviderCapabilityStatus(buildProviderCapabilityMatrix(vertexNativeProvider), 'modelCatalog'),
    getHostedProviderSupportIssue(vertexNativeProvider, 'modelList')?.message,
    'native Vertex AI capability matrix keeps the hosted boundary explicit'
  )
  assert.equal(
    describeProviderCapabilityStatus(buildProviderCapabilityMatrix(vertexOpenAIProvider), 'protocol'),
    'Vertex AI OpenAI-compatible endpoints use OpenAI chat-completions shapes, while native Gemini Vertex paths remain provider-specific',
    'Vertex OpenAI-compatible capability matrix describes the partial-ready protocol path'
  )
  assert.equal(
    describeProviderCapabilityStatus(
      buildProviderCapabilityMatrix(azureV1Provider),
      'protocol'
    ),
    'Azure OpenAI v1 follows OpenAI-compatible request shapes, while deployment and Foundry resource semantics remain provider-specific',
    'Azure OpenAI v1 protocol support is explicit without overclaiming full hosted coverage'
  )
  assert.match(
    describeProviderCapabilityStatus(
      buildProviderCapabilityMatrix(azureLegacyProvider),
      'protocol'
    ) ?? '',
    /\/openai\/v1|deployment/i,
    'legacy Azure OpenAI deployment path gap remains explicit'
  )
  assert.deepEqual(
    buildProviderCoverageBuckets([
      officialProvider,
      applyProviderPreset({ apiKey: FAKE_KEY_A, models: [], enabled: false }, 'groq'),
      applyProviderPreset({ apiKey: FAKE_KEY_A, models: [], enabled: false }, 'newapi'),
      applyProviderPreset({ apiKey: FAKE_KEY_A, models: [], enabled: false }, 'ollama'),
      azureV1Provider,
      bedrockRuntimeProvider,
      bedrockMantleProvider,
      vertexNativeProvider,
      vertexOpenAIProvider,
    ]),
    { official: 1, aggregator: 1, relay: 1, 'local-runtime': 1, 'cloud-hosted': 5 },
    'provider coverage buckets classify the current provider set'
  )
  const bedrockRuntimeModelTest = await testProviderModelDetailed(bedrockRuntimeProvider, 'anthropic.claude-3-7-sonnet', FAKE_KEY_A)
  assert.equal(bedrockRuntimeModelTest.ok, false, 'Bedrock Runtime provider model tests fail closed before attempting an unsupported direct request')
  assert.equal(bedrockRuntimeModelTest.code, 'models_endpoint_unavailable', 'Bedrock Runtime provider model tests report hosted compatibility gaps through the unsupported models code')
  assert.match(bedrockRuntimeModelTest.message, /SigV4|Converse|InvokeModel/, 'Bedrock Runtime provider model tests surface the hosted boundary reason directly')
  const bedrockRuntimeModelSync = await fetchProviderModelConfigsDetailed(bedrockRuntimeProvider, FAKE_KEY_A)
  assert.equal(bedrockRuntimeModelSync.ok, false, 'Bedrock Runtime provider model sync fails closed before remote discovery')
  assert.equal(bedrockRuntimeModelSync.code, 'models_endpoint_unavailable', 'Bedrock Runtime provider model sync uses the hosted boundary error code')
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'AWS SigV4 helper computes the SHA-256 reference digest')
  assert.equal(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'AWS SigV4 helper computes the HMAC-SHA256 reference digest')
  assert.equal(
    signAwsRequestV4({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      region: 'us-east-1',
      service: 'iam',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      credentials: {
        accessKeyId: 'AKIDEXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      },
      now: new Date('2015-08-30T12:36:00Z'),
    }).Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=dd479fa8a80364edf2119ec24bebde66712ee9c9cb2b0d92eb3ab9ccdc0c3947',
    'AWS SigV4 helper signs the canonical request with the payload hash header included'
  )
  assert.equal(
    bedrockRuntimeInvokeModelUrl(bedrockRuntimeProvider, 'anthropic.claude-3-7-sonnet', 'us-east-1'),
    'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-7-sonnet/invoke',
    'Bedrock Runtime InvokeModel URL follows the documented /model/{modelId}/invoke path'
  )
  const preparedBedrockRuntime = prepareBedrockRuntimeInvokeModelRequest({
    provider: bedrockRuntimeReadyProvider,
    model: 'anthropic.claude-3-7-sonnet',
    body: {
      model: 'anthropic.claude-3-7-sonnet',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      max_tokens: 32,
      stream: false,
    },
    now: new Date('2026-06-18T00:00:00Z'),
  })
  assert.equal(preparedBedrockRuntime.url, 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-7-sonnet/invoke', 'Bedrock Runtime prepared request targets InvokeModel')
  assert.equal(preparedBedrockRuntime.headers['X-Amz-Date'], '20260618T000000Z', 'Bedrock Runtime prepared request includes SigV4 date')
  assert.equal(preparedBedrockRuntime.headers['X-Amz-Security-Token'], 'session-token-example', 'Bedrock Runtime prepared request forwards session token')
  assert.match(preparedBedrockRuntime.headers.Authorization, /Credential=AKIDEXAMPLE\/20260618\/us-east-1\/bedrock\/aws4_request/, 'Bedrock Runtime prepared request signs for the bedrock service')
  const preparedBedrockRuntimeBody = JSON.parse(preparedBedrockRuntime.body)
  assert.equal(preparedBedrockRuntimeBody.anthropic_version, 'bedrock-2023-05-31', 'Bedrock Runtime prepared request adds Anthropic Bedrock API version')
  assert.equal(preparedBedrockRuntimeBody.stream, undefined, 'Bedrock Runtime InvokeModel body omits stream')
  const originalFetch = global.fetch
  try {
    global.fetch = async (input, init = {}) => {
      assert.equal(String(input), 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-7-sonnet/invoke', 'Bedrock Runtime model test calls InvokeModel')
      assert.equal(init.method, 'POST', 'Bedrock Runtime model test uses POST')
      assert.match(init.headers.Authorization, /AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//, 'Bedrock Runtime model test uses SigV4 Authorization')
      assert.equal(init.headers['X-Amz-Security-Token'], 'session-token-example', 'Bedrock Runtime model test includes session token')
      const body = JSON.parse(init.body)
      assert.equal(body.anthropic_version, 'bedrock-2023-05-31', 'Bedrock Runtime model test sends Anthropic Bedrock API version')
      assert.equal(body.stream, undefined, 'Bedrock Runtime model test omits stream for InvokeModel')
      assert.equal(body.messages[0].role, 'user', 'Bedrock Runtime model test keeps Anthropic messages shape')
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }), { status: 200 })
    }
    const bedrockRuntimeReadyModelTest = await testProviderModelDetailed(bedrockRuntimeReadyProvider, 'anthropic.claude-3-7-sonnet', bedrockRuntimeCredentialJson)
    assert.equal(bedrockRuntimeReadyModelTest.ok, true, 'Bedrock Runtime model test can use signed non-streaming InvokeModel when AWS credentials are supplied')
  } finally {
    global.fetch = originalFetch
  }
  try {
    global.fetch = async (input, init = {}) => {
      assert.equal(String(input), 'https://bedrock-mantle.us-east-1.api.aws/v1/models', 'Bedrock Mantle model sync calls the OpenAI-compatible models endpoint')
      assert.equal(init.method, 'GET', 'Bedrock Mantle model sync uses GET')
      assert.equal(init.headers.Authorization, `Bearer ${FAKE_KEY_A}`, 'Bedrock Mantle model sync uses bearer API-key auth')
      return new Response(JSON.stringify({ data: [{ id: 'openai.gpt-oss-120b-1:0', object: 'model', context_length: 131072 }] }), { status: 200 })
    }
    const bedrockMantleModelSync = await fetchProviderModelConfigsDetailed(bedrockMantleProvider, FAKE_KEY_A)
    assert.equal(bedrockMantleModelSync.ok, true, 'Bedrock Mantle provider model sync uses the supported OpenAI-compatible endpoint')
    assert.equal(bedrockMantleModelSync.data[0].id, 'openai.gpt-oss-120b-1:0', 'Bedrock Mantle provider model sync maps returned model ids')
  } finally {
    global.fetch = originalFetch
  }
  try {
    global.fetch = async (input, init = {}) => {
      assert.equal(String(input), 'https://bedrock-mantle.us-east-1.api.aws/v1/chat/completions', 'Bedrock Mantle model test calls the OpenAI-compatible chat endpoint')
      assert.equal(init.method, 'POST', 'Bedrock Mantle model test uses POST')
      assert.equal(init.headers.Authorization, `Bearer ${FAKE_KEY_A}`, 'Bedrock Mantle model test uses bearer API-key auth')
      const body = JSON.parse(init.body)
      assert.equal(body.model, 'openai.gpt-oss-120b-1:0', 'Bedrock Mantle model test preserves the requested model id')
      assert.equal(body.stream, false, 'Bedrock Mantle model test stays non-streaming')
      assert.equal(body.max_tokens, 32, 'Bedrock Mantle model test uses OpenAI-compatible max_tokens')
      assert.equal(body.messages[0].role, 'user', 'Bedrock Mantle model test uses OpenAI-compatible messages')
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 })
    }
    const bedrockMantleModelTest = await testProviderModelDetailed(bedrockMantleProvider, 'openai.gpt-oss-120b-1:0', FAKE_KEY_A)
    assert.equal(bedrockMantleModelTest.ok, true, 'Bedrock Mantle provider model test can use the supported OpenAI-compatible endpoint')
  } finally {
    global.fetch = originalFetch
  }
  const vertexModelSync = await fetchProviderModelConfigsDetailed(vertexNativeProvider, FAKE_KEY_A)
  assert.equal(vertexModelSync.ok, false, 'native Vertex AI provider model sync fails closed before remote discovery')
  assert.equal(vertexModelSync.code, 'models_endpoint_unavailable', 'native Vertex AI provider model sync uses the hosted boundary error code')
}

async function run() {
  assertReleaseVersionsAligned()
  await assertResponsesWebSocketTransportBehavior()
  await assertRuntimeLogFileBehavior()
  await assertRuntimeDiagnosticsBehavior()
  await assertRuntimeDiagnosticsFailurePath()
  await assertAppUpdateRuntimeLogging()
  await assertStorageFailureRuntimeLogging()
  await assertRenderGuardRuntimeLogging()
  await assertMcpRuntimeLogging()
  await assertContextRuntimeLogging()
  await assertKnowledgeRetrievalRuntimeLogging()
  await assertKnowledgeEmbeddingRuntimeLogging()
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
  await assertExpandedProviderPresetCoverage()

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
  assert.equal(normalizeUserContent('  hello%20world  '), 'hello world', 'chat message helper normalizes pasted encoded spaces')
  assert.deepEqual(
    dedupeMessageCitations([
      { id: 'src-1', type: 'knowledge', title: 'A', content: 'First', chunkId: 'chunk-1' },
      { id: 'src-2', type: 'knowledge', title: 'A again', content: 'Duplicate', chunkId: 'chunk-1' },
      { id: 'src-3', type: 'web', title: 'Web', content: 'Web', url: 'https://example.com' },
    ]).map((citation) => citation.id),
    ['src-1', 'src-3'],
    'chat message helper dedupes citations by chunk/url/id while preserving first occurrence'
  )
  assert.equal(
    formatWebPrompt([{ title: 'Source title', url: 'https://example.com', content: 'Source body' }]),
    '以下是联网搜索结果。请优先引用来源 URL，并避免编造未出现的信息。\n\n[W1] Source title\nhttps://example.com\nSource body',
    'chat message helper preserves web prompt format'
  )
  assertChatAndroidUndoPromptBehavior()
  assert.equal(
    buildSetupGuide(),
    [st('chatRunner.setup.noProvider'), '', st('chatRunner.setup.stepProvider'), st('chatRunner.setup.stepKey'), st('chatRunner.setup.stepModel')].join('\n'),
    'chat error helper keeps the provider setup guide copy'
  )
  const confirmedPendingAction = {
    id: 'pending-read',
    reason: 'permission_required',
    title: 'Read source',
    summary: 'Read source with confirmation',
    toolName: 'read_source',
    toolId: 'tool-read-source',
    source: 'app-action',
    serverId: 'islemind',
    permission: 'read-only',
    confirmable: true,
    resumeToolRequest: { name: 'read_source', toolId: 'tool-read-source', source: 'app-action', serverId: 'islemind', arguments: {} },
    createdAt: 1,
  }
  const confirmedToolManifest = {
    id: 'tool-read-source',
    source: 'app-action',
    name: 'read_source',
    description: 'Read source',
    permission: 'read-only',
    enabled: true,
    serverId: 'islemind',
  }
  assert.equal(
    resolveConfirmedPendingActionTool({ pendingAction: confirmedPendingAction, tool: confirmedToolManifest })?.id,
    'tool-read-source',
    'chat agent action helper accepts matching confirmed pending actions'
  )
  assert.equal(
    resolveConfirmedPendingActionTool({ pendingAction: confirmedPendingAction, tool: { ...confirmedToolManifest, id: 'tool-other' } }),
    undefined,
    'chat agent action helper rejects pending action tool identity drift'
  )
  assert.equal(
    resolveConfirmedPendingActionTool({ pendingAction: confirmedPendingAction, tool: { ...confirmedToolManifest, enabled: false } }),
    undefined,
    'chat agent action helper rejects disabled manifests before resuming confirmed actions'
  )
  assert.equal(
    formatAgentWorkflowSaveBlockedReason('approval_required', st),
    st('chatRunner.workflowSave.approvalRequired'),
    'chat agent action helper preserves workflow save approval copy'
  )
  assert.equal(
    formatAgentWorkflowSaveBlockedReason(undefined, st),
    st('chatRunner.workflowSave.saveBlocked'),
    'chat agent action helper preserves generic workflow save blocked copy'
  )
  const runtimeSettings = {
    theme: 'system',
    language: 'en',
    defaultProvider: null,
    fontSize: 16,
    hapticsEnabled: true,
  }
  const runtimeProvider = {
    id: 'runtime-openai',
    type: 'openai',
    name: 'Runtime OpenAI',
    apiKey: 'sk-runtime',
    models: ['gpt-runtime'],
    manualModels: ['gpt-runtime'],
    enabled: true,
  }
  const runtimeConversation = {
    id: 'runtime-conversation',
    title: 'Runtime',
    providerId: runtimeProvider.id,
    model: 'gpt-runtime',
    providerModelMode: 'inherited',
    systemPrompt: '',
    temperature: 0.7,
    maxTokens: 1024,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
  assert.equal(
    resolveRuntimeConversation({ conversation: runtimeConversation, providers: [runtimeProvider], settings: runtimeSettings })?.provider.id,
    runtimeProvider.id,
    'chat runtime resolution helper accepts enabled inherited provider/model routes'
  )
  assert.equal(
    resolveRuntimeConversation({ conversation: runtimeConversation, providers: [{ ...runtimeProvider, enabled: false }], settings: runtimeSettings }),
    null,
    'chat runtime resolution helper rejects disabled inherited provider routes'
  )
  assert.equal(
    resolveRuntimeConversation({ conversation: { ...runtimeConversation, providerModelMode: 'manual' }, providers: [{ ...runtimeProvider, enabled: false }], settings: runtimeSettings })?.provider.id,
    runtimeProvider.id,
    'chat runtime resolution helper preserves existing manual-mode provider enabled bypass'
  )
  assert.deepEqual(
    resolveRuntimeResolutionError({ conversation: runtimeConversation, providers: [{ ...runtimeProvider, enabled: false }] }),
    { code: 'disabled_provider', providerId: runtimeProvider.id },
    'chat runtime resolution helper reports disabled providers before model availability errors'
  )
  assert.deepEqual(
    resolveRuntimeResolutionError({ conversation: { ...runtimeConversation, providerId: 'missing-provider' }, providers: [] }),
    { code: 'model_unavailable', providerId: 'missing-provider' },
    'chat runtime resolution helper preserves missing provider as model unavailable'
  )
  assert.equal(
    buildMcpToolRevisionSystemPrompt('Base instructions'),
    'Base instructions\n\n你正在根据 MCP 工具结果生成最终回复。不要暴露工具请求 JSON；只基于工具输出和已有上下文回答用户。如果工具失败，请明确说明失败状态和可继续的下一步。',
    'chat MCP revision helper appends the MCP revision instruction block to the system prompt'
  )
  const mcpRevisionMessages = buildMcpToolRevisionMessages({
    messages: [{ role: 'user', content: 'Find the status.' }],
    firstOutput: '<islemind_mcp_call>{"tool":"github/search","arguments":{"query":"islemind"}}</islemind_mcp_call>\nDraft answer',
    request: { serverId: 'github', toolName: 'search', arguments: { query: 'islemind' } },
    tool: { server: { id: 'github', name: 'GitHub' }, tool: { name: 'search' } },
    toolOutput: 'Found one result.',
    ok: true,
  })
  assert.equal(mcpRevisionMessages[1].content, 'Draft answer', 'chat MCP revision helper strips tagged MCP call blocks from the assistant replay message')
  assert.equal(
    mcpRevisionMessages[2].content,
    [
      'MCP 工具：GitHub/search',
      '调用状态：ok',
      '请求参数：{"query":"islemind"}',
      '',
      '工具输出：',
      'Found one result.',
      '',
      '请生成最终回复。',
    ].join('\n'),
    'chat MCP revision helper preserves the MCP revision user message format'
  )
  const mcpToolRuntimeSource = fs.readFileSync(path.join(root, 'src/services/chatMcpToolRuntime.ts'), 'utf8')
  assert.ok(mcpToolRuntimeSource.includes("id: input.traceId('mcp-unmatched')"), 'chat MCP tool runtime records unmatched tool traces through injected trace helpers')
  assert.ok(mcpToolRuntimeSource.includes('const result = await callMcpTool(resolved.server, resolved.tool.name, request.arguments, undefined, { signal: input.signal })'), 'chat MCP tool runtime owns MCP tool execution behind the helper seam')
  assert.ok(mcpToolRuntimeSource.includes('generateAnswerWithMcpToolResult({'), 'chat MCP tool runtime reuses a dedicated MCP synthesis helper')
  assert.ok(mcpToolRuntimeSource.includes('messages: buildMcpToolRevisionMessages(input)'), 'chat MCP tool runtime reuses the MCP revision message builder during synthesis')
  assert.equal(typeof resolveMcpToolRevision, 'function', 'chat MCP tool runtime exports MCP tool revision orchestration')
  assert.equal(typeof generateAnswerWithMcpToolResult, 'function', 'chat MCP tool runtime exports MCP tool synthesis')
  assert.equal(classifyChatError('401 unauthorized invalid api key'), 'bad_auth', 'chat error helper classifies auth failures')
  assert.equal(classifyChatError('credential_mismatch token plan tp-credential'), 'credential_mismatch', 'chat error helper classifies credential mismatch failures')
  assert.equal(classifyChatError('AbortError: request timed out'), 'timeout', 'chat error helper classifies timeouts')
  assert.equal(classifyChatError('No response body'), 'network_error', 'chat error helper classifies empty responses as network errors')
  assert.equal(classifyChatError('rate limit 429 quota exceeded'), 'rate_limited', 'chat error helper classifies rate limits')
  assert.equal(classifyChatError('max_tokens context length 输出上限'), 'max_tokens_exceeded', 'chat error helper classifies output limit failures')
  assert.equal(classifyChatError('404 model not found'), 'model_unavailable', 'chat error helper classifies missing models')
  assert.equal(classifyChatError('API error 400 unsupported url'), 'bad_base_url', 'chat error helper classifies bad base URLs')
  assert.equal(toUserFacingError('No response body'), st('chatRunner.userError.emptyResponse'), 'chat error helper preserves empty-response user copy')
  assert.equal(toUserFacingError('401 unauthorized invalid api key'), st('chatRunner.userError.badAuth'), 'chat error helper preserves auth user copy')
  assert.equal(
    providerSupportsNativeTools({ id: 'openai-tools', type: 'openai', name: 'OpenAI', apiKey: '', models: [], enabled: true }, { id: 'gpt-4.1', name: 'GPT', maxOutputTokens: 4096, defaultMaxTokens: 1024, supportsTools: false }),
    false,
    'chat provider-native helper blocks native tools when the model explicitly disables tool support'
  )
  assert.equal(
    providerSupportsNativeTools({ id: 'compatible-tools', type: 'openai-compatible', name: 'Compatible', apiKey: '', models: [], enabled: true, capabilities: { nativeTools: true } }, { id: 'model', name: 'Model', maxOutputTokens: 4096, defaultMaxTokens: 1024 }),
    true,
    'chat provider-native helper honors provider native tool capability metadata'
  )
  const providerToolEntry = {
    providerName: 'inspect_source',
    toolId: 'tool-source-inspect',
    toolName: 'inspectSource',
    source: 'app',
    permission: 'read-only',
    serverId: 'islemind',
  }
  assert.equal(findProviderToolNameMapEntry([providerToolEntry], 'inspect_source')?.toolId, 'tool-source-inspect', 'chat provider-native helper resolves provider tool names')
  assert.equal(findProviderToolNameMapEntry([providerToolEntry], 'inspectSource')?.providerName, 'inspect_source', 'chat provider-native helper falls back to IsleMind tool names')
  assert.equal(safeProviderNativeToolText('apiKey=secret-value'), '[redacted]', 'chat provider-native helper redacts sensitive tool text')
  const providerToolMetadata = buildProviderNativeToolTraceMetadata({
    call: { id: 'call-inspect', name: 'inspect_source', arguments: { sourceId: 'src-1' } },
    provider: { id: 'openai-tools', type: 'openai', name: 'OpenAI', apiKey: '', models: [], enabled: true },
    tool: providerToolEntry,
    status: 'running',
    target: 'openai-responses',
    stepIndex: 0,
    toolCallIndex: 0,
    maxToolCallsPerStep: 1,
  })
  assert.equal(providerToolMetadata.toolCallMode, 'native-provider', 'chat provider-native helper keeps native-provider trace mode')
  assert.equal(providerToolMetadata.providerToolTarget, 'openai-responses', 'chat provider-native helper records provider tool target')
  const providerToolManifestTrace = buildProviderNativeToolManifestTrace(
    { adapter: { target: 'openai-responses', tools: [{ type: 'function', name: 'inspect_source' }], skipped: [{ toolId: 'hidden', toolName: 'write', reason: 'permission-ceiling' }] }, limits: { maxToolCallsPerStep: 1 } },
    (trace) => ({ ...trace, completedAt: trace.completedAt ?? 999 }),
    (prefix) => `${prefix}-fixture`,
  )
  assert.equal(providerToolManifestTrace.id, 'provider-tools-fixture', 'chat provider-native helper keeps manifest trace id prefix')
  assert.equal(providerToolManifestTrace.metadata.declaredToolCount, 1, 'chat provider-native helper records declared provider tools')
  assert.equal(providerToolManifestTrace.metadata.skippedToolCount, 1, 'chat provider-native helper records skipped provider tools')
  assert.equal(usesOpenAICompatibleToolResultMessages({ id: 'openai-tools', type: 'openai', name: 'OpenAI', apiKey: '', models: [], enabled: true }), true, 'chat provider-native helper routes OpenAI-compatible tool result messages')
  assert.equal(usesAnthropicCompatibleToolResultMessages({ id: 'anthropic-tools', type: 'anthropic', name: 'Anthropic', apiKey: '', models: [], enabled: true }), true, 'chat provider-native helper routes Anthropic-compatible tool result messages')
  const openAIProviderToolRevisionMessages = buildProviderNativeToolRevisionMessages({
    provider: { id: 'openai-tools', type: 'openai', name: 'OpenAI', apiKey: '', models: [], enabled: true },
    messages: [{ role: 'user', content: 'Need source details.' }],
    firstOutput: '<islemind_mcp_call>{"tool":"ignored","arguments":{}}</islemind_mcp_call>',
    firstReasoningContent: 'Preserved reasoning',
    firstResponseItems: [{ type: 'reasoning', id: 'rs-1', encrypted_content: 'encrypted', summary: [] }],
    call: { id: 'fc_inspect_source', callId: 'call_inspect_source', name: 'inspect_source', arguments: { sourceId: 'src-1' } },
    tool: providerToolEntry,
    toolOutput: 'Source details.',
    ok: true,
  }, 'Provider requested IsleMind tool inspectSource.')
  assert.equal(openAIProviderToolRevisionMessages[1].toolCalls[0].rawArguments, '{"sourceId":"src-1"}', 'chat provider-native helper stringifies OpenAI-compatible tool arguments')
  assert.equal(openAIProviderToolRevisionMessages[2].toolCallId, 'call_inspect_source', 'chat provider-native helper emits matching OpenAI-compatible tool result messages')
  const anthropicProviderToolRevisionMessages = buildProviderNativeToolRevisionMessages({
    provider: { id: 'anthropic-tools', type: 'anthropic', name: 'Anthropic', apiKey: '', models: [], enabled: true },
    messages: [{ role: 'user', content: 'Need context.' }],
    firstOutput: 'I will inspect it.',
    firstProviderContentBlocks: [{ type: 'thinking', thinking: 'Checking context.', signature: 'sig-1' }],
    call: { id: 'toolu_inspect_source', name: 'inspect_source', arguments: { sourceId: 'src-1' } },
    tool: providerToolEntry,
    toolOutput: 'Source details.',
    ok: false,
  }, 'Provider requested IsleMind tool inspectSource.')
  assert.equal(anthropicProviderToolRevisionMessages[1].providerContentBlocks[0].signature, 'sig-1', 'chat provider-native helper preserves Anthropic provider content blocks')
  assert.equal(anthropicProviderToolRevisionMessages[2].content[0].toolResult.is_error, true, 'chat provider-native helper marks failed Anthropic tool results')
  const googleProviderToolRevisionMessages = buildProviderNativeToolRevisionMessages({
    provider: { id: 'google-tools', type: 'google', name: 'Google', apiKey: '', models: [], enabled: true },
    messages: [{ role: 'user', content: 'Need context.' }],
    firstOutput: 'I will inspect it.',
    call: { id: 'google-fn-1', name: 'inspect_source', arguments: { sourceId: 'src-1' }, thoughtSignature: 'thought-sig' },
    tool: providerToolEntry,
    toolOutput: 'Source details.',
    ok: true,
  }, 'Provider requested IsleMind tool inspectSource.')
  const googleFunctionCallPart = googleProviderToolRevisionMessages[1].content.find((part) => part.functionCall)
  const googleFunctionResponsePart = googleProviderToolRevisionMessages[2].content.find((part) => part.functionResponse)
  assert.equal(googleFunctionCallPart.functionCall.name, 'inspect_source', 'chat provider-native helper emits Gemini function calls')
  assert.equal(googleFunctionCallPart.thoughtSignature, 'thought-sig', 'chat provider-native helper preserves Gemini thought signatures')
  assert.equal(googleFunctionResponsePart.functionResponse.response.ok, true, 'chat provider-native helper emits Gemini function responses')
  assert.equal(st('providerTrace.runtimeGovernanceTitle'), 'Runtime policy', 'provider trace exposes runtime governance trace label')
  assert.equal(st('providerTrace.runtimeFallbackTitle'), 'Runtime fallback', 'provider trace exposes runtime fallback trace label')
  assert.equal(safeHttpUrl(' https://example.com/source?q=1 '), 'https://example.com/source?q=1', 'source URL guard keeps HTTPS source previews')
  assert.equal(safeHttpUrl('http://localhost:19006/source'), 'http://localhost:19006/source', 'source URL guard keeps HTTP source previews')
  assert.equal(safeHttpUrl('https://user:pass@example.com/source'), undefined, 'source URL guard rejects embedded userinfo credentials')
  assert.equal(safeHttpUrl('javascript:alert(1)'), undefined, 'source URL guard rejects javascript: previews')
  assert.equal(safeHttpUrl('file:///data/data/islemind/private.txt'), undefined, 'source URL guard rejects file: previews')
  assert.equal(safeHttpUrl('islemind://settings'), undefined, 'source URL guard rejects app-scheme previews')
  assert.equal(isAllowedWebViewNavigation('about:blank'), true, 'source WebView guard permits the internal blank page')
  assert.equal(isAllowedWebViewNavigation('https://example.com/next'), true, 'source WebView guard permits HTTPS navigations')
  assert.equal(isAllowedWebViewNavigation('data:text/html,<script>alert(1)</script>'), false, 'source WebView guard rejects data: navigations')
  assert.deepEqual(
    parseMcpToolRequest(`<${MCP_TOOL_CALL_TAG}>{"tool":"github/search","arguments":{"query":"islemind"}}</${MCP_TOOL_CALL_TAG}>`),
    { serverId: 'github', toolName: 'search', arguments: { query: 'islemind' } },
    'MCP tool parser reads tagged JSON tool requests'
  )
  assert.deepEqual(
    parseMcpToolRequest('{"serverId":"playwright","toolName":"browser.goto","args":{"url":"https://example.com"}}'),
    { serverId: 'playwright', toolName: 'browser.goto', arguments: { url: 'https://example.com' } },
    'MCP tool parser reads direct JSON tool requests'
  )
  assert.deepEqual(
    parseMcpToolRequest('{"tool":"context7:resolve-library-id","input":["react"]}'),
    { serverId: 'context7', toolName: 'resolve-library-id', arguments: {} },
    'MCP tool parser keeps non-object arguments out of executable requests'
  )
  assert.equal(parseMcpToolRequest(`<${MCP_TOOL_CALL_TAG}>{bad json}</${MCP_TOOL_CALL_TAG}>`), null, 'MCP tool parser rejects malformed tagged JSON')
  assert.equal(stringifyToolArguments({ query: 'islemind' }), '{"query":"islemind"}', 'chat tool-result helper stringifies tool arguments as JSON')
  assert.equal(
    sanitizeToolRevisionAnswerText(`<${MCP_TOOL_CALL_TAG}>{"tool":"github/search","arguments":{"query":"islemind"}}</${MCP_TOOL_CALL_TAG}>\n\nFinal answer`),
    'Final answer',
    'chat tool-result helper strips MCP call blocks before returning revision text'
  )
  assert.equal(
    stripMcpCallBlocks(`Intro\n<${MCP_TOOL_CALL_TAG}>{"tool":"github/search","arguments":{"query":"islemind"}}</${MCP_TOOL_CALL_TAG}>\nOutro`).trim(),
    'Intro\n\nOutro',
    'chat tool-result helper removes tagged MCP call blocks from assistant content'
  )
  assert.deepEqual(
    formatToolBlocks([
      { type: 'text', text: 'Text block' },
      { type: 'resource', uri: 'file:///tmp/example.txt', text: 'Resource body' },
      { type: 'image', mimeType: 'image/png' },
    ]),
    'Text block\n\nfile:///tmp/example.txt\nResource body\n\n[image:image/png]',
    'chat tool-result helper formats text, resource, and image MCP blocks'
  )
  assert.equal(
    findMcpTool(
      [
        { server: { id: 'github', name: 'GitHub' }, tool: { name: 'search' } },
        { server: { id: 'playwright', name: 'Playwright' }, tool: { name: 'browser.goto' } },
      ],
      { serverId: 'github', toolName: 'search', arguments: {} }
    )?.server.id,
    'github',
    'chat tool-result helper matches MCP tools by explicit server id'
  )
  assert.equal(
    findMcpTool(
      [
        { server: { id: 'github', name: 'GitHub' }, tool: { name: 'search' } },
        { server: { id: 'playwright', name: 'Playwright' }, tool: { name: 'browser.goto' } },
      ],
      { toolName: 'playwright/browser.goto', arguments: {} }
    )?.tool.name,
    'browser.goto',
    'chat tool-result helper matches MCP tools by combined server/tool reference'
  )
  assert.equal(
    findMcpTool(
      [
        { server: { id: 'github', name: 'GitHub' }, tool: { name: 'search' } },
        { server: { id: 'gitlab', name: 'GitLab' }, tool: { name: 'search' } },
      ],
      { toolName: 'search', arguments: {} }
    ),
    undefined,
    'chat tool-result helper refuses ambiguous bare MCP tool names when more than one server exposes the same tool'
  )
  assert.deepEqual(
    mergeUsage(
      { source: 'provider', inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      { source: 'provider', inputTokens: 2, outputTokens: 3, reasoningTokens: 5, totalTokens: 5 }
    ),
    { source: 'provider', inputTokens: 12, outputTokens: 7, reasoningTokens: 5, totalTokens: 19 },
    'chat tool-result helper merges provider usage counts field by field'
  )
  assert.equal(addOptionalNumbers(undefined, 3), 3, 'chat tool-result helper keeps the defined optional number')
  assert.equal(addOptionalNumbers(2, 3), 5, 'chat tool-result helper sums optional numbers when both exist')
  const mcpServers = [
    {
      id: 'github',
      name: 'GitHub',
      enabled: true,
      status: 'connected',
      tools: [
        { name: 'search', enabled: true, permission: 'read-only', description: 'Search issues', inputSchema: { type: 'object' } },
        { name: 'write', enabled: false, permission: 'destructive' },
      ],
    },
    {
      id: 'playwright',
      name: 'Playwright',
      enabled: true,
      status: 'disconnected',
      tools: [
        { name: 'browser.goto', enabled: true, permission: 'read-only', description: 'Open page' },
      ],
    },
  ]
  const selectedMcpTools = collectResolvedMcpTools(mcpServers, ['github:search', 'playwright:browser.goto'])
  assert.deepEqual(
    selectedMcpTools.map((item) => `${item.server.id}:${item.tool.name}`),
    ['github:search', 'playwright:browser.goto'],
    'chat MCP context helper preserves enabled tool selection by server-qualified ids'
  )
  assert.deepEqual(
    collectResolvedMcpTools([
      ...mcpServers,
      {
        id: 'gitlab',
        name: 'GitLab',
        enabled: true,
        status: 'connected',
        tools: [
          { name: 'search', enabled: true, permission: 'read-only', description: 'Search merge requests' },
        ],
      },
    ], ['search']).map((item) => `${item.server.id}:${item.tool.name}`),
    [],
    'chat MCP context helper refuses ambiguous bare enabled tool names when more than one server exposes the same tool'
  )
  assert.deepEqual(
    collectResolvedMcpTools([
      {
        id: 'github',
        name: 'GitHub',
        enabled: true,
        status: 'connected',
        tools: [
          { name: 'search', enabled: true, permission: 'read-only', description: 'Search issues' },
        ],
      },
    ], ['search']).map((item) => `${item.server.id}:${item.tool.name}`),
    ['github:search'],
    'chat MCP context helper still allows a bare enabled tool name when it resolves to exactly one server tool'
  )
  const agentToolManifests = [
    {
      id: 'mcp:github:search',
      source: 'mcp',
      name: 'search',
      description: 'Search GitHub issues',
      permission: 'read-only',
      enabled: true,
      serverId: 'github',
      serverName: 'GitHub',
    },
    {
      id: 'mcp:gitlab:search',
      source: 'mcp',
      name: 'search',
      description: 'Search GitLab merge requests',
      permission: 'read-only',
      enabled: true,
      serverId: 'gitlab',
      serverName: 'GitLab',
    },
    {
      id: 'rag:context_pack',
      source: 'rag',
      name: 'rag.context_pack',
      description: 'Build a retrieval context pack',
      permission: 'read-only',
      enabled: true,
    },
  ]
  assert.equal(
    resolveAgentTool(
      { name: 'rag.context_pack', arguments: { query: 'IsleMind' } },
      agentToolManifests
    )?.id,
    'rag:context_pack',
    'agent tool registry still allows a bare tool name when it resolves uniquely'
  )
  assert.equal(
    resolveAgentTool(
      { name: 'search', arguments: { query: 'IsleMind' } },
      agentToolManifests
    ),
    null,
    'agent tool registry refuses ambiguous bare tool names when more than one manifest exposes the same name'
  )
  assert.equal(
    resolveAgentTool(
      { name: 'search', source: 'mcp', serverId: 'github', arguments: { query: 'IsleMind' } },
      agentToolManifests
    )?.id,
    'mcp:github:search',
    'agent tool registry still resolves explicit source and server-scoped tool names'
  )
  assert.equal(
    resolveAgentTool(
      { toolId: 'mcp:gitlab:search', name: 'search', arguments: { query: 'IsleMind' } },
      agentToolManifests
    )?.id,
    'mcp:gitlab:search',
    'agent tool registry still prefers explicit tool ids over ambiguous names'
  )
  assert.equal(
    formatAgentToolRequestIdentity({ toolId: 'mcp:gitlab:search', name: 'search', serverId: 'gitlab' }),
    'mcp:gitlab:search',
    'agent tool identity helper formats explicit tool ids first'
  )
  assert.equal(
    formatAgentToolRequestIdentity({ name: 'search', serverId: 'github' }),
    'github:search',
    'agent tool identity helper formats scoped server/name references consistently'
  )
  assert.equal(
    formatAgentToolRequestIdentity({ name: 'rag.context_pack' }),
    'rag.context_pack',
    'agent tool identity helper formats bare tool names consistently'
  )
  assert.equal(
    validateAgentWorkflowDefinition({
      schema: 'islemind.agent.workflow.v1',
      id: 'workflow-ambiguous',
      name: 'Ambiguous search workflow',
      enabled: true,
      triggerHints: [],
      steps: [
        {
          id: 'step-1',
          title: 'Search across MCP',
          toolRequest: { name: 'search', arguments: { query: 'IsleMind' } },
          acceptance: [],
        },
      ],
      permissionCeiling: 'read-only',
      acceptanceChecks: [],
      createdAt: 1,
      updatedAt: 1,
    }, agentToolManifests).ok,
    false,
    'agent workflow validation treats ambiguous bare tool references as unavailable'
  )
  assert.equal(
    validateAgentWorkflowDefinition({
      schema: 'islemind.agent.workflow.v1',
      id: 'workflow-unique',
      name: 'Unique rag workflow',
      enabled: true,
      triggerHints: [],
      steps: [
        {
          id: 'step-1',
          title: 'Build evidence pack',
          toolRequest: { name: 'rag.context_pack', arguments: { query: 'IsleMind' } },
          acceptance: [],
        },
      ],
      permissionCeiling: 'read-only',
      expectedOutput: 'rag-evidence',
      acceptanceChecks: [],
      createdAt: 1,
      updatedAt: 1,
    }, agentToolManifests).ok,
    true,
    'agent workflow validation still accepts uniquely resolved bare tool names'
  )
  const ambiguousWorkflowSuggestion = createAgentWorkflowSkillSuggestionFromRun({
    run: {
      id: 'agent-run-ambiguous',
      goal: 'Search through MCP',
      intent: 'tool_task',
      status: 'done',
      startedAt: 1,
      completedAt: 2,
      finalOutput: 'done',
      traces: [],
      steps: [
        {
          id: 'step-1',
          title: 'Search through MCP',
          status: 'done',
          toolRequest: { name: 'search', arguments: { query: 'IsleMind' } },
          observation: {
            ok: true,
            status: 'done',
            output: 'done',
            trace: { id: 'trace-step-1', type: 'tool', title: 'Search', status: 'done' },
          },
          trace: [],
          startedAt: 1,
          completedAt: 2,
        },
      ],
    },
    manifests: agentToolManifests,
    now: 3,
  })
  assert.equal(
    ambiguousWorkflowSuggestion?.workflow.permissionCeiling,
    'read-only',
    'agent workflow skill suggestion no longer inflates the permission ceiling from an ambiguous bare tool name'
  )
  const ambiguousWorkflowPreview = ambiguousWorkflowSuggestion
    ? buildAgentWorkflowSkillSavePreview(ambiguousWorkflowSuggestion)
    : null
  assert.ok(
    ambiguousWorkflowPreview?.errorCount > 0,
    'agent workflow skill preview reports the ambiguous bare tool reference as an error'
  )
  assert.ok(
    buildMcpContextPrompt(selectedMcpTools.filter((item) => item.server.status === 'connected'), MCP_TOOL_CALL_TAG).includes('<islemind_mcp_call>JSON</islemind_mcp_call>'),
    'chat MCP context helper instructs the model to emit one tagged JSON block for MCP tool calls'
  )
  const mcpManifestTrace = buildMcpManifestTrace(
    selectedMcpTools.filter((item) => item.server.status === 'connected'),
    selectedMcpTools.filter((item) => item.server.status !== 'connected'),
    123,
    (trace) => ({ ...trace, completedAt: trace.completedAt ?? 456 }),
    (prefix) => `${prefix}-fixture`,
  )
  assert.equal(mcpManifestTrace.id, 'mcp-manifest-fixture', 'chat MCP context helper keeps the manifest trace id prefix')
  assert.equal(mcpManifestTrace.metadata.connected, 1, 'chat MCP context helper records connected tool count')
  assert.equal(mcpManifestTrace.metadata.offline, 1, 'chat MCP context helper records offline tool count')
  assert.deepEqual(
    completeTrace({ id: 'trace-complete', type: 'system', title: 'Trace', status: 'running', startedAt: 100, completedAt: 160 }),
    { id: 'trace-complete', type: 'system', title: 'Trace', status: 'running', startedAt: 100, completedAt: 160, durationMs: 60 },
    'chat trace helper preserves explicit completion time and derives duration'
  )
  assert.equal(
    clampTraceContent('x'.repeat(530), 'tool'),
    `${'x'.repeat(520)}...`,
    'chat trace helper keeps the existing short tool trace content limit'
  )
  assert.deepEqual(
    sanitizeTrace({
      id: 'trace-safe',
      type: 'tool',
      title: 'Uses apiKey=secret-value',
      content: '  Bearer sensitive-token-value  ',
      status: 'running',
      completedAt: 200,
      metadata: { authorization: 'Bearer sensitive-token-value', tokenCount: 12 },
    }),
    {
      id: 'trace-safe',
      type: 'tool',
      title: 'Uses [redacted]',
      content: '[redacted]',
      status: 'done',
      completedAt: 200,
      metadata: { authorization: '[redacted]', tokenCount: 12 },
    },
    'chat trace helper redacts title/content/metadata and completes finished running traces'
  )
  assertTraceRedactionBehavior()
  const unsettledTraceMessage = {
    retrievalTrace: [{ id: 'retrieval-a', type: 'retrieval', title: 'Retrieval', status: 'running', startedAt: 100 }],
    reasoning: [{ id: 'reasoning-a', type: 'reasoning', title: 'Reasoning', status: 'done', startedAt: 100, completedAt: 120 }],
    toolCalls: [{ id: 'tool-a', type: 'tool', title: 'Tool', status: 'pending' }],
  }
  assert.deepEqual(
    tracesNeedingSettlement(unsettledTraceMessage).map((trace) => trace.id),
    ['retrieval-a', 'tool-a'],
    'chat trace helper selects only running and pending message traces for settlement'
  )
  assert.equal(
    settleTrace({ id: 'tool-a', type: 'tool', title: 'Tool', status: 'pending' }, { fallbackStatus: 'skipped', fallbackContent: 'Stopped' }).content,
    'Stopped',
    'chat trace helper supplies fallback content when settling an empty trace'
  )
  assert.deepEqual(
    settleMessageTraces(unsettledTraceMessage, { fallbackStatus: 'skipped', fallbackContent: 'Stopped' }).map((trace) => [trace.id, trace.status, trace.content]),
    [['retrieval-a', 'skipped', 'Stopped'], ['tool-a', 'skipped', 'Stopped']],
    'chat trace helper settles only active message traces'
  )
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
  assert.equal(summarizePayloadPolicy(undefined), 'not_evaluated', 'runtime diagnostics summarize missing payload policy')
  assert.equal(
    summarizePayloadPolicy({ mode: 'warn', blocked: false, findings: [], bodyKeys: [], messageCount: 1, attachmentCount: 0 }),
    'warn:ok',
    'runtime diagnostics summarize clean payload policy'
  )
  assert.equal(
    summarizePayloadPolicy({ mode: 'block', blocked: true, findings: [{ id: 'empty_messages', severity: 'error', message: 'empty' }], bodyKeys: [], messageCount: 0, attachmentCount: 0 }),
    'blocked:empty_messages',
    'runtime diagnostics summarize blocked payload policy findings'
  )
  assert.equal(
    summarizeRouteDecision({ blocked: true, blockReasons: ['unsupported_protocol', ''], warnings: [], protocol: 'openai-responses' }),
    'blocked:unsupported_protocol',
    'runtime diagnostics summarize blocked route decisions'
  )
  assert.equal(
    summarizeTransportSelection({ transport: 'http_sse', requestedMode: 'websocket', fallbackReason: 'streaming_disabled' }),
    'http_sse:streaming_disabled',
    'runtime diagnostics summarize transport fallback reasons'
  )
  assert.equal(
    summarizeProxyPolicy({ mode: 'custom-base-url', applied: true, reason: 'custom_base_url', effectiveUrl: 'https://proxy.example/v1/responses' }),
    'custom-base-url:applied:custom_base_url',
    'runtime diagnostics summarize proxy policy decisions'
  )
  assert.deepEqual(
    runtimeLogOptions({ settings: { runtimeLogEnabled: true, runtimeLogMaxBytes: 2048 } }),
    { enabled: true, maxBytes: 2048 },
    'runtime diagnostics extract runtime log options'
  )
  const runtimeLogReq = {
    conversationId: 'conv-log',
    provider: { id: 'provider-log' },
    model: 'upstream-log-model',
    requestedModel: 'alias-log-model',
    settings: { runtimeLogEnabled: true },
  }
  const payloadLogData = buildPayloadPolicyLogData(runtimeLogReq, { mode: 'warn', blocked: false, findings: [], bodyKeys: ['model', 'messages'], messageCount: 1, attachmentCount: 0 })
  assert.deepEqual(
    payloadLogData,
    {
      conversationId: 'conv-log',
      providerId: 'provider-log',
      model: 'upstream-log-model',
      requestedModel: 'alias-log-model',
      upstreamModel: 'upstream-log-model',
      mode: 'warn',
      blocked: false,
      findings: [],
      bodyKeys: ['model', 'messages'],
      messageCount: 1,
      attachmentCount: 0,
    },
    'runtime diagnostics builds payload policy log data'
  )
  assert.equal(
    buildProviderRouteDecisionLogData(runtimeLogReq, { blocked: true, blockReasons: ['unsupported_protocol'], warnings: [], protocol: 'openai-responses', capabilitySource: { confidence: 'known' } }).route.blocked,
    true,
    'runtime diagnostics builds route decision log data'
  )
  assert.equal(
    buildProxyPolicyLogData(runtimeLogReq, { mode: 'custom-base-url', applied: true, reason: 'custom_base_url', endpointHost: 'proxy.example' }).endpointHost,
    'proxy.example',
    'runtime diagnostics builds proxy policy log data'
  )
  assert.equal(
    buildUpstreamRequestLogData(
      runtimeLogReq,
      { transport: 'http_sse', requestedMode: 'websocket', fallbackReason: 'streaming_disabled' },
      { mode: 'warn', blocked: false, findings: [], bodyKeys: ['model'], messageCount: 1, attachmentCount: 0 },
      { mode: 'off', applied: false, reason: 'disabled' }
    ).transport,
    'http_sse',
    'runtime diagnostics builds upstream request log data'
  )
  const streamModeTrace = createStreamModeTrace('buffered', 'Buffered fallback is running.')
  assert.equal(streamModeTrace.status, 'skipped', 'runtime diagnostics creates skipped buffered stream-mode traces')
  assert.equal(streamModeTrace.metadata.streamMode, 'buffered', 'runtime diagnostics records stream mode metadata')
  const governanceTrace = createRuntimeGovernanceTrace({
    req: { provider: { id: 'governed-provider' } },
    requestedModel: 'alias-model',
    upstreamModel: 'upstream-model',
    access: { allowed: false, reason: 'model_blocked', matchedRules: ['block-a'] },
    route: { blocked: true, blockReasons: ['unsupported_protocol'], warnings: [], protocol: 'openai-responses', capabilitySource: { confidence: 'known' } },
    transport: { transport: 'http_sse', requestedMode: 'websocket', fallbackReason: 'streaming_disabled' },
    payload: { mode: 'block', blocked: true, findings: [{ id: 'empty_messages', severity: 'error', message: 'empty' }], bodyKeys: ['model'], messageCount: 0, attachmentCount: 0 },
    proxy: { mode: 'custom-base-url', applied: true, reason: 'custom_base_url', effectiveUrl: 'https://proxy.example/v1/responses', endpointHost: 'proxy.example' },
    status: 'error',
  })
  assert.equal(governanceTrace.metadata.source, 'runtime-policy', 'runtime diagnostics creates runtime governance traces')
  assert.equal(governanceTrace.metadata.accessReason, 'model_blocked', 'runtime diagnostics records governance access reason')
  assert.deepEqual(governanceTrace.metadata.payloadFindings, ['empty_messages'], 'runtime diagnostics records payload finding ids')
  const emittedGovernanceTraces = []
  emitRuntimeGovernanceTrace({
    onTrace: (trace) => emittedGovernanceTraces.push(trace),
    req: { provider: { id: 'governed-provider' } },
    requestedModel: 'alias-model',
    upstreamModel: 'upstream-model',
    access: { allowed: true, matchedRules: [] },
    status: 'done',
  })
  emitRuntimeGovernanceTrace({
    req: { provider: { id: 'governed-provider' } },
    requestedModel: 'alias-model',
    upstreamModel: 'upstream-model',
    access: { allowed: true, matchedRules: [] },
    status: 'done',
  })
  assert.equal(emittedGovernanceTraces.length, 1, 'runtime diagnostics emits governance traces only when a callback is present')
  assert.equal(emittedGovernanceTraces[0].metadata.source, 'runtime-policy', 'runtime diagnostics emit helper preserves governance trace shape')
  const fallbackTrace = createRuntimeFallbackTrace(
    { provider: { id: 'primary-provider' }, model: 'primary-model', requestedModel: 'alias-model' },
    {
      classification: { trigger: 'rate_limited', retryable: true, source: 'status', evidence: { status: 429 } },
      decision: {
        mode: 'approved-providers',
        trigger: 'rate_limited',
        eligible: true,
        selected: { providerId: 'backup-provider', model: 'backup-model' },
        acceptedCandidates: [{ providerId: 'backup-provider', model: 'backup-model' }],
        rejectedCandidates: [{ providerId: 'slow-provider', model: 'slow-model', reason: 'cooldown' }],
        blockedReasons: [],
        requiresUserConfirmation: false,
        reason: 'selected',
      },
    },
    'done'
  )
  assert.equal(fallbackTrace.metadata.source, 'runtime-fallback', 'runtime diagnostics creates runtime fallback traces')
  assert.equal(fallbackTrace.metadata.selectedProviderId, 'backup-provider', 'runtime diagnostics records fallback selected provider')
  assert.equal(fallbackTrace.metadata.rejectedCandidateCount, 1, 'runtime diagnostics records fallback rejection counts')
  assert.deepEqual(
    withCredentialGroup({ text: 'ok' }, 'group-a'),
    { text: 'ok', credentialGroupId: 'group-a' },
    'provider runtime result helper attaches credential group ids'
  )
  assert.deepEqual(
    withCredentialGroup({ text: 'ok' }, undefined),
    { text: 'ok' },
    'provider runtime result helper preserves unscoped results'
  )
  const runtimeError = providerRuntimeError('blocked', 'group-b')
  assert.equal(runtimeError.message, 'blocked', 'provider runtime result helper preserves error messages')
  assert.equal(runtimeError.credentialGroupId, 'group-b', 'provider runtime result helper attaches credential group ids to errors')
  const streamTaskErrors = []
  await runStreamTask(async () => {
    throw new Error('stream failed')
  }, (error) => streamTaskErrors.push(error), 'group-c')
  assert.equal(streamTaskErrors[0]?.message, 'stream failed', 'provider runtime result helper forwards stream task errors')
  assert.equal(streamTaskErrors[0]?.credentialGroupId, 'group-c', 'provider runtime result helper applies fallback credential group id')
  const abortErrors = []
  const abortError = new Error('aborted')
  abortError.name = 'AbortError'
  await runStreamTask(async () => {
    throw abortError
  }, (error) => abortErrors.push(error), 'group-d')
  assert.equal(abortErrors.length, 0, 'provider runtime result helper suppresses abort errors')
  const retryRuntimeReq = {
    provider: { id: 'retry-provider' },
    model: `retry-model-${Date.now()}`,
    settings: {
      upstreamRequestTimeoutMs: 1,
      upstreamMaxRetries: 99,
      upstreamCircuitBreakerFailureThreshold: 1,
      upstreamCircuitBreakerCooldownMs: 1000,
    },
  }
  assert.equal(resolveProviderRequestTimeoutMs(retryRuntimeReq, 60000), 5000, 'provider runtime retry helper clamps request timeout minimum')
  assert.equal(resolveProviderMaxRetries(retryRuntimeReq), 5, 'provider runtime retry helper clamps max retries')
  assert.equal(providerRetryDelayMs(0), 250, 'provider runtime retry helper keeps first retry delay')
  assert.equal(providerRetryDelayMs(5), 2000, 'provider runtime retry helper caps retry delay')
  const retryCircuitKey = providerCircuitKey(retryRuntimeReq)
  recordProviderCircuitFailure(retryRuntimeReq, retryCircuitKey)
  assert.throws(
    () => assertProviderCircuitClosed(retryRuntimeReq, retryCircuitKey),
    /circuit_breaker_open/,
    'provider runtime retry helper opens circuit after configured failure threshold'
  )
  recordProviderCircuitSuccess(retryCircuitKey)
  assert.doesNotThrow(
    () => assertProviderCircuitClosed(retryRuntimeReq, retryCircuitKey),
    'provider runtime retry helper clears circuit after successful request'
  )
  assert.equal(
    resolveProxyPolicyForTest({
      provider: governedProvider,
      url: 'https://api.openai.com/v1/responses?x=1',
      settings: { proxyMode: 'custom-base-url', proxyBaseUrl: 'https://proxy.example/upstream' },
    }).effectiveUrl,
    'https://proxy.example/upstream/v1/responses?x=1',
    'custom-base-url proxy preserves endpoint path and query'
  )
  assert.equal(
    resolveProxyPolicyForTest({
      provider: governedProvider,
      url: 'https://api.openai.com/v1/responses?x=1',
      settings: { proxyMode: 'custom-base-url', proxyBaseUrl: 'file:///tmp/proxy' },
    }).reason,
    'invalid_custom_base_url',
    'custom-base-url proxy rejects file URLs before credentialed fetch'
  )
  assert.equal(
    resolveProxyPolicyForTest({
      provider: governedProvider,
      url: 'https://api.openai.com/v1/responses?x=1',
      settings: { proxyMode: 'custom-base-url', proxyBaseUrl: 'islemind://proxy' },
    }).reason,
    'invalid_custom_base_url',
    'custom-base-url proxy rejects app-scheme proxy URLs before credentialed fetch'
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
    settings: { remoteCompactThresholdTokens: 200000 },
  })
  assert.deepEqual(
    compactResponsesBody.context_management,
    [{ type: 'compaction', compact_threshold: 200000 }],
    'Responses requests include server-side compaction when remote compact is eligible'
  )
  const compatibleResponsesProvider = {
    id: 'relay-openai-compatible',
    type: 'openai-compatible',
    presetId: 'custom-openai-compatible',
    name: 'Relay OpenAI Compatible',
    baseUrl: 'https://relay.example/v1',
    apiKey: FAKE_KEY_A,
    models: ['gpt-5.2'],
    enabled: true,
    capabilities: { nativeTools: true, responsesApi: true },
  }
  assert.equal(
    usesOpenAIResponses({ provider: compatibleResponsesProvider, model: 'gpt-5.2', webSearchMode: 'native' }),
    true,
    'openai-compatible providers can opt into Responses routing when relay capabilities declare responsesApi support'
  )
  const compatibleResponsesBody = getBodyForTest({
    provider: compatibleResponsesProvider,
    model: 'gpt-5.2',
    messages: [{ role: 'user', content: 'relay me through responses' }],
    webSearchMode: 'native',
    maxTokens: 256,
    remoteCompactEligible: true,
    settings: { remoteCompactThresholdTokens: 200000 },
  })
  assert.equal(Array.isArray(compatibleResponsesBody.input), true, 'openai-compatible Responses relays use Responses input payloads')
  assert.deepEqual(
    compatibleResponsesBody.context_management,
    [{ type: 'compaction', compact_threshold: 200000 }],
    'openai-compatible Responses relays forward server-side compaction settings'
  )
  assert.equal(
    resolveProviderEndpoint({
      provider: compatibleResponsesProvider,
      model: 'gpt-5.2',
      stream: true,
      usesResponsesApi: true,
    }),
    'https://relay.example/v1/responses',
    'openai-compatible Responses relays resolve to their configured /responses endpoint'
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
  const completedRemoteCompactUsageInput = buildCompletedRemoteCompactUsageInput({
    conversationId: 'conversation-1',
    providerId: 'openai-main',
    model: 'gpt-5.2',
    upstreamModel: 'gpt-5.2',
    mode: 'auto',
    responseId: 'resp-1',
    previousResponseId: 'resp-prev',
    inputTokens: 1000,
    outputTokens: 120,
    messageCount: 12,
  })
  assert.deepEqual(
    completedRemoteCompactUsageInput,
    {
      mode: 'auto',
      providerId: 'openai-main',
      model: 'gpt-5.2',
      upstreamModel: 'gpt-5.2',
      inputTokens: 1000,
      outputTokens: 120,
      estimatedSavedTokens: 430,
    },
    'chat remote compact helper preserves compact usage input fields and saved-token estimates'
  )
  const completedRemoteCompactRecord = recordCompactUsage(completedRemoteCompactUsageInput)
  const completedRemoteCompactLogPayload = buildCompletedRemoteCompactRuntimeLogPayload({
    conversationId: 'conversation-1',
    record: completedRemoteCompactRecord,
    responseId: 'resp-1',
    previousResponseId: 'resp-prev',
  })
  assert.equal(completedRemoteCompactLogPayload.status, 'completed', 'chat remote compact helper marks completed runtime log payloads')
  assert.equal(completedRemoteCompactLogPayload.responseId, 'resp-1', 'chat remote compact helper preserves the compact response id in runtime logs')
  const completedRemoteCompactState = buildCompletedRemoteCompactStateRecord({
    conversationId: 'conversation-1',
    record: completedRemoteCompactRecord,
    responseId: 'resp-1',
    previousResponseId: 'resp-prev',
    messageCount: 12,
    now: 123456,
  })
  assert.equal(completedRemoteCompactState.id, 'compact-state-resp-1', 'chat remote compact helper derives compact state ids from response ids')
  assert.equal(completedRemoteCompactState.sourceMessageEndIndex, 11, 'chat remote compact helper preserves the last source message index')
  assert.equal(
    buildCompletedRemoteCompactStateRecord({
      conversationId: 'conversation-1',
      record: completedRemoteCompactRecord,
      responseId: undefined,
      previousResponseId: 'resp-prev',
      messageCount: 12,
      now: 123456,
    }),
    undefined,
    'chat remote compact helper skips compact state persistence when no response id is available'
  )
  clearCompactUsageRecords()
  recordCompactUsage({ mode: 'auto', providerId: 'openai-main', model: 'gpt-5.2', inputTokens: 100, outputTokens: 20, estimatedSavedTokens: 35 })
  assert.equal(listCompactUsageRecords().length, 1, 'compact usage accounting stores separate compact records')
  const redactedLog = redactRuntimeLogValue({
    authorization: 'Bearer abcdefghijklmnopqrstuvwxyz123456',
    apiKey: 'sk-testabcdefghijklmnopqrstuvwxyz123456',
    endpoint: `https://example.com/models?key=${FAKE_KEY_A}&refresh_token=refresh-secret-token`,
    proxyEndpoint: 'https://runtime-user:runtime-password@example.com/chat/completions',
    details: 'refresh_token=Abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGH',
    headerText: 'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==; proxy-authorization: bearer abcdefghijklmnopqrstuvwxyz123456',
    body: JSON.stringify({ model: 'gpt-5.2', input: [{ content: 'secret prompt text' }] }),
  })
  assert.equal(redactedLog.authorization, '[redacted]', 'runtime log redacts authorization fields')
  assert.equal(redactedLog.apiKey, '[redacted]', 'runtime log redacts API key fields')
  assert.equal(redactedLog.endpoint, 'https://example.com/models?key=[redacted]&refresh_token=[redacted]', 'runtime log redacts sensitive query-string assignments')
  assert.equal(redactedLog.proxyEndpoint, 'https://[redacted]@example.com/chat/completions', 'runtime log redacts URL userinfo credentials')
  assert.equal(redactedLog.details, 'refresh_token=[redacted]', 'runtime log redacts sensitive credential assignments in plain strings')
  assert.equal(redactedLog.headerText, 'Authorization: Basic [redacted]; proxy-authorization: bearer [redacted]', 'runtime log redacts header-like authorization strings')
  assert.deepEqual(redactedLog.body.keys, ['input', 'model'], 'runtime log stores payload keys instead of full body')
  const presignedLog = redactRuntimeLogValue({
    downloadUrl: 'https://example.com/download.apk?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260618%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260618T010203Z&X-Amz-Expires=300&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEOz%2F%2F%2F%2F%2F%2F8BEAAaCXVzLWVhc3QtMSJGMEQCIFakeToken&X-Amz-Signature=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  })
  assert.equal(
    presignedLog.downloadUrl,
    'https://example.com/download.apk?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=[redacted]&X-Amz-Date=20260618T010203Z&X-Amz-Expires=300&X-Amz-Security-Token=[redacted]&X-Amz-Signature=[redacted]',
    'runtime log redacts pre-signed URL credential, security-token, and signature parameters while preserving non-secret query context'
  )
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

  const blankSeparatedUrlKeyImported = parseProviderImportText(`
https://blank-key.example/v1

${FAKE_KEY_A}

${FAKE_KEY_B}
`)
  assert.equal(blankSeparatedUrlKeyImported.providers.length, 1, 'imports URL and following key-only blocks as one provider')
  assert.equal(blankSeparatedUrlKeyImported.providers[0].baseUrl, 'https://blank-key.example/v1')
  assert.equal(blankSeparatedUrlKeyImported.providers[0].credentialGroups.length, 2, 'keeps blank-separated keys on the URL provider')
  assert.equal(countDetectedProviderImports('   '), 0, 'provider import summary treats blank input as no detected providers')
  assert.equal(
    countDetectedProviderImports(`Provider Summary, https://summary.example/v1, ${FAKE_KEY_A}`),
    1,
    'provider import summary counts parseable provider import text'
  )
  assert.equal(
    formatProviderNameList([{ name: 'Provider Summary' }, { name: '   ' }, { name: 'Provider Backup' }]),
    '- Provider Summary\n- Provider Backup',
    'provider import summary formats non-empty provider names for confirmation copy'
  )

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
  const providerImportSummarySource = fs.readFileSync(path.join(root, 'src/services/providerImportSummary.ts'), 'utf8')
  const apiKeyPanelSource = fs.readFileSync(path.join(root, 'src/components/settings/ApiKeyPanel.tsx'), 'utf8')
  const skillSettingsContentSource = fs.readFileSync(path.join(root, 'src/components/settings/SkillSettingsContent.tsx'), 'utf8')
  assert.ok(providerSettingsContentSource.includes('Clipboard.hasStringAsync()'), 'provider import requests clipboard text availability before reading clipboard text')
  assert.ok(providerSettingsContentSource.includes('countDetectedProviderImports(input)'), 'provider import modal routes manual detection through the import summary helper')
  assert.ok(providerImportSummarySource.includes('parseProviderImportText(input)'), 'provider import summary helper detects manually pasted provider configs')
  assert.ok(providerSettingsContentSource.includes("parseProviderImportDraft(text, { requireConnection: source === 'manual', preferredWireProtocol: wireProtocol })"), 'add provider form applies detected provider import drafts from clipboard and manual input')
  assert.ok(providerSettingsContentSource.includes('onChangeText: handleKeysText'), 'add provider form routes token input through provider import auto-detection')
  assert.ok(apiKeyPanelSource.includes('readProviderClipboard'), 'single provider editor exposes clipboard provider import handling')
  assert.ok(apiKeyPanelSource.includes('onChangeText: handleCredentialText'), 'single provider editor routes multi-token input through provider import auto-detection')
  assert.ok(skillSettingsContentSource.includes("await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)"), 'skill export clears its temporary share file after the share flow completes')
  assert.ok(skillSettingsContentSource.includes("await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })"), 'skill import clears cached picker copies after reading import files')
  assert.ok(providerSettingsContentSource.includes("await deleteTemporaryImportCopy(importUri, { assumeTemporaryCopy: true })"), 'provider import clears cached picker copies after reading import files')

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
  const invalidProbe = await probeProviderPreset(
    { baseUrl: 'file:///tmp/provider', [API_KEY_FIELD]: 'token-probe-fake' },
    {
      fetch: async () => {
        throw new Error('probe fetch should not run for invalid provider base URLs')
      },
    }
  )
  assert.equal(invalidProbe.ok, false, 'provider preset probe rejects invalid custom base URLs before network probe')
  assert.match(invalidProbe.reason, /http:\/\/|https:\/\//i, 'provider preset probe surfaces the invalid custom base URL reason')

  assert.equal(resolveSearchProvider({ webSearchEnabled: true, searchProvider: 'google' }), 'google')
  assert.equal(resolveSearchProvider({ webSearchEnabled: true, webSearchMode: 'tavily' }), 'tavily')
  assert.equal(resolveSearchProvider({ webSearchEnabled: false, searchProvider: 'google' }), 'off')
  assert.equal(legacySearchModeForProvider('bing'), 'tavily')
  assert.equal(getBingCompatibleEndpoint({ customSearchEndpoint: '' }), null, 'Bing requires an explicit compatible endpoint')
  assert.equal(getBingCompatibleEndpoint({ customSearchEndpoint: ' https://search.example?q={query} ' }), 'https://search.example?q={query}')
  assert.equal(safeCustomSearchEndpoint('file:///tmp/search.json'), null, 'custom search endpoint rejects file URLs before credentialed fetch')
  assert.equal(safeCustomSearchEndpoint('islemind://search'), null, 'custom search endpoint rejects app-scheme URLs before credentialed fetch')
  assert.equal(safeCustomSearchEndpoint('https://user:pass@search.example/query'), null, 'custom search endpoint rejects embedded credentials')
  assert.equal(buildCustomSearchUrl('https://search.example?q={query}&limit={limit}', 'a b', 3), 'https://search.example?q=a%20b&limit=3', 'custom search endpoint builds safe HTTPS query URLs')
  assert.equal(buildCustomSearchUrl('{query}', 'file:///tmp/leak', 3), null, 'custom search endpoint rejects template output that is not an HTTP URL')

  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      webSearchEnabled: true,
      searchProvider: 'native',
      webSearchMode: 'tavily',
    },
  }))
  const nativeSearch = await searchExternalWeb('latest IsleMind status', 3)
  assert.equal(nativeSearch.ok, false, 'provider-native search adapter reports a non-local execution path instead of empty success')
  assert.equal(nativeSearch.code, 'native', 'provider-native search adapter records a native-mode code')
  const nativeToolSearch = await callBuiltinTool('search_web', { query: 'latest IsleMind status' }, Date.now())
  assert.equal(nativeToolSearch.ok, false, 'built-in search_web does not treat provider-native search as a successful empty tool result')
  assert.ok(nativeToolSearch.content[0]?.text?.trim(), 'built-in search_web native-mode result includes visible tool output')
  assert.equal(nativeToolSearch.trace.status, 'error', 'built-in search_web native-mode trace is marked as an error for provider-native revision')

  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      webSearchEnabled: false,
      searchProvider: 'off',
      webSearchMode: 'tavily',
    },
  }))
  const disabledToolSearch = await callBuiltinTool('search_web', { query: 'latest IsleMind status' }, Date.now())
  assert.equal(disabledToolSearch.ok, false, 'disabled search_web returns explicit failure instead of empty success')
  assert.ok(disabledToolSearch.content[0]?.text?.includes(st('search.disabled')), 'disabled search_web surfaces a localized disabled message')

  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      webSearchEnabled: true,
      searchProvider: 'tavily',
      webSearchMode: 'tavily',
    },
  }))
  const noResultToolSearch = await callBuiltinTool('search_web', { query: 'latest IsleMind status' }, Date.now())
  assert.equal(noResultToolSearch.ok, false, 'configured search_web without provider output returns explicit failure')
  assert.ok(noResultToolSearch.content[0]?.text?.includes(st('search.noResults')), 'configured search_web no-output state includes a visible no-results message')

  assert.equal(hasCustomProviderBaseUrl({ baseUrl: ' https://api.example/v1 ' }), true, 'provider base URL helper detects explicit custom endpoints')
  assert.equal(hasCustomProviderBaseUrl({ baseUrl: '   ' }), false, 'provider base URL helper ignores blank custom endpoints')
  assert.equal(isHttpProviderBaseUrl({ type: 'openai-compatible', baseUrl: 'https://api.example/v1' }), true, 'provider base URL helper accepts HTTPS custom endpoints')
  assert.equal(isHttpProviderBaseUrl({ type: 'openai-compatible', baseUrl: 'file:///tmp/provider' }), false, 'provider base URL helper rejects file custom endpoints')
  assert.equal(isHttpProviderBaseUrl({ type: 'openai-compatible', baseUrl: 'https://user:pass@api.example/v1' }), false, 'provider base URL helper rejects embedded credentials')
  assert.equal(getProviderConfigIssue({ type: 'openai-compatible', baseUrl: 'islemind://provider' }, 'token-test-fake')?.code, 'bad_base_url', 'provider settings validation rejects app-scheme custom base URLs')

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
  assert.equal(findCredentialGroupIdForKey(normalized, ` ${normalized.credentialGroups[1].apiKey} `), groups[1].id, 'credential helper finds a token group by trimmed API key')
  assert.equal(findCredentialGroupIdForKey(normalized, '   '), undefined, 'credential helper ignores blank API keys')
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
  const aliasBothModelDenied = mergeAliasAccessPolicyForTest(
    resolveProviderModelAccessForTest({ provider: manualProvider, model: 'fast', settings: { modelAllowlist: ['never-*'] } }),
    resolveProviderModelAccessForTest({ provider: manualProvider, model: resolveProviderModelAlias(manualProvider, 'fast'), settings: { modelAllowlist: ['never-*'] } })
  )
  assert.equal(aliasBothModelDenied.model, resolveProviderModelAlias(manualProvider, 'fast'), 'runtime alias access policy preserves upstream denial context when both alias and target miss the allowlist')
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
  assert.deepEqual(sortMemories([
    { id: 'older', content: 'Older', status: 'active', createdAt: 1000, updatedAt: 2000, lastHitAt: 9000 },
    { id: 'newer', content: 'Newer', status: 'active', createdAt: 3000, updatedAt: 4000 },
  ], 'lastUsed').map((memory) => memory.id), ['older', 'newer'], 'context asset filters keep last-used memory sorting behavior')
  assert.deepEqual(
    filterAndSortMemories(memoryReviewQueue, { statusFocus: 'pending', reviewFocus: 'lowConfidence', filter: '62', sortMode: 'updated' }).map((memory) => memory.id),
    ['pending-model-low'],
    'context asset filters combine pending review focus, confidence search, and memory sorting'
  )
  assert.equal(hasMemoryAssetFilters('all', 'all', '  '), false, 'context asset filters treat blank memory filters as inactive')
  assert.equal(hasMemoryAssetFilters('pending', 'all', ''), true, 'context asset filters detect memory status focus')
  assert.equal(memoryAssetEmptyMessage('pending', '', (key) => key), 'contextPanel.noPendingMemories', 'context asset filters preserve pending-memory empty copy key')
  const testT = (key, values) => values ? `${key}:${JSON.stringify(values)}` : key
  assert.equal(capabilityLabel('embedding', testT), 'contextPanel.localModel.capabilities.embedding', 'context asset formatters preserve local capability label keys')
  assert.equal(memorySourceKindKey('imported'), 'contextPanel.memorySourceImported', 'context asset formatters preserve imported memory source key')
  assert.equal(memoryReviewFocusKey('model'), 'contextPanel.memoryReviewModelFilter', 'context asset formatters preserve model review filter key')
  assert.equal(formatMemoryTime(undefined), '-', 'context asset formatters keep missing memory timestamps compact')
  assert.equal(shortenKnowledgeSource('https://example.com/short.txt'), 'https://example.com/short.txt', 'context asset formatters keep short knowledge sources intact')
  assert.equal(
    shortenKnowledgeSource('https://example.com/very/long/path/to/a/knowledge/document/source-file.md'),
    'https://example.com/very...ent/source-file.md',
    'context asset formatters shorten long knowledge sources with the existing middle ellipsis shape'
  )
  assert.ok(
    formatMemoryMeta({ id: 'memory-meta', content: 'Meta memory', status: 'active', sourceKind: 'model', sourceDetail: 'agent', confidence: 0.876, conversationId: 'conversation-1234567890', createdAt: 1000, updatedAt: 3500, lastHitAt: 3000 }, testT)
      .includes('contextPanel.memoryConfidence:{"confidence":88}'),
    'context asset formatters preserve memory confidence rounding in meta text'
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
  const knowledgeFilterDocuments = [
    { id: 'ready-doc', title: 'Ready', mimeType: 'text/plain', size: 1200, chunkCount: 3, status: 'ready', createdAt: 1000, updatedAt: 1000 },
    { id: 'failed-doc', title: 'Failed', mimeType: 'text/plain', size: 800, chunkCount: 0, status: 'error', error: 'Parser failed', createdAt: 1000, updatedAt: 1200 },
    { id: 'empty-doc', title: 'Empty', mimeType: 'text/plain', size: 0, chunkCount: 0, status: 'ready', createdAt: 1000, updatedAt: 1300 },
    { id: 'indexing-doc', title: 'Indexing', mimeType: 'text/plain', size: 500, chunkCount: 0, status: 'extracting', createdAt: 1000, updatedAt: 1400 },
  ]
  assert.deepEqual(sortKnowledgeDocuments(knowledgeFilterDocuments, 'needsReview').map((document) => document.id), ['failed-doc', 'empty-doc', 'indexing-doc', 'ready-doc'], 'context asset filters keep knowledge review priority sorting')
  assert.deepEqual(
    filterAndSortKnowledgeDocuments(knowledgeFilterDocuments, { statusFocus: 'empty', filter: '', sortMode: 'updated' }).map((document) => document.id),
    ['empty-doc'],
    'context asset filters preserve empty ready-document focus'
  )
  assert.deepEqual(
    filterAndSortKnowledgeDocuments(knowledgeFilterDocuments, { statusFocus: 'all', filter: 'parser', sortMode: 'updated' }).map((document) => document.id),
    ['failed-doc'],
    'context asset filters search knowledge error text'
  )
  assert.equal(hasKnowledgeAssetFilters('all', '  '), false, 'context asset filters treat blank knowledge filters as inactive')
  assert.equal(hasKnowledgeAssetFilters('error', ''), true, 'context asset filters detect knowledge status focus')
  assert.equal(knowledgeAssetEmptyMessage('error', '', (key) => key), 'contextPanel.noFailedKnowledge', 'context asset filters preserve failed-knowledge empty copy key')
  assert.ok(
    formatKnowledgeMeta({ id: 'failed-doc', title: 'Failed', mimeType: 'text/plain', size: 800, chunkCount: 0, status: 'error', error: 'Parser failed', sourceUri: 'https://example.com/very/long/path/to/a/knowledge/document/source-file.md', createdAt: 1000, updatedAt: 1200 }, testT)
      .includes('contextPanel.knowledgeError:{"error":"Parser failed"}'),
    'context asset formatters preserve failed knowledge error meta text'
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
  assert.deepEqual(success('ok', { value: 1 }, 'group-a'), { ok: true, code: 'ok', message: 'ok', data: { value: 1 }, credentialGroupId: 'group-a' }, 'provider operation result helper preserves success result shape')
  assert.deepEqual(failure('bad_auth', 'bad key', undefined, 'group-b'), { ok: false, code: 'bad_auth', message: 'bad key', data: undefined, credentialGroupId: 'group-b' }, 'provider operation result helper preserves failure result shape')
  assert.equal(classifyHttpStatus(429, 'quota exceeded'), 'rate_limited', 'provider operation result helper classifies rate limits')
  assert.equal(classifyHttpStatus(404, 'missing model', 'model-a'), 'model_unavailable', 'provider operation result helper classifies missing models')
  assert.ok(
    extractProviderErrorDetail(JSON.stringify({ error: { type: 'upstream_error', message: 'No auth credentials found', request_id: 'req_123' } })).includes('req_123'),
    'provider operation result helper extracts request ids from JSON error payloads'
  )
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
  const queuedActivationItems = createActivationItems([
    { id: 'provider-a', name: 'Provider A' },
    { id: 'provider-b', name: 'Provider B' },
  ], 'Queued')
  const patchedActivationItems = patchActivationItem(queuedActivationItems, 'provider-a', {
    status: 'done',
    progress: 1.4,
    synced: true,
    tested: true,
  })
  const lockedActivationItems = patchActivationItem(patchedActivationItems, 'provider-a', {
    status: 'running',
    progress: 0.2,
  })
  assert.equal(ACTIVATION_STAGE_PROGRESS.testing, 0.76, 'activation job progress keeps the existing testing stage weight')
  assert.equal(activationItemProgress(Number.POSITIVE_INFINITY), 0, 'activation job progress rejects non-finite progress')
  assert.equal(lockedActivationItems[0].status, 'done', 'activation job progress does not regress completed items to running')
  assert.equal(lockedActivationItems[0].progress, 1, 'activation job progress clamps item progress')
  assert.deepEqual(
    aggregateActivationItems(lockedActivationItems),
    { completed: 1, synced: 1, tested: 1, failed: 0, progress: 0.5 },
    'activation job progress aggregates completed, synced, tested, failed, and average progress'
  )
  const providerListFixtures = [
    { id: 'alpha', type: 'openai-compatible', name: 'Alpha Provider', enabled: true, models: ['gpt-4o'], modelConfigs: [{ id: 'gpt-4o', name: 'Fast Alias' }], lastTestStatus: 'ok', lastModelSyncStatus: 'ok' },
    { id: 'beta', type: 'openai-compatible', name: 'Beta Provider', enabled: false, models: ['legacy-model'], lastTestStatus: 'bad', lastModelSyncStatus: 'bad' },
    { id: 'gamma', type: 'openai-compatible', name: 'Gamma Provider', enabled: true, models: ['gpt-4o', 'gpt-5'], lastTestStatus: 'idle', lastModelSyncStatus: 'ok' },
  ]
  assert.equal(providerMatchesModelFilter(providerListFixtures[0], 'gpt-4o'), true, 'provider settings filter matches policy-visible model ids')
  assert.deepEqual(
    filterAndSortProviders(providerListFixtures, { filter: 'gpt-5', sortMode: 'manual', usageByProvider: new Map() }).map((provider) => provider.id),
    ['gamma'],
    'provider settings filter keeps model-id searches behind the shared helper'
  )
  assert.equal(
    [...providerListFixtures].sort((a, b) => compareProviders(a, b, 'health', new Map()))[0].id,
    'alpha',
    'provider settings health sort prioritizes passing model tests'
  )
  assert.deepEqual(
    filterAndSortProviders(providerListFixtures, { filter: '', sortMode: 'recent', usageByProvider: new Map([['beta', 30], ['alpha', 10], ['gamma', 20]]) }).map((provider) => provider.id),
    ['beta', 'gamma', 'alpha'],
    'provider settings recent sort uses conversation timestamps'
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
    'provider activation auto-tests a bounded set of allowed models per credential group'
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
  assert.equal(manyModelActivationCandidates.length, 6, 'provider activation keeps automatic testing bounded to three candidates per credential group')
  assert.deepEqual(
    manyModelActivationCandidates.map((candidate) => candidate.groupId),
    ['group-a', 'group-a', 'group-a', 'group-b', 'group-b', 'group-b'],
    'provider activation can try alternate synced models before marking a credential group unhealthy'
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
  const originalFetchForActivationFallback = global.fetch
  let resilientActivationProvider = {
    ...activationPolicyProvider,
    id: 'activation-resilient-models',
    name: 'Activation Resilient Models',
    models: ['bad-model', 'good-model', 'extra-model'],
    manualModels: [],
    syncPolicy: { minDelayMs: 0, maxDelayMs: 0, timeoutMs: 18000, strategy: 'sequential-low-rate' },
    credentialGroups: [
      { id: 'resilient-group', label: 'Resilient Group', apiKey: FAKE_KEY_A, enabled: true, lastModelSyncStatus: 'idle', availableModels: [] },
    ],
  }
  const resilientTestedModels = []
  const resilientGroupHealth = []
  try {
    global.fetch = async (_url, init = {}) => {
      if ((init.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({
          data: [
            { id: 'bad-model' },
            { id: 'good-model' },
            { id: 'extra-model' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      const body = JSON.parse(init.body)
      resilientTestedModels.push(body.model)
      if (body.model === 'bad-model') {
        return new Response('upstream model temporarily unavailable', { status: 500 })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const resilientActivation = await syncAndTestProvider(resilientActivationProvider, {
      updateProvider: async (_id, updates) => {
        resilientActivationProvider = { ...resilientActivationProvider, ...updates }
      },
      hydrateProviderKey: async () => resilientActivationProvider,
      updateProviderCredentialGroupHealth: async (_providerId, groupId, ok) => {
        resilientGroupHealth.push({ groupId, ok })
      },
      delay: async () => undefined,
    }, { enable: true, checkParameters: false })
    assert.equal(resilientActivation.testOk, true, 'provider activation succeeds when a later synced model passes')
    assert.notEqual(resilientActivation.testModel, 'bad-model', 'provider activation records a later passing fallback model')
    assert.equal(resilientTestedModels[0], 'bad-model', 'provider activation tries the first synced model before fallback candidates')
    assert.equal(resilientTestedModels.length, 2, 'provider activation stops after the first later synced model passes')
    assert.deepEqual(resilientGroupHealth.map((item) => item.ok), [false, true], 'provider activation records failed and recovered credential health checks')
    assert.equal(resilientActivationProvider.lastTestStatus, 'ok', 'provider activation stores ok health after a fallback model passes')
  } finally {
    global.fetch = originalFetchForActivationFallback
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
  await assertSettingsUrlPersistenceBehavior()

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
  await mergeProviderHealthRecords([{
    providerId: 'restore-stale-provider',
    model: 'restore-model',
    status: 'cooldown',
    successes: 0,
    failures: 1,
    consecutiveFailures: 1,
    lastFailureAtMs: 1,
  }], { nowMs: 2 })
  await saveCompactState({
    id: 'restore-stale-compact',
    conversationId: 'restore-stale-conversation',
    providerId: 'restore-stale-provider',
    model: 'restore-model',
    compactItemJson: '{"summary":"stale restore compact"}',
    sourceMessageStartIndex: 0,
    sourceMessageEndIndex: 1,
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  })
  clearCompactUsageRecords()
  recordCompactUsage({
    mode: 'auto',
    providerId: 'restore-stale-provider',
    model: 'restore-model',
    inputTokens: 9,
    outputTokens: 3,
  })
  secureStorage.set('islemind.key.tavily', FAKE_KEY_C)
  secureStorage.set('islemind.key.google-search', FAKE_KEY_D)
  secureStorage.set('islemind.key.bing-search', FAKE_KEY_E)
  secureStorage.set('islemind.key.custom-search', FAKE_KEY_F)
  await appendRuntimeLog('storage.operation', { detail: 'restore-stale-runtime-log-seed' }, { enabled: true, maxBytes: 4096 })
  const restoreRuntimeStateResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(restoreRuntimeStateResult, { ok: true, kind: 'islemind', conversations: 0 }, 'portable restore still accepts otherwise valid backups while clearing stale runtime state')
  assert.deepEqual((await loadProviderHealthSnapshot({ nowMs: 2 })).records, [], 'portable restore clears persisted provider health snapshots before applying imported state')
  assert.deepEqual(await listActiveCompactStates('restore-stale-conversation', 'restore-stale-provider', 'restore-model'), [], 'portable restore clears persisted remote compact state before applying imported state')
  assert.deepEqual(listCompactUsageRecords(), [], 'portable restore clears in-memory compact usage records before applying imported state')
  assert.equal(secureStorage.get('islemind.key.tavily'), undefined, 'portable restore clears stale Tavily search keys before applying imported state')
  assert.equal(secureStorage.get('islemind.key.google-search'), undefined, 'portable restore clears stale Google search keys before applying imported state')
  assert.equal(secureStorage.get('islemind.key.bing-search'), undefined, 'portable restore clears stale Bing search keys before applying imported state')
  assert.equal(secureStorage.get('islemind.key.custom-search'), undefined, 'portable restore clears stale custom-search keys before applying imported state')
  assert.equal((await getRuntimeLogInfo()).exists, false, 'portable restore clears stale runtime log files before applying imported state')
  await saveData('SETTINGS', {
    theme: 'dark',
    language: 'ja',
    defaultProvider: 'stale-provider',
    fontSize: 18,
    hapticsEnabled: false,
  })
  await saveData('SKILLS', [{
    schema: 'islemind.skill.v1',
    id: 'stale-skill',
    name: 'Stale Skill',
    layer: 'base',
    priority: 0,
    systemPrompt: 'stale skill',
    createdAt: 1,
    updatedAt: 1,
    tags: [],
  }])
  await saveData('MCP_SERVERS', [{
    id: 'stale-mcp',
    name: 'Stale MCP',
    url: 'https://stale.example.test/mcp',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    manifestTtlMs: 1000,
    tools: [],
    resources: [],
    prompts: [],
    approvedToolNames: [],
    createdAt: 1,
    updatedAt: 1,
  }])
  await importContextSnapshot({
    memories: [{
      id: 'stale-restore-memory',
      content: 'stale restore memory',
      status: 'active',
      sourceKind: 'manual',
      createdAt: 1,
      updatedAt: 1,
    }],
    documents: [{
      id: 'stale-restore-document',
      title: 'Stale Restore Knowledge',
      mimeType: 'text/plain',
      size: 10,
      chunkCount: 1,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    }],
    chunks: [{
      id: 'stale-restore-chunk',
      documentId: 'stale-restore-document',
      title: 'Stale Restore Knowledge',
      content: 'stale restore chunk',
      ordinal: 0,
      createdAt: 1,
    }],
  })
  const replaceRestoreResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(replaceRestoreResult, { ok: true, kind: 'islemind', conversations: 0 }, 'portable restore still accepts backup payloads with omitted optional sections')
  assert.equal(await loadData('SETTINGS'), null, 'portable restore clears stale settings when the backup omits settings')
  assert.deepEqual(await loadData('SKILLS'), [], 'portable restore clears stale skills when the backup omits skills')
  assert.deepEqual(await loadData('MCP_SERVERS'), [], 'portable restore clears stale MCP servers when the backup omits MCP servers')
  assert.deepEqual(await exportContextSnapshot(), { memories: [], documents: [], chunks: [] }, 'portable restore clears stale context when the backup omits context')
  const attachmentImportResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [{
      id: 'attachment-history-conversation',
      title: 'Attachment History',
      providerId: 'openai-main',
      model: 'gpt-5.2',
      messages: [{
        id: 'attachment-history-user',
        role: 'user',
        content: 'Keep the attachment label but not the stale temp path.',
        attachments: [{
          id: 'attachment-history-file',
          type: 'text',
          uri: 'file:///tmp/attachment-history.txt',
          name: 'attachment-history.txt',
          mimeType: 'text/plain',
          size: 512,
          base64: 'ZmFrZQ==',
        }],
        timestamp: 1,
        status: 'done',
      }],
      createdAt: 1,
      updatedAt: 1,
    }],
    settings: null,
    providers: [],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(attachmentImportResult, { ok: true, kind: 'islemind', conversations: 1 }, 'portable import keeps attachment-bearing conversations restorable')
  const persistedImportedConversations = await loadData('CONVERSATIONS')
  const persistedAttachmentConversation = persistedImportedConversations.find((conversation) => conversation.id === 'attachment-history-conversation')
  assert.equal(persistedAttachmentConversation?.messages[0].attachments[0].base64, undefined, 'portable conversation import strips inline attachment payloads before persistence')
  assert.equal(persistedAttachmentConversation?.messages[0].attachments[0].uri, '', 'portable conversation import removes stale local attachment URIs before persistence')
  const sqliteImportedConversations = await localDataStore.loadConversations()
  const sqliteAttachmentConversation = sqliteImportedConversations.find((conversation) => conversation.id === 'attachment-history-conversation')
  assert.equal(sqliteAttachmentConversation?.messages[0].attachments[0].uri, '', 'SQLite conversation storage does not retain stale local attachment URIs')
  const attachmentPortableJson = JSON.parse(await exportAllData())
  const exportedAttachmentConversation = attachmentPortableJson.conversations.find((conversation) => conversation.id === 'attachment-history-conversation')
  assert.equal(exportedAttachmentConversation?.messages[0].attachments[0].uri, '', 'portable export does not leak stale local attachment URIs from stored conversations')
  assert.equal(exportedAttachmentConversation?.messages[0].attachments[0].base64, undefined, 'portable export does not reintroduce stripped inline attachment payloads')
  await saveData('PROVIDERS', [{
    id: 'secure-import-provider',
    type: 'openai-compatible',
    name: 'Secure Import Provider',
    enabled: true,
    models: ['old-model'],
    credentialGroups: [
      { id: 'old-group', label: 'Old Group', apiKey: '', enabled: true },
      { id: 'explicit-empty', label: 'Explicit Empty', apiKey: '', enabled: true },
    ],
  }])
  secureStorage.set('islemind.key.secure-import-provider', 'stale-provider-key')
  secureStorage.set('islemind.key.secure-import-provider.old-group', 'stale-group-key')
  secureStorage.set('islemind.key.secure-import-provider.explicit-empty', 'stale-empty-group-key')
  const secureImportResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [{
      id: 'secure-import-provider',
      type: 'openai-compatible',
      name: 'Secure Import Provider',
      apiKey: FAKE_KEY_A,
      enabled: true,
      models: ['good-model'],
      credentialGroups: [
        { label: 'Generated Group', apiKey: FAKE_KEY_B, enabled: true, availableModels: ['good-model'] },
        { id: 'explicit-empty', label: 'Explicit Empty', enabled: true, availableModels: ['good-model'] },
      ],
    }],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(secureImportResult, { ok: true, kind: 'islemind', conversations: 0 }, 'detailed IsleMind imports accept provider credentials from JSON payloads')
  const secureImportedProviders = await loadData('PROVIDERS')
  assert.equal(secureImportedProviders[0].apiKey, '', 'provider import keeps AsyncStorage provider API keys redacted')
  assert.equal(secureImportedProviders[0].credentialGroups[0].id, 'group-1', 'provider import normalizes generated credential group ids before secure persistence')
  assert.equal(secureImportedProviders[0].credentialGroups[0].apiKey, '', 'provider import keeps AsyncStorage credential group API keys redacted')
  assert.equal(secureStorage.get('islemind.key.secure-import-provider'), FAKE_KEY_A, 'provider import persists provider API keys in SecureStore')
  assert.equal(secureStorage.get('islemind.key.secure-import-provider.group-1'), FAKE_KEY_B, 'provider import persists generated credential group keys in SecureStore')
  assert.equal(secureStorage.get('islemind.key.secure-import-provider.old-group'), undefined, 'provider import removes stale credential group keys not present in the payload')
  assert.equal(secureStorage.get('islemind.key.secure-import-provider.explicit-empty'), undefined, 'provider import removes stale credential group keys when the imported group has no key')

  const importedProviderBaseUrlResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [{
      id: 'storage-credential-url-provider',
      type: 'openai-compatible',
      name: 'Storage Credential URL Provider',
      enabled: true,
      baseUrl: 'https://user:pass@api.example.test/v1',
      models: ['model-a'],
    }],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(importedProviderBaseUrlResult, { ok: true, kind: 'islemind', conversations: 0 }, 'portable provider imports still accept valid payloads')
  const importedProviderRows = await loadData('PROVIDERS')
  assert.equal(importedProviderRows[0].baseUrl, undefined, 'portable provider import strips embedded-credential base URLs before disk write')
  const importedProviderExport = JSON.parse(await exportAllData())
  assert.equal(importedProviderExport.providers[0].baseUrl, undefined, 'portable provider export omits embedded-credential base URLs after disk normalization')

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
  assert.ok(singleLongPacked.estimatedInputTokens <= singleLongPacked.budgetTokens, 'single-message truncation stays within budget')
  assert.equal(singleLongPacked.truncatedSingleMessage, true, 'single-message truncation is reflected in trace metadata')
  assert.equal(singleLongPacked.compressionMetadata.strategy, 'single-message-truncation', 'single-message truncation is exposed as a local compression strategy')
  assert.equal(singleLongPacked.compressionMetadata.schemaVersion, 2, 'single-message truncation uses compression metadata schema v2')
  assert.equal(singleLongPacked.compressionMetadata.triggerReason, 'single_message_budget_exceeded', 'single-message truncation reports its trigger reason')
  assert.ok(singleLongPacked.messages[0].content.includes('...'), 'single-message truncation preserves both head and tail in the retained message')
  assert.equal(singleLongPacked.compressionMetadata.sourceMessageCount, 0, 'single-message truncation does not report summarized source messages')
  assert.equal(singleLongPacked.compressionMetadata.keptMessageCount, 1, 'single-message truncation reports the retained message count')
  assert.deepEqual(singleLongPacked.compressionMetadata.summarySections, [], 'single-message truncation reports no structured summary sections')
  assert.ok(singleLongPacked.compressionMetadata.sourceTokens > singleLongPacked.compressionMetadata.compressedTokens, 'single-message truncation estimates token savings')
  assert.ok(singleLongPacked.compressionMetadata.estimatedSavedTokens > 0, 'single-message truncation reports saved tokens')
  assert.ok(singleLongPacked.compressionMetadata.compressionRatio > 0 && singleLongPacked.compressionMetadata.compressionRatio < 1, 'single-message truncation reports compression ratio below 1')
  assert.equal(attachmentHasPayload({ id: 'payload-a', type: 'text', uri: 'file:///tmp/a.txt', name: 'a.txt', mimeType: 'text/plain', size: 64, base64: 'YQ==' }), true, 'attachment contract helper recognizes inline payload-bearing attachments')
  assert.equal(attachmentHasPayload({ id: 'payload-b', type: 'text', uri: 'file:///tmp/b.txt', name: 'b.txt', mimeType: 'text/plain', size: 64 }), false, 'attachment contract helper rejects metadata-only persisted attachments')
  assert.deepEqual(
    filterSendableAttachments([
      { id: 'payload-a', type: 'text', uri: 'file:///tmp/a.txt', name: 'a.txt', mimeType: 'text/plain', size: 64, base64: 'YQ==' },
      { id: 'payload-b', type: 'text', uri: 'file:///tmp/b.txt', name: 'b.txt', mimeType: 'text/plain', size: 64 },
    ]).map((attachment) => attachment.id),
    ['payload-a'],
    'attachment contract helper keeps only payload-bearing attachments for runtime delivery'
  )
  assert.deepEqual(
    sanitizeAttachmentsForPersistence([
      { id: 'persist-local', type: 'text', uri: 'file:///tmp/local.txt', name: 'local.txt', mimeType: 'text/plain', size: 64, base64: 'YQ==' },
      { id: 'persist-remote', type: 'document', uri: 'https://example.com/file.pdf', name: 'file.pdf', mimeType: 'application/pdf', size: 128, base64: 'Yg==' },
    ]),
    [
      { id: 'persist-local', type: 'text', uri: '', name: 'local.txt', mimeType: 'text/plain', size: 64, base64: undefined },
      { id: 'persist-remote', type: 'document', uri: 'https://example.com/file.pdf', name: 'file.pdf', mimeType: 'application/pdf', size: 128, base64: undefined },
    ],
    'attachment persistence helper strips inline payloads and non-web local URIs while preserving display metadata'
  )
  assert.equal(
    estimateMessageTokens([{
      role: 'user',
      content: 'metadata-only attachment should not inflate the estimate',
      attachments: [{ id: 'stale-attachment', type: 'text', uri: '', name: 'stale.txt', mimeType: 'text/plain', size: 20 * 1024 * 1024 }],
    }]),
    estimateTextTokens('metadata-only attachment should not inflate the estimate') + 4,
    'token usage ignores persisted attachment metadata without inline payloads'
  )
  assert.deepEqual(
    buildEstimatedUsage(
      [{
        role: 'user',
        content: 'payload attachment still counts',
        attachments: [{ id: 'payload-attachment', type: 'text', uri: 'file:///tmp/live.txt', name: 'live.txt', mimeType: 'text/plain', size: 1536, base64: 'YQ==' }],
      }],
      'ok'
    ),
    {
      inputTokens: estimateTextTokens('payload attachment still counts') + 4 + 1,
      outputTokens: estimateTextTokens('ok'),
      totalTokens: estimateTextTokens('payload attachment still counts') + 4 + 1 + estimateTextTokens('ok'),
      source: 'estimated',
    },
    'token usage still counts live inline attachment payloads after helper extraction'
  )
  const chatRunnerSource = fs.readFileSync(path.join(root, 'src/services/chatRunner.ts'), 'utf8')
  assert.ok(
    chatRunnerSource.includes('const sendableAttachments = filterSendableAttachments(lastUserMessage?.attachments)'),
    'chat runner derives runtime attachments from payload-bearing attachments only'
  )
  const chatWorkspaceCompressionSource = fs.readFileSync(path.join(root, 'src/components/chat/ChatWorkspace.tsx'), 'utf8')
  assert.ok(chatWorkspaceCompressionSource.includes('function CompressionBanner('), 'chat workspace renders an in-chat compression banner component')
  assert.ok(chatWorkspaceCompressionSource.includes('lastCompressionToastSignature'), 'chat workspace deduplicates compression toasts across rerenders')
  assert.ok(chatWorkspaceCompressionSource.includes("findLatestCompressionSummary(runtimeConversation?.messages ?? [])"), 'chat workspace derives banner state from conversation trace metadata')
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
  const bufferedChunks = []
  const chunkBuffer = createStreamingChunkBuffer({
    flushMs: 50,
    maxBuffer: 5,
    appendContent(text) {
      bufferedChunks.push(text)
    },
  })
  chunkBuffer.push('he')
  chunkBuffer.push('llo')
  assert.deepEqual(bufferedChunks, ['hello'], 'chat streaming buffer flushes immediately once the text threshold is reached')
  chunkBuffer.push('!')
  chunkBuffer.flush()
  assert.deepEqual(bufferedChunks, ['hello', '!'], 'chat streaming buffer flushes remaining text on demand')
  const mergedRunningTrace = mergeBufferedTrace(
    { id: 'trace-a', type: 'reasoning', title: 'Trace', status: 'running', content: 'hello ', metadata: { phase: 'one' } },
    { id: 'trace-a', type: 'reasoning', title: 'Trace', status: 'running', content: 'world', metadata: { phase: 'two' } },
    (content) => content,
  )
  assert.equal(mergedRunningTrace.content, 'hello world', 'chat streaming trace helper appends incremental running trace content')
  assert.deepEqual(mergedRunningTrace.metadata, { phase: 'two' }, 'chat streaming trace helper keeps newer metadata values')
  const bufferedTraces = []
  const traceBuffer = createStreamingTraceBuffer({
    flushMs: 50,
    maxBuffer: 2,
    upsertTrace(trace) {
      bufferedTraces.push(trace)
    },
    mergeTrace(current, next) {
      return mergeBufferedTrace(current, next, (content) => content)
    },
  })
  traceBuffer.push({ id: 'trace-a', type: 'reasoning', title: 'Trace', status: 'running', content: 'hello ' })
  traceBuffer.push({ id: 'trace-a', type: 'reasoning', title: 'Trace', status: 'running', content: 'world' })
  traceBuffer.push({ id: 'trace-b', type: 'system', title: 'Done', status: 'done', content: 'complete' })
  assert.equal(bufferedTraces.length, 2, 'chat streaming trace buffer flushes merged traces when a terminal trace arrives')
  assert.equal(bufferedTraces[0].content, 'hello world', 'chat streaming trace buffer keeps merged running content for the same trace id')
  assert.equal(bufferedTraces[1].content, 'complete', 'chat streaming trace buffer preserves terminal traces')
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
  assert.deepEqual(
    extractAnthropicReplayContentBlocks({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'thinking_delta', thinking: 'Thinking ' },
    }),
    [{ type: 'thinking', thinking: 'Thinking ' }],
    'Anthropic replay helper extracts indexed thinking deltas without leaking internal merge indexes'
  )
  assert.deepEqual(
    mergeAnthropicReplayContentBlocks([
      { type: 'thinking', thinking: 'Thinking ', __islemindAnthropicBlockIndex: 2 },
      { type: 'thinking', signature: 'signature-2', __islemindAnthropicBlockIndex: 2 },
      { type: 'redacted_thinking', data: 'encrypted-redacted-thinking', cache_control: { type: 'ephemeral' } },
    ]),
    [
      { type: 'thinking', thinking: 'Thinking ', signature: 'signature-2', __islemindAnthropicBlockIndex: 2 },
      { type: 'redacted_thinking', data: 'encrypted-redacted-thinking' },
    ],
    'Anthropic replay helper merges indexed thinking blocks and strips cache_control'
  )
  assert.deepEqual(
    sanitizeAnthropicReplayContentBlocks([
      { type: 'thinking', thinking: 'Thinking ', __islemindAnthropicBlockIndex: 2 },
      { type: 'tool_use', id: 'toolu_ignored', name: 'ignored', input: {} },
    ]),
    [{ type: 'thinking', thinking: 'Thinking ' }],
    'Anthropic replay helper sanitizes replay blocks before assistant message reuse'
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
  assert.deepEqual(
    splitSseBuffer('data: one\r\n\r\ndata: two\r\n\r\ndata: partial'),
    { events: ['data: one', 'data: two'], remainder: 'data: partial' },
    'provider stream utility normalizes CRLF SSE chunks and preserves partial remainder'
  )
  assert.deepEqual(
    dedupeTraces([
      { id: 'trace-a', type: 'reasoning', title: 'Trace', content: 'A', status: 'running', timestamp: 1 },
      { id: 'trace-a', type: 'reasoning', title: 'Trace', content: 'A again', status: 'running', timestamp: 2 },
      { type: 'tool', title: 'Tool', content: 'B', status: 'done', timestamp: 3 },
      { type: 'tool', title: 'Tool', content: 'B', status: 'done', timestamp: 4 },
    ]).map((trace) => trace.timestamp),
    [1, 3],
    'provider stream utility dedupes traces by id or fallback trace shape'
  )
  assert.equal(asRecord({ ok: true }).ok, true, 'provider JSON utility accepts plain records')
  assert.equal(asRecord(['not-record']), undefined, 'provider JSON utility rejects arrays as records')
  assert.equal(stringValue(123), '', 'provider JSON utility keeps string extraction strict')
  assert.equal(
    stringifyReasoningDetails(['plain', { reasoning_text: 'detail' }, { summary: 'summary' }, { text: 42 }]),
    'plain\ndetail\nsummary',
    'provider JSON utility preserves reasoning detail string fields'
  )
  assert.deepEqual(
    parseProviderJson('{"data":[{"id":"model-a"}]}', new Response('', { status: 200, headers: { 'content-type': 'application/json' } }), { id: 'json-provider', type: 'openai-compatible', name: 'JSON Provider', apiKey: FAKE_KEY_A, models: [], enabled: true }, 'model list'),
    { data: [{ id: 'model-a' }] },
    'provider JSON utility parses provider JSON responses'
  )
  try {
    parseProviderJson('<html></html>', new Response('', { status: 200, headers: { 'content-type': 'text/html' } }), { id: 'html-provider', type: 'openai-compatible', name: 'HTML Provider', apiKey: FAKE_KEY_A, models: [], enabled: true }, 'model list')
    assert.fail('provider JSON utility should reject HTML responses')
  } catch (error) {
    assert.equal(error instanceof ProviderHttpError, true, 'provider JSON utility rejects HTML as provider HTTP errors')
  }
  const circularPreview = {}
  circularPreview.self = circularPreview
  assert.equal(safeJsonPreview(circularPreview), '', 'provider JSON utility handles circular preview input')
  assert.equal(safeJsonPreview({ text: 'x'.repeat(400) }).endsWith('...'), true, 'provider JSON utility truncates long previews')
  assert.equal(endpointHost('https://api.example/v1/responses?x=1'), 'api.example', 'provider endpoint utility extracts endpoint hosts')
  assert.equal(endpointHost('not a url'), undefined, 'provider endpoint utility ignores invalid endpoint URLs')
  assert.equal(toWebSocketUrl('http://api.example/v1/responses'), 'ws://api.example/v1/responses', 'provider endpoint utility maps http to ws')
  assert.equal(toWebSocketUrl('https://api.example/v1/responses'), 'wss://api.example/v1/responses', 'provider endpoint utility maps https to wss')
  assert.equal(
    resolveNonStreamingProviderEndpoint({ provider: { id: 'openai-endpoint', type: 'openai', name: 'OpenAI Endpoint', apiKey: FAKE_KEY_A, models: [], enabled: true }, model: 'gpt-5.5' }),
    'https://api.openai.com/v1/responses',
    'provider endpoint utility preserves OpenAI Responses non-streaming endpoint selection'
  )
  assert.equal(
    resolveNonStreamingProviderEndpoint({ provider: { id: 'compatible-endpoint', type: 'openai-compatible', name: 'Compatible Endpoint', apiKey: FAKE_KEY_A, models: [], enabled: true, baseUrl: 'https://compatible.example/v1' }, model: 'chat-model' }),
    'https://compatible.example/v1/chat/completions',
    'provider endpoint utility preserves compatible non-streaming chat endpoint selection'
  )
  assert.equal(fallbackModel('anthropic'), 'claude-haiku-4-5-20251001', 'provider default model helper preserves Anthropic fallback')
  assert.equal(fallbackModel('xiaomi-mimo'), 'mimo-v2.5-pro', 'provider default model helper preserves Xiaomi Mimo fallback')
  assert.equal(
    pickEmbeddingModel({ id: 'embed-custom', type: 'openai-compatible', name: 'Embedding Custom', apiKey: FAKE_KEY_A, models: ['chat-model', 'custom-embedding-v1'], enabled: true }),
    'custom-embedding-v1',
    'provider default model helper prefers configured embedding-like models'
  )
  assert.equal(
    pickEmbeddingModel({ id: 'mimo-embed', type: 'xiaomi-mimo', name: 'Mimo Embed', apiKey: FAKE_KEY_A, models: ['mimo-v2.5-pro'], enabled: true }),
    'text-embedding',
    'provider default model helper preserves Xiaomi Mimo embedding fallback'
  )
  assert.equal(arrayBufferToBase64(new Uint8Array([]).buffer), '', 'provider binary utility encodes empty buffers')
  assert.equal(arrayBufferToBase64(new Uint8Array([77, 97]).buffer), 'TWE=', 'provider binary utility preserves base64 padding')
  assert.equal(arrayBufferToBase64(new Uint8Array([77, 97, 110]).buffer), 'TWFu', 'provider binary utility encodes full triples')
  assert.equal(clamp01(-0.5), 0, 'provider number utility clamps lower fraction bounds')
  assert.equal(clamp01(1.5), 1, 'provider number utility clamps upper fraction bounds')
  assert.equal(clampInteger(4.8, 1, 0, 5), 4, 'provider number utility truncates finite integer settings')
  assert.equal(clampInteger(Number.NaN, 3, 1, 20), 3, 'provider number utility uses fallback for non-finite settings')
  assert.equal(clampInteger(500, 1, 0, 5), 5, 'provider number utility clamps integer upper bounds')
  assert.equal(
    toTextContent([{ type: 'text', text: 'A' }, { type: 'function_call', text: '', functionCall: { name: 'tool' } }, { type: 'text', text: 'B' }]),
    'A\nB',
    'provider content part helper joins text-only content for OpenAI-compatible chat'
  )
  assert.deepEqual(
    toAnthropicContentBlocks([
      { type: 'tool_use', text: '', toolUse: { id: 'toolu_1', name: 'read_context', input: { query: 'IsleMind' } } },
      { type: 'tool_result', text: '', toolResult: { tool_use_id: 'toolu_1', content: 'Context' } },
    ]),
    [
      { type: 'tool_use', id: 'toolu_1', name: 'read_context', input: { query: 'IsleMind' } },
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'Context' },
    ],
    'provider content part helper maps Anthropic tool use and result blocks'
  )
  assert.deepEqual(
    toGoogleContentParts([{ type: 'function_call', text: '', functionCall: { name: 'read_context', args: { query: 'IsleMind' } }, thoughtSignature: 'sig-1' }]),
    [{ functionCall: { name: 'read_context', args: { query: 'IsleMind' } }, thoughtSignature: 'sig-1' }],
    'provider content part helper preserves Gemini functionCall thought signatures'
  )
  assert.equal(
    extractOpenAIText({ output_text: 'A', choices: [{ message: { content: 'B' } }], output: [{ content: [{ text: 'C' }] }] }),
    'ABC',
    'provider response text helper combines OpenAI response text sources'
  )
  assert.equal(extractResponseId({ response: { id: 'resp-a' }, id: 'root-b' }), 'resp-a', 'provider response text helper prefers nested response id')
  assert.equal(
    extractAnthropicText({ content: [{ type: 'thinking', text: 'hidden' }, { type: 'text', text: 'visible' }, { text: 'fallback-visible' }] }),
    'hiddenvisiblefallback-visible',
    'provider response text helper preserves existing Anthropic text extraction shape'
  )
  assert.equal(
    extractGoogleText({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { functionCall: { name: 'tool' }, text: 'tool-hidden' }, { text: 'visible' }] } }] }),
    'visible',
    'provider response text helper excludes Google thought and functionCall parts'
  )
  assert.equal(
    stringifyOpenAIReasoningItem({ summary: ['plain', { text: 'detail' }] }),
    'plain\ndetail',
    'provider response text helper stringifies OpenAI reasoning summaries'
  )
  assert.deepEqual(
    await readProviderResponseBody(new Response(' {"answer":"ok"} ')),
    { text: ' {"answer":"ok"} ', json: { answer: 'ok' } },
    'provider response parsing helper parses JSON-looking response bodies'
  )
  assert.deepEqual(
    await readProviderResponseBody(new Response('plain answer')),
    { text: 'plain answer', json: null },
    'provider response parsing helper preserves non-JSON response text'
  )
  assert.equal(
    await parseProviderNonStreamingText(new Response(JSON.stringify({ output_text: 'from-output', choices: [{ message: { content: 'from-choice' } }] })), 'openai'),
    'from-output',
    'provider response parsing helper preserves OpenAI output_text precedence'
  )
  assert.equal(
    await parseProviderNonStreamingText(new Response(JSON.stringify({ content: [{ type: 'text', text: 'anthropic text' }] })), 'anthropic'),
    'anthropic text',
    'provider response parsing helper delegates Anthropic text extraction'
  )
  assert.equal(
    await parseProviderNonStreamingText(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'google text' }] } }] })), 'google'),
    'google text',
    'provider response parsing helper delegates Google text extraction'
  )
  const nonStreamingTextResult = await parseProviderNonStreamingResponse(new Response('plain response'), {
    provider: { id: 'plain-provider', type: 'openai', name: 'Plain Provider', apiKey: FAKE_KEY_A, models: [], enabled: true },
    model: 'gpt-5.5',
    messages: [],
    retrievalSources: [{ id: 'plain-source', title: 'Plain Source', excerpt: 'Plain evidence', similarity: 0.8 }],
  })
  assert.equal(nonStreamingTextResult.text, 'plain response', 'provider response parsing helper preserves plain non-streaming text')
  assert.equal(nonStreamingTextResult.citations?.[0]?.id, 'plain-source', 'provider response parsing helper keeps plain-text retrieval citations')
  const bufferedSseResult = parseProviderBufferedStreamResponse('data: {"type":"response.output_text.delta","delta":"Buffered answer"}', {
    provider: { id: 'buffered-provider', type: 'openai', name: 'Buffered Provider', apiKey: FAKE_KEY_A, models: [], enabled: true },
    model: 'gpt-5.5',
    messages: [],
    retrievalSources: [{ id: 'buffered-source', title: 'Buffered Source', excerpt: 'Buffered evidence', similarity: 0.7 }],
  }, 'openai')
  assert.equal(bufferedSseResult.text, 'Buffered answer', 'provider response parsing helper parses buffered SSE text')
  assert.equal(bufferedSseResult.citations?.[0]?.id, 'buffered-source', 'provider response parsing helper keeps buffered SSE retrieval citations')
  const openAIParsedCompletion = parseProviderChatCompletionJson({
    id: 'resp_parse_1',
    output_text: 'OpenAI answer',
    output: [
      { id: 'rs_parse_1', type: 'reasoning', summary: [{ text: 'reasoning' }] },
      { id: 'fc_parse_1', type: 'function_call', name: 'search_web', arguments: '{"query":"IsleMind"}' },
    ],
    usage: { input_tokens: 3, output_tokens: 5 },
  }, {
    provider: { id: 'openai-parse', type: 'openai', name: 'OpenAI Parse', apiKey: FAKE_KEY_A, models: [], enabled: true },
    model: 'gpt-5.5',
    messages: [],
    retrievalSources: [{ id: 'source-parse', title: 'Source Parse', excerpt: 'Evidence', similarity: 0.9 }],
  })
  assert.equal(openAIParsedCompletion.text, 'OpenAI answer', 'provider response parsing helper preserves OpenAI completion text')
  assert.equal(openAIParsedCompletion.traces?.length, 2, 'provider response parsing helper preserves OpenAI JSON traces')
  assert.equal(openAIParsedCompletion.providerToolCalls?.[0]?.name, 'search_web', 'provider response parsing helper extracts OpenAI tool calls')
  assert.equal(openAIParsedCompletion.responseId, 'resp_parse_1', 'provider response parsing helper extracts response ids')
  assert.equal(openAIParsedCompletion.citations?.[0]?.id, 'source-parse', 'provider response parsing helper keeps retrieval citations')
  const anthropicParsedCompletion = parseProviderChatCompletionJson({
    content: [
      { type: 'thinking', thinking: 'anthropic reasoning' },
      { type: 'tool_use', id: 'tool_parse_1', name: 'read_context', input: { query: 'IsleMind' } },
      { type: 'text', text: 'Anthropic answer' },
    ],
    usage: { input_tokens: 7, output_tokens: 11 },
  }, {
    provider: { id: 'anthropic-parse', type: 'anthropic', name: 'Anthropic Parse', apiKey: FAKE_KEY_A, models: [], enabled: true },
    model: 'claude-sonnet-4-20250514',
    messages: [],
  })
  assert.equal(anthropicParsedCompletion.text, 'Anthropic answer', 'provider response parsing helper preserves Anthropic completion text')
  assert.equal(anthropicParsedCompletion.providerToolCalls?.[0]?.name, 'read_context', 'provider response parsing helper extracts Anthropic tool calls')
  assert.equal(anthropicParsedCompletion.providerContentBlocks?.[0]?.type, 'thinking', 'provider response parsing helper keeps Anthropic replay thinking blocks')
  const bufferedJsonCompletion = parseProviderBufferedStreamJson(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'Google answer' }] } }],
    usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 4 },
  }), {
    provider: { id: 'google-parse', type: 'google', name: 'Google Parse', apiKey: FAKE_KEY_A, models: [], enabled: true },
    model: 'gemini-3-flash-preview',
    messages: [],
  })
  assert.equal(bufferedJsonCompletion?.text, 'Google answer', 'provider response parsing helper parses buffered JSON stream fallbacks')
  assert.equal(
    extractOpenAIReasoningContent({ choices: [{ message: { reasoning_content: 'message-' }, delta: { reasoning_content: 'delta-' } }], reasoning_content: 'root' }),
    'message-delta-root',
    'OpenAI replay helper preserves reasoning content source order'
  )
  assert.deepEqual(
    extractOpenAIResponseReplayItems({
      output: [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted-reasoning', summary: [] }],
      response: { output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_web', arguments: '{"query":"IsleMind"}' }] },
    }),
    [
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted-reasoning', summary: [] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'search_web', arguments: '{"query":"IsleMind"}' },
    ],
    'OpenAI replay helper extracts reasoning and function_call replay items'
  )
  assert.deepEqual(
    mergeOpenAIResponseReplayItems([
      { type: 'function_call', id: 'fc_merge', call_id: 'call_merge', arguments: '{"query":' },
      { type: 'function_call', id: 'fc_merge', name: 'search_web', arguments: '{"query":"IsleMind"}' },
    ]),
    [{ type: 'function_call', id: 'fc_merge', call_id: 'call_merge', arguments: '{"query":"IsleMind"}', name: 'search_web' }],
    'OpenAI replay helper merges replay items by stable id'
  )
  assert.equal(isReasoningEventType('response.reasoning.delta'), true, 'provider trace utility detects reasoning events')
  assert.equal(isToolEventType('response.function_call_arguments.delta'), true, 'provider trace utility detects function call events')
  assert.equal(isDoneEvent('response.output_item.done'), true, 'provider trace utility detects done events')
  assert.equal(stableTraceId({ id: 'trace-id', type: 'event-type' }, 'tool'), 'tool-trace-id-event-type', 'provider trace utility builds stable trace ids')
  const providerTraceToolSummary = summarizeToolEvent({ function: { name: 'search' }, arguments: { query: 'islemind' } })
  assert.ok(
    providerTraceToolSummary.includes('search') && providerTraceToolSummary.includes('"query":"islemind"'),
    'provider trace utility summarizes tool names and arguments'
  )
  const providerTraceUtilityToolTrace = createProviderTrace(
    'tool',
    'openai',
    'Tool call: search_web',
    `${'x'.repeat(780)} token-test-fake`,
    'done',
    'trace-tool-test',
    { custom: true }
  )
  assert.equal(providerTraceUtilityToolTrace.id, 'trace-tool-test', 'provider trace utility preserves explicit trace ids')
  assert.equal(providerTraceUtilityToolTrace.completedAt, providerTraceUtilityToolTrace.startedAt, 'provider trace utility closes done traces immediately')
  assert.equal(providerTraceUtilityToolTrace.metadata.providerType, 'openai', 'provider trace utility records provider type')
  assert.equal(providerTraceUtilityToolTrace.metadata.source, 'provider', 'provider trace utility records provider source')
  assert.equal(providerTraceUtilityToolTrace.metadata.custom, true, 'provider trace utility preserves caller metadata')
  assert.ok(
    typeof providerTraceUtilityToolTrace.content === 'string' && providerTraceUtilityToolTrace.content.endsWith('...') && providerTraceUtilityToolTrace.content.length <= 763,
    'provider trace utility redacts and truncates long trace content'
  )
  const openAIJsonTraces = extractTracesFromJson({
    id: 'resp_trace_1',
    output: [
      { id: 'rs_1', type: 'reasoning', summary: [{ text: 'reasoned' }] },
      { id: 'fc_1', type: 'function_call', name: 'search_web', arguments: '{"query":"IsleMind"}' },
    ],
  }, 'openai')
  assert.equal(openAIJsonTraces.length, 2, 'provider trace utility extracts OpenAI JSON reasoning and tool traces')
  assert.equal(openAIJsonTraces[0].type, 'reasoning', 'provider trace utility keeps OpenAI reasoning trace type')
  assert.equal(openAIJsonTraces[1].type, 'tool', 'provider trace utility keeps OpenAI tool trace type')
  const anthropicJsonTraces = extractTracesFromJson({
    content: [
      { type: 'thinking', thinking: 'anthropic thought' },
      { type: 'tool_use', id: 'tool_1', name: 'read_context', input: { scope: 'note' } },
    ],
  }, 'anthropic')
  assert.deepEqual(
    anthropicJsonTraces.map((trace) => trace.type),
    ['reasoning', 'tool'],
    'provider trace utility extracts Anthropic JSON reasoning and tool traces'
  )
  const googleJsonTraces = extractTracesFromJson({
    candidates: [{ content: { parts: [
      { thought: true, text: 'google thought' },
      { functionCall: { name: 'search', args: { query: 'IsleMind' } } },
      { thoughtSignature: 'hidden-signature' },
    ] } }],
  }, 'google')
  assert.deepEqual(
    googleJsonTraces.map((trace) => trace.type),
    ['reasoning', 'tool', 'reasoning'],
    'provider trace utility extracts Google JSON reasoning, tool, and hidden signature traces'
  )
  assert.equal(googleJsonTraces[2].metadata.hiddenSignature, true, 'provider trace utility marks Google hidden signature traces')
  const extractedOpenAIToolCalls = extractProviderToolCalls({
    output: [{ id: 'fc_1', call_id: 'call_1', type: 'function_call', name: 'search_web', arguments: '{"query":"IsleMind"}' }],
  }, 'openai')
  assert.deepEqual(
    extractedOpenAIToolCalls?.[0],
    { id: 'fc_1', callId: 'call_1', name: 'search_web', arguments: { query: 'IsleMind' }, rawArguments: '{"query":"IsleMind"}', argumentsComplete: true },
    'provider tool call helper extracts OpenAI Responses function calls'
  )
  assert.deepEqual(
    extractProviderToolCalls({ content: [{ type: 'tool_use', id: 'tool_1', name: 'read_context', input: { scope: 'note' } }] }, 'anthropic')?.[0],
    { id: 'tool_1', name: 'read_context', arguments: { scope: 'note' }, rawArguments: { scope: 'note' }, argumentsComplete: true },
    'provider tool call helper extracts Anthropic tool_use blocks'
  )
  const mergedProviderToolCalls = mergeProviderToolCallParts([
    { id: 'fc_stream', callId: 'call_stream', index: 0, name: 'search_web', arguments: {}, rawArguments: '{"query":', argumentsComplete: false },
    { id: 'fc_stream', index: 0, name: '', arguments: {}, rawArguments: '"IsleMind"}', argumentsComplete: false },
  ])
  assert.deepEqual(
    mergedProviderToolCalls[0],
    { id: 'fc_stream', callId: 'call_stream', index: 0, name: 'search_web', arguments: { query: 'IsleMind' }, rawArguments: '{"query":"IsleMind"}', argumentsComplete: true },
    'provider tool call helper merges streamed argument fragments'
  )
  assert.deepEqual(
    executableProviderToolCalls([
      { name: 'partial', arguments: {}, rawArguments: '{"q":', argumentsComplete: false },
      { id: 'ready', name: 'read_context', arguments: { scope: 'note' }, argumentsComplete: true },
    ]),
    [{ id: 'ready', name: 'read_context', arguments: { scope: 'note' }, argumentsComplete: true }],
    'provider tool call helper filters incomplete tool calls before execution'
  )
  const clonedToolDeclarations = cloneProviderToolDeclarations([{ type: 'function', function: { name: 'read_context' } }, null, 'bad'])
  assert.deepEqual(
    clonedToolDeclarations,
    [{ type: 'function', function: { name: 'read_context' } }],
    'provider tool declaration helper clones only record-shaped declarations'
  )
  assert.notStrictEqual(clonedToolDeclarations[0], cloneProviderToolDeclarations([{ type: 'function' }])[0], 'provider tool declaration helper returns cloned records')
  assert.deepEqual(
    mergeProviderToolDeclarations([{ name: 'read_context' }], [{ type: 'web_search_preview' }]),
    [{ type: 'web_search_preview' }, { name: 'read_context' }],
    'provider tool declaration helper preserves built-in-before-provider ordering'
  )
  assert.deepEqual(
    toOpenAIChatToolCall({ id: 'chat_tool_1', name: 'read_context', arguments: { query: 'IsleMind' }, rawArguments: '{"query":"raw"}', argumentsComplete: true }, 0),
    { id: 'chat_tool_1', type: 'function', function: { name: 'read_context', arguments: '{"query":"raw"}' } },
    'provider tool replay helper preserves raw OpenAI Chat tool arguments'
  )
  const circularToolArgs = {}
  circularToolArgs.self = circularToolArgs
  assert.equal(stringifyProviderToolArguments(circularToolArgs), '{}', 'provider tool replay helper falls back for circular JSON arguments')
  const clonedResponsesItems = cloneOpenAIResponsesInputItems([{ type: 'reasoning', id: 'rs_clone' }])
  assert.deepEqual(clonedResponsesItems, [{ type: 'reasoning', id: 'rs_clone' }], 'provider tool replay helper clones Responses replay items')
  assert.notStrictEqual(clonedResponsesItems[0], cloneOpenAIResponsesInputItems([{ type: 'reasoning', id: 'rs_clone' }])[0], 'provider tool replay helper returns new item objects')
  assert.equal(
    hasOpenAIResponsesFunctionCallItem([{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_context' }], { id: 'fc_1', name: 'read_context', arguments: {}, argumentsComplete: true }),
    true,
    'provider tool replay helper detects existing Responses function_call items by id'
  )
  assert.deepEqual(
    toOpenAIResponsesFunctionCallInput({ name: 'inspect_source', arguments: { sourceId: 'src-1' }, argumentsComplete: true }, 2),
    { type: 'function_call', call_id: 'islemind-tool-2', name: 'inspect_source', arguments: '{"sourceId":"src-1"}' },
    'provider tool replay helper builds fallback Responses function_call input'
  )
  assert.deepEqual(
    extractUsage({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, thoughtsTokenCount: 5 } }, 'google'),
    { inputTokens: 3, outputTokens: 4, totalTokens: 12, reasoningTokens: 5, source: 'provider' },
    'provider usage helper computes Google totals with reasoning tokens'
  )
  assert.deepEqual(
    extractUsage({ usage: { input_tokens: 11, output_tokens: 13 } }, 'anthropic'),
    { inputTokens: 11, outputTokens: 13, totalTokens: 24, source: 'provider' },
    'provider usage helper computes Anthropic totals'
  )
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 17, completion_tokens: 19, completion_tokens_details: { reasoning_tokens: 7 } } }, 'openai-compatible'),
    { inputTokens: 17, outputTokens: 19, totalTokens: 36, reasoningTokens: 7, source: 'provider' },
    'provider usage helper computes OpenAI-compatible totals and reasoning tokens'
  )
  assert.equal(numberValue('3'), undefined, 'provider usage helper keeps numeric parsing limited to provider numeric fields')
  const providerCitationSources = extractCitationsFromText('answer', [{
    id: 'source-1',
    type: 'knowledge',
    title: 'Source One',
    content: 'Citation source content.',
    excerpt: '',
    score: 0.7,
    sourceUri: 'file://source-one.md',
    retrievalMode: 'hybrid',
  }])
  assert.deepEqual(
    providerCitationSources[0],
    { id: 'source-1', type: 'knowledge', title: 'Source One', excerpt: 'Citation source content.', url: undefined, documentId: undefined, chunkId: undefined, score: 0.7, ftsScore: undefined, vectorScore: undefined, chunkIndex: undefined, similarityScore: undefined, sourceUri: 'file://source-one.md', retrievalMode: 'hybrid' },
    'provider citation helper preserves retrieval source metadata'
  )
  assert.deepEqual(
    extractProviderCitations({
      content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'Example A', page_age: '2026-06-17' }],
    }, 'anthropic'),
    [{ id: 'https://example.com/a', type: 'web', title: 'Example A', url: 'https://example.com/a', excerpt: '2026-06-17' }],
    'provider citation helper extracts Anthropic web search citations'
  )
  assert.deepEqual(
    extractProviderCitations({
      candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/g', title: 'Example G' } }] } }],
    }, 'google'),
    [{ id: 'https://example.com/g', type: 'web', title: 'Example G', url: 'https://example.com/g' }],
    'provider citation helper extracts Google grounding citations'
  )
  assert.deepEqual(
    extractProviderCitationsFromSse([
      `data: ${JSON.stringify({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/g', title: 'Example G' } }] } }] })}`,
      `data: ${JSON.stringify({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/g', title: 'Duplicate G' } }] } }] })}`,
      'data: [DONE]',
      '',
    ].join('\n'), 'google'),
    [{ id: 'https://example.com/g', type: 'web', title: 'Example G', url: 'https://example.com/g' }],
    'provider citation helper dedupes SSE provider citations'
  )
  assert.deepEqual(
    dedupeCitations([{ id: 'a', type: 'web', title: 'A', url: 'https://example.com/a' }, { id: 'b', type: 'web', title: 'B', url: 'https://example.com/a' }]),
    [{ id: 'a', type: 'web', title: 'A', url: 'https://example.com/a' }],
    'provider citation helper dedupes citations by provider-visible URL'
  )
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
  assert.equal(
    parseProviderStreamChunk('data: {"type":"response.output_text.delta","delta":"Direct helper"}', 'openai').text,
    'Direct helper',
    'provider stream parsing helper parses OpenAI Responses SSE deltas directly'
  )
  assert.equal(
    parseProviderStreamEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Anthropic direct' } }, 'anthropic').text,
    'Anthropic direct',
    'provider stream parsing helper parses Anthropic stream events directly'
  )
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
  assert.deepEqual(dedupeModelIds([' model-a ', 'model-a', '', 'model-b']), [' model-a ', 'model-b'], 'provider model discovery preserves existing model labels while removing duplicates and blanks')
  assert.equal(normalizeRemoteModelId('xiaomi/mimo-v2.5-pro', 'xiaomi-mimo'), 'mimo-v2.5-pro', 'provider model discovery normalizes Xiaomi namespace prefixes')
  const openAICompatibleModels = mapOpenAICompatibleModels({
    data: [
      { id: 'xiaomi/mimo-v2.5-pro', display_name: 'Mimo Pro', metadata: { context_length: '1000000', output_token_limit: '128000' } },
      { id: 'xiaomi/mimo-v2.5-pro', display_name: 'Duplicate' },
      { id: 'mimo-tts-preview' },
    ],
  }, 'xiaomi-mimo')
  const mimoDiscoveryModel = openAICompatibleModels.find((model) => model.id === 'mimo-v2.5-pro')
  assert.equal(mimoDiscoveryModel?.name, 'Mimo Pro', 'provider model discovery keeps first remote model metadata after id normalization')
  assert.equal(mimoDiscoveryModel?.contextWindow, 1000000, 'provider model discovery parses numeric context metadata strings')
  assert.equal(mimoDiscoveryModel?.maxOutputTokens, 128000, 'provider model discovery parses numeric output metadata strings')
  assert.equal(mimoDiscoveryModel?.supportsVision, true, 'provider model discovery preserves Mimo multimodal vision inference')
  assert.equal(openAICompatibleModels.find((model) => model.id === 'mimo-tts-preview')?.supportsVision, false, 'provider model discovery does not mark TTS models as vision capable')
  const googleDiscoveryModels = mapGoogleModels({
    models: [
      { name: 'models/gemini-test', displayName: 'Gemini Test', inputTokenLimit: 200000, outputTokenLimit: 16000, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embed-test', displayName: 'Embed Test', supportedGenerationMethods: ['embedContent'] },
    ],
  })
  assert.deepEqual(googleDiscoveryModels.map((model) => model.id), ['gemini-test'], 'provider model discovery keeps only Google generateContent models')
  assert.equal(googleDiscoveryModels[0].supportsFiles, true, 'provider model discovery preserves Google file support')
  const originalModelDiscoveryFetch = global.fetch
  const modelDiscoveryCalls = []
  global.fetch = async (url, init) => {
    modelDiscoveryCalls.push({ url: String(url), headers: init?.headers })
    return new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-remote', displayName: 'Gemini Remote', inputTokenLimit: 300000, outputTokenLimit: 32000, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-remote', displayName: 'Embedding Remote', supportedGenerationMethods: ['embedContent'] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const remoteGoogleModels = await fetchProviderModelConfigsFromRemote({
      id: 'google-remote',
      type: 'google',
      name: 'Google Remote',
      [API_KEY_FIELD]: 'google-key-test',
      models: [],
      enabled: true,
    }, 1000)
    assert.deepEqual(remoteGoogleModels.map((model) => model.id), ['gemini-remote'], 'provider model discovery remote helper filters Google non-chat models')
    assert.equal(remoteGoogleModels[0].contextWindow, 300000, 'provider model discovery remote helper preserves Google input limits')
    assert.equal(modelDiscoveryCalls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?key=google-key-test', 'provider model discovery remote helper sends Google API keys in the query string')
    assert.equal(modelDiscoveryCalls[0].headers, undefined, 'provider model discovery remote helper keeps Google model discovery headers empty')
  } finally {
    global.fetch = originalModelDiscoveryFetch
  }
  await assert.rejects(
    () => fetchProviderModelConfigsFromRemote({
      id: 'invalid-discovery',
      type: 'openai-compatible',
      name: 'Invalid Discovery',
      [API_KEY_FIELD]: 'token-test-fake',
      baseUrl: 'file:///tmp/provider',
      models: [],
      enabled: true,
    }, 1000),
    /invalidBaseUrl/,
    'provider model discovery rejects invalid custom base URLs before fetch'
  )
  const invalidBaseUrlProvider = {
    id: 'invalid-base-url-provider',
    type: 'openai-compatible',
    name: 'Invalid Base URL Provider',
    [API_KEY_FIELD]: 'token-test-fake',
    baseUrl: 'file:///tmp/provider',
    models: ['gpt-4o-mini'],
    enabled: true,
  }
  const invalidModelTest = await testProviderModelDetailed(invalidBaseUrlProvider, 'gpt-4o-mini', 'token-test-fake')
  assert.equal(invalidModelTest.ok, false, 'provider model test rejects invalid custom base URLs before request execution')
  assert.equal(invalidModelTest.code, 'bad_base_url', 'provider model test reports invalid custom base URLs as bad_base_url')
  const invalidModelSync = await fetchProviderModelConfigsDetailed(invalidBaseUrlProvider, 'token-test-fake')
  assert.equal(invalidModelSync.ok, false, 'provider model sync rejects invalid custom base URLs before discovery fetch')
  assert.equal(invalidModelSync.code, 'bad_base_url', 'provider model sync reports invalid custom base URLs as bad_base_url')
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
  const downloadableLocalModelView = {
    model: { id: 'downloadable-local', name: 'Downloadable Local', files: [{ path: 'model.onnx', bytes: 12 }], sizeBytes: 12 },
    source: 'none',
    status: 'available',
    active: false,
  }
  const plannedLocalModelView = {
    model: { id: 'planned-local', name: 'Planned Local', files: [], sizeBytes: 0 },
    source: 'none',
    status: 'planned',
    active: false,
  }
  assert.equal(isDownloadableLocalModel(downloadableLocalModelView), true, 'context local model rules classify downloadable model views')
  assert.equal(isDownloadableLocalModel(plannedLocalModelView), false, 'context local model rules keep capability placeholders out of downloads')
  assert.deepEqual(
    splitLocalModelViews([downloadableLocalModelView, plannedLocalModelView]),
    { downloadable: [downloadableLocalModelView], planned: [plannedLocalModelView] },
    'context local model rules split downloadable models from planned capabilities'
  )
  assert.equal(localCapabilityEnabled('embedding', { embeddingMode: 'provider' }), false, 'context local model rules disable local embedding capability in provider-only mode')
  assert.equal(localCapabilityEnabled('reranker', { ragCrossEncoderEnabled: false }), false, 'context local model rules honor disabled reranker settings')
  assert.equal(localCapabilityEnabled('colbert', {}), true, 'context local model rules default optional local capabilities on')
  assert.ok(localModelCacheKey({ localEmbeddingModelId: 'all-MiniLM-L6-v2', localEmbeddingModelSource: 'downloaded' }).includes('downloaded'))
  const textEncoder = new TextEncoder()
  await assertApkUpdateBehavior()

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/provider-import.txt', Buffer.from('Provider: Example\nBase URL: https://api.example/v1\nKey: token-fake'))
  const providerImportText = await readUtf8ImportFile('file:///tmp/provider-import.txt', {
    size: Buffer.byteLength('Provider: Example\nBase URL: https://api.example/v1\nKey: token-fake'),
    limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
  })
  assert.ok(providerImportText.includes('https://api.example/v1'), 'bounded import reader preserves ordinary provider import text')
  assert.equal(localFileReadRequests.some((request) => request.uri === 'file:///tmp/provider-import.txt'), true, 'bounded import reader reads accepted text imports')
  localFileReadRequests.length = 0

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/import-copy.json', Buffer.from('{"ok":true}', 'utf8'))
  await deleteTemporaryImportCopy('file:///tmp/import-copy.json', { assumeTemporaryCopy: true })
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/import-copy.json'),
    'temporary import helper deletes cache-directory import copies'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///docs/import-copy.json', Buffer.from('{"ok":true}', 'utf8'))
  await deleteTemporaryImportCopy('file:///docs/import-copy.json')
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///docs/import-copy.json'),
    false,
    'temporary import helper does not delete non-cache document files'
  )
  await assert.rejects(
    () => readUtf8ImportFile('file:///tmp/provider-import.txt', {
      size: MAX_IMPORT_TEXT_FILE_BYTES + 1,
      limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
    }),
    /error\.fileTooLarge/,
    'bounded import reader rejects oversized text files before loading them into memory'
  )
  assert.equal(localFileReadRequests.length, 0, 'oversized provider and skill import files are rejected before readAsStringAsync')
  localFileFixtures.set('file:///tmp/unknown-size-provider-import.txt', Buffer.alloc(MAX_IMPORT_TEXT_FILE_BYTES + 2))
  await assert.rejects(
    () => readUtf8ImportFile('file:///tmp/unknown-size-provider-import.txt', {
      limitBytes: MAX_IMPORT_TEXT_FILE_BYTES,
    }),
    /error\.fileTooLarge/,
    'bounded import reader checks FileSystem metadata when DocumentPicker size is missing'
  )
  assert.equal(localFileReadRequests.length, 0, 'metadata-sized oversized imports are rejected before readAsStringAsync')

  resetLocalModelFileMocks()
  sharingAvailable = true
  const exportedPortableUri = await exportToJsonFile()
  assert.match(exportedPortableUri, /^file:\/\/\/cache\/islemind-export-/, 'portable export uses a cache-backed share file when sharing is available')
  assert.equal(sharedFiles.length, 1, 'portable export invokes the native share sheet when sharing is available')
  assert.equal(sharedFiles[0].uri, exportedPortableUri, 'portable export shares the generated JSON file')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === exportedPortableUri),
    'portable export deletes the temporary shared JSON file after the share flow completes'
  )
  assert.equal(localFileFixtures.has(exportedPortableUri), false, 'portable export leaves no shared backup JSON behind after cleanup')

  resetLocalModelFileMocks()
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/oversized-islemind-export.json',
      name: 'oversized-islemind-export.json',
      mimeType: 'application/json',
      size: MAX_IMPORT_JSON_FILE_BYTES + 1,
    }],
  }
  const oversizedPortableImport = await importFromJsonFileDetailed()
  assert.deepEqual(
    oversizedPortableImport,
    { ok: false, kind: 'invalid', reason: 'file_too_large' },
    'portable data import reports oversized backups without parsing them'
  )
  assert.equal(localFileReadRequests.length, 0, 'portable data import rejects oversized JSON backups before readAsStringAsync')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/oversized-islemind-export.json'),
    'portable data import clears the cached picker copy even when import is rejected before parsing'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/islemind-export.json', Buffer.from(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    settings: null,
    providers: [],
    exportedAt: Date.now(),
  }), 'utf8'))
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/islemind-export.json',
      name: 'islemind-export.json',
      mimeType: 'application/json',
      size: localFileFixtures.get('file:///tmp/islemind-export.json').length,
    }],
  }
  const successfulPortableImport = await importFromJsonFileDetailed()
  assert.deepEqual(
    successfulPortableImport,
    { ok: true, kind: 'islemind', conversations: 0 },
    'portable data import keeps ordinary restore behavior after temp-file cleanup'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/islemind-export.json'),
    'portable data import clears the cached picker copy after a successful restore'
  )

  resetLocalModelFileMocks()
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/oversized-knowledge.txt',
      name: 'oversized-knowledge.txt',
      mimeType: 'text/plain',
      size: MAX_IMPORT_TEXT_FILE_BYTES + 1,
    }],
  }
  const oversizedKnowledgeImport = await importKnowledgeFile()
  assert.equal(oversizedKnowledgeImport.ok, false, 'knowledge import rejects oversized text files')
  assert.equal(oversizedKnowledgeImport.message, st('chat.fileTooLarge20'), 'knowledge import uses the existing 20MB file-size message')
  assert.equal(localFileReadRequests.length, 0, 'knowledge import rejects oversized files before text or PDF reads')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/oversized-knowledge.txt'),
    'knowledge import clears the cached picker copy after an oversized text rejection'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/knowledge-import.txt', Buffer.from('# Runbook\nKnowledge import keeps stable provenance.\n', 'utf8'))
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/knowledge-import.txt',
      name: 'knowledge-import.txt',
      mimeType: 'text/plain',
      size: localFileFixtures.get('file:///tmp/knowledge-import.txt').length,
    }],
  }
  const successfulKnowledgeImport = await importKnowledgeFile()
  assert.equal(successfulKnowledgeImport.ok, true, 'knowledge import still succeeds for ordinary text files')
  const importedKnowledgeDocuments = await listKnowledgeDocuments()
  const importedKnowledgeDocument = importedKnowledgeDocuments.find((document) => document.title === 'knowledge-import.txt')
  assert.equal(importedKnowledgeDocument?.sourceUri, 'knowledge-import.txt', 'knowledge import persists a stable provenance label instead of the temporary picker URI')
  const importedKnowledgeSnapshot = await exportContextSnapshot()
  assert.equal(importedKnowledgeSnapshot.documents.find((document) => document.title === 'knowledge-import.txt')?.rawPath, undefined, 'knowledge import does not persist the temporary picker cache URI as rawPath')
  const importedKnowledgeHits = await searchKnowledge('stable provenance', 5)
  assert.equal(importedKnowledgeHits[0]?.sourceUri, 'knowledge-import.txt', 'knowledge retrieval sources inherit stable document provenance from document_sources metadata')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/knowledge-import.txt'),
    'knowledge import clears the cached picker copy after a successful text import'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/oversized-knowledge.pdf', Buffer.alloc(MAX_IMPORT_TEXT_FILE_BYTES + 2))
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/oversized-knowledge.pdf',
      name: 'oversized-knowledge.pdf',
      mimeType: 'application/pdf',
    }],
  }
  const oversizedKnowledgePdfImport = await importKnowledgeFile({
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    enabled: true,
    models: ['gpt-4.1'],
    apiKey: FAKE_KEY_A,
    baseUrl: 'https://api.openai.com/v1',
  }, 'gpt-4.1')
  assert.equal(oversizedKnowledgePdfImport.ok, false, 'knowledge import rejects oversized PDFs even when picker size metadata is missing')
  assert.equal(oversizedKnowledgePdfImport.message, st('chat.fileTooLarge20'), 'oversized PDF knowledge import reuses the existing 20MB file-size message')
  assert.equal(localFileReadRequests.length, 0, 'knowledge PDF import rejects oversized size-less files before base64 reads')

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/attachment-without-size.txt', Buffer.alloc(MAX_IMPORT_TEXT_FILE_BYTES + 2))
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/attachment-without-size.txt',
      name: 'attachment-without-size.txt',
      mimeType: 'text/plain',
    }],
  }
  await assert.rejects(
    () => pickDocument(),
    /error\.fileTooLarge/,
    'attachment picker rejects oversized files even when DocumentPicker does not provide a size'
  )
  assert.equal(localFileReadRequests.length, 0, 'attachment picker rejects oversized size-less files before base64 reads')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/attachment-without-size.txt'),
    'attachment picker clears the cached picker copy after an oversized rejection'
  )

  resetLocalModelFileMocks()
  const attachmentImportFixture = Buffer.from('Attachment import keeps payloads while clearing temp cache copies.\n', 'utf8')
  localFileFixtures.set('file:///tmp/attachment-import.txt', attachmentImportFixture)
  nextDocumentPickerResult = {
    canceled: false,
    assets: [{
      uri: 'file:///tmp/attachment-import.txt',
      name: 'attachment-import.txt',
      mimeType: 'text/plain',
      size: attachmentImportFixture.length,
    }],
  }
  const successfulAttachment = await pickDocument()
  assert.equal(successfulAttachment?.type, 'text', 'attachment picker still classifies text documents correctly')
  assert.equal(successfulAttachment?.name, 'attachment-import.txt', 'attachment picker preserves the document name')
  assert.equal(successfulAttachment?.mimeType, 'text/plain', 'attachment picker preserves the document MIME type')
  assert.equal(successfulAttachment?.size, attachmentImportFixture.length, 'attachment picker preserves the resolved document size')
  assert.equal(successfulAttachment?.base64, attachmentImportFixture.toString('base64'), 'attachment picker keeps the in-memory base64 payload after temp-file cleanup')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/attachment-import.txt'),
    'attachment picker clears the cached picker copy after a successful import'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///cache/attachment-photo.jpg', Buffer.alloc(5 * 1024 * 1024 + 2, 65))
  nextImageLibraryResult = {
    canceled: false,
    assets: [{
      uri: 'file:///cache/attachment-photo.jpg',
      fileName: 'attachment-photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: localFileFixtures.get('file:///cache/attachment-photo.jpg').length,
    }],
  }
  nextManipulateResultFactory = (sourceUri) => {
    const compressedUri = 'file:///tmp/attachment-photo-compressed.jpg'
    localFileFixtures.set(compressedUri, Buffer.from('compressed-photo-bytes', 'utf8'))
    localFileOperations.push({ type: 'transform', from: sourceUri, to: compressedUri })
    return { uri: compressedUri }
  }
  const pickedImage = await pickImage()
  assert.equal(pickedImage?.type, 'image', 'image picker returns an image attachment')
  assert.equal(pickedImage?.uri, 'file:///tmp/attachment-photo-compressed.jpg', 'image picker returns the compressed temp URI for the payload copy')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/attachment-photo-compressed.jpg'),
    'image picker clears the compressed temp file after payload extraction'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///cache/attachment-photo.jpg'),
    'image picker clears the original picker copy when it is a cache-backed temp file'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///cache/attachment-photo-too-large.jpg', Buffer.alloc(MAX_IMPORT_TEXT_FILE_BYTES + 2))
  nextImageLibraryResult = {
    canceled: false,
    assets: [{
      uri: 'file:///cache/attachment-photo-too-large.jpg',
      fileName: 'attachment-photo-too-large.jpg',
      mimeType: 'image/jpeg',
    }],
  }
  await assert.rejects(
    () => pickImage(),
    /error\.fileTooLarge/,
    'image picker rejects oversized files before compression or base64 conversion'
  )
  assert.equal(localFileReadRequests.length, 0, 'image picker rejects oversized files before base64 reads')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///cache/attachment-photo-too-large.jpg'),
    'image picker clears the oversized cached picker copy after rejection'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///docs/attachment-camera.jpg', Buffer.alloc(5 * 1024 * 1024 + 2, 66))
  nextCameraResult = {
    canceled: false,
    assets: [{
      uri: 'file:///docs/attachment-camera.jpg',
      fileName: 'attachment-camera.jpg',
      mimeType: 'image/jpeg',
      fileSize: localFileFixtures.get('file:///docs/attachment-camera.jpg').length,
    }],
  }
  nextManipulateResultFactory = (sourceUri) => {
    const compressedUri = 'file:///tmp/attachment-camera-compressed.jpg'
    localFileFixtures.set(compressedUri, Buffer.from('compressed-camera-bytes', 'utf8'))
    localFileOperations.push({ type: 'transform', from: sourceUri, to: compressedUri })
    return { uri: compressedUri }
  }
  const takenPhoto = await takePhoto()
  assert.equal(takenPhoto?.type, 'image', 'camera capture returns an image attachment')
  assert.equal(takenPhoto?.uri, 'file:///tmp/attachment-camera-compressed.jpg', 'camera capture returns the compressed temp URI for the payload copy')
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///tmp/attachment-camera-compressed.jpg'),
    'camera capture clears the compressed temp file after payload extraction'
  )
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === 'file:///docs/attachment-camera.jpg'),
    false,
    'camera capture does not delete non-cache original image URIs while still cleaning compressed temp output'
  )

  resetLocalModelFileMocks()
  localFileFixtures.set('file:///tmp/recording-too-large.m4a', Buffer.alloc(MAX_IMPORT_TEXT_FILE_BYTES + 2))
  await assert.rejects(
    () => transcribeLocalAudio('file:///tmp/recording-too-large.m4a'),
    /error\.fileTooLarge/,
    'local audio transcription rejects oversized audio files before base64 conversion'
  )
  assert.equal(localFileReadRequests.length, 0, 'local audio transcription rejects oversized recordings before base64 reads')

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
  const originalFetchForSpeech = global.fetch
  try {
    resetLocalModelFileMocks()
    global.fetch = async (url) => {
      if (String(url).includes('/audio/speech')) {
        return new Response(Uint8Array.from([73, 68, 51, 4]).buffer, { status: 200 })
      }
      throw new Error(`unexpected speech fetch: ${url}`)
    }
    const speechProvider = {
      id: 'openai-speech',
      type: 'openai',
      name: 'OpenAI Speech',
      apiKey: FAKE_KEY_A,
      enabled: true,
      models: ['gpt-4o-mini-tts'],
      capabilities: { speech: true },
    }
    await speakText('first remote speech', speechProvider)
    const firstSpeechUri = [...localFileFixtures.keys()].find((uri) => uri.includes('islemind-tts-'))
    assert.ok(firstSpeechUri, 'remote speech writes a cache-backed mp3 file before playback')
    await speakText('second remote speech', speechProvider)
    assert.ok(
      localFileOperations.some((operation) => operation.type === 'delete' && operation.uri === firstSpeechUri),
      'starting a new remote speech playback deletes the previous cached TTS file'
    )
    stopSpeaking()
    assert.ok(
      localFileOperations.filter((operation) => operation.type === 'delete' && String(operation.uri).includes('islemind-tts-')).length >= 2,
      'stopping remote speech deletes the active cached TTS file'
    )
    localFileOperations.length = 0
    localFileFixtures.clear()
    await speakText('finished remote speech', speechProvider)
    const activeSpeechPlayer = global.__lastExpoAudioPlayer
    assert.ok(activeSpeechPlayer, 'remote speech creates an audio player for playback status tracking')
    activeSpeechPlayer.emitPlaybackStatusUpdate({ didJustFinish: true })
    assert.ok(
      localFileOperations.some((operation) => operation.type === 'delete' && String(operation.uri).includes('islemind-tts-')),
      'remote speech playback deletes the cached TTS file when playback finishes naturally'
    )
    assert.equal(
      [...localFileFixtures.keys()].some((uri) => uri.includes('islemind-tts-')),
      false,
      'remote speech playback leaves no cached TTS file behind after natural completion'
    )
  } finally {
    global.fetch = originalFetchForSpeech
  }
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
  memoryStorage.set('@islemind/local-embedding-models', JSON.stringify({
    records: {
      'all-MiniLM-L6-v2': {
        modelId: 'all-MiniLM-L6-v2',
        source: 'downloaded',
        downloadedAt: 1,
        verifiedAt: 1,
        bytes: miniLm.sizeBytes,
        sha256: Object.fromEntries(miniLm.files.map((file) => [file.path, file.sha256])),
      },
    },
    failed: {},
  }))
  for (const file of miniLm.files) {
    localFileFixtures.set(
      `file:///tmp/islemind-models/all-MiniLM-L6-v2/${file.path}`,
      fs.readFileSync(localModelFixturePath('all-MiniLM-L6-v2', file.path))
    )
  }
  const onnxProvider = await createOnnxEmbeddingProvider({
    localEmbeddingModelId: 'all-MiniLM-L6-v2',
    localEmbeddingModelSource: 'downloaded',
  })
  assert.ok(onnxProvider, 'ONNX provider resolves when a verified downloaded model is present')
  assert.equal(await onnxProvider.available(), true, 'ONNX provider remains available after helper extraction')
  localFileReadRequests.length = 0
  const embeddedVector = await onnxProvider.embed('hello world')
  assert.equal(embeddedVector.length, 384, 'ONNX provider returns the expected embedding dimension through the mocked runtime')
  assert.equal(
    localFileReadRequests.some((request) => request.uri.endsWith('/onnx/model_quantized.onnx')),
    false,
    'ONNX session creation no longer adds FileSystem base64 reads for the model file once provider availability is established'
  )
  resetLocalModelFileMocks()
  memoryStorage.delete('@islemind/local-embedding-models')
  localFileFixtures.set(`file:///tmp/islemind-models/${miniLm.id}.tmp-111/config.json`, Buffer.from('stale-temp', 'utf8'))
  localFileFixtures.set(`file:///tmp/islemind-models/${miniLm.id}.bak-222/tokenizer.json`, Buffer.from('stale-backup', 'utf8'))
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
    ![...localFileFixtures.keys()].some((uri) => uri.includes(`${miniLm.id}.bak-`)),
    'download flow also clears stale backup directories before publishing the new model'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'download' && operation.url === localModelDownloadUrl(miniLm, 'onnx/model_quantized.onnx')),
    'download flow uses the official model file URL'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes(`${miniLm.id}.tmp-111`)),
    'download flow deletes stale temporary directories from earlier interrupted downloads'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes(`${miniLm.id}.bak-222`)),
    'download flow deletes stale backup directories from earlier interrupted replacements'
  )
  assert.ok(localFileOperations.some((operation) => operation.type === 'move'), 'download flow atomically moves the temporary directory into place')
  const downloadedViews = await listLocalEmbeddingModelViews({
    localEmbeddingModelId: miniLm.id,
    localEmbeddingModelSource: 'downloaded',
  })
  assert.equal(downloadedViews.find((view) => view.model.id === miniLm.id).status, 'enabled', 'successful download appears as enabled when selected')

  resetLocalModelFileMocks()
  localFileFixtures.set(`file:///tmp/islemind-models/${miniLm.id}/config.json`, Buffer.from('active-download', 'utf8'))
  localFileFixtures.set(`file:///tmp/islemind-models/${miniLm.id}.tmp-333/config.json`, Buffer.from('orphan-temp', 'utf8'))
  localFileFixtures.set(`file:///tmp/islemind-models/${miniLm.id}.bak-444/tokenizer.json`, Buffer.from('orphan-backup', 'utf8'))
  await deleteDownloadedLocalEmbeddingModel(miniLm.id)
  assert.equal(
    [...localFileFixtures.keys()].some((uri) => uri.includes(`file:///tmp/islemind-models/${miniLm.id}/`)),
    false,
    'explicit model deletion removes the current downloaded model directory'
  )
  assert.equal(
    [...localFileFixtures.keys()].some((uri) => uri.includes(`${miniLm.id}.tmp-333`) || uri.includes(`${miniLm.id}.bak-444`)),
    false,
    'explicit model deletion also removes stale temp and backup directories for the same model'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes(`${miniLm.id}.tmp-333`)),
    'explicit model deletion clears orphaned temporary directories'
  )
  assert.ok(
    localFileOperations.some((operation) => operation.type === 'delete' && operation.uri.includes(`${miniLm.id}.bak-444`)),
    'explicit model deletion clears orphaned backup directories'
  )
  const deletedViews = await listLocalEmbeddingModelViews({
    localEmbeddingModelId: miniLm.id,
    localEmbeddingModelSource: 'downloaded',
  })
  assert.equal(
    deletedViews.find((view) => view.model.id === miniLm.id).downloaded,
    false,
    'explicit model deletion clears the downloaded record after orphan cleanup'
  )

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
    localDownloadFixtures.set(localModelDownloadUrl(miniLm, file.path), { status: 503, body: Buffer.alloc(0) })
    localDownloadFixtures.set(
      localModelMirrorUrl(miniLm, 'https://mirror.example/hf', file.path),
      { status: 200, body: fs.readFileSync(localModelFixturePath(miniLm.id, file.path)) }
    )
  }
  await assert.rejects(
    () => downloadLocalEmbeddingModel(miniLm.id, { mirrorBaseUrl: 'file:///tmp/mirror-cache' }),
    /Download failed: HTTP 503/,
    'local model mirror helper ignores invalid non-web mirror URLs and keeps the official failure'
  )
  assert.equal(
    localFileOperations.some((operation) => operation.type === 'download' && String(operation.url).includes('mirror.example')),
    false,
    'local model mirror helper does not attempt non-web mirror fallback downloads'
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

  await saveData('MCP_SERVERS', [
    {
      id: 'mcp-invalid-persisted',
      name: 'Invalid Persisted MCP',
      url: 'file:///tmp/mcp',
      transport: 'sse',
      enabled: true,
      status: 'connected',
      manifestTtlMs: 1000,
      tools: [],
      resources: [],
      prompts: [],
      approvedToolNames: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'mcp-valid-persisted',
      name: 'Valid Persisted MCP',
      url: 'https://mcp.example.test',
      transport: 'sse',
      enabled: true,
      status: 'connected',
      manifestTtlMs: 1000,
      tools: [],
      resources: [],
      prompts: [],
      approvedToolNames: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ])
  const listedMcpServers = await listMcpServers()
  assert.equal(listedMcpServers.some((server) => server.id === 'mcp-invalid-persisted'), false, 'persisted MCP server list filters invalid non-web URLs before runtime use')
  assert.equal(listedMcpServers.some((server) => server.id === 'mcp-valid-persisted'), true, 'persisted MCP server list keeps valid HTTPS endpoints')
  const mcpSettingsSource = fs.readFileSync(path.join(root, 'src/components/settings/McpSettingsContent.tsx'), 'utf8')
  assert.ok(mcpSettingsSource.includes("import { normalizeMcpServerUrl } from '@/services/mcpUrlPolicy'"), 'MCP settings page reuses the shared MCP URL policy')
  assert.ok(!mcpSettingsSource.includes('^https?:\\/\\/'), 'MCP settings page does not keep a separate HTTP URL regex boundary')

  const importedMcpServersResult = await importAllDataDetailed(JSON.stringify({
    app: 'islemind',
    version: 1,
    conversations: [],
    providers: [],
    mcpServers: [
      {
        id: 'mcp-import-invalid',
        name: 'Imported Invalid MCP',
        url: 'islemind://external-mcp',
        transport: 'sse',
        enabled: true,
        status: 'connected',
        manifestTtlMs: 1000,
        tools: [],
        resources: [],
        prompts: [],
        approvedToolNames: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'mcp-import-valid',
        name: 'Imported Valid MCP',
        url: 'https://imported.example.test/mcp',
        transport: 'sse',
        enabled: true,
        status: 'connected',
        manifestTtlMs: 1000,
        tools: [],
        resources: [],
        prompts: [],
        approvedToolNames: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    exportedAt: Date.now(),
  }))
  assert.deepEqual(importedMcpServersResult, { ok: true, kind: 'islemind', conversations: 0 }, 'portable import accepts IsleMind payloads with MCP servers')
  const importedMcpServers = await loadData('MCP_SERVERS')
  assert.deepEqual(importedMcpServers.map((server) => server.id), ['mcp-import-valid'], 'portable import drops invalid non-web MCP server URLs before persistence')

  const invalidRuntimeMcpServer = {
    id: 'mcp-runtime-invalid',
    name: 'Runtime Invalid MCP',
    url: 'islemind://external-mcp',
    transport: 'sse',
    enabled: true,
    status: 'connected',
    manifestTtlMs: 1000,
    tools: [{ name: 'read_remote_fixture', permission: 'read-only', enabled: true, serverId: 'mcp-runtime-invalid' }],
    resources: [],
    prompts: [],
    approvedToolNames: ['read_remote_fixture'],
    createdAt: 1,
    updatedAt: 1,
  }
  const originalFetchForInvalidMcp = global.fetch
  try {
    global.fetch = async () => {
      throw new Error('invalid MCP URLs must not reach fetch')
    }
    const invalidMcpCallResult = await callMcpTool(invalidRuntimeMcpServer, 'read_remote_fixture', {})
    assert.equal(invalidMcpCallResult.ok, false, 'MCP runtime rejects invalid non-web server URLs before execution')
    assert.equal(invalidMcpCallResult.trace.status, 'skipped', 'invalid MCP runtime URLs fail closed before tool execution')
    assert.equal(invalidMcpCallResult.trace.metadata?.errorCode, 'tool_unavailable', 'invalid MCP runtime URLs report tool_unavailable')
    assert.match(invalidMcpCallResult.error, /HTTP\(S\)/, 'invalid MCP runtime URLs explain the HTTP(S) boundary')
    const invalidMcpRefreshResult = await refreshMcpManifest(invalidRuntimeMcpServer)
    assert.equal(invalidMcpRefreshResult.status, 'error', 'manifest refresh rejects invalid non-web MCP server URLs before fetch')
    assert.match(invalidMcpRefreshResult.lastError ?? '', /HTTP\(S\)/, 'manifest refresh surfaces the MCP HTTP(S) boundary error')
  } finally {
    global.fetch = originalFetchForInvalidMcp
  }

  const builtin = builtinMcpServer()
  assert.equal(builtin.transport, 'sse')
  assert.equal(builtin.tools.find((tool) => tool.name === 'app_info').permission, 'read-only')
  const appInfo = await callMcpTool(builtin, 'app_info', {})
  assert.equal(appInfo.ok, true, 'built-in MCP app_info works without network')
  assert.ok(appInfo.content[0].text.includes('stdio is disabled'), 'MCP app_info states mobile transport boundary')
  const truncated = truncateToolBlocks([{ type: 'text', text: 'x'.repeat(2000) }], 50)
  assert.ok(truncated[0].text.length < 1000, 'MCP tool output is truncated to budget')
}

function assertTraceRedactionBehavior() {
  const headerTrace = sanitizeTrace({
    id: 'trace-header-redaction',
    type: 'tool',
    title: 'Headers Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
    content: 'proxy-authorization: bearer abcdefghijklmnopqrstuvwxyz123456',
    status: 'done',
    metadata: {
      safeNote: 'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
      nested: {
        proxy: 'proxy-authorization: bearer abcdefghijklmnopqrstuvwxyz123456',
      },
    },
  })
  const serialized = JSON.stringify(headerTrace)
  assert.ok(!serialized.includes('QWxhZGRpbjpvcGVuIHNlc2FtZQ=='), 'trace redaction removes Basic authorization credential values')
  assert.ok(!serialized.includes('abcdefghijklmnopqrstuvwxyz123456'), 'trace redaction removes lowercase proxy bearer credential values')
  assert.equal(headerTrace.title, 'Headers [redacted]', 'trace redaction removes header-like Basic auth from visible titles')
  assert.equal(headerTrace.content, '[redacted]', 'trace redaction removes header-like proxy bearer auth from visible content')
  assert.equal(headerTrace.metadata.safeNote, '[redacted]', 'trace metadata value redaction removes header-like Basic auth')
  assert.equal(headerTrace.metadata.nested.proxy, '[redacted]', 'nested trace metadata value redaction removes header-like proxy bearer auth')
}

async function runFocused() {
  const focusArg = process.argv.find((arg) => arg.startsWith('--focus='))
  const focus = focusArg ? focusArg.slice('--focus='.length) : null
  if (!focus) {
    await run()
    return
  }
  if (focus === 'settings-url-persistence') {
    await assertSettingsUrlPersistenceBehavior()
    return
  }
  if (focus === 'runtime-log') {
    await assertRuntimeLogFileBehavior()
    await assertRuntimeDiagnosticsBehavior()
    return
  }
  if (focus === 'runtime-health-log') {
    await assertStorageFailureRuntimeLogging()
    await assertRenderGuardRuntimeLogging()
    await assertMcpRuntimeLogging()
    await assertContextRuntimeLogging()
    await assertKnowledgeRetrievalRuntimeLogging()
    await assertKnowledgeEmbeddingRuntimeLogging()
    return
  }
  if (focus === 'trace-redaction') {
    assertTraceRedactionBehavior()
    return
  }
  if (focus === 'context-runtime-log') {
    await assertContextRuntimeLogging()
    return
  }
  if (focus === 'clear-all-data') {
    await assertClearAllDataBehavior()
    return
  }
  if (focus === 'apk-install-cache') {
    await assertApkUpdateBehavior()
    return
  }
  if (focus === 'android-app-cache-cleanup') {
    await assertAndroidAppCacheCleanupBehavior()
    return
  }
  if (focus === 'chat-android-undo-prompt') {
    assertChatAndroidUndoPromptBehavior()
    return
  }
  if (focus === 'provider-store-cleanup') {
    await assertProviderStoreLifecycleBehavior()
    return
  }
  if (focus === 'provider-presets') {
    await assertExpandedProviderPresetCoverage()
    return
  }
  if (focus === 'provider-capability-matrix') {
    await assertProviderCapabilityMatrixBehavior()
    await assertRuntimeDiagnosticsBehavior()
    return
  }
  throw new Error(`Unknown focus: ${focus}`)
}

runFocused()
  .then(() => {
    console.log('provider-intelligence tests passed')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
