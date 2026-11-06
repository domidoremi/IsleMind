const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const evidence = path.resolve(root, option('--evidence-root', 'test-evidence/qa/islemind-scene-plans-20261106'))
assert(evidence.startsWith(root + path.sep))
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const out = path.join(evidence, option('--out', 'delivery-source-verification.json'))
assert(out.startsWith(evidence + path.sep))
if (fs.existsSync(out)) {
  assert(args.includes('--refresh') && json(out).schema === 'islemind.scene-plans-delivery-verification.v1',
    'Preserve earlier verification unless explicitly refreshing the known delivery record')
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const local = file => {
  const absolute = path.resolve(evidence, file)
  assert(absolute.startsWith(evidence + path.sep))
  return absolute
}
const buildFile = option('--build', 'native-refresh-h6/build-after.json')
const nativeFile = option('--native', 'native-h6/results.json')
const webDirectory = option('--web-root', 'web-h6')
const documents = [
  'docs/release/scene-plans-implementation-2026-11-06.md',
  'docs/release/islemind-upgrade-2026-11-06.md',
  'docs/README.md',
  'docs/plans/islemind-upgrade-2026-11-06.md',
  'docs/design/scene-plans-2026-11-06.md',
  'docs/architecture/architecture.md',
  'docs/architecture/module-public-api.md',
  'docs/user-guide/zh-CN/models.md',
  'docs/user-guide/en/models.md',
  'docs/user-guide/ja/models.md',
]
const receipt = { schema: 'islemind.scene-plans-delivery-verification.v1', verifiedAt: new Date().toISOString(),
  pass: false, buildReceipt: buildFile, nativeEvidence: nativeFile, webDirectory, errors: [] }

try {
  const build = json(local(buildFile)), native = json(local(nativeFile))
  const scenes = json(local('views-h6/results.json')), routes = json(local('routes-h6/results.json'))
  const atlas = json(local('atlas-manifest.json')), atlasVerification = json(local('atlas-verification.json'))
  assert.equal(path.resolve(build.source), root)
  assert.equal(build.package, 'com.islemind.stage9')
  assert.equal(build.profile, 'offline')
  assert(native.pass && native.errors.length === 0 && native.liveProviderRequests === 0 && native.realCapabilityExecutions === 0)
  assert.deepEqual(native.productionBefore, native.productionAfter)
  assert.deepEqual(native.osBefore, native.osAfter)
  assert.equal(hash(build.apk), build.apkSha256)
  assert.equal(native.apkSha256, build.apkSha256)
  assert.equal(native.guide.models.length, 3)
  assert(native.guide.models.every(chapter => chapter.sceneAnchor && chapter.characters > 0))
  assert(native.nativeTargetChoice.clickable && native.nativeTargetChoice.enabled && native.nativeTargetChoice.focusable === 'true')
  assert.equal(atlas.nativeApkSha256, build.apkSha256)
  assert(atlasVerification.pass && atlasVerification.errors.length === 0)
  assert.equal(atlasVerification.indexSha256, hash(local('index.html')))
  assert.equal(atlasVerification.manifestSha256, hash(local('atlas-manifest.json')))
  receipt.nativeApkSha256 = build.apkSha256

  function sources(base) {
    const entries = []
    function walk(directory) {
      for (const entry of fs.readdirSync(path.join(base, directory), { withFileTypes: true })) {
        const relative = path.join(directory, entry.name).replaceAll('\\', '/')
        if (entry.isDirectory()) walk(relative)
        else if (/\.(?:ts|tsx|js|json|css)$/.test(entry.name) && !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) entries.push(relative)
      }
    }
    walk('app'); walk('src')
    return entries.sort()
  }
  const sourceFiles = sources(root), stagedFiles = sources(build.stage)
  assert.deepEqual(stagedFiles, sourceFiles, 'Staged app/src includes exactly the current non-test source files')
  const refresh = json(build.sourceRefresh)
  assert.equal(path.resolve(refresh.stage), path.resolve(build.stage))
  assert.equal(path.resolve(refresh.source), root)
  const preserved = ['src/bootstrap/knowledgeEmbeddingProvider.ts', 'src/hooks/useBootstrap.ts', 'src/platform/storage/expoSqliteDatabase.ts']
  assert.deepEqual(refresh.preserved.map(entry => entry.file).sort(), [...preserved].sort())
  for (const entry of refresh.sourceFiles) {
    assert.equal(hash(path.join(root, entry.file)), entry.sha256, `Recorded source changed: ${entry.file}`)
    assert.equal(hash(path.join(build.stage, entry.file)), entry.sha256)
  }
  assert(refresh.buildInputs?.length > 0, 'Offline guide inputs must be recorded')
  for (const entry of refresh.buildInputs) {
    assert.equal(hash(path.join(root, entry.file)), entry.sha256, `Recorded guide input changed: ${entry.file}`)
    assert.equal(hash(path.join(build.stage, entry.file)), entry.sha256)
  }
  receipt.guideBuildInputs = { files: refresh.buildInputs.length, sourceRefresh: build.sourceRefresh }
  assert.equal(build.uiSource.root, fs.realpathSync(path.join(root, 'node_modules/animal-island-ui-rn')))
  assert.equal(hash(path.join(build.uiSource.root, 'package.json')), build.uiSource.packageSha256)
  for (const entry of build.uiSource.files) assert.equal(hash(path.join(build.uiSource.root, entry.file)), entry.sha256)
  assert.equal(hash(build.bundleFreshnessPolicy.file), build.bundleFreshnessPolicy.sha256)
  receipt.nativeUiSource = { root: build.uiSource.root, files: build.uiSource.files.length,
    packageSha256: build.uiSource.packageSha256, bundleFreshnessPolicy: build.bundleFreshnessPolicy }
  const uiConsumer = json(local('ui-consumer-verification-h6.json'))
  assert(uiConsumer.pass)
  assert.equal(hash(path.join(build.uiSource.root, uiConsumer.source.file)), uiConsumer.source.sha256)
  assert.equal(hash(path.join(build.uiSource.root, uiConsumer.artifact.file)), uiConsumer.artifact.sha256)
  const gates = json(local('final-gates-h6.json')), focused = json(local('final-focused-h9.json'))
  assert(gates.pass && gates.gates.every(entry => entry.exitCode === 0))
  assert(focused.success && focused.numFailedTests === 0)
  receipt.gates = { record: 'final-gates-h6.json', commands: gates.gates.length,
    focusedSuites: focused.numPassedTestSuites, focusedTests: focused.numPassedTests,
    uiConsumer: 'ui-consumer-verification-h6.json' }
  const records = sourceFiles.map(file => {
    const sourceSha256 = hash(path.join(root, file)), stagedSha256 = hash(path.join(build.stage, file))
    const instrumented = preserved.includes(file)
    if (instrumented) {
      const patch = refresh.preserved.find(entry => entry.file === file)
      assert.equal(sourceSha256, patch.sourceSha256)
      assert.equal(stagedSha256, patch.sha256)
    } else assert.equal(stagedSha256, sourceSha256, `Unexpected stage difference: ${file}`)
    return { file, sourceSha256, stagedSha256, instrumented }
  })
  receipt.sources = { files: sourceFiles.length, recordedQualificationDifferences: preserved, receipts: records }

  function exportDigest(base) {
    const digest = crypto.createHash('sha256')
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) walk(file)
        else digest.update(path.relative(base, file)).update('\0').update(fs.readFileSync(file)).update('\0')
      }
    }
    walk(base)
    return digest.digest('hex')
  }
  const exportSha256 = exportDigest(local(webDirectory))
  for (const data of [scenes, routes]) {
    assert(data.isolatedBrowserData && data.errors.length === 0 && data.liveProviderRequests === 0)
    assert.equal(data.exportHash, exportSha256)
  }
  assert.equal(atlas.webExportSha256, exportSha256)
  receipt.webExportSha256 = exportSha256
  const home = json(path.join(root, 'test-evidence/qa/islemind-upgrade-20261106/home-reference-source.json'))
  assert.equal(home.length, 6)
  receipt.homeReference = home.map(entry => {
    assert.equal(hash(path.join(root, entry.file)), entry.sha256, `Home reference changed: ${entry.file}`)
    return { ...entry, unchanged: true }
  })
  receipt.screenshots = atlas.screenshots.map(entry => {
    assert.equal(hash(local(decodeURIComponent(entry.file))), entry.sha256)
    return { file: entry.file, sha256: entry.sha256 }
  })
  assert.equal(receipt.screenshots.length, atlasVerification.screenshotHashes)
  const baseline = json(local('baseline-source.json'))
  receipt.baselineSource = { file: 'baseline-source.json', files: baseline.files.length, sha256: hash(local('baseline-source.json')) }

  fs.writeFileSync(out, JSON.stringify(receipt, null, 2))
  const links = []
  for (const document of documents) {
    const file = path.join(root, document), source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].trim().replace(/^<|>$/g, '')
      if (/^(?:[a-z]+:|#)/i.test(link)) continue
      const target = path.resolve(path.dirname(file), decodeURIComponent(link.split('#')[0]))
      assert(target.startsWith(root + path.sep), `Document link escaped workspace: ${document} ${link}`)
      const exists = fs.existsSync(target)
      links.push({ file: document, link, exists })
      assert(exists, `Missing local document link: ${document} ${link}`)
    }
  }
  const documentReceipt = { pass: true, verifiedAt: new Date().toISOString(), files: documents,
    sources: documents.map(file => ({ file, sha256: hash(path.join(root, file)) })), links }
  fs.writeFileSync(local('final-document-links.json'), JSON.stringify(documentReceipt, null, 2))
  receipt.documents = { files: documents.length, localLinks: links.length, record: 'final-document-links.json' }
  receipt.pass = true
} catch (error) {
  receipt.errors.push({ message: error.message, stack: error.stack })
  process.exitCode = 1
} finally {
  fs.writeFileSync(out, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ pass: receipt.pass, sources: receipt.sources?.files, homeReferences: receipt.homeReference?.length,
    screenshots: receipt.screenshots?.length, documentLinks: receipt.documents?.localLinks, errors: receipt.errors }))
}
