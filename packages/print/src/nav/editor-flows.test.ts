/**
 * Editor-flow integration tests against the new (post-P11 cutover) pipeline.
 *
 * Each test exercises a user-level flow by dispatching EditorAction objects
 * through `reduceEditor` and asserting on the resulting EditorState's
 * underlying block tree + selection. These restore some of the integration
 * coverage that was removed in T1 (which deleted 11 editor-flow tests built
 * against legacy types).
 *
 * Per-handler unit-test coverage is a known gap (P13).
 *
 * Migrated from `packages/core/src/integration/editor-flows.test.ts` (Phase 0b:
 * the geometric MOVE_CURSOR step left core's reducer for the print backend, so
 * the "MOVE_CURSOR across block boundary" flow drives it through the driver →
 * `resolveNavIntent` via the `nav` helper). All other flows are pure-core actions
 * dispatched directly. Assertions byte-identical; fixtures are authored through the
 * public editor API (core test-utils don't cross the package boundary).
 */
import { describe, it, expect } from "vitest";
import {
  getBlock,
  inlineContentLength,
  createPosition,
  createSpan,
  render,
  type EditorState,
  type EditorConfig,
  type Block,
  type BlockId,
  type TextItem,
  type RenderOutput,
} from "@taleweaver/core";
import { makeNavEditor, dispatch, nav, type NavCtx } from "./nav-test-helpers";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Returns the (only) paragraph block in a freshly-created editor. */
function firstParagraph(editor: EditorState): Block {
  const root = getBlock(editor.state, editor.state.rootId);
  if (root === null) throw new Error("test setup: no root block");
  const firstId = root.firstChildId;
  if (firstId === null) throw new Error("test setup: root has no first child");
  const block = getBlock(editor.state, firstId);
  if (block === null) throw new Error("test setup: first child block not found");
  return block;
}

/** Returns the text contents of a leaf block's first text item, or "" if none. */
function blockText(editor: EditorState, blockId: BlockId): string {
  const block = getBlock(editor.state, blockId);
  if (block === null || block.inlineContent === null) return "";
  let out = "";
  for (const item of block.inlineContent.items) {
    if (item.kind === "text") out += item.text;
  }
  return out;
}

/** Type a literal string by dispatching one INSERT_TEXT per character. */
function typeString(ctx: NavCtx, text: string): NavCtx {
  let cur = ctx;
  for (const ch of text) {
    cur = dispatch(cur, { type: "INSERT_TEXT", text: ch });
  }
  return cur;
}

describe("editor flow: typing characters builds inline text", () => {
  it('typing "hello" produces a single text item with text="hello" and cursor at offset 5', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;

    ctx = typeString(ctx, "hello");

    const block = getBlock(ctx.editor.state, blockId);
    expect(block).not.toBeNull();
    if (block === null) return;
    expect(block.inlineContent).not.toBeNull();
    if (block.inlineContent === null) return;
    expect(block.inlineContent.items.length).toBe(1);
    expect(block.inlineContent.items[0]).toMatchObject({
      kind: "text",
      text: "hello",
    });
    expect(ctx.editor.selection.focus).toEqual(createPosition(blockId, 5));
    expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
  });
});

describe("editor flow: backspace deletes a character", () => {
  it('typing "hello" then DELETE_BACKWARD leaves "hell" and cursor at offset 4', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello");

    ctx = dispatch(ctx, { type: "DELETE_BACKWARD" });

    expect(blockText(ctx.editor, blockId)).toBe("hell");
    expect(ctx.editor.selection.focus).toEqual(createPosition(blockId, 4));
  });
});

describe("editor flow: multi-paragraph editing", () => {
  it("typing, then SPLIT_NODE, then typing more produces two paragraph blocks with the right contents", () => {
    let ctx = makeNavEditor();
    const firstId = firstParagraph(ctx.editor).id;

    ctx = typeString(ctx, "abc");
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    ctx = typeString(ctx, "def");

    // The second block is the focused one after SPLIT_NODE + typing.
    const secondId = ctx.editor.selection.focus.blockId;
    expect(secondId).not.toBe(firstId);

    expect(blockText(ctx.editor, firstId)).toBe("abc");
    expect(blockText(ctx.editor, secondId)).toBe("def");

    // First block's nextSibling chains to second; both share the document parent.
    const firstBlock = getBlock(ctx.editor.state, firstId);
    const secondBlock = getBlock(ctx.editor.state, secondId);
    expect(firstBlock?.nextSiblingId).toBe(secondId);
    expect(secondBlock?.prevSiblingId).toBe(firstId);
    expect(firstBlock?.parentId).toBe(secondBlock?.parentId);
  });
});

