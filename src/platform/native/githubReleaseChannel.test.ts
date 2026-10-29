import {
  fetchGithubReleaseNotesSnapshot,
  fetchLatestGithubTagVersionSnapshot,
  fetchGithubApkTagVersionCandidates,
  type GithubTagVersionSnapshot,
} from './githubReleaseChannel'

const target: GithubTagVersionSnapshot = {
  tagName: 'v1.10.0', versionName: '1.10.0', versionCode: 130, name: 'IsleMind 1.10.0',
  htmlUrl: 'https://github.com/domidoremi/IsleMind/releases/tag/v1.10.0', publishedAt: null,
}
const historyUrl = (page: number) => `https://api.github.com/repos/domidoremi/IsleMind/releases?per_page=100&page=${page}`
const configUrl = (tag: string) => `https://raw.githubusercontent.com/domidoremi/IsleMind/${tag}/app.json`
const config = (version: string, versionCode = 129) => ({ expo: { version, android: { versionCode } } })
const sourceId = (tag: string) => `github:/domidoremi/IsleMind:tag:${tag}`
const release = (tag_name: string, body: string | null, extra: Record<string, unknown> = {}) => ({
  tag_name, body, draft: false, prerelease: false, published_at: '2026-10-27T00:00:00Z', assets: [], ...extra,
})

function response(body: unknown, status = 200): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (name: string) => name === 'content-length' ? String(new TextEncoder().encode(text).byteLength) : null },
    text: async () => text,
  } as Response
}

function fixtureFetch(fixtures: Record<string, unknown>) {
  return jest.fn(async (url: string | URL | Request) => {
    const key = String(url)
    if (!(key in fixtures)) throw new Error(`Unexpected URL: ${key}`)
    return response(fixtures[key])
  }) as jest.MockedFunction<typeof fetch>
}

afterEach(() => jest.useRealTimers())

it('discovers actual APK releases independently of newer source-only tags and publication order', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [
      release('v2.0.0', '- source only'),
      release('v1.10.0', '- uploaded', { assets: [{ name: 'app.apk', state: 'uploaded' }] }),
      release('v0.0.9', '- older tag, newer app', { assets: [{ name: 'app.apk', state: 'uploaded' }] }),
      release('v1.11.0', '- preview', { prerelease: true, assets: [{ name: 'app.apk' }] }),
      release('v1.12.0', '- still uploading', { assets: [{ name: 'app.apk', state: 'starter' }] }),
    ],
    [configUrl('v1.10.0')]: config('1.10.0', 130),
    [configUrl('v0.0.9')]: config('1.11.0', 131),
  })
  const candidates = await fetchGithubApkTagVersionCandidates({ fetchImplementation })
  expect(candidates.map(candidate => [candidate.tagName, candidate.versionName, candidate.versionCode])).toEqual([
    ['v0.0.9', '1.11.0', 131], ['v1.10.0', '1.10.0', 130],
  ])
  expect(fetchImplementation.mock.calls.map(([url]) => String(url))).not.toContain(configUrl('v2.0.0'))
})

it('every-release admits published previews but never drafts, unpublished or unsafe tag paths', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [
      release('v1.11.0-rc.1', '- Preview', { prerelease: true, published_at: '2026-10-28T00:00:00Z', assets: [{ name: 'app.apk' }] }),
      release('v1.12.0-beta.1', '- Draft', { draft: true, prerelease: true, published_at: '2026-10-28T00:00:00Z', assets: [{ name: 'app.apk' }] }),
      release('v1.13.0-rc.1', '- Unpublished', { prerelease: true, published_at: null, assets: [{ name: 'app.apk' }] }),
      release('../v1.14.0', '- Unsafe', { published_at: '2026-10-28T00:00:00Z', assets: [{ name: 'app.apk' }] }),
      release('v1.10.0', '- Stable', { published_at: '2026-10-28T00:00:00Z', assets: [{ name: 'app.apk' }] }),
    ],
    [configUrl('v1.11.0-rc.1')]: config('1.11.0', 131),
    [configUrl('v1.10.0')]: config('1.10.0', 130),
  })
  const candidates = await fetchGithubApkTagVersionCandidates({ channel: 'every-release', fetchImplementation })
  expect(candidates.map((candidate) => candidate.tagName)).toEqual(['v1.11.0-rc.1', 'v1.10.0'])
})

it('fails closed on an incomplete or malformed APK discovery catalog instead of claiming latest', async () => {
  const fetchImplementation = fixtureFetch({ [historyUrl(1)]: [release('v1.10.0', 'notes', { assets: 'invalid' })] })
  await expect(fetchGithubApkTagVersionCandidates({ fetchImplementation })).rejects.toThrow('assets must be an array')
  const oversized = jest.fn(async () => response(Array.from({ length: 101 }, () => release('v1', null))))
  await expect(fetchGithubApkTagVersionCandidates({ fetchImplementation: oversized })).rejects.toThrow('oversized')
  await expect(fetchGithubApkTagVersionCandidates({
    fetchImplementation: fixtureFetch({ [historyUrl(1)]: [null] }),
  })).rejects.toThrow('records must be objects')
})

