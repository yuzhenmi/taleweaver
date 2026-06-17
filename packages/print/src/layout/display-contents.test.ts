// P1.C.1a: `display: contents` box suppression. A contents element generates no
// box; its children lay out as if direct children of its parent. The guard: a
// doc with a contents wrapper lays out byte-identically to the same doc with the
// wrapper's children hoisted — both non-paginated AND paginated — and the
// contents element's key appears in NO layout box.
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "./dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { LayoutBox } from "./layout-node";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "./page-config";

const shaper = createMockShaper(8, 16);
const W = 500;

function para(key: string, text: string): ReturnType<typeof createElementBox> {
  return createElementBox(key, { display: "block" }, [
    createTextBox(`${key}-t`, { display: "inline" }, text),
  ]);
}

// doc with: p1, <contents sec>(a, b), p2   — `secStyle` lets us add margins etc.
function wrapperDoc(secStyle: Style = { display: "contents" }) {
  return createElementBox("doc", { display: "block" }, [
    para("p1", "one"),
    createElementBox("sec", secStyle, [para("a", "alpha"), para("b", "beta")]),
    para("p2", "two"),
  ]);
}
// doc with the wrapper's children hoisted: p1, a, b, p2
function hoistedDoc() {
  return createElementBox("doc", { display: "block" }, [
    para("p1", "one"), para("a", "alpha"), para("b", "beta"), para("p2", "two"),
  ]);
}

function anyBoxHasKey(box: LayoutBox, key: string): boolean {
  if (box.key === key) return true;
  if ("children" in box) {
    for (const c of box.children as readonly LayoutBox[]) {
      if (anyBoxHasKey(c, key)) return true;
    }
  }
  return false;
}

// Concatenate the text of every text-run box in the tree (document order).
function allRunText(box: LayoutBox): string {
  if (box.type === "text-run") return box.text;
  let out = "";
  if ("children" in box) {
    for (const c of box.children as readonly LayoutBox[]) out += allRunText(c);
  }
  return out;
}

// Absolute block offset (sum of blockOffset up the chain to `root`).
function absBlockOffset(root: LayoutBox, key: string): number {
  function walk(box: LayoutBox, acc: number): number | null {
    const here = acc + box.blockOffset;
    if (box.key === key) return here;
    if ("children" in box) {
      for (const c of box.children as readonly LayoutBox[]) {
        const found = walk(c, here);
        if (found !== null) return found;
      }
    }
    return null;
  }
  const r = walk(root, 0);
  if (r === null) throw new Error(`box ${key} not found`);
  return r;
}

