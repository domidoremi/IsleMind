#!/usr/bin/env node
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { parse } = require('@babel/parser')
const { prepareAnimalIslandUi, linkAnimalIslandUiRuntimes, sharedRuntimes, pairedUiRevision } = require('./prepare-animal-island-ui')
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
  assert.deepEqual(manifest.workspaces.packages, ['../animal-island-ui'])
  assert.deepEqual(manifest.workspaces.selfContained, ['animal-island-ui-rn'], 'the outside-root workspace must resolve dependencies during prepare, before host postinstall links runtimes')
  assert.equal(fs.realpathSync(fork), fs.realpathSync(path.resolve(root, '../animal-island-ui')))
  assert.equal(forkManifest['react-native'], 'src/index.ts')
  assert.equal(forkManifest.exports['.'].browser, './src/index.ts')
  assert.equal(forkManifest.exports['./theme']['react-native'], './src/theme/index.ts')
})

check('workspace lock retains the native dependency maps and exact dayjs integrity', () => {
  const lock = require('json5').parse(read('bun.lock'))
  const workspace = lock.workspaces['../animal-island-ui']
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
    assert.deepEqual(workspace[group] ?? {}, forkManifest[group] ?? {}, group + ' must match the native manifest')
  }
  const npmLock = JSON.parse(readFork('package-lock.json'))
  const date = npmLock.packages['node_modules/dayjs']
  assert.ok(date?.version && date.integrity, 'the existing native lock supplies the date version and integrity')
  assert.deepEqual(lock.packages['animal-island-ui-rn/dayjs'], [
    `dayjs@${date.version}`, '', {}, date.integrity,
  ])
  const installed = require(require.resolve('dayjs/package.json', { paths: [fork] }))
  assert.equal(installed.version, date.version)
  // Matching metadata is not frozen-install acceptance: Bun also diffs workspace lifecycle hooks.
})

for (const name of ['Tag', 'Skeleton', 'Image', 'BackTop', 'Avatar', 'Badge', 'Calendar', 'CountUp', 'Rate', 'Upload']) {
  check(name + ' is a fork re-export, not a maintained local port', () => {
    const source = read('src/components/ui/isle/' + name + '.tsx')
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    assert.ok(ast.program.body.length > 0)
    assert.ok(ast.program.body.every((node) => node.type === 'ExportNamedDeclaration' && node.source?.value === 'animal-island-ui-rn'))
    assert.ok(read('src/components/ui/isle/index.ts').includes("export * from './" + name + "'"))
  })
}

