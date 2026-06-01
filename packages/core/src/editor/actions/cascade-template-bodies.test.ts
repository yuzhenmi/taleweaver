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
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

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
 * A single-paragraph main document. The `paragraph` cursor anchor.
 */
function mainDoc() {
  return [
    buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
    buildBlock({
      id: "p",
      type: "paragraph",
      parentId: "doc",
      inlineContent: inlineContent([text("body text")]),
    }),
  ];
}

/**
 * A multi-level header body (mirrors the #285 nested-container fixture):
 * a container (`document`) wrapping a paragraph leaf, living in
 * templateContents.
 */
function headerBody(rootId: string, leafId: string, leafText: string) {
  return [
    buildBlock({ id: rootId, type: "document", firstChildId: leafId, lastChildId: leafId }),
    buildBlock({
      id: leafId,
      type: "paragraph",
      parentId: rootId,
      inlineContent: inlineContent([text(leafText)]),
    }),
  ];
}

/**
 * Build a complete EditorState from a State using the FULL pipeline
 * (render → cascadePass → layoutTree), populating every field T3 expects.
 * `cascadedTemplateContents` is populated via the same full-cascade path the
 * initial-state construction uses, so this serves as a valid `oldEditor` for
 * both the full and incremental rebuildTrees paths.
 */
function buildEditorFull(state: State): EditorState {
  const rendered = render(state, componentRegistry, attrRegistry);
  const cascadedRoot = cascadePass(rendered.root);
  const layout = layoutTree(cascadedRoot, config.containerWidth, measurer);
  const cascadedTemplateContents = new Map<BlockId, ElementBox>();
  for (const [id, body] of rendered.templateContents) {
    cascadedTemplateContents.set(id, cascadePass(body) as ElementBox);
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
    cascadedEmbedContents: new Map(),
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

describe("rebuildTrees: cascade templateContents bodies (C.2c T3)", () => {
  it("full path: a templateContents body is cascaded — body root has non-null computedStyle and cascaded children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: headerBody("hdr-root", "hdr-p", "header text"),
    });
    // Start from a bare editor whose cascadedTemplateContents is empty (mimics
    // the pre-T3 world where bodies were never cascaded), then full-rebuild.
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

    // Full rebuild (no dirtyIds).
    const out = rebuildTrees(bare, bare, config);

    const body = out.cascadedTemplateContents.get("hdr-root" as BlockId);
    expect(body).toBeDefined();
    // The body root must be cascaded: non-null computedStyle.
    expect(body?.computedStyle).toBeDefined();
    expect(body?.type).toBe("element");
    // And its descendants are cascaded too (the leaf paragraph node).
    const leaf = body !== undefined ? findByKey(body, "hdr-p") : undefined;
    expect(leaf).toBeDefined();
    expect(leaf?.computedStyle).toBeDefined();
  });

  it("incremental: editing a block inside a body re-cascades that body; an unchanged second body is reused by reference", () => {
    const state1 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        ...headerBody("hdr-a-root", "hdr-a-p", "A original"),
        ...headerBody("hdr-b-root", "hdr-b-p", "B unchanged"),
      ],
    });
    const old = buildEditorFull(state1);

    // Edit the leaf inside body A only.
    const state2 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        ...headerBody("hdr-a-root", "hdr-a-p", "A EDITED"),
        ...headerBody("hdr-b-root", "hdr-b-p", "B unchanged"),
      ],
    });
    const next: EditorState = { ...old, state: state2 };

    const out = rebuildTrees(next, old, config, new Set(["hdr-a-p" as BlockId]));

    const oldA = old.cascadedTemplateContents.get("hdr-a-root" as BlockId);
    const newA = out.cascadedTemplateContents.get("hdr-a-root" as BlockId);
    const oldB = old.cascadedTemplateContents.get("hdr-b-root" as BlockId);
    const newB = out.cascadedTemplateContents.get("hdr-b-root" as BlockId);

    // Body A re-cascaded (its leaf changed) → fresh ref, and the new text shows.
    expect(newA).not.toBe(oldA);
    const newLeafA = newA !== undefined ? findByKey(newA, "hdr-a-p") : undefined;
    const textNode = newLeafA?.type === "element" ? newLeafA.children[0] : undefined;
    expect(textNode?.type).toBe("text");
    expect((textNode as { text: string }).text).toBe("A EDITED");

    // Body B unchanged → reused by reference.
    expect(newB).toBe(oldB);
  });

  it("incremental: a doc-body-only edit (no template change) reuses ALL template bodies by reference", () => {
    const state1 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: headerBody("hdr-root", "hdr-p", "header"),
    });
    const old = buildEditorFull(state1);

    // Edit a main-document block; the template body is untouched.
    const state2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("body text EDITED")]),
        }),
      ],
      templateContents: headerBody("hdr-root", "hdr-p", "header"),
    });
    const next: EditorState = { ...old, state: state2 };

    const out = rebuildTrees(next, old, config, new Set(["p" as BlockId]));

    expect(out.cascadedTemplateContents.get("hdr-root" as BlockId)).toBe(
      old.cascadedTemplateContents.get("hdr-root" as BlockId),
    );
  });

  it("no-regression: a doc WITHOUT template bodies → cascadedTemplateContents is empty", () => {
    const state = buildState({ rootId: "doc", blocks: mainDoc() });
    const old = buildEditorFull(state);

    // Full path.
    const outFull = rebuildTrees(old, old, config);
    expect(outFull.cascadedTemplateContents.size).toBe(0);

    // Incremental path (a doc edit).
    const state2 = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("edited")]),
        }),
      ],
    });
    const next: EditorState = { ...old, state: state2 };
    const outInc = rebuildTrees(next, old, config, new Set(["p" as BlockId]));
    expect(outInc.cascadedTemplateContents.size).toBe(0);
  });
});
