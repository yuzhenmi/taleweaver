import { describe, it, expect } from "vitest";
import {
  createInitialEditorState,
  createEditorStateFromState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  registerMark,
  getMarkRanges,
  getActiveFormatting,
  getTypingAttrs,
  getBlock,
  createPosition,
  createSpan,
  extractFragment,
  encodeFragmentClip,
  getSuggestions,
  serializeDocument,
  deserializeDocument,
  createDefaultSerializerRegistry,
  createJsonDocumentSerializer,
  productionAllocator,
  BINARY_FORMAT,
  JSON_FORMAT,
  initialSelectionForState,
  render,
  INSERTION_SUGGESTION_ATTR,
  type EditorAction,
  type EditorConfig,
  type EditorState,
  type BlockId,
  type InlineItem,
  type State,
  type RenderNode,
} from "../index";

function makeConfig(extra?: Partial<EditorConfig>): EditorConfig {
  const attrRegistry = createDefaultAttrRegistry();
  registerMark(attrRegistry, "mention", {
    atomic: true,
    copy: "keep",
    toStyle: () => ({ backgroundColor: "#e8f0fe" }),
    toDom: (value) => ({
      class: "mention",
      attributes: { "data-ref": String((value as { ref?: unknown }).ref) },
    }),
  });
  registerMark(attrRegistry, "secret", { copy: "drop" });
  registerMark(attrRegistry, "tag", { inclusive: true });
  registerMark(attrRegistry, "note", { exclusive: false });
  return {
    componentRegistry: createDefaultComponentRegistry(),
    attrRegistry,
    containerWidth: 800,
    ...extra,
  };
}

function run(editor: EditorState, config: EditorConfig, ...actions: EditorAction[]): EditorState {
  let s = editor;
  for (const a of actions) s = reduceEditor(s, a, config);
  return s;
}

function blockId(editor: EditorState): BlockId {
  return editor.selection.focus.blockId;
}

function items(editor: EditorState, id: BlockId = blockId(editor)): readonly InlineItem[] {
  return getBlock(editor.state, id)?.inlineContent?.items ?? [];
}

/** Text + attrs of every run, for compact assertions. */
function runs(editor: EditorState, id: BlockId = blockId(editor)): Array<[string, Record<string, unknown>]> {
  return items(editor, id).map((it) => [it.kind === "text" ? it.text : "￼", { ...it.attrs }]);
}

function caret(id: BlockId, offset: number): EditorAction {
  return { type: "SET_SELECTION", selection: createSpan(createPosition(id, offset), createPosition(id, offset)) };
}

function select(id: BlockId, from: number, to: number): EditorAction {
  return { type: "SET_SELECTION", selection: createSpan(createPosition(id, from), createPosition(id, to)) };
}

/** "Hi Anna and Bob" with "Anna" (3..7) a mention {ref:"a"}; caret at the end. */
function withMention(config: EditorConfig): EditorState {
  let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "Hi Anna and Bob" });
  const id = blockId(s);
  s = run(s, config, select(id, 3, 7), { type: "SET_MARK", key: "mention", value: { ref: "a" } }, caret(id, 15));
  return s;
}