describe("editor flow: cross-block backspace merges paragraphs", () => {
  it('two paragraphs "abc" and "def" merge to single "abcdef" via DELETE_BACKWARD at offset 0 of second', () => {
    let ctx = makeNavEditor();
    const firstId = firstParagraph(ctx.editor).id;

    ctx = typeString(ctx, "abc");
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    ctx = typeString(ctx, "def");
    const secondId = ctx.editor.selection.focus.blockId;

    // Move cursor to start of the second paragraph.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(secondId, 0), createPosition(secondId, 0)),
    });

    ctx = dispatch(ctx, { type: "DELETE_BACKWARD" });

    expect(blockText(ctx.editor, firstId)).toBe("abcdef");
    // Second block has been removed; only firstId survives.
    expect(getBlock(ctx.editor.state, secondId)).toBeNull();
    expect(ctx.editor.selection.focus).toEqual(createPosition(firstId, 3));
  });
});

describe("editor flow: selection replacement with INSERT_TEXT", () => {
  it('selecting "world" in "hello world" and inserting "earth" produces "hello earth"', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello world");

    // Set selection over offsets 6..11 ("world").
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, 6), createPosition(blockId, 11)),
    });

    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "earth" });

    expect(blockText(ctx.editor, blockId)).toBe("hello earth");
    expect(ctx.editor.selection.focus).toEqual(createPosition(blockId, 11));
    expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
  });
});

describe("editor flow: DELETE_WORD backward", () => {
  it('with cursor at offset 11 of "hello world", DELETE_WORD backward removes the trailing word', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello world");

    const offsetBefore = ctx.editor.selection.focus.offset;
    expect(offsetBefore).toBe(11);

    ctx = dispatch(ctx, { type: "DELETE_WORD", direction: "backward" });

    // UAX #29 word boundary at the end of "hello world": stepping back one
    // word lands on the start of "world" (offset 6). So result is "hello ".
    const after = blockText(ctx.editor, blockId);
    expect(after).toBe("hello ");
    expect(ctx.editor.selection.focus).toEqual(createPosition(blockId, 6));
  });
});

describe("editor flow: TOGGLE_STYLE applies bold over a selection", () => {
  it('selecting "hello" and toggling bold sets attrs.bold === true on the text item', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello");

    // Select the whole text.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, 0), createPosition(blockId, 5)),
    });

    ctx = dispatch(ctx, { type: "TOGGLE_STYLE", style: "bold" });

    const block = getBlock(ctx.editor.state, blockId);
    expect(block).not.toBeNull();
    if (block === null || block.inlineContent === null) return;
    expect(block.inlineContent.items.length).toBe(1);
    const item = nth(block.inlineContent.items, 0, "inline item");
    expect(item.kind).toBe("text");
    if (item.kind !== "text") return;
    const textItem: TextItem = item;
    expect(textItem.text).toBe("hello");
    expect(textItem.attrs.bold).toBe(true);
  });
});

describe("editor flow: TOGGLE_STYLE strikethrough over a selection", () => {
  it('selecting "hello" and toggling strikethrough sets attrs.strikethrough === true; toggling again removes it', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello");

    // Select the whole text.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, 0), createPosition(blockId, 5)),
    });

    // Toggle ON.
    ctx = dispatch(ctx, { type: "TOGGLE_STYLE", style: "strikethrough" });

    {
      const block = getBlock(ctx.editor.state, blockId);
      expect(block).not.toBeNull();
      if (block === null || block.inlineContent === null) return;
      expect(block.inlineContent.items.length).toBe(1);
      const item = nth(block.inlineContent.items, 0, "inline item");
      expect(item.kind).toBe("text");
      if (item.kind !== "text") return;
      const textItem: TextItem = item;
      expect(textItem.text).toBe("hello");
      expect(textItem.attrs.strikethrough).toBe(true);
    }

    // Toggle OFF — selecting the same range and toggling again removes it.
    ctx = dispatch(ctx, { type: "TOGGLE_STYLE", style: "strikethrough" });

    {
      const block = getBlock(ctx.editor.state, blockId);
      expect(block).not.toBeNull();
      if (block === null || block.inlineContent === null) return;
      const item = nth(block.inlineContent.items, 0, "inline item");
      expect(item.kind).toBe("text");
      if (item.kind !== "text") return;
      expect(item.attrs.strikethrough).toBeUndefined();
    }
  });
});

