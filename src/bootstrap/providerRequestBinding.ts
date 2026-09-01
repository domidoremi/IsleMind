import type { ProviderRouteContext } from '@/modules/providers'
import { resolveProviderRoute } from './providerRouteBinding'
import type { ProviderFailoverInput } from '@/modules/providers'
import { optimizeRequestBody as optimizeProviderRequestBody } from './providerRequestPolicies'
import {
  buildProviderOpenAIChatResponseFormat,
  buildProviderOpenAIResponsesResponseFormat,
  buildProviderOpenAIResponsesTextConfig,
  createAnthropicRequestBodyBuilder,
  createGoogleRequestBodyBuilder,
  createOpenAIChatRequestBodyBuilder,
  createOpenAIResponsesRequestBodyBuilder,
  createProviderAttachmentEncodingPolicy,
  createProviderNativeSearchPolicy,
  createProviderProtocolAdapterPolicy,
  createProviderRequestCompatibilityPolicy,
  createProviderRequestSerializationPolicy,
  createProviderRequestShapePolicy,
  providerRequestCompatibilityCapabilityCanBeSent,
  providerOpenAIResponsesTextFormatAllowed,
  resolveProviderRequestCompatibilityEvidence,
  shouldRequestOpenAIChatStreamUsage,
} from '@/modules/providers'
import { clampMaxTokens } from './providerRequestPolicies'
import { getOpenAIChatMaxTokensField } from '@/modules/providers'
import { openAICompatibleReasoningReplayField, openAIResponsesNativeWebSearchTool, usesOpenAIResponses } from './providerRequestPolicies'
import { providerRequestReasoningPolicy } from './providerRequestReasoning'
import type { Attachment } from '@/types/chatContracts'
import type { ProviderRuntimeChatRequest } from '@/modules/providers'
import { providerModelCapabilityCanBeSent } from './providerCapabilityMatrix'

export { resolveProviderRoute } from './providerRouteBinding'

const providerProtocolAdapterPolicy = createProviderProtocolAdapterPolicy<ProviderRuntimeChatRequest>({
  usesOpenAIResponses,
})

export const resolveProviderProtocolAdapter = providerProtocolAdapterPolicy.resolve

const providerRequestCompatibilityPolicy = createProviderRequestCompatibilityPolicy({
  resolveEvidence: resolveProviderRequestCompatibilityEvidence,
  capabilityCanBeSent: providerRequestCompatibilityCapabilityCanBeSent,
})

const providerRequestShapePolicy = createProviderRequestShapePolicy<Attachment, ProviderRuntimeChatRequest>({
  compatibilityCapabilityCanBeSent: providerRequestCompatibilityPolicy.capabilityCanBeSent,
  compatibilityCapabilityStatus: providerRequestCompatibilityPolicy.capabilityStatus,
  usesProtocolReferenceEvidence: providerRequestCompatibilityPolicy.usesProtocolReferenceEvidence,
  modelCapabilityCanBeSent: providerModelCapabilityCanBeSent,
})

const providerNativeSearchPolicy = createProviderNativeSearchPolicy<ProviderRuntimeChatRequest>({
  providerNativeSearchCanBeSent(provider, explicitDeclaration) {
    return providerRequestCompatibilityPolicy.capabilityCanBeSent(provider, 'nativeSearch', explicitDeclaration)
  },
  requestModelCapabilityCanBeSent: providerRequestShapePolicy.requestModelCapabilityCanBeSent,
  openAIResponsesTool: openAIResponsesNativeWebSearchTool,
})

const providerAttachmentEncodingPolicy = createProviderAttachmentEncodingPolicy<ProviderRuntimeChatRequest, Attachment>()

const openAIChatRequestBodyBuilder = createOpenAIChatRequestBodyBuilder<ProviderRuntimeChatRequest, Attachment>({
  selectAttachments: providerRequestShapePolicy.selectAttachments,
  buildAttachmentPart: providerAttachmentEncodingPolicy.openAIChat,
  resolveReasoningReplayField(req, message) {
    return openAICompatibleReasoningReplayField(req, {
      ...(message.toolCalls ? { toolCalls: [...message.toolCalls] } : {}),
    })
  },
  resolveDeclaredTools: providerRequestShapePolicy.selectDeclaredTools,
  resolveNativeSearchTool: providerNativeSearchPolicy.openAIChat,
  includeStreamUsage(req) {
    return shouldRequestOpenAIChatStreamUsage(req)
  },
  resolveResponseFormat(req) {
    return buildProviderOpenAIChatResponseFormat(providerRequestShapePolicy.resolveStructuredOutputRequestPolicy(req))
  },
  resolveReasoningPolicy: providerRequestReasoningPolicy.openAIChatReasoning,
  resolveMaxTokensField: getOpenAIChatMaxTokensField,
  resolveRequestParameters(req, options) {
    return providerRequestReasoningPolicy.resolveParameters(req, {
      omitSampling: options.omitSampling,
      maxTokenParameterNames: [options.maxTokensField],
      endpoint: 'openai-chat',
    })
  },
})

const anthropicRequestBodyBuilder = createAnthropicRequestBodyBuilder<ProviderRuntimeChatRequest, Attachment>({
  selectAttachments: providerRequestShapePolicy.selectAttachments,
  buildAttachmentPart: providerAttachmentEncodingPolicy.anthropic,
  resolveDeclaredTools: providerRequestShapePolicy.selectDeclaredTools,
  resolveNativeSearchTool: providerNativeSearchPolicy.anthropic,
  resolveStructuredOutputTool: providerRequestShapePolicy.buildAnthropicStructuredOutputTool,
  resolveReasoningPolicy: providerRequestReasoningPolicy.anthropicReasoning,
  resolveRequestParameters(req, options) {
    return providerRequestReasoningPolicy.resolveParameters(req, {
      omitSampling: options.omitSampling,
      includeDefaultTopP: true,
      maxTokenParameterNames: ['max_tokens'],
      endpoint: 'anthropic',
      maxTokensRequired: true,
    })
  },
})

