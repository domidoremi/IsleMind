import type { AIProvider } from '@/types/providerContracts'

export type ProviderToolCompatibilityCapability = 'vision' | 'files' | 'tools' | 'audio'

export type ProviderProtocolReferenceCapability =
  | 'vision'
  | 'files'
  | 'nativeTools'
  | 'nativeSearch'
  | 'reasoningEffort'

export interface ProviderToolCapabilityModel {
  chatCompatible?: boolean
  supportsTools?: boolean
  supportsVision: boolean
  supportsFiles: boolean
  source?: 'built-in' | 'remote' | string
}

export interface ProviderToolCapabilityManifest {
  modalities: {
    input: {
      image: boolean
      file: boolean
      audio: boolean
    }
    output: {
      speech: boolean
    }
  }
  tools: {
    supported: boolean
  }
}

export type ProviderNativeToolCompatibilityStatus =
  | 'supported'
  | 'partial'
  | 'unsupported'
  | 'requiresLiveKey'
  | 'docsChanged'

export interface ProviderNativeToolCompatibilityEvidence {
  id: string
  auditState: string
  behaviorDocs: readonly string[]
  toolsStatus: ProviderNativeToolCompatibilityStatus
}

export interface ProviderNativeToolCapabilityModel {
  id: string
  chatCompatible?: boolean
  supportsTools?: boolean
  source?: 'built-in' | 'remote' | string
}

export type ProviderInputCapability = 'vision' | 'files'

export interface ProviderInputCapabilityModel {
  id: string
  chatCompatible?: boolean
  supportsVision: boolean
  supportsFiles: boolean
  source?: 'built-in' | 'remote' | string
}

export type ProviderNativeToolSupportReason =
  | 'supported_explicit_native_tools'
  | 'supported_model_tools_contract'
  | 'supported_core_provider_contract'
  | 'blocked_model_chat_incompatible'
  | 'blocked_model_tools_disabled'
  | 'blocked_contract_tools_unclaimed'
  | 'blocked_model_tools_unclaimed'

export interface ProviderNativeToolSupportDecision {
  supported: boolean
  reason: ProviderNativeToolSupportReason
  providerId: string
  providerType: AIProvider['type']
  modelId: string
  modelSupportsTools: boolean | undefined
  explicitNativeTools: boolean
  compatibilityId: string
  auditState: string
  behaviorDocs: string[]
  toolsStatus: ProviderNativeToolCompatibilityStatus
}

export interface ProviderToolCapabilityPolicyDependencies {
  compatibilityCapabilityCanBeSent(
    provider: AIProvider,
    capability: ProviderToolCompatibilityCapability,
    explicitDeclaration: boolean,
  ): boolean
  usesProtocolReferenceEvidence?(provider: AIProvider): boolean
}

