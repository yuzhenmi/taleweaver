import { describe, it, expect } from "vitest";
import { footnoteBodyComponent } from "@taleweaver/core";
import type { ContainerBlockView, RenderContext } from "@taleweaver/core";
import {
  createElementBox,
  createTextBox,
  type ElementBox,
  type RenderNode,
} from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { makeRootContext, makeChildContext } from "../layout/layout-context";
import { createMockShaper } from "@taleweaver/core";
import type { BlockBox, LayoutBox } from "../layout/layout-box";

/**
 * A RenderContext the footnote-body render fn reads ONLY `footnoteNumber` from
 * (plus `view.id` + `childRenderNodes`). `state` throws to make any accidental
 * use loud. `footnoteNumber` returns `numberFor` for the body root id and
 * `undefined` otherwise; pass `undefined` (default) to model a body with no
 * number in the numbering map.
 */
function stubRenderContext(numberFor?: string): RenderContext {
  return {
    get state(): never {
      throw new Error("footnote-body render must not read context.state");
    },
    footnoteNumber(id: BlockId): string | undefined {
      return id === ("fn-body-0" as BlockId) ? numberFor : undefined;
    },
  };
}

/**
 * Narrow a (possibly undefined) LayoutBox to a BlockBox so its `children` array
 * is type-visible. Throws if the box is absent or not a block — avoids `!` /
 * `as any` while keeping the assertion explicit.
 */
function asBlockBox(box: LayoutBox | undefined): BlockBox {
  if (box === undefined || box.type !== "block") {
    throw new Error(`expected a BlockBox, got ${box?.type ?? "undefined"}`);
  }
  return box;
}

/**
 * A minimal `ContainerBlockView` carrying just the fields
 * `footnoteBodyComponent.render` reads (`id`). The other `BlockViewBase`
 * fields are present to satisfy the type but are unused by the render fn.
 */
function bodyView(): ContainerBlockView {
  return {
    id: "fn-body-0" as BlockId,
    type: "footnote-body",
    kind: "container",
    attrs: {},
    computedStyle: INITIAL_COMPUTED_STYLE,
  };
}

/**
 * One paragraph child render node with exactly `numLines` lines, via explicit
 * `\n` hard-breaks under `whiteSpace: "pre"` so the mock shaper emits one
 * LineBox per line regardless of container width.
 */
function paragraphChild(numLines: number): RenderNode {
  const parts: string[] = [];
  for (let i = 0; i < numLines; i++) parts.push("x");
  const text = parts.join("\n");
  const textNode = createTextBox("t", { whiteSpace: "pre" }, text);
  return createElementBox("p", { display: "block", whiteSpace: "pre" } as Style, [
    textNode,
  ]);
}

/**
 * Build the cascaded footnote-body box by running the REAL
 * `footnoteBodyComponent.render` output through `cascadePass`. This is the same
 * path `resolveFootnotes` lays out (`cascadedEmbedContents` is a cascade of the
 * component's render output), so it proves the orphans/widows default cascades
 * from the component definition down to the IFC reader — not merely that the IFC
 * mechanism works.
 */
