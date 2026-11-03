/**
 * Test-only: what a command should do, derived from category traits alone — one rule per
 * (command effect, neighbour category), never per kind or per case. An expectation is the
 * container's WHOLE unit sequence after the command (each unit's category and label: a
 * text character's own, so a wrong unit removed fails), the caret's linear index, and —
 * for formatting — the units / paragraphs the format must reach.
 */
import type { Scalar } from "../storage/scalar";
import { CATEGORIES, type Category, type Container, type FlowKind, allowedIn, categoryOfKind } from "../scan/kinds";

/** One read unit: its category and a label (a text unit's character; else its category). */
export interface Unit {
  readonly c: Category;
  readonly label: string;
  /** The ¶ of a block object's implicit paragraph: read only while no paragraph follows the object. */
  readonly implicit?: true;
}

/** A command's effect: inserts `n` of `kind` (`text`: the inserted characters; over the range, unless the kind is zero-width: an anchor wraps it), formats (`key` set to `value` on run units / paragraphs), or deletes (`dir` -1 Backspace, 1 Delete, 0 range delete). */
export type Effect =
  | { readonly t: "insert"; readonly kind: FlowKind; readonly n: number; readonly text?: string }
  | { readonly t: "format"; readonly scope: "run" | "paragraph"; readonly key: string; readonly value: Scalar }
  | { readonly t: "delete"; readonly dir: -1 | 0 | 1 };

export interface Situation {
  readonly container: Container;
  /** The container's units before. */
  readonly units: readonly Unit[];
  /** The selection's ordered linear ends (s = e: a caret; an object selection: its object's unit, e = s + 1). */
  readonly s: number;
  readonly e: number;
  /** An object selection (of the block object at `s`). */
  readonly object?: boolean;
}

export type Expectation =
  | { readonly t: "noop" }
  | {
      readonly t: "seq";
      readonly units: readonly Unit[];
      /** The caret's linear index after (null: the selection is not checked — it stays a range). */
      readonly caret: number | null;
      /** Unit indices (of `units`) whose attrs must hold `key` = `value`. */
      readonly applied?: { readonly key: string; readonly value: Scalar; readonly at: readonly number[] };
    };

const traitsOf = (u: Unit | undefined) => (u === undefined ? undefined : CATEGORIES[u.c]);
const zeroWidth = (u: Unit | undefined): boolean => traitsOf(u)?.zeroWidth === true;
const terminator = (u: Unit | undefined): boolean => traitsOf(u)?.terminator === true;
const blockObject = (u: Unit | undefined): boolean => traitsOf(u)?.blockObject === true;
/** Ends a paragraph: the ¶ of one (the only terminator commands put inside a flow's paragraph sequence alongside block objects / [S]). */
const isPara = (u: Unit | undefined): boolean => u?.c === "paragraphBreak";
/** A terminator that is not a ¶: a block object or [S]. */
const isBoundary = (u: Unit | undefined): boolean => terminator(u) && !isPara(u);
/** The nearest index from `i` in direction `dir` past the zero-width units (−1 / `u.length` past the ends). */
const pastZeroWidth = (u: readonly Unit[], i: number, dir: -1 | 1): number => {
  let j = i;
  while (j >= 0 && j < u.length && zeroWidth(u[j])) j += dir;
  return j;
};
/** A paragraph holding only `u[i]` past its zero-width units: after a terminator / the start, before a ¶. */
const aloneAt = (u: readonly Unit[], i: number): boolean => {
  const a = pastZeroWidth(u, i - 1, -1);
  return isPara(u[pastZeroWidth(u, i + 1, 1)]) && (a < 0 || terminator(u[a]));
};
const takesItsParagraphAt = (u: readonly Unit[], i: number): boolean => traitsOf(u[i])?.takesItsParagraph === true && aloneAt(u, i);
const firstParaFrom = (u: readonly Unit[], i: number): number => {
  let j = i;
  while (j < u.length && !isPara(u[j])) j++;
  return j;
};

/** The start of the paragraph at or after `i`, past the block objects there (a C10 caret, when the deleted object's implicit paragraph went with it). */
const pastBlockObjects = (u: readonly Unit[], i: number): number => {
  let j = i;
  while (blockObject(u[j])) j++;
  return j;
};

