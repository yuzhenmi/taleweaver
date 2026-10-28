import { describe, it, expect } from "vitest";
import { config, reduceEditor, createInitialEditorState, createPosition } from "./actions/test-helpers";
import { createFindSession } from "./find-session";
import { findHighlightDecorations, findDecorationId } from "../decorations/builtin-highlights";
import { transitionMapping } from "../decorations/decoration-layers";
import { getBlock } from "../state";

function seeded(text: string) {
  let e = createInitialEditorState(config);
  e = reduceEditor(e, { type: "INSERT_TEXT", text }, config);
  return { e, p: e.selection.focus.blockId };
}

describe("createFindSession", () => {
  it("finds from the caret, wraps, and replaces through engine actions", () => {
    let { e, p } = seeded("cat dog cat dog cat");
    const s = createFindSession();
    expect(s.start(e.state, createPosition(p, 5), "cat")).toEqual({ total: 3, activeIndex: 1 });
    expect(s.next()).toEqual({ total: 3, activeIndex: 2 });
    expect(s.next()).toEqual({ total: 3, activeIndex: 0 });
    expect(s.prev()).toEqual({ total: 3, activeIndex: 2 });
    const action = s.replaceActiveAction("cow");
    if (action === null) throw new Error("no action");
    e = reduceEditor(e, action, config);
    // The replaced match is gone; the index clamps onto a survivor.
    expect(s.refresh(e.state).status).toEqual({ total: 2, activeIndex: 1 });
    const all = s.replaceAllAction("x");
    if (all === null) throw new Error("no action");
    e = reduceEditor(e, all, config);
    expect(s.refresh(e.state).status).toEqual({ total: 0, activeIndex: -1 });
    expect(s.replaceActiveAction("y")).toBeNull();
    s.close();
    expect(s.active).toBe(false);
  });

  it("replace advances past a replacement that contains the query", () => {
    let { e, p } = seeded("a b a b a");
    const s = createFindSession();
    s.start(e.state, createPosition(p, 0), "a");
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const action = s.replaceActiveAction("aa");
      if (action === null) throw new Error("no action");
      const prev = e;
      e = reduceEditor(e, action, config);
      const r = s.refresh(e.state, transitionMapping(prev, e));
      seen.push(s.matches()[r.status.activeIndex]?.start ?? -1);
    }
    // Each replace moves on to the next original "a" (offsets after earlier "aa" growth).
    expect(seen).toEqual([5, 10, 0]);
  });

  it("an edit before the active match keeps the same occurrence active and redraws only edited blocks", () => {
    let e = createInitialEditorState(config);
    e = reduceEditor(e, { type: "INSERT_TEXT", text: "x cat" }, config);
    e = reduceEditor(e, { type: "SPLIT_NODE" }, config);
    e = reduceEditor(e, { type: "INSERT_TEXT", text: "cat cat" }, config);
    const p2 = e.selection.focus.blockId;
    // The split's head "x cat" is the new block.
    const p1 = getBlock(e.state, p2)?.prevSiblingId ?? p2;
    const s = createFindSession();
    s.start(e.state, createPosition(p2, 4), "cat"); // active = p2's second "cat"
    expect(s.activeIndex()).toBe(2);
    const prev = reduceEditor(e, { type: "SET_SELECTION", selection: { anchor: createPosition(p1, 0), focus: createPosition(p1, 0) } }, config);
    const next = reduceEditor(prev, { type: "INSERT_TEXT", text: "cat " }, config); // a new match BEFORE the active one
    const r = s.refresh(next.state, transitionMapping(prev, next));
    expect(r.status).toEqual({ total: 4, activeIndex: 3 }); // still p2's second "cat"
    expect(s.matches()[3]).toMatchObject({ blockId: p2, start: 4 });
    expect([...(r.changedBlocks ?? [])].sort()).toEqual([p1, p2].sort());
    // Highlights outside the redrawn blocks must not carry a list index that just went stale.
    const decos = findHighlightDecorations(s.matches(), s.activeIndex());
    expect(decos.every((d) => JSON.stringify(d.data) === JSON.stringify({ kind: "find" }))).toBe(true);
    expect(decos.map((d) => d.id)).toEqual(s.matches().map((m) => findDecorationId(m)));
  });
});
