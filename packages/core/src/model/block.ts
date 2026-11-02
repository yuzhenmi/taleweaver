/**
 * The schema-4 read model's record vocabulary. It restates the `state/` Block shape
 * (field for field) so `model/` depends on nothing in `state/` (dependency-cruiser
 * rule `core-model-independent-of-state`); at the cut-over (P8) `state/` re-exports
 * these.
 */
export type BlockId = string;

export type ReadonlyAttrs = Readonly<Record<string, unknown>>;

export interface TextItem {
  readonly kind: "text";
  readonly text: string;
  readonly attrs: ReadonlyAttrs;
}

/** An inline embed: one offset unit. `embedType` is one of {@link EMBED_TYPES}. */
export interface EmbedItem {
  readonly kind: "embed";
  readonly embedType: string;
  readonly attrs: ReadonlyAttrs;
  readonly properties: Readonly<Record<string, unknown>>;
}

export type InlineItem = TextItem | EmbedItem;

export interface InlineContent {
  readonly items: readonly InlineItem[];
}

/** Paragraph-break suggestion tags read from a ¶'s `t:ins` / `t:del` keys. */
export interface BreakSuggestion {
  readonly insertionId?: string;
  readonly deletionId?: string;
}

export interface Block {
  readonly id: BlockId;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly parentId: BlockId | null;
  readonly prevSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
  readonly firstChildId: BlockId | null;
  readonly lastChildId: BlockId | null;
  readonly inlineContent: InlineContent | null;
  readonly breakSuggestion?: BreakSuggestion;
  readonly markAttrs?: ReadonlyAttrs;
}

/** The embed types the read model emits. */
export const EMBED_TYPES = {
  /** A generic object (`{k:"object"}`); images are its built-in kind `"image"`. */
  object: "object",
  horizontalLine: "horizontal-line",
  footnoteAnchor: "footnote-anchor",
  marker: "marker",
} as const;

/** Block types the read model emits (paragraph types come from `p:type`). */
export const BLOCK_TYPES = {
  document: "document",
  section: "section",
  paragraph: "paragraph",
  tableOfContents: "table-of-contents",
  templateBody: "template-body",
  footnoteBody: "footnote-body",
} as const;

/** Shallow attrs equality (values are Yjs scalars / JSON; objects compare by JSON). */
export function attrsEqual(a: ReadonlyAttrs, b: ReadonlyAttrs): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const x = a[k];
    const y = b[k];
    if (x === y) continue;
    if (typeof x !== "object" || typeof y !== "object" || x === null || y === null) return false;
    if (JSON.stringify(x) !== JSON.stringify(y)) return false;
  }
  return true;
}
