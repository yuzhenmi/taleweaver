import * as Y from "yjs";
import { BODY_KEY, FLOW_KEY, ITEM_KINDS, KIND_KEY, PIECES_KEY } from "./keys";
import type { FlatKeys } from "./scalar";

export function mapOf(entries: Readonly<Record<string, unknown>>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(entries)) m.set(k, v);
  return m;
}

// ---------------------------------------------------------------------------
// Item constructors (detached; nested types are created with their parent, G1)
// ---------------------------------------------------------------------------

/** A ¶ with flat `p:*` / `m:*` / `t:*` keys. */
export function newParagraphMark(keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.para });
}

export interface ObjectProps {
  readonly w?: number;
  readonly h?: number;
  readonly wrap?: "left" | "right" | "break";
  /** Kind-specific scalar props, stored as `a:<name>`. */
  readonly props?: FlatKeys;
}

/** A generic inline object of `kind` (`"image"` or `"<ns>:<name>"`). */
export function newObject(kind: string, o: ObjectProps = {}): Y.Map<unknown> {
  const e: Record<string, unknown> = { [KIND_KEY]: ITEM_KINDS.object, kind };
  if (o.w !== undefined) e["w"] = o.w;
  if (o.h !== undefined) e["h"] = o.h;
  if (o.wrap !== undefined) e["wrap"] = o.wrap;
  for (const [k, v] of Object.entries(o.props ?? {})) e[`a:${k}`] = v;
  return mapOf(e);
}

export function newHorizontalRule(): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.hr });
}

/** A line break (Shift+Enter). */
export function newLineBreak(): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.lineBreak });
}

/** A field (`field`: page-number / page-count) with its number style. */
export function newField(field: string, numberStyle: string): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.field, field, numberStyle });
}

/** `[S]` holding the ended section's `s:*` / `h:*` keys. */
export function newSectionBreak(keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.sectionBreak });
}

/** A TOC block object with `a:*` options. */
export function newTableOfContents(keys: FlatKeys = {}): Y.Map<unknown> {
  return mapOf({ ...keys, [KIND_KEY]: ITEM_KINDS.toc });
}

/** A footnote anchor whose nested body holds a fresh flow (one ¶, `mark` when given). */
export function newFootnote(mark?: Y.Map<unknown>): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.footnote, [BODY_KEY]: newBody(mark) });
}

/** A footnote anchor whose body flow is the detached `pieces` (the last must end in a ¶, G3). */
export function newFootnoteOf(...pieces: Y.Text[]): Y.Map<unknown> {
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, pieces);
  return mapOf({ [KIND_KEY]: ITEM_KINDS.footnote, [BODY_KEY]: mapOf({ [FLOW_KEY]: arr }) });
}

/** A header / footer (or footnote) body: `Y.Map{flow}` with one ¶ (`mark` when given). */
export function newBody(mark?: Y.Map<unknown>): Y.Map<unknown> {
  return mapOf({ [FLOW_KEY]: newFlow(mark) });
}

export function newMarker(ns: string, id: string, edge: "start" | "end"): Y.Map<unknown> {
  return mapOf({ [KIND_KEY]: ITEM_KINDS.marker, ns, id, edge });
}

/** A detached flow: one piece holding one ¶ (default, or `mark`) (G3). */
export function newFlow(mark: Y.Map<unknown> = newParagraphMark()): Y.Array<Y.Text> {
  const piece = new Y.Text();
  piece.insertEmbed(0, mark);
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, [piece]);
  return arr;
}

/** A detached sub-flow holding `pieces` (in order). */
export function newSubflow(...pieces: Y.Text[]): Y.Map<unknown> {
  const arr = new Y.Array<Y.Text>();
  arr.insert(0, pieces);
  return mapOf({ [KIND_KEY]: ITEM_KINDS.sub, [PIECES_KEY]: arr });
}
