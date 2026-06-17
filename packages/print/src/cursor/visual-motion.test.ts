/**
 * `resolveLineForPosition` / `pickLine` soft-wrap line-pick tests (CUR-1).
 *
 * The line picker that `MOVE_CURSOR` / `EXPAND_SELECTION` use to build the
 * `LineBidiView` they hand to `moveVisually` must pick the SAME line
 * `cursor-position` renders the caret on for a given `caretAffinity`. At a
 * soft-wrap boundary (`offset === line.inlineOffsetEnd`) the default is to prefer
 * the NEXT line's start, but `caretAffinity === "before"` pins the caret to THIS
 * line's end (#474 B2). Before CUR-1, `pickLine` ignored affinity and always
 * jumped to the next line — so the caret the user SEES (line N's end) and the line
 * the next arrow reasons about (line N+1) disagreed, a bidi warp at the line seam
 * (the #502 class at the wrap edge).
 *
 * These assert the picked line MATCHES the rendered caret's line across both
 * affinities, proving `pickLine` now consults `caretAffinity`. The RTL-visual
 * end-to-end correctness (line N's bidi ordering differing from line N+1's) is
 * browser-gated (#474 B2 / task #474 open) — see the comment on the bidi test.
 */
import { describe, it, expect } from "vitest";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import { adaptShaperToMeasurer } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import { resolvePixelPosition } from "./cursor-position";
import { resolveLineForPosition } from "./visual-motion";

function pipeline(state: State): {
  layout: LayoutBox;
  shaper: TextShaper;
  measurer: TextMeasurer;
} {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(8, 16); // 8px/char, 16px line-height
  const layout = positionTreeForTest(layoutTree(root, 800, shaper));
  return { layout, shaper, measurer: adaptShaperToMeasurer(shaper) };
}

/**
 * Single paragraph that soft-wraps at offset 100. 200 chars at 8px/char in an
 * 800px container → ~100 chars/line; spaces every 10 chars give the mock shaper
 * a break opportunity. Line 0 spans [0,100], line 1 spans [100,200]; offset 100
 * is the wrap boundary (line 0's end AND line 1's start).
 */
function wrappingParagraph(): State {
  let s = "";
  for (let i = 0; i < 20; i++) s += "abcdefghi ";
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text(s)]),
      }),
    ],
  });
}

describe("resolveLineForPosition — soft-wrap line-pick honors caretAffinity (CUR-1)", () => {
  it("picks line N's END for 'before' and line N+1's START for 'after'/undefined", () => {
    const state = wrappingParagraph();
    const { layout, measurer } = pipeline(state);
    const pos = createPosition("p" as BlockId, 100); // the wrap boundary

    // "before" → the caret is the END of line 0, so the picker must return line 0
    // (whose `inlineOffsetEnd === 100`). Pre-CUR-1 `pickLine` ignored affinity and
    // returned line 1 here — this is the assertion that would FAIL without the fix.
    const before = resolveLineForPosition(state, pos, layout, measurer, undefined, "before");
    expect(before).not.toBeNull();
    if (before === null) return;
    expect(before.line.inlineOffsetEnd).toBe(100);
    expect(before.line.inlineOffsetStart).toBe(0);

    // "after" (and undefined) → the caret is the START of line 1, so the picker
    // returns line 1 (`inlineOffsetStart === 100`) — the unchanged default.
    const after = resolveLineForPosition(state, pos, layout, measurer, undefined, "after");
    expect(after).not.toBeNull();
    if (after === null) return;
    expect(after.line.inlineOffsetStart).toBe(100);

    const noAffinity = resolveLineForPosition(state, pos, layout, measurer, undefined, undefined);
    expect(noAffinity).not.toBeNull();
    if (noAffinity === null) return;
    expect(noAffinity.line.inlineOffsetStart).toBe(100);

    // The picked line MATCHES the line `cursor-position` renders the caret on for
    // the same affinity (the CUR-1 invariant: the caret the user sees and the line
    // the next motion reasons about agree). `cursor-position` renders "before" at
    // line 0's y (0) and "after" at line 1's y (16).
    const beforePixel = resolvePixelPosition(state, pos, layout, measurer, undefined, "before");
    const afterPixel = resolvePixelPosition(state, pos, layout, measurer, undefined, "after");
    expect(beforePixel?.lineY).toBe(before.absoluteY);
    expect(afterPixel?.lineY).toBe(after.absoluteY);
    // And the two lines are genuinely different (the seam is real).
    expect(before.line).not.toBe(after.line);
  });

  it("the picked line tracks the caret across a wrapped RTL line end (browser-gated visual)", () => {
    // A soft-wrapped RTL paragraph: the wrap boundary sits at the visual end of a
    // line whose bidi ordering differs from the next line's. The line-PICK logic
    // (this fix) is identical to the LTR case — affinity 'before' must keep the
    // picker on line N's end so `moveVisually` builds line N's `LineBidiView`. The
    // RTL VISUAL end-to-end correctness (caret not warping across the seam) is
    // browser-gated: #474 B2's affinity-on-soft-wrap path is still browser-
    // unverified (task #474 open). Here we pin the line-pick invariant only.
    let s = "";
    for (let i = 0; i < 20; i++) s += "אבגדהוזחט "; // 200 RTL chars, breakable every 10
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          attrs: { direction: "rtl" },
          inlineContent: inlineContent([text(s)]),
        }),
      ],
    });
    const { layout, measurer } = pipeline(state);
    const pos = createPosition("p" as BlockId, 100);

    const before = resolveLineForPosition(state, pos, layout, measurer, undefined, "before");
    const after = resolveLineForPosition(state, pos, layout, measurer, undefined, "after");
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (before === null || after === null) return;
    // 'before' stays on the first line (end at 100); 'after' advances to the next.
    expect(before.line.inlineOffsetEnd).toBe(100);
    expect(after.line.inlineOffsetStart).toBe(100);
    expect(before.line).not.toBe(after.line);
  });
});
