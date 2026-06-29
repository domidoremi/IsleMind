const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const buildGradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle')
const gradlePropertiesPath = path.join(projectRoot, 'android', 'gradle.properties')
const mainApplicationPath = path.join(
  projectRoot,
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'islemind',
  'app',
  'MainApplication.kt',
)
const args = new Set(process.argv.slice(2))
const skipSigning = args.has('--skip-signing')
const releaseGradleJvmArgs = '-Xmx2048m -XX:MaxMetaspaceSize=1024m'

if (!fs.existsSync(buildGradlePath)) {
  throw new Error(`Android build.gradle was not found at ${buildGradlePath}. Run expo prebuild first.`)
}

function ensureLauncherBackgroundDrawable() {
  const drawableDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res', 'drawable')
  const launcherBackgroundPath = path.join(drawableDir, 'ic_launcher_background.xml')
  if (fs.existsSync(launcherBackgroundPath)) return
  fs.mkdirSync(drawableDir, { recursive: true })
  fs.writeFileSync(
    launcherBackgroundPath,
    '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n  <solid android:color="@color/iconBackground" />\n</shape>\n',
  )
}

function ensureGradleJvmArgs() {
  if (!fs.existsSync(gradlePropertiesPath)) return

  const source = fs.readFileSync(gradlePropertiesPath, 'utf8')
  const lines = source.split(/\r?\n/)
  let found = false
  const nextLines = lines.map((line) => {
    if (!line.startsWith('org.gradle.jvmargs=')) return line
    found = true
    return `org.gradle.jvmargs=${releaseGradleJvmArgs}`
  })

  if (!found) {
    nextLines.push(`org.gradle.jvmargs=${releaseGradleJvmArgs}`)
  }

  fs.writeFileSync(gradlePropertiesPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
}

function ensureMainApplicationDeprecationSuppress() {
  if (!fs.existsSync(mainApplicationPath)) return

  const source = fs.readFileSync(mainApplicationPath, 'utf8')
  if (!source.includes('ReactNativeHost') || source.includes('@file:Suppress(')) return

  const nextSource = source.replace(
    /^package /,
    '@file:Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")\n\npackage ',
  )
  if (nextSource !== source) {
    fs.writeFileSync(mainApplicationPath, nextSource, 'utf8')
  }
}

ensureLauncherBackgroundDrawable()
ensureGradleJvmArgs()
ensureMainApplicationDeprecationSuppress()

let source = fs.readFileSync(buildGradlePath, 'utf8')

function findMatchingBrace(text, openIndex) {
  let depth = 0
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function findBlock(text, name, startIndex = 0) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`${escaped}\\s*\\{`, 'g')
  pattern.lastIndex = startIndex
  const match = pattern.exec(text)
  if (!match) return null
  const openIndex = text.indexOf('{', match.index)
  const closeIndex = findMatchingBrace(text, openIndex)
  if (closeIndex < 0) return null
  return {
    start: match.index,
    open: openIndex,
    bodyStart: openIndex + 1,
    bodyEnd: closeIndex,
    close: closeIndex,
  }
}

function insertAfterBlockOpen(text, name, snippet) {
  const block = findBlock(text, name)
  if (!block) throw new Error(`Could not find ${name} block in android/app/build.gradle.`)
  return `${text.slice(0, block.bodyStart)}${snippet}${text.slice(block.bodyStart)}`
}

if (!source.includes('islemindAbiFilters')) {
  const androidBlock = findBlock(source, 'android')
  if (!androidBlock) throw new Error('Could not find android block in android/app/build.gradle.')
  const existingSplits = findBlock(source, 'splits', androidBlock.bodyStart)
  if (existingSplits && existingSplits.start < androidBlock.close) {
    source = `${source.slice(0, existingSplits.start)}${source.slice(existingSplits.close + 1)}`
  }
  source = insertAfterBlockOpen(source, 'android', `
    def islemindAbiFilters = (findProperty('islemindAbiFilters') ?: 'arm64-v8a,x86_64')
            .split(',')
            .collect { it.trim() }
            .findAll { it }
    def islemindUniversalApk = (findProperty('islemindUniversalApk') ?: 'true').toBoolean()
    def islemindEnableAbiSplits = (findProperty('islemindEnableAbiSplits') ?: 'true').toBoolean()

    splits {
        abi {
            reset()
            enable islemindEnableAbiSplits
            universalApk islemindUniversalApk
            include(*islemindAbiFilters)
        }
    }
`)
}

if (source.includes('islemindAbiFilters') && !source.includes('islemindEnableAbiSplits')) {
  source = source.replace(
    /(\s*def islemindUniversalApk = \(findProperty\('islemindUniversalApk'\) \?: 'true'\)\.toBoolean\(\)\s*)/,
    `$1    def islemindEnableAbiSplits = (findProperty('islemindEnableAbiSplits') ?: 'true').toBoolean()\n`,
  )
}

source = source.replace(/(\s+)enable true(\s*\n\s*universalApk islemindUniversalApk)/, '$1enable islemindEnableAbiSplits$2')

if (!source.includes('abiFilters(*islemindAbiFilters)')) {
  const defaultConfig = findBlock(source, 'defaultConfig')
  if (!defaultConfig) throw new Error('Could not find defaultConfig block in android/app/build.gradle.')
  source = `${source.slice(0, defaultConfig.bodyEnd)}
        ndk {
            abiFilters(*islemindAbiFilters)
        }
${source.slice(defaultConfig.bodyEnd)}`
}

if (!skipSigning && !source.includes('ISLEMIND_UPLOAD_STORE_FILE')) {
  const signingConfigs = findBlock(source, 'signingConfigs')
  if (!signingConfigs) throw new Error('Could not find signingConfigs block in android/app/build.gradle.')
  const releaseSigningConfig = `
        release {
            if (project.hasProperty('ISLEMIND_UPLOAD_STORE_FILE')) {
                storeFile file(ISLEMIND_UPLOAD_STORE_FILE)
                storePassword ISLEMIND_UPLOAD_STORE_PASSWORD
                keyAlias ISLEMIND_UPLOAD_KEY_ALIAS
                keyPassword ISLEMIND_UPLOAD_KEY_PASSWORD
            } else {
                throw new GradleException("Missing IsleMind Android release signing properties.")
            }
        }
`
  source = `${source.slice(0, signingConfigs.bodyStart)}${releaseSigningConfig}${source.slice(signingConfigs.bodyStart)}`
}

const buildTypes = findBlock(source, 'buildTypes')
if (!buildTypes) throw new Error('Could not find buildTypes block in android/app/build.gradle.')

const releaseBlock = findBlock(source, 'release', buildTypes.bodyStart)
if (!releaseBlock || releaseBlock.start > buildTypes.close) {
  throw new Error('Could not find release buildType in android/app/build.gradle.')
}

if (!skipSigning) {
  const releaseBody = source
    .slice(releaseBlock.bodyStart, releaseBlock.bodyEnd)
    .replace(/^\s*signingConfig\s+signingConfigs\.[A-Za-z0-9_]+\s*$/m, '')
    .trimEnd()

  const nextReleaseBody = `${releaseBody}
            signingConfig signingConfigs.release
`

  source = `${source.slice(0, releaseBlock.bodyStart)}${nextReleaseBody}${source.slice(releaseBlock.bodyEnd)}`
}

fs.writeFileSync(buildGradlePath, source)
console.log(skipSigning ? 'Configured Android ABI split APK outputs.' : 'Configured Android release signing and ABI split APK outputs.')
