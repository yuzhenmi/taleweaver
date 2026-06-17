import { describe, it, expect } from "vitest";
import {
  asBlockId,
  createPosition,
  createSpan,
  type Selection,
  type Position,
} from "@taleweaver/core";
import { mapBeforeInput, replacementInsertText } from "./map-before-input";

// ---------------------------------------------------------------------------
// jsdom workarounds. This jsdom build:
//   - has working `InputEvent` and `StaticRange` constructors,
//   - does NOT implement `DataTransfer` (so paste/cut data is a Map-backed stub),
//   - does NOT expose `getTargetRanges()` on an InputEvent (so the test defines it).
// `fakeInput` patches `getTargetRanges` and `dataTransfer` onto the event after
// construction, mirroring how a real browser would populate them.
// ---------------------------------------------------------------------------

/** A minimal `DataTransfer`-shaped stub backed by a Map<type, value>. */
interface ClipboardDataStub {
  getData(type: string): string;
}

function makeClipboardData(entries: Record<string, string>): ClipboardDataStub {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    getData(type: string): string {
      return map.get(type) ?? "";
    },
  };
}

interface FakeInputInit {
  readonly data?: string | null;
  readonly targetRanges?: readonly StaticRange[];
  readonly dataTransfer?: ClipboardDataStub | null;
}

function fakeInput(inputType: string, init: FakeInputInit = {}): InputEvent {
  const data = init.data === undefined ? null : init.data;
  const e = new InputEvent("beforeinput", { inputType, data });
  const ranges = init.targetRanges ?? [];
  Object.defineProperty(e, "getTargetRanges", {
    value: () => ranges,
    configurable: true,
  });
  const dt = init.dataTransfer === undefined ? null : init.dataTransfer;
  Object.defineProperty(e, "dataTransfer", {
    value: dt,
    configurable: true,
  });
  return e;
}

// A single block "b1" with two text nodes. The `domToPosition` mapper below
// maps (node, offset) → Position using a small lookup, so target-range tests
// can assert exact spans.
const NODE_A = document.createTextNode("hello");
const NODE_B = document.createTextNode("world");
const OUTSIDE = document.createTextNode("orphan");

const domToPosition = (node: Node, off: number): Position | null => {
  if (node === NODE_A) return createPosition(asBlockId("b1"), off);
  if (node === NODE_B) return createPosition(asBlockId("b1"), 5 + off);
  return null;
};

const SEL: Selection = createSpan(
  createPosition(asBlockId("b1"), 1),
  createPosition(asBlockId("b1"), 4),
);

const CTX = { selection: SEL, domToPosition };

function rangeFor(
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number,
): StaticRange {
  return new StaticRange({
    startContainer: startNode,
    startOffset,
    endContainer: endNode,
    endOffset,
  });
}

