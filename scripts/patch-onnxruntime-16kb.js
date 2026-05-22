const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const cmakePath = path.join(projectRoot, 'node_modules', 'onnxruntime-react-native', 'android', 'CMakeLists.txt')

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

function main() {
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

main()
