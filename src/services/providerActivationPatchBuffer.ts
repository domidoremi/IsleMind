import type { AIProvider } from '@/types'
import { updateCredentialGroupHealth as applyCredentialGroupHealth } from '@/services/ai/providerCredentials'

export interface ProviderActivationPatch {
  id: string
  updates: Partial<AIProvider>
}

export interface ProviderActivationPatchBufferOptions {
  flushPatches: (patches: ProviderActivationPatch[]) => Promise<void>
  hydrateProviderKey: (id: string) => Promise<AIProvider | null>
  flushLimit: number
  flushMs: number
}

export function createProviderActivationPatchBuffer(options: ProviderActivationPatchBufferOptions) {
  const pending = new Map<string, Partial<AIProvider>>()
  const overlay = new Map<string, Partial<AIProvider>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let flushChain = Promise.resolve()

  const apply = (id: string, provider: AIProvider | null): AIProvider | null => {
    const updates = overlay.get(id)
    return provider && updates ? { ...provider, ...updates } as AIProvider : provider
  }

  const flush = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending.size) return flushChain
    const patches = Array.from(pending, ([id, updates]) => ({ id, updates }))
    pending.clear()
    flushChain = flushChain.then(() => options.flushPatches(patches))
    return flushChain
  }

  const scheduleFlush = () => {
    if (timer) return
    timer = setTimeout(() => {
      void flush()
    }, options.flushMs)
  }

  const enqueue = async (id: string, updates: Partial<AIProvider>) => {
    pending.set(id, { ...(pending.get(id) ?? {}), ...updates })
    overlay.set(id, { ...(overlay.get(id) ?? {}), ...updates })
    if (pending.size >= options.flushLimit) {
      await flush()
      return
    }
    scheduleFlush()
  }

  return {
    enqueue,
    enqueueCredentialGroupHealth: async (id: string, groupId: string | undefined, ok: boolean) => {
      if (!groupId) return
      const provider = apply(id, await options.hydrateProviderKey(id))
      if (!provider?.credentialGroups?.some((group) => group.id === groupId)) return
      const updated = applyCredentialGroupHealth(provider, groupId, ok)
      await enqueue(id, { credentialGroups: updated.credentialGroups })
    },
    apply,
    flush,
  }
}
