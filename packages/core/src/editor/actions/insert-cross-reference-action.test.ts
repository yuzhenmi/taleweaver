/**
 * XR.S5: `INSERT_CROSS_REFERENCE` editor action + handler.
 *
 * Dispatching INSERT_CROSS_REFERENCE splices a `cross-reference` EmbedItem at the
 * caret pointing at an explicit target, placing a collapsed caret just after the
 * one-offset-unit field. The handler structurally validates the target (the S1
 * op trusts targetId): main-tree existence + kind-for-mode, and rejects (no-op)
 * a ref attempted inside a footnote/header/footer body. Tested through
 * `reduceEditor`, asserting via `getBlock` over the host's inline content.
 */
import { describe, it, expect } from "vitest";
import {
  config,
  reduceEditor,
  createInitialEditorState,
  stateWithTwoParagraphs,
  firstChildId,
  blockEnd,
  getTextOf,
  type EditorState,
} from "./test-helpers";
import {
  getBlock,
  getEmbedContent,
  getListDefsForState,
  classifyListDef,
  createPosition,
  createSpan,
  CROSS_REFERENCE_EMBED_TYPE,
} from "../../state";
import type { BlockId } from "../../state";

/** The cross-reference embeds in a block's inline content (targetId + refMode). */
function crossRefsOf(
  editor: EditorState,
  blockId: BlockId,
): ReadonlyArray<{ targetId: unknown; refMode: unknown }> {
  const items = getBlock(editor.state, blockId)?.inlineContent?.items ?? [];
  const out: { targetId: unknown; refMode: unknown }[] = [];
  for (const it of items) {
    if (it.kind === "embed" && it.embedType === CROSS_REFERENCE_EMBED_TYPE) {
      out.push({ targetId: it.properties.targetId, refMode: it.properties.refMode });
    }
  }
  return out;
}

/** Put a collapsed caret at the end of `blockId`. */
function caretAtEnd(editor: EditorState, blockId: BlockId): EditorState {
  const pos = createPosition(blockId, blockEnd(editor.state, blockId));
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(pos, pos) }, config);
}

