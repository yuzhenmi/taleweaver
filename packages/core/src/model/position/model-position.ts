import type { BlockId } from "../block";

export interface ModelPosition {
  readonly blockId: BlockId;
  readonly offset: number;
}

/** A caret or a text range (ProseMirror's TextSelection). */
export interface TextSelection {
  readonly kind?: "text";
  readonly anchor: ModelPosition;
  readonly focus: ModelPosition;
}

/** Exactly one block object (ProseMirror's NodeSelection, Word / GDocs' selected table / TOC). Inline atoms are one-unit text ranges. */
export interface ObjectSelection {
  readonly kind: "object";
  readonly object: BlockId;
}

/** Everything in a container, block objects included (ProseMirror's AllSelection); `container`: a flow's holder id or a table cell's id. */
export interface AllSelection {
  readonly kind: "all";
  readonly container: BlockId;
}

export type ModelSelection = TextSelection | ObjectSelection | AllSelection;

/** (Model selection kinds are compared only here: `text` / `object` / `all` name selection kinds, not flow kinds.) */
export const isTextSelection = (s: ModelSelection): s is TextSelection => s.kind === undefined || s.kind === "text";
export const isObjectSelection = (s: ModelSelection): s is ObjectSelection => s.kind === "object";
export const isAllSelection = (s: ModelSelection): s is AllSelection => s.kind === "all";

export const position = (blockId: BlockId, offset: number): ModelPosition => ({ blockId, offset });

export function caretAt(blockId: BlockId, offset: number): TextSelection {
  const p = position(blockId, offset);
  return { anchor: p, focus: p };
}

/** Which side an ambiguous position sticks to: `-1` stays before an insertion at it, `1` moves after (ProseMirror's convention). */
export type Assoc = -1 | 1;

export const samePosition = (a: ModelPosition, b: ModelPosition): boolean => a.blockId === b.blockId && a.offset === b.offset;
