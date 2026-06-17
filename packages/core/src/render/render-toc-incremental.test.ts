/**
 * The TOC incremental-render perf contract (slice 3-series): a live
 * `table-of-contents` block derives its entry lines from the document outline
 * (other blocks' headings) at render time. The incremental render REUSES a
 * block's prev RenderNode by reference when it is not invalidated — so a TOC not
 * itself edited would go stale when a HEADING elsewhere changes. This suite locks:
 *
 *  1. `RenderOutput.outlineSignature` is present + correct on the full path.
 *  2. Reuse-by-ref when the outline is UNCHANGED (the load-bearing O(1) assertion):
 *     a non-heading edit keeps the SAME TOC RenderNode object.
 *  3. Force-rebuild when a HEADING edits: the TOC RenderNode is a fresh object and
 *     reflects the new heading text.
 *  4. No-TOC docs: empty tocAnchorIds; a heading edit does not crash.
 */
import { describe, it, expect } from "vitest";
import { render } from "./render";
import type { RenderNode, ElementBox } from "./render-node";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { buildBlock, buildState, inlineContent, text } from "../test-utils/state-builders";
import { asBlockId, insertText, createPosition, mergeBlockAttrs } from "../state";

const reg = createDefaultComponentRegistry();
const attrReg = createDefaultAttrRegistry();

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const H1 = "h1";
const H2 = "h2";
const P = "p";
const TOC = "toc";

/** Locate the TOC block's render box (the ElementBox tagged `tableOfContents`). */
function findToc(root: RenderNode): ElementBox {
  let found: ElementBox | null = null;
  function walk(node: RenderNode): void {
    if (node.type !== "element") return;
    if (node.metadata?.tableOfContents === true) found = node;
    for (const child of node.children) walk(child);
  }
  walk(root);
  if (found === null) throw new Error("no TOC box");
  return found;
}

/** The first text-run text under a node (its first descendant TextBox). */
function firstTextOf(node: RenderNode): string {
  let out: string | null = null;
  function walk(n: RenderNode): void {
    if (out !== null) return;
    if (n.type === "text") {
      out = n.text;
      return;
    }
    for (const child of n.children) walk(child);
  }
  walk(node);
  if (out === null) throw new Error("no text descendant");
  return out;
}

/** A doc: h1 "Introduction", a paragraph "body", h2 "Details", then a TOC. */
function docWithToc() {
  return buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: H1, lastChildId: TOC }),
      buildBlock({
        id: H1,
        type: "heading",
        parentId: "doc",
        nextSiblingId: P,
        attrs: { level: 1 },
        inlineContent: inlineContent([text("Introduction")]),
      }),
      buildBlock({
        id: P,
        type: "paragraph",
        parentId: "doc",
        prevSiblingId: H1,
        nextSiblingId: H2,
        inlineContent: inlineContent([text("body")]),
      }),
      buildBlock({
        id: H2,
        type: "heading",
        parentId: "doc",
        prevSiblingId: P,
        nextSiblingId: TOC,
        attrs: { level: 2 },
        inlineContent: inlineContent([text("Details")]),
      }),
      buildBlock({
        id: TOC,
        type: "table-of-contents",
        parentId: "doc",
        prevSiblingId: H2,
        inlineContent: null,
      }),
    ],
  });
}

/** A doc with two headings but NO table-of-contents block. */
function docNoToc() {
  return buildState({
    rootId: asBlockId("doc"),
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: H1, lastChildId: H2 }),
      buildBlock({
        id: H1,
        type: "heading",
        parentId: "doc",
        nextSiblingId: H2,
        attrs: { level: 1 },
        inlineContent: inlineContent([text("Introduction")]),
      }),
      buildBlock({
        id: H2,
        type: "heading",
        parentId: "doc",
        prevSiblingId: H1,
        attrs: { level: 2 },
        inlineContent: inlineContent([text("Details")]),
      }),
    ],
  });
}