describe("display: contents box suppression (P1.C.1a)", () => {
  it("non-paginated: a contents wrapper lays out identically to its children hoisted", () => {
    const withWrapper = layoutTree(cascadePass(wrapperDoc()), W, shaper);
    const hoisted = layoutTree(cascadePass(hoistedDoc()), W, shaper);
    expect(withWrapper).toEqual(hoisted);
  });

  it("the contents element's key appears in NO layout box", () => {
    const lt = layoutTree(cascadePass(wrapperDoc()), W, shaper);
    expect("children" in lt).toBe(true);
    expect(anyBoxHasKey(lt as LayoutBox, "sec")).toBe(false);
    // sanity: the children DO appear.
    expect(anyBoxHasKey(lt as LayoutBox, "a")).toBe(true);
    expect(anyBoxHasKey(lt as LayoutBox, "b")).toBe(true);
  });

  it("box-model on a contents element is dropped (no box → no margins/padding/border)", () => {
    const withMargins = layoutTree(
      cascadePass(wrapperDoc({
        display: "contents",
        marginBlockStart: { unit: "px", value: 20 },
        paddingInlineStart: { unit: "px", value: 10 },
      })),
      W, shaper,
    );
    const plain = layoutTree(cascadePass(hoistedDoc()), W, shaper);
    expect(withMargins).toEqual(plain);
    // Geometry guard (independent of the structural equality above). Document
    // order is p1, <contents>(a, b), p2 at one line height (16px) each. The
    // suppressed wrapper's `marginBlockStart: 20px` must NOT push its first
    // child down: "a" sits at 16 (directly after p1), not 36.
    expect("children" in withMargins).toBe(true);
    expect(absBlockOffset(withMargins as LayoutBox, "a")).toBe(16);
    // "b" follows "a" directly (32), no inter-child margin from the wrapper.
    expect(absBlockOffset(withMargins as LayoutBox, "b")).toBe(32);
  });

  it("IFC: a contents element nested inside an inline element tokenizes as if its children were direct", () => {
    // `groupChildren` flattens a BLOCK's direct children, but the IFC recurses
    // into INLINE elements with their raw children. So the reachable case is a
    // `display: contents` element nested inside an inline `<span>`: it must NOT
    // swallow its inline text children — they tokenize at the span's level (the
    // contents element generates no inline box, adds no inline ancestor).
    const wrap = createElementBox("p", { display: "block" }, [
      createElementBox("s", { display: "inline" }, [
        createTextBox("t1", { display: "inline" }, "alpha "),
        createElementBox("sec", { display: "contents" }, [
          createTextBox("t2", { display: "inline" }, "beta "),
          createTextBox("t3", { display: "inline" }, "gamma"),
        ]),
        createTextBox("t4", { display: "inline" }, " omega"),
      ]),
    ]);
    const hoist = createElementBox("p", { display: "block" }, [
      createElementBox("s", { display: "inline" }, [
        createTextBox("t1", { display: "inline" }, "alpha "),
        createTextBox("t2", { display: "inline" }, "beta "),
        createTextBox("t3", { display: "inline" }, "gamma"),
        createTextBox("t4", { display: "inline" }, " omega"),
      ]),
    ]);
    const wrapLt = layoutTree(cascadePass(wrap), W, shaper);
    const hoistLt = layoutTree(cascadePass(hoist), W, shaper);
    expect(wrapLt).toEqual(hoistLt);
    // The contents element generates no inline box.
    expect(anyBoxHasKey(wrapLt as LayoutBox, "sec")).toBe(false);
    // The text wrapped by the contents element ("beta", "gamma") is NOT dropped.
    const runText = allRunText(wrapLt as LayoutBox);
    expect(runText).toContain("beta");
    expect(runText).toContain("gamma");
  });

  it("paginated: contents wrapper's plan + materialized tree match the hoisted doc", () => {
    // Small pages so the 4 paragraphs split across pages.
    const pageConfig: PageConfig = {
      pageInlineSize: W,
      pageBlockSize: 40, // ~2 one-line paras per page
      pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const wrap = layoutTree(cascadePass(wrapperDoc()), W, shaper, pageConfig);
    const hoist = layoutTree(cascadePass(hoistedDoc()), W, shaper, pageConfig);
    if (wrap.type !== "virtual-root" || hoist.type !== "virtual-root") {
      throw new Error("expected paginated virtual trees");
    }
    // Page plan (boundaries / entry offsets) identical.
    expect(wrap.plan.entries.length).toBe(hoist.plan.entries.length);
    // Materialized positioned trees deep-equal (the contents wrapper is invisible).
    expect(positionTreeForTest(wrap)).toEqual(positionTreeForTest(hoist));
    // The slice-dependent path: pageIndexOfBlock for the contents element's
    // children must match the hoisted doc. (The measure pass indexes
    // PagePlanEntry.children over the FLATTENED child list; a root-level contents
    // element would otherwise desync the slice and mis-map these keys.)
    for (const key of ["p1", "a", "b", "p2"]) {
      expect(wrap.plan.pageIndexOfBlock(key as never)).toBe(
        hoist.plan.pageIndexOfBlock(key as never),
      );
    }
    // The contents element itself is not a paginated block (no own meta).
    expect(wrap.plan.pageIndexOfBlock("sec" as never)).toBe(-1);
  });
});
