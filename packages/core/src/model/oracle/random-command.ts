/**
 * Random command generation shared by the property tests (`incremental.test.ts`) and
 * the oracle: a random valid command on a version (the seeded PRNG is in `random.ts`).
 */
import type { CommandContext, CommandOptions } from "../commands/command-context";
import { deleteBackward } from "../commands/delete-backward";
import { deleteBlockObject } from "../commands/delete-block-object";
import { deleteForward } from "../commands/delete-forward";
import { deleteSelection } from "../commands/delete-selection";
import type { FragmentItem } from "../commands/helpers/fragment";
import { objectSelection, selectAll } from "../commands/selections";
import { insertFootnote } from "../commands/insert-footnote";
import { insertHeaderFooter } from "../commands/insert-header-footer";
import { insertHorizontalRule } from "../commands/insert-horizontal-rule";
import { insertMarker } from "../commands/insert-marker";
import { insertObject } from "../commands/insert-object";
import { insertSectionBreak } from "../commands/insert-section-break";
import { insertTableOfContents } from "../commands/insert-table-of-contents";
import { insertText } from "../commands/insert-text";
import { paste } from "../commands/paste";
import { removeHeaderFooter } from "../commands/remove-header-footer";
import { removeMarker } from "../commands/remove-marker";
import { setMarks } from "../commands/set-marks";
import { setObjectProps } from "../commands/set-object-props";
import { setParagraphAttrs } from "../commands/set-paragraph-attrs";
import { splitParagraph } from "../commands/split-paragraph";
import { markerRanges } from "../document/markers";
import type { Document } from "../document/types";
import type { EditKind } from "../history";
import type { Plan } from "../plan";
import { type ModelPosition, type ModelSelection, isTextSelection, samePosition } from "../position/model-position";
import { blockObjectAt } from "../position/block-object";
import { lengthOf, paragraphIds } from "./document-probes";
import { pick } from "./random";

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

/** The object selection of a random block object of `d`, or null when it has none. */
function randomObjectSelection(r: () => number, d: Document): ModelSelection | null {
  const objects = [...d.trees.block.entries()].filter(([id]) => blockObjectAt(d, id) !== null).map(([id]) => id).sort();
  const id = pick(r, objects);
  return id === undefined ? null : objectSelection(d, id);
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
  const text = selection !== undefined && isTextSelection(selection) ? selection : undefined;
  // Backspace / Delete / marker inserts often sit at a paragraph start (markers next to joins).
  const anchor = text?.anchor ?? pos(roll >= 0.37 && roll < 0.55);
  const focus = text?.focus ?? (r() < 0.6 ? anchor : r() < 0.7 ? { blockId: anchor.blockId, offset: Math.floor(r() * (lengthOf(d, anchor.blockId) + 1)) } : pos());
  // Object / all selections: kept when given, else drawn ~5% (a random block object) / ~3% (select-all of the body).
  const sel = selection !== undefined && !isTextSelection(selection) ? selection : r() < 0.05 ? randomObjectSelection(r, d) : r() < 0.03 ? selectAll(d) : null;
  const ctx: CommandContext = { version: d, selection: sel ?? { anchor, focus }, options: OPTIONS };
  /** `cmd`: the command that planned `plan` (its undo grouping). */
  const out = (cmd: unknown, plan: Plan | null, anywhere = false, keepsMarkers = false): RandomCommand => ({ plan, ctx, anywhere, keepsMarkers: keepsMarkers && isTextSelection(ctx.selection) && samePosition(ctx.selection.anchor, ctx.selection.focus), roll, kind: editKindOf(cmd) });
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
    [{ k: "footnote", body: [{ k: "text", text: "n" }, { k: "para" }, { k: "text", text: "m" }, { k: "para" }] }, { k: "object", kind: "image", props: { props: { src: "b.png" }, wrap: "left" } }],
  ];
  return out(paste, paste(ctx, pick(r, frag) ?? []));
}
