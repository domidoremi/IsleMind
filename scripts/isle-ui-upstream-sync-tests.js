#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const checks = []

function check(name, condition, detail) {
  checks.push({ name, ok: Boolean(condition), detail })
}

const isleKit = read('src/components/ui/isle/IsleKit.tsx')
const isleIndex = read('src/components/ui/isle/index.ts')
const tag = read('src/components/ui/isle/Tag.tsx')
const skeleton = read('src/components/ui/isle/Skeleton.tsx')
const image = read('src/components/ui/isle/Image.tsx')
const backTop = read('src/components/ui/isle/BackTop.tsx')
const readme = read('src/components/ui/isle/README.md')
const themeContract = read('src/theme/animalIslandUiContract.ts')
const themeMotion = read('src/theme/themeMotion.ts')
const locales = ['en.json', 'zh-CN.json', 'ja.json'].map((name) => JSON.parse(read(`src/i18n/resources/${name}`)))

for (const name of ['Tag', 'Image', 'Skeleton', 'BackTop']) {
  check(`registry includes ${name}`, new RegExp(`['\"]${name}['\"]`).test(isleKit), 'ISLE_UI_COMPONENTS must advertise every synchronized upstream component')
}

for (const file of ['Tag', 'Skeleton', 'Image', 'BackTop']) {
  check(`barrel exports ${file}`, isleIndex.includes(`export * from './${file}'`), 'the public Isle UI barrel must expose synchronized components')
}

check('sync status pins npm 1.5.1', /npm `1\.5\.1`/.test(readme), 'sync documentation must identify the reviewed package version')
check('sync status pins upstream commit', /commit `803cffa`/.test(readme), 'sync documentation must identify the reviewed upstream commit')
check('central contract pins the live upstream review', /reviewedVersion: '1\.5\.1'/.test(themeContract) && /reviewedCommit: '803cffa/.test(themeContract) && /reviewedAt: '2026-08-07'/.test(themeContract), 'the central contract must move with every upstream review')
check('all themes retain Animal Island contracts', ['minimal', 'monet', 'material', "'liquid-glass'"].every((theme) => themeContract.includes(theme)) && /Record<CanonicalThemeId, AnimalIslandUiThemeSupport>/.test(themeContract), 'all canonical themes keep the adapted Isle primitive contract')
check('tag defaults to soft and exposes close semantics', /variant = 'soft'/.test(tag) && /closeAccessibilityLabel/.test(tag) && /accessibilityRole="button"/.test(tag), 'Tag.soft, close labeling, and interactive semantics must remain explicit')
check('skeleton respects reduced motion and stays hidden from accessibility', /useMotionPreference/.test(skeleton) && /accessibilityElementsHidden/.test(skeleton) && /importantForAccessibility="no-hide-descendants"/.test(skeleton), 'skeleton animation must respect motion preference and avoid noisy accessibility output')
check('image uses native preview safety contracts', /from 'expo-image'/.test(image) && /onRequestClose/.test(image) && /useSafeAreaInsets/.test(image) && /accessibilityRole="image"/.test(image), 'image preview must use Expo Image, Android Back handling, safe areas, and image semantics')
check('back top uses owner supplied scroll authority', /target: \(\) => IsleScrollToTopTarget/.test(backTop) && /scrollToOffset/.test(backTop) && /scrollTo\?\./.test(backTop), 'BackTop must not assume a global DOM scroll target')
check('time supports the upstream game and hud layouts', /export type IsleTimeType = 'hud' \| 'game'/.test(isleKit) && /type = 'game'/.test(isleKit) && /Intl\.DateTimeFormat/.test(isleKit), 'Time.type must default to the native localized game layout while retaining hud')
check('input resting border is transparent', /status === 'warning' \? palette\.ui\.tone\.warning\.border : 'transparent'/.test(isleKit), 'the upstream borderless treatment must preserve only focus and status borders')
check('input clear behavior supports controlled and uncontrolled values', /const controlled = value !== undefined/.test(isleKit) && /setUncontrolledValue\(''\)/.test(isleKit) && /onClear\?\.\(\)/.test(isleKit), 'Input clear behavior must preserve both React Native control modes')
check('input exposes invalid and disabled accessibility state', /aria-invalid=\{status === 'error' \|\| undefined\}/.test(isleKit) && /accessibilityState=\{disabled/.test(isleKit), 'Input status must remain available to native and web accessibility consumers')

for (const [index, locale] of locales.entries()) {
  check(`locale ${index + 1} has image labels`, ['openImagePreview', 'closeImagePreview', 'imageLoadFailed'].every((key) => typeof locale.common?.[key] === 'string' && locale.common[key].length > 0), 'every supported locale needs image preview and failure labels')
}

const synchronizedSource = tag + skeleton + image + backTop
for (const forbidden of ['react-dom', 'classnames', '.module.less', 'base64?raw']) {
  check(`native sync excludes ${forbidden}`, !synchronizedSource.includes(forbidden), 'React DOM, Less, and upstream bitmap assets must stay outside IsleMind')
}

const failures = checks.filter((item) => !item.ok)
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`)
  if (!item.ok) console.log(`  ${item.detail}`)
}

if (failures.length) {
  console.error(`isle ui upstream sync failed: ${failures.length} issue(s)`)
  process.exit(1)
}

console.log(`isle ui upstream sync passed: ${checks.length} checks`)
