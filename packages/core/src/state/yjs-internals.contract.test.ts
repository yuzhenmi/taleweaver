/**
 * Contract for the Yjs internals the structural storage relies on (yjs is an
 * EXACT peer dependency — a Yjs upgrade must re-run this first), plus the
 * flow-array encapsulation rule.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";

// Minimal Node surface (the core tsconfig omits `@types/node`; see encapsulation.test.ts).
interface NodeFs {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean };
}
declare const __dirname: string;
declare function require(id: "node:fs"): NodeFs;
declare function require(id: "node:path"): { join(...parts: string[]): string };
declare function require(id: "node:module"): { createRequire(url: string): (id: string) => unknown };
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { createRequire } = require("node:module");
import { insertPieceAfter, insertPieceBefore, topPieces, newFlow, markOf, isSubflowItem, subflowPieces, nextUnit, prevUnit, firstUnitOfFlow, lastUnitOfFlow } from "./y-flow";

const PINNED = "13.6.30";

function flowDoc(): { doc: Y.Doc; flow: Y.Array<Y.Text> } {
  const doc = new Y.Doc();
  const root = doc.getMap<Y.Map<unknown>>("registry");
  const entry = new Y.Map<unknown>();
  entry.set("flow", newFlow());
  root.set("r", entry);
  const flow = root.get("r")?.get("flow");
  if (!(flow instanceof Y.Array)) throw new Error("fixture");
  return { doc, flow: flow as Y.Array<Y.Text> };
}

describe("Yjs internals contract", () => {
  it("runs on the pinned Yjs version, as a single instance", () => {
    const req = createRequire(import.meta.url);
    const pkg = req("yjs/package.json") as { version: string };
    expect(pkg.version).toBe(PINNED);
    const core = req("../../package.json") as { peerDependencies?: Record<string, string> };
    expect(core.peerDependencies?.yjs).toBe(PINNED);
    const doc = new Y.Doc();
    const t = doc.getText("t");
    t.insert(0, "x");
    expect(t._start).toBeInstanceOf(Y.Item);
  });

  it("Item fields, AbstractType._item/_start and the Content classes", () => {
    const { doc, flow } = flowDoc();
    const piece = topPieces(flow)[0];
    if (piece === undefined) throw new Error("no piece");
    doc.transact(() => {
      piece.insert(0, "ab", { bold: true });
      piece.insertEmbed(2, { end: "M" }, {});
      piece.insertEmbed(3, { embedType: "x", properties: {} }, {});
    });
    const items: Y.Item[] = [];
    for (let it = piece._start; it !== null; it = it.right) items.push(it);
    expect(items.some((i) => i.content instanceof Y.ContentFormat)).toBe(true);
    const str = items.find((i) => i.content instanceof Y.ContentString);
    expect(str?.length).toBe(2);
    expect(str?.countable).toBe(true);
    expect(str?.parent).toBe(piece);
    const mark = items.find((i) => markOf(i) !== null);
    expect(mark?.content).toBeInstanceOf(Y.ContentEmbed);
    expect(piece._item?.content).toBeInstanceOf(Y.ContentType);
    expect(piece._item?.parent).toBe(flow);
    expect(flow._item?.parentSub).toBe("flow");
    expect(mark?.left?.right).toBe(mark);
    expect(mark?.id.client).toBe(doc.clientID);
  });

  it("Item constructor + integrate insert a piece after / before (O(1)) and replicate", () => {
    const { doc, flow } = flowDoc();
    const first = topPieces(flow)[0];
    if (first === undefined) throw new Error("no piece");
    doc.transact(() => {
      first.insert(0, "one");
      const after = new Y.Text();
      insertPieceAfter(first, after);
      after.insert(0, "two");
      const before = new Y.Text();
      insertPieceBefore(first, before);
      before.insert(0, "zero");
    });
    expect(topPieces(flow).map((p) => p.toString())).toEqual(["zero", "one", "two"]);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const pf = peer.getMap<Y.Map<unknown>>("registry").get("r")?.get("flow");
    if (!(pf instanceof Y.Array)) throw new Error("no flow");
    expect(topPieces(pf as Y.Array<Y.Text>).map((p) => p.toString())).toEqual(["zero", "one", "two"]);
  });

  it("sub-flows are read in place by the flow-order walk", () => {
    const { doc, flow } = flowDoc();
    const piece = topPieces(flow)[0];
    if (piece === undefined) throw new Error("no piece");
    doc.transact(() => {
      piece.insert(0, "ac");
      const inner = new Y.Text();
      const sub = new Y.Map<unknown>();
      const arr = new Y.Array<Y.Text>();
      arr.insert(0, [inner]);
      sub.set("pieces", arr);
      piece.insertEmbed(1, sub, {});
      inner.insert(0, "b");
    });
    const seen: string[] = [];
    for (let u = firstUnitOfFlow(flow); u !== null; u = nextUnit(u)) {
      if (u.content instanceof Y.ContentString) seen.push(u.content.str);
      if (isSubflowItem(u)) expect(subflowPieces(u)).not.toBeNull();
    }
    expect(seen.join("")).toBe("abc");
    const back: string[] = [];
    for (let u = lastUnitOfFlow(flow); u !== null; u = prevUnit(u)) {
      if (u.content instanceof Y.ContentString) back.push(u.content.str);
    }
    expect(back.join("")).toBe("cba");
  });

  it("transaction beforeState / afterState / deleteSet, findIndexSS, getItem, iterateDeletedStructs", () => {
    const doc = new Y.Doc();
    const t = doc.getText("t");
    t.insert(0, "abc");
    let inserted = 0;
    let deleted = 0;
    doc.on("afterTransaction", (tx: Y.Transaction) => {
      tx.afterState.forEach((clock, client) => {
        const before = tx.beforeState.get(client) ?? 0;
        const structs = doc.store.clients.get(client) ?? [];
        for (let i = Y.findIndexSS(structs, before); i < structs.length; i++) {
          const s = structs[i];
          if (s !== undefined && s.id.clock < clock) inserted++;
        }
      });
      Y.iterateDeletedStructs(tx, tx.deleteSet, () => {
        deleted++;
      });
    });
    doc.transact(() => {
      t.insert(3, "d");
      t.delete(0, 1);
    });
    expect(inserted).toBeGreaterThan(0);
    expect(deleted).toBe(1);
    const first = t._start;
    if (first === null) throw new Error("no item");
    expect(Y.getItem(doc.store, first.id)).toBe(first);
  });

  it("a second Yjs instance creates structs that are not this instance's Item", () => {
    const Y2 = createRequire(import.meta.url)("yjs") as typeof Y;
    expect(Y2.Item).not.toBe(Y.Item);
    const doc = new Y.Doc();
    const other = new Y2.Doc();
    other.getText("t").insert(0, "x");
    Y2.applyUpdate(doc, Y2.encodeStateAsUpdate(other));
    const structs = doc.store.clients.get(other.clientID) ?? [];
    expect(structs.some((s) => !(s instanceof Y.Item) && !(s instanceof Y.GC))).toBe(true);
  });
});

describe("flow-array encapsulation", () => {
  it("no module outside y-flow.ts / registry.ts reads a flow / sub-flow array by key or uses its index API", () => {
    const dir = join(__dirname);
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".bench.ts")) files.push(p);
      }
    };
    walk(dir);
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith("y-flow.ts") || f.endsWith("registry.ts")) continue;
      const src = readFileSync(f, "utf8");
      if (/\.get\(\s*"(flow|pieces)"\s*\)/.test(src)) offenders.push(`${f}: reads a flow by key`);
      if (/(entryFlow|subflowPieces|topFlowOfPiece|holderFlows)\([^)]*\)\??\.(insert|delete|push|unshift|get|slice|toArray|length)\b/.test(src)) {
        offenders.push(`${f}: index API on a flow array`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