const googleRequestBodyBuilder = createGoogleRequestBodyBuilder<ProviderRuntimeChatRequest, Attachment>({
  selectAttachments: providerRequestShapePolicy.selectAttachments,
  buildAttachmentPart: providerAttachmentEncodingPolicy.google,
  resolveRequestParameters(req) {
    return providerRequestReasoningPolicy.resolveParameters(req, {
      includeDefaultTopP: true,
      maxTokenParameterNames: ['maxOutputTokens', 'generationConfig.maxOutputTokens'],
      endpoint: 'google',
    })
  },
  resolveThinkingConfig: providerRequestReasoningPolicy.googleThinking,
  resolveStructuredOutputConfig: providerRequestShapePolicy.buildGoogleStructuredOutputConfig,
  resolveDeclaredTools: providerRequestShapePolicy.selectDeclaredTools,
  resolveNativeSearchTool: providerNativeSearchPolicy.google,
})

const openAIResponsesRequestBodyBuilder = createOpenAIResponsesRequestBodyBuilder<ProviderRuntimeChatRequest, Attachment>({
  selectAttachments: providerRequestShapePolicy.selectAttachments,
  buildAttachmentPart: providerAttachmentEncodingPolicy.openAIResponses,
  resolveDeclaredTools: providerRequestShapePolicy.selectDeclaredTools,
  resolveNativeSearchTool: providerNativeSearchPolicy.openAIResponses,
  resolveRequestParameters(req) {
    return providerRequestReasoningPolicy.resolveParameters(req, {
      maxTokenParameterNames: ['max_output_tokens', 'maxOutputTokens'],
      endpoint: 'openai-responses',
    })
  },
  resolveReasoningPolicy: providerRequestReasoningPolicy.openAIResponsesReasoning,
  resolveTextConfig(req) {
    return buildProviderOpenAIResponsesTextConfig({
      ...providerRequestShapePolicy.resolveStructuredOutputRequestPolicy(req),
      responsesTextFormatAllowed: providerOpenAIResponsesTextFormatAllowed(req.provider, req.model),
    })
  },
  resolveResponseFormat(req) {
    return buildProviderOpenAIResponsesResponseFormat(providerRequestShapePolicy.resolveStructuredOutputRequestPolicy(req))
  },
})

const providerProtocolBodyBuilder = providerProtocolAdapterPolicy.bindBodyBuilders({
  openAIChat: openAIChatRequestBodyBuilder.build,
  openAIResponses: openAIResponsesRequestBodyBuilder.build,
  anthropic: anthropicRequestBodyBuilder.build,
  google: googleRequestBodyBuilder.build,
  xiaomiMimoAnthropic: anthropicRequestBodyBuilder.build,
})

export function buildProviderProtocolRequestBody(req: ProviderRuntimeChatRequest): Record<string, unknown> {
  return providerProtocolBodyBuilder.build(req).body
}

function prepareProviderProtocolRequest(req: ProviderRuntimeChatRequest): ProviderRuntimeChatRequest {
  const adapter = resolveProviderProtocolAdapter(req)
  let parameterPlan
  switch (adapter.bodyTarget) {
    case 'openai-chat': {
      const reasoning = providerRequestReasoningPolicy.openAIChatReasoning(req)
      const maxTokensField = getOpenAIChatMaxTokensField(req)
      parameterPlan = providerRequestReasoningPolicy.resolveParameters(req, {
        omitSampling: reasoning.omitSampling,
        maxTokenParameterNames: [maxTokensField],
        endpoint: 'openai-chat',
      }).parameterPlan
      break
    }
    case 'anthropic':
    case 'xiaomi-mimo-anthropic': {
      const reasoning = providerRequestReasoningPolicy.anthropicReasoning(req)
      parameterPlan = providerRequestReasoningPolicy.resolveParameters(req, {
        omitSampling: reasoning.omitSampling,
        includeDefaultTopP: true,
        maxTokenParameterNames: ['max_tokens'],
        endpoint: 'anthropic',
        maxTokensRequired: true,
      }).parameterPlan
      break
    }
    case 'google':
      parameterPlan = providerRequestReasoningPolicy.resolveParameters(req, {
        includeDefaultTopP: true,
        maxTokenParameterNames: ['maxOutputTokens', 'generationConfig.maxOutputTokens'],
        endpoint: 'google',
      }).parameterPlan
      break
    case 'openai-responses':
      parameterPlan = providerRequestReasoningPolicy.resolveParameters(req, {
        maxTokenParameterNames: ['max_output_tokens', 'maxOutputTokens'],
        endpoint: 'openai-responses',
      }).parameterPlan
      break
  }
  return { ...req, generationParameterPlan: parameterPlan }
}

export const providerRequestSerializer = createProviderRequestSerializationPolicy<
  ProviderRuntimeChatRequest,
  ProviderRouteContext,
  ProviderFailoverInput,
  Record<string, unknown>,
  ReturnType<typeof resolveProviderRoute>
>({
  prepareRequest: prepareProviderProtocolRequest,
  buildBody: buildProviderProtocolRequestBody,
  optimizeBody: optimizeProviderRequestBody,
  resolveFallbackMaxTokens: clampMaxTokens,
  resolveRoute(input) {
    return resolveProviderRoute(input)
  },
})
