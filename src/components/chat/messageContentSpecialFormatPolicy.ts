const BARE_SNAKE_CASE_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9$]*(?:_[A-Za-z0-9$]+)+$/
const EXPLICIT_LATEX_STRUCTURE_PATTERN = /\\(?:frac|sqrt|sum|int|lim|prod|left|right|begin|end)(?=[^A-Za-z]|$)/
const COMPLEX_UNICODE_FORMULA_PATTERN = /[√∫∮∑∏∂∇∞]/
const SCIENTIFIC_FUNCTION_PATTERN = /\b(?:sin|cos|tan|cot|log|ln|exp)\s*(?:\(|\\left)/i
const GROUPED_SCRIPT_PATTERN = /(?:\^|_)\{[^}\n]{1,64}\}/
const RELATION_FORMULA_PATTERN = /(?:<=|>=|!=|=|->|=>|\\to)/
const INFIX_FORMULA_PATTERN = /[A-Za-z0-9}\])]\s*(?:[+*/^]|-(?!>))\s*[A-Za-z0-9{(\\[]/
const DISPLAY_FORMULA_DELIMITER_PATTERN = /(?:\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/
const DISPLAY_FORMULA_FENCE_PATTERN = /(?:```|~~~)[ \t]*(?:math|latex|tex|formula|equation)\b[\s\S]*?(?:```|~~~)/i
const NATURAL_LANGUAGE_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/
const BROWSER_USER_AGENT_LINE_PATTERN = /^Mozilla\/5\.0\b/i
const VERSIONED_CLIENT_USER_AGENT_LINE_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*(?: [A-Za-z][A-Za-z0-9._-]*)?\/\d+(?:\.\d+){1,3}\b(?:\s+\([^\r\n)]{1,160}\))?(?:\s+[A-Za-z][A-Za-z0-9._-]*\/\d+(?:\.\d+){1,3})?$/
const COMPATIBLE_CLIENT_USER_AGENT_LINE_PATTERN = /^[A-Za-z][A-Za-z0-9._ -]{0,48}\/[A-Za-z0-9._-]{1,32}\s+\(compatible;\s*[A-Za-z][A-Za-z0-9._ -]{0,48}\/\d+(?:\.\d+){1,3}\)$/i
const HISTORICAL_ISLEMIND_USER_AGENT_LINE_PATTERN = /^IsleMind(?:\/\S+)?(?:\s|$)/i

function looksLikeUserAgentLine(value: string): boolean {
  return BROWSER_USER_AGENT_LINE_PATTERN.test(value)
    || VERSIONED_CLIENT_USER_AGENT_LINE_PATTERN.test(value)
    || COMPATIBLE_CLIENT_USER_AGENT_LINE_PATTERN.test(value)
    || HISTORICAL_ISLEMIND_USER_AGENT_LINE_PATTERN.test(value)
}

export function looksLikeBareSnakeCaseIdentifier(value: string): boolean {
  return BARE_SNAKE_CASE_IDENTIFIER_PATTERN.test(value.trim())
}

export function hasUnambiguousPlainFormulaStructure(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || looksLikeBareSnakeCaseIdentifier(trimmed)) return false
  if (COMPLEX_UNICODE_FORMULA_PATTERN.test(trimmed)) return true
  if (EXPLICIT_LATEX_STRUCTURE_PATTERN.test(trimmed)) return true
  if (RELATION_FORMULA_PATTERN.test(trimmed)) return /[A-Za-z0-9\\]/.test(trimmed)
  return INFIX_FORMULA_PATTERN.test(trimmed)
}

export function hasComplexDisplayFormulaStructure(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 500 || looksLikeBareSnakeCaseIdentifier(trimmed)) return false
  if (EXPLICIT_LATEX_STRUCTURE_PATTERN.test(trimmed) || COMPLEX_UNICODE_FORMULA_PATTERN.test(trimmed)) return true
  if (GROUPED_SCRIPT_PATTERN.test(trimmed)) return true
  if (SCIENTIFIC_FUNCTION_PATTERN.test(trimmed) && /(?:=|[+\-*/^])/.test(trimmed)) return true

  const operatorCount = trimmed.match(/(?:<=|>=|!=|=|->|=>|\\to|[+\-*/^])/g)?.length ?? 0
  return trimmed.length >= 12 && operatorCount >= 3 && RELATION_FORMULA_PATTERN.test(trimmed)
}

export function containsDisplayFormulaBlock(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (DISPLAY_FORMULA_DELIMITER_PATTERN.test(trimmed) || DISPLAY_FORMULA_FENCE_PATTERN.test(trimmed)) return true

  return trimmed
    .split(/\r?\n/)
    .some((line) => !NATURAL_LANGUAGE_SCRIPT_PATTERN.test(line) && hasComplexDisplayFormulaStructure(line))
}

export function looksLikeUserAgentText(value: string): boolean {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return lines.length > 0 && lines.length <= 4 && lines.some(looksLikeUserAgentLine)
}

export function normalizeUserAgentText(value: string): string {
  return value.split(/\r?\n/).map((line) => line.replace(/^ {4}/, '')).join('\n').trim()
}

export function shouldRenderFencedUserAgentAsText(language: string | undefined, value: string): boolean {
  return !language && looksLikeUserAgentText(value)
}
