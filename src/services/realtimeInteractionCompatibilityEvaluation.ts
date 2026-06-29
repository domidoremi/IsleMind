export const REALTIME_INTERACTION_COMPATIBILITY_EVAL_SCHEMA = 'islemind.realtime-interaction-compatibility-eval.v1'
export const REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS = [
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
] as const

export type RealtimeInteractionFixtureId = typeof REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS[number]
export type RealtimeInteractionSurface =
  | 'push-to-talk'
  | 'provider-realtime'
  | 'speech-output'
  | 'local-offline'
  | 'fallback'
  | 'blocked'
export type RealtimeInteractionTransport =
  | 'none'
  | 'local-file'
  | 'http-upload'
  | 'sse-events'
  | 'websocket-duplex'
  | 'native-speech'
export type RealtimeInteractionMode =
  | 'voice-note'
  | 'duplex-voice'
  | 'text-fallback'
  | 'speech-playback'
  | 'blocked'
export type RealtimeInteractionReadiness = 'ready' | 'degraded' | 'needs-adapter' | 'blocked'
export type RealtimeInteractionFailureCode =
  | 'missing-docs'
  | 'missing-user-consent'
  | 'missing-microphone-permission'
  | 'missing-speaker-control'
  | 'missing-provider-realtime-contract'
  | 'missing-realtime-transport'
  | 'missing-request-adapter'
  | 'latency-budget-missing'
  | 'latency-budget-exceeded'
  | 'missing-vad-boundary'
  | 'missing-turn-boundary'
  | 'missing-partial-final-boundary'
  | 'missing-interrupt'
  | 'missing-cancellation'
  | 'missing-audio-buffer-limit'
  | 'missing-token-budget'
  | 'missing-cost-budget'
  | 'missing-temp-cleanup'
  | 'raw-audio-retention'
  | 'missing-redaction'
  | 'missing-fallback'
  | 'fallback-not-visible'
  | 'cross-session-audio-state'
  | 'missing-audit-event'
  | 'control-plane-network-call'

export interface RealtimeInteractionPolicy {
  docsMapped: boolean
  userConsent: boolean
  microphonePermission: 'not-needed' | 'granted' | 'missing'
  speakerControl: boolean
  providerRealtimeContract: boolean
  requestAdapter: boolean
  latencyBudgetMs: number
  observedLatencyMs: number
  vadBoundary: boolean
  turnBoundary: boolean
  partialFinalTranscriptBoundary: boolean
  interruptible: boolean
  cancellable: boolean
  audioBufferLimitBytes: number
  maxDurationMs: number
  tokenBudget: number
  costBudgetUsd: number
  tempFileCleanup: boolean
  rawAudioRetention: 'none' | 'user-approved' | 'unbounded'
  transcriptRedaction: boolean
  fallbackMode?: RealtimeInteractionMode
  fallbackVisible: boolean
  sameSessionAudioState: boolean
  auditEvent: boolean
  networkCallsAllowed: boolean
}

export interface RealtimeInteractionFixture {
  id: RealtimeInteractionFixtureId | string
  surface: RealtimeInteractionSurface
  mode: RealtimeInteractionMode
  transport: RealtimeInteractionTransport
  expectedReadiness: RealtimeInteractionReadiness
  description: string
  policy: RealtimeInteractionPolicy
}

export interface RealtimeInteractionDiagnostic {
  fixtureId: string
  surface: RealtimeInteractionSurface
  mode: RealtimeInteractionMode
  transport: RealtimeInteractionTransport
  description: string
  readiness: RealtimeInteractionReadiness
  policy: RealtimeInteractionPolicy
  failureCodes: RealtimeInteractionFailureCode[]
}

export interface RealtimeInteractionCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredSurfaces: RealtimeInteractionSurface[]
  requiredTransports: RealtimeInteractionTransport[]
}

export interface RealtimeInteractionCompatibilityEvaluationRun {
  schema: typeof REALTIME_INTERACTION_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: RealtimeInteractionDiagnostic[]
  qualityGate: RealtimeInteractionCompatibilityQualityGate
}

export interface RealtimeInteractionCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: RealtimeInteractionFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_REALTIME_POLICY: RealtimeInteractionPolicy = {
  docsMapped: true,
  userConsent: true,
  microphonePermission: 'not-needed',
  speakerControl: true,
  providerRealtimeContract: false,
  requestAdapter: true,
  latencyBudgetMs: 1200,
  observedLatencyMs: 400,
  vadBoundary: true,
  turnBoundary: true,
  partialFinalTranscriptBoundary: true,
  interruptible: true,
  cancellable: true,
  audioBufferLimitBytes: 4 * 1024 * 1024,
  maxDurationMs: 120000,
  tokenBudget: 12000,
  costBudgetUsd: 0.05,
  tempFileCleanup: true,
  rawAudioRetention: 'none',
  transcriptRedaction: true,
  fallbackMode: undefined,
  fallbackVisible: true,
  sameSessionAudioState: true,
  auditEvent: true,
  networkCallsAllowed: false,
}

