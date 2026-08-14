export const LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA = 'islemind.local-inference-compatibility-eval.v1'
export const LOCAL_INFERENCE_RUNTIME_FAMILIES = ['ollama', 'llama-cpp', 'lm-studio', 'localai', 'vllm', 'sglang'] as const
export const LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS = [
  'ollama-openai-compatible',
  'llama-cpp-server',
  'lm-studio-openai-compatible',
  'localai-audio-and-grammar',
  'vllm-gpu-server',
  'sglang-reasoning-server',
  'mobile-loopback-warning',
  'model-list-fallback',
  'memory-pressure-boundary',
] as const

export type LocalInferenceRuntimeFamily = typeof LOCAL_INFERENCE_RUNTIME_FAMILIES[number]
export type LocalInferenceFixtureId = typeof LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS[number]
export type LocalInferenceProtocol = 'openai-compatible' | 'ollama-native'
export type LocalInferenceClientPlatform = 'android' | 'ios' | 'desktop'
export type LocalInferenceHostKind = 'loopback' | 'lan' | 'remote'
export type LocalInferenceModelListStatus = 'ok' | 'error' | 'unsupported'
export type LocalInferenceReadiness = 'ready' | 'needs-user-config' | 'blocked'
export type LocalInferenceCapability =
  | 'chat'
  | 'streaming'
  | 'modelList'
  | 'embeddings'
  | 'tools'
  | 'structuredOutput'
  | 'reasoning'
  | 'vision'
  | 'audio'
  | 'speech'
  | 'rerank'
  | 'responses'
export type LocalInferenceRiskCode =
  | 'mobile_loopback_unreachable'
  | 'lan_opt_in_required'
  | 'model_list_unavailable'
  | 'manual_model_required'
  | 'memory_pressure'
  | 'not_mobile_runtime'
  | 'unsupported_endpoint'
  | 'structured_output_adapter_required'

export interface LocalInferenceRuntimeRequirements {
  minSystemRamGb: number
  minGpuVramGb?: number
  mobileRuntimeSupported: boolean
  cpuOnlySupported: boolean
}

export interface LocalInferenceEnvironment {
  clientPlatform: LocalInferenceClientPlatform
  hostKind: LocalInferenceHostKind
  userOptIn: boolean
  availableSystemRamGb: number
  availableGpuVramGb?: number
}

export interface LocalInferenceEndpointShape {
  chat: string
  models?: string
  embeddings?: string
  responses?: string
  audioTranscriptions?: string
  speech?: string
  rerank?: string
}

export interface LocalInferenceFixture {
  id: LocalInferenceFixtureId | string
  family: LocalInferenceRuntimeFamily
  runtimeSource: string
  protocol: LocalInferenceProtocol
  baseUrl: string
  docs: string[]
  endpointShape: LocalInferenceEndpointShape
  capabilities: Partial<Record<LocalInferenceCapability, boolean>>
  modelListStatus: LocalInferenceModelListStatus
  discoveredModels?: string[]
  manualModel?: string
  timeoutMs: number
  requirements: LocalInferenceRuntimeRequirements
  environment: LocalInferenceEnvironment
  notes?: string
}

export interface LocalInferenceCapabilitySummary {
  declared: LocalInferenceCapability[]
  blocked: LocalInferenceCapability[]
}

export interface LocalInferenceDiagnostic {
  fixtureId: string
  family: LocalInferenceRuntimeFamily
  runtimeSource: string
  protocol: LocalInferenceProtocol
  baseUrl: string
  docs: string[]
  endpointShape: LocalInferenceEndpointShape
  clientPlatform: LocalInferenceClientPlatform
  hostKind: LocalInferenceHostKind
  mobileReachability: 'reachable' | 'requires-lan-host' | 'not-reachable'
  userOptIn: boolean
  readiness: LocalInferenceReadiness
  timeoutMs: number
  requirements: LocalInferenceRuntimeRequirements
  availableSystemRamGb: number
  availableGpuVramGb?: number
  modelListStatus: LocalInferenceModelListStatus
  modelCount: number
  manualModel?: string
  manualModelFallbackUsed: boolean
  fallbackPolicy: string
  capabilitySummary: LocalInferenceCapabilitySummary
  riskCodes: LocalInferenceRiskCode[]
}

export interface LocalInferenceCompatibilityQualityGate {
  passed: boolean
  failures: string[]
  requiredRuntimeFamilies: LocalInferenceRuntimeFamily[]
  requiredFixtureIds: string[]
}

