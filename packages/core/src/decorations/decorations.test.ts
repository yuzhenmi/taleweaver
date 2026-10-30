import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState, createPosition, createSpan } from "../editor/actions/test-helpers";
import type { EditorAction } from "../editor/editor-action";
import type { EditorState } from "../editor/editor-state";
import { getBlock, getSuggestions, findMatches, iterateLeafBlocksInDocumentOrder, createPositionMapping, IDENTITY_MAPPING } from "../state";
import type { BlockId, CommentId } from "../state";
import {
  createDecorationSet,
  mapDecorationSet,
  changedDecorationBlocks,
  decorationsAt,
  type Decoration,
  type DecorationSet,
  type InlineDecoration,
} from "./decorations";
import { createDecorationLayers, transitionMapping } from "./decoration-layers";
import { report, resetPerfTrace, setPerfTraceEnabled } from "../perf/perf-trace";
import { insertText, splitBlockAtPosition, mergeAdjacentBlocks, createTestAllocator } from "../state";
import { reconcileForeignChange } from "../editor/reconcile-foreign-change";
import { MAX_CHANGE_CHAIN } from "../editor/document-change";

function step(editor: EditorState, action: EditorAction, set: DecorationSet) {
  for (const b of iterateLeafBlocksInDocumentOrder(editor.state)) void b; // a render warms the cache
  const next = reduceEditor(editor, action, config);
  const mapping =
    next.lastDirtyIds === null ? IDENTITY_MAPPING : createPositionMapping(editor.state, next.state, next.lastDirtyIds, editor.selection.focus);
  return { next, set: mapDecorationSet(set, mapping, next.state) };
}

function at(editor: EditorState, blockId: BlockId, offset: number): EditorState {
  const p = createPosition(blockId, offset);
  return reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(p, p) }, config);
}

/** Two paragraphs "Anna met Rosa" / "in Berlin"; caret at end of the second. */
function twoParas() {
  let editor = createInitialEditorState(config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "Anna met Rosa" }, config);
  editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
  editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "in Berlin" }, config);
  // root → its final section → the paragraphs.
  const section = getBlock(editor.state, editor.state.rootId)?.lastChildId;
  const sec = section == null ? null : getBlock(editor.state, section);
  const p1 = sec?.firstChildId;
  const p2 = sec?.lastChildId;
  if (p1 == null || p2 == null) throw new Error("setup");
  return { editor, p1, p2 };
}

const mention = (id: string, block: BlockId, from: number, to: number, extra?: Partial<InlineDecoration>): InlineDecoration => ({
  kind: "inline",
  id,
  from: createPosition(block, from),
  to: createPosition(block, to),
  style: { backgroundColor: "#fe0" },
  ...extra,
});

function inlineText(set: DecorationSet, block: BlockId): Array<[string, number, number]> {
  return set.forBlock(block).inline.map((s) => [s.decoration.id, s.start, s.end]);
}

