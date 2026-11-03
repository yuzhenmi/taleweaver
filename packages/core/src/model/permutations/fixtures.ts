/**
 * Test-only: category permutation fixtures. One representative kind per category; for an
 * ordered pair (L, R) a small valid document `x¶ L R y¶` (padded as the single-user rules
 * need) in a container, built in raw storage; and the container's read as a linear
 * sequence of category units (the units the storage holds, in order, and the ¶ of each
 * block object's implicit paragraph, flagged `implicit`; a table as its `⟦`, its cells' content, its `⟧`).
 */
import * as Y from "yjs";
import type { Block, ReadonlyAttrs } from "../block";
import { insertFootnote } from "../commands/insert-footnote";
import { insertHeaderFooter } from "../commands/insert-header-footer";
import type { Document, FlowState, TreeKind } from "../document/types";
import { afterObjectId } from "../ids";
import { OPTIONS } from "../oracle/random-command";
import { isTextSelection } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { CATEGORIES, type Category, type Container, type FlowKind, allowedIn, categoryOfKind, isText, kindOfItem } from "../scan/kinds";
import type { Unit as LinearUnit } from "./expectations";
import { unitsOf } from "../position/items";
import { newHorizontalRule, newMarker, newObject, newParagraphMark, newSectionBreak, newTableOfContents } from "../storage/new-items";
import { Harness } from "../test-helpers/harness";
import { childrenOf, idOf } from "../test-helpers/fixture";
import { units as tableUnits } from "../test-helpers/table";

export const CATEGORY_LIST: readonly Category[] = ["text", "paragraphBreak", "inlineAtom", "rule", "anchor", "atomicBlock", "containerBlock", "sectionBreak"];
export const CONTAINERS: readonly Container[] = ["body", "cell", "footnote", "headerFooter"];

/** The one kind standing for each category. */
export const REPRESENTATIVE: Readonly<Record<Category, FlowKind>> = {
  text: "text",
  paragraphBreak: "para",
  inlineAtom: "object",
  rule: "hr",
  anchor: "marker",
  atomicBlock: "toc",
  containerBlock: "table",
  sectionBreak: "S",
};

export const placeable = (c: Category, where: Container): boolean => allowedIn(REPRESENTATIVE[c], where);

const structural = (c: Category): boolean => CATEGORIES[c].blockObject || c === "sectionBreak";
const terminator = (c: Category): boolean => CATEGORIES[c].terminator;

/** Why `L R` adjacent is unreachable single-user (null: reachable). Phrased on traits. */
export function unreachable(l: Category, r: Category): string | null {
  if (structural(r) && l !== "paragraphBreak") return "W1 / A2: a block object or [S] follows a ¶ (or the flow start)";
  // Zero-width units (anchor edges, e.g. a marked rule) may stand beside a rule in its paragraph.
  if (CATEGORIES[l].insertedAlone && r !== "paragraphBreak" && !CATEGORIES[r].zeroWidth) return "C13: a rule has a paragraph of its own (its ¶ follows it)";
  if (CATEGORIES[r].insertedAlone && !terminator(l) && !CATEGORIES[l].zeroWidth) return "C13: a rule has a paragraph of its own (a terminator precedes it)";
  return null;
}

/** One storage unit: a text character or an embedded item map. */
type Unit = string | Y.Map<unknown>;

/** The storage units of category `c`'s representative (L's text `ab`, R's `cd`: each character its own). An anchor is a collapsed marker pair (insertMarker's caret shape); a table is a one-cell bracket at `depth`. */
function units(c: Category, salt: "L" | "R", depth: number): Unit[] {
  const k = REPRESENTATIVE[c];
  switch (k) {
    case "text":
      return salt === "L" ? ["a", "b"] : ["c", "d"];
    case "para":
      return [newParagraphMark()];
    case "object":
      return [newObject("image", { props: { src: "a.png" } })];
    case "hr":
      return [newHorizontalRule()];
    case "marker":
      return [newMarker("m", salt, "start"), newMarker("m", salt, "end")];
    case "toc":
      return [newTableOfContents()];
    case "table":
      return tableUnits(`⟦@${depth} ⟨r⟩@${depth} ⟨c⟩@${depth} c¶ ⟧@${depth}`);
    case "S":
      return [newSectionBreak()];
    default:
      throw new Error(`permutations: no representative builder for ${k}`);
  }
}

/** `x¶ L R y` (the container's own final ¶ follows): a rule's paragraph (R a rule, or L a rule and R zero-width) gets its ¶ before `y`. `depth`: a table's nesting depth there. */
export function sequence(l: Category, r: Category, depth = 0): Unit[] {
  const ruleOpen = CATEGORIES[r].insertedAlone || (CATEGORIES[l].insertedAlone && CATEGORIES[r].zeroWidth);
  return [...["x", newParagraphMark()], ...units(l, "L", depth), ...units(r, "R", depth), ...(ruleOpen ? [newParagraphMark()] : []), "y"];
}

/** Storage units of category `c`'s representative (a table: its whole bracket). */
export const storageLength = (c: Category): number => units(c, "L", 0).length;

function fill(piece: Y.Text, seq: readonly Unit[], at = 0): void {
  seq.forEach((u, i) => (typeof u === "string" ? piece.insert(at + i, u) : piece.insertEmbed(at + i, u)));
}

