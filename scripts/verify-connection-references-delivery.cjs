const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const evidence = path.resolve(root, process.argv[2] || 'test-evidence/qa/islemind-connection-references-20261106')
assert(evidence.startsWith(root + path.sep))
const outName = process.argv[3] || 'delivery-verification.json'
assert(/^delivery-verification(?:-[a-z0-9-]+)?\.json$/.test(outName))
const out = path.join(evidence, outName)
assert(!fs.existsSync(out), 'Preserve previous delivery verification')
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const local = relative => {
  const file = path.resolve(evidence, relative)
  assert(file.startsWith(evidence + path.sep)); return file
}
const receipt = { schema: 'islemind.connection-references-delivery.v1', verifiedAt: new Date().toISOString(), pass: false, errors: [] }
function sourceFiles(base) {
  const files = []
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(base, directory), { withFileTypes: true })) {
      const relative = path.join(directory, entry.name).replaceAll('\\', '/')
      if (entry.isDirectory()) walk(relative)
      else if (/\.(?:ts|tsx|js|json|css)$/.test(relative) && !/\.(?:test|spec)\.[^.]+$/.test(relative)) files.push(relative)
    }
  }
  walk('app'); walk('src'); return files.sort()
}
function exportHash(base) {
  const digest = crypto.createHash('sha256')
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else digest.update(path.relative(base, file)).update('\0').update(fs.readFileSync(file)).update('\0')
    }
  }
  walk(base); return digest.digest('hex')
}
try {
  const build = json(local('native-refresh-i5/build-after.json'))
  const native = json(local('native-i5-r3/results.json')), web = json(local('views-i5/results.json'))
  const gates = json(local('gates-i5/results.json')), focused = json(local('final-tests-i5.json'))
  const atlas = json(local('atlas-manifest.json')), visual = json(local('atlas-verification.json'))
  assert(native.pass && native.errors.length === 0 && web.passed && web.errors.length === 0)
  assert(native.liveProviderRequests === 0 && web.liveProviderRequests === 0 && native.realCapabilityExecutions === 0)
  assert.equal(build.package, 'com.islemind.stage9'); assert.equal(build.profile, 'offline'); assert.equal(path.resolve(build.source), root)
  assert.equal(hash(build.apk), build.apkSha256); assert.equal(native.apkSha256, build.apkSha256)
  const resumed = json(local('resume-no-build-i5-r3.json'))
  assert.equal(resumed.apkSha256, build.apkSha256)
  assert.equal(resumed.buildRun, false); assert.equal(resumed.installRequired, false)
  assert(!native.installedIsolatedPackage && !native.updatedIsolatedPackage)
  const currentPackage = json(path.join(root, 'package.json'))
  const currentApp = json(path.join(root, 'app.json'))
  const qualificationApp = json(path.join(build.stage, 'app.json'))
  assert.equal(hash(local(resumed.existingApkManifest.file)), resumed.existingApkManifest.sha256)
  const apkManifest = fs.readFileSync(local(resumed.existingApkManifest.file), 'utf8')
  assert(apkManifest.includes(`android:versionName(0x0101021c)="${resumed.appVersionInExistingBuild}"`))
  assert.equal(currentPackage.version, currentApp.expo.version)
  assert.equal(currentPackage.version, resumed.currentSourceVersion)
  assert.equal(qualificationApp.expo.version, resumed.appVersionInExistingBuild)
  receipt.qualification = {
    currentSourceVersion: currentPackage.version, existingPackageVersion: qualificationApp.expo.version,
    newBuildOrInstall: false, productionRelease: false,
    scope: resumed.qualificationScope,
    resumeSourceBinding: { file: 'resume-no-build-i5-r3.json', sha256: hash(local('resume-no-build-i5-r3.json')) },
  }
  assert.deepEqual(native.productionBefore, native.productionAfter); assert.deepEqual(native.osBefore, native.osAfter)
  assert(native.guide.models.length === 3 && native.guide.models.every(chapter => chapter.references))
  assert(gates.pass && gates.gates.every(entry => entry.exitCode === 0) && focused.success)
  assert.equal(focused.numPassedTestSuites, 25); assert.equal(focused.numPassedTests, 219)
  const testSources = json(local('test-source-i5.json'))
  assert.equal(hash(local(testSources.results.file)), testSources.results.sha256)
  for (const entry of testSources.files) assert.equal(hash(path.join(root, entry.file)), entry.sha256)
  assert.deepEqual(native.historyMutations, { create: 'one-record', localGuide: 'one-record', delete: 'one-record', savedCount: 81, historicalMessageBytesUnchanged: true })
  const sqlite = fs.readFileSync(local('sqlite-i2.log'), 'utf8')
  const session = fs.readFileSync(local('chat-session-i5.log'), 'utf8')
  assert(/7 pass/.test(sqlite) && /0 fail/.test(sqlite) && /39 expect\(\) calls/.test(sqlite))
  assert(session.includes('Chat session tests passed'))
  const combinations = new Set(web.pages.map(entry => `${entry.family}/${entry.mode}/${entry.width}`))
  assert.equal(web.pages.length, 290); assert.equal(web.checks.length, 170)
  assert.equal(native.pages.length, 73); assert.equal(native.checks.length, 8)
  for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) for (const mode of ['light', 'dark']) for (const width of [320, 390, 960]) {
    assert(combinations.has(`${family}/${mode}/${width}`))
    assert(web.checks.some(entry => entry.family === family && entry.mode === mode && entry.width === width && entry.check === 'no page errors or external requests'))
    assert(web.pages.some(entry => entry.family === family && entry.mode === mode && entry.width === width && entry.view === 'older-conversation'))
  }
  assert.equal(combinations.size, 30)
  for (const family of ['minimal', 'monet', 'material', 'liquid-glass', 'animal-island-ui']) for (const mode of ['light', 'dark']) {
    assert(native.pages.some(entry => entry.family === family && entry.mode === mode && entry.screen === 'older-conversation'))
  }
  assert(visual.pass && visual.errors.length === 0)
  assert.equal(visual.indexSha256, hash(local('index.html'))); assert.equal(visual.manifestSha256, hash(local('atlas-manifest.json')))
  receipt.tests = { focusedSuites: focused.numPassedTestSuites, focusedPassed: focused.numPassedTests,
    sourceBinding: { file: 'test-source-i5.json', sha256: hash(local('test-source-i5.json')), files: testSources.files.length },
    gateCommands: gates.gates.length, sqlite: { log: 'sqlite-i2.log', sha256: hash(local('sqlite-i2.log')), passed: 7, assertions: 39 },
    session: { log: 'chat-session-i5.log', sha256: hash(local('chat-session-i5.log')) } }
  const files = sourceFiles(root)
  assert.deepEqual(files, sourceFiles(build.stage))
  const refresh = json(build.sourceRefresh)
  const preserved = refresh.preserved.map(entry => entry.file)
  assert.deepEqual(preserved.sort(), ['src/bootstrap/knowledgeEmbeddingProvider.ts', 'src/hooks/useBootstrap.ts', 'src/platform/storage/expoSqliteDatabase.ts'].sort())
  for (const entry of refresh.sourceFiles) {
    assert.equal(hash(path.join(root, entry.file)), entry.sha256, `Current source changed: ${entry.file}`)
    assert.equal(hash(path.join(build.stage, entry.file)), entry.sha256)
  }
  for (const entry of refresh.preserved) {
    assert.equal(hash(path.join(root, entry.file)), entry.sourceSha256)
    assert.equal(hash(path.join(build.stage, entry.file)), entry.sha256)
  }
  for (const entry of refresh.buildInputs) {
    assert.equal(hash(path.join(root, entry.file)), entry.sha256)
    assert.equal(hash(path.join(build.stage, entry.file)), entry.sha256)
  }
  assert.equal(build.uiSource.root, fs.realpathSync(path.join(root, 'node_modules/animal-island-ui-rn')))
  assert.equal(hash(path.join(build.uiSource.root, 'package.json')), build.uiSource.packageSha256)
  for (const entry of build.uiSource.files) assert.equal(hash(path.join(build.uiSource.root, entry.file)), entry.sha256)
  receipt.sources = { files: files.length, guideInputs: refresh.buildInputs.length, uiFiles: build.uiSource.files.length,
    recordedQualificationDifferences: refresh.preserved, nativeApkSha256: build.apkSha256 }
  const fixtureFile = local('fixture-i1/manifest.json')
  const fixture = json(fixtureFile)
  assert(fixture.synthetic && !fixture.externalServicesUsed && fixture.conversations.length === 81)
  assert.equal(web.fixtureSha256, hash(fixtureFile))
  receipt.fixture = { file: 'fixture-i1/manifest.json', sha256: hash(fixtureFile), conversations: 81 }
  const reviewed = json(local('visual-review-i5.json'))
  assert(reviewed.screenshots.length > 0 && reviewed.nativeReview.status === 'complete' && reviewed.nativeReview.screenshots.length > 0,
    'Both representative Web and actual native screenshot review must be complete')
  for (const entry of reviewed.screenshots) assert.equal(hash(local(entry.file)), entry.sha256)
  for (const entry of reviewed.nativeReview.screenshots) assert.equal(hash(local(entry.file)), entry.sha256)
  receipt.visualReview = { file: 'visual-review-i5.json', sha256: hash(local('visual-review-i5.json')), screenshots: reviewed.screenshots.length,
    nativeScreenshots: reviewed.nativeReview.screenshots.length, scope: reviewed.scope, nativeScope: reviewed.nativeReview.scope }
  receipt.webExportSha256 = exportHash(local('web-i5'))
  assert.equal(web.exportHash, receipt.webExportSha256); assert.equal(atlas.webExportSha256, receipt.webExportSha256)
  assert.equal(atlas.nativeApkSha256, native.apkSha256)
  const home = json(path.join(root, 'test-evidence/qa/islemind-upgrade-20261106/home-reference-source.json'))
  assert(home.length === 6)
  receipt.home = home.map(entry => { assert.equal(hash(path.join(root, entry.file)), entry.sha256); return { ...entry, unchanged: true } })
  for (const entry of atlas.screenshots) assert.equal(hash(local(entry.file)), entry.sha256)
  assert.equal(atlas.screenshots.length, visual.screenshotHashes)
  receipt.screenshots = atlas.screenshots.length
  receipt.web = { combinations: combinations.size, screenshots: web.pages.length, checks: web.checks.length }
  receipt.android = { screenshots: native.pages.length, checks: native.checks.length, package: native.package,
    productionInstallationUnchanged: true, osPreferencesUnchanged: true }
  const documents = ['docs/release/connection-references-implementation-2026-11-06.md', 'docs/release/islemind-upgrade-2026-11-06.md',
    'docs/plans/islemind-upgrade-2026-11-06.md', 'docs/design/connection-references-2026-11-06.md',
    'docs/architecture/module-public-api.md', 'docs/README.md',
    'docs/user-guide/zh-CN/models.md', 'docs/user-guide/en/models.md', 'docs/user-guide/ja/models.md']
  const links = []
  for (const relative of documents) {
    const file = path.join(root, relative)
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].trim().replace(/^<|>$/g, '')
      if (/^(?:[a-z]+:|#)/i.test(link)) continue
      const target = path.resolve(path.dirname(file), decodeURIComponent(link.split('#')[0]))
      assert(target.startsWith(root + path.sep))
      assert(target === out || fs.existsSync(target), `Missing document link: ${relative} ${link}`)
      links.push({ file: relative, link })
    }
  }
  receipt.documents = { files: documents.map(file => ({ file, sha256: hash(path.join(root, file)) })), links }
  receipt.verifiers = ['scripts/connection-references-web-tests.cjs', 'scripts/collect-connection-references-native-evidence.cjs',
    'scripts/native-connection-references-evidence.ts', 'scripts/native-scene-qualification-host.cjs',
    'scripts/verify-connection-references-gates.cjs', 'scripts/connection-references-atlas.cjs',
    'scripts/verify-connection-references-atlas.cjs', 'scripts/verify-connection-references-delivery.cjs']
    .map(file => ({ file, sha256: hash(path.join(root, file)) }))
  receipt.pass = true
} catch (error) { receipt.errors.push({ message: error.message, stack: error.stack }); process.exitCode = 1 }
finally {
  fs.writeFileSync(out, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ pass: receipt.pass, sources: receipt.sources?.files, screenshots: receipt.screenshots, home: receipt.home?.length,
    documentLinks: receipt.documents?.links.length, errors: receipt.errors }))
}
