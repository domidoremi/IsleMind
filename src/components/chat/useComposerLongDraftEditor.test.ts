import { act, render, renderHook } from "@testing-library/react-native";
import { createElement, useLayoutEffect, useRef, useState } from "react";
import { View } from "react-native";

import { useComposerLongDraftEditor } from "./useComposerLongDraftEditor";

function useHarness(
  initialValue: string,
  onValueChange: (value: string) => void = jest.fn(),
  now: () => number = Date.now,
) {
  const [value, setValue] = useState(initialValue);
  const editor = useComposerLongDraftEditor({
    value,
    onValueChange(nextValue) {
      onValueChange(nextValue);
      setValue(nextValue);
    },
    markDraftChanged: jest.fn(),
    lineHeight: 22,
    verticalPadding: 16,
    now,
  });
  return { value, editor };
}

interface CommitMeasurement {
  value: string;
  currentText: string;
  height: number;
}

function NativeCommitMeasurement({
  value,
  height,
  editor,
  events,
}: {
  value: string;
  height: number | undefined;
  editor: ReturnType<typeof useComposerLongDraftEditor>;
  events: CommitMeasurement[];
}) {
  const previous = useRef<{ value: string; height: number } | null>(null);
  useLayoutEffect(() => {
    if (height === undefined) return;
    if (previous.current?.value === value && previous.current.height === height)
      return;
    // Native notifications are not repeated just because the editor size state rerenders.
    previous.current = { value, height };
    events.push({ value, currentText: editor.currentText(), height });
    editor.measureContentHeight(height);
  }, [editor, events, height, value]);
  return createElement(View);
}

async function renderCommitHarness(
  initialValue: string,
  heights: Record<string, number | undefined>,
) {
  const events: CommitMeasurement[] = [];
  const onValueChange = jest.fn();
  const markDraftChanged = jest.fn();
  let current!: {
    value: string;
    editor: ReturnType<typeof useComposerLongDraftEditor>;
    setExternalValue: (value: string) => void;
  };
  function Harness({ lineHeight = 22 }: { lineHeight?: number }) {
    const [value, setValue] = useState(initialValue);
    const editor = useComposerLongDraftEditor({
      value,
      onValueChange(nextValue) {
        onValueChange(nextValue);
        setValue(nextValue);
      },
      markDraftChanged,
      lineHeight,
      verticalPadding: 16,
    });
    useLayoutEffect(() => {
      current = { value, editor, setExternalValue: setValue };
    });
    return createElement(NativeCommitMeasurement, {
      value,
      height: heights[value],
      editor,
      events,
    });
  }
  const view = await render(createElement(Harness, {}));
  return {
    get current() {
      return current;
    },
    events,
    onValueChange,
    markDraftChanged,
    rerenderLineHeight: (lineHeight: number) =>
      view.rerender(createElement(Harness, { lineHeight })),
  };
}