describe("DecorationSet", () => {
  it("indexes by block, splits multi-block ranges, drops ranges that don't resolve", () => {
    const { editor, p1, p2 } = twoParas();
    const decos: Decoration[] = [
      mention("anna", p1, 0, 4),
      { kind: "inline", id: "span", from: createPosition(p1, 9), to: createPosition(p2, 2) },
      { kind: "widget", id: "w", at: createPosition(p2, 9), text: " ghost" },
      { kind: "block", id: "b", blockId: p2, class: "flagged" },
      mention("stale", p1, 10, 99), // past the end
      mention("empty", p1, 3, 3),
    ];
    const set = createDecorationSet(editor.state, decos);
    expect(set.decorations.map((d) => d.id)).toEqual(["anna", "span", "w", "b"]);
    expect(inlineText(set, p1)).toEqual([["anna", 0, 4], ["span", 9, 13]]);
    expect(inlineText(set, p2)).toEqual([["span", 0, 2]]);
    expect(set.forBlock(p2).widgets.map((w) => w.id)).toEqual(["w"]);
    expect(set.forBlock(p2).block.map((b) => b.id)).toEqual(["b"]);
    expect(decorationsAt(set, createPosition(p1, 2)).map((d) => d.id)).toEqual(["anna"]);
    expect(decorationsAt(set, createPosition(p1, 4)).map((d) => d.id)).toEqual([]);
  });

  it("stays attached through edits elsewhere and in the same block", () => {
    const { editor, p1, p2 } = twoParas();
    const set = createDecorationSet(editor.state, [mention("rosa", p1, 9, 13), mention("berlin", p2, 3, 9)]);
    const { next, set: mapped } = step(at(editor, p1, 0), { type: "INSERT_TEXT", text: "Then " }, set);
    expect(inlineText(mapped, p1)).toEqual([["rosa", 14, 18]]);
    // The untouched block keeps its per-block view by reference.
    expect(mapped.forBlock(p2)).toBe(set.forBlock(p2));
    expect([...changedDecorationBlocks(set, mapped)]).toEqual([p1]);
    void next;
  });

  it("edge typing extends only inclusive edges", () => {
    const { editor, p1 } = twoParas();
    const set = createDecorationSet(editor.state, [
      mention("excl", p1, 0, 4),
      mention("incl", p1, 5, 8, { inclusiveEnd: true }),
    ]);
    const a = step(at(editor, p1, 4), { type: "INSERT_TEXT", text: "a" }, set);
    expect(inlineText(a.set, p1)).toEqual([["excl", 0, 4], ["incl", 6, 9]]);
    const b = step(at(a.next, p1, 9), { type: "INSERT_TEXT", text: "!" }, a.set);
    expect(inlineText(b.set, p1)).toEqual([["excl", 0, 4], ["incl", 6, 10]]);
  });

  it("a decoration whose range is deleted disappears; Enter inside one splits it across blocks", () => {
    const { editor, p1 } = twoParas();
    const set = createDecorationSet(editor.state, [mention("anna", p1, 0, 4), mention("rosa", p1, 9, 13)]);
    const del = step(editor, { type: "DELETE_RANGE", span: createSpan(createPosition(p1, 0), createPosition(p1, 5)) }, set);
    expect(del.set.decorations.map((d) => d.id)).toEqual(["rosa"]);

    // Enter: the head [0, 6) takes the new id, the tail (the caret's block) keeps p1.
    const split = step(at(del.next, p1, 6), { type: "SPLIT_NODE" }, del.set);
    const head = getBlock(split.next.state, p1)?.prevSiblingId;
    if (head == null) throw new Error("no head");
    expect(split.next.selection.focus.blockId).toBe(p1);
    expect(inlineText(split.set, head)).toEqual([["rosa", 4, 6]]);
    expect(inlineText(split.set, p1)).toEqual([["rosa", 0, 2]]);
  });

  it("a block decoration disappears with its block; untouched blocks are not re-diffed", () => {
    const { editor, p1, p2 } = twoParas();
    const set = createDecorationSet(editor.state, [
      { kind: "block", id: "flag", blockId: p2 },
      mention("anna", p1, 0, 4),
    ]);
    // ¶p1 + all of p2's text go: p2 survives as the merge target, so its block
    // decoration is dropped (merged into); "anna" maps into p2.
    const del = step(editor, { type: "DELETE_RANGE", span: createSpan(createPosition(p1, 13), createPosition(p2, 9)) }, set);
    expect(del.set.decorations.map((d) => d.id)).toEqual(["anna"]);
    expect(del.set.forBlock(p2).block).toEqual([]);
    expect(inlineText(del.set, p2)).toEqual([["anna", 0, 4]]);
  });

  it("a block decoration is DROPPED when its block is split, merged into or renamed in the transaction (ProseMirror node decorations)", () => {
    const { editor, p1, p2 } = twoParas();
    const flags = (): DecorationSet =>
      createDecorationSet(editor.state, [{ kind: "block", id: "f1", blockId: p1 }, { kind: "block", id: "f2", blockId: p2 }]);
    const via = (r: { state: typeof editor.state; dirtyIds: ReadonlySet<BlockId> }) =>
      mapDecorationSet(flags(), createPositionMapping(editor.state, r.state, r.dirtyIds), r.state).decorations.map((d) => d.id);
    for (const b of iterateLeafBlocksInDocumentOrder(editor.state)) void b;
    // Typing keeps both.
    expect(via(insertText(editor.state, createPosition(p1, 2), "x", {}))).toEqual(["f1", "f2"]);
    // A split moves p1's text under a new id: p1 is restructured; p2 is untouched.
    expect(via(splitBlockAtPosition(editor.state, createPosition(p1, 4), createTestAllocator("n")))).toEqual(["f2"]);
    // A merge deletes ¶p1 (gone) and shifts p2's content (merged into): both go.
    expect(via(mergeAdjacentBlocks(editor.state, p1, p2))).toEqual([]);
  });

  it("comment highlights follow typing inside the comment and re-resolve when markers change", () => {
    const { editor, p1 } = twoParas();
    let ed = reduceEditor(editor, { type: "SET_SELECTION", selection: createSpan(createPosition(p1, 0), createPosition(p1, 4)) }, config);
    ed = reduceEditor(ed, { type: "ADD_COMMENT", id: "c1" as CommentId, author: "a", body: "b", createdAt: 1 }, config);
    const layers = createDecorationLayers();
    layers.setComments(ed.state, [{ commentId: "c1" as CommentId, active: false }]);
    const range = () => layers.merged.forBlock(p1).inline.map((s) => [s.start, s.end]);
    expect(range()).toEqual([[0, 5]]); // [start marker, end marker) around "Anna"
    // Type inside the commented word: the comment grows. (At its END — before the end
    // marker — the text lands after the marker, outside: caret affinity, Word.)
    for (const b of iterateLeafBlocksInDocumentOrder(ed.state)) void b;
    const typed = reduceEditor(at(ed, p1, 3), { type: "INSERT_TEXT", text: "a" }, config);
    layers.advance(at(ed, p1, 3), typed);
    expect(range()).toEqual([[0, 6]]);
    const atEnd = reduceEditor(at(typed, p1, 6), { type: "INSERT_TEXT", text: "b" }, config);
    layers.advance(at(typed, p1, 6), atEnd);
    expect(range()).toEqual([[0, 6]]);
  });

  it("transitionMapping composes batched edits (and caret moves) and is conservative past the change chain", () => {
    const { editor, p1 } = twoParas();
    const start = at(editor, p1, 0);
    for (const b of iterateLeafBlocksInDocumentOrder(start.state)) void b;
    const typed = reduceEditor(start, { type: "INSERT_TEXT", text: "So " }, config);
    const moved = at(typed, p1, 9);
    expect(transitionMapping(start, moved).map(createPosition(p1, 0), 1).position).toEqual(createPosition(p1, 3));
    // A host that batched a second edit still maps: the change chain composes both.
    const twice = reduceEditor(moved, { type: "INSERT_TEXT", text: "!" }, config); // at 9 in the new text
    expect(transitionMapping(start, twice).map(createPosition(p1, 9), 1).position).toEqual(createPosition(p1, 13));
    // Past the bounded chain the extent is unknown → conservative.
    let far = twice;
    for (let i = 0; i < MAX_CHANGE_CHAIN + 10; i++) far = reduceEditor(far, { type: "INSERT_TEXT", text: "x" }, config);
    expect(transitionMapping(start, far).map(createPosition(p1, 0)).position).toBeNull();
  });

  it("suggestion highlights drop when a suggestion is accepted without any text change", () => {
    const { editor, p1 } = twoParas();
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const typed = reduceEditor(at(editor, p1, 4), { type: "INSERT_TEXT", text: "a" }, suggesting);
    const id = getSuggestions(typed.state)[0]?.id;
    if (id === undefined) throw new Error("no suggestion");
    const layers = createDecorationLayers();
    layers.setSuggestions(typed.state, [{ suggestionId: id, active: false }]);
    expect(layers.merged.forBlock(p1).inline.length).toBe(1);
    for (const b of iterateLeafBlocksInDocumentOrder(typed.state)) void b;
    const accepted = reduceEditor(typed, { type: "ACCEPT_SUGGESTION", id }, config);
    layers.advance(typed, accepted);
    expect(layers.merged.forBlock(p1).inline.length).toBe(0);
  });

  it("stacked formatting suggestions each keep their own highlight; accepting one drops only its highlight", () => {
    const { editor, p1 } = twoParas();
    const select = (e: EditorState, a: number, b: number, cfg: typeof config): EditorState =>
      reduceEditor(e, { type: "SET_SELECTION", selection: createSpan(createPosition(p1, a), createPosition(p1, b)) }, cfg);
    const alice = { ...config, suggestingAuthor: "alice", now: () => 1 };
    const bob = { ...config, suggestingAuthor: "bob", now: () => 2 };
    const bold = reduceEditor(select(editor, 0, 8, alice), { type: "TOGGLE_STYLE", style: "bold" }, alice);
    const both = reduceEditor(select(bold, 5, 13, bob), { type: "TOGGLE_STYLE", style: "italic" }, bob);
    const [a, b] = getSuggestions(both.state).map((x) => x.id);
    if (a === undefined || b === undefined) throw new Error("expected two suggestions");
    const layers = createDecorationLayers();
    layers.setSuggestions(both.state, [{ suggestionId: a, active: false }, { suggestionId: b, active: false }]);
    expect(inlineText(layers.merged, p1)).toEqual([[`tw-suggestion:${a}`, 0, 8], [`tw-suggestion:${b}`, 5, 13]]);
    for (const blk of iterateLeafBlocksInDocumentOrder(both.state)) void blk;
    const accepted = reduceEditor(both, { type: "ACCEPT_SUGGESTION", id: b }, config);
    layers.advance(both, accepted);
    expect(inlineText(layers.merged, p1)).toEqual([[`tw-suggestion:${a}`, 0, 8]]);
  });

  it("live per-group suggestion styling follows proposals, accept, reject and undo", () => {
    const { editor, p1, p2 } = twoParas();
    const layers = createDecorationLayers();
    layers.setSuggestionStyles(editor.state, (g) => (g.metadata?.source === "bot" ? { class: "by-bot" } : null));
    const styled = (): number =>
      [p1, p2].reduce((n, b) => n + layers.merged.forBlock(b).inline.filter((s) => s.decoration.class === "by-bot").length, 0);
    const advance = (prev: EditorState, action: EditorAction): EditorState => {
      for (const b of iterateLeafBlocksInDocumentOrder(prev.state)) void b;
      const next = reduceEditor(prev, action, config);
      layers.advance(prev, next);
      return next;
    };
    expect(styled()).toBe(0);
    const groupId = "g-bot";
    const proposal = {
      groupId,
      author: "bot",
      metadata: { source: "bot" },
      edits: [
        { kind: "replace" as const, from: createPosition(p1, 5), to: createPosition(p1, 8), text: "saw" },
        { kind: "format" as const, from: createPosition(p2, 3), to: createPosition(p2, 9), attrs: { bold: true } },
      ],
    };
    const proposed = advance(editor, { type: "PROPOSE", proposal });
    expect(styled()).toBe(3); // deletion + insertion + formatting
    const accepted = advance(proposed, { type: "ACCEPT_SUGGESTION_GROUP", groupId });
    expect(styled()).toBe(0);
    const undone = advance(accepted, { type: "UNDO" });
    expect(styled()).toBe(3);
    const rejected = advance(undone, { type: "REJECT_SUGGESTION_GROUP", groupId });
    expect(styled()).toBe(0);
    layers.setSuggestionStyles(rejected.state, null);
    expect(styled()).toBe(0);
  });

  it("each setter re-derives ONLY its own layer (flipping the active comment scans no suggestion layer)", () => {
    const { editor, p1 } = twoParas();
    const suggesting = { ...config, suggestingAuthor: "alice" };
    const typed = reduceEditor(at(editor, p1, 4), { type: "INSERT_TEXT", text: "a" }, suggesting);
    const id = getSuggestions(typed.state)[0]?.id;
    if (id === undefined) throw new Error("no suggestion");
    const layers = createDecorationLayers();
    layers.setSuggestions(typed.state, [{ suggestionId: id, active: false }]);
    layers.setSuggestionStyles(typed.state, () => ({ class: "styled" }));
    const derived = (act: () => void): Record<string, number> => {
      resetPerfTrace();
      setPerfTraceEnabled(true);
      try {
        act();
      } finally {
        setPerfTraceEnabled(false);
      }
      const count = (label: string) => report().entries.find((e) => e.label === label)?.count ?? 0;
      return {
        comments: count("decorations.deriveComments"),
        suggestions: count("decorations.deriveSuggestions"),
        groupStyles: count("decorations.deriveGroupStyles"),
      };
    };
    const comment = "c1" as CommentId;
    expect(derived(() => layers.setComments(typed.state, [{ commentId: comment, active: false }]))).toEqual({ comments: 1, suggestions: 0, groupStyles: 0 });
    expect(derived(() => layers.setComments(typed.state, [{ commentId: comment, active: true }]))).toEqual({ comments: 1, suggestions: 0, groupStyles: 0 });
    expect(derived(() => layers.setSuggestions(typed.state, [{ suggestionId: id, active: true }]))).toEqual({ comments: 0, suggestions: 1, groupStyles: 0 });
    expect(derived(() => layers.setSuggestionStyles(typed.state, null))).toEqual({ comments: 0, suggestions: 0, groupStyles: 0 });
    expect(derived(() => layers.setSuggestionStyles(typed.state, () => null))).toEqual({ comments: 0, suggestions: 0, groupStyles: 1 });
  });

  it("replace-all across many paragraphs keeps every decoration on untouched text", () => {
    let editor = createInitialEditorState(config);
    for (let i = 0; i < 60; i++) {
      if (i > 0) editor = reduceEditor(editor, { type: "SPLIT_NODE" }, config);
      editor = reduceEditor(editor, { type: "INSERT_TEXT", text: "cat Anna" }, config);
    }
    const ids = [...iterateLeafBlocksInDocumentOrder(editor.state)].map((b) => b.id);
    const set = createDecorationSet(editor.state, ids.map((id, i) => mention(`m${i}`, id, 4, 8)));
    const matches = findMatches(editor.state, "cat");
    const { next, set: mapped } = step(editor, { type: "REPLACE_ALL", matches, replacement: "dog" }, set);
    expect(mapped.decorations.length).toBe(60);
    for (const id of ids) {
      expect(inlineText(mapped, id).map(([, s0, e0]) => [s0, e0])).toEqual([[4, 8]]);
      expect(getBlock(next.state, id)?.inlineContent?.items.map((it) => (it.kind === "text" ? it.text : "")).join("")).toBe("dog Anna");
    }
  });

  it("replace-all inside ONE long paragraph keeps the decorations between the edits", () => {
    let editor = createInitialEditorState(config);
    editor = reduceEditor(editor, { type: "INSERT_TEXT", text: Array.from({ length: 50 }, () => "cat Anna").join(" ") }, config);
    const id = editor.selection.focus.blockId;
    const set = createDecorationSet(editor.state, Array.from({ length: 50 }, (_, i) => mention(`m${i}`, id, i * 9 + 4, i * 9 + 8)));
    const { set: mapped } = step(editor, { type: "REPLACE_ALL", matches: findMatches(editor.state, "cat"), replacement: "dog" }, set);
    expect(mapped.decorations.length).toBe(50);
    expect(inlineText(mapped, id).every(([, s0, e0], i) => s0 === i * 9 + 4 && e0 === i * 9 + 8)).toBe(true);
  });

  it("a batch mixing a local edit and a foreign change to the same block maps from its endpoints", () => {
    const { editor, p1 } = twoParas();
    const start = at(editor, p1, 0);
    for (const b of iterateLeafBlocksInDocumentOrder(start.state)) void b;
    const local = reduceEditor(start, { type: "INSERT_TEXT", text: "So " }, config); // "So Anna met Rosa"
    // A peer then edits the same block (applied to the doc, reconciled as foreign).
    const op = insertText(local.state, createPosition(p1, 16), "!", {});
    const foreign = reconcileForeignChange(local, op.dirtyIds);
    const m = transitionMapping(start, foreign); // the controller saw neither intermediate state
    expect(m.map(createPosition(p1, 9), 1).position).toEqual(createPosition(p1, 12)); // "Rosa"
    expect(m.map(createPosition(p1, 13), -1).position).toEqual(createPosition(p1, 16));
  });

  it("text moved into a run of newly created blocks keeps its decorations (paste, batched splits)", () => {
    const seed = (): { e: EditorState; p: BlockId } => {
      let e = createInitialEditorState(config);
      e = reduceEditor(e, { type: "INSERT_TEXT", text: "Anna went to Berlin" }, config);
      return { e: at(e, e.selection.focus.blockId, 5), p: e.selection.focus.blockId };
    };
    const texts = (e: EditorState) => [...iterateLeafBlocksInDocumentOrder(e.state)].map((b) => b.inlineContent?.items.map((i) => (i.kind === "text" ? i.text : "")).join(""));

    // One step: a multi-paragraph paste splits the paragraph across three blocks.
    const a = seed();
    const setA = createDecorationSet(a.e.state, [mention("berlin", a.p, 13, 19)]);
    const pasted = step(a.e, { type: "PASTE", text: "one\ntwo\nthree" }, setA);
    const lastA = [...iterateLeafBlocksInDocumentOrder(pasted.next.state)].at(-1)?.id;
    expect(texts(pasted.next)).toEqual(["Anna one", "two", "threewent to Berlin"]);
    if (lastA === undefined) throw new Error("no block");
    expect(inlineText(pasted.set, lastA)).toEqual([["berlin", 13, 19]]);

    // Batched: Enter, type, Enter dispatched before the layers advance once.
    const b = seed();
    const layers = createDecorationLayers();
    layers.setHost(b.e.state, [mention("berlin", b.p, 13, 19)]);
    for (const blk of iterateLeafBlocksInDocumentOrder(b.e.state)) void blk;
    let e = reduceEditor(b.e, { type: "SPLIT_NODE" }, config);
    e = reduceEditor(e, { type: "INSERT_TEXT", text: "x" }, config);
    e = reduceEditor(e, { type: "SPLIT_NODE" }, config);
    layers.advance(b.e, e);
    const lastB = [...iterateLeafBlocksInDocumentOrder(e.state)].at(-1)?.id;
    expect(texts(e)).toEqual(["Anna ", "x", "went to Berlin"]);
    if (lastB === undefined) throw new Error("no block");
    expect(inlineText(layers.host, lastB)).toEqual([["berlin", 8, 14]]);
  });

  it("a value-equal rebuilt set re-draws nothing", () => {
    const { editor, p1 } = twoParas();
    const a = createDecorationSet(editor.state, [mention("anna", p1, 0, 4, { attributes: { "data-x": "1" } })]);
    const b = createDecorationSet(editor.state, [mention("anna", p1, 0, 4, { attributes: { "data-x": "1" } })]);
    expect(changedDecorationBlocks(a, b).size).toBe(0);
    const c = createDecorationSet(editor.state, [mention("anna", p1, 0, 4, { attributes: { "data-x": "2" } })]);
    expect([...changedDecorationBlocks(a, c)]).toEqual([p1]);
  });
});
