import type { JsonRecord } from '@/core'

import type {
  BuiltInCapabilityAdapter,
  BuiltInCapabilityAdapterDependencies,
  BuiltInCapabilityExecutionResult,
  BuiltInCapabilityOutcome,
  BuiltInCapabilityOutcomeCode,
  BuiltInCapabilityToolName,
  BuiltInNetworkTargetAdmission,
  BuiltInRemoteWebCrawlResult,
  BuiltInWebFetchResponse,
  BuiltInWorkspaceFileEditResult,
  BuiltInWorkspaceFileInfo,
} from './builtInCapabilityContracts'
import {
  BUILT_IN_CAPABILITY_SERVER_ID,
  BUILT_IN_CAPABILITY_TOOL_NAMES,
  BUILT_IN_WORKSPACE_ABSENT_REVISION,
  getBuiltInCapabilityToolPolicy,
} from './builtInCapabilityContracts'
import {
  assertBoundedByteLength,
  assertBuiltInAdmission,
  assertCrawlMimeType,
  assertSameOriginUrl,
  assertTextFileMimeType,
  boundedInteger,
  BUILT_IN_FILE_EDIT_MAX_BYTES,
  BUILT_IN_FILE_READ_DEFAULT_BYTES,
  BUILT_IN_FILE_READ_MAX_BYTES,
  BUILT_IN_OPERATION_TIMEOUT_MAX_MS,
  BUILT_IN_WEB_CRAWL_MAX_BYTES,
  BUILT_IN_WEB_CRAWL_MAX_DEPTH,
  BUILT_IN_WEB_CRAWL_MAX_PAGES,
  BUILT_IN_WEB_CRAWL_PAGE_MAX_BYTES,
  BUILT_IN_WEB_REDIRECT_LIMIT,
  BUILT_IN_WEB_SEARCH_MAX_RESULTS,
  BuiltInCapabilityPolicyError,
  isAbortError,
  normalizeMimeType,
  normalizePublicHttpsUrl,
  normalizeRevision,
  normalizeTimeoutMs,
  normalizeWebQuery,
  normalizeWorkspaceRelativePath,
  publicDisplayUrl,
  resolveRedirectUrl,
  stablePrivateFingerprint,
  truncatePublicText,
  utf8ByteLength,
} from './builtInCapabilityPolicy'
import { normalizeExternalToolExecutionResult } from './externalToolObservation'

const SEARCH_SNIPPET_LIMIT = 4_000
const SEARCH_TITLE_LIMIT = 300
const SEARCH_RESULT_SCAN_FACTOR = 3
const CRAWL_VISIBLE_PAGE_LIMIT = 6_000
const CRAWL_VISIBLE_TOTAL_LIMIT = 30_000
const SAFE_PERMIT_TOKEN = /^[A-Za-z0-9._:-]{8,512}$/
const SAFE_DIGEST = /^[A-Za-z0-9._:-]{8,512}$/

export function listRunnableBuiltInCapabilityToolNames(
  dependencies: BuiltInCapabilityAdapterDependencies,
): readonly BuiltInCapabilityToolName[] {
  return BUILT_IN_CAPABILITY_TOOL_NAMES.filter((name) => {
    switch (name) {
      case 'search_web':
        return dependencies.webSearch !== undefined
      case 'crawl_web':
        return dependencies.remoteWebCrawl !== undefined ||
          (dependencies.networkTrust !== undefined && dependencies.webFetch !== undefined)
      case 'read_file':
        return dependencies.workspaceFileRead !== undefined || dependencies.workspaceFiles !== undefined
      case 'edit_file':
        return dependencies.workspaceFiles !== undefined
    }
  })
}

export function createBuiltInCapabilityAdapters(
  dependencies: BuiltInCapabilityAdapterDependencies,
  options: {
    serverId?: string
    enabledToolNames?: readonly BuiltInCapabilityToolName[]
  } = {},
): BuiltInCapabilityAdapter[] {
  const enabledToolNames = options.enabledToolNames
    ? new Set<BuiltInCapabilityToolName>(options.enabledToolNames)
    : undefined
  return BUILT_IN_CAPABILITY_TOOL_NAMES
    .filter((name) => enabledToolNames === undefined || enabledToolNames.has(name))
    .map((name) => createBuiltInCapabilityAdapter(name, dependencies, options))
}

