const { withAndroidManifest } = require('@expo/config-plugins')

const mainActivityName = '.MainActivity'
const keyboardMode = 'adjustNothing'

function withAndroidSoftInputMode(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0]
    const activities = application?.activity ?? []
    const mainActivity = activities.find((activity) => activity.$?.['android:name'] === mainActivityName)
    if (!mainActivity?.$) {
      throw new Error('Unable to find MainActivity for Android soft input mode configuration.')
    }
    mainActivity.$['android:windowSoftInputMode'] = keyboardMode
    return mod
  })
}

module.exports = withAndroidSoftInputMode
