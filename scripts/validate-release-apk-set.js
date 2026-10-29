const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const { spawnSync } = require('node:child_process')

const architectures = {
  'universal-64': ['arm64-v8a', 'x86_64'],
  'arm64-v8a': ['arm64-v8a'],
  x86_64: ['x86_64'],
  'armeabi-v7a-legacy': ['armeabi-v7a'],
}
const generatedBundlePath = 'src/generated/modelBundle.ts'

function releaseApkMatrix() {
  return ['no-model', 'with-model-small'].flatMap(model_variant =>
    Object.entries(architectures).map(([arch, abis]) => ({
      arch, model_variant, abi_filters: abis.join(','),
    })),
  )
}

function readRegularFile(file) {
  assert.ok(fs.lstatSync(file).isFile(), `Expected a regular file: ${file}`)
  return fs.readFileSync(file)
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function readZip(buffer) {
  let end = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 0xffff - 22); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50
      && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) {
      end = offset
      break
    }
  }
  assert.ok(end >= 0, 'APK ZIP central directory is missing')
  assert.equal(buffer.readUInt32LE(end + 4), 0, 'Multi-disk APK ZIP is unsupported')
  const count = buffer.readUInt16LE(end + 10)
  assert.ok(count > 0 && count < 0xffff, 'APK ZIP entry count is invalid or ZIP64')
  assert.equal(buffer.readUInt16LE(end + 8), count, 'APK ZIP entry counts disagree')
  const centralOffset = buffer.readUInt32LE(end + 16)
  const centralEnd = centralOffset + buffer.readUInt32LE(end + 12)
  assert.ok(centralOffset < centralEnd && centralEnd <= end, 'APK ZIP directory bounds are invalid')
  const entries = new Map()
  let offset = centralOffset
  for (let index = 0; index < count; index++) {
    assert.ok(offset + 46 <= centralEnd, 'APK ZIP directory is truncated')
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'Invalid APK ZIP directory header')
    const nameLength = buffer.readUInt16LE(offset + 28)
    const next = offset + 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
    assert.ok(next <= centralEnd, 'APK ZIP entry bounds are invalid')
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    assert.ok(name && !entries.has(name), `Duplicate or empty APK ZIP entry: ${name}`)
    entries.set(name, {
      method: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      size: buffer.readUInt32LE(offset + 24),
      offset: buffer.readUInt32LE(offset + 42),
    })
    offset = next
  }
  assert.equal(offset, centralEnd, 'APK ZIP directory size does not match its entries')
  return {
    names: [...entries.keys()],
    read(name, maximumBytes) {
      const entry = entries.get(name)
      assert.ok(entry, `Missing APK asset: ${name}`)
      assert.ok(entry.size <= maximumBytes, `APK asset exceeds its expected size: ${name}`)
      assert.ok(entry.offset + 30 <= centralOffset, `Invalid APK local entry: ${name}`)
      assert.equal(buffer.readUInt32LE(entry.offset), 0x04034b50, `Invalid APK local header: ${name}`)
      assert.equal(buffer.readUInt16LE(entry.offset + 8), entry.method, `ZIP methods disagree: ${name}`)
      const nameLength = buffer.readUInt16LE(entry.offset + 26)
      const dataOffset = entry.offset + 30 + nameLength + buffer.readUInt16LE(entry.offset + 28)
      assert.ok(dataOffset + entry.compressedSize <= centralOffset, `APK asset bounds are invalid: ${name}`)
      assert.equal(buffer.toString('utf8', entry.offset + 30, entry.offset + 30 + nameLength), name, `ZIP names disagree: ${name}`)
      const compressed = buffer.subarray(dataOffset, dataOffset + entry.compressedSize)
      assert.ok(entry.method === 0 || entry.method === 8, `Unsupported APK ZIP method: ${entry.method}`)
      const data = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: Math.max(1, maximumBytes) })
      assert.equal(data.length, entry.size, `APK asset size mismatch: ${name}`)
      return data
    },
  }
}

