import { XMLParser } from 'fast-xml-parser'

export type GithubReleaseChannelFailureReason = 'network' | 'rate_limited' | 'manifest_invalid'

export interface GithubTagVersionSnapshot {
  tagName: string
  versionName: string
  versionCode: number
  name: string
  htmlUrl: string
  publishedAt: string | null
}

export interface GithubReleaseAssetSnapshot {
  name: string
  url: string
}

export interface GithubTaggedAndroidReleaseSnapshot {
  tag: GithubTagVersionSnapshot
  manifest: unknown
  assets: GithubReleaseAssetSnapshot[]
}

export interface GithubReleaseChannelRequestOptions {
  fetchImplementation?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}

export const GITHUB_TAGS_ATOM_URL = 'https://github.com/domidoremi/IsleMind/tags.atom'
export const GITHUB_RELEASE_REQUEST_TIMEOUT_MS = 10_000

const GITHUB_ORIGIN = 'https://github.com'
const RAW_GITHUB_ORIGIN = 'https://raw.githubusercontent.com'
const REPOSITORY_PATH = '/domidoremi/IsleMind'
const ATOM_RESPONSE_LIMIT_BYTES = 512 * 1024
const APP_CONFIG_RESPONSE_LIMIT_BYTES = 128 * 1024
const UPDATE_MANIFEST_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024
const RELEASE_ASSETS_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024

const atomParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
})

const githubHtmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  processEntities: false,
  trimValues: true,
  unpairedTags: [
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
    'param', 'source', 'track', 'wbr',
  ],
})

export class GithubReleaseChannelError extends Error {
  constructor(readonly reason: GithubReleaseChannelFailureReason, message: string) {
    super(message)
    this.name = 'GithubReleaseChannelError'
  }
}

export async function fetchLatestGithubTagVersionSnapshot(
  options: GithubReleaseChannelRequestOptions = {},
): Promise<GithubTagVersionSnapshot> {
  const atomText = await requestBoundedText(
    GITHUB_TAGS_ATOM_URL,
    'application/atom+xml, application/xml;q=0.9, text/xml;q=0.8',
    ATOM_RESPONSE_LIMIT_BYTES,
    options,
  )
  const entry = selectLatestStableTagEntry(parseAtomEntries(atomText))
  const appConfigUrl = `${RAW_GITHUB_ORIGIN}${REPOSITORY_PATH}/${entry.tagName}/app.json`
  const appConfig = await requestBoundedJson(
    appConfigUrl,
    APP_CONFIG_RESPONSE_LIMIT_BYTES,
    options,
  )
  const version = parseTaggedAppVersion(appConfig)

  return {
    tagName: entry.tagName,
    versionName: version.versionName,
    versionCode: version.versionCode,
    name: `IsleMind ${version.versionName}`,
    htmlUrl: `${GITHUB_ORIGIN}${REPOSITORY_PATH}/releases/tag/${entry.tagName}`,
    publishedAt: entry.updatedAt,
  }
}

export async function fetchGithubTaggedAndroidReleaseSnapshot(
  tag: GithubTagVersionSnapshot,
  options: GithubReleaseChannelRequestOptions = {},
): Promise<GithubTaggedAndroidReleaseSnapshot> {
  assertStableTagName(tag.tagName)
  const manifestUrl = `${RAW_GITHUB_ORIGIN}${REPOSITORY_PATH}/${tag.tagName}/updates/android.json`
  const assetsUrl = `${GITHUB_ORIGIN}${REPOSITORY_PATH}/releases/expanded_assets/${tag.tagName}`
  const assetsHtml = await requestBoundedText(
    assetsUrl,
    'text/html, application/xhtml+xml;q=0.9',
    RELEASE_ASSETS_RESPONSE_LIMIT_BYTES,
    options,
  )
  const assets = parseReleaseAssetLinks(assetsHtml, tag.tagName)
  if (!assets.length) {
    return { tag, manifest: null, assets }
  }

  const manifest = await requestBoundedJson(manifestUrl, UPDATE_MANIFEST_RESPONSE_LIMIT_BYTES, options)

  return {
    tag,
    manifest,
    assets,
  }
}

interface StableTagEntry {
  tagName: string
  version: readonly [number, number, number]
  updatedAt: string | null
}

