/**
 * #424 — defense-in-depth: the core `SET_SELECTION` reducer chokepoint rejects
 * cross-context selection spans, so an invalid span (anchor in one context,
 * focus in another) can never enter editor state regardless of caller. A
 * "context" is the subtree a position lives in: the main document tree, OR one
 * specific footnote (embed) body, OR one specific header/footer (template) body.
 * `iterateSpan` throws on a cross-context span, so storing one is a latent crash
 * — this guard fails fast at the entry point (dev) and no-ops in production.
 *
 * The DOM controller already guards pointer-drag at the UX layer; this is the
 * engine backstop verified at the reducer level.
 */
import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState } from "./actions/test-helpers";
import type { EditorState } from "./editor-state";
import { selectionContextOf, getActiveFormatting, inlineContentLength, resolveBlock } from "../state";
import type { BlockId } from "../state";

/**
 * Build an editor with a footnote, returning the host (main-tree) block id and a
 * footnote-body block id — two genuinely different selection contexts.
 */
function withFootnote(): {
  editor: EditorState;
  hostId: BlockId;
  bodyId: BlockId;
} {
  const initial = createInitialEditorState(config);
  const typed = reduceEditor(initial, { type: "INSERT_TEXT", text: "abc" }, config);
  const hostId = typed.selection.focus.blockId;
  // INSERT_FOOTNOTE drops the caret into the footnote body — focus is now a
  // footnote-body block (a distinct context from the main host paragraph).
  const withFn = reduceEditor(typed, { type: "INSERT_FOOTNOTE" }, config);
  const bodyId = withFn.selection.focus.blockId;
  return { editor: withFn, hostId, bodyId };
}

describe("#424 — SET_SELECTION rejects cross-context spans", () => {
  it("throws in dev mode when anchor and focus are in different contexts", () => {
    const { editor, hostId, bodyId } = withFootnote();
    // Sanity: the two blocks really are in different contexts.
    expect(selectionContextOf(editor.state, hostId)).not.toBeNull();
    expect(selectionContextOf(editor.state, bodyId)).not.toBeNull();
    expect(selectionContextOf(editor.state, hostId)).not.toBe(
      selectionContextOf(editor.state, bodyId),
    );

    expect(() =>
      reduceEditor(
        editor,
        {
          type: "SET_SELECTION",
          selection: {
            anchor: { blockId: hostId, offset: 0 },
            focus: { blockId: bodyId, offset: 0 },
          },
        },
        config,
      ),
    ).toThrow(/cross-context/);
  });

  it("throws when a block id is unknown (null context)", () => {
    const { editor, hostId } = withFootnote();
    expect(() =>
      reduceEditor(
        editor,
        {
          type: "SET_SELECTION",
          selection: {
            anchor: { blockId: hostId, offset: 0 },
            focus: { blockId: "no-such-block" as BlockId, offset: 0 },
          },
        },
        config,
      ),
    ).toThrow(/cross-context/);
  });

  it("accepts an in-context span and updates the selection normally", () => {
    const { editor, hostId } = withFootnote();
    const next = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: hostId, offset: 0 },
          focus: { blockId: hostId, offset: 3 },
        },
      },
      config,
    );
    expect(next.selection.anchor).toEqual({ blockId: hostId, offset: 0 });
    expect(next.selection.focus).toEqual({ blockId: hostId, offset: 3 });
  });

  it("accepts an in-context span entirely inside a footnote body", () => {
    const { editor, bodyId } = withFootnote();
    const next = reduceEditor(
      editor,
      {
        type: "SET_SELECTION",
        selection: {
          anchor: { blockId: bodyId, offset: 0 },
          focus: { blockId: bodyId, offset: 0 },
        },
      },
      config,
    );
    expect(next.selection.focus.blockId).toBe(bodyId);
  });
});

/**
 * Sibling guard to SET_SELECTION's chokepoint: the document-boundary handlers
 * must be CONTEXT-AWARE (like SELECT_ALL), resolving the boundary WITHIN the
 * caret's selection context. Otherwise EXPAND_DOCUMENT_BOUNDARY from inside a
 * footnote body produces a cross-context span (anchor in the footnote, focus in
 * the main tree) that bypasses SET_SELECTION entirely and crashes the next
 * `iterateSpan`/`getActiveFormatting` consumer; MOVE_DOCUMENT_BOUNDARY escapes
 * the context (a Google-Docs-parity bug — Ctrl+End in a footnote should stay in
 * the footnote).
 */
