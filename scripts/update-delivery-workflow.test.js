const fs = require('node:fs')
const path = require('node:path')
const yaml = require('yaml')
const { parseReleaseChangeRecord, parseReleasePolicy } = require('./release-plan-contract')
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
