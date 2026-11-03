/**
 * Category permutations: for every ordered pair of categories (one representative kind
 * each) adjacent in every container that places both, every command at a caret before /
 * between / after the pair, over a range across it, over each block object's object
 * selection and over select-all, then undo and redo. Two adjacent block objects (a
 * concurrent W2 break, unreachable single-user) read the first one's implicit paragraph
 * between them (a caret stop, its first write creating its ¶); the fixture's own W2 break
 * (in storage) is tolerated where a command keeps both objects. Every case
 * checks the generic invariants (plan total, O2 / O4 / O5(a) validity, no A1 / A2 firing,
 * the caret a valid stop, undo / redo exact) and the trait-derived expectation
 * (`expectations.ts`: the whole category sequence after, the caret, the format reached).
 * Failures are collected per (container, pair, command).
 */
import { afterAll, describe, expect, it } from "vitest";
import type { CommandContext } from "../commands/command-context";
import { deleteBackward } from "../commands/delete-backward";
import { deleteForward } from "../commands/delete-forward";
import { deleteSelection } from "../commands/delete-selection";
import { insertHorizontalRule } from "../commands/insert-horizontal-rule";
import { insertLineBreak } from "../commands/insert-line-break";
import { insertMarker } from "../commands/insert-marker";
import { insertObject } from "../commands/insert-object";
import { insertSectionBreak } from "../commands/insert-section-break";
import { insertTableOfContents } from "../commands/insert-table-of-contents";
import { insertText } from "../commands/insert-text";
import { paste } from "../commands/paste";
import { setMarks } from "../commands/set-marks";
import { setParagraphAttrs } from "../commands/set-paragraph-attrs";
import { splitParagraph } from "../commands/split-paragraph";
import { deriveDocument } from "../derive/derive-document";
import type { Document } from "../document/types";
import type { EditKind } from "../history";
import { BUILTIN_OBJECT_KINDS } from "../object-kinds";
import { wellFormed } from "../oracle/document-probes";
import { validityErrors } from "../oracle/expect-valid";
import { A1A2, type Firing, describeFiring, firingsOf, idKey } from "../oracle/firings";
import { OPTIONS } from "../oracle/random-command";
import { sameRead } from "../oracle/storage-snapshot";
import type { Plan } from "../plan";
import { rangeOf } from "../commands/helpers/at";
import { objectSelection, selectAll } from "../commands/selections";
import { type ModelPosition, type ModelSelection, isAllSelection, isObjectSelection, isTextSelection, samePosition } from "../position/model-position";
import { paragraphLayout } from "../position/paragraph-layout";
import { positionAtPoint } from "../position/position-at-point";
import { resolvePosition } from "../position/resolve-position";
import { CATEGORIES, type Category, type Container } from "../scan/kinds";
import { expectSameVersion } from "../test-helpers/expect-same-version";
import { readOf, selectionOf } from "../test-helpers/harness";
import { type Effect, type Expectation, type Unit, caretStop, expectation } from "./expectations";
import { CATEGORY_LIST, CONTAINERS, type Case, type Linear, type Where, build, flowOf, linear, placeable, sequence, unreachable } from "./fixtures";

interface Command {
  readonly name: string;
  readonly run: (ctx: CommandContext) => Plan | null;
  readonly edit: EditKind;
  readonly effect: Effect;
}

/** The commands under test; there is no insertTable command yet (containerBlock is inserted by none). */
const COMMANDS: readonly Command[] = [
  { name: "insertText", run: (c) => insertText(c, "z"), edit: "insert", effect: { t: "insert", kind: "text", n: 1, text: "z" } },
  { name: "splitParagraph", run: splitParagraph, edit: "command", effect: { t: "insert", kind: "para", n: 1 } },
  { name: "insertLineBreak", run: insertLineBreak, edit: "command", effect: { t: "insert", kind: "lineBreak", n: 1 } },
  { name: "deleteBackward", run: deleteBackward, edit: "delete", effect: { t: "delete", dir: -1 } },
  { name: "deleteForward", run: deleteForward, edit: "delete", effect: { t: "delete", dir: 1 } },
  { name: "deleteSelection", run: deleteSelection, edit: "delete", effect: { t: "delete", dir: 0 } },
  { name: "setMarks", run: (c) => setMarks(c, { bold: true }), edit: "command", effect: { t: "format", scope: "run", key: "bold", value: true } },
  { name: "setParagraphAttrs", run: (c) => setParagraphAttrs(c, { type: "heading" }), edit: "command", effect: { t: "format", scope: "paragraph", key: "type", value: "heading" } },
  { name: "paste", run: (c) => paste(c, [{ k: "text", text: "pp" }]), edit: "command", effect: { t: "insert", kind: "text", n: 2, text: "pp" } },
  { name: "insertObject", run: (c) => insertObject(c, "image", { props: { src: "b.png" } }), edit: "command", effect: { t: "insert", kind: "object", n: 1 } },
  { name: "insertHorizontalRule", run: insertHorizontalRule, edit: "command", effect: { t: "insert", kind: "hr", n: 1 } },
  { name: "insertTableOfContents", run: insertTableOfContents, edit: "command", effect: { t: "insert", kind: "toc", n: 1 } },
  { name: "insertSectionBreak", run: insertSectionBreak, edit: "command", effect: { t: "insert", kind: "S", n: 1 } },
  { name: "insertMarker", run: (c) => insertMarker(c, "m", "new"), edit: "command", effect: { t: "insert", kind: "marker", n: 2 } },
];

