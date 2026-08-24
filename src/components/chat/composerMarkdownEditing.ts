export interface ComposerTextSelection {
  start: number
  end: number
}

export interface ComposerTextEdit {
  text: string
  selection: ComposerTextSelection
}

export type ComposerMarkdownAction =
  | 'unordered-list'
  | 'ordered-list'
  | 'quote'
  | 'code-block'

interface TextReplacement {
  start: number
  end: number
  replacement: string
}

interface LineSpan {
  start: number
  end: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

export function normalizeComposerSelection(
  selection: ComposerTextSelection,
  textLength: number,
): ComposerTextSelection {
  const start = clamp(Math.min(selection.start, selection.end), 0, textLength)
  const end = clamp(Math.max(selection.start, selection.end), 0, textLength)
  return { start, end }
}

function collectLineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = []
  let lineStart = 0
  let index = 0
  while (index < text.length) {
    if (text[index] === '\r' || text[index] === '\n') {
      spans.push({ start: lineStart, end: index })
      if (text[index] === '\r' && text[index + 1] === '\n') index += 1
      lineStart = index + 1
    }
    index += 1
  }
  spans.push({ start: lineStart, end: text.length })
  return spans
}

function selectedLineSpans(text: string, selection: ComposerTextSelection): LineSpan[] {
  const spans = collectLineSpans(text)
  const effectiveEnd = selection.end > selection.start ? selection.end - 1 : selection.end
  return spans.filter((span) => span.end >= selection.start && span.start <= effectiveEnd)
}

function prefixPattern(action: Exclude<ComposerMarkdownAction, 'code-block'>): RegExp {
  if (action === 'unordered-list') return /^[-*+]\s+/
  if (action === 'ordered-list') return /^\d+[.)]\s+/
  return /^>\s?/
}

function listPrefixPattern(): RegExp {
  return /^(?:[-*+]\s+|\d+[.)]\s+)/
}

function canonicalPrefix(
  action: Exclude<ComposerMarkdownAction, 'code-block'>,
  lineIndex: number,
): string {
  if (action === 'unordered-list') return '- '
  if (action === 'ordered-list') return String(lineIndex + 1) + '. '
  return '> '
}

function mapPosition(position: number, replacements: TextReplacement[]): number {
  let mapped = position
  for (const edit of replacements) {
    if (position < edit.start) break
    if (position <= edit.end) {
      return edit.start + edit.replacement.length
    }
    mapped += edit.replacement.length - (edit.end - edit.start)
  }
  return mapped
}

function applyReplacements(text: string, replacements: TextReplacement[]): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, edit) =>
        current.slice(0, edit.start) + edit.replacement + current.slice(edit.end),
      text,
    )
}

function toggleLinePrefix(
  text: string,
  selection: ComposerTextSelection,
  action: Exclude<ComposerMarkdownAction, 'code-block'>,
): ComposerTextEdit {
  const spans = selectedLineSpans(text, selection)
  const targetPattern = prefixPattern(action)
  const allPrefixed = spans.every((span) => {
    const line = text.slice(span.start, span.end)
    const indentLength = line.match(/^[\t ]*/)?.[0].length ?? 0
    return targetPattern.test(line.slice(indentLength))
  })
  const replacements = spans.map((span, lineIndex): TextReplacement => {
    const line = text.slice(span.start, span.end)
    const indentLength = line.match(/^[\t ]*/)?.[0].length ?? 0
    const bodyStart = span.start + indentLength
    const body = line.slice(indentLength)
    const existing = (action === 'quote' ? targetPattern : listPrefixPattern()).exec(body)
    if (allPrefixed) {
      const target = targetPattern.exec(body)
      return {
        start: bodyStart,
        end: bodyStart + (target?.[0].length ?? 0),
        replacement: '',
      }
    }
    return {
      start: bodyStart,
      end: bodyStart + (existing?.[0].length ?? 0),
      replacement: canonicalPrefix(action, lineIndex),
    }
  }).sort((left, right) => left.start - right.start)

  const nextText = applyReplacements(text, replacements)
  const mappedStart = mapPosition(selection.start, replacements)
  const mappedEnd = mapPosition(selection.end, replacements)
  return {
    text: nextText,
    selection: normalizeComposerSelection(
      { start: mappedStart, end: mappedEnd },
      nextText.length,
    ),
  }
}

function preferredNewline(text: string): string {
  return text.match(/\r\n|\n|\r/)?.[0] ?? '\n'
}

function wrapCodeBlock(
  text: string,
  selection: ComposerTextSelection,
): ComposerTextEdit {
  const newline = preferredNewline(text)
  const before = text.slice(0, selection.start)
  const after = text.slice(selection.end)
  const leading =
    before.length > 0 && !/(?:\r\n|\n|\r)$/.test(before) ? newline : ''
  const trailing =
    after.length > 0 && !/^(?:\r\n|\n|\r)/.test(after) ? newline : ''
  const opening = leading + '```' + newline
  const closing = newline + '```' + trailing
  if (selection.start === selection.end) {
    const insertion = opening + closing
    const nextText =
      text.slice(0, selection.start) + insertion + text.slice(selection.end)
    const cursor = selection.start + opening.length
    return { text: nextText, selection: { start: cursor, end: cursor } }
  }
  const selectedText = text.slice(selection.start, selection.end)
  const replacement = opening + selectedText + closing
  const nextText =
    text.slice(0, selection.start) + replacement + text.slice(selection.end)
  return {
    text: nextText,
    selection: {
      start: selection.start + opening.length,
      end: selection.start + opening.length + selectedText.length,
    },
  }
}

export function applyComposerMarkdownAction(
  text: string,
  selection: ComposerTextSelection,
  action: ComposerMarkdownAction,
): ComposerTextEdit {
  const normalized = normalizeComposerSelection(selection, text.length)
  return action === 'code-block'
    ? wrapCodeBlock(text, normalized)
    : toggleLinePrefix(text, normalized, action)
}
