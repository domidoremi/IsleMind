const fs = require('fs')
const path = require('path')
const {
  AndroidConfig,
  XML,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
  withDangerousMod,
} = require('@expo/config-plugins')

const splashTheme = { name: 'Theme.App.SplashScreen' }
const splashBackgroundLight = '#F8FAF9'
const splashBackgroundDark = '#101513'
const splashBackgroundDrawable = '@drawable/islemind_splash_background'

function withAndroidStaticLaunch(config) {
  config = withAndroidColors(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: 'splashscreen_background',
      value: splashBackgroundLight,
    })
    return mod
  })

  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: 'splashscreen_background',
      value: splashBackgroundDark,
    })
    return mod
  })

  config = withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: splashTheme,
      name: 'android:windowBackground',
      value: splashBackgroundDrawable,
    })
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      parent: splashTheme,
      name: 'android:windowAnimationStyle',
      value: '@null',
    })
    return mod
  })

  return withDangerousMod(config, ['android', async (mod) => {
    const resourceRoot = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res')
    removeLegacySplashImages(resourceRoot)
    writeLauncherBackground(resourceRoot)
    writeSplashBackground(resourceRoot)
    await writeAndroid12SplashTheme(resourceRoot)
    return mod
  }])
}

function removeLegacySplashImages(resourceRoot) {
  const staleImages = ['splashscreen_logo.png', 'islemind_splash_icon.png']
  for (const entry of fs.readdirSync(resourceRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('drawable')) continue
    for (const image of staleImages) {
      const candidate = path.join(resourceRoot, entry.name, image)
      if (fs.existsSync(candidate)) fs.rmSync(candidate)
    }
  }
  const xmlCandidate = path.join(resourceRoot, 'drawable', 'splashscreen_logo.xml')
  if (fs.existsSync(xmlCandidate)) fs.rmSync(xmlCandidate)
}

function writeLauncherBackground(resourceRoot) {
  const drawableDir = path.join(resourceRoot, 'drawable')
  fs.mkdirSync(drawableDir, { recursive: true })
  fs.writeFileSync(
    path.join(drawableDir, 'ic_launcher_background.xml'),
    '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n  <solid android:color="@color/iconBackground" />\n</shape>\n',
    'utf8',
  )
}

function writeSplashBackground(resourceRoot) {
  const drawableDir = path.join(resourceRoot, 'drawable')
  fs.mkdirSync(drawableDir, { recursive: true })
  fs.writeFileSync(
    path.join(drawableDir, 'islemind_splash_background.xml'),
    `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n  <item android:drawable="@color/splashscreen_background" />\n</layer-list>\n`,
    'utf8',
  )
}

async function writeAndroid12SplashTheme(resourceRoot) {
  const valuesDir = path.join(resourceRoot, 'values-v31')
  const stylesPath = path.join(valuesDir, 'styles.xml')
  fs.mkdirSync(valuesDir, { recursive: true })
  const xml = await AndroidConfig.Resources.readResourcesXMLAsync({ path: stylesPath })
  xml.resources.style = Array.isArray(xml.resources.style) ? xml.resources.style : []
  let theme = AndroidConfig.Resources.findResourceGroup(xml.resources.style, splashTheme)
  if (!theme) {
    theme = AndroidConfig.Resources.buildResourceGroup({
      name: splashTheme.name,
      parent: 'AppTheme',
    })
    xml.resources.style.push(theme)
  }
  theme.$.parent = 'AppTheme'
  theme.item = theme.item ?? []
  setResourceItem(theme.item, 'android:windowBackground', splashBackgroundDrawable)
  setResourceItem(theme.item, 'android:windowAnimationStyle', '@null')
  setResourceItem(theme.item, 'android:windowSplashScreenBackground', '@color/splashscreen_background')
  // No custom splash icon: on Android 12+ the system falls back to the launcher
  // icon for a brief moment, then hands off to the React loading animation.
  // Drop any previously written icon items so re-runs stay clean.
  removeResourceItem(theme.item, 'android:windowSplashScreenIconBackgroundColor')
  removeResourceItem(theme.item, 'android:windowSplashScreenAnimatedIcon')
  setResourceItem(theme.item, 'android:windowSplashScreenAnimationDuration', '0')
  await XML.writeXMLAsync({ path: stylesPath, xml })
}

function setResourceItem(items, name, value) {
  const existing = items.find((item) => item.$?.name === name)
  if (existing) {
    existing._ = value
    return
  }
  items.push(AndroidConfig.Resources.buildResourceItem({ name, value }))
}

function removeResourceItem(items, name) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].$?.name === name) items.splice(i, 1)
  }
}

module.exports = withAndroidStaticLaunch
