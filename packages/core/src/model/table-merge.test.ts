/** N6 mergeCells (T6): what the table-ops harness does not see (paragraph keys, anchors, a peer's edit). */
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, type Block } from "./block";
import { insertText } from "./commands/insert-text";
import { mergeCells } from "./commands/table/merge-cells";
import { firingsOf } from "./oracle/firings";
import { caretAt } from "./position/model-position";
import { newMarker } from "./storage/new-items";
import { childrenOf } from "./test-helpers/fixture";
import { Harness, sync } from "./test-helpers/harness";
import { type Unit, raw, units } from "./test-helpers/table";

/** The table's cells (row-major) as their paragraphs: text with `†<id>` / `‡<id>` per marker, then `:type` if not a paragraph. */
function cells(h: Harness): string[][] {
  const d = h.version;
  const t = h.paragraphs().find((b) => b.type === BLOCK_TYPES.table);
  if (t === undefined) throw new Error("no table");
  const para = (b: Block): string =>
    (b.inlineContent?.items ?? [])
      .map((i) => (i.kind === "text" ? i.text : i.kind === "embed" && i.embedType === "marker" ? `${i.properties["edge"] === "end" ? "‡" : "†"}${String(i.properties["id"])}` : "?"))
      .join(" ") + (b.type === BLOCK_TYPES.paragraph ? "" : `:${b.type}`);
  return childrenOf(d, "block", t.id).flatMap((r) => childrenOf(d, "block", r.id).map((c) => childrenOf(d, "block", c.id).map(para)));
}

/** A caret at `offset` in paragraph `p` of cell `i` (row-major). */
function caret(h: Harness, i: number, p: number, offset: number): void {
  const d = h.version;
  const t = h.paragraphs().find((b) => b.type === BLOCK_TYPES.table);
  const cell = t === undefined ? undefined : childrenOf(d, "block", t.id).flatMap((r) => childrenOf(d, "block", r.id))[i];
  const q = cell === undefined ? undefined : childrenOf(d, "block", cell.id)[p];
  if (q === undefined) throw new Error(`no paragraph ${p} in cell ${i}`);
  h.selection = caretAt(q.id, offset);
}

const noFirings = (h: Harness): void => {
  for (const [, fs] of h.version.flows.entries()) expect(firingsOf(fs)).toEqual([]);
};

/** `spec`'s units, a word `†<id>` / `‡<id>` a comment anchor's start / end marker. */
const marked = (spec: string): Unit[] =>
  units(spec).map((u) => (typeof u === "string" && (u.startsWith("†") || u.startsWith("‡")) ? newMarker("c", u.slice(1), u.startsWith("†") ? "start" : "end") : u));

describe("mergeCells (T6)", () => {
  it("F5: the head's last paragraph and the moved last paragraph both keep their keys; undo restores them", () => {
    // maps: ⟦ ⟨r⟩ ⟨c⟩ ¶a ⟨c⟩ ¶b ⟨r⟩ ⟨c⟩ ¶c ⟨c⟩ ¶d ⟧
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨c⟩ b¶ ⟨r⟩ ⟨c⟩ c¶ ⟨c⟩ d¶ ⟧ q¶", (m) => {
      m[3]?.set("p:type", "heading");
      m[8]?.set("p:type", "quote");
    });
    caret(h, 0, 0, 0);
    const before = h.read();
    expect(h.run((c) => mergeCells(c, [0, 0], [1, 0]))).toBe(true);
    expect(cells(h)).toEqual([["a:heading", "c:quote"], ["b"], ["d"]]);
    expect(h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
    caret(h, 0, 0, 0);
    expect(h.run((c) => mergeCells(c, [0, 1], [1, 1]))).toBe(true);
    expect(cells(h)).toEqual([["a:heading"], ["b", "d"], ["c:quote"]]);
  });

  it("empty cells add nothing (an empty head too); an all-empty rectangle keeps one empty paragraph; undo restores", () => {
    const h = raw("⟦ ⟨r⟩ ⟨c⟩ ¶ ⟨c⟩ b¶ ⟨c⟩ ¶ ⟨r⟩ ⟨c⟩ ¶ ⟨c⟩ e¶ ⟨c⟩ ¶ ⟧ q¶");
    caret(h, 0, 0, 0);
    const before = h.read();
    expect(h.run((c) => mergeCells(c, [0, 0], [1, 2]))).toBe(true);
    expect(cells(h)).toEqual([["b", "e"]]);
    noFirings(h);
    expect(h.undo()).toBe(true);
    expect(h.read()).toEqual(before);
    caret(h, 0, 0, 0);
    expect(h.run((c) => mergeCells(c, [0, 2], [1, 2]))).toBe(true);
    expect(cells(h)).toEqual([[""], ["b"], [""], [""], ["e"]]);
    noFirings(h);
  });

  it("an anchor in a moved cell moves with its text (not copied, not left behind)", () => {
    const h = raw(marked("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩ ⟨c⟩ †1 d ‡1 ¶ ⟧ q¶"));
    caret(h, 0, 0, 0);
    expect(h.run((c) => mergeCells(c, [0, 0], [1, 0]))).toBe(true);
    expect(cells(h)).toEqual([["a", "†1 d ‡1"]]);
    expect(JSON.stringify(h.read()).split('"embedType":"marker"').length - 1).toBe(2);
  });

  it("a peer types at the end of the moved run, the merger undoes: the text ends the head's paragraph, no debris", () => {
    const a = raw("⟦ ⟨r⟩ ⟨c⟩ a¶ ⟨r⟩ ⟨c⟩ d¶ ⟧ q¶");
    const b = new Harness(2, {}, a);
    caret(a, 0, 0, 0);
    expect(a.run((c) => mergeCells(c, [0, 0], [1, 0]))).toBe(true);
    sync(a, b);
    expect(cells(b)).toEqual([["a", "d"]]);
    caret(b, 0, 1, 1);
    expect(b.run(insertText, "Z")).toBe(true);
    sync(a, b);
    expect(a.undo()).toBe(true);
    sync(a, b);
    expect(cells(a)).toEqual([["aZ"], ["d"]]);
    expect(b.read()).toEqual(a.read());
    noFirings(a);
  });
});