const unit = (c: Category, label?: string): Unit => ({ c, label: label ?? c });
/** A write into an implicit paragraph creates its ¶ (X5): from then on a real one. */
const real = (u: Unit): Unit => (u.implicit === true ? { c: u.c, label: u.label } : u);
const NOOP: Expectation = { t: "noop" };
/** The read of `units`: an implicit ¶ stays only where the read rule still puts one (right after a block object, a non-¶ terminator or the end next); index `at` moves with the units before it. */
function settle(units: readonly Unit[], at: number): { units: Unit[]; at: number } {
  const read = (u: Unit, i: number): boolean => u.implicit !== true || (blockObject(units[i - 1]) && (units[i + 1] === undefined || isBoundary(units[i + 1])));
  return { units: units.filter(read), at: at - units.filter((u, i) => i < at && !read(u, i)).length };
}
const seq = (units: readonly Unit[], caret: number | null): Expectation => {
  const r = settle(units, caret ?? 0);
  return { t: "seq", units: r.units, caret: caret === null ? null : r.at };
};
/** `u` without the units at `idx` (ascending); the caret at `caret`. */
const removing = (u: readonly Unit[], idx: readonly number[], caret: number): Expectation => seq(u.filter((_, i) => !idx.includes(i)), caret);

/** Backspace (`dir` -1) / Delete (1) from a caret at `i`: the unit across the zero-width ones next to it (C4, C4r, C5, C6, C7, C8). */
function deleteAtCaret(u: readonly Unit[], i: number, dir: -1 | 1): Expectation {
  if (dir < 0) {
    let j = i - 1;
    while (j >= 0 && zeroWidth(u[j])) j--;
    const c = u[j];
    if (c === undefined) return NOOP;
    // C4r: at a paragraph start after a rule paragraph, that whole paragraph goes.
    // Its anchor edges stay (C9).
    const rule = pastZeroWidth(u, j - 1, -1);
    if (isPara(c) && takesItsParagraphAt(u, rule)) return removing(u, [rule, j], rule);
    const t = CATEGORIES[c.c];
    // C5: after a block object holding flows, an empty real paragraph goes when a paragraph (not a boundary, nor the end) follows it.
    if (t.holdsFlows) return j === i - 1 && isPara(u[i]) && u[i]?.implicit !== true && u[i + 1] !== undefined && !isBoundary(u[i + 1]) ? removing(u, [i], j) : NOOP;
    if (t.blockObject) return removing(u, [j], j);
    // C7: the paragraphs around it join (the ¶ before it goes too).
    if (t.removedByJoin && isPara(u[j - 1])) return removing(u, [j - 1, j], j - 1);
    return removing(u, [j], j);
  }
  let j = i;
  while (j < u.length && zeroWidth(u[j])) j++;
  const c = u[j];
  if (c === undefined) return NOOP;
  if (!isPara(c)) return removing(u, [j], i);
  const next = u[j + 1];
  if (next === undefined) return NOOP;
  if (isBoundary(next)) {
    const t = CATEGORIES[next.c];
    // C8's C5 mirror: an empty real paragraph before a block object holding flows goes, unless a block object precedes it (W2's).
    if (t.holdsFlows) return j === i && c.implicit !== true && (i === 0 || (terminator(u[i - 1]) && !blockObject(u[i - 1]))) ? removing(u, [j], i) : NOOP;
    if (t.blockObject) return removing(u, [j + 1], i);
    // C8 and its correction: a join only with a paragraph on the far side.
    const joins = u[j + 2] !== undefined && !isBoundary(u[j + 2]);
    return t.removedByJoin && joins ? removing(u, [j, j + 1], i) : removing(u, [j + 1], i);
  }
  const k = pastZeroWidth(u, j + 1, 1);
  if (takesItsParagraphAt(u, k)) return removing(u, [k, pastZeroWidth(u, k + 1, 1)], i);
  return removing(u, [j], i);
}

/** C9: `[s, e)` removed but its zero-width units (they stay, after the collapse point `s`, where what replaces the range goes). */
const deleteRange = (u: readonly Unit[], s: number, e: number): Unit[] => [...u.slice(0, s), ...u.slice(s, e).filter(zeroWidth), ...u.slice(e)];

