#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parse } = require('@babel/parser')
const { prepareAnimalIslandUi } = require('./prepare-animal-island-ui')
const { collectReleaseInputFiles } = require('./release-freshness-contract')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const manifest = JSON.parse(read('package.json'))
const fork = path.dirname(require.resolve('animal-island-ui-rn/package.json'))
const forkManifest = require(path.join(fork, 'package.json'))
const readFork = (file) => fs.readFileSync(path.join(fork, file), 'utf8')
const checks = []
function check(name, run) {
  try { run(); checks.push({ name, ok: true }) } catch (error) { checks.push({ name, ok: false, detail: error.message }) }
}

check('workspace resolves directly to the sibling RN fork', () => {
  assert.equal(manifest.dependencies['animal-island-ui-rn'], 'workspace:*')
  assert.ok(manifest.workspaces.includes('../animal-island-ui'))
  assert.equal(fs.realpathSync(fork), fs.realpathSync(path.resolve(root, '../animal-island-ui')))
  assert.equal(forkManifest['react-native'], 'src/index.ts')
  assert.equal(forkManifest.exports['.'].browser, './src/index.ts')
  assert.equal(forkManifest.exports['./theme']['react-native'], './src/theme/index.ts')
})

for (const name of ['Tag', 'Skeleton', 'Image', 'BackTop']) {
  check(name + ' is a fork re-export, not a maintained local port', () => {
    const source = read('src/components/ui/isle/' + name + '.tsx')
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    assert.ok(ast.program.body.length > 0)
    assert.ok(ast.program.body.every((node) => node.type === 'ExportNamedDeclaration' && node.source?.value === 'animal-island-ui-rn'))
    assert.ok(read('src/components/ui/isle/index.ts').includes("export * from './" + name + "'"))
  })
}

check('customized application controls dispatch to the fork', () => {
  const kit = read('src/components/ui/isle/IsleKit.tsx')
  for (const name of ['Button', 'Input', 'Switch', 'Card', 'Select', 'Progress']) assert.ok(kit.includes('<Native' + name + ' '))
  for (const name of ['Title', 'Collapse', 'Modal', 'Table', 'Time', 'Checkbox', 'Tabs']) {
    assert.ok(kit.includes(name + ' as Isle' + name))
    assert.ok(!kit.includes('export function Isle' + name + '('))
  }
  assert.ok(read('src/components/ui/isle/IsleThemeProvider.tsx').includes('ThemeProvider mode={mode} accent={themeAccent} reducedMotion='))
  assert.ok(read('src/theme/themeTokens.ts').includes("from 'animal-island-ui-rn/theme'"))
  assert.ok(read('src/components/ui/isle/Dialog.tsx').includes('<NativeModal'))
})

check('Metro shares host runtimes and preserves platform resolution', () => {
  const config = require('../metro.config')
  assert.ok(config.watchFolders.some((folder) => fs.realpathSync(folder) === fs.realpathSync(fork)))
  for (const platform of ['android', 'ios', 'web']) {
    for (const name of ['react', 'react/jsx-runtime', 'react-native', 'react-native/Libraries/Utilities/Platform', 'react-native-svg']) {
      let received
      const resolution = { type: 'sourceFile', filePath: 'host-runtime' }
      const context = { originModulePath: path.join(fork, 'src/index.ts'), resolveRequest: (...args) => { received = args; return resolution } }
      assert.equal(config.resolver.resolveRequest(context, name, platform), resolution)
      assert.equal(received[0].originModulePath, path.join(root, 'node_modules/expo/package.json'))
      assert.equal(received[1], name)
      assert.equal(received[2], platform)
    }
  }
  // Expo skips declaration aliases, never execute @types/react.
  assert.ok(JSON.parse(read('tsconfig.json')).compilerOptions.paths.react.every((target) => target.endsWith('.d.ts')))
})

check('theme transition rendering belongs to the fork, not a duplicate app port', () => {
  assert.ok(readFork('src/index.ts').includes('ThemeTransitionProvider, useThemeTransition'))
  assert.ok(read('src/components/ui/isle/IsleThemeProvider.tsx').includes('<ThemeTransitionProvider reducedMotion='))
  const selection = read('src/hooks/useThemeSelection.ts')
  assert.ok(selection.includes("import { useThemeTransition } from 'animal-island-ui-rn'"))
  assert.ok(selection.includes('useSettingsStore.getState().updateSettings(selection)'))
  assert.doesNotMatch(selection, /startViewTransition|Animated\.timing/, 'app owns selection/scroll intent, not transition rendering')
})