export function createBuiltInCapabilityAdapter(
  name: BuiltInCapabilityToolName,
  dependencies: BuiltInCapabilityAdapterDependencies,
  options: { serverId?: string } = {},
): BuiltInCapabilityAdapter {
  const serverId = normalizeServerId(options.serverId ?? BUILT_IN_CAPABILITY_SERVER_ID)
  const policy = getBuiltInCapabilityToolPolicy(name)
  const toolId = `builtin:${serverId}:${name}` as const
  return {
    definition: {
      id: toolId,
      source: 'builtin',
      capabilityScope: [
        `server:${serverId}`,
        `tool:${name}`,
        ...policy.permissions.map((permission) => `permission:${permission}`),
      ],
      requiresConfirmation: policy.requiresConfirmation,
    },
    async execute(request, options) {
      const startedAt = now(dependencies)
      try {
        assertRequestBinding(request.tool.id, toolId)
        throwIfCancelled(options.signal)
        const admission = await runWithDeadline(
          options.signal,
          10_000,
          (signal) => dependencies.admission.admit({
            taskId: request.taskId,
            toolId,
            toolName: name,
            requiredPermissions: policy.permissions,
            requiresConfirmation: policy.requiresConfirmation,
          }, { signal }),
        )
        const allowed = assertBuiltInAdmission({
          taskId: request.taskId,
          toolId,
          toolName: name,
          requiredPermissions: policy.permissions,
          requiresConfirmation: policy.requiresConfirmation,
        }, admission)
        throwIfCancelled(options.signal)
        switch (name) {
          case 'search_web':
            return await executeWebSearch(toolId, request.arguments, dependencies, options.signal, startedAt)
          case 'crawl_web':
            return await executeWebCrawl(toolId, request.arguments, dependencies, options.signal, startedAt)
          case 'read_file':
            return await executeFileRead(toolId, request.arguments, dependencies, options.signal, startedAt)
          case 'edit_file':
            return await executeFileEdit(
              toolId,
              request.arguments,
              requiredIdempotencyKey(allowed.idempotencyKey),
              dependencies,
              options.signal,
              startedAt,
            )
        }
      } catch (error) {
        return failureResult(toolId, name, error, dependencies, options.signal, startedAt)
      }
    },
  }
}

async function executeWebSearch(
  toolId: string,
  argumentsValue: JsonRecord,
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
  startedAt: number,
): Promise<BuiltInCapabilityExecutionResult> {
  if (!dependencies.webSearch) {
    throw unavailable('Web search requires a configured search adapter.')
  }
  const query = normalizeWebQuery(argumentsValue.query)
  const limit = boundedInteger(argumentsValue.limit, 5, 1, BUILT_IN_WEB_SEARCH_MAX_RESULTS)
  const timeoutMs = normalizeTimeoutMs(argumentsValue.timeoutMs)
  const rawResults = await runWithDeadline(signal, timeoutMs, (operationSignal) => dependencies.webSearch!.search({
    query,
    limit: Math.min(BUILT_IN_WEB_SEARCH_MAX_RESULTS * SEARCH_RESULT_SCAN_FACTOR, limit * SEARCH_RESULT_SCAN_FACTOR),
  }, { signal: operationSignal, timeoutMs }))
  if (!Array.isArray(rawResults)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The web search adapter returned an invalid result set.')
  }
  const results: Array<{ title: string; url: string; snippet: string; fingerprint: string }> = []
  const seenUrls = new Set<string>()
  for (const raw of rawResults.slice(0, BUILT_IN_WEB_SEARCH_MAX_RESULTS * SEARCH_RESULT_SCAN_FACTOR)) {
    throwIfCancelled(signal)
    if (!raw || typeof raw !== 'object') continue
    let url: string
    try {
      // Search results are display-only references. They are validated as
      // public HTTPS URLs, but are not connected to here, so DNS/address trust
      // admission remains reserved for the crawl/fetch path.
      url = normalizePublicHttpsUrl(raw.url)
    } catch (error) {
      if (isCancellation(error, signal)) throw error
      continue
    }
    if (seenUrls.has(url)) continue
    seenUrls.add(url)
    const title = truncatePublicText(raw.title, SEARCH_TITLE_LIMIT) || publicDisplayUrl(url)
    const snippet = truncatePublicText(raw.snippet, SEARCH_SNIPPET_LIMIT)
    results.push({
      title,
      url: publicDisplayUrl(url),
      snippet,
      fingerprint: stablePrivateFingerprint(url),
    })
    if (results.length >= limit) break
  }
  if (!results.length) {
    throw new BuiltInCapabilityPolicyError(
      'execution_failed',
      'No public web results passed the configured trust boundary.',
      true,
    )
  }
  const blocks = results.map((result) => ({
    type: 'resource' as const,
    name: result.title,
    uri: result.url,
    text: result.snippet,
    mimeType: 'text/html',
  }))
  return successResult({
    toolId,
    name: 'search_web',
    summary: `Found ${results.length} bounded public web result(s).`,
    blocks,
    metadata: {
      resultCount: results.length,
      resultFingerprints: results.map((result) => result.fingerprint),
      queryFingerprint: stablePrivateFingerprint(query),
      timeoutMs,
    },
    startedAt,
    dependencies,
  })
}

