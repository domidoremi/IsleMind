import {
  BuiltInCapabilityPolicyError,
  type BuiltInNetworkTargetAdmission,
  type BuiltInNetworkTrustPort,
  type BuiltInWebFetchPort,
  type BuiltInWebFetchResponse,
} from '@/modules/integrations'

interface AndroidTrustedWebFetchNativeModule {
  admitTarget(operationId: string, url: string): Promise<unknown>
  fetchPage(
    operationId: string,
    url: string,
    permitToken: string,
    maxBytes: number,
    acceptedMimeTypes: readonly string[],
    timeoutMs: number,
  ): Promise<unknown>
  cancelOperation(operationId: string): void
}

export interface AndroidTrustedWebFetchPorts {
  networkTrust?: BuiltInNetworkTrustPort
  webFetch?: BuiltInWebFetchPort
}

let operationSequence = 0

export function createAndroidTrustedWebFetchPorts(
  nativeModule?: AndroidTrustedWebFetchNativeModule,
): AndroidTrustedWebFetchPorts {
  if (!nativeModule) return {}
  return {
    networkTrust: {
      async admitTarget(url, options) {
        try {
          const result = await runNativeOperation(
            nativeModule,
            options.signal,
            (operationId) => nativeModule.admitTarget(operationId, url),
          )
          return normalizeNativeAdmission(result)
        } catch (error) {
          if (options.signal.aborted || nativeErrorCode(error) === 'trusted_fetch_cancelled') {
            throw abortError(options.signal.reason)
          }
          return { status: 'unavailable', reason: 'Native trusted target admission is unavailable.' }
        }
      },
    },
    webFetch: {
      async fetch(input, options) {
        try {
          const result = await runNativeOperation(
            nativeModule,
            options.signal,
            (operationId) => nativeModule.fetchPage(
              operationId,
              input.url,
              input.targetPermit,
              input.maxBytes,
              input.acceptedMimeTypes,
              options.timeoutMs,
            ),
          )
          return normalizeNativeFetchResponse(result)
        } catch (error) {
          if (options.signal.aborted || nativeErrorCode(error) === 'trusted_fetch_cancelled') {
            throw abortError(options.signal.reason)
          }
          throw mapNativeFetchError(error)
        }
      },
    },
  }
}

const nativeModule = resolveAndroidNativeModule()

export const androidTrustedWebFetchPorts = createAndroidTrustedWebFetchPorts(nativeModule)

function resolveAndroidNativeModule(): AndroidTrustedWebFetchNativeModule | undefined {
  try {
    const reactNative = require('react-native') as {
      NativeModules?: { AndroidTrustedWebFetch?: AndroidTrustedWebFetchNativeModule }
      Platform?: { OS?: string }
    }
    return reactNative.Platform?.OS === 'android'
      ? reactNative.NativeModules?.AndroidTrustedWebFetch
      : undefined
  } catch {
    return undefined
  }
}

async function runNativeOperation<T>(
  native: AndroidTrustedWebFetchNativeModule,
  signal: AbortSignal,
  execute: (operationId: string) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw abortError(signal.reason)
  const operationId = `trusted-web-${Date.now().toString(36)}-${(++operationSequence).toString(36)}`
  const cancel = () => native.cancelOperation(operationId)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const result = await execute(operationId)
    if (signal.aborted) throw abortError(signal.reason)
    return result
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

function normalizeNativeAdmission(value: unknown): BuiltInNetworkTargetAdmission {
  if (!isRecord(value)) return { status: 'unavailable', reason: 'Native target admission returned no evidence.' }
  if (value.status === 'allowed') {
    if (
      typeof value.canonicalUrl === 'string' &&
      typeof value.permitToken === 'string' &&
      typeof value.resolvedAddressDigest === 'string' &&
      value.classification === 'public'
    ) {
      return {
        status: 'allowed',
        canonicalUrl: value.canonicalUrl,
        permitToken: value.permitToken,
        resolvedAddressDigest: value.resolvedAddressDigest,
        classification: 'public',
      }
    }
    return { status: 'unavailable', reason: 'Native target admission evidence is incomplete.' }
  }
  if (value.status === 'denied' || value.status === 'unresolved' || value.status === 'unavailable') {
    return { status: value.status }
  }
  return { status: 'unavailable', reason: 'Native target admission returned an unknown decision.' }
}

function normalizeNativeFetchResponse(value: unknown): BuiltInWebFetchResponse {
  if (!isRecord(value)) {
    throw new BuiltInCapabilityPolicyError('execution_failed', 'Native trusted fetch returned no response evidence.')
  }
  return {
    requestedUrl: typeof value.requestedUrl === 'string' ? value.requestedUrl : '',
    finalUrl: typeof value.finalUrl === 'string' ? value.finalUrl : '',
    status: typeof value.status === 'number' ? value.status : Number.NaN,
    ...(typeof value.mimeType === 'string' ? { mimeType: value.mimeType } : {}),
    byteLength: typeof value.byteLength === 'number' ? value.byteLength : Number.NaN,
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
    ...(typeof value.redirectUrl === 'string' ? { redirectUrl: value.redirectUrl } : {}),
  }
}

function mapNativeFetchError(error: unknown): BuiltInCapabilityPolicyError {
  switch (nativeErrorCode(error)) {
    case 'trusted_fetch_target_denied':
      return new BuiltInCapabilityPolicyError('network_target_denied', 'Native trusted fetch rejected the target permit.')
    case 'trusted_fetch_size_limit':
      return new BuiltInCapabilityPolicyError('size_limit_exceeded', 'Native trusted fetch exceeded the admitted byte limit.')
    case 'trusted_fetch_mime_unsupported':
      return new BuiltInCapabilityPolicyError('mime_unsupported', 'Native trusted fetch rejected the response MIME type.')
    default:
      return new BuiltInCapabilityPolicyError('execution_failed', 'Native trusted fetch failed.', true)
  }
}

function nativeErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason
  const error = new Error('Trusted web fetch was cancelled.')
  error.name = 'AbortError'
  return error
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
