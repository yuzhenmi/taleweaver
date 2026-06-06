/**
 * P3.5a — vertical-mode caret coordinate (`resolvePixelPosition`).
 *
 * The P3.5 field contract (`docs/superpowers/specs/2026-06-05-p3-vertical-writing-mode-design.md`,
 * "P3.5 RESOLVED") makes `PixelPosition`'s axis fields carry INLINE/BLOCK-axis
 * quantities (physically-valued), NOT physical-X/physical-Y:
 *   - `x`            = caret position along the INLINE axis
 *   - `y`/`lineY`    = line block-start along the BLOCK axis
 *   - `height`/`lineHeight` = line block-size (BLOCK-axis extent)
 *
 * For `horizontal-tb` inline==X, block==Y so every field equals its physical
 * value (locked byte-identical by `cursor-position.test.ts`). For the VERTICAL
 * modes the inline axis runs down the page (physical Y) and the block axis runs
 * across (physical X) — so `x` is a physical-Y value and `y`/`lineY` are
 * physical-X values. These assertions are RED against the old
 * X==inline / Y==block code (which would put `x` near the page block-size and
 * `y` at 0).
 *
 * Geometry mirrors `layout/vertical-geometry.test.ts`: an 8px-char mock shaper,
 * a 20px-inline narrow page so "aa bb cc" wraps into three lines, page
 * block-size 1000 (so the v-rl block-axis mirror puts line 0 at the far/right
 * physical x). Probed concrete coords (see that file's identical setup):
 *   vertical-rl: line0 absX=984, line1 absX=968, line2 absX=952 (absY=0 each).
 *   vertical-lr: line0 absX=0,  line1 absX=16,  line2 absX=32  (absY=0 each).
 *   each line inlineSize=20, blockSize=16; leaves "aa"/"bb"/"cc" w=16 h=16.
 */
import { describe, it, expect } from "vitest";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import { computeUsedStyle } from "../layout/used-style";
import { createBlockBox, createLineBox } from "../layout/layout-box";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { PageConfig } from "../layout/page-config";
import type { WritingMode } from "../styles/writing-mode";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { ComputedStyle } from "../styles";
import { buildState, buildBlock, inlineContent, text } from "../test-utils/state-builders";
import { createPosition } from "../state";
import type { BlockId, State } from "../state";
import { getLineIndex } from "./line-flatten";

const CHAR_W = 8;
const LINE_CROSS = 16;

// Narrow page (20px inline) so the three short words wrap into three lines; large
// block-size so the v-rl mirror lands line 0 at a large physical x.
const pageConfig: PageConfig = {
  pageInlineSize: 20,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function verticalDoc(wm: WritingMode): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        attrs: { writingMode: wm },
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs: { writingMode: wm },
        inlineContent: inlineContent([text("aa bb cc")]),
      }),
    ],
  });
}

function pipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(CHAR_W, LINE_CROSS);
  const layout = resolvePositionedTree(layoutTree(root, pageConfig.pageInlineSize, shaper, pageConfig));
  return { layout, shaper };
}

/** Document-order lines for block "p". */
function pLines(layout: LayoutBox): ReturnType<typeof getLineIndex>["all"] {
  return getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
}

