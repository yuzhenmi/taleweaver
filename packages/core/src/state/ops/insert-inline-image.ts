import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  INLINE_IMAGE_EMBED_TYPE,
  type EmbedItem,
} from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { insertInlineItems, requireYInline } from "../y-inline";

/** The primitive image data carried inline by an `inline-image` EmbedItem. */
export interface InlineImageProperties {
  /** Image source (data URL / blob URL / remote URL). */
  readonly src: string;
  /** Rendered width in CSS px (the embed's intrinsic atom inline-size). */
  readonly width: number;
  /** Rendered height in CSS px (the embed's intrinsic atom block-size). */
  readonly height: number;
  /** Alternative text for accessibility (`role="img"` aria-label). */
  readonly alt: string;
}

/**
 * Pre-computed plan for `insertInlineImage`: the host leaf's
 * tree provenance, the insertion offset and the embed — one offset
 * `insertEmbed` into the leaf's inline `Y.Text` (no other character moves).
 */
interface InlineImageInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly offset: number;
  readonly embed: EmbedItem;
}

/**
 * Insert an inline image (Google Docs "In line" positioning) at `position`,
 * atomically (ONE `applyOperation` transaction → one undo entry). Splices an
 * `inline-image` `EmbedItem` carrying `properties: { src, width, height, alt }`
 * into the cursor leaf's `inlineContent`.
 *
 * Like a page-field / cross-reference (and unlike a footnote anchor), an inline
 * image OWNS NOTHING — it has NO `contentBlockId`, so the embed-cascade scanners
 * ignore it and no embedContents body is created. Its image data lives inline in
 * `properties`; render (`render-core.ts`) lays it out as a single inline-block
 * replaced atom.
 *
 * Routes the write to the leaf's owning tree (`plan.kind`) via `resolveBlock`, so
 * an inline image inside a header / footer / footnote body mutates the correct
 * Y.Map.
 *
 * Throws if `position.blockId` does not resolve to a block, the host is not a leaf
 * (no `inlineContent`), or `position.offset` is outside `[0, length]`.
 */
export function insertInlineImage(
  state: State,
  position: Position,
  properties: InlineImageProperties,
): OperationResult {
  const plan = planInlineImageInsert(state, position, properties);
  return applyOperation(state, (doc) => {
    insertInlineImageInTx(doc, plan);
  });
}

/**
 * Validate `position` and produce the insertion plan (the embed +
 * offset for
 * an `inline-image` EmbedItem spliced in). All snapshot reads + validation happen
 * here, BEFORE the surrounding `applyOperation` opens.
 */
function planInlineImageInsert(
  state: State,
  position: Position,
  properties: InlineImageProperties,
): InlineImageInsertPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertInlineImage: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(
      `insertInlineImage: block "${position.blockId}" is not a leaf (no inlineContent)`,
    );
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertInlineImage: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const image: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: INLINE_IMAGE_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({
      src: properties.src,
      width: properties.width,
      height: properties.height,
      alt: properties.alt,
    }),
  });

  return { blockId: position.blockId, kind, offset: position.offset, embed: image };
}

/**
 * In-transaction primitive: insert the embed into the host leaf's inline
 * `Y.Text` at `plan.offset` (image spliced in). Caller owns the surrounding
 * transaction.
 */
function insertInlineImageInTx(doc: Y.Doc, plan: InlineImageInsertPlan): void {
  requireInTransaction(doc, "insertInlineImage");
  const yBlock = getYBlock(doc, plan.blockId, "insertInlineImage", plan.kind);
  insertInlineItems(requireYInline(yBlock, plan.blockId, "insertInlineImage"), plan.offset, [plan.embed]);
}
