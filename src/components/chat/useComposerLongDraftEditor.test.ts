import { act, renderHook } from '@testing-library/react-native'
import { useState } from 'react'

import { useComposerLongDraftEditor } from './useComposerLongDraftEditor'

function useHarness(
  initialValue: string,
  onValueChange: (value: string) => void = jest.fn(),
  now: () => number = Date.now,
) {
  const [value, setValue] = useState(initialValue)
  const editor = useComposerLongDraftEditor({
    value,
    onValueChange(nextValue) {
      onValueChange(nextValue)
      setValue(nextValue)
    },
    markDraftChanged: jest.fn(),
    lineHeight: 22,
    verticalPadding: 16,
    now,
  })
  return { value, editor }
}

describe('useComposerLongDraftEditor', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(async () => {
    await act(async () => jest.runOnlyPendingTimers())
    jest.useRealTimers()
  })

  it('keeps Review and Large after blur or keyboard hide', async () => {
    const { result } = await renderHook(() => useHarness('draft'))
    await act(async () => result.current.editor.measureContentHeight(4 * 22 + 16))
    expect(result.current.editor.sizeMode).toBe('review')
    await act(async () => result.current.editor.notifyBlur())
    expect(result.current.editor.sizeMode).toBe('review')
    await act(async () => result.current.editor.measureContentHeight(8 * 22 + 16))
    expect(result.current.editor.sizeMode).toBe('large')
    await act(async () => result.current.editor.notifyKeyboardHide())
    expect(result.current.editor.sizeMode).toBe('large')
  })

  it('holds Review after manual collapse until the draft becomes short', async () => {
    const { result } = await renderHook(() => useHarness('long draft'))
    await act(async () => result.current.editor.measureContentHeight(8 * 22 + 16))
    await act(async () => result.current.editor.collapseLarge())
    await act(async () => result.current.editor.measureContentHeight(12 * 22 + 16))
    expect(result.current.editor.sizeMode).toBe('review')

    await act(async () => result.current.editor.changeText('short'))
    await act(async () => result.current.editor.measureContentHeight(2 * 22 + 16))
    expect(result.current.editor.sizeMode).toBe('compact')
  })

  it('applies a Markdown action as an independent undo checkpoint', async () => {
    let now = 100
    const onValueChange = jest.fn()
    const { result } = await renderHook(() =>
      useHarness('alpha', onValueChange, () => now)
    )
    await act(async () =>
      result.current.editor.changeSelection({ start: 0, end: 5 })
    )
    await act(async () => result.current.editor.applyMarkdown('quote'))
    expect(result.current.value).toBe('> alpha')
    expect(onValueChange).toHaveBeenLastCalledWith('> alpha')

    now += 1
    await act(async () => result.current.editor.undo())
    expect(result.current.value).toBe('alpha')
    expect(result.current.editor.selection).toEqual({ start: 0, end: 5 })
    expect(onValueChange).toHaveBeenLastCalledWith('alpha')
  })

  it('restores the prior Large geometry after a rejected optimistic send', async () => {
    const onValueChange = jest.fn()
    const { result } = await renderHook(() =>
      useHarness('eight-line draft', onValueChange)
    )
    await act(async () => result.current.editor.measureContentHeight(8 * 22 + 16))
    const recovery = result.current.editor.captureSendRecovery()
    await act(async () => result.current.editor.beginOptimisticSend())
    expect(result.current.value).toBe('')
    expect(result.current.editor.sizeMode).toBe('large')

    await act(async () =>
      result.current.editor.restoreRejectedSend(
        recovery,
        'eight-line draft',
      )
    )
    expect(result.current.value).toBe('eight-line draft')
    expect(result.current.editor.sizeMode).toBe('large')
  })

  it('does not clear or resize a new draft when an earlier send completes', async () => {
    const onValueChange = jest.fn()
    const { result } = await renderHook(() =>
      useHarness('sent text', onValueChange)
    )
    await act(async () => result.current.editor.beginOptimisticSend())
    await act(async () =>
      result.current.editor.changeText('next\ndraft\nkeeps\nreview')
    )
    await act(async () => result.current.editor.measureContentHeight(4 * 22 + 16))
    expect(result.current.editor.sizeMode).toBe('review')
    await act(async () => result.current.editor.completeSuccessfulSend())
    expect(result.current.value).toBe('next\ndraft\nkeeps\nreview')
    expect(result.current.editor.currentText())
      .toBe('next\ndraft\nkeeps\nreview')
    expect(result.current.editor.sizeMode).toBe('review')
  })

  it('clears text and history without touching attachment state', async () => {
    const onValueChange = jest.fn()
    const { result } = await renderHook(() => useHarness('draft', onValueChange))
    await act(async () => result.current.editor.changeText('draft!'))
    expect(result.current.editor.canUndo).toBe(true)
    await act(async () => result.current.editor.clearText())
    expect(result.current.value).toBe('')
    expect(onValueChange).toHaveBeenLastCalledWith('')
    expect(result.current.editor.sizeMode).toBe('compact')
    expect(result.current.editor.canUndo).toBe(false)
  })
})