const derive = (c: Case): Document => deriveDocument(c.h.f.doc, BUILTIN_OBJECT_KINDS);
const snapped = (d: Document, sel: ModelSelection): ModelSelection =>
  isTextSelection(sel) ? { anchor: resolvePosition(d, sel.anchor, OPTIONS) ?? sel.anchor, focus: resolvePosition(d, sel.focus, OPTIONS) ?? sel.focus } : sel;
const message = (e: unknown): string => (e instanceof Error ? e.message.split("\n")[0] ?? "" : String(e));

/** The selections of a case: carets at the three points (both assocs, deduplicated), the range across the pair, each block object's object selection and select-all; `dropped`: those that did not resolve. */
function selections(c: Case, points: readonly [number, number, number]): { sels: { label: string; sel: ModelSelection }[]; dropped: string[] } {
  const d = c.h.version;
  const fs = flowOf(d, c.where);
  const dropped: string[] = [];
  if (fs === undefined) return { sels: [], dropped: ["the container's flow"] };
  const at = (i: number, assoc: -1 | 1): ModelPosition | null => positionAtPoint(d, fs, c.piece, i, assoc);
  const out: { label: string; sel: ModelSelection }[] = [];
  const seen = new Set<string>();
  const assocs: readonly (-1 | 1)[] = [-1, 1];
  const named: readonly [string, number][] = [["before", points[0]], ["between", points[1]], ["after", points[2]]];
  for (const [name, i] of named) {
    for (const assoc of assocs) {
      const p = at(i, assoc);
      if (p === null) dropped.push(`caret ${name}${assoc < 0 ? "-" : "+"}`);
      if (p === null || seen.has(`${p.blockId}:${p.offset}`)) continue;
      seen.add(`${p.blockId}:${p.offset}`);
      out.push({ label: `caret ${name}${assoc < 0 ? "-" : "+"}`, sel: { anchor: p, focus: p } });
    }
  }
  const start = at(points[0], -1);
  const end = at(points[2], -1);
  if (start !== null && end !== null) out.push({ label: "range across", sel: { anchor: start, focus: end } });
  else dropped.push("range across");
  const blockObjects = [...linear(d, c.where).blockAt.keys()];
  blockObjects.forEach((id, k) => {
    const sel = objectSelection(d, id);
    if (sel === null) dropped.push(`object ${k}`);
    else out.push({ label: `object ${k}`, sel });
  });
  const all = c.where.container === "cell" ? selectAll(d) : selectAll(d, c.where.holder); // a cell's story is the body
  if (all === null || rangeOf({ version: d, selection: all }) === null) dropped.push("all");
  else out.push({ label: "all", sel: all });
  return { sels: out, dropped };
}

/** The linear index of a position. */
function indexOf(L: Linear, p: ModelPosition): number | null {
  const s = L.paraStart.get(p.blockId);
  return s === undefined ? null : s + p.offset;
}

/** A selection's ordered linear ends: an object selection's object unit, a select-all's flow start to its last ¶. */
function spanOf(L: Linear, sel: ModelSelection): { s: number; e: number; object?: boolean } | null {
  if (isObjectSelection(sel)) {
    const i = L.blockAt.get(sel.object);
    return i === undefined ? null : { s: i, e: i + 1, object: true };
  }
  if (isAllSelection(sel)) return { s: 0, e: L.units.length - 1 };
  const a = indexOf(L, sel.anchor);
  const f = indexOf(L, sel.focus);
  return a === null || f === null ? null : { s: Math.min(a, f), e: Math.max(a, f) };
}

