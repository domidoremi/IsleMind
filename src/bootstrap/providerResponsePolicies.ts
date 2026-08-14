import { st } from '@/i18n/service'
import {
  createProviderOperationResultPolicy,
  createProviderResponseParsingPolicy,
  createProviderStreamParsingPolicy,
  isPerplexityProvider,
  safeProviderResponseText,
} from '@/modules/providers'
import { splitTaggedThinkingOutputText } from '@/services/chatInternalOutputGuard'
import {
  getProviderCompatibilityEvidenceForProvider,
  providerCompatibilityCapabilityCanBeSentForProvider,
  providerCompatibilityEvidenceHasBehavior,
  providerCompatibilityReasoningExplicitlyDeclaredForModel,
} from '@/modules/providers'
import { createProviderTrace, extractTracesFromJson, summarizeToolEvent } from './providerTracePolicy'
import { getModelConfig } from '@/types/modelCatalog'
import { redactSensitiveText } from '@/core'

const providerStreamParsingPolicy = createProviderStreamParsingPolicy({
  translate: st,
  createTrace: createProviderTrace,
  summarizeToolEvent,
})

export const {
  dedupeTraces,
  parseProviderStreamChunk,
  parseProviderStreamEvent,
  splitSseBuffer,
} = providerStreamParsingPolicy

export const providerResponseParsingPolicy = createProviderResponseParsingPolicy({
  readResponseText: safeProviderResponseText,
  parseStreamChunk: parseProviderStreamChunk,
  extractTraces: extractTracesFromJson,
  splitTaggedThinkingOutputText,
  reasoningBehaviorDocumented(provider) {
    const evidence = getProviderCompatibilityEvidenceForProvider(provider)
    return providerCompatibilityEvidenceHasBehavior(evidence.id, 'reasoning')
  },
  reasoningExplicitlyDeclared(provider, model) {
    const modelConfig = getModelConfig(model, provider.type, provider.modelConfigs)
    return providerCompatibilityReasoningExplicitlyDeclaredForModel(provider, modelConfig)
  },
  citationsAllowed: (provider) => providerCompatibilityCapabilityCanBeSentForProvider(provider, 'citations'),
  isPerplexityProvider,
  reasoningSummaryTitle: () => st('providerTrace.reasoningSummary'),
})

export const {
  parseProviderBufferedStreamJson,
  parseProviderBufferedStreamResponse,
  parseProviderChatCompletionJson,
  parseProviderNonStreamingResponse,
  parseProviderNonStreamingText,
  providerReasoningResponseCanBeParsed,
  readProviderResponseBody,
  withProviderTextToolCallFallback,
} = providerResponseParsingPolicy

export const providerOperationResultPolicy = createProviderOperationResultPolicy({
  translate: st,
  redact: redactSensitiveText,
})
export const { extractProviderErrorDetail, formatProviderHttpError, providerFetchFailure } = providerOperationResultPolicy
export { PROVIDER_OPERATION_RESULT_SCHEMA, ProviderHttpError, classifyHttpStatus, failure, success } from '@/modules/providers'
