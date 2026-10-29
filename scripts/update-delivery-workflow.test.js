const fs = require('node:fs')
const path = require('node:path')
const yaml = require('yaml')
const { parseReleaseChangeRecord, parseReleasePolicy } = require('./release-plan-contract')
const { releaseApkMatrix } = require('./validate-release-apk-set')
const root = path.resolve(__dirname, '..')

test('release planning remains in a read-only PR/dispatch gate, not an automatic privileged publishing workflow', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/architecture-gates.yml'), 'utf8'))
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(workflow.on).toHaveProperty('pull_request')
  expect(workflow.on).not.toHaveProperty('pull_request_target')
  expect(workflow.on).not.toHaveProperty('workflow_run')
  const steps = workflow.jobs.architecture.steps
  const checkout = steps.find((step) => step.name === 'Checkout')
  expect(checkout.with).toMatchObject({ 'fetch-depth': 0, 'persist-credentials': false })
  const planning = steps.find((step) => step.name === 'Read-only release plan')
  expect(planning.run).toBe('node scripts/release-plan.js --base "$PLAN_BASE" --head "$PLAN_HEAD"')
  expect(planning.env).not.toHaveProperty('GH_TOKEN')
  expect(JSON.stringify(planning)).not.toMatch(/secrets\.|workflow_dispatch|gh release|gradle|assemble|git push/)
})

test('catalog tooling is a lazy public Settings entry and has no active endpoint or shell crypto dependency', () => {
  const index = fs.readFileSync(path.join(root, 'src/modules/settings/index.ts'), 'utf8')
  const entry = fs.readFileSync(path.join(root, 'src/modules/settings/updateCatalogEntry.ts'), 'utf8')
  expect(index).toContain("export * from './updateCatalogEntry'")
  expect(index).not.toContain("export * from './updateCatalogSelection'")
  expect(entry).toContain("import('@/core/signedUpdateCatalog')")
  expect(entry).toContain("import('./updateCatalogSelection')")
  const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8')
  expect(layout).not.toMatch(/loadUpdateCatalogTools|verifySignedUpdateCatalog/)
  expect(fs.readFileSync(path.join(root, 'src/platform/native/androidApkUpdates.ts'), 'utf8')).toContain("hotUpdateMode: 'disabled'")
})

test('pending records have stable filename identities and do not mutate public historical release notes', () => {
  const directory = path.join(root, 'updates/changes')
  const filenames = fs.readdirSync(directory).filter((name) => name.endsWith('.json'))
  expect(filenames.length).toBeGreaterThan(0)
  const ids = filenames.map((filename) => {
    const record = parseReleaseChangeRecord(JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8')))
    expect(filename).toBe(`${record.id}.json`)
    expect(record.files.some((file) => /^docs\/release\/v/.test(file))).toBe(false)
    return record.id
  })
  expect(new Set(ids).size).toBe(ids.length)
  const policy = parseReleasePolicy(JSON.parse(fs.readFileSync(path.join(root, 'updates/release-policy.json'), 'utf8')))
  expect(policy.otaEnabled).toBe(false)
  expect(policy.routineMinimumChanges).toBe(5)
})

test('planning and verification scripts contain no build, installer, network or publication entry', () => {
  for (const filename of ['release-plan.js', 'verify-update-catalog.js', 'release-plan-contract.js']) {
    const text = fs.readFileSync(path.join(root, 'scripts', filename), 'utf8')
    expect(text).not.toMatch(/(?:https?\.request|fetch\(|downloadAndOpenApkInstaller|generateKeyPair|gh release|git push|git commit|assembleRelease|expo prebuild)/)
    expect(text).not.toContain('writeFileSync')
  }
})

test('signed APK builds default to candidate artifacts and require separate explicit publication', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const inputs = workflow.on.workflow_dispatch.inputs
  expect(inputs.tag).toMatchObject({ required: true, type: 'string' })
  expect(inputs.publish_release).toMatchObject({ required: true, type: 'boolean', default: false })
  const steps = workflow.jobs['release-android-apk'].steps
  const signing = steps.findIndex((step) => step.name === 'Validate release signing')
  const artifact = steps.findIndex((step) => step.name === 'Upload APK artifact')
  const publication = steps.findIndex((step) => step.name === 'Publish GitHub Release')
  expect(signing).toBeGreaterThan(-1)
  expect(artifact).toBeGreaterThan(signing)
  expect(steps[artifact]).not.toHaveProperty('if')
  expect(publication).toBeGreaterThan(artifact)
  expect(steps[publication].if).toBe('${{ inputs.publish_release == true }}')
  expect(steps[publication].run).toContain('Release tag changed during the build; refusing upload.')
  expect(steps[publication].run).toContain('gh release view "$TAG"')
  expect(steps[publication].run).not.toMatch(/--clobber|gh release create/)
})

test('release matrix preserves all eight architecture/model variants with bounded independent jobs', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
  expect(workflow.permissions).toEqual({ contents: 'read' })
  const build = workflow.jobs['build-release-apk']
  expect(build.needs).toBe('release-quality')
  expect(workflow.jobs['release-quality'].steps.some(step => step.run === 'bun run type-check')).toBe(true)
  expect(build.strategy).toMatchObject({ 'fail-fast': false, 'max-parallel': 4 })
  expect(build.strategy.matrix.include).toEqual(releaseApkMatrix())
  expect(build.strategy.matrix.include).toHaveLength(8)
  expect(build['timeout-minutes']).toBe(120)
  expect(build).not.toHaveProperty('continue-on-error')
})

