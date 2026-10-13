import { clearExecutionTimeout, setExecutionTimeout, type ExecutionTimer } from '@/core/executionTimers'
import { ContentReportError, parseContentReportConfiguration, prepareContentReport, validateContentReport, type ContentReporting } from '../application/contentReport'

const REPORT_TIMEOUT_MS = 15_000
const ACKNOWLEDGEMENT_BYTE_LIMIT = 4096

/** Independent of Provider routing, credentials, model budgets and background work. No automatic retries. */
export function createHttpContentReporting(input: {
  configuration: unknown
  appVersion: string
  randomUUID: () => string
  fetch: typeof fetch
}): ContentReporting {
  const configuration = parseContentReportConfiguration(input.configuration)
  return {
    configuration,
    prepare(draft) {
      if (!configuration) throw new ContentReportError('unavailable')
      return prepareContentReport(draft, input.randomUUID(), input.appVersion)
    },
    async submit(report, signal) {
      if (!configuration) throw new ContentReportError('unavailable')
      validateContentReport(report)
      // Serialize synchronously so even a mutable caller cannot change the reviewed bytes mid-request.
      const body = JSON.stringify(report)
      const reportId = report.reportId
      if (signal.aborted) throw new ContentReportError('cancelled')
      const controller = new AbortController()
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      let timer: ExecutionTimer | undefined
      let rejectStopped!: (error: ContentReportError) => void
      const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject })
      const stop = (code: 'cancelled' | 'timeout') => {
        rejectStopped(new ContentReportError(code))
        controller.abort()
      }
      const cancel = () => stop('cancelled')
      signal.addEventListener('abort', cancel, { once: true })
      try {
        timer = setExecutionTimeout(() => stop('timeout'), REPORT_TIMEOUT_MS)
        await Promise.race([stopped, (async () => {
          const response = await input.fetch(configuration.endpoint, {
            method: 'POST', body, signal: controller.signal, redirect: 'error', credentials: 'omit',
            cache: 'no-store', referrerPolicy: 'no-referrer',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': reportId },
          })
          if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); return }
          if (response.redirected || response.url !== configuration.endpoint || ![200, 201, 202].includes(response.status)
            || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') || !response.body) {
            void response.body?.cancel().catch(() => undefined)
            throw new ContentReportError('failed')
          }
          reader = response.body.getReader()
          const chunks: Uint8Array[] = []
          let bytes = 0
          while (true) {
            const chunk = await reader.read()
            if (controller.signal.aborted) return
            if (chunk.done) break
            bytes += chunk.value.byteLength
            if (bytes > ACKNOWLEDGEMENT_BYTE_LIMIT) throw new ContentReportError('failed')
            chunks.push(chunk.value)
          }
          const buffer = new Uint8Array(bytes)
          let offset = 0
          for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
          const acknowledgement: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer))
          if (!acknowledgement || typeof acknowledgement !== 'object'
            || (acknowledgement as Record<string, unknown>).reportId !== reportId
            || (acknowledgement as Record<string, unknown>).status !== 'received') throw new ContentReportError('failed')
        })()])
      } catch (error) {
        // Never expose a response, endpoint exception, or report text in UI/log errors.
        throw error instanceof ContentReportError ? error : new ContentReportError('failed')
      } finally {
        clearExecutionTimeout(timer)
        signal.removeEventListener('abort', cancel)
        controller.abort()
        void reader?.cancel().catch(() => undefined)
      }
    },
  }
}
