/**
 * Undo across collaboration, through the real reducer + two synced Y.Docs:
 *   - a peer's FORMAT over the user's just-typed text does not break the user's
 *     open undo entry (one `Y.Text` per block: formatting never re-mints chars);
 *   - undo selections are CRDT-anchored (RelativePositions): a peer's insert BEFORE
 *     the stored caret does not leave the restored caret stale, a peer split moves
 *     it to the block that now holds its character, and a stored selection whose
 *     block is gone falls back to the undo's own (rebased) caret.
 */
import { TEST_RESOLVER } from "../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createInitialEditorState,
  createEditorStateFromState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  getYDoc,
  subscribeRemoteChanges,
  createState,
  getBlock,
  createPosition,
  createSpan,
  extractText,
  initialSelectionForState,
  type EditorAction,
  type EditorConfig,
  type EditorState,
  type BlockId,
  collectBookmarks,
  extractFragment,
  encodeFragmentClip,
} from "../index";

const config: EditorConfig = {
  componentRegistry: createDefaultComponentRegistry(),
  attrRegistry: createDefaultAttrRegistry(),
  containerWidth: 800,
};

const at = (id: BlockId, offset: number) => createPosition(id, offset);
const caret = (id: BlockId, offset: number): EditorAction => ({
  type: "SET_SELECTION",
  selection: createSpan(at(id, offset), at(id, offset)),
});

function textOf(editor: EditorState, id: BlockId): string {
  const block = getBlock(editor.state, id);
  const len = block?.inlineContent?.items.reduce((n, i) => n + (i.kind === "text" ? i.text.length : 1), 0) ?? 0;
  return extractText(editor.state, createSpan(at(id, 0), at(id, len)));
}

/** User B (the one under test) and peer A, over two Y.Docs synced both ways. */
function peers(text: string) {
  let a = reduceEditor(createInitialEditorState(config), { type: "INSERT_TEXT", text });
  const docA = getYDoc(a.state);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  const stateB = createState({ resolver: TEST_RESOLVER, rootId: a.state.rootId, doc: docB });
  let b = createEditorStateFromState(stateB, initialSelectionForState(stateB), config);
  docA.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(docB, u, "sync");
  });
  docB.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "sync") Y.applyUpdate(docA, u, "sync");
  });
  const noLegacy = (): void => {
    throw new Error("unexpected legacy storage");
  };
  subscribeRemoteChanges(b.state, (dirtyIds) => {
    b = reduceEditor(b, { type: "APPLY_FOREIGN_CHANGE", dirtyIds });
  }, noLegacy);
  subscribeRemoteChanges(a.state, (dirtyIds) => {
    a = reduceEditor(a, { type: "APPLY_FOREIGN_CHANGE", dirtyIds });
  }, noLegacy);
  const id = a.selection.focus.blockId;
  return {
    id,
    a: (...actions: EditorAction[]) => {
      for (const action of actions) a = reduceEditor(a, action);
    },
    b: (...actions: EditorAction[]) => {
      for (const action of actions) b = reduceEditor(b, action);
    },
    get bEditor() {
      return b;
    },
    get aEditor() {
      return a;
    },
  };
}

describe("undo survives a peer's formatting (T6)", () => {
  it("B types 'hello'; A bolds 'ell'; B's UNDO removes the typing and leaves no bold", () => {
    const p = peers("");
    p.b(caret(p.id, 0), { type: "INSERT_TEXT", text: "hello" });
    p.a({ type: "SET_SELECTION", selection: createSpan(at(p.id, 1), at(p.id, 4)) }, { type: "TOGGLE_STYLE", style: "bold" });
    expect(getBlock(p.bEditor.state, p.id)?.inlineContent?.items.some((i) => i.attrs.bold === true)).toBe(true);
    p.b({ type: "UNDO" });
    expect(textOf(p.bEditor, p.id)).toBe("");
  });
});

