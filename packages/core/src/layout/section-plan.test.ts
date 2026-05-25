import { describe, it, expect } from "vitest";
import {
  buildSectionPlan,
  sectionStateAt,
  isSectionBox,
  IMPLICIT_SECTION_PLAN,
} from "./section-plan";
import type { SectionPlan } from "./section-plan";
import { createElementBox } from "../render/render-node";
import type { ElementBox, RenderNode } from "../render/render-node";
import type { ComputedStyle } from "../styles";
import type { BlockId } from "../state/block-id";
import type { PageConfig } from "./page-config";

// A doc-wide PageConfig for buildSectionPlan's 2nd argument. 800px block-size
// with 60px top/bottom margins ⇒ a healthy positive content area, so margin
// overrides only trip the content-size guard when deliberately huge.
const DOC_WIDE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 800,
  pageMargins: { blockStart: 60, blockEnd: 60, inlineStart: 72, inlineEnd: 72 },
  pageGap: 20,
};

// --- Fixture helpers ---------------------------------------------------------
//
// buildSectionPlan reads two signals off the cascaded tree:
//   - display via `computedStyle.display` (flattenContents looks at computedStyle)
//   - the section marker via `metadata.blockType === "section"`
// so the hand-built fixtures must stamp BOTH a computedStyle.display and (for
// sections / contents wrappers) the matching metadata.

function cs(display: ComputedStyle["display"]): Readonly<ComputedStyle> {
  // Only `display` is read by flattenContents/isSectionBox; the rest is unused
  // here. We construct a minimal object and cast, mirroring how other layout
  // tests build computedStyle stubs.
  return { display } as unknown as Readonly<ComputedStyle>;
}

function withComputed(box: ElementBox, display: ComputedStyle["display"]): ElementBox {
  return { ...box, computedStyle: cs(display) };
}

/** A plain block paragraph — contributes exactly 1 flattened child. */
function para(key: string): ElementBox {
  return withComputed(createElementBox(key, { display: "block" }, []), "block");
}

/**
 * A section (display:contents + the section marker). Optional `geometry` is
 * merged into the metadata to model a section carrying page-geometry overrides
 * (C.2b-2): the section component stamps these from `view.attrs`.
 */
function section(
  key: string,
  children: readonly RenderNode[],
  geometry?: Record<string, unknown>,
): ElementBox {
  return withComputed(
    createElementBox(key, { display: "contents" }, children, {
      blockType: "section",
      ...geometry,
    }),
    "contents",
  );
}

/** A non-section display:contents wrapper (no section marker). */
function contentsWrapper(key: string, children: readonly RenderNode[]): ElementBox {
  return withComputed(createElementBox(key, { display: "contents" }, children), "contents");
}

/** A doc-root ElementBox with the given children. */
function docRoot(children: readonly RenderNode[]): ElementBox {
  return withComputed(createElementBox("doc", { display: "block" }, children), "block");
}

// --- isSectionBox ------------------------------------------------------------

describe("isSectionBox", () => {
  it("is true only for an element with metadata.blockType === 'section'", () => {
    expect(isSectionBox(section("s", []))).toBe(true);
    expect(isSectionBox(para("p"))).toBe(false);
    expect(isSectionBox(contentsWrapper("w", []))).toBe(false);
  });
});

// --- IMPLICIT_SECTION_PLAN ---------------------------------------------------

describe("IMPLICIT_SECTION_PLAN", () => {
  it("is a single implicit boundary at index 0 with a null sectionId", () => {
    expect(IMPLICIT_SECTION_PLAN).toEqual({
      boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    });
  });
});

// --- buildSectionPlan --------------------------------------------------------

