const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

// Both native and Web package the same validated, offline documentation source.
require('./scripts/user-guide').writeGuide()

const config = getDefaultConfig(__dirname)
// The RN fork is a sibling package, not a second implementation in this app.
const animalIslandRoot = path.dirname(require.resolve('animal-island-ui-rn/package.json'))
config.watchFolders = [...(config.watchFolders ?? []), animalIslandRoot]
// A linked library has its own devDependencies. Always share the host runtime
// (especially React, React Native, and react-native-svg) to avoid duplicate hooks.
const sharedRuntimePackages = ['react', 'react-native', 'react-native-svg']
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const sharedRuntime = sharedRuntimePackages.some((name) => moduleName === name || moduleName.startsWith(`${name}/`))
  const resolutionContext = sharedRuntime
    // Keep this origin inside node_modules: Expo skips application-only
    // tsconfig type aliases here, so React resolves to runtime JS, not @types.
    ? { ...context, originModulePath: path.join(__dirname, 'node_modules', 'expo', 'package.json') }
    : context
  return defaultResolveRequest
    ? defaultResolveRequest(resolutionContext, moduleName, platform)
    : resolutionContext.resolveRequest(resolutionContext, moduleName, platform)
}
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'wasm']))
config.server.enhanceMiddleware = (middleware) => {
  return (request, response, next) => {
    response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless')
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    middleware(request, response, next)
  }
}
const codexArtifactsPattern = new RegExp(`${path.resolve(__dirname, '.codex').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\].*`)
config.resolver.blockList = config.resolver.blockList instanceof RegExp
  ? new RegExp(`${config.resolver.blockList.source}|${codexArtifactsPattern.source}`)
  : codexArtifactsPattern

module.exports = config