function checkModels(zip, manifest, variant, catalog, contracts) {
  assert.equal(manifest.app, 'IsleMind', 'Unexpected model manifest application')
  assert.equal(manifest.modelBundleVariant, variant, 'APK model variant does not match its filename')
  assert.ok(typeof manifest.generatedAt === 'string' && Number.isFinite(Date.parse(manifest.generatedAt)), 'Invalid model generation timestamp')
  const ids = contracts.getBundledModelIds(catalog, variant)
  assert.deepEqual(manifest.bundledModels.map(model => model.id), ids, 'Bundled model IDs do not match the source catalog')
  const files = []
  for (const bundled of manifest.bundledModels) {
    const model = contracts.getModelById(catalog, bundled.id)
    assert.ok(model, `Unknown bundled model: ${bundled.id}`)
    for (const key of ['version', 'capability', 'dimension', 'tokenizer']) {
      assert.equal(bundled[key], model[key], `Bundled model ${key} mismatch: ${model.id}`)
    }
    const expected = model.files.map(file => ({ path: `${model.id}/${file.path}`, bytes: file.bytes, sha256: file.sha256 }))
    assert.deepEqual(bundled.files, expected, `Bundled model file manifest mismatch: ${model.id}`)
    assert.equal(bundled.bytes, expected.reduce((sum, file) => sum + file.bytes, 0), `Bundled model byte count mismatch: ${model.id}`)
    for (const file of expected) {
      const bytes = zip.read(`assets/islemind-models/${file.path}`, file.bytes)
      assert.equal(bytes.length, file.bytes, `Bundled model file size mismatch: ${file.path}`)
      assert.equal(sha256(bytes), file.sha256, `Bundled model file digest mismatch: ${file.path}`)
      files.push(file)
    }
  }
  assert.deepEqual(manifest.files, files.map(file => file.path), 'APK model file list differs from the source catalog')
  assert.equal(manifest.modelAssetsIncluded, files.length > 0, 'APK model inclusion flag is invalid')
  assert.equal(manifest.modelAssetCount, files.length, 'APK model asset count is invalid')
  assert.equal(manifest.modelAssetBytes, files.reduce((sum, file) => sum + file.bytes, 0), 'APK model byte count is invalid')
  assert.deepEqual(
    zip.names.filter(name => name.startsWith('assets/islemind-models/') && !name.endsWith('/')).sort(),
    files.map(file => `assets/islemind-models/${file.path}`).sort(),
    'APK contains unexpected bundled model assets',
  )
  return { ids, fileCount: files.length, sizeBytes: manifest.modelAssetBytes }
}

function variantInputs(inputs, originalModule, catalog, contracts, variant, generatedAt) {
  const ids = contracts.getBundledModelIds(catalog, variant)
  const stable = [
    `export const MODEL_BUNDLE_VARIANT = ${JSON.stringify(variant)}`,
    `export const BUNDLED_LOCAL_EMBEDDING_MODELS: string[] = ${JSON.stringify(ids)}`,
  ]
  const existingDate = originalModule.match(/MODEL_BUNDLE_GENERATED_AT = "([^"]+)"/)?.[1]
  if (stable.every(line => originalModule.includes(line)) && existingDate) generatedAt = existingDate
  const bytes = Buffer.from(contracts.formatGeneratedModelBundle(variant, ids, generatedAt), 'utf8')
  assert.ok(inputs.some(input => input.path === generatedBundlePath), 'Generated model source is not captured')
  // Replay the producer's exact generation rules; do not exclude this input.
  return inputs.map(input => input.path === generatedBundlePath
    ? { ...input, sha256: sha256(bytes), sizeBytes: bytes.length }
    : input)
}

function checkSourceInputs(expected, captured, count) {
  assert.ok(Array.isArray(captured), 'Source snapshot input list is missing')
  assert.equal(count, captured.length, 'Source snapshot input count is invalid')
  assert.equal(captured.length, expected.length, 'Source snapshot is not a complete input set')
  const byPath = new Map(expected.map(input => [input.path, input]))
  const seen = new Set()
  for (const input of captured) {
    assert.ok(typeof input.path === 'string' && !seen.has(input.path), `Duplicate or invalid source input: ${input.path}`)
    seen.add(input.path)
    const current = byPath.get(input.path)
    assert.ok(current, `Unexpected source snapshot input: ${input.path}`)
    assert.equal(input.sha256, current.sha256, `Source snapshot digest mismatch: ${input.path}`)
    assert.equal(input.sizeBytes, current.sizeBytes, `Source snapshot size mismatch: ${input.path}`)
  }
}