describe("buildSectionPlan", () => {
  it("section-less doc → a single implicit leading boundary", () => {
    const root = docRoot([para("p1"), para("p2"), para("p3")]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    });
  });

  it("[p1, section(a,b), p2] → [{0,null},{1,sec}] (section body starts at flat-index 1)", () => {
    const root = docRoot([
      para("p1"),
      section("sec", [para("a"), para("b")]),
      para("p2"),
    ]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "sec" },
      ],
    });
  });

  it("[section1(a), section2(b,c)] → [{0,sec1},{1,sec2}] (no implicit null boundary)", () => {
    const root = docRoot([
      section("sec1", [para("a")]),
      section("sec2", [para("b"), para("c")]),
    ]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [
        { startFlattenedIndex: 0, sectionId: "sec1" },
        { startFlattenedIndex: 1, sectionId: "sec2" },
      ],
    });
  });

  it("single section(a,b,c) with no leading block → [{0,sec}] (section starts at 0)", () => {
    const root = docRoot([section("sec", [para("a"), para("b"), para("c")])]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [{ startFlattenedIndex: 0, sectionId: "sec" }],
    });
  });

  it("counts nested display:contents inside a section body via flattenContents", () => {
    // section "sec" body = contentsWrapper(p1,p2) → 2 flattened children; then
    // para("after") → flat-index 2; then section "sec2" must open at flat-index 3.
    // A trailing section makes the running flattenedCount OBSERVABLE: if the nested
    // body were miscounted as 1 (not 2), "sec2" would land at index 2, failing here.
    const root = docRoot([
      section("sec", [contentsWrapper("w", [para("p1"), para("p2")])]),
      para("after"),
      section("sec2", [para("x")]),
    ]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [
        { startFlattenedIndex: 0, sectionId: "sec" },
        { startFlattenedIndex: 3, sectionId: "sec2" },
      ],
    });
  });

  it("de-dups coincident boundaries: an empty section keeps the LAST section opened at that index", () => {
    // empty section (0 flattened children) → its boundary index coincides with
    // the following section's; the de-dup keeps the later section.
    const root = docRoot([
      para("p0"),
      section("empty", []),
      section("real", [para("a")]),
    ]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "real" },
      ],
    });
  });

  it("de-dups an empty leading section into the next section (still strictly increasing)", () => {
    const root = docRoot([section("empty", []), section("real", [para("a"), para("b")])]);
    expect(buildSectionPlan(root, DOC_WIDE)).toEqual({
      boundaries: [{ startFlattenedIndex: 0, sectionId: "real" }],
    });
  });

  it("produces boundaries with strictly-increasing startFlattenedIndex (invariant I-2)", () => {
    const root = docRoot([
      para("p0"),
      section("s1", [para("a")]),
      section("empty", []),
      section("s2", [para("b"), para("c")]),
      para("tail"),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    for (let i = 1; i < plan.boundaries.length; i++) {
      expect(plan.boundaries[i].startFlattenedIndex).toBeGreaterThan(
        plan.boundaries[i - 1].startFlattenedIndex,
      );
    }
    expect(plan).toEqual({
      boundaries: [
        { startFlattenedIndex: 0, sectionId: null },
        { startFlattenedIndex: 1, sectionId: "s1" },
        { startFlattenedIndex: 2, sectionId: "s2" },
      ],
    });
  });
});

// --- buildSectionPlan: per-section pageConfig (C.2b-2) ------------------------

