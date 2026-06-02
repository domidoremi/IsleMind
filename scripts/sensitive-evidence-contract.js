const highEntropyCredentialAssignmentPattern = /(\b(?:api[_ -]?key|secret|token|password|credential|access[_ -]?token|refresh[_ -]?token)\b\s*[:=]\s*["']?)(?=[A-Za-z0-9+/_=-]{40,}\b)(?=[A-Za-z0-9+/_=-]*[a-z])(?=[A-Za-z0-9+/_=-]*[A-Z])(?=[A-Za-z0-9+/_=-]*\d)[A-Za-z0-9+/_=-]{40,}\b/gi

const sensitiveEvidencePatterns = [
  { label: 'OpenAI-style API key', redaction: 'openai-api-key', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'MiMo Token Plan API key', redaction: 'mimo-token-plan-key', pattern: /\btp-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'GitHub token', redaction: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { label: 'Google API key', redaction: 'google-api-key', pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/g },
  { label: 'Google OAuth access token', redaction: 'google-oauth-token', pattern: /\bya29\.[A-Za-z0-9_-]{20,}\b/g },
  { label: 'Bearer token', redaction: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}\b/g },
  { label: 'High-entropy credential assignment', redaction: 'credential', pattern: highEntropyCredentialAssignmentPattern },
]

const sensitiveEvidenceExtensions = new Set(['.json', '.jsonl', '.log', '.md', '.txt', '.xml'])

function maskSecret(value) {
  const compact = String(value).replace(/\s+/g, ' ')
  if (compact.length <= 12) return '*'.repeat(compact.length)
  return `${compact.slice(0, 6)}...${compact.slice(-4)}`
}

function collectSensitiveEvidenceHits(file, text) {
  const hits = []
  for (const { label, pattern } of sensitiveEvidencePatterns) {
    pattern.lastIndex = 0
    for (const match of String(text ?? '').matchAll(pattern)) {
      hits.push({
        file,
        label,
        sample: maskSecret(match[0]),
        index: match.index ?? 0,
      })
    }
  }
  return hits
}

function redactSensitiveEvidenceText(value) {
  let text = String(value ?? '')
  for (const { pattern, redaction } of sensitiveEvidencePatterns) {
    pattern.lastIndex = 0
    if (redaction === 'bearer-token') {
      text = text.replace(pattern, 'Bearer [redacted:bearer-token]')
      continue
    }
    if (redaction === 'credential') {
      text = text.replace(pattern, '$1[redacted:credential]')
      continue
    }
    text = text.replace(pattern, `[redacted:${redaction}]`)
  }
  return text
}

module.exports = {
  sensitiveEvidenceExtensions,
  sensitiveEvidencePatterns,
  maskSecret,
  collectSensitiveEvidenceHits,
  redactSensitiveEvidenceText,
}