describe("typing attributes", () => {
  it("text typed inside a bold link word takes bold + link (was plain before F3)", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "word" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 4), { type: "TOGGLE_STYLE", style: "bold" }, { type: "SET_LINK", url: "https://example.com" });
    s = run(s, config, caret(id, 2), { type: "INSERT_TEXT", text: "X" });
    expect(runs(s)).toEqual([["woXrd", { bold: true, link: "https://example.com" }]]);
    // Beside an inline object (a tab) the surrounding text's formatting continues.
    s = run(s, config, caret(id, 5), { type: "SELECT_ALL" }, { type: "SET_LINK", url: null }, caret(id, 5), { type: "INSERT_TAB" }, { type: "INSERT_TEXT", text: "Y" });
    expect(runs(s).at(-1)).toEqual(["Y", { bold: true }]);
  });

  it("at a link's END typing keeps bold but not the link; at its START too (non-inclusive)", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "link" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 4), { type: "TOGGLE_STYLE", style: "bold" }, { type: "SET_LINK", url: "u" });
    s = run(s, config, caret(id, 4), { type: "INSERT_TEXT", text: "!" }, caret(id, 0), { type: "INSERT_TEXT", text: "<" });
    expect(runs(s)).toEqual([
      ["<", { bold: true }],
      ["link", { bold: true, link: "u" }],
      ["!", { bold: true }],
    ]);
  });

  it("an inclusive custom mark extends at its end; a non-inclusive one does not", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "ab" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 2), { type: "SET_MARK", key: "tag", value: "t" }, caret(id, 2), { type: "INSERT_TEXT", text: "c" });
    expect(getMarkRanges(s.state, "tag").map((r) => [r.from.offset, r.to.offset])).toEqual([[0, 3]]);
    s = run(s, config, select(id, 0, 3), { type: "SET_MARK", key: "secret", value: 1 }, caret(id, 3), { type: "INSERT_TEXT", text: "d" });
    expect(getMarkRanges(s.state, "secret").map((r) => [r.from.offset, r.to.offset])).toEqual([[0, 3]]);
  });

  it("never inherits change-tracking provenance (direct typing inside a suggested insertion / formatting suggestion)", () => {
    const suggest = makeConfig({ suggestingAuthor: "A" });
    const direct = makeConfig();
    let s = run(createInitialEditorState(suggest), suggest, { type: "INSERT_TEXT", text: "abc" });
    expect(runs(s)[0]?.[1][INSERTION_SUGGESTION_ATTR]).toBeDefined();
    s = run(s, direct, caret(blockId(s), 1), { type: "INSERT_TEXT", text: "X" });
    expect(runs(s).find(([t]) => t === "X")?.[1]).toEqual({});
    // Inside a run carrying a formatting suggestion's tag: the tag is not inherited.
    s = run(s, suggest, select(blockId(s), 0, 4), { type: "TOGGLE_STYLE", style: "italic" });
    s = run(s, direct, caret(blockId(s), 2), { type: "INSERT_TEXT", text: "Y" });
    expect(Object.keys(runs(s).find(([t]) => t === "Y")?.[1] ?? { missing: true })).toEqual([]);
  });

  it("collapsed TOGGLE_STYLE stores typing attrs: toolbar shows it, next keystroke uses it, a caret move drops it", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "ab" });
    const id = blockId(s);
    const docBefore = s.state;
    s = run(s, config, { type: "TOGGLE_STYLE", style: "bold" });
    expect(s.state).toBe(docBefore); // no document change
    expect(getActiveFormatting(s.state, s.selection, s.storedAttrs).bold).toBe(true);
    // Re-setting the SAME selection (e.g. a DOM selectionchange echo) keeps it.
    s = run(s, config, caret(id, 2));
    expect(s.storedAttrs).toEqual({ bold: true });
    s = run(s, config, { type: "INSERT_TEXT", text: "C" }, { type: "INSERT_TEXT", text: "D" });
    expect(runs(s)).toEqual([["ab", {}], ["CD", { bold: true }]]);
    expect(s.storedAttrs).toBeUndefined();
    // Toggle off at the caret (inside bold now) → typed text plain; a move clears it.
    s = run(s, config, { type: "TOGGLE_STYLE", style: "bold" });
    expect(getActiveFormatting(s.state, s.selection, s.storedAttrs).bold).toBe(false);
    s = run(s, config, caret(id, 3));
    expect(s.storedAttrs).toBeUndefined();
    s = run(s, config, caret(id, 4), { type: "TOGGLE_STYLE", style: "bold" }, { type: "INSERT_TEXT", text: "e" });
    expect(runs(s)).toEqual([["ab", {}], ["CD", { bold: true }], ["e", {}]]);
  });

  it("collapsed color / size / family / transform / clear-formatting / unlink apply to the next typed text", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "go" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 2), { type: "SET_LINK", url: "u" }, { type: "TOGGLE_STYLE", style: "italic" }, caret(id, 1));
    s = run(
      s,
      config,
      { type: "SET_TEXT_COLOR", color: "#ff0000" },
      { type: "SET_HIGHLIGHT", color: "#ffff00" },
      { type: "SET_FONT_SIZE", size: 20 },
      { type: "SET_FONT_FAMILY", family: "Georgia" },
      { type: "SET_TEXT_TRANSFORM", value: "uppercase" },
      { type: "SET_LINK", url: null },
      { type: "INSERT_TEXT", text: "X" },
    );
    expect(runs(s)[1]).toEqual([
      "X",
      { italic: true, color: "#ff0000", backgroundColor: "#ffff00", fontSize: 20, fontFamily: "Georgia", textTransform: "uppercase" },
    ]);
    s = run(s, config, { type: "CLEAR_FORMATTING" }, { type: "INSERT_TEXT", text: "Y" });
    expect(runs(s)[2]).toEqual(["Y", {}]);
  });

  it("type-over takes the first selected character's attrs (atomic marks excluded)", () => {
    const config = makeConfig();
    let s = withMention(config);
    const id = blockId(s);
    s = run(s, config, select(id, 3, 7), { type: "TOGGLE_STYLE", style: "bold" }, { type: "INSERT_TEXT", text: "Z" });
    expect(runs(s)).toEqual([["Hi ", {}], ["Z", { bold: true }], [" and Bob", {}]]);
  });

  it("plain-text paste (single and multi-line) takes the typing attrs", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "ab" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 2), { type: "TOGGLE_STYLE", style: "bold" }, caret(id, 1));
    s = run(s, config, { type: "PASTE", text: "x\ny\nz" });
    const root = getBlock(s.state, s.state.rootId);
    const ids: BlockId[] = [];
    for (let c = root?.firstChildId ?? null; c !== null; c = getBlock(s.state, c)?.nextSiblingId ?? null) ids.push(c);
    expect(ids.map((b) => runs(s, b))).toEqual([
      [["ax", { bold: true }]],
      [["y", { bold: true }]],
      [["zb", { bold: true }]],
    ]);
  });

  it("composition commit (INSERT_TEXT of the composed string) inherits like typing", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "ab" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 2), { type: "TOGGLE_STYLE", style: "underline" }, caret(id, 1), { type: "INSERT_TEXT", text: "日本" });
    expect(runs(s)).toEqual([["a日本b", { underline: true }]]);
  });

  it("deleting / splitting over a whole selected link carries bold but never the link", () => {
    const config = makeConfig();
    const linked = (): EditorState => {
      let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "link" });
      const id = blockId(s);
      return run(s, config, select(id, 0, 4), { type: "SET_LINK", url: "u" }, { type: "TOGGLE_STYLE", style: "bold" });
    };
    const deleted = run(linked(), config, { type: "SELECT_ALL" }, { type: "DELETE_BACKWARD" }, { type: "INSERT_TEXT", text: "x" });
    expect(runs(deleted)).toEqual([["x", { bold: true }]]);
    const split = run(linked(), config, { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "y" });
    expect(runs(split)).toEqual([["y", { bold: true }]]);
  });

  it("Enter at the end of bold text, or deleting a block's last bold char, keeps bold for the empty block", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "TOGGLE_STYLE", style: "bold" }, { type: "INSERT_TEXT", text: "B" });
    s = run(s, config, { type: "SPLIT_NODE" });
    expect(getActiveFormatting(s.state, s.selection, s.storedAttrs).bold).toBe(true);
    s = run(s, config, { type: "INSERT_TEXT", text: "c" }, { type: "DELETE_BACKWARD" });
    expect(s.storedAttrs).toEqual({ bold: true });
    s = run(s, config, { type: "INSERT_TEXT", text: "d" });
    expect(runs(s)).toEqual([["d", { bold: true }]]);
  });
});