function findAapt(sdk) {
  assert.ok(sdk, 'ANDROID_HOME or ANDROID_SDK_ROOT is required for APK metadata verification')
  const tools = path.join(sdk, 'build-tools')
  const executable = process.platform === 'win32' ? 'aapt.exe' : 'aapt'
  const found = fs.readdirSync(tools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map(version => path.join(tools, version, executable)).find(file => fs.existsSync(file))
  assert.ok(found, 'aapt was not found in the configured Android SDK')
  return found
}

function validateReleaseApkSet({ sourceRoot = path.resolve(__dirname, '..'), distDir, aapt, runTool = spawnSync, contracts } = {}) {
  sourceRoot = path.resolve(sourceRoot)
  distDir = path.resolve(distDir || path.join(sourceRoot, 'dist-apk'))
  contracts ||= {
    ...require(path.join(sourceRoot, 'scripts/release-freshness-contract.js')),
    ...require(path.join(sourceRoot, 'scripts/model-catalog.js')),
  }
  const pkg = JSON.parse(readRegularFile(path.join(sourceRoot, 'package.json')))
  const app = JSON.parse(readRegularFile(path.join(sourceRoot, 'app.json'))).expo
  assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.version), 'Invalid release version')
  assert.equal(app.version, pkg.version, 'Source version identities disagree')
  assert.ok(Number.isInteger(app.android.versionCode) && app.android.versionCode > 0, 'Invalid Android version code')
  const matrix = releaseApkMatrix()
  const nameFor = row => `IsleMind-${pkg.version}-${row.arch}-${row.model_variant}.apk`
  const apkNames = [...fs.readdirSync(distDir)].filter(name => name.endsWith('.apk')).sort()
  assert.deepEqual(apkNames, matrix.map(nameFor).sort(), 'Expected exactly the complete eight-APK release matrix')
  const inputs = contracts.snapshotReleaseInputs(sourceRoot)
  const originalModule = readRegularFile(path.join(sourceRoot, generatedBundlePath)).toString('utf8')
  const catalog = contracts.loadModelCatalog(sourceRoot)
  aapt ||= findAapt(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT)
  const apks = matrix.map(row => {
    const name = nameFor(row)
    const file = path.join(distDir, name)
    const bytes = readRegularFile(file)
    assert.ok(bytes.length > 0, `Empty release APK: ${name}`)
    const identity = { sha256: sha256(bytes), sizeBytes: bytes.length }
    const sidecar = readRegularFile(`${file}.sha256`).toString('utf8').trim()
    const checksum = sidecar.match(/^([0-9a-f]{64})\s+\*?([^\r\n]+)$/i)
    assert.ok(checksum, `Malformed SHA sidecar: ${name}`)
    assert.equal(checksum[1].toLowerCase(), identity.sha256, `SHA sidecar digest mismatch: ${name}`)
    assert.equal(path.basename(checksum[2].replace(/\\/g, '/')), name, `SHA sidecar filename mismatch: ${name}`)
    const snapshot = JSON.parse(readRegularFile(`${file}.source-snapshot.json`))
    assert.equal(snapshot.schema, contracts.releaseSourceSnapshotSchema, `Unsupported source snapshot schema: ${name}`)
    assert.equal(contracts.compareReleaseSnapshotApk({ ...snapshot, present: true }, identity).status, 'matched', `Source snapshot is not bound to APK bytes: ${name}`)
    const zip = readZip(bytes)
    const manifest = JSON.parse(zip.read('assets/islemind-build-variant.json', 1024 * 1024))
    const models = checkModels(zip, manifest, row.model_variant, catalog, contracts)
    const expected = variantInputs(inputs, originalModule, catalog, contracts, row.model_variant, manifest.generatedAt)
    if (snapshot.build) {
      assert.equal(snapshot.build.variant, row.model_variant, `Build capture variant mismatch: ${name}`)
      checkSourceInputs(expected, snapshot.build.inputs, snapshot.build.inputCount)
      const workspaceInputs = variantInputs(inputs, originalModule, catalog, contracts, snapshot.build.workspaceVariant, manifest.generatedAt)
      checkSourceInputs(workspaceInputs, snapshot.inputs, snapshot.inputCount)
    } else {
      checkSourceInputs(expected, snapshot.inputs, snapshot.inputCount)
    }
    const metadata = runTool(aapt, ['dump', 'badging', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 60000, windowsHide: true })
    assert.ok(!metadata.error && metadata.status === 0, `aapt verification failed: ${name}\n${metadata.stderr || metadata.error?.message || ''}`)
    const badging = String(metadata.stdout)
    const version = badging.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m)
    assert.ok(version, `APK package metadata is missing: ${name}`)
    assert.equal(version[1], app.android.package, `APK package mismatch: ${name}`)
    assert.equal(version[2], String(app.android.versionCode), `APK version code mismatch: ${name}`)
    assert.equal(version[3], pkg.version, `APK version name mismatch: ${name}`)
    assert.ok(!/^application-debuggable(?:\s|$)/m.test(badging), `Debuggable APK: ${name}`)
    const abiLine = badging.match(/^native-code:\s*(.*)$/m)
    assert.ok(abiLine, `APK native ABI metadata is missing: ${name}`)
    const abis = [...abiLine[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort()
    assert.deepEqual(abis, [...architectures[row.arch]].sort(), `APK native ABI mismatch: ${name}`)
    assert.deepEqual([...new Set(zip.names.filter(entry => /^lib\/[^/]+\/[^/]+\.so$/.test(entry)).map(entry => entry.split('/')[1]))].sort(), abis, `APK native libraries disagree with its ABI metadata: ${name}`)
    const toolchain = JSON.parse(readRegularFile(path.join(distDir, `build-toolchain-${row.arch}-${row.model_variant}.json`)))
    assert.equal(toolchain.schema, 'islemind.android-build-toolchain.v1', `Missing matrix-specific build toolchain evidence: ${name}`)
    return { name, ...identity, package: version[1], versionName: version[3], versionCode: Number(version[2]), abis, modelVariant: row.model_variant, models, sourceInputCount: snapshot.inputCount }
  })
  return {
    schema: 'islemind.android-candidate-set.v1',
    expectedApks: 8,
    verifiedApks: apks.length,
    sourceVersion: pkg.version,
    versionCode: app.android.versionCode,
    separateSigningAnd16KbGatesRequired: true,
    apks,
  }
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--source-root'), 'Usage: node validate-release-apk-set.js [--source-root DIRECTORY]')
    console.log(JSON.stringify(validateReleaseApkSet({ sourceRoot: args[1] }), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

module.exports = { releaseApkMatrix, validateReleaseApkSet }
