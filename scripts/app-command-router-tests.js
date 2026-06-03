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
  const { builtinMcpServer, callMcpTool } = require('../src/services/mcp.ts')

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

  console.log('app-command-router tests passed')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
