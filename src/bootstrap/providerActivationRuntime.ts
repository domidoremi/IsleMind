import { st } from '@/i18n/service'
import {
  createProviderActivation,
  createProviderModelHealth,
  type ProviderActivationAccessSettings,
  type ProviderActivationOptions,
  type ProviderActivationPorts,
  type ProviderActivationResult,
  type ProviderActivationSummary,
  type ProviderActivationTestCandidate,
  type ProviderModelHealthOptions,
  type ProviderModelHealthPorts,
  type ProviderModelTestEvidenceResult,
  type ProviderOperationResult,
} from '@/modules/providers'
import { resolveProviderModelAliasAccess } from '@/bootstrap/providerModelAccess'
import type { AIProvider } from '@/types/providerContracts'
import {
  getProviderAvailableModels,
  getProviderManualModels,
  getProviderPreferredModel,
  isProviderChatCompatibleModel,
} from '@/utils/providerModels'
import {
  synchronizeProviderCredentials,
  testProviderModelRuntime,
} from './providerRuntime'

export type ProviderActivationDeps = ProviderActivationPorts
export type ProviderModelHealthDeps = ProviderModelHealthPorts

const providerActivation = createProviderActivation({
  translate: st,
  synchronizeProviderCredentials,
  testProviderModel: testProviderModelRuntime,
  getAvailableModels: getProviderAvailableModels,
  getManualModels: getProviderManualModels,
  getPreferredModel: getProviderPreferredModel,
  isChatCompatibleModel: isProviderChatCompatibleModel,
  isModelAllowed(provider, model, settings) {
    return resolveProviderModelAliasAccess({ provider, model, settings }).allowed
  },
})

const providerModelHealth = createProviderModelHealth({
  testProviderModel: testProviderModelRuntime,
})

export async function activateProviderWithHealthCheck(
  provider: AIProvider,
  deps: ProviderActivationDeps,
  options: Omit<ProviderActivationOptions, 'enable' | 'testModels'> = {},
): Promise<ProviderActivationResult> {
  return providerActivation.activateProviderWithHealthCheck(provider, deps, options)
}

export async function syncAndTestProvider(
  provider: AIProvider,
  deps: ProviderActivationDeps,
  options: ProviderActivationOptions = {},
): Promise<ProviderActivationResult> {
  return providerActivation.syncAndTestProvider(provider, deps, options)
}

export function buildProviderActivationTestCandidatesForTest(
  provider: AIProvider,
  requestedModel?: string,
  settings?: ProviderActivationAccessSettings,
): ProviderActivationTestCandidate[] {
  return providerActivation.buildTestCandidates(provider, requestedModel, settings)
}

export function summarizeProviderActivation(
  results: ProviderActivationResult[],
): ProviderActivationSummary {
  return providerActivation.summarize(results)
}

export async function testProviderModelHealth(
  provider: AIProvider,
  model: string,
  apiKey: string,
  deps: ProviderModelHealthDeps,
  options: ProviderModelHealthOptions = {},
): Promise<ProviderOperationResult<ProviderModelTestEvidenceResult>> {
  return providerModelHealth.test(provider, model, apiKey, deps, options)
}

export { isProviderActivationReady } from '@/modules/providers'
export type {
  ProviderActivationAccessSettings,
  ProviderActivationFailure,
  ProviderActivationOptions,
  ProviderActivationResult,
  ProviderActivationStageEvent,
  ProviderActivationSummary,
  ProviderActivationTestCandidate,
  ProviderModelHealthOptions,
} from '@/modules/providers'