describe("undo after a peer's change elsewhere", () => {
  it("B's UNDO keeps a peer's edit in another paragraph (history follows the peer's change)", () => {
    const p = peers("one");
    // A split keeps the caret's block as the TAIL: `p.id` becomes the second paragraph.
    p.a(caret(p.id, 3), { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "two" });
    const first = getBlock(p.aEditor.state, p.id)?.prevSiblingId ?? null;
    if (first === null) throw new Error("setup");
    // B reads the second paragraph (its caret visits it), then edits the first.
    p.b(caret(p.id, 1), caret(first, 3), { type: "INSERT_TEXT", text: "X" });
    p.a(caret(p.id, 3), { type: "INSERT_TEXT", text: "Y" }); // the peer's edit in the second
    expect(textOf(p.bEditor, p.id)).toBe("twoY");
    p.b({ type: "UNDO" });
    expect(textOf(p.bEditor, first)).toBe("one");
    expect(textOf(p.bEditor, p.id)).toBe("twoY");
  });
});

describe("undo selections are CRDT-anchored (T6)", () => {
  it("a peer's insert BEFORE the stored caret: undo restores the caret at its character, not a stale offset", () => {
    const p = peers("world");
    p.b(caret(p.id, 2), { type: "INSERT_TEXT", text: "Z" }); // "woZrld", before = before 'r'
    p.a(caret(p.id, 0), { type: "INSERT_TEXT", text: "XX" }); // "XXwoZrld"
    p.b({ type: "UNDO" });
    expect(textOf(p.bEditor, p.id)).toBe("XXworld");
    expect(p.bEditor.selection.focus).toEqual(at(p.id, 4)); // before 'r'
  });

  it("a caret at the END of the block anchors to its left char: a peer append after it does not move the restored caret", () => {
    const p = peers("world");
    p.b(caret(p.id, 5), { type: "INSERT_TEXT", text: "Z" }); // "worldZ"; before = after 'd'
    p.a(caret(p.id, 6), { type: "INSERT_TEXT", text: "XX" }); // "worldZXX"
    p.b({ type: "UNDO" });
    expect(textOf(p.bEditor, p.id)).toBe("worldXX");
    expect(p.bEditor.selection.focus).toEqual(at(p.id, 5));
    p.b({ type: "REDO" });
    expect(textOf(p.bEditor, p.id)).toBe("worldZXX");
    expect(p.bEditor.selection.focus).toEqual(at(p.id, 6)); // after the redone 'Z'
  });

  it("a peer split AFTER the caret's character keeps the restored caret on it", () => {
    const q = peers("abcdef");
    q.b(caret(q.id, 2), { type: "INSERT_TEXT", text: "Z" }); // "abZcdef"; before anchors 'c'
    q.a(caret(q.id, 5), { type: "SPLIT_NODE" }); // "abZcd" | "ef" — the head is the new block
    const head = getBlock(q.bEditor.state, q.id)?.prevSiblingId ?? null;
    if (head === null) throw new Error("setup");
    q.b({ type: "UNDO" });
    expect(textOf(q.bEditor, head)).toBe("abcd");
    expect(q.bEditor.selection.focus).toEqual(at(head, 2));
  });

  it("a peer deleting the caret's anchor character: undo falls back to its own caret", () => {
    const p = peers("abcdef");
    p.b(caret(p.id, 4), { type: "INSERT_TEXT", text: "Z" }); // "abcdZef"; before anchors 'd' (its left char)
    // A deletes 'd' and prepends "XX": the stored anchor is gone (the undo does not
    // restore A's delete), so it is unresolvable; "Z" survives, so the undo works.
    p.a(
      { type: "SET_SELECTION", selection: createSpan(at(p.id, 3), at(p.id, 4)) },
      { type: "DELETE_BACKWARD" },
      caret(p.id, 0),
      { type: "INSERT_TEXT", text: "XX" },
    ); // "XXabcZef"
    p.b({ type: "UNDO" });
    expect(textOf(p.bEditor, p.id)).toBe("XXabcef");
    // The undo's own caret: B's caret (after "Z") rebased through the peer edits and
    // the undo → after "XXabc" (a stale stored offset would say 4).
    expect(p.bEditor.selection.focus).toEqual(at(p.id, 5));
  });

  it("a stored selection whose block is gone falls back to the undo's own rebased caret", () => {
    const p = peers("first");
    p.a({ type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "second" });
    // the split's head "first" is the new block; p.id keeps "second".
    const first = getBlock(p.bEditor.state, p.id)?.prevSiblingId ?? null;
    if (first === null) throw new Error("setup");
    // B types in `first`: that entry's before-selection is in `first`.
    p.b(caret(first, 3), { type: "INSERT_TEXT", text: "Q" });
    // A deletes ¶first and the whole second paragraph: `first` leaves the read model.
    p.a({ type: "SET_SELECTION", selection: createSpan(at(first, 6), at(p.id, 6)) }, { type: "DELETE_BACKWARD" });
    expect(getBlock(p.bEditor.state, first)).toBeNull();
    p.b({ type: "UNDO" });
    // Undo re-creates nothing B can anchor to in `first` (A's delete is not B's to
    // undo); the caret is the undo's own, rebased: a valid position in a live block.
    const focus = p.bEditor.selection.focus;
    expect(getBlock(p.bEditor.state, focus.blockId)).not.toBeNull();
    expect(focus.blockId).toBe(p.id);
  });
});

