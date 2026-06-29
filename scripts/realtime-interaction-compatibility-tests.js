const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalResolve = Module._resolveFilename

registerTypeScriptSupport()

const {
  REALTIME_INTERACTION_COMPATIBILITY_EVAL_SCHEMA,
  REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS,
  runRealtimeInteractionCompatibilityEvaluation,
} = require('../src/services/realtimeInteractionCompatibilityEvaluation.ts')

function registerTypeScriptSupport() {
  if (require.extensions['.ts']?.isRealtimeInteractionCompatibilityHook) return

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
  hook.isRealtimeInteractionCompatibilityHook = true
  require.extensions['.ts'] = hook
  require.extensions['.tsx'] = hook
}

function diagnostic(run, fixtureId) {
  const item = run.diagnostics.find((candidate) => candidate.fixtureId === fixtureId)
  assert.ok(item, `diagnostic exists for ${fixtureId}`)
  return item
}

function assertBaseline(item) {
  assert.equal(item.policy.docsMapped, true, `${item.fixtureId} maps docs`)
  assert.equal(item.policy.userConsent, true, `${item.fixtureId} requires consent`)
  assert.notEqual(item.policy.microphonePermission, 'missing', `${item.fixtureId} does not miss microphone permission`)
  assert.equal(item.policy.speakerControl, true, `${item.fixtureId} controls speaker output`)
  assert.ok(item.policy.latencyBudgetMs > 0, `${item.fixtureId} has latency budget`)
  assert.ok(item.policy.audioBufferLimitBytes > 0, `${item.fixtureId} has audio buffer limit`)
  assert.ok(item.policy.maxDurationMs > 0, `${item.fixtureId} has duration limit`)
  assert.ok(item.policy.tokenBudget > 0, `${item.fixtureId} has token budget`)
  assert.ok(item.policy.costBudgetUsd > 0, `${item.fixtureId} has cost budget`)
  assert.equal(item.policy.vadBoundary, true, `${item.fixtureId} has VAD boundary`)
  assert.equal(item.policy.turnBoundary, true, `${item.fixtureId} has turn boundary`)
  assert.equal(item.policy.partialFinalTranscriptBoundary, true, `${item.fixtureId} separates partial/final transcripts`)
  assert.equal(item.policy.interruptible, true, `${item.fixtureId} is interruptible`)
  assert.equal(item.policy.cancellable, true, `${item.fixtureId} is cancellable`)
  assert.equal(item.policy.tempFileCleanup, true, `${item.fixtureId} cleans temp files`)
  assert.equal(item.policy.rawAudioRetention, 'none', `${item.fixtureId} does not retain raw audio`)
  assert.equal(item.policy.transcriptRedaction, true, `${item.fixtureId} redacts transcripts`)
  assert.equal(item.policy.fallbackVisible, true, `${item.fixtureId} exposes fallback`)
  assert.equal(item.policy.sameSessionAudioState, true, `${item.fixtureId} keeps audio state in-session`)
  assert.equal(item.policy.auditEvent, true, `${item.fixtureId} records audit event`)
  assert.equal(item.policy.networkCallsAllowed, false, `${item.fixtureId} stays local/offline`)
}

