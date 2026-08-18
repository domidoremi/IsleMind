const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const config = getDefaultConfig(__dirname)
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
