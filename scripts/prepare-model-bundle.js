const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')
const {
  getBundledModelIds,
  getModelById,
  loadModelCatalog,
  normalizeVariant,
  supportedVariants,
} = require('./model-catalog')

const projectRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(projectRoot, 'assets', 'models')
const androidAssetsDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'assets')
const targetDir = path.join(androidAssetsDir, 'islemind-models')
const manifestPath = path.join(androidAssetsDir, 'islemind-build-variant.json')
const generatedBundlePath = path.join(projectRoot, 'src', 'generated', 'modelBundle.ts')

function parseArgs(argv) {
  const args = {
    variant: process.env.ISLEMIND_MODEL_BUNDLE || 'no-model',
    failOnMissingModels: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--variant') {
      args.variant = argv[index + 1]
      index += 1
    } else if (item.startsWith('--variant=')) {
      args.variant = item.slice('--variant='.length)
    } else if (item === '--fail-on-missing-models') {
      args.failOnMissingModels = true
    }
  }
  args.variant = normalizeVariant(args.variant)
  if (!supportedVariants().includes(args.variant)) {
    throw new Error(`Unsupported model bundle variant "${args.variant}". Use no-model or with-model-small.`)
  }
  return args
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function copyModelFiles(model) {
  const copied = []
  for (const file of model.files) {
    const source = path.join(sourceDir, model.id, file.path)
    if (!fs.existsSync(source)) {
      throw new Error(`Missing model asset for ${model.id}: ${path.relative(projectRoot, source)}`)
    }
    const actualBytes = fs.statSync(source).size
    if (actualBytes !== file.bytes) {
      throw new Error(`Model asset size mismatch for ${model.id}/${file.path}: expected ${file.bytes}, got ${actualBytes}.`)
    }
    const actualHash = sha256File(source)
    if (actualHash !== file.sha256) {
      throw new Error(`Model asset hash mismatch for ${model.id}/${file.path}: expected ${file.sha256}, got ${actualHash}.`)
    }
    const relative = `${model.id}/${file.path}`
    const target = path.join(targetDir, relative)
    ensureDir(path.dirname(target))
    fs.copyFileSync(source, target)
    copied.push({
      path: relative.replace(/\\/g, '/'),
      bytes: actualBytes,
      sha256: actualHash,
    })
  }
  return copied
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function writeManifest(manifest) {
  ensureDir(path.dirname(manifestPath))
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function writeGeneratedBundle(variant, bundledModels, generatedAt) {
  ensureDir(path.dirname(generatedBundlePath))
  const source = [
    `export const MODEL_BUNDLE_VARIANT = ${JSON.stringify(variant)}`,
    `export const BUNDLED_LOCAL_EMBEDDING_MODELS: string[] = ${JSON.stringify(bundledModels)}`,
    `export const MODEL_BUNDLE_GENERATED_AT = ${JSON.stringify(generatedAt)}`,
    '',
  ].join('\n')
  fs.writeFileSync(generatedBundlePath, source)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const catalog = loadModelCatalog()
  const bundledModelIds = getBundledModelIds(catalog, args.variant)
  const bundledModels = bundledModelIds.map((modelId) => {
    const model = getModelById(catalog, modelId)
    if (!model) throw new Error(`Model catalog variant ${args.variant} references unknown model "${modelId}".`)
    return model
  })

  removeDir(targetDir)

  if (args.variant === 'with-model-small' && !bundledModels.length && args.failOnMissingModels) {
    throw new Error(
      'The with-model-small APK variant was requested, but no bundled models are configured. Add model assets first or build the no-model variant.'
    )
  }

  const bundledManifestModels = bundledModels.map((model) => {
    const files = copyModelFiles(model)
    return {
      id: model.id,
      version: model.version,
      name: model.name,
      capability: model.capability,
      dimension: model.dimension,
      tokenizer: model.tokenizer,
      sourceUrl: model.sourceUrl,
      publisher: model.publisher,
      upstreamModel: model.upstreamModel,
      upstreamContributors: model.upstreamContributors,
      license: model.license,
      attribution: model.attribution,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files,
    }
  })
  const includedFiles = bundledManifestModels.flatMap((model) => model.files.map((file) => file.path))
  const totalBytes = bundledManifestModels.reduce((sum, model) => sum + model.bytes, 0)
  const generatedAt = new Date().toISOString()

  const manifest = {
    app: 'IsleMind',
    modelBundleVariant: args.variant,
    modelAssetsIncluded: includedFiles.length > 0,
    modelAssetCount: includedFiles.length,
    modelAssetBytes: includedFiles.length ? totalBytes : 0,
    modelAssetDirectory: 'assets/models',
    bundledModels: bundledManifestModels,
    generatedAt,
    files: includedFiles,
  }

  writeManifest(manifest)
  writeGeneratedBundle(args.variant, bundledModelIds, generatedAt)

  const status = manifest.modelAssetsIncluded
    ? `${manifest.modelAssetCount} file(s), ${formatBytes(manifest.modelAssetBytes)}`
    : 'no model assets included'
  console.log(`Prepared IsleMind Android bundle variant "${args.variant}": ${status}.`)
}

main()
