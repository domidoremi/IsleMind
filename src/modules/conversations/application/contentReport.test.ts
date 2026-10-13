import { CONTENT_REPORT_EXCERPT_LIMIT, ContentReportError, contentReportExcerpt, parseContentReportConfiguration,
  prepareContentReport, validateContentReport } from './contentReport'

const configuration = { endpoint: 'https://reports.islemind.org/v1/reports', operator: 'Synthetic test operator', privacyPolicyUrl: 'https://reports.islemind.org/privacy' }
const id = '12345678-1234-4567-89ab-123456789abc'
const draft = { excerpt: 'Synthetic answer', reason: 'other' as const, note: '' }

it('disables incomplete or unsafe build configurations without inventing an endpoint', () => {
  for (const value of [undefined, null, {}, { ...configuration, operator: '' }, { ...configuration, privacyPolicyUrl: undefined },
    ...['http://reports.islemind.org/report', 'https://127.0.0.1/report', 'https://[::1]/report', 'https://localhost/report',
      'https://reports.internal/report', 'https://reports.local/report', 'https://example.com/report', 'https://report.test/report',
      'https://user:password@reports.islemind.org/report', 'https://reports.islemind.org:444/report',
      'https://reports.islemind.org/report?key=secret', 'https://reports.islemind.org/report#fragment',
      'https://reports.islemind.org/\nreport'].map(endpoint => ({ ...configuration, endpoint }))]) {
    expect(parseContentReportConfiguration(value)).toBeNull()
  }
  expect(parseContentReportConfiguration(configuration)).toEqual(configuration)
  expect(Object.isFrozen(parseContentReportConfiguration(configuration))).toBe(true)
})

it('redacts before truncating and avoids split Unicode characters', () => {
  expect(contentReportExcerpt('answer sk-syntheticsecret123')).toBe('answer [redacted]')
  expect(contentReportExcerpt(`${'a'.repeat(CONTENT_REPORT_EXCERPT_LIMIT - 1)}😀`)).toBe('a'.repeat(CONTENT_REPORT_EXCERPT_LIMIT - 1))
})

it('prepares only the disclosed fields without mutating the draft', () => {
  const input = { ...draft, history: ['private'], deviceId: 'private', provider: { apiKey: 'private' } }
  const report = prepareContentReport(input, id, '1.1.2')
  expect(report).toEqual({ schemaVersion: 1, reportId: id, appVersion: '1.1.2', ...draft })
  expect(Object.isFrozen(report)).toBe(true)
  expect(input.history).toEqual(['private'])
  expect(() => validateContentReport({ ...report, history: [] } as typeof report)).toThrow(new ContentReportError('invalid'))
})

it('rejects edited secrets without silently changing the confirmed payload', () => {
  for (const field of ['excerpt', 'note']) {
    expect(() => prepareContentReport({ ...draft, [field]: 'Bearer syntheticcredential1234' }, id, '1.1.2')).toThrow(new ContentReportError('sensitive'))
  }
})

it('enforces identities, schema, reasons and field limits again at submission', () => {
  const report = prepareContentReport(draft, id, '1.1.2')
  for (const change of [{ schemaVersion: 2 }, { reportId: 'device-identifier' }, { appVersion: 'bad\nversion' },
    { reason: 'unknown' }, { excerpt: '' }, { excerpt: ' '.repeat(10) }, { excerpt: 'x'.repeat(4001) }, { note: 'x'.repeat(1001) }]) {
    expect(() => validateContentReport({ ...report, ...change } as typeof report)).toThrow(new ContentReportError('invalid'))
  }
  expect(prepareContentReport({ ...draft, excerpt: 'x'.repeat(4000), note: 'x'.repeat(1000) }, id, '1.1.2')).toBeDefined()
})
