import type { AIProvider } from '@/types/providerContracts'
import { getModelConfig } from '@/types/modelCatalog'
import type { ProviderSelectableAttachment } from './providerAttachments'
import { selectProviderRequestAttachments } from './providerAttachments'
import type { ProviderStructuredOutputRequest, ProviderStructuredOutputRequestShape } from './providerStructuredOutput'
import { providerStructuredOutputToolName, providerStructuredOutputToolSchema } from './providerStructuredOutput'
import { selectProviderToolDeclarations } from './providerToolDeclarations'
import { createProviderToolCapabilityPolicy } from './providerToolCapabilityPolicy'

export interface ProviderRequestShapeManifest {
  modalities: { input: { image: boolean; file: boolean } }
  tools: { supported: boolean }
  structuredOutput: { appRequestControl: boolean; documentedRequestShape: ProviderStructuredOutputRequestShape; strictJsonSchema: boolean }
}

export interface ProviderRequestShapeRequest<Attachment extends ProviderSelectableAttachment> {
  provider: AIProvider
  model: string
  attachments?: readonly Attachment[]
  providerToolDeclarations?: readonly unknown[]
  structuredOutput?: ProviderStructuredOutputRequest
}

export type ProviderRequestShapeCapability = 'vision' | 'files' | 'tools' | 'responseFormat' | 'nativeSearch'

type ProviderRequestCompatibilityCapability = 'vision' | 'files' | 'tools' | 'structuredOutput' | 'nativeSearch'
type ProviderRequestCompatibilityStatus = 'supported' | 'partial' | 'requiresLiveKey' | 'docsChanged' | 'unsupported'