async function executeWebCrawl(
  toolId: string,
  argumentsValue: JsonRecord,
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
  startedAt: number,
): Promise<BuiltInCapabilityExecutionResult> {
  const seedUrl = normalizePublicHttpsUrl(argumentsValue.url)
  const seedOrigin = new URL(seedUrl).origin
  const maxDepth = boundedInteger(argumentsValue.maxDepth, 1, 0, BUILT_IN_WEB_CRAWL_MAX_DEPTH)
  const maxPages = boundedInteger(argumentsValue.maxPages, 5, 1, BUILT_IN_WEB_CRAWL_MAX_PAGES)
  const maxBytes = boundedInteger(argumentsValue.maxBytes, 512 * 1024, 1_024, BUILT_IN_WEB_CRAWL_MAX_BYTES)
  const timeoutMs = normalizeTimeoutMs(argumentsValue.timeoutMs)
  const hasLocalTrustedFetch = dependencies.networkTrust !== undefined && dependencies.webFetch !== undefined
  if (!hasLocalTrustedFetch && dependencies.remoteWebCrawl) {
    return executeRemoteWebCrawl({
      toolId,
      seedUrl,
      seedOrigin,
      maxDepth,
      maxPages,
      maxBytes,
      timeoutMs,
      dependencies,
      signal,
      startedAt,
    })
  }
  if (!hasLocalTrustedFetch) {
    throw unavailable('Web crawl requires a remote vendor or network-trust and bounded fetch adapters.')
  }
  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }]
  const visited = new Set<string>()
  const pages: Array<{
    url: string
    title?: string
    text: string
    byteLength: number
    depth: number
    fingerprint: string
  }> = []
  let totalBytes = 0
  let failedPages = 0

  while (queue.length && pages.length < maxPages && totalBytes < maxBytes) {
    throwIfCancelled(signal)
    const next = queue.shift()!
    const normalizedUrl = assertSameOriginUrl(next.url, seedOrigin)
    if (visited.has(normalizedUrl)) continue
    visited.add(normalizedUrl)
    const remainingBytes = maxBytes - totalBytes
    try {
      const response = await fetchTrustedPage({
        url: normalizedUrl,
        origin: seedOrigin,
        maxBytes: Math.min(BUILT_IN_WEB_CRAWL_PAGE_MAX_BYTES, remainingBytes),
        timeoutMs,
      }, dependencies, signal)
      const mimeType = assertCrawlMimeType(response.mimeType)
      if (response.status < 200 || response.status >= 300) {
        throw new BuiltInCapabilityPolicyError('execution_failed', `Web crawl received HTTP ${response.status}.`, true)
      }
      if (typeof response.body !== 'string') {
        throw new BuiltInCapabilityPolicyError('execution_failed', 'The bounded fetch adapter returned no text body.')
      }
      const measuredBytes = Math.max(response.byteLength, utf8ByteLength(response.body))
      assertBoundedByteLength(measuredBytes, Math.min(BUILT_IN_WEB_CRAWL_PAGE_MAX_BYTES, remainingBytes), 'Web page')
      const document = extractWebDocument(response.body, mimeType, response.finalUrl)
      totalBytes += measuredBytes
      pages.push({
        url: publicDisplayUrl(response.finalUrl),
        title: document.title,
        text: document.text,
        byteLength: measuredBytes,
        depth: next.depth,
        fingerprint: stablePrivateFingerprint(response.finalUrl),
      })
      if (next.depth < maxDepth) {
        for (const link of document.links) {
          if (queue.length + visited.size >= maxPages * 8) break
          try {
            const sameOrigin = assertSameOriginUrl(link, seedOrigin)
            if (!visited.has(sameOrigin)) queue.push({ url: sameOrigin, depth: next.depth + 1 })
          } catch {
            // Cross-origin, private, malformed, and non-HTTPS links are ignored.
          }
        }
      }
    } catch (error) {
      if (isCancellation(error, signal)) throw error
      if (!pages.length) throw error
      failedPages += 1
    }
  }

  let visibleChars = 0
  const blocks = pages.map((page) => {
    const remaining = Math.max(0, CRAWL_VISIBLE_TOTAL_LIMIT - visibleChars)
    const body = truncatePublicText(page.text, Math.min(CRAWL_VISIBLE_PAGE_LIMIT, remaining))
    visibleChars += body.length
    return {
      type: 'resource' as const,
      name: page.title || page.url,
      uri: page.url,
      text: body,
      mimeType: 'text/html',
    }
  })
  return successResult({
    toolId,
    name: 'crawl_web',
    summary: `Crawled ${pages.length} public page(s) within ${totalBytes} byte(s).`,
    blocks,
    metadata: {
      pageCount: pages.length,
      failedPageCount: failedPages,
      totalBytes,
      maxDepth,
      maxPages,
      maxBytes,
      timeoutMs,
      pageFingerprints: pages.map((page) => page.fingerprint),
      truncated: Boolean(queue.length) || totalBytes >= maxBytes,
    },
    startedAt,
    dependencies,
  })
}

