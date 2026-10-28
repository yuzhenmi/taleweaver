/**
 * The block REGISTRY (schema 3): the root `doc.getMap("registry")`, BlockId → entry
 * `Y.Map`. An entry carries what a block IS, never where it is:
 *   - `type` (string), `attrs` (`Y.Map`, per-key merge), `tree` (provenance:
 *     `block | embedContent | templateContent`, written at creation), `shape`;
 *   - `markAttrs` (`Y.Map`, text entries): the character props OF the paragraph's ¶
 *     (Word ¶ rPr) — inclusive formatting keys only;
 *   - `finalSection` on the document root: the id of the always-present final section
 *     (Word's body sectPr; a section entry with no item — its region runs to the flow end);
 *   - `flow` (`Y.Array<Y.Text>`, see `y-flow.ts`) for flow holders: the document
 *     root, footnote / template bodies, table cells and host containers;
 *   - table grid fields: table `{ columns, rows, columnWidths }`, row `{ table,
 *     cells }`, cell `{ row, col, colSpanTo?, rowSpanTo?, implicitOf? }`;
 *   - `implicitOf` on a materialized implicit entity.
 * No pointer fields, no inline content and no Yjs item ids: positions live in the
 * flows (end marks), derived state lives in the per-doc `MarkIndex`.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import { newFlow } from "./y-flow";

export const REGISTRY_KEY = "registry";

/** How a block is stored / read. */
export type BlockShape =
  | "text" // content + its ¶ (paragraph, heading, list-item, …)
  | "atomic" // one self-delimiting item, no content (image, horizontal-line, toc, …)
  | "section" // named by a section-end ¶ (`{ end, section }`) or the root's `finalSection`; no item of its own
  | "container" // a flow holder: tree roots (no item) or a host container (item + flow)
  | "table" // an item + grid entry
  | "row" // grid row (no mark)
  | "cell"; // grid cell (no mark; holds a flow)

export type TreeKind = "block" | "embedContent" | "templateContent";

export function getRegistry(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(REGISTRY_KEY) as Y.Map<Y.Map<unknown>>;
}

export function getEntry(doc: Y.Doc, id: BlockId): Y.Map<unknown> | undefined {
  return getRegistry(doc).get(id);
}

/** Reads one key of a registry map (a view may read a past version, see `flow-read.ts` `View`). */
export type MapGet = (map: Y.Map<unknown>, key: string) => unknown;
const plainGet: MapGet = (map, key) => map.get(key);

export function entryShape(entry: Y.Map<unknown>, get: MapGet = plainGet): BlockShape {
  const s = get(entry, "shape");
  switch (s) {
    case "text":
    case "atomic":
    case "section":
    case "container":
    case "table":
    case "row":
    case "cell":
      return s;
    default:
      return "text";
  }
}

export function entryTree(entry: Y.Map<unknown>): TreeKind {
  const t = entry.get("tree");
  return t === "embedContent" || t === "templateContent" ? t : "block";
}

export function entryType(entry: Y.Map<unknown>): string {
  const t = entry.get("type");
  return typeof t === "string" ? t : "paragraph";
}

export function entryAttrsMap(entry: Y.Map<unknown>): Y.Map<unknown> | null {
  const a = entry.get("attrs");
  return a instanceof Y.Map ? (a as Y.Map<unknown>) : null;
}

/** A text entry's ¶ character props map (`markAttrs`), or null. */
export function entryMarkAttrsMap(entry: Y.Map<unknown>): Y.Map<unknown> | null {
  const a = entry.get("markAttrs");
  return a instanceof Y.Map ? (a as Y.Map<unknown>) : null;
}

/** The document root's final section id (`finalSection`), when written. */
export function finalSectionOf(entry: Y.Map<unknown>, get: MapGet = plainGet): string | undefined {
  return entryString(entry, "finalSection", get);
}

export function entryFlow(entry: Y.Map<unknown>, get: MapGet = plainGet): Y.Array<Y.Text> | null {
  const f = get(entry, "flow");
  return f instanceof Y.Array ? (f as Y.Array<Y.Text>) : null;
}

export function entryString(entry: Y.Map<unknown>, key: string, get: MapGet = plainGet): string | undefined {
  const v = get(entry, key);
  return typeof v === "string" ? v : undefined;
}

export function entryIdArray(entry: Y.Map<unknown>, key: string, get: MapGet = plainGet): Y.Array<string> | null {
  const v = get(entry, key);
  return v instanceof Y.Array ? (v as Y.Array<string>) : null;
}

/** True iff the shape lives as its own `{ end }` item in a flow (a section is named by a ¶'s `section`). */
export function isFlowResident(shape: BlockShape, entry: Y.Map<unknown>, get: MapGet = plainGet): boolean {
  if (shape === "row" || shape === "cell" || shape === "section") return false;
  if (shape === "container") return get(entry, "root") !== true;
  return true;
}

export function buildAttrsMap(attrs: ReadonlyAttrs): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) m.set(k, v);
  }
  return m;
}

export interface EntryInit {
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly tree: TreeKind;
  readonly shape: BlockShape;
  readonly implicitOf?: string;
  /** Tree roots (document, footnote/template bodies): live without a mark. */
  readonly root?: boolean;
  /** A text entry's ¶ character props (inclusive formatting keys only). */
  readonly markAttrs?: ReadonlyAttrs;
}

/** A detached registry entry (flow holders get a fresh one-piece flow). */
export function buildEntry(init: EntryInit): Y.Map<unknown> {
  const e = new Y.Map<unknown>();
  e.set("type", init.type);
  e.set("attrs", buildAttrsMap(init.attrs));
  e.set("tree", init.tree);
  e.set("shape", init.shape);
  if (init.implicitOf !== undefined) e.set("implicitOf", init.implicitOf);
  if (init.root === true) e.set("root", true);
  if (init.shape === "text") e.set("markAttrs", buildAttrsMap(init.markAttrs ?? {}));
  if (init.shape === "container" || init.shape === "cell") e.set("flow", newFlow());
  if (init.shape === "table") {
    e.set("columns", new Y.Array<string>());
    e.set("rows", new Y.Array<string>());
    e.set("columnWidths", new Y.Map<unknown>());
  }
  if (init.shape === "row") e.set("cells", new Y.Array<string>());
  return e;
}
