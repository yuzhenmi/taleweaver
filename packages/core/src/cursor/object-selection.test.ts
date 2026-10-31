/**
 * Object-selection predicate (#525). An atomic-leaf block (image /
 * horizontal-line) is "selected as an object" when the editor holds a
 * COLLAPSED selection at offset 0 of that block. By engine convention the
 * cursor-placement actions encode "this object is selected" that way; no
 * action in the normal editing pipeline puts a text caret at offset 0 of an
 * atomic-leaf (it carries no text), so the position is a reliable
 * discriminant for selections produced by the normal pipeline.
 */
import { describe, it, expect } from "vitest";
import { createDefaultComponentRegistry } from "../components/component-registry";
import {
  buildDocument,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/document-builders";
import { asBlockId, createPosition, createSpan, getBlock } from "../state";
import type { Document, BlockKindResolver } from "../state";
import { isObjectSelection } from "./object-selection";

const componentRegistry = createDefaultComponentRegistry();

const PARA_ID = asBlockId("para");
const IMAGE_ID = asBlockId("image");
const ROOT_ID = asBlockId("doc");

/**
 * Build `[para "above"] [image] [trailing para]` purely at the STATE layer
 * (no editor-action import — cursor is below the editor layer). The image is
 * an atomic-leaf block: no children, no inlineContent. Mirrors the
 * Document-fixture pattern in `cursor-position.test.ts` / `hit-test.test.ts`.
 */
function docWithImage(): Document {
  return buildDocument({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "para",
        lastChildId: "trailing",
      }),
      buildBlock({
        id: "para",
        type: "paragraph",
        parentId: "doc",
        nextSiblingId: "image",
        inlineContent: inlineContent([text("above")]),
      }),
      buildBlock({
        id: "image",
        type: "image",
        parentId: "doc",
        prevSiblingId: "para",
        nextSiblingId: "trailing",
        attrs: { src: "img.png" },
      }),
      buildBlock({
        id: "trailing",
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: "image",
        inlineContent: inlineContent([]),
      }),
    ],
  });
}

describe("isObjectSelection (#525)", () => {
  it("returns the image's blockId for a collapsed selection at offset 0 of the image", () => {
    const document = docWithImage();
    expect(getBlock(document, IMAGE_ID)?.type).toBe("image");
    const pos = createPosition(IMAGE_ID, 0);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, componentRegistry)).toBe(IMAGE_ID);
  });

  it("returns null for a collapsed selection on an inline-bearing (paragraph) block", () => {
    const document = docWithImage();
    const pos = createPosition(PARA_ID, 0);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, componentRegistry)).toBeNull();
  });

  it("returns null for a non-collapsed range (paragraph → image)", () => {
    const document = docWithImage();
    const sel = createSpan(createPosition(PARA_ID, 0), createPosition(IMAGE_ID, 0));
    expect(isObjectSelection(document, sel, componentRegistry)).toBeNull();
  });

  it("returns null for a collapsed selection on a container block (document root)", () => {
    const document = docWithImage();
    expect(getBlock(document, ROOT_ID)?.firstChildId).not.toBeNull();
    const pos = createPosition(ROOT_ID, 0);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, componentRegistry)).toBeNull();
  });

  it("returns null (no throw) for a collapsed selection on a missing block id", () => {
    const document = docWithImage();
    // A stale selection pointing at a block id not present in the state must
    // not throw — getBlock returns null and the predicate bails.
    const missing = asBlockId("gone");
    expect(getBlock(document, missing)).toBeNull();
    const pos = createPosition(missing, 0);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, componentRegistry)).toBeNull();
  });

  it("returns null for a collapsed selection on the atomic block at offset != 0", () => {
    const document = docWithImage();
    const pos = createPosition(IMAGE_ID, 1);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, componentRegistry)).toBeNull();
  });

  it("resolves an atomic-leaf in a CROSS-TREE body (header/template) — not just the main tree", () => {
    // The predicate must agree with getAtomicBoxIndex, which resolves atomic
    // boxes CROSS-TREE (resolveBlock): an atomic image in a header/footer body
    // (templateContents) or footnote body (embedContents) is a real object —
    // a main-tree-only getBlock lookup would wrongly miss it. (Dormant today —
    // images insert main-tree-only — but the gate and the index MUST share tree
    // scope so a future cross-tree atomic can't desync click→select from the
    // action guards.)
    const HEADER_IMAGE_ID = asBlockId("hdr-img");
    const document = buildDocument({
      rootId: "doc",
      blocks: [buildBlock({ id: "doc", type: "document" })],
      templateContents: [
        buildBlock({
          id: "hdr",
          type: "header",
          firstChildId: "hdr-img",
          lastChildId: "hdr-img",
        }),
        buildBlock({
          id: "hdr-img",
          type: "image",
          parentId: "hdr",
          attrs: { src: "hdr.png" },
        }),
      ],
    });
    const pos = createPosition(HEADER_IMAGE_ID, 0);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, componentRegistry)).toBe(HEADER_IMAGE_ID);
  });

  it("returns null when the resolver reports an unknown block type (getBlockKind → null)", () => {
    // Locks the `null === "atomic-leaf"` branch: an unregistered block type
    // yields getBlockKind → null, so even a collapsed-at-offset-0 selection on
    // a real block is not an object selection.
    const document = docWithImage();
    const unknownResolver: BlockKindResolver = { getBlockKind: () => null, getStorageShape: () => null };
    const pos = createPosition(IMAGE_ID, 0);
    const sel = createSpan(pos, pos);
    expect(isObjectSelection(document, sel, unknownResolver)).toBeNull();
  });
});