describe("mapBeforeInput — core table (2d)", () => {
  it("insertText with data → INSERT_TEXT", () => {
    expect(mapBeforeInput(fakeInput("insertText", { data: "x" }), CTX)).toEqual({
      type: "INSERT_TEXT",
      text: "x",
    });
  });

  it("insertText with null data and no fallback → null", () => {
    expect(mapBeforeInput(fakeInput("insertText", { data: null }), CTX)).toBeNull();
  });

  it("insertText with null data but dataTransfer text/plain fallback → INSERT_TEXT", () => {
    const e = fakeInput("insertText", {
      data: null,
      dataTransfer: makeClipboardData({ "text/plain": "fb" }),
    });
    expect(mapBeforeInput(e, CTX)).toEqual({ type: "INSERT_TEXT", text: "fb" });
  });

  it("insertText with null data and an ABSENT (undefined) dataTransfer → null, no throw", () => {
    // `fakeInput` always materializes `dataTransfer` as `null`; here we set it to `undefined`
    // explicitly to exercise the absent-property path a synthetic/jsdom event can produce. The
    // fallback's truthiness guard must treat `undefined` like `null` and not call `.getData()`.
    const e = new InputEvent("beforeinput", { inputType: "insertText", data: null });
    Object.defineProperty(e, "getTargetRanges", { value: () => [], configurable: true });
    Object.defineProperty(e, "dataTransfer", { value: undefined, configurable: true });
    expect(() => mapBeforeInput(e, CTX)).not.toThrow();
    expect(mapBeforeInput(e, CTX)).toBeNull();
  });

  it("insertCompositionText → null (compositionend handles it)", () => {
    expect(mapBeforeInput(fakeInput("insertCompositionText", { data: "あ" }), CTX)).toBeNull();
  });

  it("insertLineBreak → SPLIT_NODE", () => {
    expect(mapBeforeInput(fakeInput("insertLineBreak"), CTX)).toEqual({ type: "SPLIT_NODE" });
  });

  it("insertParagraph → SPLIT_NODE", () => {
    expect(mapBeforeInput(fakeInput("insertParagraph"), CTX)).toEqual({ type: "SPLIT_NODE" });
  });

  it("insertFromPaste → null (the `paste` ClipboardEvent is the single paste source; C1)", () => {
    // Even WITH usable text/plain, beforeinput must not map paste to an action: the controller's
    // `paste` handler already dispatches PASTE, so mapping here too would insert the text twice.
    const e = fakeInput("insertFromPaste", {
      dataTransfer: makeClipboardData({ "text/plain": "pasted" }),
    });
    expect(mapBeforeInput(e, CTX)).toBeNull();
  });

  it("insertFromDrop with text/plain → PASTE (drop has no ClipboardEvent peer; beforeinput owns it)", () => {
    const e = fakeInput("insertFromDrop", {
      dataTransfer: makeClipboardData({ "text/plain": "dropped" }),
    });
    expect(mapBeforeInput(e, CTX)).toEqual({ type: "PASTE", text: "dropped" });
  });

  it("deleteContentBackward → DELETE_BACKWARD", () => {
    expect(mapBeforeInput(fakeInput("deleteContentBackward"), CTX)).toEqual({
      type: "DELETE_BACKWARD",
    });
  });

  it("deleteContentForward → DELETE_FORWARD", () => {
    expect(mapBeforeInput(fakeInput("deleteContentForward"), CTX)).toEqual({
      type: "DELETE_FORWARD",
    });
  });

  it("deleteByCut → DELETE_RANGE over the live selection", () => {
    expect(mapBeforeInput(fakeInput("deleteByCut"), CTX)).toEqual({
      type: "DELETE_RANGE",
      span: SEL,
    });
  });

  it("deleteByDrag → DELETE_RANGE over the live selection", () => {
    expect(mapBeforeInput(fakeInput("deleteByDrag"), CTX)).toEqual({
      type: "DELETE_RANGE",
      span: SEL,
    });
  });

  it("formatBold → TOGGLE_STYLE bold", () => {
    expect(mapBeforeInput(fakeInput("formatBold"), CTX)).toEqual({
      type: "TOGGLE_STYLE",
      style: "bold",
    });
  });

  it("formatItalic → TOGGLE_STYLE italic", () => {
    expect(mapBeforeInput(fakeInput("formatItalic"), CTX)).toEqual({
      type: "TOGGLE_STYLE",
      style: "italic",
    });
  });

  it("formatUnderline → TOGGLE_STYLE underline", () => {
    expect(mapBeforeInput(fakeInput("formatUnderline"), CTX)).toEqual({
      type: "TOGGLE_STYLE",
      style: "underline",
    });
  });

  it("formatStrikeThrough → TOGGLE_STYLE strikethrough", () => {
    expect(mapBeforeInput(fakeInput("formatStrikeThrough"), CTX)).toEqual({
      type: "TOGGLE_STYLE",
      style: "strikethrough",
    });
  });

  it("historyUndo → UNDO", () => {
    expect(mapBeforeInput(fakeInput("historyUndo"), CTX)).toEqual({ type: "UNDO" });
  });

  it("historyRedo → REDO", () => {
    expect(mapBeforeInput(fakeInput("historyRedo"), CTX)).toEqual({ type: "REDO" });
  });

  it("unknown inputType → null", () => {
    expect(mapBeforeInput(fakeInput("insertFromYank"), CTX)).toBeNull();
  });
});

