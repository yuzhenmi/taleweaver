import type { ComputedStyle, UsedStyle, StackingContextRole } from "@taleweaver/core";
import type { WritingMode, Direction } from "@taleweaver/core";
import { logicalToPhysical } from "@taleweaver/core";
import type { LayoutBox, BlockBox } from "./layout-box";

/**
 * A page in a paginated layout. Holds the children that fit on one page.
 *
 * Children's `blockOffset` is relative to the page's content origin
 * (i.e., page-relative, not document-relative). The `PageBox` itself
 * has a `blockOffset` relative to the document root, so multiple pages
 * stack vertically with `pageGap` between them.
 */
export interface PageBox {
  readonly type: "page";
  readonly key: string;

  // Logical (parent-relative)
  readonly inlineOffset: number;
  readonly blockOffset:  number;
  readonly inlineSize:   number;
  readonly blockSize:    number;

  // Physical (parent-relative; derived from logical)
  readonly x: number;
  readonly y: number;
  readonly width:  number;
  readonly height: number;

  readonly writingMode: WritingMode;
  readonly direction:   Direction;

  readonly computedStyle: Readonly<ComputedStyle>;
  readonly usedStyle:     Readonly<UsedStyle>;

  /**
   * POSITIONING — `position: relative` paint-time physical offset, mirrored from
   * `LayoutBoxBase` so the union member carries it and the painter can read it
   * uniformly. A page frame is never relatively positioned, so this is always
   * absent on a PageBox; it exists only to keep the `LayoutBox` union coherent.
   */
  readonly relativeOffset?: { readonly dx: number; readonly dy: number };

  /**
   * POSITIONING — `position: absolute` children whose abc is this box, mirrored
   * from `LayoutBoxBase` to keep the `LayoutBox` union coherent (painter /
   * line-flatten read it uniformly). A page FRAME is never an abc-establishing
   * box (positioning establishment happens on the body block boxes inside it), so
   * this is always absent on a PageBox; it exists only for union coherence.
   */
  readonly absoluteChildren?: readonly LayoutBox[];

  /**
   * POSITIONING slice 4 — stacking-context role, mirrored from `LayoutBoxBase`
   * so the `LayoutBox` union carries it and the painter reads it uniformly. A
   * page FRAME is never a stacking context (it is not positioned, opaque, and
   * untransformed — `createPageBox` never sets it), so this is ALWAYS absent on a
   * PageBox; it exists only to keep the union coherent.
   */
  readonly stackingContextRole?: StackingContextRole;

  /** Direct children that fit on this page (page-relative blockOffsets). */
  readonly children: readonly LayoutBox[];

  /** 0-based index of this page in the document's page sequence. */
  readonly pageIndex: number;

  /**
   * The header body laid out into this page's top margin, or null when the
   * active section (or document root) declares no header. Kept OUT of
   * `children` as a distinct named slot so paint, line-collection, and
   * fingerprinting treat it separately from body content.
   */
  readonly headerSlot: BlockBox | null;

  /**
   * The footer body laid out into this page's bottom margin, or null when no
   * footer is declared. Distinct named slot (see `headerSlot`).
   */
  readonly footerSlot: BlockBox | null;

  /**
   * The footnote slot laid out at this page's bottom (FN-4), between the body
   * content area and the footer, or null when this page carries no footnotes.
   * A wrapping `BlockBox` positioned at block-offset `blockSize −
   * effectiveBottomInset − footnoteSlotHeight`, containing a thin separator
   * rule followed by the stacked footnote bodies. Distinct named slot (see
   * `headerSlot`) so paint, line-collection, and fingerprinting treat it
   * separately from body content.
   */
  readonly footnoteSlot: BlockBox | null;

  /**
   * Page-local top of the body content area = `effectiveTopInset`; bottom =
   * `blockSize − effectiveBottomInset`. The full top/bottom margins OUTSIDE
   * this band are the header/footer zones (#332): a click above
   * `effectiveTopInset` belongs to the header, a click at/below
   * `blockSize − effectiveBottomInset` belongs to the footer, anywhere in
   * between is the body (including the body's empty tail below its last line).
   * On a #328 growing slot these exceed the raw page margins; on a plain page
   * they equal the page's content margins.
   */
  readonly effectiveTopInset: number;
  readonly effectiveBottomInset: number;
}

/**
 * NOTE: This inlines the base geometry + style-freezing logic that
 * `createBoxBase` provides for the factories in `layout-box.ts`.
 * Reusing `createBoxBase` would require exporting it from that file,
 * which Task 3 is the right place to handle. When `createBoxBase`
 * becomes shared, refactor this factory to consume it (one-line change).
 */
export function createPageBox(
  key: string,
  inlineOffset: number, blockOffset: number,
  inlineSize: number, blockSize: number,
  writingMode: WritingMode, direction: Direction,
  computedStyle: ComputedStyle, usedStyle: UsedStyle,
  children: readonly LayoutBox[],
  pageIndex: number,
  containingInlineSize: number,
  headerSlot: BlockBox | null,
  footerSlot: BlockBox | null,
  footnoteSlot: BlockBox | null,
  effectiveTopInset: number,
  effectiveBottomInset: number,
): PageBox {
  const phys = logicalToPhysical(
    { inlineOffset, blockOffset, inlineSize, blockSize },
    writingMode, direction, containingInlineSize,
  );
  return Object.freeze({
    type: "page" as const,
    key,
    inlineOffset, blockOffset, inlineSize, blockSize,
    x: phys.x, y: phys.y, width: phys.width, height: phys.height,
    writingMode, direction,
    computedStyle: Object.freeze({ ...computedStyle }),
    usedStyle:     Object.freeze({ ...usedStyle }),
    children: Object.freeze([...children]),
    pageIndex,
    headerSlot,
    footerSlot,
    footnoteSlot,
    effectiveTopInset,
    effectiveBottomInset,
  });
}
