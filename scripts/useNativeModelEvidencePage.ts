import { useEffect, useRef, useState } from 'react'
import type { ProviderModelAvailabilityPort, ProviderModelCurrent, ProviderModelHistoryCursor, ProviderModelHistoryFilter, ProviderModelHistoryPage } from '../src/modules/providers'

const trace = globalThis as typeof globalThis & {
  __stage9PagePhase?: (name: string) => void
}

type ReadScope = { key: string; availability: object }
type ReadState = {
  scope: ReadScope
  history?: ProviderModelHistoryPage
  current: readonly ProviderModelCurrent[]
  latest?: ProviderModelHistoryPage['items'][number]
  latestFailure?: ProviderModelHistoryPage['items'][number]
  loading: boolean
  failed: boolean
}
type Pagination = {
  scope: ReadScope
  cursor?: ProviderModelHistoryCursor
  currentAfter?: { scopeId: string; modelId: string }
  revision: number
}

/** Qualification-only SQL page; never loaded by the production app. */
export function useNativeModelEvidencePage(availability: Pick<ProviderModelAvailabilityPort, 'queryHistory' | 'listCurrentModels'>,
  pageSize: number, filter: ProviderModelHistoryFilter, revision: number) {
  const key = JSON.stringify([filter, revision, pageSize])
  const scopeRef = useRef<ReadScope>({ key, availability })
  if (scopeRef.current.key !== key || scopeRef.current.availability !== availability) {
    scopeRef.current = { key, availability }
  }
  const scope = scopeRef.current
  const [pagination, setPagination] = useState<Pagination>({ scope, revision: 0 })
  const cursor = pagination.scope === scope ? pagination.cursor : undefined
  const currentAfter = pagination.scope === scope ? pagination.currentAfter : undefined
  const pageRevision = pagination.scope === scope ? pagination.revision : 0
  const readRef = useRef({ scope, cursor, currentAfter, pageRevision })
  if (readRef.current.scope !== scope || readRef.current.cursor !== cursor ||
    readRef.current.currentAfter !== currentAfter || readRef.current.pageRevision !== pageRevision) {
    readRef.current = { scope, cursor, currentAfter, pageRevision }
  }
  const read = readRef.current
  const [state, setState] = useState<ReadState>({ scope, current: [], loading: true, failed: false })
  const mounted = useRef(true)
  const pending = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    trace.__stage9PagePhase?.('data-effect')
    let cancelled = false
    pending.current = true
    // Preserve the initial pending render, but never show a replacement scope's old data.
    setState(previous => previous.scope === scope && previous.loading && !previous.failed ? previous
      : { ...(previous.scope === scope ? previous : { scope, current: [] }), loading: true, failed: false })
    void (async () => {
      try {
        const [page, summaries, errors] = await Promise.all([
          availability.queryHistory({ filter, limit: pageSize, cursor }),
          availability.listCurrentModels({ providerId: filter.providerId, credentialSource: filter.credentialSource, modelId: filter.modelId,
            limit: pageSize, after: currentAfter }),
          !cursor ? availability.queryHistory({ filter: { ...filter, outcome: 'failure' }, limit: 1 }) : undefined,
        ])
        trace.__stage9PagePhase?.('data-ready')
        if (cancelled || readRef.current !== read) return
        setState(previous => ({ scope, history: page, current: summaries, loading: false, failed: false,
          latest: !cursor ? page.items[0] : previous.latest,
          latestFailure: !cursor ? errors?.items[0] : previous.latestFailure }))
      } catch {
        if (!cancelled && readRef.current === read) setState({ scope, current: [], loading: false, failed: true })
      } finally {
        if (!cancelled && readRef.current === read) pending.current = false
      }
    })()
    return () => { cancelled = true }
  }, [read])
  const displayed = state.scope === scope ? state : { scope, current: [], loading: true, failed: false }
  const { history, current, latest, latestFailure, loading, failed } = displayed
  const admitPagination = () => {
    if (!mounted.current || readRef.current !== read || loading || pending.current) return false
    pending.current = true
    return true
  }
  return { history, current, latest, latestFailure, loading, failed,
    nextHistory: !loading && !failed && history?.nextCursor ? () => {
      if (admitPagination()) setPagination({ scope, cursor: history.nextCursor, currentAfter, revision: pageRevision + 1 })
    } : undefined,
    newest: () => {
      if (admitPagination()) setPagination({ scope, revision: pageRevision + 1 })
    },
    nextCurrent: !loading && !failed && current.length === pageSize ? () => {
      if (!admitPagination()) return
      const last = current[current.length - 1]
      setPagination({ scope, cursor, currentAfter: { scopeId: last.scopeId, modelId: last.modelId }, revision: pageRevision + 1 })
    } : undefined,
  }
}
