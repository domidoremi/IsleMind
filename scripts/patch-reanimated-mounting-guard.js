const fs = require('node:fs')
const path = require('node:path')

const marker = '// IsleMind: ignore synchronous updates for an unmounted Fabric view.'
const anchor = `            if (BuildConfig.IS_REACT_NATIVE_86_OR_NEWER) {
                try {
                    updatePropsSynchronouslyMethod.invoke(mountingManager, viewTag, props)`
const replacement = `            if (BuildConfig.IS_REACT_NATIVE_86_OR_NEWER) {
                try {
                    ${marker}
                    if (mFabricUIManager.resolveView(viewTag) == null) return@parse
                    updatePropsSynchronouslyMethod.invoke(mountingManager, viewTag, props)`

function patchNativeProxySource(source) {
  if (source.includes(marker)) return source
  if (source.split(anchor).length !== 2) {
    throw new Error('[patch-reanimated-mounting-guard] unsupported NativeProxy source; review the installed Reanimated version')
  }
  return source.replace(anchor, replacement)
}

function main() {
  const filename = path.resolve(__dirname, '../node_modules/react-native-reanimated/android/src/main/java/com/swmansion/reanimated/NativeProxy.kt')
  const source = fs.readFileSync(filename, 'utf8')
  const patched = patchNativeProxySource(source)
  if (patched === source) {
    console.log('[patch-reanimated-mounting-guard] already applied')
    return
  }
  fs.writeFileSync(filename, patched)
  console.log('[patch-reanimated-mounting-guard] added mounted-view check for React Native 0.86 synchronous updates')
}

if (require.main === module) main()
module.exports = { patchNativeProxySource }