it('bounds APK catalog pages and cancellation even when a transport ignores AbortSignal', async () => {
  const pages = jest.fn(async () => response(Array.from({ length: 100 }, () => release('v1', null))))
  await expect(fetchGithubApkTagVersionCandidates({ fetchImplementation: pages })).rejects.toThrow('bounded history window')
  expect(pages).toHaveBeenCalledTimes(10)
  const controller = new AbortController()
  const pending = fetchGithubApkTagVersionCandidates({
    fetchImplementation: jest.fn(() => new Promise<Response>(() => undefined)), signal: controller.signal,
  })
  controller.abort()
  await expect(pending).rejects.toThrow()
})

it('retains conflicting note snapshots under stable release identities and reuses tagged metadata', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [
      release(target.tagName, '- latest', { id: 30 }),
      release('v1.9.0', '- first', { id: 20 }),
      release('v1.9.0', '- revised', { id: 20 }),
      release('v1.9.0', '- first', { id: 20 }),
    ],
    [configUrl('v1.9.0')]: config('1.9.0', 129),
  })
  const result = await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })
  expect(result.complete).toBe(false)
  expect(result.entries.map(entry => entry.notes)).toEqual(['- first', '- revised', '- latest'])
  expect(result.entries[0].sourceId).toBe('github:/domidoremi/IsleMind:release:20')
  expect(fetchImplementation.mock.calls.filter(([url]) => String(url) === configUrl('v1.9.0'))).toHaveLength(1)
})

it('reports malformed historical records rather than silently claiming complete notes', async () => {
  const result = await fetchGithubReleaseNotesSnapshot('1.8.0', target, {
    fetchImplementation: fixtureFetch({ [historyUrl(1)]: [release(target.tagName, '- Target'), null, { body: '- No tag' }] }),
  })
  expect(result.complete).toBe(false)
  expect(result.entries.map(entry => entry.notes)).toEqual(['- Target'])
})

it('labels history by immutable app metadata and retains empty release records in the exact range', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [
      release(target.tagName, '- latest'),
      release('v0.0.9', '  - intermediate  '),
      release('v1.8.0', '- installed'),
      release('v1.7.0', '- older'),
      release('v1.11.0', '- future'),
      release('v1.9.1', null),
      release('v1.9.2', '  '),
      release('v2.0.0', '- draft', { draft: true }),
      release('v2.1.0', '- preview', { prerelease: true }),
      release('../../main', '- unsafe'),
    ],
    [configUrl('v0.0.9')]: config('1.9.0'),
    [configUrl('v1.8.0')]: config('1.8.0', 128),
    [configUrl('v1.7.0')]: config('1.7.0', 127),
    [configUrl('v1.11.0')]: config('1.11.0', 131),
    [configUrl('v1.9.1')]: config('1.9.1', 129),
    [configUrl('v1.9.2')]: config('1.9.2', 129),
  })
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })).toEqual({
    complete: true,
    entries: [
      { sourceId: sourceId('v0.0.9'), version: '1.9.0', versionCode: 129, notes: '- intermediate' },
      { sourceId: sourceId('v1.9.1'), version: '1.9.1', versionCode: 129, notes: '' },
      { sourceId: sourceId('v1.9.2'), version: '1.9.2', versionCode: 129, notes: '' },
      { sourceId: sourceId(target.tagName), version: '1.10.0', versionCode: 130, notes: '- latest' },
    ],
  })
  expect(fetchImplementation.mock.calls.map(([url]) => String(url))).toContain(configUrl('v1.9.1'))
  expect(fetchImplementation.mock.calls.map(([url]) => String(url))).not.toContain(configUrl(target.tagName))
})

it('reads subsequent history pages even when an earlier page contains the installed version', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [
      release('v1.8.0', '- installed'),
      ...Array.from({ length: 99 }, () => release('v0.0.1', null)),
    ],
    [historyUrl(2)]: [release(target.tagName, 'c'), release('v1.9.0', 'b')],
    [configUrl('v1.8.0')]: config('1.8.0', 128),
    [configUrl('v1.9.0')]: config('1.9.0', 129),
    [configUrl('v0.0.1')]: config('1.0.0', 1),
  })
  const result = await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })
  expect(result.complete).toBe(true)
  expect(result.entries.map((entry) => entry.notes)).toEqual(['b', 'c'])
  expect(fetchImplementation).toHaveBeenCalledWith(historyUrl(2), expect.anything())
})

it('recomputes the range after upgrading and deduplicates repeated tags', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [release(target.tagName, 'c'), release(target.tagName, 'c'), release('v1.9.0', 'b')],
    [configUrl('v1.9.0')]: config('1.9.0'),
  })
  expect((await fetchGithubReleaseNotesSnapshot('1.9.0', target, { fetchImplementation })).entries).toEqual([
    { sourceId: sourceId(target.tagName), version: '1.10.0', versionCode: 130, notes: 'c' },
  ])
  expect((await fetchGithubReleaseNotesSnapshot('1.10.0', target, { fetchImplementation })).entries).toEqual([])
})

