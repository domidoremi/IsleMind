import { estimateTextTokens } from '@/core'
import { createDocumentRevisionService, DocumentRevisionError, sameDocumentRevisionTarget, type DocumentRevisionTarget } from '@/modules/documents'
import type { ProviderRuntimeCompletionResult } from '@/modules/providers'
import type { AIProvider } from '@/types/providerContracts'
import type { Settings } from '@/types/settingsContracts'
import { getProviderEffectiveBaseUrl } from '@/types/providerBaseUrls'
import { getModelConfig } from '@/types/modelCatalog'
import { useChatStore } from '@/store/chatStore'
import { useSettingsStore } from '@/store/settingsStore'
import { resolveProviderModelAlias } from '@/utils/providerModels'
import { safeHttpUrl } from '@/utils/sourceUrlSafety'
import { getPolicyAllowedProviderModels } from './providerModelAccess'
import { knowledgeRepository } from './knowledgeRepository'
import { streamProviderChat } from './providerRuntime'

function targetsFor(providers: readonly AIProvider[], settings: Settings): DocumentRevisionTarget[] {
  const proxy = settings.proxyMode === 'custom-base-url' ? safeHttpUrl(settings.proxyBaseUrl)
    : settings.proxyMode === 'system-detected' ? 'system' : undefined
  if (settings.proxyMode === 'custom-base-url' && !proxy) return []
  return providers.filter((provider) => provider.enabled).flatMap((provider) => {
    const destination = safeHttpUrl(getProviderEffectiveBaseUrl(provider))
    if (!destination) return []
    return getPolicyAllowedProviderModels(provider, settings, { limit: 100 }).map((model) => ({
      providerId: provider.id, providerName: provider.name, model,
      upstreamModel: resolveProviderModelAlias(provider, model), destination, ...(proxy ? { proxy } : {}),
    }))
  })
}

function listTargets() {
  const { providers, settings } = useSettingsStore.getState()
  return targetsFor(providers, settings)
}

export const documentRevision = createDocumentRevisionService({
  getConversation: (id) => useChatStore.getState().conversations.find((item) => item.id === id),
  ensureConversation: async (id, signal) => {
    if (!signal.aborted && !useChatStore.getState().conversations.some((item) => item.id === id)) await useChatStore.getState().loadAll()
  },
  readLocalSource: (reference, options) => knowledgeRepository.readLocalSource(reference, options),
  listTargets,
  async generate({ target, systemPrompt, userPrompt, signal }) {
    const provider = await useSettingsStore.getState().hydrateProviderKey(target.providerId)
    const settings = useSettingsStore.getState().settings
    if (signal.aborted) throw cancelled()
    if (!provider || !listTargets().some((item) => sameDocumentRevisionTarget(item, target))
      || !targetsFor([provider], settings).some((item) => sameDocumentRevisionTarget(item, target))) throw new DocumentRevisionError('targetChanged')
    const model = getModelConfig(target.upstreamModel, provider.type, provider.modelConfigs)
    const maxTokens = Math.min(4096, model.maxOutputTokens)
    // Existing estimator is admission guidance, not a native tokenizer guarantee.
    // Never silently truncate the user's draft or chosen source text to make it fit.
    if (estimateTextTokens(systemPrompt) + estimateTextTokens(userPrompt) + maxTokens + 128 > model.contextWindow) throw new DocumentRevisionError('inputTooLong')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 120_000)
    try {
      let completed: ProviderRuntimeCompletionResult | undefined
      let failure: Error | undefined
      const handle = await streamProviderChat({
        provider, model: target.model, systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens, temperature: 0.2, generationParameterSources: { temperature: 'internal-policy', maxTokens: 'internal-policy' },
        stream: false, signal: controller.signal, webSearchMode: 'off', allowFallback: false,
        remoteCompactEligible: false, usageContext: { source: 'other' },
        settings: { ...settings, remoteCompactMode: 'off', upstreamMaxRetries: 0 },
      }, () => undefined, (result) => { completed = result }, (error) => { failure = error })
      await handle.done
      if (signal.aborted) throw cancelled()
      if (controller.signal.aborted || failure || !completed || completed.providerToolCalls?.length) throw new DocumentRevisionError('generationFailed')
      return completed.text
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  },
})

function cancelled() { const error = new Error('Document revision cancelled'); error.name = 'AbortError'; return error }
