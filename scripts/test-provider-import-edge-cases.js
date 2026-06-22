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

global.i18next = {
  t: (key, params) => {
    if (key === 'providerRegistry.duplicateSkipped') return `重复供应商已跳过: ${params?.name}`
    if (key === 'providerRegistry.chunkUnrecognized') return `无法识别的块 #${params?.index}`
    if (key === 'providerRegistry.noTokens') return `${params?.name} 没有凭证`
    if (key === 'providerRegistry.importedProviderName') return `导入的供应商 #${params?.index}`
    if (key === 'providerRegistry.providerSkippedByPolicy') return `${params?.name} 被策略跳过`
    if (key === 'apiKeyPanel.groupName') return `令牌分组 ${params?.index}`
    return key
  },
}

const { parseProviderImportText } = require('../src/services/ai/providerRegistry')

const testCases = [
  {
    name: '单个供应商，多个协议（同域名）',
    input: `tp-cy0i11rhxtiu6afpsm3vwi0rgkuekizc2bko7ol47x4serzi
兼容 OpenAI 接口协议：
https://token-plan-cn.xiaomimimo.com/v1
兼容 Anthropic 接口协议：
https://token-plan-cn.xiaomimimo.com/anthropic`,
    expectedProviders: 1,
    expectedCredentialGroups: 1,
  },
  {
    name: '多个供应商，不同域名',
    input: `sk-abc123
https://api.openai.com/v1

sk-def456
https://api.anthropic.com/v1`,
    expectedProviders: 2,
    minCredentialGroups: 1,
  },
  {
    name: '单个供应商，单个协议',
    input: `sk-single123
https://api.example.com/v1`,
    expectedProviders: 1,
    expectedCredentialGroups: 1,
  },
  {
    name: '多个密钥，单个 URL',
    input: `sk-key1
sk-key2
sk-key3
https://api.example.com/v1`,
    expectedProviders: 1,
    expectedCredentialGroups: 3,
  },
  {
    name: '混合格式（标签 + 键值对）',
    input: `Provider: My Provider
Base URL: https://api.example.com/v1
Key: sk-test123`,
    expectedProviders: 1,
    expectedCredentialGroups: 1,
  },
]

console.log('Running provider import edge case tests...\n')
console.log('='.repeat(70) + '\n')

let passed = 0
let failed = 0

testCases.forEach((testCase, index) => {
  console.log(`Test ${index + 1}: ${testCase.name}`)
  console.log('-'.repeat(70))

  const result = parseProviderImportText(testCase.input)

  let testPassed = true
  const errors = []

  if (testCase.expectedProviders !== undefined && result.providers.length !== testCase.expectedProviders) {
    errors.push(`Expected ${testCase.expectedProviders} providers, got ${result.providers.length}`)
    testPassed = false
  }

  if (testCase.expectedCredentialGroups !== undefined) {
    const totalGroups = result.providers.reduce((sum, p) => sum + (p.credentialGroups?.length || 0), 0)
    if (totalGroups !== testCase.expectedCredentialGroups) {
      errors.push(`Expected ${testCase.expectedCredentialGroups} credential groups total, got ${totalGroups}`)
      testPassed = false
    }
  }

  if (testCase.minCredentialGroups !== undefined) {
    const totalGroups = result.providers.reduce((sum, p) => sum + (p.credentialGroups?.length || 0), 0)
    if (totalGroups < testCase.minCredentialGroups) {
      errors.push(`Expected at least ${testCase.minCredentialGroups} credential groups, got ${totalGroups}`)
      testPassed = false
    }
  }

  if (testPassed) {
    console.log('✅ PASS')
    passed++
  } else {
    console.log('❌ FAIL')
    errors.forEach((error) => console.log(`   ${error}`))
    failed++
  }

  console.log(`   Providers: ${result.providers.length}`)
  result.providers.forEach((provider, i) => {
    console.log(`     ${i + 1}. ${provider.name} (${provider.credentialGroups?.length || 0} keys)`)
  })

  console.log()
})

console.log('='.repeat(70))
console.log(`\nResults: ${passed} passed, ${failed} failed out of ${testCases.length} tests`)

process.exit(failed === 0 ? 0 : 1)
