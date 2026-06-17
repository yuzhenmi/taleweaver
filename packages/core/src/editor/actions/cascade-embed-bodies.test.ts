import { describe, it, expect } from "vitest";
import { cascadeEmbedContents } from "./helpers";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import type { State, BlockId } from "../../state";
import { render, type RenderOutput } from "../../render/render";
import type { ElementBox, RenderNode } from "../../render/render-node";
import { buildState, buildBlock, inlineContent, text, embed } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();

/**
 * Phase 0b: `cascadeEmbedContents` is core's pure footnote-body cascade pass
 * (barrel-exported; the print backend's layout-driver calls it). Core's editor
 * reducer no longer cascades embed bodies into `EditorState`, so these tests
 * exercise the function DIRECTLY over a `RenderOutput` — the same call the
 * driver makes — asserting the full + incremental (reuse-by-reference) contract.
 */

/**
 * A single-paragraph main document whose paragraph carries a footnote anchor
 * referencing `bodyRootId` in embedContents.
 */
function mainDocWithAnchor(bodyRootId: string) {
  return [
    buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
    buildBlock({
      id: "p",
      type: "paragraph",
      parentId: "doc",
      inlineContent: inlineContent([
        text("body"),
        embed("footnote-anchor", { contentBlockId: bodyRootId }),
      ]),
    }),
  ];
}

/**
 * A footnote body: a CONTAINER (`footnote-body`) root wrapping a paragraph
 * leaf, living in embedContents (mirrors the header/footer container shape).
 */
function footnoteBody(rootId: string, leafId: string, leafText: string) {
  return [
    buildBlock({ id: rootId, type: "footnote-body", firstChildId: leafId, lastChildId: leafId }),
    buildBlock({
      id: leafId,
      type: "paragraph",
      parentId: rootId,
      inlineContent: inlineContent([text(leafText)]),
    }),
  ];
}

/** Render `state` and cascade its footnote bodies (full path). */
function cascadeFull(state: State): {
  rendered: RenderOutput;
  cascaded: ReadonlyMap<BlockId, ElementBox>;
} {
  const rendered = render(state, componentRegistry, attrRegistry);
  const cascaded = cascadeEmbedContents(rendered, null, null);
  return { rendered, cascaded };
}

/** Find a cascaded RenderNode by key in a subtree. */
function findByKey(node: RenderNode, key: string): RenderNode | undefined {
  if (node.key === key) return node;
  if (node.type === "element") {
    for (const child of node.children) {
      const found = findByKey(child, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

describe("cascadeEmbedContents: cascade embedContents bodies (FN-1)", () => {
  it("full path: a footnote body is cascaded — body root has non-null computedStyle and cascaded children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: mainDocWithAnchor("fn-root"),
      embedContents: footnoteBody("fn-root", "fn-p", "footnote text"),
    });

    const { cascaded } = cascadeFull(state);

    const body = cascaded.get("fn-root" as BlockId);
    expect(body).toBeDefined();
    expect(body?.computedStyle).toBeDefined();
    expect(body?.type).toBe("element");
    const leaf = body !== undefined ? findByKey(body, "fn-p") : undefined;
    expect(leaf).toBeDefined();
    expect(leaf?.computedStyle).toBeDefined();
  });

  it("incremental: editing a block inside a footnote body re-cascades that body; an unchanged second body is reused by reference", () => {
    const state1 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("body"),
            embed("footnote-anchor", { contentBlockId: "fn-a-root" }),
            embed("footnote-anchor", { contentBlockId: "fn-b-root" }),
          ]),
        }),
      ],
      embedContents: [
        ...footnoteBody("fn-a-root", "fn-a-p", "A original"),
        ...footnoteBody("fn-b-root", "fn-b-p", "B unchanged"),
      ],
    });
    const { rendered: rendered1, cascaded: cascaded1 } = cascadeFull(state1);

    const state2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("body"),
            embed("footnote-anchor", { contentBlockId: "fn-a-root" }),
            embed("footnote-anchor", { contentBlockId: "fn-b-root" }),
          ]),
        }),
      ],
      embedContents: [
        ...footnoteBody("fn-a-root", "fn-a-p", "A EDITED"),
        ...footnoteBody("fn-b-root", "fn-b-p", "B unchanged"),
      ],
    });
    const dirty = new Set(["fn-a-p" as BlockId]);
    const rendered2 = render(state2, componentRegistry, attrRegistry, {
      prev: rendered1,
      prevState: state1,
      dirtyIds: dirty,
    });
    const cascaded2 = cascadeEmbedContents(rendered2, rendered1, cascaded1, dirty);

    const oldA = cascaded1.get("fn-a-root" as BlockId);
    const newA = cascaded2.get("fn-a-root" as BlockId);
    const oldB = cascaded1.get("fn-b-root" as BlockId);
    const newB = cascaded2.get("fn-b-root" as BlockId);

    // Body A re-cascaded → fresh ref, new text shows.
    expect(newA).not.toBe(oldA);
    const newLeafA = newA !== undefined ? findByKey(newA, "fn-a-p") : undefined;
    const textNode = newLeafA?.type === "element" ? newLeafA.children[0] : undefined;
    expect(textNode?.type).toBe("text");
    expect((textNode as { text: string }).text).toBe("A EDITED");

    // Body B unchanged → reused by reference.
    expect(newB).toBe(oldB);
  });

  it("incremental: a doc-body-only edit (no embed change) reuses ALL footnote bodies by reference", () => {
    const state1 = buildState({
      rootId: "doc",
      blocks: mainDocWithAnchor("fn-root"),
      embedContents: footnoteBody("fn-root", "fn-p", "footnote"),
    });
    const { rendered: rendered1, cascaded: cascaded1 } = cascadeFull(state1);

    const state2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("body EDITED"),
            embed("footnote-anchor", { contentBlockId: "fn-root" }),
          ]),
        }),
      ],
      embedContents: footnoteBody("fn-root", "fn-p", "footnote"),
    });
    const dirty = new Set(["p" as BlockId]);
    const rendered2 = render(state2, componentRegistry, attrRegistry, {
      prev: rendered1,
      prevState: state1,
      dirtyIds: dirty,
    });
    const cascaded2 = cascadeEmbedContents(rendered2, rendered1, cascaded1, dirty);

    expect(cascaded2.get("fn-root" as BlockId)).toBe(cascaded1.get("fn-root" as BlockId));
  });

  it("no-regression: a doc WITHOUT footnote bodies → cascaded embed map is empty", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("plain")]),
        }),
      ],
    });

    const { cascaded } = cascadeFull(state);
    expect(cascaded.size).toBe(0);
  });
});