test('source tag and paired UI resolve once and every matrix producer uses those immutable commits', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const quality = workflow.jobs['release-quality']
  expect(quality.steps.find(step => step.name === 'Checkout').with).toMatchObject({
    ref: 'refs/tags/${{ inputs.tag }}', 'persist-credentials': false,
  })
  expect(quality.outputs).toMatchObject({
    source_commit: '${{ steps.meta.outputs.source_commit }}',
    ui_commit: '${{ steps.ui.outputs.commit }}',
  })
  expect(quality.steps.find(step => step.id === 'meta').run).toContain('source_commit=$(git rev-parse HEAD)')
  expect(quality.steps.find(step => step.id === 'ui').run).toContain('git -C ../animal-island-ui rev-parse HEAD')
  for (const name of ['build-release-apk', 'release-android-apk']) {
    const job = workflow.jobs[name]
    expect(job.steps.find(step => step.name === 'Checkout').with).toMatchObject({
      ref: '${{ needs.release-quality.outputs.source_commit }}', 'persist-credentials': false,
    })
    expect(job.env.ANIMAL_ISLAND_UI_REF).toBe('${{ needs.release-quality.outputs.ui_commit }}')
  }
})

test('the immutable workflow revision is tested before matrix builds without polluting tagged source checks', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const steps = workflow.jobs['release-quality'].steps
  const sourceChecks = steps.findIndex(step => step.name === 'Architecture and recovery contracts')
  const checkout = steps.findIndex(step => step.name === 'Checkout workflow verification tools')
  const verification = steps.findIndex(step => step.name === 'Verify workflow control contracts')
  expect(checkout).toBeGreaterThan(sourceChecks)
  expect(verification).toBeGreaterThan(checkout)
  expect(steps[checkout].with).toEqual({ ref: '${{ github.sha }}', path: '.ci-tools', 'persist-credentials': false })
  const config = JSON.parse(steps[verification].run.match(/--config '([^']+)'/)[1])
  expect(config).toEqual({
    testEnvironment: 'node', transform: {}, roots: ['<rootDir>/.ci-tools/scripts'],
    testMatch: ['**/validate-release-apk-set.test.js', '**/update-delivery-workflow.test.js'],
  })
  const checkoutAction = 'actions/' + 'check' + 'out@v6'
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps.filter(step => step.name.startsWith('Checkout'))) {
      expect(step.uses).toBe(checkoutAction)
    }
  }
})

test('each matrix job assembles only its own APK and captures its active model source before upload', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const steps = workflow.jobs['build-release-apk'].steps
  const build = steps.find(step => step.name === 'Build release APKs')
  expect(build.run.match(/assembleRelease/g)).toHaveLength(1)
  expect(build.run).not.toMatch(/for (?:model_variant|build_pass)\b/)
  expect(build.env).toMatchObject({
    VERSION: '${{ needs.release-quality.outputs.version }}',
    ARCH: '${{ matrix.arch }}',
    ABI_FILTERS: '${{ matrix.abi_filters }}',
    MODEL_VARIANT: '${{ matrix.model_variant }}',
  })
  expect(build.run).toContain('target="dist-apk/IsleMind-${VERSION}-${ARCH}-${MODEL_VARIANT}.apk"')
  expect(build.run).toContain('--fail-on-missing-models')
  expect(build.run).toMatch(/cp "\$\{apks\[0\]\}" "\$target"\s+sha256sum "\$target" > "\$\{target\}\.sha256"\s+bun scripts\/write-release-source-snapshots\.js "\$target"/)
  expect(build.run).not.toMatch(/git restore|prepare-model-bundle\.js --variant no-model/)
})

test('each variant upload waits for signing and applicable strict 16 KB verification', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const steps = workflow.jobs['build-release-apk'].steps
  const signing = steps.findIndex(step => step.name === 'Validate release signing')
  const alignment = steps.findIndex(step => step.name === 'Validate 64-bit page alignment')
  const upload = steps.findIndex(step => step.name === 'Upload variant artifact')
  expect(signing).toBeGreaterThan(-1)
  expect(alignment).toBeGreaterThan(signing)
  expect(upload).toBeGreaterThan(alignment)
  expect(steps[alignment]).toMatchObject({
    if: "${{ matrix.arch != 'armeabi-v7a-legacy' }}",
  })
  expect(steps[alignment].run).toContain('bun scripts/validate-android-16kb-apk.js --strict dist-apk/*.apk')
  expect(steps[upload]).not.toHaveProperty('if')
  expect(steps[upload].with).toMatchObject({
    name: 'islemind-android-candidate-${{ matrix.arch }}-${{ matrix.model_variant }}',
    'if-no-files-found': 'error', 'retention-days': 1,
  })
})