export function createProviderToolCapabilityPolicy(
  dependencies: ProviderToolCapabilityPolicyDependencies,
) {
  const usesProtocolReferenceEvidence = dependencies.usesProtocolReferenceEvidence ?? isCustomProtocolReferenceProvider

  function protocolReferenceDisablesCapability(
    provider: AIProvider,
    model: Pick<ProviderToolCapabilityModel, 'source'>,
    capability: ProviderProtocolReferenceCapability,
  ): boolean {
    if (!usesProtocolReferenceEvidence(provider)) return false
    if (model.source === 'remote') return false
    return provider.capabilities?.[capability] !== true
  }

  function supportsNativeProviderTools(
    provider: AIProvider,
    model: ProviderToolCapabilityModel,
  ): boolean {
    if (model.chatCompatible === false) return false
    if (model.supportsTools === false) return false

    const explicitDeclaration = provider.capabilities?.nativeTools === true || model.supportsTools === true
    if (!dependencies.compatibilityCapabilityCanBeSent(provider, 'tools', explicitDeclaration)) return false

    if (model.supportsTools === true) {
      return !protocolReferenceDisablesCapability(provider, model, 'nativeTools')
    }
    if (provider.capabilities?.nativeTools === true) return true
    if (provider.capabilities?.nativeTools === false) return false
    return provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google'
  }

  function resolveProviderNativeToolSupport(
    provider: AIProvider,
    model: ProviderNativeToolCapabilityModel,
    compatibility: ProviderNativeToolCompatibilityEvidence,
  ): ProviderNativeToolSupportDecision {
    const decisionBase = {
      providerId: provider.id,
      providerType: provider.type,
      modelId: model.id,
      modelSupportsTools: model.supportsTools,
      explicitNativeTools: provider.capabilities?.nativeTools === true,
      compatibilityId: compatibility.id,
      auditState: compatibility.auditState,
      behaviorDocs: [...compatibility.behaviorDocs],
      toolsStatus: compatibility.toolsStatus,
    }

    if (model.chatCompatible === false) {
      return { ...decisionBase, supported: false, reason: 'blocked_model_chat_incompatible' }
    }
    if (model.supportsTools === false) {
      return { ...decisionBase, supported: false, reason: 'blocked_model_tools_disabled' }
    }

    const explicitDeclaration = provider.capabilities?.nativeTools === true || model.supportsTools === true
    if (!dependencies.compatibilityCapabilityCanBeSent(provider, 'tools', explicitDeclaration)) {
      return { ...decisionBase, supported: false, reason: 'blocked_contract_tools_unclaimed' }
    }
    if (model.supportsTools === true) {
      if (nativeToolCompatibilityReferenceDisablesCapability(provider, model, compatibility.id)) {
        return { ...decisionBase, supported: false, reason: 'blocked_contract_tools_unclaimed' }
      }
      return { ...decisionBase, supported: true, reason: 'supported_model_tools_contract' }
    }
    if (provider.capabilities?.nativeTools === true) {
      return { ...decisionBase, supported: true, reason: 'supported_explicit_native_tools' }
    }
    if (provider.type === 'openai' || provider.type === 'anthropic' || provider.type === 'google') {
      return { ...decisionBase, supported: true, reason: 'supported_core_provider_contract' }
    }
    return { ...decisionBase, supported: false, reason: 'blocked_model_tools_unclaimed' }
  }

  function supportsProviderInputCapability(
    provider: AIProvider,
    model: ProviderToolCapabilityModel,
    capability: 'vision' | 'files',
  ): boolean {
    const modelSupported = capability === 'vision' ? model.supportsVision : model.supportsFiles
    const explicitDeclaration = modelSupported || provider.capabilities?.[capability] === true
    if (!dependencies.compatibilityCapabilityCanBeSent(provider, capability, explicitDeclaration)) return false

    if (modelSupported) {
      return !protocolReferenceDisablesCapability(provider, model, capability)
    }
    return provider.capabilities?.[capability] === true
  }

  function supportsProviderInputCapabilityForModel(
    provider: AIProvider,
    model: ProviderInputCapabilityModel,
    capability: ProviderInputCapability,
    compatibilityId: string,
  ): boolean {
    if (model.chatCompatible === false) return false
    if (modelInputCapabilityExplicitlyDisabled(provider, model, capability)) return false
    if (provider.capabilities?.[capability] === true) {
      return dependencies.compatibilityCapabilityCanBeSent(provider, capability, true)
    }

    const modelSupported = capability === 'vision' ? model.supportsVision === true : model.supportsFiles === true
    if (capability === 'vision' && model.supportsVision === false) return false
    if (capability === 'files' && model.supportsFiles === false) return false
    if (!dependencies.compatibilityCapabilityCanBeSent(provider, capability, modelSupported)) return false
    if (modelSupported) {
      return !inputCompatibilityReferenceDisablesCapability(provider, model, capability, compatibilityId)
    }
    return false
  }

  function providerSupportsVisionInput(
    provider: AIProvider,
    model: ProviderInputCapabilityModel,
    compatibilityId: string,
  ): boolean {
    return supportsProviderInputCapabilityForModel(provider, model, 'vision', compatibilityId)
  }

  function providerSupportsFileInput(
    provider: AIProvider,
    model: ProviderInputCapabilityModel,
    compatibilityId: string,
  ): boolean {
    return supportsProviderInputCapabilityForModel(provider, model, 'files', compatibilityId)
  }

  function supportsProviderAudioInput(provider: AIProvider): boolean {
    return provider.capabilities?.audioInput === true &&
      dependencies.compatibilityCapabilityCanBeSent(provider, 'audio', true)
  }

  function supportsProviderSpeechOutput(provider: AIProvider): boolean {
    return provider.capabilities?.speech === true &&
      dependencies.compatibilityCapabilityCanBeSent(provider, 'audio', true)
  }

  function resolveProviderToolCapabilityManifest(
    provider: AIProvider,
    model: ProviderToolCapabilityModel,
  ): ProviderToolCapabilityManifest {
    return {
      modalities: {
        input: {
          image: supportsProviderInputCapability(provider, model, 'vision'),
          file: supportsProviderInputCapability(provider, model, 'files'),
          audio: supportsProviderAudioInput(provider),
        },
        output: {
          speech: supportsProviderSpeechOutput(provider),
        },
      },
      tools: {
        supported: supportsNativeProviderTools(provider, model),
      },
    }
  }

  return {
    resolveProviderToolCapabilityManifest,
    resolveProviderNativeToolSupport,
    supportsNativeProviderTools,
    supportsProviderInputCapability,
    supportsProviderInputCapabilityForModel,
    providerSupportsVisionInput,
    providerSupportsFileInput,
    supportsProviderAudioInput,
    supportsProviderSpeechOutput,
  }
}

