const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const assetsDir = path.join(root, 'assets')
const brandDir = path.join(assetsDir, 'brand')
const generatedDir = path.join(brandDir, 'generated')
const androidResDir = path.join(root, 'android', 'app', 'src', 'main', 'res')

fs.mkdirSync(generatedDir, { recursive: true })

const canvas = '#f8f4ec'
const canvasLift = '#fffdf7'
const graphite = '#111918'
const graphiteLift = '#1c2b28'
const mint = '#38b58f'
const mintHot = '#71d9bf'
const cyan = '#5ccfe6'
const amber = '#f0b856'
const coral = '#e56f5c'
const pearl = '#fff8e8'
const stroke = '#273b37'
const rail = '#d9d0bf'

function shellEscapeSvg(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function markSvg({ background = false, title = 'IsleMind mark' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <title>${shellEscapeSvg(title)}</title>
  <defs>
    <linearGradient id="canvasGradient" x1="122" y1="76" x2="888" y2="928" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fdfaf3"/>
      <stop offset="0.44" stop-color="${canvas}"/>
      <stop offset="1" stop-color="#dcebe5"/>
    </linearGradient>
    <radialGradient id="fieldGlow" cx="70%" cy="16%" r="84%">
      <stop offset="0" stop-color="${mintHot}" stop-opacity="0.34"/>
      <stop offset="0.36" stop-color="${cyan}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${canvas}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="coreGradient" x1="286" y1="148" x2="770" y2="848" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${graphiteLift}"/>
      <stop offset="0.58" stop-color="${graphite}"/>
      <stop offset="1" stop-color="#0b1110"/>
    </linearGradient>
    <linearGradient id="signalGradient" x1="236" y1="402" x2="818" y2="622" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${cyan}"/>
      <stop offset="0.52" stop-color="${mint}"/>
      <stop offset="1" stop-color="${amber}"/>
    </linearGradient>
    <linearGradient id="innerRoute" x1="300" y1="322" x2="754" y2="720" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${mintHot}"/>
      <stop offset="0.42" stop-color="${mint}"/>
      <stop offset="1" stop-color="${cyan}"/>
    </linearGradient>
    <linearGradient id="pearlGradient" x1="330" y1="258" x2="722" y2="776" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${canvasLift}"/>
      <stop offset="1" stop-color="${pearl}"/>
    </linearGradient>
    <filter id="softShadow" x="-22%" y="-24%" width="144%" height="150%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="34" stdDeviation="28" flood-color="#14201d" flood-opacity="0.32"/>
    </filter>
    <filter id="signalGlow" x="-30%" y="-60%" width="160%" height="220%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="0" stdDeviation="13" flood-color="${mintHot}" flood-opacity="0.48"/>
    </filter>
    <filter id="pinShadow" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#07100e" flood-opacity="0.32"/>
    </filter>
    <clipPath id="coreClip">
      <path d="M512 118C656 152 776 245 836 374C900 512 868 666 754 770C674 842 574 876 512 906C450 876 350 842 270 770C156 666 124 512 188 374C248 245 368 152 512 118Z"/>
    </clipPath>
  </defs>
  ${background ? `<rect width="1024" height="1024" rx="228" fill="url(#canvasGradient)"/>
  <rect width="1024" height="1024" rx="232" fill="url(#fieldGlow)"/>
  <path d="M98 364C250 300 430 288 612 324C746 350 846 416 920 510" fill="none" stroke="${cyan}" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round"/>
  <path d="M98 704C260 776 444 792 624 748C766 714 866 642 930 544" fill="none" stroke="${amber}" stroke-opacity="0.18" stroke-width="10" stroke-linecap="round"/>
  <path d="M112 518H906" fill="none" stroke="${rail}" stroke-opacity="0.52" stroke-width="4" stroke-linecap="round"/>
  <circle cx="804" cy="244" r="38" fill="#e6faf2" stroke="${mint}" stroke-opacity="0.34" stroke-width="6"/>
  <path d="M804 224V264M784 244H824" fill="none" stroke="${mint}" stroke-width="10" stroke-linecap="round" opacity="0.86"/>` : ''}
  <g filter="url(#softShadow)">
    <path d="M512 118C656 152 776 245 836 374C900 512 868 666 754 770C674 842 574 876 512 906C450 876 350 842 270 770C156 666 124 512 188 374C248 245 368 152 512 118Z" fill="url(#coreGradient)" stroke="${canvasLift}" stroke-width="18" stroke-linejoin="round"/>
    <path d="M512 118C656 152 776 245 836 374C900 512 868 666 754 770C674 842 574 876 512 906C450 876 350 842 270 770C156 666 124 512 188 374C248 245 368 152 512 118Z" fill="none" stroke="${stroke}" stroke-opacity="0.72" stroke-width="8" stroke-linejoin="round"/>
    <g clip-path="url(#coreClip)">
      <path d="M208 540C314 442 436 424 520 480C598 532 622 634 704 654C762 668 814 632 862 552" fill="none" stroke="url(#signalGradient)" stroke-width="92" stroke-linecap="round" filter="url(#signalGlow)"/>
      <path d="M250 578C338 506 432 498 506 546C582 596 622 678 700 692C762 704 812 666 842 612" fill="none" stroke="${pearl}" stroke-width="20" stroke-linecap="round" opacity="0.88"/>
      <path d="M326 370L512 250L698 370L512 490Z" fill="url(#pearlGradient)" opacity="0.98"/>
      <path d="M326 370L512 490L512 740L326 620Z" fill="#dff7ef"/>
      <path d="M698 370L512 490L512 740L698 620Z" fill="#c7efe6"/>
      <path d="M326 370L512 250L698 370L512 490Z" fill="none" stroke="${stroke}" stroke-opacity="0.42" stroke-width="12" stroke-linejoin="round"/>
      <path d="M512 490V740" fill="none" stroke="${stroke}" stroke-opacity="0.42" stroke-width="10" stroke-linecap="round"/>
      <path d="M326 370L512 490L698 370" fill="none" stroke="${stroke}" stroke-opacity="0.34" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M512 292L512 690" fill="none" stroke="url(#innerRoute)" stroke-width="36" stroke-linecap="round"/>
      <path d="M400 690H624" fill="none" stroke="url(#innerRoute)" stroke-width="36" stroke-linecap="round"/>
    </g>
    <circle cx="512" cy="258" r="58" fill="${mint}" stroke="${graphite}" stroke-width="16" filter="url(#pinShadow)"/>
    <circle cx="512" cy="258" r="22" fill="${mintHot}"/>
    <circle cx="660" cy="706" r="20" fill="${amber}"/>
    <circle cx="354" cy="620" r="14" fill="${cyan}"/>
  </g>
</svg>`
}

function renderSvg(svgName, outputName, size, options = {}) {
  const svgPath = path.join(generatedDir, svgName)
  const outputPath = path.join(assetsDir, outputName)
  const args = options.transparent
    ? ['-background', 'none', svgPath, '-resize', `${size}x${size}`, '-alpha', 'on', '-depth', '8', '-strip', `PNG32:${outputPath}`]
    : [svgPath, '-resize', `${size}x${size}`, '-alpha', 'on', '-depth', '8', '-strip', outputPath]
  const result = spawnSync('magick', args, {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`ImageMagick failed for ${outputName}`)
  }
}

function writeSvg(name, svg) {
  fs.writeFileSync(path.join(generatedDir, name), svg)
}

function renderImage(inputName, outputPath, size) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const inputPath = path.join(assetsDir, inputName)
  const result = spawnSync('magick', [inputPath, '-resize', `${size}x${size}`, '-alpha', 'on', '-depth', '8', '-strip', outputPath], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`ImageMagick failed for ${outputPath}`)
  }
}

function renderAndroidResources() {
  const splashSizes = [
    ['drawable-mdpi', 224],
    ['drawable-hdpi', 336],
    ['drawable-xhdpi', 448],
    ['drawable-xxhdpi', 672],
    ['drawable-xxxhdpi', 896],
  ]
  for (const [density, size] of splashSizes) {
    renderImage('splash-icon.png', path.join(androidResDir, density, 'splashscreen_logo.png'), size)
  }

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

writeSvg('islemind-app-icon.svg', markSvg({ background: true, title: 'IsleMind app icon' }))
writeSvg('islemind-mark.svg', markSvg({ background: false, title: 'IsleMind splash mark' }))

renderSvg('islemind-app-icon.svg', 'icon.png', 1024)
renderSvg('islemind-app-icon.svg', 'adaptive-icon.png', 1024)
renderSvg('islemind-mark.svg', 'adaptive-foreground.png', 1024, { transparent: true })
renderSvg('islemind-mark.svg', 'splash-icon.png', 1024, { transparent: true })
renderSvg('islemind-app-icon.svg', 'favicon.png', 48)
renderAndroidResources()

console.log('Generated IsleMind brand assets.')