check('all 40 upstream components have native exports, type/build coverage and colocated Jest cases', () => {
  const components = fs.readdirSync(path.join(fork, 'src/components'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(fork, 'src/components', entry.name, entry.name + '.tsx')))
    .map(entry => entry.name).sort()
  assert.equal(components.length, 40)
  const main = readFork('src/index.ts')
  const typecheck = readFork('tsconfig.json')
  const build = readFork('tsconfig.build.json')
  const jestConfig = require(path.join(fork, 'jest.config.js'))
  for (const name of components) {
    const directory = 'src/components/' + name
    assert.match(readFork(directory + '/' + name + '.tsx'), /from\s+['"]react-native['"]/)
    assert.ok(main.includes("from './components/" + name + "'"), name + ' export')
    assert.ok(typecheck.includes('"' + directory + '"'), name + ' typecheck')
    assert.ok(build.includes('"' + directory + '"'), name + ' build')
    assert.ok(jestConfig.testMatch.includes('<rootDir>/' + directory + '/*.test.tsx'), name + ' tests')
    assert.ok(fs.existsSync(path.join(fork, directory, name + '.test.tsx')), name + ' colocated test')
    assert.ok(fs.existsSync(path.join(fork, 'dist/components', name, name + '.d.ts')), name + ' built declaration')
  }
  assert.ok(build.includes('"src/**/*.test.tsx"'), 'test files are excluded from published JS')
})

check('the new native API types are available through the package and pure host aliases', () => {
  const types = {
    Avatar: ['AvatarProps', 'AvatarGroupProps', 'AvatarSize', 'AvatarShape'],
    Badge: ['BadgeProps', 'BadgeSize', 'BadgeColor'],
    Calendar: ['CalendarProps', 'CalendarEvent', 'CalendarColor'],
    CountUp: ['CountUpProps', 'CountUpRenderState', 'CountUpEasing', 'CountUpCompleteResult'],
    Rate: ['RateProps', 'RateSize'],
    Upload: ['UploadProps', 'UploadNativeFile', 'UploadFile', 'UploadPickerOptions', 'UploadCustomRequestOptions'],
  }
  for (const [name, names] of Object.entries(types)) {
    const source = read('src/components/ui/isle/' + name + '.tsx')
    for (const type of names) {
      assert.ok(readFork('src/index.ts').includes(type), type + ' package type')
      assert.ok(readFork('dist/index.d.ts').includes(type), type + ' built package type')
      assert.ok(source.includes(type + ' as Isle' + type), type + ' pure host alias')
    }
  }
})

check('bounded native API references preserve exact source declarations and self-contained links', () => {
  const references = {
    'native-profile.md': ['Avatar/Avatar.tsx', 'Badge/Badge.tsx'],
    'native-calendar.md': ['Calendar/monthGrid.ts', 'Calendar/Calendar.tsx'],
    'native-count-rate.md': ['CountUp/CountUp.tsx', 'Rate/Rate.tsx'],
    'native-upload.md': ['Upload/nativeFiles.ts', 'Upload/Upload.tsx'],
    'native-select.md': ['Select/Select.tsx'],
  }
  const directory = 'skills/animal-island-ui-style/references/components'
  for (const [file, sources] of Object.entries(references)) {
    const text = readFork(directory + '/' + file)
    assert.ok(text.split('\n').length <= 200, file + ' stays bounded')
    const declarations = new Map()
    for (const source of sources) {
      const content = readFork('src/components/' + source)
      const ast = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
      for (const node of ast.program.body) {
        if (node.type === 'ExportNamedDeclaration' && node.declaration?.id) {
          declarations.set(node.declaration.id.name, content.slice(node.start, node.end))
        }
      }
    }
    let count = 0
    for (const block of text.matchAll(/```ts\n([\s\S]*?)\n```/g)) {
      const code = block[1]
      const ast = parse(code, { sourceType: 'module', plugins: ['typescript'] })
      for (const node of ast.program.body) {
        assert.equal(node.type, 'ExportNamedDeclaration', file + ' native declaration')
        assert.equal(code.slice(node.start, node.end), declarations.get(node.declaration.id.name),
          file + ' verbatim ' + node.declaration.id.name)
        count++
      }
    }
    assert.ok(count > 0, file + ' has native declarations')
    for (const link of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
      assert.ok(fs.existsSync(path.resolve(fork, directory, link[1])), file + ' link ' + link[1])
    }
  }
})

check('dayjs is the existing library date dependency and the host lock includes its workspace edge', () => {
  assert.equal(forkManifest.dependencies.dayjs, '^1.11.23')
  const lock = parse('const lock = ' + read('bun.lock'), { sourceType: 'script' }).program.body[0].declarations[0].init
  assert.equal(lock.type, 'ObjectExpression', 'Bun text lock remains an object')
  const source = read('bun.lock')
  assert.ok(source.includes('"dayjs": "^1.11.23"'))
  assert.ok(source.includes('"animal-island-ui-rn/dayjs": ["dayjs@1.11.23"'), 'the self-contained workspace retains its installed date runtime')
  assert.equal(manifest.dependencies.dayjs, undefined, 'no duplicate application-owned date dependency')
})

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

check('native autolinking and the sibling compiler share the installed host runtimes', () => {
  for (const name of sharedRuntimes) {
    assert.equal(manifest.overrides[name], `$${name}`)
    assert.equal(fs.realpathSync(path.join(fork, 'node_modules', name)), fs.realpathSync(path.join(root, 'node_modules', name)))
  }
  const postinstall = manifest.scripts.postinstall
  assert.ok(postinstall.indexOf('--link-runtimes') >= 0 && postinstall.indexOf('--link-runtimes') < postinstall.indexOf('build:ui'))
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
  for (const file of ['src/components/settings/SystemSettingsPanelContent.tsx', 'src/components/settings/SettingsThemeAccentControl.tsx']) {
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
  for (const name of ['Button', 'Switch', 'Card', 'Modal', 'Progress', 'Select', 'Tooltip', 'Badge', 'CountUp', 'Rate', 'Loading', 'Drawer']) {
    const source = readFork('src/components/' + name + '/' + name + '.tsx')
    assert.ok(source.includes('useTheme'))
    assert.ok(source.includes('reducedMotion'))
  }
})

check('new native Upload fails closed and selection, cancellation and temporary URI ownership stay with the host', () => {
  const upload = readFork('src/components/Upload/Upload.tsx')
  const transport = readFork('src/components/Upload/transport.ts')
  for (const contract of ['!!onPickFiles', 'customRequest', 'controller.signal', 'snapshotNativeFile', 'identity(found) !== admittedIdentity']) assert.ok(upload.includes(contract), contract)
  assert.ok(upload.includes('selection alone is not an upload'))
  assert.ok(transport.includes('XMLHttpRequest'))
  assert.doesNotMatch(upload + transport, /revokeObjectURL|unlinkSync|deleteAsync|requestPermissionsAsync/)
})
check('install builds declarations and release freshness includes the fork', () => {
  assert.ok(manifest.scripts.postinstall.includes('build:ui'))
  assert.ok(manifest.scripts['build:ui'].includes('--cwd ../animal-island-ui build'))
  assert.equal(manifest.scripts['eas-build-pre-install'], 'node scripts/prepare-animal-island-ui.js')
  for (const workflow of ['architecture-gates', 'runner-android-apk', 'release-android-apk', 'eas-android-apk']) {
    const source = read('.github/workflows/' + workflow + '.yml')
    const prepare = source.indexOf('node scripts/prepare-animal-island-ui.js')
    assert.ok(prepare >= 0 && prepare < source.indexOf('bun install --frozen-lockfile'))
    assert.ok(source.includes('ANIMAL_ISLAND_UI_REF: ${{ vars.ANIMAL_ISLAND_UI_REF }}'), 'each runner must pass the optional paired UI revision override')
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
    let dirty = ''
    const git = (executable, args) => {
      assert.equal(executable, 'git')
      assert.deepEqual(args.slice(0, 2), ['-C', sibling])
      if (args[2] === 'status') { assert.deepEqual(args.slice(2), ['status', '--porcelain', '--untracked-files=all']); return dirty }
      assert.deepEqual(args.slice(2), ['rev-parse', 'HEAD'])
      return 'a'.repeat(40)
    }
    assert.throws(() => prepareAnimalIslandUi({ root: app, ref: '', git }), /Use the rn branch/)
    fs.writeFileSync(manifestPath, JSON.stringify(forkManifest))
    assert.equal(prepareAnimalIslandUi({ root: app, ref: '', git }), sibling)
    assert.equal(prepareAnimalIslandUi({ root: app, ref: 'a'.repeat(40), git }), sibling)
    const previousRef = process.env.ANIMAL_ISLAND_UI_REF
    try {
      delete process.env.ANIMAL_ISLAND_UI_REF
      assert.match(pairedUiRevision, /^[a-f0-9]{40}$/)
      const pinnedGit = (_executable, args) => args.includes('rev-parse') ? pairedUiRevision : ''
      assert.equal(prepareAnimalIslandUi({ root: app, git: pinnedGit }), sibling, 'CI/EAS use the saved pair without external variable configuration')
      assert.throws(() => prepareAnimalIslandUi({ root: app, git }), /left untouched/, 'default pin also checks an existing checkout')
      process.env.ANIMAL_ISLAND_UI_REF = 'a'.repeat(40)
      assert.equal(prepareAnimalIslandUi({ root: app, git }), sibling, 'explicit full-SHA overrides remain supported')
    } finally {
      if (previousRef === undefined) delete process.env.ANIMAL_ISLAND_UI_REF
      else process.env.ANIMAL_ISLAND_UI_REF = previousRef
    }
    for (const status of [' M src/index.ts', '?? src/new.ts']) {
      dirty = status
      assert.throws(() => prepareAnimalIslandUi({ root: app, ref: 'a'.repeat(40), git }), /matching HEAD alone/)
      assert.equal(prepareAnimalIslandUi({ root: app, ref: '', git }), sibling, 'uncommitted local development remains supported without claiming a pinned build')
    }
    assert.throws(() => prepareAnimalIslandUi({ root: app, ref: 'b'.repeat(40), git }), /left untouched/)
    assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)), forkManifest)
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('islemind-ui-contract-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

check('new workspaces require a full ref before any network or filesystem effect', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-ui-pinning-'))
  try {
    const app = path.join(temp, 'app')
    const sibling = path.join(temp, 'animal-island-ui')
    fs.mkdirSync(app)
    const git = () => { throw new Error('No git call is allowed for an unpinned checkout') }
    assert.throws(() => prepareAnimalIslandUi({ root: app, ref: '', git }), /is required/)
    for (const ref of ['rn', 'main', 'a'.repeat(7), '--upload-pack=unexpected']) {
      assert.throws(() => prepareAnimalIslandUi({ root: app, ref, git }), /full commit SHA/)
    }
    assert.equal(fs.existsSync(sibling), false)
    const ref = 'c'.repeat(40)
    const calls = []
    const pinnedGit = (executable, args) => {
      assert.equal(executable, 'git')
      calls.push(args)
      if (args[0] === 'clone') {
        assert.equal(args.at(-1), sibling)
        fs.mkdirSync(sibling)
        fs.writeFileSync(path.join(sibling, 'package.json'), JSON.stringify(forkManifest))
      }
      return args.includes('rev-parse') ? ref : ''
    }
    assert.equal(prepareAnimalIslandUi({ root: app, ref, git: pinnedGit }), sibling)
    assert.deepEqual(calls.slice(1), [
      ['-C', sibling, 'fetch', '--depth=1', 'origin', ref],
      ['-C', sibling, 'checkout', '--detach', 'FETCH_HEAD'],
      ['-C', sibling, 'rev-parse', 'HEAD'],
      ['-C', sibling, 'status', '--porcelain', '--untracked-files=all'],
    ])
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('islemind-ui-pinning-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

check('runtime linking is idempotent, preserves sources and rejects unsafe replacements', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-ui-contract-'))
  const app = path.join(temp, 'app')
  const sibling = path.join(temp, 'animal-island-ui')
  try {
    fs.mkdirSync(app)
    fs.mkdirSync(sibling)
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest))
    fs.writeFileSync(path.join(sibling, 'package.json'), JSON.stringify(forkManifest))
    fs.writeFileSync(path.join(sibling, 'source.ts'), 'keep developer source')
    for (const name of sharedRuntimes) {
      for (const base of [app, sibling]) {
        const directory = path.join(base, 'node_modules', name)
        fs.mkdirSync(directory, { recursive: true })
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: base === app ? manifest.dependencies[name] : '0.0.0' }))
      }
    }
    const lastManifest = path.join(sibling, 'node_modules/react-native-svg/package.json')
    const lastSource = fs.readFileSync(lastManifest, 'utf8')
    fs.writeFileSync(lastManifest, JSON.stringify({ name: 'not-a-generated-runtime' }))
    assert.throws(() => linkAnimalIslandUiRuntimes({ root: app }), /non-package directory/)
    assert.equal(JSON.parse(fs.readFileSync(path.join(sibling, 'node_modules/react/package.json'))).version, '0.0.0', 'Validation must precede every replacement.')
    fs.writeFileSync(lastManifest, lastSource)
    linkAnimalIslandUiRuntimes({ root: app })
    linkAnimalIslandUiRuntimes({ root: app })
    for (const name of sharedRuntimes) {
      assert.equal(fs.realpathSync(path.join(sibling, 'node_modules', name)), fs.realpathSync(path.join(app, 'node_modules', name)))
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(sibling, 'package.json'))), forkManifest)
    assert.equal(fs.readFileSync(path.join(sibling, 'source.ts'), 'utf8'), 'keep developer source')

    // A package link may be replaced, but its previous target must survive.
    const runtime = path.join(sibling, 'node_modules/react')
    fs.rmSync(runtime, { recursive: true, force: true })
    const unrelated = path.join(temp, 'unrelated')
    fs.mkdirSync(unrelated)
    fs.writeFileSync(path.join(unrelated, 'keep.txt'), 'keep')
    fs.symlinkSync(unrelated, runtime, process.platform === 'win32' ? 'junction' : 'dir')
    linkAnimalIslandUiRuntimes({ root: app })
    assert.equal(fs.readFileSync(path.join(unrelated, 'keep.txt'), 'utf8'), 'keep')
    fs.renameSync(path.join(sibling, 'node_modules'), path.join(sibling, 'installed'))
    fs.symlinkSync(unrelated, path.join(sibling, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    assert.throws(() => linkAnimalIslandUiRuntimes({ root: app }), /linked node_modules/)
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temp).startsWith('islemind-ui-contract-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
})

for (const item of checks) console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name + (item.detail ? ': ' + item.detail : ''))
if (checks.some((item) => !item.ok)) process.exit(1)
console.log('isle ui fork integration passed: ' + checks.length + ' checks')
