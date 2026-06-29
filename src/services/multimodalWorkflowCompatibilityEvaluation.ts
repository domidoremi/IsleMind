export const MULTIMODAL_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA = 'islemind.multimodal-workflow-compatibility-eval.v1'
export const MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS = [
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
] as const

export type MultimodalWorkflowFixtureId = typeof MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS[number]
export type MultimodalWorkflowProviderFamily = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'local-native' | 'external-worker' | 'app-workflow' | 'generic'
export type MultimodalWorkflowSurface = 'provider-chat' | 'ingestion' | 'local-native' | 'realtime' | 'external-worker' | 'screen-context' | 'blocked'
export type MultimodalWorkflowModality = 'text' | 'image' | 'file' | 'audio' | 'speech' | 'video' | 'screen'
export type MultimodalWorkflowRequestShape =
  | 'image-data-url-part'
  | 'document-ingestion-chunks'
  | 'audio-transcription-file'
  | 'speech-output-stream'
  | 'realtime-duplex-audio'
  | 'video-frame-sampling'
  | 'screen-capture-context'
  | 'direct-raw-media-upload'
  | 'none'
export type MultimodalWorkflowReadiness = 'ready' | 'needs-adapter' | 'blocked'
export type MultimodalWorkflowFailureCode =
  | 'missing-docs'
  | 'missing-provider-metadata'
  | 'unsupported-modality'
  | 'adapter-required'
  | 'external-worker-required'
  | 'realtime-transport-missing'
  | 'consent-missing'
  | 'permission-missing'
  | 'size-budget-missing'
  | 'duration-budget-missing'
  | 'frame-budget-missing'
  | 'token-budget-missing'
  | 'temp-cleanup-missing'
  | 'raw-media-retention-blocked'
  | 'redaction-missing'
  | 'provenance-missing'
  | 'citation-missing'
  | 'cancellation-missing'
  | 'interruption-missing'
  | 'transcript-boundary-missing'
  | 'audit-missing'

export interface MultimodalWorkflowGuardrails {
  userConsent: boolean
  nativePermission: 'not-needed' | 'granted' | 'missing'
  sizeByteLimit: number
  durationMsLimit: number
  frameLimit: number
  tokenBudget: number
  tempFileCleanup: boolean
  rawMediaRetention: 'none' | 'user-approved' | 'unbounded'
  redaction: boolean
  provenance: boolean
  citationTrace: boolean
  cancellable: boolean
  interruptible: boolean
  transcriptBoundary: boolean
  realtimeTransport: boolean
  externalWorkerAllowed: boolean
  artifactManifest: boolean
  auditEvent: boolean
}

export interface MultimodalWorkflowFixture {
  id: MultimodalWorkflowFixtureId | string
  providerFamily: MultimodalWorkflowProviderFamily
  surface: MultimodalWorkflowSurface
  docs: string[]
  description: string
  inputModalities: MultimodalWorkflowModality[]
  outputModalities: MultimodalWorkflowModality[]
  requestShape: MultimodalWorkflowRequestShape
  modelMetadataSupportsModalities: boolean
  appRequestControl: boolean
  requiresAdapter: boolean
  guardrails: MultimodalWorkflowGuardrails
}

export interface MultimodalWorkflowDiagnostic {
  fixtureId: string
  providerFamily: MultimodalWorkflowProviderFamily
  surface: MultimodalWorkflowSurface
  docs: string[]
  description: string
  inputModalities: MultimodalWorkflowModality[]
  outputModalities: MultimodalWorkflowModality[]
  requestShape: MultimodalWorkflowRequestShape
  readiness: MultimodalWorkflowReadiness
  modelMetadataSupportsModalities: boolean
  appRequestControl: boolean
  requiresAdapter: boolean
  guardrails: MultimodalWorkflowGuardrails
  failureCodes: MultimodalWorkflowFailureCode[]
}

export interface MultimodalWorkflowCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredFixtureIds: string[]
  requiredRequestShapes: MultimodalWorkflowRequestShape[]
}

export interface MultimodalWorkflowCompatibilityEvaluationRun {
  schema: typeof MULTIMODAL_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: MultimodalWorkflowDiagnostic[]
  qualityGate: MultimodalWorkflowCompatibilityQualityGate
}

export interface MultimodalWorkflowCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: MultimodalWorkflowFixture[]
  requiredFixtureIds?: string[]
}

