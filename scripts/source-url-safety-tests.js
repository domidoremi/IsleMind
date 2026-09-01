const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  isAllowedWebViewNavigation,
  parseHttpUrl,
  safeHttpUrl,
  webViewOriginWhitelist,
} = require('../src/utils/sourceUrlSafety.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isSourceUrlSafetyHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(transformTypeScriptModule(source, filename), filename)
  }
  hook.isSourceUrlSafetyHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function run() {
  assert.equal(safeHttpUrl(' https://example.com/source?q=1 '), 'https://example.com/source?q=1', 'source URL guard keeps HTTPS source previews')
  assert.equal(safeHttpUrl('https://user:pass@example.com/source'), undefined, 'source URL guard rejects embedded userinfo credentials')
  assert.equal(safeHttpUrl('https://example.com/source?access_token=secret'), undefined, 'source URL guard rejects credential-bearing query parameters')
  assert.equal(safeHttpUrl('javascript:alert(1)'), undefined, 'source URL guard rejects javascript previews')
  assert.equal(parseHttpUrl('file:///data/data/islemind/private.txt'), undefined, 'source URL parser rejects file URLs')

  assert.equal(isAllowedWebViewNavigation('about:blank', 'https://example.com/source'), true, 'WebView guard permits internal blank page')
  assert.equal(isAllowedWebViewNavigation('https://example.com/next', 'https://example.com/source'), true, 'WebView guard permits same-host HTTPS navigation')
  assert.equal(isAllowedWebViewNavigation('http://example.com/next', 'https://example.com/source'), false, 'WebView guard blocks HTTPS source downgrades')
  assert.equal(isAllowedWebViewNavigation('https://www.example.com/next', 'https://example.com/source'), false, 'WebView guard blocks cross-host navigation')
  assert.equal(isAllowedWebViewNavigation('https://evil.test/phish', 'https://example.com/source'), false, 'WebView guard blocks external hosts')
  assert.equal(isAllowedWebViewNavigation('data:text/html,<script>alert(1)</script>', 'https://example.com/source'), false, 'WebView guard rejects data navigations')
  assert.deepEqual(webViewOriginWhitelist('https://example.com/source'), ['https://example.com'], 'WebView origin whitelist is source-host scoped')
  assert.deepEqual(webViewOriginWhitelist('http://example.com/source'), ['http://example.com', 'https://example.com'], 'HTTP source previews may upgrade to HTTPS on the same host')

  const sourceScreen = fs.readFileSync(path.join(root, 'src/presentation/features/conversations/SourceDetailScreen.tsx'), 'utf8')
  assert.ok(sourceScreen.includes('originWhitelist={webViewOriginWhitelist(url)}'), 'source WebView uses host-scoped origin whitelist')
  assert.ok(sourceScreen.includes('isAllowedWebViewNavigation(request.url, url)'), 'source WebView checks navigation against source URL')

  console.log('Source URL safety tests passed')
}

if (require.main === module) run()

module.exports = { run }