const line = (u: readonly Unit[]): string => u.map((x) => x.label).join(" ");

/** The expectation's failures on the read `after` (`caret`: the selection's linear index when collapsed). */
function judge(x: Expectation, after: Linear, readSame: boolean, caret: number | null): string[] {
  if (x.t === "noop") return readSame ? [] : ["expected a no-op, the read changed"];
  const out: string[] = [];
  if (line(after.units) !== line(x.units)) out.push(`read ${line(after.units)}, expected ${line(x.units)}`);
  else if (x.caret !== null && (caret === null || caretStop(after.units, caret) !== caretStop(x.units, x.caret))) out.push(`caret at ${caret ?? "a range"}, expected ${x.caret}`);
  const a = x.applied;
  if (a !== undefined) for (const i of a.at) if (after.attrs[i]?.[a.key] !== a.value) out.push(`unit ${i} (${after.units[i]?.label ?? "?"}) lacks ${a.key}=${String(a.value)}`);
  return out;
}

const isW2 = (f: Firing): boolean => f.type === "abut" && f.end === "blockObject";
const w2Id = (f: Firing): string => `${f.key}|${f.left.map(idKey).join(",")}`;

/** The identities of every W2 break (adjacent block objects) in `d`. */
function w2Breaks(d: Document): Set<string> {
  const out = new Set<string>();
  for (const [, fs] of d.flows.entries()) for (const f of firingsOf(fs).filter(isW2)) out.add(w2Id(f));
  return out;
}

/** `d`'s violations; a W2 break in `allowed` (the fixture's own) is tolerated, any other is a failure. */
function validity(d: Document, allowed: ReadonlySet<string> = new Set()): string[] {
  const out: string[] = [];
  out.push(...validityErrors(d));
  for (const [, fs] of d.flows.entries()) {
    const firings = firingsOf(fs);
    // A flow is "not well formed" for its W2 breaks too; those are judged by identity below, and any other firing
    // there (debris; the A1 / A2 ones below) still fails.
    if (!wellFormed(fs)) {
      if (fs.synthetic || !firings.some(isW2)) out.push(`O5(a): ${fs.holderId} not well formed`);
      else for (const f of firings.filter((x) => !isW2(x) && !A1A2(x))) out.push(`O5(a): ${describeFiring(f)}`);
    }
    for (const f of firings.filter((x) => isW2(x) && !allowed.has(w2Id(x)))) out.push(`W2: new break ${describeFiring(f)}`);
    for (const f of firings.filter(A1A2)) out.push(`A1/A2: ${describeFiring(f)}`);
  }
  return out;
}

function caretOk(d: Document, sel: ModelSelection): string[] {
  if (!isTextSelection(sel)) return [];
  return [sel.anchor, sel.focus].flatMap((p) => {
    const r = resolvePosition(d, p, OPTIONS);
    return r === null ? [`caret ${p.blockId}:${p.offset} does not resolve`] : r.offset !== p.offset ? [`caret ${p.blockId}:${p.offset} is no stop (→ ${r.offset})`] : [];
  });
}

interface Stats {
  cases: number;
  failures: Map<string, string[]>;
}
const stats: Stats = { cases: 0, failures: new Map() };
const t0 = Date.now();