async function executeRemoteWebCrawl(input: {
  toolId: string
  seedUrl: string
  seedOrigin: string
  maxDepth: number
  maxPages: number
  maxBytes: number
  timeoutMs: number
  dependencies: BuiltInCapabilityAdapterDependencies
  signal: AbortSignal
  startedAt: number
}): Promise<BuiltInCapabilityExecutionResult> {
  const remoteWebCrawl = input.dependencies.remoteWebCrawl
  if (!remoteWebCrawl) {
    throw unavailable('Remote web crawl is unavailable on this runtime.')
  }
  const remoteResult = await runWithDeadline(input.signal, input.timeoutMs, (operationSignal) => remoteWebCrawl.crawl({
    url: input.seedUrl,
    maxDepth: input.maxDepth,
    maxPages: input.maxPages,
    maxBytes: input.maxBytes,
    maxPageBytes: Math.min(BUILT_IN_WEB_CRAWL_PAGE_MAX_BYTES, input.maxBytes),
    maxTextCharsPerPage: CRAWL_VISIBLE_PAGE_LIMIT,
    maxTotalTextChars: CRAWL_VISIBLE_TOTAL_LIMIT,
    sameOriginOnly: true,
  }, { signal: operationSignal, timeoutMs: input.timeoutMs }))
  throwIfCancelled(input.signal)
  const pages = validateRemoteWebCrawlResult({
    result: remoteResult,
    seedOrigin: input.seedOrigin,
    maxDepth: input.maxDepth,
    maxPages: input.maxPages,
    maxBytes: input.maxBytes,
  })
  const blocks = pages.map((page) => ({
    type: 'resource' as const,
    name: page.title || page.url,
    uri: page.url,
    text: page.text,
    mimeType: 'text/html',
  }))
  const totalBytes = pages.reduce((total, page) => total + page.byteLength, 0)
  return successResult({
    toolId: input.toolId,
    name: 'crawl_web',
    summary: `Crawled ${pages.length} vendor-extracted public page(s) within ${totalBytes} byte(s).`,
    blocks,
    metadata: {
      pageCount: pages.length,
      failedPageCount: 0,
      totalBytes,
      maxDepth: input.maxDepth,
      maxPages: input.maxPages,
      maxBytes: input.maxBytes,
      timeoutMs: input.timeoutMs,
      pageFingerprints: pages.map((page) => page.fingerprint),
      truncated: false,
      source: 'remote_vendor',
    },
    startedAt: input.startedAt,
    dependencies: input.dependencies,
  })
}

function validateRemoteWebCrawlResult(input: {
  result: BuiltInRemoteWebCrawlResult
  seedOrigin: string
  maxDepth: number
  maxPages: number
  maxBytes: number
}): Array<{
  url: string
  title?: string
  text: string
  byteLength: number
  fingerprint: string
}> {
  if (!input.result || typeof input.result !== 'object' || !Array.isArray(input.result.pages)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned an invalid result.')
  }
  if (!input.result.pages.length) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned no validated pages.', true)
  }
  if (input.result.pages.length > input.maxPages) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The remote crawl vendor exceeded the page limit.')
  }
  const pages: Array<{
    url: string
    title?: string
    text: string
    byteLength: number
    fingerprint: string
  }> = []
  const seenUrls = new Set<string>()
  let totalBytes = 0
  let totalTextChars = 0
  const maxPageBytes = Math.min(BUILT_IN_WEB_CRAWL_PAGE_MAX_BYTES, input.maxBytes)
  for (const rawPage of input.result.pages) {
    if (!rawPage || typeof rawPage !== 'object' || Array.isArray(rawPage)) {
      throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned a malformed page.')
    }
    const url = assertSameOriginUrl(rawPage.url, input.seedOrigin)
    if (seenUrls.has(url)) {
      throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned a duplicate page URL.')
    }
    seenUrls.add(url)
    if (!Number.isSafeInteger(rawPage.depth) || rawPage.depth < 0 || rawPage.depth > input.maxDepth) {
      throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned an invalid page depth.')
    }
    const declaredBytes = assertBoundedByteLength(rawPage.byteLength, maxPageBytes, 'Remote web page')
    if (typeof rawPage.text !== 'string' || rawPage.text.length > CRAWL_VISIBLE_PAGE_LIMIT) {
      throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The remote crawl vendor returned text beyond the page limit.')
    }
    if (hasUnsafeRemoteCrawlText(rawPage.text)) {
      throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned unsafe page text.')
    }
    const text = truncatePublicText(rawPage.text, CRAWL_VISIBLE_PAGE_LIMIT)
    const measuredBytes = Math.max(declaredBytes, utf8ByteLength(rawPage.text))
    assertBoundedByteLength(measuredBytes, maxPageBytes, 'Remote web page')
    if (totalBytes + measuredBytes > input.maxBytes) {
      throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The remote crawl vendor exceeded the total byte limit.')
    }
    if (totalTextChars + text.length > CRAWL_VISIBLE_TOTAL_LIMIT) {
      throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The remote crawl vendor exceeded the total text limit.')
    }
    let title: string | undefined
    if (rawPage.title !== undefined) {
      if (
        typeof rawPage.title !== 'string' || rawPage.title.length > SEARCH_TITLE_LIMIT ||
        hasUnsafeRemoteCrawlText(rawPage.title)
      ) {
        throw new BuiltInCapabilityPolicyError('execution_failed', 'The remote crawl vendor returned an invalid page title.')
      }
      title = truncatePublicText(rawPage.title, SEARCH_TITLE_LIMIT)
    }
    totalBytes += measuredBytes
    totalTextChars += text.length
    pages.push({
      url: publicDisplayUrl(url),
      ...(title ? { title } : {}),
      text,
      byteLength: measuredBytes,
      fingerprint: stablePrivateFingerprint(url),
    })
  }
  return pages
}

function hasUnsafeRemoteCrawlText(input: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)
}

