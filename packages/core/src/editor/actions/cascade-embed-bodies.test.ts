import { describe, it, expect } from "vitest";
import { rebuildTrees } from "./helpers";
import type { EditorState, EditorConfig } from "../editor-state";
import { createMockShaper } from "../../layout/mock-shaper";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import { createHistory, createPosition, createSpan } from "../../state";
import type { State, BlockId } from "../../state";
import { render } from "../../render/render";
import { cascadePass } from "../../cascade";
import { layoutTree } from "../../layout/dispatch";
import type { ElementBox, RenderNode } from "../../render/render-node";
import { buildState, buildBlock, inlineContent, text, embed } from "../../test-utils/state-builders";

const measurer = createMockShaper(8, 16);
const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();
const config: EditorConfig = {
  measurer,
  componentRegistry,
  attrRegistry,
  containerWidth: 600,
};

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

/** Build a complete EditorState from a State using the FULL pipeline. */
function buildEditorFull(state: State): EditorState {
  const rendered = render(state, componentRegistry, attrRegistry);
  const cascadedRoot = cascadePass(rendered.root);
  const layout = layoutTree(cascadedRoot, config.containerWidth, measurer);
  const cascadedTemplateContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of rendered.templateContents) {
    cascadedTemplateContents.set(id, cascadePass(body) as ElementBox);
  }
  const cascadedEmbedContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of rendered.embedContents) {
    cascadedEmbedContents.set(id, cascadePass(body) as ElementBox);
  }
  const cursor = createPosition("p" as BlockId, 0);
  return {
    state,
    selection: createSpan(cursor, cursor),
    history: createHistory(state),
    renderTree: rendered.root,
    renderOutput: rendered,
    cascadedRoot,
    cascadedTemplateContents,
    cascadedEmbedContents,
    layoutTree: layout,
    containerWidth: config.containerWidth,
    targetX: null,
  };
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

describe("rebuildTrees: cascade embedContents bodies (FN-1)", () => {
  it("full path: a footnote body is cascaded — body root has non-null computedStyle and cascaded children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: mainDocWithAnchor("fn-root"),
      embedContents: footnoteBody("fn-root", "fn-p", "footnote text"),
    });
    const rendered = render(state, componentRegistry, attrRegistry);
    const cascadedRoot = cascadePass(rendered.root);
    const layout = layoutTree(cascadedRoot, config.containerWidth, measurer);
    const cursor = createPosition("p" as BlockId, 0);
    const bare: EditorState = {
      state,
      selection: createSpan(cursor, cursor),
      history: createHistory(state),
      renderTree: rendered.root,
      renderOutput: rendered,
      cascadedRoot,
      cascadedTemplateContents: new Map(),
      cascadedEmbedContents: new Map(),
      layoutTree: layout,
      containerWidth: config.containerWidth,
      targetX: null,
    };

    const out = rebuildTrees(bare, bare, config);

    const body = out.cascadedEmbedContents.get("fn-root" as BlockId);
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
    const old = buildEditorFull(state1);

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
    const next: EditorState = { ...old, state: state2 };

    const out = rebuildTrees(next, old, config, new Set(["fn-a-p" as BlockId]));

    const oldA = old.cascadedEmbedContents.get("fn-a-root" as BlockId);
    const newA = out.cascadedEmbedContents.get("fn-a-root" as BlockId);
    const oldB = old.cascadedEmbedContents.get("fn-b-root" as BlockId);
    const newB = out.cascadedEmbedContents.get("fn-b-root" as BlockId);

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
    const old = buildEditorFull(state1);

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
    const next: EditorState = { ...old, state: state2 };

    const out = rebuildTrees(next, old, config, new Set(["p" as BlockId]));

    expect(out.cascadedEmbedContents.get("fn-root" as BlockId)).toBe(
      old.cascadedEmbedContents.get("fn-root" as BlockId),
    );
  });

  it("no-regression: a doc WITHOUT footnote bodies → cascadedEmbedContents is empty", () => {
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
    const old = buildEditorFull(state);

    const outFull = rebuildTrees(old, old, config);
    expect(outFull.cascadedEmbedContents.size).toBe(0);
  });
});
