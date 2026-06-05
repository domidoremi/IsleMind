const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const assetsDir = path.join(root, 'assets')
const brandDir = path.join(assetsDir, 'brand')
const sourceDir = path.join(brandDir, 'source')
const generatedDir = path.join(brandDir, 'generated')
const androidResDir = path.join(root, 'android', 'app', 'src', 'main', 'res')

const iconBackground = '#F8F4EC'
const yellowKey = '#FDFB08'
const petSource = path.join(sourceDir, 'isle-pet-preview-base.png')

fs.mkdirSync(sourceDir, { recursive: true })
fs.mkdirSync(generatedDir, { recursive: true })

if (!fs.existsSync(petSource)) {
  throw new Error(`Missing pet icon source: ${path.relative(root, petSource)}`)
}

function runMagick(args, label) {
  const result = spawnSync('magick', args, {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`ImageMagick failed for ${label}`)
  }
}

function petCutoutArgs(maxSubjectSize) {
  return [
    petSource,
    '-alpha',
    'set',
    '-fuzz',
    '28%',
    '-transparent',
    yellowKey,
    '-fill',
    '#061339',
    '-fuzz',
    '30%',
    '-opaque',
    '#7A7515',
    '-fuzz',
    '28%',
    '-trim',
    '+repage',
    '-filter',
    'point',
    '-resize',
    `${maxSubjectSize}x${maxSubjectSize}`,
  ]
}

function renderTransparentPet(outputPath, size, maxSubjectSize) {
  runMagick(
    [
      ...petCutoutArgs(maxSubjectSize),
      '-background',
      'none',
      '-gravity',
      'center',
      '-extent',
      `${size}x${size}`,
      '-alpha',
      'on',
      '-depth',
      '8',
      '-strip',
      `PNG32:${outputPath}`,
    ],
    path.relative(root, outputPath)
  )
}

function renderOpaquePetIcon(outputPath, size, maxSubjectSize) {
  runMagick(
    [
      '-size',
      `${size}x${size}`,
      `xc:${iconBackground}`,
      '(',
      ...petCutoutArgs(maxSubjectSize),
      ')',
      '-gravity',
      'center',
      '-compose',
      'over',
      '-composite',
      '-alpha',
      'remove',
      '-alpha',
      'off',
      '-depth',
      '8',
      '-strip',
      outputPath,
    ],
    path.relative(root, outputPath)
  )
}

function renderImage(inputName, outputPath, size) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const inputPath = path.join(assetsDir, inputName)
  runMagick(
    [inputPath, '-filter', 'point', '-resize', `${size}x${size}`, '-alpha', 'on', '-depth', '8', '-strip', outputPath],
    path.relative(root, outputPath)
  )
}

function writeIconBackgroundResources() {
  const valuesDir = path.join(androidResDir, 'values')
  const drawableDir = path.join(androidResDir, 'drawable')
  fs.mkdirSync(valuesDir, { recursive: true })
  fs.mkdirSync(drawableDir, { recursive: true })

  const colorsPath = path.join(valuesDir, 'colors.xml')
  const colorsXml = `<resources>
  <color name="iconBackground">${iconBackground}</color>
  <color name="colorPrimary">#023c69</color>
  <color name="colorPrimaryDark">#ffffff</color>
</resources>
`
  fs.writeFileSync(colorsPath, colorsXml, 'utf8')

  const backgroundPath = path.join(drawableDir, 'ic_launcher_background.xml')
  const backgroundXml =
    '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n  <solid android:color="@color/iconBackground" />\n</shape>\n'
  fs.writeFileSync(backgroundPath, backgroundXml, 'utf8')
}

function renderAndroidResources() {
  const launcherSizes = [
    ['mipmap-mdpi', 48, 108],
    ['mipmap-hdpi', 72, 162],
    ['mipmap-xhdpi', 96, 216],
    ['mipmap-xxhdpi', 144, 324],
    ['mipmap-xxxhdpi', 192, 432],
  ]
  for (const [density, iconSize, foregroundSize] of launcherSizes) {
    renderImage('icon.png', path.join(androidResDir, density, 'ic_launcher.webp'), iconSize)
    renderImage('icon.png', path.join(androidResDir, density, 'ic_launcher_round.webp'), iconSize)
    renderImage('adaptive-foreground.png', path.join(androidResDir, density, 'ic_launcher_foreground.webp'), foregroundSize)
  }
}

renderOpaquePetIcon(path.join(assetsDir, 'icon.png'), 1024, 820)
renderOpaquePetIcon(path.join(assetsDir, 'adaptive-icon.png'), 1024, 820)
renderTransparentPet(path.join(assetsDir, 'adaptive-foreground.png'), 1024, 620)
renderTransparentPet(path.join(assetsDir, 'splash-icon.png'), 1024, 760)
renderOpaquePetIcon(path.join(assetsDir, 'favicon.png'), 48, 40)
renderTransparentPet(path.join(generatedDir, 'isle-pet-icon-transparent.png'), 1024, 820)
writeIconBackgroundResources()
renderAndroidResources()

console.log('Generated IsleMind pet brand assets.')
