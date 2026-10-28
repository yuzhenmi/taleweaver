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
  bodyBlockIds,
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
  collectBookmarks,
} from "../../state";
import type { BlockId } from "../../state";
import type { EditorAction } from "../editor-action";
import { render } from "../../render/render";
import type { RenderNode } from "../../render/render-node";
import { BROKEN_CROSS_REFERENCE_TEXT } from "../../render/resolve-cross-reference";
import { moveByCharacter, caretAfterMarkers } from "../../cursor/cursor-ops";
import { extractFragment, encodeFragmentClip, findMatches, iterateBlocksInDocumentOrder } from "../../state";

/**
 * The cross-reference embeds in a block's inline content, each as the paragraph its
 * bookmark STARTS in (`targetId`) + `refMode` (a field targets a bookmark).
 */
function crossRefsOf(
  editor: EditorState,
  blockId: BlockId,
): ReadonlyArray<{ targetId: unknown; refMode: unknown }> {
  const items = getBlock(editor.state, blockId)?.inlineContent?.items ?? [];
  const bookmarks = collectBookmarks(editor.state);
  const out: { targetId: unknown; refMode: unknown }[] = [];
  for (const it of items) {
    if (it.kind === "embed" && it.embedType === CROSS_REFERENCE_EMBED_TYPE) {
      const id = it.properties.bookmarkId;
      out.push({ targetId: typeof id === "string" ? bookmarks.get(id)?.start.blockId : undefined, refMode: it.properties.refMode });
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
    const hostId = bodyBlockIds(doc.state).at(-1);
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

    const hostId = bodyBlockIds(doc.state).at(-1);
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
    expect(crossRefsOf(out, hostId)[0]?.targetId).toBe(targetId);
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

describe("cross-references target bookmarks (Word's model)", () => {
  /** The displayed value of the (only) cross-reference field, from a full render. */
  function fieldText(e: EditorState): string {
    let found: string | null = null;
    const walk = (n: RenderNode): void => {
      if (n.type !== "element") return;
      if (n.metadata?.embedType === CROSS_REFERENCE_EMBED_TYPE) {
        const c = n.children[0];
        found = c !== undefined && c.type === "text" ? c.text : null;
      }
      for (const ch of n.children) walk(ch);
    };
    walk(render(e.state, config.componentRegistry, config.attrRegistry).root);
    if (found === null) throw new Error("no cross-reference field rendered");
    return found;
  }
  const at = (e: EditorState, id: BlockId, a: number, b = a): EditorState =>
    reduceEditor(e, { type: "SET_SELECTION", selection: createSpan(createPosition(id, a), createPosition(id, b)) }, config);
  /** "Title" (heading T) | "x" (host, holding a text-mode field to T). */
  function withRef(refMode: "text" | "number" = "text", refConfig = config, textConfig = config): { e: EditorState; t: BlockId } {
    let e = createInitialEditorState(config);
    if (refMode === "number") e = reduceEditor(e, { type: "TOGGLE_LIST", listType: "ordered" }, config);
    else e = reduceEditor(e, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } }, config);
    e = reduceEditor(e, { type: "INSERT_TEXT", text: "Title" }, textConfig);
    e = reduceEditor(e, { type: "SPLIT_NODE" }, config);
    const t = bodyBlockIds(e.state)[0];
    if (t === undefined) throw new Error("no target");
    const host = bodyBlockIds(e.state)[1];
    if (host === undefined) throw new Error("no host");
    e = reduceEditor(at(e, host, 0), { type: "SET_BLOCK_TYPE", blockType: "paragraph" }, config);
    e = reduceEditor(e, { type: "INSERT_CROSS_REFERENCE", targetId: t, refMode }, refConfig);
    return { e, t };
  }

  it("Enter at the END of the target heading: the bookmark stays on its text", () => {
    const { e, t } = withRef();
    expect(fieldText(e)).toBe("Title");
    const len = getBlock(e.state, t)?.inlineContent?.items.length ?? 0;
    expect(len).toBe(3); // start marker, "Title", end marker
    const after = reduceEditor(at(e, t, 7), { type: "SPLIT_NODE" }, config);
    expect(fieldText(after)).toBe("Title");
  });

  it("Enter at (T, 0): the empty head is OUTSIDE the bookmark; text and number are unchanged", () => {
    for (const offset of [0, 1]) {
      const { e, t } = withRef();
      const after = reduceEditor(at(e, t, offset), { type: "SPLIT_NODE" }, config);
      expect(fieldText(after)).toBe("Title"); // no leading "\n"
      const head = bodyBlockIds(after.state)[0];
      expect(head === undefined ? null : getTextOf(after.state, head)).toBe("");
      expect(getBlock(after.state, head ?? t)?.inlineContent?.items).toEqual([]);
    }
    const { e: n, t: li } = withRef("number");
    expect(fieldText(n)).toBe("1");
    const after = reduceEditor(at(n, li, 1), { type: "SPLIT_NODE" }, config);
    // The bookmark start still holds the item's text — the second item now.
    expect(fieldText(after)).toBe("2");
  });

  it("a split of the bookmarked text and a merge into it keep the reference", () => {
    const { e, t } = withRef();
    const split = reduceEditor(at(e, t, 3), { type: "SPLIT_NODE" }, config);
    expect(fieldText(split)).toBe("Ti\ntle");
    const merged = reduceEditor(split, { type: "DELETE_BACKWARD" }, config);
    expect(fieldText(merged)).toBe("Title");
  });

  it("deleting the whole bookmarked text breaks the reference; a partial delete keeps it on the rest", () => {
    // reduceEditor mutates the shared Y.Doc: each case starts from a fresh document.
    const { e, t } = withRef();
    const partial = reduceEditor(at(e, t, 1, 3), { type: "DELETE_BACKWARD" }, config);
    expect(fieldText(partial)).toBe("tle");
    // Selecting the text from inside the start marker to after the end marker.
    const w = withRef();
    const whole = reduceEditor(at(w.e, w.t, 1, 7), { type: "DELETE_BACKWARD" }, config);
    expect(fieldText(whole)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(getBlock(whole.state, w.t)?.inlineContent?.items).toEqual([]);
    expect(whole.selection.focus).toEqual(createPosition(w.t, 0)); // the seam, not past the removed start marker
    // Typing over EXACTLY the bookmarked text: the text replaces it (the bookmark goes) at the seam.
    const o = withRef();
    const over = reduceEditor(at(o.e, o.t, 1, 6), { type: "INSERT_TEXT", text: "New" }, config);
    expect(getTextOf(over.state, o.t)).toBe("New");
    expect(fieldText(over)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(over.selection.focus).toEqual(createPosition(o.t, 3));
    // A span covering the start marker but not all the text keeps both markers.
    const f = withRef();
    const fromStart = reduceEditor(at(f.e, f.t, 0, 3), { type: "DELETE_BACKWARD" }, config);
    expect(fieldText(fromStart)).toBe("tle");
  });

  /** The id of the bookmark around T (its first item is the start marker). */
  const bookmarkIdIn = (e: EditorState, t: BlockId): string => {
    const first = getBlock(e.state, t)?.inlineContent?.items[0];
    return first?.kind === "embed" ? String(first.properties.bookmarkId) : "";
  };

  it("affinity: every caret insertion at the bookmark's start lands inside, at its end outside (Word)", () => {
    /** T's items as embed types / text runs. */
    const shape = (e: EditorState, t: BlockId): string[] =>
      (getBlock(e.state, t)?.inlineContent?.items ?? []).map((i) => (i.kind === "embed" ? i.embedType : i.text));
    // T = [start] "Title" [end]: offsets 0 and 1 are both "the start", 6 and 7 "the end".
    for (const offset of [0, 1]) {
      const { e, t } = withRef();
      const typed = reduceEditor(at(e, t, offset), { type: "INSERT_TEXT", text: "X" }, config);
      expect(fieldText(typed)).toBe("XTitle");
      expect(typed.selection.focus).toEqual(createPosition(t, 2)); // after the start marker and "X"
      // Paste, a line break and an inline field take the same gap as typing.
      const p = withRef();
      const pasted = reduceEditor(at(p.e, p.t, offset), { type: "PASTE", text: "X" }, config);
      expect(fieldText(pasted)).toBe("XTitle");
      expect(pasted.selection.focus).toEqual(createPosition(p.t, 2));
      const embeds: ReadonlyArray<[string, (t: BlockId) => EditorAction]> = [
        ["hard-break", () => ({ type: "INSERT_LINE_BREAK" })],
        [CROSS_REFERENCE_EMBED_TYPE, (t) => ({ type: "INSERT_CROSS_REFERENCE", targetId: t, refMode: "text" })],
        ["tab", () => ({ type: "INSERT_TAB" })],
        ["inline-image", () => ({ type: "INSERT_INLINE_IMAGE", src: "a.png", width: 1, height: 1, alt: "" })],
        ["footnote-anchor", () => ({ type: "INSERT_FOOTNOTE" })],
      ];
      for (const [embedType, action] of embeds) {
        const b = withRef();
        const inserted = reduceEditor(at(b.e, b.t, offset), action(b.t), config);
        expect(shape(inserted, b.t)).toEqual(["bookmark-start", embedType, "Title", "bookmark-end"]);
      }
      // Enter at the start leaves the caret before the marker; a paste there still lands inside.
      const n = withRef();
      const entered = reduceEditor(at(n.e, n.t, offset), { type: "SPLIT_NODE" }, config);
      const enterPasted = reduceEditor(entered, { type: "PASTE", text: "X" }, config);
      expect(fieldText(enterPasted)).toBe("XTitle");
    }
    for (const offset of [6, 7]) {
      const { e, t } = withRef();
      const typed = reduceEditor(at(e, t, offset), { type: "INSERT_TEXT", text: "X" }, config);
      expect(fieldText(typed)).toBe("Title");
      expect(getTextOf(typed.state, t)).toBe("TitleX");
      expect(typed.selection.focus).toEqual(createPosition(t, 8));
    }
  });

  it("affinity: one character move crosses a character, never stops between a marker and its neighbour", () => {
    const { e, t } = withRef();
    const s = e.state;
    expect(caretAfterMarkers(s, createPosition(t, 0))).toEqual(createPosition(t, 1));
    expect(caretAfterMarkers(s, createPosition(t, 6))).toEqual(createPosition(t, 7));
    expect(caretAfterMarkers(s, createPosition(t, 3))).toEqual(createPosition(t, 3));
    expect(moveByCharacter(s, createPosition(t, 0), "forward")).toEqual(createPosition(t, 2));
    expect(moveByCharacter(s, createPosition(t, 5), "forward")).toEqual(createPosition(t, 7));
    expect(moveByCharacter(s, createPosition(t, 7), "backward")).toEqual(createPosition(t, 5));
    expect(moveByCharacter(s, createPosition(t, 2), "backward")).toEqual(createPosition(t, 1));
    // Crossing into a paragraph that starts with a marker lands after it.
    const host = bodyBlockIds(s)[1] ?? t;
    expect(moveByCharacter(s, createPosition(host, 0), "backward")).toEqual(createPosition(t, 7));
  });

  it("affinity: Backspace at the bookmark's start merges in one keypress; Delete before its end marker joins the next ¶", () => {
    const { e, t } = withRef();
    const split = reduceEditor(at(e, t, 0), { type: "SPLIT_NODE" }, config); // "" | [Title] | host
    expect(bodyBlockIds(split.state)).toHaveLength(3);
    const merged = reduceEditor(at(split, t, 1), { type: "DELETE_BACKWARD" }, config);
    expect(bodyBlockIds(merged.state)).toHaveLength(2);
    expect(fieldText(merged)).toBe("Title");
    const w = withRef();
    const joined = reduceEditor(at(w.e, w.t, 6), { type: "DELETE_FORWARD" }, config);
    expect(bodyBlockIds(joined.state)).toHaveLength(1);
    expect(fieldText(joined)).toBe("Title");
  });

  it("cut + paste of EXACTLY the bookmarked text moves the bookmark (same id); the reference resolves there", () => {
    const { e, t } = withRef();
    const bid = bookmarkIdIn(e, t);
    const sel = at(e, t, 1, 6);
    const clip = encodeFragmentClip(extractFragment(sel.state, sel.selection));
    const cut = reduceEditor(sel, { type: "DELETE_BACKWARD" }, config);
    expect(fieldText(cut)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    const host = bodyBlockIds(cut.state)[1];
    if (host === undefined) throw new Error("no host");
    const pasted = reduceEditor(at(cut, host, 0), { type: "PASTE", clip, text: "Title" }, config);
    expect(fieldText(pasted)).toBe("Title");
    expect(collectBookmarks(pasted.state).get(bid)?.start.blockId).toBe(host);
    // Undo the paste, then the cut: the original is live again.
    const undone = reduceEditor(reduceEditor(pasted, { type: "UNDO" }, config), { type: "UNDO" }, config);
    expect(fieldText(undone)).toBe("Title");
    expect(collectBookmarks(undone.state).get(bid)?.start).toEqual(createPosition(t, 1));
  });

  it("a copy of part of the bookmarked text carries no bookmark markers", () => {
    const { e, t } = withRef();
    const sel = at(e, t, 0, 3);
    const frag = extractFragment(sel.state, sel.selection);
    expect(collectBookmarks(frag).size).toBe(0);
    let markers = 0;
    for (const b of iterateBlocksInDocumentOrder(frag)) for (const i of b.inlineContent?.items ?? []) if (i.kind === "embed") markers++;
    expect(markers).toBe(0);
  });

  it("paste into ANOTHER document (editor paste path) keeps the bookmark", () => {
    const { e, t } = withRef();
    const bid = bookmarkIdIn(e, t);
    const sel = at(e, t, 0, 7);
    const clip = encodeFragmentClip(extractFragment(sel.state, sel.selection));
    const other = reduceEditor(createInitialEditorState(config), { type: "PASTE", clip, text: "Title" }, config);
    const range = collectBookmarks(other.state).get(bid);
    expect(range?.start.blockId).toBe(bodyBlockIds(other.state)[0]);
    // A copy WITHIN the source document drops it (the original stays the live pair).
    const host = bodyBlockIds(e.state)[1];
    if (host === undefined) throw new Error("no host");
    const inDoc = reduceEditor(at(e, host, 0), { type: "PASTE", clip, text: "Title" }, config);
    expect(collectBookmarks(inDoc.state).get(bid)?.start.blockId).toBe(t);
    const hostItems = getBlock(inDoc.state, host)?.inlineContent?.items ?? [];
    expect(hostItems.some((i) => i.kind === "embed" && i.embedType.startsWith("bookmark-"))).toBe(false);
  });

  it("bookmark markers are untracked in suggesting mode; rejecting leaves the bookmark, accepting a deletion of all its text removes it", () => {
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const { e, t } = withRef("text", suggesting);
    const bid = bookmarkIdIn(e, t);
    const markers = (getBlock(e.state, t)?.inlineContent?.items ?? []).filter((i) => i.kind === "embed");
    expect(markers).toHaveLength(2);
    for (const m of markers) expect(m.attrs).toEqual({});
    const rejected = reduceEditor(e, { type: "REJECT_ALL_SUGGESTIONS" }, suggesting);
    expect(collectBookmarks(rejected.state).get(bid)).toEqual({ start: createPosition(t, 1), end: createPosition(t, 6) });
    // Accepting a tracked deletion of EXACTLY the bookmarked text removes the bookmark, as the
    // direct deletion does: the reference is broken.
    const s = withRef();
    const struck = reduceEditor(at(s.e, s.t, 1, 6), { type: "DELETE_BACKWARD" }, suggesting);
    expect(collectBookmarks(struck.state).has(bookmarkIdIn(s.e, s.t))).toBe(true);
    const accepted = reduceEditor(struck, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggesting);
    expect(fieldText(accepted)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(getBlock(accepted.state, s.t)?.inlineContent?.items).toEqual([]);
    // The bookmarked text is the deleter's OWN pending insertion: a suggested deletion removes it
    // for real — the bookmark goes as on a direct deletion.
    const own = withRef("text", config, suggesting);
    const ownGone = reduceEditor(at(own.e, own.t, 1, 6), { type: "DELETE_BACKWARD" }, suggesting);
    expect(fieldText(ownGone)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(getBlock(ownGone.state, own.t)?.inlineContent?.items).toEqual([]);
    // Typing / pasting over it: the new text lands at the seam (where the removed start marker
    // was) and the caret right after it.
    const ty = withRef("text", config, suggesting);
    const typed = reduceEditor(at(ty.e, ty.t, 1, 6), { type: "INSERT_TEXT", text: "New" }, suggesting);
    expect(getTextOf(typed.state, ty.t)).toBe("New");
    expect(fieldText(typed)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(typed.selection.focus).toEqual(createPosition(ty.t, 3));
    const pa = withRef("text", config, suggesting);
    const pasted = reduceEditor(at(pa.e, pa.t, 1, 6), { type: "PASTE", text: "New" }, suggesting);
    expect(getTextOf(pasted.state, pa.t)).toBe("New");
    expect(pasted.selection.focus).toEqual(createPosition(pa.t, 3));
    // Enter over it: the split lands where the removed text and markers were.
    const en = withRef("text", config, suggesting);
    const withTail = reduceEditor(at(en.e, en.t, 7), { type: "INSERT_TEXT", text: "Z" }, config); // [Title]Z
    const entered = reduceEditor(at(withTail, en.t, 1, 6), { type: "SPLIT_NODE" }, suggesting);
    expect(fieldText(entered)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(getTextOf(entered.state, en.t)).toBe("Z");
    // Two tracked deletions with kept text between them do not cover all of it: the bookmark stays.
    const g = withRef();
    const first = reduceEditor(at(g.e, g.t, 1, 2), { type: "DELETE_BACKWARD" }, suggesting);
    const both = reduceEditor(at(first, g.t, 4, 6), { type: "DELETE_BACKWARD" }, suggesting);
    expect(fieldText(reduceEditor(both, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggesting))).toBe("it");
  });

  it("find / replace keeps a bookmark unless the replaced text is all of it", () => {
    // Replacing part of the text keeps the bookmark on the rest.
    const { e } = withRef();
    const head = findMatches(e.state, "Ti", { caseSensitive: true });
    const partial = reduceEditor(e, { type: "REPLACE_ALL", matches: head, replacement: "Q" }, config);
    expect(fieldText(partial)).toBe("Qtle");
    const tail = withRef();
    const end = reduceEditor(tail.e, { type: "REPLACE_ALL", matches: findMatches(tail.e.state, "le", { caseSensitive: true }), replacement: "Z" }, config);
    // The replacement takes the replaced text's place (as typing over a selection does): inside.
    expect(fieldText(end)).toBe("TitZ");
    // Replacing ALL the bookmarked text removes the bookmark.
    const w = withRef();
    const whole = reduceEditor(w.e, { type: "REPLACE_ALL", matches: findMatches(w.e.state, "Title", { caseSensitive: true }), replacement: "New" }, config);
    expect(fieldText(whole)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    expect(getTextOf(whole.state, w.t)).toBe("New");
    expect(whole.selection.focus).toEqual(createPosition(w.t, 0)); // the seam, where the removed start marker was
  });

  it("a cross-block delete keeps a bookmark in a FULLY crossed paragraph unless it covers all its content", () => {
    // "ab" | [Title] | host — deleting from (A, 1) into the host crosses T entirely.
    const { e, t } = withRef();
    const pre = reduceEditor(at(e, t, 0), { type: "SPLIT_NODE" }, config);
    const a = bodyBlockIds(pre.state)[0];
    if (a === undefined) throw new Error("no head");
    const typed = reduceEditor(at(pre, a, 0), { type: "INSERT_TEXT", text: "ab" }, config);
    const host = bodyBlockIds(typed.state)[2];
    if (host === undefined) throw new Error("no host");
    // T's content is covered entirely: the bookmark goes (broken), and no orphan marker is left.
    const sel = reduceEditor(typed, { type: "SET_SELECTION", selection: createSpan(createPosition(a, 1), createPosition(host, 0)) }, config);
    const gone = reduceEditor(sel, { type: "DELETE_BACKWARD" }, config);
    expect(fieldText(gone)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    const survivor = bodyBlockIds(gone.state)[0];
    const items = survivor === undefined ? [] : (getBlock(gone.state, survivor)?.inlineContent?.items ?? []);
    expect(items.some((i) => i.kind === "embed" && i.embedType.startsWith("bookmark-"))).toBe(false);
  });

  it("a cross-block delete crossing a paragraph that holds one marker of a bookmark: one removed set for the whole span", () => {
    // "ab" | [Ti | tle] — the bookmark spans T's head H and T; the delete crosses H entirely.
    const build = (): { e: EditorState; a: BlockId; t: BlockId } => {
      const { e, t } = withRef();
      const s1 = reduceEditor(at(e, t, 3), { type: "SPLIT_NODE" }, config); // [Ti | tle]
      const head = bodyBlockIds(s1.state)[0];
      if (head === undefined) throw new Error("no head");
      const s2 = reduceEditor(at(s1, head, 0), { type: "SPLIT_NODE" }, config); // "" | [Ti | tle]
      const a = bodyBlockIds(s2.state)[0];
      if (a === undefined) throw new Error("no a");
      const typed = reduceEditor(at(s2, a, 0), { type: "INSERT_TEXT", text: "ab" }, config);
      expect(fieldText(typed)).toBe("Ti\ntle");
      return { e: typed, a, t };
    };
    const del = (b: { e: EditorState; a: BlockId; t: BlockId }, focus: number): EditorState =>
      reduceEditor(
        reduceEditor(b.e, { type: "SET_SELECTION", selection: createSpan(createPosition(b.a, 1), createPosition(b.t, focus)) }, config),
        { type: "DELETE_BACKWARD" },
        config,
      );
    // Not all of its content: the crossed start marker is kept at the collapse point.
    expect(fieldText(del(build(), 2))).toBe("e");
    // All of its content ("Ti" in H, "tle" in T): the bookmark goes — no orphan marker of it stays.
    const gone = del(build(), 3);
    expect(fieldText(gone)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    const all = bodyBlockIds(gone.state).flatMap((id) => getBlock(gone.state, id)?.inlineContent?.items ?? []);
    expect(all.some((i) => i.kind === "embed" && i.embedType.startsWith("bookmark-"))).toBe(false);
    // Accepting a tracked deletion of the same span: one removed set over every block it drops from.
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const b = build();
    const sel = reduceEditor(b.e, { type: "SET_SELECTION", selection: createSpan(createPosition(b.a, 1), createPosition(b.t, 3)) }, config);
    const accepted = reduceEditor(reduceEditor(sel, { type: "DELETE_BACKWARD" }, suggesting), { type: "ACCEPT_ALL_SUGGESTIONS" }, suggesting);
    expect(fieldText(accepted)).toBe(BROKEN_CROSS_REFERENCE_TEXT);
    // [Ti | t | le]: tracked deletions of "Ti" and "le" leave the untouched middle paragraph's text — the bookmark stays.
    const m = build();
    const split = reduceEditor(at(m.e, m.t, 1), { type: "SPLIT_NODE" }, config); // T = "t" | "le"
    const [h, mid, tl] = bodyBlockIds(split.state).slice(1, 4);
    if (h === undefined || mid === undefined || tl === undefined) throw new Error("no blocks");
    const d1 = reduceEditor(reduceEditor(split, { type: "SET_SELECTION", selection: createSpan(createPosition(h, 1), createPosition(h, 3)) }, config), { type: "DELETE_BACKWARD" }, suggesting);
    const d2 = reduceEditor(reduceEditor(d1, { type: "SET_SELECTION", selection: createSpan(createPosition(tl, 0), createPosition(tl, 2)) }, config), { type: "DELETE_BACKWARD" }, suggesting);
    expect(fieldText(reduceEditor(d2, { type: "ACCEPT_ALL_SUGGESTIONS" }, suggesting))).toBe("\nt\n");
  });
});
