const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const petDir = path.join(root, 'assets', 'pets', 'isle')
const petJsonPath = path.join(petDir, 'pet.json')
const planPath = path.join(petDir, 'extended-animation-plan.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function rel(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/')
}

function validate() {
  const pet = readJson(petJsonPath)
  const plan = readJson(planPath)
  const atlases = new Map(pet.atlases.map((atlas) => [atlas.id, atlas]))

  assert.equal(plan.petId, pet.id, 'plan pet id matches pet.json')
  assert.equal(plan.geometry.columns, pet.columns, 'plan column count matches pet.json')
  assert.equal(plan.geometry.cellWidth, pet.cellWidth, 'plan cell width matches pet.json')
  assert.equal(plan.geometry.cellHeight, pet.cellHeight, 'plan cell height matches pet.json')
  assert.equal(plan.geometry.finalAtlasWidth, pet.columns * pet.cellWidth, 'plan atlas width is derived from pet geometry')
  assert.equal(plan.geometry.finalAtlasHeight, plan.geometry.rowsPerAtlas * pet.cellHeight, 'plan atlas height is derived from pet geometry')

  for (const reference of plan.sourceReferences) {
    assert.ok(fs.existsSync(path.join(root, reference.path)), `source reference exists: ${reference.path}`)
    assert.ok(reference.role, `source reference has role: ${reference.path}`)
  }

  const coveredAnimations = new Set()
  for (const atlasSpec of plan.atlasSpecs) {
    const atlas = atlases.get(atlasSpec.atlasId)
    assert.ok(atlas, `pet.json declares atlas: ${atlasSpec.atlasId}`)
    assert.equal(atlas.rows, plan.geometry.rowsPerAtlas, `${atlasSpec.atlasId} row count matches plan geometry`)
    assert.equal(path.basename(atlasSpec.outputPath), atlas.spritesheetPath, `${atlasSpec.atlasId} output path matches pet atlas path`)
    assert.equal(atlas.generationStatus, 'pending-imagegen', `${atlasSpec.atlasId} atlas remains pending image generation`)
    assert.equal(atlas.available, false, `${atlasSpec.atlasId} atlas is not marked available before real spritesheet exists`)
    assert.equal(atlasSpec.rows.length, plan.geometry.rowsPerAtlas, `${atlasSpec.atlasId} covers every row`)

    const rows = new Set()
    for (const rowSpec of atlasSpec.rows) {
      const animation = pet.animations[rowSpec.animation]
      assert.ok(animation, `pet.json declares animation: ${rowSpec.animation}`)
      assert.equal(animation.atlasId, atlasSpec.atlasId, `${rowSpec.animation} atlas id matches plan`)
      assert.equal(animation.row, rowSpec.row, `${rowSpec.animation} row matches plan`)
      assert.equal(animation.frames, rowSpec.frames, `${rowSpec.animation} frame count matches plan`)
      assert.equal(animation.fps, rowSpec.fps, `${rowSpec.animation} fps matches plan`)
      assert.equal(animation.fallbackAnimation, rowSpec.fallbackAnimation, `${rowSpec.animation} fallback matches plan`)
      assert.ok(rowSpec.prompt.length > 180, `${rowSpec.animation} has a detailed generation prompt`)
      assert.ok(rowSpec.motionBrief.length > 20, `${rowSpec.animation} has a motion brief`)
      assert.ok(!rows.has(rowSpec.row), `${atlasSpec.atlasId} row ${rowSpec.row} is unique`)
      rows.add(rowSpec.row)
      coveredAnimations.add(rowSpec.animation)
    }
  }

  const plannedAtlasIds = new Set(plan.atlasSpecs.map((atlas) => atlas.atlasId))
  const plannedAnimations = Object.entries(pet.animations)
    .filter(([, animation]) => plannedAtlasIds.has(animation.atlasId))
    .map(([name]) => name)
  assert.deepEqual([...coveredAnimations].sort(), plannedAnimations.sort(), 'plan covers all non-core pet animations')

  for (const atlas of pet.atlases) {
    const assetPath = path.join(petDir, atlas.spritesheetPath)
    if (atlas.available) {
      assert.ok(fs.existsSync(assetPath), `available atlas exists: ${rel(assetPath)}`)
    } else {
      assert.equal(atlas.generationStatus, 'pending-imagegen', `${atlas.id} missing atlas remains pending`)
    }
  }

  return {
    petId: pet.id,
    plannedAtlases: plan.atlasSpecs.length,
    plannedRows: plan.atlasSpecs.reduce((sum, atlas) => sum + atlas.rows.length, 0),
    plannedAnimations: coveredAnimations.size,
  }
}

const summary = validate()
console.log(`Isle pet animation plan valid: ${summary.plannedAtlases} atlases, ${summary.plannedRows} rows, ${summary.plannedAnimations} animations`)
