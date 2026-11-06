/** SQL rendering fixture for the isolated qualification APK, outside production routes. */
import { useEffect, useMemo } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import type { ProviderModelAvailabilityPort } from '../src/modules/providers'
import { useNativeModelEvidencePage } from './useNativeModelEvidencePage'

const trace = globalThis as typeof globalThis & {
  __stage9PagePhase?: (name: string, detail?: Record<string, unknown>) => void
  __stage9PageCommitted?: (detail: { count: number; current: number; failed: boolean }) => Promise<void>
}

export function NativeModelEvidenceScreen({ availability, pageSize, initialProviderId = '' }: {
  availability: Pick<ProviderModelAvailabilityPort, 'listCurrentModels' | 'queryHistory'>
  pageSize: number
  initialProviderId?: string
}) {
  trace.__stage9PagePhase?.('render-start')
  const filter = useMemo(() => initialProviderId ? { providerId: initialProviderId } : {}, [initialProviderId])
  const page = useNativeModelEvidencePage(availability, pageSize, filter, 0)
  useEffect(() => {
    if (!page.loading) void trace.__stage9PageCommitted?.({
      count: page.history?.items.length ?? 0, current: page.current.length, failed: page.failed,
    })
  }, [page.loading, page.history, page.current, page.failed])
  const rows = [
    ...page.current.map(row => ({
      id: JSON.stringify(['current', row.scopeId, row.modelId]),
      title: row.modelId, detail: `Current · ${row.availability}`,
    })),
    ...(page.history?.items ?? []).map(row => ({
      id: JSON.stringify(['history', row.id]),
      title: row.modelId ?? row.providerId, detail: `${row.source} · ${row.classification}`,
    })),
  ]
  trace.__stage9PagePhase?.('render-elements', { loading: page.loading, rows: rows.length })
  return <FlatList data={rows} keyExtractor={row => row.id} style={{ flex: 1 }}
    initialNumToRender={8} maxToRenderPerBatch={8}
    ListHeaderComponent={<View style={{ padding: 12, gap: 8 }}>
      <Text style={{ color: '#111827', fontWeight: '700' }}>Isolated model evidence inspector</Text>
      <Text style={{ color: '#475569' }}>{page.loading ? 'Loading' : page.failed ? 'Read failed' : `${rows.length} bounded rows`}</Text>
    </View>}
    renderItem={({ item }) => <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
      <Text style={{ color: '#111827' }}>{item.title}</Text>
      <Text style={{ color: '#475569' }}>{item.detail}</Text>
    </View>}
    ListFooterComponent={<View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 12 }}>
      {[['Newest', page.newest], ['Older history', page.nextHistory], ['Next current', page.nextCurrent]].map(([label, action]) =>
        <Pressable key={label as string} accessibilityRole="button" disabled={!action || page.loading}
          onPress={action as (() => void) | undefined} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: '#334155' }}>{label as string}</Text>
        </Pressable>)}
    </View>} />
}