describe("foreign-change rebasing snaps to grapheme boundaries (T6)", () => {
  it("a peer combining mark inserted right after B's caret: the caret snaps to the cluster start", () => {
    const p = peers("ex");
    p.b(caret(p.id, 1)); // between 'e' and 'x'
    p.a(caret(p.id, 1), { type: "INSERT_TEXT", text: "\u0301" }); // "e\u0301x": offset 1 is mid-cluster
    expect(p.bEditor.selection.focus).toEqual(at(p.id, 0));
  });
});

describe("bookmarks: a selective undo of a cut after the paste", () => {
  it("A cuts the bookmarked text, B pastes it, A undoes only the cut: both pairs live, the EARLIER one pairs", () => {
    const p = peers("Title");
    p.a({ type: "SPLIT_NODE" }); // Enter at the end: the TEXT "Title" takes the new id, the caret's ¶ keeps p.id
    const host = p.id;
    const t = getBlock(p.aEditor.state, host)?.prevSiblingId ?? null;
    if (t === null) throw new Error("setup");
    p.a({ type: "INSERT_CROSS_REFERENCE", targetId: t, refMode: "text" });
    const first = getBlock(p.bEditor.state, t)?.inlineContent?.items[0];
    const bid = first?.kind === "embed" ? String(first.properties.bookmarkId) : "";
    expect(collectBookmarks(p.bEditor.state).get(bid)?.start).toEqual(at(t, 1));
    // A: select exactly "Title" and cut it (copy the fragment, then delete).
    p.a({ type: "SET_SELECTION", selection: createSpan(at(t, 1), at(t, 6)) });
    const clip = encodeFragmentClip(extractFragment(p.aEditor.state, p.aEditor.selection));
    p.a({ type: "DELETE_BACKWARD" });
    expect(collectBookmarks(p.bEditor.state).has(bid)).toBe(false);
    // B pastes it at the end of the host: B's document has no live pair, so it keeps it.
    const hostEnd = getBlock(p.bEditor.state, host)?.inlineContent?.items.length ?? 0;
    p.b(caret(host, hostEnd), { type: "PASTE", clip, text: "Title" });
    expect(collectBookmarks(p.bEditor.state).get(bid)?.start.blockId).toBe(host);
    // A undoes ONLY its cut: the original pair is back; it is earlier in document order, so it pairs.
    p.a({ type: "UNDO" });
    for (const s of [p.aEditor.state, p.bEditor.state]) {
      expect(collectBookmarks(s).get(bid)?.start).toEqual(at(t, 1));
      expect(collectBookmarks(s).get(bid)?.end).toEqual(at(t, 6));
    }
  });
});