/** A container in a version: its record (the flow's holder, or a table cell), the flow holding it and its read tree. */
export interface Where {
  readonly container: Container;
  readonly holder: string;
  readonly flow: string;
  readonly tree: TreeKind;
}

export interface Case {
  readonly h: Harness;
  readonly where: Where;
  /** The piece holding the sequence, from storage index `offset` (no inert storage). */
  readonly piece: Y.Text;
  readonly offset: number;
}

/** A fresh harness holding `seq` in `container`; the history is cleared after setup. */
export function build(container: Container, seq: readonly Unit[]): Case {
  const h = new Harness(1, OPTIONS);
  const f = h.f;
  let where: Where;
  let piece: Y.Text;
  let offset = 0;
  if (container === "body" || container === "cell") {
    piece = f.piece;
    const rootId = h.version.rootId;
    if (container === "body") {
      f.doc.transact(() => fill(f.piece, seq));
      where = { container, holder: rootId, flow: rootId, tree: "block" };
    } else {
      // `⟦ ⟨r⟩ ⟨c⟩ seq ¶ ⟧`: the cell's own final ¶, then the body's.
      const open = tableUnits("⟦ ⟨r⟩ ⟨c⟩");
      offset = open.length;
      f.doc.transact(() => fill(f.piece, [...open, ...seq, ...tableUnits("¶ ⟧")]));
      const cell = open[2];
      where = { container, holder: cell instanceof Y.Map ? idOf(cell) : "", flow: rootId, tree: "block" };
    }
  } else {
    const made = container === "footnote" ? h.run(insertFootnote) : h.run(insertHeaderFooter, "header");
    const L = made && isTextSelection(h.selection) ? paragraphLayout(h.version, h.selection.focus.blockId) : null;
    const p = L?.fs.segments[0]?.piece;
    if (L === null || p === undefined) throw new Error(`permutations: could not make a ${container}`);
    f.doc.transact(() => fill(p, seq));
    where = { container, holder: L.fs.holderId, flow: L.fs.holderId, tree: L.tree };
    piece = p;
  }
  h.history.clear();
  return { h, where, piece, offset };
}

export const flowOf = (d: Document, w: Where): FlowState | undefined => d.flows.get(w.flow);

/** A container's read as units (a text unit labelled by its character; each with its attrs: an item's; a ¶'s, its paragraph's, with `type`), with where each paragraph starts and where each block object is (a table: its `⟦`). */
export interface Linear {
  readonly units: readonly LinearUnit[];
  readonly attrs: readonly ReadonlyAttrs[];
  readonly paraStart: ReadonlyMap<string, number>;
  readonly blockAt: ReadonlyMap<string, number>;
}

/** The read blocks of a container in flow order, `[S]` (section boundaries of the body) as null. */
function flowBlocks(d: Document, w: Where): (Block | null)[] {
  if (w.container !== "body") return childrenOf(d, w.tree, w.holder);
  return childrenOf(d, "block", d.rootId).flatMap((s, i) => [...(i > 0 ? [null] : []), ...childrenOf(d, "block", s.id)]);
}

export function linear(d: Document, w: Where): Linear {
  const out: LinearUnit[] = [];
  const attrs: ReadonlyAttrs[] = [];
  const paraStart = new Map<string, number>();
  const blockAt = new Map<string, number>();
  const push = (u: LinearUnit, a: ReadonlyAttrs): void => {
    out.push(u);
    attrs.push(a);
  };
  /** A container's blocks; a table expands to `⟦`, its cells' content in order, `⟧` (its faces, design §1). */
  const visit = (blocks: readonly (Block | null)[]): void => {
    let prev: Block | null = null;
    for (const b of blocks) {
      // A block object's implicit paragraph (a table's is anchored at its `⟧`: `${⟧}/after`).
      const implicit = prev !== null && b !== null && prev.inlineContent === null && b.inlineContent !== null && b.id.endsWith(afterObjectId(""));
      prev = b;
      if (b === null) push({ c: "sectionBreak", label: "sectionBreak" }, {});
      else if (implicit) {
        paraStart.set(b.id, out.length);
        push({ c: "paragraphBreak", label: "paragraphBreak", implicit: true }, { ...b.attrs, type: b.type });
      } else if (b.inlineContent === null && b.firstChildId !== null) {
        // A block object read with records of its own holds flows (its category's trait): a table.
        blockAt.set(b.id, out.length);
        push({ c: "containerBlock", label: "⟦", face: "open" }, b.attrs);
        for (const row of childrenOf(d, w.tree, b.id)) for (const cell of childrenOf(d, w.tree, row.id)) visit(childrenOf(d, w.tree, cell.id));
        push({ c: "containerBlock", label: "⟧", face: "close" }, b.attrs);
      } else if (b.inlineContent === null) {
        blockAt.set(b.id, out.length);
        push({ c: "atomicBlock", label: "atomicBlock" }, b.attrs);
      } else {
        paraStart.set(b.id, out.length);
        for (const i of b.inlineContent.items) for (let n = 0; n < unitsOf(i); n++) push({ c: categoryOfKind(kindOfItem(i)), label: isText(i) ? (i.text[n] ?? "") : categoryOfKind(kindOfItem(i)) }, i.attrs);
        push({ c: "paragraphBreak", label: "paragraphBreak" }, { ...b.attrs, type: b.type });
      }
    }
  };
  visit(flowBlocks(d, w));
  return { units: out, attrs, paraStart, blockAt };
}
