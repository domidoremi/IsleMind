const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const catalogPath = path.join(projectRoot, 'assets', 'models', 'catalog.json')

function loadModelCatalog(root = projectRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, 'assets', 'models', 'catalog.json'), 'utf8'))
}

function normalizeVariant(variant) {
  return variant === 'with-model' ? 'with-model-small' : variant
}

function supportedVariants() {
  return ['no-model', 'with-model-small']
}

function getBundledModelIds(catalog, variant) {
  const normalized = normalizeVariant(variant)
  return catalog.variants[normalized]?.bundledModels ?? []
}

function getModelById(catalog, modelId) {
  return catalog.models.find((model) => model.id === modelId)
}

function formatGeneratedModelBundle(variant, bundledModelIds, generatedAt) {
  return [
    `export const MODEL_BUNDLE_VARIANT = ${JSON.stringify(variant)}`,
    `export const BUNDLED_LOCAL_EMBEDDING_MODELS: string[] = ${JSON.stringify(bundledModelIds)}`,
    `export const MODEL_BUNDLE_GENERATED_AT = ${JSON.stringify(generatedAt)}`,
    '',
  ].join('\n')
}

module.exports = {
  catalogPath,
  formatGeneratedModelBundle,
  getBundledModelIds,
  getModelById,
  loadModelCatalog,
  normalizeVariant,
  projectRoot,
  supportedVariants,
}