function assertReady(item) {
  assert.equal(item.readiness, 'ready', `${item.fixtureId} is ready`)
  assertBaseline(item)
  assert.equal(item.policy.requestAdapter, true, `${item.fixtureId} has request adapter`)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no failure codes`)
}

function assertDegraded(item) {
  assert.equal(item.readiness, 'degraded', `${item.fixtureId} is degraded`)
  assertBaseline(item)
  assert.deepEqual(item.failureCodes, [], `${item.fixtureId} has no blocking failure codes`)
}

function assertNeedsAdapter(item, codes) {
  assert.equal(item.readiness, 'needs-adapter', `${item.fixtureId} needs adapter`)
  assertBaseline(item)
  assert.equal(item.policy.requestAdapter, false, `${item.fixtureId} records missing adapter`)
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
  assert.equal(
    REALTIME_INTERACTION_COMPATIBILITY_EVAL_SCHEMA,
    'islemind.realtime-interaction-compatibility-eval.v1',
    'realtime interaction schema is versioned',
  )
  assert.deepEqual(
    REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS,
    [
      'push-to-talk-transcription-fallback',
      'provider-realtime-duplex-transport',
      'barge-in-interruption-control',
      'turn-taking-and-vad-boundary',
      'streaming-transcript-partial-final-boundary',
      'speech-output-cancellation-cleanup',
      'local-offline-voice-note-mode',
      'visible-fallback-to-text-chat',
      'blocked-missing-microphone-permission',
      'blocked-unbounded-audio-buffer',
      'blocked-realtime-without-interrupt',
      'blocked-raw-audio-retention',
      'blocked-cross-session-audio-state',
    ],
    'realtime fixtures cover push-to-talk, duplex, barge-in, turn taking, transcript streaming, speech output, fallback, and blocked paths',
  )

  const evaluation = runRealtimeInteractionCompatibilityEvaluation({ now: () => 2920000000000 })
  assert.equal(evaluation.schema, REALTIME_INTERACTION_COMPATIBILITY_EVAL_SCHEMA, 'evaluation run carries schema')
  assert.equal(evaluation.diagnostics.length, REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS.length, 'evaluation emits one diagnostic per fixture')
  assert.equal(evaluation.qualityGate.passed, true, `realtime interaction gate should pass: ${evaluation.qualityGate.failures.join(', ')}`)

  for (const surface of ['push-to-talk', 'provider-realtime', 'speech-output', 'local-offline', 'fallback', 'blocked']) {
    assert.ok(evaluation.qualityGate.requiredSurfaces.includes(surface), `quality gate tracks ${surface}`)
  }
  for (const transport of ['none', 'local-file', 'http-upload', 'sse-events', 'websocket-duplex', 'native-speech']) {
    assert.ok(evaluation.qualityGate.requiredTransports.includes(transport), `quality gate tracks ${transport}`)
  }

  const pushToTalk = diagnostic(evaluation, 'push-to-talk-transcription-fallback')
  assertReady(pushToTalk)
  assert.equal(pushToTalk.surface, 'push-to-talk', 'push-to-talk fixture records current voice input surface')
  assert.equal(pushToTalk.transport, 'http-upload', 'push-to-talk fixture uses bounded transcription upload')
  assert.equal(pushToTalk.policy.microphonePermission, 'granted', 'push-to-talk requires microphone permission')
  assert.equal(pushToTalk.policy.fallbackMode, 'text-fallback', 'push-to-talk falls back to text insertion')

  const realtime = diagnostic(evaluation, 'provider-realtime-duplex-transport')
  assertNeedsAdapter(realtime, ['missing-request-adapter'])
  assert.equal(realtime.transport, 'websocket-duplex', 'provider realtime requires duplex transport')
  assert.equal(realtime.policy.providerRealtimeContract, true, 'provider realtime records provider contract')

  const bargeIn = diagnostic(evaluation, 'barge-in-interruption-control')
  assertNeedsAdapter(bargeIn, ['missing-request-adapter'])
  assert.equal(bargeIn.policy.interruptible, true, 'barge-in fixture keeps interruption mandatory')
  assert.equal(bargeIn.policy.cancellable, true, 'barge-in fixture keeps cancellation mandatory')

  const turns = diagnostic(evaluation, 'turn-taking-and-vad-boundary')
  assertNeedsAdapter(turns, ['missing-request-adapter'])
  assert.equal(turns.policy.vadBoundary, true, 'turn taking fixture requires VAD boundary')
  assert.equal(turns.policy.turnBoundary, true, 'turn taking fixture requires turn boundary')

  const transcript = diagnostic(evaluation, 'streaming-transcript-partial-final-boundary')
  assertNeedsAdapter(transcript, ['missing-request-adapter'])
  assert.equal(transcript.transport, 'sse-events', 'streaming transcript fixture covers SSE events')
  assert.equal(transcript.policy.partialFinalTranscriptBoundary, true, 'streaming transcript separates partial and final text')

  const speech = diagnostic(evaluation, 'speech-output-cancellation-cleanup')
  assertReady(speech)
  assert.equal(speech.transport, 'native-speech', 'speech fixture covers native speech playback')
  assert.equal(speech.policy.microphonePermission, 'not-needed', 'speech playback does not require microphone')

  const offline = diagnostic(evaluation, 'local-offline-voice-note-mode')
  assertDegraded(offline)
  assert.equal(offline.transport, 'local-file', 'offline voice note uses local file transport')
  assert.equal(offline.policy.fallbackMode, 'text-fallback', 'offline voice note degrades to text fallback')

  const fallback = diagnostic(evaluation, 'visible-fallback-to-text-chat')
  assertDegraded(fallback)
  assert.equal(fallback.transport, 'none', 'text fallback has no realtime transport')
  assert.equal(fallback.policy.sameSessionAudioState, true, 'fallback clears cross-session audio state')

  assertBlocked(diagnostic(evaluation, 'blocked-missing-microphone-permission'), ['missing-microphone-permission'])
  assertBlocked(diagnostic(evaluation, 'blocked-unbounded-audio-buffer'), [
    'missing-audio-buffer-limit',
    'missing-token-budget',
    'missing-cost-budget',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-realtime-without-interrupt'), ['missing-interrupt', 'missing-cancellation'])
  assertBlocked(diagnostic(evaluation, 'blocked-raw-audio-retention'), [
    'raw-audio-retention',
    'missing-temp-cleanup',
    'missing-redaction',
  ])
  assertBlocked(diagnostic(evaluation, 'blocked-cross-session-audio-state'), ['cross-session-audio-state'])

  console.log('Realtime interaction compatibility tests passed')
}

if (require.main === module) run()

module.exports = { run }