describe("editor flow: undo / redo", () => {
  it('typing "hello" in one burst then UNDO once empties the paragraph; REDO once restores "hello"', () => {
    // #420: typing coalescing. A continuous typing burst (each INSERT_TEXT
    // within UNDO_COALESCE_PAUSE_MS of the previous, with no kind switch or
    // command/selection break between) collapses into ONE undo entry — matching
    // Google Docs. So one Ctrl+Z removes the whole "hello", and one Ctrl+Y
    // restores it. We inject a fake clock that never advances so the burst is
    // deterministically coalesced (no wall-clock flakiness).
    //
    // Selection on undo (pre-action selection algebra, T1/T4): undo restores the
    // caret to BEFORE the first keystroke of the coalesced run — offset 0.
    const clock = (() => {
      let t = 0;
      return { now: () => t, advance: (ms: number) => (t += ms) };
    })();
    let ctx = makeNavEditor({ now: clock.now });
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello");
    expect(blockText(ctx.editor, blockId)).toBe("hello");

    // ONE undo removes the whole coalesced burst.
    ctx = dispatch(ctx, { type: "UNDO" });

    const afterUndoBlock = getBlock(ctx.editor.state, blockId);
    expect(afterUndoBlock).not.toBeNull();
    if (afterUndoBlock !== null && afterUndoBlock.inlineContent !== null) {
      expect(inlineContentLength(afterUndoBlock.inlineContent)).toBe(0);
    }
    // The burst was a single entry — nothing left to undo.
    expect(ctx.editor.history.canUndo()).toBe(false);
    // Caret restored to before the first keystroke (offset 0).
    expect(ctx.editor.selection.focus.blockId).toBe(blockId);
    expect(ctx.editor.selection.focus.offset).toBe(0);

    // ONE redo restores the whole burst, caret after the last keystroke.
    ctx = dispatch(ctx, { type: "REDO" });
    expect(blockText(ctx.editor, blockId)).toBe("hello");
    expect(ctx.editor.selection.focus).toEqual(createPosition(blockId, 5));
  });
});

describe("editor flow: MOVE_CURSOR across block boundary", () => {
  it("two paragraphs ab/cd: forward MOVE_CURSOR at end of first lands at start of second", () => {
    let ctx = makeNavEditor();
    const firstId = firstParagraph(ctx.editor).id;

    ctx = typeString(ctx, "ab");
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    ctx = typeString(ctx, "cd");
    const secondId = ctx.editor.selection.focus.blockId;

    // Place cursor at offset 2 of first block (its end).
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(firstId, 2), createPosition(firstId, 2)),
    });

    ctx = nav(ctx, { type: "MOVE_CURSOR", direction: "forward" });

    expect(ctx.editor.selection.focus).toEqual(createPosition(secondId, 0));
    expect(ctx.editor.selection.anchor).toEqual(ctx.editor.selection.focus);
  });
});

describe("editor flow: EXPAND_WORD selects the surrounding word", () => {
  it('in "hello world" with cursor at offset 0, EXPAND_WORD forward extends focus to offset 5', () => {
    let ctx = makeNavEditor();
    const blockId = firstParagraph(ctx.editor).id;
    ctx = typeString(ctx, "hello world");

    // Collapse cursor to offset 0.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(blockId, 0), createPosition(blockId, 0)),
    });

    ctx = dispatch(ctx, { type: "EXPAND_WORD", direction: "forward" });

    // Anchor stays at 0; focus advances past "hello" — to offset 5.
    expect(ctx.editor.selection.anchor).toEqual(createPosition(blockId, 0));
    expect(ctx.editor.selection.focus).toEqual(createPosition(blockId, 5));
  });
});