async function executeFileRead(
  toolId: string,
  argumentsValue: JsonRecord,
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
  startedAt: number,
): Promise<BuiltInCapabilityExecutionResult> {
  const files = dependencies.workspaceFileRead ?? dependencies.workspaceFiles
  if (!files) throw unavailable('Workspace file reading is unavailable on this runtime.')
  const relativePath = normalizeWorkspaceRelativePath(argumentsValue.path)
  const maxBytes = boundedInteger(
    argumentsValue.maxBytes,
    BUILT_IN_FILE_READ_DEFAULT_BYTES,
    1,
    BUILT_IN_FILE_READ_MAX_BYTES,
  )
  const info = await runWithDeadline(signal, 10_000, (operationSignal) => files.inspect(relativePath, { signal: operationSignal }))
  if (!info) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The requested workspace file does not exist.')
  }
  validateWorkspaceFileInfo(info, relativePath, maxBytes)
  assertTextFileMimeType(info.mimeType)
  const read = await runWithDeadline(signal, 10_000, (operationSignal) => files.readText(relativePath, {
    signal: operationSignal,
    maxBytes,
  }))
  validateWorkspaceFileInfo(read, relativePath, maxBytes)
  const mimeType = assertTextFileMimeType(read.mimeType)
  const measuredBytes = Math.max(read.byteLength, utf8ByteLength(read.text))
  assertBoundedByteLength(measuredBytes, maxBytes, 'Workspace file')
  return successResult({
    toolId,
    name: 'read_file',
    summary: `Read ${measuredBytes} byte(s) from a workspace text file.`,
    blocks: [{ type: 'text', text: read.text, mimeType, name: 'workspace-text' }],
    metadata: {
      workspaceScopeFingerprint: stablePrivateFingerprint(files.workspaceScopeId),
      pathFingerprint: stablePrivateFingerprint(relativePath),
      revisionFingerprint: stablePrivateFingerprint(read.revision),
      mimeType,
      byteLength: measuredBytes,
    },
    startedAt,
    dependencies,
  })
}

async function executeFileEdit(
  toolId: string,
  argumentsValue: JsonRecord,
  idempotencyKey: string,
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
  startedAt: number,
): Promise<BuiltInCapabilityExecutionResult> {
  const files = dependencies.workspaceFiles
  if (!files) throw unavailable('Workspace file editing is unavailable on this runtime.')
  const relativePath = normalizeWorkspaceRelativePath(argumentsValue.path)
  if (typeof argumentsValue.text !== 'string') {
    throw new BuiltInCapabilityPolicyError('schema_invalid', 'File edit text must be a UTF-8 string.')
  }
  const expectedRevision = normalizeRevision(argumentsValue.expectedRevision)
  const byteLength = utf8ByteLength(argumentsValue.text)
  assertBoundedByteLength(byteLength, BUILT_IN_FILE_EDIT_MAX_BYTES, 'Edited file')
  const info = await runWithDeadline(signal, 10_000, (operationSignal) => files.inspect(relativePath, { signal: operationSignal }))
  if (!info && expectedRevision !== BUILT_IN_WORKSPACE_ABSENT_REVISION) {
    throw new BuiltInCapabilityPolicyError('precondition_failed', 'The file no longer exists.', true)
  }
  if (info) validateWorkspaceFileInfo(info, relativePath, BUILT_IN_FILE_EDIT_MAX_BYTES)
  const currentMimeType = info ? assertTextFileMimeType(info.mimeType) : 'text/plain'
  const requestedMimeType = argumentsValue.mimeType === undefined
    ? currentMimeType
    : assertTextFileMimeType(argumentsValue.mimeType)
  if (info && requestedMimeType !== currentMimeType) {
    throw new BuiltInCapabilityPolicyError('mime_unsupported', 'File edit cannot silently change the existing MIME type.')
  }
  const result = await runWithDeadline(signal, 10_000, (operationSignal) => files.editTextAtomic({
    relativePath,
    text: argumentsValue.text as string,
    mimeType: requestedMimeType,
    expectedRevision,
    idempotencyKey,
  }, { signal: operationSignal }))
  return projectFileEditResult({
    toolId,
    result,
    files,
    relativePath,
    expectedRevision,
    expectedByteLength: byteLength,
    expectedMimeType: requestedMimeType,
    startedAt,
    dependencies,
  })
}

