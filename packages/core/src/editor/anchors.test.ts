import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createInitialEditorState,
  createEditorStateFromState,
  reduceEditor,
  createDefaultComponentRegistry,
  createDefaultAttrRegistry,
  createAnchorSet,
  createMappingLog,
  mapPositionFrom,
  transitionMapping,
  getYDoc,
  subscribeRemoteChanges,
  createState,
  getBlock,
  createPosition,
  createSpan,
  findMatches,
  report,
  resetPerfTrace,
  setPerfTraceEnabled,
  initialSelectionForState,
  type EditorAction,
  type EditorConfig,
  type EditorState,
  type BlockId,
  type Position,
} from "../index";

const config: EditorConfig = {
  componentRegistry: createDefaultComponentRegistry(),
  attrRegistry: createDefaultAttrRegistry(),
  containerWidth: 800,
};

/** A controller-shaped harness: dispatch through the reducer, advance log + anchors per transition. */
function harness(editor = createInitialEditorState(config)) {
  let current = editor;
  const log = createMappingLog(8);
  log.reset(current.state);
  const anchors = createAnchorSet();
  const advance = (next: EditorState): void => {
    const prev = current;
    current = next;
    if (prev.state === next.state) return;
    const mapping = transitionMapping(prev, next);
    log.record(prev.state, next.state, mapping);
    anchors.advance(prev.state, next.state, mapping);
  };
  return {
    get editor() {
      return current;
    },
    log,
    anchors,
    advance,
    run(...actions: EditorAction[]) {
      for (const a of actions) advance(reduceEditor(current, a, config));
    },
  };
}

const at = (id: BlockId, o: number): Position => createPosition(id, o);
const caret = (id: BlockId, o: number): EditorAction => ({ type: "SET_SELECTION", selection: createSpan(at(id, o), at(id, o)) });
const textOf = (e: EditorState, id: BlockId): string =>
  (getBlock(e.state, id)?.inlineContent?.items ?? []).map((i) => (i.kind === "text" ? i.text : "")).join("");
const range = (a: { from: Position; to: Position }) => [a.from.offset, a.to.offset];

