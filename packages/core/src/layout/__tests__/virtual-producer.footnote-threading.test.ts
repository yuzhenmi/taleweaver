// packages/core/src/layout/__tests__/virtual-producer.footnote-threading.test.ts
//
// FN-4.0 — pure-plumbing threading of `cascadedEmbedContents` + `footnoteAnchors`
// through `buildVirtualPaginatedTree`. In THIS task the two new params are
// UNUSED for layout output (a later task, FN-4.2 `resolveFootnotes`, consumes
// them). So passing populated values must produce STRUCTURALLY-IDENTICAL output
// (same page count, same top-level box geometry) to the SAME call with the
// defaults. This pins the zero-behavior-change contract.

import { describe, it, expect } from "vitest";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import type { BlockId } from "../../state";
import type { Style } from "../../styles";
import type { PageConfig } from "../page-config";
import type { FootnoteAnchorRef } from "../../footnotes";
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

describe("virtual-producer — FN-4.0 footnote-threading is zero-behavior-change", () => {
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

  it("populated embedContents + footnoteAnchors produce identical page count + geometry as defaults", () => {
    // Baseline: defaults (empty embed map, empty anchors).
    const baseline = build(new Map(), []);

    // Populated: a non-empty footnote body + an anchor ref for a doc with a footnote.
    const bodyId = "fn-body-1" as BlockId;
    const fnBody = cascadeRoot({ display: "block" }, [fixedBlock("fb0", 16)]);
    const embedContents = new Map<BlockId, ElementBox>([[bodyId, fnBody]]);
    const anchors: readonly FootnoteAnchorRef[] = [
      { contentBlockId: bodyId, blockId: "b0" as BlockId, sectionId: null },
    ];
    const populated = build(embedContents, anchors);

    // Same page count.
    expect(populated.plan.entries.length).toBe(baseline.plan.entries.length);
    expect(populated.plan.entries.length).toBe(3);

    // Byte-identical top-level page geometry (blockOffsets/sizes).
    expect(pageGeometry(populated)).toEqual(pageGeometry(baseline));
  });
});
