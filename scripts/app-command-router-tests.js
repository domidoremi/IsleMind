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

global.__DEV__ = false

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

const i18nMock = {
  isInitialized: false,
  language: 'zh-CN',
  use() {
    return this
  },
  init(options) {
    this.isInitialized = true
    this.language = options.lng
    return this
  },
  changeLanguage(language) {
    this.language = language
    return Promise.resolve(language)
  },
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
        runAsync: async () => undefined,
        getAllAsync: async () => [],
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
      getInfoAsync: async () => ({ exists: false, uri: 'file:///tmp/', isDirectory: false }),
      makeDirectoryAsync: async () => undefined,
      readAsStringAsync: async () => '',
      writeAsStringAsync: async () => undefined,
      deleteAsync: async () => undefined,
      moveAsync: async () => undefined,
      downloadAsync: async () => ({ status: 404, uri: 'file:///tmp/' }),
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
  if (request === 'expo-localization') {
    return { getLocales: () => [{ languageCode: 'zh' }] }
  }
  if (request === 'i18next') {
    return { __esModule: true, default: i18nMock }
  }
  if (request === 'react-i18next') {
    return { initReactI18next: {} }
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

async function run() {
  const { useSettingsStore } = require('../src/store/settingsStore.ts')
  const { routeLocalAppCommand } = require('../src/services/appCommandRouter.ts')
  const { builtinMcpServer, callMcpTool, truncateToolBlocks } = require('../src/services/mcp.ts')

  await useSettingsStore.getState().load()

  const dark = await routeLocalAppCommand('切换深色主题')
  assert.equal(dark.ok, true)
  assert.equal(useSettingsStore.getState().settings.theme, 'dark')

  const question = await routeLocalAppCommand('如何切换深色主题？')
  assert.equal(question, null)

  const searchOff = await routeLocalAppCommand('关闭网页搜索')
  assert.equal(searchOff.ok, true)
  assert.equal(useSettingsStore.getState().settings.webSearchEnabled, false)

  const english = await routeLocalAppCommand('把界面语言改成英文')
  assert.equal(english.ok, true)
  assert.equal(useSettingsStore.getState().settings.language, 'en')

  const builtin = builtinMcpServer()
  assert.ok(builtin.tools.some((tool) => tool.name === 'set_theme_mode'))
  assert.ok(builtin.tools.some((tool) => tool.name === 'set_feature_flag'))

  const light = await callMcpTool(builtin, 'set_theme_mode', { mode: 'light' })
  assert.equal(light.ok, true)
  assert.equal(useSettingsStore.getState().settings.theme, 'light')

  const settings = await callMcpTool(builtin, 'get_settings', {})
  assert.equal(settings.ok, true)
  assert.match(settings.content[0].text, /"theme"/)

  const invalidTheme = await callMcpTool(builtin, 'set_theme_mode', { mode: 'blue' })
  assert.equal(invalidTheme.ok, false)
  assert.equal(invalidTheme.trace.status, 'error')

  const disabledServerResult = await callMcpTool({ ...builtin, enabled: false }, 'get_settings', {})
  assert.equal(disabledServerResult.ok, false)
  assert.equal(disabledServerResult.trace.status, 'skipped')
  assert.equal(disabledServerResult.trace.metadata?.serverId, builtin.id)
  assert.equal(disabledServerResult.trace.metadata?.toolName, 'get_settings')
  assert.equal(disabledServerResult.trace.metadata?.source, 'builtin')
  assert.equal(disabledServerResult.trace.metadata?.permission, 'read-only')
  assert.equal(disabledServerResult.trace.metadata?.errorCode, 'tool_unavailable')

  const disabledToolResult = await callMcpTool({
    ...builtin,
    tools: builtin.tools.map((tool) => tool.name === 'get_settings' ? { ...tool, enabled: false } : tool),
  }, 'get_settings', {})
  assert.equal(disabledToolResult.ok, false)
  assert.equal(disabledToolResult.trace.status, 'skipped')
  assert.equal(disabledToolResult.trace.metadata?.serverId, builtin.id)
  assert.equal(disabledToolResult.trace.metadata?.toolName, 'get_settings')
  assert.equal(disabledToolResult.trace.metadata?.source, 'builtin')
  assert.equal(disabledToolResult.trace.metadata?.permission, 'read-only')
  assert.equal(disabledToolResult.trace.metadata?.errorCode, 'tool_unavailable')

  const disconnectedMcpResult = await callMcpTool({
    ...builtin,
    id: 'external-mcp-test',
    name: 'External MCP Test',
    url: 'https://mcp.example.test',
    enabled: true,
    status: 'disconnected',
    tools: [
      {
        name: 'read_remote_fixture',
        description: 'Read a remote fixture.',
        permission: 'read-only',
        serverId: 'external-mcp-test',
        enabled: true,
      },
    ],
  }, 'read_remote_fixture', {})
  assert.equal(disconnectedMcpResult.ok, false)
  assert.equal(disconnectedMcpResult.trace.status, 'skipped')
  assert.equal(disconnectedMcpResult.trace.metadata?.serverId, 'external-mcp-test')
  assert.equal(disconnectedMcpResult.trace.metadata?.toolName, 'read_remote_fixture')
  assert.equal(disconnectedMcpResult.trace.metadata?.source, 'mcp')
  assert.equal(disconnectedMcpResult.trace.metadata?.permission, 'read-only')
  assert.equal(disconnectedMcpResult.trace.metadata?.errorCode, 'tool_unavailable')

  const connectedMcpServer = {
    ...builtin,
    id: 'external-mcp-cancellable-test',
    name: 'External MCP Cancellable Test',
    url: 'https://mcp.example.test',
    enabled: true,
    status: 'connected',
    tools: [
      {
        name: 'read_remote_fixture',
        description: 'Read a remote fixture.',
        permission: 'read-only',
        serverId: 'external-mcp-cancellable-test',
        enabled: true,
      },
    ],
  }
  const originalFetchForCancellation = global.fetch
  const abortedMcpController = new AbortController()
  abortedMcpController.abort()
  let abortedFetchCalled = false
  global.fetch = async () => {
    abortedFetchCalled = true
    throw new Error('aborted MCP calls must not reach fetch')
  }
  try {
    const abortedMcpResult = await callMcpTool(connectedMcpServer, 'read_remote_fixture', {}, undefined, { signal: abortedMcpController.signal })
    assert.equal(abortedMcpResult.ok, false)
    assert.equal(abortedMcpResult.trace.status, 'skipped')
    assert.equal(abortedMcpResult.trace.metadata?.errorCode, 'cancelled')
    assert.equal(abortedMcpResult.trace.metadata?.status, 'cancelled')
    assert.equal(abortedMcpResult.trace.metadata?.failureCode, 'cancelled')
    assert.equal(abortedFetchCalled, false)
  } finally {
    global.fetch = originalFetchForCancellation
  }

  const forwardedSignalController = new AbortController()
  let forwardedSignal = null
  global.fetch = async (_url, init = {}) => {
    forwardedSignal = init.signal
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { content: [{ type: 'text', text: 'Remote MCP fixture' }] } }),
    }
  }
  try {
    const signalForwardResult = await callMcpTool(connectedMcpServer, 'read_remote_fixture', {}, undefined, { signal: forwardedSignalController.signal })
    assert.equal(signalForwardResult.ok, true)
    assert.equal(forwardedSignal, forwardedSignalController.signal)
  } finally {
    global.fetch = originalFetchForCancellation
  }

  const abortAfterFetchController = new AbortController()
  global.fetch = async () => {
    abortAfterFetchController.abort()
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: { content: [{ type: 'text', text: 'Late MCP fixture' }] } }),
    }
  }
  try {
    const cancelledAfterFetchResult = await callMcpTool(connectedMcpServer, 'read_remote_fixture', {}, undefined, { signal: abortAfterFetchController.signal })
    assert.equal(cancelledAfterFetchResult.ok, false)
    assert.equal(cancelledAfterFetchResult.trace.status, 'skipped')
    assert.equal(cancelledAfterFetchResult.trace.metadata?.errorCode, 'cancelled')
  } finally {
    global.fetch = originalFetchForCancellation
  }

  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      result: {
        content: [
          { type: 'text', text: 'Remote MCP fixture api_key=sk-test-secret-value' },
          { type: 'resource', uri: 'https://mcp.example.test/resource?token=sk-test-secret-value', name: 'token=sk-test-secret-value' },
        ],
      },
    }),
  })
  try {
    const sensitiveMcpResult = await callMcpTool({
      ...builtin,
      id: 'external-mcp-sensitive-test',
      name: 'External MCP Sensitive Test',
      url: 'https://mcp.example.test',
      enabled: true,
      status: 'connected',
      tools: [
        {
          name: 'read_sensitive_fixture',
          description: 'Read a remote fixture.',
          permission: 'read-only',
          serverId: 'external-mcp-sensitive-test',
          enabled: true,
        },
      ],
    }, 'read_sensitive_fixture', {})
    assert.equal(sensitiveMcpResult.ok, true)
    assert.doesNotMatch(JSON.stringify(sensitiveMcpResult.content), /sk-test-secret-value/)
    assert.doesNotMatch(sensitiveMcpResult.trace.content ?? '', /sk-test-secret-value/)
    assert.match(JSON.stringify(sensitiveMcpResult.content), /\[redacted\]/)
    assert.match(sensitiveMcpResult.trace.content ?? '', /\[redacted\]/)
    assert.equal(sensitiveMcpResult.trace.metadata?.source, 'mcp')
    assert.equal(sensitiveMcpResult.trace.metadata?.serverId, 'external-mcp-sensitive-test')
  } finally {
    global.fetch = originalFetch
  }

  const truncatedSecretBlocks = truncateToolBlocks([{ type: 'text', text: 'api_key=sk-test-secret-value' }], 1200)
  assert.doesNotMatch(JSON.stringify(truncatedSecretBlocks), /sk-test-secret-value/)
  assert.match(JSON.stringify(truncatedSecretBlocks), /\[redacted\]/)

  console.log('app-command-router tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