describe("anchors", () => {
  it("follow typing in the same block before, inside and after the range", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "hello world" });
    const id = h.editor.selection.focus.blockId;
    const a = h.anchors.create(h.editor.state, at(id, 6), at(id, 11)); // "world"
    h.run(caret(id, 0), { type: "INSERT_TEXT", text: ">> " });
    expect(range(a)).toEqual([9, 14]);
    h.run(caret(id, 14), { type: "INSERT_TEXT", text: "!" }); // at the end edge: exclusive
    expect(range(a)).toEqual([9, 14]);
    expect(a.changed).toBe(false);
    h.run(caret(id, 11), { type: "INSERT_TEXT", text: "X" }); // inside
    expect(range(a)).toEqual([9, 15]);
    expect(a.changed).toBe(true);
    expect(a.deleted).toBe(false);
  });

  it("an inclusive range takes edge insertions; formatting and type-then-delete are not 'changed'", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "abc" });
    const id = h.editor.selection.focus.blockId;
    const a = h.anchors.create(h.editor.state, at(id, 1), at(id, 2), { inclusive: true });
    h.run({ type: "SET_SELECTION", selection: createSpan(at(id, 0), at(id, 3)) }, { type: "TOGGLE_STYLE", style: "bold" });
    expect(a.changed).toBe(false);
    h.run(caret(id, 2), { type: "INSERT_TEXT", text: "Z" }, { type: "DELETE_BACKWARD" });
    expect(range(a)).toEqual([1, 2]);
    expect(a.changed).toBe(false);
    h.run(caret(id, 2), { type: "INSERT_TEXT", text: "Q" });
    expect(range(a)).toEqual([1, 3]);
  });

  it("follow block split / merge and paste; deleting the content reports deleted", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "one two" });
    const id = h.editor.selection.focus.blockId;
    const a = h.anchors.create(h.editor.state, at(id, 4), at(id, 7)); // "two"
    h.run(caret(id, 3), { type: "SPLIT_NODE" });
    const second = h.editor.selection.focus.blockId;
    expect(a.from).toEqual(at(second, 1));
    expect(a.to).toEqual(at(second, 4));
    h.run({ type: "DELETE_BACKWARD" }); // merge back
    expect([a.from.blockId, ...range(a)]).toEqual([id, 4, 7]);
    h.run(caret(id, 0), { type: "PASTE", text: "x\ny " });
    const last = h.editor.selection.focus.blockId;
    expect([a.from.blockId, ...range(a)]).toEqual([last, 6, 9]);
    expect(textOf(h.editor, last).slice(6, 9)).toBe("two");
    h.run({ type: "SET_SELECTION", selection: createSpan(at(last, 5), at(last, 9)) }, { type: "DELETE_BACKWARD" });
    expect(a.deleted).toBe(true);
    expect(a.changed).toBe(true);
  });

  it("follow undo / redo and replace-all", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "cat and cat" });
    const id = h.editor.selection.focus.blockId;
    const a = h.anchors.create(h.editor.state, at(id, 4), at(id, 7)); // "and"
    h.run(caret(id, 0), { type: "INSERT_TEXT", text: "a " });
    expect(range(a)).toEqual([6, 9]);
    h.run({ type: "UNDO" });
    expect(range(a)).toEqual([4, 7]);
    h.run({ type: "REDO" });
    expect(range(a)).toEqual([6, 9]);
    h.run({ type: "REPLACE_ALL", matches: findMatches(h.editor.state, "cat"), replacement: "tiger" });
    expect(textOf(h.editor, id)).toBe("a tiger and tiger");
    expect(range(a)).toEqual([8, 11]);
    expect(a.changed).toBe(false);
  });

  it("a point anchor follows its assoc; disposed anchors stop", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "ab" });
    const id = h.editor.selection.focus.blockId;
    const after = h.anchors.create(h.editor.state, at(id, 1));
    const before = h.anchors.create(h.editor.state, at(id, 1), undefined, { assoc: -1 });
    const gone = h.anchors.create(h.editor.state, at(id, 1));
    gone.dispose();
    expect(h.anchors.size).toBe(2);
    h.run(caret(id, 1), { type: "INSERT_TEXT", text: "X" });
    expect([after.from.offset, before.from.offset, gone.from.offset]).toEqual([2, 1, 1]);
  });

  it("mapPositionFrom maps across many versions; an aged-out version maps to null", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "abc" });
    const id = h.editor.selection.focus.blockId;
    const v0 = h.editor.state;
    for (let i = 0; i < 5; i++) h.run(caret(id, 0), { type: "INSERT_TEXT", text: "x" });
    expect(mapPositionFrom(h.log, h.editor.state, v0, at(id, 2))).toEqual({ position: at(id, 7), deleted: false });
    for (let i = 0; i < 10; i++) h.run({ type: "INSERT_TEXT", text: "y" }); // capacity 8
    expect(mapPositionFrom(h.log, h.editor.state, v0, at(id, 2))).toBeNull();
    // createAt with a still-mappable version starts `changed` when edited since.
    const v1 = h.editor.state;
    h.run(caret(id, 1), { type: "INSERT_TEXT", text: "Z" });
    const a = h.anchors.createAt(h.log, h.editor.state, v1, at(id, 0), at(id, 3));
    expect(a === null ? null : [range(a), a.changed]).toEqual([[0, 4], true]);
    expect(h.anchors.createAt(h.log, h.editor.state, v0, at(id, 0), at(id, 1))).toBeNull();
  });
});