check('custom settings radios share the fork keyboard group without a local implementation', () => {
  assert.ok(readFork('src/components/Radio/Radio.tsx').includes('<RadioGroup'))
  const group = readFork('src/components/Radio/RadioGroup.tsx')
  assert.ok(group.includes("Platform.OS === 'web'"))
  assert.ok(group.includes('accessible={false}'))
  for (const file of ['src/components/main/SettingsScreenContent.tsx', 'src/components/settings/SettingsThemeAccentControl.tsx']) {
    const source = read(file)
    assert.ok(source.includes("import { RadioGroup } from 'animal-island-ui-rn'"))
    assert.ok(source.includes('<RadioGroup'))
    assert.doesNotMatch(source, /addEventListener\(['"]keydown|querySelectorAll\(['"]\[role/, 'radio DOM navigation belongs to the fork')
  }
})

check('library owns native overlay safety, disabled options and motion', () => {
  const modal = readFork('src/components/Modal/Modal.tsx')
  for (const value of ['onRequestClose={onClose}', 'accessibilityViewIsModal', '<ScrollView', 'keyboardShouldPersistTaps="handled"', 'contentInsets']) assert.ok(modal.includes(value), value)
  assert.ok(readFork('src/components/Input/Input.tsx').includes('inputRef'))
  assert.ok(readFork('src/components/Select/Select.tsx').includes('disabled={option.disabled}'))
  for (const name of ['Button', 'Switch', 'Card', 'Modal', 'Progress', 'Select', 'Tooltip']) {
    const source = readFork('src/components/' + name + '/' + name + '.tsx')
    assert.ok(source.includes('useTheme'))
    assert.ok(source.includes('reducedMotion'))
  }
})

check('install builds declarations and release freshness includes the fork', () => {
  assert.ok(manifest.scripts.postinstall.includes('build:ui'))
  assert.ok(manifest.scripts['build:ui'].includes('--cwd ../animal-island-ui build'))
  assert.equal(manifest.scripts['eas-build-pre-install'], 'node scripts/prepare-animal-island-ui.js')
  for (const workflow of ['architecture-gates', 'runner-android-apk', 'release-android-apk', 'eas-android-apk']) {
    const source = read('.github/workflows/' + workflow + '.yml')
    const prepare = source.indexOf('node scripts/prepare-animal-island-ui.js')
    assert.ok(prepare >= 0 && prepare < source.indexOf('bun install --frozen-lockfile'))
  }
  assert.ok(collectReleaseInputFiles(root).includes(path.resolve(fork, 'src/components/Button/Button.tsx')))
})

check('CI bootstrap preserves existing work and rejects the Web branch', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-ui-contract-'))
  const app = path.join(temp, 'app')
  const sibling = path.join(temp, 'animal-island-ui')
  try {
    fs.mkdirSync(app)
    fs.mkdirSync(sibling)
    const manifestPath = path.join(sibling, 'package.json')
    fs.writeFileSync(manifestPath, JSON.stringify({ name: 'animal-island-ui' }))
    const git = (...args) => { assert.deepEqual(args.slice(0, 2), ['git', ['-C', sibling, 'rev-parse', 'HEAD']]); return 'a'.repeat(40) }
    assert.throws(() => prepareAnimalIslandUi({ root: app, git }), /Use the rn branch/)
    fs.writeFileSync(manifestPath, JSON.stringify(forkManifest))
    assert.equal(prepareAnimalIslandUi({ root: app, git }), sibling)
    assert.throws(() => prepareAnimalIslandUi({ root: app, ref: 'b'.repeat(40), git }), /left untouched/)
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)), forkManifest)
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('islemind-ui-contract-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

for (const item of checks) console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name + (item.detail ? ': ' + item.detail : ''))
if (checks.some((item) => !item.ok)) process.exit(1)
console.log('isle ui fork integration passed: ' + checks.length + ' checks')