function insert(e: Effect & { t: "insert" }, x: Situation): Expectation {
  if (!allowedIn(e.kind, x.container)) return NOOP;
  const cat = categoryOfKind(e.kind);
  const t = CATEGORIES[cat];
  const { units: u, s } = x;
  const fresh = (n: number): Unit[] => Array.from({ length: n }, (_, i) => unit(cat, e.text?.[i]));
  // A zero-width kind wraps the selection: its edges at both ends, in paragraphs (past the block objects / [S] a range starts before).
  // Over an object selection it is refused, as every command that formats or wraps the selection.
  if (t.zeroWidth) {
    if (x.object === true) return NOOP;
    let a = s;
    while (a < x.e && isBoundary(u[a])) a++;
    return seq([...u.slice(0, a), ...fresh(1), ...u.slice(a, x.e), ...fresh(e.n - 1), ...u.slice(x.e)], null);
  }
  // C10 then a caret: an object selection's object goes; what replaces it goes at the start of the paragraph after it.
  const d = x.object === true ? u.filter((_, i) => i !== s) : s === x.e ? [...u] : deleteRange(u, s, x.e);
  // What replaces the selection goes in the paragraph at `s` (after an object selection's object there is always
  // one: W2's, or its implicit one, which then gets its ¶).
  const target = firstParaFrom(d, s);
  const tu = d[target];
  if (tu !== undefined) d[target] = real(tu);
  const put = (at: number, ins: readonly Unit[], caret: number): Expectation => seq([...d.slice(0, at), ...ins, ...d.slice(at)], caret);
  // C13: a paragraph of its own after the collapse point's paragraph, then an empty one with the caret.
  if (t.insertedAlone) {
    const p = target;
    return put(p, [unit("paragraphBreak"), ...fresh(1), unit("paragraphBreak")], p + 3);
  }
  if (t.terminator && cat !== "paragraphBreak") {
    // C15: one removed by a join is inserted by a split (C7's inverse). C14: a block object splits at k > 0; at k = 0
    // it gets a ¶ first only after another block object (W2).
    const before = d[s - 1];
    const lead = t.removedByJoin || (before !== undefined && (!terminator(before) || blockObject(before)));
    const ins: Unit[] = lead ? [unit("paragraphBreak"), ...fresh(1)] : fresh(1);
    return put(s, ins, s + ins.length);
  }
  return put(s, fresh(e.n), s + e.n);
}

function format(e: Effect & { t: "format" }, x: Situation): Expectation {
  // An object selection is not formatted: the commands refuse one today. (Word formats a selected table's cell text;
  // a containerBlock's object selection formatting its cells is tracked for M5. An atomic block has no text to format.)
  if (x.object === true) return NOOP;
  const { units: u, s } = x;
  let at: number[];
  if (e.scope === "run") {
    // Run formatting reaches every unit of the range that takes it: neither a terminator nor zero-width.
    at = [];
    for (let i = s; i < x.e; i++) if (!terminator(u[i]) && !zeroWidth(u[i])) at.push(i);
  } else {
    // Paragraph attrs reach every paragraph holding a unit of the range (a caret's: its own).
    at = [];
    for (let i = firstParaFrom(u, s); i <= firstParaFrom(u, Math.max(s, x.e - 1)) && i < u.length; i = firstParaFrom(u, i + 1)) at.push(i);
  }
  return { t: "seq", units: u, caret: null, applied: { key: e.key, value: e.value, at } };
}

export function expectation(e: Effect, x0: Situation): Expectation {
  // A command at a caret in an implicit paragraph writes as at a real one: it first gets its ¶ (X5).
  const caretPara = x0.object !== true && x0.s === x0.e ? firstParaFrom(x0.units, x0.s) : -1;
  const x: Situation = { ...x0, units: x0.units.map((u, i) => (i === caretPara ? real(u) : u)) };
  if (e.t === "format") return format(e, x);
  if (e.t === "insert") return insert(e, x);
  // C10: an object selection's object goes, whatever its category; the caret where it was (the paragraph after it).
  if (x.object === true) {
    const left = settle(x.units.filter((_, i) => i !== x.s), x.s);
    return seq(left.units, pastBlockObjects(left.units, left.at));
  }
  if (x.s !== x.e) {
    // A range of zero-width units only deletes nothing.
    const d = deleteRange(x.units, x.s, x.e);
    return d.length === x.units.length ? NOOP : seq(d, x.s);
  }
  return e.dir === 0 ? NOOP : deleteAtCaret(x.units, x.s, e.dir);
}

/** Non-zero-width units before linear index `i`: where a caret is, up to the zero-width units it steps over. */
export const caretStop = (u: readonly Unit[], i: number): number => u.slice(0, i).filter((c) => !zeroWidth(c)).length;