// The incremental RENDER pipeline (RenderCache + dirtyIds) left core's
// `EditorState` in Phase 0b — `render()` is now driven by the print backend's
// LayoutDriver with `{prev, prevState, dirtyIds}`, keyed off the geometry-free
// `editor.lastDirtyIds` core still surfaces after each dispatch. These tests
// drive that exact seam directly (the same call the driver makes) and assert the
// same ref-equality the old `EditorState.renderOutput` assertions did.
describe("R-D incremental pipeline (end-to-end)", () => {
  /** Render `editor.state`, reusing `prev`/`prevState` against the just-applied
   *  `editor.lastDirtyIds` (the incremental path the driver takes). */
  function renderIncremental(
    editor: EditorState,
    config: EditorConfig,
    prev: RenderOutput,
    prevState: EditorState,
  ): RenderOutput {
    if (editor.lastDirtyIds === null) throw new Error("expected a dirty set after the edit");
    return render(editor.state, config.componentRegistry, config.attrRegistry, {
      prev,
      prevState: prevState.state,
      dirtyIds: editor.lastDirtyIds,
    });
  }

  function renderFull(editor: EditorState, config: EditorConfig): RenderOutput {
    return render(editor.state, config.componentRegistry, config.attrRegistry);
  }

  it("INSERT_TEXT on a leaf: prev unchanged paragraphs ref-equal in renderOutput across render calls", () => {
    // Seed two paragraphs by pressing Enter inside the first one.
    let ctx = makeNavEditor();
    const firstId = firstParagraph(ctx.editor).id;

    // Move cursor to end of paragraph 0 and split.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)),
    });
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });

    // Now editor has two paragraphs. Capture the first paragraph's RenderNode
    // reference, then insert text in the SECOND paragraph and verify the first
    // paragraph's RenderNode is ref-equal across the keystroke's incremental render.
    const beforeEditor = ctx.editor;
    const before = renderFull(beforeEditor, ctx.config);
    const beforeRoot = before.root;
    if (beforeRoot.type !== "element") throw new Error("expected element root");
    // Take a snapshot of the first leaf child of the document root.
    const firstChild0 = beforeRoot.children[0];

    // Type "X" — INSERT_TEXT goes to the current cursor block (which is the
    // SECOND paragraph after SPLIT_NODE).
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "X" });

    const after = renderIncremental(ctx.editor, ctx.config, before, beforeEditor);
    const afterRoot = after.root;
    if (afterRoot.type !== "element") throw new Error("expected element root");
    const firstChild1 = afterRoot.children[0];

    // First paragraph's RenderNode is ref-equal across the INSERT_TEXT keystroke
    // (which only dirtied the second paragraph). The root itself differs (children
    // array changed because the second child was rebuilt).
    expect(firstChild1).toBe(firstChild0);
    expect(afterRoot).not.toBe(beforeRoot);
  });

  it("UNDO engages the incremental pipeline: unchanged paragraphs ref-equal in renderOutput (S-A3)", () => {
    // S-A3 surfaces dirtyIds from undo/redo so the incremental render path runs
    // instead of the full-rebuild fallback. Proof: a paragraph that was NOT
    // touched by the action being undone retains its RenderNode reference across
    // the UNDO.
    let ctx = makeNavEditor();
    const firstId = firstParagraph(ctx.editor).id;

    // Seed two paragraphs.
    ctx = dispatch(ctx, {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(firstId, 0), createPosition(firstId, 0)),
    });
    ctx = dispatch(ctx, { type: "SPLIT_NODE" });
    // Type "X" in the SECOND paragraph.
    ctx = dispatch(ctx, { type: "INSERT_TEXT", text: "X" });

    const beforeEditor = ctx.editor;
    const before = renderFull(beforeEditor, ctx.config);
    const beforeRoot = before.root;
    if (beforeRoot.type !== "element") throw new Error("expected element root");
    const firstChildBefore = beforeRoot.children[0];

    // Undo the INSERT_TEXT. Only the second paragraph reverts; the first
    // paragraph's RenderNode must be ref-equal because the incremental path
    // (driven by undo's surfaced dirtyIds) skipped re-rendering it.
    ctx = dispatch(ctx, { type: "UNDO" });

    const after = renderIncremental(ctx.editor, ctx.config, before, beforeEditor);
    const afterRoot = after.root;
    if (afterRoot.type !== "element") throw new Error("expected element root");
    const firstChildAfter = afterRoot.children[0];
    expect(firstChildAfter).toBe(firstChildBefore);
  });
});
