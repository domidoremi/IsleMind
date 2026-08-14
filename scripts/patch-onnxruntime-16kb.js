const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const cmakePath = path.join(projectRoot, 'node_modules', 'onnxruntime-react-native', 'android', 'CMakeLists.txt')
const gradlePath = path.join(projectRoot, 'node_modules', 'onnxruntime-react-native', 'android', 'build.gradle')

const marker = '# IsleMind: Android 16 KB page-size support'
const block = `
${marker}
if(CMAKE_SYSTEM_NAME STREQUAL "Android")
  target_link_options(
    onnxruntimejsi
    PRIVATE
      "-Wl,-z,max-page-size=16384"
      "-Wl,-z,common-page-size=16384"
  )
endif()
`

function patchCmake() {
  if (!fs.existsSync(cmakePath)) {
    console.warn(`[patch-onnxruntime-16kb] skipped; missing ${path.relative(projectRoot, cmakePath)}`)
    return
  }

  const source = fs.readFileSync(cmakePath, 'utf8')
  if (source.includes(marker)) {
    console.log('[patch-onnxruntime-16kb] already applied')
    return
  }

  const anchor = `find_library(log-lib log)\n\n`
  if (!source.includes(anchor)) {
    throw new Error('[patch-onnxruntime-16kb] failed to locate CMake insertion anchor')
  }

  fs.writeFileSync(cmakePath, source.replace(anchor, `${anchor}${block}\n`))
  console.log('[patch-onnxruntime-16kb] applied 16 KB ELF alignment flags to onnxruntimejsi')
}

function patchGradle() {
  if (!fs.existsSync(gradlePath)) {
    console.warn(`[patch-onnxruntime-16kb] skipped; missing ${path.relative(projectRoot, gradlePath)}`)
    return
  }

  const source = fs.readFileSync(gradlePath, 'utf8')
  const legacyCondition = 'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {'
  const compatibleCondition = 'if (REACT_NATIVE_MINOR_VERSION < 71) {'
  if (source.includes(compatibleCondition)) {
    console.log('[patch-onnxruntime-16kb] Gradle 9 compatibility already applied')
    return
  }
  if (!source.includes(legacyCondition)) {
    throw new Error('[patch-onnxruntime-16kb] failed to locate Gradle 9 compatibility anchor')
  }

  fs.writeFileSync(gradlePath, source.replace(legacyCondition, compatibleCondition))
  console.log('[patch-onnxruntime-16kb] applied Gradle 9 compatibility to onnxruntime-react-native')
}

function main() {
  patchCmake()
  patchGradle()
}

main()
