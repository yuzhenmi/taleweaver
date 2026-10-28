/**
 * `BlockText` — a block's inline content as a `Y.Text`-like surface over its region
 * of the flow (which may span pieces and sub-flows). Offsets are block offsets
 * (UTF-16 + 1 per inline embed; ¶ / object items and sub-flows count 0 — a paragraph
 * is the content BEFORE its ¶, (P, len) is the gap just before ¶P); every write resolves
 * LIVE against the current region, so composed in-transaction steps see their own
 * earlier writes.
 *
 * Writes go to the pieces through the public `Y.Text` index API (index from a
 * bounded walk). The piece-size rule applies: no write enters a piece holding
 * `PIECE_SOFT_MAX` structs — it goes to a fresh piece after / before it, or (mid
 * piece) to a fresh piece in a sub-flow, up to the depth cap.
 */
import * as Y from "yjs";
import type { BlockId } from "./block-id";
import {
  PIECE_SOFT_MAX,
  invalidatePiece,
  SUBFLOW_DEPTH_CAP,
  pieceIndexOf,
  pieceOf,
  pieceStructCount,
  pieceDepth,
  insertPieceAfter,
  insertPieceBefore,
  newSubflow,
} from "./y-flow";
import { readCtx, regionOf, walkContent, type ReadCtx } from "./flow-read";
import {
  extentAt,
  runStart,
  forEachUnit,
  noteInserted,
  noteDeleted,
  notePieceWrite,
  type Extent,
  type Locator,
} from "./locator";
import { realIdForWrite } from "./flow-ops";
import { isLegacyBreakEmbedType } from "./legacy-break-embeds";

/** The `Y.Text` surface the inline primitives (`y-inline.ts`) write through. */
export interface InlineText {
  readonly length: number;
  insert(index: number, text: string, attributes?: Record<string, unknown>): void;
  insertEmbed(index: number, embed: object, attributes?: Record<string, unknown>): void;
  delete(index: number, length: number): void;
  format(index: number, length: number, attributes: Record<string, unknown>): void;
  toDelta(): unknown[];
}

/** A point in a piece: `Y.Text` index `index` of `piece`. */
export interface FlowPoint {
  readonly piece: Y.Text;
  readonly index: number;
}

/** A resolved point + the run boundary it is in (for the locator's incremental update). */
interface RunPoint extends FlowPoint {
  readonly after: Y.Item | null;
}

/**
 * Resolve block offset `offset` of `region` to a piece point (seams attach to the
 * earlier part): a scan of the cached extents + one in-piece walk, O(extents + piece).
 */
export function pointInRegion(_ctx: ReadCtx, region: Locator, offset: number): FlowPoint {
  return runPoint(region, offset);
}

function runPoint(loc: Locator, offset: number): RunPoint {
  if (offset > 0) {
    const at = extentAt(loc, offset);
    if (at === null) throw new Error(`block text: offset ${offset} out of range (length ${loc.length})`);
    return { piece: at.ext.piece, index: runStart(at.ext) + at.inner, after: at.ext.after };
  }
  const anchor = loc.anchorItem;
  if (anchor !== null) return { piece: pieceOf(anchor), index: pieceIndexOf(anchor) + 1, after: anchor };
  const sp = loc.startPiece;
  if (sp !== null) return { piece: sp, index: 0, after: null };
  throw new Error("block text: region has no anchor");
}

/**
 * Apply the piece-size rule at `p`: the point to actually write at (possibly in a
 * fresh piece / sub-flow created here — the runs there changed, so the locators
 * touching `p.piece` are dropped). Returns `p` itself when the write fits.
 */
export function sizedPoint(p: FlowPoint, budget = 1): FlowPoint {
  if (pieceStructCount(p.piece) + budget <= PIECE_SOFT_MAX) return p;
  const doc = p.piece.doc;
  if (doc !== null) notePieceWrite(doc, p.piece);
  if (p.index >= p.piece.length) {
    const fresh = new Y.Text();
    insertPieceAfter(p.piece, fresh);
    return { piece: fresh, index: 0 };
  }
  if (p.index === 0) {
    const fresh = new Y.Text();
    insertPieceBefore(p.piece, fresh);
    return { piece: fresh, index: 0 };
  }
  if (pieceDepth(p.piece) >= SUBFLOW_DEPTH_CAP) return p;
  const fresh = new Y.Text();
  p.piece.insertEmbed(p.index, newSubflow(fresh), {});
  invalidatePiece(p.piece);
  return { piece: fresh, index: 0 };
}

interface Run {
  readonly ext: Extent;
  readonly index: number;
  readonly len: number;
}

/** The extent slices covering `[start, end)` of a locator, in order. */
function runsIn(loc: Locator, start: number, end: number): Run[] {
  const runs: Run[] = [];
  let pos = 0;
  for (const ext of loc.extents) {
    if (pos >= end) break;
    const s = Math.max(start, pos);
    const e = Math.min(end, pos + ext.len);
    if (e > s) runs.push({ ext, index: runStart(ext) + (s - pos), len: e - s });
    pos += ext.len;
  }
  return runs;
}

