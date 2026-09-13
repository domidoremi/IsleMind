import { useEffect, useRef, useState } from 'react'
import type { ProviderModelAvailabilityPort, ProviderModelCurrent, ProviderModelHistoryCursor, ProviderModelHistoryFilter, ProviderModelHistoryPage } from '@/modules/providers'

/** Holds one SQL page, not an ever-growing history array. Late reads cannot replace new filters. */
export function useModelAvailabilityPage(availability: Pick<ProviderModelAvailabilityPort, 'queryHistory' | 'listCurrentModels'>,
  pageSize: number, filter: ProviderModelHistoryFilter, revision: number) {
  const [cursor, setCursor] = useState<ProviderModelHistoryCursor>()
  const [currentAfter, setCurrentAfter] = useState<{ scopeId: string; modelId: string }>()
  const [history, setHistory] = useState<ProviderModelHistoryPage>()
  const [current, setCurrent] = useState<readonly ProviderModelCurrent[]>([])
  const [latest, setLatest] = useState<ProviderModelHistoryPage['items'][number]>()
  const [latestFailure, setLatestFailure] = useState<ProviderModelHistoryPage['items'][number]>()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const identity = JSON.stringify(filter)
  const scope = `${identity}:${revision}`
  const previousScope = useRef(scope)
  useEffect(() => {
    let cancelled = false
    const changed = previousScope.current !== scope
    previousScope.current = scope
    if (changed) { setCursor(undefined); setCurrentAfter(undefined); setHistory(undefined); setCurrent([]); setLatest(undefined); setLatestFailure(undefined) }
    setLoading(true); setFailed(false)
    const activeCursor = changed ? undefined : cursor
    void Promise.all([
      availability.queryHistory({ filter, limit: pageSize, cursor: activeCursor }),
      availability.listCurrentModels({ providerId: filter.providerId, credentialSource: filter.credentialSource, modelId: filter.modelId,
        limit: pageSize, after: changed ? undefined : currentAfter }),
      !activeCursor ? availability.queryHistory({ filter: { ...filter, outcome: 'failure' }, limit: 1 }) : undefined,
    ]).then(([page, summaries, errors]) => {
      if (cancelled) return
      setHistory(page); setCurrent(summaries)
      if (!activeCursor) { setLatest(page.items[0]); setLatestFailure(errors?.items[0]) }
    }).catch(() => { if (!cancelled) { setFailed(true); setHistory(undefined); setCurrent([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [availability, scope, cursor, currentAfter, pageSize])
  return { history, current, latest, latestFailure, loading, failed,
    nextHistory: history?.nextCursor ? () => setCursor(history.nextCursor) : undefined,
    newest: () => { setCursor(undefined); setCurrentAfter(undefined) },
    nextCurrent: current.length === pageSize ? () => {
      const last = current[current.length - 1]
      setCurrentAfter({ scopeId: last.scopeId, modelId: last.modelId })
    } : undefined,
  }
}
