const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)
config.resolver.assetExts = Array.from(new Set([...config.resolver.assetExts, 'wasm']))
const codexArtifactsPattern = new RegExp(`${path.resolve(__dirname, '.codex').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[/\\\\].*`)
config.resolver.blockList = config.resolver.blockList instanceof RegExp
  ? new RegExp(`${config.resolver.blockList.source}|${codexArtifactsPattern.source}`)
  : codexArtifactsPattern

module.exports = withNativeWind(config, { input: './src/global.css' })
