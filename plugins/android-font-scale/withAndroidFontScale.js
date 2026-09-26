const fs = require('node:fs')
const path = require('node:path')
const { AndroidConfig, withAndroidManifest, withMainActivity, withPodfileProperties, withSettingsGradle } = require('@expo/config-plugins')

const marker = '// IsleMind: retained font-scale layout'
const activityMembers = `
  ${marker}
  private var currentFontScale = 1f

  override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
    val fontChanged = currentFontScale != newConfig.fontScale
    currentFontScale = newConfig.fontScale
    super.onConfigurationChanged(newConfig)
    if (!fontChanged) return
    val context = (application as com.facebook.react.ReactApplication).reactHost?.currentReactContext ?: return
    com.facebook.react.uimanager.DisplayMetricsHolder.initDisplayMetrics(context)
    (context.getNativeModule("DeviceInfo") as? com.facebook.react.bridge.LifecycleEventListener)?.onHostResume()
    fun update(view: android.view.View) {
      if (view is com.facebook.react.ReactRootView && view.width > 0 && view.height > 0) {
        // A full-screen guide can suspend the Activity's ordinary layout pass.
        // Refresh Fabric's font multiplier without replacing the editor surface.
        view.forceLayout()
        view.measure(android.view.View.MeasureSpec.makeMeasureSpec(view.width, android.view.View.MeasureSpec.EXACTLY),
                     android.view.View.MeasureSpec.makeMeasureSpec(view.height, android.view.View.MeasureSpec.EXACTLY))
        view.requestLayout()
      } else if (view is android.view.ViewGroup) {
        for (i in 0 until view.childCount) update(view.getChildAt(i))
      }
    }
    update(window.decorView)
  }
`

function patchActivity(source) {
  if (source.includes(marker)) return source
  const declaration = 'class MainActivity : ReactActivity() {'
  const create = 'super.onCreate(null)'
  if (!source.includes(declaration) || !source.includes(create) || /override fun onConfigurationChanged\s*\(/.test(source)) {
    throw new Error('Unsupported MainActivity for retained font-scale layout; merge its lifecycle handling explicitly.')
  }
  return source.replace(declaration, declaration + activityMembers)
    .replace(create, `${create}\n    currentFontScale = resources.configuration.fontScale`)
}

function assertPatchedReactNative(projectRoot) {
  const root = path.dirname(require.resolve('react-native/package.json', { paths: [projectRoot] }))
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  if (version !== '0.86.3'
      || !read('ReactCommon/react/renderer/core/LayoutMetrics.h').includes('Float fontSizeMultiplier{1.0}')
      || !read('ReactCommon/react/renderer/components/root/RootShadowNode.cpp').includes('layoutContext.fontSizeMultiplier !=')
      || read('ReactCommon/react/renderer/scheduler/SurfaceHandler.cpp').includes('dirtyMeasurableNodesRecursive')) {
    throw new Error('The reviewed React Native 0.86.3 font-scale patch is required. Run bun install; re-review this plugin when upgrading React Native.')
  }
}

const sourceBuild = `
${marker}
includeBuild(new File(providers.exec {
  workingDir(rootDir)
  commandLine("node", "--print", "require.resolve('react-native/package.json')")
}.standardOutput.asText.get().trim()).parentFile) {
  dependencySubstitution {
    substitute(module('com.facebook.react:react-native')).using(project(':packages:react-native:ReactAndroid'))
    substitute(module('com.facebook.react:react-android')).using(project(':packages:react-native:ReactAndroid'))
  }
}
`

module.exports = function withAndroidFontScale(config) {
  // The shared LayoutMetrics header changes ABI. iOS consumers must not mix
  // patched headers with precompiled RN/Expo native modules either.
  config = withPodfileProperties(config, mod => {
    assertPatchedReactNative(mod.modRequest.projectRoot)
    mod.modResults['ios.buildReactNativeFromSource'] = 'true'
    mod.modResults.EXPO_USE_PRECOMPILED_MODULES = 'false'
    return mod
  })
  config = withSettingsGradle(config, mod => {
    assertPatchedReactNative(mod.modRequest.projectRoot)
    if (!mod.modResults.contents.includes(marker)) mod.modResults.contents += sourceBuild
    return mod
  })
  config = withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Retained font-scale layout requires Kotlin MainActivity.')
    mod.modResults.contents = patchActivity(mod.modResults.contents)
    return mod
  })
  return withAndroidManifest(config, mod => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(mod.modResults)
    const changes = new Set((activity.$['android:configChanges'] || '').split('|').filter(Boolean))
    changes.add('fontScale')
    activity.$['android:configChanges'] = [...changes].join('|')
    return mod
  })
}
module.exports.patchActivity = patchActivity
module.exports.assertPatchedReactNative = assertPatchedReactNative
