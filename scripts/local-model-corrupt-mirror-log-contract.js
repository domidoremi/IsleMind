const localModelCorruptMirrorLogName = 'local-model-corrupt-mirror-requests.jsonl'
const requiredLocalModelCorruptMirrorFiles = [
  'config.json',
  'special_tokens_map.json',
]

function createLocalModelCorruptMirrorRowsFixture() {
  return [
    {
      timestamp: '2026-01-01T00:00:00.000Z',
      method: 'GET',
      relative: 'config.json',
      status: 200,
    },
    {
      timestamp: '2026-01-01T00:00:01.000Z',
      method: 'GET',
      relative: 'special_tokens_map.json',
      status: 200,
    },
    {
      timestamp: '2026-01-01T00:00:02.000Z',
      method: 'GET',
      relative: 'model_quantized.onnx',
      status: 500,
      error: 'corrupt mirror fixture',
    },
  ]
}

function validateLocalModelCorruptMirrorRows(rows) {
  const issues = []
  if (!Array.isArray(rows) || !rows.length) return ['Local-model corrupt mirror request log has no rows.']
  const relatives = new Set(rows.map((row) => String(row?.relative ?? '').replace(/\\/g, '/')))
  for (const relative of requiredLocalModelCorruptMirrorFiles) {
    if (!relatives.has(relative)) {
      issues.push(`Local-model corrupt mirror request log is missing ${relative}.`)
    }
  }
  return issues
}

function summarizeLocalModelCorruptMirrorRows(rows) {
  const count = Array.isArray(rows) ? rows.length : 0
  const relatives = Array.isArray(rows) ? new Set(rows.map((row) => row?.relative).filter(Boolean)) : new Set()
  return `${count} requests, ${relatives.size} unique files`
}

module.exports = {
  createLocalModelCorruptMirrorRowsFixture,
  localModelCorruptMirrorLogName,
  requiredLocalModelCorruptMirrorFiles,
  summarizeLocalModelCorruptMirrorRows,
  validateLocalModelCorruptMirrorRows,
}