function cascadedFootnoteBody(numLines: number): ElementBox {
  const rendered = footnoteBodyComponent.render(bodyView(), stubRenderContext(), [
    paragraphChild(numLines),
  ]);
  if (rendered.type !== "element") throw new Error("render returned non-element");
  const cascaded = cascadePass(rendered);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

/** A child layout context (definite inline size) for laying out a footnote body. */
function bodyLayoutContext(inlineSize: number) {
  const root = makeRootContext(INITIAL_COMPUTED_STYLE, inlineSize);
  return makeChildContext(root, INITIAL_COMPUTED_STYLE, inlineSize, "indefinite");
}

describe("footnoteBodyComponent — orphans/widows = 1 (single-line splitting, FN-5 E2)", () => {
  // lineHeight = 16 → a 2-line body is 32px tall; an availableBlockSize of 16
  // fits exactly one line. With the default orphans/widows = 2 this would push
  // the WHOLE body (box: null); with the footnote-body default of 1 the single
  // line places and the remainder carries forward.
  const LINE_HEIGHT = 16;
  const ONE_LINE_BOUND = 16;

  it("renders orphans=1 and widows=1 on the body element style", () => {
    const rendered = footnoteBodyComponent.render(bodyView(), stubRenderContext(), [
      paragraphChild(2),
    ]);
    if (rendered.type !== "element") throw new Error("render returned non-element");
    expect(rendered.style.orphans).toBe(1);
    expect(rendered.style.widows).toBe(1);
    // Google-Docs body default — long unbreakable strings break to fit (mirrors
    // the document/template body defaults).
    expect(rendered.style.overflowWrap).toBe("break-word");
  });

  it("splits a 2-line body at a single line: 1 line placed + non-null breakToken (NOT box: null)", () => {
    const body = cascadedFootnoteBody(2);
    const ctx = bodyLayoutContext(200);
    const shaper = createMockShaper(8, LINE_HEIGHT);

    const { box, breakToken } = layoutBlock(body, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: ONE_LINE_BOUND,
      pageIndex: 0,
      resumeFrom: null,
    });

    // The single line DID place because orphans = 1 cascaded to the IFC.
    expect(box).not.toBeNull();
    expect(breakToken).not.toBeNull();
    // The block-level break token resumes into the (single) paragraph child.
    // `.type` is present on every BreakToken union member.
    expect(breakToken?.type).toBe("block");
    // Exactly one line of inline content placed (1 × 16 = 16 ≤ bound).
    const paragraphBox = asBlockBox(box?.children[0]);
    expect(paragraphBox.children).toHaveLength(1);
  });

  it("CONTROL: the SAME body content WITHOUT the orphans=1 override does NOT split at the 1-line bound", () => {
    // Cascade the identical 2-line paragraph content WITHOUT the footnote-body
    // component's override — a bare block whose orphans/widows default to 2.
    // This proves the component default (not the IFC mechanism alone) is what
    // enables the single-line split. With orphans = 2 the IFC refuses to place a
    // single line (1 < 2 → orphans violated → IFC returns null). Because the body's
    // first child is force-placed on an empty fragment (CSS Fragmentation §5.4 C.6
    // overflow rule — `layoutBlock`'s applyOverflowRule), the WHOLE 2-line body is
    // emitted UNSPLIT (both lines in one box, no break token): the footnote does
    // NOT split at a single line. Contrast the orphans=1 case above, which splits
    // into a 1-line box + a non-null break token. So the component default is
    // load-bearing for single-line footnote splitting.
    const textNode = createTextBox("t", { whiteSpace: "pre" }, "x\nx");
    const para = createElementBox("p", { display: "block", whiteSpace: "pre" } as Style, [
      textNode,
    ]);
    const rawBody = createElementBox(
      "fn-body-control",
      { display: "block", whiteSpace: "break-spaces" } as Style,
      [para],
    );
    const cascaded = cascadePass(rawBody);
    if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");

    const ctx = bodyLayoutContext(200);
    const shaper = createMockShaper(8, LINE_HEIGHT);

    const { box, breakToken } = layoutBlock(cascaded, 0, 0, ctx, shaper, undefined, {
      availableBlockSize: ONE_LINE_BOUND,
      pageIndex: 0,
      resumeFrom: null,
    });

    // orphans default = 2 → no single-line split: the body is emitted whole.
    expect(box).not.toBeNull();
    expect(breakToken).toBeNull();
    // Both lines placed in the single (force-placed) paragraph → 2 × 16 = 32px.
    expect(box?.blockSize).toBe(2 * LINE_HEIGHT);
    const paragraphBox = asBlockBox(box?.children[0]);
    expect(paragraphBox.children).toHaveLength(2);
  });
});

describe("footnoteBodyComponent — leading number marker (FN-6.2b)", () => {
  it("sets markerText from ctx.footnoteNumber(view.id)", () => {
    const rendered = footnoteBodyComponent.render(
      bodyView(),
      stubRenderContext("1"),
      [paragraphChild(1)],
    );
    if (rendered.type !== "element") throw new Error("render returned non-element");
    expect(rendered.style.markerText).toBe("1");
  });

  it("echoes ctx.footnoteNumber verbatim as markerText (component is a pure pass-through)", () => {
    const rendered = footnoteBodyComponent.render(
      bodyView(),
      stubRenderContext("2"),
      [paragraphChild(1)],
    );
    if (rendered.type !== "element") throw new Error("render returned non-element");
    // The component appends NOTHING — it sets markerText to exactly what
    // `ctx.footnoteNumber` returns. In production the bottom-slot "." suffix is
    // added UPSTREAM by `makeRenderContext` (render-footnotes.ts), so the real body marker
    // reads "2." while the superscript call marker reads "2". Here the stub
    // returns the bare "2", so the component echoes "2".
    expect(rendered.style.markerText).toBe("2");
  });

  it("omits markerText when the body has no number (not in the numbering map)", () => {
    const rendered = footnoteBodyComponent.render(
      bodyView(),
      stubRenderContext(undefined),
      [paragraphChild(1)],
    );
    if (rendered.type !== "element") throw new Error("render returned non-element");
    expect(rendered.style.markerText).toBeUndefined();
  });

  it("still carries the orphans/widows defaults alongside the marker", () => {
    const rendered = footnoteBodyComponent.render(
      bodyView(),
      stubRenderContext("1"),
      [paragraphChild(1)],
    );
    if (rendered.type !== "element") throw new Error("render returned non-element");
    expect(rendered.style.markerText).toBe("1");
    expect(rendered.style.orphans).toBe(1);
    expect(rendered.style.widows).toBe(1);
    expect(rendered.style.whiteSpace).toBe("break-spaces");
  });
});