describe("mapBeforeInput — target-range deletes (F10) and replacement/dictation (F9)", () => {
  it("deleteWordBackward with a target range → DELETE_RANGE over that range", () => {
    const e = fakeInput("deleteWordBackward", {
      targetRanges: [rangeFor(NODE_A, 0, NODE_A, 3)],
    });
    expect(mapBeforeInput(e, CTX)).toEqual({
      type: "DELETE_RANGE",
      span: createSpan(createPosition(asBlockId("b1"), 0), createPosition(asBlockId("b1"), 3)),
    });
  });

  it("deleteWordBackward with no target range → DELETE_WORD backward fallback", () => {
    expect(mapBeforeInput(fakeInput("deleteWordBackward"), CTX)).toEqual({
      type: "DELETE_WORD",
      direction: "backward",
    });
  });

  it("deleteWordForward with no target range → DELETE_WORD forward fallback", () => {
    expect(mapBeforeInput(fakeInput("deleteWordForward"), CTX)).toEqual({
      type: "DELETE_WORD",
      direction: "forward",
    });
  });

  it("deleteSoftLineBackward with an unmappable target range → DELETE_BACKWARD fallback", () => {
    // OUTSIDE maps to null → targetRangeSpan returns null → fallback.
    const e = fakeInput("deleteSoftLineBackward", {
      targetRanges: [rangeFor(OUTSIDE, 0, OUTSIDE, 2)],
    });
    expect(mapBeforeInput(e, CTX)).toEqual({ type: "DELETE_BACKWARD" });
  });

  it("deleteHardLineForward with a target range → DELETE_RANGE over that range", () => {
    const e = fakeInput("deleteHardLineForward", {
      targetRanges: [rangeFor(NODE_B, 0, NODE_B, 5)],
    });
    expect(mapBeforeInput(e, CTX)).toEqual({
      type: "DELETE_RANGE",
      span: createSpan(createPosition(asBlockId("b1"), 5), createPosition(asBlockId("b1"), 10)),
    });
  });

  it("insertReplacementText → DELETE_RANGE over the target range; replacementInsertText exposes the insert", () => {
    const e = fakeInput("insertReplacementText", {
      data: "fixed",
      targetRanges: [rangeFor(NODE_A, 0, NODE_A, 5)],
    });
    expect(mapBeforeInput(e, CTX)).toEqual({
      type: "DELETE_RANGE",
      span: createSpan(createPosition(asBlockId("b1"), 0), createPosition(asBlockId("b1"), 5)),
    });
    expect(replacementInsertText(e)).toBe("fixed");
  });

  it("insertReplacementText with no target range → null (no delete)", () => {
    const e = fakeInput("insertReplacementText", { data: "fixed" });
    expect(mapBeforeInput(e, CTX)).toBeNull();
  });

  it("replacementInsertText returns null for a non-replacement event", () => {
    expect(replacementInsertText(fakeInput("insertText", { data: "x" }))).toBeNull();
  });

  it("replacementInsertText falls back to dataTransfer text/plain when e.data is null (D2)", () => {
    // Some engines deliver the replacement payload only via dataTransfer (e.data null). Without the
    // fallback the mapped DELETE_RANGE runs but the follow-on INSERT_TEXT is skipped → text vanishes.
    const e = fakeInput("insertReplacementText", {
      data: null,
      dataTransfer: makeClipboardData({ "text/plain": "fixed" }),
    });
    expect(replacementInsertText(e)).toBe("fixed");
  });

  it("replacementInsertText returns null when e.data is null and dataTransfer is absent (D2)", () => {
    const e = fakeInput("insertReplacementText", { data: null, dataTransfer: null });
    expect(replacementInsertText(e)).toBeNull();
  });
});