describe("document-boundary handlers stay in the caret's selection context", () => {
  /** Type some text into the footnote body so it has a non-empty last offset. */
  function withFootnoteBodyText(text: string): {
    editor: EditorState;
    bodyRoot: BlockId;
    bodyLength: number;
  } {
    const { editor } = withFootnote();
    const typed = reduceEditor(editor, { type: "INSERT_TEXT", text }, config);
    const bodyBlockId = typed.selection.focus.blockId;
    const bodyRoot = selectionContextOf(typed.state, bodyBlockId);
    if (bodyRoot === null) throw new Error("test setup: footnote body has no context root");
    const block = resolveBlock(typed.state, bodyBlockId)?.block ?? null;
    if (block === null || block.inlineContent === null) {
      throw new Error("test setup: footnote body block missing inline content");
    }
    return {
      editor: typed,
      bodyRoot,
      bodyLength: inlineContentLength(block.inlineContent),
    };
  }

  it("EXPAND_DOCUMENT_BOUNDARY end from a footnote keeps both endpoints in the footnote", () => {
    const { editor, bodyRoot, bodyLength } = withFootnoteBodyText("note text");
    const next = reduceEditor(editor, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "end" }, config);

    const anchorCtx = selectionContextOf(next.state, next.selection.anchor.blockId);
    const focusCtx = selectionContextOf(next.state, next.selection.focus.blockId);
    expect(anchorCtx).not.toBeNull();
    expect(focusCtx).not.toBeNull();
    expect(anchorCtx).toBe(bodyRoot);
    expect(focusCtx).toBe(bodyRoot);
    // Focus lands at the footnote body's last position.
    expect(next.selection.focus.offset).toBe(bodyLength);
    // The resulting (in-context) span is iterable — no cross-context throw.
    expect(() => getActiveFormatting(next.state, next.selection)).not.toThrow();
  });

  it("EXPAND_DOCUMENT_BOUNDARY start from a footnote keeps both endpoints in the footnote", () => {
    const { editor, bodyRoot } = withFootnoteBodyText("note text");
    const next = reduceEditor(editor, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "start" }, config);

    expect(selectionContextOf(next.state, next.selection.anchor.blockId)).toBe(bodyRoot);
    expect(selectionContextOf(next.state, next.selection.focus.blockId)).toBe(bodyRoot);
    expect(next.selection.focus.offset).toBe(0);
    expect(() => getActiveFormatting(next.state, next.selection)).not.toThrow();
  });

  it("MOVE_DOCUMENT_BOUNDARY end from a footnote collapses at the footnote's last position", () => {
    const { editor, bodyRoot, bodyLength } = withFootnoteBodyText("note text");
    const next = reduceEditor(editor, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" }, config);

    expect(selectionContextOf(next.state, next.selection.focus.blockId)).toBe(bodyRoot);
    expect(next.selection.anchor).toEqual(next.selection.focus); // collapsed
    expect(next.selection.focus.offset).toBe(bodyLength);
  });

  it("MOVE_DOCUMENT_BOUNDARY start from a footnote collapses at the footnote's first position", () => {
    const { editor, bodyRoot } = withFootnoteBodyText("note text");
    const next = reduceEditor(editor, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "start" }, config);

    expect(selectionContextOf(next.state, next.selection.focus.blockId)).toBe(bodyRoot);
    expect(next.selection.anchor).toEqual(next.selection.focus); // collapsed
    expect(next.selection.focus.offset).toBe(0);
  });

  it("EXPAND_DOCUMENT_BOUNDARY from a MAIN-tree caret still spans the whole main document", () => {
    const initial = createInitialEditorState(config);
    const a = reduceEditor(initial, { type: "INSERT_TEXT", text: "first" }, config);
    const b = reduceEditor(a, { type: "SPLIT_NODE" }, config);
    const c = reduceEditor(b, { type: "INSERT_TEXT", text: "second" }, config);
    const mainRoot = c.state.rootId;
    // Caret is at the end of the second (last) paragraph; expand to start.
    const expanded = reduceEditor(c, { type: "EXPAND_DOCUMENT_BOUNDARY", boundary: "start" }, config);

    expect(selectionContextOf(expanded.state, expanded.selection.focus.blockId)).toBe(mainRoot);
    expect(expanded.selection.focus.offset).toBe(0);
    // Focus is the FIRST content block of the main document.
    const firstBlock = resolveBlock(expanded.state, expanded.selection.focus.blockId)?.block ?? null;
    if (firstBlock === null) throw new Error("expected a resolvable first block");
    expect(firstBlock.parentId).toBe(mainRoot);
  });

  it("MOVE_DOCUMENT_BOUNDARY from a MAIN-tree caret still moves to the main document end", () => {
    const initial = createInitialEditorState(config);
    const a = reduceEditor(initial, { type: "INSERT_TEXT", text: "first" }, config);
    const b = reduceEditor(a, { type: "SPLIT_NODE" }, config);
    const c = reduceEditor(b, { type: "INSERT_TEXT", text: "second" }, config);
    const mainRoot = c.state.rootId;
    // Move caret to start, then jump to document end.
    const atStart = reduceEditor(c, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "start" }, config);
    const atEnd = reduceEditor(atStart, { type: "MOVE_DOCUMENT_BOUNDARY", boundary: "end" }, config);

    expect(selectionContextOf(atEnd.state, atEnd.selection.focus.blockId)).toBe(mainRoot);
    expect(atEnd.selection.anchor).toEqual(atEnd.selection.focus); // collapsed
    const lastBlock = resolveBlock(atEnd.state, atEnd.selection.focus.blockId)?.block ?? null;
    if (lastBlock === null || lastBlock.inlineContent === null) {
      throw new Error("expected a resolvable last content block");
    }
    expect(atEnd.selection.focus.offset).toBe(inlineContentLength(lastBlock.inlineContent));
  });
});