describe("render — TOC incremental outline-signature perf contract", () => {
  it("populates RenderOutput.outlineSignature on the full path", () => {
    const out = render(docWithToc(), reg, attrReg);
    expect(out.outlineSignature.signature.map((e) => e.blockId)).toEqual([asBlockId(H1), asBlockId(H2)]);
    expect([...out.outlineSignature.tocAnchorIds]).toEqual([asBlockId(TOC)]);
    expect(out.outlineSignature.signature).toHaveLength(2);
    expect(out.outlineSignature.signature[0]).toEqual({
      blockId: asBlockId(H1),
      level: 1,
      text: "Introduction",
    });
  });

  it("REUSES the TOC RenderNode by reference when a non-heading block edits (O(1))", () => {
    const state = docWithToc();
    const prev = render(state, reg, attrReg);
    const prevToc = findToc(prev.root);

    // Edit the paragraph only — no heading changed, so the outline is unchanged
    // and the TOC RenderNode must be reused by reference (the load-bearing perf
    // assertion).
    const { state: next, dirtyIds } = insertText(
      state,
      createPosition(asBlockId(P), "body".length),
      " more",
      {},
    );
    expect(dirtyIds.has(asBlockId(TOC))).toBe(false);
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(findToc(out.root)).toBe(prevToc);
    // The signature is reused by reference too.
    expect(out.outlineSignature).toBe(prev.outlineSignature);
  });

  it("force-rebuilds the TOC (new node + new entry text) when a heading edits", () => {
    const state = docWithToc();
    const prev = render(state, reg, attrReg);
    const prevToc = findToc(prev.root);
    expect(firstTextOf(nth(prevToc.children, 0, "entry 0"))).toBe("Introduction");

    // Edit the first heading's text. The host TOC block is NOT in dirtyIds, but
    // the outline changed, so the expansion must force the TOC to re-derive.
    const { state: next, dirtyIds } = insertText(
      state,
      createPosition(asBlockId(H1), "Introduction".length),
      "!",
      {},
    );
    expect(dirtyIds.has(asBlockId(TOC))).toBe(false);
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    const nextToc = findToc(out.root);
    expect(nextToc).not.toBe(prevToc);
    expect(firstTextOf(nth(nextToc.children, 0, "entry 0"))).toBe("Introduction!");
  });

  it("REUSES the TOC when a heading edit does NOT change the outline (format-only change)", () => {
    const state = docWithToc();
    const prev = render(state, reg, attrReg);
    const prevToc = findToc(prev.root);

    // A format-only heading edit (textAlign) dirties the heading — so the outline
    // GATE fires (outlineMightHaveChanged is true) — but the heading's outline text +
    // level are unchanged, so the signature is EQUAL and the TOC must NOT be re-derived.
    // This is the over-invalidation-avoidance the signature comparison buys.
    const { state: next, dirtyIds } = mergeBlockAttrs(
      state,
      asBlockId(H1),
      { textAlign: "center" },
      attrReg,
    );
    expect(dirtyIds.has(asBlockId(H1))).toBe(true);
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    expect(findToc(out.root)).toBe(prevToc);
  });

  it("no-ops on a doc with no TOC: empty tocAnchorIds; a heading edit does not crash", () => {
    const state = docNoToc();
    const prev = render(state, reg, attrReg);
    expect(prev.outlineSignature.tocAnchorIds.size).toBe(0);

    const { state: next, dirtyIds } = insertText(
      state,
      createPosition(asBlockId(H1), "Introduction".length),
      "!",
      {},
    );
    const out = render(next, reg, attrReg, { prev, prevState: state, dirtyIds });
    // Valid output: the edited heading reflects the new text, signature updated.
    expect(nth(out.outlineSignature.signature, 0, "signature entry").text).toBe("Introduction!");
    expect(out.outlineSignature.tocAnchorIds.size).toBe(0);
  });
});
