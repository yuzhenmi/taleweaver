import type { Document } from "./document";
import type { Position } from "./block-position";
import { createPosition } from "./block-position";
import type { InlineContent } from "./inline-content";
import { deepValueEqual } from "./attrs";
import { isStructuralMarkerEmbedType } from "./embed-markers";
import { iterateAllBlocksInDocumentOrder } from "./document-order";
import type { AttrRegistry } from "../cascade/attr-registry";
import { attrRegistryOf } from "./mark-attrs";
import { DOCUMENT_INTERNAL } from "./document-internal";

/** One maximal range of a mark inside a block: offsets `[start, end)`. */
export interface BlockMarkRange {
  /** The attr key the range is stored under (the type, or an instance key). */
  readonly attrKey: string;
  readonly start: number;
  readonly end: number;
  readonly value: unknown;
}

/** One range of a mark in the document, as returned by {@link getMarkRanges}. */
export interface MarkRange {
  readonly from: Position;
  readonly to: Position;
  readonly value: unknown;
}

/** Value equality for one attr key (a registry interpreter's `equals`, else deep equality). */
export type MarkEquality = (attrKey: string) => (a: unknown, b: unknown) => boolean;

const deepEquality: MarkEquality = () => deepValueEqual;

/** The equality run merging uses for `registry`'s keys (custom `equals`, else deep). */
export function markEqualityOf(registry: AttrRegistry | undefined): MarkEquality {
  if (registry === undefined) return deepEquality;
  return (key) => registry.get(key)?.equals ?? deepValueEqual;
}

/**
 * The maximal ranges, within one block's inline content, of every attr key
 * accepted by `match`: adjacent items carrying the key with equal values (per
 * `equality` — the same compare run merging uses; default deep equality)
 * form one range (formatting splits do not split a mark); a different value
 * starts a new range. Zero-width structural markers (comment / suggestion-break
 * embeds) are transparent — they neither carry nor interrupt a mark. Sorted by
 * start offset. O(items).
 */
export function blockMarkRanges(
  content: InlineContent,
  match: (attrKey: string) => boolean,
  equality: MarkEquality = deepEquality,
): BlockMarkRange[] {
  const out: BlockMarkRange[] = [];
  const open = new Map<string, { start: number; end: number; value: unknown }>();
  let offset = 0;
  for (const item of content.items) {
    const len = item.kind === "text" ? item.text.length : 1;
    if (item.kind === "embed" && isStructuralMarkerEmbedType(item.embedType)) {
      offset += len;
      continue;
    }
    for (const [key, r] of open) {
      if (!(key in item.attrs) || !equality(key)(item.attrs[key], r.value)) {
        out.push({ attrKey: key, ...r });
        open.delete(key);
      }
    }
    for (const key of Object.keys(item.attrs)) {
      if (!match(key)) continue;
      const r = open.get(key); // still open ⇒ its value equals this item's (closed above otherwise)
      if (r !== undefined) r.end = offset + len;
      else open.set(key, { start: offset, end: offset + len, value: item.attrs[key] });
    }
    offset += len;
  }
  for (const [key, r] of open) out.push({ attrKey: key, ...r });
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Every range of mark type `type` in the document (main body, then footnote and
 * header/footer bodies), in document order. A non-exclusive type's instances
 * (stored under `type#…` keys) are reported as separate, possibly overlapping,
 * ranges. Ranges never cross blocks: a mark spanning a paragraph break is
 * reported once per block. A mark type with a custom `equals` in the attr registry
 * bound to the doc groups ranges exactly as runs merge.
 */
export function getMarkRanges(document: Document, type: string): MarkRange[] {
  const equality = markEqualityOf(attrRegistryOf(document[DOCUMENT_INTERNAL].doc));
  const prefix = `${type}#`; // `#` = MARK_INSTANCE_SEPARATOR (cascade/attr-registry)
  const match = (key: string): boolean => key === type || key.startsWith(prefix);
  const out: MarkRange[] = [];
  for (const block of iterateAllBlocksInDocumentOrder(document)) {
    if (block.inlineContent === null) continue;
    for (const r of blockMarkRanges(block.inlineContent, match, equality)) {
      out.push({ from: createPosition(block.id, r.start), to: createPosition(block.id, r.end), value: r.value });
    }
  }
  return out;
}
