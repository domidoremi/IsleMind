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

function pinNativeRuntimeSources(gradle, cmake) {
  const versionDeclaration = 'def onnxRuntimeVersion = new groovy.json.JsonSlurper().parse(file("../package.json")).version'
  if (!gradle.includes(versionDeclaration)) {
    const anchor = 'boolean useQnn = readPackageJsonField(\'onnxruntimeUseQnn\') == "true"'
    const cmakeArgument = '"-DNODE_MODULES_DIR=${nodeModules}",'
    if (!gradle.includes(anchor) || !gradle.includes(cmakeArgument)
      || !gradle.includes('onnxruntime-android:latest.integration@aar')
      || !gradle.includes('onnxruntime-android-qnn:latest.integration@aar')) {
      throw new Error('[patch-onnxruntime-16kb] unknown ONNX Android dependency configuration')
    }
    gradle = gradle.replace(anchor, `${anchor}\n\n${versionDeclaration}\n`
      + 'def onnxRuntimeAar = (useQnn ? "onnxruntime-android-qnn" : "onnxruntime-android") + "-${onnxRuntimeVersion}.aar"')
      .replaceAll('onnxruntime-android:latest.integration@aar', 'onnxruntime-android:${onnxRuntimeVersion}@aar')
      .replaceAll('onnxruntime-android-qnn:latest.integration@aar', 'onnxruntime-android-qnn:${onnxRuntimeVersion}@aar')
      .replaceAll(cmakeArgument, `${cmakeArgument}\n            "-DORT_ANDROID_AAR=\${onnxRuntimeAar}",`)
  }
  const exactIncludes = 'set(onnxruntime_include_DIRS "${BUILD_DIR}/${ORT_ANDROID_AAR}/headers")\n'
    + 'set(onnxruntime_link_DIRS "${BUILD_DIR}/${ORT_ANDROID_AAR}/jni/${ANDROID_ABI}")'
  const exactLibrary = 'set(onnxruntime-lib "${onnxruntime_link_DIRS}/libonnxruntime.so")'
  if (!cmake.includes(exactIncludes) || !cmake.includes(exactLibrary)) {
    const globIncludes = 'file(GLOB onnxruntime_include_DIRS\n     "${BUILD_DIR}/onnxruntime-android-*.aar/headers")\n'
      + 'file(GLOB onnxruntime_link_DIRS\n     "${BUILD_DIR}/onnxruntime-android-*.aar/jni/${ANDROID_ABI}/")'
    const findLibrary = 'find_library(\n  onnxruntime-lib onnxruntime\n  PATHS ${onnxruntime_link_DIRS}\n  NO_CMAKE_FIND_ROOT_PATH)'
    if (!cmake.includes(globIncludes) || !cmake.includes(findLibrary)) {
      throw new Error('[patch-onnxruntime-16kb] unknown ONNX CMake library selection')
    }
    // Keep old extracted AARs/cache intact, but never compile against their
    // headers or reuse find_library's cached path from another runtime version.
    cmake = cmake.replace(globIncludes, exactIncludes).replace(findLibrary, exactLibrary)
  }
  if (gradle.includes('onnxruntime-android:latest.integration@aar')
    || gradle.includes('onnxruntime-android-qnn:latest.integration@aar')
    || !gradle.includes('"-DORT_ANDROID_AAR=${onnxRuntimeAar}",')) {
    throw new Error('[patch-onnxruntime-16kb] incomplete native ONNX version pin')
  }
  return { gradle, cmake }
}

function main() {
  patchCmake()
  patchGradle()
  if (fs.existsSync(gradlePath) && fs.existsSync(cmakePath)) {
    const gradle = fs.readFileSync(gradlePath, 'utf8')
    const cmake = fs.readFileSync(cmakePath, 'utf8')
    const pinned = pinNativeRuntimeSources(gradle, cmake)
    if (pinned.gradle !== gradle) fs.writeFileSync(gradlePath, pinned.gradle)
    if (pinned.cmake !== cmake) fs.writeFileSync(cmakePath, pinned.cmake)
    console.log('[patch-onnxruntime-16kb] native AAR and exact CMake paths match the installed JS package version')
  }
}

if (require.main === module) main()
module.exports = { pinNativeRuntimeSources }
