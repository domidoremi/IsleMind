import { sanitizeTraceDisplayText } from '@/core'
import type { PendingModelOperation } from '@/modules/assistant-runtime'
import { BUILT_IN_CAPABILITY_SERVER_ID, normalizeWorkspaceRelativePath, utf8ByteLength } from '@/modules/integrations'
import { builtInWritableWorkspaceFilePort } from './builtInWorkspaceFileRuntime'

type Pending = Pick<PendingModelOperation, 'operationId' | 'continuationState'>
const PREVIEW_BYTES = 16_000

export function isWorkspaceEdit(pending?: Pending): boolean {
  return pending?.operationId === 'builtin:' + BUILT_IN_CAPABILITY_SERVER_ID + ':edit_file'
}

/** Read-only preview. Applying still goes through the existing Harness and CAS file adapter. */
export async function loadWorkspaceEditReview(pending: Pending, signal: AbortSignal): Promise<string | undefined> {
  if (!isWorkspaceEdit(pending)) return undefined
  if (signal.aborted) throw unavailable()
  const files = builtInWritableWorkspaceFilePort
  const call = pending.continuationState.call
  if (!files || !isRecord(call) || call.operationId !== pending.operationId || !isRecord(call.arguments)) throw unavailable()
  const args = call.arguments
  const path = normalizeWorkspaceRelativePath(args.path)
  const text = args.text
  const expectedRevision = args.expectedRevision
  if (!path.startsWith('workspace/') || typeof text !== 'string' || text.length > PREVIEW_BYTES
    || utf8ByteLength(text) > PREVIEW_BYTES
    || typeof expectedRevision !== 'string') throw unavailable()
  const info = await files.inspect(path, { signal })
  if (signal.aborted) throw unavailable()
  let before = ''
  if (info) {
    if (info.relativePath !== path || info.revision !== expectedRevision || info.byteLength > PREVIEW_BYTES) throw unavailable()
    const read = await files.readText(path, { signal, maxBytes: PREVIEW_BYTES })
    if (signal.aborted || read.revision !== expectedRevision || read.relativePath !== path
      || read.byteLength > PREVIEW_BYTES || utf8ByteLength(read.text) !== read.byteLength) throw unavailable()
    before = read.text
  } else if (expectedRevision !== 'absent:v1') throw unavailable()
  if (signal.aborted) throw unavailable()
  const diff = [
    '--- ' + (info ? path : '/dev/null'), '+++ ' + path,
    '@@ ' + expectedRevision + ' @@',
    ...before.split('\n').map(line => '- ' + line),
    ...text.split('\n').map(line => '+ ' + line),
  ].join('\n')
  // Never approve an incomplete/redacted view as though it were the exact edit.
  const safe = sanitizeTraceDisplayText(diff, 48_000)
  if (safe !== diff.trim()) throw unavailable()
  return safe
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function unavailable() { return new Error('workspace_edit_preview_unavailable') }
