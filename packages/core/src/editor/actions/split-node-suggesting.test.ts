/**
 * Change-tracking slice 4e-editor: SPLIT_NODE (Enter) branches for suggesting mode.
 *
 * Behavior-level tests through the real reducer. In suggesting mode
 * (`EditorConfig.suggestingAuthor` non-null) a COLLAPSED Enter routes through
 * `splitWithSuggestion`: a REAL structural split (two separate blocks, siblings
 * rewired, cursor → newBlock:0 exactly as in direct mode) PLUS a split TAG naming
 * the step (`insertionSuggestionId` on the NEW mark: the tail block, or the new
 * empty block BEFORE for Enter at offset 0 mid-document; Enter at offset 0 of a
 * run-start block splits AFTER) + an `insertion` SuggestionRecord — one undoable transaction. The split ¶ is read
 * back as `endMarkOf(state, N)`.
 *
 * Scope of THIS file: the COLLAPSED cases; the SINGLE-BLOCK NON-collapsed case
 * (slice 4e-editor-composite) — Enter over a selection soft-deletes the selection
 * (text stays, struck) then inserts a suggested split AFTER it via
 * `splitWithSuggestionOverSelection`; and the CROSS-BLOCK NON-collapsed case (PF-4)
 * — Enter over a multi-block selection soft-deletes the selection (struck + a
 * join tag per crossed boundary) and inserts a suggested paragraph
 * break via `replaceWithSuggestedFragment` (an empty two-line fragment). Accept
 * leaves ONE break; reject restores the original blocks. All in one undoable op.
 */
import { finalSectionOf } from "../../test-utils/state-builders";
import { describe, it, expect } from "vitest";
import {
  config as directConfig,
  reduceEditor,
  createInitialEditorState,
  createPosition,
  createSpan,
  getTextOf,
  type EditorConfig,
  type EditorState,
} from "./test-helpers";

/** Throwing indexed access for tests: stronger than the old undefined-deref TypeError. */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}
import { createEditorStateFromState } from "../editor-state";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";
import {
  getBlock,
  getSuggestions,
  endMarkOf,
  DELETION_SUGGESTION_ATTR,
  type BlockId,
} from "../../state";

/** The first body paragraph id under the document root. */
function bodyParaId(editor: EditorState): BlockId {
  const root = getBlock(editor.state, finalSectionOf(editor.state));
  const id = root?.firstChildId;
  if (id === undefined || id === null) {
    throw new Error("document root has no first child paragraph");
  }
  return id;
}

/** A suggesting-mode config attributed to "alice" (direct config + author). */
const suggestingConfig: EditorConfig = { ...directConfig, suggestingAuthor: "alice" };

/** Place a collapsed caret at `offset` of `paraId`. */
function caretAt(
  editor: EditorState,
  paraId: BlockId,
  offset: number,
  cfg: EditorConfig,
): EditorState {
  return reduceEditor(
    { ...editor, config: cfg },
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, offset), createPosition(paraId, offset)),
    },
  );
}

/** Select `[start, end)` of `paraId`. */
function select(
  editor: EditorState,
  paraId: BlockId,
  start: number,
  end: number,
  cfg: EditorConfig,
): EditorState {
  return reduceEditor(
    { ...editor, config: cfg },
    {
      type: "SET_SELECTION",
      selection: createSpan(createPosition(paraId, start), createPosition(paraId, end)),
    },
  );
}

/** True if the boundary ¶ drawn at the END of `blockId` is a suggested split. */
function endsWithSplitMark(editor: EditorState, blockId: BlockId): boolean {
  return endMarkOf(editor.state, blockId)?.kind === "split";
}

/** Seed a single paragraph with `text` typed in (direct mode), caret at end. */
function seed(text: string): EditorState {
  return reduceEditor(
    createInitialEditorState(directConfig),
    { type: "INSERT_TEXT", text },
  );
}