describe("mark semantics", () => {
  it("ranges, atomic units and REMOVE_MARK use the mark's custom equals (as run merging does)", () => {
    const config = makeConfig();
    registerMark(config.attrRegistry, "person", {
      atomic: true,
      equals: (a, b) => (a as { ref?: unknown }).ref === (b as { ref?: unknown }).ref,
    });
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "abcdef" });
    const id = blockId(s);
    s = run(
      s,
      config,
      { type: "SET_MARK", key: "person", value: { ref: "p", seen: 1 }, span: createSpan(createPosition(id, 1), createPosition(id, 3)) },
      { type: "SET_MARK", key: "person", value: { ref: "p", seen: 2 }, span: createSpan(createPosition(id, 3), createPosition(id, 5)) },
    );
    expect(getMarkRanges(s.state, "person", config.attrRegistry).map((r) => [r.from.offset, r.to.offset])).toEqual([[1, 5]]);
    expect(run(s, config, caret(id, 2)).selection.focus.offset).toBe(1); // one unit 1..5, not 1..3
    s = run(s, config, { type: "REMOVE_MARK", key: "person", value: { ref: "p" }, span: createSpan(createPosition(id, 0), createPosition(id, 6)) });
    expect(getMarkRanges(s.state, "person", config.attrRegistry)).toEqual([]);
  });

  it("overlapping atomic marks form one unit: a snapped caret never lands inside the other", () => {
    const config = makeConfig();
    registerMark(config.attrRegistry, "chip", { atomic: true, exclusive: false });
    const make = (): EditorState => {
      let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "0123456789" });
      const id = blockId(s);
      return run(
        s,
        config,
        { type: "SET_MARK", key: "chip", value: "A", span: createSpan(createPosition(id, 0), createPosition(id, 5)) },
        { type: "SET_MARK", key: "chip", value: "B", span: createSpan(createPosition(id, 4), createPosition(id, 9)) },
      );
    };
    const s = make();
    const id = blockId(s);
    expect(run(s, config, caret(id, 2)).selection.focus.offset).toBe(0);
    expect(run(s, config, caret(id, 6)).selection.focus.offset).toBe(9);
    expect(run(s, config, caret(id, 0), caret(id, 1)).selection.focus.offset).toBe(9);
    const s2 = make();
    expect(runs(run(s2, config, caret(blockId(s2), 9), { type: "DELETE_BACKWARD" }))).toEqual([["9", {}]]);
  });

  it("SET_MARK replace swaps a non-exclusive instance in one undo step / one suggestion", () => {
    const config = makeConfig();
    const make = (): EditorState => {
      let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "abcd" });
      const id = blockId(s);
      return run(s, config, { type: "SET_MARK", key: "note", value: { id: 1 }, span: createSpan(createPosition(id, 0), createPosition(id, 4)) });
    };
    let s = make();
    const id = blockId(s);
    const all = createSpan(createPosition(id, 0), createPosition(id, 4));
    s = run(s, config, { type: "SET_MARK", key: "note", value: { id: 2 }, replace: { id: 1 }, span: all });
    expect(getMarkRanges(s.state, "note").map((r) => r.value)).toEqual([{ id: 2 }]);
    s = run(s, config, { type: "UNDO" });
    expect(getMarkRanges(s.state, "note").map((r) => r.value)).toEqual([{ id: 1 }]);

    const sug = makeConfig({ suggestingAuthor: "A" });
    let t = make();
    const tid = blockId(t);
    t = run(t, sug, { type: "SET_MARK", key: "note", value: { id: 2 }, replace: { id: 1 }, span: createSpan(createPosition(tid, 0), createPosition(tid, 4)) });
    const suggestions = getSuggestions(t.state);
    expect(suggestions).toHaveLength(1);
    t = run(t, config, { type: "ACCEPT_SUGGESTION", id: suggestions[0]?.id ?? ("" as never) });
    expect(getMarkRanges(t.state, "note").map((r) => r.value)).toEqual([{ id: 2 }]);
  });

  it("a range endpoint inside an atomic mark covers it; only a focus arriving from an edge jumps", () => {
    const config = makeConfig();
    const s = withMention(config); // mention 3..7
    const id = blockId(s);
    const sel = (a: number, f: number) => run(s, config, caret(id, 4), select(id, a, f)).selection;
    // Drag starting inside (raw anchor 4 or 6), in both directions → whole mention included.
    expect([sel(4, 10).anchor.offset, sel(4, 10).focus.offset]).toEqual([3, 10]);
    expect([sel(6, 1).anchor.offset, sel(6, 1).focus.offset]).toEqual([7, 1]);
    expect([sel(6, 10).anchor.offset, sel(6, 10).focus.offset]).toEqual([3, 10]);
    // Shift+Left from the end edge back into it deselects to the start edge.
    const back = run(s, config, select(id, 1, 7), select(id, 1, 6)).selection;
    expect([back.anchor.offset, back.focus.offset]).toEqual([1, 3]);
  });

  it("SET_MARK + getMarkRanges; adjacent runs with different values stay distinct", () => {
    const config = makeConfig();
    let s = withMention(config);
    const id = blockId(s);
    s = run(s, config, select(id, 7, 8), { type: "SET_MARK", key: "mention", value: { ref: "b" } });
    expect(getMarkRanges(s.state, "mention")).toEqual([
      { from: createPosition(id, 3), to: createPosition(id, 7), value: { ref: "a" } },
      { from: createPosition(id, 7), to: createPosition(id, 8), value: { ref: "b" } },
    ]);
  });

  it("bold over part of a mention keeps the mention whole; CLEAR_FORMATTING never drops it", () => {
    const config = makeConfig();
    let s = withMention(config);
    const id = blockId(s);
    s = run(s, config, select(id, 0, 5), { type: "TOGGLE_STYLE", style: "bold" });
    expect(getMarkRanges(s.state, "mention").map((r) => [r.from.offset, r.to.offset])).toEqual([[3, 7]]);
    s = run(s, config, select(id, 0, 15), { type: "CLEAR_FORMATTING" });
    expect(runs(s)).toEqual([["Hi ", {}], ["Anna", { mention: { ref: "a" } }], [" and Bob", {}]]);
  });

  it("atomic: the caret never rests inside — clicks snap to the nearest edge, steps from an edge jump over", () => {
    const config = makeConfig();
    let s = withMention(config);
    const id = blockId(s);
    expect(run(s, config, caret(id, 4)).selection.focus.offset).toBe(3);
    expect(run(s, config, caret(id, 6)).selection.focus.offset).toBe(7);
    // ArrowRight from the start edge (3 → 4) lands after it; ArrowLeft from the end (7 → 6) before it.
    expect(run(s, config, caret(id, 3), caret(id, 4)).selection.focus.offset).toBe(7);
    expect(run(s, config, caret(id, 7), caret(id, 6)).selection.focus.offset).toBe(3);
    // A range selection covers it whole: Shift+Right from before it extends past it.
    const ext = run(s, config, caret(id, 3), select(id, 3, 4)).selection;
    expect([ext.anchor.offset, ext.focus.offset]).toEqual([3, 7]);
    const drag = run(s, config, select(id, 5, 1)).selection;
    expect([drag.anchor.offset, drag.focus.offset]).toEqual([7, 1]);
  });

  it("atomic: backspace / delete / a partial range delete remove the whole mention; typing at its edge does not extend it", () => {
    const config = makeConfig();
    // Each branch starts from a fresh document (a State's Y.Doc is not forkable).
    const from = (offset: number, ...actions: EditorAction[]): EditorState => {
      const base = withMention(config);
      return run(base, config, caret(blockId(base), offset), ...actions);
    };
    const back = from(7, { type: "DELETE_BACKWARD" });
    expect(runs(back)).toEqual([["Hi  and Bob", {}]]);
    expect(back.selection.focus.offset).toBe(3);
    expect(runs(from(3, { type: "DELETE_FORWARD" }))).toEqual([["Hi  and Bob", {}]]);
    expect(runs(from(7, { type: "DELETE_WORD", direction: "backward" }))).toEqual([["Hi  and Bob", {}]]);
    const base = withMention(config);
    const b = blockId(base);
    const range = run(base, config, { type: "DELETE_RANGE", span: createSpan(createPosition(b, 5), createPosition(b, 9)) });
    expect(runs(range)).toEqual([["Hi nd Bob", {}]]);
    let typed = from(7, { type: "INSERT_TEXT", text: "!" });
    typed = run(typed, config, caret(blockId(typed), 3), { type: "INSERT_TEXT", text: "@" });
    expect(getMarkRanges(typed.state, "mention").map((r) => [r.from.offset, r.to.offset])).toEqual([[4, 8]]);
  });

  it("atomic delete in suggesting mode suggests deleting the whole mention", () => {
    const config = makeConfig();
    const s = withMention(config);
    const sug = run(s, makeConfig({ suggestingAuthor: "B" }), caret(blockId(s), 7), { type: "DELETE_BACKWARD" });
    const deleted = runs(sug).filter(([, a]) => a.deletionSuggestionId !== undefined).map(([t]) => t);
    expect(deleted).toEqual(["Anna"]);
  });

  it("non-exclusive marks overlap as separate instances; REMOVE_MARK by value removes one", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "abcdef" });
    const id = blockId(s);
    s = run(
      s,
      config,
      { type: "SET_MARK", key: "note", value: { id: 1 }, span: createSpan(createPosition(id, 0), createPosition(id, 4)) },
      { type: "SET_MARK", key: "note", value: { id: 2 }, span: createSpan(createPosition(id, 2), createPosition(id, 6)) },
    );
    expect(getMarkRanges(s.state, "note").map((r) => [r.from.offset, r.to.offset, r.value])).toEqual([
      [0, 4, { id: 1 }],
      [2, 6, { id: 2 }],
    ]);
    s = run(s, config, { type: "REMOVE_MARK", key: "note", value: { id: 1 }, span: createSpan(createPosition(id, 0), createPosition(id, 6)) });
    expect(getMarkRanges(s.state, "note").map((r) => [r.from.offset, r.to.offset])).toEqual([[2, 6]]);
    s = run(s, config, { type: "REMOVE_MARK", key: "note", span: createSpan(createPosition(id, 0), createPosition(id, 6)) });
    expect(getMarkRanges(s.state, "note")).toEqual([]);
  });

  it("REMOVE_MARK with a value removes only the matching exclusive ranges; without, all", () => {
    const config = makeConfig();
    let s = withMention(config);
    const id = blockId(s);
    s = run(s, config, select(id, 12, 15), { type: "SET_MARK", key: "mention", value: { ref: "b" } }, select(id, 0, 15));
    s = run(s, config, { type: "REMOVE_MARK", key: "mention", value: { ref: "b" } });
    expect(getMarkRanges(s.state, "mention").map((r) => r.value)).toEqual([{ ref: "a" }]);
    s = run(s, config, { type: "REMOVE_MARK", key: "mention" });
    expect(getMarkRanges(s.state, "mention")).toEqual([]);
  });

  it("survives undo / redo", () => {
    const config = makeConfig();
    const s = withMention(config);
    const undone = run(s, config, { type: "UNDO" });
    expect(getMarkRanges(undone.state, "mention")).toEqual([]);
    const redone = run(undone, config, { type: "REDO" });
    expect(getMarkRanges(redone.state, "mention").map((r) => [r.from.offset, r.to.offset])).toEqual([[3, 7]]);
  });

  it("survives block split and join (a non-atomic mark split mid-range, then re-joined)", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "abcd" });
    const id = blockId(s);
    s = run(s, config, select(id, 0, 4), { type: "SET_MARK", key: "tag", value: "t" }, caret(id, 2), { type: "SPLIT_NODE" });
    expect(getMarkRanges(s.state, "tag").map((r) => [r.from.offset, r.to.offset])).toEqual([[0, 2], [0, 2]]);
    s = run(s, config, { type: "DELETE_BACKWARD" });
    expect(getMarkRanges(s.state, "tag")).toEqual([
      { from: createPosition(id, 0), to: createPosition(id, 4), value: "t" },
    ]);
  });

  it("survives JSON and binary serialization round trips", () => {
    const config = makeConfig();
    const m = withMention(config);
    const s = run(m, config, {
      type: "SET_MARK",
      key: "note",
      value: { id: 7 },
      span: createSpan(createPosition(blockId(m), 0), createPosition(blockId(m), 5)),
    });
    const reg = createDefaultSerializerRegistry();
    reg.register(createJsonDocumentSerializer({ allocator: productionAllocator, blockKindResolver: config.componentRegistry }));
    for (const format of [JSON_FORMAT, BINARY_FORMAT]) {
      const back: State = deserializeDocument(serializeDocument(s.state, format, reg), format, reg);
      expect(getMarkRanges(back, "mention").map((r) => [r.from.offset, r.to.offset, r.value])).toEqual([[3, 7, { ref: "a" }]]);
      expect(getMarkRanges(back, "note").map((r) => [r.from.offset, r.to.offset, r.value])).toEqual([[0, 5, { id: 7 }]]);
    }
  });

  it("copy: keep marks survive a clip paste; copy:\"drop\" marks are stripped", () => {
    const config = makeConfig();
    let s = withMention(config);
    const id = blockId(s);
    s = run(s, config, select(id, 0, 15), { type: "SET_MARK", key: "secret", value: true });
    const frag = extractFragment(s.state, s.selection, config.attrRegistry);
    expect(getMarkRanges(frag, "secret")).toEqual([]);
    expect(getMarkRanges(frag, "mention").map((r) => r.value)).toEqual([{ ref: "a" }]);
    const fresh = createInitialEditorState(config);
    const pasted = run(fresh, config, { type: "PASTE", text: "x", clip: encodeFragmentClip(frag) });
    expect(getMarkRanges(pasted.state, "mention").map((r) => [r.from.offset, r.to.offset, r.value])).toEqual([[3, 7, { ref: "a" }]]);
    expect(getMarkRanges(pasted.state, "secret")).toEqual([]);
  });

  it("SET_MARK in suggesting mode is a formatting suggestion; accepting applies it", () => {
    const config = makeConfig();
    let s = run(createInitialEditorState(config), config, { type: "INSERT_TEXT", text: "Hi Anna" });
    const id = blockId(s);
    const sug = makeConfig({ suggestingAuthor: "A" });
    s = run(s, sug, select(id, 3, 7), { type: "SET_MARK", key: "mention", value: { ref: "a" } });
    expect(getMarkRanges(s.state, "mention")).toEqual([]);
    const [suggestion] = getSuggestions(s.state);
    expect(suggestion?.kind).toBe("formatting");
    s = run(s, config, { type: "ACCEPT_SUGGESTION", id: suggestion?.id ?? ("" as never) });
    expect(getMarkRanges(s.state, "mention").map((r) => [r.from.offset, r.to.offset])).toEqual([[3, 7]]);
  });

  it("getTypingAttrs is public and mirrors what INSERT_TEXT uses", () => {
    const config = makeConfig();
    const s = withMention(config);
    expect(getTypingAttrs(run(s, config, caret(blockId(s), 7)), config.attrRegistry)).toEqual({});
  });

  it("render carries mark DOM hints on the run (toDom) and the mark's toStyle", () => {
    const config = makeConfig();
    const s = withMention(config);
    const root = render(s.state, config.componentRegistry, config.attrRegistry).root;
    const texts: RenderNode[] = [];
    const walk = (n: RenderNode): void => {
      if (n.type === "text") texts.push(n);
      else n.children.forEach(walk);
    };
    walk(root);
    const anna = texts.find((t) => t.type === "text" && t.text === "Anna");
    expect(anna?.type === "text" ? anna.marks : undefined).toEqual([{ class: "mention", attributes: { "data-ref": "a" } }]);
    expect(anna?.style.backgroundColor).toBe("#e8f0fe");
    const hi = texts.find((t) => t.type === "text" && t.text === "Hi ");
    expect(hi?.type === "text" ? hi.marks : "x").toBeUndefined();
  });

  it("a state built from a document keeps marks editable (createEditorStateFromState)", () => {
    const config = makeConfig();
    const s = withMention(config);
    const fresh = createEditorStateFromState(s.state, initialSelectionForState(s.state), config);
    expect(run(fresh, config, caret(blockId(s), 4)).selection.focus.offset).toBe(3);
  });
});
