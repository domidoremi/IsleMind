import {
  COMPOSER_EDIT_HISTORY_LIMIT,
  COMPOSER_TYPING_MERGE_MS,
  createComposerEditHistory,
  recordComposerEdit,
  redoComposerEdit,
  resetComposerEditHistory,
  undoComposerEdit,
} from './composerEditHistory'

const snapshot = (text: string) => ({
  text,
  selection: { start: text.length, end: text.length },
})

describe('composerEditHistory', () => {
  it('merges ordinary typing within 600ms', () => {
    let history = createComposerEditHistory(snapshot(''))
    history = recordComposerEdit(history, snapshot('a'), { kind: 'typing', timestamp: 100 })
    history = recordComposerEdit(history, snapshot('ab'), {
      kind: 'typing',
      timestamp: 100 + COMPOSER_TYPING_MERGE_MS,
    })
    expect(history.past).toEqual([snapshot('')])
    expect(undoComposerEdit(history).present).toEqual(snapshot(''))
  })

  it('keeps paste and Markdown actions as independent checkpoints', () => {
    let history = createComposerEditHistory(snapshot('a'))
    history = recordComposerEdit(history, snapshot('a pasted block'), {
      kind: 'paste',
      timestamp: 10,
    })
    history = recordComposerEdit(history, snapshot('> a pasted block'), {
      kind: 'tool',
      timestamp: 11,
    })
    expect(history.past).toEqual([snapshot('a'), snapshot('a pasted block')])
  })

  it('clears redo after editing an undone state', () => {
    let history = createComposerEditHistory(snapshot(''))
    history = recordComposerEdit(history, snapshot('a'), { kind: 'typing', timestamp: 0 })
    history = recordComposerEdit(history, snapshot('ab'), { kind: 'typing', timestamp: 1000 })
    history = undoComposerEdit(history)
    expect(history.future).toHaveLength(1)
    history = recordComposerEdit(history, snapshot('ax'), { kind: 'typing', timestamp: 2000 })
    expect(history.future).toHaveLength(0)
    expect(redoComposerEdit(history).present).toEqual(snapshot('ax'))
  })

  it('retains at most 50 undo snapshots', () => {
    let history = createComposerEditHistory(snapshot('0'))
    for (let index = 1; index <= COMPOSER_EDIT_HISTORY_LIMIT + 5; index += 1) {
      history = recordComposerEdit(history, snapshot(String(index)), {
        kind: 'tool',
        timestamp: index,
      })
    }
    expect(history.past).toHaveLength(COMPOSER_EDIT_HISTORY_LIMIT)
    expect(history.past[0]).toEqual(snapshot('5'))
  })

  it('resets without creating an undo checkpoint', () => {
    let history = createComposerEditHistory(snapshot('draft'))
    history = recordComposerEdit(history, snapshot('draft!'), { kind: 'typing', timestamp: 1 })
    expect(resetComposerEditHistory(history, snapshot(''))).toEqual(
      createComposerEditHistory(snapshot('')),
    )
  })
})
