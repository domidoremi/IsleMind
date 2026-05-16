const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const buildGradlePath = path.join(projectRoot, 'android', 'app', 'build.gradle')

if (!fs.existsSync(buildGradlePath)) {
  throw new Error(`Android build.gradle was not found at ${buildGradlePath}. Run expo prebuild first.`)
}

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

if (!source.includes('universalApk true')) {
  source = insertAfterBlockOpen(source, 'android', `
    splits {
        abi {
            reset()
            enable true
            universalApk true
            include "arm64-v8a", "armeabi-v7a", "x86_64"
        }
    }
`)
}

if (!source.includes('ISLEMIND_UPLOAD_STORE_FILE')) {
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

const releaseBody = source
  .slice(releaseBlock.bodyStart, releaseBlock.bodyEnd)
  .replace(/^\s*signingConfig\s+signingConfigs\.[A-Za-z0-9_]+\s*$/m, '')
  .trimEnd()

const nextReleaseBody = `${releaseBody}
            signingConfig signingConfigs.release
`

source = `${source.slice(0, releaseBlock.bodyStart)}${nextReleaseBody}${source.slice(releaseBlock.bodyEnd)}`

fs.writeFileSync(buildGradlePath, source)
console.log('Configured Android release signing and ABI split APK outputs.')
