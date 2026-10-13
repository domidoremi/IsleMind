import { containsSensitiveText, redactSensitiveText } from '@/core/trace'

export const CONTENT_REPORT_EXCERPT_LIMIT = 4000
export const CONTENT_REPORT_NOTE_LIMIT = 1000
export const CONTENT_REPORT_REASONS = ['child_safety', 'hate_harassment', 'sexual_content', 'dangerous_content', 'privacy', 'other'] as const
export type ContentReportReason = typeof CONTENT_REPORT_REASONS[number]
export interface ContentReportDraft { excerpt: string; reason: ContentReportReason; note: string }
export interface ContentReport extends ContentReportDraft {
  schemaVersion: 1
  reportId: string
  appVersion: string
}
export interface ContentReportConfiguration { endpoint: string; operator: string; privacyPolicyUrl: string }
export type ContentReportErrorCode = 'unavailable' | 'invalid' | 'sensitive' | 'failed' | 'timeout' | 'cancelled'
export class ContentReportError extends Error {
  constructor(readonly code: ContentReportErrorCode) { super(code); this.name = 'ContentReportError' }
}
export interface ContentReporting {
  readonly configuration: Readonly<ContentReportConfiguration> | null
  prepare(draft: ContentReportDraft): Readonly<ContentReport>
  submit(report: Readonly<ContentReport>, signal: AbortSignal): Promise<void>
}

// Build-owned destinations only. This is syntax validation, not DNS or operator verification.
function reportingUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/u.test(value)) return false
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash
      && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/u.test(host)
      && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
      && !/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/u.test(host)
      && !/(?:^|\.)example\.(?:com|net|org)$/u.test(host)
  } catch { return false }
}

export function parseContentReportConfiguration(value: unknown): Readonly<ContentReportConfiguration> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (!reportingUrl(input.endpoint) || !reportingUrl(input.privacyPolicyUrl)
    || typeof input.operator !== 'string' || !input.operator.trim() || input.operator.length > 160
    || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(input.operator)
    || containsSensitiveText(input.operator)) return null
  return Object.freeze({ endpoint: new URL(input.endpoint).href, operator: input.operator.trim(), privacyPolicyUrl: new URL(input.privacyPolicyUrl).href })
}

/** Input must already be the visible answer, never a trace/history/attachment. Redaction is best effort. */
export function contentReportExcerpt(visibleAnswer: string): string {
  const excerpt = redactSensitiveText(visibleAnswer).slice(0, CONTENT_REPORT_EXCERPT_LIMIT)
  // Avoid a dangling UTF-16 high surrogate at the truncation boundary.
  return excerpt.replace(/[\ud800-\udbff]$/u, '')
}

export function validateContentReport(report: ContentReport): void {
  const keys = ['schemaVersion', 'reportId', 'appVersion', 'reason', 'excerpt', 'note']
  if (!report || Object.keys(report).length !== keys.length || Object.keys(report).some(key => !keys.includes(key))
    || report.schemaVersion !== 1 || typeof report.reportId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(report.reportId)
    || typeof report.appVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/iu.test(report.appVersion) || report.appVersion.length > 64
    || !CONTENT_REPORT_REASONS.includes(report.reason)
    || typeof report.excerpt !== 'string' || !report.excerpt.trim() || report.excerpt.length > CONTENT_REPORT_EXCERPT_LIMIT
    || typeof report.note !== 'string' || report.note.length > CONTENT_REPORT_NOTE_LIMIT) throw new ContentReportError('invalid')
  if (containsSensitiveText(report.excerpt) || containsSensitiveText(report.note)) throw new ContentReportError('sensitive')
}

export function prepareContentReport(draft: ContentReportDraft, reportId: string, appVersion: string): Readonly<ContentReport> {
  // Explicit allowlist: extra properties on the caller's object never cross the boundary.
  const report: ContentReport = { schemaVersion: 1, reportId, appVersion, reason: draft.reason, excerpt: draft.excerpt, note: draft.note }
  validateContentReport(report)
  return Object.freeze(report)
}
