import { describe, it, expect } from "vitest";
import { cascadeTemplateContents } from "./helpers";
import { createDefaultComponentRegistry } from "../../components/component-registry";
import { createDefaultAttrRegistry } from "../../cascade/attr-registry";
import type { State, BlockId } from "../../state";
import { render, type RenderOutput } from "../../render/render";
import type { ElementBox, RenderNode } from "../../render/render-node";
import { buildState, buildBlock, inlineContent, text } from "../../test-utils/state-builders";

const componentRegistry = createDefaultComponentRegistry();
const attrRegistry = createDefaultAttrRegistry();

/**
 * Phase 0b: `cascadeTemplateContents` is core's pure header/footer-body cascade
 * pass (barrel-exported; the print backend's layout-driver calls it). Core's
 * editor reducer no longer cascades template bodies into `EditorState`, so these
 * tests exercise the function DIRECTLY over a `RenderOutput` — the same call the
 * driver makes — asserting the full + incremental (reuse-by-reference) contract.
 */

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

/** Render `state` and cascade its template bodies (full path). */
function cascadeFull(state: State): {
  rendered: RenderOutput;
  cascaded: ReadonlyMap<BlockId, ElementBox>;
} {
  const rendered = render(state, componentRegistry, attrRegistry);
  const cascaded = cascadeTemplateContents(rendered, null, null);
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

describe("cascadeTemplateContents: cascade templateContents bodies (C.2c T3)", () => {
  it("full path: a templateContents body is cascaded — body root has non-null computedStyle and cascaded children", () => {
    const state = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: headerBody("hdr-root", "hdr-p", "header text"),
    });

    const { cascaded } = cascadeFull(state);

    const body = cascaded.get("hdr-root" as BlockId);
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
    const { rendered: rendered1, cascaded: cascaded1 } = cascadeFull(state1);

    // Edit the leaf inside body A only.
    const state2 = buildState({
      rootId: "doc",
      blocks: mainDoc(),
      templateContents: [
        ...headerBody("hdr-a-root", "hdr-a-p", "A EDITED"),
        ...headerBody("hdr-b-root", "hdr-b-p", "B unchanged"),
      ],
    });
    const dirty = new Set(["hdr-a-p" as BlockId]);
    const rendered2 = render(state2, componentRegistry, attrRegistry, {
      prev: rendered1,
      prevState: state1,
      dirtyIds: dirty,
    });
    const cascaded2 = cascadeTemplateContents(rendered2, rendered1, cascaded1, dirty);

    const oldA = cascaded1.get("hdr-a-root" as BlockId);
    const newA = cascaded2.get("hdr-a-root" as BlockId);
    const oldB = cascaded1.get("hdr-b-root" as BlockId);
    const newB = cascaded2.get("hdr-b-root" as BlockId);

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
    const { rendered: rendered1, cascaded: cascaded1 } = cascadeFull(state1);

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
    const dirty = new Set(["p" as BlockId]);
    const rendered2 = render(state2, componentRegistry, attrRegistry, {
      prev: rendered1,
      prevState: state1,
      dirtyIds: dirty,
    });
    const cascaded2 = cascadeTemplateContents(rendered2, rendered1, cascaded1, dirty);

    expect(cascaded2.get("hdr-root" as BlockId)).toBe(cascaded1.get("hdr-root" as BlockId));
  });

  it("no-regression: a doc WITHOUT template bodies → cascaded template map is empty", () => {
    const state = buildState({ rootId: "doc", blocks: mainDoc() });
    const { rendered: rendered1, cascaded: cascaded1 } = cascadeFull(state);

    // Full path.
    expect(cascaded1.size).toBe(0);

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
    const dirty = new Set(["p" as BlockId]);
    const rendered2 = render(state2, componentRegistry, attrRegistry, {
      prev: rendered1,
      prevState: state,
      dirtyIds: dirty,
    });
    const cascaded2 = cascadeTemplateContents(rendered2, rendered1, cascaded1, dirty);
    expect(cascaded2.size).toBe(0);
  });
});