export function createProviderRequestShapePolicy<Attachment extends ProviderSelectableAttachment, Request extends ProviderRequestShapeRequest<Attachment>>(dependencies: {
  compatibilityCapabilityCanBeSent(provider: AIProvider, capability: ProviderRequestCompatibilityCapability, explicitDeclaration: boolean): boolean
  compatibilityCapabilityStatus(provider: AIProvider, capability: ProviderRequestCompatibilityCapability): ProviderRequestCompatibilityStatus
  usesProtocolReferenceEvidence(provider: AIProvider): boolean
}) {
  const toolCapabilityPolicy = createProviderToolCapabilityPolicy({
    compatibilityCapabilityCanBeSent(provider, capability, explicitDeclaration) {
      if (capability === 'audio') return false
      return dependencies.compatibilityCapabilityCanBeSent(provider, capability, explicitDeclaration)
    },
    usesProtocolReferenceEvidence: dependencies.usesProtocolReferenceEvidence,
  })

  function resolveCapabilityManifest(request: Request): ProviderRequestShapeManifest {
    const modelConfig = getModelConfig(request.model, request.provider.type, request.provider.modelConfigs)
    const image = toolCapabilityPolicy.supportsProviderInputCapability(request.provider, modelConfig, 'vision')
    const file = toolCapabilityPolicy.supportsProviderInputCapability(request.provider, modelConfig, 'files')
    const toolsSupported = toolCapabilityPolicy.supportsNativeProviderTools(request.provider, modelConfig)
    const structuredOutput = resolveStructuredOutputManifest(request.provider, request.model)
    return { modalities: { input: { image, file } }, tools: { supported: toolsSupported }, structuredOutput }
  }

  function requestModelCapabilityCanBeSent(request: Request, capability: ProviderRequestShapeCapability): boolean {
    if (request.provider.type !== 'openai-compatible' || request.provider.wireProtocol === 'anthropic-compatible') return true
    const provider = request.provider
    const resolvedModel = resolveProviderModelAlias(provider, request.model)
    const modelConfig = getModelConfig(resolvedModel, provider.type, provider.modelConfigs)
    const compatibilityCapability = capability === 'responseFormat' ? 'structuredOutput' : capability
    const declared = modelDeclaresCapability(modelConfig, capability)
    const providerDeclared = providerDeclaresCapability(provider, capability)
    if (!dependencies.compatibilityCapabilityCanBeSent(provider, compatibilityCapability, declared || providerDeclared)) return false
    if (providerDeclared) return true
    if (modelConfig.source === 'remote' && declared) return true
    if (provider.modelConfigs?.some((item) => sameModelId(item.id, modelConfig.id)) && declared) return true
    if (!dependencies.usesProtocolReferenceEvidence(provider) && declared && (
      modelConfig.source === 'built-in' || Boolean(modelConfig.sourceUrl || modelConfig.verifiedAt)
    )) return true
    if (dependencies.usesProtocolReferenceEvidence(provider)) return false
    const contractCapability = capability === 'responseFormat' ? 'structuredOutput' : capability
    return (capability === 'responseFormat' || capability === 'nativeSearch') &&
      Boolean(modelConfig.source === 'built-in' || modelConfig.sourceUrl || modelConfig.verifiedAt) &&
      dependencies.compatibilityCapabilityStatus(provider, contractCapability) === 'supported'
  }
  function selectAttachments(request: Request): Attachment[] {
    const manifest = resolveCapabilityManifest(request)
    return selectProviderRequestAttachments({
      attachments: request.attachments,
      imageInputSupported: manifest.modalities.input.image,
      fileInputSupported: manifest.modalities.input.file,
      visionCapabilityAllowed: requestModelCapabilityCanBeSent(request, 'vision'),
      filesCapabilityAllowed: requestModelCapabilityCanBeSent(request, 'files'),
    })
  }
  function selectDeclaredTools(request: Request): readonly unknown[] | undefined {
    const manifest = resolveCapabilityManifest(request)
    return selectProviderToolDeclarations({
      declarations: request.providerToolDeclarations,
      providerToolsSupported: manifest.tools.supported,
      toolsCapabilityAllowed: requestModelCapabilityCanBeSent(request, 'tools'),
    })
  }
  function resolveStructuredOutputRequestPolicy(request: Request) {
    const manifest = resolveCapabilityManifest(request)
    return { request: request.structuredOutput, capabilityAllowed: requestModelCapabilityCanBeSent(request, 'responseFormat'), ...manifest.structuredOutput }
  }
  function buildAnthropicStructuredOutputTool(request: Request): Record<string, unknown> | undefined {
    const inputSchema = providerStructuredOutputToolSchema(request.structuredOutput)
    const manifest = resolveCapabilityManifest(request)
    if (!inputSchema || !manifest.structuredOutput.appRequestControl || manifest.structuredOutput.documentedRequestShape !== 'anthropic-tool-schema') return undefined
    return { name: providerStructuredOutputToolName(request.structuredOutput), description: 'Return the final answer as structured JSON that matches this input schema.', input_schema: inputSchema }
  }
  function buildGoogleStructuredOutputConfig(request: Request): Record<string, unknown> | undefined {
    const structuredOutput = request.structuredOutput
    const manifest = resolveCapabilityManifest(request)
    if (!structuredOutput || !manifest.structuredOutput.appRequestControl || manifest.structuredOutput.documentedRequestShape !== 'google-response-schema') return undefined
    if (structuredOutput.type === 'json_object') return { responseMimeType: 'application/json' }
    if (!structuredOutput.schema) return undefined
    return { responseMimeType: 'application/json', responseSchema: structuredOutput.schema }
  }
  return { resolveCapabilityManifest, requestModelCapabilityCanBeSent, selectAttachments, selectDeclaredTools, resolveStructuredOutputRequestPolicy, buildAnthropicStructuredOutputTool, buildGoogleStructuredOutputConfig }

  function resolveStructuredOutputManifest(provider: AIProvider, model: string): ProviderRequestShapeManifest['structuredOutput'] {
    const family = providerRequestFamily(provider)
    const protocol = providerRequestProtocol(provider, family)
    const modelConfig = getModelConfig(model, provider.type, provider.modelConfigs)
    const modelDeclared = modelDeclaresCapability(modelConfig, 'responseFormat')
    const contractClaimed = dependencies.compatibilityCapabilityCanBeSent(provider, 'structuredOutput', modelDeclared)
    const appRequestControl = contractClaimed && structuredOutputAppRequestControl(provider, modelConfig, family, protocol)
    return {
      appRequestControl,
      documentedRequestShape: contractClaimed ? structuredOutputRequestShape(family, protocol) : 'none',
      strictJsonSchema: appRequestControl && ['openai', 'openrouter', 'xai', 'cerebras', 'ollama', 'lm-studio'].includes(family),
    }
  }

  function structuredOutputAppRequestControl(
    provider: AIProvider,
    modelConfig: ReturnType<typeof getModelConfig>,
    family: string,
    protocol: string,
  ): boolean {
    if (family === 'openai' && (protocol === 'openai-responses' || protocol === 'openai-chat-completions')) return true
    if (family === 'anthropic' && protocol === 'anthropic-messages') return true
    if (family === 'google' || protocol === 'google-generate-content') return true
    if (family === 'deepseek' && protocol === 'openai-compatible') return true
    if (family === 'openrouter' && (protocol === 'openai-compatible' || protocol === 'openai-responses')) {
      const parameters = normalizedSupportedParameters(modelConfig)
      return !parameters.length || parameters.includes('response_format') || parameters.includes('structured_outputs')
    }
    if (['ollama', 'lm-studio', 'azure-openai', 'vertex-ai', 'vllm', 'sglang', 'newapi'].includes(family) && protocol === 'openai-compatible') return true
    if (family === 'xai' && (protocol === 'openai-responses' || protocol === 'openai-compatible')) return true
    if ((protocol === 'openai-compatible' || protocol === 'openai-responses') && modelDeclaresCapability(modelConfig, 'responseFormat')) return true
    return protocol === 'openai-compatible' && (family === 'cerebras' || family === 'sambanova')
  }
}