it.each([403, 429, 503])('degrades optional history on HTTP %s without inventing notes', async status => {
  const fetchImplementation = jest.fn(async () => response('', status))
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })).toEqual({
    entries: [], complete: false,
  })
})

it('retains available notes when one historical metadata request fails', async () => {
  const fetchImplementation = fixtureFetch({
    [historyUrl(1)]: [release(target.tagName, 'c'), release('v1.9.0', 'b'), release('v1.9.1', '- unknown version')],
    [configUrl('v1.9.0')]: config('1.9.0'),
  })
  const result = await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })
  expect(result.complete).toBe(false)
  expect(result.entries.map(entry => entry.notes)).toEqual(['b', 'c'])
})

it.each(['not json', { unexpected: 'record' }])('rejects malformed history %j gracefully', async payload => {
  const fetchImplementation = fixtureFetch({ [historyUrl(1)]: payload })
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })).toEqual({
    entries: [], complete: false,
  })
})

it('bounds history page count and explicitly reports incomplete history', async () => {
  const fetchImplementation = jest.fn(async (url) => String(url).includes('/app.json')
    ? response(config('1.0.0', 1)) : response(Array.from({ length: 100 }, () => release('v1.0.0', null))))
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })).toEqual({
    entries: [], complete: false,
  })
  expect(fetchImplementation.mock.calls.filter(([url]) => String(url).includes('/releases?'))).toHaveLength(10)
})

it('does not parse or fetch metadata from a page exceeding the requested item bound', async () => {
  const fetchImplementation = jest.fn(async () => response(Array.from({ length: 101 }, () => release(target.tagName, 'c'))))
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })).toEqual({
    entries: [], complete: false,
  })
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

it('rejects an oversized declared history response before reading its body', async () => {
  const text = jest.fn(async () => '[]')
  const fetchImplementation = jest.fn(async () => ({
    ...response([]), headers: { get: () => String(4 * 1024 * 1024 + 1) }, text,
  }) as unknown as Response)
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })).toEqual({
    entries: [], complete: false,
  })
  expect(text).not.toHaveBeenCalled()
})

it('bounds parallel historical metadata requests and sorts notes independently of completion order', async () => {
  let active = 0
  let maxActive = 0
  const waiting: Array<() => void> = []
  const fetchImplementation = jest.fn(async (url: string | URL | Request) => {
    if (String(url) === historyUrl(1)) return response(Array.from({ length: 8 }, (_, index) => release(`v1.9.${index}`, `note ${index}`)))
    const version = String(url).match(/\/v(1\.9\.\d)\/app\.json$/)![1]
    active += 1
    maxActive = Math.max(maxActive, active)
    return new Promise<Response>(resolve => {
      waiting.push(() => { active -= 1; resolve(response(config(version))) })
    })
  })
  const pending = fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation })
  for (let wave = 0; wave < 3; wave += 1) {
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve()
    waiting.splice(0).reverse().forEach(finish => finish())
  }
  const result = await pending
  expect(maxActive).toBe(4)
  expect(active).toBe(0)
  expect(result.complete).toBe(true)
  expect(result.entries.map(entry => entry.notes)).toEqual(Array.from({ length: 8 }, (_, index) => `note ${index}`))
})

it('does not fetch for an already cancelled history request', async () => {
  const controller = new AbortController()
  controller.abort()
  const fetchImplementation = jest.fn()
  expect(await fetchGithubReleaseNotesSnapshot('1.8.0', target, {
    fetchImplementation, signal: controller.signal,
  })).toEqual({ entries: [], complete: false })
  expect(fetchImplementation).not.toHaveBeenCalled()
})

it('settles cancellation even if a fetch implementation ignores AbortSignal', async () => {
  const controller = new AbortController()
  const fetchImplementation = jest.fn(() => new Promise<Response>(() => undefined))
  const pending = fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation, signal: controller.signal })
  controller.abort()
  expect(await pending).toEqual({ entries: [], complete: false })
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
})

it('bounds a stalled response body, not only response headers', async () => {
  jest.useFakeTimers()
  const fetchImplementation = jest.fn(async () => ({
    ...response([]), text: () => new Promise<string>(() => undefined),
  }) as Response)
  const pending = fetchGithubReleaseNotesSnapshot('1.8.0', target, { fetchImplementation, timeoutMs: 20 })
  await jest.advanceTimersByTimeAsync(20)
  expect(await pending).toEqual({ entries: [], complete: false })
  expect(jest.getTimerCount()).toBe(0)
})

it('keeps numeric stable-tag selection for multi-digit versions', async () => {
  const fetchImplementation = fixtureFetch({
    'https://github.com/domidoremi/IsleMind/tags.atom': `<feed>
      <entry><title>v1.9.0</title></entry><entry><title>v1.10.0</title></entry>
    </feed>`,
    [configUrl(target.tagName)]: config(target.versionName, target.versionCode),
  })
  expect(await fetchLatestGithubTagVersionSnapshot({ fetchImplementation })).toMatchObject({
    tagName: target.tagName, versionName: '1.10.0',
  })
})