const SAFE_MEDIA_GUARDRAILS: MultimodalWorkflowGuardrails = {
  userConsent: true,
  nativePermission: 'not-needed',
  sizeByteLimit: 8 * 1024 * 1024,
  durationMsLimit: 120000,
  frameLimit: 32,
  tokenBudget: 24000,
  tempFileCleanup: true,
  rawMediaRetention: 'none',
  redaction: true,
  provenance: true,
  citationTrace: false,
  cancellable: true,
  interruptible: false,
  transcriptBoundary: true,
  realtimeTransport: false,
  externalWorkerAllowed: false,
  artifactManifest: true,
  auditEvent: true,
}

export const MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURES: MultimodalWorkflowFixture[] = [
  {
    id: 'image-chat-provider-routing',
    providerFamily: 'openai-compatible',
    surface: 'provider-chat',
    docs: ['docs/architecture/ai-technology-landscape.md'],
    description: 'Image chat input is sent only when provider/model metadata and request shaping support image parts.',
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    requestShape: 'image-data-url-part',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: false,
    guardrails: SAFE_MEDIA_GUARDRAILS,
  },
  {
    id: 'document-ingestion-before-context',
    providerFamily: 'app-workflow',
    surface: 'ingestion',
    docs: ['docs/architecture/document-ingestion-benchmark.md'],
    description: 'Documents enter context through ingestion, chunking, provenance, and citation traces instead of raw prompt stuffing.',
    inputModalities: ['file'],
    outputModalities: ['text'],
    requestShape: 'document-ingestion-chunks',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: false,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      sizeByteLimit: 24 * 1024 * 1024,
      citationTrace: true,
    },
  },
  {
    id: 'audio-transcription-permissioned',
    providerFamily: 'local-native',
    surface: 'local-native',
    docs: ['docs/architecture/ai-technology-landscape.md'],
    description: 'Audio transcription requires native permission, duration limits, cleanup, and transcript boundaries.',
    inputModalities: ['audio'],
    outputModalities: ['text'],
    requestShape: 'audio-transcription-file',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: false,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      nativePermission: 'granted',
      durationMsLimit: 180000,
    },
  },
  {
    id: 'speech-output-temp-cleanup',
    providerFamily: 'local-native',
    surface: 'local-native',
    docs: ['docs/architecture/security-scan-2026-06-17.md'],
    description: 'Speech output keeps generated audio temporary, cancellable, and cleaned after playback or replacement.',
    inputModalities: ['text'],
    outputModalities: ['speech'],
    requestShape: 'speech-output-stream',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: false,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      durationMsLimit: 300000,
    },
  },
  {
    id: 'realtime-voice-adapter-required',
    providerFamily: 'openai',
    surface: 'realtime',
    docs: ['docs/architecture/multimodal-workflow-compatibility-gates.md'],
    description: 'Realtime voice needs a dedicated low-latency, interruptible, consented adapter before runtime adoption.',
    inputModalities: ['audio'],
    outputModalities: ['speech', 'text'],
    requestShape: 'realtime-duplex-audio',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: true,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      nativePermission: 'granted',
      durationMsLimit: 600000,
      interruptible: true,
      realtimeTransport: false,
    },
  },
  {
    id: 'video-frame-worker-required',
    providerFamily: 'external-worker',
    surface: 'external-worker',
    docs: ['docs/architecture/execution-layer-compatibility-gates.md'],
    description: 'Video understanding is frame-sampled through an external worker until mobile size, latency, and thermal budgets are proven.',
    inputModalities: ['video'],
    outputModalities: ['text'],
    requestShape: 'video-frame-sampling',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: true,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      sizeByteLimit: 128 * 1024 * 1024,
      durationMsLimit: 600000,
      frameLimit: 120,
      externalWorkerAllowed: false,
      citationTrace: true,
    },
  },
  {
    id: 'screen-understanding-user-consent',
    providerFamily: 'app-workflow',
    surface: 'screen-context',
    docs: ['docs/architecture/multimodal-workflow-compatibility-gates.md'],
    description: 'Screen understanding requires explicit user consent, capture boundaries, frame budgets, and redacted provenance.',
    inputModalities: ['screen'],
    outputModalities: ['text'],
    requestShape: 'screen-capture-context',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: true,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      frameLimit: 12,
      citationTrace: true,
    },
  },
  {
    id: 'unsupported-modality-overclaim-blocked',
    providerFamily: 'generic',
    surface: 'provider-chat',
    docs: ['docs/architecture/multimodal-workflow-compatibility-gates.md'],
    description: 'Generic providers must not receive image, file, audio, or video payloads without capability evidence.',
    inputModalities: ['text', 'image', 'file'],
    outputModalities: ['text'],
    requestShape: 'none',
    modelMetadataSupportsModalities: false,
    appRequestControl: false,
    requiresAdapter: false,
    guardrails: SAFE_MEDIA_GUARDRAILS,
  },
  {
    id: 'raw-media-retention-blocked',
    providerFamily: 'app-workflow',
    surface: 'blocked',
    docs: ['docs/architecture/security-scan-2026-06-17.md'],
    description: 'Raw media cannot remain in cache, diagnostics, traces, or exports without explicit retention policy.',
    inputModalities: ['image', 'audio'],
    outputModalities: ['text'],
    requestShape: 'direct-raw-media-upload',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: false,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      tempFileCleanup: false,
      rawMediaRetention: 'unbounded',
      redaction: false,
    },
  },
  {
    id: 'unbounded-media-payload-blocked',
    providerFamily: 'app-workflow',
    surface: 'blocked',
    docs: ['docs/architecture/multimodal-workflow-compatibility-gates.md'],
    description: 'Media payloads without size, duration, frame, and token budgets are blocked before request shaping.',
    inputModalities: ['video', 'audio'],
    outputModalities: ['text'],
    requestShape: 'direct-raw-media-upload',
    modelMetadataSupportsModalities: true,
    appRequestControl: true,
    requiresAdapter: false,
    guardrails: {
      ...SAFE_MEDIA_GUARDRAILS,
      sizeByteLimit: 0,
      durationMsLimit: 0,
      frameLimit: 0,
      tokenBudget: 0,
    },
  },
]