function resolveProviderModelAlias(provider: AIProvider, model: string): string {
  const normalized = model.trim().toLowerCase()
  return provider.modelAliases?.find((item) => item.alias.trim().toLowerCase() === normalized)?.model ?? model
}

function providerDeclaresCapability(provider: AIProvider, capability: ProviderRequestShapeCapability): boolean {
  if (capability === 'tools') return provider.capabilities?.nativeTools === true
  if (capability === 'responseFormat') return false
  if (capability === 'nativeSearch') return provider.capabilities?.nativeSearch === true
  return provider.capabilities?.[capability] === true
}

function modelDeclaresCapability(modelConfig: ReturnType<typeof getModelConfig>, capability: ProviderRequestShapeCapability): boolean {
  if (capability === 'vision') return modelConfig.supportsVision === true
  if (capability === 'files') return modelConfig.supportsFiles === true
  if (capability === 'tools') return modelConfig.supportsTools === true
  const parameters = normalizedSupportedParameters(modelConfig)
  if (capability === 'nativeSearch') return parameters.some((item) => [
    'native_search', 'web_search', 'web_search_preview', 'web_search_options', 'search_parameters',
  ].includes(item))
  return parameters.some((item) => ['response_format', 'structured_outputs', 'json_schema', 'text.format'].includes(item))
}

function normalizedSupportedParameters(modelConfig: ReturnType<typeof getModelConfig>): string[] {
  return modelConfig.supportedParameters?.map((item) => item.toLowerCase()) ?? []
}

function sameModelId(left: string | undefined, right: string | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase())
}

function providerRequestFamily(provider: AIProvider): string {
  const preset = provider.presetId ?? provider.detectedPresetId
  const identity = [provider.id, provider.name, provider.baseUrl, preset].filter(Boolean).join(' ')
  if (/azure[-_ ]?openai|microsoft foundry|openai\.azure\.com|services\.ai\.azure\.com/i.test(identity)) return 'azure-openai'
  if (/vertex[-_ ]?ai|google cloud vertex|aiplatform\.googleapis\.com/i.test(identity)) return 'vertex-ai'
  if (provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google') return provider.type
  if (preset) return preset
  return provider.wireProtocol === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible'
}

function providerRequestProtocol(provider: AIProvider, family: string): string {
  if (provider.wireProtocol === 'anthropic-compatible') return 'anthropic-compatible'
  if (provider.type === 'anthropic') return 'anthropic-messages'
  if (provider.type === 'google') return 'google-generate-content'
  if (provider.type === 'openai') return provider.capabilities?.responsesApi === false ? 'openai-chat-completions' : 'openai-responses'
  if (provider.capabilities?.responsesApi === true) return 'openai-responses'
  if (family === 'google') return 'google-generate-content'
  return 'openai-compatible'
}

function structuredOutputRequestShape(family: string, protocol: string): ProviderStructuredOutputRequestShape {
  if (family === 'deepseek') return 'openai-json-object-response-format'
  if (family === 'openrouter') return 'openrouter-response-format'
  if (family === 'xai') return 'xai-response-format'
  if (family === 'localai') return 'localai-grammar'
  if (family === 'google' || protocol === 'google-generate-content') return 'google-response-schema'
  if (protocol === 'anthropic-messages' || protocol === 'anthropic-compatible') return 'anthropic-tool-schema'
  return 'openai-response-format'
}
