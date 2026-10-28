/**
 * Storage shape comes from the component registry (`getStorageShape`), never from the
 * snapshot's child count; the upgrade infers (and reports) legacy types the host no
 * longer registers; `setBlockType` refuses a change of storage shape; a legacy clip is
 * upgraded and pastes its suggested breaks as real breaks.
 */
import { attrRegistry } from "../cascade/attr-registry";
import { topLevelBlockIds } from "./block-traversal";
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createState, getBlock } from "./state";
import { buildStateFromBlocks } from "./build-state-from-blocks";
import { reparentChildren } from "./ops/reparent-children";
import { setBlockType } from "./ops/set-block-type";
import { insertFragment } from "./ops/insert-fragment";
import { upgradeDocument } from "./upgrade";
import { getRegistry } from "./registry";
import { STATE_INTERNAL } from "./state-internal";
import { decodeFragmentClip } from "./serialize/fragment-clip";
import { bytesToBase64 } from "./serialize/base64";
import { createPosition, createSpan } from "./block-position";
import { createTestAllocator, type BlockId } from "./block-id";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createElementBox } from "../render/render-node";
import { buildBlock, inlineContent, text, embed, withTestAttrs } from "../test-utils/state-builders";
import { legacyDoc } from "../test-utils/legacy-fixture";
import { INSERTION_TAG_KEY } from "./break-tags";
import { flowShape } from "../test-utils/invariant-i";

const id = (s: string): BlockId => s as BlockId;

function withAside() {
  const reg = createDefaultComponentRegistry();
  reg.register({ type: "aside", kind: "container", render: (view, _ctx, children) => createElementBox(view.id, { display: "block" }, children) });
  return reg;
}

describe("storage shape from the component registry", () => {
  it("an EMPTY childless host container is a flow holder: a paragraph moves into it", () => {
    const resolver = withAside();
    const s0 = buildStateFromBlocks({
      resolver,
      rootId: id("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "aside" }),
        buildBlock({ id: "p", type: "paragraph", parentId: "doc", nextSiblingId: "aside", inlineContent: inlineContent([text("x")]) }),
        buildBlock({ id: "aside", type: "aside", parentId: "doc", prevSiblingId: "p" }),
      ],
    });
    expect(getRegistry(s0[STATE_INTERNAL].doc).get("aside")?.get("shape")).toBe("container");
    // End marks: a paragraph is its content + its ¶; a container is ONE self-delimiting
    // item; a paragraph follows it at the flow end (invariant I), and its own flow holds one ¶.
    expect(flowShape(s0, "doc")).toMatch(/^p:"x" \[aside\] \S+:""$/);
    expect(flowShape(s0, "aside")).toMatch(/^\S+:""$/);
    const moved = reparentChildren(s0, [id("p")], id("aside"), null).state;
    expect(getBlock(moved, id("p"))?.parentId).toBe("aside");
  });

  it("an unregistered type at a write boundary is an error", () => {
    expect(() =>
      buildStateFromBlocks({
        resolver: createDefaultComponentRegistry(),
        rootId: id("doc"),
        blocks: [
          buildBlock({ id: "doc", type: "document", firstChildId: "x", lastChildId: "x" }),
          buildBlock({ id: "x", type: "mystery", parentId: "doc" }),
        ],
      }),
    ).toThrow(/not registered/);
  });

  it("setBlockType refuses a cross-storage-shape change within one kind (aside → table-cell)", () => {
    const resolver = withAside();
    const s0 = buildStateFromBlocks({
      resolver,
      rootId: id("doc"),
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "aside", lastChildId: "aside" }),
        buildBlock({ id: "aside", type: "aside", parentId: "doc", firstChildId: "q", lastChildId: "q" }),
        buildBlock({ id: "q", type: "paragraph", parentId: "aside", inlineContent: inlineContent([text("q")]) }),
      ],
    });
    expect(() => setBlockType(s0, id("aside"), "table-cell", resolver)).toThrow(/storage-shape/);
  });
});

describe("upgrade with a resolver", () => {
  it("infers the shape of a legacy type the host no longer registers and reports it", () => {
    const doc = legacyDoc([text("a")], [text("b")]);
    doc.getMap<Y.Map<unknown>>("blocks").get("p2")?.set("type", "callout");
    const report = upgradeDocument(withTestAttrs(doc), { resolver: createDefaultComponentRegistry() });
    expect(report.unregisteredTypes).toEqual(["callout"]);
    expect(getRegistry(doc).get("p2")?.get("shape")).toBe("text");
    const s = createState({ rootId: id("doc"), doc, resolver: createDefaultComponentRegistry() });
    expect(getBlock(s, id("p2"))?.type).toBe("callout");
  });

  it("a legacy clip is upgraded, then pastes its suggested break as a REAL break", () => {
    const resolver = createDefaultComponentRegistry();
    const legacy = legacyDoc([text("ab"), embed("block-split-suggestion", { suggestionId: "s1" })], [text("cd")]);
    const clip = bytesToBase64(Y.encodeStateAsUpdate(legacy));
    const fragment = decodeFragmentClip(clip, resolver, attrRegistry);
    if (fragment === null) throw new Error("clip did not decode");
    const dest = buildStateFromBlocks({
      resolver,
      rootId: id("d"),
      blocks: [
        buildBlock({ id: "d", type: "document", firstChildId: "t", lastChildId: "t" }),
        buildBlock({ id: "t", type: "paragraph", parentId: "d", inlineContent: inlineContent([text("XY")]) }),
      ],
    });
    const at = createPosition(id("t"), 1);
    const r = insertFragment(dest, createSpan(at, at), fragment, createTestAllocator("c"));
    for (const [, e] of getRegistry(r.state[STATE_INTERNAL].doc).entries()) expect(e.has(INSERTION_TAG_KEY)).toBe(false);
    // The pasted break is real: the document now holds two paragraphs.
    expect(topLevelBlockIds(r.state).length).toBe(2);
  });
});