export const REALTIME_INTERACTION_COMPATIBILITY_FIXTURES: RealtimeInteractionFixture[] = [
  {
    id: 'push-to-talk-transcription-fallback',
    surface: 'push-to-talk',
    mode: 'voice-note',
    transport: 'http-upload',
    expectedReadiness: 'ready',
    description: 'Current voice input remains push-to-talk transcription with permission, bounded file read, cleanup, transcript boundary, and text insertion fallback.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: false,
      latencyBudgetMs: 30000,
      observedLatencyMs: 2500,
      fallbackMode: 'text-fallback',
    },
  },
  {
    id: 'provider-realtime-duplex-transport',
    surface: 'provider-realtime',
    mode: 'duplex-voice',
    transport: 'websocket-duplex',
    expectedReadiness: 'needs-adapter',
    description: 'Provider-native realtime voice requires a dedicated duplex transport and request adapter before product adoption.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      requestAdapter: false,
      latencyBudgetMs: 600,
      observedLatencyMs: 300,
      fallbackMode: 'voice-note',
    },
  },
  {
    id: 'barge-in-interruption-control',
    surface: 'provider-realtime',
    mode: 'duplex-voice',
    transport: 'websocket-duplex',
    expectedReadiness: 'needs-adapter',
    description: 'Barge-in requires explicit interruption events, speaker cancellation, and transcript repair before realtime output can continue.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      requestAdapter: false,
      latencyBudgetMs: 500,
      observedLatencyMs: 260,
      fallbackMode: 'voice-note',
    },
  },
  {
    id: 'turn-taking-and-vad-boundary',
    surface: 'provider-realtime',
    mode: 'duplex-voice',
    transport: 'websocket-duplex',
    expectedReadiness: 'needs-adapter',
    description: 'Realtime turn taking must define voice activity detection, turn end, user override, and silence timeout boundaries.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      requestAdapter: false,
      latencyBudgetMs: 600,
      observedLatencyMs: 320,
      fallbackMode: 'voice-note',
    },
  },
  {
    id: 'streaming-transcript-partial-final-boundary',
    surface: 'provider-realtime',
    mode: 'duplex-voice',
    transport: 'sse-events',
    expectedReadiness: 'needs-adapter',
    description: 'Streaming transcript UI must separate partial hypotheses from final transcript chunks before saving chat state.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      requestAdapter: false,
      latencyBudgetMs: 800,
      observedLatencyMs: 450,
      fallbackMode: 'voice-note',
    },
  },
  {
    id: 'speech-output-cancellation-cleanup',
    surface: 'speech-output',
    mode: 'speech-playback',
    transport: 'native-speech',
    expectedReadiness: 'ready',
    description: 'Speech playback remains cancellable and cleans generated provider audio when playback finishes or is replaced.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'not-needed',
      providerRealtimeContract: false,
      latencyBudgetMs: 2000,
      observedLatencyMs: 350,
      maxDurationMs: 300000,
    },
  },
  {
    id: 'local-offline-voice-note-mode',
    surface: 'local-offline',
    mode: 'voice-note',
    transport: 'local-file',
    expectedReadiness: 'degraded',
    description: 'Offline voice note capture can save bounded local audio only as user-visible draft input, not autonomous realtime conversation.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: false,
      latencyBudgetMs: 60000,
      observedLatencyMs: 1200,
      fallbackMode: 'text-fallback',
    },
  },
  {
    id: 'visible-fallback-to-text-chat',
    surface: 'fallback',
    mode: 'text-fallback',
    transport: 'none',
    expectedReadiness: 'degraded',
    description: 'Realtime setup failure degrades visibly to text chat or push-to-talk transcription without preserving provider audio state.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      providerRealtimeContract: false,
      latencyBudgetMs: 30000,
      observedLatencyMs: 0,
      fallbackMode: 'text-fallback',
    },
  },
  {
    id: 'blocked-missing-microphone-permission',
    surface: 'blocked',
    mode: 'blocked',
    transport: 'local-file',
    expectedReadiness: 'blocked',
    description: 'Voice capture is blocked when microphone permission is missing.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'missing',
    },
  },
  {
    id: 'blocked-unbounded-audio-buffer',
    surface: 'blocked',
    mode: 'blocked',
    transport: 'websocket-duplex',
    expectedReadiness: 'blocked',
    description: 'Realtime audio is blocked when duration, buffer, token, or cost budgets are not finite.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      audioBufferLimitBytes: 0,
      maxDurationMs: 0,
      tokenBudget: 0,
      costBudgetUsd: 0,
    },
  },
  {
    id: 'blocked-realtime-without-interrupt',
    surface: 'blocked',
    mode: 'blocked',
    transport: 'websocket-duplex',
    expectedReadiness: 'blocked',
    description: 'Realtime voice is blocked when the user cannot interrupt or cancel the model while it is speaking.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      interruptible: false,
      cancellable: false,
    },
  },
  {
    id: 'blocked-raw-audio-retention',
    surface: 'blocked',
    mode: 'blocked',
    transport: 'http-upload',
    expectedReadiness: 'blocked',
    description: 'Raw audio retention in diagnostics, cache, or export is blocked without explicit user-approved retention policy.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      rawAudioRetention: 'unbounded',
      tempFileCleanup: false,
      transcriptRedaction: false,
    },
  },
  {
    id: 'blocked-cross-session-audio-state',
    surface: 'blocked',
    mode: 'blocked',
    transport: 'websocket-duplex',
    expectedReadiness: 'blocked',
    description: 'Realtime session ids, audio buffers, and transcript state cannot be replayed across chat sessions or providers.',
    policy: {
      ...SAFE_REALTIME_POLICY,
      microphonePermission: 'granted',
      providerRealtimeContract: true,
      sameSessionAudioState: false,
    },
  },
]

