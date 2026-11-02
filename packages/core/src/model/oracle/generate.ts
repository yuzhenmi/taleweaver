/**
 * Random command generation shared by the property tests (`incremental.test.ts`) and
 * the oracle: a seeded PRNG and a random valid command on a version.
 */
import type { Document, FlowState, TreeKind } from "../derive";
import type { Plan } from "../plan";
import type { ModelPosition, ModelSelection } from "../position";
import type { EditKind } from "../history";
import { markerRanges } from "../document";
import { type CommandContext, type CommandOptions, deleteBackward, deleteForward, deleteSelection, insertText, setMarks, setParagraphAttrs, splitParagraph } from "../commands";
import {
  type FragmentItem,
  deleteBlockObject,
  insertFootnote,
  insertHeaderFooter,
  insertHorizontalRule,
  insertMarker,
  insertObject,
  insertSectionBreak,
  insertTableOfContents,
  paste,
  removeHeaderFooter,
  removeMarker,
  setObjectProps,
} from "../commands-insert";

/** xorshift32 in [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

export function pick<T>(r: () => number, xs: readonly T[]): T | undefined {
  return xs[Math.floor(r() * xs.length)];
}

/** A numeric env var (Node), or `fallback`. */
export function envNumber(name: string, fallback: number): number {
  const proc: unknown = Reflect.get(globalThis, "process");
  const env: unknown = typeof proc === "object" && proc !== null ? Reflect.get(proc, "env") : undefined;
  const v: unknown = typeof env === "object" && env !== null ? Reflect.get(env, name) : undefined;
  return typeof v === "string" && v !== "" ? Number(v) : fallback;
}

/** [from, to] seed ranges of at most 250 seeds. */
export function seedChunks(seeds: number): [number, number][] {
  const out: [number, number][] = [];
  for (let from = 1; from <= seeds; from += 250) out.push([from, Math.min(seeds, from + 249)]);
  return out;
}

export function paragraphIds(d: Document): string[] {
  const out: string[] = [];
  for (const tree of ["block", "embedContent", "templateContent"] satisfies TreeKind[]) {
    for (const [id, b] of d.trees[tree].entries()) if (b.inlineContent !== null) out.push(id);
  }
  return out.sort();
}

export function lengthOf(d: Document, id: string): number {
  let n = 0;
  for (const i of d.trees.block.get(id)?.inlineContent?.items ?? d.trees.embedContent.get(id)?.inlineContent?.items ?? d.trees.templateContent.get(id)?.inlineContent?.items ?? []) n += i.kind === "text" ? i.text.length : 1;
  return n;
}

/**
 * O5(a) subset / O7 on one flow's tokens, as the model reads them: not synthetic (R17),
 * no debris (R2), a ¶ before every `[S]` (A2), only a paragraph after a TOC (W2), the
 * flow ends in a ¶ (A1).
 */
export function wellFormed(fs: FlowState): boolean {
  const seq: string[] = [];
  for (const seg of fs.segments) for (const t of seg.tokens) if (t.k !== "run" || t.len > t.inert.length) seq.push(t.k);
  if (fs.synthetic || (seq.length > 0 && seq[seq.length - 1] !== "para")) return false;
  return seq.every((k, i) => {
    const prev = seq[i - 1];
    if ((k === "toc" || k === "S") && prev === "run") return false;
    if (k === "S" && prev !== "para") return false;
    return !(prev === "toc" && k !== "para" && k !== "run");
  });
}

let markerSeq = 0;

/** Restart marker ids (per seed, so a seed reproduces alone). */
export function resetMarkerSeq(): void {
  markerSeq = 0;
}

/** Command options the property runs use: atomic `field`, non-inclusive `link`, next styles, one-shot attrs. */
export const OPTIONS: CommandOptions = {
  isAtomicMark: (k) => k === "field",
  isInclusiveMark: (k) => k !== "link",
  nextStyle: (t) => (t === "heading" ? "paragraph" : t === "title" ? "subtitle" : undefined),
  oneShotAttrs: new Set(["listCounterOverride"]),
};

export interface RandomCommand {
  readonly plan: Plan | null;
  readonly ctx: CommandContext;
  /** Writes may land anywhere (not only around the selection). */
  readonly anywhere: boolean;
  /** A collapsed Backspace / Delete: never deletes a marker. */
  readonly keepsMarkers: boolean;
  readonly roll: number;
  /** Its undo grouping. */
  readonly kind: EditKind;
}

/** The undo grouping of a command (C1 types, Backspace / Delete / range delete delete; the rest are commands). */
export function editKindOf(cmd: unknown): EditKind {
  if (cmd === insertText) return "insert";
  return cmd === deleteBackward || cmd === deleteForward || cmd === deleteSelection ? "delete" : "command";
}

const NAMES: readonly [number, string][] = [
  [0.25, "type"], [0.37, "enter"], [0.47, "backspace"], [0.55, "delete"], [0.58, "deleteSelection"], [0.61, "setMarks"], [0.65, "setParagraphAttrs"],
  [0.68, "insertImage"], [0.7, "setObjectProps"], [0.73, "insertRule"], [0.76, "insertTOC"], [0.77, "deleteTOC"], [0.8, "sectionBreak"],
  [0.83, "footnote"], [0.86, "marker"], [0.9, "headerFooter"], [1, "paste"],
];

