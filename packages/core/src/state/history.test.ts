import { describe, it, expect } from "vitest";
import { createNode, createTextNode } from "./create-node";
import { createHistory, pushChange, undo, redo } from "./history";
import type { Change } from "./change";

function makeChange(
  oldContent: string,
  newContent: string,
  timestamp: number,
): Change {
  const oldState = createNode("doc", "document", {}, [
    createNode("p1", "paragraph", {}, [createTextNode("t1", oldContent)]),
  ]);
  const newState = createNode("doc", "document", {}, [
    createNode("p1", "paragraph", {}, [createTextNode("t1", newContent)]),
  ]);
  return Object.freeze({ oldState, newState, timestamp });
}

describe("History", () => {
  it("starts empty", () => {
    const h = createHistory();
    expect(h.undoStack).toHaveLength(0);
    expect(h.redoStack).toHaveLength(0);
  });

  it("pushes a change onto the undo stack", () => {
    let h = createHistory();
    const c = makeChange("a", "ab", 1000);
    h = pushChange(h, c);

    expect(h.undoStack).toHaveLength(1);
    expect(h.undoStack[0]).toBe(c);
  });

  it("undo reverts to old state", () => {
    let h = createHistory();
    const c = makeChange("a", "ab", 1000);
    h = pushChange(h, c);

    const result = undo(h);
    expect(result).not.toBeNull();
    expect(result!.state).toBe(c.oldState);
    expect(result!.history.undoStack).toHaveLength(0);
    expect(result!.history.redoStack).toHaveLength(1);
  });

  it("redo reapplies the undone change", () => {
    let h = createHistory();
    const c = makeChange("a", "ab", 1000);
    h = pushChange(h, c);

    const undoResult = undo(h)!;
    const redoResult = redo(undoResult.history)!;

    expect(redoResult.state).toBe(c.newState);
    expect(redoResult.history.undoStack).toHaveLength(1);
    expect(redoResult.history.redoStack).toHaveLength(0);
  });

  it("undo returns null when stack is empty", () => {
    expect(undo(createHistory())).toBeNull();
  });

  it("redo returns null when stack is empty", () => {
    expect(redo(createHistory())).toBeNull();
  });

  it("new change clears redo stack", () => {
    let h = createHistory();
    h = pushChange(h, makeChange("a", "ab", 1000));
    h = pushChange(h, makeChange("ab", "abc", 2000));

    // Undo once
    h = undo(h)!.history;
    expect(h.redoStack).toHaveLength(1);

    // New change clears redo
    h = pushChange(h, makeChange("ab", "abx", 3000));
    expect(h.redoStack).toHaveLength(0);
  });

  it("collapses changes within the threshold", () => {
    let h = createHistory();
    const c1 = makeChange("a", "ab", 1000);
    const c2 = makeChange("ab", "abc", 1200); // within 500ms

    h = pushChange(h, c1);
    h = pushChange(h, c2);

    // Should be collapsed into one entry
    expect(h.undoStack).toHaveLength(1);
    expect(h.undoStack[0].oldState).toBe(c1.oldState);
    expect(h.undoStack[0].newState).toBe(c2.newState);
  });

  it("does not collapse changes outside the threshold", () => {
    let h = createHistory();
    const c1 = makeChange("a", "ab", 1000);
    const c2 = makeChange("ab", "abc", 2000); // 1000ms apart

    h = pushChange(h, c1);
    h = pushChange(h, c2);

    expect(h.undoStack).toHaveLength(2);
  });

  it("does not cascade collapse beyond the original threshold window", () => {
    let h = createHistory();
    // 5 changes, each 200ms apart — total span is 800ms > 500ms threshold
    const c1 = makeChange("a", "ab", 1000);
    const c2 = makeChange("ab", "abc", 1200);
    const c3 = makeChange("abc", "abcd", 1400);
    const c4 = makeChange("abcd", "abcde", 1600);
    const c5 = makeChange("abcde", "abcdef", 1800);

    h = pushChange(h, c1);
    h = pushChange(h, c2);
    h = pushChange(h, c3);
    h = pushChange(h, c4);
    h = pushChange(h, c5);

    // c1 and c2 collapse (within 500ms of c1's timestamp 1000).
    // c3 at 1400: 1400 - 1000 = 400ms, still within 500ms -> collapse.
    // c4 at 1600: 1600 - 1000 = 600ms, outside 500ms -> new entry.
    // c5 at 1800: 1800 - 1600 = 200ms, within 500ms of c4 -> collapse.
    expect(h.undoStack).toHaveLength(2);
    expect(h.undoStack[0].oldState).toBe(c1.oldState);
    expect(h.undoStack[0].newState).toBe(c3.newState);
    expect(h.undoStack[1].oldState).toBe(c4.oldState);
    expect(h.undoStack[1].newState).toBe(c5.newState);
  });

  it("multiple undo/redo cycles work correctly", () => {
    let h = createHistory();
    const c1 = makeChange("a", "ab", 1000);
    const c2 = makeChange("ab", "abc", 2000);

    h = pushChange(h, c1);
    h = pushChange(h, c2);

    // Undo twice
    let result = undo(h)!;
    expect(result.state).toBe(c2.oldState);
    result = undo(result.history)!;
    expect(result.state).toBe(c1.oldState);

    // Redo twice
    result = redo(result.history)!;
    expect(result.state).toBe(c1.newState);
    result = redo(result.history)!;
    expect(result.state).toBe(c2.newState);
  });

  it("enforces max depth by dropping oldest entries", () => {
    let h = createHistory(3);

    const c1 = makeChange("a", "ab", 1000);
    const c2 = makeChange("ab", "abc", 2000);
    const c3 = makeChange("abc", "abcd", 3000);
    const c4 = makeChange("abcd", "abcde", 4000);

    h = pushChange(h, c1);
    h = pushChange(h, c2);
    h = pushChange(h, c3);
    expect(h.undoStack).toHaveLength(3);

    // Pushing a 4th should drop the oldest
    h = pushChange(h, c4);
    expect(h.undoStack).toHaveLength(3);
    expect(h.undoStack[0].oldState).toBe(c2.oldState);
    expect(h.undoStack[2].newState).toBe(c4.newState);
  });

  it("preserves maxDepth through undo/redo", () => {
    let h = createHistory(5);
    const c1 = makeChange("a", "ab", 1000);
    h = pushChange(h, c1);
    expect(h.maxDepth).toBe(5);

    const result = undo(h)!;
    expect(result.history.maxDepth).toBe(5);

    const result2 = redo(result.history)!;
    expect(result2.history.maxDepth).toBe(5);
  });
});