function parseAtomEntries(atomText: string): StableTagEntry[] {
  let payload: unknown
  try {
    payload = atomParser.parse(atomText)
  } catch (error) {
    throw invalidChannelPayload(`GitHub tags feed is invalid XML: ${formatError(error)}`)
  }

  const root = isRecord(payload) ? payload : null
  const feed = root && isRecord(root.feed) ? root.feed : null
  const rawEntryValue = feed?.entry
  const rawEntries = Array.isArray(rawEntryValue) ? rawEntryValue : rawEntryValue ? [rawEntryValue] : []
  const entries: StableTagEntry[] = []
  for (const rawEntry of rawEntries) {
    if (!isRecord(rawEntry)) continue
    const tagName = readTagName(rawEntry)
    if (!tagName) continue
    const version = parseStableTagVersion(tagName)
    if (!version) continue
    entries.push({
      tagName,
      version,
      updatedAt: readOptionalText(rawEntry.updated),
    })
  }
  if (!entries.length) {
    throw invalidChannelPayload('GitHub tags feed did not contain a stable semantic-version tag.')
  }
  return entries
}

function selectLatestStableTagEntry(entries: readonly StableTagEntry[]): StableTagEntry {
  return [...entries].sort((left, right) => {
    for (let index = 0; index < left.version.length; index += 1) {
      const difference = right.version[index] - left.version[index]
      if (difference !== 0) return difference
    }
    return right.tagName.localeCompare(left.tagName)
  })[0]
}

function readTagName(entry: Record<string, unknown>): string | null {
  const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : []
  for (const link of links) {
    if (!isRecord(link)) continue
    const href = readOptionalText(link['@_href'])
    const tagName = href ? tagNameFromReleaseUrl(href) : null
    if (tagName) return tagName
  }

  const id = readOptionalText(entry.id)
  if (id) {
    const tagName = decodePathSegment(id.split('/').filter(Boolean).at(-1) ?? '')
    if (tagName && parseStableTagVersion(tagName)) return tagName
  }

  const title = readOptionalText(entry.title)
  const titleMatch = title?.match(/(?:^|\s)(v?\d+\.\d+\.\d+)(?:\s|$)/i)
  return titleMatch && parseStableTagVersion(titleMatch[1]) ? titleMatch[1] : null
}

function tagNameFromReleaseUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (!isExpectedGithubUrl(url)) return null
    const prefix = `${REPOSITORY_PATH}/releases/tag/`
    if (!url.pathname.startsWith(prefix)) return null
    const tagName = decodePathSegment(url.pathname.slice(prefix.length))
    return tagName && parseStableTagVersion(tagName) ? tagName : null
  } catch {
    return null
  }
}

function parseTaggedAppVersion(payload: unknown): { versionName: string; versionCode: number } {
  const root = requireRecord(payload, 'Tagged app.json payload')
  const expo = requireRecord(root.expo, 'Tagged app.json expo configuration')
  const android = requireRecord(expo.android, 'Tagged app.json Android configuration')
  const versionName = readOptionalText(expo.version)
  const versionCode = android.versionCode
  if (!versionName || !/^\d+\.\d+\.\d+$/.test(versionName)) {
    throw invalidChannelPayload('Tagged app.json expo.version must be a stable semantic version.')
  }
  if (typeof versionCode !== 'number' || !Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw invalidChannelPayload('Tagged app.json expo.android.versionCode must be a positive integer.')
  }
  return { versionName, versionCode }
}

function parseReleaseAssetLinks(html: string, tagName: string): GithubReleaseAssetSnapshot[] {
  let payload: unknown
  try {
    payload = githubHtmlParser.parse(html)
  } catch (error) {
    throw invalidChannelPayload(`GitHub release asset page is invalid HTML: ${formatError(error)}`)
  }

  const hrefs: string[] = []
  collectHrefAttributes(payload, hrefs)
  const expectedPrefix = `${REPOSITORY_PATH}/releases/download/${tagName}/`
  const assets = new Map<string, GithubReleaseAssetSnapshot>()
  for (const href of hrefs) {
    try {
      const url = new URL(href, GITHUB_ORIGIN)
      if (!isExpectedGithubUrl(url) || !url.pathname.startsWith(expectedPrefix)) continue
      const encodedName = url.pathname.slice(expectedPrefix.length)
      if (!encodedName || encodedName.includes('/')) continue
      const name = decodePathSegment(encodedName)
      if (!name?.toLowerCase().endsWith('.apk')) continue
      url.search = ''
      url.hash = ''
      assets.set(name, { name, url: url.href })
    } catch {
      continue
    }
  }
  return [...assets.values()]
}

