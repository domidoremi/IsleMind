import { createProviderRequestShapePolicy } from './providerRequestShapePolicy'
import { createProviderProtocolAdapterPolicy } from './providerProtocolAdapter'
import type { AIProvider } from '@/types/providerContracts'

const provider: AIProvider = {
  id: 'sambanova', presetId: 'sambanova', name: 'SambaNova', type: 'openai-compatible',
  enabled: true, apiKey: '', models: ['gpt-oss-120b'],
  capabilities: { chat: true, streaming: true, modelList: true, vision: false, files: false,
    audioInput: false, audioTranscription: false, speech: false, nativeSearch: false,
    reasoningEffort: false, topP: true, responsesApi: true },
}

function policy(responses: boolean) {
  const adapters = createProviderProtocolAdapterPolicy({ usesOpenAIResponses: () => responses })
  return createProviderRequestShapePolicy({
    compatibilityCapabilityCanBeSent: () => true,
    compatibilityCapabilityStatus: () => 'supported',
    usesProtocolReferenceEvidence: () => false,
    modelCapabilityCanBeSent: () => true,
    resolveProtocolAdapter: request => adapters.resolve({ provider: request.provider, model: request.model }),
  })
}

it('uses the selected Chat adapter, not the Responses capability flag, for schema controls', () => {
  const request = { provider, model: 'gpt-oss-120b', structuredOutput: { type: 'json_schema' as const,
    schema: { type: 'object', properties: { answer: { type: 'string' } } } } }
  expect(policy(false).resolveStructuredOutputRequestPolicy(request)).toMatchObject({
    capabilityAllowed: true, appRequestControl: true, documentedRequestShape: 'openai-response-format',
  })
  expect(policy(false).resolveCapabilityManifest({ ...request, provider: {
    ...provider, capabilities: { ...provider.capabilities!, responsesApi: false },
  } })).toEqual(policy(false).resolveCapabilityManifest(request))
})

it('does not claim a Chat-only supplier control after a real Responses adapter selection', () => {
  expect(policy(true).resolveCapabilityManifest({ provider, model: 'gpt-oss-120b' }).structuredOutput.appRequestControl).toBe(false)
})
