import { describe, it, expect } from "vitest";
import { createHistory } from "./history";
import { createEmptyDocument } from "./initial-state";
import { setBlockAttrs } from "./set-block-attrs";
import { getBlock } from "./state";

describe("history (Y.UndoManager wrapper)", () => {
  it("starts with no undo/redo available", () => {
    const state = createEmptyDocument();
    const history = createHistory(state);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("undo after a single op restores the prior state", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = getBlock(state0, getBlock(state0, state0.rootId)!.firstChildId!)!;
    setBlockAttrs(state0, child.id, { bold: true });
    history.push({ selection: null });
    expect(history.canUndo()).toBe(true);

    const undone = history.undo();
    expect(undone).not.toBeNull();
    expect(getBlock(undone!.state, child.id)?.attrs.bold).toBeUndefined();
  });

  it("redo after undo restores the post-op state", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = getBlock(state0, getBlock(state0, state0.rootId)!.firstChildId!)!;
    setBlockAttrs(state0, child.id, { bold: true });
    history.push({ selection: null });

    const undone = history.undo();
    expect(undone).not.toBeNull();
    expect(history.canRedo()).toBe(true);
    const redone = history.redo();
    expect(redone).not.toBeNull();
    expect(getBlock(redone!.state, child.id)?.attrs.bold).toBe(true);
  });

  it("multiple undos and redos in sequence", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = getBlock(state0, getBlock(state0, state0.rootId)!.firstChildId!)!;
    setBlockAttrs(state0, child.id, { bold: true });
    history.push({ selection: null });
    setBlockAttrs(state0, child.id, { bold: true, italic: true });
    history.push({ selection: null });

    expect(history.undo()).not.toBeNull();
    expect(history.undo()).not.toBeNull();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).not.toBeNull();
    expect(history.redo()).not.toBeNull();
    expect(history.canRedo()).toBe(false);
  });

  it("a new op after undo clears the redo stack", () => {
    const state0 = createEmptyDocument();
    const history = createHistory(state0);
    const child = getBlock(state0, getBlock(state0, state0.rootId)!.firstChildId!)!;
    setBlockAttrs(state0, child.id, { bold: true });
    history.push({ selection: null });
    history.undo();
    expect(history.canRedo()).toBe(true);
    setBlockAttrs(state0, child.id, { italic: true });
    history.push({ selection: null });
    expect(history.canRedo()).toBe(false);
  });
});
