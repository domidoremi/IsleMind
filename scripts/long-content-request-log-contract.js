const longContentRequestLogName = 'long-content-mock-openai-requests.jsonl'
const longContentModelName = 'qa-ultra-long-model-name'

function createLongContentRequestRowsFixture() {
  return [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      method: 'POST',
      path: '/v1/chat/completions',
      body: `{"model":"${longContentModelName}","stream":true,"messages":[{"role":"user","content":"QA long content prompt"}]}`,
    },
    {
      timestamp: '2026-01-01T00:00:01.000Z',
      method: 'POST',
      path: '/v1/chat/completions',
      body: `{"model":"${longContentModelName}","stream":false,"max_tokens":512,"messages":[{"role":"system","content":"extract memory"}]}`,
    },
  ]
}

function validateLongContentRequestRows(rows) {
  const issues = []
  if (!Array.isArray(rows) || !rows.length) return ['Long-content request log has no rows.']
  if (!rows.some((row) => requestBody(row).includes(longContentModelName))) {
    issues.push(`Long-content request log does not include ${longContentModelName}.`)
  }
  if (!rows.some((row) => isPost(row) && requestBody(row).includes('"stream":true'))) {
    issues.push('Long-content request log is missing a streaming long-content request.')
  }
  if (!rows.some((row) => isPost(row) && requestBody(row).includes('"max_tokens":512'))) {
    issues.push('Long-content request log is missing a memory extraction request.')
  }
  return issues
}

function requestBody(row) {
  if (typeof row?.body === 'string') return row.body
  if (row?.body && typeof row.body === 'object') return JSON.stringify(row.body)
  return ''
}

function isPost(row) {
  return String(row?.method ?? '').toUpperCase() === 'POST'
}

module.exports = {
  createLongContentRequestRowsFixture,
  longContentModelName,
  longContentRequestLogName,
  validateLongContentRequestRows,
}
