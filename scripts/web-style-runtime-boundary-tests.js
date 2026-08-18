const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function main() {
  const packageJson = JSON.parse(read('package.json'))
  const dependencies = packageJson.dependencies ?? {}
  const devDependencies = packageJson.devDependencies ?? {}
  const babelConfig = read('babel.config.js')
  const metroConfig = read('metro.config.js')
  const rootLayout = read('app/_layout.tsx')
  const nativeStyles = read('src/theme/webGlobalStyles.ts')
  const webStyles = read('src/theme/webGlobalStyles.web.ts')
  const globalCss = read('src/global.css')
  const tsconfig = read('tsconfig.json')

  for (const dependency of ['nativewind', 'expo-blur', '@expo/vector-icons']) {
    assert.equal(dependencies[dependency], undefined, `${dependency} must not return as an unused production dependency`)
  }
  assert.equal(devDependencies.tailwindcss, undefined, 'Tailwind must not return without a class-based styling consumer')

  assert.doesNotMatch(babelConfig, /nativewind|jsxImportSource/, 'all JSX must use the standard Expo runtime')
  assert.doesNotMatch(metroConfig, /nativewind|withNativeWind/, 'Metro must not install an unused CSS interop transformer')
  assert.match(rootLayout, /import ['"]\.\.\/src\/theme\/webGlobalStyles['"]/, 'the root loads the platform CSS boundary')
  assert.doesNotMatch(rootLayout, /import ['"]\.\.\/src\/global\.css['"]/, 'native entry must not import web CSS directly')
  assert.doesNotMatch(nativeStyles, /\.css['"]/, 'the native style boundary remains a zero-cost module')
  assert.match(webStyles, /import ['"]\.\.\/global\.css['"]/, 'web keeps the global token and scrollbar stylesheet')
  assert.doesNotMatch(globalCss, /@tailwind\b/, 'the retained stylesheet is plain CSS without Tailwind compilation')
  assert.match(globalCss, /\.composer-input-no-scrollbar/, 'web Composer scrollbar behavior remains styled')
  assert.match(globalCss, /:root\s*\{/, 'web theme fallback variables remain available')
  assert.doesNotMatch(tsconfig, /nativewind-env/, 'TypeScript no longer depends on the removed NativeWind declaration')

  console.log('web style runtime boundary tests passed')
}

main()
