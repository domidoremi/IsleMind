import { applyComposerMarkdownAction } from './composerMarkdownEditing'

describe('applyComposerMarkdownAction', () => {
  it('adds, normalizes, then removes unordered prefixes on selected lines', () => {
    const source = 'alpha\r\n* beta\r\n🙂 gamma'
    const added = applyComposerMarkdownAction(
      source,
      { start: 0, end: source.length },
      'unordered-list',
    )
    expect(added.text).toBe('- alpha\r\n- beta\r\n- 🙂 gamma')
    expect(added.selection).toEqual({ start: 2, end: added.text.length })

    const removed = applyComposerMarkdownAction(
      added.text,
      { start: 0, end: added.text.length },
      'unordered-list',
    )
    expect(removed.text).toBe('alpha\r\nbeta\r\n🙂 gamma')
  })

  it('numbers every selected line and keeps LF', () => {
    const result = applyComposerMarkdownAction(
      'one\ntwo\nthree',
      { start: 0, end: 7 },
      'ordered-list',
    )
    expect(result.text).toBe('1. one\n2. two\nthree')
    expect(result.selection.end).toBe('1. one\n2. two'.length)
  })

  it('removes ordered prefixes when every selected line is already numbered', () => {
    const source = '1. one\n2. two'
    const result = applyComposerMarkdownAction(
      source,
      { start: 0, end: source.length },
      'ordered-list',
    )
    expect(result.text).toBe('one\ntwo')
  })

  it('toggles quote on the cursor line without touching neighbors', () => {
    const quoted = applyComposerMarkdownAction(
      'first\n中🙂文\nlast',
      { start: 9, end: 9 },
      'quote',
    )
    expect(quoted.text).toBe('first\n> 中🙂文\nlast')
    expect(quoted.selection).toEqual({ start: 11, end: 11 })

    const unquoted = applyComposerMarkdownAction(
      quoted.text,
      quoted.selection,
      'quote',
    )
    expect(unquoted.text).toBe('first\n中🙂文\nlast')
  })

  it('wraps a selection in fences and preserves its selection', () => {
    const source = '前🙂\nconst x = 1\n后'
    const start = source.indexOf('const')
    const end = start + 'const x = 1'.length
    const result = applyComposerMarkdownAction(source, { start, end }, 'code-block')
    expect(result.text).toBe('前🙂\n```\nconst x = 1\n```\n后')
    expect(result.text.slice(result.selection.start, result.selection.end)).toBe('const x = 1')
  })

  it('inserts paired fences at a collapsed cursor', () => {
    const result = applyComposerMarkdownAction('before', { start: 6, end: 6 }, 'code-block')
    expect(result.text).toBe('before\n```\n\n```')
    expect(result.selection).toEqual({ start: 11, end: 11 })
  })

  it('clamps malformed selections to the transformed text', () => {
    const result = applyComposerMarkdownAction('a', { start: -5, end: 99 }, 'quote')
    expect(result.text).toBe('> a')
    expect(result.selection.start).toBeGreaterThanOrEqual(0)
    expect(result.selection.end).toBeLessThanOrEqual(result.text.length)
  })
})