describe("buildSectionPlan — per-section pageConfig", () => {
  it("a section WITH a pageBlockSize override → boundary.pageConfig reflects it", () => {
    const root = docRoot([
      para("p1"),
      section("sec", [para("a")], { pageBlockSize: 1000 }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.pageConfig?.pageBlockSize).toBe(1000);
    // The rest of the config is inherited from docWide.
    expect(secBoundary?.pageConfig?.pageInlineSize).toBe(DOC_WIDE.pageInlineSize);
    expect(secBoundary?.pageConfig?.pageMargins).toEqual(DOC_WIDE.pageMargins);
  });

  it("a section with NO overrides → boundary.pageConfig is undefined (inert no-override path)", () => {
    const root = docRoot([para("p1"), section("sec", [para("a")])]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary).toBeDefined();
    expect(secBoundary?.pageConfig).toBeUndefined();
  });

  it("a section whose overrides resolve EQUAL to docWide → pageConfig undefined", () => {
    // Echoing docWide's own values back is a no-op: deep-equal to docWide ⇒ no
    // pageConfig stamped, keeping the reuse/measure path obviously inert.
    const root = docRoot([
      section("sec", [para("a")], {
        pageBlockSize: DOC_WIDE.pageBlockSize,
        pageInlineSize: DOC_WIDE.pageInlineSize,
        pageGap: DOC_WIDE.pageGap,
        pageMargins: { ...DOC_WIDE.pageMargins },
      }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary?.pageConfig).toBeUndefined();
  });

  it("the implicit leading boundary never carries a pageConfig", () => {
    const root = docRoot([
      para("p1"),
      section("sec", [para("a")], { pageBlockSize: 1000 }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const implicit = plan.boundaries.find((b) => b.sectionId === null);
    expect(implicit).toBeDefined();
    expect(implicit?.pageConfig).toBeUndefined();
  });

  it("a margin-only override stamps a pageConfig merged over docWide margins", () => {
    const root = docRoot([
      section("sec", [para("a")], { pageMargins: { inlineStart: 120 } }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    expect(secBoundary?.pageConfig?.pageMargins).toEqual({
      blockStart: 60,
      blockEnd: 60,
      inlineStart: 120,
      inlineEnd: 72,
    });
  });

  it("an unusable override (content-size <= 0) falls back to docWide ⇒ pageConfig undefined", () => {
    const root = docRoot([
      section("sec", [para("a")], { pageMargins: { blockStart: 500, blockEnd: 500 } }),
    ]);
    const plan = buildSectionPlan(root, DOC_WIDE);
    const secBoundary = plan.boundaries.find((b) => b.sectionId === "sec");
    // Validator returns docWide for the unusable combination, which equals
    // docWide ⇒ no pageConfig stamped.
    expect(secBoundary?.pageConfig).toBeUndefined();
  });

  it("IMPLICIT_SECTION_PLAN stays a const with no pageConfig", () => {
    expect(IMPLICIT_SECTION_PLAN.boundaries[0].pageConfig).toBeUndefined();
  });
});

// --- sectionStateAt ----------------------------------------------------------

describe("sectionStateAt", () => {
  // plan: [{0,null},{1,sec},{4,sec2}]
  const plan: SectionPlan = {
    boundaries: [
      { startFlattenedIndex: 0, sectionId: null },
      { startFlattenedIndex: 1, sectionId: "sec" as BlockId },
      { startFlattenedIndex: 4, sectionId: "sec2" as BlockId },
    ],
  };

  it("index 0 → implicit section, next boundary at 1", () => {
    expect(sectionStateAt(plan, 0)).toEqual({
      activeSectionId: null,
      nextBoundaryIndex: 1,
    });
  });

  it("index AT a boundary (1) → that section is active, next boundary at 4", () => {
    expect(sectionStateAt(plan, 1)).toEqual({
      activeSectionId: "sec",
      nextBoundaryIndex: 4,
    });
  });

  it("index BETWEEN boundaries (2,3) → the last boundary <= index is active", () => {
    expect(sectionStateAt(plan, 2)).toEqual({
      activeSectionId: "sec",
      nextBoundaryIndex: 4,
    });
    expect(sectionStateAt(plan, 3)).toEqual({
      activeSectionId: "sec",
      nextBoundaryIndex: 4,
    });
  });

  it("index AT the last boundary (4) → last section active, no next boundary", () => {
    expect(sectionStateAt(plan, 4)).toEqual({
      activeSectionId: "sec2",
      nextBoundaryIndex: null,
    });
  });

  it("index PAST the last boundary (10) → last section active, no next boundary", () => {
    expect(sectionStateAt(plan, 10)).toEqual({
      activeSectionId: "sec2",
      nextBoundaryIndex: null,
    });
  });

  it("the implicit single-boundary plan never reports a next boundary", () => {
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 0)).toEqual({
      activeSectionId: null,
      nextBoundaryIndex: null,
    });
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 99)).toEqual({
      activeSectionId: null,
      nextBoundaryIndex: null,
    });
  });
});

// --- sectionStateAt: pageConfig surfacing (C.2b-2) ---------------------------
//
// The measure pass resolves each page's EFFECTIVE geometry from the active
// section's boundary. `sectionStateAt` must surface the active boundary's
// `pageConfig` (undefined when the active boundary carries no override) so the
// loop can apply the `?? docWide` fallback.

describe("sectionStateAt — pageConfig", () => {
  const OVERRIDE: PageConfig = { ...DOC_WIDE, pageBlockSize: 1200 };
  // plan: [{0,null}, {1,sec, OVERRIDE}, {4,sec2}]
  const plan: SectionPlan = {
    boundaries: [
      { startFlattenedIndex: 0, sectionId: null },
      { startFlattenedIndex: 1, sectionId: "sec" as BlockId, pageConfig: OVERRIDE },
      { startFlattenedIndex: 4, sectionId: "sec2" as BlockId },
    ],
  };

  it("active boundary WITH a pageConfig → surfaced", () => {
    expect(sectionStateAt(plan, 1).pageConfig).toBe(OVERRIDE);
    // between boundaries → still the active (sec) boundary's config.
    expect(sectionStateAt(plan, 3).pageConfig).toBe(OVERRIDE);
  });

  it("active boundary WITHOUT a pageConfig → undefined", () => {
    // index 0: implicit leading boundary (no override).
    expect(sectionStateAt(plan, 0).pageConfig).toBeUndefined();
    // index 4+: sec2 has no override.
    expect(sectionStateAt(plan, 4).pageConfig).toBeUndefined();
    expect(sectionStateAt(plan, 99).pageConfig).toBeUndefined();
  });

  it("IMPLICIT_SECTION_PLAN never surfaces a pageConfig", () => {
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 0).pageConfig).toBeUndefined();
    expect(sectionStateAt(IMPLICIT_SECTION_PLAN, 99).pageConfig).toBeUndefined();
  });
});