async function fetchTrustedPage(
  input: { url: string; origin: string; maxBytes: number; timeoutMs: number },
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
): Promise<BuiltInWebFetchResponse> {
  let currentUrl = assertSameOriginUrl(input.url, input.origin)
  for (let redirectCount = 0; redirectCount <= BUILT_IN_WEB_REDIRECT_LIMIT; redirectCount += 1) {
    const admission = await admitPublicTarget(currentUrl, dependencies, signal, input.timeoutMs)
    const response = await runWithDeadline(signal, input.timeoutMs, (operationSignal) => dependencies.webFetch!.fetch({
      url: currentUrl,
      targetPermit: admission.permitToken,
      maxBytes: input.maxBytes,
      redirect: 'manual',
      acceptedMimeTypes: ['text/html', 'application/xhtml+xml', 'text/plain'],
    }, { signal: operationSignal, timeoutMs: input.timeoutMs }))
    validateFetchResponse(response, currentUrl, input.maxBytes)
    if (response.finalUrl !== currentUrl || response.requestedUrl !== currentUrl) {
      throw new BuiltInCapabilityPolicyError(
        'network_target_denied',
        'The fetch adapter changed targets without a newly admitted manual redirect.',
      )
    }
    if (isRedirectStatus(response.status)) {
      if (redirectCount >= BUILT_IN_WEB_REDIRECT_LIMIT) {
        throw new BuiltInCapabilityPolicyError('redirect_denied', 'Web crawl exceeded the redirect limit.')
      }
      const redirectUrl = resolveRedirectUrl(currentUrl, response.redirectUrl)
      currentUrl = assertSameOriginUrl(redirectUrl, input.origin)
      continue
    }
    return response
  }
  throw new BuiltInCapabilityPolicyError('redirect_denied', 'Web crawl exceeded the redirect limit.')
}

async function admitPublicTarget(
  url: string,
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Extract<BuiltInNetworkTargetAdmission, { status: 'allowed' }>> {
  if (!dependencies.networkTrust) throw unavailable('Network trust evidence is unavailable.')
  const requestedUrl = normalizePublicHttpsUrl(url)
  const decision = await runWithDeadline(signal, timeoutMs, (operationSignal) => dependencies.networkTrust!.admitTarget(
    requestedUrl,
    { signal: operationSignal },
  ))
  if (decision.status !== 'allowed') {
    throw new BuiltInCapabilityPolicyError(
      'network_target_denied',
      'The network trust adapter did not prove a public target.',
    )
  }
  if (
    decision.classification !== 'public' ||
    normalizePublicHttpsUrl(decision.canonicalUrl) !== requestedUrl ||
    !SAFE_PERMIT_TOKEN.test(decision.permitToken) ||
    !SAFE_DIGEST.test(decision.resolvedAddressDigest)
  ) {
    throw new BuiltInCapabilityPolicyError(
      'network_target_denied',
      'The network trust evidence is incomplete or does not match the requested target.',
    )
  }
  return decision
}

function validateFetchResponse(response: BuiltInWebFetchResponse, requestedUrl: string, maxBytes: number): void {
  if (!response || typeof response !== 'object') {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The bounded fetch adapter returned an invalid response.')
  }
  if (response.requestedUrl !== requestedUrl) {
    throw new BuiltInCapabilityPolicyError('network_target_denied', 'The bounded fetch response does not match its admitted target.')
  }
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The bounded fetch adapter returned an invalid HTTP status.')
  }
  assertBoundedByteLength(response.byteLength, maxBytes, 'Web response')
  if (response.body !== undefined && utf8ByteLength(response.body) > maxBytes) {
    throw new BuiltInCapabilityPolicyError('size_limit_exceeded', 'The web response body exceeded its declared byte limit.')
  }
}

function validateWorkspaceFileInfo(
  info: BuiltInWorkspaceFileInfo,
  expectedPath: string,
  maxBytes: number,
): void {
  if (!info || typeof info !== 'object' || info.relativePath !== expectedPath) {
    throw new BuiltInCapabilityPolicyError(
      'path_outside_workspace',
      'The file adapter did not preserve the admitted workspace-relative path.',
    )
  }
  normalizeWorkspaceRelativePath(info.relativePath)
  normalizeRevision(info.revision)
  assertBoundedByteLength(info.byteLength, maxBytes, 'Workspace file')
  if (!normalizeMimeType(info.mimeType)) {
    throw new BuiltInCapabilityPolicyError('mime_unsupported', 'The file adapter did not report a valid MIME type.')
  }
}

function isSuccessfulWorkspaceFileEditResult(
  result: BuiltInWorkspaceFileEditResult,
): result is Extract<BuiltInWorkspaceFileEditResult, { status: 'applied' | 'replayed' }> {
  return result.status === 'applied' || result.status === 'replayed'
}