test('artifact merging uses unique producer filenames and rejects server digest mismatches', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const build = workflow.jobs['build-release-apk']
  const toolchain = build.steps.find(step => step.name === 'Verify and record build toolchain')
  expect(toolchain.run).toContain('build-toolchain-${{ matrix.arch }}-${{ matrix.model_variant }}.json')
  expect(toolchain.run).not.toContain('> dist-apk/build-toolchain.json')
  const collection = workflow.jobs['release-android-apk']
  const download = collection.steps.find(step => step.name === 'Download all candidate variants')
  expect(download.uses).toBe('actions/download-artifact@v8')
  expect(download.with).toEqual({
    pattern: 'islemind-android-candidate-*', path: 'dist-apk',
    'merge-multiple': true, 'digest-mismatch': 'error',
  })
  expect(download.with.pattern).not.toBe('islemind-android-release-*')
})

test('the final candidate exists only after complete-set, source-binding, signing and 16 KB gates pass', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const collection = workflow.jobs['release-android-apk']
  expect(collection.needs).toEqual(['release-quality', 'build-release-apk'])
  expect(collection).not.toHaveProperty('if')
  expect(collection).not.toHaveProperty('continue-on-error')
  const names = collection.steps.map(step => step.name)
  const complete = names.indexOf('Validate complete APK set and source binding')
  const signing = names.indexOf('Validate release signing')
  const alignment = names.indexOf('Validate 64-bit page alignment')
  const artifact = names.indexOf('Upload APK artifact')
  expect(complete).toBeGreaterThan(-1)
  expect(signing).toBeGreaterThan(complete)
  expect(alignment).toBeGreaterThan(signing)
  expect(artifact).toBeGreaterThan(alignment)
  expect(collection.steps[complete].run).toContain('--source-root "$GITHUB_WORKSPACE"')
  expect(collection.steps[artifact].with).toMatchObject({
    name: 'islemind-android-release-apks', 'if-no-files-found': 'error',
  })
})

test('64-bit verification fails closed when the validator skips unavailable ZIP or ELF tools', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  for (const name of ['build-release-apk', 'release-android-apk']) {
    const alignment = workflow.jobs[name].steps.find(step => step.name === 'Validate 64-bit page alignment')
    expect(alignment.run).toContain('set -euo pipefail')
    expect(alignment.run).toContain("grep -q 'skipped'")
    expect(alignment.run).toContain('exit 1')
    expect(alignment.run).toContain('--strict')
  }
  const collection = workflow.jobs['release-android-apk'].steps
  const tool = collection.findIndex(step => step.name === 'Prepare ELF inspection tool')
  const alignment = collection.findIndex(step => step.name === 'Validate 64-bit page alignment')
  expect(tool).toBeGreaterThan(-1)
  expect(alignment).toBeGreaterThan(tool)
  expect(collection[tool].run).toContain('test -x "$READELF"')
  expect(collection[tool].run).toContain('LLVM_READELF=$READELF')
  expect(collection[tool].run).toContain('ndk;27.1.12297006')
})

test('new verification tooling is pinned to the workflow revision without replacing tagged APK source', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  const steps = workflow.jobs['release-android-apk'].steps
  const tools = steps.find(step => step.name === 'Checkout verification tools')
  expect(tools.with).toEqual({ ref: '${{ github.sha }}', path: '.ci-tools', 'persist-credentials': false })
  expect(steps.find(step => step.name === 'Validate complete APK set and source binding').run).toContain('node .ci-tools/scripts/validate-release-apk-set.js')
  expect(steps.find(step => step.name === 'Checkout').with.ref).toBe('${{ needs.release-quality.outputs.source_commit }}')
})

test('signing credentials remain step-scoped in every release job', () => {
  const workflow = yaml.parse(fs.readFileSync(path.join(root, '.github/workflows/release-android-apk.yml'), 'utf8'))
  expect(JSON.stringify(workflow.env)).not.toMatch(/secrets\.|ORG_GRADLE_PROJECT_ISLEMIND_UPLOAD_|ANDROID_KEYSTORE_BASE64/)
  for (const job of Object.values(workflow.jobs)) {
    expect(JSON.stringify(job.env || {})).not.toMatch(/secrets\.|ORG_GRADLE_PROJECT_ISLEMIND_UPLOAD_|ANDROID_KEYSTORE_BASE64/)
  }
  const build = workflow.jobs['build-release-apk']
  const cleanup = build.steps.find(step => step.name === 'Remove decoded signing keystore')
  expect(cleanup).toMatchObject({ if: 'always()' })
  expect(cleanup.run).toContain('rm -f android/app/islemind-release.keystore')
})