export class BlockText implements InlineText {
  constructor(
    private readonly ctx: ReadCtx,
    public id: string,
  ) {}

  private region(): Locator {
    const r = regionOf(this.ctx, this.id);
    if (r === null) throw new Error(`block "${this.id}" has no inline content`);
    return r;
  }

  /**
   * The region to WRITE into. An implicit run (concurrency only — storage broke
   * invariant I) is materialized first: a ¶ written at its end (an implicit grid cell
   * gets its cell + ¶), so a local write restores the invariant.
   */
  private writableRegion(): Locator {
    if (!this.id.endsWith("#i")) return this.region();
    this.id = realIdForWrite(this.ctx.doc, this.id);
    return this.region();
  }

  get length(): number {
    return this.region().length;
  }

  toDelta(): unknown[] {
    const ops: { insert: unknown; attributes?: Record<string, unknown> }[] = [];
    forEachUnit(this.region(), (u, attrs) => {
      const attributes = attrs.size === 0 ? undefined : Object.fromEntries(attrs);
      const c = u.content;
      if (c instanceof Y.ContentString) ops.push(attributes === undefined ? { insert: c.str } : { insert: c.str, attributes });
      else if (c instanceof Y.ContentEmbed) ops.push(attributes === undefined ? { insert: c.embed } : { insert: c.embed, attributes });
    });
    return ops;
  }

  /** The writable point for `index` (piece-size rule applied). */
  point(index: number, budget = 1): FlowPoint {
    return sizedPoint(runPoint(this.writableRegion(), index), budget);
  }

  /** Write `n` units at `index` through `write`, keeping the locator's extents in step. */
  private write(index: number, n: number, write: (p: FlowPoint) => void): void {
    const loc = this.writableRegion();
    const p = runPoint(loc, index);
    const q = sizedPoint(p);
    write(q);
    invalidatePiece(q.piece);
    if (q === p) noteInserted(loc, index, n, p.piece, p.after);
  }

  insert(index: number, text: string, attributes?: Record<string, unknown>): void {
    if (text.length === 0) return;
    this.write(index, text.length, (p) => p.piece.insert(p.index, text, attributes ?? {}));
  }

  insertEmbed(index: number, embed: object, attributes?: Record<string, unknown>): void {
    this.write(index, 1, (p) => p.piece.insertEmbed(p.index, embed, attributes ?? {}));
  }

  delete(index: number, length: number): void {
    if (length <= 0) return;
    const loc = this.region();
    const runs = runsIn(loc, index, index + length);
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (r === undefined) continue;
      r.ext.piece.delete(r.index, r.len);
      invalidatePiece(r.ext.piece);
      noteDeleted(loc, r.ext, r.len);
    }
  }

  format(index: number, length: number, attributes: Record<string, unknown>): void {
    if (length <= 0) return;
    for (const r of runsIn(this.region(), index, index + length)) r.ext.piece.format(r.index, r.len, attributes);
  }
}

/** The block's `InlineText`, or null when it carries no inline content. */
export function blockText(doc: Y.Doc, id: BlockId | string): BlockText | null {
  const ctx = readCtx(doc);
  return regionOf(ctx, id) === null ? null : new BlockText(ctx, id);
}

/** {@link blockText} for a write path that requires inline content. */
export function requireBlockText(doc: Y.Doc, id: BlockId | string, opName: string): BlockText {
  const t = blockText(doc, id);
  if (t === null) throw new Error(`${opName}: block "${id}" is not a leaf (no inlineContent)`);
  return t;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Dev-mode post-op check over the blocks an op touched: no piece item of their content
 * holds a legacy break-suggestion embed, nor a lone surrogate (no op split a pair — every endpoint is grapheme-snapped).
 * Checked per ITEM, not on the joined text: a pair split across two items (two runs,
 * two same-attr items Yjs keeps apart, or two pieces) reads whole once joined, but each
 * half is a lone surrogate in storage — Yjs splices it to U+FFFD on a later split.
 * O(touched content).
 */
export function assertInlineStorageInvariants(doc: Y.Doc, opName: string, blockIds: Iterable<BlockId | string>): void {
  const ctx = readCtx(doc);
  for (const id of blockIds) {
    const r = regionOf(ctx, id);
    if (r === null) continue;
    walkContent(ctx, r.start, r.boundary, (u) => {
      if (u.content instanceof Y.ContentString && LONE_SURROGATE.test(u.content.str)) {
        throw new Error(`${opName}: block "${id}" holds a lone surrogate (an offset split a pair)`);
      }
      // Schema 3 holds no inline break-suggestion embed (break suggestions are mark tags).
      const embed: unknown = u.content instanceof Y.ContentEmbed ? u.content.embed : null;
      if (embed !== null && typeof embed === "object" && "embedType" in embed && typeof embed.embedType === "string" && isLegacyBreakEmbedType(embed.embedType)) {
        throw new Error(`${opName}: block "${id}" holds a legacy break-suggestion embed`);
      }
    });
  }
}
