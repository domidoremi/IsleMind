const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  MULTIMODAL_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA,
  MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS,
  runMultimodalWorkflowCompatibilityEvaluation,
} = require('../src/services/multimodalWorkflowCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isMultimodalWorkflowCompatibilityHook) return

  Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(root, 'src', request.slice(2)), parent, isMain, options)
    }
    return originalResolve.call(this, request, parent, isMain, options)
  }

  const hook = function compileTypeScript(module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        target: ts.ScriptTarget.ES2021,
      },
      fileName: filename,
    })
    module._compile(output.outputText, filename)
  }
  hook.isMultimodalWorkflowCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertReady(item, shape) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assert.equal(item.requestShape, shape, `${item.fixtureId} uses ${shape}`)
  assert.equal(item.modelMetadataSupportsModalities, true, `${item.fixtureId} has provider/model modality evidence`)
  assert.equal(item.appRequestControl, true, `${item.fixtureId} has app request controls`)
  assert.equal(item.guardrails.userConsent, true, `${item.fixtureId} requires user consent`)
  assert.equal(item.guardrails.tempFileCleanup, true, `${item.fixtureId} cleans temp files`)
  assert.equal(item.guardrails.rawMediaRetention, 'none', `${item.fixtureId} does not retain raw media`)
  assert.equal(item.guardrails.redaction, true, `${item.fixtureId} redacts diagnostics`)
  assert.equal(item.guardrails.provenance, true, `${item.fixtureId} records provenance`)
  assert.equal(item.guardrails.cancellable, true, `${item.fixtureId} is cancellable`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertNeedsAdapter(item, shape, codes) {
  assert.equal(item.readiness, 'needs-adapter', `${item.fixtureId} needs an adapter`)
  assert.equal(item.requestShape, shape, `${item.fixtureId} uses ${shape}`)
  assert.equal(item.requiresAdapter, true, `${item.fixtureId} records adapter requirement`)
  assert.equal(item.guardrails.rawMediaRetention, 'none', `${item.fixtureId} still blocks raw media retention`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function assertBlocked(item, codes) {
  assert.equal(item.readiness, 'blocked', `${item.fixtureId} is blocked`)
  for (const code of codes) {
    assert.ok(item.failureCodes.includes(code), `${item.fixtureId} records ${code}`)
  }
}

function run() {
  assert.equal(MULTIMODAL_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA, 'islemind.multimodal-workflow-compatibility-eval.v1', 'multimodal workflow schema is versioned')
  assert.deepEqual(
    MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS,
    [
      'image-chat-provider-routing',
      'document-ingestion-before-context',
      'audio-transcription-permissioned',
      'speech-output-temp-cleanup',
      'realtime-voice-adapter-required',
      'video-frame-worker-required',
      'screen-understanding-user-consent',
      'unsupported-modality-overclaim-blocked',
      'raw-media-retention-blocked',
      'unbounded-media-payload-blocked',
    ],
    'multimodal fixtures cover image, document, audio, speech, realtime, video, screen, and blocked unsafe paths'
  )

  const evaluation = runMultimodalWorkflowCompatibilityEvaluation({ now: () => 2300000000000 })
  assert.equal(evaluation.schema, MULTIMODAL_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `multimodal workflow gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)
  for (const shape of [
    'image-data-url-part',
    'document-ingestion-chunks',
    'audio-transcription-file',
    'speech-output-stream',
    'realtime-duplex-audio',
    'video-frame-sampling',
    'screen-capture-context',
    'direct-raw-media-upload',
    'none',
  ]) {
    assert.ok(evaluation.qualityGate.requiredRequestShapes.includes(shape), `quality gate tracks ${shape}`)
  }

  const image = diagnostic(evaluation, 'image-chat-provider-routing')
  assertReady(image, 'image-data-url-part')
  assert.ok(image.inputModalities.includes('image'), 'image fixture records image input')

  const document = diagnostic(evaluation, 'document-ingestion-before-context')
  assertReady(document, 'document-ingestion-chunks')
  assert.ok(document.guardrails.citationTrace, 'document ingestion keeps citation trace')

  const audio = diagnostic(evaluation, 'audio-transcription-permissioned')
  assertReady(audio, 'audio-transcription-file')
  assert.equal(audio.guardrails.nativePermission, 'granted', 'audio transcription requires native permission')
  assert.equal(audio.guardrails.transcriptBoundary, true, 'audio transcription records transcript boundary')

  const speech = diagnostic(evaluation, 'speech-output-temp-cleanup')
  assertReady(speech, 'speech-output-stream')
  assert.ok(speech.outputModalities.includes('speech'), 'speech fixture records speech output')

  const realtime = diagnostic(evaluation, 'realtime-voice-adapter-required')
  assertNeedsAdapter(realtime, 'realtime-duplex-audio', ['adapter-required', 'realtime-transport-missing'])
  assert.equal(realtime.guardrails.interruptible, true, 'realtime voice must be interruptible before adoption')

  const video = diagnostic(evaluation, 'video-frame-worker-required')
  assertNeedsAdapter(video, 'video-frame-sampling', ['adapter-required', 'external-worker-required'])
  assert.ok(video.guardrails.frameLimit > 0, 'video workflow has a frame budget')

  const screen = diagnostic(evaluation, 'screen-understanding-user-consent')
  assertNeedsAdapter(screen, 'screen-capture-context', ['adapter-required'])
  assert.equal(screen.guardrails.userConsent, true, 'screen context requires user consent')
  assert.equal(screen.guardrails.redaction, true, 'screen context requires redaction')

  assertBlocked(diagnostic(evaluation, 'unsupported-modality-overclaim-blocked'), [
    'missing-provider-metadata',
    'unsupported-modality',
  ])
  assertBlocked(diagnostic(evaluation, 'raw-media-retention-blocked'), [
    'raw-media-retention-blocked',
    'temp-cleanup-missing',
    'redaction-missing',
  ])
  assertBlocked(diagnostic(evaluation, 'unbounded-media-payload-blocked'), [
    'size-budget-missing',
    'duration-budget-missing',
    'frame-budget-missing',
    'token-budget-missing',
  ])

  console.log('Multimodal workflow compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
