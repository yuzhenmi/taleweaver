/**
 * Transaction-derived exact position mapping: positions map from the transaction's
 * own structure changes — a block the previous State never read maps exactly (no
 * "unknown"), repeated text resolves to the side the edit happened on without a hint,
 * and renames (split, join, materialization, canonical change, collapse) map on the
 * local AND the remote side.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createState, getBlock, type State } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import { insertText } from "./ops/insert-text";
import { deleteRange } from "./ops/delete-range";
import { splitBlockAtPosition } from "./ops/split-block";
import { mergeAdjacentBlocks } from "./ops/merge-blocks";
import { removeBlock } from "./ops/remove-block";
import { setBlockAttrs } from "./ops/set-block-attrs";
import { createPosition, createSpan, type Position } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { createPositionMapping, type PositionMapping } from "./position-mapping";
import { subscribeForeignChanges } from "./collab";
import { TEST_RESOLVER, buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";

const id = (s: string) => s as BlockId;
const pos = (b: string, o: number): Position => createPosition(id(b), o);

function docOf(blocks: ReadonlyArray<{ id: string; type?: string; text?: string }>): State {
  const ids = blocks.map((b) => b.id);
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: ids[0] ?? null, lastChildId: ids[ids.length - 1] ?? null }),
      ...blocks.map((b, k) =>
        buildBlock({
          id: b.id,
          type: b.type ?? "paragraph",
          parentId: "doc",
          prevSiblingId: ids[k - 1] ?? null,
          nextSiblingId: ids[k + 1] ?? null,
          inlineContent: b.type === "image" ? null : inlineContent(b.text === undefined || b.text === "" ? [] : [text(b.text)]),
        }),
      ),
    ],
  });
}

function peer(s: State, clientID: number): State {
  const doc = new Y.Doc();
  doc.clientID = clientID;
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(s[STATE_INTERNAL].doc));
  return createState({ resolver: TEST_RESOLVER, rootId: s.rootId, doc });
}

/** Map through a local op: `prev` is a FRESH State (nothing cached). */
function local(prev: State, op: (s: State) => { state: State; dirtyIds: ReadonlySet<BlockId> }): { next: State; m: PositionMapping } {
  const r = op(prev);
  return { next: r.state, m: createPositionMapping(prev, r.state, r.dirtyIds) };
}

const at = (m: PositionMapping, p: Position, assoc: -1 | 1 = 1) => m.map(p, assoc);

describe("exact mapping — never-cached blocks map exactly (local)", () => {
  it("typing before a position in a block the previous State never read", () => {
    const prev = docOf([{ id: "A", text: "hello world" }]);
    const { m } = local(prev, (s) => insertText(s, pos("A", 0), "XX", {}));
    expect(at(m, pos("A", 6))).toEqual({ position: pos("A", 8), deleted: false });
  });

  it("repeated text: the edit side is exact without a hint", () => {
    const prev = docOf([{ id: "A", text: "aaaa" }]);
    const { m } = local(prev, (s) => insertText(s, pos("A", 1), "a", {}));
    expect(at(m, pos("A", 1), -1).position).toEqual(pos("A", 1));
    expect(at(m, pos("A", 1), 1).position).toEqual(pos("A", 2));
    expect(at(m, pos("A", 3)).position).toEqual(pos("A", 4));
    const del = local(prev, (s) => deleteRange(s, createSpan(pos("A", 0), pos("A", 1))));
    expect(at(del.m, pos("A", 3)).position).toEqual(pos("A", 2));
    expect(at(del.m, pos("A", 1)).position).toEqual(pos("A", 0));
  });

  it("split: the head maps into the new block (its ¶ is new); join: the left block maps before the right (R survives)", () => {
    const prev = docOf([{ id: "A", text: "hello world" }, { id: "B", text: "next" }]);
    const split = splitBlockAtPosition(prev, pos("A", 5), createTestAllocator("n"));
    const m = createPositionMapping(prev, split.state, split.dirtyIds);
    expect(at(m, pos("A", 3)).position).toEqual(createPosition(split.newBlockId, 3));
    expect(at(m, pos("A", 8)).position).toEqual(pos("A", 3));
    expect(at(m, pos("B", 2)).position).toEqual(pos("B", 2));
    const fresh = createState({ resolver: TEST_RESOLVER, rootId: split.state.rootId, doc: split.state[STATE_INTERNAL].doc });
    const join = mergeAdjacentBlocks(fresh, split.newBlockId, id("A"));
    const jm = createPositionMapping(fresh, join.state, join.dirtyIds);
    expect(at(jm, createPosition(split.newBlockId, 2)).position).toEqual(pos("A", 2));
    expect(at(jm, pos("A", 2)).position).toEqual(pos("A", 7));
  });

  it("removing a block maps its positions to the removal point (deleted)", () => {
    const prev = docOf([{ id: "A", text: "ab" }, { id: "B", text: "cd" }, { id: "C", text: "ef" }]);
    const { m } = local(prev, (s) => removeBlock(s, id("B")));
    const r = at(m, pos("B", 1));
    expect(r.deleted).toBe(true);
    expect(at(m, pos("C", 1)).position).toEqual(pos("C", 1));
  });

  it("a cross-block delete maps the left block's head into the surviving right block", () => {
    const prev = docOf([{ id: "A", text: "abcd" }, { id: "B", text: "efgh" }, { id: "C", text: "ijkl" }]);
    const { m } = local(prev, (s) => deleteRange(s, createSpan(pos("A", 2), pos("C", 1))));
    expect(at(m, pos("C", 3)).position).toEqual(pos("C", 4));
    expect(at(m, pos("B", 2)).deleted).toBe(true);
    expect(at(m, pos("A", 1)).position).toEqual(pos("C", 1));
  });
});

