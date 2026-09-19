const fs = require('node:fs')
const path = require('node:path')
const YAML = require('yaml')
const vm = require('node:vm')
const { parse } = require('@babel/parser')
const { transformTypeScriptModule } = require('./node-ts-support')

const root = path.resolve(__dirname, '..')
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const json = name => JSON.parse(read(name))

test('settings display keeps installed build identity and uses Expo versionCode on Web', () => {
  const source = read('src/components/main/SettingsScreenContent.tsx')
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const declaration = ast.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'getSettingsVersionSnapshot')
  expect(declaration).toBeDefined()
  const code = transformTypeScriptModule(source.slice(declaration.start, declaration.end), 'settings-version.ts')
  const Application = { nativeApplicationVersion: '1.1.0', nativeBuildVersion: '124' }
  const Constants = { expoConfig: { version: '1.1.0', android: { versionCode: 125 } }, platform: undefined }
  const snapshot = () => vm.runInNewContext(`${code}; getSettingsVersionSnapshot()`, { Application, Constants, sourceAppConfig: json('app.json') })
  expect(snapshot().buildVersion).toBe('124')
  Application.nativeBuildVersion = null
  expect(snapshot().buildVersion).toBe('125')
  expect(snapshot().appVersion).toBe('1.1.0')
  Constants.expoConfig.android = undefined
  Constants.platform = { android: { versionCode: 123 } }
  expect(snapshot().buildVersion).toBe('123')
  Constants.platform = undefined
  expect(snapshot().buildVersion).toBe(String(json('app.json').expo.android.versionCode))
})

test('source, update metadata, website and localized READMEs agree on the qualification version', () => {
  const pkg = json('package.json')
  const app = json('app.json').expo
  const update = json('updates/android.json')
  const site = json('website/site-meta.json')
  expect(app.version).toBe(pkg.version)
  expect(update.versionName).toBe(pkg.version)
  expect(site.version).toBe(pkg.version)
  expect(json('website/package.json').version).toBe(pkg.version)
  expect(update.versionCode).toBe(app.android.versionCode)
  expect(site.versionCode).toBe(app.android.versionCode)
  expect(update.status).toBe('prerelease-qualification')
  expect(site.status).toBe(update.status)
  expect(update.assets).toEqual([])
  expect(update.publishedAt).toBeNull()
  expect(site.releaseDate).toBeNull()
  for (const name of ['README.md', 'README.zh.md', 'README.ja.md']) {
    expect(read(name)).toContain(`\`${pkg.version}\``)
    expect(read(name)).toContain(`\`${app.android.versionCode}\``)
    expect(read(name)).not.toMatch(/releases\/download\//)
  }
})

test('Pages uploads the static root through an explicit deployment, without APK build steps', () => {
  const workflow = YAML.parse(read('.github/workflows/website-pages.yml'))
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  expect(workflow.permissions.contents).toBe('read')
  expect(workflow.jobs.deploy.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
  expect(workflow.jobs.deploy.environment.name).toBe('github-pages')
  const steps = workflow.jobs.deploy.steps
  expect(steps.find(step => step.uses?.startsWith('actions/upload-pages-artifact@')).with.path).toBe('website')
  expect(steps.some(step => step.uses?.startsWith('actions/deploy-pages@'))).toBe(true)
  expect(steps.some(step => step.run)).toBe(false)
  expect(fs.existsSync(path.join(root, 'website/.nojekyll'))).toBe(true)
})

test('static assets resolve below the project-site base path and no unavailable binary is advertised', () => {
  const html = read('website/index.html')
  const script = read('website/main.js')
  const pkg = json('package.json')
  for (const match of `${html}\n${script}`.matchAll(/["'](\.\/[^"'<>\s]+)["']/g)) {
    expect(fs.existsSync(path.resolve(root, 'website', match[1]))).toBe(true)
  }
  expect(html).toContain('https://domidoremi.github.io/IsleMind/')
  expect(html).toContain(`data-release-version>v${pkg.version}`)
  expect(html).toContain('预发布资格验证中 · 暂无 APK')
  expect(html).not.toMatch(/LATEST BUILD|>AVAILABLE<|下载 Android 版|releases\/download\//)
  expect(html).not.toMatch(/(?:href|src)="\/(?:assets|main\.js|styles\.css)/)
})