describe("useComposerLongDraftEditor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => jest.runOnlyPendingTimers());
    jest.useRealTimers();
  });

  it("keeps Review and Large after blur or keyboard hide", async () => {
    const { result } = await renderHook(() => useHarness("draft"));
    await act(async () =>
      result.current.editor.measureContentHeight(4 * 22 + 16),
    );
    expect(result.current.editor.sizeMode).toBe("review");
    await act(async () => result.current.editor.notifyBlur());
    expect(result.current.editor.sizeMode).toBe("review");
    await act(async () =>
      result.current.editor.measureContentHeight(8 * 22 + 16),
    );
    expect(result.current.editor.sizeMode).toBe("large");
    await act(async () => result.current.editor.notifyKeyboardHide());
    expect(result.current.editor.sizeMode).toBe("large");
  });

  it("holds Review after manual collapse until the draft becomes short", async () => {
    const { result } = await renderHook(() => useHarness("long draft"));
    await act(async () =>
      result.current.editor.measureContentHeight(8 * 22 + 16),
    );
    await act(async () => result.current.editor.collapseLarge());
    await act(async () =>
      result.current.editor.measureContentHeight(12 * 22 + 16),
    );
    expect(result.current.editor.sizeMode).toBe("review");

    await act(async () => result.current.editor.changeText("short"));
    await act(async () =>
      result.current.editor.measureContentHeight(2 * 22 + 16),
    );
    expect(result.current.editor.sizeMode).toBe("compact");
  });

  it("applies a Markdown action as an independent undo checkpoint", async () => {
    let now = 100;
    const onValueChange = jest.fn();
    const { result } = await renderHook(() =>
      useHarness("alpha", onValueChange, () => now),
    );
    await act(async () =>
      result.current.editor.changeSelection({ start: 0, end: 5 }),
    );
    await act(async () => result.current.editor.applyMarkdown("quote"));
    expect(result.current.value).toBe("> alpha");
    expect(onValueChange).toHaveBeenLastCalledWith("> alpha");

    now += 1;
    await act(async () => result.current.editor.undo());
    expect(result.current.value).toBe("alpha");
    expect(result.current.editor.selection).toEqual({ start: 0, end: 5 });
    expect(onValueChange).toHaveBeenLastCalledWith("alpha");
  });

  it("restores the prior Large geometry after a rejected optimistic send", async () => {
    const onValueChange = jest.fn();
    const { result } = await renderHook(() =>
      useHarness("eight-line draft", onValueChange),
    );
    await act(async () =>
      result.current.editor.measureContentHeight(8 * 22 + 16),
    );
    const recovery = result.current.editor.captureSendRecovery();
    await act(async () => result.current.editor.beginOptimisticSend());
    expect(result.current.value).toBe("");
    expect(result.current.editor.sizeMode).toBe("large");

    await act(async () =>
      result.current.editor.restoreRejectedSend(recovery, "eight-line draft"),
    );
    expect(result.current.value).toBe("eight-line draft");
    expect(result.current.editor.sizeMode).toBe("large");
  });

  it("does not clear or resize a new draft when an earlier send completes", async () => {
    const onValueChange = jest.fn();
    const { result } = await renderHook(() =>
      useHarness("sent text", onValueChange),
    );
    await act(async () => result.current.editor.beginOptimisticSend());
    await act(async () =>
      result.current.editor.changeText("next\ndraft\nkeeps\nreview"),
    );
    await act(async () =>
      result.current.editor.measureContentHeight(4 * 22 + 16),
    );
    expect(result.current.editor.sizeMode).toBe("review");
    await act(async () => result.current.editor.completeSuccessfulSend());
    expect(result.current.value).toBe("next\ndraft\nkeeps\nreview");
    expect(result.current.editor.currentText()).toBe(
      "next\ndraft\nkeeps\nreview",
    );
    expect(result.current.editor.sizeMode).toBe("review");
  });

  it("clears text and history without touching attachment state", async () => {
    const onValueChange = jest.fn();
    const { result } = await renderHook(() =>
      useHarness("draft", onValueChange),
    );
    await act(async () => result.current.editor.changeText("draft!"));
    expect(result.current.editor.canUndo).toBe(true);
    await act(async () => result.current.editor.clearText());
    expect(result.current.value).toBe("");
    expect(onValueChange).toHaveBeenLastCalledWith("");
    expect(result.current.editor.sizeMode).toBe("compact");
    expect(result.current.editor.canUndo).toBe(false);
  });

  it("retains a restored draft measurement delivered before the parent synchronizes its value", async () => {
    const restored = "restored wrapped draft";
    const harness = await renderCommitHarness("", {
      "": 48,
      [restored]: 4 * 22 + 16,
    });
    await act(async () => harness.current.setExternalValue(restored));

    expect(harness.events.find((event) => event.value === restored)).toEqual({
      value: restored,
      currentText: "",
      height: 4 * 22 + 16,
    });
    expect(harness.current.editor.currentText()).toBe(restored);
    expect(harness.current.editor.sizeMode).toBe("review");
    expect(harness.current.editor.sizeState.lastValidContentHeight).toBe(
      4 * 22 + 16,
    );
    expect(harness.current.editor.selection).toEqual({
      start: restored.length,
      end: restored.length,
    });
    expect(harness.current.editor.canUndo).toBe(false);
    expect(harness.onValueChange).not.toHaveBeenCalled();
    expect(harness.markDraftChanged).not.toHaveBeenCalled();
  });

  it("resets externally cleared draft geometry even when native sends no empty measurement", async () => {
    const harness = await renderCommitHarness("long draft", {
      "long draft": 8 * 22 + 16,
    });
    expect(harness.current.editor.sizeMode).toBe("large");
    await act(async () => harness.current.setExternalValue(""));

    expect(harness.current.editor.currentText()).toBe("");
    expect(harness.current.editor.sizeState).toEqual({
      mode: "compact",
      largeOverride: "auto",
      lastValidContentHeight: 0,
      visualLineCount: 1,
    });
    expect(harness.current.editor.selection).toEqual({ start: 0, end: 0 });
    expect(harness.current.editor.canUndo).toBe(false);
    expect(harness.onValueChange).not.toHaveBeenCalled();
  });

  it("ignores an old draft measurement after external clear and a new draft commit", async () => {
    const harness = await renderCommitHarness("long draft", {
      "long draft": 8 * 22 + 16,
      "": 48,
      "next draft": 2 * 22 + 16,
    });
    const lateMeasure = harness.current.editor.measureContentHeight;
    await act(async () => harness.current.setExternalValue(""));
    await act(async () => harness.current.setExternalValue("next draft"));
    const currentSize = harness.current.editor.sizeState;
    await act(async () => lateMeasure(12 * 22 + 16));

    expect(harness.current.editor.currentText()).toBe("next draft");
    expect(harness.current.editor.sizeState).toEqual(currentSize);
    expect(harness.current.editor.sizeMode).toBe("compact");
    expect(harness.current.editor.sizeState.lastValidContentHeight).toBe(
      2 * 22 + 16,
    );
  });

  it("does not revive a retired measurement frame when the same text is restored again", async () => {
    const harness = await renderCommitHarness("same draft", {
      "same draft": 4 * 22 + 16,
      "other draft": 2 * 22 + 16,
    });
    const retiredMeasure = harness.current.editor.measureContentHeight;
    await act(async () => harness.current.setExternalValue("other draft"));
    await act(async () => harness.current.setExternalValue("same draft"));
    const currentSize = harness.current.editor.sizeState;
    await act(async () => retiredMeasure(8 * 22 + 16));

    expect(harness.current.editor.sizeState).toEqual(currentSize);
    expect(harness.current.editor.sizeMode).toBe("review");
    expect(harness.current.editor.currentText()).toBe("same draft");
  });

  it("rejects late measurements resolved with a retired line-height frame", async () => {
    const harness = await renderCommitHarness("draft", { draft: 4 * 22 + 16 });
    const retiredMeasure = harness.current.editor.measureContentHeight;
    await harness.rerenderLineHeight(44);
    await act(async () =>
      harness.current.editor.measureContentHeight(4 * 22 + 16),
    );
    const currentSize = harness.current.editor.sizeState;
    await act(async () => retiredMeasure(8 * 22 + 16));

    expect(harness.current.editor.sizeState).toEqual(currentSize);
    expect(harness.current.editor.sizeMode).toBe("compact");
  });

  it("preserves rejected-send recovery across empty commit measurements and their late callbacks", async () => {
    const harness = await renderCommitHarness("sent draft", {
      "sent draft": 8 * 22 + 16,
      "": 48,
    });
    const recovery = harness.current.editor.captureSendRecovery();
    await act(async () => harness.current.editor.beginOptimisticSend());
    const emptyFrameMeasure = harness.current.editor.measureContentHeight;
    expect(harness.current.editor.sizeState).toEqual(recovery.sizeState);
    await act(async () =>
      harness.current.editor.restoreRejectedSend(recovery, recovery.text),
    );
    await act(async () => emptyFrameMeasure(48));

    expect(harness.current.editor.currentText()).toBe(recovery.text);
    expect(harness.current.editor.sizeState).toEqual(recovery.sizeState);
    expect(harness.current.editor.sizeMode).toBe("large");
  });

  it("keeps a new draft commit measurement when a retired send frame measures or completes", async () => {
    const harness = await renderCommitHarness("sent draft", {
      "sent draft": 8 * 22 + 16,
      "": 48,
      "next draft": 4 * 22 + 16,
    });
    const oldSendMeasure = harness.current.editor.measureContentHeight;
    await act(async () => harness.current.editor.beginOptimisticSend());
    await act(async () => harness.current.editor.changeText("next draft"));
    const currentSize = harness.current.editor.sizeState;
    await act(async () => oldSendMeasure(8 * 22 + 16));
    await act(async () => harness.current.editor.completeSuccessfulSend());

    expect(harness.current.editor.currentText()).toBe("next draft");
    expect(harness.current.editor.sizeState).toEqual(currentSize);
    expect(harness.current.editor.sizeMode).toBe("review");
    expect(harness.current.editor.sizeState.lastValidContentHeight).toBe(
      4 * 22 + 16,
    );
  });
});