/** The command a {@link RandomCommand.roll} picked. */
export function commandName(roll: number): string {
  return NAMES.find(([t]) => roll < t)?.[1] ?? "paste";
}

/** A random valid command on `d` (at `selection`, or a random one). Throws only on a bug (O2: Plans are total). */
export function randomCommand(r: () => number, d: Document, selection?: ModelSelection): RandomCommand {
  const ids = paragraphIds(d);
  const pos = (near0 = false): ModelPosition => {
    const id = pick(r, ids) ?? d.rootId;
    const len = lengthOf(d, id);
    return { blockId: id, offset: near0 && r() < 0.5 ? Math.min(len, Math.floor(r() * 3)) : Math.floor(r() * (len + 1)) };
  };
  const roll = r();
  // Backspace / Delete / marker inserts often sit at a paragraph start (markers next to joins).
  const anchor = selection?.anchor ?? pos(roll >= 0.37 && roll < 0.55);
  const focus = selection?.focus ?? (r() < 0.6 ? anchor : r() < 0.7 ? { blockId: anchor.blockId, offset: Math.floor(r() * (lengthOf(d, anchor.blockId) + 1)) } : pos());
  const ctx: CommandContext = { version: d, selection: { anchor, focus }, options: OPTIONS };
  /** `cmd`: the command that planned `plan` (its undo grouping). */
  const out = (cmd: unknown, plan: Plan | null, anywhere = false, keepsMarkers = false): RandomCommand => ({ plan, ctx, anywhere, keepsMarkers: keepsMarkers && (anchor === focus || (anchor.blockId === focus.blockId && anchor.offset === focus.offset)), roll, kind: editKindOf(cmd) });
  if (roll < 0.25) {
    const attrs = r() < 0.75 ? undefined : (pick(r, [{ bold: true }, { link: "u" }, { field: "f" }, { link: "u", bold: true }, {}]) ?? {});
    return out(insertText, insertText(ctx, pick(r, ["a", "bc", "é", "e\u0301", "😀", " "]) ?? "a", attrs));
  }
  if (roll < 0.37) return out(splitParagraph, splitParagraph(ctx));
  if (roll < 0.47) return out(deleteBackward, deleteBackward(ctx), false, true);
  if (roll < 0.55) return out(deleteForward, deleteForward(ctx), false, true);
  if (roll < 0.58) return out(deleteSelection, deleteSelection(ctx));
  if (roll < 0.61) return out(setMarks, setMarks(ctx, { [pick(r, ["bold", "italic", "link"]) ?? "bold"]: r() < 0.6 ? (pick(r, [true, "u"]) ?? true) : null }));
  if (roll < 0.65) return out(setParagraphAttrs, setParagraphAttrs(ctx, { type: pick(r, ["heading", "title", "paragraph", "list-item", null]) ?? null, align: r() < 0.3 ? "center" : undefined, listCounterOverride: r() < 0.2 ? 3 : undefined }));
  if (roll < 0.68) return out(insertObject, insertObject(ctx, "image", { props: { src: "a.png" } }));
  if (roll < 0.7) return out(setObjectProps, setObjectProps(ctx, focus, { wrap: pick(r, ["left", "right", "break", null]) ?? null }));
  if (roll < 0.73) return out(insertHorizontalRule, insertHorizontalRule(ctx));
  if (roll < 0.76) return out(insertTableOfContents, insertTableOfContents(ctx));
  if (roll < 0.77) {
    const toc = [...d.trees.block.entries()].find(([, b]) => b.type === "table-of-contents");
    return out(deleteBlockObject, toc === undefined ? null : deleteBlockObject(ctx, toc[0]), true);
  }
  if (roll < 0.8) return out(insertSectionBreak, insertSectionBreak(ctx));
  if (roll < 0.83) return out(insertFootnote, insertFootnote(ctx));
  if (roll < 0.86) {
    const keys = [...markerRanges(d).values()];
    const k = pick(r, keys);
    return r() < 0.5 || k === undefined ? out(insertMarker, insertMarker(ctx, "m", `${markerSeq++}`)) : out(removeMarker, removeMarker(ctx, k.ns, k.id), true);
  }
  if (roll < 0.9) return r() < 0.7 ? out(insertHeaderFooter, insertHeaderFooter(ctx, pick(r, ["header", "footer"]) ?? "header")) : out(removeHeaderFooter, removeHeaderFooter(ctx, "header"));
  const frag: FragmentItem[][] = [
    [{ k: "text", text: "pp" }],
    [{ k: "text", text: "p1" }, { k: "para", keys: { "p:type": "heading" } }, { k: "text", text: "p2" }],
    [{ k: "toc" }, { k: "para" }, { k: "text", text: "t" }],
    [{ k: "para" }, { k: "S", keys: { "s:columnCount": 2 } }, { k: "text", text: "s" }],
    [{ k: "S" }, { k: "hr" }, { k: "para" }],
    [{ k: "footnote", body: [{ k: "text", text: "n" }, { k: "para" }, { k: "text", text: "m" }] }, { k: "object", kind: "image", props: { props: { src: "b.png" }, wrap: "left" } }],
  ];
  return out(paste, paste(ctx, pick(r, frag) ?? []));
}
