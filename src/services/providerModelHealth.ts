import { testProviderModelDetailed, type ProviderOperationResult } from '@/services/ai/base'
import type { AIProvider } from '@/types'

export interface ProviderModelHealthDeps {
  updateProvider: (id: string, updates: Partial<AIProvider>) => Promise<void>
  updateProviderCredentialGroupHealth: (providerId: string, groupId: string | undefined, ok: boolean) => Promise<void>
}

export interface ProviderModelHealthOptions {
  checkParameters?: boolean
  recordLastTestModel?: boolean
}

export async function testProviderModelHealth(
  provider: AIProvider,
  model: string,
  apiKey: string,
  deps: ProviderModelHealthDeps,
  options: ProviderModelHealthOptions = {},
): Promise<ProviderOperationResult> {
  const result = await testProviderModelDetailed(provider, model, apiKey, { checkParameters: options.checkParameters })
  await deps.updateProviderCredentialGroupHealth(provider.id, result.credentialGroupId, result.ok)
  await deps.updateProvider(provider.id, {
    lastTestStatus: result.ok ? 'ok' : 'bad',
    lastTestedAt: Date.now(),
    ...(options.recordLastTestModel ? { lastTestModel: model } : {}),
    lastTestMessage: result.message,
    lastTestCode: result.code,
  })
  return result
}