export function runRealtimeInteractionCompatibilityEvaluation(
  options: RealtimeInteractionCompatibilityEvaluationOptions = {},
): RealtimeInteractionCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? REALTIME_INTERACTION_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateRealtimeInteractionFixture)
  return {
    schema: REALTIME_INTERACTION_COMPATIBILITY_EVAL_SCHEMA,
    id: `realtime-interaction-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateRealtimeInteractionCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateRealtimeInteractionFixture(
  fixture: RealtimeInteractionFixture,
): RealtimeInteractionDiagnostic {
  const failureCodes = collectRealtimeInteractionFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    surface: fixture.surface,
    mode: fixture.mode,
    transport: fixture.transport,
    description: fixture.description,
    readiness: resolveRealtimeInteractionReadiness(fixture, failureCodes),
    policy: { ...fixture.policy },
    failureCodes,
  }
}

export function evaluateRealtimeInteractionCompatibilityQualityGate(
  diagnostics: RealtimeInteractionDiagnostic[],
  requiredFixtureIds: string[] = [...REALTIME_INTERACTION_COMPATIBILITY_FIXTURE_IDS],
): RealtimeInteractionCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredSurfaces: RealtimeInteractionSurface[] = [
    'push-to-talk',
    'provider-realtime',
    'speech-output',
    'local-offline',
    'fallback',
    'blocked',
  ]
  const requiredTransports: RealtimeInteractionTransport[] = [
    'none',
    'local-file',
    'http-upload',
    'sse-events',
    'websocket-duplex',
    'native-speech',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const surface of requiredSurfaces) {
    if (!diagnostics.some((item) => item.surface === surface)) failures.push(`${surface}:missing-surface`)
  }
  for (const transport of requiredTransports) {
    if (!diagnostics.some((item) => item.transport === transport)) failures.push(`${transport}:missing-transport`)
  }

  requireReady(byId.get('push-to-talk-transcription-fallback'), failures)
  requireReady(byId.get('speech-output-cancellation-cleanup'), failures, { requireNoMicrophone: true })
  requireDegraded(byId.get('local-offline-voice-note-mode'), failures, 'local-offline-voice-note-mode', { requireFallback: 'text-fallback' })
  requireDegraded(byId.get('visible-fallback-to-text-chat'), failures, 'visible-fallback-to-text-chat', { requireFallback: 'text-fallback' })
  requireNeedsAdapter(byId.get('provider-realtime-duplex-transport'), failures, 'provider-realtime-duplex-transport', ['missing-request-adapter'])
  requireNeedsAdapter(byId.get('barge-in-interruption-control'), failures, 'barge-in-interruption-control', ['missing-request-adapter'])
  requireNeedsAdapter(byId.get('turn-taking-and-vad-boundary'), failures, 'turn-taking-and-vad-boundary', ['missing-request-adapter'])
  requireNeedsAdapter(byId.get('streaming-transcript-partial-final-boundary'), failures, 'streaming-transcript-partial-final-boundary', ['missing-request-adapter'])

  requireBlocked(byId.get('blocked-missing-microphone-permission'), failures, 'blocked-missing-microphone-permission', ['missing-microphone-permission'])
  requireBlocked(byId.get('blocked-unbounded-audio-buffer'), failures, 'blocked-unbounded-audio-buffer', [
    'missing-audio-buffer-limit',
    'missing-token-budget',
    'missing-cost-budget',
  ])
  requireBlocked(byId.get('blocked-realtime-without-interrupt'), failures, 'blocked-realtime-without-interrupt', [
    'missing-interrupt',
    'missing-cancellation',
  ])
  requireBlocked(byId.get('blocked-raw-audio-retention'), failures, 'blocked-raw-audio-retention', [
    'raw-audio-retention',
    'missing-temp-cleanup',
    'missing-redaction',
  ])
  requireBlocked(byId.get('blocked-cross-session-audio-state'), failures, 'blocked-cross-session-audio-state', ['cross-session-audio-state'])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredSurfaces,
    requiredTransports,
  }
}

function requireReady(
  item: RealtimeInteractionDiagnostic | undefined,
  failures: string[],
  options: { requireNoMicrophone?: boolean } = {},
): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  requireBaselineRealtimePolicy(item, failures)
  if (options.requireNoMicrophone && item.policy.microphonePermission !== 'not-needed') failures.push(`${item.fixtureId}:unexpected-microphone-requirement`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireDegraded(
  item: RealtimeInteractionDiagnostic | undefined,
  failures: string[],
  id: string,
  options: { requireFallback?: RealtimeInteractionMode } = {},
): void {
  if (!item) return
  if (item.readiness !== 'degraded') failures.push(`${id}:not-degraded`)
  requireBaselineRealtimePolicy(item, failures, { allowNoProviderRealtime: true })
  if (options.requireFallback && item.policy.fallbackMode !== options.requireFallback) failures.push(`${id}:missing-${options.requireFallback}`)
  if (!item.policy.fallbackVisible) failures.push(`${id}:fallback-not-visible`)
  if (item.failureCodes.length > 0) failures.push(`${id}:unexpected-failure-codes`)
}

function requireNeedsAdapter(
  item: RealtimeInteractionDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: RealtimeInteractionFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'needs-adapter') failures.push(`${id}:not-needs-adapter`)
  requireBaselineRealtimePolicy(item, failures, { allowAdapterMissing: true })
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function requireBaselineRealtimePolicy(
  item: RealtimeInteractionDiagnostic,
  failures: string[],
  options: { allowAdapterMissing?: boolean; allowNoProviderRealtime?: boolean } = {},
): void {
  if (!item.policy.docsMapped) failures.push(`${item.fixtureId}:missing-docs`)
  if (!item.policy.userConsent) failures.push(`${item.fixtureId}:missing-consent`)
  if (item.policy.microphonePermission === 'missing') failures.push(`${item.fixtureId}:missing-microphone-permission`)
  if (!item.policy.speakerControl) failures.push(`${item.fixtureId}:missing-speaker-control`)
  if (requiresProviderRealtime(item) && !options.allowNoProviderRealtime && !item.policy.providerRealtimeContract) failures.push(`${item.fixtureId}:missing-realtime-contract`)
  if (requiresProviderRealtime(item) && item.transport === 'none') failures.push(`${item.fixtureId}:missing-realtime-transport`)
  if (!options.allowAdapterMissing && !item.policy.requestAdapter) failures.push(`${item.fixtureId}:missing-request-adapter`)
  if (item.policy.latencyBudgetMs <= 0) failures.push(`${item.fixtureId}:missing-latency-budget`)
  if (item.policy.latencyBudgetMs > 0 && item.policy.observedLatencyMs > item.policy.latencyBudgetMs) failures.push(`${item.fixtureId}:latency-exceeded`)
  if (!item.policy.vadBoundary) failures.push(`${item.fixtureId}:missing-vad-boundary`)
  if (!item.policy.turnBoundary) failures.push(`${item.fixtureId}:missing-turn-boundary`)
  if (!item.policy.partialFinalTranscriptBoundary) failures.push(`${item.fixtureId}:missing-transcript-boundary`)
  if (!item.policy.interruptible) failures.push(`${item.fixtureId}:missing-interrupt`)
  if (!item.policy.cancellable) failures.push(`${item.fixtureId}:missing-cancellation`)
  if (item.policy.audioBufferLimitBytes <= 0 || item.policy.maxDurationMs <= 0) failures.push(`${item.fixtureId}:missing-audio-buffer-limit`)
  if (item.policy.tokenBudget <= 0) failures.push(`${item.fixtureId}:missing-token-budget`)
  if (item.policy.costBudgetUsd <= 0) failures.push(`${item.fixtureId}:missing-cost-budget`)
  if (!item.policy.tempFileCleanup) failures.push(`${item.fixtureId}:missing-temp-cleanup`)
  if (item.policy.rawAudioRetention === 'unbounded') failures.push(`${item.fixtureId}:raw-audio-retention`)
  if (!item.policy.transcriptRedaction) failures.push(`${item.fixtureId}:missing-redaction`)
  if (item.policy.fallbackMode && !item.policy.fallbackVisible) failures.push(`${item.fixtureId}:fallback-not-visible`)
  if (!item.policy.sameSessionAudioState) failures.push(`${item.fixtureId}:cross-session-audio-state`)
  if (!item.policy.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (item.policy.networkCallsAllowed) failures.push(`${item.fixtureId}:network-call`)
}

function requireBlocked(
  item: RealtimeInteractionDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: RealtimeInteractionFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function collectRealtimeInteractionFailureCodes(fixture: RealtimeInteractionFixture): RealtimeInteractionFailureCode[] {
  const policy = fixture.policy
  const failures: RealtimeInteractionFailureCode[] = []
  if (!policy.docsMapped) failures.push('missing-docs')
  if (!policy.userConsent) failures.push('missing-user-consent')
  if (policy.microphonePermission === 'missing') failures.push('missing-microphone-permission')
  if (!policy.speakerControl) failures.push('missing-speaker-control')
  if (requiresProviderRealtime(fixture) && !policy.providerRealtimeContract) failures.push('missing-provider-realtime-contract')
  if (requiresProviderRealtime(fixture) && (fixture.transport === 'none' || fixture.transport === 'local-file' || fixture.transport === 'http-upload')) failures.push('missing-realtime-transport')
  if (!policy.requestAdapter) failures.push('missing-request-adapter')
  if (policy.latencyBudgetMs <= 0) failures.push('latency-budget-missing')
  if (policy.latencyBudgetMs > 0 && policy.observedLatencyMs > policy.latencyBudgetMs) failures.push('latency-budget-exceeded')
  if (!policy.vadBoundary) failures.push('missing-vad-boundary')
  if (!policy.turnBoundary) failures.push('missing-turn-boundary')
  if (!policy.partialFinalTranscriptBoundary) failures.push('missing-partial-final-boundary')
  if (!policy.interruptible) failures.push('missing-interrupt')
  if (!policy.cancellable) failures.push('missing-cancellation')
  if (policy.audioBufferLimitBytes <= 0 || policy.maxDurationMs <= 0) failures.push('missing-audio-buffer-limit')
  if (policy.tokenBudget <= 0) failures.push('missing-token-budget')
  if (policy.costBudgetUsd <= 0) failures.push('missing-cost-budget')
  if (!policy.tempFileCleanup) failures.push('missing-temp-cleanup')
  if (policy.rawAudioRetention === 'unbounded') failures.push('raw-audio-retention')
  if (!policy.transcriptRedaction) failures.push('missing-redaction')
  if (policy.fallbackMode === undefined && fixture.expectedReadiness !== 'ready' && fixture.expectedReadiness !== 'blocked') failures.push('missing-fallback')
  if (policy.fallbackMode && !policy.fallbackVisible) failures.push('fallback-not-visible')
  if (!policy.sameSessionAudioState) failures.push('cross-session-audio-state')
  if (!policy.auditEvent) failures.push('missing-audit-event')
  if (policy.networkCallsAllowed) failures.push('control-plane-network-call')
  return unique(failures)
}

function resolveRealtimeInteractionReadiness(
  fixture: RealtimeInteractionFixture,
  failureCodes: RealtimeInteractionFailureCode[],
): RealtimeInteractionReadiness {
  if (fixture.expectedReadiness === 'blocked') return 'blocked'
  const adapterOnly = failureCodes.every((code) => code === 'missing-request-adapter')
  if (fixture.expectedReadiness === 'needs-adapter' && adapterOnly) return 'needs-adapter'
  if (failureCodes.length > 0) return 'blocked'
  if (fixture.expectedReadiness === 'degraded') return 'degraded'
  return 'ready'
}

function requiresProviderRealtime(fixture: Pick<RealtimeInteractionFixture | RealtimeInteractionDiagnostic, 'surface' | 'mode'>): boolean {
  return fixture.surface === 'provider-realtime' || fixture.mode === 'duplex-voice'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