/** Run `cmd` on the pair in `container` at every selection; the failures (each with a repro line). */
function runCase(container: Container, l: Category, r: Category, cmd: Command): string[] {
  const seq = sequence(l, r);
  const lenOf = (c: Category): number => (c === "text" || c === "anchor" ? 2 : 1);
  const points: [number, number, number] = [2, 2 + lenOf(l), 2 + lenOf(l) + lenOf(r)];
  const probe = build(container, seq);
  const { sels, dropped } = selections(probe, points);
  const unresolved = sels.length === 0 || sels.some((s) => isTextSelection(s.sel) && paragraphLayout(probe.h.version, s.sel.focus.blockId) === null);
  const fails: string[] = [];
  if (unresolved) return [`x¶ ${l} ${r} y¶: positions do not resolve`];
  if (dropped.length > 0) fails.push(`x¶ ${l} ${r} y¶: dropped ${dropped.join(", ")}`);
  for (const { label, sel } of sels) {
    stats.cases++;
    const c = build(container, sequence(l, r));
    const h = c.h;
    const repro = `${label} in x¶ ${l} ${r} y¶`;
    const fail = (m: string): void => void fails.push(`${repro}: ${m}`);
    // The adjacent-objects fixture's own W2 break is tolerated; anything else invalid in a fixture fails the case.
    const fixtureW2 = w2Breaks(h.version);
    const fixtureBad = validity(h.version, fixtureW2);
    if (fixtureBad.length > 0) {
      fail(`FIXTURE invalid: ${fixtureBad.join("; ")}`);
      continue;
    }
    h.selection = sel;
    h.history.breakCoalescing();
    const d0 = h.version;
    // A select-all from a cell selects the body (a cell's story is the body): judged on the body's read.
    const where: Where = container === "cell" && isAllSelection(sel) ? { container: "body", holder: d0.rootId, tree: "block" } : c.where;
    const L0 = linear(d0, where);
    const read0 = readOf(d0);
    const sel0 = selectionOf(d0, snapped(d0, sel));
    const span = spanOf(L0, sel);
    if (span === null) {
      fail("selection not in the container's read");
      continue;
    }
    const { s, e } = span;
    const x = expectation(cmd.effect, { container: where.container, units: L0.units, ...span });
    let plan: Plan | null;
    try {
      plan = cmd.run(h.ctx());
    } catch (err) {
      fail(`plan threw: ${message(err)}`);
      continue;
    }
    if (plan === null) {
      fails.push(...judge(x, L0, true, s === e && span.object !== true ? s : null).map((m) => `${repro}: (no plan) ${m}`));
      continue;
    }
    try {
      h.clock += 1000;
      const after = h.history.apply(plan, cmd.edit, h.selection);
      if (after === null) throw new Error("stale plan");
      h.selection = after;
      expectSameVersion(h.version, derive(c));
    } catch (err) {
      fail(`apply / O4: ${message(err)}`);
      continue;
    }
    const d1 = h.version;
    const read1 = readOf(d1);
    const sel1 = selectionOf(d1, snapped(d1, h.selection));
    const L1 = linear(d1, where);
    const hs = h.selection;
    const caret = isTextSelection(hs) && samePosition(hs.anchor, hs.focus) ? indexOf(L1, hs.focus) : null;
    const same = sameRead(read1, read0);
    // The adjacent-objects fixture's own W2 break may stand (by identity); any other W2 break fails.
    for (const m of [...validity(d1, fixtureW2), ...caretOk(d1, hs), ...judge(x, L1, same, caret)]) fail(m);
    if (h.history.depths().undo === 0) {
      if (!sameRead(read1, read0)) fail("changed the read but recorded no undo entry");
      continue;
    }
    try {
      if (!h.undo()) throw new Error("nothing undone");
      if (!sameRead(readOf(h.version), read0)) fail("undo: read differs from before");
      else if (selectionOf(h.version, snapped(h.version, h.selection)) !== sel0) fail(`undo: selection ${selectionOf(h.version, h.selection)}, expected ${sel0}`);
      if (!h.redo()) throw new Error("nothing redone");
      if (!sameRead(readOf(h.version), read1)) fail("redo: read differs from after");
      else if (selectionOf(h.version, snapped(h.version, h.selection)) !== sel1) fail(`redo: selection ${selectionOf(h.version, h.selection)}, expected ${sel1}`);
    } catch (err) {
      fail(`undo / redo: ${message(err)}`);
    }
  }
  return fails;
}

for (const container of CONTAINERS) {
  describe(container, () => {
    for (const l of CATEGORY_LIST) {
      for (const r of CATEGORY_LIST) {
        if (!placeable(l, container) || !placeable(r, container)) continue;
        const why = unreachable(l, r);
        // Adjacent block objects: unreachable single-user, but a concurrent W2 break reads them (`T ¶implicit T P`).
        const w2 = why !== null && CATEGORIES[l].blockObject && CATEGORIES[r].blockObject;
        if (why !== null && !w2) {
          it.skip(`${l} → ${r}: unreachable (${why})`, () => {});
          continue;
        }
        for (const cmd of COMMANDS) {
          it(`${l} → ${r} ${cmd.name}${w2 ? " (concurrent W2 break)" : ""}`, () => {
            const out = runCase(container, l, r, cmd);
            if (out.length > 0) stats.failures.set(`${cmd.name} | ${l} → ${r} | ${container}`, out);
            expect(out).toEqual([]);
          });
        }
      }
    }
  });
}

afterAll(() => {
  const lines = [
    `category permutations: ${stats.cases} cases in ${Date.now() - t0} ms; ${stats.failures.size} failing groups`,
    ...[...stats.failures].flatMap(([k, v]) => [`FAIL ${k}`, ...v.map((m) => `    ${m}`)]),
  ];
  console.log(lines.join("\n"));
});