describe("collaboration: APPLY_FOREIGN_CHANGE over two synced Y.Docs", () => {
  /** Peers A and B over separate Y.Docs kept in sync with Y.applyUpdate (the provider model). */
  function peers(text: string) {
    let a = reduceEditor(createInitialEditorState(config), { type: "INSERT_TEXT", text }, config);
    const docA = getYDoc(a.state);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const stateB = createState({ rootId: a.state.rootId, doc: docB });
    const b = harness(createEditorStateFromState(stateB, initialSelectionForState(stateB), config));
    docA.on("update", (u: Uint8Array, origin: unknown) => {
      if (origin !== "sync") Y.applyUpdate(docB, u, "sync");
    });
    subscribeRemoteChanges(
      b.editor.state,
      (dirtyIds) => b.run({ type: "APPLY_FOREIGN_CHANGE", dirtyIds }),
      () => {
        throw new Error("unexpected legacy storage");
      },
    );
    const id = a.selection.focus.blockId;
    return {
      b,
      id,
      a: (...actions: EditorAction[]) => {
        for (const action of actions) a = reduceEditor(a, action, config);
      },
    };
  }

  it("rebases B's caret for A's edits before / after / at it in the same block, and moves B's anchors", () => {
    const { a, b, id } = peers("hello world");
    b.run(caret(id, 5));
    textOf(b.editor, id); // B's view has read its block (a rendered editor always has)
    const anchor = b.anchors.create(b.editor.state, at(id, 6), at(id, 11));
    a(caret(id, 0), { type: "INSERT_TEXT", text: "Oh, " });
    expect(textOf(b.editor, id)).toBe("Oh, hello world");
    expect(b.editor.selection.focus).toEqual(at(id, 9));
    expect(range(anchor)).toEqual([10, 15]);
    a(caret(id, 15), { type: "INSERT_TEXT", text: "!" }); // after B's caret
    expect(b.editor.selection.focus).toEqual(at(id, 9));
    a(caret(id, 9), { type: "INSERT_TEXT", text: "XY" }); // exactly at B's caret: B stays before it
    expect(b.editor.selection.focus).toEqual(at(id, 9));
    expect(textOf(b.editor, id)).toBe("Oh, helloXY world!");
    // B keeps editing at its rebased caret.
    b.run({ type: "INSERT_TEXT", text: "_" });
    expect(textOf(b.editor, id)).toBe("Oh, hello_XY world!");
  });

  it("when B's caret block is deleted by A, B's caret lands on the nearest valid position", () => {
    const { a, b, id } = peers("first");
    a({ type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "second" });
    const second = getBlock(b.editor.state, id)?.nextSiblingId ?? null;
    if (second === null) throw new Error("setup");
    b.run(caret(second, 3));
    textOf(b.editor, second);
    // A deletes the whole second paragraph (select from end of first to end of second).
    a({ type: "SET_SELECTION", selection: createSpan(at(id, 5), at(second, 6)) }, { type: "DELETE_BACKWARD" });
    expect(textOf(b.editor, id)).toBe("first");
    expect(b.editor.selection.focus).toEqual(at(id, 5));
    expect(getBlock(b.editor.state, b.editor.selection.focus.blockId)).not.toBeNull();
  });

  it("a BACKWARD cross-block selection keeps its direction and content through a peer edit", () => {
    const { a, b, id } = peers("first");
    a({ type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "second" });
    const second = getBlock(b.editor.state, id)?.nextSiblingId ?? null;
    if (second === null) throw new Error("setup");
    b.run({ type: "SET_SELECTION", selection: createSpan(at(second, 3), at(id, 2)) });
    textOf(b.editor, id);
    textOf(b.editor, second);
    a(caret(id, 0), { type: "INSERT_TEXT", text: ">" });
    expect(b.editor.selection.anchor).toEqual(at(second, 3));
    expect(b.editor.selection.focus).toEqual(at(id, 3));
  });

  it("a foreign change does not join B's undo history", () => {
    const { a, b, id } = peers("ab");
    b.run(caret(id, 2), { type: "INSERT_TEXT", text: "B" });
    a(caret(id, 0), { type: "INSERT_TEXT", text: "A" });
    expect(textOf(b.editor, id)).toBe("AabB");
    b.run({ type: "UNDO" });
    expect(textOf(b.editor, id)).toBe("Aab");
  });
});

