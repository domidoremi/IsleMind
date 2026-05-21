import type { RetrievalSource, SearchProviderId } from '@/types'
import { useSettingsStore } from '@/store/settingsStore'
import { getBingCompatibleEndpoint, resolveSearchProvider } from '@/services/searchPolicy'
import { st } from '@/i18n/service'

export interface SearchAdapterResult {
  sources: RetrievalSource[]
  mode: SearchProviderId
  message: string
}

export async function searchExternalWeb(query: string, limit = 5): Promise<SearchAdapterResult> {
  const settings = useSettingsStore.getState().settings
  const mode = resolveSearchProvider(settings)
  if (!settings.webSearchEnabled || mode === 'off' || mode === 'native') {
    return { sources: [], mode, message: mode === 'native' ? st('search.nativeMode') : st('search.disabled') }
  }
  if (!query.trim()) return { sources: [], mode, message: st('search.emptyQuery') }

  switch (mode) {
    case 'tavily':
      return { sources: await searchTavily(query, limit), mode, message: st('search.tavilyDone') }
    case 'google':
      return { sources: await searchGoogle(query, limit), mode, message: st('search.googleDone') }
    case 'bing':
      return { sources: await searchBingCompatible(query, limit), mode, message: st('search.bingDone') }
    case 'custom':
      return { sources: await searchCustomJson(query, limit), mode, message: st('search.customDone') }
  }
}

export async function searchWeb(query: string, limit = 5): Promise<RetrievalSource[]> {
  return (await searchExternalWeb(query, limit)).sources
}

async function searchTavily(query: string, limit: number): Promise<RetrievalSource[]> {
  const apiKey = await useSettingsStore.getState().getTavilyApiKey()
  if (!apiKey) return []
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: 'basic',
      include_answer: true,
      include_raw_content: false,
    }),
  })
  if (!response.ok) throw new Error(st('search.tavilyFailedStatus', { status: response.status }))
  const data = await response.json()
  return normalizeWebResults(Array.isArray(data.results) ? data.results : [], limit, 'tavily')
}

async function searchGoogle(query: string, limit: number): Promise<RetrievalSource[]> {
  const apiKey = await useSettingsStore.getState().getGoogleSearchApiKey()
  const cx = useSettingsStore.getState().settings.googleSearchCx?.trim()
  if (!apiKey || !cx) return []
  const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=${Math.min(10, limit)}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(st('search.googleFailedStatus', { status: response.status }))
  const data = await response.json()
  const items = Array.isArray(data.items) ? data.items.map((item: any) => ({
    title: item.title,
    url: item.link,
    content: item.snippet,
    score: undefined,
  })) : []
  return normalizeWebResults(items, limit, 'google')
}

async function searchBingCompatible(query: string, limit: number): Promise<RetrievalSource[]> {
  const apiKey = await useSettingsStore.getState().getBingSearchApiKey()
  const endpoint = getBingCompatibleEndpoint(useSettingsStore.getState().settings)
  if (!endpoint) throw new Error(st('search.bingEndpointRequired'))
  if (!apiKey) return []
  const response = await fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}&count=${Math.min(10, limit)}`, {
    headers: { 'Ocp-Apim-Subscription-Key': apiKey },
  })
  if (!response.ok) throw new Error(st('search.bingFailedStatus', { status: response.status }))
  const data = await response.json()
  const items = Array.isArray(data.webPages?.value) ? data.webPages.value.map((item: any) => ({
    title: item.name,
    url: item.url,
    content: item.snippet,
  })) : []
  return normalizeWebResults(items, limit, 'bing')
}

async function searchCustomJson(query: string, limit: number): Promise<RetrievalSource[]> {
  const apiKey = await useSettingsStore.getState().getCustomSearchApiKey()
  const endpoint = useSettingsStore.getState().settings.customSearchEndpoint?.trim()
  if (!endpoint) return []
  const url = endpoint
    .replace(/\{query\}/g, encodeURIComponent(query))
    .replace(/\{limit\}/g, String(limit))
  const response = await fetch(url, apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined)
  if (!response.ok) throw new Error(st('search.customFailedStatus', { status: response.status }))
  const data = await response.json()
  const items = Array.isArray(data.results) ? data.results : Array.isArray(data.items) ? data.items : []
  return normalizeWebResults(items, limit, 'custom')
}

function normalizeWebResults(items: any[], limit: number, prefix: string): RetrievalSource[] {
  return items.slice(0, limit).map((item, index) => ({
    id: item.url || item.link || `${prefix}-${Date.now()}-${index}`,
    type: 'web',
    title: item.title || item.name || item.url || st('search.webSource'),
    content: item.content || item.snippet || item.description || '',
    excerpt: item.content || item.snippet || item.description || '',
    url: item.url || item.link,
    score: typeof item.score === 'number' ? item.score : undefined,
  }))
}
