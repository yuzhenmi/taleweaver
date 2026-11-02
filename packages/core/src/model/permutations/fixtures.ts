/**
 * Test-only: category permutation fixtures. One representative kind per category; for an
 * ordered pair (L, R) a small valid document `x¶ L R y¶` (padded as the single-user rules
 * need) in a container, built in raw storage; and the container's read as a linear
 * sequence of category units (the units the storage holds, in order, and the ¶ of each
 * block object's implicit paragraph, flagged `implicit`).
 */
import * as Y from "yjs";
import type { Block, ReadonlyAttrs } from "../block";
import { insertFootnote } from "../commands/insert-footnote";
import { insertHeaderFooter } from "../commands/insert-header-footer";
import type { Document, FlowState, TreeKind } from "../document/types";
import { afterObjectId, cellId } from "../ids";
import { OPTIONS } from "../oracle/random-command";
import { isTextSelection } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { CATEGORIES, type Category, type Container, type FlowKind, allowedIn, categoryOfKind, isText, kindOfItem } from "../scan/kinds";
import type { Unit as LinearUnit } from "./expectations";
import { unitsOf } from "../position/items";
import { newHorizontalRule, newMarker, newObject, newParagraphMark, newSectionBreak, newTableOfContents } from "../storage/new-items";
import { newColMap, newTable } from "../storage/new-table";
import { Harness } from "../test-helpers/harness";
import { childrenOf, idOf } from "../test-helpers/fixture";
import { testRow } from "../test-helpers/table";

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

/** The storage units of category `c`'s representative (L's text `ab`, R's `cd`: each character its own). An anchor is a collapsed marker pair (insertMarker's caret shape). */
function units(c: Category, salt: "L" | "R"): Unit[] {
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
      return [newTable([testRow("r0", { a: "c" })], [newColMap("a")])];
    case "S":
      return [newSectionBreak()];
    default:
      throw new Error(`permutations: no representative builder for ${k}`);
  }
}

/** `x¶ L R y` (the container's own final ¶ follows): a rule's paragraph (R a rule, or L a rule and R zero-width) gets its ¶ before `y`. */
export function sequence(l: Category, r: Category): Unit[] {
  const ruleOpen = CATEGORIES[r].insertedAlone || (CATEGORIES[l].insertedAlone && CATEGORIES[r].zeroWidth);
  return [...["x", newParagraphMark()], ...units(l, "L"), ...units(r, "R"), ...(ruleOpen ? [newParagraphMark()] : []), "y"];
}

function fill(piece: Y.Text, seq: readonly Unit[]): void {
  seq.forEach((u, i) => (typeof u === "string" ? piece.insert(i, u) : piece.insertEmbed(i, u)));
}

/** A container's flow in a version: its storage holder and its read tree / root record. */
export interface Where {
  readonly container: Container;
  readonly holder: string;
  readonly tree: TreeKind;
}

export interface Case {
  readonly h: Harness;
  readonly where: Where;
  /** The piece holding the sequence (storage index = linear index, no inert storage). */
  readonly piece: Y.Text;
}

/** A fresh harness holding `seq` in `container`; the history is cleared after setup. */
export function build(container: Container, seq: readonly Unit[]): Case {
  const h = new Harness(1, OPTIONS);
  const f = h.f;
  let where: Where;
  let piece: Y.Text;
  if (container === "body" || container === "cell") {
    if (container === "body") {
      f.doc.transact(() => fill(f.piece, seq));
      where = { container, holder: h.version.rootId, tree: "block" };
      piece = f.piece;
    } else {
      piece = new Y.Text();
      fill(piece, [...seq, newParagraphMark()]);
      const flow = new Y.Array<Y.Text>();
      flow.insert(0, [piece]);
      const table = newTable([testRow("r0", { a: flow })], [newColMap("a")]);
      f.doc.transact(() => f.piece.insertEmbed(0, table));
      where = { container, holder: cellId(idOf(table), "r0", "a"), tree: "block" };
    }
  } else {
    const made = container === "footnote" ? h.run(insertFootnote) : h.run(insertHeaderFooter, "header");
    const L = made && isTextSelection(h.selection) ? paragraphLayout(h.version, h.selection.focus.blockId) : null;
    const p = L?.fs.segments[0]?.piece;
    if (L === null || p === undefined) throw new Error(`permutations: could not make a ${container}`);
    f.doc.transact(() => fill(p, seq));
    where = { container, holder: L.fs.holderId, tree: L.tree };
    piece = p;
  }
  h.history.clear();
  return { h, where, piece };
}

export const flowOf = (d: Document, w: Where): FlowState | undefined => d.flows.get(w.holder);

/** A container's read as units (a text unit labelled by its character; each with its attrs: an item's; a ¶'s, its paragraph's, with `type`), with where each paragraph starts and where each block object is. */
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
  const push = (c: Category, a: ReadonlyAttrs, label: string = c, implicit?: true): void => {
    out.push(implicit === undefined ? { c, label } : { c, label, implicit });
    attrs.push(a);
  };
  let prev: Block | null = null;
  for (const b of flowBlocks(d, w)) {
    const implicit = prev !== null && b !== null && b.id === afterObjectId(prev.id);
    prev = b;
    if (b === null) push("sectionBreak", {});
    else if (implicit) {
      paraStart.set(b.id, out.length);
      push("paragraphBreak", { ...b.attrs, type: b.type }, "paragraphBreak", true);
    }
    else if (b.inlineContent === null) {
      // A block object read with records of its own holds flows (its category's trait).
      blockAt.set(b.id, out.length);
      push(b.firstChildId !== null ? "containerBlock" : "atomicBlock", b.attrs);
    } else {
      paraStart.set(b.id, out.length);
      for (const i of b.inlineContent.items) for (let n = 0; n < unitsOf(i); n++) push(categoryOfKind(kindOfItem(i)), i.attrs, isText(i) ? i.text[n] : undefined);
      push("paragraphBreak", { ...b.attrs, type: b.type });
    }
  }
  return { units: out, attrs, paraStart, blockAt };
}