describe("anchors — review round 1", () => {
  /** "Anna" / "went" / "home": three paragraphs; returns the harness and the block ids. */
  function threeParagraphs() {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "Anna" }, { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "went" }, { type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: "home" });
    const root = getBlock(h.editor.state, h.editor.state.rootId);
    const ids: BlockId[] = [];
    for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(h.editor.state, id)?.nextSiblingId ?? null) ids.push(id);
    const [a, b, c] = ids;
    if (a === undefined || b === undefined || c === undefined) throw new Error("setup");
    return { h, a, b, c };
  }

  it("a multi-block range sees an edit in a middle block", () => {
    const { h, a, b, c } = threeParagraphs();
    const anchor = h.anchors.create(h.editor.state, at(a, 0), at(c, 4));
    h.run(caret(b, 2), { type: "INSERT_TEXT", text: "XX" });
    expect(anchor.changed).toBe(true);
    expect(anchor.deleted).toBe(false);
    expect([anchor.from, anchor.to]).toEqual([at(a, 0), at(c, 4)]);
  });

  it("a multi-block range sees a middle paragraph deleted", () => {
    const { h, a, b, c } = threeParagraphs();
    const anchor = h.anchors.create(h.editor.state, at(a, 0), at(c, 4));
    h.run({ type: "SET_SELECTION", selection: createSpan(at(a, 4), at(b, 4)) }, { type: "DELETE_BACKWARD" });
    expect(anchor.changed).toBe(true);
    expect(anchor.deleted).toBe(false);
  });

  it("a point anchor survives deleting only the character after it (deleted only when both sides go)", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "Anna" });
    const id = h.editor.selection.focus.blockId;
    const v = h.editor.state;
    const p = h.anchors.create(h.editor.state, at(id, 2));
    h.run(caret(id, 2), { type: "DELETE_FORWARD" });
    expect([p.deleted, p.from.offset]).toEqual([false, 2]);
    const late = h.anchors.createAt(h.log, h.editor.state, v, at(id, 2));
    expect(late === null ? null : [late.deleted, late.from.offset]).toEqual([false, 2]);
    h.run({ type: "SET_SELECTION", selection: createSpan(at(id, 1), at(id, 3)) }, { type: "DELETE_BACKWARD" });
    expect(p.deleted).toBe(true); // a deletion spanning the point (both sides) deletes it
  });
});

describe("anchors — indexing cost", () => {
  it("a keystroke outside every multi-paragraph anchor remaps none; inside one remaps exactly that one", () => {
    const h = harness();
    // Six paragraphs p0..p5.
    h.run({ type: "INSERT_TEXT", text: "p0" });
    for (let i = 1; i < 6; i++) h.run({ type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: `p${i}` });
    const root = getBlock(h.editor.state, h.editor.state.rootId);
    const ids: BlockId[] = [];
    for (let id = root?.firstChildId ?? null; id !== null; id = getBlock(h.editor.state, id)?.nextSiblingId ?? null) ids.push(id);
    const [p0, p1, p2, p3, p4, p5] = ids;
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined || p4 === undefined || p5 === undefined) throw new Error("setup");
    const a = h.anchors.create(h.editor.state, at(p0, 0), at(p2, 2)); // covers p0..p2
    const b = h.anchors.create(h.editor.state, at(p3, 0), at(p4, 1)); // covers p3..p4
    const remaps = (...actions: EditorAction[]): number => {
      resetPerfTrace();
      setPerfTraceEnabled(true);
      try {
        h.run(...actions);
      } finally {
        setPerfTraceEnabled(false);
      }
      return report().entries.find((e) => e.label === "anchors.remapped")?.count ?? 0;
    };
    expect(remaps(caret(p5, 2), { type: "INSERT_TEXT", text: "x" })).toBe(0);
    expect(remaps(caret(p1, 1), { type: "INSERT_TEXT", text: "y" })).toBe(1); // middle block of `a`
    expect(a.changed).toBe(true);
    expect(b.changed).toBe(false);
    expect(remaps(caret(p4, 0), { type: "INSERT_TEXT", text: "z" })).toBe(1); // inside `b`
    expect(b.changed).toBe(true);
  });

  it("typing inside a long multi-paragraph anchor never re-indexes it (O(1) per keystroke, not O(span))", () => {
    const h = harness();
    h.run({ type: "INSERT_TEXT", text: "p0" });
    for (let i = 1; i < 300; i++) h.run({ type: "SPLIT_NODE" }, { type: "INSERT_TEXT", text: `p${i}` });
    const root = getBlock(h.editor.state, h.editor.state.rootId);
    const first = root?.firstChildId;
    const last = root?.lastChildId;
    if (first == null || last == null) throw new Error("setup");
    h.anchors.create(h.editor.state, at(first, 0), at(last, 2)); // spans all 300 paragraphs
    const mid = getBlock(h.editor.state, first)?.nextSiblingId; // a covered middle block
    if (mid == null) throw new Error("setup");
    h.run(caret(mid, 1));
    resetPerfTrace();
    setPerfTraceEnabled(true);
    try {
      for (let i = 0; i < 20; i++) h.run({ type: "INSERT_TEXT", text: "x" });
    } finally {
      setPerfTraceEnabled(false);
    }
    const count = (label: string): number => report().entries.find((e) => e.label === label)?.count ?? 0;
    expect(count("anchors.remapped")).toBe(20); // the counter is live: one visit per keystroke
    expect(count("anchors.reindexed")).toBe(0); // and no keystroke rebuilds the 300-block index
  });
});
