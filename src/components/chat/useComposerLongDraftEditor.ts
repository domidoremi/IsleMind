import { useCallback, useEffect, useRef, useState } from 'react'
import type { TextInput } from 'react-native'

import {
  createComposerEditHistory,
  recordComposerEdit,
  redoComposerEdit,
  resetComposerEditHistory,
  undoComposerEdit,
  type ComposerEditHistory,
  type ComposerEditKind,
} from './composerEditHistory'
import {
  applyComposerMarkdownAction,
  normalizeComposerSelection,
  type ComposerMarkdownAction,
  type ComposerTextSelection,
} from './composerMarkdownEditing'
import {
  createComposerSizeState,
  resolveComposerSizeState,
  type ComposerSizeEvent,
  type ComposerSizeState,
} from './composerLongDraftState'

export interface ComposerSendRecovery {
  sizeState: ComposerSizeState
  history: ComposerEditHistory
  selection: ComposerTextSelection
  text: string
}

interface UseComposerLongDraftEditorInput {
  value: string
  onValueChange: (value: string) => void
  markDraftChanged: () => void
  lineHeight: number
  verticalPadding: number
  now?: () => number
}

function nextTypingSelection(
  previousText: string,
  nextText: string,
  selection: ComposerTextSelection,
): ComposerTextSelection {
  const selectedLength = selection.end - selection.start
  const insertedLength = Math.max(
    0,
    nextText.length - (previousText.length - selectedLength),
  )
  const cursor = Math.min(nextText.length, selection.start + insertedLength)
  return { start: cursor, end: cursor }
}

function editKind(
  previousText: string,
  nextText: string,
  selection: ComposerTextSelection,
): ComposerEditKind {
  const replacedLength = selection.end - selection.start
  const insertedLength = Math.max(
    0,
    nextText.length - (previousText.length - replacedLength),
  )
  return insertedLength >= 8 ? 'paste' : 'typing'
}