function projectFileEditResult(input: {
  toolId: string
  result: BuiltInWorkspaceFileEditResult
  files: NonNullable<BuiltInCapabilityAdapterDependencies['workspaceFiles']>
  relativePath: string
  expectedRevision: string
  expectedByteLength: number
  expectedMimeType: string
  startedAt: number
  dependencies: BuiltInCapabilityAdapterDependencies
}): BuiltInCapabilityExecutionResult {
  const result = input.result
  if (result.relativePath !== input.relativePath) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The file adapter returned a different workspace path.')
  }
  if (result.status === 'conflict') {
    return conflictResult({
      toolId: input.toolId,
      name: 'edit_file',
      code: 'conflict',
      message: 'The file changed before the atomic edit could be committed.',
      metadata: fileConflictMetadata(
        input.files.workspaceScopeId,
        input.relativePath,
        input.expectedRevision,
        result.actualRevision,
      ),
      startedAt: input.startedAt,
      dependencies: input.dependencies,
    })
  }
  if (result.status === 'idempotency_conflict') {
    throw new BuiltInCapabilityPolicyError(
      'idempotency_conflict',
      'This idempotency key was already used for a different file edit.',
    )
  }
  if (result.status === 'unavailable') {
    throw unavailable('The workspace adapter cannot prove an atomic preconditioned edit on this runtime.')
  }
  if (!isSuccessfulWorkspaceFileEditResult(result)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The file adapter returned an unsupported edit receipt.')
  }
  if (
    result.previousRevision !== input.expectedRevision ||
    result.byteLength !== input.expectedByteLength ||
    normalizeMimeType(result.mimeType) !== input.expectedMimeType
  ) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'The file adapter returned an inconsistent edit receipt.')
  }
  normalizeRevision(result.revision)
  return successResult({
    toolId: input.toolId,
    name: 'edit_file',
    summary: result.status === 'replayed'
      ? 'Reused the durable receipt for an already-applied workspace file edit.'
      : 'Applied an atomic preconditioned workspace file edit.',
    blocks: [{ type: 'text', text: result.status === 'replayed' ? 'File edit already applied.' : 'File edit applied.' }],
    metadata: {
      workspaceScopeFingerprint: stablePrivateFingerprint(input.files.workspaceScopeId),
      pathFingerprint: stablePrivateFingerprint(input.relativePath),
      previousRevisionFingerprint: stablePrivateFingerprint(input.expectedRevision),
      revisionFingerprint: stablePrivateFingerprint(result.revision),
      mimeType: input.expectedMimeType,
      byteLength: result.byteLength,
      idempotencyStatus: result.status,
    },
    startedAt: input.startedAt,
    dependencies: input.dependencies,
  })
}

function extractWebDocument(
  body: string,
  mimeType: string,
  baseUrl: string,
): { title?: string; text: string; links: string[] } {
  if (mimeType === 'text/plain') {
    return { text: truncatePublicText(body, CRAWL_VISIBLE_PAGE_LIMIT * 2), links: [] }
  }
  const titleMatch = body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)
  const links: string[] = []
  const linkPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  for (let match = linkPattern.exec(body); match && links.length < 128; match = linkPattern.exec(body)) {
    const href = match[1] ?? match[2] ?? match[3]
    if (!href || href.startsWith('#')) continue
    try {
      links.push(new URL(decodeHtmlEntities(href), baseUrl).href)
    } catch {
      // Invalid links remain untrusted and are ignored.
    }
  }
  const withoutInactive = body
    .replace(/<(?:script|style|noscript|template|svg|canvas)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template|svg|canvas)\s*>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
  const text = decodeHtmlEntities(withoutInactive.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
  return {
    title: titleMatch ? truncatePublicText(decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' '), SEARCH_TITLE_LIMIT) : undefined,
    text: truncatePublicText(text, CRAWL_VISIBLE_PAGE_LIMIT * 2),
    links,
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,7});/g, (_match, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_match, code) => safeCodePoint(Number.parseInt(code, 16)))
}

function safeCodePoint(input: number): string {
  if (!Number.isInteger(input) || input < 32 || input > 0x10ffff || (input >= 0xd800 && input <= 0xdfff)) return ' '
  try {
    return String.fromCodePoint(input)
  } catch {
    return ' '
  }
}

function successResult(input: {
  toolId: string
  name: BuiltInCapabilityToolName
  summary: string
  blocks: readonly unknown[]
  metadata?: Record<string, unknown>
  startedAt: number
  dependencies: BuiltInCapabilityAdapterDependencies
}): BuiltInCapabilityExecutionResult {
  const completedAt = now(input.dependencies)
  const outcome: BuiltInCapabilityOutcome = {
    code: 'completed',
    retryable: false,
    message: input.summary,
  }
  const normalized = normalizeExternalToolExecutionResult({
    toolId: input.toolId,
    source: 'builtin',
    name: input.name,
    ok: true,
    status: 'done',
    output: input.summary,
    blocks: input.blocks,
    diagnostic: {
      startedAt: input.startedAt,
      completedAt,
      content: input.summary,
      metadata: { ...input.metadata, capabilityOutcome: outcome.code },
    },
    metadata: { ...input.metadata, capabilityOutcome: outcome.code },
  })
  return { ...normalized, capabilityOutcome: outcome }
}

function conflictResult(input: {
  toolId: string
  name: BuiltInCapabilityToolName
  code: 'conflict' | 'precondition_failed'
  message: string
  metadata?: Record<string, unknown>
  startedAt: number
  dependencies: BuiltInCapabilityAdapterDependencies
}): BuiltInCapabilityExecutionResult {
  return typedFailureResult({
    ...input,
    retryable: true,
  })
}

function failureResult(
  toolId: string,
  name: BuiltInCapabilityToolName,
  error: unknown,
  dependencies: BuiltInCapabilityAdapterDependencies,
  signal: AbortSignal,
  startedAt: number,
): BuiltInCapabilityExecutionResult {
  if (signal.aborted || isAbortError(error)) {
    return typedFailureResult({
      toolId,
      name,
      code: 'cancelled',
      message: 'Tool execution was cancelled.',
      retryable: true,
      startedAt,
      dependencies,
    })
  }
  if (error instanceof BuiltInCapabilityPolicyError) {
    return typedFailureResult({
      toolId,
      name,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      startedAt,
      dependencies,
    })
  }
  return typedFailureResult({
    toolId,
    name,
    code: 'execution_failed',
    message: 'The tool adapter failed without a safe durable result.',
    retryable: false,
    startedAt,
    dependencies,
  })
}