export interface LocalInferenceCompatibilityEvaluationRun {
  schema: typeof LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA
  id: string
  ranAt: number
  diagnostics: LocalInferenceDiagnostic[]
  qualityGate: LocalInferenceCompatibilityQualityGate
}

export interface LocalInferenceCompatibilityEvaluationOptions {
  now?: () => number
  fixtures?: LocalInferenceFixture[]
  requiredFixtureIds?: string[]
}

export const LOCAL_INFERENCE_COMPATIBILITY_FIXTURES: LocalInferenceFixture[] = [
  {
    id: 'ollama-openai-compatible',
    family: 'ollama',
    runtimeSource: 'Ollama local server',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.20:11434/v1',
    docs: [
      'https://docs.ollama.com/api/openai-compatibility.md',
      'https://docs.ollama.com/api/chat.md',
      'https://docs.ollama.com/capabilities/structured-outputs.md',
      'https://docs.ollama.com/api/embed.md',
    ],
    endpointShape: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      embeddings: '/v1/embeddings',
    },
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      embeddings: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
      vision: true,
    },
    modelListStatus: 'ok',
    discoveredModels: ['llama3.2:latest', 'qwen3:8b'],
    timeoutMs: 60000,
    requirements: { minSystemRamGb: 8, mobileRuntimeSupported: false, cpuOnlySupported: true },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32 },
  },
  {
    id: 'llama-cpp-server',
    family: 'llama-cpp',
    runtimeSource: 'llama.cpp server',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.21:8080/v1',
    docs: [
      'https://github.com/ggml-org/llama.cpp/tree/master/examples/server',
    ],
    endpointShape: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      embeddings: '/v1/embeddings',
    },
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      embeddings: true,
      structuredOutput: true,
    },
    modelListStatus: 'ok',
    discoveredModels: ['qwen2.5-7b-instruct-q4_k_m.gguf'],
    timeoutMs: 90000,
    requirements: { minSystemRamGb: 8, mobileRuntimeSupported: false, cpuOnlySupported: true },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32 },
  },
  {
    id: 'lm-studio-openai-compatible',
    family: 'lm-studio',
    runtimeSource: 'LM Studio local server',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.22:1234/v1',
    docs: [
      'https://lmstudio.ai/docs/app/api/endpoints/openai',
      'https://lmstudio.ai/docs/app/api/structured-output',
      'https://lmstudio.ai/docs/app/api/tools',
    ],
    endpointShape: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      embeddings: '/v1/embeddings',
      responses: '/v1/responses',
    },
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      embeddings: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
      responses: true,
    },
    modelListStatus: 'ok',
    discoveredModels: ['local-model'],
    timeoutMs: 60000,
    requirements: { minSystemRamGb: 12, mobileRuntimeSupported: false, cpuOnlySupported: true },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32 },
  },
  {
    id: 'localai-audio-and-grammar',
    family: 'localai',
    runtimeSource: 'LocalAI server',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.23:8080/v1',
    docs: [
      'https://localai.io/features/text-generation/',
      'https://localai.io/features/openai-functions/',
      'https://localai.io/features/constrained_grammars/',
      'https://localai.io/features/audio-to-text/',
      'https://localai.io/features/text-to-audio/',
    ],
    endpointShape: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      embeddings: '/v1/embeddings',
      audioTranscriptions: '/v1/audio/transcriptions',
      speech: '/v1/audio/speech',
    },
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      embeddings: true,
      tools: true,
      structuredOutput: true,
      audio: true,
      speech: true,
    },
    modelListStatus: 'ok',
    discoveredModels: ['localai-chat', 'qwen3-embedding-4b', 'whisper-1'],
    timeoutMs: 90000,
    requirements: { minSystemRamGb: 12, mobileRuntimeSupported: false, cpuOnlySupported: true },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32 },
    notes: 'Structured output is grammar-backed and requires an IsleMind grammar planner before request controls are enabled.',
  },
  {
    id: 'vllm-gpu-server',
    family: 'vllm',
    runtimeSource: 'vLLM OpenAI-compatible server',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.24:8000/v1',
    docs: [
      'https://docs.vllm.ai/en/latest/serving/online_serving/',
      'https://docs.vllm.ai/en/latest/features/tool_calling.html',
      'https://docs.vllm.ai/en/latest/features/structured_outputs.html',
      'https://docs.vllm.ai/en/latest/features/reasoning_outputs.html',
    ],
    endpointShape: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      embeddings: '/v1/embeddings',
      responses: '/v1/responses',
      rerank: '/v1/rerank',
    },
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      embeddings: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
      responses: true,
    },
    modelListStatus: 'ok',
    discoveredModels: ['Qwen/Qwen3-8B'],
    timeoutMs: 120000,
    requirements: { minSystemRamGb: 16, minGpuVramGb: 12, mobileRuntimeSupported: false, cpuOnlySupported: false },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32, availableGpuVramGb: 24 },
  },
  {
    id: 'sglang-reasoning-server',
    family: 'sglang',
    runtimeSource: 'SGLang OpenAI-compatible server',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.25:30000/v1',
    docs: [
      'https://docs.sglang.io/docs/basic_usage/openai_api_completions.md',
      'https://docs.sglang.io/docs/basic_usage/openai_api_embeddings.md',
      'https://docs.sglang.io/docs/advanced_features/tool_parser.md',
      'https://docs.sglang.io/docs/advanced_features/structured_outputs.md',
      'https://docs.sglang.io/docs/advanced_features/separate_reasoning.md',
    ],
    endpointShape: {
      chat: '/v1/chat/completions',
      models: '/v1/models',
      embeddings: '/v1/embeddings',
    },
    capabilities: {
      chat: true,
      streaming: true,
      modelList: true,
      embeddings: true,
      tools: true,
      structuredOutput: true,
      reasoning: true,
      vision: true,
    },
    modelListStatus: 'ok',
    discoveredModels: ['Qwen/Qwen3-8B'],
    timeoutMs: 120000,
    requirements: { minSystemRamGb: 16, minGpuVramGb: 12, mobileRuntimeSupported: false, cpuOnlySupported: false },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32, availableGpuVramGb: 24 },
  },
  {
    id: 'mobile-loopback-warning',
    family: 'ollama',
    runtimeSource: 'Ollama localhost configured from mobile app',
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    docs: ['https://docs.ollama.com/api/openai-compatibility.md'],
    endpointShape: { chat: '/v1/chat/completions', models: '/v1/models' },
    capabilities: { chat: true, streaming: true, modelList: true },
    modelListStatus: 'ok',
    discoveredModels: ['llama3.2:latest'],
    timeoutMs: 30000,
    requirements: { minSystemRamGb: 8, mobileRuntimeSupported: false, cpuOnlySupported: true },
    environment: { clientPlatform: 'android', hostKind: 'loopback', userOptIn: true, availableSystemRamGb: 32 },
  },
  {
    id: 'model-list-fallback',
    family: 'llama-cpp',
    runtimeSource: 'llama.cpp server without model-list response',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.26:8080/v1',
    docs: ['https://github.com/ggml-org/llama.cpp/tree/master/examples/server'],
    endpointShape: { chat: '/v1/chat/completions', models: '/v1/models' },
    capabilities: { chat: true, streaming: true, modelList: false },
    modelListStatus: 'error',
    manualModel: 'manual-gguf-model',
    timeoutMs: 90000,
    requirements: { minSystemRamGb: 8, mobileRuntimeSupported: false, cpuOnlySupported: true },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32 },
  },
  {
    id: 'memory-pressure-boundary',
    family: 'vllm',
    runtimeSource: 'vLLM 70B GPU server candidate',
    protocol: 'openai-compatible',
    baseUrl: 'http://192.168.1.27:8000/v1',
    docs: ['https://docs.vllm.ai/en/latest/serving/online_serving/'],
    endpointShape: { chat: '/v1/chat/completions', models: '/v1/models' },
    capabilities: { chat: true, streaming: true, modelList: true, tools: true },
    modelListStatus: 'ok',
    discoveredModels: ['Qwen/Qwen3-72B'],
    timeoutMs: 180000,
    requirements: { minSystemRamGb: 48, minGpuVramGb: 48, mobileRuntimeSupported: false, cpuOnlySupported: false },
    environment: { clientPlatform: 'android', hostKind: 'lan', userOptIn: true, availableSystemRamGb: 32, availableGpuVramGb: 24 },
  },
]