export function useComposerLongDraftEditor({
  value,
  onValueChange,
  markDraftChanged,
  lineHeight,
  verticalPadding,
  now = Date.now,
}: UseComposerLongDraftEditorInput) {
  const inputRef = useRef<TextInput>(null)
  const valueRef = useRef(value)
  const selectionRef = useRef<ComposerTextSelection>({
    start: value.length,
    end: value.length,
  })
  const [selection, setSelection] = useState(selectionRef.current)
  const initialHistory = createComposerEditHistory({
    text: value,
    selection: selectionRef.current,
  })
  const historyRef = useRef(initialHistory)
  const [history, setHistory] = useState(initialHistory)
  const initialSizeState = createComposerSizeState()
  const sizeStateRef = useRef(initialSizeState)
  const [sizeState, setSizeState] = useState(initialSizeState)
  const sendPendingRef = useRef(false)
  const newDraftDuringSendRef = useRef(false)

  const updateHistory = useCallback((next: ComposerEditHistory) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const updateSize = useCallback((next: ComposerSizeState) => {
    sizeStateRef.current = next
    setSizeState(next)
  }, [])

  const changeSelection = useCallback((next: ComposerTextSelection) => {
    const normalized = normalizeComposerSelection(next, valueRef.current.length)
    selectionRef.current = normalized
    historyRef.current = {
      ...historyRef.current,
      present: {
        text: valueRef.current,
        selection: normalized,
      },
    }
    setSelection(normalized)
  }, [])

  const focusAfterTool = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const resolveSize = useCallback((
    event: ComposerSizeEvent,
    measuredContentHeight = sizeStateRef.current.lastValidContentHeight,
  ) => {
    if (
      sendPendingRef.current &&
      !newDraftDuringSendRef.current &&
      event === 'measure'
    ) return
    updateSize(resolveComposerSizeState({
      content: valueRef.current,
      measuredContentHeight,
      lineHeight,
      verticalPadding,
      state: sizeStateRef.current,
      event,
    }))
  }, [lineHeight, updateSize, verticalPadding])

  const commitSnapshot = useCallback((
    text: string,
    nextSelection: ComposerTextSelection,
    kind: ComposerEditKind,
    refocus: boolean,
  ) => {
    const normalized = normalizeComposerSelection(nextSelection, text.length)
    const nextHistory = recordComposerEdit(
      historyRef.current,
      { text, selection: normalized },
      { kind, timestamp: now() },
    )
    valueRef.current = text
    selectionRef.current = normalized
    setSelection(normalized)
    updateHistory(nextHistory)
    markDraftChanged()
    onValueChange(text)
    if (refocus) focusAfterTool()
  }, [
    focusAfterTool,
    markDraftChanged,
    now,
    onValueChange,
    updateHistory,
  ])

  const changeText = useCallback((nextText: string) => {
    const previousText = valueRef.current
    if (sendPendingRef.current && !newDraftDuringSendRef.current) {
      const empty = { text: '', selection: { start: 0, end: 0 } }
      updateHistory(createComposerEditHistory(empty))
      updateSize(createComposerSizeState())
      newDraftDuringSendRef.current = true
    }
    commitSnapshot(
      nextText,
      nextTypingSelection(previousText, nextText, selectionRef.current),
      editKind(previousText, nextText, selectionRef.current),
      false,
    )
  }, [commitSnapshot, updateHistory, updateSize])

  const applyHistory = useCallback((next: ComposerEditHistory) => {
    if (next === historyRef.current) return
    updateHistory(next)
    valueRef.current = next.present.text
    changeSelection(next.present.selection)
    markDraftChanged()
    onValueChange(next.present.text)
    focusAfterTool()
  }, [
    changeSelection,
    focusAfterTool,
    markDraftChanged,
    onValueChange,
    updateHistory,
  ])

  useEffect(() => {
    if (valueRef.current === value) return
    valueRef.current = value
    const externalSelection = {
      start: value.length,
      end: value.length,
    }
    changeSelection(externalSelection)
    if (!sendPendingRef.current) {
      updateHistory(resetComposerEditHistory(
        historyRef.current,
        { text: value, selection: externalSelection },
      ))
    }
  }, [changeSelection, updateHistory, value])

  return {
    inputRef,
    selection,
    sizeState,
    sizeMode: sizeState.mode,
    visualLineCount: sizeState.visualLineCount,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    currentText: () => valueRef.current,
    refocus: focusAfterTool,
    changeSelection,
    changeText,
    measureContentHeight: (height: number) => resolveSize('measure', height),
    notifyBlur: () => resolveSize('blur'),
    notifyKeyboardHide: () => resolveSize('keyboard-hide'),
    expandLarge: () => resolveSize('manual-expand'),
    collapseLarge: () => resolveSize('manual-collapse'),
    applyMarkdown: (action: ComposerMarkdownAction) => {
      const edit = applyComposerMarkdownAction(
        valueRef.current,
        selectionRef.current,
        action,
      )
      commitSnapshot(edit.text, edit.selection, 'tool', true)
    },
    undo: () => applyHistory(undoComposerEdit(historyRef.current)),
    redo: () => applyHistory(redoComposerEdit(historyRef.current)),
    captureSendRecovery: (): ComposerSendRecovery => ({
      sizeState: sizeStateRef.current,
      history: historyRef.current,
      selection: selectionRef.current,
      text: valueRef.current,
    }),
    beginOptimisticSend: () => {
      sendPendingRef.current = true
      newDraftDuringSendRef.current = false
      valueRef.current = ''
      changeSelection({ start: 0, end: 0 })
      onValueChange('')
    },
    completeSuccessfulSend: () => {
      sendPendingRef.current = false
      if (valueRef.current.length === 0) {
        const empty = { text: '', selection: { start: 0, end: 0 } }
        updateHistory(resetComposerEditHistory(historyRef.current, empty))
        updateSize(createComposerSizeState())
      }
      newDraftDuringSendRef.current = false
    },
    restoreRejectedSend: (recovery: ComposerSendRecovery, restoredText: string) => {
      sendPendingRef.current = false
      const restoringOriginal = restoredText === recovery.text
      valueRef.current = restoredText
      const restoredSelection = normalizeComposerSelection(
        restoringOriginal
          ? recovery.selection
          : { start: restoredText.length, end: restoredText.length },
        restoredText.length,
      )
      changeSelection(restoredSelection)
      updateHistory(restoringOriginal
        ? recovery.history
        : createComposerEditHistory({
          text: restoredText,
          selection: restoredSelection,
        }))
      if (restoringOriginal) updateSize(recovery.sizeState)
      newDraftDuringSendRef.current = false
      markDraftChanged()
      onValueChange(restoredText)
    },
    clearText: () => {
      sendPendingRef.current = false
      valueRef.current = ''
      const empty = { text: '', selection: { start: 0, end: 0 } }
      changeSelection(empty.selection)
      updateHistory(resetComposerEditHistory(historyRef.current, empty))
      updateSize(createComposerSizeState())
      markDraftChanged()
      onValueChange('')
      focusAfterTool()
    },
  }
}