function typedFailureResult(input: {
  toolId: string
  name: BuiltInCapabilityToolName
  code: Exclude<BuiltInCapabilityOutcomeCode, 'completed'>
  message: string
  retryable: boolean
  metadata?: Record<string, unknown>
  startedAt: number
  dependencies: BuiltInCapabilityAdapterDependencies
}): BuiltInCapabilityExecutionResult {
  const message = truncatePublicText(input.message, 420) || 'Tool execution failed safely.'
  const outcome: BuiltInCapabilityOutcome = {
    code: input.code,
    retryable: input.retryable,
    message,
  }
  const completedAt = now(input.dependencies)
  const errorCode = externalErrorCode(input.code)
  const skipped = input.code === 'cancelled' || input.code === 'permission_required' ||
    input.code === 'confirmation_required' || input.code === 'policy_denied' ||
    input.code === 'capability_unavailable' || input.code === 'conflict' ||
    input.code === 'precondition_failed'
  const normalized = normalizeExternalToolExecutionResult({
    toolId: input.toolId,
    source: 'builtin',
    name: input.name,
    ok: false,
    status: skipped ? 'skipped' : 'error',
    output: message,
    blocks: [{ type: 'text', text: message }],
    diagnostic: {
      startedAt: input.startedAt,
      completedAt,
      content: message,
      status: input.code === 'cancelled' ? 'cancelled' : skipped ? 'skipped' : 'error',
      metadata: { ...input.metadata, capabilityOutcome: input.code },
    },
    errorCode,
    metadata: { ...input.metadata, capabilityOutcome: input.code },
  })
  return { ...normalized, capabilityOutcome: outcome }
}

function externalErrorCode(code: BuiltInCapabilityOutcomeCode):
  | 'tool_unavailable'
  | 'permission_required'
  | 'schema_invalid'
  | 'cancelled'
  | 'policy_denied'
  | 'execution_failed'
  | undefined {
  if (code === 'completed') return undefined
  if (code === 'cancelled') return 'cancelled'
  if (code === 'permission_required' || code === 'confirmation_required' || code === 'idempotency_required') {
    return 'permission_required'
  }
  if (code === 'schema_invalid' || code === 'precondition_required' || code === 'precondition_failed' || code === 'conflict') {
    return 'schema_invalid'
  }
  if (code === 'capability_unavailable') return 'tool_unavailable'
  if (code === 'policy_denied' || code === 'path_outside_workspace' || code === 'mime_unsupported' ||
    code === 'size_limit_exceeded' || code === 'network_target_denied' || code === 'redirect_denied') {
    return 'policy_denied'
  }
  return 'execution_failed'
}

function fileConflictMetadata(
  workspaceScopeId: string,
  relativePath: string,
  expectedRevision: string,
  actualRevision?: string,
): Record<string, string> {
  return {
    workspaceScopeFingerprint: stablePrivateFingerprint(workspaceScopeId),
    pathFingerprint: stablePrivateFingerprint(relativePath),
    expectedRevisionFingerprint: stablePrivateFingerprint(expectedRevision),
    ...(actualRevision ? { actualRevisionFingerprint: stablePrivateFingerprint(actualRevision) } : {}),
  }
}

function normalizeServerId(input: string): string {
  if (!input || input.trim() !== input || input.includes(':') || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('Built-in capability adapters require a canonical server ID.')
  }
  return input
}

function requiredIdempotencyKey(input: string | undefined): string {
  if (!input) {
    throw new BuiltInCapabilityPolicyError('idempotency_required', 'A trusted idempotency key is required.', true)
  }
  return input
}

function assertRequestBinding(actualToolId: string, expectedToolId: string): void {
  if (actualToolId !== expectedToolId) {
    throw new BuiltInCapabilityPolicyError('policy_denied', 'The task request is bound to a different tool.')
  }
}

function unavailable(message: string): BuiltInCapabilityPolicyError {
  return new BuiltInCapabilityPolicyError('capability_unavailable', message, true)
}

function throwIfCancelled(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Tool execution was cancelled.')
  error.name = 'AbortError'
  throw error
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || isAbortError(error)
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function now(dependencies: BuiltInCapabilityAdapterDependencies): number {
  const value = dependencies.now?.() ?? Date.now()
  return Number.isFinite(value) ? value : Date.now()
}

function runWithDeadline<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  throwIfCancelled(parentSignal)
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => {
      controller.abort(parentSignal.reason)
      const error = new Error('Tool execution was cancelled.')
      error.name = 'AbortError'
      settle(() => reject(error))
    }
    const timer = setTimeout(() => {
      controller.abort(new Error('Tool operation timed out.'))
      settle(() => reject(new BuiltInCapabilityPolicyError(
        'timed_out',
        'The tool operation exceeded its bounded timeout.',
        true,
      )))
    }, normalizeTimeoutMs(timeoutMs))
    parentSignal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value) => settle(() => resolve(value)),
        (error) => settle(() => reject(error)),
      )
  })
}