export function runLocalInferenceCompatibilityEvaluation(options: LocalInferenceCompatibilityEvaluationOptions = {}): LocalInferenceCompatibilityEvaluationRun {
  const now = options.now ?? (() => Date.now())
  const ranAt = now()
  const fixtures = options.fixtures ?? LOCAL_INFERENCE_COMPATIBILITY_FIXTURES
  const diagnostics = fixtures.map(evaluateLocalInferenceFixture)
  return {
    schema: LOCAL_INFERENCE_COMPATIBILITY_EVAL_SCHEMA,
    id: `local-inference-compatibility-eval-${ranAt}`,
    ranAt,
    diagnostics,
    qualityGate: evaluateLocalInferenceCompatibilityQualityGate(diagnostics, options.requiredFixtureIds ?? [...LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS]),
  }
}

export function evaluateLocalInferenceFixture(fixture: LocalInferenceFixture): LocalInferenceDiagnostic {
  const riskCodes = collectRiskCodes(fixture)
  const declared = capabilityList(fixture.capabilities, true)
  const blocked = capabilityList(fixture.capabilities, false)
  const manualModelFallbackUsed = fixture.modelListStatus !== 'ok' && Boolean(fixture.manualModel)
  const modelCount = fixture.modelListStatus === 'ok'
    ? fixture.discoveredModels?.length ?? 0
    : manualModelFallbackUsed ? 1 : 0
  const readiness = resolveReadiness(riskCodes, modelCount)
  return {
    fixtureId: fixture.id,
    family: fixture.family,
    runtimeSource: fixture.runtimeSource,
    protocol: fixture.protocol,
    baseUrl: fixture.baseUrl,
    docs: fixture.docs,
    endpointShape: fixture.endpointShape,
    clientPlatform: fixture.environment.clientPlatform,
    hostKind: fixture.environment.hostKind,
    mobileReachability: resolveMobileReachability(fixture),
    userOptIn: fixture.environment.userOptIn,
    readiness,
    timeoutMs: fixture.timeoutMs,
    requirements: fixture.requirements,
    availableSystemRamGb: fixture.environment.availableSystemRamGb,
    availableGpuVramGb: fixture.environment.availableGpuVramGb,
    modelListStatus: fixture.modelListStatus,
    modelCount,
    manualModel: fixture.manualModel,
    manualModelFallbackUsed,
    fallbackPolicy: manualModelFallbackUsed
      ? 'model-list failure falls back to an explicit manual model id'
      : 'model-list success uses discovered model metadata',
    capabilitySummary: { declared, blocked },
    riskCodes,
  }
}