describe("exact mapping — renames (materialization, collapse), local and remote", () => {
  /**
   * [img][P "abc"][Q "q"][img2][Z]: peer A removes P (¶Q then follows the image) while
   * peer B types in P and removes Q (¶P then follows it) → content with no ¶ before img2.
   */
  function strayAfterImage(): State {
    const a0 = peer(docOf([{ id: "img", type: "image" }, { id: "P", text: "abc" }, { id: "Q", text: "q" }, { id: "img2", type: "image" }, { id: "Z", text: "z" }]), 1);
    const b0 = peer(a0, 2);
    const a = removeBlock(a0, id("P")).state;
    const b = removeBlock(insertText(b0, pos("P", 2), "XYZ", {}).state, id("Q")).state;
    Y.applyUpdate(a[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(b[STATE_INTERNAL].doc), "remote");
    return createState({ resolver: TEST_RESOLVER, rootId: a.rootId, doc: a[STATE_INTERNAL].doc });
  }

  it("materializing `${obj}#i` maps (derived, j) → (fresh, j) on the writer", () => {
    const prev = strayAfterImage();
    expect(getBlock(prev, id("img#i"))).not.toBeNull();
    const r = setBlockAttrs(createState({ resolver: TEST_RESOLVER, rootId: prev.rootId, doc: prev[STATE_INTERNAL].doc }), id("img#i"), { align: "center" });
    const fresh = getBlock(r.state, id("img"))?.nextSiblingId;
    expect(fresh).not.toBe("img#i");
    const m = createPositionMapping(prev, r.state, r.dirtyIds);
    expect(at(m, pos("img#i", 2)).position).toEqual(createPosition(id(String(fresh)), 2));
  });

  it("…and on the remote peer receiving the materialization", () => {
    const writer = strayAfterImage();
    const reader = peer(writer, 7);
    const seen: { dirty: ReadonlySet<BlockId> }[] = [];
    const before = createState({ resolver: TEST_RESOLVER, rootId: reader.rootId, doc: reader[STATE_INTERNAL].doc });
    const off = subscribeForeignChanges(before, "self", (dirty) => seen.push({ dirty }), () => {});
    const r = setBlockAttrs(createState({ resolver: TEST_RESOLVER, rootId: writer.rootId, doc: writer[STATE_INTERNAL].doc }), id("img#i"), { align: "center" });
    Y.applyUpdate(reader[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(r.state[STATE_INTERNAL].doc, Y.encodeStateVector(reader[STATE_INTERNAL].doc)), "peer");
    off();
    const after = createState({ resolver: TEST_RESOLVER, rootId: reader.rootId, doc: reader[STATE_INTERNAL].doc });
    const fresh = getBlock(after, id("img"))?.nextSiblingId;
    expect(seen).toHaveLength(1);
    const m = createPositionMapping(before, after, seen[0]?.dirty ?? new Set());
    expect(at(m, pos("img#i", 1)).position).toEqual(createPosition(id(String(fresh)), 1));
  });

  it("a remote keystroke maps a never-read block exactly", () => {
    const writer = docOf([{ id: "A", text: "hello" }, { id: "B", text: "world" }]);
    const reader = peer(writer, 9);
    const seen: ReadonlySet<BlockId>[] = [];
    const off = subscribeForeignChanges(reader, "self", (d) => seen.push(d), () => {});
    const w = insertText(peer(writer, 3), pos("B", 0), ">>", {});
    Y.applyUpdate(reader[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(w.state[STATE_INTERNAL].doc, Y.encodeStateVector(reader[STATE_INTERNAL].doc)), "peer");
    off();
    const after = createState({ resolver: TEST_RESOLVER, rootId: reader.rootId, doc: reader[STATE_INTERNAL].doc });
    const m = createPositionMapping(reader, after, seen[0] ?? new Set());
    expect(at(m, pos("B", 3))).toEqual({ position: pos("B", 5), deleted: false });
    expect(at(m, pos("A", 3))).toEqual({ position: pos("A", 3), deleted: false });
  });
});

describe("exact mapping — every kept character maps onto itself (fuzz)", () => {
  function rng(seed: number): () => number {
    let x = seed;
    return () => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return x / 0x7fffffff;
    };
  }
  /** Every text block in document order: id → text. */
  function texts(s: State): Map<string, string> {
    const fresh = createState({ resolver: TEST_RESOLVER, rootId: s.rootId, doc: s[STATE_INTERNAL].doc });
    const out = new Map<string, string>();
    for (let cur = getBlock(fresh, fresh.rootId)?.firstChildId ?? null; cur !== null; ) {
      const b = getBlock(fresh, cur);
      if (b === null) break;
      if (b.inlineContent !== null) out.set(b.id, b.inlineContent.items.map((i) => (i.kind === "text" ? i.text : "￼")).join(""));
      cur = b.nextSiblingId;
    }
    return out;
  }
  function check(before: Map<string, string>, after: Map<string, string>, m: PositionMapping, where: string): void {
    for (const [bid, t] of before) {
      for (let k = 0; k < t.length; k++) {
        const r = m.map(pos(bid, k), 1);
        if (r.deleted) continue;
        expect(r.position, `${where}: ${bid}@${k} unmapped`).not.toBeNull();
        if (r.position === null) continue;
        expect(after.get(r.position.blockId)?.[r.position.offset], `${where}: ${bid}@${k} "${t[k]}"`).toBe(t[k]);
      }
    }
  }

  it("through local edits, moves, undo / redo and remote transactions on two peers", async () => {
    const { reparentChildren } = await import("./ops/reparent-children");
    for (const seed of Array.from({ length: 12 }, (_, i) => i + 140)) {
      const r = rng(seed);
      let n = 0;
      const fresh = (): string => String.fromCharCode(0x4e00 + n++);
      const word = (): string => Array.from({ length: 1 + Math.floor(r() * 3) }, fresh).join("");
      const base = docOf([{ id: "A", text: word() + word() }, { id: "B", text: word() }, { id: "C", text: word() + word() }]);
      const peers = [peer(base, 1), peer(base, 2)];
      const last: (ReadonlySet<BlockId> | null)[] = [null, null];
      const offs = peers.map((p, i) => subscribeForeignChanges(p, "self", (d) => (last[i] = d), () => {}));
      const undos = peers.map(
        (p) => new Y.UndoManager([p[STATE_INTERNAL].doc.getMap("registry")], { captureTimeout: 0 }),
      );
      const alloc = createTestAllocator(`x${seed}`);
      for (let step = 0; step < 80; step++) {
        const k = r() < 0.5 ? 0 : 1;
        const s = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc: (peers[k] as State)[STATE_INTERNAL].doc });
        const before = texts(s);
        const ids = [...before.keys()];
        const target = ids[Math.floor(r() * ids.length)];
        if (target === undefined) continue;
        const len = before.get(target)?.length ?? 0;
        const off = Math.floor(r() * (len + 1));
        const op = r();
        let dirty: ReadonlySet<BlockId> | null = null;
        let next: State = s;
        const run = (res: { state: State; dirtyIds: ReadonlySet<BlockId> }): void => {
          next = res.state;
          dirty = res.dirtyIds;
        };
        if (op < 0.35) run(insertText(s, pos(target, off), word(), {}));
        else if (op < 0.5 && len > 0) run(deleteRange(s, createSpan(pos(target, Math.min(off, len - 1)), pos(target, Math.min(len, off + 2)))));
        else if (op < 0.6) run(splitBlockAtPosition(s, pos(target, off), alloc));
        else if (op < 0.68) {
          const nx = ids[ids.indexOf(target) + 1];
          if (nx !== undefined) run(mergeAdjacentBlocks(s, id(target), id(nx)));
        } else if (op < 0.76 && ids.length > 2) {
          const far = ids[Math.min(ids.length - 1, ids.indexOf(target) + 2)];
          if (far !== undefined && far !== target) run(deleteRange(s, createSpan(pos(target, off), pos(far, Math.floor(r() * ((before.get(far)?.length ?? 0) + 1))))));
        } else if (op < 0.82 && ids.length > 1) {
          const dest = ids[Math.floor(r() * ids.length)];
          if (dest !== undefined && dest !== target) run(reparentChildren(s, [id(target)], id("doc"), id(dest)));
        } else if (op < 0.9) {
          last[k] = null;
          if (r() < 0.6) undos[k]?.undo();
          else undos[k]?.redo();
          dirty = last[k];
          next = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc: s[STATE_INTERNAL].doc });
        } else {
          // A remote transaction on peer k.
          const other = peers[1 - k] as State;
          last[k] = null;
          Y.applyUpdate(s[STATE_INTERNAL].doc, Y.encodeStateAsUpdate(other[STATE_INTERNAL].doc, Y.encodeStateVector(s[STATE_INTERNAL].doc)), "remote");
          dirty = last[k];
          next = createState({ resolver: TEST_RESOLVER, rootId: id("doc"), doc: s[STATE_INTERNAL].doc });
        }
        if (dirty === null || next === s) continue;
        check(before, texts(next), createPositionMapping(s, next, dirty), `seed ${seed} step ${step} op ${op.toFixed(2)}`);
      }
      for (const off of offs) off();
    }
  }, 30_000);
});
