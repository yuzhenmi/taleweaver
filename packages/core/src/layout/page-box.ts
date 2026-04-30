import type { ComputedStyle, UsedStyle } from "../styles";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { logicalToPhysical } from "../styles/writing-mode";
import type { LayoutBox } from "./layout-box-v2";

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

  /** Direct children that fit on this page (page-relative blockOffsets). */
  readonly children: readonly LayoutBox[];

  /** 0-based index of this page in the document's page sequence. */
  readonly pageIndex: number;
}

/**
 * NOTE: This inlines the base geometry + style-freezing logic that
 * `createBoxBase` provides for the factories in `layout-box-v2.ts`.
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
  });
}
