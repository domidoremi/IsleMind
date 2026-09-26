import type { BuiltInWorkspaceFilePage, BuiltInWorkspaceFileQuery, BuiltInWorkspaceFileQueryEntry } from './builtInCapabilityContracts'
import { BuiltInCapabilityPolicyError, normalizeWorkspaceRelativePath } from './builtInCapabilityPolicy'

export const WORKSPACE_QUERY_LIMIT = 20
export const WORKSPACE_QUERY_SNIPPET_CHARS = 320
// Leave room in the Harness's bounded receipt for a summary and protocol framing.
export const WORKSPACE_QUERY_PAGE_CHARS = 3_600

export function normalizeWorkspaceQuery(input: { directory?: unknown; afterPath?: unknown; limit?: unknown; query?: unknown }): BuiltInWorkspaceFileQuery {
  const directory = input.directory ?? 'workspace'
  if (typeof directory !== 'string') throw invalid('A workspace directory is required.')
  const canonical = normalizeWorkspaceRelativePath(directory)
  if ((directory !== canonical && directory !== `${canonical}/`) || (canonical !== 'workspace' && !canonical.startsWith('workspace/'))) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'Only the app-owned workspace can be enumerated.')
  }
  const limit = input.limit ?? 10
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > WORKSPACE_QUERY_LIMIT) throw invalid('The workspace page limit must be between 1 and 20.')
  const afterPath = input.afterPath
  if (afterPath !== undefined && (typeof afterPath !== 'string' || normalizeWorkspaceRelativePath(afterPath) !== afterPath || !afterPath.startsWith(`${canonical}/`))) {
    throw new BuiltInCapabilityPolicyError('path_outside_workspace', 'The page cursor is outside the requested directory.')
  }
  const query = input.query
  if (query !== undefined && (typeof query !== 'string' || !query.trim() || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query))) throw invalid('A bounded literal search string is required.')
  return { directory: canonical, limit, ...(afterPath !== undefined ? { afterPath: afterPath as string } : {}), ...(query !== undefined ? { query: query as string } : {}) }
}

/** Keep complete JSON and a usable cursor, rather than truncating a page mid-file. */
export function boundedWorkspacePage(entries: readonly BuiltInWorkspaceFileQueryEntry[], input: BuiltInWorkspaceFileQuery): BuiltInWorkspaceFilePage {
  const files: BuiltInWorkspaceFileQueryEntry[] = []
  let nextAfterPath: string | undefined
  for (const entry of entries) {
    if (files.length === input.limit || JSON.stringify({ files: [...files, entry], nextAfterPath: entry.relativePath }).length > WORKSPACE_QUERY_PAGE_CHARS) {
      if (!files.length) throw invalid('A workspace entry exceeds the page budget.')
      nextAfterPath = files[files.length - 1].relativePath
      break
    }
    files.push(entry)
  }
  return { files, ...(nextAfterPath ? { nextAfterPath } : {}) }
}

function invalid(message: string) { return new BuiltInCapabilityPolicyError('schema_invalid', message) }

/** SQLite UTF-8 BINARY order differs from JavaScript UTF-16 order for emoji. */
export function compareWorkspacePaths(left: string, right: string): number {
  const a = Array.from(left); const b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!
    if (difference) return difference
  }
  return a.length - b.length
}