export function runMultimodalWorkflowCompatibilityEvaluation(
  options: MultimodalWorkflowCompatibilityEvaluationOptions = {},
): MultimodalWorkflowCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateMultimodalWorkflowFixture)
  return {
    schema: MULTIMODAL_WORKFLOW_COMPATIBILITY_EVAL_SCHEMA,
    id: `multimodal-workflow-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateMultimodalWorkflowCompatibilityQualityGate(
      diagnostics,
      options.requiredFixtureIds ?? [...MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS],
    ),
  }
}

export function evaluateMultimodalWorkflowFixture(fixture: MultimodalWorkflowFixture): MultimodalWorkflowDiagnostic {
  const failureCodes = collectMultimodalWorkflowFailureCodes(fixture)
  return {
    fixtureId: fixture.id,
    providerFamily: fixture.providerFamily,
    surface: fixture.surface,
    docs: [...fixture.docs],
    description: fixture.description,
    inputModalities: [...fixture.inputModalities].sort(),
    outputModalities: [...fixture.outputModalities].sort(),
    requestShape: fixture.requestShape,
    readiness: resolveMultimodalWorkflowReadiness(fixture, failureCodes),
    modelMetadataSupportsModalities: fixture.modelMetadataSupportsModalities,
    appRequestControl: fixture.appRequestControl,
    requiresAdapter: fixture.requiresAdapter,
    guardrails: { ...fixture.guardrails },
    failureCodes,
  }
}

export function evaluateMultimodalWorkflowCompatibilityQualityGate(
  diagnostics: MultimodalWorkflowDiagnostic[],
  requiredFixtureIds: string[] = [...MULTIMODAL_WORKFLOW_COMPATIBILITY_FIXTURE_IDS],
): MultimodalWorkflowCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRequestShapes: MultimodalWorkflowRequestShape[] = [
    'image-data-url-part',
    'document-ingestion-chunks',
    'audio-transcription-file',
    'speech-output-stream',
    'realtime-duplex-audio',
    'video-frame-sampling',
    'screen-capture-context',
    'direct-raw-media-upload',
    'none',
  ]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const shape of requiredRequestShapes) {
    if (!diagnostics.some((item) => item.requestShape === shape)) failures.push(`${shape}:missing-request-shape`)
  }
  for (const item of diagnostics) {
    if (!item.docs.length) failures.push(`${item.fixtureId}:missing-docs`)
    if (item.readiness === 'ready') requireSafeMediaPolicy(item, failures)
    if (item.readiness !== 'blocked' && item.guardrails.rawMediaRetention === 'unbounded') failures.push(`${item.fixtureId}:raw-media-retention`)
  }

  requireReady(byId.get('image-chat-provider-routing'), failures, 'image-data-url-part')
  requireReady(byId.get('document-ingestion-before-context'), failures, 'document-ingestion-chunks')
  requireReady(byId.get('audio-transcription-permissioned'), failures, 'audio-transcription-file')
  requireReady(byId.get('speech-output-temp-cleanup'), failures, 'speech-output-stream')

  requireNeedsAdapter(byId.get('realtime-voice-adapter-required'), failures, 'realtime-duplex-audio', ['adapter-required', 'realtime-transport-missing'])
  requireNeedsAdapter(byId.get('video-frame-worker-required'), failures, 'video-frame-sampling', ['adapter-required', 'external-worker-required'])
  requireNeedsAdapter(byId.get('screen-understanding-user-consent'), failures, 'screen-capture-context', ['adapter-required'])

  requireBlocked(byId.get('unsupported-modality-overclaim-blocked'), failures, 'unsupported-modality-overclaim-blocked', ['missing-provider-metadata', 'unsupported-modality'])
  requireBlocked(byId.get('raw-media-retention-blocked'), failures, 'raw-media-retention-blocked', ['raw-media-retention-blocked', 'temp-cleanup-missing', 'redaction-missing'])
  requireBlocked(byId.get('unbounded-media-payload-blocked'), failures, 'unbounded-media-payload-blocked', ['size-budget-missing', 'duration-budget-missing', 'frame-budget-missing', 'token-budget-missing'])

  return {
    passed: failures.length === 0,
    failures,
    requiredFixtureIds,
    requiredRequestShapes,
  }
}

function requireReady(item: MultimodalWorkflowDiagnostic | undefined, failures: string[], expectedShape: MultimodalWorkflowRequestShape): void {
  if (!item) return
  if (item.readiness !== 'ready') failures.push(`${item.fixtureId}:not-ready`)
  if (item.requestShape !== expectedShape) failures.push(`${item.fixtureId}:wrong-request-shape`)
  if (!item.modelMetadataSupportsModalities) failures.push(`${item.fixtureId}:missing-model-metadata`)
  if (!item.appRequestControl) failures.push(`${item.fixtureId}:missing-app-request-control`)
  if (item.failureCodes.length > 0) failures.push(`${item.fixtureId}:unexpected-failure-codes`)
}

function requireNeedsAdapter(
  item: MultimodalWorkflowDiagnostic | undefined,
  failures: string[],
  expectedShape: MultimodalWorkflowRequestShape,
  expectedCodes: MultimodalWorkflowFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'needs-adapter') failures.push(`${item.fixtureId}:not-needs-adapter`)
  if (item.requestShape !== expectedShape) failures.push(`${item.fixtureId}:wrong-request-shape`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${item.fixtureId}:missing-${code}`)
  }
}

