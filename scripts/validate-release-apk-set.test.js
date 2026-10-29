const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { releaseApkMatrix, validateReleaseApkSet } = require('./validate-release-apk-set')
const contracts = { ...require('./release-freshness-contract'), ...require('./model-catalog') }

const originalDate = '2026-08-29T14:23:49.418Z'
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')

function syntheticZip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const { name, bytes, compressed = false } of entries) {
    const filename = Buffer.from(name)
    const data = compressed ? zlib.deflateRawSync(bytes) : bytes
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(compressed ? 8 : 0, 8)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(bytes.length, 22)
    header.writeUInt16LE(filename.length, 26)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50)
    directory.writeUInt16LE(compressed ? 8 : 0, 10)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(bytes.length, 24)
    directory.writeUInt16LE(filename.length, 28)
    directory.writeUInt32LE(offset, 42)
    local.push(header, filename, data)
    central.push(directory, filename)
    offset += header.length + filename.length + data.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, centralBytes, end])
}

function fixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'islemind-apk-set-test-'))
  const sourceRoot = path.join(temporary, 'source')
  const distDir = path.join(temporary, 'apks')
  fs.mkdirSync(path.join(sourceRoot, 'src/generated'), { recursive: true })
  fs.mkdirSync(path.join(sourceRoot, 'assets/models'), { recursive: true })
  fs.mkdirSync(distDir)
  fs.writeFileSync(path.join(sourceRoot, 'package.json'), JSON.stringify({ version: '1.1.5' }))
  fs.writeFileSync(path.join(sourceRoot, 'app.json'), JSON.stringify({ expo: { version: '1.1.5', android: { versionCode: 130, package: 'com.islemind.app' } } }))
  fs.writeFileSync(path.join(sourceRoot, 'src/feature.ts'), 'export const feature = "source-bound"\n')
  const modulePath = path.join(sourceRoot, 'src/generated/modelBundle.ts')
  const originalModule = contracts.formatGeneratedModelBundle('no-model', [], originalDate)
  fs.writeFileSync(modulePath, originalModule)
  const weights = Buffer.from('synthetic-model-weights')
  const model = {
    id: 'qa-model', version: 'fixture-v1', capability: 'embedding', dimension: 3, tokenizer: 'wordpiece',
    files: [{ path: 'onnx/model.onnx', bytes: weights.length, sha256: digest(weights) }],
  }
  const catalog = { variants: { 'no-model': { bundledModels: [] }, 'with-model-small': { bundledModels: ['qa-model'] } }, models: [model] }
  fs.writeFileSync(path.join(sourceRoot, 'assets/models/catalog.json'), JSON.stringify(catalog))
  const rows = releaseApkMatrix().map((row, index) => ({
    ...row, name: `IsleMind-1.1.5-${row.arch}-${row.model_variant}.apk`,
    generatedAt: new Date(Date.UTC(2026, 9, 29, 10, 21, index)).toISOString(),
  }))
  function entriesFor(row) {
    const included = row.model_variant === 'with-model-small'
    const files = included ? model.files.map(file => ({ ...file, path: `${model.id}/${file.path}` })) : []
    const manifest = {
      app: 'IsleMind', modelBundleVariant: row.model_variant, generatedAt: row.generatedAt,
      bundledModels: included ? [{ ...model, files, bytes: weights.length }] : [],
      files: files.map(file => file.path), modelAssetsIncluded: included,
      modelAssetCount: files.length, modelAssetBytes: included ? weights.length : 0,
    }
    return [
      { name: 'assets/islemind-build-variant.json', bytes: Buffer.from(JSON.stringify(manifest)), compressed: true },
      ...row.abi_filters.split(',').map(abi => ({ name: `lib/${abi}/libsynthetic.so`, bytes: Buffer.from('synthetic-not-an-ELF') })),
      ...(included ? [{ name: 'assets/islemind-models/qa-model/onnx/model.onnx', bytes: weights, compressed: true }] : []),
    ]
  }
  function writeApk(row, transform = entries => entries) {
    const bytes = syntheticZip(transform(entriesFor(row)))
    const file = path.join(distDir, row.name)
    fs.writeFileSync(file, bytes)
    fs.writeFileSync(`${file}.sha256`, `${digest(bytes)}  dist-apk/${row.name}\n`)
    const ids = contracts.getBundledModelIds(catalog, row.model_variant)
    const generatedAt = row.model_variant === 'no-model' ? originalDate : row.generatedAt
    fs.writeFileSync(modulePath, contracts.formatGeneratedModelBundle(row.model_variant, ids, generatedAt))
    try {
      contracts.writeReleaseSourceSnapshot(sourceRoot, file)
    } finally {
      fs.writeFileSync(modulePath, originalModule)
    }
    fs.writeFileSync(path.join(distDir, `build-toolchain-${row.arch}-${row.model_variant}.json`), JSON.stringify({ schema: 'islemind.android-build-toolchain.v1' }))
  }
  for (const row of rows) writeApk(row)
  function runTool(_command, args) {
    const row = rows.find(item => item.name === path.basename(args[2]))
    return {
      status: 0, stderr: '',
      stdout: `package: name='com.islemind.app' versionCode='130' versionName='1.1.5'\nnative-code: ${row.abi_filters.split(',').map(abi => `'${abi}'`).join(' ')}\n`,
    }
  }
  return {
    temporary, sourceRoot, distDir, rows, modulePath, originalModule, writeApk,
    validate(overrides = {}) { return validateReleaseApkSet({ sourceRoot, distDir, contracts, aapt: 'synthetic-aapt', runTool, ...overrides }) },
    changeSnapshot(row, edit) {
      const file = path.join(distDir, `${row.name}.source-snapshot.json`)
      const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'))
      edit(snapshot)
      fs.writeFileSync(file, JSON.stringify(snapshot))
    },
    changeBadging(edit) {
      return (_command, args) => {
        const result = runTool(_command, args)
        result.stdout = edit(result.stdout, path.basename(args[2]))
        return result
      }
    },
    dispose() {
      const resolved = path.resolve(temporary)
      const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`
      if (!resolved.startsWith(temporaryRoot) || !path.basename(resolved).startsWith('islemind-apk-set-test-')) {
        throw new Error('Refusing to delete a fixture outside its checked temporary directory')
      }
      fs.rmSync(resolved, { recursive: true, force: true })
    },
  }
}

function withFixture(check) {
  const f = fixture()
  try { check(f) } finally { f.dispose() }
}

test('complete candidate set checks all eight APK byte identities, variants, models and source inputs without modifying source', () => {
  withFixture(f => {
    const report = f.validate()
    expect(report).toMatchObject({ verifiedApks: 8, expectedApks: 8, versionCode: 130, separateSigningAnd16KbGatesRequired: true })
    expect(report.apks.filter(apk => apk.models.fileCount === 1)).toHaveLength(4)
    expect(new Set(report.apks.map(apk => apk.name)).size).toBe(8)
    expect(fs.readFileSync(f.modulePath, 'utf8')).toBe(f.originalModule)
  })
})

test('a seven-APK subset is never accepted as a complete candidate', () => {
  withFixture(f => {
    fs.unlinkSync(path.join(f.distDir, f.rows[7].name))
    expect(() => f.validate()).toThrow(/complete eight-APK/)
  })
})

test('an unexpected ninth APK is rejected rather than hidden by a glob', () => {
  withFixture(f => {
    fs.copyFileSync(path.join(f.distDir, f.rows[0].name), path.join(f.distDir, 'unexpected.apk'))
    expect(() => f.validate()).toThrow(/complete eight-APK/)
  })
})

test('every matrix producer must supply its own non-colliding toolchain record', () => {
  withFixture(f => {
    fs.unlinkSync(path.join(f.distDir, 'build-toolchain-universal-64-no-model.json'))
    expect(() => f.validate()).toThrow()
  })
})

test.each(['digest', 'filename'])('SHA sidecar %s mismatches block collection', kind => {
  withFixture(f => {
    const file = path.join(f.distDir, f.rows[0].name)
    fs.writeFileSync(`${file}.sha256`, `${kind === 'digest' ? '0'.repeat(64) : digest(fs.readFileSync(file))}  ${kind === 'filename' ? 'other.apk' : f.rows[0].name}\n`)
    expect(() => f.validate()).toThrow(/SHA sidecar.*mismatch/)
  })
})

test('source snapshots cannot authenticate different APK bytes', () => {
  withFixture(f => {
    f.changeSnapshot(f.rows[0], snapshot => { snapshot.apk.sha256 = '0'.repeat(64) })
    expect(() => f.validate()).toThrow(/not bound to APK bytes/)
  })
})

test('an unchanged APK cannot hide a changed application source input', () => {
  withFixture(f => {
    fs.writeFileSync(path.join(f.sourceRoot, 'src/feature.ts'), 'export const feature = "changed"\n')
    expect(() => f.validate()).toThrow(/Source snapshot digest mismatch: src\/feature.ts/)
  })
})

test('model-variant generation is reproduced exactly, not omitted from source comparison', () => {
  withFixture(f => {
    f.changeSnapshot(f.rows[4], snapshot => { snapshot.inputs.find(input => input.path === 'src/generated/modelBundle.ts').sha256 = '0'.repeat(64) })
    expect(() => f.validate()).toThrow(/Source snapshot digest mismatch: src\/generated\/modelBundle.ts/)
  })
})

test.each(['duplicate', 'count', 'schema', 'build'])('malformed source snapshot %s is rejected', kind => {
  withFixture(f => {
    f.changeSnapshot(f.rows[0], snapshot => {
      if (kind === 'duplicate') snapshot.inputs[1] = { ...snapshot.inputs[0] }
      if (kind === 'count') snapshot.inputCount += 1
      if (kind === 'schema') snapshot.schema = 'unsupported'
      if (kind === 'build') snapshot.build = {}
    })
    expect(() => f.validate()).toThrow()
  })
})

test.each([
  ['package', text => text.replace('com.islemind.app', 'com.other.app'), /APK package mismatch/],
  ['version code', text => text.replace("versionCode='130'", "versionCode='129'"), /APK version code mismatch/],
  ['version name', text => text.replace("versionName='1.1.5'", "versionName='1.1.4'"), /APK version name mismatch/],
  ['debug flag', text => `${text}application-debuggable\n`, /Debuggable APK/],
  ['ABI', text => text.replace("'arm64-v8a' 'x86_64'", "'arm64-v8a' 'x86_64' 'armeabi-v7a'"), /APK native ABI mismatch/],
])('producer filenames and hashes do not excuse wrong actual APK %s', (_kind, change, error) => {
  withFixture(f => {
    expect(() => f.validate({ runTool: f.changeBadging(change) })).toThrow(error)
  })
})

test('ABI metadata must agree with the actual native-library ZIP directories', () => {
  withFixture(f => {
    f.writeApk(f.rows[0], entries => entries.filter(entry => !entry.name.startsWith('lib/x86_64/')))
    expect(() => f.validate()).toThrow(/native libraries disagree/)
  })
})

test('a source-bound APK still must contain the declared model variant', () => {
  withFixture(f => {
    f.writeApk(f.rows[0], entries => entries.map(entry => entry.name === 'assets/islemind-build-variant.json'
      ? { ...entry, bytes: Buffer.from(JSON.stringify({ ...JSON.parse(entry.bytes), modelBundleVariant: 'with-model-small' })) }
      : entry))
    expect(() => f.validate()).toThrow(/model variant does not match/)
  })
})

test('model file bytes are verified against the trusted source catalog, not only APK metadata', () => {
  withFixture(f => {
    f.writeApk(f.rows[4], entries => entries.map(entry => {
      if (!entry.name.endsWith('.onnx')) return entry
      const bytes = Buffer.from(entry.bytes)
      bytes[0] ^= 1
      return { ...entry, bytes }
    }))
    expect(() => f.validate()).toThrow(/Bundled model file digest mismatch/)
  })
})

test('unlisted bundled model assets block collection', () => {
  withFixture(f => {
    f.writeApk(f.rows[4], entries => [...entries, { name: 'assets/islemind-models/qa-model/unlisted.onnx', bytes: Buffer.from('extra-model') }])
    expect(() => f.validate()).toThrow(/unexpected bundled model assets/)
  })
})

test('duplicate APK ZIP entry names cannot hide alternate model metadata', () => {
  withFixture(f => {
    f.writeApk(f.rows[0], entries => [...entries, entries[0]])
    expect(() => f.validate()).toThrow(/Duplicate or empty APK ZIP entry/)
  })
})

test('metadata tool failures fail closed rather than producing a qualified set', () => {
  withFixture(f => {
    expect(() => f.validate({ runTool: () => ({ status: 1, stderr: 'synthetic aapt failure' }) })).toThrow(/aapt verification failed/)
    expect(fs.readFileSync(f.modulePath, 'utf8')).toBe(f.originalModule)
  })
})
