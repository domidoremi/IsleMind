import { useEffect, useMemo, useState } from 'react'
import type { AIProvider } from '@/types/providerContracts'
import { queryProviderUsage } from '@/bootstrap/providerUsageRuntime'
import { providerUsageQueryConfigurationFingerprint, type ProviderUsageQueryResult } from '@/modules/providers'

export type ProviderUsageSnapshotStatus = 'loading' | 'ready' | 'unavailable' | 'error'

export interface ProviderUsageSnapshot {
  status: ProviderUsageSnapshotStatus
  result?: ProviderUsageQueryResult
  updatedAt?: number
}

export type ProviderUsageSnapshotMap = ReadonlyMap<string, ProviderUsageSnapshot>

const USAGE_QUERY_CONCURRENCY = 3

/** Loads provider quota snapshots for the settings list with bounded concurrency. */
export function useProviderUsageSnapshots(providers: readonly AIProvider[]): ProviderUsageSnapshotMap {
  const [snapshots, setSnapshots] = useState<Map<string, ProviderUsageSnapshot>>(() => new Map())
  const providerSignature = useMemo(
    () => providers.map((provider) => {
      const groups = (provider.credentialGroups ?? []).map((group) => `${group.id}:${group.enabled ? '1' : '0'}`).join(',')
      return `${provider.id}:${provider.enabled ? '1' : '0'}:${provider.baseUrl?.trim() ?? ''}:${provider.apiKey?.trim().length ?? 0}:${groups}:${providerUsageQueryConfigurationFingerprint(provider.usageQueryConfiguration)}`
    }).join('|'),
    [providers],
  )

  useEffect(() => {
    const targets = providers.filter((provider) => provider.enabled && provider.baseUrl?.trim())
    const targetIds = new Set(targets.map((provider) => provider.id))
    const controller = new AbortController()
    let cancelled = false

    setSnapshots((current) => {
      const next = new Map<string, ProviderUsageSnapshot>()
      for (const [providerId, snapshot] of current) {
        if (targetIds.has(providerId)) next.set(providerId, snapshot)
      }
      for (const provider of targets) {
        next.set(provider.id, { status: 'loading' })
      }
      return next
    })

    let cursor = 0
    const worker = async () => {
      while (!cancelled) {
        const provider = targets[cursor]
        cursor += 1
        if (!provider) return
        try {
          const result = await queryProviderUsage(provider, { signal: controller.signal })
          if (cancelled) return
          setSnapshots((current) => {
            const next = new Map(current)
            next.set(provider.id, {
              status: result ? 'ready' : 'unavailable',
              ...(result ? { result } : {}),
              updatedAt: Date.now(),
            })
            return next
          })
        } catch {
          if (cancelled) return
          setSnapshots((current) => {
            const next = new Map(current)
            next.set(provider.id, { status: 'error', updatedAt: Date.now() })
            return next
          })
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(USAGE_QUERY_CONCURRENCY, targets.length) }, () => worker()))
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [providerSignature])

  return snapshots
}
