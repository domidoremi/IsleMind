const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

function compileTypeScript(code, sourcePath) {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
    },
    fileName: sourcePath,
  })
  return result.outputText
}

Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const relative = request.replace(/^@\//, 'src/')
    return originalResolve.call(this, path.join(root, relative), parent, isMain, options)
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = function (module, filename) {
  const content = require('fs').readFileSync(filename, 'utf8')
  const compiled = compileTypeScript(content, filename)
  module._compile(compiled, filename)
}

require.extensions['.tsx'] = require.extensions['.ts']

// Mock i18next
global.i18next = {
  t: (key, params) => {
    if (key === 'providerRegistry.duplicateSkipped') return `重复供应商已跳过: ${params?.name}`
    if (key === 'providerRegistry.chunkUnrecognized') return `无法识别的块 #${params?.index}`
    if (key === 'providerRegistry.noTokens') return `${params?.name} 没有凭证`
    if (key === 'providerRegistry.importedProviderName') return `导入的供应商 #${params?.index}`
    if (key === 'providerRegistry.providerSkippedByPolicy') return `${params?.name} 被策略跳过`
    return key
  },
}

// Now load the module
const { parseProviderImportText } = require('../src/services/ai/providerRegistry')

const testInput = `tp-cy0i11rhxtiu6afpsm3vwi0rgkuekizc2bko7ol47x4serzi
兼容 OpenAI 接口协议：
https://token-plan-cn.xiaomimimo.com/v1
兼容 Anthropic 接口协议：
https://token-plan-cn.xiaomimimo.com/anthropic`

console.log('Testing multi-protocol provider import...\n')
console.log('Input:')
console.log(testInput)
console.log('\n' + '='.repeat(60) + '\n')

const result = parseProviderImportText(testInput)

console.log(`Detected providers: ${result.providers.length}`)
console.log(`Warnings: ${result.warnings.length}`)
console.log(`Duplicates: ${result.duplicates.length}`)
console.log('\n' + '='.repeat(60) + '\n')

if (result.providers.length === 1) {
  console.log('✅ PASS: Correctly parsed as single provider')
  const provider = result.providers[0]
  console.log('\nProvider details:')
  console.log(`  Name: ${provider.name}`)
  console.log(`  Base URL: ${provider.baseUrl}`)
  console.log(`  Preset ID: ${provider.presetId}`)
  console.log(`  Wire Protocol: ${provider.wireProtocol || 'auto-detect'}`)
  console.log(`  Credential Groups: ${provider.credentialGroups?.length || 0}`)
  if (provider.credentialGroups?.length) {
    provider.credentialGroups.forEach((group, index) => {
      console.log(`    Group ${index + 1}: ${group.apiKey?.slice(0, 10)}... (label: ${group.label || 'none'})`)
    })
  }
} else if (result.providers.length === 2) {
  console.log('⚠️  WARNING: Parsed as two separate providers (old behavior)')
  result.providers.forEach((provider, index) => {
    console.log(`\nProvider ${index + 1}:`)
    console.log(`  Name: ${provider.name}`)
    console.log(`  Base URL: ${provider.baseUrl}`)
    console.log(`  Wire Protocol: ${provider.wireProtocol}`)
  })
} else {
  console.log(`❌ FAIL: Unexpected number of providers (${result.providers.length})`)
}

if (result.warnings.length > 0) {
  console.log('\nWarnings:')
  result.warnings.forEach((warning) => console.log(`  - ${warning}`))
}

console.log('\n' + '='.repeat(60))
console.log('\nTest completed.')

process.exit(result.providers.length === 1 ? 0 : 1)