describe("handleInsertCrossReference — INSERT_CROSS_REFERENCE", () => {
  it("splices a text-mode reference at the caret and places the caret after it", () => {
    // Two paragraphs: target "abc" (first child) and host "def" (caret at end).
    const doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state);
    if (targetId === null) throw new Error("no target paragraph");
    const hostId = doc.selection.focus.blockId;
    const offsetBefore = doc.selection.focus.offset; // end of "def" = 3

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "text" },
      config,
    );

    expect(crossRefsOf(out, hostId)).toEqual([{ targetId, refMode: "text" }]);
    // Caret one unit past the insertion point (the field is one offset unit).
    expect(out.selection.focus.blockId).toBe(hostId);
    expect(out.selection.focus.offset).toBe(offsetBefore + 1);
    expect(out.selection.anchor).toEqual(out.selection.focus); // collapsed
  });

  it("is its own undo unit — undo removes the inserted reference", () => {
    const doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state);
    if (targetId === null) throw new Error("no target paragraph");
    const hostId = doc.selection.focus.blockId;

    const inserted = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "text" },
      config,
    );
    expect(crossRefsOf(inserted, hostId)).toHaveLength(1);

    const undone = reduceEditor(inserted, { type: "UNDO" }, config);
    expect(crossRefsOf(undone, hostId)).toHaveLength(0);
  });

  it("replaces a non-collapsed selection (deletes it) and inserts the field, as one undo step", () => {
    // Host "def"; select "e" (offset 1..2) and insert a text-ref to "abc".
    const doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state);
    if (targetId === null) throw new Error("no target paragraph");
    const hostId = doc.selection.focus.blockId;
    const sel = reduceEditor(
      doc,
      { type: "SET_SELECTION", selection: createSpan(createPosition(hostId, 1), createPosition(hostId, 2)) },
      config,
    );

    const out = reduceEditor(
      sel,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "text" },
      config,
    );
    // "e" deleted; the ref sits between "d" and "f"; caret just after the ref.
    expect(getTextOf(out.state, hostId)).toBe("df");
    expect(crossRefsOf(out, hostId)).toEqual([{ targetId, refMode: "text" }]);
    expect(out.selection.focus.offset).toBe(2); // after "d" + the 1-unit field

    // ONE undo step restores the deleted text AND removes the field.
    const undone = reduceEditor(out, { type: "UNDO" }, config);
    expect(getTextOf(undone.state, hostId)).toBe("def");
    expect(crossRefsOf(undone, hostId)).toHaveLength(0);
  });

  it("inserts a number-mode reference when the target is a list-item", () => {
    // Make the first paragraph a list-item, then reference it by number from the
    // second paragraph.
    let doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state);
    if (targetId === null) throw new Error("no target paragraph");
    // Select into the target and toggle it to an ordered list.
    const targetStart = createPosition(targetId, 0);
    doc = reduceEditor(doc, { type: "SET_SELECTION", selection: createSpan(targetStart, targetStart) }, config);
    doc = reduceEditor(doc, { type: "TOGGLE_LIST", listType: "ordered" }, config);
    const targetBlock = getBlock(doc.state, targetId);
    expect(targetBlock?.type).toBe("list-item");
    // Confirm the target is genuinely ORDERED (not just list-item-typed) — the
    // handler's number-mode gate rejects unordered items, so this proves the
    // positive path passes the real gate.
    const listId = targetBlock?.attrs["listId"];
    const def = typeof listId === "string" ? getListDefsForState(doc.state).get(listId) : undefined;
    expect(def !== undefined && classifyListDef(def) === "ordered").toBe(true);

    // Caret back into the host paragraph (the last child), at its end.
    const root = getBlock(doc.state, doc.state.rootId);
    const hostId = root?.lastChildId;
    if (hostId === undefined || hostId === null) throw new Error("no host");
    doc = caretAtEnd(doc, hostId);

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "number" },
      config,
    );
    expect(crossRefsOf(out, hostId)).toEqual([{ targetId, refMode: "number" }]);
  });

  it("rejects a number-mode reference to a non-list-item target (no-op)", () => {
    const doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state); // a plain paragraph
    if (targetId === null) throw new Error("no target paragraph");
    const hostId = doc.selection.focus.blockId;

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "number" },
      config,
    );
    expect(crossRefsOf(out, hostId)).toHaveLength(0); // nothing inserted
  });

  it("rejects a number-mode reference to an UNORDERED list-item target (no-op)", () => {
    // An unordered (bulleted) item has no number to reference — it would resolve
    // to a bullet glyph, so the handler rejects it.
    let doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state);
    if (targetId === null) throw new Error("no target paragraph");
    const targetStart = createPosition(targetId, 0);
    doc = reduceEditor(doc, { type: "SET_SELECTION", selection: createSpan(targetStart, targetStart) }, config);
    doc = reduceEditor(doc, { type: "TOGGLE_LIST", listType: "unordered" }, config);
    const listId = getBlock(doc.state, targetId)?.attrs["listId"];
    const def = typeof listId === "string" ? getListDefsForState(doc.state).get(listId) : undefined;
    expect(def !== undefined && classifyListDef(def) === "unordered").toBe(true);

    const root = getBlock(doc.state, doc.state.rootId);
    const hostId = root?.lastChildId;
    if (hostId === undefined || hostId === null) throw new Error("no host");
    doc = caretAtEnd(doc, hostId);

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "number" },
      config,
    );
    expect(crossRefsOf(out, hostId)).toHaveLength(0); // nothing inserted
  });

  it("rejects a reference to a dangling (nonexistent) target (no-op)", () => {
    const doc = stateWithTwoParagraphs();
    const hostId = doc.selection.focus.blockId;

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId: "ghost" as BlockId, refMode: "text" },
      config,
    );
    expect(crossRefsOf(out, hostId)).toHaveLength(0);
  });

  it("inserts a page-mode reference (default decimal numberStyle) and places the caret after it", () => {
    const doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state); // an inline-bearing paragraph
    if (targetId === null) throw new Error("no target paragraph");
    const hostId = doc.selection.focus.blockId;
    const offsetBefore = doc.selection.focus.offset;

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "page" },
      config,
    );

    // The embed carries refMode "page" and the default "decimal" numberStyle.
    const items = getBlock(out.state, hostId)?.inlineContent?.items ?? [];
    const embed = items.find(
      (it) => it.kind === "embed" && it.embedType === CROSS_REFERENCE_EMBED_TYPE,
    );
    expect(embed?.kind).toBe("embed");
    if (embed?.kind !== "embed") throw new Error("no cross-ref embed");
    expect(embed.properties.refMode).toBe("page");
    expect(embed.properties.targetId).toBe(targetId);
    expect(embed.properties.numberStyle).toBe("decimal");
    // Caret one unit past the one-offset-unit field.
    expect(out.selection.focus.offset).toBe(offsetBefore + 1);
    expect(out.selection.anchor).toEqual(out.selection.focus);
  });

  it("stores a non-default numberStyle for a page-mode reference", () => {
    const doc = stateWithTwoParagraphs();
    const targetId = firstChildId(doc.state);
    if (targetId === null) throw new Error("no target paragraph");
    const hostId = doc.selection.focus.blockId;

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId, refMode: "page", numberStyle: "upper-roman" },
      config,
    );

    const items = getBlock(out.state, hostId)?.inlineContent?.items ?? [];
    const embed = items.find(
      (it) => it.kind === "embed" && it.embedType === CROSS_REFERENCE_EMBED_TYPE,
    );
    if (embed?.kind !== "embed") throw new Error("no cross-ref embed");
    expect(embed.properties.numberStyle).toBe("upper-roman");
  });

  it("rejects a page-mode reference to a container target (no inline content → no-op)", () => {
    // The root block is a main-tree container (holds blocks, not inline items), so
    // `inlineContent === null` — page mode (like text mode) requires an inline-bearing
    // target with a deterministic page, and rejects a container.
    const doc = stateWithTwoParagraphs();
    const hostId = doc.selection.focus.blockId;

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId: doc.state.rootId, refMode: "page" },
      config,
    );
    expect(crossRefsOf(out, hostId)).toHaveLength(0); // nothing inserted
  });

  it("rejects a reference attempted inside a footnote body (body-text only)", () => {
    // Insert a footnote — the caret lands in the footnote body paragraph.
    let doc = createInitialEditorState(config);
    doc = reduceEditor(doc, { type: "INSERT_TEXT", text: "x" }, config);
    const bodyTargetId = firstChildId(doc.state); // a valid main-tree target
    if (bodyTargetId === null) throw new Error("no target");
    doc = reduceEditor(doc, { type: "INSERT_FOOTNOTE" }, config);
    const fnBodyParaId = doc.selection.focus.blockId; // caret is in the footnote body

    // Sanity: the caret really is in a footnote body (an embedContents block),
    // not the main tree.
    expect(getEmbedContent(doc.state, fnBodyParaId)).not.toBeNull();

    const out = reduceEditor(
      doc,
      { type: "INSERT_CROSS_REFERENCE", targetId: bodyTargetId, refMode: "text" },
      config,
    );
    // No cross-reference spliced into the footnote body paragraph.
    expect(crossRefsOf(out, fnBodyParaId)).toHaveLength(0);
  });
});