function requireBlocked(
  item: MultimodalWorkflowDiagnostic | undefined,
  failures: string[],
  id: string,
  expectedCodes: MultimodalWorkflowFailureCode[],
): void {
  if (!item) return
  if (item.readiness !== 'blocked') failures.push(`${id}:not-blocked`)
  for (const code of expectedCodes) {
    if (!item.failureCodes.includes(code)) failures.push(`${id}:missing-${code}`)
  }
}

function requireSafeMediaPolicy(item: MultimodalWorkflowDiagnostic, failures: string[]): void {
  if (!item.guardrails.userConsent) failures.push(`${item.fixtureId}:missing-consent`)
  if (item.guardrails.nativePermission === 'missing') failures.push(`${item.fixtureId}:missing-native-permission`)
  if (item.guardrails.sizeByteLimit <= 0) failures.push(`${item.fixtureId}:missing-size-budget`)
  if (item.guardrails.durationMsLimit <= 0) failures.push(`${item.fixtureId}:missing-duration-budget`)
  if (item.guardrails.frameLimit <= 0) failures.push(`${item.fixtureId}:missing-frame-budget`)
  if (item.guardrails.tokenBudget <= 0) failures.push(`${item.fixtureId}:missing-token-budget`)
  if (!item.guardrails.tempFileCleanup) failures.push(`${item.fixtureId}:missing-temp-cleanup`)
  if (!item.guardrails.redaction) failures.push(`${item.fixtureId}:missing-redaction`)
  if (!item.guardrails.provenance) failures.push(`${item.fixtureId}:missing-provenance`)
  if (!item.guardrails.cancellable) failures.push(`${item.fixtureId}:missing-cancellation`)
  if (!item.guardrails.auditEvent) failures.push(`${item.fixtureId}:missing-audit`)
  if (item.inputModalities.includes('file') && !item.guardrails.citationTrace) failures.push(`${item.fixtureId}:missing-citation`)
}