describe("P3.5a vertical caret coordinate — vertical-rl", () => {
  const state0Vrl = verticalDoc("vertical-rl");
  const { layout, shaper } = pipeline(state0Vrl);
  const lines = pLines(layout);

  it("layout sanity: three lines stacking right→left along physical X", () => {
    expect(lines.length).toBe(3);
    // First line at the far/right physical x (the block-axis mirror), each
    // subsequent line at a smaller x.
    expect(lines[0].absoluteX).toBeGreaterThan(lines[1].absoluteX);
    expect(lines[1].absoluteX).toBeGreaterThan(lines[2].absoluteX);
    // Inline axis runs down +Y from 0.
    expect(lines[0].absoluteY).toBe(0);
  });

  it("offset 1 (mid first word): x=inline coord (physical Y), y/lineY=block coord (physical X)", () => {
    const line0X = lines[0].absoluteX; // 984 in the probe
    const pos = createPosition("p" as BlockId, 1); // after "a"
    const r = resolvePixelPosition(state0Vrl, pos, layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    // x = caret INLINE coord = one char (8px) down from the line's inline start
    // (absY 0) — a PHYSICAL-Y value. Old code (x=inline=absoluteX) gave ~line0X+8.
    expect(r.x).toBe(8);
    // y/lineY = BLOCK coord = the line's physical x. Old code gave 0.
    expect(r.y).toBe(line0X);
    expect(r.lineY).toBe(line0X);
    // height/lineHeight = BLOCK-axis extent = line blockSize 16.
    expect(r.height).toBe(16);
    expect(r.lineHeight).toBe(16);
  });

  it("offset 0 (start): x=0 (inline start), y=first line's physical x", () => {
    const pos = createPosition("p" as BlockId, 0);
    const r = resolvePixelPosition(state0Vrl, pos, layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.x).toBe(0);
    expect(r.y).toBe(lines[0].absoluteX);
  });

  it("offset 3 (soft-wrap to line 1): x back to inline start, y=line 1's physical x", () => {
    // Offset 3 is line0's inlineOffsetEnd; soft-wrap prefers line1's start.
    const pos = createPosition("p" as BlockId, 3);
    const r = resolvePixelPosition(state0Vrl, pos, layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.x).toBe(0); // start of line 1's "bb"
    expect(r.y).toBe(lines[1].absoluteX);
  });
});

describe("P3.5a vertical caret coordinate — vertical-lr", () => {
  const state = verticalDoc("vertical-lr");
  const { layout, shaper } = pipeline(state);
  const lines = pLines(layout);

  it("layout sanity: three lines stacking left→right along physical X (no mirror)", () => {
    expect(lines.length).toBe(3);
    expect(lines[0].absoluteX).toBeLessThan(lines[1].absoluteX);
    expect(lines[1].absoluteX).toBeLessThan(lines[2].absoluteX);
  });

  it("offset 1: x=inline coord (physical Y), y/lineY=block coord (physical X), height=blockSize", () => {
    const pos = createPosition("p" as BlockId, 1);
    const r = resolvePixelPosition(state, pos, layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.x).toBe(8); // one char down the inline (physical-Y) axis
    expect(r.y).toBe(lines[0].absoluteX); // = 0
    expect(r.lineY).toBe(lines[0].absoluteX);
    expect(r.height).toBe(16);
    expect(r.lineHeight).toBe(16);
  });

  it("offset 4 (mid second word on line 1): x=8, y=line 1's physical x", () => {
    const pos = createPosition("p" as BlockId, 4); // after "b" of "bb" (line1 inOff 3..6)
    const r = resolvePixelPosition(state, pos, layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.x).toBe(8);
    expect(r.y).toBe(lines[1].absoluteX); // = 16 in the probe
  });
});

describe("P3.5a empty/strut-only vertical line — inline content edge (I1)", () => {
  it("vertical-lr LTR empty paragraph: caret at the line's inline start (x = physical Y), not physical X", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", attrs: { writingMode: "vertical-lr" }, firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { writingMode: "vertical-lr" }, inlineContent: inlineContent([text("")]) }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const lines = pLines(layout);
    expect(lines.length).toBe(1);
    const r = resolvePixelPosition(state, createPosition("p" as BlockId, 0), layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    // Inline start: not reversed (LTR) → x = the line's inline-axis coord = absY.
    expect(r.x).toBe(lines[0].absoluteY);
    // Block coord = physical x.
    expect(r.y).toBe(lines[0].absoluteX);
  });

  it("vertical-rl + RTL empty line: caret hangs at the FAR inline edge (inlineReversed branch)", () => {
    // The `direction` block attr is not wired to the cascade, and an empty line
    // has no characters to derive RTL from, so we build the layout + state
    // directly to exercise the line-level `inlineReversed` empty-edge branch
    // (the ONE place `am.inlineReversed` is consulted). The line carries an RTL
    // computedStyle + vertical-rl writing-mode; the caret must land at
    // inlineStart + inlineSize along the inline (physical-Y) axis.
    const rtlCs: ComputedStyle = { ...INITIAL_COMPUTED_STYLE, direction: "rtl", writingMode: "vertical-rl" };
    const us = computeUsedStyle(rtlCs, 200, "indefinite");
    const INLINE_SIZE = 20;
    const BLOCK_SIZE = 16;
    const LINE_ABS_Y = 5; // arbitrary nonzero inline-start so the +inlineSize is visible
    // Empty line: no children, inlineOffsetStart === inlineOffsetEnd === 0.
    const line = createLineBox(
      "line", 0, LINE_ABS_Y, INLINE_SIZE, BLOCK_SIZE, "vertical-rl", "rtl", rtlCs, us,
      [], BLOCK_SIZE, 200, "p" as BlockId, 0, 0, true,
    );
    const block = createBlockBox(
      "p", 0, 0, INLINE_SIZE, BLOCK_SIZE, "vertical-rl", "rtl", rtlCs, us, [line], 200,
    );
    // The line box's physical y under RTL vertical = CIS − inlineOffset − inlineSize,
    // but we authored blockOffset=LINE_ABS_Y → physical y here is what the factory
    // derived; read it back so the assertion tracks the real coord.
    const al = getLineIndex(block).byBlock.get("p" as BlockId) ?? [];
    expect(al.length).toBe(1);
    const lineAbsY = al[0].absoluteY;

    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("")]) }),
      ],
    });
    const shaper = createMockShaper(CHAR_W, LINE_CROSS);
    const r = resolvePixelPosition(state, createPosition("p" as BlockId, 0), block, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    // inlineReversed → caret at the FAR inline edge = lineAbsY + inlineSize.
    expect(r.x).toBe(lineAbsY + INLINE_SIZE);
  });
});

describe("P3.5a #338 trailing-space clamp — vertical (I2)", () => {
  it("vertical-rl: caret at a trailing space clamps to the leaf's inline-axis edge", () => {
    // "ab   " (two letters + three trailing spaces) under break-spaces: the hung
    // trailing spaces clamp to the content edge. The caret at the line end must
    // pin to the leaf's inline-axis box edge, not run past it (the #338 clamp,
    // mirrored to the inline axis for vertical).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", attrs: { writingMode: "vertical-rl" }, firstChildId: "p", lastChildId: "p" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", attrs: { writingMode: "vertical-rl" }, inlineContent: inlineContent([text("ab   ")]) }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const lines = pLines(layout);
    expect(lines.length).toBe(1);
    const lineEnd = lines[0].line.inlineOffsetEnd; // 5
    const r = resolvePixelPosition(state, createPosition("p" as BlockId, lineEnd), layout, shaper);
    expect(r).not.toBeNull();
    if (r === null) return;
    // The caret's inline coord (x, a physical-Y value) must be within the line's
    // own inline extent [absY, absY + inlineSize] — clamped, never past it.
    expect(r.x).toBeGreaterThanOrEqual(lines[0].absoluteY);
    expect(r.x).toBeLessThanOrEqual(lines[0].absoluteY + lines[0].line.inlineSize);
  });
});
