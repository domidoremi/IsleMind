const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const allowed = new Set([
  'src/core/appVersion.ts',
  'src/core/contentDigest.ts',
  'src/core/plainDataSnapshot.ts',
  'src/core/updateCatalog.ts',
  'src/core/signedUpdateCatalog.ts',
  'src/modules/settings/updateCatalogSelection.ts',
])
const cache = new Map()

// Reuse the shared TS contract without registering process-wide compiler/alias hooks.
function loadUpdateDeliveryContract(relativePath) {
  if (!allowed.has(relativePath)) throw new Error('Only the named update-delivery contracts may be loaded.')
  if (cache.has(relativePath)) return cache.get(relativePath).exports
  const filename = path.join(root, relativePath)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  loaded.require = (request) => {
    const resolved = request.startsWith('@/') ? path.join(root, 'src', request.slice(2))
      : request.startsWith('.') ? path.resolve(path.dirname(filename), request) : null
    if (!resolved) throw new Error('Shared update contracts cannot load platform or package dependencies.')
    const dependency = path.relative(root, resolved).split(path.sep).join('/') + (resolved.endsWith('.ts') ? '' : '.ts')
    return loadUpdateDeliveryContract(dependency)
  }
  cache.set(relativePath, loaded)
  try {
    const execute = new Function('exports', 'require', 'module', '__filename', '__dirname',
      transformTypeScriptModule(fs.readFileSync(filename, 'utf8'), filename))
    execute(loaded.exports, loaded.require, loaded, filename, path.dirname(filename))
    return loaded.exports
  } catch (error) {
    cache.delete(relativePath)
    throw error
  }
}

module.exports = { loadUpdateDeliveryContract }