export function evaluateLocalInferenceCompatibilityQualityGate(
  diagnostics: LocalInferenceDiagnostic[],
  requiredFixtureIds: string[] = [...LOCAL_INFERENCE_COMPATIBILITY_FIXTURE_IDS]
): LocalInferenceCompatibilityQualityGate {
  const failures: string[] = []
  const byId = new Map(diagnostics.map((item) => [item.fixtureId, item]))
  const requiredRuntimeFamilies = [...LOCAL_INFERENCE_RUNTIME_FAMILIES]

  for (const id of requiredFixtureIds) {
    if (!byId.has(id)) failures.push(`${id}:missing-fixture`)
  }
  for (const family of requiredRuntimeFamilies) {
    if (!diagnostics.some((item) => item.family === family)) failures.push(`${family}:missing-runtime-family`)
  }
  for (const item of diagnostics) {
    if (!item.runtimeSource.trim()) failures.push(`${item.fixtureId}:missing-runtime-source`)
    if (!item.docs.length) failures.push(`${item.fixtureId}:missing-docs`)
    if (!item.baseUrl.trim()) failures.push(`${item.fixtureId}:missing-base-url`)
    if (!item.endpointShape.chat) failures.push(`${item.fixtureId}:missing-chat-endpoint`)
    if (item.timeoutMs < 30000) failures.push(`${item.fixtureId}:timeout-too-low`)
    if (item.requirements.minSystemRamGb <= 0) failures.push(`${item.fixtureId}:missing-memory-requirement`)
    if (item.modelCount <= 0 && !item.riskCodes.includes('memory_pressure')) failures.push(`${item.fixtureId}:missing-model-metadata`)
    if (item.hostKind === 'lan' && !item.userOptIn) failures.push(`${item.fixtureId}:lan-without-opt-in`)
    if (item.clientPlatform !== 'desktop' && item.requirements.mobileRuntimeSupported) failures.push(`${item.fixtureId}:claimed-mobile-runtime`)
  }

  const loopback = byId.get('mobile-loopback-warning')
  if (loopback?.readiness !== 'blocked') failures.push('mobile-loopback-warning:not-blocked')
  if (!loopback?.riskCodes.includes('mobile_loopback_unreachable')) failures.push('mobile-loopback-warning:missing-loopback-risk')

  const fallback = byId.get('model-list-fallback')
  if (fallback?.manualModelFallbackUsed !== true) failures.push('model-list-fallback:no-manual-fallback')
  if (!fallback?.riskCodes.includes('model_list_unavailable')) failures.push('model-list-fallback:missing-model-list-risk')
  if (fallback?.readiness !== 'needs-user-config') failures.push('model-list-fallback:not-user-config')

  const memory = byId.get('memory-pressure-boundary')
  if (memory?.readiness !== 'blocked') failures.push('memory-pressure-boundary:not-blocked')
  if (!memory?.riskCodes.includes('memory_pressure')) failures.push('memory-pressure-boundary:missing-memory-risk')

  const localai = byId.get('localai-audio-and-grammar')
  if (!localai?.riskCodes.includes('structured_output_adapter_required')) failures.push('localai-audio-and-grammar:missing-grammar-adapter-risk')

  for (const id of ['ollama-openai-compatible', 'llama-cpp-server', 'lm-studio-openai-compatible', 'vllm-gpu-server', 'sglang-reasoning-server']) {
    const item = byId.get(id)
    if (item?.readiness !== 'ready') failures.push(`${id}:not-ready`)
    if (item?.hostKind !== 'lan') failures.push(`${id}:not-lan-target`)
    if (item?.userOptIn !== true) failures.push(`${id}:missing-opt-in`)
    if (!item?.capabilitySummary.declared.includes('chat')) failures.push(`${id}:missing-chat-capability`)
    if (!item?.capabilitySummary.declared.includes('streaming')) failures.push(`${id}:missing-streaming-capability`)
  }

  return {
    passed: failures.length === 0,
    failures,
    requiredRuntimeFamilies,
    requiredFixtureIds,
  }
}

