const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

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
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
})
const moduleRef = { exports: {} }
new Function('require', 'module', 'exports', transpiled.outputText)(require, moduleRef, moduleRef.exports)

const presets = moduleRef.exports.listMcpRemotePresets()
assert.deepEqual(presets.map((preset) => preset.id), ['context7', 'microsoft-learn'])
assert.equal(new Set(presets.map((preset) => preset.url)).size, presets.length, 'preset endpoints are unique')

for (const preset of presets) {
  const endpoint = new URL(preset.url)
  assert.equal(endpoint.protocol, 'https:', `${preset.id} uses public HTTPS`)
  assert.equal(preset.transport, 'streamable-http', `${preset.id} is mobile-compatible remote HTTP`)
  assert.equal(preset.protocolPreference, 'latest-with-legacy-fallback', `${preset.id} prefers current MCP`)
  assert.equal(preset.enabledOnInstall, true, `${preset.id} connects immediately after installation`)
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
assert.match(settingsSource, /approvedToolNames:\s*\[\]/, 'preset installation never auto-approves tools')
assert.match(
  settingsSource,
  /const connected = await refreshMcpManifest\(server\)/,
  'preset installation immediately performs manifest discovery',
)
assert.match(
  settingsSource,
  /transport:\s*preset\.transport/,
  'preset installation preserves the catalog transport policy',
)
assert.match(settingsSource, /const enabledSurface = '#198754'/, 'enabled MCP tiles use the accessible green authority surface')
assert.match(settingsSource, /isDark \? colors\.ui\.semantic\.surface\.base : '#FFFFFF'/, 'disabled MCP tiles stay white in the default light theme')
assert.match(settingsSource, /isDark \? colors\.text : '#111111'/, 'disabled MCP tiles keep near-black text in the default light theme')
assert.match(settingsSource, /aspectRatio: 1/, 'MCP server controls render as stable square tiles')
assert.match(settingsSource, /accessibilityRole="switch"[\s\S]*?accessibilityState=\{\{ checked: server\.enabled, disabled: pending \}\}/, 'the full MCP tile is an accessible binary control and locks while persistence is pending')
assert.match(settingsSource, /onOpenDetails=\{\(serverId\) => \{[\s\S]*?setSelectedServerId\(serverId\)[\s\S]*?setManagementOpen\(true\)/, 'MCP detail access stays separate from the tile toggle')
assert.doesNotMatch(settingsSource, /<SettingsSummaryStrip/, 'MCP primary settings no longer duplicates the catalog as a summary dashboard')

const detached = moduleRef.exports.listMcpRemotePresets()
detached[0].name = 'changed by caller'
assert.equal(moduleRef.exports.getMcpRemotePreset('context7').name, 'Context7', 'catalog reads are detached')

console.log('MCP preset catalog tests passed')
