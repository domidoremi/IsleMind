const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const sourcePath = path.join(root, 'src/modules/integrations/mcpPresetCatalog.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const settingsSource = fs.readFileSync(
  path.join(root, 'src/components/settings/McpSettingsContent.tsx'),
  'utf8',
)
const publicApiSource = fs.readFileSync(
  path.join(root, 'src/modules/integrations/index.ts'),
  'utf8',
)
const transpiled = transformTypeScriptModule(source, sourcePath)
const moduleRef = { exports: {} }
new Function('require', 'module', 'exports', transpiled)(require, moduleRef, moduleRef.exports)

const presets = moduleRef.exports.listMcpRemotePresets()
assert.deepEqual(presets.map((preset) => preset.id), ['context7', 'microsoft-learn'])
assert.equal(new Set(presets.map((preset) => preset.url)).size, presets.length, 'preset endpoints are unique')

for (const preset of presets) {
  const endpoint = new URL(preset.url)
  assert.equal(endpoint.protocol, 'https:', `${preset.id} uses public HTTPS`)
  assert.equal(preset.transport, 'streamable-http', `${preset.id} is mobile-compatible remote HTTP`)
  assert.equal(preset.protocolPreference, 'latest-with-legacy-fallback', `${preset.id} prefers current MCP`)
  assert.equal(preset.enabledOnInstall, true, `${preset.id} is enabled in configuration, not connected by installation`)
  assert.equal(preset.autoApproveTools, false, `${preset.id} never auto-approves discovered tools`)
}

const context7 = moduleRef.exports.getMcpRemotePreset('context7')
assert.equal(context7.authentication, 'optional-api-key')
assert.equal(context7.useCase, 'library-documentation')
assert.equal(context7.source, 'official')

const microsoftLearn = moduleRef.exports.getMcpRemotePreset('microsoft-learn')
assert.equal(microsoftLearn.authentication, 'none')
assert.equal(microsoftLearn.source, 'official')

assert.match(publicApiSource, /export \* from ['"]\.\/mcpPresetCatalog['"]/, 'preset catalog is public')
assert.match(settingsSource, /listMcpRemotePresets\(\)/, 'Settings renders the public preset catalog')
const installPresetSource = settingsSource.match(/async function installPreset\b[\s\S]*?(?=\n  async function refreshServer\b)/)?.[0]
assert.ok(installPresetSource, 'preset installation has a separate local action')
assert.match(installPresetSource, /await upsertMcpServer\(/, 'preset installation persists configuration')
assert.match(installPresetSource, /enabled:\s*preset\.enabledOnInstall/, 'enabled configuration is preserved without connecting')
assert.match(installPresetSource, /status:\s*'disconnected'/, 'preset installation does not claim a verified connection')
for (const field of ['tools', 'resources', 'prompts', 'approvedToolNames']) {
  assert.match(installPresetSource, new RegExp(`${field}:\\s*\\[\\]`), `preset installation starts with no ${field}`)
}
assert.doesNotMatch(installPresetSource, /refreshMcpManifest\s*\(/, 'preset installation never probes a remote server')
const refreshServerSource = settingsSource.match(/async function refreshServer\b[\s\S]*?(?=\n  async function toggleServer\b)/)?.[0]
assert.ok(refreshServerSource, 'connection has a separate explicit action')
assert.match(refreshServerSource, /await refreshMcpManifest\(server\)/, 'the connection action discovers the selected server manifest')
assert.match(
  installPresetSource,
  /transport:\s*preset\.transport/,
  'preset installation preserves the catalog transport policy',
)

const detached = moduleRef.exports.listMcpRemotePresets()
detached[0].name = 'changed by caller'
assert.equal(moduleRef.exports.getMcpRemotePreset('context7').name, 'Context7', 'catalog reads are detached')

console.log('MCP preset catalog tests passed')
