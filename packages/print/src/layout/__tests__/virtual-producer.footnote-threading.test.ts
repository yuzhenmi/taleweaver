// packages/core/src/layout/__tests__/virtual-producer.footnote-threading.test.ts
//
// FN-4 — threading of `cascadedEmbedContents` + `footnoteAnchors` through
// `buildVirtualPaginatedTree`. The KEY invariant (post FN-4.3): a
// footnote-FREE doc is byte-identical whether or not the (empty) footnote params
// are passed — `resolveFootnotes` is a ref-equal no-op when there are no anchors,
// so a doc with no footnotes never changes. (FN-4.3 wires `resolveFootnotes`, so
// a doc WITH a footnote now DOES change geometry — that case is covered by
// `virtual-layout-tree.footnote-slot.test.ts`; here we only pin the no-op.)

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createElementBox } from "@taleweaver/core";
import type { ElementBox } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import type { FootnoteAnchorRef } from "@taleweaver/core";
import { buildVirtualPaginatedTree } from "../virtual-producer";

function cascadeRoot(
  rootStyle: Style,
  children: readonly ElementBox[],
): ElementBox {
  const root = createElementBox("root", rootStyle, children);
  const cascaded = cascadePass(root);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

function fixedBlock(key: string, blockSize: number): ElementBox {
  return createElementBox(key, { display: "block", blockSize } as Style, []);
}

function pageConfig(pageBlockSize: number, marginBlock = 10): PageConfig {
  return {
    pageInlineSize: 600,
    pageBlockSize,
    pageMargins: { blockStart: marginBlock, blockEnd: marginBlock, inlineStart: 15, inlineEnd: 15 },
    pageGap: 20,
  };
}

const shaper = () => createMockShaper(8, 16);

/** A snapshot of the top-level page geometry, for structural comparison. */
function pageGeometry(tree: ReturnType<typeof buildVirtualPaginatedTree>) {
  return Array.from({ length: tree.plan.entries.length }, (_, i) => {
    const page = tree.getPage(i);
    return {
      blockOffset: page.blockOffset,
      blockSize: page.blockSize,
      inlineSize: page.inlineSize,
      children: page.children.map((c) => ({
        blockOffset: c.blockOffset,
        blockSize: c.blockSize,
      })),
    };
  });
}

describe("virtual-producer — FN-4 footnote-threading: footnote-free is zero-behavior-change", () => {
  // 6 blocks × 100 = 600; content area with 10/10 margins on a 300-tall page is
  // 280 ⇒ 2 blocks/page ⇒ 3 pages.
  const children = Array.from({ length: 6 }, (_, i) => fixedBlock(`b${i}`, 100));
  const cfg = pageConfig(300, 10);

  function build(
    embedContents: ReadonlyMap<BlockId, ElementBox>,
    footnoteAnchors: readonly FootnoteAnchorRef[],
  ) {
    const root = cascadeRoot({ display: "block" }, children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
    return buildVirtualPaginatedTree(
      root,
      ctx,
      shaper(),
      cfg,
      undefined,
      new Map(), // cascadedTemplateContents (no header/footer)
      embedContents,
      footnoteAnchors,
    );
  }

  it("a footnote-FREE doc is byte-identical whether or not the (empty) footnote params are passed", () => {
    // Defaults (params omitted) vs explicitly-empty params: `resolveFootnotes`
    // is a ref-equal no-op with no anchors, so both produce the identical plan.
    const root = cascadeRoot({ display: "block" }, children);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, cfg.pageInlineSize);
    const defaulted = buildVirtualPaginatedTree(root, ctx, shaper(), cfg);
    const explicitEmpty = build(new Map(), []);

    expect(explicitEmpty.plan.entries.length).toBe(defaulted.plan.entries.length);
    expect(explicitEmpty.plan.entries.length).toBe(3);
    expect(pageGeometry(explicitEmpty)).toEqual(pageGeometry(defaulted));
    // No page carries a footnote slot in a footnote-free doc.
    for (let i = 0; i < explicitEmpty.plan.entries.length; i++) {
      expect(explicitEmpty.getPage(i).footnoteSlot).toBeNull();
    }
  });
});
