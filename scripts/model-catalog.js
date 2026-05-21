const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const catalogPath = path.join(projectRoot, 'assets', 'models', 'catalog.json')

function loadModelCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
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

module.exports = {
  catalogPath,
  getBundledModelIds,
  getModelById,
  loadModelCatalog,
  normalizeVariant,
  projectRoot,
  supportedVariants,
}