function collectRiskCodes(fixture: LocalInferenceFixture): LocalInferenceRiskCode[] {
  const risks: LocalInferenceRiskCode[] = []
  if (fixture.environment.clientPlatform !== 'desktop' && fixture.environment.hostKind === 'loopback') {
    risks.push('mobile_loopback_unreachable')
  }
  if (fixture.environment.hostKind === 'lan' && !fixture.environment.userOptIn) {
    risks.push('lan_opt_in_required')
  }
  if (fixture.modelListStatus !== 'ok') {
    risks.push('model_list_unavailable')
    if (!fixture.manualModel) risks.push('manual_model_required')
  }
  if (!hasEnoughMemory(fixture)) risks.push('memory_pressure')
  if (!fixture.requirements.mobileRuntimeSupported) risks.push('not_mobile_runtime')
  if (!fixture.endpointShape.chat) risks.push('unsupported_endpoint')
  if (fixture.family === 'localai' && fixture.capabilities.structuredOutput) risks.push('structured_output_adapter_required')
  return unique(risks)
}

function resolveReadiness(riskCodes: LocalInferenceRiskCode[], modelCount: number): LocalInferenceReadiness {
  if (riskCodes.includes('mobile_loopback_unreachable') || riskCodes.includes('memory_pressure') || riskCodes.includes('unsupported_endpoint')) return 'blocked'
  if (riskCodes.includes('lan_opt_in_required') || riskCodes.includes('manual_model_required') || riskCodes.includes('model_list_unavailable') || modelCount <= 0) return 'needs-user-config'
  return 'ready'
}

function resolveMobileReachability(fixture: LocalInferenceFixture): LocalInferenceDiagnostic['mobileReachability'] {
  if (fixture.environment.clientPlatform === 'desktop') return 'reachable'
  if (fixture.environment.hostKind === 'loopback') return 'not-reachable'
  if (fixture.environment.hostKind === 'lan') return 'requires-lan-host'
  return 'reachable'
}

function hasEnoughMemory(fixture: LocalInferenceFixture): boolean {
  const ramOk = fixture.environment.availableSystemRamGb >= fixture.requirements.minSystemRamGb
  const vramOk = fixture.requirements.minGpuVramGb === undefined
    || (fixture.environment.availableGpuVramGb ?? 0) >= fixture.requirements.minGpuVramGb
  return ramOk && vramOk
}

function capabilityList(
  capabilities: Partial<Record<LocalInferenceCapability, boolean>>,
  expected: boolean
): LocalInferenceCapability[] {
  return (Object.keys(capabilities) as LocalInferenceCapability[])
    .filter((key) => Boolean(capabilities[key]) === expected)
    .sort()
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
