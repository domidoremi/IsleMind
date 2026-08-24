import type { ComposerTextSelection } from './composerMarkdownEditing'

export const COMPOSER_EDIT_HISTORY_LIMIT = 50
export const COMPOSER_TYPING_MERGE_MS = 600

export interface ComposerEditSnapshot {
  text: string
  selection: ComposerTextSelection
}

export type ComposerEditKind = 'typing' | 'paste' | 'tool' | 'external'

export interface ComposerEditHistory {
  past: ComposerEditSnapshot[]
  present: ComposerEditSnapshot
  future: ComposerEditSnapshot[]
  lastEditKind: ComposerEditKind | null
  lastEditAt: number | null
}

export interface RecordComposerEditOptions {
  kind: ComposerEditKind
  timestamp: number
}

function sameSnapshot(
  left: ComposerEditSnapshot,
  right: ComposerEditSnapshot,
): boolean {
  return (
    left.text === right.text &&
    left.selection.start === right.selection.start &&
    left.selection.end === right.selection.end
  )
}

export function createComposerEditHistory(
  initial: ComposerEditSnapshot,
): ComposerEditHistory {
  return {
    past: [],
    present: initial,
    future: [],
    lastEditKind: null,
    lastEditAt: null,
  }
}

export function resetComposerEditHistory(
  _history: ComposerEditHistory,
  snapshot: ComposerEditSnapshot,
): ComposerEditHistory {
  return createComposerEditHistory(snapshot)
}

export function recordComposerEdit(
  history: ComposerEditHistory,
  snapshot: ComposerEditSnapshot,
  options: RecordComposerEditOptions,
): ComposerEditHistory {
  if (sameSnapshot(history.present, snapshot)) return history
  const mergeTyping =
    options.kind === 'typing' &&
    history.lastEditKind === 'typing' &&
    history.lastEditAt !== null &&
    options.timestamp - history.lastEditAt <= COMPOSER_TYPING_MERGE_MS &&
    options.timestamp >= history.lastEditAt &&
    history.future.length === 0
  const nextPast = mergeTyping
    ? history.past
    : [...history.past, history.present].slice(-COMPOSER_EDIT_HISTORY_LIMIT)
  return {
    past: nextPast,
    present: snapshot,
    future: [],
    lastEditKind: options.kind,
    lastEditAt: options.timestamp,
  }
}

export function undoComposerEdit(history: ComposerEditHistory): ComposerEditHistory {
  if (history.past.length === 0) return history
  const present = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present,
    future: [history.present, ...history.future],
    lastEditKind: null,
    lastEditAt: null,
  }
}

export function redoComposerEdit(history: ComposerEditHistory): ComposerEditHistory {
  if (history.future.length === 0) return history
  const present = history.future[0]
  return {
    past: [...history.past, history.present].slice(-COMPOSER_EDIT_HISTORY_LIMIT),
    present,
    future: history.future.slice(1),
    lastEditKind: null,
    lastEditAt: null,
  }
}