function collectHrefAttributes(payload: unknown, hrefs: string[]): void {
  if (Array.isArray(payload)) {
    for (const item of payload) collectHrefAttributes(item, hrefs)
    return
  }
  if (!isRecord(payload)) return
  const href = readOptionalText(payload['@_href'])
  if (href) hrefs.push(href)
  for (const [key, value] of Object.entries(payload)) {
    if (key.startsWith('@_') || key === '#text') continue
    collectHrefAttributes(value, hrefs)
  }
}

async function requestBoundedJson(
  url: string,
  maxBytes: number,
  options: GithubReleaseChannelRequestOptions,
): Promise<unknown> {
  const text = await requestBoundedText(url, 'application/json', maxBytes, options)
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw invalidChannelPayload(`GitHub tagged JSON is invalid: ${formatError(error)}`)
  }
}

async function requestBoundedText(
  url: string,
  accept: string,
  maxBytes: number,
  options: GithubReleaseChannelRequestOptions,
): Promise<string> {
  const fetchImplementation = options.fetchImplementation ?? fetch
  const timeoutMs = normalizeTimeout(options.timeoutMs)
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abortFromParent()
  else options.signal?.addEventListener('abort', abortFromParent, { once: true })

  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('GitHub release channel request timed out.'))
      reject(new Error('GitHub release channel request timed out.'))
    }, timeoutMs)
  })

  try {
    const response = await Promise.race([
      fetchImplementation(url, {
        headers: {
          Accept: accept,
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      }),
      timeout,
    ])
    if (!response.ok) {
      const reason: GithubReleaseChannelFailureReason = response.status === 403 || response.status === 429
        ? 'rate_limited'
        : 'network'
      throw new GithubReleaseChannelError(reason, `GitHub release channel returned HTTP ${response.status}.`)
    }
    const declaredLength = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10)
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw invalidChannelPayload(`GitHub release channel response exceeds ${maxBytes} bytes.`)
    }
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw invalidChannelPayload(`GitHub release channel response exceeds ${maxBytes} bytes.`)
    }
    return text
  } catch (error) {
    if (error instanceof GithubReleaseChannelError) throw error
    const message = timedOut
      ? 'GitHub release channel request timed out.'
      : `GitHub release channel request failed: ${formatError(error)}`
    throw new GithubReleaseChannelError('network', message)
  } finally {
    if (timer) clearTimeout(timer)
    options.signal?.removeEventListener('abort', abortFromParent)
  }
}

function normalizeTimeout(value: number | undefined): number {
  if (value == null) return GITHUB_RELEASE_REQUEST_TIMEOUT_MS
  if (!Number.isFinite(value)) return GITHUB_RELEASE_REQUEST_TIMEOUT_MS
  return Math.min(60_000, Math.max(1, Math.round(value)))
}

function parseStableTagVersion(tagName: string): readonly [number, number, number] | null {
  const match = tagName.match(/^v?(\d+)\.(\d+)\.(\d+)$/i)
  if (!match) return null
  const version = match.slice(1).map((value) => Number.parseInt(value, 10))
  if (version.some((value) => !Number.isSafeInteger(value) || value < 0)) return null
  return [version[0], version[1], version[2]]
}

function assertStableTagName(tagName: string): void {
  if (!parseStableTagVersion(tagName)) {
    throw invalidChannelPayload('GitHub release tag must be a stable semantic version.')
  }
}

function isExpectedGithubUrl(url: URL): boolean {
  return url.protocol === 'https:' &&
    url.hostname.toLowerCase() === 'github.com' &&
    (url.port === '' || url.port === '443') &&
    !url.username &&
    !url.password
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidChannelPayload(`${label} must be an object.`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readOptionalText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (isRecord(value) && typeof value['#text'] === 'string') return value['#text'].trim() || null
  return null
}

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim()
    return decoded && !decoded.includes('/') && !decoded.includes('\\') ? decoded : null
  } catch {
    return null
  }
}

function invalidChannelPayload(message: string): GithubReleaseChannelError {
  return new GithubReleaseChannelError('manifest_invalid', message)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