function collectMultimodalWorkflowFailureCodes(fixture: MultimodalWorkflowFixture): MultimodalWorkflowFailureCode[] {
  const failures: MultimodalWorkflowFailureCode[] = []
  if (!fixture.docs.length) failures.push('missing-docs')
  if (!fixture.modelMetadataSupportsModalities) failures.push('missing-provider-metadata')
  if (!fixture.appRequestControl) failures.push('unsupported-modality')
  if (fixture.requiresAdapter) failures.push('adapter-required')
  if (fixture.surface === 'external-worker' && !fixture.guardrails.externalWorkerAllowed) failures.push('external-worker-required')
  if (fixture.surface === 'realtime' && !fixture.guardrails.realtimeTransport) failures.push('realtime-transport-missing')
  if (!fixture.guardrails.userConsent) failures.push('consent-missing')
  if (fixture.guardrails.nativePermission === 'missing') failures.push('permission-missing')
  if (fixture.guardrails.sizeByteLimit <= 0) failures.push('size-budget-missing')
  if (usesDurationBudget(fixture) && fixture.guardrails.durationMsLimit <= 0) failures.push('duration-budget-missing')
  if (usesFrameBudget(fixture) && fixture.guardrails.frameLimit <= 0) failures.push('frame-budget-missing')
  if (fixture.guardrails.tokenBudget <= 0) failures.push('token-budget-missing')
  if (!fixture.guardrails.tempFileCleanup) failures.push('temp-cleanup-missing')
  if (fixture.guardrails.rawMediaRetention === 'unbounded') failures.push('raw-media-retention-blocked')
  if (!fixture.guardrails.redaction) failures.push('redaction-missing')
  if (!fixture.guardrails.provenance) failures.push('provenance-missing')
  if (fixture.inputModalities.includes('file') && !fixture.guardrails.citationTrace) failures.push('citation-missing')
  if (!fixture.guardrails.cancellable) failures.push('cancellation-missing')
  if (fixture.surface === 'realtime' && !fixture.guardrails.interruptible) failures.push('interruption-missing')
  if ((fixture.surface === 'realtime' || fixture.inputModalities.includes('audio')) && !fixture.guardrails.transcriptBoundary) failures.push('transcript-boundary-missing')
  if (!fixture.guardrails.auditEvent) failures.push('audit-missing')
  return unique(failures)
}

function resolveMultimodalWorkflowReadiness(
  fixture: MultimodalWorkflowFixture,
  failureCodes: MultimodalWorkflowFailureCode[],
): MultimodalWorkflowReadiness {
  if (fixture.surface === 'blocked') return 'blocked'
  if (failureCodes.some((code) => BLOCKING_FAILURES.has(code))) return 'blocked'
  if (failureCodes.some((code) => ADAPTER_FAILURES.has(code))) return 'needs-adapter'
  return 'ready'
}

const ADAPTER_FAILURES = new Set<MultimodalWorkflowFailureCode>([
  'adapter-required',
  'external-worker-required',
  'realtime-transport-missing',
])

const BLOCKING_FAILURES = new Set<MultimodalWorkflowFailureCode>([
  'missing-docs',
  'missing-provider-metadata',
  'unsupported-modality',
  'consent-missing',
  'permission-missing',
  'size-budget-missing',
  'duration-budget-missing',
  'frame-budget-missing',
  'token-budget-missing',
  'temp-cleanup-missing',
  'raw-media-retention-blocked',
  'redaction-missing',
  'provenance-missing',
  'citation-missing',
  'cancellation-missing',
  'interruption-missing',
  'transcript-boundary-missing',
  'audit-missing',
])

function usesDurationBudget(fixture: MultimodalWorkflowFixture): boolean {
  return fixture.inputModalities.some((item) => item === 'audio' || item === 'video') || fixture.outputModalities.includes('speech')
}

function usesFrameBudget(fixture: MultimodalWorkflowFixture): boolean {
  return fixture.inputModalities.some((item) => item === 'video' || item === 'screen')
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