function modelInputCapabilityExplicitlyDisabled(
  provider: AIProvider,
  model: ProviderInputCapabilityModel,
  capability: ProviderInputCapability,
): boolean {
  const field = capability === 'vision' ? 'supportsVision' : 'supportsFiles'
  if (model[field] !== false) return false
  if (model.source === 'remote') return true
  return (provider.modelConfigs ?? []).some((configuredModel) => (
    sameModelId(configuredModel.id, model.id) && configuredModel[field] === false
  ))
}

function inputCompatibilityReferenceDisablesCapability(
  provider: AIProvider,
  model: Pick<ProviderInputCapabilityModel, 'source'>,
  capability: ProviderInputCapability,
  compatibilityId: string,
): boolean {
  if (compatibilityId !== 'openai-compatible' && compatibilityId !== 'anthropic-compatible') return false
  if (model.source === 'remote') return false
  return provider.capabilities?.[capability] !== true
}

function sameModelId(left: string | undefined, right: string | undefined): boolean {
  return (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase()
}

function nativeToolCompatibilityReferenceDisablesCapability(
  provider: AIProvider,
  model: Pick<ProviderNativeToolCapabilityModel, 'source'>,
  compatibilityId: string,
): boolean {
  if (compatibilityId !== 'openai-compatible' && compatibilityId !== 'anthropic-compatible') return false
  if (model.source === 'remote') return false
  return provider.capabilities?.nativeTools !== true
}

export function providerProtocolReferenceDisablesCapability(
  provider: AIProvider,
  model: Pick<ProviderToolCapabilityModel, 'source'>,
  capability: ProviderProtocolReferenceCapability,
): boolean {
  if (!isCustomProtocolReferenceProvider(provider)) return false
  if (model.source === 'remote') return false
  return provider.capabilities?.[capability] !== true
}

export function isCustomProtocolReferenceProvider(provider: AIProvider): boolean {
  return provider.presetId === 'custom-endpoint' ||
    provider.detectedPresetId === 'custom-endpoint'
}