describe("handleSplitNode — suggesting mode (slice 4e-editor)", () => {
  // a split's NEW head H takes the text before the caret
  // and its ¶ is the inserted, keyed one; the split block keeps the tail, its id and
  // the caret (B, 0).
  const headOf = (e: EditorState, id: BlockId): BlockId => {
    const h = getBlock(e.state, id)?.prevSiblingId ?? null;
    if (h === null) throw new Error("expected a new head before the split block");
    return h;
  };

  it("collapsed Enter MID-paragraph: REAL split into TWO blocks, the new head's ¶ is keyed, one insertion record, caret → (B, 0), undoable", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const placed = caretAt(seeded, paraId, 3, suggestingConfig); // caret after "abc"

    const next = reduceEditor(placed, { type: "SPLIT_NODE" });

    const head = headOf(next, paraId);
    expect(getTextOf(next.state, head)).toBe("abc");
    expect(getTextOf(next.state, paraId)).toBe("def");
    expect(endsWithSplitMark(next, head)).toBe(true);
    expect(getBlock(next.state, head)?.breakSuggestion?.insertionId).toBe(getSuggestions(next.state)[0]?.id);
    expect(getBlock(next.state, paraId)?.breakSuggestion).toBeUndefined();

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(1);
    expect(nth(suggestions, 0, "suggestion").kind).toBe("insertion");
    expect(nth(suggestions, 0, "suggestion").author).toBe("alice");

    expect(next.selection.anchor).toEqual(next.selection.focus);
    expect(next.selection.focus).toEqual(createPosition(paraId, 0));

    expect(next.history.canUndo()).toBe(true);
    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
    expect(getBlock(undone.state, paraId)?.prevSiblingId).toBeNull();
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  it("collapsed Enter at START (offset 0): no special case — the new EMPTY head above carries the keyed ¶ (Word); the text keeps its id and the caret", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const next = reduceEditor(caretAt(seeded, paraId, 0, suggestingConfig), { type: "SPLIT_NODE" });

    const head = headOf(next, paraId);
    expect(getTextOf(next.state, head)).toBe("");
    expect(getTextOf(next.state, paraId)).toBe("abcdef");
    expect(endsWithSplitMark(next, head)).toBe(true);
    expect(getBlock(next.state, paraId)?.breakSuggestion).toBeUndefined();
    expect(next.selection.focus).toEqual(createPosition(paraId, 0));
  });

  it("collapsed Enter at END of a heading: the head stays a heading with the keyed ¶; the empty tail takes the follow-on type", () => {
    let editor = createInitialEditorState(directConfig);
    const headingId = bodyParaId(editor);
    editor = reduceEditor(editor, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });
    for (const ch of "Title") editor = reduceEditor(editor, { type: "INSERT_TEXT", text: ch });
    const next = reduceEditor(caretAt(editor, headingId, 5, suggestingConfig), { type: "SPLIT_NODE" });

    const head = headOf(next, headingId);
    const h = getBlock(next.state, head);
    expect(h?.type).toBe("heading");
    expect(h?.attrs).toEqual({ level: 1 });
    expect(getTextOf(next.state, head)).toBe("Title");
    expect(endsWithSplitMark(next, head)).toBe(true);
    const tail = getBlock(next.state, headingId);
    expect(tail?.type).toBe("paragraph");
    expect(tail?.attrs).toEqual({});
    expect(tail?.breakSuggestion).toBeUndefined();
    expect(getSuggestions(next.state).map((x) => x.kind)).toEqual(["insertion"]);
  });

  it("collapsed and over-selection Enter write the head's ¶ props and keep host one-shot attrs off the tail, as the direct split", () => {
    const attrRegistry = createDefaultAttrRegistry();
    attrRegistry.register({ attrKey: "hostOnce", toStyle: () => ({}), inheritOnSplit: false });
    const cfg: EditorConfig = { ...suggestingConfig, attrRegistry };
    const p = "p" as BlockId;
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: p, lastChildId: p }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { hostOnce: 1 }, inlineContent: inlineContent([text("abc", { bold: true, link: "x" }), text("def")]) }),
      ],
    });
    for (const [from, to] of [[3, 3], [2, 3]] as const) {
      const placed = createEditorStateFromState(state, createSpan(createPosition(p, from), createPosition(p, to)), cfg);
      const next = reduceEditor(placed, { type: "SPLIT_NODE" });
      const head = headOf(next, p);
      expect(getBlock(next.state, head)?.markAttrs).toEqual({ bold: true });
      expect(getBlock(next.state, head)?.attrs).toEqual({ hostOnce: 1 });
      expect(getBlock(next.state, p)?.attrs).toEqual({});
    }
  });

  it("direct mode (regression): collapsed Enter does a plain untracked split (no tag, no record)", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const next = reduceEditor(caretAt(seeded, paraId, 3, directConfig), { type: "SPLIT_NODE" });
    const head = headOf(next, paraId);
    expect(getTextOf(next.state, head)).toBe("abc");
    expect(getTextOf(next.state, paraId)).toBe("def");
    expect(endsWithSplitMark(next, head)).toBe(false);
    expect(getSuggestions(next.state)).toHaveLength(0);
  });

  it("single-block non-collapsed Enter in suggesting mode: selection struck (stays) + suggested split after it + caret → (B, 0) + one undo reverts all", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const next = reduceEditor(select(seeded, paraId, 1, 4, suggestingConfig), { type: "SPLIT_NODE" });

    // The head: "a" + struck "bcd" (text STAYS), its ¶ the suggested split.
    const head = headOf(next, paraId);
    expect(getTextOf(next.state, head)).toBe("abcd");
    expect(endsWithSplitMark(next, head)).toBe(true);
    const bcd = getBlock(next.state, head)?.inlineContent?.items.find((it) => it.kind === "text" && it.text === "bcd");
    if (bcd?.kind !== "text") throw new Error("expected the struck bcd run");
    expect(bcd.attrs[DELETION_SUGGESTION_ATTR]).not.toBeUndefined();
    // The split block keeps the unstruck tail "ef".
    expect(getTextOf(next.state, paraId)).toBe("ef");

    const suggestions = getSuggestions(next.state);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.some((s) => s.kind === "deletion")).toBe(true);
    expect(suggestions.some((s) => s.kind === "insertion")).toBe(true);
    expect(next.selection.focus).toEqual(createPosition(paraId, 0));
    expect(next.selection.anchor).toEqual(next.selection.focus);

    const undone = reduceEditor(next, { type: "UNDO" });
    expect(getTextOf(undone.state, paraId)).toBe("abcdef");
    expect(getBlock(undone.state, paraId)?.prevSiblingId).toBeNull();
    expect(getSuggestions(undone.state)).toHaveLength(0);
  });

  describe("CROSS-block non-collapsed Enter in suggesting mode (PF-4: tracked, no longer a NO-OP)", () => {
    // Two paragraphs "abc" | "def" (built in direct mode); select para1[1..] .. para2[..2]
    // ("bc" + break + "de") and press Enter in suggesting mode. The selection is
    // soft-deleted (struck, with a join tag for the crossed boundary) AND a
    // suggested paragraph split is inserted — ONE undoable op. Accept removes the
    // selection + leaves ONE break ("a" | "f"); reject restores both blocks. reduceEditor
    // mutates the shared Y.Doc in place, so accept and reject each need a FRESH setup.
    const blockSeq = (e: EditorState): BlockId[] => {
      const out: BlockId[] = [];
      let id = getBlock(e.state, finalSectionOf(e.state))?.firstChildId ?? null;
      while (id) { out.push(id); id = getBlock(e.state, id)?.nextSiblingId ?? null; }
      return out;
    };
    const mk = (): { editor: EditorState; para1: BlockId } => {
      let editor = seed("abc");
      const para1 = bodyParaId(editor);
      editor = reduceEditor(editor, { type: "SPLIT_NODE" }); // "abc" | ""
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "def" });
      // After the direct split para1 holds "" (the tail) and its new head holds "abc".
      const para2 = para1;
      const head1 = getBlock(editor.state, para2)?.prevSiblingId ?? null;
      if (head1 === null) throw new Error("expected a second paragraph");
      const crossed = reduceEditor(
        { ...editor, config: suggestingConfig },
        { type: "SET_SELECTION", selection: createSpan(createPosition(head1, 1), createPosition(para2, 2)) },
      );
      return { editor: reduceEditor(crossed, { type: "SPLIT_NODE" }), para1: head1 };
    };

    it("tracks a deletion + insertion; the inserted (split) ¶ follows the struck selection", () => {
      const { editor: next, para1 } = mk();
      expect(getSuggestions(next.state).map((s) => s.kind).sort()).toEqual(["deletion", "insertion"]);
      // Suggesting view has THREE blocks: B ("a" + struck "bc", its ¶ suggested for
      // deletion) | the new head H (struck "de", its ¶ inserted — the break lands AFTER
      // the struck selection, Word / GDocs) | E ("f", keeps its id and the caret).
      // Accept deletes ¶B → two final blocks; reject deletes ¶H → the original two.
      const seq = blockSeq(next);
      expect(seq.length).toBe(3);
      expect(seq[0]).toBe(para1);
      expect(endsWithSplitMark(next, nth(seq, 1, "head"))).toBe(true);
      expect(seq.map((id) => getBlock(next.state, id)?.breakSuggestion)).toEqual([
        { deletionId: expect.any(String) },
        { insertionId: expect.any(String) },
        undefined,
      ]);
      expect(next.selection.focus).toEqual(createPosition(nth(seq, 2, "tail"), 0));
    });

    it("ACCEPT_ALL removes the selection and leaves ONE paragraph break (\"a\" | \"f\")", () => {
      const accepted = reduceEditor(mk().editor, { type: "ACCEPT_ALL_SUGGESTIONS" });
      const seq = blockSeq(accepted);
      expect(seq.map((id) => getTextOf(accepted.state, id))).toEqual(["a", "f"]);
      expect(getSuggestions(accepted.state)).toHaveLength(0);
    });

    it("a selection ending at the END of its block: the tail takes the follow-on type (as the direct delete-then-split)", () => {
      const mkHeadings = (): { editor: EditorState; tail: BlockId } => {
        let editor = createInitialEditorState(directConfig);
        const e = bodyParaId(editor);
        editor = reduceEditor(editor, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 1 } });
        for (const ch of "Title") editor = reduceEditor(editor, { type: "INSERT_TEXT", text: ch });
        editor = reduceEditor(editor, { type: "SPLIT_NODE" }); // "Title" | "" (paragraph)
        editor = reduceEditor(editor, { type: "SET_BLOCK_TYPE", blockType: "heading", properties: { level: 2 } });
        for (const ch of "Sub") editor = reduceEditor(editor, { type: "INSERT_TEXT", text: ch });
        const s = getBlock(editor.state, e)?.prevSiblingId ?? null;
        if (s === null) throw new Error("expected two headings");
        const crossed = reduceEditor({ ...editor, config: suggestingConfig }, { type: "SET_SELECTION", selection: createSpan(createPosition(s, 2), createPosition(e, 3)) });
        return { editor: reduceEditor(crossed, { type: "SPLIT_NODE" }), tail: e };
      };
      const { editor: next, tail } = mkHeadings();
      expect(getBlock(next.state, tail)?.type).toBe("paragraph");
      expect(next.selection.focus).toEqual(createPosition(tail, 0));
      const view = (e: EditorState) => blockSeq(e).map((id) => [getBlock(e.state, id)?.type, getBlock(e.state, id)?.attrs, getTextOf(e.state, id)]);
      expect(view(reduceEditor(next, { type: "ACCEPT_ALL_SUGGESTIONS" }))).toEqual([
        ["heading", { level: 1 }, "Ti"],
        ["paragraph", {}, ""],
      ]);
      expect(view(reduceEditor(mkHeadings().editor, { type: "REJECT_ALL_SUGGESTIONS" }))).toEqual([
        ["heading", { level: 1 }, "Title"],
        ["heading", { level: 2 }, "Sub"],
      ]);
    });

    it("REJECT_ALL restores the original two blocks (\"abc\" | \"def\")", () => {
      const rejected = reduceEditor(mk().editor, { type: "REJECT_ALL_SUGGESTIONS" });
      const seq = blockSeq(rejected);
      expect(seq.map((id) => getTextOf(rejected.state, id))).toEqual(["abc", "def"]);
      expect(getSuggestions(rejected.state)).toHaveLength(0);
    });
  });

  it("direct mode (regression): non-collapsed Enter deletes the selection THEN splits", () => {
    const seeded = seed("abcdef");
    const paraId = bodyParaId(seeded);
    const selected = select(seeded, paraId, 1, 4, directConfig); // select "bcd"

    const next = reduceEditor(selected, { type: "SPLIT_NODE" });

    // "bcd" deleted, then split at offset 1: the new head = "a", the block keeps "ef".
    expect(getTextOf(next.state, headOf(next, paraId))).toBe("a");
    expect(getTextOf(next.state, paraId)).toBe("ef");
    expect(getSuggestions(next.state)).toHaveLength(0);
  });
});
